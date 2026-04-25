const { handleRead, handleWrite, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { validateDate } = require('./validation');
const { resolveTeacherIdentity } = require('../teachers/identity');

function getCanonicalTeacherName(resolved, payload) {
    return String(resolved?.teacher_name || resolved?.teacherName || payload?.teacher_name || '').trim();
}

function getCanonicalAbsencePeriod(type, payload) {
    return type === 'absence' ? String(payload?.absence_period || 'full_day').trim() || 'full_day' : null;
}

function findAttendanceConflict(db, { recordId = null, teacherId, teacherName, attendanceDate, type, absencePeriod, schoolYear }) {
    const teacherIdValue = Number(teacherId) > 0 ? Number(teacherId) : null;
    const teacherNameValue = String(teacherName || '').trim();

    if (type === 'late') {
        return db.prepare(`
            SELECT id
            FROM staff_attendance
            WHERE school_year = ?
              AND attendance_date = ?
              AND type = 'late'
              AND COALESCE(teacher_id, -1) = COALESCE(?, -1)
              AND COALESCE(teacher_name, '') = ?
              AND (? IS NULL OR id != ?)
            LIMIT 1
        `).get(
            schoolYear,
            attendanceDate,
            teacherIdValue,
            teacherNameValue,
            recordId,
            recordId
        );
    }

    return db.prepare(`
        SELECT id
        FROM staff_attendance
        WHERE school_year = ?
          AND attendance_date = ?
          AND type = 'absence'
          AND COALESCE(teacher_id, -1) = COALESCE(?, -1)
          AND COALESCE(teacher_name, '') = ?
          AND COALESCE(absence_period, 'full_day') = ?
          AND (? IS NULL OR id != ?)
        LIMIT 1
    `).get(
        schoolYear,
        attendanceDate,
        teacherIdValue,
        teacherNameValue,
        String(absencePeriod || 'full_day'),
        recordId,
        recordId
    );
}

function registerStaffAttendanceIpc(ipcMain) {
    // Build teacher options from canonical teachers first, then append unresolved grade-only names.
    handleRead(ipcMain, 'teachers:getFromGrades', (db, schoolYear) => {
        return db
            .prepare(
                `
            WITH canonical_teachers AS (
                SELECT
                    t.id AS id,
                    t.full_name AS full_name,
                    COALESCE(
                        GROUP_CONCAT(DISTINCT NULLIF(TRIM(g.subject), '')),
                        NULLIF(TRIM(t.subject), '')
                    ) AS subject
                FROM teachers t
                LEFT JOIN grades g
                    ON g.school_year = t.school_year
                   AND (
                        g.teacher_id = t.id
                        OR (
                            (g.teacher_id IS NULL OR g.teacher_id <= 0)
                            AND TRIM(COALESCE(g.teacher_name, '')) = TRIM(t.full_name)
                        )
                   )
                WHERE t.school_year = ?
                  AND TRIM(COALESCE(t.full_name, '')) <> ''
                GROUP BY t.id, t.full_name, t.subject
            ),
            unresolved_grade_teachers AS (
                SELECT
                    NULL AS id,
                    TRIM(g.teacher_name) AS full_name,
                    GROUP_CONCAT(DISTINCT NULLIF(TRIM(g.subject), '')) AS subject
                FROM grades g
                LEFT JOIN teachers t
                    ON t.school_year = g.school_year
                   AND TRIM(COALESCE(t.full_name, '')) = TRIM(COALESCE(g.teacher_name, ''))
                WHERE g.school_year = ?
                  AND (g.teacher_id IS NULL OR g.teacher_id <= 0)
                  AND TRIM(COALESCE(g.teacher_name, '')) <> ''
                  AND t.id IS NULL
                GROUP BY TRIM(g.teacher_name), COALESCE(NULLIF(TRIM(g.subject), ''), '')
            )
            SELECT id, full_name, subject
            FROM canonical_teachers
            UNION ALL
            SELECT id, full_name, subject
            FROM unresolved_grade_teachers
            ORDER BY full_name, COALESCE(subject, '')
        `
            )
            .all(normalizeYear(schoolYear), normalizeYear(schoolYear));
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

    handleWrite(ipcMain, 'staffAttendance:save', WRITE_ROLES, (db, _event, payload) => {
        if (payload.attendance_date) {
            validateDate('attendance_date', payload.attendance_date);
        }
        const type = payload.type === 'late' ? 'late' : 'absence';
        const year = requireSchoolYear(payload.school_year);
        const resolved = resolveTeacherIdentity(db, {
            teacher_id: payload.teacher_id,
            teacher_name: payload.teacher_name,
            subject: payload.subject,
            school_year: year,
            source: 'staffAttendance'
        });
        const canonicalTeacherName = getCanonicalTeacherName(resolved, payload);
        const canonicalAbsencePeriod = getCanonicalAbsencePeriod(type, payload);
        const conflict = findAttendanceConflict(db, {
            teacherId: resolved.teacher_id || null,
            teacherName: canonicalTeacherName,
            attendanceDate: payload.attendance_date,
            type,
            absencePeriod: canonicalAbsencePeriod,
            schoolYear: year
        });
        if (conflict) {
            return { success: true, duplicate: true, id: conflict.id };
        }

        const result = db.prepare(
            `
            INSERT OR IGNORE INTO staff_attendance(teacher_id, teacher_name, subject, attendance_date, type, late_duration, arrival_time, reason, notes, absence_period, school_year)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
            resolved.teacher_id || null,
            canonicalTeacherName || null,
            resolved.subject || payload.subject || null,
            payload.attendance_date,
            type,
            type === 'late' ? Number(payload.late_duration) || null : null,
            type === 'late' ? payload.arrival_time || null : null,
            payload.reason || null,
            payload.notes || null,
            canonicalAbsencePeriod,
            year
        );
        return {
            success: true,
            duplicate: result.changes === 0,
            id: result.lastInsertRowid || conflict?.id || null
        };
    });

    handleWrite(ipcMain, 'staffAttendance:update', WRITE_ROLES, (db, _event, payload) => {
        const recordId = Number(payload.id);
        if (!Number.isFinite(recordId) || recordId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        if (payload.attendance_date) {
            validateDate('attendance_date', payload.attendance_date);
        }
        const type = payload.type === 'late' ? 'late' : 'absence';
        const year = requireSchoolYear(payload.school_year);
        const resolved = resolveTeacherIdentity(db, {
            teacher_id: payload.teacher_id,
            teacher_name: payload.teacher_name,
            subject: payload.subject,
            school_year: year,
            source: 'staffAttendance'
        });
        const canonicalTeacherName = getCanonicalTeacherName(resolved, payload);
        const canonicalAbsencePeriod = getCanonicalAbsencePeriod(type, payload);
        const conflict = findAttendanceConflict(db, {
            recordId,
            teacherId: resolved.teacher_id || null,
            teacherName: canonicalTeacherName,
            attendanceDate: payload.attendance_date,
            type,
            absencePeriod: canonicalAbsencePeriod,
            schoolYear: year
        });
        if (conflict) {
            return { success: false, error: 'السجل موجود بالفعل لنفس الأستاذ والتاريخ.' };
        }
        db.prepare(`
            UPDATE staff_attendance
            SET teacher_id = ?, teacher_name = ?, subject = ?, attendance_date = ?,
                type = ?, late_duration = ?, arrival_time = ?, reason = ?, notes = ?,
                absence_period = ?, school_year = ?
            WHERE id = ?
        `).run(
            resolved.teacher_id || null,
            canonicalTeacherName || null,
            resolved.subject || payload.subject || null,
            payload.attendance_date,
            type,
            type === 'late' ? Number(payload.late_duration) || null : null,
            type === 'late' ? payload.arrival_time || null : null,
            payload.reason || null,
            payload.notes || null,
            canonicalAbsencePeriod,
            year,
            recordId
        );
        return { success: true };
    });

    handleWrite(ipcMain, 'staffAttendance:delete', WRITE_ROLES, (db, _event, id) => {
        const recordId = Number(id);
        if (!Number.isFinite(recordId) || recordId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        db.prepare('DELETE FROM staff_attendance WHERE id = ?').run(recordId);
        return { success: true };
    });
}

module.exports = { registerStaffAttendanceIpc };
