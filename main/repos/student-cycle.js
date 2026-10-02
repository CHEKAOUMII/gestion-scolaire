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

/**
 * Tables whose pulled rows must match their owner student's cycle (Slice 1).
 * grades/absences keep their existing single-column contract; these four carry
 * the composite (student_id, cycle_code) owner FK since migration 087.
 */
const STUDENT_CHILD_SYNC_TABLES = ['correspondence', 'student_files', 'student_movements', 'student_profile_data'];

/**
 * Sync/ingestion-layer child→owner consistency check (Slice 1, mirrors
 * checkCycleProfileConsistency's contract so the engine can route failures to
 * recordPullQuarantine without half-writing).
 *
 * The owner is resolved by student_code + school_year — the stable sync
 * identity — never by the pulled student_id, which is the pushing device's
 * local row id and meaningless here. student_id is consulted only when the
 * payload carries no code. KNOWN LIMITATION: student_movements syncs a raw
 * student_id with no student_code (pre-existing identity design), so for that
 * table the id is only as stable as the sender/receiver id alignment — the
 * composite owner FK on the local table enforces the same predicate at write
 * time, so a misaligned id fails closed either way. Giving movements a stable
 * student_code identity is a sync-contract change (separate slice).
 *
 * Returns null when the row may be applied, else { reason, extra? }.
 * Missing cycle_code returns null: presence is owned by checkLocalContract
 * (§9.2). A missing owner also returns null: not-yet-arrived students stay on
 * the existing missing-dependency/defer path instead of quarantine-looping.
 */
function checkStudentChildCycleConsistency(db, item) {
    if (!item || item.operation !== 'PUT') return null;
    if (!STUDENT_CHILD_SYNC_TABLES.includes(item.tableName)) return null;
    const data = item.data || {};
    const cycle = String(data.cycle_code || '').trim();
    if (!cycle) return null;
    if (!getCycleDefinition(cycle)) {
        return { reason: `سجل وارد بدورة تعليمية غير معروفة في ${item.tableName}: ${cycle}`, extra: { cycleCode: cycle } };
    }
    const schoolYear = String(data.school_year || item.schoolYear || '').trim();
    let owner = null;
    const code = String(data.student_code || '').trim();
    if (code && schoolYear) owner = findStudentOwner(db, code, schoolYear);
    if (!owner && data.student_id != null && schoolYear) owner = findStudentById(db, data.student_id, schoolYear);
    if (!owner) return null;
    if (String(owner.cycle_code || '').trim() !== cycle) {
        return {
            reason: `سجل وارد بدورة لا تطابق دورة التلميذ المالك في ${item.tableName}: ${cycle} ≠ ${owner.cycle_code}`,
            extra: { cycleCode: cycle, ownerCycleCode: owner.cycle_code, studentCode: owner.code }
        };
    }
    return null;
}

module.exports = { requireCycle, findStudentOwner, findStudentById, resolveStudentOwnership, resolveStudentForCycle, STUDENT_CHILD_SYNC_TABLES, checkStudentChildCycleConsistency };
