# Tasks: OTP Module for Device Linking

**Input**: Design documents from `/specs/009-otp-module/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/otp-module.md

**Tests**: Not requested — no test tasks included.

**Organization**: Tasks are grouped by user story. This is a single-file module (`main/linking/otp.js`) so most tasks are sequential within the file, but the overall structure enables incremental validation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

This is an Electron desktop app. All paths are relative to repository root:

- **New file**: `main/linking/otp.js`
- **Existing dependencies**: `main/auth/password.js`, `main/db/context.js`
- **Existing DB table**: `device_otp` (created by Phase 7.1 in `main/db/schema.js`)

---

## Phase 1: Setup

**Purpose**: Create directory structure and file skeleton

- [x] T001 Create the `main/linking/` directory and empty `main/linking/otp.js` file with module boilerplate

**Details for T001**:

Create the file `main/linking/otp.js` with the following exact content:

```js
const crypto = require('crypto');
const { hashPassword, verifyPassword } = require('../auth/password');

// ── Constants ──
const OTP_TTL_MS = 10 * 60_000; // 10 minutes
const MAX_OTP_ATTEMPTS = 5;
const OTP_ATTEMPT_WINDOW_MS = 10 * 60_000; // 10 minutes
const MASSAR_CODE_REGEX = /^[A-Za-z0-9]{5,10}$/;

// ── Rate limit state (in-memory, resets on app restart) ──
const OTP_ATTEMPTS = new Map(); // massarCode → { count, firstFailure }

module.exports = {
    validateMassarCode,
    generateOtp,
    verifyOtp,
    getActiveOtp,
    cleanupExpiredOtps
};
```

The five exported function names are declared but not yet implemented — they will be added in the following tasks. The `require` statements and constants are final and should not change.

**Checkpoint**: File exists at `main/linking/otp.js`. Running `npm run lint` may show warnings about undeclared functions — that is expected until all tasks are complete.

---

## Phase 2: Foundational — MASSAR Validation & Rate Limit Helpers

**Purpose**: Internal helper functions that ALL user stories depend on. These MUST be implemented before any user story work begins.

**CRITICAL**: No user story work can begin until this phase is complete.

- [x] T002 Implement `validateMassarCode(massarCode)` function in `main/linking/otp.js`
- [x] T003 Implement internal rate-limit helper functions in `main/linking/otp.js`

**Details for T002**:

Add this function to `main/linking/otp.js`, ABOVE the `module.exports` block:

```js
function validateMassarCode(massarCode) {
    if (!massarCode || typeof massarCode !== 'string') {
        return { valid: false };
    }
    const trimmed = massarCode.trim().toUpperCase();
    if (!MASSAR_CODE_REGEX.test(trimmed)) {
        return { valid: false };
    }
    return { valid: true, normalized: trimmed };
}
```

**What this does**: Takes a raw MASSAR code string, trims whitespace, uppercases it, and tests against the regex `/^[A-Za-z0-9]{5,10}$/`. Returns `{ valid: true, normalized: 'M320456' }` on success or `{ valid: false }` on failure.

**Acceptance check**: Calling `validateMassarCode('m320456')` returns `{ valid: true, normalized: 'M320456' }`. Calling `validateMassarCode('')` returns `{ valid: false }`. Calling `validateMassarCode('AB')` returns `{ valid: false }` (too short).

---

**Details for T003**:

Add these three internal helper functions to `main/linking/otp.js`, ABOVE the `module.exports` block. These are NOT exported — they are used internally by `verifyOtp` and `generateOtp`.

```js
function isRateLimited(massarCode) {
    const rec = OTP_ATTEMPTS.get(massarCode);
    if (!rec) return false;
    const now = Date.now();
    if (now - rec.firstFailure > OTP_ATTEMPT_WINDOW_MS) {
        OTP_ATTEMPTS.delete(massarCode);
        return false;
    }
    return rec.count >= MAX_OTP_ATTEMPTS;
}

function recordFailedAttempt(massarCode) {
    const now = Date.now();
    const rec = OTP_ATTEMPTS.get(massarCode);
    if (!rec || now - rec.firstFailure > OTP_ATTEMPT_WINDOW_MS) {
        OTP_ATTEMPTS.set(massarCode, { count: 1, firstFailure: now });
    } else {
        rec.count += 1;
    }
}

function resetAttempts(massarCode) {
    OTP_ATTEMPTS.delete(massarCode);
}
```

**What these do**:

- `isRateLimited(massarCode)`: Returns `true` if 5+ failed attempts occurred within the last 10 minutes. If the window has expired, auto-cleans the entry and returns `false`.
- `recordFailedAttempt(massarCode)`: Increments the failure counter. If the window expired, starts a new window.
- `resetAttempts(massarCode)`: Clears the counter entirely (called when a new OTP is generated or verification succeeds).

**Acceptance check**: These are internal functions — they will be exercised by `verifyOtp` in Phase 4 (US2) and `generateOtp` in Phase 3 (US1).

**Checkpoint**: Foundation ready — `validateMassarCode` and rate-limit helpers are in place. User story implementation can now begin.

---

## Phase 3: User Story 1 — Admin Generates OTP (Priority: P1) 🎯 MVP

**Goal**: An admin can call `generateOtp()` and receive a 6-digit code with an expiration time. Previous active OTPs for the same institution are invalidated. Only the hash is stored.

**Independent Test**: Call `generateOtp(db, 'M320456', 'abc123devicehash')` and verify:

1. Returned `otp` is a 6-digit string (100000–999999)
2. Returned `expiresAt` is ~10 minutes in the future
3. The `device_otp` table has a new row with `status = 'active'` and `otp_hash` starting with `scrypt$`
4. Calling `generateOtp` again for the same MASSAR code sets the first row's `status` to `'expired'`

- [x] T004 [US1] Implement `generateOtp(db, massarCode, creatorDeviceHash)` function in `main/linking/otp.js`

**Details for T004**:

Add this function to `main/linking/otp.js`, ABOVE the `module.exports` block, AFTER the `validateMassarCode` function:

```js
function generateOtp(db, massarCode, creatorDeviceHash) {
    // 1. Validate inputs
    const validation = validateMassarCode(massarCode);
    if (!validation.valid) {
        throw new Error('Invalid MASSAR code format');
    }
    const normalized = validation.normalized;

    if (!creatorDeviceHash || typeof creatorDeviceHash !== 'string' || !creatorDeviceHash.trim()) {
        throw new Error('Creator device hash is required');
    }

    // 2. Invalidate any previous active OTP for this MASSAR code
    db.prepare(
        `
        UPDATE device_otp SET status = 'expired'
        WHERE massar_code = ? AND status = 'active'
    `
    ).run(normalized);

    // 3. Generate cryptographically random 6-digit code
    const otpNum = crypto.randomInt(100000, 999999);
    const otp = String(otpNum);

    // 4. Hash the OTP using existing scrypt infrastructure (never store plaintext)
    const otpHash = hashPassword(otp);

    // 5. Calculate expiration (now + 10 minutes)
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

    // 6. Insert the new OTP record
    db.prepare(
        `
        INSERT INTO device_otp (otp_hash, massar_code, created_by_device, expires_at, status)
        VALUES (?, ?, ?, ?, 'active')
    `
    ).run(otpHash, normalized, creatorDeviceHash.trim(), expiresAt.toISOString());

    // 7. Reset rate limit counter for this MASSAR code (new OTP = fresh start)
    resetAttempts(normalized);

    // 8. Return plaintext OTP (one-time only) and expiration
    return {
        otp,
        expiresAt: expiresAt.toISOString()
    };
}
```

**What this does step by step**:

1. Validates the MASSAR code format (throws if invalid)
2. Validates the device hash is non-empty (throws if empty)
3. Sets any existing active OTP for this MASSAR code to `status = 'expired'` (ensures only one active OTP per institution)
4. Generates a random 6-digit number using `crypto.randomInt(100000, 999999)` (cryptographically secure)
5. Hashes the OTP string using the existing `hashPassword()` from `main/auth/password.js` (scrypt with random salt, format: `scrypt$<salt>$<hash>`)
6. Calculates expiration as current time + 10 minutes
7. Inserts a new row into `device_otp` with the hash (NOT the plaintext), MASSAR code, device hash, expiration, and `status = 'active'`
8. Resets the in-memory rate limit counter for this MASSAR code
9. Returns the plaintext OTP and expiration time — this is the ONLY time the plaintext is available

**Important**: The plaintext OTP is returned to the caller but NEVER stored in the database. Only the scrypt hash is persisted. This is a security requirement from FR-002.

**Checkpoint**: `generateOtp` works. An admin can generate a linking code. This is the MVP — the core OTP creation capability is in place.

---

## Phase 4: User Story 2 — Device Verifies OTP (Priority: P1)

**Goal**: A second device can call `verifyOtp()` with a MASSAR code and 6-digit OTP. If the code matches, the OTP is marked as used. If it doesn't match, the OTP stays active for retry.

**Independent Test**: Generate an OTP with `generateOtp`, then:

1. Call `verifyOtp` with the correct code → should return `{ valid: true }`
2. Check the DB row now has `status = 'used'`, `used_by_device` set, `used_at` set
3. Call `verifyOtp` again with the same code → should return `{ valid: false, error: 'NO_ACTIVE_OTP' }`
4. Generate a new OTP, wait 11 minutes (or manually set `expires_at` to the past), then verify → should return `{ valid: false, error: 'OTP_EXPIRED' }`

**Depends on**: Phase 3 (US1) must be complete because `verifyOtp` needs an OTP to exist in the database.

- [x] T005 [US2] Implement `verifyOtp(db, massarCode, otpPlaintext, consumerDeviceHash)` function in `main/linking/otp.js`

**Details for T005**:

Add this function to `main/linking/otp.js`, ABOVE the `module.exports` block, AFTER the `generateOtp` function:

```js
function verifyOtp(db, massarCode, otpPlaintext, consumerDeviceHash) {
    // 1. Validate inputs
    const validation = validateMassarCode(massarCode);
    if (!validation.valid) {
        throw new Error('Invalid MASSAR code format');
    }
    const normalized = validation.normalized;

    if (!consumerDeviceHash || typeof consumerDeviceHash !== 'string' || !consumerDeviceHash.trim()) {
        throw new Error('Consumer device hash is required');
    }

    if (!otpPlaintext || typeof otpPlaintext !== 'string') {
        return { valid: false, error: 'INVALID_OTP' };
    }

    // 2. Check rate limit BEFORE any DB lookup
    if (isRateLimited(normalized)) {
        return { valid: false, error: 'RATE_LIMITED' };
    }

    // 3. Find the active OTP for this MASSAR code
    const row = db
        .prepare(
            `
        SELECT id, otp_hash, expires_at, status
        FROM device_otp
        WHERE massar_code = ? AND status = 'active'
        ORDER BY id DESC
        LIMIT 1
    `
        )
        .get(normalized);

    if (!row) {
        return { valid: false, error: 'NO_ACTIVE_OTP' };
    }

    // 4. Check if expired (TTL elapsed)
    const expiresAt = new Date(row.expires_at);
    if (Date.now() > expiresAt.getTime()) {
        // Mark as expired in DB
        db.prepare(`UPDATE device_otp SET status = 'expired' WHERE id = ?`).run(row.id);
        return { valid: false, error: 'OTP_EXPIRED' };
    }

    // 5. Verify the OTP hash using timing-safe comparison
    const matches = verifyPassword(otpPlaintext, row.otp_hash);

    if (!matches) {
        // Record failed attempt for rate limiting
        recordFailedAttempt(normalized);
        return { valid: false, error: 'INVALID_OTP' };
    }

    // 6. Success — mark OTP as used
    const now = new Date().toISOString();
    db.prepare(
        `
        UPDATE device_otp
        SET status = 'used', used_by_device = ?, used_at = ?
        WHERE id = ?
    `
    ).run(consumerDeviceHash.trim(), now, row.id);

    // 7. Reset rate limit on success
    resetAttempts(normalized);

    return { valid: true };
}
```

**What this does step by step**:

1. Validates MASSAR code format (throws if invalid)
2. Validates consumer device hash is non-empty (throws if empty)
3. Validates OTP plaintext is provided (returns error if missing)
4. Checks in-memory rate limit BEFORE touching the database — if 5+ failures in the last 10 minutes, returns `{ valid: false, error: 'RATE_LIMITED' }` immediately
5. Queries the `device_otp` table for an active OTP matching this MASSAR code (uses the `idx_device_otp_massar_status` index)
6. If no active OTP found → returns `{ valid: false, error: 'NO_ACTIVE_OTP' }`
7. If the OTP has expired (current time > `expires_at`) → marks it as `'expired'` in the DB and returns `{ valid: false, error: 'OTP_EXPIRED' }`
8. Verifies the submitted plaintext against the stored scrypt hash using `verifyPassword()` from `main/auth/password.js` — this is timing-safe (uses `crypto.timingSafeEqual`)
9. If hash doesn't match → records a failed attempt for rate limiting and returns `{ valid: false, error: 'INVALID_OTP' }`
10. If hash matches → updates the DB row to `status = 'used'`, records `used_by_device` and `used_at`, resets the rate limit counter, and returns `{ valid: true }`

**Error response codes**:

- `RATE_LIMITED` — too many failed attempts (FR-007, FR-008)
- `NO_ACTIVE_OTP` — no active OTP exists for this MASSAR code
- `OTP_EXPIRED` — OTP exists but past its 10-minute TTL (FR-004)
- `INVALID_OTP` — code doesn't match the hash (FR-005)

**Checkpoint**: Both `generateOtp` and `verifyOtp` work end-to-end. The core linking flow is functional: admin generates a code, second device verifies it.

---

## Phase 5: User Story 3 — Brute-Force Protection (Priority: P2)

**Goal**: The rate limiting already implemented in the internal helpers (T003) and wired into `verifyOtp` (T005) provides brute-force protection. This phase validates that the integration works correctly.

**Independent Test**: Generate an OTP, then call `verifyOtp` with 5 different wrong codes. The 6th call (even with the correct code) should return `{ valid: false, error: 'RATE_LIMITED' }`.

**No new tasks needed** — brute-force protection was implemented as part of T003 (rate-limit helpers) and T005 (`verifyOtp` checks `isRateLimited` before any DB work). The rate limit is already integrated.

**Verification**: The following behavior is already in place from T003 + T005:

- `isRateLimited()` is called at the top of `verifyOtp` (line: "Check rate limit BEFORE any DB lookup")
- `recordFailedAttempt()` is called on hash mismatch (line: "Record failed attempt for rate limiting")
- `resetAttempts()` is called on success and on new OTP generation
- The window auto-resets after 10 minutes via the timestamp check in `isRateLimited()`

**Checkpoint**: Rate limiting is active. After 5 failures within 10 minutes, further attempts are blocked regardless of correctness.

---

## Phase 6: User Story 4 — Admin Checks OTP Status (Priority: P3)

**Goal**: An admin can call `getActiveOtp()` to check if an active OTP exists and how much time remains.

**Independent Test**: Generate an OTP, then call `getActiveOtp(db, 'M320456')` → should return `{ active: true, expiresAt: '...', remainingSeconds: ~600 }`. After the OTP is used or expired, calling `getActiveOtp` → should return `{ active: false }`.

- [x] T006 [US4] Implement `getActiveOtp(db, massarCode)` function in `main/linking/otp.js`

**Details for T006**:

Add this function to `main/linking/otp.js`, ABOVE the `module.exports` block, AFTER the `verifyOtp` function:

```js
function getActiveOtp(db, massarCode) {
    const validation = validateMassarCode(massarCode);
    if (!validation.valid) {
        return { active: false };
    }
    const normalized = validation.normalized;

    const row = db
        .prepare(
            `
        SELECT expires_at
        FROM device_otp
        WHERE massar_code = ? AND status = 'active'
        ORDER BY id DESC
        LIMIT 1
    `
        )
        .get(normalized);

    if (!row) {
        return { active: false };
    }

    const expiresAt = new Date(row.expires_at);
    const remainingMs = expiresAt.getTime() - Date.now();

    if (remainingMs <= 0) {
        // Expired but not yet cleaned up — mark it
        db.prepare(
            `
            UPDATE device_otp SET status = 'expired'
            WHERE massar_code = ? AND status = 'active'
        `
        ).run(normalized);
        return { active: false };
    }

    return {
        active: true,
        expiresAt: expiresAt.toISOString(),
        remainingSeconds: Math.ceil(remainingMs / 1000)
    };
}
```

**What this does**:

1. Validates the MASSAR code — returns `{ active: false }` if invalid (does NOT throw, since this is a read-only status check)
2. Queries for the most recent active OTP for this MASSAR code
3. If no active row found → returns `{ active: false }`
4. If the OTP has expired (remaining time <= 0) → marks it as `'expired'` in the DB and returns `{ active: false }`
5. If the OTP is still valid → returns `{ active: true }` with `expiresAt` (ISO 8601 string) and `remainingSeconds` (integer, rounded up)

**Checkpoint**: Admin can check OTP status. The three status scenarios (active, expired, no OTP) are all handled.

---

## Phase 7: User Story 5 — Expired OTP Cleanup (Priority: P3)

**Goal**: The `cleanupExpiredOtps()` function removes all expired and used OTP records from the database to prevent unbounded growth.

**Independent Test**: Insert rows with `status = 'expired'` and `status = 'used'` into `device_otp`, then call `cleanupExpiredOtps(db)` → should return `{ deleted: N }` where N is the count of removed rows. Active rows should be preserved.

- [x] T007 [US5] Implement `cleanupExpiredOtps(db)` function in `main/linking/otp.js`

**Details for T007**:

Add this function to `main/linking/otp.js`, ABOVE the `module.exports` block, AFTER the `getActiveOtp` function:

```js
function cleanupExpiredOtps(db) {
    // Also expire any active OTPs whose TTL has passed (in case they were not caught by verify/getActive)
    db.prepare(
        `
        UPDATE device_otp SET status = 'expired'
        WHERE status = 'active' AND expires_at < datetime('now')
    `
    ).run();

    // Delete all terminal-state records
    const result = db
        .prepare(
            `
        DELETE FROM device_otp
        WHERE status IN ('expired', 'used')
    `
        )
        .run();

    return { deleted: result.changes };
}
```

**What this does**:

1. First pass: finds any active OTPs that are past their `expires_at` time but haven't been marked yet (edge case — could happen if no one called `verifyOtp` or `getActiveOtp` for that record) and sets them to `'expired'`
2. Second pass: deletes ALL rows with `status = 'expired'` or `status = 'used'` — these are terminal states and the records are no longer needed
3. Returns `{ deleted: N }` with the count of deleted rows from the second query

**Checkpoint**: Cleanup works. The `device_otp` table stays clean over time.

---

## Phase 8: Polish & Verification

**Purpose**: Final validation that the complete module passes linting, smoke tests, and follows project conventions.

- [x] T008 Verify the complete `main/linking/otp.js` file passes `npm run lint`
- [x] T009 Verify `npm run test:smoke` passes (no IPC changes, so channel parity should be unaffected)
- [x] T010 Verify the final `module.exports` block exports exactly 5 functions in `main/linking/otp.js`

**Details for T008**:

Run `npm run lint` from the repository root. The file `main/linking/otp.js` must pass with zero errors.

Common issues to check for:

- No unused variables (all three rate-limit helpers are used internally)
- The `crypto` import is used (for `crypto.randomInt`)
- Single quotes, no trailing commas, 4-space indent, semicolons (Prettier style)
- No `console.log` statements (use proper logging if needed, but this module should not log)

If lint fails, fix the issues in `main/linking/otp.js` before proceeding.

---

**Details for T009**:

Run `npm run test:smoke` from the repository root. This module has NO IPC handlers (those are Phase 7.6), so the smoke test's channel parity check should be unaffected — the `preload.js` and `main/ipc/*.js` files are not modified.

If smoke tests fail, investigate — it should NOT be caused by this module. The `device_otp` table already exists from Phase 7.1, so schema checks should pass.

---

**Details for T010**:

Verify the `module.exports` block at the bottom of `main/linking/otp.js` exports exactly these 5 functions:

```js
module.exports = {
    validateMassarCode,
    generateOtp,
    verifyOtp,
    getActiveOtp,
    cleanupExpiredOtps
};
```

The three internal rate-limit helpers (`isRateLimited`, `recordFailedAttempt`, `resetAttempts`) must NOT be exported. They are private to the module.

**Checkpoint**: Module is complete, lint-clean, and ready for integration by Phase 7.6 (IPC handlers).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories
- **US1 — Generate OTP (Phase 3)**: Depends on Phase 2 — this is the MVP
- **US2 — Verify OTP (Phase 4)**: Depends on Phase 3 (needs OTP to exist)
- **US3 — Brute-Force Protection (Phase 5)**: Already done in T003 + T005 — just a verification checkpoint
- **US4 — OTP Status (Phase 6)**: Depends on Phase 2 only — can run in parallel with US1/US2
- **US5 — Cleanup (Phase 7)**: Depends on Phase 2 only — can run in parallel with US1/US2
- **Polish (Phase 8)**: Depends on ALL phases complete

### User Story Dependencies

- **US1 (P1)**: Depends on Foundational (Phase 2) only
- **US2 (P1)**: Depends on US1 (needs `generateOtp` to create OTP records to verify against)
- **US3 (P2)**: No additional tasks — already integrated into US2
- **US4 (P3)**: Depends on Foundational (Phase 2) only — can be implemented before or after US1
- **US5 (P3)**: Depends on Foundational (Phase 2) only — can be implemented before or after US1

### Within the Module

Since this is a single file, tasks are mostly sequential. However:

- T006 (getActiveOtp) and T007 (cleanupExpiredOtps) are independent of each other and of T005 (verifyOtp) — they only depend on the foundational helpers from Phase 2.

### Parallel Opportunities

```
Phase 2 complete
    ├── T004 (generateOtp)  ── sequential ──►  T005 (verifyOtp)
    ├── T006 (getActiveOtp)     [can run in parallel with T004]
    └── T007 (cleanupExpiredOtps) [can run in parallel with T004]
```

---

## Parallel Example: After Phase 2

```text
# These can all run in parallel after Phase 2 is complete:
Task T004: [US1] Implement generateOtp function
Task T006: [US4] Implement getActiveOtp function
Task T007: [US5] Implement cleanupExpiredOtps function

# This must wait for T004:
Task T005: [US2] Implement verifyOtp function (needs generateOtp to create OTP rows)
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2 Only)

1. Complete Phase 1: Setup (T001)
2. Complete Phase 2: Foundational (T002, T003)
3. Complete Phase 3: US1 — generateOtp (T004)
4. Complete Phase 4: US2 — verifyOtp (T005)
5. **STOP and VALIDATE**: The core OTP flow works end-to-end
6. Run lint + smoke (T008, T009)

### Full Delivery

1. Setup + Foundational → T001, T002, T003
2. US1 (generateOtp) → T004
3. US2 (verifyOtp) → T005 — **Core flow complete**
4. US4 (getActiveOtp) → T006
5. US5 (cleanupExpiredOtps) → T007
6. Polish → T008, T009, T010

### Single-File Strategy

Since all tasks modify the same file (`main/linking/otp.js`), the recommended approach is:

1. Create the file skeleton with constants, requires, and exports (T001)
2. Add functions one by one in order: validateMassarCode → rate-limit helpers → generateOtp → verifyOtp → getActiveOtp → cleanupExpiredOtps
3. Run lint after each function to catch issues early
4. Final lint + smoke after all functions are in place

---

## Complete File Reference

When all tasks are complete, `main/linking/otp.js` should contain, in order:

1. `require` statements (`crypto`, `hashPassword`, `verifyPassword`) — from T001
2. Constants (`OTP_TTL_MS`, `MAX_OTP_ATTEMPTS`, `OTP_ATTEMPT_WINDOW_MS`, `MASSAR_CODE_REGEX`) — from T001
3. Rate limit Map (`OTP_ATTEMPTS`) — from T001
4. `validateMassarCode()` — from T002
5. `isRateLimited()`, `recordFailedAttempt()`, `resetAttempts()` — from T003 (NOT exported)
6. `generateOtp()` — from T004
7. `verifyOtp()` — from T005
8. `getActiveOtp()` — from T006
9. `cleanupExpiredOtps()` — from T007
10. `module.exports` block — from T001

Total: ~150–200 lines, single file, no new dependencies.

---

## Notes

- All code uses single quotes, no trailing commas, 4-space indent, semicolons (Prettier config)
- Database column names are snake_case (`massar_code`, `otp_hash`, `used_by_device`)
- Function names are camelCase (`validateMassarCode`, `generateOtp`)
- The `device_otp` table already exists — do NOT create it or modify `main/db/schema.js`
- This module has NO IPC handlers — do NOT modify `preload.js`, `main/ipc/registerAll.js`, or create `main/ipc/linking.js` (that is Phase 7.6)
- The `crypto` import is used only for `crypto.randomInt()` — all hashing goes through `hashPassword`/`verifyPassword`
- Rate limiting resets on app restart — this is acceptable because OTPs are also effectively invalid after restart (the linking flow would need to restart)
