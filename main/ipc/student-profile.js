const { handleRead, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { requireFields } = require('./validation');
// Shared allowlist — js/data/student-profile-fields.js (also available on renderer as StudentProfileFields)
const { PROFILE_TAB_ALLOWLIST, PROFILE_TAB_MAX_JSON } = require('../../js/data/student-profile-fields');

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
    handleRead(ipcMain, 'studentProfile:getAllTabs', (db, studentCode, schoolYear) => {
        const code = String(studentCode || '').trim();
        const year = normalizeYear(schoolYear);
        if (!code) return [];
        return db
            .prepare('SELECT * FROM student_profile_data WHERE student_code = ? AND school_year = ?')
            .all(code, year);
    });

    handleWriteSoftAuth(ipcMain, 'studentProfile:saveTab', WRITE_ROLES, (db, payload) => {
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

        db.prepare(`
            INSERT INTO student_profile_data (student_id, student_code, tab_key, data_json, school_year, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
            ON CONFLICT(student_code, tab_key, school_year) DO UPDATE SET
                data_json = excluded.data_json,
                updated_at = CURRENT_TIMESTAMP,
                updated_by = excluded.updated_by
        `).run(
            Number(payload.student_id) || 0,
            studentCode,
            tabKey,
            dataJson,
            payload.school_year,
            payload.updated_by || null
        );
        return { success: true };
    });

    // ── Persisted risk snapshot (H3/R7) ──
    // Upserts the computed dropout-risk score/level keyed by
    // (student_code, school_year). Mirrors the saveTab auth + validation shape.
    handleWriteSoftAuth(ipcMain, 'studentProfile:saveRiskSnapshot', WRITE_ROLES, (db, payload) => {
        requireFields(payload, ['student_code', 'school_year']);
        requireSchoolYear(payload.school_year);

        const studentCode = String(payload.student_code).trim();
        if (!studentCode) {
            return { success: false, error: 'Invalid student_code' };
        }

        const rawScore = Number(payload.risk_score);
        const riskScore = Number.isFinite(rawScore) ? Math.round(rawScore) : null;
        const riskLevel = payload.risk_level != null ? String(payload.risk_level).slice(0, 50) : null;

        // student_id now sits behind a FK (student_id → students(id), migration 065), so
        // it must reference a real student or be NULL — never the legacy 0 sentinel.
        // Prefer a valid provided id, else resolve from (student_code, school_year).
        let riskStudentId = Number(payload.student_id);
        if (!Number.isFinite(riskStudentId) || riskStudentId <= 0) {
            riskStudentId = null;
        } else if (!db.prepare('SELECT 1 FROM students WHERE id = ?').get(riskStudentId)) {
            riskStudentId = null;
        }
        if (riskStudentId == null) {
            const resolvedStudent = db
                .prepare('SELECT id FROM students WHERE code = ? AND school_year = ?')
                .get(studentCode, payload.school_year);
            riskStudentId = resolvedStudent ? resolvedStudent.id : null;
        }

        db.prepare(`
            INSERT INTO student_risk_snapshot (student_id, student_code, risk_score, risk_level, school_year, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
            ON CONFLICT(student_code, school_year) DO UPDATE SET
                student_id = excluded.student_id,
                risk_score = excluded.risk_score,
                risk_level = excluded.risk_level,
                updated_at = CURRENT_TIMESTAMP,
                updated_by = excluded.updated_by
        `).run(
            riskStudentId,
            studentCode,
            riskScore,
            riskLevel,
            payload.school_year,
            payload.updated_by || null
        );
        return { success: true };
    });
}

module.exports = { registerStudentProfileIpc };
