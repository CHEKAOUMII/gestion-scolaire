# Bugfix Requirements Document

## Introduction

The proctor distribution algorithm v2 (`js/algorithms/proctor-distribution-v2.js`) computes per-class fairness bounds via `computeClassBounds` (≈ lines 542–615). For every eligibility class `c` with `members.length === N_c`, the function records `classLowerBound = floor((G_c + D_c) / N_c)` and `classUpperBound = ceil((G_c + D_c) / N_c)`. The intent — established by the closed spec `proctor-v2-fairness-undercovered-fix` — is that `classLowerBound` represents a **fairness floor**: a guard count that the rest of the algorithm (Phase 2.75 coverage repair, Phase 3 simulated annealing, the donor-eligibility check in `violatesHardConstraints`) is required to bring every member of class `c` up to.

The defect is a category mistake. `classLowerBound` is computed in the multi-class fallback branch (`classIds.length > 1`, ≈ lines 591–614) by dividing `bTotal = G_c + D_c` by `bSize = max(1, N_c)`. For a **singleton class** (`N_c === 1`) that produces `classLowerBound = G_c + D_c` — the entire reachable guard-slot count for that single proctor's eligibility set, **not** a fairness floor. On the production fixture `tests/fixtures/45454.json`, six singleton classes get `classLowerBound` values in the range 294–352, with `totalGuardSlots = 382`, `globalLowerBound = floor((382 + 13) / 147) = 2`, and `globalUpperBound = floor(382/147) + 1 = 3`. No algorithm can place a single proctor in 350 slots when the fixture only contains 382 slots total and a proctor occupies at most one slot per row — `classLowerBound = 352` is mathematically impossible to satisfy.

This bug was masked twice: (i) pre-`proctor-v2-key-shape-unification`, the dual-identity bug let Phase 2 over-assign affected proctors so their inflated guard counts accidentally satisfied the impossible bounds; (ii) pre-`proctor-v2-phase2-75-multi-step-repair` Tasks 5.2 + 6.1, the unstructured `coverageRepairWarnings: Array<{proctorKey, reason}>` shape did not surface `classLowerBound` per proctor, and the false-positive `no_swappable_peer` reason was indistinguishable from a single-step-deficit failure mode. With both closed specs in place, the structured warnings now expose the impossible per-proctor `classLowerBound` values directly.

The deeper investigation context — corrected production-fixture numbers, the full options analysis (Option C global-fairness vs Option D average-peer-size), the rationale for adopting Option C as the design choice, and the connection to the parent spec `proctor-v2-phase2-75-multi-step-repair` (whose inner-repair-loop and diagnostics-shape changes are observationally useful but do not resolve this regression) — is recorded in:

- `/home/chekaoumi/Desktop/gestionScholaire2/docs/agent-notes/proctor-v2-singleton-class-bounds.md`

### Relation to closed and in-progress specs

| Spec | Status | Relation to this bug |
|---|---|---|
| `proctor-v2-fairness-undercovered-fix` | Closed 2026-05-16 | Established the fairness invariant `min ≥ classLowerBound`. Its tests passed because no production input then exhibited a singleton class with `G_c > globalAvg`. This bugfix **restores truthful semantics** of that invariant by ensuring `classLowerBound` is always achievable. |
| `proctor-v2-key-shape-unification` | Closed 2026-05-16 | Made Phase 2 honest about duty constraints, exposing the singleton-class proctors that fall under impossible bounds. This bugfix is a downstream consequence — without key-shape unification the bug would still be hidden. |
| `proctor-distribution-db-memory-mismatch` | Closed 2026-05-16 | Display-layer fix, scope-disjoint. No interaction with this bugfix. |
| `proctor-v2-phase2-75-multi-step-repair` | **Partially closed — preserves observable diagnostics shape** | The inner-repair-loop and diagnostics-shape-migration changes from this parent spec are **structurally correct** and are what surfaced this bug. The parent spec's exploration test `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js` and its fix-checking test `tests/proctor-v2-phase2-75-multi-step-fix.test.js` continue to fail because the deeper bug is here in `computeClassBounds`. This bugfix **does not touch** the inner loop or the diagnostics shape — those changes stay as-is. |

### Scope discipline (single-function modification)

The defect is structurally inside `computeClassBounds`. The fix is a small, surgical change to one function: a new `globalLowerBound` floor (`floor((totalGuardSlots + D_expected) / N)`) is computed once and applied as a cap to the per-class lower-bound calculation in the multi-class branch, with a monotonicity guard that retains the per-class total when it is below the global floor (the degenerate case where `G_c + D_c < globalLowerBound`). No DB schema changes, no IPC contract changes, no display-layer changes, no changes to `computeEligibilityClasses`, `collectUncovered`, `applyCoverageSwap`, `phase2_75CoverageRepair`, `violatesHardConstraints`, `getProctorKey`, or any other function. The new test files lock the post-fix invariants. Total surface area: one function in `js/algorithms/proctor-distribution-v2.js` plus new test files.

### Bug Condition C(X)

```pascal
FUNCTION isBugCondition(X)
  INPUT:  X = (proctorsList, examScheduleData, examExemptionsData,
               examDutyTeachersData, D_expected, proctorsPerRoom, ...)
          — the full input object consumed by ProctorDistributionV2.run
  OUTPUT: boolean

  // 1. Run the algorithm in-memory (no IPC, no DB) up through the bounds-
  //    derivation step; we read classBoundsByProctorKey directly off the
  //    diagnostics object exposed by ProctorDistributionV2.run.
  R_mem      ← ProctorDistributionV2.run(X)
  classBounds ← R_mem.classBoundsByProctorKey            // canonical-key map

  // 2. Compute the global fairness floor that the fix introduces:
  //    LB_global = floor((totalGuardSlots + D_expected) / N_eligible).
  //    We derive its value from the run's totalGuardSlots, D_expected, and
  //    eligibleCountForBounds (computed by computeEligibilityClasses).
  totalGuardSlots ← R_mem.diagnostics.totalGuardSlots OR
                    sum over scheduleEntries of getGuardSlotsForScheduleIndex
  D_expected      ← Math.max(0, Math.floor(Number(X.D_expected) || 0))
  N_eligible      ← R_mem.diagnostics.eligibleCountForBounds OR
                    count of proctors with at least one eligible row
  LB_global       ← Math.floor((totalGuardSlots + D_expected) / N_eligible)

  // 3. Detect at least one proctor whose canonical-key classLowerBound
  //    exceeds the global fairness floor. The fix property allows
  //    classLowerBound ≤ LB_global + 1 to accommodate the existing
  //    ceil/floor pair from the only-one-class branch (which uses
  //    Math.ceil(onlyTotal / onlySize) = LB_global + 1 when
  //    (totalGuardSlots + D_expected) is not exactly divisible by N).
  FOR EACH proc, idx IN X.proctorsList DO
    key    ← getProctorKey(proc, idx)
    bounds ← classBounds[key]
    IF bounds = NULL THEN CONTINUE                     // proctor with no bounds
    IF bounds.classLowerBound > LB_global + 1 THEN
      RETURN true                                       // impossible bound
    END IF
  END FOR

  RETURN false
END FUNCTION
```

Equivalent observable form: there exists a proctor index `i` such that, after `computeClassBounds` returns, `classBoundsByProctorKey[getProctorKey(proc_i, i)].classLowerBound > floor((totalGuardSlots + D_expected) / N_eligible) + 1`. The dominant trigger in production is **singleton eligibility classes** — classes where `members.length === 1`, so `bSize = 1` and `classLowerBound = bTotal = G_class + D_class`, which can be in the hundreds when the proctor has wide eligibility coverage. The `+1` slack accommodates the ceil/floor pair in the only-one-class branch (`classIds.length === 1`) which legitimately produces `classLowerBound = floor(...)` and `classUpperBound = floor(...) + 1` when divisibility fails; the bugfix preserves this slack as a documented allowance.

#### Witness on `tests/fixtures/45454.json` (production fixture)

Post-`proctor-v2-key-shape-unification` and post-`proctor-v2-phase2-75-multi-step-repair` Tasks 5.2 + 6.1, the structured `coverageRepairWarnings` map exposes:

| canonical key | classLowerBound | initialLoad | finalLoad | reason            |
|---------------|-----------------|-------------|-----------|-------------------|
| `__idx_98`    | 352             | 1           | 1         | no_swappable_peer |
| `__idx_62`    | 342             | 3           | 3         | no_swappable_peer |
| `__idx_28`    | 342             | 3           | 3         | no_swappable_peer |
| `__idx_133`   | 318             | 3           | 3         | no_swappable_peer |
| `__idx_109`   | 294             | 3           | 3         | no_swappable_peer |
| `__idx_21`    | 352             | 3           | 3         | no_swappable_peer |

Six proctors flagged "uncovered" with mathematically impossible per-class lower bounds (range 294–352). Five of them are at `load = 3 = globalUpperBound`, so the inner repair loop correctly determines no donor can be found without violating the donor-side `classLowerBound` check from spec `proctor-v2-fairness-undercovered-fix` task 4.6 — these are **false positives** masquerading as deficits. The sixth (`__idx_98`, طارق الشعابتي, som=2270221) is at `load = 1` after the inner loop fired one swap; with `LB_global = 2` and the global ceil at 3, his true fairness target is 2 (or 3), but the singleton-class branch demands 352 — which is impossible. Diagnostic readings on the same fixture:

```
totalGuardSlots:           382
D_expected:                13
N_eligible:                147
LB_global = floor(395/147) = 2
UB_global = LB_global + 1  = 3
feasibleCeiling:           4

histogram (post-repair):   { "1": 1, "2": 56, "3": 90 }
                           — 147 distinct proctors, one at load=1 (طارق)
min:  1   max: 3   distinct: 147
coverageRepairSwaps:       18    (one for طارق, plus the deficit-1 cases)
coverageRepairUnresolved:  6     (the six false-positive singleton-class entries)
```

The post-fix invariant `classLowerBound ≤ LB_global + 1` would cap every singleton's `classLowerBound` at `LB_global + 1 = 3`, eliminate the six false-positive warnings, and let طارق legitimately land at `getPrimaryLoad ∈ {2, 3}` — closing the regression.

### Property P (Fix Checking)

```pascal
// Property: Fix Checking — every per-class lower bound is achievable
//                          by some assignment that respects the global
//                          fairness ceiling.
FOR ALL X WHERE isBugCondition_pre_fix(X) DO
  R_mem'      ← V2'.run(X)
  classBounds' ← R_mem'.classBoundsByProctorKey

  totalGuardSlots ← sum over scheduleEntries of getGuardSlotsForScheduleIndex
  D_expected      ← Math.max(0, Math.floor(Number(X.D_expected) || 0))
  N_eligible      ← count of proctors with at least one eligible row
  LB_global       ← Math.floor((totalGuardSlots + D_expected) / N_eligible)

  // (P-1) No per-class lower-bound exceeds the global fairness ceiling
  //       (LB_global + 1, where +1 accommodates the existing ceil/floor pair
  //       from the only-one-class branch).
  FOR EACH proc, idx IN X.proctorsList DO
    key    ← getProctorKey(proc, idx)
    bounds ← classBounds'[key]
    IF bounds = NULL THEN CONTINUE
    ASSERT bounds.classLowerBound ≤ LB_global + 1
  END FOR

  // (P-2) Singleton classes yield classLowerBound ≤ LB_global + 1.
  FOR EACH classId, cls IN R_mem'.eligibilityClasses DO
    IF cls.members.length = 1 THEN
      bounds ← R_mem'.classBounds.get(classId)
      ASSERT bounds.classLowerBound ≤ LB_global + 1
    END IF
  END FOR

  // (P-3) Production-fixture pinpoint: on tests/fixtures/45454.json,
  //       no proctor has classLowerBound > 3 (LB_global + 1 = 3), and the
  //       six false-positive coverageRepairWarnings disappear.
  IF X = load('tests/fixtures/45454.json') THEN
    FOR EACH key IN { '__idx_98','__idx_62','__idx_28','__idx_133','__idx_109','__idx_21' } DO
      ASSERT classBounds'[key].classLowerBound ≤ 3
    END FOR
    nonPassWarnings ← Object.keys(R_mem'.diagnostics.coverageRepairWarnings)
                            .filter(k → k ≠ '__pass__')
    ASSERT nonPassWarnings.length ≤ 1
        // legitimate at-most-one warning if طارق still cannot be lifted to 2
        // by the inner repair loop after the bounds are corrected; in that
        // case the warning has reason 'no_eligible_donor' (truthful), not
        // 'no_swappable_peer' (false-positive on impossible bound).
    ASSERT R_mem'.diagnostics.coverageRepairUnresolved = nonPassWarnings.length
  END IF

  // (P-4) Monotonicity guard: when (G_c + D_c) ≤ LB_global for the class,
  //       the per-class total is RETAINED unchanged (no upward inflation).
  //       This ensures the fix never RAISES a class's lower bound above
  //       what it would have been pre-fix.
  FOR EACH classId, cls IN R_mem'.eligibilityClasses DO
    bClassTotal_pre_fix ← G_c(classId) + D_c(classId)
    bounds              ← R_mem'.classBounds.get(classId)
    IF bClassTotal_pre_fix ≤ LB_global THEN
      ASSERT bounds.classLowerBound = bClassTotal_pre_fix
      ASSERT bounds.classUpperBound = bClassTotal_pre_fix
    END IF
  END FOR

  // (P-5) Determinism: the fix preserves byte-equality of two consecutive
  //       runs on the same input.
  R_mem''  ← V2'.run(X)
  ASSERT R_mem'.proctor_keys ≡ R_mem''.proctor_keys
  ASSERT R_mem'.reserve_keys ≡ R_mem''.reserve_keys
  ASSERT serialize(R_mem'.classBoundsByProctorKey)
       = serialize(R_mem''.classBoundsByProctorKey)
END FOR
```

Where `V2` is the algorithm before the fix and `V2'` is the algorithm after the fix.

### Preservation Goal

```pascal
// Property: Preservation Checking — non-buggy paths are unchanged pre/post fix
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT V2(X).result               ≡ V2'(X).result
  ASSERT V2(X).proctor_keys         ≡ V2'(X).proctor_keys
  ASSERT V2(X).reserve_keys         ≡ V2'(X).reserve_keys
  ASSERT V2(X).classBoundsByProctorKey
       ≡ V2'(X).classBoundsByProctorKey
  ASSERT V2(X).diagnostics.coverageRepairSwaps
       = V2'(X).diagnostics.coverageRepairSwaps
  ASSERT V2(X).diagnostics.coverageRepairUnresolved
       = V2'(X).diagnostics.coverageRepairUnresolved
  ASSERT V2(X).diagnostics.coverageRepairWarnings
       ≡ V2'(X).diagnostics.coverageRepairWarnings  // map shape preserved
END FOR

// Test-suite preservation: every currently-passing test continues to pass.
ASSERT every test in
   { tests/proctor-v2-*.test.js,
     tests/inv-h5-*.test.js,
     tests/preservation-config-roundtrip.pbt.test.js }
that PASSES against V2 also PASSES against V2'.

// Inner-repair-loop and diagnostics-shape contracts from the parent spec
// proctor-v2-phase2-75-multi-step-repair are NOT modified by this fix:
ASSERT body of phase2_75CoverageRepair UNCHANGED post-fix
ASSERT shape of diagnostics.coverageRepairWarnings UNCHANGED post-fix
       (Object<proctorKey, {reason, initialLoad, finalLoad,
                            classLowerBound, attemptedSwaps}>)

// Script-level preservation: the Node-only verify scripts produce
// identical reports pre/post fix on inputs where NOT isBugCondition(X).
ASSERT scripts/verify-fixture.js     produces P1/P2/P3 PASS pre and post fix
       on every fixture for which NOT isBugCondition(fixture).
ASSERT scripts/verify-real-centre.js produces P1/P2/P3 PASS pre and post fix.

// On the production fixture (where C(X) DOES fire pre-fix), the verify
// scripts MUST report PASS post-fix — the fix RESTORES truth, it does
// not weaken any prior claim.
ASSERT scripts/verify-fixture.js on 'tests/fixtures/45454.json'
       reports min ≥ classLowerBound POST-FIX.
```

## Bug Analysis

### Current Behavior (Defect)

What currently happens when the bug is triggered.

1.1 WHEN the input `X` produces an eligibility class `c` with `members.length === 1` (a singleton class) AND the multi-class fallback branch of `computeClassBounds` fires (`classIds.length > 1`) THEN `bSize = max(1, members.length) = 1`, so `classLowerBound = floor(bTotal / 1) = bTotal = G_c + D_c`, where `G_c` is the sum of guard slots over the singleton's reachable rows.

1.2 WHEN a singleton proctor has wide row eligibility (no exemptions, no duty constraints across most of the schedule) on the production fixture THEN `G_c` reaches values in the range 294–352, producing `classLowerBound` in the same range, while `totalGuardSlots = 382` and `globalLowerBound = floor((382 + 13) / 147) = 2`.

1.3 WHEN the algorithm later reads `classBoundsByProctorKey[key].classLowerBound` in `collectUncovered` (≈ line 2914) to identify proctors below their fairness floor THEN the singleton proctor is flagged as uncovered with deficit `D = 352 - currentLoad`, which is mathematically impossible to close — no proctor can be assigned 350+ slots in a 382-slot fixture.

1.4 WHEN `phase2_75CoverageRepair` (post-`proctor-v2-phase2-75-multi-step-repair` Tasks 5.2 + 6.1) attempts to repair the singleton proctor THEN its inner repair loop calls `buildSwapCandidates` against `loadState`, finds no donor that satisfies the donor-side `violatesHardConstraints` check (every potential donor is at `load = globalUpperBound` and dropping them by 1 would land them at `globalLowerBound - 1` per their own per-class bounds), and emits a structured warning with `reason: 'no_swappable_peer'`, `attemptedSwaps: 0` (or 1 for `__idx_98`).

1.5 WHEN `coverageRepairWarnings` is inspected on the production fixture post-Tasks 5.2 + 6.1 THEN it contains six entries keyed by `__idx_98`, `__idx_62`, `__idx_28`, `__idx_133`, `__idx_109`, `__idx_21` with `classLowerBound` values 352, 342, 342, 318, 294, 352 respectively — every value strictly greater than `LB_global + 1 = 3`.

1.6 WHEN the diagnostic observable `min(loadState)` is read on the production fixture post-Tasks 5.2 + 6.1 THEN it is `1` (طارق at load=1, falsifying the closed-spec invariant `min ≥ classLowerBound = 2` from `proctor-v2-fairness-undercovered-fix`). The remaining 146 proctors form the histogram `{2: 56, 3: 90}`, all within the achievable range.

1.7 WHEN the closed spec `proctor-v2-fairness-undercovered-fix` was originally validated THEN no production input then exhibited a singleton class with `G_c > globalLowerBound`, so its preservation tests passed while the impossible-bounds path lay dormant. The closed spec's promise (`min ≥ classLowerBound`) is therefore observationally falsified post-key-shape-unification on the production fixture, but the falsification is a consequence of `computeClassBounds` returning impossible values — not of the fairness-undercovered fix being incorrect.

1.8 WHEN the parent spec `proctor-v2-phase2-75-multi-step-repair` ran its exploration test `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js` on the production fixture THEN the test fails on the assertion that طارق reaches `getPrimaryLoad ≥ 2`, with the documented counterexample showing `classLowerBound: 352` for the singleton-class proctors. The parent spec's inner-repair-loop change is structurally correct and surfaced this bug — it does not cause it.

1.9 WHEN `scripts/inspect-fixture-state.js` is executed against the production fixture on the post-parent-spec code THEN it reports the histogram `{1: 1, 2: 56, 3: 90}`, `min: 1`, `distinct: 147`, `coverageRepairSwaps: 18`, `coverageRepairUnresolved: 6`. The diagnostic confirms that exactly six singleton-class false-positives plus one genuine deficit (طارق post-one-swap, blocked by impossible bound) remain.

1.10 WHEN the bug is triggered THEN it is confined to the body of `computeClassBounds` in `js/algorithms/proctor-distribution-v2.js` (≈ lines 542–615), specifically the multi-class fallback branch (`classIds.length > 1`, ≈ lines 591–614) where the per-class lower-bound is computed without any global ceiling. All callers of the function (`run` at ≈ line 1937, downstream consumers `collectUncovered`, `phase2_75CoverageRepair`, `violatesHardConstraints`) faithfully read the per-class bound as if it were a fairness floor; none of them introduce the inflation.

1.11 WHEN the parent spec `proctor-v2-phase2-75-multi-step-repair`'s diagnostics-shape migration is in place (post-Tasks 5.2 + 6.1) THEN the structured warnings cleanly expose the impossible per-class lower bounds. This bugfix MUST NOT touch that diagnostics shape — it operates one layer earlier, in `computeClassBounds`, and lets the existing repair pass and warning emission code continue to function unchanged on the corrected bounds.

### Expected Behavior (Correct)

What should happen instead.

2.1 WHEN the input `X` is processed by `computeClassBounds'` (the post-fix version) THEN every returned per-class `classLowerBound` SHALL satisfy `classLowerBound ≤ LB_global + 1`, where `LB_global = floor((totalGuardSlots + D_expected) / N_eligible)`, `totalGuardSlots = sum over scheduleEntries of getGuardSlotsForScheduleIndex`, `D_expected = Math.max(0, Math.floor(Number(input.D_expected) || 0))`, and `N_eligible` is the count of proctors with at least one eligible row (the `eligibleCountForBounds` already computed in `run` at ≈ line 1937).

2.2 WHEN a singleton eligibility class `c` exists in the multi-class fallback branch (`classIds.length > 1`, `members.length === 1`) THEN `computeClassBounds'` SHALL produce `classLowerBound = min(floor(bTotal / bSize), LB_global)` and `classUpperBound = max(ceil(bTotal / bSize), LB_global)` IF `bTotal > LB_global`, OR retain `classLowerBound = bTotal` and `classUpperBound = bTotal` IF `bTotal ≤ LB_global` (the monotonicity guard — never raise a class's lower bound above its true achievable total).

2.3 WHEN the only-one-class branch (`classIds.length === 1`) is taken THEN `computeClassBounds'` SHALL produce the same `classLowerBound = floor(onlyTotal / onlySize)` and `classUpperBound = ceil(onlyTotal / onlySize)` as the pre-fix code — this branch is already mathematically equivalent to the global fairness floor (it computes exactly `floor(totalGuardSlots / N) + adjustment_for_D_expected`) and does not exhibit the bug. Preservation of this branch is required.

2.4 WHEN any non-singleton class `c` (`members.length ≥ 2`) is processed in the multi-class fallback branch THEN `computeClassBounds'` SHALL produce `classLowerBound = min(floor(bTotal / bSize), LB_global)` and `classUpperBound = max(ceil(bTotal / bSize), LB_global)` IF `floor(bTotal / bSize) > LB_global`. For non-singleton classes whose pre-fix `floor(bTotal / bSize)` already happens to be `≤ LB_global` (the typical case on production), the post-fix calculation yields the same value as the pre-fix calculation — observational equivalence on the non-bug path.

2.5 WHEN the design phase of this spec selects the multi-step bound-correction strategy THEN it SHALL adopt **Option C — global-fairness floor** as documented in `docs/agent-notes/proctor-v2-singleton-class-bounds.md` §"Recommendation: Option C (global-fairness)":

- **Formula**: `LB_global = floor((totalGuardSlots + D_expected) / N_eligible)`.
- **Cap rule**: `classLowerBound = min(floor(bTotal / bSize), LB_global)` for the multi-class fallback branch; `classUpperBound = max(ceil(bTotal / bSize), LB_global)`.
- **Monotonicity guard**: `IF bTotal ≤ LB_global THEN retain bTotal` for both lower and upper bounds (degenerate case where the class's reachable total is below the global floor — typically `G_c = 0` or class restricted to one row).
- **Rationale**: mathematically simpler than alternatives; semantically aligned with the existing only-one-class branch (lines 561–574 of `computeClassBounds`) which computes exactly the same quantity for the all-eligible case; deterministic without per-class average-peer-size scans; identical numerical result to alternatives on the production fixture.

The other options (Option A — merge singleton classes into nearest-superset class, Option B — two-tier bounds with hard floor and soft target, Option D — average-peer-size cap) are evaluated and rejected in the design document with explicit rationale.

2.6 WHEN the post-fix algorithm runs against `tests/fixtures/45454.json` THEN the six previously-impossible per-class lower bounds SHALL be capped at `LB_global + 1 = 3`, eliminating the six false-positive `coverageRepairWarnings` entries (`__idx_98`, `__idx_62`, `__idx_28`, `__idx_133`, `__idx_109`, `__idx_21`). The repair pass SHALL find legitimate donors for طارق (now needing `getPrimaryLoad ≥ 2` rather than `≥ 352`), bringing him to `load ∈ {2, 3}`. `min(loadState) ≥ 2`, `coverageRepairUnresolved ≤ 1` (zero in the typical case where طارق is repairable; at most one if the inner loop legitimately cannot find an eligible donor for him after the bounds are corrected, in which case the warning's `reason` is `'no_eligible_donor'` not `'no_swappable_peer'`).

2.7 WHEN `computeClassBounds'` is called THEN it SHALL accept the existing parameters `(classes, scheduleEntries, proctorsPerRoom, D_expected, N, guardSlotsByIndex)` unchanged. The `LB_global` value is derived from these parameters internally — `totalGuardSlots` is computed once by summing `getGuardSlotsForScheduleIndex(scheduleEntries, idx, proctorsPerRoom, guardSlotsByIndex)` over all schedule entries (or, equivalently, by summing the `gById` map values across all classes since `gById` already covers reachable slots by class — the design document specifies the exact derivation).

2.8 WHEN the design phase enumerates change sites THEN it SHALL include at minimum: (a) the introduction of `LB_global` derivation at the top of `computeClassBounds`, before the `classIds.length === 1` branch; (b) the `min/max` cap applied in the multi-class fallback branch (lines ≈ 591–614); (c) the monotonicity guard `IF bTotal ≤ LB_global THEN retain bTotal`; (d) preservation of the `gById` precomputation (already in place, no changes); (e) preservation of the `dShareById` residual-distribution logic (already in place, no changes — the cap applies AFTER `bTotal = bG + bD` is computed).

2.9 WHEN any non-singleton class with `floor(bTotal / bSize) ≤ LB_global` is processed (the typical case for the production fixture's multi-member classes) THEN `computeClassBounds'` SHALL produce the same `classLowerBound` and `classUpperBound` values as `computeClassBounds`. The cap is one-sided (only applies when `floor(bTotal / bSize) > LB_global`) — observational equivalence is preserved on every non-buggy class.

2.10 WHEN the post-fix output is consumed by `collectUncovered`, `phase2_75CoverageRepair`'s inner repair loop, `violatesHardConstraints`'s donor-side check, or `serializeClassBounds` THEN no change to the consumer code is required — they continue to read `classBounds[key].classLowerBound` as a fairness floor, and that floor is now always achievable (capped at `LB_global + 1`).

2.11 WHEN the fix is applied THEN it SHALL be confined to `computeClassBounds` and to the new test files that lock the post-fix invariants. NO changes to `computeEligibilityClasses`, `getGuardSlotsForScheduleIndex`, `serializeClassBounds`, `collectUncovered`, `phase2_75CoverageRepair` (the parent spec's inner repair loop and diagnostics shape stay as-is), `applyCoverageSwap`, `buildSwapCandidates`, `swapPreservesHardConstraints`, `violatesHardConstraints`, `getProctorKey`, `getProctorExemptionKey`, the duty pre-pass, `phase2Build`, `phase2_5PopulateReserves`, `applyReserveSwap`, `phase3Optimize`, the orchestrator, IPC handlers, DB migrations, `js/data/proctor-key-resolver.js`, the display layer, or any HTML/preload file SHALL be introduced by this spec.

2.12 WHEN the design phase is complete THEN it SHALL specify the new test files that lock the post-fix invariants. At minimum these SHALL include: (i) a singleton-class unit test asserting that for a synthetic input with one proctor in a singleton class and `G_c > globalLowerBound`, the post-fix `classLowerBound ≤ LB_global + 1`; (ii) a regression lock on `tests/fixtures/45454.json` asserting the six previously-impossible bounds are now capped at 3 and `min(loadState) ≥ 2`; (iii) a property-based test that the cap NEVER raises a class's `classLowerBound` above its pre-fix value (one-sided monotonicity); (iv) a determinism property test running `computeClassBounds` twice on the same input and asserting byte-equality of the returned `Map`; (v) an integration assertion that the parent spec's `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js` and `tests/proctor-v2-phase2-75-multi-step-fix.test.js` flip from FAIL to PASS post-fix.

2.13 WHEN the design phase considers the precise placement of the `LB_global` derivation THEN it SHALL specify whether `totalGuardSlots` is computed inside `computeClassBounds` (by summing `getGuardSlotsForScheduleIndex` over all schedule entries) or read from the orchestrator (by passing it through `run` at ≈ line 1937). The chosen approach SHALL preserve determinism (same input → same `LB_global`) and avoid duplicate computation when callers already have a `totalGuardSlots` value.

### Unchanged Behavior (Regression Prevention)

Existing behavior that must be preserved.

3.1 WHEN any test in `tests/proctor-v2-*.test.js` is executed against the post-fix algorithm THEN it SHALL CONTINUE TO pass with no new failures and no new warnings, including (but not limited to): every test from the closed specs `proctor-v2-fairness-undercovered-fix`, `proctor-v2-key-shape-unification`, `proctor-distribution-db-memory-mismatch`, `proctor-v2-strict-fairness-coverage`, and the parent spec `proctor-v2-phase2-75-multi-step-repair`'s `proctor-v2-phase2-75-multi-step-warnings-shape.test.js`, `proctor-v2-phase2-75-multi-step-determinism.test.js`, and `proctor-v2-phase2-75-multi-step-preservation.pbt.test.js`.

3.2 WHEN any test in `tests/inv-h5-*.test.js` is executed against the post-fix algorithm THEN it SHALL CONTINUE TO pass, including `tests/inv-h5-cross-page-consistency.test.js` and any associated checklist-driven assertions.

3.3 WHEN `tests/preservation-config-roundtrip.pbt.test.js` is executed against the post-fix code THEN it SHALL CONTINUE TO pass for every config key, with the round-trip property preserved.

3.4 WHEN `scripts/verify-fixture.js` is executed against the post-fix algorithm on `tests/fixtures/45454.json` THEN it SHALL report P1/P2/P3 PASS, with the additional truthful guarantee that `min ≥ classLowerBound` (where pre-fix it reported `min = 1` despite the impossible per-class bounds).

3.5 WHEN `scripts/verify-real-centre.js` is executed against the post-fix algorithm THEN it SHALL CONTINUE TO report P1/P2/P3 PASS on the real-centre fixture.

3.6 WHEN the input `X` contains no singleton class with `G_c + D_c > LB_global` (i.e. every class with `bTotal > LB_global` already has `members.length ≥ 2` and `floor(bTotal / bSize) ≤ LB_global`) THEN the post-fix algorithm SHALL produce a result observationally identical to the pre-fix algorithm for that input — same `proctor_keys`, same `reserve_keys`, same `loadState`, same `classBoundsByProctorKey`, same `diagnostics.coverageRepairSwaps` count, same `diagnostics.coverageRepairWarnings` map shape and contents.

3.7 WHEN the input `X` triggers the only-one-class branch of `computeClassBounds` (`classIds.length === 1`) THEN the post-fix algorithm SHALL produce a result byte-identical to the pre-fix algorithm — the only-one-class branch is already mathematically equivalent to the global fairness floor and the fix does not touch it.

3.8 WHEN the closed spec `proctor-v2-fairness-undercovered-fix` (closed 2026-05-16) is re-validated against the post-fix algorithm THEN every guarantee it published — the `collectUncovered` predicate, the `violatesHardConstraints` lower-bound check, the P1/P2/P3 properties on the real-centre fixture — SHALL CONTINUE TO hold. This bugfix's effect on that spec is to RESTORE the truth of its `min ≥ classLowerBound` invariant on inputs where singleton-class bounds are present (which the closed spec's tests did not cover but the present production fixture exhibits).

3.9 WHEN the closed spec `proctor-v2-key-shape-unification` (closed 2026-05-16) is re-validated against the post-fix algorithm THEN its `buildKeyAdapter` / `toCanonicalKey` helpers, the canonical-shape closure invariant on `proctor_keys ∪ reserve_keys ∪ loadState`, and the absence of the 6 ghost CIN keys on the production fixture SHALL CONTINUE TO hold. The bounds-correction fix operates on canonical-shape keys throughout (the `bounds.set(bId, ...)` map is keyed by `classId`, not by canonical proctor key — the shape contract is unaffected).

3.10 WHEN the parent spec `proctor-v2-phase2-75-multi-step-repair`'s contracts are re-validated against the post-fix algorithm THEN its inner-repair-loop semantics (`WHILE getPrimaryLoad < classLowerBound DO ... END WHILE`), its diagnostics-shape migration (`coverageRepairWarnings: Object<proctorKey, {reason, initialLoad, finalLoad, classLowerBound, attemptedSwaps}>`), and its `__pass__` synthetic-key for catch-path returns SHALL CONTINUE TO hold. The body of `phase2_75CoverageRepair` is NOT touched by this bugfix — it continues to operate on the corrected bounds without code changes.

3.11 WHEN `npm run lint` is executed after the fix THEN it SHALL CONTINUE TO produce zero new errors and zero new warnings relative to the closing state of `proctor-v2-phase2-75-multi-step-repair` (post-Tasks 5.2 + 6.1).

3.12 WHEN `npm test` is executed after the fix THEN every previously-passing test SHALL CONTINUE TO pass, AND the parent spec's currently-failing tests `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js` and `tests/proctor-v2-phase2-75-multi-step-fix.test.js` SHALL now PASS deterministically — they encode invariants (`min ≥ classLowerBound`, `coverageRepairUnresolved = 0` on the production fixture) that this bugfix restores.

3.13 WHEN `main/db/migrations.js` is inspected after the fix THEN the database schema SHALL CONTINUE TO be unchanged (no new migration introduced by this spec).

3.14 WHEN `main/ipc/exam-config-data.js` is inspected after the fix THEN its IPC contract for `examConfigData:save` and `examConfigData:get` SHALL CONTINUE TO be unchanged (no parameter, return-shape, or auth-policy changes introduced by this spec).

3.15 WHEN previously-saved DB rows for `examAutoDistributionData` (rows persisted under the partially-repaired pre-fix algorithm and therefore containing one load=1 proctor on the production fixture) are loaded by `exams-rooms.html` after the fix THEN the load path SHALL CONTINUE TO render those rows without error. The display-layer resolver from spec `proctor-distribution-db-memory-mismatch` MAY still resolve any missing proctor's row gracefully. This spec does NOT mandate a silent rewrite of legacy DB rows; the user must re-run distribution to obtain a post-fix `examAutoDistributionData` payload.

3.16 WHEN any input `X` for which `NOT isBugCondition(X)` is run through the post-fix algorithm THEN `V2'(X)` SHALL equal `V2(X)` byte-for-byte — `proctor_keys`, `reserve_keys`, the assignments graph, all swap moves, all per-row metadata, `diagnostics.coverageRepairSwaps`, `diagnostics.coverageRepairUnresolved`, and the structured `diagnostics.coverageRepairWarnings` map SHALL all be observationally equivalent.

3.17 WHEN the post-fix `computeClassBounds'` runs THEN it SHALL maintain the existing per-class iteration order from `Array.from(classes.keys()).sort()` (lexicographic on `classId`), the existing `gById` precomputation, and the existing `dShareById` residual-distribution logic. Determinism is required: same input → same returned `Map` with byte-identical `classLowerBound` and `classUpperBound` values per class.

3.18 WHEN the post-fix pass runs on inputs where `classLowerBound = 0` for some proctor (degenerate case — proctor with no eligible rows AND no duty share) THEN that proctor SHALL be excluded from the uncovered set by `collectUncovered`'s existing degenerate-boundary check (`bounds.classLowerBound === 0` → skip). The bugfix preserves this exclusion — `LB_global` is `≥ 0` and the `min/max` cap never raises a per-class bound above its pre-fix value, so the `=0` boundary is unaffected.

3.19 WHEN any class `c` has `bTotal = G_c + D_c > LB_global` AND `members.length ≥ 2` AND `floor(bTotal / bSize) ≤ LB_global` (the standard non-singleton case on production) THEN the cap is a no-op for that class — pre-fix `classLowerBound = floor(bTotal / bSize) ≤ LB_global = post-fix classLowerBound`. Observational equivalence preserved per clause 3.16.

3.20 WHEN any class `c` has `bTotal ≤ LB_global` (the degenerate case where reachable total is below the global floor — e.g. proctor restricted to one or two rows in a many-class fixture) THEN the post-fix algorithm SHALL retain `classLowerBound = bTotal` and `classUpperBound = bTotal` (the monotonicity guard), preserving pre-fix behavior exactly. This is the same algebraic identity as the pre-fix code (`Math.floor(bTotal / 1) = bTotal` for `bSize = 1`, `Math.floor(bTotal / bSize) ≤ bTotal` for `bSize ≥ 2` and `bTotal ≤ LB_global` non-zero case), so no observable change.

3.21 WHEN the parent spec's preservation property test `tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js` is re-run against the post-fix code THEN every generated input that passes the parent spec's `NOT isBugCondition(input)` filter (no proctor has deficit ≥ 2 after Phase 2) SHALL CONTINUE TO produce byte-identical output post-fix. The parent spec's filter intersects with this spec's filter — if a generated input has neither deficit ≥ 2 (parent bug) nor singleton class with `G_c > LB_global` (this spec's bug), then both pre-fix and post-fix algorithms produce the same output.

3.22 WHEN the post-fix test `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js` (the parent spec's exploration harness) is re-run on the production fixture THEN it SHALL flip from FAIL to PASS, because the corrected bounds let the inner repair loop close طارق's deficit (or, in the worst case, the warning's `reason` becomes `'no_eligible_donor'` with `attemptedSwaps ≥ 1` instead of `'no_swappable_peer'` with `attemptedSwaps = 0`, and the test is updated to accept either outcome).

3.23 WHEN the synthetic deficit-2 and deficit-3 cases in the parent spec's exploration test are re-run THEN they SHALL CONTINUE TO behave as designed by the parent spec — those synthetic inputs do not trigger singleton-class impossible bounds (their proctors are configured with `members.length ≥ 2` per the parent spec's design). The bugfix is orthogonal to those synthetic inputs.

3.24 WHEN the orchestrator (≈ line 4358) reads `phase2_75Diagnostics.warnings || {}` and aggregates it into `diagnostics.coverageRepairWarnings` THEN the post-fix output SHALL preserve the parent spec's map shape exactly — no array reversal, no key renaming, no payload field removal. The bugfix changes only what proctors appear in the map (eliminating false positives), not the map's shape.

3.25 WHEN the post-fix algorithm runs against inputs where `D_expected = 0` (no expected duty pairs) THEN `LB_global = floor(totalGuardSlots / N_eligible)` and the cap behavior SHALL be identical to the cap behavior on inputs with `D_expected > 0`, with the appropriate numerical adjustment. No special-case handling for `D_expected = 0` is introduced.
