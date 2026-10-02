# Sync push permission-denied: stop error clobbering, translate, and surface it

## Context

When a Firestore push fails with `PERMISSION_DENIED` (typically a cached-but-stale
Firebase session surviving a sign-out), the engine drops credentials and aborts the
cycle — but the background interval keeps firing. The result is four real defects that
combine into "stuck uploading, no error shown, only fixed by sign-out/sign-in":

1. **Error clobbering** — the original `PERMISSION_DENIED` string stored in
   `sync_config.last_push_error` is overwritten on the next tick by the bland
   `'Failed to obtain credentials'` whenever `getCredentials()` returns null
   ([engine.js:2197-2198](main/sync/engine.js:2197)).
2. **Raw gRPC string** — no Arabic translation exists; the banner would show
   `7 PERMISSION_DENIED: Missing or insufficient permissions.` verbatim
   ([engine.js:1544](main/sync/engine.js:1544)).
3. **Misleading "no errors" panel** — the diagnostics error-log viewer reads the
   file-based app log, while push errors live in the DB column, so it shows
   *"لا توجد أخطاء مسجّلة — كل شيء يعمل بشكل سليم"* even when a push error is stored
   ([settings-sync.js:1305-1317](js/pages/settings-sync.js:1305)).
4. **Permanent spinner** — the UI shows the spinning `syncing` state forever because
   `pushRunning` = `_syncTimer !== null` (timer installed), so `deriveSyncState`
   never reaches its `error` branch ([settings-sync.js:488](js/pages/settings-sync.js:488),
   [engine.js:3226-3228](main/sync/engine.js:3226)).

### Correction vs. the original diagnostic

The original diagnostic blamed a 5-minute restoration cooldown for the repeated null
credentials. That is **wrong**: `clearCredentials()` sets `_lastRestorationAttempt = 0`
([credentials.js:296-300](main/sync/credentials.js:296)), which *resets* the cooldown and
forces an immediate re-sign-in on the next tick. Consequences:

- If a **valid stored credential** exists, the engine already auto-recovers on the next
  tick — no manual sign-out/sign-in needed. So we do **not** add a timer auto-restart
  (redundant) and we do **not** stop the timer (would break this auto-recovery).
- `getCredentials()` only returns null when re-sign-in genuinely can't succeed: no stored
  credential, an invalid one, or a missing/mismatched `schoolId` claim. Those cases truly
  need the user to re-authenticate — so the fix is to **preserve and surface** the real
  error, not to retry differently.

Intended outcome: the real cause is translated to Arabic, kept in `last_push_error`
across retries, shown in both the status banner and the diagnostics panel, and the UI
stops falsely spinning.

## Changes

### 1. `main/sync/engine.js` — stop clobbering a meaningful push error
In `flushSyncOutbox`, the null-credentials branch ([engine.js:2196-2200](main/sync/engine.js:2196)):
only overwrite `last_push_error` when it is currently empty. Read the current value via
`readSyncConfig(db).last_push_error`; if it already holds a value, pass `undefined`/skip
so `recordPushMeta` does not replace it. Use a structured code
`'SYNC_AUTH_UNAVAILABLE'` (with its Arabic message, see change 2) rather than the raw
English when it *is* empty. Apply the same guard to the other bland overwrite sites in
the same function (e.g. connectivity-warmup at [:2231](main/sync/engine.js:2231),
missing-school-id at [:2207](main/sync/engine.js:2207)) so a prior access-denied is never
masked by a later transient reason.

### 2. `main/sync/engine.js` — Arabic classifier for push errors
Add a small pure helper `classifyPushError(errString)` near `recordPushMeta`
([engine.js:1103](main/sync/engine.js:1103)) that maps known cases to Arabic:
- `permission-denied` / `PERMISSION_DENIED` →
  `'تم رفض المزامنة بسبب انتهاء أو ضعف صلاحيات الحساب السحابي. أعد تسجيل الدخول بحساب مدير المؤسسة.'`
- `SYNC_AUTH_UNAVAILABLE` / missing credentials →
  `'تعذّر الحصول على جلسة سحابية صالحة. سجّل الدخول بحساب المؤسسة السحابي.'`
- default → return the input unchanged.
Translate at the single recording seam `recordPushMeta` ([:2338](main/sync/engine.js:2338))
so the DB stores the Arabic string, while the raw English is still emitted to the file
log via the existing `console.warn`/`console.error` calls (forensics preserved). Do the
equivalent for the pull path's `last_pull_error` if it shares a recorder.

### 3. `main/sync/engine.js` + `main/ipc/sync.js` — expose cycle-in-flight, fix the spinner
Do **not** change `pushRunning` (contract = "timer installed"; consumed by the Sync Now
button [settings-sync.js:637](js/pages/settings-sync.js:637) and
[ux-enhancements.js:855](js/ux-enhancements.js:855)). Instead:
- Add `isPushCycleRunning()` returning the existing `_flushRunning` flag
  ([engine.js:36](main/sync/engine.js:36), true only during an active cycle), mirroring
  the existing `isPullCycleRunning()` ([:3234](main/sync/engine.js:3234)). Export it.
- In `sync:getStatus` ([sync.js:121-139](main/ipc/sync.js:121)) add
  `pushCycleActive: isPushCycleRunning()` (and `pullCycleActive: isPullCycleRunning()`).
- In `deriveSyncState` ([settings-sync.js:486-492](js/pages/settings-sync.js:486)) drive the
  `'syncing'` state from `pushCycleActive || pullCycleActive || snapshotRunning` instead of
  the timer-installed flags. Between ticks these are false, so a stalled/errored engine
  falls through to the `error` branch ([:490](js/pages/settings-sync.js:490)) and shows the
  translated message; a genuinely running cycle still spins.

### 4. `js/pages/settings-sync.js` — diagnostics panel reflects DB-stored errors
The error-log panel is populated on demand by the "عرض آخر الأخطاء" button handler in
`initErrorLog` ([settings-sync.js:1409-1428](js/pages/settings-sync.js:1409)), not by
`refreshStatus`. In that handler also fetch `window.api.sync.getStatus()` and pass
`{ lastPushError, lastPullError }` into `renderRecentErrors`
([:1305](js/pages/settings-sync.js:1305)). In the empty-state branch
([:1308-1317](js/pages/settings-sync.js:1308)), when a DB push/pull error is present, render
it (danger styling) instead of the misleading "everything is fine" banner; when both the
file log and the DB errors are empty, keep the existing reassuring banner.

## Out of scope / deliberately not done
- No timer auto-restart and no timer stop-on-access-denied (would break the existing
  next-tick auto-recovery for the recoverable stale-session case).
- No change to `clearCredentials()` cooldown behavior — it is already correct.

## Verification
- **Smoke test:** `npm run test:smoke` — confirms `preload.js` ↔ `main/ipc/*` channel
  parity still holds (no new channels added, but status shape changed — verify nothing
  asserts the exact status key set).
- **Lint:** `npm run lint`.
- **Unit-level:** add/extend a test around `classifyPushError` (pure function) and the
  "don't clobber non-empty `last_push_error`" branch, following the existing engine test
  style in `tests/` (e.g. the single-flight guard test
  `tests/sync-push-throughput-property-23-single-flight-guard.test.js`).
- **Manual (Electron):** with sync configured, force a permission-denied (revoke rules or
  sign the Firebase user out while cached), then over two+ intervals confirm:
  1. Status banner shows the Arabic permission message (not the English gRPC string, not
     "Failed to obtain credentials").
  2. `last_push_error` in `sync_config` retains the Arabic message across ticks.
  3. The banner shows the red `error` state, not a perpetual spinner.
  4. "عرض آخر الأخطاء" surfaces the DB error instead of "كل شيء يعمل بشكل سليم".
  5. With a valid stored credential, a stale-session denial still auto-recovers on the
     next tick (regression check for the corrected cooldown understanding).
