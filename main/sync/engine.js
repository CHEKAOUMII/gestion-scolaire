'use strict';

const {
    collection,
    doc,
    documentId,
    getCountFromServer,
    getDocs,
    limit: firestoreLimit,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    where,
    writeBatch
} = require('firebase/firestore');
const { getFirestoreDb, recoverFirestoreClient } = require('../firebase/config');
const { getCollectionPath, buildDocumentId, COLLECTION_MAP } = require('../firebase/collections');
const { logChangeBatch, pullChanges, bootstrapFromCollections } = require('../firebase/sync-log');
const { getDb } = require('../db/context');
const {
    getCredentials,
    clearCredentials,
    testConnection,
    resolveSyncSchoolId,
    hasLiveFirebaseUser
} = require('./credentials');
const {
    getDeviceHash,
    getDeviceName,
    stripSensitiveFields,
    ensureSyncIdMapping,
    CHANNEL_REGISTRY
} = require('./capture');
const { canPush, getEntityType, ENTITY_TYPE_REGISTRY } = require('./authority');
const { threeWayMerge, computeRowChecksum } = require('./merge');
const { SENSITIVE_FIELDS } = require('./capture');
const { logAppError } = require('../diagnostics/error-log');
const { logConflictForensics } = require('./conflict-forensics');

let _syncTimer = null;
let _flushRunning = false;
let _pullTimer = null;
let _pullRunning = false;
let _pullListenerUnsubscribe = null;
let _pullDebounceTimer = null;

// Sync-auth epoch: bumped on every sign-in / sign-out (see auth:login / auth:logout).
// A push/pull cycle captures this value at start; if it differs at the end, an auth
// transition happened WHILE the cycle was writing/reading. Any error such a cycle
// produced (e.g. PERMISSION_DENIED from a token invalidated mid-write by signOut) is an
// interruption artifact, not a real permissions failure, so it is dropped. This covers
// the case where the user signs back in quickly, before the interrupted cycle finishes,
// so a live-user check at cycle end alone would not catch it.
let _syncAuthEpoch = 0;

function bumpSyncAuthEpoch() {
    _syncAuthEpoch += 1;
}
let _backlogPushTimer = null;
// One-time guard so the unhandledRejection handler is registered exactly once
// across sync (re)starts (firestore-sync-assertion-crash-fix, Req 2.3).
let _unhandledRejectionHandlerInstalled = false;

const REMOTE_PULL_DEBOUNCE_MS = 4000;
const BACKLOG_PUSH_DELAY_MS = 2500;
const MAX_RECORDED_PULL_FAILURES = 20;

// Cache of valid column names per table (populated from PRAGMA table_info)
const _schemaColumnsCache = new Map();

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
    if (Array.isArray(stats.failures) && stats.failures.length < MAX_RECORDED_PULL_FAILURES) {
        stats.failures.push({
            message,
            reason,
            ...pullSummary
        });
    }
    console.warn(message);
    logSyncError('pull.apply', message, { ...pullSummary, ...extra });
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

// Topological order for FK-safe insert/update (parents before children)
const TOPO_ORDER_PUT = [
    'students',
    'teachers',
    'exams',
    'settings',
    'page_visibility',
    'exam_count_rules',
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

// ---------------------------------------------------------------------------
// Push throughput tuning resolution (Layer 1 / Layer 2 configuration)
//
// Pure, exportable helpers that read the `sync_config` tuning keys and return
// validated values, applying documented defaults for absent/invalid input
// (Requirements 2.x, 6.1/6.2/6.4, 7.8, 9.2/9.3/9.4/9.6). These functions never
// touch the database — callers pass an already-read config row.
// ---------------------------------------------------------------------------

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

// Parse a config value that must be an integer. Returns the integer, or null
// when the value is absent, non-numeric, or not an integer.
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

// Parse a config value that may be any finite number. Returns the number, or
// null when the value is absent or non-numeric.
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

// Parse a SQLite-style boolean (truthy/falsey). Anything not recognized as
// truthy resolves to false (Req 7.8, 9.3).
function parseConfigBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized === '1' || normalized === 'true';
    }
    return false;
}

// Resolve the existing steady-state batch size (default 100). Falsy/invalid
// values fall back to the default, matching existing `Number(x) || 100`.
function resolvePushBatchSize(config) {
    const parsed = parseConfigNumber((config || {}).push_batch_size);
    if (parsed == null || parsed < 1) return DEFAULT_PUSH_BATCH_SIZE;
    return Math.floor(parsed);
}

// Resolve the four push tuning keys into validated values, applying documented
// defaults for absent/invalid input (Req 2.1-2.7, 6.1/6.2, 7.8, 9.2/9.3).
//
// Returns:
//   {
//     initialConcurrency,     // int, 1 <= initial <= maxConcurrency, default 10
//     maxConcurrency,         // int in [1, 50], default 20
//     backlogBatchSize,       // int, default 1000, clamped to <= 5000
//     batchedFastPathEnabled, // boolean, default false
//     pushBatchSize           // int, existing steady-state limit (default 100)
//   }
//
// Abort fail-safe (Req 9.4): if a documented default cannot be applied due to an
// implementation error, this throws an error surfacing the failing key so the
// engine never proceeds with an undefined tuning value.
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

// Resolve the effective per-cycle drain limit (Req 6.1, 6.4).
//   backlog (pendingCount > push_batch_size) -> min(backlogBatchSize, 5000)
//   steady-state                             -> push_batch_size
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

// Resolve the background sync interval in minutes (Req 9.6). The value is taken
// from `sync_config.sync_interval_minutes` and must fall within [1, 30];
// absent, non-numeric, or out-of-range values default to 5 minutes.
function resolveSyncIntervalMinutes(config) {
    const parsed = parseConfigNumber((config || {}).sync_interval_minutes);
    if (parsed == null || parsed < MIN_SYNC_INTERVAL_MINUTES || parsed > MAX_SYNC_INTERVAL_MINUTES) {
        return DEFAULT_SYNC_INTERVAL_MINUTES;
    }
    return parsed;
}

// Create the Rate_Limiter that governs the active push concurrency level for a
// single background run (Req 3.1). It is a small mutable controller that ramps
// the active limit up on sustained success and backs it off (with exponential
// delay) when Firestore signals throttling. The active limit is held within
// [1, max] at all times (Req 2.6).
//
// Returns: {
//   active,                 // current active concurrency limit, starts at initialConcurrency
//   max,                    // maximum cap (from tuning.maxConcurrency)
//   consecutiveThrottles,   // count of back-to-back throttled groups
//   onGroupSuccess(),       // active = min(active + 5, max); consecutiveThrottles = 0
//   onThrottle(),           // active = max(1, floor(active / 2)); consecutiveThrottles += 1
//   backoffDelayMs()        // min(1000 * 2^(n-1), 60000) where n = consecutiveThrottles
// }
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

// Identify Firestore throttling/overload errors so the Rate_Limiter can halve
// the active concurrency and back off. Treats error codes `resource-exhausted`,
// `unavailable`, and `aborted` (overload signals) as throttling; everything else
// (including `permission-denied`, handled as access-denied) is not (Req 3.4, 3.8).
function isThrottleError(err) {
    return ['resource-exhausted', 'unavailable', 'aborted'].includes(err && err.code);
}

// Identify the recoverable bug-domain error described in the
// firestore-sync-assertion-crash-fix design: a mid-transaction auth-token
// refresh that fails with `auth/network-request-failed`, or the Firestore
// internal-assertion leak (`INTERNAL ASSERTION FAILED: Unexpected state`,
// including `ID: b815` / `ID: 3c6b`) that surfaces when that auth code leaks
// into the transaction error classifier. Returns true ONLY for those bug-domain
// errors so the push path can treat them as transient and trigger client
// recovery, leaving the affected rows `pending`.
//
// Every existing classification is left untouched: other transient codes
// (`unavailable`, `aborted`), access-denied (`permission-denied`), and version
// conflicts (`VERSION_CONFLICT`) all return false here and continue through
// their established paths (Req 1.1, 2.1).
function isAssertionOrAuthNetworkError(err) {
    if (!err) return false;
    if (err.code === 'auth/network-request-failed') return true;
    const text = `${err.message || ''} ${err.context ? JSON.stringify(err.context) : ''}`;
    return /INTERNAL ASSERTION FAILED: Unexpected state/.test(text) || /\(ID: b815\)|\(ID: 3c6b\)/.test(text);
}

// Prevention helper (firestore-sync-assertion-crash-fix, Req 2.4/1.4).
//
// Classify the result of the pre-push connectivity warm-up probe as a network
// failure that warrants DEFERRING the cycle (leaving the rows `pending`) rather
// than reading and pushing them while connectivity is unstable — the exact
// condition under which a mid-transaction token refresh fails with
// `auth/network-request-failed` and trips the INTERNAL ASSERTION crash. Returns
// true when the probe produced no result at all (transient/unknown), or when its
// error/step text looks network-related (network drop, unavailable, timeout,
// offline, deadline-exceeded, or the auth-network code). Non-network failures
// (e.g. missing configuration) return false so the existing flow is preserved.
function isConnectivityWarmupNetworkError(connectivity) {
    if (!connectivity) return true;
    const text = `${connectivity.error || ''} ${connectivity.code || ''} ${connectivity.step || ''}`.toLowerCase();
    return /network|unavailable|offline|timeout|timed out|econn|etimedout|enotfound|deadline-exceeded|auth\/network-request-failed/.test(
        text
    );
}

// Pure id/commit chunking helper for the Batched_Fast_Path (Layer 2).
//
// Partitions `items` (document ids or prepared records) into a list of chunks,
// each of length `<= size`, preserving input order. The union of all chunks
// equals the input exactly: no duplicates introduced, no elements omitted, and
// every chunk except possibly the last is filled to `size` (Req 7.1, 7.3).
//
// Layer 2 uses two chunk sizes through this single helper:
//   - 30  for bulk reads   (Firestore `where(documentId(), 'in', chunk)` caps at 30)
//   - 500 for batch commits(Firestore `writeBatch` caps at 500 write ops)
//
// Edge cases:
//   - non-array or empty input            -> []
//   - size not a positive integer (<= 0,  -> clamped up to 1 so progress is
//     non-integer, NaN, etc.)                guaranteed and the invariant holds
//     (each element becomes its own chunk).
//
//   chunkArray([1,2,3,4,5], 2) => [[1,2],[3,4],[5]]
//   chunkArray([], 30)          => []
//   chunkArray([1,2,3], 0)      => [[1],[2],[3]]
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

// Bounded-concurrency dispatcher (Layer 1 Concurrency_Controller).
//
// Dispatches `items` to `worker(item, index)` keeping at most `limit` worker
// invocations in flight at once. This is a sliding window, not fixed batches:
// as soon as one worker settles, the next pending item is pulled, so the pool
// stays saturated up to `limit` (Req 1.1).
//
// Every dispatched item is allowed to settle to exactly one terminal outcome;
// items are never cancelled and one item's rejection never aborts its siblings
// (full settlement, Req 1.4). A worker that throws is captured into a failure
// outcome rather than propagating, mirroring `writeItemWithVersionCheck`.
//
// Returns `{ outcomes, throttled }` where `outcomes` are in INPUT order (index
// aligned with `items`) and `throttled` is true when any item's outcome
// signaled a Firestore throttling error (`outcome.isThrottle === true`), which
// the Rate_Limiter uses to halve concurrency and back off.
//
//   worker(item, index) => Promise<outcome>   // typically the writeItemWithVersionCheck result
//   returns { outcomes: outcome[], throttled: boolean }
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

function updateDeviceHeartbeat(db) {
    try {
        const deviceHash = getDeviceHash();
        if (!deviceHash) return;

        const table = db
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'linked_devices'")
            .get();
        if (!table) return;

        const existing = db.prepare('SELECT id FROM linked_devices WHERE device_hash = ? LIMIT 1').get(deviceHash);
        if (existing) {
            db.prepare(
                `
                UPDATE linked_devices
                SET last_seen_at = CURRENT_TIMESTAMP,
                    status = COALESCE(NULLIF(status, ''), 'active')
                WHERE device_hash = ?
            `
            ).run(deviceHash);
            return;
        }

        db.prepare(
            `
            INSERT INTO linked_devices(device_hash, device_name, os_platform, linked_at, last_seen_at, status)
            VALUES(?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'active')
        `
        ).run(deviceHash, getDeviceName(), process.platform);
    } catch (err) {
        console.warn('[sync] Failed to update device heartbeat:', err.message);
    }
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

function resolveStudentCode(db, studentId, schoolYear) {
    if (studentId == null || String(studentId).trim() === '') {
        return null;
    }

    let row = null;
    if (schoolYear) {
        row = db.prepare('SELECT code FROM students WHERE id = ? AND school_year = ?').get(studentId, schoolYear);
    }
    if (!row) {
        row = db.prepare('SELECT code FROM students WHERE id = ?').get(studentId);
    }

    const code = String(row?.code || '').trim();
    return code || null;
}

function resolveStudentId(db, studentCode, schoolYear) {
    const normalizedCode = String(studentCode || '').trim();
    if (!normalizedCode) {
        return null;
    }

    let row = null;
    if (schoolYear) {
        row = db.prepare('SELECT id FROM students WHERE code = ? AND school_year = ?').get(normalizedCode, schoolYear);
    }
    if (!row) {
        row = db.prepare('SELECT id FROM students WHERE code = ? ORDER BY id ASC LIMIT 1').get(normalizedCode);
    }

    return row?.id ?? null;
}

// Soft foreign-key columns whose value is a LOCAL row id and therefore is not
// portable across devices (each device assigns its own autoincrement ids on pull).
// Migration 065 put real FKs behind these columns, so a pulled row carrying a
// non-local id would fail the INSERT. For each listed column we degrade a missing
// reference to NULL before applying — matching the ON DELETE SET NULL policy and the
// fact that teacher_name/student_code snapshots carry the real linkage. student_id on
// grades/absences/student_files is handled separately (resolved from student_code).
const PULL_SOFT_FOREIGN_KEYS = {
    grades: [['teacher_id', 'teachers']],
    tests: [['teacher_id', 'teachers']],
    staff_attendance: [['teacher_id', 'teachers']],
    compensation_tracking: [['teacher_id', 'teachers']],
    support_sessions: [['teacher_id', 'teachers']],
    exam_invitations: [['teacher_id', 'teachers']],
    exam_attendance: [['teacher_id', 'teachers']],
    exam_proctors: [
        ['teacher_id', 'teachers'],
        ['exam_id', 'exams']
    ],
    student_risk_snapshot: [['student_id', 'students']]
};

function sanitizeSoftForeignKeys(db, item) {
    if (item.operation !== 'PUT' || !item.data) return;
    const specs = PULL_SOFT_FOREIGN_KEYS[item.tableName];
    if (!specs) return;
    for (const [column, parentTable] of specs) {
        const value = item.data[column];
        if (value == null) continue;
        const exists = db.prepare(`SELECT 1 FROM "${parentTable}" WHERE id = ?`).get(value);
        if (!exists) {
            item.data = { ...item.data, [column]: null };
        }
    }
}

function normalizeSortKeyRowData(entry, rowData) {
    const normalized = { ...(rowData || {}) };
    const localId = parseLocalIdFromRowSyncId(entry.row_sync_id, entry.table_name);

    if (normalized.school_year == null && entry.school_year != null) {
        normalized.school_year = entry.school_year;
    }

    if (localId !== null && normalized.id == null) {
        normalized.id = localId;
    }

    if (entry.table_name === 'page_visibility' && normalized.key == null && normalized.page_key != null) {
        normalized.key = normalized.page_key;
    }

    if (entry.table_name === 'staff_attendance' && normalized.date == null && normalized.attendance_date != null) {
        normalized.date = normalized.attendance_date;
    }

    if (entry.table_name === 'teacher_absences' && normalized.date == null && normalized.absence_date != null) {
        normalized.date = normalized.absence_date;
    }

    if (entry.table_name === 'exam_rooms') {
        if (normalized.room_id == null) {
            normalized.room_id = normalized.id || localId || normalized.room_name || '';
        }
    }

    if (entry.table_name === 'students' && normalized.code == null && localId != null) {
        normalized.code = localId;
    }

    if (entry.table_name === 'settings' && normalized.key == null && localId != null) {
        normalized.key = localId;
    }

    return normalized;
}

function readOutboxAncestorData(db, rowSyncId) {
    try {
        const mapping = db.prepare('SELECT ancestor_data FROM sync_id_map WHERE row_sync_id = ?').get(rowSyncId);
        return mapping?.ancestor_data ? JSON.parse(mapping.ancestor_data) : null;
    } catch {
        return null;
    }
}

function buildFirestoreDoc(db, entry, schoolId, deviceHash) {
    let parsedRowData = {};
    try {
        parsedRowData = entry.row_data ? JSON.parse(entry.row_data) : {};
    } catch (err) {
        return failFirestoreDocBuild(entry, `Failed to parse row_data: ${err.message}`, { code: err.code || null });
    }

    const hasOutboxRowData = Object.keys(parsedRowData).length > 0;
    if (entry.operation === 'DEL' && !hasOutboxRowData) {
        parsedRowData = readOutboxAncestorData(db, entry.row_sync_id) || {};
    }
    const hasDeleteIdentityData = Object.keys(parsedRowData).length > 0;

    const rowData = stripSensitiveFields(parsedRowData) || {};
    const entityType = getEntityType(entry.table_name);
    if (!entityType) {
        return failFirestoreDocBuild(entry, `Unknown entity type for table '${entry.table_name}'`);
    }

    const normalizedData = normalizeSortKeyRowData(entry, rowData);

    if (entry.table_name === 'absences' || entry.table_name === 'grades') {
        if (normalizedData.student_code == null) {
            normalizedData.student_code = resolveStudentCode(db, normalizedData.student_id, normalizedData.school_year);
        }
        delete normalizedData.student_id;
        delete normalizedData.id;
    }

    if (entry.table_name === 'student_files') {
        if (normalizedData.doc_key == null && normalizedData.file_id != null) {
            normalizedData.doc_key = normalizedData.file_id;
        }

        if (normalizedData.student_code == null) {
            normalizedData.student_code = resolveStudentCode(db, normalizedData.student_id, normalizedData.school_year);
        }

        if (!normalizedData.student_code) {
            return failFirestoreDocBuild(entry, 'Failed to resolve student_code for student_files', {
                studentId: normalizedData.student_id || null,
                schoolYear: normalizedData.school_year || null
            });
        }

        delete normalizedData.student_id;
        delete normalizedData.file_id;
        delete normalizedData.id;
    }

    const documentId = buildDocumentId(entry.table_name, normalizedData);
    if (!documentId) {
        if (entry.operation === 'DEL' && !hasOutboxRowData && !hasDeleteIdentityData) {
            entry._syncNoopDelete = true;
            entry._syncBuildError =
                `[sync:push] Skipped no-op delete without local identity data ` +
                `(table=${entry.table_name}, rowSyncId=${entry.row_sync_id || '—'}, outboxId=${entry.id || '—'})`;
            // Benign, expected drain: these DEL entries were never pushed to Firestore,
            // so retiring them is a true no-op. Keep a console breadcrumb but do NOT
            // write to the app error log — otherwise the diagnostics viewer surfaces a
            // routine queue drain as if it were a failure.
            console.debug(entry._syncBuildError);
            return null;
        }
        return failFirestoreDocBuild(entry, `Failed to build document ID for table '${entry.table_name}'`, {
            requiredIdFields: COLLECTION_MAP[entry.table_name]?.idFields || []
        });
    }

    const mapping = db.prepare('SELECT version FROM sync_id_map WHERE row_sync_id = ?').get(entry.row_sync_id);
    const currentVersion = Number(mapping?.version || 0);
    const newVersion = currentVersion + 1;
    const updatedAt = Math.floor(Date.now() / 1000);

    return {
        collectionPath: getCollectionPath(schoolId, entry.table_name),
        documentId,
        entityType,
        entityId: documentId,
        data: normalizedData,
        version: newVersion,
        operation: entry.operation,
        rowSyncId: entry.row_sync_id,
        deviceHash: String(deviceHash || '').substring(0, 16),
        schoolYear: entry.school_year || '',
        updatedAt
    };
}

function buildFirestorePayload(item) {
    return {
        ...item.data,
        version: item.version,
        operation: item.operation,
        rowSyncId: item.rowSyncId,
        deviceHash: item.deviceHash,
        schoolYear: item.schoolYear,
        updatedAt: item.updatedAt
    };
}

const REMOTE_SYNC_METADATA_FIELDS = [
    'version',
    'operation',
    'rowSyncId',
    'deviceHash',
    'schoolYear',
    'updatedAt',
    'ttl'
];

function stripRemoteSyncMetadata(data) {
    const clean = { ...(data || {}) };
    for (const field of REMOTE_SYNC_METADATA_FIELDS) {
        delete clean[field];
    }
    return clean;
}

function isEquivalentRemoteData(localData, remoteData) {
    const localChecksum = computeRowChecksum(localData || {}, SENSITIVE_FIELDS);
    const remoteChecksum = computeRowChecksum(stripRemoteSyncMetadata(remoteData), SENSITIVE_FIELDS);
    return localChecksum === remoteChecksum;
}

async function writeItemWithVersionCheck(firestoreDb, item) {
    try {
        const docRef = doc(firestoreDb, item.collectionPath, item.documentId);
        const transactionResult = await runTransaction(firestoreDb, async (transaction) => {
            const existing = await transaction.get(docRef);
            if (existing.exists() && Number(existing.data().version || 0) >= item.version) {
                return { conflict: true, remoteData: existing.data() || {} };
            }

            if (item.operation === 'DEL') {
                // Physically remove the mirrored entity doc rather than writing a
                // merge-tombstone. The DEL is still recorded in syncLog/changes for
                // incremental peers; leaving a { operation:'DEL' } doc behind pollutes
                // the collection and breaks bootstrap (which reads the collection
                // directly and can't distinguish a tombstone from a live row).
                transaction.delete(docRef);
            } else {
                transaction.set(docRef, buildFirestorePayload(item), { merge: true });
            }
            return { conflict: false };
        });

        if (transactionResult?.conflict) {
            const remoteData = transactionResult.remoteData || {};
            return {
                success: false,
                conflict: true,
                equivalent: isEquivalentRemoteData(item.data, remoteData),
                error: 'Version conflict',
                errorName: 'VERSION_CONFLICT',
                remoteData,
                remoteVersion: Number(remoteData.version || 0),
                remoteDeviceHash: remoteData.deviceHash || ''
            };
        }

        return { success: true };
    } catch (err) {
        // Bug-domain recovery path (firestore-sync-assertion-crash-fix): a
        // mid-transaction auth-token refresh failure (`auth/network-request-failed`)
        // or the Firestore internal-assertion leak is treated as a transient,
        // recoverable error. We return a unified result WITHOUT letting the error
        // throw/leak so the affected row stays `pending` and the cycle can trigger
        // client recovery (terminate + re-init). Other errors keep their existing
        // classification unchanged (Req 2.1, 2.2).
        if (isAssertionOrAuthNetworkError(err)) {
            return { success: false, isRecoverable: true, isTransient: true, errorName: err.code };
        }
        const isAccessDenied = err.code === 'permission-denied';
        return {
            success: false,
            error: err.message,
            errorName: err.code,
            isAccessDenied,
            isThrottle: isThrottleError(err)
        };
    }
}

function markEntrySent(db, entryId, versionOverride = null, rowSyncId = null, rowData = null) {
    // Read row_sync_id and row_data BEFORE marking sent to avoid TOCTOU with cleanup
    if (!rowSyncId || rowData === null) {
        const entry = db.prepare('SELECT row_sync_id, row_data FROM sync_outbox WHERE id = ?').get(entryId);
        if (entry) {
            rowSyncId = rowSyncId || entry.row_sync_id;
            rowData = rowData !== null ? rowData : entry.row_data;
        }
    }

    // Mark the outbox row sent, bump the id-map version/ancestor, and resolve any linked
    // conflict as one atomic unit (R4). Previously these ran as up to four separate
    // UPDATEs; a crash between the Firestore commit and completing them left the remote
    // holding the change while the local outbox still showed it pending → a duplicate push
    // next cycle. markEntrySent is only ever called from async post-await code (never inside
    // a synchronous better-sqlite3 transaction), so wrapping it here cannot nest.
    const applyMark = db.transaction(() => {
        db.prepare(
            "UPDATE sync_outbox SET status = 'sent', sent_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?"
        ).run(entryId);

        if (rowSyncId) {
            if (versionOverride != null && Number.isFinite(Number(versionOverride))) {
                db.prepare('UPDATE sync_id_map SET version = ?, ancestor_data = ? WHERE row_sync_id = ?').run(
                    Number(versionOverride),
                    rowData,
                    rowSyncId
                );
            } else {
                db.prepare('UPDATE sync_id_map SET version = version + 1, ancestor_data = ? WHERE row_sync_id = ?').run(
                    rowData,
                    rowSyncId
                );
            }
            db.prepare(
                `
                UPDATE sync_conflicts
                SET status = 'resolved',
                    resolution = 'merged',
                    resolved_data = COALESCE(resolved_data, local_data),
                    resolved_at = CURRENT_TIMESTAMP
                WHERE local_outbox_id = ?
                  AND status = 'unresolved'
            `
            ).run(entryId);
        }
    });
    applyMark();
}

function markEntryFailed(db, entryId, error, maxRetries, ignoreMaxRetries = false, forceFailed = false) {
    const entry = db.prepare('SELECT retries FROM sync_outbox WHERE id = ?').get(entryId);
    const retries = Number(entry?.retries || 0);
    const newStatus = forceFailed ? 'failed' : !ignoreMaxRetries && retries >= maxRetries ? 'failed' : 'pending';

    db.prepare(
        'UPDATE sync_outbox SET retries = ?, last_attempt_at = CURRENT_TIMESTAMP, last_error = ?, status = ? WHERE id = ?'
    ).run(retries, error, newStatus, entryId);
}

function reopenVersionConflictOutbox(db) {
    try {
        db.prepare(
            `
            UPDATE sync_outbox
            SET status = 'pending',
                last_error = NULL
            WHERE status = 'failed'
              AND last_error = 'Version conflict'
              AND id IN (
                  SELECT local_outbox_id
                  FROM sync_conflicts
                  WHERE status = 'unresolved'
                    AND local_outbox_id IS NOT NULL
              )
        `
        ).run();
    } catch (err) {
        console.warn('[sync:push] Failed to reopen version-conflict outbox rows:', err.message);
    }
}

function updatePushMeta(db, lastPushAt, lastPushError) {
    // NULL keeps whatever value is currently stored — used by the "don't clobber a
    // meaningful prior error" guard below (a transient later reason like
    // "Failed to obtain credentials" must never overwrite a real PERMISSION_DENIED).
    if (lastPushError === undefined) {
        db.prepare(
            'UPDATE sync_config SET last_push_at = COALESCE(?, last_push_at), updated_at = CURRENT_TIMESTAMP WHERE id = 1'
        ).run(lastPushAt);
        return;
    }
    db.prepare(
        'UPDATE sync_config SET last_push_at = ?, last_push_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
    ).run(lastPushAt, lastPushError);
}

// Translate known failure strings into user-facing Arabic messages so the status
// banner (and the diagnostics panel) shows something actionable instead of the
// raw gRPC/English SDK text. The raw English is still emitted to the file app
// log via console.warn/error for forensics. Returns the input unchanged when no
// case matches — preserving existing behavior for every other error class.
//
// Pure & exportable so it can be unit-tested directly (plan verification §3).
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

// Persist last_push_at / last_push_error for the cycle, wrapped so that a failure
// to persist the error state itself never throws out of the Push_Cycle. If the
// underlying UPDATE fails (e.g. while trying to record a syncLog-batch failure),
// a fallback log captures the condition so the error is never silently lost
// (Req 8.6, 8.7, 8.8). The stored `last_push_error` is the Arabic-facing string
// (translated via classifyPushError); the raw English is preserved in the console
// breadcrumbs / app error log for forensics.
function recordPushMeta(db, lastPushAt, lastPushError) {
    const translated = lastPushError == null ? lastPushError : classifyPushError(lastPushError);
    try {
        updatePushMeta(db, lastPushAt, translated);
    } catch (err) {
        console.error(
            '[sync:push] Failed to persist push meta (last_push_at/last_push_error).',
            'Intended error state:',
            lastPushError,
            '| persistence error:',
            err && err.message
        );
    }
}

// Follow-up scheduling predicate (Req 6.3, Property 21). A follow-up Push_Cycle
// is scheduled via scheduleBacklogPush if and only if pending rows remain AND at
// least one item was sent AND no item failed this cycle. Centralized here so the
// dispatch wiring and any test exercise the exact same rule.
function shouldScheduleFollowupPush(pendingCount, sentCount, failedCount) {
    return pendingCount > 0 && sentCount > 0 && failedCount === 0;
}

// Effective push throughput in documents/second (Req 8.2, 8.3, Property 22):
// sent / (durationMs / 1000) when durationMs > 0, and exactly 0 when the cycle
// duration is zero (avoids division by zero).
function computePushThroughput(sentCount, durationMs) {
    if (!(durationMs > 0)) return 0;
    return sentCount / (durationMs / 1000);
}

function compactPendingOutbox(db) {
    try {
        const result = db
            .prepare(
                `
                UPDATE sync_outbox
                SET status = 'superseded',
                    last_error = NULL
                WHERE status = 'pending'
                  AND id NOT IN (
                      SELECT MAX(id)
                      FROM sync_outbox
                      WHERE status = 'pending'
                      GROUP BY row_sync_id
                  )
            `
            )
            .run();
        if (result.changes > 0) {
            console.log(`[sync:push] Compacted ${result.changes} superseded pending outbox entries`);
        }
        return result.changes || 0;
    } catch (err) {
        console.warn('[sync:push] Pending outbox compaction failed:', err.message);
        return 0;
    }
}

function reopenRecoverableOutbox(db) {
    try {
        const result = db
            .prepare(
                `
                UPDATE sync_outbox
                SET status = 'pending',
                    retries = 0,
                    last_error = NULL
                WHERE (
                    status = 'failed'
                    OR retries >= COALESCE((SELECT max_retries FROM sync_config WHERE id = 1), 10)
                )
                  AND last_error LIKE 'Invalid document reference.%'
            `
            )
            .run();
        if (result.changes > 0) {
            console.log(`[sync:push] Reopened ${result.changes} recoverable document-path failures`);
        }
    } catch (err) {
        console.warn('[sync:push] Failed to reopen recoverable outbox rows:', err.message);
    }
}

// Reopen composite-key deletions that were terminally failed by an OLDER build's
// "Failed to build document ID" path. Those DEL outbox rows store a null
// row_data, so the pre-fix builder could never construct the deterministic
// document ID (e.g. absences: student_code__month__school_year__absence_type)
// and the rows poisoned the push queue forever. The current builder recovers the
// id fields from sync_id_map.ancestor_data — or, when the row was never synced,
// retires the entry as a no-op delete — so reopening these lets them finally
// drain. Scoped to operation = 'DEL' so genuinely unbuildable PUTs are not looped.
function reopenUnbuildableDeletes(db) {
    try {
        const result = db
            .prepare(
                `
                UPDATE sync_outbox
                SET status = 'pending',
                    retries = 0,
                    last_error = NULL
                WHERE operation = 'DEL'
                  AND (
                    status = 'failed'
                    OR retries >= COALESCE((SELECT max_retries FROM sync_config WHERE id = 1), 10)
                  )
                  AND last_error LIKE '%Failed to build document ID%'
            `
            )
            .run();
        if (result.changes > 0) {
            console.log(
                `[sync:push] Reopened ${result.changes} deletion(s) with recoverable document-id build failures`
            );
        }
    } catch (err) {
        console.warn('[sync:push] Failed to reopen unbuildable deletes:', err.message);
    }
}

async function recoverCloudSessionAfterPermissionDenied(stage) {
    console.warn(`[sync:${stage}] permission-denied detected; refreshing Firebase auth and Firestore client`);

    clearCredentials();

    try {
        await recoverFirestoreClient();
    } catch (err) {
        console.warn(`[sync:${stage}] Firestore client recovery failed:`, err && err.message);
        return false;
    }

    const credentials = await getCredentials();
    if (!credentials) {
        console.warn(`[sync:${stage}] Auth recovery failed: no Firebase credentials available`);
        return false;
    }

    let connectivity;
    try {
        connectivity = await testConnection();
    } catch (err) {
        connectivity = { success: false, error: err && err.message };
    }

    if (!connectivity || !connectivity.success) {
        console.warn(
            `[sync:${stage}] Auth recovery failed: warm-up rejected after credential refresh`,
            connectivity?.error || ''
        );
        return false;
    }

    console.log(`[sync:${stage}] Firebase auth recovered; retry scheduled`);
    return true;
}

function scheduleBacklogPush() {
    if (_backlogPushTimer) {
        return;
    }

    _backlogPushTimer = setTimeout(() => {
        _backlogPushTimer = null;
        if (_flushRunning) {
            scheduleBacklogPush();
            return;
        }
        void flushSyncOutbox().catch((err) => {
            console.warn('[sync:push] Backlog push failed:', err.message);
        });
    }, BACKLOG_PUSH_DELAY_MS);

    if (typeof _backlogPushTimer.unref === 'function') {
        _backlogPushTimer.unref();
    }
}

function getCurrentRole() {
    try {
        const { resolveRole } = require('../auth/permissions');
        const { getActiveSessions } = require('../ipc/auth');
        const sessions = getActiveSessions();
        const priority = [
            'admin',
            'principal',
            'supervisor',
            'external-guardian',
            'internal-guardian',
            'admin-assistant',
            'educational-specialist',
            'social-specialist',
            'teacher',
            'viewer',
            'staff'
        ];

        if (sessions && sessions.size > 0) {
            for (const role of priority) {
                for (const session of sessions.values()) {
                    const resolved = resolveRole(String(session.role || '').trim());
                    if (resolved === resolveRole(role)) return resolved;
                }
            }
        }

        const db = getDb();
        const config = readSyncConfig(db);
        const email = String(config.firebase_email || '')
            .trim()
            .toLowerCase();
        if (!email) return null;

        const user = db
            .prepare(
                `
                SELECT role
                FROM users
                WHERE lower(email) = ?
                  AND COALESCE(disabled, 0) = 0
                LIMIT 1
            `
            )
            .get(email);
        const role = resolveRole(String(user?.role || '').trim());
        return priority.map((item) => resolveRole(item)).includes(role) ? role : null;
    } catch (err) {
        console.warn('[sync:push] getCurrentRole failed:', err.message);
        return null;
    }
}

function logVersionConflict(db, prepared, result) {
    try {
        const ancestorMapping = db
            .prepare('SELECT ancestor_data FROM sync_id_map WHERE row_sync_id = ?')
            .get(prepared.item.rowSyncId);
        const conflictTableName =
            Object.keys(ENTITY_TYPE_REGISTRY).find(
                (k) => ENTITY_TYPE_REGISTRY[k].entityType === prepared.item.entityType
            ) || '';
        const remoteData = stripRemoteSyncMetadata(result.remoteData || {});

        // Forensics: record WHY this push collided (version desync vs genuine concurrent edit)
        logConflictForensics({
            phase: 'push',
            table: conflictTableName,
            rowSyncId: prepared.item.rowSyncId,
            entityType: prepared.item.entityType,
            localVersion: prepared.item.version,
            remoteVersion: result.remoteVersion || null,
            ancestorPresent: !!ancestorMapping?.ancestor_data,
            remoteDeviceHash: result.remoteDeviceHash || null,
            remoteTs: Number(result.remoteData?.updatedAt) || null,
            localTs: prepared.item.updatedAt || null,
            resolution: 'lww-unresolved',
            note: result.equivalent ? 'equivalent-checksum' : 'version-conflict'
        });

        const existing = db
            .prepare(
                `
                SELECT id
                FROM sync_conflicts
                WHERE local_outbox_id = ?
                  AND status = 'unresolved'
                LIMIT 1
            `
            )
            .get(prepared.entryId);

        if (existing) {
            db.prepare(
                `
                UPDATE sync_conflicts
                SET remote_data = ?,
                    remote_version = ?,
                    remote_device_hash = ?,
                    ancestor_data = COALESCE(ancestor_data, ?)
                WHERE id = ?
            `
            ).run(
                JSON.stringify(remoteData),
                result.remoteVersion || prepared.item.version,
                result.remoteDeviceHash || '',
                ancestorMapping?.ancestor_data || null,
                existing.id
            );
            return;
        }

        db.prepare(
            `
            INSERT INTO sync_conflicts(table_name, row_sync_id, entity_type, local_data, remote_data,
                remote_version, remote_device_hash, local_outbox_id, ancestor_data, resolution_method, status)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'lww', 'unresolved')
        `
        ).run(
            conflictTableName,
            prepared.item.rowSyncId || '',
            prepared.item.entityType || '',
            JSON.stringify(prepared.item.data || {}),
            JSON.stringify(remoteData),
            result.remoteVersion || prepared.item.version,
            result.remoteDeviceHash || '',
            prepared.entryId,
            ancestorMapping?.ancestor_data || null
        );
    } catch (conflictErr) {
        console.warn(`[sync:push] Failed to log conflict for entry ${prepared.entryId}:`, conflictErr.message);
    }
}

async function writeSyncLogWithRetry(firestoreDb, schoolId, batch, maxAttempts = 3) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await logChangeBatch(firestoreDb, schoolId, batch);
            return true;
        } catch (err) {
            console.warn(`[sync:push] syncLog batch attempt ${attempt}/${maxAttempts} failed:`, err.message);
            if (attempt < maxAttempts) {
                await new Promise((r) => setTimeout(r, 1000 * attempt));
            }
        }
    }
    console.error(
        `[sync:push] syncLog batch PERMANENTLY failed for ${batch.length} items — other devices may not receive these changes`
    );
    return false;
}

// Reconcile a previously-unreconciled (seeded) row whose first push collided with a
// pre-existing server document — the phantom version-conflict bug.
//
// Bug condition (see design.md → isBugCondition): an unreconciled local row
// (`sync_id_map.version` missing/0 AND `ancestor_data` null) whose matching server
// document already exists at `version >= pushedVersion` and is NOT byte-equivalent.
// This function is invoked ONLY from the `result.conflict && !result.equivalent`
// branch, so `guardTripped` and `notByteEquivalent` already hold; here we test the
// remaining `localUnreconciled` half of the condition.
//
// Behavior:
//   - Not the bug condition (row already reconciled): returns { handled: false } and
//     the caller falls through to the unchanged logVersionConflict path.
//   - Bug condition: adopts the server baseline into `sync_id_map` (version + ancestor),
//     re-runs the three-way merge against that adopted ancestor, and:
//       * records NO conflict and marks the outbox entry resolved/sent when the re-merge
//         reports no genuine field-level overlap (`conflicts.length === 0`);
//       * defers to the existing logVersionConflict path (returns { handled: false })
//         only when a real overlap remains (`conflicts.length > 0`), which now logs a
//         genuine conflict with the adopted ancestor present.
//
// Returns: { handled, sent } — when handled is true the caller skips its conflict path.
function reconcileUnreconciledRow(db, prepared, result) {
    const rowSyncId = prepared.item.rowSyncId;
    const mapping = db.prepare('SELECT version, ancestor_data FROM sync_id_map WHERE row_sync_id = ?').get(rowSyncId);

    const localVersion = Number(mapping?.version || 0);
    const localAncestor = mapping?.ancestor_data ?? null;

    // localUnreconciled: version missing/0 AND ancestor null. (guardTripped +
    // notByteEquivalent are implied by reaching the conflict && !equivalent branch.)
    const localUnreconciled = (mapping == null || localVersion === 0) && localAncestor == null;
    if (!localUnreconciled) {
        return { handled: false };
    }

    const remoteVersion = Number(result.remoteVersion || 0);
    const serverData = stripRemoteSyncMetadata(result.remoteData || {});
    const ancestorJson = JSON.stringify(serverData);

    // Adopt the server baseline so subsequent merges/pushes use the correct version
    // and ancestor (Requirement 2.4). This is the reconciliation mechanism.
    db.prepare('UPDATE sync_id_map SET version = ?, ancestor_data = ? WHERE row_sync_id = ?').run(
        remoteVersion,
        ancestorJson,
        rowSyncId
    );

    // Re-run the three-way merge with the adopted ancestor (== remote). Fields the local
    // device did not change collapse to "no change"; only genuinely locally-changed fields
    // survive. Because the ancestor equals the remote, a true overlap (conflicts) can only
    // arise if the data diverges in a way the merge classifies as a real conflict.
    const localData = prepared.item.data || {};
    const localTs = Number(prepared.item.updatedAt) || 0;
    const remoteTs = Number(result.remoteData?.updatedAt) || 0;
    const remerge = threeWayMerge(serverData, localData, serverData, localTs, remoteTs);

    const conflictTableName =
        Object.keys(ENTITY_TYPE_REGISTRY).find(
            (k) => ENTITY_TYPE_REGISTRY[k].entityType === prepared.item.entityType
        ) ||
        prepared.tableName ||
        '';

    // Forensics continuity: annotate reconciled seeded rows without schema changes.
    logConflictForensics({
        phase: 'push',
        table: conflictTableName,
        rowSyncId,
        entityType: prepared.item.entityType,
        localVersion,
        remoteVersion,
        ancestorPresent: false, // ancestor was absent at the moment the collision occurred
        conflictingFields: remerge.conflicts,
        remoteDeviceHash: result.remoteDeviceHash || null,
        remoteTs: remoteTs || null,
        localTs: localTs || null,
        resolution: remerge.conflicts.length > 0 ? 'reconciled-conflict' : 'reconciled-seeded',
        note: 'reconciled-seeded'
    });

    // Genuine field-level difference remains ONLY when the re-merge reports a real overlap.
    // Defer to the existing logVersionConflict path (now with the adopted ancestor present)
    // and let the caller record a genuine conflict (Requirement 2.5).
    if (remerge.conflicts.length > 0) {
        return { handled: false };
    }

    // No genuine difference → reconcile silently: mark the outbox entry resolved/sent and
    // keep the adopted server version + ancestor; record NO unresolved conflict
    // (Requirements 2.1, 2.3, 2.5).
    markEntrySent(db, prepared.entryId, remoteVersion, rowSyncId, ancestorJson);
    return { handled: true, sent: true };
}

// applyItemOutcome — the single, shared per-item branch handler for a
// `writeItemWithVersionCheck` result. Extracted verbatim from the original
// `flushPreparedItems` loop so that BOTH the sequential reference path and the
// bounded-concurrency dispatcher (Layer 1) route every item's result through one
// place, preserving the exact current Version_Guard / conflict / throttle / abort
// semantics (Requirements 3.7, 4.1, 4.2, 4.3, 4.5, 4.7, 4.8, 5.3).
//
// Branch mapping (identical to the prior inline logic):
//   - success                          → markEntrySent; collect item for syncLog batching.
//   - conflict && equivalent           → markEntrySent(remoteVersion || item.version);
//                                        counts as sent, NOT collected for syncLog.
//   - conflict && !equivalent          → reconcileUnreconciledRow; if handled, count
//                                        sent/failed accordingly; otherwise fall through.
//   - throttle / access-denied / other → markEntryFailed (throttle/denied pass
//                                        ignoreMaxRetries=true so the row stays `pending`
//                                        rather than becoming terminally failed); on a
//                                        conflict, logVersionConflict; access-denied also
//                                        signals abort.
//   - no markEntrySent side effects are applied for any failed/throttled/denied item.
//
// ctx shape: { maxRetries, schoolId } (schoolId is unused here — the caller owns the
//   post-loop syncLog batch write — but is part of the documented contract so both
//   callers can share one ctx object).
//
// Returns a structured outcome the caller aggregates:
//   {
//     status,      // classification: 'sent' | 'failed' | 'throttled' |
//                  //   'access-denied' | 'conflict-logged' (Layer 1/metrics consume this;
//                  //   the sequential flushPreparedItems ignores it)
//     sent,        // 0 | 1 — increment to sentCount
//     failed,      // 0 | 1 — increment to failedCount
//     abort,       // boolean — access-denied; caller decides when to act on it
//     syncLogItem, // prepared.item when it should join the syncLog batch, else null
//     lastError    // error string to adopt as the running lastError, or null to leave it
//   }
//
// Note on throttle/pending semantics (Req 3.7, 4.8): a throttled item is reported with
// status 'throttled' and is left in `pending` status (markEntryFailed with
// ignoreMaxRetries=true keeps the row `pending`, never terminally `failed`), so it is
// retried on a subsequent group or Push_Cycle. No `markEntrySent` side effects are
// applied for any failed/throttled/denied item.
function applyItemOutcome(db, prepared, result, ctx) {
    const maxRetries = ctx.maxRetries;

    // Success → mark sent and collect for syncLog batching.
    if (result.success) {
        markEntrySent(db, prepared.entryId);
        return { status: 'sent', sent: 1, failed: 0, abort: false, syncLogItem: prepared.item, lastError: null };
    }

    // Equivalent conflict → accepted at the remote version. Counts as sent but is NOT
    // collected for syncLog batching (matches prior behavior exactly).
    if (result.conflict && result.equivalent) {
        markEntrySent(db, prepared.entryId, result.remoteVersion || prepared.item.version);
        return { status: 'sent', sent: 1, failed: 0, abort: false, syncLogItem: null, lastError: null };
    }

    const lastError = result.error || 'Conditional write failed';

    // Reconciliation branch (phantom version-conflict fix): when an UNRECONCILED
    // seeded row collides with a pre-existing server document, adopt the server
    // baseline and re-merge instead of recording a phantom unresolved conflict.
    // Gated strictly on the bug condition — only the conflict && !equivalent branch
    // reaches here, and reconcileUnreconciledRow tests the localUnreconciled half.
    if (result.conflict && !result.equivalent) {
        const reconcileOutcome = reconcileUnreconciledRow(db, prepared, result);
        if (reconcileOutcome.handled) {
            if (reconcileOutcome.sent) {
                return { status: 'sent', sent: 1, failed: 0, abort: false, syncLogItem: null, lastError };
            }
            return { status: 'failed', sent: 0, failed: 1, abort: false, syncLogItem: null, lastError };
        }
    }

    markEntryFailed(
        db,
        prepared.entryId,
        lastError,
        maxRetries,
        result.isThrottle || result.isAccessDenied || result.isRecoverable || result.isTransient,
        result.conflict
    );

    if (result.conflict) {
        logVersionConflict(db, prepared, result);
    }

    // Access-denied almost always means the Firestore client issued the write without a
    // live auth token (a cached-but-stale session survived a signOut). Drop the cached
    // credentials so the next Push_Cycle rebuilds a fresh Firebase session instead of
    // reusing the dead one — this mirrors the pull path's permission-denied handling.
    if (result.isAccessDenied) {
        clearCredentials();
    }

    // Classify the failure for Layer 1 / metrics consumers. Throttle, access-denied,
    // and the recoverable assertion/auth-network bug-domain error all leave the row
    // `pending` (markEntryFailed with ignoreMaxRetries=true above) — no data loss is
    // counted; a logged version conflict is reported as 'conflict-logged'; everything
    // else 'failed'. The recoverable signal is surfaced so the Push_Cycle can trigger
    // a single client recovery (terminate + re-init).
    const isRecoverable = !!(result.isRecoverable || result.isTransient);
    const status = result.isAccessDenied
        ? 'access-denied'
        : isRecoverable
          ? 'recoverable'
          : result.isThrottle
            ? 'throttled'
            : result.conflict
              ? 'conflict-logged'
              : 'failed';

    return {
        status,
        sent: 0,
        failed: 1,
        recoverable: isRecoverable,
        accessDenied: !!result.isAccessDenied,
        abort: !!result.isAccessDenied,
        syncLogItem: null,
        lastError
    };
}

// runBatchedFastPath — the optional Layer 2 Batched Fast Path for the common
// no-conflict case (Req 4.4, 7.1-7.7). It bulk-reads current remote versions,
// commits non-conflicting survivors via Firestore `writeBatch`, and routes every
// conflicting / unreadable / commit-failed item back to the per-document
// Version_Guard (Layer 1) so nothing is ever marked sent without a guarded write.
//
// `preparedItems` are records already past `canPush` and `expandBulkEntry`:
//   { entryId, item, tableName }  where item is a buildFirestoreDoc output
//     (collectionPath, documentId, data, version, rowSyncId, ...).
// `ctx` carries the post-cycle batching contract; this function reads nothing from
//   it today but keeps it symmetric with applyItemOutcome's ctx ({ maxRetries, schoolId }).
//
// Pipeline:
//   1. Bulk read — group items by collectionPath (documentId() 'in' is per-collection),
//      then chunk each group's document ids into queries of <= 30 ids via
//      `query(collection(...), where(documentId(), 'in', chunk))` + `getDocs` (Req 7.1).
//      A chunk whose read throws routes ALL of its items to guard (Req 7.5).
//   2. Partition — for each item, look up its remote version from the bulk-read snapshot:
//        local version vL > remote version vR  → batchable survivor (Req 7.2).
//        vR >= vL, OR not found / unreadable    → guard-routed (Req 4.4, 7.4).
//   3. Commit — chunk survivors into writeBatch commits of <= 500 ops (Req 7.3),
//      each op `set(ref, buildFirestorePayload(item), { merge: true })` for PUTs, or
//      `delete(ref)` for DEL operations (tombstones are not mirrored). On a
//      successful commit apply markEntrySent + collect the item for the syncLog batch,
//      identical to the per-document success path (Req 7.7). A failed commit re-routes
//      EVERY item in that commit to guard; nothing in it is marked sent (Req 7.6).
//
// Returns { sentItems, guardRoutedItems }:
//   - sentItems       — the committed `item` objects (already markEntrySent); the caller
//                        feeds these into writeSyncLogWithRetry, exactly like the
//                        per-document success path collects `prepared.item`.
//   - guardRoutedItems — the prepared records ({ entryId, item, tableName }) that must
//                        flow through the Layer 1 dispatcher (wired in task 9.5).
async function runBatchedFastPath(db, firestoreDb, preparedItems, _ctx) {
    const list = Array.isArray(preparedItems) ? preparedItems : [];
    const sentItems = [];
    const guardRoutedItems = [];

    if (list.length === 0) {
        return { sentItems, guardRoutedItems };
    }

    // --- Group by collection path (documentId() 'in' queries are per-collection). ---
    const groups = new Map(); // collectionPath -> prepared[]
    for (const prepared of list) {
        const collectionPath = prepared.item.collectionPath;
        if (!groups.has(collectionPath)) {
            groups.set(collectionPath, []);
        }
        groups.get(collectionPath).push(prepared);
    }

    // --- Bulk read + partition into batchable survivors vs. guard-routed. ---
    const survivors = []; // prepared[] safe to write (vL > vR)

    for (const [collectionPath, groupItems] of groups) {
        // documentId() 'in' accepts at most 30 ids per query (Req 7.1).
        const chunks = chunkArray(groupItems, 30);

        for (const chunk of chunks) {
            // Dedupe ids for the query while keeping every prepared record routed.
            const ids = [...new Set(chunk.map((p) => p.item.documentId))];

            let remoteVersionById = null;
            try {
                const snapshot = await getDocs(
                    query(collection(firestoreDb, collectionPath), where(documentId(), 'in', ids))
                );
                remoteVersionById = new Map();
                snapshot.forEach((docSnap) => {
                    remoteVersionById.set(docSnap.id, Number(docSnap.data()?.version || 0));
                });
            } catch {
                // Bulk-read failure → route the WHOLE chunk to guard (Req 7.5). Nothing
                // is marked sent for these items.
                for (const prepared of chunk) {
                    guardRoutedItems.push(prepared);
                }
                continue;
            }

            for (const prepared of chunk) {
                const docId = prepared.item.documentId;
                const localVersion = Number(prepared.item.version || 0);

                if (!remoteVersionById.has(docId)) {
                    // Not found / unreadable → cannot evaluate the strict rule here;
                    // route to the per-document Version_Guard (Req 4.4, 7.4).
                    guardRoutedItems.push(prepared);
                    continue;
                }

                const remoteVersion = remoteVersionById.get(docId);
                if (localVersion > remoteVersion) {
                    survivors.push(prepared); // batchable (Req 7.2)
                } else {
                    // vR >= vL → guard-routed (Req 7.4).
                    guardRoutedItems.push(prepared);
                }
            }
        }
    }

    // --- Commit survivors via writeBatch, <= 500 ops per commit (Req 7.3). ---
    const commitChunks = chunkArray(survivors, 500);

    for (const commitChunk of commitChunks) {
        try {
            const batch = writeBatch(firestoreDb);
            for (const prepared of commitChunk) {
                const ref = doc(firestoreDb, prepared.item.collectionPath, prepared.item.documentId);
                if (prepared.item.operation === 'DEL') {
                    // Physically delete the mirrored entity doc instead of writing a
                    // merge-tombstone (see writeItemWithVersionCheck). The DEL is still
                    // captured in syncLog/changes for incremental pull.
                    batch.delete(ref);
                } else {
                    batch.set(ref, buildFirestorePayload(prepared.item), { merge: true });
                }
            }
            await batch.commit();

            // Successful commit → apply markEntrySent + collect for the syncLog batch,
            // identical to the per-document success path (Req 7.7).
            for (const prepared of commitChunk) {
                markEntrySent(db, prepared.entryId);
                sentItems.push(prepared.item);
            }
        } catch {
            // Commit failure → re-route every item in this commit to the Version_Guard;
            // nothing in a failed commit is marked sent (Req 7.6).
            for (const prepared of commitChunk) {
                guardRoutedItems.push(prepared);
            }
        }
    }

    return { sentItems, guardRoutedItems };
}

async function flushPreparedItems(db, firestoreDb, preparedItems, maxRetries, schoolId) {
    if (!preparedItems.length) {
        return {
            sentCount: 0,
            failedCount: 0,
            lastError: null,
            abort: false,
            syncLogWritten: true,
            recoverableErrors: 0,
            accessDeniedErrors: 0
        };
    }

    // Always use conditional writes for version-guarded pushes. Each item's result is
    // routed through the shared applyItemOutcome handler so the sequential reference path
    // and the Layer 1 dispatcher share identical per-item semantics.
    let sentCount = 0;
    let failedCount = 0;
    let lastError = null;
    let recoverableErrors = 0;
    let accessDeniedErrors = 0;
    const successfulItems = [];
    const ctx = { maxRetries, schoolId };

    for (const prepared of preparedItems) {
        const result = await writeItemWithVersionCheck(firestoreDb, prepared.item);
        const outcome = applyItemOutcome(db, prepared, result, ctx);

        sentCount += outcome.sent;
        failedCount += outcome.failed;
        if (outcome.recoverable) recoverableErrors += 1;
        if (outcome.accessDenied) accessDeniedErrors += 1;
        if (outcome.lastError) {
            lastError = outcome.lastError;
        }
        if (outcome.syncLogItem) {
            successfulItems.push(outcome.syncLogItem);
        }

        // Access-denied aborts the cycle immediately in the sequential path (post-item),
        // returning before the syncLog batch write — identical to prior behavior.
        if (outcome.abort) {
            return { sentCount, failedCount, lastError, abort: true, recoverableErrors, accessDeniedErrors };
        }
    }

    // Batch-log successfully sent items to syncLog (with retry)
    let syncLogWritten = true;
    if (successfulItems.length > 0 && schoolId) {
        syncLogWritten = await writeSyncLogWithRetry(firestoreDb, schoolId, successfulItems);
    }

    return {
        sentCount,
        failedCount,
        lastError,
        abort: false,
        syncLogWritten,
        recoverableErrors,
        accessDeniedErrors
    };
}

// flushPreparedItemsConcurrent — the Layer 1 bounded-concurrency replacement for the
// sequential `flushPreparedItems` per-item loop (Req 1.1-1.5, 4.5/4.6, 5.3, 6.1/6.4).
//
// It dispatches the prepared `{ entryId, item }` records group-by-group:
//   - Each group holds up to `rateLimiter.active` items and is dispatched through
//     `runConcurrentGroup`, which keeps at most `active` Version_Guard transactions
//     (`writeItemWithVersionCheck`) in flight at once and never cancels a dispatched
//     item (full settlement, Req 1.1, 1.4).
//   - Per-item DB side effects are applied AFTER the whole group settles, in input
//     order, through the shared `applyItemOutcome` handler so the observable result
//     (rows marked sent/failed/pending, conflict logging, syncLog collection) matches
//     the sequential reference exactly (Req 1.3).
//   - After a group settles the Rate_Limiter is updated from the group result: a clean
//     group ramps the active limit up (`onGroupSuccess`), a throttled group halves it
//     (`onThrottle`) and the dispatcher sleeps `backoffDelayMs()` before the next group
//     (Req 3.2-3.6).
//   - An access-denied abort is evaluated ONLY after the current group has fully
//     settled — never mid-flight — matching the sequential abort semantics (Req 1.4,
//     4.5, 4.6).
//   - Successfully sent items are batch-logged to syncLog via `writeSyncLogWithRetry`
//     exactly once for the collected sent set (Req 1.5).
//
// The `rateLimiter` is created once per Push_Cycle and shared across invocations so the
// ramp-up / back-off state persists for the whole cycle. Returns the same shape as
// `flushPreparedItems` plus a `throttleErrors` count for metrics consumers.
//
// `preSentItems` (optional, default []) carries item objects that were ALREADY committed
// and `markEntrySent`'d by the Layer 2 Batched Fast Path before this dispatch. They are
// NOT re-marked here; they are simply (a) counted toward `sentCount` and (b) folded into
// the single combined syncLog batch alongside the Layer 1 success set, so the syncLog
// contract for the flush = fast-path sent items + Layer 1 sent items, written exactly
// once with no double-logging. When `preSentItems` is empty (the default and the
// flag-off path), behavior is byte-for-byte identical to before.
async function flushPreparedItemsConcurrent(
    db,
    firestoreDb,
    preparedItems,
    maxRetries,
    schoolId,
    rateLimiter,
    preSentItems = []
) {
    if (!preparedItems.length) {
        // No Layer 1 work to do. Still fold any fast-path pre-sent items into the syncLog
        // batch and the sent count so the combined contract holds even when every item
        // was committed by the fast path.
        let syncLogWritten = true;
        if (preSentItems.length > 0 && schoolId) {
            syncLogWritten = await writeSyncLogWithRetry(firestoreDb, schoolId, preSentItems);
        }
        return {
            sentCount: preSentItems.length,
            failedCount: 0,
            lastError: null,
            abort: false,
            syncLogWritten,
            throttleErrors: 0,
            recoverableErrors: 0,
            accessDeniedErrors: 0
        };
    }

    // Seed the sent set with the fast-path pre-sent items so the final syncLog batch is a
    // single combined write and the sent count includes them (they are already
    // markEntrySent'd — do NOT mark them again here).
    let sentCount = preSentItems.length;
    let failedCount = 0;
    let lastError = null;
    let abort = false;
    let throttleErrors = 0;
    let recoverableErrors = 0;
    let accessDeniedErrors = 0;
    const successfulItems = [...preSentItems];
    const ctx = { maxRetries, schoolId };

    // The worker performs ONLY the network/transaction step; all DB side effects are
    // applied post-group via applyItemOutcome to preserve sequential-equivalent ordering.
    const worker = (prepared) => writeItemWithVersionCheck(firestoreDb, prepared.item);

    const orderedPreparedItems = sortPreparedItemsForPush(preparedItems);
    let cursor = 0;
    while (cursor < orderedPreparedItems.length) {
        const activeLimit = Math.max(1, rateLimiter.active);
        const currentRank = getTopologyRank(
            orderedPreparedItems[cursor].item?.tableName,
            orderedPreparedItems[cursor].item?.operation
        );
        let end = cursor;
        while (
            end < orderedPreparedItems.length &&
            end - cursor < activeLimit &&
            getTopologyRank(orderedPreparedItems[end].item?.tableName, orderedPreparedItems[end].item?.operation) ===
                currentRank
        ) {
            end += 1;
        }
        const group = orderedPreparedItems.slice(cursor, end);
        cursor = end;

        const { outcomes, throttled } = await runConcurrentGroup(group, activeLimit, worker);

        // Apply each settled outcome in input order so side effects and aggregation match
        // the sequential reference exactly. The abort is recorded but NOT acted on until
        // the entire group has been processed (Req 1.4, 4.5).
        let groupAbort = false;
        for (let i = 0; i < group.length; i += 1) {
            const outcome = applyItemOutcome(db, group[i], outcomes[i], ctx);
            sentCount += outcome.sent;
            failedCount += outcome.failed;
            if (outcome.recoverable) recoverableErrors += 1;
            if (outcome.accessDenied) accessDeniedErrors += 1;
            if (outcome.lastError) lastError = outcome.lastError;
            if (outcome.syncLogItem) successfulItems.push(outcome.syncLogItem);
            if (outcome.abort) groupAbort = true;
        }

        // Rate_Limiter update from the settled group result (Req 3.2-3.6).
        if (throttled) {
            throttleErrors += 1;
            rateLimiter.onThrottle();
        } else {
            rateLimiter.onGroupSuccess();
        }

        // Access-denied abort: stop initiating new groups, but only after this group
        // fully settled above (no in-flight cancellation) (Req 4.5, 4.6). When aborting
        // there is no next group, so skip the back-off sleep.
        if (groupAbort) {
            abort = true;
            break;
        }

        // Back off before the next group when this one was throttled (Req 3.5).
        if (throttled) {
            const delayMs = rateLimiter.backoffDelayMs();
            if (delayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
    }

    // Batch-log successfully sent items to syncLog (with retry), once for the whole set.
    let syncLogWritten = true;
    if (successfulItems.length > 0 && schoolId) {
        syncLogWritten = await writeSyncLogWithRetry(firestoreDb, schoolId, successfulItems);
    }

    return {
        sentCount,
        failedCount,
        lastError,
        abort,
        syncLogWritten,
        throttleErrors,
        recoverableErrors,
        accessDeniedErrors
    };
}

function isKnownSyncTable(tableName) {
    return !!ENTITY_TYPE_REGISTRY[tableName];
}

function expandBulkEntry(db, entry, _deviceHash) {
    let bulkData = {};

    try {
        bulkData = JSON.parse(entry.row_data || '{}');
    } catch (err) {
        console.warn(`[sync:push] Bulk expansion failed for entry ${entry.id}:`, err.message);
        return [];
    }

    const tableName = entry.table_name;
    const schoolYear = entry.school_year || '';
    const bulkChannel = bulkData.channel;

    if (bulkChannel && !CHANNEL_REGISTRY[bulkChannel]) {
        console.warn(`[sync:push] Unknown bulk channel '${bulkChannel}' for entry ${entry.id}`);
        return [];
    }

    if (!isKnownSyncTable(tableName)) {
        console.warn(`[sync:push] Bulk expansion rejected for unknown table '${tableName}'`);
        return [];
    }

    let rows = [];

    try {
        const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
        const hasSchoolYear = columns.some((column) => column.name === 'school_year');

        if (hasSchoolYear && schoolYear) {
            rows = db.prepare(`SELECT * FROM "${tableName}" WHERE school_year = ?`).all(schoolYear);
        } else {
            rows = db.prepare(`SELECT * FROM "${tableName}"`).all();
        }
    } catch (err) {
        console.warn(`[sync:push] Bulk expansion failed for table '${tableName}':`, err.message);
        return [];
    }

    const expanded = [];
    for (const row of rows) {
        const localId = row.id ?? row.code ?? row.key ?? row.page_key;
        if (localId == null) continue;

        const rowSyncId = ensureSyncIdMapping(db, tableName, localId);
        const cleanData = stripSensitiveFields({ ...row });

        expanded.push({
            table_name: tableName,
            row_sync_id: rowSyncId,
            operation: 'PUT',
            row_data: JSON.stringify(cleanData),
            school_year: schoolYear
        });
    }

    return expanded;
}

async function flushExpandedEntries(db, firestoreDb, entryId, expandedEntries, schoolId, deviceHash, maxRetries, role) {
    let sentCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let lastError = null;
    let abort = false;
    const successfulItems = [];

    for (let index = 0; index < expandedEntries.length; index += 25) {
        const chunk = expandedEntries.slice(index, index + 25);
        const items = [];

        for (const expanded of chunk) {
            if (!canPush(expanded.table_name, role)) {
                skippedCount += 1;
                continue;
            }

            const firestoreDoc = buildFirestoreDoc(db, expanded, schoolId, deviceHash);
            if (!firestoreDoc) {
                failedCount += 1;
                lastError = expanded._syncBuildError || 'Failed to build Firestore document';
                continue;
            }
            items.push(firestoreDoc);
        }

        if (!items.length) {
            continue;
        }

        for (const item of items) {
            const result = await writeItemWithVersionCheck(firestoreDb, item);
            if (result.conflict && result.equivalent) {
                sentCount += 1;
                continue;
            }
            if (!result.success) {
                failedCount += 1;
                lastError = result.error || 'Conditional write failed';
                if (result.isAccessDenied) {
                    abort = true;
                    break;
                }
                continue;
            }

            sentCount += 1;
            successfulItems.push(item);
        }

        if (abort) {
            break;
        }
    }

    let syncLogWritten = true;
    if (successfulItems.length > 0 && schoolId) {
        syncLogWritten = await writeSyncLogWithRetry(firestoreDb, schoolId, successfulItems);
    }

    if (failedCount === 0 && syncLogWritten) {
        markEntrySent(db, entryId);
    } else {
        markEntryFailed(db, entryId, lastError || 'Batch write failed', maxRetries, abort);
    }

    return { sentCount, failedCount, skippedCount, lastError, abort, syncLogWritten };
}

function readPendingOutboxBatch(db, maxRetries, limit) {
    return db
        .prepare(
            `SELECT *
             FROM sync_outbox
             WHERE status = 'pending'
               AND retries < ?
             ORDER BY id ASC
             LIMIT ?`
        )
        .all(maxRetries, limit);
}

function bumpRetryCount(db, entryId) {
    db.prepare('UPDATE sync_outbox SET retries = retries + 1, last_attempt_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        entryId
    );
}

async function processOutboxRow(db, firestoreDb, row, ctx) {
    const { role, schoolId, deviceHash, maxRetries } = ctx;

    if (!canPush(row.table_name, role)) {
        ctx.skippedCount += 1;
        console.log(`[sync:push] Skipped entry ${row.id} — role '${role}' cannot push to '${row.table_name}'`);
        markEntryFailed(db, row.id, `Role '${role}' cannot push to '${row.table_name}'`, maxRetries, false, true);
        return 'continue';
    }

    let rowData = {};
    try {
        rowData = row.row_data ? JSON.parse(row.row_data) : {};
    } catch (err) {
        bumpRetryCount(db, row.id);
        markEntryFailed(db, row.id, `Invalid row_data JSON: ${err.message}`, maxRetries);
        ctx.failedCount += 1;
        ctx.lastError = err.message;
        return 'continue';
    }

    if (rowData._bulk) {
        const aborted = await ctx.flushBuffer();
        if (aborted) return 'break';

        bumpRetryCount(db, row.id);
        const expandedEntries = expandBulkEntry(db, row, deviceHash);
        if (expandedEntries.length === 0) {
            markEntrySent(db, row.id);
            return 'continue';
        }

        const result = await flushExpandedEntries(
            db,
            firestoreDb,
            row.id,
            expandedEntries,
            schoolId,
            deviceHash,
            maxRetries,
            role
        );
        ctx.sentCount += result.sentCount;
        ctx.failedCount += result.failedCount;
        ctx.skippedCount += result.skippedCount;
        if (!result.syncLogWritten) ctx.syncLogOk = false;
        ctx.lastError = result.lastError || ctx.lastError;
        return result.abort ? 'break' : 'continue';
    }

    bumpRetryCount(db, row.id);
    const firestoreDoc = buildFirestoreDoc(db, row, schoolId, deviceHash);
    if (!firestoreDoc) {
        const buildError = row._syncBuildError || `Failed to build Firestore document for table '${row.table_name}'`;
        if (row._syncNoopDelete) {
            markEntrySent(db, row.id);
            ctx.sentCount += 1;
            ctx.lastError = buildError;
            return 'continue';
        }
        markEntryFailed(db, row.id, buildError, maxRetries);
        ctx.failedCount += 1;
        ctx.lastError = buildError;
        return 'continue';
    }

    ctx.batchBuffer.push({ entryId: row.id, item: firestoreDoc });
    if (ctx.batchBuffer.length >= (ctx.dispatchThreshold || 25)) {
        const aborted = await ctx.flushBuffer();
        if (aborted) return 'break';
    }
    return 'continue';
}

async function flushSyncOutbox(limit) {
    if (_flushRunning) return { success: true, skipped: true, reason: 'already_running' };
    _flushRunning = true;
    const authEpochAtStart = _syncAuthEpoch;
    console.log('[sync:push] Push cycle starting...');

    // Cycle wall-clock start for the durationMs / throughput metrics (Req 8.1, 8.2).
    const cycleStartMs = Date.now();

    try {
        const db = getDb();
        const config = readSyncConfig(db);
        if (!Number(config.enabled)) {
            console.log('[sync:push] Skipped: sync not enabled');
            return { success: true, skipped: true, reason: 'not_configured' };
        }
        reopenVersionConflictOutbox(db);
        reopenRecoverableOutbox(db);
        reopenUnbuildableDeletes(db);
        const compactedCount = compactPendingOutbox(db);

        const role = getCurrentRole();
        if (!role) {
            console.log('[sync:push] Skipped: no active session');
            return { success: true, skipped: true, reason: 'no_active_session' };
        }

        const credentials = await getCredentials();
        if (!credentials) {
            console.warn('[sync:push] Failed to obtain credentials');
            // Don't clobber a meaningful prior error (e.g. PERMISSION_DENIED) with the
            // bland "Failed to obtain credentials" string: on the next interval tick, the
            // timer fires again and this branch is hit because clearCredentials() purged
            // the cached session. Passing `undefined` keeps the existing last_push_error
            // untouched (see updatePushMeta). When there is NO prior error to preserve,
            // record the structured SYNC_AUTH_UNAVAILABLE code (translated to Arabic
            // by recordPushMeta→classifyPushError) so the user sees an actionable message
            // instead of the raw English.
            const priorErr = String(config.last_push_error || '').trim();
            recordPushMeta(db, null, priorErr ? undefined : 'SYNC_AUTH_UNAVAILABLE');
            return { success: false, error: 'credentials_unavailable' };
        }

        const maxRetries = Number(config.max_retries) || 10;
        const deviceHash = getDeviceHash();
        const schoolId = resolveSyncSchoolId(config, credentials);

        if (!schoolId) {
            const priorErr = String(config.last_push_error || '').trim();
            recordPushMeta(db, null, priorErr ? undefined : 'Missing school identifier');
            return { success: false, error: 'school_id_unavailable' };
        }

        // Prevention — warm up the auth token + verify connectivity BEFORE reading
        // the outbox rows (firestore-sync-assertion-crash-fix, Req 2.4/1.4).
        //
        // `getCredentials()` above already proactively refreshed the auth token when
        // it was near expiry. Here we additionally confirm a lightweight connectivity
        // success (a single school-doc read) so the SDK does NOT have to refresh the
        // token mid-transaction — the window in which `auth/network-request-failed`
        // leaks into Firestore's transaction error classifier and trips the INTERNAL
        // ASSERTION crash. If the probe fails with a network error, defer this cycle
        // and leave the rows `pending` for the next attempt (no rows are read or
        // mutated below). Non-network probe failures fall through to the existing
        // flow unchanged.
        let connectivity;
        try {
            connectivity = await testConnection();
        } catch (err) {
            connectivity = { success: false, error: err && err.message, step: 'warmup' };
        }
        if (connectivity && !connectivity.success && isConnectivityWarmupNetworkError(connectivity)) {
            console.warn('[sync:push] Deferred: connectivity warm-up failed (network); rows left pending');
            const priorErr = String(config.last_push_error || '').trim();
            recordPushMeta(
                db,
                null,
                priorErr ? undefined : 'connectivity warm-up failed (network) — cycle deferred, rows left pending'
            );
            return { success: false, skipped: true, reason: 'connectivity_warmup_failed' };
        }

        // Resolve push tuning (Req 2.x, 7.8, 9.2-9.4) and the effective per-cycle drain
        // limit (Req 6.1, 6.4). A backlog (pending > push_batch_size) reads up to the
        // backlog drain limit; steady-state reads push_batch_size. An explicit `limit`
        // argument still overrides for callers that pass one.
        const tuning = resolvePushTuning(config);
        const pendingBefore = db.prepare("SELECT COUNT(*) AS c FROM sync_outbox WHERE status = 'pending'").get().c || 0;
        const drainLimit = Number(limit) || resolveDrainLimit(config, pendingBefore, tuning);

        // The Rate_Limiter governs the active concurrency for this whole Push_Cycle,
        // starting at the configured initial value and ramping/backing off across groups
        // (Req 3.1).
        const rateLimiter = createRateLimiter(tuning);

        const firestoreDb = getFirestoreDb();
        const pendingRows = sortOutboxRowsForPush(readPendingOutboxBatch(db, maxRetries, drainLimit));

        const ctx = {
            role,
            schoolId,
            deviceHash,
            maxRetries,
            sentCount: 0,
            failedCount: 0,
            skippedCount: 0,
            throttleErrors: 0,
            recoverableErrors: 0,
            accessDeniedErrors: 0,
            lastError: null,
            syncLogOk: true,
            batchBuffer: [],
            // Accumulate non-bulk prepared items up to the drain limit so each dispatch
            // can form groups as large as the active concurrency, instead of capping at a
            // small fixed chunk. The buffer is still flushed before each bulk entry and at
            // cycle end, preserving ordering and abort semantics.
            dispatchThreshold: drainLimit,
            flushBuffer: null
        };
        ctx.flushBuffer = async () => {
            if (!ctx.batchBuffer.length) return false;

            // Layer 2 pre-stage (Req 7.8): ONLY when explicitly enabled. When the flag is
            // disabled/absent this block is skipped entirely — no bulk-read (getDocs), no
            // writeBatch, and no version-comparison/batch-routing decisions — so every
            // buffered item flows through the Layer 1 dispatcher exactly as before.
            let dispatchItems = sortPreparedItemsForPush(ctx.batchBuffer);
            let preSentItems = [];
            if (tuning.batchedFastPathEnabled && !hasMultipleTopologyRanks(dispatchItems)) {
                const fastPath = await runBatchedFastPath(db, firestoreDb, dispatchItems, { maxRetries, schoolId });
                // sentItems are already markEntrySent'd — they are counted as sent and
                // folded into the combined syncLog batch by flushPreparedItemsConcurrent
                // (do NOT mark them again). guardRoutedItems flow into Layer 1 as today.
                preSentItems = fastPath.sentItems;
                dispatchItems = fastPath.guardRoutedItems;
            }

            const result = await flushPreparedItemsConcurrent(
                db,
                firestoreDb,
                dispatchItems,
                maxRetries,
                schoolId,
                rateLimiter,
                preSentItems
            );
            ctx.sentCount += result.sentCount;
            ctx.failedCount += result.failedCount;
            if (!result.syncLogWritten) ctx.syncLogOk = false;
            ctx.lastError = result.lastError || ctx.lastError;
            ctx.throttleErrors += result.throttleErrors || 0;
            ctx.recoverableErrors += result.recoverableErrors || 0;
            ctx.accessDeniedErrors += result.accessDeniedErrors || 0;
            ctx.batchBuffer = [];
            return result.abort;
        };

        for (const row of pendingRows) {
            const action = await processOutboxRow(db, firestoreDb, row, ctx);
            if (action === 'break') break;
        }

        const aborted = await ctx.flushBuffer();

        if (ctx.accessDeniedErrors > 0) {
            const recovered = await recoverCloudSessionAfterPermissionDenied('push');
            if (recovered) {
                ctx.lastError = null;
                scheduleBacklogPush();
            } else {
                ctx.lastError = ctx.lastError || 'Access denied';
            }
        } else if (aborted) {
            ctx.lastError = ctx.lastError || 'Access denied';
        }

        if (!ctx.syncLogOk) {
            ctx.lastError = ctx.lastError || 'syncLog write failed — other devices may not receive changes';
        }

        // Sign-out race safety net. auth:logout tears down the Firebase session (signOut +
        // clearCredentials) but can only stop the background TIMERS — it cannot abort a
        // cycle that is already writing. On a data-heavy device a push cycle runs for
        // minutes, so signing out mid-cycle invalidates the auth token and the remaining
        // entity writes AND the syncLog batch fail with PERMISSION_DENIED. Those failures
        // are NOT a real permissions problem: the affected rows stayed `pending` and
        // re-push after the next sign-in. Drop such errors (and the syncLog-failure flag)
        // so the UI does not show a false "sync rejected — re-login" banner. Two signals:
        //   - no live Firebase user right now (signed out and stayed out), OR
        //   - the sync-auth epoch changed since the cycle began (a sign-out and/or a quick
        //     sign-in happened mid-cycle — covers re-login before the cycle finished).
        // Intentionally ungated from accessDeniedErrors: the raw error may surface through
        // ctx.lastError or ctx.syncLogOk without the per-item access-denied counter set.
        const authTransitionDuringCycle = _syncAuthEpoch !== authEpochAtStart;
        if ((ctx.lastError || !ctx.syncLogOk) && (!hasLiveFirebaseUser() || authTransitionDuringCycle)) {
            ctx.lastError = null;
            ctx.syncLogOk = true;
        }

        // Recoverable bug-domain error path (firestore-sync-assertion-crash-fix):
        // when at least one item this cycle hit the transient assertion/auth-network
        // error, recover the (potentially contaminated) Firestore client ONCE per cycle
        // by terminating and re-initializing it. The affected rows already stayed
        // `pending` (see applyItemOutcome), so they retry on the next cycle without data
        // loss. recoverFirestoreClient holds its own guard against concurrent recovery
        // (Req 2.1, 2.2, 3.2, 3.3).
        if (ctx.recoverableErrors > 0) {
            try {
                await recoverFirestoreClient();
                console.log(
                    `[sync:push] Recovered Firestore client after ${ctx.recoverableErrors} transient assertion/auth-network error(s); affected rows left pending`
                );
            } catch (err) {
                console.warn('[sync:push] Firestore client recovery failed:', err && err.message);
            }
        }

        // Persist last_push_at / last_push_error, with a fallback log if recording
        // the error state itself fails (Req 8.6, 8.7, 8.8).
        recordPushMeta(db, ctx.sentCount > 0 ? new Date().toISOString() : null, ctx.lastError);

        const pendingCount = db.prepare("SELECT COUNT(*) AS c FROM sync_outbox WHERE status = 'pending'").get().c || 0;

        // Build the per-cycle Push_Metrics object (Req 8.1-8.5). concurrencyChanges
        // is the ordered [{ to, reason }] log surfaced from the Rate_Limiter (Req 8.4);
        // its length is the count of times the active limit actually moved this cycle.
        const durationMs = Date.now() - cycleStartMs;
        const concurrencyChanges = rateLimiter && rateLimiter.changes ? rateLimiter.changes : [];
        const metrics = {
            sent: ctx.sentCount,
            failed: ctx.failedCount,
            skipped: ctx.skippedCount,
            pending: pendingCount,
            durationMs,
            throughput: computePushThroughput(ctx.sentCount, durationMs),
            throttleErrors: ctx.throttleErrors,
            concurrencyChanges
        };

        // Structured per-cycle metrics log (Req 8.1-8.5).
        console.log(
            '[sync:push] metrics',
            JSON.stringify({
                ...metrics,
                concurrencyChanges: concurrencyChanges.length,
                concurrencyChangeLog: concurrencyChanges
            })
        );

        if (ctx.sentCount > 0) {
            console.log(
                `[sync:push] Pushed ${ctx.sentCount} entries, ${ctx.failedCount} failed, ${ctx.skippedCount} skipped, ${pendingCount} pending${ctx.syncLogOk ? '' : ' (syncLog FAILED)'}`
            );
        }
        // Schedule a follow-up cycle while a backlog drains cleanly (Req 6.3, Property 21).
        if (shouldScheduleFollowupPush(pendingCount, ctx.sentCount, ctx.failedCount)) {
            scheduleBacklogPush();
        }

        return {
            success: ctx.failedCount === 0 && ctx.syncLogOk,
            sentCount: ctx.sentCount,
            failedCount: ctx.failedCount,
            skippedCount: ctx.skippedCount,
            pendingCount,
            compactedCount,
            lastError: ctx.lastError,
            metrics
        };
    } finally {
        _flushRunning = false;
    }
}

// Capture unhandled rejections that surface the recoverable bug-domain error
// (auth/network-request-failed / INTERNAL ASSERTION FAILED) from a DETACHED
// microtask — escaping the try/catch around `await runTransaction(...)`. When the
// rejection matches isAssertionOrAuthNetworkError, route it to the recovery path
// (terminate + re-init via recoverFirestoreClient) instead of letting it crash
// the process; the affected rows already stayed `pending` (see applyItemOutcome)
// so they retry on the next cycle without data loss. Rejections that do NOT match
// are left to the default behavior (logged elsewhere) unchanged.
//
// Registered exactly once via a module-level guard so repeated sync (re)starts
// never stack duplicate handlers (Req 2.3). recoverFirestoreClient holds its own
// reentrancy guard, so calling it here is safe even mid-cycle.
function installUnhandledRejectionHandler() {
    if (_unhandledRejectionHandlerInstalled) return;
    _unhandledRejectionHandlerInstalled = true;

    process.on('unhandledRejection', (reason) => {
        if (!isAssertionOrAuthNetworkError(reason)) {
            // Not a bug-domain error: preserve the default behavior unchanged.
            return;
        }

        console.warn(
            '[sync:push] Captured unhandled rejection (assertion/auth-network) from a detached ' +
                'transaction microtask; routing to Firestore client recovery and leaving rows pending'
        );

        Promise.resolve()
            .then(() => recoverFirestoreClient())
            .catch((err) => {
                console.warn(
                    '[sync:push] Firestore client recovery from unhandled rejection failed:',
                    err && err.message
                );
            });
    });
}

function startSyncPushBackground() {
    if (_syncTimer) return;

    try {
        const db = getDb();
        const config = readSyncConfig(db);

        if (!Number(config.enabled) || !config.firebase_functions_url || !resolveSyncSchoolId(config)) {
            return;
        }

        installUnhandledRejectionHandler();

        void flushSyncOutbox();

        const intervalMinutes = Math.max(1, Math.min(30, Number(config.sync_interval_minutes) || 5));
        const intervalMs = intervalMinutes * 60 * 1000;

        _syncTimer = setInterval(() => {
            void flushSyncOutbox();
        }, intervalMs);

        if (typeof _syncTimer.unref === 'function') {
            _syncTimer.unref();
        }

        console.log(`[sync:push] Background push started (interval: ${intervalMinutes}min)`);
    } catch (err) {
        console.warn('[sync:push] Failed to start push background:', err.message);
    }
}

function stopSyncPushBackground() {
    if (_syncTimer) {
        clearInterval(_syncTimer);
        _syncTimer = null;
        console.log('[sync:push] Background push stopped');
    }
    if (_backlogPushTimer) {
        clearTimeout(_backlogPushTimer);
        _backlogPushTimer = null;
    }
}

function restartSyncPushBackground() {
    stopSyncPushBackground();
    startSyncPushBackground();
}

function scheduleDebouncedPull() {
    if (_pullDebounceTimer) {
        clearTimeout(_pullDebounceTimer);
    }

    _pullDebounceTimer = setTimeout(() => {
        _pullDebounceTimer = null;
        void pullRemoteChanges().catch((err) => {
            console.warn('[sync:pull] Debounced pull failed:', err.message);
        });
    }, REMOTE_PULL_DEBOUNCE_MS);

    if (typeof _pullDebounceTimer.unref === 'function') {
        _pullDebounceTimer.unref();
    }
}

function stopRemoteChangeListener() {
    if (_pullListenerUnsubscribe) {
        try {
            _pullListenerUnsubscribe();
        } catch (err) {
            console.warn('[sync:pull] Failed to stop remote change listener:', err.message);
        }
        _pullListenerUnsubscribe = null;
    }

    if (_pullDebounceTimer) {
        clearTimeout(_pullDebounceTimer);
        _pullDebounceTimer = null;
    }
}

function startRemoteChangeListener(schoolId) {
    stopRemoteChangeListener();

    if (!schoolId) {
        return;
    }

    try {
        const firestoreDb = getFirestoreDb();
        if (!firestoreDb) {
            return;
        }

        const changesRef = collection(firestoreDb, 'syncLog', schoolId, 'changes');
        const q = query(changesRef, orderBy('updatedAt', 'desc'), firestoreLimit(1));
        let initialized = false;

        _pullListenerUnsubscribe = onSnapshot(
            q,
            (snapshot) => {
                if (!initialized) {
                    initialized = true;
                    return;
                }
                if (!snapshot.empty) {
                    scheduleDebouncedPull();
                }
            },
            (err) => {
                console.warn('[sync:pull] Remote change listener failed:', err.message);
            }
        );
    } catch (err) {
        console.warn('[sync:pull] Failed to start remote change listener:', err.message);
    }
}

function buildPullResult(overrides = {}) {
    return {
        success: true,
        appliedCount: 0,
        skippedCount: 0,
        conflictCount: 0,
        failedCount: 0,
        totalFetched: 0,
        newCursor: null,
        lastError: null,
        ...overrides
    };
}

function mapRemoteItems(remoteItems) {
    const mapped = [];
    const unknownEntityTypes = [];
    for (const item of remoteItems) {
        const tableName = Object.keys(ENTITY_TYPE_REGISTRY).find(
            (k) => ENTITY_TYPE_REGISTRY[k].entityType === item.entityType
        );
        if (!tableName) {
            unknownEntityTypes.push(item.entityType || '(missing)');
            continue;
        }
        mapped.push({
            tableName,
            operation: item.operation,
            rowSyncId: item.rowSyncId,
            data: item.data || {},
            version: item.version,
            updatedAt: item.updatedAt || 0,
            deviceHash: item.deviceHash,
            entityType: item.entityType,
            schoolYear: item.schoolYear,
            changeId: item.id
        });
    }
    if (unknownEntityTypes.length > 0) {
        console.warn('[sync:pull] Skipped unknown entity types:', [...new Set(unknownEntityTypes)].join(', '));
    }
    return { mapped, unknownEntityTypes };
}

function getStudentDependency(item) {
    if (item.operation !== 'PUT') return null;
    if (item.tableName !== 'absences' && item.tableName !== 'grades' && item.tableName !== 'student_files') return null;

    const studentCode = String(item.data?.student_code || '').trim();
    const schoolYear = String(item.data?.school_year || item.schoolYear || '').trim();
    if (!studentCode) return null;

    return { studentCode, schoolYear };
}

function hasMissingStudentDependencies(db, items) {
    return items.some((item) => {
        const dependency = getStudentDependency(item);
        if (!dependency) return false;
        return resolveStudentId(db, dependency.studentCode, dependency.schoolYear) == null;
    });
}

async function bootstrapStudentsForMissingDependencies(firestoreDb, schoolId, mappedItems, db) {
    if (!hasMissingStudentDependencies(db, mappedItems)) {
        return [];
    }

    try {
        const studentItems = await bootstrapFromCollections(
            firestoreDb,
            schoolId,
            { students: COLLECTION_MAP.students },
            ENTITY_TYPE_REGISTRY
        );
        const { mapped } = mapRemoteItems(studentItems);
        return mapped;
    } catch (err) {
        console.warn('[sync:pull] Student dependency bootstrap failed:', err.message);
        return [];
    }
}

async function getRemoteCollectionCount(firestoreDb, schoolId, tableName) {
    const collectionPath = getCollectionPath(schoolId, tableName);
    if (!collectionPath) return null;

    try {
        const snapshot = await getCountFromServer(collection(firestoreDb, collectionPath));
        const count = Number(snapshot.data().count);
        return Number.isFinite(count) ? count : null;
    } catch (err) {
        console.warn(`[sync:pull] Failed to count remote ${tableName}:`, err.message);
        return null;
    }
}

function getLocalTableCount(db, tableName) {
    try {
        const row = db.prepare(`SELECT COUNT(*) AS c FROM "${tableName}"`).get();
        return Number(row?.c || 0);
    } catch {
        return null;
    }
}

async function bootstrapTablesIfLocalBehind(firestoreDb, schoolId, db) {
    const catchupMap = {};
    const catchupSummary = [];

    for (const tableName of TOPO_ORDER_PUT) {
        if (!COLLECTION_MAP[tableName] || !ENTITY_TYPE_REGISTRY[tableName]) continue;

        const localCount = getLocalTableCount(db, tableName);
        if (localCount == null) continue;

        const remoteCount = await getRemoteCollectionCount(firestoreDb, schoolId, tableName);
        if (remoteCount == null || localCount >= remoteCount) continue;

        catchupMap[tableName] = COLLECTION_MAP[tableName];
        catchupSummary.push(`${tableName}: local=${localCount}, remote=${remoteCount}`);
    }

    if (catchupSummary.length === 0) {
        return [];
    }

    console.log(`[sync:pull] Collection catch-up needed: ${catchupSummary.join('; ')}`);
    try {
        return await bootstrapFromCollections(firestoreDb, schoolId, catchupMap, ENTITY_TYPE_REGISTRY);
    } catch (err) {
        console.warn('[sync:pull] Collection catch-up bootstrap failed:', err.message);
        return [];
    }
}

function handlePullConflict(db, item, pending) {
    const ancestorRow = db.prepare('SELECT ancestor_data FROM sync_id_map WHERE row_sync_id = ?').get(item.rowSyncId);
    let ancestor = null;
    try {
        ancestor = ancestorRow?.ancestor_data ? JSON.parse(ancestorRow.ancestor_data) : null;
    } catch (parseErr) {
        console.warn(`[sync:pull] Failed to parse ancestor_data for ${item.rowSyncId}:`, parseErr.message);
    }

    let localData = {};
    try {
        localData = pending.rowData ? JSON.parse(pending.rowData) : {};
    } catch (parseErr) {
        console.warn(`[sync:pull] Failed to parse local outbox data for ${item.rowSyncId}:`, parseErr.message);
    }

    const localTs = Math.floor(Date.now() / 1000);
    const remoteTs = item.updatedAt || 0;
    const originalRemoteData = JSON.stringify(item.data);
    const mergeResult = threeWayMerge(ancestor, localData, item.data, localTs, remoteTs);

    item.data = mergeResult.merged;

    if (mergeResult.resolution === 'clean') {
        db.prepare("UPDATE sync_outbox SET status = 'sent' WHERE id = ?").run(pending.outboxId);
        return false;
    }

    const resolutionMethod = mergeResult.resolution === 'lww' ? 'lww' : 'merged';

    // Forensics: record pull-side merge outcome (reveals missing-ancestor false conflicts & LWW bias)
    logConflictForensics({
        phase: 'pull',
        table: item.tableName,
        rowSyncId: item.rowSyncId,
        entityType: item.entityType,
        localVersion: null,
        remoteVersion: item.version,
        ancestorPresent: !!ancestorRow?.ancestor_data,
        conflictingFields: mergeResult.conflicts,
        localTs,
        remoteTs,
        remoteDeviceHash: item.deviceHash || null,
        resolution: mergeResult.conflicts.length > 0 ? 'lww-auto' : 'merged-auto',
        note: ancestorRow?.ancestor_data ? null : 'no-ancestor'
    });

    db.prepare(
        `INSERT INTO sync_conflicts(table_name, row_sync_id, entity_type, local_data, remote_data,
            remote_version, remote_device_hash, local_outbox_id, ancestor_data,
            conflicting_fields, resolution_method, resolved_data, status, resolution, resolved_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'resolved', ?, CURRENT_TIMESTAMP)`
    ).run(
        item.tableName,
        item.rowSyncId,
        item.entityType,
        pending.rowData,
        originalRemoteData,
        item.version,
        item.deviceHash,
        pending.outboxId,
        ancestorRow?.ancestor_data || null,
        JSON.stringify(mergeResult.conflicts),
        resolutionMethod,
        JSON.stringify(mergeResult.merged),
        mergeResult.conflicts.length > 0 ? 'remote' : 'merged'
    );
    db.prepare("UPDATE sync_outbox SET status = 'sent' WHERE id = ?").run(pending.outboxId);
    return true;
}

function applyPutOperation(db, item, mapping, stats) {
    const columnKeys = Object.keys(item.data).filter((k) => k !== 'id');

    // Detect the primary key column for this table (defaults to 'id')
    var pkColumn = 'id';
    try {
        const tableInfo = db.prepare(`PRAGMA table_info("${item.tableName}")`).all();
        const pkCol = tableInfo.find((col) => col.pk === 1);
        if (pkCol) pkColumn = pkCol.name;
    } catch {
        /* fallback to 'id' */
    }

    if (mapping) {
        const columns = filterToValidColumns(
            db,
            item.tableName,
            columnKeys.filter((k) => k !== pkColumn)
        );
        if (columns.length > 0) {
            const setClause = columns.map((c) => `"${c}" = ?`).join(', ');
            const values = columns.map((c) => item.data[c]);
            values.push(mapping.local_id);
            try {
                db.prepare(`UPDATE "${item.tableName}" SET ${setClause} WHERE "${pkColumn}" = ?`).run(...values);
            } catch (updateErr) {
                recordPullApplyFailure(
                    stats,
                    item,
                    `UPDATE failed for ${item.tableName} ${pkColumn}=${mapping.local_id}: ${updateErr.message}`,
                    { sqliteCode: updateErr.code || null, pkColumn, localId: mapping.local_id, columns }
                );
                return false;
            }
        }
    } else {
        const columns = filterToValidColumns(db, item.tableName, columnKeys);
        if (columns.length > 0) {
            const colNames = columns.map((c) => `"${c}"`).join(', ');
            const placeholders = columns.map(() => '?').join(', ');
            const values = columns.map((c) => item.data[c]);
            let info;
            try {
                info = db
                    .prepare(`INSERT OR REPLACE INTO "${item.tableName}" (${colNames}) VALUES (${placeholders})`)
                    .run(...values);
            } catch (insertErr) {
                recordPullApplyFailure(stats, item, `INSERT failed for ${item.tableName}: ${insertErr.message}`, {
                    sqliteCode: insertErr.code || null,
                    columns
                });
                return false;
            }
            db.prepare('INSERT OR IGNORE INTO sync_id_map(row_sync_id, table_name, local_id) VALUES(?, ?, ?)').run(
                item.rowSyncId,
                item.tableName,
                info.lastInsertRowid
            );
        }
    }

    try {
        db.prepare('UPDATE sync_id_map SET ancestor_data = ?, version = ? WHERE row_sync_id = ?').run(
            JSON.stringify(item.data),
            item.version,
            item.rowSyncId
        );
        const checksum = computeRowChecksum(item.data, SENSITIVE_FIELDS);
        db.prepare(
            `INSERT INTO sync_snapshots(row_sync_id, table_name, checksum, updated_at)
             VALUES(?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(row_sync_id) DO UPDATE SET checksum = ?, updated_at = CURRENT_TIMESTAMP`
        ).run(item.rowSyncId, item.tableName, checksum, checksum);
    } catch (snapshotErr) {
        console.warn(`[sync:pull] Ancestor/snapshot update failed for ${item.rowSyncId}:`, snapshotErr.message);
    }
    return true;
}

function applySingleItem(
    db,
    item,
    pendingMap,
    deferredStudentFiles,
    deferredAbsences,
    deferredGrades,
    stats,
    isDeferred
) {
    try {
        const pending = pendingMap.get(item.rowSyncId);
        if (pending) {
            if (handlePullConflict(db, item, pending)) {
                stats.conflictCount++;
            }
        }

        if ((item.tableName === 'absences' || item.tableName === 'grades') && item.operation === 'PUT') {
            const studentCode = String(item.data?.student_code || '').trim();
            const schoolYear = String(item.data?.school_year || item.schoolYear || '').trim();
            const studentId = resolveStudentId(db, studentCode, schoolYear);

            if (studentId == null) {
                if (!isDeferred) {
                    if (item.tableName === 'grades') {
                        deferredGrades.push(item);
                    } else {
                        deferredAbsences.push(item);
                    }
                    return;
                }
                recordPullApplyFailure(
                    stats,
                    item,
                    `Failed to resolve student_id for ${item.tableName} (student_code='${studentCode}', school_year='${schoolYear || '-'}')`,
                    { studentCode, schoolYear: schoolYear || null }
                );
                return;
            }

            item.data = { ...item.data, student_id: studentId, student_code: studentCode, school_year: schoolYear };
        }

        if (item.tableName === 'student_files' && item.operation === 'PUT') {
            const studentCode = String(item.data?.student_code || '').trim();
            const docKey = String(item.data?.doc_key || item.data?.file_id || '').trim();
            const schoolYear = String(item.data?.school_year || item.schoolYear || '').trim();
            const studentId = resolveStudentId(db, studentCode, schoolYear);

            if (studentId == null) {
                if (!isDeferred) {
                    deferredStudentFiles.push(item);
                    return;
                }
                recordPullApplyFailure(
                    stats,
                    item,
                    `Failed to resolve student_id for student_files (student_code='${studentCode}', school_year='${schoolYear || '-'}')`,
                    { studentCode, schoolYear: schoolYear || null, docKey }
                );
                return;
            }

            item.data = { ...item.data, student_id: studentId, doc_key: docKey, school_year: schoolYear };
            delete item.data.student_code;
            delete item.data.file_id;
        }

        // Degrade non-local soft foreign keys (teacher_id/exam_id/student_id) to NULL so the
        // FKs added in migration 065 never reject a pulled row (see PULL_SOFT_FOREIGN_KEYS).
        sanitizeSoftForeignKeys(db, item);

        const mapping = db.prepare('SELECT local_id FROM sync_id_map WHERE row_sync_id = ?').get(item.rowSyncId);

        if (item.operation === 'PUT') {
            if (applyPutOperation(db, item, mapping, stats)) {
                stats.appliedCount++;
            }
        } else if (item.operation === 'DEL') {
            if (mapping) {
                try {
                    // Detect primary key column for this table
                    var delPkColumn = 'id';
                    try {
                        const tInfo = db.prepare(`PRAGMA table_info("${item.tableName}")`).all();
                        const pkC = tInfo.find((col) => col.pk === 1);
                        if (pkC) delPkColumn = pkC.name;
                    } catch {
                        /* fallback to 'id' */
                    }
                    db.prepare(`DELETE FROM "${item.tableName}" WHERE "${delPkColumn}" = ?`).run(mapping.local_id);
                } catch (delErr) {
                    recordPullApplyFailure(
                        stats,
                        item,
                        `DELETE failed for ${item.tableName} key=${mapping.local_id}: ${delErr.message}`,
                        { sqliteCode: delErr.code || null, localId: mapping.local_id }
                    );
                    return;
                }
            }
            stats.appliedCount++;
        }
    } catch (applyErr) {
        recordPullApplyFailure(stats, item, applyErr.message, {
            sqliteCode: applyErr.code || null,
            stack: applyErr.stack || null
        });
    }
}

async function pullRemoteChanges() {
    if (_pullRunning) return { success: false, skipped: true };
    _pullRunning = true;
    const authEpochAtStart = _syncAuthEpoch;
    const startedAt = Date.now();
    console.log('[sync:pull] Pull cycle starting...');
    try {
        const db = getDb();
        const config = readSyncConfig(db);
        const configuredSchoolId = resolveSyncSchoolId(config);
        if (!config || !config.enabled || !configuredSchoolId) {
            console.log('[sync:pull] Skipped: sync disabled or school identifier missing');
            return buildPullResult();
        }
        pullDebug('config loaded', {
            enabled: !!config.enabled,
            schoolId: configuredSchoolId,
            pullCursor: config.pull_cursor || null,
            lastPullAt: config.last_pull_at || null,
            lastPullError: config.last_pull_error || null
        });

        pullDebug('getting credentials...');
        const credentials = await getCredentials();
        if (!credentials) {
            console.warn('[sync:pull] Skipped: no Firebase credentials available');
            return buildPullResult({ success: false, lastError: 'No credentials available' });
        }
        pullDebug('credentials ready', {
            schoolId: credentials.schoolId,
            userEmail: credentials.user?.email || null,
            expiresAt: credentials.expiresAt
        });

        const schoolId = resolveSyncSchoolId(config, credentials);
        if (!schoolId) {
            console.warn('[sync:pull] Skipped: no school identifier configured');
            return buildPullResult({ success: false, lastError: 'No school identifier configured' });
        }

        const firestoreDb = getFirestoreDb();
        const cursor = parsePullCursor(config.pull_cursor);
        const currentDeviceHash = getDeviceHash();
        const localDeviceHash = currentDeviceHash.substring(0, 16);
        pullDebug('remote fetch starting', {
            schoolId,
            cursor: serializePullCursor(cursor),
            localDeviceHash
        });

        const localDataExists = db.prepare('SELECT COUNT(*) as c FROM students').get().c > 0;
        const needsBootstrap = !localDataExists;

        let allItems = await pullChanges(firestoreDb, schoolId, cursor);
        let syncLogItems = allItems;

        if (allItems.length === 0 && needsBootstrap) {
            console.log('[sync:pull] Bootstrapping from entity collections (syncLog empty, local DB empty)...');
            try {
                allItems = await bootstrapFromCollections(firestoreDb, schoolId, COLLECTION_MAP, ENTITY_TYPE_REGISTRY);
                syncLogItems = [];
                console.log(
                    `[sync:pull] Bootstrap fetched ${allItems.length} documents from entity collections (${Date.now() - startedAt}ms)`
                );
            } catch (bootstrapErr) {
                console.error('[sync:pull] Bootstrap from collections failed:', bootstrapErr.message);
            }
        } else if (!needsBootstrap) {
            const catchupItems = await bootstrapTablesIfLocalBehind(firestoreDb, schoolId, db);
            if (catchupItems.length > 0) {
                allItems = [...catchupItems, ...allItems];
                pullDebug('collection count catch-up completed', {
                    catchupItems: catchupItems.length,
                    totalItems: allItems.length
                });
            }
        }

        if (allItems.length === 0) {
            db.prepare(
                'UPDATE sync_config SET last_pull_at = CURRENT_TIMESTAMP, last_pull_error = NULL WHERE id = 1'
            ).run();
            console.log(
                `[sync:pull] Completed: 0 fetched, 0 applied, 0 conflicts, 0 failed (${Date.now() - startedAt}ms)`
            );
            return buildPullResult({ newCursor: serializePullCursor(cursor) });
        }

        let remoteItems;
        if (needsBootstrap) {
            remoteItems = allItems;
        } else {
            remoteItems = allItems.filter((item) => item.deviceHash !== localDeviceHash);
        }
        const skippedCount = allItems.length - remoteItems.length;
        pullDebug('self-origin filter completed', {
            fetched: allItems.length,
            remoteItems: remoteItems.length,
            skippedSelfOriginated: skippedCount
        });

        let { mapped, unknownEntityTypes } = mapRemoteItems(remoteItems);
        pullDebug('mapping completed', {
            mapped: mapped.length,
            unknownEntityTypeCount: unknownEntityTypes.length,
            sample: mapped.slice(0, 5).map(summarizePullItem)
        });

        const dependencyStudents = await bootstrapStudentsForMissingDependencies(firestoreDb, schoolId, mapped, db);
        if (dependencyStudents.length > 0) {
            mapped = [...dependencyStudents, ...mapped];
            pullDebug('student dependency bootstrap completed', {
                students: dependencyStudents.length,
                mapped: mapped.length
            });
        }

        const sorted = sortByTopology(mapped);
        pullDebug('topological sort completed', {
            sorted: sorted.length,
            sample: sorted.slice(0, 5).map(summarizePullItem)
        });

        const pendingRows = db
            .prepare("SELECT row_sync_id, id, row_data FROM sync_outbox WHERE status = 'pending'")
            .all();
        const pendingMap = new Map();
        for (const row of pendingRows) {
            pendingMap.set(row.row_sync_id, { outboxId: row.id, rowData: row.row_data });
        }
        pullDebug('pending outbox loaded', { pendingRows: pendingRows.length });

        const stats = { appliedCount: 0, conflictCount: 0, failedCount: 0, failures: [] };
        pullDebug('local apply transaction starting', { itemCount: sorted.length });

        const applyChanges = db.transaction(() => {
            const deferredStudentFiles = [];
            const deferredAbsences = [];
            const deferredGrades = [];
            for (const item of sorted) {
                applySingleItem(
                    db,
                    item,
                    pendingMap,
                    deferredStudentFiles,
                    deferredAbsences,
                    deferredGrades,
                    stats,
                    false
                );
            }
            for (const item of deferredGrades) {
                applySingleItem(
                    db,
                    item,
                    pendingMap,
                    deferredStudentFiles,
                    deferredAbsences,
                    deferredGrades,
                    stats,
                    true
                );
            }
            for (const item of deferredAbsences) {
                applySingleItem(
                    db,
                    item,
                    pendingMap,
                    deferredStudentFiles,
                    deferredAbsences,
                    deferredGrades,
                    stats,
                    true
                );
            }
            for (const item of deferredStudentFiles) {
                applySingleItem(
                    db,
                    item,
                    pendingMap,
                    deferredStudentFiles,
                    deferredAbsences,
                    deferredGrades,
                    stats,
                    true
                );
            }
        });

        applyChanges();
        pullDebug('local apply transaction completed', {
            appliedCount: stats.appliedCount,
            conflictCount: stats.conflictCount,
            failedCount: stats.failedCount,
            elapsedMs: Date.now() - startedAt
        });

        const lastSyncLogItem = syncLogItems[syncLogItems.length - 1] || {};
        const advancedCursor =
            syncLogItems.length > 0
                ? serializePullCursor({
                      updatedAt: Number(lastSyncLogItem.updatedAt) || cursor.updatedAt || 0,
                      changeId: String(lastSyncLogItem.id || '').trim()
                  })
                : serializePullCursor(cursor);

        // Do NOT advance the pull cursor when any item failed to apply locally.
        // applySingleItem() swallows per-item errors into stats.failedCount, so the
        // apply transaction still commits; advancing the cursor here would skip the
        // failed remote changes permanently (data loss). Instead, hold the previous
        // cursor and surface the error so the whole batch is re-fetched and retried
        // next cycle. Re-applying already-succeeded items is safe — they go through
        // version-guarded upserts (idempotent).
        let newCursor;
        if (stats.failedCount > 0) {
            newCursor = serializePullCursor(cursor);
            const pullError = classifyPushError(buildPullFailureSummary(stats.failedCount, stats.failures));
            db.prepare('UPDATE sync_config SET last_pull_at = CURRENT_TIMESTAMP, last_pull_error = ? WHERE id = 1').run(
                pullError
            );
            pullDebug('pull cursor held due to apply failures', {
                heldCursor: newCursor,
                wouldHaveAdvancedTo: advancedCursor,
                failedCount: stats.failedCount,
                failures: stats.failures.slice(0, 5)
            });
        } else {
            newCursor = advancedCursor;
            db.prepare(
                'UPDATE sync_config SET pull_cursor = ?, last_pull_at = CURRENT_TIMESTAMP, last_pull_error = NULL WHERE id = 1'
            ).run(newCursor);
            pullDebug('sync_config updated', { newCursor });
        }

        const affectedTables = [...new Set(sorted.map((i) => i.tableName))];
        const upsertPullState = db.prepare(`
            INSERT INTO sync_pull_state(table_name, last_pulled_at, updated_at)
            VALUES(?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(table_name) DO UPDATE SET last_pulled_at = CURRENT_TIMESTAMP, last_pull_error = NULL, updated_at = CURRENT_TIMESTAMP
        `);
        for (const table of affectedTables) {
            upsertPullState.run(table);
        }
        pullDebug('sync_pull_state updated', { affectedTables });

        updateDeviceHeartbeat(db);

        console.log(
            `[sync:pull] Completed: ${allItems.length} fetched, ${stats.appliedCount} applied, ${stats.conflictCount} conflicts, ${stats.failedCount} failed (${Date.now() - startedAt}ms)`
        );

        return buildPullResult({
            success: stats.failedCount === 0,
            appliedCount: stats.appliedCount,
            skippedCount: skippedCount + (mapped.length - sorted.length),
            conflictCount: stats.conflictCount,
            failedCount: stats.failedCount,
            totalFetched: allItems.length,
            newCursor,
            lastError: stats.failedCount > 0 ? buildPullFailureSummary(stats.failedCount, stats.failures) : null,
            failures: stats.failures
        });
    } catch (err) {
        console.error('[sync:pull] Pull cycle failed:', err.message);

        const permissionDenied =
            err.code === 'permission-denied' ||
            String(err.message || '')
                .toLowerCase()
                .includes('permission-denied');

        // Same sign-out race as the push path: if the Firebase session was torn down
        // (auth:logout) while this pull was in flight — or a sign-in/out transition
        // happened before it finished — the read comes back as permission-denied. That is
        // a transient interruption, not a real error — clear any stored pull error so no
        // false "sync rejected — re-login" banner appears.
        if (permissionDenied && (!hasLiveFirebaseUser() || _syncAuthEpoch !== authEpochAtStart)) {
            try {
                const db = getDb();
                db.prepare('UPDATE sync_config SET last_pull_error = NULL WHERE id = 1').run();
            } catch (dbErr) {
                console.warn('[sync:pull] Failed to clear transient pull error in DB:', dbErr.message);
            }
            return buildPullResult({ success: false, skipped: true, reason: 'interrupted_by_signout', lastError: null });
        }

        if (permissionDenied) {
            const recovered = await recoverCloudSessionAfterPermissionDenied('pull');
            if (recovered) {
                try {
                    const db = getDb();
                    db.prepare(
                        'UPDATE sync_config SET last_pull_error = NULL, last_pull_at = CURRENT_TIMESTAMP WHERE id = 1'
                    ).run();
                } catch (dbErr) {
                    console.warn('[sync:pull] Failed to clear recovered pull error in DB:', dbErr.message);
                }

                scheduleDebouncedPull();
                return buildPullResult({
                    success: false,
                    skipped: true,
                    reason: 'auth_recovered_retry_scheduled',
                    lastError: null
                });
            }
        }

        try {
            const db = getDb();
            db.prepare('UPDATE sync_config SET last_pull_error = ?, last_pull_at = CURRENT_TIMESTAMP WHERE id = 1').run(
                classifyPushError(err.message)
            );
        } catch (dbErr) {
            console.warn('[sync:pull] Failed to record pull error in DB:', dbErr.message);
        }

        if (permissionDenied) {
            clearCredentials();
        }

        return buildPullResult({ success: false, lastError: err.message });
    } finally {
        _pullRunning = false;
    }
}

function isPushTimerRunning() {
    return _syncTimer !== null;
}

function isPullTimerRunning() {
    return _pullTimer !== null;
}

function isPullCycleRunning() {
    return _pullRunning;
}

// True only during an active Push_Cycle (between `flushSyncOutbox` setting
// `_flushRunning = true` and its `finally` clearing it). Distinct from
// `isPushTimerRunning()`, which reports whether the timer is *installed* and so
// stays true between ticks. Used by `sync:getStatus` so the UI can drive its
// spinning 'syncing' state from an actual in-flight cycle, not from the timer —
// otherwise a stalled/errored engine (timer installed but last cycle failed)
// spins forever instead of falling through to the `error` branch.
function isPushCycleRunning() {
    return _flushRunning;
}

function startSyncPullBackground() {
    if (_pullTimer) return;

    try {
        const db = getDb();
        const config = readSyncConfig(db);
        const schoolId = resolveSyncSchoolId(config);
        if (!config || !config.enabled || !config.firebase_functions_url || !schoolId) return;

        const intervalMs = Math.max(1, Math.min(30, config.sync_interval_minutes || 10)) * 60 * 1000;

        void pullRemoteChanges();
        startRemoteChangeListener(schoolId);

        _pullTimer = setInterval(async () => {
            const result = await pullRemoteChanges();
            if (result && !result.success && !result.skipped) {
                const retryDelay = setTimeout(() => void pullRemoteChanges(), 5000);
                if (typeof retryDelay.unref === 'function') retryDelay.unref();
            }
        }, intervalMs);

        if (typeof _pullTimer.unref === 'function') {
            _pullTimer.unref();
        }

        console.log(
            `[sync:pull] Background pull started (interval: ${Math.max(1, Math.min(30, config.sync_interval_minutes || 10))}min)`
        );
    } catch (err) {
        console.warn('[sync:pull] Failed to start pull background:', err.message);
    }
}

function stopSyncPullBackground() {
    if (_pullTimer) {
        clearInterval(_pullTimer);
        _pullTimer = null;
        console.log('[sync:pull] Background pull stopped');
    }
    stopRemoteChangeListener();
}

function restartSyncPullBackground() {
    stopSyncPullBackground();
    startSyncPullBackground();
}

module.exports = {
    flushSyncOutbox,
    startSyncPushBackground,
    stopSyncPushBackground,
    restartSyncPushBackground,
    pullRemoteChanges,
    startSyncPullBackground,
    stopSyncPullBackground,
    restartSyncPullBackground,
    isPushTimerRunning,
    isPullTimerRunning,
    isPullCycleRunning,
    isPushCycleRunning,
    bumpSyncAuthEpoch,
    parsePullCursor,
    serializePullCursor,
    resolvePushTuning,
    resolveDrainLimit,
    resolveSyncIntervalMinutes,
    createRateLimiter,
    isThrottleError,
    isAssertionOrAuthNetworkError,
    installUnhandledRejectionHandler,
    chunkArray,
    runConcurrentGroup,
    applyItemOutcome,
    flushPreparedItems,
    shouldScheduleFollowupPush,
    computePushThroughput,
    recordPushMeta,
    updatePushMeta,
    classifyPushError,
    flushPreparedItemsConcurrent,
    runBatchedFastPath,
    expandBulkEntry,
    processOutboxRow
};
