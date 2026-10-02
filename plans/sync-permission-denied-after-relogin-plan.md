# Sync permission-denied after reconnect/relogin plan

The Arabic UI message is produced by `main/sync/engine.js` in `classifyPushError()` when Firestore rejects a push with `permission-denied`.

## Observed symptom

After reconnecting or logging in again, sync can fail during Firestore push or pull with a `permission-denied` error. The UI then shows the Arabic sync permission message classified in `main/sync/engine.js`.

## Likely root causes to verify

- Stale or missing Firebase auth state after relogin in `main/auth/firebase-auth-service.js`.
- Credentials not refreshed or persisted correctly by `main/sync/credentials.js`.
- IPC auth state mismatch between renderer and main process in `main/ipc/auth.js`.
- Firestore app/project mismatch from `main/firebase/config.js`.
- Firestore rules rejecting the authenticated user after reconnect in `firestore.rules` or `firebase/firestore.rules`.
- Sync engine pushing before auth/token readiness is confirmed in `main/sync/engine.js`.

## Investigation steps

1. Trace relogin flow through `main/ipc/auth.js` and `main/auth/firebase-auth-service.js`.
2. Verify `main/sync/credentials.js` returns a fresh authenticated user/token after reconnect.
3. Confirm `main/firebase/config.js` points to the expected Firebase project used by the deployed rules.
4. Inspect the failing write path and payload in `main/sync/engine.js`.
5. Compare that path against `firestore.rules` and `firebase/firestore.rules`.
6. Add temporary structured logs around current Firebase UID, token claims, target Firestore path, app/project ID, and exact Firestore error code/message.

## Implementation plan

1. In `main/ipc/auth.js`, restart cloud sync only after an online Firebase login.
2. Stop cloud sync loops after an offline fallback login so the engine does not run with no valid cloud auth.
3. In `main/sync/engine.js`, treat the first `permission-denied` as a possible stale-auth/client state.
4. Clear cached credentials, recover the Firestore client via `main/firebase/config.js`, force credential refresh through `main/sync/credentials.js`, and verify auth with a warm-up read.
5. If recovery succeeds, clear the transient sync error and schedule one retry.
6. If recovery fails, keep the Arabic `permission-denied` message so genuinely unauthorized accounts remain blocked.
7. Keep `classifyPushError()` behavior, but distinguish auth readiness from real authorization failure in logs.

## Tests

- Unit test `classifyPushError()` in `main/sync/engine.js` for Firestore `permission-denied`.
- Add a relogin/auth-refresh test around `main/auth/firebase-auth-service.js`.
- Add a credentials refresh test for `main/sync/credentials.js`.
- Add an IPC auth state transition test for `main/ipc/auth.js`.
- If rules tests exist, add coverage for the failing Firestore write path against `firestore.rules` or `firebase/firestore.rules`.

## Manual validation

1. Start the app signed in.
2. Disconnect network.
3. Make a change that queues sync.
4. Reconnect network.
5. Log out and log back in.
6. Confirm sync waits for fresh auth state.
7. Confirm queued writes complete without the Arabic permission-denied message.
8. Confirm a genuinely unauthorized user still receives `permission-denied`.

## Short-term workaround

Fully quit and reopen the app after relogin, then retry sync. If the problem is stale auth state, a full restart forces Firebase auth and sync credentials to initialize cleanly.
