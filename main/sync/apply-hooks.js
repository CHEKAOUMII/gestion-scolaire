'use strict';

/**
 * Registers entity apply hooks on the canonical registry (WP9).
 * Called once at sync engine load.
 */

const { setApplyHooks } = require('./entity-registry');
const { getCycleDefinition } = require('../../js/shared/education/cycles');

function resolveStudentFkBeforePut(db, item, ctx) {
    const studentCode = String(item.data?.student_code || '').trim();
    const schoolYear = String(item.data?.school_year || item.schoolYear || '').trim();
    const studentId = ctx.resolveStudentId(db, studentCode, schoolYear);

    if (studentId == null) {
        if (!ctx.isDeferred) {
            if (item.tableName === 'grades') {
                ctx.deferredGrades.push(item);
            } else {
                ctx.deferredAbsences.push(item);
            }
            return { defer: true };
        }
        return {
            fail: `Failed to resolve student_id for ${item.tableName} (student_code='${studentCode}', school_year='${schoolYear || '-'}')`,
            extra: { studentCode, schoolYear: schoolYear || null }
        };
    }

    item.data = {
        ...item.data,
        student_id: studentId,
        student_code: studentCode,
        school_year: schoolYear
    };
    return null;
}

function resolveStudentFilesBeforePut(db, item, ctx) {
    const studentCode = String(item.data?.student_code || '').trim();
    const docKey = String(item.data?.doc_key || item.data?.file_id || '').trim();
    const schoolYear = String(item.data?.school_year || item.schoolYear || '').trim();
    const studentId = ctx.resolveStudentId(db, studentCode, schoolYear);

    if (studentId == null) {
        if (!ctx.isDeferred) {
            ctx.deferredStudentFiles.push(item);
            return { defer: true };
        }
        return {
            fail: `Failed to resolve student_id for student_files (student_code='${studentCode}', school_year='${schoolYear || '-'}')`,
            extra: { studentCode, schoolYear: schoolYear || null, docKey }
        };
    }

    item.data = { ...item.data, student_id: studentId, doc_key: docKey, school_year: schoolYear };
    delete item.data.student_code;
    delete item.data.file_id;
    return null;
}

function validateInstitutionCycleBeforePut(_db, item) {
    const definition = getCycleDefinition(item.data?.cycle_code);
    if (!definition) return { fail: 'Unknown institution cycle code' };
    item.data = {
        ...item.data,
        cycle_code: definition.cycleCode,
        seed_profile_version_hint: definition.seedProfileVersionHint,
        sort_order: definition.sortOrder,
        is_active: Number(item.data?.is_active) ? 1 : 0
    };
    return null;
}

function registerDefaultApplyHooks() {
    setApplyHooks('institution_cycles', { beforePut: validateInstitutionCycleBeforePut });
    setApplyHooks('grades', { beforePut: resolveStudentFkBeforePut });
    setApplyHooks('absences', { beforePut: resolveStudentFkBeforePut });
    setApplyHooks('student_files', { beforePut: resolveStudentFilesBeforePut });
}

module.exports = {
    registerDefaultApplyHooks,
    resolveStudentFkBeforePut,
    resolveStudentFilesBeforePut,
    validateInstitutionCycleBeforePut
};
