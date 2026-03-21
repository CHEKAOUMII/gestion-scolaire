# Implementation Plan: Sync Foundation

**Branch**: `001-sync-foundation` | **Date**: 2026-03-21 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-sync-foundation/spec.md`

## Summary

Add a transparent IPC interception layer that captures every data-modifying operation into a local `sync_outbox` table, along with four new SQLite tables (`sync_outbox`, `sync_id_map`, `sync_config`, `sync_pull_state`) and a channel-to-table registry mapping all 47 write IPC channels. This is Phase 1 of the DynamoDB sync integration — purely local work with no AWS dependencies. The capture layer wraps existing handlers externally without modifying any handler code, and the smoke test is extended to validate registry completeness.

## Technical Context

**Language/Version**: JavaScript (Node.js, Electron main process)
**Primary Dependencies**: `better-sqlite3` (synchronous SQLite), `crypto` (SHA-256 for device hash), existing `deviceFingerprint.js` module
**Storage**: SQLite — 4 new tables added via migration 030
**Testing**: `npm run test:smoke` (extended with registry validation)
**Target Platform**: Windows (Electron desktop app)
**Project Type**: Desktop app (Electron, main process only — no renderer changes in Phase 1)
**Performance Goals**: <50ms overhead per write operation for capture layer
**Constraints**: Offline-first, no network dependencies, no new npm packages, must not break existing 47 write channels
**Scale/Scope**: 47 write IPC channels across 8 handler files, ~15 database tables affected

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                 | Status | Notes                                                                                                                                                                           |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I. Code Quality**       | PASS   | New code follows camelCase (JS), snake_case (DB columns), kebab-case (IPC channels). Single responsibility: `main/sync/capture.js` handles one domain. No dead code introduced. |
| **II. Testing Standards** | PASS   | Smoke test extended with registry validation. Migration uses idempotent patterns. IPC parity maintained (no new IPC channels in Phase 1).                                       |
| **III. UX Consistency**   | PASS   | No UI changes in Phase 1. Capture layer is invisible to users.                                                                                                                  |
| **IV. Architecture**      | PASS   | IPC contract unchanged. Three-file rule not triggered (no new IPC channels). Handler wrappers used correctly. `school_year` included as partition key. No bundler introduced.   |
| **V. Performance**        | PASS   | Device hash cached at module scope (avoids 4.5s subprocess calls per write). Outbox writes are single INSERT statements. 7-day retention cleanup prevents unbounded growth.     |
| **Security**              | PASS   | Sensitive fields (`password_hash`, `pin_hash`) stripped from outbox serialization. No secrets in code. No new `.env` variables.                                                 |
| **Workflow**              | PASS   | Feature branch `001-sync-foundation`. Migration appended as version `2026-03-030-sync-foundation`. No new npm dependencies.                                                     |

**Post-Phase 1 re-check**: All gates remain PASS. The design adds one new file (`main/sync/capture.js`) and modifies three existing files (`migrations.js`, `registerAll.js`, `smoke.js`) — all within established patterns.

## Project Structure

### Documentation (this feature)

```text
specs/001-sync-foundation/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0: research findings (10 decisions)
├── data-model.md        # Phase 1: 4 table schemas + registry structure
├── quickstart.md        # Phase 1: verification guide
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
main/
├── sync/
│   └── capture.js           # NEW — IPC interception layer
│       ├── CHANNEL_REGISTRY  #   Channel-to-table mapping (47 entries)
│       ├── wrapWithSyncCapture()  #   Handler wrapper function
│       ├── recordOutboxEntry()    #   Outbox INSERT logic
│       ├── ensureSyncIdMapping()  #   sync_id_map upsert
│       ├── stripSensitiveFields() #   Blocklist-based field removal
│       ├── getDeviceHash()        #   Cached device fingerprint
│       ├── startOutboxCleanup()   #   Retention timer (7-day default)
│       └── stopOutboxCleanup()    #   Timer teardown
├── db/
│   ├── migrations.js        # MODIFIED — add migration 2026-03-030-sync-foundation
│   └── schema.js            # MODIFIED — add ensureSyncSchema() helper
├── ipc/
│   ├── registerAll.js       # MODIFIED — apply capture wrappers
│   └── ipc-helpers.js       # MODIFIED — export write channel tracking

tests/
└── smoke.js                 # MODIFIED — add registry completeness check
```

**Structure Decision**: This feature adds a single new module (`main/sync/capture.js`) within a new `main/sync/` directory, following the existing pattern of domain-specific directories (`main/licensing/`, `main/notifications/`, `main/reports/`). No new project structure, no new HTML pages, no new renderer code.

## Complexity Tracking

No constitution violations. No complexity justifications needed.

All new code follows established patterns:

- Migration pattern: matches existing 29 migrations in `migrations.js`
- Outbox pattern: adapted from `owner_sync_outbox` in `ownerSync.js`
- Timer pattern: adapted from `startOwnerSyncBackground()` lifecycle
- Wrapper pattern: function composition around existing `handleWrite`/`handleWriteSoftAuth`
