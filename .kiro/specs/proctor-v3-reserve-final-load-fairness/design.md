# Proctor V3 Reserve Final_Load Fairness — Bugfix Design

## Overview

Phase 9 of the V3 pipeline (`js/algorithms/proctor-v3/phases/09-place-reserves.js`)
selects reserve proctors per-session using the sort key
`(Reserve_Count ASC, affinityRank ASC, Final_Load ASC, canonicalKey ASC)`.
On the production fixture (`G=298`, `R=79`, `D=6`, `N=147`) this lifts 4
proctors to `Final_Load = 4` while 62 proctors sit at `Final_Load = 2`,
violating the user-stated rule "lowest total load served first" even though
the achievable bound is `ceil((G+R+D)/N) = 3`.

The fix (Option B, agreed in `.agent/proctor-v3-reserve-final-load-fairness.md`)
adds a soft-hard cap on resulting `Final_Load` during reserve placement and
splits the candidate pool into two ordered tiers around that cap. The
existing AC 7.5 sort key is preserved **as the intra-tier ordering**, so
affinity continues to act as a tiebreaker — but only among candidates that
sit inside the same Final_Load tier. Forced overflows (the rare case where
no under-cap candidate is eligible for a session) are recorded in a new
diagnostics list `diagnostics.finalLoadOverflows`.

The change is intentionally minimal:
- **One file of production logic** is modified — `phases/09-place-reserves.js`.
  The change is localized to `buildCandidatePool()` (sort + partition) and
  to the per-session loop that already calls it (computing the cap once,
  threading it into `ctx`, and recording overflow entries).
- **One diagnostics field is added** — `finalLoadOverflows: []` — and
  `diagnostics.js` keeps the field on the round-trip (it already preserves
  unknown diagnostics keys verbatim, but we make the empty-array default
  explicit in `phases/09-place-reserves.js` and in the orchestrator's
  validation-error fallback shape so the field is always present).
- **Phases 0..8 are untouched.** Guards, duty, bounds, coverage repair,
  bimodal repair and AM/PM repair never change `Final_Load` semantics; the
  cap is consumed *only* in Phase 9. `proctor_keys`, `histogramByGuardCount`,
  and `histogramByPrimaryLoad` are byte-identical before/after the fix.

## Glossary

- **Final_Load(T)** — `Guard_Count(T) + Reserve_Count(T) + Duty_Count(T)`,
  computed by `utils/load-state.js#finalLoad`. The total-work axis the user
  cares about.
- **Primary_Load(T)** — `Guard_Count(T) + Duty_Count(T)`. Frozen by Phase 9
  (this fix never touches it).
- **Reserve_Global_Upper** — `ceil((G_Total_Slots + R_Total_Reserves + D_Total) / N_Eligible)`,
  computed once per Phase 9 invocation. On the production fixture this
  equals `ceil(383 / 147) = 3`.
- **G_Total_Slots** — sum of guard slots across all rows. Already exposed
  as `state.bounds.global.gTotalSlots` (Phase 3).
- **R_Total_Reserves** — total reserve slots that Phase 9 *will request*
  this run, i.e. `Σ_session computeReserveTarget(reservesConfig, guardCount(session))`,
  summed over all sessions before any clamping. Computed locally in
  Phase 9 via the existing `computeReserveTarget()` helper.
- **D_Total** — `state.bounds.global.dExpected` (the duty halfday count
  Phase 3 used to derive bounds).
- **N_Eligible** — `state.bounds.global.nEligible` (count of eligible
  proctors used by Phase 3).
- **Tier 1 (under-cap)** — candidates whose post-assignment `Final_Load`
  (i.e. `currentFinalLoad + 1`) is `<= Reserve_Global_Upper`.
- **Tier 2 (at-or-over cap)** — candidates whose post-assignment
  `Final_Load` is `> Reserve_Global_Upper`. Selected only when Tier 1 is
  exhausted for that session.
- **affinityRank(T, S)** — 0 if T guarded the previous session of S's
  halfday, else 1 (AC 7.5/7.6/7.7 of the V3 spec). Continues to be a
  tiebreaker INSIDE each tier.
- **canonicalKey(T)** — pure code-point ASC tiebreaker; remains the final
  key inside each tier so determinism (Requirement 8) is preserved.
- **F** — Phase 9 as it exists today (no cap).
- **F'** — Phase 9 after the fix (two-tier partition + cap +
  `finalLoadOverflows`).
- **finalLoadOverflows** — new diagnostics list populated only when a
  Tier-2 candidate is picked. Empty `[]` whenever Tier 1 covers every
  reserve placement (the typical case after the fix on real inputs).

## Bug Details

### Bug Condition

The bug manifests when Phase 9 places a reserve for a session in which both
under-cap and at-or-over-cap eligible candidates exist, and the existing
sort key ranks an at-or-over-cap candidate ahead of an under-cap candidate
(typically because the at-or-over-cap candidate has equal `reserveCount`
and a lower `affinityRank`). The reserve is then assigned to the heavier
proctor, lifting their `Final_Load` strictly above `Reserve_Global_Upper`
even though a lighter eligible candidate was available for the same slot.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input of type V3Input (full pipeline input)
  OUTPUT: boolean

  state := runPipeline_unfixed(input)              // F up to & including Phase 9
  G     := state.bounds.global.gTotalSlots
  D     := state.bounds.global.dExpected
  N     := state.bounds.global.nEligible
  R     := Σ_session computeReserveTarget(resolveReservesConfig(input), guardCount(session))
  cap   := ceil((G + R + D) / N)

  RETURN EXISTS proctor T IN state.proctors SUCH THAT
           finalLoad(state.loadState, T) > cap
         AND
           EXISTS session S IN sessions(state) SUCH THAT
             T was assigned a reserve role in S
             AND THERE EXISTS another proctor U eligible for reserve role in S
                 (after AC 7.4 filters AND not already a guard/reserve in S)
             SUCH THAT finalLoad(state.loadState, U) + 1 <= cap
END FUNCTION
```

### Examples

- **Production counterexample.** Session
  `2026-06-02|زوالا|...|التربية الإسلامية|الحصة الأولى` was assigned
  سكينة الرفيع (3 → 4) and محماد علاوي (3 → 4) while 88 eligible proctors
  at `Final_Load = 2`, `Reserve_Count = 0` were available for that slot.
  Expected: cap = 3, the slot SHOULD have gone to one of the FL=2
  candidates.
- **Histogram counterexample on `tests/fixtures/45454.json`.** Current
  Final_Load histogram is `{2: 62, 3: 81, 4: 4}` — `max = 4`, exceeding
  `cap = ceil(383/147) = 3`. Expected after fix: `max <= 3`.
- **Diagnostics counterexample.** Today, `state.diagnostics` does not
  contain a `finalLoadOverflows` field — the dimension is invisible to
  consumers (auditor scripts, UI, regression tests). Expected after fix:
  the field is always present (default `[]`) and lists every forced
  overflow with `{ sessionKey, canonicalKey, finalLoad, cap, reason }`.
- **Edge case — no under-cap candidate.** If a session's full eligible
  pool is already at `Final_Load + 1 > cap` (e.g. tiny school with very
  few non-exempt non-duty proctors), the reserve role is mandatory, so
  the algorithm SHALL still pick the best Tier-2 candidate (same
  intra-tier sort) and SHALL append a record to `finalLoadOverflows`.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Guard placement: `proctor_keys` on every row stays byte-identical
  before/after the fix on every input. Phases 0..8 do not run differently.
- `histogramByGuardCount` stays byte-identical (it is derived from
  `proctor_keys`, AC 9.3 of V3 spec).
- `histogramByPrimaryLoad` stays byte-identical (it is derived from
  `Primary_Load = Guard_Count + Duty_Count`, AC 9.3a). Phase 9 never
  touches `Guard_Count` or `Duty_Count`.
- `Reserve_Count` histogram gap stays `<= 1` on the production fixture
  (currently `{0:68, 1:79}`). The fix MUST NOT worsen reserve-only
  fairness.
- Determinism: same input + same `randomSeed` → byte-identical
  `rows` / `loadState` / `diagnostics` (Requirement 8).
- AC 7.4 hard filters (C-EXEMPT, C-DUTY, C-ME, not-currently-a-guard,
  not-currently-a-reserve, C-NO-SAME-DAY) continue to gate eligibility
  *before* the tier partition. Tiering re-orders eligible candidates
  only — it never relaxes eligibility.
- AC 7.4a (at-most-once invariant within a session, fresh per-row
  `reserve_keys` arrays per AC 10.2) continues to hold.
- AC 7.8 `diagnostics.reserveImbalances` continues to be populated with
  the existing semantics — `finalLoadOverflows` is an ADDITIVE list, not
  a replacement.
- Affinity intra-tier: when two candidates share the same Final_Load tier,
  the existing `(reserveCount, affinityRank, finalLoad, canonicalKey)`
  ordering still applies — so the AC 7.5 / 7.6 / 7.7 affinity bonus is
  preserved as a tiebreaker, just demoted to intra-tier scope.

**Scope:**
All inputs that do NOT trigger the bug condition (`isBugCondition` returns
false) SHALL produce byte-identical `rows`, `loadState`, and `diagnostics`
EXCEPT that `diagnostics.finalLoadOverflows` is now always present as a
fresh array `[]`. This new field is the only intentional addition to the
diagnostics shape.

## Hypothesized Root Cause

Based on the bug analysis in `.agent/proctor-v3-reserve-final-load-fairness.md`
and the reading of `phases/09-place-reserves.js` (≈ line 470, `pool.sort`
inside `buildCandidatePool()`), the most likely issues are:

1. **Sort-key ordering puts `Final_Load` third.** The current key
   `(reserveCount, affinityRank, finalLoad, canonicalKey)` tries to
   *balance reserves first* and only consults `Final_Load` after the
   affinity bonus. When most candidates share `reserveCount = 0`,
   `affinityRank` decides — and `affinityRank = 0` is awarded to proctors
   who guarded the previous session of the same halfday, i.e. proctors
   already carrying guard load. So the algorithm actively prefers
   higher-`Final_Load` candidates.

2. **No global cap is enforced during placement.** The bounds machinery
   (Phase 3) computes `globalUpperBound = ceil((G+D)/N)` (without R) and
   uses it ONLY for guard fairness; Phase 9 never derives or consults
   `ceil((G+R+D)/N)`. Reserve picks therefore have no awareness of the
   total-load ceiling.

3. **`affinityRank` is treated as a global criterion, not a tiebreaker.**
   AC 7.5 of the V3 spec was written assuming reserve-only fairness was
   the dominant axis. The user reframes the problem: total-load fairness
   is dominant; affinity is a nice-to-have. The current design conflates
   the two axes.

4. **No diagnostic visibility.** Even if a forced overflow occurs (every
   eligible candidate is already at the cap), there is no field today
   that flags it. Auditors must reverse-engineer it from the histogram.

The fix targets cause #1 and #2 directly (introduce the cap, partition
into two tiers). It addresses cause #3 by relocating affinity to
intra-tier. Cause #4 is solved by adding `diagnostics.finalLoadOverflows`.

## Correctness Properties

Property 1: Bug Condition - Reserve_Global_Upper is respected when avoidable

_For any_ V3 input where the bug condition holds (`isBugCondition` returns
true under the unfixed Phase 9), the fixed Phase 9 SHALL produce a state
in which every proctor T satisfies one of:
(a) `finalLoad(loadState, T) <= Reserve_Global_Upper`, or
(b) every reserve assignment that lifted T above the cap is recorded as a
forced overflow in `diagnostics.finalLoadOverflows` with
`{ sessionKey, canonicalKey: T, finalLoad, cap, reason: 'forced_overflow' }`,
indicating no under-cap eligible candidate existed for that session.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - Non-buggy inputs unchanged

_For any_ V3 input where the bug condition does NOT hold (`isBugCondition`
returns false under the unfixed Phase 9), the fixed Phase 9 SHALL produce
`rows`, `loadState.proctors[*].guardCount`, `loadState.proctors[*].dutyCount`,
`loadState.proctors[*].reserveCount`, `histogramByGuardCount`, and
`histogramByPrimaryLoad` that are byte-identical to the unfixed Phase 9's
output. The only intentional difference is the presence of
`diagnostics.finalLoadOverflows = []` (fresh empty array) on every run.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Changes Required

Assuming the root cause analysis is correct:

**File**: `js/algorithms/proctor-v3/phases/09-place-reserves.js`

**Functions touched**: `placeReserves()` (entry point), `buildCandidatePool()`
(re-orders the eligible pool into two tiers).

**Specific Changes**:

1. **Compute `Reserve_Global_Upper` once per run.** Inside `placeReserves()`,
   right after `reservesConfig = resolveReservesConfig(input)` is resolved
   and the rows have been grouped by session, derive:

   ```
   G := readBoundsOrDeriveGTotalSlots(state, rows)
   D := readBoundsOrDeriveDExpected(state, input)
   N := readBoundsOrDeriveNEligible(state, input)
   R := Σ_meta computeReserveTarget(reservesConfig, meta.guardCount)   // over grouped.sessions
   reserveGlobalUpper := ceil((G + R + D) / N)                         // 0 when N == 0
   ```

   Prefer reading `state.bounds.global.{gTotalSlots,dExpected,nEligible}`
   (already populated by Phase 3); fall back to a defensive recomputation
   when `state.bounds` is missing (e.g. unit tests that hand-construct
   state without running Phase 3). Store `reserveGlobalUpper` on the
   internal `ctx` object alongside the existing fields.

2. **Add `finalLoadOverflows` to the diagnostics carry-over.** In the
   block that prepares `nextDiag` at the top of `placeReserves()`,
   add:

   ```
   nextDiag.finalLoadOverflows = (prevDiag && Array.isArray(prevDiag.finalLoadOverflows))
       ? prevDiag.finalLoadOverflows.slice()
       : [];
   ```

   This guarantees the field is **always present as a fresh array**, even
   on early returns (empty rows / missing loadState branches).

3. **Partition the pool inside `buildCandidatePool()`.** After computing
   each candidate's `(reserveCount, affinityRank, finalLoad)` triple, push
   the candidate into one of two arrays based on the cap:

   ```
   IF finalLoad + 1 <= ctx.reserveGlobalUpper THEN tier1.push(candidate)
                                                ELSE tier2.push(candidate)
   ```

   Sort tier1 and tier2 INDEPENDENTLY using the existing comparator
   (`(reserveCount ASC, affinityRank ASC, finalLoad ASC, key ASC)`).
   Return `tier1.concat(tier2)`. This guarantees that any Tier-1 (under-
   cap) candidate is preferred over any Tier-2 candidate, while preserving
   AC 7.5/7.6/7.7 affinity behaviour as an intra-tier tiebreaker.

   Edge case: when `ctx.reserveGlobalUpper === 0` (e.g. `N === 0` — empty
   eligible set), every candidate falls into Tier 2 by definition, but
   the loop above will short-circuit because `pool.length === 0` anyway.
   No behavioural change vs. today.

4. **Record forced overflow entries during placement.** In the per-session
   loop in `placeReserves()`, AFTER `actualPick` is computed but during
   the `for (var pj = 0; pj < actualPick; pj += 1)` pick loop, for each
   pick check whether `pick.finalLoad + 1 > ctx.reserveGlobalUpper`. If
   it is, push to the diagnostics list:

   ```
   nextDiag.finalLoadOverflows.push({
       sessionKey: meta.sessionKey,
       canonicalKey: pick.key,
       finalLoad: pick.finalLoad + 1,    // post-assignment value
       cap: ctx.reserveGlobalUpper,
       reason: 'forced_overflow'
   });
   ```

   This naturally fires only when Tier 1 was exhausted for the session
   (otherwise the under-cap candidate would have been chosen first).

5. **Respect early-return paths.** The existing early returns (empty
   rows; missing loadState) MUST still produce a state whose
   `diagnostics.finalLoadOverflows` is a fresh empty array. Step 2's
   placement of the `nextDiag.finalLoadOverflows = …` assignment ensures
   this without further work.

**File**: `js/algorithms/proctor-v3/diagnostics.js`

The diagnostics builder already shallow-copies unknown fields from
`stateDiag` into the final diagnostics object (search for
`safeArrayCopy`/`safeObjectCopy` patterns). To make the field's presence
self-documenting (and to mirror the orchestrator's validation-error fallback
shape), add an explicit copy:

```
finalLoadOverflows: safeArrayCopy(stateDiag.finalLoadOverflows),
```

This is additive — no existing field is renamed or removed. The auditor
script (`scripts/audit-distribution-debug.js`, mentioned in the context
note) is out-of-scope for this bugfix; we just guarantee the field is
emitted so it can be consumed later.

**File**: `js/algorithms/proctor-v3/orchestrator.js`

Two early-exit diagnostics shapes (the validation-error fallback ≈ line 451
and the no-result fallback ≈ line 613) currently list a hard-coded
diagnostics object. To keep the field set consistent across all exit paths,
add `finalLoadOverflows: []` to both.

**File**: `js/algorithms/proctor-v3.bundle.js`

Regenerated via `npm run build:v3-bundle` after the source change. No
hand-edits.

**Files NOT changed:**
- Phases 0..8 — guard placement, bounds, coverage repair, bimodal repair,
  AM/PM repair. Their outputs feed Phase 9 unchanged.
- `proctor-v3/index.js` — the public surface stays identical (the new
  diagnostics field is consumed via the existing `diagnostics` object).
- `proctor-v3/utils/load-state.js` — `finalLoad()` is read but not
  modified.
- IPC / DB / display layers — they receive the new field transparently
  through the diagnostics envelope.

### Reserve-pick decision (per session)

```mermaid
sequenceDiagram
    participant Loop as placeReserves loop
    participant BCP as buildCandidatePool
    participant Tier1 as Tier 1 (under cap)
    participant Tier2 as Tier 2 (at/over cap)
    participant Diag as diagnostics.finalLoadOverflows

    Loop->>BCP: ctx { reserveGlobalUpper, … }, sessionMeta
    BCP->>BCP: apply AC 7.4 hard filters
    BCP->>BCP: compute (reserveCount, affinityRank, finalLoad) per eligible candidate
    BCP->>Tier1: push if finalLoad + 1 <= cap
    BCP->>Tier2: push if finalLoad + 1 > cap
    Tier1->>Tier1: sort by (rc, aff, fl, key)
    Tier2->>Tier2: sort by (rc, aff, fl, key)
    BCP-->>Loop: [...Tier1, ...Tier2]
    Loop->>Loop: actualPick = min(rawTarget, pool.length)
    loop pj = 0..actualPick-1
        Loop->>Loop: pick = pool[pj]
        alt pick.finalLoad + 1 <= cap
            Loop->>Loop: chosenForSession[pick.key] = true
            Loop->>Loop: addReserveLoad / recordReserveOccupancy
        else forced overflow
            Loop->>Diag: push { sessionKey, canonicalKey, finalLoad, cap, reason: 'forced_overflow' }
            Loop->>Loop: chosenForSession[pick.key] = true
            Loop->>Loop: addReserveLoad / recordReserveOccupancy
        end
    end
```

## Testing Strategy

### Validation Approach

The strategy follows the bug-condition methodology: surface counterexamples
on the UNFIXED code first (exploration), capture observed behaviour on the
unfixed code for non-bug inputs (preservation), then implement the fix and
re-run the same tests. PBT is used for both axes because Phase 9 has a wide
input space (proctors × sessions × halfday combinatorics) and unit tests
alone would miss tiered-pool edge cases.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE
implementing the fix. Confirm the root-cause analysis (sort-key puts
`Final_Load` too far down).

**Test Plan**: Build a small synthetic input (or reuse `arbitraryInput`
from `tests/proctor-v3/pbt-helpers.js`) configured so that for at least
one session there is both an under-cap candidate (`Final_Load = floor((G+R+D)/N)`)
and an at-cap candidate (`Final_Load = cap`) sharing `reserveCount = 0`,
where the at-cap candidate has lower `affinityRank`. Pipe through phases
0..4 using the existing harness in `tests/proctor-v3/reserves.test.js`
(`runUpToPhase9`), then call `placeReserves` (UNFIXED). Compute
`Reserve_Global_Upper` and assert
`max(finalLoad over loadState.proctors) <= reserveGlobalUpper`.

**Test Cases**:
1. **Synthetic counterexample (PBT-scoped)**: random inputs whose
   `affinityRank` ranking on a tied-`reserveCount` slot prefers a higher-
   `Final_Load` proctor — assertion `max FL <= cap` is expected to FAIL
   on UNFIXED code.
2. **Production fixture sanity check**: load
   `tests/fixtures/45454.json`, run Phase 9 (UNFIXED), assert that the
   Final_Load histogram contains at least one entry with key
   `> ceil((G+R+D)/N)` — confirms the production-observed
   `{2:62, 3:81, 4:4}` pattern is reproduced by the test harness.
3. **Diagnostics absence check**: assert
   `state.diagnostics.finalLoadOverflows === undefined` on UNFIXED code
   (will FAIL after fix lands; passes today).

**Expected Counterexamples**:
- Synthetic input where `Final_Load` reaches `cap + 1` while a Tier-1
  candidate is in the pool — root cause #1 confirmed.
- Production fixture exhibits `max(Final_Load) = 4 > cap = 3` — root
  cause #2 confirmed.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the
fixed Phase 9 produces a state in which every proctor's Final_Load is
either at-or-below the cap, or recorded in `finalLoadOverflows`.

**Pseudocode:**

```
FOR ALL input WHERE isBugCondition(input) DO
  state' := runPipeline_fixed(input)
  cap    := ceil((G + R + D) / N)
  FOR ALL T IN state'.proctors:
    IF finalLoad(state'.loadState, T) > cap THEN
      ASSERT EXISTS entry IN state'.diagnostics.finalLoadOverflows
             SUCH THAT entry.canonicalKey = T
                       AND entry.cap = cap
                       AND entry.reason = 'forced_overflow'
    END IF
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT
hold, the fixed Phase 9 produces the same `rows`, the same per-proctor
guard/duty/reserve counts, and the same histograms as the unfixed Phase 9.

**Pseudocode:**

```
FOR ALL input WHERE NOT isBugCondition(input) DO
  state_F  := runPipeline_unfixed(input)
  state_F' := runPipeline_fixed(input)
  ASSERT JSON.stringify(state_F.rows) = JSON.stringify(state_F'.rows)
  ASSERT computeHistogramByGuardCount(state_F.rows) = computeHistogramByGuardCount(state_F'.rows)
  ASSERT computeHistogramByPrimaryLoad(state_F.loadState, cbpk) = computeHistogramByPrimaryLoad(state_F'.loadState, cbpk)
  FOR ALL T IN canonicalKeys:
    ASSERT reserveCountOf(state_F.loadState, T) = reserveCountOf(state_F'.loadState, T)
END FOR
```

**Testing Approach**: Property-based testing because:
- Preservation is universally quantified ("for all non-buggy inputs"). PBT
  generates many shapes via `arbitraryInput` and is more likely to surface
  intra-tier ordering regressions than hand-written examples.
- The ordering inside Tier 1 must remain `(rc, aff, fl, key)` — a
  hand-written test could miss subtle reorderings; PBT exercises many
  permutations.

**Test Plan**: Reuse the harness in `tests/proctor-v3/reserves.test.js`
(or a new `tests/proctor-v3/reserves-final-load-cap.test.js`) and run
`placeReserves` twice — once via the unfixed module (kept around as a
git-history snapshot during development), once via the fixed module —
asserting equality of `rows`, `loadState`, and the relevant histogram
fields. After the fix lands the unfixed comparator goes away; preservation
becomes a regression PBT against the production fixture and against
`arbitraryInput`-generated cases.

**Test Cases**:
1. **Histogram preservation (PBT)**: for random inputs, assert
   `computeHistogramByGuardCount(rows_pre) === computeHistogramByGuardCount(rows_post)`
   and the same for `histogramByPrimaryLoad`. Holds across many seeds.
2. **`Reserve_Count` gap preservation**: assert
   `max(reserveCount) - min(reserveCount) <= 1` on the production fixture
   AFTER the fix (today: `{0:68,1:79}` → gap 1).
3. **Determinism preservation**: run Phase 9 twice with the same input and
   `randomSeed`, assert `JSON.stringify(state_a) === JSON.stringify(state_b)`.
4. **Affinity intra-tier preservation (PBT)**: build inputs where ALL
   eligible candidates fall into Tier 1 (cap is large or `R = 0`); assert
   the post-fix pick equals the unfixed pick byte-for-byte. Demonstrates
   that affinity is preserved when the cap doesn't bite.
5. **`finalLoadOverflows` shape**: on every run, assert the field exists
   and is an array. Entries (when any) match the schema
   `{ sessionKey: string, canonicalKey: string, finalLoad: number, cap: number, reason: 'forced_overflow' }`.

### Unit Tests

- `buildCandidatePool` returns a Tier-1-then-Tier-2 ordering when both
  tiers are non-empty; intra-tier ordering matches the existing
  comparator.
- `computeReserveTarget` × per-session iteration produces the expected
  `R_Total_Reserves` total; `Reserve_Global_Upper` equals
  `ceil((G+R+D)/N)` on a hand-built fixture (G=10, R=2, D=0, N=4 → 3).
- Early-return path (empty rows): `state.diagnostics.finalLoadOverflows`
  is a fresh `[]`.
- Forced-overflow path: when every eligible candidate is at-or-above the
  cap, the algorithm still places the reserve AND emits exactly one
  diagnostics entry per pick.

### Property-Based Tests

- **Property 1 (Bug Condition)**: bug-triggering PBT — assert that on the
  fixed code, every proctor either stays within the cap or appears in
  `finalLoadOverflows`. Scope to inputs where `isBugCondition` returns
  true under the unfixed code.
- **Property 2 (Preservation)**: random inputs (using
  `tests/proctor-v3/pbt-helpers.js#arbitraryInput`) — assert
  byte-identical `histogramByGuardCount`, `histogramByPrimaryLoad`,
  per-proctor `reserveCount`, determinism across two runs.
- **Property 3 (Reserve-only fairness)**: max-min reserve-count gap
  remains `<= 1` on the production fixture and on PBT-generated inputs
  whose reserve-count gap was `<= 1` before the fix.

### Integration Tests

- **Production fixture (`tests/fixtures/45454.json`)**: run the full
  V3 orchestrator end-to-end, assert
  `max(Final_Load) <= ceil((G+R+D)/N)` (`= 3` on this fixture), assert
  `histogramByGuardCount` and `histogramByPrimaryLoad` are byte-identical
  to a pre-fix snapshot, assert `diagnostics.finalLoadOverflows = []`.
- **`tests/proctor-v3/reserves.test.js` regression**: existing AC 7.x
  assertions continue to pass after the fix (affinity, at-most-once,
  per-row fresh arrays, AC 7.8 imbalances). The new field set is
  asserted in addition.
- **Lint + full V3 suite**: `npm run lint` and `npm run test:v3` green.

## Risks and Constraints

- **Do NOT** modify guard placement, bounds, coverage repair, bimodal
  repair, or AM/PM repair. The cap is a Phase-9-only concern; injecting
  it earlier would change `Primary_Load` and break AC 9.3a.
- **Do NOT** change `Reserves_Config` resolution (AC 7.1) or the
  `computeReserveTarget` formula (AC 7.2 / 7.3). The cap is layered on
  top of those, not in place of them.
- **Do NOT** alter the sort comparator's tiebreaker chain inside a tier;
  doing so would change which proctor is picked when both tiers degenerate
  to one (e.g. `R = 0`) and would violate Preservation.
- **Forced-overflow fallback is required.** A naive implementation that
  refuses to place reserves when Tier 1 is empty would break AC 7.2 / 7.3
  (the reserve target is mandatory, modulo eligibility).
- **Determinism risk.** The two-tier sort must use the exact same
  comparator; both arrays must be sorted independently *with stable
  intent* (`Array.prototype.sort` in V8 has been stable since 7.0, which
  is required for the Electron 35 / Node bundled with the project, but
  the comparator already produces a total order via the canonical-key
  tiebreaker, so stability is not strictly necessary).
