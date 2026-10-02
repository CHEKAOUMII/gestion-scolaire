// Feature: exemptions-duty-matrix-grid, Property 22: Sorting orders by column and toggles direction
//
// Validates: Requirements 9.5
//
// For any rows and any sortable Identity_Column, activating that column's
// header sorts visible rows ascending on first activation and toggles
// asc/desc on each subsequent activation of the same header.
//
// We model header activations with `nextSortState` (starting from null):
//   1st activation of a column  -> { column, direction: 'asc' }
//   2nd activation (same col)   -> toggles to 'desc'
//   3rd activation (same col)   -> back to 'asc'
// and assert BOTH the nextSortState transitions AND the resulting row order
// from `applySearchFilterSort` honor the documented comparator
// (localeCompare('ar') for text columns, numeric for 'order'). The sort is
// stable with an input-index tiebreaker, so we assert the returned field-value
// sequence is non-decreasing (asc) / non-increasing (desc) under the comparator
// rather than an exact permutation, to avoid coupling to tie order.

'use strict';

const assert = require('assert');
const fc = require('fast-check');

const M = require('../js/exams/ed-matrix-logic.js');
const { applySearchFilterSort, nextSortState, SORTABLE_COLUMNS, STATUS } = M;

const MIN_CASES = 100;

// The sortable identity columns we exercise. 'order' is numeric; the four text
// columns compare via localeCompare('ar'). All are keys of SORTABLE_COLUMNS.
const SORT_COLUMNS = Object.keys(SORTABLE_COLUMNS);

// Sanity: the columns the task focuses on are all present.
['name', 'registration', 'institution', 'specialty', 'order'].forEach((c) => {
    assert.ok(
        Object.prototype.hasOwnProperty.call(SORTABLE_COLUMNS, c),
        'expected SORTABLE_COLUMNS to contain ' + c
    );
});

// A pool of identity values mixing Arabic and ASCII, with intentional
// duplicates and empties to exercise ties and stable ordering.
const TEXT_POOL = [
    'محمد', 'أحمد', 'علي', 'فاطمة', 'زينب', 'يوسف', 'إبراهيم', 'سارة',
    'Ali', 'Mohammed', 'Sara', 'Zineb', 'Youssef', 'aaa', 'bbb', 'ABC',
    'abc', '123', '007', 'مادة الرياضيات', 'مادة الفيزياء', 'الثانوية أ',
    'College B', '', 'محمد'
];

const textValueArb = fc.constantFrom(...TEXT_POOL);

// The four known statuses, to build a plausible (present) row summary.
const statusArb = fc.constantFrom(STATUS.GUARD, STATUS.EXEMPT, STATUS.DUTY, STATUS.RESERVE);

// A single ProctorRow: identity fields (varied Arabic/ASCII), an initial
// numeric `order`, cells:new Map(), a present summary, and a unique token so we
// can match shallow-copied output rows back to their inputs.
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

// An array of rows, each tagged with a unique token by index.
const rowsArb = fc.integer({ min: 0, max: 12 }).chain((n) => {
    const rowArbs = [];
    for (let i = 0; i < n; i++) {
        rowArbs.push(makeRowArb('tok_' + i));
    }
    return n === 0 ? fc.constant([]) : fc.tuple(...rowArbs);
});

// Mirror the implementation's comparable-value extraction.
function getSortValue(row, column) {
    if (column === 'order') {
        return (row && typeof row.order === 'number') ? row.order : 0;
    }
    const identity = (row && row.identity) ? row.identity : {};
    const value = identity[column];
    return value == null ? '' : String(value);
}

// Mirror the implementation's comparator for a column.
function compareValues(va, vb, numeric) {
    if (numeric) {
        return va - vb;
    }
    return String(va).localeCompare(String(vb), 'ar');
}

// Assert that the ordered rows are monotonic under the documented comparator.
// direction === 'asc'  -> field-value sequence is non-decreasing (cmp <= 0)
// direction === 'desc' -> field-value sequence is non-increasing (cmp >= 0)
//
// IMPORTANT: applySearchFilterSort renumbers each output row's `order` to a
// gapless 1..n display sequence, so the OUTPUT `order` is never the sort key.
// We therefore look the ORIGINAL sort value up by token (via `originalByToken`)
// so the 'order' column is checked against the values the sort actually used.
function assertMonotonic(sorted, column, direction, originalByToken) {
    const numeric = column === 'order';
    for (let i = 1; i < sorted.length; i++) {
        const prev = getSortValue(originalByToken[sorted[i - 1].token], column);
        const cur = getSortValue(originalByToken[sorted[i].token], column);
        const cmp = compareValues(prev, cur, numeric);
        if (direction === 'asc') {
            assert.ok(
                cmp <= 0,
                'asc on "' + column + '": expected prev <= cur but got cmp=' + cmp +
                ' for [' + JSON.stringify(prev) + ', ' + JSON.stringify(cur) + ']'
            );
        } else {
            assert.ok(
                cmp >= 0,
                'desc on "' + column + '": expected prev >= cur but got cmp=' + cmp +
                ' for [' + JSON.stringify(prev) + ', ' + JSON.stringify(cur) + ']'
            );
        }
    }
}

// Every input row must appear exactly once in the output (no rows lost/added),
// matched by their unique tokens.
function assertSameRowSet(rows, sorted) {
    assert.strictEqual(sorted.length, rows.length, 'row count changed after sort');
    const inTokens = rows.map((r) => r.token).sort();
    const outTokens = sorted.map((r) => r.token).sort();
    assert.deepStrictEqual(outTokens, inTokens, 'sorted output is not a permutation of the input');
}

let runCount = 0;

fc.assert(
    fc.property(rowsArb, fc.constantFrom(...SORT_COLUMNS), (rows, column) => {
        runCount++;

        // --- Model three header activations of the SAME column via nextSortState.
        const sort1 = nextSortState(null, column);
        const sort2 = nextSortState(sort1, column);
        const sort3 = nextSortState(sort2, column);

        // nextSortState transitions: asc -> desc -> asc, always on `column`.
        assert.deepStrictEqual(sort1, { column: column, direction: 'asc' },
            'first activation should be ascending on the activated column');
        assert.deepStrictEqual(sort2, { column: column, direction: 'desc' },
            'second activation should toggle to descending');
        assert.deepStrictEqual(sort3, { column: column, direction: 'asc' },
            'third activation should toggle back to ascending');

        // The toggle alternates and the direction differs between consecutive
        // activations of the same header.
        assert.notStrictEqual(sort1.direction, sort2.direction, 'asc->desc must change direction');
        assert.notStrictEqual(sort2.direction, sort3.direction, 'desc->asc must change direction');
        assert.strictEqual(sort1.direction, sort3.direction, 'first and third activations agree');

        // --- Resulting order from applySearchFilterSort honors each direction.
        const sorted1 = applySearchFilterSort(rows, { sort: sort1 });
        const sorted2 = applySearchFilterSort(rows, { sort: sort2 });
        const sorted3 = applySearchFilterSort(rows, { sort: sort3 });

        // No rows lost or duplicated under any activation.
        assertSameRowSet(rows, sorted1);
        assertSameRowSet(rows, sorted2);
        assertSameRowSet(rows, sorted3);

        // Map every token back to its original (pre-renumber) row so the
        // 'order' column is verified against the values the sort actually used.
        const originalByToken = Object.create(null);
        rows.forEach((r) => { originalByToken[r.token] = r; });

        // First activation -> ascending.
        assertMonotonic(sorted1, column, 'asc', originalByToken);
        // Second activation (same header) -> descending.
        assertMonotonic(sorted2, column, 'desc', originalByToken);
        // Third activation -> ascending again (returns to the first ordering's monotonicity).
        assertMonotonic(sorted3, column, 'asc', originalByToken);

        // ترتيب is renumbered to a gapless 1..n sequence in display order.
        for (let i = 0; i < sorted1.length; i++) {
            assert.strictEqual(sorted1[i].order, i + 1, 'order column must be a gapless 1..n sequence');
        }
    }),
    { numRuns: MIN_CASES, verbose: true }
);

console.log('PASS ed-matrix Property 22: Sorting orders by column and toggles direction (' + runCount + ' cases)');
