'use strict';

const crypto = require('crypto');
const { hashPassword } = require('../auth/password');

const HKDF_SALT = 'pencil2-link-v1';
const HKDF_INFO = 'otp-payload-key';
const HKDF_KEY_LENGTH = 32;
const GCM_IV_LENGTH = 12;
const MAX_PAYLOAD_BYTES = 300 * 1024;

let activePublication = null;

function deriveEncryptionKey(otpPlaintext) {
    return Buffer.from(crypto.hkdfSync('sha256', String(otpPlaintext), HKDF_SALT, HKDF_INFO, HKDF_KEY_LENGTH));
}

function encryptPayload(key, plaintextObj) {
    const plaintext = JSON.stringify(plaintextObj);
    const iv = crypto.randomBytes(GCM_IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(plaintext, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
        ciphertext: encrypted,
        iv,
        authTag
    };
}

function decryptPayload(key, ciphertextBuf, ivBuf, authTagBuf) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuf);
    decipher.setAuthTag(authTagBuf);
    let decrypted = decipher.update(ciphertextBuf);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
}

function clearPublishedOtpState() {
    activePublication = null;
}

function getPublishedOtpStatus() {
    if (!activePublication) {
        return {
            active: false,
            expiresAt: null,
            remainingSeconds: 0,
            massarCode: null
        };
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (activePublication.expiresAtSeconds <= nowSeconds) {
        clearPublishedOtpState();
        return {
            active: false,
            expiresAt: null,
            remainingSeconds: 0,
            massarCode: null
        };
    }

    return {
        active: true,
        expiresAt: new Date(activePublication.expiresAtSeconds * 1000).toISOString(),
        remainingSeconds: activePublication.expiresAtSeconds - nowSeconds,
        massarCode: activePublication.massarCode
    };
}

async function publishOtpInternal(
    functionsUrl,
    licenseKey,
    deviceHash,
    massar,
    otpPlaintext,
    configPayload,
    rememberState
) {
    try {
        const key = deriveEncryptionKey(otpPlaintext);
        const { ciphertext, iv, authTag } = encryptPayload(key, configPayload);
        const encPayloadBase64 = ciphertext.toString('base64');
        if (Buffer.byteLength(encPayloadBase64, 'utf8') > MAX_PAYLOAD_BYTES) {
            return { success: false, error: 'Config payload too large', code: 'PAYLOAD_TOO_LARGE' };
        }

        const otpHash = hashPassword(String(otpPlaintext));
        const normalizedUrl = String(functionsUrl).trim().replace(/\/+$/, '');
        const normalizedMassar = String(massar).trim().toUpperCase();
        const response = await fetch(`${normalizedUrl}/publishOtp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                licenseKey,
                deviceHash,
                massar: normalizedMassar,
                otpHash,
                encryptedPayload: encPayloadBase64,
                iv: iv.toString('base64'),
                authTag: authTag.toString('base64')
            })
        });

        const data = await response.json();
        if (!response.ok) {
            return {
                success: false,
                error: data.message || 'Server rejected the request',
                code: data.error || 'SERVER_ERROR'
            };
        }

        const expiresAtSeconds = Number(data.expiresAt);
        if (!Number.isFinite(expiresAtSeconds) || expiresAtSeconds <= 0) {
            return {
                success: false,
                error: 'Server did not return OTP expiry',
                code: 'INVALID_SERVER_RESPONSE'
            };
        }

        if (rememberState) {
            activePublication = {
                functionsUrl: normalizedUrl,
                licenseKey,
                deviceHash,
                massarCode: normalizedMassar,
                expiresAtSeconds
            };
        }

        return { success: true, expiresAt: expiresAtSeconds };
    } catch (err) {
        return {
            success: false,
            error: 'Failed to publish OTP to server: ' + err.message,
            code: 'NETWORK_ERROR'
        };
    }
}

async function publishOtpToServer(functionsUrl, licenseKey, deviceHash, massar, otpPlaintext, configPayload) {
    return publishOtpInternal(functionsUrl, licenseKey, deviceHash, massar, otpPlaintext, configPayload, true);
}

async function cancelPublishedOtp() {
    const publishedStatus = getPublishedOtpStatus();
    if (!publishedStatus.active || !activePublication) {
        return { success: true, cancelled: false };
    }

    try {
        const url = `${String(activePublication.functionsUrl).trim().replace(/\/+$/, '')}/cancelOtp`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                licenseKey: activePublication.licenseKey,
                massar: activePublication.massarCode
            })
        });

        const data = await response.json();
        if (!response.ok) {
            return {
                success: false,
                error: data.message || 'Server rejected the request',
                code: data.error || 'SERVER_ERROR'
            };
        }
    } catch (err) {
        return {
            success: false,
            error: 'Failed to cancel OTP via server: ' + err.message,
            code: 'NETWORK_ERROR'
        };
    }

    clearPublishedOtpState();
    return { success: true, cancelled: true };
}

async function verifyOtpViaServer(functionsUrl, massar, otpPlaintext) {
    try {
        const url = String(functionsUrl).trim().replace(/\/+$/, '') + '/verifyOtp';
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                massar: String(massar).trim().toUpperCase(),
                otp: String(otpPlaintext)
            })
        });

        const data = await response.json();
        if (!response.ok) {
            return {
                success: false,
                error: data.message || 'Server rejected the request',
                code: data.error || 'SERVER_ERROR'
            };
        }

        const key = deriveEncryptionKey(otpPlaintext);
        const ciphertextBuf = Buffer.from(data.encryptedPayload, 'base64');
        const ivBuf = Buffer.from(data.iv, 'base64');
        const authTagBuf = Buffer.from(data.authTag, 'base64');

        return {
            success: true,
            configPayload: decryptPayload(key, ciphertextBuf, ivBuf, authTagBuf)
        };
    } catch (err) {
        return {
            success: false,
            error: 'Failed to verify OTP via server: ' + err.message,
            code: 'NETWORK_ERROR'
        };
    }
}

module.exports = {
    publishOtpToServer,
    verifyOtpViaServer,
    getPublishedOtpStatus,
    cancelPublishedOtp
};
