# Tasks: Integrity & Conflict Resolution (Phase 5)

**Input**: Design documents from `/specs/005-integrity-conflict-resolution/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Not explicitly requested — test tasks omitted.

**Organization**: Tasks are grouped by user story. Each task includes exact file paths, complete implementation details, and code-level guidance so that any LLM can implement without needing to explore the codebase.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Exact file paths included in all descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Database migration that all user stories depend on.

- [ ] T001 Add migration `2026-03-033-integrity-conflict-resolution` in `main/db/migrations.js`

  **What to do**: Append a new migration object to the `MIGRATIONS` array (after the existing `2026-03-032-pull-engine` entry). The migration must:

  1. Create the `sync_snapshots` table:
     ```sql
     CREATE TABLE IF NOT EXISTS sync_snapshots (
         row_sync_id TEXT PRIMARY KEY,
         table_name  TEXT NOT NULL,
         checksum    TEXT NOT NULL,
         updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
     )
     ```
     Plus index: `CREATE INDEX IF NOT EXISTS idx_sync_snapshots_table ON sync_snapshots(table_name)`

  2. Add columns to `sync_conflicts` using `ensureColumn()`:
     - `ensureColumn('sync_conflicts', 'ancestor_data', 'TEXT')`
     - `ensureColumn('sync_conflicts', 'conflicting_fields', 'TEXT')`
     - `ensureColumn('sync_conflicts', 'resolution_method', 'TEXT')`
     - `ensureColumn('sync_conflicts', 'resolved_data', 'TEXT')`

  3. Add columns to `sync_id_map` using `ensureColumn()`:
     - `ensureColumn('sync_id_map', 'version', 'INTEGER DEFAULT 0')`
     - `ensureColumn('sync_id_map', 'ancestor_data', 'TEXT')`

  4. Add columns to `sync_config` using `ensureColumn()`:
     - `ensureColumn('sync_config', 'snapshot_interval_minutes', 'INTEGER DEFAULT 30')`
     - `ensureColumn('sync_config', 'last_snapshot_at', 'DATETIME')`
     - `ensureColumn('sync_config', 'last_snapshot_error', 'TEXT')`

  **Code pattern**: Follow the exact pattern of migration `2026-03-032-pull-engine` at the bottom of the file. The `ensureColumn` function is already imported at the top of `migrations.js`. The `getDb` function is also already imported.

  **Version string**: `'2026-03-033-integrity-conflict-resolution'`

  **How to verify**: Run `npm run test:smoke` — it should pass. Run the app with `npm run start` — the migration should execute silently on startup.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The merge module is a pure-logic foundation used by all subsequent user stories (snapshot checker, push engine version guards, pull engine merge). It MUST be complete before any user story work begins.

**CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T002 Create the merge module at `main/sync/merge.js`

  **What to do**: Create a new file `main/sync/merge.js` with two exported functions. This is a pure-logic module — NO database access, NO `require('../db/context')`, NO side effects.

  **Function 1: `computeRowChecksum(rowData, sensitiveFields)`**

  Parameters:
  - `rowData` — object (the row's column values, e.g. `{ id: 1, full_name: 'أحمد', code: 'S001' }`)
  - `sensitiveFields` — string array (fields to exclude, e.g. `['password_hash', 'pin_hash']`)

  Returns: a deterministic string hash of the row data.

  Algorithm:
  1. Shallow-clone `rowData`. Delete every key in `sensitiveFields` from the clone.
  2. Get all keys of the clone, sort them alphabetically.
  3. Build a string by concatenating `key=value|` for each key in sorted order. Use `String(value)` for each value. Treat `null`/`undefined` as empty string `''`.
  4. Compute a 32-bit FNV-1a hash of the concatenated string:
     ```js
     function fnv1a(str) {
         let hash = 0x811c9dc5; // FNV offset basis
         for (let i = 0; i < str.length; i++) {
             hash ^= str.charCodeAt(i);
             hash = (hash * 0x01000193) >>> 0; // FNV prime, keep unsigned 32-bit
         }
         return hash.toString(16).padStart(8, '0');
     }
     ```
  5. Return the hex string (e.g. `'a3f2b1c0'`).

  **Function 2: `threeWayMerge(ancestor, local, remote, localTimestamp, remoteTimestamp)`**

  Parameters:
  - `ancestor` — object or `null` (the last agreed-upon version from `sync_id_map.ancestor_data`, parsed from JSON. `null` means no ancestor available.)
  - `local` — object (the local version of the record)
  - `remote` — object (the remote version of the record)
  - `localTimestamp` — number (epoch seconds of the local change)
  - `remoteTimestamp` — number (epoch seconds of the remote change)

  Returns: `{ merged: object, conflicts: string[], resolution: string }`
  - `merged` — the final merged record
  - `conflicts` — array of field names where both local and remote changed the same field to different values (LWW was applied)
  - `resolution` — one of:
    - `'clean'` — local and remote are identical, or all changes were one-sided
    - `'merged'` — non-overlapping changes were auto-merged (no true conflicts)
    - `'lww'` — at least one field had a true overlap resolved by last-writer-wins

  Algorithm:
  ```
  allFields = union of all keys in ancestor (if not null), local, and remote
  merged = {}
  conflicts = []
  hadNonOverlap = false

  for each field in allFields:
    aVal = ancestor != null ? ancestor[field] : undefined
    lVal = local[field]
    rVal = remote[field]

    // Compare using JSON.stringify for objects/arrays, === for primitives
    lStr = JSON.stringify(lVal)
    rStr = JSON.stringify(rVal)
    aStr = JSON.stringify(aVal)

    if (lStr === rStr):
      merged[field] = lVal   // both agree — no conflict
    else if (ancestor != null && lStr === aStr):
      merged[field] = rVal   // only remote changed
      hadNonOverlap = true
    else if (ancestor != null && rStr === aStr):
      merged[field] = lVal   // only local changed
      hadNonOverlap = true
    else:
      // True overlap or no ancestor — LWW
      merged[field] = remoteTimestamp >= localTimestamp ? rVal : lVal
      conflicts.push(field)

  resolution = conflicts.length > 0 ? 'lww'
             : hadNonOverlap ? 'merged'
             : 'clean'

  return { merged, conflicts, resolution }
  ```

  **Module exports**:
  ```js
  module.exports = { computeRowChecksum, threeWayMerge };
  ```

  **Code style**: Follow Prettier rules — single quotes, 4-space indent, semicolons, no trailing commas. Follow ESLint Node rules — unused vars with `_` prefix are OK.

  **How to verify**: You can test this module in isolation by requiring it directly in Node.js and calling the functions with sample data. No database or Electron needed.

- [ ] T003 Export `isPullCycleRunning()` getter from `main/sync/engine.js`

  **What to do**: The snapshot checker (US1/US5) needs to know if a pull cycle is currently in progress to defer. The `_pullRunning` variable in `engine.js` is module-private. Add a public getter.

  1. Add this function after the existing `isPullTimerRunning()` function (around line 912):
     ```js
     function isPullCycleRunning() {
         return _pullRunning;
     }
     ```

  2. Add `isPullCycleRunning` to the `module.exports` object at the bottom of the file (line ~955):
     ```js
     module.exports = {
         flushSyncOutbox,
         startSyncPushBackground,
         stopSyncPushBackground,
         restartSyncPushBackground,
         pullRemoteChanges,
         startSyncPullBackground,
         stopSyncPullBackground,
         restartSyncPullBackground,
         isPushTimerRunning,
         isPullTimerRunning,
         isPullCycleRunning    // ← add this
     };
     ```

  **How to verify**: `npm run lint` should pass. The new function is a one-liner with no logic to break.

**Checkpoint**: Foundation ready — migration, merge module, and engine getter are in place. User story implementation can now begin.

---

## Phase 3: User Story 1 — Missed Changes Are Automatically Detected and Synced (Priority: P1) 🎯 MVP

**Goal**: The re-snapshot checker detects rows that were inserted, updated, or deleted directly in the local database (bypassing the sync capture layer) and enqueues them in the sync outbox.

**Independent Test**: Directly insert a row into a local SQLite table via the `better-sqlite3` API (bypassing IPC), run `runSnapshotCycle()`, and verify the new row appears in `sync_outbox` with a `PUT` operation.

### Implementation for User Story 1

- [ ] T004 [US1] Create the snapshot checker core at `main/sync/snapshot.js` — row-level diff and outbox enqueue logic

  **What to do**: Create a new file `main/sync/snapshot.js`. This is the core of User Story 1 — detecting drift and enqueuing missed changes.

  **Required imports** (at top of file):
  ```js
  const { getDb } = require('../db/context');
  const { ENTITY_TYPE_REGISTRY } = require('./authority');
  const { ensureSyncIdMapping, stripSensitiveFields, recordOutboxEntry, SENSITIVE_FIELDS } = require('./capture');
  const { isPullCycleRunning } = require('./engine');
  const { computeRowChecksum } = require('./merge');
  ```

  **Module-level state**:
  ```js
  let _snapshotTimer = null;
  let _snapshotRunning = false;
  ```

  **Function: `runSnapshotCycle()`** — the core algorithm.
  Returns: `Promise<{ success: boolean, skipped?: boolean, tablesChecked: number, changesDetected: number, enqueued: number, pruned: number, lastError: string|null }>`

  Algorithm (fully synchronous DB ops, only the wrapper is async for consistent return type):

  ```
  1. Guard: if _snapshotRunning → return { success: true, skipped: true, reason: 'already_running' }
  2. Guard: if isPullCycleRunning() → return { success: true, skipped: true, reason: 'pull_in_progress' }
  3. Set _snapshotRunning = true
  4. Wrap everything in try/catch/finally (_snapshotRunning = false in finally)

  5. Read sync_config: const config = db.prepare('SELECT * FROM sync_config WHERE id = 1').get()
     If !config || !config.enabled → return { success: true, skipped: true, reason: 'disabled' }

  6. Initialize counters: tablesChecked = 0, changesDetected = 0, enqueued = 0

  7. Get list of all table names from ENTITY_TYPE_REGISTRY:
     const tableNames = Object.keys(ENTITY_TYPE_REGISTRY);

  8. For each tableName:
     a. tablesChecked++
     b. Get current row count: db.prepare(`SELECT COUNT(*) AS c FROM "${tableName}"`).get().c
     c. Get stored snapshot count: db.prepare('SELECT COUNT(*) AS c FROM sync_snapshots WHERE table_name = ?').get(tableName).c
     d. If counts match AND tableName has been snapshotted before:
        - Do a quick aggregate check: get all row_sync_ids from sync_snapshots for this table
        - Get all rows from the table
        - If row count still matches and we have all IDs, do row-level check below
     e. Get ALL rows from the table:
        const rows = db.prepare(`SELECT * FROM "${tableName}"`).all()
     f. Get the primary key field for this table:
        - For 'students': primary key is 'code'
        - For 'settings': primary key is 'key'
        - For 'page_visibility': primary key is 'key'
        - For all others: primary key is 'id'
        (Look at ENTITY_TYPE_REGISTRY[tableName].keyFields[0] to determine this — but note that
         for grades/absences the keyFields are composite. For snapshot purposes, always use the
         row's actual DB primary key: usually 'id', except students='code', settings='key',
         page_visibility='key'. The local_id in sync_id_map stores whatever value ensureSyncIdMapping used.)
     g. For each row:
        - Determine localId: row.id ?? row.code ?? row.key
        - If localId is null/undefined → skip this row
        - Get or create the row_sync_id: ensureSyncIdMapping(db, tableName, localId)
        - Compute checksum: computeRowChecksum(stripSensitiveFields({ ...row }), SENSITIVE_FIELDS)
        - Lookup stored checksum: db.prepare('SELECT checksum FROM sync_snapshots WHERE row_sync_id = ?').get(rowSyncId)
        - If no stored checksum (new row) OR stored checksum !== computed checksum (modified row):
          → changesDetected++
          → Get schoolYear from the row: row.school_year || ''
          → Enqueue: recordOutboxEntry(db, tableName, localId, 'PUT', stripSensitiveFields({ ...row }), schoolYear)
          → enqueued++
          → Upsert snapshot:
            db.prepare(`
              INSERT INTO sync_snapshots(row_sync_id, table_name, checksum, updated_at)
              VALUES(?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(row_sync_id) DO UPDATE SET checksum = ?, updated_at = CURRENT_TIMESTAMP
            `).run(rowSyncId, tableName, checksum, checksum)
     h. Build a Set of all current row_sync_ids for this table (from step g)
     i. Detect deletions — get all stored snapshot entries for this table:
        const storedSnapshots = db.prepare('SELECT row_sync_id FROM sync_snapshots WHERE table_name = ?').all(tableName)
        For each stored entry:
          - If its row_sync_id is NOT in the Set from step h:
            → changesDetected++
            → Get the local_id from sync_id_map: db.prepare('SELECT local_id FROM sync_id_map WHERE row_sync_id = ?').get(storedRowSyncId)
            → If mapping found: recordOutboxEntry(db, tableName, mapping.local_id, 'DEL', null, '')
            → enqueued++
            → Delete the orphaned snapshot: db.prepare('DELETE FROM sync_snapshots WHERE row_sync_id = ?').run(storedRowSyncId)

  9. Prune old resolved conflicts:
     const pruned = db.prepare(`
       DELETE FROM sync_conflicts
       WHERE status = 'resolved' AND resolved_at < datetime('now', '-30 days')
     `).run().changes

  10. Update sync_config:
      db.prepare('UPDATE sync_config SET last_snapshot_at = CURRENT_TIMESTAMP, last_snapshot_error = NULL WHERE id = 1').run()

  11. Return { success: true, tablesChecked, changesDetected, enqueued, pruned, lastError: null }
  ```

  On error (in catch):
  ```js
  db.prepare('UPDATE sync_config SET last_snapshot_error = ? WHERE id = 1').run(err.message);
  return { success: false, tablesChecked, changesDetected, enqueued, pruned: 0, lastError: err.message };
  ```

  **Function: `isSnapshotRunning()`** — returns `_snapshotRunning`.

  **Partial exports** (more functions added in US5):
  ```js
  module.exports = { runSnapshotCycle, isSnapshotRunning };
  ```

  **Code style**: Single quotes, 4-space indent, semicolons. Table names in SQL use double-quote escaping (`"${tableName}"`) since some table names might collide with SQL keywords. Wrap the entire per-table loop body in try/catch so one table's failure doesn't abort the cycle.

  **How to verify**: Require the module from a Node.js script, mock `getDb()` with an in-memory SQLite database, insert a row into a table, call `runSnapshotCycle()`, and check `sync_outbox` for the new entry.

---

## Phase 4: User Story 2 — Stale Cloud Writes Are Rejected with Version Guards (Priority: P1)

**Goal**: The push engine includes version numbers in each cloud write and uses DynamoDB conditional expressions to reject stale versions. Version conflicts are detected and logged.

**Independent Test**: Push a record with version 1. Then attempt to push the same record again with version 1 — the conditional write should fail with `ConditionalCheckFailedException`, and a conflict entry should appear in `sync_conflicts`.

### Implementation for User Story 2

- [ ] T005 [US2] Modify `buildDynamoItem()` in `main/sync/engine.js` to read version from `sync_id_map` instead of hardcoding 1

  **What to do**: The function `buildDynamoItem` (starting around line 127) currently sets `version: 1` on line 161. Change it to read the stored version from `sync_id_map` and increment it.

  1. Add a `db` parameter to `buildDynamoItem`. The new signature is:
     `function buildDynamoItem(db, entry, schoolId, deviceHash)`

  2. Before the `return` statement (around line 152), add version lookup:
     ```js
     const mapping = db.prepare('SELECT version FROM sync_id_map WHERE row_sync_id = ?').get(entry.row_sync_id);
     const currentVersion = Number(mapping?.version || 0);
     const newVersion = currentVersion + 1;
     ```

  3. Change line 161 from `version: 1` to `version: newVersion`.

  4. Update ALL call sites of `buildDynamoItem` to pass `db` as the first argument. There are exactly 3 call sites in the file:
     - In `flushSyncOutbox()` around line 608: `buildDynamoItem(row, schoolId, deviceHash)` → `buildDynamoItem(db, row, schoolId, deviceHash)`
     - In `expandBulkEntry()` → `flushExpandedEntries()` around line 441: `buildDynamoItem(expanded, schoolId, deviceHash)` → `buildDynamoItem(db, expanded, schoolId, deviceHash)`
     - Search for any other calls and update them.

  **How to verify**: `npm run lint` should pass. The version number will now be dynamic based on `sync_id_map.version`.

- [ ] T006 [US2] Modify `flushPreparedItems()` in `main/sync/engine.js` to route all items through conditional writes

  **What to do**: Currently, `flushPreparedItems` (line ~285) only uses `writeItemWithCondition` when `preparedItems.some(p => p.item.version > 1)`. Since ALL items now have incrementing versions (from T005), change the routing logic.

  1. Find the condition check on line ~290:
     ```js
     if (preparedItems.some((prepared) => prepared.item.version > 1)) {
     ```
     Change it to always use conditional writes:
     ```js
     // Always use conditional writes for version-guarded pushes
     {
     ```
     This makes the batch write path (`writeBatchToDynamo`) unreachable for normal flow. Keep the batch write function in the file — it's still used by `flushExpandedEntries` for bulk operations.

  2. In the ConditionalCheckFailedException handling path (inside the `for (const prepared of preparedItems)` loop, around line 295-320), after `markEntryFailed(...)`, add conflict logging:

     Find the block that handles `result.conflict` (around line 303-311). After `markEntryFailed(...)`, add:
     ```js
     if (result.conflict) {
         // Log enriched conflict entry for version conflicts
         try {
             const ancestorMapping = db.prepare('SELECT ancestor_data FROM sync_id_map WHERE row_sync_id = ?').get(prepared.item.rowSyncId);
             db.prepare(`
                 INSERT INTO sync_conflicts(table_name, row_sync_id, entity_type, local_data, remote_data,
                     remote_version, remote_device_hash, local_outbox_id, ancestor_data, resolution_method, status)
                 VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'lww', 'unresolved')
             `).run(
                 prepared.item.entityType ? Object.keys(ENTITY_TYPE_REGISTRY).find(k => ENTITY_TYPE_REGISTRY[k].entityType === prepared.item.entityType) || '',
                 prepared.item.rowSyncId || '',
                 prepared.item.entityType || '',
                 JSON.stringify(prepared.item.data || {}),
                 '', // remote_data unknown until fetched — placeholder
                 prepared.item.version,
                 prepared.item.deviceHash || '',
                 prepared.entryId,
                 ancestorMapping?.ancestor_data || null
             );
         } catch (_conflictErr) {
             // Non-critical — don't fail the push over conflict logging
         }
     }
     ```

  **Note**: The `ENTITY_TYPE_REGISTRY` import needs to be added at the top of engine.js — it's already imported via `require('./authority')` on line 6: `const { canPush, buildSortKey, getEntityType, ENTITY_TYPE_REGISTRY } = require('./authority');` — `ENTITY_TYPE_REGISTRY` is already imported. Verify this.

  **How to verify**: `npm run lint` should pass. Push operations now use conditional writes. If a version conflict occurs, a `sync_conflicts` row is created.

- [ ] T007 [US2] Modify `markEntrySent()` in `main/sync/engine.js` to update version and ancestor in `sync_id_map`

  **What to do**: After a successful push, update the version and ancestor_data in `sync_id_map` so the next push uses the correct version, and the ancestor is available for future three-way merges.

  1. Find `markEntrySent` (around line 239). Currently it only updates `sync_outbox`. Add two more statements:

     ```js
     function markEntrySent(db, entryId) {
         db.prepare(
             "UPDATE sync_outbox SET status = 'sent', sent_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?"
         ).run(entryId);

         // Update version and ancestor in sync_id_map for the pushed entry
         const entry = db.prepare('SELECT row_sync_id, row_data FROM sync_outbox WHERE id = ?').get(entryId);
         if (entry && entry.row_sync_id) {
             db.prepare(
                 'UPDATE sync_id_map SET version = version + 1, ancestor_data = ? WHERE row_sync_id = ?'
             ).run(entry.row_data, entry.row_sync_id);
         }
     }
     ```

  **IMPORTANT**: The `entry` query reads the outbox row we just marked as 'sent'. The `row_data` from the outbox becomes the new `ancestor_data` — this is the version that both local and cloud now agree on.

  **How to verify**: After a successful push, check that `sync_id_map.version` is incremented and `ancestor_data` matches the pushed `row_data`.

**Checkpoint**: Version-guarded cloud writes are active. All pushes use conditional expressions. Version conflicts create conflict log entries.

---

## Phase 5: User Story 3 — Non-Overlapping Field Changes Are Merged Automatically (Priority: P1)

**Goal**: When the pull engine detects a conflict (pending local change + incoming remote change for the same record), it uses three-way merge to automatically combine non-overlapping field changes.

**Independent Test**: Create a scenario where local has changed field A and remote has changed field B (different fields). Run the pull. Verify the merged result contains both changes and no conflict is logged.

**Dependencies**: Requires T002 (merge module) and T007 (ancestor tracking).

### Implementation for User Story 3

- [ ] T008 [US3] Modify `pullRemoteChanges()` conflict handling in `main/sync/engine.js` to use three-way merge

  **What to do**: The pull engine's conflict handling section (inside the `applyChanges` transaction, around line 780-798) currently logs conflicts and applies remote data unconditionally. Change it to use `threeWayMerge`.

  1. Add import at the top of `engine.js` (around line 1-6):
     ```js
     const { threeWayMerge, computeRowChecksum } = require('./merge');
     ```

  2. Find the conflict detection block inside the `applyChanges` transaction (around line 782-798). Currently:
     ```js
     const pending = pendingMap.get(item.rowSyncId);
     if (pending) {
         db.prepare(`INSERT INTO sync_conflicts(...) VALUES(...)`).run(...);
         conflictCount++;
     }
     ```

     Replace the entire `if (pending) { ... }` block with:
     ```js
     const pending = pendingMap.get(item.rowSyncId);
     if (pending) {
         // Load ancestor for three-way merge
         const ancestorRow = db.prepare('SELECT ancestor_data FROM sync_id_map WHERE row_sync_id = ?').get(item.rowSyncId);
         let ancestor = null;
         try { ancestor = ancestorRow?.ancestor_data ? JSON.parse(ancestorRow.ancestor_data) : null; } catch (_) { /* no ancestor */ }

         // Load current local data from the actual DB row
         let localData = {};
         try { localData = pending.rowData ? JSON.parse(pending.rowData) : {}; } catch (_) { /* empty */ }

         const localTs = Math.floor(Date.now() / 1000); // local change time (approximate)
         const remoteTs = item.version || 0; // use version as proxy for timestamp ordering

         const mergeResult = threeWayMerge(ancestor, localData, item.data, localTs, remoteTs);

         // Use merged data instead of raw remote data
         item.data = mergeResult.merged;

         if (mergeResult.resolution === 'clean') {
             // Perfect merge — discard pending outbox entry
             db.prepare("UPDATE sync_outbox SET status = 'sent' WHERE id = ?").run(pending.outboxId);
         } else {
             // Log enriched conflict entry
             const status = mergeResult.conflicts.length > 0 ? 'resolved' : 'resolved';
             const resolutionMethod = mergeResult.resolution === 'lww' ? 'lww' : 'merged';
             db.prepare(`
                 INSERT INTO sync_conflicts(table_name, row_sync_id, entity_type, local_data, remote_data,
                     remote_version, remote_device_hash, local_outbox_id, ancestor_data,
                     conflicting_fields, resolution_method, resolved_data, status, resolution, resolved_at)
                 VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'resolved', ?, CURRENT_TIMESTAMP)
             `).run(
                 item.tableName,
                 item.rowSyncId,
                 item.entityType,
                 pending.rowData,
                 JSON.stringify(item.data),
                 item.version,
                 item.deviceHash,
                 pending.outboxId,
                 ancestorRow?.ancestor_data || null,
                 JSON.stringify(mergeResult.conflicts),
                 resolutionMethod,
                 JSON.stringify(mergeResult.merged),
                 mergeResult.conflicts.length > 0 ? 'remote' : 'merged'
             );
             // Discard the pending outbox entry since we've merged
             db.prepare("UPDATE sync_outbox SET status = 'sent' WHERE id = ?").run(pending.outboxId);
             conflictCount++;
         }
     }
     ```

  3. After each successful PUT application (both the update and insert paths, around lines 808-836), add ancestor_data update:

     After the `appliedCount++` on the PUT paths, add:
     ```js
     // Update ancestor to the applied version
     db.prepare('UPDATE sync_id_map SET ancestor_data = ?, version = ? WHERE row_sync_id = ?')
         .run(JSON.stringify(item.data), item.version, item.rowSyncId);
     ```

  **How to verify**: Create a scenario with pending outbox and incoming remote change for the same record with non-overlapping field changes. After pull, verify both field changes are preserved and `sync_outbox` entry is marked as 'sent'.

**Checkpoint**: Three-way merge is active in the pull engine. Non-overlapping field changes merge automatically.

---

## Phase 6: User Story 4 — Overlapping Field Changes Apply Last-Writer-Wins (Priority: P2)

**Goal**: When both local and remote modify the same field to different values, last-writer-wins is applied and the conflict is logged with full details.

**Independent Test**: Create a scenario where both local and remote changed the same field to different values. Verify LWW resolves it and a conflict entry includes both values.

**Dependencies**: Fully satisfied by T008 (the merge logic already handles LWW via `threeWayMerge`). This phase consists of verification-only — the LWW behavior was implemented as part of US3's `threeWayMerge` integration.

### Implementation for User Story 4

- [ ] T009 [US4] Verify LWW conflict logging includes both values in `main/sync/engine.js`

  **What to do**: Review the conflict INSERT in T008. The `local_data` and `remote_data` columns already store both versions. The `conflicting_fields` column stores the JSON array of field names that had true overlaps. The `resolution_method` is set to `'lww'` when `mergeResult.resolution === 'lww'`. The `resolved_data` stores the final merged result.

  This is a **verification task** — confirm the following columns are populated correctly in the `sync_conflicts` INSERT from T008:
  - `local_data` → the pending outbox `row_data` (local version)
  - `remote_data` → `JSON.stringify(item.data)` (this is the MERGED data, not raw remote — consider storing raw remote before merge if you want the original remote data preserved. If so, save `item.data` BEFORE the merge line `item.data = mergeResult.merged` and use the saved copy for `remote_data`.)

  **Fix if needed**: In T008, BEFORE the line `item.data = mergeResult.merged;`, save the original remote data:
  ```js
  const originalRemoteData = JSON.stringify(item.data); // save before merge overwrites it
  ```
  Then use `originalRemoteData` for the `remote_data` parameter in the INSERT.

  **How to verify**: Trigger a same-field conflict. Check that `sync_conflicts` has `local_data` with the local value, `remote_data` with the original remote value (not merged), `conflicting_fields` lists the field name, and `resolved_data` has the LWW winner.

**Checkpoint**: LWW conflicts are fully logged with both original values and the winning value.

---

## Phase 7: User Story 5 — Re-Snapshot Checker Runs Periodically in the Background (Priority: P2)

**Goal**: The snapshot checker starts automatically with the app, runs on a configurable interval, and stops cleanly on exit.

**Independent Test**: Enable sync, start the app, wait for one snapshot interval, and confirm the checker executed without errors by checking `sync_config.last_snapshot_at`.

**Dependencies**: Requires T004 (snapshot core logic).

### Implementation for User Story 5

- [ ] T010 [US5] Add background timer functions to `main/sync/snapshot.js`

  **What to do**: Add the timer lifecycle functions to `main/sync/snapshot.js` (created in T004).

  Add these functions after `runSnapshotCycle()`:

  ```js
  function startSnapshotBackground() {
      if (_snapshotTimer) return;

      try {
          const db = getDb();
          const config = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
          if (!config || !Number(config.enabled)) return;

          // Run an immediate cycle
          void runSnapshotCycle();

          const intervalMinutes = Math.max(10, Math.min(120, Number(config.snapshot_interval_minutes) || 30));
          const intervalMs = intervalMinutes * 60 * 1000;

          _snapshotTimer = setInterval(() => {
              void runSnapshotCycle();
          }, intervalMs);

          if (typeof _snapshotTimer.unref === 'function') {
              _snapshotTimer.unref();
          }

          console.log(`[sync:snapshot] Background snapshot started (interval: ${intervalMinutes}min)`);
      } catch (err) {
          console.warn('[sync:snapshot] Failed to start snapshot background:', err.message);
      }
  }

  function stopSnapshotBackground() {
      if (_snapshotTimer) {
          clearInterval(_snapshotTimer);
          _snapshotTimer = null;
          console.log('[sync:snapshot] Background snapshot stopped');
      }
  }

  function restartSnapshotBackground() {
      stopSnapshotBackground();
      startSnapshotBackground();
  }
  ```

  Update `module.exports` to include all functions:
  ```js
  module.exports = {
      runSnapshotCycle,
      isSnapshotRunning,
      startSnapshotBackground,
      stopSnapshotBackground,
      restartSnapshotBackground
  };
  ```

  **Code pattern**: This follows the exact same pattern as `startSyncPushBackground()` and `startSyncPullBackground()` in `engine.js`. Uses `.unref()` to avoid blocking Electron shutdown.

  **How to verify**: Call `startSnapshotBackground()` with sync enabled — verify the timer starts and `runSnapshotCycle` is called.

- [ ] T011 [US5] Add snapshot lifecycle calls to `main.js`

  **What to do**: Start the snapshot background timer when the app launches (after push+pull), and stop it on shutdown.

  1. Read `main.js` and find where `startSyncPushBackground()` and `startSyncPullBackground()` are called (this is the sync startup section).

  2. Add import at the top of main.js, near other sync imports:
     ```js
     const { startSnapshotBackground, stopSnapshotBackground } = require('./main/sync/snapshot');
     ```

  3. After the `startSyncPullBackground()` call, add:
     ```js
     startSnapshotBackground();
     ```

  4. Find where `stopSyncPushBackground()` and `stopSyncPullBackground()` are called (app shutdown section). Before or after those calls, add:
     ```js
     stopSnapshotBackground();
     ```

  **How to verify**: Start the app with `npm run start`. Check the console for `[sync:snapshot] Background snapshot started`. Close the app — check for `[sync:snapshot] Background snapshot stopped`.

**Checkpoint**: The snapshot checker runs automatically in the background.

---

## Phase 8: User Story 6 — Conflict Log Records Are Enriched with Resolution Details (Priority: P3)

**Goal**: The `sync:getConflictLog` IPC channel returns enriched conflict entries with ancestor data, conflicting fields, resolution method, and resolved data. The `sync:setConfig` channel handles the new snapshot interval setting.

**Independent Test**: Call `window.api.sync.getConflictLog()` after a conflict has been auto-resolved. Verify the response includes `ancestorData`, `conflictingFields`, `resolutionMethod`, and `resolvedData`.

**Dependencies**: Requires T008 (conflicts are already enriched in the DB). This phase exposes them via IPC.

### Implementation for User Story 6

- [ ] T012 [US6] Update `sync:getConflictLog` handler in `main/ipc/sync.js` to return enriched fields

  **What to do**: Find the `sync:getConflictLog` handler (around line 36 in `main/ipc/sync.js`). It currently SELECTs from `sync_conflicts` and returns rows. Add the new columns to the response.

  1. Find the SELECT query in the `sync:getConflictLog` handler. It likely does `SELECT * FROM sync_conflicts`. If it selects specific columns, add: `ancestor_data, conflicting_fields, resolution_method, resolved_data`.

  2. In the response mapping (where rows are transformed to camelCase), add:
     ```js
     ancestorData: row.ancestor_data ? JSON.parse(row.ancestor_data) : null,
     conflictingFields: row.conflicting_fields ? JSON.parse(row.conflicting_fields) : [],
     resolutionMethod: row.resolution_method || null,
     resolvedData: row.resolved_data ? JSON.parse(row.resolved_data) : null
     ```

     Wrap JSON.parse calls in try/catch to handle malformed data gracefully:
     ```js
     let ancestorData = null;
     try { ancestorData = row.ancestor_data ? JSON.parse(row.ancestor_data) : null; } catch (_) { ancestorData = row.ancestor_data; }
     ```
     Do the same for `conflictingFields` and `resolvedData`.

  **How to verify**: Call `window.api.sync.getConflictLog()` from the renderer console. Verify new fields appear in the response.

- [ ] T013 [US6] Update `sync:getStatus` handler in `main/ipc/sync.js` to include snapshot status

  **What to do**: Find the `sync:getStatus` handler. Add snapshot-related fields to the response.

  1. Add import at the top of `main/ipc/sync.js`:
     ```js
     const { isSnapshotRunning } = require('../sync/snapshot');
     ```

  2. In the response object, add:
     ```js
     snapshotRunning: isSnapshotRunning(),
     lastSnapshotAt: config.last_snapshot_at || null,
     lastSnapshotError: config.last_snapshot_error || null,
     snapshotIntervalMinutes: Number(config.snapshot_interval_minutes) || 30
     ```

  **How to verify**: Call `window.api.sync.getStatus()`. Verify `snapshotRunning`, `lastSnapshotAt`, etc. appear.

- [ ] T014 [US6] Update `sync:setConfig` handler in `main/ipc/sync.js` to handle `snapshotIntervalMinutes`

  **What to do**: The `sync:setConfig` handler has a field map that maps JS keys to DB columns. Add the snapshot interval.

  1. Find the field map object (around line 80-100 in sync.js). Add:
     ```js
     snapshotIntervalMinutes: 'snapshot_interval_minutes'
     ```

  2. Find where `restartSyncPushBackground()` and `restartSyncPullBackground()` are called after config update. Add:
     ```js
     const { restartSnapshotBackground } = require('../sync/snapshot');
     // ... after the existing restart calls:
     restartSnapshotBackground();
     ```

     Note: The import might need to be at the top of the file or lazy-required to avoid circular dependencies. If there's already a pattern of lazy requires in this file, follow that pattern.

  **How to verify**: Call `window.api.sync.setConfig({ snapshotIntervalMinutes: 15 })`. Verify the DB column is updated and the snapshot timer restarts.

- [ ] T015 [US6] Update `sync:triggerNow` handler in `main/ipc/sync.js` to also run snapshot cycle

  **What to do**: The `sync:triggerNow` handler currently runs `flushSyncOutbox()` then `pullRemoteChanges()`. Add a snapshot cycle after both.

  1. Add import (if not already added in T014):
     ```js
     const { runSnapshotCycle } = require('../sync/snapshot');
     ```

  2. In the `sync:triggerNow` handler, after the pull completes, add:
     ```js
     let snapshot = null;
     try {
         snapshot = await runSnapshotCycle();
     } catch (err) {
         snapshot = { success: false, lastError: err.message };
     }
     ```

  3. Include `snapshot` in the return value: `return { push, pull, snapshot, error: null };`

  **How to verify**: Call `window.api.sync.triggerNow()`. Verify the response includes a `snapshot` object with `tablesChecked`, `changesDetected`, etc.

- [ ] T016 [US6] Update `sync:resolveConflict` handler in `main/ipc/sync.js` to update ancestor_data

  **What to do**: When an admin manually resolves a conflict (choosing 'local' or 'remote'), update `sync_id_map.ancestor_data` to the chosen version so future merges use the correct baseline.

  1. Find the `sync:resolveConflict` handler. After the conflict is marked as resolved, add:
     ```js
     // Update ancestor to the resolved version
     const conflict = db.prepare('SELECT row_sync_id, local_data, remote_data FROM sync_conflicts WHERE id = ?').get(conflictId);
     if (conflict) {
         const chosenData = resolution === 'local' ? conflict.local_data : conflict.remote_data;
         db.prepare('UPDATE sync_id_map SET ancestor_data = ? WHERE row_sync_id = ?')
             .run(chosenData, conflict.row_sync_id);
     }
     ```

  2. Also update the conflict row with resolution details:
     ```js
     db.prepare(`
         UPDATE sync_conflicts
         SET resolved_data = ?, resolution_method = 'manual'
         WHERE id = ?
     `).run(
         resolution === 'local' ? conflict.local_data : conflict.remote_data,
         conflictId
     );
     ```

  **How to verify**: Resolve a conflict via `window.api.sync.resolveConflict({ conflictId: 1, resolution: 'local' })`. Check that `sync_id_map.ancestor_data` is updated.

**Checkpoint**: All IPC channels return enriched data. The sync settings UI (Phase 6) will have everything it needs.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and cleanup across all user stories.

- [ ] T017 Update snapshot checksums after successful pull apply in `main/sync/engine.js`

  **What to do**: After the pull engine successfully applies a PUT operation (both insert and update paths), update the `sync_snapshots` table so the snapshot checker recognizes this row as "in sync."

  In `pullRemoteChanges()`, after each successful `appliedCount++` on the PUT paths (after the ancestor_data update added in T008), add:
  ```js
  // Update snapshot checksum for the applied row
  try {
      const { computeRowChecksum } = require('./merge');
      const { SENSITIVE_FIELDS } = require('./capture');
      const checksum = computeRowChecksum(item.data, SENSITIVE_FIELDS);
      db.prepare(`
          INSERT INTO sync_snapshots(row_sync_id, table_name, checksum, updated_at)
          VALUES(?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(row_sync_id) DO UPDATE SET checksum = ?, updated_at = CURRENT_TIMESTAMP
      `).run(item.rowSyncId, item.tableName, checksum, checksum);
  } catch (_) { /* non-critical */ }
  ```

  **Note**: Move the `require` calls to the top of the file if not already there (they should be from T008).

  **How to verify**: After a pull applies a record, check `sync_snapshots` for the corresponding `row_sync_id` with the correct checksum.

- [ ] T018 Run `npm run lint` and fix any ESLint errors across all modified files

  **What to do**: Run `npm run lint` from the project root. Fix any errors in:
  - `main/sync/merge.js` (new file)
  - `main/sync/snapshot.js` (new file)
  - `main/sync/engine.js` (modified)
  - `main/ipc/sync.js` (modified)
  - `main/db/migrations.js` (modified)
  - `main.js` (modified)

  Common issues to watch for:
  - Unused variables (prefix with `_` if intentionally unused, e.g. `_err`)
  - Missing semicolons
  - Single quotes vs double quotes
  - Line length > 120 chars
  - `no-empty` on catch blocks — use `catch (_) { /* comment */ }` pattern

  **How to verify**: `npm run lint` exits with code 0 and zero errors.

- [ ] T019 Run `npm run test:smoke` and verify zero regressions

  **What to do**: Run `npm run test:smoke` from the project root. All existing tests must pass. Since Phase 5 adds no new IPC channels and doesn't modify `preload.js`, the IPC parity check should pass unchanged.

  If any test fails, investigate and fix. Common causes:
  - New `require()` in a module that the smoke test imports — make sure all required modules exist
  - Missing exports in modified files

  **How to verify**: `npm run test:smoke` exits with code 0.

- [ ] T020 Run `npm run format` to ensure Prettier compliance across all files

  **What to do**: Run `npm run format` to auto-fix formatting in all modified/new files. Then run `npm run lint` again to confirm no formatting-induced lint errors.

  **How to verify**: `npm run format` runs cleanly. `npm run lint` still passes.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 — No dependencies, start immediately
- **Foundational (Phase 2)**: T002, T003 — Depends on T001 (migration must exist for schema)
- **US1 (Phase 3)**: T004 — Depends on T002 (uses merge.js), T003 (uses engine getter)
- **US2 (Phase 4)**: T005, T006, T007 — Depends on T001 (migration for version column). Independent of US1.
- **US3 (Phase 5)**: T008 — Depends on T002 (merge module), T007 (ancestor tracking)
- **US4 (Phase 6)**: T009 — Depends on T008 (verify conflict logging)
- **US5 (Phase 7)**: T010, T011 — Depends on T004 (snapshot core)
- **US6 (Phase 8)**: T012–T016 — Depends on T004 (snapshot), T008 (enriched conflicts), T010 (snapshot background)
- **Polish (Phase 9)**: T017–T020 — Depends on all user stories complete

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2 ✅
- **US2 (P1)**: Can start after Phase 1 (T001) ✅ — independent of US1
- **US3 (P1)**: Depends on T002 + T007 (from US2)
- **US4 (P2)**: Depends on US3
- **US5 (P2)**: Depends on US1
- **US6 (P3)**: Depends on US1, US3, US5

### Parallel Opportunities

After Phase 2, US1 (T004) and US2 (T005-T007) can run in parallel — they modify different parts of the codebase:
- US1 creates a new file `snapshot.js`
- US2 modifies existing `engine.js` (different functions)

### Within Each User Story

- T005 → T006 → T007 (US2 must be sequential — each builds on the previous)
- T010 → T011 (US5 must be sequential — timer before lifecycle)
- T012, T013, T014, T015, T016 (US6 — all modify `sync.js` so must be sequential)

---

## Parallel Example

```bash
# After Phase 2 completion, launch US1 and US2 in parallel:
Task: "T004 [US1] Create snapshot checker core at main/sync/snapshot.js"
Task: "T005 [US2] Modify buildDynamoItem in main/sync/engine.js for version tracking"

# After US1 + US2 complete, launch US3:
Task: "T008 [US3] Modify pullRemoteChanges conflict handling for three-way merge"

# After US3, US5 can run (needs snapshot from US1):
Task: "T010 [US5] Add background timer to main/sync/snapshot.js"
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2 + 3)

1. Complete Phase 1: Migration (T001)
2. Complete Phase 2: Foundational (T002, T003)
3. Complete US1 (T004) and US2 (T005-T007) in parallel
4. Complete US3 (T008) — three-way merge in pull
5. **STOP and VALIDATE**: Run smoke tests, verify snapshot detection and merge
6. This gives you the core value: missed change detection + version guards + auto-merge

### Incremental Delivery

1. T001-T003 → Foundation ready
2. T004-T007 → Snapshot detection + version guards (MVP!)
3. T008-T009 → Field-level merge with LWW
4. T010-T011 → Background automation
5. T012-T016 → Enriched IPC responses
6. T017-T020 → Polish and validation

### Total: 20 tasks across 9 phases
