'use strict';

// Feature: exemptions-duty-matrix-grid, Property 2: One column per distinct session
//
// Validates: Requirements 1.2
//
// Property 2 (design.md): For any set of schedule entries, the matrix model
// contains exactly one Session_Column for each distinct (date, period, session)
// tuple present in the schedule.
//
// The canonical identity of a session — the value `buildSessionColumns` groups
// by and that the duty/reserve store is keyed on — is `getScheduleSessionKey`
// (`YYYY-MM-DD|day|period|session`). Per the task contract, distinctness is
// measured against `getScheduleSessionKey`: the returned column count must equal
// the number of distinct `getScheduleSessionKey` values among the input entries,
// each distinct tuple must yield exactly one column, and a session scheduled
// with several subjects must collapse into a single column whose `subjects`
// list includes them all.
//
// This is a standalone Node test script (run-all.js discovers top-level
// tests/*.test.js). It exits non-zero on any failure.
//
//   node tests/ed-matrix-property-2-one-column-per-session.test.js

const assert = require('assert');
const fc = require('fast-check');

const M = require('../js/exams/ed-matrix-logic.js');

// ---------------------------------------------------------------------------
// Custom arbitrary for schedule entries.
//
// Small pools for date/day/period/session deliberately force MANY collisions
// on the (date, day, period, session) tuple, so most generated sets contain
// duplicate sessions. The subject pool is independent, so duplicate tuples
// routinely carry DIFFERENT subjects — exercising the subject-collapse rule.
// ---------------------------------------------------------------------------

const PERIODS = ['صباحا', 'زوالا'];
const SESSIONS = ['الحصة الأولى', 'الحصة الثانية', 'الحصة الثالثة'];
const DAYS = ['الأول', 'الثاني', 'الثالث'];
const SUBJECTS = ['الرياضيات', 'العربية', 'الفيزياء', 'التاريخ'];

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

// minLength 1 guarantees at least one entry so duplicate tuples are reachable.
const scheduleEntriesArb = fc.array(scheduleEntryArb, { minLength: 1, maxLength: 30 });

// ---------------------------------------------------------------------------
// The property.
// ---------------------------------------------------------------------------

function checkProperty2(entries) {
    const columns = M.buildSessionColumns(entries);

    // Expected set of distinct sessions, derived independently from the
    // canonical session key, plus the union of subjects scheduled per session.
    const expectedSubjects = new Map(); // sessionKey -> Set<subject>
    for (const entry of entries) {
        if (!entry) {
            continue;
        }
        const key = M.getScheduleSessionKey(entry);
        if (!expectedSubjects.has(key)) {
            expectedSubjects.set(key, new Set());
        }
        if (entry.subject_name) {
            expectedSubjects.get(key).add(entry.subject_name);
        }
    }

    // (a) Exactly one column per distinct session: count matches and there are
    //     no duplicate sessionKeys in the output.
    assert.strictEqual(
        columns.length,
        expectedSubjects.size,
        'column count (' + columns.length + ') must equal the number of distinct ' +
        'getScheduleSessionKey values (' + expectedSubjects.size + ')'
    );

    const seen = new Set();
    for (const col of columns) {
        assert.ok(
            !seen.has(col.sessionKey),
            'each distinct session must produce exactly one column; duplicate column ' +
            'for sessionKey "' + col.sessionKey + '"'
        );
        seen.add(col.sessionKey);
    }

    // (b) The column set equals the expected distinct-session set exactly.
    assert.deepStrictEqual(
        Array.from(seen).sort(),
        Array.from(expectedSubjects.keys()).sort(),
        'the set of column sessionKeys must equal the set of distinct sessions in the schedule'
    );

    // (c) A session scheduled with multiple subjects collapses into one column
    //     whose `subjects` list includes every subject scheduled for it
    //     (de-duplicated). Order is not asserted, only set membership.
    for (const col of columns) {
        const expected = expectedSubjects.get(col.sessionKey);
        assert.ok(expected, 'column sessionKey "' + col.sessionKey + '" must be an expected session');

        // No duplicate subjects within a single column.
        assert.strictEqual(
            col.subjects.length,
            new Set(col.subjects).size,
            'column subjects must be de-duplicated for sessionKey "' + col.sessionKey + '"'
        );

        assert.deepStrictEqual(
            col.subjects.slice().sort(),
            Array.from(expected).sort(),
            'column subjects for "' + col.sessionKey + '" must include exactly the ' +
            'subjects scheduled in that session'
        );
    }
}

// ---------------------------------------------------------------------------
// Runner.
// ---------------------------------------------------------------------------

console.log('[test] exemptions-duty-matrix-grid — Property 2: one column per distinct session');

try {
    fc.assert(
        fc.property(scheduleEntriesArb, (entries) => {
            checkProperty2(entries);
        }),
        { numRuns: 100 }
    );
    console.log('PASS: Property 2 holds across 100 generated schedule sets');
    process.exit(0);
} catch (err) {
    console.error('FAIL: Property 2 violated');
    console.error(err && err.message ? err.message : err);
    process.exit(1);
}
