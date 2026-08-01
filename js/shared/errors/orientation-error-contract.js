/**
 * orientation-error-contract.js — Hybrid orientation error vocabulary
 *
 * Single source of truth for orientation failure codes (shared + page-only).
 * Dual-export: CommonJS (main process + Node tests) and browser global
 * `OrientationErrorContract` (renderer via deferred <script>).
 *
 * Ownership rules:
 * - Shared section: IPC + both pages; main/ipc/orientation.js uses shared only.
 * - Page-only section: import/display UI only; never required by the service boundary.
 * - Core Arabic message is fixed per code; pages may add presentation context only.
 * - Pure data + pure functions — no Electron, SQLite, DOM, or showToast.
 * - Locked shared codes must not be silently renamed (see LOCKED_SHARED_CODES).
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.OrientationErrorContract = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const MAX_SKIP_REASONS = 40;
    const HARD_MAX_SKIP_REASONS = 80;
    const UNKNOWN_MESSAGE = 'حدث خطأ داخلي';

    const LOCKED_SHARED_CODES = Object.freeze([
        'INVALID_SCHOOL_YEAR',
        'INVALID_RECORD',
        'DATABASE_ERROR',
        'IMPORT_ROLLBACK',
        'LIST_LOAD_ERROR',
        'STATS_LOAD_ERROR',
        'SYNC_ERROR',
        'SCHOOL_YEAR_MISMATCH'
    ]);

    /** @type {Record<string, object>} */
    const SHARED_CODES = Object.freeze({
        INVALID_SCHOOL_YEAR: Object.freeze({
            code: 'INVALID_SCHOOL_YEAR',
            message: 'الموسم الدراسي غير صالح. الصيغة المتوقعة: YYYY/YYYY.',
            severity: 'warning',
            retryable: false,
            classification: 'validation',
            section: 'shared',
            expectsDetails: false
        }),
        INVALID_RECORD: Object.freeze({
            code: 'INVALID_RECORD',
            message: 'لا توجد صفوف صالحة للاستيراد.',
            severity: 'warning',
            retryable: false,
            classification: 'validation',
            section: 'shared',
            expectsDetails: true
        }),
        DATABASE_ERROR: Object.freeze({
            code: 'DATABASE_ERROR',
            message: 'تعذر حفظ أو قراءة سجلات التوجيه من قاعدة البيانات.',
            severity: 'error',
            retryable: true,
            classification: 'infrastructure',
            section: 'shared',
            expectsDetails: false
        }),
        IMPORT_ROLLBACK: Object.freeze({
            code: 'IMPORT_ROLLBACK',
            message: 'تم التراجع عن عملية الاستيراد بسبب خطأ. لم تُطبَّق تغييرات هذه الدفعة.',
            severity: 'error',
            retryable: true,
            classification: 'domain',
            section: 'shared',
            expectsDetails: true
        }),
        LIST_LOAD_ERROR: Object.freeze({
            code: 'LIST_LOAD_ERROR',
            message: 'تعذر تحميل قائمة التوجيه.',
            severity: 'error',
            retryable: true,
            classification: 'infrastructure',
            section: 'shared',
            expectsDetails: false
        }),
        STATS_LOAD_ERROR: Object.freeze({
            code: 'STATS_LOAD_ERROR',
            message: 'تعذر تحميل إحصائيات التوجيه.',
            severity: 'error',
            retryable: true,
            classification: 'infrastructure',
            section: 'shared',
            expectsDetails: false
        }),
        SYNC_ERROR: Object.freeze({
            code: 'SYNC_ERROR',
            message: 'تعذر تسجيل تغييرات التوجيه للمزامنة. لم تُحفظ الدفعة.',
            severity: 'error',
            retryable: true,
            classification: 'infrastructure',
            section: 'shared',
            expectsDetails: false
        }),
        SCHOOL_YEAR_MISMATCH: Object.freeze({
            code: 'SCHOOL_YEAR_MISMATCH',
            message: 'سنة أحد الصفوف لا تطابق سنة الطلب.',
            severity: 'warning',
            retryable: false,
            classification: 'validation',
            section: 'shared',
            expectsDetails: true
        })
    });

    /** @type {Record<string, object>} */
    const PAGE_ONLY_CODES = Object.freeze({
        FILE_READ_ERROR: Object.freeze({
            code: 'FILE_READ_ERROR',
            message: 'تعذر قراءة ملف التوجيه. تأكد من أن الملف غير تالف وأعد المحاولة.',
            severity: 'error',
            retryable: true,
            classification: 'transport',
            section: 'pageOnly',
            expectsDetails: false
        }),
        EMPTY_FILE: Object.freeze({
            code: 'EMPTY_FILE',
            message: 'ملف التوجيه فارغ أو لا يحتوي على بيانات قابلة للاستيراد. لم يُحفظ أي سجل.',
            severity: 'warning',
            retryable: false,
            classification: 'validation',
            section: 'pageOnly',
            expectsDetails: true
        }),
        UNSUPPORTED_FORMAT: Object.freeze({
            code: 'UNSUPPORTED_FORMAT',
            message: 'صيغة ملف التوجيه غير مدعومة. استخدم Excel أو CSV أو JSON (تصدير مسار). لم يُحفظ أي سجل.',
            severity: 'warning',
            retryable: false,
            classification: 'validation',
            section: 'pageOnly',
            expectsDetails: false
        }),
        INVALID_FILE_STRUCTURE: Object.freeze({
            code: 'INVALID_FILE_STRUCTURE',
            message: 'بنية ملف التوجيه غير صالحة أو تعذر التعرف على الأعمدة المطلوبة. لم يُحفظ أي سجل.',
            severity: 'warning',
            retryable: false,
            classification: 'validation',
            section: 'pageOnly',
            expectsDetails: false
        }),
        MISSING_STUDENT_CODE: Object.freeze({
            code: 'MISSING_STUDENT_CODE',
            message: 'رمز التلميذ (مسار) مفقود في أحد السجلات.',
            severity: 'warning',
            retryable: false,
            classification: 'validation',
            section: 'pageOnly',
            expectsDetails: true
        }),
        MISSING_ORIGIN_STREAM: Object.freeze({
            code: 'MISSING_ORIGIN_STREAM',
            message: 'الشعبة الأصلية مفقودة ولا يمكن استنتاجها من البدائل الموثقة.',
            severity: 'warning',
            retryable: false,
            classification: 'validation',
            section: 'pageOnly',
            expectsDetails: true
        }),
        INVALID_NUMERIC_VALUE: Object.freeze({
            code: 'INVALID_NUMERIC_VALUE',
            message: 'قيمة رقمية غير صالحة (المعدل أو الرتبة).',
            severity: 'warning',
            retryable: false,
            classification: 'validation',
            section: 'pageOnly',
            expectsDetails: true
        }),
        YEAR_RESPONSE_MISMATCH: Object.freeze({
            code: 'YEAR_RESPONSE_MISMATCH',
            message: 'تعارض الموسم الدراسي في استجابة الخادم. لم تُعرض بيانات غير موثوقة.',
            severity: 'warning',
            retryable: true,
            classification: 'display',
            section: 'pageOnly',
            expectsDetails: true
        }),
        STALE_RESPONSE: Object.freeze({
            code: 'STALE_RESPONSE',
            message: 'تغيّر الموسم أثناء التحميل. أُهملت الاستجابة القديمة.',
            severity: 'info',
            retryable: true,
            classification: 'display',
            section: 'pageOnly',
            expectsDetails: false
        }),
        CHART_RENDER_ERROR: Object.freeze({
            code: 'CHART_RENDER_ERROR',
            message: 'تعذر رسم المخططات. الجداول والإحصائيات النصية ما زالت متاحة.',
            severity: 'warning',
            retryable: true,
            classification: 'display',
            section: 'pageOnly',
            expectsDetails: false
        })
    });

    const ALL_CODES = Object.freeze(Object.assign({}, SHARED_CODES, PAGE_ONLY_CODES));

    const ALLOWED_DETAIL_KEYS = new Set([
        'schoolYear',
        'school_year',
        'field',
        'fieldName',
        'row',
        'rowNumber',
        'rowCount',
        'duplicateCount',
        'duplicatesInFile',
        'accepted',
        'rejected',
        'skipped',
        'inserted',
        'updated',
        'unchanged',
        'operation',
        'retryHint',
        'reasons',
        'details',
        'skipReasons',
        'phase',
        'ipcCode',
        'requested',
        'listYear',
        'statsYear',
        'fileYear',
        'selectedYear',
        'parseSkipped'
    ]);

    const ALLOWED_OPERATIONS = new Set(['list', 'stats', 'bulkUpsert', 'clearYear', 'delete']);

    function getDefinition(code) {
        if (!code) return null;
        return ALL_CODES[code] || null;
    }

    function isShared(code) {
        return !!(code && SHARED_CODES[code]);
    }

    function isPageOnly(code) {
        return !!(code && PAGE_ONLY_CODES[code]);
    }

    function isRetryable(code) {
        const def = getDefinition(code);
        return def ? !!def.retryable : true;
    }

    function getSeverity(code) {
        const def = getDefinition(code);
        return def ? def.severity : 'error';
    }

    function getDefaultMessage(code) {
        const def = getDefinition(code);
        return def ? def.message : UNKNOWN_MESSAGE;
    }

    function unknownFallback() {
        return {
            success: false,
            code: 'INTERNAL_ERROR',
            error: UNKNOWN_MESSAGE,
            message: UNKNOWN_MESSAGE,
            details: null,
            retryable: true,
            severity: 'error',
            classification: 'infrastructure',
            section: 'unknown'
        };
    }

    /**
     * Filter details to allowlisted keys; cap skip-reason arrays.
     * @param {unknown} details
     * @param {{ maxSkipReasons?: number }} [opts]
     * @returns {object|null}
     */
    function safeDetails(details, opts) {
        if (details == null) return null;
        if (typeof details !== 'object') return null;

        const maxSkip = Math.min(
            HARD_MAX_SKIP_REASONS,
            Math.max(1, Number(opts && opts.maxSkipReasons) || MAX_SKIP_REASONS)
        );

        if (Array.isArray(details)) {
            return { details: details.slice(0, maxSkip) };
        }

        const out = {};
        for (const key of Object.keys(details)) {
            if (!ALLOWED_DETAIL_KEYS.has(key)) continue;
            let value = details[key];

            if (key === 'operation') {
                const op = String(value || '');
                if (!ALLOWED_OPERATIONS.has(op)) continue;
                out.operation = op;
                continue;
            }

            if (key === 'retryHint') {
                const s = String(value || '').slice(0, 200);
                if (s) out.retryHint = s;
                continue;
            }

            if (key === 'reasons' || key === 'details' || key === 'skipReasons') {
                if (Array.isArray(value)) {
                    out[key] = value.slice(0, maxSkip);
                }
                continue;
            }

            if (
                key === 'row' ||
                key === 'rowNumber' ||
                key === 'rowCount' ||
                key === 'duplicateCount' ||
                key === 'duplicatesInFile' ||
                key === 'accepted' ||
                key === 'rejected' ||
                key === 'skipped' ||
                key === 'inserted' ||
                key === 'updated' ||
                key === 'unchanged' ||
                key === 'parseSkipped'
            ) {
                const n = Number(value);
                if (Number.isFinite(n)) out[key] = n;
                continue;
            }

            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
                out[key] = value;
            }
        }

        return Object.keys(out).length ? out : null;
    }

    function looksInternalText(message) {
        const msg = String(message || '').trim();
        if (!msg) return true;
        if (/SQLITE|ENOENT|EACCES|EPERM|ECONNREFUSED|ENOTFOUND/i.test(msg)) return true;
        if (/\.js:\d+|at\s+\S+\s+\(/i.test(msg)) return true;
        if (/^(Error:|TypeError:|SyntaxError:)/i.test(msg)) return true;
        if (/\[sync:capture\]/i.test(msg)) return true;
        return false;
    }

    /**
     * Normalize lean/rich failure or Error-like object into flat superset.
     * Success objects ({ success: true }) are returned with success true only.
     * @param {unknown} input
     */
    function normalize(input) {
        if (input == null) {
            return unknownFallback();
        }

        if (typeof input === 'object' && input.success === true) {
            return input;
        }

        const codeFromInput =
            (input && typeof input === 'object' && (input.code || input.errorCode)) || null;
        const def = codeFromInput ? getDefinition(codeFromInput) : null;

        let code = def ? def.code : null;
        if (!code && input && typeof input === 'object' && input.success === false && input.code) {
            // Known auth lean codes etc. — keep code string but use unknown messaging if not orientation
            code = String(input.code);
        }
        if (!code) {
            code = 'INTERNAL_ERROR';
        }

        const AUTH_LEAN_CODES = new Set(['UNAUTHENTICATED', 'FORBIDDEN', 'SESSION_LOCKED']);
        const catalogDef = getDefinition(code);
        const isKnown = !!catalogDef;
        const isAuthLean = AUTH_LEAN_CODES.has(code);

        const rawError = input && typeof input === 'object' ? input.error || input.message : null;
        const rawMsg = String(rawError || (input && input.message) || '').trim();

        // FR-006: unknown (non-auth) codes always normalize to generic infrastructure failure code.
        // Safe Arabic text may still be kept as the message; the stray code must not propagate.
        if (!isKnown && !isAuthLean) {
            code = 'INTERNAL_ERROR';
        }

        let safeMessage;
        if (isKnown) {
            if (rawMsg && /[\u0600-\u06FF]/.test(rawMsg) && !looksInternalText(rawMsg)) {
                safeMessage = rawMsg;
            } else {
                safeMessage = catalogDef.message;
            }
        } else if (rawMsg && /[\u0600-\u06FF]/.test(rawMsg) && !looksInternalText(rawMsg)) {
            // Keep safe Arabic product text; code already forced to INTERNAL_ERROR (or auth lean)
            safeMessage = rawMsg;
        } else {
            safeMessage = UNKNOWN_MESSAGE;
        }

        const retryableExplicit =
            input && typeof input === 'object' && typeof input.retryable === 'boolean'
                ? input.retryable
                : null;

        const detailsRaw =
            input && typeof input === 'object' && input.details != null ? input.details : null;

        return {
            success: false,
            code,
            error: safeMessage,
            message: safeMessage,
            details: safeDetails(detailsRaw),
            retryable: retryableExplicit != null ? retryableExplicit : isKnown ? !!catalogDef.retryable : true,
            severity: isKnown ? catalogDef.severity : 'error',
            classification: isKnown ? catalogDef.classification : 'infrastructure',
            section: isKnown ? catalogDef.section : 'unknown'
        };
    }

    /**
     * Baseline user message for a code or error, optionally framed with presentation context.
     * FR-002a: context appends/frames — it does not replace the core meaning.
     * Composition: `base — context` when context is non-empty and not identical to base.
     * @param {string|object} errOrCode
     * @param {string} [presentationContext]
     */
    function userMessage(errOrCode, presentationContext) {
        let base;
        if (typeof errOrCode === 'string') {
            base = getDefaultMessage(errOrCode);
        } else if (errOrCode && typeof errOrCode === 'object') {
            const n = normalize(errOrCode);
            base = n.message || n.error || UNKNOWN_MESSAGE;
        } else {
            base = UNKNOWN_MESSAGE;
        }

        const ctx = presentationContext != null ? String(presentationContext).trim() : '';
        if (!ctx || ctx === base) return base;
        return base + ' — ' + ctx;
    }

    /**
     * Lean catalog map for legacy consumers expecting { message, retryable }.
     * Shared section only.
     */
    function sharedCatalogLegacy() {
        const out = {};
        for (const code of Object.keys(SHARED_CODES)) {
            const d = SHARED_CODES[code];
            out[code] = { message: d.message, retryable: d.retryable };
        }
        return out;
    }

    return {
        SHARED_CODES,
        PAGE_ONLY_CODES,
        ALL_CODES,
        LOCKED_SHARED_CODES,
        MAX_SKIP_REASONS,
        HARD_MAX_SKIP_REASONS,
        getDefinition,
        isShared,
        isPageOnly,
        isRetryable,
        getSeverity,
        getDefaultMessage,
        normalize,
        unknownFallback,
        safeDetails,
        userMessage,
        sharedCatalogLegacy
    };
});
