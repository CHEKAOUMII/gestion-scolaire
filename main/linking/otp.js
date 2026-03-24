const crypto = require('crypto');
const { hashPassword, verifyPassword } = require('../auth/password');

const OTP_TTL_MS = 10 * 60_000;
const MAX_OTP_ATTEMPTS = 5;
const OTP_ATTEMPT_WINDOW_MS = 10 * 60_000;
const MASSAR_CODE_REGEX = /^[A-Z]\d{4,8}$/;

const OTP_ATTEMPTS = new Map();

function validateMassarCode(massarCode) {
    if (!massarCode || typeof massarCode !== 'string') {
        return { valid: false };
    }

    const trimmed = massarCode.trim().toUpperCase();
    if (!MASSAR_CODE_REGEX.test(trimmed)) {
        return { valid: false };
    }

    return { valid: true, normalized: trimmed };
}

function isRateLimited(massarCode) {
    const rec = OTP_ATTEMPTS.get(massarCode);
    if (!rec) {
        return false;
    }

    const now = Date.now();
    if (now - rec.firstFailure > OTP_ATTEMPT_WINDOW_MS) {
        OTP_ATTEMPTS.delete(massarCode);
        return false;
    }

    return rec.count >= MAX_OTP_ATTEMPTS;
}

function recordFailedAttempt(massarCode) {
    const now = Date.now();
    const rec = OTP_ATTEMPTS.get(massarCode);

    if (!rec || now - rec.firstFailure > OTP_ATTEMPT_WINDOW_MS) {
        OTP_ATTEMPTS.set(massarCode, { count: 1, firstFailure: now });
        return;
    }

    rec.count += 1;
}

function resetAttempts(massarCode) {
    OTP_ATTEMPTS.delete(massarCode);
}

function getLatestOtpRow(db, normalizedMassarCode) {
    return (
        db
            .prepare(
                `
                    SELECT id, otp_hash, expires_at, status
                    FROM device_otp
                    WHERE massar_code = ?
                    ORDER BY id DESC
                    LIMIT 1
                `
            )
            .get(normalizedMassarCode) || null
    );
}

function markExpiredIfNeeded(db, row) {
    if (!row || row.status !== 'active') {
        return row;
    }

    const expiresAt = new Date(row.expires_at);
    if (Date.now() <= expiresAt.getTime()) {
        return row;
    }

    db.prepare(`UPDATE device_otp SET status = 'expired' WHERE id = ?`).run(row.id);
    return {
        ...row,
        status: 'expired'
    };
}

function buildStatusFromRow(row) {
    if (!row) {
        return {
            active: false,
            status: 'inactive',
            expiresAt: null,
            remainingSeconds: 0
        };
    }

    const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
    const remainingSeconds =
        row.status === 'active' && expiresAt ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 1000)) : 0;

    return {
        active: row.status === 'active',
        status: row.status || 'inactive',
        expiresAt: row.expires_at || null,
        remainingSeconds
    };
}

function generateOtp(db, massarCode, creatorDeviceHash) {
    const validation = validateMassarCode(massarCode);
    if (!validation.valid) {
        throw new Error('Invalid MASSAR code format');
    }

    const normalized = validation.normalized;
    if (!creatorDeviceHash || typeof creatorDeviceHash !== 'string' || !creatorDeviceHash.trim()) {
        throw new Error('Creator device hash is required');
    }

    db.prepare(
        `
            UPDATE device_otp SET status = 'expired'
            WHERE massar_code = ? AND status = 'active'
        `
    ).run(normalized);

    const otp = String(crypto.randomInt(100000, 1000000));
    const otpHash = hashPassword(otp);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS).toISOString();

    db.prepare(
        `
            INSERT INTO device_otp (otp_hash, massar_code, created_by_device, expires_at, status)
            VALUES (?, ?, ?, ?, 'active')
        `
    ).run(otpHash, normalized, creatorDeviceHash.trim(), expiresAt);

    resetAttempts(normalized);

    return {
        otp,
        expiresAt
    };
}

function verifyOtp(db, massarCode, otpPlaintext, consumerDeviceHash) {
    const validation = validateMassarCode(massarCode);
    if (!validation.valid) {
        throw new Error('Invalid MASSAR code format');
    }

    const normalized = validation.normalized;
    if (!consumerDeviceHash || typeof consumerDeviceHash !== 'string' || !consumerDeviceHash.trim()) {
        throw new Error('Consumer device hash is required');
    }

    if (!otpPlaintext || typeof otpPlaintext !== 'string') {
        return { valid: false, error: 'INVALID_OTP' };
    }

    if (isRateLimited(normalized)) {
        return { valid: false, error: 'RATE_LIMITED' };
    }

    let row = getLatestOtpRow(db, normalized);
    if (!row) {
        return { valid: false, error: 'NO_ACTIVE_OTP' };
    }

    row = markExpiredIfNeeded(db, row);
    if (row.status === 'cancelled') {
        return { valid: false, error: 'OTP_CANCELLED' };
    }
    if (row.status === 'used') {
        return { valid: false, error: 'OTP_USED' };
    }
    if (row.status === 'expired') {
        return { valid: false, error: 'OTP_EXPIRED' };
    }
    if (row.status !== 'active') {
        return { valid: false, error: 'NO_ACTIVE_OTP' };
    }

    const matches = verifyPassword(otpPlaintext, row.otp_hash);
    if (!matches) {
        recordFailedAttempt(normalized);
        return { valid: false, error: 'INVALID_OTP' };
    }

    const now = new Date().toISOString();
    db.prepare(
        `
            UPDATE device_otp
            SET status = 'used', used_by_device = ?, used_at = ?
            WHERE id = ?
        `
    ).run(consumerDeviceHash.trim(), now, row.id);

    resetAttempts(normalized);

    return { valid: true };
}

function getLatestOtpStatus(db, massarCode) {
    const validation = validateMassarCode(massarCode);
    if (!validation.valid) {
        return {
            active: false,
            status: 'inactive',
            expiresAt: null,
            remainingSeconds: 0
        };
    }

    const normalized = validation.normalized;
    const row = markExpiredIfNeeded(db, getLatestOtpRow(db, normalized));
    return buildStatusFromRow(row);
}

function getActiveOtp(db, massarCode) {
    const status = getLatestOtpStatus(db, massarCode);
    if (!status.active) {
        return { active: false };
    }

    return status;
}

function cancelActiveOtp(db, massarCode) {
    const validation = validateMassarCode(massarCode);
    if (!validation.valid) {
        return { success: false, error: 'INVALID_MASSAR' };
    }

    const normalized = validation.normalized;
    const row = markExpiredIfNeeded(db, getLatestOtpRow(db, normalized));
    if (!row) {
        return { success: false, error: 'NO_ACTIVE_OTP' };
    }

    if (row.status === 'cancelled') {
        return { success: false, error: 'OTP_CANCELLED' };
    }
    if (row.status === 'used') {
        return { success: false, error: 'OTP_USED' };
    }
    if (row.status === 'expired') {
        return { success: false, error: 'OTP_EXPIRED' };
    }
    if (row.status !== 'active') {
        return { success: false, error: 'NO_ACTIVE_OTP' };
    }

    db.prepare(`UPDATE device_otp SET status = 'cancelled' WHERE id = ?`).run(row.id);
    resetAttempts(normalized);

    return {
        success: true,
        active: false,
        status: 'cancelled',
        expiresAt: row.expires_at || null,
        remainingSeconds: 0
    };
}

function cleanupExpiredOtps(db) {
    const now = new Date().toISOString();

    db.prepare(
        `
            UPDATE device_otp SET status = 'expired'
            WHERE status = 'active' AND expires_at <= ?
        `
    ).run(now);

    const result = db
        .prepare(
            `
                DELETE FROM device_otp
                WHERE status IN ('cancelled', 'expired', 'used')
            `
        )
        .run();

    return { deleted: result.changes };
}

module.exports = {
    validateMassarCode,
    generateOtp,
    verifyOtp,
    getActiveOtp,
    getLatestOtpStatus,
    cancelActiveOtp,
    cleanupExpiredOtps
};
