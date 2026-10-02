'use strict';
// ISOLATION-CARVEOUT (Slice 0): compensation_tracking carries no cycle_code by design (staff-domain, row-131-like).

/**
 * Compensation tracking repository.
 * Owns SQL for `compensation_tracking`. `saveBatch` performs the explicit outbox
 * capture inside its transaction via capture-port (the channel is registered with
 * captureMode 'explicit', so the generic wrapper never double-captures).
 */

const { capturePutsByIds, notifyCaptureCommitted } = require('./capture-port');
const { resolveTeacherIdentity } = require('../teachers/identity');

function listByDate(db, date, year) {
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
}

function listByYear(db, year) {
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
}

function listPending(db, year) {
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
}

/**
 * Batch-insert compensation rows, resolving each entry's teacher identity inside
 * the transaction. Entries arrive with pre-validated school years. Returns the
 * number of rows actually inserted (INSERT OR IGNORE skips duplicates).
 */
function saveBatch(db, items) {
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO compensation_tracking
            (absence_date, teacher_id, teacher_name, section, period_slot, period_time, subject, school_year, reason, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const txn = db.transaction((rows) => {
        let inserted = 0;
        const newIds = [];
        for (const s of rows) {
            const resolved = resolveTeacherIdentity(db, {
                teacher_id: s.teacher_id,
                teacher_name: s.teacher_name,
                subject: s.subject,
                school_year: s.school_year,
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
                s.school_year,
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
    const inserted = txn(items);
    notifyCaptureCommitted();
    return inserted;
}

function setCompensated(db, id, val) {
    db.prepare(
        `
        UPDATE compensation_tracking
        SET compensated = ?, compensated_date = CASE WHEN ? = 1 THEN date('now') ELSE NULL END
        WHERE id = ?
    `
    ).run(val, val, id);
}

module.exports = { listByDate, listByYear, listPending, saveBatch, setCompensated };
