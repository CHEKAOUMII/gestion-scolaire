'use strict';

const { handleRead, handleWrite, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { requireFields, validateDate } = require('./validation');
const absencesRepo = require('../repos/absences');

function registerAbsencesIpc(ipcMain) {
    handleRead(ipcMain, 'absences:getAll', (db, schoolYear) => {
        return absencesRepo.listByYear(db, normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'absences:getByStudent', (db, studentId, schoolYear) => {
        return absencesRepo.getByStudentId(db, studentId, normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'absences:getByStudentCode', (db, studentCode, schoolYear) => {
        return absencesRepo.getByStudentCode(db, studentCode, normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'absences:getBySection', (db, section, schoolYear) => {
        return absencesRepo.getBySection(db, section, normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'absences:save', WRITE_ROLES, (db, _event, absence) => {
        requireFields(absence, ['student_code', 'absence_date', 'school_year']);
        requireSchoolYear(absence.school_year);
        validateDate('absence_date', absence.absence_date);
        return absencesRepo.saveOne(db, absence);
    });

    handleWriteSoftAuth(ipcMain, 'absences:saveBulk', WRITE_ROLES, (db, absences) => {
        if (!Array.isArray(absences)) {
            return { success: false, error: 'Expected an array' };
        }
        if (absences.length > 5000) {
            return { success: false, error: 'Batch size exceeds maximum of 5000' };
        }
        return absencesRepo.saveBulk(db, absences, {
            validate(absence) {
                requireFields(absence, ['student_code', 'month', 'school_year']);
                requireSchoolYear(absence.school_year);
            }
        });
    }, { allowNoSession: true });

    handleWrite(ipcMain, 'absences:delete', WRITE_ROLES, (db, _event, id) => {
        return absencesRepo.deleteById(db, id);
    });

    handleRead(ipcMain, 'absences:getStats', (db, schoolYear) => {
        return absencesRepo.getStats(db, normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'absences:getSummaryByStudent', (db, schoolYear) => {
        return absencesRepo.getSummaryByStudent(db, normalizeYear(schoolYear));
    });

    // ── Correspondence (orchestration only) ──

    handleRead(ipcMain, 'correspondence:getAll', (db, schoolYear) => {
        return absencesRepo.listCorrespondenceByYear(db, normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'correspondence:save', WRITE_ROLES, (db, _event, letter) => {
        requireSchoolYear(letter.school_year);
        return absencesRepo.saveCorrespondence(db, letter);
    });

    handleRead(ipcMain, 'correspondence:getByStudent', (db, studentId) => {
        return absencesRepo.listCorrespondenceByStudent(db, studentId);
    });

    handleWrite(ipcMain, 'correspondence:markPrinted', WRITE_ROLES, (db, _event, id) => {
        return absencesRepo.markCorrespondencePrinted(db, id);
    });

    handleWriteSoftAuth(ipcMain, 'absences:deleteByYear', WRITE_ROLES, (db, schoolYear) => {
        const year = requireSchoolYear(schoolYear);
        const count = absencesRepo.deleteByYear(db, year);
        return { success: true, count };
    });

    /**
     * Atomic delete-by-year + saveBulk for absence import apply.
     * Prefer this over separate deleteByYear + saveBulk IPC calls.
     */
    handleWriteSoftAuth(ipcMain, 'absences:replaceByYear', WRITE_ROLES, (db, schoolYear, absences) => {
        const year = requireSchoolYear(schoolYear);
        if (!Array.isArray(absences)) {
            return { success: false, error: 'Expected an array' };
        }
        if (absences.length > 5000) {
            return { success: false, error: 'Batch size exceeds maximum of 5000' };
        }
        return absencesRepo.replaceByYear(db, year, absences, {
            validate(absence) {
                requireFields(absence, ['student_code', 'month', 'school_year']);
                requireSchoolYear(absence.school_year);
            }
        });
    }, { allowNoSession: true });
}

module.exports = { registerAbsencesIpc };
