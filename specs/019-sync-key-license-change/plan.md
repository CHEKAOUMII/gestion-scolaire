# Implementation Plan: Update Sync Key on License Status Change

**Branch**: `019-sync-key-license-change` | **Date**: 2026-03-26 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/019-sync-key-license-change/spec.md`

## Summary

Automatically manage `sync_config.license_key` across license lifecycle events — clearing the key on device deactivation, license/trial expiration, and grace period expiry, while invalidating cached AWS credentials on every key change (including paid-over-trial upgrades). This closes the gap where a deactivated or expired device retains a stale sync key that could theoretically allow continued sync authentication.

## Technical Context

**Language/Version**: JavaScript (Node.js, Electron main process)
**Primary Dependencies**: better-sqlite3, @aws-sdk/client-cognito-identity, electron
**Storage**: SQLite (`sync_config` table, single-row `id = 1`)
**Testing**: `npm run lint` + `npm run test:smoke` (IPC parity, module integrity, no CDN refs)
**Target Platform**: Windows desktop (Electron)
**Project Type**: Desktop application (Electron)
**Performance Goals**: All sync key operations must complete synchronously within the existing IPC handler execution time
**Constraints**: No background polling loops for license status; offline-capable; sync_config table may not exist on pre-migration installs
**Scale/Scope**: Single-device, single-user desktop app; 2 files modified

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Code Quality & Consistency | PASS | camelCase functions, 4-space indent, Prettier/ESLint enforced |
| II. Testing Standards | PASS | `npm run lint` + `npm run test:smoke` required before merge; no new IPC channels = no parity changes |
| III. User Experience Consistency | N/A | No UI changes in this feature (Feature 3 already hid the field) |
| IV. Good Practices & Architecture | PASS | No new IPC channels needed; changes are internal main-process logic in existing modules; no bundler or vendor changes |
| V. Performance Requirements | PASS | All operations are synchronous SQLite UPDATE + in-memory cache clear; no impact on startup time or query performance |
| Security & Data Integrity | PASS | Clearing stale keys improves security posture; no secrets in code; all DB writes use parameterized queries |
| Development Workflow | PASS | Feature branch; conventional commit format; pre-merge checklist applies |

**Post-Phase 1 re-check**: PASS — no new violations introduced by design decisions. The `readLicenseKey` export fix is a bug fix, not a new pattern.

## Project Structure

### Documentation (this feature)

```text
specs/019-sync-key-license-change/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0 research output
├── data-model.md        # Phase 1 data model
├── quickstart.md        # Phase 1 quickstart guide
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
main/
├── sync/
│   └── credentials.js     # Add clearSyncLicenseKey(), export readLicenseKey/readSyncConfig,
│                           # add expiration guard in getCredentials()
└── licensing/
    └── service.js          # Call clearSyncLicenseKey in deactivateCurrentDevice(),
                            # call clearCredentials after activateLicense() key write,
                            # add expiration-aware clearing in getPublicActivationStatus()
```

**Structure Decision**: No new files or directories. All changes are modifications to two existing main-process modules. This follows the project's established pattern of keeping sync credential logic in `credentials.js` and licensing lifecycle logic in `service.js`.

## Implementation Design

### Change 1: New `clearSyncLicenseKey(db)` helper in `credentials.js`

**Purpose**: Centralized function to NULL the license key in the database AND invalidate in-memory cache in one atomic operation.

**Behavior**:
1. Execute `UPDATE sync_config SET license_key = NULL WHERE id = 1`
2. Call `clearCredentials()` to invalidate `_cachedCredentials` and `_refreshPromise`
3. Wrap in try/catch — silently ignore errors (sync_config table may not exist)
4. Idempotent — clearing an already-NULL key succeeds silently

**Location**: After `clearCredentials()` (line ~108), before `isAuthenticated()`

### Change 2: Export `readLicenseKey` and `readSyncConfig` from `credentials.js`

**Purpose**: Fix pre-existing bug where `service.js` imports `readLicenseKey` but it's not exported.

**Current exports** (line 195): `{ getCredentials, clearCredentials, isAuthenticated, testConnection }`
**New exports**: `{ getCredentials, clearCredentials, clearSyncLicenseKey, isAuthenticated, testConnection, readLicenseKey, readSyncConfig }`

### Change 3: Clear sync key in `deactivateCurrentDevice()` in `service.js`

**Purpose**: FR-001 — immediately remove sync key when device is deactivated.

**Location**: After the `revoked_at` UPDATE and `eventLog` call (after line 618), before the return statement.

**Behavior**: Call `clearSyncLicenseKey(db)` — this clears the DB key and invalidates cached credentials.

### Change 4: Invalidate cache after key write in `activateLicense()` in `service.js`

**Purpose**: FR-002/FR-003 — ensure cached credentials are invalidated when a new key is written (e.g., paid over trial upgrade).

**Location**: After the existing `sync_config.license_key` UPDATE at line 415, inside the try block.

**Behavior**: Call `clearCredentials()` (not `clearSyncLicenseKey` — the key was just written, we only need to bust the cache).

### Change 5: Expiration guard in `getCredentials()` in `credentials.js`

**Purpose**: FR-005/FR-006/FR-007 — detect license expiration at sync time and clear the key.

**Behavior**:
1. Before attempting credential refresh, import and call `getPublicActivationStatus()`
2. If status is in the "sync-blocking" set (`expired`, `grace_expired`, `suspended`, `inactive`, `revoked`, `trial_expired`, `device_not_activated`), call `clearSyncLicenseKey(db)` and return `null`
3. If status is `active`, `trial`, or `grace_warning`, proceed with normal credential refresh

**Design note**: This introduces a dependency from `credentials.js` → `service.js` (`getPublicActivationStatus`). To avoid a circular require (since `service.js` already imports from `credentials.js`), the import should be done lazily inside the function body using `require()`.

### Change 6: Expiration check in `getPublicActivationStatus()` in `service.js`

**Purpose**: Clear the sync key when the admin opens the app and the license has expired, even if no sync operation runs.

**Behavior**:
1. After computing the status, if it's in the sync-blocking set, call `clearSyncLicenseKey(db)`
2. This is a side-effect on a read operation, but it's idempotent and ensures the key is cleaned up even without sync activity

### Import Changes in `service.js`

**Current** (line 5): `const { readLicenseKey } = require('../sync/credentials');`
**New**: `const { readLicenseKey, clearSyncLicenseKey, clearCredentials } = require('../sync/credentials');`

## Complexity Tracking

No constitution violations. No complexity justifications needed.
