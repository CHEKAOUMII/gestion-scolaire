const { getDb } = require('../db/context');
const { ensureNotificationsSchema } = require('../db/schema');

function init() {
    // Single source of truth for the notifications DDL lives in db/schema.js (R5).
    ensureNotificationsSchema(getDb());
}

function insert(event, rendered) {
    getDb()
        .prepare(
            `INSERT INTO notifications (id, type, severity, title, body, icon, read, created_at, meta)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
        )
        .run(
            event.id,
            event.type,
            event.severity,
            rendered.title || '',
            rendered.body || '',
            rendered.icon || 'fa-bell',
            event.timestamp,
            JSON.stringify(event.meta)
        );
}

function getRecent(limit = 20) {
    return getDb().prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?').all(limit);
}

function markRead(id) {
    getDb().prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id);
}

function markAllRead() {
    getDb().prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
}

function unreadCount() {
    return getDb().prepare('SELECT COUNT(*) as count FROM notifications WHERE read = 0').get().count;
}

function deleteOlderThan(days) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    getDb().prepare('DELETE FROM notifications WHERE created_at < ?').run(cutoff);
}

module.exports = { init, insert, getRecent, markRead, markAllRead, unreadCount, deleteOlderThan };
