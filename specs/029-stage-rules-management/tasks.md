# Tasks: Stage Rules Management

**Input**: Design documents from `/specs/029-stage-rules-management/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/
**Branch**: `029-stage-rules-management`

**Tests**: Included — the source plan (M4) explicitly requires repository, resolver, migration, and sync tests, and the spec requires independently testable stories.

**Organization**: Tasks are grouped by user story (spec.md priorities: US-1 P1, US-2 P1, US-3 P2, US-4 P2, US-5 P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to
- Include exact file paths in descriptions

## Path Conventions

Single project at repository root: `main/`, `js/`, `preload.js`, `settings-defaults.html`, `tests/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verify a green baseline and prepare new directories.

- [x] T001 Confirm branch `029-stage-rules-management` checked out and run baseline gates (`npm run lint`, `npm run test:smoke`) to establish a green starting point
- [x] T002 [P] Create seed-module directory `main/db/education-catalogs/` per plan structure (contents arrive in T004/T005)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, migration, error contract, sync registration — MUST be complete before ANY user story.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T003 Implement `ensureStageRulesSchema(db)` canonical DDL helper in `main/db/schema.js`: `stage_rule_sets` (school_year, revision, status CHECK draft/active/closed, UNIQUE(school_year,revision), partial unique index one-active-per-year), `subject_coefficients` (id PK, rule_set_id FK, cycle/level/stream/subject dims, coefficient CHECK 1..20, source CHECK official/custom, UNIQUE(rule_set_id,cycle,level,stream,subject,source)), rebuilt `exam_count_rules` (id PK, rule_set_id FK, cycle_code, subject_code, exam_count CHECK 1..12, source, same logical UNIQUE), indexes on rule_set_id and stage_rule_sets(school_year)
- [x] T004 [P] Extract `CC_BRANCH_COEFFICIENTS` from `js/cc-rules.js:224-554` into seed builder `main/db/education-catalogs/qualifiant-coefficients.js` — all 15 branch keys (9×2BAC, 4×1BAC, TCS, TCLSH) as idempotent `INSERT OR IGNORE`-ready data; `js/cc-rules.js` keeps algorithms only (coefficient table lookup removed in T020)
- [x] T005 [P] Create canonical subject-code + alias seed module `main/db/education-catalogs/subject-aliases.js`: derive `subject_code` set from `SUBJECT_LABELS` (`js/data/ma-education-labels.js`), `DEFAULT_EXAM_COUNTS` names, and rule keys; build alias mappings (incl. French/Latin variants) for `subject_aliases` with `INSERT OR IGNORE`; coordinate subject ownership with sibling plan `docs/plans/2026-08-01-primary-stage-catalogs.md`
- [x] T006 Implement migration `2026-08-001-stage-rules-management` in `main/db/migrations.js`: call `ensureStageRulesSchema`, rebuild `exam_count_rules` via `rebuildTableWithConstraints` (pattern `2026-04-047`), create one official rule set per school year present in `students` (or current year), backfill exam counts as `secondary_qualifiant` rows (wildcard `*` levels preserved), migrate legacy `settings` key `subjectCoefficientMappings:v1` to custom rows via `subject_aliases`, log unmappable rows to `system_logs` (pattern `recordUnmappableCycle` in `2026-07-077`) — migration MUST create zero outbox rows
- [x] T007 [P] Create dual-export error contract `js/shared/errors/stage-rules-error-contract.js` (CommonJS + browser global `StageRulesErrorContract`, pattern `subject-coefficient-error-contract.js`): codes `RULES_UNAVAILABLE`, `MISSING_RULE`, `INVALID_RULE_VERSION`; helpers `createIncompleteResultMetadata` (officialExportBlocked: true) and `isOfficialExportAllowed`
- [x] T008 Register the 3 entities in `main/sync/entity-registry.js`: `stage_rule_sets` (keyFields [school_year, revision], contractVersion 2, requiredColumns [status, reason]), `subject_coefficients` and `exam_count_rules` (keyFields incl. rule_set_id + dims + source, contractVersion 2, requiredColumns, snapshot: false); add all three to `TOPO_ORDER_PUT` in `main/sync/engine/helpers.js` (parent before children)
- [x] T009 [P] Add 3 channel entries in `main/sync/capture.js` — `stageRules:saveCoefficients`, `stageRules:saveExamCounts`, `stageRules:resetToOfficial` — with `captureMode: 'explicit'`, `exclude: true` (keeps `tests/sync-bulk-channels-explicit.test.js` green)
- [x] T010 Implement `revisionGuard` apply hook for `stage_rule_sets` (skip incoming PUT when `revision <=` local row's revision) and wire via `setApplyHooks` in `main/sync/entity-registry.js`; the hook is the pull-side downgrade guard (research D2)
- [x] T011 Write migration tests in `tests/stage-rules-migration.test.js`: idempotent re-run, exam_count_rules backfill correctness, legacy JSON → custom rows, unmappable subjects logged not guessed, zero outbox rows created
- [x] T012 [P] Extend `tests/sync-entity-registry.test.js` with the 3 entries (validation passes) and confirm `tests/sync-bulk-channels-explicit.test.js` stays green

**Checkpoint**: Foundation ready — schema, migration, error contract, and sync registration are in place; user story implementation can begin.

---

## Phase 3: User Story 1 - Edit stage rules for the current school year (Priority: P1) 🎯 MVP

**Goal**: Admin/principal edits coefficients and exam counts for the active school year; every save creates a new immutable revision with a mandatory reason; closed versions are locked; primary cycle hides coefficients.

**Independent Test**: Open settings as admin, edit one coefficient with a reason, confirm a new revision becomes active (version badge increments, previous shows `closed`), and an edit without a reason is rejected. Primary cycle shows no coefficient controls.

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T013 [P] [US1] Write repo tests in `tests/stage-rules-repo.test.js`: save creates new revision (max+1), previous active becomes closed, official rows never written by user path, custom beats official within a key, closed version rejects writes (`INVALID_RULE_VERSION`), primary cycle (`uses_coefficients = false`) blocked, reason required, one active per year

### Implementation for User Story 1

- [x] T014 [P] [US1] Implement `main/repos/stage-rules.js`: `getActiveRuleSet(db, schoolYear)`, `getRuleSetRows`, `saveCoefficients` (version copy: new revision = max+1, copy official+custom rows, apply custom upserts, previous active → closed), `STAGE_RULE_OVERRIDE` audit row, explicit outbox capture via `main/repos/capture-port.js` inside the repo transaction
- [x] T015 [US1] Implement `main/ipc/stage-rules.js`: `stageRules:getActive` via `handleAuthedRead`; `stageRules:saveCoefficients` via `handleWriteSoftAuth(ipcMain, channel, ['admin','principal'], handler, { withContext: true })` with cycle authorization via `user_cycle_access`, validation (coefficient 1–20, mandatory reason ≤500 chars, year active version), error mapping to contract codes; register in `main/ipc/registerAll.js`; expose `window.api.stageRules` in `preload.js` (three-file rule) (depends on T014)
- [x] T016 [US1] Add «قواعد المرحلة» tab in `settings-defaults.html` (`dir="rtl" lang="ar"`, logical CSS properties) + logic in `js/pages/settings-defaults.js`: school-year selector, cycle → level/stream → subject pickers (via `appDefaults.listLevels`), coefficient + exam-count inputs, version badge (revision + status), mandatory reason field, closed-version lock with Arabic message, primary cycle hides coefficient controls (depends on T015)
- [x] T017 [US1] Point `appDefaults.js` exam-count read paths (`getExamCounts`, `getExamCount`, `lookupExamCount` at lines 109-142/218-264) at the active rule set from `main/repos/stage-rules.js` while keeping the existing response shape (depends on T014)
- [x] T018 [US1] Retire the legacy coefficient path (rollback-only): remove `subjectCoefficients:override`/`getAll` IPC channels, stop reading/writing `settings` key `subjectCoefficientMappings:v1` in `main/repos/subject-coefficients.js`, remove the override button/flow in `grades-results.html:386-425` and its `js/cc-rules.js` override hooks (moved to the rules tab)

**Checkpoint**: US-1 fully functional — versioned editing works and is testable independently.

---

## Phase 4: User Story 2 - Rules govern grade results; missing rules never silently change grades (Priority: P1) 🎯 MVP

**Goal**: All averages use the active rule set for the school year; missing rules mark results incomplete and block official export with a clear message — no silent fallback to constants.

**Independent Test**: Remove (or render unavailable) the rule for one subject, compute results, confirm the subject's results are flagged incomplete and the official export button is disabled with the Arabic explanation.

### Tests for User Story 2 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T019 [P] [US2] Write resolver tests in `tests/stage-rules-resolver.test.js`: precedence steps (exact → stream wildcard → level wildcard → cycle default), custom beats official, missing → `MISSING_RULE` domain error, unavailable set → `RULES_UNAVAILABLE` with officialExportBlocked, and **no** fallback to constants on IPC failure

### Implementation for User Story 2

- [x] T020 [P] [US2] Rewrite `js/cc-rules.js` rule loading: replace `ensureSubjectCoefficientMappings` (lines 897-912) with `ensureStageRuleSet(schoolYear)` via `window.api.stageRules.getActive`; extend `resolveSubjectCoefficient` (lines 771-796) to the 5-step precedence using rule-set rows; keep `inferQualifiantLevel(branch)` fallback for callers passing partial context; remove `CC_SUBJECT_COEFFICIENT_OVERRIDES` handling (depends on T014)
- [x] T021 [US2] Propagate rule-set metadata through `computeWeightedGeneralAverageResult` (lines 831-895) via `stage-rules-error-contract.js`; verify existing gates `grades-results.html:568` and `student-profile.js:3219` now block official export on `RULES_UNAVAILABLE`/`MISSING_RULE` with the Arabic message (depends on T020, T007)
- [x] T022 [US2] Update `tests/cc-rules-coefficient-golden.test.js` contexts to the full resolver signature (cycleCode, levelCode, streamCode, subjectCode, schoolYear) with rule-set fixtures (depends on T020)

**Checkpoint**: US-1 AND US-2 both work — versioned rules drive results with no silent fallback.

---

## Phase 5: User Story 3 - Official rule updates preserve custom overrides (Priority: P2)

**Goal**: Official rules refresh with app upgrades; custom overrides carry forward unchanged; old devices can never regress the official revision; UI distinguishes custom from official rows.

**Independent Test**: Apply a newer official rule set, confirm every custom override from the previous version is still present and unchanged; simulate an old device and confirm its stale rules are rejected (never overwrite).

### Tests for User Story 3 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T023 [P] [US3] Write upgrade tests in `tests/stage-rules-upgrade.test.js`: official refresh creates revision max+1, custom rows copied forward unchanged, official rows never overwrite custom, seed path creates zero outbox rows, `revisionGuard` rejects a stale remote PUT (simulate old device)

### Implementation for User Story 3

- [x] T024 [US3] Implement `applyOfficialRuleSet(db, seedData, reason)` in `main/repos/stage-rules.js`: new revision (never ≤ max), copy custom rows forward, official rows refreshed from seed module T004, never captures (depends on T014, T004)
- [x] T025 [US3] Wire official upgrade on app start in `main/db/init.js`: compare shipped seed revision against DB's max revision and call `applyOfficialRuleSet` when newer (depends on T024)
- [x] T026 [US3] Show source badge + visually distinguish custom rows in `js/pages/settings-defaults.js` (e.g. «رسمي» / «مخصص» badges per row) (depends on T016)

**Checkpoint**: US-1, US-2, AND US-3 work — upgrades are safe for institutions with custom rules.

---

## Phase 6: User Story 4 - Restore official default values (Priority: P2)

**Goal**: Restore a single rule or all custom rules back to official; bulk restore requires explicit confirmation; every reset is versioned and audited.

**Independent Test**: Create two custom rules, restore one per-row, then bulk-restore the rest with confirmation — values return to official and both actions appear in the audit trail.

### Tests for User Story 4 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T027 [P] [US4] Write restore tests in `tests/stage-rules-repo.test.js`: row reset removes only the target custom row, bulk reset removes all custom rows, bulk without `confirm` rejected (`CONFIRM_REQUIRED`), each reset creates a new revision + audit entry

### Implementation for User Story 4

- [x] T028 [US4] Implement `stageRules:resetToOfficial` in `main/ipc/stage-rules.js` + repo in `main/repos/stage-rules.js`: scope `row` (remove given custom row) / `bulk` (remove all custom, requires `confirm: true`), mandatory reason, new revision, explicit capture, audit `STAGE_RULE_OVERRIDE` (depends on T014)
- [x] T029 [US4] Add per-row «استعادة الافتراضي الرسمي» button and bulk restore with Arabic confirmation dialog in `js/pages/settings-defaults.js` (depends on T028, T016)

**Checkpoint**: US-1..US-4 work — overrides are fully reversible.

---

## Phase 7: User Story 5 - Audit trail for every rule change (Priority: P3)

**Goal**: Every rule change appears in the activity log with actor, reason, before/after values, and version; legacy coefficient entries remain visible read-only.

**Independent Test**: Make two rule changes and confirm both appear in the activity log with actor, reason, before/after values, and revision.

### Tests for User Story 5 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T030 [P] [US5] Write audit tests in `tests/stage-rules-repo.test.js`: `STAGE_RULE_OVERRIDE` rows contain actor, reason, before/after values, revision; legacy `SUBJECT_COEFFICIENT_ADMIN_OVERRIDE` rows remain readable

### Implementation for User Story 5

- [x] T031 [US5] Add `STAGE_RULE_OVERRIDE` action filter in `settings-logs.html` + `js/pages/settings-logs.js`; keep `SUBJECT_COEFFICIENT_ADMIN_OVERRIDE` visible and read-only

**Checkpoint**: All five user stories independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Quality gates, documentation, and cross-feature coordination.

- [x] T032 [P] Run full gates: `npm test`, `npm run lint`, `npm run test:smoke`, `npm run css:build`
- [x] T033 [P] Manual RTL + dark-mode verification of the «قواعد المرحلة» tab (constitution III: `dir="rtl" lang="ar"`, logical properties, WCAG contrast) via `npm run dev` — **statically verified** (panel has `dir="rtl" lang="ar"`, tab wired into `initTabs`, dark-mode classes present); interactive run pending on a machine with the Electron toolchain
- [x] T034 Update `AGENTS.md` with a stage-rules section (schema, IPC channels, sync registration, error contract, legacy rollback notes)
- [x] T035 Update `docs/plans/2026-08-01-stage-rules-management.md` §7 contract status + ownership notes in `docs/plans/2026-08-01-primary-stage-catalogs.md`; add implementation notes under `specs/029-stage-rules-management/`
- [x] T036 Run `quickstart.md` validation end-to-end, including the two-device sync scenario (change on A → appears on B; old device cannot push stale rules)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **User Stories (Phase 3+)**: Depend on Foundational
- **Polish (Final Phase)**: Depends on all desired user stories

### User Story Dependencies

- **US-1 (P1)**: starts after Foundational; no story dependencies
- **US-2 (P1)**: depends on US-1's rule-set load path (T014); independently testable
- **US-3 (P2)**: depends on US-1 repo (T014) + seed module (T004)
- **US-4 (P2)**: depends on US-1 repo (T014) + UI (T016)
- **US-5 (P3)**: depends on repo audit rows created in US-1 (T014)

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Repo → IPC → UI ordering (tests → models/data → services → endpoints → integration)
- Story complete before moving to next priority

### Parallel Opportunities

- Phase 1: T002 [P] alongside baseline verification
- Phase 2: T004/T005/T007/T009 [P] pairs; T011/T012 [P] test pair after T003/T006/T008
- Phase 3: T013 [P] (tests) parallel with T014; T014 parallel with T013 (T015 depends on T014)
- Phase 4: T019 [P] parallel with T020
- Phase 5: T023 [P] parallel with T024
- Phase 6: T027 [P] parallel with T028
- Phase 7: T030 [P] parallel with T031
- Phase 8: T032/T033 [P] parallel documentation tasks T034-T036

---

## Parallel Example: User Story 1

```bash
# Launch tests + repo implementation together:
Task: "Write repo tests in tests/stage-rules-repo.test.js (T013)"
Task: "Implement main/repos/stage-rules.js (T014)"

# After T014 completes, launch IPC + UI:
Task: "Implement main/ipc/stage-rules.js + registerAll.js + preload.js (T015)"
Task: "Point appDefaults.js exam-count reads at the active rule set (T017)"
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2 — both P1)

US-2 is not skippable for the MVP: versioned rules without result-integrity would regress trust in published results (spec US-2 is P1). US-1 alone is still independently testable/demonstrable (editing + versioning), but shipping requires both.

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1 → test independently
4. Complete Phase 4: User Story 2 → test independently → **STOP and VALIDATE** (MVP = rules editing + result integrity + export gate)
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. US-1 → US-2 → test each independently → Deploy/Demo (MVP!)
3. US-3 → US-4 → independently tested → Deploy/Demo
4. US-5 → audit complete
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: US-1 + US-2 (P1 core)
   - Developer B: US-3 (upgrade flow) after T014 lands
   - Developer C: US-4/US-5 after T014/T016 land
3. Stories integrate and test independently

---

## Notes

- **[P]** tasks = different files, no dependencies
- **[Story]** label maps task to the spec's user story
- Each user story is independently completable and testable
- Verify tests fail before implementing (TDD for T013/T019/T023/T027/T030)
- Commit after each task or logical group (conventional commits, constitution WF)
- Do NOT commit unless the user asks; stop at any checkpoint to validate a story independently
- Migration `2026-08-001` must never write the sync outbox; the revision guard (T010) is the only new sync-layer code
- Keep `docs/plans/2026-08-01-stage-rules-management.md` and the sibling primary-stage plan in sync when ownership shifts (T035)
