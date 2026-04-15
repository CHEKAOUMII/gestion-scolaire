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
    buildLinkBootstrapPayload,
    startLinkingServer,
    stopLinkingServer,
    discoverLanDevices: discoverLanDevicesOnLan,
    verifyViaLan,
    getLinkingServerStatus
} = require('../linking/lan');
const {
    publishOtpToServer,
    verifyOtpViaServer,
    getPublishedOtpStatus,
    cancelPublishedOtp
} = require('../linking/server');

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
    LAN_UNAVAILABLE: 'تعذر العثور على جهاز إداري صالح على الشبكة المحلية',
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

    // Get local IPv4 addresses for manual linking
    let localIp = null;
    const allIps = [];
    try {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    allIps.push(iface.address);
                }
            }
        }
        // Prefer routable LAN IPs over link-local (169.254.x.x)
        const routableIp = allIps.find(ip => !ip.startsWith('169.254.'));
        localIp = routableIp || allIps[0] || null;
    } catch { /* ignore */ }

    return {
        deviceHash: deviceContext.deviceHash,
        deviceName: deviceContext.deviceName,
        platform: deviceContext.platform,
        appVersion: deviceContext.appVersion,
        massarCode: institution.massarCode,
        institutionName: institution.institutionName,
        setupCompleted: institution.setupCompleted,
        ip: localIp,
        allIps
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
    const authLambdaUrlSource = config.auth_lambda_url ?? config.authLambdaUrl ?? '';
    const awsRegionSource = config.aws_region ?? config.awsRegion ?? '';
    const licenseKeySource = config.license_key ?? config.licenseKey ?? '';

    return {
        schoolId: String(schoolIdSource).trim() || null,
        authLambdaUrl: String(authLambdaUrlSource).trim() || null,
        awsRegion: String(awsRegionSource).trim() || null,
        licenseKey: String(licenseKeySource).trim() || null,
        syncIntervalMinutes: Number.isFinite(syncIntervalValue) && syncIntervalValue > 0 ? syncIntervalValue : null,
        enabled: enabledValue === undefined || enabledValue === null ? null : Number(enabledValue) ? 1 : 0
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
        users
    };
}

function upsertSyncConfig(db, syncConfig) {
    const currentConfig = db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
    const mergedConfig = {
        schoolId: syncConfig.schoolId || currentConfig.school_id || null,
        authLambdaUrl: syncConfig.authLambdaUrl || currentConfig.auth_lambda_url || null,
        awsRegion: syncConfig.awsRegion || currentConfig.aws_region || null,
        licenseKey: syncConfig.licenseKey || currentConfig.license_key || null,
        syncIntervalMinutes: syncConfig.syncIntervalMinutes || Number(currentConfig.sync_interval_minutes) || 10,
        enabled:
            syncConfig.enabled === null || syncConfig.enabled === undefined
                ? Number(currentConfig.enabled)
                    ? 1
                    : 0
                : syncConfig.enabled
    };

    db.prepare(
        `
            INSERT INTO sync_config (
                id,
                school_id,
                auth_lambda_url,
                aws_region,
                license_key,
                sync_interval_minutes,
                enabled,
                updated_at
            )
            VALUES (1, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                school_id = excluded.school_id,
                auth_lambda_url = excluded.auth_lambda_url,
                aws_region = excluded.aws_region,
                license_key = excluded.license_key,
                sync_interval_minutes = excluded.sync_interval_minutes,
                enabled = excluded.enabled,
                updated_at = CURRENT_TIMESTAMP
        `
    ).run(
        mergedConfig.schoolId,
        mergedConfig.authLambdaUrl,
        mergedConfig.awsRegion,
        mergedConfig.licenseKey,
        mergedConfig.syncIntervalMinutes,
        mergedConfig.enabled
    );
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

function getAuthLambdaUrl(db) {
    const row = db.prepare('SELECT auth_lambda_url FROM sync_config WHERE id = 1').get();
    return String(row?.auth_lambda_url || process.env.AUTH_LAMBDA_URL || '').trim() || null;
}

function buildTransportStatus(localOtpStatus) {
    let lanStatus = getLinkingServerStatus();
    if (!localOtpStatus?.active && lanStatus.active) {
        stopLinkingServer();
        lanStatus = getLinkingServerStatus();
    }

    const publishedStatus = getPublishedOtpStatus();

    return {
        lanActive: !!lanStatus.active,
        serverPublished: !!publishedStatus.active
    };
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
        const institutionName = String(payload?.institutionName || '').trim() || null;
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
        const passwordHash = hashPassword(adminPassword);
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
                        updated_at
                    )
                    VALUES (1, ?, ?, 1, 'new', ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(id) DO UPDATE SET
                        massar_code = excluded.massar_code,
                        institution_name = excluded.institution_name,
                        setup_completed = 1,
                        setup_mode = 'new',
                        setup_device_hash = excluded.setup_device_hash,
                        updated_at = CURRENT_TIMESTAMP
                `
            ).run(massarCode, institutionName, deviceContext.deviceHash);

            db.prepare(
                `
                    UPDATE users
                    SET name = ?, email = ?, role = 'principal', password_hash = ?, must_change_password = 0, disabled = 0
                    WHERE id = 1
                `
            ).run(adminName, adminEmail, passwordHash);

            upsertSyncConfig(db, { schoolId: massarCode });
            upsertLinkedDevice(db, deviceContext, 'setup_new');
        });

        try {
            transaction();
            return ok({
                message: 'تم إعداد المؤسسة بنجاح',
                setupCompleted: true,
                institution: buildInstitutionSummary(massarCode, institutionName),
                currentDevice: buildCurrentDeviceSummary(db, deviceContext),
                autoLoginEmail: adminEmail
            });
        } catch (err) {
            console.error('[linking] setupNewInstitution error:', err);
            return fail('INTERNAL_ERROR', 'حدث خطأ أثناء إعداد المؤسسة: ' + err.message);
        }
    });

    handleRead(ipcMain, 'linking:discover-lan-devices', async (_db, payload) => {
        const massarCode = normalizeMassarCode(payload?.massarCode);
        const timeoutMs = Number(payload?.timeoutMs);

        if (!massarCode) {
            return fail('INVALID_MASSAR');
        }

        try {
            const devices = await discoverLanDevicesOnLan(
                massarCode,
                Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000
            );
            return ok({ devices: Array.isArray(devices) ? devices : [] });
        } catch (err) {
            console.warn('[linking] discoverLanDevices unavailable:', err.message);
            return ok({ devices: [] });
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
        let verifiedVia = null;
        const primaryIp = String(payload?.primaryIp || '').trim() || null;
        console.log('[linking:verify-and-link] primaryIp:', primaryIp);

        try {
            console.log('[linking:verify-and-link] Starting LAN discovery (5s timeout)...');
            const devices = await discoverLanDevicesOnLan(massarCode, 5000);
            console.log('[linking:verify-and-link] LAN discovery result:', devices?.length || 0, 'devices');
            if (Array.isArray(devices) && devices.length > 0) {
                const target = devices[0];
                console.log('[linking:verify-and-link] Trying LAN verification:', target.ip, target.port);
                const lanResult = await verifyViaLan(
                    target.ip,
                    target.port,
                    massarCode,
                    otp,
                    deviceContext.deviceHash,
                    deviceContext.deviceName
                );

                console.log('[linking:verify-and-link] LAN verify result success:', lanResult?.success);
                if (lanResult?.success) {
                    verifiedVia = 'lan';
                    importedPayload = normalizeImportedLinkPayload(lanResult, massarCode);
                } else {
                    const lanFailure = mapVerificationFailure(lanResult);
                    console.log('[linking:verify-and-link] LAN failure code:', lanFailure.code);
                    const canFallbackToServer = ['LAN_UNAVAILABLE', 'NO_ACTIVE_OTP', 'SERVER_UNAVAILABLE'].includes(
                        lanFailure.code
                    );
                    if (!canFallbackToServer) {
                        return lanFailure;
                    }
                }
            }
        } catch (lanErr) {
            console.warn('[linking:verify-and-link] LAN verification exception:', lanErr.message);
        }

        // Direct IP fallback: try connecting to primary device via HTTP when UDP discovery failed
        if (!verifiedVia && primaryIp) {
            try {
                console.log('[linking:verify-and-link] Trying DIRECT IP:', primaryIp, ':19876');
                const directResult = await verifyViaLan(
                    primaryIp,
                    19876,
                    massarCode,
                    otp,
                    deviceContext.deviceHash,
                    deviceContext.deviceName
                );
                console.log('[linking:verify-and-link] Direct IP result success:', directResult?.success);
                if (directResult?.success) {
                    verifiedVia = 'lan';
                    importedPayload = normalizeImportedLinkPayload(directResult, massarCode);
                }
            } catch (directErr) {
                console.warn('[linking:verify-and-link] Direct IP exception:', directErr.message);
            }
        }

        if (!verifiedVia) {
            // If direct IP was tried and still not verified, report the failure clearly
            if (primaryIp) {
                console.log('[linking:verify-and-link] Direct IP provided but verification still failed. Trying server...');
            } else {
                console.log('[linking:verify-and-link] No primaryIp provided and LAN discovery failed.');
            }

            const authLambdaUrl = getAuthLambdaUrl(db);
            if (!authLambdaUrl) {
                // No server configured — give specific guidance
                if (!primaryIp) {
                    return fail(
                        'LAN_UNAVAILABLE',
                        'تعذر اكتشاف الجهاز الرئيسي تلقائياً. أدخل عنوان IP للجهاز الرئيسي في الحقل المخصص (يظهر بجانب كود الربط على الجهاز الرئيسي) ثم أعد المحاولة.'
                    );
                }
                return fail(
                    'DIRECT_IP_FAILED',
                    'تعذر الاتصال بالجهاز الرئيسي على العنوان ' + primaryIp + ':19876. تأكد أن:\n'
                    + '• الجهاز الرئيسي يعمل وكود الربط نشط\n'
                    + '• العنوان IP صحيح (ليس 169.254.x.x)\n'
                    + '• الجهازين على نفس الشبكة\n'
                    + '• جدار الحماية لا يمنع المنفذ 19876'
                );
            }

            try {
                const serverResult = await verifyOtpViaServer(authLambdaUrl, massarCode, otp);
                if (!serverResult?.success) {
                    return mapVerificationFailure(serverResult);
                }

                verifiedVia = 'server';
                importedPayload = normalizeImportedLinkPayload(serverResult, massarCode);
            } catch (serverErr) {
                console.error('[linking] Server verification failed:', serverErr.message);
                return fail('SERVER_UNAVAILABLE');
            }
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
                            updated_at
                        )
                        VALUES (1, ?, ?, 1, 'linked', ?, CURRENT_TIMESTAMP)
                        ON CONFLICT(id) DO UPDATE SET
                            massar_code = excluded.massar_code,
                            institution_name = excluded.institution_name,
                            setup_completed = 1,
                            setup_mode = 'linked',
                            setup_device_hash = excluded.setup_device_hash,
                            updated_at = CURRENT_TIMESTAMP
                    `
                ).run(institutionMassar, importedPayload.institutionName, deviceContext.deviceHash);

                upsertLinkedDevice(db, deviceContext, verifiedVia === 'lan' ? 'otp_lan' : 'otp_server');
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
                db.prepare(
                    `INSERT INTO users (name, email, role, password_hash, must_change_password, disabled)
                     VALUES (?, ?, ?, ?, 0, 0)`
                ).run(linkUserName, linkUserEmail, linkUserRole, hashPassword(linkUserPassword));
            });

            transaction();

            return ok({
                message: 'تم ربط الجهاز بنجاح',
                verifiedVia,
                setupCompleted: true,
                institution: buildInstitutionSummary(institutionMassar, importedPayload.institutionName),
                currentDevice: buildCurrentDeviceSummary(db, deviceContext),
                autoLoginEmail
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

            try {
                await startLinkingServer(db);
            } catch (lanErr) {
                console.warn('[linking] Failed to start LAN sharing:', lanErr.message);
            }

            const bootstrapPayload = buildLinkBootstrapPayload(db);
            const authLambdaUrl = bootstrapPayload?.syncConfig?.authLambdaUrl;
            const licenseKey = bootstrapPayload?.syncConfig?.licenseKey;
            if (authLambdaUrl && licenseKey) {
                const remoteResult = await publishOtpToServer(
                    authLambdaUrl,
                    licenseKey,
                    deviceContext.deviceHash,
                    institution.massarCode,
                    generated.otp,
                    bootstrapPayload
                );
                if (!remoteResult.success) {
                    console.warn('[linking] Failed to publish OTP to server:', remoteResult.error);
                }
            }

            const otpStatus = getLatestOtpStatus(db, institution.massarCode);
            return ok({
                otp: generated.otp,
                expiresAt: otpStatus.expiresAt || generated.expiresAt,
                remainingSeconds: otpStatus.remainingSeconds,
                transport: buildTransportStatus(otpStatus)
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

        stopLinkingServer();

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
                    lanActive: false,
                    serverPublished: false
                }
            });
        }

        const otpStatus = getLatestOtpStatus(db, institution.massarCode);
        return ok({
            active: otpStatus.active,
            status: otpStatus.status,
            expiresAt: otpStatus.expiresAt,
            remainingSeconds: otpStatus.remainingSeconds,
            transport: buildTransportStatus(otpStatus)
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
