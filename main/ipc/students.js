'use strict';

const { handleRead, handleWrite, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { requireFields, normalizePagination, buildPaginatedResult } = require('./validation');
const studentsRepo = require('../repos/students');

function mapStudentAliases(row) {
    if (!row) return null;
    return {
        ...row,
        massar_code: row.code,
        class_name: row.section
    };
}

function registerStudentsIpc(ipcMain) {
    handleRead(ipcMain, 'students:getAll', (db, schoolYear) => {
        return studentsRepo.listByYear(db, normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'students:list', (db, schoolYear, options = {}) => {
        const year = normalizeYear(schoolYear);
        const { page, pageSize, offset } = normalizePagination(options);
        const { total, rows } = studentsRepo.listPaginated(db, year, pageSize, offset);
        return buildPaginatedResult(rows, total, page, pageSize);
    });

    handleRead(ipcMain, 'students:getCodesByYear', (db, schoolYear) => {
        return studentsRepo.getCodesByYear(db, normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'students:getByCode', (db, code, schoolYear) => {
        const year = normalizeYear(schoolYear);
        const codeQ = String(code || '').trim();
        if (!codeQ) return null;
        return mapStudentAliases(studentsRepo.getByCode(db, codeQ, year));
    });

    handleRead(ipcMain, 'students:search', (db, name, className, code, schoolYear) => {
        const year = normalizeYear(schoolYear);
        const rows = studentsRepo.search(db, year, { name, className, code });
        return rows.map(mapStudentAliases);
    });

    handleWrite(ipcMain, 'students:add', WRITE_ROLES, (db, _event, student) => {
        requireFields(student, ['code', 'full_name', 'school_year']);
        requireSchoolYear(student.school_year);
        studentsRepo.insertOne(db, student);
        return { success: true };
    });

    // No auth: bulk-import is used by settings-imports page before login
    handleWriteSoftAuth(ipcMain, 'students:addBulk', WRITE_ROLES, (db, students) => {
        if (!Array.isArray(students)) {
            return { success: false, error: 'Expected an array' };
        }
        if (students.length > 5000) {
            return { success: false, error: 'Batch size exceeds maximum of 5000' };
        }
        return studentsRepo.addBulk(db, students, {
            validate(student) {
                requireFields(student, ['code', 'full_name', 'school_year']);
                requireSchoolYear(student.school_year);
            }
        });
    }, { allowNoSession: true });

    handleWrite(ipcMain, 'students:update', WRITE_ROLES, (db, _event, id, data) => {
        if (Object.prototype.hasOwnProperty.call(data || {}, 'school_year')) {
            requireSchoolYear(data.school_year);
        }
        return studentsRepo.updateById(db, id, data);
    });

    handleWrite(ipcMain, 'students:delete', WRITE_ROLES, (db, _event, id) => {
        return studentsRepo.deleteById(db, id);
    });

    handleWriteSoftAuth(ipcMain, 'students:deleteByYear', WRITE_ROLES, (db, schoolYear) => {
        const year = requireSchoolYear(schoolYear);
        const count = studentsRepo.deleteByYear(db, year);
        return { success: true, count };
    });

    handleRead(ipcMain, 'students:getByStatus', (db, filters) => {
        filters = filters || {};
        const year = normalizeYear(filters.schoolYear);
        const { rows, summary } = studentsRepo.getByStatus(db, year, filters);
        return { success: true, rows, summary };
    });

    handleWriteSoftAuth(ipcMain, 'students:updateStatusBulk', WRITE_ROLES, (db, items) => {
        if (!Array.isArray(items)) {
            return { success: false, error: 'Expected an array' };
        }
        if (items.length > 500) {
            return { success: false, error: 'Batch size exceeds maximum of 500' };
        }
        const count = studentsRepo.updateStatusBulk(db, items);
        return { success: true, count };
    });
}

module.exports = { registerStudentsIpc };
