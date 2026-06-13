// Feature: exemptions-duty-matrix-grid, Property 18: Row summaries equal the live cell counts
//
// Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
//
// For any row in any state, each of guard/exempt/duty/reserve counts from
// `computeRowSummary` equals the number of that row's cells currently holding
// the corresponding status, with each count in the range 0..totalSessions.
// Guard count additionally absorbs any unrecognized status value (default → guard).

'use strict';

const assert = require('assert');
const fc = require('fast-check');

const M = require('../js/exams/ed-matrix-logic.js');
const { computeRowSummary, STATUS } = M;

const MIN_CASES = 100;

// The four recognized statuses.
const KNOWN_STATUSES = [STATUS.GUARD, STATUS.EXEMPT, STATUS.DUTY, STATUS.RESERVE];

// A handful of UNRECOGNIZED values that must be tallied as guard (default).
const UNRECOGNIZED_VALUES = ['', 'no', 'unknown', 'GUARD', 'Exempt', 'حراسة', null, undefined, 0, 1];

// A single-cell status generator: usually a known status, occasionally an
// unrecognized value (which computeRowSummary must count as guard).
const cellStatusArb = fc.oneof(
    { weight: 9, arbitrary: fc.constantFrom(...KNOWN_STATUSES) },
    { weight: 2, arbitrary: fc.constantFrom(...UNRECOGNIZED_VALUES) }
);

// An array of cell statuses (a row), length 0..40 to exercise the 0..totalSessions range.
const rowStatusesArb = fc.array(cellStatusArb, { minLength: 0, maxLength: 40 });

// Independently tally a row of statuses; unrecognized → guard.
function tally(statuses) {
    const counts = { guard: 0, exempt: 0, duty: 0, reserve: 0 };
    for (const s of statuses) {
        if (s === STATUS.EXEMPT) {
            counts.exempt++;
        } else if (s === STATUS.DUTY) {
            counts.duty++;
        } else if (s === STATUS.RESERVE) {
            counts.reserve++;
        } else {
            counts.guard++;
        }
    }
    return counts;
}

let runCount = 0;

// --- Property: array (iterable) input -------------------------------------
fc.assert(
    fc.property(rowStatusesArb, (statuses) => {
        runCount++;
        const totalSessions = statuses.length;

        const summary = computeRowSummary(statuses);
        const expected = tally(statuses);

        // Each count equals the independently-computed tally.
        assert.strictEqual(summary.guard, expected.guard, 'guard count mismatch');
        assert.strictEqual(summary.exempt, expected.exempt, 'exempt count mismatch');
        assert.strictEqual(summary.duty, expected.duty, 'duty count mismatch');
        assert.strictEqual(summary.reserve, expected.reserve, 'reserve count mismatch');

        // Each count is within 0..totalSessions.
        for (const key of ['guard', 'exempt', 'duty', 'reserve']) {
            assert.ok(
                Number.isInteger(summary[key]) && summary[key] >= 0 && summary[key] <= totalSessions,
                `${key} count ${summary[key]} out of range 0..${totalSessions}`
            );
        }

        // Counts sum to the total number of sessions (every cell counted once).
        assert.strictEqual(
            summary.guard + summary.exempt + summary.duty + summary.reserve,
            totalSessions,
            'summary counts do not sum to totalSessions'
        );
    }),
    { numRuns: MIN_CASES, verbose: true }
);

// --- Property: Map<sessionKey, status> input form -------------------------
// computeRowSummary must also count a Map's *values* correctly (the matrix
// model stores cells as a Map<sessionKey, status>).
const rowMapArb = fc.array(cellStatusArb, { minLength: 0, maxLength: 40 }).map((statuses) => {
    const map = new Map();
    statuses.forEach((s, i) => map.set('session_' + i, s));
    return { map, statuses };
});

fc.assert(
    fc.property(rowMapArb, ({ map, statuses }) => {
        runCount++;
        const totalSessions = statuses.length;

        const summary = computeRowSummary(map);
        const expected = tally(statuses);

        assert.strictEqual(summary.guard, expected.guard, 'map guard count mismatch');
        assert.strictEqual(summary.exempt, expected.exempt, 'map exempt count mismatch');
        assert.strictEqual(summary.duty, expected.duty, 'map duty count mismatch');
        assert.strictEqual(summary.reserve, expected.reserve, 'map reserve count mismatch');

        assert.strictEqual(
            summary.guard + summary.exempt + summary.duty + summary.reserve,
            totalSessions,
            'map summary counts do not sum to totalSessions'
        );
    }),
    { numRuns: MIN_CASES, verbose: true }
);

console.log('PASS ed-matrix Property 18: Row summaries equal the live cell counts (' + runCount + ' cases across array + Map inputs)');
