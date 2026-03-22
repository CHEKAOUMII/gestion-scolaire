# Quickstart: Integrity & Conflict Resolution (Phase 5)

**Feature Branch**: `005-integrity-conflict-resolution`
**Date**: 2026-03-21

## Overview

Phase 5 adds three capabilities to the DynamoDB sync system:
1. **Re-snapshot checker** — periodic background process that detects changes that bypassed the sync capture layer (backup restores, migrations, direct SQLite writes)
2. **Version-guarded cloud writes** — conditional DynamoDB puts that reject stale versions, making version conflicts observable instead of silent
3. **Field-level merge** — three-way merge that auto-resolves non-overlapping field changes and applies last-writer-wins for true conflicts

## File Map

```
main/sync/
├── snapshot.js          ← NEW — re-snapshot checker (background timer + cycle logic)
├── merge.js             ← NEW — pure three-way merge logic + checksum helper
├── engine.js            ← MODIFIED — version tracking in push, merge in pull
├── capture.js           ← UNCHANGED (used by snapshot.js for outbox writes)
├── authority.js         ← UNCHANGED (used by snapshot.js for table list)
└── credentials.js       ← UNCHANGED

main/db/
└── migrations.js        ← MODIFIED — add migration 2026-03-033

main/ipc/
└── sync.js              ← MODIFIED — enriched conflict log, snapshot config

main.js                  ← MODIFIED — start/stop snapshot background
```

## Implementation Order

### Step 1: Migration (15 min)

Add migration `2026-03-033-integrity-conflict-resolution` to `main/db/migrations.js`:

```js
{
    version: '2026-03-033-integrity-conflict-resolution',
    up: () => {
        const db = getDb();

        // 1. Snapshot table
        db.exec(`
            CREATE TABLE IF NOT EXISTS sync_snapshots (
                row_sync_id TEXT PRIMARY KEY,
                table_name  TEXT NOT NULL,
                checksum    TEXT NOT NULL,
                updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_snapshots_table ON sync_snapshots(table_name)`);

        // 2. Enrich sync_conflicts
        ensureColumn('sync_conflicts', 'ancestor_data', 'TEXT');
        ensureColumn('sync_conflicts', 'conflicting_fields', 'TEXT');
        ensureColumn('sync_conflicts', 'resolution_method', 'TEXT');
        ensureColumn('sync_conflicts', 'resolved_data', 'TEXT');

        // 3. Version tracking + ancestor in sync_id_map
        ensureColumn('sync_id_map', 'version', 'INTEGER DEFAULT 0');
        ensureColumn('sync_id_map', 'ancestor_data', 'TEXT');

        // 4. Snapshot config
        ensureColumn('sync_config', 'snapshot_interval_minutes', 'INTEGER DEFAULT 30');
        ensureColumn('sync_config', 'last_snapshot_at', 'DATETIME');
        ensureColumn('sync_config', 'last_snapshot_error', 'TEXT');
    }
}
```

### Step 2: Merge Module (30 min)

Create `main/sync/merge.js` — pure logic, no DB access:

- `threeWayMerge(ancestor, local, remote, localTs, remoteTs)` → `{ merged, conflicts, resolution }`
- `computeRowChecksum(rowData, sensitiveFields)` → deterministic string hash

This is fully unit-testable in isolation. Write tests first.

### Step 3: Snapshot Checker (1–2 hrs)

Create `main/sync/snapshot.js`:

- `startSnapshotBackground()` / `stopSnapshotBackground()` / `restartSnapshotBackground()`
- `runSnapshotCycle()` — the core algorithm
- `isSnapshotRunning()` — re-entrancy guard

Key logic in `runSnapshotCycle()`:
1. For each table in `ENTITY_TYPE_REGISTRY`:
   - Fast pre-check: `SELECT COUNT(*) FROM {table}` vs stored count
   - If count differs or no snapshot exists → full row-level diff
   - Compare row checksums, enqueue PUT/DEL for differences
2. Detect deleted rows (snapshot entries with no matching DB row)
3. Prune resolved conflicts older than 30 days
4. Update `sync_config.last_snapshot_at`

Uses existing `recordOutboxEntry` from `capture.js` — same outbox format.

### Step 4: Push Engine — Version Guards (1 hr)

Modify `main/sync/engine.js`:

1. `buildDynamoItem`: read `sync_id_map.version`, set `item.version = version + 1`
2. `flushPreparedItems`: route ALL items through `writeItemWithCondition` (not batch)
3. On `ConditionalCheckFailedException`:
   - Fetch cloud record via `GetCommand`
   - Run `threeWayMerge` with ancestor from `sync_id_map.ancestor_data`
   - Create merged outbox entry or log conflict
4. `markEntrySent`: update `sync_id_map.version` and `ancestor_data`

### Step 5: Pull Engine — Field-Level Merge (1 hr)

Modify `main/sync/engine.js` `pullRemoteChanges()`:

1. When conflict detected (pending outbox match):
   - Load ancestor from `sync_id_map.ancestor_data`
   - Load current local row from DB
   - Run `threeWayMerge`
   - Apply merged result instead of raw remote data
   - Log enriched conflict with all fields
   - If clean merge → remove pending outbox entry (conflict resolved)
2. Update `sync_id_map.ancestor_data` after every successful apply
3. Update `sync_snapshots` checksum after every successful apply

### Step 6: IPC Extensions (30 min)

Modify `main/ipc/sync.js`:

- `sync:getConflictLog`: include new columns in response
- `sync:getStatus`: add `snapshotRunning`, `lastSnapshotAt`, `lastSnapshotError`
- `sync:setConfig`: handle `snapshotIntervalMinutes`, restart snapshot background
- `sync:triggerNow`: also run `runSnapshotCycle()` after push+pull
- `sync:resolveConflict`: update `sync_id_map.ancestor_data` on resolution

### Step 7: Lifecycle Integration (15 min)

Modify `main.js`:
- After `startSyncPushBackground()` and `startSyncPullBackground()`: call `startSnapshotBackground()`
- Before stop calls: call `stopSnapshotBackground()`

### Step 8: Smoke Tests (15 min)

Run `npm run test:smoke` — should pass without changes since no new IPC channels are added. Verify:
- No new channels in preload.js needed
- Existing channel parity maintained
- Lint passes

## Key Gotchas

1. **Version is currently hardcoded to 1** — `buildDynamoItem` line 161 sets `version: 1`. Must change this to read from `sync_id_map`.
2. **Batch writes don't support conditions** — `BatchWriteCommand` cannot use `ConditionExpression`. All versioned writes must use individual `PutCommand`.
3. **Pull currently applies remote data even on conflict** — the current code at engine.js line 798+ applies remote data unconditionally. Phase 5 must change this to apply the merged result.
4. **`school_events` is missing from ENTITY_TYPE_REGISTRY** — the snapshot checker should use `ENTITY_TYPE_REGISTRY` as the source of truth for which tables to check, so `school_events` will be naturally excluded (consistent with push engine behavior).
5. **`_pullRunning` is module-private** — `snapshot.js` needs to check if a pull is in progress. Use the exported `isPullTimerRunning()` or add a new `isPullCycleRunning()` export. Note: `isPullTimerRunning()` checks the timer, not the cycle. Need to export `_pullRunning` state via a new getter.

## Verification Checklist

- [ ] Migration runs cleanly on existing DB
- [ ] `computeRowChecksum` produces deterministic output
- [ ] `threeWayMerge` handles: no ancestor, clean merge, LWW, all-same
- [ ] Snapshot checker detects: inserts, updates, deletes
- [ ] Snapshot checker skips unchanged tables (fast path)
- [ ] Version guards reject stale pushes
- [ ] Push conflict triggers merge + re-queue
- [ ] Pull conflict uses three-way merge
- [ ] Enriched conflict log includes all new fields
- [ ] `sync:triggerNow` runs snapshot after push+pull
- [ ] `sync:setConfig` handles `snapshotIntervalMinutes`
- [ ] `npm run test:smoke` passes
- [ ] `npm run lint` passes
- [ ] App launches and runs with sync disabled (no errors)
