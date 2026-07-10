'use strict';

/**
 * Sync Conflict Forensics Logger — main/sync/conflict-forensics.js
 *
 * طبقة تسجيل جنائي للتعارضات: تكتب سطراً لكل تعارض (رفع/سحب) في ملف JSONL
 * مخصّص داخل userData/logs/sync-conflicts.log لكشف السبب الجذري الحقيقي.
 *
 * التفعيل: متغيّر البيئة SYNC_CONFLICT_FORENSICS=1 (معطّل افتراضياً في الإنتاج).
 *
 * كل سطر JSON يحوي:
 *   ts, phase ('push'|'pull'), table, rowSyncId, entityType,
 *   localVersion, remoteVersion, ancestorPresent, conflictingFields,
 *   localTs, remoteTs, resolution, remoteDeviceHash, note
 *
 * الحقول الحساسة (SENSITIVE_FIELDS) تُجرَّد قبل أي تسجيل لقيم البيانات.
 */

const fs = require('fs');

const { SENSITIVE_FIELDS } = require('./capture');
const logIo = require('../diagnostics/log-file-io');

const MAX_LOG_BYTES = logIo.DEFAULT_MAX_LOG_BYTES;
const MAX_ROTATED_FILES = logIo.DEFAULT_MAX_ROTATED_FILES;

const _pathState = { path: null };
let _enabledCache = null;

function isForensicsEnabled() {
    if (_enabledCache !== null) return _enabledCache;
    _enabledCache = String(process.env.SYNC_CONFLICT_FORENSICS || '').trim() === '1';
    return _enabledCache;
}

function resolveLogFilePath() {
    return logIo.resolveUserDataLogPath('sync-conflicts.log', _pathState);
}

function stripSensitive(data) {
    return logIo.stripSensitive(data, SENSITIVE_FIELDS);
}

function safeParse(value) {
    return logIo.safeParse(value);
}

/**
 * يسجّل سطراً جنائياً واحداً (JSONL). آمن تماماً: لا يرمي أبداً.
 *
 * @param {object} record
 * @param {'push'|'pull'} record.phase
 * @param {string} [record.table]
 * @param {string} [record.rowSyncId]
 * @param {string} [record.entityType]
 * @param {number} [record.localVersion]
 * @param {number} [record.remoteVersion]
 * @param {boolean} [record.ancestorPresent]
 * @param {string[]} [record.conflictingFields]
 * @param {number} [record.localTs]
 * @param {number} [record.remoteTs]
 * @param {string} [record.resolution]
 * @param {string} [record.remoteDeviceHash]
 * @param {string} [record.note]
 */
function logConflictForensics(record = {}) {
    if (!isForensicsEnabled()) return;

    const filePath = resolveLogFilePath();
    if (!filePath) return;

    try {
        const entry = {
            ts: new Date().toISOString(),
            phase: record.phase || 'unknown',
            table: record.table || null,
            rowSyncId: record.rowSyncId || null,
            entityType: record.entityType || null,
            localVersion: record.localVersion ?? null,
            remoteVersion: record.remoteVersion ?? null,
            ancestorPresent: record.ancestorPresent === true,
            conflictingFields: Array.isArray(record.conflictingFields) ? record.conflictingFields : [],
            localTs: record.localTs ?? null,
            remoteTs: record.remoteTs ?? null,
            tsSkewSec:
                Number.isFinite(record.localTs) && Number.isFinite(record.remoteTs)
                    ? record.localTs - record.remoteTs
                    : null,
            resolution: record.resolution || null,
            remoteDeviceHash: record.remoteDeviceHash || null,
            note: record.note || null
        };

        const ok = logIo.appendJsonl(filePath, entry, {
            maxBytes: MAX_LOG_BYTES,
            maxRotated: MAX_ROTATED_FILES
        });
        if (!ok) {
            console.warn('[sync:forensics] Failed to write conflict log line');
        }
    } catch (err) {
        // التسجيل تشخيصي فقط — لا يجب أن يُعطّل المزامنة أبداً
        console.warn('[sync:forensics] Failed to write conflict log:', err.message);
    }
}

/**
 * يقرأ ملف اللوغ (والملفات المُدوَّرة) ويُلخّص التعارضات حسب النمط.
 * يُرجِع ملخّصاً جاهزاً للعرض في الواجهة.
 *
 * @param {object} [options]
 * @param {number} [options.maxLines=5000] أقصى عدد أسطر تُقرأ (الأحدث).
 * @returns {{
 *   available: boolean,
 *   enabled: boolean,
 *   logPath: string|null,
 *   total: number,
 *   parseErrors: number,
 *   byPhase: object,
 *   byTable: object,
 *   byResolution: object,
 *   noAncestorCount: number,
 *   noAncestorPct: number,
 *   clockSkew: { max: number|null, min: number|null, suspicious: number },
 *   repeatedRows: Array<{rowSyncId: string, table: string, count: number, maxRemoteVersion: number, minLocalVersion: number}>,
 *   topConflictingFields: Array<{field: string, count: number}>,
 *   diagnoses: string[],
 *   recent: object[]
 * }}
 */
function analyzeConflictForensics(options = {}) {
    const maxLines = Number(options.maxLines) || 5000;
    const logPath = resolveLogFilePath();
    const result = {
        available: false,
        enabled: isForensicsEnabled(),
        logPath: logPath || null,
        total: 0,
        parseErrors: 0,
        byPhase: {},
        byTable: {},
        byResolution: {},
        noAncestorCount: 0,
        noAncestorPct: 0,
        clockSkew: { max: null, min: null, suspicious: 0 },
        repeatedRows: [],
        topConflictingFields: [],
        diagnoses: [],
        recent: []
    };

    if (!logPath) return result;

    // Collect candidate files: base + rotated (.1 .. .N), oldest first
    const files = [];
    for (let i = MAX_ROTATED_FILES; i >= 1; i--) {
        const rotated = `${logPath}.${i}`;
        if (fs.existsSync(rotated)) files.push(rotated);
    }
    if (fs.existsSync(logPath)) files.push(logPath);

    if (!files.length) return result;
    result.available = true;

    let lines = [];
    for (const file of files) {
        try {
            const content = fs.readFileSync(file, 'utf8');
            const fileLines = content.split('\n').filter((l) => l.trim());
            lines = lines.concat(fileLines);
        } catch (_) {
            /* skip unreadable file */
        }
    }

    // Keep only the most recent maxLines
    if (lines.length > maxLines) {
        lines = lines.slice(lines.length - maxLines);
    }

    const rowAgg = new Map(); // key -> { rowSyncId, table, count, maxRemoteVersion, minLocalVersion }
    const fieldAgg = new Map(); // field -> count
    const parsed = [];

    for (const line of lines) {
        const entry = safeParse(line);
        if (!entry || typeof entry !== 'object') {
            result.parseErrors += 1;
            continue;
        }
        parsed.push(entry);
        result.total += 1;

        const phase = entry.phase || 'unknown';
        result.byPhase[phase] = (result.byPhase[phase] || 0) + 1;

        const table = entry.table || 'unknown';
        result.byTable[table] = (result.byTable[table] || 0) + 1;

        const resolution = entry.resolution || 'unknown';
        result.byResolution[resolution] = (result.byResolution[resolution] || 0) + 1;

        if (entry.ancestorPresent === false) result.noAncestorCount += 1;

        if (Number.isFinite(entry.tsSkewSec)) {
            const skew = entry.tsSkewSec;
            if (result.clockSkew.max === null || skew > result.clockSkew.max) result.clockSkew.max = skew;
            if (result.clockSkew.min === null || skew < result.clockSkew.min) result.clockSkew.min = skew;
            // suspicious: |skew| over 5 minutes suggests clock drift, not normal edit latency
            if (Math.abs(skew) > 300) result.clockSkew.suspicious += 1;
        }

        if (entry.rowSyncId) {
            const key = `${table}::${entry.rowSyncId}`;
            const agg = rowAgg.get(key) || {
                rowSyncId: entry.rowSyncId,
                table,
                count: 0,
                maxRemoteVersion: 0,
                minLocalVersion: null
            };
            agg.count += 1;
            if (Number.isFinite(entry.remoteVersion) && entry.remoteVersion > agg.maxRemoteVersion) {
                agg.maxRemoteVersion = entry.remoteVersion;
            }
            if (Number.isFinite(entry.localVersion)) {
                agg.minLocalVersion =
                    agg.minLocalVersion === null ? entry.localVersion : Math.min(agg.minLocalVersion, entry.localVersion);
            }
            rowAgg.set(key, agg);
        }

        if (Array.isArray(entry.conflictingFields)) {
            for (const field of entry.conflictingFields) {
                fieldAgg.set(field, (fieldAgg.get(field) || 0) + 1);
            }
        }
    }

    result.noAncestorPct = result.total > 0 ? Math.round((result.noAncestorCount / result.total) * 100) : 0;

    // Repeated rows (count >= 3) — strong signal of version desync
    result.repeatedRows = [...rowAgg.values()]
        .filter((r) => r.count >= 3)
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

    result.topConflictingFields = [...fieldAgg.entries()]
        .map(([field, count]) => ({ field, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15);

    result.recent = parsed.slice(-50).reverse();

    // ── Heuristic diagnoses (Arabic, ready to display) ──
    if (result.total === 0) {
        result.diagnoses.push('لا توجد تعارضات مُسجَّلة بعد. استخدم النظام على جهازين لتوليد بيانات.');
    } else {
        if (result.noAncestorPct >= 40) {
            result.diagnoses.push(
                `نسبة عالية من التعارضات (${result.noAncestorPct}%) بلا بيانات سلف (ancestor) — يرجّح تعارضات وهمية بسبب غياب ancestor_data.`
            );
        }
        if (result.repeatedRows.length > 0) {
            const worst = result.repeatedRows[0];
            result.diagnoses.push(
                `صفوف تتكرر تعارضاتها (الأسوأ: ${worst.table}/${worst.rowSyncId} بعدد ${worst.count}) — يرجّح اختلال تتبّع الإصدار (version desync).`
            );
        }
        if (result.clockSkew.suspicious > 0) {
            result.diagnoses.push(
                `${result.clockSkew.suspicious} تعارض بفارق زمني يتجاوز 5 دقائق (الأقصى: ${result.clockSkew.max}ث) — يرجّح انحراف ساعة بين الأجهزة يؤثّر على قرار LWW.`
            );
        }
        if ((result.byPhase.push || 0) > (result.byPhase.pull || 0) * 3 && (result.byPhase.push || 0) > 5) {
            result.diagnoses.push('غالبية التعارضات على جانب الرفع (push) — راجع منطق فحص الإصدار في الرفع.');
        }
        if (!result.diagnoses.length) {
            result.diagnoses.push('لا يوجد نمط شاذ واضح — التعارضات تبدو ناتجة عن تعديلات متزامنة حقيقية بين الأجهزة.');
        }
    }

    return result;
}

module.exports = {
    isForensicsEnabled,
    resolveLogFilePath,
    logConflictForensics,
    analyzeConflictForensics,
    stripSensitive,
    safeParse,
    // exported for tests
    MAX_LOG_BYTES,
    MAX_ROTATED_FILES
};
