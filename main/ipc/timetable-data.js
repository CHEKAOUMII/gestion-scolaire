const { handleRead, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');

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
        const json = JSON.stringify(data);
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
