/**
 * Unit test — buildSyntheticRoomRow / computeMaxRoomNum (Task 3.2)
 *
 * Validates: Requirements 2.1, 2.3
 *
 * The production helpers live inside a `<script>` block in
 * `exams-proctors.html` that depends on `window` globals and cannot be
 * `require`d directly. As with the Task 3.1 test, we mirror the pure helpers
 * verbatim here and exercise them. If the production helpers change, this
 * mirror MUST be updated.
 *
 * See:
 *   - exams-proctors.html §"buildSyntheticRoomRow"
 *   - exams-proctors.html §"computeMaxRoomNum"
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

    console.log('\n[test] synthetic room helpers: ' + passed + ' passed, ' + failed + ' failed');

    if (failed > 0) {
        console.log('\n=== FAILURES ===');
        console.log(JSON.stringify(failures, null, 2));
        process.exit(1);
    }
}

console.log('[test] buildSyntheticRoomRow / computeMaxRoomNum (Task 3.2)');

// ----------------------------------------------------------------------------
// computeMaxRoomNum tests
// ----------------------------------------------------------------------------
console.log('\n  --- computeMaxRoomNum ---');

test('empty array → 0', function () {
    assert.strictEqual(computeMaxRoomNum([]), 0);
});

test('null input → 0', function () {
    assert.strictEqual(computeMaxRoomNum(null), 0);
});

test('undefined input → 0', function () {
    assert.strictEqual(computeMaxRoomNum(undefined), 0);
});

test('non-array (object) → 0', function () {
    assert.strictEqual(computeMaxRoomNum({ room_num: '5' }), 0);
});

test('three distinct room_num strings → largest', function () {
    const rows = [{ room_num: '1' }, { room_num: '5' }, { room_num: '3' }];
    assert.strictEqual(computeMaxRoomNum(rows), 5);
});

test('double-digit vs single-digit string → numeric (not lexicographic) max', function () {
    const rows = [{ room_num: '10' }, { room_num: '2' }];
    assert.strictEqual(computeMaxRoomNum(rows), 10);
});

test('mixed valid + null + non-numeric → ignores invalid, returns max of valid', function () {
    const rows = [{ room_num: '1' }, { room_num: null }, { room_num: 'abc' }];
    assert.strictEqual(computeMaxRoomNum(rows), 1);
});

test('all non-numeric / null → 0', function () {
    const rows = [{ room_num: 'x' }, { room_num: null }];
    assert.strictEqual(computeMaxRoomNum(rows), 0);
});

test('all rows missing room_num field → 0', function () {
    const rows = [{ foo: 1 }, { bar: 2 }];
    assert.strictEqual(computeMaxRoomNum(rows), 0);
});

test('array containing null entries → skipped without throwing', function () {
    const rows = [null, { room_num: '4' }, null];
    assert.strictEqual(computeMaxRoomNum(rows), 4);
});

test('room_num as a number (not string) → parseInt accepts it', function () {
    const rows = [{ room_num: 7 }];
    assert.strictEqual(computeMaxRoomNum(rows), 7);
});

test('negative room_num string → ignored (not > 0)', function () {
    // parseInt('-3', 10) === -3; max starts at 0 so negative values never win.
    const rows = [{ room_num: '-3' }];
    assert.strictEqual(computeMaxRoomNum(rows), 0);
});

test('room_num="0" → returns 0 (neither > max nor invalid)', function () {
    const rows = [{ room_num: '0' }];
    assert.strictEqual(computeMaxRoomNum(rows), 0);
});

test('single large value → returned as-is', function () {
    const rows = [{ room_num: '999' }];
    assert.strictEqual(computeMaxRoomNum(rows), 999);
});

test('string with trailing chars ("5abc") → parseInt parses leading digits', function () {
    // Documents parseInt semantics: "5abc" → 5. Real persisted keys are always
    // pure digits, but the helper stays tolerant.
    const rows = [{ room_num: '5abc' }];
    assert.strictEqual(computeMaxRoomNum(rows), 5);
});

// ----------------------------------------------------------------------------
// buildSyntheticRoomRow tests
// ----------------------------------------------------------------------------
console.log('\n  --- buildSyntheticRoomRow ---');

test('produces object matching design.md schema exactly', function () {
    const row = buildSyntheticRoomRow('L1', 3);
    assert.deepStrictEqual(row, {
        key: 'L1__3__synthetic',
        level_name: 'L1',
        room_num: '3',
        roomName: 'قاعة افتراضية 3',
        count: 0,
        firstNum: null,
        lastNum: null,
        _synthetic: true
    });
});

test('room_num is always a string (even when roomNum passed as number)', function () {
    const row = buildSyntheticRoomRow('L1', 3);
    assert.strictEqual(row.room_num, '3');
    assert.strictEqual(typeof row.room_num, 'string');
});

test('roomName uses Arabic template with numeric suffix', function () {
    const row = buildSyntheticRoomRow('L1', 3);
    assert.strictEqual(row.roomName, 'قاعة افتراضية 3');
});

test('_synthetic flag is boolean true', function () {
    const row = buildSyntheticRoomRow('L1', 3);
    assert.strictEqual(row._synthetic, true);
});

test('count=0, firstNum=null, lastNum=null (phase-2 neutral defaults)', function () {
    const row = buildSyntheticRoomRow('L1', 3);
    assert.strictEqual(row.count, 0);
    assert.strictEqual(row.firstNum, null);
    assert.strictEqual(row.lastNum, null);
});

test('key follows `<levelName>__<roomNum>__synthetic` pattern', function () {
    const row = buildSyntheticRoomRow('L1', 3);
    assert.strictEqual(row.key, 'L1__3__synthetic');
});

test('level_name echoes the provided argument verbatim', function () {
    const row = buildSyntheticRoomRow('الأولى باكالوريا', 2);
    assert.strictEqual(row.level_name, 'الأولى باكالوريا');
    assert.strictEqual(row.room_num, '2');
    assert.strictEqual(row.roomName, 'قاعة افتراضية 2');
    assert.strictEqual(row.key, 'الأولى باكالوريا__2__synthetic');
});

test('large room number (999) → all fields rendered correctly', function () {
    const row = buildSyntheticRoomRow('L1', 999);
    assert.strictEqual(row.key, 'L1__999__synthetic');
    assert.strictEqual(row.room_num, '999');
    assert.strictEqual(row.roomName, 'قاعة افتراضية 999');
    assert.strictEqual(row._synthetic, true);
});

test('produced object has exactly the 8 expected keys (no extras)', function () {
    const row = buildSyntheticRoomRow('L1', 3);
    const keys = Object.keys(row).sort();
    const expected = ['_synthetic', 'count', 'firstNum', 'key', 'lastNum', 'level_name', 'roomName', 'room_num'].sort();
    assert.deepStrictEqual(keys, expected);
});

test('integrates with computeMaxRoomNum: synthetic row yields the seeded number', function () {
    // Sanity check: synthetic rows themselves are valid inputs to
    // computeMaxRoomNum. A row built with roomNum=7 must be detected as 7.
    const row = buildSyntheticRoomRow('L1', 7);
    assert.strictEqual(computeMaxRoomNum([row]), 7);
});

// ----------------------------------------------------------------------------
// Kick off
// ----------------------------------------------------------------------------
runAll();
