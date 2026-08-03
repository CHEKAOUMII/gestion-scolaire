'use strict';

/**
 * S2-2 — qualifiant level catalog single-source dedup
 * (docs/plans/2026-08-02-multi-stage-school-architecture.md, §3 S2-2).
 *
 * The 41-code qualifiant catalog now lives ONLY in
 * js/shared/education/qualifiant-levels.js (dual-export IIFE, pattern 028):
 *   - main/db/exam-count-defaults.js aliases it (`LEVEL_CODES` has no '*' row);
 *   - js/utils.js references the shared map/keys and delegates matching;
 *   - appDefaults:listLevels prepends the legacy '*' adapter row in the
 *     no-cycle and qualifiant paths so callers see byte-identical output.
 */

const assert = require('assert');
const { setDb } = require('../main/db/context');
const { MIGRATIONS } = require('../main/db/migrations');
const shared = require('../js/shared/education/qualifiant-levels');

const EXPECTED_CODES = [
    'TCSF', 'TCSA', 'TCS', 'TCLSH', 'TCL', 'TCTF',
    '1BACSMF', '1BACSMA', '1BACSM', '1BACSEF', '1BACSEA', '1BACSE',
    '1BACSH', '1BACL', '1BACSEG', '1BACECO', '1BACGE',
    '2BACSMA', '2BACSMB', '2BACSM', '2BACSVTF', '2BACSVT',
    '2BACPCF', '2BACPC', '2BACSPF', '2BACSP',
    '2BACSHF', '2BACSH', '2BACL', '2BACLETF', '2BACLET',
    '2BACSECF', '2BACSEC', '2BACSE', '2BACECO',
    '2BACSGCF', '2BACSGC', '2BACGC', '2BACSA', '2BACOAF', '2BACAO'
];

console.log('[test] S2-2 qualifiant level catalog single-source dedup');

// ── Canonical module: content and shape ────────────────────────────────────
const { QUALIFIANT_LEVELS, LEVEL_CODE_TO_AR, LEVEL_KEYS_DESC, matchLevelFromSection } = shared;
assert.ok(Object.isFrozen(QUALIFIANT_LEVELS), 'QUALIFIANT_LEVELS is frozen');
assert.ok(Object.isFrozen(LEVEL_CODE_TO_AR), 'LEVEL_CODE_TO_AR is frozen');
assert.ok(Array.isArray(QUALIFIANT_LEVELS), 'QUALIFIANT_LEVELS is an array');
assert.strictEqual(QUALIFIANT_LEVELS.length, EXPECTED_CODES.length, 'catalog length matches the expected key list');
assert.ok(QUALIFIANT_LEVELS.length >= 41, 'at least the 41 qualifiant levels');
assert.ok(!QUALIFIANT_LEVELS.some((entry) => entry.code === '*'), 'no "*" all-levels marker in the canonical catalog');
assert.deepStrictEqual(
    QUALIFIANT_LEVELS.map((entry) => entry.code),
    EXPECTED_CODES,
    'union of the two legacy catalogs, utils.js insertion order (TCS*, 1BAC*, 2BAC*)'
);
assert.deepStrictEqual(
    Object.keys(LEVEL_CODE_TO_AR),
    EXPECTED_CODES,
    'LEVEL_CODE_TO_AR keys are the same canonical set'
);
for (const entry of QUALIFIANT_LEVELS) {
    const info = LEVEL_CODE_TO_AR[entry.code];
    assert.strictEqual(info.name, entry.name, `name parity for ${entry.code}`);
    assert.strictEqual(info.order, entry.order, `order parity for ${entry.code}`);
}
const descLengths = LEVEL_KEYS_DESC.map((key) => key.length);
assert.deepStrictEqual(descLengths, [...descLengths].sort((a, b) => b - a), 'LEVEL_KEYS_DESC is sorted by descending length');
assert.deepStrictEqual(new Set(LEVEL_KEYS_DESC), new Set(EXPECTED_CODES), 'LEVEL_KEYS_DESC covers the same codes');
console.log('  [ok] canonical catalog: 41 codes, no "*", frozen, keys-desc sorted');

// ── exam-count-defaults aliases the shared array (no copy) ─────────────────
const examCountDefaults = require('../main/db/exam-count-defaults');
assert.strictEqual(examCountDefaults.LEVEL_CODES, QUALIFIANT_LEVELS, 'LEVEL_CODES is the shared frozen array');
assert.strictEqual(examCountDefaults.QUALIFIANT_LEVEL_CODES, QUALIFIANT_LEVELS, 'QUALIFIANT_LEVEL_CODES === LEVEL_CODES === shared array');
assert.ok(!examCountDefaults.LEVEL_CODES.some((entry) => entry.code === '*'), 'LEVEL_CODES has no "*" row');
console.log('  [ok] exam-count-defaults re-exports the shared array by reference');

// ── matchLevelFromSection: faithful port of getLevelFromSection ────────────
assert.deepStrictEqual(matchLevelFromSection('TCSF-1'), {
    code: 'tcsf',
    name: 'الجذع المشترك العلمي خيار فرنسية',
    order: 1
});
assert.deepStrictEqual(matchLevelFromSection('2BACAO-3'), {
    code: '2bacao',
    name: 'الثانية باكالوريا تعليم أصيل',
    order: 20
});
assert.deepStrictEqual(matchLevelFromSection('ZZZ'), { code: 'other', name: 'ZZZ', order: 99 });
assert.deepStrictEqual(matchLevelFromSection(''), { code: 'other', name: 'أخرى', order: 99 });
assert.deepStrictEqual(matchLevelFromSection('TCX-1'), { code: 'tc', name: 'الجذع المشترك', order: 90 });
assert.deepStrictEqual(matchLevelFromSection('1BACX-1'), { code: '1bac', name: 'الأولى باكالوريا', order: 91 });
assert.deepStrictEqual(matchLevelFromSection('2BACX-1'), { code: '2bac', name: 'الثانية باكالوريا', order: 92 });
console.log('  [ok] matchLevelFromSection exact/prefix/fallback matches');

// ── appDefaults:listLevels keeps the legacy "*" adapter ────────────────────
function openDb() {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.pragma = (statement) => db.prepare(`PRAGMA ${statement}`).all();
    db.transaction = (fn) => fn;
    return db;
}

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
            profile_version TEXT NOT NULL,
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
    const handlers = new Map();
    const { registerAppDefaultsIpc } = require('../main/ipc/appDefaults');
    registerAppDefaultsIpc({ handle: (channel, handler) => handlers.set(channel, handler) });
    const db = buildFixture();
    setDb(db);
    const migration = MIGRATIONS.find((entry) => entry.version === '2026-08-080-primary-stage-catalogs');
    migration.up();

    const listLevels = (payload) => handlers.get('appDefaults:listLevels')({}, payload);

    listLevels(undefined)
        .then((legacy) => {
            assert.strictEqual(legacy.success, true);
            assert.strictEqual(legacy.levels.length, EXPECTED_CODES.length + 1, 'legacy list = "*" + 41 codes');
            assert.deepStrictEqual(legacy.levels[0], { code: '*', name: 'الافتراضي (كل المستويات)', order: 0 });
            assert.deepStrictEqual(
                legacy.levels.slice(1).map((level) => level.code),
                EXPECTED_CODES,
                'legacy rows after "*" are the canonical catalog in order'
            );
            assert.strictEqual(legacy.levels[1].name, 'الجذع المشترك العلمي خيار فرنسية');

            return listLevels({ cycleCode: 'secondary_qualifiant' });
        })
        .then((qualifiant) => {
            assert.strictEqual(qualifiant.success, true);
            assert.strictEqual(qualifiant.cycleCode, 'secondary_qualifiant');
            assert.strictEqual(qualifiant.levels[0].code, '*', 'qualifiant per-cycle list also starts with "*"');
            assert.strictEqual(qualifiant.levels.length, EXPECTED_CODES.length + 1);

            return listLevels({ cycleCode: 'primary' });
        })
        .then((primaryLevels) => {
            assert.strictEqual(primaryLevels.success, true);
            assert.deepStrictEqual(
                primaryLevels.levels.map((level) => level.code),
                ['1AP', '2AP', '3AP', '4AP', '5AP', '6AP'],
                'primary per-cycle list is exactly the 6 primary codes, no "*"'
            );
            assert.ok(!primaryLevels.levels.some((level) => level.code === '*'), 'primary list has no "*" row');

            return listLevels({ cycleCode: 'unknown_cycle' });
        })
        .then((unknown) => {
            assert.strictEqual(unknown.success, false);
            assert.strictEqual(unknown.code, 'UNKNOWN_CYCLE');
            db.close();
            console.log('  [ok] appDefaults:listLevels keeps "*" adapter (legacy + qualifiant), primary unchanged');
            console.log('[test] S2-2 qualifiant level catalog single-source dedup: all checks passed');
        })
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
}
