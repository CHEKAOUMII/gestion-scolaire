'use strict';

require('dotenv').config();
process.env.SYNC_PULL_DEBUG = '1';

const { app } = require('electron');

app.setName('gestion-scolaire');

const { initDatabase } = require('../main/db/init');
const { getDb, getDbPath } = require('../main/db/context');
const { getFirebaseConfigStatus, getFirestoreDb } = require('../main/firebase/config');
const { pullChanges } = require('../main/firebase/sync-log');
const { getCredentials, restoreFirebaseSession } = require('../main/sync/credentials');
const { getDeviceHash } = require('../main/sync/capture');
const { ENTITY_TYPE_REGISTRY } = require('../main/sync/authority');
const { pullRemoteChanges, parsePullCursor, serializePullCursor } = require('../main/sync/engine');

function parseArgs(argv) {
    const args = {
        dryRun: false,
        limit: 25,
        full: false
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--dry-run') {
            args.dryRun = true;
        } else if (arg === '--full') {
            args.full = true;
        } else if (arg === '--limit') {
            args.limit = Math.max(1, Math.min(500, Number(argv[++i]) || args.limit));
        } else if (arg.startsWith('--limit=')) {
            args.limit = Math.max(1, Math.min(500, Number(arg.slice('--limit='.length)) || args.limit));
        }
    }

    return args;
}

function mask(value, visible = 4) {
    const text = String(value || '').trim();
    if (!text) return null;
    if (text.length <= visible * 2) return '*'.repeat(text.length);
    return `${text.slice(0, visible)}...${text.slice(-visible)}`;
}

function readConfigSnapshot(db) {
    const config = db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
    const counts = {
        pendingOutbox: db.prepare("SELECT COUNT(*) AS count FROM sync_outbox WHERE status = 'pending'").get().count || 0,
        failedOutbox: db.prepare("SELECT COUNT(*) AS count FROM sync_outbox WHERE status = 'failed'").get().count || 0,
        unresolvedConflicts:
            db.prepare("SELECT COUNT(*) AS count FROM sync_conflicts WHERE status = 'unresolved'").get().count || 0
    };

    return { config, counts };
}

function summarizeConfig(config, counts) {
    return {
        enabled: !!config.enabled,
        schoolId: config.school_id || null,
        firebaseProjectId: config.firebase_project_id || null,
        firebaseFunctionsUrl: config.firebase_functions_url || null,
        firebaseEmail: mask(config.firebase_email, 3),
        hasStoredCredential: !!config.firebase_credential,
        pullCursor: config.pull_cursor || null,
        lastPullAt: config.last_pull_at || null,
        lastPullError: config.last_pull_error || null,
        lastPushAt: config.last_push_at || null,
        lastPushError: config.last_push_error || null,
        pendingOutbox: counts.pendingOutbox,
        failedOutbox: counts.failedOutbox,
        unresolvedConflicts: counts.unresolvedConflicts
    };
}

function summarizeFirebaseConfig(status) {
    const config = status.config || {};
    return {
        projectId: config.projectId || null,
        apiKey: mask(config.apiKey),
        appId: mask(config.appId),
        authDomain: config.authDomain || null,
        sources: status.sources,
        missingForProject: status.missingForProject,
        missingForAuth: status.missingForAuth
    };
}

function tableForEntityType(entityType) {
    return Object.keys(ENTITY_TYPE_REGISTRY).find(
        (tableName) => ENTITY_TYPE_REGISTRY[tableName].entityType === entityType
    ) || null;
}

function summarizeRemoteItem(item) {
    return {
        id: item.id,
        updatedAt: item.updatedAt || null,
        operation: item.operation || null,
        entityType: item.entityType || null,
        tableName: tableForEntityType(item.entityType),
        rowSyncId: item.rowSyncId || null,
        deviceHash: item.deviceHash || null,
        version: item.version || null,
        schoolYear: item.schoolYear || null,
        dataKeys: item.data && typeof item.data === 'object' ? Object.keys(item.data).sort() : []
    };
}

function countBy(items, selector) {
    return items.reduce((acc, item) => {
        const key = selector(item) || '(missing)';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
}

function withTimeout(promise, timeoutMs, label) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
    });

    return Promise.race([promise, timeout]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const firestoreTimeoutMs = Math.max(5000, Number(process.env.SYNC_DEBUG_TIMEOUT_MS) || 30000);
    await app.whenReady();

    const db = initDatabase();
    console.log('[debug:sync-download] DB path:', getDbPath());

    const before = readConfigSnapshot(db);
    console.log('[debug:sync-download] Local sync state before pull:');
    console.log(JSON.stringify(summarizeConfig(before.config, before.counts), null, 2));

    const firebaseStatus = getFirebaseConfigStatus();
    console.log('[debug:sync-download] Firebase client config:');
    console.log(JSON.stringify(summarizeFirebaseConfig(firebaseStatus), null, 2));

    if (!before.config.enabled) {
        console.warn('[debug:sync-download] Sync is disabled in sync_config.');
    }

    if (!before.config.school_id) {
        throw new Error('sync_config.school_id is missing');
    }

    console.log('[debug:sync-download] Restoring Firebase session if possible...');
    await restoreFirebaseSession();
    const credentials = await getCredentials();
    if (!credentials) {
        throw new Error('No Firebase credentials available. Sign in from the app first, then rerun this script.');
    }

    console.log('[debug:sync-download] Auth session:', {
        schoolId: credentials.schoolId,
        userEmail: credentials.user?.email || null,
        expiresAt: credentials.expiresAt
    });

    const firestoreDb = getFirestoreDb();
    if (!firestoreDb) {
        throw new Error('Firestore client is not initialized');
    }

    const schoolId = before.config.school_id || credentials.schoolId;
    const cursor = args.full ? { updatedAt: 0, changeId: '' } : parsePullCursor(before.config.pull_cursor);
    const currentDeviceHash = getDeviceHash();
    const localDeviceHash = currentDeviceHash.substring(0, 16);

    console.log('[debug:sync-download] Pull preview request:', {
        schoolId,
        cursor: serializePullCursor(cursor),
        limit: args.limit,
        localDeviceHash,
        full: args.full
    });

    const remoteItems = await withTimeout(
        pullChanges(firestoreDb, schoolId, cursor, args.limit),
        firestoreTimeoutMs,
        'Firestore syncLog preview fetch'
    );
    const fromThisDevice = remoteItems.filter((item) => item.deviceHash === localDeviceHash).length;
    const unknownEntityTypes = remoteItems
        .filter((item) => !tableForEntityType(item.entityType))
        .map((item) => item.entityType || '(missing)');

    console.log('[debug:sync-download] Remote preview summary:');
    console.log(
        JSON.stringify(
            {
                fetched: remoteItems.length,
                fromThisDevice,
                downloadable: remoteItems.length - fromThisDevice,
                byEntityType: countBy(remoteItems, (item) => item.entityType),
                byOperation: countBy(remoteItems, (item) => item.operation),
                unknownEntityTypes: [...new Set(unknownEntityTypes)]
            },
            null,
            2
        )
    );

    for (const item of remoteItems.slice(0, Math.min(args.limit, 25))) {
        console.log('[debug:sync-download] remote item:', JSON.stringify(summarizeRemoteItem(item)));
    }

    if (args.dryRun) {
        console.log('[debug:sync-download] Dry run only. No local rows were changed.');
        return;
    }

    console.log('[debug:sync-download] Running normal pullRemoteChanges()...');
    const result = await pullRemoteChanges();
    console.log('[debug:sync-download] Pull result:');
    console.log(JSON.stringify(result, null, 2));

    const after = readConfigSnapshot(getDb());
    console.log('[debug:sync-download] Local sync state after pull:');
    console.log(JSON.stringify(summarizeConfig(after.config, after.counts), null, 2));
}

main()
    .then(() => {
        try {
            getDb().close();
        } catch {
            // Ignore shutdown cleanup errors in the debug runner.
        }
        app.exit(0);
    })
    .catch((err) => {
        console.error('[debug:sync-download] Failed:', err);
        try {
            getDb().close();
        } catch {
            // Ignore shutdown cleanup errors in the debug runner.
        }
        app.exit(1);
    });
