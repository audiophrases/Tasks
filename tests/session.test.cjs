const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function harness(options={}) {
  const store=new Map(),requests=[],timers=new Map(),elements=new Map();let loads=0,timerId=0;
  const future=Date.now()+86400000;
  if(options.saved!==false)store.set('taskflow-google-session-v1',JSON.stringify({handle:'s'.repeat(43),expiresAt:future}));
  const context={
    AbortSignal,document:{visibilityState:'visible',body:{classList:{add(){},remove(){}}}},
    $(selector){if(!elements.has(selector))elements.set(selector,{});return elements.get(selector);},
    token:null,expires:0,busy:false,refreshTimer:null,
    restoreTaskCache:()=>Boolean(options.cached),saveTaskCache(){},clearTaskCache(){},
    focusTaskList(){context.focused=true;},backgroundRefresh:async()=>{loads++;},
    localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)},
    fetch:async(url,request)=>{
      requests.push({url,request});
      if(options.failure)return Response.json({error:'Please retry'},{status:options.failure});
      return Response.json({access_token:'new-access',expires_at:Date.now()+3600000,session:'s'.repeat(43),session_expires_at:future});
    },
    reload:async()=>{loads++;},render(){},notify(){},connection:async()=>{context.prompts=(context.prompts||0)+1;},
    setInterval(fn){const id=++timerId;timers.set(id,fn);return id;},clearInterval(id){timers.delete(id);},
  };
  vm.createContext(context);vm.runInContext(fs.readFileSync('docs/session.js','utf8'),context);
  return {context,store,requests,timers,get loads(){return loads;}};
}
test('return visit restores lists using saved session, without a Google popup',async()=>{
  const h=harness();await h.context.restoreGoogleSession();
  assert.equal(h.context.token,'new-access');assert.equal(h.loads,1);
  assert.match(h.requests[0].url,/\/session$/);
  assert.equal(h.context.busy,false);
});

test('a cached workspace becomes usable while Google refreshes in the background',async()=>{
  const h=harness({cached:true});
  let refreshing=false;
  h.context.backgroundRefresh=()=>{refreshing=true;return new Promise(()=>{});};
  await h.context.restoreGoogleSession();
  assert.equal(h.context.busy,false);assert.equal(h.context.focused,true);
  assert.equal(refreshing,true);assert.equal(h.loads,0);
});
test('concurrent task requests share one session renewal',async()=>{
  const h=harness();await Promise.all([h.context.ensureGoogleSession(),h.context.ensureGoogleSession()]);
  assert.equal(h.requests.length,1);
});
test('revoked session is forgotten while temporary network errors preserve it',async()=>{
  const expired=harness({failure:401});await assert.rejects(expired.context.ensureGoogleSession());
  assert.equal(expired.store.size,0);
  const offline=harness({failure:503});await assert.rejects(offline.context.ensureGoogleSession());
  assert.equal(offline.store.size,1);
});
test('successful code exchange persists only the opaque handle, never Google tokens',async()=>{
  const h=harness({saved:false});await h.context.exchangeGoogleCode('single-use-code');
  const saved=h.store.get('taskflow-google-session-v1');
  assert.equal(saved.includes('new-access'),false);assert.equal(JSON.parse(saved).handle,'s'.repeat(43));
  assert.equal(h.context.token,'new-access');
});
test('sign out clears saved handle and asks server to invalidate it',async()=>{
  const h=harness();await h.context.forgetGoogleSession();assert.equal(h.store.size,0);
  assert.match(h.requests[0].url,/\/logout$/);
});
test('no saved connection leaves local workspace alone',async()=>{
  const h=harness({saved:false});await h.context.restoreGoogleSession();
  assert.equal(h.requests.length,0);assert.equal(h.loads,0);
});
test('Remember me restores an unexpired browser Google session without a popup or backend request',async()=>{
  const h=harness({saved:false});
  h.store.set('taskflow-browser-session-v1',JSON.stringify({accessToken:'remembered-access',expiresAt:Date.now()+3600000}));
  await h.context.restoreGoogleSession();
  assert.equal(h.context.token,'remembered-access');assert.equal(h.loads,1);assert.equal(h.requests.length,0);
});
test('expired browser sessions are discarded and never presented as signed in',async()=>{
  const h=harness({saved:false});
  h.store.set('taskflow-browser-session-v1',JSON.stringify({accessToken:'expired',expiresAt:Date.now()-1000}));
  await h.context.restoreGoogleSession();
  assert.equal(h.context.token,null);assert.equal(h.loads,0);assert.equal(h.store.size,0);
});
test('Remember me cache keeps the actual Google expiry and sign out removes it',async()=>{
  const h=harness({saved:false});h.context.token='current';h.context.expires=Date.now()+5000;
  h.context.rememberBrowserSession(true);
  assert.equal(JSON.parse(h.store.get('taskflow-browser-session-v1')).expiresAt,h.context.expires);
  await h.context.forgetGoogleSession();assert.equal(h.store.size,0);
});
test('unchecked Remember me never stores a browser token',()=>{
  const h=harness({saved:false});h.context.token='current';h.context.expires=Date.now()+3600000;
  h.context.rememberBrowserSession(false);assert.equal(h.store.size,0);
});

test('session renewal persists the later expiry without losing workspace cache ownership',async()=>{
  const h=harness();
  const saved=JSON.parse(h.store.get('taskflow-google-session-v1'));
  const renewedExpiry=Date.now()+90*86400000;
  h.store.set('taskflow-google-session-v1',JSON.stringify({...saved,cacheOwner:'my-workspace'}));
  h.context.fetch=async()=>Response.json({access_token:'renewed',expires_at:Date.now()+3600000,session_expires_at:renewedExpiry});
  await h.context.ensureGoogleSession();
  assert.deepEqual(JSON.parse(h.store.get('taskflow-google-session-v1')),{...saved,expiresAt:renewedExpiry,cacheOwner:'my-workspace'});
  assert.equal(h.context.token,'renewed');
});

test('a temporary startup failure keeps the session and retries without a login popup',async()=>{
  const options={failure:503},h=harness(options);
  assert.equal(await h.context.restoreGoogleSession(),true);
  assert.equal(h.context.token,null);assert.equal(h.store.size,1);assert.equal(h.timers.size,1);
  assert.match(h.context.$('#status').textContent,/retrying automatically/);
  delete options.failure;
  [...h.timers.values()][0]();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.context.token,'new-access');assert.equal(h.loads,1);
  assert.equal(h.context.prompts,undefined);assert.equal(h.timers.size,1);
});

test('a failed task read after restoring a session does not discard its usable access token',async()=>{
  const h=harness();h.context.reload=async()=>{throw Error('Google temporarily unavailable');};
  await h.context.restoreGoogleSession();
  assert.equal(h.context.token,'new-access');assert.equal(h.store.size,1);assert.equal(h.timers.size,1);
});

test('an expired or revoked session still requires a new login',async()=>{
  const h=harness({failure:401});
  await h.context.refreshGoogleConnection();
  assert.equal(h.context.prompts,1);assert.equal(h.context.token,null);
  assert.equal(h.store.size,0);assert.equal(h.timers.size,0);
});

test('sign-out in another tab cannot be undone by an in-flight renewal',async()=>{
  const h=harness();let finish;
  h.context.fetch=()=>new Promise(resolve=>{finish=resolve;});
  const renewal=h.context.ensureGoogleSession();
  h.store.delete('taskflow-google-session-v1');
  finish(Response.json({access_token:'late-access',expires_at:Date.now()+3600000,session_expires_at:Date.now()+90*86400000}));
  await assert.rejects(renewal,/connection changed/);
  assert.equal(h.store.size,0);assert.equal(h.context.token,null);
});

test('a failed older renewal cannot erase a newer connection',async()=>{
  const h=harness();let finish;
  h.context.fetch=()=>new Promise(resolve=>{finish=resolve;});
  const renewal=h.context.ensureGoogleSession();
  const newer={handle:'n'.repeat(43),expiresAt:Date.now()+90*86400000};
  h.store.set('taskflow-google-session-v1',JSON.stringify(newer));
  finish(Response.json({error:'Revoked'},{status:401}));
  await assert.rejects(renewal);
  assert.deepEqual(JSON.parse(h.store.get('taskflow-google-session-v1')),newer);
});

test('an unavailable persistence configuration never silently selects short-lived sign-in',async()=>{
  for(const fetch of [async()=>{throw Error('Offline');},async()=>Response.json({}, {status:503}),async()=>Response.json({})]) {
    const h=harness();h.context.fetch=fetch;
    await assert.rejects(h.context.persistentSessionConfig(),/retry/);
  }
  const h=harness();h.context.fetch=async()=>Response.json({persistentSessions:false});
  assert.equal((await h.context.persistentSessionConfig()).persistentSessions,false);
});
