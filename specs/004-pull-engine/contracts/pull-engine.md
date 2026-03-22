# Contract: Pull Engine

**Feature**: 004-pull-engine
**Type**: Internal Node.js module (`main/sync/engine.js` — extended)

## Interface

### `pullRemoteChanges()` → `Promise<PullResult>`

The core pull loop. Queries the cloud for changes since the last cursor, applies them to the local database, and advances the cursor.

**PullResult shape**:
```js
{
    success:        boolean,   // true if no fatal errors occurred
    appliedCount:   number,    // records successfully applied locally
    skippedCount:   number,    // records skipped (self-origin, unknown entity type)
    conflictCount:  number,    // records that conflicted with pending local changes
    failedCount:    number,    // records that failed to apply (FK violations, etc.)
    totalFetched:   number,    // total items received from the cloud
    newCursor:      string,    // the updated GSI1SK cursor value
    lastError:      string | null
}
```

**Pull algorithm**:
```
1. Re-entrancy guard: if _pullRunning, return { skipped: true }
2. Set _pullRunning = true (try/finally to reset)
3. Read sync_config — exit if disabled
4. Get credentials via getCredentials() — exit if null
5. Read pull_cursor from sync_config (default: '0')
6. Pre-load pending outbox row_sync_ids into a Set for conflict detection
7. Query SyncGSI: GSI1PK = SCHOOL#<schoolId> AND GSI1SK > <cursor>
   - Paginate via LastEvaluatedKey until all pages consumed
   - Limit: 500 items per page
8. Filter out self-originated records (deviceHash matches local device)
9. Sort items by topological order (parents before children for PUTs)
10. Begin SQLite transaction:
    For each item:
      a. Check conflict Set → if pending local change exists, log to sync_conflicts
      b. Look up sync_id_map by row_sync_id
      c. If PUT + no local mapping → INSERT new row, create sync_id_map entry
      d. If PUT + local mapping exists → UPDATE existing row
      e. If DEL + local mapping exists → DELETE row (keep sync_id_map tombstone)
      f. If DEL + no local mapping → skip (idempotent)
    Commit transaction
11. Advance pull_cursor to highest GSI1SK seen
12. Update sync_config: last_pull_at, last_pull_error
13. Update sync_pull_state per affected table
14. Return PullResult
```

### `startSyncPullBackground()` → `void`

Starts the pull engine background timer. Called from `main.js` during app startup, alongside `startSyncPushBackground()`.

**Behavior**:
- Reads `sync_config WHERE id = 1`
- If `enabled = 0` or `auth_lambda_url` is not set: returns immediately
- Fires the first pull immediately via `void pullRemoteChanges()`
- Starts `setInterval` at `sync_interval_minutes * 60 * 1000`
- Calls `.unref()` on the timer to avoid blocking Electron exit
- Guard: if timer is already running, returns immediately (idempotent)

### `stopSyncPullBackground()` → `void`

Stops the pull engine background timer. Safe to call multiple times.

### `restartSyncPullBackground()` → `void`

Calls `stop` then `start`. Used when sync config changes via `sync:setConfig`.

## Error Classification

| Error Type | Behavior |
|-----------|----------|
| Network timeout / connection refused | Store error in `last_pull_error`, retry next cycle |
| `AccessDeniedException` | Clear credentials via `clearCredentials()`, skip cycle |
| `ThrottlingException` | Store error, retry next cycle |
| FK constraint violation (single row) | Skip the row, increment `failedCount`, retry next cycle |
| Transaction failure (full batch) | Rollback, store error, retry entire batch next cycle |
| Unknown entity type | Skip the record, log warning |

## Dependencies

| Dependency | Import |
|-----------|--------|
| `getDb()` | `main/db/context.js` |
| `getCredentials()`, `clearCredentials()` | `main/sync/credentials.js` |
| `getDeviceHash()` | `main/sync/capture.js` |
| `ENTITY_TYPE_REGISTRY` | `main/sync/authority.js` |
| `DynamoDBDocumentClient` | `@aws-sdk/lib-dynamodb` |
| `QueryCommand` | `@aws-sdk/lib-dynamodb` |
