/**
 * Unit tests for proctor-distribution-v2.js — Task 3.2 costFunction
 * Tests: Hard constraint violations, soft constraint penalties, load balancing penalty
 */
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

// Load the module in a simulated browser context
const source = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'algorithms', 'proctor-distribution-v2.js'),
  'utf8'
);

const sandbox = { window: {}, Math, console, Infinity, isFinite, isNaN, Set, Object, Array, String, Number, Error, Date, TypeError, NaN, Map, Boolean };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const internals = sandbox.window.ProctorDistributionV2._internals;
const costFunction = internals.costFunction;
const createLoadState = internals.createLoadState;
const addGuardLoad = internals.addGuardLoad;
const INFINITY_SENTINEL = internals.INFINITY_SENTINEL;

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log('  [pass] ' + name);
    passed++;
  } catch (e) {
    console.log('  [FAIL] ' + name + ': ' + e.message);
    failed++;
  }
}

// Helper: create a basic task object
function makeTask(overrides) {
  return Object.assign({
    scheduleEntry: {},
    roomKey: 'room1',
    slotIndex: 0,
    halfdayKey: '2025-06-01|صباحا',
    sessionKey: '2025-06-01|صباحا|الحصة الأولى',
    subjectName: 'الرياضيات',
    expectedGroup: 1,
    firstProctorGender: null,
    roomUseMap: {},
    usedInSession: new Set()
  }, overrides);
}

// Helper: create basic options
function makeOptions(overrides) {
  return Object.assign({
    respectMorningEvening: false,
    preferMixedGenderPair: false,
    noRoomRepeat: false,
    avoidSpecialty: false,
    meAssignments: {},
    proctorSpecialties: {},
    proctorGenders: {}
  }, overrides);
}

console.log('[test] costFunction (Task 3.2)');

// ============================================================
// HARD CONSTRAINT TESTS
// ============================================================

console.log('\n  --- Hard Constraints ---');

runTest('returns INFINITY_SENTINEL when proctor already used in session', function () {
  const usedInSession = new Set(['proctor_A']);
  const task = makeTask({ usedInSession: usedInSession });
  const loadState = createLoadState();
  const options = makeOptions();
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, INFINITY_SENTINEL);
});

runTest('does NOT return INFINITY_SENTINEL when proctor is NOT in usedInSession', function () {
  const usedInSession = new Set(['proctor_B']);
  const task = makeTask({ usedInSession: usedInSession });
  const loadState = createLoadState();
  const options = makeOptions();
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.notStrictEqual(result, INFINITY_SENTINEL);
});

runTest('returns INFINITY_SENTINEL even when soft constraints would also apply', function () {
  const usedInSession = new Set(['proctor_A']);
  const task = makeTask({
    usedInSession: usedInSession,
    expectedGroup: 1,
    slotIndex: 1,
    firstProctorGender: 'M'
  });
  const loadState = createLoadState();
  const options = makeOptions({
    respectMorningEvening: true,
    preferMixedGenderPair: true,
    meAssignments: { proctor_A: 2 },
    proctorGenders: { proctor_A: 'M' }
  });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, INFINITY_SENTINEL);
});

// ============================================================
// SOFT CONSTRAINT: GROUP MISMATCH (penalty: 5)
// ============================================================

console.log('\n  --- Soft: Group Mismatch (penalty 5) ---');

runTest('adds 5 when respectMorningEvening=true and proctor group != expectedGroup', function () {
  const task = makeTask({ expectedGroup: 1 });
  const loadState = createLoadState();
  const options = makeOptions({
    respectMorningEvening: true,
    meAssignments: { proctor_A: 2 }
  });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 5);
});

runTest('no penalty when respectMorningEvening=false', function () {
  const task = makeTask({ expectedGroup: 1 });
  const loadState = createLoadState();
  const options = makeOptions({
    respectMorningEvening: false,
    meAssignments: { proctor_A: 2 }
  });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 0);
});

runTest('no penalty when proctor group matches expectedGroup', function () {
  const task = makeTask({ expectedGroup: 1 });
  const loadState = createLoadState();
  const options = makeOptions({
    respectMorningEvening: true,
    meAssignments: { proctor_A: 1 }
  });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 0);
});

runTest('no penalty when proctor has no group assignment', function () {
  const task = makeTask({ expectedGroup: 1 });
  const loadState = createLoadState();
  const options = makeOptions({
    respectMorningEvening: true,
    meAssignments: {}
  });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 0);
});

runTest('no penalty when expectedGroup is 0 (not set)', function () {
  const task = makeTask({ expectedGroup: 0 });
  const loadState = createLoadState();
  const options = makeOptions({
    respectMorningEvening: true,
    meAssignments: { proctor_A: 2 }
  });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 0);
});

// ============================================================
// SOFT CONSTRAINT: SAME ROOM REPEAT (penalty: 3)
// ============================================================

console.log('\n  --- Soft: Same Room Repeat (penalty 3) ---');

runTest('adds 3 when noRoomRepeat=true and proctor already used in room (Set)', function () {
  const roomUseMap = { room1: new Set(['proctor_A']) };
  const task = makeTask({ roomKey: 'room1', roomUseMap: roomUseMap });
  const loadState = createLoadState();
  const options = makeOptions({ noRoomRepeat: true });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 3);
});

runTest('adds 3 when noRoomRepeat=true and proctor already used in room (Array)', function () {
  const roomUseMap = { room1: ['proctor_A', 'proctor_B'] };
  const task = makeTask({ roomKey: 'room1', roomUseMap: roomUseMap });
  const loadState = createLoadState();
  const options = makeOptions({ noRoomRepeat: true });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 3);
});

runTest('no penalty when noRoomRepeat=false', function () {
  const roomUseMap = { room1: new Set(['proctor_A']) };
  const task = makeTask({ roomKey: 'room1', roomUseMap: roomUseMap });
  const loadState = createLoadState();
  const options = makeOptions({ noRoomRepeat: false });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 0);
});

runTest('no penalty when proctor not in roomUseMap for this room', function () {
  const roomUseMap = { room1: new Set(['proctor_B']) };
  const task = makeTask({ roomKey: 'room1', roomUseMap: roomUseMap });
  const loadState = createLoadState();
  const options = makeOptions({ noRoomRepeat: true });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 0);
});

runTest('no penalty when room not in roomUseMap', function () {
  const roomUseMap = {};
  const task = makeTask({ roomKey: 'room1', roomUseMap: roomUseMap });
  const loadState = createLoadState();
  const options = makeOptions({ noRoomRepeat: true });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 0);
});

// ============================================================
// SOFT CONSTRAINT: SUBJECT SPECIALTY (penalty: 2)
// ============================================================

console.log('\n  --- Soft: Subject Specialty (penalty 2) ---');

runTest('adds 2 when avoidSpecialty=true and proctor specialty matches subject', function () {
  const task = makeTask({ subjectName: 'الرياضيات' });
  const loadState = createLoadState();
  const options = makeOptions({
    avoidSpecialty: true,
    proctorSpecialties: { proctor_A: 'الرياضيات' }
  });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 2);
});

runTest('no penalty when avoidSpecialty=false', function () {
  const task = makeTask({ subjectName: 'الرياضيات' });
  const loadState = createLoadState();
  const options = makeOptions({
    avoidSpecialty: false,
    proctorSpecialties: { proctor_A: 'الرياضيات' }
  });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 0);
});

runTest('no penalty when proctor specialty does not match subject', function () {
  const task = makeTask({ subjectName: 'الرياضيات' });
  const loadState = createLoadState();
  const options = makeOptions({
    avoidSpecialty: true,
    proctorSpecialties: { proctor_A: 'الفيزياء' }
  });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 0);
});

runTest('no penalty when proctor has no specialty defined', function () {
  const task = makeTask({ subjectName: 'الرياضيات' });
  const loadState = createLoadState();
  const options = makeOptions({
    avoidSpecialty: true,
    proctorSpecialties: {}
  });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 0);
});

// ============================================================
// SOFT CONSTRAINT: NO GENDER PAIR (penalty: 1)
// ============================================================

console.log('\n  --- Soft: No Gender Pair (penalty 1) ---');

runTest('adds 1 when preferMixedGenderPair=true, slotIndex>0, same gender as first proctor', function () {
  const task = makeTask({ slotIndex: 1, firstProctorGender: 'M' });
  const loadState = createLoadState();
  const options = makeOptions({
    preferMixedGenderPair: true,
    proctorGenders: { proctor_A: 'M' }
  });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 1);
});

runTest('no penalty when preferMixedGenderPair=false', function () {
  const task = makeTask({ slotIndex: 1, firstProctorGender: 'M' });
  const loadState = createLoadState();
  const options = makeOptions({
    preferMixedGenderPair: false,
    proctorGenders: { proctor_A: 'M' }
  });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 0);
});

runTest('no penalty when slotIndex=0 (first proctor slot)', function () {
  const task = makeTask({ slotIndex: 0, firstProctorGender: 'M' });
  const loadState = createLoadState();
  const options = makeOptions({
    preferMixedGenderPair: true,
    proctorGenders: { proctor_A: 'M' }
  });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 0);
});

runTest('no penalty when genders differ (mixed pair)', function () {
  const task = makeTask({ slotIndex: 1, firstProctorGender: 'M' });
  const loadState = createLoadState();
  const options = makeOptions({
    preferMixedGenderPair: true,
    proctorGenders: { proctor_A: 'F' }
  });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 0);
});

runTest('no penalty when firstProctorGender is null', function () {
  const task = makeTask({ slotIndex: 1, firstProctorGender: null });
  const loadState = createLoadState();
  const options = makeOptions({
    preferMixedGenderPair: true,
    proctorGenders: { proctor_A: 'M' }
  });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 0);
});

// ============================================================
// LOAD BALANCING PENALTY
// ============================================================

console.log('\n  --- Load Balancing Penalty (4 × max(0, guardLoad - lowerBound)) ---');

runTest('no load penalty when guardLoad <= lowerBound', function () {
  const task = makeTask();
  const loadState = createLoadState();
  const options = makeOptions();
  // guardLoad = 0, lowerBound = 2 → penalty = 0
  const result = costFunction('proctor_A', task, loadState, options, {}, 2);
  assert.strictEqual(result, 0);
});

runTest('adds 4 when guardLoad exceeds lowerBound by 1', function () {
  const task = makeTask();
  const loadState = createLoadState();
  // Add 3 guard assignments to proctor_A
  addGuardLoad(loadState, 'proctor_A', '2025-06-01|صباحا', 'Teacher A');
  addGuardLoad(loadState, 'proctor_A', '2025-06-01|مساء', 'Teacher A');
  addGuardLoad(loadState, 'proctor_A', '2025-06-02|صباحا', 'Teacher A');
  const options = makeOptions();
  // guardLoad = 3, lowerBound = 2 → penalty = 4 × (3-2) = 4
  const result = costFunction('proctor_A', task, loadState, options, {}, 2);
  assert.strictEqual(result, 4);
});

runTest('adds 8 when guardLoad exceeds lowerBound by 2', function () {
  const task = makeTask();
  const loadState = createLoadState();
  addGuardLoad(loadState, 'proctor_A', '2025-06-01|صباحا', 'Teacher A');
  addGuardLoad(loadState, 'proctor_A', '2025-06-01|مساء', 'Teacher A');
  addGuardLoad(loadState, 'proctor_A', '2025-06-02|صباحا', 'Teacher A');
  addGuardLoad(loadState, 'proctor_A', '2025-06-02|مساء', 'Teacher A');
  const options = makeOptions();
  // guardLoad = 4, lowerBound = 2 → penalty = 4 × (4-2) = 8
  const result = costFunction('proctor_A', task, loadState, options, {}, 2);
  assert.strictEqual(result, 8);
});

runTest('no load penalty when lowerBound = 0 and guardLoad = 0', function () {
  const task = makeTask();
  const loadState = createLoadState();
  const options = makeOptions();
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 0);
});

// ============================================================
// COMBINED PENALTIES
// ============================================================

console.log('\n  --- Combined Penalties ---');

runTest('accumulates all soft penalties correctly (5+3+2+1 = 11)', function () {
  const roomUseMap = { room1: new Set(['proctor_A']) };
  const task = makeTask({
    expectedGroup: 1,
    roomKey: 'room1',
    roomUseMap: roomUseMap,
    subjectName: 'الرياضيات',
    slotIndex: 1,
    firstProctorGender: 'M'
  });
  const loadState = createLoadState();
  const options = makeOptions({
    respectMorningEvening: true,
    noRoomRepeat: true,
    avoidSpecialty: true,
    preferMixedGenderPair: true,
    meAssignments: { proctor_A: 2 },
    proctorSpecialties: { proctor_A: 'الرياضيات' },
    proctorGenders: { proctor_A: 'M' }
  });
  // lowerBound = 0, guardLoad = 0 → load penalty = 0
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 11);
});

runTest('accumulates soft penalties + load penalty (5+3+2+1+4 = 15)', function () {
  const roomUseMap = { room1: new Set(['proctor_A']) };
  const task = makeTask({
    expectedGroup: 1,
    roomKey: 'room1',
    roomUseMap: roomUseMap,
    subjectName: 'الرياضيات',
    slotIndex: 1,
    firstProctorGender: 'M'
  });
  const loadState = createLoadState();
  addGuardLoad(loadState, 'proctor_A', '2025-06-01|صباحا', 'Teacher A');
  const options = makeOptions({
    respectMorningEvening: true,
    noRoomRepeat: true,
    avoidSpecialty: true,
    preferMixedGenderPair: true,
    meAssignments: { proctor_A: 2 },
    proctorSpecialties: { proctor_A: 'الرياضيات' },
    proctorGenders: { proctor_A: 'M' }
  });
  // guardLoad = 1, lowerBound = 0 → load penalty = 4 × 1 = 4
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 15);
});

runTest('zero cost when no constraints violated and load at or below bound', function () {
  const task = makeTask();
  const loadState = createLoadState();
  const options = makeOptions();
  const result = costFunction('proctor_A', task, loadState, options, {}, 5);
  assert.strictEqual(result, 0);
});

runTest('only load penalty when no soft constraints enabled', function () {
  const task = makeTask();
  const loadState = createLoadState();
  addGuardLoad(loadState, 'proctor_A', '2025-06-01|صباحا', 'Teacher A');
  addGuardLoad(loadState, 'proctor_A', '2025-06-01|مساء', 'Teacher A');
  addGuardLoad(loadState, 'proctor_A', '2025-06-02|صباحا', 'Teacher A');
  const options = makeOptions();
  // guardLoad = 3, lowerBound = 1 → penalty = 4 × 2 = 8
  const result = costFunction('proctor_A', task, loadState, options, {}, 1);
  assert.strictEqual(result, 8);
});

// ============================================================
// EDGE CASES
// ============================================================

console.log('\n  --- Edge Cases ---');

runTest('handles empty usedInSession set', function () {
  const task = makeTask({ usedInSession: new Set() });
  const loadState = createLoadState();
  const options = makeOptions();
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 0);
});

runTest('handles null/undefined roomUseMap gracefully', function () {
  const task = makeTask({ roomUseMap: null });
  const loadState = createLoadState();
  const options = makeOptions({ noRoomRepeat: true });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 0);
});

runTest('handles missing proctorSpecialties gracefully', function () {
  const task = makeTask({ subjectName: 'الرياضيات' });
  const loadState = createLoadState();
  const options = makeOptions({
    avoidSpecialty: true,
    proctorSpecialties: null
  });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 0);
});

runTest('handles missing proctorGenders gracefully', function () {
  const task = makeTask({ slotIndex: 1, firstProctorGender: 'M' });
  const loadState = createLoadState();
  const options = makeOptions({
    preferMixedGenderPair: true,
    proctorGenders: null
  });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 0);
});

runTest('handles missing meAssignments gracefully', function () {
  const task = makeTask({ expectedGroup: 1 });
  const loadState = createLoadState();
  const options = makeOptions({
    respectMorningEvening: true,
    meAssignments: null
  });
  const result = costFunction('proctor_A', task, loadState, options, {}, 0);
  assert.strictEqual(result, 0);
});

runTest('weights parameter is accepted but not used in cost calculation', function () {
  const task = makeTask();
  const loadState = createLoadState();
  const options = makeOptions();
  const result1 = costFunction('proctor_A', task, loadState, options, { alpha: 3, beta: 1, gamma: 2 }, 0);
  const result2 = costFunction('proctor_A', task, loadState, options, { alpha: 1, beta: 4, gamma: 1 }, 0);
  assert.strictEqual(result1, result2);
});

// === Summary ===

console.log('\n[test] costFunction: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  process.exit(1);
}
