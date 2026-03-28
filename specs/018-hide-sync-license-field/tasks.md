# Tasks: Hide License Key Field from Sync Settings UI

**Input**: Design documents from `/specs/018-hide-sync-license-field/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Tests**: Not requested in spec — test tasks omitted. Validation is via `npm run lint` + `npm run test:smoke` + manual RTL check.

**Organization**: Tasks are grouped by user story. US1 and US2 touch different files and can run in parallel. US3 is a verification-only story with no code changes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: User Story 1 - Hide License Key Field (Priority: P1) 🎯 MVP

**Goal**: The license key input and its label are not visible on the sync settings page.

**Independent Test**: Open the sync settings page → confirm the license key field and label are not displayed, and remaining fields have no layout gaps.

- [x] T001 [US1] Add `hidden` attribute to the wrapper `<div>` around `cfg-license-key` label and input in settings-sync.html (line 198)

**Checkpoint**: License key field is visually hidden. Form still loads and populates the hidden field harmlessly via `loadConfig()`.

---

## Phase 2: User Story 2 - Save Without License Key (Priority: P1)

**Goal**: Form save no longer reads or sends the license key, preventing accidental overwrites of the auto-managed key.

**Independent Test**: Save sync settings → confirm success toast, and verify `sync_config.license_key` in the database is unchanged.

- [x] T002 [US2] Remove the `licenseKey` variable declaration (line 345) and its inclusion in the `updates` object (line 382) from `initConfigForm()` in js/pages/settings-sync.js

**Checkpoint**: Save payload no longer contains `licenseKey`. Auto-managed key in DB is preserved on save.

---

## Phase 3: Polish & Validation

**Purpose**: Run CI checks and verify RTL layout integrity (covers US3).

- [x] T003 Run `npm run lint` and verify zero errors
- [x] T004 Run `npm run test:smoke` and verify all tests pass (pre-existing failure in teachers-list.html — unrelated to this feature)
- [ ] T005 Manual verification: launch app with `npm run dev`, open sync settings page, confirm license key field is invisible, save settings successfully, and verify RTL layout has no gaps

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (US1)** and **Phase 2 (US2)**: Independent — touch different files, can run in parallel
- **Phase 3 (Polish)**: Depends on both Phase 1 and Phase 2 completion

### User Story Dependencies

- **User Story 1 (P1)**: No dependencies — modifies `settings-sync.html` only
- **User Story 2 (P1)**: No dependencies — modifies `js/pages/settings-sync.js` only
- **User Story 3 (P2)**: Verification only — depends on US1 completion (layout check)

### Parallel Opportunities

```bash
# T001 and T002 can run in parallel (different files):
Task: "Add hidden attribute to wrapper div in settings-sync.html"
Task: "Remove licenseKey from save logic in js/pages/settings-sync.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 + 2)

1. Execute T001 (hide field) and T002 (remove from save) — can be parallel
2. Run T003 + T004 (lint + smoke)
3. T005 manual verification
4. **Done** — feature is complete

### Incremental Delivery

1. T001 → Field hidden (US1 complete)
2. T002 → Save logic cleaned (US2 complete)
3. T003–T005 → Validation (US3 verified)

---

## Notes

- Total: 5 tasks (2 implementation, 3 validation)
- No new files created
- No data model changes
- No IPC changes
- `loadConfig()` line 321 (`setVal('cfg-license-key', ...)`) is intentionally kept per FR-004
