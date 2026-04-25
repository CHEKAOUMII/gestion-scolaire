# Contracts: Integrity & Conflict Resolution (Phase 5)

**Feature Branch**: `005-integrity-conflict-resolution`
**Date**: 2026-03-21

## Module Contracts

### 1. Snapshot Checker — `main/sync/snapshot.js`

New file. Periodic background process that detects drift between local DB state and last-synced state.

#### Exported Functions

```
startSnapshotBackground()
  → void
  Starts the snapshot timer. Reads interval from sync_config.snapshot_interval_minutes.
  Runs an immediate cycle on start, then repeats on interval.
  No-op if sync is disabled or timer already running.
  Timer uses .unref() to avoid blocking Electron shutdown.

stopSnapshotBackground()
  → void
  Clears the snapshot timer. No-op if not running.

restartSnapshotBackground()
  → void
  Calls stop then start.

isSnapshotRunning()
  → boolean
  Returns true if a snapshot cycle is currently in progress.

runSnapshotCycle()
  → Promise<{ success: boolean, tablesChecked: number, changesDetected: number, enqueued: number, pruned: number, lastError: string|null }>
  Manually triggers a single snapshot cycle. Used by sync:triggerNow.
  Returns summary of what happened.
```

#### Snapshot Cycle Algorithm

```
1. Guard: if _snapshotRunning or _pullRunning, return { skipped: true }
2. Set _snapshotRunning = true
3. For each table in ENTITY_TYPE_REGISTRY:
   a. Fast pre-check: compute aggregate checksum (COUNT + simple hash of IDs)
      Compare against last stored aggregate in sync_snapshots metadata
      If unchanged → skip table
   b. Slow path: for each row in table
      - Compute row checksum from non-sensitive column values
      - Look up stored checksum in sync_snapshots by row_sync_id
      - If no stored checksum → new row → enqueue PUT
      - If checksum differs → modified row → enqueue PUT
   c. Detect deletions: for each sync_snapshots entry for this table
      - If no matching row exists in table → enqueue DEL
      - Remove orphaned sync_snapshots entry
   d. Update sync_snapshots with current checksums
4. Prune resolved conflicts older than 30 days
5. Update sync_config.last_snapshot_at
6. Set _snapshotRunning = false
7. Return summary
```

#### Internal Dependencies

- `main/sync/capture.js` — `ensureSyncIdMapping`, `stripSensitiveFields`, `recordOutboxEntry`, `SENSITIVE_FIELDS`
- `main/sync/authority.js` — `ENTITY_TYPE_REGISTRY`
- `main/sync/engine.js` — reads `_pullRunning` (exported as `isPullTimerRunning` — but need cycle-level check, not timer-level)
- `main/db/context.js` — `getDb()`

---

### 2. Field-Level Merge — `main/sync/merge.js`

New file. Pure logic module for three-way field-level merge.

#### Exported Functions

```
threeWayMerge(ancestor, local, remote, localTimestamp, remoteTimestamp)
  → { merged: object, conflicts: string[], resolution: 'merged'|'lww'|'clean' }

  Parameters:
    ancestor        — object | null — last agreed-upon version (from sync_id_map.ancestor_data)
    local           — object — local version of the record
    remote          — object — remote version of the record
    localTimestamp   — number — epoch seconds of local change
    remoteTimestamp  — number — epoch seconds of remote change

  Returns:
    merged     — the final merged record
    conflicts  — array of field names that had true overlapping conflicts (LWW applied)
    resolution — 'clean' if no conflicts, 'merged' if non-overlapping auto-merge,
                 'lww' if any overlapping fields required last-writer-wins

  Algorithm:
    allFields = UNION of keys in ancestor, local, remote
    For each field:
      a_val = ancestor?[field]  (undefined if no ancestor)
      l_val = local[field]
      r_val = remote[field]

      if l_val === r_val → merged[field] = l_val
      elif ancestor exists:
        if l_val === a_val → merged[field] = r_val  (remote-only change)
        elif r_val === a_val → merged[field] = l_val  (local-only change)
        else → LWW: merged[field] = remoteTimestamp >= localTimestamp ? r_val : l_val
               conflicts.push(field)
      else:
        → LWW (no ancestor available): same as above
        conflicts.push(field)
```

```
computeRowChecksum(rowData, sensitiveFields)
  → string

  Parameters:
    rowData         — object — the row data (all columns)
    sensitiveFields — string[] — fields to exclude from checksum

  Returns:
    A deterministic string hash of the row data.
    Fields are sorted alphabetically, values stringified, then concatenated.
    Uses a simple 32-bit FNV-1a hash for speed (not cryptographic).
```

#### Design Decisions

- **Pure function**: No database access, no side effects. Testable in isolation.
- **Null ancestor handling**: When `ancestor` is null (first-ever conflict, no prior sync), falls back to two-way LWW for all differing fields.
- **Field comparison**: Uses strict equality (`===`) after JSON stringification for non-primitive values.

---

### 3. Engine Extensions — `main/sync/engine.js`

Modifications to the existing push and pull engine.

#### Push Engine Changes

```
buildDynamoItem(entry, schoolId, deviceHash)
  MODIFIED: version field now reads from sync_id_map.version + 1
  instead of hardcoded 1.

flushPreparedItems(db, docClient, preparedItems, maxRetries)
  MODIFIED: ALL items now route through writeItemWithCondition
  (individual conditional puts). Batch writes are only used for
  first-ever pushes (version === 1) where no cloud record exists.

  On ConditionalCheckFailedException:
    1. Fetch current cloud record via GetItem
    2. Run threeWayMerge(ancestor, localData, cloudData, localTs, cloudTs)
    3. If merge successful → create new outbox entry with merged data, version = cloud.version + 1
    4. Log enriched conflict entry
    5. Mark original outbox entry as 'conflict' (not 'failed')

markEntrySent(db, entryId)
  MODIFIED: Also updates sync_id_map.version and sync_id_map.ancestor_data
  after successful push. Updates sync_snapshots checksum.
```

#### Pull Engine Changes

```
pullRemoteChanges()
  MODIFIED: Conflict handling section (Step 6) now uses threeWayMerge:
    1. Load ancestor from sync_id_map.ancestor_data
    2. Load local data from the actual DB row
    3. Run threeWayMerge(ancestor, local, remote, localTs, remoteTs)
    4. Apply merged result (not raw remote data)
    5. Log enriched conflict with ancestor_data, conflicting_fields,
       resolution_method, resolved_data
    6. If merge produced zero conflicts → auto-resolve, remove outbox entry
    7. If merge produced overlapping conflicts → auto-resolve with LWW,
       log for admin review
    8. Update sync_id_map.ancestor_data to merged result
    9. Update sync_snapshots checksum for the affected row
```

---

### 4. IPC Channel Extensions — `main/ipc/sync.js`

#### Modified Channels

```
sync:getConflictLog
  MODIFIED: Response now includes enriched fields:
    - ancestor_data (parsed JSON)
    - conflicting_fields (parsed JSON array)
    - resolution_method
    - resolved_data (parsed JSON)

sync:setConfig
  MODIFIED: Field map extended:
    snapshotIntervalMinutes → snapshot_interval_minutes
  Also restarts snapshot background on config change.

sync:triggerNow
  MODIFIED: Also runs a snapshot cycle after push+pull.
  Returns { push, pull, snapshot, error }.

sync:resolveConflict
  MODIFIED: Accepts resolution 'merged' in addition to 'local'/'remote'.
  For 'local' and 'remote': applies chosen version and updates
  sync_id_map.ancestor_data.

sync:getStatus
  MODIFIED: Response includes additional fields:
    - snapshotRunning (boolean)
    - lastSnapshotAt (ISO string)
    - lastSnapshotError (string|null)
```

#### No New Channels Required

All Phase 5 functionality is exposed through existing channels. No new IPC channels need to be added to `preload.js`, which means no smoke test changes for IPC parity.

---

## Integration Points

### Lifecycle Management — `main.js`

```
App startup (after push+pull start):
  → startSnapshotBackground()

App shutdown (before push+pull stop):
  → stopSnapshotBackground()

Config change (sync:setConfig):
  → restartSnapshotBackground() (alongside push/pull restart)
```

### Migration — `main/db/migrations.js`

Single migration `2026-03-033-integrity-conflict-resolution`:
- CREATE TABLE sync_snapshots
- ensureColumn sync_conflicts.ancestor_data
- ensureColumn sync_conflicts.conflicting_fields
- ensureColumn sync_conflicts.resolution_method
- ensureColumn sync_conflicts.resolved_data
- ensureColumn sync_id_map.version
- ensureColumn sync_id_map.ancestor_data
- ensureColumn sync_config.snapshot_interval_minutes
- ensureColumn sync_config.last_snapshot_at
- ensureColumn sync_config.last_snapshot_error

### No Preload Changes

Phase 5 does not add new IPC channels. The existing `sync` namespace in `preload.js` already exposes all 6 channels needed. Modified response shapes are backward-compatible (additive fields only).
