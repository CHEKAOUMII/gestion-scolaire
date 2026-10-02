const { handleAuthedRead, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { resolveCycleForRequest } = require('../auth/resolve-cycle');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { requireFields } = require('./validation');
// Shared allowlist — js/data/student-profile-fields.js (also available on renderer as StudentProfileFields)
const { PROFILE_TAB_ALLOWLIST, PROFILE_TAB_MAX_JSON } = require('../../js/data/student-profile-fields');
const studentProfileRepo = require('../repos/student-profile');

function isProfileScalar(value) {
    return (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    );
}

function isAllowedProfileValue(value) {
    if (Array.isArray(value)) {
        return value.every(
            (item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
        );
    }
    return isProfileScalar(value);
}

// Validate + sanitize an incoming data_json payload for a profile tab.
// Returns { ok: true, data: <serialized json> } or { ok: false, error }.
function sanitizeProfileTabData(tabKey, rawData) {
    const incoming = typeof rawData === 'string' ? rawData : JSON.stringify(rawData ?? {});
    if (incoming.length > PROFILE_TAB_MAX_JSON) {
        return { ok: false, error: 'data_json exceeds maximum allowed size' };
    }

    let parsed;
    try {
        parsed = typeof rawData === 'string' ? JSON.parse(rawData || '{}') : rawData ?? {};
    } catch {
        return { ok: false, error: 'Invalid data_json: not valid JSON' };
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: 'Invalid data_json: expected an object' };
    }

    const allowed = PROFILE_TAB_ALLOWLIST[tabKey] || [];
    const sanitized = {};
    for (const key of allowed) {
        if (!Object.prototype.hasOwnProperty.call(parsed, key)) continue;
        const value = parsed[key];
        if (value === undefined) continue;
        if (!isAllowedProfileValue(value)) {
            return { ok: false, error: `Invalid value type for field '${key}'` };
        }
        sanitized[key] = value;
    }

    return { ok: true, data: JSON.stringify(sanitized) };
}

function registerStudentProfileIpc(ipcMain) {
    handleAuthedRead(ipcMain, 'studentProfile:getAllTabs', ({ db, event }, studentCode, schoolYear) => {
        const code = String(studentCode || '').trim();
        if (!code) return [];
        return studentProfileRepo.listProfileTabs(
            db,
            code,
            normalizeYear(schoolYear),
            resolveCycleForRequest(db, event)
        );
    });

    handleWriteSoftAuth(ipcMain, 'studentProfile:saveTab', WRITE_ROLES, ({ db, event }, payload) => {
        requireFields(payload, ['student_code', 'tab_key', 'school_year']);
        requireSchoolYear(payload.school_year);

        const validTabs = ['economic', 'social', 'health', 'followup', 'guidance'];
        const tabKey = String(payload.tab_key || '').trim();
        if (!validTabs.includes(tabKey)) {
            return { success: false, error: 'Invalid tab_key' };
        }

        const studentCode = String(payload.student_code).trim();
        const sanitized = sanitizeProfileTabData(tabKey, payload.data_json);
        if (!sanitized.ok) {
            return { success: false, error: sanitized.error };
        }
        const dataJson = sanitized.data;

        return studentProfileRepo.saveProfileTab(
            db,
            { ...payload, student_code: studentCode, tab_key: tabKey },
            dataJson,
            resolveCycleForRequest(db, event)
        );
    }, { withContext: true });

    // ── Persisted risk snapshot (H3/R7) ──
    // Upserts the computed dropout-risk score/level keyed by
    // (student_code, school_year). Mirrors the saveTab auth + validation shape.
    handleWriteSoftAuth(ipcMain, 'studentProfile:saveRiskSnapshot', WRITE_ROLES, ({ db, event }, payload) => {
        requireFields(payload, ['student_code', 'school_year']);
        requireSchoolYear(payload.school_year);

        const studentCode = String(payload.student_code).trim();
        if (!studentCode) {
            return { success: false, error: 'Invalid student_code' };
        }

        return studentProfileRepo.saveRiskSnapshot(db, payload, resolveCycleForRequest(db, event));
    }, { withContext: true });
}

module.exports = { registerStudentProfileIpc };
