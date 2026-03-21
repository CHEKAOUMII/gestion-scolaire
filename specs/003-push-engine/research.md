# Research: Push Engine

**Feature**: 003-push-engine
**Date**: 2026-03-21
**Status**: Complete

## R1 — Outbox Flush Pattern (from ownerSync.js)

**Decision**: Model the push engine's flush loop on the established `flushOwnerSyncOutbox()` pattern in `main/licensing/ownerSync.js`.

**Rationale**: The ownerSync module is the only existing background outbox flusher in the project. It is battle-tested, follows all project conventions (`.unref()` timers, re-entrancy guard, silent error handling), and the team is familiar with it. Replicating its structure minimizes risk.

**Key patterns to carry forward**:
- Module-level `_syncTimer` and `_flushRunning` boolean mutex
- `try/finally` to always reset `_flushRunning`
- Increment `retries` and stamp `last_attempt_at` **before** the network call (crash-safe accounting)
- Mark `status = 'sent'` and `sent_at` on success; write `last_error` on failure without changing status
- `void flushSyncOutbox()` (fire-and-forget, no `await` on the interval callback)
- `setInterval(...).unref()` to avoid blocking Electron exit
- `start/stop/restart` lifecycle trio

**Differences from ownerSync**:
- Push engine sends to DynamoDB (AWS SDK `BatchWriteItem`) instead of an HTTP endpoint
- Push engine must batch items (25-item DynamoDB limit) vs ownerSync's one-at-a-time HTTP POSTs
- Push engine adds writer authority checks and bulk placeholder expansion before sending
- Push engine uses a max-retry dead-letter threshold (10 retries → `status = 'failed'`) — ownerSync retries forever

**Alternatives considered**:
- Custom event-driven architecture (EventEmitter + queue) — rejected as over-engineered for periodic batch processing
- Worker thread for push operations — rejected because `better-sqlite3` is not thread-safe and the main thread is sufficient for periodic batch I/O

## R2 — AWS SDK v3 Integration

**Decision**: Add `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, and `@aws-sdk/client-cognito-identity` as production dependencies.

**Rationale**: AWS SDK v3 is modular — only the needed clients are installed, keeping the bundle size small. The `lib-dynamodb` package provides the `DynamoDBDocumentClient` which handles automatic marshalling/unmarshalling of JavaScript objects to DynamoDB's native attribute format.

**Key integration points**:
- `DynamoDBDocumentClient` wraps `DynamoDBClient` for simplified item operations
- `BatchWriteCommand` for batched puts/deletes (25-item limit per call)
- `CognitoIdentityClient` + `GetCredentialsForIdentityCommand` for credential exchange
- Credentials are passed as `{ accessKeyId, secretAccessKey, sessionToken }` to the DynamoDB client constructor

**Alternatives considered**:
- AWS SDK v2 (monolithic `aws-sdk`) — rejected due to larger bundle size and AWS deprecation timeline
- Direct HTTP calls to DynamoDB REST API — rejected as too complex (requires Signature v4 signing)
- Vendoring the SDK in `vendor/` — rejected because AWS SDK v3 has many transitive dependencies; npm install is the right approach per Constitution IV (vendor isolation applies to frontend libraries loaded in the renderer, not Node.js main-process dependencies)

## R3 — Credential Management Flow

**Decision**: Two-step credential acquisition: (1) POST to Auth Lambda → receive OIDC token, (2) call `getCredentialsForIdentity()` → receive temporary AWS credentials.

**Rationale**: This is the standard Cognito Developer Authenticated Identities flow defined in Phase 2's contracts. The Auth Lambda validates the license key server-side and returns a Cognito OIDC token. The Electron app then exchanges this token for temporary AWS credentials (access key, secret key, session token) that are scoped to the school's DynamoDB partition.

**Credential lifecycle**:
- Credentials expire after 60 minutes (Cognito token duration)
- Refresh proactively at 50 minutes (10-minute safety margin)
- Cache in module-level variables: `_cachedCredentials`, `_credentialExpiresAt`
- On refresh failure: log error, skip flush cycle, retry on next interval
- Auth Lambda endpoint URL stored in `sync_config` table

**Auth Lambda request format** (from Phase 2 contract):
```
POST /auth
{ "licenseKey": "GSLK-<payload>.<signature>", "deviceHash": "<64-char-hex>" }
→ { "identityId": "...", "token": "...", "schoolId": "...", "expiresAt": ... }
```

**Alternatives considered**:
- Cognito User Pools with username/password — rejected (no user accounts exist for schools)
- API Gateway with API keys — rejected (lacks partition-level isolation)
- Direct IAM access keys per school — rejected (hard to rotate securely)

## R4 — DynamoDB Item Construction

**Decision**: Use the single-table design and entity type registry from Phase 2's DynamoDB schema contract.

**Rationale**: The table schema (`pencil2-sync`), key patterns, GSI, and entity type registry are already defined and deployed. The push engine must construct items exactly per this contract.

**Item envelope** (all fields required on every PutItem):
```
PK:         SCHOOL#<customerRef>
SK:         <ENTITY_TYPE>#<compositeId>
GSI1PK:     SCHOOL#<customerRef>
GSI1SK:     <updatedAt>#<entityType>#<entityId>
entityType: <lowercase-entity-name>
schoolYear: <year/year>
updatedAt:  <unix-epoch-seconds>
version:    <monotonic-integer>
operation:  PUT | DEL
rowSyncId:  <deviceHash>:<table_name>:<local_id>
deviceHash: <first-16-chars-of-device-hash>
data:       { ... }  (full row JSON, sensitive fields stripped)
expiresAt:  <unix-epoch-seconds>  (TTL)
```

**Conditional write expression**: `attribute_not_exists(version) OR version < :newVersion`

**Entity type → SK pattern mapping**: 17 entity types defined in Phase 2 contract (students, grades, absences, teachers, etc.)

**Version strategy**: For each outbox entry, query DynamoDB for the current version of the item (if it exists), then write with `version = currentVersion + 1`. For new items, start at version 1.

**Alternatives considered**:
- Separate tables per entity type — rejected (single-table is the Phase 2 decision)
- Using `TransactWriteItems` instead of `BatchWriteItem` — rejected (transactions have a 100-item limit and higher cost; conditional writes on individual items are sufficient)

## R5 — Writer Authority Enforcement

**Decision**: Enforce writer authority client-side before push, using a static table-to-roles mapping that mirrors the project's Writer Authority Matrix.

**Rationale**: The Writer Authority Matrix is defined in the executive summary and design document. Client-side enforcement prevents unauthorized data from being sent to DynamoDB, saving network bandwidth and avoiding IAM-level rejections. Server-side enforcement via IAM `dynamodb:LeadingKeys` provides defense-in-depth.

**Authority matrix** (from executive summary):
| Tables | Allowed Roles |
|--------|--------------|
| `students`, `correspondence`, `student_files`, `student_movements` | `admin` |
| `grades`, `absences` | `admin`, `staff` |
| `teachers`, `teacher_aliases`, `staff_attendance`, `compensation_tracking`, `teacher_absences` | `admin` |
| `exams`, `exam_proctors`, `exam_rooms`, `tests` | `admin` |
| `settings`, `page_visibility` | `admin` |

**Implementation**: A static `WRITER_AUTHORITY` map keyed by table name, values are arrays of allowed roles. Before pushing each outbox entry, check `WRITER_AUTHORITY[entry.table_name].includes(currentRole)`. Skip entries that fail the check with a log message.

**Role source**: `getSessionByEvent(event)` from `main/ipc/auth.js` — but the push engine runs as a background process without an IPC event. Instead, read the current session from the in-memory session map, or store the role in `sync_config` at login time.

**Alternatives considered**:
- Server-side only enforcement — rejected (wastes bandwidth, creates confusing DynamoDB errors)
- Per-channel authority (instead of per-table) — rejected (tables are the natural DynamoDB unit)

## R6 — Bulk Placeholder Expansion

**Decision**: Detect `_bulk: true` outbox entries and expand them by querying current row state from local SQLite before pushing.

**Rationale**: Phase 1's capture layer uses `recordBulkSummary()` for complex extractors (`inputArray`, `preQuery`, `preQuery+bulk`, `queryMatch`, `lastInsertRowid+conditional`). These write a single placeholder with `{ _bulk: true, channel, args_summary }`. The push engine cannot send these to DynamoDB directly — they must be expanded into individual per-row entries.

**Expansion strategy**:
1. Parse `row_data` JSON, detect `_bulk: true`
2. Extract `table_name` and `channel` from the placeholder
3. Look up the channel in `CHANNEL_REGISTRY` to determine which tables and rows were affected
4. Query those rows from the local database (by table name, filtered by school year)
5. For each row, call `ensureSyncIdMapping()` to get/create its `row_sync_id`
6. Create individual DynamoDB items and batch-write them
7. Mark the original placeholder as `sent`

**Edge cases**:
- Rows deleted between capture and expansion → skip silently
- Table schema changes between capture and expansion → use current schema (push engine always sends current state)

**Alternatives considered**:
- Fix Phase 1 capture to always produce per-row entries — rejected (some extractors genuinely cannot determine individual row IDs at capture time)
- Defer bulk handling to Phase 5 integrity checker — rejected (data would be delayed indefinitely)

## R7 — Startup Hook Placement

**Decision**: Add `startSyncPushBackground()` call in `main.js` after `startOwnerSyncBackground()` at line ~170.

**Rationale**: This follows the established pattern. Background services start after database initialization and IPC registration, inside the `app.whenReady()` callback. The push engine reads `sync_config` to decide whether to start — if `enabled = 0`, it returns immediately.

**Shutdown**: Use `.unref()` on the interval timer. No explicit shutdown hook needed — the timer will not prevent `app.quit()`. Optionally, call `stopSyncPushBackground()` in `app.on('will-quit')` for clean logging.

## R8 — sync_config Schema Extension

**Decision**: Add push-specific columns to the `sync_config` table via a new migration.

**Rationale**: The Phase 1 `sync_config` table has basic fields (`enabled`, `sync_interval_minutes`, `device_hash`, `device_name`, `school_id_hash`, `retention_days`). The push engine needs additional fields for Auth Lambda endpoint, AWS region, last push timestamps, and error tracking.

**New columns** (added via `ensureColumn` in a new migration):
| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `auth_lambda_url` | TEXT | NULL | Auth Lambda endpoint URL |
| `aws_region` | TEXT | `'us-east-1'` | AWS region for DynamoDB and Cognito |
| `last_push_at` | DATETIME | NULL | Timestamp of last successful push |
| `last_push_error` | TEXT | NULL | Last push error message |
| `push_batch_size` | INTEGER | 100 | Max entries per flush cycle |
| `max_retries` | INTEGER | 10 | Max retry count before marking as `failed` |
| `school_id` | TEXT | NULL | The `customerRef` from the license key (used as DynamoDB partition) |

**Alternatives considered**:
- Separate `sync_push_config` table — rejected (single config row pattern is already established)
- Store config in `.env` — rejected (sync config is per-installation and managed through the UI in Phase 6)
