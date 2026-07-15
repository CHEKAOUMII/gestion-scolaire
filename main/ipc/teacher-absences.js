const { handleRead, handleWrite, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { validateDate } = require('./validation');

function registerTeacherAbsencesIpc(ipcMain) {
    handleRead(ipcMain, 'teacherAbsences:getAll', (db, schoolYear) => {
        return db
            .prepare(
                `
            SELECT a.*, t.full_name
            FROM teacher_absences a
            LEFT JOIN teachers t ON t.id = a.teacher_id
            WHERE a.school_year = ?
            ORDER BY a.absence_date DESC
        `
            )
            .all(normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'teacherAbsences:save', WRITE_ROLES, (db, _event, payload) => {
        if (payload.absence_date) {
            validateDate('absence_date', payload.absence_date);
        }
        requireSchoolYear(payload.school_year);
        db.prepare(
            `
                INSERT INTO teacher_absences(teacher_id, absence_date, reason, replacement_teacher, school_year)
                VALUES(?, ?, ?, ?, ?)
            `
        ).run(
            payload.teacher_id,
            payload.absence_date,
            payload.reason || null,
            payload.replacement_teacher || null,
            payload.school_year
        );
        return { success: true };
    });

    handleWrite(ipcMain, 'teacherAbsences:delete', WRITE_ROLES, (db, _event, id) => {
        const absenceId = Number(id);
        if (!Number.isFinite(absenceId) || absenceId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        db.prepare('DELETE FROM teacher_absences WHERE id = ?').run(absenceId);
        return { success: true };
    });
}

module.exports = { registerTeacherAbsencesIpc };
