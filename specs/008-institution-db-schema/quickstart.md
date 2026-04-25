# Quickstart: Institution Device Linking — Database Schema

**Feature**: `008-institution-db-schema`
**Date**: 2026-03-22

## What This Feature Does

Adds three new database tables (`institution_config`, `device_otp`, `linked_devices`) and a migration to support the institution device linking flow (Phase 7 of the sync infrastructure). This is the foundational data layer — no UI, no IPC, no business logic.

## Files Changed

| File | Change Type | Description |
|------|-------------|-------------|
| `main/db/schema.js` | Modified | Add `ensureInstitutionSchema()` function, call it from `createTables()`, export it |
| `main/db/migrations.js` | Modified | Add migration `2026-03-035-institution-device-linking` to MIGRATIONS array |

## How to Verify

```bash
# 1. Lint check
npm run lint

# 2. Smoke tests (validates schema integrity)
npm run test:smoke

# 3. Manual verification — launch app on fresh DB
rm -f "%APPDATA%/gestion-scolaire/gestion-scolaire.db"
npm run start
# Check console: no errors about institution tables

# 4. Manual verification — check tables exist
# In the app's DevTools console or via sqlite3:
# SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%institution%' OR name LIKE '%device%' OR name LIKE '%linked%';
# Expected: institution_config, device_otp, linked_devices
```

## Key Decisions

- **Singleton pattern**: `institution_config` uses `CHECK(id = 1)` — same as `sync_config` and `owner_sync_config`
- **No foreign keys**: Relationships between tables are logical (query-based), not FK-enforced — matches sync domain patterns
- **Migration auto-populates**: Existing installations with `sync_config.school_id` get `institution_config` pre-filled so they skip the first-run wizard
- **Schema function + migration split**: DDL in `ensureInstitutionSchema()` (runs every startup), data population in migration (runs once)
