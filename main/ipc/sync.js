'use strict';

const { handleRead, handleWrite } = require('./ipc-helpers');
const {
    flushSyncOutbox,
    pullRemoteChanges,
    restartSyncPushBackground,
    restartSyncPullBackground,
    isPushTimerRunning,
    isPullTimerRunning
} = require('../sync/engine');
const { isAuthenticated } = require('../sync/credentials');
const { isSnapshotRunning, runSnapshotCycle, restartSnapshotBackground } = require('../sync/snapshot');

function registerSyncIpc(ipcMain) {
    // ── Read channels (no auth required) ──

    handleRead(ipcMain, 'sync:getConfig', (db) => {
        const config = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
        if (!config) return null;
        return {
            enabled: !!config.enabled,
            syncIntervalMinutes: config.sync_interval_minutes || 10,
            awsRegion: config.aws_region || 'us-east-1',
            authLambdaUrl: config.auth_lambda_url || null,
            schoolId: config.school_id || null,
            pushBatchSize: config.push_batch_size || 100,
            maxRetries: config.max_retries || 10,
            retentionDays: config.retention_days || 7
        };
    });

    handleRead(ipcMain, 'sync:getStatus', (db) => {
        const config = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
        const pendingCount = db
            .prepare("SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'pending'")
            .get().count;
        const failedCount = db.prepare("SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'failed'").get().count;
        const conflictCount = db
            .prepare("SELECT COUNT(*) as count FROM sync_conflicts WHERE status = 'unresolved'")
            .get().count;

        return {
            enabled: config ? !!config.enabled : false,
            pushRunning: isPushTimerRunning(),
            pullRunning: isPullTimerRunning(),
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

        if (updates.syncIntervalMinutes !== undefined) {
            const interval = Number(updates.syncIntervalMinutes);
            if (isNaN(interval) || interval < 1 || interval > 30) {
                return { success: false, error: 'syncIntervalMinutes must be between 1 and 30' };
            }
        }

        const fieldMap = {
            enabled: 'enabled',
            syncIntervalMinutes: 'sync_interval_minutes',
            awsRegion: 'aws_region',
            authLambdaUrl: 'auth_lambda_url',
            schoolId: 'school_id',
            pushBatchSize: 'push_batch_size',
            maxRetries: 'max_retries',
            retentionDays: 'retention_days',
            snapshotIntervalMinutes: 'snapshot_interval_minutes'
        };

        const setClauses = [];
        const values = [];
        for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
            if (updates[jsKey] !== undefined) {
                setClauses.push(`${dbCol} = ?`);
                values.push(updates[jsKey]);
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
        const config = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
        if (!config || !config.enabled) {
            return { success: false, push: null, pull: null, snapshot: null, error: 'Sync is not enabled' };
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

    handleRead(ipcMain, 'sync:getConflictLog', (db, options) => {
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
            } catch (_) {
                ancestorData = row.ancestor_data;
            }

            let conflictingFields = [];
            try {
                conflictingFields = row.conflicting_fields ? JSON.parse(row.conflicting_fields) : [];
            } catch (_) {
                conflictingFields = [];
            }

            let resolvedData = null;
            try {
                resolvedData = row.resolved_data ? JSON.parse(row.resolved_data) : null;
            } catch (_) {
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
}

module.exports = { registerSyncIpc };
