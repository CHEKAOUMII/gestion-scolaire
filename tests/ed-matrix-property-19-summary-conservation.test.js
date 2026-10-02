// Feature: exemptions-duty-matrix-grid, Property 19: Row summary counts conserve to the session total
//
// Validates: Requirements 8.7
//
// For any Proctor_Row, the sum of the guard + exempt + duty + reserve counts
// produced by `computeRowSummary` equals the total number of Session_Columns
// (i.e. the number of status cells fed in). This conservation invariant must
// hold for every input length — including the empty row — and must absorb
// unrecognized status values into the guard tally so that no cell is ever
// dropped or double-counted.

'use strict';

const assert = require('assert');
const fc = require('fast-check');

const M = require('../js/exams/ed-matrix-logic.js');
const { computeRowSummary, STATUS } = M;

const MIN_CASES = 100;

// The four recognized statuses.
const KNOWN_STATUSES = [STATUS.GUARD, STATUS.EXEMPT, STATUS.DUTY, STATUS.RESERVE];

// Values that are NOT one of the four recognized statuses. computeRowSummary
// must still count each as exactly one cell (folded into the guard tally), so
// they cannot break conservation.
const UNRECOGNIZED_VALUES = ['', 'no', 'unknown', 'GUARD', 'Exempt', 'حراسة', 'إعفاء', null, undefined, 0, 1, false, true, {}];

// A single-cell status generator: mostly known statuses, with a healthy share
// of unrecognized values mixed in to stress the conservation guarantee.
const cellStatusArb = fc.oneof(
    { weight: 8, arbitrary: fc.constantFrom(...KNOWN_STATUSES) },
    { weight: 3, arbitrary: fc.constantFrom(...UNRECOGNIZED_VALUES) }
);

// An array of cell statuses (a row) of varying length, including the empty row
// (minLength 0) and rows long enough to exercise large totals.
const rowStatusesArb = fc.array(cellStatusArb, { minLength: 0, maxLength: 50 });

let runCount = 0;

// --- Property: array (iterable) input form --------------------------------
// The sum of the four summary counts equals the number of input cells.
fc.assert(
    fc.property(rowStatusesArb, (statuses) => {
        runCount++;
        const inputLength = statuses.length;

        const s = computeRowSummary(statuses);

        // Each count must be a non-negative integer (so the sum is meaningful).
        for (const key of ['guard', 'exempt', 'duty', 'reserve']) {
            assert.ok(
                Number.isInteger(s[key]) && s[key] >= 0,
                `${key} count ${s[key]} is not a non-negative integer`
            );
        }

        // Conservation: every cell is counted exactly once.
        assert.strictEqual(
            s.guard + s.exempt + s.duty + s.reserve,
            inputLength,
            `summary counts (g=${s.guard}, e=${s.exempt}, d=${s.duty}, r=${s.reserve}) ` +
            `do not conserve to inputLength=${inputLength}`
        );
    }),
    { numRuns: MIN_CASES, verbose: true }
);

// --- Property: Map<sessionKey, status> input form -------------------------
// The matrix model stores a row's cells as a Map<sessionKey, status>. Feeding
// that Map to computeRowSummary must conserve to the number of entries (one per
// session column).
const rowMapArb = fc.array(cellStatusArb, { minLength: 0, maxLength: 50 }).map((statuses) => {
    const map = new Map();
    statuses.forEach((status, i) => map.set('session_' + i, status));
    return map;
});

fc.assert(
    fc.property(rowMapArb, (map) => {
        runCount++;
        const inputLength = map.size;

        const s = computeRowSummary(map);

        for (const key of ['guard', 'exempt', 'duty', 'reserve']) {
            assert.ok(
                Number.isInteger(s[key]) && s[key] >= 0,
                `map ${key} count ${s[key]} is not a non-negative integer`
            );
        }

        assert.strictEqual(
            s.guard + s.exempt + s.duty + s.reserve,
            inputLength,
            `map summary counts (g=${s.guard}, e=${s.exempt}, d=${s.duty}, r=${s.reserve}) ` +
            `do not conserve to inputLength=${inputLength}`
        );
    }),
    { numRuns: MIN_CASES, verbose: true }
);

console.log('PASS ed-matrix Property 19: Row summary counts conserve to the session total (' + runCount + ' cases across array + Map inputs)');
