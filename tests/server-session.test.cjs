const {test} = require('node:test');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const modulePromise=import(pathToFileURL(path.resolve('server/taskflow-auth.mjs')));
const origin='https://audiophrases.github.io';
const scope='https://www.googleapis.com/auth/tasks';
function harness(options={}) {
  const objects=new Map(),grants=[];
  let calls=0;
  const env={GOOGLE_CLIENT_ID:'existing-client',GOOGLE_CLIENT_SECRET:'private-client-secret',STUDENT_SESSION_KEY:'server-session-key',QUIZ_MEDIA:{
    async put(key,value){objects.set(key,value);return {etag:'etag'};},
    async get(key){const value=objects.get(key);return value?{text:async()=>value,etag:'etag'}:null;},
    async delete(key){objects.delete(key);},
  }};
  const fetcher=async(url,request)=>{
    calls++;const body=new URLSearchParams(request.body);grants.push(body.get('grant_type'));
    assert.equal(url,'https://oauth2.googleapis.com/token');
    if(options.revoked&&body.get('grant_type')==='refresh_token')return Response.json({error:'invalid_grant'},{status:400});
    return Response.json({access_token:'google-access',expires_in:options.expiring?1:3600,scope:options.denied?'openid':scope,...(body.get('grant_type')==='authorization_code'?{refresh_token:'google-refresh-secret'}:{})});
  };
  async function call(route,{handle,body={code:'single-use-code'},requestOrigin=origin,headers=true,method='POST'}={}) {
    const {handleTaskflowAuth}=await modulePromise;
    return handleTaskflowAuth(new Request('https://api.pinplay.win/api/taskflow/'+route,{method,headers:{Origin:requestOrigin,'Content-Type':'application/json',...(headers?{'X-Taskflow-Request':'1'}:{}),...(handle?{Authorization:'Bearer '+handle}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})}),env,fetcher);
  }
  return {env,objects,grants,call,get calls(){return calls;}};
}
test('server exchange stores encrypted Google credentials and returns only opaque session handle',async()=>{
  const h=harness();const response=await h.call('exchange');assert.equal(response.status,200);
  const result=await response.json();assert.match(result.session,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.refresh_token,undefined);assert.equal(result.access_token,'google-access');
  const saved=[...h.objects.values()][0];assert.equal(saved.includes('google-refresh-secret'),false);assert.equal(saved.includes('google-access'),false);
  assert.match(response.headers.get('Cache-Control'),/no-store/);
});
test('return visit restores valid session without Google login or another token exchange',async()=>{
  const h=harness();const login=await(await h.call('exchange')).json();
  const response=await h.call('session',{handle:login.session});assert.equal(response.status,200);
  assert.equal((await response.json()).access_token,'google-access');assert.equal(h.calls,1);
});
test('expired access token renews using server refresh credentials',async()=>{
  const h=harness({expiring:true});const login=await(await h.call('exchange')).json();
  assert.equal((await h.call('session',{handle:login.session})).status,200);
  assert.deepEqual(h.grants,['authorization_code','refresh_token']);
});
test('sign out invalidates stored session',async()=>{
  const h=harness();const login=await(await h.call('exchange')).json();
  assert.equal((await h.call('logout',{handle:login.session})).status,200);
  assert.equal((await h.call('session',{handle:login.session})).status,401);
});
test('revoked Google consent removes session instead of retrying refresh indefinitely',async()=>{
  const h=harness({expiring:true,revoked:true});const login=await(await h.call('exchange')).json();
  assert.equal((await h.call('session',{handle:login.session})).status,401);
  assert.equal(h.objects.size,0);
});
test('other origins and missing CSRF header never reach Google',async()=>{
  const h=harness();assert.equal((await h.call('exchange',{requestOrigin:'https://evil.example'})).status,403);
  assert.equal((await h.call('exchange',{headers:false})).status,403);assert.equal(h.calls,0);
});
test('unknown session cannot access credentials',async()=>{
  const h=harness();assert.equal((await h.call('session',{handle:'x'.repeat(43)})).status,401);
});
test('missing client secret keeps persistent auth disabled without affecting other routes',async()=>{
  const h=harness();delete h.env.GOOGLE_CLIENT_SECRET;
  const result=await(await h.call('config',{method:'GET'})).json();assert.equal(result.persistentSessions,false);
  assert.equal((await h.call('exchange')).status,503);assert.equal(h.calls,0);
  const {handleTaskflowAuth}=await modulePromise;
  assert.equal(await handleTaskflowAuth(new Request('https://api.pinplay.win/health'),h.env),null);
});
test('missing Tasks permission never saves a persistent session',async()=>{
  const h=harness({denied:true});assert.equal((await h.call('exchange')).status,403);assert.equal(h.objects.size,0);
});
