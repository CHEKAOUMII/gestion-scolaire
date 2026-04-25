# Data Model: Sync Foundation

**Feature**: 001-sync-foundation
**Date**: 2026-03-21

## Entities

### sync_outbox

Captures every local data-modifying operation for future push to DynamoDB.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Auto-incrementing outbox entry ID |
| table_name | TEXT | NOT NULL | Database table that was modified (e.g., `students`, `grades`) |
| row_sync_id | TEXT | NOT NULL | Global sync ID: `{deviceHash}:{table_name}:{local_id}` |
| operation | TEXT | NOT NULL, CHECK(IN ('PUT','DEL')) | Type of change: PUT for insert/update, DEL for delete |
| row_data | TEXT | | Full row data as JSON (sensitive fields stripped). NULL allowed for DEL if row no longer exists |
| school_year | TEXT | | School year partition key (e.g., `2025/2026`) extracted from handler args |
| status | TEXT | NOT NULL, DEFAULT 'pending' | Processing status: `pending` or `sent` |
| retries | INTEGER | DEFAULT 0 | Number of push attempts (consumed by Phase 3) |
| last_attempt_at | DATETIME | | Timestamp of last push attempt (consumed by Phase 3) |
| sent_at | DATETIME | | Timestamp when successfully pushed (consumed by Phase 3) |
| last_error | TEXT | | Last error message from push attempt (consumed by Phase 3) |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | When this outbox entry was created |

**Indexes**:
- `idx_sync_outbox_status_id ON sync_outbox(status, id)` — efficient pending row retrieval in ID order
- `idx_sync_outbox_created_at ON sync_outbox(created_at)` — efficient retention cleanup

**Relationships**: None (standalone queue table). `row_sync_id` references `sync_id_map.row_sync_id` logically but no FK enforced (outbox entries may outlive mapped rows in edge cases).

---

### sync_id_map

Translates between globally unique sync IDs and local integer primary keys. Enables cross-device row identification without modifying existing table schemas.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| row_sync_id | TEXT | PRIMARY KEY | Global sync ID: `{deviceHash}:{table_name}:{local_id}` |
| table_name | TEXT | NOT NULL | Database table name |
| local_id | INTEGER | NOT NULL | Local integer primary key in the source table |

**Uniqueness**: `UNIQUE(table_name, local_id)` — prevents duplicate mappings for the same local row.

**Lifecycle**: Entries are created on first capture (INSERT operations). Never deleted — retained even after the source row is deleted (tombstone reference for sync).

---

### sync_config

Singleton configuration table for sync behavior. Modeled on `owner_sync_config` pattern.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY, CHECK(id = 1) | Singleton row enforced by CHECK constraint |
| enabled | INTEGER | DEFAULT 0 | Sync enabled (1) or disabled (0). Phase 1 default: disabled |
| sync_interval_minutes | INTEGER | DEFAULT 10 | Push/pull interval in minutes (consumed by Phase 3) |
| device_hash | TEXT | | Cached device fingerprint hash. Populated on first capture |
| device_name | TEXT | | Human-readable device name (hostname) |
| school_id_hash | TEXT | | School identifier for DynamoDB partition (consumed by Phase 2) |
| retention_days | INTEGER | DEFAULT 7 | Outbox cleanup: delete entries older than N days |
| last_capture_error | TEXT | | Last error from capture layer (diagnostic) |
| updated_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | Last config modification timestamp |

**Seeded**: One row inserted with `INSERT OR IGNORE` at migration time, all defaults.

---

### sync_pull_state

Per-table high-water marks for tracking the last successfully pulled remote change. Created in Phase 1 for schema completeness; actively used starting Phase 4.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| table_name | TEXT | PRIMARY KEY | Database table name being tracked |
| last_pulled_at | TEXT | | ISO 8601 timestamp of last successfully pulled change |
| last_pull_error | TEXT | | Last error from pull attempt |
| updated_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | Last state update timestamp |

---

## Channel-Table Registry (Static Data Structure)

Not a database table — a JavaScript object mapping IPC channel names to their capture metadata.

**Structure per entry**:

```
channelName → {
    tables: string[],          // affected table(s)
    operation: 'PUT' | 'DEL' | 'UPSERT' | 'MIXED',
    idExtractor: string,       // strategy name for extracting row ID(s)
    preCapture?: boolean,      // true if IDs must be collected BEFORE handler runs (for DELETEs)
    bulk?: boolean,            // true if handler processes multiple rows
    exclude?: boolean          // true for read-only channels using handleWrite (e.g., users:getAll)
}
```

**Full registry** (47 channels):

| Channel | Tables | Operation | ID Strategy | Notes |
|---------|--------|-----------|-------------|-------|
| `absences:save` | absences | PUT | lastInsertRowid | |
| `absences:saveBulk` | absences | UPSERT | inputArray | bulk upsert |
| `absences:delete` | absences | DEL | argId | |
| `absences:deleteByYear` | absences | DEL | preQuery | bulk delete by year |
| `correspondence:save` | correspondence | PUT | lastInsertRowid | |
| `correspondence:markPrinted` | correspondence | PUT | argId | update only |
| `exams:save` | exams | PUT | argIdOrLastInsert | insert or update |
| `exams:delete` | exams | DEL | argId | |
| `examProctors:saveManual` | exam_proctors | PUT | lastInsertRowid | |
| `examProctors:generateRoundRobin` | exam_proctors | MIXED | preQuery+bulk | delete all then bulk insert |
| `examProctors:delete` | exam_proctors | DEL | argId | |
| `examRooms:save` | exam_rooms | PUT | argIdOrLastInsert | |
| `examRooms:delete` | exam_rooms | DEL | argId | |
| `tests:save` | tests | PUT | argIdOrLastInsert | |
| `tests:delete` | tests | DEL | argId | |
| `studentFiles:upsert` | student_files | UPSERT | compositeKey | |
| `studentFiles:upsertBulk` | student_files | UPSERT | inputArray | bulk |
| `studentFiles:setDocumentStatus` | student_files | UPSERT | compositeKey | |
| `studentMovements:add` | student_movements, students | MIXED | lastInsertRowid+conditional | multi-table |
| `teachers:add` | teachers, teacher_aliases | PUT | lastInsertRowid | multi-table |
| `teachers:update` | teachers, teacher_aliases | PUT | argId | multi-table |
| `teachers:delete` | teachers, teacher_aliases, grades, tests, staff_attendance, exam_proctors, compensation_tracking, teacher_absences | MIXED | preQuery | cascade delete, 8 tables |
| `teachers:deleteByYear` | (same as teachers:delete) | MIXED | preQuery | bulk cascade |
| `teachers:saveTafwijAliases` | teacher_aliases | PUT | inputArray | bulk |
| `teachers:importBulk` | teachers, teacher_aliases | UPSERT | inputArray | bulk import |
| `teacherAbsences:save` | teacher_absences | PUT | lastInsertRowid | |
| `teacherAbsences:delete` | teacher_absences | DEL | argId | |
| `schoolEvents:save` | school_events | PUT | argIdOrLastInsert | |
| `schoolEvents:delete` | school_events | DEL | argId | |
| `compensation:saveBatch` | compensation_tracking | PUT | inputArray | bulk |
| `compensation:toggleCompensated` | compensation_tracking | PUT | argId | |
| `students:add` | students | PUT | lastInsertRowid | |
| `students:addBulk` | students | UPSERT | inputArray | bulk |
| `students:update` | students | PUT | argId | |
| `students:delete` | students | DEL | argId | |
| `students:deleteByYear` | students, grades, absences, correspondence, student_files, student_movements | DEL | preQuery | cascade, 6 tables |
| `students:updateStatusBulk` | students | PUT | inputArray | bulk |
| `settings:set` | settings | PUT | argKey | key-value store |
| `settings:setSchoolYear` | settings | PUT | literal | fixed key |
| `grades:save` | grades | PUT | compositeKey | INSERT OR REPLACE |
| `grades:saveBulk` | grades | PUT | inputArray | bulk |
| `grades:reassignTeacherBulk` | grades | PUT | queryMatch | bulk update by criteria |
| `grades:deleteByYear` | grades | DEL | preQuery | bulk delete |
| `grades:deleteBySemester` | grades | DEL | preQuery | bulk delete |
| `staffAttendance:save` | staff_attendance | PUT | lastInsertRowid | |
| `staffAttendance:delete` | staff_attendance | DEL | argId | |
| `users:getAll` | — | — | — | EXCLUDED: read-only, uses handleWrite for auth only |
| `pageVisibility:setVisibility` | page_visibility | PUT | argKey | upsert by page_key |

## Sensitive Fields Blocklist

Fields stripped from `row_data` JSON before outbox serialization:

- `password_hash`
- `pin_hash`

Applied globally to all table captures. The `stripSensitiveFields()` utility shallow-clones the row object and deletes matching keys.
