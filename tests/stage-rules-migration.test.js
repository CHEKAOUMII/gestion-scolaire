'use strict';

const assert = require('assert');
const { setDb } = require('../main/db/context');
const { MIGRATIONS } = require('../main/db/migrations');

function openDb() {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.pragma = (statement) => db.prepare(`PRAGMA ${statement}`).all();
    db.transaction = (fn) => fn;
    return db;
}

function buildUpgradeFixture() {
    const db = openDb();
    db.exec(`
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE students (
            id INTEGER PRIMARY KEY,
            code TEXT,
            section TEXT,
            level TEXT,
            school_year TEXT,
            cycle_code TEXT
        );
        CREATE TABLE system_logs (
            id INTEGER PRIMARY KEY,
            action TEXT,
            entity_type TEXT,
            entity_id TEXT,
            details TEXT
        );
        CREATE TABLE education_levels (
            level_code TEXT NOT NULL,
            cycle_code TEXT NOT NULL,
            label_ar TEXT NOT NULL DEFAULT '',
            label_fr TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
            PRIMARY KEY(level_code, cycle_code)
        );
        CREATE TABLE education_subjects (
            subject_code TEXT PRIMARY KEY,
            label_ar TEXT NOT NULL DEFAULT '',
            label_fr TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1))
        );
        CREATE TABLE subject_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raw_alias TEXT NOT NULL,
            normalized_alias TEXT NOT NULL UNIQUE,
            subject_code TEXT NOT NULL,
            source TEXT
        );
        CREATE TABLE sync_outbox (
            id INTEGER PRIMARY KEY,
            table_name TEXT,
            row_sync_id TEXT,
            operation TEXT,
            row_data TEXT,
            school_year TEXT,
            status TEXT,
            retries INTEGER
        );
        CREATE TABLE exam_count_rules (
            level_code TEXT NOT NULL,
            subject TEXT NOT NULL,
            exam_count INTEGER NOT NULL CHECK (exam_count BETWEEN 1 AND 12),
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (level_code, subject)
        );
        INSERT INTO settings(key, value) VALUES
            ('currentSchoolYear', '2025/2026'),
            ('subjectCoefficientMappings:v1',
             '[{"cycleCode":"secondary_qualifiant","streamCode":"2BACSMA","subject":"الرياضيات","coefficient":7},{"cycleCode":"secondary_qualifiant","streamCode":"TCS","subject":"مادة غير معروفة","coefficient":5}]');
        INSERT INTO students(id, code, section, level, school_year, cycle_code) VALUES
            (1, 'Q-001', 'Q-A', '1BAC', '2025/2026', 'secondary_qualifiant');
        INSERT INTO exam_count_rules(level_code, subject, exam_count) VALUES
            ('*', 'الرياضيات', 3),
            ('2BAC', 'اللغة الفرنسية', 4),
            ('*', 'مواد مبتكرة', 2);
    `);
    return db;
}

function buildFreshFixture() {
    const db = openDb();
    db.exec(`
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE system_logs (
            id INTEGER PRIMARY KEY,
            action TEXT,
            entity_type TEXT,
            entity_id TEXT,
            details TEXT
        );
        CREATE TABLE education_subjects (
            subject_code TEXT PRIMARY KEY,
            label_ar TEXT NOT NULL DEFAULT '',
            label_fr TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1))
        );
        CREATE TABLE subject_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raw_alias TEXT NOT NULL,
            normalized_alias TEXT NOT NULL UNIQUE,
            subject_code TEXT NOT NULL,
            source TEXT
        );
        INSERT INTO settings(key, value) VALUES ('currentSchoolYear', '2025/2026');
    `);
    return db;
}

const migration = MIGRATIONS.find((entry) => entry.version === '2026-08-078-stage-rules-management');
assert.ok(migration, 'stage rules migration must be registered');
const weightsMigration = MIGRATIONS.find((entry) => entry.version === '2026-08-079-stage-subject-weights');
assert.ok(weightsMigration, 'subject weights migration must be registered');

{
    const db = buildUpgradeFixture();
    setDb(db);
    migration.up();
    migration.up();
    weightsMigration.up();
    weightsMigration.up();

    const ruleSets = db.prepare('SELECT * FROM stage_rule_sets').all();
    assert.strictEqual(ruleSets.length, 1, 'one rule set for the single school year');
    assert.strictEqual(ruleSets[0].school_year, '2025/2026');
    assert.strictEqual(ruleSets[0].revision, 1);
    assert.strictEqual(ruleSets[0].status, 'active');

    const activePerYear = db
        .prepare(
            `SELECT school_year, COUNT(*) AS count FROM stage_rule_sets
             WHERE status = 'active' GROUP BY school_year`
        )
        .all();
    assert.ok(activePerYear.every((row) => row.count === 1), 'exactly one active version per year');

    const examColumns = db.prepare('PRAGMA table_info(exam_count_rules)').all().map((c) => c.name);
    for (const column of ['id', 'rule_set_id', 'cycle_code', 'subject_code', 'source']) {
        assert.ok(examColumns.includes(column), `exam_count_rules must have column ${column}`);
    }

    const backfilled = db
        .prepare(
            `SELECT cycle_code, level_code, subject_code, exam_count, source FROM exam_count_rules WHERE rule_set_id = ?`
        )
        .all(ruleSets[0].id);
    const mathematics = backfilled.find((row) => row.subject_code === 'MATH');
    assert.ok(mathematics, 'backfilled mathematics row must map to subject_code');
    assert.strictEqual(mathematics.exam_count, 3);
    assert.strictEqual(mathematics.level_code, '*');
    assert.strictEqual(mathematics.source, 'official');
    assert.ok(backfilled.every((row) => row.cycle_code === 'secondary_qualifiant'));
    const coeffCount = db
        .prepare(`SELECT COUNT(*) AS count FROM subject_coefficients WHERE rule_set_id = ? AND source = 'official'`)
        .get(ruleSets[0].id).count;
    assert.ok(coeffCount > 0, 'official coefficients must be seeded');
    const weightCount = db
        .prepare(`SELECT COUNT(*) AS count FROM subject_weight_rules WHERE rule_set_id = ? AND source = 'official'`)
        .get(ruleSets[0].id).count;
    assert.ok(weightCount > 0, 'official subject weights must be seeded');

    const customRow = db
        .prepare(
            `SELECT * FROM subject_coefficients WHERE rule_set_id = ? AND source = 'custom' AND subject_code = 'MATH'`
        )
        .get(ruleSets[0].id);
    assert.ok(customRow, 'legacy JSON override must migrate to a custom row');
    assert.strictEqual(customRow.coefficient, 7);
    assert.strictEqual(customRow.stream_code, '2BACSMA');
    assert.strictEqual(customRow.level_code, '*');

    const unmappable = db
        .prepare(`SELECT entity_id FROM system_logs WHERE action = 'STAGE_RULES_MIGRATION_UNMAPPABLE'`)
        .all();
    const loggedIds = unmappable.map((row) => row.entity_id);
    assert.ok(loggedIds.includes('مواد مبتكرة'), 'unmappable exam-count subject must be logged');
    assert.ok(loggedIds.includes('مادة غير معروفة'), 'unmappable override subject must be logged');

    const legacyKey = db.prepare(`SELECT value FROM settings WHERE key = 'subjectCoefficientMappings:v1'`).get();
    assert.ok(legacyKey, 'legacy settings key must remain for rollback (rollback-only)');

    const outboxRows = db.prepare('SELECT COUNT(*) AS count FROM sync_outbox').get().count;
    assert.strictEqual(outboxRows, 0, 'migration must not write the sync outbox');

    db.close();
    console.log('[test] stage rules migration (upgrade path): all checks passed');
}

{
    const db = buildFreshFixture();
    setDb(db);
    migration.up();
    weightsMigration.up();

    const ruleSet = db.prepare('SELECT id FROM stage_rule_sets WHERE status = \'active\'').get();
    assert.ok(ruleSet, 'fresh install must create an active rule set for the current year');

    const seededRows = db
        .prepare(`SELECT DISTINCT subject_code FROM exam_count_rules WHERE rule_set_id = ? AND level_code = '*'`)
        .all(ruleSet.id);
    const seededCodes = new Set(seededRows.map((row) => row.subject_code));
    assert.strictEqual(seededCodes.size, 14, 'duplicate display names collapse to one subject_code');
    for (const code of ['MATH', 'FRENCH', 'ARABIC', 'ENGLISH', 'HISTORY_GEOGRAPHY']) {
        assert.ok(seededCodes.has(code), `fresh install must seed ${code}`);
    }
    assert.ok(
        db.prepare(`SELECT COUNT(*) AS count FROM subject_weight_rules WHERE rule_set_id = ?`).get(ruleSet.id).count > 0,
        'fresh install must seed subject weights'
    );

    const freshUnmappable = db
        .prepare(`SELECT COUNT(*) AS count FROM system_logs WHERE action = 'STAGE_RULES_MIGRATION_UNMAPPABLE'`)
        .get().count;
    assert.strictEqual(freshUnmappable, 0, 'fresh install must not log unmappable rows');

    db.close();
    console.log('[test] stage rules migration (fresh install): all checks passed');
}
