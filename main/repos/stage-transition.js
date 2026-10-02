'use strict';

/**
 * Slice 6 transition seam (isolation plan §Slice 6): the single intentional
 * cross-stage path. All domain SQL lives here; IPC stays auth/validation only.
 *
 * Semantics bifurcate explicitly:
 *  (a) inter_year_progression — creates a NEW student row in toYear (compatible
 *      with UNIQUE(code, school_year)). Source-year history keeps its source
 *      cycle_code snapshot; no retroactive reclassification.
 *  (b) intra_year_reclassification — admin correction of a misfiled cycle:
 *      updates the row's cycle_code in place AND realigns already-written child
 *      rows (grades, absences, correspondence, student_files, student_movements,
 *      student_profile_data) in the same transaction, since the grades↔students
 *      join matches on student_id AND cycle_code.
 *
 * Both paths, in a single transaction with explicit outbox capture: one
 * student_stage_transitions record (UNIQUE idempotency_key for safe retries),
 * one companion student_movements record for timeline audit compatibility, and
 * one STAGE_TRANSITION audit row in system_logs.
 *
 * Guards: the actor must be authorized in BOTH cycles (asserted here, never
 * IPC-only — same rationale as the S6 row-129 guard), and both cycles must be
 * known + supported. student_orientation, staff_attendance and teacher_absences
 * are institution-wide by design and are never realigned.
 *
 * Sync contract: only registered-entity rows are captured (students, the child
 * tables, student_movements). The transition record and the STAGE_TRANSITION
 * audit are local-only, like system_logs (device-local audit precedent).
 */

const { captureResolvedRows, notifyCaptureCommitted } = require('./capture-port');
const { requireCycle } = require('./student-cycle');
const { assertCycleAuthorized } = require('../auth/cycle-access');
const { isKnownCycleCode } = require('../../js/shared/education/cycles');

const TRANSITION_TYPES = Object.freeze({
    INTER_YEAR: 'inter_year_progression',
    INTRA_YEAR: 'intra_year_reclassification'
});

const TRANSITION_ERROR_CODES = Object.freeze({
    INVALID_TRANSITION: 'INVALID_TRANSITION',
    STUDENT_NOT_FOUND: 'STUDENT_NOT_FOUND',
    TRANSITION_CONFLICT: 'TRANSITION_CONFLICT'
});

/**
 * Child tables carrying a cycle_code copy of their owner student. student_files
 * and student_movements have no student_code column, so they match by id only.
 */
const REALIGNABLE_CHILD_TABLES = Object.freeze([
    { table: 'grades', matchByCode: true },
    { table: 'absences', matchByCode: true },
    { table: 'correspondence', matchByCode: true },
    { table: 'student_files', matchByCode: false },
    { table: 'student_movements', matchByCode: false },
    { table: 'student_profile_data', matchByCode: true }
]);

const SCHOOL_YEAR_PATTERN = /^\d{4}\/\d{4}$/;
const DATE_PATTERN = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/;
// SQLite's default bound-parameter ceiling is 999; stay well under it per chunk.
const ID_CHUNK_SIZE = 500;

function transitionError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

/**
 * requireCycle plus a stable code: unknown/blank input is INVALID_TRANSITION
 * (bad request), a known-but-preview cycle is FORBIDDEN (not workable).
 */
function requireSupportedCycle(cycleCode) {
    try {
        return requireCycle(cycleCode);
    } catch (err) {
        if (err && err.code) throw err;
        const code = String(cycleCode || '').trim();
        throw transitionError(
            isKnownCycleCode(code) ? 'FORBIDDEN' : TRANSITION_ERROR_CODES.INVALID_TRANSITION,
            err ? err.message : 'السلك التعليمي غير محدد لهذه العملية'
        );
    }
}

function pickField(payload, keys) {
    for (const key of keys) {
        const value = payload[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
    }
    return '';
}

function normalizeTransferInput(input) {
    const payload = input && typeof input === 'object' ? input : {};
    const studentCode = pickField(payload, ['studentCode', 'student_code']);
    const fromYear = pickField(payload, ['fromYear', 'fromSchoolYear', 'from_school_year']);
    const toYear = pickField(payload, ['toYear', 'toSchoolYear', 'to_school_year']);
    const fromCycle = pickField(payload, ['fromCycle', 'fromCycleCode', 'from_cycle_code']);
    const toCycle = pickField(payload, ['toCycle', 'toCycleCode', 'to_cycle_code']);
    const transitionType = pickField(payload, ['transitionType', 'transition_type']);
    const idempotencyKey = pickField(payload, ['idempotencyKey', 'idempotency_key']);
    const effectiveDate = pickField(payload, ['effectiveDate', 'effective_date']);
    const reason = payload.reason == null ? '' : String(payload.reason).trim();

    if (!studentCode) {
        throw transitionError(TRANSITION_ERROR_CODES.INVALID_TRANSITION, 'رمز التلميذ مطلوب لعملية الانتقال');
    }
    if (!SCHOOL_YEAR_PATTERN.test(fromYear) || !SCHOOL_YEAR_PATTERN.test(toYear)) {
        throw transitionError('INVALID_SCHOOL_YEAR', 'السنة الدراسية يجب أن تكون بصيغة YYYY/YYYY (مثال: 2024/2025)');
    }
    if (transitionType !== TRANSITION_TYPES.INTER_YEAR && transitionType !== TRANSITION_TYPES.INTRA_YEAR) {
        throw transitionError(TRANSITION_ERROR_CODES.INVALID_TRANSITION, 'نوع الانتقال غير معروف');
    }
    if (!idempotencyKey) {
        throw transitionError(TRANSITION_ERROR_CODES.INVALID_TRANSITION, 'مفتاح عدم التكرار مطلوب لعملية الانتقال');
    }
    if (!DATE_PATTERN.test(effectiveDate)) {
        throw transitionError(
            TRANSITION_ERROR_CODES.INVALID_TRANSITION,
            'التاريخ الفعلي للانتقال غير صالح (YYYY-MM-DD)'
        );
    }
    const from = requireSupportedCycle(fromCycle);
    const to = requireSupportedCycle(toCycle);
    if (from === to) {
        throw transitionError(TRANSITION_ERROR_CODES.INVALID_TRANSITION, 'لا يمكن الانتقال داخل نفس السلك');
    }
    if (transitionType === TRANSITION_TYPES.INTER_YEAR && fromYear === toYear) {
        throw transitionError(
            TRANSITION_ERROR_CODES.INVALID_TRANSITION,
            'الانتقال بين السنوات يتطلب سنتين دراسيتين مختلفتين'
        );
    }
    if (transitionType === TRANSITION_TYPES.INTRA_YEAR && fromYear !== toYear) {
        throw transitionError(
            TRANSITION_ERROR_CODES.INVALID_TRANSITION,
            'إعادة التصنيف تتم داخل نفس السنة الدراسية'
        );
    }
    return {
        studentCode,
        fromYear,
        toYear,
        fromCycle: from,
        toCycle: to,
        transitionType,
        idempotencyKey,
        effectiveDate,
        reason
    };
}

function checkReplayPayload(row, t) {
    const same =
        row.student_code === t.studentCode &&
        row.from_school_year === t.fromYear &&
        row.to_school_year === t.toYear &&
        row.from_cycle_code === t.fromCycle &&
        row.to_cycle_code === t.toCycle &&
        row.transition_type === t.transitionType;
    if (!same) {
        throw transitionError(
            TRANSITION_ERROR_CODES.TRANSITION_CONFLICT,
            'مفتاح عدم التكرار مستخدم مسبقاً لعملية انتقال مختلفة'
        );
    }
    return true;
}

function findReplay(db, t) {
    const row = db
        .prepare('SELECT * FROM student_stage_transitions WHERE idempotency_key = ?')
        .get(t.idempotencyKey);
    if (!row) return null;
    checkReplayPayload(row, t);
    return row;
}

function buildReplayResult(row) {
    return {
        success: true,
        idempotentReplay: true,
        transitionId: row.id,
        transitionType: row.transition_type,
        studentId: row.student_id
    };
}

function isIdempotencyConflict(err) {
    // Engine message text is driver-independent (better-sqlite3 and node:sqlite).
    return (
        err &&
        /UNIQUE constraint failed: student_stage_transitions\.idempotency_key/i.test(String(err.message || ''))
    );
}

function insertTransitionRecord(db, t, studentId) {
    db.prepare(
        `INSERT INTO student_stage_transitions(
            student_id, student_code, from_school_year, to_school_year,
            from_cycle_code, to_cycle_code, transition_type,
            idempotency_key, effective_date, reason
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        studentId,
        t.studentCode,
        t.fromYear,
        t.toYear,
        t.fromCycle,
        t.toCycle,
        t.transitionType,
        t.idempotencyKey,
        t.effectiveDate,
        t.reason || null
    );
    return db.prepare('SELECT * FROM student_stage_transitions WHERE idempotency_key = ?').get(t.idempotencyKey);
}

function buildMovementNotes(t) {
    let notes = `انتقال مرحلة من ${t.fromCycle} (${t.fromYear}) إلى ${t.toCycle} (${t.toYear})`;
    if (t.reason) notes += ` — السبب: ${t.reason}`;
    notes += ` [${t.idempotencyKey}]`;
    return notes;
}

function insertMovementRecord(db, t, { studentId, movementType, fromSection, toSection, schoolYear, cycleCode }) {
    db.prepare(
        `INSERT INTO student_movements(
            student_id, movement_type, from_section, to_section,
            movement_date, notes, school_year, cycle_code
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        studentId,
        movementType,
        fromSection || null,
        toSection || null,
        t.effectiveDate,
        buildMovementNotes(t),
        schoolYear,
        cycleCode
    );
    return db.prepare('SELECT * FROM student_movements WHERE id = last_insert_rowid()').get();
}

function normalizeActor(actor) {
    return {
        userId: Number(actor?.userId || 0),
        name: String(actor?.name || ''),
        email: String(actor?.email || ''),
        role: String(actor?.role || '')
    };
}

function writeTransitionAudit(db, t, actor, transitionRow, extra) {
    db.prepare(
        `INSERT INTO system_logs(action, details, entity_type, entity_id)
         VALUES('STAGE_TRANSITION', ?, 'student_stage_transition', ?)`
    ).run(
        JSON.stringify({
            actor: normalizeActor(actor),
            reason: t.reason,
            transitionType: t.transitionType,
            studentCode: t.studentCode,
            fromYear: t.fromYear,
            toYear: t.toYear,
            fromCycle: t.fromCycle,
            toCycle: t.toCycle,
            idempotencyKey: t.idempotencyKey,
            ...(extra || {})
        }),
        String(transitionRow.id)
    );
}

function runInterYearProgression(db, t, actor) {
    const source = db
        .prepare('SELECT * FROM students WHERE code = ? AND school_year = ? AND cycle_code = ?')
        .get(t.studentCode, t.fromYear, t.fromCycle);
    if (!source) {
        throw transitionError(
            TRANSITION_ERROR_CODES.STUDENT_NOT_FOUND,
            `لا يوجد تلميذ بالرمز ${t.studentCode} في السنة ${t.fromYear} داخل السلك المحدد`
        );
    }
    const clash = db
        .prepare('SELECT id FROM students WHERE code = ? AND school_year = ?')
        .get(t.studentCode, t.toYear);
    if (clash) {
        throw transitionError(
            TRANSITION_ERROR_CODES.TRANSITION_CONFLICT,
            `الرمز ${t.studentCode} موجود مسبقاً في السنة ${t.toYear}`
        );
    }
    // The new row carries the person forward; section/level stay as continuity hints
    // for the admin or the next import to correct. Source-year history is untouched.
    db.prepare(
        `INSERT INTO students(
            code, full_name, family_name, birth_date, birth_place, gender,
            section, level, school_name, school_year, status, registration_type, cycle_code
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    ).run(
        source.code,
        source.full_name,
        source.family_name,
        source.birth_date,
        source.birth_place,
        source.gender,
        source.section,
        source.level,
        source.school_name,
        t.toYear,
        source.registration_type || 'new',
        t.toCycle
    );
    const created = db
        .prepare('SELECT * FROM students WHERE code = ? AND school_year = ?')
        .get(t.studentCode, t.toYear);
    const transitionRow = insertTransitionRecord(db, t, created.id);
    const movementRow = insertMovementRecord(db, t, {
        studentId: created.id,
        movementType: 'arrival',
        fromSection: null,
        toSection: created.section,
        schoolYear: t.toYear,
        cycleCode: t.toCycle
    });
    captureResolvedRows(db, 'students', [created], 'PUT');
    captureResolvedRows(db, 'student_movements', [movementRow], 'PUT');
    writeTransitionAudit(db, t, actor, transitionRow, { studentId: created.id, realigned: null });
    return {
        success: true,
        idempotentReplay: false,
        transitionId: transitionRow.id,
        transitionType: t.transitionType,
        studentId: created.id,
        schoolYear: t.toYear,
        realigned: null
    };
}

function realignChildRows(db, t, studentId, schoolYear) {
    const realigned = {};
    for (const spec of REALIGNABLE_CHILD_TABLES) {
        const where = spec.matchByCode
            ? '(student_id = ? OR student_code = ?) AND school_year = ? AND cycle_code = ?'
            : 'student_id = ? AND school_year = ? AND cycle_code = ?';
        const params = spec.matchByCode
            ? [studentId, t.studentCode, schoolYear, t.fromCycle]
            : [studentId, schoolYear, t.fromCycle];
        const rows = db.prepare(`SELECT id FROM "${spec.table}" WHERE ${where} ORDER BY id`).all(...params);
        if (!rows.length) {
            realigned[spec.table] = 0;
            continue;
        }
        db.prepare(`UPDATE "${spec.table}" SET cycle_code = ? WHERE ${where}`).run(t.toCycle, ...params);
        const fresh = [];
        for (let start = 0; start < rows.length; start += ID_CHUNK_SIZE) {
            const chunk = rows.slice(start, start + ID_CHUNK_SIZE);
            const placeholders = chunk.map(() => '?').join(',');
            fresh.push(
                ...db
                    .prepare(`SELECT * FROM "${spec.table}" WHERE id IN (${placeholders})`)
                    .all(...chunk.map((row) => row.id))
            );
        }
        captureResolvedRows(db, spec.table, fresh, 'PUT');
        realigned[spec.table] = fresh.length;
    }
    return realigned;
}

function runIntraYearReclassification(db, t, actor) {
    const year = t.fromYear;
    const source = db
        .prepare('SELECT * FROM students WHERE code = ? AND school_year = ? AND cycle_code = ?')
        .get(t.studentCode, year, t.fromCycle);
    if (!source) {
        const elsewhere = db
            .prepare('SELECT id, cycle_code FROM students WHERE code = ? AND school_year = ?')
            .get(t.studentCode, year);
        if (elsewhere && String(elsewhere.cycle_code) === t.toCycle) {
            throw transitionError(
                TRANSITION_ERROR_CODES.TRANSITION_CONFLICT,
                `التلميذ بالرمز ${t.studentCode} مصنف مسبقاً داخل السلك المستهدف`
            );
        }
        throw transitionError(
            TRANSITION_ERROR_CODES.STUDENT_NOT_FOUND,
            `لا يوجد تلميذ بالرمز ${t.studentCode} في السنة ${year} داخل السلك المحدد`
        );
    }
    // Composite child->owner FKs (migration 087) reference students(id, cycle_code) with no
    // ON UPDATE CASCADE: neither the parent nor the children can change cycle first while
    // enforced. Defer FK checks to COMMIT (auto-resets per transaction) so the owner and its
    // children move together; a mismatch left behind still fails at commit and rolls back.
    db.exec('PRAGMA defer_foreign_keys = ON');
    db.prepare('UPDATE students SET cycle_code = ? WHERE id = ? AND cycle_code = ?').run(
        t.toCycle,
        source.id,
        t.fromCycle
    );
    const realigned = realignChildRows(db, t, source.id, year);
    const updated = db.prepare('SELECT * FROM students WHERE id = ?').get(source.id);
    const transitionRow = insertTransitionRecord(db, t, source.id);
    const movementRow = insertMovementRecord(db, t, {
        studentId: source.id,
        movementType: 'internal',
        fromSection: source.section,
        toSection: source.section,
        schoolYear: year,
        cycleCode: t.toCycle
    });
    captureResolvedRows(db, 'students', [updated], 'PUT');
    captureResolvedRows(db, 'student_movements', [movementRow], 'PUT');
    writeTransitionAudit(db, t, actor, transitionRow, { studentId: source.id, realigned });
    return {
        success: true,
        idempotentReplay: false,
        transitionId: transitionRow.id,
        transitionType: t.transitionType,
        studentId: source.id,
        schoolYear: year,
        realigned
    };
}

/**
 * Execute one student stage transition. Throws coded errors (FORBIDDEN,
 * INVALID_SCHOOL_YEAR, INVALID_TRANSITION, STUDENT_NOT_FOUND,
 * TRANSITION_CONFLICT); anything else is internal.
 */
function transferStudent(db, input, options = {}) {
    const actor = options && options.actor ? options.actor : null;
    if (!actor) {
        const error = new Error('تعذر تحديد هوية الفاعل لعملية الانتقال');
        error.code = 'FORBIDDEN';
        throw error;
    }
    const t = normalizeTransferInput(input);
    // Dual-cycle authorization at the repo layer (never IPC-only): no caller —
    // IPC or future path — can move a student without a grant in both stages.
    assertCycleAuthorized(db, actor, t.fromCycle);
    assertCycleAuthorized(db, actor, t.toCycle);

    const replay = findReplay(db, t);
    if (replay) return buildReplayResult(replay);

    let result;
    try {
        result = db.transaction(() =>
            t.transitionType === TRANSITION_TYPES.INTER_YEAR
                ? runInterYearProgression(db, t, actor)
                : runIntraYearReclassification(db, t, actor)
        )();
    } catch (err) {
        // Concurrent double-submit backstop: the UNIQUE key refused the second
        // writer — resolve it as a replay (or a genuine key conflict), not a 500.
        if (isIdempotencyConflict(err)) {
            const row = db
                .prepare('SELECT * FROM student_stage_transitions WHERE idempotency_key = ?')
                .get(t.idempotencyKey);
            if (row) {
                checkReplayPayload(row, t);
                return buildReplayResult(row);
            }
        }
        throw err;
    }
    notifyCaptureCommitted();
    return result;
}

module.exports = { transferStudent, TRANSITION_TYPES, TRANSITION_ERROR_CODES, REALIGNABLE_CHILD_TABLES };
