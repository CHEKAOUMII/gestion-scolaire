const { handleRead, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const compensationRepo = require('../repos/compensation');

function registerCompensationIpc(ipcMain) {
    handleRead(ipcMain, 'compensation:getByDate', (db, date, schoolYear) => {
        return compensationRepo.listByDate(db, date, normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'compensation:getAll', (db, schoolYear) => {
        return compensationRepo.listByYear(db, normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'compensation:getPending', (db, schoolYear) => {
        return compensationRepo.listPending(db, normalizeYear(schoolYear));
    });

    handleWriteSoftAuth(ipcMain, 'compensation:saveBatch', WRITE_ROLES, (db, sessions) => {
        if (!Array.isArray(sessions) || sessions.length === 0) {
            return { success: true, inserted: 0 };
        }
        // Validate every entry's school year up front: requireSchoolYear throws the
        // same error the per-item check used to throw mid-transaction, and the batch
        // still writes nothing (the old transaction rolled back equally).
        const items = sessions.map((s) => ({ ...s, school_year: requireSchoolYear(s.school_year) }));
        const inserted = compensationRepo.saveBatch(db, items);
        return { success: true, inserted };
    });

    handleWriteSoftAuth(ipcMain, 'compensation:toggleCompensated', WRITE_ROLES, (db, id, compensated) => {
        if (!id) return { success: false, error: 'Invalid ID' };
        compensationRepo.setCompensated(db, id, compensated ? 1 : 0);
        return { success: true };
    });
}

module.exports = { registerCompensationIpc };
