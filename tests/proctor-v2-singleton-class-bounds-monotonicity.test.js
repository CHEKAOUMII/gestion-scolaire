'use strict';

// ============================================================
// Spec: .kiro/specs/proctor-v2-singleton-class-bounds/
// Task 2.2 — One-sided monotonicity + determinism (Property 2).
//
// @pre-fix monotonicity test — EXPECTED OUTCOMES on F (UNFIXED code):
//   Branch 1 (bTotal > LB_global AND floor(bTotal/bSize) > LB_global):
//     FAILS — the cap rule is not yet implemented; the singleton's
//     pre-fix classLowerBound = floor(bTotal/1) = bTotal exceeds
//     LB_global + 1. This failure IS the bug witness (mirrors Task 1.1).
//   Branch 2 (bTotal > LB_global AND floor(bTotal/bSize) ≤ LB_global):
//     PASSES — pre-fix classLowerBound = floor(bTotal/bSize) ≤ LB_global,
//     and the post-fix cap is a no-op (cappedLower = min(rawLower,
//     lbGlobal) = rawLower; cappedUpper = max(cappedLower,
//     min(rawUpper, lbGlobal+1)) = rawUpper when rawUpper ≤ lbGlobal+1).
//     Byte-identical pre/post fix.
//   Branch 3 (bTotal ≤ LB_global):
//     PASSES — pre-fix classLowerBound = floor(bTotal/bSize). Post-fix
//     monotonicity guard fires (`bTotal ≤ lbGlobal` ⇒ retain bTotal).
//     For bSize=1 (singleton with bTotal ≤ lbGlobal), pre-fix value is
//     bTotal exactly, so the guard's retention is byte-identical.
//   Branch 4 (bTotal = 0):
//     PASSES — pre-fix classLowerBound = floor(0/bSize) = 0;
//     classUpperBound = ceil(0/bSize) = 0. Post-fix monotonicity guard
//     fires (0 ≤ lbGlobal always) ⇒ retain 0. Byte-identical.
//
// Plus determinism: replay tests/fixtures/45454.json twice and assert
// `serialize(R1.classBoundsByProctorKey) === serialize(R2.classBoundsByProctorKey)`.
// Pre-fix the algorithm is deterministic for the bounds-derivation
// step (no PRNG, no global state), so the assertion PASSES on F. After
// Task 5 lands, the assertion MUST still PASS on F'.
//
// Post-Task-5 expected behavior:
//   Branch 1: classLowerBound capped at lbGlobal, classUpperBound at
//             lbGlobal + 1. The cap satisfies the post-fix universal
//             property `classLowerBound ≤ LB_global + 1` (Property 1).
//   Branches 2, 3, 4: byte-identical pre/post fix (Property 2 —
//                     one-sided monotonicity preservation).
//   Determinism: byte-equality of two consecutive runs (preserved).
//
// _Bug_Condition: NOT isBugCondition(X) for branches 2, 3, 4;
//                 isBugCondition(X) for branch 1.
// _Expected_Behavior: Property 2 — one-sided monotonicity (post-fix
//                     classLowerBound ≤ pre-fix classLowerBound for
//                     all classes); Property 1 — cap fires for
//                     branch 1.
// _File: tests/proctor-v2-singleton-class-bounds-monotonicity.test.js (NEW)
// _Validates: Requirements 2.2, 2.4, 3.17, 3.20
// ============================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ============================================================
// 1) Load the production v2 module via vm sandbox.
//    Same idiom as tests/proctor-v2-singleton-class-bounds-exploration.test.js.
// ============================================================

const v2Src = fs.readFileSync(
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
vm.runInContext(v2Src, sb);
const V2 = sb.ProctorDistributionV2 || sb.window.ProctorDistributionV2;

assert.ok(V2 && typeof V2.run === 'function',
  'Failed to load ProctorDistributionV2 from production module');
assert.ok(V2._internals &&
  typeof V2._internals.computeClassBounds === 'function' &&
  typeof V2._internals.computeEligibilityClasses === 'function',
  'V2._internals.{computeClassBounds, computeEligibilityClasses} ' +
  'are required by this test.');

// ============================================================
// 2) Synthetic input helpers (same shape as Task 1.x exploration test).
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

function makeEntry(day, period, session, dateDay) {
  return {
    day: day,
    period: period,
    session: session,
    level_name: 'الثانية بكالوريا',
    subject_name: 'الرياضيات',
    date_day: String(dateDay),
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

function sessionScopeKey(entry) {
  return ['session', entry.day, entry.period, entry.session].join('|');
}

// Compute classBoundsByKey + LB_global directly via _internals — pure,
// no IPC, no DB. Mirrors the helpers section of the Task 1.x test.
function deriveBounds(input) {
  var proctorsList = input.proctorsList;
  var scheduleEntries = input.scheduleEntries;
  var proctorsPerRoom = (input.examDistributionRules &&
    input.examDistributionRules.proctorsPerRoom) || 1;
  var D_expected = Number(input.D_expected) || 0;

  // guardSlotsByIndex either provided directly (branch 4 uses an
  // explicit zero-rooms entry) or computed from rooms × proctorsPerRoom.
  var guardSlotsByIndex;
  if (input._guardSlotsByIndex) {
    guardSlotsByIndex = input._guardSlotsByIndex;
  } else {
    guardSlotsByIndex = {};
    var roomsList = (input.options && input.options.roomsList) || [];
    for (var i = 0; i < scheduleEntries.length; i++) {
      guardSlotsByIndex[i] = roomsList.length * proctorsPerRoom;
    }
  }

  var eligibilityClasses = V2._internals.computeEligibilityClasses(
    proctorsList,
    scheduleEntries,
    input.exemptionsData || {},
    input.dutyData || {},
    null
  );

  var eligibleCount = 0;
  eligibilityClasses.forEach(function (cls) {
    eligibleCount += (cls.members || []).length;
  });

  var classBoundsMap = V2._internals.computeClassBounds(
    eligibilityClasses,
    scheduleEntries,
    proctorsPerRoom,
    D_expected,
    eligibleCount,
    guardSlotsByIndex
  );

  var classBoundsByKey = {};
  var classIdByKey = {};
  eligibilityClasses.forEach(function (cls, classId) {
    var bounds = classBoundsMap.get(classId);
    var members = cls.members || [];
    for (var cm = 0; cm < members.length; cm++) {
      classBoundsByKey[members[cm].key] = bounds
        ? {
            classLowerBound: bounds.classLowerBound,
            classUpperBound: bounds.classUpperBound,
            G_class: bounds.G_class,
            D_expected_class: bounds.D_expected_class
          }
        : null;
      classIdByKey[members[cm].key] = classId;
    }
  });

  var totalGuardSlots = 0;
  for (var ti = 0; ti < scheduleEntries.length; ti++) {
    totalGuardSlots += Number(guardSlotsByIndex[ti]) || 0;
  }
  var lbGlobal = eligibleCount > 0
    ? Math.floor((totalGuardSlots + D_expected) / eligibleCount)
    : 0;

  return {
    classBoundsByKey: classBoundsByKey,
    classIdByKey: classIdByKey,
    classBoundsMap: classBoundsMap,
    eligibilityClasses: eligibilityClasses,
    eligibleCount: eligibleCount,
    totalGuardSlots: totalGuardSlots,
    lbGlobal: lbGlobal
  };
}

var failures = [];

// ============================================================
// 3) Branch 1 — bTotal > LB_global AND floor(bTotal/bSize) > LB_global.
//
// Geometry: 5 proctors, 5 entries × 5 rooms × 1 proctor/room = 25 slots,
// LB_global = floor(25/5) = 5. Singleton P5 eligible for entries {0,1}
// → bSize=1, G=10, bTotal=10. floor(10/1)=10 > LB_global=5, AND
// bTotal=10 > LB_global=5.
//
// Pre-fix (UNFIXED): singleton classLowerBound = 10, classUpperBound = 10.
//   The post-fix expected values (LB_global=5, LB_global+1=6) are NOT
//   reached, so the assertion below FAILS on F. That failure IS the bug
//   witness for Branch 1.
//
// Post-fix (Task 5): cap fires → classLowerBound = LB_global = 5,
//   classUpperBound = LB_global + 1 = 6 (because rawUpper = ceil(10/1) =
//   10 > LB_global+1, so cappedUpper = min(rawUpper, LB_global+1) = 6
//   per design.md §"Specific Changes" point 2).
// ============================================================

function buildBranch1Input() {
  var P1 = makeProctor('proctor_b1_1', 'CIN_B1_001', 'عام', 'ذكر');
  var P2 = makeProctor('proctor_b1_2', 'CIN_B1_002', 'عام', 'ذكر');
  var P3 = makeProctor('proctor_b1_3', 'CIN_B1_003', 'عام', 'ذكر');
  var P4 = makeProctor('proctor_b1_4', 'CIN_B1_004', 'عام', 'ذكر');
  var P5 = makeProctor('proctor_b1_5', 'CIN_B1_005', 'عام', 'ذكر');

  // 5 entries with distinct (day, period, session) tuples, each across
  // a distinct day to avoid halfday-key collisions.
  var entries = [
    makeEntry('B1_d1', 'صباحا', 'الحصة الأولى', 1),
    makeEntry('B1_d2', 'صباحا', 'الحصة الأولى', 2),
    makeEntry('B1_d3', 'صباحا', 'الحصة الأولى', 3),
    makeEntry('B1_d4', 'صباحا', 'الحصة الأولى', 4),
    makeEntry('B1_d5', 'صباحا', 'الحصة الأولى', 5)
  ];
  var rooms = [
    makeRoom('B1R1'), makeRoom('B1R2'), makeRoom('B1R3'),
    makeRoom('B1R4'), makeRoom('B1R5')
  ];

  // Eligibility (mirror Task 1.1's adjusted geometry):
  //   P1, P2 → {2, 3}    (class A, size 2, G=10, bTotal=10, raw LB=5)
  //   P3, P4 → {2, 4}    (class B, size 2, G=10, bTotal=10, raw LB=5)
  //   P5     → {0, 1}    (singleton, G=10, bTotal=10, raw LB=10)  ← bug
  var exemptionsData = {};
  for (var ei = 0; ei < entries.length; ei++) {
    exemptionsData[sessionScopeKey(entries[ei])] = {};
  }
  // P1, P2 exempt for entries {0, 1, 4}
  [0, 1, 4].forEach(function (ei) {
    var k = sessionScopeKey(entries[ei]);
    exemptionsData[k]['CIN_B1_001'] = 'no';
    exemptionsData[k]['CIN_B1_002'] = 'no';
  });
  // P3, P4 exempt for entries {0, 1, 3}
  [0, 1, 3].forEach(function (ei) {
    var k = sessionScopeKey(entries[ei]);
    exemptionsData[k]['CIN_B1_003'] = 'no';
    exemptionsData[k]['CIN_B1_004'] = 'no';
  });
  // P5 exempt for entries {2, 3, 4}
  [2, 3, 4].forEach(function (ei) {
    var k = sessionScopeKey(entries[ei]);
    exemptionsData[k]['CIN_B1_005'] = 'no';
  });

  return {
    proctorsList: [P1, P2, P3, P4, P5],
    scheduleEntries: entries,
    exemptionsData: exemptionsData,
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
      noRoomRepeat: false,
      avoidSpecialty: false,
      respectMorningEvening: false,
      preferMixedGenderPair: false
    },
    enablePhase3: false,
    D_expected: 0
  };
}

(function runBranch1() {
  var ctx = deriveBounds(buildBranch1Input());
  console.log('[branch1] cap fires (bTotal>LB_global AND floor(bTotal/bSize)>LB_global)');
  console.log('  totalGuardSlots=' + ctx.totalGuardSlots +
    ', eligibleCount=' + ctx.eligibleCount +
    ', LB_global=' + ctx.lbGlobal);
  var singletonKey = 'CIN_B1_005';
  var b = ctx.classBoundsByKey[singletonKey];
  if (!b) {
    failures.push('[branch1] expected singleton ' + singletonKey +
      ' to have bounds; got <undefined>. Synthetic input geometry is wrong.');
    return;
  }
  console.log('  singleton ' + singletonKey + ': classLowerBound=' +
    b.classLowerBound + ' classUpperBound=' + b.classUpperBound +
    ' G_class=' + b.G_class + ' D_expected_class=' + b.D_expected_class);

  // Sanity: the bug-condition setup. Singleton should have raw values
  // 10/10 pre-fix (G=10, bSize=1, D=0 → bTotal=10; floor=ceil=10).
  // This sanity check IS what the post-fix cap will modify.
  // Pre-fix: bothLower=10, bothUpper=10. Post-fix: capped to 5, 6.

  // POST-FIX universal property assertion (the cap rule):
  //   classLowerBound = LB_global = 5
  //   classUpperBound = LB_global + 1 = 6
  // Pre-fix this FAILS — singleton classLowerBound is 10, not 5. The
  // failure IS the bug witness. Branches 2/3/4 below must continue to
  // be checked even when this assertion fails — failures are
  // accumulated rather than thrown, and the harness exits non-zero
  // at the bottom if any branch failed.
  if (b.classLowerBound !== ctx.lbGlobal) {
    failures.push(
      '[branch1] post-fix cap NOT applied: singleton ' + singletonKey +
      ' has classLowerBound = ' + b.classLowerBound +
      ', expected ' + ctx.lbGlobal + ' (= LB_global). ' +
      'Pre-fix witness — this failure IS the bug condition for branch 1 ' +
      '(bTotal=10 > LB_global=5 AND floor(bTotal/bSize)=10 > LB_global=5). ' +
      'After Task 5 lands, the cap rule will set classLowerBound = ' +
      'min(floor(bTotal/bSize), LB_global) = min(10, 5) = 5. ' +
      'See design.md §"Specific Changes" point 2.'
    );
  }
  if (b.classUpperBound !== ctx.lbGlobal + 1) {
    failures.push(
      '[branch1] post-fix cap NOT applied: singleton ' + singletonKey +
      ' has classUpperBound = ' + b.classUpperBound +
      ', expected ' + (ctx.lbGlobal + 1) + ' (= LB_global + 1). ' +
      'Pre-fix this is bTotal=10 (uncapped). ' +
      'After Task 5: cappedUpper = max(cappedLower, min(rawUpper, ' +
      'LB_global+1)) = max(5, min(10, 6)) = 6.'
    );
  }

  // Cross-check: multi-member classes A and B remain untouched. Their
  // floor(bTotal/bSize) = floor(10/2) = 5 ≤ LB_global, so the cap is a
  // no-op for them. Pre-fix and post-fix values are byte-identical.
  ['CIN_B1_001', 'CIN_B1_002', 'CIN_B1_003', 'CIN_B1_004'].forEach(function (k) {
    var bb = ctx.classBoundsByKey[k];
    if (!bb) {
      failures.push('[branch1] multi-member ' + k +
        ' missing bounds — geometry mismatch.');
      return;
    }
    if (bb.classLowerBound !== 5 || bb.classUpperBound !== 5) {
      failures.push(
        '[branch1] multi-member ' + k + ' bounds drifted: ' +
        'classLowerBound=' + bb.classLowerBound +
        ', classUpperBound=' + bb.classUpperBound +
        '; expected 5/5 (raw floor/ceil of bTotal=10, bSize=2). ' +
        'Post-fix MUST preserve these byte-identically (the cap is a ' +
        'no-op when floor(bTotal/bSize) ≤ LB_global).'
      );
    }
  });
})();

// ============================================================
// 4) Branch 2 — bTotal > LB_global AND floor(bTotal/bSize) ≤ LB_global.
//
// Geometry: 4 proctors, 4 entries × 5 rooms × 1 proctor/room = 20 slots.
// Two classes of size 2:
//   P1, P2 → {0, 1}  (class A, G=10, bSize=2, raw LB=5)
//   P3, P4 → {2, 3}  (class B, G=10, bSize=2, raw LB=5)
// LB_global = floor(20/4) = 5. For BOTH classes:
//   bTotal = 10 > LB_global = 5      ✓ first condition
//   floor(bTotal/bSize) = 5 ≤ LB_global = 5  ✓ second condition
//
// Pre-fix: each class classLowerBound=5, classUpperBound=5.
// Post-fix: cap is no-op (cappedLower=min(5, 5)=5; cappedUpper=
//          max(5, min(5, 6))=5). Byte-identical to pre-fix.
//
// _Bug_Condition: NOT isBugCondition — pre-fix already satisfies the
//                 cap rule.
// ============================================================

function buildBranch2Input() {
  var P1 = makeProctor('proctor_b2_1', 'CIN_B2_001', 'عام', 'ذكر');
  var P2 = makeProctor('proctor_b2_2', 'CIN_B2_002', 'عام', 'ذكر');
  var P3 = makeProctor('proctor_b2_3', 'CIN_B2_003', 'عام', 'ذكر');
  var P4 = makeProctor('proctor_b2_4', 'CIN_B2_004', 'عام', 'ذكر');

  var entries = [
    makeEntry('B2_d1', 'صباحا', 'الحصة الأولى', 1),
    makeEntry('B2_d2', 'صباحا', 'الحصة الأولى', 2),
    makeEntry('B2_d3', 'صباحا', 'الحصة الأولى', 3),
    makeEntry('B2_d4', 'صباحا', 'الحصة الأولى', 4)
  ];
  var rooms = [
    makeRoom('B2R1'), makeRoom('B2R2'), makeRoom('B2R3'),
    makeRoom('B2R4'), makeRoom('B2R5')
  ];

  var exemptionsData = {};
  for (var ei = 0; ei < entries.length; ei++) {
    exemptionsData[sessionScopeKey(entries[ei])] = {};
  }
  // P1, P2 eligible for {0, 1}; exempt {2, 3}.
  [2, 3].forEach(function (ei) {
    var k = sessionScopeKey(entries[ei]);
    exemptionsData[k]['CIN_B2_001'] = 'no';
    exemptionsData[k]['CIN_B2_002'] = 'no';
  });
  // P3, P4 eligible for {2, 3}; exempt {0, 1}.
  [0, 1].forEach(function (ei) {
    var k = sessionScopeKey(entries[ei]);
    exemptionsData[k]['CIN_B2_003'] = 'no';
    exemptionsData[k]['CIN_B2_004'] = 'no';
  });

  return {
    proctorsList: [P1, P2, P3, P4],
    scheduleEntries: entries,
    exemptionsData: exemptionsData,
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
      noRoomRepeat: false,
      avoidSpecialty: false,
      respectMorningEvening: false,
      preferMixedGenderPair: false
    },
    enablePhase3: false,
    D_expected: 0
  };
}

(function runBranch2() {
  var ctx = deriveBounds(buildBranch2Input());
  console.log('[branch2] cap is no-op (bTotal>LB_global, floor(bTotal/bSize)≤LB_global)');
  console.log('  totalGuardSlots=' + ctx.totalGuardSlots +
    ', eligibleCount=' + ctx.eligibleCount +
    ', LB_global=' + ctx.lbGlobal);

  var EXPECTED_LB = 5;
  var EXPECTED_UB = 5;
  ['CIN_B2_001', 'CIN_B2_002', 'CIN_B2_003', 'CIN_B2_004'].forEach(function (k) {
    var b = ctx.classBoundsByKey[k];
    if (!b) {
      failures.push('[branch2] ' + k + ' missing bounds — ' +
        'geometry mismatch (every proctor must end up in a class).');
      return;
    }
    console.log('  ' + k + ': classLowerBound=' + b.classLowerBound +
      ' classUpperBound=' + b.classUpperBound +
      ' G_class=' + b.G_class + ' D_expected_class=' + b.D_expected_class);
    if (b.classLowerBound !== EXPECTED_LB) {
      failures.push(
        '[branch2] cap-no-op violated: ' + k +
        ' has classLowerBound=' + b.classLowerBound +
        ', expected ' + EXPECTED_LB + '. ' +
        'Pre-fix and post-fix MUST agree here — when ' +
        'floor(bTotal/bSize) ≤ LB_global, the post-fix cap rule ' +
        'cappedLower = min(rawLower, LB_global) yields rawLower ' +
        'unchanged. design.md §"Specific Changes" point 2.'
      );
    }
    if (b.classUpperBound !== EXPECTED_UB) {
      failures.push(
        '[branch2] cap-no-op violated: ' + k +
        ' has classUpperBound=' + b.classUpperBound +
        ', expected ' + EXPECTED_UB + '. Byte-identical pre/post fix.'
      );
    }
  });

  // Sanity: pre-condition for branch 2 — bTotal > LB_global.
  // bTotal for each class = G + D = 10 + 0 = 10 > 5 ✓
  Object.keys(ctx.classBoundsByKey).forEach(function (k) {
    var b = ctx.classBoundsByKey[k];
    if (!b) return;
    var bTotal = (b.G_class || 0) + (b.D_expected_class || 0);
    if (!(bTotal > ctx.lbGlobal)) {
      failures.push('[branch2-precondition] ' + k +
        ' has bTotal=' + bTotal + ' which is NOT > LB_global=' +
        ctx.lbGlobal + '. Branch 2 requires bTotal > LB_global.');
    }
  });
})();

// ============================================================
// 5) Branch 3 — bTotal ≤ LB_global (monotonicity guard fires).
//
// Geometry: 5 proctors, 6 entries × 5 rooms × 1 proctor/room = ... wait
// we need a singleton with bTotal ≤ LB_global. Concrete numbers:
//
//   5 proctors. P1..P4 share class A (size 4) eligible for entries
//   {0,1,2,3,4} (5 entries × 5 rooms = 25 slots, G_A=25). P5 is a
//   singleton eligible for entry {5} which has 2 rooms → G_5=2.
//   totalGuardSlots = 5*5 + 2 = 27. N_eligible = 5. LB_global =
//   floor(27/5) = 5.
//
//   For singleton P5: bSize=1, G=2, D=0, bTotal=2. bTotal=2 ≤
//   LB_global=5 → guard fires. Pre-fix: classLowerBound = floor(2/1)
//   = 2, classUpperBound = ceil(2/1) = 2. Post-fix monotonicity guard:
//   cappedLower = bTotal = 2, cappedUpper = bTotal = 2. Byte-identical.
//
//   For class A: bSize=4, G=25, D=0, bTotal=25. bTotal=25 > LB_global=5.
//   floor(bTotal/bSize) = 6 > LB_global=5 → cap fires (this is
//   actually a branch-1 case for class A!). Pre-fix classLowerBound=6;
//   post-fix classLowerBound=5. To keep this test focused on the
//   monotonicity guard for the singleton, we relax the assertion on
//   class A — we only assert the singleton's pre/post equality and
//   note that class A would change post-fix (a separate property).
//
// Branch 3 in this test is the SINGLETON's path through the
// monotonicity guard. Class A's behavior is byproduct.
//
// To make this test fully pre-fix-passing on F (per task 2.2's
// "Branches 2, 3, 4 PASS pre-fix"), we restrict the assertion to the
// monotonicity-guard side: assert only that the singleton's pre-fix
// classLowerBound = bTotal = 2. The post-fix preservation (cappedLower
// == bTotal == 2) is byte-identical, so the same assertion passes
// post-fix.
// ============================================================

function buildBranch3Input() {
  var P1 = makeProctor('proctor_b3_1', 'CIN_B3_001', 'عام', 'ذكر');
  var P2 = makeProctor('proctor_b3_2', 'CIN_B3_002', 'عام', 'ذكر');
  var P3 = makeProctor('proctor_b3_3', 'CIN_B3_003', 'عام', 'ذكر');
  var P4 = makeProctor('proctor_b3_4', 'CIN_B3_004', 'عام', 'ذكر');
  var P5 = makeProctor('proctor_b3_5', 'CIN_B3_005', 'عام', 'ذكر');

  // 6 entries — 5 with full 5-room geometry, entry 5 with reduced
  // room count (2 rooms only) for the singleton's narrow eligibility.
  var entries = [
    makeEntry('B3_d1', 'صباحا', 'الحصة الأولى', 1),
    makeEntry('B3_d2', 'صباحا', 'الحصة الأولى', 2),
    makeEntry('B3_d3', 'صباحا', 'الحصة الأولى', 3),
    makeEntry('B3_d4', 'صباحا', 'الحصة الأولى', 4),
    makeEntry('B3_d5', 'صباحا', 'الحصة الأولى', 5),
    makeEntry('B3_d6', 'صباحا', 'الحصة الأولى', 6)
  ];

  // Per-entry guardSlotsByIndex — entries 0..4 have 5 slots, entry 5
  // has 2 slots. We pass guardSlotsByIndex directly to deriveBounds via
  // the _guardSlotsByIndex hook; computeClassBounds reads it via
  // getGuardSlotsForScheduleIndex, which prefers the explicit map.
  var guardSlotsByIndex = {
    0: 5, 1: 5, 2: 5, 3: 5, 4: 5, 5: 2
  };
  var rooms = [
    makeRoom('B3R1'), makeRoom('B3R2'), makeRoom('B3R3'),
    makeRoom('B3R4'), makeRoom('B3R5')
  ];

  var exemptionsData = {};
  for (var ei = 0; ei < entries.length; ei++) {
    exemptionsData[sessionScopeKey(entries[ei])] = {};
  }
  // P1..P4 eligible for {0,1,2,3,4}; exempt for {5}.
  [5].forEach(function (ei) {
    var k = sessionScopeKey(entries[ei]);
    exemptionsData[k]['CIN_B3_001'] = 'no';
    exemptionsData[k]['CIN_B3_002'] = 'no';
    exemptionsData[k]['CIN_B3_003'] = 'no';
    exemptionsData[k]['CIN_B3_004'] = 'no';
  });
  // P5 eligible for {5}; exempt for {0,1,2,3,4}.
  [0, 1, 2, 3, 4].forEach(function (ei) {
    var k = sessionScopeKey(entries[ei]);
    exemptionsData[k]['CIN_B3_005'] = 'no';
  });

  return {
    proctorsList: [P1, P2, P3, P4, P5],
    scheduleEntries: entries,
    exemptionsData: exemptionsData,
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
      noRoomRepeat: false,
      avoidSpecialty: false,
      respectMorningEvening: false,
      preferMixedGenderPair: false
    },
    enablePhase3: false,
    D_expected: 0,
    _guardSlotsByIndex: guardSlotsByIndex
  };
}

(function runBranch3() {
  var ctx = deriveBounds(buildBranch3Input());
  console.log('[branch3] monotonicity guard fires (bTotal ≤ LB_global)');
  console.log('  totalGuardSlots=' + ctx.totalGuardSlots +
    ', eligibleCount=' + ctx.eligibleCount +
    ', LB_global=' + ctx.lbGlobal);

  var singletonKey = 'CIN_B3_005';
  var b = ctx.classBoundsByKey[singletonKey];
  if (!b) {
    failures.push('[branch3] singleton ' + singletonKey +
      ' missing bounds — geometry mismatch.');
    return;
  }
  console.log('  singleton ' + singletonKey + ': classLowerBound=' +
    b.classLowerBound + ' classUpperBound=' + b.classUpperBound +
    ' G_class=' + b.G_class + ' D_expected_class=' + b.D_expected_class);

  // Pre-condition: bTotal ≤ LB_global. For our geometry:
  //   bTotal_singleton = G_class + D_expected_class = 2 + 0 = 2.
  //   LB_global = 5.
  //   2 ≤ 5 ✓.
  var bTotal = (b.G_class || 0) + (b.D_expected_class || 0);
  if (!(bTotal <= ctx.lbGlobal)) {
    failures.push('[branch3-precondition] singleton bTotal=' + bTotal +
      ' is NOT ≤ LB_global=' + ctx.lbGlobal +
      '. Branch 3 requires bTotal ≤ LB_global. ' +
      'Adjust the synthetic geometry — the singleton\'s reachable ' +
      'guard-slot total must stay below the global fairness floor.');
    return;
  }

  // Post-fix monotonicity guard yields:
  //   cappedLower = bTotal (= 2)
  //   cappedUpper = bTotal (= 2)
  // Pre-fix the multi-class fallback emits floor(2/1)=2, ceil(2/1)=2.
  // Same numbers ⇒ byte-identical. This assertion PASSES on F and
  // MUST continue to PASS on F'.
  if (b.classLowerBound !== bTotal) {
    failures.push(
      '[branch3] monotonicity guard violation: singleton ' + singletonKey +
      ' has classLowerBound=' + b.classLowerBound +
      ', expected ' + bTotal + ' (= bTotal, since bTotal ≤ LB_global). ' +
      'design.md §"Specific Changes" point 2 — the post-fix guard ' +
      'retains bTotal exactly; pre-fix the multi-class branch emits ' +
      'floor(bTotal/bSize) = bTotal (when bSize=1). Same value either way.'
    );
  }
  if (b.classUpperBound !== bTotal) {
    failures.push(
      '[branch3] monotonicity guard violation: singleton ' + singletonKey +
      ' has classUpperBound=' + b.classUpperBound +
      ', expected ' + bTotal + '. Byte-identical pre/post fix.'
    );
  }
})();

// ============================================================
// 6) Branch 4 — bTotal = 0 (degenerate).
//
// Geometry: 3 proctors, 2 entries:
//   Entry 0: 5 rooms × 1 proctor/room = 5 slots. P1, P2 eligible.
//   Entry 1: 0 rooms × 1 proctor/room = 0 slots (explicit
//     guardSlotsByIndex[1] = 0). P3 eligible only.
//
// Eligibility:
//   P1, P2 → {0}     (class A, size 2, G=5, bTotal=5)
//   P3     → {1}     (singleton, G=0, bTotal=0)
//
// totalGuardSlots = 5 + 0 = 5. N_eligible = 3. LB_global = floor(5/3)
// = 1. For the singleton: bTotal=0 ≤ LB_global=1 → guard fires.
// Pre-fix: classLowerBound = floor(0/1) = 0; classUpperBound =
// ceil(0/1) = 0. Post-fix: cappedLower = bTotal = 0; cappedUpper =
// bTotal = 0. Byte-identical.
//
// For class A: bSize=2, G=5, D=0, bTotal=5. bTotal=5 > LB_global=1
// AND floor(5/2)=2 > LB_global=1 → branch-1 cap fires post-fix
// (pre-fix LB=2 → post-fix LB=1). We DON'T assert class A's bounds
// here — branch 4 is specifically about the singleton's bTotal=0 path.
// ============================================================

function buildBranch4Input() {
  var P1 = makeProctor('proctor_b4_1', 'CIN_B4_001', 'عام', 'ذكر');
  var P2 = makeProctor('proctor_b4_2', 'CIN_B4_002', 'عام', 'ذكر');
  var P3 = makeProctor('proctor_b4_3', 'CIN_B4_003', 'عام', 'ذكر');

  var entries = [
    makeEntry('B4_d1', 'صباحا', 'الحصة الأولى', 1),
    makeEntry('B4_d2', 'صباحا', 'الحصة الأولى', 2)
  ];
  // Explicit guardSlotsByIndex — entry 1 has zero slots.
  var guardSlotsByIndex = { 0: 5, 1: 0 };
  var rooms = [
    makeRoom('B4R1'), makeRoom('B4R2'), makeRoom('B4R3'),
    makeRoom('B4R4'), makeRoom('B4R5')
  ];

  var exemptionsData = {};
  for (var ei = 0; ei < entries.length; ei++) {
    exemptionsData[sessionScopeKey(entries[ei])] = {};
  }
  // P1, P2 exempt for entry 1.
  exemptionsData[sessionScopeKey(entries[1])]['CIN_B4_001'] = 'no';
  exemptionsData[sessionScopeKey(entries[1])]['CIN_B4_002'] = 'no';
  // P3 exempt for entry 0.
  exemptionsData[sessionScopeKey(entries[0])]['CIN_B4_003'] = 'no';

  return {
    proctorsList: [P1, P2, P3],
    scheduleEntries: entries,
    exemptionsData: exemptionsData,
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
      noRoomRepeat: false,
      avoidSpecialty: false,
      respectMorningEvening: false,
      preferMixedGenderPair: false
    },
    enablePhase3: false,
    D_expected: 0,
    _guardSlotsByIndex: guardSlotsByIndex
  };
}

(function runBranch4() {
  var ctx = deriveBounds(buildBranch4Input());
  console.log('[branch4] degenerate (bTotal = 0)');
  console.log('  totalGuardSlots=' + ctx.totalGuardSlots +
    ', eligibleCount=' + ctx.eligibleCount +
    ', LB_global=' + ctx.lbGlobal);

  var singletonKey = 'CIN_B4_003';
  var b = ctx.classBoundsByKey[singletonKey];
  if (!b) {
    failures.push('[branch4] singleton ' + singletonKey +
      ' missing bounds — geometry mismatch (P3 must end up in a class).');
    return;
  }
  console.log('  singleton ' + singletonKey + ': classLowerBound=' +
    b.classLowerBound + ' classUpperBound=' + b.classUpperBound +
    ' G_class=' + b.G_class + ' D_expected_class=' + b.D_expected_class);

  // Pre-condition: bTotal = 0.
  var bTotal = (b.G_class || 0) + (b.D_expected_class || 0);
  if (bTotal !== 0) {
    failures.push('[branch4-precondition] singleton bTotal=' + bTotal +
      ', expected 0. Branch 4 requires bTotal = 0. The synthetic ' +
      'guardSlotsByIndex[1] = 0 should yield G_class = 0 for the ' +
      'singleton via getGuardSlotsForScheduleIndex.');
    return;
  }

  // Pre-fix and post-fix BOTH yield 0/0 for this singleton:
  //   pre-fix:  classLowerBound = floor(0/1) = 0; classUpperBound = 0.
  //   post-fix: monotonicity guard fires (0 ≤ LB_global always);
  //             cappedLower = 0; cappedUpper = 0.
  if (b.classLowerBound !== 0) {
    failures.push(
      '[branch4] degenerate violation: singleton ' + singletonKey +
      ' has classLowerBound=' + b.classLowerBound +
      ', expected 0 (bTotal=0). design.md §"Examples" — class with ' +
      'G=0 must produce classLowerBound=0 byte-identically pre/post fix.'
    );
  }
  if (b.classUpperBound !== 0) {
    failures.push(
      '[branch4] degenerate violation: singleton ' + singletonKey +
      ' has classUpperBound=' + b.classUpperBound +
      ', expected 0.'
    );
  }
})();

// ============================================================
// 7) Determinism — replay tests/fixtures/45454.json twice via V2.run
//    and assert serialize(R1.classBoundsByProctorKey) ===
//    serialize(R2.classBoundsByProctorKey).
//
// V2.run does NOT publicly surface classBoundsByProctorKey — it only
// exposes diagnostics.classBounds (keyed by classId). For determinism,
// classId-keyed serialization is sufficient because the classId
// derivation (eligible.join(',') + '|' + baselineDuty in
// computeEligibilityClasses) is deterministic, and the per-classId
// bounds object includes the same {classLowerBound, classUpperBound,
// G_class, D_expected_class} fields. We assert both:
//   (a) R1.diagnostics.classBounds === R2.diagnostics.classBounds
//       (serialized stable form)
//   (b) R1.result[i].proctor_keys === R2.result[i].proctor_keys for
//       all i (reinforces determinism beyond the bounds map).
//
// Pre-fix (UNFIXED): the algorithm is already deterministic for the
//   bounds-derivation step (no PRNG, no global state). PASS.
// Post-fix (Task 5): determinism MUST be preserved. PASS.
// ============================================================

(function runDeterminism() {
  var fixturePath = path.join(ROOT, 'tests/fixtures/45454.json');
  var prodInput = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  var r1, r2;
  try {
    r1 = V2.run(prodInput);
  } catch (e) {
    failures.push('[determinism] V2.run(45454.json) threw on first ' +
      'replay: ' + e.message);
    return;
  }
  try {
    r2 = V2.run(prodInput);
  } catch (e) {
    failures.push('[determinism] V2.run(45454.json) threw on second ' +
      'replay: ' + e.message);
    return;
  }
  if (!r1 || !r1.diagnostics) {
    failures.push('[determinism] V2.run replay 1 returned no ' +
      'diagnostics.');
    return;
  }
  if (!r2 || !r2.diagnostics) {
    failures.push('[determinism] V2.run replay 2 returned no ' +
      'diagnostics.');
    return;
  }

  // Stable canonical serialization — sort object keys recursively.
  function canonicalize(value) {
    if (value === null) return null;
    if (Array.isArray(value)) return value.map(canonicalize);
    if (typeof value === 'object') {
      var sorted = {};
      var keys = Object.keys(value).sort();
      for (var i = 0; i < keys.length; i++) {
        sorted[keys[i]] = canonicalize(value[keys[i]]);
      }
      return sorted;
    }
    return value;
  }
  function stable(v) { return JSON.stringify(canonicalize(v)); }

  // (a) classBounds map (per-classId).
  var s1 = stable(r1.diagnostics.classBounds || {});
  var s2 = stable(r2.diagnostics.classBounds || {});
  console.log('[determinism] tests/fixtures/45454.json replay');
  console.log('  classBounds entries: ' +
    Object.keys(r1.diagnostics.classBounds || {}).length);
  if (s1 !== s2) {
    failures.push(
      '[determinism] V2.run produced non-deterministic ' +
      'diagnostics.classBounds across two replays of ' +
      'tests/fixtures/45454.json. ' +
      'Sample diff prefix:\n' +
      '  r1: ' + s1.slice(0, 400) + (s1.length > 400 ? '…' : '') + '\n' +
      '  r2: ' + s2.slice(0, 400) + (s2.length > 400 ? '…' : '') + '\n' +
      'Pre-fix this is expected to PASS — the bounds-derivation step ' +
      'has no PRNG or global state. Post-fix it MUST also PASS. ' +
      'design.md §"Preservation Requirements" → "Determinism".'
    );
  } else {
    console.log('  classBounds: byte-identical across replays ✓');
  }

  // (b) per-row proctor_keys (reinforces determinism end-to-end).
  var rows1 = r1.result || [];
  var rows2 = r2.result || [];
  if (rows1.length !== rows2.length) {
    failures.push('[determinism] row-count drift: r1=' + rows1.length +
      ', r2=' + rows2.length);
  } else {
    var pkSeed1 = [];
    var pkSeed2 = [];
    for (var ri = 0; ri < rows1.length; ri++) {
      pkSeed1.push((rows1[ri].proctor_keys || []).slice());
      pkSeed2.push((rows2[ri].proctor_keys || []).slice());
    }
    var pkS1 = JSON.stringify(pkSeed1);
    var pkS2 = JSON.stringify(pkSeed2);
    if (pkS1 !== pkS2) {
      failures.push(
        '[determinism] per-row proctor_keys diverged across two ' +
        'replays of tests/fixtures/45454.json. ' +
        'V2.run is not deterministic on this fixture. ' +
        'Pre-fix this should PASS — the algorithm seeds its PRNG ' +
        'from input.randomSeed and has no other source of ' +
        'non-determinism.'
      );
    } else {
      console.log('  per-row proctor_keys: byte-identical across replays ✓');
    }
  }
})();

// ============================================================
// 8) Final aggregation.
//
// Branches 2, 3, 4 + determinism are expected to PASS on F.
// Branch 1 is expected to FAIL on F (the failure IS the pre-fix bug
// witness — singleton classLowerBound = 10 > LB_global+1 = 6).
// After Task 5 lands, all four branches PASS on F'.
// ============================================================

console.log('\n[singleton-class-bounds-monotonicity] summary:');
console.log('  failures: ' + failures.length);
if (failures.length > 0) {
  console.log('\nFAILURES:');
  for (var fi = 0; fi < failures.length; fi++) {
    console.log('  [' + (fi + 1) + '] ' + failures[fi]);
  }
  // Exit non-zero with the first counterexample as the headline.
  // Pre-fix on F: branch 1 contributes the failure(s); branches 2/3/4
  // and determinism produce no failures. Post-fix on F' (after Task 5):
  // failures should be empty.
  assert.fail(
    '[monotonicity] ' + failures.length + ' assertion(s) failed. ' +
    'On F (UNFIXED): branch 1 is expected to fail (bug witness — ' +
    'cap rule not yet implemented). Branches 2, 3, 4 + determinism ' +
    'are expected to pass. On F\' (post-Task-5): all four branches + ' +
    'determinism MUST pass.\n\n' +
    'First failure: ' + failures[0]
  );
}

console.log('\n[singleton-class-bounds-monotonicity] PASS');
console.log('  Property 2 — one-sided monotonicity (branches 2, 3, 4 ' +
  'preserved byte-identically; branch 1 capped post-fix). ' +
  'Determinism preserved across two replays of tests/fixtures/45454.json.');
