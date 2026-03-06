const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const dbPath = path.join(__dirname, 'data', 'database.sqlite');
if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'));
}

const db = new Database(dbPath);
console.log('Foreign keys enabled:', db.pragma('foreign_keys', { simple: true }));

const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='students'").get();
console.log('Table schema:', tableInfo ? tableInfo.sql : 'Table not found');
