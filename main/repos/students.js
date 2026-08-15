'use strict';

/**
 * Students domain repository (WP4).
 * Owns SQL + atomic bulk capture; IPC stays auth/validation/orchestration.
 */

const {
    captureInputUpserts,
    captureResolvedRows,
    captureDeletesFromRows,
    notifyCaptureCommitted
} = require('./capture-port');
const { getLocalKeyFields } = require('../sync/entity-registry');

const STUDENT_KEY_FIELDS = getLocalKeyFields('students') || ['school_year', 'code'];

// Tables whose rows belong to a student and must follow that student when deleted.
// Order matters only for readability — all are child rows of `students`.
const STUDENT_DEPENDENT_TABLES = ['grades', 'absences', 'correspondence', 'student_files', 'student_movements', 'student_profile_data'];

// SQLite's default bound-parameter ceiling is 999; stay well under it per chunk.
const ID_CHUNK_SIZE = 500;

/**
 * Every student query is partitioned by education cycle
 * (docs/plans/2026-07-30-cycle-scoping-students-slice.md, D2).
 *
 * The cycle is always passed in explicitly by the caller, which resolves it from the
 * session in main. There is deliberately no default: a silent fallback would be exactly
 * the "قواعد التأهيلي كـfallback" the plan forbids, and it would read another cycle's
 * students the moment a second cycle ships.
 *
 * The shared guard (main/repos/student-cycle.js) resolves the static catalog entry and
 * requires `capability === 'supported'` — no preview-cycle write can slip through here.
 */
const { requireCycle } = require('./student-cycle');
const VALID_STATUSES = ['active', 'dropout', 'expelled', 'not_enrolled', 'transferred_in'];
const NON_ACTIVE_STATUSES = ['dropout', 'expelled', 'not_enrolled', 'transferred_in'];
const UPDATABLE_FIELDS = [
    'code',
    'full_name',
    'family_name',
    'birth_date',
    'birth_place',
    'gender',
    'section',
    'level',
    'school_name',
    'school_year',
    'status',
    'registration_type'
];

function listByYear(db, year, cycleCode) {
    return db
        .prepare(
            `SELECT * FROM students WHERE school_year = ? AND cycle_code = ?
             ORDER BY section, full_name`
        )
        .all(year, requireCycle(cycleCode));
}

function listPaginated(db, year, cycleCode, pageSize, offset) {
    const cycle = requireCycle(cycleCode);
    const total = db
        .prepare('SELECT COUNT(*) AS c FROM students WHERE school_year = ? AND cycle_code = ?')
        .get(year, cycle).c;
    const rows = db
        .prepare(
            `SELECT * FROM students WHERE school_year = ? AND cycle_code = ?
             ORDER BY section, full_name
             LIMIT ? OFFSET ?`
        )
        .all(year, cycle, pageSize, offset);
    return { total, rows };
}

function getCodesByYear(db, year, cycleCode) {
    return db
        .prepare(
            `SELECT id, code, full_name, section, status
             FROM students
             WHERE school_year = ? AND cycle_code = ? AND status = 'active'
             ORDER BY section, full_name`
        )
        .all(year, requireCycle(cycleCode));
}

function getByCode(db, code, year, cycleCode) {
    return db
        .prepare(
            `
            SELECT *
            FROM students
            WHERE school_year = ? AND cycle_code = ? AND code = ?
            LIMIT 1
        `
        )
        .get(year, requireCycle(cycleCode), code);
}

function search(db, year, cycleCode, { name = '', className = '', code = '' } = {}) {
    const nameQ = String(name || '').trim();
    const classQ = String(className || '').trim();
    const codeQ = String(code || '').trim();
    return db
        .prepare(
            `
            SELECT *
            FROM students
            WHERE school_year = ? AND cycle_code = ?
            AND(? = '' OR full_name LIKE ? OR family_name LIKE ? OR code LIKE ?)
            AND(? = '' OR section = ?)
            AND(? = '' OR code LIKE ?)
            ORDER BY section, full_name
        `
        )
        .all(
            year,
            requireCycle(cycleCode),
            nameQ,
            `%${nameQ}%`,
            `%${nameQ}%`,
            `%${nameQ}%`,
            classQ,
            classQ,
            codeQ,
            `%${codeQ}%`
        );
}

function insertOne(db, student, cycleCode) {
    return db
        .prepare(
            `
                INSERT INTO students (code, full_name, family_name, birth_date, birth_place, gender, section, level, school_name, school_year, status, registration_type, cycle_code)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
        )
        .run(
            student.code,
            student.full_name,
            student.family_name,
            student.birth_date,
            student.birth_place || '',
            student.gender,
            student.section,
            student.level || '',
            student.school_name || '',
            student.school_year,
            student.status || 'active',
            student.registration_type || 'new',
            // The cycle comes from the writing session, never from student.cycle_code —
            // a renderer-supplied cycle is ignored, not validated (§13).
            requireCycle(cycleCode)
        );
}

/**
 * Bulk upsert students and write exact outbox rows in the same transaction (WP1).
 */
function addBulk(db, students, cycleCode, options = {}) {
    const cycle = requireCycle(cycleCode);
    // A normal roster import omits status: keep an existing dropout/expelled/etc.
    // value, while new rows still get the active default. Dedicated status imports
    // provide an explicit non-blank value and update it.
    const insert = db.prepare(`
                INSERT INTO students (code, full_name, family_name, birth_date, birth_place, gender, section, level, school_name, school_year, status, registration_type, cycle_code)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'active'), ?, ?)
                ON CONFLICT(code, school_year) DO UPDATE SET
                    full_name=excluded.full_name,
                    family_name=excluded.family_name,
                    birth_date=excluded.birth_date,
                    birth_place=excluded.birth_place,
                    gender=excluded.gender,
                    section=excluded.section,
                    level=COALESCE(NULLIF(trim(excluded.level), ''), level),
                    school_name=COALESCE(NULLIF(trim(excluded.school_name), ''), school_name),
                    status=CASE WHEN ? = 1 THEN excluded.status ELSE students.status END,
                    registration_type=excluded.registration_type
                WHERE students.cycle_code = excluded.cycle_code
            `);

    // cycle_code is absent from the SET list on purpose: a re-import must not move a
    // student to the importing session's cycle. The WHERE guard means a code that already
    // belongs to another cycle is left untouched (changes = 0) instead of being
    // overwritten across the cycle boundary — those rows are reported as `skipped`.
    const run = db.transaction((items) => {
        const applied = [];
        const skipped = [];
        for (const student of items) {
            if (typeof options.validate === 'function') {
                options.validate(student);
            }
            const info = insert.run(
                student.code,
                student.full_name,
                student.family_name,
                student.birth_date,
                student.birth_place || '',
                student.gender,
                student.section,
                student.level || '',
                student.school_name || '',
                student.school_year,
                Object.prototype.hasOwnProperty.call(student, 'status') ? student.status : null,
                student.registration_type || 'new',
                cycle,
                Object.prototype.hasOwnProperty.call(student, 'status') ? 1 : 0
            );
            if (info.changes > 0) applied.push(student);
            else skipped.push({ code: student.code, school_year: student.school_year });
        }
        // Capture only rows this cycle actually wrote — capturing a skipped row would push
        // the *other* cycle's record as if this session had edited it.
        captureInputUpserts(db, {
            tableName: 'students',
            keyFields: STUDENT_KEY_FIELDS,
            items: applied,
            operation: 'PUT'
        });
        const summary = { applied: applied.length, skipped };
        if (typeof options.audit === 'function') {
            options.audit({
                success: true,
                count: summary.applied,
                skippedOtherCycle: summary.skipped.length,
                skippedRows: summary.skipped
            });
        }
        return summary;
    });

    const result = run(students);
    if (result.applied > 0) notifyCaptureCommitted();
    return {
        success: true,
        count: result.applied,
        skippedOtherCycle: result.skipped.length,
        skippedRows: result.skipped
    };
}

/**
 * @param {object} db
 * @param {number} studentId
 * @param {object} data
 * @param {string[]} [allowedFields]
 * @returns {{ success: boolean, error?: string, updated?: number }}
 */
function updateById(db, studentId, data, cycleCode, allowedFields = UPDATABLE_FIELDS) {
    const id = Number(studentId);
    if (!Number.isFinite(id) || id <= 0) {
        return { success: false, error: 'Invalid student id' };
    }
    const cycle = requireCycle(cycleCode);

    // UPDATABLE_FIELDS deliberately excludes cycle_code: moving a student between cycles
    // is a separate, deliberate operation, not a field edit (D2).
    const updates = allowedFields
        .filter((field) => field !== 'cycle_code')
        .filter((field) => data && Object.prototype.hasOwnProperty.call(data, field))
        .map((field) => ({ field, value: data[field] }));

    if (!updates.length) {
        return { success: false, error: 'No valid fields to update' };
    }

    const setClause = updates.map((item) => `${item.field} = ?`).join(', ');
    const values = updates.map((item) => item.value);
    // Scoped by cycle so a session cannot edit another cycle's student by passing its id.
    const info = db
        .prepare(`UPDATE students SET ${setClause} WHERE id = ? AND cycle_code = ?`)
        .run(...values, id, cycle);
    return { success: true, updated: info.changes };
}

function deleteById(db, studentId, cycleCode) {
    const id = Number(studentId);
    if (!Number.isFinite(id) || id <= 0) {
        return { success: false, error: 'Invalid student id' };
    }
    const info = db
        .prepare('DELETE FROM students WHERE id = ? AND cycle_code = ?')
        .run(id, requireCycle(cycleCode));
    return { success: true, deleted: info.changes };
}

/** Delete a table's rows for the given students, capturing exact DEL outbox entries. */
function deleteRowsByStudentIds(db, tableName, studentIds) {
    let deleted = 0;
    for (let start = 0; start < studentIds.length; start += ID_CHUNK_SIZE) {
        const chunk = studentIds.slice(start, start + ID_CHUNK_SIZE);
        const placeholders = chunk.map(() => '?').join(',');
        const rows = db.prepare(`SELECT * FROM "${tableName}" WHERE student_id IN (${placeholders})`).all(...chunk);
        if (!rows.length) continue;
        captureDeletesFromRows(db, tableName, rows);
        deleted += db.prepare(`DELETE FROM "${tableName}" WHERE student_id IN (${placeholders})`).run(...chunk).changes;
    }
    return deleted;
}

/**
 * Delete one cycle's students for a school year, with their dependent rows.
 *
 * Previously this deleted every dependent row for the year in one statement. With more
 * than one cycle in the database that would wipe the other cycle's grades and absences
 * from a screen that only ever mentioned a year — so the cascade now follows the deleted
 * students by id. Dependent rows whose student no longer exists are left untouched: an
 * orphan's cycle is unknowable, and deleting another cycle's data is worse than leaving
 * an anomaly that was already there.
 */
function deleteByYear(db, year, cycleCode) {
    const cycle = requireCycle(cycleCode);
    const runDelete = db.transaction((targetYear) => {
        const doomed = db
            .prepare('SELECT * FROM students WHERE school_year = ? AND cycle_code = ?')
            .all(targetYear, cycle);
        if (!doomed.length) return 0;

        const ids = doomed.map((row) => row.id);
        for (const table of STUDENT_DEPENDENT_TABLES) {
            deleteRowsByStudentIds(db, table, ids);
        }

        captureDeletesFromRows(db, 'students', doomed);
        return db
            .prepare('DELETE FROM students WHERE school_year = ? AND cycle_code = ?')
            .run(targetYear, cycle).changes;
    });
    const count = runDelete(year);
    if (count > 0) notifyCaptureCommitted();
    return count;
}

function getByStatus(db, year, cycleCode, filters = {}) {
    const cycle = requireCycle(cycleCode);
    const statusFilter = String(filters.status || '').trim();
    const sectionFilter = String(filters.section || '').trim();
    const searchTerm = String(filters.searchTerm || '').trim();

    const whereParts = ['s.school_year = ?', 's.cycle_code = ?'];
    const params = [year, cycle];

    if (statusFilter && NON_ACTIVE_STATUSES.includes(statusFilter)) {
        whereParts.push('s.status = ?');
        params.push(statusFilter);
    } else {
        whereParts.push("s.status IN ('dropout', 'expelled', 'not_enrolled', 'transferred_in')");
    }

    if (sectionFilter) {
        whereParts.push('s.section = ?');
        params.push(sectionFilter);
    }

    if (searchTerm) {
        whereParts.push('(s.full_name LIKE ? OR s.code LIKE ?)');
        const like = `%${searchTerm}%`;
        params.push(like, like);
    }

    const whereSql = whereParts.join(' AND ');

    const rows = db
        .prepare(
            `
            SELECT s.*,
                   m.movement_date AS status_date,
                   m.notes AS status_notes
            FROM students s
            LEFT JOIN (
                SELECT student_id, movement_date, notes,
                       ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY created_at DESC) AS rn
                FROM student_movements
                WHERE movement_type IN ('dropout', 'expulsion', 'not_enrolled', 'transferred_in')
            ) m ON m.student_id = s.id AND m.rn = 1
            WHERE ${whereSql}
            ORDER BY s.section, s.full_name
        `
        )
        .all(...params);

    const summary = db
        .prepare(
            `
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'dropout' THEN 1 ELSE 0 END) AS dropouts,
                SUM(CASE WHEN status = 'expelled' THEN 1 ELSE 0 END) AS expelled,
                SUM(CASE WHEN status = 'not_enrolled' THEN 1 ELSE 0 END) AS not_enrolled,
                SUM(CASE WHEN status = 'transferred_in' THEN 1 ELSE 0 END) AS transferred_in
            FROM students
            WHERE school_year = ? AND cycle_code = ?
              AND status IN ('dropout', 'expelled', 'not_enrolled', 'transferred_in')
        `
        )
        .get(year, cycle);

    const totalStudents = db
        .prepare('SELECT COUNT(*) AS total FROM students WHERE school_year = ? AND cycle_code = ?')
        .get(year, cycle);

    return {
        rows,
        summary: {
            total: Number(summary?.total || 0),
            dropouts: Number(summary?.dropouts || 0),
            expelled: Number(summary?.expelled || 0),
            notEnrolled: Number(summary?.not_enrolled || 0),
            transferredIn: Number(summary?.transferred_in || 0),
            totalStudents: Number(totalStudents?.total || 0)
        }
    };
}

function updateStatusBulk(db, items, cycleCode) {
    const cycle = requireCycle(cycleCode);
    const updateStmt = db.prepare('UPDATE students SET status = ? WHERE id = ? AND cycle_code = ?');
    const selectStmt = db.prepare('SELECT * FROM students WHERE id = ? AND cycle_code = ?');

    const updateMany = db.transaction((entries) => {
        let updated = 0;
        const resolved = [];
        for (const item of entries) {
            const id = Number(item.student_id);
            const status = String(item.status || '').trim();
            if (!Number.isFinite(id) || id <= 0) continue;
            if (!VALID_STATUSES.includes(status)) continue;
            const info = updateStmt.run(status, id, cycle);
            updated += info.changes;
            if (info.changes > 0) {
                const row = selectStmt.get(id, cycle);
                if (row) resolved.push(row);
            }
        }
        if (resolved.length) {
            captureResolvedRows(db, 'students', resolved, 'PUT');
        }
        return updated;
    });

    const count = updateMany(items);
    if (count > 0) notifyCaptureCommitted();
    return count;
}

/**
 * Minimal id/code index for a school year, used to validate references from other
 * domains before they write (e.g. bulk grades).
 *
 * Grade and absence imports now use this index, so it must observe the same cycle
 * boundary as the children they are about to write.
 */
function listCodeIndexByYear(db, year, cycleCode) {
    return db
        .prepare('SELECT id, code FROM students WHERE school_year = ? AND cycle_code = ?')
        .all(year, requireCycle(cycleCode));
}

/**
 * Codes that exist for a year in ANY cycle — used only to tell "this student belongs to
 * another cycle" apart from "this student does not exist", so an import can report the
 * first and reject the second.
 *
 * Returns codes only, never rows: it must not become a way to read another cycle's data.
 */
function listCodesByYearAnyCycle(db, year) {
    return db.prepare('SELECT code FROM students WHERE school_year = ?').all(year).map((row) => row.code);
}

/**
 * Resolve a row by declared local key fields (for tests / sync helpers).
 *
 * Deliberately NOT cycle-scoped: a student's sync identity is school_year + code
 * regardless of cycle (D3). Scoping this would make the same student resolve to two
 * different rows depending on who is asking, which is how duplicates get created.
 */
function findByLocalKeys(db, keyObj) {
    const year = keyObj?.school_year;
    const code = keyObj?.code;
    if (year == null || code == null) return null;
    return db
        .prepare('SELECT * FROM students WHERE school_year = ? AND code = ? LIMIT 1')
        .get(year, code);
}

module.exports = {
    STUDENT_KEY_FIELDS,
    UPDATABLE_FIELDS,
    VALID_STATUSES,
    listByYear,
    listPaginated,
    getCodesByYear,
    getByCode,
    search,
    insertOne,
    addBulk,
    updateById,
    deleteById,
    deleteByYear,
    getByStatus,
    updateStatusBulk,
    listCodeIndexByYear,
    listCodesByYearAnyCycle,
    findByLocalKeys
};
