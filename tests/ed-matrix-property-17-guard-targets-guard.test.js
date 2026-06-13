'use strict';

// Feature: exemptions-duty-matrix-grid, Property 17: Generated guard duties target only guard-status proctors
//
// Validates: Requirements 7.3
//
// Property 17 (design.md): For any distribution run, every generated guard
// assignment targets a proctor whose pre-run Proctor_Status for that session is
// guard. No generated guard duty may land on an exempt/duty/reserve cell.
//
// This standalone Node test exercises the guard-targeting half of
// `honorsUserChoices(storeBefore, assignmentResult)` and the `isGuardEligible`
// predicate directly. It exits non-zero on any failure.
//
//   node tests/ed-matrix-property-17-guard-targets-guard.test.js
//
// MODELING NOTE — real bundle vs. contract model:
// The design lists Property 17 as a run of `js/algorithms/proctor-v3.bundle.js`
// with mocked needs. Per the design's own fallback ("if impractical, model the
// contract faithfully and clearly document it"), this test MODELS the
// AssignmentResult contract rather than booting the V3 bundle. This is faithful
// because `honorsUserChoices` and `isGuardEligible` are pure store-oriented
// projections: the JSDoc `@typedef AssignmentResult` explicitly documents that
// the result is "a thin, store-oriented projection of what the real V3
// algorithm produces" and that callers may "Construct it directly in unit
// tests". We therefore build storeBefore from real `buildSessionColumns`
// output, resolve statuses with the same `resolveCellStatus` the algorithm
// reads, and construct `guardAssignments` carrying real SessionColumn objects.
//
// Strategy:
//   POSITIVE — random storeBefore with non-guard entries scattered across
//     proctor/sessions. Build guardAssignments that target ONLY cells whose
//     pre-run status is guard (each verified via isGuardEligible before being
//     added). storeAfter === storeBefore, so the status-preservation half is
//     trivially satisfied and only the guard-targeting half is under test.
//     Assert honorsUserChoices(...) === true.
//   NEGATIVE — force at least one cell to a non-guard status (exempt/duty/
//     reserve) and add a guardAssignment targeting it. storeAfter ===
//     storeBefore (so part (a) passes and only the guard-targeting half (b) can
//     fail). Assert honorsUserChoices(...) === false.
//   DIRECT — assert isGuardEligible is false for every exempt/duty/reserve cell
//     and true for every guard cell across the generated stores.

const assert = require('assert');
const fc = require('fast-check');

const M = require('../js/exams/ed-matrix-logic.js');

const STATUS = M.STATUS;
const NON_GUARD = [STATUS.EXEMPT, STATUS.DUTY, STATUS.RESERVE];

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

// Distinct proctor keys (numeric ids -> 'p<id>'); uniqueness avoids key
// collisions across rows.
const proctorKeysArb = fc.uniqueArray(fc.integer({ min: 1, max: 99999 }), { minLength: 1, maxLength: 5 })
    .map(function (ids) { return ids.map(function (id) { return 'p' + id; }); });

// A flat pool of status picks indexed by (proctorIdx * cols + colIdx). Length
// 36 comfortably covers 5 proctors * 4 sessions (collapsed columns are fewer).
const statusSeedArb = fc.array(
    fc.constantFrom(STATUS.GUARD, STATUS.EXEMPT, STATUS.DUTY, STATUS.RESERVE),
    { minLength: 36, maxLength: 36 }
);

const entriesArb = fc.array(scheduleEntryArb, { minLength: 1, maxLength: 6 });

// ---------------------------------------------------------------------------
// Store construction helpers.
// ---------------------------------------------------------------------------

function firstSubject(col) {
    return (Array.isArray(col.subjects) && col.subjects.length) ? col.subjects[0] : '';
}

// Keep one column per distinct exempt scope. `getScheduleExemptKey` is
// DATE-LESS (`['session', day, period, session]`), so two sessions on different
// dates that share the same day/period/session share a single exempt bucket —
// setting one exempt resolves the other exempt too. Deduping by exemptKey makes
// every cell independent, which is what this property needs to assign per-cell
// statuses cleanly. (The shared-scope behavior itself is a store-model trait,
// not under test here.) sessionKey is a superset of exemptKey's components plus
// the date, so unique exemptKeys imply unique sessionKeys (distinct duty/reserve
// buckets) as well.
function distinctExemptColumns(columns) {
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < columns.length; i++) {
        var key = columns[i].exemptKey;
        if (!seen[key]) {
            seen[key] = true;
            out.push(columns[i]);
        }
    }
    return out;
}

// Write one (proctor, session) cell into the store for a non-guard status,
// mirroring the exact key shapes resolveCellStatus / reduceMatrixToStore use.
// guard cells are represented by ABSENCE (nothing written).
function writeCellStatus(store, col, proctorKey, status) {
    if (status === STATUS.EXEMPT) {
        if (!store.exemptionsData[col.exemptKey]) {
            store.exemptionsData[col.exemptKey] = {};
        }
        store.exemptionsData[col.exemptKey][proctorKey] = 'no';
    } else if (status === STATUS.DUTY || status === STATUS.RESERVE) {
        var map = status === STATUS.DUTY ? store.dutyData : store.reservesData;
        var bucket = col.sessionKey + '|' + firstSubject(col);
        if (!map[bucket]) {
            map[bucket] = {};
        }
        map[bucket][proctorKey] = true;
    }
    // guard -> no entry.
}

// Build a store from a per-cell status function statusFn(pIdx, cIdx) -> status.
function buildStore(columns, proctorKeys, statusFn) {
    var store = { exemptionsData: {}, dutyData: {}, reservesData: {} };
    for (var p = 0; p < proctorKeys.length; p++) {
        for (var c = 0; c < columns.length; c++) {
            writeCellStatus(store, columns[c], proctorKeys[p], statusFn(p, c));
        }
    }
    return store;
}

// ---------------------------------------------------------------------------
// Sanity cases.
// ---------------------------------------------------------------------------

function checkSanity() {
    // Vacuous: a null/empty result has no choices to violate -> true.
    assert.strictEqual(M.honorsUserChoices({}, null), true,
        'null assignmentResult must be vacuously honored');
    assert.strictEqual(M.honorsUserChoices({}, {}), true,
        'empty assignmentResult must be vacuously honored');

    var col = M.buildSessionColumns([{
        date_year: 2025, date_month: 6, date_day: 10,
        day: 'الأول', period: 'صباحا', session: 'الحصة الأولى',
        subject_name: 'الرياضيات', order: 1
    }])[0];

    // Guard cell (empty store) is guard-eligible; a guard assignment on it holds.
    var emptyStore = { exemptionsData: {}, dutyData: {}, reservesData: {} };
    assert.strictEqual(M.isGuardEligible(emptyStore, 'p1', col), true,
        'empty store -> guard-eligible');
    assert.strictEqual(
        M.honorsUserChoices(emptyStore, {
            sessions: [col], proctorKeys: ['p1'], storeAfter: emptyStore,
            guardAssignments: [{ proctorKey: 'p1', sessionColumn: col }]
        }),
        true, 'guard assignment on a guard cell must be honored');

    // Exempt cell is NOT guard-eligible; a guard assignment on it is a violation.
    var exemptStore = { exemptionsData: {}, dutyData: {}, reservesData: {} };
    writeCellStatus(exemptStore, col, 'p1', STATUS.EXEMPT);
    assert.strictEqual(M.isGuardEligible(exemptStore, 'p1', col), false,
        'exempt store -> not guard-eligible');
    assert.strictEqual(
        M.honorsUserChoices(exemptStore, {
            sessions: [col], proctorKeys: ['p1'], storeAfter: exemptStore,
            guardAssignments: [{ proctorKey: 'p1', sessionColumn: col }]
        }),
        false, 'guard assignment on an exempt cell must be rejected');
}

// ---------------------------------------------------------------------------
// POSITIVE: guard assignments target only guard cells -> honored.
// ---------------------------------------------------------------------------

function checkPositive(entries, proctorKeys, seed) {
    var columns = distinctExemptColumns(M.buildSessionColumns(entries));
    if (!columns.length) {
        return; // entries always yield >=1 column, but guard defensively.
    }

    var statusFn = function (p, c) {
        return seed[(p * columns.length + c) % seed.length];
    };
    var store = buildStore(columns, proctorKeys, statusFn);

    // Enumerate guard vs non-guard cells, asserting isGuardEligible both ways.
    var guardAssignments = [];
    for (var p = 0; p < proctorKeys.length; p++) {
        for (var c = 0; c < columns.length; c++) {
            var intended = statusFn(p, c);
            var eligible = M.isGuardEligible(store, proctorKeys[p], columns[c]);
            if (intended === STATUS.GUARD) {
                assert.strictEqual(eligible, true,
                    'a guard cell must be guard-eligible');
                guardAssignments.push({ proctorKey: proctorKeys[p], sessionColumn: columns[c] });
            } else {
                assert.strictEqual(eligible, false,
                    'a ' + intended + ' cell must NOT be guard-eligible');
            }
        }
    }

    var honored = M.honorsUserChoices(store, {
        sessions: columns,
        proctorKeys: proctorKeys,
        storeAfter: store, // unchanged by the run
        guardAssignments: guardAssignments
    });
    assert.strictEqual(honored, true,
        'a run that only guards guard-status cells must be honored');
}

// ---------------------------------------------------------------------------
// NEGATIVE: a guard assignment on a non-guard cell -> rejected.
// ---------------------------------------------------------------------------

function checkNegative(entries, proctorKeys, seed, forceP, forceC, forceStatusIdx) {
    var columns = distinctExemptColumns(M.buildSessionColumns(entries));
    if (!columns.length) {
        return;
    }
    var fp = forceP % proctorKeys.length;
    var fc2 = forceC % columns.length;
    var forcedStatus = NON_GUARD[forceStatusIdx % NON_GUARD.length];

    var statusFn = function (p, c) {
        if (p === fp && c === fc2) {
            return forcedStatus; // guarantee at least one non-guard cell.
        }
        return seed[(p * columns.length + c) % seed.length];
    };
    var store = buildStore(columns, proctorKeys, statusFn);

    var forcedKey = proctorKeys[fp];
    var forcedCol = columns[fc2];

    // The forced cell is genuinely non-guard.
    assert.strictEqual(M.isGuardEligible(store, forcedKey, forcedCol), false,
        'forced non-guard cell must not be guard-eligible');

    // A run that places a generated guard on the forced (non-guard) cell.
    // storeAfter === store so the status-preservation half passes and ONLY the
    // guard-targeting half is exercised.
    var honored = M.honorsUserChoices(store, {
        sessions: columns,
        proctorKeys: proctorKeys,
        storeAfter: store,
        guardAssignments: [{ proctorKey: forcedKey, sessionColumn: forcedCol }]
    });
    assert.strictEqual(honored, false,
        'a generated guard targeting a ' + forcedStatus + ' cell must be rejected');
}

// ---------------------------------------------------------------------------
// Runner.
// ---------------------------------------------------------------------------

console.log('[test] exemptions-duty-matrix-grid — Property 17: generated guard duties target only guard-status proctors');

try {
    checkSanity();

    // POSITIVE
    fc.assert(
        fc.property(entriesArb, proctorKeysArb, statusSeedArb,
            function (entries, proctorKeys, seed) {
                checkPositive(entries, proctorKeys, seed);
            }),
        { numRuns: 150 }
    );

    // NEGATIVE
    fc.assert(
        fc.property(entriesArb, proctorKeysArb, statusSeedArb,
            fc.nat(), fc.nat(), fc.nat(),
            function (entries, proctorKeys, seed, forceP, forceC, forceStatusIdx) {
                checkNegative(entries, proctorKeys, seed, forceP, forceC, forceStatusIdx);
            }),
        { numRuns: 150 }
    );

    console.log('PASS: Property 17 holds — generated guards only target guard-status proctor/sessions (sanity + 300 generated cases)');
    process.exit(0);
} catch (err) {
    console.error('FAIL: Property 17 violated');
    console.error(err && err.message ? err.message : err);
    process.exit(1);
}
