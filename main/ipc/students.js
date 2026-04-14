const { handleRead, handleWrite, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { requireFields, validateRange } = require('./validation');
const { normalizeSubjectName } = require('../../js/data/ma-education-labels');
const { resolveTeacherIdentity } = require('../teachers/identity');

function registerStudentsIpc(ipcMain) {
    // ── Read handlers (no auth required — app starts without login) ──

    handleRead(ipcMain, 'students:getAll', (db, schoolYear) => {
        return db
            .prepare('SELECT * FROM students WHERE school_year = ? ORDER BY section, full_name')
            .all(normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'students:getCodesByYear', (db, schoolYear) => {
        return db
            .prepare(
                `SELECT id, code, full_name, section, status
                 FROM students
                 WHERE school_year = ? AND status = 'active'
                 ORDER BY section, full_name`
            )
            .all(normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'students:getByCode', (db, code, schoolYear) => {
        const year = normalizeYear(schoolYear);
        const codeQ = String(code || '').trim();
        if (!codeQ) return null;

        const row = db
            .prepare(
                `
            SELECT *
            FROM students
            WHERE school_year = ? AND code = ?
            LIMIT 1
        `
            )
            .get(year, codeQ);

        if (!row) return null;

        return {
            ...row,
            massar_code: row.code,
            class_name: row.section
        };
    });

    handleRead(ipcMain, 'students:search', (db, name, className, code, schoolYear) => {
        const year = normalizeYear(schoolYear);
        const nameQ = String(name || '').trim();
        const classQ = String(className || '').trim();
        const codeQ = String(code || '').trim();
        const rows = db
            .prepare(
                `
            SELECT *
            FROM students
            WHERE school_year = ?
            AND(? = '' OR full_name LIKE ? OR family_name LIKE ? OR code LIKE ?)
            AND(? = '' OR section = ?)
            AND(? = '' OR code LIKE ?)
            ORDER BY section, full_name
        `
            )
            .all(year, nameQ, `%${nameQ}%`, `%${nameQ}%`, `%${nameQ}%`, classQ, classQ, codeQ, `%${codeQ}%`);
        return rows.map((r) => ({
            ...r,
            massar_code: r.code,
            class_name: r.section
        }));
    });

    // ── Write handlers (require admin or staff role) ──

    handleWrite(ipcMain, 'students:add', ['admin', 'staff'], (db, _event, student) => {
        requireFields(student, ['code', 'full_name', 'school_year']);
        requireSchoolYear(student.school_year);
        db.prepare(
            `
                INSERT INTO students(code, full_name, family_name, birth_date, birth_place, gender, section, school_year, status, registration_type)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
        ).run(
            student.code,
            student.full_name,
            student.family_name,
            student.birth_date,
            student.birth_place || '',
            student.gender,
            student.section,
            student.school_year,
            student.status || 'active',
            student.registration_type || 'new'
        );
        return { success: true };
    });

    // No auth: bulk-import is used by settings-imports page before login
    handleWriteSoftAuth(ipcMain, 'students:addBulk', ['admin', 'staff'], (db, students) => {
        if (!Array.isArray(students)) {
            return { success: false, error: 'Expected an array' };
        }
        if (students.length > 5000) {
            return { success: false, error: 'Batch size exceeds maximum of 5000' };
        }
        const insert = db.prepare(`
                INSERT INTO students (code, full_name, family_name, birth_date, birth_place, gender, section, school_year, status, registration_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(code, school_year) DO UPDATE SET
                    full_name=excluded.full_name,
                    family_name=excluded.family_name,
                    birth_date=excluded.birth_date,
                    birth_place=excluded.birth_place,
                    gender=excluded.gender,
                    section=excluded.section,
                    status=excluded.status,
                    registration_type=excluded.registration_type
            `);
        const insertMany = db.transaction((items) => {
            for (const student of items) {
                requireFields(student, ['code', 'full_name', 'school_year']);
                requireSchoolYear(student.school_year);
                insert.run(
                    student.code,
                    student.full_name,
                    student.family_name,
                    student.birth_date,
                    student.birth_place || '',
                    student.gender,
                    student.section,
                    student.school_year,
                    student.status || 'active',
                    student.registration_type || 'new'
                );
            }
        });
        insertMany(students);
        return { success: true, count: students.length };
    });

    handleWrite(ipcMain, 'students:update', ['admin', 'staff'], (db, _event, id, data) => {
        const studentId = Number(id);
        if (!Number.isFinite(studentId) || studentId <= 0) {
            return { success: false, error: 'Invalid student id' };
        }

        const allowedFields = [
            'code',
            'full_name',
            'family_name',
            'birth_date',
            'birth_place',
            'gender',
            'section',
            'school_year',
            'status',
            'registration_type'
        ];

        const updates = allowedFields
            .filter((field) => data && Object.prototype.hasOwnProperty.call(data, field))
            .map((field) => ({ field, value: data[field] }));

        if (!updates.length) {
            return { success: false, error: 'No valid fields to update' };
        }

        if (Object.prototype.hasOwnProperty.call(data || {}, 'school_year')) {
            requireSchoolYear(data.school_year);
        }

        const setClause = updates.map((item) => `${item.field} = ?`).join(', ');
        const values = updates.map((item) => item.value);
        values.push(studentId);

        db.prepare(`UPDATE students SET ${setClause} WHERE id = ?`).run(...values);
        return { success: true };
    });

    handleWrite(ipcMain, 'students:delete', ['admin', 'staff'], (db, _event, id) => {
        const studentId = Number(id);
        if (!Number.isFinite(studentId) || studentId <= 0) {
            return { success: false, error: 'Invalid student id' };
        }

        db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
        return { success: true };
    });

    // No auth: delete is used from settings-imports page which may be opened before login
    handleWriteSoftAuth(ipcMain, 'students:deleteByYear', ['admin', 'staff'], (db, schoolYear) => {
        const year = requireSchoolYear(schoolYear);
        const runDelete = db.transaction((targetYear) => {
            db.prepare('DELETE FROM grades WHERE school_year = ?').run(targetYear);
            db.prepare('DELETE FROM absences WHERE school_year = ?').run(targetYear);
            db.prepare('DELETE FROM correspondence WHERE school_year = ?').run(targetYear);
            db.prepare('DELETE FROM student_files WHERE school_year = ?').run(targetYear);
            db.prepare('DELETE FROM student_movements WHERE school_year = ?').run(targetYear);
            return db.prepare('DELETE FROM students WHERE school_year = ?').run(targetYear).changes;
        });
        const count = runDelete(year);
        return { success: true, count };
    });

    // ── Student status tracking (read = open, write = admin/staff) ──

    handleRead(ipcMain, 'students:getByStatus', (db, filters) => {
        filters = filters || {};
        const year = normalizeYear(filters.schoolYear);
        const statusFilter = String(filters.status || '').trim();
        const sectionFilter = String(filters.section || '').trim();
        const searchTerm = String(filters.searchTerm || '').trim();

        // Non-active statuses
        const validStatuses = ['dropout', 'expelled', 'not_enrolled', 'transferred_in'];

        const whereParts = ['s.school_year = ?'];
        const params = [year];

        if (statusFilter && validStatuses.includes(statusFilter)) {
            whereParts.push('s.status = ?');
            params.push(statusFilter);
        } else {
            // Show all non-active students
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

        // Get rows with optional movement info
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

        // Summary counts (always for full year, ignoring search/section filters)
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
            WHERE school_year = ?
              AND status IN ('dropout', 'expelled', 'not_enrolled', 'transferred_in')
        `
            )
            .get(year);

        const totalStudents = db.prepare('SELECT COUNT(*) AS total FROM students WHERE school_year = ?').get(year);

        return {
            success: true,
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
    });

    handleWriteSoftAuth(ipcMain, 'students:updateStatusBulk', ['admin', 'staff'], (db, items) => {
        if (!Array.isArray(items)) {
            return { success: false, error: 'Expected an array' };
        }
        if (items.length > 500) {
            return { success: false, error: 'Batch size exceeds maximum of 500' };
        }

        const validStatuses = ['active', 'dropout', 'expelled', 'not_enrolled', 'transferred_in'];
        const updateStmt = db.prepare('UPDATE students SET status = ? WHERE id = ?');

        const updateMany = db.transaction((entries) => {
            let updated = 0;
            for (const item of entries) {
                const id = Number(item.student_id);
                const status = String(item.status || '').trim();
                if (!Number.isFinite(id) || id <= 0) continue;
                if (!validStatuses.includes(status)) continue;
                const info = updateStmt.run(status, id);
                updated += info.changes;
            }
            return updated;
        });

        const count = updateMany(items);
        return { success: true, count };
    });

    // ── Settings (read = open, write = admin only) ──

    handleRead(ipcMain, 'settings:get', (db, key) => {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        return row ? row.value : null;
    });

    const ALLOWED_SETTINGS_KEYS = new Set([
        'currentSchoolYear',
        'schoolYear',
        'levels',
        'levelsMapping',
        'pageVisibilityMap',
        'school_info'
    ]);

    handleWrite(ipcMain, 'settings:set', ['admin'], (db, _event, key, value) => {
        if (!ALLOWED_SETTINGS_KEYS.has(key)) {
            return { success: false, error: 'Invalid setting key' };
        }
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
        return { success: true };
    });

    // No auth: allow changing the current school year without requiring admin session
    handleWriteSoftAuth(ipcMain, 'settings:setSchoolYear', ['admin', 'staff'], (db, year) => {
        const nextYear = requireSchoolYear(year);
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('currentSchoolYear', ?)").run(nextYear);
        return { success: true };
    });

    // ── Grades (read = open, write = admin/staff) ──

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

    handleWrite(ipcMain, 'grades:save', ['admin', 'staff'], (db, _event, grade) => {
        validateRange('grade', grade.grade, 0, 20);
        requireSchoolYear(grade.school_year);
        const resolvedTeacher = resolveTeacherIdentity(db, {
            teacher_id: grade.teacher_id,
            teacher_name: grade.teacher_name,
            school_year: grade.school_year,
            source: 'grades:save'
        });
        db.prepare(
            `
                INSERT OR REPLACE INTO grades (student_id, student_code, teacher_id, subject, grade, semester, teacher_name, level, section, school_year)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    handleWriteSoftAuth(ipcMain, 'grades:saveBulk', ['admin', 'staff'], (db, grades) => {
        if (!Array.isArray(grades)) {
            return { success: false, error: 'Expected an array' };
        }
        if (grades.length > 5000) {
            return { success: false, error: 'Batch size exceeds maximum of 5000' };
        }
        const insert = db.prepare(`
                INSERT OR REPLACE INTO grades (student_id, student_code, teacher_id, subject, grade, semester, teacher_name, level, section, school_year)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    });

    handleWriteSoftAuth(ipcMain, 'grades:reassignTeacherBulk', ['admin', 'staff'], (db, payload) => {
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
    handleWriteSoftAuth(ipcMain, 'grades:deleteByYear', ['admin', 'staff'], (db, schoolYear) => {
        const info = db.prepare('DELETE FROM grades WHERE school_year = ?').run(requireSchoolYear(schoolYear));
        return { success: true, count: info.changes };
    });

    handleWriteSoftAuth(ipcMain, 'grades:deleteBySemester', ['admin', 'staff'], (db, schoolYear, semester) => {
        const year = requireSchoolYear(schoolYear);
        const sem = parseInt(semester, 10) || 1;
        const info = db
            .prepare('DELETE FROM grades WHERE school_year = ? AND CAST(semester AS INTEGER) = ?')
            .run(year, sem);
        return { success: true, count: info.changes };
    });

    // ── Statistics (read = open) ──

    handleRead(ipcMain, 'stats:get', (db, schoolYear) => {
        const year = normalizeYear(schoolYear);

        // Total students
        const { total: totalStudents } = db
            .prepare('SELECT COUNT(*) as total FROM students WHERE school_year = ?')
            .get(year);

        // By gender
        const genderRows = db
            .prepare('SELECT gender, COUNT(*) as count FROM students WHERE school_year = ? GROUP BY gender')
            .all(year);
        const byGender = {};
        for (const row of genderRows) byGender[row.gender] = row.count;

        // By section
        const sectionRows = db
            .prepare('SELECT section, COUNT(*) as count FROM students WHERE school_year = ? GROUP BY section')
            .all(year);
        const bySection = {};
        for (const row of sectionRows) bySection[row.section] = row.count;

        return {
            totalStudents,
            maleCount: byGender['ذكر'] || 0,
            femaleCount: byGender['أنثى'] || 0,
            bySection
        };
    });

    // ── Catalogs/lookup (read = open) ──

    handleRead(ipcMain, 'classes:getAll', (db, schoolYear) => {
        const rows = db
            .prepare(
                `
            SELECT section
            FROM students
            WHERE school_year = ? AND section IS NOT NULL AND TRIM(section) <> ''
            GROUP BY section
            ORDER BY section
        `
            )
            .all(normalizeYear(schoolYear));
        return rows.map((r) => ({ name: r.section }));
    });

    handleRead(ipcMain, 'subjects:getAll', (db) => {
        const rows = db
            .prepare(
                `
            SELECT subject
            FROM grades
            WHERE subject IS NOT NULL AND TRIM(subject) <> ''
            GROUP BY subject
            ORDER BY subject
        `
            )
            .all();

        // Subject normalization — uses normalizeSubjectName() from js/data/ma-education-labels.js
        const invalidSubjectNames = new Set(['sheet', 'sheet1', 'feuil1', 'notes', 'notescc', 'note', 'ورقة1', 'ورقة']);
        const uniqueSubjects = new Set();

        rows.forEach((row) => {
            const clean = normalizeSubjectName(row.subject);
            if (!clean) return;
            if (invalidSubjectNames.has(clean.toLowerCase())) return;
            uniqueSubjects.add(clean);
        });

        return Array.from(uniqueSubjects)
            .sort((a, b) => a.localeCompare(b, 'ar'))
            .map((name) => ({ name }));
    });

    // ── Student profile data (read = open, write = admin/staff) ──

    handleRead(ipcMain, 'studentProfile:getAllTabs', (db, studentCode, schoolYear) => {
        const code = String(studentCode || '').trim();
        const year = normalizeYear(schoolYear);
        if (!code) return [];
        return db
            .prepare('SELECT * FROM student_profile_data WHERE student_code = ? AND school_year = ?')
            .all(code, year);
    });

    handleWriteSoftAuth(ipcMain, 'studentProfile:saveTab', ['admin', 'staff'], (db, payload) => {
        requireFields(payload, ['student_code', 'tab_key', 'school_year']);
        requireSchoolYear(payload.school_year);

        const validTabs = ['economic', 'social', 'health', 'followup'];
        const tabKey = String(payload.tab_key || '').trim();
        if (!validTabs.includes(tabKey)) {
            return { success: false, error: 'Invalid tab_key' };
        }

        const studentCode = String(payload.student_code).trim();
        const dataJson = typeof payload.data_json === 'string'
            ? payload.data_json
            : JSON.stringify(payload.data_json || {});

        db.prepare(`
            INSERT INTO student_profile_data (student_id, student_code, tab_key, data_json, school_year, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
            ON CONFLICT(student_code, tab_key, school_year) DO UPDATE SET
                data_json = excluded.data_json,
                updated_at = CURRENT_TIMESTAMP,
                updated_by = excluded.updated_by
        `).run(
            Number(payload.student_id) || 0,
            studentCode,
            tabKey,
            dataJson,
            payload.school_year,
            payload.updated_by || null
        );
        return { success: true };
    });
}

module.exports = { registerStudentsIpc };
