/**
 * stage-config-error-contract.js — Stage-scoped configuration error vocabulary.
 *
 * Single source of truth for stage-config (calendar / terms / attendance rules)
 * failure codes. The repo layer (main/repos/stage-config.js), future IPC
 * handlers, renderer pages, and Node tests all consume this catalog — never a
 * parallel copy at the throw sites.
 *
 * Dual-export: CommonJS (main process + Node tests) and browser global
 * `StageConfigErrorContract` (renderer via deferred <script>).
 *
 * Ownership rules:
 * - The core Arabic message is fixed per code; throw sites may add presentation
 *   context only.
 * - Pure data + pure functions — no Electron, SQLite, DOM, or showToast.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.StageConfigErrorContract = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const UNKNOWN_MESSAGE = 'حدث خطأ في إعدادات المرحلة.';

    /** SSOT code constants — shared verbatim with main/repos/stage-config.js. */
    const STAGE_CONFIG_ERROR_CODES = Object.freeze({
        UNKNOWN_CYCLE: 'UNKNOWN_CYCLE',
        STAGE_CONFIG_MISSING: 'STAGE_CONFIG_MISSING',
        STAGE_CONFIG_INVALID: 'STAGE_CONFIG_INVALID'
    });

    /** @type {Record<string, object>} */
    const ERROR_CATALOG = Object.freeze({
        UNKNOWN_CYCLE: Object.freeze({
            code: STAGE_CONFIG_ERROR_CODES.UNKNOWN_CYCLE,
            message: 'السلك التعليمي غير معروف.',
            severity: 'error',
            retryable: false,
            classification: 'validation'
        }),
        STAGE_CONFIG_MISSING: Object.freeze({
            code: STAGE_CONFIG_ERROR_CODES.STAGE_CONFIG_MISSING,
            message: 'لا يوجد إعداد لهذا السلك في هذه السنة الدراسية.',
            severity: 'error',
            retryable: false,
            classification: 'domain'
        }),
        STAGE_CONFIG_INVALID: Object.freeze({
            code: STAGE_CONFIG_ERROR_CODES.STAGE_CONFIG_INVALID,
            message: 'بيانات إعداد المرحلة غير صالحة.',
            severity: 'error',
            retryable: false,
            classification: 'validation'
        })
    });

    function getDefinition(code) {
        return ERROR_CATALOG[code] || null;
    }

    function getMessage(code) {
        const definition = getDefinition(code);
        return definition ? definition.message : UNKNOWN_MESSAGE;
    }

    return {
        STAGE_CONFIG_ERROR_CODES,
        UNKNOWN_MESSAGE,
        ERROR_CATALOG,
        getDefinition,
        getMessage
    };
});
