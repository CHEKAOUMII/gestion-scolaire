'use strict';

/**
 * user_cycle_access management IPC (multi-stage plan §3 S6, rows 128-130).
 *
 * SYNC CONTRACT DECISION (row 130): these channels are LOCAL-ONLY. user_cycle_access
 * is a per-device authorization policy — the `users` table is not a sync entity
 * (no entry in main/sync/entity-registry.js), so user IDs are device-local, and
 * syncing grants would let any device push its own authorization. Like page-access
 * permissions (AGENTS.md "App Defaults and Page Access"), it is intentionally
 * excluded from sync: no ENTITY_REGISTRY entry, no capture wiring (both channels are
 * marked `exclude: true` in CHANNEL_REGISTRY), no sync-apply hooks. All SQL lives in
 * main/auth/cycle-access.js (repo layer), never here.
 *
 * Base security rule (row 128): admin-only management, no writes against
 * developer/admin/principal users, and the last-usable-supported-cycle guard is
 * enforced in the repo layer (row 129) — not only here.
 */

const { handleAuthedRead, handleWriteSoftAuth, sanitizeIpcErrorMessage } = require('./ipc-helpers');
const { requireFields } = require('./validation');
const { requireRole } = require('./auth');
const cycleAccess = require('../auth/cycle-access');
const cyclesRepo = require('../repos/cycles');

const AUTH_CODES = new Set(['UNAUTHENTICATED', 'FORBIDDEN', 'SESSION_LOCKED']);

function createCycleAccessIpcError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
}

/** Map any thrown error to a flat, user-safe response preserving domain codes. */
function toCycleAccessErrorResponse(err) {
    const code = AUTH_CODES.has(err && err.code)
        ? err.code
        : cycleAccess.CYCLE_ACCESS_ERROR_CODES[String(err && err.code)] || 'INTERNAL_ERROR';
    return { success: false, code, error: sanitizeIpcErrorMessage(err) };
}

function registerCycleAccessIpc(ipcMain) {
    // Read: full authorization matrix for the admin UI.
    handleAuthedRead(ipcMain, 'cycleAccess:list', ({ db, event }) => {
        requireRole(event, ['admin']);
        return {
            success: true,
            users: cycleAccess.listUserCycleAccess(db),
            cycles: cyclesRepo.listCycles(db).map((cycle) => ({
                cycle_code: cycle.cycle_code,
                label_ar: cycle.label_ar,
                label_fr: cycle.label_fr,
                capability: cycle.capability,
                is_active: Number(cycle.is_active)
            }))
        };
    });

    // Write: replace one user's cycle grants.
    handleWriteSoftAuth(ipcMain, 'cycleAccess:setUsers', ['admin'], (db, payload) => {
        try {
            requireFields(payload, ['userId', 'cycleCodes']);
            const userId = Number(payload.userId);
            if (!Number.isInteger(userId) || userId <= 0) {
                throw createCycleAccessIpcError(cycleAccess.CYCLE_ACCESS_ERROR_CODES.USER_NOT_FOUND, 'المستخدم غير موجود');
            }
            if (!Array.isArray(payload.cycleCodes)) {
                throw createCycleAccessIpcError('INVALID_PAYLOAD', 'قائمة الأسلاك غير صالحة');
            }
            const result = cycleAccess.setUserCycles(db, userId, payload.cycleCodes);
            return { success: true, ...result };
        } catch (err) {
            return toCycleAccessErrorResponse(err);
        }
    });

    // Write: enable/disable one cycle for every non-privileged user.
    handleWriteSoftAuth(ipcMain, 'cycleAccess:setCycles', ['admin'], (db, payload) => {
        try {
            requireFields(payload, ['cycleCode']);
            const result = cycleAccess.setCyclesForAllUsers(db, payload.cycleCode, payload.enabled !== false);
            return { success: true, ...result };
        } catch (err) {
            return toCycleAccessErrorResponse(err);
        }
    });
}

module.exports = { registerCycleAccessIpc };
