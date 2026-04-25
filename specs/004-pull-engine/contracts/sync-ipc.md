# Contract: Sync IPC Channels

**Feature**: 004-pull-engine
**Type**: IPC module (`main/ipc/sync.js`) + Preload namespace (`window.api.sync`)

## Channel Registry

| Channel | Type | Auth | Description |
|---------|------|------|-------------|
| `sync:getConfig` | `handleRead` | None | Returns current sync configuration |
| `sync:setConfig` | `handleWrite` | `['admin']` | Updates sync configuration, restarts engines |
| `sync:getStatus` | `handleRead` | None | Returns live sync status snapshot |
| `sync:triggerNow` | `handleWrite` | `['admin']` | Triggers immediate push + pull cycle |
| `sync:getConflictLog` | `handleRead` | None | Returns recent conflict entries |
| `sync:resolveConflict` | `handleWrite` | `['admin']` | Resolves a conflict entry |

## Channel Specifications

### `sync:getConfig` → `SyncConfig`

Returns the current sync configuration from `sync_config WHERE id = 1`.

**Response shape**:
```js
{
    enabled:              boolean,  // true if sync is active
    syncIntervalMinutes:  number,   // interval between cycles (1–30)
    awsRegion:            string,   // AWS region (e.g., 'us-east-1')
    authLambdaUrl:        string | null,
    schoolId:             string | null,
    pushBatchSize:        number,   // max outbox entries per push
    maxRetries:           number,   // max retries before marking failed
    retentionDays:        number    // outbox retention period
}
```

### `sync:setConfig(updates)` → `{ success: boolean }`

Updates sync configuration fields. Admin-only.

**Parameters**:
- `updates` — Object with any subset of: `enabled`, `syncIntervalMinutes`, `awsRegion`, `authLambdaUrl`, `schoolId`, `pushBatchSize`, `maxRetries`, `retentionDays`

**Behavior**:
1. Validate `syncIntervalMinutes` is between 1 and 30 (if provided)
2. Update `sync_config` row
3. Call `restartSyncPushBackground()` and `restartSyncPullBackground()` to apply new settings
4. Return `{ success: true }`

### `sync:getStatus` → `SyncStatus`

Returns a live snapshot combining configuration data with runtime engine state.

**Response shape**:
```js
{
    enabled:          boolean,
    pushRunning:      boolean,   // is the push timer active?
    pullRunning:      boolean,   // is the pull timer active?
    lastPushAt:       string | null,  // ISO timestamp
    lastPullAt:       string | null,  // ISO timestamp
    lastPushError:    string | null,
    lastPullError:    string | null,
    pendingCount:     number,    // outbox entries with status='pending'
    failedCount:      number,    // outbox entries with status='failed'
    conflictCount:    number,    // unresolved conflicts
    pullCursor:       string | null,  // current GSI1SK cursor
    authenticated:    boolean    // are valid credentials cached?
}
```

### `sync:triggerNow` → `TriggerResult`

Triggers immediate push and pull cycles. Admin-only.

**Response shape**:
```js
{
    success: boolean,
    push: FlushResult | null,    // result from flushSyncOutbox()
    pull: PullResult | null,     // result from pullRemoteChanges()
    error: string | null
}
```

**Behavior**:
1. Check sync is enabled — return error if not
2. Execute `flushSyncOutbox()` (push first, so local changes reach cloud)
3. Execute `pullRemoteChanges()` (pull second, to receive latest)
4. Return combined results

### `sync:getConflictLog(options?)` → `ConflictEntry[]`

Returns recent conflict entries, optionally filtered.

**Parameters**:
- `options.status` — `'unresolved'` | `'resolved'` | `'all'` (default: `'all'`)
- `options.limit` — Max entries to return (default: 50, max: 200)
- `options.offset` — Pagination offset (default: 0)

**Response shape** (array of):
```js
{
    id:                number,
    tableName:         string,
    rowSyncId:         string,
    entityType:        string,
    localData:         object | null,  // parsed JSON
    remoteData:        object,         // parsed JSON
    remoteVersion:     number,
    remoteDeviceHash:  string,
    status:            'unresolved' | 'resolved',
    resolution:        'local' | 'remote' | 'merged' | null,
    resolvedAt:        string | null,
    createdAt:         string
}
```

### `sync:resolveConflict(payload)` → `{ success: boolean }`

Resolves a conflict entry. Admin-only.

**Parameters**:
- `payload.conflictId` — Integer ID of the conflict to resolve
- `payload.resolution` — `'local'` | `'remote'`

**Behavior**:
- `'remote'`: Mark as resolved (remote data was already applied during pull — no further action needed)
- `'local'`: Mark as resolved, then re-queue the local data as a new outbox entry to push the local version back to the cloud
- Update `status = 'resolved'`, `resolution = ?`, `resolved_at = CURRENT_TIMESTAMP`

## Preload Namespace

Added to `contextBridge.exposeInMainWorld('api', { ... })`:

```js
sync: {
    getConfig: () => ipcRenderer.invoke('sync:getConfig'),
    setConfig: (updates) => ipcRenderer.invoke('sync:setConfig', updates),
    getStatus: () => ipcRenderer.invoke('sync:getStatus'),
    triggerNow: () => ipcRenderer.invoke('sync:triggerNow'),
    getConflictLog: (options) => ipcRenderer.invoke('sync:getConflictLog', options),
    resolveConflict: (payload) => ipcRenderer.invoke('sync:resolveConflict', payload)
}
```

## Smoke Test Impact

The smoke test (`tests/smoke.js`) validates that every channel declared in `preload.js` has a matching handler in `main/ipc/*.js`. Adding the 6 channels above requires:

1. All 6 channels registered in `main/ipc/sync.js` via `handleRead`/`handleWrite`
2. `registerSyncIpc` called from `main/ipc/registerAll.js`
3. All 6 methods declared in `preload.js` under `sync:` namespace

Any mismatch will fail CI.
