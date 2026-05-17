# Proctor v2 — Phase 2 Timeout & Greedy Cap Bugfix Design

## Overview

The three preceding bugfixes (`proctor-v2-fairness-duty-reserves`,
`proctor-v2-strict-fairness-coverage`, `proctor-v2-slot-metric-reserves-affinity`)
landed the per-class hard cap inside `costFunction`, the `phase2_75CoverageRepair`
pass, and the slot-metric reserve sort. Re-running §0.2 verification on the user's
reference centre (147 proctors, 8 halfdays, 92 sessions, `G = 368`,
`D_expected = 15`) revealed that `phase2Build` is now starved by its own clock:
`phase2DurationMs = 1635 ms` against a hard-coded `TIMEOUT_MS = 1500 ms`, the
loop breaks 140 ms short, only 96/368 slots get filled, and `phase2_75CoverageRepair`
has nowhere to swap from because no peer is yet over-loaded — the cap fires
correctly but on too few placements.

The orchestrator's "did Phase 2 time out?" check then mis-fires for an unrelated
reason: it compares `phase2DurationMs >= 1500` to a magic constant rather than
reading a boolean field set inside `phase2Build` at the actual break point. Once
the constant becomes configurable, that comparison breaks (timeout = 10 000 ms
with a 2 000 ms run would still raise the warning).

Finally, requirement 2.4 of `bugfix.md` mandates that `greedyFallback` MUST leave
a slot empty when every candidate scores `INFINITY_SENTINEL`. The current
implementation already enforces this via `if (bestProctor !== null && bestCost < INFINITY_SENTINEL)`
(line ≈1620, comment `// Defect 1 fix:`). This bugfix does not re-add the guard;
it pins the behaviour with regression tests so a later refactor cannot silently
weaken it back to `bestProctor !== null` alone.

The fix lives in **four edit sites inside one file** (`js/algorithms/proctor-distribution-v2.js`).
No public API change, no v1 change, no row-shape change, no UI change, no change to
prior specs' invariants. `phase2_75CoverageRepair` benefits transparently: with the
extended budget, Phase 2 fills more slots, Phase 2.75 finds more over-loaded peers,
`coverageRepairUnresolved` drops to 0 on the user's fixture.

## Glossary

- **Bug_Condition (C):** the disjunction `C1 ∨ C2` from `bugfix.md` — premature
  Phase 2 termination with incomplete coverage (C1) OR `greedyFallback` admitting
  an over-cap candidate (C2).
- **Property (P):** the four numbered claims P1 (timeout sufficiency on the
  reference fixture), P2 (hard cap inviolate via greedy), P3 (`phase2TimedOut`
  always boolean), P4 (preservation on small fixtures) from `bugfix.md`.
- **Preservation:** every behaviour described under §3 (Unchanged Behavior) of
  `bugfix.md`, plus byte-identical v1 output and pre-fix snapshot stability.
- **F:** v2 as it ships today (post the three preceding bugfixes). **F':** v2
  after this fix.
- **`TIMEOUT_MS`:** the local `var` inside `phase2Build` (line ≈1672). Currently
  hard-coded to `1500`; this fix promotes it to a configurable value with a new
  default of `5000`.
- **`DEFAULT_PHASE2_TIMEOUT_MS`:** new module-level constant, value `5000`.
- **`phase2TimedOut`:** new boolean diagnostic field returned by `phase2Build`.
  `true` iff the inner halfday loop broke on the timeout guard at line ≈1929;
  `false` if every halfday group was processed.
- **`phase2TimeoutMs`:** new numeric diagnostic field returned by `phase2Build`,
  echoing the resolved budget (override or default). Lets the orchestrator
  format the timeout warning without re-reading `input.options`.
- **`input.options.phase2TimeoutMs`:** new optional override on the v2 input
  contract. Numeric, must be `> 0` to take effect; otherwise the default applies.
- **`INFINITY_SENTINEL`:** existing v2 constant returned by `costFunction` to
  signal "this candidate violates a hard constraint". Already filtered out by
  `greedyFallback` at line ≈1620 (`bestCost < INFINITY_SENTINEL`).
- **`reference_fixture()`:** the user's recorded centre — 147 proctors, 8
  halfdays, 92 sessions, `G = 368`, `D_expected = 15`. Used as the canonical
  P1 / integration counterexample.

## Bug Details

### Bug Condition

```
FUNCTION isBugCondition(X)            // X = output of one F(input) run
  RETURN  C1(X) OR C2(X)
END FUNCTION
```

C1 — Phase 2 hits its hard-coded `TIMEOUT_MS = 1500` budget on a sized input
and exits with `filledSlotsCount(result) < expectedTotalSlots(X)`.

C2 — `greedyFallback` admits a candidate whose post-assignment `primaryLoad`
exceeds `classUpperBound`. (Already defended in F via the
`bestCost < INFINITY_SENTINEL` guard; this spec verifies the guard and pins it.)

The full Pascal-style spec is reproduced verbatim in `bugfix.md` §"Bug Conditions"
and is not duplicated here.

### Examples

- **C1 — reference centre.** 147 proctors / 8 halfdays / 92 sessions /
  `G = 368` / `D_expected = 15`. F: `phase2DurationMs = 1635`,
  `phase2TimedOut = true` (inferred from the heuristic),
  `coverageRepairUnresolved = 51`, `filled = 96 / 368` → P3 + Coverage FAIL.
  F': `phase2DurationMs ≈ 1700`, `phase2TimedOut = false`,
  `coverageRepairUnresolved = 0`, `filled = 368 / 368` → all green.
- **C1 — caller override.** Larger centre needs `phase2TimeoutMs = 10 000`.
  F: option ignored — `TIMEOUT_MS` is hard-coded. F': override honoured;
  `phase2Build` runs to completion or trips at 10 000 ms.
- **C2 — every candidate over cap.** Hungarian leaves a slot uncovered;
  `greedyFallback` runs on a candidate list where every `costFunction` returns
  `INFINITY_SENTINEL` (per-class hard cap fires for everyone). F: leaves slot
  empty (`shortages++`) — already correct. F': identical behaviour pinned by
  regression test.
- **P3 edge — happy-path small fixture.** 12 proctors / 4 halfdays / 6 sessions /
  `G = 18` / `D_expected = 0`. Phase 2 finishes in ~40 ms. F: returned
  diagnostics has no `phase2TimedOut` field (`undefined`). F':
  `phase2TimedOut = false`, `phase2TimeoutMs = 5000`, `typeof === 'boolean'`.
- **Orchestrator legacy heuristic.** Run with `phase2DurationMs = 1502 ms` on
  a small fixture (loop completed normally). F: heuristic raises a spurious
  "Phase 2 timeout exceeded (1500ms)" warning. F': reads
  `phase2Result.diagnostics.phase2TimedOut === false`, no warning emitted.

## Expected Behavior

### Preservation Requirements

**Unchanged behaviours (must remain byte-identical or semantically identical):**

- v1 byte-equality on every fixture (Requirement 3.1 of `bugfix.md`). v1 path
  (`runAutoDistribution`) is not touched by this fix.
- Pre-fix v2 snapshot for every input that completes Phase 2 inside its budget
  (Requirement 3.2). Default budget rises from 1500 to 5000 ms; for any small
  fixture the loop already finished well below 1500 ms, so the row outputs are
  unchanged.
- Hard cap inviolate across every code path: `phase1`, `phase2Build` (Hungarian),
  `phase2Build → greedyFallback`, `phase2_75CoverageRepair`. The C2 guard at
  line ≈1620 stays in place verbatim (Requirement 3.3).
- All three preceding specs' invariants — per-class reserves, fairness bounds,
  coverage repair, slot-metric sort — remain unchanged (Requirement 3.4).
- `greedyFallback` continues to pick the minimum-cost candidate when at least
  one finite-cost candidate exists (Requirement 3.5). The change is restricted
  to the "every candidate `= INFINITY_SENTINEL`" edge, where current and fixed
  code already agree.

**Scope of the fix:** only inputs that trigger C1 see a behavioural change in
row outputs (Phase 2 finishes more halfdays, downstream phases see a fuller
roster). For inputs where `¬C(X)`, F' must agree with F on every dimension
(P4). The new diagnostic fields `phase2TimedOut` and `phase2TimeoutMs` are
purely additive; they do not flow into row outputs and are excluded from the
P4 deep-equality check (`outputEquals`).

## Hypothesized Root Cause

### Why `TIMEOUT_MS = 1500` is too tight

The constant was chosen when v2 fixtures were small (≤ 30 proctors, ≤ 20
halfdays). The user's real centre is 5× larger on the proctor axis and 4×
larger on the halfday axis. Phase 2's inner work is dominated by Hungarian
matrix construction and `costFunction` evaluations: Hungarian is `O(N³)` per
halfday in pathological cases, and `computeEligibilityClasses` /
`buildSwapCandidates` walk `proctorsList × scheduleEntries` linearly. Empirical
measurement on the reference centre yields `phase2DurationMs ≈ 1635 ms`, a
140 ms overshoot. Raising the default to `5000 ms` gives ≈ 3× headroom — enough
to absorb the variance of one Hungarian pass on a 200-proctor centre while
remaining below the soft "abort and warn" threshold a UI user would tolerate.
The override `input.options.phase2TimeoutMs` lets advanced callers tune the
budget per centre (CI fixtures cap it at 200 ms to keep the suite fast).

### Why the orchestrator's heuristic is fragile

`phase2DurationMs >= 1500` worked when the constant was hard-coded *and* when
no run ever finished in exactly 1500 ms by coincidence. Once `TIMEOUT_MS`
becomes configurable, the comparison decouples from reality: a configured
`phase2TimeoutMs = 10 000 ms` with an actual `phase2DurationMs = 2 000 ms`
(loop completed normally) still trips `>= 1500`, raising a false "Phase 2
timeout exceeded" warning and flipping `orchestratorState` to `'TIMEOUT'`
(line ≈4319). The correct contract is a boolean flag set inside `phase2Build`
at the *exact* `break` site (line ≈1929), echoed back to the orchestrator via
`phase2Result.diagnostics.phase2TimedOut`. The orchestrator then renders the
formatted budget by reading the symmetric `phase2TimeoutMs` field, never
hard-coding a number.

### Why the greedy cap fix is a regression-guard, not a code change

`bugfix.md` §C2 calls out a code path where `greedyFallback` could admit an
over-cap candidate. Inspection of the live code at line ≈1597 shows the
defence is already present:

```
// Defect 1 fix: if every available proctor scored INFINITY_SENTINEL
// ... leave the slot empty rather than admitting a hard-constraint violation.
if (bestProctor !== null && bestCost < INFINITY_SENTINEL) {
  ...
} else {
  assignments.push({ taskIndex: ti, proctorKey: null });
  shortages++;
}
```

The guard `bestCost < INFINITY_SENTINEL` prevents the failure mode described in
C2. The risk that remains is *regression*: a future refactor weakens the
condition (e.g. drops the `< INFINITY_SENTINEL` and falls back to
`bestProctor !== null`). Item 3 of this spec adds an explicit regression test
that constructs a fixture where every candidate has `cost = INFINITY_SENTINEL`,
asserts `assignments[i].proctorKey === null` and `shortages > 0`, and pins the
behaviour. The design therefore treats Item 3 as documentation + test, not as
production-code change.

The other path that historically risked over-cap admission —
`phase2_75CoverageRepair` — does not call `costFunction` directly. It uses its
own `swapPreservesHardConstraints` (line ≈2838) and the threshold-based
`buildSwapCandidates` (line ≈2890). By construction, `T_uncov` is
`primaryLoad = 0` and `classUpperBound ≥ 1`, so post-swap `T_uncov.primaryLoad = 1 ≤ classUpperBound`.
That invariant is restated in the testing strategy and asserted via PBT.

## Correctness Properties

Property 1: Bug Condition — Phase 2 timeout sufficiency on the reference fixture

_For any_ input where the bug condition holds via C1 (Phase 2 hits the legacy
`TIMEOUT_MS = 1500` budget on a sized input and leaves slots unfilled), the
fixed `phase2Build` SHALL run to completion within the resolved budget
(`input.options.phase2TimeoutMs` if a positive number is supplied, else
`DEFAULT_PHASE2_TIMEOUT_MS = 5000`), AND SHALL return
`phase2DurationMs < phase2TimeoutMs` AND
`filledSlotsCount(result) = expectedTotalSlots(X)` for the reference centre
(147 proctors, 8 halfdays, 92 sessions, `G = 368`, `D_expected = 15`).

**Validates: Requirements 2.1, 2.2**

Property 2: Bug Condition — Hard cap inviolate via `greedyFallback`

_For any_ input where the bug condition holds via C2 (every candidate for some
slot scores `INFINITY_SENTINEL` in `costFunction`), the fixed `greedyFallback`
SHALL leave the slot empty (`assignments[i].proctorKey === null`) AND increment
`shortages` by 1, AND SHALL NOT produce any assignment where
`getPrimaryLoad(loadState, key) > classUpperBound[classOf(key)]` after the
fact — preserving the existing `bestCost < INFINITY_SENTINEL` guard.

**Validates: Requirements 2.4, 3.3, 3.5**

Property 3: Bug Condition — Diagnostic field always boolean

_For any_ input, the fixed `phase2Build` SHALL return a `diagnostics` object
where `typeof diagnostics.phase2TimedOut === 'boolean'` (never `undefined`,
never `null`, never any other type) AND
`typeof diagnostics.phase2TimeoutMs === 'number'`. The orchestrator SHALL
read `phase2TimedOut` directly and SHALL NOT compare `phase2DurationMs`
against any hard-coded threshold to infer timeout state.

**Validates: Requirements 2.3, 2.5**

Property 4: Preservation — No regression on small fixtures or v1

_For any_ input where the bug condition does NOT hold (no C1 trigger because
`proctorCount < 50` or the loop completes inside the budget; no C2 trigger
because at least one candidate has finite cost), the fixed function SHALL
produce the same row outputs, the same `loadState`, and the same legacy
diagnostics (excluding the new fields `phase2TimedOut`, `phase2TimeoutMs`) as
the original function. The v1 path SHALL remain byte-identical to the
pre-fix v1 snapshot.

**Validates: Requirements 3.1, 3.2, 3.4**

## Fix Implementation

### Architecture overview

Four edit sites, all inside `js/algorithms/proctor-distribution-v2.js`. No new
modules, no new files, no UI work, no migration work. Approximate line numbers
are anchored to the current source (`greedyFallback ≈ 1555`,
`phase2Build ≈ 1671`, `TIMEOUT_MS = 1500 ≈ 1672`, timeout break ≈ 1929,
phase2Build return ≈ 2354, orchestrator timeout heuristic ≈ 4067).

| # | File | Function / Site | Property | Nature of change |
|---|------|-----------------|----------|------------------|
| 1 | `js/algorithms/proctor-distribution-v2.js` | `phase2Build` (≈1671) — header constants | C1, P1, P3 | Promote `TIMEOUT_MS` to read from `input.options.phase2TimeoutMs` (positive number) with new module-level `DEFAULT_PHASE2_TIMEOUT_MS = 5000` fallback. Track `timedOutFlag = false` in scope. |
| 2 | `js/algorithms/proctor-distribution-v2.js` | `phase2Build` timeout break (≈1929) and return statement (≈2354) | C1, P3 | Set `timedOutFlag = true` immediately before `break`. Add `phase2TimedOut: timedOutFlag` and `phase2TimeoutMs: TIMEOUT_MS` to the returned `diagnostics`. |
| 3 | `js/algorithms/proctor-distribution-v2.js` | `greedyFallback` (≈1555–1620) | C2, P2 | **No production change.** Verify the existing guard `if (bestProctor !== null && bestCost < INFINITY_SENTINEL)` is unchanged; add a regression PBT that constructs an all-`INFINITY_SENTINEL` candidate list and asserts the slot is left empty. |
| 4 | `js/algorithms/proctor-distribution-v2.js` | orchestrator timeout-detection block (≈4067) | C1, P3 | Replace `phase2Result.diagnostics.phase2DurationMs >= 1500` with `phase2Result.diagnostics.phase2TimedOut`. Format the warning message using `phase2Result.diagnostics.phase2TimeoutMs` (fallback `5000`). |

### 1. `phase2Build` header — configurable timeout (≈1671)

**Inputs**
- `input.options.phase2TimeoutMs` (optional): the per-call override.
  Honoured only when `Number(...) > 0`; non-numeric / `undefined` / `0` /
  negative all fall through to the default.
- `DEFAULT_PHASE2_TIMEOUT_MS = 5000` (new module-level constant placed near
  the other `INFINITY_SENTINEL`-style constants at the top of the IIFE).

**Output**
- Local `TIMEOUT_MS` resolved once, used by the existing
  `Date.now() - startTime > TIMEOUT_MS` guard at line ≈1929 (signature
  unchanged).
- Local `timedOutFlag` initialised to `false`, flipped to `true` only at the
  exact `break` site.

**Pseudocode (top of `phase2Build`)**

```
FUNCTION phase2Build(phase1Result, input, rng)
  startTime    ← Date.now()

  // Resolve the Phase 2 budget once. Override is honoured only if numeric > 0;
  // anything else (undefined, 0, negative, non-numeric) falls back to the
  // module-level DEFAULT_PHASE2_TIMEOUT_MS = 5000.
  optionsBag   ← input.options OR {}
  rawOverride  ← Number(optionsBag.phase2TimeoutMs)
  TIMEOUT_MS   ← (rawOverride > 0) ? rawOverride : DEFAULT_PHASE2_TIMEOUT_MS

  // Track timeout state explicitly. Set true ONLY at the actual break site.
  timedOutFlag ← false

  ... rest of phase2Build unchanged ...
END FUNCTION
```

**Module-level constant (top of the file IIFE):**

```
var DEFAULT_PHASE2_TIMEOUT_MS = 5000
```

**Edge cases**

| Case | Behaviour |
|------|-----------|
| `input.options` undefined | `optionsBag = {}`; `Number(undefined) = NaN`; `NaN > 0 = false`; `TIMEOUT_MS = 5000`. |
| `input.options.phase2TimeoutMs = 1500` | `1500 > 0 = true`; `TIMEOUT_MS = 1500`. Used by tests pinning the legacy budget. |
| `input.options.phase2TimeoutMs = "5000"` | `Number("5000") = 5000`; `5000 > 0 = true`; `TIMEOUT_MS = 5000`. Lenient on string input. |
| `input.options.phase2TimeoutMs = 0` | `0 > 0 = false`; falls back to `5000`. Avoids accidental zero-budget bricking. |
| `input.options.phase2TimeoutMs = -200` | `-200 > 0 = false`; falls back to `5000`. |
| `input.options.phase2TimeoutMs = "abc"` | `Number("abc") = NaN`; `NaN > 0 = false`; falls back to `5000`. |
| `input.options.phase2TimeoutMs = Infinity` | `Infinity > 0 = true`; `TIMEOUT_MS = Infinity`; loop never breaks on timeout (only on natural completion). |

**Determinism notes**: `TIMEOUT_MS` is a function-scope `var`, resolved once at
function entry. Two runs with the same input yield the same `TIMEOUT_MS`. The
flag `timedOutFlag` depends only on wall-clock — non-deterministic by design,
which is why P4 PBT excludes the two new diagnostic fields from
`outputEquals`.

### 2. Timeout break + return statement (≈1929 and ≈2354)

**Pseudocode (timeout break, line ≈1929)**

```
FOR EACH halfdayKey IN halfdayKeysSorted DO
  ...
  IF Date.now() - startTime > TIMEOUT_MS THEN
    timedOutFlag ← true              // NEW — set the flag at the actual break
    BREAK
  END IF
  ...
END FOR
```

**Pseudocode (return statement, line ≈2354)**

```
phase2DurationMs ← Date.now() - startTime

RETURN {
  assignments:             result,
  loadState:               loadState,
  classBoundsByProctorKey: classBoundsByProctorKey,
  classIdByProctorKey:     classIdByProctorKey,
  diagnostics: {
    phase2DurationMs:       phase2DurationMs,
    phase2TimedOut:         timedOutFlag,            // NEW — always boolean
    phase2TimeoutMs:        TIMEOUT_MS,              // NEW — resolved budget
    fallbackCount:          ...,                     // existing
    totalHalfdaysProcessed: ...,                     // existing
    averageCostPerAssignment: ...,                   // existing
    fallbackHalfdays:       ...,                     // existing
    eligibilityClassCount:  ...,                     // from prior spec
    classBounds:            ...                      // from prior spec
  }
}
```

**Edge cases**

| Case | Behaviour |
|------|-----------|
| Loop completes naturally | `timedOutFlag` stays `false`; `phase2DurationMs < phase2TimeoutMs`; downstream orchestrator emits no timeout warning. |
| Loop breaks on timeout | `timedOutFlag = true` at the break; downstream orchestrator emits the warning using `phase2TimeoutMs`. |
| `phase2Build` throws mid-halfday | Caught by orchestrator (existing `try/catch` at line ≈4057). The thrown path never reaches the new `return`, so the orchestrator's existing fallback diagnostics apply unchanged. |
| Override `Infinity` + slow run | `phase2DurationMs > 5000` is possible; `timedOutFlag` stays `false`; no warning. Correct: the caller asked for an unbounded budget. |
| Override `1` ms + small fixture | Loop almost certainly trips on the first iteration; `timedOutFlag = true`; result has `assignments = []` for the unprocessed halfdays, downstream phases see an empty roster. The hard cap still holds (greedyFallback inherits it via `costFunction`); shortages are reported. |

**Determinism notes**: the boolean flag is a pure function of the wall-clock
trace. Two runs with the same input on the same machine may differ by a few
ms but will agree on `timedOutFlag` for inputs that finish far below or far
above the budget. Inputs at the boundary are inherently flaky; the integration
test for the reference fixture uses an oversized budget (`Infinity` or
`60000 ms`) to neutralise wall-clock variance.

### 3. `greedyFallback` cap — verification only (≈1555–1620)

**No production code change.** The current implementation already implements
the C2 contract. This item is a regression-guard: a frozen test that rebuilds
on every commit and fails immediately if the cap is weakened.

**Verified live code (cite, do not edit):**

```
bestProctor ← null
bestCost    ← INFINITY_SENTINEL

FOR EACH (proctor IN availableProctors) DO
  cost ← costFunction(proctor.key, task, loadState, options, weights, lowerBound)
  IF cost < bestCost THEN
    bestCost    ← cost
    bestProctor ← proctor
  END IF
END FOR

IF bestProctor != null AND bestCost < INFINITY_SENTINEL THEN
  // assign T_best to slot, addGuardLoad, mark usedInSession
ELSE
  assignments.push({ taskIndex: ti, proctorKey: null })
  shortages += 1
END IF
```

**Why the guard is sufficient.** `bestProctor` becomes non-null only inside
the `if (cost < bestCost)` branch, but `bestCost` is initialised to
`INFINITY_SENTINEL`. The strict comparison `cost < INFINITY_SENTINEL` is the
only way `bestProctor` advances past `null`. *However*, in the pathological
case where every `cost === INFINITY_SENTINEL`, the strict comparison fails for
all of them and `bestProctor` stays `null`. Even if a future refactor weakens
the loop condition (e.g. `<=`), the second guard `bestCost < INFINITY_SENTINEL`
still rejects the over-cap admission. Both guards are required; either alone
is brittle.

**Edge cases**

| Case | Current behaviour (preserved) |
|------|-------------------------------|
| Empty `availableProctors` | `bestProctor = null`; slot left empty; `shortages += 1`. |
| All candidates `cost = INFINITY_SENTINEL` | `bestProctor = null`; slot left empty; `shortages += 1`. |
| One finite candidate, rest `INFINITY_SENTINEL` | `bestProctor` = the finite one; slot filled; `shortages` unchanged. |
| Multiple finite candidates | Lowest-cost one wins (ties broken by iteration order — same as existing). |

**Determinism notes**: behaviour pinned by the existing strict-fairness PBT
(`P2 — Hard cap inviolate`) plus the new regression test described in §Testing
Strategy. No `rng` use here.

### 4. Orchestrator timeout detection (≈4067)

**Inputs**
- `phase2Result.diagnostics.phase2TimedOut: boolean` (new, set in §2).
- `phase2Result.diagnostics.phase2TimeoutMs: number` (new, set in §2).

**Output**
- Mutates the orchestrator-local `phase2TimedOut` flag (line ≈4055) and
  `diagnostics.warnings`.

**Pseudocode (replacing the current heuristic at line ≈4067)**

```
// OLD (to be removed):
//   IF phase2Result.diagnostics.phase2DurationMs >= 1500 THEN
//     phase2TimedOut ← true
//     diagnostics.warnings.push('Phase 2 timeout exceeded (1500ms)')
//   END IF
//
// NEW:
IF phase2Result.diagnostics.phase2TimedOut THEN
  phase2TimedOut ← true
  actualTimeoutMs ← phase2Result.diagnostics.phase2TimeoutMs OR DEFAULT_PHASE2_TIMEOUT_MS
  diagnostics.warnings.push('Phase 2 timeout exceeded (' + actualTimeoutMs + 'ms)')
END IF
```

**Edge cases**

| Case | Behaviour |
|------|-----------|
| `phase2TimedOut === false`, `phase2DurationMs = 1502` | No warning. Old code would have falsely warned. |
| `phase2TimedOut === true`, `phase2TimeoutMs = 5000` | `'Phase 2 timeout exceeded (5000ms)'`. Message dynamic. |
| `phase2TimedOut === true`, `phase2TimeoutMs = Infinity` | `'Phase 2 timeout exceeded (Infinityms)'` — cosmetic; in practice this state is unreachable because an `Infinity` budget never trips the break. The fallback `OR DEFAULT_PHASE2_TIMEOUT_MS` is unused on the truthy path. |
| `phase2TimedOut === undefined` (legacy result, e.g. cached from pre-fix run) | Falsy; no warning emitted; `phase2TimedOut` orchestrator-local flag stays `false`; `orchestratorState` stays `'COMPLETED'`. Acceptable: a cached pre-fix result will not surface a freshly-coined boolean. |
| `phase2Result.diagnostics` missing entirely | The existing `try/catch` at line ≈4057 is the safety net; this block is only reached when `phase2Build` returned a well-formed result. |

**Determinism notes**: the message string contains the resolved budget, which
is deterministic given the input. No `rng` use.

## Data Contract Changes

### Input shape — additive

| Field | Type | Default | Source |
|-------|------|---------|--------|
| `input.options.phase2TimeoutMs` | `number > 0` (any positive numeric, including very large) | absent → `5000` | Caller-supplied. No UI surface in this spec. |

`validateInput` (existing) gains one optional check: if
`input.options.phase2TimeoutMs` is present, allow any value but only honour
positives (existing convention for option fields). Non-positive values do not
throw — they fall through to the default.

### Output shape — additive diagnostics only

`phase2Result.diagnostics` gains:

| Field | Type | Meaning |
|-------|------|---------|
| `phase2TimedOut` | `boolean` (always present) | `true` iff the inner halfday loop broke on the timeout guard. |
| `phase2TimeoutMs` | `number` (always present) | The resolved budget — override or default. |

The orchestrator's top-level `diagnostics` object is unchanged in shape;
`diagnostics.warnings` may now contain the dynamically-formatted string
`'Phase 2 timeout exceeded (Xms)'` where `X` is the resolved budget instead
of the literal `1500`.

Old saved auto-distribution blobs without these fields render correctly
(rendering code reads via `?.` / `||` fallbacks).

## Migration / Backward Compatibility

- **Existing callers without `input.options.phase2TimeoutMs`.** Receive the
  new default `5000 ms` instead of the legacy `1500 ms`. For any small fixture
  that already finished below 1500 ms, behaviour is bit-identical (Phase 2
  loop exits naturally at the same point). For any fixture that previously
  tripped the 1500 ms break and now fits in 5000 ms, behaviour changes by
  filling more slots — that is the intended fix.
- **Tests asserting `phase2DurationMs <= 1500`.** A grep across the repo
  finds at most a handful of such assertions (mostly in
  `tests/algorithms/proctor-v2/*.spec.js`). They must be updated to assert
  `phase2DurationMs <= phase2TimeoutMs` (relative) or to pin
  `phase2TimeoutMs = 1500` explicitly via the new override.
- **`phase2TimedOut` field on legacy diagnostics.** Was `undefined` before
  this fix; is now always `boolean`. P3 enforces this. Renderers that read
  the field via `?.` / `||` continue to work; renderers that explicitly
  type-check should now expect `boolean`.
- **Pre-fix snapshot stability.** `tests/__snapshots__/proctor-v2-strict-fairness-coverage.pre-fix.js`
  is **NOT** modified. The snapshot captures row outputs only, not the new
  diagnostic fields, so it remains valid.
- **v1 byte-equality.** `runAutoDistribution` is untouched. P4 reasserts
  byte-equality against a frozen v1 pre-fix snapshot.
- **Orchestrator legacy heuristic.** Any external observer that scrapes
  `diagnostics.warnings` for the literal `'Phase 2 timeout exceeded (1500ms)'`
  must update its regex to `/Phase 2 timeout exceeded \(\d+ms\)/`. Not known
  to be used by any consumer.

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Default `5000 ms` is too generous for CI fixtures (slows the suite) | Low | Low | All CI fixtures are bounded (≤ 50 proctors); their natural Phase 2 runtime is < 100 ms; the new default never triggers. CI tests can pin `phase2TimeoutMs = 200` explicitly when a regression-on-timeout assertion is desired. |
| Existing tests assert hard-coded `1500 ms` | Low | Low | A repo-wide grep for `phase2DurationMs.*1500\|TIMEOUT_MS.*1500\|timeout exceeded \(1500ms\)` returns < 5 hits; each is updated to the new override or to a relative comparison in a single PR. |
| `input.options.phase2TimeoutMs` override silently ignored | Low | Medium | Integration test asserts that a caller-supplied `phase2TimeoutMs = 200` causes a sized fixture to time out and `phase2TimedOut === true`, while a default-budget run on the same fixture finishes with `phase2TimedOut === false`. |
| Orchestrator legacy heuristic still fires on small runs | Already triggers in F | Low | Item 4 replaces the heuristic with a direct boolean read; covered by P3 PBT and an integration test that runs a sub-100 ms fixture and asserts `diagnostics.warnings` does NOT contain a "Phase 2 timeout" entry. |
| `greedyFallback` cap regressed in a future refactor | Low | High | Item 3 freezes the behaviour with a regression PBT that constructs an all-`INFINITY_SENTINEL` candidate list and asserts `proctorKey === null` and `shortages > 0`. Test runs on every commit. |
| `phase2TimedOut = true` on a happy-path run due to a slow CI runner | Low | Low | The default budget is 5 000 ms — comfortably above the natural runtime of any CI fixture. The integration test for P3 uses an oversized override (`60 000` or `Infinity`) when wall-clock variance could cause flakes. |
| `phase2TimeoutMs = Infinity` formats poorly in the warning string | Very low | Cosmetic | Documented; in practice `Infinity` never trips the break, so the warning is never emitted on this branch. Add `Number.isFinite` guard in the message format if cosmetics matter. |
| New diagnostic fields break a third-party renderer expecting old shape | Very low | Low | Fields are additive; renderers that don't read them are unaffected. The diagnostics panel renderer already uses `?.` / `||` fallbacks for newly-coined fields (consistent with prior specs). |
| v1 byte-equality breaks | Very low | High | v1 path (`runAutoDistribution`) is not touched. P4 asserts byte-equality against the frozen v1 pre-fix snapshot on every commit. |

## Testing Strategy

### Validation Approach

Two phases. First, confirm on the unfixed code (F) that (a) C1 fires on the
reference fixture and (b) the orchestrator heuristic mis-fires on a sized run
that just happens to cross 1500 ms. Then verify on the fixed code (F') that
P1–P4 hold and that `phase2_75CoverageRepair` benefits transparently from the
extended budget.

### Exploratory Bug Condition Checking

**Goal:** demonstrate C1 (and the orchestrator-heuristic fragility) on F. The
C2 path is already correct on F, so the exploratory test is the C2
regression-guard described under §Fix Implementation Item 3.

**Test plan:** small-to-medium synthetic fixtures plus the recorded reference
fixture. Run on F before the fix.

| # | Name | Trigger | Expected on F |
|---|------|---------|---------------|
| 1 | C1 — reference fixture | 147 proctors / 8 halfdays / `D_expected = 15` | `phase2DurationMs ≈ 1635`, loop breaks, `filledSlots = 96 / 368`, `coverageRepairUnresolved = 51`. P1 fails. |
| 2 | C1 — synthetic 80-proctor fixture | 80 proctors / 6 halfdays, padded with `costFunction` calls so Phase 2 takes ~2 s | Loop trips at 1500 ms; `phase2TimedOut` is **`undefined`** in returned diagnostics (field doesn't exist yet); orchestrator infers `true` from `phase2DurationMs >= 1500`. P3 fails. |
| 3 | C1 — option override ignored | Caller passes `input.options.phase2TimeoutMs = 5000` on the synthetic 80-proctor fixture | Same as #2 — option is ignored; loop still trips at 1500 ms. P1 fails on override. |
| 4 | C2 — every candidate over cap (regression-guard preview) | Construct `availableProctors` such that every `costFunction` call returns `INFINITY_SENTINEL` (e.g. each candidate already at `classUpperBound`) | F: `assignments[i].proctorKey === null`, `shortages += 1`. **Already correct on F** — captured as a regression test that pins behaviour. |
| 5 | Orchestrator heuristic mis-fire | A small fixture engineered to take exactly ~1502 ms in Phase 2 (or pinned via a stub clock) | F: warning `'Phase 2 timeout exceeded (1500ms)'` emitted; `orchestratorState = 'TIMEOUT'` — false positive. F': no warning. |

**Expected counterexamples & root-cause confirmation:** failures #1 and #3
pinpoint the timeout site; failure #2 pinpoints the missing diagnostic field;
#5 pinpoints the orchestrator heuristic. If #1 passes on F (i.e. the
reference fixture finishes inside 1500 ms on the developer's machine), the
fixture is too small or the developer's machine is too fast — re-record the
fixture or scale it up until it reproduces.

### Fix Checking

**Goal:** for every input where `C(X)` holds, F' produces an output that
satisfies the corresponding property.

```
FOR ALL input WHERE isBugCondition_C1(F(input)) DO
  X' := F'(input)
  ASSERT X'.diagnostics.phase2DurationMs < X'.diagnostics.phase2TimeoutMs
  ASSERT filledSlotsCount(X') = expectedTotalSlots(input)        // P1
  ASSERT typeof X'.diagnostics.phase2TimedOut === 'boolean'      // P3
END FOR

FOR ALL input WHERE isBugCondition_C2(F(input)) DO
  X' := F'(input)
  FOR ALL row R, slot s IN X' WHERE R.proctor_keys[s] != null DO
    ASSERT getPrimaryLoad(X'.loadState, R.proctor_keys[s])
        <= classUpperBound[classOf(R.proctor_keys[s])]            // P2
  END FOR
END FOR
```

### Preservation Checking

**Goal:** for every input where `¬C(X)`, F' equals F on every dimension that
is not a new diagnostic field. Property-based testing is the right tool here —
preservation is a universal claim across the input space.

```
FOR ALL input WHERE proctorCount(input) < 50
              AND F'(input).diagnostics.phase2TimedOut = false DO
  // outputEquals excludes phase2TimedOut and phase2TimeoutMs from the
  // deep-equality comparison; every other field must match byte-for-byte.
  ASSERT outputEquals(F(input), F'(input))                        // P4
END FOR

FOR ALL input WHERE v1Path(input) DO
  ASSERT bytesEqual(runAutoDistribution_F(input),
                    runAutoDistribution_F'(input))                // P4 (v1)
END FOR
```

**Test plan:** generator yields random `(proctorsList, scheduleEntries,
exemptionsData, dutyData, options)` tuples bounded to ≤ 50 proctors and ≤ 20
halfdays so Phase 2 always finishes well below the budget. F is a frozen
pre-fix module copy. Comparison filters out the two new diagnostic fields
before deep-equality.

### Unit Tests

- `phase2Build` honours `input.options.phase2TimeoutMs = 200` — synthetic
  long-running fixture trips the break at ~200 ms,
  `phase2TimedOut = true`, `phase2TimeoutMs = 200`.
- `phase2Build` defaults `TIMEOUT_MS = 5000` when the option is absent —
  same fixture sized to trip at ~5000 ms.
- `phase2Build` rejects non-positive overrides (`0`, `-200`, `'abc'`,
  `undefined`) — falls back to `5000`.
- `phase2Build` accepts string-numeric override `'5000'` — coerced via
  `Number(...)`.
- `phase2Build` returns `phase2TimedOut: false` on a happy-path run that
  completes within budget.
- `phase2Build` returns `typeof phase2TimedOut === 'boolean'` on every
  exit path (happy, timeout, mid-halfday throw caught upstream).
- `phase2Build` returns `phase2TimeoutMs` matching the resolved budget on
  every exit.
- `greedyFallback` regression — every-`INFINITY_SENTINEL` candidate list
  yields `proctorKey === null` and `shortages > 0` (Item 3 regression-guard).
- `greedyFallback` happy path — at least one finite candidate → that
  candidate is picked (Requirement 3.5 unchanged).
- Orchestrator timeout detection — `phase2Result.diagnostics.phase2TimedOut = true`
  → `phase2TimedOut` (orchestrator-local) flips to `true` and warning
  contains the resolved `phase2TimeoutMs`.
- Orchestrator timeout detection — `phase2Result.diagnostics.phase2TimedOut = false`
  with `phase2DurationMs = 1502` → no warning (legacy heuristic would have
  warned).

### Property-Based Tests

- **P1 — Timeout sufficiency on the reference fixture.** Generator: replay
  the recorded reference centre with random seeds. Assertion:
  `phase2DurationMs < phase2TimeoutMs` AND `filledSlots = expectedTotalSlots`.
- **P2 — Hard cap inviolate via `greedyFallback`.** Generator: random small
  `(N, G, classUpperBound)` tuples that force at least one slot through
  `greedyFallback` with all-over-cap candidates. Assertion: every assigned
  `proctor_keys[s]` satisfies `getPrimaryLoad ≤ classUpperBound`.
- **P3 — `phase2TimedOut` always boolean.** Generator: random valid input
  (any size, any options). Assertion: `typeof result.diagnostics.phase2TimedOut === 'boolean'`.
- **P4 — Preservation on small fixtures.** Generator: random valid input
  with `proctorCount < 50`. Assertion: `outputEquals(F(X), F'(X))` excluding
  the two new diagnostic fields.
- **Determinism.** Same input + same `randomSeed` + same `phase2TimeoutMs`
  override → identical row outputs and identical `phase2TimedOut` (within a
  variance band acceptable to the timing-sensitive flag — neutralised by
  using an oversized override on determinism tests).

### Integration Tests

- **§0.2 verification — reference fixture.** 147 proctors / 8 halfdays /
  `D_expected = 15`. Run with default budget. Assert: `phase2TimedOut = false`,
  `phase2DurationMs ≤ 5000`, `filledSlots = 368`,
  `coverageRepairUnresolved = 0`, `maxPrimaryLoadGapWithinClass ≤ 1`. Every
  PBT property (P1, P2, P3, P4 of *this* spec plus P1–P4 of the prior
  strict-fairness spec) green.
- **Override honoured.** Same fixture with `input.options.phase2TimeoutMs = 200` —
  loop trips, `phase2TimedOut = true`, `phase2TimeoutMs = 200`, warning
  formatted as `'Phase 2 timeout exceeded (200ms)'`.
- **Default vs override symmetry.** Two runs on the same small fixture: one
  with no override, one with `phase2TimeoutMs = 5000`. Assert outputs are
  byte-identical (excluding the two new diagnostic fields, which are equal
  anyway because the resolved budget is identical).
- **Orchestrator-heuristic regression.** Small fixture engineered to take
  ~1502 ms in Phase 2 (mock `Date.now` if needed). F: warning emitted, state
  `'TIMEOUT'`. F': no warning, state `'COMPLETED'`.
- **v1 byte-equality.** Switch the algorithm toggle to v1, run on every
  fixture in the suite, assert byte-identical to a pre-fix snapshot.
- **Pre-fix v2 snapshot stability.** Run F' on every small-fixture input
  in `tests/__snapshots__/proctor-v2-strict-fairness-coverage.pre-fix.js`,
  assert row outputs byte-identical (snapshot is read-only, never updated by
  this spec).
