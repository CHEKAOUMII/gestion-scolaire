/**
 * Unit test — getExamCenterLevelsForActiveYear / buildExamCenterLevelsMap
 * (Task 3.1)
 *
 * Validates: Requirements 2.1, 2.5, 2.7
 *
 * The production code lives in `exams-proctors.html` inside a `<script>` that
 * depends on `window`, DOM globals and a renderer-side `year` variable, so we
 * cannot `require` it here. Instead we mirror the pure `buildExamCenterLevelsMap`
 * helper (verbatim from the HTML) and test it directly. The async wrapper
 * `getExamCenterLevelsForActiveYear` is also exercised end-to-end through a
 * stubbed `window.api.examConfig.get` so the full contract (null / undefined
 * / non-array / populated) is covered.
 *
 * IMPORTANT: if the production `buildExamCenterLevelsMap` changes, this mirror
 * MUST be updated to match. See `exams-proctors.html` §"buildExamCenterLevelsMap".
 */

'use strict';

const assert = require('assert');

// ----------------------------------------------------------------------------
// Mirror of the production `buildExamCenterLevelsMap` helper in
// exams-proctors.html. Keep in sync.
// ----------------------------------------------------------------------------
function buildExamCenterLevelsMap(rawArray) {
    const map = Object.create(null);
    if (!Array.isArray(rawArray)) return map;
    for (const level of rawArray) {
        if (!level || !level.name) continue;
        map[level.name] = {
            rooms: Number(level.rooms) || 0,
            subjects: Array.isArray(level.subjects) ? level.subjects : []
        };
    }
    return map;
}

// ----------------------------------------------------------------------------
// Harness that mirrors the production async wrapper `getExamCenterLevelsForActiveYear`.
// Uses a stubbed `api.examConfig.get` so we can control the returned value and
// also observe the key/year passed by the wrapper.
// ----------------------------------------------------------------------------
function makeHarness(returnedValue) {
    const calls = [];
    const api = {
        examConfig: {
            get: async function (yr, key) {
                calls.push({ yr: yr, key: key });
                return returnedValue;
            }
        }
    };
    const year = '2025/2026';
    async function getExamCenterLevelsForActiveYear() {
        const raw = (await api.examConfig.get(year, 'examCenterLevels')) || [];
        return buildExamCenterLevelsMap(raw);
    }
    return { getExamCenterLevelsForActiveYear: getExamCenterLevelsForActiveYear, calls: calls, year: year };
}

// ----------------------------------------------------------------------------
// Test harness
// ----------------------------------------------------------------------------
const tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

async function runAll() {
    let passed = 0;
    let failed = 0;
    const failures = [];

    for (const t of tests) {
        try {
            await t.fn();
            console.log('  [pass] ' + t.name);
            passed++;
        } catch (e) {
            console.log('  [FAIL] ' + t.name + ': ' + e.message);
            failed++;
            failures.push({ name: t.name, message: e.message });
        }
    }

    console.log('\n[test] getExamCenterLevelsForActiveYear: ' + passed + ' passed, ' + failed + ' failed');

    if (failed > 0) {
        console.log('\n=== FAILURES ===');
        console.log(JSON.stringify(failures, null, 2));
        process.exit(1);
    }
}

// ----------------------------------------------------------------------------
// Tests — pure helper `buildExamCenterLevelsMap`
// ----------------------------------------------------------------------------

console.log('[test] getExamCenterLevelsForActiveYear (Task 3.1)');
console.log('\n  --- buildExamCenterLevelsMap (pure) ---');

test('null input → empty map', function () {
    const m = buildExamCenterLevelsMap(null);
    assert.deepStrictEqual(Object.keys(m), []);
});

test('undefined input → empty map', function () {
    const m = buildExamCenterLevelsMap(undefined);
    assert.deepStrictEqual(Object.keys(m), []);
});

test('empty array → empty map', function () {
    const m = buildExamCenterLevelsMap([]);
    assert.deepStrictEqual(Object.keys(m), []);
});

test('non-array input (object) → empty map', function () {
    const m = buildExamCenterLevelsMap({ name: 'L1', rooms: 2 });
    assert.deepStrictEqual(Object.keys(m), []);
});

test('single fully-populated level → { L1: { rooms: 2, subjects: [a,b] } }', function () {
    const m = buildExamCenterLevelsMap([{ name: 'L1', rooms: 2, subjects: ['a', 'b'] }]);
    assert.deepStrictEqual(m['L1'], { rooms: 2, subjects: ['a', 'b'] });
    assert.strictEqual(Object.keys(m).length, 1);
});

test('level missing rooms → rooms defaults to 0', function () {
    const m = buildExamCenterLevelsMap([{ name: 'L2' }]);
    assert.deepStrictEqual(m['L2'], { rooms: 0, subjects: [] });
});

test('level with non-numeric rooms → rooms defaults to 0', function () {
    const m = buildExamCenterLevelsMap([{ name: 'L3', rooms: 'abc' }]);
    assert.deepStrictEqual(m['L3'], { rooms: 0, subjects: [] });
});

test('level with numeric string rooms ("5") → coerced to 5', function () {
    // Number('5') === 5; documents coercion semantics explicitly.
    const m = buildExamCenterLevelsMap([{ name: 'L3b', rooms: '5' }]);
    assert.deepStrictEqual(m['L3b'], { rooms: 5, subjects: [] });
});

test('level missing subjects → subjects defaults to []', function () {
    const m = buildExamCenterLevelsMap([{ name: 'L4', rooms: 3 }]);
    assert.deepStrictEqual(m['L4'], { rooms: 3, subjects: [] });
});

test('level with non-array subjects → subjects defaults to []', function () {
    const m = buildExamCenterLevelsMap([{ name: 'L5', rooms: 3, subjects: 'math' }]);
    assert.deepStrictEqual(m['L5'], { rooms: 3, subjects: [] });
});

test('element without name → skipped', function () {
    const m = buildExamCenterLevelsMap([{ rooms: 3, subjects: ['x'] }]);
    assert.deepStrictEqual(Object.keys(m), []);
});

test('null element → skipped (no throw)', function () {
    const m = buildExamCenterLevelsMap([null, { name: 'OK', rooms: 1 }]);
    assert.deepStrictEqual(Object.keys(m), ['OK']);
    assert.deepStrictEqual(m['OK'], { rooms: 1, subjects: [] });
});

test('mixed array: valid + null + nameless + valid → only valid kept', function () {
    const m = buildExamCenterLevelsMap([
        { name: 'A', rooms: 1, subjects: ['s1'] },
        null,
        { rooms: 1, subjects: ['dropped'] },
        { name: 'B', rooms: 1 }
    ]);
    assert.deepStrictEqual(Object.keys(m).sort(), ['A', 'B']);
    assert.deepStrictEqual(m['A'], { rooms: 1, subjects: ['s1'] });
    assert.deepStrictEqual(m['B'], { rooms: 1, subjects: [] });
});

test('empty name ("") → skipped', function () {
    const m = buildExamCenterLevelsMap([{ name: '', rooms: 2 }]);
    assert.deepStrictEqual(Object.keys(m), []);
});

test('duplicate name → last occurrence wins', function () {
    const m = buildExamCenterLevelsMap([
        { name: 'dup', rooms: 1, subjects: ['x'] },
        { name: 'dup', rooms: 4, subjects: ['y', 'z'] }
    ]);
    assert.deepStrictEqual(m['dup'], { rooms: 4, subjects: ['y', 'z'] });
});

// ----------------------------------------------------------------------------
// Tests — async wrapper `getExamCenterLevelsForActiveYear`
// ----------------------------------------------------------------------------

test('wrapper: config.get returns null → empty map, called with correct year + key', async function () {
    const h = makeHarness(null);
    const m = await h.getExamCenterLevelsForActiveYear();
    assert.deepStrictEqual(Object.keys(m), []);
    assert.strictEqual(h.calls.length, 1);
    assert.strictEqual(h.calls[0].yr, h.year);
    assert.strictEqual(h.calls[0].key, 'examCenterLevels');
});

test('wrapper: config.get returns undefined → empty map', async function () {
    const h = makeHarness(undefined);
    const m = await h.getExamCenterLevelsForActiveYear();
    assert.deepStrictEqual(Object.keys(m), []);
});

test('wrapper: config.get returns [] → empty map', async function () {
    const h = makeHarness([]);
    const m = await h.getExamCenterLevelsForActiveYear();
    assert.deepStrictEqual(Object.keys(m), []);
});

test('wrapper: config.get returns populated array → full map', async function () {
    const h = makeHarness([
        { name: 'الأولى باكالوريا', rooms: 2, subjects: ['math', 'physics'] },
        { name: 'الثانية باكالوريا', rooms: 3, subjects: ['arabic'] }
    ]);
    const m = await h.getExamCenterLevelsForActiveYear();
    assert.deepStrictEqual(m['الأولى باكالوريا'], { rooms: 2, subjects: ['math', 'physics'] });
    assert.deepStrictEqual(m['الثانية باكالوريا'], { rooms: 3, subjects: ['arabic'] });
});

test('wrapper: config.get returns array with nameless + null entries → only valid kept', async function () {
    const h = makeHarness([
        null,
        { rooms: 5 },
        { name: 'L', rooms: 1 }
    ]);
    const m = await h.getExamCenterLevelsForActiveYear();
    assert.deepStrictEqual(Object.keys(m), ['L']);
});

// ----------------------------------------------------------------------------
// Kick off
// ----------------------------------------------------------------------------
runAll().catch(function (e) {
    console.error('[test] unexpected error:', e);
    process.exit(1);
});
