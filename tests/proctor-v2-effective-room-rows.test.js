/**
 * Unit test — computeEffectiveRoomRows / getEffectiveRoomRowsForLevel (Task 3.3)
 *
 * Validates: Requirements 2.1, 2.3, 2.6, 3.1, 3.6
 *
 * The production helpers live inside a `<script>` block in
 * `exams-proctors.html` that depends on `window` globals and cannot be
 * `require`d directly. Following the convention established in Task 3.1/3.2
 * tests we mirror the pure helpers verbatim here. If the production helpers
 * change, this mirror MUST be updated.
 *
 * See:
 *   - exams-proctors.html §"computeEffectiveRoomRows"
 *   - exams-proctors.html §"getEffectiveRoomRowsForLevel"
 *   - design.md §"Control Flow" (topping-up rules)
 *   - design.md §"Synthetic Room Row Schema"
 */

'use strict';

const assert = require('assert');

// ----------------------------------------------------------------------------
// Mirror of the production helpers in exams-proctors.html. Keep in sync.
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
// Test harness
// ----------------------------------------------------------------------------
const tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

function runAll() {
    let passed = 0;
    let failed = 0;
    const failures = [];

    for (const t of tests) {
        try {
            t.fn();
            console.log('  [pass] ' + t.name);
            passed++;
        } catch (e) {
            console.log('  [FAIL] ' + t.name + ': ' + e.message);
            failed++;
            failures.push({ name: t.name, message: e.message });
        }
    }

    console.log('\n[test] computeEffectiveRoomRows: ' + passed + ' passed, ' + failed + ' failed');

    if (failed > 0) {
        console.log('\n=== FAILURES ===');
        console.log(JSON.stringify(failures, null, 2));
        process.exit(1);
    }
}

console.log('[test] computeEffectiveRoomRows / getEffectiveRoomRowsForLevel (Task 3.3)');

// ----------------------------------------------------------------------------
// Bug-condition cases: synthetic rows produced
// ----------------------------------------------------------------------------
console.log('\n  --- bug condition (synthetic rows produced) ---');

test('M=0, N=2 → length 2, two synthetic rows numbered 1 and 2', function () {
    const result = computeEffectiveRoomRows('L', [], { L: { rooms: 2 } });
    assert.strictEqual(result.rows.length, 2);
    assert.strictEqual(result.synthetic, 2);
    assert.strictEqual(result.expected, 2);
    assert.strictEqual(result.actual, 0);
    assert.strictEqual(result.rows[0].room_num, '1');
    assert.strictEqual(result.rows[1].room_num, '2');
    assert.strictEqual(result.rows[0]._synthetic, true);
    assert.strictEqual(result.rows[1]._synthetic, true);
});

test('M=2, N=3 → length 3, one synthetic row numbered 3', function () {
    const actual = [
        { key: 'L__1', level_name: 'L', room_num: '1', roomName: 'قاعة 1' },
        { key: 'L__2', level_name: 'L', room_num: '2', roomName: 'قاعة 2' }
    ];
    const result = computeEffectiveRoomRows('L', actual, { L: { rooms: 3 } });
    assert.strictEqual(result.rows.length, 3);
    assert.strictEqual(result.synthetic, 1);
    assert.strictEqual(result.expected, 3);
    assert.strictEqual(result.actual, 2);
    // Real rows come first, unchanged
    assert.strictEqual(result.rows[0], actual[0]);
    assert.strictEqual(result.rows[1], actual[1]);
    // Synthetic row carries the marker and the next sequential number
    assert.strictEqual(result.rows[2]._synthetic, true);
    assert.strictEqual(result.rows[2].room_num, '3');
});

test('synthetic numbering seeds from max(existingRoomNums) + 1 (not from count)', function () {
    // Real row has room_num="5" while M=1 < N=3. Synthetic rows must be 6 and 7.
    const actual = [{ key: 'L__5', level_name: 'L', room_num: '5', roomName: 'قاعة 5' }];
    const result = computeEffectiveRoomRows('L', actual, { L: { rooms: 3 } });
    assert.strictEqual(result.rows.length, 3);
    assert.strictEqual(result.rows[1].room_num, '6');
    assert.strictEqual(result.rows[2].room_num, '7');
});

test('non-numeric room_num in actualRows → synthetic numbering restarts at 1', function () {
    // computeMaxRoomNum returns 0 for unparseable rows, so synthetic rows
    // start at 1 (documented behaviour of the helper).
    const actual = [{ key: 'L__abc', level_name: 'L', room_num: 'abc' }];
    const result = computeEffectiveRoomRows('L', actual, { L: { rooms: 2 } });
    assert.strictEqual(result.rows.length, 2);
    assert.strictEqual(result.synthetic, 1);
    assert.strictEqual(result.rows[1].room_num, '1');
});

test('real rows appear before synthetic rows (order preservation)', function () {
    const r1 = { key: 'L__1', level_name: 'L', room_num: '1' };
    const r2 = { key: 'L__2', level_name: 'L', room_num: '2' };
    const result = computeEffectiveRoomRows('L', [r1, r2], { L: { rooms: 4 } });
    assert.strictEqual(result.rows[0], r1);
    assert.strictEqual(result.rows[1], r2);
    assert.strictEqual(result.rows[2]._synthetic, true);
    assert.strictEqual(result.rows[3]._synthetic, true);
});

test('every appended row past actualRows.length carries _synthetic: true', function () {
    const actual = [{ key: 'L__1', level_name: 'L', room_num: '1' }];
    const result = computeEffectiveRoomRows('L', actual, { L: { rooms: 5 } });
    for (let i = 0; i < result.rows.length; i++) {
        if (i < actual.length) {
            assert.ok(!result.rows[i]._synthetic, 'index ' + i + ' must not be synthetic');
        } else {
            assert.strictEqual(result.rows[i]._synthetic, true, 'index ' + i + ' must be synthetic');
        }
    }
});

// ----------------------------------------------------------------------------
// Non-bug-condition cases: actualRows returned as-is
// ----------------------------------------------------------------------------
console.log('\n  --- preservation (no synthetic rows) ---');

test('M == N → returns actualRows unchanged, synthetic=0', function () {
    const actual = [
        { key: 'L__1', level_name: 'L', room_num: '1' },
        { key: 'L__2', level_name: 'L', room_num: '2' }
    ];
    const result = computeEffectiveRoomRows('L', actual, { L: { rooms: 2 } });
    assert.strictEqual(result.rows, actual); // same reference
    assert.strictEqual(result.synthetic, 0);
    assert.strictEqual(result.expected, 2);
    assert.strictEqual(result.actual, 2);
});

test('M > N (unusual) → returns actualRows unchanged, no truncation, no synthetic', function () {
    // Design explicitly states the fix never shrinks actual rows.
    const actual = [
        { key: 'L__1', room_num: '1' },
        { key: 'L__2', room_num: '2' },
        { key: 'L__3', room_num: '3' }
    ];
    const result = computeEffectiveRoomRows('L', actual, { L: { rooms: 2 } });
    assert.strictEqual(result.rows, actual);
    assert.strictEqual(result.rows.length, 3);
    assert.strictEqual(result.synthetic, 0);
});

test('N = 0 → returns actualRows unchanged, no synthetic', function () {
    const actual = [{ key: 'L__1', room_num: '1' }];
    const result = computeEffectiveRoomRows('L', actual, { L: { rooms: 0 } });
    assert.strictEqual(result.rows, actual);
    assert.strictEqual(result.synthetic, 0);
    assert.strictEqual(result.expected, 0);
});

test('level missing from the map → returns actualRows unchanged', function () {
    const actual = [{ key: 'L__1', room_num: '1' }];
    const result = computeEffectiveRoomRows('L', actual, { OTHER: { rooms: 5 } });
    assert.strictEqual(result.rows, actual);
    assert.strictEqual(result.synthetic, 0);
    assert.strictEqual(result.expected, 0);
});

test('empty map ({}) → returns actualRows unchanged', function () {
    const actual = [{ key: 'L__1', room_num: '1' }];
    const result = computeEffectiveRoomRows('L', actual, {});
    assert.strictEqual(result.rows, actual);
    assert.strictEqual(result.synthetic, 0);
});

test('map = null → returns actualRows unchanged (fallback path)', function () {
    const actual = [{ key: 'L__1', room_num: '1' }];
    const result = computeEffectiveRoomRows('L', actual, null);
    assert.strictEqual(result.rows, actual);
    assert.strictEqual(result.synthetic, 0);
    assert.strictEqual(result.expected, 0);
});

test('map = undefined → returns actualRows unchanged', function () {
    const actual = [{ key: 'L__1', room_num: '1' }];
    const result = computeEffectiveRoomRows('L', actual, undefined);
    assert.strictEqual(result.rows, actual);
    assert.strictEqual(result.synthetic, 0);
});

test('level entry with rooms=null → treated as N=0 → actualRows unchanged', function () {
    const actual = [{ key: 'L__1', room_num: '1' }];
    const result = computeEffectiveRoomRows('L', actual, { L: { rooms: null } });
    assert.strictEqual(result.rows, actual);
    assert.strictEqual(result.synthetic, 0);
});

test('level entry with non-numeric rooms → treated as N=0 → actualRows unchanged', function () {
    const actual = [{ key: 'L__1', room_num: '1' }];
    const result = computeEffectiveRoomRows('L', actual, { L: { rooms: 'abc' } });
    assert.strictEqual(result.rows, actual);
    assert.strictEqual(result.synthetic, 0);
    assert.strictEqual(result.expected, 0);
});

test('actualRows not an array (null) → treated as empty → synthetic up to N', function () {
    // Defensive: if an upstream change ever breaks getRoomRowsForLevel we still
    // behave sanely instead of throwing.
    const result = computeEffectiveRoomRows('L', null, { L: { rooms: 2 } });
    assert.strictEqual(result.rows.length, 2);
    assert.strictEqual(result.synthetic, 2);
    assert.strictEqual(result.actual, 0);
});

// ----------------------------------------------------------------------------
// Arabic level names (real-world data shape)
// ----------------------------------------------------------------------------
console.log('\n  --- real-world names ---');

test('Arabic level name → synthetic rows echo it in key / level_name', function () {
    const levelName = 'الأولى باكالوريا العلوم الرياضية - رسميون';
    const result = computeEffectiveRoomRows(levelName, [], { [levelName]: { rooms: 2 } });
    assert.strictEqual(result.rows.length, 2);
    assert.strictEqual(result.rows[0].level_name, levelName);
    assert.strictEqual(result.rows[0].key, levelName + '__1__synthetic');
    assert.strictEqual(result.rows[1].level_name, levelName);
    assert.strictEqual(result.rows[1].key, levelName + '__2__synthetic');
});

// ----------------------------------------------------------------------------
// Kick off
// ----------------------------------------------------------------------------
runAll();
