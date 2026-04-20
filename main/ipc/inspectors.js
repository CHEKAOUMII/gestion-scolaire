const { handleRead, handleWrite, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { requireFields } = require('./validation');

function registerInspectorsIpc(ipcMain) {
    // ── Read handlers ──

    handleRead(ipcMain, 'inspectors:getAll', (db, schoolYear) => {
        return db
            .prepare('SELECT * FROM inspectors WHERE school_year = ? ORDER BY last_name, first_name')
            .all(normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'inspectors:getStats', (db, schoolYear) => {
        const year = normalizeYear(schoolYear);
        const total = db
            .prepare('SELECT COUNT(*) AS cnt FROM inspectors WHERE school_year = ?')
            .get(year).cnt;
        const active = db
            .prepare("SELECT COUNT(*) AS cnt FROM inspectors WHERE school_year = ? AND status = 'نشط'")
            .get(year).cnt;
        const specialties = db
            .prepare('SELECT COUNT(DISTINCT specialty) AS cnt FROM inspectors WHERE school_year = ?')
            .get(year).cnt;

        const now = new Date();
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const nextMonth = now.getMonth() === 11
            ? `${now.getFullYear() + 1}-01-01`
            : `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, '0')}-01`;
        const visitsThisMonth = db
            .prepare(
                'SELECT COUNT(*) AS cnt FROM inspectors WHERE school_year = ? AND last_visit_date >= ? AND last_visit_date < ?'
            )
            .get(year, monthStart, nextMonth).cnt;

        return { total, active, specialties, visitsThisMonth };
    });

    // ── Write handlers ──

    handleWrite(ipcMain, 'inspectors:add', WRITE_ROLES, (db, _event, data) => {
        requireFields(data, ['first_name', 'last_name', 'specialty', 'school_year']);
        requireSchoolYear(data.school_year);
        const result = db
            .prepare(
                `INSERT INTO inspectors(first_name, last_name, specialty, phone, email, status, last_visit_date, notes, school_year)
                 VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                data.first_name,
                data.last_name,
                data.specialty,
                data.phone || '',
                data.email || '',
                data.status || 'نشط',
                data.last_visit_date || '',
                data.notes || '',
                data.school_year
            );
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
        const sets = [];
        const values = [];
        for (const [key, val] of Object.entries(data)) {
            if (ALLOWED_COLUMNS.has(key)) {
                sets.push(`${key} = ?`);
                values.push(val ?? '');
            }
        }
        if (!sets.length) return { success: false, error: 'No valid fields to update' };
        values.push(inspectorId);
        db.prepare(`UPDATE inspectors SET ${sets.join(', ')} WHERE id = ?`).run(...values);
        return { success: true };
    });

    handleWrite(ipcMain, 'inspectors:delete', WRITE_ROLES, (db, _event, id) => {
        const inspectorId = Number(id);
        if (!Number.isFinite(inspectorId) || inspectorId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        db.prepare('DELETE FROM inspectors WHERE id = ?').run(inspectorId);
        return { success: true };
    });
}

module.exports = { registerInspectorsIpc };
