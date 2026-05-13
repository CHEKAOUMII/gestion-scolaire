# Implementation Plan: Proctor Distribution Algorithm v2

## Overview

Implement a hybrid three-phase proctor distribution algorithm (CSP pre-pass → Hungarian per half-day → Simulated Annealing) in `js/algorithms/proctor-distribution-v2.js`, integrate it into `exams-proctors.html` with an Algorithm Toggle and Diagnostics Panel, and validate correctness with property-based and unit tests. All code is vanilla ES2019+ JavaScript with no production dependencies.

## Tasks

- [x] 1. Set up module skeleton and core utilities
  - [x] 1.1 Create `js/algorithms/proctor-distribution-v2.js` with module structure and exports
    - Create the file with `window.ProctorDistributionV2 = { run: orchestrator }` export
    - Define all internal function stubs: `orchestrator`, `phase1PrePass`, `phase2Build`, `phase3Optimize`, `hungarianSolver`, `costFunction`, `greedyFallback`, `buildCSPModel`, `runAC3`, `extractSingletons`, `computeBounds`, `buildCostMatrix`, `buildSeededPRNG`
    - Implement `buildSeededPRNG` (Mulberry32) for deterministic randomness
    - Implement input validation in `orchestrator` (check all GS2_Input_Contract fields, fail fast with descriptive error)
    - Implement re-entrancy guard (ignore concurrent calls)
    - _Requirements: 1.7, 1.8, 11.1, 11.3, 11.4, 12.1, 12.3, 12.4_

  - [x] 1.2 Implement `computeBounds` and load state utilities
    - Implement `computeBounds(totalTasks, fixedReservedTasks, numEligibleTeachers)` returning `{ lowerBound, upperBound }`
    - Implement load state tracking structure (guardLoads per proctor, morning/evening counts)
    - Implement `halfdayKey` computation matching v1 format
    - _Requirements: 2.5, 2.6, 3.1_

- [x] 2. Implement Phase 1 — CSP Pre-pass and AC-3
  - [x] 2.1 Implement `buildCSPModel`
    - Build variables as triples `(scheduleEntryId, roomKey, slotIndex)`
    - Build initial domains from eligible proctors (filtering exemptions and duty)
    - Build unary constraints (exemption, duty) and binary constraints (no same-proctor-in-same-session, halfday reuse, day reuse based on options)
    - _Requirements: 2.1, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 2.2 Implement `runAC3` arc consistency propagation
    - Implement queue-based AC-3 with max 1000 iterations
    - Record empty domains in `infeasibilities` (don't halt)
    - Log warning if max iterations exceeded before stability
    - _Requirements: 2.2, 2.3, 2.9_

  - [x] 2.3 Implement `extractSingletons` and assemble `phase1PrePass`
    - Extract singleton assignments (domain size === 1) into `prefixed_assignments`
    - Wire `buildCSPModel` → `runAC3` → `extractSingletons` → `computeBounds` into `phase1PrePass`
    - Populate diagnostics fields: `lowerBound`, `upperBound`, `singletonCount`, `domainReductionPercent`, `phase1DurationMs`
    - _Requirements: 2.4, 2.4.1, 2.7_

  - [x]* 2.4 Write property test for AC-3 Soundness
    - **Property 4: AC-3 Soundness**
    - Verify that every value removed from a domain is provably inconsistent with at least one constraint
    - **Validates: Requirements 2.2, 10.7**

- [x] 3. Implement Phase 2 — Hungarian Solver and Cost Function
  - [x] 3.1 Implement `hungarianSolver` (Munkres O(n³) algorithm)
    - Implement the full Hungarian/Munkres algorithm from the design pseudocode
    - Handle square cost matrices with potential padding
    - Return `assignment[row] = col` array or throw on failure
    - _Requirements: 3.4, 11.3_

  - [x] 3.2 Implement `costFunction`
    - Return `1e9` (Infinity_Sentinel) for any hard constraint violation
    - Compute soft violation penalties: `5×groupMismatch + 3×sameRoomRepeat + 2×subjectSpecialty + 1×noGenderPair`
    - Add load balancing penalty: `4 × max(0, guardLoad - lowerBound)`
    - _Requirements: 3.6, 3.7, 3.8_

  - [x]* 3.3 Write property test for Cost Function Correctness
    - **Property 5: Cost Function Correctness**
    - Verify cost returns 1e9 iff hard constraint violated, and exact formula otherwise
    - **Validates: Requirements 3.6, 3.7, 3.8**

  - [x]* 3.4 Write property test for Hungarian Optimality over Greedy
    - **Property 3: Hungarian Optimality over Greedy**
    - Verify total cost from Hungarian ≤ total cost from greedy column-minimum on random matrices
    - **Validates: Requirements 10.6**

- [x] 4. Implement Phase 2 — Build per half-day with Greedy Fallback
  - [x] 4.1 Implement `buildCostMatrix` and `phase2Build` orchestration
    - Split schedule entries into half-day groups using `halfdayKey`
    - Build cost matrix per half-day (rows = tasks, cols = available proctors)
    - Pad with dummy columns (cost 1e9) when proctors < tasks
    - Run Hungarian, check for dummy assignments, invoke Greedy Fallback for unresolved tasks
    - Handle dual-proctor rooms (two Hungarian passes with gender preference on second pass)
    - Enforce 1500ms timeout on Phase 2
    - Populate diagnostics: `phase2DurationMs`, `fallbackCount`, `totalHalfdaysProcessed`, `averageCostPerAssignment`, `fallbackHalfdays`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.9, 3.10, 3.11, 7.1, 7.5_

  - [x] 4.2 Implement `greedyFallback`
    - Adapt existing v1 greedy logic for use as fallback
    - Accept partial task list (only unresolved tasks) and current load state
    - Leave slots empty rather than violate hard constraints, record shortages
    - _Requirements: 3.5, 3.11, 5.6, 13.2_

- [x] 5. Checkpoint — Ensure Phase 1 and Phase 2 work correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement Phase 3 — Simulated Annealing Optimizer
  - [x] 6.1 Implement `phase3Optimize` with SA loop and neighborhood moves
    - Initialize SA with `T0=1.0`, `T_min=0.01`, `coolingRate=0.95`, `maxIterations=1000`, `maxDurationMs=500`, `stagnationLimit=100`
    - Implement three neighborhood moves: `swap_guards`, `swap_roles`, `reassign_reserve`
    - Reject moves that violate hard constraints without computing cost
    - Accept improving moves always; accept worsening moves with probability `exp(-ΔE/T)`
    - Implement early stop after 100 stagnant iterations
    - Support `enablePhase3 = false` to skip SA loop (record `phase3Skipped = true`)
    - Populate diagnostics: `phase3DurationMs`, `iterationsExecuted`, `acceptedMoves`, `rejectedMoves`, `earlyStop`, `initialObjective`, `finalObjective`, `preset`
    - _Requirements: 4.1–4.13, 5.7_

  - [x] 6.2 Implement `objectiveFunction` and weights presets
    - Compute `α×std(guardLoads) + β×totalSoftViolations + γ×morningEveningImbalance`
    - Support three presets: "توازن" (3,1,2), "احترام المجموعات" (1,1,5), "تنوع القاعات" (1,4,1)
    - Support custom weights override from `input.customWeights`
    - Record `weightsUsed` and `weightValues` in diagnostics
    - _Requirements: 4.8, 4.9, 4.9.1, 6.1, 6.2, 6.3, 6.4_

- [x] 7. Wire Orchestrator end-to-end and implement error handling
  - [x] 7.1 Complete `orchestrator` function with full pipeline and error handling
    - Wire Phase 1 → Phase 2 → Phase 3 sequentially
    - Catch Phase 2 exceptions → Greedy Fallback per half-day
    - Catch Phase 3 exceptions → return Phase 2 result unchanged
    - Handle infeasible slots (leave empty, record `totalInfeasibleSlots`)
    - Handle non-existent proctor references (ignore, log warning)
    - Assemble final `{result, diagnostics}` with `totalDurationMs`, `loadBalance` stats (std, min, max, gini), `softViolationsByType`
    - Set `orchestratorState` to "COMPLETED", "ERROR", or "TIMEOUT"
    - Attach `softViolations` array to each AssignmentRow
    - _Requirements: 1.2, 1.4, 1.6, 5.6, 6.5, 6.6, 7.2, 7.4, 13.1, 13.2, 13.3, 13.5_

  - [x]* 7.2 Write property test for Hard Constraint Preservation
    - **Property 1: Hard Constraint Preservation**
    - Verify no output assignment violates exemption, duty, same-session, halfday-reuse, or day-reuse constraints
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 10.1**

  - [x]* 7.3 Write property test for Deterministic Reproducibility
    - **Property 2: Deterministic Reproducibility (Idempotence)**
    - Verify two runs with same input and same seed produce identical results
    - **Validates: Requirements 10.5, 12.2, 12.3**

  - [x]* 7.4 Write property test for Graceful Degradation
    - **Property 10: Graceful Degradation on Infeasibility**
    - Verify orchestrator completes without throwing when tasks have zero eligible proctors
    - **Validates: Requirements 5.6, 13.1, 13.3**

- [x] 8. Checkpoint — Ensure algorithm produces correct results end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Integrate into UI — Algorithm Toggle and localStorage
  - [x] 9.1 Add Algorithm Toggle and distribution button handler in `exams-proctors.html`
    - Add toggle UI with two options: "الخوارزمية الحالية (v1)" and "الخوارزمية المُحسَّنة (v2)"
    - Default to v2 for new sessions (no prior selection)
    - Wire distribution button to call `window.ProctorDistributionV2.run(input)` when v2 selected
    - Preserve existing v1 behavior when v1 selected (no changes to v1 code path)
    - Add `<script src="js/algorithms/proctor-distribution-v2.js"></script>` to page
    - _Requirements: 1.1, 1.2, 1.3, 1.3.1, 1.6_

  - [x] 9.2 Implement localStorage persistence with backward compatibility
    - Save v2 results under `examAutoDistributionData` with same v1 field structure plus `algorithmVersion: 'v2'` and `diagnostics`
    - On page load: read `algorithmVersion` field to set toggle state (v2 if present, v1 otherwise)
    - Preserve all v1 row fields consumed by `exams-rooms.html`
    - Handle missing `diagnostics` field in saved v2 data gracefully
    - _Requirements: 1.5, 9.1, 9.2, 9.2.1, 9.3, 9.4, 9.5_

  - [x]* 9.3 Write property test for Output Format Backward Compatibility
    - **Property 9: Output Format Backward Compatibility**
    - Verify every output row contains all v1 fields with correct types plus `softViolations` array
    - **Validates: Requirements 9.1, 9.4**

- [x] 10. Implement Diagnostics Panel
  - [x] 10.1 Build Diagnostics Panel UI in `exams-proctors.html`
    - Add collapsible panel below distribution table
    - Display phase durations (ms), load balance stats (std, min, max, gini)
    - Display soft violations by type (4 categories)
    - Display fallback count with half-day list
    - Display SA iterations and early stop status
    - Display collapsible sections for shortages, infeasibilities, warnings, errors (with warning icon)
    - Show "لا توجد بيانات تشخيصية متاحة" when v2 data lacks diagnostics
    - Hide panel on next v1 run; keep visible when toggling from v2→v1 until next run
    - Show estimated duration from timestamps when `totalDurationMs` unavailable
    - Handle DOM errors gracefully (toast notification on failure)
    - _Requirements: 8.1–8.8.1, 7.4, 7.4.1, 13.4, 13.4.1_

  - [x] 10.2 Add Weights Preset selector in UI
    - Add dropdown/radio for three presets: "توازن", "احترام المجموعات", "تنوع القاعات"
    - Pass selected preset to orchestrator input
    - Support custom α/β/γ input fields (optional advanced mode)
    - _Requirements: 6.1, 4.9, 4.9.1_

- [x] 11. Checkpoint — Ensure full integration works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Statistical property tests and unit tests
  - [x]* 12.1 Write property test for Load Balance Improvement
    - **Property 6: Load Balance Improvement**
    - Verify `std(guardLoads)` in v2 ≤ v1 for same input in ≥95% of generated cases
    - **Validates: Requirements 10.2**

  - [x]* 12.2 Write property test for Alternating Group Compliance Improvement
    - **Property 7: Alternating Group Compliance Improvement**
    - Verify proportion of out-of-group assignments in v2 ≤ v1 in ≥95% of cases
    - **Validates: Requirements 10.3**

  - [x]* 12.3 Write property test for Gender Pair Rate Improvement
    - **Property 8: Gender Pair Rate Improvement**
    - Verify mixed-gender pair rate in v2 ≥ v1 in ≥95% of cases when both genders ≥30%
    - **Validates: Requirements 10.4**

  - [x]* 12.4 Write unit tests for edge cases and diagnostics
    - Test 0 proctors, 0 sessions, 1 proctor 1 room scenarios
    - Test exact weights preset values
    - Test SA early stop at 100 stagnant iterations
    - Test Phase 2 timeout at 1500ms boundary
    - Test diagnostics field completeness per phase
    - Test PRNG determinism with known seeds
    - Test invalid randomSeed rejection
    - _Requirements: 10.1–10.8, 7.1, 7.2, 7.3, 12.2_

- [x] 13. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All algorithm code goes in `js/algorithms/proctor-distribution-v2.js` — no modifications to existing v1 code
- Tests use `fast-check` in `devDependencies` only; production has zero new dependencies
- The existing v1 algorithm remains untouched and fully functional

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "3.2"] },
    { "id": 3, "tasks": ["2.3", "2.4", "3.3", "3.4"] },
    { "id": 4, "tasks": ["4.1", "4.2"] },
    { "id": 5, "tasks": ["6.1", "6.2"] },
    { "id": 6, "tasks": ["7.1"] },
    { "id": 7, "tasks": ["7.2", "7.3", "7.4"] },
    { "id": 8, "tasks": ["9.1", "9.2"] },
    { "id": 9, "tasks": ["9.3", "10.1", "10.2"] },
    { "id": 10, "tasks": ["12.1", "12.2", "12.3", "12.4"] }
  ]
}
```
