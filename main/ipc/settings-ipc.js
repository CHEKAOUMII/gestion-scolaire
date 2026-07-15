const { handleRead, handleWrite, handleWriteSoftAuth, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');

function registerSettingsIpc(ipcMain) {
    handleRead(ipcMain, 'settings:get', (db, key) => {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        return row ? row.value : null;
    });

    const ALLOWED_SETTINGS_KEYS = new Set([
        'currentSchoolYear',
        'schoolYear',
        'levels',
        'levelsMapping',
        'pageVisibilityMap',
        'school_info',
        'systemLogsRetentionDays'
    ]);

    handleWrite(ipcMain, 'settings:set', ['admin'], (db, _event, key, value) => {
        if (!ALLOWED_SETTINGS_KEYS.has(key)) {
            return { success: false, error: 'Invalid setting key' };
        }
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
        return { success: true };
    });

    // No auth: allow changing the current school year without requiring admin session
    handleWriteSoftAuth(ipcMain, 'settings:setSchoolYear', WRITE_ROLES, (db, year) => {
        const nextYear = requireSchoolYear(year);
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('currentSchoolYear', ?)").run(nextYear);
        return { success: true };
    }, { allowNoSession: true });
}

module.exports = { registerSettingsIpc };
