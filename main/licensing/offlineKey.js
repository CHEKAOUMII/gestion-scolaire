const crypto = require('crypto');

const KEY_PREFIX = 'GSLK-';
const DEFAULT_SIGNING_SECRET = process.env.GESTION_LICENSE_SECRET || 'gestion-scolaire-dev-secret';
const ALLOWED_PLANS = new Set(['basic', 'pro', 'business']);

function normalizeLicenseKey(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, '');
}

function toBase64Url(input) {
    return Buffer.from(input, 'utf8').toString('base64url');
}

function safeEqual(a, b) {
    const aa = Buffer.from(String(a || ''), 'utf8');
    const bb = Buffer.from(String(b || ''), 'utf8');
    if (aa.length !== bb.length) return false;
    return crypto.timingSafeEqual(aa, bb);
}

function signPayloadBase64(payloadBase64) {
    return crypto.createHmac('sha256', DEFAULT_SIGNING_SECRET).update(payloadBase64).digest('base64url');
}

function createOfflineLicenseKey({
    planCode = 'basic',
    expiresAt = null,
    customerRef = '',
    requiresOnlineValidation = false,
    deviceCode = ''
} = {}) {
    const normalizedPlan = String(planCode || '').toLowerCase();
    if (!ALLOWED_PLANS.has(normalizedPlan)) {
        throw new Error(`Unsupported plan: ${planCode}`);
    }

    const payload = {
        plan: normalizedPlan,
        exp: expiresAt || null,
        customer: String(customerRef || ''),
        ov: !!requiresOnlineValidation,
        dc: String(deviceCode || '')
            .trim()
            .toLowerCase(),
        iat: new Date().toISOString(),
        nonce: crypto.randomBytes(8).toString('hex')
    };

    const payloadBase64 = toBase64Url(JSON.stringify(payload));
    const signature = signPayloadBase64(payloadBase64);
    return `${KEY_PREFIX}${payloadBase64}.${signature}`;
}

function decodeOfflineLicenseKey(rawKey) {
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
    const expectedSignature = signPayloadBase64(payloadBase64);
    if (!safeEqual(signature, expectedSignature)) {
        return { ok: false, error: 'Invalid license signature' };
    }

    let payload;
    try {
        const payloadText = Buffer.from(payloadBase64, 'base64url').toString('utf8');
        payload = JSON.parse(payloadText);
    } catch (_err) {
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
        normalizedKey: normalized,
        payload: {
            planCode,
            expiresAt: expiresAt ? expiresAt.toISOString() : null,
            customerRef: String(payload.customer || ''),
            requiresOnlineValidation: !!payload.ov,
            deviceCode,
            issuedAt: payload.iat || null,
            nonce: payload.nonce || null
        }
    };
}

module.exports = {
    createOfflineLicenseKey,
    decodeOfflineLicenseKey,
    normalizeLicenseKey
};
