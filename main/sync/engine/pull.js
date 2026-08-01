'use strict';

/** Pull orchestration: remote intake, cursors, apply, lifecycle (WP3). */

const { getDb } = require('../../db/context');
const { resolveSyncSchoolId, getCredentials, clearCredentials, hasLiveFirebaseUser } = require('../credentials');
const { getDeviceHash } = require('../capture');
const { COLLECTION_MAP } = require('../../firebase/collections');
const { ENTITY_TYPE_REGISTRY } = require('../authority');
const state = require('./state');
const helpers = require('./helpers');
const apply = require('./apply');
const transport = require('../transport/firestore');

const {
    readSyncConfig,
    parsePullCursor,
    serializePullCursor,
    sortByTopology,
    TOPO_ORDER_PUT,
    pullDebug,
    buildPullFailureSummary,
    loadQuarantinedPullItems,
    countQuarantinedRows,
    summarizePullItem,
    classifyPushError
} = helpers;

const { buildPullResult, mapRemoteItems, hasMissingStudentDependencies, applySingleItem } = apply;

const {
    collection,
    getCountFromServer,
    firestoreLimit,
    onSnapshot,
    orderBy,
    query,
    getFirestoreDb,
    pullChanges,
    bootstrapFromCollections,
    getCollectionPath
} = transport;

function scheduleDebouncedPull() {
    if (state.pullDebounceTimer) {
        clearTimeout(state.pullDebounceTimer);
    }

    state.pullDebounceTimer = setTimeout(() => {
        state.pullDebounceTimer = null;
        void pullRemoteChanges().catch((err) => {
            console.warn('[sync:pull] Debounced pull failed:', err.message);
        });
    }, state.REMOTE_PULL_DEBOUNCE_MS);

    if (typeof state.pullDebounceTimer.unref === 'function') {
        state.pullDebounceTimer.unref();
    }
}

function stopRemoteChangeListener() {
    if (state.pullListenerUnsubscribe) {
        try {
            state.pullListenerUnsubscribe();
        } catch (err) {
            console.warn('[sync:pull] Failed to stop remote change listener:', err.message);
        }
        state.pullListenerUnsubscribe = null;
    }

    if (state.pullDebounceTimer) {
        clearTimeout(state.pullDebounceTimer);
        state.pullDebounceTimer = null;
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

        state.pullListenerUnsubscribe = onSnapshot(
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

async function pullRemoteChanges() {
    if (state.pullRunning) return { success: false, skipped: true };
    state.pullRunning = true;
    const authEpochAtStart = state.getSyncAuthEpoch();
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

        // Replay rows held back by a contract violation on an earlier pull (§9.2). They
        // are merged in before the topological sort so they keep their dependency order,
        // and a row redelivered in this batch wins over its stale quarantined copy.
        const incomingSyncIds = new Set(mapped.map((item) => item.rowSyncId));
        const quarantinedItems = loadQuarantinedPullItems(db)
            .filter((item) => !incomingSyncIds.has(item.rowSyncId))
            .map((item) => ({ ...item, _fromQuarantine: true }));
        if (quarantinedItems.length > 0) {
            mapped = [...quarantinedItems, ...mapped];
            pullDebug('quarantined items queued for replay', { quarantined: quarantinedItems.length });
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

        const stats = {
            appliedCount: 0,
            conflictCount: 0,
            failedCount: 0,
            failures: [],
            quarantinedCount: 0,
            quarantined: []
        };
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
            // Quarantined rows deliberately do NOT hold the cursor: their payload is
            // stored and replayed on every later pull, so advancing loses nothing and
            // keeps unaffected entities syncing on an out-of-date device (§9.2).
            const heldReason =
                stats.quarantinedCount > 0
                    ? 'هذا الجهاز يحتاج تحديثاً لاستقبال بعض البيانات — تم حجز السجلات المتأثرة وسيعاد تطبيقها بعد التحديث'
                    : null;
            db.prepare(
                'UPDATE sync_config SET pull_cursor = ?, last_pull_at = CURRENT_TIMESTAMP, last_pull_error = ? WHERE id = 1'
            ).run(newCursor, heldReason);
            pullDebug('sync_config updated', { newCursor, quarantinedCount: stats.quarantinedCount });
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

        const quarantinedTotal = countQuarantinedRows(db);
        console.log(
            `[sync:pull] Completed: ${allItems.length} fetched, ${stats.appliedCount} applied, ${stats.conflictCount} conflicts, ` +
                `${stats.failedCount} failed, ${stats.quarantinedCount} quarantined (${quarantinedTotal} held total) (${Date.now() - startedAt}ms)`
        );

        return buildPullResult({
            success: stats.failedCount === 0,
            appliedCount: stats.appliedCount,
            skippedCount: skippedCount + (mapped.length - sorted.length),
            conflictCount: stats.conflictCount,
            failedCount: stats.failedCount,
            quarantinedCount: stats.quarantinedCount,
            quarantinedTotal,
            totalFetched: allItems.length,
            newCursor,
            lastError: stats.failedCount > 0 ? buildPullFailureSummary(stats.failedCount, stats.failures) : null,
            failures: stats.failures,
            quarantined: stats.quarantined
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
        if (permissionDenied && (!hasLiveFirebaseUser() || state.getSyncAuthEpoch() !== authEpochAtStart)) {
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
        state.pullRunning = false;
    }
}

function startSyncPullBackground() {
    if (state.pullTimer) return;

    try {
        const db = getDb();
        const config = readSyncConfig(db);
        const schoolId = resolveSyncSchoolId(config);
        if (!config || !config.enabled || !config.firebase_functions_url || !schoolId) return;

        const intervalMs = Math.max(1, Math.min(30, config.sync_interval_minutes || 10)) * 60 * 1000;

        void pullRemoteChanges();
        startRemoteChangeListener(schoolId);

        state.pullTimer = setInterval(async () => {
            const result = await pullRemoteChanges();
            if (result && !result.success && !result.skipped) {
                const retryDelay = setTimeout(() => void pullRemoteChanges(), 5000);
                if (typeof retryDelay.unref === 'function') retryDelay.unref();
            }
        }, intervalMs);

        if (typeof state.pullTimer.unref === 'function') {
            state.pullTimer.unref();
        }

        console.log(
            `[sync:pull] Background pull started (interval: ${Math.max(1, Math.min(30, config.sync_interval_minutes || 10))}min)`
        );
    } catch (err) {
        console.warn('[sync:pull] Failed to start pull background:', err.message);
    }
}

function stopSyncPullBackground() {
    if (state.pullTimer) {
        clearInterval(state.pullTimer);
        state.pullTimer = null;
        console.log('[sync:pull] Background pull stopped');
    }
    stopRemoteChangeListener();
}

function restartSyncPullBackground() {
    stopSyncPullBackground();
    startSyncPullBackground();
}

module.exports = {
    scheduleDebouncedPull,
    stopRemoteChangeListener,
    startRemoteChangeListener,
    bootstrapStudentsForMissingDependencies,
    getRemoteCollectionCount,
    getLocalTableCount,
    bootstrapTablesIfLocalBehind,
    pullRemoteChanges,
    startSyncPullBackground,
    stopSyncPullBackground,
    restartSyncPullBackground
};
