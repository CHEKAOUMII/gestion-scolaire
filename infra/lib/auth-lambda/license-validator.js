const crypto = require('crypto');

const KEY_PREFIX = 'GSLK-';
const ALLOWED_PLANS = new Set(['basic', 'pro', 'business']);

function normalizeLicenseKey(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, '');
}

function safeEqual(a, b) {
    const left = Buffer.from(String(a || ''), 'utf8');
    const right = Buffer.from(String(b || ''), 'utf8');

    if (left.length !== right.length) {
        return false;
    }

    return crypto.timingSafeEqual(left, right);
}

function validateLicenseKey(rawKey, signingSecret) {
    const normalized = normalizeLicenseKey(rawKey);

    if (!normalized) {
        return { ok: false, error: 'License key is required' };
    }

    if (!normalized.toUpperCase().startsWith(KEY_PREFIX)) {
        return { ok: false, error: 'Unsupported license key format' };
    }

    const token = normalized.slice(KEY_PREFIX.length);
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return { ok: false, error: 'Malformed license key' };
    }

    const [payloadBase64, signature] = parts;
    const expectedSignature = crypto.createHmac('sha256', signingSecret).update(payloadBase64).digest('base64url');

    if (!safeEqual(signature, expectedSignature)) {
        return { ok: false, error: 'Invalid license signature' };
    }

    let payload;
    try {
        payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
    } catch (_error) {
        return { ok: false, error: 'Invalid license payload' };
    }

    const planCode = String(payload.plan || '').toLowerCase();
    if (!ALLOWED_PLANS.has(planCode)) {
        return { ok: false, error: 'Unsupported plan in license key' };
    }

    const expiresAt = payload.exp ? new Date(payload.exp) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
        return { ok: false, error: 'Invalid expiration date in license key' };
    }

    const deviceCode = String(payload.dc || '')
        .trim()
        .toLowerCase();
    if (deviceCode && !/^[a-f0-9]{64}$/.test(deviceCode)) {
        return { ok: false, error: 'Invalid device code in license key' };
    }

    return {
        ok: true,
        payload: {
            planCode,
            expiresAt: expiresAt ? expiresAt.toISOString() : null,
            customerRef: String(payload.customer || ''),
            deviceCode,
            issuedAt: payload.iat || null,
            nonce: payload.nonce || null
        }
    };
}

function isExpired(expiresAtISO) {
    if (!expiresAtISO) {
        return false;
    }

    const expiresAt = new Date(expiresAtISO);
    if (Number.isNaN(expiresAt.getTime())) {
        return false;
    }

    return expiresAt.getTime() < Date.now();
}

module.exports = {
    isExpired,
    validateLicenseKey
};
