'use strict';

/**
 * Lifecycle transition matrix tests (WP5) with injectable deps.
 */
const assert = require('assert');
const lifecycle = require('../main/sync/lifecycle');

async function run() {
    console.log('[test] sync lifecycle matrix');

    const calls = [];
    const deps = {
        bumpSyncAuthEpoch: () => calls.push('bump'),
        restartSyncPushBackground: () => calls.push('restartPush'),
        restartSyncPullBackground: () => calls.push('restartPull'),
        stopSyncPushBackground: () => calls.push('stopPush'),
        stopSyncPullBackground: () => calls.push('stopPull'),
        restartSnapshotBackground: () => calls.push('restartSnapshot'),
        stopSnapshotBackground: () => calls.push('stopSnapshot'),
        clearCredentials: () => calls.push('clearCredMem'),
        clearStoredCredential: () => calls.push('clearCredDb'),
        recoverFirestoreClient: async () => {
            calls.push('recoverFs');
        },
        clearStaleSyncErrors: () => calls.push('clearErrors')
    };

    calls.length = 0;
    await lifecycle.onLoginOnline(deps);
    assert.ok(calls.includes('bump'), 'online login bumps epoch');
    assert.ok(calls.includes('clearErrors'));
    assert.ok(calls.includes('recoverFs'));
    assert.ok(calls.includes('restartPush') && calls.includes('restartPull') && calls.includes('restartSnapshot'));
    console.log('  [ok] onLoginOnline');

    calls.length = 0;
    lifecycle.onLoginOffline(deps);
    assert.ok(calls.includes('bump'));
    assert.ok(calls.includes('stopPush') && calls.includes('stopPull') && calls.includes('stopSnapshot'));
    assert.ok(calls.includes('clearCredMem'));
    console.log('  [ok] onLoginOffline');

    calls.length = 0;
    let signedOut = false;
    await lifecycle.onLogout(
        {
            signOutFirebase: async () => {
                signedOut = true;
                calls.push('firebaseSignOut');
            }
        },
        deps
    );
    assert.ok(calls.indexOf('bump') === 0 || calls.indexOf('bump') < calls.indexOf('stopPush'), 'epoch before stop');
    assert.ok(calls.includes('stopPush') && calls.includes('stopPull') && calls.includes('stopSnapshot'));
    assert.ok(signedOut);
    assert.ok(calls.includes('clearCredMem') && calls.includes('clearCredDb'));
    console.log('  [ok] onLogout stops push/pull/snapshot (D5)');

    // Credential cleanup still runs if stop throws
    calls.length = 0;
    const failingDeps = {
        ...deps,
        stopSyncPushBackground: () => {
            calls.push('stopPush');
            throw new Error('stop failed');
        }
    };
    let threw = false;
    try {
        await lifecycle.onLogout({}, failingDeps);
    } catch {
        threw = true;
    }
    assert.ok(threw);
    assert.ok(calls.includes('clearCredMem') && calls.includes('clearCredDb'));
    console.log('  [ok] logout cleans credentials even when stop fails');

    console.log('[test] sync lifecycle matrix OK');
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
