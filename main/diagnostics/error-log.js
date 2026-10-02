'use strict';

/**
 * Application Error Log — main/diagnostics/error-log.js
 *
 * سجل أخطاء دائم (JSONL) لكل المستخدمين، يُكتب تلقائياً بلا تدخّل في
 * userData/logs/app-errors.log. الهدف: يصدّره المستخدم لاحقاً ويرفعه للتشخيص.
 *
 * يختلف عن main/sync/conflict-forensics.js في أنه:
 *   - دائم التشغيل (بلا متغيّر بيئة SYNC_CONFLICT_FORENSICS).
 *   - عام لكل مصادر الأخطاء (main / ipc / renderer)، لا للتعارضات فقط.
 *   - غير مقيّد بصلاحيات — يُستدعى من أي طبقة.
 *
 * كل سطر JSON يحوي: ts, source, action, message, stack, page, extra.
 *
 * ⚠️ الكتابة متزامنة (appendFileSync) عمداً: قد تُستدعى داخل معالج
 * uncaughtException الذي يُنهي العملية فوراً، فأي كتابة غير متزامنة ستُفقد.
 * الدالة لا ترمي أبداً — التسجيل تشخيصي ولا يجب أن يُعطّل التطبيق.
 */

const fs = require('fs');

const { SENSITIVE_FIELDS } = require('../sync/capture');
const logIo = require('./log-file-io');

const MAX_LOG_BYTES = logIo.DEFAULT_MAX_LOG_BYTES;
const MAX_ROTATED_FILES = logIo.DEFAULT_MAX_ROTATED_FILES;
const MAX_MESSAGE_CHARS = 1024;
const MAX_STACK_CHARS = 8192;

const _pathState = { path: null };

function resolveErrorLogPath() {
    return logIo.resolveUserDataLogPath('app-errors.log', _pathState);
}

function getErrorLogFiles() {
    return logIo.getRotatedLogFiles(resolveErrorLogPath(), MAX_ROTATED_FILES);
}

function stripSensitive(data) {
    return logIo.stripSensitive(data, SENSITIVE_FIELDS);
}

function safeParse(value) {
    return logIo.safeParse(value);
}

function truncate(value, max) {
    return logIo.truncate(value, max);
}

/**
 * يسجّل سطراً واحداً (JSONL). آمن تماماً: لا يرمي أبداً.
 *
 * @param {object} record
 * @param {'main'|'ipc'|'renderer'|string} [record.source]
 * @param {string} [record.action]  اسم القناة/الحدث
 * @param {string} [record.message]
 * @param {string} [record.stack]
 * @param {string} [record.page]    مسار الصفحة (لأخطاء الواجهة)
 * @param {*}      [record.extra]    بيانات إضافية (تُجرَّد الحقول الحسّاسة منها)
 */
function logAppError(record = {}) {
    const filePath = resolveErrorLogPath();
    if (!filePath) return;

    try {
        const entry = {
            ts: new Date().toISOString(),
            source: record.source || 'unknown',
            action: record.action || null,
            message: truncate(record.message, MAX_MESSAGE_CHARS),
            stack: truncate(record.stack, MAX_STACK_CHARS),
            page: record.page || null,
            extra: record.extra !== undefined ? stripSensitive(safeParse(record.extra) ?? record.extra) : null
        };

        const ok = logIo.appendJsonl(filePath, entry, {
            maxBytes: MAX_LOG_BYTES,
            maxRotated: MAX_ROTATED_FILES
        });
        if (!ok) {
            try {
                console.warn('[diagnostics:error-log] Failed to write log line');
            } catch (_) {
                /* console unavailable — swallow */
            }
        }
    } catch (err) {
        // التسجيل تشخيصي فقط — لا يجب أن يُعطّل التطبيق أبداً
        try {
            console.warn('[diagnostics:error-log] Failed to write:', err.message);
        } catch (_) {
            /* console unavailable — swallow */
        }
    }
}

/**
 * يقرأ الأسطر الأحدث من ملف السجل (والمُدوَّرة)، الأحدث أولاً. لا يرمي أبداً.
 *
 * @param {object} [options]
 * @param {number} [options.maxLines=500]
 * @returns {{ available: boolean, logPath: string|null, total: number, entries: object[] }}
 */
function readRecentErrors(options = {}) {
    const maxLines = Number(options.maxLines) || 500;
    const logPath = resolveErrorLogPath();
    const result = { available: false, logPath: logPath || null, total: 0, entries: [] };
    if (!logPath) return result;

    const files = getErrorLogFiles();
    if (!files.length) return result;
    result.available = true;

    let lines = [];
    for (const file of files) {
        try {
            const content = fs.readFileSync(file, 'utf8');
            lines = lines.concat(content.split('\n').filter((l) => l.trim()));
        } catch (_) {
            /* skip unreadable file */
        }
    }

    result.total = lines.length;
    if (lines.length > maxLines) {
        lines = lines.slice(lines.length - maxLines);
    }

    // Newest first — parse safely, keep raw for unparseable lines
    result.entries = lines
        .reverse()
        .map((line) => safeParse(line) || { ts: null, source: 'unparsed', message: line });

    return result;
}

module.exports = {
    resolveErrorLogPath,
    getErrorLogFiles,
    logAppError,
    readRecentErrors,
    stripSensitive,
    safeParse,
    // exported for tests
    MAX_LOG_BYTES,
    MAX_ROTATED_FILES,
    MAX_MESSAGE_CHARS,
    MAX_STACK_CHARS
};
