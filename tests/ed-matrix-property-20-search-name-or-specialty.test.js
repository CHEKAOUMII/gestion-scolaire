// Feature: exemptions-duty-matrix-grid, Property 20: Search shows rows matching name or specialty
//
// Validates: Requirements 9.1, 9.2
//
// For any rows and search text, the visible rows from `applySearchFilterSort`
// (with statusFilter 'all' and no sort) are EXACTLY those whose name (الاسم) or
// specialty (مادة التخصص) — coerced via String and lower-cased — contain the
// trimmed, case-insensitively matched search text. An empty / whitespace-only
// search imposes NO search restriction (all rows are returned). No cell status
// changes.

'use strict';

const assert = require('assert');
const fc = require('fast-check');

const M = require('../js/exams/ed-matrix-logic.js');
const { applySearchFilterSort, STATUS } = M;

const MIN_CASES = 100;

const KNOWN_STATUSES = [STATUS.GUARD, STATUS.EXEMPT, STATUS.DUTY, STATUS.RESERVE];

// Varied identity-field values: Arabic + ASCII, mixed case, some empty/null.
const fieldValueArb = fc.oneof(
    fc.constantFrom(
        'محمد', 'فاطمة', 'علي', 'الرياضيات', 'الفيزياء', 'اللغة العربية',
        'Ahmed', 'Sara', 'Math', 'PHYSICS', 'Science', 'history',
        'Mixed Case Name', 'الاسم 123', 'a', 'Z', ''
    ),
    fc.constant(null),
    fc.string({ minLength: 0, maxLength: 8 })
);

// A ProctorRow shaped like the matrix model produces.
let uid = 0;
function makeRowArb() {
    return fc.record({
        name: fieldValueArb,
        specialty: fieldValueArb,
        institution: fieldValueArb,
        cellStatuses: fc.array(fc.constantFrom(...KNOWN_STATUSES), { minLength: 0, maxLength: 6 })
    }).map((spec) => {
        // Stable unique token so returned rows can be matched back to inputs
        // despite ترتيب (order) renumbering.
        const token = 'reg_' + (uid++);
        const cells = new Map();
        const summary = { guard: 0, exempt: 0, duty: 0, reserve: 0 };
        spec.cellStatuses.forEach((s, i) => {
            cells.set('session_' + i, s);
            summary[s]++;
        });
        return {
            order: 0,
            identity: {
                name: spec.name,
                registration: token,
                institution: spec.institution,
                specialty: spec.specialty
            },
            cells: cells,
            summary: summary,
            // snapshot of cell entries for the no-mutation check
            _snapshot: Array.from(cells.entries())
        };
    });
}

const rowsArb = fc.array(makeRowArb(), { minLength: 0, maxLength: 12 });

// Search text generator: sometimes a substring of some row's name/specialty,
// sometimes random text, sometimes ''/whitespace-only.
function searchArb(rows) {
    const pieces = [];
    rows.forEach((r) => {
        const name = r.identity.name == null ? '' : String(r.identity.name);
        const spec = r.identity.specialty == null ? '' : String(r.identity.specialty);
        [name, spec].forEach((v) => {
            if (v.length > 0) {
                pieces.push(v);
                // a random substring
                const start = Math.min(1, v.length - 1);
                if (v.length > 1) {
                    pieces.push(v.slice(start));
                }
            }
        });
    });
    const substringArb = pieces.length
        ? fc.constantFrom(...pieces)
        : fc.constant('zzz-no-match');

    return fc.oneof(
        { weight: 4, arbitrary: substringArb },
        { weight: 2, arbitrary: fc.string({ minLength: 0, maxLength: 6 }) },
        { weight: 2, arbitrary: fc.constantFrom('', '   ', '\t', '  \n ', 'XYZ_unlikely') },
        // mixed-case variant of a substring to exercise case-insensitivity
        { weight: 2, arbitrary: substringArb.map((s) => s.toUpperCase()) }
    );
}

// Reference oracle: which rows SHOULD be visible for a given search text.
function expectedVisibleTokens(rows, searchText) {
    const needle = String(searchText == null ? '' : searchText).trim().toLowerCase();
    const tokens = [];
    rows.forEach((r) => {
        const name = (r.identity.name == null ? '' : String(r.identity.name)).toLowerCase();
        const spec = (r.identity.specialty == null ? '' : String(r.identity.specialty)).toLowerCase();
        const matches = needle.length === 0 ||
            name.indexOf(needle) !== -1 ||
            spec.indexOf(needle) !== -1;
        if (matches) {
            tokens.push(r.identity.registration);
        }
    });
    return tokens;
}

let runCount = 0;

fc.assert(
    fc.property(
        rowsArb.chain((rows) => searchArb(rows).map((searchText) => ({ rows, searchText }))),
        ({ rows, searchText }) => {
            runCount++;

            const result = applySearchFilterSort(rows, {
                searchText: searchText,
                statusFilter: 'all',
                sort: null
            });

            // 1. The set of returned tokens equals exactly the expected set.
            const expectedTokens = expectedVisibleTokens(rows, searchText).slice().sort();
            const actualTokens = result.map((r) => r.identity.registration).slice().sort();
            assert.deepStrictEqual(
                actualTokens,
                expectedTokens,
                'visible row set does not match name-or-specialty search oracle'
            );

            // 2. Empty / whitespace-only search imposes no restriction.
            if (String(searchText == null ? '' : searchText).trim().length === 0) {
                assert.strictEqual(
                    result.length,
                    rows.length,
                    'empty/whitespace search should return all rows'
                );
            }

            // 3. No row's cell statuses changed (inputs not mutated).
            rows.forEach((r) => {
                assert.deepStrictEqual(
                    Array.from(r.cells.entries()),
                    r._snapshot,
                    'input row cells were mutated'
                );
            });
        }
    ),
    { numRuns: MIN_CASES, verbose: true }
);

console.log('PASS ed-matrix Property 20: Search shows rows matching name or specialty (' + runCount + ' cases)');
