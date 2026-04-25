# Contract: Push Engine

**Feature**: 003-push-engine
**Type**: Internal Node.js module (`main/sync/engine.js`)

## Interface

### `startSyncPushBackground()` → `void`

Starts the push engine background timer. Called once from `main.js` during app startup.

**Behavior**:
- Reads `sync_config WHERE id = 1`
- If `enabled = 0` or `auth_lambda_url` is not set: returns immediately (no timer created)
- Fires the first flush immediately via `void flushSyncOutbox()`
- Starts `setInterval` at `sync_interval_minutes * 60 * 1000`
- Calls `.unref()` on the timer to avoid blocking Electron exit
- Guard: if timer is already running, returns immediately (idempotent)

### `stopSyncPushBackground()` → `void`

Stops the push engine background timer. Safe to call multiple times.

### `restartSyncPushBackground()` → `void`

Calls `stop` then `start`. Used when sync config changes.

### `flushSyncOutbox(limit?)` → `Promise<FlushResult>`

The core flush loop. Processes up to `limit` (default: `push_batch_size` from config, fallback 100) pending outbox entries.

**FlushResult shape**:
```js
{
    success:      boolean,   // true if no failures occurred
    sentCount:    number,    // entries successfully pushed
    failedCount:  number,    // entries that failed this cycle
    skippedCount: number,    // entries skipped (authority, bulk errors)
    pendingCount: number,    // remaining pending entries
    lastError:    string | null
}
```

**Flush algorithm**:
```
1. Re-entrancy guard: if _flushRunning, return { skipped: true }
2. Set _flushRunning = true (try/finally to reset)
3. Read sync_config — exit if disabled
4. Get credentials via getCredentials() — exit if null
5. Query: SELECT * FROM sync_outbox WHERE status = 'pending' ORDER BY id ASC LIMIT ?
6. For each entry:
   a. Check writer authority → skip if unauthorized
   b. If _bulk: true → expand to individual rows
   c. Strip sensitive fields (defense-in-depth)
   d. Construct DynamoDB item (PK, SK, GSI keys, envelope attributes)
   e. Add to batch buffer
   f. When buffer reaches 25 items → BatchWriteItem
7. Flush remaining buffer
8. For each successfully written entry: UPDATE status = 'sent', sent_at = NOW
9. For each failed entry:
   a. INCREMENT retries, SET last_error
   b. If retries >= max_retries: SET status = 'failed'
10. Update sync_config: last_push_at, last_push_error
11. Return FlushResult
```

## DynamoDB Item Construction

Each outbox entry is transformed into a DynamoDB item:

```js
{
    PK:         `SCHOOL#${schoolId}`,
    SK:         buildSortKey(entry.table_name, rowData),
    GSI1PK:     `SCHOOL#${schoolId}`,
    GSI1SK:     `${updatedAt}#${entityType}#${entityId}`,
    entityType: tableToEntityType(entry.table_name),
    schoolYear: entry.school_year,
    updatedAt:  Math.floor(Date.now() / 1000),
    version:    nextVersion,
    operation:  entry.operation,
    rowSyncId:  entry.row_sync_id,
    deviceHash: deviceHash.substring(0, 16),
    data:       JSON.parse(entry.row_data),
    expiresAt:  computeTtl(entry.operation)
}
```

## Conditional Write

Every `PutItem` within `BatchWriteItem` uses:
```
ConditionExpression: "attribute_not_exists(version) OR version < :v"
ExpressionAttributeValues: { ":v": nextVersion }
```

**Note**: `BatchWriteItem` does not support condition expressions. Individual items that require version guards must use `PutCommand` with conditions. Batch writes are used for new items (version 1); updates use individual conditional puts.

## Error Classification

| Error Type | Retry? | Max Retries |
|-----------|--------|-------------|
| `ProvisionedThroughputExceededException` | Yes | No limit (always retry) |
| `ThrottlingException` | Yes | No limit |
| Network timeout / connection refused | Yes | Default 10 |
| `ConditionalCheckFailedException` | No | Mark as conflict, skip |
| `ValidationException` | No | Mark as `failed` immediately |
| `AccessDeniedException` | No | Clear credentials, skip cycle |

## Dependencies

| Dependency | Import |
|-----------|--------|
| `getDb()` | `main/db/context.js` |
| `getCredentials()` | `main/sync/credentials.js` |
| `getDeviceHash()` | `main/sync/capture.js` |
| `ensureSyncIdMapping()` | `main/sync/capture.js` |
| `stripSensitiveFields()` | `main/sync/capture.js` |
| `CHANNEL_REGISTRY` | `main/sync/capture.js` |
| `DynamoDBDocumentClient` | `@aws-sdk/lib-dynamodb` |
| `BatchWriteCommand` | `@aws-sdk/lib-dynamodb` |
| `PutCommand` | `@aws-sdk/lib-dynamodb` |
