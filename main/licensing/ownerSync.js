const { app } = require('electron');

const { getDb } = require('../db/context');
const { collectCurrentFingerprint } = require('./deviceFingerprint');
const { OWNER_SYNC_DEFAULTS } = require('./ownerSyncDefaults');
const { nowIso, safeJsonParse } = require('./utils');
const { licenseBus } = require('./eventBus');

const DEFAULT_HEARTBEAT_MINUTES = 360;
const MAX_HEARTBEAT_MINUTES = 24 * 60;
const OWNER_SYNC_EVENT_ENDPOINTS = {
    startup: '/api/telemetry/register',
    activation: '/api/telemetry/register',
    heartbeat: '/api/telemetry/heartbeat',
    validation: '/api/telemetry/heartbeat',
    deactivation: '/api/telemetry/heartbeat'
};

let _syncTimer = null;
let _flushRunning = false;

function toBool(value) {
    return Number(value || 0) === 1;
}

function clampHeartbeatMinutes(value) {
    const minutes = Number(value);
    if (!Number.isFinite(minutes) || minutes <= 0) return DEFAULT_HEARTBEAT_MINUTES;
    return Math.max(5, Math.min(MAX_HEARTBEAT_MINUTES, Math.round(minutes)));
}

function normalizeServerUrl(value) {
    const url = String(value || '')
        .trim()
        .replace(/\/+$/, '');
    if (url && !url.startsWith('https://') && !url.startsWith('http://localhost')) {
        return '';
    }
    return url;
}

function getBootstrapDefaults() {
    const serverUrl = normalizeServerUrl(process.env.OWNER_SYNC_URL || OWNER_SYNC_DEFAULTS.serverUrl || '');
    const fallbackToken = String(process.env.OWNER_SYNC_TOKEN || OWNER_SYNC_DEFAULTS.ownerToken || '').trim();
    const writeToken = String(
        process.env.OWNER_SYNC_WRITE_TOKEN || OWNER_SYNC_DEFAULTS.writeToken || fallbackToken || ''
    ).trim();
    const readToken = String(
        process.env.OWNER_SYNC_READ_TOKEN || OWNER_SYNC_DEFAULTS.readToken || fallbackToken || ''
    ).trim();
    const heartbeatIntervalMinutes = clampHeartbeatMinutes(
        process.env.OWNER_SYNC_HEARTBEAT_MINUTES || OWNER_SYNC_DEFAULTS.heartbeatIntervalMinutes
    );

    let enabled;
    if (process.env.OWNER_SYNC_ENABLED !== undefined) {
        enabled =
            String(process.env.OWNER_SYNC_ENABLED) === '1' ||
            String(process.env.OWNER_SYNC_ENABLED).toLowerCase() === 'true';
    } else if (OWNER_SYNC_DEFAULTS.enabled !== undefined) {
        enabled = !!OWNER_SYNC_DEFAULTS.enabled;
    } else {
        enabled = false;
    }

    if (!serverUrl || !writeToken) {
        enabled = false;
    }

    return {
        serverUrl,
        writeToken,
        readToken,
        enabled,
        heartbeatIntervalMinutes
    };
}

function normalizeOwnerSyncConfig(row = {}) {
    const fallbackToken = String(row.owner_token || '').trim();
    const writeToken = String(row.write_token || '').trim() || fallbackToken;
    const readToken = String(row.read_token || '').trim() || fallbackToken || writeToken;

    return {
        serverUrl: normalizeServerUrl(row.server_url),
        ownerToken: fallbackToken,
        writeToken,
        readToken,
        enabled: toBool(row.enabled),
        heartbeatIntervalMinutes: clampHeartbeatMinutes(row.heartbeat_interval_minutes),
        lastSyncAt: row.last_sync_at || null,
        lastError: row.last_error || null
    };
}

function readConfigRow(db) {
    const defaults = getBootstrapDefaults();
    const row = db.prepare('SELECT * FROM owner_sync_config WHERE id = 1 LIMIT 1').get();
    if (row) {
        const shouldHydrate =
            (!String(row.server_url || '').trim() && !!defaults.serverUrl) ||
            (!String(row.owner_token || '').trim() && (!!defaults.writeToken || !!defaults.readToken)) ||
            (!String(row.write_token || '').trim() && !!defaults.writeToken) ||
            (!String(row.read_token || '').trim() && !!defaults.readToken) ||
            Number(row.heartbeat_interval_minutes || 0) <= 0;

        if (shouldHydrate) {
            db.prepare(
                `
                    UPDATE owner_sync_config
                    SET
                        server_url = CASE WHEN trim(COALESCE(server_url, '')) = '' THEN ? ELSE server_url END,
                        owner_token = CASE WHEN trim(COALESCE(owner_token, '')) = '' THEN ? ELSE owner_token END,
                        write_token = CASE WHEN trim(COALESCE(write_token, '')) = '' THEN ? ELSE write_token END,
                        read_token = CASE WHEN trim(COALESCE(read_token, '')) = '' THEN ? ELSE read_token END,
                        enabled = CASE
                            WHEN trim(COALESCE(server_url, '')) = '' OR trim(COALESCE(write_token, '')) = '' THEN ?
                            ELSE enabled
                        END,
                        heartbeat_interval_minutes = CASE
                            WHEN heartbeat_interval_minutes IS NULL OR heartbeat_interval_minutes <= 0 THEN ?
                            ELSE heartbeat_interval_minutes
                        END,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = 1
                `
            ).run(
                defaults.serverUrl,
                defaults.writeToken || defaults.readToken,
                defaults.writeToken,
                defaults.readToken,
                defaults.enabled ? 1 : 0,
                defaults.heartbeatIntervalMinutes
            );
            return db.prepare('SELECT * FROM owner_sync_config WHERE id = 1 LIMIT 1').get();
        }

        return row;
    }

    db.prepare(
        `
            INSERT OR IGNORE INTO owner_sync_config(
                id,
                server_url,
                owner_token,
                write_token,
                read_token,
                enabled,
                heartbeat_interval_minutes
            )
            VALUES(1, ?, ?, ?, ?, ?, ?)
        `
    ).run(
        defaults.serverUrl,
        defaults.writeToken || defaults.readToken,
        defaults.writeToken,
        defaults.readToken,
        defaults.enabled ? 1 : 0,
        defaults.heartbeatIntervalMinutes
    );

    return db.prepare('SELECT * FROM owner_sync_config WHERE id = 1 LIMIT 1').get();
}

function getOwnerSyncConfig() {
    const db = getDb();
    const row = readConfigRow(db);
    return {
        success: true,
        config: normalizeOwnerSyncConfig(row)
    };
}

function getCurrentLicenseSnapshot(db, deviceHash) {
    const license = db
        .prepare(
            `
            SELECT l.*, p.name AS plan_name
            FROM licenses l
            LEFT JOIN license_plans p ON p.code = l.plan_code
            WHERE l.status != 'revoked'
            ORDER BY l.id DESC
            LIMIT 1
        `
        )
        .get();

    if (!license) {
        return {
            activated: false,
            status: 'not_activated',
            planCode: null,
            planName: null,
            keyHint: '',
            customerRef: '',
            expiresAt: null
        };
    }

    const metadata = safeJsonParse(license.metadata || '{}', {});
    const expiresAtDate = license.expires_at ? new Date(license.expires_at) : null;
    const isExpired = !!(
        expiresAtDate &&
        !Number.isNaN(expiresAtDate.getTime()) &&
        expiresAtDate.getTime() < Date.now()
    );

    const activation = db
        .prepare(
            `
            SELECT id
            FROM license_activations
            WHERE license_id = ?
              AND device_hash = ?
              AND revoked_at IS NULL
            LIMIT 1
        `
        )
        .get(license.id, deviceHash);

    let status = 'active';
    if (license.status === 'suspended') status = 'suspended';
    else if (license.status === 'inactive') status = 'inactive';
    else if (license.status === 'revoked') status = 'revoked';
    else if (isExpired) status = 'expired';
    else if (!activation) status = 'device_not_activated';

    return {
        activated: status === 'active',
        status,
        planCode: license.plan_code || null,
        planName: license.plan_name || license.plan_code || null,
        keyHint: license.key_hint || '',
        customerRef: String(metadata.customerRef || ''),
        expiresAt: license.expires_at || null
    };
}

function buildOwnerTelemetryPayload(extra = {}) {
    const db = getDb();
    const fingerprint = collectCurrentFingerprint();
    const license = getCurrentLicenseSnapshot(db, fingerprint.deviceHash);

    return {
        deviceCode: fingerprint.deviceHash,
        deviceName: fingerprint.deviceName,
        platform: fingerprint.platform,
        appVersion: app.getVersion(),
        activated: !!license.activated,
        licenseStatus: license.status,
        planCode: license.planCode,
        planName: license.planName,
        keyHint: license.keyHint,
        customerRef: license.customerRef,
        expiresAt: license.expiresAt,
        eventAt: nowIso(),
        ...extra
    };
}

function enqueueOwnerSyncEvent(eventType = 'heartbeat', extraPayload = {}) {
    const db = getDb();
    const payload = buildOwnerTelemetryPayload(extraPayload);

    db.prepare(
        `
            INSERT INTO owner_sync_outbox(event_type, payload, status, retries)
            VALUES(?, ?, 'pending', 0)
        `
    ).run(String(eventType || 'heartbeat'), JSON.stringify(payload));

    return { success: true };
}

async function fetchWithToken(url, token, options = {}) {
    const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            'x-owner-token': token,
            ...(options.headers || {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });

    const text = await response.text();
    const json = text ? safeJsonParse(text, null) : null;

    if (!response.ok) {
        const message = json?.error || `HTTP ${response.status}`;
        throw new Error(message);
    }

    return json || { success: true };
}

function resolveEventEndpoint(eventType) {
    return OWNER_SYNC_EVENT_ENDPOINTS[eventType] || OWNER_SYNC_EVENT_ENDPOINTS.heartbeat;
}

function writeConfigSyncMeta({ lastSyncAt = null, lastError = null } = {}) {
    const db = getDb();
    db.prepare(
        `
            UPDATE owner_sync_config
            SET
                last_sync_at = ?,
                last_error = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = 1
        `
    ).run(lastSyncAt, lastError);
}

async function flushOwnerSyncOutbox(limit = 30) {
    if (_flushRunning) {
        return { success: true, skipped: true, reason: 'already_running' };
    }
    _flushRunning = true;

    try {
        const db = getDb();
        const config = normalizeOwnerSyncConfig(readConfigRow(db));

        if (!config.enabled) {
            return { success: true, skipped: true, reason: 'disabled' };
        }
        if (!config.serverUrl || !config.writeToken) {
            writeConfigSyncMeta({ lastError: 'Missing owner sync server URL or write token' });
            return {
                success: false,
                error: 'Missing owner sync server URL or write token',
                code: 'OWNER_SYNC_CONFIG_MISSING'
            };
        }

        const pendingRows = db
            .prepare(
                `
                SELECT *
                FROM owner_sync_outbox
                WHERE status = 'pending'
                ORDER BY id ASC
                LIMIT ?
            `
            )
            .all(Number(limit) || 30);

        let sentCount = 0;
        let failedCount = 0;
        let lastError = null;

        for (const row of pendingRows) {
            const payload = safeJsonParse(row.payload || '{}', {});
            const endpointPath = resolveEventEndpoint(row.event_type);
            const targetUrl = `${config.serverUrl}${endpointPath}`;

            db.prepare(
                `
                    UPDATE owner_sync_outbox
                    SET retries = retries + 1, last_attempt_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `
            ).run(row.id);

            try {
                await fetchWithToken(targetUrl, config.writeToken, {
                    method: 'POST',
                    body: payload
                });

                db.prepare(
                    `
                        UPDATE owner_sync_outbox
                        SET
                            status = 'sent',
                            sent_at = CURRENT_TIMESTAMP,
                            last_error = NULL
                        WHERE id = ?
                    `
                ).run(row.id);

                sentCount += 1;
            } catch (err) {
                lastError = err.message;
                db.prepare(
                    `
                        UPDATE owner_sync_outbox
                        SET last_error = ?
                        WHERE id = ?
                    `
                ).run(lastError, row.id);
                failedCount += 1;
            }
        }

        writeConfigSyncMeta({
            lastSyncAt: sentCount > 0 ? nowIso() : null,
            lastError
        });

        return {
            success: failedCount === 0,
            sentCount,
            failedCount,
            pendingCount:
                db.prepare(`SELECT COUNT(*) AS c FROM owner_sync_outbox WHERE status = 'pending'`).get().c || 0,
            lastError
        };
    } finally {
        _flushRunning = false;
    }
}

async function getOwnerTelemetryOverview() {
    const db = getDb();
    const config = normalizeOwnerSyncConfig(readConfigRow(db));
    const readToken = config.readToken || config.writeToken;
    if (!config.enabled || !config.serverUrl || !readToken) {
        return { success: false, code: 'OWNER_SYNC_CONFIG_MISSING', error: 'Owner sync is not configured' };
    }

    return fetchWithToken(`${config.serverUrl}/api/telemetry/overview`, readToken, { method: 'GET' });
}

async function getOwnerTelemetryDevices(limit = 100) {
    const db = getDb();
    const config = normalizeOwnerSyncConfig(readConfigRow(db));
    const readToken = config.readToken || config.writeToken;
    if (!config.enabled || !config.serverUrl || !readToken) {
        return { success: false, code: 'OWNER_SYNC_CONFIG_MISSING', error: 'Owner sync is not configured' };
    }

    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    return fetchWithToken(`${config.serverUrl}/api/telemetry/devices?limit=${safeLimit}`, readToken, { method: 'GET' });
}

async function syncOwnerTelemetryNow() {
    enqueueOwnerSyncEvent('heartbeat', { trigger: 'manual_sync' });
    return flushOwnerSyncOutbox();
}

function stopOwnerSyncBackground() {
    if (_syncTimer) {
        clearInterval(_syncTimer);
        _syncTimer = null;
    }
}

function startOwnerSyncBackground() {
    if (_syncTimer) return;

    const db = getDb();
    const config = normalizeOwnerSyncConfig(readConfigRow(db));
    if (!config.enabled || !config.serverUrl || !config.writeToken) {
        return;
    }

    enqueueOwnerSyncEvent('startup', { trigger: 'app_start' });
    void flushOwnerSyncOutbox();

    const intervalMs = clampHeartbeatMinutes(config.heartbeatIntervalMinutes) * 60 * 1000;

    _syncTimer = setInterval(() => {
        enqueueOwnerSyncEvent('heartbeat', { trigger: 'interval' });
        void flushOwnerSyncOutbox();
    }, intervalMs);

    if (typeof _syncTimer.unref === 'function') {
        _syncTimer.unref();
    }
}

function restartOwnerSyncBackground() {
    stopOwnerSyncBackground();
    startOwnerSyncBackground();
}

function initSyncListeners() {
    licenseBus.on('license:activated', (details) => {
        enqueueOwnerSyncEvent('activation', details);
        void flushOwnerSyncOutbox();
    });

    licenseBus.on('license:deactivated', (details) => {
        enqueueOwnerSyncEvent('deactivation', details);
        void flushOwnerSyncOutbox();
    });

    licenseBus.on('license:validated', (details) => {
        enqueueOwnerSyncEvent('validation', details);
        void flushOwnerSyncOutbox();
    });
}

module.exports = {
    enqueueOwnerSyncEvent,
    flushOwnerSyncOutbox,
    getOwnerSyncConfig,
    getOwnerTelemetryDevices,
    getOwnerTelemetryOverview,
    initSyncListeners,
    restartOwnerSyncBackground,
    startOwnerSyncBackground,
    stopOwnerSyncBackground,
    syncOwnerTelemetryNow
};
