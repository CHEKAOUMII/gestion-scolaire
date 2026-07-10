const { handleRead, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');

// R9 — size guard for the timetable_data JSON blob, mirroring the size-limit half
// of the student_profile_data pattern. A full-year timetable is legitimately large,
// so the cap is generous (~5 MB of serialized JSON) but bounded to reject runaway
// or malformed oversized writes before they hit the database.
const TIMETABLE_MAX_JSON = 5_000_000;

function registerTimetableDataIpc(ipcMain) {
    // Read: get timetable JSON blob for a school year
    handleRead(ipcMain, 'timetableData:get', (db, schoolYear) => {
        const year = normalizeYear(schoolYear);
        const row = db
            .prepare('SELECT data_json FROM timetable_data WHERE school_year = ?')
            .get(year);
        if (!row || !row.data_json) return null;
        try {
            return JSON.parse(row.data_json);
        } catch {
            return null;
        }
    });

    // Write: upsert timetable JSON blob (soft auth — also works from import page before login)
    handleWriteSoftAuth(ipcMain, 'timetableData:save', WRITE_ROLES, (db, payload) => {
        const year = requireSchoolYear(payload.school_year);
        const data = payload.data;
        if (!data || typeof data !== 'object') {
            return { success: false, error: 'Invalid timetable data' };
        }
        let json;
        try {
            json = JSON.stringify(data);
        } catch {
            return { success: false, error: 'Invalid timetable data: not serializable' };
        }
        if (json.length > TIMETABLE_MAX_JSON) {
            return { success: false, error: 'Timetable data exceeds maximum allowed size' };
        }
        db.prepare(`
            INSERT INTO timetable_data (school_year, data_json, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(school_year) DO UPDATE SET
                data_json = excluded.data_json,
                updated_at = CURRENT_TIMESTAMP
        `).run(year, json);
        return { success: true };
    });

    // Write: delete timetable data for a school year (soft auth)
    handleWriteSoftAuth(ipcMain, 'timetableData:delete', WRITE_ROLES, (db, schoolYear) => {
        const year = requireSchoolYear(schoolYear);
        db.prepare('DELETE FROM timetable_data WHERE school_year = ?').run(year);
        return { success: true };
    });
}

module.exports = { registerTimetableDataIpc };
