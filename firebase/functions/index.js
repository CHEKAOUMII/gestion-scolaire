'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { verifyPassword } = require('./password-utils');

admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();

/**
 * Validates a license key signed with HMAC-SHA256.
 * Key format: base64url(payload).signatureHex.version
 */
function validateLicenseKey(licenseKey, secret) {
    if (!secret) throw new Error('License validation secret not configured');

    const parts = String(licenseKey || '').split('.');
    if (parts.length !== 3) throw new Error('Invalid license key format');

    const [payloadB64, signatureHex] = parts;

    let expectedSig;
    try {
        expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
    } catch {
        throw new Error('Failed to compute license signature');
    }

    if (signatureHex.length !== expectedSig.length) throw new Error('Invalid license key signature');

    try {
        if (!crypto.timingSafeEqual(Buffer.from(signatureHex, 'hex'), Buffer.from(expectedSig, 'hex'))) {
            throw new Error('Invalid license key signature');
        }
    } catch {
        throw new Error('Invalid license key signature');
    }

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    return {
        customerRef: payload.customerRef || payload.customer,
        plan: payload.plan,
        expiresAt: payload.expiresAt || payload.exp || null
    };
}

/**
 * POST /authExchange
 * Validates licenseKey + deviceHash, mints a Firebase custom token with schoolId claim.
 * Replaces: Cognito GetOpenIdTokenForDeveloperIdentity
 */
exports.authExchange = onRequest({ cors: true }, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { licenseKey, deviceHash } = req.body || {};
    if (!licenseKey || !deviceHash) return res.status(400).json({ error: 'Missing licenseKey or deviceHash' });

    const secret = process.env.GESTION_LICENSE_SECRET || '';
    let customerRef, expiresAt;
    try {
        const result = validateLicenseKey(licenseKey, secret);
        customerRef = result.customerRef;
        expiresAt = result.expiresAt;
    } catch (err) {
        return res.status(401).json({ error: err.message });
    }

    if (expiresAt && expiresAt < Math.floor(Date.now() / 1000)) {
        return res.status(401).json({ error: 'License expired' });
    }

    const uid = `device_${deviceHash}`;
    try {
        await auth.getUser(uid);
    } catch {
        await auth.createUser({ uid, displayName: `Device ${String(deviceHash).substring(0, 8)}` });
    }

    await auth.setCustomUserClaims(uid, { schoolId: customerRef });
    const customToken = await auth.createCustomToken(uid, { schoolId: customerRef });

    return res.status(200).json({ customToken, schoolId: customerRef, expiresAt: expiresAt || null });
});

/**
 * POST /publishOtp
 * Publishes an OTP to Firestore for device linking.
 * Replaces: DynamoDB PutItem on OTP#{massar}/ACTIVE
 */
exports.publishOtp = onRequest({ cors: true }, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { licenseKey, deviceHash, massar, otpHash, encryptedPayload, iv, authTag } = req.body || {};
    if (!licenseKey || !deviceHash || !massar || !otpHash) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const secret = process.env.GESTION_LICENSE_SECRET || '';
    let customerRef;
    try {
        const result = validateLicenseKey(licenseKey, secret);
        customerRef = result.customerRef;
    } catch (err) {
        return res.status(401).json({ error: err.message });
    }

    if (massar !== customerRef) return res.status(403).json({ error: 'MASSAR_MISMATCH' });
    if (!String(otpHash).startsWith('scrypt$')) return res.status(400).json({ error: 'Invalid OTP hash format' });

    if (encryptedPayload) {
        const payloadBytes = Buffer.from(encryptedPayload, 'base64');
        if (payloadBytes.length > 300 * 1024) return res.status(400).json({ error: 'Encrypted payload too large' });
    }

    const otpRef = db.collection('otpCodes').doc(massar);
    const expiresAtDate = new Date(Date.now() + 10 * 60 * 1000);
    await otpRef.set({
        massarCode: massar,
        otpHash,
        encryptedPayload: encryptedPayload || null,
        iv: iv || null,
        authTag: authTag || null,
        status: 'active',
        failureCount: 0,
        publishedBy: deviceHash,
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAtDate),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(200).json({ success: true, expiresAt: Math.floor(expiresAtDate.getTime() / 1000) });
});

/**
 * POST /cancelOtp
 * Cancels the active OTP for device linking.
 */
exports.cancelOtp = onRequest({ cors: true }, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { licenseKey, massar } = req.body || {};
    if (!licenseKey || !massar) {
        return res.status(400).json({ error: 'Missing licenseKey or massar' });
    }

    const secret = process.env.GESTION_LICENSE_SECRET || '';
    let customerRef;
    try {
        const result = validateLicenseKey(licenseKey, secret);
        customerRef = result.customerRef;
    } catch (err) {
        return res.status(401).json({ error: err.message });
    }

    if (massar !== customerRef) {
        return res.status(403).json({ error: 'MASSAR_MISMATCH', code: 'MASSAR_MISMATCH' });
    }

    const otpRef = db.collection('otpCodes').doc(massar);
    const otpDoc = await otpRef.get();
    if (!otpDoc.exists) {
        return res.status(404).json({ error: 'NO_ACTIVE_OTP', code: 'NO_ACTIVE_OTP' });
    }

    await otpRef.update({
        status: 'cancelled',
        cancelledAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(200).json({ success: true, status: 'cancelled' });
});

/**
 * POST /verifyOtp
 * Verifies an OTP from Firestore for device linking.
 * Replaces: DynamoDB GetItem + conditional UpdateItem for OTP verification
 */
exports.verifyOtp = onRequest({ cors: true }, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { massar, otp } = req.body || {};
    if (!massar || !otp) return res.status(400).json({ error: 'Missing massar or otp' });

    const otpRef = db.collection('otpCodes').doc(massar);
    const otpDoc = await otpRef.get();

    if (!otpDoc.exists) {
        return res.status(404).json({ error: 'NO_ACTIVE_OTP', code: 'NO_ACTIVE_OTP', message: 'NO_ACTIVE_OTP' });
    }

    const otpData = otpDoc.data();
    const now = Date.now();

    if (otpData.expiresAt && otpData.expiresAt.toDate().getTime() < now) {
        return res.status(401).json({ error: 'OTP_EXPIRED', code: 'OTP_EXPIRED', message: 'OTP_EXPIRED' });
    }

    if (otpData.status !== 'active') {
        const code = otpData.status === 'used' ? 'OTP_USED' : 'OTP_CANCELLED';
        return res.status(401).json({ error: code, code, message: code });
    }

    if (otpData.failureCount >= 5) {
        return res.status(429).json({ error: 'RATE_LIMITED', code: 'RATE_LIMITED', message: 'RATE_LIMITED' });
    }

    const isValid = verifyPassword(otp, otpData.otpHash);

    if (!isValid) {
        await otpRef.update({ failureCount: admin.firestore.FieldValue.increment(1) });
        return res.status(401).json({ error: 'INVALID_OTP', code: 'INVALID_OTP', message: 'INVALID_OTP' });
    }

    await otpRef.update({ status: 'used' });

    return res.status(200).json({
        success: true,
        encryptedPayload: otpData.encryptedPayload || null,
        iv: otpData.iv || null,
        authTag: otpData.authTag || null
    });
});
