// Debug: check teachers in DB — run with: npx electron debug-teachers.js
const path = require('path');
const Database = require('better-sqlite3');
const dbPath = path.join(process.env.APPDATA, 'gestion-scolaire', 'gestion-scolaire.db');
const db = new Database(dbPath);

const allTeachers = db.prepare('SELECT COUNT(*) as total FROM teachers').get();
console.log('Total teachers in DB:', allTeachers.total);

const byYear = db.prepare('SELECT school_year, COUNT(*) as cnt FROM teachers GROUP BY school_year').all();
console.log('Teachers by school_year:', byYear);

const sample = db.prepare('SELECT id, ppr, full_name, school_year, source FROM teachers LIMIT 3').all();
console.log('Sample rows:', JSON.stringify(sample, null, 2));

const cols = db.prepare("PRAGMA table_info(teachers)").all().map(c => c.name);
console.log('Columns:', cols.join(', '));

db.close();
process.exit(0);
