# Proctor v2 — Strict Fairness & Full Coverage Bugfix Design

## Overview

The previous bugfix `proctor-v2-fairness-duty-reserves` made `costFunction` duty-aware (`getPrimaryLoad`), added a load-penalty term (`4 × max(0, primaryLoad − floor)`) and a `0.5` freshness bonus. Those changes are **soft**: they only steer Hungarian's tie-breaking. They cannot block an over-loaded teacher from receiving yet another guard whenever a soft penalty (e.g. `groupMismatch = 5`) outweighs the load-penalty contribution. They also do nothing for an eligible teacher who never enters any minimum-cost row of the assignment matrix — that teacher silently exits Phase 2 with `primaryLoad = 0`.

The user's running example confirms both leaks: in a 147-proctor center with `G = 368` guard tasks and `D_expected = 15` duty pairs, the upper bound on `primaryLoad` should be `ceil(383 / 147) = 3`, yet F produces one teacher at `5` and another at `1` — `max − min = 4`, which can only happen when the algorithm both (i) accepts a candidate above the bound and (ii) leaves an eligible peer at zero.

This bugfix lifts strict fairness and full coverage from soft preferences to **hard invariants**, restricted to the v2 algorithm:

1. Compute per-eligibility-class bounds `[classLowerBound_primary, classUpperBound_primary]` derived from `G_class + D_expected_class`, where `D_expected` is a new user-supplied input (default `0` — backward-compatible).
2. Inject a **HARD constraint** inside `costFunction`: any candidate whose post-assignment `primaryLoad > classUpperBound_primary` returns `INFINITY_SENTINEL`. The Hungarian solver therefore cannot pick over-loaded teachers regardless of soft-penalty trade-offs.
3. Add a new post-Phase-2 pass `phase2_75CoverageRepair` that swaps guard slots from over-loaded peers onto uncovered eligible proctors, terminating either when every eligible proctor has `primaryLoad ≥ 1` or when no further swap is feasible without violating a hard constraint.
4. Surface a small set of additive diagnostics (`coverageRepairSwaps`, `coverageRepairUnresolved`, `maxPrimaryLoadGapWithinClass`, `eligibilityClassCount`, `D_expected` divergence warning).

The fix lives in five edit sites inside `js/algorithms/proctor-distribution-v2.js` plus one input-build site in `exams-proctors.html`. No public API change, no v1 change, no row-shape change.

## Glossary

- **Bug_Condition (C):** the disjunction `C1 ∨ C2` from `bugfix.md` §"Bug Condition C(X)" — strict-fairness violation OR coverage violation on the `primaryLoad` axis.
- **Property (P):** the four numbered claims P1 (intra-class fairness), P2 (per-class bounds), P3 (coverage), P4 (preservation of prior invariants) from `bugfix.md` §"Correctness Properties".
- **Preservation:** every behaviour described under §3 (Unchanged Behavior) of `bugfix.md`, plus byte-identical v1 output.
- **F:** v2 as it ships today (post `proctor-v2-fairness-duty-reserves`). **F':** v2 after this fix.
- **`primaryLoad(T)`:** `guardCount(T) + dutyCount(T)`, exposed as `getPrimaryLoad(loadState, key)` (line ≈346). The fairness axis. Reserves are excluded.
- **`G`:** total guard tasks across the run window, `Σ over (entry, room) pairs: proctorsPerRoom`.
- **`D_expected`:** user-supplied non-negative integer in `examCenterConfig.expected_duty_tasks` (new field). Used **only** to compute fairness bounds. Default `0` — bounds collapse to guards-only.
- **`G_total`:** `G + D_expected`. The denominator-numerator pair in `floor(G_total / N) … ceil(G_total / N)`.
- **`N`:** `|eligibleProctors(input)|`, count of proctors who are hard-constraint eligible for at least one session.
- **Eligibility class (`C`):** equivalence class on `eligibleProctors` where `T1 ≡ T2` iff (a) for every session, `T1` is hard-constraint eligible iff `T2` is, AND (b) `T1` and `T2` carry identical pre-pinned duty halfday sets in `loadState`.
- **`G_class`:** guard tasks reachable by members of class `C`, `Σ over (i ∈ reachableSessionIndices, room r): proctorsPerRoom`.
- **`D_expected_class`:** the user-supplied `D_expected` proportionally split across classes (default rule: proportional to class size, residual handed to the largest classes — see §3.2).
- **`classLowerBound_primary`:** `floor((G_class + D_expected_class) / |C|)`.
- **`classUpperBound_primary`:** `ceil((G_class + D_expected_class) / |C|)`.
- **`classBoundsByProctorKey`:** `Map<proctorKey, { classLowerBound, classUpperBound }>` consumed by `costFunction` and `phase2_75CoverageRepair`.
- **`INFINITY_SENTINEL`:** existing v2 constant returned by `costFunction` to signal "this candidate is hard-constraint infeasible".

## Bug Details

### Bug Condition

```
FUNCTION isBugCondition(X)            // X = output of one F(input) run
  RETURN  C1(X) OR C2(X)
END FUNCTION
```

C1 — strict fairness on `primaryLoad` is violated within an eligibility class.
C2 — some eligible proctor exits the run with `primaryLoad = 0`.

The full Pascal-style spec is reproduced verbatim in `bugfix.md` §"Bug Condition C(X)" and is not duplicated here.

### Examples

- **C1 — single-class supply > demand.** 147 proctors all in one class, `G = 368`, `D_expected = 15` → `ceil(383 / 147) = 3`. F assigns one teacher 5 guards (post-fix `primaryLoad = 5`) while another is at 1 → gap = 4, P1 fails.
- **C1 — soft penalty wins over fairness.** Two teachers `T_idle` (zero load, wrong M/E group → `groupMismatch = 5`) and `T_busy` (already at `primaryLoad = upperBound + 1`, perfect-fit). Current cost: `T_idle = 0 (load) + 5 (group) + 0 (freshness) = 5`; `T_busy = 4 × max(0, 4 − 3) = 4 + 0.5 = 4.5`. Hungarian picks `T_busy`. F' returns `INFINITY_SENTINEL` for `T_busy` and Hungarian picks `T_idle`.
- **C2 — eligible teacher untouched.** `T` is eligible for 3 sessions; in F, every minimum-cost cell of those sessions' cost matrices was filled by another candidate; `T` exits with `guardCount = 0`, `dutyCount = 0`. F's `phase2_75CoverageRepair` finds an over-loaded peer whose slot is swap-feasible for `T` and swaps.
- **C2 — coverage already satisfied by duty.** `T` has `dutyCount(T) = 1`, `guardCount(T) = 0` → `primaryLoad(T) = 1 ≥ 1`. P3 holds; no repair needed; preservation requirement 2.10 also forbids assigning `T` a guard if `dutyCount(T) ≥ classUpperBound_primary`.
- **Edge — `D_expected = 0` (legacy fixture).** Bounds collapse to `floor(G / N), ceil(G / N)`; behaviour matches the prior spec.

## Expected Behavior

### Preservation Requirements

**Unchanged behaviours (must remain byte-identical or semantically identical):**

- All hard-constraint filtering: exemption (3.1), no double-assign within a session (3.2), duty-as-subject conflicts (3.3), `supervisors_per_room` exact (3.4), reserves contract from the prior spec (3.5), duty-aware cost contribution from the prior spec (3.6), `allowHalfdayReuse` / `allowDayReuse` (3.8), morning/evening preference as a soft constraint (3.9).
- Row schema unchanged — every existing field keeps its semantics; the only change is the four additive diagnostics fields listed in 2.8 (3.10).
- `input.dutyData` semantics unchanged — duty assignments are still user-supplied fixed input, the algorithm only reads `dutyCount` from `loadState` (3.11).
- v1 algorithm path (`runAutoDistribution`) is byte-identical to pre-fix output for the same inputs (3.7).

**Scope of the fix:** only inputs that satisfy `C(X)` see a behavioural change. For inputs where `¬C(X)`, F' must agree with F on every dimension that is not `loadState` redistribution (P4). The new `D_expected` setting and `phase2_75CoverageRepair` activate only when `input.D_expected ≥ 0` is plumbed and at least one eligible proctor would otherwise exit at `primaryLoad = 0` or above `classUpperBound_primary`.

## Hypothesized Root Cause

The prior bugfix `proctor-v2-fairness-duty-reserves` did three things:

1. Made `costFunction` duty-aware via `getPrimaryLoad` (replacing `getGuardCount`).
2. Added a soft load-penalty term `4 × max(0, primaryLoad − floor)` with `floor = max(lowerBound, sessionMaxPrimaryLoad − 1)`.
3. Added a `0.5` uniform "freshness" bonus on already-used teachers.

All three are **soft** — they only steer Hungarian's tie-breaking. The defects survive because:

1. **Soft load-penalty loses to soft constraints.** When `primaryLoad − floor = 1`, the load contribution is `4 × 1 + 0.5 = 4.5`. Any candidate carrying `groupMismatch = 5` has cost ≥ 5. Hungarian prefers the over-loaded teacher (cost 4.5) over the idle but mismatched peer (cost 5). The asymmetry compounds across rows: once a teacher is `2 × upperBound + 1`, the load penalty is `4 × 2 + 0.5 = 8.5`, but combined soft penalties can also reach 8 (group + room + specialty + gender = 5 + 3 + 2 + 1 = 11), so even there a soft penalty stack can win occasionally. There is no hard ceiling.
2. **No bound is computed per eligibility class.** The diagnostics expose a global `lowerBound`, but two classes with different reachable session counts and different baseline duty loads have different correct bounds. A class-blind global bound systematically under-bounds tight classes (where teachers can only reach a small subset of sessions) and over-bounds loose classes.
3. **No coverage repair exists.** An eligible teacher whose minimum-cost cells were always lost to a marginally-cheaper peer never re-enters the placement loop. The orchestrator drops out of Phase 2 with `loadState.guardCount = 0` for that teacher and Phase 3 SA never *creates* a new placement (`swap_roles` and `reassign_reserve` only mutate existing slots, never add an idle teacher to a row that has no empty slot).
4. **`D_expected` is not surfaced.** Bounds derived only from `G / N` are correct for the guards-only sub-problem but mis-target `primaryLoad`, which includes duty halfdays. A teacher with one duty halfday and `G / N = 2` should sit at `primaryLoad ∈ [2, 3]`, not `[2, 3]` on guard count alone (the mismatch grows as duty load grows).

The fix promotes the bound to a HARD ceiling inside `costFunction` (so Hungarian *cannot* place above it), adds the missing repair pass (so coverage is mechanically restored after Phase 2), and lets the user supply `D_expected` so the bounds are correctly anchored to the duty load they expect.

## Correctness Properties

Property 1: Bug Condition — Strict intra-class fairness on `primaryLoad`

_For any_ input where the bug condition holds (`isBugCondition` returns true via C1) and two proctors `T1`, `T2` belong to the same eligibility class, the fixed algorithm SHALL produce an output `X'` with `|primaryLoad(T1) − primaryLoad(T2)| ≤ 1`.

**Validates: Requirements 2.1, 2.4, 2.10**

Property 2: Bug Condition — Per-class bounds on `primaryLoad`

_For any_ input where the bug condition holds, the fixed algorithm SHALL produce an output where every member `T` of every eligibility class `C` satisfies `classLowerBound_primary_C ≤ primaryLoad(T) ≤ classUpperBound_primary_C`, with bounds computed from `G_class + D_expected_class` per the split rule in §3.2.

**Validates: Requirements 2.3, 2.4, 2.9, 2.13**

Property 3: Bug Condition — Full coverage on `primaryLoad`

_For any_ input where the bug condition holds (via C2) and a proctor `T` is hard-constraint eligible for at least one session, the fixed algorithm SHALL produce an output where `primaryLoad(T) ≥ 1` (a pre-pinned duty halfday alone is sufficient).

**Validates: Requirements 2.2, 2.5, 2.6, 2.7**

Property 4: Preservation — No regression on prior invariants

_For any_ input where the bug condition does NOT hold (`isBugCondition` returns false), the fixed function SHALL produce the same result as the original function on every preserved dimension: hard-constraint filtering (exemption, double-assign, duty-as-subject), `supervisors_per_room` exact, reserves contract from the prior spec, halfday/day reuse flags, M/E preference as a soft constraint, row schema unchanged, `dutyData` semantics unchanged, and v1 byte-identical to pre-fix v1.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11**

## Fix Implementation

### Architecture overview

Seven edit sites, each addressing a specific clause of the bugfix. No new modules, no new files. Approximate line numbers are anchored to the current `proctor-distribution-v2.js` (`costFunction ≈ 1294`, `phase2Build ≈ 1451`, `phase2_5PopulateReserves ≈ 2147`, `phase3Optimize ≈ 3005`, orchestrator return `≈ 3677`) and `exams-proctors.html` (`buildV2Input ≈ 2590`, `dist-inline-rules` panel `≈ 266`, `getDistributionRules ≈ 1539`).

| # | File | Function / Component | Property | Nature of change |
|---|------|----------------------|----------|------------------|
| 1 | `js/algorithms/proctor-distribution-v2.js` | new `computeEligibilityClasses` | P1, P2 | Partition `proctorsList` into classes by (eligibility set, dutyHalfdays size). |
| 2 | `js/algorithms/proctor-distribution-v2.js` | new `computeClassBounds` | P2, 2.9, 2.13 | Split `D_expected` proportionally; return `{ classId → { classLowerBound, classUpperBound } }`. |
| 3 | `js/algorithms/proctor-distribution-v2.js` | `costFunction` (≈1294) | C1, P1, P2, 2.4, 2.10 | Return `INFINITY_SENTINEL` when `getPrimaryLoad + 1 > classUpperBound_primary`. |
| 4 | `js/algorithms/proctor-distribution-v2.js` | new `phase2_75CoverageRepair` | C2, P3, 2.5, 2.6, 2.7 | Swap guard slots from over-loaded peers onto uncovered eligible proctors. |
| 5 | `js/algorithms/proctor-distribution-v2.js` | `phase2Build` (≈1451) | P1, P2 | Wire `classBoundsByProctorKey` into `costOptions`. |
| 6 | `exams-proctors.html` | `buildV2Input` (≈2590) + new UI input in `dist-inline-rules` (≈266) | 2.11, 2.9 | Read `examCenterConfig.expected_duty_tasks`; forward to `input.D_expected`. |
| 7 | `js/algorithms/proctor-distribution-v2.js` | orchestrator (≈3677) + diagnostics | 2.8, 2.12 | Insert pass call; merge diagnostics; emit divergence warning when `|D_expected − Σ dutyCount| / max(D_expected, 1) > 0.2`. |

### 1. `computeEligibilityClasses(proctorsList, scheduleEntries, exemptionsData, dutyData, loadState)`

**Inputs**
- `proctorsList: Array<Proctor>` — the run's proctor pool.
- `scheduleEntries: Array<ScheduleEntry>` — every session in the run window.
- `exemptionsData: Object<string, Object>` — keyed by exemption key; `loadState` is consulted for already-pinned duty halfdays.
- `dutyData: Object` — same shape as `input.dutyData`; consumed only to confirm `loadState` reflects the pre-pinned pairs.
- `loadState: Object` — the `loadState` returned by `phase1PrePass`, after `addDutyLoad` has populated `dutyHalfdays`.

**Output**
- `Map<classId, { members: Proctor[], reachableSessionIndices: number[], baselineDutyCount: number }>`.

**Pseudocode**

```
FUNCTION computeEligibilityClasses(proctorsList, scheduleEntries, exemptionsData, dutyData, loadState)
  classes ← new Map()

  FOR EACH (T, idx) IN enumerate(proctorsList):
    key       ← getProctorExemptionKey(T, idx)
    eligible  ← []
    FOR EACH (entry, i) IN enumerate(scheduleEntries):
      IF NOT isExemptForEntry(T, idx, entry, exemptionsData)
         AND NOT isOnDutyDuringHalfday(key, entry.halfday_key, loadState) THEN
        eligible.push(i)
      END IF
    END FOR

    IF eligible IS empty THEN CONTINUE                 // not eligible for any session

    baselineDuty ← size(loadState.dutyHalfdays(key))
    classKey     ← stableHash(eligible, baselineDuty)
    cls          ← classes.get(classKey) OR { members: [], reachableSessionIndices: eligible, baselineDutyCount: baselineDuty }
    cls.members.push({ key, proc: T, idx })
    classes.set(classKey, cls)
  END FOR

  RETURN classes
END FUNCTION
```

**Edge cases**

| Case | Behaviour |
|------|-----------|
| `proctorsList` empty | Returns empty map; downstream `computeClassBounds` returns empty bounds; `costFunction` hard cap inactive. |B — العدّ بالسلوتات فقط
| Every proctor exempt for every session | Returns empty map; orchestrator emits a warning via the existing `phase2Diagnostics` and proceeds. |
| Two proctors with identical eligibility but different `baselineDutyCount` | Land in different classes — bounds correctly bracket their respective `primaryLoad`. |
| `loadState.dutyHalfdays` not yet populated | Function MUST be called *after* `phase1PrePass`; otherwise `baselineDutyCount = 0` for everyone and classes coalesce incorrectly. Document the call-order invariant in `phase2Build`. |

**Determinism notes**
- `stableHash` is a deterministic encoder (e.g. `eligible.join(',') + '|' + baselineDuty`). No `rng` use here.
- Map iteration order downstream is the insertion order; pseudocode that iterates `classes` MUST sort by `classKey` (lex) before any user-visible diagnostic to keep snapshots stable.

### 2. `computeClassBounds(classes, scheduleEntries, proctorsPerRoom, D_expected, N)`

**Inputs**
- `classes` — output of §3.1.
- `scheduleEntries`, `proctorsPerRoom` — to compute `G_class` per class.
- `D_expected: number ≥ 0` — user-supplied; forwarded from `input.D_expected`.
- `N: number` — `|eligibleProctors|`.

**Output**
- `Map<classId, { classLowerBound: number, classUpperBound: number, G_class: number, D_expected_class: number }>`.

**Pseudocode**

```
FUNCTION computeClassBounds(classes, scheduleEntries, proctorsPerRoom, D_expected, N)
  bounds ← new Map()

  // === Single-class fast path ===
  IF size(classes) = 1 THEN
    [onlyClassId, onlyClass] ← classes.entries()[0]
    G_class ← Σ over (i ∈ onlyClass.reachableSessionIndices, room ∈ rooms(scheduleEntries[i])): proctorsPerRoom
    G_total_class ← G_class + D_expected
    bounds.set(onlyClassId, {
      classLowerBound: floor(G_total_class / size(onlyClass.members)),
      classUpperBound: ceil(G_total_class / size(onlyClass.members)),
      G_class, D_expected_class: D_expected
    })
    RETURN bounds
  END IF

  // === Multi-class case ===
  G_class_by_id ← new Map()
  FOR EACH (id, C) IN classes:
    G_class ← Σ over (i ∈ C.reachableSessionIndices, room ∈ rooms(scheduleEntries[i])): proctorsPerRoom
    G_class_by_id.set(id, G_class)
  END FOR

  // Proportional split of D_expected across classes by class size.
  D_share_by_id ← new Map()
  D_assigned   ← 0
  FOR EACH (id, C) IN classes:
    share ← floor(D_expected × size(C.members) / N)
    D_share_by_id.set(id, share)
    D_assigned += share
  END FOR

  // Residual: D_expected − D_assigned ∈ [0, classes.size). Hand +1 to the largest classes
  // (tiebreak by classKey ascending) until residual = 0.
  residual ← D_expected − D_assigned
  FOR EACH id IN classes.keys() sorted by (−size(C.members), id) WHILE residual > 0:
    D_share_by_id.set(id, D_share_by_id.get(id) + 1)
    residual -= 1
  END FOR

  FOR EACH (id, C) IN classes:
    G_class           ← G_class_by_id.get(id)
    D_expected_class  ← D_share_by_id.get(id)
    G_total_class     ← G_class + D_expected_class
    bounds.set(id, {
      classLowerBound: floor(G_total_class / size(C.members)),
      classUpperBound: ceil(G_total_class / size(C.members)),
      G_class, D_expected_class
    })
  END FOR

  RETURN bounds
END FUNCTION
```

**Edge cases**

| Case | Behaviour |
|------|-----------|
| `D_expected = 0` | Bounds collapse to `floor(G_class / |C|), ceil(G_class / |C|)` for every class. Backward-compatible. |
| `size(C.members) = 1` (singleton class) | `lower = upper = G_total_class`. The singleton must take all reachable guards; the hard cap effectively turns off for them. |
| Tiny class proportional split rounds to 0 | Residual loop hands +1 to the largest classes first; tiny classes can stay at `D_share = 0`, which is correct (their bound stays at `floor(G_class / |C|)`). |
| `G_class = 0` (every member exempt for every guard-bearing session) | `classLowerBound = classUpperBound = floor(D_expected_class / |C|)`. Hard cap blocks any guard placement on these members — they rely on duty alone for coverage. |
| `D_expected > G + N` (user typo) | Bounds become arbitrarily large; hard cap inactive in practice. Handled by the divergence warning (§3.7). |

**Determinism notes**
- All operations are deterministic given the iteration order of `classes`.
- The "sort by `(−size(members), id)`" rule is total: ties on size are broken by `classKey`, which is itself a deterministic hash of `(eligible, baselineDuty)`.

### 3. Hard-constraint addition in `costFunction` (≈1294)

The current function (lines ≈1294–1366) ends with the soft load-penalty + freshness term. The hard cap is added **after** the existing `usedInSession` check and **before** any soft-penalty accumulation, so the early `INFINITY_SENTINEL` short-circuits all downstream work.

**Pseudocode (insert at the boundary marked `// === Soft Constraint Penalties ===`)**

```
// Hard constraint: per-class primaryLoad upper bound (Requirements 2.4, 2.10).
// `classBoundsByProctorKey` is set by `phase2Build` exactly once per run via `costOptions`.
// When absent (older callers, fixtures without classBounds), the cap is inactive — old
// soft-penalty behaviour is preserved (Requirement 3.6).
IF options.classBoundsByProctorKey THEN
  classBounds ← options.classBoundsByProctorKey[proctorKey]
  IF classBounds THEN
    postAssignmentPrimary ← getPrimaryLoad(loadState, proctorKey) + 1
    IF postAssignmentPrimary > classBounds.classUpperBound THEN
      RETURN INFINITY_SENTINEL
    END IF
  END IF
END IF
```

**Why "after `usedInSession`"**: `usedInSession` is itself a hard rule and must remain the first cheap check. Why "before soft penalties": cheaper short-circuit + matches the semantic ordering "hard rules → soft penalties".

**Signature**: unchanged. The existing `options` argument carries the new field. `greedyFallback` reads `costFunction` indirectly and inherits the cap automatically.

**Edge cases**

| Case | Behaviour |
|------|-----------|
| `options.classBoundsByProctorKey` absent | Cap inactive — old behaviour preserved (Requirement 3.6 / P4). |
| `classBounds` for `proctorKey` absent (proctor not classified, e.g. ineligible for any session) | Cap inactive for that proctor — `usedInSession` and soft penalties still apply. |
| `getPrimaryLoad + 1 = classUpperBound` (post-assignment exactly at the bound) | Cap **does not fire** (`>` not `≥`). Bound is inclusive. |
| `dutyCount(T) ≥ classUpperBound` (Requirement 2.10) | `getPrimaryLoad ≥ classUpperBound`, so `+1 > classUpperBound` always — cap fires for every guard placement on `T`. Coverage is already satisfied by duty alone. |
| Hungarian matrix becomes infeasible for a row (every candidate hits cap) | Hungarian falls through to existing `greedyFallback` (line ≈1860); greedy inherits the cap and may leave the slot empty (`shortages++`). The existing shortage-warning path emits the diagnostic. |

**Determinism notes**: `INFINITY_SENTINEL` is a constant; no `rng` use; cap is purely a function of `loadState` and `classBounds`, both deterministic.

### 4. `phase2_75CoverageRepair(phase2Result, phase2_5Result, classBoundsByProctorKey, input, rng)`

**Pipeline position**

```
phase1PrePass(input)
phase2Build(phase1Result, input, rng)                                       // emits classBoundsByProctorKey
phase2_5PopulateReserves(phase2Result, input, rng)
phase2_75CoverageRepair(phase2Result, phase2_5Result, classBoundsByProctorKey, input, rng)   // NEW
phase3Optimize(phase2Result, input, rng, saConfig)
```

The repair pass runs **after** `phase2_5PopulateReserves` so that any reserve-driven `loadState` updates (which do not affect `primaryLoad`) are already in place, and **before** `phase3Optimize` so that SA optimisation sees the already-covered roster (otherwise SA could undo the repair by accepting a row swap that re-strands the uncovered teacher).

**Inputs**
- `phase2Result.assignments` — array of rows, each with `session_key`, `halfday_key`, `proctor_keys`, `proctors`.
- `phase2Result.loadState` — mutated in place via `addGuardLoad` / removal helper.
- `phase2_5Result` — read for diagnostics merging only.
- `classBoundsByProctorKey` — `Map<key, { classLowerBound, classUpperBound }>`.
- `input.proctorsList`, `input.exemptionsData`, `input.dutyData`, `input.options.allowHalfdayReuse/allowDayReuse`.
- `rng` — seeded PRNG for tie-breaks.

**Outputs**
- Mutates `row.proctor_keys`, `row.proctors`, `loadState.guardCount`, `loadState.guardHalfdays` for swapped pairs.
- Returns `{ swaps: number, unresolved: number, durationMs: number, warnings: Array<{ proctorKey, reason }> }`.

**Pseudocode**

```
FUNCTION phase2_75CoverageRepair(phase2Result, phase2_5Result, classBoundsByProctorKey, input, rng)
  startTime    ← Date.now()
  loadState    ← phase2Result.loadState
  rows         ← phase2Result.assignments
  swaps        ← 0
  unresolved   ← 0
  warnings     ← []

  uncovered ← collectUncovered(input.proctorsList, classBoundsByProctorKey, loadState)
  IF uncovered IS empty THEN
    RETURN { swaps: 0, unresolved: 0, durationMs: Date.now() − startTime, warnings: [] }
  END IF

  // Stable, deterministic order: by classId then rng() tiebreak.
  uncovered.sortBy(t → [classIdOf(t), rng()])

  FOR EACH T_uncov IN uncovered:
    classBounds ← classBoundsByProctorKey[T_uncov.key]
    IF classBounds IS missing THEN
      unresolved += 1
      warnings.push({ proctorKey: T_uncov.key, reason: 'no_class_bounds' })
      CONTINUE
    END IF
    classUB ← classBounds.classUpperBound
    classID ← classIdOf(T_uncov)

    candidates ← buildSwapCandidates(rows, T_uncov, classID, loadState, classUB + 1, input)

    IF candidates IS empty THEN
      // Soften: also accept peers exactly at classUB
      candidates ← buildSwapCandidates(rows, T_uncov, classID, loadState, classUB, input)
    END IF

    IF candidates IS empty THEN
      unresolved += 1
      warnings.push({ proctorKey: T_uncov.key, reason: 'no_swappable_peer' })
      CONTINUE
    END IF

    // Pick the most over-loaded peer; rng() breaks remaining ties.
    best ← argmax_{c ∈ candidates}(primaryLoad(loadState, c.T_over.key)) tiebreak rng()
    applySwap(best.row, best.slotIndex, T_uncov, best.T_over, loadState)
    swaps += 1
  END FOR

  RETURN { swaps, unresolved, durationMs: Date.now() − startTime, warnings }
END FUNCTION


FUNCTION collectUncovered(proctorsList, classBoundsByProctorKey, loadState)
  result ← []
  FOR EACH (T, idx) IN enumerate(proctorsList):
    key ← getProctorExemptionKey(T, idx)
    IF classBoundsByProctorKey HAS key
       AND getPrimaryLoad(loadState, key) = 0 THEN
      result.push({ key, proc: T, idx })
    END IF
  END FOR
  RETURN result
END FUNCTION


FUNCTION buildSwapCandidates(rows, T_uncov, classID, loadState, minOverloadThreshold, input)
  candidates ← []
  FOR EACH (row, rowIndex) IN enumerate(rows):
    FOR EACH (slotIndex, T_over_key) IN enumerate(row.proctor_keys):
      IF NOT T_over_key THEN CONTINUE
      IF classIdOfKey(T_over_key) ≠ classID THEN CONTINUE
      IF getPrimaryLoad(loadState, T_over_key) < minOverloadThreshold THEN CONTINUE

      T_over ← lookupProctor(T_over_key, input.proctorsList)
      IF NOT swapPreservesHardConstraints(row, slotIndex, T_uncov, T_over, loadState, input) THEN CONTINUE

      candidates.push({ row, rowIndex, slotIndex, T_over })
    END FOR
  END FOR
  RETURN candidates
END FUNCTION


FUNCTION swapPreservesHardConstraints(row, slotIndex, T_uncov, T_over, loadState, input)
  // 1. T_uncov not exempt for the row's session.
  IF isExemptForEntry(T_uncov.proc, T_uncov.idx, row.scheduleEntry, input.exemptionsData) THEN RETURN false
  // 2. T_uncov not on duty during the row's halfday.
  IF isOnDutyDuringHalfday(T_uncov.key, row.halfday_key, loadState) THEN RETURN false
  // 3. T_uncov not already a guard in the row's session (would create a duplicate).
  IF row.proctor_keys CONTAINS T_uncov.key THEN RETURN false
  // 4. Reuse rules for guards on halfday / day must still hold.
  IF NOT input.options.allowHalfdayReuse
     AND T_uncov.key already used in halfday_key (excluding the slot we vacate) THEN RETURN false
  IF NOT input.options.allowDayReuse
     AND T_uncov.key already used in dayKey(halfday_key) (excluding the slot we vacate) THEN RETURN false
  RETURN true
END FUNCTION


FUNCTION applySwap(row, slotIndex, T_uncov, T_over, loadState)
  // Remove T_over from this slot.
  row.proctor_keys[slotIndex] ← T_uncov.key
  row.proctors[slotIndex]     ← T_uncov.proc.teacher_name OR ''

  // Update loadState. Touch ONLY guardCount / guardHalfdays.
  // dutyCount and dutyHalfdays are untouched (Requirement 2.7, 3.11).
  removeGuardLoad(loadState, T_over.key, row.halfday_key)
  addGuardLoad(loadState, T_uncov.key, row.halfday_key, T_uncov.proc.teacher_name OR '')
END FUNCTION
```

**`removeGuardLoad`** is the symmetric counterpart of the existing `addGuardLoad`. It MUST decrement `loadState.guardCount[key]` and remove the halfday from `loadState.guardHalfdays[key]` only when no other slot in the same halfday still holds `key`. Implementation note: scan `rows` filtered to the same halfday before deletion, identical to the v1 reserve-removal pattern.

**Edge cases**

| Case | Behaviour |
|------|-----------|
| `uncovered` empty | Return immediately with `swaps = 0, unresolved = 0`. Pass is a no-op. |
| No over-loaded peer in the same class (every peer at `≤ classUB`) | Soft step accepts peers exactly at `classUB`; if still empty, `unresolved++`, warning emitted (Requirement 2.6). Pass continues for the next uncovered teacher. |
| Soft step would push `T_over` from `classUB` to `classUB − 1`, dropping below `classLB` | Cannot happen. Pre-condition `primaryLoad(T_over) ≥ classUB` and `classLB ≤ classUB`, so `primaryLoad(T_over) − 1 ≥ classUB − 1 ≥ classLB − 1`. Combined with the post-swap state of `T_uncov` (load 1) and the symmetry constraint `T_over` and `T_uncov` are in the same class, the worst case is `primaryLoad(T_over) = classUB` after swap, never below `classLB`. |
| Swap candidate `T_over` is also marked `uncovered` (rare due to `primaryLoad ≥ classUB ≥ 1`) | Not possible by construction; `uncovered` requires `primaryLoad = 0`. |
| `T_uncov.dutyCount ≥ classUpperBound` | Then `T_uncov.primaryLoad ≥ classUpperBound ≥ 1`, so `T_uncov` is NOT in `uncovered` to begin with. The pass never assigns a guard to such a teacher (Requirement 2.10). |
| Multiple uncovered teachers in the same class | Sorted deterministically by `(classID, rng())`. Each takes the most over-loaded peer; subsequent picks see the updated `loadState`, so the second uncovered teacher will not steal from the first's freshly-loaded peer unless that peer is still above the threshold. |
| Pass exceeds a soft time budget (e.g. > 50 ms) | Set a soft cap of 50 ms; on overflow, mark remaining uncovered teachers as `unresolved` with reason `'time_budget'`. Run continues. |

**Determinism notes**: every tie-break that matters for output snapshots uses `rng()` from the seeded PRNG that already powers Phases 1–3. The `argmax` step is deterministic given identical `loadState` and `rng` history.

### 5. `phase2Build` integration (≈1451)

**Pseudocode (insert just before `costOptions` is built, i.e. before line ≈1787)**

```
classes      ← computeEligibilityClasses(input.proctorsList, input.scheduleEntries,
                                         input.exemptionsData, input.dutyData,
                                         phase1Result.loadState)
classBounds  ← computeClassBounds(classes, input.scheduleEntries,
                                  input.examDistributionRules.proctorsPerRoom,
                                  Number(input.D_expected) OR 0,
                                  size(eligibleProctors(input)))

classBoundsByProctorKey ← {}
FOR EACH (classId, C) IN classes:
  bounds ← classBounds.get(classId)
  FOR EACH member IN C.members:
    classBoundsByProctorKey[member.key] ← bounds
END FOR

// Threaded into the existing costOptions built at line ≈1787:
costOptions.classBoundsByProctorKey ← classBoundsByProctorKey
```

The remainder of `phase2Build` is untouched — Hungarian and greedy fallback both consume the new field via `costOptions`.

**Phase2 diagnostics gain two additive fields:**

```
phase2Diagnostics.eligibilityClassCount  ← classes.size
phase2Diagnostics.classBounds            ← serialise(classBounds)   // for the diagnostics panel
```

The orchestrator merges these into the top-level `diagnostics` object (§3.7).

**Edge cases**

| Case | Behaviour |
|------|-----------|
| `input.D_expected` undefined / null | `Number(undefined) = NaN`, falls through `OR 0` → `D_expected = 0`. Bounds collapse to guards-only (Requirement 2.9, backward-compat). |
| Single-class, single-eligibility-set centre (the user's 147-proctor case) | `classes.size = 1`, fast path in `computeClassBounds` returns one bound; every proctor key maps to the same bounds. |
| `proctorsPerRoom = 0` (degenerate config) | `G_class = 0` for every class; bounds derive from `D_expected_class / |C|` only. |

**Determinism notes**: `classes` insertion order is the order of `proctorsList`; `computeClassBounds` is deterministic given the input order; `classBoundsByProctorKey` is a flat map keyed by proctor key — order-independent in consumption.

### 6. UI / Input contract (`buildV2Input` ≈2590, `dist-inline-rules` panel ≈266)

**Storage location.** `examCenterConfig.expected_duty_tasks: number ≥ 0`. Persisted via the existing `window.api.examConfig.save({ school_year, config_key: 'examCenterConfig', data })` channel. Default when missing: `0`.

**UI surface.** Add a third numeric input next to `dist-proctors-per-room-input` and `dist-reserves-per-session-input` inside `<div id="dist-inline-rules">` (≈line 266). Numeric, `min="0"`, `step="1"`, default `0`.

```
LABEL    : عدد مهام المداومة المتوقَّع
TOOLTIP  : يستعمل لحساب متوسط حصص الحراسة لكل أستاذ عند تطبيق العدالة.
           لا يحدد من يداوم فعلياً — ذلك يبقى من شاشة "الأساتذة المداومون".
INPUT-ID : dist-expected-duty-tasks-input
```

**Persistence wiring.** Mirror the existing `dist-reserves-per-session-input` save logic (≈line 1218):

```
listen('change', '#dist-expected-duty-tasks-input'):
  examCenterConfig ← await window.api.examConfig.get(year, 'examCenterConfig') OR {}
  examCenterConfig.expected_duty_tasks ← Math.max(0, Number(input.value) OR 0)
  await window.api.examConfig.save({ school_year: year,
                                     config_key: 'examCenterConfig',
                                     data: examCenterConfig })
  await updateDistStatuses()
```

**`buildV2Input` change.** Inside the existing examCenterConfig read (already at ≈line 2642), after `reservesConfig` is derived, add:

```
return {
  ...,
  reservesConfig,
  D_expected: Math.max(0, Number(examCenterConfig.expected_duty_tasks) OR 0),   // NEW
  ...
};
```

`validateInput` gains one optional check: if `input.D_expected` is present, assert `Number.isFinite(input.D_expected) && input.D_expected >= 0`. If missing, default to `0` so older callers (tests, fixtures) keep working.

**Edge cases**

| Case | Behaviour |
|------|-----------|
| Field absent in saved blob | Defaults to `0` — bounds collapse to guards-only. |
| User types negative number | Clamped to `0` by `Math.max(0, …)`. |
| User types non-numeric | `Number(…)` returns `NaN`; `OR 0` yields `0`. |
| `examCenterConfig` not yet saved at all | `(await window.api.examConfig.get(...)) OR {}` returns `{}`; `expected_duty_tasks` undefined; `D_expected = 0`. |

### 7. Orchestrator integration & diagnostics (≈3500–3677)

**Pipeline call insertion (between Phase 2.5 and Phase 3, current ≈line 3505 → ≈3532):**

```
// Existing — Phase 2.5
var phase2_5Diagnostics = phase2_5PopulateReserves(phase2Result, input, rng);

// NEW — Phase 2.75 coverage repair
var phase2_75Diagnostics
try:
  phase2_75Diagnostics = phase2_75CoverageRepair(
    phase2Result,
    phase2_5Diagnostics,
    phase2Result.classBoundsByProctorKey,
    input,
    rng
  )
catch (err):
  // Soft failure: log warning, set zero-result diagnostics, continue.
  console.warn('[V2] phase2_75CoverageRepair error:', err)
  phase2_75Diagnostics = { swaps: 0, unresolved: 0, durationMs: 0, warnings: [{ reason: 'pass_threw' }] }

// Existing — Phase 3
phase3Result = phase3Optimize(phase2Result, input, rng, saConfig)
```

**Diagnostics merge (additive, before `return { result, diagnostics }` at ≈line 3677):**

```
diagnostics.coverageRepairSwaps        ← phase2_75Diagnostics.swaps
diagnostics.coverageRepairUnresolved   ← phase2_75Diagnostics.unresolved
diagnostics.coverageRepairDurationMs   ← phase2_75Diagnostics.durationMs
diagnostics.coverageRepairWarnings     ← phase2_75Diagnostics.warnings
diagnostics.eligibilityClassCount      ← phase2Result.diagnostics.eligibilityClassCount

// max gap within any class — useful for the diagnostics panel.
diagnostics.maxPrimaryLoadGapWithinClass ← computeMaxGapWithinClass(
  phase2Result.classBoundsByProctorKey,
  phase2Result.loadState
)
```

**`D_expected` divergence warning:**

```
actualDutyPairs ← Σ over T ∈ eligibleProctors(input): dutyCount(loadState, T.key)
diff            ← abs((input.D_expected OR 0) − actualDutyPairs)
IF (input.D_expected OR 0) > 0
   AND diff / max(input.D_expected, 1) > 0.2 THEN
  diagnostics.warnings.push({
    type: 'd_expected_divergence',
    expected: input.D_expected,
    actual:   actualDutyPairs,
    message:  'D_expected = ' + input.D_expected
              + '، لكن عدد أزواج المداومة الفعلي = ' + actualDutyPairs
              + '؛ قد تكون حدود العدالة المعروضة غير محدّثة.'
  })
END IF
```

**Edge cases**

| Case | Behaviour |
|------|-----------|
| `phase2_75CoverageRepair` throws | Caught, run continues, `unresolved` reported as 0 with a `'pass_threw'` warning. No regression on existing rows (they were already produced by Phase 2 + 2.5). |
| `D_expected = 0` (legacy) | Divergence check skipped (`(input.D_expected OR 0) > 0`). |
| `D_expected = 100`, `actualDutyPairs = 80` | `diff / max(100, 1) = 0.20` — not above threshold; no warning. |
| `D_expected = 100`, `actualDutyPairs = 70` | `diff / 100 = 0.30` — above threshold; warning emitted, run continues. |

## Data contract changes

### Input shape — additive

| Field | Type | Default | Source |
|-------|------|---------|--------|
| `input.D_expected` | `number ≥ 0` | `0` | `buildV2Input` reads `examCenterConfig.expected_duty_tasks`. |

No other input field changes. The existing `input.reservesConfig` (from the prior spec) is unaffected.

### Output shape — unchanged (only additive diagnostics)

Each row keeps every existing field. The orchestrator's `diagnostics` object gains:

| Field | Type | Meaning |
|-------|------|---------|
| `coverageRepairSwaps` | `number` | Count of swaps performed by Phase 2.75. |
| `coverageRepairUnresolved` | `number` | Count of eligible proctors still uncovered after the pass. |
| `coverageRepairDurationMs` | `number` | Wall-clock cost of the pass. |
| `coverageRepairWarnings` | `Array<{ proctorKey, reason }>` | Per-teacher reason codes for unresolved cases. |
| `eligibilityClassCount` | `number` | Number of distinct eligibility classes. |
| `maxPrimaryLoadGapWithinClass` | `number` | `max over classes of (max(primaryLoad) − min(primaryLoad))`. Should be `≤ 1` after the fix (P1). |
| `warnings[]` (existing array) | gains optional `{ type: 'd_expected_divergence', expected, actual, message }` entries when applicable. |

Old snapshots without these fields render correctly (rendering code reads them via `?.` / `||` fallbacks).

## Migration / Backward compatibility

- **Legacy fixtures (`expected_duty_tasks` absent).** `buildV2Input` defaults `input.D_expected = 0`; `computeClassBounds` collapses to guards-only; `costFunction` hard cap activates only when `classBoundsByProctorKey` is populated, which in turn requires a non-empty `classes` map — i.e. at least one eligible proctor. For existing centres, the cap fires only when over-loading actually occurs, so the regression surface is exactly `C(X) ⇒ behaviour change` (P4 / P6 of the prior spec).
- **Saved auto-distribution blobs.** Structure unchanged. New diagnostic fields are additive; the diagnostics panel renders missing fields as `—`. Pre-fix saves still load and render correctly.
- **v1 path (`runAutoDistribution`).** Untouched. Property P4 reasserts byte-equality against a pre-fix snapshot.
- **`costFunction` callers without `classBoundsByProctorKey`.** Cap inactive — old soft-penalty behaviour preserved (Requirement 3.6). `greedyFallback` is unaffected for the same reason.
- **Unresolvable rows fallback.** When Hungarian + `greedyFallback` cannot fill a slot because every candidate hits the hard cap, the orchestrator can opt-in to a final unconstrained pass with `costOptions.skipClassCap = true` for that specific row only. This is a last-resort lever; default behaviour leaves the slot empty (`shortages++`) and emits the existing shortage warning, matching the prior spec.

## Testing Strategy

### Validation Approach

Two phases. First, surface counterexamples on the **unfixed** code that demonstrate C1 and C2 — confirming the root-cause analysis. If any exploratory test passes on F (no counterexample), the analysis is wrong and we re-hypothesize. Second, run the property suite against F' to verify P1–P4.

### Exploratory Bug Condition Checking

**Goal:** demonstrate C1 and C2 on the unfixed code.

**Test plan:** small fixture inputs (≤ 30 proctors, ≤ 20 sessions), assertions stated as Property checks. Run on F (current `proctor-distribution-v2.js`) before the fix is applied.

| # | Name | Trigger | Expected failure on F |
|---|------|---------|------------------------|
| 1 | C1 — soft penalty wins | `T_idle` carries `groupMismatch`, `T_busy` is at `upperBound + 1` and perfect-fit | F places `T_busy`; `primaryLoad(T_busy) > classUpperBound` → P2 fails |
| 2 | C1 — single-class gap | 30 proctors all in one class, `G = 80`, `D_expected = 0` → bounds `[2, 3]` | F yields some teacher at 5 and another at 1 → `max − min = 4`, P1 fails |
| 3 | C2 — uncovered eligible teacher | 5 eligible peers per session, one teacher loses every minimum-cost cell | F leaves `primaryLoad(T) = 0` → P3 fails |
| 4 | C1 — cross-soft-stack | `T_busy` at `upperBound + 2`, every soft penalty zero; `T_idle` carries 4 + 3 + 2 = 9 of soft penalties | F may pick `T_busy` (cost 8.5) over `T_idle` (cost 9) → P2 fails |
| 5 | UI plumbing | `examCenterConfig.expected_duty_tasks = 15` is saved, then `buildV2Input` is invoked | `input.D_expected === 15` (assertion on `buildV2Input` output) — fails on F because the field is not yet read |

**Expected counterexamples & root-cause confirmation:** the failures above pinpoint the four fix surfaces (`computeEligibilityClasses` + `computeClassBounds`, `costFunction` hard cap, `phase2_75CoverageRepair`, `buildV2Input`). If C1 tests pass on F (e.g. because `primaryLoad − floor` happens to be high enough that the soft penalty never wins), we re-examine the floor-vs-soft-penalty interaction and may need to retune the cap threshold.

### Fix Checking

**Goal:** for every input where `C(X)` holds, F' produces an output that satisfies the corresponding property.

```
FOR ALL input WHERE isBugCondition(F(input)) DO
  X' := F'(input)
  ASSERT NOT isBugCondition(X')
  ASSERT P1(X') AND P2(X') AND P3(X') AND P4(X')
END FOR
```

### Preservation Checking

**Goal:** for every input where `¬C(X)` (no fairness gap, no coverage gap, no over-bound load), F' equals F on every dimension. Property-based testing is the right tool because preservation is a universal claim across the input space.

```
FOR ALL input WHERE NOT isBugCondition(F(input)) DO
  ASSERT proctor_keys(F(input))             = proctor_keys(F'(input))
  ASSERT loadState.guardCount(F(input))     = loadState.guardCount(F'(input))
  ASSERT loadState.dutyCount(F(input))      = loadState.dutyCount(F'(input))
  ASSERT row.reserves(F(input))             = row.reserves(F'(input))
  ASSERT softViolations(F(input))           = softViolations(F'(input))
END FOR
```

**Test plan**: generate random `(proctorsList, scheduleEntries, exemptionsData, dutyData, D_expected)` quintuples, run F (snapshot of pre-fix v2 saved as a frozen module) and F' on the same input, compare row-by-row.

### Unit Tests

- `computeEligibilityClasses` — two proctors with identical eligibility but different `dutyHalfdays` → different classes.
- `computeEligibilityClasses` — proctor exempt for every session → not in any class.
- `computeClassBounds` — single-class case, `D_expected = 15`, `G = 368`, `N = 147` → `[floor(383/147), ceil(383/147)] = [2, 3]`.
- `computeClassBounds` — multi-class case, residual distribution to largest classes.
- `computeClassBounds` — `D_expected = 0` → bounds collapse to guards-only.
- `costFunction` hard cap — `classBoundsByProctorKey` absent → cap inactive (regression check).
- `costFunction` hard cap — `getPrimaryLoad + 1 = classUpperBound` → cap does NOT fire (inclusive bound).
- `costFunction` hard cap — `getPrimaryLoad + 1 > classUpperBound` → returns `INFINITY_SENTINEL`.
- `phase2_75CoverageRepair` — uncovered teacher with one over-loaded peer above `classUB + 1` → swap performed, `loadState` updated, `dutyCount` untouched.
- `phase2_75CoverageRepair` — uncovered teacher with no over-loaded peer at all → soft step, then `unresolved++` with warning.
- `phase2_75CoverageRepair` — swap that would create a duplicate in the row → rejected by `swapPreservesHardConstraints`, candidate skipped.
- `phase2_75CoverageRepair` — swap that would violate exemption → rejected.
- `buildV2Input` — `examCenterConfig.expected_duty_tasks = 15` propagates as `input.D_expected = 15`.
- `buildV2Input` — field absent → `input.D_expected = 0`.
- `applySwap` — `loadState.dutyCount` and `loadState.dutyHalfdays` unchanged before/after swap.
- Divergence warning — `D_expected = 100`, `actualDutyPairs = 70` → warning emitted; `D_expected = 100`, `actualDutyPairs = 90` → no warning.

### Property-Based Tests

- **P1 — Strict intra-class fairness.** Generator: random eligibility classes, random `D_expected`. Assertion: for every class `C` and every `T1, T2 ∈ C`, `|primaryLoad(T1) − primaryLoad(T2)| ≤ 1`.
- **P2 — Per-class bounds.** Generator: random `(N, G, D_expected, class membership)`. Assertion: `classLowerBound ≤ primaryLoad(T) ≤ classUpperBound` for every member.
- **P3 — Coverage.** Generator: random eligibility, ensure every proctor is eligible for at least one session. Assertion: `primaryLoad(T) ≥ 1` for every eligible `T`.
- **P4 — Preservation.** Generator: random valid input. Assertion: F' agrees with F on `proctor_keys`, `dutyCount`, `reserves`, `softViolations` whenever `¬C(F(input))`. Run v1 in parallel for byte-equality on the v1 path.
- **Determinism.** Same input + same `randomSeed` → identical `swaps`, `unresolved`, `proctor_keys` across two F' runs.

### Integration Tests

- **The user's case.** `D_expected = 15`, `G = 368`, `N = 147` (single class) → assert `max(primaryLoad) ≤ 3`, `min(primaryLoad) ≥ 2`, `coverageRepairUnresolved = 0`, `maxPrimaryLoadGapWithinClass ≤ 1`.
- **Divergence warning.** `D_expected = 15`, but `dutyData` only produces 8 pairs → warning emitted (`(15 − 8) / 15 = 0.47 > 0.2`).
- **UI persistence round-trip.** Set `expected_duty_tasks = 15` in the panel, save, reload page, assert input value is restored AND `buildV2Input` returns `input.D_expected = 15`.
- **Backward compatibility.** Run on a legacy fixture (no `expected_duty_tasks` field) → `D_expected = 0`, bounds collapse to guards-only, no behaviour change for inputs where `¬C(X)`.
- **v1 byte-equality.** Switch the algorithm toggle to v1, run, assert byte-identical output to a pre-fix snapshot.

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Coverage-repair swap creates infeasibility | Medium | Low | `swapPreservesHardConstraints` rejects unsafe swaps; `unresolved++` with warning per-teacher; row preserved as-is. |
| `D_expected` divergence > 20% misleads bounds | Medium | Medium | Diagnostic warning (Requirement 2.12); user updates the value and re-runs. |
| Per-class proportional split rounds to 0 for tiny classes | Low | Low | Residual distribution to largest classes; tiny classes still receive `floor(G_class / |C|)` bounds correctly. Documented in §3.2. |
| Hard cap inside `costFunction` makes Hungarian infeasible for some rows | Low | Medium | Greedy fallback inherits the cap; final unconstrained-pass fallback `costOptions.skipClassCap = true` for unresolvable rows; default behaviour leaves slot empty + emits existing shortage warning. |
| Repair swap pushes `T_over` below `classLB` | Low | Medium | Pre-condition `primaryLoad(T_over) ≥ classUB + 1` (or `≥ classUB` in soft step) plus same-class invariant ensures post-swap `primaryLoad(T_over) ≥ classUB − 1 ≥ classLB`. Proven in §3.4 edge-case table. |
| UI label confusion (user thinks `D_expected` chooses duty teachers) | Low | Low | Tooltip explicitly clarifies the field is for fairness bounds only; 20% divergence warning catches mismatched expectations. |
| v1 byte-equality breaks | Low | High | New pass and hard cap activate only on the v2 path; v1 untouched. P4 PBT regression test snapshots v1 output. |
| Phase 2.75 pass adds latency on large centres | Low | Low | Bounded `O(uncovered × rows)`. With ≤ 5 uncovered × ≤ 200 rows = 1 000 ops; ≤ 5 ms in practice; soft 50 ms cap with `'time_budget'` warning on overflow. |
| `classBoundsByProctorKey` lookup miss for newly-onboarded proctors mid-run | Very low | Low | Cap inactive for missing keys; soft penalties still apply; `unresolved` count would surface the omission in diagnostics. |
| Diagnostics panel renderer crashes on new fields | Low | Low | All new fields rendered with `?.` / `||` fallbacks; old snapshots tested on the new renderer. |
