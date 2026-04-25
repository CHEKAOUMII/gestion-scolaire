# Data Model: OTP Module for Device Linking

**Feature**: 009-otp-module | **Date**: 2026-03-22

## Entities

### OTP Record (`device_otp` table — already exists from Phase 7.1)

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Row identifier |
| otp_hash | TEXT | NOT NULL | Scrypt hash of the 6-digit OTP (`scrypt$<salt>$<hash>`) |
| massar_code | TEXT | NOT NULL | Institution MASSAR code this OTP belongs to |
| created_by_device | TEXT | | Device hash of the admin who generated the OTP |
| expires_at | DATETIME | NOT NULL | UTC timestamp when the OTP becomes invalid (creation + 10 min) |
| used_by_device | TEXT | | Device hash of the device that consumed the OTP |
| used_at | DATETIME | | UTC timestamp when the OTP was consumed |
| status | TEXT | DEFAULT 'active' | Lifecycle state: `active` → `used` or `expired` |

**Index**: `idx_device_otp_massar_status` on `(massar_code, status)` — supports lookups by institution + active status.

### State Transitions

```
                 ┌─────────────┐
     generate    │             │   verify (correct code)
  ──────────────►│   active    ├──────────────────────────►  used
                 │             │
                 └──────┬──────┘
                        │
                        │  TTL expires (10 min)
                        │  or new OTP generated
                        ▼
                     expired
```

- **active → used**: Successful verification. Sets `used_by_device`, `used_at`, `status = 'used'`.
- **active → expired**: Either TTL elapsed (checked at verification time) or a new OTP was generated for the same MASSAR code (previous one set to `expired`).
- Terminal states: `used` and `expired` are final. Records in these states are candidates for cleanup.

### Rate Limit Window (in-memory only — not persisted)

| Field | Type | Description |
|-------|------|-------------|
| key | string | MASSAR code being rate-limited |
| count | number | Number of failed verification attempts in the current window |
| firstFailure | number | Timestamp (ms) of the first failure in the current window |

**Lifecycle**: Created on first failed OTP verification for a MASSAR code. Incremented on each subsequent failure. Reset when 10 minutes have elapsed since `firstFailure`, or when a new OTP is generated for the same MASSAR code.

**Storage**: `Map<string, { count: number, firstFailure: number }>` in the module scope of `main/linking/otp.js`.

## Validation Rules

### MASSAR Code
- Must be a non-empty string
- Must match pattern: `/^[A-Za-z0-9]{5,10}$/` (5–10 alphanumeric characters)
- Trimmed and uppercased before use

### OTP Code
- Must be a 6-digit numeric string (range 100000–999999)
- Generated via `crypto.randomInt(100000, 999999)`
- Plaintext never stored — only the scrypt hash

### Device Hash
- Must be a non-empty string
- Obtained from `collectCurrentFingerprint().deviceHash`
- SHA-256 hex string (64 characters)

## Relationships

```
institution_config (1) ──── massar_code ────── (N) device_otp
                   (1) ──── massar_code ────── (N) linked_devices
```

- One institution has many OTP records (historical lifecycle)
- One institution has many linked devices
- An OTP record's `used_by_device` corresponds to a `linked_devices.device_hash` (created by Phases 7.5/7.6, not this module)
