'use strict';

// @pre-fix exploratory test
// EXPECTED: this test FAILS on the pre-fix snapshot — failure confirms the
// soft-penalty-wins flavour of C1 exists.
// DO NOT attempt to "fix" this test if it fails. It is supposed to fail.
// The post-fix integration test covers the same scenario on the fixed module.
//
// Spec: .kiro/specs/proctor-v2-strict-fairness-coverage/
// Phase H, task 39 — Property 1 (Bug Condition C1, soft-penalty-wins).
//
// Scoped fixture (2-class flavour of C1, see buildC1SoftPenaltyWinsInput):
//   T_busy (cin=C1S_busy):
//     - 1 pre-pinned duty halfday (2026-03-10 evening) → dutyCount = 1
//     - meAssignments[C1S_busy] = 1 (morning), matches the guard entry's
//       morning expectedGroup → groupMismatch = 0 (perfect-fit profile).
//   T_idle (cin=C1S_idle):
//     - dutyCount = 0, primaryLoad = 0 going into Phase 2
//     - meAssignments[C1S_idle] = 2 (evening), mismatches the morning guard
//       entry → groupMismatch = 5.
//   1 guard slot (proctorsPerRoom = 1) → G = 1, N = 2, D_expected = 0 →
//   classUpperBound_primary = ceil(1/2) = 1.
//
// Pre-fix cost ranking on the snapshot's costFunction (verified by
// instrumentation; see design.md §"Exploratory Bug Condition Checking" row 1):
//   floor       = max(lowerBound=0, sessionMaxPrimaryLoad-1=−1) = 0
//   T_busy      = 4 × max(0, 1 − 0) + 0.5 (freshness, primaryLoad>0) = 4.5
//   T_idle      = 0 (load-penalty, primaryLoad=0) + 5 (groupMismatch) = 5.0
// Hungarian/greedy picks T_busy because the soft load-penalty (4.5) is
// CHEAPER than the soft groupMismatch (5). After the cap lands (C1 fix),
// the per-class hard cap returns INFINITY_SENTINEL for T_busy
// (post-assignment primaryLoad would be 2 = 1 dutyCount + 1 guardCount,
// classUpperBound = 1) and T_idle wins instead.
//
// Pre-fix counterexample (deterministic with randomSeed=42):
//   T_busy chosen with primaryLoad=2 (already at bound), gap = 2 vs T_idle stays at 0
//
// _Validates: Requirements 1.1, 1.4, 2.4 (Bug Condition C1, Property P1)_

const assert = require('assert');
const path = require('path');

const PreFixV2 = require(
  path.join(__dirname, '__snapshots__', 'proctor-v2-strict-fairness-coverage.pre-fix.js')
);
const {
  buildC1SoftPenaltyWinsInput
} = require('./fixtures/proctor-v2-strict-fairness-fixtures');

const input = buildC1SoftPenaltyWinsInput();
const output = PreFixV2.run(input);
const rows = (output && output.result) || [];

assert.ok(
  rows.length >= 1,
  'pre-fix snapshot produced no result rows for the soft-penalty fixture; ' +
    'expected at least one assignment row to inspect.'
);

const firstRow = rows[0];
const firstSlot = (firstRow && firstRow.proctor_keys && firstRow.proctor_keys[0]) || null;

console.log('[c1-soft-penalty] proctorsPerRoom=' +
  input.examDistributionRules.proctorsPerRoom +
  ', N=' + input.proctorsList.length +
  ', D_expected=' + input.D_expected +
  ', firstSlot=' + String(firstSlot));

// Property P1 / Requirement 2.4 (single-slot specialisation):
//   With G=1, D_expected=0, N=2 the single eligibility class has
//   classUpperBound_primary = ceil(1 / 2) = 1. T_busy enters Phase 2 at
//   primaryLoad = 1 (dutyCount = 1) — already AT the upper bound — so any
//   guard placement on T_busy yields primaryLoad = 2 > classUpperBound and
//   violates P1/P2. The strict-fairness fix must steer the algorithm toward
//   T_idle instead, paying the 5-point groupMismatch rather than the 4.5
//   soft load-penalty that lets T_busy win on F.
assert.strictEqual(
  firstSlot,
  'C1S_idle',
  'P1 violated on pre-fix snapshot: expected the idle teacher to be picked ' +
    'for the single guard slot (classUpperBound = 1, T_busy already at ' +
    'primaryLoad=1 from dutyCount), but the pre-fix algorithm picked ' +
    String(firstSlot) + '. Counterexample: T_busy chosen with primaryLoad=2 ' +
    '(already at bound), gap = 2 vs T_idle stays at 0.'
);

console.log('[c1-soft-penalty] (unexpected) idle teacher picked on pre-fix ' +
  'snapshot — fixture geometry may need adjustment.');
