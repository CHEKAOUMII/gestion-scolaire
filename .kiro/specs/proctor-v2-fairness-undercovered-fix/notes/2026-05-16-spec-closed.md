# Spec Closed: Proctor v2 Fairness Undercovered Fix

**Date Closed:** 2026-05-16
**Status:** Delivered ✅

## Summary

Spec `proctor-v2-fairness-undercovered-fix` is closed. The bug — `collectUncovered` using `=== 0` instead of `< classLowerBound`, causing 24 proctors at load=1 to be missed by the repair pass on the real-centre fixture — is fully fixed.

## Changes Delivered

| Task | File | Change |
|---|---|---|
| 4.1 | `js/algorithms/proctor-distribution-v2.js` ≈L2800 | `collectUncovered` predicate: `=== 0` → `< classLowerBound` |
| 4.5 | `js/algorithms/proctor-distribution-v2.js` ≈L4260 | Plumb `classBoundsByProctorKey` onto input before Phase 3 |
| 4.6 | `js/algorithms/proctor-distribution-v2.js` ≈L3355 | Add lower-bound + upper-bound rejection in `violatesHardConstraints` |

Plus 3 new test files (tasks 1, 2, 3):
- `tests/proctor-v2-fairness-undercovered-exploration.test.js`
- `tests/proctor-v2-fairness-undercovered-preservation.test.js`
- `tests/proctor-v2-fairness-undercovered-collect-unit.test.js`

## Final Verification Results

| Check | Result |
|---|---|
| `tests/proctor-v2-fairness-undercovered-exploration.test.js` | PASS |
| `tests/proctor-v2-fairness-undercovered-preservation.test.js` | PASS (50/50 random + 2/2 baseline fixtures) |
| `tests/proctor-v2-fairness-undercovered-collect-unit.test.js` | PASS (8/8 cases) |
| `scripts/verify-real-centre.js` — P1, P2, P3 | PASS |
| `scripts/verify-real-centre.js` — Coverage | FAIL 375/382 (out-of-scope, follow-up) |
| `scripts/verify-end-to-end.js` — P1, P2, P3, uncovered=0 | PASS |
| `scripts/verify-end-to-end.js` — Coverage line | FAIL 184/368 (pre-existing script-side denominator bug) |
| Full `tests/*.test.js` suite (46 tests in scope) | PASS |
| 2 known pre-fix exploratory tests | FAIL by design (frozen-snapshot tests, expected) |
| `npm run lint` | 0 errors, 0 new warnings |
| Snapshot `tests/__snapshots__/proctor-v2-strict-fairness-coverage.pre-fix.js` | UNCHANGED |
| Source change scope | only `js/algorithms/proctor-distribution-v2.js` |

## Out-of-Scope Items Tracked for Follow-up

1. **Real-centre Coverage shortfall (375/382 — 7 unfilled slots).** Tracked separately. Likely linked to `d_expected_divergence` warning (D_expected=13 vs actual duty pairs=0).
2. **End-to-end script hard-coded denominator bug** (`368` vs actual `184`). Either fix `scripts/verify-end-to-end.js` or update fixture's `proctorsPerRoom` to match docstring.
3. **DB-vs-memory discrepancy** observed by user: distribution renderer shows max=4 in DB while memory shows max=3. Suspected location: `main/ipc/exam-config-data.js` save/load roundtrip OR auto-save in `exams-proctors.html` line ~2749. Tracked as separate spec.

## Closing State

- Bug condition C(X) on real-centre fixture: NO LONGER REPRODUCIBLE.
- All correctness properties (P1, P2, P3) hold on the fixture and on the synthetic suite.
- All preservation properties hold (baseline fixtures unchanged).
- No regressions in the 46 in-scope test files.
- No source changes outside the v2 module.
- Spec is **CLOSED**.
