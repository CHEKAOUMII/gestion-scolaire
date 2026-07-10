# Incomplete-Grades Averages & Risk Bugfix Design

## Overview

This design fixes two confirmed defects that surface on the student profile page
(`student-profile-prototype.html` / `js/pages/student-profile.js`) while the
school year is still in progress and Term‑2 (الدورة الثانية) marks have not been
entered yet.

**Bug 1 (PRIMARY) — phantom zeros.** Not-yet-entered marks reach the renderer as
empty/blank raw values and are coerced to a genuine-looking `0.00` by the load
mapping `grades.map(g => ({ ...g, grade: Number(g.grade) }))`. `Number(null)`,
`Number('')` and `Number('  ')` all evaluate to `0`, which then passes the
`Number.isFinite` filter and flows into the averaging layer
(`js/student-averages.js` → `js/cc-rules.js`) and the lowest-mark KPI as a real
zero. This deflates subject/term/general averages and reports a phantom `0.0`
lowest mark. The fix introduces a single predicate that classifies a raw grade
value as *entered* or *not-entered* **before** numeric coercion, drops
not-entered records from every consumer, and leaves a genuine, deliberately
recorded `0` (exam absence/cheating) untouched as a real explicit value.

**Bug 2 (SECONDARY) — self-contradictory risk gauge.** The risk gauge fill width
is the weighted composite index (e.g. `24.39%`), which lands in the عادي legend
zone (`0–30`), while the label shows the final worst-wins level "حرج". With no
on-gauge indication of which axis triggered the escalation, the display looks
like an error. The two-layer methodology (`finalLevel = max(layer1, layer2)` and
the weighted composite formula in `js/student-risk.js`) is intentional and stays
unchanged. The fix is **display-only** in `renderStudentRiskTab()` and the
prototype markup: color by FINAL level, present the composite index and the
highest axis as separate non-contradictory facts, surface a badge naming the
triggering axis, and mark the index as preliminary ("أولي / قيد الإنجاز") while
the year is in progress with incomplete data.

**Dependency & priority.** Phantom zeros also inflate risk Axis A (the "subjects
below 10/20" share), so Bug 1 is fixed first; its correction feeds cleaner
inputs into the risk engine before the display-only Bug 2 work.

## Glossary

- **Bug_Condition (C)**: The condition that triggers a defect. C1 = a grade
  record whose raw value is *not-entered* is treated as a genuine `0`. C2 = the
  risk gauge is colored/positioned by the composite index while the final level
  differs, with no axis attribution.
- **Property (P)**: The desired behavior. P1 = not-entered marks are excluded
  from averages/KPIs and shown as "قيد الإنجاز"/"—". P2 = the gauge is colored by
  the FINAL level and shows composite + highest axis as separated facts plus a
  triggering-axis badge.
- **Preservation**: Genuine zeros, complete-data averages, the worst-wins rule
  and the weighted composite formula must remain bit-for-bit unchanged.
- **Not-entered mark**: A grade slot that has not yet been filled in. Reaches the
  renderer as a raw `null`, `undefined`, `''`, whitespace-only string, or other
  non-numeric value. Distinct from a genuine `0`.
- **Genuine zero**: A deliberately recorded numeric `0` (raw `0` or `'0'`),
  meaning exam absence/cheating. A real, explicit, rare value.
- **`isGradeEntered(raw)`**: New predicate (the fix's discriminator) that returns
  `true` only when the RAW value, inspected before coercion, is a finite number
  (including `0`/`'0'`), and `false` for not-entered placeholders.
- **`computeStudentAverages` / `computeTermAverage`**: Pure averaging entry points
  in `js/student-averages.js`.
- **`computeSubjectAverage` / `computeWeightedGeneralAverage`**: Pure math in
  `js/cc-rules.js`.
- **`computeStudentRisk`**: Pure two-layer risk engine in `js/student-risk.js`.
  `final.level = max(layer1.level, layer2.level)`; `layer2.composite` is the
  weighted index in `[0,100]`.
- **`renderStudentRiskTab()`**: DOM renderer in `js/pages/student-profile.js` that
  paints the gauge, breakdown, badge and recommendation from the engine result.

## Bug Details

### Bug Condition

**Bug 1 — not-entered marks treated as genuine zeros.** The bug manifests when a
grade record arrives with a raw value that represents "not entered yet"
(`null`, `undefined`, `''`, blank/whitespace, or other non-numeric), the load
mapping coerces it with `Number()` to `0`, the `Number.isFinite` filter keeps it,
and the averaging/KPI layers then count it as a real `0`. The system is unable to
distinguish such a coerced placeholder from a genuine, deliberately recorded `0`.

**Bug 2 — gauge colored/positioned by composite while level is worst-wins.** The
bug manifests when `final.level` (worst-wins) differs from the composite-index
zone: the gauge fill is the composite percentage and lands in a lower-severity
legend band while the label shows a higher final level, and no badge names the
axis that triggered the escalation.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type RenderContext { gradeRecords[], riskResult }
  OUTPUT: boolean

  // C1 — phantom-zero bug (Bug 1)
  LET c1 = EXISTS g IN input.gradeRecords SUCH THAT
             isNotEntered(g.rawGrade)                      // raw is null/''/blank/non-numeric
             AND Number(g.rawGrade) IS FINITE              // coerces to a number (0)
             AND recordCountedAsGenuine(g)                 // flows into avg / KPI as a real value

  // C2 — contradictory risk display (Bug 2)
  LET c2 = input.riskResult.final.level <> input.riskResult.layer2.level
             AND gaugeColoredOrPositionedByComposite(input.riskResult)
             AND NOT triggeringAxisSurfaced(input.riskResult)

  RETURN c1 OR c2
END FUNCTION

FUNCTION isNotEntered(raw)
  RETURN raw == null
         OR raw == undefined
         OR (typeof raw == 'string' AND trim(raw) == '')
         OR NOT isFiniteNumber(Number(raw)) AND raw is non-numeric placeholder
  // NOTE: a genuine numeric 0 or '0' is NOT not-entered.
END FUNCTION
```

### Examples

- **التربية البدنية (Bug 1)**: Term‑1 marks `20.00 / 18.75 / 17.50`, Term‑2 slots
  not entered (raw blank). Expected subject average ≈ `18.75`; actual shows
  `9.38` because the blanks were averaged in as `0`.
- **Term‑2 average (Bug 1)**: No real Term‑2 marks entered; expected "قيد
  الإنجاز"/"—"; actual shows a numeric `1.61` built from phantom zeros.
- **General average (Bug 1)**: Term‑1 = `8.42`, Term‑2 not entered. Expected
  general = `8.42`; actual = `(8.42 + 1.61)/2 = 5.01`.
- **Lowest-mark KPI (Bug 1)**: Expected lowest among real marks; actual reports
  `0.0` drawn from a not-entered placeholder.
- **Genuine zero (edge — must be preserved)**: A student deliberately marked `0`
  for exam absence. Expected: counted as a real `0` in averages/KPIs. Must NOT be
  reclassified as not-entered.
- **Risk gauge (Bug 2)**: `final.level = حرج` (Axis A worst-wins), composite =
  `24.39%`. Expected: red gauge by final level + "المؤشر المركّب = 24.39%" +
  "أعلى محور = حرج" + a badge "صُنّف حرج بسبب محور: النتائج الدراسية". Actual: a
  bar filled to 24.39% in the عادي band labeled "حرج" with no attribution.
- **Risk gauge (edge — agreeing levels, must be preserved)**: composite `75%`,
  final `حرج`. Both already agree → the gauge stays consistent and unchanged.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- A genuine, deliberately recorded `0` (raw numeric `0` / `'0'`) continues to be
  treated as a real `0` and included in averages and KPIs (Req 3.1).
- A student with complete entered data for all terms/subjects produces identical
  subject, term, and general averages to those produced today (Req 3.2).
- A term or general average already computed only from real entered marks
  displays the same value unchanged (Req 3.3).
- A student failing >70% of subjects (from real marks) is still classified "حرج"
  via the worst-wins rule (Req 3.4).
- The composite risk index keeps using the intended weighted formula
  (A 30% + B 30% + C 15% + D 15% + E 10%) (Req 3.5).
- When the final level and the composite-index zone already agree, the gauge is
  displayed consistently with the same level and color as today (Req 3.6).

**Scope:**
All inputs that do NOT meet the bug condition must be completely unaffected:
- Grade records whose raw value is a finite number (including a genuine `0`).
- Risk computations where `final.level === layer2.level` (gauge already agrees).
- The pure engines `js/student-risk.js` and the math in `js/cc-rules.js` (the
  Bug 2 fix is display-only and the Bug 1 fix never changes the genuine-value
  arithmetic).

**Note:** The expected correct behaviors are enumerated in the Correctness
Properties section below.

## Hypothesized Root Cause

### Bug 1 — phantom zeros

1. **Coercion before classification (primary)**: In
   `js/pages/student-profile.js` the load step
   `rawGrades.map(g => ({ ...g, grade: Number(g.grade) })).filter(g => Number.isFinite(g.grade))`
   applies `Number()` to the raw value. Because `Number(null) === 0`,
   `Number('') === 0`, and `Number('  ') === 0`, any not-entered placeholder
   becomes a finite `0` that survives the filter and is indistinguishable from a
   genuine `0` downstream.

2. **No entered/not-entered discriminator**: Neither the renderer nor the pure
   layers (`computeStudentAverages`, `computeTermAverage`, `computeSubjectAverage`)
   have a concept of "not entered". They reasonably assume every finite number is
   a real mark, so the phantom zeros are averaged in and feed the min-KPI
   (`studentGrades.reduce((m,g) => g.grade < m ? g.grade : m, Infinity)`).

3. **Risk Axis A contamination (downstream)**: `_riskState.subjectAverages` is
   built from the same contaminated per-subject averages, so the "subjects below
   10/20" share is inflated, pushing Axis A toward حرج.

### Bug 2 — contradictory risk display

4. **Gauge positioned/colored against the wrong scale**: In
   `renderStudentRiskTab()` the gauge fill is `bar.style.width = final.score + '%'`
   where `final.score` is the composite index, while the legend underneath marks
   `0–30 عادي / 31–60 خطر / 61–100 حرج`. A worst-wins حرج label therefore appears
   over a bar that visually sits in the عادي band.

5. **Axis attribution buried**: The triggering axis is only mentioned inside the
   recommendation paragraph when `layer1.level > layer2.level`; there is no
   prominent on-gauge badge, so the contradiction reads as a bug.

6. **No preliminary indicator**: During an in-progress year the index is shown at
   full confidence with no "أولي / قيد الإنجاز" marker.

## Correctness Properties

Property 1: Bug Condition (Bug 1) — Not-entered marks excluded from averages and KPIs

_For any_ set of grade records where at least one record's raw value is
not-entered (`isGradeEntered(raw) === false`), the fixed code SHALL exclude those
records from subject averages, term averages, the general average, and the
lowest-mark KPI, and SHALL present a subject/term with no entered marks as "قيد
الإنجاز"/"—" instead of a numeric value derived from `0`.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation (Bug 1) — Genuine zeros and complete data unchanged

_For any_ set of grade records where every raw value is a finite number
(`isGradeEntered(raw) === true` for all, including genuine `0`/`'0'`), the fixed
averaging and KPI code SHALL produce exactly the same subject, term, general
averages and lowest-mark KPI as the original code, preserving genuine zeros as
real explicit values.

**Validates: Requirements 3.1, 3.2, 3.3**

Property 3: Bug Condition (Bug 2) — Gauge colored by final level with axis attribution

_For any_ risk result where `final.level !== layer2.level`, the fixed display
SHALL color the gauge/level by `final.level`, SHALL render the composite index and
the highest axis as separate, clearly-labeled, non-contradictory pieces of
information, SHALL surface a prominent badge naming the triggering axis, and SHALL
mark the index as preliminary ("أولي / قيد الإنجاز") when the underlying data is
incomplete.

**Validates: Requirements 2.5, 2.6, 2.7**

Property 4: Preservation (Bug 2) — Worst-wins rule, composite formula, and agreeing gauges unchanged

_For any_ risk input, the fixed code SHALL keep the pure engine
(`computeStudentRisk`) byte-for-byte unchanged — the worst-wins rule
`final.level = max(layer1.level, layer2.level)` and the weighted composite formula
(A 30% + B 30% + C 15% + D 15% + E 10%) — and _for any_ result where
`final.level === layer2.level` the displayed gauge SHALL keep the same level and
color as today.

**Validates: Requirements 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

Assuming the root-cause analysis is correct.

#### Bug 1 — distinguish not-entered from genuine zero

**File**: `js/student-averages.js` (shared, pure — single source of truth)

1. **Add `isGradeEntered(raw)` predicate**: Inspect the RAW value (pre-coercion).
   Return `false` for `null`, `undefined`, empty/whitespace strings, and
   non-numeric placeholders; return `true` for finite numbers and numeric strings
   including `0` / `'0'`. Export it on the API (`window.GS2.StudentAverages` +
   bare global) so the renderer and tests share one definition.

2. **Use raw-value gating in `computeTermAverage`**: Before grouping, drop records
   where `isGradeEntered(g.grade)` is `false` (inspecting the value as delivered,
   not a coerced `0`). A term whose records are all not-entered yields `null`
   (already mapped to "—"/"قيد الإنجاز" by `formatAverage`).

**File**: `js/cc-rules.js`

3. **`computeSubjectAverage` not-entered gating**: When splitting exams/activities,
   skip not-entered records using the same predicate rather than letting a
   coerced `0` enter `examGrades`/`activityGrades`. Genuine numeric `0` still
   counts. (The existing `Number.isFinite(val)` guard is kept; the new check
   additionally rejects coerced placeholders by examining the raw value.)

**File**: `js/pages/student-profile.js`

4. **Stop coercing not-entered → 0 at load**: Replace the load mapping so a
   not-entered raw value is preserved as a not-entered sentinel (e.g. left as
   `null`) instead of `Number(null) === 0`. Filter to keep records that are
   either entered finite numbers (including genuine `0`) — discarding only
   not-entered placeholders — so downstream `studentGrades` never contains a
   phantom zero.
5. **Lowest/highest-mark KPI**: Compute `minGrade`/`maxGrade` over entered
   records only (the load-step change in #4 already removes not-entered records,
   so the existing `reduce` is correct once the input is clean).
6. **Risk Axis A inputs**: `_riskState.subjectAverages` is derived from the now
   clean per-subject averages — no extra change beyond #3/#4.

#### Bug 2 — display-only risk gauge fix (engine untouched)

**File**: `js/pages/student-profile.js` → `renderStudentRiskTab()`

7. **Color/label strictly by final level**: Keep `solid = _RISK_LEVEL_SOLID[final.level]`
   for the bar background and label color (confirm it is the FINAL level, never
   the composite zone).
8. **Separate, non-contradictory facts**: Render the composite index and the
   highest axis as distinct labeled items, e.g. "المؤشر المركّب = `{layer2.composite}`%"
   and "أعلى محور = `{LEVEL_LABEL[layer1.level]}`", so the gauge fill width is
   explicitly understood as the composite, not the final level.
9. **Triggering-axis badge**: When `layer1.level > layer2.level`, render a
   prominent badge naming the worst criterion(s): "صُنّف «{final.label}» بسبب
   محور: {triggering axis labels}". Promote this out of the recommendation
   paragraph into a visible badge.
10. **Preliminary marker**: When the underlying data is incomplete (in-progress
    year — e.g. a term with no entered marks), annotate the index as
    "أولي / قيد الإنجاز".

**File**: `student-profile-prototype.html`

11. **Gauge markup support**: Add the badge container and the composite/highest-axis
    fact line near `#bm-risk-bar`, and (optionally) clarify the legend so the bar
    is labeled as "المؤشر المركّب". No change to the pure engine or its formula.

**File**: `js/student-risk.js` — **NO CHANGE** (worst-wins + weighted composite
preserved per Req 3.4/3.5).

## Testing Strategy

### Validation Approach

Two phases: first surface counterexamples that demonstrate each bug on the
unfixed code, then verify the fix corrects the bug condition and preserves all
non-buggy behavior. Property-based testing targets the pure layers
(`js/student-averages.js`, `js/cc-rules.js`, `js/student-risk.js`), which are
Node-runnable without Electron. Run tests with `npm test` (use a single run, not
watch mode).

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE the fix.
Confirm or refute the root-cause analysis; if refuted, re-hypothesize.

**Test Plan**: For Bug 1, feed `computeTermAverage`/`computeSubjectAverage` and
the load-mapping path grade records containing not-entered raw values (`null`,
`''`, `'  '`) alongside real Term‑1 marks and assert the produced averages/KPI.
For Bug 2, run `computeStudentRisk` with inputs where Axis A forces حرج while the
composite is ~24% and inspect the values the renderer would paint.

**Test Cases**:
1. **Subject phantom-zero**: التربية البدنية Term‑1 `[20, 18.75, 17.5]`, Term‑2
   `[null, null, null]` → expected ≈ `18.75`, unfixed shows `9.38` (will fail on
   unfixed code).
2. **Empty Term‑2 average**: all Term‑2 raw values not-entered → expected `null`
   ("—"), unfixed shows `1.61` (will fail on unfixed code).
3. **General average**: Term‑1 `8.42`, Term‑2 not-entered → expected `8.42`,
   unfixed shows `5.01` (will fail on unfixed code).
4. **Lowest-mark KPI**: real marks all ≥ `8`, plus not-entered placeholders →
   expected lowest `8`, unfixed shows `0.0` (will fail on unfixed code).
5. **Risk display contradiction**: final `حرج`, composite `24.39%` → expected
   gauge colored by final level + axis badge; unfixed positions the bar in the
   عادي band with no attribution (will fail on unfixed code).

**Expected Counterexamples**:
- Not-entered placeholders coerced to `0` and averaged in.
- Possible causes: `Number(null/'')` coercion, missing entered/not-entered
  discriminator, gauge width keyed to composite index, no axis badge.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed code
produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedRender(input)
  ASSERT expectedBehavior(result)   // not-entered excluded & shown "قيد الإنجاز"/"—";
                                     // gauge colored by final level + axis badge + preliminary
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the
fixed code produces the same result as the original.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalCompute(input) = fixedCompute(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation
because it generates many inputs across the domain, catches edge cases manual
tests miss, and gives strong guarantees that genuine zeros, complete-data
averages, and the risk engine's formula/worst-wins output are unchanged.

**Test Plan**: Observe behavior on the UNFIXED code for fully-entered records
(including genuine zeros) and for risk inputs where the levels already agree,
then write property-based tests asserting the fixed code matches.

**Test Cases**:
1. **Genuine-zero preservation**: a record with raw numeric `0` is included in
   averages/KPIs exactly as before (Req 3.1).
2. **Complete-data preservation**: all terms/subjects entered → fixed averages
   equal original averages for random valid grade sets (Req 3.2, 3.3).
3. **Engine preservation**: random risk inputs → `computeStudentRisk` output
   (composite, layer levels, final level) is identical pre/post change (Req 3.4,
   3.5).
4. **Agreeing-gauge preservation**: inputs where `final.level === layer2.level`
   render the same level and color as today (Req 3.6).

### Unit Tests

- `isGradeEntered(raw)` truth table: `null`, `undefined`, `''`, `'  '`, `'x'`
  → `false`; `0`, `'0'`, `12.5`, `'18.75'`, `20` → `true`.
- `computeTermAverage` / `computeSubjectAverage` with mixed entered/not-entered
  records and with a genuine `0`.
- `computeStudentAverages` general-average derivation when one term is entirely
  not-entered.
- Lowest/highest-mark KPI over records containing not-entered placeholders.
- `renderStudentRiskTab` display branches: final≠composite (badge + preliminary),
  final===composite (unchanged), gauge color sourced from `final.level`.

### Property-Based Tests

- Generate random grade sets with a configurable fraction of not-entered raw
  values and assert not-entered records never affect averages/KPIs (Property 1).
- Generate random fully-entered grade sets (including genuine zeros) and assert
  fixed averages equal a reference computed the original way (Property 2).
- Generate random risk inputs and assert the engine result is unchanged and that
  the rendered gauge color always derives from `final.level` (Properties 3 & 4).

### Integration Tests

- Full student-profile render with an in-progress year (Term‑2 not entered):
  quick-stats card, grades-tab KPIs and the subject chart all show "قيد الإنجاز"/
  "—" for Term‑2 and the correct Term‑1-based general average; the two views
  never drift.
- Risk tab end-to-end: a worst-wins حرج over a low composite renders a red gauge,
  a "أعلى محور = ..." fact, a triggering-axis badge, and a preliminary marker.
- Genuine-zero student renders unchanged averages and a consistent, agreeing
  risk gauge.
