'use strict';

const assert = require('assert');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
const studentsRepo = require('../main/repos/students');
const absencesRepo = require('../main/repos/absences');
const studentFilesRepo = require('../main/repos/student-files');
const studentMovementsRepo = require('../main/repos/student-movements');

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
        CREATE TABLE correspondence (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, student_code TEXT,
            letter_type TEXT, letter_date TEXT, total_hours REAL, school_year TEXT,
            printed INTEGER DEFAULT 0, cycle_code TEXT NOT NULL DEFAULT 'secondary_qualifiant'
        );
        CREATE TABLE student_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, doc_key TEXT NOT NULL,
            is_present INTEGER DEFAULT 0, school_year TEXT NOT NULL,
            cycle_code TEXT DEFAULT 'secondary_qualifiant',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(student_id, doc_key, school_year)
        );
        CREATE TABLE student_movements (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
            movement_type TEXT, from_section TEXT, to_section TEXT, movement_date TEXT,
            notes TEXT, school_year TEXT,
            cycle_code TEXT NOT NULL DEFAULT 'secondary_qualifiant'
        );
        CREATE TABLE student_profile_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
            student_code TEXT NOT NULL, tab_key TEXT NOT NULL, data_json TEXT,
            school_year TEXT NOT NULL, cycle_code TEXT NOT NULL DEFAULT 'secondary_qualifiant',
            UNIQUE(student_code, tab_key, school_year)
        );
    `);
}

function student(code, name) {
    return { code, full_name: name, family_name: '', birth_date: '', birth_place: '', gender: 'M', section: '1A', level: '', school_name: '', school_year: YEAR, status: 'active', registration_type: 'new' };
}

console.log('[test] student child tables (files / movements / correspondence / profile) cycle isolation');
const db = openDb();
createSchema(db);
setRepoCapturePort(createNoOpCapturePort());
studentsRepo.insertOne(db, student('Q1', 'تلميذ تأهيلي'), QUALIFIANT);
studentsRepo.insertOne(db, student('C1', 'تلميذ إعدادي'), COLLEGIAL);
const qStudent = studentsRepo.getByCode(db, 'Q1', YEAR, QUALIFIANT);
const cStudent = studentsRepo.getByCode(db, 'C1', YEAR, COLLEGIAL);

// ── Reads are cycle-scoped ────────────────────────────────────────────────
studentFilesRepo.upsertOne(db, { student_id: qStudent.id, doc_key: 'birth_cert', is_present: 1, school_year: YEAR }, QUALIFIANT);
studentFilesRepo.upsertOne(db, { student_id: cStudent.id, doc_key: 'birth_cert', is_present: 1, school_year: YEAR }, COLLEGIAL);
const fileRows = studentFilesRepo.listByYear(db, YEAR, QUALIFIANT);
assert.deepStrictEqual(fileRows.map((row) => row.code), ['Q1']);
assert.strictEqual(fileRows[0].docsCount, 1, 'document checklist joins the session cycle students only');

studentMovementsRepo.addMovement(db, { massar_code: 'Q1', movement_type: 'internal', from_section: '1A', to_section: '2A', movement_date: '2025-10-01', notes: '', school_year: YEAR }, QUALIFIANT);
studentMovementsRepo.addMovement(db, { massar_code: 'C1', movement_type: 'internal', from_section: '1A', to_section: '2A', movement_date: '2025-10-01', notes: '', school_year: YEAR }, COLLEGIAL);
assert.deepStrictEqual(studentMovementsRepo.listByYear(db, YEAR, QUALIFIANT).map((row) => row.code), ['Q1']);
assert.deepStrictEqual(studentMovementsRepo.getStats(db, YEAR, QUALIFIANT), { arrival: 0, departure: 0, internal: 1, dropout: 0 });
assert.deepStrictEqual(studentMovementsRepo.getStats(db, YEAR, COLLEGIAL), { arrival: 0, departure: 0, internal: 1, dropout: 0 });

absencesRepo.saveCorrespondence(db, { student_code: 'Q1', letter_type: 'warning', letter_date: '2025-10-02', total_hours: 3, school_year: YEAR }, QUALIFIANT);
absencesRepo.saveCorrespondence(db, { student_code: 'C1', letter_type: 'warning', letter_date: '2025-10-02', total_hours: 3, school_year: YEAR }, COLLEGIAL);
assert.deepStrictEqual(absencesRepo.listCorrespondenceByYear(db, YEAR, QUALIFIANT).map((row) => row.student_code), ['Q1']);
assert.deepStrictEqual(absencesRepo.listCorrespondenceByStudent(db, qStudent.id, QUALIFIANT).map((row) => row.letter_type), ['warning']);
assert.deepStrictEqual(absencesRepo.listCorrespondenceByStudent(db, cStudent.id, QUALIFIANT), []);
console.log('  [ok] reads are cycle-scoped across the four child tables');

// Orphan movements stay visible: a row whose student no longer exists belongs to no
// cycle, and hiding it would silently shrink the audit trail.
db.prepare('DELETE FROM students WHERE id = ?').run(qStudent.id);
const orphanRows = studentMovementsRepo.listByYear(db, YEAR, QUALIFIANT);
assert.strictEqual(orphanRows.length, 1, 'the orphaned movement remains visible');
assert.strictEqual(orphanRows[0].student_id, qStudent.id);
db.prepare('DELETE FROM student_movements WHERE student_id = ?').run(qStudent.id);
db.prepare('DELETE FROM correspondence WHERE student_id = ?').run(qStudent.id);
db.prepare('DELETE FROM student_files WHERE student_id = ?').run(qStudent.id);
studentsRepo.insertOne(db, student('Q1', 'تلميذ تأهيلي'), QUALIFIANT);
console.log('  [ok] orphan movements remain visible by design');

// ── Writes: foreign id/code throws, unknown throws, bulk skips+reports ────
const qStudent2 = studentsRepo.getByCode(db, 'Q1', YEAR, QUALIFIANT);
assert.throws(() => studentFilesRepo.upsertOne(db, { student_id: cStudent.id, doc_key: 'birth_cert', is_present: 1, school_year: YEAR }, QUALIFIANT), /لا ينتمي إلى السلك/);
assert.throws(() => studentFilesRepo.upsertOne(db, { student_code: 'C1', doc_key: 'birth_cert', is_present: 1, school_year: YEAR }, QUALIFIANT), /لا ينتمي إلى السلك/);
assert.throws(() => studentFilesRepo.upsertOne(db, { student_id: 99999, doc_key: 'birth_cert', is_present: 1, school_year: YEAR }, QUALIFIANT), /لا يوجد تلميذ/);
assert.throws(() => studentFilesRepo.upsertOne(db, { student_code: 'GHOST', doc_key: 'birth_cert', is_present: 1, school_year: YEAR }, QUALIFIANT), /GHOST/);
assert.throws(() => absencesRepo.saveCorrespondence(db, { student_code: 'C1', letter_type: 'warning', letter_date: '2025-10-03', total_hours: 1, school_year: YEAR }, QUALIFIANT), /C1/);
assert.throws(() => absencesRepo.saveCorrespondence(db, { student_id: cStudent.id, letter_type: 'warning', letter_date: '2025-10-03', total_hours: 1, school_year: YEAR }, QUALIFIANT), /لا ينتمي إلى السلك/);
assert.throws(() => absencesRepo.saveCorrespondence(db, { student_code: 'GHOST', letter_type: 'warning', letter_date: '2025-10-03', total_hours: 1, school_year: YEAR }, QUALIFIANT), /GHOST/);

const mixedBulk = studentFilesRepo.upsertBulk(
    db,
    [
        { student_id: qStudent2.id, doc_key: 'photo', is_present: 1, school_year: YEAR },
        { student_id: cStudent.id, doc_key: 'photo', is_present: 1, school_year: YEAR }
    ],
    QUALIFIANT
);
assert.strictEqual(mixedBulk.count, 1, 'the session-cycle row is written');
assert.strictEqual(mixedBulk.skippedOtherCycle, 1);
assert.strictEqual(mixedBulk.skippedRows[0].student_code, 'C1');
assert.throws(() => studentFilesRepo.upsertBulk(db, [{ student_id: 99999, doc_key: 'photo', is_present: 1, school_year: YEAR }], QUALIFIANT), /لا يوجد تلميذ/);
console.log('  [ok] foreign ids/codes throw on single writes, bulk skips and reports them, unknown codes throw');

// ── studentMovements:add resolves massar_code (regression #4) ─────────────
studentMovementsRepo.addMovement(db, { massar_code: 'Q1', movement_type: 'internal', from_section: '1A', to_section: '2A', movement_date: '2025-10-05', notes: '', school_year: YEAR }, QUALIFIANT);
assert.strictEqual(studentMovementsRepo.listByYear(db, YEAR, QUALIFIANT)[0].to_section, '2A');
assert.strictEqual(studentsRepo.getByCode(db, 'Q1', YEAR, QUALIFIANT).section, '2A', 'internal move updates the student section');
assert.throws(() => studentMovementsRepo.addMovement(db, { massar_code: 'C1', movement_type: 'internal', to_section: '2A', movement_date: '2025-10-05', school_year: YEAR }, QUALIFIANT), /C1/);
assert.throws(() => studentMovementsRepo.addMovement(db, { massar_code: 'GHOST', movement_type: 'internal', movement_date: '2025-10-05', school_year: YEAR }, QUALIFIANT), /GHOST/);
assert.throws(() => studentMovementsRepo.addMovement(db, { movement_type: 'internal', movement_date: '2025-10-05', school_year: YEAR }, QUALIFIANT), /السلك التعليمي غير محدد|لا يوجد تلميذ/);
console.log('  [ok] movements resolve by massar_code and reject foreign/unknown codes');

// ── Status transitions are cycle-guarded ──────────────────────────────────
studentsRepo.insertOne(db, student('Q2', 'تلميذ تأهيلي ثانٍ'), QUALIFIANT);
studentMovementsRepo.addMovement(db, { massar_code: 'Q2', movement_type: 'departure', from_section: '1A', movement_date: '2025-10-06', school_year: YEAR }, QUALIFIANT);
assert.strictEqual(studentsRepo.getByCode(db, 'Q2', YEAR, QUALIFIANT).status, 'inactive');
studentMovementsRepo.addMovement(db, { massar_code: 'Q2', movement_type: 'arrival', movement_date: '2025-10-07', school_year: YEAR }, QUALIFIANT);
assert.strictEqual(studentsRepo.getByCode(db, 'Q2', YEAR, QUALIFIANT).status, 'active');
assert.strictEqual(studentsRepo.getByCode(db, 'C1', YEAR, COLLEGIAL).status, 'active', 'the collegial student is untouched');
console.log('  [ok] departure/arrival transitions stay inside the session cycle');

// ── No NULL cycle_code is produced by any channel ─────────────────────────
for (const table of ['student_files', 'student_movements', 'correspondence', 'student_profile_data']) {
    const nulls = db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE cycle_code IS NULL`).get().c;
    assert.strictEqual(nulls, 0, `${table} must not receive NULL-cycle rows`);
}
console.log('  [ok] no NULL cycle_code rows are created');

// ── A legacy NULL-cycle row is refused on rewrite, never silently re-claimed ─
db.prepare('INSERT INTO student_files(student_id, doc_key, is_present, school_year, cycle_code) VALUES(?, ?, 0, ?, NULL)').run(cStudent.id, 'heal_me', YEAR);
const refused = studentFilesRepo.upsertOne(db, { student_id: cStudent.id, doc_key: 'heal_me', is_present: 1, school_year: YEAR }, COLLEGIAL);
assert.strictEqual(refused.success, false, 'an ambiguous NULL-cycle row is refused like a drifted one');
assert.strictEqual(db.prepare("SELECT cycle_code FROM student_files WHERE doc_key = 'heal_me'").get().cycle_code, null);
console.log('  [ok] rewriting a legacy NULL-cycle row is refused and reported, not re-claimed');

// ── Cascade: deleting a cycle deletes its student children, not the other's ─
const q = studentsRepo.getByCode(db, 'Q1', YEAR, QUALIFIANT);
db.prepare("INSERT INTO student_profile_data(student_id, student_code, tab_key, data_json, school_year, cycle_code) VALUES(?, 'Q1', 'social', '{}', ?, ?)").run(q.id, YEAR, QUALIFIANT);
db.prepare("INSERT INTO grades(student_id, student_code, subject, grade, semester, school_year, cycle_code) VALUES(?, 'Q1', 'الرياضيات', 12, 1, ?, ?)").run(q.id, YEAR, QUALIFIANT);
db.prepare("INSERT INTO absences(student_id, student_code, month, absence_type, hours, school_year, cycle_code) VALUES(?, 'Q1', '09', 'unjustified', 2, ?, ?)").run(q.id, YEAR, QUALIFIANT);
assert.strictEqual(studentsRepo.deleteByYear(db, YEAR, QUALIFIANT), 2, 'Q1 + Q2 qualifiant students are deleted');
for (const table of ['grades', 'absences', 'correspondence', 'student_files', 'student_movements', 'student_profile_data']) {
    const leftover = db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE student_id = ?`).get(q.id).c;
    assert.strictEqual(leftover, 0, `${table} follows its qualifiant student`);
}
const collegialLeft = db.prepare('SELECT COUNT(*) AS c FROM correspondence WHERE student_id = ?').get(cStudent.id).c;
assert.strictEqual(collegialLeft, 1, 'the collegial letter survives the qualifiant delete');
assert.ok(studentsRepo.getByCode(db, 'C1', YEAR, COLLEGIAL), 'the collegial student survives');
console.log('  [ok] student delete cascades to all six child tables within the cycle');

console.log('[test] student child tables cycle isolation: all checks passed');
