# Implementation Plan

- [x] 1. Write bug condition exploration property test
  - **Property 1: Bug Condition** - Reserve_Global_Upper is respected when avoidable
  - **CRITICAL**: This test MUST FAIL on the unfixed Phase 9 — failure confirms the bug exists.
  - **DO NOT** attempt to fix the test or the production code when it fails; the failure is the desired outcome at this step.
  - **NOTE**: This same test, unmodified, will validate the fix when it is re-run after Task 3 / Task 4 / Task 5.
  - **GOAL**: Surface counterexamples that demonstrate Phase 9 lifts proctors past `Reserve_Global_Upper` while at least one under-cap eligible candidate is available for the same session.
  - Add a new test file `tests/proctor-v3/reserves-final-load-cap.test.js` (or extend `tests/proctor-v3/reserves.test.js`); reuse the existing harness `runUpToPhase9` and `placeReserves` from `tests/proctor-v3/reserves.test.js` and `arbitraryInput` from `tests/proctor-v3/pbt-helpers.js`.
  - Encode the bug condition from `design.md` → "Bug Details" → "Bug Condition" (`isBugCondition` pseudocode):
    - Compute `G := state.bounds.global.gTotalSlots`, `D := state.bounds.global.dExpected`, `N := state.bounds.global.nEligible` after running phases 0..4.
    - Compute `R := Σ_meta computeReserveTarget(reservesConfig, meta.guardCount)` over grouped sessions exactly as Phase 9 does today.
    - `cap := Math.ceil((G + R + D) / N)`.
  - Assertion (post Phase 9): `max(finalLoad over loadState.proctors) <= cap` (from `design.md` → "Correctness Properties" → Property 1, branch (a)).
  - **Scoped PBT approach** for the deterministic counterexample:
    - Sub-case A — production fixture: load `tests/fixtures/45454.json`, run Phase 9 on the unfixed code, compute `cap` as above, assert `max(finalLoad) <= cap`. Expect FAIL today (`cap = 3`, observed `max = 4`; matches AC-FL7).
    - Sub-case B — PBT-generated counterexamples: use `arbitraryInput` (or a tightened generator) to produce inputs where at least one session has both an under-cap candidate (`finalLoad + 1 <= cap`) and an at-cap candidate (`finalLoad + 1 > cap`) sharing the same `reserveCount`, where the at-cap candidate has lower `affinityRank`. Assert `max(finalLoad) <= cap`. Expect FAIL today.
  - Diagnostics presence assertion (deferred to validation in Task 6, but seeded here): also assert that on the unfixed code `state.diagnostics.finalLoadOverflows === undefined` (this asserts the field is absent today; after the fix it will become an empty array and this sub-assertion will be relaxed in Task 6).
  - Run the test on the UNFIXED code and document the counterexamples found (e.g. `45454.json` → `Final_Load = 4` for `محماد علاوي`, `عبد الرحيم مسدد`, `سكينة الرفيع`, `سماح اكان`; PBT seed → minimal session with one at-cap pick lifted past `cap`).
  - **EXPECTED OUTCOME**: Test FAILS on the current `js/algorithms/proctor-v3/phases/09-place-reserves.js`. Mark task complete when the failure is reproduced and the counterexamples are recorded in the test output.
  - _Bug_Condition: `isBugCondition(input)` from `design.md` → "Bug Details" → "Bug Condition"_
  - _Expected_Behavior: `design.md` → "Correctness Properties" → Property 1_
  - _Validates: AC-FL1, AC-FL2, AC-FL7 from `.agent/proctor-v3-reserve-final-load-fairness.md`_
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-buggy inputs unchanged
  - **IMPORTANT**: Follow observation-first methodology. Run the UNFIXED Phase 9 on the production fixture and on PBT-generated inputs, record the observed outputs (`rows`, `histogramByGuardCount`, `histogramByPrimaryLoad`, per-proctor `reserveCount`), then encode those observations as the property assertions.
  - **GOAL**: Capture the current behaviour for inputs/dimensions that the fix MUST NOT touch, so any later regression is detected automatically.
  - Add the tests to the same file as Task 1 (`tests/proctor-v3/reserves-final-load-cap.test.js`) under a `describe('Preservation', …)` block, alongside the existing assertions in `tests/proctor-v3/reserves.test.js`.
  - **Test Case 2.1 — Histogram preservation (PBT)**: for `arbitraryInput`-generated inputs, snapshot `computeHistogramByGuardCount(rows)` and `computeHistogramByPrimaryLoad(loadState, canonicalByProctorKey)` from a single Phase 9 run; assert these histograms are byte-identical to the snapshot taken on the unfixed code. Today the test passes by construction (single run), and after the fix it will continue to pass because Phase 9 never touches `proctor_keys` or `Primary_Load`.
  - **Test Case 2.2 — Reserve_Count gap preservation**: load `tests/fixtures/45454.json`, compute the per-proctor `reserveCount` distribution and assert `max(reserveCount) - min(reserveCount) <= 1` (today: `{0: 68, 1: 79}`, gap 1). Must PASS on the unfixed code.
  - **Test Case 2.3 — Determinism preservation (Requirement 8)**: run Phase 9 twice on the same input with the same `randomSeed`; assert `JSON.stringify(state_a.rows) === JSON.stringify(state_b.rows)` and `JSON.stringify(state_a.loadState) === JSON.stringify(state_b.loadState)` and `JSON.stringify(state_a.diagnostics) === JSON.stringify(state_b.diagnostics)`. Must PASS on the unfixed code.
  - **Test Case 2.4 — Affinity intra-tier preservation (PBT)**: build (or generate) inputs where every eligible candidate falls into Tier 1 (cap is generous OR `R = 0` per `computeReserveTarget`). Snapshot the per-row `reserve_keys` ordering. Today this snapshot is produced by the unfixed comparator `(reserveCount, affinityRank, finalLoad, key)`; after the fix the snapshot must be byte-identical (Tier 2 is empty, so `[...Tier1, ...Tier2]` collapses to the same ordering). Must PASS on the unfixed code.
  - **Test Case 2.5 — `reserveImbalances` preservation (AC 7.8)**: for the production fixture, snapshot `state.diagnostics.reserveImbalances`; assert it remains structurally identical (same length, same sessionKeys) — the new `finalLoadOverflows` list is purely additive. Must PASS on the unfixed code.
  - **Test Case 2.6 — Per-row fresh arrays (AC 10.2 / 7.4a)**: assert that for every row, mutating `row.reserve_keys` does not affect any other row, and that no `canonicalKey` appears more than once within a single session's reserves. Must PASS on the unfixed code.
  - Run the entire suite on the UNFIXED code.
  - **EXPECTED OUTCOME**: All preservation tests PASS on the unfixed Phase 9. Mark task complete when the suite is green and the snapshots have been recorded.
  - _Preservation: `design.md` → "Expected Behavior" → "Preservation Requirements" + "Correctness Properties" → Property 2_
  - _Validates: AC-FL4, AC-FL5, AC-FL6, AC-FL8 from `.agent/proctor-v3-reserve-final-load-fairness.md`_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 3. Apply Phase 9 fix in `09-place-reserves.js`

  - [x] 3.1 Compute `Reserve_Global_Upper` once per run and thread it into `ctx`
    - File: `js/algorithms/proctor-v3/phases/09-place-reserves.js`.
    - Inside `placeReserves()`, after `reservesConfig = resolveReservesConfig(input)` and after `grouped = groupRowsBySession(rows)`, derive:
      - `G := state.bounds && state.bounds.global ? state.bounds.global.gTotalSlots : Σ row.guard_count` (defensive fallback).
      - `D := state.bounds && state.bounds.global ? state.bounds.global.dExpected : 0`.
      - `N := state.bounds && state.bounds.global ? state.bounds.global.nEligible : eligibleProctorCount(input)` (use existing helper if available; otherwise count proctors with `eligibility !== 'exempt'` from `input.proctors`).
      - `R := Σ_meta computeReserveTarget(reservesConfig, meta.guardCount)` over `grouped.sessions` (use the same `computeReserveTarget` already imported by Phase 9; do not change its formula — AC 7.2 / 7.3 unchanged).
      - `reserveGlobalUpper := N > 0 ? Math.ceil((G + R + D) / N) : 0`.
    - Attach `reserveGlobalUpper` to the `ctx` object that is already passed into `buildCandidatePool()`.
    - _Bug_Condition: `isBugCondition(input)` from `design.md`_
    - _Expected_Behavior: `design.md` → "Fix Implementation" → "Changes Required" step 1_
    - _Validates: AC-FL1_
    - _Requirements: 2.1, 2.2_

  - [x] 3.2 Initialize `nextDiag.finalLoadOverflows` on every code path (including early-return)
    - File: `js/algorithms/proctor-v3/phases/09-place-reserves.js`.
    - In the block that prepares `nextDiag` at the top of `placeReserves()`, add:
      ```js
      nextDiag.finalLoadOverflows = (prevDiag && Array.isArray(prevDiag.finalLoadOverflows))
          ? prevDiag.finalLoadOverflows.slice()
          : [];
      ```
    - Verify the assignment runs BEFORE every `return` in the function, including the empty-rows early return and the missing-`loadState` early return — the field SHALL ALWAYS be present as a fresh array (Requirement 2.4).
    - _Expected_Behavior: `design.md` → "Fix Implementation" → "Changes Required" steps 2 and 5_
    - _Validates: AC-FL3_
    - _Requirements: 2.3, 2.4_

  - [x] 3.3 Partition the candidate pool into Tier 1 / Tier 2 inside `buildCandidatePool()`
    - File: `js/algorithms/proctor-v3/phases/09-place-reserves.js`.
    - In `buildCandidatePool()`, after each candidate's `(reserveCount, affinityRank, finalLoad, key)` triple is computed but BEFORE the existing `pool.sort(...)`, push each candidate into one of two arrays:
      ```js
      if ((finalLoad + 1) <= ctx.reserveGlobalUpper) {
          tier1.push(candidate);
      } else {
          tier2.push(candidate);
      }
      ```
    - Sort `tier1` and `tier2` INDEPENDENTLY using the existing comparator `(a.reserveCount - b.reserveCount, a.affinityRank - b.affinityRank, a.finalLoad - b.finalLoad, a.key < b.key ? -1 : a.key > b.key ? 1 : 0)`. The comparator MUST NOT change — affinity remains the second intra-tier criterion (AC 7.5 / 7.6 / 7.7).
    - Return `tier1.concat(tier2)`. Tier-1 candidates are exhausted before any Tier-2 candidate is considered.
    - Edge case: when `ctx.reserveGlobalUpper === 0` (i.e. `N === 0`), the candidate pool itself is empty, so the partition is a no-op. Document this in a code comment.
    - _Bug_Condition: `isBugCondition(input)` from `design.md`_
    - _Expected_Behavior: `design.md` → "Fix Implementation" → "Changes Required" step 3 + "Reserve-pick decision (per session)" sequence diagram_
    - _Validates: AC-FL2, AC-FL4_
    - _Requirements: 2.1, 2.2, 3.1_

  - [x] 3.4 Record forced overflows in the per-session pick loop
    - File: `js/algorithms/proctor-v3/phases/09-place-reserves.js`.
    - Inside `placeReserves()`'s per-session loop, in the existing `for (var pj = 0; pj < actualPick; pj += 1)` block, after `pick = pool[pj]` but BEFORE `chosenForSession[pick.key] = true` and the load mutations, add:
      ```js
      if ((pick.finalLoad + 1) > ctx.reserveGlobalUpper) {
          nextDiag.finalLoadOverflows.push({
              sessionKey: meta.sessionKey,
              canonicalKey: pick.key,
              finalLoad: pick.finalLoad + 1,
              cap: ctx.reserveGlobalUpper,
              reason: 'forced_overflow'
          });
      }
      ```
    - The placement itself proceeds unchanged — the role is mandatory (AC 7.2 / 7.3); the overflow is recorded, not refused.
    - _Expected_Behavior: `design.md` → "Fix Implementation" → "Changes Required" step 4_
    - _Validates: AC-FL3_
    - _Requirements: 2.3_

- [x] 4. Surface `finalLoadOverflows` in diagnostics and orchestrator fallbacks

  - [x] 4.1 Copy `finalLoadOverflows` through `diagnostics.js`
    - File: `js/algorithms/proctor-v3/diagnostics.js`.
    - In the diagnostics builder (the function that assembles the public `diagnostics` object from `stateDiag`), add an explicit field copy:
      ```js
      finalLoadOverflows: safeArrayCopy(stateDiag.finalLoadOverflows),
      ```
    - Use the existing `safeArrayCopy` helper (do not add a new one). The field is additive — no existing field is renamed or removed.
    - _Expected_Behavior: `design.md` → "Fix Implementation" → "Changes Required" → File: `diagnostics.js`_
    - _Validates: AC-FL3_
    - _Requirements: 2.3, 2.4_

  - [x] 4.2 Add `finalLoadOverflows: []` to orchestrator early-exit fallback shapes
    - File: `js/algorithms/proctor-v3/orchestrator.js`.
    - In the validation-error fallback diagnostics shape (≈ line 451 per `design.md`), add `finalLoadOverflows: []`.
    - In the no-result fallback diagnostics shape (≈ line 613 per `design.md`), add `finalLoadOverflows: []`.
    - Confirm via reading both blocks that no other field set diverges from the success-path shape.
    - _Expected_Behavior: `design.md` → "Fix Implementation" → "Changes Required" → File: `orchestrator.js`_
    - _Validates: AC-FL3_
    - _Requirements: 2.4_

- [x] 5. Rebuild the V3 bundle
  - Run `npm run build:v3-bundle`.
  - Confirm `js/algorithms/proctor-v3.bundle.js` is regenerated and includes the new tier/partition logic and the `finalLoadOverflows` field. Do not hand-edit the bundle.
  - _Expected_Behavior: `design.md` → "Fix Implementation" → "Changes Required" → File: `js/algorithms/proctor-v3.bundle.js`_
  - _Requirements: 3.4_

- [x] 6. Validation — re-run exploration and preservation suites + production fixture integration

  - [x] 6.1 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Reserve_Global_Upper is respected when avoidable
    - **IMPORTANT**: Re-run the SAME tests written in Task 1 — do NOT modify them, do NOT write new tests.
    - Relax only the diagnostics-presence sub-assertion that checked `finalLoadOverflows === undefined` on unfixed code: after the fix it must be `Array.isArray(state.diagnostics.finalLoadOverflows) === true` (typically `[]` on `45454.json`).
    - **EXPECTED OUTCOME**: All assertions PASS — `max(finalLoad) <= cap` on `tests/fixtures/45454.json` and on every PBT-generated input.
    - _Expected_Behavior: `design.md` → "Testing Strategy" → "Fix Checking" + "Correctness Properties" → Property 1_
    - _Validates: AC-FL1, AC-FL2, AC-FL3, AC-FL7_
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 6.2 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-buggy inputs unchanged
    - **IMPORTANT**: Re-run the SAME tests written in Task 2 — do NOT modify them, do NOT write new tests.
    - **EXPECTED OUTCOME**: All preservation tests PASS — `histogramByGuardCount`, `histogramByPrimaryLoad`, per-proctor `reserveCount`, `reserveImbalances`, determinism, affinity intra-tier ordering, and per-row fresh arrays are all preserved.
    - _Preservation: `design.md` → "Testing Strategy" → "Preservation Checking" + "Correctness Properties" → Property 2_
    - _Validates: AC-FL4, AC-FL5, AC-FL6, AC-FL8_
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 6.3 Production fixture integration assertion
    - File under test: `tests/fixtures/45454.json` (run end-to-end through the V3 orchestrator after the bundle rebuild from Task 5).
    - Compute `G`, `R`, `D`, `N`, `cap = ceil((G + R + D) / N)` exactly as in Task 1.
    - Assert `max(Final_Load) <= cap` on the fixture (today: `cap = 3`, post-fix expected `max <= 3`; AC-FL7).
    - Assert `histogramByGuardCount` is byte-identical to a pre-fix snapshot of the same fixture (AC-FL6).
    - Assert `histogramByPrimaryLoad` is byte-identical to a pre-fix snapshot of the same fixture (AC-FL6).
    - Assert `Array.isArray(diagnostics.finalLoadOverflows) === true` and (on this fixture) `diagnostics.finalLoadOverflows.length === 0` (no forced overflow expected because 88+ FL=2 candidates were available for the offending session).
    - Assert reserve-count gap `max - min <= 1` (AC-FL5).
    - _Expected_Behavior: `design.md` → "Testing Strategy" → "Integration Tests" → "Production fixture (`tests/fixtures/45454.json`)"_
    - _Validates: AC-FL5, AC-FL6, AC-FL7_
    - _Requirements: 2.2, 3.2, 3.3_

- [x] 7. Checkpoint — full V3 suite + lint
  - Run `npm run test:v3`. All tests SHALL pass, including the existing AC 7.x assertions in `tests/proctor-v3/reserves.test.js` (affinity, at-most-once, per-row fresh arrays, AC 7.8 imbalances) and the new tests from Tasks 1, 2, and 6.3.
  - Run `npm run lint`. SHALL pass without warnings.
  - If any test fails or the lint reports new issues, STOP and ask the user before deviating from the design.
  - _Expected_Behavior: `design.md` → "Testing Strategy" → "Integration Tests" → "Lint + full V3 suite"_
  - _Validates: AC-FL1..AC-FL8 (full pass)_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_
