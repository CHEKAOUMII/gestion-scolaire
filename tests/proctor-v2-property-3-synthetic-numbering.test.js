/**
 * Property 3 — Synthetic room numbering never collides with actual room_num
 *
 * Validates: Requirements 2.3
 *
 * For every level L that receives synthetic rows from the fixed buildV2Input
 * pipeline, the property guarantees three things:
 *
 *   (a) Every synthetic row in roomsList[L] carries room_num strictly greater
 *       than max(room_num) across actual rows (or > 0 when no actual rows
 *       parse to a finite number).
 *   (b) The synthetic room_num values are contiguous starting at max + 1, i.e.
 *       [max+1, max+2, ..., max+missing].
 *   (c) No synthetic room_num collides with any actual room_num for that
 *       level — even when actual numbers are sparse (e.g. ["1","5","10"]).
 *
 * Isolation strategy:
 *   The production helpers (`computeEffectiveRoomRows`, `computeMaxRoomNum`,
 *   `buildSyntheticRoomRow`) live inside a `<script>` block in
 *   `exams-proctors.html` and cannot be require()'d directly. We mirror them
 *   verbatim here, matching the convention used by:
 *     - tests/proctor-v2-effective-room-rows.test.js
 *     - tests/proctor-v2-use-exam-center-levels-exploration.test.js
 *   If the production helpers change, update these mirrors.
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
// Property 3 assertion helper — shared by unit cases and the PBT loop.
//   Throws on violation; otherwise returns silently.
// ----------------------------------------------------------------------------
function assertProperty3(levelName, actualRows, examCenterLevelsMap) {
    const result = computeEffectiveRoomRows(levelName, actualRows, examCenterLevelsMap);

    // Bucket real vs synthetic rows using the `_synthetic` marker.
    const syntheticRows = result.rows.filter(function (r) { return r && r._synthetic === true; });
    const syntheticNums = syntheticRows.map(function (r) { return parseInt(r.room_num, 10); });

    // Collect numeric room_num values from the *actual* rows only.
    const actualNumList = (Array.isArray(actualRows) ? actualRows : [])
        .map(function (r) { return parseInt(r && r.room_num, 10); })
        .filter(function (n) { return Number.isFinite(n); });
    const actualNumSet = new Set(actualNumList);
    const maxActual = actualNumList.length > 0 ? Math.max.apply(null, actualNumList) : 0;

    // (a) No synthetic num appears in the actual set (non-collision).
    syntheticNums.forEach(function (n) {
        assert.ok(!actualNumSet.has(n),
            'synthetic room_num ' + n + ' collides with an actual row for level "' + levelName + '"');
    });

    // (b) Every synthetic num is strictly > maxActual.
    syntheticNums.forEach(function (n) {
        assert.ok(n > maxActual,
            'synthetic room_num ' + n + ' must be > maxActual=' + maxActual +
            ' for level "' + levelName + '"');
    });

    // (c) Synthetic nums are contiguous starting from maxActual + 1.
    syntheticNums.forEach(function (n, i) {
        assert.strictEqual(n, maxActual + 1 + i,
            'expected synthetic[' + i + '] = ' + (maxActual + 1 + i) +
            ', got ' + n + ' for level "' + levelName + '"');
    });

    return result;
}

// ----------------------------------------------------------------------------
// Minimal test harness (same shape as sibling tests).
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

// Deterministic LCG — identical to sibling exploration test for consistency.
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

// ============================================================================
// Unit cases — explicit examples from tasks.md §4.1
// ============================================================================

console.log('[test] proctor-v2 — Property 3: synthetic numbering non-overlap (Task 4.1)');
console.log('\n  --- Explicit unit cases ---');

runTest('actualRows with room_num ["1","5","10"], N=13 → synthetic = [11..20]', function () {
    // NOTE: the design rule is `missing = expected - actualRows.length`, so
    // with M=3 actual rows and N=13 expected rooms the pipeline produces
    // 10 synthetic rows (not 3). Property 3 still holds: every synthetic
    // room_num is > max(actualNums)=10 and the series is contiguous.
    const L = 'مستوى أرقام متفرِّقة';
    const actual = [
        { key: L + '__1', level_name: L, room_num: '1', roomName: 'قاعة 1' },
        { key: L + '__5', level_name: L, room_num: '5', roomName: 'قاعة 5' },
        { key: L + '__10', level_name: L, room_num: '10', roomName: 'قاعة 10' }
    ];
    const result = assertProperty3(L, actual, { [L]: { rooms: 13 } });
    const syntheticNums = result.rows
        .filter(function (r) { return r._synthetic; })
        .map(function (r) { return parseInt(r.room_num, 10); });
    assert.deepStrictEqual(syntheticNums, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
});

runTest('actualRows with room_num ["3","7"], N=5 → synthetic = [8, 9, 10]', function () {
    const L = 'L';
    const actual = [
        { key: L + '__3', level_name: L, room_num: '3', roomName: 'قاعة 3' },
        { key: L + '__7', level_name: L, room_num: '7', roomName: 'قاعة 7' }
    ];
    const result = assertProperty3(L, actual, { [L]: { rooms: 5 } });
    const syntheticNums = result.rows
        .filter(function (r) { return r._synthetic; })
        .map(function (r) { return parseInt(r.room_num, 10); });
    assert.deepStrictEqual(syntheticNums, [8, 9, 10]);
});

runTest('actualRows with room_num ["1"], N=4 → synthetic = [2, 3, 4]', function () {
    const L = 'L';
    const actual = [
        { key: L + '__1', level_name: L, room_num: '1', roomName: 'قاعة 1' }
    ];
    const result = assertProperty3(L, actual, { [L]: { rooms: 4 } });
    const syntheticNums = result.rows
        .filter(function (r) { return r._synthetic; })
        .map(function (r) { return parseInt(r.room_num, 10); });
    assert.deepStrictEqual(syntheticNums, [2, 3, 4]);
});

runTest('actualRows = [], N=3 → synthetic = [1, 2, 3] (seeded from 0 + 1)', function () {
    const L = 'L';
    const result = assertProperty3(L, [], { [L]: { rooms: 3 } });
    const syntheticNums = result.rows
        .filter(function (r) { return r._synthetic; })
        .map(function (r) { return parseInt(r.room_num, 10); });
    assert.deepStrictEqual(syntheticNums, [1, 2, 3]);
});

runTest('actualRows with non-numeric room_num ["abc"], N=2 → synthetic = [1]', function () {
    // computeMaxRoomNum returns 0 when no row parses as a finite integer, so
    // synthetic numbering restarts at 1. missing = N - M = 2 - 1 = 1, so only
    // one synthetic row is produced. The non-collision assertion is vacuous
    // here because the set of numeric actual nums is empty.
    const L = 'L';
    const actual = [
        { key: L + '__abc', level_name: L, room_num: 'abc', roomName: 'قاعة abc' }
    ];
    const result = assertProperty3(L, actual, { [L]: { rooms: 2 } });
    const syntheticNums = result.rows
        .filter(function (r) { return r._synthetic; })
        .map(function (r) { return parseInt(r.room_num, 10); });
    assert.deepStrictEqual(syntheticNums, [1]);
});

// ============================================================================
// Property-based loop — 100 iterations, scoped to bug-condition inputs so
// synthetic rows are always produced and the property actually has content
// to check.
// ============================================================================

console.log('\n  --- Property-based loop (seed=20260325, 100 iterations) ---');

// Generator: produces actualRows with sparse, non-sequential room_num values
// plus an N strictly larger than actualRows.length so synthetic rows exist.
function genPropertyInput(rng) {
    const levelName = 'مستوى PBT ' + Math.floor(rng() * 1e6);
    const M = randInt(rng, 0, 6);          // 0..6 actual rows
    const extra = randInt(rng, 1, 4);       // 1..4 synthetic rows required
    const N = M + extra;

    // Draw M distinct room_num values in 1..20 (sparse, unordered).
    const used = new Set();
    const actualRows = [];
    while (actualRows.length < M) {
        const num = randInt(rng, 1, 20);
        if (used.has(num)) continue;
        used.add(num);
        actualRows.push({
            key: levelName + '__' + num,
            level_name: levelName,
            room_num: String(num),
            roomName: 'قاعة ' + num,
            count: 25,
            firstNum: 1,
            lastNum: 25
        });
    }

    return {
        levelName: levelName,
        actualRows: actualRows,
        examCenterLevelsMap: { [levelName]: { rooms: N, subjects: ['subj'] } },
        expectedSyntheticCount: extra
    };
}

runTest('Property 3 holds across 100 generated inputs with sparse actual numbering', function () {
    const rng = makeLCG(20260325);
    const ITER = 100;
    let produced = 0;

    for (let i = 0; i < ITER; i++) {
        const input = genPropertyInput(rng);
        const result = assertProperty3(input.levelName, input.actualRows, input.examCenterLevelsMap);

        // Sanity: the generator always forces missing > 0, so synthetic rows
        // must have been produced.
        assert.strictEqual(result.synthetic, input.expectedSyntheticCount,
            'iteration ' + i + ': expected ' + input.expectedSyntheticCount +
            ' synthetic rows, got ' + result.synthetic);
        produced += result.synthetic;
    }

    // A weak but useful coverage signal: at least one synthetic row per
    // iteration on average.
    assert.ok(produced >= ITER,
        'expected at least ' + ITER + ' synthetic rows produced across all iterations, got ' + produced);
});

// ============================================================================
// Summary
// ============================================================================
console.log('\n[test] proctor-v2 — Property 3: ' + passed + ' passed, ' + failed + ' failed');

if (failed > 0) {
    console.log('\n=== FAILURES ===');
    console.log(JSON.stringify(failures, null, 2));
    process.exit(1);
}
