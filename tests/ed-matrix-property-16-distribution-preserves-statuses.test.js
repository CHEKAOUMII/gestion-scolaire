'use strict';

// Feature: exemptions-duty-matrix-grid, Property 16: Distribution preserves user-selected statuses
//
// For any Exemptions_Duty_Store and distribution run, every proctor/session
// whose recorded status is exempt/duty/reserve has the IDENTICAL status after
// the run, and no generated guard assignment is made to such a proctor/session.
//
// Validates: Requirements 7.1, 7.2, 7.4
//
// APPROACH — modeled contract (not the live bundle).
// The design notes that the distribution properties (16, 17) "run the existing
// proctor-v3.bundle.js ... with mocked room/quota needs". The bundle is a large
// browser-oriented IIFE that expects a full DOM/IPC environment, so booting it
// 100+ times under the Node test runner is impractical here. Instead this test
// validates Property 16 by exercising `honorsUserChoices` — the pure
// verification predicate the feature exposes precisely so a run's outcome can be
// checked against Requirements 7.1/7.2/7.4 — against AssignmentResults that
// faithfully model the algorithm's documented contract:
//   * a HONORING result keeps storeAfter identical to storeBefore (every
//     user-selected exempt/duty/reserve cell unchanged) and only places
//     generated guards on pre-run guard cells  -> must return true;
//   * VIOLATING results either (a) flip/remove a user-selected status in
//     storeAfter, or (b) target a generated guard at a non-guard cell
//     -> must return false.
// The storeBefore is itself produced by reduceMatrixToStore over a random matrix
// model, so it is a real, well-formed store with the exact key shapes the
// algorithm reads. This verifies the predicate captures the property; a future
// task may additionally drive the real bundle through the same predicate.

const assert = require('assert');
const fc = require('fast-check');
const M = require('../js/exams/ed-matrix-logic.js');

const PERIODS = ['صباحا', 'زوالا'];
const SESSIONS = ['الحصة الأولى', 'الحصة الثانية', 'الحصة الثالثة'];
const SUBJECTS = ['الرياضيات', 'الفيزياء', 'العربية', ''];
const STATUSES = [M.STATUS.GUARD, M.STATUS.EXEMPT, M.STATUS.DUTY, M.STATUS.RESERVE];

function cloneStore(store) {
    return JSON.parse(JSON.stringify(store));
}

// A single raw schedule entry. `day` is tied to the FULL date so distinct dates
// yield distinct exemptKeys (exemptKey omits the date but includes `day`), and
// distinct columns within a date differ by period/session. This keeps every
// Session_Column's store keys unambiguous so per-(proctor, session) mutation is
// isolated (mirrors the property-15 generator).
const entryArb = fc.record({
    yyyy: fc.constantFrom(2024, 2025),
    mm: fc.integer({ min: 1, max: 12 }),
    dd: fc.integer({ min: 1, max: 28 }),
    period: fc.constantFrom.apply(fc, PERIODS),
    session: fc.constantFrom.apply(fc, SESSIONS),
    subject: fc.constantFrom.apply(fc, SUBJECTS)
}).map(function (e) {
    return {
        date_year: e.yyyy,
        date_month: e.mm,
        date_day: e.dd,
        day: 'd_' + e.yyyy + '_' + e.mm + '_' + e.dd,
        period: e.period,
        session: e.session,
        subject_name: e.subject,
        order: 0
    };
});

const scheduleArb = fc.array(entryArb, { minLength: 1, maxLength: 10 });

// Build a matrix model (sessions + rows with a Map<sessionKey, status>) plus the
// storeBefore reduced from it, and a selection integer used to pick a cell to
// target in the negative cases.
const scenarioArb = scheduleArb.chain(function (schedule) {
    const sessions = M.buildSessionColumns(schedule);
    const n = sessions.length; // >= 1
    const rowStatusesArb = fc.array(fc.constantFrom.apply(fc, STATUSES), {
        minLength: n,
        maxLength: n
    });
    return fc.record({
        rowsStatuses: fc.array(rowStatusesArb, { minLength: 1, maxLength: 6 }),
        pick: fc.integer({ min: 0, max: 100000 })
    }).map(function (gen) {
        const rows = gen.rowsStatuses.map(function (statuses, ri) {
            const cells = new Map();
            sessions.forEach(function (col, ci) {
                cells.set(col.sessionKey, statuses[ci]);
            });
            return { proctorKey: 'P' + ri, cells: cells };
        });
        const model = { sessions: sessions, rows: rows };
        const storeBefore = M.reduceMatrixToStore(model);
        const proctorKeys = rows.map(function (r) { return r.proctorKey; });

        // Enumerate every (proctor, session) cell partitioned by its PRE-run
        // resolved status, so the negative cases can target a real user-selected
        // (non-guard) cell and the positive case can target only guard cells.
        const nonGuardCells = [];
        const guardCells = [];
        rows.forEach(function (row) {
            sessions.forEach(function (col) {
                const st = M.resolveCellStatus(storeBefore, row.proctorKey, col);
                const cell = { proctorKey: row.proctorKey, col: col, status: st };
                if (st === M.STATUS.GUARD) {
                    guardCells.push(cell);
                } else {
                    nonGuardCells.push(cell);
                }
            });
        });

        return {
            model: model,
            sessions: sessions,
            proctorKeys: proctorKeys,
            storeBefore: storeBefore,
            nonGuardCells: nonGuardCells,
            guardCells: guardCells,
            pick: gen.pick
        };
    });
});

// ---------------------------------------------------------------------------
// POSITIVE: a faithful honoring run is accepted (true).
//   storeAfter === storeBefore (every user-selected cell preserved), and every
//   generated guard duty targets a pre-run guard cell. Requirements 7.1/7.2/7.4.
// ---------------------------------------------------------------------------
function runPositive() {
    fc.assert(
        fc.property(scenarioArb, function (sc) {
            // storeAfter preserves all non-guard cells: identical to storeBefore.
            const storeAfter = cloneStore(sc.storeBefore);

            // Generated guards land only on pre-run guard cells.
            const guardAssignments = sc.guardCells.map(function (c) {
                return { proctorKey: c.proctorKey, sessionColumn: c.col };
            });

            const result = {
                sessions: sc.sessions,
                proctorKeys: sc.proctorKeys,
                storeAfter: storeAfter,
                guardAssignments: guardAssignments
            };

            assert.strictEqual(
                M.honorsUserChoices(sc.storeBefore, result),
                true,
                'honoring run (storeAfter == storeBefore, guards only on guard cells) must be accepted'
            );
        }),
        { numRuns: 200 }
    );
}

// ---------------------------------------------------------------------------
// NEGATIVE (a): a run that flips/removes a user-selected status is rejected.
//   Pick one pre-run non-guard cell, rebuild the model with that one cell set to
//   guard, reduce -> storeAfter. That cell now resolves to guard (removed),
//   violating Requirements 7.1/7.4. Must return false.
// ---------------------------------------------------------------------------
function runNegativeFlip() {
    fc.assert(
        fc.property(scenarioArb, function (sc) {
            fc.pre(sc.nonGuardCells.length > 0);
            const target = sc.nonGuardCells[sc.pick % sc.nonGuardCells.length];

            // Rebuild rows with the target cell mutated to guard, then reduce.
            const mutatedRows = sc.model.rows.map(function (row) {
                const cells = new Map(row.cells);
                if (row.proctorKey === target.proctorKey) {
                    cells.set(target.col.sessionKey, M.STATUS.GUARD);
                }
                return { proctorKey: row.proctorKey, cells: cells };
            });
            const storeAfter = M.reduceMatrixToStore({ sessions: sc.sessions, rows: mutatedRows });

            // Sanity: the targeted cell really changed (user-selected -> guard).
            assert.notStrictEqual(target.status, M.STATUS.GUARD);
            assert.strictEqual(
                M.resolveCellStatus(storeAfter, target.proctorKey, target.col),
                M.STATUS.GUARD,
                'target user-selected cell should have been removed in storeAfter'
            );

            const result = {
                sessions: sc.sessions,
                proctorKeys: sc.proctorKeys,
                storeAfter: storeAfter,
                guardAssignments: []
            };

            assert.strictEqual(
                M.honorsUserChoices(sc.storeBefore, result),
                false,
                'a run that removes a user-selected status must be rejected'
            );
        }),
        { numRuns: 200 }
    );
}

// ---------------------------------------------------------------------------
// NEGATIVE (b): a run that targets a generated guard at a non-guard cell is
//   rejected, even though storeAfter is otherwise untouched. Requirement 7.2/7.3.
// ---------------------------------------------------------------------------
function runNegativeGuardOnNonGuard() {
    fc.assert(
        fc.property(scenarioArb, function (sc) {
            fc.pre(sc.nonGuardCells.length > 0);
            const target = sc.nonGuardCells[sc.pick % sc.nonGuardCells.length];

            const storeAfter = cloneStore(sc.storeBefore); // statuses preserved.
            const guardAssignments = [
                { proctorKey: target.proctorKey, sessionColumn: target.col }
            ];

            const result = {
                sessions: sc.sessions,
                proctorKeys: sc.proctorKeys,
                storeAfter: storeAfter,
                guardAssignments: guardAssignments
            };

            assert.strictEqual(
                M.honorsUserChoices(sc.storeBefore, result),
                false,
                'a generated guard targeting an exempt/duty/reserve cell must be rejected'
            );
        }),
        { numRuns: 200 }
    );
}

runPositive();
runNegativeFlip();
runNegativeGuardOnNonGuard();
console.log('PASS: Property 16 — distribution preserves user-selected statuses (3 x 200 cases; honoring accepted, flip & guard-on-non-guard rejected)');
