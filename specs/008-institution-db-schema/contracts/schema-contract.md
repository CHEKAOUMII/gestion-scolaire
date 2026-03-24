# Contracts: Institution Device Linking — Database Schema

**Feature**: `008-institution-db-schema`
**Date**: 2026-03-22

This phase is purely a database schema change — no new IPC channels, no new UI, no new APIs. The "contract" is the schema function signature and the migration entry.

## Schema Function Contract

### `ensureInstitutionSchema(existingDb?)`

**Module**: `main/db/schema.js`

**Signature**: `function ensureInstitutionSchema(existingDb)` — accepts optional db instance, falls back to `getDb()`.

**Behavior**:
- Creates three tables (`institution_config`, `device_otp`, `linked_devices`) using `CREATE TABLE IF NOT EXISTS`
- Creates two indexes using `CREATE INDEX IF NOT EXISTS`
- Fully idempotent — safe to call multiple times

**Called from**:
1. `createTables()` in `main/db/schema.js` — on every app startup
2. Migration `2026-03-035-institution-device-linking` — for upgrade path idempotency

**Exported**: Yes, added to `module.exports` of `schema.js`

---

## Migration Contract

### Version: `2026-03-035-institution-device-linking`

**Module**: `main/db/migrations.js` — appended to `MIGRATIONS` array

**Behavior**:
1. Calls `ensureInstitutionSchema(db)` for idempotent table creation
2. Reads `sync_config.school_id` from the existing singleton row
3. If `school_id` is non-empty (after TRIM): inserts `institution_config` row with `massar_code = school_id`, `setup_completed = 1`, `setup_mode = 'linked'`
4. If `school_id` is empty/NULL: no data population (tables exist but empty)
5. Uses `INSERT OR IGNORE` to skip if `institution_config` row already exists

**Preconditions**:
- `sync_config` table exists (guaranteed by `ensureSyncSchema()` in `createTables()`)
- `schema_migrations` table exists (guaranteed by `ensureMigrationsTable()`)

**Postconditions**:
- All three tables exist with correct schema
- Existing installations with configured school_id have `institution_config.setup_completed = 1`
- Fresh installations have empty tables (no `institution_config` row)
