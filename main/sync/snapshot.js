// Sync snapshot checker - Phase 5: periodic re-snapshot to detect drift

const { getDb } = require('../db/context');
const { ENTITY_TYPE_REGISTRY } = require('./authority');
const { ensureSyncIdMapping, stripSensitiveFields, recordOutboxEntry, SENSITIVE_FIELDS } = require('./capture');
const { isPullCycleRunning } = require('./engine');
const { computeRowChecksum } = require('./merge');

let _snapshotTimer = null;
let _snapshotRunning = false;

async function runSnapshotCycle() {
    if (_snapshotRunning) {
        return {
            success: true,
            skipped: true,
            reason: 'already_running',
            tablesChecked: 0,
            changesDetected: 0,
            enqueued: 0,
            pruned: 0,
            lastError: null
        };
    }
    if (isPullCycleRunning()) {
        return {
            success: true,
            skipped: true,
            reason: 'pull_in_progress',
            tablesChecked: 0,
            changesDetected: 0,
            enqueued: 0,
            pruned: 0,
            lastError: null
        };
    }

    _snapshotRunning = true;
    let tablesChecked = 0;
    let changesDetected = 0;
    let enqueued = 0;
    let pruned = 0;

    try {
        const db = getDb();
        const config = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
        if (!config || !Number(config.enabled)) {
            return {
                success: true,
                skipped: true,
                reason: 'disabled',
                tablesChecked: 0,
                changesDetected: 0,
                enqueued: 0,
                pruned: 0,
                lastError: null
            };
        }

        const tableNames = Object.keys(ENTITY_TYPE_REGISTRY);

        for (const tableName of tableNames) {
            try {
                tablesChecked++;

                const rows = db.prepare(`SELECT * FROM "${tableName}"`).all();
                const currentRowSyncIds = new Set();

                for (const row of rows) {
                    const localId = row.id ?? row.code ?? row.key;
                    if (localId == null) continue;

                    const rowSyncId = ensureSyncIdMapping(db, tableName, localId);
                    currentRowSyncIds.add(rowSyncId);

                    const cleanRow = stripSensitiveFields({ ...row });
                    const checksum = computeRowChecksum(cleanRow, SENSITIVE_FIELDS);

                    const stored = db
                        .prepare('SELECT checksum FROM sync_snapshots WHERE row_sync_id = ?')
                        .get(rowSyncId);

                    if (!stored || stored.checksum !== checksum) {
                        changesDetected++;
                        const schoolYear = row.school_year || '';
                        recordOutboxEntry(db, tableName, localId, 'PUT', stripSensitiveFields({ ...row }), schoolYear);
                        enqueued++;

                        db.prepare(
                            `
                            INSERT INTO sync_snapshots(row_sync_id, table_name, checksum, updated_at)
                            VALUES(?, ?, ?, CURRENT_TIMESTAMP)
                            ON CONFLICT(row_sync_id) DO UPDATE SET checksum = ?, updated_at = CURRENT_TIMESTAMP
                        `
                        ).run(rowSyncId, tableName, checksum, checksum);
                    }
                }

                // Detect deletions — snapshot entries with no matching DB row
                const storedSnapshots = db
                    .prepare('SELECT row_sync_id FROM sync_snapshots WHERE table_name = ?')
                    .all(tableName);
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
            } catch (_tableErr) {
                // One table's failure doesn't abort the cycle
                console.warn(`[sync:snapshot] Error checking table '${tableName}':`, _tableErr.message);
            }
        }

        // Prune old resolved conflicts
        pruned = db
            .prepare(
                `
            DELETE FROM sync_conflicts
            WHERE status = 'resolved' AND resolved_at < datetime('now', '-30 days')
        `
            )
            .run().changes;

        // Update sync_config
        db.prepare(
            'UPDATE sync_config SET last_snapshot_at = CURRENT_TIMESTAMP, last_snapshot_error = NULL WHERE id = 1'
        ).run();

        return { success: true, tablesChecked, changesDetected, enqueued, pruned, lastError: null };
    } catch (err) {
        try {
            const db = getDb();
            db.prepare('UPDATE sync_config SET last_snapshot_error = ? WHERE id = 1').run(err.message);
        } catch {
            /* ignore */
        }
        return { success: false, tablesChecked, changesDetected, enqueued, pruned: 0, lastError: err.message };
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
        const config = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
        if (!config || !Number(config.enabled)) return;

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
