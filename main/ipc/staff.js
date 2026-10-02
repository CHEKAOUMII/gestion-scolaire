'use strict';

const { handleAuthedRead, handleRead, handleWrite, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { requireFields } = require('./validation');
const staffRepo = require('../repos/staff');
const { resolveCycleForRequest } = require('../auth/resolve-cycle');
const { writeImportAudit, buildImportAuditDetails } = require('./import-audit');

const TEACHER_IMPORT_MAX_BATCH = 5000;
const TEACHER_FIELD_MAX_LENGTH = 500;
const TEACHER_BOUNDED_FIELDS = ['full_name', 'full_name_fr'];

function registerStaffIpc(ipcMain) {
    handleRead(ipcMain, 'teachers:getAll', (db, schoolYear) => {
        return staffRepo.listByYear(db, normalizeYear(schoolYear));
    });

    handleAuthedRead(ipcMain, 'teachers:getScoped', ({ db, event, session }, schoolYear, options = {}) => {
        const cycleCode = resolveCycleForRequest(db, event);
        const isManager = ['admin', 'principal', 'developer'].includes(String(session?.role || '').toLowerCase());
        return staffRepo.listByYearAndCycle(db, normalizeYear(schoolYear), cycleCode, {
            includeReview: isManager && options.includeReview === true
        });
    });

    handleAuthedRead(ipcMain, 'teachers:getAssignments', ({ db, event, session }, schoolYear, options = {}) => {
        const cycleCode = resolveCycleForRequest(db, event);
        const isManager = ['admin', 'principal', 'developer'].includes(String(session?.role || '').toLowerCase());
        return staffRepo.listTeachingAssignments(db, normalizeYear(schoolYear), cycleCode, {
            confidence: isManager ? options.confidence : 'confirmed',
            activeOnly: isManager ? options.activeOnly : true,
            includeReview: isManager && options.includeReview === true
        });
    });

    handleAuthedRead(ipcMain, 'teachers:getReviewQueue', ({ db, event, session }, schoolYear) => {
        const role = String(session?.role || '').toLowerCase();
        if (!['admin', 'principal', 'developer'].includes(role)) return [];
        return staffRepo.listTeacherAssignmentReviewQueue(db, normalizeYear(schoolYear), resolveCycleForRequest(db, event));
    });

    handleWriteSoftAuth(ipcMain, 'teachers:reviewAssignment', ['admin', 'principal', 'developer'], ({ db, session }, payload) => {
        if (payload?.school_year) requireSchoolYear(payload.school_year);
        return staffRepo.reviewTeachingAssignment(db, payload, {
            role: session?.role,
            userId: session?.userId
        });
    }, { withContext: true });

    handleWriteSoftAuth(ipcMain, 'teachers:resolveAssignmentReview', ['admin', 'principal', 'developer'], ({ db, event, session }, payload) => {
        if (payload?.school_year) requireSchoolYear(payload.school_year);
        return staffRepo.resolveUnresolvedGradeAssignment(db, payload, {
            role: session?.role,
            userId: session?.userId,
            cycleCode: resolveCycleForRequest(db, event)
        });
    }, { withContext: true });

    handleWriteSoftAuth(ipcMain, 'teachers:setScope', ['admin', 'principal', 'developer'], ({ db, session }, payload) => {
        return staffRepo.setTeacherScope(db, payload?.teacher_id, payload?.scope_type, {
            role: session?.role,
            userId: session?.userId
        });
    }, { withContext: true });

    handleWrite(ipcMain, 'teachers:add', WRITE_ROLES, (db, _event, teacher) => {
        requireFields(teacher, ['full_name', 'school_year']);
        requireSchoolYear(teacher.school_year);
        return staffRepo.addTeacher(db, teacher);
    });

    handleWrite(ipcMain, 'teachers:update', WRITE_ROLES, (db, _event, id, data) => {
        return staffRepo.updateTeacher(db, id, data, {
            onSchoolYear: (year) => requireSchoolYear(year)
        });
    });

    handleWrite(ipcMain, 'teachers:delete', ['admin'], (db, _event, id) => {
        return staffRepo.deleteTeacher(db, id);
    });

    handleWriteSoftAuth(ipcMain, 'teachers:deleteByYear', ['admin'], (db, schoolYear) => {
        const year = requireSchoolYear(schoolYear);
        return staffRepo.deleteByYear(db, year);
    });

    handleWriteSoftAuth(ipcMain, 'teachers:saveTafwijAliases', WRITE_ROLES, (db, payload) => {
        const schoolYear = requireSchoolYear(payload?.school_year);
        return staffRepo.saveTafwijAliases(db, payload, schoolYear);
    });

    handleWriteSoftAuth(ipcMain, 'teachers:importBulk', WRITE_ROLES, (db, teachers) => {
        if (!Array.isArray(teachers)) {
            return { success: false, error: 'Expected an array' };
        }
        if (teachers.length > TEACHER_IMPORT_MAX_BATCH) {
            return { success: false, error: `Batch size exceeds maximum of ${TEACHER_IMPORT_MAX_BATCH}` };
        }
        // Fail-closed row validation before the repo transaction: one malformed row
        // rejects the whole batch instead of being silently skipped (F6).
        for (let i = 0; i < teachers.length; i++) {
            const teacher = teachers[i];
            if (!teacher || typeof teacher !== 'object' || Array.isArray(teacher)) {
                return { success: false, error: `Invalid teacher row at index ${i + 1}` };
            }
            try {
                requireFields(teacher, ['full_name', 'school_year']);
            } catch (err) {
                return { success: false, error: `Invalid teacher row at index ${i + 1}: ${err.message}` };
            }
            for (const field of TEACHER_BOUNDED_FIELDS) {
                if (typeof teacher[field] === 'string' && teacher[field].length > TEACHER_FIELD_MAX_LENGTH) {
                    return { success: false, error: `Field ${field} exceeds ${TEACHER_FIELD_MAX_LENGTH} characters at row ${i + 1}` };
                }
            }
        }
        const result = staffRepo.importBulk(db, teachers, {
            validateSchoolYear: (year) => requireSchoolYear(year),
            audit(summary) {
                writeImportAudit(
                    db,
                    'agent-xml',
                    buildImportAuditDetails({ label: 'أستاذا', count: summary.count }, teachers[0].school_year)
                );
            }
        });
        return result;
    });

    handleRead(ipcMain, 'teachers:getNameAliases', (db, entityType, schoolYear) => {
        return staffRepo.listNameAliases(db, entityType, schoolYear);
    });

    handleWrite(ipcMain, 'teachers:saveNameAlias', WRITE_ROLES, (db, _event, payload) => {
        requireFields(payload, ['entity_type', 'canonical_id', 'alias_text', 'alias_normalized', 'source']);
        return staffRepo.saveNameAlias(db, payload);
    });

    handleWrite(ipcMain, 'teachers:deleteNameAlias', WRITE_ROLES, (db, _event, id) => {
        return staffRepo.deleteNameAlias(db, id);
    });
}

module.exports = { registerStaffIpc };
