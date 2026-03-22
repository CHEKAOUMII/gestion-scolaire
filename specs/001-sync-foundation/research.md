# Research: Sync Foundation

**Feature**: 001-sync-foundation
**Date**: 2026-03-21

## R-001: Write Channel Inventory

**Decision**: 47 write channels exist across 8 IPC handler files, not ~40 as initially estimated.

**Rationale**: Exhaustive grep of `handleWrite` and `handleWriteSoftAuth` across all `main/ipc/*.js` files. The count includes:

| File | handleWrite | handleWriteSoftAuth | Total |
|------|------------|-------------------|-------|
| absences.js | 3 | 2 | 5 |
| exams.js | 9 | 0 | 9 |
| schoolOps.js | 4 | 0 | 4 |
| staff.js | 4 | 8 | 12 |
| students.js | 5 | 8 | 13 |
| staffAttendance.js | 2 | 0 | 2 |
| system.js | 1 | 0 | 1 |
| pageVisibility.js | 1 | 0 | 1 |

**Notable exception**: `users:getAll` in `system.js` uses `handleWrite` purely as an auth gate but performs only a SELECT. This channel MUST be excluded from sync capture since it makes no data modification.

**Alternatives considered**: None — exhaustive enumeration is the only reliable approach.

---

## R-002: Handler Wrapper Naming

**Decision**: The actual wrapper name is `handleWriteSoftAuth`, not `handleWriteNoAuth` as referenced in CLAUDE.md.

**Rationale**: Reading `main/ipc/ipc-helpers.js` confirms three exported wrappers: `handleRead`, `handleWrite`, `handleWriteSoftAuth`. The CLAUDE.md documentation is outdated.

**Impact on capture**: The `wrapWithSyncCapture()` function must intercept both `handleWrite` and `handleWriteSoftAuth` at the wrapper level. Both follow the same pattern of calling `getDb()` and passing it to the handler.

---

## R-003: Device Hash Stability and Caching

**Decision**: Cache the device hash at module scope on first call. Do NOT call `collectCurrentFingerprint()` per capture event.

**Rationale**: `collectCurrentFingerprint()` makes three `execSync` subprocess calls (reg query, two wmic commands) each with 1500ms timeouts. Calling this per write operation would add up to 4.5 seconds of overhead. The device hash is stable across restarts (derived from hardware: CPU, BIOS serial, baseboard serial, MachineGuid, MACs).

**Implementation**: In `main/sync/capture.js`, call `collectCurrentFingerprint()` once at module load (or lazily on first capture), store `deviceHash` in a module-level variable, and reuse for all subsequent sync ID generation.

**Alternatives considered**:
- Call per capture: rejected — 4.5s worst case per write, violates SC-004 (50ms overhead).
- Store in DB: rejected — unnecessary complexity, module-level variable survives the process lifetime.

---

## R-004: Multi-Table Cascade Write Channels

**Decision**: Map cascade channels to ALL affected tables. Record one outbox entry per table per affected row.

**Rationale**: Several channels touch multiple tables in a single call:
- `students:deleteByYear` — deletes from 6 tables: grades, absences, correspondence, student_files, student_movements, students
- `teachers:delete` — cascades through 7 tables via `detachTeacherReferences`: nullifies teacher_id in grades, tests, staff_attendance, exam_proctors, compensation_tracking; deletes from teacher_absences, teacher_aliases; then deletes teachers
- `studentMovements:add` — inserts into student_movements AND conditionally updates students
- `teachers:add` / `teachers:update` — writes teachers AND teacher_aliases

**Challenge**: For cascade deletes, the capture layer needs the list of affected row IDs BEFORE the delete executes (since rows won't exist after). Two approaches:
1. **Pre-query**: SELECT affected IDs before the handler runs, then record after success
2. **Handler-level capture**: Embed capture logic within the handler itself

**Decision**: Use pre-query approach for DELETE operations on cascade channels. The registry entry for these channels includes a `preCapture` function that runs before the handler to collect affected IDs.

---

## R-005: Outbox Table Design (Modeled on owner_sync_outbox)

**Decision**: Mirror the `owner_sync_outbox` schema with additions for table name, operation, row data, school_year, and sync_id.

**Rationale**: The existing outbox pattern is proven and simple:

```sql
-- Existing owner_sync_outbox pattern
id INTEGER PRIMARY KEY AUTOINCREMENT,
event_type TEXT NOT NULL,
payload TEXT NOT NULL,
status TEXT NOT NULL DEFAULT 'pending',
retries INTEGER DEFAULT 0,
last_attempt_at DATETIME,
sent_at DATETIME,
last_error TEXT,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP

-- Adapted sync_outbox design
id INTEGER PRIMARY KEY AUTOINCREMENT,
table_name TEXT NOT NULL,
row_sync_id TEXT NOT NULL,
operation TEXT NOT NULL CHECK(operation IN ('PUT','DEL')),
row_data TEXT,           -- JSON, NULL for DEL if row was pre-queried
school_year TEXT,
status TEXT NOT NULL DEFAULT 'pending',
retries INTEGER DEFAULT 0,
last_attempt_at DATETIME,
sent_at DATETIME,
last_error TEXT,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Index: `CREATE INDEX idx_sync_outbox_status_id ON sync_outbox(status, id)`

---

## R-006: Row ID Extraction Strategy

**Decision**: Use `db.prepare(...).run()` return value's `lastInsertRowid` for INSERTs. For UPDATEs/DELETEs, extract from handler arguments.

**Rationale**: `better-sqlite3` synchronous `.run()` returns `{ changes: number, lastInsertRowid: number }`. Since all handlers use `getDb()` which returns the same synchronous connection, `lastInsertRowid` is reliable and race-free.

For UPDATEs and DELETEs, the row ID is always present as a handler argument (e.g., `students:update` receives `{ id, ... }`, `students:delete` receives `id`).

For bulk operations, the return value includes `changes` count but not individual IDs — the capture layer must iterate the input array and use INSERT OR IGNORE return values, or query afterward.

---

## R-007: Sensitive Field Stripping

**Decision**: Maintain a static blocklist of field names to strip from row_data JSON before outbox insertion.

**Rationale**: Per clarification, `password_hash` and `pin_hash` must be excluded. The blocklist approach is simple, explicit, and extensible.

**Blocklist**: `['password_hash', 'pin_hash']`

**Implementation**: A `stripSensitiveFields(rowData)` utility that shallow-clones the object and deletes blocklisted keys before `JSON.stringify()`.

---

## R-008: Outbox Retention / Cleanup

**Decision**: Implement a periodic cleanup that runs on app startup and every 6 hours, deleting outbox rows older than 7 days.

**Rationale**: In Phase 1, no push engine consumes the outbox. Without cleanup, a school PC running for months could accumulate millions of rows. The 7-day default (configurable via sync_config) provides safety while retaining enough history for Phase 3 testing.

```sql
DELETE FROM sync_outbox WHERE created_at < datetime('now', '-7 days')
```

The cleanup runs inside `startSyncCapture()` initialization and then via a self-unref'd `setInterval` (matching the ownerSync timer pattern).

---

## R-009: Error Handling Pattern

**Decision**: Follow the ownerSync pattern — persist errors to the database, no console output. The capture layer's try/catch around outbox writes stores the error context but never throws.

**Rationale**: The existing ownerSync module uses zero `console.error` calls. All error state flows through DB columns. This is consistent and avoids polluting the console in production school environments.

**Implementation**: Capture errors in a dedicated `sync_capture_errors` column on `sync_config` (or a simple last_capture_error field), overwritten on each occurrence. Detailed per-row errors are not needed since capture failures are transient (disk full, table locked).

---

## R-010: Smoke Test Extension for Registry Validation

**Decision**: Add a new smoke test section that validates the channel-to-table registry covers all `handleWrite`/`handleWriteSoftAuth` channels.

**Rationale**: The existing smoke test already validates IPC parity (preload.js channels match registered handlers). Extending it to also validate the sync registry ensures new write channels added in the future will fail CI if they lack a registry entry.

**Implementation**: The smoke test will import the channel registry from `main/sync/capture.js` and compare its keys against the set of write channels extracted by the existing IPC parity checker.
