const { handleAuthedRead, handleWrite, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { resolveCycleForRequest } = require('../auth/resolve-cycle');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { validateDate } = require('./validation');
const { resolveTeacherIdentity } = require('../teachers/identity');
const staffAttendanceRepo = require('../repos/staff-attendance');

const ALL_CYCLE_VALUES = new Set(['all', 'all_cycles', 'all-cycles']);

function rejectAllCycleWrite(payload) {
    const requested = String(payload?.scope || payload?.cycle_code || payload?.cycleCode || '').trim().toLowerCase();
    if (ALL_CYCLE_VALUES.has(requested)) {
        const error = new Error('عمليات حضور الموظفين تتطلب سلكاً محدداً عند ربط الحصة');
        error.code = 'ALL_CYCLES_WRITE_FORBIDDEN';
        throw error;
    }
}

function getCanonicalTeacherName(resolved, payload) {
    return String(resolved?.teacher_name || resolved?.teacherName || payload?.teacher_name || '').trim();
}

function getCanonicalAbsencePeriod(type, payload) {
    return type === 'absence' ? String(payload?.absence_period || 'full_day').trim() || 'full_day' : null;
}

function registerStaffAttendanceIpc(ipcMain) {
    handleAuthedRead(ipcMain, 'teachers:getFromGrades', ({ db, event }, schoolYear) => {
        const year = normalizeYear(schoolYear);
        const cycle = resolveCycleForRequest(db, event);
        return staffAttendanceRepo.listTeachersFromGrades(db, year, cycle);
    });

    // ── Staff Attendance CRUD ──

    handleAuthedRead(ipcMain, 'staffAttendance:getAll', ({ db }, schoolYear) => {
        return staffAttendanceRepo.listByYear(db, normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'staffAttendance:save', WRITE_ROLES, (db, _event, payload) => {
        try {
            rejectAllCycleWrite(payload);
        } catch (error) {
            return { success: false, code: error.code, error: error.message };
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
        const conflict = staffAttendanceRepo.findConflict(db, {
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

        const result = staffAttendanceRepo.insert(db, {
            teacher_id: resolved.teacher_id || null,
            teacher_name: canonicalTeacherName || null,
            subject: resolved.subject || payload.subject || null,
            attendance_date: payload.attendance_date,
            type,
            late_duration: type === 'late' ? Number(payload.late_duration) || null : null,
            arrival_time: type === 'late' ? payload.arrival_time || null : null,
            reason: payload.reason || null,
            notes: payload.notes || null,
            absence_period: canonicalAbsencePeriod,
            school_year: year
        });
        return {
            success: true,
            duplicate: result.changes === 0,
            id: result.lastInsertRowid || conflict?.id || null
        };
    });

    handleWrite(ipcMain, 'staffAttendance:update', WRITE_ROLES, (db, _event, payload) => {
        try {
            rejectAllCycleWrite(payload);
        } catch (error) {
            return { success: false, code: error.code, error: error.message };
        }
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
        const conflict = staffAttendanceRepo.findConflict(db, {
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
        staffAttendanceRepo.updateById(db, recordId, {
            teacher_id: resolved.teacher_id || null,
            teacher_name: canonicalTeacherName || null,
            subject: resolved.subject || payload.subject || null,
            attendance_date: payload.attendance_date,
            type,
            late_duration: type === 'late' ? Number(payload.late_duration) || null : null,
            arrival_time: type === 'late' ? payload.arrival_time || null : null,
            reason: payload.reason || null,
            notes: payload.notes || null,
            absence_period: canonicalAbsencePeriod,
            school_year: year
        });
        return { success: true };
    });

    handleWrite(ipcMain, 'staffAttendance:delete', WRITE_ROLES, (db, _event, id) => {
        const recordId = Number(id);
        if (!Number.isFinite(recordId) || recordId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        staffAttendanceRepo.deleteById(db, recordId);
        return { success: true };
    });
}

module.exports = { registerStaffAttendanceIpc, rejectAllCycleWrite };
