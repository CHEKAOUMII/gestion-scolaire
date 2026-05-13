const { getDb } = require('../db/context');

const DEFAULT_IDENTITY = {
    country: 'المملكة المغربية',
    ministry: 'وزارة التربية الوطنية والتعليم الأولي والرياضة',
    academy: '',
    directorate: '',
    school_name: '',
    school_code: '',
    director_name: '',
    director_title: 'مدير(ة) المؤسسة',
    city: '',
    commune: '',
    school_year: '',
    logo_base64: '',
    seal_base64: '',
    signature_base64: '',
    footer_text: 'سلمت هذه الوثيقة للمعني(ة) بالأمر قصد الاستعمال فيما يقتضيه.'
};

function ensureIdentityTable(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS school_identity (
            key         TEXT PRIMARY KEY,
            value       TEXT NOT NULL DEFAULT '',
            updated_at  INTEGER DEFAULT (strftime('%s','now') * 1000)
        )
    `);

    const seed = db.prepare('INSERT OR IGNORE INTO school_identity (key, value) VALUES (?, ?)');
    const txn = db.transaction(() => {
        for (const [key, value] of Object.entries(DEFAULT_IDENTITY)) {
            seed.run(key, value);
        }
    });
    txn();
}

function readIdentityRows(db) {
    const rows = db.prepare('SELECT key, value FROM school_identity').all();
    const identity = {};
    for (const row of rows) {
        identity[row.key] = row.value;
    }
    return identity;
}

function readLegacySchoolInfo(db) {
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'school_info'").get();
        if (!row?.value) return {};
        return JSON.parse(row.value) || {};
    } catch {
        return {};
    }
}

function getSettingValue(db, key) {
    try {
        return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '';
    } catch {
        return '';
    }
}

function readInstitutionFallback(db) {
    try {
        const columns = db.pragma('table_info(institution_config)').map((column) => column.name);
        if (!columns.length) return {};

        const hasCodeEtablissement = columns.includes('code_etablissement');
        const hasMassarCode = columns.includes('massar_code');
        const codeSelect = hasCodeEtablissement
            ? 'code_etablissement'
            : hasMassarCode
              ? 'massar_code AS code_etablissement'
              : "'' AS code_etablissement";
        const nameSelect = columns.includes('institution_name') ? 'institution_name' : "'' AS institution_name";
        return db.prepare(`SELECT ${codeSelect}, ${nameSelect} FROM institution_config WHERE id = 1`).get() || {};
    } catch {
        return {};
    }
}

function mergeLegacyFallbacks(db, identity) {
    const merged = { ...DEFAULT_IDENTITY, ...identity };
    const legacy = readLegacySchoolInfo(db);
    const institution = readInstitutionFallback(db);
    const currentSchoolYear = getSettingValue(db, 'currentSchoolYear');

    if (!String(merged.school_name || '').trim()) {
        merged.school_name = legacy.name || institution.institution_name || '';
    }
    if (!String(merged.school_code || '').trim()) {
        merged.school_code = legacy.code || institution.code_etablissement || '';
    }
    if (!String(merged.city || '').trim()) {
        merged.city = legacy.city || '';
    }
    if (!String(merged.school_year || '').trim()) {
        merged.school_year = currentSchoolYear || '';
    }

    return merged;
}

/**
 * Returns the full school identity as a flat object.
 * @returns {object} e.g. { country, ministry, school_name, ... }
 */
function getIdentity() {
    const db = getDb();
    ensureIdentityTable(db);
    return mergeLegacyFallbacks(db, readIdentityRows(db));
}

/**
 * Update one or more identity fields.
 * @param {object} updates - e.g. { school_name: 'ثانوية ...', city: 'الدار البيضاء' }
 * @returns {object} The full identity after update
 */
function updateIdentity(updates) {
    const db = getDb();
    ensureIdentityTable(db);
    const stmt = db.prepare('INSERT OR REPLACE INTO school_identity (key, value, updated_at) VALUES (?, ?, ?)');
    const now = Date.now();
    const txn = db.transaction(() => {
        for (const [key, value] of Object.entries(updates)) {
            if (value === undefined || value === null) continue;
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
    ensureIdentityTable(db);
    const row = db.prepare('SELECT value FROM school_identity WHERE key = ?').get(key);
    return row?.value || '';
}

module.exports = { getIdentity, updateIdentity, getAssetBase64 };
