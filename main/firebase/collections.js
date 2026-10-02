'use strict';

const SCHOOLS_COLLECTION = 'schools';
const SCHOOL_META_COLLECTION = 'meta';
const SCHOOL_INSTITUTION_META_DOC = 'institution';
const SCHOOL_USERS_COLLECTION = 'users';
const SCHOOL_USER_INVITES_COLLECTION = 'userInvites';
const SYNC_LOG_COLLECTION = 'syncLog';
const SYNC_LOG_CHANGES_COLLECTION = 'changes';
const OTP_CODES_COLLECTION = 'otpCodes';

// Composite Firestore document IDs use "__" instead of DynamoDB sort-key "#".
// Derived from main/sync/entity-registry.js (WP2 SSOT).
const { buildCollectionMap } = require('../sync/entity-registry');
const COLLECTION_MAP = buildCollectionMap();

function sanitizeDocumentIdPart(value) {
    return encodeURIComponent(String(value).trim()).replace(/\./g, '%2E');
}

function decodeDocumentIdPart(value) {
    try {
        return decodeURIComponent(String(value || '').trim());
    } catch {
        return String(value || '').trim();
    }
}

function getCollectionName(tableName) {
    return COLLECTION_MAP[tableName]?.collection || null;
}

function getCollectionPath(schoolId, tableName) {
    const collectionName = getCollectionName(tableName);
    if (!schoolId || !collectionName) {
        return null;
    }
    return `${SCHOOLS_COLLECTION}/${schoolId}/${collectionName}`;
}

/**
 * Build a Firestore document ID from an ordered list of field names.
 * @param {string[]} fields
 * @param {object} rowData
 * @returns {string|null}
 */
function buildDocumentIdFromFields(fields, rowData) {
    if (!Array.isArray(fields) || !fields.length) {
        return null;
    }

    const parts = [];
    for (const field of fields) {
        const value = rowData?.[field];
        if (value === undefined || value === null || String(value).trim() === '') {
            return null;
        }
        parts.push(sanitizeDocumentIdPart(value));
    }

    return parts.join('__');
}

/**
 * Canonical (current writer) remote document ID for a table.
 */
function buildDocumentId(tableName, rowData) {
    const entry = COLLECTION_MAP[tableName];
    if (!entry) {
        return null;
    }
    return buildDocumentIdFromFields(entry.idFields, rowData);
}

/**
 * Legacy remote document ID when the entity still supports an older id scheme.
 * Returns null when there is no legacy scheme or it equals the canonical ID.
 */
function buildLegacyDocumentId(tableName, rowData) {
    const entry = COLLECTION_MAP[tableName];
    if (!entry || !Array.isArray(entry.legacyIdFields) || !entry.legacyIdFields.length) {
        return null;
    }
    const legacyId = buildDocumentIdFromFields(entry.legacyIdFields, rowData);
    if (!legacyId) return null;
    const canonicalId = buildDocumentIdFromFields(entry.idFields, rowData);
    if (legacyId === canonicalId) return null;
    return legacyId;
}

/**
 * Parse a document ID into field values using declared field order.
 * Single-field schemes accept the whole id; multi-field schemes split on "__".
 * @returns {object|null}
 */
function parseDocumentIdFields(documentId, fields) {
    if (!documentId || !Array.isArray(fields) || !fields.length) {
        return null;
    }

    const raw = String(documentId);
    if (fields.length === 1) {
        return { [fields[0]]: decodeDocumentIdPart(raw) };
    }

    const parts = raw.split('__');
    if (parts.length !== fields.length) {
        return null;
    }

    const out = {};
    for (let i = 0; i < fields.length; i += 1) {
        out[fields[i]] = decodeDocumentIdPart(parts[i]);
    }
    return out;
}

/**
 * Student logical identity for cross-year collision prevention and pull dedup.
 * @returns {{ school_year: string, code: string }|null}
 */
function studentLogicalKey(rowData) {
    const code = String(rowData?.code || '').trim();
    const schoolYear = String(rowData?.school_year || rowData?.schoolYear || '').trim();
    if (!code || !schoolYear) return null;
    return { school_year: schoolYear, code };
}

/**
 * Infer student fields from a remote document id (legacy code-only or canonical).
 * Prefer payload fields; use this only to fill gaps.
 */
function parseStudentDocumentId(documentId) {
    if (!documentId) return null;
    const entry = COLLECTION_MAP.students;
    if (!entry) return null;

    const canonical = parseDocumentIdFields(documentId, entry.canonicalIdFields || entry.idFields);
    if (canonical && canonical.code && canonical.school_year) {
        return canonical;
    }

    if (Array.isArray(entry.legacyIdFields) && entry.legacyIdFields.length === 1) {
        const legacy = parseDocumentIdFields(documentId, entry.legacyIdFields);
        if (legacy && legacy.code) {
            return { code: legacy.code, school_year: null };
        }
    }

    return null;
}

function getSyncLogPath(schoolId) {
    if (!schoolId) {
        return null;
    }
    return `${SYNC_LOG_COLLECTION}/${schoolId}/${SYNC_LOG_CHANGES_COLLECTION}`;
}

function getSchoolMetaPath(schoolId) {
    if (!schoolId) {
        return null;
    }
    return `${SCHOOLS_COLLECTION}/${schoolId}/${SCHOOL_META_COLLECTION}`;
}

function getSchoolInstitutionMetaPath(schoolId) {
    if (!schoolId) {
        return null;
    }
    return `${getSchoolMetaPath(schoolId)}/${SCHOOL_INSTITUTION_META_DOC}`;
}

function getSchoolUsersPath(schoolId) {
    if (!schoolId) {
        return null;
    }
    return `${SCHOOLS_COLLECTION}/${schoolId}/${SCHOOL_USERS_COLLECTION}`;
}

function getSchoolUserPath(schoolId, uid) {
    if (!schoolId || !uid) {
        return null;
    }
    return `${getSchoolUsersPath(schoolId)}/${uid}`;
}

function getSchoolInvitesPath(schoolId) {
    if (!schoolId) {
        return null;
    }
    return `${SCHOOLS_COLLECTION}/${schoolId}/${SCHOOL_USER_INVITES_COLLECTION}`;
}

function getSchoolInvitePath(schoolId, inviteId) {
    if (!schoolId || !inviteId) {
        return null;
    }
    return `${getSchoolInvitesPath(schoolId)}/${inviteId}`;
}

module.exports = {
    SCHOOLS_COLLECTION,
    SCHOOL_META_COLLECTION,
    SCHOOL_INSTITUTION_META_DOC,
    SCHOOL_USERS_COLLECTION,
    SCHOOL_USER_INVITES_COLLECTION,
    SYNC_LOG_COLLECTION,
    SYNC_LOG_CHANGES_COLLECTION,
    OTP_CODES_COLLECTION,
    COLLECTION_MAP,
    sanitizeDocumentIdPart,
    decodeDocumentIdPart,
    getCollectionName,
    getCollectionPath,
    buildDocumentIdFromFields,
    buildDocumentId,
    buildLegacyDocumentId,
    parseDocumentIdFields,
    studentLogicalKey,
    parseStudentDocumentId,
    getSyncLogPath,
    getSchoolMetaPath,
    getSchoolInstitutionMetaPath,
    getSchoolUsersPath,
    getSchoolUserPath,
    getSchoolInvitesPath,
    getSchoolInvitePath
};
