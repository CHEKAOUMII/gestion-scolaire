# Implementation Plan: Student Profile BM Scoring

## Overview

This plan adds an independent Tab_Score (0–100) for each of the four BM tabs (Economic, Social,
Health/Psych, Followup) inside `student-profile-prototype.html`. The work is organized in four
phases: (1) create the pure scoring module `js/bm-scoring.js` with its four axis functions and
property-based test suite; (2) inject Score_Widgets into the tab panels and implement the
`updateScoreWidget` renderer helper; (3) wire live event listeners, debounce, and the
`_bmScoreState` cache in `js/pages/student-profile.js`; (4) connect the axis-summary card in
Risk_Tab and update `collectRiskInputs()` with the `bmScores` sub-object bridge.

All scoring logic is pure JS (no DOM, no IPC), mirroring the UMD guard used in
`js/student-averages.js`, and is `require`-able by the Node test runner. Fast-check is used for
the property tests; no new runtime dependencies are introduced.

## Tasks

- [x] 1. Create `js/bm-scoring.js` — pure scoring module scaffold
  - Create `js/bm-scoring.js` using the IIFE + UMD guard pattern from `js/student-averages.js`
  - Define all four scoring tables: `ECO_TABLE` / `ECO_DIVISOR = 85`, `SOC_TABLE` / `SOC_DIVISOR = 105`, `HEALTH_TABLE` + `HEALTH_REDFLAG_SYMPTOMS` / `HEALTH_DIVISOR = 139`, `FOLLOWUP_DIVISOR = 95`
  - Implement shared helpers `levelLabel(score)`, `clamp100(x)`, `round2(x)`, and the `arr(v)` array-coerce helper
  - Implement the `computeBmScore(axis, data)` dispatcher
  - Export `api` object on `window.GS2.BmScoring`, `window.computeBmScore`, and `module.exports` (UMD guard)
  - Add `<script src="js/bm-scoring.js">` to `student-profile-prototype.html` before `student-profile.js`
  - _Requirements: 7.1, 7.2, 7.3, 8.1_

- [x] 2. Implement the four axis scorer functions
  - [x] 2.1 Implement `computeEconomicScore(data)`
    - Apply `ECO_TABLE` for `eco_status` and `income_source`; add 5 pts when `distance_km > 10`; subtract 5 pts per active `support_programs` entry (floor 0); add min(`unmet_needs.length × 5`, 20); detect `hasAny`; normalize with `ECO_DIVISOR`; return `TabScoreResult`
    - Return `{ score: null, level: null, subScores: {} }` when `hasAny === false`
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 7.2_

  - [ ]* 2.2 Write property test for `computeEconomicScore` — Property 1: Score Range
    - **Property 1: Score Range** — for any arbitrary economic input, `score === null || (score >= 0 && score <= 100)`
    - **Validates: Requirements 1.2, 8.2**
    - `fast-check` ≥ 100 iterations; tag `Feature: student-profile-bm-scoring, Property 1`

  - [ ]* 2.3 Write property test for `computeEconomicScore` — Property 2: Null When All Absent
    - **Property 2: Null When All Absent** — `computeEconomicScore({})` returns `score === null` and `level === null`
    - **Validates: Requirements 1.4, 8.3**
    - `fast-check` ≥ 100 iterations; tag `Feature: student-profile-bm-scoring, Property 2`

  - [ ]* 2.4 Write property test for `computeEconomicScore` — Property 3/4: Best-case 0, Worst-case 100
    - **Property 3: Best-Case Zero** — `{ eco_status:'good', income_source:'stable', distance_km:0, support_programs:[], unmet_needs:[] }` → `score === 0`
    - **Property 4: Worst-Case 100** — `{ eco_status:'vpoor', income_source:'none', distance_km:15, support_programs:[], unmet_needs:['a','b','c','d'] }` → `score === 100`
    - **Validates: Requirements 1.1, 1.2, 8.4, 8.5**

  - [ ]* 2.5 Write property test for `computeEconomicScore` — Property 5/7: Monotonicity + Support Programs Beneficial
    - **Property 5: Monotonicity** — replacing a field with a worse value never decreases the score
    - **Property 7: Support Programs Are Beneficial** — adding a support program never increases the economic score
    - **Validates: Requirements 1.1, 8.6**
    - `fast-check` ≥ 100 iterations; tag `Feature: student-profile-bm-scoring, Property 5`

  - [x] 2.6 Implement `computeSocialScore(data)`
    - Apply `SOC_TABLE` for six radio fields (`family_status`, `parents_edu`, `housing`, `study_place`, `teachers_rel`, `peers_rel`); add min(`social_risks.length × 5`, 25); detect `hasAny`; normalize with `SOC_DIVISOR`
    - Return `{ score: null, level: null, subScores: {} }` when `hasAny === false`
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 7.2_

  - [ ]* 2.7 Write property tests for `computeSocialScore` — Properties 1–5
    - **Property 1** (Score Range): `score === null || (score >= 0 && score <= 100)` for any social input
    - **Property 2** (Null When All Absent): `computeSocialScore({})` → `score === null`
    - **Property 3** (Best-Case Zero): all radios at best value + `social_risks:[]` → `score === 0`
    - **Property 4** (Worst-Case 100): all radios at worst value + 5 social risks → `score === 100`
    - **Property 5** (Monotonicity): replacing any radio with a worse key never decreases the score
    - **Validates: Requirements 2.1, 2.2, 2.4, 8.2, 8.3, 8.4, 8.5, 8.6**
    - `fast-check` ≥ 100 iterations; tag `Feature: student-profile-bm-scoring, Property 1–5 (social)`

  - [x] 2.8 Implement `computeHealthScore(data)`
    - Apply `HEALTH_TABLE` for five radio fields; compute learning_disorders (×8, max 24), substances (×10, max 20), psych_symptoms (red-flag 12 / other 5, max 30), mood (1→15…5→0), motivation (1→10…5→0); detect `hasAny`; normalize with `HEALTH_DIVISOR`; clamp result to [0, 100]
    - Return `{ score: null, level: null, subScores: {} }` when `hasAny === false`
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6, 7.2_

  - [ ]* 2.9 Write property tests for `computeHealthScore` — Properties 1–5
    - **Property 1** (Score Range): non-null score always in [0, 100] including clamp edge cases
    - **Property 2** (Null When All Absent): `computeHealthScore({})` → `score === null`
    - **Property 3** (Best-Case Zero): all radios at best, all arrays empty, mood=5, motivation=5 → `score === 0`
    - **Property 4** (Worst-Case 100): all radios at worst, 3+ disorders, 2+ substances, 4 red-flag symptoms, mood=1, motivation=1, psych_referral='yes' → `score === 100`
    - **Property 5** (Monotonicity): replacing a field with a more adverse value never decreases the score
    - **Validates: Requirements 3.1, 3.2, 3.4, 3.6, 8.2, 8.3, 8.4, 8.5, 8.6**
    - `fast-check` ≥ 100 iterations; tag `Feature: student-profile-bm-scoring, Property 1–5 (health)`

  - [x] 2.10 Implement `computeFollowupScore(data)`
    - Compute contact points (0 contacts→25, 1–2→15, 3+→5); action points (50 − `actions_taken.length × 5`, floor 0); date penalty (+10 if no next_date); phone penalty (+10 if no guardian_phone); null-detection (all truly absent); normalize with `FOLLOWUP_DIVISOR`
    - Return `{ score: null, level: null, subScores: {} }` when all fields are truly absent
    - _Requirements: 4.1, 4.2, 4.4, 7.2_

  - [ ]* 2.11 Write property tests for `computeFollowupScore` — Properties 1–5, 8
    - **Property 1** (Score Range): non-null score always in [0, 100]
    - **Property 2** (Null When All Absent): `computeFollowupScore({})` → `score === null`
    - **Property 3** (Best-Case Zero): 3+ contacts, 10 actions, next_date set, guardian_phone set → `score === 0`
    - **Property 4** (Worst-Case 100): 0 contacts, 0 actions, no next_date, no guardian_phone → `score === 100`
    - **Property 8** (Followup Inverse Ordering): full intervention score < zero-intervention score
    - **Validates: Requirements 4.1, 4.2, 4.4, 8.2, 8.3, 8.4, 8.5, 8.6**
    - `fast-check` ≥ 100 iterations; tag `Feature: student-profile-bm-scoring, Property 1–5, 8 (followup)`

  - [ ]* 2.12 Write property test for level consistency — Property 6 (all four axes)
    - **Property 6: Level Consistency** — when `score !== null`: `score < 40 → level === 'منخفض'`, `40 ≤ score < 70 → level === 'متوسط'`, `score ≥ 70 → level === 'مرتفع'`; when `score === null` → `level === null`
    - **Validates: Requirements 5.1, 5.2, 7.2**
    - Run for all four scorer functions; `fast-check` ≥ 100 iterations; tag `Feature: student-profile-bm-scoring, Property 6`

- [x] 3. Checkpoint — Ensure all bm-scoring.js unit and property tests pass
  - Ensure all tests pass (`npm test`), ask the user if questions arise.

- [x] 4. Inject Score_Widgets and implement `updateScoreWidget`
  - [x] 4.1 Implement `injectScoreWidgets()` in `js/pages/student-profile.js`
    - For each of the four tab keys (`economic`, `social`, `health`, `followup`), build the Score_Widget HTML (container `#bm-score-widget-{key}`, header row with label + `#bm-score-val-{key}` + `#bm-score-badge-{key}`, progress track `bm-progress-bg` with fill `#bm-score-bar-{key}`) and `prepend` it inside the corresponding `#tab-{key}` panel element
    - Set initial `aria-label="سكور [اسم المحور]: غير محسوب"` on the container
    - Call `injectScoreWidgets()` at DOMContentLoaded, before `initBmScoring()`
    - _Requirements: 5.1, 5.3, 5.5_

  - [x] 4.2 Implement `updateScoreWidget(key, result)` in `js/pages/student-profile.js`
    - When `result === null` or `result.score === null`: set value span to `—`, bar width to `0%`, clear badge text and color, set `aria-label="سكور [اسم المحور]: غير محسوب"`
    - When `result.score` is non-null: clamp score to [0, 100], set value span to clamped score, set bar width to `score%`, set badge to `result.level`, apply CSS variable color (`--color-success-solid` for منخفض, `--color-warning-solid` for متوسط, `--color-danger-solid` for مرتفع) to bar fill and badge background, set `aria-label="سكور [اسم المحور]: [score] من 100 — [level]"`
    - All DOM updates run synchronously when called inside the 200 ms display `setTimeout`
    - Guard each `getElementById` call — return silently if the element is absent
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 5. Implement `_bmScoreState` cache and `initBmScoring()` wiring
  - [x] 5.1 Add `_bmScoreState` module-level object to `js/pages/student-profile.js`
    - Declare `const _bmScoreState = { economic: null, social: null, health: null, followup: null }` at module scope, parallel to the existing `_riskState`
    - _Requirements: 7.1 (Req 7 architecture note)_

  - [x] 5.2 Implement `initBmScoring()` in `js/pages/student-profile.js`
    - Guard with `if (!window.GS2?.BmScoring) return` for graceful degradation
    - Build `tabMapping` for the four tab IDs, each entry providing `key`, the matching scorer function reference from `window.GS2.BmScoring`, and the matching `collect*Data()` collector
    - For each tab element: attach delegated `change` and `input` listeners; attach a `click` listener that fires only when `e.target.closest('.bm-badge') || e.target.closest('.bm-scale-btn')` is truthy
    - All three listeners share a 500 ms debounce per tab key using `clearTimeout` / `setTimeout`: on fire, call scorer → store result in `_bmScoreState[key]` → schedule `updateScoreWidget` inside a nested 200 ms `setTimeout` → call `renderStudentRiskTab()`
    - Call `initBmScoring()` at DOMContentLoaded, after `injectScoreWidgets()`
    - _Requirements: 1.3, 2.3, 3.3, 4.3, 7.4_

- [x] 6. Implement `updateAllScoreWidgets()` and wire into `loadAllProfileTabs`
  - [x] 6.1 Implement `updateAllScoreWidgets()` in `js/pages/student-profile.js`
    - Guard with `if (!window.GS2?.BmScoring) return`
    - Destructure all four scorer functions from `window.GS2.BmScoring`
    - Call each scorer with its matching `collect*Data()` and store the result in `_bmScoreState`
    - Iterate `['economic','social','health','followup']` and call `updateScoreWidget(key, _bmScoreState[key])` for each
    - _Requirements: 7.5_

  - [x] 6.2 Call `updateAllScoreWidgets()` in `loadAllProfileTabs()` after the existing `bmAutoRiskFromTabs()` call
    - Insert `updateAllScoreWidgets();` on the line immediately following `bmAutoRiskFromTabs()` inside `loadAllProfileTabs()`
    - _Requirements: 7.5_

- [x] 7. Checkpoint — Ensure widget injection, state cache, and live scoring work end-to-end
  - Ensure all tests pass (`npm test`), ask the user if questions arise.

- [x] 8. Update `collectRiskInputs()` with the `bmScores` bridge and add axis summary card
  - [x] 8.1 Update `collectRiskInputs()` in `js/pages/student-profile.js` to attach `bmScores`
    - Add a `bmScores` sub-object to the returned inputs: `{ economic: _bmScoreState.economic?.score ?? null, social: _bmScoreState.social?.score ?? null, health: _bmScoreState.health?.score ?? null, followup: _bmScoreState.followup?.score ?? null }`
    - Do NOT modify the existing `social`, `economic`, or `health` keys — the Risk_Engine interface is unchanged
    - _Requirements: 6.1, 6.2, 6.4, 6.5_

  - [x] 8.2 Implement the axis summary card injection and rendering in `renderStudentRiskTab()`
    - Inject `#bm-axis-summary-card` inside `#tab-risk` (once, on first render) using the `bm-axis-summary-card` container with an `<h4>` title and one `.bm-progress-row` per axis
    - Show the card (`display:block`) only when all four `bmScores` entries in `collectRiskInputs()` are non-null; otherwise keep it hidden (`display:none`)
    - Each progress row shows the axis label, a `.bm-progress-fill` bar at `score%` with the matching `--color-*-solid` variable, and a text span `"[score] · [level]"`
    - _Requirements: 6.3_

- [x] 9. Final checkpoint — Ensure all tests pass and lint is clean
  - Run `npm test` and `npm run lint`; ensure all tests pass and there are no lint errors; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; top-level tasks are never optional.
- All property tests live in `tests/bm-scoring.test.js` (auto-discovered by `tests/run-all.js`) and use `fast-check` (already in `devDependencies`) with ≥ 100 iterations each.
- `js/bm-scoring.js` has no DOM access and no IPC — it must remain importable via `require()` for Node test runs.
- Tasks 5.2 and 6.2 both modify `js/pages/student-profile.js` and are placed in different waves to avoid edit conflicts.
- Task 8.1 also modifies `js/pages/student-profile.js`; it is in a later wave from task 5.2.
- The Risk_Engine interface (`computeStudentRisk`, its parameter structure, and return value) is unchanged — only the gathering side (`collectRiskInputs`) gains the new `bmScores` key.
- CSS variables (`--color-success-solid`, `--color-warning-solid`, `--color-danger-solid`) and class tokens (`.bm-progress-bg`, `.bm-progress-fill`, `.bm-progress-row`, `.bm-progress-lbl`) are already present in the stylesheet.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.6", "2.8", "2.10"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.7", "2.9", "2.11", "2.12"] },
    { "id": 3, "tasks": ["4.1", "4.2", "5.1"] },
    { "id": 4, "tasks": ["5.2", "6.1"] },
    { "id": 5, "tasks": ["6.2", "8.1"] },
    { "id": 6, "tasks": ["8.2"] }
  ]
}
```

---

# Code Review Remediation Tasks

Derived from the code review of `student-profile-prototype.html` and its supporting layers
(`js/bm-scoring.js`, `js/student-risk.js`, `js/pages/student-profile.js`, `main/ipc/students.js`,
`main/db/migrations.js`). Severity tags map to the review: Critical → C, High → H, Medium → M,
Low → L. Tasks are grouped to serialize edits to shared files and avoid parallel-edit conflicts.

## Remediation Plan

- [x] R1. (M2) Wire `confidence` into the health score in `js/bm-scoring.js`
  - Add a `CONF_POINTS` table (1→10 … 5→0, mirroring motivation), consume `data.confidence`, and add its max to the recomputed `HEALTH_DIVISOR`
  - Keep the `hasAny` / null-return contract intact

- [x] R2. (M4) Derive scoring divisors programmatically in `js/bm-scoring.js`
  - Replace the hand-computed `ECO_DIVISOR`/`SOC_DIVISOR`/`HEALTH_DIVISOR`/`FOLLOWUP_DIVISOR` magic numbers with values computed from the points tables + capped array contributions
  - Add a unit test asserting every axis max input yields `score <= 100`

- [x] R3. (M5) Freeze and protect the risk config in `js/student-risk.js`
  - Deep-`Object.freeze` `DEFAULT_CONFIG` before export; have `mergeConfig` always return a fresh object so callers can never mutate shared defaults
  - Move renderer globals (`computeStudentRisk`, `computeBmScore`) under `window.GS2` only; drop bare-global aliases where safe

- [ ] R4. (C2) Restrict read access on sensitive profile data in `main/ipc/students.js`
  - **HIGH RISK — needs decision.** Change `studentProfile:getAllTabs` from open read to a role-gated read (admin/staff/counselor); consider per-tab gating so the health/psych tab is most restricted
  - Confirm the intended role set with the user before enforcing

- [x] R5. (M1) Validate `data_json` on write in `main/ipc/students.js`
  - Enforce a per-tab key allowlist + value-type checks and a size cap (reject oversized payloads) before the upsert in `studentProfile:saveTab`

- [x] R6. (H1) Add student-scoped grade/absence IPC queries
  - Use the existing `grades:getByStudentCode` handler in the profile page; add an equivalent `absences:getByStudentCode` handler in `main/ipc/students.js` (or the absences IPC module) backed by `WHERE student_code = ? AND school_year = ?`

- [x] R7. (M3 + H3) Schema migration: FK + persisted risk snapshot
  - New migration in `main/db/migrations.js`: add `risk_score`/`risk_level` columns (or a `student_risk_snapshot` table keyed by `student_code, school_year`) and a real FK/cleanup path for `student_profile_data` (FK to `students` or drop the dead `student_id`)
  - Register any new table in sync capture + `system.js` allowlist as needed

- [x] R8. (L1) Centralize `escapeHtml`
  - Export the canonical `escapeHtml` from `js/utils.js` and remove the duplicate local copies across the page scripts

- [x] R9. (H2 + L2) HTML prototype: data-driven badge color + consistent script loading
  - In `student-profile-prototype.html`, add `data-color="<color>"` to every `.bm-badge` and remove the regex-on-`onclick` color recovery dependency; standardize all profile scripts on `defer`

- [x] R10. (H1 + H2 + H3 + L3) Controller updates in `js/pages/student-profile.js` (single owner)
  - Replace `grades.getAll`/`absences.getAll` over-fetch with the scoped queries from R6
  - Read badge color from `el.dataset.color` (R9) instead of parsing `onclick`
  - Persist the computed risk snapshot (R7) on save
  - Compute the deduped grade set/averages once and share between `renderMiniStats` and `renderGradesTab`; replace `Math.max(...arr)` spreads with `reduce`

- [ ] R11. (C1) Encrypt sensitive profile data at rest
  - **HIGH RISK — needs decision.** Options: full-DB encryption (SQLCipher / better-sqlite3-multiple-ciphers) vs. app-level field encryption for the health/psych tab. Both require a key-management strategy and a migration of existing data. Do NOT execute until the approach + key handling are agreed with the user.

## Remediation Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["R1", "R2", "R3", "R5", "R6", "R8", "R9"] },
    { "id": 1, "tasks": ["R7"] },
    { "id": 2, "tasks": ["R10"] }
  ],
  "deferredPendingDecision": ["R4", "R11"]
}
```

Notes:
- R1/R2 (bm-scoring.js), R3 (student-risk.js), R5/R6 (students.js), R8 (utils.js + page scripts), R9 (HTML) touch distinct files → safe to run in parallel (wave 0).
- R7 (migrations.js) is isolated but R10 depends on its columns → wave 1.
- R10 is the sole owner of `student-profile.js` edits → runs alone in wave 2 to avoid conflicts.
- R4 and R11 are high-risk security changes held for explicit user approval.
