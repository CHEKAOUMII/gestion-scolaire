# Tasks: Push Engine

**Input**: Design documents from `/specs/003-push-engine/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Not explicitly requested — test tasks omitted.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Electron main process**: `main/` at repository root
- **Sync modules**: `main/sync/` (new files alongside existing `capture.js`)
- **Database**: `main/db/migrations.js` (append new migration)
- **App entry**: `main.js` (startup hooks)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install dependencies and extend the database schema so all user stories have the foundation they need.

- [x] T001 Install AWS SDK v3 dependencies by running `npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-cognito-identity` — this adds three new production dependencies to `package.json`. After install, verify `package.json` has all three packages listed under `dependencies`. Do NOT add any other packages.

- [x] T002 Add database migration `2026-03-031-push-engine-config` in `main/db/migrations.js`. Append a new migration object to the migrations array with `version: '2026-03-031-push-engine-config'`. The `up` function must use `ensureColumn()` (already imported in the file — search for `ensureColumn` to see existing usage) to add 7 new columns to the `sync_config` table. Each `ensureColumn` call is idempotent (safe to run multiple times). The columns to add are:
    - `ensureColumn(db, 'sync_config', 'auth_lambda_url', 'TEXT')`
    - `ensureColumn(db, 'sync_config', 'aws_region', "TEXT DEFAULT 'us-east-1'")`
    - `ensureColumn(db, 'sync_config', 'last_push_at', 'DATETIME')`
    - `ensureColumn(db, 'sync_config', 'last_push_error', 'TEXT')`
    - `ensureColumn(db, 'sync_config', 'push_batch_size', 'INTEGER DEFAULT 100')`
    - `ensureColumn(db, 'sync_config', 'max_retries', 'INTEGER DEFAULT 10')`
    - `ensureColumn(db, 'sync_config', 'school_id', 'TEXT')`

    Follow the exact pattern of the previous migration (`2026-03-030-sync-foundation`). The migration gets `db` via `getDb()`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create the writer authority module and the credential manager — these are standalone modules that the push engine depends on but can be built independently of each other.

**CRITICAL**: No user story work (Phase 3+) can begin until BOTH tasks in this phase are complete.

- [x] T003 [P] Create writer authority module at `main/sync/authority.js`. This is a new file. Use CommonJS (`module.exports`). The complete file must contain:

    **1. `WRITER_AUTHORITY` constant** — a plain object mapping every syncable table name to an array of roles allowed to push changes for that table. Copy this exactly:

    ```js
    const WRITER_AUTHORITY = {
        students: ['admin'],
        correspondence: ['admin'],
        student_files: ['admin'],
        student_movements: ['admin'],
        grades: ['admin', 'staff'],
        absences: ['admin', 'staff'],
        teachers: ['admin'],
        teacher_aliases: ['admin'],
        staff_attendance: ['admin'],
        compensation_tracking: ['admin'],
        teacher_absences: ['admin'],
        exams: ['admin'],
        exam_proctors: ['admin'],
        exam_rooms: ['admin'],
        tests: ['admin'],
        settings: ['admin'],
        page_visibility: ['admin']
    };
    ```

    **2. `ENTITY_TYPE_REGISTRY` constant** — maps SQLite table names to DynamoDB entity type info. Each entry has `entityType` (string, lowercase singular — e.g., `'student'`), `skPrefix` (string, uppercase — e.g., `'STUDENT'`), and `keyFields` (array of column names used to build the DynamoDB sort key). Full registry:

    ```js
    const ENTITY_TYPE_REGISTRY = {
        students: { entityType: 'student', skPrefix: 'STUDENT', keyFields: ['code'] },
        grades: {
            entityType: 'grade',
            skPrefix: 'GRADE',
            keyFields: ['student_code', 'subject', 'semester', 'school_year']
        },
        absences: {
            entityType: 'absence',
            skPrefix: 'ABSENCE',
            keyFields: ['student_code', 'month', 'school_year', 'absence_type']
        },
        teachers: { entityType: 'teacher', skPrefix: 'TEACHER', keyFields: ['id'] },
        teacher_aliases: { entityType: 'teacher_alias', skPrefix: 'TEACHER_ALIAS', keyFields: ['id'] },
        staff_attendance: {
            entityType: 'staff_attendance',
            skPrefix: 'STAFF_ATTENDANCE',
            keyFields: ['teacher_id', 'date']
        },
        teacher_absences: {
            entityType: 'teacher_absence',
            skPrefix: 'TEACHER_ABSENCE',
            keyFields: ['teacher_id', 'date']
        },
        exams: { entityType: 'exam', skPrefix: 'EXAM', keyFields: ['id'] },
        exam_proctors: { entityType: 'exam_proctor', skPrefix: 'EXAM_PROCTOR', keyFields: ['exam_id', 'teacher_id'] },
        exam_rooms: { entityType: 'exam_room', skPrefix: 'EXAM_ROOM', keyFields: ['exam_id', 'room_id'] },
        tests: { entityType: 'test', skPrefix: 'TEST', keyFields: ['id'] },
        correspondence: { entityType: 'correspondence', skPrefix: 'CORRESPONDENCE', keyFields: ['id'] },
        student_files: { entityType: 'student_file', skPrefix: 'STUDENT_FILE', keyFields: ['student_code', 'id'] },
        student_movements: { entityType: 'student_movement', skPrefix: 'STUDENT_MOVEMENT', keyFields: ['id'] },
        compensation_tracking: { entityType: 'compensation', skPrefix: 'COMPENSATION', keyFields: ['id'] },
        settings: { entityType: 'settings', skPrefix: 'SETTINGS', keyFields: ['key'] },
        page_visibility: { entityType: 'page_visibility', skPrefix: 'PAGE_VISIBILITY', keyFields: ['key'] }
    };
    ```

    **3. `canPush(tableName, role)` function** — returns `true` if the role is allowed to push for the given table. Rules:
    - If `tableName` is not in `WRITER_AUTHORITY`, return `false` (deny by default)
    - If `role` is falsy (`null`, `undefined`, `''`), return `false`
    - Otherwise return `WRITER_AUTHORITY[tableName].includes(role)`

    **4. `getAuthorizedTables(role)` function** — returns an array of table names the role can push. Use `Object.entries(WRITER_AUTHORITY).filter(([_, roles]) => roles.includes(role)).map(([table]) => table)`. Return empty array if role is falsy.

    **5. `buildSortKey(tableName, rowData)` function** — constructs a DynamoDB sort key from the entity type registry and row data. Steps:
    - Look up `tableName` in `ENTITY_TYPE_REGISTRY`. If not found, return `null`.
    - Extract each key field value from `rowData` using the `keyFields` array.
    - Return `${entry.skPrefix}#${values.join('#')}` — e.g., `'GRADE#M001#Math#S1#2025/2026'`
    - If any key field is missing from `rowData`, use empty string `''` as fallback.

    **6. `getEntityType(tableName)` function** — returns the `entityType` string for a table (e.g., `'student'` for `'students'`). Returns `null` if not in registry.

    **Exports**: `module.exports = { WRITER_AUTHORITY, ENTITY_TYPE_REGISTRY, canPush, getAuthorizedTables, buildSortKey, getEntityType };`

    **Code style**: Single quotes, no trailing commas on last items, 4-space indent, semicolons. Follow Prettier conventions per CLAUDE.md.

- [x] T004 [P] Create credential manager at `main/sync/credentials.js`. This is a new file. Use CommonJS (`module.exports`).

    **Imports needed** (all at top of file):

    ```js
    const { CognitoIdentityClient, GetCredentialsForIdentityCommand } = require('@aws-sdk/client-cognito-identity');
    const { getDb } = require('../db/context');
    const { getDeviceHash } = require('./capture');
    ```

    **Module-level state** (private, not exported):

    ```js
    let _cachedCredentials = null; // { accessKeyId, secretAccessKey, sessionToken, expiresAt, identityId, schoolId }
    let _refreshPromise = null; // prevents duplicate concurrent refreshes
    ```

    **Helper: `readSyncConfig(db)`** — reads the singleton config row:

    ```js
    function readSyncConfig(db) {
        return db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
    }
    ```

    **Helper: `readLicenseKey(db)`** — reads the most recent active license key from the `licenses` table:

    ```js
    function readLicenseKey(db) {
        const row = db
            .prepare("SELECT license_key FROM licenses WHERE status != 'revoked' ORDER BY id DESC LIMIT 1")
            .get();
        return row ? row.license_key : null;
    }
    ```

    **Core: `async function refreshCredentials()`** — the 2-step auth flow:
    1. Read `sync_config` to get `auth_lambda_url` and `aws_region`. If `auth_lambda_url` is falsy, return `null`.
    2. Read license key via `readLicenseKey(db)`. If null, return `null`.
    3. Get device hash via `getDeviceHash()`.
    4. **Step 1 — Call Auth Lambda**: Use native `fetch` (Node 18+ built-in):
        ```js
        const authResponse = await fetch(`${authLambdaUrl}/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey, deviceHash })
        });
        ```
        If `!authResponse.ok`, parse the error body, log a warning `console.warn('[sync:credentials] Auth failed:', errorBody.error || authResponse.status)`, and return `null`.
        Parse success body: `const { identityId, token, schoolId } = await authResponse.json();`
    5. **Step 2 — Exchange token for AWS credentials**: Create a `CognitoIdentityClient({ region: awsRegion })` and send a `GetCredentialsForIdentityCommand`:
        ```js
        const cognitoClient = new CognitoIdentityClient({ region: awsRegion });
        const credResult = await cognitoClient.send(
            new GetCredentialsForIdentityCommand({
                IdentityId: identityId,
                Logins: { 'login.pencil.school': token }
            })
        );
        ```
    6. Extract credentials from `credResult.Credentials` and build the cached object:
        ```js
        _cachedCredentials = {
            accessKeyId: credResult.Credentials.AccessKeyId,
            secretAccessKey: credResult.Credentials.SecretKey,
            sessionToken: credResult.Credentials.SessionToken,
            expiresAt: Math.floor(credResult.Credentials.Expiration.getTime() / 1000),
            identityId,
            schoolId
        };
        ```
    7. Return `_cachedCredentials`.
    8. Wrap the entire function body in try/catch. On any error, `console.warn('[sync:credentials] Credential refresh failed:', err.message)`, return `null`.

    **Main: `async function getCredentials()`** — the public API:
    1. If `_cachedCredentials` exists and has more than 600 seconds (10 minutes) remaining (`_cachedCredentials.expiresAt - Math.floor(Date.now() / 1000) > 600`), return `_cachedCredentials` immediately.
    2. If `_refreshPromise` is already in flight (not null), `return _refreshPromise` (deduplication).
    3. Otherwise, set `_refreshPromise = refreshCredentials()`, await it, set `_refreshPromise = null` in a `finally` block, and return the result.

    **`clearCredentials()`** — sets `_cachedCredentials = null` and `_refreshPromise = null`.

    **`isAuthenticated()`** — returns `true` if `_cachedCredentials !== null && (_cachedCredentials.expiresAt - Math.floor(Date.now() / 1000)) > 600`.

    **Exports**: `module.exports = { getCredentials, clearCredentials, isAuthenticated };`

**Checkpoint**: Foundation ready — authority module provides role checks + entity type registry, credential manager handles AWS auth. The push engine (Phase 3+) can now be built.

---

## Phase 3: User Story 1 — Outbox Changes Are Automatically Pushed to Cloud (Priority: P1) 🎯 MVP

**Goal**: Build the core flush loop in `main/sync/engine.js` that reads pending outbox entries, constructs DynamoDB items, batches them into `BatchWriteItem` / `PutCommand` calls, and marks entries as `sent` on success.

**Independent Test**: Add a student record, wait for the push interval, verify the outbox entry status changes to `sent` and the item appears in DynamoDB.

### Implementation for User Story 1

- [x] T005 [US1] Create the push engine file at `main/sync/engine.js`. This is the largest and most important file. Use CommonJS. Build it in the order described below. Every function listed here goes in this single file.

    **Imports** (all at top):

    ```js
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, BatchWriteCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
    const { getDb } = require('../db/context');
    const { getCredentials, clearCredentials } = require('./credentials');
    const { getDeviceHash, stripSensitiveFields, ensureSyncIdMapping, CHANNEL_REGISTRY } = require('./capture');
    const { canPush, buildSortKey, getEntityType, ENTITY_TYPE_REGISTRY } = require('./authority');
    ```

    **Module-level state**:

    ```js
    let _syncTimer = null;
    let _flushRunning = false;
    let _dynamoClient = null; // lazily created DynamoDBDocumentClient
    ```

    **Helper: `readSyncConfig(db)`** — reads the singleton config row. Same as in credentials.js:

    ```js
    function readSyncConfig(db) {
        return db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
    }
    ```

    **Helper: `getDynamoClient(region, credentials)`** — creates or returns a cached `DynamoDBDocumentClient`:

    ```js
    function getDynamoClient(region, credentials) {
        const client = new DynamoDBClient({
            region,
            credentials: {
                accessKeyId: credentials.accessKeyId,
                secretAccessKey: credentials.secretAccessKey,
                sessionToken: credentials.sessionToken
            }
        });
        return DynamoDBDocumentClient.from(client, {
            marshallOptions: { removeUndefinedValues: true }
        });
    }
    ```

    Note: Do NOT cache the client across credential refreshes — create a new one each time credentials change. Comparison: `if (_dynamoClient && credentials.accessKeyId === _lastAccessKeyId)` to reuse, else recreate. Store `_lastAccessKeyId` at module level.

    **Helper: `buildDynamoItem(entry, schoolId, deviceHash)`** — transforms one outbox entry into a DynamoDB item object:
    1. Parse `entry.row_data` via `JSON.parse`. If `row_data` is null (DEL operation), use `{}`.
    2. Call `stripSensitiveFields(rowData)` (defense-in-depth — Phase 1 already strips, but we double-check).
    3. Look up `getEntityType(entry.table_name)` — if null, log warning and return null.
    4. Call `buildSortKey(entry.table_name, rowData)` — if null, log warning and return null.
    5. Compute `updatedAt = Math.floor(Date.now() / 1000)`.
    6. Compute `expiresAt`:
        - For `DEL` operations: `updatedAt + 259200` (72 hours)
        - For `PUT` operations: `updatedAt + (30 * 86400)` (30 days)
    7. Build and return the DynamoDB item object:
        ```js
        {
            PK: `SCHOOL#${schoolId}`,
            SK: sortKey,
            GSI1PK: `SCHOOL#${schoolId}`,
            GSI1SK: `${updatedAt}#${entityType}#${entry.row_sync_id}`,
            entityType,
            schoolYear: entry.school_year || '',
            updatedAt,
            version: 1,  // default for new items; conditional write handles conflicts
            operation: entry.operation,
            rowSyncId: entry.row_sync_id,
            deviceHash: deviceHash.substring(0, 16),
            data: rowData,
            expiresAt
        }
        ```

    **Helper: `async writeBatchToDynamo(docClient, tableName, items)`** — sends up to 25 items to DynamoDB via `BatchWriteCommand`:

    ```js
    async function writeBatchToDynamo(docClient, items) {
        if (!items.length) return { success: true, failedItems: [] };
        const requestItems = {
            'pencil2-sync': items.map((item) => ({
                PutRequest: { Item: item }
            }))
        };
        try {
            const result = await docClient.send(new BatchWriteCommand({ RequestItems: requestItems }));
            const unprocessed = result.UnprocessedItems?.['pencil2-sync'] || [];
            return { success: unprocessed.length === 0, failedItems: unprocessed };
        } catch (err) {
            return { success: false, error: err.message, errorName: err.name };
        }
    }
    ```

    **Helper: `async writeItemWithCondition(docClient, item)`** — writes a single item with a version guard using `PutCommand`:

    ```js
    async function writeItemWithCondition(docClient, item) {
        try {
            await docClient.send(
                new PutCommand({
                    TableName: 'pencil2-sync',
                    Item: item,
                    ConditionExpression: 'attribute_not_exists(version) OR version < :v',
                    ExpressionAttributeValues: { ':v': item.version }
                })
            );
            return { success: true };
        } catch (err) {
            if (err.name === 'ConditionalCheckFailedException') {
                return { success: false, conflict: true, error: 'Version conflict — newer version exists' };
            }
            return { success: false, error: err.message, errorName: err.name };
        }
    }
    ```

    **Helper: `markEntrySent(db, entryId)`**:

    ```js
    function markEntrySent(db, entryId) {
        db.prepare(
            "UPDATE sync_outbox SET status = 'sent', sent_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?"
        ).run(entryId);
    }
    ```

    **Helper: `markEntryFailed(db, entryId, error, maxRetries)`**:

    ```js
    function markEntryFailed(db, entryId, error, maxRetries) {
        const entry = db.prepare('SELECT retries FROM sync_outbox WHERE id = ?').get(entryId);
        const newRetries = (entry ? entry.retries : 0) + 1;
        const newStatus = newRetries >= maxRetries ? 'failed' : 'pending';
        db.prepare(
            'UPDATE sync_outbox SET retries = ?, last_attempt_at = CURRENT_TIMESTAMP, last_error = ?, status = ? WHERE id = ?'
        ).run(newRetries, error, newStatus, entryId);
    }
    ```

    **Helper: `updatePushMeta(db, lastPushAt, lastPushError)`**:

    ```js
    function updatePushMeta(db, lastPushAt, lastPushError) {
        db.prepare(
            'UPDATE sync_config SET last_push_at = ?, last_push_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
        ).run(lastPushAt, lastPushError);
    }
    ```

    **Helper: `getCurrentRole()`** — gets the highest-privilege role from active sessions. Import `getActiveSessions` from `main/ipc/auth.js` (look for how `auth.js` exports its session map — it exports a `getActiveSessions` function or similar; if not, access `_sessions` directly or add a getter). The push engine needs to call this to determine writer authority. Simplest approach:

    ```js
    function getCurrentRole() {
        try {
            const { getActiveSessions } = require('../ipc/auth');
            const sessions = getActiveSessions();
            if (!sessions || sessions.size === 0) return null;
            for (const session of sessions.values()) {
                if (session.role === 'admin') return 'admin';
            }
            for (const session of sessions.values()) {
                if (session.role === 'staff') return 'staff';
            }
            return null;
        } catch (_err) {
            return null;
        }
    }
    ```

    **IMPORTANT**: Check `main/ipc/auth.js` for the actual export name. If there is no `getActiveSessions` export, you must add one (see T009). The function should return the in-memory sessions `Map`.

    **Core: `async function flushSyncOutbox(limit)`** — the main flush loop. This is the most complex function. Follow this algorithm exactly:

    ```
    1. if (_flushRunning) return { success: true, skipped: true, reason: 'already_running' };
    2. _flushRunning = true;
    3. try {
    4.   const db = getDb();
    5.   const config = readSyncConfig(db);
    6.   if (!Number(config.enabled)) return { success: true, skipped: true, reason: 'disabled' };
    7.
    8.   const role = getCurrentRole();
    9.   if (!role) return { success: true, skipped: true, reason: 'no_active_session' };
    10.
    11.  const credentials = await getCredentials();
    12.  if (!credentials) {
    13.      updatePushMeta(db, null, 'Failed to obtain credentials');
    14.      return { success: false, error: 'credentials_unavailable' };
    15.  }
    16.
    17.  const batchSize = Number(config.push_batch_size) || 100;
    18.  const maxRetries = Number(config.max_retries) || 10;
    19.  const effectiveLimit = Number(limit) || batchSize;
    20.  const deviceHash = getDeviceHash();
    21.  const schoolId = credentials.schoolId;
    22.  const awsRegion = config.aws_region || 'us-east-1';
    23.
    24.  const docClient = getDynamoClient(awsRegion, credentials);
    25.
    26.  const pendingRows = db.prepare(
    27.      "SELECT * FROM sync_outbox WHERE status = 'pending' ORDER BY id ASC LIMIT ?"
    28.  ).all(effectiveLimit);
    29.
    30.  if (!pendingRows.length) return { success: true, sentCount: 0, failedCount: 0, skippedCount: 0, pendingCount: 0, lastError: null };
    31.
    32.  let sentCount = 0, failedCount = 0, skippedCount = 0, lastError = null;
    33.  let batchBuffer = [];
    34.  let batchEntryIds = [];
    35.
    36.  for (const row of pendingRows) {
    37.      // Writer authority check
    38.      if (!canPush(row.table_name, role)) {
    39.          skippedCount++;
    40.          console.log(`[sync:push] Skipped entry ${row.id} — role '${role}' cannot push to '${row.table_name}'`);
    41.          continue;
    42.      }
    43.
    44.      // Bulk placeholder handling (see US6 for full expansion — for MVP, skip bulk entries)
    45.      const rowData = row.row_data ? JSON.parse(row.row_data) : {};
    46.      if (rowData._bulk) {
    47.          // US6 will implement full expansion; for now skip with log
    48.          skippedCount++;
    49.          console.log(`[sync:push] Skipped bulk placeholder entry ${row.id} — expansion not yet implemented`);
    50.          continue;
    51.      }
    52.
    53.      // Stamp retry before attempt
    54.      db.prepare('UPDATE sync_outbox SET retries = retries + 1, last_attempt_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
    55.
    56.      // Build DynamoDB item
    57.      const dynamoItem = buildDynamoItem(row, schoolId, deviceHash);
    58.      if (!dynamoItem) {
    59.          markEntryFailed(db, row.id, 'Failed to build DynamoDB item — unknown entity type', maxRetries);
    60.          failedCount++;
    61.          continue;
    62.      }
    63.
    64.      batchBuffer.push(dynamoItem);
    65.      batchEntryIds.push(row.id);
    66.
    67.      // Flush when buffer reaches 25 (DynamoDB BatchWriteItem limit)
    68.      if (batchBuffer.length >= 25) {
    69.          const result = await writeBatchToDynamo(docClient, batchBuffer);
    70.          if (result.success) {
    71.              for (const id of batchEntryIds) markEntrySent(db, id);
    72.              sentCount += batchEntryIds.length;
    73.          } else {
    74.              lastError = result.error || 'Batch write failed';
    75.              // Handle throttling — don't mark as permanently failed
    76.              if (result.errorName === 'ProvisionedThroughputExceededException' || result.errorName === 'ThrottlingException') {
    77.                  console.warn(`[sync:push] Throttled — will retry next cycle`);
    78.              }
    79.              for (const id of batchEntryIds) markEntryFailed(db, id, lastError, maxRetries);
    80.              failedCount += batchEntryIds.length;
    81.          }
    82.          batchBuffer = [];
    83.          batchEntryIds = [];
    84.      }
    85.  }
    86.
    87.  // Flush remaining items in buffer
    88.  if (batchBuffer.length > 0) {
    89.      const result = await writeBatchToDynamo(docClient, batchBuffer);
    90.      if (result.success) {
    91.          for (const id of batchEntryIds) markEntrySent(db, id);
    92.          sentCount += batchEntryIds.length;
    93.      } else {
    94.          lastError = result.error || 'Batch write failed';
    95.          for (const id of batchEntryIds) markEntryFailed(db, id, lastError, maxRetries);
    96.          failedCount += batchEntryIds.length;
    97.      }
    98.  }
    99.
    100. // Update push metadata
    101. updatePushMeta(db, sentCount > 0 ? new Date().toISOString() : null, lastError);
    102.
    103. const pendingCount = db.prepare("SELECT COUNT(*) AS c FROM sync_outbox WHERE status = 'pending'").get().c || 0;
    104.
    105. if (sentCount > 0) console.log(`[sync:push] Pushed ${sentCount} entries, ${failedCount} failed, ${skippedCount} skipped, ${pendingCount} pending`);
    106.
    107. return { success: failedCount === 0, sentCount, failedCount, skippedCount, pendingCount, lastError };
    108.
    109.} finally {
    110.    _flushRunning = false;
    111.}
    ```

    **Exports**: `module.exports = { flushSyncOutbox, startSyncPushBackground, stopSyncPushBackground, restartSyncPushBackground };`

    Note: `startSyncPushBackground`, `stopSyncPushBackground`, `restartSyncPushBackground` are defined in T006 — they will be added to this same file.

- [x] T006 [US1] Add the background timer lifecycle functions to `main/sync/engine.js` (the same file created in T005). Add these three functions before the `module.exports` line:

    **`startSyncPushBackground()`**:

    ```js
    function startSyncPushBackground() {
        if (_syncTimer) return; // already running

        try {
            const db = getDb();
            const config = readSyncConfig(db);

            if (!Number(config.enabled) || !config.auth_lambda_url) {
                return;
            }

            // Fire first flush immediately
            void flushSyncOutbox();

            // Start periodic timer
            const intervalMinutes = Math.max(1, Math.min(30, Number(config.sync_interval_minutes) || 5));
            const intervalMs = intervalMinutes * 60 * 1000;

            _syncTimer = setInterval(() => {
                void flushSyncOutbox();
            }, intervalMs);

            if (typeof _syncTimer.unref === 'function') {
                _syncTimer.unref();
            }

            console.log(`[sync:push] Background push started (interval: ${intervalMinutes}min)`);
        } catch (err) {
            console.warn('[sync:push] Failed to start push background:', err.message);
        }
    }
    ```

    **`stopSyncPushBackground()`**:

    ```js
    function stopSyncPushBackground() {
        if (_syncTimer) {
            clearInterval(_syncTimer);
            _syncTimer = null;
            console.log('[sync:push] Background push stopped');
        }
    }
    ```

    **`restartSyncPushBackground()`**:

    ```js
    function restartSyncPushBackground() {
        stopSyncPushBackground();
        startSyncPushBackground();
    }
    ```

    Make sure all three are included in `module.exports`.

- [x] T007 [US1] Wire the push engine into app startup in `main.js`. Make two changes:

    **1. Add require at top of file** (near the existing `require('./main/licensing/ownerSync')` line — search for `startOwnerSyncBackground` to find it):

    ```js
    const { startSyncPushBackground } = require('./main/sync/engine');
    ```

    **2. Add startup call** right after the existing `startOwnerSyncBackground()` call (search for `startOwnerSyncBackground()` in the file — it's around line 170 inside the `app.whenReady()` callback):

    ```js
    startSyncPushBackground();
    ```

    That's it — just two lines added to `main.js`.

**Checkpoint**: At this point, the push engine MVP is functional. When sync is enabled and credentials are valid, pending outbox entries will be flushed to DynamoDB every N minutes. US1 acceptance scenarios 1–4 are satisfied.

---

## Phase 4: User Story 2 — Push Engine Obtains and Manages Cloud Credentials (Priority: P1)

**Goal**: Already implemented in T004 (credential manager). This phase validates the credential manager integrates correctly with the push engine.

**Independent Test**: Enable sync, trigger a flush cycle, verify credentials are acquired from Auth Lambda and cached.

### Implementation for User Story 2

- [x] T008 [US2] Verify credential integration in `main/sync/engine.js`. The `flushSyncOutbox()` function (T005) already calls `getCredentials()` at step 11 and handles `null` returns. Verify these behaviors are working correctly:
    1. When `getCredentials()` returns `null` (auth failure), the flush cycle exits early with `{ success: false, error: 'credentials_unavailable' }` and logs `last_push_error = 'Failed to obtain credentials'` to `sync_config`.
    2. When `getCredentials()` returns valid credentials, they are used to create the DynamoDB client.
    3. When `AccessDeniedException` is thrown by DynamoDB (expired credentials mid-cycle), add error handling in the batch write catch block in `writeBatchToDynamo` to call `clearCredentials()`:
        ```js
        // In the catch block of writeBatchToDynamo, add:
        if (err.name === 'AccessDeniedException') {
            clearCredentials();
        }
        ```
        This ensures the next flush cycle will refresh credentials. Also update the `markEntryFailed` call to NOT count AccessDeniedException against max retries — the entry itself is fine, only the credentials were bad.

    This task is about reviewing and adjusting the existing code from T004/T005, not creating new files.

**Checkpoint**: Credential acquisition, caching, and refresh are working. US2 acceptance scenarios 1–4 are satisfied.

---

## Phase 5: User Story 3 — Push Engine Runs as a Background Process on App Startup (Priority: P1)

**Goal**: Already implemented in T006 (lifecycle functions) and T007 (startup hook). This phase adds the session accessor needed for role checks.

**Independent Test**: Launch the app with `sync_config.enabled = 1`, confirm push timer starts. Disable sync, restart, confirm no timer.

### Implementation for User Story 3

- [x] T009 [US3] Expose active sessions from `main/ipc/auth.js`. The push engine's `getCurrentRole()` function (T005) needs to read the in-memory sessions `Map` to determine the logged-in user's role. Open `main/ipc/auth.js` and:
    1. Find the `_sessions` Map (or however sessions are stored — it's an in-memory `Map<senderId, session>` per CLAUDE.md).
    2. Add a `getActiveSessions()` function that returns the sessions Map:
        ```js
        function getActiveSessions() {
            return _sessions;
        }
        ```
    3. Add `getActiveSessions` to the `module.exports` of `auth.js`.

    **IMPORTANT**: Read `main/ipc/auth.js` first to find the actual variable name for the sessions Map. It might be called `sessions`, `_sessions`, `sessionMap`, or similar. The function must return it as-is (not a copy — the push engine only reads, never writes).

    If `auth.js` already exports something that provides session access, use that instead and update `getCurrentRole()` in `engine.js` accordingly.

**Checkpoint**: The push engine starts/stops with the app lifecycle and knows the current user's role. US3 acceptance scenarios 1–4 are satisfied.

---

## Phase 6: User Story 4 — Failed Pushes Are Retried with Backoff (Priority: P2)

**Goal**: Ensure the retry and dead-letter logic in the flush loop handles all failure scenarios correctly.

**Independent Test**: Force a network failure during push, verify entries stay `pending` with incrementing retry counts. After 10 failures, verify status becomes `failed`.

### Implementation for User Story 4

- [x] T010 [US4] Enhance retry and error classification in `main/sync/engine.js`. The basic retry logic exists from T005 (`markEntryFailed` increments retries and sets `status = 'failed'` at max). Enhance it with proper error classification:
    1. **In `writeBatchToDynamo`**, update the catch block to classify errors:

        ```js
        catch (err) {
            const isThrottle = err.name === 'ProvisionedThroughputExceededException' || err.name === 'ThrottlingException';
            const isAccessDenied = err.name === 'AccessDeniedException';
            return {
                success: false,
                error: err.message,
                errorName: err.name,
                isThrottle,
                isAccessDenied
            };
        }
        ```

    2. **In the flush loop** (inside `flushSyncOutbox`), after a batch fails, use the classification:
        - If `result.isThrottle`: do NOT count against max retries (these entries should stay `pending` and retry indefinitely). Modify `markEntryFailed` to accept an `ignoreMaxRetries` parameter:
            ```js
            function markEntryFailed(db, entryId, error, maxRetries, ignoreMaxRetries = false) {
                const entry = db.prepare('SELECT retries FROM sync_outbox WHERE id = ?').get(entryId);
                const newRetries = (entry ? entry.retries : 0) + 1;
                const newStatus = !ignoreMaxRetries && newRetries >= maxRetries ? 'failed' : 'pending';
                db.prepare(
                    'UPDATE sync_outbox SET retries = ?, last_attempt_at = CURRENT_TIMESTAMP, last_error = ?, status = ? WHERE id = ?'
                ).run(newRetries, error, newStatus, entryId);
            }
            ```
        - If `result.isAccessDenied`: call `clearCredentials()`, break out of the loop (stop processing further entries), and skip remaining items.

    3. **Add `ConditionalCheckFailedException` handling** in `writeItemWithCondition` (already done in T005 — verify the conflict case marks the entry as `failed` immediately with `'Version conflict'` error, not as retryable).

**Checkpoint**: Failed entries retry up to 10 times then become `failed`. Throttling errors retry indefinitely. Access denied clears credentials. US4 acceptance scenarios 1–3 are satisfied.

---

## Phase 7: User Story 5 — Writer Authority Is Enforced Before Push (Priority: P2)

**Goal**: Already implemented in the flush loop (T005 step 38–42). This phase validates the authority check is correct.

**Independent Test**: Log in as `staff`, capture an outbox entry for `students` table, trigger flush, verify it's skipped.

### Implementation for User Story 5

- [x] T011 [US5] Verify writer authority enforcement in `main/sync/engine.js`. The flush loop (T005) already calls `canPush(row.table_name, role)` for each entry. Verify:
    1. The `getCurrentRole()` function correctly reads sessions and returns the highest-privilege role.
    2. When role is `null` (no session), the flush cycle skips entirely (step 8–9 of flush algorithm).
    3. When role is `'staff'` and entry table is `'students'`, the entry is skipped with a log message.
    4. When role is `'staff'` and entry table is `'grades'`, the entry is pushed normally.
    5. Skipped entries are counted in `skippedCount` and reflected in the `FlushResult`.

    This is primarily a review task. If the logic from T005 is correct, no code changes needed. If any edge case is missing, fix it.

**Checkpoint**: Writer authority checks work correctly for all 17 table types. US5 acceptance scenarios 1–3 are satisfied.

---

## Phase 8: User Story 6 — Bulk Placeholder Entries Are Expanded Before Push (Priority: P2)

**Goal**: Replace the temporary "skip bulk" placeholder in the flush loop with full bulk expansion logic.

**Independent Test**: Do a bulk XLSX import of 50 students, verify the `_bulk: true` outbox entry gets expanded into 50 individual DynamoDB items.

### Implementation for User Story 6

- [x] T012 [US6] Implement bulk placeholder expansion in `main/sync/engine.js`. Replace the temporary bulk-skip logic from T005 (step 44–51 of the flush loop) with full expansion. Add a new helper function `expandBulkEntry(db, entry, deviceHash)`:

    ```js
    function expandBulkEntry(db, entry, deviceHash) {
        const bulkData = JSON.parse(entry.row_data || '{}');
        const tableName = entry.table_name;
        const schoolYear = entry.school_year || '';

        // Query all current rows from the affected table, filtered by school_year
        let rows;
        try {
            // Most tables have a school_year column
            const hasSchoolYear =
                db.prepare("SELECT COUNT(*) AS c FROM pragma_table_info(?) WHERE name = 'school_year'").get(tableName)
                    .c > 0;

            if (hasSchoolYear && schoolYear) {
                rows = db.prepare(`SELECT * FROM "${tableName}" WHERE school_year = ?`).all(schoolYear);
            } else {
                rows = db.prepare(`SELECT * FROM "${tableName}"`).all();
            }
        } catch (err) {
            console.warn(`[sync:push] Bulk expansion failed for table '${tableName}':`, err.message);
            return [];
        }

        // For each row, ensure sync ID mapping exists and build an expanded entry
        const expanded = [];
        for (const row of rows) {
            const localId = row.id || row.code || row.key;
            if (localId == null) continue;

            const rowSyncId = ensureSyncIdMapping(db, tableName, localId);
            const cleanData = stripSensitiveFields({ ...row });

            expanded.push({
                table_name: tableName,
                row_sync_id: rowSyncId,
                operation: 'PUT',
                row_data: JSON.stringify(cleanData),
                school_year: schoolYear
            });
        }

        return expanded;
    }
    ```

    Then update the bulk handling block in `flushSyncOutbox` to replace the skip logic:

    ```js
    if (rowData._bulk) {
        const expandedEntries = expandBulkEntry(db, row, deviceHash);
        if (expandedEntries.length === 0) {
            markEntrySent(db, row.id);  // Nothing to expand — mark as done
            continue;
        }
        // Process each expanded entry through the normal push pipeline
        for (const expanded of expandedEntries) {
            if (!canPush(expanded.table_name, role)) {
                skippedCount++;
                continue;
            }
            const expandedData = JSON.parse(expanded.row_data);
            const dynamoItem = buildDynamoItem(expanded, schoolId, deviceHash);
            if (!dynamoItem) continue;

            batchBuffer.push(dynamoItem);
            batchEntryIds.push(row.id);  // All expanded items reference the original bulk entry ID

            if (batchBuffer.length >= 25) {
                const result = await writeBatchToDynamo(docClient, batchBuffer);
                if (result.success) {
                    sentCount += batchBuffer.length;
                } else {
                    lastError = result.error || 'Batch write failed';
                    failedCount += batchBuffer.length;
                }
                batchBuffer = [];
                batchEntryIds = [];
            }
        }
        // Mark the original bulk entry as sent after all expanded items are processed
        markEntrySent(db, row.id);
        continue;
    }
    ```

    **Edge cases to handle**:
    - If `expandBulkEntry` returns an empty array (table is empty or all rows deleted), mark the placeholder as `sent` — it's a no-op.
    - Rows without a primary key (`id`, `code`, or `key`) are skipped silently.

**Checkpoint**: Bulk placeholder entries are fully expanded. A bulk import of N records produces N individual DynamoDB items. US6 acceptance scenarios 1–3 are satisfied.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, linting, and verification that all existing tests pass unchanged.

- [x] T013 [P] Run `npm run lint` and fix any ESLint errors in the three new files (`main/sync/engine.js`, `main/sync/credentials.js`, `main/sync/authority.js`) and modified files (`main.js`, `main/db/migrations.js`, `main/ipc/auth.js`). Common issues to watch for:
    - `no-unused-vars` warnings (must resolve for main-process code per constitution)
    - Missing semicolons
    - Inconsistent quotes (must use single quotes)
    - Lines over 120 characters

- [x] T014 [P] Run `npm run test:smoke` and verify all existing smoke tests pass unchanged. The push engine adds no new IPC channels (deferred to Phase 4), so the IPC parity test should be unaffected. If any smoke test fails, investigate and fix without modifying the smoke test itself.

- [x] T015 Run `npm run format` (Prettier) on all new and modified files to ensure consistent formatting. Then run `npm run lint` again to confirm no formatting-introduced lint issues.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (T001, T002 complete) — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 (T003, T004 complete) — this is the MVP
- **US2 (Phase 4)**: Depends on US1 (T005–T007 complete)
- **US3 (Phase 5)**: Depends on US1 (T005–T007 complete) — can run in parallel with US2
- **US4 (Phase 6)**: Depends on US1 (T005 complete)
- **US5 (Phase 7)**: Depends on US3 (T009 complete, for session access)
- **US6 (Phase 8)**: Depends on US1 (T005 complete)
- **Polish (Phase 9)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: Foundational → T005, T006, T007 (core flush + lifecycle + main.js hook)
- **US2 (P1)**: US1 → T008 (credential error handling integration)
- **US3 (P1)**: US1 → T009 (session accessor for role)
- **US4 (P2)**: US1 → T010 (error classification enhancement)
- **US5 (P2)**: US3 → T011 (verify authority with real sessions)
- **US6 (P2)**: US1 → T012 (bulk expansion)

### Within Each User Story

- Core module before integration
- Review/verification after implementation
- Lint after code changes

### Parallel Opportunities

- T001 and T002 can run in parallel (Phase 1)
- T003 and T004 can run in parallel (Phase 2 — different files, no dependencies)
- T008, T009, T010, T012 can run in parallel AFTER T005–T007 are complete (they modify different aspects of engine.js, but touch the same file — ideally run sequentially to avoid merge conflicts)
- T013, T014 can run in parallel (Phase 9)

---

## Parallel Example: Phase 2 (Foundational)

```bash
# These two tasks can be worked on simultaneously since they are in different files:
Task T003: "Create writer authority module at main/sync/authority.js"
Task T004: "Create credential manager at main/sync/credentials.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001, T002)
2. Complete Phase 2: Foundational (T003, T004)
3. Complete Phase 3: User Story 1 (T005, T006, T007)
4. **STOP and VALIDATE**: Enable sync in `sync_config`, perform a write, verify DynamoDB item appears
5. Run `npm run lint && npm run test:smoke` to confirm nothing is broken

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1 (T005–T007) → Core push works → MVP!
3. Add US2 (T008) → Credential errors handled gracefully
4. Add US3 (T009) → Session-based role detection
5. Add US4 (T010) → Robust retry and error classification
6. Add US5 (T011) → Writer authority verified
7. Add US6 (T012) → Bulk placeholders fully handled
8. Polish (T013–T015) → Clean, lint-free, all tests passing

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group (e.g., T005+T006 together)
- Stop at any checkpoint to validate the story independently
- The tasks contain extensive inline code to enable a cheaper LLM to implement without needing to research patterns or read existing files
- All code follows project conventions: single quotes, 4-space indent, no trailing commas, semicolons, CommonJS modules
