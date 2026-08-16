const { getDb } = require('../db/context');
const { requireRole, getSessionByEvent } = require('./auth');
const { hashPassword, generateRandomPassword } = require('../auth/password');
const { authErrorResponse, handleWrite, handleWriteSoftAuth, handleAuthedRead } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const { getCurrentFirebaseIdToken } = require('../auth/firebase-auth-service');
const { applySyncDefaults } = require('../sync/defaults');
const { IMPORT_AUDIT_TYPES, IMPORT_AUDIT_MAX_DETAILS, isRendererImportNotice } = require('./import-audit');
const usersRepo = require('../repos/users');
const institutionRepo = require('../repos/institution');
const pageVisibilityRepo = require('../repos/page-visibility');
const systemLogsRepo = require('../repos/system-logs');

const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');

function normalizeEmail(value) {
    return String(value || '')
        .trim()
        .toLowerCase();
}

function getSchoolId(db) {
    const syncRow = institutionRepo.getSyncConfigRow(db);
    const instStatus = institutionRepo.getStatusRecord(db);
    return String(syncRow.school_id || instStatus.massarCode || process.env.FIREBASE_SCHOOL_ID || '').trim();
}

function getFirebaseFunctionsUrl(db) {
    const row = institutionRepo.getSyncConfigRow(db);
    return applySyncDefaults(row).firebaseFunctionsUrl || '';
}

async function postFirebaseFunction(db, functionName, body) {
    const functionsUrl = getFirebaseFunctionsUrl(db);
    if (!functionsUrl) {
        const err = new Error('Firebase Functions URL is not configured');
        err.code = 'FIREBASE_FUNCTIONS_NOT_CONFIGURED';
        throw err;
    }

    const idToken = await getCurrentFirebaseIdToken(true);
    const response = await fetch(`${functionsUrl}/${functionName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(body || {}), idToken })
    });
    const text = await response.text();
    let data = {};
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { message: text };
        }
    }

    if (!response.ok || data.success === false) {
        const err = new Error(data.message || data.error || `Firebase function ${functionName} failed`);
        err.code = data.code || data.error || 'FIREBASE_FUNCTION_FAILED';
        err.status = response.status;
        throw err;
    }

    return data;
}

async function provisionFirebaseUser(db, payload) {
    const email = normalizeEmail(payload.email);
    if (!email) {
        const err = new Error('Email is required for Firebase user provisioning');
        err.code = 'MISSING_EMAIL';
        throw err;
    }

    const data = await postFirebaseFunction(db, 'provisionSchoolUser', {
        schoolId: getSchoolId(db),
        email,
        name: String(payload.name || '').trim(),
        role: payload.role || 'principal',
        temporaryPassword: String(payload.password || ''),
        mustChangePassword: !!payload.mustChangePassword,
        createInvite: payload.createInvite !== false
    });

    return {
        status: 'created',
        uid: data.uid,
        emailVerified: !!data.profile?.emailVerified,
        temporaryPassword: data.temporaryPassword || null
    };
}

function shouldSaveLocalOnlyOnFirebaseError(err) {
    return [
        'FIREBASE_FUNCTIONS_NOT_CONFIGURED',
        'MISSING_ID_TOKEN',
        'ADMIN_REQUIRED',
        'USER_DISABLED',
        'Firebase user is not signed in'
    ].includes(err?.code || err?.message);
}

function localOnlyFirebaseResult(reason) {
    return { status: 'skipped', reason };
}

function isPrincipalSession(event) {
    return getSessionByEvent(event)?.role === 'principal';
}

function isPrivilegedUserRole(role) {
    return role === 'admin' || role === 'developer';
}

async function tryProvisionFirebaseUser(db, payload) {
    try {
        return await provisionFirebaseUser(db, payload);
    } catch (err) {
        if (shouldSaveLocalOnlyOnFirebaseError(err)) {
            return localOnlyFirebaseResult(err.code || err.message || 'firebase-provisioning-skipped');
        }
        throw err;
    }
}

async function updateFirebaseUserRole(db, user, role) {
    let uid = String(user?.firebase_uid || '').trim();
    if (!uid) {
        const err = new Error('Firebase UID is required for role updates');
        err.code = 'MISSING_FIREBASE_UID';
        throw err;
    }

    const data = await postFirebaseFunction(db, 'updateSchoolUserRole', { schoolId: getSchoolId(db), targetUid: uid, role });
    return { status: 'updated', uid: data.uid || uid };
}

async function updateFirebaseUserDisabled(db, user, disabled) {
    let uid = String(user?.firebase_uid || '').trim();
    if (!uid) {
        const err = new Error('Firebase UID is required for disabling users');
        err.code = 'MISSING_FIREBASE_UID';
        throw err;
    }

    const data = await postFirebaseFunction(db, 'setSchoolUserDisabled', {
        schoolId: getSchoolId(db),
        targetUid: uid,
        disabled: !!disabled
    });
    return { status: 'updated', uid: data.uid || uid };
}

function buildFirebaseProvisioningWarning(result) {
    if (!result || result.status === 'created' || result.status === 'linked' || result.status === 'updated') {
        return null;
    }
    return result.reason || 'firebase-provisioning-skipped';
}

function registerSystemIpc(ipcMain) {
    handleAuthedRead(ipcMain, 'systemLogs:getAll', ({ db }, limit) => {
        return systemLogsRepo.listLogs(db, limit || 200);
    });

    handleWriteSoftAuth(ipcMain, 'systemLogs:add', WRITE_ROLES, (db, payload) => {
        const action = String(payload?.action || '');
        const entityType = String(payload?.entity_type || '');
        const entityId = String(payload?.entity_id || '');

        if (entityType === 'import') {
            if (!action.startsWith('import:')) {
                return { success: false, error: 'Invalid log entry type' };
            }
            const type = action.slice('import:'.length);
            if (!IMPORT_AUDIT_TYPES.includes(type) || entityId !== type) {
                return { success: false, error: 'Invalid log entry action' };
            }
        } else if (entityType === 'print') {
            if (action !== 'print_semester_report') {
                return { success: false, error: 'Invalid log entry action' };
            }
        } else {
            return { success: false, error: 'Invalid log entry type' };
        }

        const details = String(payload?.details || '').slice(0, IMPORT_AUDIT_MAX_DETAILS);
        if (entityType === 'import' && !isRendererImportNotice(details)) {
            return { success: false, error: 'Only blocked, failed, or clear import notices may be renderer-authored' };
        }
        systemLogsRepo.insertLog(db, action, details || null, entityType, entityId || null);
        return { success: true };
    });

    // IPC Handlers - Users
    handleWrite(ipcMain, 'users:getAll', ['admin', 'principal'], (db) => {
        return usersRepo.listUsers(db);
    });

    ipcMain.handle('users:add', async (event, payload) => {
        try {
            requireRole(event, ['admin', 'principal']);
            const db = getDb();
            const password = String(payload?.password || '').trim();
            const usedGenerated = !password;
            const finalPassword = password || generateRandomPassword();
            const role = payload.role || 'principal';
            if (!ALLOWED_ROLES.includes(role)) {
                return { success: false, error: `دور غير صالح: ${role}` };
            }
            if (isPrincipalSession(event) && isPrivilegedUserRole(role)) {
                return { success: false, code: 'FORBIDDEN_ROLE', error: 'مدير المؤسسة لا يمكنه إنشاء حساب مدير التطبيق' };
            }
            const email = normalizeEmail(payload.email) || null;
            const existing = email ? usersRepo.getUserByEmail(db, email) : null;
            if (existing) {
                return { success: false, code: 'EMAIL_EXISTS', error: 'هذا البريد الإلكتروني مستخدم بالفعل' };
            }

            const firebaseProvisioning = await tryProvisionFirebaseUser(db, {
                ...payload,
                email,
                password: finalPassword,
                role,
                disabled: !!payload.disabled,
                mustChangePassword: usedGenerated,
                resetPasswordForExisting: true
            });

            usersRepo.insertUser(db, {
                name: payload.name,
                email,
                role,
                passwordHash: hashPassword(finalPassword),
                disabled: !!payload.disabled,
                mustChangePassword: usedGenerated,
                firebaseUid: firebaseProvisioning.uid || null,
                emailVerified: !!firebaseProvisioning.emailVerified,
                inviteStatus: payload.disabled ? 'disabled' : 'active'
            });

            return {
                success: true,
                usedGeneratedPassword: usedGenerated,
                temporaryPassword: usedGenerated ? finalPassword : null,
                firebaseProvisioning,
                warning: buildFirebaseProvisioningWarning(firebaseProvisioning)
            };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('users:updateRole', async (event, id, role) => {
        try {
            requireRole(event, ['admin', 'principal']);
            if (!ALLOWED_ROLES.includes(role)) {
                return { success: false, error: `دور غير صالح: ${role}` };
            }
            const db = getDb();
            const user = usersRepo.getUserWithFirebaseUid(db, id);
            if (!user) {
                return { success: false, code: 'USER_NOT_FOUND', error: 'المستخدم غير موجود' };
            }
            if (isPrincipalSession(event) && (isPrivilegedUserRole(user.role) || isPrivilegedUserRole(role))) {
                return { success: false, code: 'FORBIDDEN_ROLE', error: 'مدير المؤسسة لا يمكنه تعديل حسابات مدير التطبيق' };
            }

            const firebaseProvisioning = await updateFirebaseUserRole(db, user, role);

            usersRepo.updateUserRole(db, id, role);
            return {
                success: true,
                firebaseProvisioning,
                warning: buildFirebaseProvisioningWarning(firebaseProvisioning)
            };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('users:disable', async (event, id, disabled) => {
        try {
            requireRole(event, ['admin', 'principal']);
            const db = getDb();
            const user = usersRepo.getUserWithFirebaseUid(db, id);
            if (!user) {
                return { success: false, code: 'USER_NOT_FOUND', error: 'المستخدم غير موجود' };
            }
            if (isPrincipalSession(event) && isPrivilegedUserRole(user.role)) {
                return { success: false, code: 'FORBIDDEN_ROLE', error: 'مدير المؤسسة لا يمكنه تعطيل حسابات مدير التطبيق' };
            }

            const firebaseProvisioning = await updateFirebaseUserDisabled(db, user, !!disabled);

            usersRepo.updateUserDisabled(db, id, disabled);
            return {
                success: true,
                firebaseProvisioning,
                warning: buildFirebaseProvisioningWarning(firebaseProvisioning)
            };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('users:resetAdminPassword', async () => {
        try {
            const db = getDb();
            let admin = usersRepo.getAdminUser(db);
            const newPassword = generateRandomPassword();
            if (!admin) {
                usersRepo.createDeveloperUser(db, hashPassword(newPassword));
                console.log('[RESET] Developer account created with password: ' + newPassword);
                return { success: true, temporaryPassword: newPassword, created: true };
            }
            usersRepo.resetAdminPassword(db, hashPassword(newPassword));
            console.log('[RESET] Admin password has been reset to: ' + newPassword);
            return { success: true, temporaryPassword: newPassword };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('system:savePageVisibilityDefaults', async (event) => {
        try {
            requireRole(event, ['admin', 'principal']);
            const db = getDb();
            const path = require('path');
            const fs = require('fs');

            const rows = pageVisibilityRepo.listVisibilityRows(db);
            const hiddenPages = rows
                .filter((r) => Number(r.is_visible) === 0)
                .map((r) => r.page_key)
                .filter(Boolean)
                .sort();

            const defaults = {
                version: 1,
                description:
                    'Default page visibility settings. Hidden pages here will be hidden for all new installations.',
                updatedAt: new Date().toISOString(),
                hiddenPages
            };

            const defaultsPath = path.join(__dirname, '..', '..', 'page-visibility-defaults.json');
            fs.writeFileSync(defaultsPath, JSON.stringify(defaults, null, 2) + '\n', 'utf-8');

            return { success: true, hiddenCount: hiddenPages.length };
        } catch (err) {
            if (err?.code === 'UNAUTHENTICATED' || err?.code === 'FORBIDDEN') {
                return authErrorResponse(err);
            }
            return { success: false, error: err.message };
        }
    });
}

module.exports = {
    registerSystemIpc,
    _private: {
        normalizeEmail,
        getSchoolId,
        provisionFirebaseUser,
        updateFirebaseUserRole,
        updateFirebaseUserDisabled,
        buildFirebaseProvisioningWarning
    }
};
