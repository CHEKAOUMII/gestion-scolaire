# Bugfix Requirements Document — Proctor Distribution v2: Fairness, Duty & Reserves

## Introduction

The Proctor Distribution v2 algorithm (الخوارزمية المُحسَّنة لتوزيع المراقبة) currently produces unfair assignments and never generates reserve proctors (الاحتياط), even when the exam center configuration specifies a non-zero reserve count. The user has asked for three corrections (translated from the Arabic original):

1. The distribution must include all eligible teachers as evenly as possible (يجب أن يشمل جميع الأساتذة بالتساوي ان أمكن).
2. Duty (المداومة) must enter the primary distribution.
3. Reserves (الاحتياط) must be a post-distribution pass that levels load differences, and the count must follow the user-configured mode — either a fixed integer or a percentage of the session's guards (يختاره المستعمل إما بعدد ثابت أو بنسبة مئوية).

### Glossary

- **Session (حصة):** a single exam timeslot identified by `date_day + period + session`.
- **Halfday:** morning or afternoon block of a given date.
- **Eligible teacher:** a proctor who is not exempt for the session and is not blocked by any hard constraint for that session/halfday.
- **Duty teacher (مداوم):** a proctor pre-flagged in `examDutyTeachersData` as on duty for one or more halfdays.
- **Guard count:** number of sessions where a proctor is a primary supervisor.
- **Duty count:** number of halfdays where a proctor is on duty.
- **Reserve count:** number of sessions where a proctor is a reserve.
- **Primary load:** guard count + duty count (the load that pre-exists before reserves are placed).
- **Final load:** guard count + duty count + reserve count.
- **lowerBound:** `floor((totalTasks − fixedReservedTasks) / numEligibleTeachers)`.
- **upperBound:** `lowerBound + 1`.
- **Reserves config:** the structured reserve count instruction `{ mode: 'fixed'|'percent', fixed: integer, percent: integer (0..100) }`, sourced from `examCenterConfig.max_reserves_mode`, `examCenterConfig.max_reserves`, and `examCenterConfig.max_reserves_percent`.
- **eligibleAvailable(S):** the number of eligible teachers for session S who are not already guards in S, not on duty during S's halfday, and who satisfy all hard constraints for S.
- **F:** the v2 algorithm before the fix. **F':** the v2 algorithm after the fix.

### Bug Condition C(X)

Let X be a v2 algorithm output (the assignment rows plus the resulting load state and the reserves config used for the run). C(X) is true if X violates **at least one** of the four sub-conditions below:

```pascal
FUNCTION isBugCondition(X)
  INPUT:  X = { rows, loadState, reservesConfig, examCenterConfig }
  OUTPUT: boolean

  // C1 — Fairness: an eligible teacher carries no load
  //                while another exceeds the lower bound,
  //                with at least one task that the first
  //                teacher was eligible for.
  C1 ← EXISTS T1, T2 IN eligibleTeachers(X) :
         finalLoad(T1) = 0
         AND finalLoad(T2) ≥ lowerBound(X) + 1
         AND ∃ task assigned to T2 for which T1 was also eligible

  // C2 — Duty inclusion: duty load was ignored when
  //                      distributing guard slots.
  C2 ← EXISTS T1, T2 IN eligibleTeachers(X) :
         eligibleSet(T1) = eligibleSet(T2)
         AND dutyCount(T1) > dutyCount(T2)
         AND finalLoad(T1) > finalLoad(T2)

  // C3 — Reserves count mismatch.
  C3 ← EXISTS S IN sessions(X) :
         |reserves(S)| ≠ targetReserves(S, reservesConfig(X))
       WHERE
         targetReserves(S, cfg) =
           cfg.mode = 'percent' →
             min( ceil(cfg.percent × |guards(S)| / 100),
                  eligibleAvailable(S) )
           cfg.mode = 'fixed'   →
             min( cfg.fixed,
                  eligibleAvailable(S) )

  // C4 — Reserves config plumbing.
  C4 ← examCenterConfig.max_reserves_mode is set
       AND reservesConfig(X) does not reflect it
           (mode lost, percent lost, or fixed lost)

  RETURN C1 OR C2 OR C3 OR C4
END FUNCTION
```

The fix is correct iff `NOT isBugCondition(X)` for every output X produced by F'.

### Correctness Properties

```pascal
// P1 — Fairness range across eligible teachers.
FOR ALL X DO
  ASSERT max(finalLoad(T) for T in eligibleTeachers(X))
       − min(finalLoad(T) for T in eligibleTeachers(X))
       ≤ (upperBound(X) − lowerBound(X)) + 1
END FOR

// P2 — Duty inclusion among peers with identical eligibility.
FOR ALL X, T1, T2 IN eligibleTeachers(X)
        WHERE eligibleSet(T1) = eligibleSet(T2) DO
  ASSERT abs(finalLoad(T1) − finalLoad(T2)) ≤ 1
END FOR

// P3 — Reserves count, fixed mode.
FOR ALL X WHERE reservesConfig(X).mode = 'fixed',
        S IN sessions(X) DO
  ASSERT |reserves(S)|
       = min(reservesConfig(X).fixed, eligibleAvailable(S))
END FOR

// P4 — Reserves count, percent mode.
FOR ALL X WHERE reservesConfig(X).mode = 'percent',
        S IN sessions(X) DO
  ASSERT |reserves(S)|
       = min( ceil(reservesConfig(X).percent × |guards(S)| / 100),
              eligibleAvailable(S) )
END FOR

// P5 — Reserve eligibility.
FOR ALL X, S IN sessions(X), R IN reserves(S) DO
  ASSERT R is not exempt for S
     AND R is not on duty during S.halfday
     AND R is not already a guard in S
     AND halfday/day reuse rules satisfied for R at S
END FOR

// P6 — Preservation (no regression on inviolate constraints).
FOR ALL X DO
  ASSERT no double-assignment in any session
     AND every exemption respected
     AND every duty-as-subject conflict resolved as before
     AND supervisors_per_room honored exactly
     AND v1 algorithm outputs are byte-identical to pre-fix v1
END FOR
```

## Bug Analysis

### Current Behavior (Defect)

When the v2 algorithm distributes proctors, the following defective behaviors are observed:

1.1 WHEN the total number of guard tasks is fewer than the number of eligible teachers (supply > demand) THEN the system leaves some eligible teachers with zero assignments while other teachers receive more than `lowerBound` assignments
1.2 WHEN a teacher is on duty for one or more halfdays THEN the system computes the load-balancing penalty as if the duty count were zero, so duty teachers are picked for as many guard slots as non-duty peers with the same eligibility set
1.3 WHEN any session is processed by the v2 algorithm THEN the system emits the session with an empty `reserves` array and an empty `reserve_keys` array regardless of the user-configured reserve count
1.4 WHEN the exam center configuration sets `max_reserves_mode = 'percent'` with a `max_reserves_percent` value THEN the v2 input pipeline drops the percent setting and forwards only a single fixed reserve count derived from the legacy `reservesPerSession` field
1.5 WHEN the exam center configuration sets `max_reserves_mode = 'fixed'` with a non-zero `max_reserves` THEN the v2 algorithm still produces sessions with zero reserves
1.6 WHEN the post-assignment Phase 3 simulated-annealing pass executes THEN its reserve-related moves (swap_roles, reassign_reserve) have no effect because no reserves exist in the initial solution

### Expected Behavior (Correct)

For every defective behavior above, the corrected behavior is:

2.1 WHEN the total number of guard tasks is fewer than the number of eligible teachers THEN the system SHALL prefer assigning a fresh zero-load eligible teacher over giving a second task to a teacher already at or above `lowerBound`, such that `max(finalLoad) − min(finalLoad)` across eligible teachers is at most `upperBound − lowerBound + 1`
2.2 WHEN a teacher is on duty for one or more halfdays THEN the system SHALL include the duty count in the load-balancing cost so that, among teachers with the same eligibility set, `|finalLoad(T1) − finalLoad(T2)| ≤ 1`
2.3 WHEN any session is processed by the v2 algorithm THEN the system SHALL populate the session's `reserves` and `reserve_keys` with exactly `targetReserves(session, reservesConfig)` proctors, capped by `eligibleAvailable(session)`
2.4 WHEN the exam center configuration sets `max_reserves_mode = 'percent'` with percent P THEN the v2 algorithm SHALL produce, for each session with G guards, `min(ceil(P × G / 100), eligibleAvailable(session))` reserves
2.5 WHEN the exam center configuration sets `max_reserves_mode = 'fixed'` with count N THEN the v2 algorithm SHALL produce, for each session, `min(N, eligibleAvailable(session))` reserves
2.6 WHEN reserves are populated THEN every reserve assigned to a session SHALL satisfy all hard constraints — not exempt for the session, not on duty during the session's halfday, not already a guard in the session, and respecting halfday/day reuse rules
2.7 WHEN reserves are populated THEN the system SHALL prefer teachers with the lowest current `finalLoad` so that reserve placement helps equalize total workload
2.8 WHEN the v2 input is built from `examCenterConfig` THEN the input SHALL carry a `reservesConfig = { mode, fixed, percent }` object derived from `max_reserves_mode`, `max_reserves`, and `max_reserves_percent`; if `max_reserves_mode` is absent, the input SHALL fall back to the legacy `examDistributionRules.reservesPerSession` as `{ mode: 'fixed', fixed: reservesPerSession, percent: 0 }`
2.9 WHEN reserves are populated and the Phase 3 optimization pass runs THEN the existing `swap_roles` and `reassign_reserve` moves SHALL be eligible to act on the populated reserves, subject to the existing hard-constraint check

### Unchanged Behavior (Regression Prevention)

The following existing behaviors must remain unchanged after the fix:

3.1 WHEN a teacher is exempt for a session THEN the system SHALL CONTINUE TO exclude that teacher from both guard and reserve assignments for that session
3.2 WHEN a teacher is already assigned as a guard in a session THEN the system SHALL CONTINUE TO refuse a second guard or reserve assignment in the same session
3.3 WHEN a duty halfday conflicts with the duty teacher's own subject schedule THEN the system SHALL CONTINUE TO resolve it via the existing duty-as-subject conflict logic
3.4 WHEN `supervisors_per_room` is set in the exam center configuration THEN the system SHALL CONTINUE TO assign exactly that many guards per room
3.5 WHEN the legacy v1 algorithm is invoked THEN its outputs SHALL CONTINUE TO be identical to the pre-fix v1 outputs for the same inputs
3.6 WHEN the `allowHalfdayReuse` or `allowDayReuse` options are toggled THEN the system SHALL CONTINUE TO honor those flags for guards and now also for reserves
3.7 WHEN the morning/evening preference option is enabled THEN the system SHALL CONTINUE TO respect it for guard assignments
3.8 WHEN the algorithm produces an assignment row THEN the row SHALL CONTINUE TO carry every existing field (`session_key`, `halfday_key`, `room_key`, `proctors`, `proctor_keys`, `duty_teachers`, etc.) with unchanged semantics, with the addition that `reserves` and `reserve_keys` are now populated
3.9 WHEN the user sets `max_reserves_mode = 'fixed'` with `max_reserves = 0` THEN the system SHALL CONTINUE TO produce zero reserves per session (explicit opt-out remains supported)
3.10 WHEN the user has not configured `examCenterConfig.max_reserves_mode` at all THEN the system SHALL CONTINUE TO read the legacy `examDistributionRules.reservesPerSession` as the fixed reserve count, preserving backward compatibility for existing saved configurations
