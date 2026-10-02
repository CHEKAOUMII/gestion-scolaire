# Proctor V2 — Singleton Eligibility Class Bounds Bugfix Design

## Overview

`computeClassBounds` (in `js/algorithms/proctor-distribution-v2.js`, ≈ lines 542–615) is the post-`computeEligibilityClasses` step that computes per-class `{classLowerBound, classUpperBound, G_class, D_expected_class}` and returns them as a `Map<classId, bounds>` consumed by:

- `run` (≈ line 1937), which projects the map into a per-canonical-key map `classBoundsByProctorKey`.
- `collectUncovered` (≈ line 2914), which flags any proctor with `getPrimaryLoad(loadState, key) < bounds.classLowerBound` as uncovered.
- `phase2_75CoverageRepair` (≈ line 3069, body lines 3098–3138 post-`proctor-v2-phase2-75-multi-step-repair` Tasks 5.2 + 6.1), which lifts uncovered proctors to `classLowerBound` via the inner repair loop.
- `violatesHardConstraints` (≈ line 3548), which rejects any swap that would drop a donor below their per-class `classLowerBound`.

The defect is in the multi-class fallback branch (`classIds.length > 1`, ≈ lines 591–614). For a singleton eligibility class (`members.length === 1`), `bSize = max(1, members.length) = 1`, so the algebraic identity `classLowerBound = floor(bTotal / bSize) = bTotal = G_class + D_class` makes the lower bound equal to the entire reachable guard count plus the singleton's duty share. On the production fixture `tests/fixtures/45454.json` (post-`proctor-v2-key-shape-unification`), six singletons get `classLowerBound` in 294–352, while the fixture has only `totalGuardSlots = 382` and `globalLowerBound = 2`. No assignment can place a single proctor in 350 slots when the entire fixture only has 382 slots and a proctor occupies at most one slot per row. The downstream consumers (`collectUncovered`, `phase2_75CoverageRepair`, `violatesHardConstraints`) faithfully treat these impossible numbers as fairness floors, producing six false-positive `coverageRepairWarnings` entries and one genuine deficit (طارق at load=1) blocked by the fact that every potential donor is already at `globalUpperBound = 3` and dropping them would land them below their own (correctly-computed) per-class lower bound of 2.

The earlier-closed spec `proctor-v2-fairness-undercovered-fix` published the invariant `min(loadState) ≥ classLowerBound` as a guarantee. Its tests passed because no production input then exhibited a singleton class with `G_class > globalLowerBound`. Post-`proctor-v2-key-shape-unification`, the production fixture exhibits exactly that. Post-`proctor-v2-phase2-75-multi-step-repair` Tasks 5.2 + 6.1, the structured `coverageRepairWarnings` map cleanly exposes the impossible `classLowerBound` values per proctor — making this bug visible and surgically addressable.

### Fix Strategy: Option C — Global-Fairness Floor

Per the recommendation in `docs/agent-notes/proctor-v2-singleton-class-bounds.md` §"Recommendation: Option C (global-fairness)", the chosen strategy is **Option C: cap every per-class lower bound by a globally-derived fairness floor `LB_global = floor((totalGuardSlots + D_expected) / N_eligible)`**, with a monotonicity guard that retains the per-class total when `bTotal ≤ LB_global` (degenerate case where the class's reachable slots are already below the global floor).

The other three options were considered and rejected:

- **Option A — Merge singleton classes into nearest-superset class** changes the meaning of `classId` (which is the joined string of reachable session indices plus the baseline duty count). Singletons with unique exemption patterns would lose their identity, and the downstream `classIdByProctorKey` map would point them to a class whose member count no longer reflects who can actually go where. This invalidates the H1-H2-H5 invariant family (H5: per-class fairness within the eligibility set), which closed-spec preservation tests guard. Out-of-scope per scope discipline.

- **Option B — Two-tier bounds (hardLowerBound = global, softTarget = per-class floor)** introduces a new field `bounds.hardLowerBound` plus a new field `bounds.softTarget`, doubling the bounds-shape surface area. Every consumer (`collectUncovered`, `phase2_75CoverageRepair`, `violatesHardConstraints`, `serializeClassBounds`) must be updated to consult the right tier. This is a larger change than Option C, and it introduces the question "which tier does the H5 invariant target?" — which is open to interpretation. Option C avoids the question entirely by keeping a single `classLowerBound` field.

- **Option D — Average-peer-size cap (`avgPeerSize`-based formula)** computes `LB = floor(G_class + D_class / avgPeerSize)` where `avgPeerSize` is the average member count over multi-member classes. On the production fixture this yields the same numerical result as Option C (LB=2, UB=3) — both options agree. On synthetic inputs (Synthetic A: 5 proctors, 1 multi-member size 4 + 1 singleton G=4) Option D yields `singleton_LB = 1` while Option C yields `singleton_LB = 4`. Option C's higher number is **not impossible** — the singleton has G=4 reachable slots and the system average is 4, so `LB = 4` is fair. Option D's lower number under-promises and weakens the fairness invariant. Option C is mathematically simpler (no extra scan to compute `avgPeerSize`), semantically aligned with the existing `classIds.length === 1` branch (lines 561–574 of `computeClassBounds`, which already computes exactly `floor((onlyG + D_expected) / onlySize)` — a global formula), and produces stronger degenerate-case behavior (when `G_class = 0`, the monotonicity guard returns 0 even if `LB_global > 0`).

Option C is structurally the smallest change: a `LB_global` derivation at the top of `computeClassBounds` plus a `min/max` cap with a monotonicity guard in the multi-class fallback branch. The `gById` precomputation (lines 549–559) is reused to derive `totalGuardSlots = sum over classes of gById.get(classId)` for the `LB_global` calculation — no extra schedule iteration is needed. The strategy is bounded, deterministic, observationally equivalent on every input where no per-class `floor(bTotal / bSize)` exceeds `LB_global`, and corrects the production-fixture regression with a single algebraic change.

### Performance Bound

Pre-fix worst case: `O(|classes| × |reachable_indices_per_class|)` for `gById` precomputation, plus `O(|classes|)` for `dShareById` distribution, plus `O(|classes|)` for the per-class bounds emission.

Post-fix worst case: identical asymptotic cost. The `LB_global` derivation is `O(|classes|)` (sum the existing `gById` map values once), the `min/max` cap inside the per-class loop is `O(1)` per class, and the monotonicity guard is `O(1)` per class. No new allocations.

On the production fixture (`tests/fixtures/45454.json`): `|classes| ≈ 80–90` (mix of multi-member and singleton), `|reachable_indices_per_class|` ≤ 191. Empirical wall-clock cost is sub-millisecond — well within the existing budget for `computeClassBounds`. No new time budget is introduced.

### Scope Discipline

The fix is confined to the body of `computeClassBounds` plus the new test files. The full surface area:

- **Modified function**: `computeClassBounds` in `js/algorithms/proctor-distribution-v2.js` (single function).
- **New algebraic quantity**: `LB_global = floor((totalGuardSlots + D_expected) / N_eligible)`, computed once near the top of `computeClassBounds`.
- **Modified bounds emission**: the per-class loop in the multi-class fallback branch (≈ lines 591–614) caps `classLowerBound` and `classUpperBound` against `LB_global` with a monotonicity guard.
- **NO changes** to: `computeEligibilityClasses` (lines 494–530), `getGuardSlotsForScheduleIndex` (lines 532–540), the only-one-class branch (lines 561–574), `serializeClassBounds` (lines 622–633), `collectUncovered` (line 2914), `phase2_75CoverageRepair` (lines 3069–3210, including the parent spec's inner repair loop and diagnostics-shape migration), `applyCoverageSwap`, `buildSwapCandidates`, `swapPreservesHardConstraints`, `violatesHardConstraints`, `getProctorKey`, `getProctorExemptionKey`, the duty pre-pass, `phase2Build`, `phase2_5PopulateReserves`, `applyReserveSwap`, `phase3Optimize`, the orchestrator, IPC handlers, DB migrations, the display layer, or any HTML/preload file.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — at the end of `computeClassBounds`, at least one proctor `proc_i` satisfies `classBoundsByProctorKey[getProctorKey(proc_i, i)].classLowerBound > LB_global + 1`. The dominant trigger is **singleton eligibility classes** with wide row eligibility (`G_class` in the hundreds).
- **Property (P)**: The desired post-fix behavior — for every per-class bound, `classLowerBound ≤ LB_global + 1`, where the `+1` accommodates the existing ceil/floor pair from the only-one-class branch (which legitimately produces `classLowerBound = floor(...)` and `classUpperBound = floor(...) + 1` when divisibility fails).
- **Preservation**: All inputs `X` where `NOT isBugCondition(X)` SHALL produce output observationally equivalent to the pre-fix algorithm — same `classBoundsByProctorKey`, same `proctor_keys`, same `coverageRepairWarnings` map.
- **`LB_global`**: `floor((totalGuardSlots + D_expected) / N_eligible)` — the global fairness floor derived from input parameters. The post-fix `classLowerBound` for any class `c` is bounded above by `LB_global` (with the monotonicity guard `IF bTotal ≤ LB_global THEN retain bTotal`).
- **`UB_global`**: `LB_global + 1` (or `LB_global` exactly when `(totalGuardSlots + D_expected)` is exactly divisible by `N_eligible`) — the global fairness ceiling. The post-fix `classUpperBound` for any class `c` is bounded above by `UB_global` via the cap `max(ceil(bTotal / bSize), LB_global)` capped at the achievable upper.
- **`totalGuardSlots`**: `sum over scheduleEntries of getGuardSlotsForScheduleIndex(scheduleEntries, idx, proctorsPerRoom, guardSlotsByIndex)`. Equivalently, `sum over classIds of gById.get(classId)` is **incorrect** because reachable-by-class sets overlap (a slot reachable by two classes is double-counted). The correct derivation iterates `scheduleEntries` directly (or iterates the union of reachable indices).
- **`N_eligible`**: `eligibleCountForBounds` from `run` at ≈ line 1937 — count of proctors that ended up in at least one eligibility class. Equivalently, `sum over classIds of (cls.members || []).length` — the same value the pre-fix code already passes as the `N` parameter to `computeClassBounds`.
- **`D_expected`**: `Math.max(0, Math.floor(Number(input.D_expected) || 0))` — the global expected-duty-pair count. Already a parameter to `computeClassBounds`.
- **`bTotal`**: `bG + bD` — per-class total of reachable guard slots plus assigned duty share. Already computed in the pre-fix code at ≈ line 605.
- **`bSize`**: `max(1, (cls.members || []).length)` — per-class member count, with a floor of 1 to prevent division-by-zero. Already computed in the pre-fix code at ≈ line 603.
- **Singleton class**: Eligibility class with `members.length === 1`. The dominant trigger of the bug, but the fix's correctness does not depend on singleton-only — it caps any per-class lower bound that exceeds `LB_global`.
- **Monotonicity guard**: `IF bTotal ≤ LB_global THEN retain bTotal` (i.e. set `classLowerBound = bTotal`, `classUpperBound = bTotal`). Ensures the cap never RAISES a class's lower bound above its true reachable total — the post-fix value is always ≤ the pre-fix value (one-sided monotonicity).

## Bug Details

### Bug Condition

The bug manifests on inputs where at least one eligibility class produces `floor(bTotal / bSize) > LB_global + 1`. The dominant trigger is **singleton classes with wide row eligibility**: when `bSize = 1`, `floor(bTotal / 1) = bTotal = G_class + D_class`, which can be in the hundreds when the proctor has no exemption and no duty constraints across most of the schedule. On the production fixture, six such singletons exist with `G_class` in 294–352. Less commonly the bug can trigger on small (size-2 or size-3) classes whose `bTotal` is large enough that `floor(bTotal / bSize)` still exceeds the global floor — the fix handles these uniformly because the cap is applied to every per-class bound, not only singletons.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT:  input — the full input object consumed by ProctorDistributionV2.run
  OUTPUT: boolean

  R_mem        := ProctorDistributionV2.run(input)
  classBounds  := R_mem.classBoundsByProctorKey

  totalGuardSlots := sum over scheduleEntries of
                       getGuardSlotsForScheduleIndex(scheduleEntries, idx,
                                                     proctorsPerRoom,
                                                     guardSlotsByIndex)
  D_expected      := Math.max(0, Math.floor(Number(input.D_expected) || 0))
  N_eligible      := count of proctors with at least one eligibility class
  LB_global       := Math.floor((totalGuardSlots + D_expected) / N_eligible)

  FOR EACH proc, idx IN input.proctorsList DO
    key    := getProctorKey(proc, idx)
    bounds := classBounds[key]
    IF bounds = NULL THEN CONTINUE
    IF bounds.classLowerBound > LB_global + 1 THEN
      // Per-class lower bound exceeds the global fairness ceiling.
      // Mathematically impossible for any algorithm to satisfy on this input.
      RETURN true
    END IF
  END FOR

  RETURN false
END FUNCTION
```

The textbook witness: there exists a class `c` such that its emitted `classLowerBound` from the multi-class fallback branch (`bSize = (cls.members || []).length`, `bTotal = bG + bD`, `classLowerBound = floor(bTotal / bSize)`) exceeds `LB_global + 1`. The dominant production trigger is `bSize === 1` (singleton class) with `bTotal` in the hundreds.

### Examples

- **Production fixture `tests/fixtures/45454.json`** (post-key-shape-unification, post-parent-spec Tasks 5.2 + 6.1):
  - Six singleton classes with impossible bounds:

    | canonical key | classLowerBound | classUpperBound |
    |---------------|-----------------|-----------------|
    | `__idx_98`    | 352             | 352             |
    | `__idx_62`    | 342             | 342             |
    | `__idx_28`    | 342             | 342             |
    | `__idx_133`   | 318             | 318             |
    | `__idx_109`   | 294             | 294             |
    | `__idx_21`    | 352             | 352             |

  - Corrected production-fixture numbers: `totalGuardSlots = 382`, `D_expected = 13`, `N_eligible = 147`, `LB_global = floor(395/147) = 2`, `UB_global = 3`, `feasibleCeiling = 4`.
  - Pre-fix consequence: `coverageRepairWarnings` contains six false-positive entries (five with `reason: 'no_swappable_peer'` and `attemptedSwaps: 0`, one — `__idx_98` طارق — with `attemptedSwaps: 1` and `finalLoad: 1`). `min(loadState) = 1`. `coverageRepairUnresolved = 6`.
  - Expected on fixed code: every singleton's `classLowerBound = 3` (capped at `LB_global + 1 = 3`); the six false-positive warnings disappear; طارق's deficit closes via the existing inner repair loop because the corrected bound is achievable. `min(loadState) ≥ 2`. `coverageRepairUnresolved = 0`.

- **Synthetic singleton with G=10 in a 5-proctor / 4-class fixture** (test case 1 in Task 1.1 below):
  - Inputs: 5 proctors total, 4 multi-member classes of size {2,2,2,1} with one singleton having `G_class = 10`. Schedule total `totalGuardSlots = 25`, `D_expected = 0`.
  - `LB_global = floor(25 / 5) = 5`. `UB_global = ceil(25 / 5) = 5` (exact divisibility).
  - Pre-fix: singleton `classLowerBound = floor(10 / 1) = 10` — impossible (no proctor can take 10 of the 25 slots and still let the other 4 share 15 slots fairly).
  - Post-fix: singleton `classLowerBound = min(10, 5) = 5`; multi-member classes unchanged.

- **Synthetic non-singleton with bTotal/bSize > LB_global** (test case 2 in Task 1.2 below):
  - 4 proctors, 2 classes of size 2 each. Class A: `G = 30`, `D = 0`, `bTotal = 30`, `bSize = 2`, pre-fix `classLowerBound = 15`. Class B: `G = 10`, `D = 0`, `bTotal = 10`, `bSize = 2`, pre-fix `classLowerBound = 5`. Schedule total `totalGuardSlots = 40`, `LB_global = 10`.
  - Pre-fix: class A `classLowerBound = 15 > LB_global = 10` — over-promises (no algorithm can place every member of class A at 15 slots when the fixture only has 40 slots total).
  - Post-fix: class A `classLowerBound = min(15, 10) = 10`; class B unchanged at 5.

- **Edge case — class A with `bTotal = LB_global` exactly** (preservation, test case 3):
  - 4 proctors, 2 classes of size 2 each. Class A: `bTotal = 20`, `bSize = 2`, pre-fix `classLowerBound = 10`. Class B: `bTotal = 20`, `bSize = 2`, pre-fix `classLowerBound = 10`. `totalGuardSlots = 40`, `LB_global = 10`.
  - Pre-fix: both classes at `classLowerBound = 10`, no inflation.
  - Post-fix: both classes at `min(10, 10) = 10` — byte-identical.

- **Edge case — class with `bTotal < LB_global`** (monotonicity guard, test case 4):
  - 4 proctors, 1 multi-member class (size 3, `G = 30`) and 1 singleton (`G = 5`). `totalGuardSlots = 35`, `D_expected = 0`, `LB_global = floor(35 / 4) = 8`.
  - Pre-fix: singleton `classLowerBound = 5` (already below `LB_global`); multi-member `classLowerBound = floor(30 / 3) = 10` (above `LB_global`).
  - Post-fix monotonicity guard fires for singleton: `bTotal = 5 ≤ LB_global = 8` ⇒ retain `classLowerBound = 5`. Multi-member capped: `min(10, 8) = 8`.

- **Edge case — class with `G = 0`** (degenerate, preservation):
  - Proctor exempt from every row; placed in its own class with `G_class = 0`, `D_class = 0`, `bTotal = 0`. Pre-fix: `classLowerBound = 0` (excluded from uncovered set by `collectUncovered`'s zero-bound guard).
  - Post-fix: `bTotal = 0 ≤ LB_global` (always, since `LB_global ≥ 0`) ⇒ monotonicity guard retains `classLowerBound = 0`. Same as pre-fix.

- **Edge case — only-one-class branch** (`classIds.length === 1`, preservation):
  - All proctors share one eligibility class. `onlyTotal = totalGuardSlots + D_expected`, `onlySize = N_eligible`. Pre-fix: `classLowerBound = floor(onlyTotal / onlySize) = LB_global`, `classUpperBound = ceil(onlyTotal / onlySize) = LB_global` or `LB_global + 1`. The fix does NOT touch this branch — it is already algebraically equivalent to the global formula.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- The `computeEligibilityClasses` function (lines 494–530), including class-id assignment (`eligible.join(',') + '|' + baselineDuty`), member iteration order, and the reachable-indices array per class.
- The `getGuardSlotsForScheduleIndex` helper (lines 532–540), including the `_strictFairnessGuardSlots` override and the `roomsCount × proctorsPerRoom` fallback.
- The only-one-class branch of `computeClassBounds` (lines 561–574) — already algebraically equivalent to the global formula.
- The `gById` precomputation (lines 549–559) — used unchanged for both the only-one-class branch and the multi-class fallback branch.
- The `dShareById` residual-distribution logic (lines 576–594) — used unchanged in the multi-class fallback branch.
- The class iteration order in `Array.from(classes.keys()).sort()` — lexicographic, deterministic.
- `serializeClassBounds` (lines 622–633) — unchanged; the post-fix `Map<classId, bounds>` has the same field shape.
- `collectUncovered`, `phase2_75CoverageRepair` (including the parent spec's inner repair loop body, the structured `coverageRepairWarnings` map shape, and the `__pass__` synthetic key for catch-path returns), `applyCoverageSwap`, `buildSwapCandidates`, `swapPreservesHardConstraints`, `violatesHardConstraints` — bodies and signatures untouched.
- The orchestrator (≈ lines 4342, 4358, 4421) — no edits.
- DB schema (`main/db/migrations.js`), IPC contract (`main/ipc/exam-config-data.js`), preload, the display layer (`exams-rooms.html`, `exams-proctors.html`).
- Determinism: same input ⇒ byte-identical `classBoundsByProctorKey`, `proctor_keys`, `reserve_keys`, and `diagnostics.coverageRepairWarnings` map across two runs.

**Scope:**

All inputs `X` where `NOT isBugCondition(X)` SHALL produce output observationally equivalent to the pre-fix algorithm. This includes:

- Inputs where every class has `floor(bTotal / bSize) ≤ LB_global` (the cap is a no-op for every class).
- Inputs that trigger the only-one-class branch (`classIds.length === 1`) — no path through the modified code.
- Inputs where `D_expected = 0` AND every class has `bTotal ≤ LB_global` (monotonicity guard fires for every class, retaining `classLowerBound = bTotal`).
- Inputs where the parent spec's `proctor-v2-phase2-75-multi-step-repair` inner repair loop is exercised but no class has impossible bounds (e.g. the parent spec's synthetic deficit-2 and deficit-3 inputs from `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js` test cases 1 and 2).

**What MUST NOT change:**
- The shape of `classBoundsByProctorKey`'s entries: `{classLowerBound, classUpperBound, G_class, D_expected_class}`. No new fields.
- The shape of `coverageRepairWarnings` (Object<proctorKey, {reason, initialLoad, finalLoad, classLowerBound, attemptedSwaps}>) — preserved from the parent spec.
- The semantics of `coverageRepairSwaps` (per-successful-swap counter), `coverageRepairUnresolved` (count of non-`__pass__` warnings), and the `__pass__` synthetic key.
- Any field on `R_mem.proctor_keys`, `R_mem.reserve_keys`, `R_mem.assignments`, or `R_mem.diagnostics.histogram*`.

## Hypothesized Root Cause

Based on bug analysis and code inspection of `computeClassBounds` (lines 542–615), the most likely root causes are:

1. **Algebraic Identity for Singleton Classes**: in the multi-class fallback branch, `bSize = max(1, members.length) = 1` for any singleton class makes `floor(bTotal / bSize) = bTotal`. The result is the entire reachable guard count plus the duty share — an absolute reachability metric, not a fairness floor. **This is the dominant root cause** — confirmed by the production fixture's six singleton classes with `classLowerBound` in 294–352 against `LB_global = 2`.

2. **No Global Fairness Ceiling**: the multi-class fallback branch computes per-class bounds in isolation, without consulting any global quantity. The only-one-class branch (lines 561–574) implicitly applies a global formula (`floor(onlyTotal / onlySize)` is exactly `LB_global` when `onlySize = N_eligible` and `onlyTotal = totalGuardSlots + D_expected`), but the multi-class branch does not. The fix introduces the missing global ceiling.

3. **Missing Cross-Class Mass Conservation**: when `sum over classes of (members.length × classLowerBound) > totalGuardSlots + D_expected`, the bounds collectively over-promise — they demand more total slots than the fixture has. On the production fixture this is dominated by the six singletons (sum of their `classLowerBound` values is `352 + 342 + 342 + 318 + 294 + 352 = 2000`, far above `totalGuardSlots = 382`). The cap by `LB_global` ensures `sum over classes of (members.length × classLowerBound) ≤ N_eligible × LB_global ≤ totalGuardSlots + D_expected` (mass conservation holds with equality at most when `LB_global` is exact).

4. **Diagnostic Misinterpretation in Earlier Investigation**: the parent spec `proctor-v2-phase2-75-multi-step-repair` initially interpreted the `coverageRepairUnresolved = 6` symptom as a single-step-deficit failure mode and proposed an inner repair loop. The inner repair loop is structurally correct and useful (it surfaces the structured warnings that exposed this bug), but it did not address the deeper cause. The fix here addresses the cause one layer earlier — the bounds themselves — and lets the inner repair loop continue to operate unchanged on the corrected bounds.

The fix targets cause (1) directly via Option C and resolves causes (2)–(4) as a consequence.

## Correctness Properties

Property 1: Bug Condition — Singleton and Small-Class Bounds Are Capped by Global Fairness Floor

_For any_ input `X` where the bug condition holds (`isBugCondition(X) = true`), the fixed `computeClassBounds'` SHALL, for every emitted per-class `bounds` entry, satisfy `bounds.classLowerBound ≤ LB_global + 1`, where `LB_global = floor((totalGuardSlots + D_expected) / N_eligible)`. The `+1` slack accommodates the existing ceil/floor pair from the only-one-class branch. On the production fixture `tests/fixtures/45454.json` specifically, every per-class `classLowerBound` SHALL be `≤ 3` (LB_global=2, +1), the six previously-impossible singleton bounds (352, 342, 342, 318, 294, 352) SHALL be capped at 3, the six false-positive `coverageRepairWarnings` entries (`__idx_98`, `__idx_62`, `__idx_28`, `__idx_133`, `__idx_109`, `__idx_21`) SHALL disappear, `min(loadState) ≥ 2`, and `diagnostics.coverageRepairUnresolved ≤ 1`.

**Validates: Requirements 2.1, 2.2, 2.4, 2.6, 2.8, 2.13**

Property 2: Preservation — Inputs Without Impossible Bounds Are Unchanged

_For any_ input `X` where the bug condition does NOT hold (`isBugCondition(X) = false` — every per-class `floor(bTotal / bSize)` is already `≤ LB_global + 1`), the fixed function SHALL produce output observationally equivalent to the pre-fix function, preserving `classBoundsByProctorKey` (every per-class `classLowerBound` and `classUpperBound` byte-identical), `proctor_keys`, `reserve_keys`, the assignments graph, all per-row metadata, `diagnostics.coverageRepairSwaps` count, `diagnostics.coverageRepairUnresolved` count, and the structured `diagnostics.coverageRepairWarnings` map. The monotonicity guard `IF bTotal ≤ LB_global THEN retain bTotal` ensures the cap never RAISES a class's lower bound — the post-fix value is always `≤` the pre-fix value (one-sided monotonicity).

**Validates: Requirements 2.3, 2.7, 2.9, 2.10, 2.11, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16, 3.17, 3.18, 3.19, 3.20, 3.21, 3.22, 3.23, 3.24, 3.25**

## Fix Implementation

### Changes Required

Assuming our root-cause analysis is correct, the fix is confined to one function with one new algebraic quantity and one cap rule.

**File**: `js/algorithms/proctor-distribution-v2.js`

**Function**: `computeClassBounds` (≈ line 542, body spans lines 542–615)

**Specific Changes**:

1. **Compute `LB_global` once at the top of `computeClassBounds`** (≈ between lines 547 and 548, immediately after the early-return guard for `classIds.length === 0`):

   ```pseudocode
   IF classIds.length = 0 THEN RETURN bounds END IF

   // NEW: derive global fairness floor (Option C — global-fairness)
   //
   //   LB_global = floor((totalGuardSlots + D_expected) / N_eligible)
   //
   // Where:
   //   totalGuardSlots = sum over scheduleEntries of
   //                       getGuardSlotsForScheduleIndex(scheduleEntries, idx,
   //                                                     proctorsPerRoom,
   //                                                     guardSlotsByIndex)
   //   D_expected      = expectedDuty (already computed at line 545)
   //   N_eligible      = eligibleCount (already passed as parameter N at line 546)
   //
   // The +1 accommodates the existing ceil/floor pair in the only-one-class
   // branch (lines 561-574), which legitimately produces classLowerBound =
   // floor(...) and classUpperBound = floor(...) + 1 when
   // (totalGuardSlots + D_expected) is not exactly divisible by N_eligible.
   var totalGuardSlots = 0;
   var entries = scheduleEntries || [];
   for (var ti = 0; ti < entries.length; ti++) {
     totalGuardSlots += getGuardSlotsForScheduleIndex(
       scheduleEntries, ti, proctorsPerRoom, guardSlotsByIndex
     );
   }
   var lbGlobal = eligibleCount > 0
     ? Math.floor((totalGuardSlots + expectedDuty) / eligibleCount)
     : 0;
   ```

   The `gById` precomputation a few lines later (lines 549–559) is preserved unchanged. We do NOT reuse `gById.values()` to compute `totalGuardSlots` because reachable-by-class sets overlap (a slot reachable by classes A and B is counted in both `gById.get('A')` and `gById.get('B')`). The schedule-iteration form is correct and matches `getGuardSlotsForScheduleIndex`'s contract exactly.

2. **Apply the cap with monotonicity guard inside the multi-class fallback branch** (≈ lines 591–614, the per-class loop emitting `bounds.set(bId, ...)`):

   ```pseudocode
   for (var bi = 0; bi < classIds.length; bi++) {
     var bId    = classIds[bi];
     var bClass = classes.get(bId);
     var bSize  = Math.max(1, (bClass.members || []).length);
     var bG     = gById.get(bId) || 0;
     var bD     = dShareById.get(bId) || 0;
     var bTotal = bG + bD;

     // NEW: cap per-class bounds by global fairness floor (Option C),
     //      with monotonicity guard for the degenerate case bTotal <= lbGlobal.
     var rawLower = Math.floor(bTotal / bSize);
     var rawUpper = Math.ceil(bTotal / bSize);
     var cappedLower, cappedUpper;
     if (bTotal <= lbGlobal) {
       // Monotonicity guard — never raise a class's lower bound above its
       // achievable total. Fires for tiny classes (G_class = 0, or
       // bTotal < lbGlobal). Preserves pre-fix behavior exactly for the
       // degenerate case.
       cappedLower = bTotal;
       cappedUpper = bTotal;
     } else {
       // Cap rule — when the per-class division yields a value above the
       // global floor, clamp DOWN to lbGlobal. The upper bound is allowed
       // to be lbGlobal (when rawUpper <= lbGlobal we keep rawUpper, but
       // when rawLower > lbGlobal we cap both to lbGlobal so the upper
       // never falls below the lower).
       cappedLower = Math.min(rawLower, lbGlobal);
       cappedUpper = Math.min(rawUpper, Math.max(rawLower <= lbGlobal ? rawUpper : lbGlobal, lbGlobal));
       // Equivalently and more readably:
       //   cappedLower = Math.min(rawLower, lbGlobal);
       //   cappedUpper = Math.max(cappedLower, Math.min(rawUpper, lbGlobal + 1));
       // — this keeps cappedUpper at most lbGlobal + 1 (matching the
       //   ceil/floor pair pattern of the only-one-class branch) and at
       //   least cappedLower (so upper >= lower holds always).
     }

     bounds.set(bId, {
       classLowerBound: cappedLower,
       classUpperBound: cappedUpper,
       G_class: bG,
       D_expected_class: bD
     });
   }
   ```

   The exact algebraic form for `cappedUpper` is:

   ```
   cappedUpper := max(cappedLower, min(rawUpper, lbGlobal + 1))
   ```

   This has the following properties:
   - When `rawLower ≤ lbGlobal` (the cap is a no-op for the lower), `cappedLower = rawLower` and `cappedUpper = max(rawLower, min(rawUpper, lbGlobal + 1))`. Since `rawUpper ∈ {rawLower, rawLower + 1}`, this is `max(rawLower, min(rawLower or rawLower+1, lbGlobal+1))`. When `rawUpper ≤ lbGlobal + 1` (typical case), `cappedUpper = rawUpper` — identity. When `rawUpper > lbGlobal + 1` (rare — only when `rawLower = lbGlobal` and divisibility fails), `cappedUpper = lbGlobal + 1` — caps at the slack ceiling.
   - When `rawLower > lbGlobal` (the cap fires), `cappedLower = lbGlobal` and `cappedUpper = max(lbGlobal, min(rawUpper, lbGlobal + 1)) = lbGlobal + 1` (since `rawUpper > lbGlobal` whenever `rawLower > lbGlobal`). The class gets `classLowerBound = lbGlobal`, `classUpperBound = lbGlobal + 1` — the same shape as the only-one-class branch's ceil/floor pair.
   - When `bTotal ≤ lbGlobal` (monotonicity guard), `cappedLower = cappedUpper = bTotal` — identity to pre-fix for the degenerate case.

3. **Preservation of the only-one-class branch** (lines 561–574, `classIds.length === 1`): no edit. The branch already computes `classLowerBound = floor(onlyTotal / onlySize)` and `classUpperBound = ceil(onlyTotal / onlySize)`, which is exactly `LB_global` when `onlySize = N_eligible` and `onlyTotal = totalGuardSlots + D_expected`. The cap would be a no-op here — Option C's formula and the only-one-class branch's formula are algebraically identical.

4. **Preservation of `gById`, `dShareById`, residual-distribution logic, class iteration order**: no edit. Lines 549–594 are reused unchanged. The only structural change is inserting the `LB_global` derivation between the early-return and the only-one-class branch, and replacing the per-class bound emission's `bounds.set(bId, ...)` body in the multi-class fallback branch.

5. **Out-of-Scope Sites Explicitly Untouched**:
   - `computeEligibilityClasses` (lines 494–530) — body unchanged.
   - `getGuardSlotsForScheduleIndex` (lines 532–540) — body unchanged.
   - `serializeClassBounds` (lines 622–633) — body unchanged. The post-fix `Map<classId, bounds>` has the same field shape.
   - `collectUncovered` (line 2914) — body unchanged. Reads `bounds.classLowerBound` from the corrected map.
   - `phase2_75CoverageRepair` (lines 3069–3210) — body unchanged. The parent spec's inner repair loop and structured `coverageRepairWarnings` map shape stay as-is. The repair pass operates on the corrected bounds without code changes.
   - `applyCoverageSwap`, `buildSwapCandidates`, `swapPreservesHardConstraints`, `violatesHardConstraints` — bodies unchanged. The donor-side `classLowerBound` check from spec `proctor-v2-fairness-undercovered-fix` task 4.6 continues to apply with the corrected bounds (no change in semantics — only in the numerical values).
   - `getProctorKey`, `getProctorExemptionKey`, the duty pre-pass, `phase2Build`, `phase2_5PopulateReserves`, `applyReserveSwap`, `phase3Optimize` — all untouched.
   - Orchestrator (≈ lines 4342, 4358, 4421) — no edits.

## Testing Strategy

### Validation Approach

Two-phase: first surface counterexamples that demonstrate the impossible bounds on the unfixed code (refuting alternative root-cause hypotheses such as "the inner repair loop has a different bug" or "Phase 3 SA is reverting طارق's swaps"), then verify the fixed code caps every per-class bound at `LB_global + 1` and preserves byte-identical behavior on every other input.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples on the unfixed code that prove `computeClassBounds` is the source of the impossible bounds. The witness is a direct read of `R_mem.classBoundsByProctorKey` after running the algorithm — no dependency on the inner repair loop, no dependency on Phase 3 SA, no dependency on the diagnostics-shape migration. The bug is purely in the bounds derivation.

**Test Plan**: Construct synthetic inputs that isolate the impossible-bounds path with no confounds (one singleton class with wide row eligibility, no exemptions, no duty constraints). Run them on the unfixed code and read `classBoundsByProctorKey` directly. Then run the production fixture and confirm the six documented impossible bounds match the values from `docs/agent-notes/proctor-v2-singleton-class-bounds.md`.

**Test Cases**:

1. **Synthetic singleton with `G_class = 10` in a 5-proctor / 4-class fixture (will fail on unfixed code)**: 5 proctors, 4 classes of size {2,2,2,1}. The singleton class has `G_class = 10`, `D_class = 0`, `bTotal = 10`. Schedule total `totalGuardSlots = 25`, `D_expected = 0`, `LB_global = 5`. Unfixed: singleton's `classLowerBound = 10` (impossible — sum of all per-class lower bounds × member counts is `5 + 5 + 5 + 10 = 25` exactly, but the singleton can only attend 10 of those slots while every other proctor needs at least 5). Fixed: singleton's `classLowerBound = min(10, 5) = 5`.

2. **Synthetic non-singleton with `bTotal/bSize > LB_global` (will fail on unfixed code)**: 4 proctors, 2 classes of size 2 each. Class A: `G = 30`, `bTotal = 30`. Class B: `G = 10`, `bTotal = 10`. `totalGuardSlots = 40`, `LB_global = 10`. Unfixed: class A's `classLowerBound = 15 > LB_global = 10` (impossible — every member of class A would need 15 slots). Fixed: class A's `classLowerBound = 10`.

3. **Production fixture impossible-bounds replay (will fail on unfixed code, regression-locks the production fix)**: load `tests/fixtures/45454.json`, run the algorithm, read `classBoundsByProctorKey` for the six known canonical keys (`__idx_98`, `__idx_62`, `__idx_28`, `__idx_133`, `__idx_109`, `__idx_21`). Unfixed: the six values are 352, 342, 342, 318, 294, 352 (per the agent-notes witness table). Fixed: every value is `≤ 3` (capped at `LB_global + 1 = 3`).

4. **Edge case — class with `G = 0` (preservation, should pass on unfixed code AND post-fix)**: synthetic input with a proctor exempt from every row (placed in its own class with `G_class = 0`). Pre-fix: `classLowerBound = 0` (excluded from uncovered set). Post-fix: monotonicity guard fires, retains `classLowerBound = 0`. No change.

**Expected Counterexamples**:
- The unfixed `computeClassBounds` produces `classLowerBound > LB_global + 1` for any singleton with `G_class > LB_global`; this is the dominant failure mode.
- Possible secondary causes (now refuted by the synthetic tests where the inner repair loop is not invoked): the parent spec's inner repair loop interaction, Phase 3 SA reverting swaps, exemption interactions, halfday-reuse interactions.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function caps every per-class lower bound at `LB_global + 1` while preserving the upper bound's ceil/floor relationship.

**Pseudocode:**

```
FOR ALL input WHERE isBugCondition(input) DO
  R_mem' := V2'.run(input)
  classBounds := R_mem'.classBoundsByProctorKey

  totalGuardSlots := sum over scheduleEntries of
                       getGuardSlotsForScheduleIndex(...)
  D_expected      := Math.max(0, Math.floor(Number(input.D_expected) || 0))
  N_eligible      := eligibleCount derived from R_mem' or recomputed
  LB_global       := Math.floor((totalGuardSlots + D_expected) / N_eligible)

  FOR EACH proc, idx IN input.proctorsList DO
    key := getProctorKey(proc, idx)
    bounds := classBounds[key]
    IF bounds = NULL THEN CONTINUE

    ASSERT bounds.classLowerBound <= LB_global + 1
    ASSERT bounds.classUpperBound <= LB_global + 1
    ASSERT bounds.classUpperBound >= bounds.classLowerBound
  END FOR

  // Production fixture pinpoint assertion
  IF input = load('tests/fixtures/45454.json') THEN
    FOR EACH key IN { '__idx_98','__idx_62','__idx_28','__idx_133',
                      '__idx_109','__idx_21' } DO
      ASSERT classBounds[key].classLowerBound <= 3
    END FOR
    ASSERT min(histogramByCanonicalKey(R_mem')) >= 2
    nonPassWarnings := Object.keys(R_mem'.diagnostics.coverageRepairWarnings)
                              .filter(k -> k != '__pass__')
    ASSERT nonPassWarnings.length <= 1
    ASSERT R_mem'.diagnostics.coverageRepairUnresolved = nonPassWarnings.length
  END IF
END FOR
```

### Preservation Checking

**Goal**: Verify that for every input where the bug condition does NOT hold, the fixed function produces output byte-identical to the original function — no observational change to `classBoundsByProctorKey`, `proctor_keys`, `reserve_keys`, or the structured `coverageRepairWarnings` map.

**Pseudocode:**

```
FOR ALL input WHERE NOT isBugCondition(input) DO
  R_mem  := V2.run(input)    // unfixed
  R_mem' := V2'.run(input)   // fixed

  ASSERT serialize(R_mem.classBoundsByProctorKey)
       = serialize(R_mem'.classBoundsByProctorKey)
  ASSERT R_mem.proctor_keys                           = R_mem'.proctor_keys
  ASSERT R_mem.reserve_keys                           = R_mem'.reserve_keys
  ASSERT R_mem.assignments                            = R_mem'.assignments
  ASSERT R_mem.diagnostics.coverageRepairSwaps        = R_mem'.diagnostics.coverageRepairSwaps
  ASSERT R_mem.diagnostics.coverageRepairUnresolved   = R_mem'.diagnostics.coverageRepairUnresolved
  ASSERT R_mem.diagnostics.coverageRepairWarnings     = R_mem'.diagnostics.coverageRepairWarnings
  ASSERT R_mem.diagnostics.histogram*                 = R_mem'.diagnostics.histogram*
END FOR
```

**Testing Approach**: Property-based testing is the right fit for preservation. The pre-fix algorithm has 18+ closed-spec preservation tests covering most of the input domain; the post-fix algorithm must keep them all green. We add a dedicated PBT suite that generates random valid inputs (proctorsList, schedule, exemptions, duties, bounds) and asserts equivalence between the pre-fix and post-fix runs on inputs where the bug condition does not fire. fast-check is the existing PBT framework in this repo.

**Test Plan**: Observe behavior on UNFIXED code first for the entire existing test suite, then write new property-based tests capturing the cap's one-sided monotonicity (post-fix `classLowerBound ≤ pre-fix classLowerBound` for every class, with strict inequality only when the pre-fix value exceeds `LB_global`) and the determinism contract. Re-run the entire suite post-fix and confirm zero new failures.

**Test Cases**:

1. **Cap is a no-op when no class exceeds `LB_global` (preservation)**: synthetic input with classes of size {2,2,2}, all with `bTotal/bSize ≤ LB_global`. Pre-fix and post-fix produce byte-identical `classBoundsByProctorKey`.

2. **Only-one-class branch preservation**: synthetic input where every proctor shares one eligibility class (no exemptions, no duty constraints). Pre-fix and post-fix take the only-one-class branch (`classIds.length === 1`). Byte-identical output.

3. **Monotonicity guard preservation**: synthetic input with one tiny class (`G_class = 0`) and one normal class. Pre-fix: tiny class has `classLowerBound = 0`. Post-fix: monotonicity guard retains `classLowerBound = 0`. Identity.

4. **Closed-spec preservation tests pass green**: every test in `tests/proctor-v2-*.test.js`, `tests/inv-h5-*.test.js`, and `tests/preservation-config-roundtrip.pbt.test.js` passes against `V2'` with no new failures, no new warnings, no new lint errors. The parent spec's `tests/proctor-v2-phase2-75-multi-step-warnings-shape.test.js`, `tests/proctor-v2-phase2-75-multi-step-determinism.test.js`, and `tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js` continue to pass.

5. **One-sided monotonicity property (PBT)**: for any generated input, every per-class `bounds.classLowerBound` post-fix is `≤` the corresponding pre-fix value. Strict inequality occurs only on classes where pre-fix `floor(bTotal / bSize) > LB_global`.

6. **Determinism property (PBT)**: for any input, `serialize(V2'.run(input).classBoundsByProctorKey) === serialize(V2'.run(input).classBoundsByProctorKey)` (byte-equality across two runs).

### New Test Files

The following new test files are introduced by this spec; existing test files are unchanged except for the parent spec's exploration test which flips from FAIL to PASS as a consequence of this fix:

1. **`tests/proctor-v2-singleton-class-bounds-exploration.test.js`** (new) — bug condition exploration.
   - Synthetic singleton-with-G=10 input (test case 1 above), asserts pre-fix `classLowerBound = 10 > LB_global + 1 = 6`.
   - Synthetic non-singleton input with `bTotal/bSize > LB_global` (test case 2), asserts pre-fix the cap is needed for class A.
   - Production-fixture replay (test case 3), asserts pre-fix the six canonical keys have `classLowerBound` in 294–352.
   - Status: starts FAILING on unfixed code, flips to PASSING on fixed code.

2. **`tests/proctor-v2-singleton-class-bounds-fix.test.js`** (new) — fix checking.
   - Asserts post-fix that for each synthetic input from the exploration test, every per-class `classLowerBound ≤ LB_global + 1`.
   - Asserts post-fix that the production fixture has every canonical key's `classLowerBound ≤ 3`, `min(loadState) ≥ 2`, the six false-positive `coverageRepairWarnings` entries are absent, and `coverageRepairUnresolved ≤ 1`.
   - Asserts the upper-bound shape: `classUpperBound ≤ LB_global + 1` for every class, `classUpperBound ≥ classLowerBound` for every class.
   - Asserts `Object.keys(coverageRepairWarnings).filter(k => k !== '__pass__').length === diagnostics.coverageRepairUnresolved` (parent spec's identity, preserved post-fix).

3. **`tests/proctor-v2-singleton-class-bounds-preservation.pbt.test.js`** (new) — preservation property test.
   - fast-check generators for valid inputs (proctorsList, schedule, exemptions, duties, bounds).
   - Property: `serialize(V2(input).classBoundsByProctorKey) === serialize(V2'(input).classBoundsByProctorKey)` whenever `NOT isBugCondition(input)`.
   - Property: post-fix every per-class `classLowerBound` is `≤` the pre-fix value (one-sided monotonicity, holds for all inputs).
   - Property: determinism — `V2'.run(input)` run twice yields byte-identical `classBoundsByProctorKey`.

4. **`tests/proctor-v2-singleton-class-bounds-monotonicity.test.js`** (new) — monotonicity-guard unit test.
   - Unit test for `computeClassBounds` directly (call the function with a hand-crafted `classes` map and verify its returned `Map<classId, bounds>` matches expectations).
   - Test the four monotonicity-guard branches:
     - `bTotal > LB_global` AND `floor(bTotal/bSize) > LB_global` → cap fires, `classLowerBound = LB_global`, `classUpperBound = LB_global + 1`.
     - `bTotal > LB_global` AND `floor(bTotal/bSize) ≤ LB_global` → cap is no-op, byte-identical to pre-fix.
     - `bTotal ≤ LB_global` → monotonicity guard fires, `classLowerBound = bTotal`, `classUpperBound = bTotal`.
     - `bTotal = 0` (degenerate) → `classLowerBound = 0`, `classUpperBound = 0`.

5. **`tests/proctor-v2-singleton-class-bounds-integration.test.js`** (new) — integration with parent spec's tests.
   - Re-runs the parent spec's `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js` test case 3 (production fixture replay) and asserts post-fix it PASSES.
   - Re-runs the parent spec's `tests/proctor-v2-phase2-75-multi-step-fix.test.js` and asserts post-fix it PASSES.
   - Verifies that the parent spec's synthetic deficit-2 and deficit-3 inputs (test cases 1 and 2) still behave as designed by the parent spec — those inputs do not trigger this spec's bug condition, so the post-fix behavior is unchanged from the parent spec's expectations.

### Updated Test Files

1. **`tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js`** (existing, parent spec — currently FAILING).
   - Currently fails on test case 3 (production fixture replay) because طارق at load=1 is below the impossible `classLowerBound = 352`.
   - Post-fix this test PASSES without modification, because the corrected bound (3) is achievable and the inner repair loop closes the gap.

2. **`tests/proctor-v2-phase2-75-multi-step-fix.test.js`** (existing, parent spec — currently FAILING).
   - Currently fails on the production fixture pinpoint assertion (`min ≥ 2`, `coverageRepairUnresolved = 0`).
   - Post-fix this test PASSES without modification.

### Unit Tests

- **`computeClassBounds` LB_global derivation unit test**: with hand-crafted `classes`, `scheduleEntries`, `D_expected`, and `N`, drive the function and assert the internal `LB_global` value equals `floor((totalGuardSlots + D_expected) / N)` on the witness inputs.
- **`computeClassBounds` cap unit test**: with synthetic inputs where one class exceeds `LB_global`, assert the cap clamps `classLowerBound` to `LB_global` and `classUpperBound` to `LB_global + 1`.
- **`computeClassBounds` monotonicity-guard unit test**: with synthetic inputs where one class has `bTotal ≤ LB_global`, assert the guard retains `classLowerBound = bTotal` and `classUpperBound = bTotal`.
- **Determinism unit test**: same input → byte-identical `classBoundsByProctorKey` across two runs.

### Property-Based Tests

- **Cap-correctness property** (fast-check): generate inputs where at least one class has `bTotal/bSize > LB_global`. Property: post-fix every `classLowerBound ≤ LB_global + 1`.
- **One-sided monotonicity property** (fast-check): for any input, every post-fix `classLowerBound` is `≤` the pre-fix value.
- **Preservation property** (fast-check): generate inputs filtered to `NOT isBugCondition`. Property: `V2(input)` and `V2'(input)` agree on `classBoundsByProctorKey`.
- **Determinism property** (fast-check): for any input, `V2'.run(input).classBoundsByProctorKey` is observationally idempotent across two runs.

### Integration Tests

- **End-to-end production fixture run** (existing `scripts/verify-fixture.js`): post-fix reports P1/P2/P3 PASS with `min ≥ classLowerBound`.
- **End-to-end real-centre fixture run** (existing `scripts/verify-real-centre.js`): post-fix reports P1/P2/P3 PASS, no new regressions on the real-centre input.
- **Inspector script** (existing `scripts/inspect-fixture-state.js`): post-fix reports `zero-load proctors: 0`, `coverageRepairUnresolved ≤ 1`, histogram with no entries below 2.
- **Parent-spec test integration**: `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js` and `tests/proctor-v2-phase2-75-multi-step-fix.test.js` flip from FAIL to PASS after this fix lands.

## Out-of-Scope (Explicit)

The following changes are explicitly out of scope and SHALL NOT appear in any task derived from this design:

- Database schema migrations (`main/db/migrations.js` unchanged).
- IPC contract changes (`main/ipc/exam-config-data.js`, `preload.js` unchanged).
- Display-layer changes (`exams-rooms.html`, `exams-proctors.html` unchanged).
- Changes to `computeEligibilityClasses`, `getGuardSlotsForScheduleIndex`, `serializeClassBounds`, `collectUncovered`, `phase2_75CoverageRepair` (the parent spec's inner repair loop and diagnostics-shape migration stay as-is), `applyCoverageSwap`, `buildSwapCandidates`, `swapPreservesHardConstraints`, `violatesHardConstraints`, `getProctorKey`, `getProctorExemptionKey`, `phase2Build`, `phase2_5PopulateReserves`, `applyReserveSwap`, `phase3Optimize`.
- Changes to the duty pre-pass, the orchestrator, the diagnostics aggregator (other than benefiting from the absence of false-positive warnings).
- Silent rewrite of legacy DB rows (per requirement 3.15 — users must re-run distribution to obtain a post-fix payload).
- Any changes to `randomSeed` semantics or RNG plumbing.
- Adoption of Option A (merge singleton classes), Option B (two-tier bounds), or Option D (avgPeerSize cap) — explicitly rejected per the design rationale.
