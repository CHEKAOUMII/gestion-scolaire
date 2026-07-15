'use strict';

const os = require('os');
const { app } = require('electron');
const { handleRead, handleWrite, handleWriteSoftAuth } = require('./ipc-helpers');
const { hashPassword } = require('../auth/password');
const { collectCurrentFingerprint } = require('../licensing/deviceFingerprint');
const { applySyncDefaults } = require('../sync/defaults');
const { getCurrentFirebaseIdToken } = require('../auth/firebase-auth-service');

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

// Pre-refactor Massar/GRESA codes always matched this digits-then-1-2-letters shape (e.g.
// "12345A"). It is used ONLY to tell a genuine legacy code — safe to display — apart from a
// new server-generated opaque School_Id (20–30 random [A-Z0-9] chars, which never matches
// this shape) when deriving a display Massar_Code for rows that have no explicit massar_code.
// setup_mode cannot be used for this: the old setup flow also stamped 'firebase-new'.
const LEGACY_MASSAR_CODE_SHAPE = /^\d+[A-Za-z]{1,2}$/;

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
    return String(value || '').trim().toUpperCase();
}

function isValidMassarCode(value) {
    return INSTITUTION_CODE_REGEX.test(normalizeMassarCode(value));
}

function looksLikeLegacyMassarCode(value) {
    return LEGACY_MASSAR_CODE_SHAPE.test(normalizeMassarCode(value));
}

function getInstitutionStatusRecord(db) {
    const institutionRow = db
        .prepare(
            'SELECT setup_completed, code_etablissement, massar_code, institution_name FROM institution_config WHERE id = 1'
        )
        .get();
    const syncRow = db.prepare('SELECT school_id FROM sync_config WHERE id = 1').get();

    const explicitMassar = normalizeMassarCode(institutionRow?.massar_code);
    const legacyCode = normalizeMassarCode(institutionRow?.code_etablissement);
    const legacySchoolId = normalizeMassarCode(syncRow?.school_id);

    // Displayed Massar_Code: the explicit value always wins. Only when it is empty do we fall
    // back to code_etablissement / school_id, and then ONLY if that value is a genuine legacy
    // Massar code. Under the new scheme those columns hold the opaque server-generated
    // School_Id (the tenant key), which must never be shown to the user as a Massar_Code —
    // so an institution set up without a Massar_Code correctly reports none (Req 3.3, 3.5).
    const massarCode =
        explicitMassar ||
        (looksLikeLegacyMassarCode(legacyCode) ? legacyCode : '') ||
        (looksLikeLegacyMassarCode(legacySchoolId) ? legacySchoolId : '') ||
        null;

    const institutionName = String(institutionRow?.institution_name || '').trim() || null;

    // setupCompleted reflects provisioning state, NOT whether a displayable Massar_Code exists
    // (a new institution may legitimately have none). Detect it from the presence of any stored
    // identifier — including the opaque School_Id — mirroring the original completion logic.
    const anyIdentifier = explicitMassar || legacyCode || legacySchoolId;
    const setupCompleted =
        !!anyIdentifier &&
        (!!Number(institutionRow?.setup_completed) || !!legacyCode || !institutionRow);

    return {
        setupCompleted,
        massarCode,
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
        case 'BOOTSTRAP_TIMEOUT':
            return 'BOOTSTRAP_TIMEOUT';
        case 'MASSAR_NOT_FOUND':
            return 'MASSAR_NOT_FOUND';
        case 'MASSAR_AMBIGUOUS':
            return 'MASSAR_AMBIGUOUS';
        default:
            return 'SERVER_UNAVAILABLE';
    }
}

async function postFirebaseFunction(functionsUrl, functionName, body) {
    const normalizedUrl = String(functionsUrl || '').trim().replace(/\/+$/, '');
    if (!normalizedUrl) {
        return fail('SERVER_UNAVAILABLE', 'لم يتم ضبط رابط Firebase Functions لهذا الجهاز');
    }

    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), 30_000);

    try {
        const response = await fetch(`${normalizedUrl}/${functionName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {}),
            signal: controller.signal
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
        if (err.name === 'AbortError') {
            return fail('BOOTSTRAP_TIMEOUT', 'انتهت مهلة الاتصال بالخادم');
        }
        return fail('SERVER_UNAVAILABLE', 'تعذر الاتصال بـ Firebase Functions: ' + err.message);
    } finally {
        clearTimeout(timeoutTimer);
    }
}

function normalizeBootstrapResponse(data, fallback) {
    const payload = data && typeof data === 'object' ? data : {};
    const institution = payload.institution || payload.school || payload.meta || {};
    const user = payload.user || payload.adminUser || payload.admin || {};
    const firebaseConfig = payload.firebaseConfig || payload.firebase || {};
    // schoolId is the server-generated opaque tenant key — it must NEVER be derived from the
    // entered massarCode; only from what the server itself returned as schoolId/gresaCode.
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
                'نسخة التطبيق لا تحتوي على GESTION_BOOTSTRAP_SECRET. أعد بناء التطبيق بعد ضبط secret في GitHub Actions.'
            );
        }

        const lookup = await postFirebaseFunction(functionsUrl, 'lookupInstitutionBySchoolMassarCode', {
            massarCode,
            // MUST be sent explicitly — postFirebaseFunction only forwards the body given to
            // it, it does not attach this secret automatically.
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

        const transaction = db.transaction(() => {
            db.prepare(
                `INSERT INTO institution_config (id, code_etablissement, massar_code, setup_completed, setup_mode, updated_at)
                 VALUES (1, ?, ?, 0, NULL, CURRENT_TIMESTAMP)
                 ON CONFLICT(id) DO UPDATE SET
                     code_etablissement = excluded.code_etablissement,
                     massar_code = excluded.massar_code,
                     setup_completed = 0,
                     setup_mode = NULL,
                     updated_at = CURRENT_TIMESTAMP`
            ).run(resolvedSchoolId, massarCode);

            db.prepare(
                'UPDATE sync_config SET school_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
            ).run(resolvedSchoolId);
        });

        try {
            transaction();
        } catch (err) {
            return fail('INTERNAL_ERROR', 'حدث خطأ أثناء ربط المؤسسة: ' + err.message);
        }

        return ok({ message: 'تم تحديث رمز المؤسسة. يمكنك الآن إعداد الربط بـ Firebase.', massarCode });
    }, { allowNoSession: true });

    handleWriteSoftAuth(ipcMain, 'institution:setup-new', [], async (db, payload) => {
        if (isSetupAlreadyCompleted(db)) {
            return fail('ALREADY_CONFIGURED');
        }

        const massarCode = normalizeMassarCode(payload?.massarCode);
        const institutionName = String(payload?.institutionName || '').trim() || massarCode;
        const adminName = String(payload?.adminName || '').trim();
        const adminEmail = String(payload?.adminEmail || '').trim().toLowerCase();
        const adminPassword = String(payload?.adminPassword || '');

        if (massarCode && (massarCode.length > MASSAR_CODE_MAX_LENGTH || !isValidMassarCode(massarCode))) {
            return fail('INVALID_MASSAR');
        }
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
                'نسخة التطبيق لا تحتوي على GESTION_BOOTSTRAP_SECRET. أعد بناء التطبيق بعد ضبط secret في GitHub Actions.'
            );
        }

        const bootstrapResult = await postFirebaseFunction(functionsUrl, 'bootstrapInstitution', {
            massarCode,
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
        if (!bootstrap.schoolId || bootstrap.schoolId.length < 1 || bootstrap.schoolId.length > 64) {
            return fail('INVALID_BOOTSTRAP_RESPONSE');
        }
        const massarCodeDiffersFromSchoolId = !!massarCode && massarCode !== bootstrap.schoolId;

        const transaction = db.transaction(() => {
            db.prepare(
                `
                    INSERT INTO institution_config (
                        id,
                        code_etablissement,
                        massar_code,
                        institution_name,
                        setup_completed,
                        setup_mode,
                        setup_device_hash,
                        onboarding_version,
                        onboarding_completed_at,
                        updated_at
                    )
                    VALUES (1, ?, ?, ?, 1, 'firebase-new', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT(id) DO UPDATE SET
                        code_etablissement = excluded.code_etablissement,
                        massar_code = excluded.massar_code,
                        institution_name = excluded.institution_name,
                        setup_completed = 1,
                        setup_mode = 'firebase-new',
                        setup_device_hash = excluded.setup_device_hash,
                        onboarding_version = 1,
                        onboarding_completed_at = COALESCE(onboarding_completed_at, CURRENT_TIMESTAMP),
                        updated_at = CURRENT_TIMESTAMP
                `
            ).run(bootstrap.schoolId, massarCode || null, bootstrap.institutionName, deviceContext.deviceHash);

            upsertSyncConfig(db, bootstrap.syncConfig);
            upsertFirebaseCachedUser(db, { ...bootstrap.user, role: 'principal' }, adminPassword, 'principal');
        });

        try {
            transaction();
            return ok({
                message: 'تم إعداد المؤسسة بنجاح',
                setupCompleted: true,
                schoolId: bootstrap.schoolId,
                massarCode: massarCode || null,
                massarCodeDiffersFromSchoolId,
                institution: buildInstitutionSummary(massarCode || bootstrap.massarCode, bootstrap.institutionName),
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
    }, { allowNoSession: true });

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

        // The Cloud Function has already confirmed the remote write; it is authoritative from
        // this point on. Retry the local cache write once before surfacing a
        // remote-succeeded-but-local-stale warning — retrying the same UPDATE is safe/idempotent.
        const persistLocally = () =>
            db.prepare('UPDATE institution_config SET massar_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1').run(massarCode);
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

        // School_Id/Massar_Code are immutable via this approval mechanism — Massar edits go
        // through the direct institution:updateMassarCode path (Req 8/9) instead.
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

        // School_Id/Massar_Code changes are no longer applied through this mechanism — only
        // the institution name. If a pre-existing pending/approved request predates this
        // feature and still carries a code-change component, refuse to apply it.
        if (approvedRequest.codeChanged) {
            return fail('SCHOOL_ID_IMMUTABLE');
        }

        const newName = approvedRequest.newInstitutionName;

        try {
            const transaction = db.transaction(() => {
                if (newName) {
                    db.prepare(
                        'UPDATE institution_config SET institution_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
                    ).run(newName);

                    try {
                        db.prepare(
                            'UPDATE school_identity SET school_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
                        ).run(newName);
                    } catch {
                        // school_identity table may not exist
                    }
                }
            });
            transaction();
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
