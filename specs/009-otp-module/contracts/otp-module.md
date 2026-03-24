# Module Contract: `main/linking/otp.js`

**Feature**: 009-otp-module | **Date**: 2026-03-22

This module is a pure logic layer — no IPC handlers, no side effects beyond database writes. All functions accept `db` as the first parameter for testability.

## Exported Functions

### `generateOtp(db, massarCode, creatorDeviceHash) → { otp, expiresAt }`

Generates a cryptographically random 6-digit OTP for the given institution.

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| db | Database | Yes | better-sqlite3 instance |
| massarCode | string | Yes | Institution MASSAR code (validated) |
| creatorDeviceHash | string | Yes | Device hash of the admin generating the OTP |

**Returns**: `{ otp: string, expiresAt: string }`
- `otp`: The 6-digit plaintext code (returned once, never persisted)
- `expiresAt`: ISO 8601 UTC timestamp (creation time + 10 minutes)

**Side effects**:
- Invalidates any previous active OTP for the same MASSAR code (sets `status = 'expired'`)
- Inserts a new row into `device_otp` with the scrypt hash of the OTP
- Resets the in-memory rate limit counter for the MASSAR code

**Errors**:
- Throws if `massarCode` fails format validation
- Throws if `creatorDeviceHash` is empty

---

### `verifyOtp(db, massarCode, otpPlaintext, consumerDeviceHash) → { valid, error? }`

Verifies a submitted OTP against the stored hash.

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| db | Database | Yes | better-sqlite3 instance |
| massarCode | string | Yes | Institution MASSAR code |
| otpPlaintext | string | Yes | The 6-digit code submitted by the linking device |
| consumerDeviceHash | string | Yes | Device hash of the device attempting to link |

**Returns**: `{ valid: boolean, error?: string }`
- `valid: true` — OTP verified and marked as used
- `valid: false, error: 'RATE_LIMITED'` — too many failed attempts
- `valid: false, error: 'NO_ACTIVE_OTP'` — no active OTP for this MASSAR code
- `valid: false, error: 'OTP_EXPIRED'` — OTP exists but has expired
- `valid: false, error: 'INVALID_OTP'` — code does not match hash

**Side effects**:
- On success: sets `status = 'used'`, `used_by_device`, `used_at` on the OTP record
- On failure: increments in-memory rate limit counter for the MASSAR code

**Errors**:
- Throws if `massarCode` fails format validation
- Throws if `consumerDeviceHash` is empty

---

### `getActiveOtp(db, massarCode) → { active, expiresAt?, remainingSeconds? } | null`

Checks whether an active (non-expired) OTP exists for the given MASSAR code.

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| db | Database | Yes | better-sqlite3 instance |
| massarCode | string | Yes | Institution MASSAR code |

**Returns**: `{ active: boolean, expiresAt?: string, remainingSeconds?: number }`
- `active: true` — an OTP is active with `expiresAt` and `remainingSeconds`
- `active: false` — no active OTP (expired, used, or never created)

**Side effects**: None (read-only).

---

### `cleanupExpiredOtps(db) → { deleted: number }`

Removes all expired and used OTP records from the database.

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| db | Database | Yes | better-sqlite3 instance |

**Returns**: `{ deleted: number }` — count of removed records.

**Side effects**: Deletes rows from `device_otp` where `status IN ('expired', 'used')` or `expires_at < datetime('now')`.

---

### `validateMassarCode(massarCode) → { valid, normalized? }`

Validates and normalizes a MASSAR code string.

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| massarCode | string | Yes | Raw MASSAR code input |

**Returns**: `{ valid: boolean, normalized?: string }`
- `valid: true, normalized: 'M320456'` — trimmed and uppercased
- `valid: false` — empty, too short/long, or contains invalid characters

**Side effects**: None (pure function).

## Internal (non-exported)

### Rate Limit State

```js
const OTP_ATTEMPTS = new Map(); // massarCode → { count, firstFailure }
const MAX_OTP_ATTEMPTS = 5;
const OTP_ATTEMPT_WINDOW_MS = 10 * 60_000; // 10 minutes
```

- `isRateLimited(massarCode) → boolean` — checks if attempts exceed threshold within window
- `recordFailedAttempt(massarCode)` — increments counter, sets firstFailure if new window
- `resetAttempts(massarCode)` — clears counter (called on successful verify or new OTP generation)
