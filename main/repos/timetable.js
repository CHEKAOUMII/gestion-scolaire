'use strict';

function requireCycleCode(cycleCode) {
    const normalizedCycleCode = String(cycleCode || '').trim();
    if (!normalizedCycleCode) throw new Error('cycle_code is required');
    return normalizedCycleCode;
}

function getByCycle(db, schoolYear, cycleCode) {
    const normalizedCycleCode = requireCycleCode(cycleCode);
    return db
        .prepare('SELECT school_year, cycle_code, data_json, updated_at FROM timetable_data WHERE school_year = ? AND cycle_code = ?')
        .get(schoolYear, normalizedCycleCode) || null;
}

function getAllBySchoolYear(db, schoolYear, cycleCodes) {
    const normalizedCycleCodes = [...new Set((cycleCodes || []).map(requireCycleCode))];
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

function upsertByCycle(db, schoolYear, cycleCode, dataJson) {
    const normalizedCycleCode = requireCycleCode(cycleCode);
    return db
        .prepare(
            `INSERT INTO timetable_data (school_year, cycle_code, data_json, updated_at)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(school_year, cycle_code) DO UPDATE SET
                 data_json = excluded.data_json,
                 updated_at = CURRENT_TIMESTAMP`
        )
        .run(schoolYear, normalizedCycleCode, dataJson);
}

function deleteByCycle(db, schoolYear, cycleCode) {
    const normalizedCycleCode = requireCycleCode(cycleCode);
    return db
        .prepare('DELETE FROM timetable_data WHERE school_year = ? AND cycle_code = ?')
        .run(schoolYear, normalizedCycleCode);
}

module.exports = { getByCycle, getAllBySchoolYear, upsertByCycle, deleteByCycle };
