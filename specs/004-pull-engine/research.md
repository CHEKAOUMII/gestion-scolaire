# Research: Pull Engine + IPC Channels

**Feature**: 004-pull-engine
**Date**: 2026-03-21
**Status**: Complete

## R-001: DynamoDB GSI Query Pattern for Pull

**Decision**: Use `QueryCommand` on `SyncGSI` with `GSI1PK = :pk AND GSI1SK > :cursor`, paginating via `LastEvaluatedKey` until all pages are consumed within a single pull cycle.

**Rationale**: The `SyncGSI` index (deployed in Phase 2) is purpose-built for chronological pull queries. `ScanIndexForward: true` ensures oldest-first ordering, which is critical for cursor-based synchronization — the client advances its cursor to the highest `GSI1SK` seen. DynamoDB returns at most 1 MB per query, so pagination is mandatory for large batches.

**Alternatives considered**:
- **DynamoDB Streams**: Would provide real-time change notifications but requires a persistent connection and Lambda infrastructure — overkill for a polling-based Electron app. Rejected for complexity and cost.
- **Full table scan**: Would work for initial sync but is inefficient for incremental pulls. Rejected for cost (reads all items every cycle).

**Key implementation notes**:
- `Limit: 500` per page, loop on `LastEvaluatedKey` until no more pages or total items reaches a configurable cap.
- The cursor stored in `sync_pull_state` is the `GSI1SK` value (format: `<updatedAt>#<entityType>#<entityId>`), not a timestamp alone.
- The `ExclusiveStartKey` for pagination is the DynamoDB-internal pagination token, not the same as the application cursor.

---

## R-002: SQLite Transaction Pattern for Batch Apply

**Decision**: Use `better-sqlite3`'s `db.transaction()` to wrap all INSERTs, UPDATEs, and DELETEs from a single pull cycle in one atomic transaction.

**Rationale**: `better-sqlite3` transactions are synchronous and run in a single SQLite connection. A transaction ensures that partial pull application never occurs — either all 500 remote changes are applied, or none are. This is the same pattern used by `recordOutboxEntries()` in `main/sync/capture.js` (lines 252-258).

**Alternatives considered**:
- **Per-row commits**: Simpler code but risks partial application if the process crashes mid-pull. Rejected for data integrity.
- **WAL journal + savepoints**: More granular rollback but unnecessary complexity for a synchronous single-connection engine.

**Key implementation notes**:
- Prepare statements once outside the transaction loop, reuse via `.bind()` for performance.
- The transaction function receives no async calls — `better-sqlite3` transactions must be fully synchronous.
- For 500 operations, SQLite performance in a single transaction is excellent (milliseconds).

---

## R-003: Sync ID Reverse Lookup for Remote Records

**Decision**: On pull, look up `sync_id_map` by `row_sync_id` to find the `local_id`. If no mapping exists, INSERT a new row into the target table and create the mapping using `lastInsertRowid`.

**Rationale**: The `sync_id_map` table (PK: `row_sync_id`, UNIQUE: `(table_name, local_id)`) provides bidirectional mapping between global sync IDs and device-local integer IDs. For remote records, the embedded `localId` in the sync ID refers to the *originating* device's integer — the receiving device will assign its own AUTOINCREMENT ID and map it.

**Alternatives considered**:
- **Use sync ID as the primary key everywhere**: Would require schema changes across all 17 tables. Rejected — too invasive, breaks existing queries.
- **Embed a UUID in every row**: Adds a column to every table. Rejected for the same reason — Phase 1 designed the mapping table specifically to avoid schema changes.

**Key implementation notes**:
- `ensureSyncIdMapping()` from `main/sync/capture.js` handles local-originated mappings. The pull engine needs a symmetric function for remote-originated mappings.
- For DEL operations, look up `local_id` from `sync_id_map`, delete the row, but KEEP the `sync_id_map` entry as a tombstone reference (consistent with Phase 1 design: "Sync ID Map entries are never deleted — tombstone references are retained").

---

## R-004: Re-entrancy Guard Pattern

**Decision**: Use a module-level `_pullRunning` boolean flag with `try/finally` to prevent overlapping pull cycles, matching the push engine's `_flushRunning` pattern.

**Rationale**: Both timer-fired and manual-trigger (via `sync:triggerNow`) can invoke the pull cycle. Without a guard, simultaneous cycles could apply duplicate changes or corrupt the cursor. The push engine uses the identical pattern.

**Alternatives considered**:
- **Mutex/semaphore**: Overkill for single-threaded Node.js. A boolean flag is sufficient.
- **Debounce timer**: Would delay manual triggers. Rejected — the guard should skip (not delay) overlapping calls.

**Key implementation notes**:
- The guard returns immediately if already running (fire-and-forget, not queued).
- `try/finally` ensures the flag is always reset, even on unhandled errors.
- Separate guards for push (`_flushRunning`) and pull (`_pullRunning`) — they can run concurrently since they operate on different data flows.

---

## R-005: Capture Avoidance for Remotely-Applied Writes

**Decision**: Pull-applied writes go directly to the database via `getDb()`, bypassing the `handleWrite`/`wrapWithSyncCapture` IPC layer entirely.

**Rationale**: The sync capture layer in `main/sync/capture.js` intercepts all `handleWrite` calls and records them to `sync_outbox`. If pull-applied changes were written through IPC handlers, they would be re-captured into the outbox and pushed back to the cloud — creating an infinite sync loop. Pull writes MUST bypass the capture layer.

**Alternatives considered**:
- **Add an `_isFromSync` flag to capture layer**: Would require threading a flag through the IPC helper chain. Rejected — too fragile, easy to forget.
- **Filter outbox by `deviceHash` during push**: Would work but wastes outbox space and processing. Rejected — prevention is better than filtering.

**Key implementation notes**:
- The pull engine directly calls `db.prepare(...).run(...)` without going through IPC channels.
- The pull engine imports `getDb()` from `main/db/context.js`, same as the push engine does.

---

## R-006: Foreign Key Dependency Ordering During Pull

**Decision**: Sort pulled items by entity type in topological order (parents before children for PUTs, children before parents for DELs) before applying them within the transaction.

**Rationale**: The database enforces `PRAGMA foreign_keys = ON` at boot. FK constraints exist on: `grades→students`, `absences→students`, `correspondence→students`, `student_files→students`, `student_movements→students`, `teacher_aliases→teachers`, `teacher_absences→teachers`, `exam_proctors→exams+teachers`. Inserting a grade before its student would fail.

**Alternatives considered**:
- **Temporarily disable FK checks**: `PRAGMA foreign_keys = OFF` before the transaction. While safe in `better-sqlite3` (single synchronous connection), it disables an important safety net and could mask bugs. Rejected.
- **Retry failed inserts on next cycle**: Simpler but delays child-record sync by one interval (5–15 minutes). Rejected as primary strategy — used only as a fallback for cross-batch dependencies.

**Key implementation notes**:
- Topological sort order for PUTs: `students` → `teachers` → `exams` → `settings` → `page_visibility` → `grades` → `absences` → `correspondence` → `student_files` → `student_movements` → `teacher_aliases` → `teacher_absences` → `staff_attendance` → `compensation_tracking` → `exam_proctors` → `exam_rooms` → `tests`
- For DELs: reverse the order above.
- If a parent record from a different pull page hasn't arrived yet (cross-batch dependency), skip the child and it will be retried on the next pull cycle when the parent exists.

---

## R-007: Conflict Detection Strategy

**Decision**: Pre-load all pending `row_sync_id` values from `sync_outbox` into an in-memory `Set` before the pull transaction, then check each incoming remote change against this set in O(1) time.

**Rationale**: The pending outbox set is typically small (tens to low hundreds of entries between push cycles). Loading it entirely into memory avoids N per-row database queries during the pull loop. A new composite index `(status, table_name, row_sync_id)` on `sync_outbox` further accelerates lookups if the Set approach proves insufficient.

**Alternatives considered**:
- **Per-row SQL query**: `SELECT 1 FROM sync_outbox WHERE status='pending' AND row_sync_id=?` for each of 500 items. Rejected — 500 queries per cycle is wasteful.
- **Skip conflict detection entirely**: Just overwrite. Rejected — would silently discard local changes that haven't been pushed yet.

**Key implementation notes**:
- When a conflict is detected (remote change for a locally-modified record), log it to `sync_conflicts` with both local and remote data snapshots.
- The remote version is applied (last-writer-wins), and the local outbox entry remains pending — it will be pushed on the next cycle, potentially overwriting the remote version back. Phase 5 will implement smarter field-level merge.
- Migration adds index: `CREATE INDEX idx_sync_outbox_conflict_check ON sync_outbox(status, table_name, row_sync_id)`.

---

## R-008: IPC Module and Preload Pattern

**Decision**: Create `main/ipc/sync.js` following the exact pattern of existing IPC modules. Register it in `registerAll.js`. Add a `sync` namespace to `preload.js` with 6 methods.

**Rationale**: The project's three-file IPC pattern (`main/ipc/*.js` + `registerAll.js` + `preload.js`) is enforced by the smoke test. Any deviation will fail CI.

**Alternatives considered**: None — the pattern is fixed by project architecture.

**Key implementation notes**:
- Read channels (`sync:getConfig`, `sync:getStatus`, `sync:getConflictLog`): Use `handleRead` — no auth required, db auto-injected.
- Write channels (`sync:setConfig`, `sync:triggerNow`, `sync:resolveConflict`): Use `handleWrite` with `['admin']` role restriction.
- `sync:setConfig` and `sync:resolveConflict` do NOT need sync capture wrapping because: (a) `sync_config` is device-local (not synced), and (b) `sync_conflicts` is device-local (not synced). The `handleWrite` wrapper applies `wrapWithSyncCapture` automatically, but since these tables are not in the `CHANNEL_REGISTRY`, capture will be a no-op.
- Preload exposes `window.api.sync.getConfig()`, `.setConfig(data)`, `.getStatus()`, `.triggerNow()`, `.getConflictLog()`, `.resolveConflict(payload)`.

---

## R-009: Schema Migration for Phase 4

**Decision**: Add migration `2026-03-032-pull-engine` that creates the `sync_conflicts` table, adds pull-related columns to `sync_config`, and adds the conflict detection index on `sync_outbox`.

**Rationale**: Phase 1 created the base sync tables and Phase 3's push engine columns were either added via `ensureColumn()` in a migration or are still pending. Phase 4 needs its own migration for the `sync_conflicts` table and any missing config columns.

**Key implementation notes**:
- New table: `sync_conflicts` with `id`, `table_name`, `row_sync_id`, `entity_type`, `local_data` (JSON), `remote_data` (JSON), `remote_version`, `remote_device_hash`, `status` (unresolved/resolved), `resolution` (local/remote/merged/null), `resolved_at`, `created_at`.
- New columns on `sync_config` (via `ensureColumn()`): `last_pull_at`, `last_pull_error`, `pull_cursor` (TEXT — stores the GSI1SK high-water mark), `auth_lambda_url`, `aws_region`, `last_push_at`, `last_push_error`, `push_batch_size`, `max_retries`, `school_id`.
- New index: `idx_sync_outbox_conflict_check` on `sync_outbox(status, table_name, row_sync_id)`.
- Uses `ensureColumn()` helper for idempotent column additions — safe to run even if Phase 3 migration already added some columns.

---

## R-010: Pull Cursor Design

**Decision**: Store a single global pull cursor in `sync_config.pull_cursor` (the highest `GSI1SK` value seen), rather than per-table cursors in `sync_pull_state`.

**Rationale**: The DynamoDB GSI sorts all entity types together by `updatedAt`. A single cursor captures the chronological position across all entity types. Per-table cursors would require 17 separate GSI queries per pull cycle (one per entity type), which is wasteful and costly.

**Alternatives considered**:
- **Per-table cursors via `sync_pull_state`**: Phase 1 created this table expecting per-table tracking. However, the GSI design (all entities in one index) makes a single cursor more natural. The `sync_pull_state` table can still be used for per-table metadata (last pull error, last successful pull time) even though the cursor itself is global.
- **Timestamp-only cursor**: Using just the `updatedAt` Unix epoch. Rejected — the full `GSI1SK` value (`<updatedAt>#<entityType>#<entityId>`) provides sub-second ordering and deduplication.

**Key implementation notes**:
- Initial cursor value: `'0'` (ensures the first pull fetches everything).
- Cursor is updated only after successful transaction commit — never advanced on partial failure.
- The `sync_pull_state` table is still used to track per-table `last_pulled_at` and `last_pull_error` for status reporting purposes.
