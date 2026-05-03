# DynamoDB Sync Integration — Executive Summary

**Project:** Pencil2 (Gestion Scolaire)
**Date:** 2026-03-20
**Status:** Approved
**Development Method:** Spec-Driven Development (Spec Kit)

---

## The Problem

Each school PC runs its own isolated SQLite database. Schools with multiple PCs (admin office, teacher rooms, computer labs) have no automatic way to share data. Staff must manually export/import backup files to keep machines in sync — a slow, error-prone process that results in stale and conflicting data across the school.

## The Solution

Integrate **AWS DynamoDB** as a cloud synchronization layer that automatically keeps all school PCs in sync, while preserving the app's fully offline capability.

## How It Works

```
  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
  │  PC-1       │     │  PC-2       │     │  PC-3       │
  │  (Admin)    │     │  (Staff)    │     │  (Lab)      │
  │             │     │             │     │             │
  │  SQLite DB  │     │  SQLite DB  │     │  SQLite DB  │
  │      │      │     │      │      │     │      │      │
  │  Sync Engine│     │  Sync Engine│     │  Sync Engine│
  └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
                    ┌────────▼────────┐
                    │   AWS DynamoDB  │
                    │  (Single Table) │
                    │                 │
                    │  Cognito Auth   │
                    └─────────────────┘
```

### Key Characteristics

| Aspect | Decision |
|--------|----------|
| **Primary data store** | Local SQLite (unchanged) — app never blocks on network |
| **Sync direction** | Bi-directional: push local changes, pull remote changes |
| **Sync frequency** | Automatic every 5–15 minutes (configurable) |
| **Write permissions** | Role-based — admin writes most data, staff writes grades/absences |
| **Conflict handling** | Last-writer-wins with version guards (conflicts are rare by design) |
| **Offline behavior** | Full functionality — changes queue up and sync when internet returns |
| **Data scope** | All domains: students, teachers, grades, exams, settings, etc. |

### Cost

| AWS Service | Monthly Cost |
|-------------|-------------|
| DynamoDB (on-demand) | ~$5 for 10 schools × 3 PCs |
| Cognito Identity Pool | Free (< 50,000 users) |
| Auth Lambda | Free tier |
| **Total** | **< $10/month** |

---

## Implementation Phases

Each phase follows a complete Spec Kit cycle:
`speckit.specify` → `speckit.plan` → `speckit.tasks` → `speckit.implement`

---

### Phase 1 — Sync Foundation

**Goal:** Lay the database and change-capture groundwork.

**Deliverables:**
- New SQLite tables: `sync_outbox`, `sync_id_map`, `sync_config`, `sync_pull_state`
- IPC interception capture layer (`main/sync/capture.js`) — wraps existing write handlers to automatically record changes to the sync outbox
- Channel-to-table registry mapping all ~40 write IPC channels

**Key files:**
- `main/db/migrations.js` — new migration for sync tables
- `main/db/schema.js` — sync table DDL
- `main/sync/capture.js` — new file
- `main/ipc/registerAll.js` — apply capture wrappers

**Why first:** Everything else depends on having the outbox and capture layer in place. No AWS account needed yet — purely local work.

---

### Phase 2 — AWS Infrastructure

**Goal:** Set up the cloud backend.

**Deliverables:**
- DynamoDB table `pencil2-sync` with partition/sort keys and GSI for pull queries
- Cognito Identity Pool for secure, per-school credential issuance
- Auth Lambda function that validates license keys and returns temporary credentials
- IAM role scoped to restrict each school to its own data partition
- Infrastructure-as-code template (CloudFormation or Terraform)

**Why second:** The cloud backend must exist before the sync engine can push/pull data.

---

### Phase 3 — Push Engine

**Goal:** Send local changes to DynamoDB.

**Deliverables:**
- Cognito credential manager (`main/sync/credentials.js`) — caches and refreshes temporary AWS credentials every 50 minutes
- Outbox flusher in `main/sync/engine.js` — reads pending outbox rows, batches into DynamoDB `BatchWriteItem` calls, advances high-water mark
- AWS SDK v3 vendor bundle (`@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-cognito-identity`)
- Lifecycle hooks in `main.js` — start/stop sync background process

**Key files:**
- `main/sync/engine.js` — new file (modeled on `main/licensing/ownerSync.js`)
- `main/sync/credentials.js` — new file
- `main.js` — add `startSyncBackground()` call

**Why third:** Push before pull — data must flow to DynamoDB before other PCs can receive it.

---

### Phase 4 — Pull Engine + IPC Channels

**Goal:** Receive remote changes and expose sync status to the UI.

**Deliverables:**
- Pull/ingest engine — queries DynamoDB GSI for changes since last pull, translates sync IDs via `sync_id_map`, applies to local SQLite in a transaction
- 6 new IPC channels: `sync:getConfig`, `sync:setConfig`, `sync:getStatus`, `sync:triggerNow`, `sync:getConflictLog`, `sync:resolveConflict`
- `preload.js` additions under a `sync: { ... }` namespace

**Key files:**
- `main/sync/engine.js` — extend with `pullRemoteChanges()`
- `main/ipc/sync.js` — new file
- `preload.js` — add sync namespace
- `main/ipc/registerAll.js` — register sync module

**Why fourth:** With push working, pull completes the sync loop. IPC channels let the renderer observe sync status.

---

### Phase 5 — Integrity & Conflict Resolution

**Goal:** Catch edge cases and handle conflicts gracefully.

**Deliverables:**
- Periodic re-snapshot checker (`main/sync/snapshot.js`) — runs every 30 minutes, compares local table checksums against last synced state, enqueues any missed changes
- Conflict detection: conditional DynamoDB writes reject stale versions
- Conflict log storage in local `sync_conflicts` table
- Auto-resolution: field-level merge for non-overlapping changes, last-writer-wins for overlapping

**Why fifth:** The happy path (phases 1–4) must work before investing in edge-case handling. Re-snapshot catches migrations, backup restores, and any direct SQLite writes.

---

### Phase 6 — Sync Settings UI

**Goal:** Give administrators visibility and control over synchronization.

**Deliverables:**
- New HTML page: `sync-settings.html`
- New JS module: `js/pages/sync-settings.js`
- Sync configuration panel: enable/disable, interval, AWS credentials
- Live sync status display: last push/pull times, pending count, errors
- Conflict log viewer (admin-only) with accept-local/accept-remote actions
- Sidebar sync indicator (connected / syncing / offline / error)
- Manual "Sync Now" button

**Why last:** UI is the final layer — it depends on all underlying sync infrastructure being functional.

---

## Writer Authority Matrix

| Data Domain | Who Can Write |
|-------------|--------------|
| Students, correspondence, files, movements | Admin only |
| Grades, absences | Admin + Staff |
| Teachers, staff attendance, compensation | Admin only |
| Exams, scheduling, school events | Admin only |
| Settings, identity, users, notifications | Admin only |

All PCs can **read** everything. Write restrictions are enforced both client-side (before push) and via DynamoDB conditional expressions.

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Internet outage | Offline-first: app works fully on local SQLite, outbox queues changes |
| Data conflicts | Designated writers reduce conflict surface; conditional writes prevent stale overwrites |
| AWS cost spike | On-demand pricing with TTL auto-cleanup; predictable low-volume school workloads |
| Schema migrations break sync | Re-snapshot layer detects and re-syncs drift every 30 minutes |
| Compromised credentials | Cognito temp credentials are per-school scoped, expire in 60 minutes |
| Existing functionality breaks | Sync layer wraps existing code — never modifies it. Disabling sync restores original behavior |

---

## Success Criteria

1. A grade entered on PC-A appears on PC-B within 15 minutes without manual intervention
2. App works identically when offline — no errors, no blocked operations
3. Smoke tests pass (`npm run test:smoke`) with all new IPC channels
4. Monthly AWS cost stays under $10 for 10-school deployment
5. Admin can view sync status, trigger manual sync, and resolve conflicts from the UI
