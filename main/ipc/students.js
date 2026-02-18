const { getDb } = require('../db/context');

function registerStudentsIpc(ipcMain) {
    // IPC Handlers - Students
    ipcMain.handle('students:getAll', async (event, schoolYear) => {
        const db = getDb();
        const year = schoolYear || '2025/2026';
        return db.prepare('SELECT * FROM students WHERE school_year = ? ORDER BY section, full_name').all(year);
    });

    ipcMain.handle('students:search', async (event, name = '', className = '', code = '', schoolYear) => {
        const db = getDb();
        const year = schoolYear || '2025/2026';
        const nameQ = String(name || '').trim();
        const classQ = String(className || '').trim();
        const codeQ = String(code || '').trim();
        const rows = db.prepare(`
            SELECT *
            FROM students
            WHERE school_year = ?
            AND(? = '' OR full_name LIKE ?)
            AND(? = '' OR section LIKE ?)
            AND(? = '' OR code LIKE ?)
            ORDER BY section, full_name
        `).all(year, nameQ, `%${nameQ}%`, classQ, `%${classQ}%`, codeQ, `%${codeQ}%`);
        return rows.map((r) => ({
            ...r,
            massar_code: r.code,
            class_name: r.section
        }));
    });

    ipcMain.handle('students:add', async (event, student) => {
        try {
            const db = getDb();
            db.prepare(`
                INSERT INTO students(code, full_name, family_name, birth_date, gender, section, school_year, status, registration_type)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                student.code,
                student.full_name,
                student.family_name,
                student.birth_date,
                student.gender,
                student.section,
                student.school_year,
                student.status || 'active',
                student.registration_type || 'new'
            );
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('students:addBulk', async (event, students) => {
        try {
            const db = getDb();
            const insert = db.prepare(`
                INSERT OR REPLACE INTO students (code, full_name, family_name, birth_date, gender, section, school_year, status, registration_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const insertMany = db.transaction((items) => {
                for (const student of items) {
                    insert.run(
                        student.code,
                        student.full_name,
                        student.family_name,
                        student.birth_date,
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
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('students:update', async (event, id, data) => {
        try {
            const db = getDb();
            const studentId = Number(id);
            if (!Number.isFinite(studentId) || studentId <= 0) {
                return { success: false, error: 'Invalid student id' };
            }

            const allowedFields = [
                'code',
                'full_name',
                'family_name',
                'birth_date',
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
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('students:delete', async (event, id) => {
        try {
            const db = getDb();
            const studentId = Number(id);
            if (!Number.isFinite(studentId) || studentId <= 0) {
                return { success: false, error: 'Invalid student id' };
            }

            db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('students:deleteByYear', async (event, schoolYear) => {
        try {
            const db = getDb();
            const year = schoolYear || '2025/2026';
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
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // IPC Handlers - Settings
    ipcMain.handle('settings:get', async (event, key) => {
        const db = getDb();
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        return row ? row.value : null;
    });

    ipcMain.handle('settings:set', async (event, key, value) => {
        try {
            const db = getDb();
            db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // IPC Handlers - Grades
    ipcMain.handle('grades:getAll', async (event, schoolYear) => {
        const db = getDb();
        const year = schoolYear || '2025/2026';
        return db.prepare(`
            SELECT g.*, s.full_name, s.section 
            FROM grades g 
            LEFT JOIN students s ON g.student_id = s.id 
            WHERE g.school_year = ?
        `).all(year);
    });

    ipcMain.handle('grades:getZeroStudents', async (event, filters = {}) => {
        try {
            const db = getDb();
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

            const whereParts = [
                'g.school_year = ?',
                'CAST(g.grade AS REAL) = 0'
            ];
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
                whereParts.push("(COALESCE(s.full_name, '') LIKE ? OR COALESCE(g.student_code, s.code, '') LIKE ? OR COALESCE(g.subject, '') LIKE ?)");
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

            const summary = db.prepare(`
                SELECT
                    COUNT(*) AS total_cases,
                    COUNT(DISTINCT student_code) AS unique_students,
                    COUNT(DISTINCT class_name) AS sections_count,
                    SUM(CASE WHEN absence_count > 0 THEN 1 ELSE 0 END) AS absence_linked_cases
                FROM (${baseQuery}) z
            `).get(...params);

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
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('grades:save', async (event, grade) => {
        try {
            const db = getDb();
            db.prepare(`
                INSERT OR REPLACE INTO grades (student_id, student_code, subject, grade, semester, teacher_name, level, section, school_year)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
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
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('grades:saveBulk', async (event, grades) => {
        try {
            const db = getDb();
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
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('grades:deleteByYear', async (event, schoolYear) => {
        try {
            const db = getDb();
            const year = schoolYear || '2025/2026';
            const info = db.prepare('DELETE FROM grades WHERE school_year = ?').run(year);
            return { success: true, count: info.changes };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // IPC Handlers - Statistics

    ipcMain.handle('stats:get', async (event, schoolYear) => {
        const db = getDb();
        const year = schoolYear || '2025/2026';

        // Total students
        const { total: totalStudents } = db.prepare('SELECT COUNT(*) as total FROM students WHERE school_year = ?').get(year);

        // By gender
        const genderRows = db.prepare('SELECT gender, COUNT(*) as count FROM students WHERE school_year = ? GROUP BY gender').all(year);
        const byGender = {};
        for (const row of genderRows) byGender[row.gender] = row.count;

        // By section
        const sectionRows = db.prepare('SELECT section, COUNT(*) as count FROM students WHERE school_year = ? GROUP BY section').all(year);
        const bySection = {};
        for (const row of sectionRows) bySection[row.section] = row.count;

        return {
            totalStudents,
            maleCount: byGender['ذكر'] || 0,
            femaleCount: byGender['أنثى'] || 0,
            bySection
        };
    });

    // IPC Handlers - Catalogs/lookup (compatibility)
    ipcMain.handle('classes:getAll', async (event, schoolYear) => {
        const db = getDb();
        const year = schoolYear || '2025/2026';
        const rows = db.prepare(`
            SELECT section
            FROM students
            WHERE school_year = ? AND section IS NOT NULL AND TRIM(section) <> ''
            GROUP BY section
            ORDER BY section
        `).all(year);
        return rows.map((r) => ({ name: r.section }));
    });

    ipcMain.handle('subjects:getAll', async () => {
        const db = getDb();
        const rows = db.prepare(`
            SELECT subject
            FROM grades
            WHERE subject IS NOT NULL AND TRIM(subject) <> ''
            GROUP BY subject
            ORDER BY subject
        `).all();

        const normalizeSubjectName = (subject) => String(subject || '')
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
