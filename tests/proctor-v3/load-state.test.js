/**
 * Unit tests for js/algorithms/proctor-v3/utils/load-state.js
 *
 * Validates: Requirements 5.1, 6.4, 7.5
 *
 * Run directly:   node tests/proctor-v3/load-state.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

const {
    createLoadState,
    addGuardLoad,
    addDutyLoad,
    addReserveLoad,
    removeGuardLoad,
    decrementGuardLoad,
    incrementGuardLoad,
    primaryLoad,
    finalLoad,
    amCount,
    pmCount,
    isAmPeriod,
    isPmPeriod,
    AM_PERIODS,
    PM_PERIODS,
} = require(path.join(
    __dirname,
    '..',
    '..',
    'js',
    'algorithms',
    'proctor-v3',
    'utils',
    'load-state.js'
));

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed += 1;
        console.log(`  ok  ${name}`);
    } catch (err) {
        failed += 1;
        console.error(`  FAIL  ${name}`);
        console.error(err && err.stack ? err.stack : err);
    }
}

// ---------------------------------------------------------------------------
// createLoadState
// ---------------------------------------------------------------------------

test('createLoadState initializes all five counts to 0 for each canonical key', () => {
    const ls = createLoadState(['A1', 'A2', 'A3']);
    for (const key of ['A1', 'A2', 'A3']) {
        const e = ls.proctors[key];
        assert.ok(e, `entry for ${key} should exist`);
        assert.strictEqual(e.guardCount, 0);
        assert.strictEqual(e.dutyCount, 0);
        assert.strictEqual(e.reserveCount, 0);
        assert.strictEqual(e.amCount, 0);
        assert.strictEqual(e.pmCount, 0);
    }
});

test('createLoadState with empty array returns empty proctors map', () => {
    const ls = createLoadState([]);
    assert.deepStrictEqual(Object.keys(ls.proctors), []);
});

test('createLoadState with null returns empty proctors map (defensive)', () => {
    const ls = createLoadState(null);
    assert.deepStrictEqual(Object.keys(ls.proctors), []);
});

test('createLoadState with undefined returns empty proctors map (defensive)', () => {
    const ls = createLoadState(undefined);
    assert.deepStrictEqual(Object.keys(ls.proctors), []);
});

test('createLoadState ignores non-string and empty-string keys', () => {
    const ls = createLoadState(['A1', '', null, undefined, 42, 'A2']);
    assert.deepStrictEqual(Object.keys(ls.proctors).sort(), ['A1', 'A2']);
});

test('createLoadState dedupes repeated keys (idempotent)', () => {
    const ls = createLoadState(['A1', 'A1', 'A1']);
    assert.deepStrictEqual(Object.keys(ls.proctors), ['A1']);
    assert.strictEqual(ls.proctors.A1.guardCount, 0);
});

// ---------------------------------------------------------------------------
// addGuardLoad — slot-based, AM/PM bucketing
// ---------------------------------------------------------------------------

test('addGuardLoad increments guardCount on every call (3 calls → 3)', () => {
    const ls = createLoadState(['A1']);
    addGuardLoad(ls, 'A1', 'h1', 'd1', 's1', 'صباحا');
    addGuardLoad(ls, 'A1', 'h1', 'd1', 's1', 'صباحا');
    addGuardLoad(ls, 'A1', 'h2', 'd1', 's2', 'مساء');
    assert.strictEqual(ls.proctors.A1.guardCount, 3);
});

test('addGuardLoad with period = صباحا increments amCount only', () => {
    const ls = createLoadState(['A1']);
    addGuardLoad(ls, 'A1', 'h1', 'd1', 's1', 'صباحا');
    assert.strictEqual(ls.proctors.A1.amCount, 1);
    assert.strictEqual(ls.proctors.A1.pmCount, 0);
});

test('addGuardLoad with period = مساء increments pmCount only', () => {
    const ls = createLoadState(['A1']);
    addGuardLoad(ls, 'A1', 'h1', 'd1', 's1', 'مساء');
    assert.strictEqual(ls.proctors.A1.amCount, 0);
    assert.strictEqual(ls.proctors.A1.pmCount, 1);
});

test('addGuardLoad recognizes AM/morning English aliases', () => {
    const ls = createLoadState(['A1']);
    addGuardLoad(ls, 'A1', 'h1', 'd1', 's1', 'AM');
    addGuardLoad(ls, 'A1', 'h2', 'd2', 's2', 'morning');
    assert.strictEqual(ls.proctors.A1.amCount, 2);
    assert.strictEqual(ls.proctors.A1.pmCount, 0);
});

test('addGuardLoad recognizes PM/afternoon English aliases', () => {
    const ls = createLoadState(['A1']);
    addGuardLoad(ls, 'A1', 'h1', 'd1', 's1', 'PM');
    addGuardLoad(ls, 'A1', 'h2', 'd2', 's2', 'afternoon');
    assert.strictEqual(ls.proctors.A1.amCount, 0);
    assert.strictEqual(ls.proctors.A1.pmCount, 2);
});

test('addGuardLoad with unrecognized period increments neither am nor pm', () => {
    const ls = createLoadState(['A1']);
    addGuardLoad(ls, 'A1', 'h1', 'd1', 's1', 'noon');
    addGuardLoad(ls, 'A1', 'h1', 'd1', 's1', '');
    addGuardLoad(ls, 'A1', 'h1', 'd1', 's1', undefined);
    addGuardLoad(ls, 'A1', 'h1', 'd1', 's1', null);
    assert.strictEqual(ls.proctors.A1.guardCount, 4);
    assert.strictEqual(ls.proctors.A1.amCount, 0);
    assert.strictEqual(ls.proctors.A1.pmCount, 0);
});

test('addGuardLoad lazily creates entry for unknown key', () => {
    const ls = createLoadState([]);
    assert.strictEqual(ls.proctors.NEW, undefined);
    addGuardLoad(ls, 'NEW', 'h1', 'd1', 's1', 'صباحا');
    assert.ok(ls.proctors.NEW);
    assert.strictEqual(ls.proctors.NEW.guardCount, 1);
    assert.strictEqual(ls.proctors.NEW.amCount, 1);
});

test('addGuardLoad: amCount + pmCount equals guardCount when all periods are recognized', () => {
    const ls = createLoadState(['A1']);
    addGuardLoad(ls, 'A1', 'h1', 'd1', 's1', 'صباحا');
    addGuardLoad(ls, 'A1', 'h1', 'd1', 's2', 'صباحا');
    addGuardLoad(ls, 'A1', 'h2', 'd1', 's3', 'مساء');
    addGuardLoad(ls, 'A1', 'h2', 'd1', 's4', 'مساء');
    addGuardLoad(ls, 'A1', 'h2', 'd1', 's5', 'مساء');
    const e = ls.proctors.A1;
    assert.strictEqual(e.amCount + e.pmCount, e.guardCount,
        'invariant: amCount + pmCount === guardCount when all periods recognized');
});

// ---------------------------------------------------------------------------
// addDutyLoad — slot-based per call
// ---------------------------------------------------------------------------

test('addDutyLoad increments dutyCount on every call', () => {
    const ls = createLoadState(['A1']);
    addDutyLoad(ls, 'A1', 'h1');
    addDutyLoad(ls, 'A1', 'h2');
    addDutyLoad(ls, 'A1', 'h3');
    assert.strictEqual(ls.proctors.A1.dutyCount, 3);
});

test('addDutyLoad does not affect guard, reserve, am, or pm counts', () => {
    const ls = createLoadState(['A1']);
    addDutyLoad(ls, 'A1', 'h1');
    const e = ls.proctors.A1;
    assert.strictEqual(e.guardCount, 0);
    assert.strictEqual(e.reserveCount, 0);
    assert.strictEqual(e.amCount, 0);
    assert.strictEqual(e.pmCount, 0);
    assert.strictEqual(e.dutyCount, 1);
});

test('addDutyLoad lazily creates entry for unknown key', () => {
    const ls = createLoadState([]);
    addDutyLoad(ls, 'NEW', 'h1');
    assert.ok(ls.proctors.NEW);
    assert.strictEqual(ls.proctors.NEW.dutyCount, 1);
});

// ---------------------------------------------------------------------------
// addReserveLoad — CRITICAL: V3 slot-based (V2 was halfday-based)
// ---------------------------------------------------------------------------

test('CRITICAL: addReserveLoad increments reserveCount on EVERY call (slot-based)', () => {
    // V2 halfday-based bug: 3 calls for the SAME halfday → reserveCount = 1.
    // V3 slot-based: 3 calls → reserveCount = 3, regardless of halfday.
    const ls = createLoadState(['A1']);
    addReserveLoad(ls, 'A1', 'same_halfday', 'same_day');
    addReserveLoad(ls, 'A1', 'same_halfday', 'same_day');
    addReserveLoad(ls, 'A1', 'same_halfday', 'same_day');
    assert.strictEqual(ls.proctors.A1.reserveCount, 3,
        'V3 MUST be slot-based: 3 calls for same halfday → reserveCount = 3 (V2 would give 1)');
});

test('addReserveLoad with mixed halfdays still slot-based (5 calls → 5)', () => {
    const ls = createLoadState(['A1']);
    addReserveLoad(ls, 'A1', 'h1', 'd1');
    addReserveLoad(ls, 'A1', 'h1', 'd1');
    addReserveLoad(ls, 'A1', 'h2', 'd1');
    addReserveLoad(ls, 'A1', 'h3', 'd2');
    addReserveLoad(ls, 'A1', 'h3', 'd2');
    assert.strictEqual(ls.proctors.A1.reserveCount, 5);
});

test('addReserveLoad does not affect guard, duty, am, or pm counts', () => {
    const ls = createLoadState(['A1']);
    addReserveLoad(ls, 'A1', 'h1', 'd1');
    const e = ls.proctors.A1;
    assert.strictEqual(e.guardCount, 0);
    assert.strictEqual(e.dutyCount, 0);
    assert.strictEqual(e.amCount, 0);
    assert.strictEqual(e.pmCount, 0);
    assert.strictEqual(e.reserveCount, 1);
});

test('addReserveLoad lazily creates entry for unknown key', () => {
    const ls = createLoadState([]);
    addReserveLoad(ls, 'NEW', 'h1', 'd1');
    assert.ok(ls.proctors.NEW);
    assert.strictEqual(ls.proctors.NEW.reserveCount, 1);
});

// ---------------------------------------------------------------------------
// primaryLoad / finalLoad / amCount / pmCount accessors
// ---------------------------------------------------------------------------

test('primaryLoad = guardCount + dutyCount with mixed adds', () => {
    const ls = createLoadState(['A1']);
    addGuardLoad(ls, 'A1', 'h1', 'd1', 's1', 'صباحا');
    addGuardLoad(ls, 'A1', 'h2', 'd2', 's2', 'مساء');
    addDutyLoad(ls, 'A1', 'h3');
    addReserveLoad(ls, 'A1', 'h4', 'd3'); // reserve must NOT count toward primary
    assert.strictEqual(primaryLoad(ls, 'A1'), 3, 'primaryLoad = 2 guards + 1 duty');
});

test('finalLoad = guardCount + dutyCount + reserveCount', () => {
    const ls = createLoadState(['A1']);
    addGuardLoad(ls, 'A1', 'h1', 'd1', 's1', 'صباحا');
    addGuardLoad(ls, 'A1', 'h2', 'd2', 's2', 'مساء');
    addDutyLoad(ls, 'A1', 'h3');
    addReserveLoad(ls, 'A1', 'h4', 'd3');
    addReserveLoad(ls, 'A1', 'h5', 'd4');
    assert.strictEqual(finalLoad(ls, 'A1'), 5, 'finalLoad = 2 guards + 1 duty + 2 reserves');
});

test('primaryLoad returns 0 for missing key (defensive)', () => {
    const ls = createLoadState(['A1']);
    assert.strictEqual(primaryLoad(ls, 'GHOST'), 0);
});

test('finalLoad returns 0 for missing key (defensive)', () => {
    const ls = createLoadState(['A1']);
    assert.strictEqual(finalLoad(ls, 'GHOST'), 0);
});

test('amCount returns 0 for missing key (defensive)', () => {
    const ls = createLoadState(['A1']);
    assert.strictEqual(amCount(ls, 'GHOST'), 0);
});

test('pmCount returns 0 for missing key (defensive)', () => {
    const ls = createLoadState(['A1']);
    assert.strictEqual(pmCount(ls, 'GHOST'), 0);
});

test('amCount and pmCount return correct counts after mixed adds', () => {
    const ls = createLoadState(['A1']);
    addGuardLoad(ls, 'A1', 'h1', 'd1', 's1', 'صباحا');
    addGuardLoad(ls, 'A1', 'h1', 'd1', 's2', 'صباحا');
    addGuardLoad(ls, 'A1', 'h2', 'd1', 's3', 'مساء');
    assert.strictEqual(amCount(ls, 'A1'), 2);
    assert.strictEqual(pmCount(ls, 'A1'), 1);
});

test('accessors return 0 for keys present with all zero counts', () => {
    const ls = createLoadState(['A1']);
    assert.strictEqual(primaryLoad(ls, 'A1'), 0);
    assert.strictEqual(finalLoad(ls, 'A1'), 0);
    assert.strictEqual(amCount(ls, 'A1'), 0);
    assert.strictEqual(pmCount(ls, 'A1'), 0);
});

// ---------------------------------------------------------------------------
// Integration: multiple proctors, mixed adds
// ---------------------------------------------------------------------------

test('multiple proctors tracked independently', () => {
    const ls = createLoadState(['A1', 'A2', 'A3']);
    addGuardLoad(ls, 'A1', 'h1', 'd1', 's1', 'صباحا');
    addGuardLoad(ls, 'A2', 'h1', 'd1', 's1', 'صباحا');
    addGuardLoad(ls, 'A2', 'h2', 'd1', 's2', 'مساء');
    addDutyLoad(ls, 'A3', 'h1');
    addReserveLoad(ls, 'A1', 'h2', 'd1');

    assert.strictEqual(primaryLoad(ls, 'A1'), 1);
    assert.strictEqual(primaryLoad(ls, 'A2'), 2);
    assert.strictEqual(primaryLoad(ls, 'A3'), 1);
    assert.strictEqual(finalLoad(ls, 'A1'), 2);
    assert.strictEqual(finalLoad(ls, 'A2'), 2);
    assert.strictEqual(finalLoad(ls, 'A3'), 1);
    assert.strictEqual(amCount(ls, 'A2'), 1);
    assert.strictEqual(pmCount(ls, 'A2'), 1);
});

// ---------------------------------------------------------------------------
// Defensive type-checking on add* functions
// ---------------------------------------------------------------------------

test('add* functions reject empty string key', () => {
    const ls = createLoadState([]);
    assert.throws(() => addGuardLoad(ls, '', 'h', 'd', 's', 'صباحا'), TypeError);
    assert.throws(() => addDutyLoad(ls, '', 'h'), TypeError);
    assert.throws(() => addReserveLoad(ls, '', 'h', 'd'), TypeError);
});

test('add* functions reject non-string key', () => {
    const ls = createLoadState([]);
    assert.throws(() => addGuardLoad(ls, null, 'h', 'd', 's', 'صباحا'), TypeError);
    assert.throws(() => addDutyLoad(ls, 42, 'h'), TypeError);
    assert.throws(() => addReserveLoad(ls, undefined, 'h', 'd'), TypeError);
});

test('add* functions reject malformed loadState', () => {
    assert.throws(() => addGuardLoad(null, 'A1', 'h', 'd', 's', 'صباحا'), TypeError);
    assert.throws(() => addDutyLoad({}, 'A1', 'h'), TypeError);
    assert.throws(() => addReserveLoad({ proctors: null }, 'A1', 'h', 'd'), TypeError);
});

// ---------------------------------------------------------------------------
// removeGuardLoad / incrementGuardLoad / period SSOT (repair-phase API)
// ---------------------------------------------------------------------------

test('removeGuardLoad decrements guard and AM/PM; floors at 0', () => {
    const ls = createLoadState(['A1']);
    addGuardLoad(ls, 'A1', 'h1', 'd1', 's1', 'صباحا');
    addGuardLoad(ls, 'A1', 'h2', 'd1', 's2', 'زوالا');
    assert.strictEqual(ls.proctors.A1.guardCount, 2);
    assert.strictEqual(amCount(ls, 'A1'), 1);
    assert.strictEqual(pmCount(ls, 'A1'), 1);

    removeGuardLoad(ls, 'A1', 'صباحا');
    assert.strictEqual(ls.proctors.A1.guardCount, 1);
    assert.strictEqual(amCount(ls, 'A1'), 0);
    assert.strictEqual(pmCount(ls, 'A1'), 1);

    removeGuardLoad(ls, 'A1', 'زوالا');
    assert.strictEqual(ls.proctors.A1.guardCount, 0);
    assert.strictEqual(pmCount(ls, 'A1'), 0);

    // floor
    removeGuardLoad(ls, 'A1', 'صباحا');
    assert.strictEqual(ls.proctors.A1.guardCount, 0);
    assert.strictEqual(amCount(ls, 'A1'), 0);
});

test('decrementGuardLoad is alias of removeGuardLoad', () => {
    const ls = createLoadState(['A1']);
    incrementGuardLoad(ls, 'A1', 'مساء');
    assert.strictEqual(ls.proctors.A1.guardCount, 1);
    assert.strictEqual(pmCount(ls, 'A1'), 1);
    decrementGuardLoad(ls, 'A1', 'مساء');
    assert.strictEqual(ls.proctors.A1.guardCount, 0);
    assert.strictEqual(pmCount(ls, 'A1'), 0);
});

test('incrementGuardLoad buckets زوالا as PM (SSOT includes زوالا)', () => {
    const ls = createLoadState(['A1']);
    incrementGuardLoad(ls, 'A1', 'زوالا');
    assert.strictEqual(pmCount(ls, 'A1'), 1);
    assert.strictEqual(amCount(ls, 'A1'), 0);
});

test('public AM_PERIODS / PM_PERIODS and isAm/isPm helpers', () => {
    assert.ok(AM_PERIODS.includes('صباحا'));
    assert.ok(PM_PERIODS.includes('زوالا'));
    assert.ok(isAmPeriod('morning'));
    assert.ok(isPmPeriod('زوالا'));
    assert.ok(!isAmPeriod('زوالا'));
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
