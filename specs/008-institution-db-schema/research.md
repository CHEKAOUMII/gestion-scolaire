# Research: Institution Device Linking — Database Schema

**Feature**: `008-institution-db-schema`
**Date**: 2026-03-22

## R-001: Singleton Table Pattern

**Decision**: Use `INTEGER PRIMARY KEY CHECK(id = 1)` for `institution_config`.

**Rationale**: This is the exact pattern already used by `sync_config` and `owner_sync_config` in the codebase. The `CHECK(id = 1)` constraint ensures only one row can ever exist, enforced at the database engine level.

**Alternatives considered**:
- Key-value store (like `settings` table): Rejected — institution config has a fixed schema with typed columns; a KV store would require casting and lacks constraint enforcement.
- Application-level singleton enforcement: Rejected — database-level constraint is more robust and matches existing patterns.

## R-002: Migration Version String Convention

**Decision**: Use version string `2026-03-035-institution-device-linking`.

**Rationale**: The existing migration array ends at `2026-03-034-sync-config-license-key`. The next sequential number is `035`. The project convention uses `YYYY-MM-NNN-description` format.

**Alternatives considered**:
- The plan document suggested `2026-03-026-institution-device-linking` but this conflicts with the existing `2026-03-026-school-events-table` migration. Sequential numbering from the current last entry (`034`) is correct.

## R-003: Migration Data Population Strategy

**Decision**: Read `sync_config.school_id` and conditionally populate `institution_config` using `INSERT OR IGNORE` with `TRIM()` + `COALESCE()` to handle whitespace/NULL.

**Rationale**: The `sync_config` table is guaranteed to exist because `ensureSyncSchema()` runs in `createTables()` before `runMigrations()`. The migration must handle three cases: (1) school_id has a real value → populate massar_code + set setup_completed=1, (2) school_id is empty/NULL → create table only, (3) institution_config already exists → no-op via INSERT OR IGNORE.

**Alternatives considered**:
- Reading from `school_identity.school_code` instead: Rejected — `sync_config.school_id` is the authoritative sync partition key; `school_identity` is for display/reports only.
- Running the migration as a schema function (like `ensureInstitutionSchema`): Rejected — the data population logic is one-time migration work and should not re-run on every startup. The schema function creates tables; the migration populates data.

## R-004: Schema Function vs Migration Responsibilities

**Decision**: Split work between `ensureInstitutionSchema()` (DDL only) and migration (data population).

**Rationale**: This follows the established pattern where:
- `createTables()` calls schema functions like `ensureSyncSchema()`, `ensureLicensingSchema()` — these create tables/indexes using `CREATE TABLE IF NOT EXISTS`
- `runMigrations()` handles one-time data transformations and column additions

The new `ensureInstitutionSchema()` creates the three tables and their indexes. The migration handles reading `sync_config.school_id` and populating `institution_config`.

**Alternatives considered**:
- Putting everything in the migration: Rejected — would break the established pattern and could cause issues if tables need to exist before other migrations reference them.

## R-005: Index Strategy

**Decision**: Create two indexes: `idx_device_otp_massar_status` on `device_otp(massar_code, status)` and `idx_linked_devices_status` on `linked_devices(status)`.

**Rationale**: The OTP table will be queried by MASSAR code + active status (to check for existing OTPs and for rate-limiting). The linked devices table will be filtered by status (to show active devices, exclude revoked ones). These are the primary query patterns from the plan's Phase 7.2-7.7.

**Alternatives considered**:
- No indexes: Rejected — while tables will be small, indexes are cheap and the project consistently indexes query-critical columns.
- Additional indexes on `device_otp.expires_at`: Deferred — cleanup queries will be infrequent and can table-scan the small OTP table.

## R-006: Export Strategy for ensureInstitutionSchema

**Decision**: Export `ensureInstitutionSchema` from `schema.js` module exports, following the pattern of `ensureSyncSchema`, `ensureLicensingSchema`, etc.

**Rationale**: The migration may also call `ensureInstitutionSchema()` for idempotent table creation, same as `2026-03-030-sync-foundation` calls `ensureSyncSchema(db)`. Exporting it enables reuse.

**Alternatives considered**:
- Not exporting: Rejected — would prevent the migration from reusing the schema function for idempotent DDL.
