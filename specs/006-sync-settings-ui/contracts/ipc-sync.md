# IPC Contract: Sync Settings UI

**Feature**: 006-sync-settings-ui
**Date**: 2026-03-21

This feature consumes 6 **existing** IPC channels. No new channels are created.

All channels are accessed via `window.api.sync.*` (defined in `preload.js` lines 287–294).

---

## sync:getConfig

**Direction**: Renderer → Main
**Auth**: None (handleRead)
**Trigger**: Page load, after config save

**Request**: No payload

**Response**:
```js
// Success (config exists):
{
    enabled: boolean,
    syncIntervalMinutes: number,       // 1–30, default 10
    awsRegion: string,                 // default 'us-east-1'
    authLambdaUrl: string | null,
    schoolId: string | null,
    pushBatchSize: number,             // default 100
    maxRetries: number,                // default 10
    retentionDays: number              // default 7
}

// No config row exists:
null
```

**Note**: `snapshotIntervalMinutes` is NOT returned here. Read it from `sync:getStatus`.

---

## sync:getStatus

**Direction**: Renderer → Main
**Auth**: None (handleRead)
**Trigger**: Page load, polled every 10 seconds

**Request**: No payload

**Response**:
```js
{
    enabled: boolean,
    pushRunning: boolean,
    pullRunning: boolean,
    lastPushAt: string | null,         // ISO timestamp
    lastPullAt: string | null,         // ISO timestamp
    lastPushError: string | null,
    lastPullError: string | null,
    pendingCount: number,
    failedCount: number,
    conflictCount: number,             // unresolved only
    pullCursor: string | null,
    authenticated: boolean,
    snapshotRunning: boolean,
    lastSnapshotAt: string | null,     // ISO timestamp
    lastSnapshotError: string | null,
    snapshotIntervalMinutes: number    // default 30
}
```

---

## sync:setConfig

**Direction**: Renderer → Main
**Auth**: Admin only (handleWrite)
**Trigger**: Config form submit

**Request** (any subset of these keys):
```js
{
    enabled: boolean | number,
    syncIntervalMinutes: number,       // validated: 1–30
    awsRegion: string,
    authLambdaUrl: string,
    schoolId: string,
    pushBatchSize: number,
    maxRetries: number,
    retentionDays: number,
    snapshotIntervalMinutes: number
}
```

**Response**:
```js
// Success:
{ success: true }

// Failure:
{ success: false, error: string }
// Possible errors:
//   'Invalid updates'
//   'syncIntervalMinutes must be between 1 and 30'
//   'No valid fields to update'
```

**Side effect**: After save, backend calls `restartSyncPushBackground()`, `restartSyncPullBackground()`, `restartSnapshotBackground()`.

---

## sync:triggerNow

**Direction**: Renderer → Main
**Auth**: Admin only (handleWrite)
**Trigger**: "Sync Now" button click

**Request**: No payload

**Response**:
```js
{
    success: boolean,
    push: {
        success: boolean,
        sentCount: number,
        failedCount: number,
        skippedCount: number,
        pendingCount: number,
        lastError: string | null
    } | { success: true, skipped: true, reason: string } | null,
    pull: {
        success: boolean,
        appliedCount: number,
        skippedCount: number,
        conflictCount: number,
        failedCount: number,
        totalFetched: number,
        newCursor: string | null,
        lastError: string | null
    } | { success: false, skipped: true } | null,
    snapshot: {
        success: boolean,
        tablesChecked: number,
        changesDetected: number,
        enqueued: number,
        pruned: number,
        lastError: string | null
    } | { success: true, skipped: true, reason: string } | null,
    error: string | null
}
```

---

## sync:getConflictLog

**Direction**: Renderer → Main
**Auth**: None (handleRead)
**Trigger**: Conflict section load, filter change, pagination

**Request**:
```js
{
    status: 'all' | 'unresolved' | 'resolved',  // default 'all'
    limit: number,                                // default 50, max 200
    offset: number                                // default 0
}
```

**Response**: Array of conflict objects:
```js
[{
    id: number,
    tableName: string,
    rowSyncId: string,
    entityType: string,
    localData: object | null,
    remoteData: object | null,
    remoteVersion: number,
    remoteDeviceHash: string,
    status: 'unresolved' | 'resolved',
    resolution: 'local' | 'remote' | 'merged' | null,
    resolvedAt: string | null,
    createdAt: string,
    ancestorData: object | null,
    conflictingFields: string[],
    resolutionMethod: 'lww' | 'merged' | 'manual' | null,
    resolvedData: object | null
}]
```

---

## sync:resolveConflict

**Direction**: Renderer → Main
**Auth**: Admin only (handleWrite)
**Trigger**: "Accept Local" or "Accept Remote" button click

**Request**:
```js
{
    conflictId: number,
    resolution: 'local' | 'remote'
}
```

**Response**:
```js
// Success:
{ success: true }

// Failure:
{ success: false, error: string }
// Possible errors:
//   'Missing conflictId or resolution'
//   'Conflict not found'
//   'Conflict already resolved'
//   'Resolution must be "local" or "remote"'
```

**Side effects**:
- Marks conflict `status = 'resolved'`, `resolution_method = 'manual'`
- Updates `sync_id_map.ancestor_data` to chosen data
- If `resolution === 'local'`: inserts new `sync_outbox` entry with `operation = 'PUT'`, `status = 'pending'` (re-queues local data for push)
