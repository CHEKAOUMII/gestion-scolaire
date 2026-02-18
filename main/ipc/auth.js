const { getDb } = require('../db/context');
const { verifyPassword } = require('../auth/password');

const SESSION_BY_SENDER = new Map();
const CLEANUP_BOUND = new Set();
const ALLOWED_ROLES = new Set(['admin', 'staff', 'viewer']);

function normalizeEmail(value) {
    return String(value || '')
        .trim()
        .toLowerCase();
}

function normalizeRole(value) {
    const role = String(value || '').trim().toLowerCase();
    return ALLOWED_ROLES.has(role) ? role : 'staff';
}

function buildPublicSession(userRow) {
    if (!userRow) return null;
    return {
        userId: Number(userRow.id || 0),
        name: String(userRow.name || ''),
        email: normalizeEmail(userRow.email),
        role: normalizeRole(userRow.role),
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
                SELECT id, name, email, role, password_hash, disabled
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

            const user = findUserByEmail(email);
            if (!user) {
                return {
                    success: false,
                    code: 'USER_NOT_FOUND',
                    error: 'هذا الحساب غير موجود محلياً'
                };
            }

            if (Number(user.disabled || 0) === 1) {
                return {
                    success: false,
                    code: 'USER_DISABLED',
                    error: 'تم تعطيل هذا المستخدم من طرف الإدارة'
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
                return {
                    success: false,
                    code: 'INVALID_CREDENTIALS',
                    error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
                };
            }

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
}

module.exports = {
    registerAuthIpc,
    requireAuth,
    requireRole
};
