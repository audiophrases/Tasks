# Taskflow

A small Google Tasks client with keyboard shortcuts, subtasks and drag reordering.

Open https://audiophrases.github.io/Tasks/ and choose **Connect Google Tasks**, then **Continue with Google**.

## Google sign-in

Taskflow reuses Pinplay's public client configuration from `https://api.pinplay.win/api/student/config` and the same Google Identity Services library. Both apps are served from `https://audiophrases.github.io`, so they share an authorized JavaScript origin. No client ID entry or new OAuth client is needed.

Pinplay's student session authenticates only to Pinplay. Taskflow requests the additional `https://www.googleapis.com/auth/tasks` permission through Google's OAuth popup. If a valid Pinplay session exists on this origin, its email is used as an optional account hint; its student token is never used or transmitted. Pinplay's school roster does not control access to personal Google Tasks.

The Google Tasks API must be enabled in the existing client’s Google Cloud project. An app in testing may require your account to be added as a test user. Google consent cannot be skipped by reusing Pinplay's identity token.

The sign-in dialog has an optional **Remember me on this device** checkbox. Without the refresh backend, it saves your current Google access token in this browser only until Google's expiry (usually about an hour); it cannot extend that expiry. When unchecked, access tokens stay in memory. With the refresh backend configured, Remember me saves only a revocable session handle and restores/renews access automatically. Connected lists refresh every minute while the tab is visible, on return to the tab, and via Refresh. Local demo tasks remain separate and save only in this browser.

## Persistent sign-in setup

The isolated `/api/taskflow/` routes run on the existing `pinplay-api` Worker. `server/taskflow-auth.mjs` is the canonical source, installed as `pinplay/cloudflare/taskflow-auth.mjs`, with an early route in that Worker's fetch handler. Pinplay student sign-in continues to use its existing routes.

To activate persistence, add the existing Google Web OAuth client's **client secret** as a Cloudflare Worker Secret named `GOOGLE_CLIENT_SECRET` on `pinplay-api`. Find it under Google Auth Platform → Clients → the same Web client already used by Pinplay. Do not put the value in source, browser code, or chat. Existing `GOOGLE_CLIENT_ID`, `STUDENT_SESSION_KEY`, and `QUIZ_MEDIA` bindings are reused.

After adding the secret, refresh Taskflow and connect once more. Google authorization-code popup mode supplies a refresh token to the server. No additional redirect endpoint is needed; the code exchange uses the existing authorized JavaScript origin `https://audiophrases.github.io`.

Refresh/access credentials are encrypted with an application-specific HKDF-derived AES-GCM key and saved under the private `__taskflow_sessions_v1__/` R2 prefix. The browser saves only a random revocable session handle. Sessions have a 90-day maximum lifetime; invalid/revoked/expired sessions require reconnecting. Google apps still in Testing can have shorter provider-imposed refresh-token lifetimes. Configure an R2 lifecycle rule scoped to this prefix to purge records after 90 days. Signing out removes the browser handle and deletes its server record without revoking the shared Pinplay Google grant.

Until the secret is configured, the existing short-lived browser token flow remains available; it does not provide persistence. Runtime `/api/taskflow/config` reports `persistentSessions: true` only when the required server bindings exist. Real Google code exchange and refresh still require an account-authorized live check after setup.

## Hosting and source

GitHub Pages publishes `docs/` from `main`. Edit these files for future GitHub Pages updates. No build step or backend is required. Pinplay's repository and backend are unchanged.

The ignored local `taskflow/` checkout and deployment archive predate the GitHub Pages version; `docs/` is the source for the current app.

## Checks

Run `node --check docs/app.js`, `node --check docs/auth.js`, and `node --test tests/auth.test.cjs`.

Run the full regression suite with `node --test tests/*.test.cjs`.

Task text size can be adjusted with the +/− controls above the list. The choice is saved in this browser. Cleared Google tasks are excluded from insertion and movement references; move arrows follow visible tasks.

## Shortcuts

- Enter: add next task
- Ctrl/Cmd + Enter: add subtask
- Tab / Shift + Tab at the start of a task title: indent / outdent
- Alt + Up / Down: reorder
- Alt + Enter (or Ctrl/Cmd + Shift + Enter): complete / reopen the focused task
- Ctrl/Cmd + C with no text highlighted: copy the whole focused task title; highlighted text copies normally
- Each task also has a Copy text button
- N: focus new task field when not editing
- ?: show shortcuts

Google authorization and live writes must be verified by signing in as the intended user.
