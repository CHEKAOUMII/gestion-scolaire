const Database = require('better-sqlite3');
const { setDb, getDbPath, applyConnectionPragmas } = require('./context');
const { createTables } = require('./schema');
const { runMigrations } = require('./migrations');

function initDatabase() {
    const dbPath = getDbPath();
    let db = null;

    try {
        db = new Database(dbPath);

        // Connection tuning: WAL, FK enforcement, busy_timeout, synchronous=NORMAL,
        // wal_autocheckpoint (R3). Centralized so restore paths stay in sync.
        applyConnectionPragmas(db);

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
        } catch {
            // Ignore state reset failures during startup recovery.
        }

        throw error;
    }
}

module.exports = { initDatabase };
