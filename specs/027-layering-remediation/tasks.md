# Tasks: Main-Process Layering Remediation

**Input**: Design documents from `/specs/027-layering-remediation/`  
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md  

**Tests**: Included — spec FR-011/FR-012 and SC-002/SC-003/SC-004 require automated unit tests without Electron UI.

**Organization**: Tasks grouped by user story (US1–US5). Foundational capture-port work blocks domain and auth extractions.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no incomplete dependencies)
- **[Story]**: User story label (`[US1]`…`[US5]`) for story phases only
- Every task includes at least one concrete file path

## Path Conventions

- Main process: `main/repos/`, `main/ipc/`, `main/auth/`, `main/sync/`
- Tests: `tests/*.test.js`
- Docs: `docs/plans/`, `Agents.md`, `CLAUDE.md`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Standing guardrails and contributor visibility before code moves (supports US5 / SC-006 early).

- [x] T001 Add standing layering rule (new domain SQL in `main/repos/*` only; IPC = auth + validation + orchestration) under MANUAL ADDITIONS in `Agents.md`
- [x] T002 [P] Mirror the same layering rule in the architecture / recent-changes section of `CLAUDE.md` if not already covered by agent-context sync
- [x] T003 [P] Update write-channel steps in `docs/plans/2026-07-15-add-write-channel-checklist.md` to require repos + `main/repos/capture-port.js` (and note `captureMode: 'explicit'` for bulk)
- [x] T004 Confirm feature branch and design docs present under `specs/027-layering-remediation/` (plan.md, contracts/, quickstart.md) — no code change if already complete

**Checkpoint**: Contributors can cite the “no new SQL in IPC” rule before any refactor lands.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Capture-port inversion for existing students/grades/absences repos (FR-004, SC-004). **BLOCKS** all domain extraction and auth repo work that uses capture.

**⚠️ CRITICAL**: Do not start US2/US3 repo extractions until this phase is green.

- [x] T005 Implement `main/repos/capture-port.js` per `specs/027-layering-remediation/contracts/capture-port.md` (`getCapturePort`, `setRepoCapturePort`, `createNoOpCapturePort`, `createDefaultCapturePort`, and bound helpers used by repos)
- [x] T006 Replace direct `require('../sync/capture')` with `./capture-port` in `main/repos/students.js`
- [x] T007 [P] Replace direct `require('../sync/capture')` with `./capture-port` in `main/repos/grades.js`
- [x] T008 [P] Replace direct `require('../sync/capture')` with `./capture-port` in `main/repos/absences.js`
- [x] T009 Add unit tests for default vs no-op port behavior in `tests/repos-capture-port.test.js`
- [x] T010 Update imports/assumptions if needed so bulk capture still passes in `tests/sync-exact-bulk-capture.test.js`
- [x] T011 [P] Confirm key-field tests still pass via `tests/repos-domain-key-fields.test.js`
- [x] T012 Run `npm run lint` and `npm run test:smoke` and fix any regressions from capture-port wiring

**Checkpoint**: Existing repos unit-testable with no-op capture; production default still writes outbox; smoke green.

---

## Phase 3: User Story 1 — Preserve school operations (Priority: P1) 🎯 MVP baseline

**Goal**: After foundational capture rewire (and after each later domain slice), school-facing behavior stays identical: login/session control path, already-extracted student domain, and no silent sync drop.

**Independent Test**: Smoke green; student list/update works; one tracked student/grade/absence write still produces capture intent with default port; no internal SQL errors in UI.

### Implementation & verification for User Story 1

- [x] T013 [US1] Spot-check student IPC still delegates only to repo (no new SQL) in `main/ipc/students.js`
- [x] T014 [P] [US1] Spot-check grades IPC remains thin in `main/ipc/grades.js`
- [x] T015 [P] [US1] Spot-check absences IPC remains thin in `main/ipc/absences.js`
- [x] T016 [US1] Run control-domain automated suite: `node tests/sync-exact-bulk-capture.test.js` and `node tests/repos-domain-key-fields.test.js`
- [x] T017 [US1] Run `npm run test:smoke` as the contract gate after Phase 2
- [x] T018 [US1] Execute manual control rows from `specs/027-layering-remediation/quickstart.md` (login smoke optional here; student path + sanitized error spot-check) and record pass/fail in a short note under `specs/027-layering-remediation/checklists/` or commit message

**Checkpoint**: MVP = capture-port landed with **zero intentional behavior change**. Safe to extract fat domains.

---

## Phase 4: User Story 2 — Verify high-churn domains without desktop UI (Priority: P1)

**Goal**: Move exams, staff/teachers, and orientation SQL into repos; thin IPC; unit tests without Electron (FR-003, FR-012, SC-002).

**Independent Test**: `node tests/repos-exams.test.js`, `repos-staff.test.js`, `repos-orientation.test.js` pass without launching Electron; smoke still green; channels unchanged in `preload.js`.

### Exams

- [x] T019 [US2] Create `main/repos/exams.js` and move all domain SQL/transactions from `main/ipc/exams.js` (exams, proctors, rooms, tests, invitations, attendance) using `./capture-port` for bulk/generate capture
- [x] T020 [US2] Thin `main/ipc/exams.js` to auth + `requireFields`/`requireSchoolYear` + `examsRepo` calls only (preserve return shapes)
- [x] T021 [US2] Ensure teacher resolution stays out of renderer: call `main/teachers/identity.js` from `main/repos/exams.js` (or remaining thin IPC only if unavoidable)
- [x] T022 [US2] Add happy-path + at least one failure/validation case in `tests/repos-exams.test.js` (temp SQLite, no-op capture-port)
- [x] T023 [US2] Run `npm run test:smoke` after exams extraction

### Staff / teachers

- [x] T024 [US2] Create `main/repos/staff.js` and move SQL from `main/ipc/staff.js` (teachers CRUD, aliases, bulk import, delete cascades) via capture-port where capture exists today
- [x] T025 [US2] Thin `main/ipc/staff.js` to validation + `staffRepo` orchestration only
- [x] T026 [US2] Add happy-path + failure case in `tests/repos-staff.test.js`
- [x] T027 [US2] Run `npm run test:smoke` after staff extraction

### Orientation

- [x] T028 [US2] Create `main/repos/orientation.js` and move list/stats/merge-import/clear/delete SQL and pure normalize helpers from `main/ipc/orientation.js`
- [x] T029 [US2] Thin `main/ipc/orientation.js` to validation + `orientationRepo` calls only
- [x] T030 [US2] Add merge/import and clearYear (or delete) coverage in `tests/repos-orientation.test.js`
- [x] T031 [US2] Run `npm run test:smoke` after orientation extraction
- [x] T032 [US2] Confirm `preload.js` has **no** channel renames for exams/teachers/orientation namespaces

**Checkpoint**: Three high-churn domains unit-testable without UI; IPC thin for those modules.

---

## Phase 5: User Story 1 (continued) — Full non-regression after domain extraction (Priority: P1)

**Goal**: Complete SC-001 for exams, staff, orientation write paths + sync eligibility after US2 extractions.

**Independent Test**: Manual checklist rows 1–7 in `quickstart.md` pass on a representative dataset.

- [x] T033 [US1] Manual regression: exams write path per `specs/027-layering-remediation/quickstart.md`
- [x] T034 [P] [US1] Manual regression: staff/teachers write path per `specs/027-layering-remediation/quickstart.md`
- [x] T035 [P] [US1] Manual regression: orientation write path per `specs/027-layering-remediation/quickstart.md`
- [x] T036 [US1] Manual regression: sync push after a tracked write (quickstart row 7)
- [x] T037 [US1] Spot-check sanitized errors (SC-007) for one forced write failure on a migrated domain

**Checkpoint**: School operations preserved after domain layering.

---

## Phase 6: User Story 3 — Auth policy without full remote stack (Priority: P2)

**Goal**: Split auth into pure policy + users repo + thin IPC composition (FR-006, FR-011, SC-003). Preserve channel names and lockout/session constants.

**Independent Test**: `node tests/auth-lockout-policy.test.js` and `node tests/auth-session-policy.test.js` pass without Firebase/Electron; manual login + lockout still work.

### Tests first (spec-required)

- [x] T038 [P] [US3] Write failing/golden tests for lockout schedule and attempt evaluation in `tests/auth-lockout-policy.test.js` using constants from current `main/ipc/auth.js`
- [x] T039 [P] [US3] Write failing/golden tests for session TTL validity in `tests/auth-session-policy.test.js` (`SESSION_TTL_MS` = 12h behavior)

### Implementation

- [x] T040 [US3] Extract pure lockout helpers/constants into `main/auth/lockout-policy.js` (no db/electron/firebase)
- [x] T041 [P] [US3] Extract pure session TTL helpers/constants into `main/auth/session-policy.js`
- [x] T042 [US3] Implement `main/repos/users.js` for `users`, `login_attempts`, and app session settings row helpers used by auth
- [x] T043 [US3] Refactor `main/ipc/auth.js` to compose lockout-policy, session-policy, `users` repo, and `main/auth/firebase-auth-service.js`; keep `SESSION_BY_SENDER` in IPC
- [x] T044 [US3] Ensure `tests/auth-lockout-policy.test.js` and `tests/auth-session-policy.test.js` pass against extracted modules
- [x] T045 [US3] Run `npm run test:smoke` and manual login + failed-login lockout per `specs/027-layering-remediation/quickstart.md`

**Checkpoint**: Auth policy unit-testable; login path behaviorally unchanged.

---

## Phase 7: User Story 4 — Write paths cannot skip change-tracking (Priority: P2)

**Goal**: Explicit capture participation for migrated domains; checklist + smoke enforce registry completeness (FR-005, FR-008, FR-009).

**Independent Test**: Smoke sync-registry completeness passes; bulk paths still use explicit capture; checklist documents capture-port.

- [x] T046 [US4] Audit `CHANNEL_REGISTRY` entries for exams/staff/orientation write channels in `main/sync/capture.js` — ensure bulk/multi-row remain `captureMode: 'explicit'` + `exclude: true` where applicable
- [x] T047 [US4] Verify migrated repos call capture-port **inside** the same `db.transaction` as domain writes for bulk paths in `main/repos/exams.js`, `main/repos/staff.js`, `main/repos/orientation.js`
- [x] T048 [US4] Re-run `node tests/sync-exact-bulk-capture.test.js` and `npm run test:smoke` (registry completeness)
- [x] T049 [US4] Finalize checklist wording in `docs/plans/2026-07-15-add-write-channel-checklist.md` for capture-port + explicit bulk (if T003 incomplete or needs post-extract examples)

**Checkpoint**: No silent no-sync risk introduced by extractions; registry and checklist aligned.

---

## Phase 8: User Story 5 — Guardrails for future work (Priority: P3)

**Goal**: Document remaining fat domains as follow-ups; ensure layering rule is discoverable in ≤1 minute (SC-006).

**Independent Test**: Reviewer opens `Agents.md` + write-channel checklist and finds the rule and next-domain backlog.

- [x] T050 [US5] Document remaining fat IPC domains (not in this feature) as a short backlog list in `specs/027-layering-remediation/plan.md` or `docs/plans/2026-07-17-layering-architecture-review-plan.md` (daily-report, system-tags, institution, etc.)
- [x] T051 [P] [US5] Cross-link feature quickstart and contracts from the architecture plan in `docs/plans/2026-07-17-layering-architecture-review-plan.md`
- [x] T052 [US5] Confirm T001–T003 content is complete and consistent with final capture-port API names in `main/repos/capture-port.js`

**Checkpoint**: Future work will not re-collapse layers without ignoring documented rules.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Full package verification and cleanup.

- [x] T053 Run full automated set: `npm run lint`, `npm run test:smoke`, and all new `tests/repos-*.test.js` + `tests/auth-*-policy.test.js`
- [x] T054 Walk entire `specs/027-layering-remediation/quickstart.md` checklist and fix any gaps found
- [x] T055 [P] Grep `main/repos` for forbidden `require('../sync/capture')` and fix any remaining direct imports
- [x] T056 [P] Grep migrated IPC modules (`main/ipc/exams.js`, `staff.js`, `orientation.js`) for residual domain `.prepare(` and remove or justify
- [x] T057 Ensure Prettier/format compliance on touched files under `main/repos/`, `main/ipc/`, `main/auth/`, `tests/`

---

## Dependencies & Execution Order

### Phase Dependencies

```text
Phase 1 Setup
    ↓
Phase 2 Foundational (capture-port)  ← BLOCKS domain/auth repos
    ↓
Phase 3 US1 MVP baseline (control domains)
    ↓
Phase 4 US2 (exams → staff → orientation; sequential within story)
    ↓
Phase 5 US1 full regression (after US2)
    ↓
Phase 6 US3 auth          Phase 7 US4 tracking audit
    ↓                           ↓
         \                     /
          → Phase 8 US5 → Phase 9 Polish
```

- **US3** may start after Phase 2 (does not require US2) if staffing allows, but prefer after US2 to reduce concurrent risk on main.
- **US4** audit should run after US2 extractions (T046–T047 need migrated repos).
- **US5** docs backlog can partially run in parallel with Phase 9 after code freezes.

### User Story Dependencies

| Story | Depends on | Delivers |
|-------|------------|----------|
| **US1** | Phase 2; full pass after US2 | Behavioral parity (SC-001, SC-007) |
| **US2** | Phase 2 | Repos + unit tests for exams/staff/orientation (SC-002) |
| **US3** | Phase 2 | Auth policy split + tests (SC-003) |
| **US4** | Phase 2 + US2 | Capture/registry integrity (SC-004/005 related) |
| **US5** | Phase 1 (content); finalize after code | Guardrails (SC-006) |

### Within User Story 2

1. Exams extract → tests → smoke  
2. Staff extract → tests → smoke  
3. Orientation extract → tests → smoke  

Do **not** parallelize exams/staff/orientation on one machine if both edit shared capture-port or smoke failures will interleave; different developers can own different domains after T005–T012.

### Parallel Opportunities

| Window | Parallel tasks |
|--------|----------------|
| Phase 1 | T002, T003 |
| Phase 2 | T007, T008 after T005; T011 with T010 |
| Phase 3 | T014, T015 |
| Phase 4 | After exams done: staff vs orientation could split across devs |
| Phase 5 | T034, T035 |
| Phase 6 | T038, T039; T040, T041 |
| Phase 9 | T055, T056 |

---

## Parallel Example: User Story 2 (staffed)

```text
# After Phase 2 complete and exams slice merged:

Dev A:
  T024–T027 staff repo + tests + smoke

Dev B:
  T028–T031 orientation repo + tests + smoke

# Do not both edit main/repos/capture-port.js without coordinating.
```

## Parallel Example: User Story 3 tests

```text
T038 tests/auth-lockout-policy.test.js
T039 tests/auth-session-policy.test.js
# then implement T040–T041 in parallel
```

---

## Implementation Strategy

### MVP First (US1 baseline only)

1. Phase 1 Setup (docs)  
2. Phase 2 Foundational capture-port  
3. Phase 3 US1 control-domain verification  
4. **STOP** — shippable internal improvement with zero product change  

### Incremental Delivery

1. MVP (above)  
2. US2 exams only → smoke + unit tests → demo  
3. US2 staff → US2 orientation  
4. Phase 5 full manual regression  
5. US3 auth split  
6. US4/US5 polish  

### Suggested solo order

`T001→T012 → T013→T018 → T019→T032 → T033→T037 → T038→T045 → T046→T052 → T053→T057`

---

## Task Summary

| Phase | Story | Task IDs | Count |
|-------|-------|----------|-------|
| 1 Setup | — | T001–T004 | 4 |
| 2 Foundational | — | T005–T012 | 8 |
| 3 US1 baseline | US1 | T013–T018 | 6 |
| 4 US2 domains | US2 | T019–T032 | 14 |
| 5 US1 full regression | US1 | T033–T037 | 5 |
| 6 US3 auth | US3 | T038–T045 | 8 |
| 7 US4 tracking | US4 | T046–T049 | 4 |
| 8 US5 guardrails | US5 | T050–T052 | 3 |
| 9 Polish | — | T053–T057 | 5 |
| **Total** | | **T001–T057** | **57** |

| Story | Task count (approx.) |
|-------|----------------------|
| US1 | 11 (T013–T018 + T033–T037) |
| US2 | 14 |
| US3 | 8 |
| US4 | 4 |
| US5 | 3 (+ setup T001–T003) |
| Shared/setup/foundational/polish | 17 |

### Format validation

- All tasks use `- [ ]`, sequential `Tnnn`, optional `[P]`, story labels only on US phases, and concrete file paths — **yes**.

### Independent test criteria (quick ref)

| Story | Independent test |
|-------|------------------|
| US1 | Smoke + quickstart manual rows; no behavior change |
| US2 | `tests/repos-exams\|staff\|orientation.test.js` without Electron |
| US3 | `tests/auth-*-policy.test.js` without Firebase/Electron; manual login |
| US4 | Smoke registry completeness + bulk capture tests |
| US5 | Docs cite layering rule + backlog in ≤1 minute |

### MVP scope

**Phase 1 + Phase 2 + Phase 3 (T001–T018)** — capture-port + control-domain parity.

---

## Notes

- No preload channel renames; no schema migrations planned.
- Copy-then-thin extractions; avoid drive-by refactors.
- Commit after each domain slice (exams, staff, orientation, auth) when smoke is green.
- Next command for execution: `/speckit.implement` or implement tasks in order manually.
