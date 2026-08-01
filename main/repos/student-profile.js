'use strict';

/** Student profile child SQL; ownership and cycle resolution stay in the repository. */
const { requireCycle, resolveStudentForCycle } = require('./student-cycle');

function listProfileTabs(db, studentCode, schoolYear, cycleCode) {
    const cycle = requireCycle(cycleCode);
    const student = resolveStudentForCycle(db, studentCode, schoolYear, cycle);
    return db
        .prepare(
            `SELECT *
             FROM student_profile_data
             WHERE student_code = ? AND school_year = ? AND cycle_code = ?
             ORDER BY tab_key`
        )
        .all(student.code, schoolYear, cycle);
}

function saveProfileTab(db, payload, serializedData, cycleCode) {
    const cycle = requireCycle(cycleCode);
    const student = resolveStudentForCycle(db, payload.student_code, payload.school_year, cycle);
    const result = db.prepare(
        `INSERT INTO student_profile_data
            (student_id, student_code, tab_key, data_json, school_year, cycle_code, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
         ON CONFLICT(student_code, tab_key, school_year) DO UPDATE SET
            student_id = excluded.student_id,
            data_json = excluded.data_json,
            cycle_code = excluded.cycle_code,
            updated_at = CURRENT_TIMESTAMP,
            updated_by = excluded.updated_by
         WHERE student_profile_data.cycle_code = excluded.cycle_code`
    ).run(
        student.id,
        student.code,
        payload.tab_key,
        serializedData,
        payload.school_year,
        cycle,
        payload.updated_by || null
    );
    return result.changes ? { success: true } : { success: false, error: 'ملف التلميذ لا ينتمي إلى السلك التعليمي النشط' };
}

function saveRiskSnapshot(db, payload, cycleCode) {
    const cycle = requireCycle(cycleCode);
    const student = resolveStudentForCycle(db, payload.student_code, payload.school_year, cycle);
    const rawScore = Number(payload.risk_score);
    const riskScore = Number.isFinite(rawScore) ? Math.round(rawScore) : null;
    const riskLevel = payload.risk_level != null ? String(payload.risk_level).slice(0, 50) : null;
    db.prepare(
        `INSERT INTO student_risk_snapshot
            (student_id, student_code, risk_score, risk_level, school_year, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
         ON CONFLICT(student_code, school_year) DO UPDATE SET
            student_id = excluded.student_id,
            risk_score = excluded.risk_score,
            risk_level = excluded.risk_level,
            updated_at = CURRENT_TIMESTAMP,
            updated_by = excluded.updated_by`
    ).run(student.id, student.code, riskScore, riskLevel, payload.school_year, payload.updated_by || null);
    return { success: true };
}

module.exports = { listProfileTabs, saveProfileTab, saveRiskSnapshot };
