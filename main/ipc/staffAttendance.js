const { handleRead, handleWrite, normalizeYear } = require('./ipc-helpers');
const { validateDate } = require('./validation');

function registerStaffAttendanceIpc(ipcMain) {

    // Fallback: extract unique teachers from the grades table (grouped by name)
    handleRead(ipcMain, 'teachers:getFromGrades', (db, schoolYear) => {
        return db.prepare(`
            SELECT teacher_name as full_name,
                   GROUP_CONCAT(DISTINCT subject) as subject
            FROM grades
            WHERE school_year = ?
              AND teacher_name IS NOT NULL AND TRIM(teacher_name) <> ''
            GROUP BY teacher_name
            ORDER BY teacher_name
        `).all(normalizeYear(schoolYear));
    });

    // ── Staff Attendance CRUD ──

    handleRead(ipcMain, 'staffAttendance:getAll', (db, schoolYear) => {
        return db.prepare(`
            SELECT sa.*,
                   COALESCE(t.full_name, sa.teacher_name) as full_name,
                   COALESCE(sa.subject, t.subject, '') as subject
            FROM staff_attendance sa
            LEFT JOIN teachers t ON t.id = sa.teacher_id
            WHERE sa.school_year = ?
            ORDER BY sa.attendance_date DESC, sa.created_at DESC
        `).all(normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'staffAttendance:save', (db, payload) => {
        if (payload.attendance_date) {
            validateDate('attendance_date', payload.attendance_date);
        }
        const type = payload.type === 'late' ? 'late' : 'absence';
        const teacherId = Number(payload.teacher_id);
        db.prepare(`
            INSERT INTO staff_attendance(teacher_id, teacher_name, subject, attendance_date, type, late_duration, arrival_time, reason, notes, school_year)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            Number.isFinite(teacherId) && teacherId > 0 ? teacherId : null,
            payload.teacher_name || null,
            payload.subject || null,
            payload.attendance_date,
            type,
            type === 'late' ? (Number(payload.late_duration) || null) : null,
            type === 'late' ? (payload.arrival_time || null) : null,
            payload.reason || null,
            payload.notes || null,
            payload.school_year
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
