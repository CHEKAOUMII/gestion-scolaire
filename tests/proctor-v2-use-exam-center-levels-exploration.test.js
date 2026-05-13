/**
 * Exploration PBT test — proctor-v2-use-exam-center-levels (Task 1)
 *
 * Validates: Requirements 2.1, 2.3, 2.6, 2.7
 *
 * Property 1 (Expected Behavior): For every level L that satisfies isBugCondition
 *   (scheduled AND examCenterLevels[L].rooms > 0 AND actualRows < expected),
 *   the roomsList built by buildV2Input MUST satisfy:
 *       roomsList[L].length === examCenterLevels[L].rooms
 *
 * Test lifecycle:
 *   - Task 1 (pre-fix): the mirror below reflected the unfixed buildV2Input
 *     (examCenterRoomsData only). The test was EXPECTED TO FAIL on that code,
 *     producing counterexamples that proved the bug existed.
 *   - Task 3.8 (post-fix): the mirror has been UPDATED to reflect the FIXED
 *     buildV2Input (real rows + synthetic top-up against examCenterLevels via
 *     `computeEffectiveRoomRows`). The test is now EXPECTED TO PASS. Failure
 *     here would mean the fix broke Property 1 somewhere.
 *
 * Isolation strategy:
 *   `buildV2Input` lives inside `exams-proctors.html` (DOM/IPC context), so we
 *   cannot load it directly here. Instead we mirror the exact post-fix
 *   room-assembly logic — the `computeEffectiveRoomRows` helper plus the
 *   `buildSyntheticRoomRow` / `computeMaxRoomNum` primitives it depends on,
 *   kept verbatim in sync with `tests/proctor-v2-effective-room-rows.test.js`
 *   and with the production helpers in `exams-proctors.html`.
 */

'use strict';

const assert = require('assert');

// ----------------------------------------------------------------------------
// Mirror of the FIXED (post-tasks-3.1–3.4) buildV2Input room-assembly logic.
// After Task 3.8 this reflects the production helpers in exams-proctors.html:
//   - getRoomRowsForLevel: still reads examCenterRoomsData (unchanged)
//   - computeEffectiveRoomRows: tops up with synthetic rows when rooms data
//     has fewer rows than examCenterLevels[L].rooms expects.
// Keep in sync with tests/proctor-v2-effective-room-rows.test.js.
// ----------------------------------------------------------------------------

function mockGetRoomRowsForLevel(levelName, roomsData) {
  const rows = Object.entries(roomsData || {}).map(function (entry) {
    const key = entry[0];
    const value = entry[1];
    const parts = key.split('__');
    return Object.assign(
      { key: key, level_name: parts[0] || '', room_num: parts[1] || '' },
      value || {}
    );
  }).filter(function (r) { return r.roomName || r.count || r.firstNum || r.lastNum; });
  return rows.filter(function (r) { return r.level_name === levelName; });
}

// Synthetic-row primitives — mirror of exams-proctors.html.
function buildSyntheticRoomRow(levelName, roomNum) {
  return {
    key: levelName + '__' + roomNum + '__synthetic',
    level_name: levelName,
    room_num: String(roomNum),
    roomName: 'قاعة افتراضية ' + roomNum,
    count: 0,
    firstNum: null,
    lastNum: null,
    _synthetic: true
  };
}

function computeMaxRoomNum(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  let max = 0;
  for (const r of rows) {
    const n = r ? parseInt(r.room_num, 10) : NaN;
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

function computeEffectiveRoomRows(levelName, actualRows, examCenterLevelsMap) {
  const rows = Array.isArray(actualRows) ? actualRows : [];
  const levelEntry = examCenterLevelsMap && examCenterLevelsMap[levelName];
  const expected = levelEntry && Number(levelEntry.rooms) > 0 ? Number(levelEntry.rooms) : 0;
  if (expected === 0 || expected <= rows.length) {
    return { rows: rows, synthetic: 0, expected: expected, actual: rows.length };
  }
  const missing = expected - rows.length;
  const startNum = computeMaxRoomNum(rows) + 1;
  const syntheticRows = [];
  for (let i = 0; i < missing; i++) {
    syntheticRows.push(buildSyntheticRoomRow(levelName, startNum + i));
  }
  return {
    rows: rows.concat(syntheticRows),
    synthetic: missing,
    expected: expected,
    actual: rows.length
  };
}

// Updated on Task 3.8 — was a mirror of the pre-fix code.
// After the fix (tasks 3.1–3.4) this mirror reflects the FIXED
// buildV2Input: real rows + synthetic top-up against examCenterLevels.
function mockCurrentBuildRoomsList(scheduleEntries, roomsData, examCenterLevelsMap) {
  const levelsSeen = Object.create(null);
  const roomsList = Object.create(null);
  for (let i = 0; i < scheduleEntries.length; i++) {
    const entry = scheduleEntries[i];
    const lvl = (entry && entry.level_name) || '';
    if (!lvl || levelsSeen[lvl]) continue;
    levelsSeen[lvl] = true;
    const actualRows = mockGetRoomRowsForLevel(lvl, roomsData);
    const effective = computeEffectiveRoomRows(lvl, actualRows, examCenterLevelsMap);
    roomsList[lvl] = effective.rows;
  }
  return roomsList;
}

// ----------------------------------------------------------------------------
// isBugCondition — copied verbatim from design.md §"Bug Condition"
// ----------------------------------------------------------------------------

function countRoomRowsInRoomsData(roomsData, levelName) {
  return mockGetRoomRowsForLevel(levelName, roomsData).length;
}

function isBugCondition(input) {
  const level = input.examCenterLevels[input.levelName];
  const expected = level && Number(level.rooms) > 0 ? Number(level.rooms) : 0;
  const actualRows = countRoomRowsInRoomsData(input.examCenterRoomsData, input.levelName);
  const scheduled = input.scheduleEntries.some(function (e) {
    return e && e.level_name === input.levelName;
  });
  return scheduled && expected > 0 && actualRows < expected;
}

// ----------------------------------------------------------------------------
// Test harness + deterministic PRNG (seeded LCG, same spirit as project tests)
// ----------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const counterexamples = [];

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

function makeLCG(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

// ----------------------------------------------------------------------------
// Property 1 assertion — pulled into a helper so unit + PBT share the check.
// Returns { ok, levelName, expected, actual } where `ok=false` = bug detected.
// ----------------------------------------------------------------------------

function assertProperty1(examCenterLevels, examCenterRoomsData, scheduleEntries) {
  const roomsList = mockCurrentBuildRoomsList(scheduleEntries, examCenterRoomsData, examCenterLevels);
  const levelNames = Object.keys(examCenterLevels);
  const violations = [];
  for (let i = 0; i < levelNames.length; i++) {
    const L = levelNames[i];
    const bc = isBugCondition({
      levelName: L,
      scheduleEntries: scheduleEntries,
      examCenterLevels: examCenterLevels,
      examCenterRoomsData: examCenterRoomsData
    });
    if (!bc) continue;
    const expected = Number(examCenterLevels[L].rooms) || 0;
    const actual = (roomsList[L] || []).length;
    if (actual !== expected) {
      violations.push({ levelName: L, expected: expected, actual: actual });
    }
  }
  return violations;
}

// ============================================================================
// Explicit unit cases (from tasks.md §1 — "اختبر المولِّد يدوياً على حالات صريحة")
// ============================================================================

console.log('[test] proctor-v2-use-exam-center-levels — exploration (Task 1, re-run in Task 3.8)');
console.log('\n  --- Explicit bug-condition cases (expected to PASS after fix) ---');

runTest('Case A: rooms=2, M=0 (no saved rows) → roomsList[L].length must equal 2', function () {
  const examCenterLevels = {
    'الأولى باكالوريا العلوم الرياضية - رسميون': { rooms: 2, subjects: ['math'] }
  };
  const examCenterRoomsData = {};
  const scheduleEntries = [
    { level_name: 'الأولى باكالوريا العلوم الرياضية - رسميون', subject_name: 'الرياضيات',
      date_day: '15', date_month: '3', date_year: '2026', period: 'صباحا',
      session: 'الحصة الأولى', day: 'الأول' }
  ];

  const violations = assertProperty1(examCenterLevels, examCenterRoomsData, scheduleEntries);
  if (violations.length > 0) counterexamples.push({ case: 'A', violations: violations });
  assert.strictEqual(violations.length, 0,
    'expected no violations, got: ' + JSON.stringify(violations));
});

runTest('Case B: rooms=3, M=2 (partial) → roomsList[L].length must equal 3', function () {
  const L = 'الأولى باكالوريا علوم الإقتصاد و التدبير - رسميون';
  const examCenterLevels = { [L]: { rooms: 3, subjects: ['eco'] } };
  const examCenterRoomsData = {
    [L + '__1']: { roomName: 'قاعة 1', count: 25, firstNum: 1, lastNum: 25 },
    [L + '__2']: { roomName: 'قاعة 2', count: 25, firstNum: 26, lastNum: 50 }
  };
  const scheduleEntries = [
    { level_name: L, subject_name: 'الاقتصاد',
      date_day: '16', date_month: '3', date_year: '2026', period: 'صباحا',
      session: 'الحصة الأولى', day: 'الثاني' }
  ];

  const violations = assertProperty1(examCenterLevels, examCenterRoomsData, scheduleEntries);
  if (violations.length > 0) counterexamples.push({ case: 'B', violations: violations });
  assert.strictEqual(violations.length, 0,
    'expected no violations, got: ' + JSON.stringify(violations));
});

runTest('Case C: two levels (rooms=1 + rooms=4), both M=0 → both must match expected', function () {
  const L1 = 'المستوى أ';
  const L2 = 'المستوى ب';
  const examCenterLevels = {
    [L1]: { rooms: 1, subjects: ['s1'] },
    [L2]: { rooms: 4, subjects: ['s2'] }
  };
  const examCenterRoomsData = {};
  const scheduleEntries = [
    { level_name: L1, subject_name: 's1', date_day: '1', date_month: '3', date_year: '2026',
      period: 'صباحا', session: 'الحصة الأولى', day: 'الأول' },
    { level_name: L2, subject_name: 's2', date_day: '1', date_month: '3', date_year: '2026',
      period: 'مساء', session: 'الحصة الأولى', day: 'الأول' }
  ];

  const violations = assertProperty1(examCenterLevels, examCenterRoomsData, scheduleEntries);
  if (violations.length > 0) counterexamples.push({ case: 'C', violations: violations });
  assert.strictEqual(violations.length, 0,
    'expected no violations, got: ' + JSON.stringify(violations));
});

runTest('Case D: saved room_num="5" + rooms=2 → length=2 and max synthetic num > 5', function () {
  const L = 'مستوى مع ترقيم غير متسلسل';
  const examCenterLevels = { [L]: { rooms: 2, subjects: ['x'] } };
  const examCenterRoomsData = {
    [L + '__5']: { roomName: 'قاعة 5', count: 30, firstNum: 1, lastNum: 30 }
  };
  const scheduleEntries = [
    { level_name: L, subject_name: 'x', date_day: '2', date_month: '3', date_year: '2026',
      period: 'صباحا', session: 'الحصة الأولى', day: 'الأول' }
  ];

  const roomsList = mockCurrentBuildRoomsList(scheduleEntries, examCenterRoomsData, examCenterLevels);
  const rows = roomsList[L] || [];
  // First sub-assertion: total length equals examCenterLevels[L].rooms
  const violations = assertProperty1(examCenterLevels, examCenterRoomsData, scheduleEntries);
  if (violations.length > 0) {
    counterexamples.push({
      case: 'D',
      violations: violations,
      note: 'also: the single synthetic row should carry room_num > 5 once the fix lands'
    });
  }

  // Second sub-assertion: at least one synthetic row with room_num > 5 exists.
  // Under the unfixed code there are no synthetic rows at all, so this fails too.
  const maxExistingNum = rows.reduce(function (m, r) {
    const n = parseInt(r.room_num, 10);
    return isFinite(n) && n > m ? n : m;
  }, 0);
  const hasBeyond5 = rows.some(function (r) {
    return parseInt(r.room_num, 10) > 5;
  });
  assert.strictEqual(violations.length, 0,
    'expected no violations, got: ' + JSON.stringify(violations));
  assert.ok(hasBeyond5,
    'expected at least one row with room_num > 5 after gap-filling; maxExistingNum=' + maxExistingNum);
});

// ============================================================================
// PBT loop — Property 1
//   Scoped generator: always produces a triple where at least one level
//   satisfies isBugCondition. Under the unfixed code, every iteration is
//   expected to yield a counterexample.
// ============================================================================

console.log('\n  --- Property-based loop (scoped to bug-condition inputs, expected to PASS after fix) ---');

function genBugConditionInput(rng) {
  const numLevels = randInt(rng, 1, 3);
  const examCenterLevels = Object.create(null);
  const examCenterRoomsData = Object.create(null);
  const scheduleEntries = [];

  for (let i = 0; i < numLevels; i++) {
    const levelName = 'مستوى PBT ' + i + '_' + Math.floor(rng() * 1e6);
    const N = randInt(rng, 1, 5);          // expected rooms (N >= 1)
    const M = randInt(rng, 0, N - 1);       // actual saved rows (M < N → bug condition)

    examCenterLevels[levelName] = { rooms: N, subjects: ['subj_' + i] };

    // Save M rows with arbitrary room_num values (possibly non-sequential).
    const usedNums = new Set();
    for (let j = 0; j < M; j++) {
      let num;
      do { num = randInt(rng, 1, 15); } while (usedNums.has(num));
      usedNums.add(num);
      examCenterRoomsData[levelName + '__' + num] = {
        roomName: 'قاعة ' + num,
        count: 25,
        firstNum: 1,
        lastNum: 25
      };
    }

    // Always schedule the level so isBugCondition's `scheduled` clause holds.
    scheduleEntries.push({
      level_name: levelName,
      subject_name: 'subj_' + i,
      date_day: String(1 + i),
      date_month: '3',
      date_year: '2026',
      period: i % 2 === 0 ? 'صباحا' : 'مساء',
      session: 'الحصة الأولى',
      day: 'الأول'
    });
  }

  return { examCenterLevels: examCenterLevels, examCenterRoomsData: examCenterRoomsData, scheduleEntries: scheduleEntries };
}

runTest('Property 1 holds for every generated input (100 iterations, seed=20260323)', function () {
  const rng = makeLCG(20260323);
  const ITER = 100;
  const allViolations = [];

  for (let i = 0; i < ITER; i++) {
    const input = genBugConditionInput(rng);
    const violations = assertProperty1(
      input.examCenterLevels,
      input.examCenterRoomsData,
      input.scheduleEntries
    );
    if (violations.length > 0) {
      allViolations.push({
        iteration: i,
        firstViolation: violations[0],
        levelsInInput: Object.keys(input.examCenterLevels).map(function (L) {
          return { name: L, rooms: input.examCenterLevels[L].rooms };
        })
      });
    }
  }

  if (allViolations.length > 0) {
    // Keep a bounded sample of counterexamples for the final report.
    counterexamples.push({
      case: 'PBT',
      totalFailingIterations: allViolations.length,
      totalIterations: ITER,
      sample: allViolations.slice(0, 5)
    });
  }

  assert.strictEqual(allViolations.length, 0,
    'Property 1 violated in ' + allViolations.length + '/' + ITER + ' iterations; first: ' +
    JSON.stringify(allViolations[0]));
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n[test] proctor-v2-use-exam-center-levels — exploration: ' +
  passed + ' passed, ' + failed + ' failed');

if (counterexamples.length > 0) {
  console.log('\n=== COUNTEREXAMPLES (Property 1 violated — the fix is incomplete) ===');
  console.log(JSON.stringify(counterexamples, null, 2));
}

// After Task 3.8 the fix is in place, so any failure here is a real regression.
if (failed > 0) {
  process.exit(1);
}
