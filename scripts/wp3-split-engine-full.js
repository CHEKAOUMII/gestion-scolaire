'use strict';

/**
 * Full WP3 split of main/sync/engine/index.js into modules.
 * Extracts existing function bodies — does not reimplement logic.
 *
 *   node scripts/wp3-split-engine-full.js
 */

const fs = require('fs');
const path = require('path');

const repo = path.join(__dirname, '..');
const engineDir = path.join(repo, 'main/sync/engine');
const transportDir = path.join(repo, 'main/sync/transport');
const indexPath = path.join(engineDir, 'index.js');
const backupPath = path.join(engineDir, 'index.monolith.bak.js');

// Prefer backup as source of truth if we already overwrote index
const sourcePath = fs.existsSync(backupPath) ? backupPath : indexPath;
const lines = fs.readFileSync(sourcePath, 'utf8').split(/\r?\n/);

if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(indexPath, backupPath);
    console.log('backed up to index.monolith.bak.js');
}

function sliceLines(start, endInclusive) {
    return lines.slice(start - 1, endInclusive).join('\n');
}

function write(fullPath, content) {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    const body = content.endsWith('\n') ? content : content + '\n';
    fs.writeFileSync(fullPath, body);
    console.log('wrote', path.relative(repo, fullPath), body.split('\n').length);
}

function findFn(name) {
    const re = new RegExp('^(async )?function ' + name + '\\b');
    for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) return i + 1;
    }
    throw new Error('function not found: ' + name);
}

function findConst(name) {
    const re = new RegExp('^const ' + name + '\\b');
    for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) return i + 1;
    }
    throw new Error('const not found: ' + name);
}

function findFnEnd(startLine) {
    let depth = 0;
    let started = false;
    for (let i = startLine - 1; i < lines.length; i++) {
        for (const ch of lines[i]) {
            if (ch === '{') {
                depth++;
                started = true;
            } else if (ch === '}') {
                depth--;
            }
        }
        if (started && depth === 0) return i + 1;
    }
    throw new Error('end not found for line ' + startLine);
}

function extractFn(name) {
    const start = findFn(name);
    return sliceLines(start, findFnEnd(start));
}

function extractFns(names) {
    return names.map(extractFn).join('\n\n');
}

function extractConstOneLiners(startName, endName) {
    return sliceLines(findConst(startName), findConst(endName));
}

function extractConstBlock(name) {
    const start = findConst(name);
    return sliceLines(start, findFnEnd(start));
}

// ========== state.js ==========
write(
    path.join(engineDir, 'state.js'),
    [
        "'use strict';",
        '',
        '/** Shared mutable lifecycle state for push/pull cycles (WP3). */',
        '',
        'let syncTimer = null;',
        'let flushRunning = false;',
        'let pullTimer = null;',
        'let pullRunning = false;',
        'let pullListenerUnsubscribe = null;',
        'let pullDebounceTimer = null;',
        'let syncAuthEpoch = 0;',
        'let backlogPushTimer = null;',
        'let unhandledRejectionHandlerInstalled = false;',
        '',
        'const REMOTE_PULL_DEBOUNCE_MS = 4000;',
        'const BACKLOG_PUSH_DELAY_MS = 2500;',
        'const MAX_RECORDED_PULL_FAILURES = 20;',
        '',
        'function bumpSyncAuthEpoch() {',
        '    syncAuthEpoch += 1;',
        '}',
        '',
        'function getSyncAuthEpoch() {',
        '    return syncAuthEpoch;',
        '}',
        '',
        'function isPushTimerRunning() {',
        '    return syncTimer !== null;',
        '}',
        '',
        'function isPullTimerRunning() {',
        '    return pullTimer !== null;',
        '}',
        '',
        'function isPullCycleRunning() {',
        '    return pullRunning;',
        '}',
        '',
        'function isPushCycleRunning() {',
        '    return flushRunning;',
        '}',
        '',
        'module.exports = {',
        '    get syncTimer() { return syncTimer; },',
        '    set syncTimer(v) { syncTimer = v; },',
        '    get flushRunning() { return flushRunning; },',
        '    set flushRunning(v) { flushRunning = v; },',
        '    get pullTimer() { return pullTimer; },',
        '    set pullTimer(v) { pullTimer = v; },',
        '    get pullRunning() { return pullRunning; },',
        '    set pullRunning(v) { pullRunning = v; },',
        '    get pullListenerUnsubscribe() { return pullListenerUnsubscribe; },',
        '    set pullListenerUnsubscribe(v) { pullListenerUnsubscribe = v; },',
        '    get pullDebounceTimer() { return pullDebounceTimer; },',
        '    set pullDebounceTimer(v) { pullDebounceTimer = v; },',
        '    get backlogPushTimer() { return backlogPushTimer; },',
        '    set backlogPushTimer(v) { backlogPushTimer = v; },',
        '    get unhandledRejectionHandlerInstalled() { return unhandledRejectionHandlerInstalled; },',
        '    set unhandledRejectionHandlerInstalled(v) { unhandledRejectionHandlerInstalled = v; },',
        '    REMOTE_PULL_DEBOUNCE_MS,',
        '    BACKLOG_PUSH_DELAY_MS,',
        '    MAX_RECORDED_PULL_FAILURES,',
        '    bumpSyncAuthEpoch,',
        '    getSyncAuthEpoch,',
        '    isPushTimerRunning,',
        '    isPullTimerRunning,',
        '    isPullCycleRunning,',
        '    isPushCycleRunning',
        '};',
        ''
    ].join('\n')
);

// ========== helpers.js ==========
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

let helpersSrc = extractFns(helperFns);
helpersSrc = helpersSrc.replace(/\bMAX_RECORDED_PULL_FAILURES\b/g, 'state.MAX_RECORDED_PULL_FAILURES');

write(
    path.join(engineDir, 'helpers.js'),
    [
        "'use strict';",
        '',
        '/** Pure / near-pure sync engine helpers (WP3). No Firestore data-plane. */',
        '',
        "const { logAppError } = require('../../diagnostics/error-log');",
        "const state = require('./state');",
        '',
        'const _schemaColumnsCache = new Map();',
        '',
        extractConstOneLiners('TOPO_ORDER_PUT', 'TOPO_ORDER_DEL').replace(
            'const TOPO_ORDER_DEL = [...TOPO_ORDER_PUT].reverse();',
            'const TOPO_ORDER_DEL = [...TOPO_ORDER_PUT].reverse();'
        ),
        '',
        // TOPO_ORDER_PUT is multi-line array — extract properly
        ''
    ].join('\n')
);

// Fix topo extraction - TOPO_ORDER_PUT is multi-line
const topoPutStart = findConst('TOPO_ORDER_PUT');
const topoPutEnd = findFnEnd(topoPutStart);
const topoDelLine = findConst('TOPO_ORDER_DEL');
const defaultsStart = findConst('DEFAULT_PUSH_CONCURRENCY');
const defaultsEnd = findConst('PUSH_BACKOFF_MAX_MS');

write(
    path.join(engineDir, 'helpers.js'),
    [
        "'use strict';",
        '',
        '/** Pure / near-pure sync engine helpers (WP3). No Firestore data-plane. */',
        '',
        "const { logAppError } = require('../../diagnostics/error-log');",
        "const state = require('./state');",
        '',
        'const _schemaColumnsCache = new Map();',
        '',
        sliceLines(topoPutStart, topoDelLine),
        '',
        sliceLines(defaultsStart, defaultsEnd),
        '',
        helpersSrc,
        '',
        'module.exports = {',
        '    TOPO_ORDER_PUT,',
        '    TOPO_ORDER_DEL,',
        '    DEFAULT_PUSH_CONCURRENCY,',
        '    DEFAULT_PUSH_CONCURRENCY_MAX,',
        '    ABSOLUTE_CONCURRENCY_CEILING,',
        '    DEFAULT_PUSH_BACKLOG_BATCH_SIZE,',
        '    MAX_PUSH_BACKLOG_BATCH_SIZE,',
        '    DEFAULT_PUSH_BATCH_SIZE,',
        '    DEFAULT_SYNC_INTERVAL_MINUTES,',
        '    MIN_SYNC_INTERVAL_MINUTES,',
        '    MAX_SYNC_INTERVAL_MINUTES,',
        '    PUSH_CONCURRENCY_RAMP_STEP,',
        '    PUSH_BACKOFF_BASE_MS,',
        '    PUSH_BACKOFF_MAX_MS,',
        '    ' + helperFns.join(',\n    '),
        '};',
        ''
    ].join('\n')
);

// ========== outbox.js ==========
const outboxFns = [
    'updateDeviceHeartbeat',
    'markEntrySent',
    'markEntryFailed',
    'reopenVersionConflictOutbox',
    'updatePushMeta',
    'recordPushMeta',
    'compactPendingOutbox',
    'reopenRecoverableOutbox',
    'reopenUnbuildableDeletes',
    'readPendingOutboxBatch',
    'bumpRetryCount',
    'readOutboxAncestorData'
];

let outboxSrc = extractFns(outboxFns);
// recordPushMeta uses classifyPushError
write(
    path.join(engineDir, 'outbox.js'),
    [
        "'use strict';",
        '',
        '/** Outbox persistence: mark sent/failed, reopen, compact, batch read (WP3). */',
        '',
        "const { getDeviceHash, getDeviceName } = require('../capture');",
        "const { classifyPushError } = require('./helpers');",
        '',
        outboxSrc,
        '',
        'module.exports = {',
        '    ' + outboxFns.join(',\n    '),
        '};',
        ''
    ].join('\n')
);

// ========== doc-build.js ==========
const docBuildFns = [
    'resolveStudentCode',
    'resolveStudentId',
    'normalizeSortKeyRowData',
    'buildFirestoreDoc',
    'buildFirestorePayload',
    'stripRemoteSyncMetadata',
    'isEquivalentRemoteData'
];
const remoteMetaStart = findConst('REMOTE_SYNC_METADATA_FIELDS');
const remoteMetaEnd = findFnEnd(remoteMetaStart);

write(
    path.join(engineDir, 'doc-build.js'),
    [
        "'use strict';",
        '',
        '/** Build Firestore push documents from outbox rows (WP3). */',
        '',
        'const {',
        '    getCollectionPath,',
        '    buildDocumentId,',
        '    buildLegacyDocumentId,',
        '    COLLECTION_MAP',
        "} = require('../../firebase/collections');",
        "const { stripSensitiveFields, SENSITIVE_FIELDS } = require('../capture');",
        "const { getEntityType } = require('../authority');",
        "const { computeRowChecksum } = require('../merge');",
        "const { failFirestoreDocBuild, parseLocalIdFromRowSyncId } = require('./helpers');",
        "const { readOutboxAncestorData } = require('./outbox');",
        '',
        sliceLines(remoteMetaStart, remoteMetaEnd),
        '',
        extractFns(docBuildFns),
        '',
        'module.exports = {',
        '    REMOTE_SYNC_METADATA_FIELDS,',
        '    ' + docBuildFns.join(',\n    '),
        '};',
        ''
    ].join('\n')
);

// ========== transport/firestore.js ==========
// Extract writeItemWithVersionCheck, runBatchedFastPath, writeSyncLogWithRetry bodies
// and wrap with SDK requires + createTransport factory for tests.
const transportFns = ['writeItemWithVersionCheck', 'runBatchedFastPath', 'writeSyncLogWithRetry'];
let transportBodies = extractFns(transportFns);

write(
    path.join(transportDir, 'firestore.js'),
    [
        "'use strict';",
        '',
        '/**',
        ' * Firestore sync data-plane (WP3).',
        ' * App/auth configuration stays in main/firebase/config.js.',
        ' *',
        ' * createFirestoreTransport(deps) injects SDK / helpers for unit tests.',
        ' * Default export methods use the live Firebase SDK.',
        ' */',
        '',
        'function createFirestoreTransport(deps) {',
        '    deps = deps || {};',
        '    const sdk = deps.sdk || require("firebase/firestore");',
        '    const {',
        '        collection,',
        '        doc,',
        '        documentId,',
        '        getCountFromServer,',
        '        getDocs,',
        '        limit: firestoreLimit,',
        '        onSnapshot,',
        '        orderBy,',
        '        query,',
        '        runTransaction,',
        '        where,',
        '        writeBatch',
        '    } = sdk;',
        '',
        '    const firebaseConfig = deps.firebaseConfig || require("../../firebase/config");',
        '    const getFirestoreDb = deps.getFirestoreDb || firebaseConfig.getFirestoreDb;',
        '    const recoverFirestoreClient = deps.recoverFirestoreClient || firebaseConfig.recoverFirestoreClient;',
        '',
        '    const syncLog = deps.syncLog || require("../../firebase/sync-log");',
        '    const { logChangeBatch, pullChanges, bootstrapFromCollections } = syncLog;',
        '',
        '    const collections = deps.collections || require("../../firebase/collections");',
        '    const { getCollectionPath } = collections;',
        '',
        '    const docBuild = deps.docBuild || require("../engine/doc-build");',
        '    const { buildFirestorePayload, isEquivalentRemoteData } = docBuild;',
        '',
        '    const helpers = deps.helpers || require("../engine/helpers");',
        '    const { isThrottleError, isAssertionOrAuthNetworkError, chunkArray } = helpers;',
        '',
        '    const outbox = deps.outbox || require("../engine/outbox");',
        '    const { markEntrySent } = outbox;',
        '',
        '    ' + transportBodies.split('\n').join('\n    '),
        '',
        '    return {',
        '        collection,',
        '        doc,',
        '        documentId,',
        '        getCountFromServer,',
        '        getDocs,',
        '        firestoreLimit,',
        '        onSnapshot,',
        '        orderBy,',
        '        query,',
        '        runTransaction,',
        '        where,',
        '        writeBatch,',
        '        getFirestoreDb,',
        '        recoverFirestoreClient,',
        '        logChangeBatch,',
        '        pullChanges,',
        '        bootstrapFromCollections,',
        '        getCollectionPath,',
        '        writeItemWithVersionCheck,',
        '        runBatchedFastPath,',
        '        writeSyncLogWithRetry',
        '    };',
        '}',
        '',
        'const defaultTransport = createFirestoreTransport();',
        '',
        'module.exports = Object.assign({ createFirestoreTransport }, defaultTransport);',
        ''
    ].join('\n')
);

// ========== apply.js ==========
const softFkStart = findConst('PULL_SOFT_FOREIGN_KEYS');
const softFkEnd = findFnEnd(softFkStart);
const applyFns = [
    'sanitizeSoftForeignKeys',
    'handlePullConflict',
    'applyPutOperation',
    'applySingleItem',
    'mapRemoteItems',
    'getStudentDependency',
    'hasMissingStudentDependencies',
    'buildPullResult'
];

write(
    path.join(engineDir, 'apply.js'),
    [
        "'use strict';",
        '',
        '/** Pull apply: PUT/DEL local rows, conflict handling, entity hooks (WP3). */',
        '',
        "const { threeWayMerge, computeRowChecksum } = require('../merge');",
        "const { SENSITIVE_FIELDS } = require('../capture');",
        "const { ENTITY_TYPE_REGISTRY } = require('../authority');",
        "const { getApplyHooks, findLocalIdByLogicalKeys } = require('../entity-registry');",
        "const { logConflictForensics } = require('../conflict-forensics');",
        "const {",
        '    filterToValidColumns,',
        '    recordPullApplyFailure,',
        '    logSyncError',
        "} = require('./helpers');",
        "const { resolveStudentId } = require('./doc-build');",
        '',
        sliceLines(softFkStart, softFkEnd),
        '',
        extractFns(applyFns),
        '',
        'module.exports = {',
        '    PULL_SOFT_FOREIGN_KEYS,',
        '    ' + applyFns.join(',\n    '),
        '};',
        ''
    ].join('\n')
);

// ========== push.js ==========
// Push uses state via state module — rewrite free vars _flushRunning etc.
const pushFns = [
    'recoverCloudSessionAfterPermissionDenied',
    'scheduleBacklogPush',
    'getCurrentRole',
    'logVersionConflict',
    'reconcileUnreconciledRow',
    'applyItemOutcome',
    'flushPreparedItems',
    'flushPreparedItemsConcurrent',
    'expandBulkEntry',
    'flushExpandedEntries',
    'processOutboxRow',
    'flushSyncOutbox',
    'installUnhandledRejectionHandler',
    'startSyncPushBackground',
    'stopSyncPushBackground',
    'restartSyncPushBackground'
];

let pushSrc = extractFns(pushFns);
// Rewrite module-level state access
const stateRewrites = [
    [/\b_flushRunning\b/g, 'state.flushRunning'],
    [/\b_syncAuthEpoch\b/g, 'state.getSyncAuthEpoch()'],
    [/\b_syncTimer\b/g, 'state.syncTimer'],
    [/\b_backlogPushTimer\b/g, 'state.backlogPushTimer'],
    [/\b_unhandledRejectionHandlerInstalled\b/g, 'state.unhandledRejectionHandlerInstalled'],
    [/\bBACKLOG_PUSH_DELAY_MS\b/g, 'state.BACKLOG_PUSH_DELAY_MS']
];
// Careful: assignment to state.getSyncAuthEpoch() is wrong for bump
// Original uses authEpochAtStart = _syncAuthEpoch (read) and bumpSyncAuthEpoch()
// For assignments: _flushRunning = true → state.flushRunning = true (getter/setter works)

// Fix epoch: only reads of _syncAuthEpoch become getSyncAuthEpoch(); assignments don't exist
// For _syncTimer = x → state.syncTimer = x works with setter

for (const [re, rep] of stateRewrites) {
    pushSrc = pushSrc.replace(re, rep);
}

// writeItemWithVersionCheck, runBatchedFastPath, writeSyncLogWithRetry come from transport
// expandBulkEntryTyped was local - use expand-bulk module

write(
    path.join(engineDir, 'push.js'),
    [
        "'use strict';",
        '',
        '/** Push orchestration: outbox drain, batching, rate limits, lifecycle (WP3). */',
        '',
        "const { getDb } = require('../../db/context');",
        "const { getCredentials, clearCredentials, testConnection, resolveSyncSchoolId, hasLiveFirebaseUser } = require('../credentials');",
        "const { getDeviceHash } = require('../capture');",
        "const { canPush } = require('../authority');",
        "const { threeWayMerge, computeRowChecksum } = require('../merge');",
        "const { SENSITIVE_FIELDS } = require('../capture');",
        "const { logConflictForensics } = require('../conflict-forensics');",
        "const { expandBulkEntry: expandBulkEntryTyped } = require('./expand-bulk');",
        "const state = require('./state');",
        "const helpers = require('./helpers');",
        "const outbox = require('./outbox');",
        "const docBuild = require('./doc-build');",
        "const transport = require('../transport/firestore');",
        '',
        'const {',
        '    readSyncConfig,',
        '    resolvePushTuning,',
        '    resolveDrainLimit,',
        '    resolveSyncIntervalMinutes,',
        '    createRateLimiter,',
        '    isThrottleError,',
        '    isAssertionOrAuthNetworkError,',
        '    isConnectivityWarmupNetworkError,',
        '    chunkArray,',
        '    runConcurrentGroup,',
        '    sortOutboxRowsForPush,',
        '    sortPreparedItemsForPush,',
        '    hasMultipleTopologyRanks,',
        '    shouldScheduleFollowupPush,',
        '    computePushThroughput,',
        '    classifyPushError,',
        '    logSyncError,',
        '    failFirestoreDocBuild',
        '} = helpers;',
        '',
        'const {',
        '    markEntrySent,',
        '    markEntryFailed,',
        '    reopenVersionConflictOutbox,',
        '    updatePushMeta,',
        '    recordPushMeta,',
        '    compactPendingOutbox,',
        '    reopenRecoverableOutbox,',
        '    reopenUnbuildableDeletes,',
        '    readPendingOutboxBatch,',
        '    bumpRetryCount,',
        '    updateDeviceHeartbeat',
        '} = outbox;',
        '',
        'const { buildFirestoreDoc, buildFirestorePayload, isEquivalentRemoteData, stripRemoteSyncMetadata } = docBuild;',
        '',
        'const {',
        '    writeItemWithVersionCheck,',
        '    runBatchedFastPath,',
        '    writeSyncLogWithRetry,',
        '    getFirestoreDb,',
        '    recoverFirestoreClient',
        '} = transport;',
        '',
        // Re-bind state fields that use assignment with local names for readability in extracted code
        // Actually we rewrote to state.flushRunning etc.
        '',
        pushSrc,
        '',
        'module.exports = {',
        '    ' + pushFns.join(',\n    '),
        '    // re-export transport ops used by tests via engine facade',
        '    writeItemWithVersionCheck,',
        '    runBatchedFastPath,',
        '    writeSyncLogWithRetry',
        '};',
        ''
    ].join('\n')
);

// ========== pull.js ==========
const pullFns = [
    'scheduleDebouncedPull',
    'stopRemoteChangeListener',
    'startRemoteChangeListener',
    'bootstrapStudentsForMissingDependencies',
    'getRemoteCollectionCount',
    'getLocalTableCount',
    'bootstrapTablesIfLocalBehind',
    'pullRemoteChanges',
    'startSyncPullBackground',
    'stopSyncPullBackground',
    'restartSyncPullBackground'
];

let pullSrc = extractFns(pullFns);
const pullStateRewrites = [
    [/\b_pullRunning\b/g, 'state.pullRunning'],
    [/\b_pullTimer\b/g, 'state.pullTimer'],
    [/\b_pullListenerUnsubscribe\b/g, 'state.pullListenerUnsubscribe'],
    [/\b_pullDebounceTimer\b/g, 'state.pullDebounceTimer'],
    [/\b_syncAuthEpoch\b/g, 'state.getSyncAuthEpoch()'],
    [/\bREMOTE_PULL_DEBOUNCE_MS\b/g, 'state.REMOTE_PULL_DEBOUNCE_MS'],
    [/\bMAX_RECORDED_PULL_FAILURES\b/g, 'state.MAX_RECORDED_PULL_FAILURES']
];
for (const [re, rep] of pullStateRewrites) {
    pullSrc = pullSrc.replace(re, rep);
}

write(
    path.join(engineDir, 'pull.js'),
    [
        "'use strict';",
        '',
        '/** Pull orchestration: remote intake, cursors, apply, lifecycle (WP3). */',
        '',
        "const { getDb } = require('../../db/context');",
        "const { resolveSyncSchoolId, getCredentials, clearCredentials, hasLiveFirebaseUser } = require('../credentials');",
        "const { getDeviceHash } = require('../capture');",
        "const { COLLECTION_MAP } = require('../../firebase/collections');",
        "const { ENTITY_TYPE_REGISTRY } = require('../authority');",
        "const state = require('./state');",
        "const helpers = require('./helpers');",
        "const apply = require('./apply');",
        "const docBuild = require('./doc-build');",
        "const transport = require('../transport/firestore');",
        '',
        'const {',
        '    readSyncConfig,',
        '    resolveSyncIntervalMinutes,',
        '    parsePullCursor,',
        '    serializePullCursor,',
        '    sortByTopology,',
        '    TOPO_ORDER_PUT,',
        '    isPullDebugEnabled,',
        '    pullDebug,',
        '    logSyncError,',
        '    buildPullFailureSummary',
        '} = helpers;',
        '',
        'const {',
        '    buildPullResult,',
        '    mapRemoteItems,',
        '    getStudentDependency,',
        '    hasMissingStudentDependencies,',
        '    applySingleItem',
        '} = apply;',
        '',
        'const { resolveStudentId } = docBuild;',
        '',
        'const {',
        '    collection,',
        '    doc,',
        '    documentId,',
        '    getCountFromServer,',
        '    getDocs,',
        '    firestoreLimit,',
        '    onSnapshot,',
        '    orderBy,',
        '    query,',
        '    getFirestoreDb,',
        '    pullChanges,',
        '    bootstrapFromCollections,',
        '    getCollectionPath',
        '} = transport;',
        '',
        pullSrc,
        '',
        'module.exports = {',
        '    ' + pullFns.join(',\n    '),
        '};',
        ''
    ].join('\n')
);

// ========== index.js ==========
write(
    path.join(engineDir, 'index.js'),
    [
        "'use strict';",
        '',
        '/**',
        ' * Sync engine public API (WP3).',
        ' * Implementation is split across helpers, outbox, apply, push, pull, transport.',
        ' * Stable import path remains main/sync/engine.js (compatibility facade).',
        ' */',
        '',
        "const { registerDefaultApplyHooks } = require('../apply-hooks');",
        'registerDefaultApplyHooks();',
        '',
        "const state = require('./state');",
        "const helpers = require('./helpers');",
        "const outbox = require('./outbox');",
        "const docBuild = require('./doc-build');",
        "const apply = require('./apply');",
        "const push = require('./push');",
        "const pull = require('./pull');",
        "const transport = require('../transport/firestore');",
        "const { expandBulkEntry: expandBulkEntryTyped } = require('./expand-bulk');",
        '',
        '// expandBulkEntry wrapper kept for API parity with previous engine exports',
        'function expandBulkEntry(db, entry, deviceHash) {',
        '    return expandBulkEntryTyped(db, entry, deviceHash);',
        '}',
        '',
        'module.exports = {',
        '    // lifecycle',
        '    flushSyncOutbox: push.flushSyncOutbox,',
        '    startSyncPushBackground: push.startSyncPushBackground,',
        '    stopSyncPushBackground: push.stopSyncPushBackground,',
        '    restartSyncPushBackground: push.restartSyncPushBackground,',
        '    pullRemoteChanges: pull.pullRemoteChanges,',
        '    startSyncPullBackground: pull.startSyncPullBackground,',
        '    stopSyncPullBackground: pull.stopSyncPullBackground,',
        '    restartSyncPullBackground: pull.restartSyncPullBackground,',
        '    isPushTimerRunning: state.isPushTimerRunning,',
        '    isPullTimerRunning: state.isPullTimerRunning,',
        '    isPullCycleRunning: state.isPullCycleRunning,',
        '    isPushCycleRunning: state.isPushCycleRunning,',
        '    bumpSyncAuthEpoch: state.bumpSyncAuthEpoch,',
        '',
        '    // helpers (tests + tooling)',
        '    parsePullCursor: helpers.parsePullCursor,',
        '    serializePullCursor: helpers.serializePullCursor,',
        '    resolvePushTuning: helpers.resolvePushTuning,',
        '    resolveDrainLimit: helpers.resolveDrainLimit,',
        '    resolveSyncIntervalMinutes: helpers.resolveSyncIntervalMinutes,',
        '    createRateLimiter: helpers.createRateLimiter,',
        '    isThrottleError: helpers.isThrottleError,',
        '    isAssertionOrAuthNetworkError: helpers.isAssertionOrAuthNetworkError,',
        '    chunkArray: helpers.chunkArray,',
        '    runConcurrentGroup: helpers.runConcurrentGroup,',
        '    shouldScheduleFollowupPush: helpers.shouldScheduleFollowupPush,',
        '    computePushThroughput: helpers.computePushThroughput,',
        '    classifyPushError: helpers.classifyPushError,',
        '',
        '    // outbox meta',
        '    recordPushMeta: outbox.recordPushMeta,',
        '    updatePushMeta: outbox.updatePushMeta,',
        '',
        '    // push internals used by property tests',
        '    applyItemOutcome: push.applyItemOutcome,',
        '    flushPreparedItems: push.flushPreparedItems,',
        '    flushPreparedItemsConcurrent: push.flushPreparedItemsConcurrent,',
        '    runBatchedFastPath: transport.runBatchedFastPath,',
        '    processOutboxRow: push.processOutboxRow,',
        '    expandBulkEntry,',
        '    installUnhandledRejectionHandler: push.installUnhandledRejectionHandler,',
        '',
        '    // optional deeper exports for tooling',
        '    buildFirestoreDoc: docBuild.buildFirestoreDoc,',
        '    writeItemWithVersionCheck: transport.writeItemWithVersionCheck,',
        '    applySingleItem: apply.applySingleItem,',
        '    createFirestoreTransport: transport.createFirestoreTransport',
        '};',
        ''
    ].join('\n')
);

console.log('\\nWP3 split complete.');
console.log('Verify with: node -e "require(\'./main/sync/engine\')"');
