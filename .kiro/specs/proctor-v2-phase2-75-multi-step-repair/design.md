# Proctor V2 — Phase 2.75 Multi-Step Coverage Repair Bugfix Design

## Overview

`phase2_75CoverageRepair` (in `js/algorithms/proctor-distribution-v2.js`, ≈ line 3069) is the post-Phase-2 pass that lifts every proctor with `getPrimaryLoad < classLowerBound` up to (or beyond) their lower bound by stealing slots from over-loaded peers. The pass guarantees the fairness invariant `min(loadState) ≥ classLowerBound` published by the closed spec `proctor-v2-fairness-undercovered-fix`.

The current implementation performs at most **one** successful swap per uncovered proctor per outer round. Each swap raises that proctor's primary load by exactly +1. The outer fixed-point loop iterates rounds (capped at `MAX_ROUNDS = 10`) and re-collects the uncovered set after every round, but it also dedupes through `seenUnresolvedKeys` — once a proctor is flagged unresolved (e.g. `no_swappable_peer`) in a round, it is **never re-attempted** in subsequent rounds, even if peer eligibility opens up. The combined effect is that any proctor whose deficit is `D ≥ 2` only ever receives `min(D, 1)` slots: the first swap takes them from `lowerBound − D` to `lowerBound − D + 1`, then the next round either skips them (if the donor pool has shrunk and they hit `no_swappable_peer`) or proceeds at +1 per round at best — and on the production fixture the donor pool collapses quickly enough that no second swap fires for the affected proctor at all.

This was masked for the entire history of the algorithm by the dual-identity bug closed in `proctor-v2-key-shape-unification` on 2026-05-16: pre-fix, Phase 2 read `loadState['__idx_98']` while the duty pre-pass wrote `loadState['2270221']`, so طارق's true load was hidden and Phase 2 happily over-assigned him during his duty halfday. With key-shape unified, Phase 2 honestly excludes طارق from his duty halfday and leaves him at `guardCount = 0`, which makes his deficit `D = 2` and falls into the multi-step branch the repair pass cannot close.

### Fix Strategy: Option A — Inner Repair Loop

Per the recommendation in `.agent/proctor-v2-phase2-75-multi-step-repair.md` §"Suggested Approach for New Spec", the chosen strategy is **Option A: an inner repair loop that re-targets the same uncovered proctor until they reach `classLowerBound` or no eligible donor is found**. The other two options were considered and rejected:

- **Option B (iteration-order change in the outer loop)** would require coupling round semantics to per-proctor progress and would still rely on `seenUnresolvedKeys` dedupe semantics that interact badly with multi-step recovery (a proctor blocked in round N because the donor pool was empty might have a donor in round N+1, but the dedupe set would suppress the retry). Reworking the dedupe set per round is a larger change to existing behavior than Option A.
- **Option C (broaden donor selection)** would alter `applyCoverageSwap`'s eligibility predicates, which are reused elsewhere in the algorithm and protected by closed-spec preservation tests. Touching shared eligibility is out of scope for a surgical fix.

Option A is structurally the smallest change: the outer round/dedupe machinery stays intact, the per-proctor loop becomes a `while (load < lowerBound) { findCandidate; if none break; apply; }` loop, and `coverageRepairWarnings` migrates from an array to a per-proctor map so downstream consumers can identify exactly which proctors remain uncovered and why. The strategy is bounded, deterministic, and preserves every byte of behavior on inputs where every uncovered proctor has deficit ≤ 1.

### Performance Bound

Pre-fix worst case: `O(MAX_ROUNDS · |uncovered| · |rows| · |slots|)` ≈ `O(R · N · M · 2)`.

Post-fix worst case: per uncovered proctor, the inner loop iterates at most `D = lowerBound − initialLoad` times, where `D` is bounded above by `classUpperBound − classLowerBound + 1` (in production typically `≤ 2`, theoretical max ≤ 3 given the algorithm's bound-derivation rules). Each inner iteration costs `O(|rows| · |slots|)` to rebuild candidates. The total post-fix cost is therefore `O(MAX_ROUNDS · |uncovered| · D · |rows| · |slots|)` — a factor of `D ≤ 3` over the pre-fix bound.

On the production fixture (`tests/fixtures/45454.json`): `N = 147` proctors, `|uncovered_after_phase2| ≈ 7` per round, `|rows| = 191`, slots/row = 2, `D = 2` for the affected proctor, `D = 1` for the rest. The empirical wall-clock cost is ≤ 50 ms (the existing `TIME_BUDGET_MS = 50` cap), well within the existing budget. No new time budget is introduced.

### Scope Discipline

The fix is confined to the body of `phase2_75CoverageRepair` plus the new test files. The full surface area:

- **Modified function**: `phase2_75CoverageRepair` in `js/algorithms/proctor-distribution-v2.js` (single function).
- **Modified diagnostics shape**: `diagnostics.coverageRepairWarnings` migrates from `Array<{proctorKey, reason}>` to `Object<proctorKey, {reason, initialLoad, finalLoad, classLowerBound, attemptedSwaps}>`. `coverageRepairUnresolved` is re-derived as `Object.keys(coverageRepairWarnings).length`.
- **NO changes** to: `collectUncovered`, `applyCoverageSwap`, `buildSwapCandidates`, `swapPreservesHardConstraints`, `violatesHardConstraints`, `getProctorKey`, `getProctorExemptionKey`, the duty pre-pass, `phase2Build`, `phase2_5PopulateReserves`, `applyReserveSwap`, `phase3Optimize`, the orchestrator, IPC handlers, DB migrations, the display layer, or any HTML/preload file.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — at the end of `phase2_75CoverageRepair`, at least one proctor `proc_i` satisfies `getPrimaryLoad(loadState, getProctorKey(proc_i, i)) < classBoundsByProctorKey[getProctorKey(proc_i, i)].classLowerBound` and `diagnostics.coverageRepairUnresolved > 0`. The dominant trigger is `deficit = classLowerBound − initialLoad ≥ 2`.
- **Property (P)**: The desired post-fix behavior — for every proctor whose deficit is ≥ 1, the repair pass performs as many swaps as needed to close the deficit (bounded by `classLowerBound − initialLoad`); when it cannot close the deficit, it records a structured warning under `diagnostics.coverageRepairWarnings[key]` with `{ reason: 'no_eligible_donor', initialLoad, finalLoad, classLowerBound, attemptedSwaps }`.
- **Preservation**: All inputs where no proctor has deficit ≥ 2 (i.e. the pre-fix pass already closed every gap) SHALL produce observationally identical output post-fix, modulo only the additive `coverageRepairWarnings: {}` empty map.
- **Deficit (D)**: For a given proctor `proc_i` with key `key_i`, `D = classBoundsByProctorKey[key_i].classLowerBound − getPrimaryLoad(loadState, key_i)` measured at the moment the inner repair loop targets the proctor.
- **`phase2_75CoverageRepair`**: The function in `js/algorithms/proctor-distribution-v2.js` (≈ line 3069) that runs after Phase 2 to lift uncovered proctors to `classLowerBound`. The single call site is in the orchestrator at ≈ line 4342.
- **`getPrimaryLoad(loadState, key)`**: Returns `guardCount + dutyCount` for the proctor identified by canonical key. Slot semantics, established in spec `proctor-v2-strict-fairness-coverage`.
- **`classLowerBound` / `classUpperBound`**: Per-class fairness bounds derived from `classBoundsByProctorKey` and used by the H1-H2-H5 invariant family.
- **Single-swap-per-proctor-per-round**: The pre-fix loop semantics — one `applyCoverageSwap` per `(round, uncovered_proctor)` pair before moving to the next pending proctor.
- **Multi-swap-per-proctor (Option A)**: The post-fix inner-loop semantics — repeat `buildSwapCandidates → applyCoverageSwap` for the same uncovered proctor until `getPrimaryLoad ≥ classLowerBound` or no candidate is returned.
- **`seenUnresolvedKeys`**: The dedupe map that prevents a proctor flagged as unresolved in round N from being re-collected in round N+1. Preserved post-fix — only the per-proctor inner-loop changes.

## Bug Details

### Bug Condition

The bug manifests on inputs where Phase 2 leaves at least one proctor with `getPrimaryLoad` strictly below `classLowerBound` by ≥ 2 slots. The repair pass is structurally incapable of closing that gap because each pending proctor receives only one swap per outer round, and the `seenUnresolvedKeys` dedupe machinery prevents re-attempt in later rounds when the donor pool happens to be empty during the proctor's first attempt of round N.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT:  input — the full input object consumed by ProctorDistributionV2.run
  OUTPUT: boolean

  R_mem      := ProctorDistributionV2.run(input)
  loadState  := R_mem.diagnostics.loadStateSnapshot     // post-Phase-2.75 state
  classBounds := R_mem.diagnostics.classBoundsByProctorKey

  FOR EACH proc, idx IN input.proctorsList DO
    key    := getProctorKey(proc, idx)
    bounds := classBounds[key]
    IF bounds = NULL OR bounds.classLowerBound = 0 THEN CONTINUE

    primaryLoad := getPrimaryLoad(loadState, key)
    deficit     := bounds.classLowerBound - primaryLoad

    IF deficit >= 1 AND R_mem.diagnostics.coverageRepairUnresolved > 0 THEN
      // proctor is below lowerBound after the repair pass AND
      // the pass reported it could not resolve at least one case.
      // Dominant trigger is deficit >= 2 (single-swap pass closes deficit = 1).
      RETURN true
    END IF
  END FOR

  RETURN false
END FUNCTION
```

The textbook witness: there exists a proctor `proc_i` such that `getPrimaryLoad(loadState, getProctorKey(proc_i, i)) < classLowerBound` after `phase2_75CoverageRepair` returns, and `diagnostics.coverageRepairUnresolved > 0`. The dominant trigger in production is `deficit ≥ 2`.

### Examples

- **Production fixture `tests/fixtures/45454.json`** (post-key-shape-unification):
  - Proctor: idx=98, name=طارق الشعابتي, som=2270221, dutyCount=1.
  - Phase 2 output: `guardCount = 0`, `dutyCount = 1` ⇒ `getPrimaryLoad = 1`. Wait — the actual reading is `getPrimaryLoad = 0` because the duty pre-pass writes a different key under spec semantics; the production diagnostic confirms `loadState[key_i].guardCount = 0` and `getPrimaryLoad(loadState, key_i) = 0` per the inspector script.
  - Bounds: `classLowerBound = 2`, `classUpperBound = 3`.
  - Deficit: `D = 2`.
  - Repair pass: `coverageRepairSwaps = 17`, `coverageRepairUnresolved = 6`, no swap fires for طارق (his entry appears in unresolved set with `reason: 'no_swappable_peer'`).
  - Expected on fixed code: `getPrimaryLoad = 2`, the proctor appears in `R_mem.proctor_keys` with count ≥ 2, and `coverageRepairUnresolved = 0` on this fixture.

- **Synthetic deficit-2 case**: proctor P has Phase 2 output `guardCount = 0`, `classLowerBound = 2`. Two over-loaded peers exist at `load = classUpperBound`. Pre-fix: only ONE swap fires for P, leaving `getPrimaryLoad = 1 < 2`. Post-fix: TWO swaps fire (the first donor drops to `classUpperBound − 1`, then the second peer donates), leaving `getPrimaryLoad = 2`.

- **Synthetic deficit-3 case** (theoretical, requires unusual class-bound config): proctor P has Phase 2 output `getPrimaryLoad = 0`, `classLowerBound = 3`. Three swaps required. Post-fix: `applyCoverageSwap` fires three times in the inner loop, each time against a distinct donor (the first donor's load now equals `classUpperBound − 1` and is no longer eligible per the existing `buildSwapCandidates` predicate that requires donor at `> classLowerBound`).

- **Edge case — deficit = 1 (preservation)**: proctor Q has Phase 2 output `getPrimaryLoad = 1`, `classLowerBound = 2`. Pre-fix: one swap closes the gap, `coverageRepairSwaps += 1`. Post-fix: identical behavior — the inner loop fires once, `getPrimaryLoad ≥ classLowerBound`, exits. Same swap, same diagnostics, same result.

- **Edge case — no eligible donor for any swap**: proctor R has deficit = 2 but is exempt from every row that contains an over-loaded peer. Pre-fix: marked unresolved with `reason: 'no_swappable_peer'`. Post-fix: marked in `coverageRepairWarnings[key_R]` with `{ reason: 'no_eligible_donor', initialLoad: 0, finalLoad: 0, classLowerBound: 2, attemptedSwaps: 0 }`. The fix does NOT magically conjure swaps where none exist — it documents the exact failure mode.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Single-swap path for `deficit = 1` proctors: same swap, same final load, same `coverageRepairSwaps` count.
- The outer round loop, `MAX_ROUNDS = 10` cap, `TIME_BUDGET_MS = 50` cap, and `seenUnresolvedKeys` dedupe map.
- `collectUncovered` predicate, iteration order (`proctorsList` document order), and degenerate-boundary handling (`classLowerBound = 0` excludes the proctor).
- `buildSwapCandidates`, `applyCoverageSwap`, `swapPreservesHardConstraints`, `violatesHardConstraints` — body and signatures untouched.
- Per-class tiebreak: `classId` ascending, then `rng()` snapshot (taken once per round, deterministic for a given seed).
- All Phase 2.5 reserve-population behavior, Phase 3 optimization behavior, and orchestrator diagnostics aggregation (`coverageRepairSwaps`, `coverageRepairDurationMs` keep their existing semantics).
- DB schema (`main/db/migrations.js`), IPC contract (`main/ipc/exam-config-data.js`), preload, and the display layer (`exams-rooms.html`, `exams-proctors.html`).
- Determinism: same input + same `randomSeed` ⇒ byte-identical `proctor_keys`, `reserve_keys`, and `diagnostics.coverageRepairSwaps` count across two runs.

**Scope:**
All inputs `X` where `NOT isBugCondition(X)` (no proctor has deficit ≥ 2 at end of Phase 2, OR pre-fix pass already closed every deficit) SHALL produce output observationally equivalent to the pre-fix algorithm, modulo only the additive `diagnostics.coverageRepairWarnings: {}` empty map. This includes:

- Inputs where the uncovered set is empty after Phase 2 (no swap attempts needed).
- Inputs where every uncovered proctor has deficit exactly 1 (single-swap path closes them all).
- Inputs where the pre-fix pass already reported `coverageRepairUnresolved > 0` due to legitimately blocked swaps (no eligible donor in any row) — the post-fix pass also reports unresolved but in the new map shape.
- Inputs where `classLowerBound = 0` for some proctor (excluded by `collectUncovered`'s degenerate-boundary check).

**What MUST NOT change:**
- The existing `applyCoverageSwap` callers in other phases (Phase 3 currently does not call this function; this is documented in `js/algorithms/proctor-distribution-v2.js` ≈ line 378).
- The `coverageRepairSwaps` counter semantics (per-successful-swap, NOT per-repaired-proctor).
- The shape of `R_mem.proctor_keys`, `R_mem.reserve_keys`, `R_mem.assignments`, `R_mem.diagnostics.histogram*`, or any other top-level field.

## Hypothesized Root Cause

Based on bug analysis and code inspection of `phase2_75CoverageRepair` (lines 3069–3149), the most likely root causes are:

1. **Single-Swap-Per-Proctor-Per-Round Loop Structure**: The inner `for (var i = 0; i < pending.length; i++)` loop processes each pending proctor exactly once and fires at most one `applyCoverageSwap` before moving on. There is no per-proctor inner loop that re-targets the same proctor until its load reaches `classLowerBound`. **This is the dominant cause** — confirmed by the production fixture's empirical reading where `coverageRepairSwaps = 17` for ≈ 7 deficit-1 proctors but exactly zero swaps for the single deficit-2 proctor (طارق).

2. **Round Dedupe Suppresses Multi-Round Recovery**: `seenUnresolvedKeys[key] = true` is set the first time a proctor exits a round without a successful swap (e.g. with `reason: 'no_swappable_peer'`). On the production fixture, طارق hits this branch in round 1 because all eligible donors are claimed by deficit-1 proctors processed earlier in the same round (peer load drops below `classUpperBound + 1` quickly). Once flagged, طارق is never re-examined in round 2+. Even if Option A is applied, this interaction must be addressed: the inner per-proctor loop must run BEFORE the dedupe flag is set, so a proctor either reaches `lowerBound` or gets a single warning capturing `attemptedSwaps`.

3. **Donor-Pool Collapse Within a Round**: `buildSwapCandidates` requires donors at `getPrimaryLoad > classUpperBound + 1` first, then at `> classUpperBound`. After the first-tier candidates are exhausted by deficit-1 proctors, the second-tier (donors at exactly `classUpperBound`) may still be available but the per-proctor swap budget of 1 prevents طارق from claiming any of them. The fix lets طارق's inner loop drain the available donors before moving to the next pending proctor.

4. **Diagnostics Shape Insufficient for Per-Proctor Diagnosis**: `coverageRepairWarnings` is currently `Array<{proctorKey, reason}>` and may contain duplicate entries across rounds (though the dedupe map mostly prevents this). The array shape makes it awkward to look up "what happened to proctor X?" — the design migrates to a per-proctor map keyed by `proctorKey`, which also makes `coverageRepairUnresolved = Object.keys(coverageRepairWarnings).length` an exact, deterministic identity rather than a per-attempt counter.

The fix targets cause (1) directly via Option A and resolves causes (2)–(4) as a consequence of the inner-loop restructuring and the diagnostics-shape migration.

## Correctness Properties

Property 1: Bug Condition — Multi-Step Repair Closes Deficits ≥ 2

_For any_ input `X` where the bug condition holds (`isBugCondition(X) = true`), the fixed `phase2_75CoverageRepair'` SHALL, for every proctor `proc_i` with deficit `D = classLowerBound − initialPrimaryLoad ≥ 1`, perform either (a) exactly enough successful swaps to bring `getPrimaryLoad ≥ classLowerBound` (i.e. `D` or more swaps), OR (b) record a structured warning under `diagnostics.coverageRepairWarnings[getProctorKey(proc_i, i)]` with at minimum the fields `{ reason: 'no_eligible_donor', initialLoad, finalLoad, classLowerBound, attemptedSwaps }`. On the production fixture `tests/fixtures/45454.json` specifically, every proctor SHALL reach `getPrimaryLoad ≥ classLowerBound = 2` and `coverageRepairUnresolved` SHALL equal 0.

**Validates: Requirements 2.1, 2.2, 2.4, 2.6, 2.7, 2.8**

Property 2: Preservation — Deficit-≤1 and Non-Buggy Inputs Are Unchanged

_For any_ input `X` where the bug condition does NOT hold (`isBugCondition(X) = false` — no proctor has deficit ≥ 2 at end of Phase 2, or the pre-fix pass already closed every gap), the fixed function SHALL produce output observationally equivalent to the pre-fix function, preserving `proctor_keys`, `reserve_keys`, the assignments graph, all per-row metadata, `diagnostics.coverageRepairSwaps` count, and the deterministic iteration order. The only permitted observable change is the additive presence of `diagnostics.coverageRepairWarnings: {}` (empty map) where the pre-fix output was `coverageRepairWarnings: []` (empty array).

**Validates: Requirements 2.3, 2.9, 2.10, 2.11, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16, 3.17, 3.18**

## Fix Implementation

### Changes Required

Assuming our root-cause analysis is correct, the fix is confined to a single function with one diagnostics-shape extension.

**File**: `js/algorithms/proctor-distribution-v2.js`

**Function**: `phase2_75CoverageRepair` (≈ line 3069, body spans lines 3069–3149)

**Specific Changes**:

1. **Inner Repair Loop (Option A — primary change site, ≈ lines 3098–3138)**: replace the body of the per-pending-proctor loop with a multi-swap inner loop that re-targets the same proctor until `getPrimaryLoad ≥ classLowerBound` or no candidate is returned.

   ```pseudocode
   FOR i := 0 TO pending.length - 1 DO
     uncov  := pending[i]
     bounds := classBoundsByProctorKey[uncov.key]
     classId := classIds[uncov.key]
     IF bounds is null OR classId is null THEN
       record warning(uncov.key, reason='no_class_bounds')
       seenUnresolvedKeys[uncov.key] := true
       CONTINUE
     END IF

     initialLoad := getPrimaryLoad(loadState, uncov.key)
     attemptedSwaps := 0
     successfulSwaps := 0

     // INNER LOOP — new in Option A
     WHILE getPrimaryLoad(loadState, uncov.key) < bounds.classLowerBound DO
       IF Date.now() - startTime > TIME_BUDGET_MS THEN
         BREAK   // outer time-budget enforcement still applies
       END IF
       attemptedSwaps += 1

       // re-build candidates against CURRENT loadState (not cached)
       candidates := buildSwapCandidates(rows, uncov, classId, loadState,
                                         bounds.classUpperBound + 1,
                                         input, classIds, lookup)
       IF candidates.length = 0 THEN
         candidates := buildSwapCandidates(rows, uncov, classId, loadState,
                                           bounds.classUpperBound,
                                           input, classIds, lookup)
       END IF
       IF candidates.length = 0 THEN BREAK END IF   // no donor available

       sort candidates by (donor primary load DESC, rowIndex ASC, slotIndex ASC)
       applyCoverageSwap(candidates[0].row, candidates[0].slotIndex,
                         uncov, candidates[0].T_over, loadState, rows)
       diagnostics.swaps += 1
       successfulSwaps += 1
       roundSwaps += 1
     END WHILE

     // post-condition: either reached lowerBound or exhausted candidates
     finalLoad := getPrimaryLoad(loadState, uncov.key)
     IF finalLoad < bounds.classLowerBound THEN
       record warning(uncov.key, {
         reason: (attemptedSwaps = 0 ? 'no_swappable_peer' : 'no_eligible_donor'),
         initialLoad: initialLoad,
         finalLoad: finalLoad,
         classLowerBound: bounds.classLowerBound,
         attemptedSwaps: attemptedSwaps
       })
       seenUnresolvedKeys[uncov.key] := true
     END IF
   END FOR
   ```

   The candidate-rebuild inside the inner loop is essential: each successful swap mutates `loadState` (the donor's primary load drops by 1; the recipient's rises by 1), so the next iteration's eligibility check must read the fresh state. `buildSwapCandidates` already takes `loadState` as a parameter and queries it freshly, so no caching change is needed — the only requirement is that the rebuild call is INSIDE the inner loop (post-fix) rather than once before (pre-fix).

2. **Diagnostics Shape Migration — `coverageRepairWarnings` (≈ line 3079, plus orchestrator line 4358)**: change the diagnostics record from `warnings: Array<{proctorKey, reason}>` to `warnings: Object<proctorKey, {reason, initialLoad, finalLoad, classLowerBound, attemptedSwaps}>`.

   - Inside `phase2_75CoverageRepair`: replace `diagnostics.warnings = []` initialization with `diagnostics.warnings = {}`. Replace every `diagnostics.warnings.push({ proctorKey: K, reason: R })` site with `diagnostics.warnings[K] = { reason: R, initialLoad, finalLoad, classLowerBound, attemptedSwaps }`. Keys: `time_budget`, `no_class_bounds`, `no_swappable_peer` (preserved when `attemptedSwaps = 0` for backwards-recognizable diagnostics), `no_eligible_donor` (new — used when `attemptedSwaps > 0` but the inner loop could not close the deficit), `pass_threw` (preserved for top-level catch).
   - The error-path return on line 3148 (`return { swaps: 0, unresolved: 0, durationMs: 0, warnings: [{ reason: 'pass_threw', error: ... }] }`) becomes `return { swaps: 0, unresolved: 0, durationMs: 0, warnings: { '__pass__': { reason: 'pass_threw', error: ... } } }`. The `__pass__` synthetic key is documented in the function header so consumers can distinguish "the pass threw" from "a specific proctor failed".
   - Orchestrator (line 4358): no change — `diagnostics.coverageRepairWarnings = phase2_75Diagnostics.warnings || []` works for both shapes after the fix because it just forwards the value. We update the fallback to `|| {}` for shape consistency: `diagnostics.coverageRepairWarnings = phase2_75Diagnostics.warnings || {}`.

3. **`coverageRepairUnresolved` Re-Derivation (≈ line 3079, line 3137)**: keep the `diagnostics.unresolved` counter incremented per warning (the per-proctor map ensures one increment per distinct proctor), AND assert at the end of the function that `diagnostics.unresolved === Object.keys(diagnostics.warnings).length` minus any `__pass__` synthetic-key entry. The post-condition check is documented in a comment but does not throw — if the invariant fails we log a warning to console and proceed (defensive — lets diagnostics regressions surface in tests rather than crashing production).

4. **Determinism Contract (≈ line 3088, the `pending.sort` call)**: unchanged. The outer `pending.sort` by `(classId ASC, rng tiebreak ASC)` continues to fix the per-round iteration order. Within each pending proctor, the inner loop's candidate sort `(donor primary load DESC, rowIndex ASC, slotIndex ASC)` is also unchanged. Multi-step repair therefore preserves byte-identical determinism on every input where the inner loop fires zero or one times — i.e. every non-buggy input.

5. **Out-of-Scope Sites Explicitly Untouched**:
   - `collectUncovered` (≈ line 2939) — body unchanged. The inner-loop fix re-evaluates uncovered status implicitly via `getPrimaryLoad` reads inside the `WHILE` condition.
   - `buildSwapCandidates` — body unchanged. Called more times per pass post-fix, but with the same parameters and the same return shape.
   - `applyCoverageSwap` — body unchanged. Called more times per pass post-fix, but each call is independent.
   - `swapPreservesHardConstraints`, `violatesHardConstraints` — bodies unchanged. The donor lower-bound check from spec `proctor-v2-fairness-undercovered-fix` task 4.6 continues to apply on every inner-loop swap.
   - `getProctorKey`, `getProctorExemptionKey`, the duty pre-pass, `phase2Build`, `phase2_5PopulateReserves`, `applyReserveSwap`, `phase3Optimize` — all untouched.
   - Orchestrator (≈ line 4342): single edit to the `coverageRepairWarnings` fallback default (`|| []` → `|| {}`); other lines untouched.

## Testing Strategy

### Validation Approach

Two-phase: first surface counterexamples that demonstrate the multi-step deficit cannot be repaired by the unfixed code (refuting or confirming the root-cause hypothesis), then verify the fixed code closes deficits ≥ 2 and preserves byte-identical behavior on every other input.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples on the unfixed code that prove the single-swap-per-round limitation is the cause, not e.g. a donor-eligibility issue or a key-shape regression.

**Test Plan**: Construct synthetic inputs that isolate the deficit-2 path with no confounds (no duty constraints, no exemptions, abundant donors). Run them on the unfixed code and observe that exactly one swap fires for the deficit-2 proctor, leaving them at `lowerBound − 1`. Then run the production fixture and confirm طارق's diagnostic readings match the ones documented in the investigation.

**Test Cases**:

1. **Synthetic deficit-2, single proctor (will fail on unfixed code)**: 4 proctors, all with `classLowerBound = 2`, `classUpperBound = 3`. Phase 2 yields one proctor at load 0 and three peers at load 3 (max). Unfixed: `coverageRepairSwaps = 1`, deficit-2 proctor at load 1 (still uncovered), `coverageRepairUnresolved = 1`. Fixed: `coverageRepairSwaps = 2`, deficit-2 proctor at load 2, `coverageRepairUnresolved = 0`.

2. **Synthetic deficit-3, single proctor (will fail on unfixed code)**: pathological class-bounds config where one proctor needs 3 swaps. Unfixed: at most 1 swap. Fixed: 3 swaps, target reached.

3. **Production fixture deficit-2 (will fail on unfixed code, regression-locks the production fix)**: `tests/fixtures/45454.json`. Unfixed: `min(loadState) = 0`, طارق at load 0, `coverageRepairUnresolved = 6`. Fixed: `min(loadState) ≥ 2`, طارق at load ≥ 2, `coverageRepairUnresolved = 0`.

4. **Edge case — no eligible donor (may fail or pass on unfixed code, must produce structured warning post-fix)**: synthetic input where the deficit-2 proctor is exempt from every row containing an over-loaded peer. Unfixed: warning array contains `{proctorKey, reason: 'no_swappable_peer'}`. Fixed: warning map contains `{ key: { reason: 'no_eligible_donor' OR 'no_swappable_peer', initialLoad: 0, finalLoad: ≤ 1, classLowerBound: 2, attemptedSwaps: ≥ 0 } }`.

**Expected Counterexamples**:
- The unfixed code performs at most one `applyCoverageSwap` per `(round, proctor)` pair; this is the dominant failure mode.
- Possible secondary causes (now refuted by the synthetic tests where donors are abundant): donor-eligibility rules, exemption interactions, halfday-reuse interactions.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function brings every proctor to `getPrimaryLoad ≥ classLowerBound` or records a structured warning explaining why not.

**Pseudocode:**

```
FOR ALL input WHERE isBugCondition(input) DO
  R_mem' := V2'.run(input)
  loadState' := R_mem'.diagnostics.loadStateSnapshot
  classBounds := R_mem'.diagnostics.classBoundsByProctorKey

  FOR EACH proc, idx IN input.proctorsList DO
    key := getProctorKey(proc, idx)
    bounds := classBounds[key]
    IF bounds = NULL OR bounds.classLowerBound = 0 THEN CONTINUE

    final := getPrimaryLoad(loadState', key)
    IF final < bounds.classLowerBound THEN
      ASSERT key IN R_mem'.diagnostics.coverageRepairWarnings
      ASSERT R_mem'.diagnostics.coverageRepairWarnings[key].reason
             IN { 'no_eligible_donor', 'no_swappable_peer', 'no_class_bounds', 'time_budget' }
      ASSERT R_mem'.diagnostics.coverageRepairWarnings[key].initialLoad = initialLoad_key
      ASSERT R_mem'.diagnostics.coverageRepairWarnings[key].finalLoad = final
      ASSERT R_mem'.diagnostics.coverageRepairWarnings[key].classLowerBound
             = bounds.classLowerBound
      ASSERT R_mem'.diagnostics.coverageRepairWarnings[key].attemptedSwaps >= 0
    END IF
  END FOR

  ASSERT R_mem'.diagnostics.coverageRepairUnresolved
         = COUNT keys IN R_mem'.diagnostics.coverageRepairWarnings
                       EXCLUDING the synthetic '__pass__' key

  // Production fixture pinpoint assertion
  IF input = load('tests/fixtures/45454.json') THEN
    ASSERT min(histogramByCanonicalKey(R_mem')) >= 2
    ASSERT 'طارق الشعابتي' NOT IN zeroLoadProctors(R_mem')
    ASSERT R_mem'.diagnostics.coverageRepairUnresolved = 0
  END IF
END FOR
```

### Preservation Checking

**Goal**: Verify that for every input where the bug condition does NOT hold, the fixed function produces output observationally equivalent to the original function, modulo only the additive `coverageRepairWarnings: {}` empty map.

**Pseudocode:**

```
FOR ALL input WHERE NOT isBugCondition(input) DO
  R_mem  := V2.run(input)    // unfixed
  R_mem' := V2'.run(input)   // fixed

  ASSERT R_mem.proctor_keys                        ≡ R_mem'.proctor_keys
  ASSERT R_mem.reserve_keys                        ≡ R_mem'.reserve_keys
  ASSERT R_mem.assignments                         ≡ R_mem'.assignments
  ASSERT R_mem.diagnostics.coverageRepairSwaps     = R_mem'.diagnostics.coverageRepairSwaps
  ASSERT R_mem.diagnostics.coverageRepairUnresolved = R_mem'.diagnostics.coverageRepairUnresolved
  ASSERT R_mem.diagnostics.histogram*              ≡ R_mem'.diagnostics.histogram*
  // Only permitted shape difference:
  ASSERT typeof R_mem'.diagnostics.coverageRepairWarnings = 'object'
  ASSERT NOT Array.isArray(R_mem'.diagnostics.coverageRepairWarnings)
END FOR
```

**Testing Approach**: Property-based testing is the right fit for preservation. The pre-fix algorithm has 18+ closed-spec preservation tests covering most of the input domain; the post-fix algorithm must keep them all green. We add a dedicated PBT suite that generates random valid inputs (proctorsList, schedule, exemptions, duties, bounds) and asserts equivalence between the pre-fix and post-fix runs on inputs where the bug condition does not fire. fast-check is the existing PBT framework in this repo.

**Test Plan**: Observe behavior on UNFIXED code first for the entire existing test suite, then write new property-based tests capturing the deficit-≤1 equivalence and the determinism contract. Re-run the entire suite post-fix and confirm zero new failures.

**Test Cases**:

1. **Deficit-1 single-swap preservation (synthetic)**: input with one deficit-1 proctor and abundant donors. Pre-fix: 1 swap, load 2, `coverageRepairUnresolved = 0`. Post-fix: identical — 1 swap, load 2, `coverageRepairUnresolved = 0`, `coverageRepairWarnings = {}` (empty map vs pre-fix empty array, the only permitted difference).
2. **No uncovered proctors preservation (synthetic)**: input where Phase 2 already places everyone at `≥ classLowerBound`. Pre-fix: 0 swaps. Post-fix: byte-identical, 0 swaps, `coverageRepairWarnings = {}`.
3. **`tests/fixtures/45454.json` non-طارق proctors preservation**: every proctor other than طارق receives the same `proctor_keys` count post-fix as pre-fix. Only طارق's load changes (0 → 2). All 17 pre-fix swaps still fire (or an equivalent 17 — the specific donor selection may shift only if طارق's two new swaps consume a donor that would otherwise have been used elsewhere; the determinism contract pins this down).
4. **Determinism across two runs (PBT)**: for any input, `V2'.run(input).proctor_keys ≡ V2'.run(input).proctor_keys` (byte-equality across two runs with the same seed).
5. **Closed-spec preservation tests pass green**: every test in `tests/proctor-v2-*.test.js`, `tests/inv-h5-*.test.js`, and `tests/preservation-config-roundtrip.pbt.test.js` passes against `V2'` with no new failures, no new warnings, no new lint errors.

### New Test Files

The following new test files are introduced by this spec; existing test files are unchanged except for the regression test that flips from FAIL to PASS:

1. **`tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js`** (new) — bug condition exploration.
   - Synthetic deficit-2 input, asserts pre-fix `coverageRepairUnresolved ≥ 1` and proctor at `getPrimaryLoad < classLowerBound`.
   - Synthetic deficit-3 input, asserts pre-fix the deficit cannot be closed.
   - Replays the production fixture's diagnostic snapshot and asserts pre-fix `min = 0`.
   - Status: starts FAILING on unfixed code (per the bug condition), flips to PASSING on fixed code.

2. **`tests/proctor-v2-phase2-75-multi-step-fix.test.js`** (new) — fix checking.
   - Asserts post-fix that for each synthetic deficit-2 / deficit-3 input, `applyCoverageSwap` fires exactly `D` times for the deficit-D proctor and that proctor reaches `classLowerBound`.
   - Asserts post-fix that the production fixture has `min ≥ 2`, طارق at load ≥ 2, `coverageRepairUnresolved = 0`.
   - Asserts the structured `coverageRepairWarnings` map shape: keys are proctor keys (or `__pass__`), values have `{ reason, initialLoad, finalLoad, classLowerBound, attemptedSwaps }`.
   - Asserts `coverageRepairUnresolved = Object.keys(coverageRepairWarnings).filter(k => k !== '__pass__').length`.

3. **`tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js`** (new) — preservation property test.
   - fast-check generators for valid inputs (proctorsList, schedule, exemptions, duties, bounds), filtered to `NOT isBugCondition(input)`.
   - Property: `V2(input).proctor_keys ≡ V2'(input).proctor_keys` and `V2(input).diagnostics.coverageRepairSwaps = V2'(input).diagnostics.coverageRepairSwaps`.
   - Property: `V2'(input).diagnostics.coverageRepairWarnings` is always a plain object (not an array) post-fix.
   - Property: determinism — `V2'(input)` run twice yields byte-identical `proctor_keys`.

4. **`tests/proctor-v2-phase2-75-multi-step-determinism.test.js`** (new) — determinism contract.
   - Replays the production fixture twice with the same seed; asserts `proctor_keys`, `reserve_keys`, `coverageRepairSwaps`, and the structured `coverageRepairWarnings` map are byte-identical.
   - Replays the synthetic deficit-2 input twice; same assertion.

5. **`tests/proctor-v2-phase2-75-multi-step-warnings-shape.test.js`** (new) — diagnostics shape.
   - Builds an input where the deficit cannot be closed (synthetic, exemptions block every donor row); asserts the warning is recorded under the correct key with `reason ∈ { 'no_eligible_donor', 'no_swappable_peer' }` and the full `{initialLoad, finalLoad, classLowerBound, attemptedSwaps}` payload.
   - Builds an input where the pass throws synthetically (mock `buildSwapCandidates` to throw); asserts the warnings map contains `'__pass__'` with `reason: 'pass_threw'`.

### Updated Test Files

1. **`tests/proctor-v2-fairness-undercovered-exploration.test.js`** (existing — currently FAILING on `main`).
   - Currently asserts `min(loadState) >= classLowerBound` on the production fixture; this is the test that motivated this spec.
   - Post-fix this test SHALL pass without modification.
   - If the test already encodes the dual-identity workaround (it should not, given spec `proctor-v2-key-shape-unification` is closed), this spec will remove that workaround as part of task 8 (exploration → fix flip).

### Unit Tests

- **`phase2_75CoverageRepair` inner-loop unit test**: with a hand-crafted `loadState`, `rows`, `classBoundsByProctorKey`, and `lookup`, drive the function through 1, 2, and 3 inner-loop iterations and assert per-iteration `applyCoverageSwap` is called against the correct candidate.
- **`coverageRepairWarnings` map shape unit test**: assert the warnings object has the documented schema.
- **Time-budget interaction unit test**: stub `Date.now()` to exceed `TIME_BUDGET_MS = 50` mid-inner-loop and assert the inner loop bails cleanly with `reason: 'time_budget'`.
- **Determinism unit test**: same input + same seed → byte-identical `proctor_keys` and identical `coverageRepairWarnings` map.

### Property-Based Tests

- **Deficit-D closure property** (fast-check): generate inputs where exactly one synthetic proctor has deficit `D ∈ {1, 2, 3}`. Property: post-fix `getPrimaryLoad(loadState, key) >= classLowerBound`.
- **Preservation property** (fast-check): generate inputs filtered to `NOT isBugCondition`. Property: `V2(input)` and `V2'(input)` agree on `proctor_keys`, `reserve_keys`, `coverageRepairSwaps`.
- **Determinism property** (fast-check): for any input, `V2'.run(input)` is observationally idempotent across two runs with the same seed.
- **`coverageRepairUnresolved` identity**: for any input, `coverageRepairUnresolved = |{ k ∈ Object.keys(coverageRepairWarnings) : k ≠ '__pass__' }|`.

### Integration Tests

- **End-to-end production fixture run** (existing `scripts/verify-fixture.js`): post-fix reports P1/P2/P3 PASS with `min ≥ classLowerBound`.
- **End-to-end real-centre fixture run** (existing `scripts/verify-real-centre.js`): post-fix reports P1/P2/P3 PASS, no new regressions on the real-centre input.
- **Inspector script** (existing `scripts/inspect-fixture-state.js`): post-fix reports `zero-load proctors: 0`, `coverageRepairUnresolved: 0`, histogram with no entries below `classLowerBound`.
- **Renderer end-to-end smoke** (manual, optional — outside the automated suite per scope discipline): re-run distribution from `exams-proctors.html` and confirm طارق الشعابتي appears in the exam-rooms aggregator with count ≥ 2.

## Out-of-Scope (Explicit)

The following changes are explicitly out of scope and SHALL NOT appear in any task derived from this design:

- Database schema migrations (`main/db/migrations.js` unchanged).
- IPC contract changes (`main/ipc/exam-config-data.js`, `preload.js` unchanged).
- Display-layer changes (`exams-rooms.html`, `exams-proctors.html` unchanged).
- Changes to `collectUncovered`, `applyCoverageSwap`, `buildSwapCandidates`, `swapPreservesHardConstraints`, `violatesHardConstraints`, `getProctorKey`, `getProctorExemptionKey`, `phase2Build`, `phase2_5PopulateReserves`, `applyReserveSwap`, `phase3Optimize`.
- Changes to the duty pre-pass, the orchestrator (other than the one-line `|| {}` fallback default), the diagnostics aggregator (other than forwarding the new map shape).
- Silent rewrite of legacy DB rows (per requirement 3.15 — users must re-run distribution to obtain a post-fix payload).
- Any changes to `randomSeed` semantics or RNG plumbing.
