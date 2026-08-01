'use strict';

const assert = require('assert');
const { setDb } = require('../main/db/context');
const { MIGRATIONS } = require('../main/db/migrations');

function openDb() {
    try {
        const Database = require('better-sqlite3');
        const probe = new Database(':memory:');
        probe.close();
        return new Database(':memory:');
    } catch {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(':memory:');
        db.pragma = (statement) => db.prepare(`PRAGMA ${statement}`).all();
        return db;
    }
}

const db = openDb();
db.exec(`
    CREATE TABLE students (id INTEGER PRIMARY KEY, code TEXT, school_year TEXT, cycle_code TEXT);
    CREATE TABLE grades (id INTEGER PRIMARY KEY, student_code TEXT, school_year TEXT);
    CREATE TABLE absences (id INTEGER PRIMARY KEY, student_code TEXT, school_year TEXT);
    CREATE TABLE system_logs (id INTEGER PRIMARY KEY, action TEXT, entity_type TEXT, entity_id TEXT, details TEXT);
`);
db.prepare('INSERT INTO students(id, code, school_year, cycle_code) VALUES(?, ?, ?, ?)').run(1, 'Q1', '2025/2026', 'secondary_qualifiant');
db.prepare('INSERT INTO students(id, code, school_year, cycle_code) VALUES(?, ?, ?, ?)').run(2, 'C1', '2025/2026', 'secondary_collegial');
db.prepare('INSERT INTO grades(id, student_code, school_year) VALUES(?, ?, ?)').run(1, 'Q1', '2025/2026');
db.prepare('INSERT INTO grades(id, student_code, school_year) VALUES(?, ?, ?)').run(2, 'ORPHAN', '2025/2026');
db.prepare('INSERT INTO absences(id, student_code, school_year) VALUES(?, ?, ?)').run(1, 'C1', '2025/2026');

setDb(db);
const migration = MIGRATIONS.find((entry) => entry.version === '2026-07-072-grades-absences-cycle-code');
assert.ok(migration, 'cycle migration must be registered');
migration.up();
migration.up();

assert.strictEqual(db.prepare('SELECT cycle_code FROM grades WHERE id = 1').get().cycle_code, 'secondary_qualifiant');
assert.strictEqual(db.prepare('SELECT cycle_code FROM absences WHERE id = 1').get().cycle_code, 'secondary_collegial');
assert.strictEqual(db.prepare('SELECT cycle_code FROM grades WHERE id = 2').get().cycle_code, 'secondary_qualifiant');
const log = db.prepare("SELECT details FROM system_logs WHERE action = 'CYCLE_BACKFILL_ORPHANS'").get();
assert.strictEqual(JSON.parse(log.details).count, 1, 'orphan audit must record the complete count');
assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_grades_year_cycle'").get());
assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_absences_year_cycle'").get());
console.log('[test] grades/absences cycle migration: all checks passed');
