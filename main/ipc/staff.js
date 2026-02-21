const { getDb } = require('../db/context');
const { requireRole } = require('./auth');

function authErrorResponse(err) {
    const isAuthError = err?.code === 'UNAUTHENTICATED' || err?.code === 'FORBIDDEN';
    return {
        success: false,
        code: isAuthError ? err.code : 'INTERNAL_ERROR',
        error: err?.message || (isAuthError ? 'غير مصرح' : 'حدث خطأ داخلي')
    };
}

function registerStaffIpc(ipcMain) {
    // ── Read handlers (no auth required) ──

    ipcMain.handle('teachers:getAll', async (event, schoolYear) => {
        const db = getDb();
        const year = schoolYear || '2025/2026';
        return db.prepare('SELECT * FROM teachers WHERE school_year = ? ORDER BY full_name').all(year);
    });

    // ── Write handlers (require admin or staff role) ──

    ipcMain.handle('teachers:add', async (event, teacher) => {
        try {
            requireRole(event, ['admin', 'staff']);
            const db = getDb();
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
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    ipcMain.handle('teachers:update', async (event, id, data) => {
        try {
            requireRole(event, ['admin', 'staff']);
            const db = getDb();
            const ALLOWED_COLUMNS = new Set(['full_name', 'subject', 'phone', 'email', 'school_year', 'active']);
            const safeEntries = Object.entries(data).filter(([k]) => ALLOWED_COLUMNS.has(k));
            if (!safeEntries.length) {
                return { success: false, error: 'No valid fields to update' };
            }
            const fields = safeEntries.map(([k]) => `${k} = ?`).join(', ');
            const values = [...safeEntries.map(([, v]) => v), id];
            db.prepare(`UPDATE teachers SET ${fields} WHERE id = ?`).run(...values);
            return { success: true };
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    ipcMain.handle('teachers:delete', async (event, id) => {
        try {
            requireRole(event, ['admin']);
            const db = getDb();
            db.prepare('DELETE FROM teachers WHERE id = ?').run(id);
            return { success: true };
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    // ── Teacher absences (read = open, write = admin/staff) ──

    ipcMain.handle('teacherAbsences:getAll', async (event, schoolYear) => {
        const db = getDb();
        const year = schoolYear || '2025/2026';
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
            .all(year);
    });

    ipcMain.handle('teacherAbsences:save', async (event, payload) => {
        try {
            requireRole(event, ['admin', 'staff']);
            const db = getDb();
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
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    ipcMain.handle('teacherAbsences:delete', async (event, id) => {
        try {
            requireRole(event, ['admin', 'staff']);
            const db = getDb();
            db.prepare('DELETE FROM teacher_absences WHERE id = ?').run(id);
            return { success: true };
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    ipcMain.handle('teacherAbsence:getAll', async (event, schoolYear) => {
        const db = getDb();
        const year = schoolYear || '2025/2026';
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
            .all(year);
    });

    ipcMain.handle('teacherAbsence:add', async (event, payload) => {
        try {
            requireRole(event, ['admin', 'staff']);
            const db = getDb();
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
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    ipcMain.handle('teacherAbsence:delete', async (event, id) => {
        try {
            requireRole(event, ['admin', 'staff']);
            const db = getDb();
            db.prepare('DELETE FROM teacher_absences WHERE id = ?').run(id);
            return { success: true };
        } catch (err) {
            return authErrorResponse(err);
        }
    });
}

module.exports = { registerStaffIpc };
