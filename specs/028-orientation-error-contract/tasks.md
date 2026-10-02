# Tasks: Orientation Error Contract (Hybrid Handling)

**Input**: Design documents from `/specs/028-orientation-error-contract/`  
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md  
**Tests**: Included — FR-019 / SC-005 require automated contract verification without Electron UI

**Organization**: Tasks are grouped by user story. Foundational work delivers the shared vocabulary module that all stories consume.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete work)
- **[Story]**: User story label (`[US1]`…`[US5]`) — setup/foundational/polish have no story label
- Every task includes at least one concrete file path

## Path Conventions

Electron monorepo root: `js/shared/`, `main/ipc/`, `js/pages/`, `tests/orientation/`, HTML pages at repo root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Inventory lock and directory scaffolding before any catalog deletion

- [x] T001 Create directory `js/shared/errors/` for the dual-export contract module
- [x] T002 [P] Grep and record all usages of `ORIENTATION_ERROR_CATALOG`, `ORIENTATION_DISPLAY_ERRORS`, and locked codes (`IMPORT_ROLLBACK`, `INVALID_SCHOOL_YEAR`, `INVALID_RECORD`, `DATABASE_ERROR`, `LIST_LOAD_ERROR`, `STATS_LOAD_ERROR`, `SYNC_ERROR`, `SCHOOL_YEAR_MISMATCH`) under `main/ipc/orientation.js`, `js/pages/settings-imports.js`, `js/pages/students-orientation.js`, and `tests/`
- [x] T003 [P] Confirm inventory in `specs/028-orientation-error-contract/data-model.md` matches live catalogs in `main/ipc/orientation.js`, `js/pages/settings-imports.js`, and `js/pages/students-orientation.js` (no silent renames planned)

**Checkpoint**: Inventory locked; ready to implement the shared contract without renaming production codes

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared orientation error vocabulary + pure unit tests + sanitizer export. **Blocks all user stories.**

**⚠️ CRITICAL**: No user-story consumer work until T004–T008 are done and contract unit tests pass

- [x] T004 Implement dual-export UMD module (pattern from `js/shared/gender.js`) in `js/shared/errors/orientation-error-contract.js` with pure data only: `SHARED_CODES`, `PAGE_ONLY_CODES`, metadata fields per `specs/028-orientation-error-contract/data-model.md` and `contracts/orientation-error-contract.md`
- [x] T005 Extend `js/shared/errors/orientation-error-contract.js` with pure helpers: `getDefinition`, `isShared`, `isPageOnly`, `isRetryable`, `getSeverity`, `getDefaultMessage`, `LOCKED_SHARED_CODES`, `MAX_SKIP_REASONS`
- [x] T006 Implement `normalize`, `unknownFallback` / unknown-code path, `safeDetails`, and `userMessage` (core fixed + optional presentation context string) in `js/shared/errors/orientation-error-contract.js` per research R4–R5 (flat lean+rich shapes; no nested `error` object)
- [x] T007 Export `looksLikeInternalErrorMessage` from `main/ipc/ipc-helpers.js` (and ensure `[sync:capture]` is covered by that helper or a single documented rule) without weakening Arabic pass-through sanitization
- [x] T008 Write Node unit tests in `tests/orientation/error-contract-unit.test.js` covering: every code has message+severity+retryable+classification+section; locked shared codes present; unknown fallback; `safeDetails` strip vs allowlist; `normalize` for lean and rich failure shapes and `success: true` passthrough; no DOM/`showToast` references

**Checkpoint**: `node tests/orientation/error-contract-unit.test.js` passes; contract loadable via `require` from Node

---

## Phase 3: User Story 3 — Same error means the same thing everywhere (Priority: P1) 🎯 MVP core

**Goal**: Main orientation IPC and vocabulary are single-sourced; competing main-process catalog removed; locked codes still recognized

**Independent Test**: Inspect `main/ipc/orientation.js` — no inline full catalog; shared codes resolve via contract; `node tests/orientation/error-contract-unit.test.js` + `node tests/orientation/ipc-bulk-safety.test.js` pass; SC-001 inventory for IPC side

### Tests for User Story 3

- [x] T009 [P] [US3] Extend `tests/orientation/error-contract-unit.test.js` (or add assertions in same file) to require `main/ipc/orientation.js` exports still expose compatible error mapping behavior for locked codes after catalog removal
- [x] T010 [P] [US3] Run and fix any breakages in `tests/orientation/ipc-bulk-safety.test.js` after IPC consumes the contract (prepare/bulkUpsert error paths still assert expected codes)

### Implementation for User Story 3

- [x] T011 [US3] Replace inline `ORIENTATION_ERROR_CATALOG` in `main/ipc/orientation.js` with `require('../../js/shared/errors/orientation-error-contract')` shared section only
- [x] T012 [US3] Update `inferOrientationErrorCode` and `toOrientationErrorResponse` in `main/ipc/orientation.js` to use contract defaults, `safeDetails` where details are attached, and exported `looksLikeInternalErrorMessage` from `main/ipc/ipc-helpers.js`; delete local `looksLikeInternalMessage` duplicate
- [x] T013 [US3] Preserve all five channel registrations and `IMPORT_ROLLBACK` remap / `SYNC_ERROR` / `INVALID_RECORD` detection order in `main/ipc/orientation.js`; confirm `main/repos/orientation.js` and `main/sync/capture.js` are not functionally changed
- [x] T014 [US3] Ensure module exports used by tests (`toOrientationErrorResponse`, `ORIENTATION_ERROR_CATALOG` if re-exported as contract alias, `prepareBulkUpsertPayload`, `handleBulkUpsert`, `coerceSchoolYearStrict`) remain available from `main/ipc/orientation.js` for `tests/orientation/*`

**Checkpoint**: IPC is single-sourced on shared vocabulary; bulk safety tests green; no channel renames in `preload.js`

---

## Phase 4: User Story 1 — Import failures stay accurate and actionable (Priority: P1)

**Goal**: Import page uses shared + page-only vocabulary; multi-batch **partial progress + failed batch**; no false partial commit; no clear-year on normal path

**Independent Test**: Manual/scripted import cases from `specs/028-orientation-error-contract/quickstart.md` §3; file/parse failures use page-only codes; IPC failures use shared codes; multi-batch messaging per FR-011a

### Tests for User Story 1

- [x] T015 [P] [US1] Add/extend assertions in `tests/orientation/error-contract-unit.test.js` (or `tests/orientation/ipc-bulk-safety.test.js`) for `IMPORT_ROLLBACK` retryable=true and validation codes retryable=false from shared section
- [x] T016 [US1] If multi-batch aggregation is pure-extractable, add a focused unit assertion file under `tests/orientation/` documenting expected partial-progress summary shape; otherwise document manual verification steps in commit notes against quickstart §3 rows 5–6

### Implementation for User Story 1

- [x] T017 [US1] Add deferred script tag for `js/shared/errors/orientation-error-contract.js` in `settings-imports.html` before `js/pages/settings-imports.js` (alongside other `js/shared/*` scripts)
- [x] T018 [US1] Remove local `ORIENTATION_ERROR_CATALOG` from `js/pages/settings-imports.js` and consume `OrientationErrorContract` for shared + page-only import codes (`FILE_*`, `EMPTY_FILE`, `UNSUPPORTED_FORMAT`, `INVALID_FILE_STRUCTURE`, `MISSING_*`, `INVALID_NUMERIC_VALUE`, etc.)
- [x] T019 [US1] Refactor `createOrientationError`, `isOrientationError`, and `orientationUserMessage` in `js/pages/settings-imports.js` to use contract `getDefaultMessage` / `userMessage` / `normalize` while allowing presentation context (FR-002a) without a second full catalog
- [x] T020 [US1] Preserve import behaviors in `js/pages/settings-imports.js`: hard year match, dedupe, batch size 500, summary counts, never call `orientation:clearYear` on normal path, distinguish IPC throw vs `success:false`
- [x] T021 [US1] Implement/verify multi-batch outcome in `js/pages/settings-imports.js`: accurate committed-batch summary + separate failed-batch failure (`IMPORT_ROLLBACK` or mapped code); do not hide prior success; do not claim failed batch rows permanently saved; do not imply earlier batches were undone (FR-011a)

**Checkpoint**: Import story independently demoable; competing import catalog gone

---

## Phase 5: User Story 2 — Orientation display recovers partially (Priority: P1)

**Goal**: Display page uses contract; independent list/stats/chart recovery; **silent** stale discard; **visible non-blocking** wrong-year notice; empty ≠ error

**Independent Test**: Quickstart §4; rapid year switch produces no toast spam; wrong-year shows notice; chart fail keeps tables/KPIs

### Tests for User Story 2

- [x] T022 [P] [US2] Assert in `tests/orientation/error-contract-unit.test.js` that page-only codes `STALE_RESPONSE`, `YEAR_RESPONSE_MISMATCH`, and `CHART_RENDER_ERROR` exist with expected retryable/severity metadata

### Implementation for User Story 2

- [x] T023 [US2] Add deferred script tag for `js/shared/errors/orientation-error-contract.js` in `students-orientation.html` before page logic (near other `js/shared/*` tags)
- [x] T024 [US2] Remove `ORIENTATION_DISPLAY_ERRORS` from `js/pages/students-orientation.js` and consume `OrientationErrorContract` for shared load codes + page-only display codes
- [x] T025 [US2] Refactor `createDisplayError`, `displayUserMessage`, and `ensureOk` in `js/pages/students-orientation.js` to use contract `normalize` / `userMessage` without competing catalog definitions
- [x] T026 [US2] Preserve `loadGeneration` stale discard in `js/pages/students-orientation.js`: ordinary stale responses drop **silently** (no toast, no status spam) per FR-012a; never treat as empty year
- [x] T027 [US2] Enforce wrong-year handling in `js/pages/students-orientation.js`: reject `YEAR_RESPONSE_MISMATCH` without overwriting content; show visible non-blocking notice via `showToast` and/or status line; not full-page hard error; not silent discard (FR-012b)
- [x] T028 [US2] Preserve independent list vs stats failure recovery and isolated `CHART_RENDER_ERROR` (tables/KPIs remain) in `js/pages/students-orientation.js`

**Checkpoint**: Display story independently demoable; no competing display catalog

---

## Phase 6: User Story 4 — Failures stay private and safe (Priority: P2)

**Goal**: No internal leakage in user-visible orientation failures; allowlisted details only; diagnostic logs stay sanitized

**Independent Test**: Force internal-style failure; UI has no SQL/stack/path; details only allowlisted keys (SC-004)

### Tests for User Story 4

- [x] T029 [P] [US4] Expand `tests/orientation/error-contract-unit.test.js` with unsafe detail payloads (SQL, paths, stacks, unbounded arrays) asserting `safeDetails` strips them and allowlisted counts/year/operation remain
- [x] T030 [US4] Add/extend test coverage that `toOrientationErrorResponse` in `main/ipc/orientation.js` never returns messages matching internal patterns (`SQLITE`, `.js:line`, `Error:`) when raw Error has internal text — via existing or new case in `tests/orientation/ipc-bulk-safety.test.js` or unit helper import

### Implementation for User Story 4

- [x] T031 [US4] Wire `safeDetails` into `toOrientationErrorResponse` detail attachment in `main/ipc/orientation.js` so outbound `details` always pass the allowlist
- [x] T032 [US4] Verify main-boundary logging path used by orientation handlers still records code/channel/safe context only (via existing `main/diagnostics/error-log.js` usage in `main/ipc/ipc-helpers.js`); do not log full files, tokens, raw SQL, or full student payloads from orientation failure paths
- [x] T033 [US4] Spot-check import and display userMessage paths in `js/pages/settings-imports.js` and `js/pages/students-orientation.js` never prefer raw exception text over contract defaults for unknown/internal errors

**Checkpoint**: SC-004 satisfied; privacy rules test-backed

---

## Phase 7: User Story 5 — Contributors can extend without reintroducing drift (Priority: P3)

**Goal**: Document ownership and checklist step so new orientation (and future domain) errors use the contract pattern

**Independent Test**: Reviewer finds single vocabulary file + checklist step within five minutes (SC-008)

### Implementation for User Story 5

- [x] T034 [P] [US5] Add file-header ownership note in `js/shared/errors/orientation-error-contract.js` (shared vs page-only rules; no DOM/Electron; locked codes)
- [x] T035 [P] [US5] Update `docs/plans/2026-07-15-add-write-channel-checklist.md` with a step: when a domain has a shared error contract, consumers must use it (no parallel catalogs)
- [x] T036 [US5] Optionally note orientation error-contract pattern under manual section of `Agents.md` (or leave pointer in checklist only) without duplicating full inventory

**Checkpoint**: Contributor path clear; SC-008 reviewable

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final verification across stories

- [x] T037 Grep repo for leftover `ORIENTATION_ERROR_CATALOG` / `ORIENTATION_DISPLAY_ERRORS` / local `looksLikeInternalMessage` in `js/pages/` and `main/ipc/orientation.js` and remove obsolete aliases only after all references migrated
- [x] T038 [P] Run `npm run lint` and fix issues introduced in `js/shared/errors/orientation-error-contract.js`, `main/ipc/orientation.js`, `main/ipc/ipc-helpers.js`, `js/pages/settings-imports.js`, `js/pages/students-orientation.js`, `tests/orientation/`
- [x] T039 [P] Run `npm run test:smoke` and confirm IPC parity (no `preload.js` channel changes expected)
- [x] T040 Run `node tests/orientation/error-contract-unit.test.js`, `node tests/orientation/ipc-bulk-safety.test.js`, and `node tests/orientation/merge-and-map.test.js`
- [x] T041 Execute manual checklist in `specs/028-orientation-error-contract/quickstart.md` (import + display + safety rows) and record pass/fail notes
- [x] T042 Confirm `main/repos/orientation.js`, `preload.js`, and `main/sync/capture.js` remain functionally unchanged for this feature

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: Immediate
- **Phase 2 (Foundational)**: Depends on Phase 1 — **blocks all user stories**
- **Phase 3 (US3)**: Depends on Phase 2 — wires IPC; recommended MVP after foundation
- **Phase 4 (US1)**: Depends on Phase 2; **strongly depends on Phase 3** for live IPC shared codes (import page can load contract earlier for page-only codes only)
- **Phase 5 (US2)**: Depends on Phase 2; **strongly depends on Phase 3** for list/stats IPC failures
- **Phase 6 (US4)**: Depends on Phase 3 (IPC boundary); benefits from Phase 4–5 message paths existing
- **Phase 7 (US5)**: Can start after Phase 2 in parallel with stories; best after US3 so docs match reality
- **Phase 8 (Polish)**: After all intended stories complete

### User Story Dependencies

```text
Phase 2 Foundational (contract + tests + sanitizer export)
        │
        ▼
      US3 (IPC single catalog)  ←── MVP core
     /    \
    ▼      ▼
  US1      US2     (import page / display page — parallelizable after US3)
    \      /
     ▼    ▼
      US4 (privacy hardening + tests)
        │
        ▼
      US5 (docs/checklist) ── can draft earlier [P]
        │
        ▼
     Polish
```

- **US3**: No dependency on US1/US2
- **US1 / US2**: Independent of each other after US3
- **US4**: Builds on US3 (and validates US1/US2 userMessage safety)
- **US5**: Docs; low code risk

### Within Each Story

- Tests listed before implementation where present; implement contract first so tests can pass against real module
- Do not delete page catalogs until HTML script tag loads the contract
- Preserve behavior (batching, generation token, clear-year isolation) while swapping catalog source

### Parallel Opportunities

- T002 / T003 after T001
- T009 / T010 after foundational
- US1 (T017–T021) and US2 (T023–T028) in parallel after US3
- T034 / T035 in parallel
- T038 / T039 in parallel during polish

---

## Parallel Example: After US3

```bash
# Developer A — Import (US1)
# T017 settings-imports.html
# T018–T021 js/pages/settings-imports.js

# Developer B — Display (US2)
# T023 students-orientation.html
# T024–T028 js/pages/students-orientation.js

# Developer C — Privacy tests (US4 start)
# T029 tests/orientation/error-contract-unit.test.js
```

---

## Parallel Example: Foundational

```bash
# Sequential recommended (same module file):
# T004 → T005 → T006 in js/shared/errors/orientation-error-contract.js
# T007 in main/ipc/ipc-helpers.js can run once API shape of sanitizer is clear
# T008 tests after T006
```

---

## Implementation Strategy

### MVP First (Foundational + US3)

1. Phase 1 Setup  
2. Phase 2 Contract + unit tests  
3. Phase 3 US3 IPC integration  
4. **STOP and VALIDATE**: contract tests + ipc-bulk-safety + smoke  
5. Demo: single vocabulary on the service boundary

### Incremental Delivery

1. MVP (US3) → stable IPC codes  
2. US1 import page → actionable import failures + partial progress  
3. US2 display page → stale silent / wrong-year visible  
4. US4 privacy tests + detail filter on wire  
5. US5 docs + polish  

### Suggested MVP Scope

**T001–T014** (Setup + Foundational + US3). Delivers SC-001 on the IPC side and unlocks both pages.

---

## Notes

- Do **not** implement sibling `js/shared/ipc-result.js` in this feature  
- Do **not** change preload channel names or add DB migrations  
- Do **not** introduce nested `{ error: { code, message } }`  
- Repo SQL/transaction/`capture-port` stays as-is  
- Commit after each phase checkpoint when green  

---

## Task Summary

| Phase | Story | Task IDs | Count |
|-------|-------|----------|-------|
| 1 Setup | — | T001–T003 | 3 |
| 2 Foundational | — | T004–T008 | 5 |
| 3 US3 Vocabulary/IPC | US3 | T009–T014 | 6 |
| 4 US1 Import | US1 | T015–T021 | 7 |
| 5 US2 Display | US2 | T022–T028 | 7 |
| 6 US4 Privacy | US4 | T029–T033 | 5 |
| 7 US5 Contributors | US5 | T034–T036 | 3 |
| 8 Polish | — | T037–T042 | 6 |
| **Total** | | **T001–T042** | **42** |

| Story | Task count |
|-------|------------|
| US1 Import | 7 |
| US2 Display | 7 |
| US3 Vocabulary (IPC) | 6 |
| US4 Privacy | 5 |
| US5 Contributors | 3 |
| Setup + Foundational + Polish | 14 |

**Format validation**: All tasks use `- [ ]`, sequential `Tnnn`, optional `[P]`, story labels only on US phases, and concrete file paths.
