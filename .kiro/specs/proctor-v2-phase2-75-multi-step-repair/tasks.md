# Implementation Plan — Proctor V2 Phase 2.75 Multi-Step Coverage Repair (Bugfix)

## Source Documents

- `.kiro/specs/proctor-v2-phase2-75-multi-step-repair/bugfix.md` — Requirements 1.x (defect), 2.x (expected), 3.x (preservation); Bug Condition `C(X)`, Property `P` (P-1, P-2, P-3, P-4), Preservation goal.
- `.kiro/specs/proctor-v2-phase2-75-multi-step-repair/design.md` — Option A (inner repair loop) selected with rationale; 5 enumerated change sites in `js/algorithms/proctor-distribution-v2.js`; 5 new test files specified; scope discipline locked to one function + one orchestrator one-liner + new test files.
- `.agent/proctor-v2-phase2-75-multi-step-repair.md` — Investigation context, devtools-confirmed evidence, root-cause trace through `phase2_75CoverageRepair`, the production fixture diagnostic snapshot, and the failing exploration test.

## Project Commands

| Command | Purpose |
|---|---|
| `npm test` | Run full Jest suite (must remain green per Req 3.1, 3.2, 3.3, 3.12) |
| `npm run lint` | ESLint (must produce zero new errors/warnings per Req 3.11) |
| `node scripts/verify-fixture.js tests/fixtures/45454.json` | Algorithm-level P1/P2/P3 verification on production fixture (Req 3.4) |
| `node scripts/verify-real-centre.js` | Algorithm-level P1/P2/P3 verification on real-centre fixture (Req 3.5) |
| `node scripts/inspect-fixture-state.js` | Diagnostic snapshot — pre-fix shows `zero-load proctors: 1`; post-fix must show `0` |

## Atomicity

Every leaf task is sized to ≤ 1 hour of focused work. Parent tasks (1, 2, 5, 6, 7, 8) decompose into atomic sub-tasks where the work spans more than one observation/edit.

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

- ✅ In scope: `js/algorithms/proctor-distribution-v2.js` (single function `phase2_75CoverageRepair` ≈ line 3069 + one-line orchestrator fallback default at ≈ line 4358); 5 new test files; the existing exploration test file flips FAIL→PASS unmodified.
- ❌ Out of scope: DB schema (Req 3.13), IPC contract (Req 3.14), display layer, `js/data/proctor-key-resolver.js`, `collectUncovered`, `applyCoverageSwap`, `buildSwapCandidates`, `swapPreservesHardConstraints`, `violatesHardConstraints`, `getProctorKey`, `getProctorExemptionKey`, the duty pre-pass, `phase2Build`, `phase2_5PopulateReserves`, `applyReserveSwap`, `phase3Optimize`.
- 5 change sites total (per design.md): inner repair loop (#1, primary), diagnostics shape migration (#2), `coverageRepairUnresolved` re-derivation (#3), determinism contract preservation (#4, no-op verification), orchestrator one-line fallback default `|| []` → `|| {}` (#5).

---

## Tasks

- [x] 1. Write bug condition exploration tests (BEFORE fix)
  - **Property 1: Bug Condition** — Multi-Step Deficit Cannot Be Repaired by Single-Swap Pass
  - **CRITICAL**: These tests MUST FAIL on unfixed code (F) — failure confirms the bug exists.
  - **DO NOT attempt to fix the test or the code when it fails.**
  - **NOTE**: These tests encode the expected behavior — they will validate the fix when they pass after implementation (re-used in Task 6.6 and Task 7.4).
  - **GOAL**: Surface counterexamples that demonstrate `isBugCondition(X)` fires on (a) synthetic deficit-2, (b) synthetic deficit-3, (c) the production fixture.
  - **Scoped PBT Approach**: This is a deterministic bug — scope the property to concrete failing cases (synthetic deficit-D inputs constructed deterministically, plus the fixed production fixture). Reproducibility is guaranteed by the fixed inputs.

  - [x] 1.1 Write `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js` — synthetic deficit-2 unit case
    - **Property 1: Bug Condition** — Synthetic Deficit-2 Proctor Stays Below `classLowerBound`
    - Create `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js`.
    - Tag the test header with the comment `// @pre-fix exploratory test — EXPECTED to FAIL on F`.
    - Construct a synthetic input with 4 proctors all under `classLowerBound = 2`, `classUpperBound = 3`, no exemptions, no duty constraints. Phase 2 must yield one proctor at `getPrimaryLoad = 0` and three peers at `getPrimaryLoad = 3` (max). The over-loaded peers serve as donors.
    - Run `ProctorDistributionV2.run(input)` in a Node-only harness (no IPC, no DB) using the existing module-loading idiom from `tests/proctor-v2-property-p1-fairness.test.js` or the `vm` sandbox idiom from `scripts/verify-real-centre.js` lines 12–22.
    - Assert pre-fix: `coverageRepairSwaps = 1`, the deficit-2 proctor at `getPrimaryLoad = 1` (still uncovered, only one swap fired), `coverageRepairUnresolved >= 1`.
    - Encode the universal assertion that closes the bug condition: for the deficit-2 proctor, `getPrimaryLoad(loadState, key) >= classLowerBound` post-fix. Pre-fix this assertion FAILS — that failure is the counterexample.
    - Run on UNFIXED code.
    - **EXPECTED OUTCOME on F**: Test FAILS — counterexample logged showing the deficit-2 proctor at load 1, single swap fired, `coverageRepairUnresolved = 1`. This refutes possible alternative root causes (donor-eligibility, exemption interaction) by isolating the single-swap-per-round structural limitation.
    - Mark sub-task complete when test is written, run, and failure is documented.
    - _Bug_Condition: isBugCondition(X) per design.md §"Bug Condition" — synthetic deficit-2 case_
    - _Expected_Behavior: Property 1 — P-1, P-2 (multi-step closure)_
    - _File: tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js (NEW)_
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.4, 2.12_

  - [x] 1.2 Add synthetic deficit-3 unit case to `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js`
    - **Property 1: Bug Condition** — Synthetic Deficit-3 Proctor Stays Below `classLowerBound`
    - Append a second test case to the same file (deficit-3 case shares the same harness as 1.1).
    - Construct a pathological class-bounds config where one proctor needs 3 swaps (`classLowerBound = 3`, deficit-3 proctor at `getPrimaryLoad = 0`, three over-loaded peers each with one donatable slot at distinct rows).
    - Assert pre-fix: at most 1 swap fires for the deficit-3 proctor, `getPrimaryLoad <= 1`, `coverageRepairUnresolved >= 1`.
    - Encode the universal assertion: post-fix `getPrimaryLoad >= classLowerBound = 3`. Pre-fix this assertion FAILS.
    - Run on UNFIXED code.
    - **EXPECTED OUTCOME on F**: Test FAILS — confirms the structural limit is independent of `D` (it caps at one swap per pending proctor regardless of deficit).
    - _Bug_Condition: isBugCondition(X) — synthetic deficit-3 case (theoretical max)_
    - _Expected_Behavior: Property 1 — P-1, P-2_
    - _File: tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js (extend)_
    - _Requirements: 1.1, 1.2, 2.1, 2.4_

  - [x] 1.3 Add production-fixture replay case to `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js`
    - **Property 1: Bug Condition** — Production Fixture Replay (طارق at load=0)
    - Append a third test case to the same file.
    - Load `tests/fixtures/45454.json` via `JSON.parse(fs.readFileSync(...))`.
    - Run `ProctorDistributionV2.run(input)` in the same Node-only harness.
    - Assert pre-fix: `min(loadState) = 0`, exactly one proctor at `getPrimaryLoad = 0` (idx=98 طارق الشعابتي, som=2270221), `coverageRepairUnresolved >= 1`, `coverageRepairSwaps = 17` (the deficit-1 cases all close), histogram contains `{2: 56, 3: 90}` over 146 distinct proctors.
    - Encode the assertion: post-fix `min >= classLowerBound = 2`, طارق NOT in zero-load set, `coverageRepairUnresolved = 0`. Pre-fix FAILS.
    - Run on UNFIXED code.
    - **EXPECTED OUTCOME on F**: Test FAILS with the documented production diagnostic snapshot. Locks the production regression.
    - _Bug_Condition: isBugCondition(X) — production fixture (idx=98 طارق الشعابتي)_
    - _Expected_Behavior: Property 1 — P-3 (production-fixture pinpoint)_
    - _File: tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js (extend)_
    - _Requirements: 1.5, 1.6, 1.8, 1.9, 2.6, 3.4_

  - [x] 1.4 Run `node scripts/inspect-fixture-state.js` and capture diagnostic snapshot
    - Execute `node scripts/inspect-fixture-state.js` against the production fixture on UNFIXED code.
    - Confirm the script reports: `histogram: {2: 56, 3: 90}`, `min: 0`, `distinct: 146`, `zero-load proctors: 1` with entry `idx=98 طارق الشعابتي (som=2270221, dutyCount=1)`, `coverageRepairSwaps: 17`, `coverageRepairUnresolved: 6`.
    - Document the captured snapshot inline as a comment block at the top of `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js` for cross-reference. This is the baseline that Task 7.5 will compare post-fix output against.
    - **EXPECTED OUTCOME**: Diagnostic snapshot matches the values in bugfix.md §"Bug Condition C(X)" → "Diagnostic readings on the same fixture". This confirms the test harness is loading the fixture identically to the production-validated investigation.
    - _Bug_Condition: isBugCondition(X) — empirical confirmation_
    - _File: scripts/inspect-fixture-state.js (read-only); test file header comment_
    - _Requirements: 1.5, 1.8_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** — Deficit-≤1 and Non-Buggy Inputs Are Unchanged
  - **IMPORTANT**: Follow observation-first methodology — observe behavior on F first for each input class, then capture observed behavior in property assertions. These tests establish the baseline that Task 7 will re-run post-fix.

  - [x] 2.1 Write `tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js` — deficit-≤1 PBT
    - **Property 2: Preservation** — Deficit-≤1 Inputs Produce Identical Output
    - Create `tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js`.
    - Use fast-check (existing PBT framework in this repo — see `tests/preservation-config-roundtrip.pbt.test.js` for the import style and seed plumbing) to generate valid inputs filtered to `NOT isBugCondition(input)`.
    - Generators: proctorsList of size 1..30 with synthetic CIN keys; per-proctor `{ classLowerBound: 0..3, classUpperBound: classLowerBound..classLowerBound+2 }`; schedule and exemptions sized so that every uncovered proctor (if any) has deficit exactly 1; rejection-sample inputs that violate the filter.
    - Observation-first: for each generated input, run `ProctorDistributionV2.run(input)` on F and record `result.proctor_keys`, `result.reserve_keys`, `result.diagnostics.coverageRepairSwaps`, `result.diagnostics.coverageRepairUnresolved`, `result.diagnostics.histogram*`.
    - Assert pre-fix: every recorded run satisfies `NOT isBugCondition(input)` (filter is correct) — i.e. `coverageRepairUnresolved = 0` OR every uncovered proctor has deficit exactly 1.
    - Snapshot the recordings keyed by the fast-check seed for one canonical case so Task 7.1 can re-run the same input post-fix and assert byte-equality (modulo additive `diagnostics.coverageRepairWarnings: {}` empty map).
    - Run on UNFIXED code.
    - **EXPECTED OUTCOME on F**: Tests PASS (preservation baseline — confirms `NOT C(X)` inputs produce a stable output that we will preserve post-fix).
    - Mark sub-task complete when tests are written, run, and passing on F.
    - _Bug_Condition: NOT isBugCondition(X) — preservation domain_
    - _Expected_Behavior: Property 2 — observational equivalence on `NOT C(X)` inputs_
    - _File: tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js (NEW)_
    - _Requirements: 2.3, 3.6, 3.7, 3.16, 3.17_

  - [x] 2.2 Write `tests/proctor-v2-phase2-75-multi-step-determinism.test.js` — determinism contract
    - **Property 2: Preservation** — Same Input → Byte-Identical Output Across Two Runs
    - Create `tests/proctor-v2-phase2-75-multi-step-determinism.test.js`.
    - Replay the synthetic deficit-2 input from Task 1.1 twice; assert `R1.proctor_keys ≡ R2.proctor_keys`, `R1.reserve_keys ≡ R2.reserve_keys`, `R1.diagnostics.coverageRepairSwaps = R2.diagnostics.coverageRepairSwaps`. Pre-fix this passes (the algorithm is already deterministic for inputs that don't enter the buggy branch — see clause 3.17).
    - Replay `tests/fixtures/45454.json` twice; same assertions on the partial output (proctor_keys/reserve_keys are deterministic pre-fix even with the bug).
    - Run on UNFIXED code.
    - **EXPECTED OUTCOME on F**: Tests PASS (determinism is a pre-fix invariant). Post-fix this test must still PASS — the inner-loop addition must not introduce non-determinism.
    - Mark sub-task complete when tests are written, run, and passing on F.
    - _Bug_Condition: NOT isBugCondition(X) — determinism preservation_
    - _Expected_Behavior: Property 2 + Property 1 P-4 (determinism contract)_
    - _File: tests/proctor-v2-phase2-75-multi-step-determinism.test.js (NEW)_
    - _Requirements: 3.17_

  - [x] 2.3 Establish existing test suite preservation baseline
    - **Property 2: Preservation** — Existing Test Suite Is Green on F (Modulo the One Known Failure)
    - Run `npm test` against UNFIXED code and record the full pass/fail count.
    - Verify these test files all pass on F:
      - All `tests/proctor-v2-*.test.js` (Req 3.1) — except `tests/proctor-v2-fairness-undercovered-exploration.test.js` which is the documented FAILING test that this spec must flip to PASSING (Req 3.12).
      - All `tests/inv-h5-*.test.js` (Req 3.2 — including `inv-h5-cross-page-consistency.test.js`).
      - `tests/preservation-config-roundtrip.pbt.test.js` (Req 3.3).
    - Run `npm run lint` against UNFIXED code and record the warning/error count (Req 3.11 baseline).
    - Document the baseline (test count, lint count, the one expected failing test, date) as a comment block at the top of `tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js` for cross-reference in Task 7.
    - **EXPECTED OUTCOME on F**: All listed tests PASS except `tests/proctor-v2-fairness-undercovered-exploration.test.js` (which fails on `min = 0`). Lint count is the regression threshold for Task 7.7.
    - Mark sub-task complete when baseline is recorded.
    - _Bug_Condition: NOT isBugCondition(X) — preservation baseline_
    - _Expected_Behavior: Property 2 — full suite + lint green (modulo the one known failure)_
    - _Preservation: Req 3.1, 3.2, 3.3, 3.11_
    - _File: tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js (file header comment)_
    - _Requirements: 3.1, 3.2, 3.3, 3.11, 3.12_

- [x] 3. Write warnings-shape unit test (BEFORE implementing fix)
  - **Property 1: Bug Condition** — Diagnostics Map Shape (post-fix contract)
  - **NOTE**: This test is independent — it specifies the diagnostics-shape contract that change site #2 (Task 5) must satisfy. Pre-fix the assertions FAIL because `coverageRepairWarnings` is still an array. Post-fix all six cases PASS.
  - Create `tests/proctor-v2-phase2-75-multi-step-warnings-shape.test.js`.
  - Tag the test header `// @pre-fix structural test — EXPECTED to FAIL on F until change site #2 lands`.
  - Cover the six structural cases enumerated in design.md §"New Test Files" → file 5:
    1. **Empty warnings on no-uncovered input**: `R_mem.diagnostics.coverageRepairWarnings` is `{}` (a plain object, not an array). Pre-fix it is `[]`; post-fix it is `{}`.
    2. **`no_eligible_donor` reason on synthetic deficit-2 with blocked donors**: build an input where the deficit-2 proctor is exempt from every row containing an over-loaded peer. Assert `coverageRepairWarnings[key]` exists with `reason: 'no_eligible_donor'` AND the full payload `{initialLoad: 0, finalLoad: <= 1, classLowerBound: 2, attemptedSwaps: >= 0}`.
    3. **`no_swappable_peer` reason preserved when `attemptedSwaps = 0`**: build an input where the deficit-1 proctor cannot find a peer at all. Assert `coverageRepairWarnings[key].reason = 'no_swappable_peer'` AND `attemptedSwaps = 0`.
    4. **`__pass__` synthetic key on pass-throws**: mock `buildSwapCandidates` (or one of its callees) to throw mid-pass. Assert the catch handler returns `warnings: { '__pass__': { reason: 'pass_threw', error: <err> } }` (per design.md §"Specific Changes" point 2 line "The error-path return on line 3148 ... becomes ... `__pass__` synthetic key").
    5. **`coverageRepairUnresolved` identity post-fix**: assert `R_mem.diagnostics.coverageRepairUnresolved = Object.keys(R_mem.diagnostics.coverageRepairWarnings).filter(k => k !== '__pass__').length`.
    6. **Map shape vs array shape**: assert `typeof coverageRepairWarnings === 'object'` AND `!Array.isArray(coverageRepairWarnings)` post-fix. Pre-fix the second assertion FAILS (it IS an array).
  - Run on UNFIXED code.
  - **EXPECTED OUTCOME on F**: All six cases FAIL (warnings is still an array; payload fields don't exist). This confirms the assertions are wired correctly and specify the post-fix contract.
  - Mark task complete when all six cases are written, run, and uniformly failing on F (with a "still an array" / "missing payload field" failure mode, NOT a logic-error failure).
  - _Bug_Condition: isBugCondition(X) — diagnostics-shape contract_
  - _Expected_Behavior: design.md §"Fix Implementation" → "Specific Changes" point 2 (diagnostics shape migration)_
  - _File: tests/proctor-v2-phase2-75-multi-step-warnings-shape.test.js (NEW)_
  - _Change site: #2 (diagnostics shape migration), #3 (`coverageRepairUnresolved` re-derivation)_
  - _Requirements: 2.2, 2.6, 2.7, 2.10, 2.13_

- [x] 4. Write fix-checking property tests (BEFORE implementing fix)
  - **Property 1: Bug Condition** — Multi-Step Closure on All Buggy Inputs
  - **NOTE**: This test specifies the post-fix universal property — for every input where `isBugCondition(X)` fires, the post-fix algorithm closes the deficit OR records a structured warning. Pre-fix the FOR ALL universal property FAILS (the production fixture and the synthetic deficit-2 cases counter-example it). Post-fix it PASSES.
  - Create `tests/proctor-v2-phase2-75-multi-step-fix.test.js`.
  - Tag the test header `// @pre-fix property test — EXPECTED to FAIL on F until change site #1 lands`.
  - Use the existing fast-check generators (mirror `tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js` Task 2.1 generators) to produce inputs filtered to `isBugCondition(input) = true` (rejection-sample on the filter). Cover both the deficit-2 and deficit-3 branches.
  - For each generated input, assert (per design.md §"Fix Checking" pseudocode):
    1. For every proctor with deficit ≥ 1, EITHER `getPrimaryLoad(loadState', key) >= classLowerBound` OR `coverageRepairWarnings[key]` exists with structured payload `{reason, initialLoad, finalLoad, classLowerBound, attemptedSwaps}`.
    2. `coverageRepairUnresolved = Object.keys(coverageRepairWarnings).filter(k => k !== '__pass__').length`.
    3. When the deficit is closed: `(final - initial) >= 1` AND `final >= classLowerBound` (per Property P-2).
  - Hard-coded production-fixture pinpoint case: replay `tests/fixtures/45454.json`, assert `min >= 2`, طارق NOT in zero-load set, `coverageRepairUnresolved = 0` (per Property P-3).
  - Hard-coded synthetic deficit-2 case: assert `applyCoverageSwap` fires exactly twice for the deficit-2 proctor (mirror Task 1.1's input).
  - Hard-coded synthetic deficit-3 case: assert exactly three successful swaps for the deficit-3 proctor (mirror Task 1.2's input).
  - Run on UNFIXED code.
  - **EXPECTED OUTCOME on F**: Tests FAIL — the universal property is counter-exampled by the deficit-≥2 branch. This locks the property that change site #1 (Task 5) must satisfy.
  - _Bug_Condition: isBugCondition(X) — fix-checking universal property_
  - _Expected_Behavior: Property 1 — P-1, P-2, P-3 (multi-step closure + production pinpoint)_
  - _File: tests/proctor-v2-phase2-75-multi-step-fix.test.js (NEW)_
  - _Change site: #1 (inner repair loop)_
  - _Requirements: 2.1, 2.2, 2.4, 2.6, 2.7, 2.9, 2.10, 2.13_

- [x] 5. Apply Change Site #1 — Inner repair loop in `phase2_75CoverageRepair` (CRITICAL PRIMARY CHANGE)
  - **Property 1: Bug Condition** — Closes the structural single-swap-per-round limitation
  - This is the primary fix. Per design.md §"Fix Strategy: Option A — Inner Repair Loop", replace the per-pending-proctor body with a multi-swap inner loop that re-targets the same proctor until they reach `classLowerBound` or no candidate is returned.

  - [x] 5.1 Locate `phase2_75CoverageRepair` and the per-pending-proctor loop
    - Open `js/algorithms/proctor-distribution-v2.js`.
    - Locate `function phase2_75CoverageRepair(...)` at ≈ line 3069 (search for `function phase2_75CoverageRepair`).
    - Locate the per-pending-proctor loop body at ≈ lines 3098–3138 (the `for (var i = 0; i < pending.length; i++)` block).
    - Confirm the surrounding context: outer round/dedupe machinery (`seenUnresolvedKeys`, `MAX_ROUNDS`, `TIME_BUDGET_MS`) is at the function-scope level and survives the change.
    - Confirm the orchestrator call site at ≈ line 4342 receives the function's return value into `phase2_75Diagnostics`.
    - No code changes in this sub-task — just locate and confirm scope before editing.
    - _File: js/algorithms/proctor-distribution-v2.js (read-only locate)_
    - _Change site: #1 (primary)_
    - _Requirements: 2.1, 2.4, 2.5, 2.11_

  - [x] 5.2 Replace the per-pending-proctor body with the inner repair loop
    - Replace the body of the `for (var i = 0; i < pending.length; i++)` loop with the pseudocode from design.md §"Specific Changes" → point 1:
      - Capture `initialLoad`, `attemptedSwaps`, `successfulSwaps` per pending proctor.
      - `WHILE getPrimaryLoad(loadState, uncov.key) < bounds.classLowerBound DO`:
        - Check `Date.now() - startTime > TIME_BUDGET_MS` and BREAK if exceeded.
        - Increment `attemptedSwaps`.
        - Re-build candidates against CURRENT `loadState` via `buildSwapCandidates(rows, uncov, classId, loadState, bounds.classUpperBound + 1, input, classIds, lookup)`. If empty, retry with `bounds.classUpperBound`. If still empty, BREAK.
        - Sort candidates by `(donor primary load DESC, rowIndex ASC, slotIndex ASC)`.
        - Apply the top candidate via `applyCoverageSwap(...)`.
        - Increment `diagnostics.swaps`, `successfulSwaps`, `roundSwaps`.
      - After WHILE: capture `finalLoad`. If `finalLoad < bounds.classLowerBound`, record warning under `diagnostics.warnings[uncov.key]` with `{ reason: (attemptedSwaps = 0 ? 'no_swappable_peer' : 'no_eligible_donor'), initialLoad, finalLoad, classLowerBound: bounds.classLowerBound, attemptedSwaps }` and set `seenUnresolvedKeys[uncov.key] = true`.
    - Preserve `var`-based ES2019 style. NO `let`/`const`/arrow functions.
    - Preserve the `if (bounds is null OR classId is null)` guard at the top of the body — record warning with `reason: 'no_class_bounds'`, set `seenUnresolvedKeys`, `CONTINUE`.
    - The candidate-rebuild MUST be inside the inner loop — each successful swap mutates `loadState` so next iteration's eligibility check needs fresh state.
    - DO NOT modify `buildSwapCandidates`, `applyCoverageSwap`, `swapPreservesHardConstraints`, `violatesHardConstraints`, or the outer round/dedupe machinery.
    - Run `npm run lint` — must produce zero new errors/warnings vs Task 2.3 baseline.
    - Run Task 1's exploration tests — synthetic deficit-2 and deficit-3 cases should now PASS (multi-step closure works on synthetic inputs); production-fixture case may need the diagnostics-shape fix from Task 6 to fully pass.
    - **EXPECTED OUTCOME**: Inner loop closes the deficit on synthetic deficit-2/deficit-3 inputs. The production fixture's `min` rises from 0 to ≥ 2.
    - _Bug_Condition: isBugCondition(X) — closes the structural cause_
    - _Expected_Behavior: design.md §"Fix Strategy" + "Specific Changes" point 1 (inner repair loop pseudocode)_
    - _Preservation: design.md §"Preservation Requirements" (single-swap-path equivalence for deficit-1)_
    - _Change site: #1 (CRITICAL primary)_
    - _File: js/algorithms/proctor-distribution-v2.js (`phase2_75CoverageRepair` ≈ lines 3098–3138)_
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.7, 2.9, 2.10, 2.11, 2.13_

- [ ] 6. Apply Change Sites #2, #3, #5 — Diagnostics shape migration + orchestrator fallback
  - **Property 1: Bug Condition** — Diagnostics shape migrates from Array → Object map keyed by proctorKey

  - [x] 6.1 Apply Change Site #2 — `coverageRepairWarnings` Array → Object map migration
    - In `js/algorithms/proctor-distribution-v2.js` `phase2_75CoverageRepair`:
      - Replace `diagnostics.warnings = []` initialization (≈ line 3079) with `diagnostics.warnings = Object.create(null);` (or `{}` — match the existing code's idiom for empty-map literals).
      - Replace every `diagnostics.warnings.push({ proctorKey: K, reason: R })` site with `diagnostics.warnings[K] = { reason: R, initialLoad: ..., finalLoad: ..., classLowerBound: ..., attemptedSwaps: ... }`. The fields are populated from the captured locals in Task 5.2.
      - Migrate the four warning-emit sites: `time_budget`, `no_class_bounds`, `no_swappable_peer`, `no_eligible_donor`. The `no_swappable_peer` reason is preserved when `attemptedSwaps = 0` for backwards-recognizable diagnostics; `no_eligible_donor` is the new reason when `attemptedSwaps > 0` but the inner loop couldn't close the deficit.
      - Migrate the error-path return on ≈ line 3148: `return { swaps: 0, unresolved: 0, durationMs: 0, warnings: { '__pass__': { reason: 'pass_threw', error: ... } } }`. Document the `__pass__` synthetic key in a comment above the return statement so consumers can distinguish "the pass threw" from "a specific proctor failed".
    - Preserve `var`-based ES2019 style.
    - Run Task 3's warnings-shape test — case 6 (map shape vs array shape) and case 4 (`__pass__` synthetic key) should now PASS. Cases 1–3, 5 also pass (the schema is consistent across all four reasons).
    - Run `npm run lint` — zero new warnings.
    - **EXPECTED OUTCOME**: Warnings is now a plain object map keyed by proctorKey (or `__pass__`); each value carries the full structured payload.
    - _Bug_Condition: isBugCondition(X) — diagnostics shape contract_
    - _Expected_Behavior: design.md §"Specific Changes" point 2_
    - _Change site: #2_
    - _File: js/algorithms/proctor-distribution-v2.js (`phase2_75CoverageRepair`, multiple sites)_
    - _Requirements: 2.2, 2.6, 2.7, 2.10, 2.13_

  - [x] 6.2 Apply Change Site #3 — `coverageRepairUnresolved` re-derivation
    - In `js/algorithms/proctor-distribution-v2.js` `phase2_75CoverageRepair`, ensure `diagnostics.unresolved` is incremented exactly once per distinct proctor warning (which the per-proctor map structure naturally enforces — Task 6.1 already replaced array `push` with object indexing).
    - At the end of the function, add a defensive post-condition check: assert `diagnostics.unresolved === Object.keys(diagnostics.warnings).filter(function(k){ return k !== '__pass__'; }).length`. If the assertion fails, log a `console.warn(...)` and proceed (do NOT throw — defensive only, lets diagnostics regressions surface in tests rather than crashing production). Add a comment above the check explaining the post-condition.
    - Run Task 3's case 5 (identity assertion) — must PASS.
    - **EXPECTED OUTCOME**: `coverageRepairUnresolved` is exactly the count of non-`__pass__` warning entries.
    - _Bug_Condition: isBugCondition(X) — diagnostics integrity_
    - _Expected_Behavior: design.md §"Specific Changes" point 3_
    - _Change site: #3_
    - _File: js/algorithms/proctor-distribution-v2.js (`phase2_75CoverageRepair` end-of-function)_
    - _Requirements: 2.6, 2.7_

  - [x] 6.3 Verify Change Site #4 — Determinism contract preserved (no-op verification)
    - Per design.md §"Specific Changes" point 4, the `pending.sort` call at ≈ line 3088 and the candidate sort `(donor primary load DESC, rowIndex ASC, slotIndex ASC)` are both UNCHANGED.
    - Read-only verification: confirm via `grep_search` or `read_file` that the inner-loop replacement from Task 5.2 did NOT alter the outer `pending.sort` call or the candidate sort comparator.
    - Run Task 2.2's determinism test against post-Task-5/6 code — must still PASS (byte-equality across two runs on the synthetic and production inputs).
    - **EXPECTED OUTCOME**: Determinism is preserved by construction; the test confirms it empirically.
    - _Preservation: design.md §"Specific Changes" point 4 (determinism contract)_
    - _Change site: #4 (no-op verification)_
    - _File: js/algorithms/proctor-distribution-v2.js (read-only verification)_
    - _Requirements: 2.8, 3.17_

  - [x] 6.4 Apply Change Site #5 — Orchestrator fallback default `|| []` → `|| {}`
    - In `js/algorithms/proctor-distribution-v2.js`, locate the orchestrator's `coverageRepairWarnings` aggregation at ≈ line 4358 (search for `diagnostics.coverageRepairWarnings = phase2_75Diagnostics.warnings`).
    - Change `diagnostics.coverageRepairWarnings = phase2_75Diagnostics.warnings || [];` to `diagnostics.coverageRepairWarnings = phase2_75Diagnostics.warnings || {};` for shape consistency.
    - This is a one-line change; no other orchestrator lines are touched.
    - Run `npm run lint` — zero new warnings.
    - Run `npm test` — full suite plus the two new tests still execute; the existing exploration test (Task 7.4 below) is NOT run yet because Task 5 + 6 together must complete before re-running it.
    - **EXPECTED OUTCOME**: Orchestrator forwards the new map shape; legacy fallback (when `phase2_75Diagnostics.warnings` is somehow falsy) yields `{}` instead of `[]`.
    - _Preservation: design.md §"Specific Changes" point 2 (orchestrator fallback)_
    - _Change site: #5 (one-line orchestrator edit)_
    - _File: js/algorithms/proctor-distribution-v2.js (orchestrator ≈ line 4358)_
    - _Requirements: 2.7, 3.16_

  - [x] 6.5 Re-run Task 1 exploration tests — expect them to NOW PASS
    - **Property 1: Expected Behavior** — Multi-Step Closure (post-fix)
    - **IMPORTANT**: Re-run the SAME tests from Task 1 — do NOT write new tests.
    - The tests from Task 1 encode the bug-condition assertion (deficit-2/deficit-3 proctors reach `classLowerBound`; production fixture's طارق reaches load ≥ 2).
    - When these tests pass, they confirm `isBugCondition(R_mem') = false` for the synthetic and production cases — i.e. the multi-step closure has been achieved.
    - Run `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js` against FIXED code.
    - **EXPECTED OUTCOME**: All three cases (deficit-2, deficit-3, production-fixture) PASS.
    - At this point, the tests transition from "exploratory pre-fix" to "permanent regression lock". Add a closing comment `// @post-fix: now PASSES on F' — locks Property 1 for synthetic + production cases` at the file header.
    - _Bug_Condition: isBugCondition(X) — must be false post-fix per Property 1_
    - _Expected_Behavior: Property 1 — P-1, P-2, P-3_
    - _File: tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js (existing from Task 1)_
    - _Requirements: 2.1, 2.4, 2.6_

  - [ ] 6.6 Re-run Task 4 fix-checking property tests — expect them to NOW PASS
    - **Property 1: Expected Behavior** — Multi-Step Closure Universal Property
    - **IMPORTANT**: Re-run the SAME test from Task 4 — do NOT write a new test.
    - Run `tests/proctor-v2-phase2-75-multi-step-fix.test.js` against FIXED code.
    - **EXPECTED OUTCOME**: All assertions PASS — the universal property holds for all generated buggy inputs, the production-fixture pinpoint passes, the synthetic deficit-2 and deficit-3 swap-count assertions pass.
    - _Expected_Behavior: Property 1 — P-1, P-2, P-3, P-4_
    - _File: tests/proctor-v2-phase2-75-multi-step-fix.test.js (existing from Task 4)_
    - _Requirements: 2.1, 2.2, 2.4, 2.6, 2.7, 2.13_

  - [ ] 6.7 Re-run Task 3 warnings-shape unit tests — expect them to NOW PASS
    - **IMPORTANT**: Re-run the SAME test from Task 3 — do NOT write a new test.
    - Run `tests/proctor-v2-phase2-75-multi-step-warnings-shape.test.js` against FIXED code.
    - **EXPECTED OUTCOME**: All six cases PASS — the diagnostics shape migration is correct.
    - _Expected_Behavior: design.md §"Specific Changes" point 2_
    - _File: tests/proctor-v2-phase2-75-multi-step-warnings-shape.test.js (existing from Task 3)_
    - _Requirements: 2.2, 2.6, 2.7_

- [ ] 7. Verify Property 2 (Preservation) — re-run pre-existing tests + node scripts + lint

  - [ ] 7.1 Re-run Task 2.1 preservation PBT — must still PASS (no regressions on `NOT C(X)` inputs)
    - **Property 2: Preservation** — Deficit-≤1 Inputs Unchanged
    - **IMPORTANT**: Re-run the SAME test from Task 2.1 — do NOT write a new test.
    - Run `tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js` against FIXED code.
    - Compare the recorded snapshots from Task 2.1 against post-fix output: must match byte-for-byte modulo the additive `diagnostics.coverageRepairWarnings: {}` empty map (vs pre-fix empty array `[]`).
    - **EXPECTED OUTCOME**: All fast-check iterations PASS. Snapshot equivalence holds.
    - _Bug_Condition: NOT isBugCondition(X) — preservation domain_
    - _Expected_Behavior: Property 2 — observational equivalence on `NOT C(X)` inputs_
    - _Preservation: Req 3.6, 3.7, 3.16_
    - _File: tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js (existing from Task 2.1)_
    - _Requirements: 3.6, 3.7, 3.16, 3.17_

  - [ ] 7.2 Re-run Task 2.2 determinism test — must still PASS
    - **Property 2: Preservation** + **Property 1 P-4** — Determinism Contract
    - **IMPORTANT**: Re-run the SAME test from Task 2.2 — do NOT write a new test.
    - Run `tests/proctor-v2-phase2-75-multi-step-determinism.test.js` against FIXED code.
    - **EXPECTED OUTCOME**: Both replays (synthetic deficit-2, production fixture) yield byte-identical `proctor_keys`, `reserve_keys`, `coverageRepairSwaps`, AND the structured `coverageRepairWarnings` map (post-fix).
    - _Expected_Behavior: Property 1 P-4 + Property 2 (determinism)_
    - _File: tests/proctor-v2-phase2-75-multi-step-determinism.test.js (existing from Task 2.2)_
    - _Requirements: 3.17_

  - [ ] 7.3 Re-run all `tests/proctor-v2-*.test.js` — no regressions
    - Run the full proctor-v2 test family per Req 3.1.
    - Assert all previously-passing tests (baseline from Task 2.3) STILL pass — including `proctor-v2-key-shape-bug-exploration.test.js`, `proctor-v2-no-ghost-keys.test.js`, `proctor-v2-key-shape-unity.test.js`, `proctor-v2-key-adapter-unit.test.js`, `proctor-v2-all-cin-preservation.test.js`, `proctor-v2-fairness-undercovered-collect-unit.test.js`, `proctor-v2-fairness-undercovered-preservation.test.js`, plus the two property/strict bug C1/C2 family tests.
    - **EXPECTED OUTCOME**: Full proctor-v2 suite green; zero new failures.
    - _Preservation: Req 3.1, 3.8, 3.10_
    - _Requirements: 3.1, 3.8, 3.10_

  - [ ] 7.4 Re-run `tests/proctor-v2-fairness-undercovered-exploration.test.js` — must FLIP from FAIL to PASS UNMODIFIED
    - **CRITICAL**: This is the test that motivated the spec. It currently FAILS on `min = 0`; post-fix it MUST pass without any modification to the test file.
    - Run `node tests/proctor-v2-fairness-undercovered-exploration.test.js` (or via Jest if it's a Jest file — match the existing harness).
    - Confirm zero source edits to this test file (`git diff tests/proctor-v2-fairness-undercovered-exploration.test.js` is empty).
    - **EXPECTED OUTCOME**: Test PASSES — `min >= lowerBound`, `max - min <= 1`, `swaps > 0` or `unresolved > 0`. The closed-spec invariant is RESTORED to truth on the production fixture.
    - _Bug_Condition: isBugCondition(X) — false post-fix on production fixture_
    - _Expected_Behavior: Property 1 P-3 + closed-spec `proctor-v2-fairness-undercovered-fix` invariant restored_
    - _File: tests/proctor-v2-fairness-undercovered-exploration.test.js (read-only re-run)_
    - _Requirements: 2.6, 3.4, 3.8, 3.12_

  - [ ] 7.5 Re-run all `tests/inv-h5-*.test.js` — no regressions
    - Run the full H5 cross-page-consistency family per Req 3.2.
    - Assert `tests/inv-h5-cross-page-consistency.test.js` still passes — the post-H5 display-layer fix from `proctor-distribution-db-memory-mismatch` continues to hold with canonical-shape keys carried in `proctor_keys`.
    - **EXPECTED OUTCOME**: H5 invariant still holds post-multi-step-repair-fix.
    - _Preservation: Req 3.2, 3.9_
    - _Requirements: 3.2, 3.9_

  - [ ] 7.6 Re-run `tests/preservation-config-roundtrip.pbt.test.js` — still PASS
    - Run the round-trip PBT per Req 3.3.
    - Assert IPC round-trip stable for all 13 config keys including `examAutoDistributionData`.
    - **EXPECTED OUTCOME**: Round-trip property holds; `examAutoDistributionData` save/load is byte-stable.
    - _Preservation: Req 3.3, 3.14, 3.15_
    - _Requirements: 3.3, 3.14, 3.15_

  - [ ] 7.7 Run `npm run lint` — 0 new errors/warnings vs Task 2.3 baseline
    - Lint regression check per Req 3.11.
    - Compare against the baseline count recorded in the Task 2.3 file header comment.
    - **EXPECTED OUTCOME**: Zero new errors, zero new warnings vs the Task 2.3 baseline.
    - _Preservation: Req 3.11_
    - _Requirements: 3.11_

- [ ] 8. Verify scripts and inspector — pre/post-fix parity on non-buggy inputs, restoration on production fixture

  - [ ] 8.1 Run `node scripts/verify-fixture.js tests/fixtures/45454.json` — P1/P2/P3 PASS post-fix
    - Algorithm-level verification on production fixture per Req 3.4.
    - Pre-fix the script reports P3 FAIL (`min = 0`); post-fix it MUST report P1/P2/P3 PASS.
    - **EXPECTED OUTCOME**: P1/P2/P3 all PASS — the closed-spec `proctor-v2-fairness-undercovered-fix` invariant is RESTORED to truth on the production fixture.
    - _Bug_Condition: isBugCondition(X) — false post-fix on production fixture_
    - _Expected_Behavior: Property 1 P-3 + Req 3.4_
    - _File: scripts/verify-fixture.js (read-only execution)_
    - _Requirements: 2.6, 3.4, 3.8_

  - [ ] 8.2 Run `node scripts/verify-real-centre.js` — P1/P2/P3 PASS
    - Algorithm-level verification on real-centre fixture per Req 3.5.
    - The real-centre fixture is `NOT C(X)` (deficit-≤1 only); post-fix output must match pre-fix output modulo the empty `coverageRepairWarnings` map.
    - **EXPECTED OUTCOME**: P1/P2/P3 all PASS — preservation on the real-centre fixture confirmed.
    - _Preservation: Req 3.5_
    - _File: scripts/verify-real-centre.js (read-only execution)_
    - _Requirements: 3.5_

  - [ ] 8.3 Run `node scripts/inspect-fixture-state.js` — zero-load=0 post-fix
    - Diagnostic snapshot on the production fixture post-fix.
    - Compare against the pre-fix snapshot captured in Task 1.4 (file header comment of the exploration test).
    - **EXPECTED OUTCOME**: Inspector reports `zero-load proctors: 0`, `coverageRepairUnresolved: 0`, histogram with no entries below `classLowerBound = 2`. The single deficit-2 proctor (idx=98 طارق الشعابتي) now appears with `getPrimaryLoad >= 2`. The `coverageRepairSwaps` count rises from 17 to ≥ 19 (the two new swaps for طارق close his deficit-2 gap, modulo any donor reshuffling).
    - _Bug_Condition: isBugCondition(X) — false post-fix on production fixture (empirical)_
    - _Expected_Behavior: Property 1 P-3 (production-fixture pinpoint)_
    - _File: scripts/inspect-fixture-state.js (read-only execution)_
    - _Requirements: 1.5, 1.8, 2.6_

- [ ] 9. Checkpoint — final verification and scope-discipline audit

  - [ ] 9.1 All correctness properties (Property 1, Property 2) hold
    - Confirm Task 6.5–6.7 outcomes: Property 1 (multi-step closure on synthetic deficit-2/deficit-3 + production fixture, structured warnings shape, identity for `coverageRepairUnresolved`) is locked by `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js`, `tests/proctor-v2-phase2-75-multi-step-fix.test.js`, and `tests/proctor-v2-phase2-75-multi-step-warnings-shape.test.js`.
    - Confirm Task 7 outcomes: Property 2 (preservation + determinism) is locked by `tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js`, `tests/proctor-v2-phase2-75-multi-step-determinism.test.js`, the full existing test family, and `tests/preservation-config-roundtrip.pbt.test.js`.
    - Confirm Task 7.4: `tests/proctor-v2-fairness-undercovered-exploration.test.js` flipped FAIL→PASS UNMODIFIED.
    - _Requirements: 2.1, 2.2, 2.4, 2.6, 2.7, 2.12, 3.6, 3.7, 3.12, 3.16, 3.17_

  - [ ] 9.2 All preservation requirements satisfied (18 SHALL CONTINUE TO clauses)
    - Walk through bugfix.md §"Unchanged Behavior (Regression Prevention)" clauses 3.1 through 3.18.
    - For each clause, confirm the corresponding Task 7 / Task 8 sub-task verified it: 3.1→7.3; 3.2→7.5; 3.3→7.6; 3.4→7.4 + 8.1; 3.5→8.2; 3.6, 3.16→7.1; 3.7→7.1; 3.8→7.4 + 8.1; 3.9→7.5 + 7.6; 3.10→7.3; 3.11→7.7; 3.12→7.4; 3.13→9.3; 3.14→9.4; 3.15→7.6; 3.17→7.2; 3.18→7.1 (degenerate-boundary case in PBT).
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16, 3.17, 3.18_

  - [ ] 9.3 DB schema unchanged
    - Run `git diff main/db/migrations.js` against the spec base branch.
    - Assert: empty diff (Req 3.13).
    - _File: main/db/migrations.js (read-only verification)_
    - _Requirements: 3.13_

  - [ ] 9.4 IPC contract unchanged
    - Run `git diff main/ipc/exam-config-data.js` against the spec base branch.
    - Run `git diff preload.js` against the spec base branch.
    - Assert: empty diff for both (Req 3.14).
    - _File: main/ipc/exam-config-data.js, preload.js (read-only verification)_
    - _Requirements: 3.14_

  - [ ] 9.5 Display layer unchanged
    - Run `git diff exams-rooms.html exams-proctors.html js/data/proctor-key-resolver.js` against the spec base branch.
    - Assert: empty diff for all three (Req 3.9).
    - _File: exams-rooms.html, exams-proctors.html, js/data/proctor-key-resolver.js (read-only verification)_
    - _Requirements: 3.9_

  - [ ] 9.6 No edits outside the locked scope
    - Run `git diff --stat` against the spec base branch.
    - Assert only the following files appear in the diff:
      1. `js/algorithms/proctor-distribution-v2.js` (modified — `phase2_75CoverageRepair` body + one-line orchestrator fallback at ≈ line 4358; per design.md §"Scope Discipline")
      2. `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js` (new — Task 1)
      3. `tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js` (new — Task 2.1)
      4. `tests/proctor-v2-phase2-75-multi-step-determinism.test.js` (new — Task 2.2)
      5. `tests/proctor-v2-phase2-75-multi-step-warnings-shape.test.js` (new — Task 3)
      6. `tests/proctor-v2-phase2-75-multi-step-fix.test.js` (new — Task 4)
      7. `.kiro/specs/proctor-v2-phase2-75-multi-step-repair/*` (the spec docs themselves)
      8. `.agent/proctor-v2-phase2-75-multi-step-repair.md` (optional closing note from Task 9.8)
    - Specifically assert: NO edits to `collectUncovered`, `applyCoverageSwap`, `buildSwapCandidates`, `swapPreservesHardConstraints`, `violatesHardConstraints`, `getProctorKey`, `getProctorExemptionKey`, the duty pre-pass, `phase2Build`, `phase2_5PopulateReserves`, `applyReserveSwap`, `phase3Optimize`, the IPC handlers, DB migrations, the display layer, or `js/data/proctor-key-resolver.js`.
    - _Requirements: 2.11_

  - [ ] 9.7 Final test pass — `npm test` all green, `npm run lint` clean
    - Run `npm test` — full suite GREEN, zero failures (in particular, the previously FAILING `tests/proctor-v2-fairness-undercovered-exploration.test.js` now PASSES per Req 3.12).
    - Run `npm run lint` — zero new errors/warnings vs Task 2.3 baseline.
    - Run `node scripts/verify-fixture.js tests/fixtures/45454.json` — P1/P2/P3 PASS.
    - Run `node scripts/verify-real-centre.js` — P1/P2/P3 PASS.
    - **EXPECTED OUTCOME**: All four commands green. Spec is closed.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.11, 3.12_

  - [ ] 9.8 Update `.agent/proctor-v2-phase2-75-multi-step-repair.md` with closing summary
    - Append a "Closure" section to `.agent/proctor-v2-phase2-75-multi-step-repair.md` recording:
      - Spec name and date closed.
      - Strategy selected (Option A — inner repair loop) and rationale.
      - Files modified: `js/algorithms/proctor-distribution-v2.js` (5 changes — inner loop + diagnostics shape migration + `coverageRepairUnresolved` re-derivation + determinism preservation verification + orchestrator one-liner).
      - Tests added: 5 new permanent regression locks; the existing `tests/proctor-v2-fairness-undercovered-exploration.test.js` flipped FAIL→PASS unmodified.
      - Confirmation that `proctor-v2-fairness-undercovered-fix`'s `min ≥ classLowerBound` invariant is now TRUTHFUL on `tests/fixtures/45454.json` (was: violated by طارق at load=0).
      - Confirmation that `proctor-v2-key-shape-unification`'s canonical-shape closure invariant continues to hold (the multi-step fix operates on canonical-shape keys throughout).
      - Confirmation that `proctor-distribution-db-memory-mismatch`'s display-layer fix continues to work correctly with the canonical-shape proctor_keys carried in the post-fix output.
    - _File: .agent/proctor-v2-phase2-75-multi-step-repair.md (append)_
    - _Requirements: 2.12, 3.8, 3.9, 3.10_

  - [ ] 9.9 Ensure all tests pass — final checkpoint
    - Verify Task 1 tests PASS on F'.
    - Verify Task 2.1 + Task 2.2 tests PASS on F'.
    - Verify Task 3 warnings-shape test PASSES on F'.
    - Verify Task 4 fix-checking property test PASSES on F'.
    - Verify `tests/proctor-v2-fairness-undercovered-exploration.test.js` PASSES on F' (unmodified).
    - Verify `node scripts/verify-fixture.js tests/fixtures/45454.json` reports P1/P2/P3 PASS, exit 0.
    - Verify `node scripts/verify-real-centre.js` still passes.
    - Verify `node scripts/inspect-fixture-state.js` reports `zero-load proctors: 0`.
    - Verify `npm test` and `npm run lint` clean.
    - Confirm the only source change in `js/algorithms/proctor-distribution-v2.js` is the `phase2_75CoverageRepair` body (Tasks 5 + 6.1 + 6.2 + 6.3) and the one-line orchestrator fallback at ≈ line 4358 (Task 6.4).
    - Ask the user if any question arises before closing the spec.
    - _Requirements: 2.1, 2.2, 2.4, 2.6, 2.7, 2.11, 2.12, 3.1, 3.2, 3.3, 3.4, 3.5, 3.11, 3.12_
