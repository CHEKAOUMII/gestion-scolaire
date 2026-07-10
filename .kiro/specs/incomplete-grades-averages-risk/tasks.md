# Implementation Plan

## Overview

Exploratory bugfix plan for two confirmed defects on the student profile page.
Bug 1 (PRIMARY) — not-yet-entered marks are coerced to genuine `0` and averaged
in, deflating subject/term/general averages and the lowest-mark KPI. Bug 2
(SECONDARY) — the dropout-risk gauge is colored/positioned by the composite index
while the label shows the worst-wins final level, with no axis attribution. Tasks
follow the exploration-first order: write failing bug-condition tests and passing
preservation tests on the UNFIXED code, then apply the fix (Bug 1 first since it
feeds cleaner inputs to the risk engine), then re-run the same tests to confirm
the bugs are resolved with no regressions. Run tests with `npm test` (single run,
not watch) and `npm run lint`.

## Tasks

- [x] 1. Write bug condition exploration test — phantom zeros (Bug 1)
  - **Property 1: Bug Condition** - Not-entered marks excluded from averages and KPIs
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate not-entered marks are coerced to genuine `0` and averaged in
  - **Scoped PBT Approach**: Generate grade sets with a configurable fraction of not-entered raw values (`null`, `undefined`, `''`, `'  '`, non-numeric placeholders) mixed with real Term‑1 marks; assert not-entered records never affect averages/KPIs. For reproducibility, also pin the concrete failing cases below.
  - Bug Condition (from design `isBugCondition` C1): a grade record whose RAW value is not-entered, that `Number()` coerces to a finite `0`, that survives the `Number.isFinite` filter, and that flows into averages/KPI as a real value
  - Test against the pure layers (`computeTermAverage`, `computeSubjectAverage`, `computeStudentAverages` in `js/student-averages.js` / `js/cc-rules.js`) plus the load-mapping path in `js/pages/student-profile.js`
  - Assertions must match Expected Behavior:
    - Subject phantom-zero: التربية البدنية Term‑1 `[20, 18.75, 17.5]`, Term‑2 `[null, null, null]` → expected ≈ `18.75` (unfixed shows `9.38`)
    - Empty Term‑2 average: all Term‑2 raw values not-entered → expected `null` ("قيد الإنجاز"/"—") (unfixed shows `1.61`)
    - General average: Term‑1 `8.42`, Term‑2 not-entered → expected `8.42` (unfixed shows `5.01`)
    - Lowest-mark KPI: real marks all ≥ `8` plus not-entered placeholders → expected lowest `8` (unfixed shows `0.0`)
  - Run test on UNFIXED code with `npm test` (single run, not watch)
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found (e.g. "Number(null/'')/Number('  ') coerced to 0 and averaged in; no entered/not-entered discriminator") to confirm or refute the root-cause analysis
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Write bug condition exploration test — contradictory risk gauge (Bug 2)
  - **Property 3: Bug Condition** - Gauge colored by final level with axis attribution
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected display behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface the counterexample where the gauge is colored/positioned by the composite index while the final worst-wins level differs, with no axis attribution
  - **Scoped PBT Approach**: For this deterministic display bug, scope the property to the concrete failing case (final `حرج`, composite `24.39%`) and assert the values the renderer would paint
  - Bug Condition (from design `isBugCondition` C2): `final.level !== layer2.level` AND gauge colored/positioned by composite AND triggering axis not surfaced
  - Drive `computeStudentRisk` (`js/student-risk.js`) with inputs where Axis A (النتائج الدراسية) forces حرج while the composite is ~24% and inspect the render inputs of `renderStudentRiskTab()`
  - Assertions must match Expected Behavior: gauge colored by `final.level`, composite index and highest axis shown as separate non-contradictory facts, a prominent triggering-axis badge ("صُنّف حرج بسبب محور: النتائج الدراسية"), and a preliminary marker ("أولي / قيد الإنجاز") when data is incomplete
  - Run test on UNFIXED code with `npm test` (single run, not watch)
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - the unfixed code positions the bar at 24.39% in the عادي band labeled "حرج" with no attribution)
  - Document the counterexample (gauge width keyed to composite index; axis attribution buried in recommendation paragraph; no preliminary marker)
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.5, 1.6, 1.7_

- [x] 3. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Genuine zeros and complete data unchanged; worst-wins rule, composite formula, and agreeing gauges unchanged
  - **IMPORTANT**: Follow observation-first methodology — observe behavior on the UNFIXED code first, then assert it
  - Observe and record outputs on UNFIXED code for inputs where the bug condition does NOT hold:
    - Genuine-zero record (raw numeric `0` / `'0'`) included in averages/KPIs exactly as today (Req 3.1)
    - Fully-entered grade sets → record original subject, term, general averages (Req 3.2, 3.3)
    - Random risk inputs → record `computeStudentRisk` output (composite, layer levels, final level) (Req 3.4, 3.5)
    - Risk inputs where `final.level === layer2.level` → record the rendered gauge level and color (Req 3.6)
  - Write property-based tests capturing the observed behavior patterns (property-based testing generates many inputs for stronger preservation guarantees):
    - For all records where `isGradeEntered(raw) === true` (including genuine `0`), fixed averages/KPIs equal a reference computed the original way
    - For all random risk inputs, `computeStudentRisk` output is identical pre/post change (engine byte-for-byte unchanged: worst-wins `final.level = max(layer1, layer2)` and weighted composite A 30% + B 30% + C 15% + D 15% + E 10%)
    - For all inputs where `final.level === layer2.level`, the rendered gauge keeps the same level and color as today
  - Run tests on UNFIXED code with `npm test` (single run, not watch)
  - **EXPECTED OUTCOME**: Tests PASS (this confirms the baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 4. Fix for incomplete-grades averages (Bug 1) and contradictory risk gauge (Bug 2)

  - [x] 4.1 Add the not-entered discriminator and gate the pure averaging layers (Bug 1)
    - Add `isGradeEntered(raw)` predicate to `js/student-averages.js` (inspect the RAW value before coercion): return `false` for `null`, `undefined`, empty/whitespace strings, and non-numeric placeholders; return `true` for finite numbers and numeric strings including `0` / `'0'`. Export it on `window.GS2.StudentAverages` + bare global so renderer and tests share one definition
    - In `computeTermAverage`, drop records where `isGradeEntered(g.grade) === false` before grouping; a term whose records are all not-entered yields `null` (mapped to "—"/"قيد الإنجاز" by `formatAverage`)
    - In `computeSubjectAverage` (`js/cc-rules.js`), skip not-entered records using the same predicate when splitting exams/activities; keep the existing `Number.isFinite(val)` guard; genuine numeric `0` still counts
    - _Bug_Condition: isBugCondition(input) C1 — not-entered raw value coerced to finite 0 and counted as genuine_
    - _Expected_Behavior: expectedBehavior(result) — not-entered excluded from subject/term/general averages and shown "قيد الإنجاز"/"—"_
    - _Preservation: Genuine zeros and complete-data averages unchanged (Property 2)_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 4.2 Stop coercing not-entered → 0 at load and clean the KPI/risk inputs (Bug 1)
    - In `js/pages/student-profile.js`, replace the load mapping so a not-entered raw value is preserved as a not-entered sentinel (e.g. left as `null`) instead of `Number(null) === 0`; filter to keep only entered finite numbers (including genuine `0`), discarding only not-entered placeholders, so `studentGrades` never contains a phantom zero
    - Compute `minGrade`/`maxGrade` lowest/highest-mark KPI over entered records only (the load-step change makes the existing `reduce` correct once input is clean)
    - Derive `_riskState.subjectAverages` from the now-clean per-subject averages (no extra change beyond 4.1/4.2) so risk Axis A is no longer contaminated by phantom zeros
    - _Bug_Condition: isBugCondition(input) C1 — phantom zero reaching KPI and risk Axis A_
    - _Expected_Behavior: expectedBehavior(result) — lowest-mark KPI ignores not-entered marks; risk Axis A computed from clean averages_
    - _Preservation: Genuine zeros preserved as real explicit values (Property 2)_
    - _Requirements: 2.4_

  - [x] 4.3 Display-only risk gauge fix — color by final level, axis attribution, preliminary marker (Bug 2)
    - In `renderStudentRiskTab()` (`js/pages/student-profile.js`), color/label the gauge strictly by `final.level` (`solid = _RISK_LEVEL_SOLID[final.level]`), never by the composite zone
    - Render the composite index and highest axis as distinct labeled facts: "المؤشر المركّب = `{layer2.composite}`%" and "أعلى محور = `{LEVEL_LABEL[layer1.level]}`"
    - When `layer1.level > layer2.level`, render a prominent badge naming the triggering axis ("صُنّف «{final.label}» بسبب محور: {triggering axis labels}"), promoted out of the recommendation paragraph
    - When the underlying data is incomplete (in-progress year — a term with no entered marks), annotate the index as "أولي / قيد الإنجاز"
    - Add badge container and the composite/highest-axis fact line near `#bm-risk-bar` in `student-profile-prototype.html`; optionally clarify the legend that the bar is "المؤشر المركّب"
    - **NO CHANGE** to `js/student-risk.js` — worst-wins rule and weighted composite formula preserved
    - _Bug_Condition: isBugCondition(input) C2 — gauge colored/positioned by composite while final differs, no axis attribution_
    - _Expected_Behavior: expectedBehavior(result) — gauge colored by final level + separated composite/axis facts + triggering-axis badge + preliminary marker_
    - _Preservation: Engine untouched; agreeing gauges (final === layer2) unchanged (Property 4)_
    - _Requirements: 2.5, 2.6, 2.7_

  - [x] 4.4 Verify bug condition exploration test — phantom zeros (Bug 1) now passes
    - **Property 1: Expected Behavior** - Not-entered marks excluded from averages and KPIs
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior; when it passes it confirms the expected behavior is satisfied
    - Run the bug condition exploration test from task 1 with `npm test` (single run, not watch)
    - **EXPECTED OUTCOME**: Test PASSES (confirms التربية البدنية ≈ `18.75`, Term‑2 average "—", general `8.42`, lowest-mark KPI ignores placeholders)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 4.5 Verify bug condition exploration test — risk gauge (Bug 2) now passes
    - **Property 3: Expected Behavior** - Gauge colored by final level with axis attribution
    - **IMPORTANT**: Re-run the SAME test from task 2 - do NOT write a new test
    - Run the bug condition exploration test from task 2 with `npm test` (single run, not watch)
    - **EXPECTED OUTCOME**: Test PASSES (gauge colored by `final.level`, composite + highest-axis separated, triggering-axis badge present, preliminary marker shown for incomplete data)
    - _Requirements: 2.5, 2.6, 2.7_

  - [x] 4.6 Verify preservation tests still pass
    - **Property 2: Preservation** - Genuine zeros, complete data, worst-wins rule, composite formula, and agreeing gauges unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 3 - do NOT write new tests
    - Run the preservation property tests from task 3 with `npm test` (single run, not watch)
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions — genuine zeros preserved, complete-data averages identical, `computeStudentRisk` output byte-for-byte unchanged, agreeing gauges unchanged)
    - Confirm all tests still pass after the fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 5. Checkpoint - Ensure all tests pass
  - Run the full suite with `npm test` and `npm run lint`
  - Confirm Property 1 & Property 3 (bug condition) tests now PASS and Property 2 & Property 4 (preservation) tests still PASS
  - Ensure all tests pass; ask the user if questions arise

## Task Dependency Graph

```json
{
  "waves": [
    {
      "wave": 1,
      "description": "Establish baseline on UNFIXED code: bug-condition tests fail, preservation tests pass",
      "tasks": ["1", "2", "3"]
    },
    {
      "wave": 2,
      "description": "Bug 1 fix — discriminator + gate pure averaging layers (depends on tasks 1, 3)",
      "tasks": ["4.1"]
    },
    {
      "wave": 3,
      "description": "Bug 1 fix — stop coercion at load, clean KPI/risk inputs (depends on 4.1)",
      "tasks": ["4.2"]
    },
    {
      "wave": 4,
      "description": "Bug 2 display-only fix (depends on tasks 2, 3)",
      "tasks": ["4.3"]
    },
    {
      "wave": 5,
      "description": "Verify fixes and preservation (depends on 4.1, 4.2, 4.3)",
      "tasks": ["4.4", "4.5", "4.6"]
    },
    {
      "wave": 6,
      "description": "Final checkpoint (depends on 4.4, 4.5, 4.6)",
      "tasks": ["5"]
    }
  ]
}
```

## Notes

- **Exploration-first**: Tasks 1 and 2 MUST fail on the unfixed code (proving the
  bugs exist) and MUST NOT be "fixed" when they fail. Task 3 MUST pass on the
  unfixed code (establishing the preservation baseline).
- **Priority**: Bug 1 is fixed before Bug 2 because phantom zeros contaminate
  risk Axis A; cleaning the averages feeds correct inputs to the risk engine.
- **Engine untouched**: `js/student-risk.js` is NOT modified. The Bug 2 fix is
  display-only in `renderStudentRiskTab()` and `student-profile-prototype.html`.
- **Genuine zero preservation**: A deliberately recorded `0` (raw `0` / `'0'`,
  meaning exam absence/cheating) must remain a real explicit value — never
  reclassified as not-entered.
- **Property mapping**: Property 1 (Bug 1 condition) + Property 3 (Bug 2
  condition) are the exploration tests; Property 2 + Property 4 are preservation.
- Run tests with `npm test` (single run, not watch mode) and `npm run lint`.
