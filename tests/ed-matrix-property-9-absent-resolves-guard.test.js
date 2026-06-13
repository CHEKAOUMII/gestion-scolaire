'use strict';

// Feature: exemptions-duty-matrix-grid, Property 9: Absent or unrecognized store entry resolves to guard (display)
//
// Validates: Requirements 4.1, 4.3
//
// Property 9 (design.md): For any proctor and session, if the
// Exemptions_Duty_Store has no entry for that proctor's Proctor_Key in that
// session, OR has a value that is not one of exempt/duty/reserve, then
// `resolveCellStatus` returns guard (STATUS.GUARD) — the cell displays the
// guard code `ك`.
//
// This is a standalone Node test script (run-all.js discovers top-level
// tests/*.test.js). It exits non-zero on any failure.
//
//   node tests/ed-matrix-property-9-absent-resolves-guard.test.js
//
// The session column under test is always built with the real
// `buildSessionColumns([entry])[0]` so its sessionKey / exemptKey / subjects
// are internally consistent with what `resolveCellStatus` looks up. We then
// assert two independent families of "should be guard" stores:
//   (a) ABSENT     — no entry at all for (proctorKey, session): empty maps, or
//                    entries that only target OTHER proctors / OTHER sessions.
//   (b) UNRECOGNIZED — an exempt value that is not the literal 'no', or a
//                    duty/reserve bucket entry that is FALSY (resolveCellStatus
//                    treats duty/reserve as truthy, so a falsy entry is a
//                    non-match and must resolve to guard). We deliberately
//                    never inject a TRUTHY duty/reserve entry, which would
//                    correctly resolve to duty/reserve.
// Plus explicit sanity cases for null store / null sub-maps.

const assert = require('assert');
const fc = require('fast-check');

const M = require('../js/exams/ed-matrix-logic.js');

const GUARD = M.STATUS.GUARD;

// ---------------------------------------------------------------------------
// Arbitraries.
// ---------------------------------------------------------------------------

const scheduleEntryArb = fc.record({
    date_year: fc.constant(2025),
    date_month: fc.integer({ min: 1, max: 12 }),
    date_day: fc.integer({ min: 1, max: 28 }),
    day: fc.constantFrom('الأول', 'الثاني', 'الثالث'),
    period: fc.constantFrom('صباحا', 'زوالا'),
    session: fc.constantFrom('الحصة الأولى', 'الحصة الثانية', 'الحصة الثالثة'),
    subject_name: fc.constantFrom('الرياضيات', 'العربية', 'الفيزياء', 'التاريخ'),
    order: fc.integer({ min: 1, max: 50 })
});

// Target proctor key (the cell under test) and a guaranteed-distinct "other"
// proctor key (numeric ids with disjoint prefixes 'p' vs 'q' never collide).
const proctorIdArb = fc.integer({ min: 1, max: 99999 });
function targetKey(id) { return 'p' + id; }
function otherKey(id) { return 'q' + id; }

// A status that is NOT the literal 'no' — exercising Requirement 4.3 for the
// exempt bucket (only the literal 'no' encodes exempt).
const notNoExemptValueArb = fc.constantFrom('yes', '', 'maybe', 'NO', 'no ', ' no', 'No', 'true', '0', 'guard');

// Falsy values for a duty/reserve bucket entry — resolveCellStatus requires a
// TRUTHY entry, so each of these must resolve to guard.
const falsyValueArb = fc.constantFrom(false, 0, '', null, undefined, NaN);

function firstSubject(col) {
    return (Array.isArray(col.subjects) && col.subjects.length) ? col.subjects[0] : '';
}

// ---------------------------------------------------------------------------
// Sanity cases: null / empty stores resolve to guard.
// ---------------------------------------------------------------------------

function checkSanity() {
    const col = M.buildSessionColumns([{
        date_year: 2025, date_month: 6, date_day: 10,
        day: 'الأول', period: 'صباحا', session: 'الحصة الأولى',
        subject_name: 'الرياضيات', order: 1
    }])[0];
    assert.ok(col, 'sanity: a session column must be built');

    assert.strictEqual(M.resolveCellStatus(null, 'p1', col), GUARD,
        'null store must resolve to guard');
    assert.strictEqual(M.resolveCellStatus(undefined, 'p1', col), GUARD,
        'undefined store must resolve to guard');
    assert.strictEqual(
        M.resolveCellStatus({ exemptionsData: null, dutyData: null, reservesData: null }, 'p1', col),
        GUARD, 'null sub-maps must resolve to guard');
    assert.strictEqual(
        M.resolveCellStatus({ exemptionsData: {}, dutyData: {}, reservesData: {} }, 'p1', col),
        GUARD, 'empty sub-maps must resolve to guard');
}

// ---------------------------------------------------------------------------
// Property 9 (a): ABSENT entry resolves to guard.
//
// The store contains only "noise": exempt/duty/reserve entries for OTHER
// proctor keys in the SAME session, plus entries for the TARGET proctor in a
// DIFFERENT session. None of it targets (target proctor, this session), so the
// cell must resolve to guard.
// ---------------------------------------------------------------------------

function checkAbsent(entry, targetId, noiseOtherId, addOtherSessionNoise) {
    const col = M.buildSessionColumns([entry])[0];
    const tKey = targetKey(targetId);
    const oKey = otherKey(noiseOtherId);
    const subject = firstSubject(col);

    const store = { exemptionsData: {}, dutyData: {}, reservesData: {} };

    // Noise for OTHER proctors in THIS session (truthy / 'no' — but not target).
    store.exemptionsData[col.exemptKey] = {};
    store.exemptionsData[col.exemptKey][oKey] = 'no';

    const datedBucket = col.sessionKey + '|' + subject;
    store.dutyData[datedBucket] = {};
    store.dutyData[datedBucket][oKey] = true;
    store.reservesData[datedBucket] = {};
    store.reservesData[datedBucket][oKey] = true;

    // Noise for the TARGET proctor in a DIFFERENT session (distinct keys).
    if (addOtherSessionNoise) {
        const otherExemptKey = col.exemptKey + '|__OTHER_SESSION__';
        store.exemptionsData[otherExemptKey] = {};
        store.exemptionsData[otherExemptKey][tKey] = 'no';

        const otherBucket = col.sessionKey + '|__OTHER_SUBJECT__';
        store.dutyData[otherBucket] = {};
        store.dutyData[otherBucket][tKey] = true;
        store.reservesData[otherBucket] = {};
        store.reservesData[otherBucket][tKey] = true;
    }

    const status = M.resolveCellStatus(store, tKey, col);
    assert.strictEqual(status, GUARD,
        'absent entry for (proctor, session) must resolve to guard; got "' + status + '"');
}

// ---------------------------------------------------------------------------
// Property 9 (b): UNRECOGNIZED entry resolves to guard.
//
//   variant 0 — exempt bucket holds a value other than the literal 'no'.
//   variant 1 — duty bucket holds a FALSY entry for the target proctor.
//   variant 2 — reserve bucket holds a FALSY entry for the target proctor.
// In every variant no truthy duty/reserve and no 'no' exempt targets the cell,
// so it must resolve to guard.
// ---------------------------------------------------------------------------

function checkUnrecognized(entry, targetId, variant, notNoValue, falsyValue) {
    const col = M.buildSessionColumns([entry])[0];
    const tKey = targetKey(targetId);
    const subject = firstSubject(col);
    const datedBucket = col.sessionKey + '|' + subject;

    const store = { exemptionsData: {}, dutyData: {}, reservesData: {} };

    if (variant === 0) {
        store.exemptionsData[col.exemptKey] = {};
        store.exemptionsData[col.exemptKey][tKey] = notNoValue; // not 'no'
    } else if (variant === 1) {
        store.dutyData[datedBucket] = {};
        store.dutyData[datedBucket][tKey] = falsyValue; // falsy -> non-match
    } else {
        store.reservesData[datedBucket] = {};
        store.reservesData[datedBucket][tKey] = falsyValue; // falsy -> non-match
    }

    const status = M.resolveCellStatus(store, tKey, col);
    assert.strictEqual(status, GUARD,
        'unrecognized entry (variant ' + variant + ') must resolve to guard; got "' + status + '"');
}

// ---------------------------------------------------------------------------
// Runner.
// ---------------------------------------------------------------------------

console.log('[test] exemptions-duty-matrix-grid — Property 9: absent/unrecognized store entry resolves to guard (display)');

try {
    checkSanity();

    // (a) ABSENT
    fc.assert(
        fc.property(scheduleEntryArb, proctorIdArb, proctorIdArb, fc.boolean(),
            (entry, targetId, noiseOtherId, addOtherSessionNoise) => {
                checkAbsent(entry, targetId, noiseOtherId, addOtherSessionNoise);
            }),
        { numRuns: 100 }
    );

    // (b) UNRECOGNIZED
    fc.assert(
        fc.property(scheduleEntryArb, proctorIdArb, fc.integer({ min: 0, max: 2 }), notNoExemptValueArb, falsyValueArb,
            (entry, targetId, variant, notNoValue, falsyValue) => {
                checkUnrecognized(entry, targetId, variant, notNoValue, falsyValue);
            }),
        { numRuns: 100 }
    );

    console.log('PASS: Property 9 holds — absent and unrecognized store entries resolve to guard (sanity + 200 generated cases)');
    process.exit(0);
} catch (err) {
    console.error('FAIL: Property 9 violated');
    console.error(err && err.message ? err.message : err);
    process.exit(1);
}
