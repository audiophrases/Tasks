# Taskflow

A small Google Tasks client with keyboard shortcuts, subtasks and drag reordering.

Open https://audiophrases.github.io/Tasks/ and choose **Connect Google Tasks**, then **Continue with Google**.

## Google sign-in

Taskflow reuses Pinplay's public client configuration from `https://api.pinplay.win/api/student/config` and the same Google Identity Services library. Both apps are served from `https://audiophrases.github.io`, so they share an authorized JavaScript origin. No client ID entry or new OAuth client is needed.

Pinplay's student session authenticates only to Pinplay. Taskflow requests the additional `https://www.googleapis.com/auth/tasks` permission through Google's OAuth popup. This personal version defaults the Google account hint to `eugenime@gmail.com` and checks Remember me by default; you can still uncheck it. The email is an account hint, not an authentication credential or an access restriction. Pinplay's student token is never used or transmitted, and its school roster does not control access to Google Tasks.

The Google Tasks API must be enabled in the existing client’s Google Cloud project. An app in testing may require your account to be added as a test user. Google consent cannot be skipped by reusing Pinplay's identity token.

The sign-in dialog has an optional **Remember me on this device** checkbox. Without the refresh backend, it saves your current Google access token in this browser only until Google's expiry (usually about an hour); it cannot extend that expiry. When unchecked, access tokens stay in memory. With the refresh backend configured, Remember me saves only a revocable session handle and restores/renews access automatically. Connected lists refresh every minute while the tab is visible, on return to the tab, and via Refresh. Signed-out visitors see the Google sign-in dialog; no demo or local task workspace is shown.

## Persistent sign-in setup

The isolated `/api/taskflow/` routes run on the existing `pinplay-api` Worker. `server/taskflow-auth.mjs` is the canonical source, installed as `pinplay/cloudflare/taskflow-auth.mjs`, with an early route in that Worker's fetch handler. Pinplay student sign-in continues to use its existing routes.

To activate persistence, add the existing Google Web OAuth client's **client secret** as a Cloudflare Worker Secret named `GOOGLE_CLIENT_SECRET` on `pinplay-api`. Find it under Google Auth Platform → Clients → the same Web client already used by Pinplay. Do not put the value in source, browser code, or chat. Existing `GOOGLE_CLIENT_ID`, `STUDENT_SESSION_KEY`, and `QUIZ_MEDIA` bindings are reused.

After adding the secret, refresh Taskflow and connect once more. Google authorization-code popup mode supplies a refresh token to the server. No additional redirect endpoint is needed; the code exchange uses the existing authorized JavaScript origin `https://audiophrases.github.io`.

Refresh/access credentials are encrypted with an application-specific HKDF-derived AES-GCM key and saved under the private `__taskflow_sessions_v1__/` R2 prefix. The browser saves only a random revocable session handle. Sessions have a 90-day maximum lifetime; invalid/revoked/expired sessions require reconnecting. Google apps still in Testing can have shorter provider-imposed refresh-token lifetimes. Configure an R2 lifecycle rule scoped to this prefix to purge records after 90 days. Signing out removes the browser handle and deletes its server record without revoking the shared Pinplay Google grant.

Until the secret is configured, the existing short-lived browser token flow remains available; it does not provide persistence. Runtime `/api/taskflow/config` reports `persistentSessions: true` only when the required server bindings exist. Real Google code exchange and refresh still require an account-authorized live check after setup.

## Hosting and source

The Publish Taskflow GitHub Actions workflow publishes `docs/` from `main` to GitHub Pages. Edit these files for future GitHub Pages updates. No build step or backend is required. Pinplay's repository and backend are unchanged.

The ignored local `taskflow/` checkout and deployment archive predate the GitHub Pages version; `docs/` is the source for the current app.

## Background sync

With Remember me enabled, Taskflow saves the last workspace and selected list for that connection. Return visits show those tasks immediately, then check Google in the background. Pending edits take precedence over the cache. Signed-out visitors and new Google connections cannot load the previous connection's cache; signing out removes it. A clean focused task accepts refreshed data while retaining focus and its caret; unfinished text stays intact.

Creating, editing, completing, moving and deleting tasks updates the interface immediately. Google writes run in order in the background, including when you switch lists. Background reads cannot replace newer edits or interrupt the active task editor.

Task and subtask titles autosave after a 700 ms typing pause, without leaving the field or moving the cursor. Each edit is saved to the local outbox immediately; rapid typing is combined into the latest pending title update. Leaving the title or hiding the tab sends pending title edits sooner. Clearing a title saves an empty title, and IME input waits for composition to finish.

The status shows syncing, synced, or pending changes. A failed write pauses the queue and offers **Retry sync** (or **Reconnect** for an expired login). Pending changes are saved in this browser when storage is available and are restored only after signing into the account with the matching Google list. Signing out is blocked while changes are pending. Keep the tab open until syncing completes; leaving with pending writes triggers a browser warning. If a connection drops during creation, check Google Tasks before confirming a retry, since Google may already have created the item.

## Checks

Run `node --check docs/app.js`, `node --check docs/auth.js`, and `node --test tests/auth.test.cjs`.

Run the full regression suite with `node --test tests/*.test.cjs`.

The task board fills the available width, and task/subtask titles wrap and expand automatically as you type or change text size. The entire sidebar is collapsed by default; use the top-left menu button to open it. Task text size and help are directly available in the sidebar. Alt + L works with the sidebar hidden. The choice is saved in this browser. Cleared Google tasks are excluded from insertion and movement references; move arrows follow visible tasks.

A top-level task named **Archive** (case insensitive) starts a grey section containing that task and every project below it. Projects appear indented under Archive and retain their original subtasks. Completed subtasks, including cleared ones, appear only when **Show completed** is selected. Archived project headings remain visible. This grouping is visual; Google parent relationships are preserved. Moving a project above Archive returns it to its own colored group. List previews follow the same rule.

New tasks and subtasks start with an empty title when created with Enter, the subtask button, or Ctrl/Cmd + Enter. After restoring a session or signing in, the first visible task receives focus so Up/Down navigation and Enter work immediately. Empty lists focus the add field, where Enter creates the first blank task. Open dialogs and active editors keep their focus. The × action moves a task and its subtasks to the **Deleted** list, creating that list if necessary. Inside Deleted, the same × action or keyboard shortcut permanently deletes the task and its subtasks without confirmation. Taskflow uses Google's native list move when sending tasks to Deleted, preserving task details. Real cross-list moves still need verification with an authorized Google account.

## Shortcuts

- Enter: add next task
- Ctrl/Cmd + Enter: add subtask
- Tab / Shift + Tab anywhere in a task title: indent / outdent
- Alt + Up / Down: reorder; subtasks move within their group and into the adjacent parent group at a boundary
- Alt + Enter (or Ctrl/Cmd + Shift + Enter): complete / reopen the focused task
- Alt + Shift + Enter: reopen the most recently completed subtask of the focused task (or of the focused subtask's parent), one per press. With focus outside any task, it reopens the most recently completed task or subtask in the list. Cleared tasks are not reopened
- Ctrl/Cmd + Delete: move the focused task and its subtasks to Deleted; inside Deleted, permanently delete them without confirmation (Mac also supports Cmd + Backspace)
- Ctrl/Cmd + Z: undo the latest task change: completing or reopening, reordering, indenting, dragging, adding, moving to Deleted (restores subtasks and position), or a title edit. Undo switches to the list where the change happened and syncs the reversal to Google like any other edit. In the field you are typing in, the browser's text undo runs first. Permanent deletes in Deleted cannot be undone. The last 100 changes are kept for the open tab and cleared on sign-out.
- Shift + click: select the range of visible tasks and subtasks from the previous selection anchor
- Ctrl/Cmd + click: add or remove individual tasks from the selection; Ctrl/Cmd + Shift + click adds a range
- Ctrl/Cmd + C: copy selected task titles in displayed order, separated by newlines; without a task selection, copy the whole focused task title; highlighted text copies normally
- Plain click or Esc: clear the multiple task selection
- Each task also has a Copy text button
- Alt + L: open list columns with task previews; Left/Right cycle lists, Up/Down scroll tasks, Enter opens the list, Esc cancels
- N: focus new task field when not editing
- ?: show shortcuts

Google authorization and live writes must be verified by signing in as the intended user.
