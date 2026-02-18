const crypto = require('crypto');

const DEFAULT_ADMIN_PASSWORD = 'Admin@123';
const HASH_KEY_LENGTH = 64;

function hashPassword(password, saltHex = null) {
    const plain = String(password || '');
    const salt = saltHex || crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(plain, salt, HASH_KEY_LENGTH).toString('hex');
    return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
    const value = String(storedHash || '');
    const parts = value.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt' || !parts[1] || !parts[2]) {
        return false;
    }

    const salt = parts[1];
    const expectedHex = parts[2];

    let computedHex;
    try {
        computedHex = crypto.scryptSync(String(password || ''), salt, HASH_KEY_LENGTH).toString('hex');
    } catch (_err) {
        return false;
    }

    const a = Buffer.from(expectedHex, 'hex');
    const b = Buffer.from(computedHex, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

module.exports = {
    DEFAULT_ADMIN_PASSWORD,
    hashPassword,
    verifyPassword
};
