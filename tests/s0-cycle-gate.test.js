'use strict';

/**
 * S0 — cycle safety gate, real catalog
 * (docs/plans/2026-08-02-multi-stage-school-architecture.md, §3 S0).
 *
 * 1. The catalog compat layer normalizes the legacy `not_supported` to `preview`:
 *    the value is visible, read-only, and never resolvable as a work cycle.
 * 2. resolveCycleForRequest revalidates a cached context on every request against
 *    the current institution state (is_active + capability) and fails closed when
 *    the context is stale, disabled, or removed — it never falls through to another
 *    cycle, and a `preview` cycle can never be resolved for work.
 * 3. `student_orientation` is a declared institution-wide exception: its reads are
 *    deliberately NOT cycle-scoped until the S3 snapshot column lands. The tests
 *    below pin that contract so any future change is deliberate (S3 + plan §3 S0).
 */

const assert = require('assert');

const context = require('../main/db/context');
const { ensureInstitutionCyclesSchema } = require('../main/db/schema');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
const {
    CYCLE_CATALOG,
    getCycleDefinition,
    normalizeCapability
} = require('../js/shared/education/cycles');
const cyclesRepo = require('../main/repos/cycles');
const { resolveCycleForRequest } = require('../main/auth/resolve-cycle');
const { setContext, clearContextForSender } = require('../main/auth/active-cycle-context');
const { getActiveSessions } = require('../main/ipc/auth');
const orientationRepo = require('../main/repos/orientation');

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

function seedInstitutionCycles(db) {
    ensureInstitutionCyclesSchema(db);
    const insert = db.prepare(
        `INSERT OR IGNORE INTO institution_cycles (cycle_code, is_active, seed_profile_version_hint, sort_order)
         VALUES (?, 1, ?, ?)`
    );
    insert.run(QUALIFIANT, 'qualifiant-2026-v1', 20);
    insert.run(COLLEGIAL, 'collegial-2026-v1', 10);
}

function createOrientationSchema(db) {
    db.exec(`
        CREATE TABLE students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            full_name TEXT NOT NULL,
            gender TEXT,
            section TEXT,
            school_year TEXT NOT NULL,
            cycle_code TEXT NOT NULL
        );
        CREATE TABLE student_orientation (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            student_code      TEXT NOT NULL,
            full_name         TEXT,
            gender            TEXT,
            section           TEXT,
            level             TEXT,
            origin_stream     TEXT NOT NULL,
            choice_1          TEXT,
            choice_2          TEXT,
            choice_3          TEXT,
            assigned_stream   TEXT,
            decision_status   TEXT,
            average           REAL,
            rank_num          INTEGER,
            notes             TEXT,
            school_year       TEXT NOT NULL,
            created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(student_code, school_year)
        );
    `);
}

const db = openDb();
seedInstitutionCycles(db);
context.setDb(db);
setRepoCapturePort(createNoOpCapturePort());

console.log('[test] S0 cycle safety gate (real catalog)');

// ── Catalog compat: legacy not_supported → preview (read-only) ─────────────
assert.strictEqual(normalizeCapability('not_supported'), 'preview');
assert.strictEqual(normalizeCapability('preview'), 'preview');
assert.strictEqual(normalizeCapability('supported'), 'supported');
assert.strictEqual(normalizeCapability(''), 'preview');
assert.strictEqual(normalizeCapability(undefined), 'preview');
assert.strictEqual(
    getCycleDefinition(COLLEGIAL).capability,
    'supported',
    'the catalog surface no longer exposes not_supported'
);
assert.ok(
    !CYCLE_CATALOG.some((cycle) => cycle.capability === 'not_supported'),
    'the legacy value is retired from the catalog'
);
assert.strictEqual(cyclesRepo.getLabeledCycle(db, COLLEGIAL).capability, 'supported');
console.log('  [ok] legacy not_supported is normalized to preview (read-only)');

// ── Resolution with a fresh context ────────────────────────────────────────
const sessions = getActiveSessions();
const sender = { id: 7001 };
const event = { sender };
sessions.set(sender.id, { userId: 7, role: 'admin', locked: false });
setContext(event, 7, QUALIFIANT, YEAR);
assert.strictEqual(resolveCycleForRequest(db, event), QUALIFIANT);
console.log('  [ok] a valid context resolves to its own cycle');

// ── Stale context: cycle disabled out-of-band → fails closed ───────────────
db.prepare('UPDATE institution_cycles SET is_active = 0 WHERE cycle_code = ?').run(QUALIFIANT);
assert.throws(
    () => resolveCycleForRequest(db, event),
    (err) => /غير مفعل/.test(err.message),
    'a disabled-cycle context must fail closed, not fall through'
);
db.prepare('UPDATE institution_cycles SET is_active = 1 WHERE cycle_code = ?').run(QUALIFIANT);
console.log('  [ok] disabled-cycle context fails closed');

// ── Removed cycle row → fails closed ───────────────────────────────────────
db.prepare('DELETE FROM institution_cycles WHERE cycle_code = ?').run(QUALIFIANT);
assert.throws(
    () => resolveCycleForRequest(db, event),
    (err) => /غير مفعل/.test(err.message),
    'a removed-cycle context must fail closed'
);
db.prepare(
    `INSERT INTO institution_cycles (cycle_code, is_active, seed_profile_version_hint, sort_order)
     VALUES (?, 1, ?, 20)`
).run(QUALIFIANT, 'qualifiant-2026-v1');
console.log('  [ok] removed-cycle context fails closed');

// ── Preview cycle context → fails closed (capability gate) ─────────────────
db.prepare(
    `INSERT OR IGNORE INTO institution_cycles (cycle_code, is_active, seed_profile_version_hint, sort_order)
     VALUES (?, 1, ?, 5)`
).run(PRIMARY, 'primary-2026-v1');
setContext(event, 7, PRIMARY, YEAR);
assert.throws(
    () => resolveCycleForRequest(db, event),
    (err) => /قيد الإعداد/.test(err.message),
    'a preview cycle can never be resolved for work'
);
console.log('  [ok] preview-cycle context fails closed');

// ── No context + exactly one supported cycle → resolves it ─────────────────
db.prepare('UPDATE institution_cycles SET is_active = 0 WHERE cycle_code = ?').run(COLLEGIAL);
clearContextForSender(sender.id);
assert.strictEqual(resolveCycleForRequest(db, event), QUALIFIANT);
console.log('  [ok] no context resolves the single supported cycle');

// ── Orientation exception: institution-wide by design (pinned contract) ────
createOrientationSchema(db);
db.prepare('INSERT INTO students(code, full_name, gender, section, school_year, cycle_code) VALUES(?,?,?,?,?,?)')
    .run('Q1', 'تلميذ تأهيلي', 'M', '1A', YEAR, QUALIFIANT);
db.prepare('INSERT INTO students(code, full_name, gender, section, school_year, cycle_code) VALUES(?,?,?,?,?,?)')
    .run('C1', 'تلميذ إعدادي', 'M', '1A', YEAR, COLLEGIAL);
const insertOrientation = db.prepare(
    `INSERT INTO student_orientation
        (student_code, full_name, gender, section, origin_stream, choice_1, school_year)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
);
insertOrientation.run('Q1', 'تلميذ تأهيلي', 'M', '1A', 'علوم', 'شعبة أ', YEAR);
insertOrientation.run('C1', 'تلميذ إعدادي', 'M', '1A', 'علوم', 'شعبة ب', YEAR);

const listed = orientationRepo.list(db, YEAR);
assert.strictEqual(listed.success, true);
assert.deepStrictEqual(
    listed.rows.map((row) => row.student_code).sort(),
    ['C1', 'Q1'],
    'orientation reads span both cycles — declared exception until S3'
);
const stats = orientationRepo.stats(db, YEAR);
assert.strictEqual(stats.summary.total, 2);
console.log('  [ok] student_orientation stays institution-wide (declared exception)');

// ── Cleanup ────────────────────────────────────────────────────────────────
clearContextForSender(sender.id);
sessions.delete(sender.id);
setRepoCapturePort(null);
if (typeof db.close === 'function') db.close();

console.log('[test] S0 cycle safety gate (real catalog): all checks passed');
