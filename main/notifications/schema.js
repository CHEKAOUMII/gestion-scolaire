const crypto = require('crypto');

const SEVERITY = Object.freeze({
    INFO: 'info',
    SUCCESS: 'success',
    WARNING: 'warning',
    ERROR: 'error'
});

const CHANNELS = Object.freeze({
    TOAST: 'toast',
    CENTER: 'center',
    NATIVE: 'native',
    EMAIL: 'email'
});

const VALID_SEVERITIES = Object.values(SEVERITY);
const VALID_CHANNELS = Object.values(CHANNELS);

function validateEvent(event) {
    if (!event.type || typeof event.type !== 'string') {
        throw new Error('NotificationEvent requires a string "type"');
    }
    if (!VALID_SEVERITIES.includes(event.severity)) {
        throw new Error(`Invalid severity: ${event.severity}`);
    }
    if (event.channels) {
        for (const ch of event.channels) {
            if (!VALID_CHANNELS.includes(ch)) {
                throw new Error(`Invalid channel: ${ch}`);
            }
        }
    }
    return {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        severity: event.severity,
        type: event.type,
        payload: event.payload || {},
        sourceId: event.sourceId || null,
        channels: event.channels || null,
        targetPage: event.targetPage || null,
        meta: event.meta || {}
    };
}

module.exports = { validateEvent };
