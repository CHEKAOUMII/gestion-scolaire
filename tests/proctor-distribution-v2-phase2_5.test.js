'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'algorithms', 'proctor-distribution-v2.js'),
  'utf8'
);
const sandbox = {
  window: {},
  Math, console, Infinity, isFinite, isNaN,
  Set, Map, Object, Array, String, Number, Error, Boolean, Date,
  parseInt, parseFloat, TypeError, RangeError, NaN
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const internals = sandbox.window.ProctorDistributionV2._internals;
const phase2_5PopulateReserves = internals.phase2_5PopulateReserves;
const createLoadState = internals.createLoadState;

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

function makeProctor(index) {
  return {
    id: index,
    teacher_name: 'أستاذ_' + index,
    teacher_name_fr: 'Teacher_' + index,
    specialty: 'عام',
    cin: 'P' + String(index).padStart(3, '0'),
    som: '',
    gender: index % 2 ? 'ذكر' : 'أنثى',
    room: ''
  };
}

function makeRow(roomKey, proctorKey) {
  return {
    day: 'الأول',
    period: 'صباحا',
    session: 'الحصة الأولى',
    subject_name: 'الرياضيات',
    level_name: 'الثانية بكالوريا',
    halfday_key: '2026-04-10|صباحا',
    session_key: '2026-04-10|صباحا|الحصة الأولى',
    room_key: roomKey,
    proctors: ['حارس_' + proctorKey],
    proctor_keys: [proctorKey],
    reserves: [],
    reserve_keys: [],
    notes: '',
    schedule_entry: {
      day: 'الأول',
      period: 'صباحا',
      session: 'الحصة الأولى',
      subject_name: 'الرياضيات',
      level_name: 'الثانية بكالوريا'
    }
  };
}

function makeScenario(guardCount, proctorCount, reservesConfig) {
  const proctors = [];
  for (let i = 1; i <= proctorCount; i++) proctors.push(makeProctor(i));
  const assignments = [];
  for (let r = 1; r <= guardCount; r++) {
    assignments.push(makeRow('R' + r, proctors[r - 1].cin));
  }
  return {
    phase2Result: { assignments: assignments, loadState: createLoadState() },
    input: {
      proctorsList: proctors,
      exemptionsData: {},
      dutyData: {},
      reservesConfig: reservesConfig,
      options: { allowHalfdayReuse: true, allowDayReuse: true }
    }
  };
}

function rng() {
  return 0.5;
}

console.log('[test] phase2_5PopulateReserves');

runTest('fixed mode populates reserves and keeps shared array references', function () {
  const scenario = makeScenario(4, 12, { mode: 'fixed', fixed: 4, percent: 0 });
  const diagnostics = phase2_5PopulateReserves(scenario.phase2Result, scenario.input, rng);
  const rows = scenario.phase2Result.assignments;
  assert.strictEqual(rows[0].reserves.length, 4);
  assert.strictEqual(rows[0].reserve_keys.length, 4);
  assert.strictEqual(rows[0].reserves, rows[1].reserves);
  assert.strictEqual(rows[0].reserve_keys, rows[1].reserve_keys);
  assert.strictEqual(diagnostics.totalReservesPlaced, 4);
});

runTest('percent mode computes target from guard count', function () {
  const scenario = makeScenario(8, 20, { mode: 'percent', percent: 25, fixed: 0 });
  phase2_5PopulateReserves(scenario.phase2Result, scenario.input, rng);
  assert.strictEqual(scenario.phase2Result.assignments[0].reserves.length, 2);
  assert.strictEqual(scenario.phase2Result.assignments[0].reserve_keys.length, 2);
});

runTest('shortage caps reserves at eligible count and annotates first row', function () {
  const scenario = makeScenario(4, 6, { mode: 'fixed', fixed: 4, percent: 0 });
  const diagnostics = phase2_5PopulateReserves(scenario.phase2Result, scenario.input, rng);
  const rows = scenario.phase2Result.assignments;
  assert.strictEqual(rows[0].reserves.length, 2);
  assert.strictEqual(diagnostics.sessionsWithShortage, 1);
  assert.ok(rows[0].notes.indexOf('خصاص 2 احتياطي للحصة') !== -1);
});

runTest('fixed zero opt-out assigns shared empty arrays', function () {
  const scenario = makeScenario(4, 12, { mode: 'fixed', fixed: 0, percent: 0 });
  phase2_5PopulateReserves(scenario.phase2Result, scenario.input, rng);
  const rows = scenario.phase2Result.assignments;
  assert.strictEqual(rows[0].reserves.length, 0);
  assert.strictEqual(rows[0].reserve_keys.length, 0);
  assert.strictEqual(rows[0].reserves, rows[1].reserves);
  assert.strictEqual(rows[0].reserve_keys, rows[1].reserve_keys);
});

console.log('\n[test] phase2_5PopulateReserves: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  process.exit(1);
}
