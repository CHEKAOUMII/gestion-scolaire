'use strict';

const { getCycleDefinition } = require('../../js/shared/education/cycles');

/**
 * Resolve a child record's owner from the authoritative student row.
 * Child payloads never determine either the student id or education cycle.
 */
function requireCycle(cycleCode) {
    const cycle = String(cycleCode || '').trim();
    if (!cycle) throw new Error('السلك التعليمي غير محدد لهذه العملية');
    const definition = getCycleDefinition(cycle);
    if (!definition) throw new Error('السلك التعليمي غير معروف');
    if (definition.capability !== 'supported') {
        throw new Error('هذا السلك قيد الإعداد وغير متاح للعمل بعد');
    }
    return cycle;
}

function findStudentOwner(db, studentCode, schoolYear) {
    const code = String(studentCode || '').trim();
    return (
        db
            .prepare(
                `SELECT id, code, cycle_code
                 FROM students
                 WHERE code = ? AND school_year = ?
                 LIMIT 1`
            )
            .get(code, schoolYear) || null
    );
}

/** Owner lookup by row id (student_id-carrying payloads, e.g. student_files). */
function findStudentById(db, studentId, schoolYear) {
    const id = Number(studentId);
    if (!Number.isFinite(id) || id <= 0) return null;
    return (
        db
            .prepare(
                `SELECT id, code, cycle_code
                 FROM students
                 WHERE id = ? AND school_year = ?
                 LIMIT 1`
            )
            .get(id, schoolYear) || null
    );
}

/**
 * Owner lookup for bulk writes.
 *
 * Two failures are deliberately distinguished, because they mean different things to
 * the person running an import:
 *
 *   - **unknown code** → the file references a student who does not exist for that year.
 *     This is malformed input and keeps the pre-cycle behavior: the caller throws.
 *   - **foreign cycle** → the student exists but studies in another cycle. This is a
 *     boundary, not a data error. A Massar export covering the whole institution will
 *     contain both cycles, so the row is reported and skipped instead of failing the
 *     entire batch and leaving the user with nothing imported.
 *
 * @returns {{ student: object|null, foreignCycle: boolean }}
 */
function resolveStudentOwnership(db, studentCode, schoolYear, cycleCode) {
    const cycle = requireCycle(cycleCode);
    const student = findStudentOwner(db, studentCode, schoolYear);
    if (!student) return { student: null, foreignCycle: false };
    if (student.cycle_code !== cycle) return { student, foreignCycle: true };
    return { student, foreignCycle: false };
}

/**
 * Strict owner lookup for single-row writes, where silently doing nothing would be
 * worse than an error: the user asked to save one specific record.
 */
function resolveStudentForCycle(db, studentCode, schoolYear, cycleCode) {
    const code = String(studentCode || '').trim();
    const { student, foreignCycle } = resolveStudentOwnership(db, code, schoolYear, cycleCode);
    if (!student) {
        throw new Error(`لا يوجد تلميذ بالرمز ${code} في السنة الدراسية المحددة`);
    }
    if (foreignCycle) {
        throw new Error(`التلميذ بالرمز ${code} لا ينتمي إلى السلك التعليمي النشط`);
    }
    return student;
}

module.exports = { requireCycle, findStudentOwner, findStudentById, resolveStudentOwnership, resolveStudentForCycle };
