'use strict';

// Feature: exemptions-duty-matrix-grid, Property 10: Absent or unrecognized store entry resolves to guard (distribution)
//
// Validates: Requirements 4.2, 4.4
//
// Property 10 (design.md): For any proctor and session, if the
// Exemptions_Duty_Store has no exempt/duty/reserve entry for that proctor's
// Proctor_Key in that session, the Distribution_Algorithm treats that proctor
// as guard-eligible for that session (neither isExempt nor isOnDuty matches).
//
// The module exposes `isGuardEligible(store, proctorKey, sessionColumn)`, the
// verification-side mirror of the algorithm's "absence resolves to
// guard-eligible" behavior. It delegates to `resolveCellStatus`, so it must
// return true in exactly the cases where the cell resolves to guard.
//
// This is a standalone Node test script (run-all.js discovers top-level
// tests/*.test.js). It exits non-zero on any failure.
//
//   node tests/ed-matrix-property-10-distribution-absent-guard.test.js
//
// The session column under test is always built with the real
// `buildSessionColumns([entry])[0]` so its sessionKey / exemptKey / subjects
// are internally consistent with what the store lookups expect. We assert:
//   (a) ABSENT        — no entry at all for (proctorKey, session): empty maps,
//                       or entries that only target OTHER proctors / OTHER
//                       sessions → guard-eligible (true).
//   (b) UNRECOGNIZED  — an exempt value that is not the literal 'no', or a
//                       FALSY duty/reserve bucket entry → guard-eligible (true).
//   (c) DENIED        — a truthy duty/reserve entry, or a 'no' exempt entry,
//                       for the TARGET proctor/session → NOT guard-eligible
//                       (false): the user-selected status is honored.
// Each guard-eligible assertion is paired with a `resolveCellStatus === GUARD`
// consistency check (and each denied case with `!== GUARD`).

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
// proctor key (disjoint prefixes 'p' vs 'q' never collide).
const proctorIdArb = fc.integer({ min: 1, max: 99999 });
function targetKey(id) { return 'p' + id; }
function otherKey(id) { return 'q' + id; }

// A status that is NOT the literal 'no' — only 'no' encodes exempt (Req 4.4).
const notNoExemptValueArb = fc.constantFrom('yes', '', 'maybe', 'NO', 'no ', ' no', 'No', 'true', '0', 'guard');

// Falsy values for a duty/reserve bucket entry — a TRUTHY entry is required to
// match, so each of these is a non-match and must remain guard-eligible.
const falsyValueArb = fc.constantFrom(false, 0, '', null, undefined, NaN);

// Truthy values that DO encode a duty/reserve assignment (Req: user choice).
const truthyValueArb = fc.constantFrom(true, 1, 'yes', 'x');

function firstSubject(col) {
    return (Array.isArray(col.subjects) && col.subjects.length) ? col.subjects[0] : '';
}

// ---------------------------------------------------------------------------
// Sanity cases: null / empty stores are guard-eligible.
// ---------------------------------------------------------------------------

function checkSanity() {
    const col = M.buildSessionColumns([{
        date_year: 2025, date_month: 6, date_day: 10,
        day: 'الأول', period: 'صباحا', session: 'الحصة الأولى',
        subject_name: 'الرياضيات', order: 1
    }])[0];
    assert.ok(col, 'sanity: a session column must be built');

    assert.strictEqual(M.isGuardEligible(null, 'p1', col), true,
        'null store must be guard-eligible');
    assert.strictEqual(M.isGuardEligible(undefined, 'p1', col), true,
        'undefined store must be guard-eligible');
    assert.strictEqual(
        M.isGuardEligible({ exemptionsData: null, dutyData: null, reservesData: null }, 'p1', col),
        true, 'null sub-maps must be guard-eligible');
    assert.strictEqual(
        M.isGuardEligible({ exemptionsData: {}, dutyData: {}, reservesData: {} }, 'p1', col),
        true, 'empty sub-maps must be guard-eligible');
}

// ---------------------------------------------------------------------------
// Property 10 (a): ABSENT entry → guard-eligible.
//
// The store contains only "noise": exempt/duty/reserve entries for OTHER
// proctor keys in the SAME session, plus entries for the TARGET proctor in a
// DIFFERENT session. None of it targets (target proctor, this session), so the
// proctor must be treated as guard-eligible.
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

    assert.strictEqual(M.isGuardEligible(store, tKey, col), true,
        'absent entry for (proctor, session) must be guard-eligible');
    // Consistency: guard-eligibility mirrors resolveCellStatus === guard.
    assert.strictEqual(M.resolveCellStatus(store, tKey, col), GUARD,
        'absent entry must also resolve to guard (consistency)');
}

// ---------------------------------------------------------------------------
// Property 10 (b): UNRECOGNIZED entry → guard-eligible.
//
//   variant 0 — exempt bucket holds a value other than the literal 'no'.
//   variant 1 — duty bucket holds a FALSY entry for the target proctor.
//   variant 2 — reserve bucket holds a FALSY entry for the target proctor.
// In every variant no truthy duty/reserve and no 'no' exempt targets the cell,
// so the proctor must be treated as guard-eligible.
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

    assert.strictEqual(M.isGuardEligible(store, tKey, col), true,
        'unrecognized entry (variant ' + variant + ') must be guard-eligible');
    assert.strictEqual(M.resolveCellStatus(store, tKey, col), GUARD,
        'unrecognized entry (variant ' + variant + ') must also resolve to guard (consistency)');
}

// ---------------------------------------------------------------------------
// Property 10 (c): DENIED — a user-selected status is honored, NOT guard.
//
//   variant 0 — 'no' exempt entry for the target  → exempt (not guard).
//   variant 1 — truthy duty entry for the target   → duty   (not guard).
//   variant 2 — truthy reserve entry for the target→ reserve(not guard).
// Guard-eligibility must be DENIED (false) so the algorithm never overrides a
// user-selected exempt/duty/reserve status.
// ---------------------------------------------------------------------------

function checkDenied(entry, targetId, variant, truthyValue) {
    const col = M.buildSessionColumns([entry])[0];
    const tKey = targetKey(targetId);
    const subject = firstSubject(col);
    const datedBucket = col.sessionKey + '|' + subject;

    const store = { exemptionsData: {}, dutyData: {}, reservesData: {} };

    if (variant === 0) {
        store.exemptionsData[col.exemptKey] = {};
        store.exemptionsData[col.exemptKey][tKey] = 'no'; // exempt
    } else if (variant === 1) {
        store.dutyData[datedBucket] = {};
        store.dutyData[datedBucket][tKey] = truthyValue; // duty
    } else {
        store.reservesData[datedBucket] = {};
        store.reservesData[datedBucket][tKey] = truthyValue; // reserve
    }

    assert.strictEqual(M.isGuardEligible(store, tKey, col), false,
        'user-selected status (variant ' + variant + ') must NOT be guard-eligible');
    assert.notStrictEqual(M.resolveCellStatus(store, tKey, col), GUARD,
        'user-selected status (variant ' + variant + ') must NOT resolve to guard (consistency)');
}

// ---------------------------------------------------------------------------
// Runner.
// ---------------------------------------------------------------------------

console.log('[test] exemptions-duty-matrix-grid — Property 10: absent/unrecognized store entry resolves to guard (distribution)');

try {
    checkSanity();

    // (a) ABSENT → guard-eligible
    fc.assert(
        fc.property(scheduleEntryArb, proctorIdArb, proctorIdArb, fc.boolean(),
            (entry, targetId, noiseOtherId, addOtherSessionNoise) => {
                checkAbsent(entry, targetId, noiseOtherId, addOtherSessionNoise);
            }),
        { numRuns: 100 }
    );

    // (b) UNRECOGNIZED → guard-eligible
    fc.assert(
        fc.property(scheduleEntryArb, proctorIdArb, fc.integer({ min: 0, max: 2 }), notNoExemptValueArb, falsyValueArb,
            (entry, targetId, variant, notNoValue, falsyValue) => {
                checkUnrecognized(entry, targetId, variant, notNoValue, falsyValue);
            }),
        { numRuns: 100 }
    );

    // (c) DENIED → user-selected status honored (NOT guard-eligible)
    fc.assert(
        fc.property(scheduleEntryArb, proctorIdArb, fc.integer({ min: 0, max: 2 }), truthyValueArb,
            (entry, targetId, variant, truthyValue) => {
                checkDenied(entry, targetId, variant, truthyValue);
            }),
        { numRuns: 100 }
    );

    console.log('PASS: Property 10 holds — absent/unrecognized entries are guard-eligible and user-selected statuses are denied guard-eligibility (sanity + 300 generated cases)');
    process.exit(0);
} catch (err) {
    console.error('FAIL: Property 10 violated');
    console.error(err && err.message ? err.message : err);
    process.exit(1);
}
