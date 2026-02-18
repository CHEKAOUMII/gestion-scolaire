const Database = require('better-sqlite3');
const { setDb, getDbPath } = require('./context');
const { createTables } = require('./schema');
const { runMigrations } = require('./migrations');

function initDatabase() {
    const dbPath = getDbPath();
    const db = new Database(dbPath);

    // Enable WAL mode for better concurrent performance
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    setDb(db);
    console.log('Database opened at:', dbPath);

    createTables();
    runMigrations();
}

module.exports = { initDatabase };
