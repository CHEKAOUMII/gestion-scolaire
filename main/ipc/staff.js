'use strict';

const { handleRead, handleWrite, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { requireFields } = require('./validation');
const staffRepo = require('../repos/staff');

function registerStaffIpc(ipcMain) {
    handleRead(ipcMain, 'teachers:getAll', (db, schoolYear) => {
        return staffRepo.listByYear(db, normalizeYear(schoolYear));
    });

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
