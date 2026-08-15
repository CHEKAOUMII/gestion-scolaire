# Multi-Stage Management Review — External Feedback Verdict

Verdict date: 2026-08-03

Companion to: `docs/reviews/2026-08-03-multi-stage-management-review.md`

Each claim from the external architecture feedback was checked against the current
repository. Evidence is cited as `file:line`. Findings below distinguish the state at
the original review from the state after the remediation commits now present.

## Summary

| # | Claim | Current verdict | Severity |
|---|-------|-----------------|----------|
| 1 | Three profile-version carriers; “hint” is convention only | **Remediated**: hint names are explicit and assignment remains authoritative | Low |
| 2 | Cross-mechanism interaction untested | **Remediated** by the real IPC/repo integration suite | **High historical** |
| 3 | No guard rejecting preview-cycle writes | **Remediated** at the shared repo boundary; DB constraint correctly not added | High historical |
| 4 | Bulk-import refusal dead-ends | **Remediated**: typed refusal, preflight block, and direct remedy | Medium historical |
| 5 | Error codes lack a message-mapping layer | **Remediated** for stage-rules, cycle-access, and import flows | Medium-High historical |
| 6 | Legacy `*` row has no removal trigger | **Partially remediated**: trigger is documented and gated; adapter remains intentionally | Low residual |

### Bonus DDL finding

The silent qualifiant default was real at the original review and is now **remediated**
by migration `2026-08-085-drop-silent-cycle-code-defaults`.

## Phased Remediation Plan

Status: implementation sequence and current release checklist. All correctness phases
are implemented. The only open item is evidence for retiring the deliberately retained
`appDefaults:listLevels` compatibility row. The phases are ordered by risk reduction.

### Phase 1 — DDL safety and explicit cycle writes (P0) — **Completed**

**Goal:** prevent an omitted `cycle_code` from silently classifying a row as
`secondary_qualifiant`.

**Deliverables:**

1. Fresh canonical DDL for `students`, `grades`, and `absences` has `cycle_code TEXT
   NOT NULL` with no default (`main/db/schema.js:41,69`; `students` receives the column
   in its later migration).
2. Migration `2026-08-085-drop-silent-cycle-code-defaults` rebuilds only affected legacy
   tables, preserves `NOT NULL` and rows, and creates zero outbox rows
   (`main/db/migrations.js:2807-2910`). Historical migration source still contains the
   old default so old databases can be upgraded; current schemas are default-free.
3. Repo writes pass explicit cycles, while migration and sync paths write their known
   cycle values directly and do not use school-data repos.
4. `tests/cycle-defaults-removal.test.js` verifies fresh/upgrade SQL, omitted-column
   failures, explicit primary/collegial/qualifiant inserts, zero outbox rows, and an
   idempotent rerun.

**Exit criteria:** met. A current schema cannot create a qualifiant row by omitting the
cycle column; the omission fails with `NOT NULL` instead.

**Explicit orientation snapshot exception:** `student_orientation.cycle_code` is a
historical snapshot, not a current-work-cycle authorization field. On production
schemas, orientation inserts derive the snapshot from the same-year student roster;
unknown students are skipped with `reason: 'no_matching_student'`. Updates preserve the
existing snapshot even if the student later changes cycle. Pre-081 fixtures retain a
schema-gated compatibility fallback that writes `NULL` and reports `unresolvedCycle`,
never guesses a cycle (`main/repos/orientation.js:615-644`; `tests/orientation-contract.test.js:239-312`).

### Phase 2 — Cross-mechanism authorization integration (P0/P1) — **Completed**

**Goal:** verify institution membership, user grants, active context, and request
re-resolution together through real paths.

**Deliverables:** `tests/multi-stage-management-integration.test.js` uses two supported
cycles, a grant-limited teacher, an admin, real `cycles:setEnabled`, real IPC reads and
writes, context clearing, stale-context refusal, single-cycle fallback, revoke/disable
ordering, and explicit recovery selection (`tests/multi-stage-management-integration.test.js:218-425`).

**Exit criteria:** met. The production IPC path, `assertDisableKeepsInstitutionUsable`,
`assertKeepsLastUsableCycle`, and `resolveCycleForRequest` are asserted in one run.

### Phase 3 — Supported-cycle repo boundary (P1) — **Completed**

**Goal:** refuse preview/hidden/unknown cycles in normal school-data repos without a DB
constraint that would block migration or sync data.

**Deliverables:** `requireCycle` resolves the static catalog and accepts only
`capability === 'supported'` (`main/repos/student-cycle.js:9-17`). Students, grades,
absences, timetable, exams, and related cycle-scoped repos delegate to it. Migration
and sync code does not import those repos for legitimate catalog/sync writes.

**Exit criteria:** met by direct and property-style coverage in
`tests/cycle-capability-writes.test.js` and `tests/cycle-invariants-property.test.js`.
Primary remains preview/read-only; this is enforced at the normal repo boundary, not by
rejecting preview rows in the database.

### Phase 4 — Typed errors and import recovery (P1) — **Completed**

**Goal:** make cycle failures actionable without an override path.

**Deliverables:**

1. Stage-rules IPC preserves typed domain codes and no longer infers `FORBIDDEN` from
   Arabic text (`main/ipc/stage-rules.js:43-82`). Payload validation is
   `RULES_INPUT_INVALID`, separate from semantic `MISSING_RULE`.
2. `js/shared/errors/cycle-access-error-contract.js` is the dual-export SSOT for
   cycle-access codes, safe messages, normalization, and IPC mapping.
3. `stageErrorMessage` uses the contract renderer, which prefers a safe server message
   and falls back to the catalog (`js/pages/settings-defaults.js:556-566`).
4. `resolveCycleForRequest` emits `CYCLE_SELECTION_REQUIRED`; import context policy
   blocks ambiguous high-risk imports before commit and `ImportResultContract` tells the
   user to log in and select a stage (`main/auth/resolve-cycle.js:51-62`,
   `js/import-center/import-context.js:303-315`,
   `js/import-center/import-result-contract.js:18-24,74-90`).
5. Renderer cycle input is never authoritative; no admin CLI or import override was
   added.

**Exit criteria:** met by `tests/stage-rules-error-mapping.test.js`,
`tests/cycle-access-error-contract.test.js`, `tests/import-context-preflight.test.js`,
and `tests/import-error-presentation.test.js`.

### Phase 5 — Naming, invariants, and the legacy adapter (P2) — **Mostly completed**

**Goal:** make authority boundaries executable and leave only a measurable compatibility
cleanup.

**Completed deliverables:**

1. `CYCLE_CATALOG.seedProfileVersionHint` and
   `institution_cycles.seed_profile_version_hint` are seed/migration hints. The
   runtime-authoritative `cycle_profile_assignments.profile_version` remains unchanged
   (`main/db/schema.js:875-883,1042-1075`; `main/repos/stage-rules.js:104-126`).
2. `tests/cycle-invariants-property.test.js` covers assignment uniqueness, last usable
   grant survival, and the supported-cycle write gate using `fast-check` and real public
   mutation paths.
3. `scripts/check-invariants.js` performs the source-level checks and is the first
   `npm test` gate (`tests/run-all.js:101-104`). It reports file/line failures and exits
    non-zero. The current tree passes the literal check; historical migration comments
    describe the removed default without repeating the forbidden cycle literal.

**Residual deliverable:** retain `LEGACY_ALL_LEVELS_ROW` until the adapter-specific
removal trigger is met. The trigger is deliberately narrow: after one full app release
with no legacy caller or payload requiring the no-cycle/qualifiant compatibility shape
of `appDefaults:listLevels`, remove the row and its adapter, backed by telemetry or
equivalent test evidence. It does not require an unrelated global purge of `'*'` level
values. Until then, the row remains at `main/ipc/appDefaults.js:226-249` and is not part
of the primary or collegial catalogs.

**Exit criteria:** met for naming and executable invariant coverage. The aggregate gate is
green (`npm test`: 262/262); release evidence for the `appDefaults:listLevels` adapter is
still required before removing the row.

## Phase Gates and Verification Matrix

| Gate | Required verification | Current status and release decision |
|------|-----------------------|-------------------------------------|
| Phase 1 | `cycle-defaults-removal`, fresh/upgrade SQL inspection, explicit-cycle writes, zero outbox rows | **Pass**; block if any current schema has a cycle default or omitted insert succeeds |
| Phase 2 | `multi-stage-management-integration` through real IPC/repo paths | **Pass**; block if disabled/stale context authorizes read or write |
| Phase 3 | `cycle-capability-writes` and invariant property tests, migration/sync regression | **Pass**; block if a normal repo accepts preview/unknown cycle |
| Phase 4 | stage-rules, cycle-access, import preflight/presentation tests plus `npm run lint` | **Pass when commands are green**; block if ambiguity reaches commit without `CYCLE_SELECTION_REQUIRED` |
| Phase 5 | `scripts/check-invariants.js`, full `npm test`, lint, one-release adapter evidence | **Pass for correctness gates**; retain the adapter until one-release usage evidence supports removal |

## Recommended Execution Order

1. Run `npm test` first; its invariant script must pass before test discovery proceeds.
2. Run `npm run lint` and the focused phase suites when changing cycle, import, or
   stage-rules code.
3. For a release, record the one-release `appDefaults:listLevels` compatibility-use
   evidence. If usage is still present or unknown, keep the adapter and reopen only the
   Phase 5 cleanup item.
4. Do not add DB constraints that reject preview catalog/sync data, renderer cycle
   overrides, or a guessed import destination.

## 1. Profile-version hints — historical concern **remediated**

The original carrier names were ambiguous. They are now explicit: catalog and
`institution_cycles` use `seed_profile_version_hint`, while
`cycle_profile_assignments.profile_version` is the runtime effectivity reference.
`main/repos/cycles.js:23,31,70` takes the hint from the catalog, and sync validation
pins it to the catalog (`main/sync/apply-hooks.js:69`). `main/repos/stage-rules.js:104-126`
resolves the assigned profile, not the hint.

Residual risk is limited to a future resolver incorrectly using the hint. The current
names, schema comments, and assignment-based resolver make that misuse visible; no new
startup drift subsystem is warranted.

## 2. Cross-mechanism tests — historical gap **remediated**

The original test intersection was absent. It is now covered by
`tests/multi-stage-management-integration.test.js:218-425`: real disable clears the
context; read/write requests refuse or fall back correctly; both institution and user
guards are exercised; and recovery requires explicit selection when cycles are
ambiguous. The former raw-SQL tests remain lower-level coverage, not the only evidence.

## 3. Preview-write guard — historical gap **remediated**

The former non-empty-only `requireCycle` was replaced by the pure catalog capability
check at `main/repos/student-cycle.js:9-17`. `tests/cycle-capability-writes.test.js`
and the property suite cover supported acceptance, preview/unknown refusal, delegating
repos, and migration/sync isolation. A DB constraint remains intentionally absent:
catalog and sync paths may carry preview rows, including primary data.

## 4. Bulk-import front door — historical surfacing failure **remediated**

The refusal is now typed as `CYCLE_SELECTION_REQUIRED` or `NO_USABLE_CYCLE`, survives
IPC, and maps to a direct login/top-bar remedy. High-risk unknown-cycle preflight is
blocking through `ImportPreflightPolicy`; selected-cycle and single-cycle fallback
paths remain valid. This preserves the invariant that renderer-supplied cycle values
are not authoritative. Evidence: `main/auth/resolve-cycle.js:51-62`,
`main/ipc/ipc-helpers.js:20-29`, and the import tests cited in Phase 4.

## 5. Error-to-message mapping — historical drift **remediated**

Stage-rules IPC now passes typed codes without Arabic-regex inference, separates
`RULES_INPUT_INVALID` from `MISSING_RULE`, and renders safe server messages before
catalog fallbacks. Cycle-access has a dual-export contract with normalization and safe
messages. The relevant regression coverage is in
`tests/stage-rules-error-mapping.test.js` and `tests/cycle-access-error-contract.test.js`.

## 6. Legacy `*` row — **partially remediated; residual cleanup only**

`LEGACY_ALL_LEVELS_ROW` remains intentionally in `main/ipc/appDefaults.js:226-249` as
the `appDefaults:listLevels` compatibility adapter. `LEVEL_CODES` and the cycle
catalogs no longer define the marker. `scripts/check-invariants.js:151-242` now checks
that the adapter and its documented removal trigger are visible, and `npm test` runs
that check. The only remaining action is to gather one full release of
adapter-specific usage evidence before removal. No broader `'*'` database-value purge
is a prerequisite.

### Bonus finding — silent DDL default **remediated**

At the original review, `grades`, `absences`, and the migrated `students` column could
default an omitted cycle to qualifiant. Current canonical DDL has no such default
(`main/db/schema.js:41,69`), and migration `2026-08-085` removes it from upgraded
tables while preserving rows and `NOT NULL` (`main/db/migrations.js:2807-2910`).
`tests/cycle-defaults-removal.test.js:168-310` verifies the fresh and upgrade cases.
The old default expressions still appear inside historical migration definitions solely
to describe/upgrade pre-fix databases; they are not the current table schema.

## Endorsed Invariants Proposal

The structural suggestion is implemented as executable coverage, not merely a review
statement. `fast-check` properties and direct public-path assertions live in
`tests/cycle-invariants-property.test.js`; cheap repository checks live in
`scripts/check-invariants.js`.

1. Every supported and enabled institution cycle has exactly one
   `cycle_profile_assignment` per school year; the assignment, not a seed hint, is the
   effectivity authority.
2. A user with a usable supported cycle retains at least one usable grant after every
   permitted `assertKeepsLastUsableCycle` mutation.
3. No normal cycle-scoped school-data repo accepts a cycle whose catalog capability is
   not `supported`.

The third invariant explicitly excludes migration and sync apply paths and the
orientation snapshot exception above. Orientation is historical school data: its
snapshot is derived from the roster on insert, preserved on update, and never used to
authorize a current request.

## Prioritized Improvement List

1. **[Residual, P1]** Record one full release of `appDefaults:listLevels` adapter usage;
   remove `LEGACY_ALL_LEVELS_ROW` only when the narrow trigger is met.
2. **[Remediated]** Cross-mechanism integration: disable-with-grant,
   disable/revoke-then-resolve, and real context clearing.
3. **[Remediated]** Pure catalog capability check at the shared `requireCycle` repo
   boundary; no DB constraint.
4. **[Remediated]** Typed error plumbing: no Arabic-regex inference, distinct
   `RULES_INPUT_INVALID`, cycle-access contract, and server-message precedence.
5. **[Remediated]** `CYCLE_SELECTION_REQUIRED` plus blocking high-risk import preflight;
   no override parameter.
6. **[Remediated]** Rename seed profile carriers to `seed_profile_version_hint` while
   retaining assignment `profile_version` as authority.
7. **[Implemented]** `scripts/check-invariants.js` runs from `npm test` and checks the
    adapter-specific legacy trigger plus the existing `main/` literal rule; the current
    aggregate gate passes. Keep the adapter until the one-release evidence trigger is met.
8. **[Remediated]** Explicit invariants proposal backed by property tests and public
   mutation-path assertions.

## Overall Assessment

The feedback correctly identified real historical gaps, and the missed DDL default was
the highest-risk issue because it could silently misfile a record. Those correctness
issues are now remediated and covered by focused tests. The aggregate release gate passes
(`npm test`: 262/262; `npm run lint`: zero errors, 57 existing warnings). The only open
cleanup item is adapter-specific evidence for `appDefaults:listLevels`; remove its `*`
row only after the stated one-release trigger. The orientation cycle field is an explicit
historical snapshot exception, not a bypass of current-cycle authorization.
