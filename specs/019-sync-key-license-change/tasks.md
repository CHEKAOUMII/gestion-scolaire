# Tasks: Update Sync Key on License Status Change

**Input**: Design documents from `/specs/019-sync-key-license-change/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, quickstart.md

**Tests**: Not requested in the feature specification. No test tasks included.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No new project structure needed. This phase handles the foundational helpers and bug fixes that all user stories depend on.

*No setup tasks — the project structure already exists. Proceed to Phase 2.*

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create the shared `clearSyncLicenseKey()` helper and fix the `readLicenseKey` export bug. These MUST be complete before ANY user story can be implemented.

**CRITICAL**: No user story work can begin until this phase is complete.

- [x] T001 Add `clearSyncLicenseKey(db)` helper function in `main/sync/credentials.js`
  - Add after the existing `clearCredentials()` function (after line ~108)
  - Function must: (1) execute `UPDATE sync_config SET license_key = NULL WHERE id = 1`, (2) call `clearCredentials()` to invalidate in-memory cache, (3) wrap everything in try/catch to silently handle missing sync_config table
  - Function must be idempotent — clearing an already-NULL key succeeds silently
  - FR-004, FR-010

- [x] T002 Fix `module.exports` in `main/sync/credentials.js` to export `readLicenseKey`, `readSyncConfig`, and `clearSyncLicenseKey`
  - Current exports (line 195): `{ getCredentials, clearCredentials, isAuthenticated, testConnection }`
  - New exports: `{ getCredentials, clearCredentials, clearSyncLicenseKey, isAuthenticated, testConnection, readLicenseKey, readSyncConfig }`
  - This fixes a pre-existing bug where `service.js` imports `readLicenseKey` but receives `undefined` at runtime
  - Research Task 4

- [x] T003 Update import statement in `main/licensing/service.js` to destructure new exports
  - Current (line 5): `const { readLicenseKey } = require('../sync/credentials');`
  - New: `const { readLicenseKey, clearSyncLicenseKey, clearCredentials } = require('../sync/credentials');`
  - This prepares the imports for all subsequent user story tasks

**Checkpoint**: Foundation ready — `clearSyncLicenseKey(db)` exists, exports are fixed, imports are updated. User story implementation can now begin.

---

## Phase 3: User Story 1 — Device Deactivation Clears Sync Key (Priority: P1) MVP

**Goal**: When an admin deactivates their device, the sync key is immediately cleared and cached credentials are invalidated, preventing any further sync authentication.

**Independent Test**: Activate a paid license, verify sync key is populated, then deactivate the device via `licensing:deactivateCurrentDevice` IPC and confirm `sync_config.license_key` is NULL and cached credentials are cleared.

### Implementation for User Story 1

- [x] T004 [US1] Call `clearSyncLicenseKey(db)` in `deactivateCurrentDevice()` in `main/licensing/service.js`
  - Insert after the `eventLog` call and `pushOwnerSyncEvent` call (after line ~624), before the return statement (line ~626)
  - Call `clearSyncLicenseKey(db)` — this NULLs the DB key AND invalidates the in-memory credential cache in one operation
  - The `db` variable is already available in scope (line 590)
  - FR-001, FR-002

**Checkpoint**: At this point, device deactivation immediately clears the sync key and invalidates cached credentials. Background sync tasks will fail gracefully on next attempt because `getCredentials()` will read a NULL license key from the DB.

---

## Phase 4: User Story 2 — Paid Activation Over Trial Replaces Sync Key (Priority: P2)

**Goal**: When an admin upgrades from a trial to a paid license, cached credentials obtained using the old trial key are invalidated so the next sync cycle uses the new paid key.

**Independent Test**: Start with a trial license (auto-generated trial sync key), activate a paid license, and verify that (1) `sync_config.license_key` contains the paid key (Feature 1 handles this) and (2) cached credentials are invalidated so the next sync operation re-authenticates with the new key.

### Implementation for User Story 2

- [x] T005 [US2] Add `clearCredentials()` call after the sync_config key write in `activateLicense()` in `main/licensing/service.js`
  - Insert after the existing `db.prepare('UPDATE sync_config SET license_key = ? WHERE id = 1').run(decoded.normalizedKey);` (line ~415), inside the same try block
  - Call `clearCredentials()` (NOT `clearSyncLicenseKey` — the key was just written, we only need to bust the in-memory cache)
  - This ensures the next `getCredentials()` call re-reads the new paid key from the DB and obtains fresh AWS credentials
  - FR-002, FR-003

**Checkpoint**: At this point, paid-over-trial upgrades immediately invalidate cached credentials. The existing Feature 1 logic already writes the new key; this task ensures the cache is also busted. Reactivation after deactivation (User Story 3) is also covered by this same code path since `activateLicense()` handles both scenarios.

---

## Phase 5: User Story 3 — Reactivation After Deactivation Restores Sync Key (Priority: P3)

**Goal**: When an admin reactivates with a new license after a previous deactivation, the sync key is populated and cached credentials are refreshed.

**Independent Test**: Deactivate a device (key is cleared per US1), then activate a new license and verify sync_config.license_key is populated and background sync authenticates successfully.

### Implementation for User Story 3

*No additional implementation tasks required.* This user story is fully covered by the combination of:
- **T004 (US1)**: Deactivation clears the key
- **T005 (US2)**: `activateLicense()` writes the new key (Feature 1) and busts the cache (this feature)

The reactivation path calls `activateLicense()` which already writes the key to `sync_config` (Feature 1, line ~415) and now also calls `clearCredentials()` (T005). No additional code changes are needed for this story.

**Checkpoint**: Reactivation flow works end-to-end: deactivation clears the key, reactivation writes a new key and invalidates the cache.

---

## Phase 6: User Story 4 — License Expiration Clears Sync Key (Priority: P3)

**Goal**: When a paid or trial license expires (or reaches grace_expired, suspended, inactive, revoked status), the system detects this at natural call points and clears the sync key.

**Independent Test**: Set up a license with an `expires_at` date in the past, then trigger a status check (via IPC `licensing:getPublicStatus` or a sync operation) and verify `sync_config.license_key` is cleared.

### Implementation for User Story 4

- [x] T006 [US4] Add expiration-aware sync key clearing in `getPublicActivationStatus()` in `main/licensing/service.js`
  - After the status is computed (after line ~258, before the final return), add a check:
  - Define a `Set` of sync-blocking statuses: `expired`, `grace_expired`, `suspended`, `inactive`, `revoked`, `trial_expired`, `device_not_activated`
  - If the computed `status.status` (or the final returned status) is in this set AND `readLicenseKey(db)` returns a non-null value, call `clearSyncLicenseKey(db)`
  - Must NOT clear on `active`, `trial`, or `grace_warning` (FR-008, FR-009)
  - The `db` variable must be obtained via `getDb()` (already imported at line 3)
  - This catches expiration when the admin opens the app or navigates, even if no sync operation runs
  - FR-005, FR-006, FR-007, FR-008, FR-009

- [x] T007 [US4] Add expiration guard in `getCredentials()` in `main/sync/credentials.js`
  - At the beginning of the `getCredentials()` function (line ~86), before the cached credential check:
  - Use a lazy `require()` to import `getPublicActivationStatus` from `../licensing/service` to avoid circular require (since `service.js` already imports from `credentials.js`)
  - Call `getPublicActivationStatus()` and check if the returned status is in the sync-blocking set (`expired`, `grace_expired`, `suspended`, `inactive`, `revoked`, `trial_expired`, `device_not_activated`)
  - If blocking: call `clearSyncLicenseKey(getDb())` and return `null`
  - If not blocking (`active`, `trial`, `grace_warning`): proceed with normal credential refresh
  - Wrap the entire license check in try/catch — on any error, fall through to normal credential refresh (don't block sync on a license check failure)
  - This catches expiration at sync-time, preventing stale credential refresh attempts
  - FR-005, FR-006, FR-007, FR-008

**Checkpoint**: All expiration scenarios are handled — both when the admin opens the app (via `getPublicActivationStatus`) and when sync operations attempt to run (via `getCredentials`). Active and grace_warning statuses correctly preserve the key.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Validation and verification across all user stories.

- [x] T008 Run `npm run lint` and fix any linting errors in modified files
  - Files: `main/sync/credentials.js`, `main/licensing/service.js`
  - Ensure Prettier formatting (single quotes, no trailing commas, 4-space indent, 120-char lines, semicolons)
  - Ensure no unused variables (especially the new imports)

- [x] T009 Run `npm run test:smoke` and verify all checks pass (pre-existing failure in teachers-list.html — not related to this feature)
  - IPC parity check (no new channels added, so should pass unchanged)
  - Module integrity check
  - No CDN references check
  - Tailwind output check

- [ ] T010 Manual verification of deactivation flow (requires manual testing by developer)
  - Launch app with `npm run dev`
  - Activate a paid license
  - Verify `sync_config.license_key` is populated
  - Deactivate the device
  - Verify `sync_config.license_key` is NULL
  - Verify sync operations fail gracefully (no crashes, error logged)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 2)**: No dependencies — can start immediately. BLOCKS all user stories.
- **US1 (Phase 3)**: Depends on Phase 2 (T001–T003) completion
- **US2 (Phase 4)**: Depends on Phase 2 (T001–T003) completion. Can run in parallel with US1.
- **US3 (Phase 5)**: No tasks — covered by US1 + US2
- **US4 (Phase 6)**: Depends on Phase 2 (T001–T003) completion. Can run in parallel with US1/US2.
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Phase 2 — no dependencies on other stories
- **User Story 2 (P2)**: Can start after Phase 2 — no dependencies on other stories
- **User Story 3 (P3)**: No tasks — automatically covered by US1 (T004) + US2 (T005)
- **User Story 4 (P3)**: Can start after Phase 2 — no dependencies on other stories

### Within Each User Story

- Each story has 1–2 tasks, all in a single file
- No model/service/endpoint layering needed — these are targeted function modifications

### Parallel Opportunities

- T001 and T002 modify the same file (`credentials.js`) — must be sequential
- T003 modifies a different file (`service.js`) — can run after T001/T002
- T004, T005, T006 all modify `service.js` — must be sequential within that file
- T007 modifies `credentials.js` — can run in parallel with T004/T005/T006
- T008 and T009 must run after all implementation tasks

---

## Parallel Example: After Phase 2 Completes

```text
# These can run in parallel (different files):
Agent A (service.js): T004 [US1] → T005 [US2] → T006 [US4]
Agent B (credentials.js): T007 [US4]

# Then sequentially:
T008 → T009 → T010
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: Foundational (T001–T003)
2. Complete Phase 3: User Story 1 (T004)
3. **STOP and VALIDATE**: Deactivation clears sync key
4. Run `npm run lint` + `npm run test:smoke`

### Incremental Delivery

1. T001–T003 → Foundation ready (helper + exports + imports)
2. T004 → US1 complete (deactivation clears key) — MVP!
3. T005 → US2 complete (cache bust on upgrade) — US3 also covered
4. T006–T007 → US4 complete (expiration clearing)
5. T008–T010 → Polish and verification

---

## Notes

- Only 2 source files modified: `main/sync/credentials.js` and `main/licensing/service.js`
- No new IPC channels, no new migrations, no new HTML pages
- The circular require between `credentials.js` and `service.js` is avoided via lazy `require()` in T007
- All DB operations use try/catch for pre-migration safety (sync_config table may not exist)
- `clearCredentials()` (cache-only) vs `clearSyncLicenseKey()` (DB + cache) — use the right one for each context
