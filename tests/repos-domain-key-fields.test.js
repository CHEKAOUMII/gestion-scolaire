'use strict';

/**
 * WP4 repository tests: declared local key fields + school_year filtering,
 * covering students / grades / absences against a real SQL engine.
 *
 * This used to run on a hand-written in-memory stub that destructured every INSERT's
 * parameters positionally. That stub silently decayed each time a column was added
 * (`level`, `school_name`, then `cycle_code`), because the positional unpacking kept
 * "succeeding" against shifted values. It now uses better-sqlite3 when its native ABI
 * matches and the built-in node:sqlite otherwise, so a schema change surfaces as a real
 * SQL error instead of a mystery assertion.
 */

const assert = require('assert');
const studentsRepo = require('../main/repos/students');
const gradesRepo = require('../main/repos/grades');
const absencesRepo = require('../main/repos/absences');
const studentFilesRepo = require('../main/repos/student-files');
const { getLocalKeyFields } = require('../main/sync/entity-registry');
const { setCaptureGetDb } = require('../main/sync/capture');
const { PRODUCTION_DDL } = require('./fixtures/sync-outbox-db');

const CYCLE = 'secondary_qualifiant';

// Domain tables mirrored from main/db/schema.js + the migrations that shaped them,
// trimmed to the columns these repositories touch.
const DOMAIN_DDL = `
    CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT, full_name TEXT NOT NULL, family_name TEXT,
        birth_date TEXT, birth_place TEXT, gender TEXT,
        section TEXT, level TEXT, school_name TEXT, school_year TEXT,
        status TEXT DEFAULT 'active', registration_type TEXT DEFAULT 'new',
        cycle_code TEXT NOT NULL DEFAULT 'secondary_qualifiant',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(code, school_year)
    );
    CREATE TABLE IF NOT EXISTS grades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER, student_code TEXT, teacher_id INTEGER,
        subject TEXT, grade REAL, semester INTEGER, teacher_name TEXT,
        level TEXT, section TEXT, school_year TEXT,
        cycle_code TEXT NOT NULL DEFAULT 'secondary_qualifiant',
        UNIQUE(student_code, subject, semester, school_year)
    );
    CREATE TABLE IF NOT EXISTS absences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER, student_code TEXT, absence_date TEXT, month TEXT,
        absence_type TEXT, hours REAL, days REAL, reason TEXT, school_year TEXT,
        cycle_code TEXT NOT NULL DEFAULT 'secondary_qualifiant',
        UNIQUE(student_code, month, school_year, absence_type)
    );
    CREATE TABLE IF NOT EXISTS correspondence (
        id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, school_year TEXT
    );
    CREATE TABLE IF NOT EXISTS student_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, doc_key TEXT, school_year TEXT
    );
    CREATE TABLE IF NOT EXISTS student_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, movement_type TEXT,
        movement_date TEXT, notes TEXT, school_year TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`;

function createMemoryDb() {
    let db;
    try {
        const Database = require('better-sqlite3');
        const probe = new Database(':memory:');
        probe.close();
        db = new Database(':memory:');
    } catch {
        const { DatabaseSync } = require('node:sqlite');
        db = new DatabaseSync(':memory:');
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
        // node:sqlite binds every JS number as a double, so `CAST(? AS TEXT)` on an
        // integer produces '1.0' where better-sqlite3 (production) produces '1' — which
        // silently breaks the semester comparison in grades.findByLocalKeys. Bind integral
        // numbers as BigInt so the fallback engine matches production affinity.
        const rawPrepare = db.prepare.bind(db);
        const asSqliteInts = (params) =>
            params.map((value) => (typeof value === 'number' && Number.isInteger(value) ? BigInt(value) : value));
        db.prepare = (sql) => {
            const stmt = rawPrepare(sql);
            return {
                run: (...params) => stmt.run(...asSqliteInts(params)),
                get: (...params) => stmt.get(...asSqliteInts(params)),
                all: (...params) => stmt.all(...asSqliteInts(params))
            };
        };
    }
    db.exec(PRODUCTION_DDL);
    db.exec(DOMAIN_DDL);
    return db;
}

function countRows(db, table) {
    return db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get().c;
}

console.log('[test] WP4 domain repositories key fields + year filter');

assert.deepStrictEqual(studentsRepo.STUDENT_KEY_FIELDS, ['school_year', 'code']);
assert.deepStrictEqual(gradesRepo.GRADE_KEY_FIELDS, [
    'school_year',
    'student_code',
    'subject',
    'semester'
]);
assert.deepStrictEqual(absencesRepo.ABSENCE_KEY_FIELDS, [
    'school_year',
    'student_code',
    'month',
    'absence_type'
]);
assert.deepStrictEqual(studentFilesRepo.STUDENT_FILES_KEY_FIELDS, [
    'student_id',
    'doc_key',
    'school_year'
]);
assert.deepStrictEqual(getLocalKeyFields('student_movements'), ['id']);
assert.deepStrictEqual(getLocalKeyFields('correspondence'), ['id']);
console.log('  [ok] declared local key fields match entity registry');

const db = createMemoryDb();
setCaptureGetDb(() => db);

// Cross-year students share code without colliding
studentsRepo.insertOne(db, {
    code: 'S1',
    full_name: 'Year A',
    family_name: '',
    birth_date: '',
    gender: 'M',
    section: '1A',
    school_year: '2025/2026',
    status: 'active',
    registration_type: 'new'
}, CYCLE);
studentsRepo.insertOne(db, {
    code: 'S1',
    full_name: 'Year B',
    family_name: '',
    birth_date: '',
    gender: 'M',
    section: '1A',
    school_year: '2026/2027',
    status: 'active',
    registration_type: 'new'
}, CYCLE);

const a = studentsRepo.findByLocalKeys(db, { school_year: '2025/2026', code: 'S1' });
const b = studentsRepo.findByLocalKeys(db, { school_year: '2026/2027', code: 'S1' });
assert.ok(a && b);
assert.notStrictEqual(a.id, b.id);
assert.strictEqual(a.full_name, 'Year A');
assert.strictEqual(b.full_name, 'Year B');
assert.strictEqual(studentsRepo.listByYear(db, '2025/2026', CYCLE).length, 1);
assert.strictEqual(studentsRepo.listByYear(db, '2026/2027', CYCLE).length, 1);
console.log('  [ok] students year-scoped unique keys + listByYear filter');

// Grades key fields
gradesRepo.saveOne(db, {
    student_id: a.id,
    student_code: 'S1',
    teacher_id: null,
    subject: 'Math',
    grade: 12,
    semester: 1,
    teacher_name: '',
    level: '',
    section: '1A',
    school_year: '2025/2026'
}, CYCLE);
gradesRepo.saveOne(db, {
    student_id: a.id,
    student_code: 'S1',
    teacher_id: null,
    subject: 'Math',
    grade: 15,
    semester: 1,
    teacher_name: '',
    level: '',
    section: '1A',
    school_year: '2025/2026'
}, CYCLE);
const grade = gradesRepo.findByLocalKeys(db, {
    school_year: '2025/2026',
    student_code: 'S1',
    subject: 'Math',
    semester: 1
});
assert.ok(grade);
assert.strictEqual(Number(grade.grade), 15, 'upsert overwrites by logical key');
assert.strictEqual(countRows(db, 'grades'), 1, 'no duplicate grade rows');
console.log('  [ok] grades logical-key upsert');

// Absences key fields
absencesRepo.saveBulk(db, [
    {
        student_id: a.id,
        student_code: 'S1',
        absence_date: '2025-10-01',
        month: '10',
        absence_type: 'unjustified',
        hours: 2,
        days: 0,
        reason: '',
        school_year: '2025/2026'
    },
    {
        student_id: a.id,
        student_code: 'S1',
        absence_date: '2025-10-02',
        month: '10',
        absence_type: 'unjustified',
        hours: 4,
        days: 0,
        reason: '',
        school_year: '2025/2026'
    }
], CYCLE);
const absence = absencesRepo.findByLocalKeys(db, {
    school_year: '2025/2026',
    student_code: 'S1',
    month: '10',
    absence_type: 'unjustified'
});
assert.ok(absence);
assert.strictEqual(Number(absence.hours), 4);
assert.strictEqual(countRows(db, 'absences'), 1);
console.log('  [ok] absences logical-key upsert via saveBulk');

// IPC modules must not embed .prepare SQL for these domains
const fs = require('fs');
const path = require('path');
for (const rel of ['main/ipc/students.js', 'main/ipc/grades.js', 'main/ipc/absences.js', 'main/ipc/schoolOps.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(!src.includes('.prepare('), `${rel} must not own SQL via .prepare`);
    assert.ok(src.includes('../repos/'), `${rel} must use domain repo`);
}
console.log('  [ok] IPC handlers are SQL-free for migrated domains');

setCaptureGetDb(null);
console.log('[test] WP4 domain repositories OK');
