'use strict';

const os = require('os');
const { app } = require('electron');
const { handleRead, handleWrite, handleWriteSoftAuth } = require('./ipc-helpers');
const { hashPassword } = require('../auth/password');
const { collectCurrentFingerprint } = require('../licensing/deviceFingerprint');
const { applySyncDefaults } = require('../sync/defaults');
const { getCurrentFirebaseIdToken } = require('../auth/firebase-auth-service');
const { postFirebaseFunction } = require('./firebase-functions-client');
const institutionRepo = require('../repos/institution');

const ERROR_MESSAGES = {
    ALREADY_CONFIGURED: 'تم إعداد المؤسسة مسبقاً على هذا الجهاز',
    BOOTSTRAP_TIMEOUT: 'انتهت مهلة الاتصال بالخادم',
    BOOTSTRAP_UNAUTHORIZED: 'تعذر إنشاء المؤسسة لأن نسخة التطبيق لا تحمل بيانات bootstrap الصحيحة',
    FORBIDDEN: 'ليس لديك صلاحية لتنفيذ هذا الإجراء',
    INTERNAL_ERROR: 'حدث خطأ داخلي',
    INVALID_ADMIN_NAME: 'اسم المدير مطلوب',
    INVALID_BOOTSTRAP_RESPONSE: 'استجابة الخادم لا تحتوي على معرّف مؤسسة صالح',
    INVALID_MASSAR: 'رمز المؤسسة غير صالح - يجب أن يتكون من حروف إنجليزية كبيرة وأرقام فقط، بحد أقصى 20 حرفاً',
    INVALID_PASSWORD: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل',
    MASSAR_AMBIGUOUS: 'يوجد أكثر من مؤسسة بنفس رمز ماسار',
    MASSAR_NOT_FOUND: 'لم يتم العثور على مؤسسة بهذا الرمز',
    SCHOOL_ID_IMMUTABLE: 'لا يمكن تعديل رمز المؤسسة التقني؛ هو ثابت ولا يتغير',
    SERVER_UNAVAILABLE: 'تعذر التحقق عبر السيرفر حالياً',
    SETUP_REQUIRED: 'يجب إعداد المؤسسة أولاً',
    UNAUTHENTICATED: 'يرجى تسجيل الدخول أولاً'
};

const INSTITUTION_CODE_REGEX = /^[A-Z0-9]+$/;
const MASSAR_CODE_MAX_LENGTH = 20;

function fail(code, error) {
    return {
        success: false,
        code,
        error: error || ERROR_MESSAGES[code] || ERROR_MESSAGES.INTERNAL_ERROR
    };
}

function ok(payload = {}) {
    return {
        success: true,
        ...payload
    };
}

function normalizeMassarCode(value) {
    return institutionRepo.normalizeMassarCode(value);
}

function isValidMassarCode(value) {
    return INSTITUTION_CODE_REGEX.test(normalizeMassarCode(value));
}

function getInstitutionStatusRecord(db) {
    return institutionRepo.getStatusRecord(db);
}

function isSetupAlreadyCompleted(db) {
    return getInstitutionStatusRecord(db).setupCompleted;
}

function getCurrentDeviceContext() {
    const fingerprint = collectCurrentFingerprint();

    return {
        deviceHash: fingerprint.deviceHash,
        deviceName: fingerprint.deviceName || os.hostname(),
        platform: fingerprint.platform || process.platform,
        appVersion: app.getVersion()
    };
}

function buildInstitutionSummary(massarCode, institutionName) {
    return {
        massarCode: normalizeMassarCode(massarCode) || null,
        institutionName: String(institutionName || '').trim() || null
    };
}

function buildCurrentDeviceSummary(db, deviceContext = getCurrentDeviceContext()) {
    const institution = getInstitutionStatusRecord(db);

    return {
        deviceHash: deviceContext.deviceHash,
        deviceName: deviceContext.deviceName,
        platform: deviceContext.platform,
        appVersion: deviceContext.appVersion,
        massarCode: institution.massarCode,
        institutionName: institution.institutionName,
        setupCompleted: institution.setupCompleted
    };
}

function getFirebaseFunctionsUrl(db) {
    const row = institutionRepo.getSyncConfigRow(db);
    return applySyncDefaults(row).firebaseFunctionsUrl || null;
}

function normalizeSyncConfig(rawConfig, massarCode) {
    const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
    const syncIntervalValue = Number(config.sync_interval_minutes ?? config.syncIntervalMinutes);
    const enabledValue = config.enabled ?? config.sync_enabled ?? config.syncEnabled;
    const schoolIdSource = config.school_id ?? config.schoolId ?? massarCode ?? '';
    const firebaseFunctionsUrlSource =
        config.firebase_functions_url ??
        config.firebaseFunctionsUrl ??
        config.auth_lambda_url ??
        config.authLambdaUrl ??
        '';
    const firebaseProjectIdSource = config.firebase_project_id ?? config.firebaseProjectId ?? '';
    const firebaseApiKeySource = config.firebase_api_key ?? config.firebaseApiKey ?? config.apiKey ?? '';
    const firebaseAuthDomainSource =
        config.firebase_auth_domain ?? config.firebaseAuthDomain ?? config.authDomain ?? '';
    const firebaseAppIdSource = config.firebase_app_id ?? config.firebaseAppId ?? config.appId ?? '';
    const firebaseStorageBucketSource =
        config.firebase_storage_bucket ?? config.firebaseStorageBucket ?? config.storageBucket ?? '';
    const firebaseMessagingSenderIdSource =
        config.firebase_messaging_sender_id ?? config.firebaseMessagingSenderId ?? config.messagingSenderId ?? '';

    return {
        schoolId: String(schoolIdSource).trim() || null,
        firebaseFunctionsUrl: String(firebaseFunctionsUrlSource).trim().replace(/\/+$/, '') || null,
        firebaseProjectId: String(firebaseProjectIdSource).trim() || null,
        firebaseApiKey: String(firebaseApiKeySource).trim() || null,
        firebaseAuthDomain: String(firebaseAuthDomainSource).trim() || null,
        firebaseAppId: String(firebaseAppIdSource).trim() || null,
        firebaseStorageBucket: String(firebaseStorageBucketSource).trim() || null,
        firebaseMessagingSenderId: String(firebaseMessagingSenderIdSource).trim() || null,
        syncIntervalMinutes: Number.isFinite(syncIntervalValue) && syncIntervalValue > 0 ? syncIntervalValue : null,
        enabled: enabledValue === undefined || enabledValue === null ? 1 : Number(enabledValue) ? 1 : 0
    };
}

function normalizeBootstrapResponse(data, fallback) {
    const payload = data && typeof data === 'object' ? data : {};
    const institution = payload.institution || payload.school || payload.meta || {};
    const user = payload.user || payload.adminUser || payload.admin || {};
    const firebaseConfig = payload.firebaseConfig || payload.firebase || {};
    const schoolId =
        normalizeMassarCode(payload.schoolId ?? payload.gresaCode) ||
        normalizeMassarCode(institution.schoolId ?? institution.gresaCode) ||
        '';
    const massarCode = normalizeMassarCode(payload.massarCode ?? institution.massarCode ?? fallback.massarCode);

    return {
        schoolId,
        massarCode,
        institutionName:
            String(
                payload.institutionName ??
                    institution.institutionName ??
                    institution.name ??
                    fallback.institutionName ??
                    ''
            ).trim() || null,
        syncConfig: normalizeSyncConfig(
            {
                ...(payload.syncConfig || {}),
                ...(firebaseConfig || {}),
                schoolId,
                firebaseFunctionsUrl: payload.firebaseFunctionsUrl || fallback.functionsUrl,
                firebaseProjectId: payload.firebaseProjectId ?? firebaseConfig.projectId,
                firebaseApiKey: payload.firebaseApiKey ?? firebaseConfig.apiKey,
                firebaseAuthDomain: payload.firebaseAuthDomain ?? firebaseConfig.authDomain,
                firebaseAppId: payload.firebaseAppId ?? firebaseConfig.appId,
                firebaseStorageBucket: payload.firebaseStorageBucket ?? firebaseConfig.storageBucket,
                firebaseMessagingSenderId: payload.firebaseMessagingSenderId ?? firebaseConfig.messagingSenderId
            },
            schoolId
        ),
        user: {
            uid: String(payload.uid ?? payload.firebaseUid ?? user.uid ?? user.firebaseUid ?? '').trim() || null,
            name: String(user.name ?? user.displayName ?? payload.adminName ?? fallback.adminName ?? '').trim(),
            email: String(user.email ?? payload.adminEmail ?? fallback.adminEmail ?? '')
                .trim()
                .toLowerCase(),
            role: 'principal',
            emailVerified: Number(user.emailVerified ?? payload.emailVerified) ? 1 : 0,
            mustChangePassword: Number(user.mustChangePassword ?? payload.mustChangePassword) ? 1 : 0
        },
        customToken: payload.customToken || null,
        idToken: payload.idToken || null
    };
}

function registerInstitutionIpc(ipcMain) {
    handleRead(ipcMain, 'institution:get-status', async (db) => {
        return ok(getInstitutionStatusRecord(db));
    });

    handleWriteSoftAuth(
        ipcMain,
        'institution:relink',
        [],
        async (db, payload) => {
            const massarCode = normalizeMassarCode(payload?.massarCode);
            if (!massarCode) {
                return fail('INVALID_MASSAR', 'رمز المؤسسة مطلوب');
            }
            if (massarCode.length > MASSAR_CODE_MAX_LENGTH || !isValidMassarCode(massarCode)) {
                return fail('INVALID_MASSAR');
            }

            const functionsUrl = getFirebaseFunctionsUrl(db);
            if (!functionsUrl) {
                return fail('SERVER_UNAVAILABLE');
            }
            if (!String(process.env.GESTION_BOOTSTRAP_SECRET || '').trim()) {
                return fail(
                    'BOOTSTRAP_UNAUTHORIZED',
                    'إعداد المؤسسة الجديدة وربط المؤسسة متوقفان مؤقتًا حتى يتم تفعيل رمز التفعيل.'
                );
            }

            const lookup = await postFirebaseFunction(functionsUrl, 'lookupInstitutionBySchoolMassarCode', {
                massarCode,
                bootstrapSecret: process.env.GESTION_BOOTSTRAP_SECRET || ''
            });
            if (!lookup.success) {
                if (lookup.code === 'MASSAR_NOT_FOUND') return fail('MASSAR_NOT_FOUND');
                if (lookup.code === 'MASSAR_AMBIGUOUS') return fail('MASSAR_AMBIGUOUS');
                return lookup;
            }

            const resolvedSchoolId = String(lookup.data?.schoolId || '').trim();
            if (!resolvedSchoolId) {
                return fail('MASSAR_NOT_FOUND');
            }

            try {
                institutionRepo.applyRelink(db, resolvedSchoolId, massarCode);
            } catch (err) {
                return fail('INTERNAL_ERROR', 'حدث خطأ أثناء ربط المؤسسة: ' + err.message);
            }

            return ok({ message: 'تم تحديث رمز المؤسسة. يمكنك الآن إعداد الربط بـ Firebase.', massarCode });
        },
        { allowNoSession: true }
    );

    handleWriteSoftAuth(
        ipcMain,
        'institution:setup-new',
        [],
        async (db, payload) => {
            if (isSetupAlreadyCompleted(db)) {
                return fail('ALREADY_CONFIGURED');
            }

            const institutionName = String(payload?.institutionName || '').trim();
            const adminName = String(payload?.adminName || '').trim();
            const adminEmail = String(payload?.adminEmail || '')
                .trim()
                .toLowerCase();
            const adminPassword = String(payload?.adminPassword || '');
            const academy = String(payload?.academy || '').trim();
            const directorate = String(payload?.directorate || '').trim();

            if (!institutionName) {
                return fail('INVALID_INSTITUTION_NAME', 'اسم المؤسسة مطلوب');
            }
            if (!adminName) {
                return fail('INVALID_ADMIN_NAME');
            }
            if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
                return fail('INVALID_EMAIL', 'البريد الإلكتروني غير صالح');
            }
            if (adminPassword.length < 6) {
                return fail('INVALID_PASSWORD');
            }

            const deviceContext = getCurrentDeviceContext();
            const functionsUrl = getFirebaseFunctionsUrl(db);
            if (!functionsUrl) {
                return fail(
                    'SERVER_UNAVAILABLE',
                    'إعداد مؤسسة جديدة يتطلب ضبط FIREBASE_FUNCTIONS_URL أو firebase_functions_url أولاً'
                );
            }
            if (!String(process.env.GESTION_BOOTSTRAP_SECRET || '').trim()) {
                return fail(
                    'BOOTSTRAP_UNAUTHORIZED',
                    'إعداد المؤسسة الجديدة وربط المؤسسة متوقفان مؤقتًا حتى يتم تفعيل رمز التفعيل.'
                );
            }

            const bootstrapResult = await postFirebaseFunction(functionsUrl, 'bootstrapInstitution', {
                institutionName,
                adminName,
                adminEmail,
                adminPassword,
                role: 'principal',
                bootstrapSecret: process.env.GESTION_BOOTSTRAP_SECRET || '',
                device: deviceContext
            });
            if (!bootstrapResult.success) {
                return bootstrapResult;
            }

            const bootstrap = normalizeBootstrapResponse(bootstrapResult.data, {
                institutionName,
                adminName,
                adminEmail,
                functionsUrl
            });
            if (!bootstrap.schoolId || bootstrap.schoolId.length < 1 || bootstrap.schoolId.length > 64) {
                return fail('INVALID_BOOTSTRAP_RESPONSE');
            }

            try {
                institutionRepo.applyBootstrap(db, {
                    bootstrap,
                    passwordHash: hashPassword(adminPassword),
                    deviceHash: deviceContext.deviceHash,
                    academy,
                    directorate
                });
                return ok({
                    message: 'تم إعداد المؤسسة بنجاح',
                    setupCompleted: true,
                    schoolId: bootstrap.schoolId,
                    massarCode: null,
                    institution: buildInstitutionSummary(bootstrap.massarCode, bootstrap.institutionName),
                    currentDevice: buildCurrentDeviceSummary(db, deviceContext),
                    autoLoginEmail: bootstrap.user.email || adminEmail,
                    loginPayload: {
                        email: bootstrap.user.email || adminEmail,
                        password: adminPassword,
                        source: bootstrap.user.uid ? 'firebase' : 'local-cache'
                    },
                    firebaseUid: bootstrap.user.uid,
                    customToken: bootstrap.customToken,
                    idToken: bootstrap.idToken
                });
            } catch (err) {
                console.error('[institution] setupNewInstitution error:', err);
                return fail('INTERNAL_ERROR', 'حدث خطأ أثناء إعداد المؤسسة: ' + err.message);
            }
        },
        { allowNoSession: true }
    );

    handleWrite(ipcMain, 'institution:updateMassarCode', ['principal'], async (db, event, payload) => {
        const status = getInstitutionStatusRecord(db);
        if (!status.setupCompleted) {
            return fail('SETUP_REQUIRED');
        }

        const massarCode = normalizeMassarCode(payload?.massarCode);
        if (!massarCode) {
            return fail('INVALID_MASSAR', 'رمز المؤسسة مطلوب');
        }
        if (massarCode.length > MASSAR_CODE_MAX_LENGTH || !isValidMassarCode(massarCode)) {
            return fail('INVALID_MASSAR');
        }

        const functionsUrl = getFirebaseFunctionsUrl(db);
        if (!functionsUrl) {
            return fail('SERVER_UNAVAILABLE');
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

        const result = await postFirebaseFunction(functionsUrl, 'updateInstitutionMassarCode', { idToken, massarCode });
        if (!result.success) {
            return fail('INTERNAL_ERROR', 'فشل تحديث رمز المؤسسة');
        }

        const persistLocally = () => institutionRepo.setMassarCode(db, massarCode);
        try {
            persistLocally();
        } catch {
            try {
                persistLocally();
            } catch (retryErr) {
                return ok({
                    massarCode,
                    localCacheStale: true,
                    message: 'تم تحديث رمز المؤسسة على الخادم، لكن تعذر تحديث النسخة المحلية. أعد المحاولة.',
                    warning: retryErr.message
                });
            }
        }

        return ok({ massarCode, message: 'تم تحديث رمز المؤسسة بنجاح' });
    });

    handleWrite(ipcMain, 'institution:submitIdentityChangeRequest', ['principal'], async (db, event, payload) => {
        const status = getInstitutionStatusRecord(db);
        if (!status.setupCompleted) {
            return fail('SETUP_REQUIRED');
        }

        if (payload?.codeEtablissement || payload?.newSchoolId) {
            return fail('SCHOOL_ID_IMMUTABLE');
        }

        const rawName = payload?.institutionName ?? payload?.newInstitutionName;
        const newName = rawName ? String(rawName).trim() : null;
        const reason = String(payload?.reason || '').trim();

        const nameChanged = newName && newName !== status.institutionName;
        if (!nameChanged) {
            return fail('INVALID_REQUEST', 'لم يتم إدخال أي تعديل جديد');
        }

        const functionsUrl = getFirebaseFunctionsUrl(db);
        if (!functionsUrl) {
            return fail('SERVER_UNAVAILABLE', 'لم يتم ضبط رابط Firebase Functions');
        }

        let idToken;
        try {
            idToken = await getCurrentFirebaseIdToken(true);
        } catch {
            return fail('UNAUTHENTICATED', 'تعذر الحصول على رمز المصادقة. أعد تسجيل الدخول.');
        }
        if (!idToken) {
            return fail('UNAUTHENTICATED', 'لا يوجد رمز مصادقة صالح');
        }

        const result = await postFirebaseFunction(functionsUrl, 'submitInstitutionIdentityChangeRequest', {
            idToken,
            institutionName: newName,
            reason: reason || undefined
        });

        if (!result.success) {
            const serverCode = result.data?.code || result.code || '';
            if (serverCode === 'PENDING_REQUEST_EXISTS') {
                return fail('PENDING_REQUEST_EXISTS', 'يوجد طلب تعديل سابق لم تتم مراجعته بعد');
            }
            return result;
        }

        return ok({
            requestId: result.data?.requestId,
            status: 'pending',
            message: 'تم إرسال طلب التعديل. ينتظر موافقة مدير التطبيق.'
        });
    });

    handleRead(ipcMain, 'institution:getIdentityChangeRequests', async (db) => {
        const functionsUrl = getFirebaseFunctionsUrl(db);
        if (!functionsUrl) {
            return ok({ requests: [] });
        }

        let idToken;
        try {
            idToken = await getCurrentFirebaseIdToken(true);
        } catch {
            return ok({ requests: [] });
        }
        if (!idToken) {
            return ok({ requests: [] });
        }

        const result = await postFirebaseFunction(functionsUrl, 'getInstitutionIdentityChangeRequestsForSchool', {
            idToken
        });

        if (!result.success) {
            return ok({ requests: [] });
        }

        return ok({ requests: result.data?.requests || [] });
    });

    handleWrite(ipcMain, 'institution:applyApprovedIdentityChange', ['principal'], async (db, event, payload) => {
        const status = getInstitutionStatusRecord(db);
        if (!status.setupCompleted) {
            return fail('SETUP_REQUIRED');
        }

        const requestId = String(payload?.requestId || '').trim();
        if (!requestId) {
            return fail('INVALID_REQUEST', 'معرّف الطلب مطلوب');
        }

        const functionsUrl = getFirebaseFunctionsUrl(db);
        if (!functionsUrl) {
            return fail('SERVER_UNAVAILABLE');
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

        const verifyResult = await postFirebaseFunction(functionsUrl, 'getInstitutionIdentityChangeRequestsForSchool', {
            idToken
        });
        if (!verifyResult.success) {
            return fail('SERVER_UNAVAILABLE', 'تعذر التحقق من حالة الطلب');
        }

        const requests = verifyResult.data?.requests || [];
        const approvedRequest = requests.find((r) => r.requestId === requestId && r.status === 'approved');
        if (!approvedRequest) {
            return fail('REQUEST_NOT_FOUND', 'لم يتم العثور على طلب معتمد بهذا المعرّف');
        }

        if (approvedRequest.codeChanged) {
            return fail('SCHOOL_ID_IMMUTABLE');
        }

        const newName = approvedRequest.newInstitutionName;

        try {
            institutionRepo.applyInstitutionName(db, newName);
        } catch (err) {
            return fail('INTERNAL_ERROR', 'فشل تحديث قاعدة البيانات المحلية: ' + err.message);
        }

        return ok({
            codeChanged: false,
            requireRelogin: false,
            institution: getInstitutionStatusRecord(db),
            message: 'تم تطبيق التعديل بنجاح.'
        });
    });
}

module.exports = { registerInstitutionIpc };
