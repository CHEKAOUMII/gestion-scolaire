/**
 * cycle-access-error-contract.js — Cycle-access error vocabulary (multi-stage S6).
 *
 * Single source of truth for user_cycle_access failure codes. IPC handlers, the
 * repo layer (main/auth/cycle-access.js), renderer pages, and Node tests all
 * consume this catalog — never a parallel copy at the throw sites.
 *
 * Dual-export: CommonJS (main process + Node tests) and browser global
 * `CycleAccessErrorContract` (renderer via deferred <script>).
 *
 * Ownership rules:
 * - The core Arabic message is fixed per code; throw sites may add presentation
 *   context only (they keep their specific sentences — the contract is the safe
 *   fallback text the UI uses when no specific server message arrives).
 * - Pure data + pure functions — no Electron, SQLite, DOM, or showToast.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.CycleAccessErrorContract = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const UNKNOWN_MESSAGE = 'حدث خطأ في إدارة صلاحيات الأسلاك.';

    /** SSOT code constants — shared verbatim with main/auth/cycle-access.js. */
    const CYCLE_ACCESS_ERROR_CODES = Object.freeze({
        USER_NOT_FOUND: 'USER_NOT_FOUND',
        UNKNOWN_CYCLE: 'UNKNOWN_CYCLE',
        CYCLE_NOT_IN_INSTITUTION: 'CYCLE_NOT_IN_INSTITUTION',
        FORBIDDEN: 'FORBIDDEN',
        LAST_USABLE_CYCLE: 'LAST_USABLE_CYCLE',
        CYCLE_ACCESS_SCHEMA_REQUIRED: 'CYCLE_ACCESS_SCHEMA_REQUIRED'
    });

    /** @type {Record<string, object>} */
    const ERROR_CATALOG = Object.freeze({
        USER_NOT_FOUND: Object.freeze({
            code: CYCLE_ACCESS_ERROR_CODES.USER_NOT_FOUND,
            message: 'المستخدم غير موجود.',
            severity: 'error',
            retryable: false,
            classification: 'validation'
        }),
        UNKNOWN_CYCLE: Object.freeze({
            code: CYCLE_ACCESS_ERROR_CODES.UNKNOWN_CYCLE,
            message: 'السلك التعليمي غير معروف.',
            severity: 'error',
            retryable: false,
            classification: 'validation'
        }),
        CYCLE_NOT_IN_INSTITUTION: Object.freeze({
            code: CYCLE_ACCESS_ERROR_CODES.CYCLE_NOT_IN_INSTITUTION,
            message: 'السلك غير مضاف إلى المؤسسة.',
            severity: 'error',
            retryable: false,
            classification: 'validation'
        }),
        FORBIDDEN: Object.freeze({
            code: CYCLE_ACCESS_ERROR_CODES.FORBIDDEN,
            message: 'ليس لديك صلاحية للعمل داخل هذا السلك.',
            severity: 'error',
            retryable: false,
            classification: 'authorization'
        }),
        LAST_USABLE_CYCLE: Object.freeze({
            code: CYCLE_ACCESS_ERROR_CODES.LAST_USABLE_CYCLE,
            message: 'لا يمكن سحب آخر سلك مفعل جاهز للعمل لهذا المستخدم.',
            severity: 'error',
            retryable: false,
            classification: 'domain'
        }),
        CYCLE_ACCESS_SCHEMA_REQUIRED: Object.freeze({
            code: CYCLE_ACCESS_ERROR_CODES.CYCLE_ACCESS_SCHEMA_REQUIRED,
            message: 'لم يتم إعداد صلاحيات الأسلاك لهذه المؤسسة بعد.',
            severity: 'error',
            retryable: false,
            classification: 'infrastructure'
        })
    });

    function getDefinition(code) {
        return ERROR_CATALOG[code] || null;
    }

    function getMessage(code) {
        const definition = getDefinition(code);
        return definition ? definition.message : UNKNOWN_MESSAGE;
    }

    /** Recognized auth-lean codes that always pass through untouched. */
    const AUTH_LEAN_CODES = new Set(['UNAUTHENTICATED', 'FORBIDDEN', 'SESSION_LOCKED']);

    /**
     * Normalize a thrown error or IPC-like response into the flat failure shape
     * `{ success:false, code, error, message, retryable, severity, classification }`.
     * Known cycle-access codes keep their code and catalog message; auth-lean codes
     * pass through; anything else collapses to `INTERNAL_ERROR`.
     * @param {*} err
     */
    function normalize(err) {
        const rawCode = err && typeof err === 'object' ? String(err.code || err.errorCode || '') : '';
        let code;
        if (AUTH_LEAN_CODES.has(rawCode) || getDefinition(rawCode)) {
            code = rawCode;
        } else {
            code = 'INTERNAL_ERROR';
        }

        const rawMsg = String((err && err.message) || (err && err.error) || '').trim();
        const safeArabic = rawMsg && /[\u0600-\u06FF]/.test(rawMsg);
        let message;
        if (code !== 'INTERNAL_ERROR') {
            message = safeArabic ? rawMsg : getMessage(code);
        } else {
            message = safeArabic && !/SQLITE|ENOENT|EACCES|EPERM|ECONNREFUSED|ENOTFOUND/i.test(rawMsg)
                ? rawMsg
                : UNKNOWN_MESSAGE;
        }

        return { success: false, code, error: message, message, retryable: false, severity: 'error', classification: 'domain' };
    }

    return {
        CYCLE_ACCESS_ERROR_CODES,
        UNKNOWN_MESSAGE,
        ERROR_CATALOG,
        getDefinition,
        getMessage,
        normalize
    };
});