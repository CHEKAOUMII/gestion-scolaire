# Tasks: Auto-Generate Trial Sync Key

**Input**: Design documents from `/specs/017-auto-sync-trial-key/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, quickstart.md

**Tests**: Not requested in feature specification — test tasks omitted.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Import required dependency and prepare the function skeleton

- [x] T001 Add `readLicenseKey` import from `../sync/credentials` in `main/licensing/service.js`
- [x] T002 Add `createOfflineLicenseKey` import from `./offlineKey` in `main/licensing/service.js` (already imported)

---

## Phase 2: User Story 1 — Trial User Gets Automatic Sync Key (Priority: P1) 🎯 MVP

**Goal**: When the app starts with an active trial and no sync license key, automatically generate a trial key and store it in `sync_config.license_key`.

**Independent Test**: Launch the app with an active trial license and an empty sync license key field. Verify the key is automatically populated after startup completes with correct trial parameters (`basic` plan, trial expiry date, `TRIAL` customer reference).

### Implementation for User Story 1

- [x] T003 [US1] Implement `ensureTrialSyncKey()` function in `main/licensing/service.js` — get db via `getDb()`, read existing key via `readLicenseKey(db)`, check trial status via `getPublicActivationStatus()`, generate key via `createOfflineLicenseKey({ planCode: 'basic', expiresAt: status.trialEndDate, customerRef: 'TRIAL', requiresOnlineValidation: false })`, write to `sync_config` via `db.prepare('UPDATE sync_config SET license_key = ? WHERE id = 1').run(key)`
- [x] T004 [US1] Add `ensureTrialSyncKey` to the `module.exports` block in `main/licensing/service.js`
- [x] T005 [US1] Import `ensureTrialSyncKey` from `./main/licensing/service` in `main.js` and call it in the startup sequence after `initDatabase()` and before `registerAllIpcHandlers(ipcMain)` (insert at line 188)

**Checkpoint**: At this point, trial key auto-generation should work end-to-end. Launch with active trial + empty key → key is populated.

---

## Phase 3: User Story 2 — Existing Key Is Preserved on Restart (Priority: P1)

**Goal**: When a sync license key already exists (trial or paid), the app must not overwrite it on restart.

**Independent Test**: Set a key manually in `sync_config.license_key`, restart the app, verify the key remains unchanged.

### Implementation for User Story 2

- [x] T006 [US2] Verify that `ensureTrialSyncKey()` in `main/licensing/service.js` returns early when `readLicenseKey(db)` returns a truthy value — this is the first guard in T003; confirm the early return is before any key generation or write logic

**Checkpoint**: Key preservation is inherently implemented by the early-return guard in T003. Verify by restarting with an existing key.

---

## Phase 4: User Story 3 — Non-Trial Users Are Unaffected (Priority: P2)

**Goal**: Users with expired trials or paid licenses (no trial status) do not get a trial key auto-generated.

**Independent Test**: Launch the app with an expired trial and no sync key. Verify no key is generated.

### Implementation for User Story 3

- [x] T007 [US3] Verify that `ensureTrialSyncKey()` in `main/licensing/service.js` returns early when `getPublicActivationStatus()` returns `status !== 'trial'` or `trialActive !== true` — this is the second guard in T003; confirm the status check rejects expired trials (`status: 'trial_expired'`) and paid licenses (`status: 'active'`)

**Checkpoint**: Non-trial skip is inherently implemented by the status guard in T003. Verify by launching with expired trial.

---

## Phase 5: User Story 4 — Graceful Handling When Sync Infrastructure Is Missing (Priority: P2)

**Goal**: If the `sync_config` table does not exist or key generation fails for any reason, the app starts normally without errors.

**Independent Test**: Break or remove the `sync_config` table, restart the app, verify it starts without errors.

### Implementation for User Story 4

- [x] T008 [US4] Verify that the entire body of `ensureTrialSyncKey()` in `main/licensing/service.js` is wrapped in a try/catch that logs via `console.error` and never throws — this is the error handling wrapper in T003; confirm errors from DB reads, status checks, key generation, and DB writes are all caught

**Checkpoint**: Error resilience is inherently implemented by the try/catch in T003. Verify by breaking `sync_config` table.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verification and quality gates

- [x] T009 Run `npm run lint` and fix any linting errors in `main/licensing/service.js` and `main.js`
- [x] T010 Run `npm run test:smoke` and verify all smoke tests pass (IPC parity, module integrity, no CDN refs)
- [ ] T011 Run `npm run dev` and manually verify: (a) fresh trial → key auto-populated, (b) restart with key → key preserved, (c) app starts without errors

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — add imports first
- **User Story 1 (Phase 2)**: Depends on Setup — core implementation
- **User Story 2 (Phase 3)**: Verification only — inherent in US1 implementation (T003 early-return guard)
- **User Story 3 (Phase 4)**: Verification only — inherent in US1 implementation (T003 status guard)
- **User Story 4 (Phase 5)**: Verification only — inherent in US1 implementation (T003 try/catch)
- **Polish (Phase 6)**: Depends on all phases complete

### Task Dependencies

```
T001, T002 (parallel — different imports)
    └──→ T003 (core function — depends on imports)
           └──→ T004 (export — depends on function existing)
                  └──→ T005 (call site — depends on export)
                         ├──→ T006 (verify guard 1)
                         ├──→ T007 (verify guard 2)
                         └──→ T008 (verify try/catch)
                                └──→ T009, T010 (parallel — lint + smoke)
                                       └──→ T011 (manual verification)
```

### Parallel Opportunities

```bash
# Phase 1 — both imports can be added in parallel (different lines, same file but independent edits):
Task T001: Add readLicenseKey import in main/licensing/service.js
Task T002: Add createOfflineLicenseKey import in main/licensing/service.js

# Phase 6 — lint and smoke tests can run in parallel:
Task T009: npm run lint
Task T010: npm run test:smoke
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T002)
2. Complete Phase 2: User Story 1 (T003–T005)
3. **STOP and VALIDATE**: Test trial key generation independently
4. All other user stories (US2–US4) are inherently satisfied by the guards and error handling in T003

### Incremental Delivery

This feature is compact enough that all user stories are satisfied by a single function implementation (T003). The verification tasks (T006–T008) confirm that the guards and error handling built into T003 correctly address each story's requirements. The entire feature can be delivered as a single commit.

---

## Notes

- This is a small, focused feature: 1 new function + 1 call site across 2 files
- User Stories 2–4 are verification-only phases because their requirements are satisfied by guards and error handling built into the core function (T003)
- No new IPC channels — smoke test IPC parity is unaffected
- No new database migrations — uses existing `sync_config.license_key` column from migration `2026-03-034`
- The `readLicenseKey()` function already handles NULL vs empty string (FR-007), so no extra logic needed
- Follow the existing pattern from `activateLicense()` (line 413–417) for the try/catch around `sync_config` writes
