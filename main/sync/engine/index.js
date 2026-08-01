'use strict';

/**
 * Sync engine public API (WP3).
 * Implementation is split across helpers, outbox, apply, push, pull, transport.
 * Stable import path remains main/sync/engine.js (compatibility facade).
 */

const { registerDefaultApplyHooks } = require('../apply-hooks');
registerDefaultApplyHooks();

const state = require('./state');
const helpers = require('./helpers');
const outbox = require('./outbox');
const docBuild = require('./doc-build');
const apply = require('./apply');
const push = require('./push');
const pull = require('./pull');
const transport = require('../transport/firestore');
const { expandBulkEntry: expandBulkEntryTyped } = require('./expand-bulk');

// expandBulkEntry wrapper kept for API parity with previous engine exports
function expandBulkEntry(db, entry, deviceHash) {
    return expandBulkEntryTyped(db, entry, deviceHash);
}

module.exports = {
    // lifecycle
    flushSyncOutbox: push.flushSyncOutbox,
    startSyncPushBackground: push.startSyncPushBackground,
    stopSyncPushBackground: push.stopSyncPushBackground,
    restartSyncPushBackground: push.restartSyncPushBackground,
    pullRemoteChanges: pull.pullRemoteChanges,
    startSyncPullBackground: pull.startSyncPullBackground,
    stopSyncPullBackground: pull.stopSyncPullBackground,
    restartSyncPullBackground: pull.restartSyncPullBackground,
    isPushTimerRunning: state.isPushTimerRunning,
    isPullTimerRunning: state.isPullTimerRunning,
    isPullCycleRunning: state.isPullCycleRunning,
    isPushCycleRunning: state.isPushCycleRunning,
    bumpSyncAuthEpoch: state.bumpSyncAuthEpoch,

    // helpers (tests + tooling)
    parsePullCursor: helpers.parsePullCursor,
    serializePullCursor: helpers.serializePullCursor,
    resolvePushTuning: helpers.resolvePushTuning,
    resolveDrainLimit: helpers.resolveDrainLimit,
    resolveSyncIntervalMinutes: helpers.resolveSyncIntervalMinutes,
    createRateLimiter: helpers.createRateLimiter,
    isThrottleError: helpers.isThrottleError,
    isAssertionOrAuthNetworkError: helpers.isAssertionOrAuthNetworkError,
    chunkArray: helpers.chunkArray,
    runConcurrentGroup: helpers.runConcurrentGroup,
    shouldScheduleFollowupPush: helpers.shouldScheduleFollowupPush,
    computePushThroughput: helpers.computePushThroughput,
    classifyPushError: helpers.classifyPushError,

    // outbox meta
    recordPushMeta: outbox.recordPushMeta,
    updatePushMeta: outbox.updatePushMeta,

    // push internals used by property tests
    applyItemOutcome: push.applyItemOutcome,
    flushPreparedItems: push.flushPreparedItems,
    flushPreparedItemsConcurrent: push.flushPreparedItemsConcurrent,
    runBatchedFastPath: transport.runBatchedFastPath,
    processOutboxRow: push.processOutboxRow,
    expandBulkEntry,
    installUnhandledRejectionHandler: push.installUnhandledRejectionHandler,

    // optional deeper exports for tooling
    buildFirestoreDoc: docBuild.buildFirestoreDoc,
    writeItemWithVersionCheck: transport.writeItemWithVersionCheck,
    applySingleItem: apply.applySingleItem,
    createFirestoreTransport: transport.createFirestoreTransport
};
