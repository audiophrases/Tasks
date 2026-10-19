# Taskflow

A small Google Tasks client with keyboard shortcuts, subtasks and drag reordering.

Open https://audiophrases.github.io/Tasks/ and choose **Connect Google Tasks**, then **Continue with Google**.

## Google sign-in

Taskflow reuses Pinplay's public client configuration from `https://api.pinplay.win/api/student/config` and the same Google Identity Services library. Both apps are served from `https://audiophrases.github.io`, so they share an authorized JavaScript origin. No client ID entry or new OAuth client is needed.

Pinplay's student session authenticates only to Pinplay. Taskflow requests the additional `https://www.googleapis.com/auth/tasks` permission through Google's OAuth popup. If a valid Pinplay session exists on this origin, its email is used as an optional account hint; its student token is never used or transmitted. Pinplay's school roster does not control access to personal Google Tasks.

The Google Tasks API must be enabled in the existing client’s Google Cloud project. An app in testing may require your account to be added as a test user. Google consent cannot be skipped by reusing Pinplay's identity token.

Google access tokens remain in memory. Reconnect after reloading or session expiry. Connected lists refresh every minute while the tab is visible, on return to the tab, and via Refresh. Local demo tasks remain separate and save only in this browser.

## Hosting and source

GitHub Pages publishes `docs/` from `main`. Edit these files for future GitHub Pages updates. No build step or backend is required. Pinplay's repository and backend are unchanged.

The ignored local `taskflow/` checkout and deployment archive predate the GitHub Pages version; `docs/` is the source for the current app.

## Checks

Run `node --check docs/app.js`, `node --check docs/auth.js`, and `node --test tests/auth.test.cjs`.

## Shortcuts

- Enter: add next task
- Ctrl/Cmd + Enter: add subtask
- Tab / Shift + Tab at the start of a task title: indent / outdent
- Alt + Up / Down: reorder
- Ctrl/Cmd + Shift + Enter: complete / reopen
- N: focus new task field when not editing
- ?: show shortcuts

Google authorization and live writes must be verified by signing in as the intended user.
