const { getDb } = require('../db/context');
const { ensureSchoolIdentitySchema } = require('../db/schema');

/**
 * Base pixel sizes at 100% scale (shared by logo / seal / signature).
 * resolveLogoMaxPx(scale, basePx) is the single sizing function for all assets.
 */
const LOGO_BASE_PX = 80;
const SEAL_BASE_PX = 72;
const SIGNATURE_BASE_WIDTH_PX = 100;
const SIGNATURE_BASE_HEIGHT_PX = 48;
const LOGO_SCALE_MIN = 30;
const LOGO_SCALE_MAX = 250;
const LOGO_SCALE_DEFAULT = 100;

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
    logo_scale: String(LOGO_SCALE_DEFAULT),
    seal_base64: '',
    seal_scale: String(LOGO_SCALE_DEFAULT),
    signature_base64: '',
    signature_scale: String(LOGO_SCALE_DEFAULT),
    footer_text: 'سلمت هذه الوثيقة للمعني(ة) بالأمر قصد الاستعمال فيما يقتضيه.'
};

/**
 * Clamp an asset scale percentage to the allowed range (logo / seal / signature).
 * @param {string|number|null|undefined} scale
 * @returns {number}
 */
function clampLogoScale(scale) {
    const n = Number(scale);
    if (!Number.isFinite(n)) return LOGO_SCALE_DEFAULT;
    return Math.min(LOGO_SCALE_MAX, Math.max(LOGO_SCALE_MIN, Math.round(n)));
}

/**
 * Resolve an asset max size in pixels from a scale percentage.
 * Same function for logo, seal, and signature — pass the base size as the 2nd arg.
 * 100% → basePx. Range: 30%–250%.
 * @param {string|number|null|undefined} scale
 * @param {number} [basePx=LOGO_BASE_PX]
 * @returns {number}
 */
function resolveLogoMaxPx(scale, basePx = LOGO_BASE_PX) {
    const base = Number(basePx);
    const resolvedBase = Number.isFinite(base) && base > 0 ? base : LOGO_BASE_PX;
    return Math.round((resolvedBase * clampLogoScale(scale)) / 100);
}

function ensureIdentityTable(db) {
    // Canonical DDL lives in db/schema.js (R5); this module owns only the default seeding.
    ensureSchoolIdentitySchema(db);

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

/**
 * Best-effort read of the registered principal's name, used as a director_name fallback
 * (registration auto-populate — Part 4). Guarded like readInstitutionFallback/readLegacySchoolInfo
 * since identity.js must not assume the users table shape/existence.
 */
function readPrincipalName(db) {
    try {
        const row = db
            .prepare(
                "SELECT name FROM users WHERE role = 'principal' AND COALESCE(disabled, 0) = 0 ORDER BY id LIMIT 1"
            )
            .get();
        return String(row?.name || '').trim();
    } catch {
        return '';
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
    if (!String(merged.director_name || '').trim()) {
        merged.director_name = readPrincipalName(db);
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

/**
 * Stored scale percentage for an asset key (defaults to 100).
 * @param {string} [key='logo_scale'] - e.g. 'logo_scale', 'seal_scale', 'signature_scale'
 * @returns {number}
 */
function getLogoScale(key = 'logo_scale') {
    const raw = getAssetBase64(key);
    return clampLogoScale(raw || LOGO_SCALE_DEFAULT);
}

module.exports = {
    getIdentity,
    updateIdentity,
    getAssetBase64,
    getLogoScale,
    resolveLogoMaxPx,
    clampLogoScale,
    LOGO_BASE_PX,
    SEAL_BASE_PX,
    SIGNATURE_BASE_WIDTH_PX,
    SIGNATURE_BASE_HEIGHT_PX,
    LOGO_SCALE_MIN,
    LOGO_SCALE_MAX,
    LOGO_SCALE_DEFAULT
};
