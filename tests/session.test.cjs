const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function harness(options={}) {
  const store=new Map(),requests=[];let loads=0;
  const future=Date.now()+86400000;
  if(options.saved!==false)store.set('taskflow-google-session-v1',JSON.stringify({handle:'s'.repeat(43),expiresAt:future}));
  const context={
    AbortSignal,document:{body:{classList:{add(){},remove(){}}}},$(){return {};},
    token:null,expires:0,busy:false,refreshTimer:null,
    localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)},
    fetch:async(url,request)=>{
      requests.push({url,request});
      if(options.failure)return Response.json({error:'Please retry'},{status:options.failure});
      return Response.json({access_token:'new-access',expires_at:Date.now()+3600000,session:'s'.repeat(43),session_expires_at:future});
    },
    reload:async()=>{loads++;},render(){},notify(){},setInterval(){},clearInterval(){},
  };
  vm.createContext(context);vm.runInContext(fs.readFileSync('docs/session.js','utf8'),context);
  return {context,store,requests,get loads(){return loads;}};
}
test('return visit restores lists using saved session, without a Google popup',async()=>{
  const h=harness();await h.context.restoreGoogleSession();
  assert.equal(h.context.token,'new-access');assert.equal(h.loads,1);
  assert.match(h.requests[0].url,/\/session$/);
  assert.equal(h.context.busy,false);
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
