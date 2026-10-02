'use strict';

/** Shared mutable lifecycle state for push/pull cycles (WP3). */

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
    get syncTimer() { return syncTimer; },
    set syncTimer(v) { syncTimer = v; },
    get flushRunning() { return flushRunning; },
    set flushRunning(v) { flushRunning = v; },
    get pullTimer() { return pullTimer; },
    set pullTimer(v) { pullTimer = v; },
    get pullRunning() { return pullRunning; },
    set pullRunning(v) { pullRunning = v; },
    get pullListenerUnsubscribe() { return pullListenerUnsubscribe; },
    set pullListenerUnsubscribe(v) { pullListenerUnsubscribe = v; },
    get pullDebounceTimer() { return pullDebounceTimer; },
    set pullDebounceTimer(v) { pullDebounceTimer = v; },
    get backlogPushTimer() { return backlogPushTimer; },
    set backlogPushTimer(v) { backlogPushTimer = v; },
    get unhandledRejectionHandlerInstalled() { return unhandledRejectionHandlerInstalled; },
    set unhandledRejectionHandlerInstalled(v) { unhandledRejectionHandlerInstalled = v; },
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
