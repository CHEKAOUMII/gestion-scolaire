'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const fixtures = require('./fixtures/proctor-v2-bug-fixtures');

function loadV2() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'algorithms', 'proctor-distribution-v2.js'), 'utf8');
  const sandbox = { window: {}, Math, console, Infinity, isFinite, isNaN, Set, Map, Object, Array, String, Number, Error, Boolean, Date, parseInt, parseFloat, TypeError, RangeError, NaN };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.ProctorDistributionV2;
}

function countGuards(rows) {
  const loads = Object.create(null);
  for (const row of rows) {
    for (const key of row.proctor_keys || []) loads[key] = (loads[key] || 0) + 1;
  }
  return loads;
}

const T1 = fixtures.makeProctor('أستاذ_T1', 'CIN_T1');
const T2 = fixtures.makeProctor('أستاذ_T2', 'CIN_T2');
const input = {
  proctorsList: [T1, T2],
  scheduleEntries: [
    fixtures.makeEntry({ day: 'الثالث', period: 'صباحا', session: 'الحصة الأولى', dateDay: 10, dateMonth: 3, dateYear: 2026 }),
    fixtures.makeEntry({ day: 'الثالث', period: 'مساء', session: 'الحصة الأولى', dateDay: 10, dateMonth: 3, dateYear: 2026 })
  ],
  exemptionsData: {},
  dutyData: {
    '2026-03-01|الأول|صباحا|حراسة|Duty': { CIN_T1: true },
    '2026-03-02|الثاني|مساء|حراسة|Duty': { CIN_T1: true }
  },
  meAssignments: {},
  examDistributionRules: { proctorsPerRoom: 1, reservesPerSession: 0 },
  randomSeed: 42,
  weightsPreset: 'توازن',
  customWeights: null,
  options: {
    roomsList: [fixtures.makeRoom('R1')],
    allowHalfdayReuse: true,
    allowDayReuse: true,
    noRoomRepeat: false,
    avoidSpecialty: false,
    respectMorningEvening: false,
    preferMixedGenderPair: false
  },
  enablePhase3: false
};

const output = loadV2().run(input);
const guards = countGuards(output.result || []);
const finalT1 = (guards.CIN_T1 || 0) + 2;
const finalT2 = guards.CIN_T2 || 0;
const delta = Math.abs(finalT1 - finalT2);

assert.ok(delta <= 1, 'Expected duty-aware final loads to differ by <= 1, got ' + delta);
console.log('[pass] P2 duty-aware peers property holds: T1=' + finalT1 + ', T2=' + finalT2);
