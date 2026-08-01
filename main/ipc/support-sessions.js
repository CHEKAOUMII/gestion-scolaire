'use strict';

const { handleAuthedRead, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { resolveCycleForRequest } = require('../auth/resolve-cycle');
const { ALLOWED_ROLES } = require('../auth/permissions');
const { requireFields } = require('./validation');
const { resolveTeacherIdentity } = require('../teachers/identity');
const staffRepo = require('../repos/staff');
const { inferEducationPlacement } = require('../../js/shared/education/cycles');

const WRITE_ROLES = ALLOWED_ROLES.filter((role) => role !== 'viewer');

/**
 * Refuse a section that provably belongs to another cycle.
 *
 * Section naming is free text the school controls; `inferCycleFromSection` only knows the
 * Massar-style codes (1APIC, 2BAC…, TCS, TCL). A section it cannot classify is NOT an
 * error: rejecting it would lock every school with local naming out of support sessions
 * entirely, for no isolation gain. The plan forbids *deriving* a cycle from a section name
 * (§7.3); it does not forbid using a confident derivation to catch a contradiction. So the
 * cycle written is always the session's, and inference is used only to veto.
 */
function requireSectionCycle(section, activeCycle) {
    const inferred = inferEducationPlacement({ section });
    if (inferred && inferred !== activeCycle) {
        throw new Error(`القسم ${String(section || '').trim()} ينتمي إلى سلك آخر من السلك النشط`);
    }
    return activeCycle;
}

function resolveAssignedTeacher(db, payload, schoolYear, cycleCode) {
    const resolved = resolveTeacherIdentity(db, {
        teacher_id: payload?.teacher_id,
        teacher_name: payload?.teacher_name,
        subject: payload?.subject,
        school_year: schoolYear,
        source: 'supportSessions'
    });
    if (!resolved.teacher_id) throw new Error('لا يمكن تسجيل حصة الدعم دون أستاذ مطابق');
    const allowed = staffRepo
        .listByYearAndCycle(db, schoolYear, cycleCode)
        .some((teacher) => Number(teacher.id) === Number(resolved.teacher_id));
    if (!allowed) throw new Error('الأستاذ لا يملك تعيين تدريس مؤكداً في السلك النشط');
    return resolved;
}

function calculateDuration(session) {
    const [fromHours, fromMinutes] = String(session.time_from).split(':').map(Number);
    const [toHours, toMinutes] = String(session.time_to).split(':').map(Number);
    return Math.round((((toHours * 60 + toMinutes) - (fromHours * 60 + fromMinutes)) / 60) * 100) / 100;
}

function registerSupportSessionsIpc(ipcMain) {
    handleAuthedRead(ipcMain, 'supportSessions:list', ({ db, event }, filters = {}) => {
        const year = normalizeYear(filters.school_year);
        const cycle = resolveCycleForRequest(db, event);
        let sql = `
            SELECT ss.*, t.full_name as teacher_full_name
            FROM support_sessions ss
            LEFT JOIN teachers t ON ss.teacher_id = t.id
            WHERE ss.school_year = ? AND ss.cycle_code = ?
        `;
        const params = [year, cycle];
        if (filters.teacher_id) {
            sql += ' AND ss.teacher_id = ?';
            params.push(filters.teacher_id);
        }
        if (filters.section) {
            sql += ' AND ss.section = ?';
            params.push(filters.section);
        }
        if (filters.subject) {
            sql += ' AND ss.subject = ?';
            params.push(filters.subject);
        }
        if (filters.date_from) {
            sql += ' AND ss.session_date >= ?';
            params.push(filters.date_from);
        }
        if (filters.date_to) {
            sql += ' AND ss.session_date <= ?';
            params.push(filters.date_to);
        }
        sql += ' ORDER BY ss.session_date DESC, ss.time_from DESC';
        return db.prepare(sql).all(...params);
    });

    handleAuthedRead(ipcMain, 'supportSessions:stats', ({ db, event }, schoolYear) => {
        const year = normalizeYear(schoolYear);
        const cycle = resolveCycleForRequest(db, event);
        return db
            .prepare(
                `
                    SELECT
                        COUNT(*) AS total_sessions,
                        ROUND(SUM(duration_hours), 1) AS total_hours,
                        COUNT(DISTINCT COALESCE(teacher_id, teacher_name)) AS total_teachers,
                        COUNT(DISTINCT section) AS total_sections
                    FROM support_sessions
                    WHERE school_year = ? AND cycle_code = ?
                `
            )
            .get(year, cycle);
    });

    handleWriteSoftAuth(ipcMain, 'supportSessions:add', WRITE_ROLES, ({ db, event }, session) => {
        requireFields(session, ['subject', 'section', 'session_date', 'time_from', 'time_to', 'attendance_status', 'school_year']);
        const year = requireSchoolYear(session.school_year);
        const cycle = resolveCycleForRequest(db, event);
        requireSectionCycle(session.section, cycle);
        const teacher = resolveAssignedTeacher(db, session, year, cycle);
        const duration = calculateDuration(session);

        const result = db
            .prepare(
                `
                    INSERT INTO support_sessions
                        (teacher_id, teacher_name, subject, section, room, session_date, time_from, time_to, duration_hours, attendance_status, school_year, cycle_code)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `
            )
            .run(
                teacher.teacher_id,
                teacher.teacher_name || session.teacher_name || null,
                session.subject,
                session.section,
                session.room || null,
                session.session_date,
                session.time_from,
                session.time_to,
                duration > 0 ? duration : null,
                session.attendance_status,
                year,
                cycle
            );
        return { id: result.lastInsertRowid, cycle_code: cycle };
    }, { withContext: true });

    handleWriteSoftAuth(ipcMain, 'supportSessions:delete', WRITE_ROLES, ({ db, event }, id) => {
        const cycle = resolveCycleForRequest(db, event);
        const result = db.prepare('DELETE FROM support_sessions WHERE id = ? AND cycle_code = ?').run(id, cycle);
        return { ok: true, deleted: result.changes };
    }, { withContext: true });

    handleAuthedRead(ipcMain, 'supportSessions:export', ({ db, event }, schoolYear) => {
        const year = normalizeYear(schoolYear);
        const cycle = resolveCycleForRequest(db, event);
        const sessions = db
            .prepare(
                `
                    SELECT teacher_id, teacher_name, subject, section, room,
                           session_date, time_from, time_to, duration_hours, attendance_status
                    FROM support_sessions
                    WHERE school_year = ? AND cycle_code = ?
                    ORDER BY session_date, time_from
                `
            )
            .all(year, cycle);
        return {
            exported_at: new Date().toISOString(),
            school_year: year,
            cycle_code: cycle,
            support_sessions: sessions
        };
    });

    handleWriteSoftAuth(ipcMain, 'supportSessions:import', WRITE_ROLES, ({ db, event }, payload) => {
        if (!payload || !Array.isArray(payload.support_sessions)) {
            throw new Error('ملف JSON غير صالح');
        }
        const schoolYear = requireSchoolYear(payload.school_year);
        const cycle = resolveCycleForRequest(db, event);
        const insert = db.prepare(`
            INSERT OR IGNORE INTO support_sessions
                (teacher_id, teacher_name, subject, section, room, session_date, time_from, time_to, duration_hours, attendance_status, school_year, cycle_code)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        let imported = 0;
        let skipped = 0;
        const { capturePutsByIds, notifyCaptureCommitted } = require('../sync/capture');

        const transaction = db.transaction(() => {
            const newIds = [];
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
                requireSectionCycle(session.section, cycle);
                const teacher = resolveAssignedTeacher(db, session, schoolYear, cycle);
                const exists = db
                    .prepare(
                        `
                            SELECT 1 FROM support_sessions
                            WHERE section = ? AND session_date = ? AND time_from = ? AND school_year = ? AND cycle_code = ?
                              AND COALESCE(teacher_id, -1) = COALESCE(?, -1)
                        `
                    )
                    .get(session.section, session.session_date, session.time_from, schoolYear, cycle, teacher.teacher_id);

                if (exists) {
                    skipped++;
                    continue;
                }

                const result = insert.run(
                    teacher.teacher_id,
                    teacher.teacher_name || session.teacher_name || null,
                    session.subject,
                    session.section,
                    session.room || null,
                    session.session_date,
                    session.time_from,
                    session.time_to,
                    session.duration_hours || null,
                    session.attendance_status,
                    schoolYear,
                    cycle
                );
                if (result.lastInsertRowid) newIds.push(result.lastInsertRowid);
                imported++;
            }
            if (newIds.length) capturePutsByIds(db, 'support_sessions', newIds, schoolYear);
        });

        transaction();
        notifyCaptureCommitted();
        return { imported, skipped, cycle_code: cycle };
    }, { withContext: true });
}

module.exports = { registerSupportSessionsIpc, requireSectionCycle, resolveAssignedTeacher };
