// Sync snapshot checker - Phase 5: periodic re-snapshot to detect drift

const { getDb } = require('../db/context');
const { ensureSyncIdMapping, stripSensitiveFields, recordOutboxEntry, SENSITIVE_FIELDS } = require('./capture');
const { isPullCycleRunning } = require('./engine');
const { computeRowChecksum } = require('./merge');
const { resolveSyncSchoolId } = require('./credentials');
const { getSnapshotTables, resolveLocalId } = require('./entity-registry');

let _snapshotTimer = null;
let _snapshotRunning = false;

function buildSnapshotResult(overrides = {}) {
    return {
        success: true,
        skipped: false,
        reason: null,
        tablesChecked: 0,
        changesDetected: 0,
        enqueued: 0,
        pruned: 0,
        lastError: null,
        ...overrides
    };
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
            .get() || {}
    );
}

function snapshotTable(db, tableName) {
    let changesDetected = 0;
    let enqueued = 0;

    const rows = db.prepare(`SELECT * FROM "${tableName}"`).all();
    const currentRowSyncIds = new Set();

    for (const row of rows) {
        const localId = resolveLocalId(tableName, row);
        if (localId == null) continue;

        const rowSyncId = ensureSyncIdMapping(db, tableName, localId);
        currentRowSyncIds.add(rowSyncId);

        const cleanRow = stripSensitiveFields({ ...row });
        const checksum = computeRowChecksum(cleanRow, SENSITIVE_FIELDS);

        const stored = db.prepare('SELECT checksum FROM sync_snapshots WHERE row_sync_id = ?').get(rowSyncId);

        if (!stored || stored.checksum !== checksum) {
            changesDetected++;
            recordOutboxEntry(db, tableName, localId, 'PUT', stripSensitiveFields({ ...row }), row.school_year || '');
            enqueued++;
            db.prepare(
                `INSERT INTO sync_snapshots(row_sync_id, table_name, checksum, updated_at)
                 VALUES(?, ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(row_sync_id) DO UPDATE SET checksum = ?, updated_at = CURRENT_TIMESTAMP`
            ).run(rowSyncId, tableName, checksum, checksum);
        }
    }

    const storedSnapshots = db.prepare('SELECT row_sync_id FROM sync_snapshots WHERE table_name = ?').all(tableName);
    for (const stored of storedSnapshots) {
        if (!currentRowSyncIds.has(stored.row_sync_id)) {
            changesDetected++;
            const mapping = db
                .prepare('SELECT local_id FROM sync_id_map WHERE row_sync_id = ?')
                .get(stored.row_sync_id);
            if (mapping) {
                recordOutboxEntry(db, tableName, mapping.local_id, 'DEL', null, '');
            }
            enqueued++;
            db.prepare('DELETE FROM sync_snapshots WHERE row_sync_id = ?').run(stored.row_sync_id);
        }
    }

    return { changesDetected, enqueued };
}

function pruneResolvedConflicts(db) {
    return db
        .prepare("DELETE FROM sync_conflicts WHERE status = 'resolved' AND resolved_at < datetime('now', '-30 days')")
        .run().changes;
}

async function runSnapshotCycle() {
    if (_snapshotRunning) return buildSnapshotResult({ skipped: true, reason: 'already_running' });
    if (isPullCycleRunning()) return buildSnapshotResult({ skipped: true, reason: 'pull_in_progress' });

    _snapshotRunning = true;
    let tablesChecked = 0;
    let changesDetected = 0;
    let enqueued = 0;
    console.log('[sync:snapshot] Snapshot cycle starting...');

    try {
        const db = getDb();
        const config = readSyncConfig(db);
        if (!Number(config.enabled) || !resolveSyncSchoolId(config)) {
            return buildSnapshotResult({ skipped: true, reason: 'disabled' });
        }

        for (const tableName of getSnapshotTables()) {
            try {
                tablesChecked++;
                const result = snapshotTable(db, tableName);
                changesDetected += result.changesDetected;
                enqueued += result.enqueued;
            } catch (_tableErr) {
                console.warn(`[sync:snapshot] Error checking table '${tableName}':`, _tableErr.message);
            }
        }

        const pruned = pruneResolvedConflicts(db);
        db.prepare(
            'UPDATE sync_config SET last_snapshot_at = CURRENT_TIMESTAMP, last_snapshot_error = NULL WHERE id = 1'
        ).run();

        if (changesDetected > 0) {
            console.log(
                `[sync:snapshot] Completed: ${tablesChecked} tables checked, ${changesDetected} changes detected, ${enqueued} enqueued, ${pruned} pruned`
            );
        }
        return buildSnapshotResult({ tablesChecked, changesDetected, enqueued, pruned });
    } catch (err) {
        console.error('[sync:snapshot] Snapshot cycle failed:', err.message);
        try {
            const db = getDb();
            db.prepare('UPDATE sync_config SET last_snapshot_error = ? WHERE id = 1').run(err.message);
        } catch (dbErr) {
            console.warn('[sync:snapshot] Failed to record snapshot error in DB:', dbErr.message);
        }
        return buildSnapshotResult({
            success: false,
            tablesChecked,
            changesDetected,
            enqueued,
            lastError: err.message
        });
    } finally {
        _snapshotRunning = false;
    }
}

function isSnapshotRunning() {
    return _snapshotRunning;
}

function startSnapshotBackground() {
    if (_snapshotTimer) return;

    try {
        const db = getDb();
        const config = readSyncConfig(db);
        if (!Number(config.enabled) || !resolveSyncSchoolId(config)) return;

        // Run an immediate cycle
        void runSnapshotCycle();

        const intervalMinutes = Math.max(10, Math.min(120, Number(config.snapshot_interval_minutes) || 30));
        const intervalMs = intervalMinutes * 60 * 1000;

        _snapshotTimer = setInterval(() => {
            void runSnapshotCycle();
        }, intervalMs);

        if (typeof _snapshotTimer.unref === 'function') {
            _snapshotTimer.unref();
        }

        console.log(`[sync:snapshot] Background snapshot started (interval: ${intervalMinutes}min)`);
    } catch (err) {
        console.warn('[sync:snapshot] Failed to start snapshot background:', err.message);
    }
}

function stopSnapshotBackground() {
    if (_snapshotTimer) {
        clearInterval(_snapshotTimer);
        _snapshotTimer = null;
        console.log('[sync:snapshot] Background snapshot stopped');
    }
}

function restartSnapshotBackground() {
    stopSnapshotBackground();
    startSnapshotBackground();
}

module.exports = {
    runSnapshotCycle,
    isSnapshotRunning,
    startSnapshotBackground,
    stopSnapshotBackground,
    restartSnapshotBackground
};
