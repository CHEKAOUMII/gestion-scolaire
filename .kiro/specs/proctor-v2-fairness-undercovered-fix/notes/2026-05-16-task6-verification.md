# Task 6 — End-to-End Synthetic Verification

**Date:** 2026-05-16
**Task:** Task 6 — Run end-to-end synthetic verification script (regression check)
**Spec:** `proctor-v2-fairness-undercovered-fix`
**Reference:** Task 6 in tasks.md (Requirements 3.3)

---

## Command

`node scripts/verify-end-to-end.js`

## Output (post-4.6)

```
=== END-TO-END VERIFICATION ===
phase2DurationMs: ~ms
phase2TimedOut: false
phase2TimeoutMs: 5000
coverageRepairSwaps: 0
coverageRepairUnresolved: 0
total filled: 184 / 368
max slot count: 2  min: 1  uncovered: 0
P1 max-min<=1: PASS
P2 max<=3: PASS
P3 zeros=0: PASS
Coverage filled=368: FAIL
```

## Per-Property Analysis

| Invariant | Result | In-scope? |
|---|---|---|
| P1 (max-min ≤ 1) | PASS (max=2, min=1) | ✅ in-scope |
| P2 (max ≤ 3) | PASS (max=2) | ✅ in-scope |
| P3 (uncovered=0) | PASS (zeros=0) | ✅ in-scope |
| Coverage (filled=368) | FAIL (184/368) | ⚠️ pre-existing script bug |

## Investigation: Coverage FAIL is a pre-existing script bug, not a regression

Investigation method: temporarily nullified Task 4.5 plumbing (set `input.classBoundsByProctorKey = null` instead of attaching `phase2Result.classBoundsByProctorKey`). This neutralizes BOTH Task 4.5 (plumbing) and Task 4.6 (lower/upper-bound rejection — gated by `if (classBounds)`).

Result: byte-identical output. Both runs gave 184/368 with `coverageRepairSwaps=0`, `coverageRepairUnresolved=0`. The 4.5/4.6 changes reject ZERO additional moves on this fixture.

## Root cause of Coverage FAIL

The synthetic fixture `buildC1SingleClassGapInput()` (in `tests/fixtures/proctor-v2-strict-fairness-fixtures.js`, lines 170–230) declares:
- 92 schedule entries
- 1 room
- `examDistributionRules: { proctorsPerRoom: 2, reservesPerSession: 0 }`

Actual guard slots available to fill: `92 × 1 × 2 = 184`. The algorithm fills all 184 (zero uncovered) — P1/P2/P3 all PASS.

The script `scripts/verify-end-to-end.js` hard-codes `368` as the expected count. `368` would only be reached with `proctorsPerRoom: 4` (matching the fixture's docstring header but NOT its actual `examDistributionRules`). The script copied the docstring's stated number, not the config-derived number, creating a mismatch.

## Conclusion: P1/P2/P3 regression check PASSES

The spec's actual regression-check requirement (Requirements 3.3 — preservation of synthetic-fixture behavior) is satisfied:
- P1, P2, P3 all PASS — these are the spec's invariants
- `uncovered: 0` — every actually-available slot is filled
- Coverage line's `184 ≠ 368` is driven by a script-side bug (hard-coded denominator), not by any algorithm change

The 4.5/4.6 changes are confirmed PRESERVATION-COMPATIBLE on the synthetic fixture. The end-to-end script's hard-coded denominator is a known pre-existing condition tracked separately and does not block this task.

## Recommended follow-up (out of this spec's scope)

Either:
1. Fix `scripts/verify-end-to-end.js` to derive `expected` from `92 × roomsList.length × proctorsPerRoom`, OR
2. Update the fixture's `examDistributionRules` to `proctorsPerRoom: 4` to match its docstring claim (carefully, since this affects other tests).

This is tracked under a separate spec or backlog item; not required for closing `proctor-v2-fairness-undercovered-fix`.

---

**Spec scope verified PASS for Task 6.**
