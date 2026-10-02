# Bugfix Requirements Document

## Introduction

The proctor distribution algorithm v2 (`js/algorithms/proctor-distribution-v2.js`) contains a coverage-repair pass — `phase2_75CoverageRepair` (≈ line 2826) — that runs after Phase 2 (Hungarian assignment) and is responsible for lifting any proctor whose `getPrimaryLoad` is below their `classLowerBound` up to (or beyond) that bound. The current implementation performs **single-step swaps only**: each invocation of `applyCoverageSwap` increases the uncovered proctor's primary load by exactly +1. The outer fixed-point loop iterates over rows/slots looking for swap candidates, but it has no inner loop that re-targets the same uncovered proctor until that proctor reaches `classLowerBound`.

For every uncovered proctor whose load deficit is exactly 1 slot (`classLowerBound − currentLoad === 1`), the existing pass succeeds — a single swap closes the gap and the proctor exits the uncovered set. For any uncovered proctor whose deficit is ≥ 2 slots, the pass leaves them strictly below `classLowerBound`, increments `coverageRepairUnresolved`, and records no further repair attempts for that proctor in subsequent rounds.

This defect was previously masked by the dual-identity bug (closed in spec `proctor-v2-key-shape-unification` on 2026-05-16). Pre-key-shape-fix, the duty pre-pass wrote duty load entries under the `som`-shaped key while Phase 2 read its own state under the `__idx_N`-shaped key for the same proctor. The split caused Phase 2 to over-assign affected proctors (it ignored their duty constraint), which artificially raised their guard load above zero and kept them out of the deep-deficit branch of `phase2_75CoverageRepair`. With key-shape unification landed, Phase 2 now correctly excludes proctors from their duty halfday — and on `tests/fixtures/45454.json` exactly one proctor (idx=98, طارق الشعابتي, som=2270221) ends Phase 2 with `guardCount = 0` while `classLowerBound = 2`. The repair pass then performs zero successful swaps for this proctor and reports `coverageRepairUnresolved = 6`, leaving `min(loadState) = 0` and falsifying the closed-spec fairness invariant `min ≥ classLowerBound` on the production fixture.

The full investigation context — devtools-confirmed evidence, root-cause analysis through the repair pass, observed histogram on the production fixture, the diagnostic script in `scripts/inspect-fixture-state.js`, and the failing regression test in `tests/proctor-v2-fairness-undercovered-exploration.test.js` — is recorded in:

- `/home/chekaoumi/Desktop/gestionScholaire2/.agent/proctor-v2-phase2-75-multi-step-repair.md`

### Relation to closed specs

| Spec | Status | Relation to this bug |
|---|---|---|
| `proctor-v2-fairness-undercovered-fix` | Closed 2026-05-16 | Established the fairness invariant `min ≥ classLowerBound`. This spec **invokes** `phase2_75CoverageRepair` to enforce that invariant via `collectUncovered` + repair. The single-step limitation of the repair pass was masked at closing time because no production input then exhibited a proctor with deficit ≥ 2. The fix in this spec SHALL preserve every guarantee of that closed spec while extending the repair pass to handle deficits ≥ 2. |
| `proctor-distribution-db-memory-mismatch` | Closed 2026-05-16 | Fixed the display-layer aggregator. Scope-disjoint from this spec — no relation to repair-loop semantics. |
| `proctor-v2-key-shape-unification` | Closed 2026-05-16 | **Unmasked** this bug. The fix there made Phase 2 honest about duty constraints, exposing the load=0 proctor that the present spec must repair. The fix in this spec is the next layer of the same investigation. |

### Scope discipline (single-function modification)

The defect is structurally inside `phase2_75CoverageRepair`. The user's constraint — "يجب ان يكون الحل منهجي وهيكلي" — is satisfied here by a small, surgical change to one function: the single-swap-per-uncovered-proctor loop becomes a multi-swap-per-uncovered-proctor loop bounded by `classLowerBound − currentLoad`. No DB schema changes. No IPC contract changes. No display-layer changes. No changes to `collectUncovered`, `applyCoverageSwap`'s eligibility predicates, `violatesHardConstraints`, or `getProctorKey`. The full surface area is one function in `js/algorithms/proctor-distribution-v2.js` plus the new test files that lock the post-fix invariants.

### Bug Condition C(X)

```pascal
FUNCTION isBugCondition(X)
  INPUT:  X = (proctorsList, examDutyTeachersData, examExemptionsData,
               examScheduleData, classBoundsByProctorKey, ...)
          — the full input object consumed by ProctorDistributionV2.run
  OUTPUT: boolean

  // 1. Run the algorithm in-memory (no IPC, no DB)
  R_mem ← ProctorDistributionV2.run(X)
  loadState ← R_mem.diagnostics.loadStateSnapshot   // post-Phase-2.75 state
  classBounds ← R_mem.diagnostics.classBoundsByProctorKey

  // 2. Detect at least one proctor whose canonical-key load is below
  //    classLowerBound after Phase 2.75 has had its chance to repair.
  //    The repair pass is supposed to ensure load >= classLowerBound;
  //    this predicate fires whenever it failed to do so.
  FOR EACH proc, idx IN X.proctorsList DO
    key    ← getProctorKey(proc, idx)
    bounds ← classBounds[key]
    IF bounds = NULL THEN CONTINUE             // no class-bounds entry
    IF bounds.classLowerBound = 0 THEN CONTINUE // degenerate boundary

    primaryLoad ← getPrimaryLoad(loadState, key)
    deficit     ← bounds.classLowerBound − primaryLoad

    IF deficit ≥ 1 AND R_mem.diagnostics.coverageRepairUnresolved > 0 THEN
      // (a) proctor is below lowerBound after the repair pass, AND
      // (b) the pass reported it could not resolve at least one case.
      // The dominant failure mode (per investigation) is deficit ≥ 2,
      // because deficit = 1 is closed by the existing single swap.
      RETURN true
    END IF
  END FOR

  RETURN false
END FUNCTION
```

Equivalent observable form: there exists a proctor index `i` such that, after `phase2_75CoverageRepair` has finished, `getPrimaryLoad(loadState, getProctorKey(proc_i, i)) < classBoundsByProctorKey[getProctorKey(proc_i, i)].classLowerBound`, and the algorithm's diagnostics report `coverageRepairUnresolved > 0`. The dominant trigger is `deficit ≥ 2` — the single-swap pass cannot close a multi-step gap.

Concrete witness on `tests/fixtures/45454.json` (post-key-shape-unification):

| Proctor (teacher_name) | idx | som     | Phase-2 guardCount | dutyCount | classLowerBound | Post-repair primaryLoad | Deficit |
|------------------------|-----|---------|--------------------|-----------|-----------------|-------------------------|---------|
| طارق الشعابتي          | 98  | 2270221 | 0                  | 1         | 2               | 0                       | 2       |

Diagnostic readings on the same fixture:

```
histogram: { "2": 56, "3": 90 }   — only 146 distinct proctors out of 147
min: 0  max: 3  distinct: 146
coverageRepairSwaps:     17       — successful single-step repairs (deficit=1 cases)
coverageRepairUnresolved: 6       — at least one of the 6 is the load=0 case above
classLowerBound: 2  classUpperBound: 3
proctors at load=1:  0            — confirms swaps closed every deficit=1 case
proctors at load=0:  1            — the unrepaired deficit=2 case
```

### Property P (Fix Checking)

```pascal
// Property: Fix Checking — the repair pass closes deficits of any size
//                          (bounded by classLowerBound) for every uncovered proctor.
FOR ALL X WHERE isBugCondition_pre_fix(X) DO
  R_mem' ← V2'.run(X)
  loadState' ← R_mem'.diagnostics.loadStateSnapshot
  classBounds ← R_mem'.diagnostics.classBoundsByProctorKey

  // (P-1) No proctor is below classLowerBound after the fixed repair pass,
  //       UNLESS the pass has documented in coverageRepairWarnings the
  //       precise reason (no eligible donor reachable in any row).
  FOR EACH proc, idx IN X.proctorsList DO
    key    ← getProctorKey(proc, idx)
    bounds ← classBounds[key]
    IF bounds = NULL THEN CONTINUE
    IF bounds.classLowerBound = 0 THEN CONTINUE

    load ← getPrimaryLoad(loadState', key)
    IF load < bounds.classLowerBound THEN
      ASSERT key ∈ keysOf(R_mem'.diagnostics.coverageRepairWarnings)
      ASSERT R_mem'.diagnostics.coverageRepairWarnings[key].reason
             = 'no_eligible_donor'
    END IF
  END FOR

  // (P-2) Multi-step repair: when the pass succeeds for a proctor whose
  //       initial deficit was D ≥ 2, it performed exactly D successful
  //       swaps for that proctor (or more, if upper-bound headroom allows
  //       and existing pass behavior already over-shoots; semantics match
  //       the pre-fix behavior for D=1 inputs).
  FOR EACH proc, idx IN X.proctorsList DO
    key       ← getProctorKey(proc, idx)
    initial   ← initialPrimaryLoad(R_mem'.diagnostics, key)  // pre-repair load
    bounds    ← classBounds[key]
    IF bounds = NULL OR bounds.classLowerBound = 0 THEN CONTINUE
    IF initial ≥ bounds.classLowerBound THEN CONTINUE          // not uncovered

    final     ← getPrimaryLoad(loadState', key)
    IF final ≥ bounds.classLowerBound THEN
      // Repair succeeded. The number of successful swaps for this proctor
      // equals (final − initial) and is ≥ 1.
      ASSERT (final − initial) ≥ 1
      ASSERT final ≥ bounds.classLowerBound
    END IF
  END FOR

  // (P-3) On the production fixture specifically, no proctor remains at
  //       load < classLowerBound after the fixed repair pass.
  IF X = load('tests/fixtures/45454.json') THEN
    ASSERT min(histogramByCanonicalKey(R_mem')) ≥ classLowerBound
    ASSERT 'طارق الشعابتي' NOT IN zeroLoadProctors(R_mem')
    ASSERT R_mem'.diagnostics.coverageRepairUnresolved = 0
  END IF

  // (P-4) Determinism: multi-step repair preserves the deterministic
  //       iteration contract of the pre-fix pass — same input → same output.
  R_mem''  ← V2'.run(X)   // run twice
  ASSERT R_mem'.proctor_keys ≡ R_mem''.proctor_keys
  ASSERT R_mem'.reserve_keys ≡ R_mem''.reserve_keys
END FOR
```

Where `V2` is the algorithm before the fix and `V2'` is the algorithm after the fix.

### Preservation Goal

```pascal
// Property: Preservation Checking — non-buggy paths are unchanged pre/post fix
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT V2(X).result  ≡  V2'(X).result        // observationally equivalent
  ASSERT V2(X).reserve_keys  ≡  V2'(X).reserve_keys
  ASSERT V2(X).diagnostics.coverageRepairSwaps
         = V2'(X).diagnostics.coverageRepairSwaps   // for D≤1 inputs, identical
END FOR

// Test-suite preservation: every currently-passing test continues to pass.
ASSERT every test in
   { tests/proctor-v2-*.test.js,
     tests/inv-h5-*.test.js,
     tests/preservation-config-roundtrip.pbt.test.js }
that PASSES against V2 also PASSES against V2'.

// Script-level preservation: the Node-only verify scripts produce
// identical reports pre/post fix on inputs where NOT isBugCondition(X).
ASSERT scripts/verify-fixture.js     produces P1/P2/P3 PASS pre and post fix
       on every fixture for which NOT isBugCondition(fixture).
ASSERT scripts/verify-real-centre.js produces P1/P2/P3 PASS pre and post fix.

// On the production fixture (where C(X) DOES fire pre-fix), the verify
// scripts MUST report PASS post-fix — the fix RESTORES truth, it does
// not weaken any prior claim.
ASSERT scripts/verify-fixture.js on 'tests/fixtures/45454.json'
       reports min ≥ classLowerBound POST-FIX (was: min = 0 PRE-FIX).
```

## Bug Analysis

### Current Behavior (Defect)

What currently happens when the bug is triggered.

1.1 WHEN the input `X` contains a proctor `proc_i` whose Phase-2 (Hungarian) assignment yields `loadState[getProctorKey(proc_i, i)].guardCount = 0` AND `classBoundsByProctorKey[getProctorKey(proc_i, i)].classLowerBound ≥ 2` THEN `phase2_75CoverageRepair` enters its repair loop with `proc_i` in the uncovered set with deficit ≥ 2.

1.2 WHEN `phase2_75CoverageRepair` selects `proc_i` from the uncovered set and invokes `applyCoverageSwap` THEN at most ONE successful swap is performed per outer-loop iteration for that proctor: the swap moves exactly one slot from an over-loaded peer to `proc_i`, raising `getPrimaryLoad(loadState, key_i)` by exactly +1.

1.3 WHEN the outer fixed-point loop in `phase2_75CoverageRepair` iterates again after the first successful swap for `proc_i` THEN it does NOT prioritize re-attempting `proc_i` — it iterates over the (possibly re-collected) uncovered set in document order, and the loop's exit condition `MAX_ROUNDS` or "no swap possible this round" can fire before `proc_i` is revisited enough times to close the remaining deficit.

1.4 WHEN there is no other uncovered proctor whose deficit can be closed by a swap THEN the outer loop exits with `proc_i` still in the uncovered set, having received only +1 (or zero) of the +deficit slots needed to reach `classLowerBound`. The pass increments `diagnostics.coverageRepairUnresolved` and records no per-proctor reason for the failure.

1.5 WHEN the algorithm runs against `tests/fixtures/45454.json` (post-key-shape-unification) THEN the diagnostics report `coverageRepairSwaps = 17` and `coverageRepairUnresolved = 6`, with `min(loadState) = 0` (one proctor — idx=98 طارق الشعابتي, som=2270221, dutyCount=1 — at load=0) and a histogram of `{2: 56, 3: 90}` over the remaining 146 distinct proctors.

1.6 WHEN `getPrimaryLoad(loadState, getProctorKey(proc_i, i))` is read at the end of `phase2_75CoverageRepair` for the affected proctor `proc_i` (idx=98 طارق الشعابتي) THEN it returns `0`, strictly below `classBoundsByProctorKey[key_i].classLowerBound = 2`, violating the fairness invariant `min ≥ classLowerBound` that the closed spec `proctor-v2-fairness-undercovered-fix` published as a guarantee.

1.7 WHEN the test `tests/proctor-v2-fairness-undercovered-exploration.test.js` is executed against the post-key-shape-unification algorithm THEN it FAILS on the assertion `assert.ok(min >= lowerBound, ...)` with the diagnostic counterexample showing `min=0`, `lowerBound=2`, and the affected proctor identified as idx=98 طارق الشعابتي. This is a regression introduced by the unmasking of the present bug; pre-key-shape-fix, the same test passed because dual-identity hid the proctor's true load.

1.8 WHEN `scripts/inspect-fixture-state.js` is executed against the production fixture THEN it reports the histogram `{2: 56, 3: 90}`, `min: 0`, `distinct: 146` (one less than `proctorsList.length = 147`), and `zero-load proctors: 1` with the entry `idx=98 طارق الشعابتي (som=2270221, dutyCount=1)`. The diagnostic confirms exactly one proctor falls into the multi-step-deficit branch on the production fixture; the count `coverageRepairUnresolved = 6` reflects the repair pass's per-attempt counter rather than per-proctor counts.

1.9 WHEN the closed spec `proctor-v2-fairness-undercovered-fix` claimed `min ≥ classLowerBound` on every input and `proctor-v2-key-shape-unification` claimed truthful per-canonical-key load on the production fixture THEN both claims are simultaneously violated by the present bug: the repair pass cannot deliver the load required by the first spec's invariant for proctors with deficit ≥ 2, and the second spec's truthful-load semantics expose the gap directly.

1.10 WHEN the bug is triggered THEN it is confined to the body of `phase2_75CoverageRepair` in `js/algorithms/proctor-distribution-v2.js` (≈ line 2826). All callers of the function — the orchestrator at the Phase-2.75 invocation site, the diagnostics aggregator, and the persistence path — faithfully transmit the partially-repaired `loadState` without introducing additional corruption.

### Expected Behavior (Correct)

What should happen instead.

2.1 WHEN the input `X` contains any proctor `proc_i` whose Phase-2 output yields `getPrimaryLoad(loadState, getProctorKey(proc_i, i)) < classBoundsByProctorKey[getProctorKey(proc_i, i)].classLowerBound` THEN `phase2_75CoverageRepair'` SHALL attempt to repair `proc_i` by performing **as many successful swaps as needed** to bring `getPrimaryLoad(loadState, key_i)` up to `classBoundsByProctorKey[key_i].classLowerBound`, bounded above by the per-proctor target `classLowerBound − initialLoad`.

2.2 WHEN the post-fix repair pass cannot close a proctor's deficit (no over-loaded peer eligible to donate a slot in any reachable row that satisfies `applyCoverageSwap`'s existing eligibility predicates) THEN `phase2_75CoverageRepair'` SHALL record a structured warning entry under `diagnostics.coverageRepairWarnings[key_i]` with at minimum the fields `{ reason: 'no_eligible_donor', initialLoad, finalLoad, classLowerBound, attemptedSwaps }`, so that downstream tooling can identify the precise affected proctors and the precise reason without parsing logs.

2.3 WHEN a proctor's deficit is exactly 1 (the case the pre-fix pass already handled correctly) THEN the post-fix pass SHALL produce the same swap, the same final load, and the same diagnostics counter increments as the pre-fix pass for that proctor — i.e., the multi-step extension SHALL be observationally equivalent to the pre-fix behavior on deficit-1 inputs.

2.4 WHEN a proctor's deficit is ≥ 2 THEN the post-fix pass SHALL perform a sequence of swaps for that proctor in deterministic order, where each swap independently satisfies all existing `applyCoverageSwap` eligibility predicates (no row reuse, no duty-collision, no exemption-collision, no upper-bound violation for the donor, no lower-bound violation for the donor as enforced by `violatesHardConstraints` from spec `proctor-v2-fairness-undercovered-fix`).

2.5 WHEN the design phase of this spec selects the multi-step repair strategy THEN it SHALL choose exactly one of the three options enumerated in `.agent/proctor-v2-phase2-75-multi-step-repair.md` §"Suggested Approach for New Spec":

- **Option A — Inner repair loop**: per uncovered proctor, run the swap loop until they reach `classLowerBound` or no peer is found.
- **Option B — Iteration-order change**: keep the outer fixed-point loop but ensure the same uncovered proctor is re-targeted until they reach `classLowerBound`.
- **Option C — Donor selection broadening**: extend the donor-eligibility predicate to consider proctors at load = `classLowerBound` (when at upper bound) for second/third swaps.

The design SHALL document the chosen option with rationale, performance bound (target O(N · D · M) where N=proctors, D=max deficit ≤ 3 in practice, M=rows-per-search), and an explicit determinism contract.

2.6 WHEN the post-fix algorithm runs against `tests/fixtures/45454.json` THEN it SHALL produce a result `R_mem'` for which `min(histogramByCanonicalKey(R_mem')) ≥ classLowerBound = 2`, the proctor idx=98 طارق الشعابتي SHALL appear in `R_mem'.proctor_keys` with count ≥ 2 (or, if the deficit cannot be closed despite the multi-step extension, SHALL appear in `diagnostics.coverageRepairWarnings` with reason `'no_eligible_donor'`), and `diagnostics.coverageRepairUnresolved` SHALL equal `Object.keys(diagnostics.coverageRepairWarnings).length` (the per-proctor warning count, not the per-attempt failure count).

2.7 WHEN the post-fix algorithm runs and at least one proctor has deficit ≥ 2 THEN the `diagnostics.coverageRepairSwaps` counter SHALL increment once per successful swap (preserving its existing semantics of "successful swap count, not successful repaired-proctor count"), and the new `diagnostics.coverageRepairWarnings` map SHALL be additive (zero entries on inputs where every uncovered proctor was successfully repaired).

2.8 WHEN the design phase enumerates change sites THEN it SHALL include at minimum: (a) the inner loop introduction (Option A) or the iteration-control change (Option B) or the donor-eligibility extension (Option C) inside `phase2_75CoverageRepair`; (b) the addition of `diagnostics.coverageRepairWarnings` to the diagnostics object (additive, no removal of any existing field); (c) the determinism guarantee — the per-proctor multi-swap loop SHALL iterate uncovered proctors in the same canonical order as the pre-fix pass, and within each proctor SHALL iterate rows/slots in the same canonical order, so that the post-fix pass produces identical output to the pre-fix pass on every deficit-1-only input.

2.9 WHEN the swap candidate is being evaluated for the second (or third) swap in a sequence for the same uncovered proctor THEN the post-fix pass SHALL re-evaluate `applyCoverageSwap`'s eligibility predicates against the current `loadState` (which reflects the prior successful swaps for the same proctor in the same pass), and SHALL NOT cache stale eligibility decisions from the start of the pass.

2.10 WHEN any over-loaded peer's load drops below `classUpperBound` (or below `classLowerBound + 1`, depending on the donor-eligibility rule chosen) as a result of donating to the multi-step repair THEN that peer SHALL be excluded from the donor pool for subsequent swaps in the same pass, preserving the existing single-swap pass's invariant that no donor is taken below `classLowerBound`.

2.11 WHEN the fix is applied THEN it SHALL be confined to `phase2_75CoverageRepair` and to the test files that lock the post-fix invariants. NO changes to `collectUncovered`, `applyCoverageSwap`'s eligibility body (only its call-site loop), `violatesHardConstraints`, `getProctorKey`, `getProctorExemptionKey`, the duty pre-pass, `phase2Build`, `phase2_5PopulateReserves`, `applyReserveSwap`, `phase3Optimize`, or any other function shall be introduced by this spec. NO DB schema changes, NO IPC contract changes, NO display-layer changes.

2.12 WHEN the design phase is complete THEN it SHALL specify the new test files that lock the post-fix invariants. At minimum these SHALL include: (i) a multi-step-deficit unit test asserting that for a synthetic input with a single proctor at deficit=2, the post-fix pass performs exactly 2 successful swaps and reaches `classLowerBound`; (ii) a regression lock on `tests/fixtures/45454.json` asserting `min(loadState') ≥ classLowerBound = 2` and the absence of طارق الشعابتي from the zero-load set; (iii) an updated assertion in `tests/proctor-v2-fairness-undercovered-exploration.test.js` flipping the test from FAIL to PASS post-fix; (iv) a determinism property test running the algorithm twice on the same input and asserting byte-equality of `R_mem'.proctor_keys`.

2.13 WHEN the design phase considers the donor-selection rule for multi-step repair THEN it SHALL document the exact predicate used for "is X an eligible donor for a second/third swap to the same recipient" and SHALL ensure that the predicate respects the lower-bound check from `violatesHardConstraints` (closed spec `proctor-v2-fairness-undercovered-fix`'s task 4.6) — no donor SHALL be reduced below their own `classLowerBound` by any swap in the multi-step sequence.

### Unchanged Behavior (Regression Prevention)

Existing behavior that must be preserved.

3.1 WHEN any test in `tests/proctor-v2-*.test.js` is executed against the post-fix algorithm THEN it SHALL CONTINUE TO pass with no new failures and no new warnings, including (but not limited to): `proctor-v2-property-4-save-stability.test.js`, `proctor-v2-property-p5-eligibility.test.js`, `proctor-v2-property-p4-percent.test.js`, `proctor-v2-strict-bug-c2-uncovered.test.js`, `proctor-v2-bug-c1-fairness.test.js`, `proctor-v2-bug-c2-duty.test.js`, `proctor-v2-strict-bug-c1-fairness.test.js`, `proctor-v2-session-notes-integration.test.js`, `proctor-v2-slot-metric-add-guard-load.test.js`, `proctor-v2-slot-metric-reserve-sort.test.js`, `proctor-v2-key-shape-bug-exploration.test.js`, `proctor-v2-no-ghost-keys.test.js`, `proctor-v2-key-shape-unity.test.js`, `proctor-v2-key-adapter-unit.test.js`, `proctor-v2-all-cin-preservation.test.js`, `proctor-v2-fairness-undercovered-collect-unit.test.js`, `proctor-v2-fairness-undercovered-preservation.test.js`.

3.2 WHEN any test in `tests/inv-h5-*.test.js` is executed against the post-fix algorithm THEN it SHALL CONTINUE TO pass, including `tests/inv-h5-cross-page-consistency.test.js` and any associated checklist-driven assertions.

3.3 WHEN `tests/preservation-config-roundtrip.pbt.test.js` is executed against the post-fix code THEN it SHALL CONTINUE TO pass for every config key (including `examAutoDistributionData` and the 12 other keys), with the round-trip property preserved.

3.4 WHEN `scripts/verify-fixture.js` is executed against the post-fix algorithm on `tests/fixtures/45454.json` THEN it SHALL report P1/P2/P3 PASS, with the additional truthful guarantee that `min ≥ classLowerBound` (where pre-fix it reported `min = 0` despite reporting `max ≤ classUpperBound` correctly).

3.5 WHEN `scripts/verify-real-centre.js` is executed against the post-fix algorithm THEN it SHALL CONTINUE TO report P1/P2/P3 PASS on the real-centre fixture.

3.6 WHEN the input `X` contains no proctor with deficit ≥ 2 (every uncovered proctor, if any, has deficit exactly 1) THEN the post-fix algorithm SHALL produce a result observationally identical to the pre-fix algorithm for that input — same `proctor_keys`, same `reserve_keys`, same `loadState`, same `diagnostics.coverageRepairSwaps` count, same per-row metadata. The new `diagnostics.coverageRepairWarnings` map SHALL be present-and-empty (`{}`) on these inputs.

3.7 WHEN the input `X` contains no uncovered proctor at all (every proctor has `getPrimaryLoad ≥ classLowerBound` after Phase 2) THEN the post-fix algorithm SHALL produce a result byte-identical to the pre-fix algorithm — `phase2_75CoverageRepair` enters its main loop, the uncovered set is empty, no swaps are attempted, `diagnostics.coverageRepairSwaps = 0`, `diagnostics.coverageRepairUnresolved = 0`, `diagnostics.coverageRepairWarnings = {}`.

3.8 WHEN the closed spec `proctor-v2-fairness-undercovered-fix` (closed 2026-05-16) is re-validated against the post-fix algorithm THEN every guarantee it published — the `collectUncovered` predicate, the `violatesHardConstraints` lower-bound check, the P1/P2/P3 properties on the real-centre fixture — SHALL CONTINUE TO hold. This bugfix's effect on that spec is to RESTORE the truth of its `min ≥ classLowerBound` invariant on inputs where deficit ≥ 2 (which the closed spec's tests did not cover but the present production fixture exhibits).

3.9 WHEN the closed spec `proctor-distribution-db-memory-mismatch` (closed 2026-05-16) is re-validated against the post-fix algorithm THEN its display-layer fix in `exams-rooms.html`, the `await`-on-auto-save in `exams-proctors.html`, the `js/data/proctor-key-resolver.js` helper, and its histogram-round-trip property SHALL CONTINUE TO hold. The display layer continues to aggregate by `proctor_keys`, and the multi-step-repair fix only changes the count of successful swaps under canonical keys — it does not change the SHAPE of those keys.

3.10 WHEN the closed spec `proctor-v2-key-shape-unification` (closed 2026-05-16) is re-validated against the post-fix algorithm THEN its `buildKeyAdapter` / `toCanonicalKey` helpers, the canonical-shape closure invariant on `proctor_keys ∪ reserve_keys ∪ loadState`, and the absence of the 6 ghost CIN keys on the production fixture SHALL CONTINUE TO hold. The multi-step-repair fix operates on canonical-shape keys throughout — it does not introduce any new key-shape boundary.

3.11 WHEN `npm run lint` is executed after the fix THEN it SHALL CONTINUE TO produce zero new errors and zero new warnings relative to the closing state of `proctor-v2-key-shape-unification`.

3.12 WHEN `npm test` is executed after the fix THEN every previously-passing test SHALL CONTINUE TO pass, and the test `tests/proctor-v2-fairness-undercovered-exploration.test.js` (currently FAILING on the post-key-shape-unification codebase) SHALL now PASS deterministically.

3.13 WHEN `main/db/migrations.js` is inspected after the fix THEN the database schema SHALL CONTINUE TO be unchanged (no new migration introduced by this spec).

3.14 WHEN `main/ipc/exam-config-data.js` is inspected after the fix THEN its IPC contract for `examConfigData:save` and `examConfigData:get` SHALL CONTINUE TO be unchanged (no parameter, return-shape, or auth-policy changes introduced by this spec).

3.15 WHEN previously-saved DB rows for `examAutoDistributionData` (rows persisted under the partially-repaired pre-fix algorithm and therefore containing one zero-load proctor on the production fixture) are loaded by `exams-rooms.html` after the fix THEN the load path SHALL CONTINUE TO render those rows without error. The display-layer resolver from spec `proctor-distribution-db-memory-mismatch` MAY still resolve the missing proctor's row gracefully. This spec does NOT mandate a silent rewrite of legacy DB rows; the user must re-run distribution to obtain a post-fix `examAutoDistributionData` payload. (Any active normalization MUST be specified explicitly in `design.md` if introduced.)

3.16 WHEN any input `X` for which `NOT isBugCondition(X)` (no proctor has deficit ≥ 2 after Phase 2, OR `coverageRepairUnresolved = 0` on the pre-fix algorithm) is run through the post-fix algorithm THEN `V2'(X)` SHALL equal `V2(X)` modulo only the additive `diagnostics.coverageRepairWarnings: {}` field. In particular, `proctor_keys`, `reserve_keys`, the assignments graph, all swap moves, all per-row metadata, and `diagnostics.coverageRepairSwaps` SHALL be observationally equivalent.

3.17 WHEN the multi-step repair algorithm runs THEN it SHALL maintain the existing per-proctor iteration order from `collectUncovered` (which iterates `proctorsList` in document order) and the existing per-row iteration order from `applyCoverageSwap`'s candidate search. Determinism is required: same input, same RNG seed (where applicable), same output bytes — both `R_mem'.proctor_keys` and `R_mem'.diagnostics.coverageRepairSwaps` count.

3.18 WHEN the post-fix pass runs on inputs where `classLowerBound = 0` for some proctor THEN that proctor SHALL be excluded from the uncovered set by `collectUncovered`'s existing degenerate-boundary handling (closed spec `proctor-v2-fairness-undercovered-fix`'s edge case 8), and the multi-step extension SHALL never attempt to repair them. This preserves the closed spec's documented intentional change at the degenerate boundary.
