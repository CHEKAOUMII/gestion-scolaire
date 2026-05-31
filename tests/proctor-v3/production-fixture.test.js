/**
 * Production fixture acceptance test — the SINGLE SOURCE OF TRUTH for V3
 * production readiness.
 *
 * **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8,
 *               15.9, 14.7**
 *
 * Loads the real exam-center fixture `tests/fixtures/45454.json` (147
 * proctors, 30 schedule entries, 191 result rows, 382 guard slots), runs
 * V3 with `randomSeed = 42`, and asserts every production invariant:
 *
 *   AC 15.1 — All 382 guard slots filled (zero unresolved).
 *   AC 15.2 — Every one of the 147 proctors has Primary_Load ≥ 2
 *             (Global_Lower_Bound = 2).
 *   AC 15.3 — `histogramByPrimaryLoad` is strict bimodal: `{k: 147}` or
 *             `{k: a, k+1: b}` with `a + b = 147`.
 *   AC 15.4 — No proctor has Primary_Load > 4; typically `max ≤ 3`.
 *   AC 15.5 — Zero ghost CIN keys: the 6 known `som`-shaped strings
 *             (1909564, 2367149, 1910812, 2158781, 1545317, 1177902) are
 *             absent from every `proctor_keys` and `reserve_keys`.
 *   AC 15.6 — Two runs with `randomSeed = 42` are byte-identical.
 *   AC 15.7 — `diagnostics.coverageRepairUnresolved === 0`.
 *   AC 15.8 — Total wall-clock duration ≤ 30 seconds.
 *   AC 15.9 — At most 10% of eligible proctors have AM_PM_Imbalance ≥ 2.
 *
 * This file is intentionally NOT a property-based test (it pins a single
 * real fixture, per AC 14.7). It runs V3 ONCE and shares that result across
 * every assertion so each criterion is reported independently with concrete
 * values.
 *
 * Run directly:   node tests/proctor-v3/production-fixture.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const V3_ROOT = path.join(ROOT, 'js', 'algorithms', 'proctor-v3');
const FIXTURE_PATH = path.join(ROOT, 'tests', 'fixtures', '45454.json');

const { run } = require(path.join(V3_ROOT, 'index.js'));

// ---------------------------------------------------------------------------
// Production constants (from Requirement 15 / glossary Production_Fixture).
// ---------------------------------------------------------------------------

const EXPECTED_PROCTORS = 147;
const EXPECTED_SLOTS = 382;
const GLOBAL_LOWER_BOUND = 2;       // AC 15.2
const MAX_PRIMARY_LOAD = 3;         // AC 15.4 (typical max ≤ 3)
const AMPM_IMBALANCE_LIMIT = 0.10;  // AC 15.9 — at most 10% with imbalance ≥ 2

// The 6 known ghost CIN strings that MUST be absent (AC 2.8 / AC 15.5).
const GHOST_CINS = ['1909564', '2367149', '1910812', '2158781', '1545317', '1177902'];

// ---------------------------------------------------------------------------
// Minimal test harness (matches the other tests/proctor-v3/*.test.js files).
// ---------------------------------------------------------------------------

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
// Helpers
// ---------------------------------------------------------------------------

/** Count guard slots across all rows: total, filled (non-null), and unresolved. */
function countSlots(result) {
    let total = 0;
    let filled = 0;
    let nullSlots = 0;
    for (const row of result) {
        const keys = Array.isArray(row.proctor_keys) ? row.proctor_keys : [];
        for (const k of keys) {
            total += 1;
            if (k === null || k === undefined) nullSlots += 1;
            else filled += 1;
        }
    }
    return { total, filled, nullSlots };
}

/**
 * Strict-bimodal predicate over a histogram keyed by load → count (AC 5.7).
 *   - {}            → vacuously bimodal (no proctors)
 *   - {k: N}        → single load value
 *   - {k: a, k+1: b}→ two consecutive load values
 *   - otherwise     → NOT bimodal (3+ keys, or a gap > 1)
 */
function isStrictBimodal(histogram) {
    const keys = Object.keys(histogram).map(Number).sort((a, b) => a - b);
    if (keys.length === 0) return true;
    if (keys.length === 1) return true;
    if (keys.length === 2) return keys[1] - keys[0] === 1;
    return false;
}

/** Sum the counts in a load-histogram (number of proctors it accounts for). */
function histogramTotal(histogram) {
    return Object.keys(histogram).reduce((sum, k) => sum + histogram[k], 0);
}

/** Collect every ghost CIN that appears in any proctor_keys or reserve_keys. */
function findGhostKeys(result) {
    const ghostSet = new Set(GHOST_CINS);
    const present = new Set();
    for (const row of result) {
        const guard = Array.isArray(row.proctor_keys) ? row.proctor_keys : [];
        const reserve = Array.isArray(row.reserve_keys) ? row.reserve_keys : [];
        for (const k of guard) if (ghostSet.has(k)) present.add(k);
        for (const k of reserve) if (ghostSet.has(k)) present.add(k);
    }
    return [...present];
}

// ---------------------------------------------------------------------------
// Single shared V3 run (the "source of truth").
// ---------------------------------------------------------------------------

const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

// AC 15.1/15.6 — run V3 with randomSeed = 42 (override whatever the fixture
// carries so the test is explicit and self-documenting).
const input = Object.assign({}, fixture, { randomSeed: 42 });

const startTime = Date.now();
const output = run(input);
const durationMs = Date.now() - startTime;

const diagnostics = output.diagnostics || {};
const result = Array.isArray(output.result) ? output.result : [];
const slots = countSlots(result);
const primaryHistogram = diagnostics.histogramByPrimaryLoad || {};

// ---------------------------------------------------------------------------
// Diagnostic summary (printed whether the suite passes or fails — gives the
// reviewer concrete numbers to act on).
// ---------------------------------------------------------------------------

console.log('[production-fixture] fixture 45454.json:');
console.log('  proctors=' + (Array.isArray(input.proctorsList) ? input.proctorsList.length : 0) +
    ' | schedule entries=' + (Array.isArray(input.scheduleEntries) ? input.scheduleEntries.length : 0) +
    ' | result rows=' + result.length);
console.log('  orchestratorState=' + output.orchestratorState + ' | durationMs=' + durationMs);
console.log('  slots: total=' + slots.total + ' filled=' + slots.filled + ' unresolved(null)=' + slots.nullSlots);
console.log('  unresolvedSlots=' + (Array.isArray(diagnostics.unresolvedSlots) ? diagnostics.unresolvedSlots.length : 'n/a') +
    ' | coverageRepairUnresolved=' + diagnostics.coverageRepairUnresolved);
console.log('  globalLowerBound=' + diagnostics.globalLowerBound + ' | globalUpperBound=' + diagnostics.globalUpperBound);
console.log('  histogramByPrimaryLoad=' + JSON.stringify(primaryHistogram) +
    ' | min=' + diagnostics.min + ' max=' + diagnostics.max + ' distinctCount=' + diagnostics.distinctCount);
console.log('  warnings=' + JSON.stringify((diagnostics.warnings || []).map((w) => w.type)));
console.log('  errors=' + JSON.stringify((diagnostics.errors || []).map((e) => e.type)));
console.log('');

// ---------------------------------------------------------------------------
// AC 15.1 — All 382 slots filled, zero unresolved.
// ---------------------------------------------------------------------------

test('AC 15.1: all 382 guard slots filled (zero unresolved)', () => {
    assert.strictEqual(slots.total, EXPECTED_SLOTS,
        `expected ${EXPECTED_SLOTS} total guard slots, got ${slots.total}`);
    assert.strictEqual(slots.nullSlots, 0,
        `expected 0 unresolved (null) slots, got ${slots.nullSlots}`);
    assert.strictEqual(slots.filled, EXPECTED_SLOTS,
        `expected ${EXPECTED_SLOTS} filled slots, got ${slots.filled}`);
    assert.strictEqual(
        Array.isArray(diagnostics.unresolvedSlots) ? diagnostics.unresolvedSlots.length : -1,
        0,
        `expected diagnostics.unresolvedSlots to be empty, got ` +
        JSON.stringify(diagnostics.unresolvedSlots));
});

// ---------------------------------------------------------------------------
// AC 15.2 — Every one of the 147 proctors has Primary_Load ≥ 2.
// ---------------------------------------------------------------------------

test('AC 15.2: all 147 proctors have Primary_Load >= 2', () => {
    const total = histogramTotal(primaryHistogram);
    assert.strictEqual(total, EXPECTED_PROCTORS,
        `expected histogramByPrimaryLoad to account for ${EXPECTED_PROCTORS} proctors, got ${total} ` +
        `(histogram: ${JSON.stringify(primaryHistogram)})`);
    const belowBound = Object.keys(primaryHistogram)
        .filter((k) => Number(k) < GLOBAL_LOWER_BOUND)
        .reduce((sum, k) => sum + primaryHistogram[k], 0);
    assert.strictEqual(belowBound, 0,
        `expected 0 proctors with Primary_Load < ${GLOBAL_LOWER_BOUND}, got ${belowBound} ` +
        `(histogram: ${JSON.stringify(primaryHistogram)})`);
});

// ---------------------------------------------------------------------------
// AC 15.3 — histogramByPrimaryLoad is strict bimodal.
// ---------------------------------------------------------------------------

test('AC 15.3: histogramByPrimaryLoad is strict bimodal', () => {
    assert.ok(isStrictBimodal(primaryHistogram),
        `histogram is not strict bimodal: ${JSON.stringify(primaryHistogram)}`);
    const total = histogramTotal(primaryHistogram);
    assert.strictEqual(total, EXPECTED_PROCTORS,
        `bimodal histogram must sum to ${EXPECTED_PROCTORS}, got ${total}`);
});

// ---------------------------------------------------------------------------
// AC 15.4 — max Primary_Load ≤ 3.
// ---------------------------------------------------------------------------

test('AC 15.4: max Primary_Load <= 3', () => {
    assert.ok(typeof diagnostics.max === 'number',
        `diagnostics.max must be a number, got ${diagnostics.max}`);
    assert.ok(diagnostics.max <= MAX_PRIMARY_LOAD,
        `expected max Primary_Load <= ${MAX_PRIMARY_LOAD}, got ${diagnostics.max}`);
});

// ---------------------------------------------------------------------------
// AC 15.5 — Zero ghost CIN keys.
// ---------------------------------------------------------------------------

test('AC 15.5: zero ghost CIN keys (6 known strings absent)', () => {
    const present = findGhostKeys(result);
    assert.strictEqual(present.length, 0,
        `expected zero ghost CIN keys, found: ${JSON.stringify(present)}`);
});

// ---------------------------------------------------------------------------
// AC 15.7 — coverageRepairUnresolved === 0.
// ---------------------------------------------------------------------------

test('AC 15.7: diagnostics.coverageRepairUnresolved === 0', () => {
    assert.strictEqual(diagnostics.coverageRepairUnresolved, 0,
        `expected coverageRepairUnresolved === 0, got ${diagnostics.coverageRepairUnresolved}`);
});

// ---------------------------------------------------------------------------
// AC 15.8 — Wall-clock duration ≤ 30 seconds.
// ---------------------------------------------------------------------------

test('AC 15.8: wall-clock duration <= 30 seconds', () => {
    assert.ok(durationMs <= 30000,
        `expected run to complete within 30000ms, took ${durationMs}ms`);
});

// ---------------------------------------------------------------------------
// AC 15.9 — At most 10% of proctors have AM_PM_Imbalance ≥ 2.
// ---------------------------------------------------------------------------

test('AC 15.9: at most 10% of proctors have AM_PM_Imbalance >= 2', () => {
    const map = diagnostics.amPmImbalanceByProctorKey || {};
    const keys = Object.keys(map);
    assert.ok(keys.length > 0, 'expected amPmImbalanceByProctorKey to be populated');
    const ge2 = keys.filter((k) => map[k] >= 2).length;
    const ratio = ge2 / keys.length;
    assert.ok(ratio <= AMPM_IMBALANCE_LIMIT,
        `expected <= ${(AMPM_IMBALANCE_LIMIT * 100)}% of proctors with AM_PM_Imbalance >= 2, ` +
        `got ${ge2}/${keys.length} = ${(ratio * 100).toFixed(1)}%`);
});

// ---------------------------------------------------------------------------
// AC 15.6 — Two runs with randomSeed = 42 are byte-identical.
// ---------------------------------------------------------------------------

test('AC 15.6: two runs with randomSeed=42 are byte-identical', () => {
    const second = run(Object.assign({}, fixture, { randomSeed: 42 }));
    assert.strictEqual(
        JSON.stringify(second.result),
        JSON.stringify(result),
        'result arrays differ between two runs with identical randomSeed=42');
});

// ---------------------------------------------------------------------------
// Wrap up.
// ---------------------------------------------------------------------------

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
