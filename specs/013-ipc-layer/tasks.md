# Tasks: Phase 7.6 IPC Layer

**Input**: Design documents from `/specs/013-ipc-layer/`
**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/linking-ipc.md`, `quickstart.md`

**Tests**: Not requested - no new automated test tasks are included beyond required smoke/lint/manual validation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: Which user story this task belongs to (`US1`, `US2`, `US3`)
- Every task includes exact file paths so another LLM can execute the work without extra repo discovery

---

## Phase 1: Setup (Canonical Linking Surface)

**Purpose**: Introduce the new linking IPC domain without breaking the currently working `setup` domain during migration.

- [x] T001 Create the canonical IPC module scaffold with shared DTO/helper placeholders and 10 wrapper-based channel registrations in `main/ipc/linking.js`
- [x] T002 [P] Expose the canonical `window.api.linking` namespace in `preload.js` using the channel names from `specs/013-ipc-layer/contracts/linking-ipc.md`
- [x] T003 [P] Register `registerLinkingIpc` alongside the existing setup module in `main/ipc/registerAll.js` so the new domain can be implemented incrementally

**Checkpoint**: After this phase, the repository has a dedicated `main/ipc/linking.js` entry point, but the legacy `setup` flow still remains available while feature work moves over.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the shared lifecycle/state helpers that every linking story depends on.

**CRITICAL**: Do not start story work until these tasks are complete.

- [x] T004 Add excluded sync-capture registry entries for every planned `linking:*` write or admin-read channel in `main/sync/capture.js`
- [x] T005 Standardize MASSAR and OTP lifecycle behavior in `main/linking/otp.js` by tightening MASSAR validation to `^[A-Z]\d{4,8}$`, adding latest-status reporting, and adding `cancelActiveOtp()` support for cancelled/used/expired distinctions
- [x] T006 [P] Extend LAN helper state in `main/linking/lan.js` by adding `getLinkingServerStatus()` and by including contract-compliant institution/sync bootstrap data with `licenseKey` pass-through in the LAN success payload
- [x] T007 [P] Extend remote publish helper state in `main/linking/server.js` by tracking whether the current OTP was published, exposing getter/reset helpers for IPC status reads, and adding a remote invalidation path that makes cancelled OTPs unusable through the server fallback

**Checkpoint**: After this phase, the linking helpers can report OTP state, LAN state, and remote publish state consistently enough for all user stories.

---

## Phase 3: User Story 1 - Complete first-device setup (Priority: P1) 🎯 MVP

**Goal**: Make the canonical linking IPC domain capable of reporting institution status and creating the first institution on an unconfigured device.

**Independent Test**: From the renderer console on `setup.html`, call `window.api.linking.getInstitutionStatus()` and `window.api.linking.setupNewInstitution(...)` on a clean profile, then confirm local setup completes and the current device is returned as the founding active device.

### Implementation for User Story 1

- [x] T008 [US1] Implement `linking:get-institution-status` in `main/ipc/linking.js` so it returns `{ success, setupCompleted, massarCode, institutionName }` and correctly treats upgraded installations as already configured
- [x] T009 [US1] Implement `linking:setup-new-institution` in `main/ipc/linking.js` with `handleWriteSoftAuth`, atomic writes to `institution_config`, `users`, `linked_devices`, and `sync_config`, and stable failure codes such as `ALREADY_CONFIGURED`, `INVALID_MASSAR`, `INVALID_ADMIN_NAME`, and `INVALID_PASSWORD`
- [x] T010 [US1] Finish the shared DTO builders in `main/ipc/linking.js` so successful setup responses include the contract-compliant `institution` and `currentDevice` summaries used again by later stories

**Checkpoint**: User Story 1 is complete when first-device setup works through `window.api.linking` with no dependency on the legacy `setup:*` handlers.

---

## Phase 4: User Story 2 - Link an additional device (Priority: P1)

**Goal**: Allow one device to issue a usable OTP and allow a second unconfigured device to link through LAN-first verification with server fallback.

**Independent Test**: On a configured source device, generate an OTP with `window.api.linking.generateOtp()`. On a second clean device, call `window.api.linking.verifyAndLink({ massarCode, otp })` and confirm setup completes only on valid verification.

### Implementation for User Story 2

- [x] T011 [P] [US2] Update the LAN bootstrap payload builder in `main/linking/lan.js` so successful LAN verification returns the contract-compliant institution, sync bootstrap, active `licenseKey`, and imported user payload expected by `specs/013-ipc-layer/contracts/linking-ipc.md`
- [x] T012 [US2] Implement `linking:generate-otp` in `main/ipc/linking.js` so it reads the current institution, calls `generateOtp()`, starts LAN sharing, publishes the encrypted bootstrap payload remotely when `auth_lambda_url` and an active license key are available, and returns `{ success, otp, expiresAt, remainingSeconds, transport }`
- [x] T013 [US2] Implement `linking:discover-lan-devices` in `main/ipc/linking.js` with normalized MASSAR validation, timeout handling, and an empty-list fallback when LAN discovery is unavailable
- [x] T014 [US2] Implement `linking:verify-and-link` in `main/ipc/linking.js` so it validates inputs, tries LAN verification first, falls back to server verification, atomically imports institution/sync/user bootstrap data, registers the current device as `otp_lan` or `otp_server`, and leaves setup incomplete on every failure path

**Checkpoint**: User Story 2 is complete when a second device can be linked end-to-end using only the canonical `linking` contract.

---

## Phase 5: User Story 3 - Manage institution linking access (Priority: P2)

**Goal**: Give authenticated administrators a full management surface for OTP lifecycle, current-device identity, linked-device inventory, and device revocation.

**Independent Test**: After signing in as an admin, use `window.api.linking.generateOtp()`, `getOtpStatus()`, `getCurrentDevice()`, `getLinkedDevices()`, `cancelOtp()`, and `revokeDevice({ deviceHash })` from the renderer console and confirm that current-device protection and revoked-status persistence work as specified.

### Implementation for User Story 3

- [x] T015 [US3] Implement `linking:get-otp-status` and `linking:cancel-otp` in `main/ipc/linking.js` using `main/linking/otp.js`, `main/linking/lan.js`, and `main/linking/server.js` so administrators see `{ active, status, expiresAt, remainingSeconds, transport }` and cancelled OTPs become unusable immediately on both LAN and server paths
- [x] T016 [US3] Implement `linking:get-current-device` in `main/ipc/linking.js` so it returns the current fingerprint/device summary plus institution identity from `institution_config`
- [x] T017 [US3] Implement `linking:get-linked-devices` in `main/ipc/linking.js` so it returns contract-compliant device summaries from `linked_devices`, sorted active-first and annotated with `isCurrentDevice`
- [x] T018 [US3] Implement `linking:revoke-device` in `main/ipc/linking.js` with admin-only auth, `DEVICE_NOT_FOUND` and `DEVICE_ALREADY_REVOKED` checks, `CURRENT_DEVICE_PROTECTED` enforcement, and revoked-status persistence in `linked_devices`

**Checkpoint**: User Story 3 is complete when admins can manage OTP state and device membership entirely through the new linking IPC domain.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Complete the migration from the legacy setup domain to the canonical linking domain and run the full validation pass.

- [x] T019 Switch the compatibility `setup` namespace in `preload.js` so `window.api.setup.*` invokes the canonical `linking:*` channels instead of the legacy `setup:*` channels
- [x] T020 Delete the legacy IPC module `main/ipc/setup.js`, remove its registration from `main/ipc/registerAll.js`, and remove the old `setup:*` exclusions from `main/sync/capture.js`
- [x] T021 Run regression validation for `main/ipc/linking.js`, `main/linking/otp.js`, `main/linking/lan.js`, `main/linking/server.js`, `preload.js`, `main/ipc/registerAll.js`, `main/sync/capture.js`, `tests/smoke.js`, and `specs/013-ipc-layer/quickstart.md` using `npm run lint`, `npm run test:smoke`, and the manual console scenarios in `specs/013-ipc-layer/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies - start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 - blocks all story work
- **Phase 3 (US1)**: Depends on Phase 2 - establishes the canonical first-device setup contract
- **Phase 4 (US2)**: Depends on Phase 2 and practically depends on US1 because a configured source institution is needed to issue a valid OTP
- **Phase 5 (US3)**: Depends on Phase 2 and US1; full revoke/roster validation is strongest after US2 creates at least one additional linked device
- **Phase 6 (Polish)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: No story dependency after the foundational phase
- **US2 (P1)**: Depends on US1 for a configured institution and an authenticated admin on the source device
- **US3 (P2)**: Depends on US1 for institution/admin context; use US2 first if you want meaningful revoke testing against a second linked device

### Within Each User Story

- Shared helper/state tasks before channel implementation
- Read and write handlers before compatibility migration
- Canonical `linking:*` contract before retiring legacy `setup:*`
- Smoke/lint/manual validation after the migration is complete

### Parallel Opportunities

- `T002` and `T003` can run in parallel after `T001`
- `T006` and `T007` can run in parallel after `T005`
- Most story-phase work in `main/ipc/linking.js` is intentionally sequential to avoid merge conflicts in the same file

---

## Parallel Example: User Story 1

```text
No recommended within-story parallel split for US1.
Implement T008 -> T009 -> T010 sequentially because all three tasks modify `main/ipc/linking.js`.
```

## Parallel Example: User Story 2

```text
After Phase 2 completes, one implementer can take T011 in `main/linking/lan.js`
while another prepares the channel logic skeleton for T012-T014 in `main/ipc/linking.js`.
Merge T011 first, then finish T012 -> T013 -> T014 sequentially.
```

## Parallel Example: User Story 3

```text
No recommended within-story parallel split for US3.
Implement T015 -> T016 -> T017 -> T018 sequentially because they share `main/ipc/linking.js`
and depend on the same DTO/error helpers.
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. Validate first-device setup through `window.api.linking` on `setup.html`
5. Stop if only the MVP is required

### Incremental Delivery

1. Setup + Foundational -> canonical linking infrastructure ready
2. Add US1 -> validate first-device setup
3. Add US2 -> validate additional-device linking
4. Add US3 -> validate admin management actions
5. Finish Phase 6 -> migrate compatibility alias and remove legacy setup IPC

### Parallel Team Strategy

1. Developer A: `main/ipc/linking.js`
2. Developer B: `preload.js`, `main/ipc/registerAll.js`, `main/sync/capture.js`
3. Developer C: `main/linking/otp.js`, `main/linking/lan.js`, `main/linking/server.js`
4. Rejoin before US1 channel work so the canonical DTO/error conventions stay consistent

---

## Notes

- Keep all canonical channel strings aligned with `specs/013-ipc-layer/contracts/linking-ipc.md`
- Use `handleRead`, `handleWrite`, and `handleWriteSoftAuth` only; do not introduce raw `ipcMain.handle()` in new linking work
- Preserve `window.api.setup` until Phase 6 so `js/pages/setup.js` keeps working during the migration
- Keep sync-capture entries excluded for this phase; sync/revocation propagation belongs to a later phase
- Final validation must cover both canonical `window.api.linking` calls and compatibility `window.api.setup` calls
