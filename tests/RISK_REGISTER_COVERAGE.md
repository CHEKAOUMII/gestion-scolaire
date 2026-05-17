# Proctor v2 Fairness / Duty / Reserves — Risk Register Coverage

This file maps the risks from `design.md` to concrete tests.

## Prior spec — proctor-v2-fairness-duty-reserves (Phase F)

| Risk | Coverage |
| --- | --- |
| Shared-reference invariant | `tests/proctor-distribution-v2-phase2_5.test.js` — fixed mode and fixed zero assert shared `reserves` / `reserve_keys` references. |
| `0.5` freshness constant | `tests/proctor-distribution-v2-cost.test.js` — floor/freshness tests assert zero-load teachers remain cheaper for `lowerBound = 0` and `lowerBound > 0`. |
| Percent rounding inflates reserves | `tests/proctor-distribution-v2-phase2_5.test.js` and `tests/proctor-v2-property-p4-percent.test.js` assert `Math.ceil(percent * guards / 100)` behavior. |
| `objectiveFunction` perturbs SA load metric | `tests/proctor-distribution-v2-objective.test.js` asserts reserve assignments contribute to combined load, and `tests/integration/exams-proctors-percent.test.js` verifies percent-mode output round-trips. |
| `validateInput` rejects fixtures | `tests/exams-proctors-buildV2Input.test.js`, `tests/proctor-v2-property-p3-fixed.test.js`, and `tests/proctor-v2-property-p4-percent.test.js` run fixed/percent fixtures through the fixed v2 pipeline. |

## Current spec — proctor-v2-slot-metric-reserves-affinity (Phase E task 31)

| Risk (from `design.md` §"Risk Register") | Coverage |
| --- | --- |
| Existing v2 unit tests break on the metric switch | `tests/proctor-distribution-v2-utils.test.js` (refreshed `addGuardLoad` block, slot semantics) + `tests/proctor-v2-slot-metric-add-guard-load.test.js`. |
| Per-class `classUpperBound` becomes too tight under the slot metric | `tests/proctor-v2-slot-metric-property-p1.test.js` (PBT slot consistency across 6 seeds) + `tests/integration/proctor-v2-slot-metric-affinity.test.js` (end-to-end). The user's centre fixture (`buildC1UserCaseInput`) is exposed by `tests/fixtures/proctor-v2-slot-metric-fixtures.js` for ad-hoc verification; the `§0.2` end-to-end script exercises it. |
| `computeAffinityRank` cost on large centres | `tests/proctor-v2-slot-metric-affinity-rank.test.js` (10 unit cases) + `tests/integration/proctor-v2-slot-metric-affinity.test.js` (implicit timing — runs in <100 ms on the C3 fixture). |
| Affinity rank breaks ties unfairly when neither candidate guarded S1 | `tests/proctor-v2-slot-metric-reserve-sort.test.js` "all candidates tie on (reserveCount, affinityRank) → collapses to (finalLoad, rng)" + `tests/integration/proctor-v2-slot-metric-affinity.test.js`. |
| Halfday with > 2 sessions (data anomaly) | `tests/proctor-v2-slot-metric-affinity-rank.test.js` — defensive cases (single-session halfday, missing first-session rows, empty halfdayKey, falsy proctor_keys cells). |
| Phase 2.75 coverage repair pushes a peer below `classLowerBound` after the metric switch | Code: comment block above `buildSwapCandidates` documents that the three-tier relaxation (`classUB+1`, `classUB`, `classLB+1`) is preserved; existing `tests/proctor-distribution-v2-cost.test.js` `phase2_75CoverageRepair` swap tests still pass. |
| `addGuardLoad` callers passing a synthetic empty `halfdayKey` accidentally inflate `guardCount` | `tests/proctor-v2-slot-metric-add-guard-load.test.js` "empty halfdayKey → returns false, no mutation" + "empty proctorKey → returns false". |
| Spread tier picks a low-`reserveCount` candidate whose affinity is wrong, missing an opportunity for proximity | `tests/integration/proctor-v2-slot-metric-affinity.test.js` (S2 reserve picks S1 guard) + `tests/integration/proctor-v2-slot-metric-spread.test.js` (max−min ≤ 1). |
| `objectiveFunction` SA score shifts because `morningCount` / `afternoonCount` are now slot-based | `tests/proctor-v2-slot-metric-property-determinism.test.js` (same input + same seed → identical output) + `tests/proctor-v2-property-p6-v1-byte-equality.test.js` (preserved). |

## Pre-fix snapshot integrity guard

`tests/integration/proctor-v2-slot-metric-snapshot-integrity.test.js` reads
mtime + SHA-256 of `tests/__snapshots__/proctor-v2-strict-fairness-coverage.pre-fix.js`
before and after the suite runs and asserts neither changed (Requirement 3.10).

## Known non-fix (out of this spec's scope)

`Phase 2 has a hardcoded TIMEOUT_MS = 1500`. On the user's 147-proctor fixture
(`buildC1SingleClassGapInput`), Phase 2 takes ~1640 ms and times out, leaving
51 teachers uncovered. This timeout is owned by the prior spec
(`proctor-v2-strict-fairness-coverage`) and is NOT touched here. The §0.2
verification script flagged in `tasks.md` (red flag #1) reproducibly reports
`phase2TimedOut: true` for that fixture both pre- and post-fix; smaller fixtures
(see this spec's tests above) complete within the timeout and exercise the
slot-metric / reserve-sort fix on every assertion path.
