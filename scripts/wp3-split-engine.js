'use strict';

/**
 * WP3 mechanical split of main/sync/engine/index.js into:
 *   helpers.js, state.js, outbox.js, apply.js, push.js, pull.js
 *   transport/firestore.js
 * index.js becomes the public facade re-export + apply-hooks registration.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'main/sync/engine');
const indexPath = path.join(root, 'index.js');
const lines = fs.readFileSync(indexPath, 'utf8').split(/\r?\n/);

function sliceLines(start, endInclusive) {
    // 1-based inclusive
    return lines.slice(start - 1, endInclusive).join('\n');
}

function write(rel, content) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content.endsWith('\n') ? content : content + '\n');
    console.log('wrote', rel, 'lines~', content.split('\n').length);
}

// Discover function start lines dynamically for robustness
function findFn(name) {
    const re = new RegExp(`^(async )?function ${name}\\b`);
    for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) return i + 1;
    }
    throw new Error('function not found: ' + name);
}

function findConst(name) {
    const re = new RegExp(`^const ${name}\\b`);
    for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) return i + 1;
    }
    throw new Error('const not found: ' + name);
}

function findLet(name) {
    const re = new RegExp(`^let ${name}\\b`);
    for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) return i + 1;
    }
    throw new Error('let not found: ' + name);
}

// Find end of a top-level function: next line that starts with function/async function/const/let/module.exports
// after the opening, at brace depth 0.
function findFnEnd(startLine) {
    let depth = 0;
    let started = false;
    for (let i = startLine - 1; i < lines.length; i++) {
        const line = lines[i];
        for (const ch of line) {
            if (ch === '{') {
                depth++;
                started = true;
            } else if (ch === '}') {
                depth--;
            }
        }
        if (started && depth === 0) {
            return i + 1;
        }
    }
    throw new Error('could not find end for start ' + startLine);
}

function extractFn(name) {
    const start = findFn(name);
    const end = findFnEnd(start);
    return { name, start, end, body: sliceLines(start, end) };
}

// ---- state.js ----
write(
    'state.js',
    `'use strict';

/**
 * Shared mutable lifecycle state for push/pull cycles (WP3).
 */

let syncTimer = null;
let flushRunning = false;
let pullTimer = null;
let pullRunning = false;
let pullListenerUnsubscribe = null;
let pullDebounceTimer = null;
let syncAuthEpoch = 0;
let backlogPushTimer = null;
let unhandledRejectionHandlerInstalled = false;

const REMOTE_PULL_DEBOUNCE_MS = 4000;
const BACKLOG_PUSH_DELAY_MS = 2500;
const MAX_RECORDED_PULL_FAILURES = 20;

function bumpSyncAuthEpoch() {
    syncAuthEpoch += 1;
}

function getSyncAuthEpoch() {
    return syncAuthEpoch;
}

function isPushTimerRunning() {
    return syncTimer !== null;
}

function isPullTimerRunning() {
    return pullTimer !== null;
}

function isPullCycleRunning() {
    return pullRunning;
}

function isPushCycleRunning() {
    return flushRunning;
}

module.exports = {
    get syncTimer() {
        return syncTimer;
    },
    set syncTimer(v) {
        syncTimer = v;
    },
    get flushRunning() {
        return flushRunning;
    },
    set flushRunning(v) {
        flushRunning = v;
    },
    get pullTimer() {
        return pullTimer;
    },
    set pullTimer(v) {
        pullTimer = v;
    },
    get pullRunning() {
        return pullRunning;
    },
    set pullRunning(v) {
        pullRunning = v;
    },
    get pullListenerUnsubscribe() {
        return pullListenerUnsubscribe;
    },
    set pullListenerUnsubscribe(v) {
        pullListenerUnsubscribe = v;
    },
    get pullDebounceTimer() {
        return pullDebounceTimer;
    },
    set pullDebounceTimer(v) {
        pullDebounceTimer = v;
    },
    get backlogPushTimer() {
        return backlogPushTimer;
    },
    set backlogPushTimer(v) {
        backlogPushTimer = v;
    },
    get unhandledRejectionHandlerInstalled() {
        return unhandledRejectionHandlerInstalled;
    },
    set unhandledRejectionHandlerInstalled(v) {
        unhandledRejectionHandlerInstalled = v;
    },
    REMOTE_PULL_DEBOUNCE_MS,
    BACKLOG_PUSH_DELAY_MS,
    MAX_RECORDED_PULL_FAILURES,
    bumpSyncAuthEpoch,
    getSyncAuthEpoch,
    isPushTimerRunning,
    isPullTimerRunning,
    isPullCycleRunning,
    isPushCycleRunning
};
`
);

// ---- helpers.js ----
const helperFns = [
    'isPullDebugEnabled',
    'pullDebug',
    'summarizePullItem',
    'summarizeOutboxEntry',
    'logSyncError',
    'failFirestoreDocBuild',
    'formatPullApplyFailure',
    'recordPullApplyFailure',
    'buildPullFailureSummary',
    'getValidColumns',
    'filterToValidColumns',
    'sortByTopology',
    'getTopologyRank',
    'sortOutboxRowsForPush',
    'sortPreparedItemsForPush',
    'hasMultipleTopologyRanks',
    'readSyncConfig',
    'parseConfigInteger',
    'parseConfigNumber',
    'parseConfigBoolean',
    'resolvePushBatchSize',
    'resolvePushTuning',
    'resolveDrainLimit',
    'resolveSyncIntervalMinutes',
    'createRateLimiter',
    'isThrottleError',
    'isAssertionOrAuthNetworkError',
    'isConnectivityWarmupNetworkError',
    'chunkArray',
    'runConcurrentGroup',
    'parseLocalIdFromRowSyncId',
    'parsePullCursor',
    'serializePullCursor',
    'shouldScheduleFollowupPush',
    'computePushThroughput',
    'classifyPushError'
];

const helperBodies = helperFns.map((n) => extractFn(n).body);

// constants between TOPO and DEFAULT_PUSH
const topoStart = findConst('TOPO_ORDER_PUT');
const topoEnd = findConst('TOPO_ORDER_DEL');
// TOPO_ORDER_DEL is one line
const topoDelLine = topoEnd;
const defaultsStart = findConst('DEFAULT_PUSH_CONCURRENCY');
const defaultsEnd = findConst('PUSH_BACKOFF_MAX_MS');

write(
    'helpers.js',
    `'use strict';

/**
 * Pure / near-pure sync engine helpers (WP3).
 * No Firestore data-plane imports.
 */

const { logAppError } = require('../../diagnostics/error-log');
const state = require('./state');

// Cache of valid column names per table (populated from PRAGMA table_info)
const _schemaColumnsCache = new Map();

${sliceLines(topoStart, topoDelLine)}

${sliceLines(defaultsStart, defaultsEnd)}

${helperBodies.join('\n\n')}

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
    ${helperFns.join(',\n    ')}
};
`
);

// Fix recordPullApplyFailure to use state.MAX_RECORDED_PULL_FAILURES
// helpers currently reference MAX_RECORDED_PULL_FAILURES from outer scope - need patch
{
    let helpers = fs.readFileSync(path.join(root, 'helpers.js'), 'utf8');
    helpers = helpers.replace(/MAX_RECORDED_PULL_FAILURES/g, 'state.MAX_RECORDED_PULL_FAILURES');
    // but we also export nothing for that - state has it
    // Don't replace the require state line itself
    helpers = helpers.replace(
        "const state = require('./state');\n\n// Cache",
        "const state = require('./state');\n\n// Cache"
    );
    // re-fix accidental double state. replacement on the require? none
    fs.writeFileSync(path.join(root, 'helpers.js'), helpers);
}

console.log('helpers + state done; remaining modules next pass…');

// Save function map for next steps
const allFns = [
    'updateDeviceHeartbeat',
    'resolveStudentCode',
    'resolveStudentId',
    'sanitizeSoftForeignKeys',
    'normalizeSortKeyRowData',
    'readOutboxAncestorData',
    'buildFirestoreDoc',
    'buildFirestorePayload',
    'stripRemoteSyncMetadata',
    'isEquivalentRemoteData',
    'writeItemWithVersionCheck',
    'markEntrySent',
    'markEntryFailed',
    'reopenVersionConflictOutbox',
    'updatePushMeta',
    'recordPushMeta',
    'compactPendingOutbox',
    'reopenRecoverableOutbox',
    'reopenUnbuildableDeletes',
    'recoverCloudSessionAfterPermissionDenied',
    'scheduleBacklogPush',
    'getCurrentRole',
    'logVersionConflict',
    'writeSyncLogWithRetry',
    'reconcileUnreconciledRow',
    'applyItemOutcome',
    'runBatchedFastPath',
    'flushPreparedItems',
    'flushPreparedItemsConcurrent',
    'expandBulkEntry',
    'flushExpandedEntries',
    'readPendingOutboxBatch',
    'bumpRetryCount',
    'processOutboxRow',
    'flushSyncOutbox',
    'installUnhandledRejectionHandler',
    'startSyncPushBackground',
    'stopSyncPushBackground',
    'restartSyncPushBackground',
    'scheduleDebouncedPull',
    'stopRemoteChangeListener',
    'startRemoteChangeListener',
    'buildPullResult',
    'mapRemoteItems',
    'getStudentDependency',
    'hasMissingStudentDependencies',
    'bootstrapStudentsForMissingDependencies',
    'getRemoteCollectionCount',
    'getLocalTableCount',
    'bootstrapTablesIfLocalBehind',
    'handlePullConflict',
    'applyPutOperation',
    'applySingleItem',
    'pullRemoteChanges',
    'startSyncPullBackground',
    'stopSyncPullBackground',
    'restartSyncPullBackground'
];

const map = {};
for (const n of allFns) {
    try {
        const e = extractFn(n);
        map[n] = { start: e.start, end: e.end };
    } catch (err) {
        console.warn(err.message);
    }
}
fs.writeFileSync(path.join(root, '_fn-map.json'), JSON.stringify(map, null, 2));
console.log('fn map written', Object.keys(map).length);
