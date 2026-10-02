// Feature: exemptions-duty-matrix-grid, Property 21: Status filter shows rows with a matching cell
//
// Validates: Requirements 9.3, 9.4
//
// For any set of rows and any selected status filter, the visible rows returned
// by `applySearchFilterSort` are EXACTLY those with at least one Status_Cell of
// that status (i.e. summary[status] > 0). An "all"/cleared filter ('all', '',
// null, undefined) imposes no status restriction, so every row is returned.
// The filter never changes any cell's status (Requirement 9.7 corollary).

'use strict';

const assert = require('assert');
const fc = require('fast-check');

const M = require('../js/exams/ed-matrix-logic.js');
const { applySearchFilterSort, computeRowSummary, STATUS } = M;

const MIN_CASES = 100;

// The four recognized statuses; guard counts by default, so a row of all-guard
// cells still matches the 'guard' filter.
const KNOWN_STATUSES = [STATUS.GUARD, STATUS.EXEMPT, STATUS.DUTY, STATUS.RESERVE];

const statusArb = fc.constantFrom(...KNOWN_STATUSES);

// A row spec: identity text fields + a list of per-session cell statuses.
const rowSpecArb = fc.record({
    name: fc.string({ maxLength: 12 }),
    specialty: fc.string({ maxLength: 12 }),
    institution: fc.string({ maxLength: 12 }),
    cellStatuses: fc.array(statusArb, { minLength: 0, maxLength: 12 })
});

// An array of row specs (the full, ordered matrix rows).
const rowsArb = fc.array(rowSpecArb, { minLength: 0, maxLength: 15 });

// Build a ProctorRow from a spec, attaching a unique `identity.registration`
// token so we can match returned (renumbered, copied) rows back to inputs.
function buildRow(spec, index) {
    const cells = new Map();
    spec.cellStatuses.forEach((status, i) => {
        cells.set('session_' + i, status);
    });
    return {
        order: index + 1,
        identity: {
            name: spec.name,
            registration: 'reg_' + index, // unique token per row
            institution: spec.institution,
            specialty: spec.specialty
        },
        cells: cells,
        summary: computeRowSummary(cells)
    };
}

// Snapshot a row's cells as a plain [key, value] array for change detection.
function snapshotCells(row) {
    return Array.from(row.cells.entries());
}

let runCount = 0;

// --- Property: a specific status filter shows exactly the matching rows -----
fc.assert(
    fc.property(rowsArb, fc.constantFrom(...KNOWN_STATUSES), (specs, statusFilter) => {
        runCount++;

        const rows = specs.map(buildRow);
        const before = rows.map(snapshotCells);

        const visible = applySearchFilterSort(rows, {
            searchText: '',
            statusFilter: statusFilter,
            sort: null
        });

        // Expected: rows whose summary[statusFilter] > 0.
        const expectedRegs = rows
            .filter((r) => computeRowSummary(r.cells)[statusFilter] > 0)
            .map((r) => r.identity.registration)
            .sort();

        const actualRegs = visible.map((r) => r.identity.registration).sort();

        assert.deepStrictEqual(
            actualRegs,
            expectedRegs,
            'status filter "' + statusFilter + '" visible rows mismatch'
        );

        // Every visible row genuinely has >= 1 cell of the filtered status.
        for (const r of visible) {
            assert.ok(
                computeRowSummary(r.cells)[statusFilter] > 0,
                'visible row lacks a ' + statusFilter + ' cell'
            );
        }

        // No cell statuses changed on the original rows.
        rows.forEach((r, i) => {
            assert.deepStrictEqual(
                snapshotCells(r),
                before[i],
                'cell statuses mutated by status filter'
            );
        });
    }),
    { numRuns: MIN_CASES, verbose: true }
);

// --- Property: an "all"/cleared filter imposes no status restriction --------
const clearedFilterArb = fc.constantFrom('all', '', null, undefined);

fc.assert(
    fc.property(rowsArb, clearedFilterArb, (specs, statusFilter) => {
        runCount++;

        const rows = specs.map(buildRow);
        const before = rows.map(snapshotCells);

        const visible = applySearchFilterSort(rows, {
            searchText: '',
            statusFilter: statusFilter,
            sort: null
        });

        // No restriction: every input row is returned.
        const expectedRegs = rows.map((r) => r.identity.registration).sort();
        const actualRegs = visible.map((r) => r.identity.registration).sort();

        assert.deepStrictEqual(
            actualRegs,
            expectedRegs,
            'cleared filter (' + String(statusFilter) + ') should return all rows'
        );
        assert.strictEqual(visible.length, rows.length, 'cleared filter dropped rows');

        // No cell statuses changed.
        rows.forEach((r, i) => {
            assert.deepStrictEqual(
                snapshotCells(r),
                before[i],
                'cell statuses mutated by cleared filter'
            );
        });
    }),
    { numRuns: MIN_CASES, verbose: true }
);

console.log('PASS ed-matrix Property 21: Status filter shows rows with a matching cell (' + runCount + ' cases across specific + cleared filters)');
