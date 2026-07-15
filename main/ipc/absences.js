const { handleRead, handleWrite, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { requireFields, validateDate } = require('./validation');

function registerAbsencesIpc(ipcMain) {
    // ── Read handlers (no auth required — app starts without login) ──

    handleRead(ipcMain, 'absences:getAll', (db, schoolYear) => {
        return db
            .prepare(
                `
            SELECT a.*,
            COALESCE(sid.full_name, scode.full_name) as full_name,
            COALESCE(sid.section, scode.section) as section
            FROM absences a 
            LEFT JOIN students sid ON a.student_id = sid.id 
            LEFT JOIN students scode ON scode.code = a.student_code AND scode.school_year = a.school_year
            WHERE a.school_year = ?
            ORDER BY a.absence_date DESC
        `
            )
            .all(normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'absences:getByStudent', (db, studentId, schoolYear) => {
        const safeId = Number(studentId);
        if (!Number.isFinite(safeId) || safeId <= 0) {
            return { success: false, error: 'Invalid student ID' };
        }
        return db
            .prepare('SELECT * FROM absences WHERE student_id = ? AND school_year = ? ORDER BY absence_date DESC')
            .all(safeId, normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'absences:getByStudentCode', (db, studentCode, schoolYear) => {
        return db
            .prepare(
                `
            SELECT a.*,
            COALESCE(sid.full_name, scode.full_name) as full_name,
            COALESCE(sid.section, scode.section) as section
            FROM absences a
            LEFT JOIN students sid ON a.student_id = sid.id
            LEFT JOIN students scode ON scode.code = a.student_code AND scode.school_year = a.school_year
            WHERE a.student_code = ? AND a.school_year = ?
            ORDER BY a.absence_date DESC
        `
            )
            .all(String(studentCode || '').trim(), normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'absences:getBySection', (db, section, schoolYear) => {
        return db
            .prepare(
                `
            SELECT a.*, s.full_name, s.family_name, s.code as student_code
            FROM absences a 
            LEFT JOIN students s ON a.student_id = s.id 
            WHERE s.section = ? AND a.school_year = ?
            ORDER BY s.full_name
        `
            )
            .all(section, normalizeYear(schoolYear));
    });

    // ── Write handlers (require admin or staff role) ──

    handleWrite(ipcMain, 'absences:save', WRITE_ROLES, (db, _event, absence) => {
        requireFields(absence, ['student_code', 'absence_date', 'school_year']);
        requireSchoolYear(absence.school_year);
        validateDate('absence_date', absence.absence_date);
        db.prepare(
            `
                INSERT INTO absences(student_id, student_code, absence_date, month, absence_type, hours, days, reason, school_year)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
        ).run(
            absence.student_id,
            absence.student_code,
            absence.absence_date,
            absence.month,
            absence.absence_type,
            absence.hours,
            absence.days,
            absence.reason,
            absence.school_year
        );
        return { success: true };
    });

    // No auth: bulk-import is used by settings-imports page before login
    handleWriteSoftAuth(ipcMain, 'absences:saveBulk', WRITE_ROLES, (db, absences) => {
        if (!Array.isArray(absences)) {
            return { success: false, error: 'Expected an array' };
        }
        if (absences.length > 5000) {
            return { success: false, error: 'Batch size exceeds maximum of 5000' };
        }
        const upsert = db.prepare(`
                INSERT INTO absences(student_id, student_code, absence_date, month, absence_type, hours, days, reason, school_year)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(student_code, month, school_year, absence_type)
                DO UPDATE SET hours = excluded.hours, days = excluded.days
            `);

        const upsertMany = db.transaction((items) => {
            for (const absence of items) {
                requireFields(absence, ['student_code', 'month', 'school_year']);
                requireSchoolYear(absence.school_year);
                upsert.run(
                    absence.student_id,
                    absence.student_code,
                    absence.absence_date,
                    absence.month,
                    absence.absence_type,
                    absence.hours,
                    absence.days,
                    absence.reason,
                    absence.school_year
                );
            }
        });
        upsertMany(absences);
        return { success: true, count: absences.length };
    }, { allowNoSession: true });

    handleWrite(ipcMain, 'absences:delete', WRITE_ROLES, (db, _event, id) => {
        const absenceId = Number(id);
        if (!Number.isFinite(absenceId) || absenceId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        db.prepare('DELETE FROM absences WHERE id = ?').run(absenceId);
        return { success: true };
    });

    // ── Read stats (no auth required) ──

    handleRead(ipcMain, 'absences:getStats', (db, schoolYear) => {
        const year = normalizeYear(schoolYear);

        const { total: totalHours } = db
            .prepare('SELECT COALESCE(SUM(hours), 0) as total FROM absences WHERE school_year = ?')
            .get(year);

        const bySection = db
            .prepare(
                `
            SELECT s.section, SUM(a.hours) as total_hours, COUNT(DISTINCT a.student_id) as students_count
            FROM absences a
            LEFT JOIN students s ON a.student_id = s.id
            WHERE a.school_year = ?
            GROUP BY s.section
        `
            )
            .all(year);

        const byMonth = db
            .prepare(
                `
            SELECT month, SUM(hours) as total_hours
            FROM absences WHERE school_year = ?
            GROUP BY month
        `
            )
            .all(year);

        const topAbsentees = db
            .prepare(
                `
            SELECT a.student_id, a.student_code, s.full_name, s.section, SUM(a.hours) as total_hours
            FROM absences a
            LEFT JOIN students s ON a.student_id = s.id
            WHERE a.school_year = ?
            GROUP BY a.student_id
            ORDER BY total_hours DESC
            LIMIT 10
        `
            )
            .all(year);

        return { totalHours, bySection, byMonth, topAbsentees };
    });

    handleRead(ipcMain, 'absences:getSummaryByStudent', (db, schoolYear) => {
        return db
            .prepare(
                `
            SELECT a.student_id, a.student_code, s.full_name, s.family_name, s.section,
            SUM(a.hours) as total_hours,
            SUM(CASE WHEN a.absence_type = 'justified' THEN a.hours ELSE 0 END) as justified_hours,
            SUM(CASE WHEN a.absence_type = 'unjustified' THEN a.hours ELSE 0 END) as unjustified_hours
            FROM absences a
            LEFT JOIN students s ON a.student_id = s.id
            WHERE a.school_year = ?
            GROUP BY a.student_id
            ORDER BY total_hours DESC
        `
            )
            .all(normalizeYear(schoolYear));
    });

    // ── Correspondence (read = open, write = admin/staff) ──

    handleRead(ipcMain, 'correspondence:getAll', (db, schoolYear) => {
        return db
            .prepare(
                `
            SELECT c.*, s.full_name, s.section 
            FROM correspondence c 
            LEFT JOIN students s ON c.student_id = s.id 
            WHERE c.school_year = ?
            ORDER BY c.letter_date DESC
        `
            )
            .all(normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'correspondence:save', WRITE_ROLES, (db, _event, letter) => {
        requireSchoolYear(letter.school_year);
        const info = db
            .prepare(
                `
                INSERT INTO correspondence(student_id, student_code, letter_type, letter_date, total_hours, school_year)
                VALUES(?, ?, ?, ?, ?, ?)
            `
            )
            .run(
                letter.student_id,
                letter.student_code,
                letter.letter_type,
                letter.letter_date,
                letter.total_hours,
                letter.school_year
            );
        return { success: true, id: info.lastInsertRowid };
    });

    handleRead(ipcMain, 'correspondence:getByStudent', (db, studentId) => {
        return db.prepare('SELECT * FROM correspondence WHERE student_id = ? ORDER BY letter_date DESC').all(studentId);
    });

    handleWrite(ipcMain, 'correspondence:markPrinted', WRITE_ROLES, (db, _event, id) => {
        const corrId = Number(id);
        if (!Number.isFinite(corrId) || corrId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        db.prepare('UPDATE correspondence SET printed = 1 WHERE id = ?').run(corrId);
        return { success: true };
    });

    // No auth: delete is used from settings-imports page which may be opened before login
    handleWriteSoftAuth(ipcMain, 'absences:deleteByYear', WRITE_ROLES, (db, schoolYear) => {
        db.prepare('DELETE FROM absences WHERE school_year = ?').run(requireSchoolYear(schoolYear));
        return { success: true };
    });
}

module.exports = { registerAbsencesIpc };
