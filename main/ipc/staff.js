const { handleRead, handleWrite, normalizeYear } = require('./ipc-helpers');

function registerStaffIpc(ipcMain) {
    // ── Read handlers (no auth required) ──

    handleRead(ipcMain, 'teachers:getAll', (db, schoolYear) => {
        return db.prepare('SELECT * FROM teachers WHERE school_year = ? ORDER BY full_name').all(normalizeYear(schoolYear));
    });

    // ── Write handlers (require admin or staff role) ──

    handleWrite(ipcMain, 'teachers:add', ['admin', 'staff'], (db, _event, teacher) => {
        db.prepare(
            `
                INSERT INTO teachers(full_name, subject, phone, email, school_year, active)
                VALUES(?, ?, ?, ?, ?, ?)
            `
        ).run(
            teacher.full_name,
            teacher.subject || null,
            teacher.phone || null,
            teacher.email || null,
            teacher.school_year,
            teacher.active == null ? 1 : teacher.active ? 1 : 0
        );
        return { success: true };
    });

    handleWrite(ipcMain, 'teachers:update', ['admin', 'staff'], (db, _event, id, data) => {
        const ALLOWED_COLUMNS = new Set(['full_name', 'subject', 'phone', 'email', 'school_year', 'active']);
        const safeEntries = Object.entries(data).filter(([k]) => ALLOWED_COLUMNS.has(k));
        if (!safeEntries.length) {
            return { success: false, error: 'No valid fields to update' };
        }
        const fields = safeEntries.map(([k]) => `${k} = ?`).join(', ');
        const values = [...safeEntries.map(([, v]) => v), id];
        db.prepare(`UPDATE teachers SET ${fields} WHERE id = ?`).run(...values);
        return { success: true };
    });

    handleWrite(ipcMain, 'teachers:delete', ['admin'], (db, _event, id) => {
        db.prepare('DELETE FROM teachers WHERE id = ?').run(id);
        return { success: true };
    });

    // ── Teacher absences (read = open, write = admin/staff) ──

    handleRead(ipcMain, 'teacherAbsences:getAll', (db, schoolYear) => {
        return db
            .prepare(
                `
            SELECT a.*, t.full_name
            FROM teacher_absences a
            LEFT JOIN teachers t ON t.id = a.teacher_id
            WHERE a.school_year = ?
            ORDER BY a.absence_date DESC
        `
            )
            .all(normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'teacherAbsences:save', ['admin', 'staff'], (db, _event, payload) => {
        db.prepare(
            `
                INSERT INTO teacher_absences(teacher_id, absence_date, reason, replacement_teacher, school_year)
                VALUES(?, ?, ?, ?, ?)
            `
        ).run(
            payload.teacher_id,
            payload.absence_date,
            payload.reason || null,
            payload.replacement_teacher || null,
            payload.school_year
        );
        return { success: true };
    });

    handleWrite(ipcMain, 'teacherAbsences:delete', ['admin', 'staff'], (db, _event, id) => {
        db.prepare('DELETE FROM teacher_absences WHERE id = ?').run(id);
        return { success: true };
    });

    handleRead(ipcMain, 'teacherAbsence:getAll', (db, schoolYear) => {
        return db
            .prepare(
                `
            SELECT a.id,
            a.absence_date as date,
            a.reason,
            COALESCE(a.justified, 1) as justified,
            t.full_name as teacher
            FROM teacher_absences a
            LEFT JOIN teachers t ON t.id = a.teacher_id
            WHERE a.school_year = ?
            ORDER BY a.absence_date DESC, a.id DESC
        `
            )
            .all(normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'teacherAbsence:add', ['admin', 'staff'], (db, _event, payload) => {
        const year = payload.school_year || '2025/2026';
        const teacherName = String(payload.teacher || '').trim();
        const teacher = db
            .prepare('SELECT id FROM teachers WHERE full_name = ? AND school_year = ? LIMIT 1')
            .get(teacherName, year);
        if (!teacher) return { success: false, error: 'Teacher not found' };

        db.prepare(
            `
                INSERT INTO teacher_absences(teacher_id, absence_date, reason, replacement_teacher, school_year, justified)
                VALUES(?, ?, ?, ?, ?, ?)
            `
        ).run(
            teacher.id,
            payload.date || null,
            payload.reason || null,
            null,
            year,
            payload.justified == null ? 1 : Number(payload.justified)
        );
        return { success: true };
    });

    handleWrite(ipcMain, 'teacherAbsence:delete', ['admin', 'staff'], (db, _event, id) => {
        db.prepare('DELETE FROM teacher_absences WHERE id = ?').run(id);
        return { success: true };
    });
}

module.exports = { registerStaffIpc };
