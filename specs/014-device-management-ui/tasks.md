# Tasks: Device Management UI

**Input**: Design documents from `/specs/014-device-management-ui/`
**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/ipc-contracts.md`, `quickstart.md`

**Tests**: Not requested as standalone story tasks. Use `npm run lint`, `npm run css:build`, `npm run test:smoke`, and the manual scenarios in `specs/014-device-management-ui/quickstart.md`.

**Organization**: Tasks are grouped by user story so each slice can be implemented and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: Which user story this task belongs to (`US1`, `US2`, `US3`, `US4`, `US5`)
- Every task includes exact file paths so another LLM can execute the work without extra repo discovery

## Path Conventions

- Renderer page markup: `settings-sync.html`
- Renderer page logic: `js/pages/settings-sync.js`
- Shared renderer bridge: `preload.js`
- Main-process device management IPC: `main/ipc/linking.js`
- Sync-capture exclusions and smoke validation: `main/sync/capture.js`, `tests/smoke.js`
- Shared Tailwind source: `css/tailwind-input.css`

---

## Phase 1: Setup (Shared UI Scaffold)

**Purpose**: Create the device-management shell and the shared renderer structure that every story builds on.

- [x] T001 Add a `device-management-section` shell with dedicated current-device, OTP, linked-devices, and setup-required placeholder containers in `settings-sync.html`
- [x] T002 [P] Add base device-management component rules for admin-only visibility, loading placeholders, table wrappers, and OTP card primitives in `css/tailwind-input.css`
- [x] T003 [P] Add shared device-management module state, DOM caching, and init placeholders in `js/pages/settings-sync.js`

**Checkpoint**: The sync settings page has a visible device-management scaffold with stable DOM hooks, but no story-specific data yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Align the linking contract, shared IPC/auth behavior, and page-level bootstrapping before any user story is implemented.

**CRITICAL**: Do not start story work until these tasks are complete.

- [x] T004 Align the six `window.api.linking` methods in `preload.js` with `specs/014-device-management-ui/contracts/ipc-contracts.md` while preserving the existing `window.api.setup` compatibility aliases
- [x] T005 Update auth wrappers and shared DTO/query helpers in `main/ipc/linking.js` so authenticated reads (`getCurrentDevice`, `getLinkedDevices`, `getOtpStatus`) and admin-only writes (`generateOtp`, `cancelOtp`, `revokeDevice`) match the device-management contract
- [x] T006 Keep linking write-channel exclusions and IPC parity expectations aligned in `main/sync/capture.js` and `tests/smoke.js` for the final device-management surface
- [x] T007 Implement shared device-management bootstrapping in `js/pages/settings-sync.js` and `settings-sync.html`, including institution-setup gating, loading states, and one retry/refresh entry point for all subsections

**Checkpoint**: The page can safely initialize the device-management area, the linking bridge exposes the required methods, and the IPC contract is ready for story work.

---

## Phase 3: User Story 1 - View Current Device Info (Priority: P1) 🎯 MVP

**Goal**: Show the signed-in user's current device identity and institution context at the top of the device-management area.

**Independent Test**: Open `settings-sync.html` on any linked device and confirm the page shows the device name, truncated device hash, MASSAR code, and institution name when available.

### Implementation for User Story 1

- [x] T008 [P] [US1] Add current-device info card markup with stable field IDs for device name, truncated hash, MASSAR code, institution name, and fallback copy in `settings-sync.html`
- [x] T009 [P] [US1] Implement the `getCurrentDevice` response contract in `main/ipc/linking.js` so any authenticated user receives device and institution fields shaped exactly for the renderer
- [x] T010 [US1] Implement current-device fetch/render logic in `js/pages/settings-sync.js`, including bidi-safe hash truncation and graceful empty-value handling
- [x] T011 [P] [US1] Add current-device card styles and setup-placeholder presentation in `css/tailwind-input.css`

**Checkpoint**: User Story 1 is complete when the current device and institution identity render correctly for both admin and non-admin users.

---

## Phase 4: User Story 2 - View Linked Devices Table (Priority: P1)

**Goal**: Show the institution's linked device roster with status, method, last-seen information, and role-aware actions.

**Independent Test**: Link at least two devices to one institution, open `settings-sync.html` on an admin device, and confirm the table shows each device with the correct metadata and no action column for non-admin sessions.

### Implementation for User Story 2

- [x] T012 [P] [US2] Add linked-devices table markup, loading row, empty-state block, error-state block, retry button, and admin-only Actions column hooks in `settings-sync.html`
- [x] T013 [P] [US2] Implement the `getLinkedDevices` query and DTO mapping in `main/ipc/linking.js`, including `linkedBy`, `lastSeenAt`, `status`, `revokedAt`, ordering, and `isCurrentDevice`
- [x] T014 [US2] Implement linked-device table rendering in `js/pages/settings-sync.js`, including Arabic labels for link method/status, relative last-seen formatting via `formatRelativeTime()`, and current-device highlighting
- [x] T015 [P] [US2] Add linked-device table styles for scrollable layout, badges, current-device emphasis, revoked rows, and hidden actions under `.sync-readonly` in `css/tailwind-input.css`
- [x] T016 [US2] Implement empty-table and fetch-error retry flows in `js/pages/settings-sync.js` so the roster can recover without reloading `settings-sync.html`

**Checkpoint**: User Story 2 is complete when admins and staff can both see the linked-device roster, with admin-only actions suppressed for staff and resilient empty/error states.

---

## Phase 5: User Story 3 - Generate OTP for Device Linking (Priority: P2)

**Goal**: Let an admin generate, view, cancel, and watch a live countdown for the active device-linking OTP.

**Independent Test**: Click the generate button as an admin, confirm the 6-digit OTP and countdown appear, cancel it or wait for expiry, and verify the panel resets correctly.

### Implementation for User Story 3

- [x] T017 [P] [US3] Add an admin-only OTP panel with generate button, six-digit display slots, countdown text, cancel button, and restored-state notice hook in `settings-sync.html`
- [x] T018 [P] [US3] Update `generateOtp`, `cancelOtp`, and `getOtpStatus` in `main/ipc/linking.js` so the renderer receives the contract fields it needs, only one OTP stays active per institution, and LAN sharing starts/stops with OTP lifecycle
- [x] T019 [US3] Implement OTP generate/cancel orchestration and a drift-free countdown timer in `js/pages/settings-sync.js` using `expiresAt` wall-clock comparisons plus `showToast()` feedback
- [x] T020 [P] [US3] Add OTP panel styles in `css/tailwind-input.css` for large 6-digit cards, timer chip, expired state, and dark-mode readability

**Checkpoint**: User Story 3 is complete when an admin can generate one active OTP, see a correct live countdown, and cancel or expire it without leaving stale UI behind.

---

## Phase 6: User Story 4 - Revoke a Linked Device (Priority: P2)

**Goal**: Let an admin revoke another linked device from the roster with confirmation and in-place status updates.

**Independent Test**: From an admin session with at least one secondary linked device, revoke that device and confirm the row switches to revoked status without allowing self-revoke.

### Implementation for User Story 4

- [x] T021 [P] [US4] Update `revokeDevice` handling in `main/ipc/linking.js` to accept the contract payload, block self-revocation, reject already revoked targets, and return stable user-facing errors
- [x] T022 [US4] Implement admin-only revoke button rendering and current-device action suppression in the linked-device row template inside `js/pages/settings-sync.js`
- [x] T023 [US4] Implement revoke confirmation, row refresh, and success/error toast handling in `js/pages/settings-sync.js` so device status updates in-place without reloading `settings-sync.html`

**Checkpoint**: User Story 4 is complete when an admin can revoke other devices safely and see the new revoked state immediately in the roster.

---

## Phase 7: User Story 5 - OTP Status Persistence Across Navigation (Priority: P3)

**Goal**: Restore the active OTP state after navigating away and back to the sync settings page during the OTP lifetime.

**Independent Test**: Generate an OTP, leave `settings-sync.html`, return before expiry, and confirm the countdown resumes correctly with either restored digits or a countdown-only fallback if the digits are no longer available.

### Implementation for User Story 5

- [x] T024 [US5] Persist freshly generated OTP digits in `sessionStorage` and shared module state inside `js/pages/settings-sync.js` without writing the OTP to `localStorage`
- [x] T025 [US5] Extend the page-load flow in `js/pages/settings-sync.js` to call `window.api.linking.getOtpStatus()`, restore active countdown state from `expiresAt`, and render a countdown-only fallback when plaintext digits are unavailable
- [x] T026 [P] [US5] Add restored-code and countdown-only notice hooks in `settings-sync.html` and matching notice styles in `css/tailwind-input.css` for navigation-return states

**Checkpoint**: User Story 5 is complete when leaving and returning to the page preserves the correct OTP state without creating a new code.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Run the final quality gates and verify the feature in the same way future implementers will validate it.

- [x] T027 Run `npm run lint` and fix issues in `main/ipc/linking.js`, `preload.js`, `settings-sync.html`, `js/pages/settings-sync.js`, `css/tailwind-input.css`, `main/sync/capture.js`, and `tests/smoke.js`
- [x] T028 Run `npm run css:build` and verify the device-management classes from `css/tailwind-input.css` are present in `css/tailwind-output.css`
- [x] T029 Run `npm run test:smoke` to validate IPC parity and sync-registry coverage for `preload.js`, `main/ipc/linking.js`, `main/sync/capture.js`, `main/ipc/registerAll.js`, and `tests/smoke.js`
- [ ] T030 Manually validate the scenarios in `specs/014-device-management-ui/quickstart.md` against `settings-sync.html` and `js/pages/settings-sync.js`, including RTL, dark mode, admin/non-admin visibility, OTP expiry/reset, revoke flow, retry states, and navigation persistence

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies - start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 - blocks all user stories
- **Phase 3 (US1)**: Depends on Phase 2 - establishes current-device context for the page
- **Phase 4 (US2)**: Depends on Phase 2 - can start alongside US1 once the shared contract and bootstrapping exist
- **Phase 5 (US3)**: Depends on Phase 2 and practically builds best on US1 because the OTP panel lives beside current-device context
- **Phase 6 (US4)**: Depends on Phase 2 and US2 because revoke actions are part of the linked-devices roster
- **Phase 7 (US5)**: Depends on Phase 5 because it extends the generated-OTP lifecycle
- **Phase 8 (Polish)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: No story dependency after the foundational phase
- **US2 (P1)**: No story dependency after the foundational phase
- **US3 (P2)**: Uses the shared device-management shell from Phase 2 and is strongest after US1 provides the current-device context
- **US4 (P2)**: Depends on US2 because revoke controls live inside the linked-devices table
- **US5 (P3)**: Depends on US3 because it restores an OTP that must already be generated

### Dependency Graph

```text
Phase 1 Setup
    -> Phase 2 Foundational
        -> US1
        -> US2 -> US4
        -> US3 -> US5
```

### Within Each User Story

- Shared markup and IPC contracts before renderer integration
- Renderer state/rendering before polish inside the same story
- Table/OTP styles can land in parallel with backend work when DOM hooks are defined
- Complete each story's checkpoint before moving to the next dependent story

### Parallel Opportunities

- Phase 1: `T002` and `T003` can run in parallel after `T001`
- Phase 2: `T004` and `T006` can proceed in parallel once the final contract direction is agreed from the spec docs
- US1: `T008`, `T009`, and `T011` can run in parallel before `T010` wires the renderer
- US2: `T012`, `T013`, and `T015` can run in parallel before `T014` and `T016` finish renderer behavior
- US3: `T017`, `T018`, and `T020` can run in parallel before `T019` integrates the OTP lifecycle into the page script
- US4: `T021` can run in parallel with table-row markup preparation, but `T022` and `T023` should stay sequential in `js/pages/settings-sync.js`
- US5: `T026` can run in parallel with the session-storage logic in `T024`, then `T025` finalizes restoration behavior

---

## Parallel Example: User Story 1

```text
Start T008 in settings-sync.html and T009 in main/ipc/linking.js together.
Add T011 in css/tailwind-input.css in parallel once the DOM hooks from T008 are fixed.
Finish T010 in js/pages/settings-sync.js after the markup and IPC payload are stable.
```

## Parallel Example: User Story 2

```text
Run T012 in settings-sync.html, T013 in main/ipc/linking.js, and T015 in css/tailwind-input.css together.
Then complete T014 -> T016 sequentially in js/pages/settings-sync.js.
```

## Parallel Example: User Story 3

```text
Run T017 in settings-sync.html, T018 in main/ipc/linking.js, and T020 in css/tailwind-input.css together.
Then complete T019 in js/pages/settings-sync.js once the markup and IPC status payload are ready.
```

## Parallel Example: User Story 4

```text
Implement T021 in main/ipc/linking.js while another implementer prepares the row-action hooks needed for T022 in js/pages/settings-sync.js.
Merge T021 first, then finish T022 -> T023 sequentially in js/pages/settings-sync.js.
```

## Parallel Example: User Story 5

```text
Implement T026 in settings-sync.html and css/tailwind-input.css while T024 adds sessionStorage support in js/pages/settings-sync.js.
Then finish T025 in js/pages/settings-sync.js after the persisted OTP state shape is settled.
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. Validate current-device identity on `settings-sync.html`
5. Stop if only the MVP is required

### Incremental Delivery

1. Setup + Foundational -> linking bridge and device-management shell are ready
2. Add US1 -> validate current device and institution context
3. Add US2 -> validate the linked-device roster
4. Add US3 -> validate OTP generation and countdown
5. Add US4 -> validate revoke flows inside the roster
6. Add US5 -> validate navigation persistence for active OTPs
7. Finish Phase 8 -> run lint, CSS build, smoke, and manual checks

### Parallel Team Strategy

1. Developer A: `main/ipc/linking.js`, `preload.js`, `main/sync/capture.js`, `tests/smoke.js`
2. Developer B: `settings-sync.html`, `css/tailwind-input.css`
3. Developer C: `js/pages/settings-sync.js`
4. Rejoin after Phase 2 so renderer work tracks the final IPC payloads without rework

---

## Notes

- Keep all device-management text and UI states in Arabic inside `settings-sync.html` and `js/pages/settings-sync.js`
- Use the existing `sync-readonly` plus `admin-only` pattern instead of inventing a new permission system
- Compute countdown time from `expiresAt`, not by decrementing a local counter, to avoid drift
- Store active OTP digits only in `sessionStorage`, never in `localStorage`
- Preserve the current `window.api.setup` compatibility surface while extending `window.api.linking`
- Reuse `formatRelativeTime()` and `showToast()` in `js/pages/settings-sync.js` for consistency with the existing sync settings page
