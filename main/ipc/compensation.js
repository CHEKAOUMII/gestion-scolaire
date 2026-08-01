const { handleRead, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const { resolveTeacherIdentity } = require('../teachers/identity');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');

function registerCompensationIpc(ipcMain) {
    handleRead(ipcMain, 'compensation:getByDate', (db, date, schoolYear) => {
        const year = normalizeYear(schoolYear);
        return db
            .prepare(
                `
            SELECT c.*,
                COALESCE(t.full_name, c.teacher_name) as teacher_name,
                COALESCE(c.reason, sa.reason) as reason,
                COALESCE(c.notes, sa.notes) as notes
            FROM compensation_tracking c
            LEFT JOIN teachers t ON t.id = c.teacher_id
            LEFT JOIN staff_attendance sa
                ON sa.attendance_date = c.absence_date
                AND sa.school_year = c.school_year
                AND (sa.teacher_id = c.teacher_id OR sa.teacher_name = c.teacher_name)
                AND sa.type = 'absence'
            WHERE c.absence_date = ? AND c.school_year = ?
            ORDER BY c.section, c.period_slot
        `
            )
            .all(date, year);
    });

    handleRead(ipcMain, 'compensation:getAll', (db, schoolYear) => {
        const year = normalizeYear(schoolYear);
        return db
            .prepare(
                `
            SELECT c.*,
                COALESCE(t.full_name, c.teacher_name) as teacher_name,
                COALESCE(c.reason, sa.reason) as reason,
                COALESCE(c.notes, sa.notes) as notes
            FROM compensation_tracking c
            LEFT JOIN teachers t ON t.id = c.teacher_id
            LEFT JOIN staff_attendance sa
                ON sa.attendance_date = c.absence_date
                AND sa.school_year = c.school_year
                AND (sa.teacher_id = c.teacher_id OR sa.teacher_name = c.teacher_name)
                AND sa.type = 'absence'
            WHERE c.school_year = ?
            ORDER BY c.absence_date DESC, c.section, c.period_slot
        `
            )
            .all(year);
    });

    handleRead(ipcMain, 'compensation:getPending', (db, schoolYear) => {
        const year = normalizeYear(schoolYear);
        return db
            .prepare(
                `
            SELECT c.*,
                COALESCE(t.full_name, c.teacher_name) as teacher_name,
                COALESCE(c.reason, sa.reason) as reason,
                COALESCE(c.notes, sa.notes) as notes
            FROM compensation_tracking c
            LEFT JOIN teachers t ON t.id = c.teacher_id
            LEFT JOIN staff_attendance sa
                ON sa.attendance_date = c.absence_date
                AND sa.school_year = c.school_year
                AND (sa.teacher_id = c.teacher_id OR sa.teacher_name = c.teacher_name)
                AND sa.type = 'absence'
            WHERE c.compensated = 0 AND c.school_year = ?
            ORDER BY c.absence_date DESC, c.section, c.period_slot
        `
            )
            .all(year);
    });

    handleWriteSoftAuth(ipcMain, 'compensation:saveBatch', WRITE_ROLES, (db, sessions) => {
        if (!Array.isArray(sessions) || sessions.length === 0) {
            return { success: true, inserted: 0 };
        }
        const { capturePutsByIds, notifyCaptureCommitted } = require('../sync/capture');
        const stmt = db.prepare(`
            INSERT OR IGNORE INTO compensation_tracking
                (absence_date, teacher_id, teacher_name, section, period_slot, period_time, subject, school_year, reason, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const txn = db.transaction((items) => {
            let inserted = 0;
            const newIds = [];
            for (const s of items) {
                const resolved = resolveTeacherIdentity(db, {
                    teacher_id: s.teacher_id,
                    teacher_name: s.teacher_name,
                    subject: s.subject,
                    school_year: requireSchoolYear(s.school_year),
                    source: 'compensation'
                });
                const result = stmt.run(
                    s.absence_date,
                    resolved.teacher_id || null,
                    resolved.teacher_name || s.teacher_name || null,
                    s.section,
                    s.period_slot,
                    s.period_time || '',
                    resolved.subject || s.subject || '',
                    requireSchoolYear(s.school_year),
                    s.reason || null,
                    s.notes || null
                );
                if (result.changes > 0) {
                    inserted++;
                    if (result.lastInsertRowid) newIds.push(result.lastInsertRowid);
                }
            }
            if (newIds.length) {
                capturePutsByIds(db, 'compensation_tracking', newIds);
            }
            return inserted;
        });
        const inserted = txn(sessions);
        notifyCaptureCommitted();
        return { success: true, inserted };
    });

    handleWriteSoftAuth(ipcMain, 'compensation:toggleCompensated', WRITE_ROLES, (db, id, compensated) => {
        if (!id) return { success: false, error: 'Invalid ID' };
        const val = compensated ? 1 : 0;
        db.prepare(
            `
            UPDATE compensation_tracking
            SET compensated = ?, compensated_date = CASE WHEN ? = 1 THEN date('now') ELSE NULL END
            WHERE id = ?
        `
        ).run(val, val, id);
        return { success: true };
    });
}

module.exports = { registerCompensationIpc };
