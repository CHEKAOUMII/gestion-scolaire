'use strict';

const { handleAuthedRead, handleWrite, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const { requireFields, validateRange, normalizePagination, buildPaginatedResult } = require('./validation');
const { normalizeSubjectName } = require('../../js/data/ma-education-labels');
const { resolveTeacherIdentity } = require('../teachers/identity');
const { resolveCycleForRequest } = require('../auth/resolve-cycle');
const gradesRepo = require('../repos/grades');
const staffRepo = require('../repos/staff');
const studentsRepo = require('../repos/students');
const { normalizeStudentCode } = require('../../js/import-center/grades-import-parser');

const WRITE_ROLES = ALLOWED_ROLES.filter((role) => role !== 'viewer');

/**
 * Validate shape and resolve student references for a bulk grade import.
 *
 * Malformed rows still throw — they mean the file is wrong. Rows belonging to another
 * cycle are separated out and returned so the repository can report them, because a
 * whole-institution export legitimately contains both cycles and must not cost the user
 * the rows they can actually import.
 *
 * @returns {{ rows: object[], skippedOtherCycle: object[] }}
 */
function validateBulkStudentReferences(db, grades, cycleCode) {
    const studentsByYear = new Map();
    const rows = [];
    const skippedOtherCycle = [];

    grades.forEach((grade, index) => {
        requireFields(grade, ['student_code', 'subject', 'semester', 'school_year']);
        const schoolYear = requireSchoolYear(grade.school_year);
        validateRange('grade', grade.grade, 0, 20);
        if (![1, 2].includes(Number(grade.semester))) throw new Error(`semester must be 1 or 2 at row ${index + 1}`);
        const studentCode = normalizeStudentCode(grade.student_code);
        if (!studentCode) throw new Error(`student_code is required at row ${index + 1}`);
        if (!studentsByYear.has(schoolYear)) {
            studentsByYear.set(schoolYear, {
                inCycle: new Map(
                    studentsRepo
                        .listCodeIndexByYear(db, schoolYear, cycleCode)
                        .map((student) => [normalizeStudentCode(student.code), student])
                        .filter(([code]) => code)
                ),
                anyCycle: new Set(
                    studentsRepo.listCodesByYearAnyCycle(db, schoolYear).map(normalizeStudentCode).filter(Boolean)
                )
            });
        }
        const index_ = studentsByYear.get(schoolYear);
        const student = index_.inCycle.get(studentCode);
        if (student) {
            rows.push({ ...grade, student_id: student.id, student_code: studentCode, school_year: schoolYear });
            return;
        }
        if (index_.anyCycle.has(studentCode)) {
            skippedOtherCycle.push({ student_code: studentCode, school_year: schoolYear });
            return;
        }
        throw new Error(`لا يوجد تلميذ بالرمز ${studentCode} في السنة الدراسية المحددة`);
    });

    return { rows, skippedOtherCycle };
}

function registerGradesIpc(ipcMain) {
    handleAuthedRead(ipcMain, 'grades:getAll', ({ db, event }, schoolYear) =>
        gradesRepo.listByYear(db, normalizeYear(schoolYear), resolveCycleForRequest(db, event))
    );
    handleAuthedRead(ipcMain, 'grades:list', ({ db, event }, schoolYear, options = {}) => {
        const { page, pageSize, offset } = normalizePagination(options);
        const { total, rows } = gradesRepo.listPaginated(db, normalizeYear(schoolYear), resolveCycleForRequest(db, event), {
            className: options.className,
            section: options.section,
            subject: options.subject,
            semester: options.semester,
            pageSize,
            offset
        });
        return buildPaginatedResult(rows, total, page, pageSize);
    });
    handleAuthedRead(ipcMain, 'grades:getByStudentCode', ({ db, event }, studentCode, schoolYear) =>
        gradesRepo.getByStudentCode(db, studentCode, normalizeYear(schoolYear), resolveCycleForRequest(db, event))
    );
    handleAuthedRead(ipcMain, 'grades:getZeroStudents', ({ db, event }, filters = {}) => ({
        success: true,
        ...gradesRepo.getZeroStudents(db, normalizeYear(filters.schoolYear), resolveCycleForRequest(db, event), filters)
    }));

    handleWrite(ipcMain, 'grades:save', WRITE_ROLES, (db, event, grade) => {
        validateRange('grade', grade.grade, 0, 20);
        requireSchoolYear(grade.school_year);
        const teacher = resolveTeacherIdentity(db, { teacher_id: grade.teacher_id, teacher_name: grade.teacher_name, school_year: grade.school_year, source: 'grades:save' });
        return gradesRepo.saveOne(db, {
            ...grade,
            teacher_id: teacher.teacher_id || null,
            teacher_name: teacher.teacher_name || grade.teacher_name || '',
            teacher_resolution: teacher.ambiguous ? 'ambiguous' : teacher.teacher_id ? 'resolved' : 'unresolved',
            level: grade.level || '',
            section: grade.section || ''
        }, resolveCycleForRequest(db, event));
    });
    handleWriteSoftAuth(ipcMain, 'grades:saveBulk', WRITE_ROLES, ({ db, event }, grades) => {
        if (!Array.isArray(grades)) return { success: false, error: 'Expected an array' };
        if (grades.length > 5000) return { success: false, error: 'Batch size exceeds maximum of 5000' };
        const cycle = resolveCycleForRequest(db, event);
        const { rows, skippedOtherCycle } = validateBulkStudentReferences(db, grades, cycle);
        const result = gradesRepo.saveBulk(db, rows, cycle, {
            resolveRow(grade) {
                const teacher = resolveTeacherIdentity(db, { teacher_id: grade.teacher_id, teacher_name: grade.teacher_name, school_year: grade.school_year, source: 'grades:saveBulk' });
                return {
                    ...grade,
                    teacher_id: teacher.teacher_id || null,
                    teacher_name: teacher.teacher_name || grade.teacher_name || '',
                    teacher_resolution: teacher.ambiguous ? 'ambiguous' : teacher.teacher_id ? 'resolved' : 'unresolved',
                    level: grade.level || '',
                    section: grade.section || ''
                };
            },
            onTeacherAssignments(dbConn, gradeRows, cycleCode) {
                return staffRepo.createAssignmentSuggestions(dbConn, gradeRows, cycleCode, {
                    inTransaction: true,
                    source: 'grades_import'
                });
            }
        });
        // Merge the rows filtered out before the repository ran with the ones its own
        // upsert guard refused, so the caller sees a single skip total.
        const skippedRows = [...skippedOtherCycle, ...(result.skippedRows || [])];
        return {
            ...result,
            assignmentSuggestions: result.assignmentResult || null,
            skippedOtherCycle: skippedRows.length,
            skippedRows
        };
    }, { allowNoSession: true, withContext: true });
    handleWriteSoftAuth(ipcMain, 'grades:reassignTeacherBulk', WRITE_ROLES, ({ db, event }, payload) => {
        const year = requireSchoolYear(payload?.school_year || payload?.schoolYear);
        const changes = Array.isArray(payload?.changes) ? payload.changes : [];
        if (!changes.length) return { success: false, error: 'No changes to apply' };
        if (changes.length > 1000) return { success: false, error: 'Too many changes in one request' };
        return gradesRepo.reassignTeacherBulk(db, year, resolveCycleForRequest(db, event), changes, {
            normalizeSubject: normalizeSubjectName,
            resolveTeacher(dbConn, item, schoolYear) {
                return resolveTeacherIdentity(dbConn, { teacher_id: item?.to_teacher_id, teacher_name: item?.to_teacher_name, school_year: schoolYear, source: 'grades:reassignTeacherBulk' });
            }
        });
    }, { withContext: true });
    handleWriteSoftAuth(ipcMain, 'grades:deleteByYear', WRITE_ROLES, ({ db, event }, schoolYear) => ({ success: true, count: gradesRepo.deleteByYear(db, requireSchoolYear(schoolYear), resolveCycleForRequest(db, event)) }), { withContext: true });
    handleWriteSoftAuth(ipcMain, 'grades:deleteBySemester', WRITE_ROLES, ({ db, event }, schoolYear, semester) => ({ success: true, count: gradesRepo.deleteBySemester(db, requireSchoolYear(schoolYear), semester, resolveCycleForRequest(db, event)) }), { withContext: true });
}

module.exports = { registerGradesIpc, validateBulkStudentReferences };
