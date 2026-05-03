# DynamoDB Sync Integration — Design Document

**Date:** 2026-03-20
**Status:** Approved
**Approach:** IPC Interception + Cognito Direct SDK + Single-Table DynamoDB

## Problem

Pencil2 is a fully offline, single-machine Electron app. Each school PC has its own isolated SQLite database with no data sharing. Schools with multiple PCs (admin office, teacher rooms, labs) must manually transfer data via backup/restore JSON files. This is error-prone, slow, and results in stale data across machines.

## Goal

Enable seamless, automatic data synchronization across all PCs within a school using AWS DynamoDB as the cloud sync layer, while preserving the app's offline-first behavior.

## Key Decisions

| Decision | Choice |
|----------|--------|
| Sync topology | Read-replica + designated writers (role-based write permissions) |
| Offline behavior | Offline-first — SQLite is primary store, DynamoDB is sync layer |
| Data scope | All domains (students, teachers, exams, settings, everything) |
| Sync frequency | Periodic batch every 5-15 minutes |
| DynamoDB design | Single-table, on-demand capacity |
| Credential management | Cognito Identity Pool + auth Lambda |

## Architecture Overview

```
PC-1 (admin)  ──┐
PC-2 (staff)  ──┼── sync engine ──> DynamoDB (single table)
PC-3 (lab)    ──┘                     │
                                      └── Cognito (auth)
                                      └── Lambda (credential issuer)
```

Each PC runs a local sync engine that:
1. Captures changes via IPC interception (wrapping existing handleWrite)
2. Queues them in a local `sync_outbox` table
3. Periodically flushes the outbox to DynamoDB (push)
4. Periodically queries DynamoDB for changes from other PCs (pull)
5. Applies remote changes to local SQLite

## Two-Layer Change Detection

### Layer 1: IPC Interception (real-time)

A `wrapWithSyncCapture()` function wraps existing IPC write handlers at registration time in `registerAll.js`. The wrapper records changes to the `sync_outbox` after each successful write. Existing handler code is NOT modified — it is wrapped.

### Layer 2: Periodic Re-Snapshot (integrity net, every 30 min)

A background task compares local table row counts and checksum proxies against the last known synced state. Catches changes from migrations, backup restores, and any direct SQLite writes that bypass IPC.

## Global Row Identity (No Schema Changes)

Instead of adding UUID columns to every table (which would require heavy recreate-table migrations), use a composite key:

```
row_sync_id = "{deviceHash}:{table_name}:{local_integer_id}"
```

A local `sync_id_map` table translates between global sync IDs and local integer IDs:

```sql
CREATE TABLE sync_id_map (
    row_sync_id  TEXT PRIMARY KEY,
    table_name   TEXT NOT NULL,
    local_id     INTEGER NOT NULL,
    UNIQUE(table_name, local_id)
);
```

## DynamoDB Single-Table Design

**Table:** `pencil2-sync` (on-demand capacity mode)

| Attribute | Purpose | Example |
|-----------|---------|---------|
| PK | School + year | `SCH#a1b2c3d4#2025/2026` |
| SK | Table + entity | `T#students#E#devhash:students:42` |
| data | Full row JSON | `{"code":"M001","full_name":"..."}` |
| op | Operation | `PUT` or `DEL` |
| ver | Version (monotonic) | `3` |
| wdev | Writer device hash | `a1b2c3d4e5f6` |
| wrole | Writer role | `admin` |
| sat | Synced-at timestamp | `2026-03-20T14:30:00Z` |
| ttl | DynamoDB TTL epoch | `1798761600` |

**GSI1** (pull queries — "what changed since timestamp T?"):
- GSI1PK = PK
- GSI1SK = `sat`

## Writer Authority Matrix

| Data Domain | Allowed Roles |
|-------------|--------------|
| students, correspondence, student_files, student_movements | `admin` |
| grades, absences | `admin`, `staff` |
| teachers, teacher_absences, teacher_aliases, staff_attendance, compensation | `admin` |
| exams, exam_proctors, exam_rooms, tests, school_events | `admin` |
| settings, school_identity, users, page_visibility, notifications | `admin` |

## Conflict Resolution

- **Conditional writes:** `attribute_not_exists(ver) OR ver < :newVer`
- **Same-field conflicts:** Last-writer-wins (acceptable since typically 1 admin PC per school)
- **Delete handling:** Tombstone items with `op = 'DEL'` and 90-day TTL

## AWS Credential Management

1. Cognito Identity Pool (unauthenticated mode or custom developer provider)
2. Auth Lambda: receives `license_key_hash` + `deviceHash`, validates, returns Cognito identity + temp credentials
3. IAM role scoped via `dynamodb:LeadingKeys` condition to restrict access to the school's data partition
4. Credentials cached in-memory, refreshed every 50 minutes

## New Files

| File | Purpose |
|------|---------|
| `main/sync/engine.js` | Core sync engine (push/pull, modeled on ownerSync.js) |
| `main/sync/capture.js` | IPC interception layer + channel registry |
| `main/sync/credentials.js` | Cognito credential management |
| `main/sync/snapshot.js` | Periodic re-snapshot integrity checker |
| `main/ipc/sync.js` | Sync IPC channels (getConfig, setConfig, status, triggerNow) |

## New IPC Channels

```
sync:getConfig       — handleRead: returns sync config
sync:setConfig       — handleWrite(['admin']): update sync config
sync:getStatus       — handleRead: returns pending count, last sync times, errors
sync:triggerNow      — handleWrite(['admin']): manual sync trigger
sync:getConflictLog  — handleRead: returns conflicts for admin review
sync:resolveConflict — handleWrite(['admin']): accept local or remote version
```

## New SQLite Tables

```sql
sync_outbox       — change event queue (mirrors owner_sync_outbox pattern)
sync_id_map       — global-to-local row ID translation
sync_config       — sync configuration (enabled, interval, credentials)
sync_pull_state   — per-table high-water marks for pull
```

## Cost Estimate

- DynamoDB on-demand: ~$5/month for 10 schools × 3 PCs
- Cognito: free (< 50,000 MAU)
- Auth Lambda: effectively free tier
- Total: < $10/month for a typical deployment

## Implementation Phases (Spec Kit)

Each phase gets its own Spec Kit specification cycle.

| Phase | Deliverable |
|-------|------------|
| 1 | Schema migration: sync tables + IPC interception capture layer |
| 2 | AWS infrastructure: DynamoDB table, Cognito pool, auth Lambda |
| 3 | Sync engine: push (outbox flusher) + credential management |
| 4 | Sync engine: pull/ingest + sync IPC channels |
| 5 | Re-snapshot integrity checker + conflict resolution |
| 6 | Sync settings UI page + conflict log viewer |
