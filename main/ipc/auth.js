const { getDb } = require('../db/context');
const { verifyPassword, hashPassword } = require('../auth/password');
const {
    changeFirebasePassword,
    isFirebaseUnavailable,
    loginFirebaseFirst,
    logoutFirebaseUser,
    normalizeEmail
} = require('../auth/firebase-auth-service');

const SESSION_BY_SENDER = new Map();
const CLEANUP_BOUND = new Set();
const { ALLOWED_ROLES: ALLOWED_ROLES_ARR, resolveRole: resolveRoleAlias } = require('../auth/permissions');
const MAX_PIN_ATTEMPTS = 5;

// ── Hardcoded developer credentials (app developer only) ──
const DEV_CREDENTIALS = {
    email: 'dev@pencil.local',
    // SHA-256 of 'PencilDev2024!'
    passwordHash: '3a46e205c9720f1254531c1e3abf1cadbf73b45ec8707ff9f41fdf145050a3c4'
};

// ── Login throttling ──
const LOGIN_ATTEMPTS = new Map(); // email → { count, lockedUntil }
const MAX_ATTEMPTS_BEFORE_LOCK = 5;
const LOCKOUT_SCHEDULE_MS = [5_000, 15_000, 30_000, 60_000, 120_000]; // escalating
const ATTEMPT_TTL_MS = 30 * 60_000; // auto-clean entries after 30 min

function getLoginAttemptRecord(email) {
    return LOGIN_ATTEMPTS.get(email) || null;
}

function recordFailedLogin(email) {
    const now = Date.now();
    const rec = LOGIN_ATTEMPTS.get(email) || { count: 0, lockedUntil: 0, lastAttempt: 0 };
    rec.count += 1;
    rec.lastAttempt = now;
    if (rec.count >= MAX_ATTEMPTS_BEFORE_LOCK) {
        const tier = Math.min(rec.count - MAX_ATTEMPTS_BEFORE_LOCK, LOCKOUT_SCHEDULE_MS.length - 1);
        rec.lockedUntil = now + LOCKOUT_SCHEDULE_MS[tier];
    }
    LOGIN_ATTEMPTS.set(email, rec);
}

function clearLoginAttempts(email) {
    LOGIN_ATTEMPTS.delete(email);
}

// Periodic cleanup of stale entries (runs at most every 5 min)
let _lastCleanup = Date.now();
function cleanupStaleAttempts() {
    const now = Date.now();
    if (now - _lastCleanup < 5 * 60_000) return;
    _lastCleanup = now;
    for (const [email, rec] of LOGIN_ATTEMPTS) {
        if (now - rec.lastAttempt > ATTEMPT_TTL_MS) LOGIN_ATTEMPTS.delete(email);
    }
}

function normalizeRole(value) {
    const role = resolveRoleAlias(String(value || '').trim().toLowerCase());
    // Allow all storable roles plus 'developer' (hardcoded login bypass).
    return ALLOWED_ROLES_ARR.includes(role) || role === 'developer' ? role : 'principal';
}

function buildPublicSession(userRow, sessionState = {}) {
    if (!userRow) return null;
    return {
        userId: Number(userRow.id || 0),
        name: String(userRow.name || ''),
        email: normalizeEmail(userRow.email),
        role: normalizeRole(userRow.role),
        mustChangePassword: !!userRow.must_change_password,
        authMode: userRow.last_auth_mode || null,
        firebaseUid: userRow.firebase_uid || null,
        authenticatedAt: new Date().toISOString(),
        locked: !!sessionState.locked
    };
}

function bindSenderCleanup(sender) {
    if (!sender || CLEANUP_BOUND.has(sender.id)) return;
    CLEANUP_BOUND.add(sender.id);
    sender.once('destroyed', () => {
        SESSION_BY_SENDER.delete(sender.id);
        CLEANUP_BOUND.delete(sender.id);
    });
}

function getSessionByEvent(event) {
    const senderId = event?.sender?.id;
    if (!senderId) return null;
    return SESSION_BY_SENDER.get(senderId) || null;
}

function getActiveSessions() {
    return SESSION_BY_SENDER;
}

function setSessionForEvent(event, userRow, options = {}) {
    const sender = event?.sender;
    if (!sender) return null;
    const existingSession = options.preserveLockedState ? getSessionByEvent(event) : null;
    const session = buildPublicSession(userRow, existingSession || {});
    if (!session) return null;
    SESSION_BY_SENDER.set(sender.id, session);
    bindSenderCleanup(sender);
    return session;
}

function clearSessionForEvent(event) {
    const senderId = event?.sender?.id;
    if (!senderId) return;
    SESSION_BY_SENDER.delete(senderId);
}

function createAuthError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
}

function isSessionLocked(session) {
    return !!session?.locked;
}

function requireAuth(event) {
    const session = getSessionByEvent(event);
    if (!session) {
        throw createAuthError('UNAUTHENTICATED', 'Please sign in first');
    }
    if (isSessionLocked(session)) {
        throw createAuthError('SESSION_LOCKED', 'Session is locked');
    }
    return session;
}

function requireRole(event, allowedRoles = []) {
    const session = requireAuth(event);
    // Developer role has full access to all channels
    if (session.role === 'developer') return session;
    if (!allowedRoles.includes(session.role)) {
        throw createAuthError('FORBIDDEN', 'ليس لديك صلاحية لتنفيذ هذا الإجراء');
    }
    return session;
}

function findUserById(id) {
    const db = getDb();
    return (
        db
            .prepare(
                `
                SELECT *
                FROM users
                WHERE id = ?
                LIMIT 1
            `
            )
            .get(Number(id)) || null
    );
}

function registerAuthIpc(ipcMain) {
    ipcMain.handle('auth:login', async (event, payload) => {
        try {
            const email = normalizeEmail(payload?.email);
            const password = String(payload?.password || '');
            if (!email) {
                return { success: false, code: 'INVALID_EMAIL', error: 'البريد الإلكتروني مطلوب' };
            }
            if (!password) {
                return { success: false, code: 'INVALID_PASSWORD', error: 'كلمة المرور مطلوبة' };
            }

            // ── Throttle check ──
            cleanupStaleAttempts();
            const attempt = getLoginAttemptRecord(email);
            if (attempt && attempt.lockedUntil > Date.now()) {
                const waitSec = Math.ceil((attempt.lockedUntil - Date.now()) / 1000);
                return {
                    success: false,
                    code: 'TOO_MANY_ATTEMPTS',
                    error: `تم تجاوز عدد المحاولات المسموح. الرجاء الانتظار ${waitSec} ثانية.`
                };
            }

            // ── Developer bypass (hardcoded credentials) ──
            if (email === DEV_CREDENTIALS.email) {
                const crypto = require('crypto');
                const inputHash = crypto.createHash('sha256').update(password).digest('hex');
                if (inputHash !== DEV_CREDENTIALS.passwordHash) {
                    recordFailedLogin(email);
                    return {
                        success: false,
                        code: 'INVALID_CREDENTIALS',
                        error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
                    };
                }
                clearLoginAttempts(email);
                const devSession = {
                    userId: 0,
                    name: 'Developer',
                    email: DEV_CREDENTIALS.email,
                    role: 'developer',
                    mustChangePassword: false,
                    authenticatedAt: new Date().toISOString(),
                    locked: false
                };
                const sender = event?.sender;
                if (sender) {
                    SESSION_BY_SENDER.set(sender.id, devSession);
                    bindSenderCleanup(sender);
                }
                return { success: true, authenticated: true, user: devSession };
            }

            let loginResult;
            try {
                loginResult = await loginFirebaseFirst(email, password);
            } catch (err) {
                recordFailedLogin(email);
                const code = err.publicCode || 'AUTH_FAILED';
                const error =
                    code === 'FIREBASE_NOT_CONFIGURED'
                        ? 'لم يتم إعداد Firebase Auth بعد'
                        : code === 'OFFLINE_LOGIN_UNAVAILABLE'
                          ? 'تعذر الاتصال بالمصادقة السحابية ولا يوجد دخول محلي صالح لهذا المستخدم'
                          : 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
                return {
                    success: false,
                    code,
                    error
                };
            }

            // Success — clear throttle record
            clearLoginAttempts(email);
            const session = setSessionForEvent(event, loginResult.userRow);
            return {
                success: true,
                authenticated: true,
                user: session,
                authMode: loginResult.mode
            };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('auth:getSession', async (event) => {
        try {
            const session = getSessionByEvent(event);
            if (!session) {
                return { success: true, authenticated: false };
            }

            const user = findUserById(session.userId);
            if (!user || Number(user.disabled || 0) === 1) {
                clearSessionForEvent(event);
                return { success: true, authenticated: false };
            }

            const refreshedSession = setSessionForEvent(event, user, { preserveLockedState: true });
            return {
                success: true,
                authenticated: true,
                user: refreshedSession
            };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('auth:logout', async (event) => {
        try {
            try {
                await logoutFirebaseUser();
            } catch (err) {
                console.warn('[auth] Firebase logout failed:', err.message);
            }
            clearSessionForEvent(event);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ── Self-registration is disabled. Users must be created by an admin/onboarding flow. ──
    ipcMain.handle('auth:register', async (_event, _payload) => {
        try {
            return {
                success: false,
                code: 'SELF_SIGNUP_DISABLED',
                error: 'إنشاء الحسابات متاح فقط من طرف المدير أو أثناء إعداد المؤسسة'
            };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ── Change password (requires current password) ──
    ipcMain.handle('auth:changePassword', async (event, payload) => {
        try {
            const session = requireAuth(event);

            const currentPassword = String(payload?.currentPassword || '');
            const newPassword = String(payload?.newPassword || '');

            if (!currentPassword) {
                return { success: false, code: 'MISSING_CURRENT', error: 'كلمة المرور الحالية مطلوبة' };
            }
            if (newPassword.length < 6) {
                return {
                    success: false,
                    code: 'WEAK_PASSWORD',
                    error: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل'
                };
            }

            const db = getDb();
            const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(session.userId);
            if (!user) {
                return { success: false, code: 'USER_NOT_FOUND', error: 'المستخدم غير موجود' };
            }

            try {
                await changeFirebasePassword(session, currentPassword, newPassword);
            } catch (err) {
                if (!isFirebaseUnavailable(err)) {
                    const code =
                        err.code === 'auth/wrong-password' ||
                        err.code === 'auth/invalid-credential' ||
                        err.code === 'auth/invalid-login-credentials'
                            ? 'INVALID_CURRENT'
                            : err.code || 'PASSWORD_CHANGE_FAILED';
                    return {
                        success: false,
                        code,
                        error: code === 'INVALID_CURRENT' ? 'كلمة المرور الحالية غير صحيحة' : err.message
                    };
                }

                if (!verifyPassword(currentPassword, String(user.password_hash || ''))) {
                    return { success: false, code: 'INVALID_CURRENT', error: 'كلمة المرور الحالية غير صحيحة' };
                }

                db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(
                    hashPassword(newPassword),
                    session.userId
                );
            }

            session.mustChangePassword = false;

            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ── PIN: setup (authenticated user sets or changes PIN) ──
    ipcMain.handle('auth:setupPin', async (event, payload) => {
        try {
            const session = requireAuth(event);

            const pin = String(payload?.pin || '');
            if (!/^\d{4,6}$/.test(pin)) {
                return { success: false, code: 'INVALID_PIN', error: 'رمز PIN يجب أن يكون من 4 إلى 6 أرقام' };
            }

            const db = getDb();
            db.prepare('UPDATE users SET pin_hash = ?, pin_failed_attempts = 0 WHERE id = ?').run(
                hashPassword(pin),
                session.userId
            );

            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ── PIN: verify (lock-screen unlock) ──
    ipcMain.handle('auth:verifyPin', async (event, payload) => {
        try {
            const session = getSessionByEvent(event);
            if (!session) {
                return { success: false, code: 'UNAUTHENTICATED', error: 'الرجاء تسجيل الدخول أولاً' };
            }

            const pin = String(payload?.pin || '');
            if (!pin) {
                return { success: false, code: 'INVALID_PIN', error: 'رمز PIN مطلوب' };
            }

            const db = getDb();
            const user = db
                .prepare('SELECT id, pin_hash, pin_failed_attempts FROM users WHERE id = ?')
                .get(session.userId);
            if (!user) {
                return { success: false, code: 'USER_NOT_FOUND', error: 'المستخدم غير موجود' };
            }

            const storedPinHash = String(user.pin_hash || '').trim();
            if (!storedPinHash) {
                return { success: false, code: 'PIN_NOT_SET', error: 'لم يتم إعداد رمز PIN' };
            }

            const failedAttempts = Number(user.pin_failed_attempts || 0);
            if (failedAttempts >= MAX_PIN_ATTEMPTS) {
                return {
                    success: false,
                    code: 'PIN_LOCKED',
                    error: 'تم تجاوز الحد الأقصى لمحاولات PIN. استخدم كلمة المرور.',
                    requirePassword: true
                };
            }

            if (!verifyPassword(pin, storedPinHash)) {
                const newCount = failedAttempts + 1;
                db.prepare('UPDATE users SET pin_failed_attempts = ? WHERE id = ?').run(newCount, session.userId);

                if (newCount >= MAX_PIN_ATTEMPTS) {
                    return {
                        success: false,
                        code: 'PIN_LOCKED',
                        error: 'تم تجاوز الحد الأقصى لمحاولات PIN. استخدم كلمة المرور.',
                        requirePassword: true,
                        attemptsRemaining: 0
                    };
                }

                return {
                    success: false,
                    code: 'INVALID_PIN',
                    error: 'رمز PIN غير صحيح',
                    attemptsRemaining: MAX_PIN_ATTEMPTS - newCount
                };
            }

            // Success — reset failed attempts and unlock
            db.prepare('UPDATE users SET pin_failed_attempts = 0 WHERE id = ?').run(session.userId);
            session.locked = false;

            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ── PIN: remove ──
    ipcMain.handle('auth:removePin', async (event) => {
        try {
            const session = getSessionByEvent(event);
            if (!session) {
                return { success: false, code: 'UNAUTHENTICATED', error: 'الرجاء تسجيل الدخول أولاً' };
            }

            const db = getDb();
            db.prepare('UPDATE users SET pin_hash = NULL, pin_failed_attempts = 0 WHERE id = ?').run(session.userId);

            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ── PIN: get status (has PIN configured?) ──
    ipcMain.handle('auth:getPinStatus', async (event) => {
        try {
            const session = getSessionByEvent(event);
            if (!session) {
                return { success: false, code: 'UNAUTHENTICATED', error: 'الرجاء تسجيل الدخول أولاً' };
            }

            const db = getDb();
            const user = db.prepare('SELECT pin_hash, pin_failed_attempts FROM users WHERE id = ?').get(session.userId);

            const hasPin = !!(user && String(user.pin_hash || '').trim());
            const pinLocked = hasPin && Number(user.pin_failed_attempts || 0) >= MAX_PIN_ATTEMPTS;

            return { success: true, configured: hasPin, locked: pinLocked };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ── Session lock (marks in-memory session as locked) ──
    ipcMain.handle('auth:lockSession', async (event) => {
        try {
            const session = getSessionByEvent(event);
            if (!session) {
                return { success: false, code: 'UNAUTHENTICATED', error: 'الرجاء تسجيل الدخول أولاً' };
            }
            session.locked = true;
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ── Allowed pages for the current session's role ──
    ipcMain.handle('auth:getAllowedPages', (event) => {
        const { getAllowedPages } = require('../auth/permissions');
        const session = getSessionByEvent(event);
        if (!session) return [];
        return getAllowedPages(session.role);
    });

    // ── Unlock with password (fallback when PIN is locked out) ──
    ipcMain.handle('auth:unlockWithPassword', async (event, payload) => {
        try {
            const session = getSessionByEvent(event);
            if (!session) {
                return { success: false, code: 'UNAUTHENTICATED', error: 'الرجاء تسجيل الدخول أولاً' };
            }

            const password = String(payload?.password || '');
            if (!password) {
                return { success: false, code: 'INVALID_PASSWORD', error: 'كلمة المرور مطلوبة' };
            }

            const db = getDb();
            const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(session.userId);
            if (!user) {
                return { success: false, code: 'USER_NOT_FOUND', error: 'المستخدم غير موجود' };
            }

            if (!verifyPassword(password, String(user.password_hash || ''))) {
                return { success: false, code: 'INVALID_PASSWORD', error: 'كلمة المرور غير صحيحة' };
            }

            // Reset PIN failed attempts and unlock session
            db.prepare('UPDATE users SET pin_failed_attempts = 0 WHERE id = ?').run(session.userId);
            session.locked = false;

            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
}

module.exports = {
    registerAuthIpc,
    requireAuth,
    requireRole,
    getSessionByEvent,
    getActiveSessions
};
