'use strict';

const os = require('os');
const { app } = require('electron');
const { handleRead, handleWrite, handleWriteSoftAuth } = require('./ipc-helpers');
const { hashPassword } = require('../auth/password');
const { collectCurrentFingerprint } = require('../licensing/deviceFingerprint');
const {
    validateMassarCode,
    generateOtp: generateInstitutionOtp,
    getLatestOtpStatus,
    cancelActiveOtp
} = require('../linking/otp');
const {
    publishOtpToServer,
    verifyOtpViaServer,
    getPublishedOtpStatus,
    cancelPublishedOtp
} = require('../linking/server');
const { applySyncDefaults } = require('../sync/defaults');

const OTP_REGEX = /^\d{6}$/;
const LINKING_READ_ROLES = [...require('../auth/permissions').ALLOWED_ROLES];

const ERROR_MESSAGES = {
    ALREADY_CONFIGURED: 'تم إعداد المؤسسة مسبقاً على هذا الجهاز',
    CURRENT_DEVICE_PROTECTED: 'لا يمكن إلغاء الجهاز الحالي',
    DEVICE_ALREADY_REVOKED: 'تم إلغاء هذا الجهاز مسبقاً',
    DEVICE_NOT_FOUND: 'الجهاز المطلوب غير موجود',
    FORBIDDEN: 'ليس لديك صلاحية لتنفيذ هذا الإجراء',
    INTERNAL_ERROR: 'حدث خطأ داخلي',
    INVALID_ADMIN_NAME: 'اسم المدير مطلوب',
    INVALID_MASSAR: 'رمز ماسار غير صالح - يجب أن يبدأ بحرف متبوعاً بـ 4-8 أرقام',
    INVALID_OTP: 'رمز الربط غير صحيح',
    INVALID_PASSWORD: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل',
    MASSAR_MISMATCH: 'رمز ماسار لا يطابق المؤسسة التي أصدرت رمز الربط',
    NO_ACTIVE_OTP: 'لا يوجد رمز ربط نشط لهذه المؤسسة',
    OTP_CANCELLED: 'تم إلغاء رمز الربط',
    OTP_EXPIRED: 'انتهت صلاحية رمز الربط',
    OTP_USED: 'تم استخدام رمز الربط مسبقاً',
    RATE_LIMITED: 'تم تجاوز عدد محاولات التحقق - اطلب رمزاً جديداً',
    SERVER_UNAVAILABLE: 'تعذر التحقق عبر السيرفر حالياً',
    SETUP_REQUIRED: 'يجب إعداد المؤسسة أولاً',
    UNAUTHENTICATED: 'يرجى تسجيل الدخول أولاً'
};

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
    const validation = validateMassarCode(value);
    return validation.valid ? validation.normalized : '';
}

function getInstitutionStatusRecord(db) {
    const institutionRow = db
        .prepare('SELECT setup_completed, massar_code, institution_name FROM institution_config WHERE id = 1')
        .get();
    const syncRow = db.prepare('SELECT school_id FROM sync_config WHERE id = 1').get();
    const massarCode = normalizeMassarCode(institutionRow?.massar_code) || normalizeMassarCode(syncRow?.school_id);
    const institutionName = String(institutionRow?.institution_name || '').trim() || null;
    const setupCompleted =
        !!massarCode &&
        (!!Number(institutionRow?.setup_completed) ||
            !!normalizeMassarCode(institutionRow?.massar_code) ||
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

function buildLinkedDeviceSummary(row, currentDeviceHash) {
    return {
        deviceHash: row.device_hash,
        deviceName: row.device_name || null,
        osPlatform: row.os_platform || null,
        appVersion: row.app_version || null,
        linkedBy: row.linked_by || null,
        linkedAt: row.linked_at || null,
        lastSeenAt: row.last_seen_at || null,
        status: row.status === 'revoked' ? 'revoked' : 'active',
        revokedAt: row.revoked_at || null,
        isCurrentDevice: row.device_hash === currentDeviceHash
    };
}

function upsertLinkedDevice(db, deviceContext, linkedBy) {
    db.prepare(
        `
            INSERT INTO linked_devices (
                device_hash,
                device_name,
                os_platform,
                app_version,
                linked_by,
                linked_at,
                last_seen_at,
                status
            )
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'active')
            ON CONFLICT(device_hash) DO UPDATE SET
                device_name = excluded.device_name,
                os_platform = excluded.os_platform,
                app_version = excluded.app_version,
                linked_by = excluded.linked_by,
                linked_at = CURRENT_TIMESTAMP,
                last_seen_at = CURRENT_TIMESTAMP,
                status = 'active',
                revoked_at = NULL
        `
    ).run(
        deviceContext.deviceHash,
        deviceContext.deviceName,
        deviceContext.platform,
        deviceContext.appVersion,
        linkedBy
    );
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

function normalizeUserRecord(rawUser) {
    if (!rawUser || typeof rawUser !== 'object') {
        return null;
    }

    const name = String(rawUser.name || '').trim();
    const email = String(rawUser.email || '').trim() || null;
    const role = String(rawUser.role || 'principal').trim() || 'principal';
    const passwordHash = String(rawUser.password_hash ?? rawUser.passwordHash ?? '').trim() || null;
    const pinHash = String(rawUser.pin_hash ?? rawUser.pinHash ?? '').trim() || null;
    const mustChangePassword = Number(rawUser.must_change_password ?? rawUser.mustChangePassword) ? 1 : 0;

    if (!name || !passwordHash) {
        return null;
    }

    return {
        name,
        email,
        role,
        passwordHash,
        pinHash,
        mustChangePassword
    };
}

function normalizeImportedLinkPayload(rawPayload, massarCode) {
    const payload =
        rawPayload?.configPayload && typeof rawPayload.configPayload === 'object'
            ? rawPayload.configPayload
            : rawPayload;
    const institution = payload?.institution && typeof payload.institution === 'object' ? payload.institution : {};
    const institutionMassar =
        normalizeMassarCode(institution.massar_code ?? institution.massarCode) ||
        normalizeMassarCode(massarCode) ||
        null;
    const institutionName = String(institution.institution_name ?? institution.institutionName ?? '').trim() || null;
    const syncConfig = normalizeSyncConfig(
        payload?.syncConfig ?? payload?.sync_config,
        institutionMassar || normalizeMassarCode(massarCode)
    );
    const users = Array.isArray(payload?.users) ? payload.users.map(normalizeUserRecord).filter(Boolean) : [];

    return {
        institutionMassar,
        institutionName,
        syncConfig,
        users,
        user: payload?.user && typeof payload.user === 'object' ? payload.user : null,
        provisionedUser:
            (rawPayload?.provisionedUser && typeof rawPayload.provisionedUser === 'object'
                ? rawPayload.provisionedUser
                : null) ||
            (payload?.provisionedUser && typeof payload.provisionedUser === 'object' ? payload.provisionedUser : null)
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

    // Also update firebase_functions_url if the column exists
    try {
        if (mergedConfig.firebaseFunctionsUrl) {
            const url = mergedConfig.firebaseFunctionsUrl;
            db.prepare('UPDATE sync_config SET firebase_functions_url = ? WHERE id = 1').run(url);
        }
    } catch {
        // Column not yet added by migration — safe to ignore
    }
}

function importLinkedUsers(db, users) {
    if (!users.length) {
        return;
    }

    const updateAdmin = db.prepare(
        `
            UPDATE users
            SET
                name = ?,
                email = ?,
                role = ?,
                password_hash = ?,
                pin_hash = ?,
                must_change_password = ?,
                disabled = 0
            WHERE id = 1
        `
    );
    const upsertUserByEmail = db.prepare(
        `
            INSERT INTO users (name, email, role, password_hash, pin_hash, must_change_password, disabled)
            VALUES (?, ?, ?, ?, ?, ?, 0)
            ON CONFLICT(email) DO UPDATE SET
                name = excluded.name,
                role = excluded.role,
                password_hash = excluded.password_hash,
                pin_hash = excluded.pin_hash,
                must_change_password = excluded.must_change_password,
                disabled = 0
        `
    );
    const insertUserWithoutEmail = db.prepare(
        `
            INSERT INTO users (name, email, role, password_hash, pin_hash, must_change_password, disabled)
            VALUES (?, NULL, ?, ?, ?, ?, 0)
        `
    );

    for (const user of users) {
        if (user.email) {
            upsertUserByEmail.run(
                user.name,
                user.email,
                user.role,
                user.passwordHash,
                user.pinHash,
                user.mustChangePassword
            );
            continue;
        }

        if (user.role === 'admin') {
            updateAdmin.run(
                user.name,
                'admin@school.local',
                user.role,
                user.passwordHash,
                user.pinHash,
                user.mustChangePassword
            );
            continue;
        }

        insertUserWithoutEmail.run(user.name, user.role, user.passwordHash, user.pinHash, user.mustChangePassword);
    }
}

function getFirebaseFunctionsUrl(db) {
    const row = db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
    return applySyncDefaults(row).firebaseFunctionsUrl || null;
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

function mapFailureCode(rawCode) {
    switch (String(rawCode || '').trim()) {
        case 'INVALID_OTP':
        case 'OTP_CANCELLED':
        case 'OTP_EXPIRED':
        case 'OTP_USED':
        case 'RATE_LIMITED':
        case 'NO_ACTIVE_OTP':
        case 'MASSAR_MISMATCH':
            return String(rawCode).trim();
        case 'NOT_FOUND':
            return 'NO_ACTIVE_OTP';
        case 'MALFORMED_REQUEST':
            return 'INVALID_OTP';
        case 'NETWORK_ERROR':
        case 'SERVER_ERROR':
            return 'SERVER_UNAVAILABLE';
        default:
            return rawCode ? 'SERVER_UNAVAILABLE' : 'INTERNAL_ERROR';
    }
}

function extractFailureMessage(result, mappedCode) {
    const rawMessage = String(result?.error || result?.message || '').trim();
    if (!rawMessage) {
        return null;
    }
    if (rawMessage === mappedCode) {
        return null;
    }
    return rawMessage;
}

function mapVerificationFailure(result) {
    const mappedCode = mapFailureCode(result?.code || result?.error);
    return fail(mappedCode, extractFailureMessage(result, mappedCode));
}

function registerProtectedRead(ipcMain, channel, handler) {
    handleWrite(ipcMain, channel, LINKING_READ_ROLES, async (db, _event, ...args) => handler(db, ...args));
}

function registerLinkingIpc(ipcMain) {
    handleRead(ipcMain, 'linking:get-institution-status', async (db) => {
        return ok(getInstitutionStatusRecord(db));
    });

    handleWriteSoftAuth(ipcMain, 'linking:setup-new-institution', [], async (db, payload) => {
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
                        massar_code,
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
                        massar_code = excluded.massar_code,
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
            upsertLinkedDevice(db, deviceContext, 'firebase_bootstrap');
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
            console.error('[linking] setupNewInstitution error:', err);
            return fail('INTERNAL_ERROR', 'حدث خطأ أثناء إعداد المؤسسة: ' + err.message);
        }
    });

    handleWriteSoftAuth(ipcMain, 'linking:verify-and-link', [], async (db, payload) => {
        console.log('[linking:verify-and-link] Handler invoked, payload keys:', Object.keys(payload || {}));

        if (isSetupAlreadyCompleted(db)) {
            console.log('[linking:verify-and-link] ALREADY_CONFIGURED');
            return fail('ALREADY_CONFIGURED');
        }

        const massarCode = normalizeMassarCode(payload?.massarCode);
        const otp = String(payload?.otp || '').trim();
        const linkUserName = String(payload?.userName || '').trim();
        const linkUserEmail = String(payload?.userEmail || '').trim().toLowerCase();
        const linkUserPassword = String(payload?.userPassword || '');
        const { ALLOWED_ROLES: _linkAllowedRoles } = require('../auth/permissions');
        const linkUserRole = _linkAllowedRoles.includes(String(payload?.userRole || '').toLowerCase())
            ? payload.userRole.toLowerCase()
            : 'viewer'; // default to lowest privilege when role is absent or unrecognised

        console.log('[linking:verify-and-link] Parsed:', { massarCode, otpLen: otp.length, linkUserName, linkUserRole });

        if (!massarCode) {
            console.log('[linking:verify-and-link] INVALID_MASSAR');
            return fail('INVALID_MASSAR');
        }
        if (!OTP_REGEX.test(otp)) {
            console.log('[linking:verify-and-link] INVALID_OTP');
            return fail('INVALID_OTP', 'رمز الربط يجب أن يكون 6 أرقام');
        }
        if (!linkUserName || linkUserName.length < 2) {
            console.log('[linking:verify-and-link] INVALID_ADMIN_NAME');
            return fail('INVALID_ADMIN_NAME', 'اسم المستخدم مطلوب (حرفان على الأقل)');
        }
        if (!linkUserEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(linkUserEmail)) {
            console.log('[linking:verify-and-link] INVALID_EMAIL');
            return fail('INVALID_EMAIL', 'البريد الإلكتروني غير صالح');
        }
        if (linkUserPassword.length < 6) {
            console.log('[linking:verify-and-link] INVALID_PASSWORD');
            return fail('INVALID_PASSWORD', 'كلمة المرور يجب أن تكون 6 أحرف على الأقل');
        }

        const deviceContext = getCurrentDeviceContext();
        let importedPayload = null;
        const verifiedVia = 'server';
        const functionsUrl = getFirebaseFunctionsUrl(db);
        if (!functionsUrl) {
            return fail(
                'SERVER_UNAVAILABLE',
                'ربط جهاز جديد يتطلب ضبط FIREBASE_FUNCTIONS_URL أو firebase_functions_url للتحقق عبر Firebase'
            );
        }

        try {
            const serverResult = await verifyOtpViaServer(functionsUrl, massarCode, otp, {
                provisionUser: {
                    name: linkUserName,
                    email: linkUserEmail,
                    password: linkUserPassword,
                    role: linkUserRole
                }
            });
            if (!serverResult?.success) {
                return mapVerificationFailure(serverResult);
            }

            importedPayload = normalizeImportedLinkPayload(serverResult, massarCode);
        } catch (serverErr) {
            console.error('[linking] Server verification failed:', serverErr.message);
            return fail('SERVER_UNAVAILABLE');
        }

        if (!importedPayload?.institutionMassar) {
            return fail('MASSAR_MISMATCH');
        }

        const institutionMassar = importedPayload.institutionMassar;
        if (institutionMassar !== massarCode) {
            return fail('MASSAR_MISMATCH');
        }

        try {
            let autoLoginEmail = null;
            const transaction = db.transaction(() => {
                db.prepare(
                    `
                        INSERT INTO institution_config (
                            id,
                            massar_code,
                            institution_name,
                            setup_completed,
                            setup_mode,
                            setup_device_hash,
                            onboarding_version,
                            onboarding_completed_at,
                            updated_at
                        )
                        VALUES (1, ?, ?, 1, 'firebase-linked', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT(id) DO UPDATE SET
                            massar_code = excluded.massar_code,
                            institution_name = excluded.institution_name,
                            setup_completed = 1,
                            setup_mode = 'firebase-linked',
                            setup_device_hash = excluded.setup_device_hash,
                            onboarding_version = 1,
                            onboarding_completed_at = COALESCE(onboarding_completed_at, CURRENT_TIMESTAMP),
                            updated_at = CURRENT_TIMESTAMP
                    `
                ).run(institutionMassar, importedPayload.institutionName, deviceContext.deviceHash);

                upsertLinkedDevice(db, deviceContext, 'otp_server');
                upsertSyncConfig(db, importedPayload.syncConfig);
                const instCheck = db.prepare('SELECT massar_code FROM institution_config WHERE id = 1').get();
                if (instCheck && instCheck.massar_code) {
                    db.prepare('UPDATE sync_config SET school_id = ? WHERE id = 1 AND school_id != ?').run(
                        instCheck.massar_code,
                        instCheck.massar_code
                    );
                }
                importLinkedUsers(db, importedPayload.users);

                // Create local user account for this linked device
                autoLoginEmail = linkUserEmail;
                upsertFirebaseCachedUser(
                    db,
                    {
                        name: linkUserName,
                        email: linkUserEmail,
                        role: importedPayload.provisionedUser?.role || linkUserRole,
                        uid: importedPayload.provisionedUser?.uid || importedPayload.user?.uid || null,
                        emailVerified: importedPayload.provisionedUser?.emailVerified || 0,
                        mustChangePassword: importedPayload.provisionedUser?.mustChangePassword || 0
                    },
                    linkUserPassword,
                    linkUserRole
                );
            });

            transaction();

            return ok({
                message: 'تم ربط الجهاز بنجاح',
                verifiedVia,
                setupCompleted: true,
                institution: buildInstitutionSummary(institutionMassar, importedPayload.institutionName),
                currentDevice: buildCurrentDeviceSummary(db, deviceContext),
                autoLoginEmail,
                loginPayload: {
                    email: autoLoginEmail,
                    password: linkUserPassword,
                    source: importedPayload.provisionedUser?.uid || importedPayload.user?.uid ? 'firebase' : 'local-cache'
                },
                unresolved: importedPayload.provisionedUser?.uid
                    ? []
                    : ['OTP backend did not return a Firebase-provisioned user; cached a local login only.']
            });
        } catch (err) {
            console.error('[linking] verifyAndLink DB error:', err);
            return fail('INTERNAL_ERROR', 'حدث خطأ أثناء ربط الجهاز: ' + err.message);
        }
    });

    handleWrite(ipcMain, 'linking:generateOtp', ['admin'], async (db) => {
        const institution = getInstitutionStatusRecord(db);
        if (!institution.setupCompleted || !institution.massarCode) {
            return fail('SETUP_REQUIRED');
        }

        const deviceContext = getCurrentDeviceContext();

        try {
            const generated = generateInstitutionOtp(db, institution.massarCode, deviceContext.deviceHash);

            const syncRow = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
            const functionsUrl = String(syncRow?.firebase_functions_url || '').trim().replace(/\/+$/, '') || null;
            if (functionsUrl) {
                const configPayload = {
                    institution: {
                        massar_code: institution.massarCode,
                        institution_name: institution.institutionName
                    },
                    syncConfig: {
                        school_id: syncRow?.school_id || institution.massarCode,
                        firebase_functions_url: syncRow?.firebase_functions_url || null,
                        firebase_project_id: syncRow?.firebase_project_id || null,
                        firebase_api_key: syncRow?.firebase_api_key || null,
                        firebase_auth_domain: syncRow?.firebase_auth_domain || null,
                        firebase_app_id: syncRow?.firebase_app_id || null,
                        firebase_storage_bucket: syncRow?.firebase_storage_bucket || null,
                        firebase_messaging_sender_id: syncRow?.firebase_messaging_sender_id || null,
                        sync_interval_minutes: syncRow?.sync_interval_minutes || 10,
                        enabled: 1
                    },
                    users: []
                };
                const remoteResult = await publishOtpToServer(
                    functionsUrl,
                    institution.massarCode,
                    deviceContext.deviceHash,
                    institution.massarCode,
                    generated.otp,
                    configPayload
                );
                if (!remoteResult.success) {
                    console.warn('[linking] Failed to publish OTP to server:', remoteResult.error);
                }
            }

            const otpStatus = getLatestOtpStatus(db, institution.massarCode);
            const publishedStatus = getPublishedOtpStatus();
            return ok({
                otp: generated.otp,
                expiresAt: otpStatus.expiresAt || generated.expiresAt,
                remainingSeconds: otpStatus.remainingSeconds,
                transport: { serverPublished: !!publishedStatus.active }
            });
        } catch (err) {
            console.error('[linking] generateOtp error:', err);
            return fail('INTERNAL_ERROR', 'حدث خطأ أثناء توليد كود الربط: ' + err.message);
        }
    });

    handleWrite(ipcMain, 'linking:cancelOtp', ['admin'], async (db) => {
        const institution = getInstitutionStatusRecord(db);
        if (!institution.massarCode) {
            return fail('SETUP_REQUIRED');
        }

        const otpStatus = getLatestOtpStatus(db, institution.massarCode);
        if (otpStatus.active) {
            const cancelResult = cancelActiveOtp(db, institution.massarCode);
            if (!cancelResult.success) {
                return fail(cancelResult.error || 'NO_ACTIVE_OTP');
            }
        }

        const publishedStatus = getPublishedOtpStatus();
        if (publishedStatus.active) {
            const remoteCancel = await cancelPublishedOtp();
            if (!remoteCancel.success) {
                return fail('SERVER_UNAVAILABLE', remoteCancel.error || 'تعذر إلغاء رمز الربط عبر السيرفر');
            }
        }

        return ok({ message: 'تم إلغاء كود الربط', cancelled: true });
    });

    registerProtectedRead(ipcMain, 'linking:getOtpStatus', (db) => {
        const institution = getInstitutionStatusRecord(db);
        if (!institution.massarCode) {
            return ok({
                active: false,
                status: 'inactive',
                expiresAt: null,
                remainingSeconds: 0,
                transport: {
                    serverPublished: false
                }
            });
        }

        const otpStatus = getLatestOtpStatus(db, institution.massarCode);
        const publishedStatus = getPublishedOtpStatus();
        return ok({
            active: otpStatus.active,
            status: otpStatus.status,
            expiresAt: otpStatus.expiresAt,
            remainingSeconds: otpStatus.remainingSeconds,
            transport: {
                serverPublished: !!publishedStatus.active
            }
        });
    });

    registerProtectedRead(ipcMain, 'linking:getCurrentDevice', (db) => {
        try {
            return ok(buildCurrentDeviceSummary(db));
        } catch {
            return fail('INTERNAL_ERROR', 'تعذر جمع بصمة الجهاز الحالية');
        }
    });

    registerProtectedRead(ipcMain, 'linking:getLinkedDevices', (db) => {
        const institution = getInstitutionStatusRecord(db);
        if (!institution.massarCode) {
            return ok({ devices: [] });
        }

        try {
            const deviceContext = getCurrentDeviceContext();
            const rows = db
                .prepare(
                    `
                        SELECT *
                        FROM linked_devices
                        ORDER BY datetime(linked_at) ASC, device_name COLLATE NOCASE ASC
                    `
                )
                .all();

            return ok({
                devices: rows.map((row) => buildLinkedDeviceSummary(row, deviceContext.deviceHash))
            });
        } catch {
            return fail('INTERNAL_ERROR', 'تعذر تحميل قائمة الأجهزة المرتبطة');
        }
    });

    handleWrite(ipcMain, 'linking:revokeDevice', ['admin'], (db, _event, deviceHashOrPayload) => {
        const institution = getInstitutionStatusRecord(db);
        if (!institution.massarCode) {
            return fail('SETUP_REQUIRED');
        }

        const targetDeviceHash = String(
            typeof deviceHashOrPayload === 'string' ? deviceHashOrPayload : deviceHashOrPayload?.deviceHash || ''
        ).trim();
        if (!targetDeviceHash) {
            return fail('DEVICE_NOT_FOUND');
        }

        const instConfig = db.prepare('SELECT setup_device_hash FROM institution_config WHERE id = 1').get();
        if (instConfig && instConfig.setup_device_hash && instConfig.setup_device_hash === targetDeviceHash) {
            return { success: false, error: 'لا يمكن إلغاء الجهاز الأصلي للمؤسسة' };
        }

        const currentDevice = getCurrentDeviceContext();
        if (targetDeviceHash === currentDevice.deviceHash) {
            return fail('CURRENT_DEVICE_PROTECTED');
        }

        const row = db
            .prepare('SELECT device_hash, status FROM linked_devices WHERE device_hash = ?')
            .get(targetDeviceHash);
        if (!row) {
            return fail('DEVICE_NOT_FOUND');
        }
        if (row.status === 'revoked') {
            return fail('DEVICE_ALREADY_REVOKED');
        }

        db.prepare(
            `
                UPDATE linked_devices
                SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP
                WHERE device_hash = ?
            `
        ).run(targetDeviceHash);

        return ok({ message: 'تم إلغاء الجهاز بنجاح', revokedDeviceHash: targetDeviceHash });
    });
}

module.exports = { registerLinkingIpc };
