'use strict';

const assert = require('assert');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
const studentsRepo = require('../main/repos/students');
const gradesRepo = require('../main/repos/grades');
const absencesRepo = require('../main/repos/absences');

const QUALIFIANT = 'secondary_qualifiant';
const COLLEGIAL = 'secondary_collegial';
const YEAR = '2025/2026';

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
                const value = fn(...args);
                db.exec('COMMIT');
                return value;
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        };
        return db;
    }
}

function createSchema(db) {
    db.exec(`
        CREATE TABLE students (
            id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, full_name TEXT NOT NULL,
            family_name TEXT, birth_date TEXT, birth_place TEXT, gender TEXT, section TEXT,
            level TEXT, school_name TEXT, school_year TEXT, status TEXT DEFAULT 'active',
            registration_type TEXT DEFAULT 'new',
            cycle_code TEXT NOT NULL DEFAULT 'secondary_qualifiant', UNIQUE(code, school_year)
        );
        CREATE TABLE grades (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, student_code TEXT,
            teacher_id INTEGER, subject TEXT, grade REAL, semester INTEGER, teacher_name TEXT,
            level TEXT, section TEXT, school_year TEXT,
            cycle_code TEXT NOT NULL DEFAULT 'secondary_qualifiant',
            UNIQUE(student_code, subject, semester, school_year)
        );
        CREATE TABLE absences (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, student_code TEXT,
            absence_date TEXT, month TEXT, absence_type TEXT, hours REAL, days REAL, reason TEXT,
            school_year TEXT, cycle_code TEXT NOT NULL DEFAULT 'secondary_qualifiant',
            UNIQUE(student_code, month, school_year, absence_type)
        );
        CREATE INDEX idx_grades_year_cycle ON grades(school_year, cycle_code);
        CREATE INDEX idx_absences_year_cycle ON absences(school_year, cycle_code);
    `);
}

function student(code, name) {
    return { code, full_name: name, family_name: '', birth_date: '', birth_place: '', gender: 'M', section: '1A', level: '', school_name: '', school_year: YEAR, status: 'active', registration_type: 'new' };
}
function grade(code, value, extra = {}) {
    return { student_id: 999, student_code: code, teacher_id: null, subject: 'الرياضيات', grade: value, semester: 1, teacher_name: '', level: '', section: '1A', school_year: YEAR, ...extra };
}
function absence(code, hours, extra = {}) {
    return { student_id: 999, student_code: code, absence_date: '2025-09-10', month: '09', absence_type: 'unjustified', hours, days: 0, reason: '', school_year: YEAR, ...extra };
}

console.log('[test] grades and absences cycle isolation');
const db = openDb();
createSchema(db);
setRepoCapturePort(createNoOpCapturePort());
studentsRepo.insertOne(db, student('Q1', 'تلميذ تأهيلي'), QUALIFIANT);
studentsRepo.insertOne(db, student('C1', 'تلميذ إعدادي'), COLLEGIAL);
const qStudent = studentsRepo.getByCode(db, 'Q1', YEAR, QUALIFIANT);
const cStudent = studentsRepo.getByCode(db, 'C1', YEAR, COLLEGIAL);

gradesRepo.saveOne(db, grade('Q1', 15, { cycle_code: COLLEGIAL }), QUALIFIANT);
gradesRepo.saveOne(db, grade('C1', 12), COLLEGIAL);
absencesRepo.saveOne(db, absence('Q1', 3, { cycle_code: COLLEGIAL }), QUALIFIANT);
absencesRepo.saveOne(db, absence('C1', 2), COLLEGIAL);

assert.deepStrictEqual(gradesRepo.listByYear(db, YEAR, QUALIFIANT).map((row) => row.student_code), ['Q1']);
assert.deepStrictEqual(absencesRepo.listByYear(db, YEAR, COLLEGIAL).map((row) => row.student_code), ['C1']);
assert.deepStrictEqual(gradesRepo.getByStudentCode(db, 'C1', YEAR, QUALIFIANT), []);
assert.deepStrictEqual(absencesRepo.getByStudentId(db, cStudent.id, YEAR, QUALIFIANT), []);
assert.strictEqual(db.prepare('SELECT cycle_code FROM grades WHERE student_code = ?').get('Q1').cycle_code, QUALIFIANT);
assert.strictEqual(db.prepare('SELECT student_id FROM absences WHERE student_code = ?').get('Q1').student_id, qStudent.id);
console.log('  [ok] reads and persisted ownership are cycle-scoped');

for (const call of [
    () => gradesRepo.listByYear(db, YEAR),
    () => gradesRepo.getByStudentCode(db, 'Q1', YEAR, ''),
    () => absencesRepo.listByYear(db, YEAR),
    () => absencesRepo.getByStudentId(db, qStudent.id, YEAR, null)
]) assert.throws(call, /السلك التعليمي غير محدد/);

// A single explicit save of a foreign student is an error: doing nothing quietly would
// be worse than failing, because the user asked to save that one record.
assert.throws(() => gradesRepo.saveOne(db, grade('C1', 18), QUALIFIANT), /C1/);
assert.throws(() => absencesRepo.saveOne(db, absence('C1', 4), QUALIFIANT), /C1/);

// A bulk import skips foreign rows and reports them — one row from the other cycle must
// not cost the user every row they can legitimately import (same contract as students).
studentsRepo.insertOne(db, student('Q2', 'تلميذ تأهيلي ثانٍ'), QUALIFIANT);
const mixedGrades = gradesRepo.saveBulk(db, [grade('Q2', 17, { subject: 'الفيزياء' }), grade('C1', 18)], QUALIFIANT);
assert.strictEqual(mixedGrades.count, 1, 'the qualifiant row is written');
assert.strictEqual(mixedGrades.skippedOtherCycle, 1);
assert.strictEqual(mixedGrades.skippedRows[0].student_code, 'C1');
assert.strictEqual(gradesRepo.getByStudentCode(db, 'Q2', YEAR, QUALIFIANT)[0].grade, 17);

const mixedAbsences = absencesRepo.saveBulk(db, [absence('Q2', 6, { month: '10' }), absence('C1', 4)], QUALIFIANT);
assert.strictEqual(mixedAbsences.count, 1);
assert.strictEqual(mixedAbsences.skippedOtherCycle, 1);

// An unknown code is malformed input, not a boundary — it still throws.
assert.throws(() => gradesRepo.saveBulk(db, [grade('NOPE', 10)], QUALIFIANT), /NOPE/);
assert.throws(() => absencesRepo.saveBulk(db, [absence('NOPE', 1)], QUALIFIANT), /NOPE/);

assert.strictEqual(gradesRepo.getByStudentCode(db, 'C1', YEAR, COLLEGIAL)[0].grade, 12);
assert.strictEqual(absencesRepo.getByStudentCode(db, 'C1', YEAR, COLLEGIAL)[0].hours, 2);
console.log('  [ok] bulk skips foreign rows, single saves throw, unknown codes throw');

// Drift: a stored row whose cycle no longer matches its student (an orphan defaulted
// during backfill, then the student appears in the other cycle). The upsert guard is the
// only thing standing between that row and a cross-cycle overwrite.
db.prepare('UPDATE grades SET cycle_code = ? WHERE student_code = ?').run(COLLEGIAL, 'Q2');
const drift = gradesRepo.saveBulk(db, [grade('Q2', 3, { subject: 'الفيزياء' })], QUALIFIANT);
assert.strictEqual(drift.count, 0, 'the drifted row is not overwritten');
assert.strictEqual(drift.skippedOtherCycle, 1, 'and the refusal is reported');
assert.strictEqual(db.prepare("SELECT grade FROM grades WHERE student_code = 'Q2'").get().grade, 17);
db.prepare('UPDATE grades SET cycle_code = ? WHERE student_code = ?').run(QUALIFIANT, 'Q2');
console.log('  [ok] the upsert guard refuses a drifted row and reports it');

const cAbsenceId = absencesRepo.getByStudentCode(db, 'C1', YEAR, COLLEGIAL)[0].id;
assert.strictEqual(absencesRepo.deleteById(db, cAbsenceId, QUALIFIANT).deleted, 0);
assert.strictEqual(absencesRepo.getByStudentCode(db, 'C1', YEAR, COLLEGIAL).length, 1);
// Both qualifiant grades (Q1 and Q2) go; the collegial one stays.
assert.strictEqual(gradesRepo.deleteBySemester(db, YEAR, 1, QUALIFIANT), 2);
assert.strictEqual(gradesRepo.getByStudentCode(db, 'C1', YEAR, COLLEGIAL).length, 1);

absencesRepo.replaceByYear(db, YEAR, [absence('Q1', 5)], QUALIFIANT);
assert.strictEqual(absencesRepo.getByStudentCode(db, 'Q1', YEAR, QUALIFIANT)[0].hours, 5);
assert.strictEqual(absencesRepo.getByStudentCode(db, 'C1', YEAR, COLLEGIAL).length, 1);
console.log('  [ok] raw-id delete, semester delete and replacement preserve the other cycle');

assert.strictEqual(gradesRepo.findByLocalKeys(db, { school_year: YEAR, student_code: 'C1', subject: 'الرياضيات', semester: '1' }).student_code, 'C1');
assert.strictEqual(absencesRepo.findByLocalKeys(db, { school_year: YEAR, student_code: 'C1', month: '09', absence_type: 'unjustified' }).student_code, 'C1');

// ── IPC-level classification (main/ipc/grades.js) ──────────────────────────
// The bulk validator decides which rows reach the repository at all, so the
// unknown-vs-foreign split has to hold there too, not only in SQL.
const { validateBulkStudentReferences } = require('../main/ipc/grades');

const classified = validateBulkStudentReferences(
    db,
    [
        { student_code: 'Q1', subject: 'الرياضيات', semester: 1, grade: 14, school_year: YEAR },
        { student_code: 'C1', subject: 'الرياضيات', semester: 1, grade: 11, school_year: YEAR }
    ],
    QUALIFIANT
);
assert.deepStrictEqual(classified.rows.map((row) => row.student_code), ['Q1']);
assert.deepStrictEqual(classified.skippedOtherCycle.map((row) => row.student_code), ['C1']);

assert.throws(
    () =>
        validateBulkStudentReferences(
            db,
            [{ student_code: 'GHOST', subject: 'الرياضيات', semester: 1, grade: 10, school_year: YEAR }],
            QUALIFIANT
        ),
    /GHOST/,
    'a code that exists in no cycle is still rejected'
);
console.log('  [ok] IPC validation separates foreign-cycle rows from unknown codes');

console.log('[test] grades and absences cycle isolation: all checks passed');
