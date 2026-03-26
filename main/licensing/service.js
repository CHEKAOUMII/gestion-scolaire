const crypto = require('crypto');
const { app } = require('electron');

const { getDb } = require('../db/context');
const { getTrialStatus } = require('./trialService');
const { createOfflineLicenseKey, decodeOfflineLicenseKey } = require('./offlineKey');
const {
    collectCurrentFingerprint,
    parseStoredVector,
    scoreVectorMatch,
    REINSTALL_MATCH_THRESHOLD
} = require('./deviceFingerprint');

const DEFAULT_GRACE_DAYS = 14;
const PLAN_LIMITS_FALLBACK = {
    basic: 1,
    pro: 3,
    business: 10
};

function nowIso() {
    return new Date().toISOString();
}

function sha256(value) {
    return crypto
        .createHash('sha256')
        .update(String(value || ''), 'utf8')
        .digest('hex');
}

function safeJsonParse(jsonText, fallbackValue) {
    try {
        return JSON.parse(jsonText);
    } catch (_err) {
        return fallbackValue;
    }
}

function eventLog(db, licenseId, eventType, details = {}) {
    db.prepare(
        `
        INSERT INTO license_events(license_id, event_type, details)
        VALUES (?, ?, ?)
    `
    ).run(licenseId || null, eventType, JSON.stringify(details));
}

function pushOwnerSyncEvent(eventType, details = {}) {
    try {
        const { enqueueOwnerSyncEvent, flushOwnerSyncOutbox } = require('./ownerSync');
        enqueueOwnerSyncEvent(eventType, details);
        void flushOwnerSyncOutbox();
    } catch (_err) {
        // Owner sync is optional; ignore failures here
    }
}

function getLicenseWithPlan(db) {
    return (
        db
            .prepare(
                `
            SELECT l.*, p.max_devices, p.name as plan_name
            FROM licenses l
            LEFT JOIN license_plans p ON p.code = l.plan_code
            WHERE l.status != 'revoked'
            ORDER BY l.id DESC
            LIMIT 1
        `
            )
            .get() || null
    );
}

function getPlanMaxDevices(db, planCode) {
    const row = db.prepare('SELECT max_devices FROM license_plans WHERE code = ?').get(planCode);
    return Number(row?.max_devices || PLAN_LIMITS_FALLBACK[planCode] || 1);
}

function findCurrentActivation(activeRows, currentFingerprint) {
    const exact = activeRows.find((row) => row.device_hash === currentFingerprint.deviceHash);
    if (exact) {
        return { row: exact, score: 100, mode: 'exact' };
    }

    let bestRow = null;
    let bestScore = 0;
    activeRows.forEach((row) => {
        const storedVector = parseStoredVector(row.fingerprint_vector);
        const score = scoreVectorMatch(storedVector, currentFingerprint.vector);
        if (score > bestScore) {
            bestScore = score;
            bestRow = row;
        }
    });

    if (bestRow && bestScore >= REINSTALL_MATCH_THRESHOLD) {
        return { row: bestRow, score: bestScore, mode: 'fuzzy' };
    }

    return null;
}

function computeGraceRemainingDays(license) {
    const requiresOnlineValidation = Number(license?.requires_online_validation || 0) === 1;
    if (!requiresOnlineValidation) return null;

    const graceDays = Number(license?.offline_grace_days || DEFAULT_GRACE_DAYS);
    const lastValidatedAt = license?.last_validated_at ? new Date(license.last_validated_at) : null;
    if (!lastValidatedAt || Number.isNaN(lastValidatedAt.getTime())) {
        return graceDays;
    }

    const elapsedMs = Date.now() - lastValidatedAt.getTime();
    const elapsedDays = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
    return Math.max(0, graceDays - elapsedDays);
}

function getLicenseStatus() {
    const db = getDb();
    const license = getLicenseWithPlan(db);
    if (!license) {
        return {
            success: true,
            status: 'not_activated',
            planCode: null,
            planName: null,
            maxDevices: 0,
            activeDevices: 0,
            graceRemainingDays: null
        };
    }

    const activeRows = db
        .prepare(
            `
            SELECT *
            FROM license_activations
            WHERE license_id = ? AND revoked_at IS NULL
            ORDER BY last_seen_at DESC
        `
        )
        .all(license.id);

    const currentFingerprint = collectCurrentFingerprint();
    const match = findCurrentActivation(activeRows, currentFingerprint);

    const maxDevices = Number(license.max_devices || getPlanMaxDevices(db, license.plan_code));
    const activeDevices = activeRows.length;
    const expiresAtDate = license.expires_at ? new Date(license.expires_at) : null;
    const isExpired = !!(
        expiresAtDate &&
        !Number.isNaN(expiresAtDate.getTime()) &&
        expiresAtDate.getTime() < Date.now()
    );

    const graceRemainingDays = computeGraceRemainingDays(license);

    let status = 'active';
    if (license.status === 'suspended') status = 'suspended';
    else if (license.status === 'inactive') status = 'inactive';
    else if (license.status === 'revoked') status = 'revoked';
    else if (isExpired) status = 'expired';
    else if (!match) status = 'device_not_activated';
    else if (graceRemainingDays !== null && graceRemainingDays <= 0) status = 'grace_expired';
    else if (graceRemainingDays !== null && graceRemainingDays <= 3) status = 'grace_warning';

    const metadata = safeJsonParse(license.metadata || '{}', {});

    return {
        success: true,
        status,
        planCode: license.plan_code,
        planName: license.plan_name || license.plan_code,
        maxDevices,
        activeDevices,
        expiresAt: license.expires_at || null,
        lastValidatedAt: license.last_validated_at || null,
        graceRemainingDays,
        requiresOnlineValidation: Number(license.requires_online_validation || 0) === 1,
        customerRef: metadata.customerRef || '',
        keyHint: license.key_hint || '',
        currentDevice: {
            deviceName: currentFingerprint.deviceName,
            matched: !!match,
            matchMode: match?.mode || null,
            matchScore: match?.score || 0
        }
    };
}

function getActivationRequest() {
    const currentFingerprint = collectCurrentFingerprint();
    return {
        success: true,
        deviceCode: currentFingerprint.deviceHash,
        deviceName: currentFingerprint.deviceName,
        platform: currentFingerprint.platform,
        appVersion: app.getVersion()
    };
}

function getPublicActivationStatus() {
    const status = getLicenseStatus();
    if (!status?.success) return status;

    const activationRequiredStates = new Set([
        'not_activated',
        'device_not_activated',
        'expired',
        'suspended',
        'inactive',
        'revoked',
        'grace_expired'
    ]);

    const hasLicense = !activationRequiredStates.has(status.status);

    // If no valid license, check trial status
    if (!hasLicense) {
        const trial = getTrialStatus();
        if (trial.isTrialActive) {
            return {
                success: true,
                activated: true,
                status: 'trial',
                planCode: status.planCode,
                planName: status.planName,
                expiresAt: status.expiresAt,
                graceRemainingDays: status.graceRemainingDays,
                trialActive: true,
                trialDaysRemaining: trial.daysRemaining,
                trialEndDate: trial.trialEndDate,
                trialDuration: trial.trialDuration
            };
        }
        // Trial expired and no license
        return {
            success: true,
            activated: false,
            status: 'trial_expired',
            planCode: status.planCode,
            planName: status.planName,
            expiresAt: status.expiresAt,
            graceRemainingDays: status.graceRemainingDays,
            trialActive: false,
            trialDaysRemaining: 0,
            trialEndDate: trial.trialEndDate,
            trialDuration: trial.trialDuration
        };
    }

    return {
        success: true,
        activated: true,
        status: status.status,
        planCode: status.planCode,
        planName: status.planName,
        expiresAt: status.expiresAt,
        graceRemainingDays: status.graceRemainingDays,
        trialActive: false,
        trialDaysRemaining: 0
    };
}

function generateSerialKey({
    planCode = 'basic',
    days = 365,
    customerRef = '',
    deviceCode = '',
    requiresOnlineValidation = false
} = {}) {
    const normalizedPlan = String(planCode || 'basic')
        .trim()
        .toLowerCase();
    const normalizedDeviceCode = String(deviceCode || '')
        .trim()
        .toLowerCase();
    const normalizedCustomerRef = String(customerRef || '').trim();
    const durationDays = Number(days);

    if (!['basic', 'pro', 'business'].includes(normalizedPlan)) {
        return { success: false, code: 'INVALID_PLAN', error: 'Plan must be basic/pro/business' };
    }

    if (!Number.isFinite(durationDays) || durationDays <= 0 || durationDays > 3650) {
        return { success: false, code: 'INVALID_DAYS', error: 'Days must be between 1 and 3650' };
    }

    if (normalizedDeviceCode && !/^[a-f0-9]{64}$/.test(normalizedDeviceCode)) {
        return { success: false, code: 'INVALID_DEVICE_CODE', error: 'Device code must be a 64-char hex hash' };
    }

    const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
    const serialKey = createOfflineLicenseKey({
        planCode: normalizedPlan,
        expiresAt,
        customerRef: normalizedCustomerRef,
        requiresOnlineValidation: !!requiresOnlineValidation,
        deviceCode: normalizedDeviceCode
    });

    return {
        success: true,
        serialKey,
        metadata: {
            planCode: normalizedPlan,
            days: durationDays,
            expiresAt,
            customerRef: normalizedCustomerRef,
            deviceCode: normalizedDeviceCode,
            requiresOnlineValidation: !!requiresOnlineValidation
        }
    };
}

function activateLicense({ licenseKey, deviceName } = {}) {
    const decoded = decodeOfflineLicenseKey(licenseKey);
    if (!decoded.ok) {
        return { success: false, error: decoded.error, code: 'INVALID_LICENSE_KEY' };
    }

    if (decoded.payload.expiresAt && new Date(decoded.payload.expiresAt).getTime() < Date.now()) {
        return { success: false, error: 'License key has expired', code: 'LICENSE_EXPIRED' };
    }

    const db = getDb();
    const currentFingerprint = collectCurrentFingerprint();

    const requiredDeviceCode = String(decoded.payload.deviceCode || '')
        .trim()
        .toLowerCase();
    if (requiredDeviceCode && requiredDeviceCode !== String(currentFingerprint.deviceHash || '').toLowerCase()) {
        return {
            success: false,
            code: 'DEVICE_MISMATCH',
            error: 'This serial is not generated for this device'
        };
    }

    const keyHash = sha256(decoded.normalizedKey);
    const keyHint = decoded.normalizedKey.slice(-8);
    const usedDeviceName = String(deviceName || currentFingerprint.deviceName || '').slice(0, 120);
    const appVersion = app.getVersion();
    const now = nowIso();

    let license = db.prepare('SELECT * FROM licenses WHERE license_key_hash = ?').get(keyHash);

    if (!license) {
        db.prepare(
            `
            INSERT INTO licenses(
                license_key_hash,
                key_hint,
                plan_code,
                status,
                expires_at,
                offline_grace_days,
                requires_online_validation,
                last_validated_at,
                metadata,
                created_at,
                updated_at
            )
            VALUES(?, ?, ?, 'active', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `
        ).run(
            keyHash,
            keyHint,
            decoded.payload.planCode,
            decoded.payload.expiresAt,
            DEFAULT_GRACE_DAYS,
            decoded.payload.requiresOnlineValidation ? 1 : 0,
            now,
            JSON.stringify({
                customerRef: decoded.payload.customerRef,
                deviceCode: decoded.payload.deviceCode || '',
                issuedAt: decoded.payload.issuedAt,
                nonce: decoded.payload.nonce
            })
        );

        license = db.prepare('SELECT * FROM licenses WHERE license_key_hash = ?').get(keyHash);
        eventLog(db, license?.id, 'license_created', {
            planCode: decoded.payload.planCode,
            keyHint
        });
    } else {
        db.prepare(
            `
            UPDATE licenses
            SET
                plan_code = ?,
                status = 'active',
                expires_at = ?,
                requires_online_validation = ?,
                key_hint = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `
        ).run(
            decoded.payload.planCode,
            decoded.payload.expiresAt,
            decoded.payload.requiresOnlineValidation ? 1 : 0,
            keyHint,
            license.id
        );
        license = db.prepare('SELECT * FROM licenses WHERE id = ?').get(license.id);
    }

    // Save the license key for sync authentication
    try {
        db.prepare('UPDATE sync_config SET license_key = ? WHERE id = 1').run(decoded.normalizedKey);
    } catch {
        // sync_config table may not exist yet (pre-migration) — safe to ignore
    }

    const activeRows = db
        .prepare(
            `
            SELECT *
            FROM license_activations
            WHERE license_id = ? AND revoked_at IS NULL
            ORDER BY last_seen_at DESC
        `
        )
        .all(license.id);

    const existingMatch = findCurrentActivation(activeRows, currentFingerprint);
    if (existingMatch?.row) {
        db.prepare(
            `
            UPDATE license_activations
            SET
                device_hash = ?,
                fingerprint_vector = ?,
                device_name = ?,
                os_platform = ?,
                app_version = ?,
                last_seen_at = CURRENT_TIMESTAMP,
                revoked_at = NULL
            WHERE id = ?
        `
        ).run(
            currentFingerprint.deviceHash,
            JSON.stringify(currentFingerprint.vector),
            usedDeviceName,
            currentFingerprint.platform,
            appVersion,
            existingMatch.row.id
        );

        db.prepare('UPDATE licenses SET last_validated_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
            now,
            license.id
        );

        eventLog(db, license.id, existingMatch.mode === 'fuzzy' ? 'device_reinstall_merged' : 'device_revalidated', {
            activationId: existingMatch.row.id,
            matchMode: existingMatch.mode,
            matchScore: existingMatch.score
        });

        pushOwnerSyncEvent('activation', {
            trigger: existingMatch.mode === 'fuzzy' ? 'reinstall_merge' : 'reactivation',
            matchMode: existingMatch.mode,
            matchScore: existingMatch.score
        });

        return {
            success: true,
            message:
                existingMatch.mode === 'fuzzy'
                    ? 'Existing device was recognized after reinstall'
                    : 'Device re-activated',
            status: getLicenseStatus()
        };
    }

    const maxDevices = getPlanMaxDevices(db, decoded.payload.planCode);
    if (activeRows.length >= maxDevices) {
        eventLog(db, license.id, 'activation_denied_limit', {
            maxDevices,
            activeDevices: activeRows.length
        });

        return {
            success: false,
            code: 'DEVICE_LIMIT_REACHED',
            error: `Device limit reached for ${decoded.payload.planCode} (${maxDevices})`,
            maxDevices,
            activeDevices: activeRows.length,
            devices: activeRows.map((row) => ({
                id: row.id,
                deviceName: row.device_name || 'Unnamed device',
                lastSeenAt: row.last_seen_at
            }))
        };
    }

    const insertActivation = db.prepare(
        `
        INSERT INTO license_activations(
            license_id,
            device_hash,
            fingerprint_vector,
            device_name,
            os_platform,
            app_version,
            first_seen_at,
            last_seen_at
        )
        VALUES(?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `
    );

    insertActivation.run(
        license.id,
        currentFingerprint.deviceHash,
        JSON.stringify(currentFingerprint.vector),
        usedDeviceName,
        currentFingerprint.platform,
        appVersion
    );

    db.prepare('UPDATE licenses SET last_validated_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        now,
        license.id
    );
    eventLog(db, license.id, 'device_activated', {
        deviceName: usedDeviceName,
        platform: currentFingerprint.platform
    });

    pushOwnerSyncEvent('activation', {
        trigger: 'new_activation',
        deviceName: usedDeviceName,
        platform: currentFingerprint.platform
    });

    return {
        success: true,
        message: 'License activated successfully',
        status: getLicenseStatus()
    };
}

function listLicenseDevices() {
    const db = getDb();
    const license = getLicenseWithPlan(db);
    if (!license) {
        return { success: true, devices: [] };
    }

    const currentFingerprint = collectCurrentFingerprint();
    const rows = db
        .prepare(
            `
            SELECT *
            FROM license_activations
            WHERE license_id = ? AND revoked_at IS NULL
            ORDER BY last_seen_at DESC
        `
        )
        .all(license.id);

    const devices = rows.map((row) => {
        const vector = parseStoredVector(row.fingerprint_vector);
        const score =
            row.device_hash === currentFingerprint.deviceHash
                ? 100
                : scoreVectorMatch(vector, currentFingerprint.vector);
        return {
            id: row.id,
            deviceName: row.device_name || 'Unnamed device',
            platform: row.os_platform || '-',
            firstSeenAt: row.first_seen_at,
            lastSeenAt: row.last_seen_at,
            isCurrentDevice: score >= REINSTALL_MATCH_THRESHOLD,
            matchScore: score
        };
    });

    return { success: true, devices };
}

function deactivateCurrentDevice() {
    const db = getDb();
    const license = getLicenseWithPlan(db);
    if (!license) {
        return { success: false, error: 'No active license found', code: 'NO_LICENSE' };
    }

    const currentFingerprint = collectCurrentFingerprint();
    const activeRows = db
        .prepare(
            `
            SELECT *
            FROM license_activations
            WHERE license_id = ? AND revoked_at IS NULL
            ORDER BY last_seen_at DESC
        `
        )
        .all(license.id);

    const match = findCurrentActivation(activeRows, currentFingerprint);
    if (!match?.row) {
        return { success: false, error: 'Current device is not activated', code: 'DEVICE_NOT_FOUND' };
    }

    db.prepare('UPDATE license_activations SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?').run(match.row.id);
    eventLog(db, license.id, 'device_deactivated', {
        activationId: match.row.id,
        matchMode: match.mode,
        matchScore: match.score
    });

    pushOwnerSyncEvent('deactivation', {
        trigger: 'current_device_deactivated',
        activationId: match.row.id,
        matchScore: match.score
    });

    return {
        success: true,
        message: 'Current device deactivated',
        status: getLicenseStatus()
    };
}

function adminRevokeDevice(activationId) {
    const db = getDb();
    const license = getLicenseWithPlan(db);
    if (!license) {
        return { success: false, error: 'No active license found', code: 'NO_LICENSE' };
    }

    const id = Number(activationId);
    if (!Number.isInteger(id) || id <= 0) {
        return { success: false, error: 'Invalid device id', code: 'INVALID_DEVICE_ID' };
    }

    const activation = db
        .prepare(
            `
            SELECT *
            FROM license_activations
            WHERE id = ? AND license_id = ? AND revoked_at IS NULL
            LIMIT 1
        `
        )
        .get(id, license.id);

    if (!activation) {
        return { success: false, error: 'Device not found or already revoked', code: 'DEVICE_NOT_FOUND' };
    }

    db.prepare('UPDATE license_activations SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    eventLog(db, license.id, 'admin_device_revoked', {
        activationId: id,
        deviceName: activation.device_name || 'Unnamed device'
    });

    pushOwnerSyncEvent('deactivation', {
        trigger: 'admin_device_revoked',
        activationId: id,
        deviceName: activation.device_name || 'Unnamed device'
    });

    return {
        success: true,
        message: 'Device revoked successfully',
        status: getLicenseStatus()
    };
}

function refreshLicenseValidation() {
    const db = getDb();
    const license = getLicenseWithPlan(db);
    if (!license) {
        return { success: false, error: 'No active license found', code: 'NO_LICENSE' };
    }

    db.prepare('UPDATE licenses SET last_validated_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        nowIso(),
        license.id
    );
    eventLog(db, license.id, 'validation_refreshed', {});
    pushOwnerSyncEvent('validation', { trigger: 'manual_validation_refresh' });

    return {
        success: true,
        message: 'License validation refreshed',
        status: getLicenseStatus()
    };
}

function getPlanLimits() {
    const db = getDb();
    const rows = db.prepare('SELECT code, name, max_devices FROM license_plans ORDER BY code').all();
    return {
        success: true,
        plans: rows.map((row) => ({
            code: row.code,
            name: row.name,
            maxDevices: Number(row.max_devices || 0)
        }))
    };
}

module.exports = {
    activateLicense,
    adminRevokeDevice,
    deactivateCurrentDevice,
    getActivationRequest,
    getLicenseStatus,
    getPublicActivationStatus,
    generateSerialKey,
    getPlanLimits,
    listLicenseDevices,
    refreshLicenseValidation
};
