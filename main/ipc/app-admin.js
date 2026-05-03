'use strict';

const { handleRead, handleWrite } = require('./ipc-helpers');
const { getCurrentFirebaseIdToken } = require('../auth/firebase-auth-service');
const { applySyncDefaults } = require('../sync/defaults');

function getFirebaseFunctionsUrl(db) {
    const row = db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
    return applySyncDefaults(row).firebaseFunctionsUrl || null;
}

function fail(code, error) {
    return { success: false, code, error: error || code };
}

function ok(payload = {}) {
    return { success: true, ...payload };
}

async function postFirebaseFunction(functionsUrl, functionName, body) {
    const normalizedUrl = String(functionsUrl || '').trim().replace(/\/+$/, '');
    if (!normalizedUrl) {
        return fail('SERVER_UNAVAILABLE', 'لم يتم ضبط رابط Firebase Functions');
    }

    try {
        const response = await fetch(`${normalizedUrl}/${functionName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {})
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
            const rawCode = data.code || data.error || 'SERVER_ERROR';
            return fail(rawCode, data.message || data.error || rawCode);
        }

        return ok({ data });
    } catch (err) {
        return fail('SERVER_UNAVAILABLE', 'تعذر الاتصال بـ Firebase Functions: ' + err.message);
    }
}

function registerAppAdminIpc(ipcMain) {
    handleRead(ipcMain, 'appAdmin:listIdentityChangeRequests', async (db, payload) => {
        const functionsUrl = getFirebaseFunctionsUrl(db);
        if (!functionsUrl) {
            return ok({ requests: [] });
        }

        let idToken;
        try {
            idToken = await getCurrentFirebaseIdToken(true);
        } catch {
            return fail('UNAUTHENTICATED', 'تعذر الحصول على رمز المصادقة');
        }
        if (!idToken) {
            return fail('UNAUTHENTICATED');
        }

        const result = await postFirebaseFunction(functionsUrl, 'listInstitutionIdentityChangeRequests', {
            idToken,
            status: payload?.status || undefined,
            limit: payload?.limit || undefined
        });

        if (!result.success) {
            return result;
        }

        return ok({ requests: result.data?.requests || [] });
    });

    handleWrite(ipcMain, 'appAdmin:approveIdentityChangeRequest', ['admin'], async (db, event, payload) => {
        const functionsUrl = getFirebaseFunctionsUrl(db);
        if (!functionsUrl) {
            return fail('SERVER_UNAVAILABLE');
        }

        const requestId = String(payload?.requestId || '').trim();
        if (!requestId) {
            return fail('INVALID_REQUEST', 'معرّف الطلب مطلوب');
        }

        let idToken;
        try {
            idToken = await getCurrentFirebaseIdToken(true);
        } catch {
            return fail('UNAUTHENTICATED');
        }
        if (!idToken) {
            return fail('UNAUTHENTICATED');
        }

        const result = await postFirebaseFunction(functionsUrl, 'approveInstitutionIdentityChangeRequest', {
            idToken,
            requestId,
            dryRun: !!payload?.dryRun
        });

        if (!result.success) {
            return result;
        }

        return ok({
            requestId,
            status: 'approved',
            migrationId: result.data?.migrationId,
            codeChanged: !!result.data?.codeChanged,
            resultSchoolId: result.data?.resultSchoolId,
            requiresRelogin: !!result.data?.requiresRelogin
        });
    });

    handleWrite(ipcMain, 'appAdmin:rejectIdentityChangeRequest', ['admin'], async (db, event, payload) => {
        const functionsUrl = getFirebaseFunctionsUrl(db);
        if (!functionsUrl) {
            return fail('SERVER_UNAVAILABLE');
        }

        const requestId = String(payload?.requestId || '').trim();
        const rejectionReason = String(payload?.rejectionReason || '').trim();
        if (!requestId) {
            return fail('INVALID_REQUEST', 'معرّف الطلب مطلوب');
        }

        let idToken;
        try {
            idToken = await getCurrentFirebaseIdToken(true);
        } catch {
            return fail('UNAUTHENTICATED');
        }
        if (!idToken) {
            return fail('UNAUTHENTICATED');
        }

        const result = await postFirebaseFunction(functionsUrl, 'rejectInstitutionIdentityChangeRequest', {
            idToken,
            requestId,
            rejectionReason: rejectionReason || undefined
        });

        if (!result.success) {
            return result;
        }

        return ok({ requestId, status: 'rejected' });
    });
}

module.exports = { registerAppAdminIpc };
