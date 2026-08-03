'use strict';

/**
 * Collegial official file (secondary_collegial) — migration 2026-08-084 + seeds.
 *
 * The collegial cycle's official rule data ships from the school dossier
 * (D:\secondaire\معاملات المواد -نتاءئج مدرسية.md report cards + نسبة_الأنشطة_المندمجة_الشامل.md):
 *   - profile collegial-2026-v1 = exams_activities, uses_coefficients = 1;
 *   - collegial subject catalog (incl. new TECHNOLOGY) union-seeded;
 *   - coefficients / exam counts / weights seeded into every ACTIVE rule-set
 *     revision + the per-year assignment (zero outbox rows, idempotent);
 *   - appDefaults:getExamCounts for collegial serves the real catalog + rows;
 *   - the repo write guard (requireQualifiantCycles) still rejects collegial
 *     writes — collegial rules are read-only official seeds.
 */

const assert = require('assert');
const { setDb } = require('../main/db/context');
const { ensureStageRulesSchema, ensureCycleProfilesSchema, ensureCycleReferenceSchema } = require('../main/db/schema');
const { seedSubjectCatalog } = require('../main/db/education-catalogs/subject-catalog');
const { COLLEGIAL_SUBJECTS } = require('../main/db/education-catalogs/collegial-subjects');
const {
    COLLEGIAL_COEFFICIENTS,
    COLLEGIAL_EXAM_COUNTS,
    COLLEGIAL_WEIGHTS
} = require('../main/db/education-catalogs/collegial-rules');
const { MIGRATIONS } = require('../main/db/migrations');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');

const COLLEGIAL = 'secondary_collegial';
const QUALIFIANT = 'secondary_qualifiant';
const YEAR = '2025/2026';

console.log('[test] collegial stage official file (migration 2026-08-084)');

function openDb() {
    try {
        const Database = require('better-sqlite3');
        const probe = new Database(':memory:');
        probe.close();
        return new Database(':memory:');
    } catch {
        /* better-sqlite3 may be compiled against another Node ABI — fall back */
    }
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.pragma = (statement) => db.prepare(`PRAGMA ${statement}`).all();
    db.transaction = (fn) => fn;
    return db;
}

function buildBoot(db) {
    // Fresh-ish DB: cycle-reference schema + stage rules + profiles + subjects.
    ensureCycleReferenceSchema(db);
    ensureStageRulesSchema(db);
    ensureCycleProfilesSchema(db);
    db.exec(`
        CREATE TABLE system_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            details TEXT,
            entity_type TEXT,
            entity_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE sync_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT NOT NULL,
            row_sync_id TEXT NOT NULL,
            operation TEXT NOT NULL CHECK(operation IN ('PUT','DEL')),
            row_data TEXT,
            school_year TEXT,
            status TEXT NOT NULL DEFAULT 'pending'
        );
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE schema_migrations (version TEXT PRIMARY KEY);
    `);
    db.prepare(`INSERT INTO settings(key, value) VALUES('currentSchoolYear', ?)`).run(YEAR);
    seedSubjectCatalog(db);
    // One active qualifiant rule set for YEAR (mirrors the boot shape created by
    // migration 2026-08-078).
    db.prepare(`INSERT INTO stage_rule_sets(school_year, revision, status, reason) VALUES (?, 1, 'active', ?)`)
        .run(YEAR, 'baseline');
    const setRow = db.prepare(`SELECT id FROM stage_rule_sets WHERE school_year = ? AND revision = 1`).get(YEAR);
    db.prepare(
        `INSERT INTO subject_coefficients(
            rule_set_id, cycle_code, level_code, stream_code, subject_code, coefficient, source
         ) VALUES(?, ?, '*', '2BACSMA', 'MATH', 9, 'official')`
    ).run(setRow.id, QUALIFIANT);
    db.prepare(
        `INSERT INTO exam_count_rules(
            rule_set_id, cycle_code, level_code, subject_code, exam_count, source
         ) VALUES(?, ?, '*', 'MATH', 3, 'official')`
    ).run(setRow.id, QUALIFIANT);
    db.prepare(
        `INSERT INTO subject_weight_rules(
            rule_set_id, cycle_code, subject_code, exam_weight_bps, activity_weight_bps, source
         ) VALUES(?, ?, 'MATH', 10000, 0, 'official')`
    ).run(setRow.id, QUALIFIANT);
    return setRow;
}

function getAssignment(db, year, cycle) {
    return db
        .prepare(`SELECT * FROM cycle_profile_assignments WHERE school_year = ? AND cycle_code = ?`)
        .get(year, cycle);
}

const migration = MIGRATIONS.find((entry) => entry.version === '2026-08-084-collegial-stage-file');
assert.ok(migration, 'migration 2026-08-084-collegial-stage-file must be registered');

const db = openDb();
const activeSet = buildBoot(db);
setDb(db);
setRepoCapturePort(createNoOpCapturePort());

migration.up();

const profile = db
    .prepare(`SELECT cycle_code, profile_version, uses_coefficients, assessment_model
              FROM cycle_profiles WHERE cycle_code = ?`)
    .get(COLLEGIAL);
assert.deepStrictEqual({ ...profile }, {
    cycle_code: COLLEGIAL,
    profile_version: 'collegial-2026-v1',
    uses_coefficients: 1,
    assessment_model: 'exams_activities'
});

const assignment = getAssignment(db, YEAR, COLLEGIAL);
assert.strictEqual(assignment.profile_version, 'collegial-2026-v1');
assert.strictEqual(assignment.rule_set_id, activeSet.id);

const coefficientCount = db
    .prepare(`SELECT COUNT(*) AS count FROM subject_coefficients WHERE rule_set_id = ? AND cycle_code = ?`)
    .get(activeSet.id, COLLEGIAL).count;
const examCount = db
    .prepare(`SELECT COUNT(*) AS count FROM exam_count_rules WHERE rule_set_id = ? AND cycle_code = ?`)
    .get(activeSet.id, COLLEGIAL).count;
const weightCount = db
    .prepare(`SELECT COUNT(*) AS count FROM subject_weight_rules WHERE rule_set_id = ? AND cycle_code = ?`)
    .get(activeSet.id, COLLEGIAL).count;
assert.strictEqual(coefficientCount, COLLEGIAL_COEFFICIENTS.length);
assert.strictEqual(examCount, COLLEGIAL_EXAM_COUNTS.length);
assert.strictEqual(weightCount, COLLEGIAL_WEIGHTS.length);
assert.strictEqual(
    db.prepare(`SELECT COUNT(*) AS count FROM subject_weight_rules WHERE cycle_code = ? AND subject_code = 'TECHNOLOGY'`).get(COLLEGIAL).count,
    0,
    'technology remains fail-closed until its activity ratio is officially available'
);
assert.strictEqual(
    db.prepare(`SELECT exam_count FROM exam_count_rules WHERE cycle_code = ? AND level_code = '2APIC' AND subject_code = 'TECHNOLOGY'`).get(COLLEGIAL).exam_count,
    2
);
assert.strictEqual(db.prepare(`SELECT COUNT(*) AS count FROM sync_outbox`).get().count, 0);

// Re-running the seed path must not duplicate rows or move the assignment.
const { seedOfficialCollegialRows } = require('../main/db/education-catalogs/collegial-rules');
seedOfficialCollegialRows(db, activeSet.id);
assert.strictEqual(
    db.prepare(`SELECT COUNT(*) AS count FROM subject_coefficients WHERE rule_set_id = ? AND cycle_code = ?`).get(activeSet.id, COLLEGIAL).count,
    coefficientCount
);
assert.strictEqual(
    db.prepare(`SELECT COUNT(*) AS count FROM exam_count_rules WHERE rule_set_id = ? AND cycle_code = ?`).get(activeSet.id, COLLEGIAL).count,
    examCount
);
assert.strictEqual(
    db.prepare(`SELECT COUNT(*) AS count FROM subject_weight_rules WHERE rule_set_id = ? AND cycle_code = ?`).get(activeSet.id, COLLEGIAL).count,
    weightCount
);

setRepoCapturePort(null);
setDb(null);
db.close();
console.log('  [ok] profile, official rows, fail-closed technology weight, assignment, and idempotence');
