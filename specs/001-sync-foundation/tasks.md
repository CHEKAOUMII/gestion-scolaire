# Tasks: Sync Foundation

**Input**: Design documents from `/specs/001-sync-foundation/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: Not explicitly requested — test tasks omitted. Smoke test extension is included as a functional task (FR-012).

**Organization**: Tasks are grouped by user story. User Stories 1, 2, 3, and 5 are all P1 and interdependent in this feature (the capture layer IS the foundation). User Story 4 is P2. The ordering below reflects the natural build-up: schema first, then utilities, then registry, then wrapper, then integration.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Create the directory structure for the new sync module.

- [x] T001 Create the `main/sync/` directory by adding the empty capture module file at `main/sync/capture.js` with a single line comment `// Sync capture layer — Phase 1` and `module.exports = {};` at the bottom. This directory follows the existing pattern of `main/licensing/`, `main/notifications/`, `main/reports/`.

---

## Phase 2: Foundational — Database Migration (Blocking)

**Purpose**: Create the 4 sync tables via a new migration. This MUST be complete before any other user story work begins because all capture logic writes to these tables.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T002 [US3] Add the sync table DDL helper function `ensureSyncSchema` in `main/db/schema.js`. Add it AFTER the existing `ensureOwnerSyncSchema` function (around line 460). The function must be exported from the module. Use this exact code:

```js
function ensureSyncSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS sync_outbox (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name      TEXT    NOT NULL,
            row_sync_id     TEXT    NOT NULL,
            operation       TEXT    NOT NULL CHECK(operation IN ('PUT','DEL')),
            row_data        TEXT,
            school_year     TEXT,
            status          TEXT    NOT NULL DEFAULT 'pending',
            retries         INTEGER          DEFAULT 0,
            last_attempt_at DATETIME,
            sent_at         DATETIME,
            last_error      TEXT,
            created_at      DATETIME         DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_sync_outbox_status_id
        ON sync_outbox(status, id);

        CREATE INDEX IF NOT EXISTS idx_sync_outbox_created_at
        ON sync_outbox(created_at);

        CREATE TABLE IF NOT EXISTS sync_id_map (
            row_sync_id TEXT PRIMARY KEY,
            table_name  TEXT    NOT NULL,
            local_id    INTEGER NOT NULL,
            UNIQUE(table_name, local_id)
        );

        CREATE TABLE IF NOT EXISTS sync_config (
            id                      INTEGER PRIMARY KEY CHECK(id = 1),
            enabled                 INTEGER  DEFAULT 0,
            sync_interval_minutes   INTEGER  DEFAULT 10,
            device_hash             TEXT,
            device_name             TEXT,
            school_id_hash          TEXT,
            retention_days          INTEGER  DEFAULT 7,
            last_capture_error      TEXT,
            updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sync_pull_state (
            table_name      TEXT PRIMARY KEY,
            last_pulled_at  TEXT,
            last_pull_error TEXT,
            updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    db.prepare(
        `
        INSERT OR IGNORE INTO sync_config(id, enabled, sync_interval_minutes, retention_days)
        VALUES(1, 0, 10, 7)
    `
    ).run();
}
```

Also add `ensureSyncSchema` to the `module.exports` at the bottom of `schema.js`.

- [x] T003 [US3] Add migration `2026-03-030-sync-foundation` to the `MIGRATIONS` array in `main/db/migrations.js`. Append it as the LAST entry in the array. The migration calls `ensureSyncSchema`. Follow the exact pattern of existing migrations. Use this code:

```js
{
    version: '2026-03-030-sync-foundation',
    up: () => {
        const db = getDb();
        ensureSyncSchema(db);
    }
}
```

You must also add the import of `ensureSyncSchema` from `../db/schema` at the top of the file, next to the existing `ensureColumn` and `ensureOwnerSyncSchema` imports. Find the existing require line for `schema.js` (it looks like `const { ensureColumn, ensureOwnerSyncSchema } = require('./schema');` or similar) and add `ensureSyncSchema` to the destructured imports.

**Checkpoint**: After T002-T003, run `npm run dev` and verify the 4 tables exist in the database. Then run `npm run test:smoke` to confirm no regression.

---

## Phase 3: User Story 4 — Global Row Identity (Priority: P2)

**Goal**: Implement the `getDeviceHash()` and `ensureSyncIdMapping()` utilities that generate globally unique sync IDs in the format `{deviceHash}:{table_name}:{local_id}`.

**Independent Test**: Call `ensureSyncIdMapping(db, 'students', 42)` and verify a row exists in `sync_id_map` with `row_sync_id` matching `{hash}:students:42`.

**Why this comes before US1**: The outbox writer (US1) depends on `ensureSyncIdMapping()` and `getDeviceHash()` to create the `row_sync_id` field. Building these utilities first lets US1 use them immediately.

- [x] T004 [US4] Implement the `getDeviceHash()` function in `main/sync/capture.js`. This function lazily caches the device fingerprint hash at module scope. It must only call `collectCurrentFingerprint()` once per process lifetime because that function makes expensive subprocess calls (up to 4.5 seconds). Use this exact code:

```js
const { collectCurrentFingerprint } = require('../licensing/deviceFingerprint');

let _cachedDeviceHash = null;
let _cachedDeviceName = null;

function getDeviceHash() {
    if (!_cachedDeviceHash) {
        try {
            const fp = collectCurrentFingerprint();
            _cachedDeviceHash = fp.deviceHash;
            _cachedDeviceName = fp.deviceName;
        } catch (_err) {
            // Fallback: use a random hash if fingerprinting fails
            _cachedDeviceHash = require('crypto').randomBytes(16).toString('hex');
            _cachedDeviceName = require('os').hostname();
        }
    }
    return _cachedDeviceHash;
}

function getDeviceName() {
    if (!_cachedDeviceName) {
        getDeviceHash(); // populates both
    }
    return _cachedDeviceName;
}
```

Add both functions to `module.exports` at the bottom of the file.

- [x] T005 [US4] Implement the `ensureSyncIdMapping()` function in `main/sync/capture.js`. This function creates or retrieves the global sync ID for a given table and local row ID. Use `INSERT OR IGNORE` for idempotency. Use this exact code:

```js
function ensureSyncIdMapping(db, tableName, localId) {
    const deviceHash = getDeviceHash();
    const rowSyncId = `${deviceHash}:${tableName}:${localId}`;

    db.prepare(
        `
        INSERT OR IGNORE INTO sync_id_map(row_sync_id, table_name, local_id)
        VALUES(?, ?, ?)
    `
    ).run(rowSyncId, tableName, localId);

    return rowSyncId;
}
```

Add `ensureSyncIdMapping` to `module.exports`.

**Checkpoint**: After T004-T005, you can manually test by requiring the module in a Node REPL and calling `ensureSyncIdMapping(db, 'students', 1)` — a row should appear in `sync_id_map`.

---

## Phase 4: User Story 1 — Outbox Writer & Sensitive Field Stripping (Priority: P1) 🎯 MVP

**Goal**: Implement the core outbox recording functions that capture write operations. After this phase, calling `recordOutboxEntry()` directly will create outbox rows with correct sync IDs, stripped sensitive fields, and school_year.

**Independent Test**: Call `recordOutboxEntry(db, 'students', 42, 'PUT', {code: 'S001', full_name: 'Test', password_hash: 'secret'}, '2025/2026')` and verify: (a) a row exists in `sync_outbox` with `operation='PUT'`, (b) `row_data` JSON does NOT contain `password_hash`, (c) `row_sync_id` matches the expected format, (d) `school_year` is `'2025/2026'`.

- [x] T006 [P] [US1] Implement the `stripSensitiveFields()` function in `main/sync/capture.js`. This utility shallow-clones a row data object and removes sensitive fields before JSON serialization. Use this exact code:

```js
const SENSITIVE_FIELDS = ['password_hash', 'pin_hash'];

function stripSensitiveFields(rowData) {
    if (!rowData || typeof rowData !== 'object') return rowData;
    const cleaned = { ...rowData };
    for (const field of SENSITIVE_FIELDS) {
        delete cleaned[field];
    }
    return cleaned;
}
```

Add `stripSensitiveFields` and `SENSITIVE_FIELDS` to `module.exports`.

- [x] T007 [US1] Implement the `recordOutboxEntry()` function in `main/sync/capture.js`. This is the core function that writes a single row to the `sync_outbox` table. It calls `ensureSyncIdMapping()` to get/create the sync ID, strips sensitive fields, and inserts into the outbox. Use this exact code:

```js
function recordOutboxEntry(db, tableName, localId, operation, rowData, schoolYear) {
    const rowSyncId = ensureSyncIdMapping(db, tableName, localId);
    const cleanedData = operation === 'DEL' ? null : stripSensitiveFields(rowData);

    db.prepare(
        `
        INSERT INTO sync_outbox(table_name, row_sync_id, operation, row_data, school_year, status, retries)
        VALUES(?, ?, ?, ?, ?, 'pending', 0)
    `
    ).run(tableName, rowSyncId, operation, cleanedData ? JSON.stringify(cleanedData) : null, schoolYear || null);
}
```

Add `recordOutboxEntry` to `module.exports`.

- [x] T008 [US1] Implement the `recordOutboxEntries()` bulk helper in `main/sync/capture.js`. This wraps multiple `recordOutboxEntry` calls in a single transaction for performance when processing bulk operations (e.g., `students:addBulk`). Use this exact code:

```js
function recordOutboxEntries(db, entries) {
    // entries = [{ tableName, localId, operation, rowData, schoolYear }, ...]
    const txn = db.transaction(() => {
        for (const entry of entries) {
            recordOutboxEntry(db, entry.tableName, entry.localId, entry.operation, entry.rowData, entry.schoolYear);
        }
    });
    txn();
}
```

Add `recordOutboxEntries` to `module.exports`.

**Checkpoint**: After T006-T008, the outbox writer is complete. All remaining work builds on these functions. Run `npm run lint` to verify code style.

---

## Phase 5: User Story 2 — Channel-to-Table Registry (Priority: P1)

**Goal**: Define the complete CHANNEL_REGISTRY object mapping all 47 write IPC channels to their table(s), operation type, and ID extraction strategy. This registry is the single source of truth for what the capture layer records.

**Independent Test**: Import `CHANNEL_REGISTRY` from `main/sync/capture.js` and verify it has 47 entries, that `users:getAll` is marked as excluded, and that every channel has a `tables` array and `idExtractor` string.

- [x] T009 [US2] Add the `CHANNEL_REGISTRY` constant to `main/sync/capture.js`. Place it AFTER the `SENSITIVE_FIELDS` constant and BEFORE all function definitions. This is a large static object — copy it exactly. Each entry maps a channel name to its metadata:

```js
/**
 * Channel-to-table registry.
 * Maps every write IPC channel to its affected table(s) and capture metadata.
 *
 * Fields per entry:
 *   tables:      string[]  - database table(s) written by this channel
 *   operation:   string    - 'PUT' | 'DEL' | 'UPSERT' | 'MIXED'
 *   idExtractor: string    - strategy for obtaining the affected row ID(s):
 *       'lastInsertRowid'       - use better-sqlite3 lastInsertRowid (for INSERTs)
 *       'argId'                 - extract `id` from handler arguments
 *       'argIdOrLastInsert'     - use arg.id if present (UPDATE), else lastInsertRowid (INSERT)
 *       'argKey'                - extract `key` from handler arguments (settings key-value)
 *       'literal'               - fixed/known key (e.g., settings:setSchoolYear always writes 'currentSchoolYear')
 *       'compositeKey'          - extract composite key fields from arguments
 *       'inputArray'            - iterate input array for bulk operations
 *       'preQuery'              - SELECT affected IDs before handler runs (for DELETEs)
 *       'preQuery+bulk'         - preQuery for deletes + bulk for inserts (mixed ops)
 *       'lastInsertRowid+conditional' - lastInsertRowid + conditional secondary table write
 *       'queryMatch'            - query matching rows by criteria after operation
 *   preCapture:  boolean   - true if IDs must be collected BEFORE handler runs
 *   bulk:        boolean   - true if handler processes multiple rows
 *   exclude:     boolean   - true to skip capture (read-only channels using handleWrite)
 */
const CHANNEL_REGISTRY = {
    // === absences.js ===
    'absences:save': { tables: ['absences'], operation: 'PUT', idExtractor: 'lastInsertRowid' },
    'absences:saveBulk': { tables: ['absences'], operation: 'UPSERT', idExtractor: 'inputArray', bulk: true },
    'absences:delete': { tables: ['absences'], operation: 'DEL', idExtractor: 'argId' },
    'absences:deleteByYear': {
        tables: ['absences'],
        operation: 'DEL',
        idExtractor: 'preQuery',
        preCapture: true,
        bulk: true
    },
    'correspondence:save': { tables: ['correspondence'], operation: 'PUT', idExtractor: 'lastInsertRowid' },
    'correspondence:markPrinted': { tables: ['correspondence'], operation: 'PUT', idExtractor: 'argId' },

    // === exams.js ===
    'exams:save': { tables: ['exams'], operation: 'PUT', idExtractor: 'argIdOrLastInsert' },
    'exams:delete': { tables: ['exams'], operation: 'DEL', idExtractor: 'argId' },
    'examProctors:saveManual': { tables: ['exam_proctors'], operation: 'PUT', idExtractor: 'lastInsertRowid' },
    'examProctors:generateRoundRobin': {
        tables: ['exam_proctors'],
        operation: 'MIXED',
        idExtractor: 'preQuery+bulk',
        preCapture: true,
        bulk: true
    },
    'examProctors:delete': { tables: ['exam_proctors'], operation: 'DEL', idExtractor: 'argId' },
    'examRooms:save': { tables: ['exam_rooms'], operation: 'PUT', idExtractor: 'argIdOrLastInsert' },
    'examRooms:delete': { tables: ['exam_rooms'], operation: 'DEL', idExtractor: 'argId' },
    'tests:save': { tables: ['tests'], operation: 'PUT', idExtractor: 'argIdOrLastInsert' },
    'tests:delete': { tables: ['tests'], operation: 'DEL', idExtractor: 'argId' },

    // === schoolOps.js ===
    'studentFiles:upsert': { tables: ['student_files'], operation: 'UPSERT', idExtractor: 'compositeKey' },
    'studentFiles:upsertBulk': {
        tables: ['student_files'],
        operation: 'UPSERT',
        idExtractor: 'inputArray',
        bulk: true
    },
    'studentFiles:setDocumentStatus': { tables: ['student_files'], operation: 'UPSERT', idExtractor: 'compositeKey' },
    'studentMovements:add': {
        tables: ['student_movements', 'students'],
        operation: 'MIXED',
        idExtractor: 'lastInsertRowid+conditional'
    },

    // === staff.js ===
    'teachers:add': { tables: ['teachers', 'teacher_aliases'], operation: 'PUT', idExtractor: 'lastInsertRowid' },
    'teachers:update': { tables: ['teachers', 'teacher_aliases'], operation: 'PUT', idExtractor: 'argId' },
    'teachers:delete': {
        tables: [
            'teachers',
            'teacher_aliases',
            'grades',
            'tests',
            'staff_attendance',
            'exam_proctors',
            'compensation_tracking',
            'teacher_absences'
        ],
        operation: 'MIXED',
        idExtractor: 'preQuery',
        preCapture: true
    },
    'teachers:deleteByYear': {
        tables: [
            'teachers',
            'teacher_aliases',
            'grades',
            'tests',
            'staff_attendance',
            'exam_proctors',
            'compensation_tracking',
            'teacher_absences'
        ],
        operation: 'MIXED',
        idExtractor: 'preQuery',
        preCapture: true,
        bulk: true
    },
    'teachers:saveTafwijAliases': {
        tables: ['teacher_aliases'],
        operation: 'PUT',
        idExtractor: 'inputArray',
        bulk: true
    },
    'teachers:importBulk': {
        tables: ['teachers', 'teacher_aliases'],
        operation: 'UPSERT',
        idExtractor: 'inputArray',
        bulk: true
    },
    'teacherAbsences:save': { tables: ['teacher_absences'], operation: 'PUT', idExtractor: 'lastInsertRowid' },
    'teacherAbsences:delete': { tables: ['teacher_absences'], operation: 'DEL', idExtractor: 'argId' },
    'schoolEvents:save': { tables: ['school_events'], operation: 'PUT', idExtractor: 'argIdOrLastInsert' },
    'schoolEvents:delete': { tables: ['school_events'], operation: 'DEL', idExtractor: 'argId' },
    'compensation:saveBatch': {
        tables: ['compensation_tracking'],
        operation: 'PUT',
        idExtractor: 'inputArray',
        bulk: true
    },
    'compensation:toggleCompensated': { tables: ['compensation_tracking'], operation: 'PUT', idExtractor: 'argId' },

    // === students.js ===
    'students:add': { tables: ['students'], operation: 'PUT', idExtractor: 'lastInsertRowid' },
    'students:addBulk': { tables: ['students'], operation: 'UPSERT', idExtractor: 'inputArray', bulk: true },
    'students:update': { tables: ['students'], operation: 'PUT', idExtractor: 'argId' },
    'students:delete': { tables: ['students'], operation: 'DEL', idExtractor: 'argId' },
    'students:deleteByYear': {
        tables: ['students', 'grades', 'absences', 'correspondence', 'student_files', 'student_movements'],
        operation: 'DEL',
        idExtractor: 'preQuery',
        preCapture: true,
        bulk: true
    },
    'students:updateStatusBulk': { tables: ['students'], operation: 'PUT', idExtractor: 'inputArray', bulk: true },
    'settings:set': { tables: ['settings'], operation: 'PUT', idExtractor: 'argKey' },
    'settings:setSchoolYear': { tables: ['settings'], operation: 'PUT', idExtractor: 'literal' },
    'grades:save': { tables: ['grades'], operation: 'PUT', idExtractor: 'compositeKey' },
    'grades:saveBulk': { tables: ['grades'], operation: 'PUT', idExtractor: 'inputArray', bulk: true },
    'grades:reassignTeacherBulk': { tables: ['grades'], operation: 'PUT', idExtractor: 'queryMatch', bulk: true },
    'grades:deleteByYear': {
        tables: ['grades'],
        operation: 'DEL',
        idExtractor: 'preQuery',
        preCapture: true,
        bulk: true
    },
    'grades:deleteBySemester': {
        tables: ['grades'],
        operation: 'DEL',
        idExtractor: 'preQuery',
        preCapture: true,
        bulk: true
    },

    // === staffAttendance.js ===
    'staffAttendance:save': { tables: ['staff_attendance'], operation: 'PUT', idExtractor: 'lastInsertRowid' },
    'staffAttendance:delete': { tables: ['staff_attendance'], operation: 'DEL', idExtractor: 'argId' },

    // === system.js ===
    'users:getAll': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },

    // === pageVisibility.js ===
    'pageVisibility:setVisibility': { tables: ['page_visibility'], operation: 'PUT', idExtractor: 'argKey' }
};
```

Add `CHANNEL_REGISTRY` to `module.exports`.

**Checkpoint**: After T009, run `npm run lint` to confirm formatting. The registry is a data-only constant — no runtime behavior yet.

---

## Phase 6: User Story 5 + US1 — Capture Wrapper & Integration (Priority: P1)

**Goal**: Implement the `wrapWithSyncCapture()` function that transparently wraps `handleWrite`/`handleWriteSoftAuth` to record outbox entries after successful writes, then integrate it into `registerAll.js`. This is the heart of the feature — after this phase, every write operation in the app automatically generates outbox entries.

**Independent Test**: Run `npm run test:smoke` — all existing tests must pass. Then perform a write operation (add a student) and verify a row appears in `sync_outbox`.

- [x] T010 [US5] Modify `main/ipc/ipc-helpers.js` to track which channels are registered as write channels. Add a module-level `Set` to collect write channel names, and export it. Find the existing `handleWrite` function and add the channel to the set at registration time. Do the same for `handleWriteSoftAuth`. Add these changes:

1. At the top of the file (after existing variable declarations), add:

```js
const _writeChannels = new Set();
```

2. Inside the `handleWrite` function, as the FIRST line of the function body (before `ipcMain.handle(...)`), add:

```js
_writeChannels.add(channel);
```

3. Inside the `handleWriteSoftAuth` function, as the FIRST line of the function body (before `ipcMain.handle(...)`), add:

```js
_writeChannels.add(channel);
```

4. Add `_writeChannels` to the `module.exports` object at the bottom of the file. Export it as `writeChannels`:

```js
writeChannels: _writeChannels;
```

- [x] T011 [US5] [US1] Implement the `wrapWithSyncCapture()` function in `main/sync/capture.js`. This is the central wrapper that intercepts IPC write handlers. It must:
    - Look up the channel in `CHANNEL_REGISTRY`
    - Skip excluded channels (e.g., `users:getAll`)
    - Skip channels not in the registry (log warning)
    - After the original handler succeeds, record outbox entries
    - Catch and swallow all capture errors (FR-014) — write error to `sync_config.last_capture_error`
    - Never alter the handler's return value or error behavior (FR-004, FR-005)

Use this implementation. This is the most complex function in the feature — implement it exactly:

```js
const { getDb } = require('../db/context');

/**
 * Wraps an existing ipcMain.handle callback to capture write operations
 * into the sync_outbox after the original handler succeeds.
 *
 * @param {string} channel - IPC channel name
 * @param {Function} originalHandler - the original ipcMain.handle callback
 * @returns {Function} wrapped handler
 */
function wrapWithSyncCapture(channel, originalHandler) {
    const registryEntry = CHANNEL_REGISTRY[channel];

    // Skip channels not in registry or explicitly excluded
    if (!registryEntry || registryEntry.exclude) {
        return originalHandler;
    }

    return async function wrappedHandler(event, ...args) {
        // Run the original handler first — if it throws, we do not capture
        const result = await originalHandler(event, ...args);

        // Only capture if the handler succeeded
        // Convention: handlers return { success: false, ... } on failure
        if (result && result.success === false) {
            return result;
        }

        // Capture in a try/catch — never disrupt the original result
        try {
            const db = getDb();
            captureAfterWrite(db, channel, registryEntry, args, result);
        } catch (captureErr) {
            // FR-014: Silently persist the error, never throw
            try {
                const db = getDb();
                db.prepare(
                    `
                    UPDATE sync_config
                    SET last_capture_error = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = 1
                `
                ).run(`[${channel}] ${captureErr.message}`);
            } catch (_innerErr) {
                // Even error logging failed — silently ignore
            }
        }

        return result;
    };
}

/**
 * Extracts row data and records outbox entries based on the registry entry's
 * idExtractor strategy. This handles simple single-row operations.
 * Complex extractors (preQuery, inputArray, bulk) are handled with
 * simplified fallback — they record a summary entry for Phase 3 to process.
 */
function captureAfterWrite(db, channel, entry, handlerArgs, handlerResult) {
    const tableName = entry.tables[0]; // primary table
    const schoolYear = extractSchoolYear(handlerArgs);

    switch (entry.idExtractor) {
        case 'lastInsertRowid': {
            // The handler just did an INSERT. Query lastInsertRowid from result
            // or re-read the row. For safety, query the last inserted row.
            const lastId = getLastInsertId(db, tableName, handlerResult);
            if (lastId) {
                const rowData = fetchRowById(db, tableName, lastId);
                recordOutboxEntry(db, tableName, lastId, 'PUT', rowData, schoolYear);
            }
            break;
        }
        case 'argId': {
            const id = extractIdFromArgs(handlerArgs);
            if (id) {
                if (entry.operation === 'DEL') {
                    recordOutboxEntry(db, tableName, id, 'DEL', null, schoolYear);
                } else {
                    const rowData = fetchRowById(db, tableName, id);
                    recordOutboxEntry(db, tableName, id, 'PUT', rowData, schoolYear);
                }
            }
            break;
        }
        case 'argIdOrLastInsert': {
            // Check if args contain an id (UPDATE) or not (INSERT)
            const id = extractIdFromArgs(handlerArgs);
            if (id) {
                const rowData = fetchRowById(db, tableName, id);
                recordOutboxEntry(db, tableName, id, 'PUT', rowData, schoolYear);
            } else {
                const lastId = getLastInsertId(db, tableName, handlerResult);
                if (lastId) {
                    const rowData = fetchRowById(db, tableName, lastId);
                    recordOutboxEntry(db, tableName, lastId, 'PUT', rowData, schoolYear);
                }
            }
            break;
        }
        case 'argKey': {
            // Settings-style: key is the identifier
            const key = extractKeyFromArgs(handlerArgs);
            if (key) {
                const rowData = fetchRowByKey(db, tableName, key);
                const localId = rowData ? rowData.id || hashStringToInt(key) : hashStringToInt(key);
                recordOutboxEntry(db, tableName, localId, 'PUT', rowData, schoolYear);
            }
            break;
        }
        case 'literal': {
            // settings:setSchoolYear — always writes the key 'currentSchoolYear'
            const key = 'currentSchoolYear';
            const rowData = fetchRowByKey(db, 'settings', key);
            const localId = hashStringToInt(key);
            recordOutboxEntry(db, 'settings', localId, 'PUT', rowData, schoolYear);
            break;
        }
        case 'compositeKey': {
            // For tables with composite unique keys (grades, student_files)
            // Re-query the affected row using args
            const compositeData = extractCompositeFromArgs(handlerArgs, tableName);
            if (compositeData && compositeData.id) {
                const rowData = fetchRowById(db, tableName, compositeData.id);
                recordOutboxEntry(db, tableName, compositeData.id, 'PUT', rowData, schoolYear);
            }
            break;
        }
        case 'inputArray':
        case 'queryMatch':
        case 'preQuery':
        case 'preQuery+bulk':
        case 'lastInsertRowid+conditional': {
            // Complex extractors — for Phase 1, record a simplified summary entry
            // using the primary table. Phase 3 will implement full per-row extraction.
            // For now, mark the channel as needing enhanced capture.
            recordBulkSummary(db, channel, entry, handlerArgs, schoolYear);
            break;
        }
        default:
            // Unknown extractor — skip silently
            break;
    }
}

// ---- Helper functions for captureAfterWrite ----

function extractSchoolYear(handlerArgs) {
    // Scan handler arguments for a schoolYear or school_year field
    for (const arg of handlerArgs) {
        if (arg && typeof arg === 'object') {
            if (arg.schoolYear) return arg.schoolYear;
            if (arg.school_year) return arg.school_year;
        }
        if (typeof arg === 'string' && /^\d{4}\/\d{4}$/.test(arg)) {
            return arg;
        }
    }
    return null;
}

function extractIdFromArgs(handlerArgs) {
    for (const arg of handlerArgs) {
        if (typeof arg === 'number') return arg;
        if (arg && typeof arg === 'object' && arg.id) return arg.id;
    }
    return null;
}

function extractKeyFromArgs(handlerArgs) {
    for (const arg of handlerArgs) {
        if (typeof arg === 'string' && arg.length > 0 && !/^\d{4}\/\d{4}$/.test(arg)) {
            return arg;
        }
        if (arg && typeof arg === 'object' && arg.key) return arg.key;
        if (arg && typeof arg === 'object' && arg.page_key) return arg.page_key;
    }
    return null;
}

function extractCompositeFromArgs(handlerArgs, tableName) {
    // Try to re-query the row using known composite key patterns
    const db = getDb();
    for (const arg of handlerArgs) {
        if (!arg || typeof arg !== 'object') continue;

        if (tableName === 'grades' && arg.student_code && arg.subject && arg.semester) {
            const row = db
                .prepare(
                    `
                SELECT * FROM grades
                WHERE student_code = ? AND subject = ? AND semester = ? AND school_year = ?
            `
                )
                .get(arg.student_code, arg.subject, arg.semester, arg.school_year || '');
            return row;
        }
        if (tableName === 'student_files' && arg.student_id && arg.doc_key) {
            const row = db
                .prepare(
                    `
                SELECT * FROM student_files
                WHERE student_id = ? AND doc_key = ? AND school_year = ?
            `
                )
                .get(arg.student_id, arg.doc_key, arg.school_year || '');
            return row;
        }
    }
    return null;
}

function getLastInsertId(db, _tableName, handlerResult) {
    // Try to get ID from handler result first
    if (handlerResult && typeof handlerResult === 'object') {
        if (handlerResult.id) return handlerResult.id;
        if (handlerResult.lastInsertRowid) return handlerResult.lastInsertRowid;
        if (handlerResult.data && handlerResult.data.id) return handlerResult.data.id;
    }
    // Fallback: query SQLite for last insert rowid
    // Note: This is safe because better-sqlite3 is synchronous and single-threaded
    const row = db.prepare('SELECT last_insert_rowid() as id').get();
    return row ? row.id : null;
}

function fetchRowById(db, tableName, id) {
    try {
        // Validate tableName to prevent SQL injection (only known table names)
        if (!isKnownTable(tableName)) return null;
        const row = db.prepare(`SELECT * FROM "${tableName}" WHERE id = ?`).get(id);
        return row || null;
    } catch (_err) {
        return null;
    }
}

function fetchRowByKey(db, tableName, key) {
    try {
        if (tableName === 'settings') {
            return db.prepare('SELECT * FROM settings WHERE key = ?').get(key);
        }
        if (tableName === 'page_visibility') {
            return db.prepare('SELECT * FROM page_visibility WHERE page_key = ?').get(key);
        }
        return null;
    } catch (_err) {
        return null;
    }
}

function hashStringToInt(str) {
    // Simple hash for string-keyed tables (settings, page_visibility)
    // Produces a stable positive integer from a string
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
}

function isKnownTable(tableName) {
    const knownTables = new Set([
        'students',
        'grades',
        'absences',
        'correspondence',
        'student_files',
        'student_movements',
        'teachers',
        'teacher_aliases',
        'teacher_absences',
        'exams',
        'exam_proctors',
        'exam_rooms',
        'tests',
        'staff_attendance',
        'school_events',
        'compensation_tracking',
        'settings',
        'page_visibility'
    ]);
    return knownTables.has(tableName);
}

function recordBulkSummary(db, channel, entry, handlerArgs, schoolYear) {
    // For complex/bulk operations, record a summary outbox entry
    // This captures the fact that a bulk operation occurred on the primary table
    // Phase 3 will implement full per-row extraction for these channels
    const tableName = entry.tables[0];
    const deviceHash = getDeviceHash();
    const timestamp = Date.now();
    const summaryId = `${deviceHash}:${tableName}:bulk_${timestamp}`;

    db.prepare(
        `
        INSERT INTO sync_outbox(table_name, row_sync_id, operation, row_data, school_year, status, retries)
        VALUES(?, ?, ?, ?, ?, 'pending', 0)
    `
    ).run(
        tableName,
        summaryId,
        entry.operation === 'DEL' ? 'DEL' : 'PUT',
        JSON.stringify({ _bulk: true, channel, args_summary: summarizeArgs(handlerArgs) }),
        schoolYear
    );
}

function summarizeArgs(handlerArgs) {
    // Create a safe summary of handler args for bulk logging
    // Avoid serializing huge arrays — just record count and type
    const summary = {};
    for (let i = 0; i < handlerArgs.length; i++) {
        const arg = handlerArgs[i];
        if (Array.isArray(arg)) {
            summary[`arg${i}`] = { type: 'array', length: arg.length };
        } else if (arg && typeof arg === 'object') {
            summary[`arg${i}`] = { type: 'object', keys: Object.keys(arg).slice(0, 10) };
        } else {
            summary[`arg${i}`] = arg;
        }
    }
    return summary;
}
```

Add `wrapWithSyncCapture` to `module.exports`.

- [x] T012 [US5] Implement outbox retention cleanup in `main/sync/capture.js`. Add `startOutboxCleanup()` and `stopOutboxCleanup()` functions that run a periodic cleanup deleting outbox entries older than the configured retention period. Follow the `ownerSync.js` timer pattern. Use this exact code:

```js
let _cleanupTimer = null;

function runOutboxCleanup(db) {
    try {
        const config = db.prepare('SELECT retention_days FROM sync_config WHERE id = 1').get();
        const days = (config && config.retention_days) || 7;
        db.prepare(
            `
            DELETE FROM sync_outbox WHERE created_at < datetime('now', '-' || ? || ' days')
        `
        ).run(days);
    } catch (_err) {
        // Silently ignore cleanup errors
    }
}

function startOutboxCleanup() {
    if (_cleanupTimer) return;

    try {
        const db = getDb();
        // Run cleanup immediately on startup
        runOutboxCleanup(db);

        // Then every 6 hours
        const SIX_HOURS = 6 * 60 * 60 * 1000;
        _cleanupTimer = setInterval(() => {
            try {
                const db = getDb();
                runOutboxCleanup(db);
            } catch (_err) {
                // Silently ignore
            }
        }, SIX_HOURS);

        // Don't block process exit
        if (typeof _cleanupTimer.unref === 'function') {
            _cleanupTimer.unref();
        }
    } catch (_err) {
        // Silently ignore startup errors
    }
}

function stopOutboxCleanup() {
    if (_cleanupTimer) {
        clearInterval(_cleanupTimer);
        _cleanupTimer = null;
    }
}
```

Add `startOutboxCleanup` and `stopOutboxCleanup` to `module.exports`.

- [x] T013 [US5] Modify `main/ipc/registerAll.js` to apply the sync capture wrapper. This is the integration point that connects the capture layer to the existing IPC registration flow. Make these changes:

1. Add this import at the top of the file, after the existing require statements:

```js
const { wrapWithSyncCapture, startOutboxCleanup } = require('../sync/capture');
```

2. Add a new function `applySyncCapture` that wraps all registered handlers. Add it AFTER the `registerAllIpcHandlers` function but BEFORE `module.exports`:

```js
function applySyncCapture(ipcMain) {
    // Get the set of registered write channels
    const { writeChannels } = require('./ipc-helpers');

    // For each registered write channel, replace the handler with a wrapped version
    for (const channel of writeChannels) {
        const existingHandler = ipcMain._events ? ipcMain._events[`handle:${channel}`] : null;
        // ipcMain.handle stores handlers internally — we need to remove and re-register
        // Alternative approach: wrap at the ipc-helpers level instead
        // For safety, we wrap by replacing the registered handler
        try {
            ipcMain.removeHandler(channel);
            const wrappedHandler = wrapWithSyncCapture(channel, existingHandler || (async () => null));
            ipcMain.handle(channel, wrappedHandler);
        } catch (_err) {
            // If wrapping fails, re-register original
            if (existingHandler) {
                try {
                    ipcMain.handle(channel, existingHandler);
                } catch (_e) {
                    /* ignore */
                }
            }
        }
    }

    // Start the outbox cleanup timer
    startOutboxCleanup();
}
```

**IMPORTANT**: The approach above of removing and re-registering handlers may not work cleanly with Electron's `ipcMain.handle()`. A safer alternative is to modify `handleWrite` and `handleWriteSoftAuth` in `ipc-helpers.js` to accept an optional post-handler hook. Review T010 — the `_writeChannels` set gives you the channel names, but you need the actual handler function references.

**Preferred alternative approach**: Instead of post-registration wrapping, modify `handleWrite` and `handleWriteSoftAuth` in `ipc-helpers.js` to call `wrapWithSyncCapture` at registration time. In `handleWrite`, change the `ipcMain.handle(channel, ...)` call to wrap the inner async function. This is simpler and avoids the `removeHandler`/`re-register` complexity. Specifically:

In `ipc-helpers.js`, in the `handleWrite` function, replace:

```js
ipcMain.handle(channel, async (event, ...args) => {
```

with:

```js
const innerHandler = async (event, ...args) => {
```

And at the end of the function, add:

```js
ipcMain.handle(channel, wrapWithSyncCapture(channel, innerHandler));
```

Do the same transformation for `handleWriteSoftAuth`. This requires importing `wrapWithSyncCapture` at the top of `ipc-helpers.js`:

```js
const { wrapWithSyncCapture } = require('../sync/capture');
```

Choose ONE of these two approaches (the preferred alternative is recommended). Whichever you choose, also call `startOutboxCleanup()` from `registerAllIpcHandlers` — add it as the last line in that function.

3. Update `module.exports` to also export `applySyncCapture` if using the first approach.

- [x] T014 [US2] [US5] Add the sync registry completeness check to `tests/smoke.js`. Find the existing smoke test file and add a NEW test section after the existing IPC parity check. The test must:
    1. Import `CHANNEL_REGISTRY` from `main/sync/capture.js`
    2. Import `writeChannels` from `main/ipc/ipc-helpers.js`
    3. Verify that every channel in `writeChannels` either exists in `CHANNEL_REGISTRY` OR is handled (the test should fail if a write channel has no registry entry)
    4. Report any unmapped channels with a clear error message

Use this test code (adapt to the existing smoke test pattern in the file):

```js
// --- Sync Registry Completeness ---
(function checkSyncRegistryCompleteness() {
    const { CHANNEL_REGISTRY } = require('../main/sync/capture');
    const { writeChannels } = require('../main/ipc/ipc-helpers');

    const unmapped = [];
    for (const channel of writeChannels) {
        if (!CHANNEL_REGISTRY[channel]) {
            unmapped.push(channel);
        }
    }

    if (unmapped.length > 0) {
        errors.push(`Sync registry missing mappings for write channels: ${unmapped.join(', ')}`);
    }

    // Also check for registry entries that reference non-existent channels
    const registryChannels = Object.keys(CHANNEL_REGISTRY).filter((ch) => !CHANNEL_REGISTRY[ch].exclude);
    const orphaned = registryChannels.filter((ch) => !writeChannels.has(ch));
    if (orphaned.length > 0) {
        errors.push(`Sync registry has entries for non-existent write channels: ${orphaned.join(', ')}`);
    }

    console.log(
        `  ✓ Sync registry: ${Object.keys(CHANNEL_REGISTRY).length} entries, ${writeChannels.size} write channels, ${unmapped.length} unmapped`
    );
})();
```

Look at the existing smoke test file first to understand the error reporting pattern (it likely uses an `errors` array and exits with code 1 if non-empty). Adapt the code above to match.

**Checkpoint**: After T010-T014, run `npm run test:smoke`. ALL tests must pass including the new registry completeness check. Then run `npm run dev`, perform a write operation, and verify a row appears in `sync_outbox`. This validates US1, US2, US3, US4, and US5 together.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final cleanup, lint fixes, and validation.

- [x] T015 [P] Run `npm run lint` on all modified and new files. Fix any ESLint errors. The new file `main/sync/capture.js` falls under Node.js ESLint rules (main-process code). Common issues: unused variables (prefix with `_`), missing semicolons, single quotes.

- [x] T016 [P] Run `npm run format` to apply Prettier formatting to all modified files. Verify the output matches project style: single quotes, no trailing commas, 4-space indent, 120-char line width, semicolons.

- [x] T017 Run `npm run test:smoke` as final validation. All tests must pass including: IPC parity check, no CDN references, Tailwind output, legacy CSS cleanup, AND the new sync registry completeness check. If any test fails, fix the issue and re-run.

- [x] T018 Run `npm run css:build` to verify the CSS build is not broken by any changes (it should not be affected, but this is part of the CI pipeline).

- [x] T019 Verify the full CI pipeline locally: `npm ci && npm run css:build && npm run lint && npm run test:smoke`. ALL four commands must succeed. This matches the CI gate defined in the constitution.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Migration)**: Depends on Phase 1 — creates tables that all other phases need
- **Phase 3 (Sync ID)**: Depends on Phase 2 — needs `sync_id_map` table
- **Phase 4 (Outbox Writer)**: Depends on Phase 3 — needs `ensureSyncIdMapping()` and `getDeviceHash()`
- **Phase 5 (Registry)**: Depends on Phase 1 only (data constant, no runtime deps) — CAN run in parallel with Phase 3-4 but is placed here for logical flow
- **Phase 6 (Wrapper + Integration)**: Depends on Phase 4 + Phase 5 — needs outbox writer AND registry
- **Phase 7 (Polish)**: Depends on Phase 6

### Strict Sequential Order

```
T001 → T002,T003 → T004,T005 → T006,T007,T008 → T009 → T010 → T011 → T012 → T013 → T014 → T015,T016 → T017 → T018 → T019
```

### Parallel Opportunities

Within Phase 4: T006 can run in parallel with T004/T005 (different functions, no dependency)
Within Phase 7: T015 and T016 can run in parallel

### Why Limited Parallelism

This feature is a single-file module (`main/sync/capture.js`) with sequential function dependencies. Most tasks add to the same file and depend on code from previous tasks. The registry (T009) depends on the file existing with the right structure. The wrapper (T011) depends on both the registry and the outbox writer. This limits parallelism compared to multi-file features.

---

## Implementation Strategy

### MVP First (End of Phase 6)

1. Complete Phase 1-6 (T001-T014)
2. **STOP and VALIDATE**: Run `npm run test:smoke` and manually test a write operation
3. The app should be fully functional with invisible capture running in the background

### Incremental Build-Up

1. Phase 2 (T002-T003) → Database tables exist, app starts normally ✓
2. Phase 3 (T004-T005) → Sync ID generation works ✓
3. Phase 4 (T006-T008) → Outbox writer can record entries ✓
4. Phase 5 (T009) → Registry maps all 47 channels ✓
5. Phase 6 (T010-T014) → Everything connected, capture is live ✓
6. Phase 7 (T015-T019) → CI-ready, lint/format clean ✓

---

## Notes

- All new code goes in ONE file: `main/sync/capture.js`. Modified files: `main/db/schema.js`, `main/db/migrations.js`, `main/ipc/ipc-helpers.js`, `main/ipc/registerAll.js`, `tests/smoke.js`.
- No new npm dependencies. No renderer changes. No new HTML pages.
- The `wrapWithSyncCapture` function (T011) is the most complex task. If implementation is unclear, start with the simple `lastInsertRowid` and `argId` extractors, and implement complex extractors (preQuery, inputArray) as TODO stubs.
- `users:getAll` must be EXCLUDED from capture — it uses `handleWrite` for auth but makes no data modifications.
- The device hash MUST be cached — calling `collectCurrentFingerprint()` per write would add 4.5 seconds of overhead.
- The capture layer MUST NOT throw errors — all internal errors are caught and persisted to `sync_config.last_capture_error`.
- Follow Prettier style: single quotes, no trailing commas, 4-space indent, 120-char lines, semicolons.
