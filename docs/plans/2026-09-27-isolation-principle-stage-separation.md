## Goal

Harden Intermediate (`secondary_collegial`) vs. Upper Secondary (`secondary_qualifiant`) as two isolated domains inside one app/database, covering the 7 requested dimensions: data, business rules, roles/permissions, UI/workflows, configuration, transition/boundary, and test isolation. Product language uses **stage**; the technical contract keeps **`cycle`/`cycle_code`** (per `docs/plans/2026-08-02-multi-stage-school-architecture.md` naming decision — no `stage_code` rename).

## Success Criteria

- No collegial/qualifiant read or write path can silently cross stages: missing/ambiguous cycle context on any authoritative calculation, write, or official export fails closed (`RULES_UNAVAILABLE`), never defaults to qualifiant.
- Grading/coefficient/exam-count/weight resolution is per-stage through the profile + assignment spine; no `if stage == ...` fallback to shared constants.
- A user granted one stage cannot read/write the other stage's school data (with `student_orientation` explicitly carved out as a documented institution-wide exception until its dedicated post-stage-rules migration); cross-stage work requires explicit per-stage grants.
- Stage-specific UI (electives/track selection, university-prep, collegial exam formats) renders only for its stage; no giant shared form with hidden cross-stage fields.
- Stage configs (subjects, levels, coefficients, exam counts, weights, calendars/terms) resolve per stage; no global constant with hardcoded exceptions.
- Exactly one controlled collegial→qualifiant student-transition path exists, with history retention and audit; no ad hoc cross-stage copies.
- Each stage has independent contract/golden tests; a collegial policy change cannot break qualifiant tests and vice versa.

## Approach

Build on the existing multi-stage spine rather than inventing a parallel one. Verified current state:

- Cycle SSOT `js/shared/education/cycles.js`: collegial + qualifiant `supported`, primary `preview`; `resolveCycleForRequest` (`main/auth/resolve-cycle.js`) revalidates session context per request, never trusts renderer `cycle_code`, fails closed on ambiguity.
- Data guards exist: `main/repos/students.js` cycle-scoped, `main/repos/student-cycle.js` (`resolveStudentOwnership` bulk skip vs. `resolveStudentForCycle` strict throw), S0 gate tests (`tests/s0-cycle-gate.test.js`, `tests/s0-dual-cycle-fixture.test.js`, `tests/cycle-isolation-student-children.test.js`).
- Rules spine exists: `stage_rule_sets` + `cycle_profiles` + `cycle_profile_assignments` with `RULES_UNAVAILABLE`/`MISSING_RULE` fail-closed contracts (`js/shared/errors/stage-rules-error-contract.js`); `js/cc-rules.js` still carries legacy qualifiant-only `CC_BRANCH_COEFFICIENTS` as compat fallback.
- Auth exists: `main/auth/cycle-access.js` local-only, admin-managed, last-usable-cycle guard; `developer`/`admin`/`principal` hold full access.
- Collegial official file already seeded: migration `2026-08-084-collegial-stage-file` (`main/db/migrations.js:2736`) seeds profile `collegial-2026-v1` (`uses_coefficients=1`, `exams_activities`), the collegial subject catalog, official coefficient/exam-count/weight rows, and per-year assignments; `main/db/init.js:92` refreshes them at every boot. Seeds live in `main/db/education-catalogs/collegial-rules.js` (`stream_code = '*'`, levels `1APIC/2APIC/3APIC`). Known modeling boundaries, not missing data: TECHNOLOGY has no measured activity ratio (unseeded → `MISSING_RULE` fail-closed) and the 3APIC local unified exam has no representable dimension in `subject_coefficients` (CC part seeded at coefficient 1; local-exam part deferred, never merged).
- Known deferred gaps (do not re-litigate, plan them): `sections` stays free text (row 133); `staff_attendance`/`teacher_absences` institution-wide by design (row 131); orientation context-membership rejection deferred (row 132); `appDefaults:listLevels` `*` compat row deletion deferred (row 124).

The plan therefore closes leaks and extracts per-stage policy modules behind the existing resolver interface, instead of a schema rewrite or separate databases (rejected: breaks single-DB/single-`school_id` decision and the sync identity model).

## Steps

### Slice 0 — Leak audit + contract tests (precedes all slices)

- Surfaces: every `main/repos/*` + `main/ipc/*` read/write touching `students`, `grades`, `absences`, `correspondence`, `student_files`, `student_movements`, `student_profile_data`, `timetable_data`, `orientation`, exam/grades/report aggregations — plus `main/reports/*` templates behind `reports:printDocument` / `reports:generateAdminForm` (handlers in `main/ipc/reports.js` are authed but not cycle-scoped; verify whether templates query school data server-side and scope or document each).
- Work:
  1. Grep-verify each repo takes an explicit cycle (or documents an institution-wide exception with a test, like orientation today).
  2. Verify each IPC handler resolves via `resolveCycleForRequest` and never accepts renderer `cycle_code` for scoping.
  3. Add/extend a dual-cycle fixture (collegial + qualifiant both `supported`, distinct student codes, overlapping section names, and deliberately mismatched child rows — noting `students` enforces `UNIQUE(code, school_year)` so student codes cannot overlap in the same year) asserting: context-A cannot read/write B; unauthorized user gets `FORBIDDEN`; two supported cycles without context fail closed.
- Depends on: nothing. Blocks: slices 1–6.

### Slice 1 — Data isolation (schema-level, not filter-only)

- Keep one DB, enforce stage at the schema layer:
  - Confirm `NOT NULL` + FK/index coverage of `cycle_code` on all cycle-scoped tables (follow `ensureCycleReferenceSchema` / `2026-07-070→077` pattern); add missing constraints via `rebuildTableWithConstraints`-style migration, idempotent, zero outbox rows (seed/backfill via direct SQL, never `cyclesRepo.addCycle`). Tables still needing enforcement: `student_files`, `student_movements`, `correspondence` (nullable `cycle_code` in `main/db/schema.js`), and `student_profile_data` (no enforced `cycle_code`).
  - Child-owner cycle consistency: an FK on child tables to `cycles(code)` alone does not guarantee that a child row matches its owner student's cycle, because foreign keys are evaluated independently. Enforce child-to-owner consistency at both layers:
    1. Schema layer: add composite foreign key enforcement (`students` carries `UNIQUE(id, cycle_code)`, child tables declare `FOREIGN KEY(student_id, cycle_code) REFERENCES students(id, cycle_code)`) or `BEFORE INSERT / UPDATE` triggers enforcing `NEW.cycle_code = (SELECT cycle_code FROM students WHERE id = NEW.student_id)`.
    2. Sync/ingestion layer: in `main/repos/student-cycle.js` and sync pull hooks, assert child payload `cycle_code` matches the owner student; quarantine any mismatched rows (`recordPullQuarantine`) rather than half-writing.
  - Per-table orphan policy: distinguish audit history from dangling child rows. Do NOT blanket delete orphan movements (the existing test `tests/cycle-isolation-student-children.test.js:120–130` deliberately preserves orphan movements as audit history). Backfill `student_movements.cycle_code` from the owner student before deletion. Update `student-movements.listByYear` to filter orphan rows by stored cycle: `WHERE m.school_year = ? AND (s.cycle_code = ? OR (s.id IS NULL AND m.cycle_code = ?))`. Quarantine unresolved orphans (`m.cycle_code IS NULL`) to an administrative audit view so they never appear in operational stage lists. Non-audit child rows referencing missing students (e.g. dangling `student_files`) can be cleaned/quarantined in migration.
  - Students/teachers/classes: `students.cycle_code` stays authoritative owner; child rows resolve owner via `student-cycle.js` (no child payload sets cycle). Teachers: keep person row institution-wide, scope **teaching assignments** per cycle (existing `teacher-teaching-assignments` direction); class/section stays free text on the student row per row-133 decision. Note the `sections` table already exists (`main/db/schema.js:950`, `cycle_code NOT NULL`, `UNIQUE(section_code, cycle_code, school_year)`); row 133 only preserves `students.section` as free text without an FK — no new table in this plan.
  - Reports/exports: every report query binds `(school_year, cycle_code)` from the resolved context; add a negative test that a qualifiant report fixture containing collegial rows returns zero collegial rows.
- Sync: keep `cycle_code` in `keyFields`/`requiredColumns` for cycle-scoped entities; unknown-cycle or cross-cycle PUT → `recordPullQuarantine`, never half-write (existing `TOPO_ORDER_PUT` + `checkCycleProfileConsistency` pattern).

### Slice 2 — Business-rule isolation (shared interface, per-stage policies)

- Introduce a thin policy interface in the existing resolver layer (do not scatter `if cycle == ...`):
  - `js/shared/education/` or `js/cc-rules.js` seam: `StageGradingPolicy = { resolveCoefficient, resolveExamCount, resolveSubjectWeights, computeAverages }`; implementations `CollegialGradingPolicy` / `QualifiantGradingPolicy`. Process boundary is strictly preserved: `getActiveRuleSetForCycle` and `getActiveProfileForCycle` execute in the main process via repositories; renderer policy implementations consume the resolved rule set / profile payload returned over IPC (e.g. `stageRules.getActiveRuleSetPayload(year, cycleCode)`), keeping SQL and DB calls out of the renderer.
  - Qualifiant keeps current coefficient/exam/weight behavior; collegial reads its already-seeded official `collegial-2026-v1` rows (migration 084). Only genuinely unseeded inputs fail closed: TECHNOLOGY weights → `MISSING_RULE`, missing rule set → `RULES_UNAVAILABLE` — never qualifiant constants.
  - The policy owns context derivation, not just formulas: `detectBranch` (`js/cc-rules.js:579`) returns `null` for collegial sections, so every `inferQualifiantLevel(branch)` call site (analytics, results-hub, student-profile, students-list, grades-results — 9 sites) currently yields `levelCode: null` → `MISSING_RULE` for collegial students. `CollegialGradingPolicy` derives level via `js/shared/education/collegial-levels.js` and sets `streamCode = '*'`; `QualifiantGradingPolicy` keeps branch + `EdQualifiantLevels.matchLevelFromSection`.
  - Fix the cycle-blind renderer cache: `stageRuleSetCache` (`js/cc-rules.js:770`) and `stageRuleSetLoadPromise` are keyed by `schoolYear` only — key by `(schoolYear, cycleCode)`, assert `cache.cycleCode === context.cycleCode` in `getActiveRuleSetPayload`, and clear on `cycles.setActive` / `app:beforeCycleChange`.
  - Remove the cross-cycle wildcard: `cycle_code: '*'` appears in `STAGE_COEFFICIENT_LOOKUP_STEPS` step 5 (:887), `STAGE_EXAM_COUNT_LOOKUP_STEPS` step 3 (:894), and the `resolveSubjectWeights` filter (:869) — delete all three and update the 5-step contract in `specs/029-stage-rules-management/contracts/resolver.md`.
  - Remove the qualifiant default fallback: delete `CC_BRANCH_COEFFICIENTS[branch] ? 'secondary_qualifiant'` in `buildCoefficientContext` (`js/cc-rules.js:668–670`). Authoritative pipelines (grading calculations, imports, mutations, and official exports) fail closed with `RULES_UNAVAILABLE` when cycle context is missing or ambiguous.
  - Promotion/graduation/attendance thresholds: same pattern — per-stage threshold module behind one interface; collegial values seeded only from an official source, otherwise explicit `MISSING_RULE`.
  - Retire direct `CC_BRANCH_COEFFICIENTS` reads from pages; any temporary compat fallback retained in `js/cc-rules.js` for legacy unmigrated display widgets must be narrowed to an explicit non-authoritative helper (`isAuthoritative: false`, `officialExportBlocked: true`) that marks calculations provisional and blocks any official report/export (`isOfficialExportAllowed`).
- Versioning/audit: keep stage-rules semantics — edits create new revision + mandatory reason + `STAGE_RULE_OVERRIDE` audit + explicit outbox capture inside the same transaction (`captureMode: 'explicit'`, `exclude: true`).

### Slice 3 — Role & permission isolation

- No model change: `user_cycle_access` stays local-only, admin-managed (`cycleAccess:list/setUsers/setCycles`), last-usable-cycle guard in `main/auth/cycle-access.js` (never IPC-only).
- Work:
  - Audit every school-data IPC channel enforces `assertCycleAuthorized` (directly or via `resolveCycleForRequest`); add auth-matrix cases (teacher with collegial-only grant: qualifiant read/write `FORBIDDEN`, and reverse).
  - Dashboards/aggregations bind grants: `filterAuthorizedCycles` for cycle lists; no "teacher ⇒ all stages" shortcut. Cross-stage staff get two explicit grants, shown as two rows in `settings-users.html` matrix.
  - Keep `developer`/`admin`/`principal` full-access; document that principal full-access is by role, not per-stage, and cannot be revoked via the matrix.

### Slice 4 — UI/workflow isolation

- Rules: stage-aware navigation/forms/reports; separate per-stage components pulling per-stage config; shared components take a stage prop and render only that stage's fields.
- Work:
  - Inventory pages with stage-conditional fields (grades/results, student profile, orientation, exams schedule, imports); split collegial vs. qualifiant variants where fields diverge (electives/track selection/university-prep qualifiant-only; collegial exam formats collegial-only).
  - Keep top-bar switcher contract: preview disabled with «قيد الإعداد», `<2` supported = disabled indicator, dirty-page guard + `app:beforeCycleChange`, `cycles.setActive` → reload/revert (`tests/cycle-switcher.test.js`). Add cache invalidation to the switch path: clear `stageRuleSetCache` (+ load promise) on `cycles.setActive` so the first read after a switch can never serve the previous stage's rules.
  - Level display routing: `getLevelFromSection` is qualifiant-only (`3APIC-1` → `{code:'other'}`), but `docs/plans/2026-08-03-collegial-level-normalization.md` deliberately chose not to change it (collegial levels via official names in FilterManager/`classes:getAll`). Reconcile before coding: either route by active cycle (`EdCollegialLevels` vs `EdQualifiantLevels`) as a follow-up that supersedes that decision with an ADR note, or keep the 08-03 mechanism and scope this slice to the grading-pipeline derivation only. Do not implement both mechanisms.
  - Renderer payloads pass the resolved active cycle (`cycles.getActive()`); no literal `'secondary_qualifiant'` in new call sites; missing context in authoritative paths triggers an explicit error (`RULES_UNAVAILABLE`), never guessed or defaulted.

### Slice 5 — Configuration isolation

- Inventory global constants with per-stage exceptions: subject catalogs, level catalogs, coefficients, exam counts, subject weights, term structures, exam calendars.
- Work:
  - Subjects/levels: institution-wide `education_subjects` shared catalog stays (global PK by design); stage binding happens via per-stage rule/profile rows, not by forking the subject table. Keep per-cycle level catalogs (`primary-levels.js`, collegial codes, `qualifiant-levels.js` SSOT) and the `appDefaults:listLevels` `*` compat row until the deferred removal gate passes (full release with no legacy caller).
  - Coefficients/exam counts/weights: only via `stage_rule_sets` dimensions + `source` (`official`/`custom` shadowing); never new global maps.
  - Calendars/terms/attendance rules: new stage-scoped config rows keyed `(school_year, cycle_code)` (or join the profile spine if they are policy, not schedule); unknown stage config → explicit missing-config error, not the other stage's calendar.
- Migration discipline: official seeds are local data, zero outbox rows; unmappable subjects logged (`STAGE_RULES_MIGRATION_UNMAPPABLE`), never guessed.

### Slice 6 — Transition/boundary (the single intentional seam)

- Define one contract, e.g. `stageTransition:transferStudent`, owned by a new `main/repos/stage-transition.js` (SQL in repo, IPC auth/validation only). `students` is `UNIQUE(code, school_year)` (`main/db/schema.js:24`), so same-year dual rows are impossible and in-place `cycle_code` updates would orphan the `grades`↔`students` join (`main/repos/grades.js:44`, which matches on `student_id` **and** `cycle_code`).
- Dedicated transition schema: existing `student_movements` has only a single `cycle_code` and lacks `from_cycle_code`, `to_cycle_code`, and a persisted `idempotency_key`. Define a dedicated `student_stage_transitions` table in migration:
  - Columns: `id INTEGER PRIMARY KEY AUTOINCREMENT`, `student_id INTEGER NOT NULL REFERENCES students(id)`, `student_code TEXT NOT NULL`, `from_school_year TEXT NOT NULL`, `to_school_year TEXT NOT NULL`, `from_cycle_code TEXT NOT NULL`, `to_cycle_code TEXT NOT NULL`, `transition_type TEXT NOT NULL` (`inter_year_progression` | `intra_year_reclassification`), `idempotency_key TEXT NOT NULL UNIQUE`, `effective_date DATE NOT NULL`, `reason TEXT`, `created_at DATETIME DEFAULT CURRENT_TIMESTAMP`.
- Semantics bifurcate explicitly:
  - **(a) Inter-year academic progression** — input `studentCode, fromYear, toYear, fromCycle, toCycle, reason, effectiveDate, idempotencyKey`: creates a new student row in `toYear` (compatible with the unique constraint). Source-year history (grades/absences/orientation) keeps its source `cycle_code` snapshot — no retroactive reclassification.
  - **(b) Intra-year reclassification** (admin correction of a misfiled cycle) — updates the row's `cycle_code` in place **and** realigns already-written child rows (`grades`, `absences`, …) to the corrected cycle within the same transaction, since they carry `cycle_code` copies the join depends on.
  - Both paths (single transaction + explicit outbox capture): insert a `student_stage_transitions` record (enforcing the unique `idempotency_key` for safe retries), insert a companion `student_movements` record for timeline audit compatibility; require the actor to be authorized in **both** cycles, target cycle `supported`; audit `STAGE_TRANSITION` in `system_logs`.
  - Forbid all other cross-stage writes: child repos keep rejecting foreign-cycle owners; bulk imports skip foreign rows with `foreignCycle` reporting (existing `resolveStudentOwnership` semantics).
- Defer: automatic promotion pipelines and historical backfill migrations (explicit archived migration only, per row-132 rule).

### Slice 7 — Test isolation

- Structure: `tests/collegial/*` and `tests/qualifiant/*` suites (or clearly prefixed files) sharing only builders/fixtures; no shared mutable DB state between stage suites.
- Minimum per stage: resolver golden tests (coefficient/exam-count/weight), missing-rule fail-closed tests, report isolation tests, permission-matrix tests, config-resolution tests.
- Constitution test: run each stage suite standalone (`node tests/run-all.js` supports file args or direct `node <file>`) and prove a policy change in one stage's fixtures cannot fail the other stage's suite; keep S0 dual-cycle, sync quarantine, and `*` compat-row tests green throughout.

## Validation Plan

- After every slice: `npm test` (full `node tests/run-all.js`) + `npm run lint` — both must be green before the next slice (S0 gate precedent: 243→251 green runs).
- Slice 0: new/updated `tests/s0-cycle-gate.test.js` + dual-cycle fixture — context-A vs. B read/write, `FORBIDDEN`, no-context ambiguity fail-closed.
- Slice 1: migration idempotence + no-new-outbox assert; per-table `cycle_code NOT NULL`/FK asserts; qualifiant-report-excludes-collegial negative test.
- Slice 2: `tests/stage-rules-*.test.js` + `tests/cc-rules-coefficient-golden.test.js` + new collegial golden tests (`1APIC/2APIC` Σ=29, 3APIC CC=1, `stream '*'`) and `MISSING_RULE` tests (TECHNOLOGY weights); cache test proving a stage switch never serves the previous stage's rules; wildcard regression test (a `cycle_code: '*'` row must never match); official-export blocked flag verified in `grades-results.html` / `student-profile.js` gates.
- Slice 3: `tests/cycle-access-management.test.js` + `tests/cycle-access.test.js` matrix extended both directions; last-usable-cycle refusal via IPC and repo-direct.
- Slice 4: `tests/cycle-switcher.test.js` green; manual check per page: switch stage → stage-only fields render, other stage's features absent; dirty-page guard blocks switch until confirmed.
- Slice 5: per-stage config resolution tests incl. unknown-stage `UNKNOWN_CYCLE` and missing-config errors; seed-invariant tests (zero foreign-stage rows in rule tables).
- Slice 6: transition contract tests — inter-year happy path (new row in `toYear`, source history keeps source snapshot), intra-year correction (child rows realigned, join intact), idempotent retry, unauthorized-single-cycle actor refused, audit + outbox rows asserted.
- Slice 7: each stage suite passes standalone; highest-risk check is Slice 0 dual-cycle isolation + Slice 6 boundary transaction (both must be re-run after any later slice touches repos or sync apply).
- Sync regression each slice touching entities: `tests/sync-multi-cycle-contracts.test.js`, `tests/cycle-profiles.test.js` (version gate + quarantine), orientation contract tests.

## Risks / Open Questions

- **Collegial official grading source — CLOSED**: the official collegial file is seeded (migration `2026-08-084`, `main/db/education-catalogs/collegial-rules.js`, boot refresh in `main/db/init.js:92`). Remaining boundaries, not open questions: TECHNOLOGY weights unseeded by design (`MISSING_RULE` until a measured ratio exists) and the 3APIC local unified exam unmodeled (needs a new dimension or explicit deferral ADR — never merged into the CC coefficient).
- **Orientation context-membership enforcement** (row 132) — CLOSED as deferred: `student_orientation` stays institution-wide in this plan with its write-time `cycle_code` snapshot (`main/repos/orientation.js:6-14` forbids adding cycle filtering without updating `tests/s0-cycle-gate.test.js` and the plan). Acceptance criteria and automated test assertions explicitly carve out orientation from single-stage read/write restrictions until a dedicated future post-stage-rules migration integrates it with `user_cycle_access`.
- **Teacher cross-stage identity**: person row stays institution-wide with per-cycle assignments — a teacher working both stages has two assignment rows, not two person rows. Risk: reports joining person→assignments must pick the assignment cycle explicitly; audit joins in Slice 0.
- **Scope guards**: no new `sections` table and no FK from `students.section` (row 133 — the table itself already exists), no `staff_attendance`/`teacher_absences` `cycle_code` (row 131, institution-wide by design), no `*` compat-row deletion (row 124), no `user_cycle_access` sync (local-only decision stands). Any request to change these needs its own ADR.
- **Rollback**: each migration idempotent with rollback notes; rule/config edits are new revisions (previous revision `closed`, restorable); transition writes are compensable via reversing movement record, never by editing history snapshots.
