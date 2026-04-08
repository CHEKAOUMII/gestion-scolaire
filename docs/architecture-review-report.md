# gestionScholaire — Architecture Review Report
**Date:** 2026-04-08
**Reviewer:** Architecture Review Plan (automated)
**Scope:** Full codebase — process boundary, IPC, DB, auth, renderer, CSS, tests, reports, notifications

---

## Severity Legend
| Level | Meaning |
|---|---|
| 🔴 Critical | Security vulnerability or data loss risk — fix before any release |
| 🟠 Important | Structural violation that will cause bugs — fix before merge |
| 🟡 Minor | Code quality degradation — schedule for cleanup sprint |
| 🟢 Good | Explicitly noteworthy positive pattern |

---

## 1. Process Boundary & Electron Security

### Findings

**🟢 Good — `main.js`:144-148 — BrowserWindow security options are correctly set.**
`nodeIntegration: false` and `contextIsolation: true` are both explicitly declared in the `webPreferences` block. The preload script is resolved with `path.join(__dirname, 'preload.js')`, which is the correct absolute-path pattern.

**🟢 Good — `main.js`:25-48 — `shell.openExternal()` inputs are sanitized before use.**
A `parseUrl()` helper validates that the URL is parseable, and `openExternallyIfSupported()` then enforces an allowlist of protocols (`http:`, `https:`, `mailto:`, `tel:`) before calling `shell.openExternal()`. Navigation and new-window events are also intercepted by `installWebContentsGuards()` (lines 51-73), which blocks all non-`file:` URLs inline and redirects them through the same sanitizer. Webview attachment is unconditionally blocked (`will-attach-webview` at line 70-72).

**🟡 Minor — `main.js`:179 — DevTools not disabled in production builds.**
Line 179 contains `// window.webContents.openDevTools();` commented out. There is no programmatic guard using `app.isPackaged` or `process.env.NODE_ENV` to ensure DevTools cannot be opened in a production package (e.g. via keyboard shortcut `F12` or `Ctrl+Shift+I`). In a packaged Electron app, DevTools remain available to end users by default unless explicitly disabled.

Recommended fix in `createWindow()`, after the `loadFile` call:
```js
if (app.isPackaged) {
    window.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) {
            event.preventDefault();
        }
    });
} else {
    window.webContents.openDevTools();
}
```
Or more simply, set `devTools: false` inside `webPreferences` when `app.isPackaged` is true.

**🟡 Minor — `main.js`:139 — `sandbox` option is absent from `webPreferences`.**
Electron's renderer-process sandbox (`sandbox: true`) is not set. While `contextIsolation: true` and `nodeIntegration: false` mitigate most renderer-level risks, enabling `sandbox: true` provides an additional OS-level process isolation layer (Chromium sandbox). Its absence is low risk in this app because the renderer loads only local `file:` URLs and no remote content, but it is a missing defence-in-depth layer per current Electron security recommendations.

**🟢 Good — `preload.js`:1-335 — `contextBridge` is used correctly throughout.**
All renderer-facing APIs are exposed exclusively through `contextBridge.exposeInMainWorld('api', {...})`. No raw `require`, `fs`, `shell`, or the `ipcRenderer` object itself is exposed. Every method wraps `ipcRenderer.invoke()` in a thin arrow function, keeping the IPC surface properly encapsulated.

**🟡 Minor — `preload.js`:270-279 — Push-channel listener callbacks not validated.**
The `notifications.onToast` and `notifications.onCenterUpdate` methods (and `updater.onStatus` at line 287-291) accept a raw `callback` argument and register it directly with `ipcRenderer.on()`. There is no type-check that `callback` is a function before calling `ipcRenderer.on()`. If a renderer page passes a non-function (e.g. `undefined` due to a wiring bug), the error will surface as an obscure runtime crash in the main-process event dispatch rather than a clear preload-level failure. A one-line `if (typeof callback !== 'function') return;` guard would suffice.

**🟢 Good — `preload.js`:271, 276, 288 — Listener cleanup functions are returned.**
All three push-channel registrations (`onToast`, `onCenterUpdate`, `onStatus`) return a cleanup function that calls `ipcRenderer.removeListener()`. This prevents listener accumulation across page navigations — a common source of memory leaks in multi-page Electron apps.

**IPC channel count:** 34 namespaced groups, totalling approximately 120 individual channel methods exposed through `window.api`.

### Checklist
- [x] `contextIsolation: true` — **PASS** (`main.js`:146)
- [x] `nodeIntegration: false` — **PASS** (`main.js`:145)
- [x] `webSecurity: true` (not disabled) — **PASS** (option is absent from `webPreferences`, which means it defaults to `true`; it is not explicitly disabled anywhere)
- [ ] `sandbox: true` — **FAIL** (option is absent; sandbox is not enabled — `main.js`:144-148)
- [x] No raw `require`/`fs`/`shell` exposed in preload — **PASS** (`preload.js`:1-335)
- [ ] `devTools` disabled in production — **FAIL** (no `app.isPackaged` or `NODE_ENV` guard present — `main.js`:179)
- [x] `shell.openExternal()` inputs sanitized — **PASS** (`main.js`:38-48, protocol allowlist enforced)

### Summary
The process boundary is in solid shape for the two highest-priority controls: `contextIsolation` and `nodeIntegration` are both correctly configured, and `shell.openExternal()` has a well-implemented protocol allowlist with navigation guards. The two gaps — absence of `sandbox: true` and no DevTools production guard — are minor hardening items rather than exploitable vulnerabilities in this local-file-only deployment context, but both should be addressed before any public distribution release.

---

## 2. IPC Layer

### Channel Parity
- Total channels in `preload.js`: 170 (including the `setup` namespace which aliases 4 `linking:*` channels)
- Total handlers registered: 170
- Mismatches: None (smoke test confirms exact parity)

### Handler Audit Table
| Handler file | Raw ipcMain? | Misused NoAuth? | Missing in preload? | Direct DB import? | Unbounded query? |
|---|---|---|---|---|---|
| auth.js | YES (11 calls) | No (auth is inherently pre-login) | No | YES (line 1) | No (users is system-wide) |
| students.js | No | No | No | No | YES (subjects:getAll) |
| absences.js | No | No | No | No | YES (correspondence:getByStudent) |
| schoolOps.js | No | No | No | No | No |
| staff.js | No | No | No | No | No |
| staffAttendance.js | No | No | No | No | No |
| exams.js | No | No | No | No | No |
| system.js | YES (11 calls) | Partial (manual soft-auth reimplemented) | No | YES (line 1) | No (system tables) |
| licensing.js | YES (14 calls) | No (pre-login ops justified) | No | No | N/A (delegates to service) |
| ownerTelemetry.js | YES (6 calls) | No | No | No | N/A (delegates to service) |
| updater.js | YES (3 calls) | No auth at all | No | No | N/A (no DB access) |
| notifications.js | YES (6 calls) | No auth at all | No | No | N/A (delegates to store) |
| reports.js | YES (5 calls) | YES (updateIdentity is unprotected write) | No | No | N/A (delegates to engine) |
| pageVisibility.js | No | No | No | No | No (system table) |
| linking.js | No | No | No | No | No (system tables) |
| sync.js | No | No | No | No | No (system tables) |
| timetable-data.js | No | No | No | No | No |

### Smoke Test Result
```
> gestion-scolaire@1.0.32 test:smoke
> node tests/smoke.js

[smoke] IPC channels parity OK (170 channels)
  [smoke] Sync registry OK (69 entries, 68 write channels)
[smoke] Module exports OK
[smoke] Page script extraction OK
[smoke] Migrations versioned OK (44 steps)
[smoke] Lazy-load script policy OK
[smoke] Restore safety checks OK
[smoke] No-CDN policy OK (vendor files present)
[smoke] Tailwind CSS build output OK
[smoke] Legacy CSS cleanup complete (no legacy files, no stale refs, no inline styles)
[smoke] Consolidation checks OK (no legacy channels, no handleWriteNoAuth, validation module)
[smoke] Linking LAN endpoint ranking OK
[smoke] Sync default resolution OK
[smoke] Validation module behavioral tests OK
[smoke] Auth module behavioral tests OK
[smoke] All smoke checks passed
```

### Findings

**[GOOD] `ipc-helpers.js` — Well-designed helper trio eliminates boilerplate.**
The `handleRead`, `handleWrite`, and `handleWriteSoftAuth` wrappers correctly inject `db` via `getDb()`, enforce role-based auth, wrap errors consistently via `authErrorResponse()`, and track write channels in a `Set` for smoke-test validation. The `handleWriteSoftAuth` replacement for the former `handleWriteNoAuth` is a meaningful improvement: it enforces auth when a session exists and only falls back to unauthenticated access when no session is present, with audit logging of such events.

**[GOOD] Channel parity enforcement is automated.**
The smoke test (`tests/smoke.js`) validates that all 170 channels declared in `preload.js` exactly match handlers registered in `main/ipc/*.js`. This prevents drift between the two halves of the IPC boundary.

**[GOOD] `handleWriteSoftAuth` channels are bounded.**
All bulk-import and pre-login write channels (`students:addBulk`, `grades:saveBulk`, `absences:saveBulk`, `students:deleteByYear`, `grades:deleteByYear`, `teachers:importBulk`, `timetableData:save`, etc.) enforce batch-size limits (typically 5000 or 500 records) to prevent denial-of-service via oversized payloads.

**[GOOD] Validation module (`validation.js`) provides shared guards.**
`requireFields`, `validateRange`, `validateDate`, and `validateSchoolYear` are used consistently across handler files that use the helper wrappers, preventing duplicate ad-hoc validation logic.

**[IMPORTANT] `system.js`:1 and `auth.js`:1 — Direct `getDb()` import bypasses the helper injection pattern.**
Both files import `const { getDb } = require('../db/context')` at the top level and call `getDb()` directly inside raw `ipcMain.handle()` callbacks. This violates the architectural rule that `getDb()` should only be injected by the helper wrappers. In `auth.js` this is partly defensible because auth handlers need database access for session management functions that cannot easily use the standard helpers (login, register, PIN verification all have unique auth semantics). In `system.js` this is less defensible -- at least `systemLogs:getAll` and `users:getAll` (which already uses `handleWrite`) demonstrate that some handlers can be migrated.

**[IMPORTANT] 7 handler files use raw `ipcMain.handle()` -- 56 raw calls total.**
The files `auth.js` (11), `system.js` (11), `licensing.js` (14), `ownerTelemetry.js` (6), `updater.js` (3), `notifications.js` (6), and `reports.js` (5) all bypass the helper wrappers entirely. While some of these have valid reasons (auth handlers have unique session semantics; licensing/updater/notifications have no DB access), this means error handling, auth enforcement, and DB lifecycle management are reimplemented ad-hoc in each file rather than centralized. The pattern is inconsistent: `system.js` uses `handleRead` for `systemLogs:getAll` and `handleWrite` for `users:getAll`, but then reverts to raw `ipcMain.handle()` for the remaining 11 handlers in the same file.

**[IMPORTANT] `reports.js`:17 — `reports:updateIdentity` is an unprotected write.**
The channel `reports:updateIdentity` calls `updateIdentity(updates)` with no auth check whatsoever. This allows any renderer page (including unauthenticated contexts) to overwrite the school identity (name, logo, addresses) used in official document headers. This should be guarded by `handleWrite(ipcMain, ..., ['admin'], ...)` or at minimum manual `requireRole()`.

**[MINOR] `absences.js`:237-238 — `correspondence:getByStudent` does not filter by `school_year`.**
The query `SELECT * FROM correspondence WHERE student_id = ? ORDER BY letter_date DESC` returns correspondence records for a student across all school years. While this may be intentional (showing full correspondence history), it breaks the multi-tenancy convention that every query on a partitioned table should include a `school_year` filter.

**[MINOR] `students.js`:744 — `subjects:getAll` does not filter by `school_year`.**
The channel queries `SELECT subject FROM grades WHERE subject IS NOT NULL ... GROUP BY subject` across all years. This is a lookup catalog that intentionally aggregates all known subjects, so the omission is defensible, but it means the subject list will grow monotonically as new years are added and never shed stale subjects from previous years.

**[MINOR] `system.js`:109,115 — `users:resetAdminPassword` logs generated password to console.**
Lines 109 and 115 contain `console.log('[RESET] ... password: ' + newPassword)`. While this is a recovery mechanism intended for developer use, the generated password is written to Electron's stdout/log file in plaintext. In a packaged app where logs may be captured, this is a low-severity credential exposure risk.

**[MINOR] `system.js`:239-417 — `system:backupDb` and `system:restoreDb` manually reimplement `handleWriteSoftAuth`.**
Both handlers manually check `getSessionByEvent(event)`, call `requireRole()` if a session exists, and fall back to unauthenticated access otherwise. This is exactly the pattern encapsulated by `handleWriteSoftAuth`, but reimplemented inline. This creates maintenance burden and inconsistency.

**[MINOR] `updater.js`:14-27 — Updater channels have no auth checks.**
The `updater:checkForUpdates`, `updater:downloadUpdate`, and `updater:installUpdate` channels perform system-level operations (downloading and installing executables) with no authentication. While these don't access the database, `installUpdate` triggers an application restart/replacement, which could disrupt active users. A `requireRole(event, ['admin'])` guard would be appropriate at minimum for `installUpdate`.

### Checklist
- [ ] No raw `ipcMain.handle()` calls -- **FAIL** (56 raw calls across 7 files: auth.js, system.js, licensing.js, ownerTelemetry.js, updater.js, notifications.js, reports.js)
- [ ] All write ops use `handleWrite` or justified `handleWriteSoftAuth` -- **FAIL** (reports:updateIdentity has no auth; system.js reimplements soft-auth manually; users:add/updateRole/disable use raw handles with manual requireRole)
- [x] All channels have matching preload entries -- **PASS** (170/170, smoke test confirms)
- [ ] No direct DB imports in handler files -- **FAIL** (auth.js:1 and system.js:1 import getDb directly)
- [ ] All queries filter by `school_year` -- **FAIL** (correspondence:getByStudent and subjects:getAll omit school_year; justified for system tables but not for multi-tenant data tables)
- [x] Smoke test passes -- **PASS** (all 15 checks passed)

### Summary
Channel parity is solid: the 170-channel contract between `preload.js` and handler files is enforced by an automated smoke test that prevents drift. The helper wrappers (`handleRead`, `handleWrite`, `handleWriteSoftAuth`) are well designed and used correctly in 10 of 17 handler files, but 7 files (accounting for 56 of ~170 handlers) bypass them entirely with raw `ipcMain.handle()` calls. The most actionable finding is that `reports:updateIdentity` is an unprotected write channel that should have admin-only auth. The direct `getDb()` imports in `auth.js` and `system.js` and the manual soft-auth reimplementation in `system.js` are structural inconsistencies that should be addressed in a consolidation pass to prevent the pattern from eroding further as new features are added.
