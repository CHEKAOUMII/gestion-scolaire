/**
 * import-result-contract.js — Safe user-facing results for manual imports.
 *
 * Raw exceptions stay in the console/technical logger. The renderer receives a
 * stable Arabic message and explicit save-state flags.
 * Dual-export: window.ImportResultContract + module.exports.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.ImportResultContract = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const TECHNICAL_ERROR = /SQLITE|SQLITE_CONSTRAINT|database|stack|\.js:\d+|node_modules|electron|ipc|ENOENT|EACCES|EPERM|at\s+\w+\s+\(/i;
    const ARABIC_ERROR = /[\u0600-\u06FF]/;

    const CODE_MESSAGES = Object.freeze({
        SCHOOL_YEAR_MISMATCH: 'السنة الدراسية في الملف لا تطابق السنة المختارة.',
        INSTITUTION_CODE_MISMATCH: 'رمز المؤسسة في الملف لا يطابق المؤسسة الحالية.',
        CYCLE_MISMATCH: 'السلك التعليمي في الملف لا يطابق السلك النشط.',
        UNKNOWN_STUDENT_CODES: 'يحتوي الملف على رموز تلاميذ غير موجودة في السلك النشط.',
        DESTINATION_CONTEXT_UNAVAILABLE: 'تعذر التحقق من وجهة الحفظ الحالية. لم يبدأ الاستيراد.',
        TEMPLATE_UNKNOWN: 'تعذر التحقق من نوع أو نسخة قالب الاستيراد.',
        TEMPLATE_MISMATCH: 'نوع أو نسخة قالب الاستيراد لا تطابق العملية المختارة.',
        SEMESTER_UNRESOLVED: 'تعذر تحديد الدورة الدراسية من ملف النقط.',
        SUBJECT_UNRESOLVED: 'تعذر تحديد المادة الدراسية من ملف النقط.',
        FILE_READ_ERROR: 'تعذر قراءة الملف. تأكد من أنه غير تالف ثم أعد المحاولة.',
        INVALID_FILE_STRUCTURE: 'بنية الملف غير صالحة أو لا تحتوي على الأعمدة المطلوبة.',
        EMPTY_FILE: 'الملف فارغ أو لا يحتوي على سجلات قابلة للاستيراد.',
        STUDENT_IMPORT_INVALID: 'تعذر التحقق من ملف التلاميذ.',
        DATABASE_ERROR: 'تعذر حفظ البيانات في قاعدة المؤسسة.',
        IMPORT_ROLLBACK: 'تم التراجع عن العملية؛ لم تُطبّق تغييرات هذه الدفعة.',
        IMPORT_UNAVAILABLE: 'واجهة الاستيراد غير متاحة في هذا الإصدار.',
        UNKNOWN: 'تعذر إتمام الاستيراد.'
    });

    function safeText(value) {
        const valueText = String(value == null ? '' : value).trim();
        if (!valueText || TECHNICAL_ERROR.test(valueText) || !ARABIC_ERROR.test(valueText)) return '';
        return valueText.slice(0, 500);
    }

    function codeFrom(error) {
        return String(error?.code || '').trim() || 'UNKNOWN';
    }

    function normalizeError(error, context) {
        const err = error || {};
        const code = codeFrom(err);
        const baseMessage = CODE_MESSAGES[code] || safeText(err.userMessage) || safeText(err.message) || CODE_MESSAGES.UNKNOWN;
        const fileName = String(context?.fileName || err.fileName || '').trim();
        const actionLabel = String(context?.actionLabel || '').trim();
        const noRecordsSaved =
            err.noRecordsSaved === true || (err.noRecordsSaved !== false && err.partialCommit !== true);
        const partialCommit = err.partialCommit === true;
        const savedState = partialCommit
            ? 'تم حفظ جزء من البيانات؛ راجع التقرير قبل إعادة المحاولة.'
            : noRecordsSaved
              ? 'لم تُحفظ أي بيانات من هذا الملف.'
              : 'قد تكون بعض البيانات قد حُفظت؛ راجع التقرير قبل إعادة المحاولة.';
        const unmatchedCount = Array.isArray(err.details?.codes) ? err.details.codes.length : 0;
        const contextualMessage = unmatchedCount
            ? `${baseMessage} عدد الرموز غير المطابقة المعروضة: ${unmatchedCount}.`
            : baseMessage;
        const prefix = fileName ? `الملف «${fileName}»: ` : actionLabel ? `${actionLabel}: ` : '';
        const nextStep = code === 'SCHOOL_YEAR_MISMATCH' || code === 'INSTITUTION_CODE_MISMATCH' || code === 'CYCLE_MISMATCH'
            ? 'غيّر السنة أو اختر ملف المؤسسة والسلك الصحيحين ثم أعد المحاولة.'
            : code === 'UNKNOWN_STUDENT_CODES'
              ? 'راجع رموز التلاميذ في الملف واستورد لائحة التلاميذ الصحيحة أولاً.'
              : code === 'FILE_READ_ERROR' || code === 'INVALID_FILE_STRUCTURE'
              ? 'تحقق من نوع الملف ورؤوس الأعمدة ثم أعد التصدير.'
              : 'صحح الملف أو أعد المحاولة بعد مراجعة التقرير.';

        return {
            success: false,
            code,
            severity: err.severity || 'error',
            retryable: err.retryable !== false,
            userMessage: `${prefix}${contextualMessage} ${savedState} ${nextStep}`.trim(),
            details: {
                fileName: fileName || null,
                sheet: err.details?.sheet || err.sheet || null,
                row: err.details?.row || err.row || null,
                field: err.details?.field || err.field || null,
                sourceContext: context?.sourceContext || null,
                destinationContext: context?.destinationContext || null,
                unmatchedCount: unmatchedCount || null
            },
            noRecordsSaved,
            partialCommit,
            parsed: Number(err.parsed ?? err.counts?.parsed ?? 0),
            saved: Number(err.saved ?? err.counts?.saved ?? 0),
            updated: Number(err.updated ?? err.counts?.updated ?? 0),
            skipped: Number(err.skipped ?? err.counts?.skipped ?? 0),
            failed: Number(err.failed ?? err.counts?.failed ?? 1)
        };
    }

    function message(error, context) {
        return normalizeError(error, context).userMessage;
    }

    function createContextError(code, details, options) {
        const opts = options || {};
        const error = new Error(CODE_MESSAGES[code] || CODE_MESSAGES.UNKNOWN);
        error.code = code;
        error.details = details || null;
        error.noRecordsSaved = opts.noRecordsSaved !== false;
        error.partialCommit = opts.partialCommit === true;
        error.retryable = opts.retryable !== false;
        error.severity = opts.severity || 'error';
        return error;
    }

    function outcomeSummary(result) {
        const value = result || {};
        const parts = [];
        if (value.parsed != null) parts.push(`قُرئ ${value.parsed}`);
        if (value.saved != null) parts.push(`حُفظ ${value.saved}`);
        if (value.updated != null) parts.push(`حُدّث ${value.updated}`);
        if (value.skipped != null) parts.push(`تُخطّي ${value.skipped}`);
        if (value.failed != null) parts.push(`فشل ${value.failed}`);
        return parts.join('، ');
    }

    return {
        CODE_MESSAGES,
        safeText,
        normalizeError,
        message,
        createContextError,
        outcomeSummary
    };
});
