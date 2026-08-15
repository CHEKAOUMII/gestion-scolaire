'use strict';

/**
 * Primary-stage catalogs (docs/plans/2026-08-01-primary-stage-catalogs.md, S1–S3 + S6):
 *   - S1: catalog entry (preview) + inference patterns, anchored `1AP` vs `1APIC`;
 *   - S2/S3: migration seeds education_levels (three cycles), education_subjects
 *     (institution-wide union, first-wins aliases), level_aliases and the primary
 *     institution_cycles row via direct SQL — idempotent, zero outbox rows;
 *   - cycle-aware appDefaults:listLevels endpoint (API only, no UI consumption).
 */

const assert = require('assert');
const { setDb } = require('../main/db/context');
const { MIGRATIONS, populateSectionsFromStudents } = require('../main/db/migrations');
const {
    CYCLE_CATALOG,
    getCycleDefinition,
    inferCycleFromSection,
    inferCycleFromLevel,
    inferEducationPlacement
} = require('../js/shared/education/cycles');

const PRIMARY = 'primary';
const COLLEGIAL = 'secondary_collegial';
const QUALIFIANT = 'secondary_qualifiant';

console.log('[test] primary-stage catalogs (S1–S3)');

function openDb() {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.pragma = (statement) => db.prepare(`PRAGMA ${statement}`).all();
    db.transaction = (fn) => fn;
    return db;
}

// ── S1: catalog + inference ─────────────────────────────────────────────────
const primaryDefinition = getCycleDefinition(PRIMARY);
assert.ok(primaryDefinition, 'primary must be in the cycle catalog');
assert.strictEqual(primaryDefinition.labelAr, 'سلك التعليم الابتدائي');
assert.strictEqual(primaryDefinition.labelFr, 'Enseignement primaire');
assert.strictEqual(primaryDefinition.sortOrder, 5);
assert.strictEqual(primaryDefinition.seedProfileVersionHint, 'primary-2026-v1');
assert.strictEqual(primaryDefinition.capability, 'preview', 'primary is preview until the flows slice');
assert.strictEqual(CYCLE_CATALOG.length, 3);

// sections: primary patterns + anchored collision with collegial APIC
assert.strictEqual(inferCycleFromSection('1AP'), PRIMARY);
assert.strictEqual(inferCycleFromSection('3AP'), PRIMARY);
assert.strictEqual(inferCycleFromSection('6AP'), PRIMARY);
assert.strictEqual(inferCycleFromSection('1AP-1'), PRIMARY);
assert.strictEqual(inferCycleFromSection('1APIC'), COLLEGIAL, 'APIC wins over the AP prefix');
assert.strictEqual(inferCycleFromSection('2APIC-1'), COLLEGIAL);
assert.strictEqual(inferCycleFromSection('1BACSE-1'), QUALIFIANT);
assert.strictEqual(inferCycleFromSection('TCS'), QUALIFIANT);
assert.strictEqual(inferCycleFromSection('9AP'), null);
assert.strictEqual(inferCycleFromSection('1API'), null, '1API is neither anchored 1AP nor 1APIC');
assert.strictEqual(inferCycleFromSection(''), null);

// levels: latin + Arabic patterns
assert.strictEqual(inferCycleFromLevel('1AP'), PRIMARY);
assert.strictEqual(inferCycleFromLevel('6AP'), PRIMARY);
assert.strictEqual(inferCycleFromLevel('الأولى ابتدائي'), PRIMARY);
assert.strictEqual(inferCycleFromLevel('السادسة ابتدائي'), PRIMARY);
assert.strictEqual(inferCycleFromLevel('الرابعة ابتدائي'), PRIMARY);
assert.strictEqual(inferCycleFromLevel('1APIC'), COLLEGIAL);
assert.strictEqual(inferCycleFromLevel('الثالثة إعدادي'), COLLEGIAL);
assert.strictEqual(inferCycleFromLevel('الأولى باكالوريا'), QUALIFIANT);
assert.strictEqual(inferCycleFromLevel('1BAC'), QUALIFIANT);
assert.strictEqual(inferCycleFromLevel(''), null);

// combined placement: agreement resolves, conflict never guesses
assert.strictEqual(inferEducationPlacement({ section: '1AP', level: 'الأولى ابتدائي' }), PRIMARY);
assert.strictEqual(inferEducationPlacement({ section: '1AP', level: '1APIC' }), null);
assert.strictEqual(inferEducationPlacement({ section: 'unknown', level: 'unknown' }), null);
console.log('  [ok] S1 catalog entry + inference patterns (anchored 1AP vs 1APIC)');

// ── S2/S3: migration seeding ────────────────────────────────────────────────
const migration = MIGRATIONS.find((entry) => entry.version === '2026-08-080-primary-stage-catalogs');
assert.ok(migration, 'primary-stage catalogs migration must be registered');

function buildFixture() {
    const db = openDb();
    db.exec(`
        CREATE TABLE education_levels (
            level_code TEXT NOT NULL,
            cycle_code TEXT NOT NULL,
            label_ar TEXT NOT NULL DEFAULT '',
            label_fr TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
            PRIMARY KEY(level_code, cycle_code)
        );
        CREATE TABLE level_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cycle_code TEXT NOT NULL,
            raw_alias TEXT NOT NULL,
            normalized_alias TEXT NOT NULL,
            level_code TEXT NOT NULL,
            source TEXT,
            UNIQUE(cycle_code, normalized_alias)
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
        CREATE TABLE institution_cycles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cycle_code TEXT NOT NULL UNIQUE,
            is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
            seed_profile_version_hint TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    `);
    return db;
}

{
    const db = buildFixture();
    setDb(db);

    const outboxBefore = db.prepare('SELECT COUNT(*) AS c FROM sync_outbox').get().c;
    migration.up();
    const outboxAfterFirstRun = db.prepare('SELECT COUNT(*) AS c FROM sync_outbox').get().c;
    migration.up(); // idempotence: second run must not add rows

    // institution_cycles seeded directly via migration SQL — exactly one row.
    const cycles = db.prepare('SELECT * FROM institution_cycles').all();
    assert.strictEqual(cycles.length, 1, 'direct SQL seed, not cyclesRepo.addCycle');
    assert.strictEqual(cycles[0].cycle_code, PRIMARY);
    assert.strictEqual(cycles[0].seed_profile_version_hint, 'primary-2026-v1');
    assert.strictEqual(Number(cycles[0].is_active), 1);
    assert.strictEqual(Number(cycles[0].sort_order), 5);
    assert.strictEqual(outboxAfterFirstRun, outboxBefore, 'migration must not write the sync outbox');
    assert.strictEqual(outboxBefore, 0);

    // education_levels: all three cycles seeded, no duplicate keys after rerun.
    const levels = db.prepare('SELECT * FROM education_levels ORDER BY cycle_code, sort_order').all();
    const levelKeys = new Set(levels.map((row) => `${row.cycle_code}:${row.level_code}`));
    for (const code of ['1AP', '2AP', '3AP', '4AP', '5AP', '6AP']) {
        assert.ok(levelKeys.has(`${PRIMARY}:${code}`), `primary level ${code} must be seeded`);
    }
    for (const code of ['1APIC', '2APIC', '3APIC']) {
        assert.ok(levelKeys.has(`${COLLEGIAL}:${code}`), `collegial level ${code} must be seeded`);
    }
    for (const code of ['1BACSM', 'TCS', '2BACSMA']) {
        assert.ok(levelKeys.has(`${QUALIFIANT}:${code}`), `qualifiant level ${code} must be seeded`);
    }
    assert.ok(!levelKeys.has(`${QUALIFIANT}:*`), 'the "*" default marker is not a real level');
    assert.strictEqual(
        db.prepare('SELECT COUNT(*) AS c FROM education_levels').get().c,
        levels.length,
        'level seeding must be idempotent'
    );
    const firstPrimary = db
        .prepare(`SELECT * FROM education_levels WHERE cycle_code = ? AND level_code = '1AP'`)
        .get(PRIMARY);
    assert.strictEqual(firstPrimary.label_ar, 'الأولى ابتدائي');

    // level_aliases: primary import aliases, normalized, cycle-scoped.
    const aliasRows = db.prepare(`SELECT * FROM level_aliases WHERE cycle_code = ?`).all(PRIMARY);
    assert.ok(aliasRows.length >= 6, 'each primary level gets at least its ordinal alias');
    const byNormalized = new Map(aliasRows.map((row) => [row.normalized_alias, row.level_code]));
    assert.strictEqual(byNormalized.get('1AP'), '1AP');
    assert.strictEqual(byNormalized.get('السنه الاولي'), '1AP', 'السنة الأولى normalizes to 1AP');
    assert.strictEqual(byNormalized.get('السنه السادسه'), '6AP', 'السنة السادسة normalizes to 6AP');
    assert.strictEqual(byNormalized.get('الخامسه'), '5AP');
    assert.strictEqual(
        db.prepare('SELECT COUNT(*) AS c FROM level_aliases').get().c,
        aliasRows.length,
        'alias seeding must be idempotent'
    );

    // education_subjects: institution-wide UNION — no duplicates, primary codes added.
    const subjectRows = db.prepare('SELECT subject_code FROM education_subjects ORDER BY subject_code').all();
    const subjectCodes = subjectRows.map((row) => row.subject_code);
    assert.strictEqual(subjectCodes.length, new Set(subjectCodes).size, 'no duplicate subject rows');
    for (const code of ['ARABIC', 'MATH', 'ISLAMIC_EDUCATION', 'FRENCH', 'SCIENCE_ACTIVITY', 'SOCIAL_STUDIES', 'ARTS_EDUCATION', 'PHYSICAL_MOTOR_EDUCATION']) {
        assert.ok(subjectCodes.includes(code), `subject ${code} must be seeded`);
    }
    assert.strictEqual(
        db.prepare('SELECT COUNT(*) AS c FROM education_subjects').get().c,
        subjectRows.length,
        'subject seeding must be idempotent'
    );

    // subject_aliases: first-wins — the pre-existing qualifiant alias 'الاجتماعيات'
    // (→ HISTORY_GEOGRAPHY) survives the primary SOCIAL_STUDIES union.
    const socialStudiesAlias = db.prepare(`SELECT subject_code FROM subject_aliases WHERE normalized_alias = ?`).get('الاجتماعيات');
    assert.strictEqual(socialStudiesAlias.subject_code, 'HISTORY_GEOGRAPHY', 'first-wins global alias');
    const scienceAlias = db.prepare(`SELECT subject_code FROM subject_aliases WHERE normalized_alias = ?`).get('النشاط العلمي');
    assert.strictEqual(scienceAlias.subject_code, 'SCIENCE_ACTIVITY', 'new primary alias resolves to its code');
    const motorAlias = db.prepare(`SELECT subject_code FROM subject_aliases WHERE normalized_alias = ?`).get('التربيه البدنيه والحركيه');
    assert.strictEqual(motorAlias.subject_code, 'PHYSICAL_MOTOR_EDUCATION');

    // No primary exam_count_rules are seeded by this slice (official rule pending).
    db.close();
    console.log('  [ok] S3 migration seeds cycles/levels/subjects/aliases idempotently, no outbox');
}

// ── 2026-08-086: rename the seed/profile-version hint column ────────────────
{
    const renameMigration = MIGRATIONS.find((entry) => entry.version === '2026-08-086-rename-cycle-seed-profile-version-hint');
    assert.ok(renameMigration, 'cycle seed-profile-version-hint rename migration must be registered');

    function columnNames(db) {
        return db.prepare(`PRAGMA table_info(institution_cycles)`).all().map((c) => c.name);
    }

    // Upgraded DB: the pre-rename column exists and must be renamed in place.
    {
        const db = openDb();
        db.exec(`
            CREATE TABLE institution_cycles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cycle_code TEXT NOT NULL UNIQUE,
                is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
                profile_version TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        db.prepare(
            `INSERT INTO institution_cycles (cycle_code, is_active, profile_version, sort_order)
             VALUES (?, 1, 'qualifiant-2026-v1', 20)`
        ).run(QUALIFIANT);
        setDb(db);
        renameMigration.up();
        assert.ok(columnNames(db).includes('seed_profile_version_hint'), 'old column is renamed on upgraded DBs');
        assert.ok(!columnNames(db).includes('profile_version'), 'old hint column no longer exists');
        const row = db.prepare(`SELECT * FROM institution_cycles WHERE cycle_code = ?`).get(QUALIFIANT);
        assert.strictEqual(row.seed_profile_version_hint, 'qualifiant-2026-v1', 'hint value survives the rename');
        renameMigration.up(); // idempotence: a re-run must be a no-op
        assert.ok(columnNames(db).includes('seed_profile_version_hint'));
        assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM institution_cycles').get().c, 1);
        db.close();
        console.log('  [ok] 086 renames institution_cycles.profile_version on upgraded DBs, idempotently');
    }

    // Migration 070 is the first migration that writes the hint column. It must
    // repair an upgraded pre-086 table before issuing that INSERT.
    {
        const institutionMigration = MIGRATIONS.find((entry) => entry.version === '2026-07-070-institution-cycles');
        assert.ok(institutionMigration, 'institution cycle migration must be registered');
        const db = openDb();
        db.exec(`
            CREATE TABLE institution_cycles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cycle_code TEXT NOT NULL UNIQUE,
                is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
                profile_version TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        db.prepare(
            `INSERT INTO institution_cycles (cycle_code, is_active, profile_version, sort_order)
             VALUES (?, 1, 'qualifiant-2026-v1', 20)`
        ).run(QUALIFIANT);
        setDb(db);
        institutionMigration.up();
        assert.ok(columnNames(db).includes('seed_profile_version_hint'), 'migration 070 repairs the old hint column first');
        assert.strictEqual(
            db.prepare(`SELECT COUNT(*) AS c FROM institution_cycles WHERE cycle_code = ?`).get(QUALIFIANT).c,
            1,
            'migration 070 remains idempotent after the compatibility rename'
        );
        db.close();
        setDb(null);
        console.log('  [ok] migration 070 repairs old hint schema before its first INSERT');
    }

    // Fresh DB: the new column name already exists — nothing to rename, no outbox.
    {
        const db = openDb();
        db.exec(`
            CREATE TABLE institution_cycles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cycle_code TEXT NOT NULL UNIQUE,
                is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
                seed_profile_version_hint TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
        `);
        db.prepare(
            `INSERT INTO institution_cycles (cycle_code, is_active, seed_profile_version_hint, sort_order)
             VALUES (?, 1, 'primary-2026-v1', 5)`
        ).run(PRIMARY);
        setDb(db);
        const outboxBefore = db.prepare('SELECT COUNT(*) AS c FROM sync_outbox').get().c;
        renameMigration.up();
        assert.ok(columnNames(db).includes('seed_profile_version_hint'));
        assert.ok(!columnNames(db).includes('profile_version'));
        assert.strictEqual(
            db.prepare('SELECT COUNT(*) AS c FROM sync_outbox').get().c,
            outboxBefore,
            'the rename writes zero outbox rows'
        );
        db.close();
        console.log('  [ok] 086 is a no-op on fresh schemas with zero outbox rows');
    }
}

// ── S1/S3: re-running inference never rewrites an explicit cycle_code ───────
{
    const db = openDb();
    db.exec(`
        CREATE TABLE students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            full_name TEXT NOT NULL,
            section TEXT,
            level TEXT,
            school_year TEXT NOT NULL,
            cycle_code TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE sections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            section_code TEXT NOT NULL,
            raw_name TEXT NOT NULL,
            normalized_name TEXT NOT NULL,
            cycle_code TEXT NOT NULL,
            level_code TEXT,
            stream_code TEXT,
            school_year TEXT NOT NULL,
            UNIQUE(section_code, cycle_code, school_year)
        );
        CREATE TABLE system_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT,
            entity_type TEXT,
            entity_id INTEGER,
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    setDb(db);
    const insertStudent = db.prepare(
        `INSERT INTO students(code, full_name, section, level, school_year, cycle_code)
         VALUES(?, ?, ?, ?, ?, ?)`
    );
    // 1. Explicit qualifiant cycle + primary-looking section → cycle is kept.
    insertStudent.run('Q1', 'تلميذ تأهيلي', '1AP', '1AP', '2025/2026', QUALIFIANT);
    // 2. No cycle + primary section → inferred primary.
    insertStudent.run('P1', 'تلميذ ابتدائي', '2AP', '2AP', '2025/2026', '');
    // 3. No cycle + unclassifiable section → reported, never guessed.
    insertStudent.run('U1', 'غير مصنف', 'ZZ99', '', '2025/2026', '');

    populateSectionsFromStudents(db);
    const sectionsAfterFirst = db.prepare('SELECT * FROM sections ORDER BY section_code').all();
    assert.deepStrictEqual(
        sectionsAfterFirst.map((row) => [row.section_code, row.cycle_code]).sort(),
        [
            ['1AP', QUALIFIANT],
            ['2AP', PRIMARY]
        ],
        'explicit cycle wins over inference; unclassifiable rows are skipped'
    );
    const unclassifiedLog = db
        .prepare(`SELECT * FROM system_logs WHERE action = 'CYCLE_SECTION_UNCLASSIFIED'`)
        .all();
    assert.strictEqual(unclassifiedLog.length, 1, 'unclassified students are logged for review');
    const samples = JSON.parse(unclassifiedLog[0].details).samples;
    assert.strictEqual(samples.length, 1);
    assert.strictEqual(samples[0].id, 3);

    // Re-running the classifier must not reclassify or duplicate anything.
    populateSectionsFromStudents(db);
    const sectionsAfterSecond = db.prepare('SELECT * FROM sections ORDER BY id').all();
    assert.strictEqual(sectionsAfterSecond.length, 2, 're-inference is idempotent');
    assert.strictEqual(
        sectionsAfterSecond.find((row) => row.section_code === '1AP').cycle_code,
        QUALIFIANT,
        're-inference never rewrites an explicit cycle_code'
    );
    assert.strictEqual(
        sectionsAfterSecond.find((row) => row.section_code === '2AP').cycle_code,
        PRIMARY,
        'inferred cycles stay stable across re-runs'
    );
    db.close();
    console.log('  [ok] S1 non-retroactive inference: explicit cycles kept, unclassified logged');
}

// ── S3/S5: cycle-aware appDefaults:listLevels (API only) ────────────────────
{
    const handlers = new Map();
    const { registerAppDefaultsIpc } = require('../main/ipc/appDefaults');
    registerAppDefaultsIpc({ handle: (channel, handler) => handlers.set(channel, handler) });
    const db = buildFixture();
    setDb(db);
    migration.up();

    const listLevels = (payload) => handlers.get('appDefaults:listLevels')({}, payload);

    listLevels(undefined).then((legacy) => {
        assert.strictEqual(legacy.success, true);
        assert.ok(Array.isArray(legacy.levels) && legacy.levels.length > 0);
        assert.strictEqual(legacy.levels[0].code, '*', 'legacy shape is unchanged without a cycle');

        return listLevels({ cycleCode: PRIMARY });
    }).then((primaryLevels) => {
        assert.strictEqual(primaryLevels.success, true);
        assert.strictEqual(primaryLevels.cycleCode, PRIMARY);
        assert.deepStrictEqual(
            primaryLevels.levels.map((level) => level.code),
            ['1AP', '2AP', '3AP', '4AP', '5AP', '6AP']
        );
        assert.strictEqual(primaryLevels.levels[0].name, 'الأولى ابتدائي');

        return listLevels({ cycleCode: COLLEGIAL });
    }).then((collegialLevels) => {
        assert.strictEqual(collegialLevels.success, true);
        assert.deepStrictEqual(
            collegialLevels.levels.map((level) => level.code),
            ['1APIC', '2APIC', '3APIC']
        );

        return listLevels({ cycleCode: 'unknown_cycle' });
    }).then((unknown) => {
        assert.strictEqual(unknown.success, false);
        assert.strictEqual(unknown.code, 'UNKNOWN_CYCLE');
        db.close();
        console.log('  [ok] appDefaults:listLevels serves one catalog per cycle');
    }).catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
