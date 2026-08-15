const { handleRead, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const examsRepo = require('../repos/exams');

const VALID_CONFIG_KEYS = new Set([
    'examCenterConfig',
    'examCenterLevels',
    'examCenterRoomsData',
    'examCenterRoomsCount',
    'examScheduleData',
    'examAutoDistributionData',
    'examPeriodsData',
    'examDistributionRules',
    'examExemptionsData',
    'examDutyTeachersData',
    'examMorningEveningData',
    'examAutoDistributionOptions',
    'examCandidatesData'
]);

function registerExamConfigDataIpc(ipcMain) {
    handleRead(ipcMain, 'examConfigData:get', (db, schoolYear, configKey) => {
        const year = normalizeYear(schoolYear);
        const key = String(configKey || '').trim();
        if (!key || !VALID_CONFIG_KEYS.has(key)) return null;
        const row = examsRepo.getExamConfigRow(db, year, key);
        if (!row || !row.data_json) return null;
        try {
            return JSON.parse(row.data_json);
        } catch {
            return null;
        }
    });

    handleRead(ipcMain, 'examConfigData:getAll', (db, schoolYear) => {
        const year = normalizeYear(schoolYear);
        const rows = examsRepo.listExamConfigRows(db, year);
        const result = {};
        for (const row of rows) {
            try {
                result[row.config_key] = JSON.parse(row.data_json);
            } catch {
                result[row.config_key] = null;
            }
        }
        return result;
    });

    handleWriteSoftAuth(ipcMain, 'examConfigData:save', WRITE_ROLES, (db, payload) => {
        const year = requireSchoolYear(payload.school_year);
        const key = String(payload.config_key || '').trim();
        if (!key || !VALID_CONFIG_KEYS.has(key)) {
            return { success: false, error: 'Invalid config_key' };
        }
        if (payload.data === null || payload.data === undefined) {
            return { success: false, error: 'Data is required' };
        }
        examsRepo.upsertExamConfig(db, year, key, JSON.stringify(payload.data));
        return { success: true };
    });

    handleWriteSoftAuth(ipcMain, 'examConfigData:delete', WRITE_ROLES, (db, payload) => {
        const year = requireSchoolYear(payload.school_year);
        const key = String(payload.config_key || '').trim();
        if (key) {
            if (!VALID_CONFIG_KEYS.has(key)) {
                return { success: false, error: 'Invalid config_key' };
            }
            examsRepo.deleteExamConfigByKey(db, year, key);
        } else {
            examsRepo.deleteExamConfigsByYear(db, year);
        }
        return { success: true };
    });
}

module.exports = { registerExamConfigDataIpc };
