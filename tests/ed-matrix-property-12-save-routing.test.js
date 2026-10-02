'use strict';

// Feature: exemptions-duty-matrix-grid, Property 12: Save routes each non-guard status to its own store map
//
// Validates: Requirements 6.1
//
// Property 12 (design.md): For any matrix model, reducing it to the store
// (`reduceMatrixToStore`) places every exempt cell under examExemptionsData,
// every duty cell under examDutyTeachersData, and every reserve cell under
// examReservesData, each at the cell's session scope.
//
// This is a standalone Node test script (run-all.js discovers top-level
// tests/*.test.js). It exits non-zero on any failure.
//
//   node tests/ed-matrix-property-12-save-routing.test.js
//
// Strategy: build a real MatrixModel from generated schedule entries
// (sessions = buildSessionColumns(entries)) and generated proctor rows whose
// cells each hold a random STATUS value. Call reduceMatrixToStore(model), then
// assert BOTH directions:
//   - FORWARD: every exempt cell -> exemptionsData[col.exemptKey][pk]==='no'
//     and that proctor/session is absent from duty & reserve; every duty cell
//     -> dutyData[col.sessionKey+'|'+subject][pk]===true for each subject
//     (subjectless: col.sessionKey+'|') and absent from exempt & reserve;
//     reserve symmetrically; guard cells produce nothing.
//   - CONVERSE: every entry present in a map corresponds to a cell of exactly
//     that status (computed as an independent expected set comparison).
//
// To keep the FORWARD cross-map exclusivity checks unambiguous we generate the
// schedule so each distinct session has a UNIQUE exemptKey: the exempt scope
// key is `session|day|period|session` (no date), so we tie `day` to the date.
// This way an exempt entry written for one session can never alias another
// session's exempt scope. Proctor keys are assigned uniquely per row.

const assert = require('assert');
const fc = require('fast-check');

const M = require('../js/exams/ed-matrix-logic.js');

const STATUS = M.STATUS;
const STATUS_VALUES = [STATUS.GUARD, STATUS.EXEMPT, STATUS.DUTY, STATUS.RESERVE];

const PERIODS = ['صباحا', 'زوالا'];
const SESSIONS = ['الحصة الأولى', 'الحصة الثانية', 'الحصة الثالثة'];
// '' is included so subject-less sessions (which route to the `sessionKey|`
// bucket) are exercised alongside multi-subject sessions.
const SUBJECTS = ['الرياضيات', 'العربية', 'الفيزياء', ''];

// ---------------------------------------------------------------------------
// Generators.
// ---------------------------------------------------------------------------

// `day` is derived from the date so every distinct date carries a distinct
// `day` token; combined with (period, session) this makes the exempt scope key
// `session|day|period|session` unique per distinct Session_Column.
const scheduleEntryArb = fc.record({
    date_year: fc.constant(2025),
    date_month: fc.constant(6),
    date_day: fc.integer({ min: 1, max: 6 }),
    period: fc.constantFrom.apply(fc, PERIODS),
    session: fc.constantFrom.apply(fc, SESSIONS),
    subject_name: fc.constantFrom.apply(fc, SUBJECTS),
    order: fc.integer({ min: 1, max: 50 })
}).map(function (e) {
    return Object.assign({}, e, { day: 'd' + e.date_day });
});

const scheduleEntriesArb = fc.array(scheduleEntryArb, { minLength: 0, maxLength: 20 });

// From a generated schedule, build the (deterministic) session columns and
// then generate one random status per (row, session) cell.
const modelSpecArb = scheduleEntriesArb.chain(function (entries) {
    var sessions = M.buildSessionColumns(entries);
    var S = sessions.length;
    var rowArb = fc.array(fc.constantFrom.apply(fc, STATUS_VALUES), { minLength: S, maxLength: S });
    return fc.record({
        sessions: fc.constant(sessions),
        rowStatuses: fc.array(rowArb, { minLength: 0, maxLength: 6 })
    });
});

// ---------------------------------------------------------------------------
// Helpers (independent of the implementation under test).
// ---------------------------------------------------------------------------

// The dated duty/reserve bucket keys for a session column, exactly as the save
// path forms them: `sessionKey|subject` per subject, subject-less -> trailing
// empty subject.
function dutyReserveBucketKeys(col) {
    var subjects = Array.isArray(col.subjects) ? col.subjects : [];
    var list = subjects.length ? subjects : [''];
    return list.map(function (s) {
        return col.sessionKey + '|' + (s || '');
    });
}

function bucketHas(map, key, pk) {
    return !!(map && map[key] && map[key][pk] === true);
}

function anyBucketHas(map, keys, pk) {
    return keys.some(function (k) {
        return bucketHas(map, k, pk);
    });
}

function exemptHas(store, col, pk) {
    var b = store.exemptionsData && store.exemptionsData[col.exemptKey];
    return !!(b && b[pk] === 'no');
}

function sortedKeys(set) {
    return Array.from(set).sort();
}

const SEP = '\u0000';

// ---------------------------------------------------------------------------
// The property.
// ---------------------------------------------------------------------------

function checkProperty12(spec) {
    var sessions = spec.sessions;
    // Assign unique proctor keys per row and build cells as Map<sessionKey,status>.
    var rows = spec.rowStatuses.map(function (cellStatuses, i) {
        var cells = new Map();
        for (var j = 0; j < sessions.length; j++) {
            cells.set(sessions[j].sessionKey, cellStatuses[j]);
        }
        return { proctorKey: 'pk_' + i, cells: cells, _statuses: cellStatuses };
    });

    var model = { sessions: sessions, rows: rows, totalSessions: sessions.length };

    var store = M.reduceMatrixToStore(model);

    // The three maps must always exist.
    assert.ok(store && store.exemptionsData && store.dutyData && store.reservesData,
        'reduceMatrixToStore must return the three store maps');

    // Build the INDEPENDENT expected entry sets from the model, and the ACTUAL
    // entry sets read back out of the produced store. Equality of these sets
    // proves both routing directions at once.
    var expectedExempt = new Set();
    var expectedDuty = new Set();
    var expectedReserve = new Set();

    for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        var pk = row.proctorKey;
        for (var s = 0; s < sessions.length; s++) {
            var col = sessions[s];
            var status = row._statuses[s];
            var dutyKeys = dutyReserveBucketKeys(col);

            if (status === STATUS.EXEMPT) {
                expectedExempt.add(col.exemptKey + SEP + pk);
                // FORWARD: exempt cell routed to exemptionsData, NOT to duty/reserve.
                assert.ok(exemptHas(store, col, pk),
                    'exempt cell must be written to exemptionsData[' + col.exemptKey + '][' + pk + ']');
                assert.ok(!anyBucketHas(store.dutyData, dutyKeys, pk),
                    'exempt cell must NOT appear in dutyData for ' + pk + ' @ ' + col.sessionKey);
                assert.ok(!anyBucketHas(store.reservesData, dutyKeys, pk),
                    'exempt cell must NOT appear in reservesData for ' + pk + ' @ ' + col.sessionKey);
            } else if (status === STATUS.DUTY) {
                dutyKeys.forEach(function (k) {
                    expectedDuty.add(k + SEP + pk);
                });
                // FORWARD: duty cell routed to EVERY subject bucket, NOT to exempt/reserve.
                dutyKeys.forEach(function (k) {
                    assert.ok(bucketHas(store.dutyData, k, pk),
                        'duty cell must be written to dutyData[' + k + '][' + pk + ']');
                });
                assert.ok(!exemptHas(store, col, pk),
                    'duty cell must NOT appear in exemptionsData for ' + pk + ' @ ' + col.exemptKey);
                assert.ok(!anyBucketHas(store.reservesData, dutyKeys, pk),
                    'duty cell must NOT appear in reservesData for ' + pk + ' @ ' + col.sessionKey);
            } else if (status === STATUS.RESERVE) {
                dutyKeys.forEach(function (k) {
                    expectedReserve.add(k + SEP + pk);
                });
                // FORWARD: reserve cell routed to EVERY subject bucket, NOT to exempt/duty.
                dutyKeys.forEach(function (k) {
                    assert.ok(bucketHas(store.reservesData, k, pk),
                        'reserve cell must be written to reservesData[' + k + '][' + pk + ']');
                });
                assert.ok(!exemptHas(store, col, pk),
                    'reserve cell must NOT appear in exemptionsData for ' + pk + ' @ ' + col.exemptKey);
                assert.ok(!anyBucketHas(store.dutyData, dutyKeys, pk),
                    'reserve cell must NOT appear in dutyData for ' + pk + ' @ ' + col.sessionKey);
            } else {
                // GUARD: produces nothing anywhere for this proctor/session.
                assert.ok(!exemptHas(store, col, pk),
                    'guard cell must NOT appear in exemptionsData for ' + pk);
                assert.ok(!anyBucketHas(store.dutyData, dutyKeys, pk),
                    'guard cell must NOT appear in dutyData for ' + pk);
                assert.ok(!anyBucketHas(store.reservesData, dutyKeys, pk),
                    'guard cell must NOT appear in reservesData for ' + pk);
            }
        }
    }

    // ACTUAL sets read out of the produced store.
    var actualExempt = new Set();
    Object.keys(store.exemptionsData).forEach(function (exemptKey) {
        var bucket = store.exemptionsData[exemptKey];
        Object.keys(bucket).forEach(function (pk) {
            assert.strictEqual(bucket[pk], 'no',
                'exemptionsData entries must use the value "no" (got ' + bucket[pk] + ')');
            actualExempt.add(exemptKey + SEP + pk);
        });
    });

    var actualDuty = new Set();
    Object.keys(store.dutyData).forEach(function (bucketKey) {
        var bucket = store.dutyData[bucketKey];
        Object.keys(bucket).forEach(function (pk) {
            assert.strictEqual(bucket[pk], true,
                'dutyData entries must be boolean true');
            actualDuty.add(bucketKey + SEP + pk);
        });
    });

    var actualReserve = new Set();
    Object.keys(store.reservesData).forEach(function (bucketKey) {
        var bucket = store.reservesData[bucketKey];
        Object.keys(bucket).forEach(function (pk) {
            assert.strictEqual(bucket[pk], true,
                'reservesData entries must be boolean true');
            actualReserve.add(bucketKey + SEP + pk);
        });
    });

    // CONVERSE + completeness: each map contains exactly the entries its own
    // status produced — no missing entries, no stray entries, no leakage
    // between maps.
    assert.deepStrictEqual(sortedKeys(actualExempt), sortedKeys(expectedExempt),
        'exemptionsData must contain exactly the exempt cells');
    assert.deepStrictEqual(sortedKeys(actualDuty), sortedKeys(expectedDuty),
        'dutyData must contain exactly the duty cells');
    assert.deepStrictEqual(sortedKeys(actualReserve), sortedKeys(expectedReserve),
        'reservesData must contain exactly the reserve cells');
}

// ---------------------------------------------------------------------------
// Runner.
// ---------------------------------------------------------------------------

console.log('[test] exemptions-duty-matrix-grid — Property 12: Save routes each non-guard status to its own store map');

try {
    fc.assert(
        fc.property(modelSpecArb, function (spec) {
            checkProperty12(spec);
        }),
        { numRuns: 150 }
    );
    console.log('PASS: Property 12 holds across 150 generated matrix models');
    process.exit(0);
} catch (err) {
    console.error('FAIL: Property 12 violated');
    console.error(err && err.message ? err.message : err);
    process.exit(1);
}
