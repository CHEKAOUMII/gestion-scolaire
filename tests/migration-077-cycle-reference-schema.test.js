'use strict';

const assert = require('assert');
const { setDb } = require('../main/db/context');
const { MIGRATIONS } = require('../main/db/migrations');

function openDb() {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.pragma = (statement) => db.prepare(`PRAGMA ${statement}`).all();
    return db;
}

const db = openDb();
db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, role TEXT);
    CREATE TABLE students (
        id INTEGER PRIMARY KEY,
        code TEXT,
        section TEXT,
        level TEXT,
        school_year TEXT,
        cycle_code TEXT
    );
    CREATE TABLE exams (
        id INTEGER PRIMARY KEY,
        title TEXT,
        section TEXT,
        school_year TEXT,
        cycle_code TEXT
    );
    CREATE TABLE tests (
        id INTEGER PRIMARY KEY,
        title TEXT,
        section TEXT,
        school_year TEXT,
        cycle_code TEXT
    );
    CREATE TABLE student_profile_data (
        id INTEGER PRIMARY KEY,
        student_id INTEGER NOT NULL,
        student_code TEXT NOT NULL,
        school_year TEXT NOT NULL,
        cycle_code TEXT
    );
    CREATE TABLE correspondence (
        id INTEGER PRIMARY KEY,
        student_id INTEGER,
        student_code TEXT,
        school_year TEXT,
        cycle_code TEXT
    );
    CREATE TABLE student_files (
        id INTEGER PRIMARY KEY,
        student_id INTEGER NOT NULL,
        school_year TEXT,
        cycle_code TEXT
    );
    CREATE TABLE student_movements (
        id INTEGER PRIMARY KEY,
        student_id INTEGER NOT NULL,
        school_year TEXT,
        cycle_code TEXT
    );
    CREATE TABLE exam_proctors (id INTEGER PRIMARY KEY, exam_id INTEGER);
    CREATE TABLE system_logs (
        id INTEGER PRIMARY KEY,
        action TEXT,
        entity_type TEXT,
        entity_id TEXT,
        details TEXT
    );

    INSERT INTO users(id, name, role) VALUES
        (1, 'Administrative', 'admin'),
        (2, 'Restricted', 'teacher');
    INSERT INTO students(id, code, section, level, school_year, cycle_code) VALUES
        (1, 'Q-001', 'Q-A', '1BAC', '2025/2026', 'secondary_qualifiant'),
        (2, 'C-001', 'C-A', '1AC', '2025/2026', 'secondary_collegial');
    INSERT INTO exams(id, title, section, school_year, cycle_code) VALUES
        (1, 'Qualifiant', 'Q-A', '2025/2026', NULL),
        (2, 'Unmapped', 'UNKNOWN', '2025/2026', NULL),
        (3, 'Preserved', 'C-A', '2025/2026', 'manual_cycle');
    INSERT INTO tests(id, title, section, school_year, cycle_code) VALUES
        (1, 'Mapped test', 'C-A', '2025/2026', NULL);
    INSERT INTO student_profile_data(id, student_id, student_code, school_year, cycle_code)
        VALUES (1, 1, 'Q-001', '2025/2026', NULL);
    INSERT INTO correspondence(id, student_id, student_code, school_year, cycle_code)
        VALUES (1, 2, 'C-001', '2025/2026', NULL);
    INSERT INTO student_files(id, student_id, school_year, cycle_code)
        VALUES (1, 1, '2025/2026', NULL), (2, 999, '2025/2026', NULL);
    INSERT INTO student_movements(id, student_id, school_year, cycle_code)
        VALUES (1, 2, '2025/2026', NULL);
    INSERT INTO exam_proctors(id, exam_id) VALUES (1, 1), (2, NULL), (3, 999);
`);

setDb(db);
const migration = MIGRATIONS.find((entry) => entry.version === '2026-07-077-cycle-reference-schema');
assert.ok(migration, 'central cycle schema migration must be registered after 076');

migration.up();
const firstLogCount = db.prepare('SELECT COUNT(*) AS count FROM system_logs').get().count;
migration.up();

const requiredTables = [
    'user_cycle_access',
    'sections',
    'education_levels',
    'level_aliases',
    'education_subjects',
    'subject_aliases'
];
for (const tableName of requiredTables) {
    assert.ok(
        db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName),
        `${tableName} must exist`
    );
}

const cycleFor = (tableName, id) => db.prepare(`SELECT cycle_code FROM ${tableName} WHERE id = ?`).get(id).cycle_code;
assert.strictEqual(cycleFor('exams', 1), 'secondary_qualifiant');
assert.strictEqual(cycleFor('exams', 2), null, 'unmappable exam must remain unresolved');
assert.strictEqual(cycleFor('exams', 3), 'manual_cycle', 'existing cycle value must be preserved');
assert.strictEqual(cycleFor('tests', 1), 'secondary_collegial');
assert.strictEqual(cycleFor('student_profile_data', 1), 'secondary_qualifiant');
assert.strictEqual(cycleFor('correspondence', 1), 'secondary_collegial');
assert.strictEqual(cycleFor('student_files', 1), 'secondary_qualifiant');
assert.strictEqual(cycleFor('student_movements', 1), 'secondary_collegial');
assert.strictEqual(cycleFor('student_files', 2), null, 'orphan student file must remain unresolved');

assert.strictEqual(
    db.prepare("SELECT COUNT(*) AS count FROM sections WHERE school_year = '2025/2026'").get().count,
    2
);
assert.strictEqual(
    db.prepare('SELECT cycle_code FROM user_cycle_access WHERE user_id = ?').get(2).cycle_code,
    'secondary_qualifiant',
    'existing restricted users receive the historical qualifying-cycle grant'
);
assert.strictEqual(
    db.prepare('SELECT 1 FROM user_cycle_access WHERE user_id = ?').get(1),
    undefined,
    'full-access roles do not need redundant grants'
);
assert.strictEqual(
    db.prepare("SELECT COUNT(*) AS count FROM system_logs WHERE action = 'CYCLE_BACKFILL_UNMAPPABLE'").get().count,
    4,
    'unmappable exam and student/proctor rows must be audited once'
);
const proctorReport = db
    .prepare("SELECT details FROM system_logs WHERE action = 'CYCLE_BACKFILL_EXAM_PROCTORS_REPORT'")
    .get();
assert.strictEqual(JSON.parse(proctorReport.details).count, 2);
assert.strictEqual(
    db.prepare('SELECT COUNT(*) AS count FROM system_logs').get().count,
    firstLogCount,
    'rerunning the migration must not duplicate audit rows'
);

console.log('[test] migration 077 cycle reference schema: all checks passed');
db.close();
