# Implementation Plan — Proctor v2 Fairness Undercovered Fix

> Source documents: `bugfix.md` (Bug Condition C1/C2, Properties P1/P2/P3, Requirements 1.x / 2.x / 3.x), `design.md` (Architecture overview rows 1–4, fixed `collectUncovered` body, edge-case table, risk register).
>
> Project commands (per `AGENTS.md`): `npm test; npm run lint`. Plus `node scripts/verify-real-centre.js` for the bug's primary verification target.
>
> Atomicity: every leaf task ≤ 1 hour of focused work.
>
> Annotation legend:
> - `_Bug_Condition:` — reference to `isBugCondition` from design.md
> - `_Expected_Behavior:` — reference to design.md Correctness Properties
> - `_Preservation:` — reference to design.md Preservation Requirements
> - `_Edit site:` — row number in design.md "Architecture overview — Edit Sites" table
> - `_File:` — concrete file path the executor will touch
> - `_Requirements:` — clause numbers from `bugfix.md` (1.x / 2.x / 3.x)

---

- [x] 1. Write bug condition exploration test against real-centre fixture
  - **Property 1: Bug Condition** - Undercovered Proctors Below classLowerBound
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists.
  - **DO NOT attempt to fix the test or the code when it fails.**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation.
  - **GOAL**: Surface the deterministic counterexample on `tests/fixtures/proctor-v2-real-centre-data.json`.
  - **Scoped PBT Approach**: deterministic — the property is scoped to the single concrete real-centre fixture (147 proctors, 30 sessions, 368 expected slots, lowerBound=2).
  - Create `tests/proctor-v2-fairness-undercovered-exploration.test.js`.
  - Load the production v2 module via `vm` sandbox (mirror `scripts/verify-real-centre.js` lines 12–22).
  - Load `tests/fixtures/proctor-v2-real-centre-data.json` via `JSON.parse(fs.readFileSync(...))`.
  - Run `V2.run(input)` with the production module's default RNG.
  - Reconstruct slot loads using `__idx_N` keys (mirror lines 70–80 of `verify-real-centre.js`).
  - Compute `min`, `max`, `lowerBound`, `upperBound` from `out.diagnostics`.
  - Three assertions, each producing a clear counterexample message:
    1. `assert.ok(min >= lowerBound, ...)` — P3.
    2. `assert.ok(max - min <= 1, ...)` — P1.
    3. `assert.ok(d.coverageRepairSwaps > 0 || d.coverageRepairUnresolved > 0, ...)` — repair pass must do something on this fixture.
  - Console-log the histogram and the load-1/load-0 proctor list for the counterexample record.
  - Tag the test header `// @pre-fix exploratory test — EXPECTED to FAIL on F.`
  - Run `node tests/proctor-v2-fairness-undercovered-exploration.test.js`.
  - **EXPECTED OUTCOME**: Test FAILS (this is correct — it proves the bug exists). Document the counterexample (`min=0`, `max=3`, 24 proctors at load=1, `swaps=0`, `unresolved=0`).
  - Mark task complete when test is written, run, and failure is documented.
  - _Bug_Condition: isBugCondition from design.md (system-level C2)_
  - _Edit site: row 2_
  - _File: `tests/proctor-v2-fairness-undercovered-exploration.test.js`_
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Outputs Match F When No Undercovered Proctors
  - **IMPORTANT**: Follow observation-first methodology. Run F on each generated input first, record the output, then assert F' produces the same output.
  - Create `tests/proctor-v2-fairness-undercovered-preservation.test.js`.
  - Generate randomized synthetic inputs (seeded RNG, e.g. `mulberry32(0xC0FFEE)`):
    - `proctorsList` of size 1..30 with synthetic CIN keys.
    - For each proctor, random `{ classLowerBound: 0..3, classUpperBound: classLowerBound..classLowerBound+2 }`.
    - `loadState` constructed via the v2 module's `addGuardLoad` so `getPrimaryLoad(key) >= classLowerBound` for every keyed proctor (this is `¬C(X)`).
    - Skip a random subset of proctors entirely from `classBoundsByProctorKey` (no-bounds branch).
  - For each generated input (50 iterations minimum), assert:
    1. `deepEqual(V2.collectUncovered(...), [])` — empty result on `¬C(X)`.
  - Additionally include a baseline observation suite using existing synthetic fixtures (`buildC1Input`, `buildC1FairnessInput`, etc. from `tests/fixtures/proctor-v2-bug-fixtures.js`) — observe their `collectUncovered` outputs on F (record), and assert F' produces the same outputs.
  - Run on UNFIXED code.
  - **EXPECTED OUTCOME**: Tests PASS (confirms baseline behavior to preserve).
  - Mark task complete when tests are written, run, and passing on unfixed code.
  - _Preservation: design.md Preservation Requirements_
  - _Edit site: row 3_
  - _File: `tests/proctor-v2-fairness-undercovered-preservation.test.js`_
  - _Requirements: 3.1, 3.2_

- [x] 3. Write direct unit tests for `collectUncovered`
  - **IMPORTANT**: These tests cover every branch of the new predicate and double as the regression net for the fix.
  - Create `tests/proctor-v2-fairness-undercovered-collect-unit.test.js`.
  - Load v2 module via `vm` sandbox; call `V2.collectUncovered` directly (already exported at line ≈4390).
  - Cover every row of design.md "Edge Cases Handled" table:
    1. **`load == 0`, `classLowerBound > 0`** → included.
    2. **`0 < load < classLowerBound`** → included (this is the bug-fix case).
    3. **`load == classLowerBound`** → NOT included.
    4. **`load > classLowerBound`** → NOT included.
    5. **`classBoundsByProctorKey[key] === undefined`** → NOT included.
    6. **`proctorsList === null` or `[]`** → empty result.
    7. **`classBoundsByProctorKey === null`** → empty result.
    8. **`classLowerBound == 0`** → NOT included (documents intentional change at degenerate boundary; design.md edge-case table last row).
  - For each branch, construct minimal `loadState` via `V2.addGuardLoad` or by directly seeding `loadState[key] = { primarySlots: ..., dutyCount: 0, guardCount: ..., guardHalfdays: new Set() }` per the load-state shape used elsewhere.
  - Use `assert.deepStrictEqual` for the array result.
  - Run on UNFIXED code.
  - **EXPECTED OUTCOME**: cases 1, 5, 6, 7, 8 PASS; case 2 FAILS (confirms bug); cases 3, 4 PASS. Document this split in the test header.
  - _Bug_Condition: isBugCondition (function-level C1) from design.md_
  - _Preservation: design.md Preservation Requirements (cases 1, 3, 4, 5, 6, 7, 8)_
  - _Edit site: row 4_
  - _File: `tests/proctor-v2-fairness-undercovered-collect-unit.test.js`_
  - _Requirements: 1.1, 2.1, 3.1, 3.2_

- [x] 4. Fix `collectUncovered` predicate

  - [x] 4.1 Replace the strict-zero predicate with the bound-aware predicate
    - Open `js/algorithms/proctor-distribution-v2.js`.
    - Locate `function collectUncovered(proctorsList, classBoundsByProctorKey, loadState)` at line ≈ 2800.
    - Replace the body with the fixed body from design.md "Fix Implementation":
      ```javascript
      function collectUncovered(proctorsList, classBoundsByProctorKey, loadState) {
        var result = [];
        var list = proctorsList || [];
        for (var i = 0; i < list.length; i++) {
          var key = getProctorKey(list[i], i);
          var bounds = classBoundsByProctorKey && classBoundsByProctorKey[key];
          if (bounds && getPrimaryLoad(loadState, key) < bounds.classLowerBound) {
            result.push({ key: key, proc: list[i], idx: i });
          }
        }
        return result;
      }
      ```
    - Confirm no other line in the function body changed.
    - Confirm `var`-based ES2019 style is preserved (no `let`/`const`/arrow functions).
    - Confirm signature, traversal order, and `proctorsList || []` short-circuit are preserved.
    - Confirm exports at line ≈ 4390 still list `collectUncovered: collectUncovered`.
    - Run `npm run lint` to confirm no new lint errors.
    - _Bug_Condition: isBugCondition(input) from design.md (function-level C1)_
    - _Expected_Behavior: design.md Correctness Properties (Property 1)_
    - _Preservation: design.md Preservation Requirements_
    - _Edit site: row 1_
    - _File: `js/algorithms/proctor-distribution-v2.js` (function `collectUncovered` ≈ line 2800)_
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.6, 3.7, 3.8_

  - [x] 4.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Undercovered Proctors Below classLowerBound
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test.
    - Run `node tests/proctor-v2-fairness-undercovered-exploration.test.js`.
    - **EXPECTED OUTCOME**: Test PASSES (`min >= lowerBound`, `max - min <= 1`, `swaps > 0` or `unresolved > 0`).
    - If the test still fails on `swaps == 0 && unresolved == 0`, re-hypothesize root cause (cf. design.md "Hypothesized Root Cause" alternatives).
    - _Requirements: 2.1, 2.2_

  - [x] 4.3 Verify direct unit tests for `collectUncovered` all pass
    - **IMPORTANT**: Re-run `tests/proctor-v2-fairness-undercovered-collect-unit.test.js` from task 3 — do NOT write new tests.
    - **EXPECTED OUTCOME**: every branch (cases 1–8) PASSES — including case 2 which used to fail on F.
    - _Requirements: 2.1, 3.1, 3.2_

  - [x] 4.4 Verify preservation property tests still pass
    - **Property 2: Preservation** - Outputs Match F When No Undercovered Proctors
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests.
    - Run `node tests/proctor-v2-fairness-undercovered-preservation.test.js`.
    - **EXPECTED OUTCOME**: all 50+ randomized iterations PASS, baseline observation suite PASSES (no regressions on existing synthetic fixtures).
    - _Requirements: 3.1, 3.2_

- [x] 4.5 Plumb `classBoundsByProctorKey` onto input before Phase 3
  - In `js/algorithms/proctor-distribution-v2.js`, locate the orchestrator section that runs `phase2_75CoverageRepair` (line ≈4159) and `phase3Optimize` (line ≈4229).
  - Just before invoking `phase3Optimize`, attach: `input.classBoundsByProctorKey = phase2Result.classBoundsByProctorKey;`
  - Additive plumbing — no schema change. `phase3Optimize` already receives `input` and passes it to `violatesHardConstraints`.
  - _Edit site: orchestrator section, ≈line 4225_
  - _File: `js/algorithms/proctor-distribution-v2.js`_
  - _Requirements: 2.4, 3.9, 3.11_

- [x] 4.6 Extend `violatesHardConstraints` with lower-bound rejection
  - Open `js/algorithms/proctor-distribution-v2.js`, locate `function violatesHardConstraints(assignments, input)` (line ≈3279), end of body just before `return false`.
  - Add the additive lower-bound check from design.md "Fixed Implementation" — a per-proctor guardCount tally + iteration over `classBoundsByProctorKey` rejecting any proctor below their `classLowerBound`.
  - Preserve `var`-based ES2019 style. NO `let`/`const`/arrow functions.
  - Add comment block above citing the spec name and the C3 condition.
  - The check is a no-op when `classBoundsByProctorKey` is absent (Req 3.9).
  - _Edit site: design.md "Fixed Implementation" (Phase 3 extension)_
  - _File: `js/algorithms/proctor-distribution-v2.js` (function `violatesHardConstraints` ≈ line 3279)_
  - _Requirements: 2.4, 3.9, 3.10, 3.11, 3.12_

- [x] 4.7 Verify Phase 3 protection works on real-centre
  - Run `node scripts/verify-real-centre.js` — expect P1, P2, P3 all PASS.
  - Run `node tests/proctor-v2-fairness-undercovered-exploration.test.js` — must NOW PASS.
  - Run `node tests/proctor-v2-fairness-undercovered-collect-unit.test.js` — must STILL PASS (8/8).
  - Run `node tests/proctor-v2-fairness-undercovered-preservation.test.js` — must STILL PASS.
  - _Requirements: 2.4, 2.5_

- [x] 5. Run real-centre verification script
  - Run `node scripts/verify-real-centre.js`.
  - **EXPECTED OUTCOME** (from bugfix.md §"Expected Behavior" 2.3):
    - `P1 (max-min ≤ 1):     PASS`
    - `P2 (max ≤ upperBound): PASS`
    - `P3 (min ≥ lowerBound): PASS`
    - `Coverage (filled=expected): PASS`
    - Exit status 0.
  - If any of P1/P2/P3/Coverage still fails, capture the diagnostics block and the histogram, then re-hypothesize per design.md "Hypothesized Root Cause" alternatives (time budget? cost-cap? class bounds missing?).
  - _Requirements: 2.3_

- [x] 6. Run end-to-end synthetic verification script (regression check)
  - Run `node scripts/verify-end-to-end.js`.
  - **EXPECTED OUTCOME**: all four invariants still PASS on the synthetic fixture (preservation regression check; this script passed on F and must keep passing on F').
  - _Requirements: 3.3_

- [x] 7. Run full repo test suite — no regressions
  - Run `npm test`.
  - Confirm every `tests/*.test.js` still passes — particularly:
    - `tests/proctor-v2-strict-bug-c2-uncovered.test.js` (still asserts F's pre-fix counterexample on the snapshot, snapshot unchanged).
    - `tests/proctor-v2-property-p1-fairness.test.js`, `…-p2-duty.test.js`, `…-p3-fixed.test.js`, `…-p4-percent.test.js`, `…-p5-eligibility.test.js`.
    - `tests/proctor-v2-property-p6-v1-byte-equality.test.js` (v1 byte-equal preserved).
    - `tests/proctor-v2-slot-metric-*.test.js`.
    - `tests/proctor-distribution-v2-*.test.js`.
  - Confirm `tests/__snapshots__/proctor-v2-strict-fairness-coverage.pre-fix.js` is byte-identical (`git status` shows it unchanged).
  - _Requirements: 3.3, 3.4, 3.8_

- [x] 8. Run lint
  - Run `npm run lint`.
  - **EXPECTED OUTCOME**: zero new errors / warnings introduced by the predicate change or the three new test files.
  - Match existing var-based ES2019 style in test files (mirror `tests/proctor-v2-property-p1-fairness.test.js` for module loading and assertion style).
  - _Requirements: 3.3, 3.4_

- [x] 9. Checkpoint — Ensure all tests pass
  - Verify task 1 test PASSES on F'.
  - Verify task 2 test PASSES on F'.
  - Verify task 3 unit tests PASS on F'.
  - Verify `node scripts/verify-real-centre.js` reports all four PASS, exit 0.
  - Verify `node scripts/verify-end-to-end.js` still passes.
  - Verify `npm test` and `npm run lint` clean.
  - Confirm the only source change in `js/algorithms/proctor-distribution-v2.js` is the predicate inside `collectUncovered` (per design.md "Specific Changes" 1–5).
  - Confirm no edits outside the v2 module (no v1 changes, no UI changes, no fixture edits, no snapshot edits).
  - Ask the user if any question arises before closing the spec.
