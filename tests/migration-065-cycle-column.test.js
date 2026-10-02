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
        printed INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE student_files (
        id INTEGER PRIMARY KEY,
        student_id INTEGER NOT NULL,
        doc_key TEXT NOT NULL,
        is_present INTEGER DEFAULT 0,
        school_year TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    `INSERT INTO grades(id, student_id, student_code, school_year, cycle_code, grade)
     VALUES (?, ?, ?, ?, ?, ?)`
).run(7, 1, 'S-001', '2025/2026', 'secondary_qualifiant', 15.5);
db.prepare(
    `INSERT INTO absences(id, student_id, student_code, school_year, cycle_code, hours)
     VALUES (?, ?, ?, ?, ?, ?)`
).run(8, 1, 'S-001', '2025/2026', 'secondary_qualifiant', 2);

setDb(db);
const migration = MIGRATIONS.find((entry) => entry.version === '2026-07-065-fk-ondelete-and-identity-keys');
assert.ok(migration, 'migration 065 must be registered');

migration.up();

const columnNames = (tableName) => db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
assert.ok(columnNames('grades').includes('cycle_code'), 'grades must retain cycle_code after rebuild');
assert.ok(columnNames('absences').includes('cycle_code'), 'absences must retain cycle_code after rebuild');
assert.deepStrictEqual({ ...db.prepare('SELECT id, cycle_code, grade FROM grades WHERE id = 7').get() }, {
    id: 7,
    cycle_code: 'secondary_qualifiant',
    grade: 15.5
});
assert.deepStrictEqual({ ...db.prepare('SELECT id, cycle_code, hours FROM absences WHERE id = 8').get() }, {
    id: 8,
    cycle_code: 'secondary_qualifiant',
    hours: 2
});
assert.ok(
    db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get('2026-07-065-fk-ondelete-and-identity-keys'),
    'migration 065 must record completion'
);

console.log('[test] migration 065 cycle columns: all checks passed');

db.close();
