'use strict';

const { requireCycle } = require('./student-cycle');
const { captureInputUpserts, captureDeletesFromRows, notifyCaptureCommitted } = require('./capture-port');

function getByCycle(db, schoolYear, cycleCode) {
    const normalizedCycleCode = requireCycle(cycleCode);
    return db
        .prepare('SELECT school_year, cycle_code, data_json, updated_at FROM timetable_data WHERE school_year = ? AND cycle_code = ?')
        .get(schoolYear, normalizedCycleCode) || null;
}

function getAllBySchoolYear(db, schoolYear, cycleCodes) {
    const normalizedCycleCodes = [...new Set((cycleCodes || []).map(requireCycle))];
    if (!normalizedCycleCodes.length) return [];
    const placeholders = normalizedCycleCodes.map(() => '?').join(', ');
    return db
        .prepare(
            `SELECT school_year, cycle_code, data_json, updated_at
             FROM timetable_data
             WHERE school_year = ? AND cycle_code IN (${placeholders})
             ORDER BY cycle_code`
        )
        .all(schoolYear, ...normalizedCycleCodes);
}

function upsertByCycle(db, schoolYear, cycleCode, dataJson, options = {}) {
    const normalizedCycleCode = requireCycle(cycleCode);
    const run = db.transaction(() => {
        const result = db
            .prepare(
                `INSERT INTO timetable_data (school_year, cycle_code, data_json, updated_at)
                  VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                  ON CONFLICT(school_year, cycle_code) DO UPDATE SET
                      data_json = excluded.data_json,
                      updated_at = CURRENT_TIMESTAMP`
            )
            .run(schoolYear, normalizedCycleCode, dataJson);
        captureInputUpserts(db, {
            tableName: 'timetable_data',
            keyFields: ['school_year', 'cycle_code'],
            items: [{ school_year: schoolYear, cycle_code: normalizedCycleCode }],
            operation: 'PUT'
        });
        if (typeof options.audit === 'function') options.audit({ success: true, count: 1 });
        return result;
    });
    const result = run();
    notifyCaptureCommitted();
    return result;
}

function deleteByCycle(db, schoolYear, cycleCode) {
    const normalizedCycleCode = requireCycle(cycleCode);
    const run = db.transaction(() => {
        const row = db.prepare('SELECT * FROM timetable_data WHERE school_year = ? AND cycle_code = ?').get(schoolYear, normalizedCycleCode);
        if (row) captureDeletesFromRows(db, 'timetable_data', [row]);
        return db.prepare('DELETE FROM timetable_data WHERE school_year = ? AND cycle_code = ?').run(schoolYear, normalizedCycleCode);
    });
    const result = run();
    if (result.changes) notifyCaptureCommitted();
    return result;
}

module.exports = { getByCycle, getAllBySchoolYear, upsertByCycle, deleteByCycle };
