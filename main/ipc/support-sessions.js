'use strict';

const { handleAuthedRead, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { resolveCycleForRequest } = require('../auth/resolve-cycle');
const { ALLOWED_ROLES } = require('../auth/permissions');
const { requireFields } = require('./validation');
const supportSessionsRepo = require('../repos/support-sessions');

const WRITE_ROLES = ALLOWED_ROLES.filter((role) => role !== 'viewer');

function calculateDuration(session) {
    const [fromHours, fromMinutes] = String(session.time_from).split(':').map(Number);
    const [toHours, toMinutes] = String(session.time_to).split(':').map(Number);
    return Math.round((((toHours * 60 + toMinutes) - (fromHours * 60 + fromMinutes)) / 60) * 100) / 100;
}

function registerSupportSessionsIpc(ipcMain) {
    handleAuthedRead(ipcMain, 'supportSessions:list', ({ db, event }, filters = {}) => {
        const year = normalizeYear(filters.school_year);
        const cycle = resolveCycleForRequest(db, event);
        return supportSessionsRepo.list(db, year, cycle, filters);
    });

    handleAuthedRead(ipcMain, 'supportSessions:stats', ({ db, event }, schoolYear) => {
        const year = normalizeYear(schoolYear);
        const cycle = resolveCycleForRequest(db, event);
        return supportSessionsRepo.getStats(db, year, cycle);
    });

    handleWriteSoftAuth(ipcMain, 'supportSessions:add', WRITE_ROLES, ({ db, event }, session) => {
        requireFields(session, ['subject', 'section', 'session_date', 'time_from', 'time_to', 'attendance_status', 'school_year']);
        const year = requireSchoolYear(session.school_year);
        const cycle = resolveCycleForRequest(db, event);
        supportSessionsRepo.requireSectionCycle(session.section, cycle);
        const teacher = supportSessionsRepo.resolveAssignedTeacher(db, session, year, cycle);
        const duration = calculateDuration(session);

        const result = supportSessionsRepo.insert(db, {
            teacher_id: teacher.teacher_id,
            teacher_name: teacher.teacher_name || session.teacher_name || null,
            subject: session.subject,
            section: session.section,
            room: session.room || null,
            session_date: session.session_date,
            time_from: session.time_from,
            time_to: session.time_to,
            duration_hours: duration > 0 ? duration : null,
            attendance_status: session.attendance_status,
            school_year: year,
            cycle_code: cycle
        });
        return { id: result.lastInsertRowid, cycle_code: cycle };
    }, { withContext: true });

    handleWriteSoftAuth(ipcMain, 'supportSessions:delete', WRITE_ROLES, ({ db, event }, id) => {
        const cycle = resolveCycleForRequest(db, event);
        const result = supportSessionsRepo.deleteById(db, id, cycle);
        return { ok: true, deleted: result.changes };
    }, { withContext: true });

    handleAuthedRead(ipcMain, 'supportSessions:export', ({ db, event }, schoolYear) => {
        const year = normalizeYear(schoolYear);
        const cycle = resolveCycleForRequest(db, event);
        const sessions = supportSessionsRepo.listForExport(db, year, cycle);
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
        const { imported, skipped } = supportSessionsRepo.importBatch(db, payload.support_sessions, schoolYear, cycle);
        return { imported, skipped, cycle_code: cycle };
    }, { withContext: true });
}

module.exports = {
    registerSupportSessionsIpc,
    requireSectionCycle: supportSessionsRepo.requireSectionCycle,
    resolveAssignedTeacher: supportSessionsRepo.resolveAssignedTeacher
};
