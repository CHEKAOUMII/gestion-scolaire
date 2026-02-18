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

module.exports = { setDb, getDb, getDbPath };
