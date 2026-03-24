# Research: OTP Module for Device Linking

**Feature**: 009-otp-module | **Date**: 2026-03-22

## Research Tasks & Findings

### R1: OTP Hashing — Reuse of Existing Password Infrastructure

**Decision**: Reuse `hashPassword()` / `verifyPassword()` from `main/auth/password.js` for OTP hashing.

**Rationale**: These functions already implement scrypt with 64-byte key length, random 16-byte salts, and timing-safe comparison via `crypto.timingSafeEqual`. The OTP is a 6-digit string — `hashPassword(String(otp))` works directly. No new cryptographic code is needed.

**Alternatives considered**:
- HMAC-SHA256: Faster but unnecessary — OTP generation is infrequent (once per linking session). Scrypt's computational cost is actually beneficial here as it slows brute-force attempts.
- bcrypt: Would require a new dependency. Rejected per constitution (V: "Prefer Node.js built-ins").

### R2: Rate Limiting Strategy — In-Memory vs Database

**Decision**: In-memory `Map` keyed by MASSAR code, following the `LOGIN_ATTEMPTS` pattern in `main/ipc/auth.js`.

**Rationale**: The existing login throttling (`auth.js:10-43`) provides an exact template: `Map<key, { count, lockedUntil, lastAttempt }>` with periodic cleanup. OTP verification is a main-process operation, so in-memory tracking is sufficient. The rate limit window (10 min) is short enough that persistence across restarts is unnecessary — a restarted app resets the counter, which is acceptable since it also resets the OTP itself (active OTPs are DB-stored but the linking flow would need to be restarted).

**Alternatives considered**:
- Database column (`failed_attempts` on `device_otp`): Would persist across restarts but adds write overhead on every failed attempt. Rejected — the `device_otp` table doesn't have a `failed_attempts` column, and the in-memory pattern is simpler and proven.
- `pin_failed_attempts` column: Exists in schema but is unused and scoped to user records, not OTP records. Not repurposable.

### R3: OTP Generation — Cryptographic Randomness

**Decision**: Use `crypto.randomInt(100000, 999999)` for 6-digit code generation.

**Rationale**: `crypto.randomInt()` is Node.js built-in, cryptographically secure, and produces uniform distribution over the range. The range 100000–999999 gives 900,000 possible values. Combined with the 5-attempt rate limit, the probability of a successful brute-force attack is 5/900,000 ≈ 0.00056% per OTP window.

**Alternatives considered**:
- `Math.random()`: Not cryptographically secure. Rejected.
- Longer codes (8+ digits): Harder to communicate verbally in a school setting. The 6-digit code with rate limiting provides adequate security for a device-linking use case (not financial transactions).

### R4: Device Identification

**Decision**: Use `collectCurrentFingerprint()` from `main/licensing/deviceFingerprint.js` to obtain `deviceHash`.

**Rationale**: The function already exists, returns a stable SHA-256 hash derived from hardware signals (CPU, BIOS serial, baseboard serial, MACs, memory bucket). The `deviceHash` string is the natural identifier for `created_by_device` and `used_by_device` fields in `device_otp`.

**Alternatives considered**:
- UUID per installation: Would require additional storage and management. The hardware fingerprint is already used throughout the licensing system.

### R5: MASSAR Code Validation

**Decision**: Validate MASSAR codes with a regex pattern. Accept alphanumeric codes of 5–10 characters, optionally prefixed with "M".

**Rationale**: Moroccan MASSAR codes (رمز مسار) are Ministry-assigned school identifiers. The exact format varies but they are short alphanumeric strings. A permissive regex (`/^[A-Za-z0-9]{5,10}$/`) prevents empty/malformed input without being overly restrictive about a format we don't fully control.

**Alternatives considered**:
- Strict "M" prefix requirement: Some schools may have codes without the "M" prefix. Keeping validation permissive avoids rejecting valid codes.
- No validation: Would allow empty strings and special characters to pollute the database. Rejected.

### R6: Cleanup Strategy

**Decision**: Provide a `cleanupExpiredOtps(db)` function that deletes records where `status = 'expired'` or `expires_at < now`. Called on-demand (e.g., at app startup or before generating a new OTP).

**Rationale**: OTP records accumulate slowly (at most one per linking session). Aggressive real-time cleanup is unnecessary. A simple DELETE query on expired/used records suffices. The `idx_device_otp_massar_status` index supports efficient status-based queries.

**Alternatives considered**:
- Periodic timer (setInterval): Adds complexity for a table that will rarely have more than a few rows. Rejected.
- TTL-based auto-delete: SQLite doesn't support automatic TTL deletion like DynamoDB. Manual cleanup is the only option.

### R7: IPC Handler Pattern for OTP — Pre-Auth vs Post-Auth

**Decision**: OTP operations split into two categories:
- **Pre-auth** (raw `ipcMain.handle`): `linking:verifyAndLink` — used during device setup before any user is logged in.
- **Post-auth** (`handleWrite` with `['admin']` role): `linking:generateOtp`, `linking:cancelOtp`, `linking:getOtpStatus` — admin-only operations.

**Rationale**: The Phase 7.2 OTP module itself is a pure logic module (`main/linking/otp.js`) with no IPC handlers — those belong to Phase 7.6. However, the OTP module's function signatures must be designed to work with both calling contexts. Functions accept `db` as a parameter (not calling `getDb()` internally) to remain testable and consistent with the IPC helper pattern.

**Alternatives considered**:
- All functions call `getDb()` internally: Would make unit testing harder. The existing pattern in schema helpers (accepting `existingDb || getDb()`) is the project convention.
