'use strict';

/**
 * Page visibility repository.
 * Owns SQL for the device-local `page_visibility` map; IPC stays auth,
 * pageKey validation, and response mapping. Device-local by design —
 * page visibility is app configuration, never captured for sync.
 */

function listVisibilityRows(db) {
    return db.prepare('SELECT page_key, is_visible FROM page_visibility').all();
}

function setVisibility(db, pageKey, isVisible) {
    db.prepare(
        `
        INSERT INTO page_visibility(page_key, is_visible, updated_at)
        VALUES(?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(page_key)
        DO UPDATE SET is_visible = excluded.is_visible, updated_at = CURRENT_TIMESTAMP
    `
    ).run(pageKey, isVisible);
}

module.exports = { listVisibilityRows, setVisibility };
