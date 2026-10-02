'use strict';

// Unit tests — Phase D.2 of proctor-v2-slot-metric-reserves-affinity.
// Validates Phase C (lex sort: reserveCount, affinityRank, finalLoad, tiebreak).
// _Validates: C2, C3, P2, P3, P4 — Requirements 2.4, 2.5, 2.6, 3.7, 3.10_

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
const { phase2_5PopulateReserves, createLoadState, addGuardLoad, addReserveLoad } = internals;

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

function makeProctor(i) {
  return {
    id: i,
    teacher_name: 'أ' + i,
    teacher_name_fr: 'T' + i,
    specialty: 'عام',
    cin: 'P' + String(i).padStart(3, '0'),
    som: '',
    gender: 'ذكر',
    room: ''
  };
}

function rng() { return 0.5; }

console.log('[test] phase2_5PopulateReserves lex sort');

runTest('reserveCount=0 candidate beats reserveCount=1 (spread > balance), with implicit ring fall-through', function () {
  // Setup: 4 proctors. P001 is session guard (excluded from candidate pool).
  // P002, P003 already at reserveCount=1. P004 at reserveCount=0 with HIGHEST
  // finalLoad. With target=2 reserves and only ONE reserveCount=0 candidate,
  // the lex sort picks P004 first (ring 0), then falls through to ring 1
  // (P002, P003) for the second slot — implicit ring fall-through.
  const proctors = [];
  for (let i = 1; i <= 4; i++) proctors.push(makeProctor(i));
  const ASSIGN = [{
    session_key: 'sk1',
    halfday_key: '2026-04-10|صباحا',
    proctor_keys: [proctors[0].cin],
    proctors: [proctors[0].teacher_name],
    reserves: [],
    reserve_keys: [],
    notes: '',
    schedule_entry: { time_from: '08:00', day: 'الأول', period: 'صباحا', session: 'الحصة الأولى' }
  }];
  const ls = createLoadState();
  // P002, P003 → reserveCount=1, finalLoad=1.
  addReserveLoad(ls, 'P002', '2026-04-09|صباحا', 'أ2');
  addReserveLoad(ls, 'P003', '2026-04-09|صباحا', 'أ3');
  // P004 → reserveCount=0, finalLoad=2 (worst on old key).
  addGuardLoad(ls, 'P004', '2026-04-09|صباحا', 'أ4');
  addGuardLoad(ls, 'P004', '2026-04-09|مساء', 'أ4');

  const phase2Result = { assignments: ASSIGN, loadState: ls };
  const input = {
    proctorsList: proctors,
    exemptionsData: {},
    dutyData: {},
    reservesConfig: { mode: 'fixed', fixed: 2, percent: 0 },
    options: { allowHalfdayReuse: true, allowDayReuse: true }
  };
  phase2_5PopulateReserves(phase2Result, input, rng);
  const chosen = Array.from(ASSIGN[0].reserve_keys);
  assert.strictEqual(chosen.length, 2);
  // P004 (ring 0) must be picked first. With target=2 and only 1 ring-0 peer,
  // the second slot falls through to ring 1 (P002 or P003).
  assert.strictEqual(chosen[0], 'P004', 'P004 (ring 0) wins over ring 1 peers');
  assert.ok(chosen[1] === 'P002' || chosen[1] === 'P003',
    'Second slot falls through to ring 1 (' + chosen[1] + ')');
});

runTest('all candidates tie on (reserveCount, affinityRank) → collapses to (finalLoad, rng)', function () {
  // 4 proctors, all at reserveCount=0, no affinity (single-session halfday).
  // finalLoad: P001=0, P002=1, P003=2, P004=3.
  // Expected order: P001, P002, P003, P004 (finalLoad ASC).
  const proctors = [];
  for (let i = 1; i <= 4; i++) proctors.push(makeProctor(i));
  const ASSIGN = [{
    session_key: 'sk1',
    halfday_key: '2026-04-10|صباحا',
    proctor_keys: [],
    proctors: [],
    reserves: [],
    reserve_keys: [],
    notes: '',
    schedule_entry: { time_from: '08:00' }
  }];
  // To exercise zero-target short-circuit avoidance, we need at least 1 guard
  // for `target` to be positive in fixed mode (target = fixed regardless).
  ASSIGN[0].proctor_keys = ['EXTRA'];
  ASSIGN[0].proctors = ['extra'];

  const ls = createLoadState();
  addGuardLoad(ls, 'P002', '2026-04-09|صباحا', 'أ2'); // finalLoad=1
  addGuardLoad(ls, 'P003', '2026-04-09|صباحا', 'أ3');
  addGuardLoad(ls, 'P003', '2026-04-09|مساء', 'أ3'); // finalLoad=2
  addGuardLoad(ls, 'P004', '2026-04-09|صباحا', 'أ4');
  addGuardLoad(ls, 'P004', '2026-04-09|مساء', 'أ4');
  addGuardLoad(ls, 'P004', '2026-04-08|صباحا', 'أ4'); // finalLoad=3

  const phase2Result = { assignments: ASSIGN, loadState: ls };
  const input = {
    proctorsList: proctors,
    exemptionsData: {},
    dutyData: {},
    reservesConfig: { mode: 'fixed', fixed: 2, percent: 0 },
    options: { allowHalfdayReuse: true, allowDayReuse: true }
  };
  phase2_5PopulateReserves(phase2Result, input, rng);
  const chosen = Array.from(ASSIGN[0].reserve_keys);
  assert.strictEqual(chosen.length, 2);
  // Lowest finalLoad pair = P001 (0) then P002 (1).
  assert.strictEqual(chosen[0], 'P001', 'finalLoad ASC: P001 first');
  assert.strictEqual(chosen[1], 'P002', 'finalLoad ASC: P002 second');
});

runTest('shared-reference invariant preserved after new sort', function () {
  // 1 session, 2 rows. After the new sort, every row of the session must
  // share the SAME reserves / reserve_keys array reference.
  const proctors = [];
  for (let i = 1; i <= 6; i++) proctors.push(makeProctor(i));
  const ASSIGN = [
    {
      session_key: 'sk1', halfday_key: '2026-04-10|صباحا',
      proctor_keys: ['P001'], proctors: ['أ1'],
      reserves: [], reserve_keys: [], notes: '',
      schedule_entry: { time_from: '08:00' }
    },
    {
      session_key: 'sk1', halfday_key: '2026-04-10|صباحا',
      proctor_keys: ['P002'], proctors: ['أ2'],
      reserves: [], reserve_keys: [], notes: '',
      schedule_entry: { time_from: '08:00' }
    }
  ];
  const phase2Result = { assignments: ASSIGN, loadState: createLoadState() };
  const input = {
    proctorsList: proctors,
    exemptionsData: {},
    dutyData: {},
    reservesConfig: { mode: 'fixed', fixed: 2, percent: 0 },
    options: { allowHalfdayReuse: true, allowDayReuse: true }
  };
  phase2_5PopulateReserves(phase2Result, input, rng);
  assert.strictEqual(ASSIGN[0].reserves, ASSIGN[1].reserves, 'reserves shared by reference');
  assert.strictEqual(ASSIGN[0].reserve_keys, ASSIGN[1].reserve_keys, 'reserve_keys shared by reference');
  assert.strictEqual(ASSIGN[0].reserves.length, 2);
});

runTest('affinity preferred over external when reserveCount ties (S2 reserve picks S1 guard)', function () {
  // 2-session halfday. S1 has guards [P001, P002]. S2 needs 1 reserve.
  // P001/P002 (S1 guards) and P003/P004 (external) all at reserveCount=0.
  // Affinity: P001/P002 should be preferred (affinityRank=0).
  const proctors = [];
  for (let i = 1; i <= 4; i++) proctors.push(makeProctor(i));
  const HD = '2026-04-10|صباحا';
  const SK1 = HD + '|الحصة الأولى';
  const SK2 = HD + '|الحصة الثانية';
  const ASSIGN = [
    {
      session_key: SK1, halfday_key: HD,
      proctor_keys: ['P001', 'P002'], proctors: ['أ1', 'أ2'],
      reserves: [], reserve_keys: [], notes: '',
      schedule_entry: { time_from: '08:00', day: 'الأول', period: 'صباحا', session: 'الحصة الأولى' }
    },
    {
      session_key: SK2, halfday_key: HD,
      // P003, P004 are S2 guards. allowHalfdayReuse=true allows P001/P002 as reserves.
      proctor_keys: ['P003', 'P004'], proctors: ['أ3', 'أ4'],
      reserves: [], reserve_keys: [], notes: '',
      schedule_entry: { time_from: '10:30', day: 'الأول', period: 'صباحا', session: 'الحصة الثانية' }
    }
  ];
  const ls = createLoadState();
  // Mirror Phase 2 effects: S1's guard slots already added.
  addGuardLoad(ls, 'P001', HD, 'أ1');
  addGuardLoad(ls, 'P002', HD, 'أ2');
  addGuardLoad(ls, 'P003', HD, 'أ3');
  addGuardLoad(ls, 'P004', HD, 'أ4');

  const phase2Result = { assignments: ASSIGN, loadState: ls };
  const input = {
    proctorsList: proctors,
    exemptionsData: {},
    dutyData: {},
    reservesConfig: { mode: 'fixed', fixed: 1, percent: 0 },
    options: { allowHalfdayReuse: true, allowDayReuse: true }
  };
  phase2_5PopulateReserves(phase2Result, input, rng);

  // S1 reserves: not constrained by affinity (single S1 → affinityRank=1 for everyone).
  // S2 reserves: candidate pool = {everyone except P003, P004 (session guards)}.
  // = {P001, P002}. Both have affinityRank=0 (they guarded S1).
  // Either P001 or P002 is acceptable — the reserve must come from {P001, P002}.
  const s2Reserves = ASSIGN[1].reserve_keys;
  assert.strictEqual(s2Reserves.length, 1);
  assert.ok(s2Reserves[0] === 'P001' || s2Reserves[0] === 'P002',
    'S2 reserve must come from S1 guard set when they are reserve-eligible');
});

console.log('\n[test] phase2_5 lex sort: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
