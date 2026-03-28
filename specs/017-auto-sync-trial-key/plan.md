# Implementation Plan: Auto-Generate Trial Sync Key

**Branch**: `017-auto-sync-trial-key` | **Date**: 2026-03-26 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/017-auto-sync-trial-key/spec.md`

## Summary

On app startup, automatically generate and store a trial sync license key when the user is in an active trial period and no sync key exists yet. This eliminates manual key entry for trial users and enables seamless sync onboarding. The implementation adds a single new function `ensureTrialSyncKey()` in `main/licensing/service.js`, called from the `main.js` startup sequence after `initDatabase()` and before sync background tasks start. It reuses the existing `createOfflineLicenseKey()` mechanism and `getPublicActivationStatus()` for trial detection.

## Technical Context

**Language/Version**: JavaScript (Node.js, Electron)
**Primary Dependencies**: `better-sqlite3`, `crypto` (Node built-in), Electron
**Storage**: SQLite via `better-sqlite3` — `sync_config` table (singleton row, `id = 1`), `license_key` TEXT column (added by migration `2026-03-034`)
**Testing**: `npm run test:smoke` (IPC parity, module integrity, no CDN refs), `npm run lint` (ESLint flat config v9)
**Target Platform**: Windows desktop (Electron)
**Project Type**: Desktop application (Electron)
**Performance Goals**: Sub-50ms overhead for the key generation check; must not delay app startup beyond the 3-second constitutional limit
**Constraints**: Offline-capable (no network calls during key generation), must not crash on missing `sync_config` table (pre-migration state)
**Scale/Scope**: Single function addition + one call site in startup sequence; touches 2 files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Code Quality & Consistency | PASS | New function follows camelCase naming, single responsibility (licensing domain). No new IPC channels. Will pass `npm run lint`. |
| II. Testing Standards | PASS | `npm run test:smoke` will pass — no IPC changes, no new preload channels. No CDN refs. Migration already exists (`2026-03-034`). |
| III. User Experience Consistency | N/A | No UI changes in this feature. |
| IV. Good Practices & Architecture | PASS | No IPC boundary changes. Function lives in `main/licensing/service.js` (existing licensing domain module). Uses `handleRead`/`handleWrite` pattern not applicable — this is internal main-process logic only. Three-file rule N/A (no IPC). |
| V. Performance Requirements | PASS | Synchronous SQLite read + conditional key generation. Sub-50ms. No full table scans. No impact on startup time budget. |
| Security & Data Integrity | PASS | Uses existing HMAC signing via `getSigningSecret()`. No secrets in code. Key stored in `sync_config` (already protected by main process isolation). |
| Development Workflow | PASS | Feature branch `017-auto-sync-trial-key`. Conventional commits. Pre-merge checklist applicable. |

**Gate result: PASS** — No violations. Proceeding to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/017-auto-sync-trial-key/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
main/
├── licensing/
│   └── service.js       # Add ensureTrialSyncKey() function + export
main.js                  # Add ensureTrialSyncKey() call in startup sequence
```

**Structure Decision**: This feature modifies two existing files in the established project structure. No new files, directories, or modules are needed. The function belongs in `main/licensing/service.js` because it orchestrates licensing logic (trial status check + key generation) and follows the existing pattern established by `activateLicense()` which already writes to `sync_config.license_key` at line 414.

## Complexity Tracking

> No constitution violations — this section is intentionally empty.
