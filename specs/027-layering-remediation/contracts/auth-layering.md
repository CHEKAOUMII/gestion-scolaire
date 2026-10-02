# Contract: Authentication layering

**Feature**: 027-layering-remediation  
**Goal**: FR-006 / FR-011 — separable policy, storage, remote identity, and IPC composition

## Layers

```text
┌─────────────────────────────────────────────┐
│  main/ipc/auth.js                           │
│  - SESSION_BY_SENDER map                    │
│  - channel handlers                         │
│  - compose + map errors to {success,code}   │
└───────────┬─────────────────┬───────────────┘
            │                 │
            v                 v
┌───────────────────┐  ┌──────────────────────────┐
│ lockout-policy.js │  │ session-policy.js        │
│ (pure, no I/O)    │  │ (pure, no I/O)           │
└───────────────────┘  └──────────────────────────┘
            │
            v
┌───────────────────┐  ┌──────────────────────────┐
│ repos/users.js    │  │ firebase-auth-service.js │
│ users,            │  │ remote sign-in / profile │
│ login_attempts,   │  │ (existing)               │
│ session settings  │  │                          │
└───────────────────┘  └──────────────────────────┘
```

## Pure policy contracts

### lockout-policy

```js
// Constants (must match production values at extract time)
MAX_ATTEMPTS_BEFORE_LOCK
LOCKOUT_SCHEDULE_MS  // number[]
ATTEMPT_TTL_MS

// Functions (names illustrative; keep behavior identical)
isAttemptRecordExpired(record, nowMs) -> boolean
nextLockoutDurationMs(attemptCount) -> number  // schedule pick
evaluateLoginAttempt({ count, lockedUntil, nowMs }) ->
  { allowed: boolean, retryAfterMs?: number, reason?: string }
buildFailedAttemptUpdate(existing, nowMs) -> { attempts, locked_until }
```

### session-policy

```js
SESSION_TTL_MS  // 12h product expectation

isSessionExpired(session, nowMs) -> boolean
// session shape remains whatever ipc/auth stores today
```

**Rules:** no `db`, no Firebase, no Electron.

## users repo contract (minimal)

```js
getLoginAttempt(db, emailNormalized) -> row | null
upsertLoginAttempt(db, emailNormalized, { attempts, locked_until }) -> void
clearLoginAttempt(db, emailNormalized) -> void
cleanupStaleLoginAttempts(db, cutoffMs) -> void

getUserById(db, id) -> row | null
// password/pin update helpers as needed by existing handlers

readAppSessionSettings(db) -> value | null
writeAppSessionSettings(db, payload) -> void
clearAppSessionSettings(db) -> void
```

SQL only + optional capture if user rows are synced (follow existing capture registry for user-related channels; do not invent new sync).

## Remote adapter contract

Existing exports of `firebase-auth-service.js` remain the adapter surface (`loginFirebaseFirst`, `logoutFirebaseUser`, `changeFirebasePassword`, etc.). This feature does not redefine remote API.

## IPC composition rules

1. On login failure: load attempt via users repo → evaluate with lockout-policy → persist via users repo → return stable error (no stack/SQL).
2. On login success: clear attempts; establish session map; optional settings persistence; call remote adapter as today.
3. Session validity for privileged ops: session-policy on map entry; do not reimplement TTL inline.
4. PIN/password handlers: policy limits + users repo; remote password change stays in adapter.

## Stability

- Channel names under `window.api.auth` (and any related) **unchanged**.
- Error codes `UNAUTHENTICATED`, `FORBIDDEN`, `SESSION_LOCKED` and existing login failure messaging quality **preserved**.

## Verification

- Unit: policy pure tests with fixed clocks.
- Manual: login success, lockout after repeated failures, PIN path if used, reopen within 12h.
- Smoke: auth channels still registered/parity.
