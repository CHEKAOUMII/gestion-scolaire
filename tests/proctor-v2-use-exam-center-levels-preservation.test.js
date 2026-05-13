/**
 * Preservation PBT test — proctor-v2-use-exam-center-levels (Task 2, re-run in Task 3.9)
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 2.4, 2.5
 *
 * Property 2 (Preservation): For every input where isBugCondition is FALSE
 *   for every level (i.e. `M >= N`, or `level.rooms = 0/undefined`, or level
 *   not scheduled, or `examCenterLevels` empty), the `roomsList` built by the
 *   fixed room-assembly logic MUST:
 *     1. be deterministic (two consecutive runs → deep-equal result)
 *     2. match, for every level L, exactly what `getRoomRowsForLevel(L)`
 *        returns today (content + order) — no synthetic rows added
 *     3. never contain a level that is not present in `scheduleEntries`
 *   and the accompanying `syntheticRoomWarnings[]` MUST be empty (no
 *   synthetic rows are ever generated under ¬isBugCondition inputs, by
 *   construction of `computeEffectiveRoomRows`).
 *
 * Test lifecycle:
 *   - Task 2 (pre-fix): the mirror reflected the unfixed `buildV2Input`
 *     (reads only `examCenterRoomsData`). The test was EXPECTED TO PASS on
 *     that code, establishing the baseline behavior for ¬isBugCondition
 *     inputs.
 *   - Task 3.9 (post-fix): the mirror has been UPDATED to reflect the FIXED
 *     `buildV2Input` (real rows + synthetic top-up against `examCenterLevels`
 *     via `computeEffectiveRoomRows`). Property 2 still holds by construction
 *     because `computeEffectiveRoomRows` returns `actualRows` unchanged when
 *     `expected <= rows.length` or `expected === 0` — and that is exactly
 *     what every ¬isBugCondition input guarantees. The test is EXPECTED TO
 *     PASS; any failure here = regression.
 *
 * Additional check (Task 3.9): PBT 1 now also asserts that
 * `examCenterRoomsData` is not mutated during room-list construction, which
 * satisfies the explicit preservation clause "`examCenterRoomsData` in
 * storage must not change after running v2" from tasks.md §3.9.
 *
 * Isolation strategy:
 *   Same as `proctor-v2-use-exam-center-levels-exploration.test.js` — we
 *   mirror the fixed `getRoomRowsForLevel` / `buildV2Input` room-assembly
 *   logic (including the `computeEffectiveRoomRows` helper) as a pure
 *   function. Keep in sync with:
 *     - tests/proctor-v2-effective-room-rows.test.js
 *     - tests/proctor-v2-use-exam-center-levels-exploration.test.js
 *     - exams-proctors.html §"computeEffectiveRoomRows"
 */

'use strict';

const assert = require('assert');

// ----------------------------------------------------------------------------
// Mirror of the FIXED (post-tasks-3.1–3.4) buildV2Input room-assembly logic.
// After Task 3.9 this reflects the production helpers in exams-proctors.html:
//   - getRoomRowsForLevel: still reads examCenterRoomsData (unchanged)
//   - computeEffectiveRoomRows: tops up with synthetic rows when the level
//     satisfies isBugCondition; otherwise returns actualRows unchanged.
//
// Keep in sync with:
//   - tests/proctor-v2-effective-room-rows.test.js
//   - tests/proctor-v2-use-exam-center-levels-exploration.test.js
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

function mockCurrentBuildRoomsList(scheduleEntries, roomsData, examCenterLevelsMap) {
  const levelsSeen = Object.create(null);
  const roomsList = Object.create(null);
  const syntheticRoomWarnings = []; // under ¬isBugCondition the fix never produces any
  for (let i = 0; i < scheduleEntries.length; i++) {
    const entry = scheduleEntries[i];
    const lvl = (entry && entry.level_name) || '';
    if (!lvl || levelsSeen[lvl]) continue;
    levelsSeen[lvl] = true;
    const actualRows = mockGetRoomRowsForLevel(lvl, roomsData);
    const effective = computeEffectiveRoomRows(lvl, actualRows, examCenterLevelsMap);
    roomsList[lvl] = effective.rows;
    if (effective.synthetic > 0) {
      syntheticRoomWarnings.push({
        levelName: lvl,
        added: effective.synthetic,
        expected: effective.expected,
        actual: effective.actual
      });
    }
  }
  return { roomsList: roomsList, syntheticRoomWarnings: syntheticRoomWarnings };
}

// ----------------------------------------------------------------------------
// isBugCondition — copied verbatim from design.md §"Bug Condition".
// Used by the PBT generator to guarantee ¬isBugCondition for every level.
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

function anyLevelHitsBugCondition(examCenterLevels, examCenterRoomsData, scheduleEntries) {
  // Consider every level that could plausibly surface: union of keys in
  // examCenterLevels and level_names in scheduleEntries. This keeps the
  // generator honest even when a level exists only in one of the two maps.
  const names = new Set();
  Object.keys(examCenterLevels).forEach(function (n) { names.add(n); });
  scheduleEntries.forEach(function (e) { if (e && e.level_name) names.add(e.level_name); });
  for (const L of names) {
    if (isBugCondition({
      levelName: L,
      scheduleEntries: scheduleEntries,
      examCenterLevels: examCenterLevels,
      examCenterRoomsData: examCenterRoomsData
    })) {
      return L;
    }
  }
  return null;
}

// ----------------------------------------------------------------------------
// Deep-equality helper (Node's assert.deepStrictEqual throws; wrap into bool).
// ----------------------------------------------------------------------------

function deepEquals(a, b) {
  try { assert.deepStrictEqual(a, b); return true; } catch (e) { return false; }
}

// ----------------------------------------------------------------------------
// Test harness + deterministic PRNG (seeded LCG, matches project tests).
// ----------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function runTest(name, fn) {
  try {
    fn();
    console.log('  [pass] ' + name);
    passed++;
  } catch (e) {
    console.log('  [FAIL] ' + name + ': ' + e.message);
    failed++;
    failures.push({ name: name, message: e.message });
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
function choice(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// ============================================================================
// Explicit unit cases (P1–P5 — observed baseline behaviors that must persist)
// ============================================================================

console.log('[test] proctor-v2-use-exam-center-levels — preservation (Task 2, re-run in Task 3.9)');
console.log('\n  --- Explicit preservation cases (expected to PASS after fix) ---');

runTest('P1: M == N (complete rows) → roomsList[L] matches getRoomRowsForLevel exactly', function () {
  const L = 'الأولى باكالوريا آداب وعلوم إنسانية - رسميون';
  const examCenterLevels = { [L]: { rooms: 2, subjects: ['ar', 'hist'] } };
  const examCenterRoomsData = {
    [L + '__1']: { roomName: 'قاعة 1', count: 30, firstNum: 1, lastNum: 30 },
    [L + '__2']: { roomName: 'قاعة 2', count: 30, firstNum: 31, lastNum: 60 }
  };
  const scheduleEntries = [
    { level_name: L, subject_name: 'العربية',
      date_day: '10', date_month: '3', date_year: '2026', period: 'صباحا',
      session: 'الحصة الأولى', day: 'الأول' }
  ];

  // Sanity: ¬isBugCondition for L (scheduled, expected=2, actual=2 → actual >= expected).
  assert.strictEqual(
    isBugCondition({ levelName: L, scheduleEntries: scheduleEntries, examCenterLevels: examCenterLevels, examCenterRoomsData: examCenterRoomsData }),
    false,
    'precondition: L must NOT satisfy isBugCondition'
  );

  const expectedRows = mockGetRoomRowsForLevel(L, examCenterRoomsData);
  const built = mockCurrentBuildRoomsList(scheduleEntries, examCenterRoomsData, examCenterLevels);

  assert.strictEqual(built.roomsList[L].length, 2, 'roomsList[L].length === 2');
  assert.deepStrictEqual(built.roomsList[L], expectedRows,
    'roomsList[L] must deep-equal getRoomRowsForLevel(L) — content and order');
  assert.strictEqual(built.syntheticRoomWarnings.length, 0,
    'syntheticRoomWarnings must be empty for a fully-saved level');
});

runTest('P2: level in examCenterLevels but not in scheduleEntries → absent from roomsList', function () {
  const LScheduled = 'مستوى مبرمَج';
  const LUnscheduled = 'مستوى غير مبرمَج';
  const examCenterLevels = {
    [LScheduled]: { rooms: 1, subjects: ['x'] },
    [LUnscheduled]: { rooms: 3, subjects: ['y'] }
  };
  const examCenterRoomsData = {
    [LScheduled + '__1']: { roomName: 'قاعة 1', count: 25, firstNum: 1, lastNum: 25 },
    // The unscheduled level also has rows saved — they must still be ignored.
    [LUnscheduled + '__1']: { roomName: 'قاعة 1', count: 25, firstNum: 1, lastNum: 25 }
  };
  const scheduleEntries = [
    { level_name: LScheduled, subject_name: 'x',
      date_day: '11', date_month: '3', date_year: '2026', period: 'صباحا',
      session: 'الحصة الأولى', day: 'الأول' }
  ];

  assert.strictEqual(
    isBugCondition({ levelName: LUnscheduled, scheduleEntries: scheduleEntries, examCenterLevels: examCenterLevels, examCenterRoomsData: examCenterRoomsData }),
    false,
    'precondition: unscheduled level cannot satisfy isBugCondition'
  );

  const built = mockCurrentBuildRoomsList(scheduleEntries, examCenterRoomsData, examCenterLevels);

  assert.ok(Object.prototype.hasOwnProperty.call(built.roomsList, LScheduled),
    'scheduled level must appear in roomsList');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(built.roomsList, LUnscheduled), false,
    'unscheduled level must NOT appear in roomsList');
  assert.strictEqual(built.syntheticRoomWarnings.length, 0, 'no synthetic warnings');
});

runTest('P3: level.rooms = 0 → roomsList[L] = actualRows (no synthetic rows)', function () {
  const L = 'مستوى بصفر قاعات مُعلَنة';
  const examCenterLevels = { [L]: { rooms: 0, subjects: ['z'] } };
  const examCenterRoomsData = {
    [L + '__1']: { roomName: 'قاعة 1', count: 20, firstNum: 1, lastNum: 20 }
  };
  const scheduleEntries = [
    { level_name: L, subject_name: 'z',
      date_day: '12', date_month: '3', date_year: '2026', period: 'صباحا',
      session: 'الحصة الأولى', day: 'الأول' }
  ];

  assert.strictEqual(
    isBugCondition({ levelName: L, scheduleEntries: scheduleEntries, examCenterLevels: examCenterLevels, examCenterRoomsData: examCenterRoomsData }),
    false,
    'precondition: level with rooms=0 cannot satisfy isBugCondition'
  );

  const expectedRows = mockGetRoomRowsForLevel(L, examCenterRoomsData); // 1 row
  const built = mockCurrentBuildRoomsList(scheduleEntries, examCenterRoomsData, examCenterLevels);

  assert.strictEqual(built.roomsList[L].length, 1, 'roomsList[L] must contain exactly the 1 saved row');
  assert.deepStrictEqual(built.roomsList[L], expectedRows, 'rows must equal actualRows (no synthetics)');
  assert.strictEqual(built.syntheticRoomWarnings.length, 0, 'no synthetic warnings');
});

runTest('P4: level undefined in examCenterLevels, scheduled, has saved rows → falls back to actualRows', function () {
  const L = 'مستوى غير مُعرَّف في examCenterLevels';
  // L intentionally NOT present in examCenterLevels.
  const examCenterLevels = {};
  const examCenterRoomsData = {
    [L + '__1']: { roomName: 'قاعة 1', count: 25, firstNum: 1, lastNum: 25 }
  };
  const scheduleEntries = [
    { level_name: L, subject_name: 's',
      date_day: '13', date_month: '3', date_year: '2026', period: 'صباحا',
      session: 'الحصة الأولى', day: 'الأول' }
  ];

  assert.strictEqual(
    isBugCondition({ levelName: L, scheduleEntries: scheduleEntries, examCenterLevels: examCenterLevels, examCenterRoomsData: examCenterRoomsData }),
    false,
    'precondition: level missing from examCenterLevels cannot satisfy isBugCondition (expected=0)'
  );

  const expectedRows = mockGetRoomRowsForLevel(L, examCenterRoomsData);
  const built = mockCurrentBuildRoomsList(scheduleEntries, examCenterRoomsData, examCenterLevels);

  assert.deepStrictEqual(built.roomsList[L], expectedRows,
    'roomsList[L] must deep-equal getRoomRowsForLevel(L)');
  assert.strictEqual(built.syntheticRoomWarnings.length, 0, 'no synthetic warnings');
});

runTest('P5: examCenterLevels entirely empty → full fallback to current behavior', function () {
  const L = 'مستوى بدون إعدادات';
  const examCenterLevels = {}; // empty map for the active year
  const examCenterRoomsData = {
    [L + '__1']: { roomName: 'قاعة 1', count: 25, firstNum: 1, lastNum: 25 }
  };
  const scheduleEntries = [
    { level_name: L, subject_name: 's',
      date_day: '14', date_month: '3', date_year: '2026', period: 'صباحا',
      session: 'الحصة الأولى', day: 'الأول' }
  ];

  // Every level must be ¬isBugCondition (examCenterLevels empty → expected=0).
  assert.strictEqual(
    anyLevelHitsBugCondition(examCenterLevels, examCenterRoomsData, scheduleEntries),
    null,
    'precondition: with empty examCenterLevels, no level can satisfy isBugCondition'
  );

  const expectedRows = mockGetRoomRowsForLevel(L, examCenterRoomsData);
  const built = mockCurrentBuildRoomsList(scheduleEntries, examCenterRoomsData, examCenterLevels);

  assert.deepStrictEqual(built.roomsList[L], expectedRows,
    'fallback path: roomsList[L] equals the saved row');
  assert.strictEqual(built.syntheticRoomWarnings.length, 0, 'no synthetic warnings');
});

// ============================================================================
// PBT generator — always ¬isBugCondition for every level
// ============================================================================

/**
 * Generator strategy: for each level in the generated input, pick one of
 * three "safe" shapes that guarantees ¬isBugCondition:
 *   - 'complete'     : scheduled + rooms=N + exactly N saved rows (M==N)
 *   - 'rooms-zero'   : scheduled + rooms=0 + arbitrary (0..K) saved rows
 *   - 'unscheduled'  : NOT in scheduleEntries + rooms>0 + rows optional
 *
 * We also add a small probability of injecting a level that exists only in
 * `examCenterRoomsData` (no entry in `examCenterLevels`) and is scheduled —
 * this matches P4 and still satisfies ¬isBugCondition (expected=0).
 *
 * Finally, with some probability we emit the global-fallback shape: an empty
 * `examCenterLevels` alongside scheduled levels with saved rows (P5).
 */
function genPreservationInput(rng) {
  const shape = choice(rng, ['mixed', 'mixed', 'mixed', 'empty-levels']);
  const examCenterLevels = Object.create(null);
  const examCenterRoomsData = Object.create(null);
  const scheduleEntries = [];

  const numLevels = randInt(rng, 1, 4);

  for (let i = 0; i < numLevels; i++) {
    const levelName = 'مستوى PBT ' + i + '_' + Math.floor(rng() * 1e6);

    let kind;
    if (shape === 'empty-levels') {
      // In the global-fallback shape we only use kinds that don't add to
      // examCenterLevels — any scheduled level with rows auto-satisfies
      // ¬isBugCondition because expected=0.
      kind = choice(rng, ['level-undefined', 'level-undefined', 'unscheduled']);
    } else {
      kind = choice(rng, ['complete', 'rooms-zero', 'unscheduled', 'level-undefined']);
    }

    if (kind === 'complete') {
      const N = randInt(rng, 1, 4);
      examCenterLevels[levelName] = { rooms: N, subjects: ['subj_' + i] };
      // Save exactly N rows with unique numbers.
      const used = new Set();
      for (let j = 0; j < N; j++) {
        let num;
        do { num = randInt(rng, 1, 20); } while (used.has(num));
        used.add(num);
        examCenterRoomsData[levelName + '__' + num] = {
          roomName: 'قاعة ' + num, count: 25, firstNum: 1, lastNum: 25
        };
      }
      scheduleEntries.push(makeScheduleEntry(levelName, i, rng));
    } else if (kind === 'rooms-zero') {
      examCenterLevels[levelName] = { rooms: 0, subjects: ['subj_' + i] };
      // Optionally 0..3 saved rows (doesn't matter — expected=0 → ¬isBugCondition).
      const K = randInt(rng, 0, 3);
      const used = new Set();
      for (let j = 0; j < K; j++) {
        let num;
        do { num = randInt(rng, 1, 20); } while (used.has(num));
        used.add(num);
        examCenterRoomsData[levelName + '__' + num] = {
          roomName: 'قاعة ' + num, count: 25, firstNum: 1, lastNum: 25
        };
      }
      scheduleEntries.push(makeScheduleEntry(levelName, i, rng));
    } else if (kind === 'unscheduled') {
      // Present in examCenterLevels (possibly with rooms > 0) but NOT scheduled.
      const N = randInt(rng, 0, 3);
      examCenterLevels[levelName] = { rooms: N, subjects: ['subj_' + i] };
      // Sometimes save rows too (shouldn't surface in roomsList because unscheduled).
      if (rng() < 0.5) {
        const K = randInt(rng, 0, 3);
        const used = new Set();
        for (let j = 0; j < K; j++) {
          let num;
          do { num = randInt(rng, 1, 20); } while (used.has(num));
          used.add(num);
          examCenterRoomsData[levelName + '__' + num] = {
            roomName: 'قاعة ' + num, count: 25, firstNum: 1, lastNum: 25
          };
        }
      }
      // NOT pushed to scheduleEntries.
    } else if (kind === 'level-undefined') {
      // Level is scheduled + has saved rows, but missing from examCenterLevels
      // → expected=0 → ¬isBugCondition.
      const K = randInt(rng, 0, 3);
      const used = new Set();
      for (let j = 0; j < K; j++) {
        let num;
        do { num = randInt(rng, 1, 20); } while (used.has(num));
        used.add(num);
        examCenterRoomsData[levelName + '__' + num] = {
          roomName: 'قاعة ' + num, count: 25, firstNum: 1, lastNum: 25
        };
      }
      scheduleEntries.push(makeScheduleEntry(levelName, i, rng));
    }
  }

  return {
    examCenterLevels: examCenterLevels,
    examCenterRoomsData: examCenterRoomsData,
    scheduleEntries: scheduleEntries
  };
}

function makeScheduleEntry(levelName, i, rng) {
  return {
    level_name: levelName,
    subject_name: 'subj_' + i,
    date_day: String(1 + (i % 28)),
    date_month: '3',
    date_year: '2026',
    period: i % 2 === 0 ? 'صباحا' : 'مساء',
    session: 'الحصة ' + (1 + (i % 3)),
    day: 'اليوم ' + (1 + (i % 5))
  };
}

// ============================================================================
// PBT 1 — Determinism / snapshot stability + examCenterRoomsData non-mutation
// ============================================================================

console.log('\n  --- PBT 1: Determinism (snapshot stable) + examCenterRoomsData non-mutation ---');

runTest('PBT 1: two consecutive runs on the same ¬isBugCondition input produce deep-equal roomsList, and examCenterRoomsData is never mutated (seed=20260324)', function () {
  const rng = makeLCG(20260324);
  const ITER = 100;
  const violations = [];
  const mutations = [];

  for (let i = 0; i < ITER; i++) {
    const input = genPreservationInput(rng);

    // Generator invariant (sanity): no level in the generated input hits bug condition.
    const bad = anyLevelHitsBugCondition(input.examCenterLevels, input.examCenterRoomsData, input.scheduleEntries);
    assert.strictEqual(bad, null,
      'generator invariant broken at iteration ' + i + ': level "' + bad + '" satisfies isBugCondition');

    // Snapshot the entire storage payload (Requirement 3.3 — `examCenterRoomsData`
    // in storage must not change after running v2). We compare JSON strings so
    // the check is agnostic to prototype differences: the generator uses
    // `Object.create(null)` for its maps, while `JSON.parse(JSON.stringify(...))`
    // would hydrate a regular object — `assert.deepStrictEqual` treats those as
    // unequal. Comparing serialised strings captures structural equality, which
    // is exactly what "storage payload unchanged" means here.
    const beforeSnapshot = JSON.stringify(input.examCenterRoomsData);

    const a = mockCurrentBuildRoomsList(input.scheduleEntries, input.examCenterRoomsData, input.examCenterLevels);
    const b = mockCurrentBuildRoomsList(input.scheduleEntries, input.examCenterRoomsData, input.examCenterLevels);

    if (!deepEquals(a.roomsList, b.roomsList) || a.syntheticRoomWarnings.length !== 0 || b.syntheticRoomWarnings.length !== 0) {
      violations.push({ iteration: i, a: a, b: b });
    }

    const afterSnapshot = JSON.stringify(input.examCenterRoomsData);
    if (beforeSnapshot !== afterSnapshot) {
      mutations.push({
        iteration: i,
        before: beforeSnapshot,
        after: afterSnapshot
      });
    }
  }

  assert.strictEqual(violations.length, 0,
    'Determinism violated in ' + violations.length + '/' + ITER + ' iterations; first: ' +
    JSON.stringify(violations[0]));
  assert.strictEqual(mutations.length, 0,
    'examCenterRoomsData mutated during room-list construction in ' + mutations.length + '/' + ITER +
    ' iterations; first: ' + JSON.stringify(mutations[0]));
});

// ============================================================================
// PBT 2 — Content + order: roomsList[L] equals getRoomRowsForLevel(L)
// ============================================================================

console.log('\n  --- PBT 2: Content + order preservation ---');

runTest('PBT 2: for every ¬isBugCondition input, roomsList[L] deep-equals getRoomRowsForLevel(L, roomsData) (seed=20260324)', function () {
  const rng = makeLCG(20260324);
  const ITER = 100;
  const violations = [];

  for (let i = 0; i < ITER; i++) {
    const input = genPreservationInput(rng);
    const built = mockCurrentBuildRoomsList(input.scheduleEntries, input.examCenterRoomsData, input.examCenterLevels);

    const levelNames = Object.keys(built.roomsList);
    for (const L of levelNames) {
      const expected = mockGetRoomRowsForLevel(L, input.examCenterRoomsData);
      if (!deepEquals(built.roomsList[L], expected)) {
        violations.push({
          iteration: i,
          levelName: L,
          got: built.roomsList[L],
          expected: expected
        });
        break; // one counterexample per iteration is enough for the report
      }
    }

    if (built.syntheticRoomWarnings.length !== 0) {
      violations.push({ iteration: i, syntheticRoomWarnings: built.syntheticRoomWarnings });
    }
  }

  assert.strictEqual(violations.length, 0,
    'Content/order preservation violated in ' + violations.length + '/' + ITER + ' iterations; first: ' +
    JSON.stringify(violations[0]));
});

// ============================================================================
// PBT 3 — No extraneous levels in roomsList
// ============================================================================

console.log('\n  --- PBT 3: No extraneous levels in roomsList ---');

runTest('PBT 3: every key of roomsList corresponds to a level present in scheduleEntries (seed=20260324)', function () {
  const rng = makeLCG(20260324);
  const ITER = 100;
  const violations = [];

  for (let i = 0; i < ITER; i++) {
    const input = genPreservationInput(rng);
    const built = mockCurrentBuildRoomsList(input.scheduleEntries, input.examCenterRoomsData, input.examCenterLevels);

    const scheduledLevels = new Set(
      input.scheduleEntries.map(function (e) { return e && e.level_name; }).filter(Boolean)
    );

    const roomsListLevels = Object.keys(built.roomsList);
    for (const L of roomsListLevels) {
      if (!scheduledLevels.has(L)) {
        violations.push({
          iteration: i,
          extraneousLevel: L,
          scheduledLevels: Array.from(scheduledLevels)
        });
        break;
      }
    }
  }

  assert.strictEqual(violations.length, 0,
    'Extraneous-level rule violated in ' + violations.length + '/' + ITER + ' iterations; first: ' +
    JSON.stringify(violations[0]));
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n[test] proctor-v2-use-exam-center-levels — preservation: ' +
  passed + ' passed, ' + failed + ' failed');

if (failed > 0) {
  console.log('\n=== PRESERVATION REGRESSIONS (baseline broke) ===');
  console.log(JSON.stringify(failures, null, 2));
  process.exit(1);
}
