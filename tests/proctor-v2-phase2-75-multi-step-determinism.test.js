'use strict';

// @preservation determinism test — Property 2 (deficit-≤any baseline).
// MUST PASS on F (the unfixed code). Re-used by Task 7.2 to assert
// byte-equality of the same observations on F' (the fixed code).
//
// _Bug_Condition: NOT isBugCondition(X) — determinism preservation
// _Expected_Behavior: Property 2 + Property 1 P-4 (determinism contract)
// _File: tests/proctor-v2-phase2-75-multi-step-determinism.test.js (NEW)
// _Requirements: 3.17
//
// Spec: .kiro/specs/proctor-v2-phase2-75-multi-step-repair/
// Task 2.2 — Replay each input twice on UNFIXED V2 and assert
// byte-identical observations across the two runs:
//   - per-row proctor_keys (the assignments graph)
//   - per-row reserve_keys (the reserve population)
//   - diagnostics.coverageRepairSwaps (per-successful-swap counter)
//   - diagnostics.coverageRepairUnresolved (counter — informational)
//
// Determinism is a pre-fix invariant — clause 3.17 of bugfix.md
// requires it for any input that does NOT enter the buggy branch, and
// in fact for the buggy branch it ALSO holds because the failure
// itself is deterministic (same input → same single-swap → same
// orphan proctor → same `coverageRepairUnresolved` count). Post-fix
// Task 7.2 will replay this file as-is and confirm the inner-loop
// addition does not introduce non-determinism.
//
// IMPORTANT: this test asserts R1 ≡ R2 across two runs of the SAME
// algorithm version. It does NOT compare F to F' — that is Task 7.1
// (preservation) and Task 7.4 (fix-checking)'s job. The only
// determinism contract this file locks is: same algorithm + same
// input → byte-identical output across replays.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ============================================================
// 1) Load the production v2 module via vm sandbox.
//    Idiom mirrors lines 12–22 of scripts/verify-real-centre.js
//    and tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration
//    .test.js section 1.
// ============================================================

const src = fs.readFileSync(
  path.join(ROOT, 'js/algorithms/proctor-distribution-v2.js'),
  'utf8'
);
const sb = {
  console: console, Date: Date, Math: Math, Number: Number, Object: Object,
  Array: Array, Set: Set, Map: Map, JSON: JSON, isFinite: isFinite,
  isNaN: isNaN, Infinity: Infinity, parseInt: parseInt
};
sb.window = sb;
sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(src, sb);
const V2 = sb.ProctorDistributionV2 || sb.window.ProctorDistributionV2;

assert.ok(V2 && typeof V2.run === 'function',
  'Failed to load ProctorDistributionV2 from production module');

// ============================================================
// 2) Synthetic deficit-2 input builder.
//
// Duplicated verbatim from
// tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js
// section 2 (Task 1.1) per the task instruction
// "duplicate the builder for now to keep the test self-contained".
//
// 4 proctors, 1 halfday × 3 sessions × 3 rooms × 1 proctor/room = 9
// guard slots. Class bounds derived by the algorithm:
//   classLowerBound = floor(9/4) = 2
//   classUpperBound = ceil(9/4)  = 3
// Phase 2 yields one proctor at primaryLoad=0 and three peers at
// primaryLoad=3 (=classUpperBound). The over-loaded peers serve as
// donors, but allowHalfdayReuse=false traps round 2's swap, so the
// pre-fix repair pass closes only one slot for P_uncov.
//
// Pre-fix this input enters the buggy branch (deficit=2 stays at
// load=1). Determinism still holds because the failure mode is
// itself deterministic — `pending.sort` by classId, RNG seeded from
// `randomSeed=42`, candidate sort by `(donor load DESC, rowIndex ASC,
// slotIndex ASC)`, and the halfday-reuse rejection in
// `swapPreservesHardConstraints` are all input-deterministic. The
// two-run replay below witnesses that determinism on F.
// ============================================================

function makeProctor(name, cin, specialty, gender) {
  return {
    id: parseInt(cin.replace(/\D/g, ''), 10) || 0,
    teacher_name: name,
    teacher_name_fr: name,
    specialty: specialty || 'عام',
    cin: cin,
    som: '',
    gender: gender || 'ذكر',
    room: ''
  };
}

function makeEntry(session) {
  return {
    day: 'الأول',
    period: 'صباحا',
    session: session,
    level_name: 'الثانية بكالوريا',
    subject_name: 'الرياضيات',
    date_day: '10',
    date_month: '3',
    date_year: '2026',
    time_from: '08:00',
    time_to: '10:00'
  };
}

function makeRoom(key) {
  return {
    key: key,
    room_num: key,
    roomName: 'قاعة ' + key,
    level_name: 'الثانية بكالوريا'
  };
}

function buildSyntheticDeficit2Input() {
  var peerA = makeProctor('peer_A', 'CIN_A001', 'عام', 'ذكر');
  var peerB = makeProctor('peer_B', 'CIN_B002', 'عام', 'ذكر');
  var peerC = makeProctor('peer_C', 'CIN_C003', 'عام', 'ذكر');
  var pUncov = makeProctor('p_uncov', 'CIN_P099', 'الرياضيات', 'أنثى');

  var entries = [
    makeEntry('الحصة الأولى'),
    makeEntry('الحصة الثانية'),
    makeEntry('الحصة الثالثة')
  ];

  var rooms = [makeRoom('R1'), makeRoom('R2'), makeRoom('R3')];

  var proctorSpecialties = {
    'CIN_A001': 'عام',
    'CIN_B002': 'عام',
    'CIN_C003': 'عام',
    'CIN_P099': 'الرياضيات'
  };

  var meAssignments = {
    'CIN_A001': 1, 'CIN_B002': 1, 'CIN_C003': 1,
    'CIN_P099': 2
  };

  return {
    proctorsList: [peerA, peerB, peerC, pUncov],
    scheduleEntries: entries,
    exemptionsData: {},
    dutyData: {},
    meAssignments: meAssignments,
    examDistributionRules: { proctorsPerRoom: 1, reservesPerSession: 0 },
    randomSeed: 42,
    weightsPreset: 'توازن',
    customWeights: null,
    options: {
      roomsList: rooms,
      allowHalfdayReuse: false,
      allowDayReuse: true,
      noRoomRepeat: false,
      avoidSpecialty: true,
      respectMorningEvening: true,
      preferMixedGenderPair: false,
      proctorSpecialties: proctorSpecialties
    },
    enablePhase3: false,
    D_expected: 0
  };
}

// ============================================================
// 3) Canonicalization helpers.
//
// JSON.stringify is byte-stable over arrays of strings (the per-row
// proctor_keys / reserve_keys shape) — we use it as the canonical
// equality probe. Object-shaped diagnostics are compared via
// canonicalize() to sort their keys lexicographically before
// stringification, eliminating any dependency on Object.keys
// iteration order across the two runs.
// ============================================================

function canonicalize(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    var arr = [];
    for (var i = 0; i < value.length; i++) arr.push(canonicalize(value[i]));
    return arr;
  }
  if (typeof value === 'object') {
    var keys = Object.keys(value).sort();
    var out = {};
    for (var k = 0; k < keys.length; k++) out[keys[k]] = canonicalize(value[keys[k]]);
    return out;
  }
  return value;
}

function extractRowKeys(rows) {
  // Per-row arrays, cloned to plain arrays so cross-realm prototype
  // identity does not contaminate JSON.stringify equality. Mirrors the
  // recordObservation idiom in
  // tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js
  // section 5.
  var proctorKeysByRow = [];
  var reserveKeysByRow = [];
  for (var i = 0; i < rows.length; i++) {
    var pk = rows[i].proctor_keys || [];
    var rk = rows[i].reserve_keys || [];
    proctorKeysByRow.push(pk.slice());
    reserveKeysByRow.push(rk.slice());
  }
  return {
    proctorKeysByRow: proctorKeysByRow,
    reserveKeysByRow: reserveKeysByRow
  };
}

function assertDeterministic(label, input) {
  // Two runs of V2.run on byte-identical input.
  var r1, r2;
  try {
    r1 = V2.run(input);
  } catch (e) {
    assert.fail('[determinism:' + label + '] V2.run threw on first run: ' +
      e.message);
  }
  try {
    r2 = V2.run(input);
  } catch (e) {
    assert.fail('[determinism:' + label + '] V2.run threw on second run: ' +
      e.message);
  }

  assert.ok(r1 && r1.result && r1.diagnostics,
    '[determinism:' + label + '] V2.run produced no result/diagnostics on run 1');
  assert.ok(r2 && r2.result && r2.diagnostics,
    '[determinism:' + label + '] V2.run produced no result/diagnostics on run 2');

  assert.strictEqual(r1.result.length, r2.result.length,
    '[determinism:' + label + '] result row count mismatch: ' +
    r1.result.length + ' vs ' + r2.result.length);

  var k1 = extractRowKeys(r1.result);
  var k2 = extractRowKeys(r2.result);

  // (1) proctor_keys per row — byte equality via JSON.stringify of the
  //     row-array-of-arrays. Strings inside compose the assignments
  //     graph; their order matters (slot index within row is
  //     significant per V2's slot-metric semantics).
  var pk1Json = JSON.stringify(canonicalize(k1.proctorKeysByRow));
  var pk2Json = JSON.stringify(canonicalize(k2.proctorKeysByRow));
  assert.strictEqual(pk1Json, pk2Json,
    '[determinism:' + label + '] proctor_keys diverged across two runs.\n' +
    '  run1 = ' + pk1Json + '\n' +
    '  run2 = ' + pk2Json);

  // (2) reserve_keys per row — same byte-equality contract.
  var rk1Json = JSON.stringify(canonicalize(k1.reserveKeysByRow));
  var rk2Json = JSON.stringify(canonicalize(k2.reserveKeysByRow));
  assert.strictEqual(rk1Json, rk2Json,
    '[determinism:' + label + '] reserve_keys diverged across two runs.\n' +
    '  run1 = ' + rk1Json + '\n' +
    '  run2 = ' + rk2Json);

  // (3) diagnostics.coverageRepairSwaps — per-successful-swap counter,
  //     deterministic by the input-determinism of pending.sort,
  //     candidate sort, and applyCoverageSwap eligibility.
  var s1 = r1.diagnostics.coverageRepairSwaps;
  var s2 = r2.diagnostics.coverageRepairSwaps;
  assert.strictEqual(s1, s2,
    '[determinism:' + label + '] coverageRepairSwaps diverged: ' +
    s1 + ' vs ' + s2);

  // (4) diagnostics.coverageRepairUnresolved — informational counter.
  //     Pre-fix this is per-attempt; post-fix it is per-proctor. In
  //     either era it is deterministic for a fixed input.
  var u1 = r1.diagnostics.coverageRepairUnresolved;
  var u2 = r2.diagnostics.coverageRepairUnresolved;
  assert.strictEqual(u1, u2,
    '[determinism:' + label + '] coverageRepairUnresolved diverged: ' +
    u1 + ' vs ' + u2);

  console.log('[determinism:' + label + '] OK — ' +
    r1.result.length + ' rows, ' +
    'coverageRepairSwaps=' + s1 + ', coverageRepairUnresolved=' + u1);

  return { r1: r1, r2: r2 };
}

// ============================================================
// 4) Replay #1 — synthetic deficit-2 input from Task 1.1.
//
// Pre-fix this enters the buggy branch (P_uncov ends at load=1<2).
// The bug is itself deterministic, so R1 ≡ R2 still holds on F.
// Post-fix Task 7.2 will replay the same input and confirm the
// inner-loop addition (which closes the deficit on the second
// applyCoverageSwap call) is also deterministic.
// ============================================================

assertDeterministic('synthetic-deficit-2', buildSyntheticDeficit2Input());

// ============================================================
// 5) Replay #2 — production fixture tests/fixtures/45454.json.
//
// Pre-fix this also enters the buggy branch (طارق at load=0,
// coverageRepairUnresolved=6). Same input → same output across two
// runs, even with the bug present, because the per-proctor pending
// order, the donor pool collapse pattern, and the seenUnresolvedKeys
// dedupe are all deterministic functions of the input.
//
// Post-fix Task 7.2 will replay this fixture and confirm the
// multi-step closure remains deterministic.
//
// We re-load the fixture per call (not via shared reference) to
// eliminate any chance of in-place mutation by V2.run between the
// two runs contaminating the second run. V2 should not mutate its
// input — but the determinism contract holds even if we feed it a
// fresh deep clone each time, which is the conservative stance.
// ============================================================

const fixturePath = path.join(ROOT, 'tests/fixtures/45454.json');
const fixtureText = fs.readFileSync(fixturePath, 'utf8');

function freshFixtureInput() {
  return JSON.parse(fixtureText);
}

(function replayProdFixture() {
  // Two independent JSON.parse'd inputs — guarantees no shared object
  // reference that V2.run could mutate between runs.
  var input1 = freshFixtureInput();
  var input2 = freshFixtureInput();

  var r1 = V2.run(input1);
  var r2 = V2.run(input2);

  assert.ok(r1 && r1.result && r1.diagnostics,
    '[determinism:prod-fixture] V2.run produced no result/diagnostics on run 1');
  assert.ok(r2 && r2.result && r2.diagnostics,
    '[determinism:prod-fixture] V2.run produced no result/diagnostics on run 2');

  assert.strictEqual(r1.result.length, r2.result.length,
    '[determinism:prod-fixture] result row count mismatch: ' +
    r1.result.length + ' vs ' + r2.result.length);

  var k1 = extractRowKeys(r1.result);
  var k2 = extractRowKeys(r2.result);

  var pk1Json = JSON.stringify(canonicalize(k1.proctorKeysByRow));
  var pk2Json = JSON.stringify(canonicalize(k2.proctorKeysByRow));
  assert.strictEqual(pk1Json, pk2Json,
    '[determinism:prod-fixture] proctor_keys diverged across two runs ' +
    '(byte-length run1=' + pk1Json.length + ' run2=' + pk2Json.length + ')');

  var rk1Json = JSON.stringify(canonicalize(k1.reserveKeysByRow));
  var rk2Json = JSON.stringify(canonicalize(k2.reserveKeysByRow));
  assert.strictEqual(rk1Json, rk2Json,
    '[determinism:prod-fixture] reserve_keys diverged across two runs ' +
    '(byte-length run1=' + rk1Json.length + ' run2=' + rk2Json.length + ')');

  var s1 = r1.diagnostics.coverageRepairSwaps;
  var s2 = r2.diagnostics.coverageRepairSwaps;
  assert.strictEqual(s1, s2,
    '[determinism:prod-fixture] coverageRepairSwaps diverged: ' +
    s1 + ' vs ' + s2);

  var u1 = r1.diagnostics.coverageRepairUnresolved;
  var u2 = r2.diagnostics.coverageRepairUnresolved;
  assert.strictEqual(u1, u2,
    '[determinism:prod-fixture] coverageRepairUnresolved diverged: ' +
    u1 + ' vs ' + u2);

  console.log('[determinism:prod-fixture] OK — ' +
    r1.result.length + ' rows, ' +
    'coverageRepairSwaps=' + s1 + ', coverageRepairUnresolved=' + u1);
})();

// ============================================================
// 6) End-of-script — both replays passed.
// ============================================================

console.log('[determinism] all replays consistent — V2.run is ' +
  'input-deterministic on the synthetic deficit-2 input AND on the ' +
  'production fixture. Post-fix Task 7.2 must re-confirm this on F\'.');
