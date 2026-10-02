/**
 * subject-coefficient-error-contract.js — Missing coefficient vocabulary.
 *
 * Pure data and functions for renderer, main-process, and Node-test consumers.
 * Dual-export: CommonJS and browser global `SubjectCoefficientErrorContract`.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.SubjectCoefficientErrorContract = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const CODE = 'MISSING_SUBJECT_COEFFICIENT';
    const INCOMPLETE_RESULT_CODE = 'INCOMPLETE_RESULT_MISSING_SUBJECT_COEFFICIENT';
    const UNKNOWN_CONTEXT = 'غير محدد';

    function text(rawValue) {
        const normalized = String(rawValue == null ? '' : rawValue).trim();
        return normalized || null;
    }

    function firstText(...candidateValues) {
        for (const candidateValue of candidateValues) {
            const normalized = text(candidateValue);
            if (normalized) return normalized;
        }
        return null;
    }

    function normalizeContext(context) {
        const source = context || {};
        return Object.freeze({
            cycleCode: firstText(source.cycleCode, source.cycle_code),
            cycleLabel: firstText(source.cycleLabel, source.cycle_label),
            levelCode: firstText(source.levelCode, source.level_code),
            levelLabel: firstText(source.levelLabel, source.level_label),
            streamCode: firstText(source.streamCode, source.stream_code),
            streamLabel: firstText(source.streamLabel, source.stream_label),
            subject: firstText(source.subject, source.subjectName, source.subject_name),
            normalizedSubject: firstText(source.normalizedSubject, source.normalized_subject),
            schoolYear: firstText(source.schoolYear, source.school_year, source.year)
        });
    }

    function display(contextValue) {
        return contextValue || UNKNOWN_CONTEXT;
    }

    function formatMissingSubjectCoefficientMessage(context) {
        const details = normalizeContext(context);
        return `لا يوجد معامل معتمد للمادة «${display(details.subject)}» ضمن السلك «${display(details.cycleLabel)}»، المستوى «${display(details.levelLabel)}»، المسلك «${display(details.streamLabel)}»، للسنة الدراسية «${display(details.schoolYear)}».`;
    }

    function createMissingSubjectCoefficientError(context) {
        const details = normalizeContext(context);
        const message = formatMissingSubjectCoefficientMessage(details);
        const error = new Error(message);
        error.name = 'MissingSubjectCoefficientError';
        error.code = CODE;
        error.userMessage = message;
        error.details = details;
        error.context = details;
        error.retryable = false;
        error.severity = 'error';
        error.classification = 'domain';
        error.missingCoefficient = true;
        return error;
    }

    function createIncompleteResultMetadata(missingCoefficients) {
        const entries = Array.isArray(missingCoefficients) ? missingCoefficients : [];
        return {
            status: 'incomplete',
            code: INCOMPLETE_RESULT_CODE,
            reason: CODE,
            officialExportBlocked: true,
            missingCoefficients: entries.map((entry) => normalizeContext(entry))
        };
    }

    function createMissingSubjectCoefficientResult(context) {
        const error = createMissingSubjectCoefficientError(context);
        const metadata = createIncompleteResultMetadata([error.details]);
        return {
            ok: false,
            success: false,
            incomplete: true,
            code: CODE,
            message: error.userMessage,
            error,
            details: error.details,
            missingCoefficients: metadata.missingCoefficients,
            metadata
        };
    }

    function isOfficialExportAllowed(result) {
        return !(result?.incomplete === true || result?.metadata?.officialExportBlocked === true);
    }

    return {
        CODE,
        INCOMPLETE_RESULT_CODE,
        normalizeContext,
        formatMissingSubjectCoefficientMessage,
        createMissingSubjectCoefficientError,
        createIncompleteResultMetadata,
        createMissingSubjectCoefficientResult,
        isOfficialExportAllowed
    };
});
