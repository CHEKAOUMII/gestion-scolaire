'use strict';

/**
 * S0/Slice 1 — dual-cycle fixture for the four student child tables
 * (correspondence, student_files, student_movements, student_profile_data).
 *
 * Companion to tests/s0-dual-cycle-fixture.test.js (students only): both
 * secondary cycles are `supported` here (module-level catalog swap, isolated
 * in this subprocess), student codes are DISTINCT per UNIQUE(code,
 * school_year), sections overlap across cycles, and deliberately mismatched
 * (drifted) child rows are present. Proves, in BOTH directions:
 *   - a context in A cannot read or write B's child rows;
 *   - an unauthorized user is rejected even with a cached context (FORBIDDEN);
 *   - two supported cycles without a context fail closed, never guessing;
 *   - every qualifiant report read over the dual fixture returns zero
 *     collegial rows (Slice 1 report-isolation negative test).
 *
 * Fixture tables use the pre-087 legacy shape (nullable cycle_code, no
 * composite FK) so drifted rows can exist; the post-087 DDL contract is
 * covered by tests/s1-student-child-cycle-migration.test.js.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

// ── Swap the shared catalog before any consumer loads it ───────────────────
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
const absencesRepo = require('../main/repos/absences');
const studentFilesRepo = require('../main/repos/student-files');
const studentMovementsRepo = require('../main/repos/student-movements');
const studentProfileRepo = require('../main/repos/student-profile');

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
            const value = fn(...args);
            db.exec('COMMIT');
            return value;
        } catch (err) {
            db.exec('ROLLBACK');
            throw err;
        }
    };
    return db;
}

// Legacy (pre-087) shape: nullable cycle_code, plain single-column FKs omitted
// like the sibling isolation fixtures so drifted rows can be staged by raw SQL.
function createSchema(db) {
    db.exec(`
        CREATE TABLE students (
            id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, full_name TEXT NOT NULL,
            family_name TEXT, birth_date TEXT, birth_place TEXT, gender TEXT, section TEXT,
            level TEXT, school_name TEXT, school_year TEXT, status TEXT DEFAULT 'active',
            registration_type TEXT DEFAULT 'new',
            cycle_code TEXT NOT NULL, UNIQUE(code, school_year)
        );
        CREATE TABLE student_profile_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
            student_code TEXT NOT NULL, tab_key TEXT NOT NULL, data_json TEXT,
            school_year TEXT NOT NULL, cycle_code TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_by TEXT,
            UNIQUE(student_code, tab_key, school_year)
        );
        CREATE TABLE grades (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, student_code TEXT,
            subject TEXT, grade REAL, semester INTEGER, school_year TEXT
        );
        CREATE TABLE absences (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, student_code TEXT,
            month TEXT, absence_type TEXT, school_year TEXT
        );
        CREATE TABLE correspondence (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, student_code TEXT,
            letter_type TEXT, letter_date TEXT, total_hours REAL, school_year TEXT,
            printed INTEGER DEFAULT 0, cycle_code TEXT
        );
        CREATE TABLE student_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, doc_key TEXT NOT NULL,
            is_present INTEGER DEFAULT 0, school_year TEXT NOT NULL,
            cycle_code TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(student_id, doc_key, school_year)
        );
        CREATE TABLE student_movements (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
            movement_type TEXT, from_section TEXT, to_section TEXT, movement_date TEXT,
            notes TEXT, school_year TEXT, cycle_code TEXT
        );
    `);
}

function student(code, name, section) {
    return {
        code,
        full_name: name,
        family_name: '',
        birth_date: '',
        birth_place: '',
        gender: 'M',
        section,
        level: '',
        school_name: '',
        school_year: YEAR,
        status: 'active',
        registration_type: 'new'
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
createSchema(db);
context.setDb(db);
setRepoCapturePort(createNoOpCapturePort());

console.log('[test] S1 dual-cycle child-tables isolation fixture');

// ── Fixture sanity: both cycles are supported now ──────────────────────────
assert.strictEqual(getCycleDefinition(QUALIFIANT).capability, 'supported');
assert.strictEqual(getCycleDefinition(COLLEGIAL).capability, 'supported', 'fixture: both cycles workable');
console.log('  [ok] fixture exposes two supported cycles');

// DISTINCT codes (UNIQUE(code, school_year) forbids overlap); section '1A'
// exists in BOTH cycles to prove scoping never falls back to section names.
studentsRepo.insertOne(db, student('Q-001', 'تلميذ تأهيلي أول', '1A'), QUALIFIANT);
studentsRepo.insertOne(db, student('Q-002', 'تلميذ تأهيلي ثان', '2B'), QUALIFIANT);
studentsRepo.insertOne(db, student('C-001', 'تلميذ إعدادي أول', '1A'), COLLEGIAL);
studentsRepo.insertOne(db, student('C-002', 'تلميذ إعدادي ثان', '3C'), COLLEGIAL);
const q1 = studentsRepo.getByCode(db, 'Q-001', YEAR, QUALIFIANT);
const q2 = studentsRepo.getByCode(db, 'Q-002', YEAR, QUALIFIANT);
const c1 = studentsRepo.getByCode(db, 'C-001', YEAR, COLLEGIAL);
const c2 = studentsRepo.getByCode(db, 'C-002', YEAR, COLLEGIAL);

// Matched child rows through the repos (owner cycle == stored cycle).
for (const [owner, cycle] of [
    [q1, QUALIFIANT],
    [q2, QUALIFIANT],
    [c1, COLLEGIAL],
    [c2, COLLEGIAL]
]) {
    studentFilesRepo.upsertOne(
        db,
        { student_id: owner.id, doc_key: 'birth_cert', is_present: 1, school_year: YEAR },
        cycle
    );
    studentMovementsRepo.addMovement(
        db,
        {
            massar_code: owner.code,
            movement_type: 'internal',
            from_section: owner.section,
            to_section: `${owner.section}-bis`,
            movement_date: '2025-10-01',
            notes: '',
            school_year: YEAR
        },
        cycle
    );
    absencesRepo.saveCorrespondence(
        db,
        {
            student_code: owner.code,
            letter_type: 'warning',
            letter_date: '2025-10-02',
            total_hours: 3,
            school_year: YEAR
        },
        cycle
    );
    studentProfileRepo.saveProfileTab(
        db,
        { student_code: owner.code, school_year: YEAR, tab_key: 'social', updated_by: 'test' },
        JSON.stringify({ note: 'ok' }),
        cycle
    );
}

// Deliberately mismatched rows by raw SQL (legacy drift the repos can never
// write): owner in one cycle, stored cycle in the other.
db.prepare(
    `INSERT INTO correspondence(student_id, student_code, letter_type, letter_date, total_hours, school_year, cycle_code)
     VALUES(?, 'Q-001', 'drift', '2025-10-03', 1, ?, ?)`
).run(q1.id, YEAR, COLLEGIAL);
db.prepare(
    `INSERT INTO student_files(student_id, doc_key, is_present, school_year, cycle_code)
     VALUES(?, 'drift_doc', 1, ?, ?)`
).run(c1.id, YEAR, QUALIFIANT);
db.prepare(
    `INSERT INTO student_movements(student_id, movement_type, movement_date, school_year, cycle_code)
     VALUES(?, 'internal', '2025-10-04', ?, ?)`
).run(q2.id, YEAR, COLLEGIAL);
console.log('  [ok] dual fixture seeded (distinct codes, overlapping sections, drifted rows)');

const sessions = getActiveSessions();
const adminSender = { id: 8101 };
const adminEvent = { sender: adminSender };
sessions.set(adminSender.id, { userId: 1, role: 'admin', locked: false });

// ── Context in A reads only A; context in B reads only B ───────────────────
for (const [ctx, other, ctxCodes, otherCodes] of [
    [QUALIFIANT, COLLEGIAL, ['Q-001', 'Q-002'], ['C-001', 'C-002']],
    [COLLEGIAL, QUALIFIANT, ['C-001', 'C-002'], ['Q-001', 'Q-002']]
]) {
    setContext(adminEvent, 1, ctx, YEAR);
    const resolved = resolveCycleForRequest(db, adminEvent);
    assert.strictEqual(resolved, ctx);

    const files = studentFilesRepo.listByYear(db, YEAR, resolved);
    assert.deepStrictEqual(
        files.map((row) => row.code).sort(),
        ctxCodes,
        `${ctx}: files list sees only ${ctx} students`
    );
    for (const row of files) assert.strictEqual(row.cycle_code, ctx);

    const movements = studentMovementsRepo.listByYear(db, YEAR, resolved);
    for (const row of movements) {
        // Owned rows surface under the owner cycle; stored-cycle orphans under
        // their stored cycle — never under the other cycle.
        assert.ok(
            row.code == null || !otherCodes.includes(row.code),
            `${ctx}: movements list must not surface ${other} owners`
        );
    }
    assert.ok(
        movements.some((row) => ctxCodes.includes(row.code)),
        `${ctx}: movements list keeps its own owners`
    );

    const letters = absencesRepo.listCorrespondenceByYear(db, YEAR, resolved);
    for (const row of letters) assert.strictEqual(row.cycle_code, ctx, `${ctx}: letters are stored-cycle scoped`);
    assert.deepStrictEqual(
        letters.map((row) => row.student_code).filter((code) => ctxCodes.includes(code)).sort(),
        ctxCodes,
        `${ctx}: letters keep every own-cycle owner`
    );

    for (const code of ctxCodes) {
        const tabs = studentProfileRepo.listProfileTabs(db, code, YEAR, resolved);
        assert.strictEqual(tabs.length, 1, `${ctx}: own profile tab readable`);
        assert.strictEqual(tabs[0].cycle_code, ctx);
    }
    for (const code of otherCodes) {
        assert.throws(
            () => studentProfileRepo.listProfileTabs(db, code, YEAR, resolved),
            /لا ينتمي إلى السلك/,
            `${ctx}: other-cycle profile read refused`
        );
    }
    assert.throws(
        () => studentProfileRepo.listProfileTabs(db, ctxCodes[0], YEAR, other),
        /لا ينتمي إلى السلك/,
        'swapping the context cycle refuses the same owner'
    );

    const stats = studentMovementsRepo.getStats(db, YEAR, resolved);
    assert.strictEqual(
        stats.internal,
        ctx === QUALIFIANT ? 2 : 3,
        `${ctx}: movement stats are stored-cycle scoped (the drifted movement counts collegial)`
    );
}
console.log('  [ok] contexts in A and B stay isolated for child-table reads');

// ── Report negative test: qualifiant reads return zero collegial rows ──────
setContext(adminEvent, 1, QUALIFIANT, YEAR);
const qCtx = resolveCycleForRequest(db, adminEvent);
assert.deepStrictEqual(
    studentFilesRepo.listByYear(db, YEAR, qCtx).map((row) => row.code).sort(),
    ['Q-001', 'Q-002']
);
for (const row of studentMovementsRepo.listByYear(db, YEAR, qCtx)) {
    assert.notStrictEqual(row.code, 'C-001');
    assert.notStrictEqual(row.code, 'C-002');
}
for (const row of absencesRepo.listCorrespondenceByYear(db, YEAR, qCtx)) {
    assert.notStrictEqual(row.cycle_code, COLLEGIAL);
    assert.notStrictEqual(row.student_code, 'C-001');
    assert.notStrictEqual(row.student_code, 'C-002');
}
assert.deepStrictEqual(
    absencesRepo.listCorrespondenceByStudent(db, c1.id, qCtx),
    [],
    'qualifiant cannot pull a collegial letter by id'
);
assert.deepStrictEqual(studentProfileRepo.listProfileTabs(db, 'Q-001', YEAR, qCtx).length, 1);
console.log('  [ok] qualifiant report reads return zero collegial rows (negative test)');

// ── Context in A cannot write B, and vice versa ────────────────────────────
for (const [ctx, foreignStudent, foreignCode] of [
    [QUALIFIANT, c1, 'C-001'],
    [COLLEGIAL, q1, 'Q-001']
]) {
    setContext(adminEvent, 1, ctx, YEAR);
    const resolved = resolveCycleForRequest(db, adminEvent);
    assert.throws(
        () =>
            studentFilesRepo.upsertOne(
                db,
                { student_id: foreignStudent.id, doc_key: 'x', is_present: 1, school_year: YEAR },
                resolved
            ),
        /لا ينتمي إلى السلك/,
        `${ctx}: foreign file write refused`
    );
    assert.throws(
        () =>
            studentMovementsRepo.addMovement(
                db,
                { massar_code: foreignCode, movement_type: 'arrival', movement_date: '2025-10-05', school_year: YEAR },
                resolved
            ),
        new RegExp(foreignCode),
        `${ctx}: foreign movement write refused`
    );
    assert.throws(
        () =>
            absencesRepo.saveCorrespondence(
                db,
                {
                    student_code: foreignCode,
                    letter_type: 'warning',
                    letter_date: '2025-10-05',
                    total_hours: 1,
                    school_year: YEAR
                },
                resolved
            ),
        new RegExp(foreignCode),
        `${ctx}: foreign letter write refused`
    );
    assert.throws(
        () =>
            studentProfileRepo.saveProfileTab(
                db,
                { student_code: foreignCode, school_year: YEAR, tab_key: 'health' },
                '{}',
                resolved
            ),
        /لا ينتمي إلى السلك/,
        `${ctx}: foreign profile write refused`
    );
}
console.log('  [ok] cross-cycle child-table writes are refused in both directions');

// ── Unauthorized user is rejected even with a cached context ───────────────
db.exec(`
    CREATE TABLE user_cycle_access (
        user_id INTEGER NOT NULL,
        cycle_code TEXT NOT NULL,
        PRIMARY KEY (user_id, cycle_code)
    )
`);
db.prepare('INSERT INTO user_cycle_access (user_id, cycle_code) VALUES (?, ?)').run(9, QUALIFIANT);
const teacherSender = { id: 8102 };
const teacherEvent = { sender: teacherSender };
sessions.set(teacherSender.id, { userId: 9, role: 'teacher', locked: false });
setContext(teacherEvent, 9, COLLEGIAL, YEAR);
assert.throws(
    () => resolveCycleForRequest(db, teacherEvent),
    (err) => err.code === 'FORBIDDEN',
    'a cached context outside the user grant is rejected'
);
console.log('  [ok] unauthorized user is rejected (FORBIDDEN)');

// ── No context + two supported cycles → fails closed, never guesses ────────
clearContextForSender(adminSender.id);
assert.throws(
    () => resolveCycleForRequest(db, adminEvent),
    (err) => /يتعذر تحديد السلك/.test(err.message),
    'two supported cycles without a context must fail instead of picking one'
);
console.log('  [ok] missing context with two supported cycles fails closed');

// ── Cleanup ────────────────────────────────────────────────────────────────
clearContextForSender(adminSender.id);
clearContextForSender(teacherSender.id);
sessions.delete(adminSender.id);
sessions.delete(teacherSender.id);
setRepoCapturePort(null);
delete require.cache[CATALOG_PATH];
if (typeof db.close === 'function') db.close();

console.log('[test] S1 dual-cycle child-tables isolation fixture: all checks passed');
