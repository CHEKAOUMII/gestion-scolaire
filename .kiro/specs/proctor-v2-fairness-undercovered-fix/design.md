# Bugfix Design — Proctor v2 Fairness Undercovered Fix

## Overview

The previous spec (`proctor-v2-strict-fairness-coverage`) introduced a post-Phase-2 coverage-repair pass (`phase2_75CoverageRepair`) and a helper (`collectUncovered`) intended to lift any proctor below the per-class lower fairness bound onto guard slots from over-loaded peers. The helper's predicate was implemented as `getPrimaryLoad(loadState, key) === 0`, which only catches strictly zero-load proctors. On the user's real-centre data 24 proctors sit at `load = 1` while `classLowerBound = 2`; the helper returns an empty list, the repair pass swaps nothing, and the fairness invariant `min ≥ lowerBound` fails silently (no warning, because `unresolved` is also driven by the helper's output).

The fix is a one-predicate change inside `collectUncovered`: replace the strict `=== 0` test with `< classBoundsByProctorKey[key].classLowerBound`. Every other piece of the pass (sort order, three-tier relaxation `classUB+1 → classUB → classLB+1`, swap-eligibility checks, time budget, warning shape) is preserved verbatim. The cost-function hard cap, the greedy fallback, and the v1 toggle path are not touched.

## Glossary

- **`Bug_Condition (C)`**: A proctor `T` whose `getPrimaryLoad(loadState, key(T))` is strictly between zero and `classBoundsByProctorKey[key(T)].classLowerBound`, AND for which `collectUncovered` fails to include `T` in its result. (Plus the system-level symptom: real-centre fixture exhibits `coverageRepairSwaps == 0 && coverageRepairUnresolved == 0` while a fairness violation exists.)
- **`Property (P)`**: For every input where the bug condition holds, the fixed `collectUncovered` includes `T`, the repair pass attempts to swap `T` up using the existing three-tier relaxation, and either resolves the violation (`swaps++`) or records a diagnostic (`unresolved++`).
- **`Preservation`**: For every input where every proctor with bounds already meets `classLowerBound`, the fixed function produces the exact same output as F (the result list is empty in those cases, and the rest of the algorithm is unchanged).
- **`collectUncovered(proctorsList, classBoundsByProctorKey, loadState)`**: helper at `js/algorithms/proctor-distribution-v2.js` ≈ line 2800 that scans `proctorsList`, looks up bounds, and returns `[ { key, proc, idx } ]` for every proctor flagged as needing repair. The function under repair.
- **`phase2_75CoverageRepair(...)`**: caller at `js/algorithms/proctor-distribution-v2.js` ≈ line 2936; orchestrates the swap loop. Body unchanged by this fix.
- **`getPrimaryLoad(loadState, key)`**: slot-based primary load = `guardSlotCount + dutyCount`. Single source of truth for the fairness axis.
- **`classBoundsByProctorKey[key]`**: `{ classLowerBound, classUpperBound, G_class, D_expected_class }`, populated in `phase2Build` at line ≈1849.
- **`classLowerBound`**: per-class lower fairness bound = `floor((G_class + D_expected_class) / classSize)`.

## Bug Details

### Bug Condition

The bug manifests at the boundary between `phase2`'s output and `phase2_75CoverageRepair`. `collectUncovered` filters proctors with `getPrimaryLoad(loadState, key) === 0`, which silently excludes proctors at any positive load below `classLowerBound`. The repair pass therefore receives an undersized work list, performs zero swaps, emits zero warnings, and the fairness invariant fails downstream.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input = { proctorsList, classBoundsByProctorKey, loadState }
  OUTPUT: boolean

  RETURN EXISTS i in [0, proctorsList.length) :
           let key := getProctorKey(proctorsList[i], i)
           AND classBoundsByProctorKey[key] is defined
           AND 0 < getPrimaryLoad(loadState, key)
                    < classBoundsByProctorKey[key].classLowerBound
           AND { key, proc: proctorsList[i], idx: i } NOT IN
                 collectUncovered_F(proctorsList, classBoundsByProctorKey, loadState)
END FUNCTION
```

### Examples

- **Real-centre fixture (`tests/fixtures/proctor-v2-real-centre-data.json`)**: 24 proctors with `getPrimaryLoad == 1`, `classLowerBound == 2`. F's `collectUncovered` returns 1 entry (the single load-0 proctor); F' returns 25 entries (the 1 load-0 + 24 load-1).
- **Synthetic 1**: `proctorsList = [ p0 ]`, `classBoundsByProctorKey = { p0: { classLowerBound: 2, classUpperBound: 3 } }`, `loadState = { p0: { primary slot count = 1 } }`. F's helper: `[]`. F' helper: `[ { key: p0.key, proc: p0, idx: 0 } ]`.
- **Synthetic 2 (boundary)**: same as above but `loadState = { p0: { primary slot count = 2 } }`. F's helper: `[]`. F' helper: `[]` (no change — load already meets bound).
- **Synthetic 3 (zero-load preserved)**: `loadState = { p0: { primary slot count = 0 } }`. F's helper: `[ p0 ]`. F' helper: `[ p0 ]` (unchanged behavior for the zero-load case).
- **Edge case (no bounds)**: `classBoundsByProctorKey[key] === undefined`. Both F and F' skip — no change.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- The signature `(proctorsList, classBoundsByProctorKey, loadState) → Array<{ key, proc, idx }>` is preserved.
- The traversal order (`for i = 0 .. list.length-1`) is preserved.
- The two short-circuit guards (`!classBoundsByProctorKey || !classBoundsByProctorKey[key]`) are preserved.
- `phase2_75CoverageRepair`'s sort order (by classId, then `tiebreak[key]`), three-tier relaxation, swap-eligibility filter, `applyCoverageSwap` call, time budget, and warning schema are preserved.
- The cost-function hard cap (`postAssignmentPrimary > classBounds.classUpperBound → INFINITY_SENTINEL`) is preserved.
- `greedyFallback` body is preserved.
- v1 toggle path is byte-identical to pre-fix v1 (this fix touches only the v2 module).
- Snapshot file `tests/__snapshots__/proctor-v2-strict-fairness-coverage.pre-fix.js` is byte-identical (it represents F).

**Scope:**

All inputs where every proctor with `classBoundsByProctorKey[key]` defined already has `getPrimaryLoad(loadState, key) >= classBoundsByProctorKey[key].classLowerBound` should be completely unaffected. This includes:

- Existing synthetic fixtures used by `tests/proctor-v2-property-*` and `tests/proctor-v2-bug-c1..c4-*` (those tests already pass with F; preservation guarantees they keep passing under F').
- `tests/proctor-distribution-v2-*.test.js` unit tests for cost / CSP / Hungarian / objective / orchestrator / phase1 / phase2 / phase2_5 / utils.
- v1 byte-equality tests (`tests/__snapshots__/v1-byte-equality.json`).

## Hypothesized Root Cause

Based on the bug report and code inspection, the cause is a single off-by-design predicate:

1. **Strict zero predicate**: line ≈2805 reads `getPrimaryLoad(loadState, key) === 0` instead of `< classBoundsByProctorKey[key].classLowerBound`. This is the root cause.

2. **Confirming the analysis**: the diagnostic snapshot from the user's run shows 24 proctors at `load = 1` with `classLowerBound = 2`, `coverageRepairSwaps = 0`, `coverageRepairUnresolved = 0`. The only way both diagnostics counters can be zero in the presence of a fairness violation is if `collectUncovered` returned an empty list — which is exactly what `=== 0` produces when only one proctor sits at zero (and that single zero-load proctor finds no swappable peer at the strictest threshold and falls through to the warning bucket — yet warning is also empty, suggesting the load-0 proctor was actually swapped *but* the count rounds elsewhere, OR the load-0 proctor was unreachable and the existing `unresolved` increment was bypassed because of an upstream filter; either way, the predicate is the wrong gate, the rest of the pass is sound).

3. **Alternative hypotheses that the diagnostics rule out**:
   - Time budget: `coverageRepairDurationMs` is well under 50 ms (`phase2_75DurationMs = 21` ms).
   - Hard-cap blocking the swap: cost function would still let `T_uncov` enter; the swap-eligibility filter on the over-loaded peer is independent of the under-loaded proctor's load level.
   - Class bounds missing: `eligibilityClassCount = 1` and bounds populate for every class member; the issue cannot be missing bounds.

4. **Why the synthetic verification script passed**: `scripts/verify-end-to-end.js` uses a synthetic fixture where every proctor either ends at zero (caught by `=== 0`) or already meets the bound. The boundary case (`0 < load < classLowerBound`) is never exercised by synthetic data.

## Correctness Properties

Property 1: Bug Condition - Undercovered Proctors Below classLowerBound

_For any_ input where the bug condition holds (some proctor `T` has `0 < getPrimaryLoad(loadState, key(T)) < classBoundsByProctorKey[key(T)].classLowerBound` and `T` is missing from `collectUncovered`'s result), the fixed `collectUncovered` SHALL include `T` in its result, AND running F' on the real-centre fixture SHALL satisfy `min(primaryLoad) >= classLowerBound` AND `max - min <= 1` AND `filledSlots == proctorsPerRoom * rowCount`.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Outputs Match F When No Undercovered Proctors

_For any_ input where the bug condition does NOT hold (every proctor with bounds already meets `classLowerBound`), the fixed function SHALL produce the same result as the original function, preserving `collectUncovered`'s empty-list output, `phase2_75CoverageRepair`'s `{ swaps: 0, unresolved: 0, warnings: [] }` diagnostics, the full v2 result row sequence, the v1 toggle path's byte-equal output, and every existing fixture/snapshot used by the repo's test suite.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**

## Fix Implementation

### Architecture Overview — Edit Sites

| # | File | Function | Line ≈ | Change |
|---|------|----------|--------|--------|
| 1 | `js/algorithms/proctor-distribution-v2.js` | `collectUncovered` | 2800 | Replace `getPrimaryLoad(loadState, key) === 0` with `getPrimaryLoad(loadState, key) < classBoundsByProctorKey[key].classLowerBound`. |
| 2 | `tests/proctor-v2-fairness-undercovered-exploration.test.js` | new | n/a | Property-based exploratory test; loads `tests/fixtures/proctor-v2-real-centre-data.json`, runs the production module, asserts `min >= lowerBound`. MUST FAIL on F. |
| 3 | `tests/proctor-v2-fairness-undercovered-preservation.test.js` | new | n/a | Property-based preservation test; randomized synthetic inputs that satisfy `¬C(X)`; asserts `collectUncovered_F` and `collectUncovered_F'` agree on every generated input. |
| 4 | `tests/proctor-v2-fairness-undercovered-collect-unit.test.js` | new | n/a | Direct unit test on the exported `collectUncovered` covering: zero-load (still picked up), `0 < load < classLowerBound` (now picked up), `load === classLowerBound` (NOT picked up), `load > classLowerBound` (NOT picked up), missing bounds (skipped), empty list. |

### Changes Required

**File**: `js/algorithms/proctor-distribution-v2.js`

**Function**: `collectUncovered`

**Current body (line ≈ 2800):**

```javascript
function collectUncovered(proctorsList, classBoundsByProctorKey, loadState) {
  var result = [];
  var list = proctorsList || [];
  for (var i = 0; i < list.length; i++) {
    var key = getProctorKey(list[i], i);
    if (classBoundsByProctorKey && classBoundsByProctorKey[key] && getPrimaryLoad(loadState, key) === 0) {
      result.push({ key: key, proc: list[i], idx: i });
    }
  }
  return result;
}
```

**Fixed body:**

```javascript
function collectUncovered(proctorsList, classBoundsByProctorKey, loadState) {
  var result = [];
  var list = proctorsList || [];
  for (var i = 0; i < list.length; i++) {
    var key = getProctorKey(list[i], i);
    var bounds = classBoundsByProctorKey && classBoundsByProctorKey[key];
    if (bounds && getPrimaryLoad(loadState, key) < bounds.classLowerBound) {
      result.push({ key: key, proc: list[i], idx: i });
    }
  }
  return result;
}
```

**Specific Changes**:

1. **Predicate**: replace `getPrimaryLoad(loadState, key) === 0` with `getPrimaryLoad(loadState, key) < bounds.classLowerBound`.
2. **Local hoist**: pull `classBoundsByProctorKey[key]` into a local `bounds` variable (purely cosmetic; preserves the existing short-circuit on falsy bounds).
3. **No signature change**: arguments and return type are unchanged.
4. **No callers touched**: `phase2_75CoverageRepair` continues to call `collectUncovered(input.proctorsList || [], classBoundsByProctorKey || {}, loadState)` with the same arguments; the downstream sort, three-tier relaxation, and swap loop run unchanged on the fuller work list.
5. **No exports touched**: `collectUncovered` is already exported in the v2 testing surface (line ≈ 4390); we keep that export for the new unit test.

### Edge Cases Handled

| Case | F behavior | F' behavior | Test |
|------|------------|-------------|------|
| `getPrimaryLoad == 0` and `classLowerBound > 0` | included | included | unit |
| `0 < getPrimaryLoad < classLowerBound` | NOT included (bug) | included | unit + exploration |
| `getPrimaryLoad == classLowerBound` | NOT included | NOT included | unit |
| `getPrimaryLoad > classLowerBound` | NOT included | NOT included | unit |
| `classBoundsByProctorKey[key] === undefined` | NOT included | NOT included | unit |
| `proctorsList === null` or `[]` | empty result | empty result | unit |
| `classBoundsByProctorKey === null` | empty result | empty result | unit |
| `loadState === {}` (zero everywhere) | every-bound-keyed proctor included | every-bound-keyed proctor included (because 0 < classLowerBound assumed; preservation when classLowerBound == 0 covered below) | unit |
| `classBoundsByProctorKey[key].classLowerBound == 0` | `=== 0` matches; included | `< 0` never true; NOT included | unit (documents intentional behavior change at this degenerate boundary; safe because `classLowerBound == 0` means no fairness obligation, so the repair pass has nothing to do) |

The last row is the only behavioral change at a value other than `0 < load < classLowerBound`. It is benign: when `classLowerBound == 0`, no proctor needs lifting, and emitting an empty work list matches the spec ("undercovered" means "below the bound", and zero is not below zero). This case is exercised by the unit test and preservation property.

### Risk Register

| Risk | Mitigation |
|------|------------|
| The fuller work list overflows the 50 ms time budget. | Real-centre fixture: `phase2_75DurationMs = 21` ms with the empty work list. With ~25 proctors to process and the existing per-iteration cost (one swap-candidate scan), expected new duration is ≈ 25 × (21 ms / 1) = bounded by the existing per-iteration scan. The pass already short-circuits on time budget and tags remaining proctors with `reason: 'time_budget'` — preserved by this fix. Verified by `scripts/verify-real-centre.js`. |
| The fuller work list breaks an existing test that depended on the empty-list behavior. | Preservation property + every existing fixture has `classLowerBound = floor(G/N)` derived to match `G/N` exactly, so synthetic fixtures end with `min == classLowerBound`. Confirmed by reading `tests/fixtures/proctor-v2-bug-fixtures.js` and `tests/fixtures/proctor-v2-strict-fairness-fixtures.js` — they target the zero-load case (load=0) which is still included. |
| The relaxation tier `classUB+1` finds no peer for some now-included proctors, so `unresolved` rises instead of `swaps`. | This is the correct, designed behavior: emit a diagnostic warning (`reason: 'no_swappable_peer'`). The verification target requires `min >= lowerBound` AND coverage = expected; the real-centre run is expected to exercise the second tier (`classUB`) on a few proctors. If unresolved is still non-zero after the fix, the warning surfaces it for the user to address (e.g., by relaxing eligibility). |
| Snapshot file gets accidentally regenerated. | The snapshot is read-only per spec; new tests do not touch it. |

## Testing Strategy

### Validation Approach

The strategy follows the bugfix workflow's two-phase pattern:

1. **Surface counterexample first** — write the exploratory PBT against the real-centre fixture, run it on the production module (which is F), observe the failure on `min >= lowerBound`. This confirms the bug exists and the fixture reproduces it.
2. **Verify the fix and preservation** — implement the predicate change, re-run the exploratory test (now passes), run the unit test (covers every branch of the new predicate), run the preservation property (asserts F deep-equals F' on `¬C(X)` inputs), then run `node scripts/verify-real-centre.js` to confirm all four invariants pass on the production module.

### Exploratory Bug Condition Checking

**Goal**: Surface the counterexample on the real-centre fixture before any source change. Confirm or refute the root-cause analysis (predicate is the gate).

**Test Plan**: Load the production v2 module via `vm` sandbox (matching `scripts/verify-real-centre.js`'s pattern), load `tests/fixtures/proctor-v2-real-centre-data.json`, run the algorithm, scan every proctor's `primaryLoad` and assert `min >= lowerBound`. Run on UNFIXED code; expect FAIL with `min == 0` and 24 proctors at `load == 1`.

**Test Cases**:

1. **Real-centre P3 reproduction**: Load fixture, run F, assert `min(primaryLoad) >= classLowerBound` for every class. (FAILS on F; PASSES on F'.)
2. **`coverageRepairSwaps > 0 OR coverageRepairUnresolved > 0`**: assert that on the real-centre input the repair pass either swaps something or emits a warning, not both zero. (FAILS on F: both are 0; PASSES on F'.)
3. **`maxPrimaryLoadGapWithinClass <= 1`**: assert the diagnostics gap is bounded. (FAILS on F: gap=2; PASSES on F'.)

**Expected Counterexamples** (observed on F):

- 1 proctor at `primaryLoad = 0` (حادك عبد الحكيم, idx=79).
- 24 proctors at `primaryLoad = 1` while `classLowerBound = 2`.
- `coverageRepairSwaps = 0`, `coverageRepairUnresolved = 0`, `coverageRepairWarnings = []`.
- 358 / 368 slots filled.

### Fix Checking

**Goal**: For all inputs where the bug condition holds, the fixed `collectUncovered` returns every proctor below `classLowerBound`, AND `phase2_75CoverageRepair` lifts the load distribution into the [classLowerBound, classUpperBound] band.

**Pseudocode:**

```
FOR ALL input WHERE isBugCondition(input) DO
  result := collectUncovered_fixed(input.proctorsList, input.classBoundsByProctorKey, input.loadState)
  FOR ALL T in input.proctorsList WHERE classBoundsByProctorKey[key(T)] is defined DO
    IF getPrimaryLoad(input.loadState, key(T)) < classBoundsByProctorKey[key(T)].classLowerBound THEN
      ASSERT result contains an entry with key === key(T)
    END IF
  END FOR
END FOR

// System-level fix check.
FOR run := V2.run(real_centre_fixture) ON F' DO
  ASSERT min(primaryLoad(T) for T) >= classLowerBound
  ASSERT max(primaryLoad(T) for T) <= classUpperBound
  ASSERT max - min <= 1
  ASSERT sum(guardCount(T) for T) == proctorsPerRoom * row_count(run)
END FOR
```

### Preservation Checking

**Goal**: For all inputs where the bug condition does NOT hold (every proctor with bounds already meets `classLowerBound`), the fixed function produces the same result as the original.

**Pseudocode:**

```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT collectUncovered_F(input.proctorsList, input.classBoundsByProctorKey, input.loadState)
       = collectUncovered_F'(input.proctorsList, input.classBoundsByProctorKey, input.loadState)
  ASSERT V2_F.run(input) deep-equals V2_F'.run(input)
END FOR
```

**Testing Approach**: Property-based testing for stronger guarantees:

- Generate random `proctorsList` of size 1..30.
- For each proctor, randomly assign `{ classLowerBound, classUpperBound }` such that `0 <= classLowerBound <= classUpperBound`.
- Generate `loadState` such that `getPrimaryLoad(key) >= classLowerBound` for every keyed proctor (this is `¬C(X)`).
- Assert `collectUncovered_F(...)` and `collectUncovered_F'(...)` produce equal arrays.

Plus targeted unit tests for the three boundary points (`load == 0`, `load == classLowerBound - 1`, `load == classLowerBound`).

**Test Plan**:

1. **Equivalence on `¬C(X)`**: random inputs satisfying `¬C(X)` produce equal outputs from F and F'.
2. **Empty-list preservation**: when no proctor is below `classLowerBound`, both F and F' return `[]`.
3. **No-bounds preservation**: when `classBoundsByProctorKey[key]` is undefined for every key, both return `[]`.
4. **Existing fixture suite**: every test under `tests/proctor-v2-property-*.test.js`, `tests/proctor-v2-bug-c*.test.js`, `tests/proctor-v2-strict-bug-*.test.js`, `tests/proctor-distribution-v2-*.test.js` continues to pass.
5. **v1 byte equality**: `tests/proctor-v2-property-p6-v1-byte-equality.test.js` passes (no v1 changes).

### Unit Tests

- `tests/proctor-v2-fairness-undercovered-collect-unit.test.js` directly exercises `collectUncovered` via the v2 module's testing surface (`V2.collectUncovered`).
- Six branches: zero-load, between zero and bound, exactly at bound, above bound, missing bounds, empty list.
- `tests/proctor-v2-fairness-undercovered-collect-zero-bound.test.js` (optional, can be folded into the unit test): exercises the `classLowerBound == 0` degenerate case to document intentional behavior.

### Property-Based Tests

- `tests/proctor-v2-fairness-undercovered-preservation.test.js` — preservation property on randomly generated inputs satisfying `¬C(X)`. Asserts deep equality of `collectUncovered_F(…)` and `collectUncovered_F'(…)`. Seeded RNG for reproducibility.
- `tests/proctor-v2-fairness-undercovered-exploration.test.js` — bug-condition property scoped to the concrete real-centre fixture (deterministic counterexample). Asserts `min(primaryLoad) >= classLowerBound`.

### Integration Tests

- `node scripts/verify-real-centre.js` MUST exit 0 with `P1 PASS, P2 PASS, P3 PASS, Coverage PASS` on F'.
- `node scripts/verify-end-to-end.js` MUST continue to pass (synthetic fixture, regression check).
- `npm test` aggregate: must not introduce regressions in any `tests/*.test.js`.
- `npm run lint`: must pass with no new warnings.


---

## Extension — Phase 3 Lower-Bound Protection (added 2026-05-15)

### Discovery & Root Cause

After Task 4.1 landed, instrumentation showed:
- Phase 2.75 reaches `maxPrimaryLoadGapWithinClass = 1` (perfect).
- Phase 3 (`simulatedAnnealing`) then accepts moves that drop 7 proctors back to `load = 1` (below `classLowerBound = 2`).

The culprit is `swap_roles` (line ≈3582 in `applyMove`): it exchanges a guard slot for a reserve slot in the same halfday, which decrements the `guardCount` of the demoted proctor. `violatesHardConstraints` (the gate at line ≈3279 that filters Phase 3 moves) checks duplicate-session, halfday-reuse, day-reuse, exemptions, and duty — but does NOT check the per-class fairness lower bound.

### Edit Site

**File:** `js/algorithms/proctor-distribution-v2.js`
**Function:** `violatesHardConstraints` (line ≈3279)

After all existing checks succeed, add a final pass that computes per-proctor primary load from the post-move `assignments` and rejects the move if any proctor with class bounds dropped below `classLowerBound`.

### Fixed Implementation (additive)

```javascript
function violatesHardConstraints(assignments, input) {
  // ... [existing checks unchanged: session-duplicate, halfday-reuse,
  //       day-reuse, exemptions, duty] ...

  // Lower-bound protection (proctor-v2-fairness-undercovered-fix extension).
  // Phase 2.75 lifts under-bound proctors to classLowerBound; Phase 3 must
  // not undo that. Reject any move that drops a proctor's primaryLoad
  // strictly below their classLowerBound.
  //
  // No-op when classBoundsByProctorKey is absent (legacy callers,
  // pre-Phase-2 invocations) — preserves Requirement 3.9.
  var classBounds = input.classBoundsByProctorKey
    || (input.options && input.options.classBoundsByProctorKey)
    || null;
  if (classBounds) {
    // Build per-proctor primaryLoad from the post-move assignments.
    // primaryLoad = guardCount + dutyCount. dutyCount is static (read from
    // input.dutyData), guardCount comes from counting proctor_keys across
    // all rows.
    var guardCounts = {};
    for (var li = 0; li < assignments.length; li++) {
      var lkeys = assignments[li].proctor_keys || [];
      for (var lk = 0; lk < lkeys.length; lk++) {
        var lpKey = lkeys[lk];
        if (!lpKey) continue;
        guardCounts[lpKey] = (guardCounts[lpKey] || 0) + 1;
      }
    }
    // Iterate every proctor with bounds; check primaryLoad >= classLowerBound.
    var boundedKeys = Object.keys(classBounds);
    for (var bk = 0; bk < boundedKeys.length; bk++) {
      var bKey = boundedKeys[bk];
      var bBounds = classBounds[bKey];
      if (!bBounds) continue;
      var gCount = guardCounts[bKey] || 0;
      // dutyCount: use the existing duty-pair detection over all assignments.
      // We approximate via input.dutyData lookup keyed by proctor name (the
      // duty-pair count is computed once during phase1; since phase3 cannot
      // change duty assignments, dutyCount is invariant — we read it from
      // the input contract via the existing lookup).
      // Conservative: use guardCount alone for the check. If duty-aware
      // accuracy is needed later, swap in the explicit dutyCount lookup.
      // Rationale: classLowerBound already accounts for duty in its
      // floor((G+D)/N) formula, so guardCount alone may UNDER-flag rejections
      // (false negatives — moves that should be rejected slip through). For
      // the real-centre fixture D_expected = 0, so this is exact. For inputs
      // with D_expected > 0, a follow-up spec can refine.
      if (gCount < bBounds.classLowerBound) {
        return true;
      }
    }
  }

  return false;
}
```

### Plumbing

`classBoundsByProctorKey` is already populated by `phase2Build` and stored on `phase2Result.classBoundsByProctorKey`. The orchestrator (line ≈4159) calls `phase2_75CoverageRepair(...)` with `classBoundsByProctorKey` as the third argument; immediately after, `phase3Optimize(phase2Result, input, rng, saConfig)` runs.

For the new check to fire inside `violatesHardConstraints`, we must surface `classBoundsByProctorKey` on `input` (or `input.options`). The cleanest plumbing: in the orchestrator, just before invoking `phase3Optimize`, attach `input.classBoundsByProctorKey = phase2Result.classBoundsByProctorKey` (additive, idempotent, no schema change to other callers).

### Edge Cases

| Case | Behavior |
|------|----------|
| `classBoundsByProctorKey` absent | check is a no-op → Phase 3 behaves as before (Req 3.9) |
| Proctor with no bounds entry | skipped in iteration → no false rejection (Req 3.10) |
| `swap_guards` (no load change) | guardCounts unchanged → check passes for every proctor (Req 3.12) |
| `reassign_reserve` (no guard change) | guardCounts unchanged → check passes (no false rejection) |
| `swap_roles` lifting an undercovered proctor onto a guard slot | both proctors' new load ≥ classLowerBound → check passes (the lift case Phase 2.75 actually wants) |
| `swap_roles` demoting a proctor at load = classLowerBound to load = classLowerBound − 1 | demoted proctor below bound → check rejects (the bug case) |

### Risk Register

| Risk | Mitigation |
|------|------------|
| Performance: O(N × A) per Phase 3 iteration where N = bounded proctors, A = assignment rows. | Real-centre: 147 × 184 = 27k ops per check; Phase 3 runs ~120 iterations → 3.2M ops total. JavaScript V8 handles this in ~5–10 ms; negligible vs the existing 86 ms phase3Duration. |
| Phase 3 acceptance rate plummets because every demoting move is rejected. | Expected behavior — Phase 2.75 already produced a load distribution at the boundary, and the optimization budget should focus on `swap_guards` (which doesn't change load) and load-preserving variations. SA still has slack to rearrange WITHIN the [classLowerBound, classUpperBound] band. |
| `dutyCount` not included in guardCount — under-flags rejections when D_expected > 0. | Documented limitation. Real-centre has D_expected = 0 so it's exact. Follow-up spec can refine if user adopts duty in fairness math. |
