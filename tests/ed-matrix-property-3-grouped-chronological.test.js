'use strict';

// Feature: exemptions-duty-matrix-grid, Property 3: Session columns are grouped and chronologically ordered
//
// Validates: Requirements 1.3, 1.4
//
// Property 3 (design.md): For any set of schedule entries, the
// Date_Group_Headers (`buildDateGroups`) are ordered by date ascending and
// partition all Session_Columns (`buildSessionColumns`), and within each date
// group the columns are ordered by period (صباحا before زوالا) then by session
// sequence (الحصة الأولى, الثانية, الثالثة).
//
// This is a standalone Node test script (run-all.js discovers top-level
// tests/*.test.js). It exits non-zero on any failure.
//
//   node tests/ed-matrix-property-3-grouped-chronological.test.js
//
// Expected ordering is derived from the SAME sort semantics design.md ascribes
// to getScheduleSortKey — date ascending, then period (صباحا before زوالا),
// then the canonical session sequence (الأولى, الثانية, الثالثة) — encoded here
// as explicit rank tables so the test validates the requirement rather than
// mirroring the implementation.

const assert = require('assert');
const fc = require('fast-check');

const M = require('../js/exams/ed-matrix-logic.js');

// ---------------------------------------------------------------------------
// Canonical ordering ranks (the semantics of Requirements 1.3 / 1.4).
// ---------------------------------------------------------------------------

// Period order: صباحا (morning) before زوالا (afternoon).
const PERIODS = ['صباحا', 'زوالا'];
// Session sequence: first, then second, then third الحصة.
const SESSIONS = ['الحصة الأولى', 'الحصة الثانية', 'الحصة الثالثة'];

function periodRank(period) {
    const i = PERIODS.indexOf(period);
    return i === -1 ? 99 : i;
}

function sessionRank(session) {
    const i = SESSIONS.indexOf(session);
    return i === -1 ? 99 : i;
}

// ---------------------------------------------------------------------------
// Expected ordering, derived independently from the requirement semantics:
// group columns by dateKey, order date groups ascending, and within each group
// order by (periodRank, sessionRank).
// ---------------------------------------------------------------------------

function expectedColumnOrder(columns) {
    const byDate = new Map();
    for (const col of columns) {
        if (!byDate.has(col.dateKey)) {
            byDate.set(col.dateKey, []);
        }
        byDate.get(col.dateKey).push(col);
    }
    // YYYY-MM-DD keys: lexical ascending === chronological ascending.
    const dateKeys = Array.from(byDate.keys()).sort();
    const out = [];
    for (const dk of dateKeys) {
        const grp = byDate.get(dk).slice().sort((a, b) => {
            const pr = periodRank(a.period) - periodRank(b.period);
            if (pr !== 0) {
                return pr;
            }
            return sessionRank(a.session) - sessionRank(b.session);
        });
        for (const col of grp) {
            out.push(col);
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Custom arbitrary for schedule entries.
//
// `day` is held constant so distinct columns within a date differ only by
// (period, session): this keeps the column ordering within each date group
// unambiguous (at most one column per period/session combo) while still
// exercising multiple distinct dates, both periods, all three sessions, and
// the de-duplication of subjects into a single column.
// ---------------------------------------------------------------------------

const scheduleEntryArb = fc.record({
    date_year: fc.constant(2025),
    date_month: fc.integer({ min: 1, max: 3 }),   // small pool -> many date collisions + several distinct dates
    date_day: fc.integer({ min: 1, max: 5 }),
    day: fc.constant('الأول'),
    period: fc.constantFrom.apply(fc, PERIODS),
    session: fc.constantFrom.apply(fc, SESSIONS),
    subject_name: fc.constantFrom('الرياضيات', 'العربية', 'الفيزياء', 'التاريخ'),
    order: fc.integer({ min: 1, max: 50 })
});

const scheduleEntriesArb = fc.array(scheduleEntryArb, { minLength: 0, maxLength: 25 });

// ---------------------------------------------------------------------------
// The property.
// ---------------------------------------------------------------------------

function checkProperty3(entries) {
    const columns = M.buildSessionColumns(entries);
    const groups = M.buildDateGroups(columns);

    // (a) Date_Group_Headers are strictly ascending by date (and therefore
    //     each date appears in exactly one group).
    for (let i = 1; i < groups.length; i++) {
        assert.ok(
            groups[i - 1].dateKey < groups[i].dateKey,
            'date groups must be strictly ascending by dateKey, got "' +
            groups[i - 1].dateKey + '" before "' + groups[i].dateKey + '"'
        );
    }

    // Flatten the columns as they appear across the ordered date groups.
    const actualFlat = [];
    for (const g of groups) {
        // span must equal the number of columns it carries.
        assert.strictEqual(g.span, g.columns.length,
            'date group span (' + g.span + ') must equal its column count (' + g.columns.length + ')');
        for (const col of g.columns) {
            actualFlat.push(col);
        }
    }

    // (b) The groups partition the Session_Columns exactly: every column
    //     appears once and only once, with no overlaps or omissions.
    assert.strictEqual(actualFlat.length, columns.length,
        'date groups must contain every session column exactly once (count mismatch)');

    const colKeysSorted = columns.map(c => c.sessionKey).slice().sort();
    const flatKeysSorted = actualFlat.map(c => c.sessionKey).slice().sort();
    assert.deepStrictEqual(flatKeysSorted, colKeysSorted,
        'the union of date-group columns must equal buildSessionColumns output exactly once each');

    const columnSet = new Set(columns);
    for (const col of actualFlat) {
        assert.ok(columnSet.has(col),
            'every grouped column must be a member of the buildSessionColumns output');
    }

    // (c) Within each date group, columns are ordered by period (صباحا before
    //     زوالا) then by session sequence (الأولى < الثانية < الثالثة).
    //     Verified by comparing the actual flattened order against the order
    //     derived from the canonical period/session ranks.
    const expectedFlat = expectedColumnOrder(columns);
    assert.deepStrictEqual(
        actualFlat.map(c => c.sessionKey),
        expectedFlat.map(c => c.sessionKey),
        'columns must be ordered by date ascending, then period (صباحا before زوالا), ' +
        'then session sequence (الحصة الأولى, الثانية, الثالثة)'
    );
}

// ---------------------------------------------------------------------------
// Runner.
// ---------------------------------------------------------------------------

console.log('[test] exemptions-duty-matrix-grid — Property 3: grouped & chronologically ordered session columns');

try {
    fc.assert(
        fc.property(scheduleEntriesArb, (entries) => {
            checkProperty3(entries);
        }),
        { numRuns: 100 }
    );
    console.log('PASS: Property 3 holds across 100 generated schedule sets');
    process.exit(0);
} catch (err) {
    console.error('FAIL: Property 3 violated');
    console.error(err && err.message ? err.message : err);
    process.exit(1);
}
