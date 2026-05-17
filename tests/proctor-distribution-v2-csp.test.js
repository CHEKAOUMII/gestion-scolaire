/**
 * Unit tests for proctor-distribution-v2.js — Task 2.1: buildCSPModel
 * Tests: variable construction, domain filtering, unary/binary constraints
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

// ============================================================
// TEST HELPERS
// ============================================================

function makeProctor(name, cin, gender) {
  return {
    id: Math.floor(Math.random() * 10000),
    teacher_name: name,
    teacher_name_fr: name,
    specialty: 'رياضيات',
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

// ============================================================
// TESTS
// ============================================================

function testBasicVariableConstruction() {
  var proctors = [
    makeProctor('أحمد', 'CIN001'),
    makeProctor('فاطمة', 'CIN002')
  ];
  var entries = [makeScheduleEntry()];
  var rooms = [makeRoom(1, 'الأولى باك')];
  var rules = { proctorsPerRoom: 1, reservesPerSession: 1 };
  var options = { allowHalfdayReuse: true, allowDayReuse: true, roomsList: rooms };

  var model = internals.buildCSPModel(entries, proctors, {}, {}, rules, options);

  // Should have 1 variable (1 entry × 1 room × 1 slot)
  assert.strictEqual(model.variables.length, 1, 'Should have 1 variable');

  var v = model.variables[0];
  assert.ok(v.id, 'Variable should have an id');
  assert.ok(v.scheduleEntryId, 'Variable should have scheduleEntryId');
  assert.strictEqual(v.roomKey, '1', 'Variable roomKey should match room_num');
  assert.strictEqual(v.slotIndex, 0, 'Variable slotIndex should be 0');
  assert.ok(v._sessionKey, 'Variable should have _sessionKey');
  assert.ok(v._halfdayKey, 'Variable should have _halfdayKey');
  assert.ok(v._dayKey, 'Variable should have _dayKey');

  console.log('  [pass] testBasicVariableConstruction');
}

function testMultipleRoomsAndSlots() {
  var proctors = [makeProctor('أحمد', 'CIN001')];
  var entries = [makeScheduleEntry()];
  var rooms = [makeRoom(1, 'الأولى باك'), makeRoom(2, 'الأولى باك')];
  var rules = { proctorsPerRoom: 2, reservesPerSession: 1 };
  var options = { allowHalfdayReuse: true, allowDayReuse: true, roomsList: rooms };

  var model = internals.buildCSPModel(entries, proctors, {}, {}, rules, options);

  // Should have 4 variables (1 entry × 2 rooms × 2 slots)
  assert.strictEqual(model.variables.length, 4, 'Should have 4 variables (2 rooms × 2 slots)');

  // Verify slot indices
  var slots = model.variables.map(function (v) { return v.slotIndex; });
  assert.strictEqual(JSON.stringify(slots), JSON.stringify([0, 1, 0, 1]), 'Slot indices should alternate 0,1,0,1');

  console.log('  [pass] testMultipleRoomsAndSlots');
}

function testDomainFiltersExemptions() {
  var proctors = [
    makeProctor('أحمد', 'CIN001'),
    makeProctor('فاطمة', 'CIN002'),
    makeProctor('محمد', 'CIN003')
  ];
  var entries = [makeScheduleEntry({ day: 'الأول', period: 'صباحا', session: 'الحصة الأولى' })];
  var rooms = [makeRoom(1, 'الأولى باك')];
  var rules = { proctorsPerRoom: 1 };

  // Exempt CIN001 for this session
  var exemptionsData = {
    'session|الأول|صباحا|الحصة الأولى': { 'CIN001': 'no' }
  };

  var options = { allowHalfdayReuse: true, allowDayReuse: true, roomsList: rooms };
  var model = internals.buildCSPModel(entries, proctors, exemptionsData, {}, rules, options);

  // Domain should not contain CIN001
  var domain = model.domains.get(model.variables[0].id);
  assert.strictEqual(domain.has('CIN001'), false, 'Exempt proctor CIN001 should not be in domain');
  assert.strictEqual(domain.has('CIN002'), true, 'Non-exempt proctor CIN002 should be in domain');
  assert.strictEqual(domain.has('CIN003'), true, 'Non-exempt proctor CIN003 should be in domain');
  assert.strictEqual(domain.size, 2, 'Domain should have 2 eligible proctors');

  console.log('  [pass] testDomainFiltersExemptions');
}

function testDomainFiltersDuty() {
  var proctors = [
    makeProctor('أحمد', 'CIN001'),
    makeProctor('فاطمة', 'CIN002')
  ];
  var entries = [makeScheduleEntry({
    day: 'الأول', period: 'صباحا', session: 'الحصة الأولى',
    subject_name: 'الرياضيات', date_day: '15', date_month: '3', date_year: '2026'
  })];
  var rooms = [makeRoom(1, 'الأولى باك')];
  var rules = { proctorsPerRoom: 1 };

  // CIN002 is duty teacher for this session+subject
  var dutyKey = '2026-03-15|الأول|صباحا|الحصة الأولى|الرياضيات';
  var dutyData = {};
  dutyData[dutyKey] = { 'CIN002': true };

  var options = { allowHalfdayReuse: true, allowDayReuse: true, roomsList: rooms };
  var model = internals.buildCSPModel(entries, proctors, {}, dutyData, rules, options);

  var domain = model.domains.get(model.variables[0].id);
  assert.strictEqual(domain.has('CIN001'), true, 'Non-duty proctor CIN001 should be in domain');
  assert.strictEqual(domain.has('CIN002'), false, 'Duty proctor CIN002 should not be in domain');
  assert.strictEqual(domain.size, 1, 'Domain should have 1 eligible proctor');

  console.log('  [pass] testDomainFiltersDuty');
}

function testUnaryConstraints() {
  var proctors = [
    makeProctor('أحمد', 'CIN001'),
    makeProctor('فاطمة', 'CIN002')
  ];
  var entries = [makeScheduleEntry({ day: 'الأول', period: 'صباحا', session: 'الحصة الأولى' })];
  var rooms = [makeRoom(1, 'الأولى باك')];
  var rules = { proctorsPerRoom: 1 };

  // Exempt CIN001
  var exemptionsData = {
    'session|الأول|صباحا|الحصة الأولى': { 'CIN001': 'no' }
  };

  var options = { allowHalfdayReuse: true, allowDayReuse: true, roomsList: rooms };
  var model = internals.buildCSPModel(entries, proctors, exemptionsData, {}, rules, options);

  // Find unary constraints for the variable
  var varId = model.variables[0].id;
  var unaryConstraints = model.constraints.filter(function (c) {
    return c.type === 'unary' && c.scope[0] === varId;
  });

  // Should have 2 unary constraints (exemption + duty)
  assert.strictEqual(unaryConstraints.length, 2, 'Should have 2 unary constraints per variable');

  // Exemption constraint should reject CIN001 and accept CIN002
  var exemptionConstraint = unaryConstraints[0]; // first is exemption
  assert.strictEqual(exemptionConstraint.check('CIN001'), false, 'Exemption constraint rejects exempt proctor');
  assert.strictEqual(exemptionConstraint.check('CIN002'), true, 'Exemption constraint accepts non-exempt proctor');

  // Duty constraint should accept both (no duty data)
  var dutyConstraint = unaryConstraints[1]; // second is duty
  assert.strictEqual(dutyConstraint.check('CIN001'), true, 'Duty constraint accepts non-duty proctor CIN001');
  assert.strictEqual(dutyConstraint.check('CIN002'), true, 'Duty constraint accepts non-duty proctor CIN002');

  console.log('  [pass] testUnaryConstraints');
}

function testBinaryConstraintSameSession() {
  var proctors = [
    makeProctor('أحمد', 'CIN001'),
    makeProctor('فاطمة', 'CIN002')
  ];
  // Same session, same entry, 2 rooms
  var entries = [makeScheduleEntry()];
  var rooms = [makeRoom(1, 'الأولى باك'), makeRoom(2, 'الأولى باك')];
  var rules = { proctorsPerRoom: 1 };
  var options = { allowHalfdayReuse: true, allowDayReuse: true, roomsList: rooms };

  var model = internals.buildCSPModel(entries, proctors, {}, {}, rules, options);

  // Should have 2 variables in same session
  assert.strictEqual(model.variables.length, 2, 'Should have 2 variables');

  // Find binary constraints between these two variables
  var binaryConstraints = model.constraints.filter(function (c) {
    return c.type === 'binary';
  });

  // Should have at least 1 binary constraint (same session)
  assert.ok(binaryConstraints.length >= 1, 'Should have at least 1 binary constraint');

  // The constraint should enforce different values
  var constraint = binaryConstraints[0];
  assert.strictEqual(constraint.check('CIN001', 'CIN002'), true, 'Different proctors should satisfy constraint');
  assert.strictEqual(constraint.check('CIN001', 'CIN001'), false, 'Same proctor should violate constraint');

  console.log('  [pass] testBinaryConstraintSameSession');
}

function testBinaryConstraintHalfdayReuse() {
  var proctors = [
    makeProctor('أحمد', 'CIN001'),
    makeProctor('فاطمة', 'CIN002')
  ];
  // Two entries in same halfday (same date, same period, different sessions)
  var entries = [
    makeScheduleEntry({ session: 'الحصة الأولى' }),
    makeScheduleEntry({ session: 'الحصة الثانية' })
  ];
  var rooms = [makeRoom(1, 'الأولى باك')];
  var rules = { proctorsPerRoom: 1 };

  // allowHalfdayReuse = false → should create binary constraints between halfday vars
  var options = { allowHalfdayReuse: false, allowDayReuse: true, roomsList: rooms };
  var model = internals.buildCSPModel(entries, proctors, {}, {}, rules, options);

  assert.strictEqual(model.variables.length, 2, 'Should have 2 variables');

  // Find binary constraints
  var binaryConstraints = model.constraints.filter(function (c) {
    return c.type === 'binary';
  });

  // Should have binary constraints for halfday reuse (since both are in same halfday)
  assert.ok(binaryConstraints.length >= 1, 'Should have binary constraints for halfday reuse');

  // Verify constraint logic
  var constraint = binaryConstraints[0];
  assert.strictEqual(constraint.check('CIN001', 'CIN001'), false, 'Same proctor in same halfday should violate');
  assert.strictEqual(constraint.check('CIN001', 'CIN002'), true, 'Different proctors should satisfy');

  console.log('  [pass] testBinaryConstraintHalfdayReuse');
}

function testBinaryConstraintHalfdayReuseAllowed() {
  var proctors = [
    makeProctor('أحمد', 'CIN001'),
    makeProctor('فاطمة', 'CIN002')
  ];
  // Two entries in same halfday but different sessions
  var entries = [
    makeScheduleEntry({ session: 'الحصة الأولى' }),
    makeScheduleEntry({ session: 'الحصة الثانية' })
  ];
  var rooms = [makeRoom(1, 'الأولى باك')];
  var rules = { proctorsPerRoom: 1 };

  // allowHalfdayReuse = true → should NOT create halfday binary constraints
  // But should still have session-level constraints (which are different sessions here)
  var options = { allowHalfdayReuse: true, allowDayReuse: true, roomsList: rooms };
  var model = internals.buildCSPModel(entries, proctors, {}, {}, rules, options);

  // The two variables are in different sessions, so no same-session constraint
  // And halfday reuse is allowed, so no halfday constraint
  // And day reuse is allowed, so no day constraint
  var binaryConstraints = model.constraints.filter(function (c) {
    return c.type === 'binary';
  });

  assert.strictEqual(binaryConstraints.length, 0,
    'No binary constraints when entries are in different sessions and reuse is allowed');

  console.log('  [pass] testBinaryConstraintHalfdayReuseAllowed');
}

function testBinaryConstraintDayReuse() {
  var proctors = [
    makeProctor('أحمد', 'CIN001'),
    makeProctor('فاطمة', 'CIN002')
  ];
  // Two entries on same day but different periods (morning/afternoon)
  var entries = [
    makeScheduleEntry({ period: 'صباحا', session: 'الحصة الأولى' }),
    makeScheduleEntry({ period: 'مساء', session: 'الحصة الأولى' })
  ];
  var rooms = [makeRoom(1, 'الأولى باك')];
  var rules = { proctorsPerRoom: 1 };

  // allowDayReuse = false → should create binary constraints between day vars
  var options = { allowHalfdayReuse: true, allowDayReuse: false, roomsList: rooms };
  var model = internals.buildCSPModel(entries, proctors, {}, {}, rules, options);

  assert.strictEqual(model.variables.length, 2, 'Should have 2 variables');

  var binaryConstraints = model.constraints.filter(function (c) {
    return c.type === 'binary';
  });

  // Should have day-reuse constraint
  assert.ok(binaryConstraints.length >= 1, 'Should have binary constraints for day reuse');

  var constraint = binaryConstraints[0];
  assert.strictEqual(constraint.check('CIN001', 'CIN001'), false, 'Same proctor on same day should violate');
  assert.strictEqual(constraint.check('CIN001', 'CIN002'), true, 'Different proctors should satisfy');

  console.log('  [pass] testBinaryConstraintDayReuse');
}

function testEmptyDomainWhenAllExempt() {
  var proctors = [
    makeProctor('أحمد', 'CIN001'),
    makeProctor('فاطمة', 'CIN002')
  ];
  var entries = [makeScheduleEntry({ day: 'الأول', period: 'صباحا', session: 'الحصة الأولى' })];
  var rooms = [makeRoom(1, 'الأولى باك')];
  var rules = { proctorsPerRoom: 1 };

  // Exempt both proctors
  var exemptionsData = {
    'session|الأول|صباحا|الحصة الأولى': { 'CIN001': 'no', 'CIN002': 'no' }
  };

  var options = { allowHalfdayReuse: true, allowDayReuse: true, roomsList: rooms };
  var model = internals.buildCSPModel(entries, proctors, exemptionsData, {}, rules, options);

  var domain = model.domains.get(model.variables[0].id);
  assert.strictEqual(domain.size, 0, 'Domain should be empty when all proctors are exempt');

  console.log('  [pass] testEmptyDomainWhenAllExempt');
}

function testRoomsListAsObject() {
  var proctors = [makeProctor('أحمد', 'CIN001')];
  var entries = [makeScheduleEntry({ level_name: 'الأولى باك' })];
  var rules = { proctorsPerRoom: 1 };

  // roomsList as object keyed by level_name
  var roomsMap = {
    'الأولى باك': [makeRoom(1, 'الأولى باك'), makeRoom(2, 'الأولى باك')],
    'الثانية باك': [makeRoom(3, 'الثانية باك')]
  };

  var options = { allowHalfdayReuse: true, allowDayReuse: true, roomsList: roomsMap };
  var model = internals.buildCSPModel(entries, proctors, {}, {}, rules, options);

  // Should use rooms for 'الأولى باك' level only (2 rooms)
  assert.strictEqual(model.variables.length, 2, 'Should have 2 variables (2 rooms for level)');

  console.log('  [pass] testRoomsListAsObject');
}

function testRoomsListAsObjectMissingLevel() {
  var proctors = [makeProctor('أحمد', 'CIN001')];
  var entries = [makeScheduleEntry({ level_name: 'غير موجود' })];
  var rules = { proctorsPerRoom: 1 };

  // roomsList as object keyed by level_name — level not found
  var roomsMap = {
    'الأولى باك': [makeRoom(1, 'الأولى باك')]
  };

  var options = { allowHalfdayReuse: true, allowDayReuse: true, roomsList: roomsMap };
  var model = internals.buildCSPModel(entries, proctors, {}, {}, rules, options);

  // Should have 0 variables (no rooms for this level)
  assert.strictEqual(model.variables.length, 0, 'Should have 0 variables when level not in roomsList');

  console.log('  [pass] testRoomsListAsObjectMissingLevel');
}

function testProctorKeyUsesIndex() {
  // Proctor without cin or som should use index-based key
  var proctors = [
    makeProctor('أحمد', ''),  // no cin, no som → __idx_0
    makeProctor('فاطمة', 'CIN002')
  ];
  // Remove som too
  proctors[0].som = '';

  var entries = [makeScheduleEntry()];
  var rooms = [makeRoom(1, 'الأولى باك')];
  var rules = { proctorsPerRoom: 1 };
  var options = { allowHalfdayReuse: true, allowDayReuse: true, roomsList: rooms };

  var model = internals.buildCSPModel(entries, proctors, {}, {}, rules, options);

  var domain = model.domains.get(model.variables[0].id);
  assert.strictEqual(domain.has('__idx_0'), true, 'Proctor without cin/som should use __idx_0 key');
  assert.strictEqual(domain.has('CIN002'), true, 'Proctor with cin should use cin key');

  console.log('  [pass] testProctorKeyUsesIndex');
}

function testModelStructure() {
  var proctors = [makeProctor('أحمد', 'CIN001')];
  var entries = [makeScheduleEntry()];
  var rooms = [makeRoom(1, 'الأولى باك')];
  var rules = { proctorsPerRoom: 1 };
  var options = { allowHalfdayReuse: true, allowDayReuse: true, roomsList: rooms };

  var model = internals.buildCSPModel(entries, proctors, {}, {}, rules, options);

  // Verify model structure
  assert.ok(Array.isArray(model.variables), 'model.variables should be an array');
  assert.ok(model.domains instanceof Map, 'model.domains should be a Map');
  assert.ok(Array.isArray(model.constraints), 'model.constraints should be an array');

  // Verify constraint structure
  model.constraints.forEach(function (c) {
    assert.ok(c.type === 'unary' || c.type === 'binary', 'Constraint type should be unary or binary');
    assert.ok(Array.isArray(c.scope), 'Constraint scope should be an array');
    assert.strictEqual(typeof c.check, 'function', 'Constraint check should be a function');
    if (c.type === 'unary') {
      assert.strictEqual(c.scope.length, 1, 'Unary constraint scope should have 1 element');
    } else {
      assert.strictEqual(c.scope.length, 2, 'Binary constraint scope should have 2 elements');
    }
  });

  console.log('  [pass] testModelStructure');
}

function testNoVariablesWhenNoRooms() {
  var proctors = [makeProctor('أحمد', 'CIN001')];
  var entries = [makeScheduleEntry()];
  var rules = { proctorsPerRoom: 1 };
  var options = { allowHalfdayReuse: true, allowDayReuse: true, roomsList: [] };

  var model = internals.buildCSPModel(entries, proctors, {}, {}, rules, options);

  assert.strictEqual(model.variables.length, 0, 'Should have 0 variables when no rooms');
  assert.strictEqual(model.constraints.length, 0, 'Should have 0 constraints when no rooms');

  console.log('  [pass] testNoVariablesWhenNoRooms');
}

function testMultipleEntriesSameSession() {
  var proctors = [
    makeProctor('أحمد', 'CIN001'),
    makeProctor('فاطمة', 'CIN002'),
    makeProctor('محمد', 'CIN003')
  ];
  // Two entries in the same session (same date, period, session but different levels)
  var entries = [
    makeScheduleEntry({ level_name: 'الأولى باك', subject_name: 'الرياضيات' }),
    makeScheduleEntry({ level_name: 'الثانية باك', subject_name: 'الفيزياء' })
  ];
  var rooms = [
    makeRoom(1, 'الأولى باك'),
    makeRoom(2, 'الثانية باك')
  ];
  var rules = { proctorsPerRoom: 1 };
  var options = { allowHalfdayReuse: true, allowDayReuse: true, roomsList: rooms };

  var model = internals.buildCSPModel(entries, proctors, {}, {}, rules, options);

  // 2 entries × 1 room each × 1 slot = 2 variables
  assert.strictEqual(model.variables.length, 2, 'Should have 2 variables');

  // Both are in same session → should have binary constraint between them
  var binaryConstraints = model.constraints.filter(function (c) {
    return c.type === 'binary';
  });
  assert.ok(binaryConstraints.length >= 1, 'Should have binary constraint for same session');

  console.log('  [pass] testMultipleEntriesSameSession');
}

function testDefaultRulesAndOptions() {
  var proctors = [makeProctor('أحمد', 'CIN001')];
  var entries = [makeScheduleEntry()];
  var rooms = [makeRoom(1, 'الأولى باك')];

  // Test with null/undefined rules and options
  var model = internals.buildCSPModel(entries, proctors, {}, {}, null, { roomsList: rooms });
  assert.strictEqual(model.variables.length, 1, 'Should default proctorsPerRoom to 1');

  // Test with empty rules
  var model2 = internals.buildCSPModel(entries, proctors, {}, {}, {}, { roomsList: rooms });
  assert.strictEqual(model2.variables.length, 1, 'Should default proctorsPerRoom to 1 with empty rules');

  console.log('  [pass] testDefaultRulesAndOptions');
}

// ============================================================
// RUN ALL TESTS
// ============================================================

function run() {
  console.log('[test] proctor-distribution-v2 CSP buildCSPModel (Task 2.1)');
  testBasicVariableConstruction();
  testMultipleRoomsAndSlots();
  testDomainFiltersExemptions();
  testDomainFiltersDuty();
  testUnaryConstraints();
  testBinaryConstraintSameSession();
  testBinaryConstraintHalfdayReuse();
  testBinaryConstraintHalfdayReuseAllowed();
  testBinaryConstraintDayReuse();
  testEmptyDomainWhenAllExempt();
  testRoomsListAsObject();
  testRoomsListAsObjectMissingLevel();
  testProctorKeyUsesIndex();
  testModelStructure();
  testNoVariablesWhenNoRooms();
  testMultipleEntriesSameSession();
  testDefaultRulesAndOptions();
  console.log('[test] All Task 2.1 buildCSPModel tests passed');
}

run();
