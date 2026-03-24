# Implementation Plan: Sync Integration (Phase 7.8)

**Branch**: `015-sync-integration` | **Date**: 2026-03-23 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/015-sync-integration/spec.md`

## Summary

Phase 7.8 wires the MASSAR code (institution identity from Phase 7.1) into the existing sync engine (Phases 1–6) as the canonical `schoolId` for DynamoDB partitioning, auto-configures sync on newly linked devices, adds heartbeat tracking via `linked_devices.last_seen_at`, and enforces device revocation through a new `device_revocation` entity type pushed/pulled via DynamoDB. No new IPC channels or source files are introduced — all changes modify existing modules.

## Technical Context

**Language/Version**: JavaScript (Node.js via Electron)
**Primary Dependencies**: `better-sqlite3`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, Node.js built-ins (`crypto`, `dgram`, `http`)
**Storage**: SQLite (local, WAL mode) + DynamoDB (cloud sync)
**Testing**: Smoke tests (`npm run test:smoke`), manual verification
**Target Platform**: Windows desktop (Electron)
**Project Type**: Desktop application (Electron)
**Performance Goals**: Sync cycle completes within existing interval limits (1–30 min); heartbeat update <10ms; revocation detection within 2 sync cycles
**Constraints**: Offline-capable, modest hardware (4GB RAM, HDD), no new npm dependencies
**Scale/Scope**: 3–10 devices per institution, single-school partition in DynamoDB

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Code Quality & Consistency | PASS | No new files; modifications follow existing patterns (camelCase JS, snake_case DB, kebab-case IPC). Prettier/ESLint enforced. |
| II. Testing Standards | PASS | Smoke test channel count unchanged (no new IPC channels). Migration uses `ensureColumn()` pattern. CI gate maintained. |
| III. User Experience Consistency | PASS | No new UI in this phase. Revocation notification uses existing `showToast()` pattern. Arabic text for error messages. |
| IV. Good Practices & Architecture | PASS | IPC contract unchanged. No new `ipcMain.handle()` calls. Handler wrappers (`handleRead`/`handleWrite`) maintained. `school_year` filtering preserved. No bundler. |
| V. Performance Requirements | PASS | Heartbeat is a single indexed UPDATE. Revocation push adds at most a few items per cycle. No full table scans. |
| Security & Data Integrity | PASS | Revocation enforcement prevents unauthorized sync. Origin device protection prevents orphaning. No secrets in code. |
| Development Workflow | PASS | Feature branch. Forward-only migration. Conventional commits. |

**Post-Phase 1 re-check**: PASS — No new entity types require schema changes. `device_revocation` lives in DynamoDB only (no new SQLite tables). No new dependencies introduced.

## Project Structure

### Documentation (this feature)

```text
specs/015-sync-integration/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0 research findings
├── data-model.md        # Phase 1 data model
├── quickstart.md        # Phase 1 quickstart guide
├── contracts/
│   └── ipc-contracts.md # Phase 1 IPC contract changes
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
main/
├── sync/
│   ├── engine.js          # MODIFY: heartbeat update, revocation push/pull
│   ├── authority.js       # MODIFY: register device_revocation entity type
│   └── capture.js         # MODIFY: add device_revocation to CHANNEL_REGISTRY
├── ipc/
│   └── linking.js         # MODIFY: origin device guard, re-link revocation clear
├── db/
│   └── migrations.js      # MODIFY: add MASSAR→schoolId sync migration
└── main.js                # MODIFY: startup MASSAR→schoolId check
```

**Structure Decision**: No new files. All changes are modifications to existing modules in the established `main/sync/`, `main/ipc/`, and `main/db/` directories. This follows the project's single-responsibility-per-module pattern.

## Implementation Phases

### Phase A: MASSAR Identity Bridge (P1 — FR-001, FR-002, FR-011)

**Goal**: Ensure `sync_config.school_id` always reflects `institution_config.massar_code`.

**Changes**:

1. **`main/db/migrations.js`** — Add migration `2026-03-038-massar-schoolid-sync`:
   - If `institution_config.massar_code` is set and `sync_config.school_id` differs, update `sync_config.school_id` to match
   - Handles the upgrade path for existing installations

2. **`main.js`** — Add startup check after DB init:
   - Query both tables; if `massar_code` is set and `school_id` differs, sync them
   - This covers the runtime case (not just migration time)

**Verification**: Complete first-run setup → check `sync_config.school_id` equals entered MASSAR code.

### Phase B: Auto-Config on Device Linking (P1 — FR-003, FR-004, FR-012)

**Goal**: Linked devices get sync fully configured from admin device automatically.

**Changes**:

1. **`main/ipc/linking.js`** — In `verifyAndLink` handler:
   - After `upsertSyncConfig`, verify `sync_config.school_id` matches `institution_config.massar_code` (defensive check)
   - Handle re-linking: if `linked_devices` row exists with `status = 'revoked'`, update to `status = 'active'`, clear `revoked_at`, update `linked_by = 'otp_lan'|'otp_server'` and `linked_at`
   - Sync is already auto-enabled via `upsertSyncConfig` writing `enabled` from Device 1's config — confirm this path works end-to-end

**Verification**: Device 1 has sync configured → generate OTP → Device 2 links → Device 2's sync settings match Device 1's.

### Phase C: Device Heartbeat (P2 — FR-005)

**Goal**: Track when each device last synced via `linked_devices.last_seen_at`.

**Changes**:

1. **`main/sync/engine.js`** — In `flushSyncOutbox()`:
   - After successful push (before return), call `updateDeviceHeartbeat(db, deviceHash)`
   - New internal function: `UPDATE linked_devices SET last_seen_at = CURRENT_TIMESTAMP WHERE device_hash = ? AND status = 'active'`

2. **`main/sync/engine.js`** — In `pullRemoteChanges()`:
   - After cursor advance and `sync_pull_state` update, call `updateDeviceHeartbeat(db, deviceHash)`

**Verification**: Trigger sync → check `linked_devices.last_seen_at` updated. View device management UI → see recent timestamp.

### Phase D: Revocation Enforcement (P2 — FR-006, FR-007, FR-008, FR-009, FR-010)

**Goal**: Revoked devices are blocked from syncing via cloud-side records.

**Changes**:

1. **`main/sync/authority.js`** — Register `device_revocation` in `ENTITY_TYPE_REGISTRY`:
   - `sortKeyPrefix: 'REVOCATION#'`
   - `tableName: null` (not a SQLite table)
   - Push authority: admin-only

2. **`main/sync/capture.js`** — Add `device_revocation` entry to `CHANNEL_REGISTRY` with `exclude: true`

3. **`main/sync/engine.js`** — In `flushSyncOutbox()`, after processing regular outbox:
   - Query `linked_devices WHERE status = 'revoked' AND revoked_at IS NOT NULL`
   - For each revoked device, write a `device_revocation` DynamoDB item using `buildDynamoItem()` pattern
   - Track which revocations have been pushed (use a local marker or idempotent writes)

4. **`main/sync/engine.js`** — In `pullRemoteChanges()`, after fetching DynamoDB items:
   - Filter for `entityType === 'device_revocation'`
   - If any match current `deviceHash`:
     - `UPDATE sync_config SET enabled = 0 WHERE id = 1`
     - Stop pull, log warning, return `{ success: false, error: 'device_revoked' }`

5. **`main/ipc/linking.js`** — In `revokeDevice` handler:
   - Before revoking, check if `deviceHash === institution_config.setup_device_hash`
   - If match, reject with `{ success: false, error: 'Cannot revoke the origin device' }`

6. **`main/ipc/linking.js`** — In `verifyAndLink` handler (addition to Phase B):
   - On re-link of revoked device, set `sync_config.enabled = 1` explicitly

**Verification**: Revoke Device 2 → push on Device 1 → pull on Device 2 → sync disabled with notification. Attempt to revoke origin device → rejected.

### Phase E: Validation & Smoke Tests

**Goal**: Ensure all changes pass CI and manual verification.

**Changes**:

1. Verify `npm run lint` passes for all modified files
2. Verify `npm run test:smoke` passes (channel count unchanged)
3. Manual test matrix:
   - New institution setup → sync_config.school_id correct
   - Device linking → auto-config works
   - Heartbeat → last_seen_at updates
   - Revocation → cloud enforcement works
   - Re-linking → clears revocation
   - Origin device → cannot be revoked
   - Existing installation upgrade → migration works

## Complexity Tracking

No constitution violations. No complexity justifications needed.

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Revocation push creates duplicate DynamoDB items | Use conditional writes with version guard (existing pattern) |
| Self-revocation check has false positive from stale DynamoDB data | Check local `linked_devices.status` first — if locally active, ignore cloud revocation |
| Migration runs on a DB where `institution_config` doesn't exist yet | Migration uses defensive `SELECT` with null check |
| Re-linking race condition (admin revokes while device is re-linking) | OTP verification is atomic — if OTP is valid, the link succeeds regardless of revocation state |
