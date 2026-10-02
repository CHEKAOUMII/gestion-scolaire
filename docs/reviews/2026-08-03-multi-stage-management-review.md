# Multi-Stage (Multi-Cycle) Management Review

Review date: 2026-08-03

How the project manages multiple education stages (cycles) within the same school.

## Overview

Multi-stage management is built on 5 coordinated mechanisms:

1. Cycle catalog + capability model (SSOT)
2. Institution membership (`institution_cycles`)
3. Per-session active-cycle context
4. Per-user stage authorization (`user_cycle_access`)
5. Effectivity spine — per-cycle × per-year rules/profiles

## 1. Cycle catalog + capability model (SSOT)

**File:** `js/shared/education/cycles.js`

Defines exactly 3 official cycles with a `hidden/preview/supported` capability tri-state:

| Cycle | Capability | Notes |
|-------|-----------|-------|
| `primary` | `preview` | «قيد الإعداد», visible read-only, never workable |
| `secondary_collegial` | `supported` | Workable |
| `secondary_qualifiant` | `supported` | Workable |

- `resolveCycleForRequest` only counts `capability === 'supported'` cycles (`listUsableCycles`), so preview stages never affect resolution.
- Cycle inference: `inferCycleFromSection` / `inferCycleFromLevel`. Collegial is matched **before** primary on purpose so `1APIC` never falls into the `[1-6]AP` primary branch (cycles.js:78).

## 2. Institution membership (`institution_cycles`)

**Repo:** `main/repos/cycles.js` — **Schema:** `main/db/schema.js:876` (`ensureInstitutionCyclesSchema`)

Whether a school actually offers a cycle is stored per institution:

- `cycle_code` UNIQUE, `is_active`, `seed_profile_version_hint` (seed hint only), `sort_order`.
- Seeded via migrations (`2026-08-080-primary-stage-catalogs` etc.), direct idempotent SQL, zero outbox rows.
- `addCycle` / `setCycleActive` manage membership; capture happens via `captureInputUpserts` + `notifyCaptureCommitted` (capture-port), i.e. `institution_cycles` **is** a sync entity.
- **Disable guard:** `assertDisableKeepsInstitutionUsable` (cycles.js:80) refuses disabling the last *supported* enabled cycle, so the institution never ends up with rows but no workable stage.

## 3. Per-session active-cycle context

**Files:** `main/auth/active-cycle-context.js`, `main/ipc/cycles.js`, `main/auth/resolve-cycle.js`

The current stage is a **per-renderer-window, in-memory session context** `{ userId, cycleCode, schoolYear }`:

- Established **only** by explicit user action via `cycles:setActive` (cycles.js IPC:71) — no implicit default to qualifiant (G3 rule).
- Reads use `peekContext` (never create), so the first query after login never pins a cycle itself.
- When `>1` usable cycles exist and no selection, `cycles:getActive` returns `requiresSelection: true` so the UI prompts the user (cycles.js IPC:54).
- `cycles:setEnabled` (disable) clears contexts for the affected cycle; `cycles:setActive` broadcasts `cycles:changed`.

**Request-scope resolution** — `resolveCycleForRequest` (resolve-cycle.js:36):

1. Cached session context, **re-validated on every request** against current institution state (`is_active` + capability, S0 gate) and the user grant; stale/disabled context fails closed and never falls through to another cycle.
2. Otherwise the institution's single enabled *supported* cycle.
3. A `cycle_code` sent by the renderer is **never consulted**. When multiple usable cycles exist and the caller has no context (pre-login bulk import), the request is refused rather than guessed.

### Top-bar stage switcher (global control)

**File:** `js/sidebar.js:469-580` (plan: `docs/plans/2026-08-02-topbar-cycle-switcher.md`)

- Injected into `.header-right` on every page; pages without it are skipped.
- Lists every **active** institution stage; `preview` rows rendered disabled with «قيد الإعداد» suffix; only `supported` rows selectable.
- 0 active stages → hidden; <2 selectable → disabled indicator; 2+ → active switcher with the session stage pre-selected.
- Switch flow: dirty-page guard (`[data-unsaved-changes="true"]` + cancelable `app:beforeCycleChange`) → `cycles.setActive(value, getSchoolYear())` → reload on success, revert + toast on failure.
- `cycles.onConfigurationChanged` subscription at module level; `settings-school.js` calls `window.refreshCycleSwitcher` unchanged.
- Pure helper `window.buildCycleSwitcherOptions(cycles, activeCycleCode)`.
- No IPC/preload/DB/sync changes; tests: `tests/cycle-switcher.test.js`.

## 4. Per-user stage authorization (`user_cycle_access`)

**Files:** `main/auth/cycle-access.js` (repo), `main/ipc/cycle-access.js`, schema.js:896

- **Local-only by design (not synced)** — `users` is not a sync entity (no `entity-registry.js` entry), user IDs are device-local; it is an authorization policy, not school data. Both channels are `exclude: true` in `CHANNEL_REGISTRY`; no sync-apply hooks.
- Admin-only management: `cycleAccess:list`, `cycleAccess:setUsers` (replace a user's grants), `cycleAccess:setCycles` (enable/disable a cycle for all non-privileged users).
- `FULL_CYCLE_ACCESS_ROLES = { developer, admin, principal }` ignore the table; `assertModifiableUser` forbids writes against them.
- **Repo-level guards** (never only in IPC):
  - `assertKnownInstitutionCycle` — `UNKNOWN_CYCLE` / `CYCLE_NOT_IN_INSTITUTION`.
  - `assertKeepsLastUsableCycle` (row 129 guard) — a change must never leave a user without at least one usable supported cycle when they had one (`LAST_USABLE_CYCLE`).
- Enforcement on reads: `assertCycleAuthorized` (throws `FORBIDDEN`) and `filterAuthorizedCycles` (filters `cycles:list`, `cycles:getActive`).
- SSOT error codes: `CYCLE_ACCESS_ERROR_CODES`.
- UI: «صلاحيات الأسلاك» admin section in `settings-users.html`; tests: `tests/cycle-access-management.test.js`.

## 5. Effectivity spine — per-cycle × per-year rules/profiles

**Files:** `main/repos/stage-rules.js`, `main/db/schema.js:1040` (`ensureCycleProfilesSchema`), migrations `2026-08-082/083`

- `cycle_profiles`: official immutable stage profiles, logical key `(cycle_code, profile_version)`, columns `uses_coefficients` + `assessment_model` (`exams` / `continuous` / `exams_activities`). Seeded: primary (continuous, 0), collegial (exams_activities, 1), qualifiant (exams, 1).
- `cycle_profile_assignments`: one row per `(school_year, cycle_code)` binding `profile_version` + `rule_set_id` (FK `stage_rule_sets`). **Runtime-authoritative**: `rule_set_id` non-null exactly when the profile uses coefficients, referencing the active revision of the **same** school year; NULL for continuous profiles.
- `CYCLE_CATALOG.seedProfileVersionHint` / `institution_cycles.seed_profile_version_hint` are seed/migration hints only — never used to resolve effectivity.
- Resolvers fail closed: `getActiveProfileForCycle` throws `RULES_UNAVAILABLE` on a dangling assignment; `getActiveRuleSetForCycle` is assignment-based (no fallback to `getActiveRuleSet`).
- Every version-copy save (`saveCoefficients`/`saveExamCounts`/`saveAllRules`/`resetToOfficial`) and `applyOfficialRuleSet` re-binds the assignment inside the same transaction; `captureRevisionRows` captures the year's assignment rows too.
- Rule-set resolution precedence (per `specs/029-stage-rules-management/contracts/resolver.md`): exact `(cycle, level, stream, subject)` → stream wildcard → level wildcard → cycle default → `MISSING_RULE` (never constants). Custom beats official on the same key.
- Sync: both tables registered `snapshot: false`, `contractVersion: 2`, minAppVersion `1.0.42`; pull-side guards `checkCycleProfileConsistency` + version gate route failures to `recordPullQuarantine` (never half-consistent, never holds the pull cursor); `TOPO_ORDER_PUT` applies `cycle_profiles` before assignments.

## 6. Data scoping

- School-data tables carry `cycle_code` + `school_year`: `students`, `grades`, `absences`, `timetable_data`, `support_sessions`, `exams`, `tests`, `student_profile_data`, `student_files`, `correspondence`, `student_movements`, `teacher_teaching_assignments`, …
- Indexes `(school_year, cycle_code)`; migrations backfill cycle codes (e.g. from `students.cycle_code` onto grades/absences) and normalize.
- `student_orientation.cycle_code` is a historical snapshot derived in main; orientation inserts skip rows with no student-roster match rather than writing NULL-cycle rows.

## Deliberate deltas / deferred items

- **Context is per-window memory** — lost on app restart; with multiple usable cycles the user must re-select (`requiresSelection`), by design (fail-closed).
- **`primary` stage is `preview` only** — cataloged and inferred, but no workable rules, no `exam_count_rules`, no assignments with coefficients; ownership is the stage-rules plan.
- **Legacy `*` level row** still prepended in `appDefaults:listLevels` for the no-cycle/qualifiant paths — removal deferred until a full release cycle passes with no legacy caller (do not delete early).
- **Renderer payloads** were swept (S5, row 123): 9 call sites pass the resolved active cycle instead of the literal `'secondary_qualifiant'`; when unavailable they fall back to legacy `CC_BRANCH_COEFFICIENTS` — no runtime cycle guessing.

## Key files

| Concern | Files |
|---------|-------|
| Catalog SSOT | `js/shared/education/cycles.js` |
| Membership repo | `main/repos/cycles.js` |
| Session context | `main/auth/active-cycle-context.js` |
| Request resolution | `main/auth/resolve-cycle.js` |
| Cycle IPC | `main/ipc/cycles.js` |
| User grants repo/IPC | `main/auth/cycle-access.js`, `main/ipc/cycle-access.js` |
| Effectivity spine | `main/repos/stage-rules.js`, `main/db/schema.js:1040` |
| Stage switcher | `js/sidebar.js:469-580` |
| Plans | `docs/plans/2026-08-02-multi-stage-school-architecture.md`, `docs/plans/2026-08-02-topbar-cycle-switcher.md` |
| Tests | `tests/cycle-switcher.test.js`, `tests/cycle-access-management.test.js`, `tests/cycle-access.test.js`, `tests/cycle-profiles.test.js`, `tests/primary-stage-catalogs.test.js`, `tests/qualifiant-level-catalog.test.js`, `tests/e2e/stage-pages.e2e.js` |

## Invariants and Verdict

The remediation verdict for this review
([2026-08-03-multi-stage-management-review-verdict.md](2026-08-03-multi-stage-management-review-verdict.md),
Phase 5B) requires the following invariants to be executable. The property suite
`tests/cycle-invariants-property.test.js` is the behavioral enforcement for these
invariants. The repository checks in `scripts/check-invariants.js` are separate:
they verify required source/artifact presence and documentation, but do not prove
the runtime invariants or enforce application behavior.

1. **Invariant 1 — exactly one active assignment per year:** every supported and
   enabled institution cycle has exactly one active `cycle_profile_assignment` per
   school year. *Behaviorally enforced by:* property test
   `tests/cycle-invariants-property.test.js`. *Source/artifact check only:* the
   repository check verifies the related migration and schema artifacts; it does
   not prove assignment uniqueness.
2. **Invariant 2 — grants survive revocation:** a user with any usable cycle always
   has at least one grant that survives `assertKeepsLastUsableCycle`.
   *Behaviorally enforced by:* property test `tests/cycle-invariants-property.test.js`.
   *Source/artifact check only:* the repository check verifies the guard exists; it
   does not execute revocation behavior.
3. **Invariant 3 — supported-only writes:** no repo write path accepts a cycle whose
   catalog capability is not `supported`. *Behaviorally enforced by:* property test
   `tests/cycle-invariants-property.test.js`. *Source/artifact check only:* the
   repository check verifies the capability vocabulary exists; it does not prove
   that every repo write path is gated.

The removal trigger for the legacy `*` level row (`LEGACY_ALL_LEVELS_ROW` in
`main/ipc/appDefaults.js`) is defined authoritatively in the verdict's Phase 5B and
checked by `scripts/check-invariants.js`.
