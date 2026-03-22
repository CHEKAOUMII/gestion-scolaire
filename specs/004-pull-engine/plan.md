# Implementation Plan: Pull Engine + IPC Channels

**Branch**: `004-pull-engine` | **Date**: 2026-03-21 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/004-pull-engine/spec.md`

## Summary

Complete the bi-directional DynamoDB sync loop by adding a pull engine that queries the cloud for remote changes and applies them to the local SQLite database, plus 6 IPC channels that expose sync status and configuration to the renderer. The pull engine extends `main/sync/engine.js` with a `pullRemoteChanges()` function that queries the `SyncGSI` index using a cursor-based pagination pattern, sorts items topologically to respect FK constraints, detects conflicts against pending outbox entries, and applies changes atomically in a single SQLite transaction. A new `main/ipc/sync.js` module registers 6 channels (`sync:getConfig`, `sync:setConfig`, `sync:getStatus`, `sync:triggerNow`, `sync:getConflictLog`, `sync:resolveConflict`) following the project's three-file IPC pattern. A new migration creates the `sync_conflicts` table and adds pull/push config columns.

## Technical Context

**Language/Version**: JavaScript (Node.js 18+, Electron)
**Primary Dependencies**: `@aws-sdk/lib-dynamodb` (QueryCommand), `@aws-sdk/client-dynamodb`, `better-sqlite3`, Electron IPC
**Storage**: SQLite via `better-sqlite3` (local), DynamoDB (cloud — read-only from pull perspective)
**Testing**: `npm run test:smoke` (IPC parity, module integrity, no CDN refs)
**Target Platform**: Windows (Electron desktop app)
**Project Type**: Desktop app (Electron)
**Performance Goals**: 500 records ingested in <30s, continuous 24h operation without leaks
**Constraints**: Offline-capable (pull fails gracefully), FK constraints enforced (`PRAGMA foreign_keys = ON`), single synchronous SQLite connection
**Scale/Scope**: 17 entity types, 6 new IPC channels, 1 new table, 1 migration, ~10 schools × 3 PCs

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution (`.specify/memory/constitution.md`) is a blank template with no project-specific principles defined. No gates to enforce. **PASS** — no violations possible.

**Post-Phase 1 re-check**: Still PASS — no constitution rules to violate.

## Project Structure

### Documentation (this feature)

```text
specs/004-pull-engine/
├── plan.md              # This file
├── spec.md              # Feature specification (6 user stories, 27 FRs)
├── research.md          # 10 research decisions
├── data-model.md        # Schema: sync_conflicts table, sync_config columns, migration
├── quickstart.md        # Developer onboarding and verification guide
├── contracts/
│   ├── pull-engine.md   # pullRemoteChanges() interface contract
│   └── sync-ipc.md      # 6 IPC channel specifications
├── checklists/
│   └── requirements.md  # Spec quality checklist (all items pass)
└── tasks.md             # (Phase 2 — created by /speckit.tasks)
```

### Source Code (repository root)

```text
main/
├── sync/
│   ├── engine.js          # EXTEND — add pullRemoteChanges(), pull lifecycle
│   ├── credentials.js     # UNCHANGED — shared by push and pull
│   ├── authority.js       # UNCHANGED — ENTITY_TYPE_REGISTRY used by pull
│   └── capture.js         # UNCHANGED — getDeviceHash() used by pull
├── ipc/
│   ├── sync.js            # NEW — 6 IPC channel handlers
│   ├── registerAll.js     # MODIFY — add registerSyncIpc()
│   └── ipc-helpers.js     # UNCHANGED
├── db/
│   ├── migrations.js      # MODIFY — add migration 032-pull-engine
│   └── schema.js          # UNCHANGED (sync_conflicts created via migration)
├── main.js                # MODIFY — add startSyncPullBackground() call

preload.js                 # MODIFY — add sync namespace (6 methods)

tests/
└── smoke.js               # UNCHANGED — auto-validates new channels via parity check
```

**Structure Decision**: Follows the existing Electron project layout. No new directories needed — the pull engine extends `main/sync/engine.js` (same file as push), and the IPC module follows the established `main/ipc/*.js` convention. This is the minimal-change approach consistent with Phases 1–3.

## Key Design Decisions

1. **Pull writes bypass sync capture** — Remote changes write directly via `getDb()`, not through IPC handlers, to avoid re-capturing synced data into the outbox (infinite loop).

2. **Topological sort for FK safety** — Pulled records are sorted parents-before-children for PUTs and children-before-parents for DELs, because `PRAGMA foreign_keys = ON` is enforced.

3. **Single global cursor** — The pull cursor (`sync_config.pull_cursor`) is a single `GSI1SK` value, not per-table. The DynamoDB GSI combines all entity types chronologically.

4. **Pre-loaded conflict Set** — All pending outbox `row_sync_id` values are loaded into an in-memory Set before the pull transaction for O(1) conflict detection.

5. **Last-writer-wins with logging** — Conflicts apply the remote version and log both snapshots to `sync_conflicts`. Phase 5 adds smarter field-level merge.

## Complexity Tracking

> No constitution violations to justify — constitution is blank template.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| N/A | — | — |
