const { getDb } = require('../db/context');

/**
 * Returns the full school identity as a flat object.
 * @returns {object} e.g. { country, ministry, school_name, ... }
 */
function getIdentity() {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM school_identity').all();
    const identity = {};
    for (const row of rows) {
        identity[row.key] = row.value;
    }
    return identity;
}

/**
 * Update one or more identity fields.
 * @param {object} updates - e.g. { school_name: 'ثانوية ...', city: 'الدار البيضاء' }
 * @returns {object} The full identity after update
 */
function updateIdentity(updates) {
    const db = getDb();
    const stmt = db.prepare(
        'INSERT OR REPLACE INTO school_identity (key, value, updated_at) VALUES (?, ?, ?)'
    );
    const now = Date.now();
    const txn = db.transaction(() => {
        for (const [key, value] of Object.entries(updates)) {
            stmt.run(key, String(value), now);
        }
    });
    txn();
    return getIdentity();
}

/**
 * Retrieve a single base64 asset (logo, seal, signature).
 * @param {string} key - e.g. 'logo_base64', 'seal_base64', 'signature_base64'
 * @returns {string}
 */
function getAssetBase64(key) {
    const db = getDb();
    const row = db.prepare('SELECT value FROM school_identity WHERE key = ?').get(key);
    return row?.value || '';
}

module.exports = { getIdentity, updateIdentity, getAssetBase64 };
