'use strict';

// Feature: exemptions-duty-matrix-grid, Property 7: Status background colors are pairwise distinct
//
// Validates: Requirements 3.2
//
// Property 7 (design.md): For any two distinct Proctor_Status values among the
// four (guard, exempt, duty, reserve), their background colors are different —
// i.e. the status→color mapping (STATUS_COLOR) is injective.
//
// Requirement 3.2 states each of the four Proctor_Status values maps to its own
// background color and no two of the four share the same background color.
//
// This is a standalone Node test script run at the top level:
//   node tests/ed-matrix-property-7-distinct-colors.test.js
// It exits non-zero on any failure.
//
// Strategy: first assert the static shape of STATUS_COLOR (a defined, non-empty
// token for each of the four statuses, and all four tokens pairwise distinct via
// a Set of size 4). Then property-test over pairs of distinct statuses
// (fc.constantFrom × fc.constantFrom, guarded to distinct) asserting that
// distinct statuses always have distinct color tokens.

const assert = require('assert');
const fc = require('fast-check');

const M = require('../js/exams/ed-matrix-logic.js');
const { STATUS, STATUS_COLOR } = M;

const MIN_CASES = 100;

// The four canonical Proctor_Status values.
const STATUSES = [STATUS.GUARD, STATUS.EXEMPT, STATUS.DUTY, STATUS.RESERVE];

// ---------------------------------------------------------------------------
// Static structural assertions: every status has a defined, non-empty token,
// and the four tokens are pairwise distinct.
// ---------------------------------------------------------------------------

function checkStaticShape() {
    for (const status of STATUSES) {
        const token = STATUS_COLOR[status];
        assert.strictEqual(typeof token, 'string',
            'STATUS_COLOR[' + status + '] must be a string, got ' + typeof token);
        assert.ok(token.trim().length > 0,
            'STATUS_COLOR[' + status + '] must be a non-empty token');
    }

    const tokens = STATUSES.map((s) => STATUS_COLOR[s]);
    const distinct = new Set(tokens);
    assert.strictEqual(distinct.size, 4,
        'the four status color tokens must be pairwise distinct (Set size === 4), got ' +
        distinct.size + ': ' + JSON.stringify(tokens));
}

// ---------------------------------------------------------------------------
// Runner.
// ---------------------------------------------------------------------------

console.log('[test] exemptions-duty-matrix-grid — Property 7: status background colors are pairwise distinct');

try {
    // Static shape first: defined, non-empty, and pairwise distinct.
    checkStaticShape();

    // Property: for any two distinct statuses, their color tokens differ.
    const statusArb = fc.constantFrom.apply(fc, STATUSES);

    fc.assert(
        fc.property(statusArb, statusArb, (a, b) => {
            // Only assert the injectivity claim for distinct statuses.
            fc.pre(a !== b);
            assert.notStrictEqual(
                STATUS_COLOR[a],
                STATUS_COLOR[b],
                'distinct statuses ' + a + ' and ' + b + ' share the same color token ' +
                JSON.stringify(STATUS_COLOR[a])
            );
        }),
        { numRuns: MIN_CASES, verbose: true }
    );

    // --- Edge case: exhaustively check every unordered pair of distinct
    // statuses (6 pairs) so no pair is left to generator chance. ---
    (function exhaustivePairs() {
        for (let i = 0; i < STATUSES.length; i++) {
            for (let j = i + 1; j < STATUSES.length; j++) {
                const a = STATUSES[i];
                const b = STATUSES[j];
                assert.notStrictEqual(STATUS_COLOR[a], STATUS_COLOR[b],
                    'pair (' + a + ', ' + b + ') must have distinct color tokens');
            }
        }
    })();

    console.log('PASS ed-matrix Property 7: Status background colors are pairwise distinct (' + MIN_CASES + '+ generated cases + edge cases)');
    process.exit(0);
} catch (err) {
    console.error('FAIL: Property 7 violated');
    console.error(err && err.message ? err.message : err);
    if (err && err.counterexample) {
        console.error('Counterexample: ' + JSON.stringify(err.counterexample));
    }
    process.exit(1);
}
