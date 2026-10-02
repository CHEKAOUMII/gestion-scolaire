const { handleRead, handleWrite, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { requireFields } = require('./validation');
const inspectorsRepo = require('../repos/inspectors');

function registerInspectorsIpc(ipcMain) {
    // ── Read handlers ──

    handleRead(ipcMain, 'inspectors:getAll', (db, schoolYear) => {
        return inspectorsRepo.listByYear(db, normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'inspectors:getStats', (db, schoolYear) => {
        const year = normalizeYear(schoolYear);
        const now = new Date();
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const nextMonth = now.getMonth() === 11
            ? `${now.getFullYear() + 1}-01-01`
            : `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, '0')}-01`;
        return inspectorsRepo.getStatsCounts(db, year, monthStart, nextMonth);
    });

    // ── Write handlers ──

    handleWrite(ipcMain, 'inspectors:add', WRITE_ROLES, (db, _event, data) => {
        requireFields(data, ['first_name', 'last_name', 'specialty', 'school_year']);
        requireSchoolYear(data.school_year);
        const result = inspectorsRepo.insert(db, {
            first_name: data.first_name,
            last_name: data.last_name,
            specialty: data.specialty,
            phone: data.phone || '',
            email: data.email || '',
            status: data.status || 'نشط',
            last_visit_date: data.last_visit_date || '',
            notes: data.notes || '',
            school_year: data.school_year
        });
        return { success: true, id: result.lastInsertRowid };
    });

    handleWrite(ipcMain, 'inspectors:update', WRITE_ROLES, (db, _event, id, data) => {
        const inspectorId = Number(id);
        if (!Number.isFinite(inspectorId) || inspectorId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        const ALLOWED_COLUMNS = new Set([
            'first_name',
            'last_name',
            'specialty',
            'phone',
            'email',
            'status',
            'last_visit_date',
            'notes'
        ]);
        const fields = {};
        for (const [key, val] of Object.entries(data)) {
            if (ALLOWED_COLUMNS.has(key)) {
                fields[key] = val ?? '';
            }
        }
        if (!Object.keys(fields).length) return { success: false, error: 'No valid fields to update' };
        inspectorsRepo.updateById(db, inspectorId, fields);
        return { success: true };
    });

    handleWrite(ipcMain, 'inspectors:delete', WRITE_ROLES, (db, _event, id) => {
        const inspectorId = Number(id);
        if (!Number.isFinite(inspectorId) || inspectorId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        inspectorsRepo.deleteById(db, inspectorId);
        return { success: true };
    });
}

module.exports = { registerInspectorsIpc };
