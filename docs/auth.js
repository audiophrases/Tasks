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
  try {
    const session = JSON.parse(localStorage.getItem('pinplay.student.v1') || 'null');
    return Number(session?.expiresAt) > Date.now() ? session.student?.email || '' : '';
  } catch { return ''; }
}

async function useLocalWorkspace() {
  try { await forgetGoogleSession(); }
  catch { notify('Signed out on this browser. The server connection could not be removed; it will expire automatically.'); }
  token = null;
  expires = 0;
  clearInterval(refreshTimer);
  data = local;
  list = data.lists[0].id;
  selected = null;
  $('#modal').close();
  render();
}

async function connection() {
  modal(`<span class="eyebrow">YOUR EXISTING GOOGLE CONNECTION</span><h2>${token ? 'Google Tasks connection' : 'Continue with Google'}</h2><p>Uses the same Google sign-in configuration as Pinplay. Choose your account and allow access to your tasks.</p><p>Your Google lists stay in sync across devices. Local tasks stay separate.</p><button id="authorize" class="primary" disabled>Preparing sign-in…</button>${token ? '<button id="disconnect" class="subtle">Switch to local workspace</button>' : ''}<p id="autherror" role="alert"></p><details><summary>If Google asks for additional setup</summary><p>Taskflow uses Pinplay’s existing Google client. Google Tasks is an additional permission: the Tasks API must be enabled in that same Google Cloud project, and testing apps must include your account as a test user. You do not need to create another OAuth client.</p></details>`);
  const button = $('#authorize'), error = $('#autherror');
  if (token) $('#disconnect').onclick = useLocalWorkspace;
  try {
    const [config, persistence] = await Promise.all([fetchPinplayConfig(), persistentSessionConfig(), loadGoogleIdentityScript()]);
    if (!button.isConnected) return;
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
        if (!persistence.persistentSessions && (!response.access_token || !window.google.accounts.oauth2.hasGrantedAllScopes(response, TASKS_SCOPE))) {
          error.textContent = 'Google Tasks permission was not granted. Continue again and allow access to your tasks.';
          return;
        }
        if (persistence.persistentSessions) {
          try { if (!await exchangeGoogleCode(response.code)) return; }
          catch (failure) { error.textContent = failure.message; return; }
        } else token = response.access_token;
        if (!persistence.persistentSessions) expires = Date.now() + Number(response.expires_in) * 1000;
        clearInterval(refreshTimer);
        // Keep local tasks visible until the first authenticated Google read succeeds.
        try {
          busy = true;
          document.body.classList.add('busy');
          await reload();
          $('#modal').close();
          notify('Google Tasks connected. Your lists are ready.');
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
    const client = persistence.persistentSessions
      ? window.google.accounts.oauth2.initCodeClient({...options, ux_mode:'popup'})
      : window.google.accounts.oauth2.initTokenClient(options);
    button.disabled = false;
    button.textContent = token ? 'Reconnect with Google' : 'Continue with Google';
    button.onclick = () => {
      error.textContent = '';
      button.disabled = true;
      // Keep this synchronous with the click so the browser permits Google's popup.
      try { if (persistence.persistentSessions) client.requestCode(); else client.requestAccessToken({prompt: hint ? '' : 'select_account'}); }
      catch (failure) { button.disabled = false; error.textContent = failure.message; }
    };
  } catch (failure) {
    error.textContent = failure.message;
    button.disabled = false;
    button.textContent = 'Retry sign-in';
    button.onclick = connection;
  }
}
