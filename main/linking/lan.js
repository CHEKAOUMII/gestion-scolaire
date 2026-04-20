'use strict';

const dgram = require('dgram');
const http = require('http');
const os = require('os');
const { verifyOtp, getActiveOtp, validateMassarCode } = require('./otp');
const { getLanBroadcastAddresses } = require('./network');
const { applySyncDefaults } = require('../sync/defaults');

// -- Constants --
const UDP_BROADCAST_PORT = 19877;
const HTTP_SERVER_PORT = 19876;
const BEACON_INTERVAL_MS = 3000;
const BEACON_SERVICE_ID = 'pencil2-link';
const MAX_REQUEST_BODY_BYTES = 4096;
const HTTP_CLIENT_TIMEOUT_MS = 10000;
const DEFAULT_DISCOVERY_TIMEOUT_MS = 5000;

// -- Module state (all reset to null by stopLinkingServer) --
let httpServer = null;
let udpSocket = null;
let broadcastTimer = null;
let expiryTimer = null;
let activeMassar = null;
let activeDb = null;
let activeExpiresAt = null;

function buildBeaconMessage(massarCode, port) {
    const message = JSON.stringify({
        service: BEACON_SERVICE_ID,
        massar: massarCode,
        port: port,
        deviceName: os.hostname()
    });
    return Buffer.from(message);
}

function readActiveLicenseKey(db) {
    try {
        const syncRow = db.prepare('SELECT license_key FROM sync_config WHERE id = 1').get();
        const syncKey = String(syncRow?.license_key || '').trim();
        if (syncKey) {
            return syncKey;
        }
    } catch {
        // ignore and fall through
    }

    try {
        const licenseRow = db
            .prepare("SELECT license_key FROM licenses WHERE status != 'revoked' ORDER BY id DESC LIMIT 1")
            .get();
        const licenseKey = String(licenseRow?.license_key || '').trim();
        return licenseKey || null;
    } catch {
        return null;
    }
}

function buildLinkBootstrapPayload(db) {
    const syncRow = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
    const instRow = db.prepare('SELECT massar_code, institution_name FROM institution_config WHERE id = 1').get();
    const licenseKey = readActiveLicenseKey(db);
    const syncDefaults = applySyncDefaults(syncRow || {});
    const syncConfig = {
        schoolId: syncRow?.school_id || instRow?.massar_code || null,
        firebaseFunctionsUrl: syncDefaults.firebaseFunctionsUrl,
        firebaseProjectId: syncDefaults.firebaseProjectId,
        syncIntervalMinutes: syncRow?.sync_interval_minutes ?? 10,
        enabled: !!(syncRow?.enabled ?? 0),
        licenseKey
    };

    const institution = instRow
        ? {
              massarCode: instRow.massar_code,
              institutionName: instRow.institution_name || null
          }
        : null;

    const users = db
        .prepare(
            `
            SELECT name, email, role, password_hash, pin_hash, must_change_password
            FROM users
            WHERE disabled = 0
        `
        )
        .all()
        .map((row) => ({
            name: row.name,
            email: row.email,
            role: row.role,
            passwordHash: row.password_hash,
            pinHash: row.pin_hash,
            mustChangePassword: !!row.must_change_password
        }));

    return { syncConfig, institution, users };
}

function registerLinkedDevice(db, deviceHash, deviceName) {
    const now = new Date().toISOString();
    const platform = process.platform;
    let appVersion = null;

    try {
        const { app } = require('electron');
        appVersion = app.getVersion();
    } catch {
        appVersion = 'unknown';
    }

    db.prepare(
        `
        INSERT INTO linked_devices (device_hash, device_name, os_platform, app_version, linked_by, linked_at, last_seen_at, status)
        VALUES (?, ?, ?, ?, 'otp_lan', ?, ?, 'active')
        ON CONFLICT(device_hash) DO UPDATE SET
            device_name = excluded.device_name,
            os_platform = excluded.os_platform,
            app_version = excluded.app_version,
            linked_by = excluded.linked_by,
            linked_at = excluded.linked_at,
            last_seen_at = excluded.last_seen_at,
            status = excluded.status,
            revoked_at = NULL
    `
    ).run(deviceHash, deviceName, platform, appVersion, now, now);
}

function sendJsonResponse(res, statusCode, body) {
    const payload = JSON.stringify(body);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
    });
    res.end(payload);
}

function collectRequestBody(req, maxBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let totalBytes = 0;

        req.on('data', (chunk) => {
            totalBytes += chunk.length;
            if (totalBytes > maxBytes) {
                req.destroy();
                reject(new Error('REQUEST_TOO_LARGE'));
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => {
            resolve(Buffer.concat(chunks).toString('utf8'));
        });

        req.on('error', (err) => {
            reject(err);
        });
    });
}

function isJsonContentType(contentType) {
    if (typeof contentType !== 'string') {
        return false;
    }

    return contentType.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

function waitForHttpServerListen(server, port, address) {
    return new Promise((resolve, reject) => {
        const onError = (err) => {
            server.off('error', onError);
            reject(new Error('Failed to start HTTP server: ' + err.message));
        };

        server.once('error', onError);
        server.listen(port, address, () => {
            server.off('error', onError);
            resolve();
        });
    });
}

function waitForUdpSocketBind(socket, port, enableBroadcast) {
    return new Promise((resolve, reject) => {
        const onError = (err) => {
            socket.off('error', onError);
            reject(new Error('Failed to start UDP socket: ' + err.message));
        };

        socket.once('error', onError);
        socket.bind(port, () => {
            socket.off('error', onError);

            try {
                if (enableBroadcast) {
                    socket.setBroadcast(true);
                }
            } catch (err) {
                reject(new Error('Failed to configure UDP socket: ' + err.message));
                return;
            }

            resolve();
        });
    });
}

function stopLinkingServer() {
    if (broadcastTimer) {
        clearInterval(broadcastTimer);
        broadcastTimer = null;
    }

    if (expiryTimer) {
        clearTimeout(expiryTimer);
        expiryTimer = null;
    }

    if (udpSocket) {
        try {
            udpSocket.close();
        } catch {
            // Socket may already be closed - ignore
        }
        udpSocket = null;
    }

    if (httpServer) {
        try {
            httpServer.close();
        } catch {
            // Server may already be closed - ignore
        }
        httpServer = null;
    }

    activeMassar = null;
    activeDb = null;
    activeExpiresAt = null;
}

function getLinkingServerStatus() {
    if (!activeMassar || !activeDb || !httpServer || !udpSocket || !activeExpiresAt) {
        return { active: false, massarCode: null, expiresAt: null, remainingSeconds: 0, port: null };
    }

    const expiresAtMs = new Date(activeExpiresAt).getTime();
    if (!Number.isFinite(expiresAtMs) || Date.now() >= expiresAtMs) {
        stopLinkingServer();
        return { active: false, massarCode: null, expiresAt: null, remainingSeconds: 0, port: null };
    }

    return {
        active: true,
        massarCode: activeMassar,
        expiresAt: activeExpiresAt,
        remainingSeconds: Math.ceil((expiresAtMs - Date.now()) / 1000),
        port: HTTP_SERVER_PORT
    };
}

async function handleVerifyRequest(req, res) {
    if (req.method !== 'POST' || req.url !== '/verify-link') {
        sendJsonResponse(res, 404, { success: false, error: 'NOT_FOUND' });
        return;
    }

    if (!isJsonContentType(req.headers['content-type'])) {
        sendJsonResponse(res, 400, { success: false, error: 'INVALID_REQUEST' });
        return;
    }

    let rawBody;
    try {
        rawBody = await collectRequestBody(req, MAX_REQUEST_BODY_BYTES);
    } catch (err) {
        if (err.message === 'REQUEST_TOO_LARGE') {
            sendJsonResponse(res, 413, { success: false, error: 'REQUEST_TOO_LARGE' });
        } else {
            sendJsonResponse(res, 400, { success: false, error: 'INVALID_REQUEST' });
        }
        return;
    }

    let body;
    try {
        body = JSON.parse(rawBody);
    } catch {
        sendJsonResponse(res, 400, { success: false, error: 'INVALID_REQUEST' });
        return;
    }

    const { massar, otp, deviceHash, deviceName } = body;
    const trimmedDeviceHash = typeof deviceHash === 'string' ? deviceHash.trim() : '';
    const trimmedDeviceName = typeof deviceName === 'string' ? deviceName.trim() : '';

    if (
        !massar ||
        typeof massar !== 'string' ||
        !otp ||
        typeof otp !== 'string' ||
        typeof deviceHash !== 'string' ||
        typeof deviceName !== 'string' ||
        !trimmedDeviceHash ||
        !trimmedDeviceName
    ) {
        sendJsonResponse(res, 400, { success: false, error: 'INVALID_REQUEST' });
        return;
    }

    if (!activeMassar || !activeDb) {
        sendJsonResponse(res, 400, { success: false, error: 'NO_ACTIVE_OTP' });
        return;
    }

    const validation = validateMassarCode(massar);
    if (!validation.valid || validation.normalized !== activeMassar) {
        sendJsonResponse(res, 403, { success: false, error: 'MASSAR_MISMATCH' });
        return;
    }

    const result = verifyOtp(activeDb, validation.normalized, otp, trimmedDeviceHash);

    if (!result.valid) {
        const statusMap = {
            RATE_LIMITED: 429,
            NO_ACTIVE_OTP: 400,
            OTP_CANCELLED: 410,
            OTP_EXPIRED: 400,
            OTP_USED: 410,
            INVALID_OTP: 401
        };
        const status = statusMap[result.error] || 400;
        sendJsonResponse(res, status, { success: false, error: result.error });
        return;
    }

    registerLinkedDevice(activeDb, trimmedDeviceHash, trimmedDeviceName);

    const payload = buildLinkBootstrapPayload(activeDb);
    sendJsonResponse(res, 200, {
        success: true,
        syncConfig: payload.syncConfig,
        institution: payload.institution,
        users: payload.users
    });

    setImmediate(() => {
        stopLinkingServer();
    });
}

async function startLinkingServer(db) {
    stopLinkingServer();

    const instRow = db.prepare('SELECT massar_code FROM institution_config WHERE id = 1').get();
    if (!instRow || !instRow.massar_code) {
        throw new Error('No institution configured - cannot start linking server');
    }

    const validation = validateMassarCode(instRow.massar_code);
    if (!validation.valid) {
        throw new Error('Invalid MASSAR code in institution_config');
    }
    const massarCode = validation.normalized;

    const otpStatus = getActiveOtp(db, massarCode);
    if (!otpStatus.active) {
        throw new Error('No active OTP - generate an OTP before starting the linking server');
    }

    activeMassar = massarCode;
    activeDb = db;

    httpServer = http.createServer((req, res) => {
        handleVerifyRequest(req, res).catch(() => {
            try {
                sendJsonResponse(res, 500, { success: false, error: 'INTERNAL_ERROR' });
            } catch {
                // Response may already be sent - ignore
            }
        });
    });

    udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    try {
        await waitForHttpServerListen(httpServer, HTTP_SERVER_PORT, '0.0.0.0');
        await waitForUdpSocketBind(udpSocket, 0, true);
    } catch (err) {
        stopLinkingServer();
        throw err;
    }

    httpServer.on('error', () => {
        stopLinkingServer();
    });

    udpSocket.on('error', () => {
        stopLinkingServer();
    });

    const beaconBuffer = buildBeaconMessage(massarCode, HTTP_SERVER_PORT);
    broadcastTimer = setInterval(() => {
        try {
            const broadcastAddrs = getLanBroadcastAddresses();
            for (const addr of broadcastAddrs) {
                udpSocket.send(beaconBuffer, 0, beaconBuffer.length, UDP_BROADCAST_PORT, addr);
            }
        } catch {
            // Socket may have been closed - ignore
        }
    }, BEACON_INTERVAL_MS);

    const remainingMs = otpStatus.remainingSeconds * 1000;
    activeExpiresAt = otpStatus.expiresAt || new Date(Date.now() + remainingMs).toISOString();
    expiryTimer = setTimeout(() => {
        stopLinkingServer();
    }, remainingMs);

    return { port: HTTP_SERVER_PORT, address: '0.0.0.0' };
}

function discoverLanDevices(massarCode, timeoutMs) {
    const validation = validateMassarCode(massarCode);
    if (!validation.valid) {
        throw new Error('Invalid MASSAR code format');
    }
    const normalizedMassar = validation.normalized;

    const timeout = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : DEFAULT_DISCOVERY_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
        const discovered = new Map();
        let settled = false;

        const finish = (devices) => {
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(timer);

            try {
                socket.close();
            } catch {
                // ignore
            }

            resolve(devices);
        };

        let socket;
        try {
            socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        } catch (err) {
            reject(new Error('Failed to create UDP socket for discovery: ' + err.message));
            return;
        }

        const timer = setTimeout(() => {
            finish(Array.from(discovered.values()));
        }, timeout);

        socket.on('error', () => {
            finish(Array.from(discovered.values()));
        });

        socket.on('message', (msg, rinfo) => {
            let beacon;
            try {
                beacon = JSON.parse(msg.toString('utf8'));
            } catch {
                return;
            }

            if (
                beacon.service !== BEACON_SERVICE_ID ||
                typeof beacon.massar !== 'string' ||
                typeof beacon.port !== 'number' ||
                typeof beacon.deviceName !== 'string'
            ) {
                return;
            }

            if (beacon.massar.toUpperCase() !== normalizedMassar) {
                return;
            }

            if (!discovered.has(rinfo.address)) {
                discovered.set(rinfo.address, {
                    ip: rinfo.address,
                    port: beacon.port,
                    deviceName: beacon.deviceName
                });
            }
        });

        socket.bind(UDP_BROADCAST_PORT, () => {
            // Socket is now listening for broadcast messages
        });
    });
}

function verifyViaLan(targetIp, targetPort, massar, otp, deviceHash, deviceName) {
    return new Promise((resolve, reject) => {
        const bodyObj = {
            massar: massar,
            otp: otp,
            deviceHash: deviceHash,
            deviceName: deviceName
        };
        const bodyStr = JSON.stringify(bodyObj);

        const options = {
            hostname: targetIp,
            port: targetPort,
            path: '/verify-link',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr)
            },
            timeout: HTTP_CLIENT_TIMEOUT_MS
        };

        const req = http.request(options, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                try {
                    const parsed = JSON.parse(raw);
                    resolve(parsed);
                } catch {
                    reject(new Error('Invalid JSON response from admin device'));
                }
            });
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Connection to admin device timed out'));
        });

        req.on('error', (err) => {
            reject(new Error('Failed to connect to admin device: ' + err.message));
        });

        req.write(bodyStr);
        req.end();
    });
}

module.exports = {
    buildLinkBootstrapPayload,
    startLinkingServer,
    stopLinkingServer,
    discoverLanDevices,
    verifyViaLan,
    getLinkingServerStatus
};
