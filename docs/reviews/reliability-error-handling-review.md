# Reliability & Error Handling Review

**Scope:** Exception/error handling completeness, graceful degradation, retry logic & timeouts, logging & observability, fail-safe defaults  
**Date:** 2026-05-03  
**Reviewer:** GitHub Copilot (automated)

---

## ✅ What is Done Well

**Error boundaries are consistent across IPC layer.**  
`handleRead` / `handleWrite` / `handleWriteSoftAuth` in `ipc-helpers.js` are a good single pattern. Every handler is wrapped, auth errors get a typed code (`UNAUTHENTICATED`, `FORBIDDEN`, `INTERNAL_ERROR`), and no handler can crash the main process.

**Firebase → local auth fallback is solid.**  
`loginFirebaseFirst` in `firebase-auth-service.js` gracefully degrades to `loginWithLocalFallback` for offline scenarios, distinguished by whether Firebase is *unavailable* vs. *invalid credentials*. The latter correctly propagates as an auth error rather than silently falling back.

**Sync retry logic is well-designed.**  
`markEntryFailed` tracks retries, `maxRetries` is configurable, escalating back-off exists for conflicts, `reopenVersionConflictOutbox` / `reopenRecoverableOutbox` prevent entries from being permanently stuck, and the `_flushRunning` guard prevents concurrent push cycles.

**Credentials module has layered resilience.**  
`encryptCredential` tries Electron `safeStorage` first, falls back to AES-CBC. `restoreFirebaseSession` has a 5-minute cooldown to prevent hammering on network outages. Forced token refresh falls back to cached token on failure.

**Process-level safety in `main.js`.**  
`uncaughtException` shows a fatal error dialog and exits cleanly. `process.on('unhandledRejection')` at minimum logs. `handleFatalStartupError` guards against double-showing the dialog. `app.on('will-quit')` stops sync and closes the DB.

**Observability via `system_logs`.**  
`logAuthDebug` persists structured events to the DB (with email masking and key scrubbing in `sanitizeMeta`) so audit trails survive process restarts.

---

## ❌ Issues Found

---

### 🔴 Critical — Plaintext password written to console log

**File:** `main/ipc/system.js` (~lines 430, 436)

```js
console.log('[RESET] Developer account created with password: ' + newPassword);
console.log('[RESET] Admin password has been reset to: ' + newPassword);
```

The temporary password is logged to stdout in plaintext. On Windows, Electron's stdout is often captured in log files or visible in process monitors. This violates the principle of never logging secrets. The password only needs to be returned in the IPC response so the admin UI can display it once.

**Fix:** Remove both `console.log` statements. The renderer receives the password through the return value.

---

### 🔴 High — No HTTP timeouts on `fetch()` calls

**Files:** `main/ipc/system.js` (`postFirebaseFunction`), `main/ipc/auth.js` (link-request auto-submit)

```js
const response = await fetch(`${functionsUrl}/${functionName}`, { method: 'POST', ... });
// No AbortController, no timeout
```

On a Moroccan school network with unreliable or absent internet, a fetch to a cloud function can hang indefinitely. Since these are inside `ipcMain.handle` callbacks, the renderer will await a response forever — no loading state, no timeout toast, just a frozen UI.

**Fix:** Wrap every `fetch` with an `AbortController` and a reasonable timeout (e.g. 15–20s for user-facing operations, 30s for sync):

```js
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 15_000);
try {
    const response = await fetch(url, { ..., signal: controller.signal });
    // ...
} finally {
    clearTimeout(timer);
}
```

The caught `AbortError` should be mapped to a user-friendly `'شبكة الإنترنت غير متاحة'` error code.

---

### 🟠 Medium — `handleRead` swallows errors without logging

**File:** `main/ipc/ipc-helpers.js` (lines 71–79)

```js
function handleRead(ipcMain, channel, handler) {
    ipcMain.handle(channel, async (_event, ...args) => {
        try {
            ...
        } catch (err) {
            return { success: false, error: err.message };  // ← silent server-side
        }
    });
}
```

Read handler errors are returned to the renderer but never logged server-side. When a query fails (DB corruption, schema mismatch, unexpected null), there is no server-side trace. The renderer shows a vague error and there is nothing in `system_logs` to diagnose it.

**Fix:** Add a `console.warn` before returning:

```js
} catch (err) {
    console.warn(`[ipc:read] ${channel} failed:`, err.message);
    return { success: false, error: err.message };
}
```

Also consider not returning `err.message` raw to the renderer — it can leak SQL syntax details and table/column names. A sanitized `'حدث خطأ في قراءة البيانات'` with a server-side log is safer.

---

### 🟠 Medium — Split-brain risk in `users:updateRole` and `users:disable`

**File:** `main/ipc/system.js` (~lines 368–370, 402–404)

```js
const firebaseProvisioning = await updateFirebaseUserRole(db, user, role);
// If this succeeds but the line below fails → Firebase and local DB diverge
db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
```

If the Firebase call succeeds and the local SQLite update then fails (e.g., DB locked, constraint violation), the user's role in Firebase and in the local DB are permanently out of sync with no recovery path.

**Fix (pragmatic):** Either reverse the order (local DB first, then Firebase — the cheaper operation is the local one, and Firebase sync will eventually reconcile), or log a `system_logs` entry if the local update fails after Firebase succeeded so administrators can manually reconcile.

---

### 🟠 Medium — Auth debug logging enabled in non-production builds (possibly all deployments)

**File:** `main/auth/debug.js` (lines 5–8)

```js
const AUTH_DEBUG_ENABLED =
    process.env.PENCIL_AUTH_DEBUG === '1' ||
    process.env.NODE_ENV !== 'production';
```

Electron desktop apps typically do not set `NODE_ENV=production` unless the build pipeline explicitly does so. This means `AUTH_DEBUG_ENABLED` is likely `true` in all school deployments unless the CI/build explicitly sets `NODE_ENV=production`. Auth debug events are then written to `system_logs` for every login, session check, and password change — potentially bloating the log table on active schools.

**Fix:** Either set `NODE_ENV=production` in the electron-builder config, or flip the condition to opt-in only:

```js
const AUTH_DEBUG_ENABLED = process.env.PENCIL_AUTH_DEBUG === '1';
```

---

### 🟠 Medium — Always-on diagnostic `console.log` in Firebase config check

**File:** `main/auth/firebase-auth-service.js` (lines 146–153)

```js
console.log('[AUTH-DIAG] Firebase config check:', {
    hasApiKey: !!config.apiKey,
    hasProjectId: !!config.projectId,
    ...
    projectId: config.projectId || '(empty)'
});
```

This runs on every call to `getFirebaseClients()` (every login, every sync credential check), is not gated by any debug flag, and logs `projectId` to stdout.

**Fix:** Move inside the existing `logAuthDebug` call below it, or gate it:

```js
if (AUTH_DEBUG_ENABLED) {
    console.log('[AUTH-DIAG] Firebase config check:', { ... });
}
```

---

### 🟡 Low — `unhandledRejection` only logs; no visibility in admin log

**File:** `main.js` (lines 147–149)

```js
process.on('unhandledRejection', (reason) => {
    console.error('[process] Unhandled promise rejection:', reason);
});
```

If a critical background promise (e.g., sync transaction, DB migration) rejects without being caught, the app silently continues with no record in the admin-visible log page.

**Fix:** Add a best-effort `system_logs` insert inside the handler, similar to how `logAuthDebug` does it.

---

### 🟡 Low — `validateDate` does not check calendar validity

**File:** `main/ipc/validation.js` (lines 49–59)

The comment says "Does NOT enforce strict calendar validity". This means `2024-02-30`, `2025-13-01`, etc. pass validation and get inserted into the DB. SQLite accepts any text date, so invalid dates can silently corrupt absence and exam records.

**Fix:** After the regex check, validate with `Date`:

```js
const d = new Date(str);
if (isNaN(d.getTime())) {
    throw new Error(`${fieldName}: تاريخ غير صالح`);
}
```

---

### 🟡 Low — `handleWriteNoAuth` documented but does not exist in exports

**File:** `main/ipc/ipc-helpers.js`, `CLAUDE.md`

The architectural notes refer to `handleWriteNoAuth` as one of the three wrappers, but the file only exports `handleRead`, `handleWrite`, and `handleWriteSoftAuth`. The `handleWriteNoAuth` variant appears to have been merged into `handleWriteSoftAuth`. This is not a functional bug, but the discrepancy can mislead contributors into looking for a non-existent export.

**Fix:** Update the `CLAUDE.md` architecture section to reference `handleWriteSoftAuth` instead of `handleWriteNoAuth`.

---

## Summary

| Severity | File | Issue |
|---|---|---|
| 🔴 Critical | `main/ipc/system.js` | Plaintext password in `console.log` on admin password reset |
| 🔴 High | `main/ipc/system.js`, `main/ipc/auth.js` | No `AbortController`/timeout on `fetch()` — hangs on bad networks |
| 🟠 Medium | `main/ipc/ipc-helpers.js` | `handleRead` errors are silent server-side; raw `err.message` may leak schema info |
| 🟠 Medium | `main/ipc/system.js` | Split-brain if Firebase role/disable update succeeds but local DB update fails |
| 🟠 Medium | `main/auth/debug.js` | `AUTH_DEBUG_ENABLED` likely always `true` in production builds |
| 🟠 Medium | `main/auth/firebase-auth-service.js` | Always-on `[AUTH-DIAG]` diagnostic log on every auth attempt |
| 🟡 Low | `main.js` | `unhandledRejection` only logs; no visibility in admin log page |
| 🟡 Low | `main/ipc/validation.js` | `validateDate` accepts calendar-impossible dates (e.g. `2024-02-30`) |
| 🟡 Low | `CLAUDE.md` | `handleWriteNoAuth` documented but does not exist in exports |
