# Tasks: Pull Engine + IPC Channels

**Input**: Design documents from `/specs/004-pull-engine/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/pull-engine.md, contracts/sync-ipc.md

**Tests**: Not explicitly requested — test tasks omitted. Smoke tests (`npm run test:smoke`) will auto-validate IPC parity.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Database migration and schema changes that all user stories depend on

- [ ] T001 Add migration `2026-03-032-pull-engine` in `main/db/migrations.js`

> **T001 Details**: Open `main/db/migrations.js`. Find the `MIGRATIONS` array (it ends near the bottom of the file). Add a new entry at the end of the array with `version: '2026-03-032-pull-engine'`. The `up(db)` function must do 4 things:
>
> **1. Create the `sync_conflicts` table:**
> ```sql
> CREATE TABLE IF NOT EXISTS sync_conflicts (
>     id                INTEGER PRIMARY KEY AUTOINCREMENT,
>     table_name        TEXT     NOT NULL,
>     row_sync_id       TEXT     NOT NULL,
>     entity_type       TEXT     NOT NULL,
>     local_data        TEXT,
>     remote_data       TEXT     NOT NULL,
>     remote_version    INTEGER  NOT NULL,
>     remote_device_hash TEXT    NOT NULL,
>     local_outbox_id   INTEGER,
>     status            TEXT     NOT NULL DEFAULT 'unresolved'
>                       CHECK(status IN ('unresolved','resolved')),
>     resolution        TEXT     CHECK(resolution IN ('local','remote','merged')),
>     resolved_at       DATETIME,
>     created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
> );
> CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status ON sync_conflicts(status, created_at);
> CREATE INDEX IF NOT EXISTS idx_sync_conflicts_row ON sync_conflicts(table_name, row_sync_id);
> ```
> Use `db.exec(...)` to run the SQL above as a single string.
>
> **2. Add pull-engine columns to `sync_config`** (use `ensureColumn` helper which is already imported in migrations.js):
> ```js
> ensureColumn(db, 'sync_config', 'pull_cursor', 'TEXT');
> ensureColumn(db, 'sync_config', 'last_pull_at', 'DATETIME');
> ensureColumn(db, 'sync_config', 'last_pull_error', 'TEXT');
> ```
>
> **3. Add push-engine columns to `sync_config`** (idempotent — safe if Phase 3 already added them):
> ```js
> ensureColumn(db, 'sync_config', 'auth_lambda_url', 'TEXT');
> ensureColumn(db, 'sync_config', 'aws_region', "TEXT DEFAULT 'us-east-1'");
> ensureColumn(db, 'sync_config', 'last_push_at', 'DATETIME');
> ensureColumn(db, 'sync_config', 'last_push_error', 'TEXT');
> ensureColumn(db, 'sync_config', 'push_batch_size', 'INTEGER DEFAULT 100');
> ensureColumn(db, 'sync_config', 'max_retries', 'INTEGER DEFAULT 10');
> ensureColumn(db, 'sync_config', 'school_id', 'TEXT');
> ```
>
> **4. Add conflict detection index on `sync_outbox`:**
> ```sql
> CREATE INDEX IF NOT EXISTS idx_sync_outbox_conflict_check ON sync_outbox(status, table_name, row_sync_id);
> ```
>
> **Pattern to follow**: Look at the existing migration entries in the `MIGRATIONS` array (e.g., `2026-03-030-sync-foundation`) to see the exact object shape: `{ version: '...', up(db) { ... } }`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core pull engine logic that ALL user stories depend on. No IPC or lifecycle work yet — just the data ingestion function.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T002 Add topological sort constant and helper in `main/sync/engine.js`

> **T002 Details**: Open `main/sync/engine.js`. Near the top of the file (after the existing imports and before the first function), add this constant and helper function:
>
> ```js
> // Topological order for FK-safe insert/update (parents before children)
> const TOPO_ORDER_PUT = [
>     'students', 'teachers', 'exams',
>     'settings', 'page_visibility',
>     'grades', 'absences', 'correspondence', 'student_files', 'student_movements',
>     'teacher_aliases', 'teacher_absences', 'staff_attendance', 'compensation_tracking',
>     'exam_proctors', 'exam_rooms',
>     'tests'
> ];
>
> // Reverse order for FK-safe deletions (children before parents)
> const TOPO_ORDER_DEL = [...TOPO_ORDER_PUT].reverse();
>
> function sortByTopology(items) {
>     const puts = items.filter(i => i.operation === 'PUT');
>     const dels = items.filter(i => i.operation === 'DEL');
>
>     puts.sort((a, b) => {
>         const aIdx = TOPO_ORDER_PUT.indexOf(a.tableName);
>         const bIdx = TOPO_ORDER_PUT.indexOf(b.tableName);
>         return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
>     });
>
>     dels.sort((a, b) => {
>         const aIdx = TOPO_ORDER_DEL.indexOf(a.tableName);
>         const bIdx = TOPO_ORDER_DEL.indexOf(b.tableName);
>         return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
>     });
>
>     return [...dels, ...puts];
> }
> ```
>
> **Why DELs first**: Deletions of child records must happen before deletions of parent records. By processing all DELs first (in child-first order), then all PUTs (in parent-first order), we satisfy FK constraints.

- [ ] T003 Add `QueryCommand` import to `main/sync/engine.js`

> **T003 Details**: Open `main/sync/engine.js`. Find the existing AWS SDK imports (look for `require('@aws-sdk/lib-dynamodb')` — it should already import `BatchWriteCommand` and/or `PutCommand`). Add `QueryCommand` to that same `require` destructuring. Example:
>
> ```js
> const { DynamoDBDocumentClient, BatchWriteCommand, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
> ```
>
> If the import is split across multiple lines, just add `QueryCommand` to the existing destructuring.

- [ ] T004 Add `_pullRunning` re-entrancy guard variable in `main/sync/engine.js`

> **T004 Details**: Open `main/sync/engine.js`. Find the existing module-level state variables (look for `let _syncTimer` and `let _flushRunning` near the top). Add these new variables next to them:
>
> ```js
> let _pullTimer = null;
> let _pullRunning = false;
> ```
>
> These are used by the pull engine lifecycle (T008) and the `pullRemoteChanges` function (T005).

- [ ] T005 Implement `pullRemoteChanges()` function in `main/sync/engine.js`

> **T005 Details**: This is the core pull function. Add it to `main/sync/engine.js` after the existing `flushSyncOutbox()` function. It follows the same pattern as `flushSyncOutbox` (re-entrancy guard, config check, credentials, try/finally).
>
> **Imports needed** (add at top of file if not already present):
> ```js
> const { getDeviceHash } = require('./capture');
> ```
> Note: `getDb` from `../db/context`, `getCredentials`/`clearCredentials` from `./credentials`, and `ENTITY_TYPE_REGISTRY` from `./authority` should already be imported by the push engine. If not, add them.
>
> **Function signature and algorithm**:
> ```js
> async function pullRemoteChanges() {
>     if (_pullRunning) return { success: false, skipped: true };
>     _pullRunning = true;
>     try {
>         const db = getDb();
>         const config = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
>         if (!config || !config.enabled) {
>             return { success: true, appliedCount: 0, skippedCount: 0, conflictCount: 0, failedCount: 0, totalFetched: 0, newCursor: null, lastError: null };
>         }
>
>         const credentials = await getCredentials();
>         if (!credentials) {
>             return { success: false, appliedCount: 0, skippedCount: 0, conflictCount: 0, failedCount: 0, totalFetched: 0, newCursor: null, lastError: 'No credentials available' };
>         }
>
>         const schoolId = config.school_id || credentials.schoolId;
>         if (!schoolId) {
>             return { success: false, appliedCount: 0, skippedCount: 0, conflictCount: 0, failedCount: 0, totalFetched: 0, newCursor: null, lastError: 'No school_id configured' };
>         }
>
>         const region = config.aws_region || 'us-east-1';
>         const cursor = config.pull_cursor || '0';
>         const localDeviceHash = getDeviceHash().substring(0, 16);
>         const docClient = getDynamoClient(region, credentials);
>
>         // Step 1: Query DynamoDB SyncGSI for changes since last cursor
>         const allItems = [];
>         let lastEvaluatedKey = undefined;
>         do {
>             const cmd = new QueryCommand({
>                 TableName: 'pencil2-sync',
>                 IndexName: 'SyncGSI',
>                 KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK > :cursor',
>                 ExpressionAttributeValues: {
>                     ':pk': `SCHOOL#${schoolId}`,
>                     ':cursor': cursor
>                 },
>                 ScanIndexForward: true,
>                 Limit: 500,
>                 ExclusiveStartKey: lastEvaluatedKey
>             });
>             const resp = await docClient.send(cmd);
>             if (resp.Items) allItems.push(...resp.Items);
>             lastEvaluatedKey = resp.LastEvaluatedKey;
>         } while (lastEvaluatedKey);
>
>         if (allItems.length === 0) {
>             db.prepare('UPDATE sync_config SET last_pull_at = CURRENT_TIMESTAMP, last_pull_error = NULL WHERE id = 1').run();
>             return { success: true, appliedCount: 0, skippedCount: 0, conflictCount: 0, failedCount: 0, totalFetched: 0, newCursor: cursor, lastError: null };
>         }
>
>         // Step 2: Filter out self-originated records
>         const remoteItems = allItems.filter(item => item.deviceHash !== localDeviceHash);
>         const skippedCount = allItems.length - remoteItems.length;
>
>         // Step 3: Map DynamoDB items to internal format
>         const mapped = [];
>         for (const item of remoteItems) {
>             // Find the table name from entityType using ENTITY_TYPE_REGISTRY
>             const tableName = Object.keys(ENTITY_TYPE_REGISTRY).find(
>                 k => ENTITY_TYPE_REGISTRY[k].entityType === item.entityType
>             );
>             if (!tableName) continue; // unknown entity type, skip
>             mapped.push({
>                 tableName,
>                 operation: item.operation,
>                 rowSyncId: item.rowSyncId,
>                 data: item.data || {},
>                 version: item.version,
>                 deviceHash: item.deviceHash,
>                 entityType: item.entityType,
>                 schoolYear: item.schoolYear,
>                 GSI1SK: item.GSI1SK
>             });
>         }
>
>         // Step 4: Sort by topological order for FK safety
>         const sorted = sortByTopology(mapped);
>
>         // Step 5: Pre-load pending outbox row_sync_ids for conflict detection
>         const pendingRows = db.prepare(
>             "SELECT row_sync_id, id, row_data FROM sync_outbox WHERE status = 'pending'"
>         ).all();
>         const pendingMap = new Map();
>         for (const row of pendingRows) {
>             pendingMap.set(row.row_sync_id, { outboxId: row.id, rowData: row.row_data });
>         }
>
>         // Step 6: Apply changes in a single transaction
>         let appliedCount = 0;
>         let conflictCount = 0;
>         let failedCount = 0;
>
>         const applyChanges = db.transaction(() => {
>             for (const item of sorted) {
>                 try {
>                     // Check for conflicts
>                     const pending = pendingMap.get(item.rowSyncId);
>                     if (pending) {
>                         // Log conflict
>                         db.prepare(`
>                             INSERT INTO sync_conflicts(table_name, row_sync_id, entity_type, local_data, remote_data, remote_version, remote_device_hash, local_outbox_id)
>                             VALUES(?, ?, ?, ?, ?, ?, ?, ?)
>                         `).run(
>                             item.tableName,
>                             item.rowSyncId,
>                             item.entityType,
>                             pending.rowData,
>                             JSON.stringify(item.data),
>                             item.version,
>                             item.deviceHash,
>                             pending.outboxId
>                         );
>                         conflictCount++;
>                         // Fall through to apply remote version (last-writer-wins)
>                     }
>
>                     // Look up sync_id_map for existing local mapping
>                     const mapping = db.prepare(
>                         'SELECT local_id FROM sync_id_map WHERE row_sync_id = ?'
>                     ).get(item.rowSyncId);
>
>                     if (item.operation === 'PUT') {
>                         if (mapping) {
>                             // UPDATE existing local row
>                             const columns = Object.keys(item.data).filter(k => k !== 'id');
>                             if (columns.length > 0) {
>                                 const setClause = columns.map(c => `"${c}" = ?`).join(', ');
>                                 const values = columns.map(c => item.data[c]);
>                                 values.push(mapping.local_id);
>                                 try {
>                                     db.prepare(`UPDATE "${item.tableName}" SET ${setClause} WHERE id = ?`).run(...values);
>                                 } catch (updateErr) {
>                                     // Column might not exist locally — silently skip unknown columns
>                                     // Retry with only known columns by catching and re-trying
>                                     failedCount++;
>                                     continue;
>                                 }
>                             }
>                         } else {
>                             // INSERT new row
>                             const columns = Object.keys(item.data).filter(k => k !== 'id');
>                             if (columns.length > 0) {
>                                 const colNames = columns.map(c => `"${c}"`).join(', ');
>                                 const placeholders = columns.map(() => '?').join(', ');
>                                 const values = columns.map(c => item.data[c]);
>                                 let info;
>                                 try {
>                                     info = db.prepare(`INSERT INTO "${item.tableName}" (${colNames}) VALUES (${placeholders})`).run(...values);
>                                 } catch (insertErr) {
>                                     // FK violation or schema mismatch — skip, retry next cycle
>                                     failedCount++;
>                                     continue;
>                                 }
>                                 // Create sync_id_map entry
>                                 db.prepare(
>                                     'INSERT OR IGNORE INTO sync_id_map(row_sync_id, table_name, local_id) VALUES(?, ?, ?)'
>                                 ).run(item.rowSyncId, item.tableName, info.lastInsertRowid);
>                             }
>                         }
>                         appliedCount++;
>                     } else if (item.operation === 'DEL') {
>                         if (mapping) {
>                             try {
>                                 db.prepare(`DELETE FROM "${item.tableName}" WHERE id = ?`).run(mapping.local_id);
>                             } catch (delErr) {
>                                 // FK constraint prevents deletion — skip
>                                 failedCount++;
>                                 continue;
>                             }
>                             // Keep sync_id_map entry as tombstone (do NOT delete it)
>                             appliedCount++;
>                         } else {
>                             // No local mapping — silently ignore (idempotent)
>                             appliedCount++;
>                         }
>                     }
>                 } catch (err) {
>                     failedCount++;
>                 }
>             }
>         });
>
>         applyChanges();
>
>         // Step 7: Advance cursor to highest GSI1SK seen
>         const newCursor = allItems[allItems.length - 1].GSI1SK || cursor;
>
>         // Step 8: Update sync_config
>         db.prepare(
>             'UPDATE sync_config SET pull_cursor = ?, last_pull_at = CURRENT_TIMESTAMP, last_pull_error = NULL WHERE id = 1'
>         ).run(newCursor);
>
>         // Step 9: Update sync_pull_state per affected table
>         const affectedTables = [...new Set(sorted.map(i => i.tableName))];
>         const upsertPullState = db.prepare(`
>             INSERT INTO sync_pull_state(table_name, last_pulled_at, updated_at)
>             VALUES(?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
>             ON CONFLICT(table_name) DO UPDATE SET last_pulled_at = CURRENT_TIMESTAMP, last_pull_error = NULL, updated_at = CURRENT_TIMESTAMP
>         `);
>         for (const table of affectedTables) {
>             upsertPullState.run(table);
>         }
>
>         return {
>             success: failedCount === 0,
>             appliedCount,
>             skippedCount: skippedCount + (mapped.length - sorted.length),
>             conflictCount,
>             failedCount,
>             totalFetched: allItems.length,
>             newCursor,
>             lastError: null
>         };
>     } catch (err) {
>         try {
>             const db = getDb();
>             db.prepare('UPDATE sync_config SET last_pull_error = ?, last_pull_at = CURRENT_TIMESTAMP WHERE id = 1').run(err.message);
>         } catch (_) { /* ignore */ }
>
>         if (err.name === 'AccessDeniedException' || err.Code === 'AccessDeniedException') {
>             clearCredentials();
>         }
>
>         return {
>             success: false, appliedCount: 0, skippedCount: 0, conflictCount: 0,
>             failedCount: 0, totalFetched: 0, newCursor: null, lastError: err.message
>         };
>     } finally {
>         _pullRunning = false;
>     }
> }
> ```
>
> **CRITICAL**: This function writes directly to the database via `getDb()` — it does NOT call any IPC handlers. This is intentional to avoid re-capturing remote changes into the sync outbox (which would create an infinite sync loop). See research.md R-005.
>
> **CRITICAL**: The function reuses `getDynamoClient()` which already exists in engine.js from Phase 3 — do NOT create a duplicate.

- [ ] T006 Export `pullRemoteChanges` from `main/sync/engine.js`

> **T006 Details**: Find the `module.exports` at the bottom of `main/sync/engine.js`. Add `pullRemoteChanges` to the exports object. The exports should now include both push and pull functions:
>
> ```js
> module.exports = {
>     flushSyncOutbox,
>     startSyncPushBackground,
>     stopSyncPushBackground,
>     restartSyncPushBackground,
>     pullRemoteChanges,
>     startSyncPullBackground,
>     stopSyncPullBackground,
>     restartSyncPullBackground
> };
> ```
>
> Note: `startSyncPullBackground`, `stopSyncPullBackground`, and `restartSyncPullBackground` will be added in T008. Add them to exports here even if they don't exist yet — or do this task after T008.

**Checkpoint**: The core pull data ingestion function exists and can be called programmatically. No background timer or IPC yet.

---

## Phase 3: User Story 1 — Remote Changes Appear Locally (Priority: P1) 🎯 MVP

**Goal**: A record pushed from PC-A appears in PC-B's local database after a pull cycle.

**Independent Test**: Push a record from one device, call `pullRemoteChanges()` on a second device, verify the record exists locally.

> Phase 2 (T002–T006) already implements this story's core requirement. This phase validates it works end-to-end. No additional tasks needed beyond Phase 2 — the `pullRemoteChanges()` function IS User Story 1.

**Checkpoint**: User Story 1 is fully functional after Phase 2 completion. The pull function can be called manually from Node.js to ingest remote changes.

---

## Phase 4: User Story 2 — Pull Engine Runs Automatically (Priority: P1)

**Goal**: Pull engine starts on app launch, runs on a configurable interval, and stops cleanly on exit.

**Independent Test**: Enable sync, launch the app, verify pull fires on schedule and stops on exit.

- [ ] T007 [US2] Implement `isPullTimerRunning()` helper in `main/sync/engine.js`

> **T007 Details**: Add this small helper function in `main/sync/engine.js` near the `_pullTimer` variable:
>
> ```js
> function isPullTimerRunning() {
>     return _pullTimer !== null;
> }
> ```
>
> This is used by the `sync:getStatus` IPC channel to report whether the pull timer is active. Similarly, add a helper for the push timer if one doesn't already exist:
>
> ```js
> function isPushTimerRunning() {
>     return _syncTimer !== null;
> }
> ```
>
> Export both from `module.exports`.

- [ ] T008 [US2] Implement `startSyncPullBackground()`, `stopSyncPullBackground()`, `restartSyncPullBackground()` in `main/sync/engine.js`

> **T008 Details**: Add these three lifecycle functions to `main/sync/engine.js`. They follow the EXACT same pattern as `startSyncPushBackground()`, `stopSyncPushBackground()`, `restartSyncPushBackground()` which already exist in the file. Copy that pattern and adjust:
>
> ```js
> function startSyncPullBackground() {
>     if (_pullTimer) return; // already running
>     try {
>         const db = getDb();
>         const config = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
>         if (!config || !config.enabled || !config.auth_lambda_url) return;
>
>         const intervalMs = Math.max(1, Math.min(30, config.sync_interval_minutes || 10)) * 60 * 1000;
>
>         // Fire first pull immediately
>         void pullRemoteChanges();
>
>         _pullTimer = setInterval(() => {
>             void pullRemoteChanges();
>         }, intervalMs);
>         _pullTimer.unref();
>     } catch (err) {
>         // Silently fail — don't crash app on pull startup failure
>     }
> }
>
> function stopSyncPullBackground() {
>     if (_pullTimer) {
>         clearInterval(_pullTimer);
>         _pullTimer = null;
>     }
> }
>
> function restartSyncPullBackground() {
>     stopSyncPullBackground();
>     startSyncPullBackground();
> }
> ```
>
> Make sure all three are included in `module.exports` (see T006).

- [ ] T009 [US2] Add `startSyncPullBackground()` call in `main.js`

> **T009 Details**: Open `main.js`. Find the existing `startSyncPushBackground()` call (it should be inside the `app.whenReady()` callback, near `startOwnerSyncBackground()`). Add the pull startup call immediately after it:
>
> ```js
> const { startSyncPullBackground, stopSyncPullBackground } = require('./main/sync/engine');
> ```
>
> Add the import at the top of the file (the push engine import may already be there — just add `startSyncPullBackground` and `stopSyncPullBackground` to the existing destructuring).
>
> Then find where `startSyncPushBackground()` is called and add right after it:
> ```js
> startSyncPullBackground();
> ```
>
> Also find the `app.on('before-quit', ...)` or `app.on('will-quit', ...)` handler and add:
> ```js
> stopSyncPullBackground();
> ```
>
> Look at how `stopSyncPushBackground()` is called on quit and follow the same pattern.

**Checkpoint**: The pull engine starts and stops with the app. Combined with Phase 2, bi-directional sync is now automatic.

---

## Phase 5: User Story 3 — Sync Status Visibility via IPC (Priority: P1)

**Goal**: Renderer pages can query sync status and configuration through `window.api.sync`.

**Independent Test**: Call `window.api.sync.getStatus()` and `window.api.sync.getConfig()` from renderer console and verify correct responses.

- [ ] T010 [P] [US3] Create `main/ipc/sync.js` with `sync:getConfig` and `sync:getStatus` handlers

> **T010 Details**: Create a NEW file `main/ipc/sync.js`. Follow the exact pattern of existing IPC modules like `main/ipc/system.js` or `main/ipc/notifications.js`.
>
> ```js
> 'use strict';
>
> const { handleRead, handleWrite } = require('./ipc-helpers');
> const {
>     flushSyncOutbox,
>     pullRemoteChanges,
>     restartSyncPushBackground,
>     restartSyncPullBackground,
>     isPushTimerRunning,
>     isPullTimerRunning
> } = require('../sync/engine');
> const { isAuthenticated } = require('../sync/credentials');
>
> function registerSyncIpc(ipcMain) {
>     // ── Read channels (no auth required) ──
>
>     handleRead(ipcMain, 'sync:getConfig', (db) => {
>         const config = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
>         if (!config) return null;
>         return {
>             enabled: !!config.enabled,
>             syncIntervalMinutes: config.sync_interval_minutes || 10,
>             awsRegion: config.aws_region || 'us-east-1',
>             authLambdaUrl: config.auth_lambda_url || null,
>             schoolId: config.school_id || null,
>             pushBatchSize: config.push_batch_size || 100,
>             maxRetries: config.max_retries || 10,
>             retentionDays: config.retention_days || 7
>         };
>     });
>
>     handleRead(ipcMain, 'sync:getStatus', (db) => {
>         const config = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
>         const pendingCount = db.prepare("SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'pending'").get().count;
>         const failedCount = db.prepare("SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'failed'").get().count;
>         const conflictCount = db.prepare("SELECT COUNT(*) as count FROM sync_conflicts WHERE status = 'unresolved'").get().count;
>
>         return {
>             enabled: config ? !!config.enabled : false,
>             pushRunning: isPushTimerRunning(),
>             pullRunning: isPullTimerRunning(),
>             lastPushAt: config ? config.last_push_at : null,
>             lastPullAt: config ? config.last_pull_at : null,
>             lastPushError: config ? config.last_push_error : null,
>             lastPullError: config ? config.last_pull_error : null,
>             pendingCount,
>             failedCount,
>             conflictCount,
>             pullCursor: config ? config.pull_cursor : null,
>             authenticated: isAuthenticated()
>         };
>     });
> }
>
> module.exports = { registerSyncIpc };
> ```
>
> **IMPORTANT**: This file will be extended in later tasks (T013, T014, T015, T016) to add more handlers inside `registerSyncIpc`. Leave room after the two `handleRead` calls and before the closing `}` of `registerSyncIpc`.

- [ ] T011 [P] [US3] Add `sync` namespace to `preload.js`

> **T011 Details**: Open `preload.js`. Find the `contextBridge.exposeInMainWorld('api', { ... })` call. Add a new `sync` namespace object INSIDE the api object (add it after the last existing namespace, e.g., after `staffAttendance`):
>
> ```js
>     // Sync (DynamoDB pull/push)
>     sync: {
>         getConfig: () => ipcRenderer.invoke('sync:getConfig'),
>         setConfig: (updates) => ipcRenderer.invoke('sync:setConfig', updates),
>         getStatus: () => ipcRenderer.invoke('sync:getStatus'),
>         triggerNow: () => ipcRenderer.invoke('sync:triggerNow'),
>         getConflictLog: (options) => ipcRenderer.invoke('sync:getConflictLog', options),
>         resolveConflict: (payload) => ipcRenderer.invoke('sync:resolveConflict', payload)
>     },
> ```
>
> **Note**: We are adding ALL 6 methods upfront (even though the handlers for some are added in later tasks) because the smoke test checks for parity between preload declarations and registered handlers. ALL handlers (T010, T013, T014, T015, T016) must be registered before running the smoke test.

- [ ] T012 [US3] Register `registerSyncIpc` in `main/ipc/registerAll.js`

> **T012 Details**: Open `main/ipc/registerAll.js`.
>
> **Step 1**: Add the import at the top of the file, next to the other IPC module imports:
> ```js
> const { registerSyncIpc } = require('./sync');
> ```
>
> **Step 2**: Find the `registerAllIpcHandlers` function (or equivalent). Add the call after the last existing registration (e.g., after `registerReportsIpc(ipcMain)`):
> ```js
> registerSyncIpc(ipcMain);
> ```
>
> **Pattern to follow**: Look at how `registerReportsIpc` or `registerNotificationsIpc` is imported and called — follow exactly the same pattern.

**Checkpoint**: `sync:getConfig` and `sync:getStatus` IPC channels work. Renderer can query sync state.

---

## Phase 6: User Story 4 — Sync Configuration via IPC (Priority: P2)

**Goal**: Admin can update sync settings which take effect immediately.

**Independent Test**: Call `window.api.sync.setConfig({ syncIntervalMinutes: 15 })`, verify DB updated and engines restarted.

- [ ] T013 [US4] Add `sync:setConfig` handler in `main/ipc/sync.js`

> **T013 Details**: Open `main/ipc/sync.js`. Inside the `registerSyncIpc` function, after the existing `handleRead` calls, add:
>
> ```js
>     // ── Write channels (admin-only) ──
>
>     handleWrite(ipcMain, 'sync:setConfig', ['admin'], (db, event, updates) => {
>         if (!updates || typeof updates !== 'object') {
>             return { success: false, error: 'Invalid updates' };
>         }
>
>         // Validate interval range
>         if (updates.syncIntervalMinutes !== undefined) {
>             const interval = Number(updates.syncIntervalMinutes);
>             if (isNaN(interval) || interval < 1 || interval > 30) {
>                 return { success: false, error: 'syncIntervalMinutes must be between 1 and 30' };
>             }
>         }
>
>         // Build dynamic UPDATE query
>         const fieldMap = {
>             enabled: 'enabled',
>             syncIntervalMinutes: 'sync_interval_minutes',
>             awsRegion: 'aws_region',
>             authLambdaUrl: 'auth_lambda_url',
>             schoolId: 'school_id',
>             pushBatchSize: 'push_batch_size',
>             maxRetries: 'max_retries',
>             retentionDays: 'retention_days'
>         };
>
>         const setClauses = [];
>         const values = [];
>         for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
>             if (updates[jsKey] !== undefined) {
>                 setClauses.push(`${dbCol} = ?`);
>                 values.push(updates[jsKey]);
>             }
>         }
>
>         if (setClauses.length === 0) {
>             return { success: false, error: 'No valid fields to update' };
>         }
>
>         setClauses.push('updated_at = CURRENT_TIMESTAMP');
>         db.prepare(`UPDATE sync_config SET ${setClauses.join(', ')} WHERE id = 1`).run(...values);
>
>         // Restart both engines to apply new settings
>         restartSyncPushBackground();
>         restartSyncPullBackground();
>
>         return { success: true };
>     });
> ```

**Checkpoint**: Admin can configure sync via IPC. Changes apply immediately.

---

## Phase 7: User Story 5 — Manual Sync Trigger (Priority: P2)

**Goal**: Admin can trigger an immediate push+pull cycle.

**Independent Test**: Call `window.api.sync.triggerNow()`, verify both push and pull execute and return results.

- [ ] T014 [US5] Add `sync:triggerNow` handler in `main/ipc/sync.js`

> **T014 Details**: Open `main/ipc/sync.js`. Inside the `registerSyncIpc` function, after the `sync:setConfig` handler (T013), add:
>
> ```js
>     handleWrite(ipcMain, 'sync:triggerNow', ['admin'], async (db, event) => {
>         const config = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
>         if (!config || !config.enabled) {
>             return { success: false, push: null, pull: null, error: 'Sync is not enabled' };
>         }
>
>         let pushResult = null;
>         let pullResult = null;
>         let error = null;
>
>         try {
>             // Push first (so local changes reach cloud before we pull)
>             pushResult = await flushSyncOutbox();
>         } catch (err) {
>             error = 'Push failed: ' + err.message;
>         }
>
>         try {
>             // Then pull (to receive latest changes)
>             pullResult = await pullRemoteChanges();
>         } catch (err) {
>             error = (error ? error + '; ' : '') + 'Pull failed: ' + err.message;
>         }
>
>         return {
>             success: !error,
>             push: pushResult,
>             pull: pullResult,
>             error
>         };
>     });
> ```

**Checkpoint**: Admin can manually trigger sync and see combined results.

---

## Phase 8: User Story 6 — Conflict Log Access (Priority: P2)

**Goal**: Conflicts are logged during pull and retrievable via IPC.

**Independent Test**: Create a conflict scenario, call `window.api.sync.getConflictLog()`, verify conflict entry returned.

- [ ] T015 [US6] Add `sync:getConflictLog` handler in `main/ipc/sync.js`

> **T015 Details**: Open `main/ipc/sync.js`. Inside `registerSyncIpc`, add after the existing handlers:
>
> ```js
>     handleRead(ipcMain, 'sync:getConflictLog', (db, options) => {
>         const opts = options || {};
>         const status = opts.status || 'all';
>         const limit = Math.min(Number(opts.limit) || 50, 200);
>         const offset = Number(opts.offset) || 0;
>
>         let query = 'SELECT * FROM sync_conflicts';
>         const params = [];
>
>         if (status === 'unresolved' || status === 'resolved') {
>             query += ' WHERE status = ?';
>             params.push(status);
>         }
>
>         query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
>         params.push(limit, offset);
>
>         const rows = db.prepare(query).all(...params);
>
>         return rows.map(row => ({
>             id: row.id,
>             tableName: row.table_name,
>             rowSyncId: row.row_sync_id,
>             entityType: row.entity_type,
>             localData: row.local_data ? JSON.parse(row.local_data) : null,
>             remoteData: JSON.parse(row.remote_data),
>             remoteVersion: row.remote_version,
>             remoteDeviceHash: row.remote_device_hash,
>             status: row.status,
>             resolution: row.resolution,
>             resolvedAt: row.resolved_at,
>             createdAt: row.created_at
>         }));
>     });
> ```

- [ ] T016 [US6] Add `sync:resolveConflict` handler in `main/ipc/sync.js`

> **T016 Details**: Open `main/ipc/sync.js`. Inside `registerSyncIpc`, add after `sync:getConflictLog`:
>
> ```js
>     handleWrite(ipcMain, 'sync:resolveConflict', ['admin'], (db, event, payload) => {
>         if (!payload || !payload.conflictId || !payload.resolution) {
>             return { success: false, error: 'Missing conflictId or resolution' };
>         }
>
>         const conflict = db.prepare('SELECT * FROM sync_conflicts WHERE id = ?').get(payload.conflictId);
>         if (!conflict) {
>             return { success: false, error: 'Conflict not found' };
>         }
>
>         if (conflict.status === 'resolved') {
>             return { success: false, error: 'Conflict already resolved' };
>         }
>
>         if (payload.resolution !== 'local' && payload.resolution !== 'remote') {
>             return { success: false, error: 'Resolution must be "local" or "remote"' };
>         }
>
>         // Mark conflict as resolved
>         db.prepare(
>             'UPDATE sync_conflicts SET status = ?, resolution = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?'
>         ).run('resolved', payload.resolution, payload.conflictId);
>
>         // If resolution is 'local', re-queue the local data as a new outbox entry
>         if (payload.resolution === 'local' && conflict.local_data) {
>             db.prepare(`
>                 INSERT INTO sync_outbox(table_name, row_sync_id, operation, row_data, school_year, status)
>                 VALUES(?, ?, 'PUT', ?, ?, 'pending')
>             `).run(
>                 conflict.table_name,
>                 conflict.row_sync_id,
>                 conflict.local_data,
>                 null // school_year will be extracted from the data during push
>             );
>         }
>
>         return { success: true };
>     });
> ```

**Checkpoint**: Conflicts are viewable and resolvable via IPC.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Final verification and cleanup

- [ ] T017 Run smoke tests to verify IPC parity: `npm run test:smoke`

> **T017 Details**: Run `npm run test:smoke` from the project root. The smoke test automatically validates that:
> 1. Every channel declared in `preload.js` has a matching `ipcMain.handle()` call in `main/ipc/*.js`
> 2. Every handler registered in `main/ipc/*.js` has a matching declaration in `preload.js`
>
> If the test fails, the error will tell you exactly which channels are mismatched. Fix by ensuring:
> - All 6 channels (`sync:getConfig`, `sync:setConfig`, `sync:getStatus`, `sync:triggerNow`, `sync:getConflictLog`, `sync:resolveConflict`) are in BOTH `preload.js` AND `main/ipc/sync.js`
> - `registerSyncIpc(ipcMain)` is called in `main/ipc/registerAll.js`

- [ ] T018 Run linter: `npm run lint`

> **T018 Details**: Run `npm run lint`. Fix any ESLint errors in the new/modified files:
> - `main/sync/engine.js` — Node globals, `no-unused-vars` warn
> - `main/ipc/sync.js` — Node globals, `no-unused-vars` warn
> - `main/ipc/registerAll.js` — Node globals
> - `preload.js` — Node globals
> - `main.js` — Node globals
> - `main/db/migrations.js` — Node globals

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1 — T001)**: No dependencies — can start immediately
- **Foundational (Phase 2 — T002–T006)**: Depends on T001 (migration must exist for DB to have columns)
- **US1 (Phase 3)**: No additional tasks — US1 is delivered by Phase 2
- **US2 (Phase 4 — T007–T009)**: Depends on Phase 2 (needs `pullRemoteChanges` to exist)
- **US3 (Phase 5 — T010–T012)**: Depends on Phase 2 AND Phase 4 (needs lifecycle functions)
- **US4 (Phase 6 — T013)**: Depends on Phase 5 (needs `sync.js` file to exist — extends it)
- **US5 (Phase 7 — T014)**: Depends on Phase 5 (extends `sync.js`)
- **US6 (Phase 8 — T015–T016)**: Depends on Phase 5 (extends `sync.js`)
- **Polish (Phase 9 — T017–T018)**: Depends on ALL phases complete

### Task-Level Dependencies

```
T001 (migration)
  └─► T002 (topo sort) ─┐
  └─► T003 (QueryCommand)├─► T005 (pullRemoteChanges) ─► T006 (exports)
  └─► T004 (guard vars) ─┘                                   │
                                                              ▼
                                              T007 (isPullTimerRunning)
                                              T008 (lifecycle functions)
                                              T009 (main.js startup hook)
                                                              │
                                                              ▼
                              T010 (sync.js — getConfig, getStatus) ─┐
                              T011 (preload.js — sync namespace)     ├─► T013 (setConfig)
                              T012 (registerAll.js — registration)   │   T014 (triggerNow)
                                                                     │   T015 (getConflictLog)
                                                                     │   T016 (resolveConflict)
                                                                     │
                                                                     ▼
                                                              T017 (smoke tests)
                                                              T018 (lint)
```

### Within Each User Story

- T002, T003, T004 can run in parallel (different concerns in the same file, non-overlapping sections)
- T010, T011, T012 can run in parallel (different files)
- T013, T014, T015, T016 are sequential (same file `main/ipc/sync.js`, each adds a handler)

### Parallel Opportunities

- **Phase 2**: T002 + T003 + T004 can run simultaneously (different sections of engine.js)
- **Phase 5**: T010 + T011 + T012 can run simultaneously (sync.js + preload.js + registerAll.js)
- **Phase 6–8**: T013, T014, T015, T016 must be sequential (all modify the same `registerSyncIpc` function body)

---

## Parallel Example: Phase 5

```bash
# These three tasks touch DIFFERENT files and can run simultaneously:
Task T010: "Create main/ipc/sync.js with getConfig and getStatus handlers"
Task T011: "Add sync namespace to preload.js"
Task T012: "Register registerSyncIpc in main/ipc/registerAll.js"
```

---

## Implementation Strategy

### MVP First (User Stories 1+2 Only)

1. Complete Phase 1: T001 (migration)
2. Complete Phase 2: T002–T006 (pull function)
3. Complete Phase 4: T007–T009 (background lifecycle)
4. **STOP and VALIDATE**: The pull engine is now automatic. Test by enabling sync on two PCs and verifying data flows.
5. IPC channels can be added later for the UI.

### Full Delivery

1. T001 → T002–T006 → T007–T009 → T010–T012 → T013–T016 → T017–T018
2. Total: 18 tasks, 6 files modified/created
3. Can be completed in a single session by a capable LLM

### Key Reminders for Implementor

1. **Never route pull writes through IPC handlers** — always use `getDb()` directly in `pullRemoteChanges()`. This prevents infinite re-capture into the outbox.
2. **`handleWrite` automatically wraps with sync capture** — but since `sync_config` and `sync_conflicts` tables are NOT in the `CHANNEL_REGISTRY`, the capture will be a no-op. No special handling needed.
3. **FK ordering matters** — the topological sort in T002 ensures parents are inserted before children.
4. **All 6 preload channels must have matching handlers before running smoke tests** — if you add channels to preload.js (T011) before adding all handlers (T010, T013–T016), the smoke test will fail. Complete all handler tasks before running T017.
5. **`ensureColumn()` is idempotent** — it won't error if a column already exists. Safe to call in migration even if Phase 3 already added some columns.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Total: 18 tasks across 9 phases
