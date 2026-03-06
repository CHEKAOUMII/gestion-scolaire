// main/ipc/ipc-helpers.js
// Shared IPC registration helpers — eliminates boilerplate across all handler files.

const { getDb } = require('../db/context');
const { requireRole } = require('./auth');

function getDefaultYear() {
    try {
        const db = getDb();
        const row = db.prepare("SELECT value FROM settings WHERE key = 'currentSchoolYear'").get();
        return row ? row.value : '2025/2026';
    } catch (e) {
        return '2025/2026';
    }
}

/**
 * Standardized error response for auth and general errors.
 * Single source of truth — replaces the 9 copy-pasted versions.
 */
function authErrorResponse(err) {
    const isAuthError = err?.code === 'UNAUTHENTICATED' || err?.code === 'FORBIDDEN';
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
    return schoolYear || getDefaultYear();
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
 * @param {string[]} roles       – e.g. ['admin', 'staff']
 * @param {(db: any, event: any, ...args: any[]) => any} handler
 */
function handleWrite(ipcMain, channel, roles, handler) {
    ipcMain.handle(channel, async (event, ...args) => {
        try {
            requireRole(event, roles);
            const db = getDb();
            return await handler(db, event, ...args);
        } catch (err) {
            return authErrorResponse(err);
        }
    });
}

/**
 * Register a WRITE handler that skips auth
 * (e.g. bulk import used before login on settings-imports page).
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {string} channel
 * @param {(db: any, ...args: any[]) => any} handler
 */
function handleWriteNoAuth(ipcMain, channel, handler) {
    ipcMain.handle(channel, async (_event, ...args) => {
        try {
            const db = getDb();
            return await handler(db, ...args);
        } catch (err) {
            return authErrorResponse(err);
        }
    });
}

module.exports = {
    authErrorResponse,
    normalizeYear,
    handleRead,
    handleWrite,
    handleWriteNoAuth,
    getDefaultYear
};
