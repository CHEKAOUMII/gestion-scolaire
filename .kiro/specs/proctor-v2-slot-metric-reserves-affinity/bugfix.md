# Bugfix Requirements Document — Proctor v2 Slot Metric & Reserve Affinity

## Introduction

After the prior spec `proctor-v2-strict-fairness-coverage` shipped (per-class fairness on `primaryLoad = guardCount + dutyCount`, full coverage, user-configurable `D_expected`), live verification on the user's fixture (147 proctors, 368 guard slots, `D_expected = 15`) and on a smaller synthetic fixture (50 proctors, 100 slots, `classUB = 3`) revealed that the algorithm enforces fairness on the **wrong metric** and that the reserve-population pass does **not** match the user's intended distribution policy.

This bugfix delivers two coupled corrections inside `proctor-distribution-v2.js`:

1. **Slot-based fairness metric.** The user has chosen option **B — count by slots** as the fairness axis. Every (room × session) is one slot. A proctor who guards two rooms in the same session counts **2**. A proctor who guards two consecutive sessions in the same halfday counts **2**. The current implementation collapses these into **1** because `addGuardLoad` deduplicates by `halfdayKey` via a `Set`, so `guardCount` measures unique halfdays rather than actual slot work. The cost-function hard cap is internally consistent with its (wrong) metric, but the metric itself diverges from the user's intent — so the hard cap fails to bound the load the user actually cares about.
2. **Reserve distribution policy: spread first, then affinity, then balance.** The user has stated (verbatim, Arabic):

   > «أردت حين الأستاذ الحصة التالية في نفس اليوم تكون إن أمكن احتياط، في حين أن توزيع الاحتياط يكون بعدي. الاحتياط في الحصة الموالية فقط لتخفيف العبء عليهم لكن ليس الجميع الذين حرسوا بالضرورة فقط الحاجة منهم والاحتياط مرة واحدة فقط عند المراقب. بمعنى نحاول أن يشارك الجميع قدر المستطاع في الاحتياط. بالنسبة للحصص صباحاً أو مساءً لا تتعدى 2.»

   Decomposed:
   - The number of sessions per halfday is at most **2** (first session + second session of morning, first + second of afternoon).
   - The reserve for the **second** session of a halfday should preferentially go to a proctor who **guarded** the **first** session of the same halfday — proximity reduces the burden of staying on site.
   - But proximity is a **secondary** criterion. The **primary** rule is **spread**: every proctor should serve as a reserve **at most once** across the whole run before any proctor serves twice. Reserves are allocated **only as needed** (`reserveTarget` for the session) — not all guards of session 1 are forced into reserve duty for session 2; only as many as the session's reserve target requires.
   - When the spread limit is exhausted (every eligible proctor already reserved once), additional reserves fall back to the next ring (`reserveCount = 1`) and the same affinity-then-balance ordering applies.

The current `phase2_5PopulateReserves` orders candidates only by `finalLoad ASC` then a random tiebreak — it has no notion of `reserveCount` priority and no notion of "guarded the previous session of the same halfday". Both are missing.

This bugfix is scoped strictly to those two corrections. The hard constraints from the prior spec (per-class fairness on the new metric, full coverage, exemptions, no double-booking, supervisors-per-room exact, v1 byte-equality) remain inviolate. The pre-fix snapshot at `tests/__snapshots__/proctor-v2-strict-fairness-coverage.pre-fix.js` is not touched.

### Glossary

- **Slot:** one (row, proctor-position) pair. Equivalently: one cell in `row.proctor_keys[]`. A row with `proctorsPerRoom = 2` contributes 2 slots; a session with 4 rooms and `proctorsPerRoom = 2` contributes 8 slots.
- **`guardSlotCount(T)`:** the total number of times proctor `T` appears across all `row.proctor_keys[i]` for all rows in the run output. This is the new fairness axis. Equivalent to "number of room-sessions guarded by `T`".
- **`guardHalfdayCount(T)` (legacy):** the number of distinct halfdays in which `T` appears as a guard. The current `loadState[T].guardCount` measures this. After the fix, this quantity is no longer the fairness axis but is still tracked (via `loadState[T].guardHalfdays` Set) for halfday-reuse rule checks.
- **`primaryLoad(T)` (post-fix):** `guardSlotCount(T) + dutyCount(T)`. This is the value the cost function's hard cap and the per-class fairness invariant operate on.
- **`reserveCount(T)`:** number of reserve slots `T` has been assigned across the run (already tracked in `loadState[T].reserveCount`, slot-based).
- **`finalLoad(T)`:** `guardSlotCount(T) + reserveCount(T) + dutyCount(T)` (post-fix consistent rewrite of the existing `getFinalLoad`).
- **Halfday:** the morning or afternoon block of a single date. Identified by `halfdayKey`.
- **Sessions per halfday:** the user has confirmed a hard upper bound of **2** sessions per halfday (first and second). The fix can therefore treat a halfday as having "session 1" and "session 2" only.
- **First session / second session of a halfday:** within a halfday `H` containing sessions `S1` and `S2` ordered by start time, `S1` is the first session of `H` and `S2` is the second. If a halfday contains a single session, that session is "first" and there is no "second" — the affinity criterion does not apply.
- **`guardedFirstSessionOfHalfday(T, H)`:** boolean, true iff `T` has at least one slot in any row of session `S1` of halfday `H` in the current `assignments` snapshot.
- **F:** the v2 algorithm as it ships after `proctor-v2-strict-fairness-coverage`. **F':** the v2 algorithm after this fix.

### Bug Conditions

```pascal
FUNCTION isBugCondition(X)
  INPUT:  X = { rows, loadState, eligibleProctors, sessionsByHalfday, input }
  OUTPUT: boolean

  // C1 — Slot metric mismatch.
  //      The legacy guardCount disagrees with the count of T's appearances
  //      in proctor_keys across the rows.
  C1 ← EXISTS T IN eligibleProctors(X) :
         loadState(T).guardCount ≠
         (Σ over rows R: |{ i : R.proctor_keys[i] = T.key }|)

  // C2 — Reserve spread violation.
  //      Two eligible proctors differ in reserveCount by more than 1
  //      while at least one of them has reserveCount = 0 and was eligible
  //      for some session that needed reserves.
  C2 ← EXISTS T1, T2 IN eligibleProctors(X) :
         reserveCount(T1) − reserveCount(T2) > 1
         AND reserveCount(T2) = 0
         AND ∃ session S : T2 was reserve-eligible for S
                         AND S had unfilled reserve capacity at the time
                             phase2_5PopulateReserves processed S

  // C3 — Reserve affinity violation.
  //      A second-of-halfday session needed a reserve, an eligible
  //      not-yet-reserved guard of the first session of the same halfday
  //      was available, but the chosen reserve was someone who did NOT
  //      guard the first session of that halfday.
  C3 ← EXISTS halfday H with sessions S1 (first), S2 (second),
       reserve assignment (S2, idx) chosen by phase2_5PopulateReserves :
         chosen proctor T_chosen did NOT guard any slot of S1
         AND ∃ proctor T_alt :
               T_alt guarded at least one slot of S1
               AND T_alt was reserve-eligible for S2
               AND reserveCount(T_alt) ≤ reserveCount(T_chosen)
                   (i.e. picking T_alt would not have worsened the spread)

  RETURN C1 OR C2 OR C3
END FUNCTION
```

### Correctness Properties

```pascal
// P1 — Slot metric consistency.
//      For every eligible proctor T, the post-fix loadState bookkeeping
//      reports a guardSlotCount that exactly matches T's appearances in
//      proctor_keys across the row set. Equivalently: addGuardLoad
//      increments guardCount on every call (slot-based), not only on
//      first-of-halfday calls.
FOR ALL X IN F'-outputs, T IN eligibleProctors(X) DO
  ASSERT loadState(T).guardCount =
         (Σ over rows R: |{ i : R.proctor_keys[i] = T.key }|)
  ASSERT primaryLoad(T) = guardSlotCount(T) + dutyCount(T)
END FOR
// _Validates: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

// P2 — Reserve spread (max-1 gap among the not-yet-reserved frontier).
//      No two eligible proctors differ in reserveCount by more than 1
//      while one of them is at reserveCount = 0 and was reserve-eligible
//      for an under-filled session.
FOR ALL X IN F'-outputs, T1, T2 IN eligibleProctors(X) DO
  IF reserveCount(T1) − reserveCount(T2) > 1
     AND reserveCount(T2) = 0
  THEN
    ASSERT NOT (∃ session S : T2 was reserve-eligible for S
                              AND S had unfilled reserve capacity
                                  at the time S was processed)
  END IF
END FOR
// _Validates: 1.4, 2.4, 2.6_

// P3 — Reserve affinity (second session of a halfday prefers first-session
//      guards, subject to spread).
//      For every halfday H with two sessions S1 (first), S2 (second),
//      every reserve slot filled in S2 satisfies: among reserve-eligible
//      candidates with the minimum reserveCount achievable for S2, the
//      chosen candidate is one who guarded at least one slot of S1
//      whenever such a candidate exists.
FOR ALL X IN F'-outputs,
        halfday H with first session S1, second session S2,
        reserve slot (S2, idx) chosen in X DO
  LET minR ← min over candidates C reserve-eligible for S2: reserveCount_at_choice(C)
  LET firstGuards ← { C : C reserve-eligible for S2
                          AND C guarded at least one slot of S1
                          AND reserveCount_at_choice(C) = minR }
  IF firstGuards is non-empty THEN
    ASSERT chosen(S2, idx) ∈ firstGuards
  END IF
END FOR
// _Validates: 1.5, 2.5_

// P4 — Preservation of prior invariants.
FOR ALL X IN F'-outputs DO
  // Per-class fairness from the prior spec, restated on the new axis.
  ASSERT for all T1, T2 in same eligibility class :
         |primaryLoad(T1) − primaryLoad(T2)| ≤ 1
  ASSERT for all eligible T : primaryLoad(T) ≥ 1
  // Hard constraints unchanged.
  ASSERT no proctor appears twice in any single session
  ASSERT every exemption is respected
  ASSERT supervisors_per_room is honored exactly
  ASSERT duty assignments from input.dutyData are not mutated
  ASSERT reserves[] / reserve_keys[] shared-reference invariant holds
         (rows of one session share their reserves arrays)
  ASSERT v1 algorithm outputs are byte-identical to pre-fix v1
END FOR
// _Validates: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_
```

### Why the slot metric is the right fairness axis (user reasoning)

The user's reasoning, paraphrased: a proctor who supervises two rooms in the same session is doing **two** units of work, not one. A proctor who supervises two consecutive sessions in the same halfday is also doing **two** units of work — the second session is real labour even though it is the "same halfday". The previous halfday-deduplicating count was an artefact of the implementation, not a property the user wanted. Counting by slots aligns the fairness invariant with the actual workload felt by the proctor.

### Why affinity is secondary to spread (user reasoning)

The user's reasoning, paraphrased: the goal is that **everyone shares the reserve burden as much as possible**. Affinity (proximity) is a comfort optimisation — if a proctor already happens to be on site for session 1, asking them to stay one more session is lighter than recalling someone else. But that comfort gain must not concentrate reserves on the same handful of proctors. Spread first, then affinity, then balance.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `addGuardLoad(loadState, key, halfdayKey, name)` is invoked AND `loadState[key].guardHalfdays` already contains `halfdayKey` THEN the system does NOT increment `loadState[key].guardCount` (the legacy count tracks unique halfdays, not slot work)

1.2 WHEN proctor `T` is assigned to N slots in the same halfday (e.g. two rooms in one session, or two consecutive sessions of the same halfday) THEN the system reports `loadState[T].guardCount = 1` even though `T` appears N times in `proctor_keys` across the rows

1.3 WHEN the cost function evaluates the hard cap `postAssignmentPrimary > classUpperBound_primary` THEN the system uses the halfday-deduplicated `guardCount` from `loadState`, so the cap binds the wrong quantity and the actual slot-level load can exceed `classUpperBound_primary` without triggering an `INFINITY_SENTINEL`

1.4 WHEN `phase2_5PopulateReserves` orders reserve candidates for a session THEN the system sorts by `finalLoad ASC` then a random tiebreak only — there is no priority for proctors with `reserveCount = 0`, so a proctor who already has `reserveCount = 1` can be chosen ahead of a peer with `reserveCount = 0` whenever their `finalLoad` is slightly lower

1.5 WHEN a halfday `H` contains two sessions `S1` and `S2` AND `S2` needs reserves AND some proctor `T_first` guarded at least one slot of `S1` AND `T_first` is reserve-eligible for `S2` AND `T_first` has `reserveCount = 0` THEN the system does NOT prefer `T_first` over an eligible peer who did not guard `S1`; the chosen reserve is whichever candidate happens to win the existing `finalLoad`/random ordering

1.6 WHEN a downstream consumer reads `loadState[T].guardCount` (e.g. `getPrimaryLoad`, `getFinalLoad`, `costFunction`'s hard cap, `phase2_75CoverageRepair`'s peer eligibility, the orchestrator's diagnostics, `objectiveFunction`'s primary load aggregation) THEN every consumer reads the halfday-deduplicated quantity, propagating the metric mismatch through every later phase

### Expected Behavior (Correct)

2.1 WHEN `addGuardLoad(loadState, key, halfdayKey, name)` is invoked THEN the system SHALL increment `loadState[key].guardCount` exactly once on every call, regardless of whether `halfdayKey` was already present in `loadState[key].guardHalfdays`

2.2 WHEN `loadState[key].guardHalfdays` is read by halfday-reuse rule checks THEN the system SHALL CONTINUE TO populate that Set with the called `halfdayKey` (the Set is retained for reuse-rule semantics; only the counting policy changes)

2.3 WHEN any consumer computes `primaryLoad(T)` THEN the system SHALL return `guardSlotCount(T) + dutyCount(T)` where `guardSlotCount(T)` equals the number of times `T.key` appears in `proctor_keys` across the row set; this aligns `getPrimaryLoad`, the cost function's hard cap, the per-class fairness invariant, the coverage-repair pass's peer eligibility, and the objective function on a single slot-based metric

2.4 WHEN `phase2_5PopulateReserves` orders reserve candidates for a session `S` THEN the system SHALL sort candidates by the lexicographic key `(reserveCount ASC, affinityRank ASC, finalLoad ASC, rng ASC)` where `affinityRank = 0` if the candidate guarded at least one slot of the first session of `S`'s halfday AND `S` is the second session of its halfday, and `affinityRank = 1` otherwise (or `affinityRank` is uniformly `1` when affinity is not applicable, e.g. `S` is the first session of its halfday or its halfday holds only one session)

2.5 WHEN `S` is the second session of a halfday `H` AND `S` needs reserves AND at least one reserve-eligible candidate has `reserveCount = 0` AND guarded at least one slot of the first session of `H` THEN the system SHALL pick reserves from that subset before picking from candidates with `reserveCount = 0` who did not guard the first session of `H`

2.6 WHEN every reserve-eligible candidate for `S` already has `reserveCount ≥ 1` AND `S` still needs more reserves THEN the system SHALL fall through to the next spread ring (`reserveCount = 1`) and apply the same affinity-then-balance ordering inside that ring; the ring boundaries are implicit in the `reserveCount ASC` ordering — the sort itself yields the correct fall-through

2.7 WHEN the cost function evaluates the hard cap `postAssignmentPrimary > classUpperBound_primary` for a candidate placement THEN the system SHALL compute `postAssignmentPrimary` from the new slot-based `guardSlotCount(T) + dutyCount(T)` (i.e. `loadState[T].guardCount + dutyCount(T)` after the metric switch in 2.1) so that the hard cap binds the slot metric

### Unchanged Behavior (Regression Prevention)

3.1 WHEN `addReserveLoad` is invoked THEN the system SHALL CONTINUE TO increment `reserveCount` slot-by-slot (its existing semantics — already slot-based — are not touched by this fix)

3.2 WHEN `addDutyLoad` is invoked during the Phase 1 pre-pass THEN the system SHALL CONTINUE TO populate `dutyCount` and `dutyHalfdays` exactly as today; duty data flows from `input.dutyData` and is never mutated by the algorithm

3.3 WHEN the per-class fairness invariant from the prior spec is evaluated THEN the system SHALL CONTINUE TO satisfy `|primaryLoad(T1) − primaryLoad(T2)| ≤ 1` for all T1, T2 in the same eligibility class — restated on the new slot-based `primaryLoad`

3.4 WHEN any eligible proctor would otherwise end the run with `primaryLoad = 0` THEN the system SHALL CONTINUE TO run the post-Phase-2 coverage-repair pass shipped by the prior spec; the pass's peer-eligibility test SHALL operate on the new slot-based `primaryLoad`

3.5 WHEN the user-supplied `D_expected` is read THEN the system SHALL CONTINUE TO honour it for fairness-bound computation as shipped by the prior spec; `D_expected` semantics, persistence location, and UI exposure are not changed by this fix

3.6 WHEN exemptions, duty-as-subject conflicts, supervisors-per-room exactness, halfday-reuse / day-reuse flags, group-mismatch preferences, or morning/evening soft preferences are evaluated THEN the system SHALL CONTINUE TO honour them with their existing semantics

3.7 WHEN the `reserves[]` / `reserve_keys[]` shared-reference invariant is relied upon (rows of one session share their reserves arrays — see prior spec design notes) THEN the system SHALL CONTINUE TO preserve it; the new sort ordering SHALL operate on the candidate list before assignment, not on shared array contents post-assignment

3.8 WHEN the legacy v1 algorithm is invoked THEN its outputs SHALL CONTINUE TO be byte-identical to pre-fix v1 outputs for the same inputs; the metric switch in 2.1 lives entirely inside v2's `loadState` bookkeeping path

3.9 WHEN the `phase2_75CoverageRepair` pass swaps a guard slot from an over-loaded peer to an uncovered proctor THEN the system SHALL CONTINUE TO follow the three-tier relaxation strategy already in place (`>= classUB+1`, then `>= classUB`, then `>= classLowerBound+1`); only the metric used for the comparison switches to slot-based per 2.3

3.10 WHEN the pre-fix snapshot at `tests/__snapshots__/proctor-v2-strict-fairness-coverage.pre-fix.js` is read THEN the system SHALL NOT modify it (the snapshot anchors the prior spec's regression baseline and is owned by that spec)

3.11 WHEN diagnostics are emitted THEN the system SHALL CONTINUE TO report every existing field; new diagnostics introduced by this fix (if any are needed at the requirements level — exact set is left to `design.md`) SHALL be additive and SHALL NOT remove or rename existing fields
