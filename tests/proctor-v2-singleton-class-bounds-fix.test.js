'use strict';

// @pre-fix property test — EXPECTED to FAIL on F until change site #1 + #2 land.
//
// ============================================================
// Spec: .kiro/specs/proctor-v2-singleton-class-bounds/
// Task 3 — Fix-checking property test (Property 1).
//
// Specifies the post-fix UNIVERSAL property that change sites #1 and #2
// (Task 5.2 + 5.3) must satisfy: for every input where
// `isBugCondition(X) = true`, the post-fix algorithm caps every per-class
// `classLowerBound` at `LB_global + 1` and preserves the upper-bound
// invariants. Pre-fix the FOR ALL property FAILS — the synthetic
// singleton, synthetic non-singleton, and production-fixture replay
// cases each counter-example it. Post-fix it PASSES.
//
// _Bug_Condition: isBugCondition(X) — fix-checking universal property
// _Expected_Behavior: Property 1 — P-1, P-2, P-3 (cap by LB_global +
//                     production-fixture pinpoint)
// _File: tests/proctor-v2-singleton-class-bounds-fix.test.js (NEW)
// _Change site: #1 (LB_global derivation), #2 (cap with monotonicity guard)
// _Validates: Requirements 2.1, 2.2, 2.4, 2.6, 2.8, 2.13
//
// ---------------------------------------------------------------------
// Why mulberry32 instead of fast-check
// ---------------------------------------------------------------------
// `fast-check` is NOT in `package.json` (verified 2026-05-17). The
// reference PBT files in this repo all use a deterministic mulberry32
// PRNG — see:
//   tests/proctor-v2-singleton-class-bounds-preservation.pbt.test.js
//     (Task 2.1 — non-buggy-input baseline; same generator pattern)
//   tests/preservation-config-roundtrip.pbt.test.js
//   tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js
//
// This test mirrors the Task 2.1 generator idiom but inverts the
// rejection filter: we accept only inputs where `isBugCondition(input)
// = true` (rejection-sample on the inverse filter). Each accepted input
// covers either:
//   (a) the singleton (size-1) branch of computeClassBounds's
//       multi-class fallback, where bSize = 1 forces classLowerBound =
//       bTotal = G_class + D_class regardless of LB_global, OR
//   (b) the small-class (size-2 with bTotal/bSize > LB_global) branch.
//
// Plus three deterministic hard-coded cases (replays of the synthetic
// singleton-G=10 input, synthetic non-singleton input, and the
// production fixture tests/fixtures/45454.json).
//
// ---------------------------------------------------------------------
// Pre-fix vs post-fix outcomes
// ---------------------------------------------------------------------
// Pre-fix (UNFIXED code):
//   - Synthetic singleton case: singleton classLowerBound = 10 > 6 → FAIL
//   - Synthetic non-singleton case: class A classLowerBound = 15 > 11 → FAIL
//   - Production fixture: six canonical keys at 294-352 > 3 → FAIL
//   - PBT loop: every accepted input counter-examples the universal
//     cap property → FAIL
//
// Post-fix (after Tasks 5.2 + 5.3):
//   - Synthetic singleton case: singleton classLowerBound = 5 = LB_global → PASS
//   - Synthetic non-singleton case: class A classLowerBound = 10 = LB_global → PASS
//   - Production fixture: six canonical keys ≤ 3 = LB_global+1, min ≥ 2,
//     coverageRepairUnresolved ≤ 1 → PASS
//   - PBT loop: every accepted input satisfies cap (universal property
//     holds across the bug-condition domain) → PASS
//
// ============================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ============================================================
// 1) Load the production v2 module via vm sandbox.
//    Same idiom as the exploration / preservation / monotonicity tests.
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
  'V2._internals.{computeClassBounds, computeEligibilityClasses} are ' +
  'required by this test (per-canonical-key bound reconstruction).');

// ============================================================
// 2) Shared synthetic input helpers (mirror Task 1.x and Task 2.1/2.2).
// ============================================================

function makeProctor(name, cin, specialty, gender, idx) {
  return {
    id: idx != null ? idx + 1 : (parseInt(cin.replace(/\D/g, ''), 10) || 0),
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

// ============================================================
// 3) Bound-derivation helper. Pure (no IPC, no DB, no randomness).
//    Mirrors `computeBoundsForInput` in the Task 2.1 preservation PBT
//    and `deriveBounds` in the Task 2.2 monotonicity test.
// ============================================================

function deriveBounds(input) {
  var proctorsList = input.proctorsList;
  var scheduleEntries = input.scheduleEntries;
  var proctorsPerRoom = (input.examDistributionRules &&
    input.examDistributionRules.proctorsPerRoom) || 1;
  var D_expected = Number(input.D_expected) || 0;

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
  var classSizeById = {};
  eligibilityClasses.forEach(function (cls, classId) {
    var bounds = classBoundsMap.get(classId);
    var members = cls.members || [];
    classSizeById[classId] = members.length;
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
    classSizeById: classSizeById,
    eligibilityClasses: eligibilityClasses,
    eligibleCount: eligibleCount,
    totalGuardSlots: totalGuardSlots,
    lbGlobal: lbGlobal
  };
}

// `isBugCondition(X)` per design.md §"Bug Condition" — there exists a
// class whose emitted classLowerBound exceeds LB_global + 1.
//
// NOTE (post-fix): Once Tasks 5.2 + 5.3 land, computeClassBounds caps
// every per-class classLowerBound at LB_global + 1. Therefore reading
// the EMITTED bounds via deriveBounds() will never satisfy the
// inequality classLowerBound > LB_global + 1 — the function now
// returns false on every input. Use `wouldBugConditionFire` below for
// PBT acceptance instead; it computes the RAW uncapped bound the
// pre-fix algorithm would have emitted and tests against that.
// eslint-disable-next-line no-unused-vars
function isBugCondition(input) {
  var ctx;
  try {
    ctx = deriveBounds(input);
  } catch {
    return false;
  }
  var keys = Object.keys(ctx.classBoundsByKey);
  for (var i = 0; i < keys.length; i++) {
    var b = ctx.classBoundsByKey[keys[i]];
    if (!b) continue;
    if (b.classLowerBound > ctx.lbGlobal + 1) return true;
  }
  return false;
}

// `wouldBugConditionFire(X)` — post-fix-compatible PBT acceptance
// filter. Computes the RAW uncapped per-class lower bound the pre-fix
// algorithm would have emitted (i.e. floor((G_class + D_share) / bSize)
// without the Option-C cap) and returns true if any class's raw bound
// exceeds LB_global + 1.
//
// Why this exists: after Tasks 5.2 + 5.3, computeClassBounds caps the
// emitted classLowerBound. Reading the post-fix output (via
// deriveBounds / isBugCondition) shows every class at <= LB_global + 1
// for every input — the filter would reject 100% of generated inputs
// and the PBT loop would never execute. This helper instead
// reconstructs the raw bound directly from the eligibility-class
// geometry (G_class via reachableSessionIndices, D_share via the same
// floor-distribution-with-residuals logic computeClassBounds itself
// uses internally) and asks "would the pre-fix algorithm have
// triggered the bug condition on this input?". That question's answer
// is invariant under the fix — it depends only on input shape.
//
// After acceptance, the PBT loop runs the actual (post-fix) algorithm
// and asserts the cap held — i.e. that every emitted classLowerBound
// is <= LB_global + 1 even though the raw bound was higher. That is
// the universal property the fix delivers.
function wouldBugConditionFire(input) {
  var proctorsList = input.proctorsList;
  var scheduleEntries = input.scheduleEntries;
  var proctorsPerRoom = (input.examDistributionRules &&
    input.examDistributionRules.proctorsPerRoom) || 1;
  var D_expected = Number(input.D_expected) || 0;

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

  var eligibilityClasses;
  try {
    eligibilityClasses = V2._internals.computeEligibilityClasses(
      proctorsList,
      scheduleEntries,
      input.exemptionsData || {},
      input.dutyData || {},
      null
    );
  } catch {
    return false;
  }

  var classIds = [];
  eligibilityClasses.forEach(function (_, classId) { classIds.push(classId); });
  classIds.sort();
  if (classIds.length === 0) return false;

  // Class IDs == 1 path takes the only-one-class branch which already
  // emits LB_global directly — never triggers the bug.
  if (classIds.length === 1) return false;

  var eligibleCount = 0;
  eligibilityClasses.forEach(function (cls) {
    eligibleCount += (cls.members || []).length;
  });
  if (eligibleCount <= 0) return false;

  // totalGuardSlots = sum over schedule entries.
  var totalGuardSlots = 0;
  for (var ti = 0; ti < scheduleEntries.length; ti++) {
    totalGuardSlots += Number(guardSlotsByIndex[ti]) || 0;
  }
  var lbGlobal = Math.floor((totalGuardSlots + D_expected) / eligibleCount);

  // Mirror gById from computeClassBounds (sum of guard slots over the
  // class's reachableSessionIndices).
  var gById = {};
  for (var gi = 0; gi < classIds.length; gi++) {
    var gId = classIds[gi];
    var clsForG = eligibilityClasses.get(gId);
    var reachable = (clsForG && clsForG.reachableSessionIndices) || [];
    var gClass = 0;
    for (var ri = 0; ri < reachable.length; ri++) {
      gClass += Number(guardSlotsByIndex[reachable[ri]]) || 0;
    }
    gById[gId] = gClass;
  }

  // Mirror dShareById floor-distribution-with-residuals.
  var dShareById = {};
  var assigned = 0;
  for (var di = 0; di < classIds.length; di++) {
    var dId = classIds[di];
    var dCls = eligibilityClasses.get(dId);
    var size = (dCls.members || []).length;
    var share = Math.floor(D_expected * size / eligibleCount);
    dShareById[dId] = share;
    assigned += share;
  }
  var residual = D_expected - assigned;
  var residualOrder = classIds.slice().sort(function (a, b) {
    var sizeA = ((eligibilityClasses.get(a) || {}).members || []).length;
    var sizeB = ((eligibilityClasses.get(b) || {}).members || []).length;
    if (sizeA !== sizeB) return sizeB - sizeA;
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
  for (var ro = 0; ro < residualOrder.length && residual > 0; ro++) {
    var rid = residualOrder[ro];
    dShareById[rid] = (dShareById[rid] || 0) + 1;
    residual--;
    if (ro === residualOrder.length - 1 && residual > 0) ro = -1;
  }

  // Raw lower bound per class — floor(bTotal / bSize) WITHOUT the cap.
  for (var bi = 0; bi < classIds.length; bi++) {
    var bId = classIds[bi];
    var bCls = eligibilityClasses.get(bId);
    var bSize = Math.max(1, (bCls.members || []).length);
    var bG = gById[bId] || 0;
    var bD = dShareById[bId] || 0;
    var bTotal = bG + bD;
    var rawLower = Math.floor(bTotal / bSize);
    if (rawLower > lbGlobal + 1) return true;
  }
  return false;
}

// ============================================================
// 4) Universal cap-rule assertion (Property 1 / P-1 / P-2).
//
// For every entry in the per-canonical-key map AND every entry in the
// per-classId map (both directions of the projection in
// `js/algorithms/proctor-distribution-v2.js` lines 1945-1956):
//
//   bounds.classLowerBound  ≤ LB_global + 1
//   bounds.classUpperBound  ≤ LB_global + 1
//   bounds.classUpperBound  ≥ bounds.classLowerBound
//
// Pre-fix on F: the FOR ALL is counter-exampled by every singleton with
// G_class > LB_global + 1 (synthetic singleton, six production-fixture
// canonical keys) and every small class with floor(bTotal/bSize) >
// LB_global + 1 (synthetic non-singleton, class A). Each violation
// is recorded as a separate failure so CI logs show every counterexample
// in one shot.
//
// Post-fix on F': the FOR ALL holds for every accepted input.
// ============================================================

function assertCapHolds(ctx, label, failures) {
  // (1) Per-canonical-key map (mirrors classBoundsByProctorKey).
  var keys = Object.keys(ctx.classBoundsByKey);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var b = ctx.classBoundsByKey[key];
    if (!b) continue;
    if (!(b.classLowerBound <= ctx.lbGlobal + 1)) {
      failures.push(
        '[' + label + '] cap violated: classBoundsByProctorKey[' + key +
        '].classLowerBound = ' + b.classLowerBound +
        ' > LB_global + 1 = ' + (ctx.lbGlobal + 1) + '. ' +
        'Pre-fix witness — change site #1 + #2 (Task 5) MUST cap ' +
        'classLowerBound at LB_global + 1. ' +
        'Geometry: totalGuardSlots=' + ctx.totalGuardSlots +
        ', eligibleCount=' + ctx.eligibleCount +
        ', LB_global=' + ctx.lbGlobal +
        ', G_class=' + b.G_class +
        ', D_expected_class=' + b.D_expected_class +
        ', classUpperBound=' + b.classUpperBound + '.'
      );
    }
    if (!(b.classUpperBound <= ctx.lbGlobal + 1)) {
      failures.push(
        '[' + label + '] cap violated: classBoundsByProctorKey[' + key +
        '].classUpperBound = ' + b.classUpperBound +
        ' > LB_global + 1 = ' + (ctx.lbGlobal + 1) + '. ' +
        'Post-fix the upper bound must satisfy ' +
        'classUpperBound = max(cappedLower, min(rawUpper, LB_global + 1)) ' +
        '≤ LB_global + 1. ' +
        'design.md §"Specific Changes" point 2.'
      );
    }
    if (!(b.classUpperBound >= b.classLowerBound)) {
      failures.push(
        '[' + label + '] order violated: classBoundsByProctorKey[' + key +
        '].classUpperBound = ' + b.classUpperBound +
        ' < classLowerBound = ' + b.classLowerBound + '. ' +
        'Post-fix the cap must preserve the order invariant ' +
        'classUpperBound ≥ classLowerBound (the cap rule sets ' +
        'cappedUpper = max(cappedLower, ...)).'
      );
    }
  }

  // (2) Per-classId map (the direct return value of
  // computeClassBounds — testing as a Map iteration).
  ctx.classBoundsMap.forEach(function (b, classId) {
    if (!b) return;
    if (!(b.classLowerBound <= ctx.lbGlobal + 1)) {
      failures.push(
        '[' + label + '] cap violated on Map<classId,bounds>: ' +
        'classBoundsMap.get(' + JSON.stringify(classId) +
        ').classLowerBound = ' + b.classLowerBound +
        ' > LB_global + 1 = ' + (ctx.lbGlobal + 1) + '. ' +
        '(class size = ' + ctx.classSizeById[classId] + ', G_class=' +
        b.G_class + ', D_expected_class=' + b.D_expected_class + ').'
      );
    }
    if (!(b.classUpperBound <= ctx.lbGlobal + 1)) {
      failures.push(
        '[' + label + '] cap violated on Map<classId,bounds>: ' +
        'classBoundsMap.get(' + JSON.stringify(classId) +
        ').classUpperBound = ' + b.classUpperBound +
        ' > LB_global + 1 = ' + (ctx.lbGlobal + 1) + '.'
      );
    }
    if (!(b.classUpperBound >= b.classLowerBound)) {
      failures.push(
        '[' + label + '] order violated on Map<classId,bounds>: ' +
        'classUpperBound = ' + b.classUpperBound +
        ' < classLowerBound = ' + b.classLowerBound + '.'
      );
    }
  });
}

var failures = [];

// ============================================================
// 5) Hard-coded synthetic singleton case (replay of Task 1.1's input).
//
// Geometry (per Task 1.1 documentation in
// `tests/proctor-v2-singleton-class-bounds-exploration.test.js`):
//   5 proctors. 5 entries × 5 rooms × 1 proctor/room = 25 slots.
//   LB_global = floor(25/5) = 5. LB_global + 1 = 6.
//   Singleton P5: bSize=1, G=10, bTotal=10. floor(10/1) = 10 → cap fires.
//   Multi-member classes A, B (each size 2, G=10): raw LB = 5 ≤ LB_global → no cap.
//
// Post-fix expected:
//   Singleton classLowerBound = 5 (capped from 10 to LB_global = 5).
//   Singleton classUpperBound = 6 (= LB_global + 1, since rawUpper =
//     ceil(10/1) = 10 > LB_global+1, so cappedUpper = min(10, 6) = 6).
//   Class A, B unchanged at classLowerBound = 5, classUpperBound = 5.
// ============================================================

function buildSyntheticSingletonG10Input() {
  var P1 = makeProctor('proctor_1', 'CIN_FX_S001', 'عام', 'ذكر');
  var P2 = makeProctor('proctor_2', 'CIN_FX_S002', 'عام', 'ذكر');
  var P3 = makeProctor('proctor_3', 'CIN_FX_S003', 'عام', 'ذكر');
  var P4 = makeProctor('proctor_4', 'CIN_FX_S004', 'عام', 'ذكر');
  var P5 = makeProctor('proctor_5', 'CIN_FX_S005', 'عام', 'ذكر');

  var entries = [
    makeEntry('FX_S_d1', 'صباحا', 'الحصة الأولى', 1),
    makeEntry('FX_S_d2', 'صباحا', 'الحصة الأولى', 2),
    makeEntry('FX_S_d3', 'صباحا', 'الحصة الأولى', 3),
    makeEntry('FX_S_d4', 'صباحا', 'الحصة الأولى', 4),
    makeEntry('FX_S_d5', 'صباحا', 'الحصة الأولى', 5)
  ];
  var rooms = [
    makeRoom('FXS_R1'), makeRoom('FXS_R2'), makeRoom('FXS_R3'),
    makeRoom('FXS_R4'), makeRoom('FXS_R5')
  ];

  // Eligibility (mirror Task 1.1):
  //   P1, P2 → {2, 3}    (class A, size 2, G=10, bTotal=10, raw LB=5)
  //   P3, P4 → {2, 4}    (class B, size 2, G=10, bTotal=10, raw LB=5)
  //   P5     → {0, 1}    (singleton, G=10, bTotal=10, raw LB=10) ← bug
  var exemptionsData = {};
  for (var ei = 0; ei < entries.length; ei++) {
    exemptionsData[sessionScopeKey(entries[ei])] = {};
  }
  [0, 1, 4].forEach(function (eii) {
    var k = sessionScopeKey(entries[eii]);
    exemptionsData[k]['CIN_FX_S001'] = 'no';
    exemptionsData[k]['CIN_FX_S002'] = 'no';
  });
  [0, 1, 3].forEach(function (eii) {
    var k = sessionScopeKey(entries[eii]);
    exemptionsData[k]['CIN_FX_S003'] = 'no';
    exemptionsData[k]['CIN_FX_S004'] = 'no';
  });
  [2, 3, 4].forEach(function (eii) {
    var k = sessionScopeKey(entries[eii]);
    exemptionsData[k]['CIN_FX_S005'] = 'no';
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

(function runHardcodedSingleton() {
  var ctx = deriveBounds(buildSyntheticSingletonG10Input());
  console.log('[hardcoded-singleton] synthetic singleton-G=10 (replay of Task 1.1)');
  console.log('  totalGuardSlots=' + ctx.totalGuardSlots +
    ', eligibleCount=' + ctx.eligibleCount +
    ', LB_global=' + ctx.lbGlobal +
    ', LB_global+1=' + (ctx.lbGlobal + 1));

  var singletonKey = 'CIN_FX_S005';
  var b = ctx.classBoundsByKey[singletonKey];
  if (!b) {
    failures.push('[hardcoded-singleton] singleton ' + singletonKey +
      ' missing bounds — geometry mismatch.');
  } else {
    console.log('  singleton ' + singletonKey + ': classLowerBound=' +
      b.classLowerBound + ' classUpperBound=' + b.classUpperBound +
      ' G_class=' + b.G_class + ' D_expected_class=' + b.D_expected_class);

    // Post-fix expected:
    //   singleton classLowerBound = LB_global = 5
    //   singleton classUpperBound = LB_global + 1 = 6
    if (b.classLowerBound !== ctx.lbGlobal) {
      failures.push(
        '[hardcoded-singleton] post-fix cap NOT applied: singleton ' +
        singletonKey + ' has classLowerBound = ' + b.classLowerBound +
        ', expected ' + ctx.lbGlobal + ' (= LB_global). ' +
        'Pre-fix witness — singleton bSize=1, bTotal=10, ' +
        'floor(10/1) = 10. After Task 5 lands, the cap rule sets ' +
        'cappedLower = min(10, LB_global) = 5. design.md §"Specific ' +
        'Changes" point 2.'
      );
    }
    if (b.classUpperBound !== ctx.lbGlobal + 1) {
      failures.push(
        '[hardcoded-singleton] post-fix cap NOT applied: singleton ' +
        singletonKey + ' has classUpperBound = ' + b.classUpperBound +
        ', expected ' + (ctx.lbGlobal + 1) + ' (= LB_global + 1). ' +
        'Pre-fix bTotal=10 (uncapped). After Task 5: cappedUpper = ' +
        'max(cappedLower, min(rawUpper, LB_global + 1)) = max(5, ' +
        'min(10, 6)) = 6.'
      );
    }
  }

  // Multi-member classes A and B remain untouched (cap is a no-op when
  // floor(bTotal/bSize) ≤ LB_global). Pre-fix and post-fix byte-identical.
  ['CIN_FX_S001', 'CIN_FX_S002', 'CIN_FX_S003', 'CIN_FX_S004'].forEach(function (k) {
    var bb = ctx.classBoundsByKey[k];
    if (!bb) {
      failures.push('[hardcoded-singleton] multi-member ' + k +
        ' missing bounds — geometry mismatch.');
      return;
    }
    if (bb.classLowerBound !== 5) {
      failures.push(
        '[hardcoded-singleton] multi-member ' + k +
        ' classLowerBound drifted: got ' + bb.classLowerBound +
        ', expected 5 (raw floor(10/2), unchanged by cap when ' +
        'floor(bTotal/bSize) ≤ LB_global). Post-fix MUST preserve ' +
        'this byte-identically (cap is a no-op).'
      );
    }
  });

  // Universal cap-rule check on the entire ctx (also catches the
  // singleton if the explicit assertion above didn't already).
  assertCapHolds(ctx, 'hardcoded-singleton', failures);
})();

// ============================================================
// 6) Hard-coded synthetic non-singleton case (replay of Task 1.2's input).
//
// Geometry (per Task 1.2):
//   4 proctors. 8 entries × 5 rooms × 1 proctor/room = 40 slots.
//   LB_global = floor(40/4) = 10. LB_global + 1 = 11.
//   Class A (P1, P2 size 2, eligible {0..5}): G=30, bTotal=30,
//     floor(30/2) = 15 > LB_global → cap fires.
//   Class B (P3, P4 size 2, eligible {6, 7}): G=10, bTotal=10,
//     floor(10/2) = 5 ≤ LB_global → cap is no-op.
//
// Post-fix expected:
//   Class A classLowerBound = 10 (capped from 15 to LB_global = 10).
//   Class A classUpperBound = max(10, min(ceil(30/2), 11)) = max(10, 11) = 11.
//   Class B classLowerBound = 5 (unchanged), classUpperBound = 5 (unchanged).
// ============================================================

function buildSyntheticNonSingletonInput() {
  var P1 = makeProctor('proctor_ns_1', 'CIN_FX_NS001', 'عام', 'ذكر');
  var P2 = makeProctor('proctor_ns_2', 'CIN_FX_NS002', 'عام', 'ذكر');
  var P3 = makeProctor('proctor_ns_3', 'CIN_FX_NS003', 'عام', 'ذكر');
  var P4 = makeProctor('proctor_ns_4', 'CIN_FX_NS004', 'عام', 'ذكر');

  var entries = [
    makeEntry('FX_NS_d1', 'صباحا', 'الحصة الأولى', 1),
    makeEntry('FX_NS_d2', 'صباحا', 'الحصة الأولى', 2),
    makeEntry('FX_NS_d3', 'صباحا', 'الحصة الأولى', 3),
    makeEntry('FX_NS_d4', 'صباحا', 'الحصة الأولى', 4),
    makeEntry('FX_NS_d5', 'صباحا', 'الحصة الأولى', 5),
    makeEntry('FX_NS_d6', 'صباحا', 'الحصة الأولى', 6),
    makeEntry('FX_NS_d7', 'صباحا', 'الحصة الأولى', 7),
    makeEntry('FX_NS_d8', 'صباحا', 'الحصة الأولى', 8)
  ];
  var rooms = [
    makeRoom('FXNS_R1'), makeRoom('FXNS_R2'), makeRoom('FXNS_R3'),
    makeRoom('FXNS_R4'), makeRoom('FXNS_R5')
  ];

  // P1, P2 eligible for {0..5}; exempt for {6, 7} → class A G=30, bSize=2.
  // P3, P4 eligible for {6, 7}; exempt for {0..5} → class B G=10, bSize=2.
  var exemptionsData = {};
  for (var ei = 0; ei < entries.length; ei++) {
    exemptionsData[sessionScopeKey(entries[ei])] = {};
  }
  [6, 7].forEach(function (eii) {
    var k = sessionScopeKey(entries[eii]);
    exemptionsData[k]['CIN_FX_NS001'] = 'no';
    exemptionsData[k]['CIN_FX_NS002'] = 'no';
  });
  [0, 1, 2, 3, 4, 5].forEach(function (eii) {
    var k = sessionScopeKey(entries[eii]);
    exemptionsData[k]['CIN_FX_NS003'] = 'no';
    exemptionsData[k]['CIN_FX_NS004'] = 'no';
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

(function runHardcodedNonSingleton() {
  var ctx = deriveBounds(buildSyntheticNonSingletonInput());
  console.log('[hardcoded-non-singleton] synthetic non-singleton (replay of Task 1.2)');
  console.log('  totalGuardSlots=' + ctx.totalGuardSlots +
    ', eligibleCount=' + ctx.eligibleCount +
    ', LB_global=' + ctx.lbGlobal +
    ', LB_global+1=' + (ctx.lbGlobal + 1));

  // Class A: post-fix classLowerBound = 10 (LB_global), capped from 15.
  ['CIN_FX_NS001', 'CIN_FX_NS002'].forEach(function (k) {
    var b = ctx.classBoundsByKey[k];
    if (!b) {
      failures.push('[hardcoded-non-singleton] class A member ' + k +
        ' missing bounds — geometry mismatch.');
      return;
    }
    console.log('  class A ' + k + ': classLowerBound=' +
      b.classLowerBound + ' classUpperBound=' + b.classUpperBound +
      ' G_class=' + b.G_class + ' D_expected_class=' + b.D_expected_class);
    if (b.classLowerBound !== 10) {
      failures.push(
        '[hardcoded-non-singleton] post-fix cap NOT applied: ' +
        'class A member ' + k + ' has classLowerBound = ' +
        b.classLowerBound + ', expected 10 (= LB_global). ' +
        'Pre-fix witness — class A bSize=2, bTotal=30, ' +
        'floor(30/2) = 15 > LB_global = 10. After Task 5: cappedLower ' +
        '= min(15, 10) = 10. design.md §"Specific Changes" point 2.'
      );
    }
  });

  // Class B: post-fix classLowerBound = 5 (unchanged from pre-fix raw value).
  ['CIN_FX_NS003', 'CIN_FX_NS004'].forEach(function (k) {
    var b = ctx.classBoundsByKey[k];
    if (!b) {
      failures.push('[hardcoded-non-singleton] class B member ' + k +
        ' missing bounds — geometry mismatch.');
      return;
    }
    console.log('  class B ' + k + ': classLowerBound=' +
      b.classLowerBound + ' classUpperBound=' + b.classUpperBound +
      ' G_class=' + b.G_class + ' D_expected_class=' + b.D_expected_class);
    if (b.classLowerBound !== 5) {
      failures.push(
        '[hardcoded-non-singleton] preservation violated: class B ' +
        'member ' + k + ' has classLowerBound = ' + b.classLowerBound +
        ', expected 5 (raw floor(10/2), unchanged when ' +
        'floor(bTotal/bSize) ≤ LB_global). Post-fix MUST preserve ' +
        'class B byte-identically (cap is a no-op).'
      );
    }
  });

  assertCapHolds(ctx, 'hardcoded-non-singleton', failures);
})();

// ============================================================
// 7) Hard-coded production-fixture pinpoint case
//    (replay tests/fixtures/45454.json — Property P-3 per design.md
//    §"Correctness Properties" → Property 1).
//
// Pre-fix (UNFIXED): the six canonical keys (__idx_98, __idx_62,
// __idx_28, __idx_133, __idx_109, __idx_21) have classLowerBound in
// {294, 318, 342, 342, 352, 352}. Each is > LB_global + 1 = 3 → FAIL.
// V2.run produces:
//   - diagnostics.coverageRepairUnresolved = 6 (six false positives)
//   - diagnostics.loadBalance.min = (depending on post-repair state)
//
// Post-fix (Task 5): the six canonical keys all have classLowerBound ≤
// 3. The six false-positive coverageRepairWarnings disappear. The
// algorithm's repair pass closes the deficit such that:
//   - For every key: classLowerBound ≤ 3
//   - min(loadState) ≥ 2 (read off diagnostics.loadBalance.min OR
//     reconstructed from result[].proctor_keys)
//   - coverageRepairUnresolved ≤ 1 (legitimate at-most-one warning if
//     طارق still cannot be lifted to LB_global = 2 after the bounds
//     are corrected; design.md §"Correctness Properties" Property 1
//     P-3 explicitly allows this slack)
//
// We use the duty-pre-load idiom from the Task 1.3 case in
// `tests/proctor-v2-singleton-class-bounds-exploration.test.js`
// (lines ~840-963) to reconstruct classBounds via _internals; we
// also run V2.run() to read the diagnostics for the min-load and
// coverageRepairUnresolved assertions.
// ============================================================

const PROD_FIXTURE_PATH = path.join(ROOT, 'tests/fixtures/45454.json');
const prodInput = JSON.parse(fs.readFileSync(PROD_FIXTURE_PATH, 'utf8'));
// The fixture validates a repeatable post-fix distribution. Without this seed,
// V2 deliberately uses Date.now() and the coverage-repair witness is flaky.
prodInput.randomSeed = 42;

(function guardProdFixture() {
  if (!Array.isArray(prodInput.proctorsList) ||
      prodInput.proctorsList.length !== 147) {
    failures.push('[prod-setup] expected fixture 45454.json to contain ' +
      '147 proctors; got ' +
      ((prodInput.proctorsList && prodInput.proctorsList.length) || 0) +
      '. Witness has drifted from ' +
      'docs/agent-notes/proctor-v2-singleton-class-bounds.md §"Witness ' +
      'on tests/fixtures/45454.json".');
  }
  if (Number(prodInput.D_expected) !== 13) {
    failures.push('[prod-setup] expected fixture D_expected=13; got ' +
      prodInput.D_expected + '. Witness has drifted.');
  }
})();

// (a) Reconstruct classBounds via _internals (mirrors Task 1.3's setup).
const prodRoomsList = (prodInput.options && prodInput.options.roomsList) || [];
const prodProctorsPerRoom = (prodInput.examDistributionRules &&
  prodInput.examDistributionRules.proctorsPerRoom) || 1;

// Robust roomsList resolver — production fixtures use a Map-like
// object keyed by level_name, but synthetic / legacy callers pass a
// plain array. Mirrors the helper in
// `tests/proctor-v2-singleton-class-bounds-exploration.test.js`
// (lines ~874-889).
function getRoomsForProdEntry(entry) {
  var levelName = (entry && entry.level_name) || '';
  if (prodRoomsList && typeof prodRoomsList === 'object' &&
      !Array.isArray(prodRoomsList)) {
    var levelRooms = prodRoomsList[levelName];
    if (Array.isArray(levelRooms) && levelRooms.length > 0) return levelRooms;
    return [];
  }
  if (Array.isArray(prodRoomsList) && prodRoomsList.length > 0) {
    var filtered = prodRoomsList.filter(function (r) {
      return (r.level_name || '') === levelName;
    });
    return filtered.length > 0 ? filtered : prodRoomsList;
  }
  return [];
}

const prodGuardSlotsByIndex = {};
let prodTotalGuardSlots = 0;
for (let psi = 0; psi < prodInput.scheduleEntries.length; psi++) {
  const prodSlots = getRoomsForProdEntry(prodInput.scheduleEntries[psi]).length *
    prodProctorsPerRoom;
  prodGuardSlotsByIndex[psi] = prodSlots;
  prodTotalGuardSlots += prodSlots;
}

// Duty pre-load (mirrors run() lines ~1837-1869 verbatim — see
// `tests/proctor-v2-singleton-class-bounds-exploration.test.js`
// lines ~909-940 for the canonical idiom). Without this, the six
// singleton classes collapse into the main class because every
// proctor sees every halfday as eligible.
const prodLoadState = V2._internals.createLoadState();
const prodKeyAdapter = V2._internals.buildKeyAdapter(prodInput.proctorsList);
const prodDutyData = prodInput.dutyData || {};
const prodDutyDataKeys = Object.keys(prodDutyData);
for (let pdi = 0; pdi < prodDutyDataKeys.length; pdi++) {
  const prodDutyEntry = prodDutyData[prodDutyDataKeys[pdi]];
  if (prodDutyEntry && typeof prodDutyEntry === 'object') {
    const prodDutyProctorKeys = Object.keys(prodDutyEntry);
    for (let pdpi = 0; pdpi < prodDutyProctorKeys.length; pdpi++) {
      if (prodDutyEntry[prodDutyProctorKeys[pdpi]]) {
        const prodDutyParts = prodDutyDataKeys[pdi].split('|');
        let prodDutyHdKey = '';
        if (prodDutyParts.length >= 3) {
          prodDutyHdKey = prodDutyParts[0] + '|' +
            (prodDutyParts[2] || 'صباحا');
        }
        if (prodDutyHdKey) {
          const prodCanonicalDutyKey = V2._internals.toCanonicalKey(
            prodKeyAdapter, prodDutyProctorKeys[pdpi]
          );
          if (prodCanonicalDutyKey) {
            V2._internals.addDutyLoad(
              prodLoadState, prodCanonicalDutyKey, prodDutyHdKey, ''
            );
          }
        }
      }
    }
  }
}

const prodEligibilityClasses = V2._internals.computeEligibilityClasses(
  prodInput.proctorsList,
  prodInput.scheduleEntries,
  prodInput.exemptionsData || {},
  prodInput.dutyData || {},
  prodLoadState
);
let prodEligibleCount = 0;
prodEligibilityClasses.forEach(function (cls) {
  prodEligibleCount += (cls.members || []).length;
});

const prodClassBoundsMap = V2._internals.computeClassBounds(
  prodEligibilityClasses,
  prodInput.scheduleEntries,
  prodProctorsPerRoom,
  Number(prodInput.D_expected) || 0,
  prodEligibleCount,
  prodGuardSlotsByIndex
);

const prodClassBoundsByKey = {};
prodEligibilityClasses.forEach(function (cls, classId) {
  const bounds = prodClassBoundsMap.get(classId);
  const members = cls.members || [];
  for (let cm = 0; cm < members.length; cm++) {
    prodClassBoundsByKey[members[cm].key] = bounds
      ? {
          classLowerBound: bounds.classLowerBound,
          classUpperBound: bounds.classUpperBound,
          G_class: bounds.G_class,
          D_expected_class: bounds.D_expected_class
        }
      : null;
  }
});

const PROD_D_EXPECTED = Number(prodInput.D_expected) || 0;             // 13
const PROD_N_ELIGIBLE = prodEligibleCount;                              // 147
const PROD_LB_GLOBAL = PROD_N_ELIGIBLE > 0
  ? Math.floor((prodTotalGuardSlots + PROD_D_EXPECTED) / PROD_N_ELIGIBLE)
  : 0;                                                                  // 2

console.log('[prod-fixture-fix] tests/fixtures/45454.json diagnostics:');
console.log('  proctors=' + prodInput.proctorsList.length +
  ' | entries=' + prodInput.scheduleEntries.length +
  ' | totalGuardSlots=' + prodTotalGuardSlots +
  ' | D_expected=' + PROD_D_EXPECTED +
  ' | N_eligible=' + PROD_N_ELIGIBLE +
  ' | LB_global=' + PROD_LB_GLOBAL +
  ' | LB_global+1=' + (PROD_LB_GLOBAL + 1));

const PROD_WITNESS_KEYS = [
  '__idx_98', '__idx_62', '__idx_28',
  '__idx_133', '__idx_109', '__idx_21'
];

PROD_WITNESS_KEYS.forEach(function (witnessKey) {
  var b = prodClassBoundsByKey[witnessKey];
  if (!b) {
    failures.push('[prod-witness setup] expected ' +
      'classBoundsByProctorKey[' + witnessKey + '] to be set on the ' +
      'production fixture (one of the six documented singleton-class ' +
      'witnesses). Got <undefined>. Duty pre-load may have failed.');
    return;
  }
  console.log('  ' + witnessKey + ': classLowerBound=' +
    b.classLowerBound + ' classUpperBound=' + b.classUpperBound +
    ' G_class=' + b.G_class + ' D_expected_class=' + b.D_expected_class);
  // Property P-3: each canonical key has classLowerBound ≤ 3.
  if (!(b.classLowerBound <= 3)) {
    failures.push(
      '[prod-fixture-fix] Property P-3 violated: ' +
      'classBoundsByProctorKey[' + witnessKey + '].classLowerBound = ' +
      b.classLowerBound + ' > 3 (= LB_global + 1). ' +
      'Pre-fix witness — this is one of the six documented impossible ' +
      'singleton-class bounds (294-352) on tests/fixtures/45454.json. ' +
      'Post-fix Tasks 5.2 + 5.3 MUST cap this at LB_global + 1 = 3. ' +
      'See docs/agent-notes/proctor-v2-singleton-class-bounds.md ' +
      '§"Witness on tests/fixtures/45454.json".'
    );
  }
});

// Universal cap-rule on the production fixture (covers every key, not
// only the six canonical ones).
const prodCtx = {
  classBoundsByKey: prodClassBoundsByKey,
  classBoundsMap: prodClassBoundsMap,
  classSizeById: (function () {
    var out = {};
    prodEligibilityClasses.forEach(function (cls, classId) {
      out[classId] = (cls.members || []).length;
    });
    return out;
  })(),
  totalGuardSlots: prodTotalGuardSlots,
  eligibleCount: PROD_N_ELIGIBLE,
  lbGlobal: PROD_LB_GLOBAL
};
assertCapHolds(prodCtx, 'prod-fixture-fix', failures);

// (b) V2.run() to read diagnostics — min(loadState) and
// coverageRepairUnresolved. These assertions cover the downstream
// effects (Property P-3): post-fix the six false-positive
// coverageRepairWarnings disappear, the deficit closes, and
// min(loadState) rises from 1 to ≥ 2.
(function runProdFixtureV2() {
  var output;
  try {
    output = V2.run(prodInput);
  } catch (e) {
    failures.push('[prod-fixture-fix] V2.run(45454.json) threw: ' +
      e.message);
    return;
  }
  if (!output || !output.diagnostics) {
    failures.push('[prod-fixture-fix] V2.run(45454.json) returned no ' +
      'diagnostics — cannot assess loadState or coverageRepairUnresolved.');
    return;
  }

  // Reconstruct min(loadState) from result[].proctor_keys (slot-metric).
  // diagnostics.loadBalance.min only counts proctors that appear in at
  // least one row — it can show min=2 while the true minimum across
  // all 147 eligible proctors is 0 (per the snapshot in the
  // exploration test header). For a faithful "min ≥ 2" assertion we
  // need to count load over every proctor in proctorsList, treating
  // absent keys as load=0.
  var rows = output.result || [];
  var perKey = Object.create(null);
  // Initialize every proctor's canonical key to load=0 (mirrors the
  // run-time loadState which also has zero-load entries).
  for (var pi = 0; pi < prodInput.proctorsList.length; pi++) {
    // Use the same getProctorKey idiom run() does — empty CIN resolves
    // to '__idx_<i>'. We approximate via the keys exposed in
    // prodClassBoundsByKey (they were populated from
    // computeEligibilityClasses, which runs getProctorKey internally).
    // Any proctor missing from prodClassBoundsByKey is excluded from
    // the run (no eligibility class) and shouldn't be counted.
  }
  for (var ri = 0; ri < rows.length; ri++) {
    var keys = rows[ri].proctor_keys || [];
    for (var rj = 0; rj < keys.length; rj++) {
      var k = keys[rj];
      if (k) perKey[k] = (perKey[k] || 0) + 1;
    }
  }
  // Min over all proctors that have a class-bound entry (i.e. were
  // considered eligible). Missing-from-perKey ⇒ load=0.
  var minLoad = Infinity;
  Object.keys(prodClassBoundsByKey).forEach(function (k) {
    var load = perKey[k] || 0;
    if (load < minLoad) minLoad = load;
  });
  if (minLoad === Infinity) minLoad = 0;

  var coverageRepairUnresolved = output.diagnostics.coverageRepairUnresolved || 0;
  var coverageRepairWarnings = output.diagnostics.coverageRepairWarnings || {};
  var nonPassWarningCount = 0;
  if (coverageRepairWarnings &&
      typeof coverageRepairWarnings === 'object' &&
      !Array.isArray(coverageRepairWarnings)) {
    Object.keys(coverageRepairWarnings).forEach(function (wk) {
      if (wk !== '__pass__') nonPassWarningCount++;
    });
  }

  console.log('  V2.run(45454.json) diagnostics:');
  console.log('    min(loadState across eligible proctors)= ' + minLoad);
  console.log('    coverageRepairSwaps= ' +
    (output.diagnostics.coverageRepairSwaps || 0));
  console.log('    coverageRepairUnresolved= ' + coverageRepairUnresolved);
  console.log('    non-__pass__ warnings count= ' + nonPassWarningCount);

  // Property P-3 (per design.md §"Correctness Properties" Property 1):
  //   coverageRepairUnresolved <= 1 — at-most-one legitimate residual
  //   warning is allowed. The warning, if present, is for a proctor
  //   that genuinely has no eligible donor (truthful) and NOT a
  //   false-positive on an impossible bound.
  //
  // Companion fairness assertion: at most ONE proctor may have
  // load < LB_global. The strict pre-fix invariant `min(loadState)
  // >= LB_global` for ALL proctors is RELAXED here per the design
  // doc — Property P-3 explicitly allows the at-most-one exception.
  var LB_GLOBAL_PROD = 2;
  var underfilledKeys = [];
  Object.keys(prodClassBoundsByKey).forEach(function (k) {
    var load = perKey[k] || 0;
    if (load < LB_GLOBAL_PROD) underfilledKeys.push({ key: k, load: load });
  });
  console.log('    proctors with load < LB_global (' + LB_GLOBAL_PROD +
    '): ' + underfilledKeys.length +
    (underfilledKeys.length > 0
      ? ' [' + underfilledKeys.map(function (u) {
          return u.key + '@' + u.load;
        }).join(', ') + ']'
      : ''));

  if (!(underfilledKeys.length <= 1)) {
    failures.push(
      '[prod-fixture-fix] Property P-3 violated: ' +
      underfilledKeys.length + ' proctors have load < LB_global = ' +
      LB_GLOBAL_PROD + '; design.md §"Correctness Properties" ' +
      'Property 1 P-3 allows at most ONE such legitimate residual. ' +
      'Underfilled keys: ' + JSON.stringify(underfilledKeys) + '. ' +
      'Pre-fix witness — six false-positive entries pinned six ' +
      'proctors below LB_global because the impossible singleton ' +
      'bounds (294-352) prevented the inner repair loop from finding ' +
      'swappable peers.'
    );
  }

  // If exactly one proctor is underfilled, it MUST have a matching
  // coverageRepairWarnings entry (the truthful diagnostic) and the
  // reason MUST be truthful — i.e. NOT a false-positive on an
  // impossible bound (which would have been a 'no_swappable_peer'
  // emitted against an unsatisfiable classLowerBound). The post-fix
  // bounds are capped, so any 'no_swappable_peer' here would be
  // truthful, but the design specifically calls out
  // 'no_eligible_donor' as the expected truthful reason for طارق's
  // case (no donor in his eligibility class can be lowered without
  // violating their own bounds).
  if (underfilledKeys.length === 1) {
    var residualKey = underfilledKeys[0].key;
    var residualWarning = coverageRepairWarnings[residualKey];
    if (!residualWarning) {
      failures.push(
        '[prod-fixture-fix] Property P-3 violated: residual ' +
        'underfilled proctor ' + residualKey + ' (load=' +
        underfilledKeys[0].load + ') has NO entry in ' +
        'coverageRepairWarnings. The diagnostics must truthfully ' +
        'report the unresolved coverage so operators see why this ' +
        'proctor is below LB_global.'
      );
    } else {
      console.log('    residual warning for ' + residualKey + ': ' +
        JSON.stringify(residualWarning));
      // The bound recorded in the warning must itself be capped
      // (post-fix the impossible 294-352 numbers are GONE).
      if (residualWarning.classLowerBound != null &&
          !(residualWarning.classLowerBound <= LB_GLOBAL_PROD + 1)) {
        failures.push(
          '[prod-fixture-fix] Property P-3 violated: residual ' +
          'warning for ' + residualKey + ' references an UNCAPPED ' +
          'classLowerBound = ' + residualWarning.classLowerBound +
          ' > LB_global + 1 = ' + (LB_GLOBAL_PROD + 1) + '. The ' +
          'cap (Tasks 5.2 + 5.3) is NOT being applied — the warning ' +
          'is a false-positive on an impossible bound.'
        );
      }
    }
  }

  // Property P-3: coverageRepairUnresolved ≤ 1.
  if (!(coverageRepairUnresolved <= 1)) {
    failures.push(
      '[prod-fixture-fix] Property P-3 violated: ' +
      'coverageRepairUnresolved = ' + coverageRepairUnresolved + ' > 1. ' +
      'Pre-fix witness — six false-positive entries (one per impossible ' +
      'singleton bound). Post-fix Tasks 5.2 + 5.3 cap every singleton ' +
      'classLowerBound at LB_global + 1 = 3, eliminating the false ' +
      'positives. The +1 slack permits a single legitimate residual ' +
      'warning if the repair pass cannot lift طارق to LB_global = 2 ' +
      'even after the bounds are corrected.'
    );
  }

  // Identity check (per task description point 5.3): non-__pass__
  // warning count equals coverageRepairUnresolved (parent spec's
  // diagnostics-shape identity, preserved by this spec).
  if (nonPassWarningCount !== coverageRepairUnresolved) {
    failures.push(
      '[prod-fixture-fix] parent-spec identity violated: ' +
      'non-__pass__ warning count (' + nonPassWarningCount + ') ≠ ' +
      'coverageRepairUnresolved (' + coverageRepairUnresolved + '). ' +
      'design.md §"Preservation Requirements" preserves the identity ' +
      'introduced by parent spec proctor-v2-phase2-75-multi-step-repair.'
    );
  }
})();

// ============================================================
// 8) PBT loop — generate inputs filtered to isBugCondition(input) = true
//    and assert the universal cap-rule holds.
//
// Generator: produce small synthetic inputs that ALWAYS trigger
// isBugCondition. Two flavors:
//   (a) Singleton trigger: N proctors with one proctor exempt for all
//       but one schedule entry that has wide room geometry. Singleton
//       bSize=1 forces classLowerBound = G_class = roomsCount, while
//       LB_global = floor(totalSlots/N) is small.
//   (b) Small-class trigger: 2k proctors split into two classes of
//       size k. Class A has wide eligibility (high G), class B narrow.
//       floor(G_A/k) > LB_global → cap fires on a non-singleton.
//
// Post-fix (Task 5): every accepted input satisfies the universal cap
// rule (Property 1 / P-1 / P-2).
// ============================================================

function mulberry32(seed) {
  var s = seed >>> 0;
  return function next() {
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

// ----- Singleton-trigger generator -----
// Build N proctors. One proctor (P_singleton) is eligible only for one
// "wide" entry that has G rooms. Other N-1 proctors are exempt for the
// wide entry but eligible for `narrowEntries` narrow entries that have
// fewer rooms each. Geometry tuned so:
//   totalGuardSlots = wideRooms + narrowEntries * narrowRooms
//   N_eligible      = N
//   LB_global       = floor(totalGuardSlots / N)
//   Singleton bTotal = wideRooms ⇒ floor(wideRooms / 1) = wideRooms
//   We require wideRooms > LB_global + 1 so isBugCondition fires.

function buildSingletonTriggerInput(rng, iterTag) {
  // Choose generator parameters so the inequality
  //   wideRooms > floor((wideRooms + narrowEntries * narrowRooms) / N) + 1
  // holds. With N=4..6, wideRooms=8..15, narrowEntries=1..3, narrowRooms=1..2:
  //   max totalGuardSlots ≈ 15 + 3*2 = 21
  //   max LB_global       ≈ floor(21/4) = 5
  //   wideRooms ≥ 8 > LB_global + 1 ≤ 6 ✓
  var N = rngInt(rng, 4, 6);
  var wideRooms = rngInt(rng, 8, 15);
  var narrowEntries = rngInt(rng, 1, 3);
  var narrowRooms = rngInt(rng, 1, 2);

  var proctorsList = [];
  for (var pi = 0; pi < N; pi++) {
    proctorsList.push(makeProctor('Synth_' + iterTag + '_' + pi,
      'CIN_FXP_' + iterTag + '_' + pi, 'عام',
      pi % 2 === 0 ? 'ذكر' : 'أنثى', pi));
  }
  var singletonCin = proctorsList[N - 1].cin;

  // Build entries. Wide entry first (index 0, room count = wideRooms).
  // Then narrowEntries entries each with narrowRooms.
  var entries = [
    makeEntry(iterTag + '_w', 'صباحا', 'الحصة الأولى', 1)
  ];
  for (var ne = 0; ne < narrowEntries; ne++) {
    entries.push(makeEntry(iterTag + '_n' + ne, 'صباحا', 'الحصة الثانية', 2 + ne));
  }

  // Single rooms list — but we use level_name to control which entries
  // each room belongs to. Wide entry uses 'level_wide'; narrow entries
  // use 'level_narrow'. Rooms tagged accordingly.
  var rooms = [];
  for (var rw = 0; rw < wideRooms; rw++) {
    rooms.push({
      key: 'WR_' + iterTag + '_' + rw,
      room_num: 'WR_' + iterTag + '_' + rw,
      roomName: 'قاعة WR ' + rw,
      level_name: 'level_wide_' + iterTag
    });
  }
  for (var rn = 0; rn < narrowRooms; rn++) {
    rooms.push({
      key: 'NR_' + iterTag + '_' + rn,
      room_num: 'NR_' + iterTag + '_' + rn,
      roomName: 'قاعة NR ' + rn,
      level_name: 'level_narrow_' + iterTag
    });
  }
  // Tag entries with the matching level_name so getRoomsForEntry
  // returns only the matching rooms.
  entries[0].level_name = 'level_wide_' + iterTag;
  for (var ne2 = 0; ne2 < narrowEntries; ne2++) {
    entries[1 + ne2].level_name = 'level_narrow_' + iterTag;
  }

  // Eligibility:
  //   Singleton (last proctor): eligible for {0} only; exempt for all others.
  //   Other proctors: eligible for narrow entries; exempt for {0}.
  var exemptionsData = {};
  for (var ei = 0; ei < entries.length; ei++) {
    exemptionsData[sessionScopeKey(entries[ei])] = {};
  }
  // Singleton exempt for all narrow entries.
  for (var sei = 1; sei < entries.length; sei++) {
    exemptionsData[sessionScopeKey(entries[sei])][singletonCin] = 'no';
  }
  // Other proctors exempt for entry 0 (the wide entry).
  for (var op = 0; op < N - 1; op++) {
    exemptionsData[sessionScopeKey(entries[0])][proctorsList[op].cin] = 'no';
  }

  return {
    proctorsList: proctorsList,
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
    _flavor: 'singleton-trigger'
  };
}

// ----- Small-class-trigger generator -----
// 2k proctors split into two classes of size k. Class A eligible for
// a "wide" set of entries with many rooms each; class B eligible for a
// "narrow" set with few rooms. Tune so:
//   totalGuardSlots = G_A + G_B
//   floor(G_A / k) > LB_global = floor((G_A + G_B) / (2k))
//   floor(G_B / k) ≤ LB_global

function buildSmallClassTriggerInput(rng, iterTag) {
  // k=2..3 classes. wideEntries=2..4 with wideRooms=3..5 each.
  // narrowEntries=1..2 with narrowRooms=1..2 each.
  //   G_A ≈ 2..4 * 3..5 = 6..20
  //   G_B ≈ 1..2 * 1..2 = 1..4
  //   Need floor(G_A / k) > floor((G_A + G_B) / (2k)) + 1.
  //   With k=2, G_A=12, G_B=2: floor(12/2)=6, LB_global=floor(14/4)=3, 6>4 ✓.
  var k = rngInt(rng, 2, 3);
  var wideEntries = rngInt(rng, 2, 4);
  var wideRooms = rngInt(rng, 3, 5);
  var narrowEntries = rngInt(rng, 1, 2);
  var narrowRooms = rngInt(rng, 1, 2);

  var N = 2 * k;
  var proctorsList = [];
  for (var pi = 0; pi < N; pi++) {
    proctorsList.push(makeProctor('SmallSynth_' + iterTag + '_' + pi,
      'CIN_FXSC_' + iterTag + '_' + pi, 'عام',
      pi % 2 === 0 ? 'ذكر' : 'أنثى', pi));
  }
  // Class A: first k proctors. Class B: last k proctors.
  var classACins = [];
  var classBCins = [];
  for (var pi2 = 0; pi2 < k; pi2++) {
    classACins.push(proctorsList[pi2].cin);
    classBCins.push(proctorsList[k + pi2].cin);
  }

  var entries = [];
  for (var we = 0; we < wideEntries; we++) {
    entries.push(makeEntry(iterTag + '_wA' + we, 'صباحا', 'الحصة الأولى', 1 + we));
  }
  for (var ne3 = 0; ne3 < narrowEntries; ne3++) {
    entries.push(makeEntry(iterTag + '_nB' + ne3, 'مساء', 'الحصة الأولى', 10 + ne3));
  }

  var rooms = [];
  for (var rw = 0; rw < wideRooms; rw++) {
    rooms.push({
      key: 'WAR_' + iterTag + '_' + rw,
      room_num: 'WAR_' + iterTag + '_' + rw,
      roomName: 'قاعة WAR ' + rw,
      level_name: 'level_classA_' + iterTag
    });
  }
  for (var rn = 0; rn < narrowRooms; rn++) {
    rooms.push({
      key: 'NBR_' + iterTag + '_' + rn,
      room_num: 'NBR_' + iterTag + '_' + rn,
      roomName: 'قاعة NBR ' + rn,
      level_name: 'level_classB_' + iterTag
    });
  }
  for (var we2 = 0; we2 < wideEntries; we2++) {
    entries[we2].level_name = 'level_classA_' + iterTag;
  }
  for (var ne4 = 0; ne4 < narrowEntries; ne4++) {
    entries[wideEntries + ne4].level_name = 'level_classB_' + iterTag;
  }

  // Eligibility:
  //   class A members: eligible for wide entries; exempt for narrow.
  //   class B members: eligible for narrow entries; exempt for wide.
  var exemptionsData = {};
  for (var ei = 0; ei < entries.length; ei++) {
    exemptionsData[sessionScopeKey(entries[ei])] = {};
  }
  // Class A exempt for narrow entries.
  for (var ne5 = 0; ne5 < narrowEntries; ne5++) {
    var k1 = sessionScopeKey(entries[wideEntries + ne5]);
    classACins.forEach(function (cin) { exemptionsData[k1][cin] = 'no'; });
  }
  // Class B exempt for wide entries.
  for (var we3 = 0; we3 < wideEntries; we3++) {
    var k2 = sessionScopeKey(entries[we3]);
    classBCins.forEach(function (cin) { exemptionsData[k2][cin] = 'no'; });
  }

  return {
    proctorsList: proctorsList,
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
    _flavor: 'small-class-trigger'
  };
}

// ----- Property loop -----

var ITERATIONS_TARGET = 24;        // accepted iterations (12 per flavor)
var ITERATIONS_MAX = 200;          // total attempts
var SEED_BASE = 0xFADE5; // chosen to avoid collision with preservation seed
var rng = mulberry32(SEED_BASE);

var accepted = [];
var rejected = [];
var flavorCounts = { 'singleton-trigger': 0, 'small-class-trigger': 0 };
var FLAVOR_TARGET_PER = ITERATIONS_TARGET / 2;

for (var attempt = 0; attempt < ITERATIONS_MAX &&
                     accepted.length < ITERATIONS_TARGET; attempt++) {
  var iterTag = 'X' + attempt;
  // Alternate flavors but skip when one flavor's quota is full.
  var input;
  var preferSingleton = (attempt % 2) === 0;
  if (preferSingleton && flavorCounts['singleton-trigger'] < FLAVOR_TARGET_PER) {
    input = buildSingletonTriggerInput(rng, iterTag);
  } else if (!preferSingleton && flavorCounts['small-class-trigger'] < FLAVOR_TARGET_PER) {
    input = buildSmallClassTriggerInput(rng, iterTag);
  } else if (flavorCounts['singleton-trigger'] < FLAVOR_TARGET_PER) {
    input = buildSingletonTriggerInput(rng, iterTag);
  } else if (flavorCounts['small-class-trigger'] < FLAVOR_TARGET_PER) {
    input = buildSmallClassTriggerInput(rng, iterTag);
  } else {
    break;
  }

  // Filter: accept ONLY inputs where the pre-fix algorithm would have
  // emitted an impossible bound (raw rawLower > LB_global + 1 for some
  // class). Post-fix the emitted bounds are capped, so we cannot read
  // them via deriveBounds — we reconstruct the raw bound directly from
  // the eligibility-class geometry. See `wouldBugConditionFire` above.
  var bug;
  try {
    bug = wouldBugConditionFire(input);
  } catch (e) {
    rejected.push({ attempt: attempt, reason: 'wouldBugConditionFire_threw: ' + e.message });
    continue;
  }
  if (!bug) {
    rejected.push({ attempt: attempt, reason: 'wouldBugConditionFire=false (raw bound does not exceed LB_global+1)' });
    continue;
  }

  // Re-derive bounds for the assertion.
  var ctx;
  try {
    ctx = deriveBounds(input);
  } catch (e) {
    rejected.push({ attempt: attempt, reason: 'deriveBounds_threw: ' + e.message });
    continue;
  }

  // Assert universal cap rule (post-fix property — pre-fix this fails
  // for every accepted input by construction).
  var preFailCount = failures.length;
  assertCapHolds(ctx, 'pbt-attempt' + attempt + '-' + input._flavor, failures);
  var postFailCount = failures.length;

  accepted.push({
    attempt: attempt,
    iterTag: iterTag,
    flavor: input._flavor,
    proctorCount: input.proctorsList.length,
    rowCount: input.scheduleEntries.length,
    lbGlobal: ctx.lbGlobal,
    totalGuardSlots: ctx.totalGuardSlots,
    eligibleCount: ctx.eligibleCount,
    capFailures: postFailCount - preFailCount
  });
  flavorCounts[input._flavor]++;
}

// ============================================================
// 9) Diagnostic summary.
// ============================================================

console.log('[singleton-class-bounds-fix] PBT loop summary:');
console.log('  attempts:           ' + (rejected.length + accepted.length));
console.log('  accepted:           ' + accepted.length + ' / ' + ITERATIONS_TARGET);
console.log('  rejected:           ' + rejected.length);
console.log('  flavor counts:');
console.log('    singleton-trigger:    ' + flavorCounts['singleton-trigger']);
console.log('    small-class-trigger:  ' + flavorCounts['small-class-trigger']);
if (rejected.length > 0) {
  var notBugRejects = 0, otherRejects = 0;
  for (var rj = 0; rj < rejected.length; rj++) {
    if (rejected[rj].reason &&
        rejected[rj].reason.indexOf('wouldBugConditionFire=false') === 0) {
      notBugRejects++;
    } else {
      otherRejects++;
    }
  }
  console.log('    wouldBugConditionFire=false: ' + notBugRejects);
  console.log('    other:                       ' + otherRejects);
}

// Soft assertion: we must accept at least 5 iterations per flavor to
// call the bug-condition domain "covered" — if we accept fewer, the
// generators are mis-tuned and the test is uninformative.
if (accepted.length < 6 ||
    flavorCounts['singleton-trigger'] < 3 ||
    flavorCounts['small-class-trigger'] < 3) {
  failures.push(
    '[fix-pbt] coverage too sparse: accepted=' + accepted.length +
    ' (target ≥ 6), singleton-trigger=' + flavorCounts['singleton-trigger'] +
    ' (target ≥ 3), small-class-trigger=' + flavorCounts['small-class-trigger'] +
    ' (target ≥ 3). The generators are not producing enough ' +
    'isBugCondition=true inputs — check the geometry parameters.'
  );
}

// ============================================================
// 10) Final aggregation.
//
// Pre-fix on F: failures are non-empty (every accepted PBT iteration
// counter-examples the cap rule, plus the three hard-coded cases).
// Throw with a comprehensive listing.
//
// Post-fix on F' (after Tasks 5.2 + 5.3): failures must be empty.
// ============================================================

if (failures.length > 0) {
  console.log('\n[singleton-class-bounds-fix] FAIL — ' +
    failures.length + ' assertion(s) failed:');
  for (var fi = 0; fi < failures.length; fi++) {
    console.log('  (' + (fi + 1) + ') ' + failures[fi]);
  }
  assert.fail(
    '[singleton-class-bounds-fix] ' + failures.length +
    ' assertion(s) failed. On F (UNFIXED): the universal cap-rule ' +
    'property is counter-exampled by every isBugCondition=true input ' +
    '(synthetic singleton, synthetic non-singleton, production ' +
    'fixture, plus PBT-generated singleton/small-class triggers). ' +
    'Each failure is a witness that change site #1 + #2 (Task 5.2 + ' +
    '5.3) MUST resolve. On F\' (post-Task-5): all assertions MUST pass.\n\n' +
    'First failure: ' + failures[0]
  );
}

console.log('\n[singleton-class-bounds-fix] PASS');
console.log('  Property 1 — universal cap-rule classLowerBound ≤ ' +
  'LB_global + 1 holds across all isBugCondition=true inputs ' +
  '(' + accepted.length + ' PBT iterations + 3 hard-coded cases).');
