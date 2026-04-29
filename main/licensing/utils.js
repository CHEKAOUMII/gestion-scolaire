const crypto = require('crypto');

function sha256(value) {
    return crypto
        .createHash('sha256')
        .update(String(value || ''), 'utf8')
        .digest('hex');
}

function nowIso() {
    return new Date().toISOString();
}

function safeJsonParse(jsonText, fallback = {}) {
    try {
        return JSON.parse(jsonText);
    } catch {
        return fallback;
    }
}

module.exports = { sha256, nowIso, safeJsonParse };
