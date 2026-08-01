/**
 * import-preflight-policy.js — one decision table for import context checks.
 * A low-confidence filename hint never blocks an import by itself.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.ImportPreflightPolicy = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const DECISIONS = Object.freeze({ ALLOW: 'allow', REQUIRE_REVIEW: 'require_review', BLOCK: 'block' });
    const HIGH_RISK_ACTIONS = Object.freeze(['students', 'grades', 'absences', 'student-status', 'orientation']);
    const IMPORT_CONTEXT_CODES = Object.freeze({
        TEMPLATE_UNKNOWN: 'TEMPLATE_UNKNOWN',
        TEMPLATE_MISMATCH: 'TEMPLATE_MISMATCH',
        SCHOOL_YEAR_MISMATCH: 'SCHOOL_YEAR_MISMATCH',
        INSTITUTION_CODE_MISMATCH: 'INSTITUTION_CODE_MISMATCH',
        INSTITUTION_NAME_DIFFERENCE: 'INSTITUTION_NAME_DIFFERENCE',
        CYCLE_MISMATCH: 'CYCLE_MISMATCH',
        DESTINATION_CONTEXT_UNAVAILABLE: 'DESTINATION_CONTEXT_UNAVAILABLE',
        FILE_READ_ERROR: 'FILE_READ_ERROR',
        FILE_SCOPE_INFO: 'FILE_SCOPE_INFO',
        SEMESTER_UNRESOLVED: 'SEMESTER_UNRESOLVED',
        SUBJECT_UNRESOLVED: 'SUBJECT_UNRESOLVED',
        UNKNOWN_STUDENT_CODES: 'UNKNOWN_STUDENT_CODES'
    });

    function decide({ action, key, status, confidence, source }) {
        const highRisk = HIGH_RISK_ACTIONS.includes(action);
        if (status === 'match' || status === 'info') return DECISIONS.ALLOW;
        if (key === 'templateVersion') return status === 'missing' || status === 'unknown' ? DECISIONS.BLOCK : DECISIONS.BLOCK;
        if (key === 'institutionName') return DECISIONS.REQUIRE_REVIEW;
        if (key === 'schoolYear' && status === 'mismatch') {
            return source === 'filename' ? DECISIONS.REQUIRE_REVIEW : highRisk ? DECISIONS.BLOCK : DECISIONS.REQUIRE_REVIEW;
        }
        if (key === 'institutionCode' && status === 'mismatch') return highRisk ? DECISIONS.BLOCK : DECISIONS.REQUIRE_REVIEW;
        if (key === 'cycle' && status === 'mismatch') return highRisk && confidence === 'high' ? DECISIONS.BLOCK : DECISIONS.REQUIRE_REVIEW;
        if ((key === 'semester' || key === 'subject' || key === 'studentCodes') && status !== 'match') {
            return action === 'grades' || action === 'absences' ? DECISIONS.BLOCK : DECISIONS.REQUIRE_REVIEW;
        }
        return status === 'warning' || status === 'mismatch' || status === 'missing' || status === 'unknown'
            ? DECISIONS.REQUIRE_REVIEW
            : DECISIONS.ALLOW;
    }

    function apply(check, action) {
        const decision = decide({ action, key: check.key, status: check.status, confidence: check.confidence, source: check.source });
        return Object.assign(check, { decision, blocking: decision === DECISIONS.BLOCK });
    }

    return { DECISIONS, HIGH_RISK_ACTIONS, IMPORT_CONTEXT_CODES, decide, apply };
});
