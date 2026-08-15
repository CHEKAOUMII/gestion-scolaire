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
const { writeImportAudit, buildImportAuditDetails } = require('./import-audit');

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

    // Bulk roster/status import is a school-data write: a session and a write role
    // are required (import-pipeline review F2 — no pre-login imports). The cycle is
    // still resolved from the session in main; resolveCycleForRequest refuses rather
    // than filing the whole import under a guessed cycle (D4).
    handleWriteSoftAuth(
        ipcMain,
        'students:addBulk',
        WRITE_ROLES,
        ({ db, event }, students, auditType) => {
            if (!Array.isArray(students)) {
                return { success: false, error: 'Expected an array' };
            }
            if (students.length > 5000) {
                return { success: false, error: 'Batch size exceeds maximum of 5000' };
            }
            // The bulk channel serves both the students import and the student-status
            // import (js/pages/settings-imports.js). The audit label must reflect the
            // import kind, but only a whitelisted value from main is accepted — the
            // renderer can never pick an arbitrary audit action.
            const auditKind = auditType === 'student-status' ? 'student-status' : 'students';
            const year = Array.isArray(students) && students[0] ? students[0].school_year : null;
            const cycleCode = resolveCycleForRequest(db, event);
            const result = studentsRepo.addBulk(db, students, cycleCode, {
                validate(student) {
                    requireFields(student, ['code', 'full_name', 'school_year']);
                    requireSchoolYear(student.school_year);
                    if (Object.prototype.hasOwnProperty.call(student, 'status') && !studentsRepo.VALID_STATUSES.includes(String(student.status || '').trim())) {
                        throw new Error('وضعية التلميذ غير صالحة');
                    }
                },
                audit(summary) {
                    writeImportAudit(
                        db,
                        auditKind,
                        buildImportAuditDetails(
                            { label: auditKind === 'student-status' ? 'وضعية' : 'تلميذ', count: summary.count },
                            year,
                            cycleCode
                        )
                    );
                }
            });
            return result;
        },
        { withContext: true }
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
