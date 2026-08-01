const { handleAuthedRead, handleWrite, normalizeYear } = require('./ipc-helpers');
const { resolveCycleForRequest } = require('../auth/resolve-cycle');
const { ALLOWED_ROLES } = require('../auth/permissions');
const studentFilesRepo = require('../repos/student-files');
const studentMovementsRepo = require('../repos/student-movements');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');

function registerSchoolOpsIpc(ipcMain) {
    // ── Read handlers ──
    // Student files are cycle-scoped: the student list is projected onto the session's
    // cycle, and the document checklist joins those students by id.
    handleAuthedRead(ipcMain, 'studentFiles:getByYear', ({ db, event }, schoolYear) =>
        studentFilesRepo.listByYear(db, normalizeYear(schoolYear), resolveCycleForRequest(db, event))
    );

    // ── Write handlers (require admin or staff role) ──

    handleWrite(ipcMain, 'studentFiles:upsert', WRITE_ROLES, (db, event, payload) =>
        studentFilesRepo.upsertOne(db, payload, resolveCycleForRequest(db, event))
    );

    handleWrite(ipcMain, 'studentFiles:upsertBulk', WRITE_ROLES, (db, event, items) =>
        studentFilesRepo.upsertBulk(db, items, resolveCycleForRequest(db, event))
    );

    handleWrite(ipcMain, 'studentFiles:setDocumentStatus', WRITE_ROLES, (db, event, payload) =>
        studentFilesRepo.setDocumentStatus(db, payload, resolveCycleForRequest(db, event))
    );

    // ── Student movements (read = open, write = admin/staff) ──

    // Movements carry no cycle column of their own, so they inherit the student's.
    // Rows whose student no longer exists are kept rather than dropped: they belong to no
    // cycle, and hiding them would silently shrink an audit trail the user can still see
    // today. Anything attributable to a student is scoped to the session's cycle.
    handleAuthedRead(ipcMain, 'studentMovements:getAll', ({ db, event }, schoolYear) =>
        studentMovementsRepo.listByYear(db, normalizeYear(schoolYear), resolveCycleForRequest(db, event))
    );

    handleWrite(ipcMain, 'studentMovements:add', WRITE_ROLES, (db, event, movement) =>
        studentMovementsRepo.addMovement(db, movement, resolveCycleForRequest(db, event))
    );

    handleAuthedRead(ipcMain, 'studentMovements:getStats', ({ db, event }, schoolYear) =>
        studentMovementsRepo.getStats(db, normalizeYear(schoolYear), resolveCycleForRequest(db, event))
    );
}

module.exports = { registerSchoolOpsIpc };
