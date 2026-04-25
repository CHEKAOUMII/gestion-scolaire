'use strict';

const crypto = require('crypto');

function verifyPassword(password, storedHash) {
    const parts = String(storedHash || '').split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

    try {
        const salt = Buffer.from(parts[1], 'hex');
        const expectedHash = Buffer.from(parts[2], 'hex');
        const derivedKey = crypto.scryptSync(password, salt, 64);
        return crypto.timingSafeEqual(derivedKey, expectedHash);
    } catch {
        return false;
    }
}

module.exports = { verifyPassword };
