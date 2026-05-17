# Bugfix Requirements Document — Proctor v2 Fairness Undercovered Fix

## Introduction

The `phase2_75CoverageRepair` pass added by spec `proctor-v2-strict-fairness-coverage` is supposed to lift under-loaded proctors up to the per-class fairness lower bound by swapping them in for over-loaded peers. On the user's real centre data (147 proctors, 30 sessions, 184 room tasks, 368 expected guard slots, lowerBound=2, upperBound=3) the pass executes but performs **zero** swaps, leaving the fairness invariant violated and 25 proctors below `lowerBound`.

### Confirmed Symptom (Counterexample)

Running `node scripts/verify-real-centre.js` against `tests/fixtures/proctor-v2-real-centre-data.json` reports:

- `lowerBound = 2`, `upperBound = 3`
- `eligibilityClassCount = 1`
- `coverageRepairSwaps = 0` ← bug
- `coverageRepairUnresolved = 0` ← bug (no warning)
- `coverageRepairWarnings = []`
- `maxPrimaryLoadGapWithinClass = 2` (must be ≤ 1 per fairness invariant)

Resulting load distribution (147 proctors, 368 expected slots):

| `primaryLoad` | proctor count |
|---|---|
| 0 | 1 |
| 1 | 24 |
| 2 | 32 |
| 3 | 90 |

`min = 0`, `max = 3`, `max − min = 3`, total filled = 358 / 368 (10 unfilled). P1 (`max − min ≤ 1`), P3 (`min ≥ lowerBound`), and Coverage all FAIL.

### Root Cause

In `js/algorithms/proctor-distribution-v2.js`, function `collectUncovered(proctorsList, classBoundsByProctorKey, loadState)` filters with `getPrimaryLoad(loadState, key) === 0`. This misses the 24 proctors at `load = 1` who are still below the per-class `classLowerBound = 2`. The pass never targets them, so it has nothing to lift, returns zero swaps, and emits no warning.

The C2 contract in the prior spec's design.md §3.4 says "lift uncovered eligible proctors onto guard slots from over-loaded peers" — "uncovered" must mean **below `classLowerBound`**, not strictly zero.

### Glossary

- **F:** the v2 algorithm as it ships today (after `proctor-v2-strict-fairness-coverage`). **F':** the v2 algorithm after this fix.
- **`getPrimaryLoad(loadState, key)`:** slot-based primary load = `guardSlotCount + dutyCount` (post slot-metric switch). Single source of truth for the fairness axis.
- **`classBoundsByProctorKey[key]`:** populated in `phase2Build` at line ≈1849; carries `{ classLowerBound, classUpperBound, G_class, D_expected_class }` per proctor key.
- **`classLowerBound`:** the per-class lower fairness bound = `floor((G_class + D_expected_class) / classSize)`. For the user's case = 2.
- **Undercovered proctor:** a proctor whose `getPrimaryLoad(loadState, key) < classBoundsByProctorKey[key].classLowerBound`. Includes (but is not limited to) zero-load proctors.
- **`primaryLoad(T)`:** `guardCount(T) + dutyCount(T)`. The fairness axis.

### Bug Condition C(X)

```pascal
FUNCTION isBugCondition(X)
  INPUT:  X = { proctorsList, classBoundsByProctorKey, loadState, output }
  OUTPUT: boolean

  // C1 — collectUncovered misses proctors below classLowerBound but above 0.
  C1 ← EXISTS proctor T in proctorsList :
         classBoundsByProctorKey[key(T)] is defined
         AND 0 < getPrimaryLoad(loadState, key(T))
                  < classBoundsByProctorKey[key(T)].classLowerBound
         AND collectUncovered(proctorsList, classBoundsByProctorKey, loadState)
             does NOT contain { key: key(T), proc: T, idx: ... }

  // C2 — On real-centre fixture, phase2_75 reports zero swaps and zero
  //      unresolved, yet at least one proctor remains below classLowerBound.
  C2 ← (output.diagnostics.coverageRepairSwaps == 0
         AND output.diagnostics.coverageRepairUnresolved == 0)
        AND EXISTS proctor T in proctorsList :
              getPrimaryLoad(loadState, key(T))
                < classBoundsByProctorKey[key(T)].classLowerBound

  RETURN C1 OR C2
END FUNCTION
```

The fix is correct iff `NOT isBugCondition(X)` for every output X produced by F'.

### Correctness Properties

```pascal
// P1 — Fix Checking. collectUncovered returns every proctor below classLowerBound.
FOR ALL proctorsList, classBoundsByProctorKey, loadState DO
  uncov := collectUncovered(proctorsList, classBoundsByProctorKey, loadState)
  FOR ALL T in proctorsList WHERE classBoundsByProctorKey[key(T)] is defined DO
    IF getPrimaryLoad(loadState, key(T)) < classBoundsByProctorKey[key(T)].classLowerBound THEN
      ASSERT uncov contains an entry with key === key(T)
    END IF
    IF getPrimaryLoad(loadState, key(T)) >= classBoundsByProctorKey[key(T)].classLowerBound THEN
      ASSERT uncov does NOT contain an entry with key === key(T)
    END IF
  END FOR
END FOR

// P2 — Real-centre verification. After running F' on the real-centre fixture,
//      verify-real-centre.js reports P1, P2, P3, Coverage all PASS.
FOR ALL X = run(real_centre_fixture) ON F' DO
  ASSERT max(primaryLoad(T) for T in proctorsList)
       - min(primaryLoad(T) for T in proctorsList) <= 1
  ASSERT max(primaryLoad(T) for T in proctorsList)
         <= classBoundsByProctorKey[*].classUpperBound
  ASSERT min(primaryLoad(T) for T in proctorsList)
         >= classBoundsByProctorKey[*].classLowerBound
  ASSERT sum(guardCount(T) for T) == proctorsPerRoom * row_count(X)
END FOR

// P3 — Preservation. For inputs where every proctor with bounds already meets
//      classLowerBound, the fixed function produces the exact same output as F.
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) deep-equals F'(X)
END FOR
```

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a proctor `T` has `0 < getPrimaryLoad(loadState, key(T)) < classBoundsByProctorKey[key(T)].classLowerBound` THEN `collectUncovered` does NOT include `T` in its result.

1.2 WHEN `phase2_75CoverageRepair` runs against the real-centre fixture (147 proctors, 368 expected slots, lowerBound=2) THEN it returns `{ swaps: 0, unresolved: 0, warnings: [] }` even though 24 proctors sit at `primaryLoad = 1` below the lower bound.

1.3 WHEN running `node scripts/verify-real-centre.js` on F THEN it reports P1=FAIL (gap=3), P3=FAIL (min=0), Coverage=FAIL (358/368), exits with non-zero status.

### Expected Behavior (Correct)

2.1 WHEN a proctor `T` has `getPrimaryLoad(loadState, key(T)) < classBoundsByProctorKey[key(T)].classLowerBound` (whether `T`'s primary load is 0 or any positive value below the bound) THEN `collectUncovered` SHALL include `T` in its result.

2.2 WHEN `phase2_75CoverageRepair` runs against the real-centre fixture THEN it SHALL either swap the under-loaded proctors up to `classLowerBound` (incrementing `coverageRepairSwaps`) or, if no peer swap is feasible under the three-tier relaxation thresholds (`classUB+1`, `classUB`, `classLB+1`), emit a diagnostic warning per remaining undercovered proctor (incrementing `coverageRepairUnresolved`).

2.3 WHEN running `node scripts/verify-real-centre.js` on F' THEN it SHALL report P1=PASS, P2=PASS, P3=PASS, Coverage=PASS, and exit with status 0.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN every proctor with `classBoundsByProctorKey[key]` defined already has `getPrimaryLoad(loadState, key) >= classLowerBound` THEN the fixed `collectUncovered` SHALL CONTINUE TO return an empty array, and `phase2_75CoverageRepair` SHALL CONTINUE TO emit `{ swaps: 0, unresolved: 0, warnings: [] }`.

3.2 WHEN a proctor `T` has `classBoundsByProctorKey[key(T)]` undefined (no class bounds) THEN the fixed `collectUncovered` SHALL CONTINUE TO skip `T` (same as F).

3.3 WHEN running the v2 algorithm against any pre-existing fixture in `tests/fixtures/` (synthetic numbering, c1 fairness, c2 duty, c3 fixed/percent, c4 plumbing, slot-metric, strict-fairness pre-fix snapshot fixtures) THEN every existing test in `tests/*.test.js` SHALL CONTINUE TO pass with no source change beyond the `collectUncovered` predicate.

3.4 WHEN the v1 toggle path is exercised (legacy algorithm) THEN its output SHALL CONTINUE TO be byte-identical to pre-fix v1; this fix is confined to the v2 module.

3.5 WHEN `phase2_75CoverageRepair`'s 50 ms time budget elapses THEN the fixed pass SHALL CONTINUE TO short-circuit and tag remaining undercovered proctors with `reason: 'time_budget'` (same behavior as F).

3.6 WHEN the cost function evaluates a candidate assignment THEN the slot-based hard cap (`postAssignmentPrimary > classBounds.classUpperBound → INFINITY_SENTINEL`) SHALL CONTINUE TO behave exactly as before; the fix touches only `collectUncovered`'s predicate, not the cost function.

3.7 WHEN `greedyFallback` is invoked THEN its body SHALL CONTINUE TO be unchanged.

3.8 WHEN the test suite runs against the snapshot file `tests/__snapshots__/proctor-v2-strict-fairness-coverage.pre-fix.js` THEN that snapshot SHALL CONTINUE TO be byte-identical (the snapshot represents F, the pre-fix code).

---

## Extension — Phase 3 Lower-Bound Protection (added 2026-05-15)

### Discovery

After Task 4.1 landed (predicate fix + fixed-point loop in `phase2_75CoverageRepair`), real-centre verification still reported `P3 FAIL` with 7 proctors stuck at `load=1`. Instrumented trace shows:

- Phase 2.75 successfully lifts every under-bound proctor; convergence reached in 2 rounds with 21 swaps; `maxPrimaryLoadGapWithinClass = 1` immediately after Phase 2.75 finishes.
- **Phase 3 (Simulated Annealing) then accepts moves that drop proctors back below `classLowerBound`.** Specifically, `swap_roles` moves (which exchange a guard slot for a reserve slot in the same halfday) reduce `guardCount` for the demoted proctor with no symmetric guard against dropping below `classLowerBound`.
- The cost function's hard cap (`postAssignmentPrimary > classUpperBound → INFINITY_SENTINEL`) only protects the upper bound; there is no equivalent lower-bound protection in `violatesHardConstraints` (the gate that filters Phase 3 moves).

### Bug Condition C3 (Phase 3 violates lowerBound)

```pascal
FUNCTION isPhase3LowerBoundViolation(X)
  INPUT:  X = post-Phase-3 assignments + classBoundsByProctorKey + loadState
  OUTPUT: boolean

  RETURN EXISTS proctor T in proctorsList :
           classBoundsByProctorKey[key(T)] is defined
           AND post-Phase-2.75 primaryLoad(T) >= classBoundsByProctorKey[key(T)].classLowerBound
           AND post-Phase-3 primaryLoad(T) < classBoundsByProctorKey[key(T)].classLowerBound
END FUNCTION
```

### Property P4 (Phase 3 preserves lower bound)

```pascal
// P4 — Phase 3 must not push any proctor below classLowerBound.
FOR ALL X = run(input) ON F' DO
  FOR ALL T in proctorsList WHERE classBoundsByProctorKey[key(T)] is defined DO
    ASSERT post-Phase-3 primaryLoad(T) >= classBoundsByProctorKey[key(T)].classLowerBound
  END FOR
END FOR
```

### Expected Behavior — Phase 3 Lower-Bound Protection

2.4 WHEN Phase 3 generates a move (`swap_guards`, `swap_roles`, or `reassign_reserve`) THEN `violatesHardConstraints` SHALL reject the move if applying it would drop any proctor's `getPrimaryLoad` strictly below their `classLowerBound`.

2.5 WHEN running `node scripts/verify-real-centre.js` on F'' (post-extension) THEN it SHALL report ALL FOUR `P1, P2, P3, Coverage` as PASS, with `min >= lowerBound` preserved through Phase 3.

### Unchanged Behavior — Phase 3 Extension

3.9 WHEN `classBoundsByProctorKey` is absent (legacy callers that bypass `phase2Build`) THEN the new lower-bound check SHALL be a no-op — every move passes the new check unchanged.

3.10 WHEN a proctor's `getPrimaryLoad` is already `>= classLowerBound` and a move keeps it at-or-above the bound THEN `violatesHardConstraints` SHALL CONTINUE TO behave exactly as before.

3.11 WHEN Phase 3 is skipped entirely (`config.enablePhase3 === false` or Phase 3 throws) THEN the new check is unreachable; behavior is unchanged.

3.12 WHEN `swap_guards` is the move type (which never changes any proctor's primary load) THEN the new check SHALL accept it unconditionally; no false rejections.
