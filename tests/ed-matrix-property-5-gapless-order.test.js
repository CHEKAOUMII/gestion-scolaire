'use strict';

// Feature: exemptions-duty-matrix-grid, Property 5: Order column is a gapless 1..n sequence in display order
//
// Validates: Requirements 2.4, 2.5
//
// Property 5 (design.md): For any set of visible Proctor_Rows in any display
// order (initial, sorted, filtered, or searched), the ترتيب (`order`) column
// values equal the sequence 1, 2, …, n top-to-bottom with no gaps and no
// repeats.
//
// This test covers two surfaces of that guarantee:
//   (a) buildMatrixModel(...) — the INITIAL display order. Kept (identity-bearing)
//       rows are numbered 1..n; identity-empty proctors are omitted and must not
//       consume an `order` value, so the kept rows stay gapless.
//   (b) applySearchFilterSort(...) — every derived display order (searched,
//       status-filtered, sorted asc/desc, and combinations, chained via
//       nextSortState). The RETURNED visible subset of size k must be renumbered
//       1..k with no gaps and no repeats in returned order: result[i].order === i+1.
//
// Standalone Node test script (run-all.js discovers top-level tests/*.test.js).
// Exits non-zero on any failure.
//
//   node tests/ed-matrix-property-5-gapless-order.test.js

const assert = require('assert');
const fc = require('fast-check');

const M = require('../js/exams/ed-matrix-logic.js');
const { STATUS } = M;

const MIN_CASES = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const PERIODS = ['صباحا', 'زوالا'];
const SESSIONS = ['الحصة الأولى', 'الحصة الثانية', 'الحصة الثالثة'];
const DAYS = ['الأول', 'الثاني', 'الثالث'];
const SUBJECTS = ['الرياضيات', 'العربية', 'الفيزياء', 'التاريخ'];
const NAMES = ['أحمد', 'سعاد', 'يوسف', 'مريم', 'خالد', 'فاطمة'];
const SPECIALTIES = ['رياضيات', 'فيزياء', 'عربية', 'تاريخ'];
const WORKPLACES = ['ثانوية أ', 'ثانوية ب', 'إعدادية ج'];

// Schedule entry → sessions. Small pools force session collisions.
const scheduleEntryArb = fc.record({
    date_year: fc.constant(2025),
    date_month: fc.integer({ min: 1, max: 3 }),
    date_day: fc.integer({ min: 1, max: 4 }),
    day: fc.constantFrom.apply(fc, DAYS),
    period: fc.constantFrom.apply(fc, PERIODS),
    session: fc.constantFrom.apply(fc, SESSIONS),
    subject_name: fc.constantFrom.apply(fc, SUBJECTS),
    order: fc.integer({ min: 1, max: 50 })
});
const scheduleEntriesArb = fc.array(scheduleEntryArb, { minLength: 0, maxLength: 12 });

// An empty-ish identity field: either absent, null, '' or whitespace.
const emptyFieldArb = fc.constantFrom(undefined, null, '', '   ', '\t');
const maybeSpecialtyArb = fc.oneof(fc.constantFrom.apply(fc, SPECIALTIES), emptyFieldArb);
const maybeWorkplaceArb = fc.oneof(fc.constantFrom.apply(fc, WORKPLACES), emptyFieldArb);
const maybeSomArb = fc.oneof(fc.string({ minLength: 1, maxLength: 5 }), emptyFieldArb);

// An "identity-bearing" proctor: at least one identity field is guaranteed non-empty.
const identityProctorArb = fc.record({
    teacher_name: fc.constantFrom.apply(fc, NAMES),
    som: maybeSomArb,
    workplace: maybeWorkplaceArb,
    specialty: maybeSpecialtyArb,
    cin: fc.oneof(fc.string({ minLength: 1, maxLength: 6 }), emptyFieldArb)
});

// An "all-empty" proctor: every one of the four identity data fields is empty,
// so buildProctorRows MUST omit it (Requirement 2.3). cin/som may still be
// present (they are store-key sources, not identity columns) — but to make a
// truly omitted row, keep them empty too sometimes.
const allEmptyProctorArb = fc.record({
    teacher_name: emptyFieldArb,
    som: emptyFieldArb,
    workplace: emptyFieldArb,
    specialty: emptyFieldArb,
    cin: fc.oneof(emptyFieldArb, fc.string({ minLength: 1, maxLength: 6 }))
});

// A mixed list: some identity-bearing, some all-empty (to be omitted).
const proctorArb = fc.oneof(
    { weight: 3, arbitrary: identityProctorArb },
    { weight: 1, arbitrary: allEmptyProctorArb }
);
const proctorsArb = fc.array(proctorArb, { minLength: 0, maxLength: 20 });

// Optional store entries — these affect cell statuses (and thus status-filter
// visibility) but must NOT affect the gapless-order invariant.
const storeArb = fc.record({
    exemptionsData: fc.constant({}),
    dutyData: fc.constant({}),
    reservesData: fc.constant({})
});

// A search-text generator: empty/whitespace, a real name fragment, or noise.
const searchTextArb = fc.oneof(
    fc.constant(''),
    fc.constant('   '),
    fc.constantFrom.apply(fc, NAMES),
    fc.constantFrom.apply(fc, SPECIALTIES),
    fc.string({ maxLength: 4 })
);

// A status-filter generator: 'all'/none, or one of the four statuses.
const statusFilterArb = fc.constantFrom(
    'all', '', null, undefined,
    STATUS.GUARD, STATUS.EXEMPT, STATUS.DUTY, STATUS.RESERVE
);

// A sortable column id (plus a couple invalid ones that must preserve order).
const sortColumnArb = fc.constantFrom(
    'order', 'name', 'registration', 'institution', 'specialty', 'bogus', null
);

// ---------------------------------------------------------------------------
// Assertion helper: a row array's `order` values are exactly 1..n top-to-bottom.
// ---------------------------------------------------------------------------

function assertGapless1ToN(rows, context) {
    for (let i = 0; i < rows.length; i++) {
        assert.strictEqual(
            rows[i].order,
            i + 1,
            context + ': row at position ' + i + ' must have order ' + (i + 1) +
            ' but had ' + rows[i].order
        );
    }
    // Independent set-equality check: the multiset of orders == {1..n} exactly
    // (no gaps, no repeats), regardless of position assertion above.
    const orders = rows.map(function (r) { return r.order; }).sort(function (a, b) { return a - b; });
    const expected = [];
    for (let k = 1; k <= rows.length; k++) {
        expected.push(k);
    }
    assert.deepStrictEqual(
        orders,
        expected,
        context + ': order values must be the gapless set 1..' + rows.length +
        ' with no gaps or repeats'
    );
}

let runCount = 0;

console.log('[test] exemptions-duty-matrix-grid — Property 5: order column is a gapless 1..n sequence in display order');

// ---------------------------------------------------------------------------
// Property 5 — initial build order + all derived display orders.
// ---------------------------------------------------------------------------

fc.assert(
    fc.property(
        proctorsArb,
        scheduleEntriesArb,
        storeArb,
        searchTextArb,
        statusFilterArb,
        sortColumnArb,
        function (proctors, scheduleEntries, store, searchText, statusFilter, sortColumn) {
            runCount++;

            const sessions = M.buildSessionColumns(scheduleEntries);
            const model = M.buildMatrixModel(proctors, sessions, store);

            // (a) INITIAL display order: kept rows are numbered 1..n with no
            //     gaps — identity-empty proctors were omitted without consuming
            //     an order value (Requirements 2.4, 2.5).
            assertGapless1ToN(model.rows, 'buildMatrixModel initial order');

            // (b) DERIVED display orders. Apply several search/filter/sort
            //     operations; each returned visible subset must itself be a
            //     gapless 1..k sequence in returned order.

            // b1: search only.
            const searched = M.applySearchFilterSort(model.rows, { searchText: searchText });
            assertGapless1ToN(searched, 'applySearchFilterSort (search only)');

            // b2: status filter only.
            const filtered = M.applySearchFilterSort(model.rows, { statusFilter: statusFilter });
            assertGapless1ToN(filtered, 'applySearchFilterSort (filter only)');

            // b3: single sort activation (ascending) on the chosen column.
            const sort1 = M.nextSortState(null, sortColumn);
            const sorted1 = M.applySearchFilterSort(model.rows, { sort: sort1 });
            assertGapless1ToN(sorted1, 'applySearchFilterSort (sort asc)');

            // b4: second activation of the SAME column toggles to descending.
            const sort2 = M.nextSortState(sort1, sortColumn);
            const sorted2 = M.applySearchFilterSort(model.rows, { sort: sort2 });
            assertGapless1ToN(sorted2, 'applySearchFilterSort (sort desc)');

            // b5: combined search + filter + sort, chained from the prior sort.
            const combined = M.applySearchFilterSort(model.rows, {
                searchText: searchText,
                statusFilter: statusFilter,
                sort: sort2
            });
            assertGapless1ToN(combined, 'applySearchFilterSort (search + filter + sort)');

            // b6: re-applying to an already-renumbered subset stays gapless
            //     (idempotent renumbering — no drift).
            const rerun = M.applySearchFilterSort(combined, { searchText: searchText });
            assertGapless1ToN(rerun, 'applySearchFilterSort (re-applied to visible subset)');
        }
    ),
    { numRuns: MIN_CASES, verbose: true }
);

console.log('PASS ed-matrix Property 5: order column is a gapless 1..n sequence in display order (' + runCount + ' cases)');
process.exit(0);
