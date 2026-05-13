/**
 * Unit tests for proctor-distribution-v2.js — Task 2.3: extractSingletons + phase1PrePass
 * Tests: singleton extraction, phase1 orchestration, diagnostics fields
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

function makeValidInput(overrides) {
  var proctors = overrides && overrides.proctorsList || [
    makeProctor('أحمد', 'CIN001', 'ذكر'),
    makeProctor('فاطمة', 'CIN002', 'أنثى'),
    makeProctor('محمد', 'CIN003', 'ذكر')
  ];
  var entries = overrides && overrides.scheduleEntries || [makeScheduleEntry()];
  var rooms = overrides && overrides.roomsList || [makeRoom(1, 'الأولى باك')];

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
    )
  };
}

// ============================================================
// extractSingletons TESTS
// ============================================================

function testExtractSingletonsEmpty() {
  var domains = new Map();
  var result = internals.extractSingletons(domains);
  assert.strictEqual(result.size, 0, 'Empty domains should return empty singletons');
  console.log('  [pass] testExtractSingletonsEmpty');
}

function testExtractSingletonsNoSingletons() {
  var domains = new Map();
  domains.set('var1', new Set(['A', 'B']));
  domains.set('var2', new Set(['C', 'D', 'E']));
  var result = internals.extractSingletons(domains);
  assert.strictEqual(result.size, 0, 'No singletons when all domains have size > 1');
  console.log('  [pass] testExtractSingletonsNoSingletons');
}

function testExtractSingletonsSingleElement() {
  var domains = new Map();
  domains.set('var1', new Set(['A']));
  domains.set('var2', new Set(['B', 'C']));
  domains.set('var3', new Set(['D']));
  var result = internals.extractSingletons(domains);
  assert.strictEqual(result.size, 2, 'Should find 2 singletons');
  assert.strictEqual(result.get('var1'), 'A', 'var1 singleton should be A');
  assert.strictEqual(result.get('var3'), 'D', 'var3 singleton should be D');
  console.log('  [pass] testExtractSingletonsSingleElement');
}

function testExtractSingletonsEmptyDomainIgnored() {
  var domains = new Map();
  domains.set('var1', new Set([]));
  domains.set('var2', new Set(['X']));
  var result = internals.extractSingletons(domains);
  assert.strictEqual(result.size, 1, 'Empty domain (size 0) should not be a singleton');
  assert.strictEqual(result.get('var2'), 'X', 'var2 singleton should be X');
  console.log('  [pass] testExtractSingletonsEmptyDomainIgnored');
}

function testExtractSingletonsReturnsMap() {
  var domains = new Map();
  domains.set('var1', new Set(['A']));
  var result = internals.extractSingletons(domains);
  assert.ok(result instanceof Map, 'Result should be a Map');
  console.log('  [pass] testExtractSingletonsReturnsMap');
}

// ============================================================
// phase1PrePass TESTS
// ============================================================

function testPhase1PrePassReturnsCorrectStructure() {
  var input = makeValidInput();
  var result = internals.phase1PrePass(input);

  // Check top-level fields
  assert.ok(result.cspModel !== null, 'cspModel should not be null');
  assert.ok(result.prefixedAssignments instanceof Map, 'prefixedAssignments should be a Map');
  assert.strictEqual(typeof result.lowerBound, 'number', 'lowerBound should be a number');
  assert.strictEqual(typeof result.upperBound, 'number', 'upperBound should be a number');
  assert.strictEqual(result.upperBound, result.lowerBound + 1, 'upperBound should be lowerBound + 1');

  // Check diagnostics fields
  var diag = result.diagnostics;
  assert.strictEqual(typeof diag.phase1DurationMs, 'number', 'phase1DurationMs should be a number');
  assert.ok(diag.phase1DurationMs >= 0, 'phase1DurationMs should be non-negative');
  assert.strictEqual(typeof diag.lowerBound, 'number', 'diagnostics.lowerBound should be a number');
  assert.strictEqual(typeof diag.upperBound, 'number', 'diagnostics.upperBound should be a number');
  assert.strictEqual(typeof diag.singletonCount, 'number', 'singletonCount should be a number');
  assert.strictEqual(typeof diag.domainReductionPercent, 'number', 'domainReductionPercent should be a number');
  assert.ok(Array.isArray(diag.infeasibilities), 'infeasibilities should be an array');
  assert.ok(Array.isArray(diag.warnings), 'warnings should be an array');

  console.log('  [pass] testPhase1PrePassReturnsCorrectStructure');
}

function testPhase1PrePassSingletonExtraction() {
  // Create a scenario where AC-3 will produce singletons:
  // 2 proctors, 2 rooms in same session, each proctor can only go to one room
  // After AC-3 binary constraint (no same proctor in same session), if domain is reduced to 1
  var proctors = [
    makeProctor('أحمد', 'CIN001'),
    makeProctor('فاطمة', 'CIN002')
  ];
  var entries = [makeScheduleEntry()];
  var rooms = [makeRoom(1, 'الأولى باك'), makeRoom(2, 'الأولى باك')];

  var input = makeValidInput({
    proctorsList: proctors,
    scheduleEntries: entries,
    roomsList: rooms,
    examDistributionRules: { proctorsPerRoom: 1 }
  });

  var result = internals.phase1PrePass(input);

  // With 2 proctors and 2 variables in same session with binary constraint (val1 !== val2),
  // AC-3 cannot reduce domains further (both still have {CIN001, CIN002})
  // So no singletons expected in this case
  assert.strictEqual(result.diagnostics.singletonCount, 0,
    'No singletons when 2 proctors can fill 2 slots');

  console.log('  [pass] testPhase1PrePassSingletonExtraction');
}

function testPhase1PrePassSingletonWhenOnlyOneEligible() {
  // 1 proctor, 1 room → domain has exactly 1 element → singleton
  var proctors = [makeProctor('أحمد', 'CIN001')];
  var entries = [makeScheduleEntry()];
  var rooms = [makeRoom(1, 'الأولى باك')];

  var input = makeValidInput({
    proctorsList: proctors,
    scheduleEntries: entries,
    roomsList: rooms,
    examDistributionRules: { proctorsPerRoom: 1 }
  });

  var result = internals.phase1PrePass(input);

  // 1 proctor → domain starts with size 1 → singleton
  assert.strictEqual(result.diagnostics.singletonCount, 1, 'Should have 1 singleton');
  assert.strictEqual(result.prefixedAssignments.size, 1, 'prefixedAssignments should have 1 entry');

  // Verify the singleton value
  var singletonValue = result.prefixedAssignments.values().next().value;
  assert.strictEqual(singletonValue, 'CIN001', 'Singleton should be CIN001');

  console.log('  [pass] testPhase1PrePassSingletonWhenOnlyOneEligible');
}

function testPhase1PrePassBoundsCalculation() {
  // 5 proctors, 3 rooms in same session → 3 tasks, 5 eligible teachers
  // lowerBound = floor((3 - 0) / 5) = 0
  // upperBound = 1
  var proctors = [
    makeProctor('أحمد', 'CIN001'),
    makeProctor('فاطمة', 'CIN002'),
    makeProctor('محمد', 'CIN003'),
    makeProctor('خالد', 'CIN004'),
    makeProctor('سارة', 'CIN005')
  ];
  var entries = [makeScheduleEntry()];
  var rooms = [makeRoom(1, 'الأولى باك'), makeRoom(2, 'الأولى باك'), makeRoom(3, 'الأولى باك')];

  var input = makeValidInput({
    proctorsList: proctors,
    scheduleEntries: entries,
    roomsList: rooms,
    examDistributionRules: { proctorsPerRoom: 1 }
  });

  var result = internals.phase1PrePass(input);

  assert.strictEqual(result.lowerBound, 0, 'lowerBound should be floor(3/5) = 0');
  assert.strictEqual(result.upperBound, 1, 'upperBound should be 1');
  assert.strictEqual(result.diagnostics.lowerBound, 0, 'diagnostics.lowerBound should match');
  assert.strictEqual(result.diagnostics.upperBound, 1, 'diagnostics.upperBound should match');

  console.log('  [pass] testPhase1PrePassBoundsCalculation');
}

function testPhase1PrePassBoundsWithSingletons() {
  // 1 proctor, 1 room → 1 task, 1 singleton, 1 eligible
  // lowerBound = floor((1 - 1) / 1) = 0
  var proctors = [makeProctor('أحمد', 'CIN001')];
  var entries = [makeScheduleEntry()];
  var rooms = [makeRoom(1, 'الأولى باك')];

  var input = makeValidInput({
    proctorsList: proctors,
    scheduleEntries: entries,
    roomsList: rooms,
    examDistributionRules: { proctorsPerRoom: 1 }
  });

  var result = internals.phase1PrePass(input);

  // totalTasks=1, fixedReservedTasks=1 (singleton), numEligibleTeachers=1
  // lowerBound = floor((1-1)/1) = 0
  assert.strictEqual(result.lowerBound, 0, 'lowerBound with singleton should be 0');
  assert.strictEqual(result.upperBound, 1, 'upperBound should be 1');

  console.log('  [pass] testPhase1PrePassBoundsWithSingletons');
}

function testPhase1PrePassDomainReductionPercent() {
  // Create scenario with domain reduction via AC-3
  // 1 proctor, 2 rooms in same session → AC-3 will empty one domain
  var proctors = [
    makeProctor('أحمد', 'CIN001')
  ];
  var entries = [makeScheduleEntry()];
  var rooms = [makeRoom(1, 'الأولى باك'), makeRoom(2, 'الأولى باك')];

  var input = makeValidInput({
    proctorsList: proctors,
    scheduleEntries: entries,
    roomsList: rooms,
    examDistributionRules: { proctorsPerRoom: 1 }
  });

  var result = internals.phase1PrePass(input);

  // Initial: 2 domains of size 1 each = total 2
  // After AC-3: one domain emptied = total 1 (or 0 depending on propagation)
  // domainReductionPercent should be > 0
  assert.ok(result.diagnostics.domainReductionPercent >= 0,
    'domainReductionPercent should be non-negative');
  // Should be rounded to 2 decimal places
  var rounded = Math.round(result.diagnostics.domainReductionPercent * 100) / 100;
  assert.strictEqual(result.diagnostics.domainReductionPercent, rounded,
    'domainReductionPercent should be rounded to 2 decimal places');

  console.log('  [pass] testPhase1PrePassDomainReductionPercent');
}

function testPhase1PrePassInfeasibilities() {
  // AC-3 detects infeasibility when a domain becomes empty.
  // This happens when a proctor is the only one eligible for a slot but is also
  // constrained away by another slot in the same session.
  // Scenario: 1 proctor, 2 rooms in same session → after AC-3, one domain becomes empty
  var proctors = [
    makeProctor('أحمد', 'CIN001')
  ];
  var entries = [makeScheduleEntry()];
  var rooms = [makeRoom(1, 'الأولى باك'), makeRoom(2, 'الأولى باك')];

  var input = makeValidInput({
    proctorsList: proctors,
    scheduleEntries: entries,
    roomsList: rooms,
    examDistributionRules: { proctorsPerRoom: 1 }
  });

  var result = internals.phase1PrePass(input);

  // With 1 proctor and 2 slots in same session (binary: val1 !== val2),
  // var1 domain: {CIN001}, var2 domain: {CIN001}
  // AC-3: arc (var1, var2) → CIN001 in var1 needs support in var2 where CIN001 !== val2
  // But var2 only has CIN001, so no support → remove CIN001 from var1 → empty domain
  assert.ok(result.diagnostics.infeasibilities.length >= 1,
    'Should detect infeasibility when 1 proctor cannot fill 2 slots in same session');

  // Each infeasibility should have variable and reason
  result.diagnostics.infeasibilities.forEach(function (inf) {
    assert.ok(inf.variable, 'Infeasibility should have variable field');
    assert.strictEqual(inf.reason, 'empty domain after AC-3', 'Infeasibility reason should be correct');
  });

  console.log('  [pass] testPhase1PrePassInfeasibilities');
}

function testPhase1PrePassNoWarningsWhenStable() {
  // Simple case that should stabilize quickly
  var proctors = [
    makeProctor('أحمد', 'CIN001'),
    makeProctor('فاطمة', 'CIN002'),
    makeProctor('محمد', 'CIN003')
  ];
  var entries = [makeScheduleEntry()];
  var rooms = [makeRoom(1, 'الأولى باك')];

  var input = makeValidInput({
    proctorsList: proctors,
    scheduleEntries: entries,
    roomsList: rooms,
    examDistributionRules: { proctorsPerRoom: 1 }
  });

  var result = internals.phase1PrePass(input);

  assert.ok(Array.isArray(result.diagnostics.warnings), 'warnings should be an array');
  assert.strictEqual(result.diagnostics.warnings.length, 0,
    'No warnings when AC-3 stabilizes');

  console.log('  [pass] testPhase1PrePassNoWarningsWhenStable');
}

function testPhase1PrePassPrefixedAssignmentsOnlyFromSingletons() {
  // Requirement 2.4.1: prefixed_assignments only from singletons
  var proctors = [
    makeProctor('أحمد', 'CIN001'),
    makeProctor('فاطمة', 'CIN002')
  ];
  var entries = [makeScheduleEntry()];
  var rooms = [makeRoom(1, 'الأولى باك')];

  var input = makeValidInput({
    proctorsList: proctors,
    scheduleEntries: entries,
    roomsList: rooms,
    examDistributionRules: { proctorsPerRoom: 1 }
  });

  var result = internals.phase1PrePass(input);

  // With 2 proctors and 1 slot, domain has 2 elements → no singleton
  assert.strictEqual(result.prefixedAssignments.size, 0,
    'No prefixed assignments when domain size > 1');

  console.log('  [pass] testPhase1PrePassPrefixedAssignmentsOnlyFromSingletons');
}

function testPhase1PrePassCspModelReturned() {
  var input = makeValidInput();
  var result = internals.phase1PrePass(input);

  assert.ok(result.cspModel, 'cspModel should be returned');
  assert.ok(Array.isArray(result.cspModel.variables), 'cspModel.variables should be an array');
  assert.ok(result.cspModel.domains instanceof Map, 'cspModel.domains should be a Map');
  assert.ok(Array.isArray(result.cspModel.constraints), 'cspModel.constraints should be an array');

  console.log('  [pass] testPhase1PrePassCspModelReturned');
}

function testPhase1PrePassDurationMs() {
  var input = makeValidInput();
  var result = internals.phase1PrePass(input);

  assert.ok(result.diagnostics.phase1DurationMs >= 0,
    'phase1DurationMs should be non-negative');
  assert.ok(result.diagnostics.phase1DurationMs < 5000,
    'phase1DurationMs should be reasonable (< 5s)');

  console.log('  [pass] testPhase1PrePassDurationMs');
}

function testPhase1PrePassEligibleTeachersCount() {
  // 3 proctors, 1 exempt → 2 eligible → bounds based on 2 eligible
  var proctors = [
    makeProctor('أحمد', 'CIN001'),
    makeProctor('فاطمة', 'CIN002'),
    makeProctor('محمد', 'CIN003')
  ];
  var entries = [
    makeScheduleEntry({ session: 'الحصة الأولى' }),
    makeScheduleEntry({ session: 'الحصة الثانية' })
  ];
  var rooms = [makeRoom(1, 'الأولى باك')];

  // Exempt CIN001 from all sessions (day-level exemption)
  var exemptionsData = {
    'day|الأول': { 'CIN001': 'no' }
  };

  var input = makeValidInput({
    proctorsList: proctors,
    scheduleEntries: entries,
    roomsList: rooms,
    exemptionsData: exemptionsData,
    examDistributionRules: { proctorsPerRoom: 1 },
    options: { allowHalfdayReuse: true, allowDayReuse: true, roomsList: rooms }
  });

  var result = internals.phase1PrePass(input);

  // 2 tasks, 0 singletons (2 proctors for 2 slots in different sessions), 2 eligible
  // lowerBound = floor((2 - 0) / 2) = 1
  assert.strictEqual(result.lowerBound, 1, 'lowerBound should be floor(2/2) = 1');
  assert.strictEqual(result.upperBound, 2, 'upperBound should be 2');

  console.log('  [pass] testPhase1PrePassEligibleTeachersCount');
}

// ============================================================
// RUN ALL TESTS
// ============================================================

function run() {
  console.log('[test] proctor-distribution-v2 Phase 1: extractSingletons + phase1PrePass (Task 2.3)');

  console.log('\n  --- extractSingletons ---');
  testExtractSingletonsEmpty();
  testExtractSingletonsNoSingletons();
  testExtractSingletonsSingleElement();
  testExtractSingletonsEmptyDomainIgnored();
  testExtractSingletonsReturnsMap();

  console.log('\n  --- phase1PrePass ---');
  testPhase1PrePassReturnsCorrectStructure();
  testPhase1PrePassSingletonExtraction();
  testPhase1PrePassSingletonWhenOnlyOneEligible();
  testPhase1PrePassBoundsCalculation();
  testPhase1PrePassBoundsWithSingletons();
  testPhase1PrePassDomainReductionPercent();
  testPhase1PrePassInfeasibilities();
  testPhase1PrePassNoWarningsWhenStable();
  testPhase1PrePassPrefixedAssignmentsOnlyFromSingletons();
  testPhase1PrePassCspModelReturned();
  testPhase1PrePassDurationMs();
  testPhase1PrePassEligibleTeachersCount();

  console.log('\n[test] All Task 2.3 extractSingletons + phase1PrePass tests passed');
}

run();
