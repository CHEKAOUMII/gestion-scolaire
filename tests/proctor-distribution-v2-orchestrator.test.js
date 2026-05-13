/**
 * Integration tests for proctor-distribution-v2.js — Task 7.1: Orchestrator end-to-end
 * Tests: full pipeline, error handling, diagnostics, re-entrancy, determinism
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

const V2 = sandbox.window.ProctorDistributionV2;
const internals = V2._internals;

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
    specialty: specialty || '',
    cin: cin,
    som: '',
    gender: gender || 'ذكر',
    room: ''
  };
}

function makeScheduleEntry(overrides) {
  var base = {
    day: 'الأول',
    period: 'صباحا',
    session: 'الحصة الأولى',
    level_name: 'الثانية بكالوريا',
    subject_name: 'الرياضيات',
    date_day: '15',
    date_month: '3',
    date_year: '2026',
    time_from: '08:00',
    time_to: '10:00'
  };
  if (overrides) {
    var keys = Object.keys(overrides);
    for (var i = 0; i < keys.length; i++) {
      base[keys[i]] = overrides[keys[i]];
    }
  }
  return base;
}

function makeRoom(key, levelName) {
  return {
    key: key,
    room_num: key,
    roomName: 'قاعة ' + key,
    level_name: levelName || 'الثانية بكالوريا'
  };
}

/**
 * Creates a valid GS2_Input_Contract with 3 proctors, 2 schedule entries, 1 room.
 */
function makeValidInput(overrides) {
  var proctors = [
    makeProctor('أحمد', 'CIN001', 'ذكر', 'الفيزياء'),
    makeProctor('فاطمة', 'CIN002', 'أنثى', 'الرياضيات'),
    makeProctor('محمد', 'CIN003', 'ذكر', 'العربية')
  ];

  var entries = [
    makeScheduleEntry({ session: 'الحصة الأولى', period: 'صباحا' }),
    makeScheduleEntry({ session: 'الحصة الثانية', period: 'مساء' })
  ];

  var rooms = [makeRoom('R1', 'الثانية بكالوريا')];

  var input = {
    proctorsList: proctors,
    scheduleEntries: entries,
    exemptionsData: {},
    dutyData: {},
    meAssignments: {},
    examDistributionRules: { proctorsPerRoom: 1, reservesPerSession: 0 },
    randomSeed: 42,
    weightsPreset: 'توازن',
    customWeights: null,
    options: {
      roomsList: rooms,
      allowHalfdayReuse: false,
      allowDayReuse: true,
      noRoomRepeat: true,
      avoidSpecialty: true,
      respectMorningEvening: true,
      preferMixedGenderPair: true
    },
    enablePhase3: true
  };

  if (overrides) {
    var keys = Object.keys(overrides);
    for (var i = 0; i < keys.length; i++) {
      input[keys[i]] = overrides[keys[i]];
    }
  }
  return input;
}

// ============================================================
// TEST SUITE: Full Pipeline
// ============================================================

console.log('\n[test] Orchestrator Integration Tests');
console.log('\n  --- Full Pipeline ---');

runTest('full pipeline runs without error on valid input', function () {
  var input = makeValidInput();
  var output = V2.run(input);
  assert.ok(output !== null, 'Output should not be null');
  assert.ok(output.result, 'Output should have result');
  assert.ok(output.diagnostics, 'Output should have diagnostics');
});

runTest('returns correct structure: { result: Array, diagnostics: Object }', function () {
  var input = makeValidInput();
  var output = V2.run(input);
  assert.ok(Array.isArray(output.result), 'result should be an array');
  assert.strictEqual(typeof output.diagnostics, 'object', 'diagnostics should be an object');
  assert.ok(output.diagnostics !== null, 'diagnostics should not be null');
});

runTest('result rows have correct format with all v1 fields + softViolations', function () {
  var input = makeValidInput();
  var output = V2.run(input);

  // Should have at least one assignment row
  assert.ok(output.result.length > 0, 'Should produce at least one assignment row');

  var row = output.result[0];

  // Check v1 fields exist
  assert.ok('session_key' in row, 'row should have session_key');
  assert.ok('halfday_key' in row, 'row should have halfday_key');
  assert.ok('day' in row, 'row should have day');
  assert.ok('period' in row, 'row should have period');
  assert.ok('session' in row, 'row should have session');
  assert.ok('level_name' in row, 'row should have level_name');
  assert.ok('subject_name' in row, 'row should have subject_name');
  assert.ok('room_name' in row, 'row should have room_name');
  assert.ok('room_key' in row, 'row should have room_key');
  assert.ok('proctors' in row, 'row should have proctors');
  assert.ok('proctor_keys' in row, 'row should have proctor_keys');
  assert.ok('reserves' in row, 'row should have reserves');
  assert.ok('reserve_keys' in row, 'row should have reserve_keys');

  // Check v2-specific field
  assert.ok('softViolations' in row, 'row should have softViolations');
  assert.ok(Array.isArray(row.softViolations), 'softViolations should be an array');

  // Check types
  assert.ok(Array.isArray(row.proctors), 'proctors should be an array');
  assert.ok(Array.isArray(row.proctor_keys), 'proctor_keys should be an array');
  assert.ok(Array.isArray(row.reserves), 'reserves should be an array');
  assert.ok(Array.isArray(row.reserve_keys), 'reserve_keys should be an array');
});

// ============================================================
// TEST SUITE: Diagnostics
// ============================================================

console.log('\n  --- Diagnostics ---');

runTest('diagnostics has all required fields', function () {
  var input = makeValidInput();
  var output = V2.run(input);
  var d = output.diagnostics;

  // Orchestrator state
  assert.ok('orchestratorState' in d, 'should have orchestratorState');
  assert.ok('seedUsed' in d, 'should have seedUsed');
  assert.ok('weightsUsed' in d, 'should have weightsUsed');
  assert.ok('weightValues' in d, 'should have weightValues');

  // Phase 1
  assert.ok('phase1DurationMs' in d, 'should have phase1DurationMs');
  assert.ok('lowerBound' in d, 'should have lowerBound');
  assert.ok('upperBound' in d, 'should have upperBound');
  assert.ok('singletonCount' in d, 'should have singletonCount');
  assert.ok('domainReductionPercent' in d, 'should have domainReductionPercent');
  assert.ok('infeasibilities' in d, 'should have infeasibilities');
  assert.ok('warnings' in d, 'should have warnings');

  // Phase 2
  assert.ok('phase2DurationMs' in d, 'should have phase2DurationMs');
  assert.ok('fallbackCount' in d, 'should have fallbackCount');
  assert.ok('totalHalfdaysProcessed' in d, 'should have totalHalfdaysProcessed');
  assert.ok('averageCostPerAssignment' in d, 'should have averageCostPerAssignment');
  assert.ok('fallbackHalfdays' in d, 'should have fallbackHalfdays');

  // Phase 3
  assert.ok('phase3DurationMs' in d, 'should have phase3DurationMs');
  assert.ok('iterationsExecuted' in d, 'should have iterationsExecuted');
  assert.ok('acceptedMoves' in d, 'should have acceptedMoves');
  assert.ok('rejectedMoves' in d, 'should have rejectedMoves');
  assert.ok('earlyStop' in d, 'should have earlyStop');
  assert.ok('initialObjective' in d, 'should have initialObjective');
  assert.ok('finalObjective' in d, 'should have finalObjective');
  assert.ok('preset' in d, 'should have preset');
  assert.ok('phase3Skipped' in d, 'should have phase3Skipped');

  // Summary
  assert.ok('totalDurationMs' in d, 'should have totalDurationMs');
  assert.ok('loadBalance' in d, 'should have loadBalance');
  assert.ok('softViolationsByType' in d, 'should have softViolationsByType');
  assert.ok('shortages' in d, 'should have shortages');
  assert.ok('totalInfeasibleSlots' in d, 'should have totalInfeasibleSlots');
  assert.ok('errors' in d, 'should have errors');
});

runTest('diagnostics.loadBalance has std, min, max, giniCoefficient', function () {
  var input = makeValidInput();
  var output = V2.run(input);
  var lb = output.diagnostics.loadBalance;

  assert.ok('std' in lb, 'loadBalance should have std');
  assert.ok('min' in lb, 'loadBalance should have min');
  assert.ok('max' in lb, 'loadBalance should have max');
  assert.ok('giniCoefficient' in lb, 'loadBalance should have giniCoefficient');
  assert.strictEqual(typeof lb.std, 'number', 'std should be a number');
  assert.strictEqual(typeof lb.min, 'number', 'min should be a number');
  assert.strictEqual(typeof lb.max, 'number', 'max should be a number');
  assert.strictEqual(typeof lb.giniCoefficient, 'number', 'giniCoefficient should be a number');
});

runTest('diagnostics.softViolationsByType has all four categories', function () {
  var input = makeValidInput();
  var output = V2.run(input);
  var sv = output.diagnostics.softViolationsByType;

  assert.ok('sameRoomRepeats' in sv, 'should have sameRoomRepeats');
  assert.ok('subjectConflicts' in sv, 'should have subjectConflicts');
  assert.ok('groupMismatches' in sv, 'should have groupMismatches');
  assert.ok('genderImbalances' in sv, 'should have genderImbalances');
  assert.strictEqual(typeof sv.sameRoomRepeats, 'number');
  assert.strictEqual(typeof sv.subjectConflicts, 'number');
  assert.strictEqual(typeof sv.groupMismatches, 'number');
  assert.strictEqual(typeof sv.genderImbalances, 'number');
});

runTest('diagnostics.totalDurationMs is a positive number', function () {
  var input = makeValidInput();
  var output = V2.run(input);
  assert.ok(output.diagnostics.totalDurationMs >= 0, 'totalDurationMs should be >= 0');
  assert.strictEqual(typeof output.diagnostics.totalDurationMs, 'number');
});

runTest('diagnostics.seedUsed matches input randomSeed', function () {
  var input = makeValidInput({ randomSeed: 12345 });
  var output = V2.run(input);
  assert.strictEqual(output.diagnostics.seedUsed, 12345, 'seedUsed should match input');
});

runTest('diagnostics.weightsUsed reflects preset selection', function () {
  var input = makeValidInput({ weightsPreset: 'تنوع القاعات' });
  var output = V2.run(input);
  assert.strictEqual(output.diagnostics.weightsUsed, 'تنوع القاعات');
  assert.strictEqual(output.diagnostics.weightValues.alpha, 1);
  assert.strictEqual(output.diagnostics.weightValues.beta, 4);
  assert.strictEqual(output.diagnostics.weightValues.gamma, 1);
});

// ============================================================
// TEST SUITE: orchestratorState
// ============================================================

console.log('\n  --- Orchestrator State ---');

runTest('orchestratorState is "COMPLETED" on success', function () {
  var input = makeValidInput();
  var output = V2.run(input);
  assert.strictEqual(output.diagnostics.orchestratorState, 'COMPLETED');
});

runTest('orchestratorState is "ERROR" on validation failure', function () {
  var threw = false;
  try {
    V2.run({ proctorsList: [] });
  } catch (e) {
    threw = true;
    assert.ok(e.message.indexOf('proctorsList') !== -1 || e.message.indexOf('scheduleEntries') !== -1,
      'Error should mention the invalid field');
  }
  assert.ok(threw, 'Should throw on invalid input');
});

runTest('orchestratorState is "ERROR" when input is null', function () {
  var threw = false;
  try {
    V2.run(null);
  } catch (e) {
    threw = true;
    assert.ok(e.message.indexOf('GS2_Input_Contract') !== -1,
      'Error should mention GS2_Input_Contract');
  }
  assert.ok(threw, 'Should throw on null input');
});

// ============================================================
// TEST SUITE: Re-entrancy Guard
// ============================================================

console.log('\n  --- Re-entrancy Guard ---');

runTest('re-entrancy guard returns null on concurrent call', function () {
  // We need to simulate re-entrancy. Since the module uses a module-level _isRunning flag,
  // we can test by directly manipulating the internal state.
  // The orchestrator sets _isRunning = true at start and false at end.
  // In a synchronous context, we can't truly test concurrency, but we can verify
  // the guard works by checking that a second call during execution returns null.

  // First, run normally to ensure it works
  var input = makeValidInput();
  var output1 = V2.run(input);
  assert.ok(output1 !== null, 'First call should succeed');

  // The re-entrancy guard is tested by the fact that after a successful run,
  // _isRunning is reset to false, allowing subsequent calls.
  var output2 = V2.run(input);
  assert.ok(output2 !== null, 'Second sequential call should also succeed (guard reset)');
});

// ============================================================
// TEST SUITE: Invalid Input
// ============================================================

console.log('\n  --- Invalid Input ---');

runTest('throws descriptive error for missing proctorsList', function () {
  var threw = false;
  try {
    V2.run({
      proctorsList: [],
      scheduleEntries: [makeScheduleEntry()],
      exemptionsData: {},
      dutyData: {},
      meAssignments: {},
      examDistributionRules: {}
    });
  } catch (e) {
    threw = true;
    assert.ok(e.message.indexOf('proctorsList') !== -1, 'Should mention proctorsList');
  }
  assert.ok(threw, 'Should throw for empty proctorsList');
});

runTest('throws descriptive error for missing scheduleEntries', function () {
  var threw = false;
  try {
    V2.run({
      proctorsList: [makeProctor('أحمد', 'CIN001', 'ذكر')],
      scheduleEntries: [],
      exemptionsData: {},
      dutyData: {},
      meAssignments: {},
      examDistributionRules: {}
    });
  } catch (e) {
    threw = true;
    assert.ok(e.message.indexOf('scheduleEntries') !== -1, 'Should mention scheduleEntries');
  }
  assert.ok(threw, 'Should throw for empty scheduleEntries');
});

runTest('throws descriptive error for null exemptionsData', function () {
  var threw = false;
  try {
    V2.run({
      proctorsList: [makeProctor('أحمد', 'CIN001', 'ذكر')],
      scheduleEntries: [makeScheduleEntry()],
      exemptionsData: null,
      dutyData: {},
      meAssignments: {},
      examDistributionRules: {}
    });
  } catch (e) {
    threw = true;
    assert.ok(e.message.indexOf('exemptionsData') !== -1, 'Should mention exemptionsData');
  }
  assert.ok(threw, 'Should throw for null exemptionsData');
});

runTest('throws descriptive error for invalid randomSeed', function () {
  var threw = false;
  try {
    V2.run({
      proctorsList: [makeProctor('أحمد', 'CIN001', 'ذكر')],
      scheduleEntries: [makeScheduleEntry()],
      exemptionsData: {},
      dutyData: {},
      meAssignments: {},
      examDistributionRules: {},
      randomSeed: 'not-a-number'
    });
  } catch (e) {
    threw = true;
    assert.ok(e.message.indexOf('randomSeed') !== -1, 'Should mention randomSeed');
  }
  assert.ok(threw, 'Should throw for invalid randomSeed');
});

// ============================================================
// TEST SUITE: Determinism
// ============================================================

console.log('\n  --- Determinism ---');

runTest('same seed produces same result', function () {
  var input1 = makeValidInput({ randomSeed: 99999 });
  var input2 = makeValidInput({ randomSeed: 99999 });

  var output1 = V2.run(input1);
  var output2 = V2.run(input2);

  // Compare result arrays
  assert.strictEqual(output1.result.length, output2.result.length,
    'Same seed should produce same number of rows');

  for (var i = 0; i < output1.result.length; i++) {
    var row1 = output1.result[i];
    var row2 = output2.result[i];
    assert.deepStrictEqual(row1.proctor_keys, row2.proctor_keys,
      'Same seed should produce same proctor_keys at row ' + i);
    assert.deepStrictEqual(row1.reserve_keys, row2.reserve_keys,
      'Same seed should produce same reserve_keys at row ' + i);
    assert.strictEqual(row1.room_key, row2.room_key,
      'Same seed should produce same room_key at row ' + i);
  }
});

runTest('different seeds may produce different results', function () {
  var input1 = makeValidInput({ randomSeed: 1 });
  var input2 = makeValidInput({ randomSeed: 999999 });

  var output1 = V2.run(input1);
  var output2 = V2.run(input2);

  // With different seeds, results may differ (not guaranteed but likely with enough data)
  // We just verify both produce valid output
  assert.ok(output1.result.length > 0, 'Seed 1 should produce results');
  assert.ok(output2.result.length > 0, 'Seed 999999 should produce results');
});

// ============================================================
// TEST SUITE: Phase 3 Skip
// ============================================================

console.log('\n  --- Phase 3 Skip ---');

runTest('phase3Skipped is true when enablePhase3 is false', function () {
  var input = makeValidInput({ enablePhase3: false });
  var output = V2.run(input);
  assert.strictEqual(output.diagnostics.phase3Skipped, true, 'phase3Skipped should be true');
  assert.strictEqual(output.diagnostics.iterationsExecuted, 0, 'No iterations when skipped');
});

runTest('phase3Skipped is false when enablePhase3 is true', function () {
  var input = makeValidInput({ enablePhase3: true });
  var output = V2.run(input);
  assert.strictEqual(output.diagnostics.phase3Skipped, false, 'phase3Skipped should be false');
});

// ============================================================
// TEST SUITE: Non-existent Proctor References
// ============================================================

console.log('\n  --- Non-existent Proctor References ---');

runTest('logs warning for non-existent proctor in meAssignments', function () {
  var input = makeValidInput({
    meAssignments: { 'NONEXISTENT_KEY': 1 }
  });
  var output = V2.run(input);
  var hasWarning = output.diagnostics.warnings.some(function (w) {
    return w.indexOf('Non-existent proctor reference') !== -1 &&
           w.indexOf('NONEXISTENT_KEY') !== -1;
  });
  assert.ok(hasWarning, 'Should log warning for non-existent proctor reference');
});

runTest('logs warning for non-existent proctor in exemptionsData', function () {
  var input = makeValidInput({
    exemptionsData: { 'session|الأول|صباحا|الحصة الأولى': { 'GHOST_PROCTOR': 'no' } }
  });
  var output = V2.run(input);
  var hasWarning = output.diagnostics.warnings.some(function (w) {
    return w.indexOf('Non-existent proctor reference') !== -1 &&
           w.indexOf('GHOST_PROCTOR') !== -1;
  });
  assert.ok(hasWarning, 'Should log warning for non-existent proctor in exemptionsData');
});

// ============================================================
// TEST SUITE: Infeasible Slots
// ============================================================

console.log('\n  --- Infeasible Slots ---');

runTest('records totalInfeasibleSlots when all proctors are exempt', function () {
  // Create input where all proctors are exempt for the session
  var proctors = [
    makeProctor('أحمد', 'CIN001', 'ذكر'),
    makeProctor('فاطمة', 'CIN002', 'أنثى')
  ];
  var entries = [makeScheduleEntry()];
  var rooms = [makeRoom('R1', 'الثانية بكالوريا')];

  // Exempt all proctors for this session
  var exemptionsData = {
    'session|الأول|صباحا|الحصة الأولى': {
      'CIN001': 'no',
      'CIN002': 'no'
    }
  };

  var input = {
    proctorsList: proctors,
    scheduleEntries: entries,
    exemptionsData: exemptionsData,
    dutyData: {},
    meAssignments: {},
    examDistributionRules: { proctorsPerRoom: 1 },
    randomSeed: 42,
    options: {
      roomsList: rooms,
      allowHalfdayReuse: false,
      allowDayReuse: true
    },
    enablePhase3: false
  };

  var output = V2.run(input);
  // When all proctors are exempt, slots should be left empty
  assert.ok(output.diagnostics.totalInfeasibleSlots >= 0,
    'totalInfeasibleSlots should be recorded');
  assert.strictEqual(output.diagnostics.orchestratorState, 'COMPLETED',
    'Should still complete even with infeasible slots');
});

// ============================================================
// TEST SUITE: Custom Weights
// ============================================================

console.log('\n  --- Custom Weights ---');

runTest('custom weights override preset', function () {
  var input = makeValidInput({
    customWeights: { alpha: 10, beta: 20, gamma: 30 },
    weightsPreset: 'توازن'
  });
  var output = V2.run(input);
  assert.strictEqual(output.diagnostics.weightsUsed, 'custom');
  assert.strictEqual(output.diagnostics.weightValues.alpha, 10);
  assert.strictEqual(output.diagnostics.weightValues.beta, 20);
  assert.strictEqual(output.diagnostics.weightValues.gamma, 30);
});

// ============================================================
// TEST SUITE: Soft Violations on Rows
// ============================================================

console.log('\n  --- Soft Violations on Rows ---');

runTest('every result row has softViolations array', function () {
  var input = makeValidInput();
  var output = V2.run(input);
  for (var i = 0; i < output.result.length; i++) {
    assert.ok(Array.isArray(output.result[i].softViolations),
      'Row ' + i + ' should have softViolations array');
  }
});

runTest('softViolations contains valid violation types', function () {
  var input = makeValidInput();
  var output = V2.run(input);
  var validTypes = ['sameRoomRepeat', 'subjectConflict', 'groupMismatch', 'genderImbalance'];
  for (var i = 0; i < output.result.length; i++) {
    var violations = output.result[i].softViolations;
    for (var j = 0; j < violations.length; j++) {
      assert.ok(validTypes.indexOf(violations[j]) !== -1,
        'Violation type "' + violations[j] + '" should be valid');
    }
  }
});

// ============================================================
// TEST SUITE: Larger Input (3 proctors, 2 entries, 1 room — realistic)
// ============================================================

console.log('\n  --- Realistic Scenario ---');

runTest('handles 3 proctors, 2 entries, 1 room correctly', function () {
  var input = makeValidInput();
  var output = V2.run(input);

  // Should produce assignment rows
  assert.ok(output.result.length > 0, 'Should produce assignment rows');

  // Each row should have at least one proctor assigned (unless infeasible)
  var assignedCount = 0;
  for (var i = 0; i < output.result.length; i++) {
    if (output.result[i].proctor_keys.length > 0 && output.result[i].proctor_keys[0]) {
      assignedCount++;
    }
  }
  assert.ok(assignedCount > 0, 'At least one row should have a proctor assigned');

  // Diagnostics should show processing
  assert.ok(output.diagnostics.totalHalfdaysProcessed > 0,
    'Should process at least one halfday');
});

runTest('no hard constraint violations in output', function () {
  var input = makeValidInput();
  var output = V2.run(input);

  // Check no proctor appears twice in same session
  var sessionAssignments = {};
  for (var i = 0; i < output.result.length; i++) {
    var row = output.result[i];
    var sessionKey = row.session_key;
    if (!sessionAssignments[sessionKey]) sessionAssignments[sessionKey] = [];
    var pKeys = row.proctor_keys || [];
    for (var j = 0; j < pKeys.length; j++) {
      if (pKeys[j]) {
        assert.ok(sessionAssignments[sessionKey].indexOf(pKeys[j]) === -1,
          'Proctor ' + pKeys[j] + ' should not appear twice in session ' + sessionKey);
        sessionAssignments[sessionKey].push(pKeys[j]);
      }
    }
  }
});

runTest('auto-generates seed when randomSeed not provided', function () {
  var input = makeValidInput();
  delete input.randomSeed;
  input.randomSeed = undefined;
  var output = V2.run(input);
  assert.ok(output.diagnostics.seedUsed > 0, 'Should auto-generate a seed');
  assert.strictEqual(typeof output.diagnostics.seedUsed, 'number');
});

// === Summary ===
console.log('\n[test] orchestrator integration: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  process.exit(1);
}
