# Data Model: Push Engine

**Feature**: 003-push-engine
**Date**: 2026-03-21

## Entities

### 1. Outbox Entry (read from `sync_outbox`)

The push engine reads from the existing `sync_outbox` table created in Phase 1. No schema changes to this table.

| Field | Type | Description |
|-------|------|-------------|
| `id` | INTEGER PK | Auto-increment, determines chronological order |
| `table_name` | TEXT | Source SQLite table (e.g., `students`, `grades`) |
| `row_sync_id` | TEXT | Global identity: `{deviceHash}:{table}:{localId}` |
| `operation` | TEXT | `PUT` or `DEL` |
| `row_data` | TEXT (JSON) | Full row data as JSON string; NULL for DEL; may contain `{ _bulk: true }` |
| `school_year` | TEXT | School year partition (e.g., `2025/2026`) |
| `status` | TEXT | `pending` → `sent` or `failed` |
| `retries` | INTEGER | Number of push attempts (0 on creation) |
| `last_attempt_at` | DATETIME | Timestamp of most recent push attempt |
| `sent_at` | DATETIME | Timestamp when successfully pushed |
| `last_error` | TEXT | Error message from most recent failed attempt |
| `created_at` | DATETIME | When the entry was captured |

**State transitions**:
```
pending ──(push success)──→ sent
pending ──(retries ≥ max)──→ failed
pending ──(push failure)──→ pending (retries incremented)
```

**Indexes used by push engine**:
- `(status, id)` — fetch pending entries in chronological order

### 2. Sync ID Map (read from `sync_id_map`)

Used during bulk expansion to look up or create global row identities. No schema changes.

| Field | Type | Description |
|-------|------|-------------|
| `row_sync_id` | TEXT PK | `{deviceHash}:{table}:{localId}` |
| `table_name` | TEXT | Source table name |
| `local_id` | INTEGER | Local SQLite row ID |

### 3. Sync Configuration (read/write `sync_config`)

The push engine reads configuration and writes push status back. **New columns are added via migration.**

**Existing columns** (Phase 1):

| Column | Type | Default | Used by push engine |
|--------|------|---------|---------------------|
| `id` | INTEGER PK | 1 | Singleton row identifier |
| `enabled` | INTEGER | 0 | Whether push engine starts |
| `sync_interval_minutes` | INTEGER | 10 | Push interval |
| `device_hash` | TEXT | NULL | Device identifier for writes |
| `device_name` | TEXT | NULL | Human-readable device name |
| `school_id_hash` | TEXT | NULL | School identifier hash |
| `retention_days` | INTEGER | 7 | Outbox cleanup retention |
| `last_capture_error` | TEXT | NULL | Read only (written by capture layer) |
| `updated_at` | DATETIME | CURRENT_TIMESTAMP | Last config change |

**New columns** (added by Phase 3 migration):

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `auth_lambda_url` | TEXT | NULL | Auth Lambda HTTPS endpoint |
| `aws_region` | TEXT | `'us-east-1'` | AWS region for SDK clients |
| `last_push_at` | DATETIME | NULL | Last successful push timestamp |
| `last_push_error` | TEXT | NULL | Last push error message |
| `push_batch_size` | INTEGER | 100 | Max entries per flush cycle |
| `max_retries` | INTEGER | 10 | Retry threshold before `failed` |
| `school_id` | TEXT | NULL | `customerRef` — DynamoDB partition key |

### 4. Credential Set (in-memory only)

Temporary AWS credentials cached in module-level variables. **Not persisted to database.**

| Field | Type | Description |
|-------|------|-------------|
| `accessKeyId` | string | AWS access key |
| `secretAccessKey` | string | AWS secret key |
| `sessionToken` | string | AWS session token |
| `expiresAt` | number | Unix epoch seconds when credentials expire |
| `identityId` | string | Cognito Identity ID |
| `schoolId` | string | Extracted `customerRef` from license key |

**Lifecycle**: Created on first push attempt → refreshed at 50 minutes → discarded on app exit.

### 5. DynamoDB Sync Item (written to `pencil2-sync`)

The target data structure in DynamoDB. Defined by Phase 2 contract.

| Attribute | Type | Source |
|-----------|------|--------|
| `PK` | String | `SCHOOL#<schoolId>` from credential set |
| `SK` | String | `<ENTITY_TYPE>#<compositeId>` from entity registry |
| `GSI1PK` | String | Same as PK |
| `GSI1SK` | String | `<updatedAt>#<entityType>#<entityId>` |
| `entityType` | String | Lowercase table name (e.g., `student`, `grade`) |
| `schoolYear` | String | From outbox entry `school_year` |
| `updatedAt` | Number | Unix epoch seconds (push time) |
| `version` | Number | Monotonic, starts at 1, increments per write |
| `operation` | String | `PUT` or `DEL` from outbox entry |
| `rowSyncId` | String | From outbox entry `row_sync_id` |
| `deviceHash` | String | First 16 chars of device hash |
| `data` | Map | Parsed `row_data` JSON (sensitive fields stripped) |
| `expiresAt` | Number | TTL: `updatedAt + (retentionDays * 86400)` |

### 6. Writer Authority Matrix (static, in-code)

A constant mapping from table names to allowed roles. Not stored in database.

| Table(s) | Allowed Roles |
|----------|--------------|
| `students`, `correspondence`, `student_files`, `student_movements` | `['admin']` |
| `grades`, `absences` | `['admin', 'staff']` |
| `teachers`, `teacher_aliases`, `staff_attendance`, `compensation_tracking`, `teacher_absences` | `['admin']` |
| `exams`, `exam_proctors`, `exam_rooms`, `tests` | `['admin']` |
| `settings`, `page_visibility` | `['admin']` |

### 7. Entity Type Registry (static, in-code)

Maps SQLite table names to DynamoDB entity types and sort key construction strategies.

| SQLite Table | Entity Type | SK Pattern | Composite Key Fields |
|--------------|-------------|------------|---------------------|
| `students` | `student` | `STUDENT#<code>` | `code` |
| `grades` | `grade` | `GRADE#<student_code>#<subject>#<semester>#<school_year>` | `student_code`, `subject`, `semester`, `school_year` |
| `absences` | `absence` | `ABSENCE#<student_code>#<month>#<school_year>#<absence_type>` | `student_code`, `month`, `school_year`, `absence_type` |
| `teachers` | `teacher` | `TEACHER#<id>` | `id` |
| `teacher_aliases` | `teacher_alias` | `TEACHER_ALIAS#<id>` | `id` |
| `staff_attendance` | `staff_attendance` | `STAFF_ATTENDANCE#<teacher_id>#<date>` | `teacher_id`, `date` |
| `teacher_absences` | `teacher_absence` | `TEACHER_ABSENCE#<teacher_id>#<date>` | `teacher_id`, `date` |
| `exams` | `exam` | `EXAM#<id>` | `id` |
| `exam_proctors` | `exam_proctor` | `EXAM_PROCTOR#<exam_id>#<teacher_id>` | `exam_id`, `teacher_id` |
| `exam_rooms` | `exam_room` | `EXAM_ROOM#<exam_id>#<room_id>` | `exam_id`, `room_id` |
| `tests` | `test` | `TEST#<id>` | `id` |
| `correspondence` | `correspondence` | `CORRESPONDENCE#<id>` | `id` |
| `student_files` | `student_file` | `STUDENT_FILE#<student_code>#<id>` | `student_code`, `id` |
| `student_movements` | `student_movement` | `STUDENT_MOVEMENT#<id>` | `id` |
| `compensation_tracking` | `compensation` | `COMPENSATION#<id>` | `id` |
| `settings` | `settings` | `SETTINGS#<key>` | `key` |
| `page_visibility` | `page_visibility` | `PAGE_VISIBILITY#<key>` | `key` |

## Relationships

```
sync_config (1) ──reads── push engine ──reads── sync_outbox (many)
                                       ──reads── sync_id_map (many)
                                       ──writes→ pencil2-sync DynamoDB (many)

Auth Lambda (1) ──authenticates── credential set (1) ──authorizes── DynamoDB writes

writer_authority_matrix ──filters── outbox entries before push
entity_type_registry ──transforms── outbox entries into DynamoDB items
```

## Migration

**Version**: `2026-03-031-push-engine-config`

Adds new columns to `sync_config` using `ensureColumn()` for idempotency:

```sql
ALTER TABLE sync_config ADD COLUMN auth_lambda_url TEXT;
ALTER TABLE sync_config ADD COLUMN aws_region TEXT DEFAULT 'us-east-1';
ALTER TABLE sync_config ADD COLUMN last_push_at DATETIME;
ALTER TABLE sync_config ADD COLUMN last_push_error TEXT;
ALTER TABLE sync_config ADD COLUMN push_batch_size INTEGER DEFAULT 100;
ALTER TABLE sync_config ADD COLUMN max_retries INTEGER DEFAULT 10;
ALTER TABLE sync_config ADD COLUMN school_id TEXT;
```
