'use strict';

/**
 * Orientation repo contract — multi-stage plan §3 S6 row 132 + §3 S8 row 146.
 *
 * Pinned behaviors:
 * - every list/stats repo query forces `school_year`; `cycle_code` is always read
 *   from the snapshot column, never from the renderer;
 * - repo writes strip renderer-supplied `cycle_code`/`cycleCode` and store the value
 *   derived in main from the students roster;
 * - a later change of the student's cycle never reclassifies existing orientation
 *   history (the snapshot survives updates, and updates work even when the student
 *   left the roster);
 * - on the production schema (students carries `cycle_code`) an insert for a
 *   non-existent student is REJECTED; pre-081 fixtures keep the legacy NULL-write
 *   fallback, and the `NULL AS cycle_code` list fallback is schema-gated;
 * - resolveCycleForRequest fails closed when the institution has ZERO supported
 *   cycles (empty institution_cycles, or only preview rows) — no context case.
 */

const assert = require('assert');

const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
const orientationRepo = require('../main/repos/orientation');
const { ensureInstitutionCyclesSchema } = require('../main/db/schema');
const { getActiveSessions } = require('../main/ipc/auth');
const { resolveCycleForRequest } = require('../main/auth/resolve-cycle');

const QUALIFIANT = 'secondary_qualifiant';
const PRIMARY = 'primary';
const COLLEGIAL = 'secondary_collegial';
const YEAR = '2025/2026';
const PREV_YEAR = '2024/2025';

console.log('[test] orientation contract (repo snapshot + fail-closed resolution)');

// ── In-memory DB helper (better-sqlite3 preferred, node:sqlite fallback) ───
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
    db.pragma = (statement) => db.prepare(`PRAGMA ${statement}`).all();
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

// Production shape (post 2026-08-081): students + orientation both carry cycle_code.
function createProductionSchema(db) {
    db.exec(`
        CREATE TABLE students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            full_name TEXT NOT NULL,
            gender TEXT,
            section TEXT,
            school_year TEXT NOT NULL,
            cycle_code TEXT
        );
        CREATE TABLE student_orientation (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_code TEXT NOT NULL,
            full_name TEXT,
            gender TEXT,
            section TEXT,
            level TEXT,
            origin_stream TEXT NOT NULL,
            choice_1 TEXT,
            choice_2 TEXT,
            choice_3 TEXT,
            assigned_stream TEXT,
            decision_status TEXT,
            average REAL,
            rank_num INTEGER,
            notes TEXT,
            cycle_code TEXT,
            school_year TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(student_code, school_year)
        );
    `);
}

function insertStudent(db, code, name, year, cycle) {
    db.prepare(
        'INSERT INTO students(code, full_name, gender, section, school_year, cycle_code) VALUES(?,?,?,?,?,?)'
    ).run(code, name, 'M', '1A', year, cycle);
}

function rowByCode(db, code, year) {
    return db
        .prepare('SELECT * FROM student_orientation WHERE student_code = ? AND school_year = ?')
        .get(code, year);
}

setRepoCapturePort(createNoOpCapturePort());

// ── Fixture: two school years, one student present in both ────────────────
const db = openDb();
createProductionSchema(db);
insertStudent(db, 'S1', 'تلميذ أول', YEAR, QUALIFIANT);
insertStudent(db, 'S1', 'تلميذ أول', PREV_YEAR, PRIMARY);
insertStudent(db, 'S2', 'تلميذ ثان', YEAR, QUALIFIANT);
insertStudent(db, 'S3', 'تلميذ ثالث', YEAR, QUALIFIANT);

// ── (a) every list/stats repo query forces school_year ─────────────────────
let r = orientationRepo.bulkUpsert(
    db,
    { rows: [{ student_code: 'S1', origin_stream: 'علوم', choice_1: 'شعبة أ' }] },
    YEAR,
    (y) => y
);
assert.strictEqual(r.inserted, 1);
r = orientationRepo.bulkUpsert(
    db,
    { rows: [{ student_code: 'S2', origin_stream: 'آداب', choice_1: 'شعبة ب' }] },
    YEAR,
    (y) => y
);
assert.strictEqual(r.inserted, 1);
r = orientationRepo.bulkUpsert(
    db,
    { rows: [{ student_code: 'S1', origin_stream: 'علوم', choice_1: 'شعبة قديمة' }] },
    PREV_YEAR,
    (y) => y
);
assert.strictEqual(r.inserted, 1);

const listedYear = orientationRepo.list(db, YEAR);
assert.strictEqual(listedYear.success, true);
assert.deepStrictEqual(
    listedYear.rows.map((row) => row.student_code).sort(),
    ['S1', 'S2'],
    'only this year rows are returned'
);
assert.ok(listedYear.rows.every((row) => row.school_year === YEAR), 'no cross-year rows leak into the list');
assert.strictEqual(
    listedYear.rows.find((row) => row.student_code === 'S1').cycle_code,
    QUALIFIANT,
    'list reads the snapshot cycle_code, never a renderer value'
);

const listedPrev = orientationRepo.list(db, PREV_YEAR);
assert.strictEqual(listedPrev.rows.length, 1);
assert.strictEqual(listedPrev.rows[0].student_code, 'S1');
assert.strictEqual(
    listedPrev.rows[0].cycle_code,
    PRIMARY,
    'the snapshot reflects the roster of that year (primary back then)'
);
assert.strictEqual(
    listedPrev.rows[0].student_id,
    2,
    'the roster join is keyed on (school_year, code), not the latest student row'
);

assert.strictEqual(orientationRepo.stats(db, YEAR).summary.total, 2, 'stats count this year only');
assert.strictEqual(orientationRepo.stats(db, PREV_YEAR).summary.total, 1);
assert.strictEqual(orientationRepo.stats(db, YEAR).byOrigin.length, 2);
console.log('  [ok] list/stats force school_year; cycle_code read from the snapshot');

// ── (b) writes strip renderer-supplied cycle_code/cycleCode ────────────────
r = orientationRepo.bulkUpsert(
    db,
    {
        rows: [
            {
                student_code: 'S1',
                origin_stream: 'علوم',
                cycle_code: PRIMARY,
                cycleCode: PRIMARY,
                decision_status: 'مقبول'
            },
            { student_code: 'S3', full_name: 'تلميذ ثالث', origin_stream: 'علوم', cycle_code: PRIMARY }
        ]
    },
    YEAR,
    (y) => y
);
assert.strictEqual(r.inserted, 1, 'only S3 is a new row');
assert.strictEqual(r.updated, 1, 'S1 updates');
assert.deepStrictEqual(r.unresolvedCycle, [], 'both rows resolved from the roster');
assert.strictEqual(
    rowByCode(db, 'S1', YEAR).cycle_code,
    QUALIFIANT,
    'update keeps the existing snapshot — renderer cycle ignored'
);
assert.strictEqual(
    rowByCode(db, 'S3', YEAR).cycle_code,
    QUALIFIANT,
    'insert derives the cycle from the roster — renderer cycle stripped'
);
console.log('  [ok] renderer-supplied cycle_code/cycleCode never reaches storage');

// ── (c) a later student cycle change never reclassifies history ────────────
db.prepare('UPDATE students SET cycle_code = ? WHERE code = ? AND school_year = ?').run(COLLEGIAL, 'S1', YEAR);
r = orientationRepo.bulkUpsert(
    db,
    { rows: [{ student_code: 'S1', origin_stream: 'علوم', decision_status: 'مؤجل' }] },
    YEAR,
    (y) => y
);
assert.strictEqual(r.updated, 1);
assert.strictEqual(
    rowByCode(db, 'S1', YEAR).cycle_code,
    QUALIFIANT,
    'the snapshot survives a later change of the student cycle'
);
assert.strictEqual(rowByCode(db, 'S1', PREV_YEAR).cycle_code, PRIMARY, 'older-year history keeps its own snapshot');

db.prepare('DELETE FROM students WHERE code = ? AND school_year = ?').run('S1', YEAR);
r = orientationRepo.bulkUpsert(
    db,
    { rows: [{ student_code: 'S1', origin_stream: 'علوم', decision_status: 'قبول نهائي' }] },
    YEAR,
    (y) => y
);
assert.strictEqual(r.updated, 1, 'updates still work once the student left the roster');
assert.strictEqual(rowByCode(db, 'S1', YEAR).cycle_code, QUALIFIANT, 'the snapshot still survives');
console.log('  [ok] history is immutable — student cycle changes never reclassify it');

// ── (d) production schema: insert for a non-existent student is rejected ───
r = orientationRepo.bulkUpsert(
    db,
    { rows: [{ student_code: 'GHOST', origin_stream: 'X' }] },
    YEAR,
    (y) => y
);
assert.strictEqual(r.inserted, 0);
assert.strictEqual(r.skipped, 1);
assert.deepStrictEqual(r.unresolvedCycle, [{ student_code: 'GHOST', reason: 'no_matching_student' }]);
assert.strictEqual(rowByCode(db, 'GHOST', YEAR), undefined, 'no row is written for an unknown student');
const ghostDetail = r.details.find((detail) => detail.student_code === 'GHOST');
assert.strictEqual(ghostDetail.outcome, 'skipped');
assert.strictEqual(ghostDetail.reason, 'no_matching_student');

// A student on another year's roster does not satisfy this year's roster lookup.
insertStudent(db, 'S4', 'تلميذ سابق', PREV_YEAR, QUALIFIANT);
r = orientationRepo.bulkUpsert(
    db,
    { rows: [{ student_code: 'S4', origin_stream: 'X' }] },
    YEAR,
    (y) => y
);
assert.strictEqual(r.inserted, 0);
assert.strictEqual(r.skipped, 1);
assert.deepStrictEqual(r.unresolvedCycle, [{ student_code: 'S4', reason: 'no_matching_student' }]);
console.log('  [ok] insert is rejected when the student is not on this year roster');

// ── (d) pre-081 fixtures keep the legacy NULL-write fallback ───────────────
// Hybrid legacy shape: orientation already carries cycle_code, students does not —
// the cycle cannot be derived, so the row is written NULL and reported, never
// guessed, and never rejected (the row would otherwise be lost on old schemas).
const legacyDb = openDb();
legacyDb.exec(`
    CREATE TABLE students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        full_name TEXT NOT NULL,
        gender TEXT,
        section TEXT,
        school_year TEXT NOT NULL
    );
    CREATE TABLE student_orientation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_code TEXT NOT NULL,
        full_name TEXT,
        gender TEXT,
        section TEXT,
        level TEXT,
        origin_stream TEXT NOT NULL,
        choice_1 TEXT,
        choice_2 TEXT,
        choice_3 TEXT,
        assigned_stream TEXT,
        decision_status TEXT,
        average REAL,
        rank_num INTEGER,
        notes TEXT,
        cycle_code TEXT,
        school_year TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_code, school_year)
    );
`);
r = orientationRepo.bulkUpsert(
    legacyDb,
    { rows: [{ student_code: 'L1', full_name: 'قديم', origin_stream: 'X' }] },
    YEAR,
    (y) => y
);
assert.strictEqual(r.inserted, 1, 'pre-081 fixtures keep the legacy NULL-write fallback');
assert.deepStrictEqual(r.unresolvedCycle, [{ student_code: 'L1', reason: 'no_matching_student' }]);
assert.strictEqual(rowByCode(legacyDb, 'L1', YEAR).cycle_code, null, 'the fallback writes NULL, never a guess');

// The `NULL AS cycle_code` list fallback is schema-gated: only a table without the
// column gets the alias — a production table can never produce a cycle-less row.
const pre081Db = openDb();
pre081Db.exec(`
    CREATE TABLE students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        full_name TEXT NOT NULL,
        gender TEXT,
        section TEXT,
        school_year TEXT NOT NULL
    );
    CREATE TABLE student_orientation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_code TEXT NOT NULL,
        full_name TEXT,
        gender TEXT,
        section TEXT,
        level TEXT,
        origin_stream TEXT NOT NULL,
        choice_1 TEXT,
        choice_2 TEXT,
        choice_3 TEXT,
        assigned_stream TEXT,
        decision_status TEXT,
        average REAL,
        rank_num INTEGER,
        notes TEXT,
        school_year TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_code, school_year)
    );
`);
pre081Db
    .prepare('INSERT INTO student_orientation(student_code, full_name, origin_stream, school_year) VALUES(?,?,?,?)')
    .run('P1', 'قديم', 'X', YEAR);
const pre081Listed = orientationRepo.list(pre081Db, YEAR);
assert.strictEqual(pre081Listed.rows.length, 1);
assert.strictEqual(
    pre081Listed.rows[0].cycle_code,
    null,
    'only a pre-081 table surfaces the NULL alias — never a production schema'
);
pre081Db.close();
legacyDb.close();
console.log('  [ok] legacy fallbacks are fixture-only; production schemas never write cycle-less rows');

// ── (e) zero supported cycles → resolveCycleForRequest fails closed ────────
const resDb = openDb();
ensureInstitutionCyclesSchema(resDb);
const sessions = getActiveSessions();
const sender = { id: 8001 };
const event = { sender };
sessions.set(sender.id, { userId: 8, role: 'admin', locked: false });

assert.throws(
    () => resolveCycleForRequest(resDb, event),
    (err) => /لا يوجد سلك/.test(err.message),
    'empty institution_cycles → no usable cycle → fails closed'
);

resDb.prepare(
    `INSERT INTO institution_cycles (cycle_code, is_active, profile_version, sort_order)
     VALUES (?, 1, ?, ?)`
).run(PRIMARY, 'primary-2026-v1', 5);
assert.throws(
    () => resolveCycleForRequest(resDb, event),
    (err) => /لا يوجد سلك/.test(err.message),
    'only the primary preview cycle → no supported cycle → fails closed'
);
console.log('  [ok] resolution fails closed with zero supported cycles (empty or preview-only)');

// ── Cleanup ────────────────────────────────────────────────────────────────
sessions.delete(sender.id);
resDb.close();
db.close();
setRepoCapturePort(null);

console.log('[test] orientation contract (repo snapshot + fail-closed resolution): all checks passed');
