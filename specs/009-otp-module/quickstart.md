# Quickstart: OTP Module for Device Linking

**Feature**: 009-otp-module | **Date**: 2026-03-22

## Prerequisites

1. Phase 7.1 (Database Schema) must be complete — the `device_otp` table must exist
2. Node.js environment with `better-sqlite3` and `crypto` (built-in)
3. Existing `main/auth/password.js` module available

## New File

```
main/linking/otp.js    # OTP generation, verification, cleanup, validation
```

## Development Steps

### 1. Create the module file

```bash
mkdir -p main/linking
touch main/linking/otp.js
```

### 2. Implement the five exported functions

Follow the contract in `contracts/otp-module.md`:

1. `validateMassarCode(massarCode)` — pure validation, no DB
2. `generateOtp(db, massarCode, creatorDeviceHash)` — generate + hash + insert
3. `verifyOtp(db, massarCode, otpPlaintext, consumerDeviceHash)` — rate check + hash verify + mark used
4. `getActiveOtp(db, massarCode)` — read-only status check
5. `cleanupExpiredOtps(db)` — delete stale records

### 3. Verify

```bash
npm run lint          # ESLint must pass
npm run test:smoke    # Smoke tests must pass (no IPC changes in this phase)
```

## Integration Notes

- This module has **no IPC handlers** — it is a pure logic layer consumed by Phase 7.6 (`main/ipc/linking.js`)
- All functions accept `db` as the first parameter (consistent with the `ensureInstitutionSchema(existingDb)` pattern)
- Rate limiting is in-memory (`Map`) — resets on app restart, which is acceptable since OTPs also effectively reset (the linking flow would need to restart)
- The module imports from `main/auth/password.js` only — no new dependencies

## Usage Example (from future IPC handler)

```js
const { generateOtp, verifyOtp } = require('../linking/otp');
const { getDb } = require('../db/context');

// Admin generates OTP
const db = getDb();
const { otp, expiresAt } = generateOtp(db, 'M320456', adminDeviceHash);
// → otp = '847291', expiresAt = '2026-03-22T10:10:00.000Z'

// Device 2 verifies OTP
const result = verifyOtp(db, 'M320456', '847291', device2Hash);
// → { valid: true }
```
