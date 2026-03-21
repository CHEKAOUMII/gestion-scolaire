# Implementation Plan: Push Engine

**Branch**: `003-push-engine` | **Date**: 2026-03-21 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-push-engine/spec.md`

## Summary

Build the push engine that periodically flushes local `sync_outbox` entries to DynamoDB, completing the "local changes → cloud" half of the sync loop. The engine comprises three new modules: a Cognito credential manager (`credentials.js`), the flush engine itself (`engine.js`), and a writer authority enforcer (`authority.js`). It follows the established `ownerSync.js` background timer pattern — `start/stop/restart` lifecycle, re-entrancy guard, `.unref()` timers — and integrates via a single `startSyncPushBackground()` call in `main.js`.

## Technical Context

**Language/Version**: JavaScript (Node.js 18+ for native `fetch`), CommonJS modules
**Primary Dependencies**: `better-sqlite3` (existing), `@aws-sdk/client-dynamodb` (new), `@aws-sdk/lib-dynamodb` (new), `@aws-sdk/client-cognito-identity` (new)
**Storage**: SQLite (local, existing) + DynamoDB `pencil2-sync` (remote, Phase 2)
**Testing**: `npm run test:smoke` (IPC parity, module integrity, no CDN refs) + `npm run lint`
**Target Platform**: Windows (Electron desktop app)
**Project Type**: Desktop app (Electron)
**Performance Goals**: ≥100 entries/flush in ≤30 seconds; credential acquisition ≤3 seconds; no user-visible latency impact
**Constraints**: Offline-first (push skipped silently when offline); ≤512 MB memory; must not block app exit
**Scale/Scope**: 1–10 schools × 1–5 PCs each; ~40 write IPC channels; 17 entity types; modest data volumes

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Research Check

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Code Quality** | PASS | New files follow camelCase, single quotes, 4-space indent, Prettier. IPC channels use kebab-case with `sync:` prefix (Phase 4, not this phase). No dead code — each module has a clear purpose. |
| **II. Testing Standards** | PASS | Smoke tests must pass unchanged. New migration uses `ensureColumn()`. No CDN refs — AWS SDK installed via npm for main process only. |
| **III. User Experience** | N/A | Phase 3 has no UI components. All user-facing UI deferred to Phase 6. |
| **IV. Architecture** | PASS | No IPC channels added in this phase (deferred to Phase 4). No `require('electron')` in sync modules (only `main.js` touches Electron APIs). Background process follows established `ownerSync.js` pattern. `contextIsolation` untouched. |
| **V. Performance** | PASS | Push runs in background on configurable interval (default 5 min). Bounded batch size (100 entries/cycle). `.unref()` timer. No impact on startup time or UI responsiveness. |
| **Security** | PASS | Sensitive fields stripped before push (defense-in-depth). Credentials cached in memory only, never persisted to disk. License key used for auth (existing mechanism). IAM partition isolation enforced server-side. |
| **Workflow** | PASS | Feature branch `003-push-engine`. Forward-only migration with `ensureColumn()`. New npm dependencies justified (AWS SDK required for DynamoDB access). |

### Post-Design Re-Check

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Code Quality** | PASS | Three focused modules: `credentials.js` (auth), `engine.js` (flush), `authority.js` (permissions). Single responsibility maintained. |
| **II. Testing Standards** | PASS | Migration is idempotent. No new IPC channels = no parity test changes. Existing smoke tests pass unchanged (SC-010). |
| **IV. Architecture** | PASS | No raw `ipcMain.handle()`. Database access via `getDb()` singleton. `school_year` used in all partitioned queries. No bundler changes. AWS SDK is a main-process Node.js dependency, not a renderer-side vendor library. |
| **V. Performance** | PASS | 100-entry batch cap prevents resource exhaustion. DynamoDB 25-item batch limit respected. Re-entrancy guard prevents overlapping flushes. |
| **Security** | PASS | Writer authority enforced client-side (defense-in-depth). Credentials expire in 60 min, refreshed at 50. `password_hash`/`pin_hash` stripped in two layers (capture + push). No secrets in code. |

**Gate result**: PASS — no violations.

## Project Structure

### Documentation (this feature)

```text
specs/003-push-engine/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0: research decisions
├── data-model.md        # Phase 1: entity definitions
├── quickstart.md        # Phase 1: developer quickstart
├── contracts/
│   ├── credential-manager.md  # Credential manager interface
│   ├── push-engine.md         # Push engine interface
│   └── writer-authority.md    # Writer authority matrix
├── checklists/
│   └── requirements.md        # Spec quality checklist
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
main/
├── sync/
│   ├── capture.js          # [EXISTING - Phase 1] IPC interception, outbox recording
│   ├── engine.js           # [NEW] Push engine: flush loop, DynamoDB writes
│   ├── credentials.js      # [NEW] Cognito credential manager
│   └── authority.js        # [NEW] Writer authority matrix and role helpers
├── db/
│   └── migrations.js       # [MODIFY] Add migration 2026-03-031-push-engine-config
├── main.js                 # [MODIFY] Add startSyncPushBackground() call

package.json                # [MODIFY] Add @aws-sdk/* dependencies
```

**Structure Decision**: All new code goes into the existing `main/sync/` directory established by Phase 1. Three new files, two modified files, one dependency addition. No new directories created. This matches the project's convention of one module per concern within domain directories.

## Complexity Tracking

> No constitution violations — this section is empty by design.

No violations to justify. The push engine follows all established patterns (background timer, outbox flush, singleton config, `ensureColumn` migration) and introduces no new architectural concepts.
