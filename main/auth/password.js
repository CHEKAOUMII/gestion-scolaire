const crypto = require('crypto');

const HASH_KEY_LENGTH = 64;

/**
 * Generate a cryptographically random temporary password.
 * Format: 8 random hex chars + special char + 4 random hex chars (13 chars total).
 * This is used for initial admin seed and new user creation when no password is provided.
 */
function generateRandomPassword() {
    const part1 = crypto.randomBytes(4).toString('hex'); // 8 hex chars
    const part2 = crypto.randomBytes(2).toString('hex'); // 4 hex chars
    const specials = '!@#$%&*';
    const special = specials[crypto.randomInt(specials.length)];
    return `${part1}${special}${part2}`;
}

function hashPassword(password, saltHex = null) {
    const plain = String(password || '');
    const salt = saltHex || crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(plain, salt, HASH_KEY_LENGTH, { N: 16384, r: 8, p: 1 }).toString('hex');
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
        computedHex = crypto.scryptSync(String(password || ''), salt, HASH_KEY_LENGTH, { N: 16384, r: 8, p: 1 }).toString('hex');
    } catch {
        return false;
    }

    const a = Buffer.from(expectedHex, 'hex');
    const b = Buffer.from(computedHex, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

module.exports = {
    generateRandomPassword,
    hashPassword,
    verifyPassword
};
