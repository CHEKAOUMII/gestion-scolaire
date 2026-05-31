# Bugfix Requirements Document

## Introduction

V3 reserve placement (Phase 9 — `js/algorithms/proctor-v3/phases/09-place-reserves.js`)
breaks **global Final_Load fairness**. On the production fixture
`المعطيات/distribution-debug-1780170300614.json` (G=298 guards, R=79 reserves,
D=6 duty halfdays, N=147 eligible proctors), the achievable upper bound is
`ceil((G+R+D)/N) = ceil(383/147) = 3`. Yet 4 proctors end up with
`Final_Load = 4` while 62 proctors sit at `Final_Load = 2` with spare capacity
and zero reserves.

The root cause is the candidate-pool sort key inside `buildCandidatePool()`,
which orders by `(Reserve_Count, affinityRank, Final_Load, canonicalKey)`.
Because `affinityRank` outranks `Final_Load`, the algorithm prefers proctors
who guarded the previous session of the same halfday — i.e. proctors who
already carry guard load — and lifts them to `Final_Load = 4` instead of
giving the reserve role to one of the many available `Final_Load = 2`
candidates.

The user's expectation is the classic fairness rule: among eligible candidates
for a reserve slot, the one with the **lowest total load (Final_Load)** SHALL
be served first. The agreed fix (Option B) is a soft-hard cap on Final_Load
during reserve placement: tier candidates as below the cap vs. at/above it,
exhaust the under-cap tier first, and only allow forced overflow when no
under-cap candidate exists for the session — recording every forced overflow
in diagnostics. Affinity is preserved as an intra-tier tiebreaker.

This bugfix MUST NOT alter guard placement (`proctor_keys`),
`histogramByGuardCount`, `histogramByPrimaryLoad`, the `Reserve_Count` gap
property, or determinism (Requirement 8).

## Bug Analysis

### Current Behavior (Defect)

When Phase 9 builds the candidate pool for a session in which at least one
under-cap candidate (`Final_Load + 1 <= ceil((G+R+D)/N)`) is available
alongside an at-cap candidate (`Final_Load + 1 > ceil((G+R+D)/N)`), the sort
key `(Reserve_Count, affinityRank, Final_Load, canonicalKey)` may rank the
at-cap candidate above the under-cap candidate, and the at-cap candidate is
picked. As a consequence, the resulting `Final_Load` histogram contains
entries strictly greater than `ceil((G+R+D)/N)` even though this overflow
was avoidable.

1.1 WHEN Phase 9 places a reserve for a session AND there exists an eligible
under-cap candidate (resulting `Final_Load <= ceil((G+R+D)/N)`) AND there
exists an eligible at-cap candidate (resulting `Final_Load > ceil((G+R+D)/N)`)
AND both share the same `Reserve_Count` BUT the at-cap candidate has lower
`affinityRank` THEN the system picks the at-cap candidate and lifts that
proctor's `Final_Load` strictly above `ceil((G+R+D)/N)`.

1.2 WHEN Phase 9 finishes on the production fixture
`tests/fixtures/45454.json` (or the captured input
`المعطيات/distribution-debug-1780170300614.json`) THEN the resulting
`Final_Load` histogram contains 4 proctors at `Final_Load = 4` (strictly
greater than the achievable bound of 3).

1.3 WHEN Phase 9 emits diagnostics after placing reserves AND at least one
proctor was lifted past the achievable Final_Load bound THEN the system does
NOT record any entry describing the forced Final_Load overflow (no
`finalLoadOverflows` list; the existing `reserveImbalances` does not capture
this dimension).

### Expected Behavior (Correct)

2.1 WHEN Phase 9 places a reserve for a session AND there exists at least one
eligible candidate whose resulting `Final_Load` is `<= Reserve_Global_Upper`
(where `Reserve_Global_Upper = ceil((G_Total_Slots + R_Total_Reserves +
D_Total) / N_Eligible)`) THEN the system SHALL select an under-cap candidate
in preference to any candidate whose resulting `Final_Load` would exceed
`Reserve_Global_Upper`, regardless of `Reserve_Count` or `affinityRank`.

2.2 WHEN Phase 9 finishes on the production fixture
`tests/fixtures/45454.json` (and the captured input
`المعطيات/distribution-debug-1780170300614.json`) THEN the resulting
`Final_Load` histogram SHALL have `max(Final_Load) <=
ceil((G_Total_Slots + R_Total_Reserves + D_Total) / N_Eligible)` (= 3 on
this fixture) — i.e. zero proctors at `Final_Load = 4`.

2.3 WHEN Phase 9 must place a reserve in a session whose every eligible
candidate is already at or above `Reserve_Global_Upper` THEN the system
SHALL still place the reserve (the role is mandatory) AND SHALL record an
entry `{ sessionKey, canonicalKey, finalLoad, cap, reason: 'forced_overflow' }`
in `diagnostics.finalLoadOverflows`.

2.4 WHEN Phase 9 finishes a run AND no forced overflow occurred THEN
`diagnostics.finalLoadOverflows` SHALL be an empty array (the field SHALL
always be present and SHALL be a fresh array, mirroring the existing
diagnostics conventions).

### Unchanged Behavior (Regression Prevention)

3.1 WHEN Phase 9 selects between two eligible candidates whose resulting
`Final_Load` BOTH stay at or below `Reserve_Global_Upper` THEN the system
SHALL CONTINUE TO order them by the existing key
`(Reserve_Count ASC, affinityRank ASC, Final_Load ASC, canonicalKey ASC)`,
preserving the affinity bonus from AC 7.5/7.6/7.7 of the V3 spec as an
intra-tier tiebreaker.

3.2 WHEN Phase 9 finishes on any input THEN `histogramByGuardCount` and
`histogramByPrimaryLoad` SHALL CONTINUE TO be byte-identical to the values
produced before the fix — Phase 9 SHALL NOT alter `proctor_keys` on any row
nor mutate guard- or duty-load counts.

3.3 WHEN Phase 9 finishes on any input THEN the `Reserve_Count` histogram
gap SHALL CONTINUE TO be `<= 1` (matches the production fixture's current
`{0:68, 1:79}`) — the fix MUST NOT worsen reserve-only fairness.

3.4 WHEN Phase 9 runs twice on the same input with the same `randomSeed`
THEN the system SHALL CONTINUE TO produce byte-identical `rows`, `loadState`,
and `diagnostics` (Requirement 8 — determinism).

3.5 WHEN Phase 9 places reserves THEN it SHALL CONTINUE TO honour every
hard-constraint filter from AC 7.4 (C-EXEMPT, C-DUTY, C-ME,
not-currently-a-guard-in-S, not-currently-a-reserve-in-S, C-NO-SAME-DAY) —
the cap layer SHALL only re-prioritise eligible candidates, never relax
eligibility.

3.6 WHEN Phase 9 finishes a session's placement AND `actualPick < rawTarget`
because of eligibility filters THEN the system SHALL CONTINUE TO populate
`diagnostics.reserveImbalances` per AC 7.8 of the V3 spec — the new
`finalLoadOverflows` list SHALL be additive, not a replacement.

3.7 WHEN Phase 9 attaches reserve arrays to rows THEN it SHALL CONTINUE TO
allocate FRESH `reserve_keys` and `reserves` arrays per row (AC 10.2,
no shared array references) and SHALL CONTINUE TO uphold the at-most-once
invariant within a session (AC 7.4a).

## Bug Condition (derivation)

```pascal
FUNCTION isBugCondition(input)
  INPUT: input of type V3Input  // a full V3 pipeline input
  OUTPUT: boolean

  // Run the UNFIXED Phase 9 against `input` (after phases 0..4) and
  // observe the resulting Final_Load histogram and per-session picks.

  state         := runPipeline_unfixed(input)
  G             := totalGuardSlots(state)
  R             := totalReserveSlotsRequested(state)   // cumulative target
  D             := totalDutyHalfdays(state)            // distinct (proctor, halfday)
  N             := countEligibleProctors(state)
  cap           := ceil((G + R + D) / N)

  RETURN EXISTS proctor T IN state.proctors SUCH THAT
           finalLoad(state.loadState, T) > cap
         AND
           EXISTS session S in state.sessions SUCH THAT
             T was assigned reserve role in S
             AND THERE EXISTS another candidate U eligible for S
             SUCH THAT finalLoad_after_assigning_U_to_S <= cap
END FUNCTION
```

```pascal
// Property: Fix Checking — Reserve_Global_Upper is respected when avoidable
FOR ALL input WHERE isBugCondition(input) DO
  state' := runPipeline_fixed(input)
  cap    := ceil((G + R + D) / N)
  ASSERT FOR ALL T IN state'.proctors:
           finalLoad(state'.loadState, T) <= cap
           OR T appears in state'.diagnostics.finalLoadOverflows
END FOR
```

```pascal
// Property: Preservation Checking — non-buggy inputs unchanged
FOR ALL input WHERE NOT isBugCondition(input) DO
  state_F  := runPipeline_unfixed(input)
  state_F' := runPipeline_fixed(input)
  ASSERT state_F.rows                         == state_F'.rows
  ASSERT state_F.loadState.histogramByGuard*  == state_F'.loadState.histogramByGuard*
  ASSERT state_F.loadState.reserveCount(T)    == state_F'.loadState.reserveCount(T) FOR ALL T
  // i.e. the fixed pipeline produces an identical reserve assignment when
  // the bug is not triggered (no forced lift past the cap).
END FOR
```

**Definitions:**
- **F** — Phase 9 as it exists today (sort key
  `(Reserve_Count, affinityRank, Final_Load, key)`, no cap).
- **F'** — Phase 9 after the fix (two-tier partition by
  `Reserve_Global_Upper`, same intra-tier sort, plus
  `diagnostics.finalLoadOverflows`).
- **Reserve_Global_Upper** — `ceil((G_Total_Slots + R_Total_Reserves + D_Total) / N_Eligible)`,
  computed once per run.
- **Counterexample (production fixture):** the session
  `2026-06-02|زوالا|...|التربية الإسلامية|الحصة الأولى` was assigned
  سكينة الرفيع (Final_Load 3 → 4) and محماد علاوي (Final_Load 3 → 4) while
  88 eligible proctors at Final_Load = 2 / Reserve_Count = 0 were available.
