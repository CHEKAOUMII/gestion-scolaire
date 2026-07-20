'use strict';

const { handleRead, handleWrite, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { requireFields, validateRange, normalizePagination, buildPaginatedResult } = require('./validation');
const { normalizeSubjectName } = require('../../js/data/ma-education-labels');
const { resolveTeacherIdentity } = require('../teachers/identity');
const gradesRepo = require('../repos/grades');

function registerGradesIpc(ipcMain) {
    handleRead(ipcMain, 'grades:getAll', (db, schoolYear) => {
        return gradesRepo.listByYear(db, normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'grades:list', (db, schoolYear, options = {}) => {
        const year = normalizeYear(schoolYear);
        const { page, pageSize, offset } = normalizePagination(options);
        const { total, rows } = gradesRepo.listPaginated(db, year, {
            className: options.className,
            section: options.section,
            subject: options.subject,
            semester: options.semester,
            pageSize,
            offset
        });
        return buildPaginatedResult(rows, total, page, pageSize);
    });

    handleRead(ipcMain, 'grades:getByStudentCode', (db, studentCode, schoolYear) => {
        return gradesRepo.getByStudentCode(db, studentCode, normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'grades:getZeroStudents', (db, filters) => {
        filters = filters || {};
        const year = String(normalizeYear(filters.schoolYear)).trim();
        const result = gradesRepo.getZeroStudents(db, year, filters);
        return { success: true, ...result };
    });

    handleWrite(ipcMain, 'grades:save', WRITE_ROLES, (db, _event, grade) => {
        validateRange('grade', grade.grade, 0, 20);
        requireSchoolYear(grade.school_year);
        const resolvedTeacher = resolveTeacherIdentity(db, {
            teacher_id: grade.teacher_id,
            teacher_name: grade.teacher_name,
            school_year: grade.school_year,
            source: 'grades:save'
        });
        return gradesRepo.saveOne(db, {
            student_id: grade.student_id,
            student_code: grade.student_code,
            teacher_id: resolvedTeacher.teacher_id || null,
            subject: grade.subject,
            grade: grade.grade,
            semester: grade.semester,
            teacher_name: resolvedTeacher.teacher_name || grade.teacher_name || '',
            level: grade.level || '',
            section: grade.section || '',
            school_year: grade.school_year
        });
    });

    handleWriteSoftAuth(ipcMain, 'grades:saveBulk', WRITE_ROLES, (db, grades) => {
        if (!Array.isArray(grades)) {
            return { success: false, error: 'Expected an array' };
        }
        if (grades.length > 5000) {
            return { success: false, error: 'Batch size exceeds maximum of 5000' };
        }
        return gradesRepo.saveBulk(db, grades, {
            resolveRow(grade) {
                requireFields(grade, ['student_code', 'subject', 'semester', 'school_year']);
                requireSchoolYear(grade.school_year);
                validateRange('grade', grade.grade, 0, 20);
                const resolvedTeacher = resolveTeacherIdentity(db, {
                    teacher_id: grade.teacher_id,
                    teacher_name: grade.teacher_name,
                    school_year: grade.school_year,
                    source: 'grades:saveBulk'
                });
                return {
                    student_id: grade.student_id,
                    student_code: grade.student_code,
                    teacher_id: resolvedTeacher.teacher_id || null,
                    subject: grade.subject,
                    grade: grade.grade,
                    semester: grade.semester,
                    teacher_name: resolvedTeacher.teacher_name || grade.teacher_name || '',
                    level: grade.level || '',
                    section: grade.section || '',
                    school_year: grade.school_year
                };
            }
        });
    }, { allowNoSession: true });

    handleWriteSoftAuth(ipcMain, 'grades:reassignTeacherBulk', WRITE_ROLES, (db, payload) => {
        const year = requireSchoolYear(payload?.school_year || payload?.schoolYear);
        const changes = Array.isArray(payload?.changes) ? payload.changes : [];
        if (!changes.length) {
            return { success: false, error: 'No changes to apply' };
        }
        if (changes.length > 1000) {
            return { success: false, error: 'Too many changes in one request' };
        }

        return gradesRepo.reassignTeacherBulk(db, year, changes, {
            normalizeSubject: normalizeSubjectName,
            resolveTeacher(dbConn, item, schoolYear) {
                return resolveTeacherIdentity(dbConn, {
                    teacher_id: item?.to_teacher_id,
                    teacher_name: item?.to_teacher_name,
                    school_year: schoolYear,
                    source: 'grades:reassignTeacherBulk'
                });
            }
        });
    });

    handleWriteSoftAuth(ipcMain, 'grades:deleteByYear', WRITE_ROLES, (db, schoolYear) => {
        const year = requireSchoolYear(schoolYear);
        const count = gradesRepo.deleteByYear(db, year);
        return { success: true, count };
    });

    handleWriteSoftAuth(ipcMain, 'grades:deleteBySemester', WRITE_ROLES, (db, schoolYear, semester) => {
        const year = requireSchoolYear(schoolYear);
        const count = gradesRepo.deleteBySemester(db, year, semester);
        return { success: true, count };
    });
}

module.exports = { registerGradesIpc };
