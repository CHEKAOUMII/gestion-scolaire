'use strict';

const { handleAuthedRead, handleWrite, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const { requireFields, validateDate, validateRange } = require('./validation');
const { resolveCycleForRequest } = require('../auth/resolve-cycle');
const absencesRepo = require('../repos/absences');
const { writeImportAudit, buildImportAuditDetails } = require('./import-audit');

const WRITE_ROLES = ALLOWED_ROLES.filter((role) => role !== 'viewer');

function validateAbsenceMonth(value) {
    const text = String(value ?? '').trim();
    if (!text) return;
    if (/^(سنوي|annuel|annual)$/i.test(text)) return;
    if (/^\d{1,2}$/.test(text)) {
        const n = Number(text);
        if (n >= 1 && n <= 12) return;
    } else if (/^\d{4}-\d{2}$/.test(text)) {
        const monthNum = Number(text.slice(5, 7));
        if (monthNum >= 1 && monthNum <= 12) return;
    }
    throw new Error('month: صيغة الشهر غير صحيحة (رقم 1-12 أو YYYY-MM أو «سنوي»)');
}

function validateAbsenceRow(absence, expectedYear = null) {
    requireFields(absence, ['student_code', 'school_year']);
    const rowYear = requireSchoolYear(absence.school_year);
    if (expectedYear != null && rowYear !== expectedYear) {
        const error = new Error('سنة سجل الغياب لا تطابق سنة الاستبدال');
        error.code = 'SCHOOL_YEAR_MISMATCH';
        throw error;
    }
    const dateStr = String(absence.absence_date ?? '').trim();
    const monthStr = String(absence.month ?? '').trim();
    if (dateStr) validateDate('absence_date', dateStr);
    if (monthStr) validateAbsenceMonth(monthStr);
    if (!dateStr && !monthStr) {
        throw new Error('month: يجب تحديد الشهر (month) أو تاريخ الغياب (absence_date)');
    }
    if (absence.hours != null && absence.hours !== '') validateRange('hours', absence.hours, 0, 24);
    if (absence.days != null && absence.days !== '') validateRange('days', absence.days, 0, 31);
}

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
        const cycle = resolveCycleForRequest(db, event);
        const result = absencesRepo.saveBulk(db, absences, cycle, {
            validate(absence) {
                validateAbsenceRow(absence);
            },
            audit(summary) {
                writeImportAudit(
                    db,
                    'absences',
                    buildImportAuditDetails(
                        { label: 'غياب', count: summary.count, skipped: summary.skippedOtherCycle },
                        absences[0]?.school_year,
                        cycle
                    )
                );
            }
        });
        return result;
    }, { withContext: true });
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
    handleWriteSoftAuth(ipcMain, 'absences:replaceByYear', WRITE_ROLES, ({ db, event }, schoolYear, absences, options) => {
        const year = requireSchoolYear(schoolYear);
        if (!Array.isArray(absences)) return { success: false, error: 'Expected an array' };
        if (absences.length > 5000) return { success: false, error: 'Batch size exceeds maximum of 5000' };
        const cycle = resolveCycleForRequest(db, event);
        const result = absencesRepo.replaceByYear(db, year, absences, cycle, {
            validate(absence) {
                validateAbsenceRow(absence, year);
            },
            audit(summary) {
                writeImportAudit(
                    db,
                    'absences',
                    buildImportAuditDetails(
                        { label: 'غياب', count: summary.count, deleted: summary.deleted, skipped: summary.skippedOtherCycle },
                        year,
                        cycle
                    )
                );
            },
            confirm: !!(options && options.confirm === true)
        });
        return result;
    }, { withContext: true });
}

module.exports = { registerAbsencesIpc, validateAbsenceRow, validateAbsenceMonth };
