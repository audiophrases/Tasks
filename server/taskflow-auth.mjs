// Installed alongside Pinplay's Worker. All routes are isolated to /api/taskflow/.
// Browser holds an opaque session handle; Google refresh credentials stay encrypted in R2.
const ORIGIN = 'https://audiophrases.github.io';
const SCOPE = 'https://www.googleapis.com/auth/tasks';
const TTL = 90 * 24 * 60 * 60 * 1000;
const PREFIX = '__taskflow_sessions_v1__/';
const encoder = new TextEncoder();

function reply(body, status = 200) {
  return Response.json(body, {status, headers:{
    'Access-Control-Allow-Origin':ORIGIN,
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type,Authorization,X-Taskflow-Request',
    'Cache-Control':'private, no-store',
    'Vary':'Origin',
    'X-Content-Type-Options':'nosniff',
  }});
}
function failure(message, status = 400) { return Object.assign(new Error(message), {status}); }
const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const decode = text => Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')),char=>char.charCodeAt(0));
async function digest(text) { return encode(await crypto.subtle.digest('SHA-256', encoder.encode(text))); }
async function keyFor(env) {
  const material = await crypto.subtle.importKey('raw',encoder.encode(env.STUDENT_SESSION_KEY),'HKDF',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:encoder.encode('taskflow-session-v1'),info:encoder.encode('refresh-token-storage')},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function seal(env, record, storageKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(storageKey)},await keyFor(env),encoder.encode(JSON.stringify(record)));
  return JSON.stringify({iv:encode(iv),data:encode(encrypted)});
}
async function unseal(env, value, storageKey) {
  const envelope = JSON.parse(value);
  const bytes = await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(envelope.iv),additionalData:encoder.encode(storageKey)},await keyFor(env),decode(envelope.data));
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function bodyOf(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw failure('JSON required.',415);
  const reader = request.body?.getReader();
  if (!reader) throw failure('Missing request body.');
  const chunks=[];let size=0;
  while(true) {
    const {done,value}=await reader.read();if(done)break;
    size+=value.length;
    if(size>8192){await reader.cancel();throw failure('Request too large.',413);}
    chunks.push(value);
  }
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw failure('Invalid JSON.'); }
}
async function googleTokens(env, params, fetcher) {
  const response = await fetcher('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,...params}),
    signal:AbortSignal.timeout(15000),
  });
  const result=await response.json();
  if(!response.ok) {
    if(result.error==='invalid_grant')throw failure('Your Google connection expired or was revoked. Connect again.',401);
    throw failure('Google could not renew the connection. Please try again later.',502);
  }
  if(!result.access_token||!Number.isFinite(Number(result.expires_in))||Number(result.expires_in)<=0)throw failure('Google returned an incomplete session.',502);
  return result;
}
function sessionId(request) {
  const value = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if(!value)throw failure('Connect Google Tasks again.',401);
  return value;
}
function tokenResponse(record) { return {access_token:record.accessToken,expires_at:record.accessExpiresAt,session_expires_at:record.expiresAt}; }
async function save(env, storageKey, record, etag) {
  const stored = await env.QUIZ_MEDIA.put(storageKey,await seal(env,record,storageKey),{
    httpMetadata:{contentType:'application/json',cacheControl:'private, no-store'},
    ...(etag ? {onlyIf:{etagMatches:etag}} : {}),
  });
  if(!stored)throw failure('The saved session changed. Please try again.',409);
}

export async function handleTaskflowAuth(request, env, fetcher = fetch) {
  const path = new URL(request.url).pathname;
  if(!path.startsWith('/api/taskflow/'))return null;
  const origin=request.headers.get('Origin');
  // Same origin as Pages, explicitly checked for all session reads and writes.
  if(origin!==ORIGIN)return reply({error:'Origin not allowed.'},403);
  if(request.method==='OPTIONS')return reply({ok:true});
  const enabled=Boolean(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.STUDENT_SESSION_KEY&&env.QUIZ_MEDIA);
  if(path==='/api/taskflow/config'&&request.method==='GET')return reply({persistentSessions:enabled});
  if(!enabled)return reply({error:'Persistent sign-in requires the GOOGLE_CLIENT_SECRET server secret.',code:'setup_required'},503);
  if(request.method!=='POST')return reply({error:'Method not allowed.'},405);
  if(request.headers.get('X-Taskflow-Request')!=='1')return reply({error:'Missing request verification header.'},403);
  try {
    if(env.AUTH_RL) {
      const limit=await env.AUTH_RL.limit({key:'taskflow:'+request.headers.get('CF-Connecting-IP')});
      if(!limit.success)return reply({error:'Too many connection attempts. Try again shortly.'},429);
    }
    if(path==='/api/taskflow/exchange') {
      const body=await bodyOf(request);
      if(typeof body.code!=='string'||!body.code||body.code.length>4096)throw failure('Missing authorization code.');
      const tokens=await googleTokens(env,{code:body.code,grant_type:'authorization_code',redirect_uri:ORIGIN},fetcher);
      if(!tokens.scope?.split(' ').includes(SCOPE))throw failure('Google Tasks permission was not granted.',403);
      if(!tokens.refresh_token)throw failure('Google did not grant offline access. Connect again and approve the requested permission.');
      const handle=encode(crypto.getRandomValues(new Uint8Array(32)));
      const storageKey=PREFIX+await digest(handle);
      const record={refreshToken:tokens.refresh_token,accessToken:tokens.access_token,accessExpiresAt:Date.now()+Number(tokens.expires_in)*1000,expiresAt:Date.now()+TTL};
      await save(env,storageKey,record);
      return reply({...tokenResponse(record),session:handle});
    }
    if(!['/api/taskflow/session','/api/taskflow/logout'].includes(path))throw failure('Not found.',404);
    const storageKey=PREFIX+await digest(sessionId(request));
    if(path==='/api/taskflow/logout') {
      await env.QUIZ_MEDIA.delete(storageKey);
      return reply({ok:true});
    }
    const object=await env.QUIZ_MEDIA.get(storageKey);
    if(!object)throw failure('Your saved connection is no longer available. Connect again.',401);
    const record=await unseal(env,await object.text(),storageKey);
    if(record.expiresAt<=Date.now()) {
      await env.QUIZ_MEDIA.delete(storageKey);
      throw failure('Your saved connection expired. Connect again.',401);
    }
    if(record.accessExpiresAt<=Date.now()+90000) {
      let tokens;
      try { tokens=await googleTokens(env,{refresh_token:record.refreshToken,grant_type:'refresh_token'},fetcher); }
      catch(error) { if(error.status===401)await env.QUIZ_MEDIA.delete(storageKey);throw error; }
      record.accessToken=tokens.access_token;
      record.accessExpiresAt=Date.now()+Number(tokens.expires_in)*1000;
      if(tokens.refresh_token)record.refreshToken=tokens.refresh_token;
      await save(env,storageKey,record,object.etag);
    }
    return reply(tokenResponse(record));
  } catch(error) {
    return reply({error:error.status?error.message:'Unable to restore your Google connection. Try again later.'},error.status||500);
  }
}
