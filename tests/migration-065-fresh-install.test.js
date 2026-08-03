'use strict';

// Regression: migration 065 rebuilds tables whose FRESH-install shape (schema.js
// createTables) carries columns the rebuild DDL did not declare —
// grades.teacher_resolution / grades.source_file_name and
// cycle_code on correspondence / student_files / student_movements / tests.
// On upgraded DBs those columns did not exist when 065 ran (added later via
// ensureColumn), so the column-copy insert only failed on fresh installs —
// which crashed app startup on a brand-new profile (caught by the e2e suite).
//
// This test builds the CURRENT schema.js shape for the rebuilt tables, seeds a
// row per affected table, runs 065, and asserts the migration succeeds and
// every column + value survives the rebuild.

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
        db.transaction = (fn) => (...args) => {
            db.exec('BEGIN');
            try {
                const transactionResult = fn(...args);
                db.exec('COMMIT');
                return transactionResult;
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        };
        db.pragma = (statement) => db.prepare(`PRAGMA ${statement}`).all();
        return db;
    }
}

const db = openDb();

db.exec(`
    CREATE TABLE schema_migrations (version TEXT PRIMARY KEY);
    CREATE TABLE students (
        id INTEGER PRIMARY KEY,
        code TEXT,
        school_year TEXT
    );
    CREATE TABLE teachers (id INTEGER PRIMARY KEY);
    CREATE TABLE exams (id INTEGER PRIMARY KEY);
    CREATE TABLE system_logs (
        id INTEGER PRIMARY KEY,
        action TEXT,
        entity_type TEXT,
        entity_id TEXT,
        details TEXT
    );
    CREATE TABLE grades (
        id INTEGER PRIMARY KEY,
        student_id INTEGER,
        student_code TEXT,
        teacher_id INTEGER,
        subject TEXT,
        grade REAL,
        semester INTEGER,
        teacher_name TEXT,
        level TEXT,
        section TEXT,
        school_year TEXT,
        cycle_code TEXT NOT NULL DEFAULT 'secondary_qualifiant',
        teacher_resolution TEXT DEFAULT 'unresolved',
        source_file_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE absences (
        id INTEGER PRIMARY KEY,
        student_id INTEGER,
        student_code TEXT,
        absence_date DATE,
        month TEXT,
        absence_type TEXT DEFAULT 'unjustified',
        hours INTEGER DEFAULT 0,
        days REAL DEFAULT 0,
        reason TEXT,
        school_year TEXT,
        cycle_code TEXT NOT NULL DEFAULT 'secondary_qualifiant',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE correspondence (
        id INTEGER PRIMARY KEY,
        student_id INTEGER,
        student_code TEXT,
        letter_type TEXT,
        letter_date DATE,
        total_hours INTEGER,
        school_year TEXT,
        cycle_code TEXT,
        printed INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE student_files (
        id INTEGER PRIMARY KEY,
        student_id INTEGER NOT NULL,
        doc_key TEXT NOT NULL,
        is_present INTEGER DEFAULT 0,
        school_year TEXT,
        cycle_code TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_id, doc_key, school_year)
    );
    CREATE TABLE student_movements (
        id INTEGER PRIMARY KEY,
        student_id INTEGER NOT NULL,
        movement_type TEXT NOT NULL,
        from_section TEXT,
        to_section TEXT,
        movement_date DATE NOT NULL,
        notes TEXT,
        school_year TEXT,
        cycle_code TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE teacher_aliases (
        id INTEGER PRIMARY KEY,
        teacher_id INTEGER NOT NULL,
        alias_name TEXT NOT NULL,
        alias_normalized TEXT NOT NULL,
        source TEXT,
        school_year TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE teacher_absences (
        id INTEGER PRIMARY KEY,
        teacher_id INTEGER NOT NULL,
        absence_date DATE NOT NULL,
        reason TEXT,
        replacement_teacher TEXT,
        school_year TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        justified INTEGER DEFAULT 1
    );
    CREATE TABLE exam_proctors (
        id INTEGER PRIMARY KEY,
        exam_id INTEGER,
        teacher_id INTEGER,
        teacher_name TEXT,
        room TEXT,
        school_year TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        date TEXT,
        session TEXT,
        cin TEXT,
        som TEXT,
        gender TEXT,
        specialty TEXT,
        workplace TEXT,
        teacher_name_fr TEXT
    );
    CREATE TABLE tests (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        section TEXT,
        subject TEXT,
        teacher_id INTEGER,
        teacher_name TEXT,
        status TEXT DEFAULT 'planned',
        test_date DATE,
        school_year TEXT,
        cycle_code TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE staff_attendance (
        id INTEGER PRIMARY KEY,
        teacher_id INTEGER,
        teacher_name TEXT,
        subject TEXT,
        attendance_date DATE NOT NULL,
        type TEXT NOT NULL DEFAULT 'absence',
        late_duration INTEGER,
        arrival_time TEXT,
        reason TEXT,
        notes TEXT,
        absence_period TEXT DEFAULT 'full_day',
        school_year TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE compensation_tracking (
        id INTEGER PRIMARY KEY,
        absence_date TEXT NOT NULL,
        teacher_name TEXT NOT NULL,
        section TEXT NOT NULL,
        period_slot TEXT NOT NULL,
        period_time TEXT,
        subject TEXT,
        compensated INTEGER DEFAULT 0,
        compensated_date TEXT,
        notes TEXT,
        school_year TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        teacher_id INTEGER,
        reason TEXT
    );
    CREATE TABLE support_sessions (
        id INTEGER PRIMARY KEY,
        teacher_id INTEGER,
        teacher_name TEXT,
        subject TEXT NOT NULL,
        section TEXT NOT NULL,
        room TEXT,
        session_date TEXT NOT NULL,
        time_from TEXT NOT NULL,
        time_to TEXT NOT NULL,
        duration_hours REAL,
        attendance_status TEXT NOT NULL,
        school_year TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE exam_invitations (
        id INTEGER PRIMARY KEY,
        school_year TEXT NOT NULL,
        teacher_id INTEGER,
        teacher_name TEXT NOT NULL,
        sent_at DATETIME,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE exam_attendance (
        id INTEGER PRIMARY KEY,
        school_year TEXT NOT NULL,
        session_key TEXT NOT NULL,
        session_label TEXT,
        session_date TEXT,
        teacher_id INTEGER,
        teacher_name TEXT NOT NULL,
        role TEXT DEFAULT 'proctor',
        status TEXT DEFAULT 'present',
        notes TEXT,
        recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE student_risk_snapshot (
        id INTEGER PRIMARY KEY,
        student_id INTEGER,
        student_code TEXT NOT NULL,
        risk_score INTEGER,
        risk_level TEXT,
        school_year TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_by TEXT
    );
`);

db.prepare('INSERT INTO students(id, code, school_year) VALUES (?, ?, ?)').run(1, 'S-001', '2025/2026');
db.prepare(
    `INSERT INTO grades(id, student_id, student_code, school_year, cycle_code, grade, teacher_resolution, source_file_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
).run(7, 1, 'S-001', '2025/2026', 'secondary_qualifiant', 15.5, 'unresolved', 'import.xlsx');
db.prepare(
    `INSERT INTO correspondence(id, student_id, student_code, letter_type, letter_date, total_hours, school_year, cycle_code, printed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
).run(9, 1, 'S-001', 'warning', '2026-01-10', 2, '2025/2026', 'secondary_qualifiant', 0);
db.prepare(
    `INSERT INTO student_files(id, student_id, doc_key, is_present, school_year, cycle_code)
     VALUES (?, ?, ?, ?, ?, ?)`
).run(10, 1, 'birth_cert', 1, '2025/2026', 'secondary_qualifiant');
db.prepare(
    `INSERT INTO student_movements(id, student_id, movement_type, from_section, to_section, movement_date, notes, school_year, cycle_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
).run(11, 1, 'transfer_in', '1BAC-A', 'TC-A', '2026-01-05', 'official', '2025/2026', 'secondary_qualifiant');
db.prepare(
    `INSERT INTO tests(id, title, section, subject, status, test_date, school_year, cycle_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
).run(12, 'Test 1', 'TC-A', 'Math', 'planned', '2026-02-01', '2025/2026', 'secondary_qualifiant');

setDb(db);
const migration = MIGRATIONS.find((entry) => entry.version === '2026-07-065-fk-ondelete-and-identity-keys');
assert.ok(migration, 'migration 065 must be registered');

// Fresh installs must not crash here (regression: grades_rb had no
// teacher_resolution / source_file_name; the four tables had no cycle_code).
migration.up();

const columnNames = (tableName) => db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
for (const column of ['teacher_resolution', 'source_file_name']) {
    assert.ok(columnNames('grades').includes(column), `grades must retain ${column} after rebuild`);
}
for (const tableName of ['correspondence', 'student_files', 'student_movements', 'tests']) {
    assert.ok(columnNames(tableName).includes('cycle_code'), `${tableName} must retain cycle_code after rebuild`);
}
for (const tableName of ['grades', 'absences']) {
    assert.ok(columnNames(tableName).includes('cycle_code'), `${tableName} must retain cycle_code after rebuild`);
}

assert.deepStrictEqual(
    {
        ...db
            .prepare('SELECT id, cycle_code, grade, teacher_resolution, source_file_name FROM grades WHERE id = 7')
            .get()
    },
    {
        id: 7,
        cycle_code: 'secondary_qualifiant',
        grade: 15.5,
        teacher_resolution: 'unresolved',
        source_file_name: 'import.xlsx'
    }
);
assert.deepStrictEqual(
    { ...db.prepare('SELECT id, cycle_code, letter_type FROM correspondence WHERE id = 9').get() },
    { id: 9, cycle_code: 'secondary_qualifiant', letter_type: 'warning' }
);
assert.deepStrictEqual(
    { ...db.prepare('SELECT id, cycle_code, doc_key FROM student_files WHERE id = 10').get() },
    { id: 10, cycle_code: 'secondary_qualifiant', doc_key: 'birth_cert' }
);
assert.deepStrictEqual(
    { ...db.prepare('SELECT id, cycle_code, movement_type FROM student_movements WHERE id = 11').get() },
    { id: 11, cycle_code: 'secondary_qualifiant', movement_type: 'transfer_in' }
);
assert.deepStrictEqual(
    { ...db.prepare('SELECT id, cycle_code, title FROM tests WHERE id = 12').get() },
    { id: 12, cycle_code: 'secondary_qualifiant', title: 'Test 1' }
);
assert.ok(
    db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get('2026-07-065-fk-ondelete-and-identity-keys'),
    'migration 065 must record completion'
);

console.log('[test] migration 065 fresh-install columns: all checks passed');

db.close();
