// Feature: exemptions-duty-matrix-grid, Property 23: Search, filter, and sort preserve cell statuses
//
// Validates: Requirements 9.7
//
// For any set of rows and any sequence of search/filter/sort operations, the
// Proctor_Status of every Status_Cell is identical before and after the
// operations. `applySearchFilterSort` is a pure read-only projection: it
// shallow-copies each visible row and shares the original `cells`/`identity`/
// `summary` references without mutating them, so no operation (or sequence of
// operations) may ever change a cell's status.
//
// Strategy:
//   - Build an array of ProctorRows, each carrying cells:Map<sessionKey,status>,
//     identity fields, a present summary, and a UNIQUE token so output copies
//     can be matched back to their input row.
//   - Snapshot every input row's cells (token -> {sessionKey: status}) BEFORE
//     running anything.
//   - Generate a random SEQUENCE of operations (varying searchText,
//     statusFilter, and a sort derived from header activations via
//     nextSortState), and apply `applySearchFilterSort` for each step. We test
//     BOTH feeding the SAME original rows array every step AND chaining the
//     previous step's output into the next, since both must preserve statuses.
//   - After EACH operation assert:
//       (a) the ORIGINAL input rows' cells are byte-for-byte unchanged vs the
//           snapshot (no mutation of the caller's data), and
//       (b) each RETURNED row's cells (matched by token) hold statuses
//           identical to that row's original snapshot.

'use strict';

const assert = require('assert');
const fc = require('fast-check');

const M = require('../js/exams/ed-matrix-logic.js');
const { applySearchFilterSort, nextSortState, SORTABLE_COLUMNS, STATUS } = M;

const MIN_CASES = 100;

const SORT_COLUMNS = Object.keys(SORTABLE_COLUMNS);

// Identity value pool mixing Arabic and ASCII, with duplicates and an empty so
// search needles sometimes match and sometimes do not.
const TEXT_POOL = [
    'محمد', 'أحمد', 'علي', 'فاطمة', 'زينب', 'يوسف', 'سارة',
    'Ali', 'Mohammed', 'Sara', 'aaa', 'bbb', 'ABC', 'abc',
    'مادة الرياضيات', 'مادة الفيزياء', 'الثانوية أ', 'College B', '', 'محمد'
];
const textValueArb = fc.constantFrom(...TEXT_POOL);

const statusArb = fc.constantFrom(STATUS.GUARD, STATUS.EXEMPT, STATUS.DUTY, STATUS.RESERVE);

// A single ProctorRow with a unique token, identity fields, a cells Map and a
// matching present summary.
function makeRowArb(token) {
    return fc.record({
        order: fc.integer({ min: 1, max: 999 }),
        name: textValueArb,
        registration: textValueArb,
        institution: textValueArb,
        specialty: textValueArb,
        cellStatuses: fc.array(statusArb, { minLength: 0, maxLength: 6 })
    }).map((r) => {
        const cells = new Map();
        r.cellStatuses.forEach((s, i) => cells.set('session_' + i, s));
        const summary = { guard: 0, exempt: 0, duty: 0, reserve: 0 };
        r.cellStatuses.forEach((s) => { summary[s]++; });
        return {
            token: token,
            order: r.order,
            identity: {
                name: r.name,
                registration: r.registration,
                institution: r.institution,
                specialty: r.specialty
            },
            cells: cells,
            summary: summary
        };
    });
}

const rowsArb = fc.integer({ min: 0, max: 10 }).chain((n) => {
    const rowArbs = [];
    for (let i = 0; i < n; i++) {
        rowArbs.push(makeRowArb('tok_' + i));
    }
    return n === 0 ? fc.constant([]) : fc.tuple(...rowArbs);
});

// One operation: a search text, a status filter, and a column to "activate".
// `searchText` includes some substrings of pool values and some whitespace
// padding so search both matches and trims; statusFilter mixes the four known
// statuses with non-restricting values ('all', '', null).
const searchTextArb = fc.constantFrom(
    '', '   ', 'م', 'a', 'ABC', '  محمد ', 'مادة', 'zzz_no_match', 'Sara', 'College'
);
const statusFilterArb = fc.constantFrom(
    STATUS.GUARD, STATUS.EXEMPT, STATUS.DUTY, STATUS.RESERVE, 'all', '', null
);
const operationArb = fc.record({
    searchText: searchTextArb,
    statusFilter: statusFilterArb,
    column: fc.constantFrom(...SORT_COLUMNS)
});
const sequenceArb = fc.array(operationArb, { minLength: 1, maxLength: 8 });

// Snapshot a row's cells Map into a plain {sessionKey: status} object.
function snapshotCells(row) {
    const snap = Object.create(null);
    row.cells.forEach((status, sessionKey) => { snap[sessionKey] = status; });
    return snap;
}

// Assert a row's current cells exactly equal the snapshot taken earlier.
function assertCellsEqualSnapshot(row, snap, context) {
    const current = snapshotCells(row);
    assert.deepStrictEqual(
        current, snap,
        'cell statuses changed (' + context + ') for token ' + row.token
    );
}

let runCount = 0;

fc.assert(
    fc.property(rowsArb, sequenceArb, (rows, sequence) => {
        runCount++;

        // BEFORE: snapshot every input row's cells, keyed by token.
        const beforeByToken = Object.create(null);
        rows.forEach((r) => { beforeByToken[r.token] = snapshotCells(r); });

        // Drive a real sort toggle sequence so `sort` varies like header clicks.
        let sort = null;
        // For the "chained" variant we feed the previous output back in. The
        // chained rows are shallow copies that SHARE the original cells Maps, so
        // their cells must also match the original snapshots by token.
        let chained = rows;

        for (let step = 0; step < sequence.length; step++) {
            const op = sequence[step];
            sort = nextSortState(sort, op.column);
            const options = {
                searchText: op.searchText,
                statusFilter: op.statusFilter,
                sort: sort
            };

            // Variant A: always feed the SAME original rows array.
            const outA = applySearchFilterSort(rows, options);
            // Variant B: chain the previous output into the next operation.
            const outB = applySearchFilterSort(chained, options);
            chained = outB;

            const ctx = 'step ' + step;

            // (a) The original input rows are never mutated by any operation.
            rows.forEach((r) => {
                assertCellsEqualSnapshot(r, beforeByToken[r.token], ctx + ' / input-rows');
            });

            // (b) Every RETURNED row (both variants) preserves its cell statuses
            //     identically to the original row's snapshot, matched by token.
            outA.forEach((r) => {
                assert.ok(
                    Object.prototype.hasOwnProperty.call(beforeByToken, r.token),
                    'unexpected token in output A: ' + r.token
                );
                assertCellsEqualSnapshot(r, beforeByToken[r.token], ctx + ' / output-A');
            });
            outB.forEach((r) => {
                assert.ok(
                    Object.prototype.hasOwnProperty.call(beforeByToken, r.token),
                    'unexpected token in output B: ' + r.token
                );
                assertCellsEqualSnapshot(r, beforeByToken[r.token], ctx + ' / output-B');
            });
        }

        // AFTER the full sequence: every original row's cells still match the
        // pristine snapshot — the sequence as a whole preserved all statuses.
        rows.forEach((r) => {
            assertCellsEqualSnapshot(r, beforeByToken[r.token], 'after full sequence');
        });
    }),
    { numRuns: MIN_CASES, verbose: true }
);

console.log('PASS ed-matrix Property 23: Search, filter, and sort preserve cell statuses (' + runCount + ' cases)');
