'use strict';

/** Grades SQL and atomic capture. */
const {
    captureInputUpserts,
    captureResolvedRows,
    capturePutsByIds,
    captureDeletesFromRows,
    notifyCaptureCommitted
} = require('./capture-port');
const { getLocalKeyFields } = require('../sync/entity-registry');
const { requireCycle, resolveStudentForCycle, resolveStudentOwnership } = require('./student-cycle');

const GRADE_KEY_FIELDS = getLocalKeyFields('grades') || ['school_year', 'student_code', 'subject', 'semester'];

function tableColumns(db, tableName) {
    const rows = typeof db.pragma === 'function'
        ? db.pragma(`table_info(${tableName})`)
        : db.prepare(`PRAGMA table_info(${tableName})`).all();
    return new Set(rows.map((row) => row.name));
}

// Subject catalog for the filter-manager dropdown (main/ipc/catalog.js `subjects:getAll`).
// The caller resolves the cycle (resolveCycleForRequest) and it is bound verbatim —
// no guard the original query never had.
function listDistinctSubjects(db, cycleCode) {
    return db
        .prepare(
            `
            SELECT subject
            FROM grades
            WHERE cycle_code = ? AND subject IS NOT NULL AND TRIM(subject) <> ''
            GROUP BY subject
            ORDER BY subject
        `
        )
        .all(cycleCode);
}

function listByYear(db, year, cycleCode) {
    const cycle = requireCycle(cycleCode);
    return db
        .prepare(
            `SELECT g.*, s.full_name, s.section
             FROM grades g
             LEFT JOIN students s ON g.student_id = s.id AND s.cycle_code = g.cycle_code
             WHERE g.school_year = ? AND g.cycle_code = ?
             ORDER BY g.section, g.student_code, g.subject, g.semester`
        )
        .all(year, cycle);
}

function listPaginated(db, year, cycleCode, options = {}) {
    const cycle = requireCycle(cycleCode);
    const className = String(options.className || options.section || '').trim();
    const subject = String(options.subject || '').trim();
    const semester = String(options.semester || '').trim();
    const where = ['g.school_year = ?', 'g.cycle_code = ?'];
    const params = [year, cycle];
    if (className) {
        where.push("COALESCE(g.section, s.section, '') = ?");
        params.push(className);
    }
    if (subject) {
        where.push('g.subject = ?');
        params.push(subject);
    }
    if (semester) {
        where.push('CAST(g.semester AS TEXT) = ?');
        params.push(semester);
    }
    const whereSql = where.join(' AND ');
    const total = db
        .prepare(
            `SELECT COUNT(*) AS c
             FROM grades g
             LEFT JOIN students s ON g.student_id = s.id AND s.cycle_code = g.cycle_code
             WHERE ${whereSql}`
        )
        .get(...params).c;
    const rows = db
        .prepare(
            `SELECT g.*, s.full_name, s.section
             FROM grades g
             LEFT JOIN students s ON g.student_id = s.id AND s.cycle_code = g.cycle_code
             WHERE ${whereSql}
             ORDER BY g.section, g.student_code, g.subject, g.semester
             LIMIT ? OFFSET ?`
        )
        .all(...params, options.pageSize, options.offset);
    return { total, rows };
}

function getByStudentCode(db, studentCode, year, cycleCode) {
    const cycle = requireCycle(cycleCode);
    return db
        .prepare(
            `SELECT g.*, s.full_name, s.section
             FROM grades g
             LEFT JOIN students s ON g.student_id = s.id AND s.cycle_code = g.cycle_code
             WHERE g.student_code = ? AND g.school_year = ? AND g.cycle_code = ?
             ORDER BY g.subject, g.semester`
        )
        .all(String(studentCode || '').trim(), year, cycle);
}

/** Zero-grade cases with optional absence linkage (used by analytics UI). */
function getZeroStudents(db, year, cycleCode, filters = {}) {
    const cycle = requireCycle(cycleCode);
    const className = String(filters.className || '').trim();
    const semester = String(filters.semester || '').trim();
    const searchTerm = String(filters.searchTerm || '').trim();
    const exportAll = Boolean(filters.exportAll);
    const rawPage = Number(filters.page);
    const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
    const rawPageSize = Number(filters.pageSize);
    const pageSize = Number.isFinite(rawPageSize) ? Math.min(200, Math.max(5, Math.floor(rawPageSize))) : 25;
    const whereParts = ['g.school_year = ?', 'g.cycle_code = ?', 'CAST(g.grade AS REAL) = 0'];
    const params = [year, cycle];
    if (className) {
        whereParts.push("COALESCE(g.section, s.section, '') = ?");
        params.push(className);
    }
    if (semester) {
        whereParts.push('CAST(g.semester AS TEXT) = ?');
        params.push(semester);
    }
    if (searchTerm) {
        whereParts.push(
            "(COALESCE(s.full_name, '') LIKE ? OR COALESCE(g.student_code, s.code, '') LIKE ? OR COALESCE(g.subject, '') LIKE ?)"
        );
        const like = `%${searchTerm}%`;
        params.push(like, like, like);
    }
    const whereSql = whereParts.join(' AND ');
    let canUseAbsences = false;
    try {
        const columns = db.pragma('table_info(absences)').map((column) => column.name);
        canUseAbsences = ['school_year', 'student_code', 'cycle_code'].every((column) => columns.includes(column));
    } catch {
        canUseAbsences = false;
    }
    const absenceCountExpr = canUseAbsences
        ? `COALESCE((
                SELECT COUNT(*) FROM absences a
                WHERE a.school_year = g.school_year
                  AND a.cycle_code = g.cycle_code
                  AND a.student_code = COALESCE(g.student_code, s.code, '')
            ), 0)`
        : '0';
    const baseQuery = `
        SELECT g.id, COALESCE(g.student_code, s.code, '') AS student_code,
               COALESCE(s.full_name, '') AS student_name,
               COALESCE(g.section, s.section, '') AS class_name,
               COALESCE(g.subject, '') AS subject, CAST(g.semester AS TEXT) AS semester,
               CAST(g.grade AS REAL) AS grade, ${absenceCountExpr} AS absence_count
        FROM grades g
        LEFT JOIN students s
          ON s.school_year = g.school_year
         AND s.cycle_code = g.cycle_code
         AND (g.student_id = s.id OR g.student_code = s.code)
        WHERE ${whereSql}`;
    const summary = db
        .prepare(
            `SELECT COUNT(*) AS total_cases, COUNT(DISTINCT student_code) AS unique_students,
                    COUNT(DISTINCT class_name) AS sections_count,
                    SUM(CASE WHEN absence_count > 0 THEN 1 ELSE 0 END) AS absence_linked_cases
             FROM (${baseQuery}) z`
        )
        .get(...params);
    const totalRows = Number(summary?.total_cases || 0);
    const totalPages = totalRows ? Math.ceil(totalRows / pageSize) : 1;
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;
    let rowsQuery = `
        SELECT z.*, CASE WHEN z.absence_count > 0 THEN 'غياب' ELSE 'تعثر دراسي' END AS zero_reason
        FROM (${baseQuery}) z
        ORDER BY z.class_name, z.student_name, z.subject, z.semester`;
    const rowsParams = [...params];
    if (!exportAll) {
        rowsQuery += ' LIMIT ? OFFSET ?';
        rowsParams.push(pageSize, offset);
    }
    const rows = db.prepare(rowsQuery).all(...rowsParams);
    return {
        rows,
        pagination: { page: exportAll ? 1 : safePage, pageSize: exportAll ? rows.length || pageSize : pageSize, totalRows, totalPages: exportAll ? 1 : totalPages },
        summary: {
            totalCases: totalRows,
            uniqueStudents: Number(summary?.unique_students || 0),
            sectionsCount: Number(summary?.sections_count || 0),
            absenceLinkedCases: Number(summary?.absence_linked_cases || 0)
        }
    };
}

function writeGradeForStudent(insert, grade, student) {
    const info = insert.run(
        student.id,
        student.code,
        grade.teacher_id || null,
        grade.subject,
        grade.grade,
        grade.semester,
        grade.teacher_name || '',
        grade.level || '',
        grade.section || '',
        grade.school_year,
        student.cycle_code,
        grade.teacher_resolution || (Number(grade.teacher_id) > 0 ? 'resolved' : 'unresolved'),
        grade.source_file_name || null
    );
    return {
        info,
        row: {
            ...grade,
            student_id: student.id,
            student_code: student.code,
            cycle_code: student.cycle_code,
            teacher_resolution: grade.teacher_resolution || (Number(grade.teacher_id) > 0 ? 'resolved' : 'unresolved')
        }
    };
}

function createUpsert(db) {
    const columns = tableColumns(db, 'grades');
    const hasResolution = columns.has('teacher_resolution');
    const hasSourceFile = columns.has('source_file_name');
    const insertColumns = [
        'student_id',
        'student_code',
        'teacher_id',
        'subject',
        'grade',
        'semester',
        'teacher_name',
        'level',
        'section',
        'school_year',
        'cycle_code'
    ];
    if (hasResolution) insertColumns.push('teacher_resolution');
    if (hasSourceFile) insertColumns.push('source_file_name');
    const updateColumns = [
        'student_id = excluded.student_id',
        'teacher_id = excluded.teacher_id',
        'grade = excluded.grade',
        'teacher_name = excluded.teacher_name',
        // Blank imported level/section must never clobber an existing value (F4) —
        // a partial file row missing these fields silently blanks the DB columns.
        "level = COALESCE(NULLIF(trim(excluded.level), ''), grades.level)",
        "section = COALESCE(NULLIF(trim(excluded.section), ''), grades.section)"
    ];
    if (hasResolution) updateColumns.push('teacher_resolution = excluded.teacher_resolution');
    if (hasSourceFile) updateColumns.push('source_file_name = COALESCE(excluded.source_file_name, grades.source_file_name)');
    const statement = db.prepare(`
        INSERT INTO grades (${insertColumns.join(', ')})
        VALUES (${insertColumns.map(() => '?').join(', ')})
        ON CONFLICT(student_code, subject, semester, school_year) DO UPDATE SET
            ${updateColumns.join(',\n            ')}
        WHERE grades.cycle_code = excluded.cycle_code`);
    return {
        run(studentId, studentCode, teacherId, subject, gradeValue, semester, teacherName, level, section, schoolYear, cycleCode, teacherResolution, sourceFileName) {
            const params = [studentId, studentCode, teacherId, subject, gradeValue, semester, teacherName, level, section, schoolYear, cycleCode];
            if (hasResolution) params.push(teacherResolution || (Number(teacherId) > 0 ? 'resolved' : 'unresolved'));
            if (hasSourceFile) params.push(sourceFileName || null);
            return statement.run(...params);
        }
    };
}

function saveOne(db, grade, cycleCode, options = {}) {
    const cycle = requireCycle(cycleCode);
    const student = resolveStudentForCycle(db, grade.student_code, grade.school_year, cycle);
    const result = db.transaction(() => {
        const result = writeGradeForStudent(createUpsert(db), grade, student);
        const aliasRow = grade.teacher_alias && typeof options.saveTeacherAlias === 'function'
            ? options.saveTeacherAlias(db, grade.teacher_alias)
            : null;
        if (aliasRow) captureResolvedRows(db, 'teacher_aliases', [aliasRow], 'PUT');
        return result;
    })();
    if (result.info.changes > 0) notifyCaptureCommitted();
    return { success: true, saved: result.info.changes, skippedOtherCycle: result.info.changes ? 0 : 1 };
}

/**
 * Bulk upsert.
 *
 * A row whose student belongs to another cycle is skipped and reported, not thrown —
 * one foreign row in a whole-institution export must not cost the user every other row.
 * An unknown student code still throws: that is malformed input, and the behavior
 * predates cycle scoping. Same contract as studentsRepo.addBulk.
 */
function saveBulk(db, grades, cycleCode, options = {}) {
    const cycle = requireCycle(cycleCode);
    const existing = db.prepare(
        `SELECT 1 FROM grades WHERE student_code = ? AND subject = ? AND semester = ? AND school_year = ? LIMIT 1`
    );
    const insert = createUpsert(db);
    const run = db.transaction((items) => {
        const applied = [];
        const appliedGradeRows = [];
        const aliasRows = new Map();
        const skippedRows = [];
        const seenInputKeys = new Set();
        let inserted = 0;
        let updated = 0;
        let duplicateInput = 0;
        for (const grade of items) {
            const input = typeof options.resolveRow === 'function' ? options.resolveRow(grade) : grade;
            const { student, foreignCycle } = resolveStudentOwnership(db, input.student_code, input.school_year, cycle);
            if (!student) {
                throw new Error(`لا يوجد تلميذ بالرمز ${String(input.student_code || '').trim()} في السنة الدراسية المحددة`);
            }
            if (foreignCycle) {
                skippedRows.push({ student_code: student.code, school_year: input.school_year });
                continue;
            }
            const aliasRow = input.teacher_alias && typeof options.saveTeacherAlias === 'function'
                ? options.saveTeacherAlias(db, input.teacher_alias)
                : null;
            if (aliasRow) aliasRows.set(Number(aliasRow.id), aliasRow);
            const key = `${student.code}||${input.subject}||${input.semester}||${input.school_year}`;
            const alreadyExists = Boolean(existing.get(student.code, input.subject, input.semester, input.school_year));
            const { info, row } = writeGradeForStudent(insert, { ...input, student_code: student.code }, student);
            if (seenInputKeys.has(key)) duplicateInput += 1;
            seenInputKeys.add(key);
            if (!info.changes) {
                // The upsert guard refused it: a stored row whose cycle drifted from its
                // student's (e.g. an orphan row defaulted during backfill).
                skippedRows.push({ student_code: row.student_code, school_year: row.school_year });
                continue;
            }
            if (alreadyExists) updated += 1;
            else inserted += 1;
            applied.push({ school_year: row.school_year, student_code: row.student_code, subject: row.subject, semester: row.semester });
            appliedGradeRows.push(row);
        }
        captureInputUpserts(db, { tableName: 'grades', keyFields: GRADE_KEY_FIELDS, items: applied, operation: 'PUT' });
        if (aliasRows.size) captureResolvedRows(db, 'teacher_aliases', Array.from(aliasRows.values()), 'PUT');
        const assignmentResult = typeof options.onTeacherAssignments === 'function'
            ? options.onTeacherAssignments(db, appliedGradeRows, cycle)
            : null;
        const summary = { applied, skippedRows, inserted, updated, duplicateInput, assignmentResult };
        if (typeof options.audit === 'function') options.audit(summary);
        return summary;
    });
    const result = run(grades);
    if (result.applied.length) notifyCaptureCommitted();
    return {
        success: true,
        count: result.applied.length,
        inserted: result.inserted,
        updated: result.updated,
        duplicateInput: result.duplicateInput,
        assignmentResult: result.assignmentResult,
        skippedOtherCycle: result.skippedRows.length,
        skippedRows: result.skippedRows
    };
}

function reassignTeacherBulk(db, year, cycleCode, changes, options = {}) {
    const cycle = requireCycle(cycleCode);
    const resolveTeacher = options.resolveTeacher;
    const normalizeSubject = typeof options.normalizeSubject === 'function' ? options.normalizeSubject : (subject) => String(subject || '').trim();
    const selectGradesBySection = db.prepare(`
        SELECT g.id, g.subject, g.teacher_id, g.teacher_name FROM grades g
        LEFT JOIN students s ON s.school_year = g.school_year AND s.cycle_code = g.cycle_code
          AND (g.student_id = s.id OR g.student_code = s.code)
        WHERE g.school_year = ? AND g.cycle_code = ?
          AND COALESCE(NULLIF(TRIM(g.section), ''), NULLIF(TRIM(s.section), ''), '') = ?`);
    const updateGradeTeacher = db.prepare('UPDATE grades SET teacher_id = ?, teacher_name = ? WHERE id = ? AND cycle_code = ?');
    const applyChanges = db.transaction((items) => {
        const results = [];
        const updatedIds = [];
        const aliasRows = new Map();
        for (const item of items) {
            const section = String(item?.section || '').trim();
            const subject = normalizeSubject(item?.subject || '');
            if (!section || !subject) throw new Error('Section and subject are required');
            const resolvedTeacher = resolveTeacher(db, item, year);
            if (!resolvedTeacher.teacher_id && !resolvedTeacher.teacher_name) throw new Error(`Unable to resolve target teacher for ${section} / ${subject}`);
            const teacherAlias = resolvedTeacher.teacher_id
                ? {
                      teacher_id: resolvedTeacher.teacher_id,
                      alias_name: item?.to_teacher_name,
                      school_year: year,
                      source: 'grades:reassignTeacherBulk'
                  }
                : null;
            const aliasRow = teacherAlias && typeof options.saveTeacherAlias === 'function'
                ? options.saveTeacherAlias(db, teacherAlias)
                : null;
            if (aliasRow) aliasRows.set(Number(aliasRow.id), aliasRow);
            const fromTeacherId = Number(item?.from_teacher_id) || null;
            const fromTeacherName = String(item?.from_teacher_name || '').trim().toLowerCase();
            let updated = 0;
            for (const row of selectGradesBySection.all(year, cycle, section)) {
                if (normalizeSubject(row.subject || '') !== subject) continue;
                if (fromTeacherId && Number(row.teacher_id) && Number(row.teacher_id) !== fromTeacherId) continue;
                if (!fromTeacherId && fromTeacherName && String(row.teacher_name || '').trim().toLowerCase() !== fromTeacherName) continue;
                updateGradeTeacher.run(resolvedTeacher.teacher_id || null, resolvedTeacher.teacher_name || item?.to_teacher_name || '', row.id, cycle);
                updatedIds.push(row.id);
                updated += 1;
            }
            results.push({ section, subject, updated, to_teacher_id: resolvedTeacher.teacher_id || null, to_teacher_name: resolvedTeacher.teacher_name || item?.to_teacher_name || '' });
        }
        if (updatedIds.length) capturePutsByIds(db, 'grades', updatedIds, year);
        if (aliasRows.size) captureResolvedRows(db, 'teacher_aliases', Array.from(aliasRows.values()), 'PUT');
        return results;
    });
    const results = applyChanges(changes);
    if (results.some((result) => result.updated)) notifyCaptureCommitted();
    return { success: true, count: results.reduce((sum, result) => sum + Number(result.updated || 0), 0), results };
}

function deleteByYear(db, year, cycleCode) {
    const cycle = requireCycle(cycleCode);
    const run = db.transaction(() => {
        const rows = db.prepare('SELECT * FROM grades WHERE school_year = ? AND cycle_code = ?').all(year, cycle);
        captureDeletesFromRows(db, 'grades', rows);
        return db.prepare('DELETE FROM grades WHERE school_year = ? AND cycle_code = ?').run(year, cycle).changes;
    });
    const count = run();
    if (count) notifyCaptureCommitted();
    return count;
}

function deleteBySemester(db, year, semester, cycleCode) {
    const cycle = requireCycle(cycleCode);
    const sem = Number(semester);
    // Fail-closed: a falsy/unparseable semester must never silently delete semester 1.
    if (sem !== 1 && sem !== 2) {
        const err = new Error('الفصل الدراسي يجب أن يكون 1 أو 2');
        err.code = 'INVALID_SEMESTER';
        throw err;
    }
    const run = db.transaction(() => {
        const rows = db.prepare('SELECT * FROM grades WHERE school_year = ? AND CAST(semester AS INTEGER) = ? AND cycle_code = ?').all(year, sem, cycle);
        captureDeletesFromRows(db, 'grades', rows);
        return db.prepare('DELETE FROM grades WHERE school_year = ? AND CAST(semester AS INTEGER) = ? AND cycle_code = ?').run(year, sem, cycle).changes;
    });
    const count = run();
    if (count) notifyCaptureCommitted();
    return count;
}

// Sync identity remains independent of cycle_code (cycle-carrying, not cycle-keyed).
function findByLocalKeys(db, keyObj) {
    const { school_year: year, student_code: studentCode, subject, semester } = keyObj || {};
    if (year == null || studentCode == null || subject == null || semester == null) return null;
    return db.prepare(`SELECT * FROM grades WHERE school_year = ? AND student_code = ? AND subject = ? AND CAST(semester AS TEXT) = CAST(? AS TEXT) LIMIT 1`).get(year, studentCode, subject, semester);
}

module.exports = { GRADE_KEY_FIELDS, listByYear, listPaginated, listDistinctSubjects, getByStudentCode, getZeroStudents, saveOne, saveBulk, reassignTeacherBulk, deleteByYear, deleteBySemester, findByLocalKeys };
