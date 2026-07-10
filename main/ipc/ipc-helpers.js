// main/ipc/ipc-helpers.js
// Shared IPC registration helpers — eliminates boilerplate across all handler files.

const { getDb } = require('../db/context');
const { wrapWithSyncCapture } = require('../sync/capture');
const { requireRole, getSessionByEvent } = require('./auth');
const { validateSchoolYear } = require('./validation');

const _writeChannels = new Set();

function computeDefaultYear() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed, so September = 8
    if (month >= 8) {
        return `${year}/${year + 1}`;
    }
    return `${year - 1}/${year}`;
}

function getDefaultYear() {
    try {
        const db = getDb();
        const row = db.prepare("SELECT value FROM settings WHERE key = 'currentSchoolYear'").get();
        return row ? row.value : computeDefaultYear();
    } catch {
        return computeDefaultYear();
    }
}

/**
 * Standardized error response for auth and general errors.
 * Single source of truth — replaces the 9 copy-pasted versions.
 */
function authErrorResponse(err) {
    const isAuthError =
        err?.code === 'UNAUTHENTICATED' || err?.code === 'FORBIDDEN' || err?.code === 'SESSION_LOCKED';
    return {
        success: false,
        code: isAuthError ? err.code : 'INTERNAL_ERROR',
        error: err?.message || (isAuthError ? 'غير مصرح' : 'حدث خطأ داخلي')
    };
}

/**
 * Normalize school year with a consistent default.
 */
function normalizeYear(schoolYear) {
    if (schoolYear && typeof schoolYear === 'string' && /^\d{4}\/\d{4}$/.test(schoolYear)) {
        return schoolYear;
    }
    return getDefaultYear();
}

/**
 * Strict school year validation for mutating handlers.
 * Unlike normalizeYear(), this never falls back to the current year.
 */
function requireSchoolYear(schoolYear) {
    return validateSchoolYear(schoolYear);
}

/**
 * Register a READ handler (no auth required).
 * Auto-injects `db` as first argument to the handler.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {string} channel  – e.g. 'students:getAll'
 * @param {(db: any, ...args: any[]) => any} handler
 */
function handleRead(ipcMain, channel, handler) {
    ipcMain.handle(channel, async (_event, ...args) => {
        try {
            const db = getDb();
            return await handler(db, ...args);
        } catch (err) {
            try {
                require('../diagnostics/error-log').logAppError({
                    source: 'ipc',
                    action: channel,
                    message: err?.message,
                    stack: err?.stack
                });
            } catch (_) {
                /* logging must never block the response */
            }
            return { success: false, error: err.message };
        }
    });
}

/**
 * Register a WRITE handler (requires role-based auth).
 * Wraps with: requireRole → getDb → handler → catch authErrorResponse.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {string} channel       – e.g. 'students:add'
 * @param {string[]} roles       – e.g. WRITE_ROLES from permissions.js
 * @param {(db: any, event: any, ...args: any[]) => any} handler
 */
function handleWrite(ipcMain, channel, roles, handler) {
    _writeChannels.add(channel);

    const innerHandler = async (event, ...args) => {
        try {
            requireRole(event, roles);
            const db = getDb();
            return await handler(db, event, ...args);
        } catch (err) {
            try {
                require('../diagnostics/error-log').logAppError({
                    source: 'ipc',
                    action: channel,
                    message: err?.message,
                    stack: err?.stack
                });
            } catch (_) {
                /* logging must never block the response */
            }
            return authErrorResponse(err);
        }
    };

    ipcMain.handle(channel, wrapWithSyncCapture(channel, innerHandler));
}

/**
 * Register a WRITE handler with soft auth.
 * If a session exists → enforce role-based auth (like handleWrite).
 * If no session exists → allow the operation but log the unauthenticated write.
 *
 * This is used for bulk-import channels that run from the settings-imports page
 * which may be opened before login.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {string} channel       – e.g. 'students:addBulk'
 * @param {string[]} roles       – e.g. WRITE_ROLES from permissions.js
 * @param {(db: any, ...args: any[]) => any} handler
 */
function handleWriteSoftAuth(ipcMain, channel, roles, handler) {
    _writeChannels.add(channel);

    const innerHandler = async (event, ...args) => {
        try {
            const session = getSessionByEvent(event);
            if (session) {
                // Session exists — enforce role check
                requireRole(event, roles);
            } else {
                // No session — allow but log the unauthenticated write
                try {
                    const db = getDb();
                    db.prepare(
                        `INSERT INTO system_logs(action, entity_type, entity_id, details)
                         VALUES(?, ?, ?, ?)`
                    ).run(
                        'UNAUTHENTICATED_WRITE',
                        'ipc_channel',
                        channel,
                        `Unauthenticated write on channel "${channel}" — no active session`
                    );
                } catch {
                    // Logging failure should not block the operation
                }
            }
            const db = getDb();
            return await handler(db, ...args);
        } catch (err) {
            try {
                require('../diagnostics/error-log').logAppError({
                    source: 'ipc',
                    action: channel,
                    message: err?.message,
                    stack: err?.stack
                });
            } catch (_) {
                /* logging must never block the response */
            }
            return authErrorResponse(err);
        }
    };

    ipcMain.handle(channel, wrapWithSyncCapture(channel, innerHandler));
}

module.exports = {
    authErrorResponse,
    getDefaultYear,
    normalizeYear,
    requireSchoolYear,
    handleRead,
    handleWrite,
    handleWriteSoftAuth,
    writeChannels: _writeChannels
};
