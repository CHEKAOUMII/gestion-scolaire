'use strict';

/**
 * System logs repository.
 * Owns SQL queries and mutations for the `system_logs` table.
 */

function listLogs(db, limit = 200) {
    return db
        .prepare(
            `
            SELECT * FROM system_logs
            ORDER BY id DESC
            LIMIT ?
        `
        )
        .all(limit);
}

function insertLog(db, action, details, entityType, entityId) {
    return db
        .prepare(
            `
            INSERT INTO system_logs(action, details, entity_type, entity_id)
            VALUES(?, ?, ?, ?)
        `
        )
        .run(action, details || null, entityType, entityId || null);
}

module.exports = { listLogs, insertLog };
