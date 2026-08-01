'use strict';

const { handleRead, handleAuthedRead, handleWrite, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const { requireFields, validateDate } = require('./validation');
const { resolveCycleForRequest } = require('../auth/resolve-cycle');
const absencesRepo = require('../repos/absences');

const WRITE_ROLES = ALLOWED_ROLES.filter((role) => role !== 'viewer');

function registerAbsencesIpc(ipcMain) {
    handleAuthedRead(ipcMain, 'absences:getAll', ({ db, event }, schoolYear) => absencesRepo.listByYear(db, normalizeYear(schoolYear), resolveCycleForRequest(db, event)));
    handleAuthedRead(ipcMain, 'absences:getByStudent', ({ db, event }, studentId, schoolYear) => absencesRepo.getByStudentId(db, studentId, normalizeYear(schoolYear), resolveCycleForRequest(db, event)));
    handleAuthedRead(ipcMain, 'absences:getByStudentCode', ({ db, event }, studentCode, schoolYear) => absencesRepo.getByStudentCode(db, studentCode, normalizeYear(schoolYear), resolveCycleForRequest(db, event)));
    handleAuthedRead(ipcMain, 'absences:getBySection', ({ db, event }, section, schoolYear) => absencesRepo.getBySection(db, section, normalizeYear(schoolYear), resolveCycleForRequest(db, event)));
    handleAuthedRead(ipcMain, 'absences:getStats', ({ db, event }, schoolYear) => absencesRepo.getStats(db, normalizeYear(schoolYear), resolveCycleForRequest(db, event)));
    handleAuthedRead(ipcMain, 'absences:getSummaryByStudent', ({ db, event }, schoolYear) => absencesRepo.getSummaryByStudent(db, normalizeYear(schoolYear), resolveCycleForRequest(db, event)));

    handleWrite(ipcMain, 'absences:save', WRITE_ROLES, (db, event, absence) => {
        requireFields(absence, ['student_code', 'absence_date', 'school_year']);
        requireSchoolYear(absence.school_year);
        validateDate('absence_date', absence.absence_date);
        return absencesRepo.saveOne(db, absence, resolveCycleForRequest(db, event));
    });
    handleWriteSoftAuth(ipcMain, 'absences:saveBulk', WRITE_ROLES, ({ db, event }, absences) => {
        if (!Array.isArray(absences)) return { success: false, error: 'Expected an array' };
        if (absences.length > 5000) return { success: false, error: 'Batch size exceeds maximum of 5000' };
        return absencesRepo.saveBulk(db, absences, resolveCycleForRequest(db, event), {
            validate(absence) {
                requireFields(absence, ['student_code', 'month', 'school_year']);
                requireSchoolYear(absence.school_year);
            }
        });
    }, { allowNoSession: true, withContext: true });
    handleWrite(ipcMain, 'absences:delete', WRITE_ROLES, (db, event, id) => absencesRepo.deleteById(db, id, resolveCycleForRequest(db, event)));

    // Correspondence is cycle-scoped since S7.
    handleAuthedRead(ipcMain, 'correspondence:getAll', ({ db, event }, schoolYear) => absencesRepo.listCorrespondenceByYear(db, normalizeYear(schoolYear), resolveCycleForRequest(db, event)));
    handleWrite(ipcMain, 'correspondence:save', WRITE_ROLES, (db, event, letter) => {
        requireSchoolYear(letter.school_year);
        return absencesRepo.saveCorrespondence(db, letter, resolveCycleForRequest(db, event));
    });
    handleAuthedRead(ipcMain, 'correspondence:getByStudent', ({ db, event }, studentId) => absencesRepo.listCorrespondenceByStudent(db, studentId, resolveCycleForRequest(db, event)));
    handleWrite(ipcMain, 'correspondence:markPrinted', WRITE_ROLES, (db, event, id) => absencesRepo.markCorrespondencePrinted(db, id, resolveCycleForRequest(db, event)));

    handleWriteSoftAuth(ipcMain, 'absences:deleteByYear', WRITE_ROLES, ({ db, event }, schoolYear) => ({ success: true, count: absencesRepo.deleteByYear(db, requireSchoolYear(schoolYear), resolveCycleForRequest(db, event)) }), { withContext: true });
    handleWriteSoftAuth(ipcMain, 'absences:replaceByYear', WRITE_ROLES, ({ db, event }, schoolYear, absences) => {
        const year = requireSchoolYear(schoolYear);
        if (!Array.isArray(absences)) return { success: false, error: 'Expected an array' };
        if (absences.length > 5000) return { success: false, error: 'Batch size exceeds maximum of 5000' };
        return absencesRepo.replaceByYear(db, year, absences, resolveCycleForRequest(db, event), {
            validate(absence) {
                requireFields(absence, ['student_code', 'month', 'school_year']);
                requireSchoolYear(absence.school_year);
            }
        });
    }, { allowNoSession: true, withContext: true });
}

module.exports = { registerAbsencesIpc };
