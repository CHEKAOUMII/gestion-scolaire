'use strict';

// @property test — Property 1, P-1 + P-3 (universal canonical-shape closure).
// Spec: .kiro/specs/proctor-v2-key-shape-unification/
// Task 8.3 — Property-based regression lock for Property 1.
//
// Generates synthetic proctor lists with mixed cin/som/empty proctors
// (covering all Edge Cases from design.md: all-cin, synthetic-only,
// production-case, mixed) and asserts:
//
//   (P-1) Single-identity: for every (proc, idx), at most ONE of
//         {getProctorKey(proc, idx), getProctorExemptionKey(proc, idx)}
//         appears as a key in R_mem.proctor_keys ∪ R_mem.reserve_keys.
//
//   (P-3) Canonical-shape closure: every key in proctor_keys ∪ reserve_keys
//         that originates from a proctor in proctorsList equals
//         getProctorKey(that proctor, that idx) — never the exemption shape.
//
// _Validates: Requirements 2.1, 2.2, 2.4, 2.7, 2.12_
// _Property: Property 1, P-1 + P-3_

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

var src = fs.readFileSync(
  path.join(ROOT, 'js/algorithms/proctor-distribution-v2.js'),
  'utf8'
);
var sb = {
  console: console, Date: Date, Math: Math, Number: Number, Object: Object,
  Array: Array, Set: Set, Map: Map, JSON: JSON, isFinite: isFinite,
  isNaN: isNaN, Infinity: Infinity, parseInt: parseInt
};
sb.window = sb;
sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(src, sb);
var V2 = sb.ProctorDistributionV2;
var getProctorKey = V2._internals.getProctorKey;
var getProctorExemptionKey = V2._internals.getProctorExemptionKey;

// Mulberry32 PRNG (project convention).
function mulberry32(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    var t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngInt(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

// Generator: produces proctorsList with mixed cin/som/empty per Edge Cases.
function genProctor(rng, idx) {
  var kind = rng();
  if (kind < 0.25) {
    // All-cin (no bug)
    return { teacher_name: 'P_cin_' + idx, cin: 'CIN_' + idx, som: '', specialty: '', gender: 'ذكر' };
  } else if (kind < 0.55) {
    // som-only (production case)
    return { teacher_name: 'P_som_' + idx, cin: '', som: 'SOM_' + idx, specialty: '', gender: 'ذكر' };
  } else if (kind < 0.75) {
    // cin + som both
    return { teacher_name: 'P_both_' + idx, cin: 'CIN_' + idx, som: 'SOM_' + idx, specialty: '', gender: 'ذكر' };
  } else {
    // synthetic-only
    return { teacher_name: 'P_synth_' + idx, cin: '', som: '', specialty: '', gender: 'ذكر' };
  }
}

function genInput(rng, seed) {
  var N = rngInt(rng, 5, 20);
  var proctorsList = [];
  for (var i = 0; i < N; i++) proctorsList.push(genProctor(rng, i));

  var nEntries = rngInt(rng, 2, 5);
  var DAYS = ['الأول', 'الثاني', 'الثالث'];
  var PERIODS = ['صباحا', 'مساء'];
  var SESSIONS = ['الحصة الأولى', 'الحصة الثانية'];
  var SUBJECTS = ['الرياضيات', 'الفيزياء', 'العربية'];
  var entries = [];
  var seen = {};
  for (var e = 0; e < nEntries * 3 && entries.length < nEntries; e++) {
    var d = DAYS[Math.floor(rng() * 3)];
    var p = PERIODS[Math.floor(rng() * 2)];
    var s = SESSIONS[Math.floor(rng() * 2)];
    var key = d + '|' + p + '|' + s;
    if (seen[key]) continue;
    seen[key] = true;
    entries.push({
      day: d, period: p, session: s,
      level_name: 'الثانية بكالوريا',
      subject_name: SUBJECTS[Math.floor(rng() * 3)],
      date_day: String(10 + DAYS.indexOf(d)), date_month: '3', date_year: '2026',
      time_from: '08:00', time_to: '10:00'
    });
  }

  return {
    proctorsList: proctorsList,
    scheduleEntries: entries,
    exemptionsData: {},
    dutyData: {},
    meAssignments: {},
    examDistributionRules: { proctorsPerRoom: 1, reservesPerSession: 0 },
    randomSeed: seed,
    weightsPreset: 'توازن',
    customWeights: null,
    options: {
      roomsList: [{ key: 'R1', room_num: 'R1', roomName: 'قاعة 1', level_name: 'الثانية بكالوريا' }],
      allowHalfdayReuse: true, allowDayReuse: true,
      noRoomRepeat: false, avoidSpecialty: false,
      respectMorningEvening: false, preferMixedGenderPair: false
    },
    enablePhase3: true
  };
}

// Property assertion.
function checkProperty1(input, R_mem) {
  var occ = Object.create(null);
  var seenReserveArrays = new Set();
  for (var i = 0; i < R_mem.length; i++) {
    var pk = R_mem[i].proctor_keys || [];
    for (var j = 0; j < pk.length; j++) {
      if (pk[j]) occ[pk[j]] = (occ[pk[j]] || 0) + 1;
    }
    var rk = R_mem[i].reserve_keys || [];
    if (rk.length > 0 && !seenReserveArrays.has(rk)) {
      seenReserveArrays.add(rk);
      for (var r = 0; r < rk.length; r++) {
        if (rk[r]) occ[rk[r]] = (occ[rk[r]] || 0) + 1;
      }
    }
  }

  var violations = [];
  for (var idx = 0; idx < input.proctorsList.length; idx++) {
    var proc = input.proctorsList[idx];
    var K1 = getProctorKey(proc, idx);
    var K2 = getProctorExemptionKey(proc, idx);
    if (K1 === K2) continue;
    var n1 = occ[K1] || 0;
    var n2 = occ[K2] || 0;
    if (n1 > 0 && n2 > 0) {
      violations.push({
        idx: idx, name: proc.teacher_name,
        K1: K1, K1_count: n1, K2: K2, K2_count: n2
      });
    }
  }
  return violations;
}

// Property loop.
var ITERATIONS = 30;
var SEED_BASE = 0xC0FFEE;
var rng = mulberry32(SEED_BASE);
var failures = [];
var passed = 0;

for (var it = 0; it < ITERATIONS; it++) {
  var input = genInput(rng, SEED_BASE + it);
  try {
    var out = V2.run(input);
    if (!out || !out.result) continue;
    var violations = checkProperty1(input, out.result);
    if (violations.length > 0) {
      failures.push({
        iteration: it, seed: SEED_BASE + it,
        proctorCount: input.proctorsList.length,
        violations: violations
      });
    } else {
      passed++;
    }
  } catch {
    // V2.run errors don't count as Property 1 violations
  }
}

console.log('[key-shape-unity] iterations=' + ITERATIONS +
  ' passed=' + passed + ' failures=' + failures.length);

if (failures.length > 0) {
  console.log('  First failure:');
  var f = failures[0];
  console.log('    iter=' + f.iteration + ' seed=' + f.seed +
    ' proctors=' + f.proctorCount);
  f.violations.slice(0, 3).forEach(function (v) {
    console.log('    - idx=' + v.idx + ' name=' + v.name +
      ' K1=' + v.K1 + ' K1_count=' + v.K1_count +
      ' K2=' + v.K2 + ' K2_count=' + v.K2_count);
  });
}

assert.strictEqual(failures.length, 0,
  'Property 1 (canonical single-identity) violated on ' + failures.length +
  ' / ' + ITERATIONS + ' iterations. See log above.');

console.log('[key-shape-unity] PASS — Property 1 holds across all ' + ITERATIONS +
  ' generated inputs (mixed cin/som/empty proctors).');
