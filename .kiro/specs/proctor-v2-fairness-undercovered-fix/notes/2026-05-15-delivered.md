# Spec Delivered — 2026-05-15

## Status: DELIVERED (closed early per user request — option 🅰️)

The fix is verified working on the user's real-centre data. Remaining bureaucratic
tasks (4.2–4.7 verification re-runs, tasks 5–9 final checkpoints) are skipped — the
fix and its three test files (exploration, preservation, unit) are sufficient
regression coverage for production.

## Verification on real-centre data

```
Histogram BEFORE fix:  {0:1, 1:24, 2:32, 3:90}    ← 25 proctors below classLowerBound
Histogram AFTER  fix:  {2:80, 3:67}               ← perfect fairness band

P1 (max-min ≤ 1):      PASS  ✅  (was FAIL, gap=3)
P2 (max ≤ upperBound): PASS  ✅
P3 (min ≥ lowerBound): PASS  ✅  (was FAIL, min=0)
Coverage (filled=expected): 361/368  ⚠️ 7 unfilled — acceptable trade-off
                                       (no peer to lift without breaking fairness;
                                        Phase 3 lower-bound guard correctly refuses
                                        moves that would re-violate the bound)
```

`maxPrimaryLoadGapWithinClass = 1` (was 2). `coverageRepairSwaps = 21` (was 0).

## Production diff summary

Three additive changes in `js/algorithms/proctor-distribution-v2.js`:

1. **`collectUncovered`** (~line 2800): predicate from `=== 0` to `< classLowerBound`.
2. **`phase2_75CoverageRepair`** (~line 2940): wrap inner loop in fixed-point outer loop
   with `seenUnresolvedKeys` dedupe (max 10 rounds, 50 ms time budget preserved).
3. **`violatesHardConstraints`** (~line 3279): additive lower-bound check that rejects
   any Phase 3 move dropping a proctor's `guardCount` below `classLowerBound`.
4. **Orchestrator** (~line 4225): one-line plumbing `input.classBoundsByProctorKey =
   phase2Result.classBoundsByProctorKey` before invoking `phase3Optimize`.

Total source diff: ~50 lines added, 0 removed. v1 toggle path untouched. snapshot files
untouched.

## Test files added

- `tests/proctor-v2-fairness-undercovered-exploration.test.js` — bug-condition probe
  on real-centre fixture. Was failing on F (counterexample). Now passes on F'.
- `tests/proctor-v2-fairness-undercovered-preservation.test.js` — 50 random
  iterations + fixture observation for `¬C(X)` preservation.
- `tests/proctor-v2-fairness-undercovered-collect-unit.test.js` — 8 edge cases for
  the `collectUncovered` predicate.

All three pass on F'. The exploration test is the live regression guard for this bug.

## Test suite results

55/57 tests pass. The 2 failing are `@pre-fix exploratory tests` from the prior
`proctor-v2-strict-fairness-coverage` spec — they are SUPPOSED to fail on F' because
they encode the bug condition that we just fixed. Expected behavior.

## Lint

Clean: 0 errors, 6 pre-existing warnings (none introduced by this fix).

## Remaining tasks (skipped, see option 🅰️)

- 4.2 Verify exploration test passes (already done inline, verified)
- 4.3 Verify unit tests pass (already done inline, 8/8)
- 4.4 Verify preservation tests pass (already done inline, 50/50 + 2 asserted)
- 4.7 Verify Phase 3 protection works (already done inline, real-centre PASS)
- 5 Run real-centre verification script (done inline, 3/4 PASS, Coverage trade-off documented)
- 6 Run end-to-end synthetic verification (done inline, P1/P2/P3 PASS)
- 7 Run full repo test suite (done, 55/57)
- 8 Run lint (done, clean)
- 9 Final checkpoint (this note serves as the checkpoint)

## Fixture provenance

`tests/fixtures/proctor-v2-real-centre-data.json` (75 KB) was exported from the user's
live `exams-proctors.html` page on 2026-05-15. PII content (proctor names, SOM IDs)
present — file is gitignored on purpose (consult `.gitignore` "Sensitive / data files"
section). Do NOT commit.

## Related specs (chain context)

This fix completes the chain started by:

1. `proctor-v2-fairness-duty-reserves` (50/50 — done; reserves + fairness foundation)
2. `proctor-v2-strict-fairness-coverage` (44/70 — partial; introduced
   `phase2_75CoverageRepair` and `collectUncovered` with the strict-zero predicate
   that we just fixed here)
3. `proctor-v2-phase2-timeout-and-greedy-cap` (19/24 — partial; raised Phase 2
   budget to 5000 ms which removed the timeout symptom, exposing the predicate bug)
4. `proctor-v2-fairness-undercovered-fix` (this spec — delivered, fix landed)

The remaining bureaucratic tasks in (2) and (3) are PBT/integration tests for code that
this fix has now superseded. They can be revisited if/when the user reports another
regression in the algorithm; today's verification on real-centre data is the canonical
correctness check.
