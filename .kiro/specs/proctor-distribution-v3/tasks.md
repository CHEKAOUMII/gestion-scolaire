# Implementation Plan — Proctor Distribution V3

## Overview

This document breaks the V3 design into discrete, sequential coding tasks. Each task references specific Acceptance Criteria from `requirements.md` and Phase/Component entries from `design.md`. Tasks are ordered to respect dependencies and to keep the codebase compilable at every checkpoint.

**Conventions**:
- Each task is a standalone unit of work that can be reviewed independently.
- Each task lists the files it creates/modifies and the requirements it satisfies.
- Tasks producing PBT helpers come before tests that consume them.
- The repository compiles and `npm test` passes after each task.
- Tasks containing **⚠️ V2 pitfall** notes link to specific bugs documented in `v2-review.md` that must be avoided.

**Reference documents**:
- `requirements.md` — what V3 must do
- `design.md` — how V3 is structured (CP+LS solver, phases, constraint matrix)
- `v2-review.md` — concrete V2 bugs to avoid (verified against `js/algorithms/proctor-distribution-v2.js` line-by-line)

---

## Tasks

## Section 1: Foundation (Phases 0–3)

- [x] **1. Set up V3 module skeleton**
  - Create directory `js/algorithms/proctor-v3/` with empty placeholders for: `index.js`, `orchestrator.js`, `canonical-key.js`, `diagnostics.js`, and subdirectories `constraints/`, `phases/`, `solver/`, `search/`, `utils/`
  - Create `js/algorithms/proctor-v3/README.md` with placeholder API docs
  - Add `tests/proctor-v3/` directory with empty placeholder for `pbt-helpers.js`
  - Verify `npm test` still passes (no new tests yet)
  - _Requirements: 1.1, 1.2_

- [x] **2. Implement seeded PRNG**
  - In `js/algorithms/proctor-v3/utils/prng.js`, implement `createPRNG(seed)` using mulberry32
  - Expose `next()` (returns float in `[0,1)`) and `nextInt(n)` (returns integer in `[0,n)`)
  - Record `seed` field on the returned object
  - Add unit tests in `tests/proctor-v3/prng.test.js`: identical seeds → identical sequences
  - _Requirements: 8.1, 8.2, 8.3_

- [x] **3. Implement canonical key and key adapter**
  - In `js/algorithms/proctor-v3/canonical-key.js`, implement:
    - `canonicalProctorKey(proc, idx)` — single identity function (cin trimmed or `__idx_N`)
    - `buildKeyAdapter(proctorsList)` — returns map from external keys to canonical keys
    - `toCanonical(adapter, externalKey)` — returns canonical or `null` if unresolvable
  - Add unit tests in `tests/proctor-v3/canonical-key.test.js` covering: cin variants, som-only, empty both, idx_N forms, unresolvable keys
  - **⚠️ V2 pitfall**: V2 had two identity functions (`getProctorKey` returning `cin || '__idx_N'` AND `getProctorExemptionKey` returning `cin || som || 'idx_N'`). V3 MUST have only ONE. Also, V2 omitted `.trim()` on `cin`, causing ghost keys when input data had trailing spaces. V3 MUST trim.
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] **4. Implement input validation (Phase 0)**
  - In `js/algorithms/proctor-v3/phases/00-validate.js`, implement `validateInput(input)`
  - Check required fields: `proctorsList`, `scheduleEntries`, `examDistributionRules` exist and are correct types
  - Return either `{ valid: true, errors: [] }` or `{ valid: false, errors: [...] }`
  - Validate `examCenterLevels` shape if present
  - Add unit tests in `tests/proctor-v3/validate.test.js`
  - _Requirements: 1.3, 9.7_

- [x] **5. Implement key normalization (Phase 1)**
  - In `js/algorithms/proctor-v3/phases/01-normalize-keys.js`, implement `normalizeKeys(state)`
  - Build adapter, translate `dutyData`/`exemptionsData`/`meAssignments` keys to canonical
  - Compute `orphanInputKeys` array of unresolvable external keys
  - Add property test in `tests/proctor-v3/normalize-keys.test.js`: every entry in normalized data is a canonical key
  - _Requirements: 2.3, 2.4, 2.7_

- [x] **5b. Implement room synthesis and row construction (Phase 1b)** *(MOVED FROM Task 20 — was originally placed too late in the pipeline)*
  - In `js/algorithms/proctor-v3/phases/01b-build-rooms-and-rows.js`, implement `buildRoomsAndRows(state)`:
    - Read `examCenterLevels[L].rooms` for each level L in schedule
    - Compare with `examCenterRoomsData[L]` row count
    - Synthesize in-memory placeholder rooms if needed (M < N case) — **NEVER persist**
    - Record `synthetic_rooms` warning in diagnostics for any synthesis
    - For each `(scheduleEntry, room)` pair, create an **empty Result_Row** in `state.rows[]` with: `session_key`, `halfday_key`, `day_key`, `room_key`, `room_name`, AND empty `proctor_keys` array of length `proctorsPerRoom` (filled with `null`), empty `reserves`/`reserve_keys`/`duty_teachers`/`softViolations`
  - Add unit tests in `tests/proctor-v3/rooms.test.js`: synthetic count matches AC 11.2, all rows have correct shape
  - **⚠️ Pipeline dependency**: This phase MUST run BEFORE Task 14 (Place Guards / Phase 4) because the CP solver needs `state.rows` to exist before it can build variables. An earlier draft of `tasks.md` placed room synthesis as Task 20 (after reserves) — that was wrong.
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [x] **6. Implement eligibility class derivation (Phase 2)**
  - In `js/algorithms/proctor-v3/phases/02-eligibility-classes.js`, implement `deriveEligibilityClasses(state)`
  - For each proctor, compute `eligibleSessions`, `dutyHalfdays`, `meGroup`
  - Hash the tuple as a stable string and group proctors by hash
  - Build `classes[]` array and `classByProctorKey` map
  - Add unit tests in `tests/proctor-v3/eligibility-classes.test.js`: identical eligibility tuples → same class
  - _Requirements: 5.3, 5.4, 5.5_

- [x] **7. Implement bounds computation (Phase 3)**
  - In `js/algorithms/proctor-v3/constraints/bounds.js`, implement:
    - `computeGlobalBounds(gTotalSlots, dExpected, nEligible)` → `{ globalLowerBound, globalUpperBound }`
    - `computeClassBounds(classes, globalLower, globalUpper, dutyByClass, slotsByClass)` → bounds per class with monotonicity guard
  - In `js/algorithms/proctor-v3/phases/03-bounds.js`, wire these into the pipeline
  - Add unit tests asserting AC 5.2, 5.3, 5.4, 5.5 with edge cases (singleton classes, zero D_expected)
  - **⚠️ V2 pitfall**: V2 had TWO competing bounds formulas — `computeBounds(totalTasks - fixedReservedTasks, …)` AND `computeClassBounds(totalGuardSlots + expectedDuty, …)` — both running simultaneously, producing inconsistent diagnostics. V3 MUST use ONE formula: `floor((G + D) / N)`. Also, V2's monotonicity guard used `<` instead of `<=` (Acceptance Criterion 5.5); V3 MUST use `<=`.
  - _Requirements: 5.2, 5.3, 5.4, 5.5_

- [x] **8. Implement load state utilities**
  - In `js/algorithms/proctor-v3/utils/load-state.js`, implement:
    - `createLoadState(canonicalKeys)` — initialize all loads to zero
    - `addGuardLoad(loadState, key, halfdayKey, dayKey, sessionKey, period)` — increment guard count (slot-based: increment on EVERY call)
    - `addDutyLoad(loadState, key, halfdayKey)` — increment duty count (slot-based, since user-defined per-halfday entries map 1:1 with duty load)
    - `addReserveLoad(loadState, key, halfdayKey, dayKey)` — increment reserve count (slot-based: increment on EVERY call)
    - `primaryLoad(loadState, key)` — return guardCount + dutyCount
    - `finalLoad(loadState, key)` — return guard + reserve + duty counts
    - `amCount(loadState, key)` and `pmCount(loadState, key)` accessors (slot-based, computed from `addGuardLoad` calls)
  - Add unit tests in `tests/proctor-v3/load-state.test.js`
  - **⚠️ V2 pitfall**: V2's `addGuardLoad` is slot-based (correctly increments on every call), but `addReserveLoad` was halfday-based (only increments when a NEW halfday is added to a Set). This made `Reserve_Count` count distinct halfdays, NOT slots, breaking reserve fair-ordering (Req 7.5). V3 MUST be consistently slot-based across all three add functions. Also, V2's `computeLoadStats` used `guardCount` only (ignored duty); V3's stats helpers MUST use `primaryLoad`.
  - _Requirements: 5.1, 6.4, 7.5_

---

## Section 2: Hard Constraints

- [x] **9. Implement hard-constraint predicates**
  - In `js/algorithms/proctor-v3/constraints/hard-constraints.js`, implement:
    - `isExempt(proctor, idx, sessionKey, exemptionsData)` — C-EXEMPT
    - `isOnDuty(proctor, idx, halfdayKey, dutyData)` — C-DUTY
    - `isMEBlocked(proctor, idx, halfdayKey, meAssignments)` — C-ME
    - `wouldDoubleBookSession(loadState, key, sessionKey)` — C-NO-DOUBLE within session
    - `wouldViolateSameDay(loadState, key, halfdayKey, allowSameDay)` — C-NO-SAME-DAY
    - `wouldExceedClassUpper(loadState, key, classBounds, classByProctorKey)` — checks whether incrementing `Guard_Count(key)` would cause `(Guard_Count + Duty_Count) > Class_Upper_Bound(class(key))`. Must account for `Duty_Count` since Primary_Load is the fairness axis.
  - Add unit tests for each predicate in `tests/proctor-v3/hard-constraints.test.js`
  - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.10_

- [x] **10. Implement PBT helpers**
  - In `tests/proctor-v3/pbt-helpers.js`, implement:
    - `arbitraryProctor(rng)` — random proctor (cin/som/empty mixed)
    - `arbitraryProctorsList(rng, n)` — list of n proctors
    - `arbitraryScheduleEntries(rng, n, halfdays)` — n entries across halfdays
    - `arbitraryDutyData(rng, proctors, schedule)` — random duty assignments
    - `arbitraryExemptions(rng, proctors, schedule)` — random exemptions
    - `arbitraryInput(rng)` — full GS3_Input_Contract
  - These are pure: same `rng` state → same output
  - Add a smoke test that generates 10 inputs and verifies they pass `validateInput`
  - _Requirements: 14.1 (foundation for all PBT tests)_

---

## Section 3: CP Solver (Phase 4)

- [x] **11. Implement domain object**
  - In `js/algorithms/proctor-v3/solver/domain.js`, implement:
    - `Domain(values)` class wrapping a `Set<canonicalKey>`
    - `intersect(other)`, `remove(value)`, `size()`, `isEmpty()`, `toArray()` (sorted)
    - `clone()` returning a new Domain with same values
  - Add unit tests in `tests/proctor-v3/domain.test.js`
  - _Requirements: 8.5 (sorted iteration)_

- [x] **12. Implement AC-3 propagator**
  - In `js/algorithms/proctor-v3/solver/propagators.js`, implement:
    - `propagateAllDifferent(domains, varGroup)` — enforce AllDifferent within a session and within a row
    - `propagateUpperBound(domains, varGroup, classBounds, loadState)` — enforce class upper bound
    - `propagateAC3(domains, constraints)` — generic AC-3 driver
  - Add unit tests in `tests/proctor-v3/propagators.test.js` with small synthetic inputs
  - _Requirements: 3.5, 3.6, 5.6_

- [x] **13. Implement CP solver core**
  - In `js/algorithms/proctor-v3/solver/cp-solver.js`, implement `solve(model, options)`:
    - Build initial domains from model
    - Run AC-3 propagation
    - DFS with smallest-domain-first variable ordering
    - Value ordering: lexicographic (least-constrained-value with `canonicalKey ASC` tiebreak)
    - Time budget enforcement (returns best partial solution on timeout)
  - Cost function: pluggable, takes (assignment, model) → number
  - Returns `{ assignments, partial, timedOut }`
  - Add unit tests in `tests/proctor-v3/cp-solver.test.js` with toy 5-var models
  - _Requirements: 12.6_

- [x] **14. Implement guard placement (Phase 4)**
  - In `js/algorithms/proctor-v3/phases/04-place-guards.js`, implement `placeGuards(state)`:
    - Build CP model from `state.rows` (variables = guard slots)
    - Configure constraints: eligibility, AllDifferent, C-NO-SAME-DAY, class upper bounds
    - Configure cost function: soft constraints (S-OWN-SUBJECT, S-NO-ROOM-REPEAT, S-GENDER, S-AM-PM)
    - Invoke solver
    - Update `state.rows[i].proctor_keys`, `state.loadState`
    - Record `unresolvedSlots` for null entries
  - Add property test in `tests/proctor-v3/place-guards.test.js`: post-Phase 4, every assigned key satisfies all hard constraint predicates
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.10, 5.6, 5.9, 6.1, 6.4, 6.7, 6.8_

---

## Section 4: Repair Phases

- [x] **15. Implement multi-step coverage repair (Phase 5)**
  - In `js/algorithms/proctor-v3/phases/05-coverage-repair.js`, implement `multiStepCoverageRepair(state)`:
    - Identify uncovered proctors (`primaryLoad < classLowerBound`)
    - For each, attempt repeated swaps until reaching `classLowerBound` or no swap possible
    - Each swap respects: hard constraints, donor's lower bound (5.12), C-NO-SAME-DAY
    - Track `coverageRepairSwaps` and `coverageRepairUnresolved` counters
  - Add property test in `tests/proctor-v3/coverage-repair.test.js`: post-repair, either every proctor reaches bound or unresolved is recorded
  - _Requirements: 5.10, 5.11, 5.12, 5.13_

- [x] **16. Implement same-day infeasibility detection (Phase 6)**
  - In `js/algorithms/proctor-v3/phases/06-same-day-detect.js`, implement `detectSameDayInfeasibility(state)`:
    - Phase 6 itself is a **pure function**: ONLY inspects `state.diagnostics.unresolvedSlots` and sets `state.diagnostics.preCheckRequired` flag
    - Phase 6 does NOT call other phases — that violates pure-function design
  - In `orchestrator.js`, implement the **conditional pre-check** at orchestrator level (NOT inside Phase 6):
    - After Phase 6 returns, check `state.diagnostics.preCheckRequired`
    - If true AND `remainingBudget >= 7s`, run a separate pre-check pipeline: `phase4PlaceGuards(relaxedState, { timeBudget: 5000 })` then `phase5CoverageRepair(relaxedState, { timeBudget: 2000 })` with `allowSameDayBothHalfdays: true`
    - Compare unresolved counts; emit `same_day_relaxation_suggested` (AC 4.2) OR `coverage_infeasible_regardless` (AC 4.2a) accordingly
  - Add unit test in `tests/proctor-v3/same-day-detect.test.js` for Phase 6 alone (pure inspection)
  - Add integration test in `tests/proctor-v3/orchestrator-precheck.test.js` for the orchestrator-level pre-check composition
  - **⚠️ Design pitfall**: An earlier draft put the pre-check INSIDE Phase 6, making it impure (calls into other phases). Correct decomposition: Phase 6 = pure inspection, Orchestrator = conditional composition.
  - _Requirements: 4.1, 4.2, 4.2a, 4.2b, 4.6, 12.3_

- [x] **17. Implement bimodal repair (Phase 7)**
  - In `js/algorithms/proctor-v3/phases/07-bimodal-repair.js`, implement `bimodalRepair(state)`:
    - Loop while `!isBimodal(histogram)` AND time remaining
    - Find proctor whose load is at extreme (max if histogram has 3+ keys at top, min if at bottom)
    - Find a swap that reduces the extreme without breaking bounds
    - If no swap found in N iterations, give up and emit `fairness_violation` error
  - Helper `isBimodal(histogram)` per design Section 4 Phase 7
  - Add property test in `tests/proctor-v3/bimodal.test.js`
  - _Requirements: 5.7, 5.8_

- [x] **18. Implement AM/PM balance (Phase 8)**
  - In `js/algorithms/proctor-v3/phases/08-ampm-balance.js`, implement `ampmBalance(state)`:
    - For each proctor with `imbalance ≥ 2`, attempt swaps to reduce
    - Each swap: convert AM slot to PM (or vice versa) by trading with a willing partner
    - Stop when no improvement or budget exhausted
  - Compute `amPmImbalanceByProctorKey` for diagnostics
  - Add property test in `tests/proctor-v3/ampm-balance.test.js`: post-Phase 8, average imbalance ≤ pre-Phase 8 average
  - _Requirements: 6.4, 6.5, 6.6_

---

## Section 5: Reserves and Finalization

- [x] **19. Implement reserves placement (Phase 9)**
  - In `js/algorithms/proctor-v3/phases/09-place-reserves.js`, implement `placeReserves(state)`:
    - Read Reserves_Config from `examCenterConfig` with V2 fallback semantics
    - For each session, compute target_reserves count
    - Build candidate pool, apply hard constraints:
      - Not exempt, not on duty, not ME-blocked
      - Not currently a guard in ANY row of `S.session_key` (AC 7.4)
      - **Not currently a reserve in any OTHER row of `S.session_key`** (AC 7.4 enhanced + AC 3.6)
      - Satisfies C-NO-SAME-DAY for both guards AND reserves (AC 3.7a)
    - Sort by `(reserveCount, affinityRank, finalLoad, canonicalKey)`
    - Pick top candidates
    - Update `state.rows[i].reserve_keys` (and `state.rows[i].reserves` after key resolution)
    - Update `loadState` reserve counts (slot-based per Task 8)
  - Add property test in `tests/proctor-v3/reserves.test.js`: AC 7.4–7.9 INCLUDING that no canonical key appears twice across the union of reserves of one session's rows
  - **⚠️ V2 pitfall**: V2 used a "shared array reference" trick where all rows of a session pointed to the same `reserve_keys` array. V3 SHOULD use independent arrays per row (Acceptance Criterion 10.2 requires no shared references) AND maintain the at-most-once invariant explicitly.
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.4a, 7.5, 7.6, 7.7, 7.8, 7.9, 3.6, 3.7a_

- [x] **20. ~~Room synthesis~~ — MOVED TO Task 5b**
  - This task has been moved earlier in the pipeline (now Task 5b, executed right after key normalization in Phase 1) because room synthesis is a prerequisite for guard placement (Task 14 / Phase 4). See Task 5b above for the actual work.
  - This entry is kept here only as a numbered placeholder; it does not require any new implementation work.

- [x] **21. Implement diagnostics aggregation**
  - In `js/algorithms/proctor-v3/diagnostics.js`, implement:
    - `buildDiagnostics(state)` — builds the full DiagnosticsV3 object per AC 9.2 (see design.md §4 Phase 10 for full schema)
    - `computeHistogramByGuardCount(rows)` — slot-based histogram from `proctor_keys` (AC 9.3)
    - `computeHistogramByPrimaryLoad(loadState, classByProctorKey)` — Primary_Load histogram (AC 9.3a, used by AC 5.7 bimodal check)
    - `countDistinctProctors(rows)` — count distinct keys appearing in any keys array
    - `computeZeroLoadProctors(loadState, classByProctorKey)` — array of `{ canonicalKey, classId, reason }` for eligible proctors at Primary_Load = 0 (AC 5.10)
    - `computeReserveImbalances(loadState, classByProctorKey)` — array of `{ overloadedKey, underloadedKey, deltaCount, blockingReason }` (AC 7.8)
    - `computeAmPmImbalances(loadState)` — map canonicalKey → AM_PM_Imbalance value (AC 6.6)
    - `verifyJsonSerializable(diagnostics)` — call JSON.stringify and check round-trip
  - Add unit tests in `tests/proctor-v3/diagnostics.test.js` covering each helper
  - **⚠️ Design pitfall**: An earlier draft of design.md emitted only ONE histogram. The correct schema requires TWO: `histogramByGuardCount` (for V2 compatibility / display layer) AND `histogramByPrimaryLoad` (for fairness check). Also `zeroLoadProctors` and `reserveImbalances` are required by AC 9.2.
  - _Requirements: 5.10, 6.6, 7.8, 9.1, 9.2, 9.3, 9.3a, 9.3b, 9.4, 9.6, 9.7, 9.8_

- [x] **22. Implement finalization (Phase 10)**
  - In `js/algorithms/proctor-v3/phases/10-finalize.js`, implement `finalize(state)`:
    - Tag `softViolations` per row by inspecting final assignments
    - Build `proctors[]` and `reserves[]` display name arrays from canonical keys (use `js/data/proctor-key-resolver.js`)
    - Verify all row arrays are fresh (no shared references)
    - Build final diagnostics
    - Run JSON serializability check
  - Add property test in `tests/proctor-v3/finalize.test.js` covering AC 10.1, 10.2
  - _Requirements: 6.9, 6.10, 9.1, 9.8, 10.1, 10.2, 13.1, 13.2, 13.3, 13.4, 13.5_

---

## Section 6: Orchestrator and Public API

- [x] **23. Implement orchestrator**
  - In `js/algorithms/proctor-v3/orchestrator.js`, implement `runOrchestrator(input)`:
    - Phase pipeline: 0 → 1 → 1b → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10
    - Try/catch around each phase (record errors in `state.diagnostics.errors`, continue with successor state)
    - Global timer (30s) with per-phase budget enforcement
    - Return `{ result: state.rows, diagnostics: state.diagnostics, algorithmVersion: 'v3' }`
  - Add integration test in `tests/proctor-v3/orchestrator.test.js` with small synthetic input
  - **⚠️ V2 pitfalls**:
    - V2 used `_isRunning` module-level flag for re-entrancy. V3 MUST NOT use module-level mutable state — use closure-local variables instead.
    - V2's `orchestratorState` had a dead branch (`else if (errors.length > 0) { state = 'COMPLETED' }` then `else { state = 'COMPLETED' }`). V3 MUST emit distinct states: `'COMPLETED'`, `'DEGRADED'` (errors but result returned), `'TIMEOUT'`, `'ERROR'`.
    - V2's `diagnostics.errors` was an array of strings. V3 MUST emit array of structured objects `{ type, message, phase?, details? }`.
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 1.4, 1.14, 9.7_

- [x] **24. Implement public API**
  - In `js/algorithms/proctor-v3/index.js`, expose:
    - `run(input)` → calls orchestrator, returns standardized output
    - `_internals` namespace exposing `canonicalProctorKey`, `buildKeyAdapter`, `computeHistogram` for tests
  - Use `module.exports` for Node compatibility AND optionally attach to `window.ProctorDistributionV3` if `window` is defined (for renderer)
  - In `js/algorithms/proctor-v3/README.md`, document:
    - Public API signatures
    - Input contract (link to requirements glossary)
    - Output contract
    - Example usage
  - **⚠️ V2 pitfall**: V2 used `window.ProctorDistributionV2 = { ... }` only, making CLI/Node testing impossible. V3 MUST primarily use `module.exports`; the `window` attachment is a secondary convenience.
  - _Requirements: 1.1, 1.2, 17.2_

---

## Section 7: Property-Based Test Suite

- [x] **25. Add fast-check as devDependency**
  - In `package.json`, add `"fast-check": "^3.x"` to `devDependencies`
  - Run `npm install`
  - Verify lint still passes
  - _Requirements: 1.10, 1.11_

- [x] **26. Write canonical-key PBT**
  - In `tests/proctor-v3/canonical-key.test.js`, write property test asserting AC 2.5: every key in `proctor_keys ∪ reserve_keys` is a canonical key for some proctor in input. 100+ random inputs.
  - _Requirements: 2.5, 2.6, 2.7, 14.1_

- [x] **27. Write hard-constraints PBT**
  - In `tests/proctor-v3/hard-constraints.test.js`, write property test asserting AC 3.5: no canonical key appears twice in same row. 100+ random inputs.
  - _Requirements: 3.5, 14.2_

- [x] **28. Write bounds PBT**
  - In `tests/proctor-v3/bounds.test.js`, write property test asserting AC 5.6: `Class_Lower_Bound(c) ≤ Primary_Load(T) ≤ Class_Upper_Bound(c)` for every eligible T. 100+ random inputs.
  - _Requirements: 5.6, 14.3_

- [x] **29. Write bimodal PBT**
  - In `tests/proctor-v3/bimodal.test.js`, write property test asserting AC 5.7: histogram is `{k}` or `{k, k+1}`, OR `diagnostics.errors` contains `fairness_violation`. 100+ random inputs.
  - _Requirements: 5.7, 14.4_

- [x] **30. Write determinism PBT**
  - In `tests/proctor-v3/determinism.test.js`, write property test asserting AC 8.4: same input + same seed → byte-identical output. 100+ random inputs.
  - _Requirements: 8.4, 14.5_

- [x] **31. Write round-trip PBT**
  - In `tests/proctor-v3/round-trip.test.js`, write property test asserting AC 10.2: no shared array references across rows. 100+ random inputs.
  - Also write property test asserting AC 10.1: `JSON.parse(JSON.stringify(output))` produces structurally identical result.
  - Also write property test asserting AC 14.8: histogram preserved after JSON round-trip.
  - _Requirements: 10.1, 10.2, 14.6, 14.8_

---

## Section 8: Production Fixture Acceptance

- [x] **32. Write production fixture acceptance test**
  - In `tests/proctor-v3/production-fixture.test.js`, write a single test that loads `tests/fixtures/45454.json`, runs V3 with `randomSeed=42`, and asserts:
    - All 382 slots filled (zero unresolved)
    - All 147 proctors have `Primary_Load ≥ 2`
    - Histogram is strict bimodal
    - `max ≤ 3`
    - Zero ghost CIN keys (the 6 known strings absent)
    - `coverageRepairUnresolved === 0`
    - Wall-clock duration ≤ 30 seconds
    - At most 10% of proctors have `AM_PM_Imbalance ≥ 2`
  - This test is the **single source of truth** for V3 production readiness
  - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 14.7_

- [x] **33. Add `verify:v3` script**
  - In `package.json`, add to `scripts`:
    ```json
    "verify:v3": "node tests/proctor-v3/production-fixture.test.js"
    ```
  - Verify it runs without Electron and exits 0 on success, non-zero on failure
  - _Requirements: 16.6_

---

## Section 9: Renderer Integration (V3 Toggle)

- [x] **34. Add V3 toggle UI to exams-proctors.html**
  - In `exams-proctors.html`, near the auto-distribution section, add a toggle:
    - Two radio buttons: "V2 (الخوارزمية الحالية)" / "V3 (الخوارزمية الجديدة)"
    - Default: V2
    - Persist choice in `examDistributionRules.algorithmVersion`
  - Add JS handler: when V3 selected, route auto-distribution call to V3 module
  - _Requirements: 1.5, 1.6, 1.7, 1.8_

- [x] **35. Implement V3 invocation path in renderer**
  - In `exams-proctors.html`, implement `runAutoDistributionV3(input)`:
    - Calls `require('./js/algorithms/proctor-v3').run(input)`
    - Saves result with `algorithmVersion: 'v3'` flag in `examAutoDistributionData`
    - Updates UI status panels (existing helpers)
    - On warning `same_day_relaxation_suggested`, shows confirmation dialog and re-runs with `allowSameDayBothHalfdays: true` if user confirms
  - _Requirements: 1.7, 4.3, 4.4, 4.5_

- [x] **36. Verify display layer compatibility**
  - In `exams-rooms.html` and other display pages, verify that loading a V3 result renders correctly
  - Confirm `buildSummaryRows` produces same histogram as `diagnostics.histogram`
  - No code changes expected; this is a manual smoke test
  - _Requirements: 10.4, 10.5, 13.6, 16.2, 16.3_

---

## Section 10: Documentation and Closure

- [x] **37. Finalize README and design docs**
  - Update `js/algorithms/proctor-v3/README.md` with final API, examples, and links to spec
  - Verify `design.md` constraint matrix is accurate (no missing requirements)
  - Add a "How to add a new constraint" section to README
  - _Requirements: 17.1, 17.2, 17.3_

- [x] **38. Close-out checks**
  - Run full test suite: `npm test`
  - Run `npm run lint` (no new errors introduced)
  - Run `npm run verify:v3`
  - Verify V2 still works: select V2 in renderer, confirm auto-distribution unchanged
  - Verify V3 toggle works: select V3, run, observe V3 result
  - Document any deferred items in `.agent/proctor-v3-followups.md`
  - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6_

---

## Task Dependency Graph

```
1 → 2 → 3, 4
3 → 5
4 → 5, 6
5 → 6 → 7
6 → 7
7 → 8, 9
8 → 11 → 12 → 13 → 14
14 → 15, 17, 18, 19
15 → 16
20 → 14, 23
21 → 22 → 23
23 → 24
25 → 26, 27, 28, 29, 30, 31
24, 25, 32 → 33
24 → 34 → 35
35 → 36
36 → 37 → 38
```

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "20", "21", "25", "32"] },
    { "id": 1, "tasks": ["2", "22", "26", "27", "28", "29", "30", "31"] },
    { "id": 2, "tasks": ["3", "4", "23"] },
    { "id": 3, "tasks": ["5", "24"] },
    { "id": 4, "tasks": ["6", "33", "34"] },
    { "id": 5, "tasks": ["7", "35"] },
    { "id": 6, "tasks": ["8", "9", "36"] },
    { "id": 7, "tasks": ["11", "37"] },
    { "id": 8, "tasks": ["12", "38"] },
    { "id": 9, "tasks": ["13"] },
    { "id": 10, "tasks": ["14"] },
    { "id": 11, "tasks": ["15", "17", "18", "19"] },
    { "id": 12, "tasks": ["16"] }
  ]
}
```

## Notes

## Risk Register (per task)

| Task | Risk | Mitigation |
|------|------|-----------|
| 13 (CP solver) | May not converge in budget on hard inputs | Built-in timeout returns partial; subsequent phases handle holes |
| 14 (Place guards) | Cost function tuning may need iteration | Start with weights from design doc; PBT will reveal issues |
| 15 (Coverage repair) | Donor selection logic complex | Strict donor protection check before every swap |
| 17 (Bimodal repair) | Local minimum in histogram | Allow graceful failure recorded in errors |
| 32 (Production fixture) | Fixture edge cases revealed | Each failed assertion gives concrete proctor/slot to investigate |
| 34 (Toggle UI) | Renderer regression on V2 path | V2 code path completely untouched; toggle is additive |

## Success Criteria

The V3 spec is **closed** when all of the following are true:
1. All 38 tasks are checked off
2. `npm test` passes (existing V2 tests + all new V3 tests)
3. `npm run lint` passes
4. `npm run verify:v3` exits 0
5. Production fixture acceptance test (Task 32) passes
6. Manual smoke test in Electron: switching toggle V2↔V3 works, both produce correct results

---

**Methodology Note**: Tasks are intentionally fine-grained (avg 50–150 lines of code each) to allow incremental review and to keep the codebase compilable at every checkpoint. If a task estimate exceeds 200 lines, split it before starting.
