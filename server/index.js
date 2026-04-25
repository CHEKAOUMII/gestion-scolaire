const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = Number(process.env.PORT || 8787);
const OWNER_SYNC_WRITE_TOKEN = String(process.env.OWNER_SYNC_WRITE_TOKEN || process.env.OWNER_SYNC_TOKEN || 'change-me-write-token');
const OWNER_SYNC_READ_TOKEN = String(process.env.OWNER_SYNC_READ_TOKEN || process.env.OWNER_SYNC_TOKEN || OWNER_SYNC_WRITE_TOKEN);
const DB_PATH = process.env.OWNER_DB_PATH || path.join(__dirname, 'owner-telemetry.json');

function readStore() {
    try {
        if (!fs.existsSync(DB_PATH)) {
            return { devices: {}, events: [] };
        }
        const text = fs.readFileSync(DB_PATH, 'utf8');
        if (!text.trim()) return { devices: {}, events: [] };
        const parsed = JSON.parse(text);
        return {
            devices: parsed?.devices && typeof parsed.devices === 'object' ? parsed.devices : {},
            events: Array.isArray(parsed?.events) ? parsed.events : []
        };
    } catch (_err) {
        return { devices: {}, events: [] };
    }
}

function saveStore() {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2), 'utf8');
}

let store = readStore();

function sendJson(res, statusCode, payload) {
    const data = JSON.stringify(payload);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(data),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, x-owner-token',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    res.end(data);
}

const MAX_BODY_BYTES = 1_048_576; // 1 MB

function parseBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let totalBytes = 0;
        req.on('data', (chunk) => {
            totalBytes += chunk.length;
            if (totalBytes > MAX_BODY_BYTES) {
                req.destroy();
                reject(new Error('Body too large'));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (!chunks.length) {
                resolve({});
                return;
            }

            try {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                resolve(body || {});
            } catch (err) {
                reject(new Error('Invalid JSON body'));
            }
        });
        req.on('error', reject);
    });
}

function isWriteEndpoint(pathname, method) {
    return method === 'POST' && (pathname === '/api/telemetry/register' || pathname === '/api/telemetry/heartbeat');
}

function isReadEndpoint(pathname, method) {
    return method === 'GET' && (pathname === '/api/telemetry/overview' || pathname === '/api/telemetry/devices');
}

function isAuthCheckEndpoint(pathname, method) {
    return method === 'GET' && pathname === '/api/telemetry/auth-check';
}

function isAuthorized(req) {
    const token = String(req.headers['x-owner-token'] || '').trim();
    const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (isWriteEndpoint(parsed.pathname, req.method || 'GET')) {
        return token && (token === OWNER_SYNC_WRITE_TOKEN || token === OWNER_SYNC_READ_TOKEN);
    }
    if (isReadEndpoint(parsed.pathname, req.method || 'GET')) {
        return token && token === OWNER_SYNC_READ_TOKEN;
    }
    if (isAuthCheckEndpoint(parsed.pathname, req.method || 'GET')) {
        const scope = String(parsed.searchParams.get('scope') || 'read').trim().toLowerCase();
        if (scope === 'write') {
            return token && (token === OWNER_SYNC_WRITE_TOKEN || token === OWNER_SYNC_READ_TOKEN);
        }
        return token && token === OWNER_SYNC_READ_TOKEN;
    }
    return false;
}

function normalizeText(value, max = 255) {
    return String(value || '')
        .trim()
        .slice(0, max);
}

function toBoolInt(value) {
    return value ? 1 : 0;
}

function upsertDevice(eventType, payload) {
    const deviceCode = normalizeText(payload.deviceCode, 128).toLowerCase();
    if (!deviceCode) {
        throw new Error('deviceCode is required');
    }

    const row = store.devices[deviceCode] || null;
    const deviceName = normalizeText(payload.deviceName, 180);
    const platform = normalizeText(payload.platform, 80);
    const appVersion = normalizeText(payload.appVersion, 40);
    const licenseStatus = normalizeText(payload.licenseStatus, 80);
    const planCode = normalizeText(payload.planCode, 40);
    const keyHint = normalizeText(payload.keyHint, 40);
    const customerRef = normalizeText(payload.customerRef, 120);
    const serializedPayload = payload || {};
    const now = new Date().toISOString();

    if (row) {
        store.devices[deviceCode] = {
            ...row,
            deviceCode,
            deviceName,
            platform,
            appVersion,
            activated: !!payload.activated,
            licenseStatus,
            planCode,
            keyHint,
            customerRef,
            lastEventType: eventType,
            eventCount: Number(row.eventCount || 0) + 1,
            lastSeenAt: now,
            lastPayload: serializedPayload
        };
    } else {
        store.devices[deviceCode] = {
            deviceCode,
            deviceName,
            platform,
            appVersion,
            activated: !!payload.activated,
            licenseStatus,
            planCode,
            keyHint,
            customerRef,
            lastEventType: eventType,
            eventCount: 1,
            firstSeenAt: now,
            lastSeenAt: now,
            lastPayload: serializedPayload
        };
    }

    store.events.push({
        deviceCode,
        eventType,
        payload: serializedPayload,
        createdAt: now
    });

    if (store.events.length > 10000) {
        store.events = store.events.slice(store.events.length - 10000);
    }

    saveStore();

    return { deviceCode };
}

function getOverview() {
    const devices = Object.values(store.devices || {});
    const nowTs = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    const totalDevices = devices.length;
    const activatedDevices = devices.filter((device) => !!device.activated).length;
    const active24h = devices.filter((device) => {
        const ts = device.lastSeenAt ? new Date(device.lastSeenAt).getTime() : 0;
        return Number.isFinite(ts) && ts > 0 && nowTs - ts <= dayMs;
    }).length;

    const planMap = {};
    devices.forEach((device) => {
        const planCode = String(device.planCode || '').trim().toLowerCase();
        if (!planCode) return;
        planMap[planCode] = (planMap[planCode] || 0) + 1;
    });

    const byPlan = Object.entries(planMap)
        .map(([planCode, total]) => ({ planCode, total }))
        .sort((a, b) => b.total - a.total);

    return {
        success: true,
        summary: {
            totalDevices,
            activatedDevices,
            active24h
        },
        byPlan
    };
}

function getDevices(limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const rows = Object.values(store.devices || {})
        .sort((a, b) => {
            const aTs = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
            const bTs = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
            return bTs - aTs;
        })
        .slice(0, safeLimit);

    return {
        success: true,
        devices: rows.map((row) => ({
            deviceCode: row.deviceCode,
            deviceName: row.deviceName,
            platform: row.platform,
            appVersion: row.appVersion,
            activated: !!row.activated,
            licenseStatus: row.licenseStatus,
            planCode: row.planCode,
            keyHint: row.keyHint,
            customerRef: row.customerRef,
            lastEventType: row.lastEventType,
            eventCount: Number(row.eventCount || 0),
            firstSeenAt: row.firstSeenAt,
            lastSeenAt: row.lastSeenAt
        }))
    };
}

const server = http.createServer(async (req, res) => {
    const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsed.pathname;
    const method = req.method || 'GET';

    if (method === 'OPTIONS') {
        sendJson(res, 200, { success: true });
        return;
    }

    if (pathname === '/api/health' && method === 'GET') {
        sendJson(res, 200, { success: true, service: 'owner-telemetry', now: new Date().toISOString() });
        return;
    }

    if (!isAuthorized(req)) {
        sendJson(res, 401, { success: false, error: 'Unauthorized' });
        return;
    }

    try {
        if ((pathname === '/api/telemetry/register' || pathname === '/api/telemetry/heartbeat') && method === 'POST') {
            const body = await parseBody(req);
            const eventType = pathname.endsWith('/register') ? 'register' : 'heartbeat';
            const result = upsertDevice(eventType, body);
            sendJson(res, 200, { success: true, ...result });
            return;
        }

        if (pathname === '/api/telemetry/overview' && method === 'GET') {
            sendJson(res, 200, getOverview());
            return;
        }

        if (pathname === '/api/telemetry/devices' && method === 'GET') {
            sendJson(res, 200, getDevices(parsed.searchParams.get('limit')));
            return;
        }

        if (pathname === '/api/telemetry/auth-check' && method === 'GET') {
            const scope = String(parsed.searchParams.get('scope') || 'read').trim().toLowerCase();
            sendJson(res, 200, {
                success: true,
                scope: scope === 'write' ? 'write' : 'read'
            });
            return;
        }

        sendJson(res, 404, { success: false, error: 'Not found' });
    } catch (err) {
        sendJson(res, 400, { success: false, error: err.message || 'Request failed' });
    }
});

server.listen(PORT, () => {
    console.log(`[owner-telemetry] listening on http://localhost:${PORT}`);
    console.log(`[owner-telemetry] database: ${DB_PATH}`);
    if (OWNER_SYNC_WRITE_TOKEN === 'change-me-write-token') {
        console.warn('[owner-telemetry] WARNING: change OWNER_SYNC_WRITE_TOKEN in environment before production use');
    }
    if (!OWNER_SYNC_READ_TOKEN || OWNER_SYNC_READ_TOKEN === OWNER_SYNC_WRITE_TOKEN) {
        console.warn('[owner-telemetry] INFO: OWNER_SYNC_READ_TOKEN is same as write token (recommended: separate read token)');
    }
});
