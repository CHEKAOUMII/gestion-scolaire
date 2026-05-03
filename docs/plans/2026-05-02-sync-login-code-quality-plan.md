# Sync & Login Code Quality Refactoring Plan

**Date:** 2026-05-02
**Scope:** `main/sync/`, `main/ipc/auth.js`, `main/auth/`, `js/pages/login.js`
**Total files affected:** ~12
**Estimated effort:** 3–4 focused sessions

---

## Table of Contents

1. [Critical — Silent Data Loss & Security Theater](#1-critical)
2. [High — Duplication & Dead Code](#2-high)
3. [Medium — Oversized Functions & Decomposition](#3-medium)
4. [Low — Hardening & Cleanup](#4-low)

---

## 1. Critical — Silent Data Loss & Security Theater <a name="1-critical"></a>

### 1.1 syncLog write failure silently swallowed (data loss risk)

**Problem:** When `logChangeBatch` fails all 3 retry attempts, the push cycle still reports `success: true`. Other devices never receive the pushed changes — silent data loss.

**Files:**
- `main/sync/engine.js:699-712` (`flushPreparedItems` retry loop)
- `main/sync/engine.js:841-854` (`flushExpandedEntries` retry loop)
- `main/sync/engine.js:1043` (`success: failedCount === 0`)

**Fix:**
1. Track `syncLogWritten` as a return value from both `flushPreparedItems` and `flushExpandedEntries`.
2. If `syncLogWritten === false` after all retries, increment `failedCount` (or add a new `syncLogFailedCount` field) so that `flushSyncOutbox` returns `success: false`.
3. Set `last_push_error` in `sync_config` to indicate syncLog failure specifically.
4. Surface the error in the renderer's sync status panel via `sync:getStatus`.

**Acceptance criteria:**
- A syncLog write failure causes `flushSyncOutbox` to return `success: false`.
- `sync:getStatus` exposes the syncLog error so the UI can display it.
- Affected outbox entries remain `pending` (not marked `sent`) when syncLog fails — so the next push cycle retries them.

---

### 1.2 `computeSessionHash` provides no real integrity

**Problem:** `js/pages/login.js:16-27` — The localStorage session hash uses a hard-coded key (`'gsl_session_integrity_2024'`) visible in the source. Any user can forge a valid hash. This is security theater that provides false confidence.

**File:** `js/pages/login.js:16-27` (`computeSessionHash`), `js/pages/login.js:59-72` (`saveLocalSession`)

**Options (choose one):**
- **Option A — Remove it.** The session hash serves no real purpose since the authoritative session lives in the main process (`SESSION_BY_SENDER` map). Remove `computeSessionHash`, `saveLocalSession`'s hash field, and the hash check in `getLocalSession`. The localStorage snapshot becomes a convenience cache (display name, email) with no pretense of integrity.
- **Option B — Move integrity to main process.** Have the main process sign the session payload with `crypto.createHmac` using a per-launch random secret, and verify it on `auth:getSession`. This adds real integrity but increases complexity.

**Recommendation:** Option A. The main process session map is already the source of truth. Removing the fake hash is cleaner than replacing it with a real one that still only protects a convenience cache.

**Acceptance criteria:**
- No client-side hash computation or verification on localStorage session data.
- `checkExistingAdminSession` still works by calling `window.api.auth.getSession()` (main process authority).

---

### 1.3 Empty catch blocks hide IPC failures

**Problem:** Three empty `catch {}` blocks silently swallow errors, making failures invisible:

| Location | Lines | Impact |
|----------|-------|--------|
| `checkExistingAdminSession` | `login.js:335` | A failed `getSession` IPC call is silently ignored — user may see a stale login form when they have a valid session |
| `clearLocalSession` | `login.js:111-113` | localStorage removal failure ignored — minor |
| `saveRememberMe` | `login.js:117-124` | localStorage write failure ignored — minor |

**Fix:**
- `checkExistingAdminSession` (line 335): Add `console.warn('session check failed:', err)` and let the flow continue to the login form gracefully. Do NOT show a user-facing error — just log it.
- `clearLocalSession` and `saveRememberMe`: Add `console.warn` for debuggability. These are legitimately non-critical.

**Acceptance criteria:**
- All three catch blocks log the error via `console.warn`.
- No user-facing error messages for these — they are graceful fallbacks.

---

## 2. High — Duplication & Dead Code <a name="2-high"></a>

### 2.1 Extract shared `logChangeBatch` retry helper

**Problem:** The 13-line retry loop for `logChangeBatch` is copy-pasted identically in two functions (`flushPreparedItems` at lines 699–712 and `flushExpandedEntries` at lines 841–854).

**File:** `main/sync/engine.js`

**Fix:**
```js
async function writeSyncLogWithRetry(firestoreDb, schoolId, batch, maxAttempts = 3) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await logChangeBatch(firestoreDb, schoolId, batch);
            return true;
        } catch (err) {
            if (attempt === maxAttempts) {
                console.error('[SYNC-PUSH] syncLog write failed after all attempts:', err.message);
                return false;
            }
        }
    }
    return false;
}
```
Replace both inline loops with `const syncLogWritten = await writeSyncLogWithRetry(...)`.

**Acceptance criteria:**
- Only one retry loop exists in the codebase.
- Both push paths use the shared helper.
- Existing behavior is preserved (return value plumbed into fix 1.1).

---

### 2.2 Deduplicate Firebase config reading

**Problem:** Two near-identical functions read the same 6 Firebase config fields from `sync_config` + env vars:
- `main/auth/firebase-auth-service.js:36-52` (`readFirebaseConfig`)
- `main/sync/credentials.js:51-61` (`readFirebaseConfigFromDb`)

Similarly duplicated:
- **School ID reading:** `firebase-auth-service.js:54-74` (`readSchoolId`) vs `credentials.js:28-45` (`readSchoolIdFromDb`) — same three-tier fallback.
- **Invalid credential detection:** `firebase-auth-service.js:187-197` (`isInvalidFirebaseCredential`) vs `credentials.js:164-172` (`isInvalidCredentialError`) — overlapping Firebase error code lists.

**Fix:**
1. Create `main/firebase/config.js` (or add to existing `main/firebase/collections.js`) with:
   - `readFirebaseConfig(db)` — single source of truth for the 6 Firebase fields.
   - `readSchoolId(db)` — single source of truth for the three-tier school ID fallback.
   - `isInvalidCredentialError(code)` — unified error code check.
2. Update both `firebase-auth-service.js` and `credentials.js` to import from the shared module.
3. Delete the duplicate functions.

**Acceptance criteria:**
- Firebase config reading, school ID reading, and credential error detection each exist in exactly one place.
- No behavior changes — same precedence logic, same error codes.
- `auth:login` and sync flows both continue to work.

---

### 2.3 Remove dead registration code path

**Problem:** `main/ipc/auth.js:382-392` — `auth:register` unconditionally returns `SELF_SIGNUP_DISABLED`. The renderer's register form handler (`login.js:596-644`) and `showPinSetupPrompt` (`login.js:255-317`) are unreachable dead code. The register tab is also hidden and disabled in `login.html:57`.

**Fix:**
1. Remove `showPinSetupPrompt` function (`login.js:255-317`, 63 lines).
2. Remove the register form submit handler (`login.js:596-644`, 49 lines).
3. Remove the register form HTML block (`login.html:203-296`, ~94 lines) and the hidden tab button (`login.html:57-60`).
4. Remove the `form-register` related error/success elements.
5. Keep the `auth:register` IPC handler as a stub that returns `SELF_SIGNUP_DISABLED` — removing it would break the preload/IPC parity smoke test. Add a comment: `// Stub — registration disabled, handler retained for IPC parity`.

**Acceptance criteria:**
- ~200 lines of dead code removed from `login.js` and `login.html`.
- Register tab no longer exists in the DOM.
- Smoke test (`tests/smoke.js`) still passes — IPC channel parity maintained.
- Login and change-password flows unaffected.

---

## 3. Medium — Oversized Functions & Decomposition <a name="3-medium"></a>

### 3.1 Decompose `flushSyncOutbox` (189 lines)

**File:** `main/sync/engine.js:866-1054`

**Current responsibilities:**
1. Read pending outbox entries
2. Compact superseded entries
3. Split into prepared vs. bulk entries
4. Filter by role authority
5. Flush prepared items (batched Firestore writes)
6. Expand and flush bulk entries
7. Schedule backlog push
8. Aggregate and return stats

**Proposed decomposition:**
```
flushSyncOutbox(limit)                    — orchestrator (~40 lines)
  ├── readPendingOutboxBatch(db, limit)   — step 1
  ├── compactPendingOutbox(db)            — step 2 (already exists)
  ├── partitionByType(entries)            — steps 3-4
  ├── flushPreparedItems(...)             — step 5 (already exists)
  ├── flushExpandedEntries(...)           — step 6 (already exists)
  └── aggregateFlushStats(results)        — step 8
```

The main win is extracting `readPendingOutboxBatch`, `partitionByType`, and `aggregateFlushStats` so that `flushSyncOutbox` becomes a ~40-line orchestrator.

**Acceptance criteria:**
- `flushSyncOutbox` is under 60 lines.
- Each extracted function is independently testable.
- No behavior changes.

---

### 3.2 Decompose `pullRemoteChanges` (459 lines)

**File:** `main/sync/engine.js:1173-1631`

This is the largest function in the codebase. It contains:
1. Config/credential retrieval (~30 lines)
2. Firestore pull + bootstrap fallback (~80 lines)
3. Self-origin filtering (~20 lines)
4. Format mapping (~40 lines)
5. Topological sorting (~10 lines)
6. Transaction with `applyItem` (~200 lines)
7. Cursor advancement (~30 lines)
8. Deferred item processing (~30 lines)
9. Pull state update (~20 lines)

**Proposed decomposition:**
```
pullRemoteChanges()                              — orchestrator (~60 lines)
  ├── fetchRemoteChanges(firestoreDb, config)     — steps 1-3
  ├── mapToInternalFormat(rawItems)               — step 4
  ├── sortByTopology(items)                       — step 5 (already exists)
  ├── applyPulledItems(db, items)                 — step 6 (new, wraps transaction)
  │     └── applyItem(item, isDeferred)           — already exists (move to module scope)
  ├── processDeferredItems(db, deferred)           — step 8
  └── updatePullState(db, config, tables)          — step 9
```

Key refactor: move `applyItem` from a closure inside the transaction to a module-level function that receives `db` as a parameter. This makes it independently testable.

**Acceptance criteria:**
- `pullRemoteChanges` is under 80 lines.
- `applyItem` is a standalone function, not a closure.
- Transaction integrity preserved — all applies still happen in a single `db.transaction()`.

---

### 3.3 Decompose `runSnapshotCycle` (143 lines)

**File:** `main/sync/snapshot.js:12-154`

**Proposed decomposition:**
```
runSnapshotCycle()                                    — orchestrator (~40 lines)
  ├── validateSnapshotPreconditions(db, config)       — guard checks (returns early-exit result or null)
  ├── snapshotTable(db, tableName, syncIdMap, config) — per-table loop body
  ├── pruneResolvedConflicts(db)                      — conflict cleanup
  └── buildSnapshotResult(stats)                      — factory for the return shape
```

Also extract the repeated early-return object `{ success, skipped, reason, tablesChecked: 0, ... }` into `buildSnapshotResult(overrides)`.

**Acceptance criteria:**
- `runSnapshotCycle` is under 50 lines.
- The early-return shape is constructed by a single factory function.

---

### 3.4 Decompose `auth:login` handler (165 lines)

**File:** `main/ipc/auth.js:166-330`

**Current inline concerns:**
1. Input validation (email/password presence)
2. Throttle check
3. Developer bypass
4. Firebase login attempt
5. Auto-link-request fallback (inside catch)
6. Session creation
7. Credential persistence
8. Sync restart

**Proposed decomposition:**
```
auth:login handler                           — orchestrator (~50 lines)
  ├── validateLoginInput(email, password)    — step 1
  ├── checkLoginThrottle(email)              — step 2
  ├── tryDevBypass(email, password)           — step 3 (returns session or null)
  ├── loginFirebaseFirst(email, password)    — step 4 (already exists in firebase-auth-service.js)
  ├── handleLinkRequest(email, error, db)    — step 5 (extract from catch block)
  ├── createSession(event, result, db)       — step 6
  └── postLoginSetup(email, password)        — steps 7-8
```

The biggest win is extracting `handleLinkRequest` (~31 lines, currently at lines 231–261) from inside the catch block.

**Acceptance criteria:**
- `auth:login` handler body is under 60 lines.
- Auto-link-request logic is a standalone async function.
- Developer bypass is a standalone function returning `null` or a session object.

---

### 3.5 Simplify `captureAfterWrite` switch (86 lines)

**File:** `main/sync/capture.js:371-456`

**Fix:** Replace the 9-case `switch` with a dispatch table keyed by `entry.idStrategy`:
```js
const ID_STRATEGY_HANDLERS = {
    lastInsertRowid: (db, entry, args, result) => { ... },
    inputId:         (db, entry, args, result) => { ... },
    inputKey:        (db, entry, args, result) => { ... },
    inputComposite:  (db, entry, args, result) => { ... },
    // ...
};
```

**Acceptance criteria:**
- No `switch` statement in `captureAfterWrite`.
- Each strategy handler is a named function (testable in isolation).
- Behavior unchanged.

---

## 4. Low — Hardening & Cleanup <a name="4-low"></a>

### 4.1 Add pull retry/backoff

**Problem:** `pullRemoteChanges` has no retry logic — a single error marks `last_pull_error` and returns. Push has configurable `max_retries` with escalating lockouts.

**File:** `main/sync/engine.js` — `pullRemoteChanges` and `startSyncPullBackground`

**Fix:** Add a simple 1-retry with 5s delay in `startSyncPullBackground`'s interval callback (not inside `pullRemoteChanges` itself). If the first pull fails, schedule a single retry after 5s before waiting for the next interval.

**Acceptance criteria:**
- A transient pull failure is retried once before waiting for the next interval.
- Persistent failures still surface via `last_pull_error`.

---

### 4.2 Persist throttle state across restarts

**Problem:** `LOGIN_ATTEMPTS` (`auth.js:25`) is an in-memory `Map` that resets on app restart, allowing lockout bypass by relaunching Electron.

**Fix:** Store attempt counts and lockout timestamps in a SQLite table (`login_attempts`) with columns `email TEXT PRIMARY KEY, attempts INTEGER, locked_until INTEGER, updated_at INTEGER`. Clean up rows older than 30 minutes on app boot.

**Acceptance criteria:**
- Relaunching the app does not reset login attempt counters.
- Stale rows (>30 min) are cleaned up at boot.
- Lockout schedule unchanged (5s, 15s, 30s, 60s, 120s after 5 failures).

---

### 4.3 Fix `credentials.js` cooldown state leak

**Problem:** `clearCredentials()` (`credentials.js:292-295`) resets `_cachedCredentials` and `_refreshPromise` but does NOT reset `_lastRestorationAttempt`. After calling `clearCredentials()`, `restoreFirebaseSession()` may still refuse to attempt restoration due to a stale cooldown timestamp.

**Fix:** Add `_lastRestorationAttempt = 0;` to `clearCredentials()`.

**Acceptance criteria:**
- After `clearCredentials()`, the next `restoreFirebaseSession()` call is not blocked by cooldown.

---

### 4.4 Remove stale DynamoDB design docs

**Problem:** `docs/plans/2026-03-20-dynamodb-sync-design.md` and `docs/plans/2026-03-20-dynamodb-sync-executive-summary.md` reference a DynamoDB-based architecture that was never implemented — the sync system uses Firestore.

**Fix:** Delete both files or move them to a `docs/archive/` directory.

**Acceptance criteria:**
- No design docs in `docs/plans/` that contradict the current implementation.

---

### 4.5 Remove debug logging in `getFirebaseClients`

**Problem:** `main/auth/firebase-auth-service.js:146-152` logs `[AUTH-DIAG]` debug output including internal config state on every Firebase client acquisition. This appears to be a development leftover.

**Fix:** Remove the `console.log('[AUTH-DIAG] ...')` block, or gate it behind `process.env.PENCIL_DEV_MODE === '1'`.

**Acceptance criteria:**
- No diagnostic logging in production for routine Firebase client acquisition.

---

### 4.6 Specify explicit scrypt cost parameters

**Problem:** `main/auth/password.js:19` — `crypto.scryptSync` is called without explicit cost parameters (`N`, `r`, `p`), relying on Node.js defaults.

**Fix:** Add explicit parameters: `{ N: 16384, r: 8, p: 1 }` (Node.js defaults, but now documented and locked).

**Acceptance criteria:**
- Cost parameters are explicit in the source.
- Existing password hashes remain verifiable (parameters match Node defaults).

---

## Execution Order

Tasks are ordered by dependency and risk. Each phase is independently shippable.

### Phase 1 — Critical fixes (no refactoring, just correctness)
1. **1.1** — Fix syncLog failure swallowing
2. **1.2** — Remove fake session hash (Option A)
3. **1.3** — Add logging to empty catch blocks
4. **4.3** — Fix credentials cooldown leak (1-line fix)

### Phase 2 — Deduplication & dead code removal
5. **2.1** — Extract `writeSyncLogWithRetry` helper
6. **2.2** — Deduplicate Firebase config/schoolId/error helpers
7. **2.3** — Remove dead registration code path

### Phase 3 — Decomposition (engine.js)
8. **3.1** — Decompose `flushSyncOutbox`
9. **3.2** — Decompose `pullRemoteChanges` + `applyItem`
10. **3.3** — Decompose `runSnapshotCycle`

### Phase 4 — Decomposition (auth & capture)
11. **3.4** — Decompose `auth:login` handler
12. **3.5** — Simplify `captureAfterWrite` dispatch

### Phase 5 — Hardening & cleanup
13. **4.1** — Add pull retry/backoff
14. **4.2** — Persist throttle state
15. **4.4** — Remove stale design docs
16. **4.5** — Remove debug logging
17. **4.6** — Specify scrypt cost parameters

---

## Testing Strategy

- **Smoke test** (`npm run test:smoke`) must pass after every phase — it validates IPC channel parity.
- **Manual testing after Phase 1:** Login flow (online + offline), sync push + pull cycle.
- **Manual testing after Phase 2:** Verify login still works after Firebase config deduplication; verify register tab is gone.
- **After Phase 3–4:** Full sync cycle: push changes on device A, pull on device B. Verify conflict detection still works.
- **After Phase 5:** Login lockout test (5 failed attempts → lockout persists across restart).

---

## Files Changed Summary

| File | Phases | Type |
|------|--------|------|
| `main/sync/engine.js` | 1, 2, 3 | Refactor + bugfix |
| `main/sync/snapshot.js` | 3 | Refactor |
| `main/sync/capture.js` | 4 | Refactor |
| `main/sync/credentials.js` | 1, 2 | Bugfix + dedup |
| `main/firebase/config.js` | 2 | **New file** |
| `main/auth/firebase-auth-service.js` | 2, 5 | Dedup + cleanup |
| `main/auth/password.js` | 5 | Hardening |
| `main/ipc/auth.js` | 4, 5 | Refactor + hardening |
| `js/pages/login.js` | 1, 2 | Bugfix + dead code removal |
| `login.html` | 2 | Dead code removal |
| `main/db/schema.js` | 5 | Add `login_attempts` table |
| `main/db/migrations.js` | 5 | Migration for `login_attempts` |
| `docs/plans/2026-03-20-dynamodb-*` | 5 | Delete |
