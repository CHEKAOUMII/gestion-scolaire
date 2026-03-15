const { handleRead, normalizeYear } = require('./ipc-helpers');
const { validateDate } = require('./validation');
const { resolveTeacherIdentity } = require('../teachers/identity');

function registerStaffAttendanceIpc(ipcMain) {
    // Fallback: extract unique teachers from the grades table (grouped by name)
    handleRead(ipcMain, 'teachers:getFromGrades', (db, schoolYear) => {
        return db
            .prepare(
                `
            SELECT
                COALESCE(g.teacher_id, 0) as id,
                COALESCE(t.full_name, g.teacher_name) as full_name,
                GROUP_CONCAT(DISTINCT g.subject) as subject
            FROM grades g
            LEFT JOIN teachers t ON t.id = g.teacher_id
            WHERE g.school_year = ?
              AND COALESCE(t.full_name, g.teacher_name) IS NOT NULL
              AND TRIM(COALESCE(t.full_name, g.teacher_name)) <> ''
            GROUP BY COALESCE(g.teacher_id, 0), COALESCE(t.full_name, g.teacher_name)
            ORDER BY COALESCE(t.full_name, g.teacher_name)
        `
            )
            .all(normalizeYear(schoolYear));
    });

    // ── Staff Attendance CRUD ──

    handleRead(ipcMain, 'staffAttendance:getAll', (db, schoolYear) => {
        return db
            .prepare(
                `
            SELECT sa.*,
                   COALESCE(t.full_name, sa.teacher_name) as full_name,
                   COALESCE(sa.subject, t.subject, '') as subject
            FROM staff_attendance sa
            LEFT JOIN teachers t ON t.id = sa.teacher_id
            WHERE sa.school_year = ?
            ORDER BY sa.attendance_date DESC, sa.created_at DESC
        `
            )
            .all(normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'staffAttendance:save', (db, payload) => {
        if (payload.attendance_date) {
            validateDate('attendance_date', payload.attendance_date);
        }
        const type = payload.type === 'late' ? 'late' : 'absence';
        const year = normalizeYear(payload.school_year);
        const resolved = resolveTeacherIdentity(db, {
            teacher_id: payload.teacher_id,
            teacher_name: payload.teacher_name,
            subject: payload.subject,
            school_year: year,
            source: 'staffAttendance'
        });
        db.prepare(
            `
            INSERT INTO staff_attendance(teacher_id, teacher_name, subject, attendance_date, type, late_duration, arrival_time, reason, notes, school_year)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
            resolved.teacher_id || null,
            resolved.teacher_name || payload.teacher_name || null,
            resolved.subject || payload.subject || null,
            payload.attendance_date,
            type,
            type === 'late' ? Number(payload.late_duration) || null : null,
            type === 'late' ? payload.arrival_time || null : null,
            payload.reason || null,
            payload.notes || null,
            year
        );
        return { success: true };
    });

    handleRead(ipcMain, 'staffAttendance:delete', (db, id) => {
        const recordId = Number(id);
        if (!Number.isFinite(recordId) || recordId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        db.prepare('DELETE FROM staff_attendance WHERE id = ?').run(recordId);
        return { success: true };
    });
}

module.exports = { registerStaffAttendanceIpc };
