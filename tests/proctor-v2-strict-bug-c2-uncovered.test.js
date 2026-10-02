'use strict';

// @pre-fix exploratory test
// EXPECTED: this test FAILS on the pre-fix snapshot — failure confirms C2 exists.
// DO NOT attempt to "fix" this test if it fails. It is supposed to fail.
// The post-fix integration test covers the same scenario on the fixed module.
//
// Spec: .kiro/specs/proctor-v2-strict-fairness-coverage/
// Phase H, task 40 — Property 1 (Bug Condition C2, uncovered eligible teacher).
//
// Scoped fixture (see buildC2UncoveredTeacherInput):
//   - 5 perfect-fit peers (T_peer_1..T_peer_5, specialty="عام", M/E group=morning).
//   - 1 uncovered candidate T_uncov (cin="C2U_uncov", specialty="الرياضيات"
//     matching the entry subject → avoidSpecialty penalty; M/E group=evening
//     mismatching the morning entries → groupMismatch=5).
//   - 5 schedule entries × 1 room × 1 proctor/room = 5 guard tasks, one per
//     halfday so allowHalfdayReuse=false stays binding (each peer can only
//     cover one slot in this geometry).
//   - dutyData = {} → dutyCount(T) = 0 for every proctor →
//     primaryLoad(T) = guardCount(T).
//
// Pre-fix bug: F's Hungarian/greedy fills all 5 slots with the 5 perfect-fit
// peers (each peer's cost is ~0 vs T_uncov's specialty + groupMismatch stack
// at ~5+). T_uncov never enters a min-cost cell and exits Phase 2 with
// guardCount(T_uncov) = 0 → primaryLoad(T_uncov) = 0. Phase 3 SA cannot
// create new placements (swap_roles only mutates existing slots, and the
// SA-allowed swaps preserve the same 5 peers across the 5 slots). The
// post-Phase-2 coverage-repair pass introduced by this fix is exactly what
// rescues T_uncov on F'.
//
// Pre-fix counterexample (deterministic with randomSeed=42, observed):
//   primaryLoad(C2U_uncov)  = 0   (guardCount=0,  dutyCount=0)
//   primaryLoad(C2U_peer_1) = 1   (guardCount=1,  dutyCount=0)
//   primaryLoad(C2U_peer_2) = 1   (guardCount=1,  dutyCount=0)
//   primaryLoad(C2U_peer_3) = 1   (guardCount=1,  dutyCount=0)
//   primaryLoad(C2U_peer_4) = 1   (guardCount=1,  dutyCount=0)
//   primaryLoad(C2U_peer_5) = 1   (guardCount=1,  dutyCount=0)
// All 5 guard slots are taken by peers; T_uncov sits at primaryLoad = 0
// despite being hard-constraint eligible for all 5 sessions → P3 fails.
//
// _Validates: Requirements 1.2, 1.5, 2.2 (Bug Condition C2, Property P3)_

const assert = require('assert');
const path = require('path');

const PreFixV2 = require(
  path.join(__dirname, '__snapshots__', 'proctor-v2-strict-fairness-coverage.pre-fix.js')
);
const {
  buildC2UncoveredTeacherInput
} = require('./fixtures/proctor-v2-strict-fairness-fixtures');

/**
 * Counts guard slot appearances per proctor key by scanning the result rows.
 * Reserves are NOT counted (P3 / primaryLoad excludes reserves).
 */
function countGuardLoads(rows) {
  const loads = Object.create(null);
  for (let i = 0; i < rows.length; i++) {
    const keys = rows[i].proctor_keys || [];
    for (let j = 0; j < keys.length; j++) {
      const key = keys[j];
      if (!key) continue;
      loads[key] = (loads[key] || 0) + 1;
    }
  }
  return loads;
}

const input = buildC2UncoveredTeacherInput();
const output = PreFixV2.run(input);
const rows = (output && output.result) || [];

const guardLoads = countGuardLoads(rows);

// dutyData = {} → dutyCount(T) = 0 for every proctor, so
// primaryLoad(T_uncov) = guardCount(T_uncov).
const T_UNCOV_KEY = 'C2U_uncov';
const guardCountUncov = guardLoads[T_UNCOV_KEY] || 0;
const dutyCountUncov = 0; // dutyData is empty by construction
const primaryLoadUncov = guardCountUncov + dutyCountUncov;

// Snapshot peer loads for the counterexample log so the failure message
// surfaces who edged out T_uncov.
const peerLoads = [];
for (let i = 0; i < input.proctorsList.length; i++) {
  const p = input.proctorsList[i];
  if (p.cin === T_UNCOV_KEY) continue;
  peerLoads.push({ key: p.cin, guardCount: guardLoads[p.cin] || 0 });
}

console.log('[c2-uncovered] N=' + input.proctorsList.length +
  ', G=' + (rows.reduce(function (acc, r) { return acc + (r.proctor_keys || []).length; }, 0)) +
  ', D_expected=' + input.D_expected +
  ', T_uncov=' + T_UNCOV_KEY +
  ', guardCount(T_uncov)=' + guardCountUncov +
  ', dutyCount(T_uncov)=' + dutyCountUncov +
  ', primaryLoad(T_uncov)=' + primaryLoadUncov +
  ', peerLoads=' + JSON.stringify(peerLoads));

// Property P3: full coverage on the primaryLoad axis.
//   Every eligible proctor must have at least one unit of exam-day work
//   (guard or duty). T_uncov is hard-constraint eligible for all 5 sessions
//   (no exemptions, no duty pin) so primaryLoad(T_uncov) ≥ 1 must hold.
assert.ok(
  primaryLoadUncov >= 1,
  'P3 violated on pre-fix snapshot: primaryLoad(' + T_UNCOV_KEY + ') = ' +
    primaryLoadUncov + ' (guardCount=' + guardCountUncov +
    ', dutyCount=' + dutyCountUncov + '), but T_uncov is hard-constraint ' +
    'eligible for ' + input.scheduleEntries.length + ' sessions. ' +
    'Counterexample: peerLoads=' + JSON.stringify(peerLoads) +
    ' — every guard slot was taken by a perfect-fit peer, leaving T_uncov ' +
    'with zero exam-day work.'
);

console.log('[c2-uncovered] (unexpected) P3 holds on pre-fix snapshot — ' +
  'primaryLoad(T_uncov) = ' + primaryLoadUncov + '; fixture geometry may ' +
  'need adjustment (cf. task 39 experience).');
