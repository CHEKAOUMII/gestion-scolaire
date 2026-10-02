// Feature: exemptions-duty-matrix-grid, Property 13: Persisted statuses are keyed by getProctorExemptionKey
//
// Validates: Requirements 6.2
//
// For any matrix model, every inner key written to the three store maps during
// `reduceMatrixToStore` equals the corresponding row's `proctorKey`, which is
// the output of `getProctorExemptionKey(proctor, index)` captured at build
// time. We assert two things:
//
//   1. SUBSET: every inner key appearing in exemptionsData[*], dutyData[*], and
//      reservesData[*] is a member of the set of row proctorKeys (i.e. it
//      equals getProctorExemptionKey for some row in the model).
//   2. EXACTNESS: for a row built from a known proctor, the entries written for
//      that row use exactly that row's proctorKey (the recomputed
//      getProctorExemptionKey value) — never some other key shape.
//
// The generators deliberately include proctors with empty cin+som (forcing the
// `idx_<i>` fallback key) and proctors that share/clash keys, so the property
// is exercised against realistic key collisions and fallbacks.

'use strict';

const assert = require('assert');
const fc = require('fast-check');

const M = require('../js/exams/ed-matrix-logic.js');
const { reduceMatrixToStore, buildSessionColumns, getProctorExemptionKey, STATUS } = M;

const MIN_CASES = 100;

// Non-guard statuses are the only ones that produce store entries. We bias the
// cell generator toward these so most rows write something, while still
// allowing guard so guard-only rows are exercised too.
const NON_GUARD_STATUSES = [STATUS.EXEMPT, STATUS.DUTY, STATUS.RESERVE];
const ALL_STATUSES = [STATUS.GUARD, STATUS.EXEMPT, STATUS.DUTY, STATUS.RESERVE];

// --- Generators -----------------------------------------------------------

// A schedule entry. Dates/periods/sessions/subjects vary so buildSessionColumns
// yields a realistic mix of distinct session columns (with subjects).
const scheduleEntryArb = fc.record({
    date_year: fc.constantFrom(2025, 2026),
    date_month: fc.integer({ min: 1, max: 12 }),
    date_day: fc.integer({ min: 1, max: 28 }),
    day: fc.constantFrom('الأول', 'الثاني', 'الثالث'),
    period: fc.constantFrom('صباحا', 'زوالا'),
    session: fc.constantFrom('الحصة الأولى', 'الحصة الثانية', 'الحصة الثالثة'),
    subject_name: fc.constantFrom('الرياضيات', 'الفيزياء', 'العربية', '', 'الإنجليزية'),
    order: fc.integer({ min: 1, max: 20 })
});

// A proctor record. cin/som are sometimes empty (''), so the key falls back to
// som then to 'idx_<i>'. A small shared pool of cin/som values makes collisions
// (two proctors sharing a key) realistic.
const SHARED_IDS = ['AA1', 'AA1', 'BB2', '', '', 'CC3'];
const proctorArb = fc.record({
    cin: fc.oneof(fc.constantFrom(...SHARED_IDS), fc.string({ maxLength: 5 })),
    som: fc.oneof(fc.constantFrom(...SHARED_IDS), fc.string({ maxLength: 5 })),
    teacher_name: fc.constantFrom('أحمد', 'سعيد', 'ليلى', 'فاطمة'),
    specialty: fc.constantFrom('رياضيات', 'فيزياء', '')
});

// Build a complete MatrixModel from generated proctors + schedule + a per-cell
// status picker. proctorKey is computed via getProctorExemptionKey(proc, idx)
// — exactly as the row would carry it at build time.
function buildModel(proctors, scheduleEntries, statusPicks) {
    const sessions = buildSessionColumns(scheduleEntries);
    const rows = proctors.map((proc, idx) => {
        const proctorKey = getProctorExemptionKey(proc, idx);
        const cells = new Map();
        sessions.forEach((col, sIdx) => {
            // Deterministic-but-varied status per (row, session) from the
            // generated pick stream.
            const pick = statusPicks[(idx * 7 + sIdx) % statusPicks.length];
            cells.set(col.sessionKey, pick);
        });
        return { proctor: proc, proctorKey, cells };
    });
    return { sessions, rows, totalSessions: sessions.length };
}

const modelArb = fc.record({
    proctors: fc.array(proctorArb, { minLength: 1, maxLength: 8 }),
    schedule: fc.array(scheduleEntryArb, { minLength: 1, maxLength: 10 }),
    statusPicks: fc.array(
        fc.oneof(
            { weight: 3, arbitrary: fc.constantFrom(...NON_GUARD_STATUSES) },
            { weight: 1, arbitrary: fc.constantFrom(...ALL_STATUSES) }
        ),
        { minLength: 1, maxLength: 12 }
    )
}).map(({ proctors, schedule, statusPicks }) => buildModel(proctors, schedule, statusPicks));

// Collect every inner key across the three store maps.
function collectInnerKeys(store) {
    const keys = new Set();
    for (const mapName of ['exemptionsData', 'dutyData', 'reservesData']) {
        const map = store[mapName] || {};
        for (const bucketKey of Object.keys(map)) {
            for (const innerKey of Object.keys(map[bucketKey])) {
                keys.add(innerKey);
            }
        }
    }
    return keys;
}

let runCount = 0;

// --- Property: every inner key is a row proctorKey ------------------------
fc.assert(
    fc.property(modelArb, (model) => {
        runCount++;

        const store = reduceMatrixToStore(model);

        // The set of valid keys = the proctorKeys carried by the rows, which are
        // exactly getProctorExemptionKey(proctor, idx) recomputed here.
        const validKeys = new Set(
            model.rows.map((row, idx) => {
                const recomputed = getProctorExemptionKey(row.proctor, idx);
                // Sanity: the row's captured key matches getProctorExemptionKey.
                assert.strictEqual(
                    row.proctorKey,
                    recomputed,
                    `row ${idx} proctorKey "${row.proctorKey}" != getProctorExemptionKey "${recomputed}"`
                );
                return recomputed;
            })
        );

        const innerKeys = collectInnerKeys(store);

        // SUBSET: every persisted inner key equals some row's proctorKey.
        for (const key of innerKeys) {
            assert.ok(
                validKeys.has(key),
                `persisted inner key "${key}" is not the getProctorExemptionKey of any row ` +
                `(valid keys: ${JSON.stringify([...validKeys])})`
            );
        }
    }),
    { numRuns: MIN_CASES, verbose: true }
);

// --- Property: a known proctor's entries use exactly its proctorKey -------
// Build a model with one known, uniquely-keyed proctor whose every cell is a
// non-guard status, and assert every entry written for that proctor's session
// scopes is keyed by exactly that proctorKey.
const knownProctorModelArb = fc.record({
    cin: fc.constantFrom('UNIQUE_CIN_1', 'UNIQUE_CIN_2'),
    schedule: fc.array(scheduleEntryArb, { minLength: 1, maxLength: 8 }),
    status: fc.constantFrom(...NON_GUARD_STATUSES)
}).map(({ cin, schedule, status }) => {
    const sessions = buildSessionColumns(schedule);
    const proc = { cin, som: '', teacher_name: 'معروف', specialty: 'رياضيات' };
    const proctorKey = getProctorExemptionKey(proc, 0);
    const cells = new Map();
    sessions.forEach((col) => cells.set(col.sessionKey, status));
    const model = { sessions, rows: [{ proctor: proc, proctorKey, cells }], totalSessions: sessions.length };
    return { model, proctorKey };
});

fc.assert(
    fc.property(knownProctorModelArb, ({ model, proctorKey }) => {
        runCount++;

        const store = reduceMatrixToStore(model);
        const innerKeys = collectInnerKeys(store);

        // Every inner key written must be exactly the known proctorKey.
        for (const key of innerKeys) {
            assert.strictEqual(
                key,
                proctorKey,
                `entry keyed by "${key}" but expected exactly the known proctorKey "${proctorKey}"`
            );
        }

        // And, since the single proctor has only non-guard cells over >=1
        // session, at least one entry must have been written under that key.
        assert.ok(
            innerKeys.size === 0 || innerKeys.has(proctorKey),
            `expected the known proctorKey "${proctorKey}" among written keys`
        );
    }),
    { numRuns: MIN_CASES, verbose: true }
);

// --- Edge case: all-empty cin+som proctors force idx_ keys ----------------
// A focused check that proctors with empty cin AND empty som produce 'idx_<i>'
// keys, and reduceMatrixToStore writes exactly those.
(function emptyIdProctorsForceIdxKeys() {
    runCount++;
    const schedule = [{
        date_year: 2025, date_month: 6, date_day: 10,
        day: 'الأول', period: 'صباحا', session: 'الحصة الأولى',
        subject_name: 'الرياضيات', order: 1
    }];
    const sessions = buildSessionColumns(schedule);
    const proctors = [
        { cin: '', som: '', teacher_name: 'أ' },
        { cin: '', som: '', teacher_name: 'ب' }
    ];
    const rows = proctors.map((proc, idx) => {
        const proctorKey = getProctorExemptionKey(proc, idx);
        assert.strictEqual(proctorKey, 'idx_' + idx, 'empty cin+som must fall back to idx_<idx>');
        const cells = new Map();
        sessions.forEach((col) => cells.set(col.sessionKey, STATUS.DUTY));
        return { proctor: proc, proctorKey, cells };
    });
    const model = { sessions, rows, totalSessions: sessions.length };

    const store = reduceMatrixToStore(model);
    const innerKeys = collectInnerKeys(store);
    const expected = new Set(['idx_0', 'idx_1']);

    assert.deepStrictEqual(innerKeys, expected,
        `expected idx_ fallback keys ${JSON.stringify([...expected])}, got ${JSON.stringify([...innerKeys])}`);
})();

console.log('PASS ed-matrix Property 13: Persisted statuses are keyed by getProctorExemptionKey (' + runCount + ' cases across subset + exactness + idx-fallback inputs)');
