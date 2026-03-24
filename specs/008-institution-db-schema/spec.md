# Feature Specification: Institution Device Linking — Database Schema

**Feature Branch**: `008-institution-db-schema`
**Created**: 2026-03-22
**Status**: Draft
**Input**: User description: "Phase 7.1 Database Schema from the Institution Device Linking plan — three new tables (institution_config, device_otp, linked_devices) and a migration for existing installations"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Fresh Installation Setup (Priority: P1)

A school installs the application for the first time. The database initializes with all required institution and device-linking tables so that the first-run setup flow (future phase) can store institution configuration, generate OTPs for device linking, and register the first device.

**Why this priority**: Without the schema, no other device-linking feature can function. This is the foundational data layer.

**Independent Test**: Can be tested by launching the app on a fresh database and verifying all three new tables exist with correct columns, constraints, and defaults.

**Acceptance Scenarios**:

1. **Given** a fresh installation with no existing database, **When** the application starts and runs `createTables()`, **Then** tables `institution_config`, `device_otp`, and `linked_devices` are created with all specified columns and constraints.
2. **Given** a fresh installation, **When** the application starts, **Then** the `institution_config` table contains no rows (setup has not been completed yet).
3. **Given** a fresh installation, **When** the application starts, **Then** the `linked_devices` table enforces uniqueness on `device_hash`.

---

### User Story 2 - Existing Installation Upgrade (Priority: P1)

A school already using the application with sync configured (`sync_config.school_id` populated) upgrades to the new version. The migration automatically creates the new tables and pre-populates `institution_config` with the existing school ID as the MASSAR code, marking setup as completed so the school is not forced through the first-run wizard again.

**Why this priority**: Existing deployments must upgrade seamlessly without data loss or workflow disruption. Equal priority with fresh install.

**Independent Test**: Can be tested by creating a database with a populated `sync_config.school_id`, running migrations, and verifying `institution_config` is auto-populated with `setup_completed = 1`.

**Acceptance Scenarios**:

1. **Given** an existing database with `sync_config.school_id = 'M320456'`, **When** the migration runs, **Then** `institution_config` is created with `massar_code = 'M320456'` and `setup_completed = 1`.
2. **Given** an existing database with `sync_config.school_id` empty or NULL, **When** the migration runs, **Then** `institution_config` is created but `setup_completed` remains `0` (user must complete setup).
3. **Given** an existing database that has already run the migration, **When** the migration runs again, **Then** no error occurs (idempotent).

---

### User Story 3 - Schema Supports OTP Lifecycle (Priority: P2)

An administrator generates a one-time password for device linking. The `device_otp` table stores the hashed OTP with expiry, tracks its lifecycle (active / used / expired), and supports rate-limiting by recording failed attempts per MASSAR code.

**Why this priority**: OTP storage is essential for the linking flow but depends on the OTP module (Phase 7.2) to exercise fully. The schema must be ready first.

**Independent Test**: Can be tested by inserting OTP records directly and verifying constraints, defaults, and status transitions.

**Acceptance Scenarios**:

1. **Given** the `device_otp` table exists, **When** an OTP record is inserted with `massar_code` and `otp_hash`, **Then** `status` defaults to `'active'` and `expires_at` must be explicitly provided.
2. **Given** an active OTP record, **When** the status is updated to `'used'` with `used_by_device` and `used_at`, **Then** the update succeeds.
3. **Given** the `device_otp` table, **When** a record is inserted without `otp_hash`, **Then** the insert fails (NOT NULL constraint).

---

### User Story 4 - Schema Supports Device Registry (Priority: P2)

The system tracks all devices linked to an institution. The `linked_devices` table records each device with its hash, metadata, linking method, and lifecycle status (active/revoked), supporting the device management UI (Phase 7.7).

**Why this priority**: Device tracking is needed for the management UI and sync integration but depends on IPC and UI phases to be fully useful.

**Independent Test**: Can be tested by inserting device records and verifying uniqueness on `device_hash`, default status, and nullable fields.

**Acceptance Scenarios**:

1. **Given** the `linked_devices` table exists, **When** a device record is inserted with `device_hash = 'abc123'`, **Then** the record is created with `status = 'active'` by default.
2. **Given** an existing device with `device_hash = 'abc123'`, **When** another device with the same hash is inserted, **Then** the insert fails (UNIQUE constraint).
3. **Given** a linked device, **When** its status is updated to `'revoked'` with `revoked_at` set, **Then** the update succeeds and the device is effectively deregistered.

---

### Edge Cases

- What happens when the migration runs on a database that already has the `institution_config` table (e.g., partial migration from a crash)? All DDL uses `CREATE TABLE IF NOT EXISTS`, so no error occurs.
- What happens when `sync_config` table does not exist at migration time? The `sync_config` table is created by `ensureSyncSchema()` which runs in `createTables()` before migrations — it will always exist.
- What happens when `sync_config.school_id` contains whitespace-only values? These are treated as empty (not populated into `massar_code`).
- What happens when the `institution_config` singleton row (id=1) already exists during migration? The migration uses `INSERT OR IGNORE` to skip if already present.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST create an `institution_config` table with columns: `id` (singleton, always 1), `massar_code`, `institution_name`, `setup_completed` (default 0), `setup_mode`, `setup_device_hash`, `created_at`, `updated_at`.
- **FR-002**: System MUST create a `device_otp` table with columns: `id`, `otp_hash` (NOT NULL), `massar_code` (NOT NULL), `created_by_device`, `expires_at` (NOT NULL), `used_by_device`, `used_at`, `status` (default 'active').
- **FR-003**: System MUST create a `linked_devices` table with columns: `id`, `device_hash` (UNIQUE, NOT NULL), `device_name`, `os_platform`, `app_version`, `linked_by`, `linked_at`, `last_seen_at`, `revoked_at`, `status` (default 'active').
- **FR-004**: System MUST enforce a singleton constraint on `institution_config` (only one row with `id = 1` allowed).
- **FR-005**: System MUST enforce uniqueness on `linked_devices.device_hash` to prevent duplicate device registrations.
- **FR-006**: System MUST include a migration that auto-populates `institution_config.massar_code` from `sync_config.school_id` for existing installations, setting `setup_completed = 1` and `setup_mode = 'linked'`.
- **FR-007**: The migration MUST treat empty or whitespace-only `sync_config.school_id` values as not configured (leave `setup_completed = 0`).
- **FR-008**: All DDL MUST be idempotent — using `CREATE TABLE IF NOT EXISTS` and `INSERT OR IGNORE` patterns consistent with the existing codebase.
- **FR-009**: The new schema function (`ensureInstitutionSchema`) MUST be called from `createTables()` following the existing pattern used by `ensureSyncSchema`, `ensureLicensingSchema`, etc.
- **FR-010**: System MUST create indexes on `device_otp(massar_code, status)` and `linked_devices(status)` for query performance.

### Key Entities

- **Institution Config**: Singleton record representing the school's identity and setup state. Links to the MASSAR code (Ministry school identifier). Determines whether the first-run setup screen is shown.
- **Device OTP**: Temporary one-time password records used during device linking. Has a lifecycle of active / used / expired. Associated with a MASSAR code and the device that created it.
- **Linked Devices**: Registry of all devices connected to this institution. Identified by hardware fingerprint hash. Tracks linking method (new setup, LAN OTP, or server OTP) and lifecycle (active/revoked).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Application starts successfully on a fresh database with all three new tables created — zero errors in the console log.
- **SC-002**: Existing installations with a configured school ID upgrade without any user intervention — `institution_config` is auto-populated and setup screen is bypassed.
- **SC-003**: All existing smoke tests (`npm run test:smoke`) continue to pass after the schema changes.
- **SC-004**: Lint checks (`npm run lint`) pass for all modified files with zero new warnings.
- **SC-005**: The migration completes in under 1 second for a typical school database (fewer than 10,000 total rows across all tables).
