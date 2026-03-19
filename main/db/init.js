const Database = require('better-sqlite3');
const { setDb, getDbPath } = require('./context');
const { createTables } = require('./schema');
const { runMigrations } = require('./migrations');

function initDatabase() {
    const dbPath = getDbPath();
    let db = null;

    try {
        db = new Database(dbPath);

        // Enable WAL mode for better concurrent performance
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');

        setDb(db);
        console.log('[db] Database opened at:', dbPath);

        createTables();
        runMigrations();
        return db;
    } catch (error) {
        console.error('[db] Failed to initialize database at:', dbPath, error);

        if (db) {
            try {
                db.close();
            } catch (closeError) {
                console.warn('[db] Failed to close database after init error:', closeError?.message || closeError);
            }
        }

        try {
            setDb(null);
        } catch (_) {
            // Ignore state reset failures during startup recovery.
        }

        throw error;
    }
}

module.exports = { initDatabase };
