const { handleAuthedRead, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { resolveCycleForRequest } = require('../auth/resolve-cycle');
const cyclesRepo = require('../repos/cycles');
const timetableRepo = require('../repos/timetable');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { writeImportAudit, buildImportAuditDetails } = require('./import-audit');

// R9 — size guard for the timetable_data JSON blob, mirroring the size-limit half
// of the student_profile_data pattern. A full-year timetable is legitimately large,
// so the cap is generous (~5 MB of serialized JSON) but bounded to reject runaway
// or malformed oversized writes before they hit the database.
const TIMETABLE_MAX_JSON = 5_000_000;

function parseTimetableRow(row) {
    if (!row || !row.data_json) return null;
    try {
        return JSON.parse(row.data_json);
    } catch {
        throw new Error(`بيانات استعمال الزمن تالفة للسلك ${row.cycle_code}`);
    }
}

function getSupportedActiveCycleCodes(db) {
    return cyclesRepo
        .listCycles(db)
        .filter((cycle) => Number(cycle.is_active) && cycle.capability === 'supported')
        .map((cycle) => cycle.cycle_code);
}

function registerTimetableDataIpc(ipcMain) {
    // The object form is an explicit cross-cycle read request. Renderer-supplied
    // cycle codes are ignored; main derives the supported active cycle set.
    handleAuthedRead(ipcMain, 'timetableData:get', ({ db, event }, request) => {
        const allCycles = request && typeof request === 'object' && request.allCycles === true;
        const schoolYear = typeof request === 'string' ? request : request?.schoolYear;
        const year = normalizeYear(schoolYear);

        if (allCycles) {
            const cycleCodes = getSupportedActiveCycleCodes(db);
            return Object.fromEntries(
                timetableRepo
                    .getAllBySchoolYear(db, year, cycleCodes)
                    .map((row) => [row.cycle_code, parseTimetableRow(row)])
                    .filter(([, timetable]) => timetable)
            );
        }

        const cycle = resolveCycleForRequest(db, event);
        return parseTimetableRow(timetableRepo.getByCycle(db, year, cycle));
    });

    // Write: upsert the active cycle's timetable JSON blob.
    handleWriteSoftAuth(ipcMain, 'timetableData:save', WRITE_ROLES, ({ db, event }, payload) => {
        const year = requireSchoolYear(payload.school_year);
        const cycle = resolveCycleForRequest(db, event);
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
        timetableRepo.upsertByCycle(db, year, cycle, json, {
            audit() {
                writeImportAudit(db, 'fet', buildImportAuditDetails({ label: 'جدول زمني', count: 1 }, year, cycle));
            }
        });
        return { success: true };
    }, { withContext: true });

    // Write: delete timetable data for the active cycle only.
    handleWriteSoftAuth(ipcMain, 'timetableData:delete', WRITE_ROLES, ({ db, event }, schoolYear) => {
        const year = requireSchoolYear(schoolYear);
        const cycle = resolveCycleForRequest(db, event);
        timetableRepo.deleteByCycle(db, year, cycle);
        return { success: true };
    }, { withContext: true });
}

module.exports = { registerTimetableDataIpc };
