# Proctor v2 — Fairness, Duty & Reserves Bugfix Design

## Overview

The v2 algorithm has three structurally separate defects that the bugfix.md collapses into one fix surface:

1. **C1 — fairness when supply > demand:** `costFunction` only penalises load above `lowerBound`. When `lowerBound = 0` (more eligible teachers than guard tasks), every teacher pays zero load penalty until they hit one assignment, so Hungarian arbitrarily reuses the same teacher again instead of an unused peer.
2. **C2 — duty ignored:** the load metric in `costFunction` is `getGuardCount`, never `getPrimaryLoad`. `loadState.dutyCount` is correctly tracked at orchestration time but the Phase 2 Hungarian cost is blind to it.
3. **C3/C4 — reserves never populated:** Phase 2 emits every assignment row with `reserves: [], reserve_keys: []`. There is no Phase that ever fills those arrays, and `buildV2Input` does not forward `examCenterConfig.max_reserves_*` at all — only the legacy `examDistributionRules.reservesPerSession` reaches the algorithm. Phase 3's `swap_roles` and `reassign_reserve` moves therefore see empty reserve lists and short-circuit.

The fix is local to four sites in `js/algorithms/proctor-distribution-v2.js` plus one input-build site in `exams-proctors.html`. No public API change, no v1 change, no row-shape change beyond filling fields that v1 already populates.

## Glossary

- **Bug_Condition (C):** the disjunction `C1 ∨ C2 ∨ C3 ∨ C4` defined in `bugfix.md` `isBugCondition(X)`.
- **Property (P):** the six numbered correctness claims P1–P6 in `bugfix.md`.
- **Preservation:** all behaviour described under §3 (Unchanged Behavior) of `bugfix.md`, plus byte-identical v1 output.
- **F:** the v2 algorithm before the fix (current `window.ProctorDistributionV2.run`). **F':** v2 after the fix.
- **`loadState`:** the shared per-teacher record produced by `getTeacherLoad`. Tracks `guardCount`, `dutyCount`, `reserveCount`, plus per-halfday Sets. Already populated correctly by all three phases — Phase 2 just reads the wrong field.
- **`getPrimaryLoad(loadState, key)`:** `guardCount + dutyCount`. Already exposed.
- **`getFinalLoad(loadState, key)`:** `guardCount + dutyCount + reserveCount`. Already exposed.
- **`reservesConfig`:** new structured input field `{ mode: 'fixed'|'percent', fixed: int, percent: int (0..100) }`.
- **Session shared-reserves invariant (v1):** for any session `S`, every assignment row belonging to `S` holds the **same array reference** in its `reserves` and `reserve_keys` fields. v1 establishes this in the reserves post-pass (`exams-proctors.html` line ≈4833) and Phase 3's `applyReserveSwap` relies on it (`exams-proctors.html` line ≈4437). v2 must honour this so that a single `swap_roles` move propagates across all rows of the session.
- **`eligibleAvailable(S)`:** count of teachers who pass all hard constraints for at least one row in `S`, are not already a guard in `S`, are not on duty during `S.halfdayKey`, and respect the configured halfday/day reuse rules.

## Bug Details

### Bug Condition

```
FUNCTION isBugCondition(X)            // X = output of one F'(input) run
  RETURN  C1(X) OR C2(X) OR C3(X) OR C4(X)
END FUNCTION
```

The four sub-conditions are reproduced verbatim from `bugfix.md` §"Bug Condition C(X)" and are not duplicated here.

### Examples

- **C1:** 30 eligible teachers, 18 guard tasks → `lowerBound = 0`. F gives 12 teachers two tasks and 6 teachers one task, leaving 12 teachers with zero. F' gives every teacher 0 or 1 tasks (`max − min ≤ 1`).
- **C2:** Two teachers T1, T2 with identical eligibility set, T1 is on duty for 2 halfdays. F assigns both 4 guard slots → `finalLoad(T1) = 6`, `finalLoad(T2) = 4`. F' assigns T1 ≈ 2 guard slots so `finalLoad ≈ 4` for both.
- **C3 (fixed):** `examCenterConfig.max_reserves_mode = 'fixed'`, `max_reserves = 4`. F produces every session with `reserves.length = 0`. F' produces `min(4, eligibleAvailable(S))`.
- **C3 (percent):** `max_reserves_mode = 'percent'`, `max_reserves_percent = 25`, session has 8 guards. F produces 0 reserves. F' produces `min(ceil(0.25 × 8), eligibleAvailable(S)) = 2`.
- **C4:** percent mode is configured but `buildV2Input` forwards only the legacy `reservesPerSession` field, so the algorithm sees `mode = 'fixed'`. F' carries `reservesConfig` end-to-end.

## Expected Behavior

### Preservation Requirements

**Unchanged behaviours (must remain byte-identical or semantically identical):**

- Hard-constraint filtering: exemption, duty-as-subject, no double-assign within a session, halfday/day reuse flags.
- `supervisors_per_room` count per row.
- v1 algorithm path (`runAutoDistribution`) is **byte-identical** to pre-fix output for the same inputs (Requirement 3.5 — verified by snapshot).
- Existing row schema: every field already present (`session_key`, `halfday_key`, `room_key`, `proctor_keys`, `duty_teachers`, `softViolations`, …) keeps its semantics. The only change is that `reserves` / `reserve_keys` are now non-empty when configured.
- Existing saved blobs in `examConfig.examAutoDistributionData` keep loading (`detectSavedAlgorithmVersion` unchanged).
- Phase 3 timeout (500 ms), SA defaults, weights presets — all unchanged.

**Scope of the fix:** only inputs that satisfy `C(X)` see a behavioural change. For inputs where `¬C(X)`, F' must equal F (Property P6).

## Hypothesized Root Cause

1. **C1 — load metric saturates at zero.** `costFunction` (line ≈1167) computes `loadPenalty = max(0, guardLoad − lowerBound)`. When `lowerBound = 0`, the penalty is `guardLoad` itself, but the Hungarian solver picks the global minimum — once a teacher reaches `guardLoad = 1`, untouched peers are still at 0 and *should* win, except other soft penalties (`groupMismatch = 5`, `subjectConflict = 2`) outrank the load penalty (multiplier 4) for the *first* assignment, so a teacher who already has 1 guard but no soft penalty beats a fresh teacher with `groupMismatch`. Result: a sub-optimal global minimum that bunches load on a few teachers.
2. **C2 — wrong load field.** `costFunction` reads `getGuardCount`, not `getPrimaryLoad`. `dutyCount` is tracked but ignored. The fix is a one-line swap.
3. **C3/C6 — no reserve-population pass exists.** Phase 2 hard-codes empty arrays, Phase 3 only mutates what is already there.
4. **C4 — input pipeline drops the percent setting.** `buildV2Input` (line ≈2620) forwards `examDistributionRules` but never reads `examCenterConfig.max_reserves_mode/percent`. Even after Phase 2.5 is added, percent mode would never reach it.

## Correctness Properties

Property 1: Bug Condition — Fairness across all eligible teachers

_For any_ input where the bug condition holds (`isBugCondition` returns true via C1), the fixed algorithm SHALL produce an output `X'` with `max(finalLoad(T)) − min(finalLoad(T)) ≤ (upperBound − lowerBound) + 1` over all eligible teachers, satisfying the fairness range claim in §"Correctness Properties P1" of `bugfix.md`.

**Validates: Requirements 2.1**

Property 2: Bug Condition — Duty-aware load balancing

_For any_ input where the bug condition holds (C2) and two teachers T1, T2 share the same eligibility set, the fixed algorithm SHALL produce `|finalLoad(T1) − finalLoad(T2)| ≤ 1`, including the duty contribution in the load metric used by Phase 2's `costFunction`.

**Validates: Requirements 2.2**

Property 3: Bug Condition — Reserves count, fixed mode

_For any_ input where the bug condition holds (C3 with `reservesConfig.mode = 'fixed'`), the fixed algorithm SHALL produce `|reserves(S)| = min(reservesConfig.fixed, eligibleAvailable(S))` for every session `S`.

**Validates: Requirements 2.3, 2.5**

Property 4: Bug Condition — Reserves count, percent mode

_For any_ input where the bug condition holds (C3 with `reservesConfig.mode = 'percent'`), the fixed algorithm SHALL produce `|reserves(S)| = min(ceil(reservesConfig.percent × |guards(S)| / 100), eligibleAvailable(S))` for every session `S`.

**Validates: Requirements 2.3, 2.4**

Property 5: Bug Condition — Reserve eligibility & config plumbing

_For any_ input where the bug condition holds (C3 or C4), the fixed algorithm SHALL place only reserves that pass all hard constraints — not exempt for the session, not on duty during the halfday, not already a guard in the session, halfday/day reuse honoured — AND `reservesConfig` SHALL faithfully reflect `examCenterConfig.max_reserves_*` when set, falling back to `examDistributionRules.reservesPerSession` only when `max_reserves_mode` is absent.

**Validates: Requirements 2.6, 2.7, 2.8, 2.9**

Property 6: Preservation — No regression on inviolate constraints

_For any_ input where the bug condition does NOT hold (`isBugCondition` returns false), the fixed function SHALL produce the same result as the original function on every preserved dimension: no double-assignment, every exemption respected, duty-as-subject conflicts resolved as before, `supervisors_per_room` exact, and the v1 algorithm output byte-identical to pre-fix v1.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10**

## Fix Implementation

### Architecture overview

Five edit sites, each addressing a specific sub-condition. No new modules, no new files.

| # | File | Function | Sub-condition | Nature of change |
|---|------|----------|---------------|------------------|
| 1 | `proctor-distribution-v2.js` | `costFunction` | C2 | Replace `getGuardCount` → `getPrimaryLoad` in load-penalty term. |
| 2 | `proctor-distribution-v2.js` | `costFunction` | C1 | Compute load penalty against `max(lowerBound, currentMaxPrimaryLoad − 1)` (see formula below). |
| 3 | `proctor-distribution-v2.js` | new `phase2_5PopulateReserves` | C3 | New pass between Phase 2 and Phase 3 that fills `row.reserves` / `row.reserve_keys` with the v1 shared-reference convention. |
| 4 | `proctor-distribution-v2.js` | `objectiveFunction` | (supports C1/C2 in SA) | Count `reserve_keys` length in the load standard deviation so Phase 3 actively flattens *total* load, not guard load. |
| 5 | `exams-proctors.html` | `buildV2Input` | C4 | Read `examCenterConfig.max_reserves_mode/max_reserves/max_reserves_percent`; derive `input.reservesConfig`; fall back to `examDistributionRules.reservesPerSession` when absent. |

Phase 3 SA is **not** modified structurally — `swap_roles` and `reassign_reserve` already exist (lines ≈2255 and ≈2310) and become active automatically once Phase 2.5 populates non-empty reserves.

### 1. C1 — Spread load to all eligible teachers

**Two viable approaches were considered. We pick (B).**

**(A) Bonus for zero-load picks.** Inside `costFunction`, when `lowerBound = 0` and any zero-load eligible teacher exists, subtract a large constant from the cost of any candidate with `getPrimaryLoad = 0`. Pros: minimal code. Cons: introduces a discontinuity that interferes with soft-constraint trade-offs (a zero-load teacher in the wrong M/E group could be picked over a perfect-fit teacher with one prior guard); also requires Phase 2 to know "there exists an unused teacher", which is per-session global state that `costFunction` does not currently see.

**(B) Penalise against `max(lowerBound, currentMaxPrimaryLoad)` — chosen.** Replace the load-penalty term

```
loadPenalty = max(0, getGuardCount(loadState, key) − lowerBound)
cost += 4 × loadPenalty
```

with

```
floor       = max(lowerBound, sessionMaxPrimaryLoad − 1)
loadPenalty = max(0, getPrimaryLoad(loadState, key) − floor)
cost += 4 × loadPenalty + (getPrimaryLoad(loadState, key) > 0 ? 0.5 : 0)
```

where `sessionMaxPrimaryLoad` is the maximum `getPrimaryLoad` over teachers already used at least once in any prior assignment (computed once per Hungarian invocation and passed in via the existing `task.usedInSession` plumbing — concretely we attach it to the `costOptions` object at line ≈1623).

The `0.5` term is a uniform "freshness" bonus: any teacher already used pays a half-point regardless of `lowerBound`, which is dominated by every soft penalty (1–5) yet sufficient to break ties in favour of unused peers when the soft penalties match. The `floor` term ensures that once every eligible teacher has been used once, we revert to the original semantics and no pathological piling-on can happen.

**Trade-off (B) vs (A):** (B) is continuous (no spikes), composable with all existing soft penalties, requires only one extra read per cost evaluation, and works for both `lowerBound = 0` and `lowerBound > 0` cases without special-casing. The downside is a small constant in the objective that needs the `0.5 < min(soft penalties) = 1` invariant — documented inline.

### 2. C2 — Duty enters the load metric

Single change inside `costFunction`:

```
- var guardLoad = getGuardCount(loadState, proctorKey);
+ var primaryLoad = getPrimaryLoad(loadState, proctorKey);  // includes dutyCount
```

`loadState.dutyCount` is already populated by `addDutyLoad` during Phase 1 pre-pass (the duty teachers are read from `input.dutyData` and recorded before Phase 2 starts), so no extra plumbing is needed. The same change implicitly fixes C1's "wrong field" angle.

### 3. C3 — Phase 2.5 Reserve Population

**Position in the pipeline:**

```
phase1PrePass(input)                    // CSP + AC-3
phase2Build(phase1Result, input, rng)   // Hungarian per halfday → assignments + loadState
phase2_5PopulateReserves(phase2Result, input, rng)   // NEW
phase3Optimize(phase2Result, input, rng, saConfig)   // SA — now sees real reserves
```

**Inputs:** `phase2Result.assignments` (row-keyed), `phase2Result.loadState` (mutated in place), `input.proctorsList`, `input.exemptionsData`, `input.dutyData`, `input.options.allowHalfdayReuse/allowDayReuse`, `input.reservesConfig`, `rng` (for tie-breaks).

**Outputs:** mutates each row's `reserves` and `reserve_keys` in place (shared reference per session — see invariant below). Mutates `loadState` via `addReserveLoad`. Returns a small diagnostics object: `{ phase2_5DurationMs, sessionsProcessed, totalReservesPlaced, sessionsWithShortage, percentRoundedToZero }`.

**Algorithm (greedy, lowest-`finalLoad` first):**

```
FUNCTION phase2_5PopulateReserves(phase2Result, input, rng)
  loadState  ← phase2Result.loadState
  assignments ← phase2Result.assignments
  cfg        ← input.reservesConfig

  // Group rows by session, preserving the v1 shared-reference invariant
  sessionsBySessionKey ← groupBy(assignments, row → row.session_key)
  sessionKeys ← sessionsBySessionKey.keys() sorted by halfdayKey ASC, sessionKey ASC

  FOR sessionKey IN sessionKeys DO
    rows         ← sessionsBySessionKey[sessionKey]
    halfdayKey   ← rows[0].halfday_key
    sessionGuards ← unique(flatten(rows.map(r → r.proctor_keys)))   // strings, falsy filtered

    // 1. Compute target
    target ← computeReserveTarget(cfg, sessionGuards.length)
    IF target = 0 THEN
       sharedReserves   ← []                  // empty arrays, still shared
       sharedReserveKeys ← []
       FOR row IN rows DO
          row.reserves     ← sharedReserves
          row.reserve_keys ← sharedReserveKeys
       CONTINUE
    END IF

    // 2. Build candidate pool
    candidates ← []
    FOR EACH (proc, idx) IN input.proctorsList DO
       key ← getProctorExemptionKey(proc, idx)
       IF key IN sessionGuards THEN CONTINUE
       IF isExemptForAnyRow(proc, idx, rows, input.exemptionsData) THEN CONTINUE
       IF isOnDutyDuringHalfday(key, halfdayKey, loadState) THEN CONTINUE
       IF NOT allowHalfdayReuse AND key already used in halfdayKey THEN CONTINUE
       IF NOT allowDayReuse     AND key already used in dayKey(halfdayKey) THEN CONTINUE
       candidates.push({ key, proc, idx,
                         finalLoad: getFinalLoad(loadState, key),
                         tiebreak:  rng() })
    END FOR

    // 3. Sort & take
    candidates.sort((a, b) → a.finalLoad − b.finalLoad
                          OR a.tiebreak  − b.tiebreak)
    chosen ← candidates.slice(0, min(target, candidates.length))

    // 4. Build SHARED arrays — one reference per session
    sharedReserves     ← chosen.map(c → c.proc.teacher_name || '')
    sharedReserveKeys  ← chosen.map(c → c.key)

    FOR row IN rows DO
       row.reserves     ← sharedReserves        // intentionally shared reference
       row.reserve_keys ← sharedReserveKeys     // intentionally shared reference
    END FOR

    // 5. Update load state
    FOR c IN chosen DO
       addReserveLoad(loadState, c.key, halfdayKey, c.proc.teacher_name || '')
    END FOR
  END FOR

  RETURN { phase2_5DurationMs, sessionsProcessed, totalReservesPlaced,
           sessionsWithShortage, percentRoundedToZero }
END FUNCTION

FUNCTION computeReserveTarget(cfg, guardCount)
  IF cfg.mode = 'percent' THEN
    RETURN ceil(cfg.percent × guardCount / 100)
  ELSE
    RETURN cfg.fixed
  END IF
END FUNCTION
```

**Edge cases (each must produce a non-throwing, defined output):**

| Case | Behaviour |
|------|-----------|
| `eligibleAvailable(S) < target` | Take all `eligibleAvailable(S)` candidates. Diagnostic increments `sessionsWithShortage`. Row note (first row only) appended: `'خصاص N احتياطي للحصة'` to match v1's note. |
| `mode = 'percent'`, `ceil(percent × G / 100) = 0` despite `G > 0` (i.e. percent = 0) | Target = 0, every row gets a shared empty array. Diagnostic increments `percentRoundedToZero`. No error. |
| `mode = 'fixed'`, `fixed = 0` | Target = 0, shared empty arrays. Backward-compat with §3.9 of `bugfix.md`. |
| `cfg` undefined (legacy code path) | `buildV2Input` guarantees `cfg` is always present (see §"Data contract"). If somehow null, default to `{ mode: 'fixed', fixed: 0, percent: 0 }` — produces zero reserves, no crash. |
| Session has zero guards (degenerate Phase 2 result) | `target = ceil(P × 0 / 100) = 0` for percent and `cfg.fixed` for fixed. Run the algorithm normally — no special branch needed. |

**Sorting determinism:** the `tiebreak: rng()` field is drawn from the same seeded PRNG that runs Phases 1–3, so the same `randomSeed` reproduces the same reserve choices.

**Complexity:** `O(Σ_S |proctors|)` per session, summed over sessions = `O(|sessions| × |proctors|)`. For a typical exam center (≤30 sessions × ≤200 proctors = 6 000 ops) this is far below the Phase 3 budget of 500 ms and adds < 5 ms in practice.

### 4. Phase 3 — `objectiveFunction` tweak

The current `objectiveFunction` (line ≈1953) computes `std(guardLoads)` from `proctor_keys.length` only. Once Phase 2.5 populates reserves, SA would happily push reserves around to no effect because reserves do not enter the load metric. The fix is one block: when accumulating per-proctor load, also walk `row.reserve_keys` and increment a *combined* count that includes both guards and reserves (and, optionally, duty as already tracked in `input.dutyData`). The α-weighted std is then computed on the combined load.

This is the natural counterpart of the C2 fix in Phase 2: both phases now use a "primary + reserve" load signal, which matches `getFinalLoad` semantics.

`swap_roles` and `reassign_reserve` move generators are unchanged. `applyMove` for `swap_roles` already expects `reserve_keys` to be non-empty arrays — verified in code.

### 5. C4 — Data contract change in `buildV2Input`

Inside `buildV2Input` (around line ≈2620), augment the returned object:

```js
const examCenterConfig = (await window.api.examConfig.get(year, 'examCenterConfig')) || {};
const reservesConfig = examCenterConfig.max_reserves_mode
  ? {
      mode:    examCenterConfig.max_reserves_mode === 'percent' ? 'percent' : 'fixed',
      fixed:   Math.max(0, Number(examCenterConfig.max_reserves) || 0),
      percent: Math.max(0, Math.min(100, Number(examCenterConfig.max_reserves_percent) || 0))
    }
  : {
      mode:    'fixed',
      fixed:   Math.max(0, Number((rules || {}).reservesPerSession) || 0),
      percent: 0
    };

return {
  proctorsList, scheduleEntries, exemptionsData, dutyData, meAssignments,
  examDistributionRules: rules,
  options: { …existing… },
  reservesConfig,                      // NEW
  randomSeed: options.randomSeed || null,
  weightsPreset, customWeights, enablePhase3: true,
  syntheticRoomWarnings
};
```

`examDistributionRules` is **not** removed — every existing v2 consumer keeps reading it; only the reserves-count derivation moves to the new field. The legacy `reservesPerSession` is the documented fallback (Requirement 3.10).

`validateInput` gains one optional check: if `input.reservesConfig` is present, assert `mode IN ('fixed','percent')`, `fixed >= 0`, `percent IN [0,100]`. If missing, default to `{ mode: 'fixed', fixed: 0, percent: 0 }` so older callers (tests, fixtures) keep working.

## Data contract changes

### Input shape — additive

| Field | Type | Default | Source |
|-------|------|---------|--------|
| `input.reservesConfig` | `{ mode: 'fixed'\|'percent', fixed: int, percent: int (0..100) }` | `{ mode:'fixed', fixed:0, percent:0 }` | `buildV2Input` reads `examCenterConfig.max_reserves_mode/max_reserves/max_reserves_percent`; falls back to `examDistributionRules.reservesPerSession`. |

No other input field changes. `examDistributionRules` keeps `proctorsPerRoom` and `reservesPerSession`; the latter is now consulted only as a fallback inside `buildV2Input`.

### Output shape — unchanged (only newly populated)

Each row keeps every existing field. The two affected fields are:

- `row.reserves: string[]` — proctor names. Was `[]`; now `[name1, name2, …]` with length `min(target, eligibleAvailable(S))`.
- `row.reserve_keys: string[]` — proctor exemption keys. Same length as `row.reserves`.

**v1 invariant — same Set-like shared reference within a session.** All rows of session `S` carry the **same array instance** in `reserves` (and the same in `reserve_keys`). This matches v1's `applyReserveSwap` (`exams-proctors.html` line ≈4437) and lets Phase 3's `swap_roles` mutate `reserves[k]` once and have the change visible from every row of the session. The pseudocode above enforces this by assigning `sharedReserves` to every row.

**Phase 3 caveat:** `applyMove` for `reassign_reserve` does `splice` on `srcRow.reserve_keys` and `push` on `tgtRow.reserve_keys`. Because rows of the same session share the array, splicing mutates all sibling rows simultaneously — which is the intended v1 semantics. Cross-session reassignment between two different sessions therefore never affects the other session's array (different references). This is correct and matches v1.

## Testing Strategy

### Validation Approach

Two phases. First, run exploratory tests against the **unfixed** v2 to surface counterexamples for each sub-condition; this confirms the root-cause hypothesis. Second, run the same property suite against the fixed v2 to verify P1–P6.

### Exploratory Bug Condition Checking

**Goal:** demonstrate each of C1–C4 on the unfixed code. If any test passes on F (no counterexample), the root-cause analysis is wrong and we re-hypothesize.

**Test plan:** small fixture inputs (≤ 30 proctors, ≤ 20 sessions), assertions stated as Property checks.

| # | Name | Trigger | Expected failure on F |
|---|------|---------|------------------------|
| 1 | C1 — supply > demand | 30 proctors, 8 guard tasks, no soft constraints | `min(finalLoad) = 0` while `max(finalLoad) ≥ 2` for ≥ 1 teacher → P1 fails |
| 2 | C2 — duty-aware peers | 2 proctors with identical eligibility, T1 has 2 duty halfdays | `finalLoad(T1) − finalLoad(T2) ≥ 2` → P2 fails |
| 3 | C3 (fixed) — empty reserves | `reservesConfig = { mode:'fixed', fixed:4 }`, plenty of slack | `|reserves(S)| = 0 ≠ 4` for every S → P3 fails |
| 4 | C3 (percent) — empty reserves | `reservesConfig = { mode:'percent', percent:25 }`, 8 guards/session | `|reserves(S)| = 0 ≠ 2` for every S → P4 fails |
| 5 | C4 — config dropped | `examCenterConfig.max_reserves_mode = 'percent'` but legacy `reservesPerSession = 0` | `input.reservesConfig.mode === 'fixed'` (assertion on `buildV2Input` output) → P5 fails |

**Expected counterexamples & root-cause confirmation:** the failures above pinpoint exactly the four edit sites. If C1's test passes on F (e.g. because soft-constraint-free inputs don't exhibit it), we re-examine the `lowerBound = 0` interaction with the `0.5` freshness term.

### Fix Checking

**Goal:** for every input where `C(X)` holds, F' produces an output that satisfies the corresponding property.

```
FOR ALL input WHERE isBugCondition(F(input)) DO
  X' := F'(input)
  ASSERT NOT isBugCondition(X')        // collective fix
  ASSERT P1(X') AND P2(X') AND P3(X') AND P4(X') AND P5(X')
END FOR
```

### Preservation Checking

**Goal:** for every input where `¬C(X)` (no fairness gap, no duty-aware peer mismatch, reserves correctly sized — i.e. the fix would be a no-op), F' equals F on every dimension that is *not* the reserves arrays.

```
FOR ALL input WHERE NOT isBugCondition(F(input)) DO
  ASSERT proctor_keys(F(input))        = proctor_keys(F'(input))
  ASSERT loadState.guardCount(F(input)) = loadState.guardCount(F'(input))
  ASSERT softViolations(F(input))      = softViolations(F'(input))
  // reserves may transition empty → populated even when C did not hold,
  // because reserves were never produced before; that is the *intended*
  // change and is allowed under §3.8 of bugfix.md.
END FOR
```

**Why PBT here:** preservation is a universal claim over all non-buggy inputs. Hand-written fixtures cannot enumerate the input space; fast-check / Hypothesis-style generators can.

**Test plan:** generate random `(proctorsList, scheduleEntries, exemptionsData, dutyData, reservesConfig)` triples, run F (snapshot of pre-fix v2 saved as a frozen module) and F' on the same input, compare the dimensions above row by row.

### Unit Tests

- `costFunction` — verify duty contribution: two synthetic teachers, identical state except `dutyCount`, assert the higher-duty teacher has higher cost.
- `costFunction` — verify `floor` term: when one teacher has `primaryLoad = 1` and another has `primaryLoad = 0`, assert the zero teacher has lower cost regardless of `lowerBound`.
- `phase2_5PopulateReserves` — fixed mode, `fixed = 4`, assert `reserves.length = 4` and references shared across rows.
- `phase2_5PopulateReserves` — percent mode, `percent = 25`, 8 guards, assert `reserves.length = 2`.
- `phase2_5PopulateReserves` — `eligibleAvailable < target`, assert `reserves.length = eligibleAvailable` and shortage diagnostic incremented.
- `phase2_5PopulateReserves` — `fixed = 0`, assert `reserves.length = 0` and arrays still shared.
- `computeReserveTarget` — boundary cases: `percent=0`, `percent=100`, `guardCount=0`, `guardCount=1`.
- `buildV2Input` — `max_reserves_mode='percent'` propagates; absence falls back to `reservesPerSession`.
- `objectiveFunction` — assigning a reserve to a busy teacher increases the metric; reassigning to an idle teacher decreases it.

### Property-Based Tests

- **P1 — Fairness range.** Generator: random `(N proctors, M tasks)` with `M < N`. Assertion: `max(finalLoad) − min(finalLoad) ≤ (upperBound − lowerBound) + 1`.
- **P2 — Duty-aware peers.** Generator: random eligibility classes; pick two teachers in the same class with random `dutyCount` injection. Assertion: `|finalLoad(T1) − finalLoad(T2)| ≤ 1`.
- **P3 — Fixed mode count.** Generator: random `cfg.fixed ∈ [0, 10]` and random eligibility. Assertion: `|reserves(S)| = min(cfg.fixed, eligibleAvailable(S))` for every `S`.
- **P4 — Percent mode count.** Generator: random `cfg.percent ∈ [0, 100]` and random `|guards(S)|`. Assertion: `|reserves(S)| = min(ceil(cfg.percent × |guards(S)| / 100), eligibleAvailable(S))`.
- **P5 — Reserve eligibility.** Generator: random exemptions and duty data. Assertion: every reserve passes all four hard constraints (not exempt, not on duty, not a guard, reuse rules).
- **P6 — v1 byte-equality.** Generator: random valid input. Assertion: `runAutoDistribution(input)` produces the same JSON as the pre-fix snapshot (v1 untouched).

### Integration Tests

- End-to-end run on `exams-proctors.html`: configure `max_reserves_mode = 'percent'`, `max_reserves_percent = 20`, run v2, assert every session row shows reserves in the table, save the output, reload, verify the saved blob round-trips.
- Toggle `max_reserves_mode = 'fixed'`, `max_reserves = 0`, run v2, assert zero reserves and no crash.
- Switch the algorithm toggle to v1, run, assert byte-identical output to a pre-fix snapshot.
- Run with `examCenterConfig.max_reserves_mode` absent (legacy saved config), assert `reservesPerSession` is honoured.

## Migration / Backward Compatibility

- **Saved blobs (`examConfig.examAutoDistributionData`):** structurally unchanged. The blob contains `{ algorithmVersion: 'v2', rows, diagnostics }` or a plain v1 array. `detectSavedAlgorithmVersion` is unchanged. `rows` keep the same field names; `reserves` / `reserve_keys` were already present (just empty in v2 outputs); pre-fix saves still load and render correctly.
- **Saved `examCenterConfig`:** users who never touched the reserves UI have no `max_reserves_mode` field. The fallback path (`reservesPerSession`) preserves their behaviour exactly.
- **v1 path (`runAutoDistribution`):** untouched. Property P6 asserts byte-equality against a pre-fix snapshot.
- **Diagnostics panel:** existing fields unchanged. New optional fields `phase2_5DurationMs`, `totalReservesPlaced`, `sessionsWithShortage`, `percentRoundedToZero` are additive — old snapshots without them render the existing fields; new snapshots optionally render the extras.
- **Test fixtures:** any fixture that constructs a v2 input without `reservesConfig` continues to work via the default `{ mode:'fixed', fixed:0, percent:0 }`.

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Phase 2.5 pass adds latency | Low | Low | Bounded `O(sessions × proctors)`. ≤ 5 ms in practice; Phase 3 budget (500 ms) untouched. |
| Shared-reference invariant accidentally broken by future row-mapping code | Medium | High | Phase 3's `swap_roles` relies on it. Mitigation: PBT test asserts `row1.reserves === row2.reserves` for every pair of rows in the same session. |
| `0.5` freshness constant interferes with edge soft-constraint priorities | Low | Medium | Constant chosen to be strictly less than every existing soft penalty (1, 2, 3, 5). Documented inline; covered by the "load wins over soft when tied" unit test. |
| Percent rounding inflates reserves beyond available pool | Low | Low | `min(target, eligibleAvailable(S))` is enforced inside Phase 2.5; no overflow possible. |
| `objectiveFunction` change perturbs Phase 3 acceptance rate | Low | Low | Absolute scale of `std(combinedLoad)` is comparable to `std(guardLoad)` (same units). SA temperature schedule is unchanged. Verified by integration test that `acceptedMoves / iterationsExecuted` ratio is within ±10% of pre-fix. |
| `validateInput` rejects pre-existing test fixtures | Low | Low | `reservesConfig` is optional; missing field defaults silently. |
