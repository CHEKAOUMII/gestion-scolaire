'use strict';

const {
    handleAuthedRead,
    handleWrite,
    handleWriteSoftAuth,
    normalizeYear,
    requireSchoolYear
} = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { requireFields, normalizePagination, buildPaginatedResult } = require('./validation');
const studentsRepo = require('../repos/students');
const { resolveCycleForRequest } = require('../auth/resolve-cycle');

function mapStudentAliases(row) {
    if (!row) return null;
    return {
        ...row,
        massar_code: row.code,
        class_name: row.section
    };
}

function registerStudentsIpc(ipcMain) {
    // Reads are session-aware: the cycle is resolved in main from the sender's context,
    // so a renderer cannot widen its own scope by passing a cycle (§13, §5.4).
    handleAuthedRead(ipcMain, 'students:getAll', ({ db, event }, schoolYear) => {
        return studentsRepo.listByYear(db, normalizeYear(schoolYear), resolveCycleForRequest(db, event));
    });

    handleAuthedRead(ipcMain, 'students:list', ({ db, event }, schoolYear, options = {}) => {
        const year = normalizeYear(schoolYear);
        const { page, pageSize, offset } = normalizePagination(options);
        const { total, rows } = studentsRepo.listPaginated(
            db,
            year,
            resolveCycleForRequest(db, event),
            pageSize,
            offset
        );
        return buildPaginatedResult(rows, total, page, pageSize);
    });

    handleAuthedRead(ipcMain, 'students:getCodesByYear', ({ db, event }, schoolYear) => {
        return studentsRepo.getCodesByYear(db, normalizeYear(schoolYear), resolveCycleForRequest(db, event));
    });

    handleAuthedRead(ipcMain, 'students:getByCode', ({ db, event }, code, schoolYear) => {
        const year = normalizeYear(schoolYear);
        const codeQ = String(code || '').trim();
        if (!codeQ) return null;
        // A code from another cycle resolves to nothing rather than to that cycle's row.
        return mapStudentAliases(studentsRepo.getByCode(db, codeQ, year, resolveCycleForRequest(db, event)));
    });

    handleAuthedRead(ipcMain, 'students:search', ({ db, event }, name, className, code, schoolYear) => {
        const year = normalizeYear(schoolYear);
        const rows = studentsRepo.search(db, year, resolveCycleForRequest(db, event), { name, className, code });
        return rows.map(mapStudentAliases);
    });

    handleAuthedRead(ipcMain, 'students:getByStatus', ({ db, event }, filters) => {
        filters = filters || {};
        const year = normalizeYear(filters.schoolYear);
        const { rows, summary } = studentsRepo.getByStatus(db, year, resolveCycleForRequest(db, event), filters);
        return { success: true, rows, summary };
    });

    handleWrite(ipcMain, 'students:add', WRITE_ROLES, (db, event, student) => {
        requireFields(student, ['code', 'full_name', 'school_year']);
        requireSchoolYear(student.school_year);
        studentsRepo.insertOne(db, student, resolveCycleForRequest(db, event));
        return { success: true };
    });

    // No auth: bulk-import is used by settings-imports page before login. Without a
    // session the cycle must be unambiguous — resolveCycleForRequest refuses rather than
    // filing the whole import under a guessed cycle (D4).
    handleWriteSoftAuth(
        ipcMain,
        'students:addBulk',
        WRITE_ROLES,
        ({ db, event }, students) => {
            if (!Array.isArray(students)) {
                return { success: false, error: 'Expected an array' };
            }
            if (students.length > 5000) {
                return { success: false, error: 'Batch size exceeds maximum of 5000' };
            }
            return studentsRepo.addBulk(db, students, resolveCycleForRequest(db, event), {
                validate(student) {
                    requireFields(student, ['code', 'full_name', 'school_year']);
                    requireSchoolYear(student.school_year);
                }
            });
        },
        { allowNoSession: true, withContext: true }
    );

    handleWrite(ipcMain, 'students:update', WRITE_ROLES, (db, event, id, data) => {
        if (Object.prototype.hasOwnProperty.call(data || {}, 'school_year')) {
            requireSchoolYear(data.school_year);
        }
        return studentsRepo.updateById(db, id, data, resolveCycleForRequest(db, event));
    });

    handleWrite(ipcMain, 'students:delete', WRITE_ROLES, (db, event, id) => {
        return studentsRepo.deleteById(db, id, resolveCycleForRequest(db, event));
    });

    // Year-scoped delete is also cycle-scoped: without that, clearing "a year" from one
    // cycle would take the other cycle's students and their grades with it.
    handleWriteSoftAuth(
        ipcMain,
        'students:deleteByYear',
        WRITE_ROLES,
        ({ db, event }, schoolYear) => {
            const year = requireSchoolYear(schoolYear);
            const count = studentsRepo.deleteByYear(db, year, resolveCycleForRequest(db, event));
            return { success: true, count };
        },
        { withContext: true }
    );

    handleWriteSoftAuth(
        ipcMain,
        'students:updateStatusBulk',
        WRITE_ROLES,
        ({ db, event }, items) => {
            if (!Array.isArray(items)) {
                return { success: false, error: 'Expected an array' };
            }
            if (items.length > 500) {
                return { success: false, error: 'Batch size exceeds maximum of 500' };
            }
            const count = studentsRepo.updateStatusBulk(db, items, resolveCycleForRequest(db, event));
            return { success: true, count };
        },
        { withContext: true }
    );
}

module.exports = { registerStudentsIpc };
