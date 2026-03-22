'use strict';

const crypto = require('crypto');
const { hashPassword } = require('../auth/password');

// Encryption constants (must match between Device 1 and Device 2)
const HKDF_SALT = 'pencil2-link-v1';
const HKDF_INFO = 'otp-payload-key';
const HKDF_KEY_LENGTH = 32;
const GCM_IV_LENGTH = 12;
const MAX_PAYLOAD_BYTES = 300 * 1024;

function deriveEncryptionKey(otpPlaintext) {
    const keyMaterial = Buffer.from(
        crypto.hkdfSync('sha256', String(otpPlaintext), HKDF_SALT, HKDF_INFO, HKDF_KEY_LENGTH)
    );
    return keyMaterial;
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

async function publishOtpToServer(authLambdaUrl, licenseKey, deviceHash, massar, otpPlaintext, configPayload) {
    try {
        const key = deriveEncryptionKey(otpPlaintext);
        const { ciphertext, iv, authTag } = encryptPayload(key, configPayload);

        const encPayloadBase64 = ciphertext.toString('base64');
        if (Buffer.byteLength(encPayloadBase64, 'utf8') > MAX_PAYLOAD_BYTES) {
            return { success: false, error: 'Config payload too large', code: 'PAYLOAD_TOO_LARGE' };
        }

        const otpHash = hashPassword(String(otpPlaintext));

        const url = String(authLambdaUrl).replace(/\/+$/, '') + '/link/publish-otp';
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                licenseKey,
                deviceHash,
                massar: String(massar).trim().toUpperCase(),
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

        return { success: true, expiresAt: data.expiresAt };
    } catch (err) {
        return {
            success: false,
            error: 'Failed to publish OTP to server: ' + err.message,
            code: 'NETWORK_ERROR'
        };
    }
}

async function verifyOtpViaServer(authLambdaUrl, massar, otpPlaintext) {
    try {
        const url = String(authLambdaUrl).replace(/\/+$/, '') + '/link/verify-otp';
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

        const configPayload = decryptPayload(key, ciphertextBuf, ivBuf, authTagBuf);
        return { success: true, configPayload };
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
    verifyOtpViaServer
};
