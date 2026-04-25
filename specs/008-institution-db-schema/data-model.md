# Data Model: Institution Device Linking — Database Schema

**Feature**: `008-institution-db-schema`
**Date**: 2026-03-22

## Entities

### institution_config (Singleton)

Represents the school's identity and device-linking setup state. Exactly one row (id=1) exists after setup is completed.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY, CHECK(id = 1) | Singleton enforcer |
| massar_code | TEXT | — | Ministry school identifier (e.g. "M320456") |
| institution_name | TEXT | — | Optional display name for the school |
| setup_completed | INTEGER | DEFAULT 0 | 0 = not set up, 1 = setup done |
| setup_mode | TEXT | — | 'new' (first device) or 'linked' (joined via OTP) |
| setup_device_hash | TEXT | — | Device fingerprint hash of the device that completed setup |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | Row creation timestamp |
| updated_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | Last modification timestamp |

**State transitions**: Empty → setup_completed=0 (tables created) → setup_completed=1 (setup wizard or migration completed)

**Relationships**: `massar_code` becomes the canonical `schoolId` used as DynamoDB partition key in `sync_config.school_id`.

---

### device_otp (Transient)

Stores hashed one-time passwords for device linking. Records are short-lived (10-minute TTL) and transition through a lifecycle.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Auto-incrementing ID |
| otp_hash | TEXT | NOT NULL | scrypt hash of the 6-digit OTP code |
| massar_code | TEXT | NOT NULL | Institution this OTP is for |
| created_by_device | TEXT | — | Device hash of the admin who generated the OTP |
| expires_at | DATETIME | NOT NULL | When this OTP expires (created_at + 10 min) |
| used_by_device | TEXT | — | Device hash of the device that consumed the OTP |
| used_at | DATETIME | — | When the OTP was consumed |
| status | TEXT | DEFAULT 'active' | Lifecycle: active → used \| expired |

**State transitions**: active → used (consumed by a device) OR active → expired (TTL elapsed, cleaned up)

**Indexes**: Composite index on `(massar_code, status)` for OTP lookup and rate-limiting queries.

---

### linked_devices (Persistent)

Registry of all devices connected to the institution. Persists across app restarts.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Auto-incrementing ID |
| device_hash | TEXT | UNIQUE, NOT NULL | Hardware fingerprint hash (from deviceFingerprint.js) |
| device_name | TEXT | — | Human-readable device name (hostname) |
| os_platform | TEXT | — | Operating system (e.g. 'win32', 'linux') |
| app_version | TEXT | — | Application version at link time |
| linked_by | TEXT | — | How the device was linked: 'setup_new', 'otp_lan', 'otp_server' |
| linked_at | DATETIME | — | When the device was linked |
| last_seen_at | DATETIME | — | Updated each sync cycle |
| revoked_at | DATETIME | — | When admin revoked this device (NULL if active) |
| status | TEXT | DEFAULT 'active' | Lifecycle: active → revoked |

**State transitions**: active → revoked (admin revokes device)

**Indexes**: Index on `(status)` for filtering active/revoked devices in the management UI.

---

## Entity Relationships

```
institution_config (1)
    │
    ├── massar_code ──── device_otp.massar_code (1:N, logical)
    │
    └── massar_code ──── linked_devices (1:N, logical — no FK)
```

Relationships are logical (query-based), not enforced via foreign keys. This matches the project's pattern for cross-domain tables (e.g., `sync_config` has no FK to `sync_outbox`).

## Validation Rules

- `massar_code`: Application-level format validation (Phase 7.5). No DB-level CHECK constraint — format rules may evolve.
- `device_otp.status`: Application enforces valid transitions (active→used, active→expired). No CHECK constraint — matches existing `sync_outbox.status` pattern.
- `linked_devices.device_hash`: Uniqueness enforced at DB level via UNIQUE constraint. Application uses `INSERT OR REPLACE` or checks before insert.
- `institution_config.id`: Singleton enforced via `CHECK(id = 1)` — only one institution per device.
