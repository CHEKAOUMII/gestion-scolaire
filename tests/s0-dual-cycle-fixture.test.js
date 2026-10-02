'use strict';

/**
 * S0 — two-supported-cycle isolation fixture
 * (docs/plans/2026-08-02-multi-stage-school-architecture.md, §3 S0).
 *
 * The shipped catalog has exactly one supported cycle, so this file builds a fixture
 * in which BOTH secondary cycles are `supported` (module-level swap of the shared
 * catalog, isolated in this subprocess) and proves:
 *   - a context in A never resolves into B, and vice versa; repo reads/writes under
 *     the resolved cycle never touch the other cycle's rows;
 *   - an unauthorized user is rejected even with a cached context (FORBIDDEN);
 *   - with two supported cycles and no context, the request fails instead of
 *     guessing one;
 *   - a user with zero grants cannot fall through to any cycle.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

// ── Swap the shared catalog before any consumer loads it ───────────────────
// S1 retired the `not_supported` alias: primary and collegial now carry the
// literal `preview` capability. Promoting every `preview` entry to `supported`
// makes both secondary cycles workable in this fixture; `primary` is also
// promoted in-process, but resolution only ever considers institution-
// registered cycles (the fixture seeds qualifiant + collegial only), so the
// isolation assertions below are unaffected.
const CATALOG_PATH = path.resolve(__dirname, '..', 'js', 'shared', 'education', 'cycles.js');
const PREVIEW_LINE = "capability: 'preview'";
const swappedSource = fs.readFileSync(CATALOG_PATH, 'utf8').replaceAll(PREVIEW_LINE, "capability: 'supported'");
assert.ok(
    !swappedSource.includes(PREVIEW_LINE),
    'fixture swap must promote every preview cycle entry to supported'
);
const swappedModule = new Module(CATALOG_PATH, module);
swappedModule.filename = CATALOG_PATH;
swappedModule.paths = Module._nodeModulePaths(path.dirname(CATALOG_PATH));
swappedModule._compile(swappedSource, CATALOG_PATH);
swappedModule.loaded = true;
require.cache[CATALOG_PATH] = swappedModule;

const context = require('../main/db/context');
const { ensureInstitutionCyclesSchema } = require('../main/db/schema');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
const { getCycleDefinition } = require('../js/shared/education/cycles');
const { resolveCycleForRequest } = require('../main/auth/resolve-cycle');
const { setContext, clearContextForSender } = require('../main/auth/active-cycle-context');
const { getActiveSessions } = require('../main/ipc/auth');
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

function createStudentsSchema(db) {
    db.exec(`
        CREATE TABLE students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
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
        CREATE TABLE student_profile_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER, student_code TEXT, tab_key TEXT, school_year TEXT
        );
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

const db = openDb();
ensureInstitutionCyclesSchema(db);
db.prepare(
    `INSERT OR IGNORE INTO institution_cycles (cycle_code, is_active, seed_profile_version_hint, sort_order)
     VALUES (?, 1, ?, ?)`
).run(QUALIFIANT, 'qualifiant-2026-v1', 20);
db.prepare(
    `INSERT OR IGNORE INTO institution_cycles (cycle_code, is_active, seed_profile_version_hint, sort_order)
     VALUES (?, 1, ?, ?)`
).run(COLLEGIAL, 'collegial-2026-v1', 10);
createStudentsSchema(db);
context.setDb(db);
setRepoCapturePort(createNoOpCapturePort());

console.log('[test] S0 two-supported-cycle isolation fixture');

// ── Fixture sanity: both cycles are supported now ──────────────────────────
assert.strictEqual(getCycleDefinition(QUALIFIANT).capability, 'supported');
assert.strictEqual(getCycleDefinition(COLLEGIAL).capability, 'supported', 'fixture: both cycles workable');
console.log('  [ok] fixture exposes two supported cycles');

studentsRepo.insertOne(db, student('Q1', 'تلميذ تأهيلي', QUALIFIANT), QUALIFIANT);
studentsRepo.insertOne(db, student('C1', 'تلميذ إعدادي', COLLEGIAL), COLLEGIAL);

const sessions = getActiveSessions();
const adminSender = { id: 8001 };
const adminEvent = { sender: adminSender };
sessions.set(adminSender.id, { userId: 1, role: 'admin', locked: false });

// ── Context in A stays in A; context in B stays in B ───────────────────────
setContext(adminEvent, 1, QUALIFIANT, YEAR);
assert.strictEqual(resolveCycleForRequest(db, adminEvent), QUALIFIANT);
const resolvedA = resolveCycleForRequest(db, adminEvent);
assert.deepStrictEqual(
    studentsRepo.listByYear(db, YEAR, resolvedA).map((row) => row.code),
    ['Q1'],
    'a cycle-A context only ever sees cycle-A rows'
);
const collegialId = studentsRepo.getByCode(db, 'C1', YEAR, COLLEGIAL).id;
assert.strictEqual(
    studentsRepo.updateById(db, collegialId, { full_name: 'مسروق' }, resolvedA).updated,
    0,
    'a cycle-A context cannot write cycle-B rows by id'
);

setContext(adminEvent, 1, COLLEGIAL, YEAR);
assert.strictEqual(resolveCycleForRequest(db, adminEvent), COLLEGIAL);
const resolvedB = resolveCycleForRequest(db, adminEvent);
assert.deepStrictEqual(
    studentsRepo.listByYear(db, YEAR, resolvedB).map((row) => row.code),
    ['C1'],
    'a cycle-B context only ever sees cycle-B rows'
);
const qualifiantId = studentsRepo.getByCode(db, 'Q1', YEAR, QUALIFIANT).id;
assert.strictEqual(
    studentsRepo.updateById(db, qualifiantId, { full_name: 'مسروق' }, resolvedB).updated,
    0,
    'a cycle-B context cannot write cycle-A rows by id'
);
console.log('  [ok] contexts in A and B stay isolated for reads and writes');

// ── Unauthorized user is rejected even with a cached context ───────────────
db.exec(`
    CREATE TABLE user_cycle_access (
        user_id INTEGER NOT NULL,
        cycle_code TEXT NOT NULL,
        PRIMARY KEY (user_id, cycle_code)
    )
`);
db.prepare('INSERT INTO user_cycle_access (user_id, cycle_code) VALUES (?, ?)').run(9, QUALIFIANT);
const teacherSender = { id: 8002 };
const teacherEvent = { sender: teacherSender };
sessions.set(teacherSender.id, { userId: 9, role: 'teacher', locked: false });
setContext(teacherEvent, 9, COLLEGIAL, YEAR);
assert.throws(
    () => resolveCycleForRequest(db, teacherEvent),
    (err) => err.code === 'FORBIDDEN',
    'a cached context outside the user grant is rejected'
);
console.log('  [ok] unauthorized user is rejected');

// ── Restricted user with one grant and no context → resolves that grant ────
clearContextForSender(teacherSender.id);
assert.strictEqual(resolveCycleForRequest(db, teacherEvent), QUALIFIANT);
console.log('  [ok] a single authorized cycle resolves without a context');

// ── No context + two supported cycles → fails closed, never guesses ────────
clearContextForSender(adminSender.id);
assert.throws(
    () => resolveCycleForRequest(db, adminEvent),
    (err) => /يتعذر تحديد السلك/.test(err.message),
    'two supported cycles without a context must fail instead of picking one'
);
console.log('  [ok] missing context with two supported cycles fails closed');

// ── User with zero grants → no usable cycle ────────────────────────────────
const emptySender = { id: 8003 };
sessions.set(emptySender.id, { userId: 10, role: 'teacher', locked: false });
assert.throws(
    () => resolveCycleForRequest(db, { sender: emptySender }),
    (err) => /لا يوجد سلك مصرح/.test(err.message),
    'a user with zero grants cannot fall through to any cycle'
);
console.log('  [ok] zero grants fails closed');

// ── Cleanup ────────────────────────────────────────────────────────────────
clearContextForSender(adminSender.id);
clearContextForSender(teacherSender.id);
sessions.delete(adminSender.id);
sessions.delete(teacherSender.id);
sessions.delete(emptySender.id);
setRepoCapturePort(null);
delete require.cache[CATALOG_PATH];
if (typeof db.close === 'function') db.close();

console.log('[test] S0 two-supported-cycle isolation fixture: all checks passed');
