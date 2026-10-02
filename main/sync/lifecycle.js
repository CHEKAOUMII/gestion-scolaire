'use strict';

/**
 * Sync lifecycle transitions (WP5).
 * Auth handlers call these; they do not own Firebase login/session tokens.
 *
 * Optional `deps` enable unit tests without a live DB/Firebase stack.
 */

function defaultDeps() {
    return {
        bumpSyncAuthEpoch: () => require('./engine').bumpSyncAuthEpoch(),
        restartSyncPushBackground: () => require('./engine').restartSyncPushBackground(),
        restartSyncPullBackground: () => require('./engine').restartSyncPullBackground(),
        stopSyncPushBackground: () => require('./engine').stopSyncPushBackground(),
        stopSyncPullBackground: () => require('./engine').stopSyncPullBackground(),
        restartSnapshotBackground: () => require('./snapshot').restartSnapshotBackground(),
        stopSnapshotBackground: () => require('./snapshot').stopSnapshotBackground(),
        clearCredentials: () => require('./credentials').clearCredentials(),
        clearStoredCredential: () => require('./credentials').clearStoredCredential(),
        recoverFirestoreClient: () => require('../firebase/config').recoverFirestoreClient(),
        clearStaleSyncErrors: () => {
            const { getDb } = require('../db/context');
            getDb()
                .prepare('UPDATE sync_config SET last_push_error = NULL, last_pull_error = NULL WHERE id = 1')
                .run();
        }
    };
}

function resolveDeps(overrides) {
    return { ...defaultDeps(), ...(overrides || {}) };
}

function bumpAuthEpoch(deps) {
    const d = resolveDeps(deps);
    try {
        d.bumpSyncAuthEpoch();
    } catch (err) {
        console.warn('[sync:lifecycle] bumpAuthEpoch failed:', err.message);
    }
}

function clearStaleSyncErrors(deps) {
    const d = resolveDeps(deps);
    try {
        d.clearStaleSyncErrors();
    } catch (err) {
        console.warn('[sync:lifecycle] Failed to clear stale sync errors:', err.message);
    }
}

function restartBackgroundLoops(deps) {
    const d = resolveDeps(deps);
    d.restartSyncPushBackground();
    d.restartSyncPullBackground();
    d.restartSnapshotBackground();
}

function stopBackgroundLoops(deps) {
    const d = resolveDeps(deps);
    d.stopSyncPushBackground();
    d.stopSyncPullBackground();
    d.stopSnapshotBackground();
}

/**
 * Online login: clean slate errors, restart push/pull/snapshot.
 */
async function onLoginOnline(deps) {
    const d = resolveDeps(deps);
    bumpAuthEpoch(d);
    clearStaleSyncErrors(d);

    try {
        await d.recoverFirestoreClient();
    } catch (err) {
        console.warn('[sync:lifecycle] recoverFirestoreClient failed:', err.message);
    }

    try {
        restartBackgroundLoops(d);
    } catch (err) {
        console.warn('[sync:lifecycle] restartBackgroundLoops failed:', err.message);
    }
}

/**
 * Offline login: stop all sync loops and clear in-memory credentials.
 */
function onLoginOffline(deps) {
    const d = resolveDeps(deps);
    bumpAuthEpoch(d);
    try {
        stopBackgroundLoops(d);
    } catch (err) {
        console.warn('[sync:lifecycle] stop on offline login failed:', err.message);
    }
    try {
        d.clearCredentials();
    } catch (err) {
        console.warn('[sync:lifecycle] clearCredentials on offline login failed:', err.message);
    }
}

/**
 * Logout (D5): bump epoch, stop push/pull/snapshot, clear credentials.
 * Credential clear is attempted even if stop fails.
 */
async function onLogout(options = {}, deps) {
    const d = resolveDeps(deps);
    bumpAuthEpoch(d);

    let stopError = null;
    try {
        stopBackgroundLoops(d);
    } catch (err) {
        stopError = err;
        console.warn('[sync:lifecycle] stop on logout failed:', err.message);
    }

    if (typeof options.signOutFirebase === 'function') {
        try {
            await options.signOutFirebase();
        } catch (err) {
            console.warn('[sync:lifecycle] Firebase sign-out failed:', err.message);
        }
    }

    try {
        d.clearCredentials();
        d.clearStoredCredential();
    } catch (err) {
        console.warn('[sync:lifecycle] clear credentials on logout failed:', err.message);
    }

    if (stopError) throw stopError;
}

module.exports = {
    bumpAuthEpoch,
    onLoginOnline,
    onLoginOffline,
    onLogout,
    clearStaleSyncErrors,
    restartBackgroundLoops,
    stopBackgroundLoops
};
