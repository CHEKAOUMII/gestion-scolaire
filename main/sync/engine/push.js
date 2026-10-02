'use strict';

/** Push orchestration: outbox drain, batching, rate limits, lifecycle (WP3). */

const { getDb } = require('../../db/context');
const { getCredentials, clearCredentials, testConnection, resolveSyncSchoolId, hasLiveFirebaseUser } = require('../credentials');
const { getDeviceHash } = require('../capture');
const { canPush, ENTITY_TYPE_REGISTRY } = require('../authority');
const { threeWayMerge } = require('../merge');
const { logConflictForensics } = require('../conflict-forensics');
const { expandBulkEntry: expandBulkEntryTyped } = require('./expand-bulk');
const state = require('./state');
const helpers = require('./helpers');
const outbox = require('./outbox');
const docBuild = require('./doc-build');
const transport = require('../transport/firestore');

const {
    readSyncConfig,
    resolvePushTuning,
    resolveDrainLimit,
    createRateLimiter,
    isAssertionOrAuthNetworkError,
    isConnectivityWarmupNetworkError,
    runConcurrentGroup,
    sortOutboxRowsForPush,
    sortPreparedItemsForPush,
    hasMultipleTopologyRanks,
    getTopologyRank,
    shouldScheduleFollowupPush,
    computePushThroughput
} = helpers;

const {
    markEntrySent,
    markEntryFailed,
    reopenVersionConflictOutbox,
    recordPushMeta,
    compactPendingOutbox,
    reopenRecoverableOutbox,
    reopenUnbuildableDeletes,
    readPendingOutboxBatch,
    bumpRetryCount
} = outbox;

const { buildFirestoreDoc, stripRemoteSyncMetadata } = docBuild;

const {
    writeItemWithVersionCheck,
    runBatchedFastPath,
    writeSyncLogWithRetry,
    getFirestoreDb,
    recoverFirestoreClient
} = transport;


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
    if (state.backlogPushTimer) {
        return;
    }

    state.backlogPushTimer = setTimeout(() => {
        state.backlogPushTimer = null;
        if (state.flushRunning) {
            scheduleBacklogPush();
            return;
        }
        void flushSyncOutbox().catch((err) => {
            console.warn('[sync:push] Backlog push failed:', err.message);
        });
    }, state.BACKLOG_PUSH_DELAY_MS);

    if (typeof state.backlogPushTimer.unref === 'function') {
        state.backlogPushTimer.unref();
    }
}

function getCurrentRole() {
    try {
        const { resolveRole } = require('../../auth/permissions');
        const { getActiveSessions } = require('../../ipc/auth');
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

function expandBulkEntry(db, entry, deviceHash) {
    return expandBulkEntryTyped(db, entry, deviceHash);
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
        const expansion = expandBulkEntry(db, row, deviceHash);
        const status = expansion && expansion.status;
        const expandedEntries = (expansion && expansion.entries) || [];

        if (status === 'error') {
            const errMsg = expansion.error || 'Bulk expansion failed';
            markEntryFailed(db, row.id, errMsg, maxRetries);
            ctx.failedCount += 1;
            ctx.lastError = errMsg;
            return 'continue';
        }

        if (status === 'empty' || expandedEntries.length === 0) {
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
    if (state.flushRunning) return { success: true, skipped: true, reason: 'already_running' };
    state.flushRunning = true;
    const authEpochAtStart = state.getSyncAuthEpoch();
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
        const authTransitionDuringCycle = state.getSyncAuthEpoch() !== authEpochAtStart;
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
        state.flushRunning = false;
    }
}

function installUnhandledRejectionHandler() {
    if (state.unhandledRejectionHandlerInstalled) return;
    state.unhandledRejectionHandlerInstalled = true;

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
    if (state.syncTimer) return;

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

        state.syncTimer = setInterval(() => {
            void flushSyncOutbox();
        }, intervalMs);

        if (typeof state.syncTimer.unref === 'function') {
            state.syncTimer.unref();
        }

        console.log(`[sync:push] Background push started (interval: ${intervalMinutes}min)`);
    } catch (err) {
        console.warn('[sync:push] Failed to start push background:', err.message);
    }
}

function stopSyncPushBackground() {
    if (state.syncTimer) {
        clearInterval(state.syncTimer);
        state.syncTimer = null;
        console.log('[sync:push] Background push stopped');
    }
    if (state.backlogPushTimer) {
        clearTimeout(state.backlogPushTimer);
        state.backlogPushTimer = null;
    }
}

function restartSyncPushBackground() {
    stopSyncPushBackground();
    startSyncPushBackground();
}

module.exports = {
    recoverCloudSessionAfterPermissionDenied,
    scheduleBacklogPush,
    getCurrentRole,
    logVersionConflict,
    reconcileUnreconciledRow,
    applyItemOutcome,
    flushPreparedItems,
    flushPreparedItemsConcurrent,
    expandBulkEntry,
    flushExpandedEntries,
    processOutboxRow,
    flushSyncOutbox,
    installUnhandledRejectionHandler,
    startSyncPushBackground,
    stopSyncPushBackground,
    restartSyncPushBackground,
    writeItemWithVersionCheck,
    runBatchedFastPath,
    writeSyncLogWithRetry
};
