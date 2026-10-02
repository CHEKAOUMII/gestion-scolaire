# Bugfix Requirements Document — Proctor v2 Strict Fairness & Full Coverage

## Introduction

Even after the previous fixes shipped under spec `proctor-v2-fairness-duty-reserves` (C1–C4), the Proctor Distribution v2 algorithm still produces guard distributions that the user considers unfair. In a recent run (screenshot supplied by the user) one teacher was assigned **5 guard sessions** while another teacher in the same exam center was assigned only **1 guard session** — a max−min gap of **4** for the guard-count metric.

The user has stated the requirement in the following terms (verbatim, Arabic):

> «أريد اولا ان أعالج مشكل الفرق الشاسع في عدد مرات الحراسة، ادا قسمنا عدد المهام "بدون مداومة واحتياط" 368 مقسمة على عدد الاساتدة تعطينا 2.5 هدا يعني اقل مراقب يحرس مرتان، اكثر مراقب يحرس 3 مرات. وكدلك الحراسة يجب ان تشمل الجميع بدون استتناء الا ادا كان معفى مسبقا.»

Translated and decomposed:

1. The fairness target is computed on **`primaryLoad = guardCount + dutyCount`**, excluding only reserves (`reserves`). With `G = 368` guard tasks and `D = 15` duty tasks (5 from the regional exam plus 10 from the national exam, each (proctor, halfday) pair counted once), `G_total = G + D = 383`. For N proctors with `383 / N ≈ 2.6`, the minimum `primaryLoad` must be `floor(383 / N)` and the maximum must be `ceil(383 / N)`. The observed `max − min = 4` on the guards-only axis is already unacceptable, and once duty is folded in the gap is even more severe for teachers carrying duty halfdays on top of multiple guards.
2. The distribution must **cover every proctor** in `proctorsList` who is not pre-exempted from every session of the exam window. No eligible proctor may end the run with `primaryLoad = 0` while peers are loaded above `lowerBound_primary`. A teacher with `guardCount = 0` but `dutyCount ≥ 1` is already covered (their duty halfday is real exam-day work).

This bugfix constrains the v2 algorithm to satisfy strict fairness and full coverage on the **`primaryLoad` axis** (`guardCount + dutyCount`, excluding reserves), without regressing the constraints honored by the prior spec.

### Why Combine Guards and Duty?

Duty assignments are user-pinned and consume teacher availability per halfday. A teacher with one duty halfday already has 1 unit of "exam-day work" before any guard placement; awarding them additional guards on top of guards-only peers without accounting for the duty would punish them. The fairness invariant therefore operates on `primaryLoad = guardCount + dutyCount`, which matches the cost-function metric the prior spec already established (C2 fix). The user's «368 + 15 = 383, divided by N» reasoning enforces this axis as the single fairness target. Duty assignments themselves are NOT chosen by the algorithm — they are user-supplied input via `input.dutyData` (configured in the duty panel of `exams-proctors.html`); the algorithm only consumes them when computing `primaryLoad`.

### Why is `D_expected` user-supplied rather than counted from `dutyData`?

The user-facing duty configuration screen lets users manually pin teachers to specific `(session, subject)` entries. The number of distinct `(teacher, halfday)` pairs that emerge from this — what `dutyCount(T)` actually counts — depends on the user's pinning choices and is hard to reason about ahead of time. To keep the fairness target predictable and under user control, this fix introduces an explicit user setting `expectedDutyTasks` (`D_expected`) that the user fills in alongside `proctorsPerRoom` and `reservesPerSession`. The bounds for fairness are then computed from `G + D_expected`. This means:

1. The user can steer the bounds without touching `dutyData`.
2. The bounds remain stable even while the user edits the duty pin list.
3. The algorithm's per-teacher `primaryLoad = guardCount + dutyCount` keeps reading the actual `loadState.dutyCount` populated from `dutyData` — that is unchanged.
4. If `D_expected` and the actual `Σ dutyCount(T)` diverge, the algorithm still satisfies the per-class bounds it computed; the user gets a diagnostic warning to alert them.

### Glossary

- **Session (حصة):** one exam timeslot identified by `date_day + period + session`.
- **Halfday:** morning or afternoon block of a given date.
- **Guard task:** one room-slot assignment that requires a primary supervisor (`proctor_keys[i]`). The `duty_teachers` and `reserves` arrays of the assignment row are NOT guard tasks.
- **Duty task (مداومة):** assignment recorded in `input.dutyData` for `(session_key, subject_name, proctor_key)`. Duty teachers are pre-assigned BY THE USER in the duty configuration step (see `exams-proctors.html` duty panel). The algorithm does NOT decide who is on duty — it consumes `dutyData` as fixed input.
- **Total guard tasks (`G`):** the count of guard slots across the whole exam window, equal to `Σ over rows R: proctor_keys.length` if every guard slot is filled. For a rigorous bound, `G = Σ over (entry, room) pairs: proctorsPerRoom`. This is the value the user calls "368".
- **Expected duty tasks (`D_expected`):** a non-negative integer the user supplies in the exam configuration UI (a new dedicated field in the exam configuration store, e.g. `examCenterConfig.expected_duty_tasks` or `examDistributionRules.expectedDutyTasks` — the exact field name is to be specified in `design.md`). Represents the user's planned total of duty assignments across the whole exam window. Used **only** for computing fairness bounds (`lowerBound_primary` / `upperBound_primary`); it does NOT influence which teachers actually go on duty — the user still pins the actual duty assignments via `examDutyTeachersData` / `input.dutyData` on the duty configuration screen. Default: `0` when absent (legacy fixtures keep working — bounds collapse to the guards-only computation).
- **`G_total`:** `G + D_expected = totalGuardTasks + userConfiguredExpectedDutyTasks`. The user's example: `368 + 15 = 383`. Note: `G_total` is computed from the user-supplied `D_expected`, NOT from the actual count of `(teacher, halfday)` pairs derivable from `input.dutyData`.
- **Eligible proctor (for the run):** a proctor `T ∈ input.proctorsList` such that `T` is **not** exempt from every session in `scheduleEntries`. Formally, `eligibleProctors(input) = { T ∈ proctorsList : ∃ session S ∈ scheduleEntries with T not exempt for S AND T not on duty during S.halfday AND no other hard constraint blocks T at S }`.
- **Number of eligible proctors (`N`):** `|eligibleProctors(input)|`.
- **`guardCount(T)`:** number of distinct guard-slot appearances for proctor `T` in the run output, i.e. count of `i, R` such that `R.proctor_keys[i] === T.key`. Reserves and duty do NOT count toward `guardCount`.
- **`dutyCount(T)`:** the number of halfdays where `T` is on duty, as recorded by `addDutyLoad(loadState, key, halfdayKey, ...)` during the Phase 1 pre-pass. Sourced exclusively from `input.dutyData`.
- **`primaryLoad(T)`:** `guardCount(T) + dutyCount(T)`. **This is the fairness axis.** Reserves are explicitly excluded.
- **`lowerBound_primary`:** `floor(G_total / N)` where `G_total` uses the user-supplied `D_expected`, NOT the actual count of `(teacher, halfday)` pairs in `dutyData`. With the user's numbers, `floor(383 / N)`.
- **`upperBound_primary`:** `ceil(G_total / N) = lowerBound_primary + (1 if G_total mod N ≠ 0 else 0)`. For `383 / N` with N = 147 this is `3`.
- **Eligibility class:** the equivalence class on `eligibleProctors(input)` where `T1 ≡ T2` iff (a) for every session S in `scheduleEntries`, `T1` is hard-constraint eligible for S iff `T2` is, AND (b) `T1` and `T2` carry the same set of pre-pinned duty halfdays (i.e. identical `dutyHalfdays` set in `loadState`). Two teachers in the same class can substitute for one another at every session and start Phase 2 with the same `dutyCount`, so a single `primaryLoad` target band applies to them. A teacher with one duty halfday and a teacher with zero duty halfdays may sit in different classes; even when the rest of their eligibility matches, they will hit different `primaryLoad` bands because their `dutyCount` baselines differ.
- **`classLowerBound_primary`, `classUpperBound_primary`:** per-class bounds on `primaryLoad`, computed for the sub-problem of guard slots reachable by members of the class given their pre-pinned duty load.
- **F:** the v2 algorithm as it ships today (after `proctor-v2-fairness-duty-reserves`). **F':** the v2 algorithm after this fix.

### Bug Condition C(X)

Let `X = { rows, loadState, eligibleProctors, G, D, N, input }` be a v2 algorithm output produced by F on a run input. C(X) is true if X violates **at least one** of the two sub-conditions below:

```pascal
FUNCTION isBugCondition(X)
  INPUT:  X = { rows, loadState, eligibleProctors, G, D, N, input }
  OUTPUT: boolean

  // C1 — Strict fairness on the primaryLoad axis (guardCount + dutyCount).
  //      Two eligibility-equivalent proctors differ in primaryLoad by more than 1.
  C1 ← EXISTS T1, T2 IN eligibleProctors(X) :
         T1 and T2 are in the SAME eligibility class
         AND |primaryLoad(T1) − primaryLoad(T2)| > 1

  // C2 — Coverage on primaryLoad.
  //      Some eligible proctor receives zero exam-day work (no guard AND no duty)
  //      while at least one session existed where they were eligible.
  //      A teacher with dutyCount(T) ≥ 1 is already covered even if guardCount(T) = 0.
  C2 ← EXISTS T IN eligibleProctors(X) :
         primaryLoad(T) = 0
         AND ∃ session S ∈ scheduleEntries(X) :
               T is hard-constraint eligible for S

  RETURN C1 OR C2
END FUNCTION
```

The fix is correct iff `NOT isBugCondition(X)` for every output X produced by F'.

### Correctness Properties

```pascal
// P1 — Strict fairness across an eligibility class on the primaryLoad axis.
FOR ALL X, T1, T2 IN eligibleProctors(X)
        WHERE T1 and T2 are in the same eligibility class DO
  ASSERT abs(primaryLoad(T1) − primaryLoad(T2)) ≤ 1
END FOR

// P2 — Bound match on primaryLoad.
//      Per-class bounds are derived from `G_class + D_expected_class`, where
//      D_expected_class is the user-allocated portion of the user-supplied
//      D_expected falling on this class (default split rule: proportional to
//      class size, or uniform / zero when class data unavailable — see
//      design.md for the exact rule). The minimum admissible band for the
//      single-class case collapses to [lowerBound_primary, upperBound_primary]
//      computed from G_total = G + D_expected.
//      Within each eligibility class C, every member's primaryLoad lies in
//      { classLowerBound_primary, classUpperBound_primary } where bounds are
//      computed for the sub-problem restricted to that class's reachable
//      sessions and the user-allocated share of D_expected for the class.
FOR ALL X, C IN eligibilityClasses(X), T IN C DO
  ASSERT classLowerBound_primary_C ≤ primaryLoad(T) ≤ classUpperBound_primary_C
END FOR

// P3 — Coverage on primaryLoad.
//      Every eligible proctor has at least one unit of exam-day work
//      (guard or duty). Pre-pinned duty alone satisfies this.
FOR ALL X, T IN eligibleProctors(X) DO
  ASSERT primaryLoad(T) ≥ 1
END FOR

// P4 — Preservation: hard constraints from the prior fix remain inviolate.
FOR ALL X DO
  ASSERT no proctor appears twice in any single session
     AND every exemption is respected
     AND every duty-as-subject conflict resolved as before
     AND supervisors_per_room honored exactly
     AND reserves still populated per reservesConfig (as shipped in the prior spec)
     AND v1 algorithm outputs are byte-identical to pre-fix v1
END FOR
```

> **Note on P1 vs the user's example.** The user's «(368 + 15) / N ≈ 2.6 → min=2, max=3» reasoning is the **single-class** specialization of P1 + P2, where every proctor is hard-constraint eligible for every session and shares the same baseline `dutyCount`. P1 captures the more general case where two proctors in the same class must still differ on `primaryLoad` by at most 1, even when other classes carry different per-class bounds because their members hold different duty halfdays.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the v2 algorithm completes a run AND two proctors `T1`, `T2` belong to the same eligibility class THEN the system can produce an output where `|primaryLoad(T1) − primaryLoad(T2)| ≥ 2` (in the reported run, T1 has 5 guards + 0 duty = primaryLoad 5, while another teacher in the same class has 1 guard + 0 duty = primaryLoad 1, gap = 4)

1.2 WHEN a proctor `T` is in `proctorsList` AND `T` is hard-constraint eligible for at least one session in `scheduleEntries` AND `dutyCount(T) = 0` THEN the system can still produce an output where `primaryLoad(T) = 0` (i.e. zero guards and zero duty for an otherwise-eligible teacher)

1.3 WHEN the user reads `lowerBound` and `upperBound` from the diagnostics panel THEN those bounds are computed from `(totalTasks − fixedReservedTasks) / numEligibleTeachers` over the WHOLE problem, not per eligibility class, so the displayed numbers do not reflect the per-class targets that strict fairness requires

1.4 WHEN Phase 2 Hungarian places a guard slot AND the soft-constraint penalty for placing an idle peer (e.g. `groupMismatch = 5`) exceeds the load-penalty contribution `4 × max(0, primaryLoad − floor)` THEN the system prefers a teacher that is already at `primaryLoad ≥ classUpperBound_primary + 1` over an idle eligible teacher, propagating the unfairness defect on the `primaryLoad` axis

1.5 WHEN Phase 2 finishes AND some eligible teacher has `guardCount = 0` THEN the system does not run any post-Phase-2 coverage repair pass to swap that teacher onto an over-loaded teacher's slot, so the zero-guard outcome survives into the final output

1.6 WHEN the user wants to set the fairness target THEN the system does NOT currently expose any input for `D_expected`; bounds are derived purely from guard tasks divided by eligible teachers, ignoring duty entirely

### Expected Behavior (Correct)

2.1 WHEN the v2 algorithm completes a run AND two proctors `T1`, `T2` belong to the same eligibility class THEN the system SHALL produce an output where `|primaryLoad(T1) − primaryLoad(T2)| ≤ 1`

2.2 WHEN a proctor `T` is in `proctorsList` AND `T` is hard-constraint eligible for at least one session in `scheduleEntries` THEN the system SHALL produce an output where `primaryLoad(T) ≥ 1` (i.e. coverage is satisfied by either a guard placement or a pre-pinned duty halfday — a teacher already on duty needs no additional guard to be considered covered)

2.3 WHEN the user reads bounds from the diagnostics panel THEN the system SHALL surface, in addition to the existing global `lowerBound` / `upperBound`, the per-eligibility-class bounds `{ classId, classSize, classTasks, classLowerBound, classUpperBound }` so that the displayed targets match the ones the algorithm actually enforces

2.4 WHEN Phase 2 Hungarian places a guard slot THEN the system SHALL treat the per-class `primaryLoad` target as a HARD constraint: the cost matrix SHALL return `INFINITY_SENTINEL` for any candidate whose guard placement would push their post-assignment `primaryLoad` past `classUpperBound_primary` for that class, except when no other in-class peer is available (in which case the row's caller falls through to the existing greedy fallback)

2.5 WHEN Phase 2 finishes AND any eligible proctor has `primaryLoad = 0` THEN the system SHALL run a post-Phase-2 coverage-repair pass that, for each uncovered eligible proctor `T_uncov`, swaps `T_uncov` onto a guard slot currently held by a peer `T_over` such that `primaryLoad(T_over) ≥ classUpperBound_primary + 1` (or, failing that, `≥ classUpperBound_primary` if no over-loaded peer exceeds the upper bound), provided the swap keeps every existing hard constraint satisfied; the pass SHALL terminate either when every eligible proctor has `primaryLoad ≥ 1` OR when no further swap is feasible without violating a hard constraint

2.6 WHEN the coverage-repair pass cannot raise some eligible proctor's `primaryLoad` above zero without violating a hard constraint THEN the system SHALL emit a diagnostic warning identifying that proctor and the reason (e.g. "no swappable peer with classUpperBound+1 found"); this is a soft outcome — the run continues and the rest of the output is still produced — and it counts as a regression target the user can act on by adjusting exemptions or duty data

2.7 WHEN the coverage-repair pass swaps `T_uncov` onto a slot from `T_over` THEN the system SHALL update `loadState.guardCount` and `loadState.guardHalfdays` for both teachers consistently; `loadState.dutyCount` and `loadState.dutyHalfdays` SHALL NOT be touched (duty is user-supplied input, never algorithmically reassigned); the row's `proctor_keys` and `proctors` arrays SHALL be updated; and the swap SHALL NOT introduce any duplicate proctor in the same session

2.8 WHEN the diagnostics object is emitted THEN the system SHALL add the additive fields `coverageRepairSwaps` (count of swaps performed), `coverageRepairUnresolved` (count of eligible proctors still uncovered), `maxPrimaryLoadGapWithinClass` (max over classes of `max(primaryLoad) − min(primaryLoad)`), and `eligibilityClassCount`

2.9 WHEN computing `lowerBound_primary` and `upperBound_primary` for the run THEN the system SHALL include the user-supplied `D_expected` in the total: `G_total = guardTasks + D_expected` where `D_expected` is read from a dedicated field in the exam configuration (e.g. `examCenterConfig.expected_duty_tasks` or equivalent location to be specified in `design.md`); WHEN `D_expected` is absent or `0` THEN the bounds SHALL collapse to the guards-only computation `floor(G / N), ceil(G / N)` — backward-compatible with current behaviour; the per-class bounds SHALL be derived from the class's reachable guard slots plus the user-allocated share of `D_expected` for the class, so that `classLowerBound_primary` and `classUpperBound_primary` correctly bracket `primaryLoad` for every member of the class

2.10 WHEN a teacher `T` has `dutyCount(T) ≥ classUpperBound_primary` THEN the system SHALL NOT assign `T` any guard slot — the duty load alone already meets or exceeds the upper bound, and any additional guard would push `primaryLoad(T)` past `classUpperBound_primary` and violate P1/P2; Phase 2 cost matrix SHALL return `INFINITY_SENTINEL` for `T` in this state, and the coverage-repair pass SHALL NOT swap any guard slot onto `T`

2.11 WHEN the user opens the exam configuration UI THEN the system SHALL expose a numeric input labelled "عدد مهام المداومة المتوقَّع" (Expected duty tasks count) with default `0`, validation `>= 0`, and persistence to the same `examConfig` store the other distribution settings (`proctorsPerRoom`, `reservesPerSession`, …) live in; the label and tooltip SHALL clarify that this number is used for fairness bounds only and does NOT affect who is actually placed on duty

2.12 WHEN `D_expected` is set AND the sum `Σ dutyCount(T) over all eligible T` (i.e. the actual count of `(teacher, halfday)` pairs in `loadState` after the Phase 1 pre-pass) differs from `D_expected` by more than a tolerance threshold (e.g. 20%) THEN the system SHALL emit a diagnostic warning of the form `D_expected = X, but actual duty pairs = Y; the displayed fairness bounds may be stale until D_expected is updated`; this is a soft outcome — the run continues and the rest of the output is still produced

2.13 WHEN computing per-class bounds AND `D_expected > 0` THEN the system SHALL distribute `D_expected` across eligibility classes proportionally to class sizes (or uniformly when class membership cannot be determined for an upstream proportional split); the exact split rule SHALL be specified in `design.md`

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a teacher is exempt for a session THEN the system SHALL CONTINUE TO exclude that teacher from both guard and reserve assignments for that session

3.2 WHEN a teacher is already a guard in a session THEN the system SHALL CONTINUE TO refuse a second guard or reserve assignment in the same session

3.3 WHEN a duty halfday conflicts with the duty teacher's own subject schedule THEN the system SHALL CONTINUE TO resolve it via the existing duty-as-subject conflict logic

3.4 WHEN `supervisors_per_room` is set in the exam center configuration THEN the system SHALL CONTINUE TO assign exactly that many guards per room

3.5 WHEN `examCenterConfig.max_reserves_mode` is set (`'fixed'` or `'percent'`) or absent THEN the system SHALL CONTINUE TO populate `reserves` and `reserve_keys` per the contract delivered by the prior spec `proctor-v2-fairness-duty-reserves` (P3, P4 of that spec)

3.6 WHEN a teacher is on duty for one or more halfdays THEN the system SHALL CONTINUE TO honor the duty-aware cost contribution introduced by the prior spec, so that two teachers in the same eligibility class with different duty counts still satisfy `|guardCount(T1) − guardCount(T2)| ≤ 1`

3.7 WHEN the legacy v1 algorithm is invoked THEN its outputs SHALL CONTINUE TO be byte-identical to the pre-fix v1 outputs for the same inputs

3.8 WHEN the `allowHalfdayReuse` or `allowDayReuse` options are toggled THEN the system SHALL CONTINUE TO honor those flags for guards and reserves

3.9 WHEN the morning/evening preference option is enabled THEN the system SHALL CONTINUE TO respect it for guard assignments, but only as a soft preference — strict fairness (P1) and coverage (P3) take precedence as hard constraints

3.10 WHEN the algorithm produces an assignment row THEN the row SHALL CONTINUE TO carry every existing field (`session_key`, `halfday_key`, `room_key`, `proctors`, `proctor_keys`, `duty_teachers`, `reserves`, `reserve_keys`, etc.) with unchanged semantics; the only addition is the four new diagnostics fields listed in 2.8

3.11 WHEN `input.dutyData` is non-empty THEN the system SHALL CONTINUE TO treat the duty assignments themselves as user-supplied fixed input (not algorithmically reassigned), and `addDutyLoad(loadState, key, halfdayKey, ...)` SHALL CONTINUE TO populate `loadState.dutyCount` and `loadState.dutyHalfdays` exactly as today during the Phase 1 pre-pass; the new `D_expected` setting is **separate** from `dutyData` and only feeds the fairness-bound computation — no fix in this spec mutates duty data, the algorithm only reads `dutyCount` to compute `primaryLoad` and reads `D_expected` to compute the bounds
