# Quickstart: Push Engine

**Feature**: 003-push-engine
**Branch**: `003-push-engine`

## Prerequisites

1. **Phase 1 (Sync Foundation)** merged — sync tables exist, capture layer is active
2. **Phase 2 (AWS Infrastructure)** deployed — DynamoDB table, Cognito pool, Auth Lambda operational
3. Node.js 18+ (for native `fetch`)
4. Valid Pencil2 license key installed in the app

## Setup

```bash
# Switch to the feature branch
git checkout 003-push-engine

# Install AWS SDK dependencies
npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-cognito-identity

# Verify existing tests still pass
npm run lint
npm run test:smoke
```

## New Files

| File | Purpose |
|------|---------|
| `main/sync/engine.js` | Push engine: flush loop, DynamoDB item construction, batch writes |
| `main/sync/credentials.js` | Cognito credential manager: auth, cache, refresh |
| `main/sync/authority.js` | Writer authority matrix and role-check helpers |

## Modified Files

| File | Change |
|------|--------|
| `main.js` | Add `startSyncPushBackground()` call after `startOwnerSyncBackground()` |
| `main/db/migrations.js` | Add migration `2026-03-031-push-engine-config` for new `sync_config` columns |
| `package.json` | Add `@aws-sdk/*` production dependencies |

## Configuration

The push engine reads from the `sync_config` table (singleton row, `id = 1`). Key fields:

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `0` | Set to `1` to activate push |
| `sync_interval_minutes` | `10` | Push frequency in minutes |
| `auth_lambda_url` | NULL | Auth Lambda endpoint (e.g., `https://xyz.lambda-url.us-east-1.on.aws`) |
| `aws_region` | `us-east-1` | AWS region |
| `school_id` | NULL | School's `customerRef` (DynamoDB partition key) |
| `push_batch_size` | `100` | Max outbox entries per flush cycle |
| `max_retries` | `10` | Retries before marking entry as `failed` |

To enable sync manually (until Phase 6 UI exists):

```sql
UPDATE sync_config
SET enabled = 1,
    auth_lambda_url = 'https://your-lambda-url.on.aws',
    school_id = 'SCHOOL-001',
    aws_region = 'us-east-1'
WHERE id = 1;
```

## Testing

```bash
# Run all existing tests (must pass unchanged)
npm run lint
npm run test:smoke

# Manual verification
npm run dev
# → Perform a write operation (e.g., add a student)
# → Check sync_outbox table for a 'pending' entry
# → Wait for push interval (or reduce to 1 minute for testing)
# → Verify entry status changes to 'sent'
# → Check DynamoDB table via AWS console for the item
```

## Architecture

```
main.js
  └── startSyncPushBackground()
        └── setInterval(flushSyncOutbox, interval)
              │
              ├── getCredentials()           ← credentials.js
              │     ├── POST /auth           ← Auth Lambda
              │     └── getCredentialsForIdentity()  ← Cognito
              │
              ├── SELECT FROM sync_outbox WHERE status = 'pending'
              │
              ├── canPush(table, role)        ← authority.js
              │
              ├── expandBulkPlaceholders()   ← for _bulk: true entries
              │
              ├── constructDynamoDBItem()    ← PK/SK/GSI/envelope
              │
              └── BatchWriteItem / PutItem   ← DynamoDB
                    ├── success → status = 'sent'
                    └── failure → retries++, last_error
```

## Key Patterns

- **Re-entrancy guard**: `_flushRunning` boolean mutex in `try/finally` — prevents overlapping flush cycles
- **Timer lifecycle**: `start/stop/restart` trio with `.unref()` — matches `ownerSync.js` pattern
- **Credential caching**: In-memory only, refreshed at 50 minutes, cleared on auth failure
- **Writer authority**: Client-side role check before push (defense-in-depth with IAM server-side enforcement)
- **Batch processing**: 25-item DynamoDB batches, 100-entry-per-cycle cap, chronological ordering
