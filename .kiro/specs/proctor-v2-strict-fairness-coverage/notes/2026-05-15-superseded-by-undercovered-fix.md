# Status — 2026-05-15: Production Fix Landed via Sibling Spec

## Effective state

The 44/70 completed tasks in this spec landed the architecture for
per-class fairness bounds, the `phase2_75CoverageRepair` pass, and the
helpers `collectUncovered` / `buildSwapCandidates` / `applyCoverageSwap`.
That architecture is correct.

The strict-zero predicate inside `collectUncovered` was a transcription
error from design.md §3.4 ("uncovered eligible proctors" was implemented
as `load === 0` instead of `load < classLowerBound`). On the user's
real-centre data this caused 25 proctors to remain below the bound after
Phase 2.75 — bug condition C2 of the sibling spec
`proctor-v2-fairness-undercovered-fix`.

The sibling spec **`proctor-v2-fairness-undercovered-fix`** delivered the
production fix on 2026-05-15:

- Predicate corrected to `< classLowerBound`.
- Fixed-point outer loop wrapping the per-uncovered iteration so a proctor
  lifted from load=0 to load=1 keeps being lifted until they reach
  `classLowerBound`.
- Phase 3 lower-bound guard inside `violatesHardConstraints` so SA cannot
  drop any proctor below `classLowerBound`.
- One-line orchestrator plumbing of `classBoundsByProctorKey` onto `input`
  before `phase3Optimize`.

See `.kiro/specs/proctor-v2-fairness-undercovered-fix/notes/2026-05-15-delivered.md`
for the verification numbers.

## Remaining tasks in THIS spec (26)

The remaining tasks are Phase G (UI panel labels for new diagnostics)
and Phase H (PBT + integration tests + risk register coverage). They do
NOT change algorithm behavior. Per user decision (option 🅰️ on
2026-05-15), they are deferred — the live behavior on real-centre is
the canonical correctness check, supplemented by the three test files
added by the sibling spec:

- `tests/proctor-v2-fairness-undercovered-exploration.test.js`
- `tests/proctor-v2-fairness-undercovered-preservation.test.js`
- `tests/proctor-v2-fairness-undercovered-collect-unit.test.js`

These three files supersede tasks 38–46 of THIS spec for the live
correctness guarantee on the user's data.

## When to revisit

Reopen these tasks if:

- A new bug surfaces in production that the three new test files do not
  catch.
- Test coverage policy is enforced repo-wide and PBT files are required
  for every algorithm spec.
- The diagnostics panel UI (`v2-diagnostics-body`) is rebuilt and the
  new fields (`coverageRepairSwaps`, `coverageRepairUnresolved`,
  `eligibilityClassCount`, `maxPrimaryLoadGapWithinClass`) need
  surfacing — this is the lightweight Phase G work.
