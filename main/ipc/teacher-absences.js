const { handleAuthedRead, handleWrite, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { validateDate } = require('./validation');
const teacherAbsencesRepo = require('../repos/teacher-absences');

function registerTeacherAbsencesIpc(ipcMain) {
    handleAuthedRead(ipcMain, 'teacherAbsences:getAll', ({ db }, schoolYear) => {
        return teacherAbsencesRepo.listByYear(db, normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'teacherAbsences:save', WRITE_ROLES, (db, _event, payload) => {
        if (payload.absence_date) {
            validateDate('absence_date', payload.absence_date);
        }
        requireSchoolYear(payload.school_year);
        teacherAbsencesRepo.insert(
            db,
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
        teacherAbsencesRepo.deleteById(db, absenceId);
        return { success: true };
    });
}

module.exports = { registerTeacherAbsencesIpc };
