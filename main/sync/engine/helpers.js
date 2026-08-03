'use strict';

/** Pure / near-pure sync engine helpers (WP3). No Firestore data-plane. */

const { logAppError } = require('../../diagnostics/error-log');
const state = require('./state');

const _schemaColumnsCache = new Map();

const TOPO_ORDER_PUT = [
    'students',
    'teachers',
    'exams',
    'settings',
    'page_visibility',
    'stage_rule_sets',
    'subject_coefficients',
    'exam_count_rules',
    'subject_weight_rules',
    'cycle_profiles',
    'cycle_profile_assignments',
    'page_role_access',
    'grades',
    'absences',
    'correspondence',
    'student_files',
    'student_movements',
    'teacher_aliases',
    'teacher_absences',
    'staff_attendance',
    'compensation_tracking',
    'exam_proctors',
    'exam_rooms',
    'tests',
    'system_tags'
];

// Reverse order for FK-safe deletions (children before parents)
const TOPO_ORDER_DEL = [...TOPO_ORDER_PUT].reverse();

const DEFAULT_PUSH_CONCURRENCY = 10;
const DEFAULT_PUSH_CONCURRENCY_MAX = 20;
const ABSOLUTE_CONCURRENCY_CEILING = 50;
const DEFAULT_PUSH_BACKLOG_BATCH_SIZE = 1000;
const MAX_PUSH_BACKLOG_BATCH_SIZE = 5000;
const DEFAULT_PUSH_BATCH_SIZE = 100;
const DEFAULT_SYNC_INTERVAL_MINUTES = 5;
const MIN_SYNC_INTERVAL_MINUTES = 1;
const MAX_SYNC_INTERVAL_MINUTES = 30;

// Rate_Limiter ramp-up / back-off constants (Req 3.2, 3.5).
const PUSH_CONCURRENCY_RAMP_STEP = 5;
const PUSH_BACKOFF_BASE_MS = 1000;
const PUSH_BACKOFF_MAX_MS = 60000;

function isPullDebugEnabled() {
    return String(process.env.SYNC_PULL_DEBUG || '').trim() === '1';
}

function pullDebug(...args) {
    if (isPullDebugEnabled()) {
        console.log('[sync:pull:debug]', ...args);
    }
}

function summarizePullItem(item) {
    return {
        changeId: item.changeId || item.id || null,
        tableName: item.tableName || null,
        entityType: item.entityType || null,
        operation: item.operation || null,
        rowSyncId: item.rowSyncId || null,
        updatedAt: item.updatedAt || null,
        version: item.version || null
    };
}

function summarizeOutboxEntry(outboxEntry) {
    return {
        outboxId: outboxEntry?.id || null,
        tableName: outboxEntry?.table_name || null,
        operation: outboxEntry?.operation || null,
        rowSyncId: outboxEntry?.row_sync_id || null,
        schoolYear: outboxEntry?.school_year || null
    };
}

function logSyncError(action, message, extra = {}) {
    logAppError({
        source: 'sync',
        action,
        message,
        extra
    });
}

function failFirestoreDocBuild(outboxEntry, reason, extra = {}) {
    const details = summarizeOutboxEntry(outboxEntry);
    const message =
        `[sync:push] ${reason} ` +
        `(table=${details.tableName || 'unknown'}, rowSyncId=${details.rowSyncId || '—'}, outboxId=${details.outboxId || '—'})`;
    outboxEntry._syncBuildError = message;
    console.warn(message);
    logSyncError('push.buildFirestoreDoc', message, { ...details, ...extra });
    return null;
}

function formatPullApplyFailure(pullItem, reason) {
    const summary = summarizePullItem(pullItem);
    return (
        `[sync:pull] ${summary.operation || 'OP'} ${summary.tableName || 'unknown'} ` +
        `rowSyncId=${summary.rowSyncId || '—'} changeId=${summary.changeId || '—'} failed: ${reason}`
    );
}

function recordPullApplyFailure(stats, pullItem, reason, extra = {}) {
    const pullSummary = summarizePullItem(pullItem);
    const message = formatPullApplyFailure(pullItem, reason);
    stats.failedCount += 1;
    if (Array.isArray(stats.failures) && stats.failures.length < state.MAX_RECORDED_PULL_FAILURES) {
        stats.failures.push({
            message,
            reason,
            ...pullSummary
        });
    }
    console.warn(message);
    logSyncError('pull.apply', message, { ...pullSummary, ...extra });
}

/**
 * Hold an inbound row this device cannot apply correctly (multi-cycle plan §9.2).
 *
 * Distinct from recordPullApplyFailure on purpose. A failure is assumed transient, so it
 * holds the pull cursor and the whole batch is retried. A contract violation is not
 * transient: retrying changes nothing until the device runs its migrations, and holding
 * the cursor for it would stop *every* entity from syncing — the opposite of §9.2's
 * "stop applying the affected entities only". Quarantining stores the full payload so the
 * row can be replayed once the schema catches up, and lets the cursor advance meanwhile.
 */
function recordPullQuarantine(db, stats, pullItem, reason, extra = {}) {
    const summary = summarizePullItem(pullItem);
    const message = formatPullApplyFailure(pullItem, `quarantined — ${reason}`);
    stats.quarantinedCount = (stats.quarantinedCount || 0) + 1;
    if (Array.isArray(stats.quarantined) && stats.quarantined.length < state.MAX_RECORDED_PULL_FAILURES) {
        stats.quarantined.push({ message, reason, ...summary });
    }
    try {
        db.prepare(
            `INSERT INTO sync_quarantine
                (row_sync_id, table_name, operation, contract_version, reason, item_json, retry_count, last_attempt_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
             ON CONFLICT(row_sync_id) DO UPDATE SET
                reason = excluded.reason,
                item_json = excluded.item_json,
                contract_version = excluded.contract_version,
                retry_count = sync_quarantine.retry_count + 1,
                last_attempt_at = CURRENT_TIMESTAMP`
        ).run(
            String(pullItem.rowSyncId || ''),
            String(pullItem.tableName || ''),
            String(pullItem.operation || 'PUT'),
            Number(extra.contractVersion) || 1,
            reason,
            JSON.stringify(pullItem)
        );
    } catch (err) {
        // A quarantine that cannot be stored must not be swallowed: fall back to the
        // blocking path so the row is retried rather than lost.
        console.warn(`[sync:pull] Failed to store quarantine for ${summary.rowSyncId}: ${err.message}`);
        recordPullApplyFailure(stats, pullItem, reason, extra);
        return;
    }
    console.warn(message);
    logSyncError('pull.quarantine', message, { ...summary, ...extra });
}

/** Held rows to replay before the incoming batch, oldest first. */
function loadQuarantinedPullItems(db, limit = 500) {
    let rows = [];
    try {
        rows = db
            .prepare('SELECT row_sync_id, item_json FROM sync_quarantine ORDER BY id LIMIT ?')
            .all(limit);
    } catch {
        return [];
    }
    const items = [];
    for (const row of rows) {
        try {
            items.push(JSON.parse(row.item_json));
        } catch {
            // Unparseable payload can never be replayed — drop it rather than retry forever.
            try {
                db.prepare('DELETE FROM sync_quarantine WHERE row_sync_id = ?').run(row.row_sync_id);
            } catch {
                /* best effort */
            }
        }
    }
    return items;
}

/**
 * Clear a held row before replaying it. If the contract still fails,
 * recordPullQuarantine puts it straight back with retry_count incremented.
 */
function releaseQuarantinedItem(db, rowSyncId) {
    try {
        db.prepare('DELETE FROM sync_quarantine WHERE row_sync_id = ?').run(String(rowSyncId || ''));
    } catch {
        /* best effort */
    }
}

function countQuarantinedRows(db) {
    try {
        return Number(db.prepare('SELECT COUNT(*) AS c FROM sync_quarantine').get()?.c || 0);
    } catch {
        return 0;
    }
}

function buildPullFailureSummary(failedCount, failures = []) {
    const base = `${failedCount} item(s) failed to apply; holding pull cursor for retry`;
    const firstFailure = failures[0]?.message;
    return firstFailure ? `${base}. First failure: ${firstFailure}` : base;
}

function getValidColumns(db, tableName) {
    if (_schemaColumnsCache.has(tableName)) return _schemaColumnsCache.get(tableName);
    const cols = db
        .prepare(`PRAGMA table_info("${tableName}")`)
        .all()
        .map((c) => c.name);
    const colSet = new Set(cols);
    _schemaColumnsCache.set(tableName, colSet);
    return colSet;
}

function filterToValidColumns(db, tableName, columns) {
    const valid = getValidColumns(db, tableName);
    return columns.filter((c) => valid.has(c));
}

/**
 * Drop the cached column sets.
 *
 * The cache is keyed by table name only, so it outlives the connection it was read
 * from. A restore swaps in a database with a different schema, and a stale entry would
 * make both filterToValidColumns and the entity contract check (plan §9.2) reason about
 * the previous file's columns.
 */
function clearSchemaColumnsCache() {
    _schemaColumnsCache.clear();
}

function sortByTopology(items) {
    const puts = items.filter((i) => i.operation === 'PUT');
    const dels = items.filter((i) => i.operation === 'DEL');

    puts.sort((a, b) => {
        const aIdx = TOPO_ORDER_PUT.indexOf(a.tableName);
        const bIdx = TOPO_ORDER_PUT.indexOf(b.tableName);
        return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    });

    dels.sort((a, b) => {
        const aIdx = TOPO_ORDER_DEL.indexOf(a.tableName);
        const bIdx = TOPO_ORDER_DEL.indexOf(b.tableName);
        return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    });

    return [...dels, ...puts];
}

function getTopologyRank(tableName, operation) {
    const order = operation === 'DEL' ? TOPO_ORDER_DEL : TOPO_ORDER_PUT;
    const index = order.indexOf(tableName);
    return index === -1 ? 999 : index;
}

function sortOutboxRowsForPush(rows) {
    return [...rows].sort((a, b) => {
        const aRank = getTopologyRank(a.table_name, a.operation);
        const bRank = getTopologyRank(b.table_name, b.operation);
        if (aRank !== bRank) return aRank - bRank;
        return Number(a.id || 0) - Number(b.id || 0);
    });
}

function sortPreparedItemsForPush(preparedItems) {
    return [...preparedItems].sort((a, b) => {
        const aRank = getTopologyRank(a.item?.tableName, a.item?.operation);
        const bRank = getTopologyRank(b.item?.tableName, b.item?.operation);
        if (aRank !== bRank) return aRank - bRank;
        return Number(a.entryId || 0) - Number(b.entryId || 0);
    });
}

function hasMultipleTopologyRanks(preparedItems) {
    const ranks = new Set(
        preparedItems.map((prepared) => getTopologyRank(prepared.item?.tableName, prepared.item?.operation))
    );
    return ranks.size > 1;
}

function readSyncConfig(db) {
    return (
        db
            .prepare(
                `SELECT sync_config.*, institution_config.massar_code AS massar_code
             FROM sync_config
             LEFT JOIN institution_config ON institution_config.id = 1
             WHERE sync_config.id = 1`
            )
            .get() || {}
    );
}

function parseConfigInteger(value) {
    if (typeof value === 'number') {
        return Number.isInteger(value) ? value : null;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '' || !/^[+-]?\d+$/.test(trimmed)) return null;
        const parsed = Number(trimmed);
        return Number.isInteger(parsed) ? parsed : null;
    }
    return null;
}

function parseConfigNumber(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '') return null;
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function parseConfigBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized === '1' || normalized === 'true';
    }
    return false;
}

function resolvePushBatchSize(config) {
    const parsed = parseConfigNumber((config || {}).push_batch_size);
    if (parsed == null || parsed < 1) return DEFAULT_PUSH_BATCH_SIZE;
    return Math.floor(parsed);
}

function resolvePushTuning(config) {
    const cfg = config || {};
    let failingKey = null;
    const tuning = {};

    try {
        failingKey = 'push_batch_size';
        const pushBatchSize = resolvePushBatchSize(cfg);

        // push_concurrency_max: default 20, then clamp to absolute ceiling 50 (Req 2.3, 2.4, 2.7).
        failingKey = 'push_concurrency_max';
        let maxConcurrency = parseConfigInteger(cfg.push_concurrency_max);
        if (maxConcurrency == null || maxConcurrency < 1) {
            maxConcurrency = DEFAULT_PUSH_CONCURRENCY_MAX;
        }
        maxConcurrency = Math.min(maxConcurrency, ABSOLUTE_CONCURRENCY_CEILING);

        // push_concurrency: default 10, clamp to [1, maxConcurrency] (Req 2.1, 2.2, 2.5, 2.6).
        failingKey = 'push_concurrency';
        let initialConcurrency = parseConfigInteger(cfg.push_concurrency);
        if (initialConcurrency == null || initialConcurrency < 1) {
            initialConcurrency = DEFAULT_PUSH_CONCURRENCY;
        }
        initialConcurrency = Math.max(1, Math.min(initialConcurrency, maxConcurrency));

        // push_backlog_batch_size: default 1000 when absent / non-numeric / below the
        // steady batch size, then clamp to <= 5000 (Req 6.1, 6.2).
        failingKey = 'push_backlog_batch_size';
        let backlogBatchSize = parseConfigNumber(cfg.push_backlog_batch_size);
        if (backlogBatchSize == null || backlogBatchSize < pushBatchSize) {
            backlogBatchSize = DEFAULT_PUSH_BACKLOG_BATCH_SIZE;
        }
        backlogBatchSize = Math.min(Math.floor(backlogBatchSize), MAX_PUSH_BACKLOG_BATCH_SIZE);

        // push_batched_fast_path_enabled: truthy/falsey parse, default false (Req 7.8, 9.3).
        failingKey = 'push_batched_fast_path_enabled';
        const batchedFastPathEnabled = parseConfigBoolean(cfg.push_batched_fast_path_enabled);

        tuning.initialConcurrency = initialConcurrency;
        tuning.maxConcurrency = maxConcurrency;
        tuning.backlogBatchSize = backlogBatchSize;
        tuning.batchedFastPathEnabled = batchedFastPathEnabled;
        tuning.pushBatchSize = pushBatchSize;
    } catch (err) {
        const abortErr = new Error(`[sync:push] Failed to resolve push tuning key '${failingKey}': ${err.message}`);
        abortErr.code = 'PUSH_TUNING_INIT_FAILED';
        abortErr.failingKey = failingKey;
        throw abortErr;
    }

    // Fail-safe verification (Req 9.4): never proceed with an undefined or
    // out-of-contract tuning value. If a documented default somehow failed to
    // apply, abort initialization surfacing the offending key.
    const checks = [
        [
            'push_concurrency',
            Number.isInteger(tuning.initialConcurrency) &&
                tuning.initialConcurrency >= 1 &&
                tuning.initialConcurrency <= tuning.maxConcurrency
        ],
        [
            'push_concurrency_max',
            Number.isInteger(tuning.maxConcurrency) &&
                tuning.maxConcurrency >= 1 &&
                tuning.maxConcurrency <= ABSOLUTE_CONCURRENCY_CEILING
        ],
        [
            'push_backlog_batch_size',
            Number.isInteger(tuning.backlogBatchSize) &&
                tuning.backlogBatchSize >= 1 &&
                tuning.backlogBatchSize <= MAX_PUSH_BACKLOG_BATCH_SIZE
        ],
        ['push_batched_fast_path_enabled', typeof tuning.batchedFastPathEnabled === 'boolean']
    ];
    for (const [key, ok] of checks) {
        if (!ok) {
            const abortErr = new Error(`[sync:push] Could not apply documented default for tuning key '${key}'`);
            abortErr.code = 'PUSH_TUNING_INIT_FAILED';
            abortErr.failingKey = key;
            throw abortErr;
        }
    }

    return tuning;
}

function resolveDrainLimit(config, pendingCount, tuning) {
    const pushBatchSize =
        tuning && Number.isFinite(tuning.pushBatchSize) ? tuning.pushBatchSize : resolvePushBatchSize(config);
    const backlogBatchSize =
        tuning && Number.isFinite(tuning.backlogBatchSize) ? tuning.backlogBatchSize : DEFAULT_PUSH_BACKLOG_BATCH_SIZE;

    const pending = Number(pendingCount) || 0;
    if (pending > pushBatchSize) {
        return Math.min(backlogBatchSize, MAX_PUSH_BACKLOG_BATCH_SIZE);
    }
    return pushBatchSize;
}

function resolveSyncIntervalMinutes(config) {
    const parsed = parseConfigNumber((config || {}).sync_interval_minutes);
    if (parsed == null || parsed < MIN_SYNC_INTERVAL_MINUTES || parsed > MAX_SYNC_INTERVAL_MINUTES) {
        return DEFAULT_SYNC_INTERVAL_MINUTES;
    }
    return parsed;
}

function createRateLimiter(tuning) {
    const cfg = tuning || {};
    const max =
        Number.isInteger(cfg.maxConcurrency) && cfg.maxConcurrency >= 1
            ? cfg.maxConcurrency
            : DEFAULT_PUSH_CONCURRENCY_MAX;
    const initial =
        Number.isInteger(cfg.initialConcurrency) && cfg.initialConcurrency >= 1
            ? cfg.initialConcurrency
            : DEFAULT_PUSH_CONCURRENCY;

    const clampActive = (value) => Math.max(1, Math.min(value, max));

    const limiter = {
        // Begin each background run at the configured initial concurrency,
        // clamped into [1, max] (Req 3.1, 2.6).
        active: clampActive(initial),
        max,
        consecutiveThrottles: 0,

        // Ordered log of every actual change to the active concurrency limit
        // during this run, surfaced to Push_Metrics (Req 8.4). Each entry is
        // { to, reason } where reason is 'ramp-up' or 'throttle-backoff'. Only
        // events that actually move `active` are recorded — a ramp held at the
        // cap or a back-off already at the floor of 1 is not a change.
        changes: [],

        // A group settled with no throttling observed: ramp up by 5 up to but
        // never beyond the cap, and reset the consecutive-throttle counter
        // (Req 3.2, 3.3, 3.6).
        onGroupSuccess() {
            const next = clampActive(this.active + PUSH_CONCURRENCY_RAMP_STEP);
            if (next !== this.active) {
                this.active = next;
                this.changes.push({ to: next, reason: 'ramp-up' });
            }
            this.consecutiveThrottles = 0;
        },

        // A group observed a throttling error: halve the active limit with a
        // floor of 1 and increment the consecutive-throttle counter (Req 3.4).
        onThrottle() {
            const next = clampActive(Math.floor(this.active / 2));
            if (next !== this.active) {
                this.active = next;
                this.changes.push({ to: next, reason: 'throttle-backoff' });
            }
            this.consecutiveThrottles += 1;
        },

        // Exponential back-off delay: 1000 * 2^(n-1) ms capped at 60000 ms,
        // where n is the current consecutive-throttle count (Req 3.5).
        backoffDelayMs() {
            const n = this.consecutiveThrottles;
            if (n < 1) return 0;
            return Math.min(PUSH_BACKOFF_BASE_MS * Math.pow(2, n - 1), PUSH_BACKOFF_MAX_MS);
        }
    };

    return limiter;
}

function isThrottleError(err) {
    return ['resource-exhausted', 'unavailable', 'aborted'].includes(err && err.code);
}

function isAssertionOrAuthNetworkError(err) {
    if (!err) return false;
    if (err.code === 'auth/network-request-failed') return true;
    const text = `${err.message || ''} ${err.context ? JSON.stringify(err.context) : ''}`;
    return /INTERNAL ASSERTION FAILED: Unexpected state/.test(text) || /\(ID: b815\)|\(ID: 3c6b\)/.test(text);
}

function isConnectivityWarmupNetworkError(connectivity) {
    if (!connectivity) return true;
    const text = `${connectivity.error || ''} ${connectivity.code || ''} ${connectivity.step || ''}`.toLowerCase();
    return /network|unavailable|offline|timeout|timed out|econn|etimedout|enotfound|deadline-exceeded|auth\/network-request-failed/.test(
        text
    );
}

function chunkArray(items, size) {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) {
        return [];
    }

    // Guard against non-positive / non-integer sizes: clamp to at least 1 so a
    // chunk always makes forward progress and never exceeds the requested size.
    const chunkSize = Number.isInteger(size) && size >= 1 ? size : 1;

    const chunks = [];
    for (let i = 0; i < list.length; i += chunkSize) {
        chunks.push(list.slice(i, i + chunkSize));
    }
    return chunks;
}

async function runConcurrentGroup(items, limit, worker) {
    const list = Array.isArray(items) ? items : [];
    const outcomes = new Array(list.length);
    let throttled = false;

    if (list.length === 0) {
        return { outcomes, throttled };
    }

    // Effective in-flight cap: at least 1, never above the requested limit, and
    // no point spawning more runners than there are items.
    const requested = Number.isInteger(limit) && limit >= 1 ? limit : 1;
    const effectiveLimit = Math.max(1, Math.min(requested, list.length));

    // Shared cursor: JS is single-threaded so post-increment is atomic across
    // the cooperating runners, guaranteeing each item is pulled exactly once.
    let nextIndex = 0;

    const runWorker = async () => {
        while (nextIndex < list.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;

            let outcome;
            try {
                outcome = await worker(list[currentIndex], currentIndex);
            } catch (err) {
                // A rejected worker is isolated into a failure outcome so the
                // remaining items still settle (Req 1.4).
                outcome = {
                    success: false,
                    error: err && err.message ? err.message : String(err),
                    errorName: err && err.code,
                    isAccessDenied: !!(err && err.code === 'permission-denied'),
                    isThrottle: isThrottleError(err)
                };
            }

            outcomes[currentIndex] = outcome;
            if (outcome && outcome.isThrottle) {
                throttled = true;
            }
        }
    };

    const runners = [];
    for (let i = 0; i < effectiveLimit; i += 1) {
        runners.push(runWorker());
    }
    await Promise.all(runners);

    return { outcomes, throttled };
}

function parseLocalIdFromRowSyncId(rowSyncId, tableName) {
    const prefix = `:${tableName}:`;
    const index = String(rowSyncId || '').indexOf(prefix);
    if (index === -1) return null;
    return String(rowSyncId).slice(index + prefix.length);
}

function parsePullCursor(value) {
    if (value == null || value === '') {
        return { updatedAt: 0, changeId: '' };
    }

    if (typeof value === 'number') {
        return { updatedAt: Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0, changeId: '' };
    }

    const normalized = String(value).trim();
    if (!normalized) {
        return { updatedAt: 0, changeId: '' };
    }

    if (/^\d+$/.test(normalized)) {
        return { updatedAt: Number(normalized) || 0, changeId: '' };
    }

    try {
        const parsed = JSON.parse(normalized);
        return {
            updatedAt: Number(parsed?.updatedAt) || 0,
            changeId: String(parsed?.changeId || '').trim()
        };
    } catch {
        return { updatedAt: Number(normalized) || 0, changeId: '' };
    }
}

function serializePullCursor(cursor) {
    return JSON.stringify({
        updatedAt: Number(cursor?.updatedAt) || 0,
        changeId: String(cursor?.changeId || '').trim()
    });
}

function shouldScheduleFollowupPush(pendingCount, sentCount, failedCount) {
    return pendingCount > 0 && sentCount > 0 && failedCount === 0;
}

function computePushThroughput(sentCount, durationMs) {
    if (!(durationMs > 0)) return 0;
    return sentCount / (durationMs / 1000);
}

function classifyPushError(errString) {
    const text = String(errString || '');
    if (!text) return text;
    const lower = text.toLowerCase();
    if (lower.includes('permission_denied') || lower.includes('permission-denied')) {
        return 'تم رفض المزامنة بسبب انتهاء أو ضعف صلاحيات الحساب السحابي. أعد تسجيل الدخول بحساب مدير المؤسسة.';
    }
    if (
        lower.includes('credentials_unavailable') ||
        lower.includes('failed to obtain credentials') ||
        lower === 'sync_auth_unavailable'
    ) {
        return 'تعذّر الحصول على جلسة سحابية صالحة. سجّل الدخول بحساب المؤسسة السحابي.';
    }
    return text;
}

module.exports = {
    TOPO_ORDER_PUT,
    TOPO_ORDER_DEL,
    DEFAULT_PUSH_CONCURRENCY,
    DEFAULT_PUSH_CONCURRENCY_MAX,
    ABSOLUTE_CONCURRENCY_CEILING,
    DEFAULT_PUSH_BACKLOG_BATCH_SIZE,
    MAX_PUSH_BACKLOG_BATCH_SIZE,
    DEFAULT_PUSH_BATCH_SIZE,
    DEFAULT_SYNC_INTERVAL_MINUTES,
    MIN_SYNC_INTERVAL_MINUTES,
    MAX_SYNC_INTERVAL_MINUTES,
    PUSH_CONCURRENCY_RAMP_STEP,
    PUSH_BACKOFF_BASE_MS,
    PUSH_BACKOFF_MAX_MS,
    isPullDebugEnabled,
    pullDebug,
    summarizePullItem,
    summarizeOutboxEntry,
    logSyncError,
    failFirestoreDocBuild,
    formatPullApplyFailure,
    recordPullApplyFailure,
    recordPullQuarantine,
    loadQuarantinedPullItems,
    releaseQuarantinedItem,
    countQuarantinedRows,
    buildPullFailureSummary,
    getValidColumns,
    filterToValidColumns,
    clearSchemaColumnsCache,
    sortByTopology,
    getTopologyRank,
    sortOutboxRowsForPush,
    sortPreparedItemsForPush,
    hasMultipleTopologyRanks,
    readSyncConfig,
    parseConfigInteger,
    parseConfigNumber,
    parseConfigBoolean,
    resolvePushBatchSize,
    resolvePushTuning,
    resolveDrainLimit,
    resolveSyncIntervalMinutes,
    createRateLimiter,
    isThrottleError,
    isAssertionOrAuthNetworkError,
    isConnectivityWarmupNetworkError,
    chunkArray,
    runConcurrentGroup,
    parseLocalIdFromRowSyncId,
    parsePullCursor,
    serializePullCursor,
    shouldScheduleFollowupPush,
    computePushThroughput,
    classifyPushError
};
