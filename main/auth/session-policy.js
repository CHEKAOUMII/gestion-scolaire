'use strict';

/**
 * Pure session TTL policy (no I/O).
 * Match client AUTH_SESSION_TTL_MS (12h).
 */

const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

/**
 * @param {{ expiresAt?: number } | null} sessionLike - persisted payload with expiresAt
 * @param {number} [nowMs]
 */
function isSessionExpired(sessionLike, nowMs = Date.now()) {
    if (!sessionLike) return true;
    const expiresAt = Number(sessionLike.expiresAt || 0);
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) return true;
    return nowMs > expiresAt;
}

function computeExpiresAt(nowMs = Date.now()) {
    return nowMs + SESSION_TTL_MS;
}

module.exports = {
    SESSION_TTL_MS,
    isSessionExpired,
    computeExpiresAt
};
