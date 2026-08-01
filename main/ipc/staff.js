'use strict';

const { handleAuthedRead, handleRead, handleWrite, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { requireFields } = require('./validation');
const staffRepo = require('../repos/staff');
const { resolveCycleForRequest } = require('../auth/resolve-cycle');

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
        return staffRepo.importBulk(db, teachers, {
            validateSchoolYear: (year) => requireSchoolYear(year)
        });
    }, { allowNoSession: true });

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
