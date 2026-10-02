'use strict';

// Regression test for the greedyFallback hard-cap guard.
//
// Spec: proctor-v2-phase2-timeout-and-greedy-cap, Phase B task 7.
//
// PURPOSE: tripwire that fails immediately if a future refactor weakens the
// `if (bestProctor !== null && bestCost < INFINITY_SENTINEL)` guard at the
// end of greedyFallback (≈line 1620 in proctor-distribution-v2.js).
//
// The guard ensures: when EVERY candidate's costFunction returns
// INFINITY_SENTINEL (e.g. all candidates already at classUpperBound), the
// slot is left null and shortages++ rather than silently admitting an
// over-cap candidate.
//
// EXPECTED on F': PASSES. The guard is already in place; this test pins it.
//
// _Validates: bugfix.md C2, P2_

const path = require('path');
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js/algorithms/proctor-distribution-v2.js'), 'utf8');

const sandbox = {
  console,
  Date,
  Math,
  Number,
  Object,
  Array,
  Set,
  Map,
  JSON,
  isFinite,
  isNaN,
  Infinity,
  parseInt
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const V2 = sandbox.ProctorDistributionV2;
const internals = V2._internals;
const INFINITY_SENTINEL = internals.INFINITY_SENTINEL;

// === Test 1: every candidate INFINITY_SENTINEL → all slots null, shortages > 0 ===

const loadState = internals.createLoadState();
const tasks = [
  {
    scheduleEntry: { day: 'الأول', period: 'صباحا', session: 'الحصة الأولى' },
    roomKey: 'R1',
    slotIndex: 0,
    halfdayKey: '2026-03-10|صباحا',
    sessionKey: 'sk',
    subjectName: 'م',
    expectedGroup: 1,
    firstProctorGender: null,
    roomUseMap: {},
    usedInSession: new Set()
  }
];

const overCapProctor = {
  key: 'T_OVER',
  name: 'OverCap',
  gender: 'M',
  specialty: '',
  index: 0,
  proc: { teacher_name: 'OverCap', cin: 'T_OVER' }
};

// Pre-load T_OVER to primaryLoad = 5 with classUpperBound = 3 so the cap fires.
internals.addGuardLoad(loadState, 'T_OVER', '2026-03-09|صباحا', 'OverCap');
internals.addGuardLoad(loadState, 'T_OVER', '2026-03-09|مساء', 'OverCap');
internals.addGuardLoad(loadState, 'T_OVER', '2026-03-08|صباحا', 'OverCap');
internals.addGuardLoad(loadState, 'T_OVER', '2026-03-08|مساء', 'OverCap');
internals.addGuardLoad(loadState, 'T_OVER', '2026-03-07|صباحا', 'OverCap');

const options = {
  classBoundsByProctorKey: {
    T_OVER: { classLowerBound: 2, classUpperBound: 3 }
  }
};

// Sanity: confirm costFunction returns INFINITY_SENTINEL for T_OVER on this task.
const sanityCost = internals.costFunction(
  'T_OVER',
  tasks[0],
  loadState,
  options,
  { alpha: 3, beta: 1, gamma: 2 },
  0
);
assert.strictEqual(
  sanityCost,
  INFINITY_SENTINEL,
  'sanity: T_OVER at primaryLoad=5 should be INFINITY_SENTINEL when classUB=3 ' +
  '(got ' + sanityCost + ')'
);

const fallbackResult = internals.greedyFallback(
  tasks,
  [overCapProctor],
  loadState,
  options,
  { alpha: 3, beta: 1, gamma: 2 },
  0
);

assert.strictEqual(
  fallbackResult.assignments.length,
  1,
  'one assignment record per task'
);
assert.strictEqual(
  fallbackResult.assignments[0].proctorKey,
  null,
  'when every candidate is INFINITY_SENTINEL, proctorKey MUST be null ' +
  '(got ' + fallbackResult.assignments[0].proctorKey + ')'
);
assert.strictEqual(
  fallbackResult.shortages,
  1,
  'when every candidate is INFINITY_SENTINEL, shortages MUST increment by 1 ' +
  '(got ' + fallbackResult.shortages + ')'
);

// Confirm hard cap stays inviolate: T_OVER's primaryLoad did not increase.
const postPrimaryLoad = internals.getPrimaryLoad(loadState, 'T_OVER');
assert.strictEqual(
  postPrimaryLoad,
  5,
  'T_OVER primaryLoad must remain 5 (no guard added when over-cap); got ' +
  postPrimaryLoad
);

// === Test 2: at least one finite candidate → that candidate is picked ===

const loadState2 = internals.createLoadState();
const finiteProctor = {
  key: 'T_FINITE',
  name: 'Finite',
  gender: 'M',
  specialty: '',
  index: 0,
  proc: { teacher_name: 'Finite', cin: 'T_FINITE' }
};

const options2 = {
  classBoundsByProctorKey: {
    T_FINITE: { classLowerBound: 0, classUpperBound: 5 },
    T_OVER: { classLowerBound: 0, classUpperBound: 5 }
  }
};

const tasks2 = [
  {
    scheduleEntry: { day: 'الأول', period: 'صباحا', session: 'الحصة الأولى' },
    roomKey: 'R2',
    slotIndex: 0,
    halfdayKey: '2026-03-10|صباحا',
    sessionKey: 'sk2',
    subjectName: 'م',
    expectedGroup: 1,
    firstProctorGender: null,
    roomUseMap: {},
    usedInSession: new Set()
  }
];

const fallbackResult2 = internals.greedyFallback(
  tasks2,
  [finiteProctor],
  loadState2,
  options2,
  { alpha: 3, beta: 1, gamma: 2 },
  0
);

assert.strictEqual(
  fallbackResult2.assignments[0].proctorKey,
  'T_FINITE',
  'finite candidate must be picked (got ' +
  fallbackResult2.assignments[0].proctorKey + ')'
);
assert.strictEqual(
  fallbackResult2.shortages,
  0,
  'no shortage when a finite candidate is available'
);

console.log('[pass] greedyFallback regression: all-INFINITY_SENTINEL → null + shortage');
console.log('[pass] greedyFallback regression: finite candidate → picked');
