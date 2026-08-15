'use strict';

/**
 * Page role-access repository.
 * Owns SQL for the device-local `page_role_access` matrix (page-access feature).
 * Device-local by design — page access is app configuration, never captured for sync.
 */

// Reserved marker keeps an explicit deny-all override distinguishable from no override.
const OVERRIDE_MARKER = '__override__';

function ensureTable(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS page_role_access (
            page_key TEXT NOT NULL,
            role TEXT NOT NULL,
            allowed INTEGER NOT NULL DEFAULT 1,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (page_key, role)
        );
    `);
}

function listRoleRows(db) {
    ensureTable(db);
    return db.prepare('SELECT page_key, role, allowed FROM page_role_access').all();
}

/**
 * Replace the access rows of each page atomically: delete, re-insert the deny-all
 * marker, then insert the allowed roles. Entries arrive pre-validated (normalized
 * page keys, institution roles only).
 * @param {object} db
 * @param {Array<{pageKey: string, roles: string[]}>} pageEntries
 */
function saveAccess(db, pageEntries) {
    const deleteStmt = db.prepare('DELETE FROM page_role_access WHERE page_key = ?');
    const markerStmt = db.prepare(`
        INSERT INTO page_role_access(page_key, role, allowed, updated_at)
        VALUES(?, ?, 0, CURRENT_TIMESTAMP)
    `);
    const insertStmt = db.prepare(`
        INSERT INTO page_role_access(page_key, role, allowed, updated_at)
        VALUES(?, ?, 1, CURRENT_TIMESTAMP)
    `);

    const tx = db.transaction(() => {
        for (const entry of pageEntries) {
            deleteStmt.run(entry.pageKey);
            markerStmt.run(entry.pageKey, OVERRIDE_MARKER);
            for (const role of entry.roles) {
                insertStmt.run(entry.pageKey, role);
            }
        }
    });
    tx();
}

module.exports = { OVERRIDE_MARKER, ensureTable, listRoleRows, saveAccess };
