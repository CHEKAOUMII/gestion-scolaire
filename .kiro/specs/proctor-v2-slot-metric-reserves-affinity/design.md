# Proctor v2 — Slot Metric & Reserve Affinity Bugfix Design

## Overview

The previous bugfix `proctor-v2-strict-fairness-coverage` made per-class fairness on `primaryLoad` a HARD invariant inside `costFunction` and added the post-Phase-2 coverage repair pass. Both paths read `getPrimaryLoad`, which transitively reads `loadState[T].guardCount`. The defect surfaced during live verification on the user's centre (147 proctors, 368 slots, `D_expected = 15`): the cap fires correctly on its **internal** metric, yet the user observes one teacher at slot count `5` and another at `1` — the cap is bounding the wrong axis.

The cause is `addGuardLoad`. It deduplicates by `halfdayKey` via a `Set` and increments `guardCount` only on first-of-halfday calls. When the prior spec `proctor-v2-fairness-duty-reserves` allowed `allowHalfdayReuse`, the dedup behaviour silently became a counting bug: a proctor guarding two rooms in the same session, or two consecutive sessions of the same halfday, is bookkept as `guardCount = 1` while their actual slot work is `2`. The user has chosen option **B — count by slots** as the fairness axis (see `notes/2026-05-15-fairness-metric-and-reserves.md` §2). A proctor who guards two rooms in the same session is doing two units of work; the fairness invariant must reflect that.

The same verification surfaced a second, independent defect in `phase2_5PopulateReserves`: the candidate sort key `(finalLoad ASC, rng ASC)` does NOT capture the user's two preferences. The user has stated (verbatim Arabic in `bugfix.md` §"Introduction"): reserves should **spread** first (everyone serves at most once before anyone serves twice), then prefer **affinity** (a proctor who guarded session 1 of a halfday is a better reserve for session 2 of the same halfday because they are already on site), and only then fall through to balance + random tiebreak. Both criteria must enter the sort key; spread must dominate affinity, affinity must dominate balance.

This bugfix delivers two coupled corrections inside `js/algorithms/proctor-distribution-v2.js`. No new modules. No UI change (`D_expected` plumbing stays as the prior spec shipped it). No v1 change. No row-shape change. The fix lives in six edit sites (one helper added, one function rewritten, one sort key replaced, three documentation-only changes that ride the metric switch automatically).

## Glossary

- **Slot:** one `(row, proctor-position)` pair. Equivalently: one cell in `row.proctor_keys[]`. A row with `proctorsPerRoom = 2` contributes 2 slots; a session with 4 rooms × `proctorsPerRoom = 2` contributes 8 slots.
- **`guardSlotCount(T)`:** the total number of `T.key` appearances across `row.proctor_keys[i]` in the run output. The new fairness axis. After this fix, `loadState[T].guardCount` exactly equals `guardSlotCount(T)`.
- **`guardHalfdayCount(T)` (legacy):** the number of distinct halfdays in which `T` appears as a guard, exposed by `loadState[T].guardHalfdays.size`. Retained but no longer the fairness axis.
- **`primaryLoad(T)` (post-fix):** `guardSlotCount(T) + dutyCount(T)`. Read via `getPrimaryLoad(loadState, T.key)`. Consumers: `costFunction` hard cap (≈line 1466), per-class fairness invariant, `phase2_75CoverageRepair` peer eligibility, `objectiveFunction` primary-load aggregation, orchestrator diagnostics.
- **`finalLoad(T)` (post-fix):** `guardSlotCount(T) + reserveCount(T) + dutyCount(T)`. Read via `getFinalLoad(loadState, T.key)`.
- **`reserveCount(T)`:** number of reserve slots `T` has accumulated, already slot-based via `addReserveLoad`. Tracked in `loadState[T].reserveCount`. Unchanged by this fix.
- **`affinityRank(T, S, H)`:** new derived value `∈ {0, 1}`. Returns `0` (preferred) iff (a) `S` is the second session of halfday `H`, and (b) `T.key` appears in any row of the first session of `H`. Returns `1` otherwise.
- **Halfday `H`:** the morning or afternoon block of a single date. Identified by `halfdayKey`. The user has confirmed a hard upper bound of **2** sessions per halfday — `S1` (first) and `S2` (second), ordered by start time then `sessionKey` ASC.
- **Bug_Condition (C):** the disjunction `C1 ∨ C2 ∨ C3` from `bugfix.md` §"Bug Conditions".
- **Property (P):** the four numbered claims P1–P4 from `bugfix.md` §"Correctness Properties".
- **Preservation:** every behaviour described under `bugfix.md` §"Unchanged Behavior", plus byte-identical v1 output.
- **F:** v2 as it ships today (post `proctor-v2-strict-fairness-coverage`). **F':** v2 after this fix.

## Bug Details

### Bug Condition

```
FUNCTION isBugCondition(X)            // X = output of one F(input) run
  RETURN  C1(X) OR C2(X) OR C3(X)
END FUNCTION
```

- **C1** — `loadState(T).guardCount` ≠ `Σ over rows R: |{ i : R.proctor_keys[i] = T.key }|` for some eligible `T`.
- **C2** — two reserve-eligible proctors `T1`, `T2` differ in `reserveCount` by more than 1 while `T2` is at `reserveCount = 0` and was reserve-eligible for an under-filled session.
- **C3** — a second-of-halfday session picked a reserve from outside the first-session guard set even though an eligible first-session guard with non-worse `reserveCount` was available.

The full Pascal-style spec is reproduced verbatim in `bugfix.md` §"Bug Conditions" and is not duplicated here.

### Examples

- **C1 — two-room single-session.** A proctor `T` is assigned to rooms `R_a` and `R_b` of the same session `S`. Post-Phase-2: `T.key` appears twice in the union of `proctor_keys` for `S`. F reports `loadState[T].guardCount = 1`. F' reports `2`. The cost-function hard cap on F lets `T` accumulate further slots up to `classUpperBound = 3` on the wrong axis (3 halfdays of which several have multi-room slots → actual slots ≫ 3).
- **C1 — two-session halfday.** A proctor `T` guards both `S1` and `S2` of halfday `H`. F reports `guardCount = 1`; F' reports `2`. With `D_expected = 15`, `G = 368`, `N = 147`, the user's centre has `classUpperBound = ceil(383 / 147) = 3`. F lets `T` reach actual slot work 5 (3 halfdays × ~1.6 sessions/halfday) without firing the cap.
- **C2 — spread violation.** Run with 5 sessions, `reservesPerSession = 2`, 10 reserve-eligible proctors. F's sort `(finalLoad, rng)` lets the same handful of low-`finalLoad` proctors take 2 reserves each before others take 1. F' rotates: every proctor reaches `reserveCount = 1` before anyone reaches `2`.
- **C3 — affinity violation.** Halfday `H` has `S1`, `S2`. `S2` needs 1 reserve. Eligible first-session guards `{T_a, T_b}` at `reserveCount = 0`. Eligible non-first-session candidate `T_x` at `reserveCount = 0` too. F picks `T_x` because their `finalLoad` happens to be lower by 1. F' picks `T_a` (or `T_b`) because their `affinityRank = 0` outranks `T_x`'s `affinityRank = 1`.
- **Edge — single-session halfday.** Halfday holds one session only. `affinityRank = 1` for everyone; sort collapses to `(reserveCount, finalLoad, rng)`. No change of intent vs. the spread rule alone.

## Expected Behavior

### Preservation Requirements

**Unchanged behaviours (must remain byte-identical or semantically identical):**

- All hard-constraint filtering: exemption, no double-assign within a session, duty-as-subject conflicts, `supervisors_per_room` exact, halfday/day reuse flags, M/E group preference as a soft constraint (`bugfix.md` 3.6).
- Reserves contract from prior specs: `addReserveLoad` slot semantics (3.1), `reserves[]` / `reserve_keys[]` shared-reference invariant (3.7), reserve target computation (`computeReserveTarget`, percent / fixed modes), shortage notes (`خصاص N احتياطي للحصة`).
- `addDutyLoad` and the `input.dutyData` semantics — duty assignments stay user-supplied fixed input; the algorithm only reads `dutyCount` from `loadState` (3.2).
- Per-class fairness from `proctor-v2-strict-fairness-coverage`: `|primaryLoad(T1) − primaryLoad(T2)| ≤ 1` for `T1, T2` in the same eligibility class — restated on the new slot-based `primaryLoad` (3.3).
- Coverage repair from `proctor-v2-strict-fairness-coverage`: every eligible proctor ends with `primaryLoad ≥ 1`. The three-tier relaxation strategy (`>= classUB+1`, `>= classUB`, `>= classLB+1`) is unchanged — only the metric switches (3.4, 3.9).
- `D_expected` plumbing from `proctor-v2-strict-fairness-coverage`: `examCenterConfig.expected_duty_tasks` UI input, `buildV2Input` read, `D_expected` divergence warning, `classBoundsByProctorKey` map (3.5).
- v1 algorithm path (`runAutoDistribution`) is byte-identical to pre-fix output for the same inputs (3.8).
- Diagnostics fields: every existing field keeps its meaning. New fields (if any) MUST be additive (3.11).

**Scope of the fix.** Only inputs that satisfy `C(X)` see a behavioural change. For inputs where `¬C(X)` (no slot-vs-halfday divergence and no spread/affinity violation), F' MUST agree with F on every dimension — `proctor_keys`, `dutyCount`, `softViolations`, the `reserves[]` shared-reference invariant, and v1 output (P4).

## Hypothesized Root Cause

**Why the slot metric.** `addGuardLoad` (line ≈283) was implemented when the design contract was halfday-based — one teacher cannot serve more than once in a halfday — and `guardCount` was an artefact of that bookkeeping. The function increments `guardCount` only when the halfday is new to the proctor's `guardHalfdays` Set. When `proctor-v2-fairness-duty-reserves` lifted that hard rule by introducing `allowHalfdayReuse`, the dedup behaviour silently became a counting bug: every multi-room or multi-session halfday undercounts. The cost-function hard cap (line ≈1466) and per-class fairness from `proctor-v2-strict-fairness-coverage` operate on `getPrimaryLoad`, which transitively reads `guardCount`, so they bound the wrong axis. The fix is mechanical at one site (`addGuardLoad`) and propagates automatically through every consumer because the read path is unchanged.

**Why the reserve policy.** `phase2_5PopulateReserves` (line ≈2368) builds candidate lists with the sort key `(finalLoad ASC, rng ASC)`. That key has two omissions. First, it has no notion of `reserveCount` priority — a candidate already holding a reserve can be picked ahead of a peer at zero whenever their `finalLoad` is marginally lower (e.g. lower `dutyCount`). The user's spread requirement is therefore not enforceable through the existing key. Second, the key has no notion of "guarded the first session of the same halfday" — affinity is invisible to the sort. Both must enter the sort key with strict precedence: spread (`reserveCount ASC`) above affinity (`affinityRank ASC`), affinity above balance (`finalLoad ASC`), balance above the existing random tiebreak. The fall-through across rings (`reserveCount = 0` → `1` → `2` …) is implicit in the lex order and needs no explicit ring loop.

## Correctness Properties

Property 1: Bug Condition — Slot metric consistency

_For any_ input where the bug condition holds (`isBugCondition` returns true via C1) and `T` is an eligible proctor in the post-fix output `X'`, the fixed algorithm SHALL produce `loadState(T).guardCount = Σ over rows R: |{ i : R.proctor_keys[i] = T.key }|`, AND `getPrimaryLoad(loadState, T.key) = guardSlotCount(T) + dutyCount(T)`.

**Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.7**

Property 2: Bug Condition — Reserve spread

_For any_ input where the bug condition holds (via C2) and two reserve-eligible proctors `T1`, `T2` exist with `reserveCount(T1) − reserveCount(T2) > 1` and `reserveCount(T2) = 0`, the fixed algorithm SHALL produce an output where no session `S` exists for which `T2` was reserve-eligible AND had unfilled reserve capacity at the time `phase2_5PopulateReserves` processed `S`.

**Validates: Requirements 1.4, 2.4, 2.6**

Property 3: Bug Condition — Reserve affinity

_For any_ input where the bug condition holds (via C3) and a halfday `H` contains a first session `S1` and a second session `S2` with at least one reserve slot filled in `S2`, the fixed algorithm SHALL pick the chosen reserve from the subset `{ C : C reserve-eligible for S2 ∧ C guarded at least one slot of S1 ∧ reserveCount(C) at choice = min over reserve-eligible candidates of reserveCount }` whenever that subset is non-empty.

**Validates: Requirements 1.5, 2.4, 2.5**

Property 4: Preservation — No regression on prior invariants

_For any_ input where the bug condition does NOT hold (`isBugCondition` returns false), the fixed function SHALL produce the same result as the original function on every preserved dimension: hard-constraint filtering, supervisors-per-room exactness, reserves contract from prior specs, halfday/day reuse flags, M/E preference as a soft constraint, row schema, `dutyData` semantics, per-class fairness on the new metric, full coverage on the new metric, `D_expected` plumbing, and v1 byte-identical to pre-fix v1.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11**

## Fix Implementation

### Architecture overview

Six edit sites in `js/algorithms/proctor-distribution-v2.js`. Approximate line numbers anchored to the current file. Three of the six are documentation-only (the metric switch propagates automatically through reads).

| # | File | Function / Component | Property | Nature of change |
|---|------|----------------------|----------|------------------|
| 1 | `js/algorithms/proctor-distribution-v2.js` | `addGuardLoad` (≈line 283) | C1, P1 | Increment `guardCount` on every call (slot-based). `guardHalfdays` Set retained for reuse-rule semantics only. |
| 2 | `js/algorithms/proctor-distribution-v2.js` | `getPrimaryLoad` / `getFinalLoad` (≈line 359 / 370) | P1 | Read-path unchanged; semantically becomes slot-based because their input `guardCount` switches. Documented in a comment block. |
| 3 | `js/algorithms/proctor-distribution-v2.js` | `costFunction` hard cap (≈line 1466) | P1, P4 | No source change. The cap automatically binds the new metric because `getPrimaryLoad` switches; documented in a comment. |
| 4 | `js/algorithms/proctor-distribution-v2.js` | new `computeAffinityRank(candidateKey, sessionKey, halfdayKey, sessionsBySessionKey)` | C3, P3 | New helper that returns `0` if candidate guarded the previous session of the same halfday (and current is second-of-halfday), else `1`. |
| 5 | `js/algorithms/proctor-distribution-v2.js` | `phase2_5PopulateReserves` (≈line 2368) candidate sort | C2, C3, P2, P3 | Replace `(finalLoad, rng)` sort with `(reserveCount ASC, affinityRank ASC, finalLoad ASC, rng ASC)`. |
| 6 | `js/algorithms/proctor-distribution-v2.js` | `phase2_75CoverageRepair` peer eligibility (≈line 2759) | P1, P4 | No source change — the peer-eligibility test reads `getPrimaryLoad`, which is now slot-based. The three-tier relaxation strategy (`>= classUB+1`, `>= classUB`, `>= classLB+1`) is preserved. Documented. |


### 1. `addGuardLoad` slot-based (≈line 283)

**Inputs**
- `loadState: Object` — the v2 load-state object indexed by proctor key.
- `proctorKey: string` — the canonical exemption key for the proctor.
- `halfdayKey: string` — the halfday this slot belongs to (`'<date>|morning'` or `'<date>|afternoon'`).
- `teacherName: string?` — the human-readable name; only stored on first call when entry has no name yet.

**Outputs**
- `boolean` — kept for ABI compatibility (existing callers ignore the value). Returns `true` whenever the function actually incremented (i.e. on every non-empty call). Returns `false` only on the early `(!proctorKey || !halfdayKey)` guard.
- Side effect: mutates `entry.guardCount`, `entry.guardHalfdays`, `entry.morningCount`, `entry.afternoonCount`, `entry.teacherName`.

**Pseudocode**

```
FUNCTION addGuardLoad(loadState, proctorKey, halfdayKey, teacherName)
  IF NOT proctorKey OR NOT halfdayKey THEN RETURN false
  entry ← getTeacherLoad(loadState, proctorKey)
  IF teacherName AND NOT entry.teacherName THEN entry.teacherName ← teacherName

  // --- Slot-based: increment on EVERY call. ---
  // Prior behaviour gated this on `guardHalfdays.size` change; that was a
  // halfday-deduplicating count and is the source of the C1 bug.
  entry.guardCount ← entry.guardCount + 1

  // --- Halfday-tracking Set retained for halfday-reuse rule semantics. ---
  // `guardHalfdays.has(halfdayKey)` is read by filterAvailableProctors
  // (≈line 1582) and the reserves-pass halfday-reuse check (≈line 2521).
  // Set membership is still accurate (idempotent add).
  entry.guardHalfdays.add(halfdayKey)

  // --- M/E counters: increment on every call too, matching slot semantics. ---
  IF isMorningHalfday(halfdayKey) THEN
    entry.morningCount ← entry.morningCount + 1
  ELSE
    entry.afternoonCount ← entry.afternoonCount + 1
  END IF

  RETURN true
END FUNCTION
```

**Edge cases**

| Case | Behaviour |
|------|-----------|
| Same `(proctorKey, halfdayKey)` called N times | `guardCount += N`. `guardHalfdays.size` unchanged after the first call. M/E counters increment N times. |
| Reuse-rule consumer reads `guardHalfdays.has(halfdayKey)` | Still accurate — Set semantics preserved. The halfday-reuse rule (`!allowHalfdayReuse` ⇒ reject already-used halfday) keeps its prior meaning. |
| Empty / falsy `halfdayKey` (synthetic test fixture) | Early guard returns `false`. Increment unreachable. No risk of inflating `guardCount` on degenerate inputs. |
| `morningCount` / `afternoonCount` consumer | Now matches slot count, not halfday count. The `objectiveFunction` already aggregates `proctor_keys.length` for `morningEveningImbalance`, so the alignment improves the SA objective rather than degrading it. |
| Caller that previously relied on the boolean return to detect "first-of-halfday" | No such caller exists in the current codebase (the return value is read only by `phase2_75CoverageRepair`'s `applySwap`, which uses it as a void signal). Documented in the function's JSDoc. |

**Determinism notes:** pure function on inputs; no `rng` use. Same input sequence → same final state.

### 2. `getPrimaryLoad` / `getFinalLoad` no-op fix (≈line 359 / 370)

**Inputs / Outputs:** unchanged.

**Pseudocode (unchanged):**

```
FUNCTION getPrimaryLoad(loadState, proctorKey)
  entry ← getTeacherLoad(loadState, proctorKey)
  RETURN entry.guardCount + entry.dutyCount
END FUNCTION

FUNCTION getFinalLoad(loadState, proctorKey)
  entry ← getTeacherLoad(loadState, proctorKey)
  RETURN entry.guardCount + entry.reserveCount + entry.dutyCount
END FUNCTION
```

Add a JSDoc block above each, stating the post-fix semantics so future readers know the metric switched without a source change here:

```
// Post slot-metric switch (spec proctor-v2-slot-metric-reserves-affinity):
//   - getPrimaryLoad returns guardSlotCount + dutyCount.
//   - getFinalLoad   returns guardSlotCount + reserveCount + dutyCount.
// Both consume `entry.guardCount`, which is now slot-based — see addGuardLoad.
// No signature change. All consumers (costFunction hard cap, per-class fairness
// invariant, phase2_75CoverageRepair peer eligibility, objectiveFunction,
// orchestrator diagnostics) inherit the slot semantics automatically.
```

**Edge cases:** none specific to this site — the function bodies are untouched.

**Determinism notes:** pure read; no `rng` use.

### 3. `costFunction` hard cap consumer note (≈line 1466)

**Inputs / Outputs:** unchanged.

**Source change:** none. The existing cap

```
IF options AND options.classBoundsByProctorKey AND NOT options.skipClassCap THEN
  classBounds ← options.classBoundsByProctorKey[proctorKey]
  IF classBounds THEN
    postAssignmentPrimary ← getPrimaryLoad(loadState, proctorKey) + 1
    IF postAssignmentPrimary > classBounds.classUpperBound THEN
      RETURN INFINITY_SENTINEL
    END IF
  END IF
END IF
```

is preserved verbatim. The metric switch in §1 makes `getPrimaryLoad` slot-based, so `postAssignmentPrimary` is now the slot count after the candidate placement. The `INFINITY_SENTINEL` short-circuit therefore bounds slot-level work, matching user intent (Requirement 2.7).

Add a comment block above the cap to document the spec link:

```
// Post slot-metric switch (spec proctor-v2-slot-metric-reserves-affinity):
// `getPrimaryLoad` returns slot-based primaryLoad. The per-class hard cap
// therefore bounds slot-level work (the user's intended fairness axis), not
// halfday-deduplicated work as before. No source change here — the switch
// propagates through the read path.
```

**Edge cases:** unchanged from the prior spec — cap inactive when `classBoundsByProctorKey` is absent (older callers, fixtures), cap inactive when `skipClassCap = true` (last-resort unconstrained-pass fallback).

**Determinism notes:** unchanged.

### 4. `computeAffinityRank` helper (new, co-located with `phase2_5PopulateReserves`)

**Inputs**
- `candidateKey: string` — proctor key under evaluation.
- `sessionKey: string` — the session currently being filled with reserves.
- `halfdayKey: string` — the halfday containing `sessionKey`.
- `sessionsBySessionKey: Object<string, Row[]>` — already built by `phase2_5PopulateReserves` (≈line 2375). Maps `sessionKey` → array of rows belonging to that session.

**Output**
- `number ∈ {0, 1}` — `0` = preferred (candidate guarded the previous session of the same halfday and current is second-of-halfday); `1` = default (affinity inapplicable).

**Pseudocode**

```
FUNCTION computeAffinityRank(candidateKey, sessionKey, halfdayKey, sessionsBySessionKey)
  // Step 1: enumerate sessions in this halfday, sorted by start time then sessionKey ASC.
  halfdaySessions ← collectSessionsInHalfday(halfdayKey, sessionsBySessionKey)

  // Step 2: affinity inapplicable if halfday holds < 2 sessions.
  IF |halfdaySessions| < 2 THEN RETURN 1

  // Step 3: affinity inapplicable if `sessionKey` is not the second session.
  // The user-confirmed bound of ≤ 2 sessions per halfday means
  // halfdaySessions[1] is the second; if sessionKey ≠ halfdaySessions[1].sessionKey
  // then sessionKey is the first (or, defensively, a non-second later session).
  IF sessionKey ≠ halfdaySessions[1].sessionKey THEN RETURN 1

  // Step 4: check if candidate guarded the first session.
  firstSessionKey ← halfdaySessions[0].sessionKey
  firstSessionRows ← sessionsBySessionKey[firstSessionKey]
  IF NOT firstSessionRows THEN
    // Defensive: data corruption — first session not in the map. Log warning, fall back to 1.
    log_warning('computeAffinityRank: missing first-session rows for halfday ' + halfdayKey)
    RETURN 1
  END IF

  FOR row IN firstSessionRows DO
    FOR k IN row.proctor_keys DO
      IF k AND k = candidateKey THEN RETURN 0
    END FOR
  END FOR

  RETURN 1
END FUNCTION


FUNCTION collectSessionsInHalfday(halfdayKey, sessionsBySessionKey)
  // Returns an array of { sessionKey, startTime } sorted by (startTime ASC, sessionKey ASC).
  // sessionKey already encodes session ordering in the data
  // (e.g. 'الحصة الأولى' < 'الحصة الثانية' lexicographically when paired with date).
  result ← []
  FOR (sk, rows) IN sessionsBySessionKey DO
    IF NOT rows OR |rows| = 0 THEN CONTINUE
    rowHalfday ← rows[0].halfday_key
    IF rowHalfday = halfdayKey THEN
      startTime ← rows[0].time_from OR sk
      result.push({ sessionKey: sk, startTime: startTime })
    END IF
  END FOR
  result.sort BY (startTime ASC, sessionKey ASC)
  RETURN result
END FUNCTION
```

**Edge cases**

| Case | Behaviour |
|------|-----------|
| Halfday holds only 1 session | `|halfdaySessions| < 2` → return `1` for everyone. Sort collapses to `(reserveCount, finalLoad, rng)`. |
| Halfday holds 2 sessions, `sessionKey` is the first | `sessionKey ≠ halfdaySessions[1].sessionKey` → return `1` for everyone. Affinity inapplicable; nothing in the past to anchor on. |
| Halfday holds 2 sessions, `sessionKey` is the second, candidate appears in `S1` | Return `0`. The candidate is preferred. |
| Halfday holds 2 sessions, `sessionKey` is the second, candidate not in `S1` | Return `1`. Candidate falls behind first-session guards in the sort. |
| Halfday holds > 2 sessions (data anomaly; user-confirmed bound is 2) | Only the second session in start-time order receives affinity. Sessions 3, 4, … are treated like first sessions (return `1` for everyone). Documented as a data-anomaly tolerance — the algorithm degrades gracefully. |
| `sessionsBySessionKey` missing the first session's row entry (data corruption) | Defensive `IF NOT firstSessionRows THEN log warning, return 1`. Run continues. |
| Candidate appears in `proctor_keys` with a falsy/empty value (`''`, `null`) | The `IF k AND k = candidateKey` guard rejects falsy entries; not counted. |
| `halfdayKey` empty / falsy | `collectSessionsInHalfday` returns `[]`; `|halfdaySessions| < 2` → return `1`. |

**Determinism notes:** pure given the inputs and a stable session ordering. `result.sort` uses a total order (`startTime` ASC then `sessionKey` ASC). No `rng` use here — the affinity rank is a deterministic function of the candidate and the session map.

### 5. `phase2_5PopulateReserves` candidate sort change (≈line 2368)

**Inputs / Outputs:** unchanged at the function signature.

**Pseudocode (only the candidate-build + sort sections; the rest of the function — session iteration, `target` computation, `sharedReserves` / `sharedReserveKeys` build, `addReserveLoad` update loop, shortage notes — is preserved verbatim):**

```
// Existing candidate-build loop (after exemption / duty / halfday-reuse / sessionGuardSet filters):
FOR each eligible proctor T (key, proc, idx):
  reserveCount ← (loadStateForReserves[key] AND loadStateForReserves[key].reserveCount) OR 0
  affinityRank ← computeAffinityRank(key, currentSessionKey, halfdayKey, sessionsBySessionKey)
  finalLoad    ← getFinalLoad(loadStateForReserves, key)
  candidates.push({
    key:          key,
    proc:         proc,
    idx:          idx,
    reserveCount: reserveCount,    // NEW — primary spread key
    affinityRank: affinityRank,    // NEW — secondary affinity key
    finalLoad:    finalLoad,       // existing — tertiary balance key
    tiebreak:     rng()            // existing — quaternary random tiebreak
  })
END FOR

// New sort key: spread > affinity > balance > tiebreak.
// Lex ordering — fall-through across rings is implicit (no explicit ring loop needed).
candidates.sort BY (a, b) →
  IF a.reserveCount ≠ b.reserveCount THEN RETURN a.reserveCount − b.reserveCount   // spread
  IF a.affinityRank ≠ b.affinityRank THEN RETURN a.affinityRank − b.affinityRank   // affinity (0 < 1)
  IF a.finalLoad    ≠ b.finalLoad    THEN RETURN a.finalLoad    − b.finalLoad      // balance
  RETURN a.tiebreak − b.tiebreak                                                   // rng

// Existing slice + apply (unchanged):
sliceCount ← min(target, |candidates|)
chosen     ← candidates.slice(0, sliceCount)
// … sharedReserves / sharedReserveKeys build, row assignment, addReserveLoad loop,
// shortage handling — all preserved verbatim from the prior implementation.
```

**Edge cases**

| Case | Behaviour |
|------|-----------|
| `target = 0` (percent mode rounded to zero, or fixed mode = 0) | The existing zero-short-circuit fires before candidate build; sort never runs. `percentRoundedToZero` diagnostic still increments. |
| Two candidates tie on all four keys | Impossible. `tiebreak = rng()` returns a real-valued sample with vanishing collision probability under any seeded PRNG. |
| Single-session halfday | Every candidate has `affinityRank = 1`. Sort collapses to `(reserveCount ASC, finalLoad ASC, rng ASC)` — identical to the prior behaviour plus the spread tier. |
| First session of a 2-session halfday | Same as single-session for ranking purposes — `affinityRank = 1` everywhere because `sessionKey ≠ halfdaySessions[1].sessionKey`. |
| Second session of a 2-session halfday, no first-session guard is reserve-eligible | Every eligible candidate has `affinityRank = 1`. Sort collapses to `(reserveCount, finalLoad, rng)`. Affinity rule dormant. |
| All eligible candidates already at `reserveCount = 1` while target > 0 | Sort still picks them in `(affinityRank, finalLoad, rng)` order. The spread tier yields zero discrimination at this point — that's correct: the run has saturated the first ring and continues into the second, exactly as the user described ("the spread limit is exhausted, additional reserves fall back to the next ring"). |
| `eligibleAvailable < target` | Existing shortage handling: append the v1-style note `'خصاص N احتياطي للحصة'` to `firstRow.notes`. Unchanged. |
| Candidate is a guard of `S1` AND already at `reserveCount = 1` | Sort key: `(1, 0, finalLoad, rng)`. They lose the first ring to a `(0, 1, finalLoad, rng)` peer — spread dominates affinity. Matches user intent. |

**Determinism notes:** `rng()` is the seeded PRNG passed from the orchestrator; same `randomSeed` reproduces the same reserve choices. The new sort introduces no additional `rng` calls per candidate (the snapshot is taken at candidate-build time exactly as before). `computeAffinityRank` is deterministic given the inputs, so the entire sort is reproducible.

### 6. `phase2_75CoverageRepair` peer eligibility (≈line 2759) — no source change

**Source change:** none. The repair pass's peer-eligibility filter inside `buildSwapCandidates` (≈line 2867) reads `getPrimaryLoad(loadState, T_over_key)` and compares against the relaxation threshold (`classUB + 1`, `classUB`, or `classLB + 1`). The metric switch in §1 makes those reads slot-based, so the swap-eligibility decision binds the new metric automatically. The three-tier relaxation strategy from `proctor-v2-strict-fairness-coverage` is preserved exactly (Requirement 3.9).

Add a comment block above `buildSwapCandidates`:

```
// Post slot-metric switch (spec proctor-v2-slot-metric-reserves-affinity):
// `getPrimaryLoad` is slot-based. The relaxation thresholds (classUB+1,
// classUB, classLB+1) bind the new metric automatically — no source change.
// Three-tier strategy unchanged: hard ring (>= classUB+1), soft ring (>= classUB),
// and the third-tier safety net (>= classLB+1) introduced by the prior spec.
```

**Edge cases:** unchanged from the prior spec. The post-swap arithmetic argued in §3.4 of `proctor-v2-strict-fairness-coverage/design.md` (i.e. `T_over` does not drop below `classLB`) holds verbatim on the slot metric because both bounds and `primaryLoad` shifted to the same axis.

**Determinism notes:** unchanged.


## Data Contract Changes

### Input shape — unchanged

`input.D_expected`, `input.reservesConfig`, `input.options.allowHalfdayReuse` / `allowDayReuse`, `input.dutyData`, `input.proctorsList`, `input.scheduleEntries`, `input.examDistributionRules` all keep their prior shape and meaning. No new input fields. The UI plumbing for `D_expected` remains as the prior spec shipped it (Requirement 3.5).

### Output shape — unchanged

Each row keeps every existing field. `proctor_keys`, `proctors`, `reserves`, `reserve_keys`, `notes`, `session_key`, `halfday_key`, etc. are byte-identical in shape and meaning. The `reserves[]` / `reserve_keys[]` shared-reference invariant (rows of one session share the same array references) is preserved by the sort change — the new sort runs on the candidate list before the shared arrays are constructed (Requirement 3.7).

### `loadState` semantics — slot-based

`loadState[T].guardCount` semantically becomes slot-based. Type unchanged (`number`). The Set `loadState[T].guardHalfdays` is retained for halfday-reuse rule semantics (Requirement 2.2). The counters `morningCount` / `afternoonCount` become slot-based too, matching the new fairness axis. `dutyCount`, `dutyHalfdays`, `reserveCount`, `reserveHalfdays`, `teacherName` are unchanged (`addDutyLoad` and `addReserveLoad` are not touched — Requirements 3.1, 3.2).

### Diagnostics — no new fields required

Per Requirement 3.11, this fix does not introduce new diagnostic fields. Existing fields keep their names and remain semantically valid; their numeric values shift because they reflect the new metric:

| Field | Pre-fix meaning | Post-fix meaning |
|-------|------------------|--------------------|
| `loadBalance.std`, `loadBalance.min`, `loadBalance.max` | Halfday-deduplicated load distribution | Slot-based load distribution |
| `coverageRepairSwaps`, `coverageRepairUnresolved` | Count of repair swaps / unresolved teachers | Unchanged semantically; computed on the new metric |
| `maxPrimaryLoadGapWithinClass` | Max gap on halfday-deduplicated load | Max gap on slot-based load (the user's intended axis) |
| `eligibilityClassCount` | Class count from `computeEligibilityClasses` | Unchanged |
| `phase2_5DurationMs`, `sessionsProcessed`, `totalReservesPlaced`, `sessionsWithShortage`, `percentRoundedToZero` | Reserves-pass diagnostics | Unchanged |
| `warnings[]` | Existing warning channel | Unchanged; `'d_expected_divergence'` from the prior spec still fires on the same trigger |

## Migration / Backward Compatibility

- **Pre-fix snapshot from prior spec.** The file `tests/__snapshots__/proctor-v2-strict-fairness-coverage.pre-fix.js` is owned by `proctor-v2-strict-fairness-coverage` and is **never modified** (Requirement 3.10). Tests in that spec assert on the pre-fix halfday-based `guardCount` values; they continue to pass against the frozen module. The current spec MUST NOT touch this file.
- **v1 byte-equality.** The v1 path (`runAutoDistribution` in `js/algorithms/proctor-distribution-v1.js`) is untouched. Property P4 reasserts byte-equality against the existing v1 snapshot. The metric switch lives entirely inside v2's `loadState` bookkeeping path (Requirement 3.8).
- **Existing v2 unit / integration tests.** Tests that asserted `loadState[T].guardCount === expectedHalfdayCount` will break post-fix because the value is now slot-based. The fix's own test suite (Phase H of `tasks.md`) updates those tests in-place; pre-fix snapshot tests from the prior spec are isolated via the frozen `pre-fix.js` module and remain green.
- **Saved auto-distribution blobs.** Output rows (`proctor_keys[]`, `reserves[]`, `reserve_keys[]`, `notes`) are unchanged in shape and meaning. Diagnostics blob fields are unchanged in shape; only their numeric values shift (see the table in §"Data Contract Changes"). Pre-fix saves still load and render correctly.
- **`enablePhase3 = false` runs.** The slot-metric switch and the reserve-policy change are both independent of Phase 3 SA. Phase 1 → Phase 2 → Phase 2.5 → Phase 2.75 alone produces a valid output that satisfies P1–P4. Phase 3, when enabled, sees the already-corrected roster and only steers tie-breaking — it cannot undo the spread or affinity decisions because the reserve policy is enforced inside Phase 2.5, not as a Phase 3 cost term.
- **Legacy fixtures (single-session halfdays, no `D_expected`).** `D_expected = 0` collapses bounds to guards-only, exactly as the prior spec defined. `affinityRank = 1` everywhere (single session per halfday) collapses the new sort to `(reserveCount, finalLoad, rng)` — equivalent to the prior behaviour **plus** the spread tier. Preservation property P4 holds for all such inputs because either the spread tier never discriminates (everyone at the same `reserveCount`) or it correctly enforces a property that the prior key did not (and that the legacy fixtures were trivially satisfying).
- **`exams-proctors.html` UI layer.** Untouched. `D_expected` plumbing stays as `proctor-v2-strict-fairness-coverage` shipped it. No new inputs, no new toggles.

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Existing v2 unit tests break on the metric switch | High | Medium | Update assertions in this spec's Phase H tasks (`tasks.md`); isolate pre-fix snapshot tests via the prior spec's frozen `pre-fix.js` module. The metric change is intentional and audited by the same Phase H suite. |
| Per-class `classUpperBound` becomes too tight under the slot metric | Medium | Medium | Bounds were already computed from `D_expected` and `G = Σ |proctor_keys|` (slot-based numerator) in `proctor-v2-strict-fairness-coverage` — see `computeClassBounds`. The new `guardSlotCount` matches the same axis, so bounds remain consistent. The user's verified scenario (`G=368, D=15, N=147, classUB=3`) is preserved. |
| `computeAffinityRank` cost on large centres | Low | Low | Called once per `(candidate × second-of-halfday session)`. The inner loop `FOR row IN firstSessionRows DO FOR k IN row.proctor_keys` is bounded by `rooms × proctorsPerRoom` per session (≈ 8–16 in practice). Total cost: `O(|candidates| × roomsPerSession)` per second-of-halfday session — negligible vs. the existing Hungarian step. |
| Affinity rank breaks ties unfairly when both candidates are at `reserveCount = 0` but neither guarded the previous session | Low | Low | Both get `affinityRank = 1`; the existing `(finalLoad, rng)` tiebreak applies. Outcome identical to the prior key in this case. |
| Halfday with > 2 sessions (data anomaly; user-confirmed bound is 2) | Very low | Low | `computeAffinityRank` defines "first" as earliest-by-startTime, "second" as next. Sessions ≥ 3 receive `affinityRank = 1` (no affinity). Documented in the helper's edge-case table. |
| Phase 2.75 coverage repair pushes a peer below `classLowerBound` after the metric switch | Low | Medium | The prior spec's three-tier relaxation strategy already bounds the post-swap peer load (`>= classLB+1` lower threshold). The bound argument is metric-agnostic and remains valid on the slot metric. |
| `addGuardLoad` callers passing a synthetic empty `halfdayKey` accidentally inflate `guardCount` | Very low | Low | The early `IF NOT proctorKey OR NOT halfdayKey THEN RETURN false` guard is preserved; the increment is unreachable for empty `halfdayKey`. |
| Spread tier picks a low-`reserveCount` candidate whose affinity is wrong, missing an opportunity for proximity | By design | Low | The user explicitly chose spread > affinity. The spread tier is the user's primary requirement; affinity is a comfort optimisation. The integration test "Affinity end-to-end" guards against the case where spread does not discriminate (all candidates at `reserveCount = 0`) and confirms affinity then takes over. |
| `objectiveFunction` SA score shifts because `morningCount` / `afternoonCount` are now slot-based | Low | Low | The objective improves rather than degrades — `morningEveningImbalance` was already aggregating `proctor_keys.length` per row (slot-based), and the shift aligns the load-state counters with that aggregation. SA convergence behaviour is unaffected because the function is monotone in the same direction. |

## Testing Strategy

### Validation Approach

Two phases. First, surface counterexamples on the **unfixed** code that demonstrate C1, C2, and C3 — confirming the root-cause analysis. If any exploratory test passes on F (no counterexample), the analysis is wrong and we re-hypothesize. Second, run the property suite against F' to verify P1–P4 and the preservation invariants.

### Exploratory Bug Condition Checking

**Goal:** demonstrate C1, C2, and C3 on the unfixed code.

**Test plan:** small fixture inputs (≤ 30 proctors, ≤ 6 sessions), assertions stated as Property checks. Run on F (current `js/algorithms/proctor-distribution-v2.js`) before this fix lands. Each test must FAIL on F.

| # | Name | Trigger | Expected failure on F |
|---|------|---------|------------------------|
| 1 | C1 — two-room single-session | One session, two rooms, `proctorsPerRoom = 2`, force one proctor `T` into both rooms via tight eligibility | F reports `loadState[T].guardCount = 1`; actual `Σ |proctor_keys|` for `T` is `2` → P1 fails |
| 2 | C1 — two-session halfday | One halfday with `S1` + `S2`, force `T` into both | F reports `guardCount = 1`; expected `2` → P1 fails |
| 3 | C2 — spread violation | 5 sessions, `reservesPerSession = 2`, 10 reserve-eligible proctors with mild `finalLoad` differences | F's sort picks the same handful; one proctor reaches `reserveCount = 2` while another stays at `0` for an under-filled session → P2 fails |
| 4 | C3 — affinity violation | 2-session halfday; `S2` needs 1 reserve; one first-session guard at `reserveCount = 0`; one external candidate at `reserveCount = 0` with marginally lower `finalLoad` | F picks the external candidate → P3 fails |
| 5 | Aggregation cross-check | The user's centre fixture (147 proctors, 368 slots, `D_expected = 15`) | `max(loadState.guardCount) > 3` on F (verified at 5 in the user's run); → P1 + per-class fairness fail |

**Expected counterexamples:** the failures pinpoint the four fix surfaces — `addGuardLoad` (tests 1, 2, 5), `phase2_5PopulateReserves` candidate sort (tests 3, 4). If any test passes on F, re-examine: e.g. if test 1 passes, the slot collision may have been masked by an earlier hard constraint we missed; if test 4 passes, the existing `(finalLoad, rng)` key may already discriminate by accident on the chosen seed and we re-pick the seed.

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

**Goal:** for every input where `¬C(X)`, F' equals F on every dimension that is not slot-vs-halfday `loadState` redistribution. Property-based testing is the right tool because preservation is a universal claim across the input space.

```
FOR ALL input WHERE NOT isBugCondition(F(input)) DO
  ASSERT proctor_keys(F(input))             = proctor_keys(F'(input))
  ASSERT loadState.dutyCount(F(input))      = loadState.dutyCount(F'(input))
  ASSERT loadState.reserveCount(F(input))   = loadState.reserveCount(F'(input))
  ASSERT row.reserves(F(input))             = row.reserves(F'(input))
  ASSERT softViolations(F(input))           = softViolations(F'(input))
  // loadState.guardCount intentionally NOT compared — it switched axis;
  // the equivalent observable is `Σ over rows: |{ i : R.proctor_keys[i] = T.key }|`,
  // which is asserted equal across F and F' on these inputs.
END FOR
```

**Test plan:** generate random `(proctorsList, scheduleEntries, exemptionsData, dutyData, reservesConfig, D_expected)` inputs with a seeded PRNG. Run F (snapshot of pre-fix v2 frozen as a module under `tests/__snapshots__/proctor-v2-strict-fairness-coverage.pre-fix.js`) and F' on the same input, compare row-by-row.

### Unit Tests

- `addGuardLoad` — same `(key, halfdayKey)` called 3 times → `guardCount = 3`, `guardHalfdays.size = 1`, `morningCount` (or `afternoonCount`) = 3.
- `addGuardLoad` — empty `halfdayKey` → returns `false`, no mutation.
- `getPrimaryLoad` / `getFinalLoad` — return `entry.guardCount + entry.dutyCount` and `entry.guardCount + entry.reserveCount + entry.dutyCount` respectively; assert equal to slot count derived from `proctor_keys` aggregation.
- `computeAffinityRank` — single-session halfday → returns `1` for everyone (3 candidates).
- `computeAffinityRank` — first session of a 2-session halfday → returns `1` for everyone.
- `computeAffinityRank` — second session of a 2-session halfday, candidate present in `S1` → returns `0`.
- `computeAffinityRank` — second session of a 2-session halfday, candidate not in `S1` → returns `1`.
- `computeAffinityRank` — defensive: missing `firstSessionRows` → returns `1` (warning logged).
- `phase2_5PopulateReserves` candidate sort — hand-pick 4 candidates with distinct `(reserveCount, affinityRank, finalLoad, tiebreak)` permutations → assert sorted order matches the lex key.
- `phase2_5PopulateReserves` candidate sort — all 4 candidates tie on `reserveCount` and `affinityRank` → assert sort collapses to `(finalLoad, rng)` (regression check on prior behaviour).
- `phase2_5PopulateReserves` shared-reference invariant — every row of one session shares the same `reserves` / `reserve_keys` array reference after the new sort (Requirement 3.7).
- `phase2_75CoverageRepair` peer-eligibility filter — peer at slot-based `primaryLoad ≥ classUB + 1` selected; peer at `classUB` selected only in the soft step (regression check that the metric switch did not change selection ordering when the value happens to coincide).

### Property-Based Tests (seeded PRNG)

- **P1 — slot consistency.** Generator: random valid input. Assertion: `loadState[T].guardCount` exactly equals `Σ over rows R: |{ i : R.proctor_keys[i] = T.key }|` for every proctor `T` in the run. Equivalently: `getPrimaryLoad = guardSlotCount + dutyCount` for every `T`.
- **P2 — spread invariant.** Generator: random `(reserveCount, finalLoad)` permutations across 5–20 candidates and 1–10 sessions with reserves. Assertion: no two reserve-eligible proctors `T1`, `T2` violate `(reserveCount(T1) − reserveCount(T2) > 1) ∧ (reserveCount(T2) = 0) ∧ (∃ session S where T2 was reserve-eligible with unfilled capacity)`.
- **P3 — affinity invariant.** Generator: 2-session halfday fixtures with reserve-eligible first-session guard sets of varying sizes. Assertion: for every reserve filled in `S2`, the chosen candidate is in `firstGuards(S1)` whenever that subset (intersected with min-`reserveCount` candidates for `S2`) is non-empty.
- **P4 — preservation.** Generator: random valid inputs. Assertions: per-class fairness on the new metric (`|primaryLoad(T1) − primaryLoad(T2)| ≤ 1` inside class), full coverage (`primaryLoad(T) ≥ 1` for every eligible `T`), v1 byte-identical (snapshot from `proctor-v2-strict-fairness-coverage` frozen module), `dutyCount` / `reserveCount` agree between F and F' for `¬C(X)` inputs.
- **Determinism.** Same input + same `randomSeed` → identical `proctor_keys`, `reserves`, `reserve_keys`, `loadState` state across two F' runs.

### Integration Tests

- **The user's case.** `(147 proctors, 368 slots, D_expected = 15)` → assert `max(primaryLoad) ≤ 3`, `min(primaryLoad) ≥ 2`, `max(reserveCount) − min(reserveCount) ≤ 1` over the reserve-eligible frontier, `coverageRepairUnresolved = 0`, `maxPrimaryLoadGapWithinClass ≤ 1`.
- **Affinity end-to-end.** 2-session halfday, `reservesPerSession = 2`, at least 2 first-session guards reserve-eligible at `reserveCount = 0`, at least 2 external candidates also at `reserveCount = 0`. Assert both reserves of `S2` come from the first-session guard set.
- **Spread end-to-end.** 5-session run with `reservesPerSession = 2` and a pool of 10 reserve-eligible proctors. Assert that across the run, `max(reserveCount) − min(reserveCount) ≤ 1` until the first ring is exhausted (every eligible proctor at `reserveCount ≥ 1`), then ≤ 1 inside the second ring as well.
- **Backward compatibility.** Legacy fixture without `D_expected` (defaults to `0`) and with single-session halfdays. Slot-metric switch applies; spread / affinity sort collapses to `(reserveCount, finalLoad, rng)` — equivalent to legacy behaviour plus the spread tier. Assert F' output equals F output on every preserved dimension.
- **v1 byte-equality.** Switch the algorithm toggle to v1, run on the same fixtures, assert byte-identical output to the existing pre-fix v1 snapshot.
- **Pre-fix snapshot integrity.** Meta-test: read `tests/__snapshots__/proctor-v2-strict-fairness-coverage.pre-fix.js` mtime / hash before and after the test suite runs. Assert unchanged.
- **Shared-reference invariant.** For every multi-row session in a representative fixture, assert `row[i].reserves === row[j].reserves` and `row[i].reserve_keys === row[j].reserve_keys` after F'.
