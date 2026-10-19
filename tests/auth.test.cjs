const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function harness(options = {}) {
  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, {isConnected:true,textContent:'',disabled:false,insertAdjacentHTML(){},close(){this.closed=true;}});
    return elements.get(selector);
  };
  let config, request, reads=0, fetches=0;
  const oauth2 = {
    initTokenClient(value){config=value;return {requestAccessToken(value){request=value;}};},
    initCodeClient(value){config=value;return {requestCode(){request={code:true};}};},
    hasGrantedAllScopes(){return options.granted !== false;},
  };
  const context = {
    $, modal(){}, notify(){}, render(){},syncPending:()=>false,
    window:{google:{accounts:{oauth2}}},
    fetch:async () => {fetches++;return {ok:true,json:async()=>({loginEnabled:true,googleClientId:'pinplay.apps.googleusercontent.com'})};},
    AbortSignal, setTimeout,clearTimeout,setInterval(){return 1;},clearInterval(){},
    localStorage:{getItem(){return JSON.stringify({expiresAt:Date.now()+10000,student:{email:'me@example.com'},studentToken:'never-forward-this'});}},
    document:{body:{classList:{add(){},remove(){}}}},
    token:null,expires:0,refreshTimer:null,busy:false,
    reload:async()=>{reads++;if(options.readFailure)throw Error('Google Tasks API is disabled');},
    persistentSessionConfig:async()=>({persistentSessions:options.persistent||false}),
    exchangeGoogleCode:async code=>{if(code!=='one-time-code')throw Error('Missing code');context.token='renewable-access';context.expires=Date.now()+3600000;return true;},
    startGoogleRefresh(){},
    rememberChoice:()=>options.remember ?? Boolean(options.persistent),
    saveRememberChoice(){},rememberBrowserSession(){},forgetGoogleSession:async()=>{},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('docs/auth.js','utf8'),context);
  return {context,$,get config(){return config;},get request(){return request;},get reads(){return reads;},get fetches(){return fetches;}};
}

test('uses Pinplay client and personal account hint; OAuth starts only after click',async()=>{
  const h=harness();await h.context.connection();
  assert.equal(h.config.client_id,'pinplay.apps.googleusercontent.com');
  assert.equal(h.config.scope,'https://www.googleapis.com/auth/tasks');
  assert.equal(h.config.hint,'eugenime@gmail.com');
  assert.equal(JSON.stringify(h.config).includes('never-forward-this'),false);
  assert.equal(h.request,undefined);
  h.$('#authorize').onclick();assert.equal(h.request.prompt,'');
});
test('denied Tasks permission never loads tasks or keeps a token',async()=>{
  const h=harness({granted:false});await h.context.connection();
  await h.config.callback({access_token:'denied',expires_in:3600});
  assert.equal(h.reads,0);assert.equal(h.context.token,null);
  assert.match(h.$('#autherror').textContent,/not granted/);
});
test('successful authorization loads tasks and closes connection dialog',async()=>{
  const h=harness();await h.context.connection();
  await h.config.callback({access_token:'approved',expires_in:3600});
  assert.equal(h.reads,1);assert.equal(h.context.token,'approved');
  assert.equal(h.$('#modal').closed,true);
});
test('failed initial Google read keeps dialog open and resets connection',async()=>{
  const h=harness({readFailure:true});await h.context.connection();
  await h.config.callback({access_token:'approved',expires_in:3600});
  assert.equal(h.context.token,null);assert.equal(h.context.busy,false);
  assert.match(h.$('#autherror').textContent,/API is disabled/);
  assert.equal(h.$('#modal').closed,undefined);
});
test('closed popup permits retry without fetching tasks',async()=>{
  const h=harness();await h.context.connection();h.$('#authorize').onclick();
  h.config.error_callback({type:'popup_closed'});
  assert.equal(h.$('#authorize').disabled,false);assert.equal(h.reads,0);
});
test('configured persistent login uses code flow and loads lists after server exchange',async()=>{
  const h=harness({persistent:true});await h.context.connection();
  h.$('#authorize').onclick();assert.equal(h.request.code,true);
  await h.config.callback({code:'one-time-code'});
  assert.equal(h.context.token,'renewable-access');assert.equal(h.reads,1);
  assert.equal(h.$('#modal').closed,true);
});
test('Remember me is optional even when long-lived sessions are configured',async()=>{
  const h=harness({persistent:true,remember:false});await h.context.connection();
  assert.equal(h.$('#rememberme').checked,false);
  h.$('#authorize').onclick();assert.equal(h.request.code,undefined);
  await h.config.callback({access_token:'current-tab',expires_in:3600});
  assert.equal(h.context.token,'current-tab');
});

test('sign out waits for pending background writes instead of losing them',async()=>{
  const h=harness();h.context.token='access';h.context.syncPending=()=>true;
  let logouts=0;h.context.forgetGoogleSession=async()=>logouts++;
  await h.context.signOut();assert.equal(logouts,0);assert.equal(h.context.token,'access');
});

test('reconnection cannot send a pending outbox to a different Google account',async()=>{
  const h=harness();h.context.syncPending=()=>true;h.context.syncScope='original-list';
  h.context.all=async()=>[{id:'another-account-list'}];
  await h.context.connection();await h.config.callback({access_token:'wrong-account',expires_in:3600});
  assert.equal(h.reads,0);assert.equal(h.context.token,null);
  assert.match(h.$('#autherror').textContent,/account with your pending changes/);
});
