# Data Model: Pull Engine + IPC Channels

**Feature**: 004-pull-engine
**Date**: 2026-03-21

## Entities

### 1. Sync Conflicts (NEW TABLE)

Records collisions between pending local changes and incoming remote changes for the same entity.

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `id` | INTEGER | AUTO | PRIMARY KEY AUTOINCREMENT | Unique conflict identifier |
| `table_name` | TEXT | — | NOT NULL | Target SQLite table name |
| `row_sync_id` | TEXT | — | NOT NULL | Global sync ID of the conflicting row |
| `entity_type` | TEXT | — | NOT NULL | Entity type (e.g., `student`, `grade`) |
| `local_data` | TEXT | — | — | JSON snapshot of the pending local change |
| `remote_data` | TEXT | — | NOT NULL | JSON snapshot of the incoming remote change |
| `remote_version` | INTEGER | — | NOT NULL | Version number from the remote record |
| `remote_device_hash` | TEXT | — | NOT NULL | Device hash (16 chars) that pushed the remote change |
| `local_outbox_id` | INTEGER | — | — | ID of the pending `sync_outbox` entry (nullable — may have been pushed since) |
| `status` | TEXT | `'unresolved'` | NOT NULL, CHECK(status IN ('unresolved','resolved')) | Resolution status |
| `resolution` | TEXT | — | CHECK(resolution IN ('local','remote','merged')) | How conflict was resolved (null if unresolved) |
| `resolved_at` | DATETIME | — | — | Timestamp of resolution |
| `created_at` | DATETIME | CURRENT_TIMESTAMP | — | When conflict was detected |

**DDL**:
```sql
CREATE TABLE IF NOT EXISTS sync_conflicts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name        TEXT     NOT NULL,
    row_sync_id       TEXT     NOT NULL,
    entity_type       TEXT     NOT NULL,
    local_data        TEXT,
    remote_data       TEXT     NOT NULL,
    remote_version    INTEGER  NOT NULL,
    remote_device_hash TEXT    NOT NULL,
    local_outbox_id   INTEGER,
    status            TEXT     NOT NULL DEFAULT 'unresolved'
                      CHECK(status IN ('unresolved','resolved')),
    resolution        TEXT     CHECK(resolution IN ('local','remote','merged')),
    resolved_at       DATETIME,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Indexes**:
```sql
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status
ON sync_conflicts(status, created_at);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_row
ON sync_conflicts(table_name, row_sync_id);
```

---

### 2. Sync Configuration (EXISTING — columns added)

The singleton `sync_config` table (id=1) gains pull-engine and push-engine columns via `ensureColumn()`.

| New Column | Type | Default | Description |
|------------|------|---------|-------------|
| `pull_cursor` | TEXT | — | The GSI1SK high-water mark from last successful pull |
| `last_pull_at` | DATETIME | — | Timestamp of last successful pull cycle |
| `last_pull_error` | TEXT | — | Error message from last failed pull cycle |
| `auth_lambda_url` | TEXT | — | URL of the Auth Lambda endpoint for credential acquisition |
| `aws_region` | TEXT | `'us-east-1'` | AWS region for DynamoDB and Cognito |
| `last_push_at` | DATETIME | — | Timestamp of last successful push cycle |
| `last_push_error` | TEXT | — | Error message from last failed push cycle |
| `push_batch_size` | INTEGER | 100 | Max outbox entries per push cycle |
| `max_retries` | INTEGER | 10 | Max retry attempts before marking an entry as failed |
| `school_id` | TEXT | — | The `customerRef` used as partition key in DynamoDB |

**Note**: Some of these columns may already exist if Phase 3 migration ran first. `ensureColumn()` is idempotent — safe to call regardless.

---

### 3. Sync Outbox (EXISTING — new index only)

No schema changes. One new index for efficient conflict detection during pull:

```sql
CREATE INDEX IF NOT EXISTS idx_sync_outbox_conflict_check
ON sync_outbox(status, table_name, row_sync_id);
```

---

### 4. Sync Pull State (EXISTING — usage clarified)

No schema changes. Created in Phase 1 with columns: `table_name` (PK), `last_pulled_at`, `last_pull_error`, `updated_at`.

Used in Phase 4 to track per-table pull metadata (last successful pull time and errors) for status reporting. The global pull cursor is stored in `sync_config.pull_cursor`, not here.

---

### 5. Sync ID Map (EXISTING — no changes)

No schema changes. Used by the pull engine to translate remote `row_sync_id` values to local integer IDs and to create new mappings for remotely-originated records.

---

## Migration

**Migration ID**: `2026-03-032-pull-engine`

```js
{
    version: '2026-03-032-pull-engine',
    up(db) {
        // 1. Create sync_conflicts table
        db.exec(`
            CREATE TABLE IF NOT EXISTS sync_conflicts (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                table_name        TEXT     NOT NULL,
                row_sync_id       TEXT     NOT NULL,
                entity_type       TEXT     NOT NULL,
                local_data        TEXT,
                remote_data       TEXT     NOT NULL,
                remote_version    INTEGER  NOT NULL,
                remote_device_hash TEXT    NOT NULL,
                local_outbox_id   INTEGER,
                status            TEXT     NOT NULL DEFAULT 'unresolved'
                                  CHECK(status IN ('unresolved','resolved')),
                resolution        TEXT     CHECK(resolution IN ('local','remote','merged')),
                resolved_at       DATETIME,
                created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status
            ON sync_conflicts(status, created_at);

            CREATE INDEX IF NOT EXISTS idx_sync_conflicts_row
            ON sync_conflicts(table_name, row_sync_id);
        `);

        // 2. Add pull-engine columns to sync_config (idempotent)
        ensureColumn(db, 'sync_config', 'pull_cursor', 'TEXT');
        ensureColumn(db, 'sync_config', 'last_pull_at', 'DATETIME');
        ensureColumn(db, 'sync_config', 'last_pull_error', 'TEXT');

        // 3. Add push-engine columns if not yet present (idempotent, covers Phase 3)
        ensureColumn(db, 'sync_config', 'auth_lambda_url', 'TEXT');
        ensureColumn(db, 'sync_config', 'aws_region', "TEXT DEFAULT 'us-east-1'");
        ensureColumn(db, 'sync_config', 'last_push_at', 'DATETIME');
        ensureColumn(db, 'sync_config', 'last_push_error', 'TEXT');
        ensureColumn(db, 'sync_config', 'push_batch_size', 'INTEGER DEFAULT 100');
        ensureColumn(db, 'sync_config', 'max_retries', 'INTEGER DEFAULT 10');
        ensureColumn(db, 'sync_config', 'school_id', 'TEXT');

        // 4. Add conflict detection index on sync_outbox
        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_sync_outbox_conflict_check
            ON sync_outbox(status, table_name, row_sync_id);
        `);
    }
}
```

---

## Entity Relationships

```
sync_config (singleton, id=1)
├── pull_cursor          → used by pull engine as GSI1SK high-water mark
├── last_pull_at/error   → updated after each pull cycle
├── last_push_at/error   → updated after each push cycle
└── auth_lambda_url      → used by credential manager

sync_outbox
├── row_sync_id ──────── → checked by pull engine for conflict detection
└── status='pending'     → indicates unpushed local changes

sync_id_map
├── row_sync_id ──────── → matched against remote records during pull
└── local_id ────────── → maps to target table's integer PK

sync_pull_state
├── table_name           → per-table pull metadata
└── last_pulled_at       → last successful pull per table

sync_conflicts (NEW)
├── row_sync_id ──────── → links to the conflicting entity
├── local_outbox_id ──── → optional reference to sync_outbox.id
└── status               → unresolved → resolved lifecycle
```

## Topological Sort Order

For applying pulled records while respecting foreign key constraints:

**INSERT/UPDATE order** (parents first):
1. `students`, `teachers`, `exams`
2. `settings`, `page_visibility`
3. `grades`, `absences`, `correspondence`, `student_files`, `student_movements`
4. `teacher_aliases`, `teacher_absences`, `staff_attendance`, `compensation_tracking`
5. `exam_proctors`, `exam_rooms`
6. `tests`

**DELETE order** (children first — reverse of above):
1. `tests`, `exam_rooms`, `exam_proctors`
2. `compensation_tracking`, `staff_attendance`, `teacher_absences`, `teacher_aliases`
3. `student_movements`, `student_files`, `correspondence`, `absences`, `grades`
4. `page_visibility`, `settings`
5. `exams`, `teachers`, `students`
