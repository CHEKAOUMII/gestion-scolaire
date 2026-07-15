const { handleRead, handleWrite, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { requireFields, normalizePagination, buildPaginatedResult } = require('./validation');

function registerStudentsIpc(ipcMain) {

    handleRead(ipcMain, 'students:getAll', (db, schoolYear) => {
        return db
            .prepare('SELECT * FROM students WHERE school_year = ? ORDER BY section, full_name')
            .all(normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'students:list', (db, schoolYear, options = {}) => {
        const year = normalizeYear(schoolYear);
        const { page, pageSize, offset } = normalizePagination(options);
        const total = db.prepare('SELECT COUNT(*) AS c FROM students WHERE school_year = ?').get(year).c;
        const rows = db
            .prepare(
                `SELECT * FROM students WHERE school_year = ?
                 ORDER BY section, full_name
                 LIMIT ? OFFSET ?`
            )
            .all(year, pageSize, offset);
        return buildPaginatedResult(rows, total, page, pageSize);
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

    handleWrite(ipcMain, 'students:add', WRITE_ROLES, (db, _event, student) => {
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
    handleWriteSoftAuth(ipcMain, 'students:addBulk', WRITE_ROLES, (db, students) => {
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
    }, { allowNoSession: true });

    handleWrite(ipcMain, 'students:update', WRITE_ROLES, (db, _event, id, data) => {
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

    handleWrite(ipcMain, 'students:delete', WRITE_ROLES, (db, _event, id) => {
        const studentId = Number(id);
        if (!Number.isFinite(studentId) || studentId <= 0) {
            return { success: false, error: 'Invalid student id' };
        }

        db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
        return { success: true };
    });

    // No auth: delete is used from settings-imports page which may be opened before login
    handleWriteSoftAuth(ipcMain, 'students:deleteByYear', WRITE_ROLES, (db, schoolYear) => {
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

    handleWriteSoftAuth(ipcMain, 'students:updateStatusBulk', WRITE_ROLES, (db, items) => {
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
}

module.exports = { registerStudentsIpc };
