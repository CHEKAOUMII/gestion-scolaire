'use strict';

/**
 * Slice 1 — migration 2026-09-087 student child-table cycle isolation.
 *
 * Proves over a legacy (pre-087) database:
 *   - blank cycle_code is backfilled from the owner student (id first, then
 *     student_code + school_year); explicit values are never reclassified;
 *   - orphan movements are preserved (stored-cycle orphans stay in place,
 *     NULL-cycle orphans move to student_movements_quarantine with their id);
 *   - NULL-cycle ownerless rows in the other three tables are logged per-row
 *     and removed (they were already invisible to every cycle-filtered read);
 *   - all four tables end with cycle_code NOT NULL + composite
 *     FOREIGN KEY(student_id, cycle_code), enforced live (cross-cycle and
 *     NULL writes throw);
 *   - the migration is idempotent, records its version once, and writes zero
 *     sync_outbox rows;
 *   - sync keeps cycle_code in requiredColumns/keyFields, cycle-less PUTs
 *     quarantine via checkLocalContract, and checkStudentChildCycleConsistency
 *     quarantines unknown/cross-cycle PUTs without half-writing.
 */

const assert = require('assert');
const { setDb } = require('../main/db/context');
const { MIGRATIONS } = require('../main/db/migrations');
const { getLocalKeyFields, getRequiredColumns } = require('../main/sync/entity-registry');
const { checkLocalContract } = require('../main/sync/engine/apply');
const { checkStudentChildCycleConsistency } = require('../main/repos/student-cycle');
const studentMovementsRepo = require('../main/repos/student-movements');

const QUALIFIANT = 'secondary_qualifiant';
const COLLEGIAL = 'secondary_collegial';
const YEAR = '2025/2026';
const VERSION = '2026-09-087-student-child-cycle-isolation';

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

const db = openDb();
// Legacy shape: nullable cycle_code, plain single-column owner FKs (profile
// carries none, like the real pre-087 DDL). FK enforcement stays OFF while
// seeding so ownerless legacy rows can exist; the migration + live-enforcement
// asserts below turn it back ON explicitly.
db.exec('PRAGMA foreign_keys=OFF;');
db.exec(`
    CREATE TABLE students (
        id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, full_name TEXT NOT NULL,
        family_name TEXT, birth_date TEXT, birth_place TEXT, gender TEXT, section TEXT,
        level TEXT, school_name TEXT, school_year TEXT, status TEXT DEFAULT 'active',
        registration_type TEXT DEFAULT 'new', cycle_code TEXT NOT NULL,
        UNIQUE(code, school_year)
    );
    CREATE TABLE correspondence (
        id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, student_code TEXT,
        letter_type TEXT, letter_date DATE, total_hours INTEGER, school_year TEXT,
        cycle_code TEXT, printed INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(student_id) REFERENCES students(id)
    );
    CREATE TABLE student_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, doc_key TEXT NOT NULL,
        is_present INTEGER DEFAULT 0, school_year TEXT, cycle_code TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_id, doc_key, school_year),
        FOREIGN KEY(student_id) REFERENCES students(id)
    );
    CREATE TABLE student_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
        movement_type TEXT NOT NULL, from_section TEXT, to_section TEXT,
        movement_date DATE NOT NULL, notes TEXT, school_year TEXT, cycle_code TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(student_id) REFERENCES students(id)
    );
    CREATE TABLE student_profile_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
        student_code TEXT NOT NULL,
        tab_key TEXT NOT NULL CHECK(tab_key IN ('economic','social','health','followup','guidance')),
        data_json TEXT NOT NULL DEFAULT '{}', school_year TEXT NOT NULL, cycle_code TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_by TEXT,
        UNIQUE(student_code, tab_key, school_year)
    );
    CREATE TABLE system_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, entity_type TEXT,
        entity_id TEXT, details TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE schema_migrations (
        version TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE sync_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT, operation TEXT,
        row_data TEXT, status TEXT DEFAULT 'pending'
    );

    INSERT INTO students(id, code, full_name, section, school_year, cycle_code) VALUES
        (1, 'Q-001', 'تلميذ تأهيلي', '1A', '${YEAR}', '${QUALIFIANT}'),
        (2, 'C-001', 'تلميذ إعدادي', '1A', '${YEAR}', '${COLLEGIAL}');

    -- Backfillable: blank cycle + resolvable owner.
    INSERT INTO student_files(id, student_id, doc_key, is_present, school_year, cycle_code)
        VALUES (1, 1, 'birth_cert', 1, '${YEAR}', NULL);
    INSERT INTO student_movements(id, student_id, movement_type, movement_date, school_year, cycle_code)
        VALUES (1, 2, 'arrival', '2025-09-01', '${YEAR}', '');
    INSERT INTO correspondence(id, student_id, student_code, letter_type, letter_date, school_year, cycle_code)
        VALUES (1, 1, 'Q-001', 'warning', '2025-09-02', '${YEAR}', NULL);
    INSERT INTO student_profile_data(id, student_id, student_code, tab_key, school_year, cycle_code)
        VALUES (1, 2, 'C-001', 'social', '${YEAR}', NULL);
    -- Code fallback: no usable student_id, resolvable student_code.
    INSERT INTO correspondence(id, student_id, student_code, letter_type, letter_date, school_year, cycle_code)
        VALUES (2, NULL, 'C-001', 'notice', '2025-09-03', '${YEAR}', NULL);
    -- Explicit drift: stored cycle disagrees with the owner — never reclassified.
    INSERT INTO student_files(id, student_id, doc_key, is_present, school_year, cycle_code)
        VALUES (2, 1, 'drift_doc', 1, '${YEAR}', '${COLLEGIAL}');
    -- Orphan with a stored cycle: frozen history, stays in place.
    INSERT INTO student_movements(id, student_id, movement_type, movement_date, school_year, cycle_code)
        VALUES (2, 999, 'departure', '2025-09-04', '${YEAR}', '${QUALIFIANT}');
    -- NULL-cycle orphans: no owner, no cycle.
    INSERT INTO student_movements(id, student_id, movement_type, movement_date, school_year, cycle_code)
        VALUES (3, 999, 'arrival', '2025-09-05', '${YEAR}', NULL);
    INSERT INTO student_files(id, student_id, doc_key, is_present, school_year, cycle_code)
        VALUES (3, 999, 'ghost_doc', 0, '${YEAR}', NULL);
    INSERT INTO correspondence(id, student_id, student_code, letter_type, letter_date, school_year, cycle_code)
        VALUES (3, 999, 'GHOST', 'warning', '2025-09-06', '${YEAR}', NULL);
    INSERT INTO student_profile_data(id, student_id, student_code, tab_key, school_year, cycle_code)
        VALUES (2, 999, 'GHOST', 'health', '${YEAR}', NULL);
`);

setDb(db);
const migration = MIGRATIONS.find((entry) => entry.version === VERSION);
assert.ok(migration, 'migration 087 must be registered');
// The registry tail is pinned deliberately: 087 rebuilds the four child
// tables, so any future migration appended after 088 must consciously extend
// this pin after checking interplay with the composite-FK rebuilds.
assert.deepStrictEqual(
    MIGRATIONS.slice(-2).map((entry) => entry.version),
    [VERSION, '2026-10-088-student-stage-transitions'],
    'registry tail must stay [087, 088]; extend this pin when appending migrations'
);

console.log('[test] migration 087 student child-table cycle isolation');

migration.up();
const logCountAfterFirst = db.prepare('SELECT COUNT(*) AS count FROM system_logs').get().count;
// The runner skips recorded versions; simulate that for the rerun so the
// second up() exercises data/DDL idempotence rather than the version PK.
db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(VERSION);
migration.up();
assert.strictEqual(
    db.prepare('SELECT COUNT(*) AS count FROM system_logs').get().count,
    logCountAfterFirst,
    'rerunning the migration must not duplicate audit rows'
);
assert.strictEqual(
    db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?').get(VERSION).count,
    1,
    'migration version is recorded exactly once'
);
console.log('  [ok] migration is idempotent and records its version once');

// ── Backfill from the owner; explicit values never reclassified ────────────
const cycleOf = (table, id) => db.prepare(`SELECT cycle_code FROM ${table} WHERE id = ?`).get(id).cycle_code;
assert.strictEqual(cycleOf('student_files', 1), QUALIFIANT, 'file backfilled from owner id');
assert.strictEqual(cycleOf('student_movements', 1), COLLEGIAL, 'movement backfilled from owner id');
assert.strictEqual(cycleOf('correspondence', 1), QUALIFIANT, 'letter backfilled from owner id');
assert.strictEqual(cycleOf('student_profile_data', 1), COLLEGIAL, 'profile row backfilled from owner id');
assert.strictEqual(cycleOf('correspondence', 2), COLLEGIAL, 'letter backfilled via student_code fallback');
assert.strictEqual(cycleOf('student_files', 2), COLLEGIAL, 'explicit drifted cycle is never reclassified');
console.log('  [ok] legacy rows backfill from the owner; explicit values are preserved');

// ── Orphan policy: movements preserved, other NULL orphans logged+removed ──
assert.strictEqual(cycleOf('student_movements', 2), QUALIFIANT, 'stored-cycle orphan movement stays in place');
assert.strictEqual(
    db.prepare('SELECT COUNT(*) AS count FROM student_movements WHERE id = 3').get().count,
    0,
    'NULL-cycle orphan movement leaves the operational table'
);
const quarantined = db
    .prepare('SELECT * FROM student_movements_quarantine WHERE id = 3')
    .get();
assert.ok(quarantined, 'NULL-cycle orphan movement is preserved in quarantine with its id');
assert.strictEqual(quarantined.movement_type, 'arrival');
assert.strictEqual(quarantined.reason, 'null_cycle_orphan');
assert.deepStrictEqual(
    studentMovementsRepo.listQuarantinedMovements(db, YEAR).map((row) => row.id),
    [3],
    'admin audit view exposes the quarantined movement'
);
assert.deepStrictEqual(
    studentMovementsRepo.listByYear(db, YEAR, QUALIFIANT).map((row) => row.id),
    [2],
    'operational qualifiant list shows the stored-cycle orphan only'
);
assert.deepStrictEqual(
    studentMovementsRepo.listByYear(db, YEAR, COLLEGIAL).map((row) => row.id),
    [1],
    'operational collegial list shows its own movement only'
);
for (const [table, id] of [['student_files', 3], ['correspondence', 3], ['student_profile_data', 2]]) {
    assert.strictEqual(
        db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE id = ?`).get(id).count,
        0,
        `${table}#${id} (ownerless, cycle-less, already invisible) is removed`
    );
    assert.ok(
        db
            .prepare(
                `SELECT 1 FROM system_logs
                 WHERE action = 'CYCLE_BACKFILL_UNMAPPABLE' AND entity_type = ? AND entity_id = ?`
            )
            .get(table, String(id)),
        `${table}#${id} removal is audited per-row`
    );
}
assert.ok(
    db
        .prepare(
            `SELECT 1 FROM system_logs
             WHERE action = 'CYCLE_BACKFILL_UNMAPPABLE'
               AND entity_type = 'student_movements' AND entity_id = '3'`
        )
        .get(),
    'quarantined movement is audited per-row'
);
for (const table of ['correspondence', 'student_files', 'student_movements', 'student_profile_data']) {
    const aggregate = db
        .prepare(
            `SELECT details FROM system_logs
             WHERE action = 'CYCLE_CHILD_BACKFILL_087' AND entity_type = ? AND entity_id = '087'`
        )
        .get(table);
    assert.ok(aggregate, `${table} has a per-table aggregate audit row`);
    assert.ok(Number(JSON.parse(aggregate.details).backfilled) >= 1, `${table} aggregate counts backfills`);
}
console.log('  [ok] orphan movements preserved (place + quarantine), other NULL orphans logged and removed');

// Explicit drift (student_files id 2) and the frozen ownerless movement (id 2) now
// violate the composite owner FK; the migration must surface them, not leave them silent.
{
    const driftLog = (table) =>
        db
            .prepare(
                `SELECT details FROM system_logs
                 WHERE action = 'CYCLE_CHILD_FK_DRIFT_087' AND entity_type = ? AND entity_id = '087'`
            )
            .get(table);
    const files = driftLog('student_files');
    assert.ok(files, 'student_files drift is logged');
    assert.ok(JSON.parse(files.details).sampleRowIds.includes(2), 'drifted student_files row 2 is listed');
    const moves = driftLog('student_movements');
    assert.ok(moves, 'frozen ownerless movement is logged');
    assert.ok(JSON.parse(moves.details).sampleRowIds.includes(2), 'frozen movement row 2 is listed');
    console.log('  [ok] FK drift rows (explicit drift + frozen orphans) are logged for operator review');
}

// ── DDL: NOT NULL + composite FK + indexes ─────────────────────────────────
for (const table of ['correspondence', 'student_files', 'student_movements', 'student_profile_data']) {
    const column = db.prepare(`PRAGMA table_info("${table}")`).all().find((c) => c.name === 'cycle_code');
    assert.ok(column, `${table}.cycle_code exists`);
    assert.strictEqual(column.notnull, 1, `${table}.cycle_code is NOT NULL`);
    const fks = db.prepare(`PRAGMA foreign_key_list("${table}")`).all();
    const composite = fks.filter((fk) => fk.table === 'students' && (fk.from === 'student_id' || fk.from === 'cycle_code'));
    assert.ok(
        composite.some((fk) => fk.from === 'student_id' && fk.to === 'id') &&
            composite.some((fk) => fk.from === 'cycle_code' && fk.to === 'cycle_code'),
        `${table} declares FOREIGN KEY(student_id, cycle_code) REFERENCES students(id, cycle_code)`
    );
    assert.ok(
        db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?`).get(`idx_${table}_owner_cycle`),
        `${table} has its (student_id, cycle_code) index`
    );
}
assert.ok(
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'uidx_students_id_cycle'`).get(),
    'students carries the UNIQUE(id, cycle_code) parent key'
);
console.log('  [ok] NOT NULL + composite FK + indexes on all four tables');

// ── Constraints enforced live (no silent cross-cycle write) ────────────────
db.exec('PRAGMA foreign_keys=ON;');
assert.throws(
    () =>
        db
            .prepare(
                `INSERT INTO student_files(student_id, doc_key, is_present, school_year, cycle_code)
                 VALUES(1, 'evil', 1, ?, ?)`
            )
            .run(YEAR, COLLEGIAL),
    'cross-cycle child insert violates the composite FK'
);
assert.throws(
    () =>
        db
            .prepare(
                `INSERT INTO correspondence(student_id, student_code, letter_type, school_year, cycle_code)
                 VALUES(2, 'C-001', 'evil', ?, NULL)`
            )
            .run(YEAR),
    'NULL-cycle child insert violates NOT NULL'
);
assert.throws(
    () =>
        db
            .prepare(`UPDATE student_movements SET cycle_code = ? WHERE id = 1`)
            .run(QUALIFIANT),
    'retargeting a movement to the other cycle violates the composite FK'
);
const postMigration = db
    .prepare(
        `INSERT INTO student_files(student_id, doc_key, is_present, school_year, cycle_code)
         VALUES(1, 'post_migration_ok', 1, ?, ?)`
    )
    .run(YEAR, QUALIFIANT);
assert.strictEqual(cycleOf('student_files', Number(postMigration.lastInsertRowid)), QUALIFIANT, 'matching-cycle writes still apply');
console.log('  [ok] composite FK + NOT NULL enforced live; matching writes pass');

// ── Zero outbox rows ───────────────────────────────────────────────────────
assert.strictEqual(
    db.prepare('SELECT COUNT(*) AS count FROM sync_outbox').get().count,
    0,
    'migration writes zero sync_outbox rows'
);
console.log('  [ok] migration writes zero sync_outbox rows');

// ── Sync contract: keys kept, cycle-less PUTs quarantine ───────────────────
assert.deepStrictEqual(getLocalKeyFields('student_files'), ['student_id', 'doc_key', 'school_year']);
assert.deepStrictEqual(getLocalKeyFields('student_profile_data'), ['student_code', 'tab_key', 'school_year']);
assert.deepStrictEqual(getLocalKeyFields('correspondence'), ['id']);
assert.deepStrictEqual(getLocalKeyFields('student_movements'), ['id']);
for (const table of ['correspondence', 'student_files', 'student_movements', 'student_profile_data']) {
    assert.ok(
        getRequiredColumns(table).includes('cycle_code'),
        `${table} keeps cycle_code in requiredColumns`
    );
    const reason = checkLocalContract(db, {
        operation: 'PUT',
        tableName: table,
        data: { school_year: YEAR }
    });
    assert.ok(reason, `${table}: a cycle-less PUT fails the contract gate (→ quarantine)`);
    assert.strictEqual(
        checkLocalContract(db, { operation: 'PUT', tableName: table, data: { school_year: YEAR, cycle_code: QUALIFIANT } }),
        null,
        `${table}: a cycle-carrying PUT passes the contract gate`
    );
}
console.log('  [ok] keyFields/requiredColumns kept; cycle-less PUTs quarantine');

// ── Sync ingestion: unknown/cross-cycle PUTs refused, never half-written ────
const put = (tableName, data) => ({ operation: 'PUT', tableName, data: { school_year: YEAR, ...data } });
for (const table of ['correspondence', 'student_files', 'student_movements', 'student_profile_data']) {
    assert.ok(
        checkStudentChildCycleConsistency(db, put(table, { student_code: 'Q-001', cycle_code: 'nope' })),
        `${table}: unknown-cycle PUT is refused`
    );
    assert.ok(
        checkStudentChildCycleConsistency(db, put(table, { student_code: 'Q-001', cycle_code: COLLEGIAL })),
        `${table}: cross-cycle PUT is refused`
    );
    assert.strictEqual(
        checkStudentChildCycleConsistency(db, put(table, { student_code: 'Q-001', cycle_code: QUALIFIANT })),
        null,
        `${table}: matching-cycle PUT passes`
    );
    assert.strictEqual(
        checkStudentChildCycleConsistency(db, put(table, { student_code: 'Q-001' })),
        null,
        `${table}: missing cycle stays with the contract gate`
    );
    assert.strictEqual(
        checkStudentChildCycleConsistency(db, put(table, { student_code: 'GHOST', cycle_code: QUALIFIANT })),
        null,
        `${table}: missing owner stays on the dependency path`
    );
}
assert.strictEqual(
    checkStudentChildCycleConsistency(db, { operation: 'DEL', tableName: 'student_files', data: {} }),
    null,
    'DEL operations are untouched'
);
assert.strictEqual(
    checkStudentChildCycleConsistency(db, put('grades', { student_code: 'Q-001', cycle_code: COLLEGIAL })),
    null,
    'tables outside the Slice-1 set are untouched'
);
console.log('  [ok] unknown/cross-cycle PUTs refused without half-writing');

if (typeof db.close === 'function') db.close();

console.log('[test] migration 087 student child-table cycle isolation: all checks passed');
