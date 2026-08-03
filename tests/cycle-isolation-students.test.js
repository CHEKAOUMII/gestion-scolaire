'use strict';

/**
 * Cycle isolation for students — docs/plans/2026-07-30-cycle-scoping-students-slice.md, Step 7.
 *
 * The acceptance criterion for the slice is that a student created under one cycle is
 * invisible and untouchable from a session active in another cycle, including when the
 * caller supplies a row id directly. These tests drive the real repository SQL against a
 * real engine, using the schema the migration produces.
 *
 * Isolation is exercised at repository level with two raw cycle codes; the
 * capability gate and approved collegial selection are covered separately by
 * tests/cycles-repo-ipc.test.js.
 */

const assert = require('assert');

const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
const studentsRepo = require('../main/repos/students');

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
        // Native ABI mismatch (module built for Electron) — fall back to node:sqlite.
    }
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.transaction = (fn) => (...args) => {
        db.exec('BEGIN');
        try {
            const result = fn(...args);
            db.exec('COMMIT');
            return result;
        } catch (err) {
            db.exec('ROLLBACK');
            throw err;
        }
    };
    return db;
}

// Mirrors createTables() + migration 2026-07-071-students-cycle-code for the tables this
// slice touches. The dependent tables carry only what the cascade needs.
function createSchema(db) {
    db.exec(`
        CREATE TABLE students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT,
            full_name TEXT NOT NULL,
            family_name TEXT,
            birth_date TEXT,
            birth_place TEXT,
            gender TEXT,
            section TEXT,
            level TEXT,
            school_name TEXT,
            school_year TEXT,
            status TEXT DEFAULT 'active',
            registration_type TEXT DEFAULT 'new',
            cycle_code TEXT NOT NULL DEFAULT 'secondary_qualifiant',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(code, school_year)
        );
        CREATE INDEX idx_students_year_cycle ON students(school_year, cycle_code);
        CREATE TABLE grades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER, student_code TEXT, subject TEXT, grade REAL,
            semester INTEGER, school_year TEXT
        );
        CREATE TABLE absences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER, student_code TEXT, month TEXT, absence_type TEXT, school_year TEXT
        );
        CREATE TABLE correspondence (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, school_year TEXT
        );
        CREATE TABLE student_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, doc_key TEXT, school_year TEXT
        );
        CREATE TABLE student_movements (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, movement_type TEXT,
            movement_date TEXT, notes TEXT, school_year TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE student_profile_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER, student_code TEXT, tab_key TEXT, school_year TEXT
        );
    `);
}

function student(code, name, cycle) {
    return {
        code,
        full_name: name,
        family_name: '',
        birth_date: '',
        birth_place: '',
        gender: 'M',
        section: '1A',
        level: '',
        school_name: '',
        school_year: YEAR,
        status: 'active',
        registration_type: 'new',
        cycle
    };
}

console.log('[test] students cycle isolation');

const db = openDb();
createSchema(db);
setRepoCapturePort(createNoOpCapturePort());

studentsRepo.insertOne(db, student('Q1', 'تلميذ تأهيلي', QUALIFIANT), QUALIFIANT);
studentsRepo.insertOne(db, student('C1', 'تلميذ إعدادي', COLLEGIAL), COLLEGIAL);

// ── Reads see only their own cycle ─────────────────────────────────────────
assert.deepStrictEqual(
    studentsRepo.listByYear(db, YEAR, QUALIFIANT).map((row) => row.code),
    ['Q1']
);
assert.deepStrictEqual(
    studentsRepo.listByYear(db, YEAR, COLLEGIAL).map((row) => row.code),
    ['C1']
);
assert.strictEqual(studentsRepo.listPaginated(db, YEAR, QUALIFIANT, 20, 0).total, 1);
assert.deepStrictEqual(
    studentsRepo.getCodesByYear(db, YEAR, COLLEGIAL).map((row) => row.code),
    ['C1']
);
assert.strictEqual(studentsRepo.search(db, YEAR, QUALIFIANT, { name: 'تلميذ' }).length, 1);
console.log('  [ok] list, paginate, codes and search are partitioned');

// ── A code from the other cycle resolves to nothing ────────────────────────
assert.ok(studentsRepo.getByCode(db, 'C1', YEAR, COLLEGIAL));
assert.strictEqual(
    studentsRepo.getByCode(db, 'C1', YEAR, QUALIFIANT),
    undefined,
    'a qualifiant session must not read a collegial student by code'
);
console.log('  [ok] cross-cycle lookup by code returns nothing');

// ── The cycle is never optional ────────────────────────────────────────────
for (const call of [
    () => studentsRepo.listByYear(db, YEAR),
    () => studentsRepo.getByCode(db, 'Q1', YEAR, ''),
    () => studentsRepo.insertOne(db, student('X1', 'x', QUALIFIANT), null),
    () => studentsRepo.deleteByYear(db, YEAR, undefined)
]) {
    assert.throws(call, /السلك التعليمي غير محدد/, 'a missing cycle must fail loudly, never default');
}
console.log('  [ok] a missing cycle throws instead of silently widening scope');

// ── Sync identity stays cycle-independent (D3) ─────────────────────────────
const byKeys = studentsRepo.findByLocalKeys(db, { school_year: YEAR, code: 'C1' });
assert.strictEqual(byKeys.code, 'C1', 'sync resolves a student by school_year+code alone');
console.log('  [ok] sync identity is not partitioned by cycle');

// ── Writes cannot cross the boundary by id ─────────────────────────────────
const collegialId = studentsRepo.getByCode(db, 'C1', YEAR, COLLEGIAL).id;
assert.strictEqual(
    studentsRepo.updateById(db, collegialId, { full_name: 'مسروق' }, QUALIFIANT).updated,
    0,
    'another cycle id must not be editable'
);
assert.strictEqual(studentsRepo.getByCode(db, 'C1', YEAR, COLLEGIAL).full_name, 'تلميذ إعدادي');

studentsRepo.updateById(db, collegialId, { full_name: 'اسم جديد', cycle_code: QUALIFIANT }, COLLEGIAL);
const afterUpdate = studentsRepo.getByCode(db, 'C1', YEAR, COLLEGIAL);
assert.strictEqual(afterUpdate.full_name, 'اسم جديد');
assert.strictEqual(afterUpdate.cycle_code, COLLEGIAL, 'cycle_code is not an editable field');

assert.strictEqual(
    studentsRepo.deleteById(db, collegialId, QUALIFIANT).deleted,
    0,
    'another cycle id must not be deletable'
);
assert.strictEqual(
    studentsRepo.updateStatusBulk(db, [{ student_id: collegialId, status: 'dropout' }], QUALIFIANT),
    0,
    'bulk status changes stay inside the cycle'
);
console.log('  [ok] update, delete and bulk status refuse another cycle id');

// ── Bulk import never moves a student across cycles ────────────────────────
const reimport = studentsRepo.addBulk(db, [student('C1', 'محاولة نقل', QUALIFIANT)], QUALIFIANT);
assert.strictEqual(reimport.count, 0, 'the row belongs to another cycle — nothing written');
assert.strictEqual(reimport.skippedOtherCycle, 1, 'the skip is reported, not silent');
const afterImport = studentsRepo.getByCode(db, 'C1', YEAR, COLLEGIAL);
assert.strictEqual(afterImport.full_name, 'اسم جديد', 'the other cycle row is untouched');
assert.strictEqual(afterImport.cycle_code, COLLEGIAL);

const freshImport = studentsRepo.addBulk(db, [student('Q2', 'تلميذ جديد', QUALIFIANT)], QUALIFIANT);
assert.strictEqual(freshImport.count, 1);
assert.strictEqual(freshImport.skippedOtherCycle, 0);
console.log('  [ok] re-import cannot pull a student into the importing cycle');

// ── deleteByYear takes one cycle's students and only their dependents ──────
const qualifiantId = studentsRepo.getByCode(db, 'Q1', YEAR, QUALIFIANT).id;
db.prepare('INSERT INTO grades(student_id, student_code, subject, grade, semester, school_year) VALUES(?,?,?,?,?,?)')
    .run(qualifiantId, 'Q1', 'الرياضيات', 14, 1, YEAR);
db.prepare('INSERT INTO grades(student_id, student_code, subject, grade, semester, school_year) VALUES(?,?,?,?,?,?)')
    .run(collegialId, 'C1', 'الرياضيات', 12, 1, YEAR);
db.prepare('INSERT INTO absences(student_id, student_code, month, absence_type, school_year) VALUES(?,?,?,?,?)')
    .run(collegialId, 'C1', '09', 'unjustified', YEAR);

const deleted = studentsRepo.deleteByYear(db, YEAR, QUALIFIANT);
assert.strictEqual(deleted, 2, 'both qualifiant students for the year are removed');
assert.deepStrictEqual(
    studentsRepo.listByYear(db, YEAR, COLLEGIAL).map((row) => row.code),
    ['C1'],
    'the collegial student survives a qualifiant year purge'
);
assert.strictEqual(
    db.prepare('SELECT COUNT(*) AS c FROM grades WHERE student_id = ?').get(collegialId).c,
    1,
    "the other cycle's grades are not swept up by a year delete"
);
assert.strictEqual(
    db.prepare('SELECT COUNT(*) AS c FROM absences WHERE student_id = ?').get(collegialId).c,
    1,
    "the other cycle's absences survive"
);
assert.strictEqual(
    db.prepare('SELECT COUNT(*) AS c FROM grades WHERE student_id = ?').get(qualifiantId).c,
    0,
    "the deleted students' own grades are removed"
);
console.log('  [ok] year purge is cycle-scoped and cascades only its own students');

console.log('[test] students cycle isolation: all checks passed');
