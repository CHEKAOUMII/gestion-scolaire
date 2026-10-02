'use strict';

/** Outbox persistence: mark sent/failed, reopen, compact, batch read (WP3). */

const { getDeviceHash, getDeviceName } = require('../capture');
const { classifyPushError } = require('./helpers');

function updateDeviceHeartbeat(db) {
    try {
        const deviceHash = getDeviceHash();
        if (!deviceHash) return;

        const table = db
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'linked_devices'")
            .get();
        if (!table) return;

        const existing = db.prepare('SELECT id FROM linked_devices WHERE device_hash = ? LIMIT 1').get(deviceHash);
        if (existing) {
            db.prepare(
                `
                UPDATE linked_devices
                SET last_seen_at = CURRENT_TIMESTAMP,
                    status = COALESCE(NULLIF(status, ''), 'active')
                WHERE device_hash = ?
            `
            ).run(deviceHash);
            return;
        }

        db.prepare(
            `
            INSERT INTO linked_devices(device_hash, device_name, os_platform, linked_at, last_seen_at, status)
            VALUES(?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'active')
        `
        ).run(deviceHash, getDeviceName(), process.platform);
    } catch (err) {
        console.warn('[sync] Failed to update device heartbeat:', err.message);
    }
}

function markEntrySent(db, entryId, versionOverride = null, rowSyncId = null, rowData = null) {
    // Read row_sync_id and row_data BEFORE marking sent to avoid TOCTOU with cleanup
    if (!rowSyncId || rowData === null) {
        const entry = db.prepare('SELECT row_sync_id, row_data FROM sync_outbox WHERE id = ?').get(entryId);
        if (entry) {
            rowSyncId = rowSyncId || entry.row_sync_id;
            rowData = rowData !== null ? rowData : entry.row_data;
        }
    }

    // Mark the outbox row sent, bump the id-map version/ancestor, and resolve any linked
    // conflict as one atomic unit (R4). Previously these ran as up to four separate
    // UPDATEs; a crash between the Firestore commit and completing them left the remote
    // holding the change while the local outbox still showed it pending → a duplicate push
    // next cycle. markEntrySent is only ever called from async post-await code (never inside
    // a synchronous better-sqlite3 transaction), so wrapping it here cannot nest.
    const applyMark = db.transaction(() => {
        db.prepare(
            "UPDATE sync_outbox SET status = 'sent', sent_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?"
        ).run(entryId);

        if (rowSyncId) {
            if (versionOverride != null && Number.isFinite(Number(versionOverride))) {
                db.prepare('UPDATE sync_id_map SET version = ?, ancestor_data = ? WHERE row_sync_id = ?').run(
                    Number(versionOverride),
                    rowData,
                    rowSyncId
                );
            } else {
                db.prepare('UPDATE sync_id_map SET version = version + 1, ancestor_data = ? WHERE row_sync_id = ?').run(
                    rowData,
                    rowSyncId
                );
            }
            db.prepare(
                `
                UPDATE sync_conflicts
                SET status = 'resolved',
                    resolution = 'merged',
                    resolved_data = COALESCE(resolved_data, local_data),
                    resolved_at = CURRENT_TIMESTAMP
                WHERE local_outbox_id = ?
                  AND status = 'unresolved'
            `
            ).run(entryId);
        }
    });
    applyMark();
}

function markEntryFailed(db, entryId, error, maxRetries, ignoreMaxRetries = false, forceFailed = false) {
    const entry = db.prepare('SELECT retries FROM sync_outbox WHERE id = ?').get(entryId);
    const retries = Number(entry?.retries || 0);
    const newStatus = forceFailed ? 'failed' : !ignoreMaxRetries && retries >= maxRetries ? 'failed' : 'pending';

    db.prepare(
        'UPDATE sync_outbox SET retries = ?, last_attempt_at = CURRENT_TIMESTAMP, last_error = ?, status = ? WHERE id = ?'
    ).run(retries, error, newStatus, entryId);
}

function reopenVersionConflictOutbox(db) {
    try {
        db.prepare(
            `
            UPDATE sync_outbox
            SET status = 'pending',
                last_error = NULL
            WHERE status = 'failed'
              AND last_error = 'Version conflict'
              AND id IN (
                  SELECT local_outbox_id
                  FROM sync_conflicts
                  WHERE status = 'unresolved'
                    AND local_outbox_id IS NOT NULL
              )
        `
        ).run();
    } catch (err) {
        console.warn('[sync:push] Failed to reopen version-conflict outbox rows:', err.message);
    }
}

function updatePushMeta(db, lastPushAt, lastPushError) {
    // NULL keeps whatever value is currently stored — used by the "don't clobber a
    // meaningful prior error" guard below (a transient later reason like
    // "Failed to obtain credentials" must never overwrite a real PERMISSION_DENIED).
    if (lastPushError === undefined) {
        db.prepare(
            'UPDATE sync_config SET last_push_at = COALESCE(?, last_push_at), updated_at = CURRENT_TIMESTAMP WHERE id = 1'
        ).run(lastPushAt);
        return;
    }
    db.prepare(
        'UPDATE sync_config SET last_push_at = ?, last_push_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
    ).run(lastPushAt, lastPushError);
}

function recordPushMeta(db, lastPushAt, lastPushError) {
    const translated = lastPushError == null ? lastPushError : classifyPushError(lastPushError);
    try {
        updatePushMeta(db, lastPushAt, translated);
    } catch (err) {
        console.error(
            '[sync:push] Failed to persist push meta (last_push_at/last_push_error).',
            'Intended error state:',
            lastPushError,
            '| persistence error:',
            err && err.message
        );
    }
}

function compactPendingOutbox(db) {
    try {
        const result = db
            .prepare(
                `
                UPDATE sync_outbox
                SET status = 'superseded',
                    last_error = NULL
                WHERE status = 'pending'
                  AND id NOT IN (
                      SELECT MAX(id)
                      FROM sync_outbox
                      WHERE status = 'pending'
                      GROUP BY row_sync_id
                  )
            `
            )
            .run();
        if (result.changes > 0) {
            console.log(`[sync:push] Compacted ${result.changes} superseded pending outbox entries`);
        }
        return result.changes || 0;
    } catch (err) {
        console.warn('[sync:push] Pending outbox compaction failed:', err.message);
        return 0;
    }
}

function reopenRecoverableOutbox(db) {
    try {
        const result = db
            .prepare(
                `
                UPDATE sync_outbox
                SET status = 'pending',
                    retries = 0,
                    last_error = NULL
                WHERE (
                    status = 'failed'
                    OR retries >= COALESCE((SELECT max_retries FROM sync_config WHERE id = 1), 10)
                )
                  AND last_error LIKE 'Invalid document reference.%'
            `
            )
            .run();
        if (result.changes > 0) {
            console.log(`[sync:push] Reopened ${result.changes} recoverable document-path failures`);
        }
    } catch (err) {
        console.warn('[sync:push] Failed to reopen recoverable outbox rows:', err.message);
    }
}

function reopenUnbuildableDeletes(db) {
    try {
        const result = db
            .prepare(
                `
                UPDATE sync_outbox
                SET status = 'pending',
                    retries = 0,
                    last_error = NULL
                WHERE operation = 'DEL'
                  AND (
                    status = 'failed'
                    OR retries >= COALESCE((SELECT max_retries FROM sync_config WHERE id = 1), 10)
                  )
                  AND last_error LIKE '%Failed to build document ID%'
            `
            )
            .run();
        if (result.changes > 0) {
            console.log(
                `[sync:push] Reopened ${result.changes} deletion(s) with recoverable document-id build failures`
            );
        }
    } catch (err) {
        console.warn('[sync:push] Failed to reopen unbuildable deletes:', err.message);
    }
}

function readPendingOutboxBatch(db, maxRetries, limit) {
    return db
        .prepare(
            `SELECT *
             FROM sync_outbox
             WHERE status = 'pending'
               AND retries < ?
             ORDER BY id ASC
             LIMIT ?`
        )
        .all(maxRetries, limit);
}

function bumpRetryCount(db, entryId) {
    db.prepare('UPDATE sync_outbox SET retries = retries + 1, last_attempt_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        entryId
    );
}

function readOutboxAncestorData(db, rowSyncId) {
    try {
        const mapping = db.prepare('SELECT ancestor_data FROM sync_id_map WHERE row_sync_id = ?').get(rowSyncId);
        return mapping?.ancestor_data ? JSON.parse(mapping.ancestor_data) : null;
    } catch {
        return null;
    }
}

module.exports = {
    updateDeviceHeartbeat,
    markEntrySent,
    markEntryFailed,
    reopenVersionConflictOutbox,
    updatePushMeta,
    recordPushMeta,
    compactPendingOutbox,
    reopenRecoverableOutbox,
    reopenUnbuildableDeletes,
    readPendingOutboxBatch,
    bumpRetryCount,
    readOutboxAncestorData
};
