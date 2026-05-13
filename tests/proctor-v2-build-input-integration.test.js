/**
 * Integration test — buildV2Input room-assembly logic (Task 3.4)
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.6, 2.7
 *
 * Task 3.4 wires the pure helpers from Tasks 3.1–3.3 into the scheduleEntries
 * loop inside `buildV2Input` (exams-proctors.html). Because `buildV2Input`
 * lives inside a DOM/IPC context that cannot be `require`d directly, we mirror
 * the exact production loop here and exercise it end-to-end against mocked IPC
 * reads.
 *
 * Scope of this file:
 *   - the scheduleEntries loop produces `roomsList` correctly (real rows first,
 *     synthetic rows appended per level)
 *   - `syntheticRoomWarnings[]` is built with one entry per topped-up level,
 *     carrying `{ levelName, added, expected, actual }`
 *   - the fallback path (empty `examCenterLevelsMap`) behaves exactly like the
 *     pre-fix code
 *
 * The pure helpers mirrored here (`buildSyntheticRoomRow`, `computeMaxRoomNum`,
 * `computeEffectiveRoomRows`) MUST stay identical to the ones in
 * `exams-proctors.html`. They are already covered in isolation by
 * `tests/proctor-v2-effective-room-rows.test.js`; we re-include them here to
 * run `buildRoomsListAndWarnings` without forging a fake DOM.
 */

'use strict';

const assert = require('assert');

// ----------------------------------------------------------------------------
// Mirror: getRoomRowsForLevel (exams-proctors.html §"getRoomRowsForLevel").
// Reads ONLY examCenterRoomsData — matches the unfixed behaviour and is also
// what the fixed code still uses under the hood via getEffectiveRoomRowsForLevel.
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

// ----------------------------------------------------------------------------
// Mirror: buildSyntheticRoomRow / computeMaxRoomNum / computeEffectiveRoomRows
// (exams-proctors.html — keep in sync with production).
// ----------------------------------------------------------------------------
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

// ----------------------------------------------------------------------------
// Mirror: the scheduleEntries loop inside the FIXED buildV2Input.
// Input:
//   - scheduleEntries : same shape as in production
//   - roomsData       : value returned by window.api.examConfig.get(year, 'examCenterRoomsData')
//   - levelsMap       : value returned by getExamCenterLevelsForActiveYear()
// Output:
//   - { roomsList, syntheticRoomWarnings }
//
// This is the behaviour under test for Task 3.4.
// ----------------------------------------------------------------------------
function buildRoomsListAndWarnings(scheduleEntries, roomsData, levelsMap) {
    const levelsSeen = Object.create(null);
    const roomsList = Object.create(null);
    const syntheticRoomWarnings = [];

    for (let i = 0; i < scheduleEntries.length; i++) {
        const entry = scheduleEntries[i];
        const lvl = (entry && entry.level_name) || '';
        if (!lvl || levelsSeen[lvl]) continue;
        levelsSeen[lvl] = true;

        const actualRows = mockGetRoomRowsForLevel(lvl, roomsData);
        const effective = computeEffectiveRoomRows(lvl, actualRows, levelsMap);
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
// Test harness
// ----------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
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

// Helper: make a minimal well-formed schedule entry for a given level.
function makeEntry(levelName, subject) {
    return {
        level_name: levelName,
        subject_name: subject || 'subj',
        date_day: '10',
        date_month: '3',
        date_year: '2026',
        period: 'صباحا',
        session: 'الحصة الأولى',
        day: 'الأول'
    };
}

console.log('[test] buildV2Input room-assembly integration (Task 3.4)');

// ============================================================================
// Case 1: M=0, N=2 — synthetic rows fill the full expected count
// ============================================================================
console.log('\n  --- Case 1: M=0, N=2 (fully synthetic) ---');

test('M=0, N=2 → roomsList[L].length=2, one warning with correct counters', function () {
    const L = 'مستوى كامل النقص';
    const roomsData = {};
    const levelsMap = { [L]: { rooms: 2, subjects: ['x'] } };
    const scheduleEntries = [makeEntry(L)];

    const out = buildRoomsListAndWarnings(scheduleEntries, roomsData, levelsMap);

    assert.strictEqual(out.roomsList[L].length, 2, 'length must equal expected rooms');
    assert.strictEqual(out.syntheticRoomWarnings.length, 1, 'exactly one warning expected');
    assert.deepStrictEqual(
        out.syntheticRoomWarnings[0],
        { levelName: L, added: 2, expected: 2, actual: 0 },
        'warning must carry accurate counters'
    );
    assert.strictEqual(out.roomsList[L][0]._synthetic, true);
    assert.strictEqual(out.roomsList[L][1]._synthetic, true);
    assert.strictEqual(out.roomsList[L][0].room_num, '1');
    assert.strictEqual(out.roomsList[L][1].room_num, '2');
});

// ============================================================================
// Case 2: M=2, N=3 — top up by one synthetic row
// ============================================================================
console.log('\n  --- Case 2: M=2, N=3 (partial top-up) ---');

test('M=2, N=3 → roomsList[L].length=3, one warning added=1', function () {
    const L = 'مستوى ناقص قاعة واحدة';
    const roomsData = {
        [L + '__1']: { roomName: 'قاعة 1', count: 25, firstNum: 1, lastNum: 25 },
        [L + '__2']: { roomName: 'قاعة 2', count: 25, firstNum: 26, lastNum: 50 }
    };
    const levelsMap = { [L]: { rooms: 3, subjects: ['x'] } };
    const scheduleEntries = [makeEntry(L)];

    const out = buildRoomsListAndWarnings(scheduleEntries, roomsData, levelsMap);

    assert.strictEqual(out.roomsList[L].length, 3, 'length must be 3');
    assert.strictEqual(out.syntheticRoomWarnings.length, 1, 'one warning expected');
    assert.deepStrictEqual(
        out.syntheticRoomWarnings[0],
        { levelName: L, added: 1, expected: 3, actual: 2 }
    );
    assert.strictEqual(out.roomsList[L][2]._synthetic, true, 'last row must be synthetic');
    assert.strictEqual(out.roomsList[L][2].room_num, '3', 'synthetic row number starts at max+1');
});

// ============================================================================
// Case 3: M==N=2 — no synthetic rows, no warnings
// ============================================================================
console.log('\n  --- Case 3: M==N (no top-up) ---');

test('M==N=2 → roomsList[L].length=2, no warnings', function () {
    const L = 'مستوى مكتمل';
    const roomsData = {
        [L + '__1']: { roomName: 'قاعة 1', count: 25, firstNum: 1, lastNum: 25 },
        [L + '__2']: { roomName: 'قاعة 2', count: 25, firstNum: 26, lastNum: 50 }
    };
    const levelsMap = { [L]: { rooms: 2, subjects: ['x'] } };
    const scheduleEntries = [makeEntry(L)];

    const out = buildRoomsListAndWarnings(scheduleEntries, roomsData, levelsMap);

    assert.strictEqual(out.roomsList[L].length, 2);
    assert.strictEqual(out.syntheticRoomWarnings.length, 0, 'no warnings for complete level');
    for (const r of out.roomsList[L]) {
        assert.ok(!r._synthetic, 'no row should be synthetic');
    }
});

// ============================================================================
// Case 4: two missing levels in the same input — one entry per level,
// sum(added) equals sum(expected - actual)
// ============================================================================
console.log('\n  --- Case 4: two levels missing rooms in the same input ---');

test('two levels short → two warnings, sum(added) = sum(expected - actual), no duplicates', function () {
    const LA = 'مستوى أ — M=0 N=2';
    const LB = 'مستوى ب — M=1 N=3';
    const roomsData = {
        [LB + '__1']: { roomName: 'قاعة 1', count: 25, firstNum: 1, lastNum: 25 }
    };
    const levelsMap = {
        [LA]: { rooms: 2, subjects: ['a'] },
        [LB]: { rooms: 3, subjects: ['b'] }
    };
    // Duplicate schedule entries for the same level — roomsList must still
    // have one entry per level (levelsSeen dedup).
    const scheduleEntries = [
        makeEntry(LA, 'a1'),
        makeEntry(LA, 'a2'),
        makeEntry(LB, 'b1'),
        makeEntry(LB, 'b2')
    ];

    const out = buildRoomsListAndWarnings(scheduleEntries, roomsData, levelsMap);

    assert.strictEqual(out.roomsList[LA].length, 2);
    assert.strictEqual(out.roomsList[LB].length, 3);
    assert.strictEqual(out.syntheticRoomWarnings.length, 2, 'exactly one warning per topped-up level');

    const byLevel = {};
    for (const w of out.syntheticRoomWarnings) byLevel[w.levelName] = w;
    assert.ok(byLevel[LA], 'LA must have a warning');
    assert.ok(byLevel[LB], 'LB must have a warning');

    const totalAdded = out.syntheticRoomWarnings.reduce(function (acc, w) { return acc + w.added; }, 0);
    const totalExpected = out.syntheticRoomWarnings.reduce(function (acc, w) { return acc + (w.expected - w.actual); }, 0);
    assert.strictEqual(totalAdded, totalExpected, 'sum(added) must equal sum(expected - actual)');
    assert.strictEqual(totalAdded, (2 - 0) + (3 - 1), 'concrete total = 2 + 2 = 4');
});

// ============================================================================
// Case 5: empty examCenterLevelsMap — full fallback, no warnings
// ============================================================================
console.log('\n  --- Case 5: empty examCenterLevelsMap (fallback) ---');

test('empty levelsMap → roomsList mirrors getRoomRowsForLevel, no warnings', function () {
    const L = 'مستوى بلا إعدادات';
    const roomsData = {
        [L + '__1']: { roomName: 'قاعة 1', count: 25, firstNum: 1, lastNum: 25 }
    };
    const levelsMap = {}; // empty
    const scheduleEntries = [makeEntry(L)];

    const out = buildRoomsListAndWarnings(scheduleEntries, roomsData, levelsMap);

    const expectedRows = mockGetRoomRowsForLevel(L, roomsData);
    assert.deepStrictEqual(out.roomsList[L], expectedRows, 'roomsList must equal unfixed behaviour');
    assert.strictEqual(out.syntheticRoomWarnings.length, 0, 'no warnings on fallback');
});

test('empty levelsMap with M=0 scheduled level → roomsList[L] stays empty, no warnings', function () {
    const L = 'مستوى بلا صفوف ولا إعدادات';
    const roomsData = {};
    const levelsMap = {};
    const scheduleEntries = [makeEntry(L)];

    const out = buildRoomsListAndWarnings(scheduleEntries, roomsData, levelsMap);

    assert.deepStrictEqual(out.roomsList[L], [], 'pre-fix behaviour preserved on fallback');
    assert.strictEqual(out.syntheticRoomWarnings.length, 0);
});

// ============================================================================
// Case 6: row ordering — actual rows come before synthetic rows (Property 2)
// ============================================================================
console.log('\n  --- Case 6: row ordering (actual before synthetic) ---');

test('actual rows are preserved first, synthetic rows appended at the tail', function () {
    const L = 'مستوى بترتيب مختلَط';
    const roomsData = {
        [L + '__7']: { roomName: 'قاعة 7', count: 25, firstNum: 1, lastNum: 25 },
        [L + '__3']: { roomName: 'قاعة 3', count: 20, firstNum: 26, lastNum: 45 }
    };
    const levelsMap = { [L]: { rooms: 4, subjects: ['x'] } };
    const scheduleEntries = [makeEntry(L)];

    const out = buildRoomsListAndWarnings(scheduleEntries, roomsData, levelsMap);

    assert.strictEqual(out.roomsList[L].length, 4);
    // First two rows must be the real rows (whatever order getRoomRowsForLevel returns them in),
    // and neither can be synthetic.
    assert.ok(!out.roomsList[L][0]._synthetic, 'index 0 must be real');
    assert.ok(!out.roomsList[L][1]._synthetic, 'index 1 must be real');
    assert.strictEqual(out.roomsList[L][2]._synthetic, true, 'index 2 must be synthetic');
    assert.strictEqual(out.roomsList[L][3]._synthetic, true, 'index 3 must be synthetic');

    // Synthetic rows must not collide with existing room_num values (max is 7).
    const realNums = new Set(['7', '3']);
    assert.ok(!realNums.has(out.roomsList[L][2].room_num), 'synthetic room_num must not collide with real');
    assert.ok(!realNums.has(out.roomsList[L][3].room_num), 'synthetic room_num must not collide with real');
    assert.strictEqual(out.roomsList[L][2].room_num, '8');
    assert.strictEqual(out.roomsList[L][3].room_num, '9');
});

// ============================================================================
// Extra: unscheduled level with rooms defined → not added to roomsList
// (sanity guard that we never leak levels that aren't in scheduleEntries)
// ============================================================================
console.log('\n  --- Extra: unscheduled levels stay out of roomsList ---');

test('level present in levelsMap but not scheduled → absent from roomsList', function () {
    const LScheduled = 'مستوى مبرمَج';
    const LUnscheduled = 'مستوى غير مبرمَج';
    const roomsData = {
        [LScheduled + '__1']: { roomName: 'قاعة 1', count: 25, firstNum: 1, lastNum: 25 }
    };
    const levelsMap = {
        [LScheduled]: { rooms: 1, subjects: ['x'] },
        [LUnscheduled]: { rooms: 5, subjects: ['y'] }
    };
    const scheduleEntries = [makeEntry(LScheduled)];

    const out = buildRoomsListAndWarnings(scheduleEntries, roomsData, levelsMap);

    assert.ok(Object.prototype.hasOwnProperty.call(out.roomsList, LScheduled));
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(out.roomsList, LUnscheduled),
        false,
        'unscheduled level must never appear in roomsList'
    );
    assert.strictEqual(out.syntheticRoomWarnings.length, 0, 'no warning for unscheduled level');
});

// ============================================================================
// Summary
// ============================================================================
console.log('\n[test] buildV2Input integration: ' + passed + ' passed, ' + failed + ' failed');

if (failed > 0) {
    console.log('\n=== FAILURES ===');
    console.log(JSON.stringify(failures, null, 2));
    process.exit(1);
}
