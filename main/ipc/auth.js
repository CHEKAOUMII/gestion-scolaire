const { getDb } = require('../db/context');
const { verifyPassword, hashPassword } = require('../auth/password');

const SESSION_BY_SENDER = new Map();
const CLEANUP_BOUND = new Set();
const ALLOWED_ROLES = new Set(['admin', 'staff', 'viewer']);

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

function normalizeEmail(value) {
    return String(value || '')
        .trim()
        .toLowerCase();
}

function normalizeRole(value) {
    const role = String(value || '')
        .trim()
        .toLowerCase();
    return ALLOWED_ROLES.has(role) ? role : 'staff';
}

function buildPublicSession(userRow) {
    if (!userRow) return null;
    return {
        userId: Number(userRow.id || 0),
        name: String(userRow.name || ''),
        email: normalizeEmail(userRow.email),
        role: normalizeRole(userRow.role),
        mustChangePassword: !!userRow.must_change_password,
        authenticatedAt: new Date().toISOString()
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

function setSessionForEvent(event, userRow) {
    const sender = event?.sender;
    if (!sender) return null;
    const session = buildPublicSession(userRow);
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

function requireAuth(event) {
    const session = getSessionByEvent(event);
    if (!session) {
        throw createAuthError('UNAUTHENTICATED', 'الرجاء تسجيل الدخول أولاً');
    }
    return session;
}

function requireRole(event, allowedRoles = []) {
    const session = requireAuth(event);
    if (!allowedRoles.includes(session.role)) {
        throw createAuthError('FORBIDDEN', 'ليس لديك صلاحية لتنفيذ هذا الإجراء');
    }
    return session;
}

function findUserByEmail(email) {
    const db = getDb();
    return (
        db
            .prepare(
                `
                SELECT id, name, email, role, password_hash, disabled, must_change_password
                FROM users
                WHERE lower(email) = ?
                LIMIT 1
            `
            )
            .get(normalizeEmail(email)) || null
    );
}

function findUserById(id) {
    const db = getDb();
    return (
        db
            .prepare(
                `
                SELECT id, name, email, role, disabled
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

            const user = findUserByEmail(email);
            if (!user) {
                recordFailedLogin(email);
                return {
                    success: false,
                    code: 'INVALID_CREDENTIALS',
                    error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
                };
            }

            if (Number(user.disabled || 0) === 1) {
                recordFailedLogin(email);
                return {
                    success: false,
                    code: 'INVALID_CREDENTIALS',
                    error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
                };
            }

            const storedHash = String(user.password_hash || '').trim();
            if (!storedHash) {
                return {
                    success: false,
                    code: 'PASSWORD_NOT_SET',
                    error: 'لم يتم تعيين كلمة مرور لهذا المستخدم'
                };
            }

            if (!verifyPassword(password, storedHash)) {
                recordFailedLogin(email);
                return {
                    success: false,
                    code: 'INVALID_CREDENTIALS',
                    error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
                };
            }

            // Success — clear throttle record
            clearLoginAttempts(email);
            const session = setSessionForEvent(event, user);
            return {
                success: true,
                authenticated: true,
                user: session
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

            const refreshedSession = setSessionForEvent(event, user);
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
            clearSessionForEvent(event);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ── Self-registration (creates staff user, never admin) ──
    ipcMain.handle('auth:register', async (event, payload) => {
        try {
            const name = String(payload?.name || '').trim();
            const email = normalizeEmail(payload?.email);
            const password = String(payload?.password || '');

            if (!name || name.length < 2) {
                return { success: false, code: 'INVALID_NAME', error: 'الاسم مطلوب (حرفان على الأقل)' };
            }
            if (!email || !email.includes('@')) {
                return { success: false, code: 'INVALID_EMAIL', error: 'البريد الإلكتروني غير صالح' };
            }
            if (password.length < 6) {
                return { success: false, code: 'WEAK_PASSWORD', error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' };
            }

            const db = getDb();
            const existing = db.prepare('SELECT id FROM users WHERE lower(email) = ? LIMIT 1').get(email);
            if (existing) {
                return { success: false, code: 'EMAIL_EXISTS', error: 'هذا البريد الإلكتروني مستخدم بالفعل' };
            }

            const result = db.prepare(
                `INSERT INTO users(name, email, role, password_hash, disabled, must_change_password)
                 VALUES(?, ?, 'staff', ?, 0, 0)`
            ).run(name, email, hashPassword(password));

            const userId = result.lastInsertRowid;
            const userRow = db.prepare('SELECT id, name, email, role, disabled, must_change_password FROM users WHERE id = ?').get(userId);
            const session = setSessionForEvent(event, userRow);

            return {
                success: true,
                authenticated: true,
                user: session
            };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ── Change password (requires current password) ──
    ipcMain.handle('auth:changePassword', async (event, payload) => {
        try {
            const session = getSessionByEvent(event);
            if (!session) {
                return { success: false, code: 'UNAUTHENTICATED', error: 'الرجاء تسجيل الدخول أولاً' };
            }

            const currentPassword = String(payload?.currentPassword || '');
            const newPassword = String(payload?.newPassword || '');

            if (!currentPassword) {
                return { success: false, code: 'MISSING_CURRENT', error: 'كلمة المرور الحالية مطلوبة' };
            }
            if (newPassword.length < 6) {
                return { success: false, code: 'WEAK_PASSWORD', error: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' };
            }

            const db = getDb();
            const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(session.userId);
            if (!user) {
                return { success: false, code: 'USER_NOT_FOUND', error: 'المستخدم غير موجود' };
            }

            if (!verifyPassword(currentPassword, String(user.password_hash || ''))) {
                return { success: false, code: 'INVALID_CURRENT', error: 'كلمة المرور الحالية غير صحيحة' };
            }

            db.prepare(
                'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?'
            ).run(hashPassword(newPassword), session.userId);

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
    getSessionByEvent
};
