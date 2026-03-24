# Tasks: Institution Device Linking — Database Schema

**Input**: Design documents from `/specs/008-institution-db-schema/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/schema-contract.md, quickstart.md

**Tests**: Not requested — no test tasks included.

**Organization**: Tasks are grouped by user story. This feature modifies exactly 2 files: `main/db/schema.js` and `main/db/migrations.js`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: No setup needed. This feature modifies two existing files — no new files, no new dependencies, no project structure changes.

_(Phase intentionally empty — proceed directly to Phase 2)_

---

## Phase 2: Foundational — Schema Function (Blocking)

**Purpose**: Create the `ensureInstitutionSchema()` function in `main/db/schema.js`. This function creates all three tables and their indexes. It MUST be complete before the migration task (Phase 4) can run.

**CRITICAL**: No user story work can begin until this phase is complete.

- [x] T001 Add `ensureInstitutionSchema()` function to `main/db/schema.js`

**What to do**: Add a new function called `ensureInstitutionSchema` in the file `main/db/schema.js`. Insert it **immediately before** the existing `ensureColumn` function (which starts at line 578). The function follows the exact same pattern as the existing `ensureSyncSchema` function (line 479).

**Exact code to insert before line 578** (`function ensureColumn(table, column, definition) {`):

```javascript
function ensureInstitutionSchema(existingDb) {
    const db = existingDb || getDb();

    db.exec(`
        CREATE TABLE IF NOT EXISTS institution_config (
            id                INTEGER PRIMARY KEY CHECK(id = 1),
            massar_code       TEXT,
            institution_name  TEXT,
            setup_completed   INTEGER DEFAULT 0,
            setup_mode        TEXT,
            setup_device_hash TEXT,
            created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS device_otp (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            otp_hash          TEXT    NOT NULL,
            massar_code       TEXT    NOT NULL,
            created_by_device TEXT,
            expires_at        DATETIME NOT NULL,
            used_by_device    TEXT,
            used_at           DATETIME,
            status            TEXT    DEFAULT 'active'
        );

        CREATE TABLE IF NOT EXISTS linked_devices (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            device_hash       TEXT    UNIQUE NOT NULL,
            device_name       TEXT,
            os_platform       TEXT,
            app_version       TEXT,
            linked_by         TEXT,
            linked_at         DATETIME,
            last_seen_at      DATETIME,
            revoked_at        DATETIME,
            status            TEXT    DEFAULT 'active'
        );

        CREATE INDEX IF NOT EXISTS idx_device_otp_massar_status
        ON device_otp(massar_code, status);

        CREATE INDEX IF NOT EXISTS idx_linked_devices_status
        ON linked_devices(status);
    `);
}
```

**Key rules**:

- The function signature is `function ensureInstitutionSchema(existingDb)` — accepts an optional `db` parameter, falls back to `getDb()`. This matches `ensureSyncSchema(existingDb)` exactly.
- `institution_config` uses `CHECK(id = 1)` for singleton — same as `sync_config` on line 512.
- `linked_devices.device_hash` has `UNIQUE NOT NULL` — this is the primary constraint for device identity.
- `device_otp.otp_hash`, `device_otp.massar_code`, and `device_otp.expires_at` are all `NOT NULL`.
- All table creation uses `CREATE TABLE IF NOT EXISTS` (idempotent).
- All index creation uses `CREATE INDEX IF NOT EXISTS` (idempotent).
- Use 4-space indentation. Use single quotes. No trailing commas. These are Prettier rules from the project.

---

- [x] T002 Call `ensureInstitutionSchema(db)` from `createTables()` in `main/db/schema.js`

**What to do**: In the `createTables()` function in `main/db/schema.js`, add a call to `ensureInstitutionSchema(db)`. Insert it on the line **after** `ensurePageVisibilitySchema(db);` (currently line 284).

**Find this block** (around lines 281-284):

```javascript
ensureLicensingSchema(db);
ensureOwnerSyncSchema(db);
ensureSyncSchema(db);
ensurePageVisibilitySchema(db);
```

**Replace with**:

```javascript
ensureLicensingSchema(db);
ensureOwnerSyncSchema(db);
ensureSyncSchema(db);
ensurePageVisibilitySchema(db);
ensureInstitutionSchema(db);
```

That's it — just add one line: `ensureInstitutionSchema(db);`

---

- [x] T003 Export `ensureInstitutionSchema` from `module.exports` in `main/db/schema.js`

**What to do**: Add `ensureInstitutionSchema` to the `module.exports` object at the bottom of `main/db/schema.js`.

**Find this block** (lines 587-594):

```javascript
module.exports = {
    createTables,
    ensureColumn,
    ensureLicensingSchema,
    ensureOwnerSyncSchema,
    ensureSyncSchema,
    ensurePageVisibilitySchema
};
```

**Replace with**:

```javascript
module.exports = {
    createTables,
    ensureColumn,
    ensureInstitutionSchema,
    ensureLicensingSchema,
    ensureOwnerSyncSchema,
    ensureSyncSchema,
    ensurePageVisibilitySchema
};
```

That's it — just add one line: `ensureInstitutionSchema,` (alphabetical order, between `ensureColumn` and `ensureLicensingSchema`).

**Checkpoint**: After T001-T003, run `npm run lint` — should pass with zero errors on `main/db/schema.js`. The function exists, is called from `createTables()`, and is exported. The app can now start and create the three new tables on a fresh database.

---

## Phase 3: User Story 1 — Fresh Installation Setup (Priority: P1) MVP

**Goal**: When the app starts on a fresh database, all three tables (`institution_config`, `device_otp`, `linked_devices`) are created automatically with correct columns, constraints, and defaults.

**Independent Test**: Launch the app with no existing database. Verify:

1. No errors in console
2. Tables `institution_config`, `device_otp`, `linked_devices` exist in SQLite
3. `institution_config` has no rows (setup not completed)
4. Inserting two rows with the same `device_hash` into `linked_devices` fails (UNIQUE constraint)

**This user story is already fully implemented by Phase 2 (T001-T003)**. The `ensureInstitutionSchema()` function creates all tables on every startup via `createTables()`. No additional tasks needed.

**Checkpoint**: User Story 1 is complete. Run `npm run lint` and `npm run test:smoke` to verify.

---

## Phase 4: User Story 2 — Existing Installation Upgrade (Priority: P1)

**Goal**: When an existing database with `sync_config.school_id` populated is upgraded, the migration auto-populates `institution_config` with the MASSAR code and marks setup as completed.

**Independent Test**: Create a database with `sync_config.school_id = 'M320456'`, run migrations, verify `institution_config.massar_code = 'M320456'` and `setup_completed = 1`.

- [x] T004 [US2] Add `ensureInstitutionSchema` to imports in `main/db/migrations.js`

**What to do**: In `main/db/migrations.js`, add `ensureInstitutionSchema` to the destructured import from `./schema`.

**Find this block** (lines 2-8):

```javascript
const {
    ensureColumn,
    ensureLicensingSchema,
    ensureOwnerSyncSchema,
    ensurePageVisibilitySchema,
    ensureSyncSchema
} = require('./schema');
```

**Replace with**:

```javascript
const {
    ensureColumn,
    ensureInstitutionSchema,
    ensureLicensingSchema,
    ensureOwnerSyncSchema,
    ensurePageVisibilitySchema,
    ensureSyncSchema
} = require('./schema');
```

That's it — add one line: `ensureInstitutionSchema,` (alphabetical order, between `ensureColumn` and `ensureLicensingSchema`).

---

- [x] T005 [US2] Add migration `2026-03-035-institution-device-linking` to MIGRATIONS array in `main/db/migrations.js`

**What to do**: Append a new migration entry to the end of the `MIGRATIONS` array in `main/db/migrations.js`. The last current entry ends at line 672 with `}`. The closing `];` of the array is on line 673. Insert the new migration **before** the `];` on line 673.

**Find this block** (lines 667-673):

```javascript
    {
        version: '2026-03-034-sync-config-license-key',
        up: () => {
            ensureColumn('sync_config', 'license_key', 'TEXT');
        }
    }
];
```

**Replace with**:

```javascript
    {
        version: '2026-03-034-sync-config-license-key',
        up: () => {
            ensureColumn('sync_config', 'license_key', 'TEXT');
        }
    },
    {
        version: '2026-03-035-institution-device-linking',
        up: () => {
            const db = getDb();

            // 1. Ensure tables exist (idempotent — already created by createTables,
            //    but needed for edge case where migration runs before schema function)
            ensureInstitutionSchema(db);

            // 2. Read existing school_id from sync_config for upgrade path
            const syncRow = db
                .prepare('SELECT school_id FROM sync_config WHERE id = 1')
                .get();

            const schoolId = syncRow
                ? (syncRow.school_id || '').trim()
                : '';

            // 3. If school_id is configured, auto-populate institution_config
            //    so existing installations skip the first-run setup wizard
            if (schoolId) {
                db.prepare(
                    `
                    INSERT OR IGNORE INTO institution_config(
                        id, massar_code, setup_completed, setup_mode,
                        created_at, updated_at
                    )
                    VALUES(1, ?, 1, 'linked', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    `
                ).run(schoolId);
            }
        }
    }
];
```

**Key rules**:

- Add a comma `,` after the closing `}` of the previous migration (`2026-03-034`). This is the most common mistake — missing the comma will cause a syntax error.
- The version string is `'2026-03-035-institution-device-linking'` — sequential after `034`.
- The migration calls `ensureInstitutionSchema(db)` first for idempotent table creation.
- It reads `sync_config.school_id` using `.get()` (returns one row or undefined).
- It trims and checks for empty — whitespace-only values are treated as not configured (FR-007).
- It uses `INSERT OR IGNORE` so re-running the migration is safe (idempotent).
- When `school_id` is configured, it sets `setup_completed = 1` and `setup_mode = 'linked'`.
- When `school_id` is empty/NULL, it does nothing — tables exist but `institution_config` is empty.
- Use 4-space indentation. Use single quotes. No trailing commas.

**Checkpoint**: After T004-T005, run `npm run lint` and `npm run test:smoke`. Both should pass. The migration is now registered and will run on existing databases during upgrade.

---

## Phase 5: User Story 3 — Schema Supports OTP Lifecycle (Priority: P2)

**Goal**: The `device_otp` table exists with correct NOT NULL constraints and defaults to support OTP generation and verification.

**Independent Test**: Insert an OTP record with `massar_code` and `otp_hash` — verify `status` defaults to `'active'`. Insert without `otp_hash` — verify it fails.

**This user story is already fully implemented by Phase 2 (T001)**. The `device_otp` table with all its constraints (`otp_hash NOT NULL`, `massar_code NOT NULL`, `expires_at NOT NULL`, `status DEFAULT 'active'`) and the composite index on `(massar_code, status)` are created by `ensureInstitutionSchema()`. No additional tasks needed.

---

## Phase 6: User Story 4 — Schema Supports Device Registry (Priority: P2)

**Goal**: The `linked_devices` table exists with `UNIQUE` constraint on `device_hash` and default `status = 'active'`.

**Independent Test**: Insert two devices with different hashes — succeeds. Insert duplicate hash — fails. Verify `status` defaults to `'active'`.

**This user story is already fully implemented by Phase 2 (T001)**. The `linked_devices` table with `device_hash TEXT UNIQUE NOT NULL`, `status TEXT DEFAULT 'active'`, and the index on `(status)` are created by `ensureInstitutionSchema()`. No additional tasks needed.

---

## Phase 7: Polish & Verification

**Purpose**: Final validation that everything works together.

- [x] T006 Run lint and smoke tests to verify all changes in `main/db/schema.js` and `main/db/migrations.js`

**What to do**: Run these two commands and verify they both pass with zero errors:

```bash
npm run lint
npm run test:smoke
```

**Expected results**:

- `npm run lint`: Zero errors, zero new warnings on `main/db/schema.js` and `main/db/migrations.js`.
- `npm run test:smoke`: All existing smoke tests pass. The smoke test checks IPC channel parity between `preload.js` and `main/ipc/*.js` — since we did NOT add any IPC channels, this should be unaffected.

**If lint fails**: The most common issues will be:

- Missing comma in the MIGRATIONS array (between the old last entry and the new one)
- Indentation not using 4 spaces
- Using double quotes instead of single quotes
- Trailing commas (not allowed in this project)
- Lines exceeding 120 characters

**If smoke tests fail**: Check that no existing table names or channel counts have been disturbed. The schema changes are purely additive (`CREATE TABLE IF NOT EXISTS`).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 2 (Foundational)**: No dependencies — start immediately. Tasks T001, T002, T003 must run sequentially (T001 creates the function, T002 calls it, T003 exports it — all in the same file).
- **Phase 3 (US1)**: Automatically complete after Phase 2.
- **Phase 4 (US2)**: Depends on Phase 2 (needs `ensureInstitutionSchema` exported). Tasks T004 and T005 must run sequentially (T004 imports the function, T005 uses it — both in the same file).
- **Phase 5 (US3)**: Automatically complete after Phase 2.
- **Phase 6 (US4)**: Automatically complete after Phase 2.
- **Phase 7 (Polish)**: Depends on Phase 2 + Phase 4 completion.

### Task Dependency Graph

```
T001 → T002 → T003 → T004 → T005 → T006
 (all sequential — T001-T003 modify schema.js, T004-T005 modify migrations.js)
```

### User Story Dependencies

- **User Story 1 (P1)**: Satisfied by Phase 2 (T001-T003)
- **User Story 2 (P1)**: Satisfied by Phase 2 + Phase 4 (T004-T005)
- **User Story 3 (P2)**: Satisfied by Phase 2 (T001)
- **User Story 4 (P2)**: Satisfied by Phase 2 (T001)

### Parallel Opportunities

There are **no parallel opportunities** in this feature. All tasks modify one of two files (`schema.js` or `migrations.js`) and depend on previous tasks in sequence. The feature is small enough (5 implementation tasks + 1 verification) that sequential execution is optimal.

---

## Implementation Strategy

### MVP First (User Stories 1 + 2)

1. Complete T001-T003: Schema function in `main/db/schema.js` → **US1 done**
2. Complete T004-T005: Migration in `main/db/migrations.js` → **US2 done**
3. Run T006: Verify lint + smoke → **All stories done**
4. **STOP and VALIDATE**: All 4 user stories are complete

### Incremental Delivery

This feature is too small for incremental delivery — all 5 implementation tasks should be done in a single session. The total code added is approximately:

- ~45 lines in `schema.js` (function + call + export)
- ~30 lines in `migrations.js` (import + migration entry)

---

## Notes

- This feature adds zero new files — only modifies `main/db/schema.js` and `main/db/migrations.js`
- This feature adds zero new IPC channels — smoke test channel parity is unaffected
- This feature adds zero new npm dependencies
- The exact column definitions come from `data-model.md` — do not deviate from them
- The singleton pattern (`CHECK(id = 1)`) is used by `sync_config` and `owner_sync_config` already — follow the same pattern exactly
- The migration version `035` is the next sequential number after the existing `034`
- All SQL uses `CREATE TABLE IF NOT EXISTS` and `INSERT OR IGNORE` — everything is idempotent
- Code style: single quotes, 4-space indent, no trailing commas, 120-char line width, semicolons
