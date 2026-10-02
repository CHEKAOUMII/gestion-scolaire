'use strict';

/**
 * Slice 5 — configuration isolation (isolation plan §"Slice 5").
 *
 *   - Stage calendars / terms / attendance rules resolve per
 *     (school_year, cycle_code) via main/repos/stage-config.js — device-local
 *     data (like page-access), zero outbox rows.
 *   - Unknown stage config fails closed with STAGE_CONFIG_MISSING — resolution
 *     never falls back to the other stage's calendar. Unknown cycles fail with
 *     UNKNOWN_CYCLE.
 *   - `education_subjects` is never forked: the stage-config module holds no
 *     subject catalog (stage binding happens via rule/profile rows only).
 *   - Per-cycle level catalogs stay authoritative AND the appDefaults `*` compat
 *     row is preserved (row 124: deletion forbidden).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { setDb } = require('../main/db/context');
const stageConfig = require('../main/repos/stage-config');
const StageConfigErrorContract = require('../js/shared/errors/stage-config-error-contract');
const { PRIMARY_LEVEL_CODES, COLLEGIAL_LEVEL_CODES } = require('../main/db/education-catalogs/primary-levels');
const { QUALIFIANT_LEVELS } = require('../js/shared/education/qualifiant-levels');

const COLLEGIAL = 'secondary_collegial';
const QUALIFIANT = 'secondary_qualifiant';
const YEAR = '2025/2026';

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

function listTables(db) {
    return db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => row.name);
}

(async () => {
    console.log('[test] Slice 5 stage-scoped configuration isolation');
    const db = openDb();
    setDb(db);
    db.exec(`
        CREATE TABLE sync_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT NOT NULL,
            row_sync_id TEXT NOT NULL,
            operation TEXT NOT NULL CHECK(operation IN ('PUT','DEL')),
            row_data TEXT,
            school_year TEXT,
            status TEXT NOT NULL DEFAULT 'pending'
        );
    `);

    // ── Error contract SSOT ──
    assert.deepStrictEqual(
        Object.keys(StageConfigErrorContract.STAGE_CONFIG_ERROR_CODES).sort(),
        ['STAGE_CONFIG_INVALID', 'STAGE_CONFIG_MISSING', 'UNKNOWN_CYCLE'],
        'stage-config error codes must stay the documented SSOT'
    );
    assert.strictEqual(
        stageConfig.STAGE_CONFIG_ERROR_CODES,
        StageConfigErrorContract.STAGE_CONFIG_ERROR_CODES,
        'repo and contract share one code object (no parallel catalog)'
    );
    assert.deepStrictEqual(
        Object.values(stageConfig.STAGE_CONFIG_KEYS).sort(),
        ['attendance_rules', 'calendar', 'terms'],
        'stage-config keys stay a closed set'
    );
    console.log('  [ok] error contract SSOT shared between repo and contract module');

    // ── Idempotent schema, local data only ──
    stageConfig.ensureStageConfigSchema(db);
    stageConfig.ensureStageConfigSchema(db);
    assert.deepStrictEqual(
        listTables(db).filter((name) => !name.startsWith('sqlite_')).sort(),
        ['stage_configs', 'sync_outbox'],
        'ensureStageConfigSchema creates exactly one table (idempotent)'
    );
    assert.strictEqual(
        db.prepare('SELECT COUNT(*) AS count FROM sync_outbox').get().count,
        0,
        'stage-config DDL writes zero outbox rows'
    );
    console.log('  [ok] schema idempotent, zero outbox rows');

    // ── Per-stage isolation: each stage resolves its own calendar ──
    const collegialCalendar = { startDate: `${YEAR.slice(0, 4)}-09-08`, holidays: ['عيد المولد'] };
    const qualifiantCalendar = { startDate: `${YEAR.slice(0, 4)}-09-04`, holidays: ['عطلة بينية'] };
    stageConfig.saveStageConfig(db, {
        schoolYear: YEAR,
        cycleCode: COLLEGIAL,
        configKey: 'calendar',
        value: collegialCalendar
    });
    stageConfig.saveStageConfig(db, {
        schoolYear: YEAR,
        cycleCode: QUALIFIANT,
        configKey: 'calendar',
        value: qualifiantCalendar
    });
    assert.deepStrictEqual(
        stageConfig.resolveStageConfig(db, YEAR, COLLEGIAL, 'calendar').value,
        collegialCalendar,
        'collegial resolves its own calendar'
    );
    assert.deepStrictEqual(
        stageConfig.resolveStageConfig(db, YEAR, QUALIFIANT, 'calendar').value,
        qualifiantCalendar,
        'qualifiant resolves its own calendar'
    );
    assert.strictEqual(
        db.prepare('SELECT COUNT(*) AS count FROM sync_outbox').get().count,
        0,
        'stage-config writes are device-local — zero outbox rows'
    );
    console.log('  [ok] per-stage calendars resolve without crossing');

    // ── Missing config fails closed — never the other stage's row ──
    stageConfig.saveStageConfig(db, {
        schoolYear: YEAR,
        cycleCode: QUALIFIANT,
        configKey: 'terms',
        value: { semesters: 2 }
    });
    assert.throws(
        () => stageConfig.resolveStageConfig(db, YEAR, COLLEGIAL, 'terms'),
        (error) =>
            error.code === 'STAGE_CONFIG_MISSING' &&
            error.details?.cycleCode === COLLEGIAL &&
            error.details?.configKey === 'terms',
        'missing collegial terms must throw STAGE_CONFIG_MISSING, never qualifiant terms'
    );
    assert.throws(
        () => stageConfig.resolveStageConfig(db, '2024/2025', QUALIFIANT, 'calendar'),
        (error) => error.code === 'STAGE_CONFIG_MISSING',
        'missing year fails closed as well'
    );
    console.log('  [ok] unknown stage config = STAGE_CONFIG_MISSING (never the other stage calendar)');

    // ── Unknown cycle + invalid payloads ──
    assert.throws(
        () => stageConfig.resolveStageConfig(db, YEAR, 'made_up_cycle', 'calendar'),
        (error) => error.code === 'UNKNOWN_CYCLE',
        'unknown cycle resolves to UNKNOWN_CYCLE'
    );
    assert.throws(
        () => stageConfig.saveStageConfig(db, { schoolYear: YEAR, cycleCode: 'made_up_cycle', configKey: 'calendar', value: {} }),
        (error) => error.code === 'UNKNOWN_CYCLE',
        'unknown cycle saves to UNKNOWN_CYCLE'
    );
    assert.throws(
        () => stageConfig.resolveStageConfig(db, YEAR, QUALIFIANT, 'nope'),
        (error) => error.code === 'STAGE_CONFIG_INVALID',
        'unknown config key is STAGE_CONFIG_INVALID'
    );
    assert.throws(
        () => stageConfig.saveStageConfig(db, { schoolYear: '2025', cycleCode: QUALIFIANT, configKey: 'calendar', value: {} }),
        (error) => error.code === 'STAGE_CONFIG_INVALID',
        'malformed school year is STAGE_CONFIG_INVALID'
    );
    for (const badValue of [null, 'x', 42, ['array']]) {
        assert.throws(
            () => stageConfig.saveStageConfig(db, { schoolYear: YEAR, cycleCode: QUALIFIANT, configKey: 'calendar', value: badValue }),
            (error) => error.code === 'STAGE_CONFIG_INVALID',
            `non-object value (${JSON.stringify(badValue)}) is STAGE_CONFIG_INVALID`
        );
    }
    console.log('  [ok] UNKNOWN_CYCLE + STAGE_CONFIG_INVALID guards');

    // ── Upsert + per-stage listing ──
    stageConfig.saveStageConfig(db, {
        schoolYear: YEAR,
        cycleCode: QUALIFIANT,
        configKey: 'calendar',
        value: { startDate: `${YEAR.slice(0, 4)}-09-05`, holidays: [] }
    });
    assert.strictEqual(
        stageConfig.resolveStageConfig(db, YEAR, QUALIFIANT, 'calendar').value.startDate,
        `${YEAR.slice(0, 4)}-09-05`,
        'saving the same key overwrites (upsert)'
    );
    assert.deepStrictEqual(
        stageConfig.resolveStageConfig(db, YEAR, COLLEGIAL, 'calendar').value,
        collegialCalendar,
        'upserting qualifiant leaves collegial untouched'
    );
    assert.deepStrictEqual(
        stageConfig.listStageConfigs(db, YEAR, QUALIFIANT).map((entry) => entry.configKey),
        ['calendar', 'terms'],
        'listing returns exactly the requested stage keys'
    );
    assert.deepStrictEqual(
        stageConfig.listStageConfigs(db, YEAR, COLLEGIAL).map((entry) => entry.configKey),
        ['calendar'],
        'collegial listing never includes qualifiant keys'
    );
    console.log('  [ok] upsert + per-stage listing');

    // ── education_subjects is never forked ──
    // (comments document the constraint, so the guard scans code only)
    const repoSource = fs
        .readFileSync(path.join(__dirname, '..', 'main', 'repos', 'stage-config.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/.*$/gm, '$1');
    assert.ok(!repoSource.includes('education_subjects'), 'stage-config must never reference the subject catalog');
    assert.ok(!repoSource.includes('cycle_subjects'), 'stage-config must never fork a per-stage subject table');
    assert.ok(!repoSource.includes('capture-port'), 'stage-config stays device-local (no capture)');
    assert.ok(!/require\(['"][^'"]*sync\//.test(repoSource), 'stage-config stays device-local (no sync requires)');
    console.log('  [ok] no subject-catalog fork, no sync surface');

    // ── Per-cycle level catalogs + the forbidden-to-delete `*` compat row ──
    const handlers = new Map();
    const { registerAppDefaultsIpc } = require('../main/ipc/appDefaults');
    registerAppDefaultsIpc({ handle: (channel, handler) => handlers.set(channel, handler) });
    const listLevels = (payload) => handlers.get('appDefaults:listLevels')({}, payload);
    const legacy = await listLevels(undefined);
    assert.strictEqual(legacy.success, true);
    assert.strictEqual(legacy.levels[0].code, '*', 'legacy listLevels keeps the `*` compat row first (row 124)');
    const qualifiantLevels = await listLevels({ cycleCode: QUALIFIANT });
    assert.ok(
        qualifiantLevels.levels.some((level) => level.code === '*'),
        'qualifiant listLevels keeps the `*` compat row (row 124)'
    );
    assert.deepStrictEqual(
        qualifiantLevels.levels.filter((level) => level.code !== '*'),
        QUALIFIANT_LEVELS,
        'qualifiant levels come from the qualifiant SSOT'
    );
    const collegialLevels = await listLevels({ cycleCode: COLLEGIAL });
    assert.deepStrictEqual(collegialLevels.levels, COLLEGIAL_LEVEL_CODES, 'collegial keeps its own level catalog');
    assert.deepStrictEqual(
        (await listLevels({ cycleCode: 'primary' })).levels,
        PRIMARY_LEVEL_CODES,
        'primary keeps its own level catalog'
    );
    assert.strictEqual((await listLevels({ cycleCode: 'nope' })).code, 'UNKNOWN_CYCLE');
    console.log('  [ok] per-cycle level catalogs intact, `*` compat row preserved');

    console.log('stage-config.test.js: OK');
})().catch((error) => {
    console.error('stage-config.test.js: FAILED');
    console.error(error);
    process.exitCode = 1;
});
