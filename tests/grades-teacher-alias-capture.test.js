'use strict';

// Grade imports must capture teacher aliases in the same transaction as grades.

const assert = require('assert');
const gradesRepo = require('../main/repos/grades');
const staffRepo = require('../main/repos/staff');
const { setRepoCapturePort } = require('../main/repos/capture-port');

const YEAR = '2025/2026';
const CYCLE = 'secondary_qualifiant';

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
                const result = fn(...args);
                db.exec('COMMIT');
                return result;
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        };
        return db;
    }
}

const db = openDb();
db.exec(`
    CREATE TABLE students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        full_name TEXT,
        section TEXT,
        school_year TEXT NOT NULL,
        cycle_code TEXT NOT NULL
    );
    CREATE TABLE teachers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        full_name_fr TEXT,
        subject TEXT,
        school_year TEXT NOT NULL
    );
    CREATE TABLE teacher_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER NOT NULL,
        alias_name TEXT NOT NULL,
        alias_normalized TEXT NOT NULL,
        source TEXT,
        school_year TEXT NOT NULL,
        UNIQUE(teacher_id, school_year, alias_normalized)
    );
    CREATE TABLE grades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        student_code TEXT NOT NULL,
        teacher_id INTEGER,
        subject TEXT NOT NULL,
        grade REAL,
        semester INTEGER NOT NULL,
        teacher_name TEXT,
        level TEXT,
        section TEXT,
        school_year TEXT NOT NULL,
        cycle_code TEXT NOT NULL,
        UNIQUE(student_code, subject, semester, school_year)
    );
`);

db.prepare('INSERT INTO students(code, full_name, section, school_year, cycle_code) VALUES (?, ?, ?, ?, ?)').run(
    'S1',
    'تلميذ',
    '1A',
    YEAR,
    CYCLE
);
const teacherId = Number(db.prepare('INSERT INTO teachers(full_name, subject, school_year) VALUES (?, ?, ?)').run('نور الدين السعيدي', 'الرياضيات', YEAR).lastInsertRowid);

const captured = [];
setRepoCapturePort({
    captureInputUpserts() {},
    captureResolvedRows(_db, tableName, rows, operation) {
        captured.push({ tableName, rows, operation });
    },
    capturePutsByIds() {},
    captureDeletesFromRows() {},
    notifyCaptureCommitted() {}
});

const result = gradesRepo.saveBulk(
    db,
    [
        {
            student_code: 'S1',
            subject: 'الرياضيات',
            grade: 15,
            semester: 1,
            teacher_name: 'السعيدي نور الدين',
            school_year: YEAR,
            level: '1BACSM',
            section: '1A'
        }
    ],
    CYCLE,
    {
        resolveRow(row) {
            return {
                ...row,
                teacher_id: teacherId,
                teacher_alias: {
                    teacher_id: teacherId,
                    alias_name: row.teacher_name,
                    school_year: YEAR,
                    source: 'grades:saveBulk'
                }
            };
        },
        saveTeacherAlias(dbConn, alias) {
            return staffRepo.saveTeacherAlias(dbConn, alias);
        }
    }
);

assert.strictEqual(result.success, true);
assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM teacher_aliases').get().count, 1);
assert.ok(captured.some((entry) => entry.tableName === 'teacher_aliases' && entry.operation === 'PUT'));

// Production regression (2026-08-04): an unresolved teacher has no alias to save,
// so the alias callback must not receive null and its grade must still commit atomically.
let unresolvedAliasSaveCalls = 0;
const unresolvedTeacherResult = gradesRepo.saveBulk(
    db,
    [
        {
            student_code: 'S1',
            subject: 'الفيزياء',
            grade: 14,
            semester: 1,
            teacher_name: 'أستاذ غير مطابق',
            school_year: YEAR,
            level: '1BACSM',
            section: '1A'
        }
    ],
    CYCLE,
    {
        resolveRow(row) {
            return {
                ...row,
                teacher_id: null,
                teacher_alias: null
            };
        },
        saveTeacherAlias(dbConn, alias) {
            unresolvedAliasSaveCalls += 1;
            return staffRepo.saveTeacherAlias(dbConn, alias);
        }
    }
);

assert.strictEqual(unresolvedTeacherResult.success, true);
assert.strictEqual(unresolvedAliasSaveCalls, 0);
assert.strictEqual(unresolvedTeacherResult.count, 1);
assert.strictEqual(db.prepare("SELECT teacher_name FROM grades WHERE subject = 'الفيزياء'").get().teacher_name, 'أستاذ غير مطابق');
assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM teacher_aliases').get().count, 1);

setRepoCapturePort(null);
db.close();
console.log('grades-teacher-alias-capture: OK');
