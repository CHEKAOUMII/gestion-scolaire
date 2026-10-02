'use strict';

/**
 * Phase 1 (2026-08-03 multi-stage management review verdict) — silent cycle
 * misclassification remediation.
 *
 * The G3 "no default to qualifiant" rule was violated at the DDL layer:
 * students/grades/absences carried `cycle_code TEXT NOT NULL DEFAULT
 * 'secondary_qualifiant'`, so any INSERT that omitted the column silently wrote a
 * qualifiant row. Migration 2026-08-085 removes that default (NOT NULL preserved,
 * no replacement default), and `createTables()` no longer ships the default.
 *
 * Coverage:
 *   1. Fresh schema (createTables) has no silent qualifiant default on the three tables.
 *   2. Upgraded pre-085 DB: migration rebuilds the tables, preserves rows, and a
 *      column-omitted INSERT now fails with a NOT NULL error instead of writing a
 *      qualifiant row.
 *   3. Explicit primary / collegial / qualifiant inserts still succeed after the rebuild.
 *   4. The migration produces zero sync_outbox rows.
 *   5. Re-running the migration is a no-op (no rebuild when the default is gone).
 */

const assert = require('assert');

// createTables() seeds the trial date via the licensing HMAC, which requires a
// signing secret outside Electron. A fixed test-only secret keeps the suite pure.
process.env.GESTION_LICENSE_SECRET = process.env.GESTION_LICENSE_SECRET || 'test-secret';

const context = require('../main/db/context');
const { createTables } = require('../main/db/schema');
const { MIGRATIONS } = require('../main/db/migrations');

const PRIMARY = 'primary';
const COLLEGIAL = 'secondary_collegial';
const QUALIFIANT = 'secondary_qualifiant';
const MIGRATION_VERSION = '2026-08-085-drop-silent-cycle-code-defaults';

function openDb() {
    try {
        const Database = require('better-sqlite3');
        const probe = new Database(':memory:');
        probe.close();
        const db = new Database(':memory:');
        db.pragma('foreign_keys = ON');
        return db;
    } catch {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(':memory:');
        db.pragma = (statement) => db.prepare(`PRAGMA ${statement}`).all();
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

function getCycleColumnDefault(db, table) {
    const row = db.pragma(`table_info(${table})`).find((c) => c.name === 'cycle_code');
    return row ? row.dflt_value : null;
}

function tableSql(db, table) {
    const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
    return String(row?.sql || '');
}

/** Simulate the pre-085 upgraded schema: tables with the silent qualifiant default. */
function buildUpgradeFixture(db) {
    db.exec(`
        CREATE TABLE teachers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        );
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
            cycle_code TEXT NOT NULL DEFAULT '${QUALIFIANT}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(code, school_year)
        );
        CREATE TABLE grades(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER,
            student_code TEXT,
            teacher_id INTEGER,
            subject TEXT,
            grade REAL,
            semester INTEGER,
            teacher_name TEXT,
            level TEXT,
            section TEXT,
            school_year TEXT,
            cycle_code TEXT NOT NULL DEFAULT '${QUALIFIANT}',
            teacher_resolution TEXT DEFAULT 'unresolved',
            source_file_name TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(student_id) REFERENCES students(id)
        );
        CREATE TABLE absences(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER,
            student_code TEXT,
            absence_date DATE,
            month TEXT,
            absence_type TEXT DEFAULT 'unjustified',
            hours INTEGER DEFAULT 0,
            days REAL DEFAULT 0,
            reason TEXT,
            school_year TEXT,
            cycle_code TEXT NOT NULL DEFAULT '${QUALIFIANT}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(student_id) REFERENCES students(id)
        );
        CREATE INDEX idx_students_year_cycle ON students(school_year, cycle_code);
        CREATE INDEX idx_grades_year_cycle ON grades(school_year, cycle_code);
        CREATE INDEX idx_absences_year_cycle ON absences(school_year, cycle_code);
        CREATE TABLE IF NOT EXISTS sync_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT NOT NULL,
            row_sync_id TEXT NOT NULL,
            operation TEXT NOT NULL,
            row_data TEXT,
            school_year TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            retries INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    db.prepare(
        `INSERT INTO students (code, full_name, section, level, school_year)
         VALUES ('S001', 'تلميذ ١', '1AP-أ', '1AP', '2025/2026')`
    ).run();
    db.prepare(
        `INSERT INTO grades (student_code, subject, grade, semester, school_year)
         VALUES ('S001', 'الرياضيات', 14, 1, '2025/2026')`
    ).run();
    db.prepare(
        `INSERT INTO absences (student_code, absence_date, school_year)
         VALUES ('S001', '2025-09-15', '2025/2026')`
    ).run();
}

const migration = MIGRATIONS.find((m) => m.version === MIGRATION_VERSION);
if (!migration) {
    console.error(`cycle-defaults-removal.test.js: FAILED — migration ${MIGRATION_VERSION} is not registered`);
    process.exit(1);
}

// ── 1. Fresh schema ships no silent default ───────────────────────────────────
{
    const db = openDb();
    context.setDb(db);
    createTables();
    for (const table of ['grades', 'absences']) {
        assert.strictEqual(
            getCycleColumnDefault(db, table),
            null,
            `${table} fresh DDL must not default cycle_code`
        );
        assert.ok(
            !tableSql(db, table).includes('secondary_qualifiant'),
            `${table} fresh DDL must not reference the qualifiant literal`
        );
    }
    // students fresh shape has no cycle_code at all (added later by migration 071).
    assert.ok(
        !tableSql(db, 'students').includes('secondary_qualifiant'),
        'students fresh DDL must not reference the qualifiant literal'
    );
    console.log('[cycle-defaults-removal] fresh schema: no silent qualifiant default (PASS)');
    db.close();
    context.setDb(null);
}

// ── 2. Upgrade fixture: rebuild, preserve rows, forbid omitted-column inserts ──
{
    const db = openDb();
    context.setDb(db);
    buildUpgradeFixture(db);
    assert.strictEqual(
        getCycleColumnDefault(db, 'students'),
        `'${QUALIFIANT}'`,
        'pre-fix fixture sanity: students still has the silent default'
    );

    const before = {
        students: db.prepare('SELECT COUNT(*) AS c FROM students').get().c,
        grades: db.prepare('SELECT COUNT(*) AS c FROM grades').get().c,
        absences: db.prepare('SELECT COUNT(*) AS c FROM absences').get().c
    };

    migration.up();

    for (const table of ['students', 'grades', 'absences']) {
        assert.strictEqual(
            getCycleColumnDefault(db, table),
            null,
            `${table} must lose the qualifiant default after ${MIGRATION_VERSION}`
        );
        assert.ok(
            !tableSql(db, table).includes('secondary_qualifiant'),
            `${table} SQL must not reference the qualifiant literal after the migration`
        );
        assert.ok(
            tableSql(db, table).includes('cycle_code TEXT NOT NULL'),
            `${table} must keep cycle_code NOT NULL after the migration`
        );
    }
    const gradeForeignKeys = db.prepare(`PRAGMA foreign_key_list(grades)`).all();
    assert.ok(
        gradeForeignKeys.some((fk) => fk.table === 'students' && fk.on_delete === 'CASCADE'),
        'grades must preserve the student cascade foreign key'
    );
    assert.ok(
        gradeForeignKeys.some((fk) => fk.table === 'teachers' && fk.on_delete === 'SET NULL'),
        'grades must preserve the teacher SET NULL foreign key'
    );
    const absenceForeignKeys = db.prepare(`PRAGMA foreign_key_list(absences)`).all();
    assert.ok(
        absenceForeignKeys.some((fk) => fk.table === 'students' && fk.on_delete === 'CASCADE'),
        'absences must preserve the student cascade foreign key'
    );
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM students').get().c, before.students, 'students rows preserved');
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM grades').get().c, before.grades, 'grades rows preserved');
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM absences').get().c, before.absences, 'absences rows preserved');

    // A column-omitted INSERT must now fail instead of silently writing qualifiant.
    assert.throws(
        () => db.prepare(`INSERT INTO students (code, full_name, school_year) VALUES ('X1', 'مفقود', '2025/2026')`).run(),
        /NOT NULL/i,
        'students INSERT omitting cycle_code must fail with NOT NULL'
    );
    assert.throws(
        () => db.prepare(`INSERT INTO grades (student_code, subject, grade, semester, school_year) VALUES ('Z', 'مادة', 10, 1, '2025/2026')`).run(),
        /NOT NULL/i,
        'grades INSERT omitting cycle_code must fail with NOT NULL'
    );
    assert.throws(
        () => db.prepare(`INSERT INTO absences (student_code, absence_date, school_year) VALUES ('Z2', '2025-09-15', '2025/2026')`).run(),
        /NOT NULL/i,
        'absences INSERT omitting cycle_code must fail with NOT NULL'
    );
    console.log('[cycle-defaults-removal] upgrade fixture: default removed, rows preserved, omitted INSERT fails (PASS)');

    // ── 3. Explicit primary / collegial / qualifiant inserts still succeed ──
    db.prepare(
        `INSERT INTO students (code, full_name, section, school_year, cycle_code)
         VALUES ('p1', 'تلميذ ابتدائي', '2AP-1', '2025/2026', ?)`
    ).run(PRIMARY);
    db.prepare(
        `INSERT INTO students (code, full_name, section, school_year, cycle_code)
         VALUES ('p2', 'تلميذ إعدادي', '1APIC-1', '2025/2026', ?)`
    ).run(COLLEGIAL);
    db.prepare(
        `INSERT INTO students (code, full_name, section, school_year, cycle_code)
         VALUES ('p3', 'تلميذ تأهيلي', '1BAC-1', '2025/2026', ?)`
    ).run(QUALIFIANT);
    const cycles = db.prepare(`SELECT cycle_code FROM students WHERE code IN ('p1','p2','p3') ORDER BY code`).all();
    assert.deepStrictEqual(
        cycles.map((r) => r.cycle_code),
        [PRIMARY, COLLEGIAL, QUALIFIANT],
        'explicit three-cycle inserts must all succeed'
    );
    console.log('[cycle-defaults-removal] explicit three-cycle inserts (PASS)');

    // ── 4. Zero outbox rows: the migration never writes sync_outbox ──
    const outboxCount = db.prepare(`SELECT COUNT(*) AS c FROM sync_outbox`).get().c;
    assert.strictEqual(outboxCount, 0, 'the migration must not create outbox rows');
    console.log('[cycle-defaults-removal] outbox rows = 0 (PASS)');

    db.close();
    context.setDb(null);
}

// ── 5. Idempotent re-run: once the default is gone, a re-run (e.g. crash between
//    rebuild and version-record) rebuilds nothing and just records the version ──
{
    const db = openDb();
    context.setDb(db);
    buildUpgradeFixture(db);
    migration.up();

    const sqlBefore = [
        tableSql(db, 'students'),
        tableSql(db, 'grades'),
        tableSql(db, 'absences')
    ].join(';');

    // Simulate a re-run before the version was recorded (crash window).
    db.prepare(`DELETE FROM schema_migrations WHERE version = ?`).run(MIGRATION_VERSION);
    migration.up();

    const sqlAfter = [
        tableSql(db, 'students'),
        tableSql(db, 'grades'),
        tableSql(db, 'absences')
    ].join(';');
    assert.strictEqual(sqlAfter, sqlBefore, 're-run must not rebuild tables');
    assert.strictEqual(getCycleColumnDefault(db, 'students'), null, 'students stays default-free after re-run');
    assert.strictEqual(
        db.prepare(`SELECT COUNT(*) AS c FROM schema_migrations WHERE version = ?`).get(MIGRATION_VERSION).c,
        1,
        're-run must record the version again'
    );
    console.log('[cycle-defaults-removal] idempotent re-run: no-op (PASS)');
    db.close();
    context.setDb(null);
}

console.log('cycle-defaults-removal.test.js: OK');
