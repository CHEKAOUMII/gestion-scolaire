# Quickstart: Pull Engine + IPC Channels

**Feature**: 004-pull-engine
**Date**: 2026-03-21

## Prerequisites

- Phase 1 (sync foundation) merged — `sync_outbox`, `sync_id_map`, `sync_config`, `sync_pull_state` tables exist
- Phase 2 (AWS infrastructure) deployed — DynamoDB `pencil2-sync` table with `SyncGSI` index, Cognito Identity Pool, Auth Lambda
- Phase 3 (push engine) merged — `main/sync/engine.js`, `main/sync/credentials.js`, `main/sync/authority.js` exist
- Node 18+, valid license key, AWS credentials accessible via Auth Lambda

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      main.js                             │
│  app.whenReady() →                                       │
│    startSyncPushBackground()   (Phase 3)                 │
│    startSyncPullBackground()   (Phase 4 — NEW)           │
└──────────────┬───────────────────────────┬───────────────┘
               │                           │
    ┌──────────▼──────────┐     ┌──────────▼──────────┐
    │  Push Engine        │     │  Pull Engine         │
    │  (flushSyncOutbox)  │     │  (pullRemoteChanges) │
    │  ┌───────────────┐  │     │  ┌───────────────┐   │
    │  │ sync_outbox   │──┼──►  │  │ SyncGSI Query │   │
    │  │ → DynamoDB    │  │     │  │ → Local DB    │   │
    │  └───────────────┘  │     │  └───────────────┘   │
    └─────────────────────┘     └──────────────────────┘
               │                           │
               │    ┌──────────────────┐   │
               └───►│  credentials.js  │◄──┘
                    │  (shared)        │
                    └──────────────────┘

┌──────────────────────────────────────────────────────────┐
│  Renderer (any page)                                     │
│  window.api.sync.getStatus()                             │
│  window.api.sync.getConfig()                             │
│  window.api.sync.setConfig(updates)      ← admin only   │
│  window.api.sync.triggerNow()            ← admin only   │
│  window.api.sync.getConflictLog(opts)                    │
│  window.api.sync.resolveConflict(payload)← admin only   │
└──────────────────────────────────────────────────────────┘
```

## Pull Cycle Flow

```
1. Timer fires (or sync:triggerNow called)
2. Re-entrancy guard check
3. Read sync_config → get pull_cursor, schoolId
4. getCredentials() → temporary AWS credentials
5. Query SyncGSI: GSI1PK = SCHOOL#<schoolId>, GSI1SK > <cursor>
   └─ Paginate via LastEvaluatedKey (500 items/page)
6. Filter: skip records where deviceHash matches local device
7. Pre-load pending outbox row_sync_ids → conflict Set
8. Sort: topological order (parents before children)
9. SQLite transaction:
   ├─ For each PUT with conflict   → log to sync_conflicts, apply remote
   ├─ For each PUT (new record)    → INSERT + create sync_id_map entry
   ├─ For each PUT (existing)      → UPDATE via local_id from sync_id_map
   ├─ For each DEL (exists locally)→ DELETE row (keep sync_id_map tombstone)
   └─ For each DEL (not found)     → skip (idempotent)
10. Update sync_config: pull_cursor, last_pull_at, last_pull_error
11. Update sync_pull_state per affected table
```

## Key Files

| File | Role | Status |
|------|------|--------|
| `main/sync/engine.js` | Pull engine (`pullRemoteChanges`, lifecycle) | EXTEND |
| `main/ipc/sync.js` | 6 IPC channel handlers | NEW |
| `main/ipc/registerAll.js` | Register `registerSyncIpc` | MODIFY |
| `preload.js` | Add `sync` namespace (6 methods) | MODIFY |
| `main/db/migrations.js` | Migration `032-pull-engine` | MODIFY |
| `main.js` | Add `startSyncPullBackground()` call | MODIFY |

## Verification

### 1. Run smoke tests
```bash
npm run test:smoke
```
All 6 new IPC channels must pass the parity check.

### 2. Enable sync (manual SQL for testing)
```sql
UPDATE sync_config SET
  enabled = 1,
  auth_lambda_url = 'https://YOUR_LAMBDA.execute-api.us-east-1.amazonaws.com/prod/auth',
  aws_region = 'us-east-1',
  school_id = 'YOUR_SCHOOL_ID'
WHERE id = 1;
```

### 3. Verify pull engine starts
Launch the app. Check the main process console for pull engine log messages. The first pull should fetch all existing remote records.

### 4. Test IPC channels from renderer console
```js
// Check sync status
await window.api.sync.getStatus()

// Check config
await window.api.sync.getConfig()

// Trigger manual sync (admin only)
await window.api.sync.triggerNow()

// View conflict log
await window.api.sync.getConflictLog({ status: 'all', limit: 10 })
```

### 5. End-to-end sync test
1. On PC-A: Add a student record → wait for push to complete
2. On PC-B: Wait for next pull cycle (or call `triggerNow()`)
3. Verify the student appears in PC-B's database

## Important Design Decisions

1. **Pull writes bypass sync capture** — Remote changes write directly to the DB via `getDb()`, NOT through IPC handlers. This prevents re-capturing synced data back into the outbox (infinite loop).

2. **FK ordering** — Pulled records are sorted topologically before applying (parents before children for PUTs, reverse for DELs) because `PRAGMA foreign_keys = ON`.

3. **Single global cursor** — The pull cursor is a single `GSI1SK` value in `sync_config.pull_cursor`, not per-table. The DynamoDB GSI combines all entity types chronologically.

4. **Conflict = pending outbox + incoming remote** — If a record has a pending local change AND a remote update arrives, both are preserved in `sync_conflicts`. The remote version is applied (last-writer-wins). Phase 5 will add smarter merge.
