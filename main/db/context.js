const { app } = require('electron');
const path = require('path');

let db = null;

function setDb(instance) {
    db = instance;
}

function getDb() {
    if (!db) throw new Error('Database is not initialized');
    return db;
}

function getDbPath() {
    return path.join(app.getPath('userData'), 'gestion-scolaire.db');
}

/**
 * Apply the standard connection pragmas to a freshly-opened database handle (R3).
 *
 * Every place that opens a `better-sqlite3` handle (initial boot + backup restore)
 * must run these so behavior is identical across connections:
 *   - journal_mode = WAL        → concurrent readers during writes
 *   - foreign_keys = ON         → enforce declared FKs
 *   - busy_timeout = 5000       → wait up to 5s for a lock instead of failing
 *                                 immediately with SQLITE_BUSY when a sync push and
 *                                 a UI write collide
 *   - synchronous = NORMAL      → standard WAL durability (≈2× faster than FULL,
 *                                 same crash-safety guarantees under WAL)
 *   - wal_autocheckpoint = 1000 → checkpoint the WAL every ~1000 pages so it does
 *                                 not grow without bound
 */
function applyConnectionPragmas(instance) {
    instance.pragma('journal_mode = WAL');
    instance.pragma('foreign_keys = ON');
    instance.pragma('busy_timeout = 5000');
    instance.pragma('synchronous = NORMAL');
    instance.pragma('wal_autocheckpoint = 1000');
}

module.exports = { setDb, getDb, getDbPath, applyConnectionPragmas };
