const { handleRead, handleWrite, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { requireFields, validateRange, normalizePagination, buildPaginatedResult } = require('./validation');
const { normalizeSubjectName } = require('../../js/data/ma-education-labels');
const { resolveTeacherIdentity } = require('../teachers/identity');

function registerGradesIpc(ipcMain) {
    handleRead(ipcMain, 'grades:getAll', (db, schoolYear) => {
        return db
            .prepare(
                `
            SELECT g.*, s.full_name, s.section
            FROM grades g
            LEFT JOIN students s ON g.student_id = s.id
            WHERE g.school_year = ?
        `
            )
            .all(normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'grades:list', (db, schoolYear, options = {}) => {
        const year = normalizeYear(schoolYear);
        const { page, pageSize, offset } = normalizePagination(options);
        const className = String(options.className || options.section || '').trim();
        const subject = String(options.subject || '').trim();
        const semester = String(options.semester || '').trim();

        const where = ['g.school_year = ?'];
        const params = [year];
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
                 LEFT JOIN students s ON g.student_id = s.id
                 WHERE ${whereSql}`
            )
            .get(...params).c;

        const rows = db
            .prepare(
                `SELECT g.*, s.full_name, s.section
                 FROM grades g
                 LEFT JOIN students s ON g.student_id = s.id
                 WHERE ${whereSql}
                 ORDER BY g.section, g.student_code, g.subject, g.semester
                 LIMIT ? OFFSET ?`
            )
            .all(...params, pageSize, offset);

        return buildPaginatedResult(rows, total, page, pageSize);
    });

    handleRead(ipcMain, 'grades:getByStudentCode', (db, studentCode, schoolYear) => {
        return db
            .prepare(
                `
            SELECT g.*, s.full_name, s.section
            FROM grades g
            LEFT JOIN students s ON g.student_id = s.id
            WHERE g.student_code = ? AND g.school_year = ?
            ORDER BY g.subject, g.semester
        `
            )
            .all(String(studentCode || '').trim(), normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'grades:getZeroStudents', (db, filters) => {
        filters = filters || {};
        const year = String(normalizeYear(filters.schoolYear)).trim();
        const className = String(filters.className || '').trim();
        const semester = String(filters.semester || '').trim();
        const searchTerm = String(filters.searchTerm || '').trim();
        const exportAll = Boolean(filters.exportAll);

        const rawPage = Number(filters.page);
        const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;

        const rawPageSize = Number(filters.pageSize);
        const defaultPageSize = 25;
        const pageSize = Number.isFinite(rawPageSize)
            ? Math.min(200, Math.max(5, Math.floor(rawPageSize)))
            : defaultPageSize;

        const whereParts = ['g.school_year = ?', 'CAST(g.grade AS REAL) = 0'];
        const params = [year];

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
            const absenceCols = db.pragma('table_info(absences)').map((col) => col.name);
            canUseAbsences = absenceCols.includes('school_year') && absenceCols.includes('student_code');
        } catch {
            canUseAbsences = false;
        }

        const absenceCountExpr = canUseAbsences
            ? `COALESCE((
                        SELECT COUNT(*)
                        FROM absences a
                        WHERE a.school_year = g.school_year
                          AND a.student_code = COALESCE(g.student_code, s.code, '')
                    ), 0)`
            : '0';

        const baseQuery = `
                SELECT
                    g.id,
                    COALESCE(g.student_code, s.code, '') AS student_code,
                    COALESCE(s.full_name, '') AS student_name,
                    COALESCE(g.section, s.section, '') AS class_name,
                    COALESCE(g.subject, '') AS subject,
                    CAST(g.semester AS TEXT) AS semester,
                    CAST(g.grade AS REAL) AS grade,
                    ${absenceCountExpr} AS absence_count
                FROM grades g
                LEFT JOIN students s
                    ON s.school_year = g.school_year
                   AND (g.student_id = s.id OR g.student_code = s.code)
                WHERE ${whereSql}
            `;

        const summary = db
            .prepare(
                `
                SELECT
                    COUNT(*) AS total_cases,
                    COUNT(DISTINCT student_code) AS unique_students,
                    COUNT(DISTINCT class_name) AS sections_count,
                    SUM(CASE WHEN absence_count > 0 THEN 1 ELSE 0 END) AS absence_linked_cases
                FROM (${baseQuery}) z
            `
            )
            .get(...params);

        const totalRows = Number(summary?.total_cases || 0);
        const totalPages = totalRows ? Math.ceil(totalRows / pageSize) : 1;
        const safePage = Math.min(page, totalPages);
        const offset = (safePage - 1) * pageSize;

        let rowsQuery = `
                SELECT
                    z.*,
                    CASE
                        WHEN z.absence_count > 0 THEN 'غياب'
                        ELSE 'تعثر دراسي'
                    END AS zero_reason
                FROM (${baseQuery}) z
                ORDER BY z.class_name, z.student_name, z.subject, z.semester
            `;

        const rowsParams = [...params];
        if (!exportAll) {
            rowsQuery += ' LIMIT ? OFFSET ?';
            rowsParams.push(pageSize, offset);
        }

        const rows = db.prepare(rowsQuery).all(...rowsParams);

        return {
            success: true,
            rows,
            pagination: {
                page: exportAll ? 1 : safePage,
                pageSize: exportAll ? rows.length || pageSize : pageSize,
                totalRows,
                totalPages: exportAll ? 1 : totalPages
            },
            summary: {
                totalCases: totalRows,
                uniqueStudents: Number(summary?.unique_students || 0),
                sectionsCount: Number(summary?.sections_count || 0),
                absenceLinkedCases: Number(summary?.absence_linked_cases || 0)
            }
        };
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
        // Explicit upsert on the existing unique key (student_code, subject, semester,
        // school_year). Unlike INSERT OR REPLACE (which is DELETE+INSERT in SQLite and so
        // churns grades.id + created_at on every re-save — breaking sync_id_map linkage),
        // ON CONFLICT DO UPDATE preserves the row identity and creation timestamp (R1).
        db.prepare(
            `
                INSERT INTO grades (student_id, student_code, teacher_id, subject, grade, semester, teacher_name, level, section, school_year)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(student_code, subject, semester, school_year) DO UPDATE SET
                    student_id = excluded.student_id,
                    teacher_id = excluded.teacher_id,
                    grade = excluded.grade,
                    teacher_name = excluded.teacher_name,
                    level = excluded.level,
                    section = excluded.section
            `
        ).run(
            grade.student_id,
            grade.student_code,
            resolvedTeacher.teacher_id || null,
            grade.subject,
            grade.grade,
            grade.semester,
            resolvedTeacher.teacher_name || grade.teacher_name || '',
            grade.level || '',
            grade.section || '',
            grade.school_year
        );
        return { success: true };
    });

    // No auth: bulk-import is used by settings-imports page before login
    handleWriteSoftAuth(ipcMain, 'grades:saveBulk', WRITE_ROLES, (db, grades) => {
        if (!Array.isArray(grades)) {
            return { success: false, error: 'Expected an array' };
        }
        if (grades.length > 5000) {
            return { success: false, error: 'Batch size exceeds maximum of 5000' };
        }
        // Upsert instead of INSERT OR REPLACE (see grades:save above, R1): preserves
        // grades.id + created_at across re-imports so synced rows keep a stable identity.
        const insert = db.prepare(`
                INSERT INTO grades (student_id, student_code, teacher_id, subject, grade, semester, teacher_name, level, section, school_year)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(student_code, subject, semester, school_year) DO UPDATE SET
                    student_id = excluded.student_id,
                    teacher_id = excluded.teacher_id,
                    grade = excluded.grade,
                    teacher_name = excluded.teacher_name,
                    level = excluded.level,
                    section = excluded.section
            `);
        const insertMany = db.transaction((items) => {
            for (const grade of items) {
                requireFields(grade, ['student_code', 'subject', 'semester', 'school_year']);
                requireSchoolYear(grade.school_year);
                validateRange('grade', grade.grade, 0, 20);
                const resolvedTeacher = resolveTeacherIdentity(db, {
                    teacher_id: grade.teacher_id,
                    teacher_name: grade.teacher_name,
                    school_year: grade.school_year,
                    source: 'grades:saveBulk'
                });
                insert.run(
                    grade.student_id,
                    grade.student_code,
                    resolvedTeacher.teacher_id || null,
                    grade.subject,
                    grade.grade,
                    grade.semester,
                    resolvedTeacher.teacher_name || grade.teacher_name || '',
                    grade.level || '',
                    grade.section || '',
                    grade.school_year
                );
            }
        });
        insertMany(grades);
        return { success: true, count: grades.length };
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

        const selectGradesBySection = db.prepare(
            `
                SELECT g.id, g.subject, g.teacher_id, g.teacher_name
                FROM grades g
                LEFT JOIN students s
                    ON s.school_year = g.school_year
                   AND (g.student_id = s.id OR g.student_code = s.code)
                WHERE g.school_year = ?
                  AND COALESCE(NULLIF(TRIM(g.section), ''), NULLIF(TRIM(s.section), ''), '') = ?
            `
        );
        const updateGradeTeacher = db.prepare('UPDATE grades SET teacher_id = ?, teacher_name = ? WHERE id = ?');

        const applyChanges = db.transaction((items) => {
            const results = [];

            for (const item of items) {
                const section = String(item?.section || '').trim();
                const subject = normalizeSubjectName(item?.subject || '');
                if (!section || !subject) {
                    throw new Error('Section and subject are required');
                }

                const resolvedTeacher = resolveTeacherIdentity(db, {
                    teacher_id: item?.to_teacher_id,
                    teacher_name: item?.to_teacher_name,
                    school_year: year,
                    source: 'grades:reassignTeacherBulk'
                });

                if (!resolvedTeacher.teacher_id && !resolvedTeacher.teacher_name) {
                    throw new Error(`Unable to resolve target teacher for ${section} / ${subject}`);
                }

                const fromTeacherId = Number(item?.from_teacher_id) || null;
                const fromTeacherName = String(item?.from_teacher_name || '').trim();
                const normalizedFromTeacherName = fromTeacherName.toLowerCase();

                const sectionRows = selectGradesBySection.all(year, section);
                let updated = 0;

                for (const row of sectionRows) {
                    if (normalizeSubjectName(row.subject || '') !== subject) continue;

                    if (fromTeacherId && Number(row.teacher_id) && Number(row.teacher_id) !== fromTeacherId) {
                        continue;
                    }

                    if (
                        !fromTeacherId &&
                        normalizedFromTeacherName &&
                        String(row.teacher_name || '')
                            .trim()
                            .toLowerCase() !== normalizedFromTeacherName
                    ) {
                        continue;
                    }

                    updateGradeTeacher.run(
                        resolvedTeacher.teacher_id || null,
                        resolvedTeacher.teacher_name || item?.to_teacher_name || '',
                        row.id
                    );
                    updated += 1;
                }

                results.push({
                    section,
                    subject,
                    updated,
                    to_teacher_id: resolvedTeacher.teacher_id || null,
                    to_teacher_name: resolvedTeacher.teacher_name || item?.to_teacher_name || ''
                });
            }

            return results;
        });

        const results = applyChanges(changes);
        return {
            success: true,
            count: results.reduce((sum, entry) => sum + Number(entry.updated || 0), 0),
            results
        };
    });

    // No auth: delete is used from settings-imports page which may be opened before login
    handleWriteSoftAuth(ipcMain, 'grades:deleteByYear', WRITE_ROLES, (db, schoolYear) => {
        const info = db.prepare('DELETE FROM grades WHERE school_year = ?').run(requireSchoolYear(schoolYear));
        return { success: true, count: info.changes };
    });

    handleWriteSoftAuth(ipcMain, 'grades:deleteBySemester', WRITE_ROLES, (db, schoolYear, semester) => {
        const year = requireSchoolYear(schoolYear);
        const sem = parseInt(semester, 10) || 1;
        const info = db
            .prepare('DELETE FROM grades WHERE school_year = ? AND CAST(semester AS INTEGER) = ?')
            .run(year, sem);
        return { success: true, count: info.changes };
    });

}

module.exports = { registerGradesIpc };
