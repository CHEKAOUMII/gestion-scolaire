# Implementation Plan: Student Profile Term Averages

## Overview

The work extracts the duplicated, pooled average computation in `js/pages/student-profile.js`
into a single pure module (`js/student-averages.js`) that computes Term_1_Average,
Term_2_Average, and General_Average from the same data, plus a pure `formatAverage` display
helper. Both render paths (`renderMiniStats`, `renderGradesTab`) are then rewired to consume that
shared result so the quick-stats card and grades-tab KPIs can never drift. The prototype HTML
gains two new term-average cells. The pure layers are property-tested with `fast-check`; the
render/label/print contracts are covered with DOM/example tests.

The new module reuses the existing `computeSubjectAverage`, `computeWeightedGeneralAverage`,
`detectBranch`, `ccBaseSubject`, `normalizeSubjectName`, and `gradeHex` helpers rather than
reimplementing any math. It uses a UMD-style guard so it loads as a browser global (via `<script>`)
and is `require`-able from Node test files, matching the repo's `tests/*.test.js` + `fast-check`
convention discovered in `package.json` and `tests/run-all.js`.

## Tasks

- [x] 1. Create the pure averaging module (`js/student-averages.js`)
  - [x] 1.1 Scaffold the module with shared constants and `computeTermAverage`
    - Create `js/student-averages.js` exposing `AVG_PLACEHOLDER = "—"`, a `round2(x) = Math.round(x*100)/100` helper, and `computeTermAverage(termGrades, branch)`.
    - `computeTermAverage` mirrors the existing grouping logic: dedup by `subject||semester`, group by base subject via `ccBaseSubject(normalizeSubjectName(subject))`, build `subjectAvgsArr` with `computeSubjectAverage`, then combine with `computeWeightedGeneralAverage(subjectAvgsArr, branch)`; return `null` (not `0`) when `termGrades` is empty or yields no usable subject averages, otherwise `round2` of the weighted average.
    - Resolve dependencies against the existing `cc-rules.js` globals when running in the browser and via `require` when running in Node, keeping `typeof fn === 'function'` guards so the module degrades gracefully.
    - Add a UMD-style export guard (`if (typeof module !== 'undefined' && module.exports)`) plus browser-global assignment so both `<script>` loading and Node `require` work.
    - _Requirements: 1.2, 1.3, 1.5, 1.6, 6.5_

  - [x] 1.2 Implement `computeStudentAverages(grades, branch)`
    - Partition `grades` into `term1` (`Number(semester) === 1`) and `term2` (`Number(semester) === 2`), excluding every other value (`0`, `null`, `undefined`, `''`, `NaN`, `3`, `"x"`, …) from both terms.
    - Compute `term1`/`term2` via `computeTermAverage` (each `null` when no records).
    - Derive `general`: mean (`round2((term1+term2)/2)`) when both are non-null; `round2` of the single available term when exactly one is non-null; `null` when both are null. After derivation, null out any `general` falling outside `[0, 20]`.
    - Return `{ term1: number|null, term2: number|null, general: number|null }`.
    - _Requirements: 1.1, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 1.3 Write property test for term average isolation
    - **Property 1: Term average isolation (model-based)** — `computeStudentAverages(...).term1`/`.term2` equal the weighted general average computed from only the `semester===1` / `semester===2` records.
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.5**
    - Use `fast-check` (≥100 iterations) with generators for random grade records (mixed Arabic/Latin subjects with `(فرض N)`/`(الأنشطة المندمجة)` suffixes, grades in `[0,20]`, semester drawn from `{1,2,0,null,'',3,'x'}`, branch from known codes plus `null`); tag with `Feature: student-profile-term-averages, Property 1`.

  - [ ]* 1.4 Write property test for unspecified-semester exclusion
    - **Property 2: Unspecified-semester records are excluded (metamorphic)** — inserting records whose `semester` is not strictly `1`/`2` does not change `term1`, `term2`, or `general`.
    - **Validates: Requirements 1.4, 2.4, 3.5**
    - `fast-check` ≥100 iterations; tag with `Feature: student-profile-term-averages, Property 2`.

  - [ ]* 1.5 Write property test for empty-term null result
    - **Property 3: An empty term yields no value (not zero)** — a term with zero records after partitioning has a `null` average, never `0`.
    - **Validates: Requirements 1.6, 2.1, 2.2, 2.3**
    - `fast-check` ≥100 iterations; tag with `Feature: student-profile-term-averages, Property 3`.

  - [ ]* 1.6 Write property test for general-average derivation
    - **Property 4: General-average derivation** — both non-null → `round2((term1+term2)/2)`; exactly one non-null → `round2` of that term; both null → `null`.
    - **Validates: Requirements 3.1, 3.2, 3.3**
    - `fast-check` ≥100 iterations; tag with `Feature: student-profile-term-averages, Property 4`.

  - [ ]* 1.7 Write property test for general-average range invariant
    - **Property 5: General-average range invariant** — returned `general` is `null` or a number within `[0, 20]`; out-of-range values are returned as `null`.
    - **Validates: Requirements 3.4, 3.6**
    - `fast-check` ≥100 iterations; tag with `Feature: student-profile-term-averages, Property 5`.

  - [ ]* 1.8 Write unit test confirming helper reuse
    - Assert `computeTermAverage` delegates to `computeWeightedGeneralAverage`/`computeSubjectAverage` (e.g. via spies/stubs) rather than reimplementing the math.
    - _Requirements: 6.5_

- [x] 2. Implement the formatting layer
  - [x] 2.1 Implement `formatAverage(value)` in `js/student-averages.js`
    - Return `{ text: value.toFixed(2), color: gradeHex(value) }` when `value` is a finite number within `[0, 20]`; otherwise (null, undefined, non-finite, or out of range) return `{ text: AVG_PLACEHOLDER, color: null }`.
    - Gate color application here so callers never apply a grade color to a placeholder.
    - Export it through the same UMD guard as the computation functions.
    - _Requirements: 4.4, 4.5, 4.6, 4.7, 5.4, 5.5, 5.7, 6.3_

  - [ ]* 2.2 Write property test for display format contract
    - **Property 6: Display format contract** — `formatAverage` returns `{ text: value.toFixed(2), color: gradeHex(value) }` for finite values in `[0,20]`, else `{ text: AVG_PLACEHOLDER, color: null }`.
    - **Validates: Requirements 4.4, 4.5, 4.6, 4.7, 5.4, 5.5, 5.7, 6.3**
    - `fast-check` ≥100 iterations over numbers (including boundaries 0/20, out-of-range, non-finite) plus `null`/`undefined`; tag with `Feature: student-profile-term-averages, Property 6`.

- [x] 3. Checkpoint - Ensure all compute/format tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Wire the averaging module into the quick-stats card
  - [x] 4.1 Add term-average markup and load the module in `student-profile-prototype.html`
    - Add two `.sp-mini-stat` rows inside `.sp-mini-stats`: `sp-stat-term1` labelled "معدل الدورة 1" and `sp-stat-term2` labelled "معدل الدورة 2", each defaulting to the placeholder; retain the existing `sp-stat-avg` ("المعدل العام") row. RTL/right-alignment is inherited from existing card styling.
    - Add a `<script>` tag to load `js/student-averages.js` (after `js/cc-rules.js`).
    - _Requirements: 4.1, 4.2, 4.3, 4.8_

  - [x] 4.2 Refactor `renderMiniStats` to use the shared computation and formatter
    - Replace the inline pooled computation with `computeStudentAverages(grades, detectBranch(...))` and render the three cells via `formatAverage`: `sp-stat-avg` ← General_Average (kept populated for the print/risk consumer), `sp-stat-term1` ← Term_1_Average, `sp-stat-term2` ← Term_2_Average.
    - Apply grade color only when `formatAverage` returns a non-null color; leave `sp-stat-subjects` and `sp-stat-absence` behavior unchanged.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 6.2, 6.3, 6.4_

  - [ ]* 4.3 Write DOM test for quick-stats labels, values, and print-consumer contract
    - In a jsdom fixture, assert the three labels and value cells exist, and that `sp-stat-avg` holds the formatted general value when available and the placeholder (with `parseFloat(...)` resolving to `NaN`) when unavailable.
    - _Requirements: 4.1, 4.2, 4.3, 6.2, 6.4_

- [x] 5. Wire the averaging module into the grades tab
  - [x] 5.1 Refactor `renderGradesTab` KPIs to use the shared computation result
    - Use the same `computeStudentAverages` result; add "معدل الدورة 1" and "معدل الدورة 2" KPIs alongside the existing "المعدل العام" in the KPIs row, each formatted via `formatAverage` with color gating.
    - Keep the existing KPIs (عدد المواد, عدد النقط, أعلى نقطة, أدنى نقطة) and the per-subject/per-semester breakdown unchanged.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1_

  - [ ]* 5.2 Write DOM test for grades-tab KPIs
    - Assert the three average labels/values render and the existing KPIs (عدد المواد, عدد النقط, أعلى نقطة, أدنى نقطة) are retained; assert placeholder rendering with no color when an average is unavailable.
    - _Requirements: 5.1, 5.2, 5.3, 5.6, 5.7_

- [ ] 6. Verify cross-view consistency
  - [ ]* 6.1 Write property test for cross-view consistency
    - **Property 7: Cross-view consistency** — the formatted text for Term_1_Average, Term_2_Average, and General_Average is identical between the quick-stats card and the grades tab (including the placeholder), because both derive from the same `computeStudentAverages` result and `formatAverage`.
    - **Validates: Requirements 6.1, 6.4**
    - `fast-check` ≥100 iterations; tag with `Feature: student-profile-term-averages, Property 7`.

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific requirement sub-clauses for traceability.
- Property-based tests use `fast-check` (already in `devDependencies`), run a minimum of 100 iterations, and are tagged `Feature: student-profile-term-averages, Property {n}`. New test files live in `tests/` so `tests/run-all.js` auto-discovers them.
- `js/student-averages.js` is the single source of truth for the computation and formatting layers; both render functions consume it, which is what guarantees Property 7 / Requirement 6.1 by construction.
- `tasks 4.2` and `5.1` both modify `js/pages/student-profile.js`, so they are scheduled in different waves to avoid edit conflicts.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"] },
    { "id": 3, "tasks": ["2.2", "4.1", "4.2"] },
    { "id": 4, "tasks": ["4.3", "5.1"] },
    { "id": 5, "tasks": ["5.2", "6.1"] }
  ]
}
```
