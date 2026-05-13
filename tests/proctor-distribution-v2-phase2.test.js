/**
 * Unit tests for proctor-distribution-v2.js — Task 4.1: buildCostMatrix + phase2Build
 * Tests: cost matrix construction, phase2 orchestration, diagnostics, dual-proctor rooms, timeout
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

const sandbox = {
  window: {},
  Math, console, Infinity, isFinite, isNaN,
  Set, Map, Object, Array, String, Number, Error, Boolean, Date,
  parseInt, parseFloat, TypeError, RangeError
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const internals = sandbox.window.ProctorDistributionV2._internals;
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

// ============================================================
// TEST HELPERS
// ============================================================

function makeProctor(name, cin, gender, specialty) {
  return {
    id: Math.floor(Math.random() * 10000),
    teacher_name: name,
    teacher_name_fr: name,
    specialty: specialty || 'رياضيات',
    cin: cin || '',
    som: '',
    gender: gender || 'ذكر',
    room: ''
  };
}

function makeScheduleEntry(overrides) {
  return Object.assign({
    day: 'الأول',
    period: 'صباحا',
    session: 'الحصة الأولى',
    level_name: 'الأولى باك',
    subject_name: 'الرياضيات',
    date_day: '15',
    date_month: '3',
    date_year: '2026',
    time_from: '08:00',
    time_to: '10:00'
  }, overrides || {});
}

function makeRoom(roomNum, levelName) {
  return {
    room_num: String(roomNum),
    roomName: 'قاعة ' + roomNum,
    level_name: levelName || 'الأولى باك'
  };
}

function makeValidInput(overrides) {
  var proctors = (overrides && overrides.proctorsList) || [
    makeProctor('أحمد', 'CIN001', 'ذكر'),
    makeProctor('فاطمة', 'CIN002', 'أنثى'),
    makeProctor('محمد', 'CIN003', 'ذكر')
  ];
  var entries = (overrides && overrides.scheduleEntries) || [makeScheduleEntry()];
  var rooms = (overrides && overrides.roomsList) || [makeRoom(1, 'الأولى باك')];

  return {
    proctorsList: proctors,
    scheduleEntries: entries,
    exemptionsData: (overrides && overrides.exemptionsData) || {},
    dutyData: (overrides && overrides.dutyData) || {},
    meAssignments: (overrides && overrides.meAssignments) || {},
    examDistributionRules: (overrides && overrides.examDistributionRules) || { proctorsPerRoom: 1, reservesPerSession: 1 },
    options: Object.assign(
      { allowHalfdayReuse: true, allowDayReuse: true, roomsList: rooms },
      (overrides && overrides.options) || {}
    ),
    randomSeed: (overrides && overrides.randomSeed) || 42
  };
}

function makePhase1Result(overrides) {
  return Object.assign({
    cspModel: { variables: [], domains: new Map(), constraints: [] },
    prefixedAssignments: new Map(),
    lowerBound: 0,
    upperBound: 1,
    diagnostics: {
      phase1DurationMs: 0,
      lowerBound: 0,
      upperBound: 1,
      singletonCount: 0,
      domainReductionPercent: 0,
      infeasibilities: [],
      warnings: []
    }
  }, overrides || {});
}

// ============================================================
// buildCostMatrix TESTS
// ============================================================

console.log('[test] buildCostMatrix (Task 4.1)');
console.log('\n  --- Basic Construction ---');

runTest('builds square matrix when tasks == proctors', function () {
  var tasks = [
    { scheduleEntry: {}, roomKey: 'r1', slotIndex: 0, halfdayKey: '2026-03-15|صباحا',
      sessionKey: 's1', subjectName: '', expectedGroup: 0, firstProctorGender: null,
      roomUseMap: {}, usedInSession: new Set() },
    { scheduleEntry: {}, roomKey: 'r2', slotIndex: 0, halfdayKey: '2026-03-15|صباحا',
      sessionKey: 's1', subjectName: '', expectedGroup: 0, firstProctorGender: null,
      roomUseMap: {}, usedInSession: new Set() }
  ];
  var proctors = [
    { key: 'CIN001', name: 'أحمد', gender: 'M' },
    { key: 'CIN002', name: 'فاطمة', gender: 'F' }
  ];
  var loadState = internals.createLoadState();
  var options = { respectMorningEvening: false, preferMixedGenderPair: false,
    noRoomRepeat: false, avoidSpecialty: false, meAssignments: {},
    proctorSpecialties: {}, proctorGenders: {} };

  var matrix = internals.buildCostMatrix(tasks, proctors, loadState, options, {}, 0);

  assert.strictEqual(matrix.length, 2, 'Matrix should be 2x2');
  assert.strictEqual(matrix[0].length, 2, 'Row 0 should have 2 cols');
  assert.strictEqual(matrix[1].length, 2, 'Row 1 should have 2 cols');
  // All costs should be 0 (no constraints violated, no load)
  assert.strictEqual(matrix[0][0], 0);
  assert.strictEqual(matrix[0][1], 0);
  assert.strictEqual(matrix[1][0], 0);
  assert.strictEqual(matrix[1][1], 0);
});

runTest('pads with dummy columns when proctors < tasks', function () {
  var tasks = [
    { scheduleEntry: {}, roomKey: 'r1', slotIndex: 0, halfdayKey: '2026-03-15|صباحا',
      sessionKey: 's1', subjectName: '', expectedGroup: 0, firstProctorGender: null,
      roomUseMap: {}, usedInSession: new Set() },
    { scheduleEntry: {}, roomKey: 'r2', slotIndex: 0, halfdayKey: '2026-03-15|صباحا',
      sessionKey: 's1', subjectName: '', expectedGroup: 0, firstProctorGender: null,
      roomUseMap: {}, usedInSession: new Set() },
    { scheduleEntry: {}, roomKey: 'r3', slotIndex: 0, halfdayKey: '2026-03-15|صباحا',
      sessionKey: 's1', subjectName: '', expectedGroup: 0, firstProctorGender: null,
      roomUseMap: {}, usedInSession: new Set() }
  ];
  var proctors = [
    { key: 'CIN001', name: 'أحمد', gender: 'M' }
  ];
  var loadState = internals.createLoadState();
  var options = { respectMorningEvening: false, preferMixedGenderPair: false,
    noRoomRepeat: false, avoidSpecialty: false, meAssignments: {},
    proctorSpecialties: {}, proctorGenders: {} };

  var matrix = internals.buildCostMatrix(tasks, proctors, loadState, options, {}, 0);

  // Should be 3x3 (padded to square)
  assert.strictEqual(matrix.length, 3, 'Matrix should be 3x3');
  assert.strictEqual(matrix[0].length, 3);
  // First column should have real costs (0), rest should be INFINITY_SENTINEL
  assert.strictEqual(matrix[0][0], 0);
  assert.strictEqual(matrix[0][1], INFINITY_SENTINEL, 'Dummy col should be INFINITY_SENTINEL');
  assert.strictEqual(matrix[0][2], INFINITY_SENTINEL, 'Dummy col should be INFINITY_SENTINEL');
  assert.strictEqual(matrix[1][0], 0);
  assert.strictEqual(matrix[2][0], 0);
});

runTest('pads with dummy rows when proctors > tasks', function () {
  var tasks = [
    { scheduleEntry: {}, roomKey: 'r1', slotIndex: 0, halfdayKey: '2026-03-15|صباحا',
      sessionKey: 's1', subjectName: '', expectedGroup: 0, firstProctorGender: null,
      roomUseMap: {}, usedInSession: new Set() }
  ];
  var proctors = [
    { key: 'CIN001', name: 'أحمد', gender: 'M' },
    { key: 'CIN002', name: 'فاطمة', gender: 'F' },
    { key: 'CIN003', name: 'محمد', gender: 'M' }
  ];
  var loadState = internals.createLoadState();
  var options = { respectMorningEvening: false, preferMixedGenderPair: false,
    noRoomRepeat: false, avoidSpecialty: false, meAssignments: {},
    proctorSpecialties: {}, proctorGenders: {} };

  var matrix = internals.buildCostMatrix(tasks, proctors, loadState, options, {}, 0);

  // Should be 3x3 (padded to square)
  assert.strictEqual(matrix.length, 3, 'Matrix should be 3x3');
  assert.strictEqual(matrix[0].length, 3);
  // First row has real costs, dummy rows have INFINITY_SENTINEL
  assert.strictEqual(matrix[0][0], 0);
  assert.strictEqual(matrix[0][1], 0);
  assert.strictEqual(matrix[0][2], 0);
  assert.strictEqual(matrix[1][0], INFINITY_SENTINEL, 'Dummy row should be INFINITY_SENTINEL');
  assert.strictEqual(matrix[2][0], INFINITY_SENTINEL, 'Dummy row should be INFINITY_SENTINEL');
});

runTest('marks hard constraint violations as INFINITY_SENTINEL', function () {
  var usedInSession = new Set(['CIN001']);
  var tasks = [
    { scheduleEntry: {}, roomKey: 'r1', slotIndex: 0, halfdayKey: '2026-03-15|صباحا',
      sessionKey: 's1', subjectName: '', expectedGroup: 0, firstProctorGender: null,
      roomUseMap: {}, usedInSession: usedInSession }
  ];
  var proctors = [
    { key: 'CIN001', name: 'أحمد', gender: 'M' },
    { key: 'CIN002', name: 'فاطمة', gender: 'F' }
  ];
  var loadState = internals.createLoadState();
  var options = { respectMorningEvening: false, preferMixedGenderPair: false,
    noRoomRepeat: false, avoidSpecialty: false, meAssignments: {},
    proctorSpecialties: {}, proctorGenders: {} };

  var matrix = internals.buildCostMatrix(tasks, proctors, loadState, options, {}, 0);

  // CIN001 is used in session → INFINITY_SENTINEL
  assert.strictEqual(matrix[0][0], INFINITY_SENTINEL);
  // CIN002 is not used → 0
  assert.strictEqual(matrix[0][1], 0);
});

// ============================================================
// phase2Build TESTS
// ============================================================

console.log('\n[test] phase2Build (Task 4.1)');
console.log('\n  --- Basic Orchestration ---');

runTest('returns correct structure with diagnostics', function () {
  var input = makeValidInput();
  var phase1Result = makePhase1Result();
  var rng = internals.buildSeededPRNG(42);

  var result = internals.phase2Build(phase1Result, input, rng);

  assert.ok(result.assignments, 'Should have assignments array');
  assert.ok(result.loadState, 'Should have loadState');
  assert.ok(result.diagnostics, 'Should have diagnostics');
  assert.strictEqual(typeof result.diagnostics.phase2DurationMs, 'number');
  assert.strictEqual(typeof result.diagnostics.fallbackCount, 'number');
  assert.strictEqual(typeof result.diagnostics.totalHalfdaysProcessed, 'number');
  assert.strictEqual(typeof result.diagnostics.averageCostPerAssignment, 'number');
  assert.ok(Array.isArray(result.diagnostics.fallbackHalfdays));
});

runTest('assigns proctors to rooms for a single halfday', function () {
  var proctors = [
    makeProctor('أحمد', 'CIN001', 'ذكر'),
    makeProctor('فاطمة', 'CIN002', 'أنثى'),
    makeProctor('محمد', 'CIN003', 'ذكر')
  ];
  var entries = [makeScheduleEntry()];
  var rooms = [makeRoom(1, 'الأولى باك')];
  var input = makeValidInput({ proctorsList: proctors, scheduleEntries: entries, roomsList: rooms });
  var phase1Result = makePhase1Result();
  var rng = internals.buildSeededPRNG(42);

  var result = internals.phase2Build(phase1Result, input, rng);

  assert.strictEqual(result.assignments.length, 1, 'Should have 1 assignment row');
  assert.strictEqual(result.diagnostics.totalHalfdaysProcessed, 1);
  // Should have assigned a proctor
  assert.ok(result.assignments[0].proctors.length > 0, 'Should have at least one proctor assigned');
  assert.ok(result.assignments[0].proctor_keys.length > 0, 'Should have proctor key');
});

runTest('produces correct AssignmentRow format', function () {
  var input = makeValidInput();
  var phase1Result = makePhase1Result();
  var rng = internals.buildSeededPRNG(42);

  var result = internals.phase2Build(phase1Result, input, rng);
  var row = result.assignments[0];

  // Check all required fields exist
  assert.ok('session_key' in row, 'Missing session_key');
  assert.ok('session_label' in row, 'Missing session_label');
  assert.ok('halfday_key' in row, 'Missing halfday_key');
  assert.ok('group_number' in row, 'Missing group_number');
  assert.ok('group_label' in row, 'Missing group_label');
  assert.ok('day' in row, 'Missing day');
  assert.ok('period' in row, 'Missing period');
  assert.ok('session' in row, 'Missing session');
  assert.ok('schedule_entry' in row, 'Missing schedule_entry');
  assert.ok('level_name' in row, 'Missing level_name');
  assert.ok('subject_name' in row, 'Missing subject_name');
  assert.ok('duty_teachers' in row, 'Missing duty_teachers');
  assert.ok('duty_teacher_keys' in row, 'Missing duty_teacher_keys');
  assert.ok('room_name' in row, 'Missing room_name');
  assert.ok('room_number' in row, 'Missing room_number');
  assert.ok('room_key' in row, 'Missing room_key');
  assert.ok('room_place' in row, 'Missing room_place');
  assert.ok('proctors' in row, 'Missing proctors');
  assert.ok('proctor_keys' in row, 'Missing proctor_keys');
  assert.ok('proctor_groups' in row, 'Missing proctor_groups');
  assert.ok('reserves' in row, 'Missing reserves');
  assert.ok('reserve_keys' in row, 'Missing reserve_keys');
  assert.ok('notes' in row, 'Missing notes');
  assert.ok('softViolations' in row, 'Missing softViolations');

  // Check types
  assert.ok(Array.isArray(row.proctors));
  assert.ok(Array.isArray(row.proctor_keys));
  assert.ok(Array.isArray(row.proctor_groups));
  assert.ok(Array.isArray(row.reserves));
  assert.ok(Array.isArray(row.reserve_keys));
  assert.ok(Array.isArray(row.softViolations));
  assert.ok(Array.isArray(row.duty_teachers));
  assert.ok(Array.isArray(row.duty_teacher_keys));
});

runTest('groups entries by halfday correctly', function () {
  var entries = [
    makeScheduleEntry({ period: 'صباحا', session: 'الحصة الأولى' }),
    makeScheduleEntry({ period: 'صباحا', session: 'الحصة الثانية' }),
    makeScheduleEntry({ period: 'مساء', session: 'الحصة الأولى' })
  ];
  var proctors = [
    makeProctor('أحمد', 'CIN001', 'ذكر'),
    makeProctor('فاطمة', 'CIN002', 'أنثى'),
    makeProctor('محمد', 'CIN003', 'ذكر'),
    makeProctor('خديجة', 'CIN004', 'أنثى'),
    makeProctor('علي', 'CIN005', 'ذكر')
  ];
  var rooms = [makeRoom(1, 'الأولى باك')];
  var input = makeValidInput({
    proctorsList: proctors,
    scheduleEntries: entries,
    roomsList: rooms
  });
  var phase1Result = makePhase1Result();
  var rng = internals.buildSeededPRNG(42);

  var result = internals.phase2Build(phase1Result, input, rng);

  // 2 halfdays: morning (2 entries) and evening (1 entry)
  assert.strictEqual(result.diagnostics.totalHalfdaysProcessed, 2);
  // 3 entries × 1 room = 3 assignment rows
  assert.strictEqual(result.assignments.length, 3);
});

runTest('handles multiple rooms per entry', function () {
  var entries = [makeScheduleEntry()];
  var proctors = [
    makeProctor('أحمد', 'CIN001', 'ذكر'),
    makeProctor('فاطمة', 'CIN002', 'أنثى'),
    makeProctor('محمد', 'CIN003', 'ذكر')
  ];
  var rooms = [
    makeRoom(1, 'الأولى باك'),
    makeRoom(2, 'الأولى باك'),
    makeRoom(3, 'الأولى باك')
  ];
  var input = makeValidInput({
    proctorsList: proctors,
    scheduleEntries: entries,
    roomsList: rooms
  });
  var phase1Result = makePhase1Result();
  var rng = internals.buildSeededPRNG(42);

  var result = internals.phase2Build(phase1Result, input, rng);

  // 1 entry × 3 rooms = 3 assignment rows
  assert.strictEqual(result.assignments.length, 3);
  // Each should have a different room
  var roomKeys = result.assignments.map(function (r) { return r.room_key; });
  assert.strictEqual(new Set(roomKeys).size, 3, 'Should have 3 different rooms');
});

console.log('\n  --- Dual-Proctor Rooms ---');

runTest('assigns two proctors when proctorsPerRoom = 2', function () {
  var proctors = [
    makeProctor('أحمد', 'CIN001', 'ذكر'),
    makeProctor('فاطمة', 'CIN002', 'أنثى'),
    makeProctor('محمد', 'CIN003', 'ذكر'),
    makeProctor('خديجة', 'CIN004', 'أنثى')
  ];
  var entries = [makeScheduleEntry()];
  var rooms = [makeRoom(1, 'الأولى باك')];
  var input = makeValidInput({
    proctorsList: proctors,
    scheduleEntries: entries,
    roomsList: rooms,
    examDistributionRules: { proctorsPerRoom: 2, reservesPerSession: 1 }
  });
  var phase1Result = makePhase1Result();
  var rng = internals.buildSeededPRNG(42);

  var result = internals.phase2Build(phase1Result, input, rng);

  assert.strictEqual(result.assignments.length, 1);
  // Should have 2 proctors assigned
  assert.strictEqual(result.assignments[0].proctors.length, 2, 'Should have 2 proctors');
  assert.strictEqual(result.assignments[0].proctor_keys.length, 2, 'Should have 2 proctor keys');
  // Proctors should be different
  assert.notStrictEqual(
    result.assignments[0].proctor_keys[0],
    result.assignments[0].proctor_keys[1],
    'Two proctors should be different'
  );
});

console.log('\n  --- Exemptions and Duty ---');

runTest('excludes exempt proctors from assignment', function () {
  var proctors = [
    makeProctor('أحمد', 'CIN001', 'ذكر'),
    makeProctor('فاطمة', 'CIN002', 'أنثى')
  ];
  var entries = [makeScheduleEntry()];
  var rooms = [makeRoom(1, 'الأولى باك')];
  // Exempt CIN001 for this session
  var exemptionsData = {};
  exemptionsData['session|الأول|صباحا|الحصة الأولى'] = { 'CIN001': 'no' };

  var input = makeValidInput({
    proctorsList: proctors,
    scheduleEntries: entries,
    roomsList: rooms,
    exemptionsData: exemptionsData
  });
  var phase1Result = makePhase1Result();
  var rng = internals.buildSeededPRNG(42);

  var result = internals.phase2Build(phase1Result, input, rng);

  // CIN001 should NOT be assigned
  assert.strictEqual(result.assignments.length, 1);
  assert.ok(
    result.assignments[0].proctor_keys.indexOf('CIN001') === -1,
    'Exempt proctor CIN001 should not be assigned'
  );
  // CIN002 should be assigned
  assert.ok(
    result.assignments[0].proctor_keys.indexOf('CIN002') !== -1,
    'Non-exempt proctor CIN002 should be assigned'
  );
});

runTest('excludes duty teachers from assignment', function () {
  var proctors = [
    makeProctor('أحمد', 'CIN001', 'ذكر'),
    makeProctor('فاطمة', 'CIN002', 'أنثى')
  ];
  var entries = [makeScheduleEntry()];
  var rooms = [makeRoom(1, 'الأولى باك')];
  // CIN001 is duty teacher for this session+subject
  var dutyData = {};
  dutyData['2026-03-15|الأول|صباحا|الحصة الأولى|الرياضيات'] = { 'CIN001': true };

  var input = makeValidInput({
    proctorsList: proctors,
    scheduleEntries: entries,
    roomsList: rooms,
    dutyData: dutyData
  });
  var phase1Result = makePhase1Result();
  var rng = internals.buildSeededPRNG(42);

  var result = internals.phase2Build(phase1Result, input, rng);

  assert.strictEqual(result.assignments.length, 1);
  assert.ok(
    result.assignments[0].proctor_keys.indexOf('CIN001') === -1,
    'Duty teacher CIN001 should not be assigned as proctor'
  );
});

console.log('\n  --- Diagnostics ---');

runTest('diagnostics fields are populated correctly', function () {
  var proctors = [
    makeProctor('أحمد', 'CIN001', 'ذكر'),
    makeProctor('فاطمة', 'CIN002', 'أنثى'),
    makeProctor('محمد', 'CIN003', 'ذكر')
  ];
  var entries = [
    makeScheduleEntry({ period: 'صباحا' }),
    makeScheduleEntry({ period: 'مساء' })
  ];
  var rooms = [makeRoom(1, 'الأولى باك')];
  var input = makeValidInput({
    proctorsList: proctors,
    scheduleEntries: entries,
    roomsList: rooms
  });
  var phase1Result = makePhase1Result();
  var rng = internals.buildSeededPRNG(42);

  var result = internals.phase2Build(phase1Result, input, rng);

  assert.ok(result.diagnostics.phase2DurationMs >= 0, 'phase2DurationMs should be >= 0');
  assert.strictEqual(result.diagnostics.totalHalfdaysProcessed, 2, 'Should process 2 halfdays');
  assert.strictEqual(result.diagnostics.fallbackCount, 0, 'No fallback needed');
  assert.strictEqual(result.diagnostics.fallbackHalfdays.length, 0, 'No fallback halfdays');
  assert.ok(result.diagnostics.averageCostPerAssignment >= 0);
});

runTest('fallbackCount increments when no proctors available', function () {
  // All proctors exempt → no available proctors → fallback
  var proctors = [makeProctor('أحمد', 'CIN001', 'ذكر')];
  var entries = [makeScheduleEntry()];
  var rooms = [makeRoom(1, 'الأولى باك')];
  var exemptionsData = {};
  exemptionsData['session|الأول|صباحا|الحصة الأولى'] = { 'CIN001': 'no' };

  var input = makeValidInput({
    proctorsList: proctors,
    scheduleEntries: entries,
    roomsList: rooms,
    exemptionsData: exemptionsData
  });
  var phase1Result = makePhase1Result();
  var rng = internals.buildSeededPRNG(42);

  var result = internals.phase2Build(phase1Result, input, rng);

  // With no available proctors, fallback is invoked
  assert.ok(result.diagnostics.fallbackCount >= 1, 'Should have fallback count >= 1');
  assert.ok(result.diagnostics.fallbackHalfdays.length >= 1, 'Should record fallback halfday');
});

console.log('\n  --- No Same Proctor in Same Session ---');

runTest('does not assign same proctor to multiple rooms in same session', function () {
  var proctors = [
    makeProctor('أحمد', 'CIN001', 'ذكر'),
    makeProctor('فاطمة', 'CIN002', 'أنثى'),
    makeProctor('محمد', 'CIN003', 'ذكر')
  ];
  var entries = [makeScheduleEntry()];
  var rooms = [
    makeRoom(1, 'الأولى باك'),
    makeRoom(2, 'الأولى باك'),
    makeRoom(3, 'الأولى باك')
  ];
  var input = makeValidInput({
    proctorsList: proctors,
    scheduleEntries: entries,
    roomsList: rooms
  });
  var phase1Result = makePhase1Result();
  var rng = internals.buildSeededPRNG(42);

  var result = internals.phase2Build(phase1Result, input, rng);

  // All 3 rooms should have different proctors
  var assignedKeys = result.assignments
    .map(function (r) { return r.proctor_keys[0]; })
    .filter(Boolean);
  var uniqueKeys = new Set(assignedKeys);
  assert.strictEqual(uniqueKeys.size, assignedKeys.length,
    'No proctor should be assigned to multiple rooms in same session');
});

console.log('\n  --- normalizeGender ---');

runTest('normalizes Arabic gender strings', function () {
  assert.strictEqual(internals.normalizeGender('ذكر'), 'M');
  assert.strictEqual(internals.normalizeGender('أنثى'), 'F');
  assert.strictEqual(internals.normalizeGender('M'), 'M');
  assert.strictEqual(internals.normalizeGender('F'), 'F');
  assert.strictEqual(internals.normalizeGender(''), '');
  assert.strictEqual(internals.normalizeGender(null), '');
  assert.strictEqual(internals.normalizeGender(undefined), '');
});

// === Summary ===
console.log('\n[test] phase2Build: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  process.exit(1);
}
