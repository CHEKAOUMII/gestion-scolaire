'use strict';

/** Absences SQL and atomic capture; correspondence is cycle-scoped. */
const { captureInputUpserts, captureDeletesFromRows, notifyCaptureCommitted } = require('./capture-port');
const { getLocalKeyFields } = require('../sync/entity-registry');
const { requireCycle, findStudentById, resolveStudentForCycle, resolveStudentOwnership } = require('./student-cycle');

const ABSENCE_KEY_FIELDS = getLocalKeyFields('absences') || ['school_year', 'student_code', 'month', 'absence_type'];

function listByYear(db, year, cycleCode) {
    const cycle = requireCycle(cycleCode);
    return db.prepare(`
        SELECT a.*, COALESCE(sid.full_name, scode.full_name) AS full_name,
               COALESCE(sid.section, scode.section) AS section
        FROM absences a
        LEFT JOIN students sid ON a.student_id = sid.id AND sid.cycle_code = a.cycle_code
        LEFT JOIN students scode ON scode.code = a.student_code AND scode.school_year = a.school_year
          AND scode.cycle_code = a.cycle_code
        WHERE a.school_year = ? AND a.cycle_code = ?
        ORDER BY a.absence_date DESC`).all(year, cycle);
}

function getByStudentId(db, studentId, year, cycleCode) {
    const id = Number(studentId);
    if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'Invalid student ID' };
    return db.prepare('SELECT * FROM absences WHERE student_id = ? AND school_year = ? AND cycle_code = ? ORDER BY absence_date DESC').all(id, year, requireCycle(cycleCode));
}

function getByStudentCode(db, studentCode, year, cycleCode) {
    const cycle = requireCycle(cycleCode);
    return db.prepare(`
        SELECT a.*, COALESCE(sid.full_name, scode.full_name) AS full_name,
               COALESCE(sid.section, scode.section) AS section
        FROM absences a
        LEFT JOIN students sid ON a.student_id = sid.id AND sid.cycle_code = a.cycle_code
        LEFT JOIN students scode ON scode.code = a.student_code AND scode.school_year = a.school_year
          AND scode.cycle_code = a.cycle_code
        WHERE a.student_code = ? AND a.school_year = ? AND a.cycle_code = ?
        ORDER BY a.absence_date DESC`).all(String(studentCode || '').trim(), year, cycle);
}

function getBySection(db, section, year, cycleCode) {
    const cycle = requireCycle(cycleCode);
    return db.prepare(`
        SELECT a.*, s.full_name, s.family_name, s.code AS student_code
        FROM absences a
        LEFT JOIN students s ON a.student_id = s.id AND s.cycle_code = a.cycle_code
        WHERE s.section = ? AND a.school_year = ? AND a.cycle_code = ?
        ORDER BY s.full_name`).all(section, year, cycle);
}

function createUpsert(db) {
    return db.prepare(`
        INSERT INTO absences(student_id, student_code, absence_date, month, absence_type, hours, days, reason, school_year, cycle_code)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_code, month, school_year, absence_type) DO UPDATE SET
            hours = excluded.hours, days = excluded.days, absence_date = excluded.absence_date,
            student_id = excluded.student_id, reason = excluded.reason
        WHERE absences.cycle_code = excluded.cycle_code`);
}

function resolveAbsence(absence, db, cycleCode) {
    const student = resolveStudentForCycle(db, absence.student_code, absence.school_year, cycleCode);
    return { ...absence, student_id: student.id, student_code: student.code, cycle_code: student.cycle_code };
}

/**
 * Bulk owner resolution: a foreign-cycle row is reported and skipped, an unknown code
 * still throws. Mirrors gradesRepo.saveBulk and studentsRepo.addBulk so every import in
 * the app fails — or degrades — the same way.
 *
 * @returns {{ row: object|null, skipped: object|null }}
 */
function resolveAbsenceForBulk(absence, db, cycle) {
    const { student, foreignCycle } = resolveStudentOwnership(db, absence.student_code, absence.school_year, cycle);
    if (!student) {
        throw new Error(`لا يوجد تلميذ بالرمز ${String(absence.student_code || '').trim()} في السنة الدراسية المحددة`);
    }
    if (foreignCycle) {
        return { row: null, skipped: { student_code: student.code, school_year: absence.school_year } };
    }
    return {
        row: { ...absence, student_id: student.id, student_code: student.code, cycle_code: student.cycle_code },
        skipped: null
    };
}

function runUpsert(upsert, row) {
    return upsert.run(row.student_id, row.student_code, row.absence_date, row.month, row.absence_type, row.hours, row.days, row.reason, row.school_year, row.cycle_code);
}

function saveOne(db, absence, cycleCode) {
    const cycle = requireCycle(cycleCode);
    const run = db.transaction(() => {
        const row = resolveAbsence(absence, db, cycle);
        const info = runUpsert(createUpsert(db), row);
        return { info, row };
    });
    const result = run();
    if (result.info.changes) notifyCaptureCommitted();
    return { success: true, saved: result.info.changes, skippedOtherCycle: result.info.changes ? 0 : 1 };
}

function saveBulk(db, absences, cycleCode, options = {}) {
    const cycle = requireCycle(cycleCode);
    const upsert = createUpsert(db);
    const run = db.transaction((items) => {
        const applied = [];
        const skippedRows = [];
        for (const absence of items) {
            if (typeof options.validate === 'function') options.validate(absence);
            const { row, skipped } = resolveAbsenceForBulk(absence, db, cycle);
            if (skipped) {
                skippedRows.push(skipped);
                continue;
            }
            const info = runUpsert(upsert, row);
            if (!info.changes) {
                // Upsert guard: the stored row's cycle drifted from its student's.
                skippedRows.push({ student_code: row.student_code, school_year: row.school_year });
                continue;
            }
            applied.push({ school_year: row.school_year, student_code: row.student_code, month: row.month, absence_type: row.absence_type });
        }
        captureInputUpserts(db, { tableName: 'absences', keyFields: ABSENCE_KEY_FIELDS, items: applied, operation: 'PUT' });
        return { applied, skippedRows };
    });
    const result = run(absences);
    if (result.applied.length) notifyCaptureCommitted();
    return { success: true, count: result.applied.length, skippedOtherCycle: result.skippedRows.length, skippedRows: result.skippedRows };
}

function deleteById(db, id, cycleCode) {
    const absenceId = Number(id);
    if (!Number.isFinite(absenceId) || absenceId <= 0) return { success: false, error: 'Invalid ID' };
    const cycle = requireCycle(cycleCode);
    const run = db.transaction(() => {
        const row = db.prepare('SELECT * FROM absences WHERE id = ? AND cycle_code = ?').get(absenceId, cycle);
        if (!row) return 0;
        captureDeletesFromRows(db, 'absences', [row]);
        return db.prepare('DELETE FROM absences WHERE id = ? AND cycle_code = ?').run(absenceId, cycle).changes;
    });
    const deleted = run();
    if (deleted) notifyCaptureCommitted();
    return { success: true, deleted };
}

function getStats(db, year, cycleCode) {
    const cycle = requireCycle(cycleCode);
    const totalHours = db.prepare('SELECT COALESCE(SUM(hours), 0) AS total FROM absences WHERE school_year = ? AND cycle_code = ?').get(year, cycle).total;
    const bySection = db.prepare(`
        SELECT s.section, SUM(a.hours) AS total_hours, COUNT(DISTINCT a.student_id) AS students_count
        FROM absences a LEFT JOIN students s ON a.student_id = s.id AND s.cycle_code = a.cycle_code
        WHERE a.school_year = ? AND a.cycle_code = ? GROUP BY s.section`).all(year, cycle);
    const byMonth = db.prepare('SELECT month, SUM(hours) AS total_hours FROM absences WHERE school_year = ? AND cycle_code = ? GROUP BY month').all(year, cycle);
    const topAbsentees = db.prepare(`
        SELECT a.student_id, a.student_code, s.full_name, s.section, SUM(a.hours) AS total_hours
        FROM absences a LEFT JOIN students s ON a.student_id = s.id AND s.cycle_code = a.cycle_code
        WHERE a.school_year = ? AND a.cycle_code = ? GROUP BY a.student_id ORDER BY total_hours DESC LIMIT 10`).all(year, cycle);
    return { totalHours, bySection, byMonth, topAbsentees };
}

function getSummaryByStudent(db, year, cycleCode) {
    const cycle = requireCycle(cycleCode);
    return db.prepare(`
        SELECT a.student_id, a.student_code, s.full_name, s.family_name, s.section,
               SUM(a.hours) AS total_hours,
               SUM(CASE WHEN a.absence_type = 'justified' THEN a.hours ELSE 0 END) AS justified_hours,
               SUM(CASE WHEN a.absence_type = 'unjustified' THEN a.hours ELSE 0 END) AS unjustified_hours
        FROM absences a LEFT JOIN students s ON a.student_id = s.id AND s.cycle_code = a.cycle_code
        WHERE a.school_year = ? AND a.cycle_code = ? GROUP BY a.student_id ORDER BY total_hours DESC`).all(year, cycle);
}

function deleteByYear(db, year, cycleCode) {
    const cycle = requireCycle(cycleCode);
    const run = db.transaction(() => {
        const rows = db.prepare('SELECT * FROM absences WHERE school_year = ? AND cycle_code = ?').all(year, cycle);
        captureDeletesFromRows(db, 'absences', rows);
        return db.prepare('DELETE FROM absences WHERE school_year = ? AND cycle_code = ?').run(year, cycle).changes;
    });
    const count = run();
    if (count) notifyCaptureCommitted();
    return count;
}

function replaceByYear(db, year, absences, cycleCode, options = {}) {
    const cycle = requireCycle(cycleCode);
    if (year == null || year === '') return { success: false, error: 'school_year required' };
    if (!Array.isArray(absences)) return { success: false, error: 'Expected an array' };
    if (absences.length > 5000) return { success: false, error: 'Batch size exceeds maximum of 5000' };
    const upsert = createUpsert(db);
    const run = db.transaction((items) => {
        const deletedRows = db.prepare('SELECT * FROM absences WHERE school_year = ? AND cycle_code = ?').all(year, cycle);
        captureDeletesFromRows(db, 'absences', deletedRows);
        const deleted = db.prepare('DELETE FROM absences WHERE school_year = ? AND cycle_code = ?').run(year, cycle).changes;
        const applied = [];
        const skippedRows = [];
        for (const absence of items) {
            if (typeof options.validate === 'function') options.validate(absence);
            const { row, skipped } = resolveAbsenceForBulk(absence, db, cycle);
            if (skipped) {
                skippedRows.push(skipped);
                continue;
            }
            const info = runUpsert(upsert, row);
            if (!info.changes) {
                skippedRows.push({ student_code: row.student_code, school_year: row.school_year });
                continue;
            }
            applied.push({ school_year: row.school_year, student_code: row.student_code, month: row.month, absence_type: row.absence_type });
        }
        captureInputUpserts(db, { tableName: 'absences', keyFields: ABSENCE_KEY_FIELDS, items: applied, operation: 'PUT' });
        return { deleted, applied, skippedRows };
    });
    const result = run(absences);
    if (result.deleted || result.applied.length) notifyCaptureCommitted();
    return { success: true, deleted: result.deleted, count: result.applied.length, skippedOtherCycle: result.skippedRows.length, skippedRows: result.skippedRows };
}

// Sync identity remains independent of cycle_code (cycle-carrying, not cycle-keyed).
function findByLocalKeys(db, keyObj) {
    const { school_year: year, student_code: studentCode, month, absence_type: absenceType } = keyObj || {};
    if (year == null || studentCode == null || month == null || absenceType == null) return null;
    return db.prepare('SELECT * FROM absences WHERE school_year = ? AND student_code = ? AND month = ? AND absence_type = ? LIMIT 1').get(year, studentCode, month, absenceType);
}

// ── Correspondence (co-located historically; cycle-scoped since S7) ───
function listCorrespondenceByYear(db, year, cycleCode) {
    const cycle = requireCycle(cycleCode);
    return db.prepare(`
        SELECT c.*, s.full_name, s.section
        FROM correspondence c
        LEFT JOIN students s ON c.student_id = s.id AND s.cycle_code = c.cycle_code
        WHERE c.school_year = ? AND c.cycle_code = ?
        ORDER BY c.letter_date DESC`).all(year, cycle);
}

function listCorrespondenceByStudent(db, studentId, cycleCode) {
    const id = Number(studentId);
    if (!Number.isFinite(id) || id <= 0) return [];
    return db.prepare('SELECT * FROM correspondence WHERE student_id = ? AND cycle_code = ? ORDER BY letter_date DESC').all(id, requireCycle(cycleCode));
}

/**
 * Strict owner lookup for a letter: student_code first (Massar-style payloads),
 * student_id as fallback. Unknown or foreign-cycle students throw in Arabic.
 */
function resolveCorrespondenceOwner(db, letter, cycle) {
    const code = String(letter.student_code || '').trim();
    if (code) {
        const { student, foreignCycle } = resolveStudentOwnership(db, code, letter.school_year, cycle);
        if (!student) {
            throw new Error(`لا يوجد تلميذ بالرمز ${code} في السنة الدراسية المحددة`);
        }
        if (foreignCycle) {
            throw new Error(`التلميذ بالرمز ${code} لا ينتمي إلى السلك التعليمي النشط`);
        }
        return student;
    }
    const student = findStudentById(db, letter.student_id, letter.school_year);
    if (!student) {
        throw new Error(`لا يوجد تلميذ بالرقم ${String(letter.student_id)} في السنة الدراسية المحددة`);
    }
    if (student.cycle_code !== cycle) {
        throw new Error(`التلميذ بالرقم ${String(letter.student_id)} لا ينتمي إلى السلك التعليمي النشط`);
    }
    return student;
}

function saveCorrespondence(db, letter, cycleCode) {
    const cycle = requireCycle(cycleCode);
    const student = resolveCorrespondenceOwner(db, letter, cycle);
    const info = db.prepare('INSERT INTO correspondence(student_id, student_code, letter_type, letter_date, total_hours, school_year, cycle_code) VALUES(?, ?, ?, ?, ?, ?, ?)').run(student.id, student.code, letter.letter_type, letter.letter_date, letter.total_hours, letter.school_year, cycle);
    return { success: true, id: info.lastInsertRowid };
}

function markCorrespondencePrinted(db, id, cycleCode) {
    const corrId = Number(id);
    if (!Number.isFinite(corrId) || corrId <= 0) return { success: false, error: 'Invalid ID' };
    db.prepare('UPDATE correspondence SET printed = 1 WHERE id = ? AND cycle_code = ?').run(corrId, requireCycle(cycleCode));
    return { success: true };
}

module.exports = { ABSENCE_KEY_FIELDS, listByYear, getByStudentId, getByStudentCode, getBySection, saveOne, saveBulk, deleteById, getStats, getSummaryByStudent, deleteByYear, replaceByYear, findByLocalKeys, listCorrespondenceByYear, saveCorrespondence, listCorrespondenceByStudent, markCorrespondencePrinted };
