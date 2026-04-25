# Data Model: Integrity & Conflict Resolution (Phase 5)

**Feature Branch**: `005-integrity-conflict-resolution`
**Date**: 2026-03-21

## New Tables

### `sync_snapshots`

Stores per-row checksums for the re-snapshot checker to detect drift between local database state and last-synced state.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `row_sync_id` | TEXT | PRIMARY KEY | Links to `sync_id_map.row_sync_id` |
| `table_name` | TEXT | NOT NULL | Table this row belongs to (e.g., `students`, `grades`) |
| `checksum` | TEXT | NOT NULL | Hash of all non-sensitive column values, computed deterministically |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | When this snapshot entry was last updated |

**Indexes**:
- `idx_sync_snapshots_table (table_name)` — fast per-table lookups during snapshot cycles

**Lifecycle**:
- Created when a row is first pushed or pulled successfully.
- Updated after each successful push/pull of the corresponding row.
- Deleted when the corresponding row is deleted from the local database (detected by snapshot checker as a DEL).

---

## Extended Tables

### `sync_conflicts` — New Columns

The `sync_conflicts` table exists from Phase 4 migration `2026-03-032-pull-engine`. Phase 5 adds columns for enriched conflict data.

| New Column | Type | Constraints | Description |
|------------|------|-------------|-------------|
| `ancestor_data` | TEXT | | JSON snapshot of the common ancestor version (last agreed state) |
| `conflicting_fields` | TEXT | | JSON array of field names that had true overlapping conflicts |
| `resolution_method` | TEXT | CHECK IN ('merged','lww','manual') | How the conflict was resolved |
| `resolved_data` | TEXT | | JSON snapshot of the final merged/chosen data |

**Existing columns** (from Phase 4, unchanged):
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `table_name` TEXT NOT NULL
- `row_sync_id` TEXT NOT NULL
- `entity_type` TEXT NOT NULL
- `local_data` TEXT
- `remote_data` TEXT NOT NULL
- `remote_version` INTEGER NOT NULL
- `remote_device_hash` TEXT NOT NULL
- `local_outbox_id` INTEGER
- `status` TEXT NOT NULL DEFAULT 'unresolved' CHECK IN ('unresolved','resolved')
- `resolution` TEXT CHECK IN ('local','remote','merged')
- `resolved_at` DATETIME
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP

**Note**: The `resolution` column CHECK constraint is extended to include `'merged'` (already present from Phase 4).

---

### `sync_id_map` — New Columns

| New Column | Type | Constraints | Description |
|------------|------|-------------|-------------|
| `version` | INTEGER | DEFAULT 0 | Last pushed/pulled version number for this record |
| `ancestor_data` | TEXT | | JSON snapshot of the last version both local and cloud agreed on |

**Existing columns** (unchanged):
- `row_sync_id` TEXT PRIMARY KEY
- `table_name` TEXT NOT NULL
- `local_id` INTEGER NOT NULL
- UNIQUE(table_name, local_id)

**Lifecycle**:
- `version` is incremented each time the row is successfully pushed.
- `version` is updated on pull to match the remote version.
- `ancestor_data` is updated after each successful push or pull application (stores the agreed-upon state).

---

### `sync_config` — New Columns

| New Column | Type | Constraints | Description |
|------------|------|-------------|-------------|
| `snapshot_interval_minutes` | INTEGER | DEFAULT 30 | Re-snapshot checker interval (valid range: 10–120) |
| `last_snapshot_at` | DATETIME | | Timestamp of last completed snapshot cycle |
| `last_snapshot_error` | TEXT | | Error message from last failed snapshot cycle |

**Existing columns** (unchanged, from Phase 1–4 migrations):
- `id`, `enabled`, `sync_interval_minutes`, `device_hash`, `device_name`, `school_id_hash`, `retention_days`, `last_capture_error`, `updated_at`
- `auth_lambda_url`, `aws_region`, `school_id`, `push_batch_size`, `max_retries`
- `last_push_at`, `last_push_error`, `last_pull_at`, `last_pull_error`, `pull_cursor`

---

## Entity Relationships

```
sync_config (1)
  ├── controls → snapshot_interval_minutes, last_snapshot_at
  └── controls → push/pull engine behavior

sync_id_map (per row)
  ├── row_sync_id ←→ sync_snapshots.row_sync_id      (1:1)
  ├── row_sync_id ←→ sync_outbox.row_sync_id          (1:N)
  ├── row_sync_id ←→ sync_conflicts.row_sync_id       (1:N)
  └── version, ancestor_data → used by merge logic

sync_snapshots (per row)
  ├── checksum → compared against current DB state
  └── table_name → groups rows for per-table pre-check

sync_conflicts (per conflict event)
  ├── ancestor_data → from sync_id_map.ancestor_data at conflict time
  ├── conflicting_fields → computed by three-way merge
  ├── resolution_method → set by auto-resolver or admin
  └── resolved_data → the final merged output
```

---

## State Transitions

### Conflict Entry Lifecycle

```
  ┌──────────────────┐
  │   (conflict       │
  │    detected)      │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │   unresolved      │     ← created with local_data, remote_data,
  │                   │       ancestor_data, conflicting_fields
  └────────┬─────────┘
           │
     ┌─────┴──────┐
     │            │
     ▼            ▼
  ┌────────┐  ┌────────┐
  │ auto-  │  │ manual │     ← admin via sync:resolveConflict
  │resolve │  │resolve │
  └───┬────┘  └───┬────┘
      │           │
      ▼           ▼
  ┌──────────────────┐
  │   resolved        │     ← resolution_method set, resolved_data stored,
  │                   │       resolved_at timestamped
  └────────┬─────────┘
           │
           │ (after 30 days)
           ▼
  ┌──────────────────┐
  │   pruned          │     ← deleted from table during snapshot cycle
  └──────────────────┘
```

### Snapshot Row Lifecycle

```
  Row created/modified in local DB
           │
           ▼
  ┌──────────────────┐
  │ snapshot checker  │     ← compares current row checksum vs stored
  │ detects diff      │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ enqueue to        │     ← PUT or DEL in sync_outbox
  │ sync_outbox       │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ update snapshot   │     ← sync_snapshots.checksum updated
  │ checksum          │
  └──────────────────┘
```

---

## Validation Rules

### sync_snapshots
- `row_sync_id` must exist in `sync_id_map` (logical FK, not enforced at DB level to avoid deadlocks during snapshot)
- `checksum` must be a non-empty string
- `table_name` must be one of the 17 tables in `ENTITY_TYPE_REGISTRY`

### sync_conflicts (new columns)
- `ancestor_data` is nullable (may be null for first-ever push with no prior sync)
- `conflicting_fields` must be valid JSON array or null
- `resolution_method` must be one of: `'merged'`, `'lww'`, `'manual'`, or null (when unresolved)
- `resolved_data` must be valid JSON or null (null when unresolved)

### sync_id_map (new columns)
- `version` must be >= 0
- `ancestor_data` must be valid JSON or null

### sync_config (new columns)
- `snapshot_interval_minutes` must be in range 10–120
- `last_snapshot_at` and `last_snapshot_error` are system-managed, not user-settable directly

---

## Migration Plan

A single new migration `2026-03-033-integrity-conflict-resolution` will:

1. CREATE TABLE `sync_snapshots` with index
2. ALTER TABLE `sync_conflicts` ADD COLUMN `ancestor_data`, `conflicting_fields`, `resolution_method`, `resolved_data`
3. ALTER TABLE `sync_id_map` ADD COLUMN `version`, `ancestor_data`
4. ALTER TABLE `sync_config` ADD COLUMN `snapshot_interval_minutes`, `last_snapshot_at`, `last_snapshot_error`

All additions use `ensureColumn()` for idempotency.
