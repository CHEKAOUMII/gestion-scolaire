'use strict';

const { authErrorResponse, handleRead, handleWrite } = require('./ipc-helpers');
const { requireRole } = require('./auth');
const { getDb } = require('../db/context');
const { applySyncDefaults } = require('../sync/defaults');
const {
    flushSyncOutbox,
    pullRemoteChanges,
    restartSyncPushBackground,
    restartSyncPullBackground,
    isPushTimerRunning,
    isPullTimerRunning,
    isPushCycleRunning,
    isPullCycleRunning
} = require('../sync/engine');
const { isAuthenticated, testConnection, resolveSyncSchoolId } = require('../sync/credentials');
const { isSnapshotRunning, runSnapshotCycle, restartSnapshotBackground } = require('../sync/snapshot');

const SYNC_ADMIN_ROLES = ['admin'];
const SYNC_NUMBER_LIMITS = {
    syncIntervalMinutes: { min: 1, max: 30 },
    pushBatchSize: { min: 1, max: 1000 },
    maxRetries: { min: 0, max: 50 },
    retentionDays: { min: 1, max: 365 },
    snapshotIntervalMinutes: { min: 5, max: 1440 }
};

function handleAdminRead(ipcMain, channel, handler) {
    ipcMain.handle(channel, async (event, ...args) => {
        try {
            requireRole(event, SYNC_ADMIN_ROLES);
            const db = getDb();
            return await handler(db, ...args);
        } catch (err) {
            return authErrorResponse(err);
        }
    });
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
            .get() || null
    );
}

function getSyncConfig(db) {
    const config = readSyncConfig(db);
    if (!config) return null;

    const syncDefaults = applySyncDefaults(config);
    const configured = !!(
        resolveSyncSchoolId(config) &&
        (syncDefaults.firebaseFunctionsUrl || '').trim() &&
        (syncDefaults.firebaseProjectId || '').trim()
    );

    return {
        enabled: configured && !!config.enabled,
        configured,
        syncIntervalMinutes: config.sync_interval_minutes || 10,
        firebaseFunctionsUrl: syncDefaults.firebaseFunctionsUrl,
        firebaseProjectId: syncDefaults.firebaseProjectId,
        firebaseApiKey: config.firebase_api_key || null,
        firebaseAuthDomain: config.firebase_auth_domain || null,
        firebaseAppId: config.firebase_app_id || null,
        pushBatchSize: config.push_batch_size || 100,
        maxRetries: config.max_retries || 10,
        retentionDays: config.retention_days || 7
    };
}

function validateSyncNumber(key, value, limits) {
    if (!Number.isInteger(value) || value < limits.min || value > limits.max) {
        return `${key} must be between ${limits.min} and ${limits.max}`;
    }
    return null;
}

function normalizeSyncConfigUpdates(updates) {
    const normalizedUpdates = { ...updates };
    if (normalizedUpdates.firebaseFunctionsUrl === undefined && normalizedUpdates.authLambdaUrl !== undefined) {
        normalizedUpdates.firebaseFunctionsUrl = normalizedUpdates.authLambdaUrl;
    }

    for (const [key, limits] of Object.entries(SYNC_NUMBER_LIMITS)) {
        if (normalizedUpdates[key] === undefined) continue;
        const numericValue = Number(normalizedUpdates[key]);
        const error = validateSyncNumber(key, numericValue, limits);
        if (error) return { error };
        normalizedUpdates[key] = numericValue;
    }

    return { updates: normalizedUpdates };
}

function registerSyncIpc(ipcMain) {
    handleAdminRead(ipcMain, 'sync:getConfig', getSyncConfig);

    handleRead(ipcMain, 'sync:getStatus', (db) => {
        const config = readSyncConfig(db);
        const pendingCount = db
            .prepare("SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'pending'")
            .get().count;
        const failedCount = db.prepare("SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'failed'").get().count;
        const conflictCount = db
            .prepare("SELECT COUNT(*) as count FROM sync_conflicts WHERE status = 'unresolved'")
            .get().count;

        const syncDefaults = applySyncDefaults(config || {});
        const configured = !!(
            resolveSyncSchoolId(config || {}) &&
            (syncDefaults.firebaseFunctionsUrl || '').trim() &&
            (syncDefaults.firebaseProjectId || '').trim()
        );
        return {
            enabled: configured && (config ? !!config.enabled : false),
            configured,
            pushRunning: isPushTimerRunning(),
            pullRunning: isPullTimerRunning(),
            // True only during an actively running cycle (not merely when the timer is
            // installed). The UI drives its spinning 'syncing' state from these so a
            // stalled engine (timer still installed but every cycle failing with
            // permission-denied) doesn't spin forever — it falls through to the `error`
            // branch and shows the translated message.
            pushCycleActive: isPushCycleRunning(),
            pullCycleActive: isPullCycleRunning(),
            lastPushAt: config ? config.last_push_at : null,
            lastPullAt: config ? config.last_pull_at : null,
            lastPushError: config ? config.last_push_error : null,
            lastPullError: config ? config.last_pull_error : null,
            pendingCount,
            failedCount,
            conflictCount,
            pullCursor: config ? config.pull_cursor : null,
            authenticated: isAuthenticated(),
            snapshotRunning: isSnapshotRunning(),
            lastSnapshotAt: config ? config.last_snapshot_at || null : null,
            lastSnapshotError: config ? config.last_snapshot_error || null : null,
            snapshotIntervalMinutes: config ? Number(config.snapshot_interval_minutes) || 30 : 30
        };
    });

    // ── Write channels (admin-only) ──

    handleWrite(ipcMain, 'sync:setConfig', ['admin'], (db, _event, updates) => {
        if (!updates || typeof updates !== 'object') {
            return { success: false, error: 'Invalid updates' };
        }

        const normalizedResult = normalizeSyncConfigUpdates(updates);
        if (normalizedResult.error) {
            return { success: false, error: normalizedResult.error };
        }
        const normalizedUpdates = normalizedResult.updates;

        const fieldMap = {
            enabled: 'enabled',
            syncIntervalMinutes: 'sync_interval_minutes',
            firebaseFunctionsUrl: 'firebase_functions_url',
            firebaseProjectId: 'firebase_project_id',
            firebaseApiKey: 'firebase_api_key',
            firebaseAuthDomain: 'firebase_auth_domain',
            firebaseAppId: 'firebase_app_id',
            // NOTE: schoolId/school_id is deliberately excluded — it is the immutable,
            // server-generated tenant key and may only ever be written by
            // institution:setup-new or institution:relink. Any schoolId present in the
            // incoming payload is silently ignored here.
            pushBatchSize: 'push_batch_size',
            maxRetries: 'max_retries',
            retentionDays: 'retention_days',
            snapshotIntervalMinutes: 'snapshot_interval_minutes'
        };

        const setClauses = [];
        const values = [];
        for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
            if (normalizedUpdates[jsKey] !== undefined) {
                setClauses.push(`${dbCol} = ?`);
                values.push(normalizedUpdates[jsKey]);
            }
        }

        if (setClauses.length === 0) {
            return { success: false, error: 'No valid fields to update' };
        }

        setClauses.push('updated_at = CURRENT_TIMESTAMP');
        db.prepare(`UPDATE sync_config SET ${setClauses.join(', ')} WHERE id = 1`).run(...values);

        restartSyncPushBackground();
        restartSyncPullBackground();
        restartSnapshotBackground();

        return { success: true };
    });

    handleWrite(ipcMain, 'sync:triggerNow', ['admin'], async (db, _event) => {
        const config = readSyncConfig(db);
        const syncDefaults = applySyncDefaults(config || {});
        if (!config || !resolveSyncSchoolId(config) || !syncDefaults.firebaseFunctionsUrl) {
            return { success: false, push: null, pull: null, snapshot: null, error: 'Sync is not configured' };
        }

        let pushResult = null;
        let pullResult = null;
        let snapshot = null;
        let error = null;

        try {
            pushResult = await flushSyncOutbox();
        } catch (err) {
            error = 'Push failed: ' + err.message;
        }

        try {
            pullResult = await pullRemoteChanges();
        } catch (err) {
            error = (error ? error + '; ' : '') + 'Pull failed: ' + err.message;
        }

        try {
            snapshot = await runSnapshotCycle();
        } catch (err) {
            snapshot = { success: false, lastError: err.message };
        }

        return {
            success: !error,
            push: pushResult,
            pull: pullResult,
            snapshot,
            error
        };
    });

    handleAdminRead(ipcMain, 'sync:getConflictLog', (db, options) => {
        const opts = options || {};
        const status = opts.status || 'all';
        const limit = Math.min(Number(opts.limit) || 50, 200);
        const offset = Number(opts.offset) || 0;

        let query = 'SELECT * FROM sync_conflicts';
        const params = [];

        if (status === 'unresolved' || status === 'resolved') {
            query += ' WHERE status = ?';
            params.push(status);
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const rows = db.prepare(query).all(...params);

        return rows.map((row) => {
            let ancestorData = null;
            try {
                ancestorData = row.ancestor_data ? JSON.parse(row.ancestor_data) : null;
            } catch {
                ancestorData = row.ancestor_data;
            }

            let conflictingFields = [];
            try {
                conflictingFields = row.conflicting_fields ? JSON.parse(row.conflicting_fields) : [];
            } catch {
                conflictingFields = [];
            }

            let resolvedData = null;
            try {
                resolvedData = row.resolved_data ? JSON.parse(row.resolved_data) : null;
            } catch {
                resolvedData = row.resolved_data;
            }

            return {
                id: row.id,
                tableName: row.table_name,
                rowSyncId: row.row_sync_id,
                entityType: row.entity_type,
                localData: row.local_data ? JSON.parse(row.local_data) : null,
                remoteData: row.remote_data ? JSON.parse(row.remote_data) : null,
                remoteVersion: row.remote_version,
                remoteDeviceHash: row.remote_device_hash,
                status: row.status,
                resolution: row.resolution,
                resolvedAt: row.resolved_at,
                createdAt: row.created_at,
                ancestorData,
                conflictingFields,
                resolutionMethod: row.resolution_method || null,
                resolvedData
            };
        });
    });

    handleAdminRead(ipcMain, 'sync:getConflictForensics', (_db, options) => {
        const { analyzeConflictForensics } = require('../sync/conflict-forensics');
        return analyzeConflictForensics(options || {});
    });

    handleWrite(ipcMain, 'sync:resolveConflict', ['admin'], (db, _event, payload) => {
        if (!payload || !payload.conflictId || !payload.resolution) {
            return { success: false, error: 'Missing conflictId or resolution' };
        }

        const conflict = db.prepare('SELECT * FROM sync_conflicts WHERE id = ?').get(payload.conflictId);
        if (!conflict) {
            return { success: false, error: 'Conflict not found' };
        }

        if (conflict.status === 'resolved') {
            return { success: false, error: 'Conflict already resolved' };
        }

        if (payload.resolution !== 'local' && payload.resolution !== 'remote') {
            return { success: false, error: 'Resolution must be "local" or "remote"' };
        }

        db.prepare(
            'UPDATE sync_conflicts SET status = ?, resolution = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).run('resolved', payload.resolution, payload.conflictId);

        // Update ancestor_data and resolved_data for the chosen resolution
        const chosenData = payload.resolution === 'local' ? conflict.local_data : conflict.remote_data;
        db.prepare(
            `
            UPDATE sync_conflicts
            SET resolved_data = ?, resolution_method = 'manual'
            WHERE id = ?
        `
        ).run(chosenData, payload.conflictId);

        if (conflict.row_sync_id) {
            db.prepare('UPDATE sync_id_map SET ancestor_data = ? WHERE row_sync_id = ?').run(
                chosenData,
                conflict.row_sync_id
            );
        }

        if (payload.resolution === 'local' && conflict.local_data) {
            db.prepare(
                `
                INSERT INTO sync_outbox(table_name, row_sync_id, operation, row_data, school_year, status)
                VALUES(?, ?, 'PUT', ?, ?, 'pending')
            `
            ).run(conflict.table_name, conflict.row_sync_id, conflict.local_data, null);
        }

        return { success: true };
    });

    handleWrite(ipcMain, 'sync:testConnection', ['admin'], async (_db, _event) => {
        return await testConnection();
    });
}

module.exports = { registerSyncIpc };
