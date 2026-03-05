const { handleRead, handleWrite, handleWriteNoAuth, normalizeYear } = require('./ipc-helpers');

function registerStudentsIpc(ipcMain) {
    // ── Read handlers (no auth required — app starts without login) ──

    handleRead(ipcMain, 'students:getAll', (db, schoolYear) => {
        return db.prepare('SELECT * FROM students WHERE school_year = ? ORDER BY section, full_name').all(normalizeYear(schoolYear));
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
    handleWriteNoAuth(ipcMain, 'students:addBulk', (db, students) => {
        const insert = db.prepare(`
                INSERT OR REPLACE INTO students (code, full_name, family_name, birth_date, birth_place, gender, section, school_year, status, registration_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
        const insertMany = db.transaction((items) => {
            for (const student of items) {
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

    // No auth: used by settings-imports page to clear data before re-import
    handleWriteNoAuth(ipcMain, 'students:deleteByYear', (db, schoolYear) => {
        const year = normalizeYear(schoolYear);
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

    // ── Settings (read = open, write = admin only) ──

    handleRead(ipcMain, 'settings:get', (db, key) => {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        return row ? row.value : null;
    });

    handleWrite(ipcMain, 'settings:set', ['admin'], (db, _event, key, value) => {
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
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

    handleRead(ipcMain, 'grades:getZeroStudents', (db, filters) => {
        filters = filters || {};
        const year = String(filters.schoolYear || '2025/2026').trim();
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
        } catch (_) {
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
        db.prepare(
            `
                INSERT OR REPLACE INTO grades (student_id, student_code, subject, grade, semester, teacher_name, level, section, school_year)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
        ).run(
            grade.student_id,
            grade.student_code,
            grade.subject,
            grade.grade,
            grade.semester,
            grade.teacher_name || '',
            grade.level || '',
            grade.section || '',
            grade.school_year
        );
        return { success: true };
    });

    // No auth: bulk-import is used by settings-imports page before login
    handleWriteNoAuth(ipcMain, 'grades:saveBulk', (db, grades) => {
        const insert = db.prepare(`
                INSERT OR REPLACE INTO grades (student_id, student_code, subject, grade, semester, teacher_name, level, section, school_year)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
        const insertMany = db.transaction((items) => {
            for (const grade of items) {
                insert.run(
                    grade.student_id,
                    grade.student_code,
                    grade.subject,
                    grade.grade,
                    grade.semester,
                    grade.teacher_name || '',
                    grade.level || '',
                    grade.section || '',
                    grade.school_year
                );
            }
        });
        insertMany(grades);
        return { success: true, count: grades.length };
    });

    // No auth: used by settings-imports page to clear data before re-import
    handleWriteNoAuth(ipcMain, 'grades:deleteByYear', (db, schoolYear) => {
        const info = db.prepare('DELETE FROM grades WHERE school_year = ?').run(normalizeYear(schoolYear));
        return { success: true, count: info.changes };
    });

    // No auth: used by settings-imports page to clear grades for a specific semester
    handleWriteNoAuth(ipcMain, 'grades:deleteBySemester', (db, schoolYear, semester) => {
        const year = normalizeYear(schoolYear);
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

        const normalizeSubjectName = (subject) =>
            String(subject || '')
                .replace(/\s*\(\s*فرض\s*[0-9\u0660-\u0669]+\s*\)\s*$/i, '')
                .replace(/\s*\(الأنشطة المندمجة\)\s*$/, '')
                .trim();

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
}

module.exports = { registerStudentsIpc };
