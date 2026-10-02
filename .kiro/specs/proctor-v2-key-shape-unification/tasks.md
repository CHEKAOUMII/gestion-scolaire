# Implementation Plan — Proctor V2 Key-Shape Unification (Bugfix)

## Source Documents

- `.kiro/specs/proctor-v2-key-shape-unification/bugfix.md` — Requirements 1.x (defect), 2.x (expected), 3.x (preservation); Bug Condition `C(X)`, Property `P`, Preservation goal.
- `.kiro/specs/proctor-v2-key-shape-unification/design.md` — Investigation Plan (Phases A–E), canonical shape decision (**Option A: algo shape `cin || '__idx_' + idx`**), 31-row Edit Sites table, Boundary Adapter design (`buildKeyAdapter` / `toCanonicalKey`), Edge Cases, Risk Register (R1–R10), Correctness Properties (P1, P2), Testing Strategy.
- `.agent/proctor-v2-key-shape-bug.md` — Full investigation context, devtools-confirmed evidence (3 confirming scripts), root-cause trace through the 3 known leak sites in `v2.js`.

## Project Commands

| Command | Purpose |
|---|---|
| `npm test` | Run full Jest suite (must remain green per Req 3.1, 3.2, 3.3, 3.11) |
| `npm run lint` | ESLint (must produce zero new errors/warnings per Req 3.10) |
| `node scripts/verify-fixture.js tests/fixtures/45454.json` | Algorithm-level P1/P2/P3 verification on production fixture (Req 3.4) |
| `node scripts/verify-real-centre.js` | Algorithm-level P1/P2/P3 verification on real-centre fixture (Req 3.5) |

## Atomicity

Every leaf task is sized to ≤ 1 hour of focused work. Parent tasks (2, 3, 8, 9, 10, 11) decompose into atomic sub-tasks.

## Annotation Legend

| Annotation | Meaning |
|---|---|
| `_Bug_Condition:` | Reference to `isBugCondition(X)` from design.md §"Bug Details" |
| `_Expected_Behavior:` | Reference to design.md §"Correctness Properties" (P1, P2) |
| `_Preservation:` | Reference to design.md §"Preservation Requirements" |
| `_Edit site:` | Row number(s) in design.md §"Architecture Overview — Edit Sites Table" (rows 1–31) |
| `_File:` | Concrete file path the executor will touch |
| `_Requirements:` | Clause numbers from `bugfix.md` (1.x defect / 2.x expected / 3.x preservation) |
| `_Hypothesis:` | Reference to design.md §"Hypothesized Root Cause" point (1–6) |
| `_Phase:` | Reference to design.md §"Investigation Plan — Phased Decision Tree" (A/B/C/D/E) |

## Scope Boundaries (CRITICAL — from design.md)

- ✅ In scope: `js/algorithms/proctor-distribution-v2.js` and three NEW test files (plus two transient pre-fix scaffolding tests).
- ❌ Out of scope: DB schema (Req 3.12), IPC contract (Req 3.13), display layer, `js/data/proctor-key-resolver.js`, `getProctorKey` / `getProctorExemptionKey` function bodies.
- 31 edit sites total: 2 critical (#11, #17), 1 defensive (#10), 28 inheriting.
- Implementation order is FIXED per design.md §"Implementation Order" — Tasks 4 → 5 → 6 → 7 must execute in that sequence.

---

## Tasks

- [x] 1. Write bug condition exploration test (BEFORE fix)
  - **Property 1: Bug Condition** — Dual-Identity in `proctor_keys ∪ reserve_keys`
  - **CRITICAL**: This test MUST FAIL on unfixed code (F) — failure confirms the bug exists on the production fixture.
  - **DO NOT attempt to fix the test or the code when it fails.**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation (re-used in Task 8.1).
  - **GOAL**: Surface counterexamples that demonstrate `isBugCondition(X)` fires on `tests/fixtures/45454.json`.
  - **Scoped PBT Approach**: This is a deterministic bug — scope the property to the concrete failing fixture (`tests/fixtures/45454.json`) rather than synthesizing inputs. Reproducibility is guaranteed by the fixed fixture.
  - Create `tests/proctor-v2-key-shape-bug-exploration.test.js`.
  - Tag the test header with the comment `// @pre-fix exploratory test — EXPECTED to FAIL on F`.
  - Load `tests/fixtures/45454.json` and run `ProctorDistributionV2.run(input)` in a Node-only harness. The fixture's 147 proctors all have empty `cin` and non-empty `som`, so this exercises the production case directly. The harness must NOT pre-clear the input (no IPC, no DB).
  - Encode `isBugCondition(X)` per design.md §"Bug Details" → "Bug Condition" pseudocode: for every `(proc, idx)` in `proctorsList` where `getProctorKey(proc, idx) ≠ getProctorExemptionKey(proc, idx)`, count occurrences of `K1` and `K2` in `R_mem.proctor_keys ∪ R_mem.reserve_keys`. Assert that NOT BOTH counts are positive (i.e., no proctor has dual identity).
  - Document the 6 known counterexample proctors inline as a comment table:

    | idx | teacher_name        | som     |
    |-----|---------------------|---------|
    | 43  | ايت حدو فؤاد        | 1909564 |
    | 47  | وردية بوعادي        | 1177902 |
    | 50  | المكاني محمد        | 1545317 |
    | 66  | تيكوردي إشراق       | 1910812 |
    | 78  | السعدوي عمر         | 2367149 |
    | 92  | ايمان تنون          | 2158781 |

  - Run test on UNFIXED code (`F`).
  - **EXPECTED OUTCOME on F**: Test FAILS — counterexamples logged for the 6 proctors, each with `K1=__idx_N count=3` and `K2=som count=1`, totalling true load = 4 against algorithm-reported max = 3.
  - Document counterexamples found in the test failure output to confirm root cause hypothesis (3 leak sites: duty pre-pass #11, `phase2_5PopulateReserves` #17, `applyReserveSwap` swap-promotion).
  - Mark task complete when test is written, run, and failure is documented.
  - _Bug_Condition: isBugCondition(X) per design.md §"Bug Condition"_
  - _Expected_Behavior: Property 1 — Canonical Single-Identity in Output (design.md §"Correctness Properties")_
  - _File: tests/proctor-v2-key-shape-bug-exploration.test.js (NEW)_
  - _Hypothesis: Points 3, 4, 5 in design.md §"Hypothesized Root Cause"_
  - _Phase: E (Test Plan)_
  - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.8_

- [x] 2. Write preservation property tests (BEFORE fix)
  - **Property 2: Preservation** — Non-Buggy Behavior Baseline
  - **IMPORTANT**: Follow observation-first methodology — observe behavior on F first, then capture observed behavior in property assertions. These tests establish the baseline that Task 9 will re-run post-fix.

  - [x] 2.1 Write `tests/proctor-v2-key-adapter-unit.test.js` (helper-existence stub)
    - **Property 2: Preservation** — `buildKeyAdapter` / `toCanonicalKey` are exposed on `_internals`
    - This sub-task creates the test FILE with the test scaffolding (imports, describe block, all six test cases). Direct unit-test assertions for `buildKeyAdapter` semantics live in Task 3 (which is independent and runs after Task 4 lands the helpers).
    - Create `tests/proctor-v2-key-adapter-unit.test.js` with the bare scaffolding: import `_internals` from `js/algorithms/proctor-distribution-v2.js`, write a single existence assertion `expect(typeof _internals.buildKeyAdapter).toBe('function')` and `expect(typeof _internals.toCanonicalKey).toBe('function')`. Leave the six adapter cases as `test.todo` for Task 3.
    - Run on UNFIXED code.
    - **EXPECTED OUTCOME on F**: Test FAILS at the existence assertion (helpers don't exist on `_internals`). This confirms the test file is wired correctly to the module.
    - Mark sub-task complete when test file is created, run, and existence-failure is documented.
    - _Bug_Condition: N/A — structural unit test scaffolding_
    - _Expected_Behavior: design.md §"Boundary Adapter Design"_
    - _File: tests/proctor-v2-key-adapter-unit.test.js (NEW)_
    - _Phase: D (Boundary Adapters), E (Test Plan)_
    - _Requirements: 2.4, 2.10, 2.12_

  - [x] 2.2 Write `tests/proctor-v2-all-cin-preservation.test.js` (all-cin preservation baseline)
    - **Property 2: Preservation** — All-Cin Inputs Are Unchanged
    - Construct a synthetic input where every proctor in `proctorsList` has non-empty `cin` (so `getProctorKey ≡ getProctorExemptionKey` for every proctor and `isBugCondition(X) = false` by construction).
    - Use the existing fast-check generator pattern from the proctor-v2 PBT suite (look in `tests/proctor-v2-property-*.test.js` for the existing generator) to generate ~10 such inputs.
    - Observe: run `ProctorDistributionV2.run(input)` on F; record `result.proctor_keys`, `result.reserve_keys`, `result.diagnostics`.
    - Assert: for every generated input, `isBugCondition(X) = false` — no proctor has both keys present, because `K1 = K2` by construction.
    - Snapshot `proctor_keys` and `reserve_keys` for one canonical case so Task 9 can re-run the same input post-fix and assert byte-equality (modulo additive `diagnostics.orphanDutyKeys` / `diagnostics.orphanMeAssignments` which are 0 on F and 0 on F').
    - Run on UNFIXED code.
    - **EXPECTED OUTCOME on F**: Test PASSES (this is the preservation baseline — confirms `NOT C(X)` inputs produce a stable output that we will preserve post-fix).
    - Mark sub-task complete when test is written and passing on F.
    - _Bug_Condition: NOT isBugCondition(X) — preservation domain_
    - _Expected_Behavior: Property 2 — Non-Buggy Inputs Unchanged_
    - _File: tests/proctor-v2-all-cin-preservation.test.js (NEW)_
    - _Phase: E (Preservation Checking)_
    - _Requirements: 3.6, 3.15_

  - [x] 2.3 Establish existing test suite preservation baseline
    - **Property 2: Preservation** — Existing Test Suite Is Green on F
    - Run `npm test` against UNFIXED code and record the full pass/fail count.
    - Specifically verify these test files all pass on F:
      - All `tests/proctor-v2-*.test.js` (Req 3.1: property-4-save-stability, property-p5-eligibility, property-p4-percent, strict-bug-c2-uncovered, bug-c1-fairness, bug-c2-duty, strict-bug-c1-fairness, session-notes-integration, slot-metric-add-guard-load, slot-metric-reserve-sort).
      - All `tests/inv-h5-*.test.js` (Req 3.2 — including `inv-h5-cross-page-consistency.test.js`).
      - `tests/preservation-config-roundtrip.pbt.test.js` (Req 3.3).
    - Run `npm run lint` against UNFIXED code and record the warning/error count (Req 3.10 baseline).
    - Document the baseline (test count, lint count, date) as a comment at the top of `tests/proctor-v2-key-adapter-unit.test.js` for cross-reference in Task 9.
    - **EXPECTED OUTCOME on F**: All listed tests PASS. Lint count is the regression threshold for Task 9.7.
    - Mark sub-task complete when baseline is recorded and all listed tests pass on F.
    - _Bug_Condition: NOT isBugCondition(X) — preservation domain_
    - _Expected_Behavior: Property 2 — All currently-passing tests continue to pass post-fix_
    - _File: (no new file; baseline is captured in Task 2.1 file header comment)_
    - _Phase: E (Preservation Checking)_
    - _Requirements: 3.1, 3.2, 3.3, 3.10, 3.11_

- [x] 3. Write direct unit tests for `buildKeyAdapter` and `toCanonicalKey` (BEFORE fix)
  - **Property 2: Preservation** — Adapter Behavioral Specification
  - **NOTE**: This task fills in the `test.todo` stubs left by Task 2.1 with concrete assertions. It is intentionally a separate task because the assertions are independent semantic units (one per adapter case) and together they specify the contract that Task 4 will satisfy.
  - **IMPORTANT**: All assertions in this task FAIL pre-fix (helpers don't exist) and PASS post-fix (after Task 4 lands `buildKeyAdapter` / `toCanonicalKey`).
  - Replace the `test.todo` stubs in `tests/proctor-v2-key-adapter-unit.test.js` with the six concrete cases enumerated in design.md §"Testing Strategy" → "Unit Tests":
    1. **cin-only proctor** `{cin:'C1', som:'S1'}` at idx 0: `buildKeyAdapter(...)` registers `'C1' → 'C1'` (identity, since `getProctorKey === getProctorExemptionKey === 'C1'`).
    2. **som-only proctor (production case)** `{cin:'', som:'S1'}` at idx 0: registers `'__idx_0' → '__idx_0'` (identity) AND `'S1' → '__idx_0'` (cross-shape translation).
    3. **synthetic-only proctor** `{cin:'', som:''}` at idx 5: registers `'__idx_5' → '__idx_5'` (identity) AND `'idx_5' → '__idx_5'` (note the missing leading underscores in the exemption-shape variant).
    4. **empty `proctorsList`**: returns `{}` (an `Object.create(null)` with no enumerable keys).
    5. **shared-som collision** (two proctors with same `som`): last-write-wins per design.md R5; matches v1 `Object.keys` iteration semantics.
    6. **`toCanonicalKey` on unknown key**: returns `null` for any external key not registered in the adapter (orphan case).
  - Run on UNFIXED code.
  - **EXPECTED OUTCOME on F**: All six tests FAIL (helpers don't exist → `_internals.buildKeyAdapter` is undefined). This confirms the assertions are wired correctly.
  - Mark task complete when all six assertions are written, run, and uniformly failing on F (with a "helpers not yet implemented" failure mode, NOT a logic-error failure).
  - _Bug_Condition: N/A — pure adapter unit tests_
  - _Expected_Behavior: design.md §"Boundary Adapter Design" → buildKeyAdapter pseudocode + edge cases_
  - _File: tests/proctor-v2-key-adapter-unit.test.js (extend stubs from Task 2.1)_
  - _Phase: D (Boundary Adapters), E (Unit Tests)_
  - _Requirements: 2.3, 2.4, 2.10, 2.12_

- [x] 4. Apply Phase A — Add `buildKeyAdapter` and `toCanonicalKey` helpers (NO behavior change yet)
  - **Property 2: Preservation** — Helpers added, no observable behavior change
  - Open `js/algorithms/proctor-distribution-v2.js`.
  - Locate `getProctorExemptionKey` definition at ≈line 662–665.
  - Insert `buildKeyAdapter(proctorsList)` immediately after `getProctorExemptionKey` (≈line 666). Use the exact pseudocode from design.md §"Boundary Adapter Design" → `buildKeyAdapter(proctorsList)`:
    - Initialize `var map = Object.create(null);`.
    - For each `(proc, i)` in `proctorsList`: register `map[canonical] = canonical` (always); `map[exempt] = canonical` if `exempt !== canonical`; `map[proc.cin] = canonical` if `proc.cin && proc.cin !== canonical`; `map[proc.som] = canonical` if `proc.som && !proc.cin`.
    - Return `map`.
  - Insert `toCanonicalKey(keyAdapter, externalKey)` directly after `buildKeyAdapter` — one-liner returning `keyAdapter[externalKey] || null` with a `!externalKey` early return.
  - Add JSDoc above `buildKeyAdapter` documenting the four recognized external shapes (algo, exemption, cin, som) and the last-write-wins semantics for shared `som` (R5).
  - Expose both helpers on the module's `_internals` object (search for the existing `_internals = {` declaration; add `buildKeyAdapter, toCanonicalKey` to its keys).
  - Run `npm run lint` — must produce ZERO new errors/warnings vs the Task 2.3 baseline.
  - Run Task 3's six unit-test cases — must NOW all PASS (helpers now exist on `_internals` with correct semantics).
  - Run `npm test` — full suite must remain GREEN (no behavior change yet because helpers are unused).
  - **EXPECTED OUTCOME**: Helpers added; Task 3 tests pass; full suite still green; no behavior change.
  - _Bug_Condition: isBugCondition(X) — preparing the structural fix; helpers are inert until wired_
  - _Expected_Behavior: design.md §"Boundary Adapter Design" → buildKeyAdapter / toCanonicalKey pseudocode_
  - _Preservation: Req 3.1, 3.2, 3.3, 3.10, 3.11 — full suite + lint green_
  - _Edit site: Definitions inserted between Edit Site rows #2 and #3 of the table_
  - _File: js/algorithms/proctor-distribution-v2.js (≈line 666)_
  - _Hypothesis: Point 1 (legacy v1 byte-equality preserved by ADDING new helpers, not removing existing functions)_
  - _Phase: D (Boundary Adapters)_
  - _Requirements: 2.3, 2.4, 2.11_

- [x] 5. Apply Edit Site #11 — Duty pre-pass adapter wiring (CRITICAL change 1 of 2)
  - **Property 1: Bug Condition** — Closes leak source #1 of 2
  - **Sub-step 5.a — orchestrator wiring**: Locate the `orchestrator(input)` function entry (≈line 3982 area per design.md). Immediately after input validation and BEFORE Phase 1, add `var keyAdapter = buildKeyAdapter(proctorsList);` (capture in `orchestrator`'s local scope). Verify `phase2Build` is a nested function inside `orchestrator` so closure capture is sufficient; if `phase2Build` is module-level, add `keyAdapter` as the LAST positional parameter (additive, preserves existing call sites). Initialize `diagnostics.orphanDutyKeys = 0` and `diagnostics.orphanMeAssignments = 0` at the same site (additive — design.md §"Fix Implementation" point 7).
  - **Sub-step 5.b — duty pre-pass replacement**: Locate the duty pre-pass at ≈line 1762 in `phase2Build` (search for `addDutyLoad(loadState, dutyProctorKeys[dpi]`). Replace the direct `addDutyLoad(loadState, dutyProctorKeys[dpi], dutyHdKey, '');` call with the boundary-adapter-mediated version per design.md §"Wiring at the duty pre-pass (Edit Site #11, line ≈1762)":

    ```js
    // Edit Site #11: translate exemption-shape external duty key to canonical
    // shape; orphan keys are skipped + counted (R5/R6 from Risk Register).
    var canonicalDutyKey = toCanonicalKey(keyAdapter, dutyProctorKeys[dpi]);
    if (canonicalDutyKey) {
      addDutyLoad(loadState, canonicalDutyKey, dutyHdKey, '');
    } else {
      diagnostics.orphanDutyKeys = (diagnostics.orphanDutyKeys || 0) + 1;
    }
    ```

  - Run `npm test` — full suite must remain green. NO regressions expected at this point because no internal site yet reads canonical-form duty entries differently. The dual-identity bug is still observable in `R_mem.proctor_keys` until #17 also lands (Task 6).
  - Run `npm run lint` — zero new warnings.
  - **EXPECTED OUTCOME**: Duty pre-pass writes canonical-shape keys to `loadState`. Internal `loadState` is now closed under canonical shape from the duty side. Task 1's exploration test still FAILS at this point (because `phase2_5PopulateReserves` still emits exemption-shape keys to `reserve_keys`).
  - _Bug_Condition: isBugCondition(X) — closes leak source #1 of 2_
  - _Expected_Behavior: design.md §"Wiring at the duty pre-pass" + Property 1 (P-3 canonical-shape closure)_
  - _Preservation: Req 3.1–3.5, 3.11 — full suite green; diagnostics is additive only_
  - _Edit site: Row #11 (CRITICAL); orchestrator init precedes row #11_
  - _File: js/algorithms/proctor-distribution-v2.js (≈line 1762 + ≈line 3982)_
  - _Hypothesis: Point 3 (duty pre-pass leaks at the boundary)_
  - _Phase: D (Boundary Adapters), Phase B catalog source classification_
  - _Requirements: 2.2, 2.7, 2.8, 2.9, 2.10_

- [x] 6. Apply Edit Site #17 — `phase2_5PopulateReserves` canonicalization (CRITICAL change 2 of 2)
  - **Property 1: Bug Condition** — Closes leak source #2 of 2; THIS task makes Task 1's exploration test pass
  - Locate `phase2_5PopulateReserves` at ≈line 2643 (search for `function phase2_5PopulateReserves`).
  - Locate the candidate-key derivation `var key = getProctorExemptionKey(proc, pi);` at ≈line 2643.
  - Apply the single-token change per design.md §"Wiring at `phase2_5PopulateReserves` (Edit Site #17, line ≈2643)": replace `getProctorExemptionKey` with `getProctorKey`. The line becomes:

    ```js
    // Edit Site #17: canonical-shape key for reserve candidates. Boundary
    // lookups against external exemption-shape data continue to happen INSIDE
    // isExemptForAnyRow / isDutyTeacherForEntry (rows #3, #5) — they receive
    // (proc, pi) and rebuild the exemption key locally; they never touch loadState.
    var key = getProctorKey(proc, pi);
    ```

  - Verify all downstream sites in this function inherit canonical shape automatically (Edit Site rows #18–22): `sessionGuardSet.has(key)`, `loadStateForReserves[key]`, `sharedReserveKeys.push(chosen[ci].key)`, `addReserveLoad(loadStateForReserves, chosenForLoad.key, halfdayKey, ...)`, `computeAffinityRank(key, ...)`. NO additional code changes in those downstream sites — correctness follows by inheritance.
  - Run `npm test` — Task 1's exploration test should now PASS (becomes the validation of Property 1). Existing test suite must remain green. No regressions on `tests/preservation-config-roundtrip.pbt.test.js` (R1 mitigation).
  - Run `npm run lint` — zero new warnings.
  - **EXPECTED OUTCOME**: `reserve_keys` are canonical-shape; no exemption-shape leak survives into output. Task 1's exploration test now PASSES. The 6 ghost CIN keys are absent from `R_mem.proctor_keys ∪ R_mem.reserve_keys` on the production fixture.
  - _Bug_Condition: isBugCondition(X) — closes leak source #2 of 2 (the "phase2_5 propagates the leak" path)_
  - _Expected_Behavior: design.md §"Wiring at `phase2_5PopulateReserves`" + Property 1 (P-1, P-2, P-3, P-4)_
  - _Preservation: Req 3.1–3.9, 3.11; v1 byte-equality preserved per R1 (change is internal-only)_
  - _Edit site: Row #17 (CRITICAL); rows #18–22 inherit_
  - _File: js/algorithms/proctor-distribution-v2.js (≈line 2643)_
  - _Hypothesis: Points 4 and 5 (phase2_5 propagates + applyReserveSwap promotes; #17 closes both)_
  - _Phase: C (Canonical Shape Selection — Option A applied), D_
  - _Requirements: 2.1, 2.2, 2.5, 2.6, 2.7, 2.8, 2.9_

- [x] 7. Apply Edit Site #10 — `meAssignmentsMap` defensive adapter (DEFENSIVE)
  - **Property 2: Preservation** — Closes parallel leak vector for legacy DB rows (R3 mitigation)
  - Locate the `meAssignmentsMap` build at ≈line 1741–1745 in `phase2Build` (search for `var meKeys = Object.keys(meAssignments);`).
  - Wrap the `meKeys[mk]` lookup with `toCanonicalKey(keyAdapter, ...)` per design.md §"Wiring at `meAssignmentsMap` build (Edit Site #10, line ≈1741, defensive)":

    ```js
    // Edit Site #10 (defensive): meAssignments is algo-shape per v1 contract
    // — adapter is identity for well-formed input. Defends against legacy DB
    // rows that may carry exemption-shape keys here (R3 from Risk Register).
    var canonicalMeKey = toCanonicalKey(keyAdapter, meKeys[mk]);
    if (canonicalMeKey) {
      meAssignmentsMap[canonicalMeKey] = meAssignments[meKeys[mk]];
    } else {
      diagnostics.orphanMeAssignments = (diagnostics.orphanMeAssignments || 0) + 1;
    }
    ```

  - Run `npm test` — full suite must remain green; no behavior change expected for well-formed input because the adapter is identity for algo-shape `meAssignments` keys (per the v1 contract).
  - Run `npm run lint` — zero new warnings.
  - **EXPECTED OUTCOME**: Defensive adapter prevents future leaks if `meAssignments` ever ends up exemption-keyed in legacy DB rows. `diagnostics.orphanMeAssignments` is 0 for well-formed input. Full suite still green.
  - _Bug_Condition: NOT isBugCondition(X) — defensive only; addresses R3 from Risk Register_
  - _Expected_Behavior: design.md §"Wiring at `meAssignmentsMap` build" + boundary closure invariant_
  - _Preservation: Req 3.1, 3.6, 3.11, 3.15 — identity for well-formed input_
  - _Edit site: Row #10 (DEFENSIVE)_
  - _File: js/algorithms/proctor-distribution-v2.js (≈line 1741)_
  - _Hypothesis: Risk R3 (legacy meAssignments may be exemption-keyed)_
  - _Phase: D (Boundary Adapters)_
  - _Requirements: 2.4, 2.11_

- [x] 8. Verify Property 1 (Bug Condition fixed) — re-run pre-existing exploration test + add invariant locks

  - [x] 8.1 Re-run Task 1 exploration test — expect it to NOW PASS
    - **Property 1: Expected Behavior** — Single-Identity in Output (post-fix)
    - **IMPORTANT**: Re-run the SAME test from Task 1 — do NOT write a new test.
    - The test from Task 1 encodes the bug-condition assertion (no proctor has both `K1` and `K2` present in the output).
    - When this test passes, it confirms `isBugCondition(R_mem') = false` for the production fixture — i.e. the dual-identity has been eliminated by the canonicalization at #11 + #17.
    - Run `tests/proctor-v2-key-shape-bug-exploration.test.js` against FIXED code (`F'`).
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed).
    - At this point, the test transitions from "exploratory pre-fix" to "permanent regression lock". Remove the `// @pre-fix exploratory test — EXPECTED to FAIL on F` tag from the file header, OR keep the tag and add a closing comment `// @post-fix: now PASSES on F' — locks Property 1 for the production fixture`.
    - _Bug_Condition: isBugCondition(X) — must be false post-fix per Property 1_
    - _Expected_Behavior: Property 1, P-1 single-identity (design.md §"Correctness Properties")_
    - _File: tests/proctor-v2-key-shape-bug-exploration.test.js (existing from Task 1)_
    - _Requirements: 2.1, 2.5, 2.6, 2.7_

  - [x] 8.2 Add `tests/proctor-v2-no-ghost-keys.test.js` — production-fixture regression lock
    - **Property 1: Expected Behavior** — No Ghost CIN Keys on Production Fixture
    - Hard-coded regression test per design.md §"Property-Based Tests" → `tests/proctor-v2-no-ghost-keys.test.js`.
    - Load `tests/fixtures/45454.json`, run `ProctorDistributionV2.run(input)`.
    - Assert: the 6 known ghost CINs `['1909564', '2367149', '1910812', '2158781', '1545317', '1177902']` are ABSENT from `R_mem'.proctor_keys` AND from `R_mem'.reserve_keys` (Req 2.5, Property 1 P-4).
    - Assert: `max(histogramByCanonicalKey(R_mem'.proctor_keys))` equals 3 truthfully — no proctor has hidden +1 load via dual identity (Req 2.6, Property 1 P-4).
    - Run on FIXED code.
    - **EXPECTED OUTCOME**: Test PASSES — confirms `histogramByCanonicalKey(R_mem')` truthful max=3 on production fixture.
    - _Bug_Condition: isBugCondition(X) — false post-fix on production fixture_
    - _Expected_Behavior: Property 1, P-2 truthful max + P-4 production-fixture invariant_
    - _File: tests/proctor-v2-no-ghost-keys.test.js (NEW)_
    - _Requirements: 2.1, 2.5, 2.6, 2.12_

  - [x] 8.3 Add `tests/proctor-v2-key-shape-unity.test.js` — Property 1 universal lock
    - **Property 1: Expected Behavior** — Canonical Single-Identity Universal Property
    - Property-based test per design.md §"Property-Based Tests" → `tests/proctor-v2-key-shape-unity.test.js`.
    - Use the existing fast-check generators from the proctor-v2 PBT suite to generate proctor lists with mixed cin/som/empty proctors (cover all Edge Cases from design.md: all-cin, synthetic-only, production-case, mixed).
    - Run `ProctorDistributionV2.run(input)` for each generated input.
    - Assert Property 1 (single-identity) for every proctor across `proctor_keys`, `reserve_keys`, AND `loadState` keys (P-1, P-3 closure).
    - Run on FIXED code.
    - **EXPECTED OUTCOME**: Test PASSES — Property 1 holds for every generated input across the full Edge Cases matrix. Confirms boundary closure invariant.
    - _Bug_Condition: isBugCondition(X) — false post-fix for all inputs_
    - _Expected_Behavior: Property 1, P-1 + P-3 (universal canonical-shape closure)_
    - _File: tests/proctor-v2-key-shape-unity.test.js (NEW)_
    - _Requirements: 2.1, 2.2, 2.4, 2.7, 2.12_

  - [x] 8.4 Verify `histogramByCanonicalKey(R_mem)` truthful max=3 on production fixture
    - Run `node scripts/verify-fixture.js tests/fixtures/45454.json` against FIXED code.
    - Assert: P1, P2, P3 all PASS (Req 3.4 — closed-spec fairness invariant restored to truth).
    - Cross-reference: the histogram from this script should match the histogram asserted in Task 8.2 — `max=3` truthfully, with the 6 previously-affected proctors each carrying a single canonical-key count equal to their TRUE total load (≤ 3, honoring `proctor-v2-fairness-undercovered-fix`).
    - **EXPECTED OUTCOME**: Script reports P1/P2/P3 PASS. The closed spec's `max=3` claim is now TRUTHFUL on the production fixture for the first time.
    - _Bug_Condition: isBugCondition(X) — false on production fixture post-fix_
    - _Expected_Behavior: Property 1, P-2 + P-4_
    - _File: (verification script — no edits)_
    - _Requirements: 2.6, 3.4, 3.8_

- [x] 9. Verify Property 2 (Preservation) — re-run pre-existing tests + node scripts + lint

  - [x] 9.1 Re-run Task 2 preservation tests — all still PASS
    - **Property 2: Preservation** — Pre-Fix Baseline Holds Post-Fix
    - **IMPORTANT**: Re-run the SAME tests from Task 2 — do NOT write new tests.
    - Run `tests/proctor-v2-key-adapter-unit.test.js` (Task 2.1 + Task 3) — all six adapter cases must PASS now (helpers exist post-Task 4).
    - Run `tests/proctor-v2-all-cin-preservation.test.js` (Task 2.2) — must still PASS (`NOT C(X)` inputs unchanged per Req 3.6, 3.15). Compare snapshot from Task 2.2 against post-fix output: must match byte-for-byte modulo the additive `diagnostics.orphanDutyKeys` and `diagnostics.orphanMeAssignments` (both 0 on well-formed input).
    - **EXPECTED OUTCOME**: Both Task 2 tests PASS. Adapter unit tests pass. All-cin preservation snapshot matches.
    - _Bug_Condition: NOT isBugCondition(X) — preservation domain_
    - _Expected_Behavior: Property 2 — observational equivalence on `NOT C(X)` inputs_
    - _Preservation: Req 3.6, 3.15_
    - _File: tests/proctor-v2-key-adapter-unit.test.js, tests/proctor-v2-all-cin-preservation.test.js_
    - _Requirements: 3.6, 3.15_

  - [x] 9.2 Re-run all `tests/proctor-v2-*.test.js` — no regressions
    - Run the full proctor-v2 test family per Req 3.1.
    - Assert all previously-passing tests (baseline from Task 2.3) STILL pass.
    - **EXPECTED OUTCOME**: Full proctor-v2 suite green; zero new failures.
    - _Preservation: Req 3.1_
    - _Requirements: 3.1_

  - [x] 9.3 Re-run all `tests/inv-h5-*.test.js` — no regressions
    - Run the full H5 cross-page-consistency family per Req 3.2.
    - Assert `tests/inv-h5-cross-page-consistency.test.js` still passes — the post-H5 display-layer fix from `proctor-distribution-db-memory-mismatch` continues to hold with canonical-shape keys carried in `proctor_keys`.
    - **EXPECTED OUTCOME**: H5 invariant still holds post-key-shape-unification.
    - _Preservation: Req 3.2, 3.9_
    - _Requirements: 3.2, 3.9_

  - [x] 9.4 Re-run `tests/preservation-config-roundtrip.pbt.test.js` — still PASS
    - Run the round-trip PBT per Req 3.3.
    - Assert IPC round-trip stable for all 13 config keys including `examAutoDistributionData` (this proves R1 mitigation: v1 byte-equality preserved because `getProctorKey` and `getProctorExemptionKey` function bodies are untouched).
    - **EXPECTED OUTCOME**: Round-trip property holds; `examAutoDistributionData` save/load is byte-stable.
    - _Preservation: Req 3.3, 3.13_
    - _Requirements: 3.3, 3.13_

  - [x] 9.5 Run `node scripts/verify-fixture.js tests/fixtures/45454.json` — P1/P2/P3 PASS
    - Algorithm-level verification on production fixture per Req 3.4.
    - **EXPECTED OUTCOME**: P1/P2/P3 all PASS (cross-checked against Task 8.4).
    - _Preservation: Req 3.4, 3.8_
    - _Requirements: 3.4, 3.8_

  - [x] 9.6 Run `node scripts/verify-real-centre.js` — P1/P2/P3 PASS
    - Algorithm-level verification on real-centre fixture per Req 3.5.
    - **EXPECTED OUTCOME**: P1/P2/P3 all PASS.
    - _Preservation: Req 3.5_
    - _Requirements: 3.5_

  - [x] 9.7 Run `npm run lint` — 0 new errors/warnings vs Task 2.3 baseline
    - Lint regression check per Req 3.10.
    - Compare against the baseline count recorded in the Task 2.1 file header comment.
    - **EXPECTED OUTCOME**: Zero new errors, zero new warnings vs the Task 2.3 baseline.
    - _Preservation: Req 3.10_
    - _Requirements: 3.10_

- [x] 10. Manual Electron verification (deferred to user — Node tests cannot drive Electron)
  - **NOTE**: This task is deferred to manual verification because Electron is required to drive the renderer + IPC + DB layer end-to-end. Node tests confirm algorithm correctness (Tasks 8–9); this task confirms the fix holds in the production runtime.

  - [x] 10.1 Reproduce the original bug condition in Electron
    - Launch the application in Electron with the user's production data (or load `tests/fixtures/45454.json` via the import path).
    - Run distribute (the Phase 1 → Phase 2 → Phase 2.5 → Phase 2.75 → Phase 3 pipeline) via the UI.
    - Navigate to `exams-rooms.html`.
    - Confirm the page renders without errors and the summary table shows the proctor counts.
    - _Bug_Condition: isBugCondition(X) — must be false post-fix in the live renderer_
    - _Expected_Behavior: Property 1, P-4_
    - _Requirements: 1.8, 2.5, 3.4_

  - [x] 10.2 Run the user's devtools "Detect dual-identity proctors" script
    - In the renderer devtools console, paste the script from `.agent/proctor-v2-key-shape-bug.md` §"Verification Scripts (devtools console)" → "Script 1: Detect dual-identity proctors".
    - **EXPECTED OUTPUT**: `ghost keys (in DB but not valid): 0` — i.e. the orphan-key set is empty.
    - This is the same script that originally surfaced the bug; its output going from "6 ghost keys" to "0 ghost keys" is the closing witness.
    - _Bug_Condition: isBugCondition(X) — verified false in production-equivalent runtime_
    - _Expected_Behavior: Property 1, P-4_
    - _Requirements: 1.8, 2.5_

  - [x] 10.3 Verify the 6 specific proctors carry truthful canonical loads
    - In the renderer, inspect the rooms-page summary for the 6 affected proctors:
      - ايت حدو فؤاد (idx 43, som 1909564)
      - السعدوي عمر (idx 78, som 2367149)
      - تيكوردي إشراق (idx 66, som 1910812)
      - ايمان تنون (idx 92, som 2158781)
      - المكاني محمد (idx 50, som 1545317)
      - وردية بوعادي (idx 47, som 1177902)
    - Assert each appears under EXACTLY ONE canonical key (`__idx_N`) with their TRUE total load — which post-fix is ≤ 3 (per Req 2.6 and the closed `proctor-v2-fairness-undercovered-fix` invariant).
    - _Bug_Condition: isBugCondition(X) — false_
    - _Expected_Behavior: Property 1, P-4_
    - _Requirements: 2.5, 2.6, 3.8_

  - [x] 10.4 Document the manual-verification outcome
    - Append a closing note to `tests/inv-notes.md` (if it exists) OR create `.agent/proctor-v2-key-shape-bug-closed.md` recording:
      - Date of manual verification.
      - Devtools script output (`ghost keys: 0`).
      - The 6 proctors' canonical-key load values post-fix.
      - Confirmation that `histogramByCanonicalKey` matches the Node-test histogram from Task 8.4.
    - This closes the investigation thread for the next agent.
    - _File: tests/inv-notes.md (append) OR .agent/proctor-v2-key-shape-bug-closed.md (NEW)_
    - _Requirements: 2.12, 3.8_

- [x] 11. Checkpoint — final verification

  - [x] 11.1 All correctness properties (P1, P2) hold
    - Confirm Task 8 outcomes: Property 1 (single-identity, no ghost keys, truthful max=3 on production fixture) is locked by `tests/proctor-v2-key-shape-unity.test.js` and `tests/proctor-v2-no-ghost-keys.test.js`, and re-validated by the renamed `tests/proctor-v2-key-shape-bug-exploration.test.js`.
    - Confirm Task 9 outcomes: Property 2 (preservation) is locked by the full existing suite + the all-cin preservation test + `tests/preservation-config-roundtrip.pbt.test.js`.
    - _Requirements: 2.1, 2.2, 2.5, 2.6, 2.7, 3.6, 3.15_

  - [x] 11.2 All preservation requirements satisfied (15 SHALL CONTINUE TO clauses)
    - Walk through bugfix.md §"Unchanged Behavior (Regression Prevention)" clauses 3.1 through 3.15.
    - For each clause, confirm the corresponding Task 9 sub-task verified it: 3.1→9.2; 3.2→9.3; 3.3→9.4; 3.4→9.5; 3.5→9.6; 3.6, 3.15→9.1; 3.7→9.1 (synthetic case in adapter unit test); 3.8, 3.9→9.3 + 9.5; 3.10→9.7; 3.11→9.2/9.3/9.4; 3.12→11.3; 3.13→11.4; 3.14→10.1.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15_

  - [x] 11.3 DB schema unchanged
    - Run `git diff main/db/migrations.js` against the spec base branch.
    - Assert: empty diff (Req 3.12).
    - _File: main/db/migrations.js (read-only verification)_
    - _Requirements: 3.12_

  - [x] 11.4 IPC contract unchanged
    - Run `git diff main/ipc/exam-config-data.js` against the spec base branch.
    - Assert: empty diff (Req 3.13).
    - _File: main/ipc/exam-config-data.js (read-only verification)_
    - _Requirements: 3.13_

  - [x] 11.5 No edits outside `js/algorithms/proctor-distribution-v2.js` + new test files
    - Run `git diff --stat` against the spec base branch.
    - Assert only the following files appear in the diff:
      1. `js/algorithms/proctor-distribution-v2.js` (modified — adapter helpers + 3 edit sites)
      2. `tests/proctor-v2-key-adapter-unit.test.js` (new)
      3. `tests/proctor-v2-key-shape-unity.test.js` (new)
      4. `tests/proctor-v2-no-ghost-keys.test.js` (new)
      5. `tests/proctor-v2-key-shape-bug-exploration.test.js` (new — Task 1)
      6. `tests/proctor-v2-all-cin-preservation.test.js` (new — Task 2.2)
      7. `.agent/proctor-v2-key-shape-bug.md` (appended closing note from Task 11.6) and/or `.agent/proctor-v2-key-shape-bug-closed.md` (Task 10.4)
      8. `.kiro/specs/proctor-v2-key-shape-unification/*` (the spec docs themselves)
    - Specifically assert: NO edits to display layer (`exams-rooms.html`, `exams-proctors.html`), `js/data/proctor-key-resolver.js`, IPC handlers, DB migrations, or any other algorithm file.
    - _Requirements: 2.11_

  - [x] 11.6 Update `.agent/proctor-v2-key-shape-bug.md` with closing summary
    - Append a "Closure" section to `.agent/proctor-v2-key-shape-bug.md` recording:
      - Spec name and date closed.
      - Canonical shape selected (Option A — algo shape `cin || '__idx_' + idx`).
      - Files modified: `js/algorithms/proctor-distribution-v2.js` (5 changes — 2 helper additions, 3 wiring edits at sites #10, #11, #17).
      - Tests added: 3 new permanent + 2 transient pre-fix scaffolding tests promoted to permanent regression locks.
      - Confirmation that `proctor-v2-fairness-undercovered-fix`'s `max=3` claim is now TRUTHFUL on `tests/fixtures/45454.json`.
      - Confirmation that `proctor-distribution-db-memory-mismatch`'s display-layer fix continues to work correctly with canonical-shape keys carried in `proctor_keys`.
    - _File: .agent/proctor-v2-key-shape-bug.md_
    - _Requirements: 2.8, 3.8, 3.9_

  - [x] 11.7 Final test pass — `npm test` all green, `npm run lint` clean
    - Run `npm test` — full suite GREEN, zero failures.
    - Run `npm run lint` — zero new errors/warnings vs Task 2.3 baseline.
    - Run `node scripts/verify-fixture.js tests/fixtures/45454.json` — P1/P2/P3 PASS.
    - Run `node scripts/verify-real-centre.js` — P1/P2/P3 PASS.
    - **EXPECTED OUTCOME**: All four commands green. Spec is closed.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.10, 3.11_
