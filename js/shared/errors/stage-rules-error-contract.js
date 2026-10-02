/**
 * stage-rules-error-contract.js — Stage rules error vocabulary.
 *
 * Pure data and functions for renderer, main-process, and Node-test consumers.
 * Dual-export: CommonJS and browser global `StageRulesErrorContract`.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.StageRulesErrorContract = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const RULES_UNAVAILABLE = 'RULES_UNAVAILABLE';
    const MISSING_RULE = 'MISSING_RULE';
    const RULES_INPUT_INVALID = 'RULES_INPUT_INVALID';
    const INVALID_RULE_VERSION = 'INVALID_RULE_VERSION';
    const CONFIRM_REQUIRED = 'CONFIRM_REQUIRED';
    const REASON_REQUIRED = 'REASON_REQUIRED';
    const COEFFICIENT_OUT_OF_RANGE = 'COEFFICIENT_OUT_OF_RANGE';
    const EXAM_COUNT_OUT_OF_RANGE = 'EXAM_COUNT_OUT_OF_RANGE';
    const SUBJECT_WEIGHT_OUT_OF_RANGE = 'SUBJECT_WEIGHT_OUT_OF_RANGE';
    const UNKNOWN_MESSAGE = 'حدث خطأ في إدارة قواعد المرحلة.';

    /** @type {Record<string, object>} */
    const ERROR_CATALOG = Object.freeze({
        RULES_UNAVAILABLE: Object.freeze({
            code: RULES_UNAVAILABLE,
            message: 'لا تتوفر نسخة قواعد فعالة لهذه السنة الدراسية.',
            severity: 'error',
            retryable: false,
            classification: 'domain'
        }),
        MISSING_RULE: Object.freeze({
            code: MISSING_RULE,
            message: 'لا توجد قاعدة معامل لهذه المادة.',
            severity: 'error',
            retryable: false,
            classification: 'domain'
        }),
        RULES_INPUT_INVALID: Object.freeze({
            code: RULES_INPUT_INVALID,
            message: 'المدخلات غير صالحة — تحقق من اكتمال بيانات القواعد.',
            severity: 'error',
            retryable: false,
            classification: 'validation'
        }),
        INVALID_RULE_VERSION: Object.freeze({
            code: INVALID_RULE_VERSION,
            message: 'لا يمكن تعديل نسخة قواعد مغلقة.',
            severity: 'error',
            retryable: false,
            classification: 'domain'
        }),
        CONFIRM_REQUIRED: Object.freeze({
            code: CONFIRM_REQUIRED,
            message: 'هذا الإجراء يتطلب تأكيداً صريحاً.',
            severity: 'error',
            retryable: false,
            classification: 'domain'
        }),
        REASON_REQUIRED: Object.freeze({
            code: REASON_REQUIRED,
            message: 'يجب إدخال سبب التعديل.',
            severity: 'error',
            retryable: false,
            classification: 'domain'
        }),
        COEFFICIENT_OUT_OF_RANGE: Object.freeze({
            code: COEFFICIENT_OUT_OF_RANGE,
            message: 'قيمة المعامل خارج النطاق المسموح (من 1 إلى 20).',
            severity: 'error',
            retryable: false,
            classification: 'domain'
        }),
        EXAM_COUNT_OUT_OF_RANGE: Object.freeze({
            code: EXAM_COUNT_OUT_OF_RANGE,
            message: 'عدد الفروض خارج النطاق المسموح (من 1 إلى 12).',
            severity: 'error',
            retryable: false,
            classification: 'domain'
        }),
        SUBJECT_WEIGHT_OUT_OF_RANGE: Object.freeze({
            code: SUBJECT_WEIGHT_OUT_OF_RANGE,
            message: 'يجب أن تكون نسبتا الفروض والأنشطة بين 0 و100% ومجموعهما 100%.',
            severity: 'error',
            retryable: false,
            classification: 'domain'
        })
    });

    function getDefinition(code) {
        return ERROR_CATALOG[code] || null;
    }

    function getMessage(code) {
        const definition = getDefinition(code);
        return definition ? definition.message : UNKNOWN_MESSAGE;
    }

    /**
     * Error-shaped value consumed by the renderer/main error plumbing.
     * @returns {{ code: string, message: string, severity: string, retryable: boolean, classification: string, details: * }}
     */
    function createError(code, details) {
        return {
            code,
            message: getMessage(code),
            severity: 'error',
            retryable: false,
            classification: 'domain',
            details
        };
    }

    function createIncompleteResultMetadata(missing) {
        const missingRules = Array.isArray(missing) ? missing : [];
        return {
            status: 'incomplete',
            code: MISSING_RULE,
            reason: 'missing_rule',
            officialExportBlocked: true,
            missingRules
        };
    }

    function createRulesUnavailableResult(context) {
        const error = createError(RULES_UNAVAILABLE, context);
        return {
            ok: false,
            incomplete: true,
            code: RULES_UNAVAILABLE,
            officialExportBlocked: true,
            error,
            metadata: {
                status: 'incomplete',
                code: RULES_UNAVAILABLE,
                officialExportBlocked: true
            }
        };
    }

    function isOfficialExportAllowed(result) {
        return !(
            result &&
            (result.incomplete === true ||
                (result.metadata && result.metadata.officialExportBlocked === true))
        );
    }

    function looksLikeInternalMessage(message) {
        const msg = String(message || '').trim();
        if (!msg) return true;
        if (/SQLITE|ENOENT|EACCES|EPERM|ECONNREFUSED|ENOTFOUND/i.test(msg)) return true;
        if (/\.js:\d+|at\s+\S+\s+\(/i.test(msg)) return true;
        if (/^(Error:|TypeError:|SyntaxError:)/i.test(msg)) return true;
        if (/\[sync:capture\]/i.test(msg)) return true;
        return false;
    }

    /**
     * Renderer-facing message resolution: prefer the server message when it is
     * present and safe (Arabic, not internal plumbing), use the catalog only as the
     * fallback. Replaces the reverse-drift logic that preferred catalog text over
     * the server's more specific message.
     * @param {{ code?: string, errorCode?: string, error?: string, message?: string }} response
     */
    function renderErrorMessage(response) {
        const raw = response && typeof response === 'object' ? response : {};
        const serverMessage = String(raw.error || raw.message || '').trim();
        if (serverMessage && /[\u0600-\u06FF]/.test(serverMessage) && !looksLikeInternalMessage(serverMessage)) {
            return serverMessage;
        }
        const code = String(raw.code || raw.errorCode || '').trim();
        const def = getDefinition(code);
        return (def && def.message) || serverMessage || UNKNOWN_MESSAGE;
    }

    return {
        RULES_UNAVAILABLE,
        MISSING_RULE,
        RULES_INPUT_INVALID,
        INVALID_RULE_VERSION,
        CONFIRM_REQUIRED,
        REASON_REQUIRED,
        COEFFICIENT_OUT_OF_RANGE,
        EXAM_COUNT_OUT_OF_RANGE,
        SUBJECT_WEIGHT_OUT_OF_RANGE,
        UNKNOWN_MESSAGE,
        ERROR_CATALOG,
        getDefinition,
        getMessage,
        createError,
        createIncompleteResultMetadata,
        createRulesUnavailableResult,
        isOfficialExportAllowed,
        renderErrorMessage
    };
});
