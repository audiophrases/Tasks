// Reuses Pinplay's public Google client configuration and Google Identity Services.
// Pinplay's student JWT is identity-only; it must never be sent to Google Tasks.
const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';
let pinplayConfigPromise, googleScriptPromise;

function fetchPinplayConfig() {
  if (!pinplayConfigPromise) {
    pinplayConfigPromise = fetch('https://api.pinplay.win/api/student/config', {
      credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(12000),
    }).then(async response => {
      if (!response.ok) throw Error('Pinplay sign-in configuration is unavailable. Try again.');
      const config = await response.json();
      if (!config.loginEnabled || !config.googleClientId?.endsWith('.apps.googleusercontent.com')) {
        throw Error('Google sign-in is not configured in Pinplay.');
      }
      return config;
    }).catch(error => { pinplayConfigPromise = null; throw error; });
  }
  return pinplayConfigPromise;
}

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!googleScriptPromise) {
    googleScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      const timer = setTimeout(() => reject(Error('Google sign-in took too long to load. Check your connection and retry.')), 12000);
      script.onload = () => {
        clearTimeout(timer);
        window.google?.accounts?.oauth2 ? resolve() : reject(Error('Google sign-in could not load.'));
      };
      script.onerror = () => { clearTimeout(timer); reject(Error('Google sign-in could not load. Check your connection and retry.')); };
      document.head.appendChild(script);
    }).catch(error => { googleScriptPromise = null; throw error; });
  }
  return googleScriptPromise;
}

function pinplayAccountHint() {
  return 'eugenime@gmail.com';
}

async function signOut() {
  if(syncPending()){notify('Finish syncing your pending changes before signing out.');return;}
  try { await forgetGoogleSession(); }
  catch { notify('Signed out on this browser. The server connection could not be removed; it will expire automatically.'); }
  token = null;
  expires = 0;
  clearInterval(refreshTimer);
  data = {lists:[],tasks:{}};
  list = null;
  selected = null;
  $('#modal').close();
  render();
  await connection();
}

async function connection() {
  modal(`<span class="eyebrow">YOUR EXISTING GOOGLE CONNECTION</span><h2>${token ? 'Google Tasks connection' : 'Continue with Google'}</h2><p>Uses the same Google sign-in configuration as Pinplay. Choose your account and allow access to your tasks.</p><p>Sign in to view and manage your Google Tasks across devices.</p><button id="authorize" class="primary" disabled>Preparing sign-in…</button>${token ? '<button id="disconnect" class="subtle">Sign out</button>' : ''}<p id="autherror" role="alert"></p><details><summary>If Google asks for additional setup</summary><p>Taskflow uses Pinplay’s existing Google client. Google Tasks is an additional permission: the Tasks API must be enabled in that same Google Cloud project, and testing apps must include your account as a test user. You do not need to create another OAuth client.</p></details>`);
  const button = $('#authorize'), error = $('#autherror');
  button.insertAdjacentHTML('beforebegin', '<label class="remember-option"><input type="checkbox" id="rememberme"> Remember me on this device</label><p id="rememberhint" class="remember-hint">Remembers your current Google session until it expires.</p>');
  const remember = $('#rememberme');
  remember.checked = rememberChoice();
  if (token) $('#disconnect').onclick = signOut;
  try {
    const [config, persistence] = await Promise.all([fetchPinplayConfig(), persistentSessionConfig(), loadGoogleIdentityScript()]);
    if (!button.isConnected) return;
    $('#rememberhint').textContent = persistence.persistentSessions
      ? 'Stay signed in when you return. You can sign out at any time.'
      : 'Remembers this Google session across visits, usually for up to an hour.';
    let usePersistence = false;
    const hint = pinplayAccountHint();
    const options = {
      client_id: config.googleClientId,
      scope: TASKS_SCOPE,
      include_granted_scopes: true,
      ...(hint ? {hint} : {}),
      error_callback: response => {
        button.disabled = false;
        error.textContent = response.type === 'popup_closed' ? 'Sign-in was closed. You can try again.' : 'Google could not open sign-in. Allow popups for this site and try again.';
      },
      callback: async response => {
        button.disabled = false;
        if (response.error) {
          error.textContent = response.error_description || response.error;
          return;
        }
        if (!usePersistence && (!response.access_token || !window.google.accounts.oauth2.hasGrantedAllScopes(response, TASKS_SCOPE))) {
          error.textContent = 'Google Tasks permission was not granted. Continue again and allow access to your tasks.';
          return;
        }
        if (usePersistence) {
          try { if (!await exchangeGoogleCode(response.code)) return; }
          catch (failure) { error.textContent = failure.message; return; }
        } else {
          try { await forgetGoogleSession(); } catch {}
          token = response.access_token;
          expires = Date.now() + Number(response.expires_in) * 1000;
        }
        clearInterval(refreshTimer);
        // Only show Google tasks after the first authenticated read succeeds.
        try {
          busy = true;
          document.body.classList.add('busy');
          if(syncPending()){
            const lists=await all('/users/@me/lists');
            if(!lists.some(item=>item.id===syncScope))throw Error('Reconnect the Google account with your pending changes.');
          }
          await reload();
          rememberBrowserSession(remember.checked && !usePersistence);
          $('#modal').close();
          render();
          notify(syncPending()?'Reconnected. Use Retry sync to send your pending changes.':'Google Tasks connected. Your lists are ready.');
          startGoogleRefresh();
        } catch (failure) {
          token = null;
          expires = 0;
          error.textContent = failure.message;
          render();
        } finally {
          busy = false;
          document.body.classList.remove('busy');
        }
      },
    };
    const tokenClient = window.google.accounts.oauth2.initTokenClient(options);
    const codeClient = persistence.persistentSessions ? window.google.accounts.oauth2.initCodeClient({...options, ux_mode:'popup'}) : null;
    button.disabled = false;
    button.textContent = token ? 'Reconnect with Google' : 'Continue with Google';
    button.onclick = () => {
      error.textContent = '';
      usePersistence = Boolean(persistence.persistentSessions && remember.checked);
      saveRememberChoice(remember.checked);
      button.disabled = true;
      // Keep this synchronous with the click so the browser permits Google's popup.
      try { if (usePersistence) codeClient.requestCode(); else tokenClient.requestAccessToken({prompt: hint ? '' : 'select_account'}); }
      catch (failure) { button.disabled = false; error.textContent = failure.message; }
    };
  } catch (failure) {
    error.textContent = failure.message;
    button.disabled = false;
    button.textContent = 'Retry sign-in';
    button.onclick = connection;
  }
}
