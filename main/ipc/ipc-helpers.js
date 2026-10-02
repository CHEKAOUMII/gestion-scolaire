// main/ipc/ipc-helpers.js
// Shared IPC registration helpers — eliminates boilerplate across all handler files.

const { getDb } = require('../db/context');
const { wrapWithSyncCapture } = require('../sync/capture');
const { requireAuth, requireRole, getSessionByEvent } = require('./auth');
const { validateSchoolYear } = require('./validation');

const _writeChannels = new Set();

/** Channels registered with handleAuthedRead — session-aware reads (plan §5.4). */
const _authedReadChannels = new Set();

/**
 * Channels registered with handleWriteSoftAuth({ allowNoSession: true }).
 * Populated at registration time — prefer the call-site flag over editing this set.
 */
const SOFT_AUTH_NO_SESSION_CHANNELS = new Set();

const AUTH_ERROR_CODES = new Set(['UNAUTHENTICATED', 'FORBIDDEN', 'SESSION_LOCKED']);

/**
 * Cycle-resolution refusal codes (main/auth/resolve-cycle.js). They are stable,
 * typed, and carry a direct remedy for the caller (select a stage / enable a
 * cycle), so they must survive the IPC boundary as their own code instead of
 * collapsing to INTERNAL_ERROR. Deliberately a closed set — unknown codes keep
 * the generic collapse so nothing leaks.
 */
const CYCLE_RESOLUTION_CODES = new Set(['NO_USABLE_CYCLE', 'CYCLE_SELECTION_REQUIRED']);

function looksLikeInternalErrorMessage(message) {
    const msg = String(message || '').trim();
    if (!msg) return true;
    if (/SQLITE|ENOENT|EACCES|EPERM|ECONNREFUSED|ENOTFOUND/i.test(msg)) return true;
    if (/\.js:\d+|at\s+\S+\s+\(/i.test(msg)) return true;
    if (/^(Error:|TypeError:|SyntaxError:)/i.test(msg)) return true;
    // Sync capture failures must not leak as user-facing product text
    if (/\[sync:capture\]/i.test(msg)) return true;
    return false;
}

function sanitizeIpcErrorMessage(err) {
    if (AUTH_ERROR_CODES.has(err?.code)) {
        return err?.message || 'غير مصرح';
    }
    const msg = String(err?.message || '').trim();
    if (msg && /[\u0600-\u06FF]/.test(msg) && !looksLikeInternalErrorMessage(msg)) {
        return msg;
    }
    return 'حدث خطأ داخلي';
}

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
    const isKnownCode = AUTH_ERROR_CODES.has(err?.code) || CYCLE_RESOLUTION_CODES.has(err?.code);
    return {
        success: false,
        code: isKnownCode ? err.code : 'INTERNAL_ERROR',
        error: sanitizeIpcErrorMessage(err)
    };
}

/** Alias for read handlers — same sanitization rules as writes. */
function ipcErrorResponse(err) {
    return authErrorResponse(err);
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
            return ipcErrorResponse(err);
        }
    });
}

/**
 * Register a READ handler that requires a session and can see it.
 *
 * `handleRead` deliberately discards `event`, so its handlers cannot know who is
 * asking or which education cycle that session is working in. Cycle-scoped reads
 * (multi-cycle plan §5.4) need both, and passing a cycle from the renderer would be
 * trusting renderer input — which §13 forbids. This helper resolves the session in
 * main and injects it, so a read can never widen its own scope.
 *
 * Handler receives `({ db, event, session, cycleContext }, ...args)`. `cycleContext`
 * is null while no cycle context exists for the sender (single-cycle installs).
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {string} channel  – e.g. 'students:getAll'
 * @param {(ctx: {db: any, event: any, session: any, cycleContext: any}, ...args: any[]) => any} handler
 */
function handleAuthedRead(ipcMain, channel, handler) {
    _authedReadChannels.add(channel);

    ipcMain.handle(channel, async (event, ...args) => {
        try {
            const session = requireAuth(event);
            const db = getDb();
            const cycleContext = require('../auth/active-cycle-context').peekContext(event);
            return await handler({ db, event, session, cycleContext }, ...args);
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
            return ipcErrorResponse(err);
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
 * If no session exists → deny, unless options.allowNoSession is true
 * (setup / bulk-import channels that may run before login).
 *
 * Handlers receive `(db, ...args)` by default. Pass `withContext: true` to receive
 * `({ db, event, session }, ...args)` instead — needed by cycle-scoped writes, which must
 * resolve their education cycle from the session rather than from the renderer payload
 * (multi-cycle plan §13). `session` is null on an allowNoSession channel with no login.
 * The two shapes are opt-in per channel so domains migrate one at a time; a handler that
 * declares the wrong one fails immediately on the first `db` call rather than silently.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {string} channel       – e.g. 'students:addBulk'
 * @param {string[]} roles       – e.g. WRITE_ROLES from permissions.js
 * @param {(db: any, ...args: any[]) => any} handler
 * @param {{ allowNoSession?: boolean, withContext?: boolean }} [options]
 */
function handleWriteSoftAuth(ipcMain, channel, roles, handler, options = {}) {
    const allowNoSession = options?.allowNoSession === true;
    _writeChannels.add(channel);
    if (allowNoSession) {
        SOFT_AUTH_NO_SESSION_CHANNELS.add(channel);
    } else {
        SOFT_AUTH_NO_SESSION_CHANNELS.delete(channel);
    }

    const innerHandler = async (event, ...args) => {
        try {
            const session = getSessionByEvent(event);
            if (session) {
                // Session exists — enforce role check
                requireRole(event, roles);
            } else if (!allowNoSession) {
                const denied = new Error('الرجاء تسجيل الدخول أولاً');
                denied.code = 'UNAUTHENTICATED';
                throw denied;
            } else {
                try {
                    const db = getDb();
                    db.prepare(
                        `INSERT INTO system_logs(action, entity_type, entity_id, details)
                         VALUES(?, ?, ?, ?)`
                    ).run(
                        'UNAUTHENTICATED_WRITE',
                        'ipc_channel',
                        channel,
                        `Unauthenticated write on allowlisted channel "${channel}" — no active session`
                    );
                } catch {
                    // Logging failure should not block the operation
                }
            }
            const db = getDb();
            return options?.withContext === true
                ? await handler({ db, event, session: session || null }, ...args)
                : await handler(db, ...args);
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
    ipcErrorResponse,
    SOFT_AUTH_NO_SESSION_CHANNELS,
    getDefaultYear,
    normalizeYear,
    requireSchoolYear,
    handleRead,
    handleAuthedRead,
    handleWrite,
    handleWriteSoftAuth,
    writeChannels: _writeChannels,
    authedReadChannels: _authedReadChannels,
    looksLikeInternalErrorMessage,
    sanitizeIpcErrorMessage
};
