'use strict';

/**
 * Phase 3 (2026-08-03 multi-stage management review verdict) — supported-cycle
 * writes enforced at the repo boundary.
 *
 * The shared `requireCycle` guard (main/repos/student-cycle.js) resolves the static
 * catalog entry and requires `capability === 'supported'`. Preview (`primary`) and
 * unknown cycles must never accept a normal repo write, and the guard must remain a
 * pure static check (no DB lookup) so migration and sync-apply paths — which write
 * their legitimate preview rows directly, never through these school-data repos —
 * are unaffected.
 *
 *   a. pure guard: empty cycle, unknown code, hidden/preview cycle all throw with
 *      the Arabic contract; supported cycles pass;
 *   b. property-style over the catalog: every repo write with a capability other
 *      than `supported` is rejected, while each supported cycle is accepted when
 *      the remaining payload is valid;
 *   c. the students.js duplicate delegator behaves identically (no weaker guard);
 *   d. the timetable.js delegate behaves identically (no weaker guard);
 *   e. migration/sync regression: migrations.js and the sync engine never import
 *      these school-data repos, so their legitimate preview rows are unaffected.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { getCycleDefinition, CYCLE_CATALOG } = require('../js/shared/education/cycles');
const { requireCycle } = require('../main/repos/student-cycle');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
const studentsRepo = require('../main/repos/students');
const gradesRepo = require('../main/repos/grades');
const absencesRepo = require('../main/repos/absences');

const QUALIFIANT = 'secondary_qualifiant';
const COLLEGIAL = 'secondary_collegial';
const PRIMARY = 'primary';
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
    `);
}

function student(code) {
    return { code, full_name: 'تلميذ', family_name: '', birth_date: '', birth_place: '', gender: 'M', section: '1A', level: '', school_name: '', school_year: YEAR, status: 'active', registration_type: 'new' };
}

async function run() {
    console.log('[test] supported-cycle writes at the repo boundary');

    // ── a. pure guard: established contract for empty / unknown / preview ──
    assert.throws(() => requireCycle(''), /السلك التعليمي غير محدد/);
    assert.throws(() => requireCycle(null), /السلك التعليمي غير محدد/);
    assert.throws(() => requireCycle('   '), /السلك التعليمي غير محدد/);
    assert.throws(() => requireCycle('not_a_cycle'), /غير معروف/);
    assert.throws(() => requireCycle(PRIMARY), /قيد الإعداد/);
    assert.strictEqual(requireCycle(QUALIFIANT), QUALIFIANT);
    assert.strictEqual(requireCycle(COLLEGIAL), COLLEGIAL);
    console.log('  [ok] a. pure guard: empty/unknown/preview throw, supported passes');

    // ── b. catalog property + repo writes through the shared guard ──
    const db = openDb();
    if (!db) {
        console.log('cycle-capability-writes.test.js: SKIPPED (no SQLite driver available)');
        return;
    }
    createSchema(db);
    setRepoCapturePort(createNoOpCapturePort());

    for (const cycle of CYCLE_CATALOG) {
        const code = cycle.cycleCode;
        const definition = getCycleDefinition(code);
        assert.strictEqual(definition.capability, cycle.capability, 'catalog self-consistency');

        const studentCode = `S-${code}`;
        const gradePayload = { student_code: studentCode, subject: 'الرياضيات', grade: 15, semester: 1, teacher_name: '', level: '', section: '1A', school_year: YEAR };
        const absencePayload = { student_code: studentCode, absence_date: '2025-09-10', month: '09', absence_type: 'unjustified', hours: 2, days: 0, reason: '', school_year: YEAR };

        if (cycle.capability === 'supported') {
            studentsRepo.insertOne(db, student(studentCode), code);
            assert.strictEqual(gradesRepo.saveOne(db, gradePayload, code).success, true, `${code} grade write accepted`);
            assert.strictEqual(absencesRepo.saveOne(db, absencePayload, code).success, true, `${code} absence write accepted`);
        } else {
            assert.throws(() => studentsRepo.insertOne(db, student(studentCode), code), /قيد الإعداد|غير معروف/);
            assert.throws(() => gradesRepo.saveOne(db, gradePayload, code), /قيد الإعداد|غير معروف/);
            assert.throws(() => absencesRepo.saveOne(db, absencePayload, code), /قيد الإعداد|غير معروف/);
        }
    }
    console.log('  [ok] b. catalog property: preview/hidden write rejected, supported accepted');

    // The students.js delegator must not be weaker than the shared guard.
    assert.throws(() => studentsRepo.insertOne(db, student('P1'), PRIMARY), /قيد الإعداد/);
    assert.throws(() => studentsRepo.insertOne(db, student('P2'), 'unknown-cycle'), /غير معروف/);
    console.log('  [ok] c. students.js shared requireCycle delegator matches the repo guard');

    // The timetable delegate keeps the same contract.
    const timetableRepo = require('../main/repos/timetable');
    assert.throws(() => timetableRepo.upsertByCycle(db, YEAR, PRIMARY, '{}'), /قيد الإعداد/);
    assert.throws(() => timetableRepo.getByCycle(db, YEAR, PRIMARY), /قيد الإعداد/);
    console.log('  [ok] d. timetable.js shared requireCycle delegator matches the repo guard');

    const root = path.join(__dirname, '..');
    const sources = {
        migrations: fs.readFileSync(path.join(root, 'main', 'db', 'migrations.js'), 'utf8'),
        'sync engine apply': fs.readFileSync(path.join(root, 'main', 'sync', 'engine', 'apply.js'), 'utf8'),
        'sync engine helpers': fs.readFileSync(path.join(root, 'main', 'sync', 'engine', 'helpers.js'), 'utf8')
    };
    const forbiddenImport = /require\(['"]\.{0,2}\/?(?:main\/)?repos\/(students|grades|absences|exams|timetable|student-cycle)['"]\)/;
    for (const [name, source] of Object.entries(sources)) {
        assert.ok(
            !forbiddenImport.test(source),
            `${name} must not import school-data repos (preview seeding writes directly)`
        );
    }
    console.log('  [ok] e. migration/sync regression: no school-data repo import in those paths');

    db.close();
    setRepoCapturePort(null);
    console.log('cycle-capability-writes.test.js: OK');
}

run().catch((error) => {
    console.error('cycle-capability-writes.test.js: FAILED');
    console.error(error);
    process.exit(1);
});