/*
 * import-diagnostics-codes.js — single source of truth for the parse
 * diagnostic codes emitted by the import parsers and shared consumers
 * (review F12a: INVALID_GRADE previously existed as two independent literals).
 * Dual-export: window.ImportCenterDiagnostics + module.exports.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.ImportCenterDiagnostics = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const CODES = Object.freeze({
        INVALID_GRADE: 'INVALID_GRADE',
        STUDENT_CODE_COLUMN_MISSING: 'STUDENT_CODE_COLUMN_MISSING',
        LEVEL_UNRESOLVED: 'LEVEL_UNRESOLVED',
        DUPLICATE_STUDENT_CODE: 'DUPLICATE_STUDENT_CODE',
        NO_VALID_STUDENTS: 'NO_VALID_STUDENTS',
        SCHOOL_NAME_MISSING: 'SCHOOL_NAME_MISSING',
        CONFIGURED_SCHOOL_MISSING: 'CONFIGURED_SCHOOL_MISSING',
        MULTIPLE_SCHOOLS: 'MULTIPLE_SCHOOLS',
        SCHOOL_MISMATCH: 'SCHOOL_MISMATCH',
        SEMESTER_UNRESOLVED: 'SEMESTER_UNRESOLVED',
        SUBJECT_UNRESOLVED: 'SUBJECT_UNRESOLVED',
        GRADE_COLUMNS_NOT_FOUND: 'GRADE_COLUMNS_NOT_FOUND',
        ASSESSMENT_UNRESOLVED: 'ASSESSMENT_UNRESOLVED',
        STUDENT_CODE_MISSING: 'STUDENT_CODE_MISSING',
        UNKNOWN_STUDENT: 'UNKNOWN_STUDENT',
        MISSING_CODE_HEADER: 'MISSING_CODE_HEADER',
        WEAK_GRADES_HEADERS: 'WEAK_GRADES_HEADERS',
        WEAK_ABSENCE_HEADERS: 'WEAK_ABSENCE_HEADERS',
        WEAK_STATUS_HEADER: 'WEAK_STATUS_HEADER',
        MISSING_CODE: 'MISSING_CODE',
        INVALID_HOURS: 'INVALID_HOURS',
        DUPLICATE_CODE: 'DUPLICATE_CODE',
        UNRESOLVED_NAME: 'UNRESOLVED_NAME',
        NAME_MATCH: 'NAME_MATCH',
        ZERO_VALID_ROWS: 'ZERO_VALID_ROWS',
        UNKNOWN_XML_ROOT: 'UNKNOWN_XML_ROOT',
        MISSING_TEACHER_ELEMENTS: 'MISSING_TEACHER_ELEMENTS',
        WEAK_AGENT_STRUCTURE: 'WEAK_AGENT_STRUCTURE',
        AMBIGUOUS_HEADER_BINDING: 'AMBIGUOUS_HEADER_BINDING',
        XML_TRUNCATED: 'XML_TRUNCATED',
        DUPLICATE_GRADE: 'DUPLICATE_GRADE'
    });

    function has(code) {
        return Object.prototype.hasOwnProperty.call(CODES, code);
    }

    const api = Object.assign({ CODES, has }, CODES);
    return Object.freeze(api);
});
