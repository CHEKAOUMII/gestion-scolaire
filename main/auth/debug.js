'use strict';

const { getDb } = require('../db/context');

const AUTH_DEBUG_ENABLED =
    process.env.PENCIL_AUTH_DEBUG === '1' ||
    process.env.NODE_ENV !== 'production';

function maskEmail(email) {
    const value = String(email || '').trim().toLowerCase();
    if (!value || !value.includes('@')) return value || null;
    const [local, domain] = value.split('@');
    const visible = local.slice(0, 2);
    return `${visible}${local.length > 2 ? '***' : '*'}@${domain}`;
}

function sanitizeMeta(meta = {}) {
    const safe = {};
    for (const [key, value] of Object.entries(meta || {})) {
        if (/password|token|secret|key/i.test(key)) continue;
        if (key === 'email') {
            safe.email = maskEmail(value);
            continue;
        }
        if (value instanceof Error) {
            safe[key] = {
                code: value.code || null,
                message: value.message || String(value)
            };
            continue;
        }
        safe[key] = value;
    }
    return safe;
}

function logAuthDebug(event, meta = {}, options = {}) {
    const details = {
        event,
        ...sanitizeMeta(meta)
    };

    if (AUTH_DEBUG_ENABLED || options.alwaysConsole) {
        console.log('[auth:debug]', JSON.stringify(details));
    }

    try {
        const db = getDb();
        db.prepare(
            `
            INSERT INTO system_logs(action, entity_type, entity_id, details)
            VALUES(?, ?, ?, ?)
        `
        ).run('auth.debug', 'auth', event, JSON.stringify(details));
    } catch (err) {
        if (AUTH_DEBUG_ENABLED) {
            console.warn('[auth:debug] Failed to persist debug log:', err.message);
        }
    }
}

module.exports = {
    logAuthDebug,
    maskEmail
};
