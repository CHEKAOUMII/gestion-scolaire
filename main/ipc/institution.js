'use strict';

const os = require('os');
const { app } = require('electron');
const { handleRead, handleWrite, handleWriteSoftAuth } = require('./ipc-helpers');
const { hashPassword } = require('../auth/password');
const { collectCurrentFingerprint } = require('../licensing/deviceFingerprint');
const { applySyncDefaults } = require('../sync/defaults');
const { getCurrentFirebaseIdToken } = require('../auth/firebase-auth-service');
const { clearCredentials } = require('../sync/credentials');
const { restartSyncPushBackground, restartSyncPullBackground } = require('../sync/engine');
const { restartSnapshotBackground } = require('../sync/snapshot');

const ERROR_MESSAGES = {
    ALREADY_CONFIGURED: 'تم إعداد المؤسسة مسبقاً على هذا الجهاز',
    BOOTSTRAP_UNAUTHORIZED: 'تعذر إنشاء المؤسسة لأن نسخة التطبيق لا تحمل بيانات bootstrap الصحيحة',
    FORBIDDEN: 'ليس لديك صلاحية لتنفيذ هذا الإجراء',
    INTERNAL_ERROR: 'حدث خطأ داخلي',
    INVALID_ADMIN_NAME: 'اسم المدير مطلوب',
    INVALID_MASSAR: 'رمز ماسار غير صالح - يجب أن يبدأ بحرف متبوعاً بـ 4-8 أرقام',
    INVALID_PASSWORD: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل',
    MASSAR_MISMATCH: 'رمز ماسار لا يطابق المؤسسة التي أصدرت رمز الربط',
    SERVER_UNAVAILABLE: 'تعذر التحقق عبر السيرفر حالياً',
    SETUP_REQUIRED: 'يجب إعداد المؤسسة أولاً',
    UNAUTHENTICATED: 'يرجى تسجيل الدخول أولاً'
};

const MASSAR_REGEX = /^[A-Za-z]\d{4,8}$/;

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
    const normalized = String(value || '').trim().toUpperCase();
    return MASSAR_REGEX.test(normalized) ? normalized : '';
}

function getInstitutionStatusRecord(db) {
    let institutionRow;
    try {
        institutionRow = db
            .prepare('SELECT setup_completed, code_etablissement, institution_name FROM institution_config WHERE id = 1')
            .get();
    } catch {
        try {
            institutionRow = db
                .prepare('SELECT setup_completed, massar_code AS code_etablissement, institution_name FROM institution_config WHERE id = 1')
                .get();
        } catch {
            institutionRow = null;
        }
    }
    const syncRow = db.prepare('SELECT school_id FROM sync_config WHERE id = 1').get();
    const massarCode = normalizeMassarCode(institutionRow?.code_etablissement) || normalizeMassarCode(syncRow?.school_id);
    const institutionName = String(institutionRow?.institution_name || '').trim() || null;
    const setupCompleted =
        !!massarCode &&
        (!!Number(institutionRow?.setup_completed) ||
            !!normalizeMassarCode(institutionRow?.code_etablissement) ||
            !institutionRow);

    return {
        setupCompleted,
        massarCode: massarCode || null,
        institutionName
    };
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

function normalizeSyncConfig(rawConfig, massarCode) {
    const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
    const syncIntervalValue = Number(config.sync_interval_minutes ?? config.syncIntervalMinutes);
    const enabledValue = config.enabled ?? config.sync_enabled ?? config.syncEnabled;
    const schoolIdSource = config.school_id ?? config.schoolId ?? massarCode ?? '';
    const firebaseFunctionsUrlSource =
        config.firebase_functions_url ?? config.firebaseFunctionsUrl ?? config.auth_lambda_url ?? config.authLambdaUrl ?? '';
    const firebaseProjectIdSource = config.firebase_project_id ?? config.firebaseProjectId ?? '';
    const firebaseApiKeySource = config.firebase_api_key ?? config.firebaseApiKey ?? config.apiKey ?? '';
    const firebaseAuthDomainSource = config.firebase_auth_domain ?? config.firebaseAuthDomain ?? config.authDomain ?? '';
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

function upsertSyncConfig(db, syncConfig) {
    const currentConfig = db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
    const firebaseFunctionsUrl =
        syncConfig.firebaseFunctionsUrl ||
        currentConfig.firebase_functions_url ||
        null;
    const mergedConfig = {
        schoolId: syncConfig.schoolId || currentConfig.school_id || null,
        firebaseFunctionsUrl,
        firebaseProjectId: syncConfig.firebaseProjectId || currentConfig.firebase_project_id || null,
        firebaseApiKey: syncConfig.firebaseApiKey || currentConfig.firebase_api_key || null,
        firebaseAuthDomain: syncConfig.firebaseAuthDomain || currentConfig.firebase_auth_domain || null,
        firebaseAppId: syncConfig.firebaseAppId || currentConfig.firebase_app_id || null,
        firebaseStorageBucket: syncConfig.firebaseStorageBucket || currentConfig.firebase_storage_bucket || null,
        firebaseMessagingSenderId:
            syncConfig.firebaseMessagingSenderId || currentConfig.firebase_messaging_sender_id || null,
        syncIntervalMinutes: syncConfig.syncIntervalMinutes || Number(currentConfig.sync_interval_minutes) || 10,
        enabled: 1
    };

    db.prepare(
        `
            INSERT INTO sync_config (
                id,
                school_id,
                firebase_functions_url,
                firebase_project_id,
                firebase_api_key,
                firebase_auth_domain,
                firebase_app_id,
                firebase_storage_bucket,
                firebase_messaging_sender_id,
                sync_interval_minutes,
                enabled,
                updated_at
            )
            VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                school_id = excluded.school_id,
                firebase_functions_url = excluded.firebase_functions_url,
                firebase_project_id = excluded.firebase_project_id,
                firebase_api_key = excluded.firebase_api_key,
                firebase_auth_domain = excluded.firebase_auth_domain,
                firebase_app_id = excluded.firebase_app_id,
                firebase_storage_bucket = excluded.firebase_storage_bucket,
                firebase_messaging_sender_id = excluded.firebase_messaging_sender_id,
                sync_interval_minutes = excluded.sync_interval_minutes,
                enabled = excluded.enabled,
                updated_at = CURRENT_TIMESTAMP
        `
    ).run(
        mergedConfig.schoolId,
        mergedConfig.firebaseFunctionsUrl,
        mergedConfig.firebaseProjectId,
        mergedConfig.firebaseApiKey,
        mergedConfig.firebaseAuthDomain,
        mergedConfig.firebaseAppId,
        mergedConfig.firebaseStorageBucket,
        mergedConfig.firebaseMessagingSenderId,
        mergedConfig.syncIntervalMinutes,
        mergedConfig.enabled
    );

    try {
        if (mergedConfig.firebaseFunctionsUrl) {
            const url = mergedConfig.firebaseFunctionsUrl;
            db.prepare('UPDATE sync_config SET firebase_functions_url = ? WHERE id = 1').run(url);
        }
    } catch {
        // Column not yet added by migration — safe to ignore
    }
}

function upsertFirebaseCachedUser(db, user, password, fallbackRole) {
    const name = String(user?.name || '').trim();
    const email = String(user?.email || '').trim().toLowerCase();
    const firebaseUid = String(user?.uid || '').trim();
    const role = String(user?.role || fallbackRole || 'viewer').trim();
    const passwordHash = hashPassword(password);
    const emailVerified = Number(user?.emailVerified || 0) ? 1 : 0;
    const mustChangePassword = Number(user?.mustChangePassword || 0) ? 1 : 0;

    if (!name || !email) {
        throw new Error('Missing local user cache name/email');
    }

    const existing = db.prepare('SELECT id FROM users WHERE lower(email) = ? LIMIT 1').get(email);
    if (existing) {
        db.prepare(
            `
                UPDATE users
                SET
                    name = ?,
                    role = ?,
                    password_hash = ?,
                    firebase_uid = COALESCE(NULLIF(?, ''), firebase_uid),
                    auth_source = ?,
                    email_verified = ?,
                    invite_status = 'active',
                    must_change_password = ?,
                    disabled = 0,
                    last_login_at = CURRENT_TIMESTAMP,
                    last_auth_mode = 'online'
                WHERE id = ?
            `
        ).run(
            name,
            role,
            passwordHash,
            firebaseUid,
            firebaseUid ? 'firebase' : 'local',
            emailVerified,
            mustChangePassword,
            existing.id
        );
        return existing.id;
    }

    const result = db
        .prepare(
            `
                INSERT INTO users (
                    name,
                    email,
                    role,
                    password_hash,
                    firebase_uid,
                    auth_source,
                    email_verified,
                    invite_status,
                    must_change_password,
                    disabled,
                    last_login_at,
                    last_auth_mode
                )
                VALUES (?, ?, ?, ?, NULLIF(?, ''), ?, ?, 'active', ?, 0, CURRENT_TIMESTAMP, 'online')
            `
        )
        .run(name, email, role, passwordHash, firebaseUid, firebaseUid ? 'firebase' : 'local', emailVerified, mustChangePassword);

    return result.lastInsertRowid;
}

function getFirebaseFunctionsUrl(db) {
    const row = db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
    return applySyncDefaults(row).firebaseFunctionsUrl || null;
}

function mapFailureCode(rawCode) {
    switch (String(rawCode || '').trim()) {
        case 'MASSAR_MISMATCH':
            return 'MASSAR_MISMATCH';
        case 'ALREADY_CONFIGURED':
            return 'ALREADY_CONFIGURED';
        case 'INVALID_MASSAR':
            return 'INVALID_MASSAR';
        case 'INVALID_PASSWORD':
            return 'INVALID_PASSWORD';
        case 'INVALID_ADMIN_NAME':
            return 'INVALID_ADMIN_NAME';
        case 'BOOTSTRAP_UNAUTHORIZED':
            return 'BOOTSTRAP_UNAUTHORIZED';
        default:
            return 'SERVER_UNAVAILABLE';
    }
}

async function postFirebaseFunction(functionsUrl, functionName, body) {
    const normalizedUrl = String(functionsUrl || '').trim().replace(/\/+$/, '');
    if (!normalizedUrl) {
        return fail('SERVER_UNAVAILABLE', 'لم يتم ضبط رابط Firebase Functions لهذا الجهاز');
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
            if (response.status === 404 && functionName === 'bootstrapInstitution') {
                return fail('SERVER_UNAVAILABLE', 'دالة Firebase bootstrapInstitution غير متاحة في الخادم الحالي');
            }
            const rawCode = data.code || data.error || (response.status === 404 ? 'NOT_FOUND' : 'SERVER_ERROR');
            const mappedCode = mapFailureCode(rawCode);
            return fail(mappedCode, data.message || data.error || data.errorMessage || ERROR_MESSAGES[mappedCode]);
        }

        return ok({ data });
    } catch (err) {
        return fail('SERVER_UNAVAILABLE', 'تعذر الاتصال بـ Firebase Functions: ' + err.message);
    }
}

function normalizeBootstrapResponse(data, fallback) {
    const payload = data && typeof data === 'object' ? data : {};
    const institution = payload.institution || payload.school || payload.meta || {};
    const user = payload.user || payload.adminUser || payload.admin || {};
    const firebaseConfig = payload.firebaseConfig || payload.firebase || {};
    const schoolId =
        normalizeMassarCode(payload.schoolId ?? payload.gresaCode ?? payload.massarCode) ||
        normalizeMassarCode(institution.schoolId ?? institution.gresaCode ?? institution.massarCode) ||
        fallback.massarCode;

    return {
        schoolId,
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
            email: String(user.email ?? payload.adminEmail ?? fallback.adminEmail ?? '').trim().toLowerCase(),
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

    handleWriteSoftAuth(ipcMain, 'institution:relink', [], async (db, payload) => {
        const massarCode = normalizeMassarCode(payload?.massarCode);
        if (!massarCode) {
            return fail('INVALID_MASSAR');
        }

        const columns = db.pragma('table_info(institution_config)');
        const colNames = new Set(columns.map((c) => c.name));

        if (!colNames.has('code_etablissement')) {
            db.exec('ALTER TABLE institution_config ADD COLUMN code_etablissement TEXT');
        }

        db.prepare(
            `INSERT INTO institution_config (id, code_etablissement, setup_completed, setup_mode, updated_at)
             VALUES (1, ?, 0, NULL, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET
                 code_etablissement = excluded.code_etablissement,
                 setup_completed = 0,
                 setup_mode = NULL,
                 updated_at = CURRENT_TIMESTAMP`
        ).run(massarCode);

        if (colNames.has('massar_code')) {
            db.prepare('UPDATE institution_config SET massar_code = ? WHERE id = 1').run(massarCode);
        }

        db.prepare(
            'UPDATE sync_config SET school_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
        ).run(massarCode);

        return ok({ message: 'تم تحديث رمز المؤسسة. يمكنك الآن إعداد الربط بـ Firebase.', massarCode });
    });

    handleWriteSoftAuth(ipcMain, 'institution:setup-new', [], async (db, payload) => {
        if (isSetupAlreadyCompleted(db)) {
            return fail('ALREADY_CONFIGURED');
        }

        const massarCode = normalizeMassarCode(payload?.massarCode);
        const institutionName = String(payload?.institutionName || '').trim() || massarCode;
        const adminName = String(payload?.adminName || '').trim();
        const adminEmail = String(payload?.adminEmail || '').trim().toLowerCase();
        const adminPassword = String(payload?.adminPassword || '');

        if (!massarCode) {
            return fail('INVALID_MASSAR');
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
                'نسخة التطبيق لا تحتوي على GESTION_BOOTSTRAP_SECRET. أعد بناء التطبيق بعد ضبط secret في GitHub Actions.'
            );
        }

        const bootstrapResult = await postFirebaseFunction(functionsUrl, 'bootstrapInstitution', {
            massarCode,
            gresaCode: massarCode,
            schoolId: massarCode,
            institutionName,
            adminName,
            adminEmail,
            adminPassword,
            role: 'principal',
            // SECURITY: this secret is readable from the packaged app — rotate it periodically
            bootstrapSecret: process.env.GESTION_BOOTSTRAP_SECRET || '',
            device: deviceContext
        });
        if (!bootstrapResult.success) {
            return bootstrapResult;
        }

        const bootstrap = normalizeBootstrapResponse(bootstrapResult.data, {
            massarCode,
            institutionName,
            adminName,
            adminEmail,
            functionsUrl
        });
        if (!bootstrap.schoolId || bootstrap.schoolId !== massarCode) {
            return fail('MASSAR_MISMATCH');
        }

        const transaction = db.transaction(() => {
            db.prepare(
                `
                    INSERT INTO institution_config (
                        id,
                        code_etablissement,
                        institution_name,
                        setup_completed,
                        setup_mode,
                        setup_device_hash,
                        onboarding_version,
                        onboarding_completed_at,
                        updated_at
                    )
                    VALUES (1, ?, ?, 1, 'firebase-new', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT(id) DO UPDATE SET
                        code_etablissement = excluded.code_etablissement,
                        institution_name = excluded.institution_name,
                        setup_completed = 1,
                        setup_mode = 'firebase-new',
                        setup_device_hash = excluded.setup_device_hash,
                        onboarding_version = 1,
                        onboarding_completed_at = COALESCE(onboarding_completed_at, CURRENT_TIMESTAMP),
                        updated_at = CURRENT_TIMESTAMP
                `
            ).run(bootstrap.schoolId, bootstrap.institutionName, deviceContext.deviceHash);

            upsertSyncConfig(db, bootstrap.syncConfig);
            upsertFirebaseCachedUser(db, { ...bootstrap.user, role: 'principal' }, adminPassword, 'principal');
        });

        try {
            transaction();
            return ok({
                message: 'تم إعداد المؤسسة بنجاح',
                setupCompleted: true,
                institution: buildInstitutionSummary(bootstrap.schoolId, bootstrap.institutionName),
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
    });

    handleWrite(ipcMain, 'institution:submitIdentityChangeRequest', ['principal'], async (db, event, payload) => {
        const status = getInstitutionStatusRecord(db);
        if (!status.setupCompleted) {
            return fail('SETUP_REQUIRED');
        }

        const rawCode = payload?.codeEtablissement ?? payload?.newSchoolId;
        const rawName = payload?.institutionName ?? payload?.newInstitutionName;
        const newCode = rawCode ? normalizeMassarCode(rawCode) : null;
        const newName = rawName ? String(rawName).trim() : null;
        const reason = String(payload?.reason || '').trim();
        const syncSchoolIdentity = !!(payload?.syncSchoolIdentity ?? payload?.syncIdentity);

        if (newCode && !MASSAR_REGEX.test(newCode)) {
            return fail('INVALID_MASSAR');
        }

        const codeChanged = newCode && newCode !== status.massarCode;
        const nameChanged = newName && newName !== status.institutionName;
        if (!codeChanged && !nameChanged) {
            return fail('INVALID_REQUEST', 'لم يتم إدخال أي تعديل جديد');
        }

        if (codeChanged) {
            const pendingCount = db.prepare(
                'SELECT COUNT(*) AS cnt FROM sync_outbox WHERE status IN (?, ?)'
            ).get('pending', 'failed')?.cnt || 0;
            if (pendingCount > 0) {
                return fail('SYNC_PENDING', `يوجد ${pendingCount} عملية مزامنة معلقة. شغّل المزامنة أولاً قبل إرسال طلب تغيير الرمز.`);
            }

            try {
                const unresolvedCount = db.prepare(
                    "SELECT COUNT(*) AS cnt FROM sync_conflicts WHERE resolution = 'unresolved'"
                ).get()?.cnt || 0;
                if (unresolvedCount > 0) {
                    return fail('CONFLICTS_UNRESOLVED', `يوجد ${unresolvedCount} تعارض غير محلول. حلّ التعارضات أولاً.`);
                }
            } catch {
                // sync_conflicts table may not exist yet
            }
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
            newSchoolId: codeChanged ? newCode : undefined,
            institutionName: nameChanged ? newName : undefined,
            reason: reason || undefined,
            syncSchoolIdentity
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

        const codeChanged = !!approvedRequest.codeChanged;
        const newSchoolId = approvedRequest.resultSchoolId || approvedRequest.newSchoolId;
        const newName = approvedRequest.newInstitutionName;

        try {
            const transaction = db.transaction(() => {
                if (newName) {
                    db.prepare(
                        'UPDATE institution_config SET institution_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
                    ).run(newName);
                }

                if (codeChanged && newSchoolId) {
                    db.prepare(
                        'UPDATE institution_config SET code_etablissement = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
                    ).run(newSchoolId);

                    try {
                        db.prepare(
                            'UPDATE institution_config SET massar_code = ? WHERE id = 1'
                        ).run(newSchoolId);
                    } catch {
                        // massar_code column may not exist
                    }

                    db.prepare(
                        `UPDATE sync_config SET
                            school_id = ?,
                            pull_cursor = NULL,
                            last_pull_at = NULL,
                            last_pull_error = NULL,
                            last_push_error = NULL,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = 1`
                    ).run(newSchoolId);
                }

                if (approvedRequest.syncSchoolIdentity) {
                    try {
                        if (newSchoolId && codeChanged) {
                            db.prepare(
                                'UPDATE school_identity SET school_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
                            ).run(newSchoolId);
                        }
                        if (newName) {
                            db.prepare(
                                'UPDATE school_identity SET school_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
                            ).run(newName);
                        }
                    } catch {
                        // school_identity table may not exist
                    }
                }
            });
            transaction();
        } catch (err) {
            return fail('INTERNAL_ERROR', 'فشل تحديث قاعدة البيانات المحلية: ' + err.message);
        }

        if (codeChanged) {
            try { clearCredentials(); } catch {}
            try { restartSyncPushBackground(); } catch {}
            try { restartSyncPullBackground(); } catch {}
            try { restartSnapshotBackground(); } catch {}
        }

        return ok({
            codeChanged,
            requireRelogin: codeChanged,
            institution: getInstitutionStatusRecord(db),
            message: codeChanged
                ? 'تم تطبيق التعديل. يجب إعادة تسجيل الدخول.'
                : 'تم تطبيق التعديل بنجاح.'
        });
    });
}

module.exports = { registerInstitutionIpc };
