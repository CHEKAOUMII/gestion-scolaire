'use strict';

/** student_files SQL and atomic capture; ownership and cycle resolution stay in the repository. */
const { captureInputUpserts, notifyCaptureCommitted } = require('./capture-port');
const { getLocalKeyFields } = require('../sync/entity-registry');
const { requireCycle, findStudentById, resolveStudentOwnership } = require('./student-cycle');

const STUDENT_FILES_KEY_FIELDS = getLocalKeyFields('student_files') || ['student_id', 'doc_key', 'school_year'];

function createUpsert(db) {
    return db.prepare(`
        INSERT INTO student_files(student_id, doc_key, is_present, school_year, cycle_code, updated_at)
        VALUES(?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(student_id, doc_key, school_year) DO UPDATE SET
            is_present = excluded.is_present,
            cycle_code = excluded.cycle_code,
            updated_at = CURRENT_TIMESTAMP
        WHERE student_files.cycle_code = excluded.cycle_code`);
}

function runUpsert(upsert, row) {
    return upsert.run(row.student_id, row.doc_key, row.is_present ? 1 : 0, row.school_year, row.cycle_code);
}

function listByYear(db, year, cycleCode) {
    const cycle = requireCycle(cycleCode);
    const students = db
        .prepare('SELECT * FROM students WHERE school_year = ? AND cycle_code = ? ORDER BY section, full_name')
        .all(year, cycle);
    const files = db
        .prepare('SELECT student_id, doc_key, is_present FROM student_files WHERE school_year = ? AND cycle_code = ?')
        .all(year, cycle);

    const byStudent = {};
    for (const row of files) {
        if (!byStudent[row.student_id]) byStudent[row.student_id] = {};
        byStudent[row.student_id][row.doc_key] = Number(row.is_present) === 1;
    }

    return students.map((student) => {
        const docs = byStudent[student.id] || {};
        const docsCount = Object.values(docs).filter(Boolean).length;
        return { ...student, docs, docsCount };
    });
}

function payloadLabel(payload) {
    if (payload.student_code != null && String(payload.student_code).trim() !== '') {
        return String(payload.student_code).trim();
    }
    return String(payload.student_id);
}

/**
 * Owner lookup accepting either identity form the pages use: student_id (the registry
 * local key) or student_code (Massar-style payloads). Unknown and foreign-cycle
 * outcomes mirror resolveStudentOwnership's bulk contract.
 *
 * @returns {{ student: object|null, foreignCycle: boolean }}
 */
function findOwnerForPayload(db, payload, cycle) {
    if (payload.student_code != null && String(payload.student_code).trim() !== '') {
        return resolveStudentOwnership(db, String(payload.student_code).trim(), payload.school_year, cycle);
    }
    const student = findStudentById(db, payload.student_id, payload.school_year);
    if (!student) return { student: null, foreignCycle: false };
    if (student.cycle_code !== cycle) return { student, foreignCycle: true };
    return { student, foreignCycle: false };
}

function upsertOne(db, payload, cycleCode) {
    const cycle = requireCycle(cycleCode);
    const { student, foreignCycle } = findOwnerForPayload(db, payload, cycle);
    if (!student) {
        throw new Error(`لا يوجد تلميذ بالرمز ${payloadLabel(payload)} في السنة الدراسية المحددة`);
    }
    if (foreignCycle) {
        throw new Error(`التلميذ بالرمز ${payloadLabel(payload)} لا ينتمي إلى السلك التعليمي النشط`);
    }
    const result = runUpsert(createUpsert(db), { ...payload, student_id: student.id, cycle_code: student.cycle_code });
    return result.changes ? { success: true } : { success: false, error: 'ملف التلميذ لا ينتمي إلى السلك التعليمي النشط' };
}

/**
 * Bulk upsert with explicit capture inside the transaction (channel registered with
 * captureMode: 'explicit'). A foreign-cycle row is reported and skipped, an unknown
 * code still throws — the same contract as absencesRepo.saveBulk and gradesRepo.saveBulk.
 */
function upsertBulk(db, items, cycleCode, options = {}) {
    const cycle = requireCycle(cycleCode);
    const list = Array.isArray(items) ? items : [];
    const upsert = createUpsert(db);
    const run = db.transaction((rows) => {
        const applied = [];
        const skippedRows = [];
        for (const payload of rows) {
            if (typeof options.validate === 'function') options.validate(payload);
            const { student, foreignCycle } = findOwnerForPayload(db, payload, cycle);
            if (!student) {
                throw new Error(`لا يوجد تلميذ بالرمز ${payloadLabel(payload)} في السنة الدراسية المحددة`);
            }
            if (foreignCycle) {
                skippedRows.push({ student_code: student.code, school_year: payload.school_year });
                continue;
            }
            const info = runUpsert(upsert, { ...payload, student_id: student.id, cycle_code: student.cycle_code });
            if (!info.changes) {
                skippedRows.push({ student_code: student.code, school_year: payload.school_year });
                continue;
            }
            applied.push({ student_id: student.id, doc_key: payload.doc_key, school_year: payload.school_year });
        }
        captureInputUpserts(db, {
            tableName: 'student_files',
            keyFields: STUDENT_FILES_KEY_FIELDS,
            items: applied,
            operation: 'PUT'
        });
        return { applied, skippedRows };
    });
    const result = run(list);
    if (result.applied.length) notifyCaptureCommitted();
    return { success: true, count: result.applied.length, skippedOtherCycle: result.skippedRows.length, skippedRows: result.skippedRows };
}

function setDocumentStatus(db, payload, cycleCode) {
    return upsertOne(db, payload, cycleCode);
}

module.exports = { STUDENT_FILES_KEY_FIELDS, listByYear, upsertOne, upsertBulk, setDocumentStatus };
