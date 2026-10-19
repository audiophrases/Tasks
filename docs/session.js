const SESSION_API = 'https://api.pinplay.win/api/taskflow';
const SESSION_KEY = 'taskflow-google-session-v1';
const BROWSER_SESSION_KEY = 'taskflow-browser-session-v1';
const REMEMBER_KEY = 'taskflow-remember-me';
let sessionRenewal = null, sessionGeneration = 0;

function rememberChoice() {
  try { return localStorage.getItem(REMEMBER_KEY) === '1'; } catch { return false; }
}

function saveRememberChoice(enabled) {
  try { localStorage.setItem(REMEMBER_KEY, enabled ? '1' : '0'); } catch {}
}

function rememberedBrowserSession() {
  try {
    const value = JSON.parse(localStorage.getItem(BROWSER_SESSION_KEY) || 'null');
    if (typeof value?.accessToken === 'string' && value.accessToken && Number.isFinite(value.expiresAt) && value.expiresAt > Date.now()) return value;
    localStorage.removeItem(BROWSER_SESSION_KEY);
  } catch {}
  return null;
}

function forgetBrowserSession() {
  try { localStorage.removeItem(BROWSER_SESSION_KEY); } catch {}
}

function rememberBrowserSession(enabled) {
  forgetBrowserSession();
  if (!enabled || !token || expires <= Date.now()) return;
  try {
    // Only with the user's Remember me choice, and only until Google's expiry.
    // This cache cannot renew or extend a Google access token.
    localStorage.setItem(BROWSER_SESSION_KEY, JSON.stringify({accessToken:token, expiresAt:expires}));
  } catch { notify('This browser could not save your session. You can still use Tasks in this tab.'); }
}

function savedGoogleSession() {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (/^[A-Za-z0-9_-]{43}$/.test(value?.handle) && Number(value.expiresAt) > Date.now()) return value;
    if (value) localStorage.removeItem(SESSION_KEY);
  } catch {}
  return null;
}

async function sessionRequest(path, {handle, body} = {}) {
  const response = await fetch(SESSION_API + path, {
    method:'POST',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(20000),
    headers:{'Content-Type':'application/json','X-Taskflow-Request':'1',...(handle ? {Authorization:'Bearer '+handle} : {})},
    body:JSON.stringify(body || {}),
  });
  const result=await response.json();
  if(!response.ok)throw Object.assign(new Error(result.error||'Could not restore Google Tasks.'),{status:response.status});
  return result;
}

async function persistentSessionConfig() {
  try {
    const response=await fetch(SESSION_API+'/config',{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(response.ok)return await response.json();
  } catch {}
  return {persistentSessions:false};
}

function applySessionToken(result) {
  if(typeof result.access_token!=='string'||!Number.isFinite(result.expires_at)||result.expires_at<=Date.now())throw Error('Google returned an invalid session. Connect again.');
  token=result.access_token;
  expires=result.expires_at;
}

async function exchangeGoogleCode(code) {
  const generation=sessionGeneration;
  const result=await sessionRequest('/exchange',{body:{code}});
  if(generation!==sessionGeneration)return false;
  if(!/^[A-Za-z0-9_-]{43}$/.test(result.session)||!Number.isFinite(result.session_expires_at))throw Error('Could not save your connection. Please try again.');
  try {
    // Only our revocable session handle is stored, never Google access/refresh tokens.
    localStorage.setItem(SESSION_KEY,JSON.stringify({handle:result.session,expiresAt:result.session_expires_at}));
  } catch {
    await sessionRequest('/logout',{handle:result.session}).catch(()=>{});
    throw Error('Allow site storage in this browser to stay signed in.');
  }
  applySessionToken(result);
  return true;
}

async function ensureGoogleSession() {
  if(token&&Date.now()+90000<expires)return;
  const saved=savedGoogleSession();
  if(!saved) {
    if(token&&Date.now()<expires)return;
    throw Error('Your Google session expired. Connect again to continue.');
  }
  if(!sessionRenewal) {
    const generation=sessionGeneration;
    sessionRenewal=(async()=>{
      try {
        const result=await sessionRequest('/session',{handle:saved.handle});
        if(generation!==sessionGeneration)throw Error('You have signed out.');
        applySessionToken(result);
      } catch(error) {
        if(error.status===401&&generation===sessionGeneration) {
          localStorage.removeItem(SESSION_KEY);token=null;expires=0;
        }
        throw error;
      } finally { sessionRenewal=null; }
    })();
  }
  await sessionRenewal;
}

function startGoogleRefresh() {
  clearInterval(refreshTimer);
  refreshTimer=setInterval(()=>{
    if(!busy&&document.visibilityState==='visible'&&(savedGoogleSession()||Date.now()<expires))run(reload);
  },60000);
}

async function forgetGoogleSession() {
  const saved=savedGoogleSession();
  sessionGeneration++;
  forgetBrowserSession();
  localStorage.removeItem(SESSION_KEY);
  if(saved)await sessionRequest('/logout',{handle:saved.handle});
}

async function restoreGoogleSession() {
  const saved = savedGoogleSession(), cached = rememberedBrowserSession();
  if ((!saved && !cached) || busy) return;
  if (!saved && cached) { token = cached.accessToken; expires = cached.expiresAt; }
  busy=true;
  document.body.classList.add('busy');
  $('#status').textContent='Restoring Google Tasks…';
  try {
    await ensureGoogleSession();
    await reload();
    startGoogleRefresh();
  } catch(error) {
    notify(error.message);
    render();
  } finally {
    busy=false;
    document.body.classList.remove('busy');
  }
}
