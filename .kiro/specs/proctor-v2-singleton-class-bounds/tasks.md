# Implementation Plan — Proctor V2 Singleton Eligibility Class Bounds Bugfix

## Source Documents

- `.kiro/specs/proctor-v2-singleton-class-bounds/bugfix.md` — Requirements 1.x (defect), 2.x (expected), 3.x (preservation); Bug Condition `C(X)`, Property `P` (P-1 .. P-5), Preservation goal.
- `.kiro/specs/proctor-v2-singleton-class-bounds/design.md` — Option C (global-fairness floor) selected with rationale; 5 enumerated change sites all inside `computeClassBounds`; 5 new test files specified; scope discipline locked to one function + new test files.
- `docs/agent-notes/proctor-v2-singleton-class-bounds.md` — Investigation context, corrected production-fixture numbers (`totalGuardSlots = 382`, `globalLowerBound = 2`, `feasibleCeiling = 4`), Option C vs Option D evaluation, the witness table for the six impossible canonical-key bounds (294–352), and the recommendation to adopt Option C from the start.

## Project Commands

| Command | Purpose |
|---|---|
| `npm test` | Run full Jest suite (must remain green per Req 3.1, 3.2, 3.3, 3.12) |
| `npm run lint` | ESLint (must produce zero new errors/warnings per Req 3.11) |
| `node scripts/verify-fixture.js tests/fixtures/45454.json` | Algorithm-level P1/P2/P3 verification on production fixture (Req 3.4) |
| `node scripts/verify-real-centre.js` | Algorithm-level P1/P2/P3 verification on real-centre fixture (Req 3.5) |
| `node scripts/inspect-fixture-state.js` | Diagnostic snapshot — pre-fix shows `min: 1` and `coverageRepairUnresolved: 6`; post-fix must show `min ≥ 2` and `coverageRepairUnresolved ≤ 1` |

## Atomicity

Every leaf task is sized to ≤ 1 hour of focused work. Parent tasks (1, 2, 4, 5, 6) decompose into atomic sub-tasks where the work spans more than one observation/edit.

## Annotation Legend

| Annotation | Meaning |
|---|---|
| `_Bug_Condition:` | Reference to `isBugCondition(X)` from design.md §"Bug Details" |
| `_Expected_Behavior:` | Reference to design.md §"Correctness Properties" (Property 1 Bug Condition, Property 2 Preservation) |
| `_Preservation:` | Reference to design.md §"Preservation Requirements" |
| `_Change site:` | Numbered change site (1–5) from design.md §"Fix Implementation" → "Specific Changes" |
| `_File:` | Concrete file path the executor will touch |
| `_Requirements:` | Clause numbers from `bugfix.md` (1.x defect / 2.x expected / 3.x preservation) |

## Scope Boundaries (CRITICAL — from design.md)

- ✅ In scope: `js/algorithms/proctor-distribution-v2.js` (single function `computeClassBounds` ≈ lines 542–615); 5 new test files; the parent spec's exploration and fix-checking tests flip FAIL→PASS unmodified as a consequence.
- ❌ Out of scope: `computeEligibilityClasses`, `getGuardSlotsForScheduleIndex`, `serializeClassBounds`, `collectUncovered`, `phase2_75CoverageRepair` (the parent spec's inner repair loop and diagnostics-shape migration stay as-is), `applyCoverageSwap`, `buildSwapCandidates`, `swapPreservesHardConstraints`, `violatesHardConstraints`, `getProctorKey`, `getProctorExemptionKey`, the duty pre-pass, `phase2Build`, `phase2_5PopulateReserves`, `applyReserveSwap`, `phase3Optimize`, the orchestrator, IPC handlers, DB migrations, `js/data/proctor-key-resolver.js`, the display layer.
- 5 change sites total (per design.md): `LB_global` derivation at top of `computeClassBounds` (#1, primary), per-class cap with monotonicity guard in the multi-class fallback branch (#2, primary), only-one-class branch preservation (#3, no-op verification), `gById`/`dShareById`/iteration-order preservation (#4, no-op verification), out-of-scope sites preservation (#5, no-op verification).

---

## Tasks

- [x] 1. Write bug condition exploration property test (BEFORE fix)
  - **Property 1: Bug Condition** — Singleton and Small-Class Bounds Exceed Global Fairness Floor
  - **CRITICAL**: This test MUST FAIL on unfixed code (F) — failure confirms the bug exists.
  - **DO NOT attempt to fix the test or the code when it fails.**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation (re-used in Task 5.4 verification).
  - **GOAL**: Surface counterexamples that demonstrate `isBugCondition(X)` fires on (a) a synthetic singleton-with-G=10 input, (b) a synthetic non-singleton with `bTotal/bSize > LB_global`, and (c) the production fixture with the six known canonical-key impossible bounds.
  - **Scoped PBT Approach**: This is a deterministic bug — scope the property to concrete failing cases (synthetic inputs constructed deterministically + the fixed production fixture). Reproducibility is guaranteed by the fixed inputs.

  - [x] 1.1 Write `tests/proctor-v2-singleton-class-bounds-exploration.test.js` — synthetic singleton-with-G=10 case
    - **Property 1: Bug Condition** — Synthetic Singleton Class Has `classLowerBound > LB_global + 1`
    - Create `tests/proctor-v2-singleton-class-bounds-exploration.test.js`.
    - Tag the test header with the comment `// @pre-fix exploratory test — EXPECTED to FAIL on F`.
    - Construct a synthetic input with 5 proctors and a schedule that produces 4 eligibility classes of sizes {2, 2, 2, 1}. The singleton class member has wide row eligibility — reachable across exactly 10 schedule entries (guard slots = 10). Total `totalGuardSlots = 25`, `D_expected = 0`, `N_eligible = 5`, so `LB_global = floor(25/5) = 5`. The singleton's pre-fix `classLowerBound = floor(10/1) = 10 > LB_global + 1 = 6`.
    - Run `ProctorDistributionV2.run(input)` in a Node-only harness (no IPC, no DB) using the existing module-loading idiom from `tests/proctor-v2-property-p1-fairness.test.js` or the `vm` sandbox idiom from `scripts/inspect-fixture-state.js` lines 6–13.
    - Assert pre-fix: the singleton's canonical-key entry in `R_mem.classBoundsByProctorKey` has `classLowerBound = 10`. The multi-member class entries have `classLowerBound = 5` each (already `≤ LB_global`).
    - Encode the universal post-fix assertion: every per-class `classLowerBound ≤ LB_global + 1 = 6`. Pre-fix this assertion FAILS for the singleton — that failure is the counterexample.
    - Run on UNFIXED code.
    - **EXPECTED OUTCOME on F**: Test FAILS — counterexample logged showing the singleton at `classLowerBound = 10`. This refutes possible alternative root causes (the parent spec's inner repair loop, Phase 3 SA, the diagnostics-shape migration) by isolating the bounds-derivation problem in `computeClassBounds`.
    - Mark sub-task complete when test is written, run, and failure is documented.
    - _Bug_Condition: isBugCondition(X) per design.md §"Bug Condition" — synthetic singleton case_
    - _Expected_Behavior: Property 1 — P-1, P-2 (cap by LB_global)_
    - _File: tests/proctor-v2-singleton-class-bounds-exploration.test.js (NEW)_
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.12_

  - [x] 1.2 Add synthetic non-singleton case with `bTotal/bSize > LB_global` to `tests/proctor-v2-singleton-class-bounds-exploration.test.js`
    - **Property 1: Bug Condition** — Non-Singleton Class with Inflated `bTotal/bSize` Also Triggers Cap
    - Append a second test case to the same file (non-singleton case shares the same harness as 1.1).
    - Construct a synthetic input with 4 proctors and 2 eligibility classes of size 2 each. Class A has wide row eligibility (`G = 30`, `bTotal = 30`), class B has narrow eligibility (`G = 10`, `bTotal = 10`). Total `totalGuardSlots = 40`, `D_expected = 0`, `N_eligible = 4`, so `LB_global = floor(40/4) = 10`. Class A's pre-fix `classLowerBound = floor(30/2) = 15 > LB_global + 1 = 11`. Class B's pre-fix `classLowerBound = floor(10/2) = 5 ≤ LB_global` — no cap needed.
    - Assert pre-fix: class A's entries have `classLowerBound = 15`. Class B's entries have `classLowerBound = 5`.
    - Encode the universal post-fix assertion: every per-class `classLowerBound ≤ LB_global + 1 = 11`. Pre-fix this assertion FAILS for class A.
    - Run on UNFIXED code.
    - **EXPECTED OUTCOME on F**: Test FAILS — confirms the bug is not specific to singletons; any class with `floor(bTotal/bSize) > LB_global` triggers it.
    - _Bug_Condition: isBugCondition(X) — synthetic non-singleton case_
    - _Expected_Behavior: Property 1 — cap rule applies uniformly to all classes_
    - _File: tests/proctor-v2-singleton-class-bounds-exploration.test.js (extend)_
    - _Requirements: 1.1, 1.2, 2.1, 2.4_

  - [x] 1.3 Add production-fixture replay case to `tests/proctor-v2-singleton-class-bounds-exploration.test.js`
    - **Property 1: Bug Condition** — Production Fixture Replay (Six Impossible Canonical-Key Bounds)
    - Append a third test case to the same file.
    - Load `tests/fixtures/45454.json` via `JSON.parse(fs.readFileSync(...))`.
    - Run `ProctorDistributionV2.run(input)` in the same Node-only harness.
    - Read `R_mem.classBoundsByProctorKey` for the six known canonical keys (`__idx_98`, `__idx_62`, `__idx_28`, `__idx_133`, `__idx_109`, `__idx_21`).
    - Assert pre-fix: the six keys have `classLowerBound` values of 352, 342, 342, 318, 294, 352 respectively (per the witness table in `docs/agent-notes/proctor-v2-singleton-class-bounds.md`). Compute `LB_global = 2` from the fixture's totals (`totalGuardSlots = 382`, `D_expected = 13`, `N_eligible = 147`).
    - Encode the assertion: post-fix every one of the six keys has `classLowerBound ≤ 3` (LB_global + 1). Pre-fix this assertion FAILS — every value is in 294–352.
    - Run on UNFIXED code.
    - **EXPECTED OUTCOME on F**: Test FAILS with the documented production diagnostic snapshot. Locks the production regression.
    - _Bug_Condition: isBugCondition(X) — production fixture (six singleton classes)_
    - _Expected_Behavior: Property 1 — P-3 (production-fixture pinpoint)_
    - _File: tests/proctor-v2-singleton-class-bounds-exploration.test.js (extend)_
    - _Requirements: 1.5, 1.6, 1.8, 1.9, 2.6, 3.4_

  - [x] 1.4 Run `node scripts/inspect-fixture-state.js` and capture diagnostic snapshot
    - Execute `node scripts/inspect-fixture-state.js` against the production fixture on UNFIXED code.
    - Confirm the script reports: `histogram: {1: 1, 2: 56, 3: 90}` (or `{2: 56, 3: 90}` with `min: 0` if the underlying state regressed further), `min: 1` (or 0), `coverageRepairSwaps: 18` (or 17), `coverageRepairUnresolved: 6`. Also derive `totalGuardSlots = 382`, `LB_global = 2` from the algorithm's diagnostics output (ensure the script's V2 instance produces classBounds that match the agent-notes witness table).
    - Document the captured snapshot inline as a comment block at the top of `tests/proctor-v2-singleton-class-bounds-exploration.test.js` for cross-reference. This is the baseline that Task 6.5 will compare post-fix output against.
    - **EXPECTED OUTCOME**: Diagnostic snapshot matches the values in `docs/agent-notes/proctor-v2-singleton-class-bounds.md` §"Witness on tests/fixtures/45454.json" and §"Update — 2026-05-17". This confirms the test harness is loading the fixture identically to the production-validated investigation.
    - _Bug_Condition: isBugCondition(X) — empirical confirmation_
    - _File: scripts/inspect-fixture-state.js (read-only); test file header comment_
    - _Requirements: 1.5, 1.8, 1.9_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** — Inputs Without Impossible Bounds Are Unchanged
  - **IMPORTANT**: Follow observation-first methodology — observe behavior on F first for each input class, then capture observed behavior in property assertions. These tests establish the baseline that Task 6 will re-run post-fix.

  - [x] 2.1 Write `tests/proctor-v2-singleton-class-bounds-preservation.pbt.test.js` — non-buggy-input PBT
    - **Property 2: Preservation** — Non-Buggy Inputs Produce Identical `classBoundsByProctorKey`
    - Create `tests/proctor-v2-singleton-class-bounds-preservation.pbt.test.js`.
    - Use fast-check (existing PBT framework — see `tests/preservation-config-roundtrip.pbt.test.js` and `tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js` for the import style and seed plumbing) to generate valid inputs filtered to `NOT isBugCondition(input)` (every per-class `floor(bTotal/bSize) ≤ LB_global + 1`).
    - Generators: proctorsList of size 1..30 with synthetic CIN keys; per-proctor schedule eligibility tuned so that no class produces `floor(bTotal/bSize) > LB_global`; rejection-sample inputs that violate the filter.
    - Observation-first: for each generated input, run `ProctorDistributionV2.run(input)` on F and record `result.classBoundsByProctorKey` (serialized via `serializeClassBounds`-equivalent JSON), `result.proctor_keys`, `result.reserve_keys`, `result.diagnostics.coverageRepairWarnings`.
    - Assert pre-fix: every recorded run satisfies `NOT isBugCondition(input)` (filter is correct).
    - Snapshot the recordings keyed by the fast-check seed for one canonical case so Task 6.4 can re-run the same input post-fix and assert byte-equality.
    - Run on UNFIXED code.
    - **EXPECTED OUTCOME on F**: Tests PASS (preservation baseline — confirms `NOT C(X)` inputs produce a stable output that we will preserve post-fix).
    - Mark sub-task complete when tests are written, run, and passing on F.
    - _Bug_Condition: NOT isBugCondition(X) — preservation domain_
    - _Expected_Behavior: Property 2 — observational equivalence on `NOT C(X)` inputs_
    - _File: tests/proctor-v2-singleton-class-bounds-preservation.pbt.test.js (NEW)_
    - _Requirements: 2.3, 2.7, 2.9, 3.6, 3.7, 3.16, 3.17, 3.19, 3.20_

  - [x] 2.2 Write `tests/proctor-v2-singleton-class-bounds-monotonicity.test.js` — one-sided monotonicity + determinism
    - **Property 2: Preservation** — Post-Fix `classLowerBound ≤` Pre-Fix `classLowerBound` (One-Sided Monotonicity)
    - Create `tests/proctor-v2-singleton-class-bounds-monotonicity.test.js`.
    - Cover the four monotonicity-guard branches via hand-crafted unit cases (driven through a direct call to `ProctorDistributionV2.run` with hand-crafted inputs):
      1. `bTotal > LB_global` AND `floor(bTotal/bSize) > LB_global` → cap fires (post-fix `classLowerBound = LB_global`, `classUpperBound = LB_global + 1`).
      2. `bTotal > LB_global` AND `floor(bTotal/bSize) ≤ LB_global` → cap is no-op (post-fix `classLowerBound = floor(bTotal/bSize)`, byte-identical to pre-fix).
      3. `bTotal ≤ LB_global` → monotonicity guard fires (post-fix `classLowerBound = bTotal`, `classUpperBound = bTotal`).
      4. `bTotal = 0` → degenerate (post-fix `classLowerBound = 0`, `classUpperBound = 0`).
    - Add a determinism assertion: replay `tests/fixtures/45454.json` twice; assert `serialize(R1.classBoundsByProctorKey) === serialize(R2.classBoundsByProctorKey)`. Pre-fix this passes (the algorithm is already deterministic for inputs that don't enter the buggy branch). Post-fix this test must still PASS.
    - Run on UNFIXED code.
    - **EXPECTED OUTCOME on F**: Tests PASS for branches 2, 3, 4 (the byte-identical and degenerate cases work pre-fix); branch 1 FAILS (pre-fix the cap doesn't fire). After Task 5 lands, all four branches PASS.
    - Mark sub-task complete when tests are written, run, and the expected outcomes are documented.
    - _Bug_Condition: NOT isBugCondition(X) for branches 2, 3, 4; isBugCondition(X) for branch 1_
    - _Expected_Behavior: Property 2 — one-sided monotonicity (post-fix `classLowerBound ≤` pre-fix); Property 1 — cap fires for branch 1_
    - _File: tests/proctor-v2-singleton-class-bounds-monotonicity.test.js (NEW)_
    - _Requirements: 2.2, 2.4, 3.17, 3.20_

  - [x] 2.3 Establish existing test suite preservation baseline
    - **Property 2: Preservation** — Existing Test Suite Is Green on F (Modulo the Two Known Failures)
    - Run `npm test` against UNFIXED code and record the full pass/fail count.
    - Verify these test files all pass on F:
      - All `tests/proctor-v2-*.test.js` (Req 3.1) — except `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js` and `tests/proctor-v2-phase2-75-multi-step-fix.test.js` which are the documented FAILING tests (parent spec) that this bugfix flips to PASSING (Req 3.12, 3.22).
      - All `tests/inv-h5-*.test.js` (Req 3.2 — including `inv-h5-cross-page-consistency.test.js`).
      - `tests/preservation-config-roundtrip.pbt.test.js` (Req 3.3).
      - The parent spec's `tests/proctor-v2-phase2-75-multi-step-warnings-shape.test.js`, `tests/proctor-v2-phase2-75-multi-step-determinism.test.js`, and `tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js` (Req 3.10, 3.21).
    - Run `npm run lint` against UNFIXED code and record the warning/error count (Req 3.11 baseline).
    - Document the baseline (test count, lint count, the two expected failing tests, date) as a comment block at the top of `tests/proctor-v2-singleton-class-bounds-preservation.pbt.test.js` for cross-reference in Task 6.
    - **EXPECTED OUTCOME on F**: All listed tests PASS except `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js` and `tests/proctor-v2-phase2-75-multi-step-fix.test.js` (which fail on the production fixture's impossible bounds). Lint count is the regression threshold for Task 6.7.
    - Mark sub-task complete when baseline is recorded.
    - _Bug_Condition: NOT isBugCondition(X) — preservation baseline_
    - _Expected_Behavior: Property 2 — full suite + lint green (modulo the two known failures)_
    - _Preservation: Req 3.1, 3.2, 3.3, 3.10, 3.11, 3.21_
    - _File: tests/proctor-v2-singleton-class-bounds-preservation.pbt.test.js (file header comment)_
    - _Requirements: 3.1, 3.2, 3.3, 3.10, 3.11, 3.12, 3.21, 3.22_

- [x] 3. Write fix-checking property tests (BEFORE implementing fix)
  - **Property 1: Bug Condition** — Cap Holds on All Buggy Inputs
  - **NOTE**: This test specifies the post-fix universal property — for every input where `isBugCondition(X)` fires, the post-fix algorithm caps every per-class `classLowerBound` at `LB_global + 1`. Pre-fix the FOR ALL universal property FAILS (the production fixture and the synthetic singleton/non-singleton cases counter-example it). Post-fix it PASSES.
  - Create `tests/proctor-v2-singleton-class-bounds-fix.test.js`.
  - Tag the test header `// @pre-fix property test — EXPECTED to FAIL on F until change site #1 + #2 land`.
  - Use the existing fast-check generators (mirror `tests/proctor-v2-singleton-class-bounds-preservation.pbt.test.js` from Task 2.1 generators) to produce inputs filtered to `isBugCondition(input) = true` (rejection-sample on the filter). Cover both the singleton (size-1) and small-class (size-2 with `bTotal/bSize > LB_global`) branches.
  - For each generated input, assert (per design.md §"Fix Checking" pseudocode):
    1. For every proctor with a `classBoundsByProctorKey` entry: `bounds.classLowerBound ≤ LB_global + 1` AND `bounds.classUpperBound ≤ LB_global + 1` AND `bounds.classUpperBound ≥ bounds.classLowerBound`.
    2. For every class entry returned by `computeClassBounds` directly (testing the function output as a `Map`): the cap holds.
    3. For inputs where the parent spec's repair pass fires post-fix: `coverageRepairWarnings` map's non-`__pass__` entry count equals `diagnostics.coverageRepairUnresolved` (preserves parent spec's identity).
  - Hard-coded production-fixture pinpoint case: replay `tests/fixtures/45454.json`, assert each of the six canonical keys (`__idx_98`, `__idx_62`, `__idx_28`, `__idx_133`, `__idx_109`, `__idx_21`) has `classLowerBound ≤ 3`, assert `min(loadState) ≥ 2`, assert `coverageRepairUnresolved ≤ 1` (per Property P-3).
  - Hard-coded synthetic singleton case: replay Task 1.1's input, assert the singleton's `classLowerBound = 5` post-fix (capped from pre-fix 10) and `classUpperBound = 5` (or `= LB_global + 1 = 6` if the upper-bound algebra yields the slack).
  - Hard-coded synthetic non-singleton case: replay Task 1.2's input, assert class A's `classLowerBound = 10` post-fix (capped from pre-fix 15) and class B's `classLowerBound = 5` (unchanged).
  - Run on UNFIXED code.
  - **EXPECTED OUTCOME on F**: Tests FAIL — the universal cap property is counter-exampled by the singleton and non-singleton-with-large-bTotal branches. This locks the property that change site #1 + #2 (Task 5) must satisfy.
  - _Bug_Condition: isBugCondition(X) — fix-checking universal property_
  - _Expected_Behavior: Property 1 — P-1, P-2, P-3 (cap by `LB_global` + production pinpoint)_
  - _File: tests/proctor-v2-singleton-class-bounds-fix.test.js (NEW)_
  - _Change site: #1 (LB_global derivation), #2 (cap with monotonicity guard)_
  - _Requirements: 2.1, 2.2, 2.4, 2.6, 2.8, 2.13_

- [x] 4. Write integration test with parent spec's exploration and fix tests (BEFORE implementing fix)
  - **Property 1: Bug Condition** — Parent Spec's Currently-Failing Tests Flip to Passing After This Fix
  - Create `tests/proctor-v2-singleton-class-bounds-integration.test.js`.
  - Tag the test header `// @pre-fix integration test — EXPECTED to FAIL on F (parent spec's tests still fail)`.
  - Cover three integration cases:
    1. **Parent spec's exploration test passes post-fix on production fixture**: verify that the same assertion machinery used by `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js` test case 3 (production fixture replay — `min ≥ 2`, طارق NOT in zero-load set, `coverageRepairUnresolved = 0`) passes after this bugfix lands. Pre-fix it FAILS (`min = 1`, طارق at `load = 1`, `coverageRepairUnresolved = 6`).
    2. **Parent spec's fix-checking test passes post-fix on production fixture**: verify the same assertion machinery used by `tests/proctor-v2-phase2-75-multi-step-fix.test.js` (production fixture pinpoint) passes post-fix. Pre-fix it FAILS for the same reason.
    3. **Parent spec's synthetic deficit-2 / deficit-3 cases unchanged**: replay the parent spec's synthetic deficit-2 (Task 1.1 of parent spec) and deficit-3 (Task 1.2 of parent spec) inputs and confirm they continue to behave as designed — those inputs do not trigger this spec's bug condition (no singleton class with `G_class > LB_global`), so the post-fix algorithm produces identical output to the parent-spec's expected behavior.
  - Run on UNFIXED code.
  - **EXPECTED OUTCOME on F**: Cases 1 and 2 FAIL (parent spec's tests still fail because the deeper bug is unfixed). Case 3 PASSES (parent-spec synthetic inputs are unaffected by this spec's fix). Post-fix all three cases PASS.
  - _Bug_Condition: isBugCondition(X) — integration with parent spec_
  - _Expected_Behavior: Property 1 — parent-spec integration; Property 2 — parent-spec synthetic preservation_
  - _File: tests/proctor-v2-singleton-class-bounds-integration.test.js (NEW)_
  - _Requirements: 3.10, 3.12, 3.21, 3.22, 3.23_

- [x] 5. Apply Change Site #1 + #2 — `LB_global` derivation + cap with monotonicity guard in `computeClassBounds` (CRITICAL PRIMARY CHANGE)
  - **Property 1: Bug Condition** — Caps every per-class lower bound at the global fairness floor
  - This is the primary fix. Per design.md §"Fix Strategy: Option C — Global-Fairness Floor", insert the `LB_global` derivation at the top of `computeClassBounds` and apply the cap with monotonicity guard inside the multi-class fallback branch.

  - [x] 5.1 Locate `computeClassBounds` and the multi-class fallback branch
    - Open `js/algorithms/proctor-distribution-v2.js`.
    - Locate `function computeClassBounds(...)` at ≈ line 542 (search for `function computeClassBounds`).
    - Locate the early-return guard at ≈ line 547 (`if (classIds.length === 0) return bounds;`).
    - Locate the only-one-class branch at ≈ lines 561–574 (the `if (classIds.length === 1) {` block).
    - Locate the multi-class fallback branch's per-class emission loop at ≈ lines 595–614 (the `for (var bi = 0; bi < classIds.length; bi++) {` block emitting `bounds.set(bId, ...)`).
    - Confirm the surrounding context: `gById` precomputation (lines 549–559), `dShareById` distribution (lines 576–594), `getGuardSlotsForScheduleIndex` (lines 532–540, called only inside `gById` precomputation).
    - Confirm callers: `run` at ≈ line 1937 passes `(eligibilityClasses, scheduleEntries, proctorsPerRoom, Number(input.D_expected) || 0, eligibleCountForBounds, guardSlotsByIndex)`.
    - No code changes in this sub-task — just locate and confirm scope before editing.
    - _File: js/algorithms/proctor-distribution-v2.js (read-only locate)_
    - _Change site: #1 + #2 (primary)_
    - _Requirements: 2.1, 2.5, 2.7, 2.11_

  - [x] 5.2 Insert `LB_global` derivation at the top of `computeClassBounds`
    - Per design.md §"Specific Changes" point 1, insert the `totalGuardSlots` and `lbGlobal` derivation between the early-return guard (line 547) and the `gById` precomputation (line 549).
    - Implementation:
      ```js
      var totalGuardSlots = 0;
      var entries = scheduleEntries || [];
      for (var ti = 0; ti < entries.length; ti++) {
        totalGuardSlots += getGuardSlotsForScheduleIndex(
          scheduleEntries, ti, proctorsPerRoom, guardSlotsByIndex
        );
      }
      var lbGlobal = eligibleCount > 0
        ? Math.floor((totalGuardSlots + expectedDuty) / eligibleCount)
        : 0;
      ```
    - Add a comment block above the new code documenting Option C's formula and the rationale (cite the agent-notes recommendation and the only-one-class-branch alignment).
    - Preserve `var`-based ES2019 style. NO `let`/`const`/arrow functions.
    - DO NOT modify the only-one-class branch — it is preserved unchanged per design.md §"Specific Changes" point 3.
    - DO NOT modify `gById` or `dShareById` precomputation — they are reused unchanged per design.md §"Specific Changes" point 4.
    - Run `npm run lint` — must produce zero new errors/warnings vs Task 2.3 baseline.
    - **EXPECTED OUTCOME**: `lbGlobal` is now in scope for the multi-class fallback branch. No behavior change yet (the variable is unused until Task 5.3).
    - _Bug_Condition: isBugCondition(X) — global fairness floor introduced_
    - _Expected_Behavior: design.md §"Specific Changes" point 1 (LB_global derivation)_
    - _Change site: #1_
    - _File: js/algorithms/proctor-distribution-v2.js (`computeClassBounds`, top-of-function insertion)_
    - _Requirements: 2.1, 2.5, 2.7, 2.13_

  - [x] 5.3 Apply the cap with monotonicity guard inside the multi-class fallback branch
    - Per design.md §"Specific Changes" point 2, replace the per-class emission loop body in the multi-class fallback branch (≈ lines 595–614) with the cap+guard logic.
    - Replace the `bounds.set(bId, { classLowerBound: Math.floor(bTotal / bSize), classUpperBound: Math.ceil(bTotal / bSize), G_class: bG, D_expected_class: bD });` emission with:
      ```js
      var rawLower = Math.floor(bTotal / bSize);
      var rawUpper = Math.ceil(bTotal / bSize);
      var cappedLower, cappedUpper;
      if (bTotal <= lbGlobal) {
        // Monotonicity guard — never raise a class's lower bound above its
        // achievable total. Fires for tiny classes (G_class = 0, or
        // bTotal < lbGlobal). Preserves pre-fix behavior exactly for the
        // degenerate case.
        cappedLower = bTotal;
        cappedUpper = bTotal;
      } else {
        // Cap rule (Option C — global-fairness): clamp rawLower DOWN to
        // lbGlobal when rawLower exceeds it. The upper bound is allowed
        // up to lbGlobal + 1 (matching the ceil/floor pair of the
        // only-one-class branch when divisibility fails).
        cappedLower = Math.min(rawLower, lbGlobal);
        cappedUpper = Math.max(cappedLower, Math.min(rawUpper, lbGlobal + 1));
      }
      bounds.set(bId, {
        classLowerBound: cappedLower,
        classUpperBound: cappedUpper,
        G_class: bG,
        D_expected_class: bD
      });
      ```
    - Add an explanatory comment block above the cap logic citing design.md §"Specific Changes" point 2 and the algebraic properties listed there.
    - Preserve `var`-based ES2019 style.
    - DO NOT modify the only-one-class branch — it is preserved unchanged.
    - DO NOT modify `gById`, `dShareById`, the residual-distribution logic, or class iteration order.
    - Run `npm run lint` — zero new warnings.
    - Run Task 1's exploration tests — synthetic singleton and non-singleton cases should now PASS (cap fires correctly); production-fixture case should also PASS.
    - **EXPECTED OUTCOME**: Cap fires on the singleton in Task 1.1, the non-singleton class A in Task 1.2, and the six canonical keys in Task 1.3. The production fixture's `min` rises from 1 to ≥ 2.
    - _Bug_Condition: isBugCondition(X) — cap applied uniformly_
    - _Expected_Behavior: design.md §"Specific Changes" point 2 (cap with monotonicity guard)_
    - _Preservation: design.md §"Preservation Requirements" (no-op when `floor(bTotal/bSize) ≤ lbGlobal`)_
    - _Change site: #2 (CRITICAL primary)_
    - _File: js/algorithms/proctor-distribution-v2.js (`computeClassBounds` ≈ lines 595–614)_
    - _Requirements: 2.1, 2.2, 2.4, 2.7, 2.9, 2.11, 2.13_

  - [x] 5.4 Verify Change Sites #3, #4, #5 — preservation of out-of-scope sites (no-op verification)
    - Per design.md §"Specific Changes" points 3, 4, 5, the only-one-class branch (lines 561–574), `gById` / `dShareById` / class iteration order, and out-of-scope sites are all UNCHANGED.
    - Read-only verification: confirm via `grep_search` or `read_file` that the edits in Tasks 5.2 and 5.3 did NOT alter:
      - The only-one-class branch (lines 561–574 — `if (classIds.length === 1) { ... return bounds; }`).
      - The `gById` Map-population loop (lines 549–559).
      - The `dShareById` distribution and `residualOrder` logic (lines 576–594).
      - The class iteration order: `Array.from(classes ? classes.keys() : []).sort()` at line 544.
      - `computeEligibilityClasses`, `getGuardSlotsForScheduleIndex`, `serializeClassBounds`, `collectUncovered`, `phase2_75CoverageRepair`, and all other functions listed in design.md §"Out-of-Scope (Explicit)".
    - Run Task 2.2's monotonicity test (branch 2 — cap is no-op when `floor(bTotal/bSize) ≤ lbGlobal`) — must PASS post-fix (preservation holds).
    - **EXPECTED OUTCOME**: Out-of-scope sites are unchanged by construction; the test confirms preservation empirically.
    - _Preservation: design.md §"Specific Changes" points 3, 4, 5 (preservation of out-of-scope sites)_
    - _Change site: #3, #4, #5 (no-op verification)_
    - _File: js/algorithms/proctor-distribution-v2.js (read-only verification)_
    - _Requirements: 2.3, 3.6, 3.7, 3.8, 3.9, 3.10, 3.17, 3.19, 3.20_

- [ ] 6. Verify all exploration, preservation, fix-checking, and integration tests pass post-fix
  - **Property 1: Expected Behavior** — Bug Condition Inputs Now Satisfy the Cap; Property 2: Preservation — Non-Buggy Inputs Are Unchanged
  - **IMPORTANT**: Re-run the SAME tests from Tasks 1, 2, 3, 4 — do NOT write new tests. The tests written before the fix encode the expected behavior; when they pass, they confirm the fix is correct.

  - [x] 6.1 Verify Task 1's exploration tests now pass
    - **Property 1: Expected Behavior** — Singleton and Small-Class Bounds Are Capped
    - Re-run `tests/proctor-v2-singleton-class-bounds-exploration.test.js` (all three test cases — synthetic singleton, synthetic non-singleton, production fixture).
    - **EXPECTED OUTCOME**: All three test cases PASS — every per-class `classLowerBound ≤ LB_global + 1`, the production fixture's six canonical keys are capped at 3, and `min(loadState) ≥ 2`.
    - _Requirements: Property 1 from design.md §"Correctness Properties" (Bug Condition closure)_

  - [x] 6.2 Verify Task 2.1's preservation PBT still passes
    - **Property 2: Preservation** — Non-Buggy Inputs Produce Identical `classBoundsByProctorKey`
    - Re-run `tests/proctor-v2-singleton-class-bounds-preservation.pbt.test.js`.
    - **EXPECTED OUTCOME**: Tests PASS — confirms no regressions on inputs filtered to `NOT isBugCondition(input)`.
    - _Requirements: Property 2 from design.md §"Correctness Properties" (Preservation)_

  - [x] 6.3 Verify Task 2.2's monotonicity test now passes for all four branches
    - **Property 2: Preservation** — One-Sided Monotonicity + Determinism
    - Re-run `tests/proctor-v2-singleton-class-bounds-monotonicity.test.js`.
    - **EXPECTED OUTCOME**: All four branches PASS (branch 1 — cap fires; branches 2, 3, 4 — preservation holds). Determinism assertion across two runs of the production fixture passes.
    - _Requirements: Property 1 + Property 2 — cap fires for buggy classes, preservation for non-buggy classes, determinism preserved_

  - [x] 6.4 Verify Task 3's fix-checking property tests now pass
    - **Property 1: Expected Behavior** — Universal Cap Holds on All Buggy Inputs
    - Re-run `tests/proctor-v2-singleton-class-bounds-fix.test.js`.
    - **EXPECTED OUTCOME**: Tests PASS — universal cap property holds on every buggy input; production-fixture pinpoint asserts pass; synthetic singleton and non-singleton cases produce expected post-fix values.
    - _Requirements: Property 1 — cap by LB_global on all buggy inputs_

  - [x] 6.5 Verify Task 4's integration tests now pass
    - **Property 1: Expected Behavior** + **Property 2: Preservation** — Parent Spec Tests Flip to Passing
    - Re-run `tests/proctor-v2-singleton-class-bounds-integration.test.js`.
    - **EXPECTED OUTCOME**: All three integration cases PASS — parent spec's exploration test passes on production fixture, parent spec's fix-checking test passes on production fixture, parent spec's synthetic deficit-2 / deficit-3 cases unchanged.
    - Also re-run the parent spec's tests directly to confirm:
      - `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js` — all three test cases PASS post-fix.
      - `tests/proctor-v2-phase2-75-multi-step-fix.test.js` — all assertions PASS post-fix.
    - _Requirements: 3.10, 3.12, 3.21, 3.22, 3.23 — parent-spec integration_

  - [x] 6.6 Run inspector script and confirm post-fix diagnostic snapshot
    - Execute `node scripts/inspect-fixture-state.js` against the production fixture on FIXED code.
    - Confirm the script reports: `histogram` with no entries below 2 (e.g. `{2: ?, 3: ?}`), `min ≥ 2`, `distinct: 147`, `coverageRepairSwaps`-and-`coverageRepairUnresolved` such that `coverageRepairUnresolved ≤ 1` (zero in the typical case where the inner repair loop succeeds for طارق given the corrected bounds). The six false-positive `__idx_*` warnings are absent.
    - Compare the post-fix snapshot against the pre-fix baseline captured in Task 1.4. Document the diff inline.
    - **EXPECTED OUTCOME**: Post-fix snapshot satisfies the production-fixture pinpoint assertions from Property 1 P-3.
    - _Requirements: 1.5, 1.6, 1.9, 2.6, 3.4_

  - [ ] 6.7 Run full test suite + lint and confirm no regressions
    - Run `npm test` — every test from the closed specs (`proctor-v2-fairness-undercovered-fix`, `proctor-v2-key-shape-unification`, `proctor-distribution-db-memory-mismatch`, `proctor-v2-strict-fairness-coverage`) and the parent spec (`proctor-v2-phase2-75-multi-step-repair`) PASSES. The two parent-spec tests that were FAILING pre-fix (`tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js` and `tests/proctor-v2-phase2-75-multi-step-fix.test.js`) now PASS as a consequence of this bugfix.
    - Run `npm run lint` — zero new errors/warnings vs Task 2.3 baseline.
    - Run `node scripts/verify-fixture.js tests/fixtures/45454.json` — P1/P2/P3 PASS.
    - Run `node scripts/verify-real-centre.js` — P1/P2/P3 PASS.
    - **EXPECTED OUTCOME**: Full suite green, lint clean, both verify scripts PASS, parent-spec FAIL→PASS flip confirmed.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.10, 3.11, 3.12, 3.21, 3.22_

- [ ] 7. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - Confirm that the parent spec's currently-failing tests have flipped to passing, and that the bugfix is locked in by the new test files for `proctor-v2-singleton-class-bounds`.
  - Confirm that the inner-repair-loop and diagnostics-shape contracts from `proctor-v2-phase2-75-multi-step-repair` are observationally unchanged — the repair pass body and warnings map shape were not touched by this bugfix.
