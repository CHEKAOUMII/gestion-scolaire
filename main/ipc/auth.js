const { getDb } = require('../db/context');
const { verifyPassword, hashPassword } = require('../auth/password');
const {
    changeFirebasePassword,
    getCurrentFirebaseIdToken,
    isFirebaseUnavailable,
    loginFirebaseFirst,
    logoutFirebaseUser,
    normalizeEmail
} = require('../auth/firebase-auth-service');
const { logAuthDebug } = require('../auth/debug');
const { applySyncDefaults } = require('../sync/defaults');

const SESSION_BY_SENDER = new Map();
const CLEANUP_BOUND = new Set();
const { ALLOWED_ROLES: ALLOWED_ROLES_ARR, resolveRole: resolveRoleAlias } = require('../auth/permissions');
const MAX_PIN_ATTEMPTS = 5;

// ── Developer credentials (env-var gated, never in production builds) ──
const DEV_CREDENTIALS =
    process.env.PENCIL_DEV_MODE === '1' && process.env.PENCIL_DEV_PASSWORD_HASH
        ? { email: 'dev@pencil.local', passwordHash: process.env.PENCIL_DEV_PASSWORD_HASH }
        : null;

// ── Login throttling (persisted to SQLite) ──
const MAX_ATTEMPTS_BEFORE_LOCK = 5;
const LOCKOUT_SCHEDULE_MS = [5_000, 15_000, 30_000, 60_000, 120_000]; // escalating
const ATTEMPT_TTL_MS = 30 * 60_000; // auto-clean entries after 30 min

function getLoginAttemptRecord(email) {
    try {
        const db = getDb();
        const row = db.prepare('SELECT * FROM login_attempts WHERE email = ?').get(normalizeEmail(email));
        if (!row) return null;
        return { count: row.attempts, lockedUntil: row.locked_until, lastAttempt: row.updated_at };
    } catch {
        return null;
    }
}

function recordFailedLogin(email) {
    try {
        const db = getDb();
        const normalized = normalizeEmail(email);
        const now = Date.now();
        const existing = db.prepare('SELECT * FROM login_attempts WHERE email = ?').get(normalized);
        const count = (existing?.attempts || 0) + 1;
        let lockedUntil = existing?.locked_until || 0;

        if (count >= MAX_ATTEMPTS_BEFORE_LOCK) {
            const tier = Math.min(count - MAX_ATTEMPTS_BEFORE_LOCK, LOCKOUT_SCHEDULE_MS.length - 1);
            lockedUntil = now + LOCKOUT_SCHEDULE_MS[tier];
        }

        db.prepare(
            `INSERT INTO login_attempts(email, attempts, locked_until, updated_at)
             VALUES(?, ?, ?, ?)
             ON CONFLICT(email) DO UPDATE SET attempts = ?, locked_until = ?, updated_at = ?`
        ).run(normalized, count, lockedUntil, now, count, lockedUntil, now);
    } catch (err) {
        console.warn('[auth] Failed to record login attempt:', err.message);
    }
}

function clearLoginAttempts(email) {
    try {
        const db = getDb();
        db.prepare('DELETE FROM login_attempts WHERE email = ?').run(normalizeEmail(email));
    } catch (err) {
        console.warn('[auth] Failed to clear login attempts:', err.message);
    }
}

// Periodic cleanup of stale entries (runs at most every 5 min)
let _lastCleanup = Date.now();
function cleanupStaleAttempts() {
    const now = Date.now();
    if (now - _lastCleanup < 5 * 60_000) return;
    _lastCleanup = now;
    try {
        const db = getDb();
        const cutoff = now - ATTEMPT_TTL_MS;
        db.prepare('DELETE FROM login_attempts WHERE updated_at < ?').run(cutoff);
    } catch (err) {
        console.warn('[auth] Failed to cleanup stale login attempts:', err.message);
    }
}

function normalizeRole(value) {
    const role = resolveRoleAlias(
        String(value || '')
            .trim()
            .toLowerCase()
    );
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

function tryDevBypass(email, password, event) {
    if (!DEV_CREDENTIALS || email !== DEV_CREDENTIALS.email) return null;

    const crypto = require('crypto');
    const inputHash = crypto.createHash('sha256').update(password).digest('hex');
    if (inputHash !== DEV_CREDENTIALS.passwordHash) {
        recordFailedLogin(email);
        return { success: false, code: 'INVALID_CREDENTIALS', error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' };
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

async function handleLinkRequest(email) {
    try {
        const db = getDb();
        const instRow = db.prepare('SELECT code_etablissement FROM institution_config WHERE id = 1').get() || {};
        const localSchoolCode = String(instRow.code_etablissement || '')
            .trim()
            .toUpperCase();
        if (!localSchoolCode) return null;

        const idToken = await getCurrentFirebaseIdToken(false);
        const syncRow = db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
        const functionsUrl = applySyncDefaults(syncRow).firebaseFunctionsUrl || '';
        if (!idToken || !functionsUrl) return null;

        const os = require('os');
        const linkResp = await fetch(`${functionsUrl}/submitLinkRequest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken, schoolCode: localSchoolCode, deviceName: os.hostname() })
        });
        const linkData = await linkResp.json().catch(() => ({}));
        if (linkResp.ok && linkData.success !== false) {
            logAuthDebug('ipc.login.link-request-submitted', { email, schoolCode: localSchoolCode });
            return {
                success: false,
                code: 'LINK_REQUEST_SUBMITTED',
                error: 'تم إرسال طلب ربط حسابك بالمؤسسة. انتظر موافقة المدير ثم أعد تسجيل الدخول'
            };
        }
    } catch (linkErr) {
        logAuthDebug('ipc.login.link-request-auto-failed', { email, message: linkErr.message });
    }
    return null;
}

function getLoginErrorMessage(code) {
    switch (code) {
        case 'FIREBASE_NOT_CONFIGURED':
            return 'لم يتم إعداد Firebase Auth بعد';
        case 'OFFLINE_LOGIN_UNAVAILABLE':
            return 'تعذر الاتصال بالمصادقة السحابية ولا يوجد دخول محلي صالح لهذا المستخدم';
        case 'LOCAL_SCHOOL_ID_MISSING':
            return 'تعذر تحديد رمز المؤسسة من الحساب السحابي. اطلب من المدير إعادة ربط الحساب بالمؤسسة';
        case 'FIREBASE_PROFILE_REQUIRED':
        case 'FIREBASE_SCHOOL_MISMATCH':
            return 'هذا الحساب غير مرتبط بهذه المؤسسة';
        default:
            return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
    }
}

async function postLoginSetup(event, loginResult, email, password) {
    clearLoginAttempts(email);
    const session = setSessionForEvent(event, loginResult.userRow);
    logAuthDebug('ipc.login.success-response', {
        email,
        authMode: loginResult.mode,
        userId: session?.userId || null,
        role: session?.role || null
    });

    // Mark the auth transition so any sync cycle still in flight from before this sign-in
    // knows it spanned a login and treats its errors as a transient interruption.
    try {
        require('../sync/engine').bumpSyncAuthEpoch();
    } catch (epochErr) {
        console.warn('[auth] Failed to bump sync-auth epoch on login:', epochErr.message);
    }

    if (loginResult.mode === 'online') {
        // Clear any stale sync error left by a cycle that was interrupted by the previous
        // sign-out. Without this, a transient "sync rejected — re-login" error recorded
        // during the signed-out window keeps showing in the UI until the next fully-clean
        // push completes (which can take minutes on a data-heavy device). Signing back in
        // is a clean slate; a genuine error will simply be re-recorded by the next cycle.
        try {
            getDb()
                .prepare('UPDATE sync_config SET last_push_error = NULL, last_pull_error = NULL WHERE id = 1')
                .run();
        } catch (clearErr) {
            console.warn('[auth] Failed to clear stale sync errors on login:', clearErr.message);
        }

        try {
            const { persistCredential, clearCredentials } = require('../sync/credentials');
            persistCredential(email, password);
            clearCredentials();
        } catch (credErr) {
            console.warn('[auth] Failed to persist sync credential after login:', credErr.message);
        }

        try {
            const { recoverFirestoreClient } = require('../firebase/config');
            await recoverFirestoreClient();
        } catch (recoverErr) {
            console.warn('[auth] Failed to refresh Firebase client after login:', recoverErr.message);
        }

        try {
            const { restartSyncPushBackground, restartSyncPullBackground } = require('../sync/engine');
            const { restartSnapshotBackground } = require('../sync/snapshot');
            restartSyncPushBackground();
            restartSyncPullBackground();
            restartSnapshotBackground();
        } catch (syncErr) {
            console.warn('[auth] Failed to restart sync after login:', syncErr.message);
        }
    } else {
        try {
            const { stopSyncPushBackground, stopSyncPullBackground } = require('../sync/engine');
            const { stopSnapshotBackground } = require('../sync/snapshot');
            const { clearCredentials } = require('../sync/credentials');
            stopSyncPushBackground();
            stopSyncPullBackground();
            stopSnapshotBackground();
            clearCredentials();
        } catch (syncErr) {
            console.warn('[auth] Failed to stop cloud sync after offline login:', syncErr.message);
        }
    }

    return { success: true, authenticated: true, user: session, authMode: loginResult.mode };
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
            logAuthDebug('ipc.login.request', { email, senderId: event?.sender?.id || null });

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

            const devResult = tryDevBypass(email, password, event);
            if (devResult) return devResult;

            let loginResult;
            try {
                loginResult = await loginFirebaseFirst(email, password);
            } catch (err) {
                recordFailedLogin(email);
                const code = err.publicCode || 'AUTH_FAILED';

                if (code === 'LOCAL_SCHOOL_ID_MISSING') {
                    const linkResult = await handleLinkRequest(email);
                    if (linkResult) return linkResult;
                }

                logAuthDebug('ipc.login.failed-response', {
                    email,
                    code,
                    internalCode: err.code || null,
                    message: err.message || String(err)
                });
                return {
                    success: false,
                    code,
                    error: getLoginErrorMessage(code),
                    _diag: {
                        firebaseCode: err.code || null,
                        message: err.message || null,
                        publicCode: err.publicCode || null
                    }
                };
            }

            return await postLoginSetup(event, loginResult, email, password);
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

            // Developer sessions have no DB row — skip refresh
            if (session.role === 'developer') {
                return { success: true, authenticated: true, user: session };
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
            // Stop the background sync loops BEFORE tearing down the Firebase session.
            // Otherwise a push/pull cycle can fire during the signed-out window and hit
            // Firestore with request.auth == null → PERMISSION_DENIED.
            try {
                const { stopSyncPushBackground, stopSyncPullBackground, bumpSyncAuthEpoch } =
                    require('../sync/engine');
                // Mark the auth transition first so any push/pull cycle already in flight
                // (which these stop() calls cannot abort) recognizes that its session was
                // torn down and treats the resulting PERMISSION_DENIED as transient.
                bumpSyncAuthEpoch();
                stopSyncPushBackground();
                stopSyncPullBackground();
            } catch (syncErr) {
                console.warn('[auth] Failed to stop sync on logout:', syncErr.message);
            }
            try {
                await logoutFirebaseUser();
            } catch (err) {
                console.warn('[auth] Firebase logout failed:', err.message);
            }
            try {
                // clearStoredCredential() nulls the DB copy; clearCredentials() purges the
                // in-memory cached session so a stale, still-valid-looking session object is
                // never handed to a sync cycle after signOut().
                const { clearStoredCredential, clearCredentials } = require('../sync/credentials');
                clearCredentials();
                clearStoredCredential();
            } catch (credErr) {
                console.warn('[auth] Failed to clear stored credential:', credErr.message);
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
            const user = db.prepare('SELECT id, email, password_hash FROM users WHERE id = ?').get(session.userId);
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

            // Rebuild session from DB so mustChangePassword is consistent
            const updatedUser = findUserById(session.userId);
            if (updatedUser) {
                setSessionForEvent(event, updatedUser);
            }

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
            const session = requireAuth(event);

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

    // ── Link request: legacy user submits request to be linked to a school ──
    ipcMain.handle('auth:submitLinkRequest', async (_event, payload) => {
        try {
            const idToken = payload?.idToken;
            const schoolCode = String(payload?.schoolCode || '')
                .trim()
                .toUpperCase();
            const deviceName = String(payload?.deviceName || '').trim();
            if (!idToken || !schoolCode) {
                return { success: false, code: 'INVALID_REQUEST', error: 'بيانات غير كاملة' };
            }

            const db = getDb();
            const syncRow = db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
            const functionsUrl = applySyncDefaults(syncRow).firebaseFunctionsUrl || '';
            if (!functionsUrl) {
                return {
                    success: false,
                    code: 'FIREBASE_FUNCTIONS_NOT_CONFIGURED',
                    error: 'لم يتم ضبط رابط Cloud Functions'
                };
            }

            const response = await fetch(`${functionsUrl}/submitLinkRequest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idToken, schoolCode, deviceName })
            });
            const data = await response.json().catch(() => ({}));

            if (!response.ok || data.success === false) {
                const code = data.error || data.code || 'LINK_REQUEST_FAILED';
                const errorMap = {
                    ALREADY_LINKED: 'هذا الحساب مرتبط بمؤسسة بالفعل',
                    SCHOOL_NOT_FOUND: 'لم يتم العثور على المؤسسة برمز ' + schoolCode,
                    INVALID_REQUEST: 'بيانات غير صالحة'
                };
                return { success: false, code, error: errorMap[code] || 'فشل إرسال طلب الربط' };
            }

            return { success: true, alreadyPending: !!data.alreadyPending };
        } catch (err) {
            logAuthDebug('ipc.submitLinkRequest.error', { message: err.message });
            return { success: false, error: err.message };
        }
    });

    // ── Link request: admin lists pending requests ──
    ipcMain.handle('auth:listLinkRequests', async (event) => {
        try {
            requireRole(event, ['admin', 'principal']);
            const db = getDb();
            const syncRow = db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
            const functionsUrl = applySyncDefaults(syncRow).firebaseFunctionsUrl || '';
            if (!functionsUrl) {
                return {
                    success: false,
                    code: 'FIREBASE_FUNCTIONS_NOT_CONFIGURED',
                    error: 'لم يتم ضبط رابط Cloud Functions'
                };
            }

            const idToken = await getCurrentFirebaseIdToken(true);
            const response = await fetch(`${functionsUrl}/listLinkRequests`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idToken })
            });
            const data = await response.json().catch(() => ({}));

            if (!response.ok || data.success === false) {
                return { success: false, error: data.error || 'فشل جلب طلبات الربط' };
            }

            return { success: true, requests: data.requests || [] };
        } catch (err) {
            logAuthDebug('ipc.listLinkRequests.error', { message: err.message });
            return { success: false, error: err.message };
        }
    });

    // ── Link request: admin approves or rejects ──
    ipcMain.handle('auth:resolveLinkRequest', async (event, payload) => {
        try {
            requireRole(event, ['admin', 'principal']);
            const targetUid = String(payload?.targetUid || '').trim();
            const action = String(payload?.action || '').trim();
            const role = String(payload?.role || 'viewer').trim();

            if (!targetUid || (action !== 'approve' && action !== 'reject')) {
                return { success: false, code: 'INVALID_REQUEST', error: 'بيانات غير صالحة' };
            }
            if (getSessionByEvent(event)?.role === 'principal' && role === 'admin') {
                return { success: false, code: 'FORBIDDEN_ROLE', error: 'مدير المؤسسة لا يمكنه منح دور مدير التطبيق' };
            }

            const db = getDb();
            const syncRow = db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
            const functionsUrl = applySyncDefaults(syncRow).firebaseFunctionsUrl || '';
            if (!functionsUrl) {
                return {
                    success: false,
                    code: 'FIREBASE_FUNCTIONS_NOT_CONFIGURED',
                    error: 'لم يتم ضبط رابط Cloud Functions'
                };
            }

            const idToken = await getCurrentFirebaseIdToken(true);
            const response = await fetch(`${functionsUrl}/resolveLinkRequest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idToken, targetUid, action, role })
            });
            const data = await response.json().catch(() => ({}));

            if (!response.ok || data.success === false) {
                const errorMap = {
                    REQUEST_NOT_FOUND: 'الطلب غير موجود',
                    REQUEST_ALREADY_RESOLVED: 'تم معالجة هذا الطلب مسبقاً'
                };
                const code = data.error || data.code || 'RESOLVE_FAILED';
                return { success: false, code, error: errorMap[code] || 'فشل معالجة الطلب' };
            }

            return { success: true, action: data.action, uid: data.uid, role: data.role };
        } catch (err) {
            logAuthDebug('ipc.resolveLinkRequest.error', { message: err.message });
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
