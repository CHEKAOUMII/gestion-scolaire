'use strict';

/**
 * Pure login lockout policy (no I/O).
 * Values must stay aligned with product behavior historically in main/ipc/auth.js.
 */

const MAX_ATTEMPTS_BEFORE_LOCK = 5;
const LOCKOUT_SCHEDULE_MS = [5_000, 15_000, 30_000, 60_000, 120_000];
const ATTEMPT_TTL_MS = 30 * 60_000;

function isAttemptRecordExpired(record, nowMs = Date.now()) {
    if (!record) return true;
    const last = Number(record.lastAttempt || record.updated_at || 0);
    if (!Number.isFinite(last) || last <= 0) return false;
    return nowMs - last > ATTEMPT_TTL_MS;
}

function nextLockoutDurationMs(attemptCount) {
    const count = Number(attemptCount) || 0;
    if (count < MAX_ATTEMPTS_BEFORE_LOCK) return 0;
    const tier = Math.min(count - MAX_ATTEMPTS_BEFORE_LOCK, LOCKOUT_SCHEDULE_MS.length - 1);
    return LOCKOUT_SCHEDULE_MS[tier];
}

/**
 * @param {{ count?: number, lockedUntil?: number, lastAttempt?: number, updated_at?: number }} record
 * @param {number} [nowMs]
 */
function evaluateLoginAttempt(record, nowMs = Date.now()) {
    if (!record) {
        return { allowed: true };
    }
    if (isAttemptRecordExpired(record, nowMs)) {
        return { allowed: true, expired: true };
    }
    const lockedUntil = Number(record.lockedUntil || record.locked_until || 0);
    if (Number.isFinite(lockedUntil) && lockedUntil > nowMs) {
        return {
            allowed: false,
            retryAfterMs: lockedUntil - nowMs,
            reason: 'locked'
        };
    }
    return { allowed: true, count: Number(record.count || record.attempts || 0) };
}

/**
 * Compute next attempts / locked_until after a failed login.
 * @param {{ attempts?: number, locked_until?: number } | null} existing
 * @param {number} [nowMs]
 */
function buildFailedAttemptUpdate(existing, nowMs = Date.now()) {
    const count = (existing?.attempts || 0) + 1;
    let lockedUntil = existing?.locked_until || 0;
    if (count >= MAX_ATTEMPTS_BEFORE_LOCK) {
        lockedUntil = nowMs + nextLockoutDurationMs(count);
    }
    return { attempts: count, locked_until: lockedUntil, updated_at: nowMs };
}

module.exports = {
    MAX_ATTEMPTS_BEFORE_LOCK,
    LOCKOUT_SCHEDULE_MS,
    ATTEMPT_TTL_MS,
    isAttemptRecordExpired,
    nextLockoutDurationMs,
    evaluateLoginAttempt,
    buildFailedAttemptUpdate
};
