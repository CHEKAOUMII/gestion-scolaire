# Implementation Plan: Integrity & Conflict Resolution (Phase 5)

**Branch**: `005-integrity-conflict-resolution` | **Date**: 2026-03-21 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-integrity-conflict-resolution/spec.md`

## Summary

Phase 5 hardens the DynamoDB sync system by adding three capabilities: (1) a periodic re-snapshot checker that detects database changes that bypassed the sync capture layer — backup restores, migrations, direct SQLite writes — and enqueues them for sync; (2) version-guarded cloud writes that use DynamoDB conditional expressions to reject stale pushes, making version conflicts observable; (3) a three-way field-level merge algorithm that auto-resolves non-overlapping changes and applies last-writer-wins for true conflicts, with enriched conflict logging for administrator review.

## Technical Context

**Language/Version**: JavaScript (Node.js, Electron main process)
**Primary Dependencies**: `better-sqlite3` (sync DB ops), `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb` (cloud writes/reads), existing sync modules (`capture.js`, `authority.js`, `credentials.js`, `engine.js`)
**Storage**: SQLite (local, WAL mode, single-connection singleton via `getDb()`)
**Testing**: `npm run test:smoke` (IPC parity, module integrity), `npm run lint` (ESLint flat config v9)
**Target Platform**: Windows desktop (Electron), school administration hardware (4GB RAM, HDD)
**Project Type**: Desktop app (Electron, multi-page HTML, vanilla JS, no bundler)
**Performance Goals**: Snapshot cycle completes in <60s for 17 tables × 10,000 rows; merge operations complete in <1ms per record
**Constraints**: Offline-capable, <512MB memory, no bundler, sync layer must be non-invasive (never modifies existing code paths)
**Scale/Scope**: ~10 schools × 3 PCs each, <10,000 rows per table per school year, 17 synced entity types

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Code Quality & Consistency | PASS | New files follow camelCase naming, 4-space indent, Prettier/ESLint. IPC channels use existing kebab-case `sync:*` namespace. DB columns use snake_case. |
| II. Testing Standards | PASS | No new IPC channels added → smoke test IPC parity unaffected. Migration uses `ensureColumn()` for idempotency. CI gate (`lint` → `css:build` → `test:smoke`) unchanged. |
| III. User Experience Consistency | N/A | Phase 5 is backend-only. No UI changes, no HTML pages, no renderer code. |
| IV. Good Practices & Architecture | PASS | No new IPC channels → three-file rule not triggered. Existing handlers use `handleRead`/`handleWrite`. No `require()` in renderer. Sync layer wraps existing code, never modifies it. |
| V. Performance Requirements | PASS | Snapshot checker uses fast pre-check (aggregate count) to skip unchanged tables. Row-level comparison only on drift. 10K rows × 17 tables feasible in <60s. Timer uses `.unref()` to avoid blocking shutdown. |
| Security & Data Integrity | PASS | Sensitive fields stripped by existing `stripSensitiveFields()`. No new secrets. Conflict log stores data snapshots (already sanitized). Version guards prevent silent overwrites. |
| Development Workflow | PASS | Feature branch `005-integrity-conflict-resolution`. Forward-only migration. No new npm dependencies. |

**Post-Phase-1 re-check**: All gates still pass. No new IPC channels, no bundler changes, no renderer code. The two new files (`snapshot.js`, `merge.js`) follow existing patterns in `main/sync/`.

## Project Structure

### Documentation (this feature)

```text
specs/005-integrity-conflict-resolution/
├── spec.md
├── plan.md                              # This file
├── research.md                          # Phase 0 output
├── data-model.md                        # Phase 1 output
├── quickstart.md                        # Phase 1 output
├── contracts/
│   └── integrity-conflict-resolution.md # Phase 1 output
├── checklists/
│   └── requirements.md                  # Spec quality checklist
└── tasks.md                             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
main/sync/
├── snapshot.js       ← NEW — re-snapshot checker (timer + cycle logic)
├── merge.js          ← NEW — pure three-way merge + checksum helper
├── engine.js         ← MODIFIED — version tracking in push, merge in pull
├── capture.js        ← UNCHANGED (reused by snapshot.js)
├── authority.js      ← UNCHANGED (reused by snapshot.js)
└── credentials.js    ← UNCHANGED

main/db/
└── migrations.js     ← MODIFIED — new migration 2026-03-033

main/ipc/
└── sync.js           ← MODIFIED — enriched responses, snapshot config

main.js               ← MODIFIED — start/stop snapshot background
```

**Structure Decision**: Two new files added to the existing `main/sync/` module directory. No new directories, no new IPC modules, no new HTML pages. This follows the established pattern of one module per concern within the sync subsystem.

## Key Research Findings

Full details in [research.md](./research.md). Critical decisions:

1. **Snapshot detection**: Row-level checksum comparison with fast aggregate pre-check (count-based). SQLite has no native hash functions, so checksums use deterministic string concatenation with FNV-1a hashing.

2. **Version guards**: Increment version per push via `sync_id_map.version`. Route all versioned writes through `writeItemWithCondition` (individual conditional puts). Currently dead code — `buildDynamoItem` hardcodes `version: 1`.

3. **Three-way merge**: Common ancestor stored in `sync_id_map.ancestor_data`. Merge compares each field against ancestor to classify as local-only, remote-only, both-same, or conflicting. Pure function in `merge.js` — no DB access, fully unit-testable.

4. **Coordination**: Snapshot defers if pull is in progress (boolean flag check). Pull does not defer for snapshot. Consistent with existing `_pullRunning`/`_flushRunning` pattern.

5. **No new IPC channels**: All Phase 5 functionality exposed through existing `sync:*` channels with additive response fields. No `preload.js` changes needed.

## Key Design Decisions

| Decision | Chosen | Rejected Alternative | Why |
|----------|--------|---------------------|-----|
| Checksum strategy | FNV-1a on sorted field values | SQLite triggers / WAL tracking | Non-invasive, works after backup restore |
| Version storage | `sync_id_map.version` column | Separate version table | Colocated with existing ID mapping, single lookup |
| Ancestor storage | `sync_id_map.ancestor_data` column | Separate ancestor table | Same record, atomic updates with version |
| Merge module | Pure function in `merge.js` | Inline in engine.js | Testable in isolation, single responsibility |
| Batch vs individual writes | Individual `PutCommand` for all versioned | `BatchWriteCommand` for v1, individual for v2+ | Batch doesn't support conditions; consistency |
| Snapshot coordination | Boolean flag check | Database lock / event system | Matches existing pattern, no complexity |

## Complexity Tracking

No constitution violations to justify. All design choices stay within established patterns.
