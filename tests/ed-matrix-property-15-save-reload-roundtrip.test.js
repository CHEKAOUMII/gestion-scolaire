'use strict';

// Feature: exemptions-duty-matrix-grid, Property 15: Save then reload is an identity round-trip
//
// For any matrix model, reducing it to the store (reduceMatrixToStore) and then
// rebuilding the matrix rows from that store (re-resolving every cell with
// resolveCellStatus, which is exactly what buildProctorRows/buildMatrixModel do
// for cell status) yields, for every proctor/session, the same Proctor_Status.
//
// Round-trip semantics: guard cells (and any unrecognized value) are NOT
// persisted and therefore reload as guard. So the EXPECTED reloaded status for a
// cell is: the cell's status if it is exempt/duty/reserve, else guard. The
// round-trip preserves exempt/duty/reserve exactly and maps guard -> guard, with
// no conversion between status values.
//
// Validates: Requirement 6.4

const assert = require('assert');
const fc = require('fast-check');
const M = require('../js/exams/ed-matrix-logic.js');

const PERIODS = ['صباحا', 'زوالا'];
const SESSIONS = ['الحصة الأولى', 'الحصة الثانية', 'الحصة الثالثة'];
const SUBJECTS = ['الرياضيات', 'الفيزياء', 'العربية', ''];
const STATUSES = [M.STATUS.GUARD, M.STATUS.EXEMPT, M.STATUS.DUTY, M.STATUS.RESERVE];

// The expected reloaded status: exempt/duty/reserve survive the round-trip
// exactly; everything else (guard) reloads as guard with no conversion.
function expectedReloaded(status) {
    if (status === M.STATUS.EXEMPT || status === M.STATUS.DUTY || status === M.STATUS.RESERVE) {
        return status;
    }
    return M.STATUS.GUARD;
}

// A single raw schedule entry. `day` is tied to the FULL date so that distinct
// dates always yield distinct exemptKeys (exemptKey omits the date but includes
// `day`). Within a single date, distinct columns differ by period/session, so
// every Session_Column ends up with a unique exemptKey — keeping the exempt
// round-trip unambiguous (the exempt bucket has no date of its own).
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
        day: 'd_' + e.yyyy + '_' + e.mm + '_' + e.dd, // ties day to the full date
        period: e.period,
        session: e.session,
        subject_name: e.subject,
        order: 0
    };
});

const scheduleArb = fc.array(entryArb, { minLength: 1, maxLength: 12 });

// Build a full MatrixModel: sessions from the schedule, rows with unique
// proctorKeys and a Map<sessionKey, random STATUS> of cells.
const matrixModelArb = scheduleArb.chain(function (schedule) {
    const sessions = M.buildSessionColumns(schedule);
    const n = sessions.length; // >= 1 because schedule has >= 1 entry
    const rowStatusesArb = fc.array(fc.constantFrom.apply(fc, STATUSES), {
        minLength: n,
        maxLength: n
    });
    return fc.array(rowStatusesArb, { minLength: 1, maxLength: 8 }).map(function (rowsStatuses) {
        const rows = rowsStatuses.map(function (statuses, ri) {
            const cells = new Map();
            sessions.forEach(function (col, ci) {
                cells.set(col.sessionKey, statuses[ci]);
            });
            return { proctorKey: 'P' + ri, cells: cells };
        });
        return { sessions: sessions, rows: rows };
    });
});

function run() {
    fc.assert(
        fc.property(matrixModelArb, function (model) {
            // Save: reduce the matrix model to the three store maps.
            const reducedStore = M.reduceMatrixToStore(model);

            // Reload: re-resolve every proctor/session cell from the store. This
            // is exactly the cell-status step performed when rebuilding rows.
            for (let r = 0; r < model.rows.length; r++) {
                const row = model.rows[r];
                for (let s = 0; s < model.sessions.length; s++) {
                    const col = model.sessions[s];
                    const original = row.cells.get(col.sessionKey);
                    const expected = expectedReloaded(original);
                    const reloaded = M.resolveCellStatus(reducedStore, row.proctorKey, col);
                    assert.strictEqual(
                        reloaded,
                        expected,
                        'round-trip mismatch for ' + row.proctorKey + ' @ ' + col.sessionKey +
                        ': original=' + original + ' expected=' + expected + ' got=' + reloaded
                    );
                }
            }
        }),
        { numRuns: 200 }
    );
}

run();
console.log('PASS: Property 15 — save then reload is an identity round-trip (200 cases)');
