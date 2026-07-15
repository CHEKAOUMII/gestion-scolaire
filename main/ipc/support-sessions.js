const { handleRead, handleWrite, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { requireFields } = require('./validation');
const { teacherIdOrNull } = require('../teachers/identity');

function registerSupportSessionsIpc(ipcMain) {
    handleRead(ipcMain, 'supportSessions:list', (db, filters) => {
        const year = normalizeYear(filters && filters.school_year);
        let sql = `
            SELECT ss.*, t.full_name as teacher_full_name
            FROM support_sessions ss
            LEFT JOIN teachers t ON ss.teacher_id = t.id
            WHERE ss.school_year = ?
        `;
        const params = [year];
        if (filters && filters.teacher_id) {
            sql += ' AND ss.teacher_id = ?';
            params.push(filters.teacher_id);
        }
        if (filters && filters.section) {
            sql += ' AND ss.section = ?';
            params.push(filters.section);
        }
        if (filters && filters.subject) {
            sql += ' AND ss.subject = ?';
            params.push(filters.subject);
        }
        if (filters && filters.date_from) {
            sql += ' AND ss.session_date >= ?';
            params.push(filters.date_from);
        }
        if (filters && filters.date_to) {
            sql += ' AND ss.session_date <= ?';
            params.push(filters.date_to);
        }
        sql += ' ORDER BY ss.session_date DESC, ss.time_from DESC';
        return db.prepare(sql).all(...params);
    });

    handleRead(ipcMain, 'supportSessions:stats', (db, schoolYear) => {
        const year = normalizeYear(schoolYear);
        return db
            .prepare(
                `
                    SELECT
                        COUNT(*) AS total_sessions,
                        ROUND(SUM(duration_hours), 1) AS total_hours,
                        COUNT(DISTINCT COALESCE(teacher_id, teacher_name)) AS total_teachers,
                        COUNT(DISTINCT section) AS total_sections
                    FROM support_sessions
                    WHERE school_year = ?
                `
            )
            .get(year);
    });

    handleWrite(ipcMain, 'supportSessions:add', WRITE_ROLES, (db, _event, session) => {
        requireFields(session, ['subject', 'section', 'session_date', 'time_from', 'time_to', 'attendance_status', 'school_year']);
        requireSchoolYear(session.school_year);

        const [fromHours, fromMinutes] = session.time_from.split(':').map(Number);
        const [toHours, toMinutes] = session.time_to.split(':').map(Number);
        const duration = Math.round((((toHours * 60 + toMinutes) - (fromHours * 60 + fromMinutes)) / 60) * 100) / 100;

        const result = db
            .prepare(
                `
                    INSERT INTO support_sessions
                        (teacher_id, teacher_name, subject, section, room, session_date, time_from, time_to, duration_hours, attendance_status, school_year)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `
            )
            .run(
                teacherIdOrNull(db, session.teacher_id),
                session.teacher_name || null,
                session.subject,
                session.section,
                session.room || null,
                session.session_date,
                session.time_from,
                session.time_to,
                duration > 0 ? duration : null,
                session.attendance_status,
                session.school_year
            );
        return { id: result.lastInsertRowid };
    });

    handleWrite(ipcMain, 'supportSessions:delete', WRITE_ROLES, (db, _event, id) => {
        db.prepare('DELETE FROM support_sessions WHERE id = ?').run(id);
        return { ok: true };
    });

    handleRead(ipcMain, 'supportSessions:export', (db, schoolYear) => {
        const year = normalizeYear(schoolYear);
        const sessions = db
            .prepare(
                `
                    SELECT teacher_id, teacher_name, subject, section, room,
                           session_date, time_from, time_to, duration_hours, attendance_status
                    FROM support_sessions WHERE school_year = ?
                    ORDER BY session_date, time_from
                `
            )
            .all(year);
        return {
            exported_at: new Date().toISOString(),
            school_year: year,
            support_sessions: sessions
        };
    });

    handleWrite(ipcMain, 'supportSessions:import', WRITE_ROLES, (db, _event, payload) => {
        if (!payload || !Array.isArray(payload.support_sessions)) {
            throw new Error('ملف JSON غير صالح');
        }
        const schoolYear = normalizeYear(payload.school_year);
        requireSchoolYear(schoolYear);

        const insert = db.prepare(`
            INSERT OR IGNORE INTO support_sessions
                (teacher_id, teacher_name, subject, section, room, session_date, time_from, time_to, duration_hours, attendance_status, school_year)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        let imported = 0;
        let skipped = 0;

        const transaction = db.transaction(() => {
            for (const session of payload.support_sessions) {
                if (
                    !session.subject ||
                    !session.section ||
                    !session.session_date ||
                    !session.time_from ||
                    !session.time_to ||
                    !session.attendance_status
                ) {
                    skipped++;
                    continue;
                }

                const resolvedTeacherId = teacherIdOrNull(db, session.teacher_id);
                const exists = db
                    .prepare(
                        `
                            SELECT 1 FROM support_sessions
                            WHERE section = ? AND session_date = ? AND time_from = ? AND school_year = ?
                              AND COALESCE(teacher_id, -1) = COALESCE(?, -1)
                        `
                    )
                    .get(
                        session.section,
                        session.session_date,
                        session.time_from,
                        schoolYear,
                        resolvedTeacherId
                    );

                if (exists) {
                    skipped++;
                    continue;
                }

                insert.run(
                    resolvedTeacherId,
                    session.teacher_name || null,
                    session.subject,
                    session.section,
                    session.room || null,
                    session.session_date,
                    session.time_from,
                    session.time_to,
                    session.duration_hours || null,
                    session.attendance_status,
                    schoolYear
                );
                imported++;
            }
        });

        transaction();
        return { imported, skipped };
    });
}

module.exports = { registerSupportSessionsIpc };
