'use strict';

/**
 * US-3 upgrade tests (029-stage-rules-management, T023).
 *
 * Covers the official rule-set refresh path:
 *   1. official refresh creates revision max+1 (previous stays as-is, new one active)
 *   2. custom rows copied forward unchanged (values identical, source='custom')
 *   3. official rows never overwrite custom (custom survives for the same key)
 *   4. applyOfficialRuleSet creates zero sync_outbox rows (seed path must not capture)
 *   5. revisionGuard rejects a stale remote PUT (simulated old device)
 *   6. exactly one active rule set per school year after refresh
 *
 * The repository function under test is applyOfficialRuleSet(db, seedData, reason)
 * (main/repos/stage-rules.js, tasks.md T024) — NOT implemented yet, so the
 * upgrade section MUST fail (TDD red). The revisionGuard assertions (T010,
 * already implemented) are expected to pass.
 */

const assert = require('assert');
const { ensureStageRulesSchema, ensureCycleProfilesSchema } = require('../main/db/schema');
const { guardStageRuleRevisionBeforePut } = require('../main/sync/apply-hooks-stage-rules');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');

const SCHOOL_YEAR = '2025/2026';

let stageRulesRepo = null;
try {
    stageRulesRepo = require('../main/repos/stage-rules');
} catch {
    stageRulesRepo = null;
}

function openDb() {
    // Prefer better-sqlite3 (production driver, repos-orientation pattern).
    try {
        const Database = require('better-sqlite3');
        const probe = new Database(':memory:');
        probe.close();
        return new Database(':memory:');
    } catch {
        /* better-sqlite3 may be compiled against another Node ABI — fall back */
    }
    // Fall back to node:sqlite (stage-rules-migration.test.js pattern) so the
    // suite still executes under any Node >= 22.
    try {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(':memory:');
        db.pragma = (statement) => db.prepare(`PRAGMA ${statement}`).all();
        db.transaction = (fn) => fn;
        return db;
    } catch {
        return null;
    }
}

function buildFixture(db) {
    db.exec(`
        CREATE TABLE sync_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT NOT NULL,
            row_sync_id TEXT NOT NULL,
            operation TEXT NOT NULL CHECK(operation IN ('PUT','DEL')),
            row_data TEXT,
            school_year TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            retries INTEGER DEFAULT 0,
            last_attempt_at DATETIME,
            sent_at DATETIME,
            last_error TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    ensureStageRulesSchema(db);
    ensureCycleProfilesSchema(db);
    db.prepare(
        `INSERT INTO cycle_profiles(cycle_code, profile_version, uses_coefficients, assessment_model)
         VALUES (?, ?, ?, ?)`
    )
        .run('primary', 'primary-2026-v1', 0, 'continuous');
    db.prepare(
        `INSERT INTO cycle_profiles(cycle_code, profile_version, uses_coefficients, assessment_model)
         VALUES (?, ?, ?, ?)`
    )
        .run('secondary_qualifiant', 'qualifiant-2026-v1', 1, 'exams');

    db.prepare(
        `INSERT INTO stage_rule_sets(school_year, revision, status, reason) VALUES (?, 1, 'active', ?)`
    ).run(SCHOOL_YEAR, 'official baseline');
    const ruleSetId = db.prepare(`SELECT id FROM stage_rule_sets WHERE school_year = ? AND revision = 1`).get(SCHOOL_YEAR).id;

    const insertCoefficient = db.prepare(
        `INSERT INTO subject_coefficients(
            rule_set_id, cycle_code, level_code, stream_code, subject_code, coefficient, source
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    insertCoefficient.run(ruleSetId, 'secondary_qualifiant', '2BAC', '2BACSMA', 'MATH', 9, 'official');
    insertCoefficient.run(ruleSetId, 'secondary_qualifiant', '2BAC', '2BACSMA', 'FRENCH', 4, 'official');
    insertCoefficient.run(ruleSetId, 'secondary_qualifiant', '2BAC', '2BACSMA', 'MATH', 5, 'custom');
    insertCoefficient.run(ruleSetId, 'secondary_qualifiant', 'TC', 'TCS', 'ARABIC', 2, 'official');

    const insertExamCount = db.prepare(
        `INSERT INTO exam_count_rules(
            rule_set_id, cycle_code, level_code, subject_code, exam_count, source
         ) VALUES (?, ?, ?, ?, ?, ?)`
    );
    insertExamCount.run(ruleSetId, 'secondary_qualifiant', '*', 'MATH', 3, 'official');
    insertExamCount.run(ruleSetId, 'secondary_qualifiant', '*', 'MATH', 2, 'custom');

    return ruleSetId;
}

/**
 * Assumed seedData contract for applyOfficialRuleSet(db, seedData, reason):
 *   { revision, cycleCode, coefficients: [...], examCounts: [...] }
 * Row objects carry the logical rule dims (no rule_set_id — the repo binds the
 * new rule set id itself). source defaults to 'official' semantics.
 */
function buildSeedData(revision) {
    return {
        revision,
        cycleCode: 'secondary_qualifiant',
        coefficients: [
            { cycle_code: 'secondary_qualifiant', level_code: '2BAC', stream_code: '2BACSMA', subject_code: 'MATH', coefficient: 10, source: 'official' },
            { cycle_code: 'secondary_qualifiant', level_code: '2BAC', stream_code: '2BACSMA', subject_code: 'FRENCH', coefficient: 4, source: 'official' },
            { cycle_code: 'secondary_qualifiant', level_code: 'TC', stream_code: 'TCS', subject_code: 'ARABIC', coefficient: 2, source: 'official' },
            { cycle_code: 'secondary_qualifiant', level_code: '2BAC', stream_code: '2BACSP', subject_code: 'PHYSICS_CHEMISTRY', coefficient: 7, source: 'official' }
        ],
        examCounts: [
            { cycle_code: 'secondary_qualifiant', level_code: '*', subject_code: 'MATH', exam_count: 4, source: 'official' },
            { cycle_code: 'secondary_qualifiant', level_code: '2BAC', subject_code: 'FRENCH', exam_count: 4, source: 'official' }
        ]
    };
}

function makeRecordingCapturePort() {
    const base = createNoOpCapturePort();
    const state = { calls: 0 };
    const record = (name) => (...args) => {
        state.calls += 1;
        return base[name](...args);
    };
    return {
        state,
        port: {
            captureInputUpserts: record('captureInputUpserts'),
            captureResolvedRows: record('captureResolvedRows'),
            capturePutsByIds: record('capturePutsByIds'),
            captureDeletesFromRows: record('captureDeletesFromRows'),
            selectRowsBySchoolYear: base.selectRowsBySchoolYear,
            deleteBySchoolYearWithCapture: record('deleteBySchoolYearWithCapture'),
            notifyCaptureCommitted: record('notifyCaptureCommitted')
        }
    };
}

function pick(row, keys) {
    const out = {};
    for (const key of keys) out[key] = row[key];
    return out;
}

function getActiveRuleSet(db, schoolYear) {
    return db.prepare(`SELECT * FROM stage_rule_sets WHERE school_year = ? AND status = 'active'`).get(schoolYear);
}

function getCoefficientRows(db, ruleSetId) {
    return db.prepare(`SELECT * FROM subject_coefficients WHERE rule_set_id = ?`).all(ruleSetId);
}

function getExamCountRows(db, ruleSetId) {
    return db.prepare(`SELECT * FROM exam_count_rules WHERE rule_set_id = ?`).all(ruleSetId);
}

function run() {
    const recording = makeRecordingCapturePort();
    setRepoCapturePort(recording.port);

    const db = openDb();
    if (!db) {
        console.log('stage-rules-upgrade.test.js: SKIPPED (no SQLite driver available)');
        setRepoCapturePort(null);
        return;
    }

    try {
        const ruleSetId = buildFixture(db);

        // ── 5. revisionGuard: a stale remote PUT (old device) must be deferred. ──
        // Local revision is 1. The hook reads item.data (engine contract:
        // beforePut(db, item, ctx)), so items are shaped { data: {...} }.
        const staleItem = { data: { school_year: SCHOOL_YEAR, revision: 1 } };
        assert.deepStrictEqual(
            guardStageRuleRevisionBeforePut(db, staleItem),
            { defer: true },
            'revisionGuard must defer an incoming PUT whose revision <= local revision'
        );
        const freshItem = { data: { school_year: SCHOOL_YEAR, revision: 2 } };
        assert.strictEqual(
            guardStageRuleRevisionBeforePut(db, freshItem),
            null,
            'revisionGuard must let an incoming PUT with a newer revision proceed'
        );
        assert.strictEqual(
            db.prepare(`SELECT status FROM stage_rule_sets WHERE school_year = ? AND revision = 1`).get(SCHOOL_YEAR).status,
            'closed',
            'revisionGuard must close the local active revision before the newer parent is inserted'
        );
        console.log('[stage-rules-upgrade] revisionGuard hook: PASS (T010 already implemented)');

        // ── T024 — the function under test must exist. THIS FAILS TODAY (TDD red). ──
        assert.ok(
            stageRulesRepo && typeof stageRulesRepo.applyOfficialRuleSet === 'function',
            'main/repos/stage-rules.js must export applyOfficialRuleSet(db, seedData, reason) (T024 not implemented yet)'
        );

        // ── 1. official refresh creates revision max+1; previous stays as-is ──
        stageRulesRepo.applyOfficialRuleSet(db, buildSeedData(2), 'official rules upgrade');

        const activeAfter = getActiveRuleSet(db, SCHOOL_YEAR);
        assert.ok(activeAfter, 'official refresh must leave one active rule set');
        assert.strictEqual(activeAfter.revision, 2, 'official refresh must create revision max+1');
        assert.strictEqual(activeAfter.reason, 'official rules upgrade', 'refresh must record the given reason');

        const previousSet = db
            .prepare(`SELECT * FROM stage_rule_sets WHERE school_year = ? AND revision = 1`)
            .get(SCHOOL_YEAR);
        assert.strictEqual(previousSet.status, 'closed', 'previous active rule set must be closed by the refresh');
        const previousOfficialMath = getCoefficientRows(db, ruleSetId).find(
            (row) => row.subject_code === 'MATH' && row.source === 'official'
        );
        assert.strictEqual(previousOfficialMath.coefficient, 9, 'previous revision rows must stay as-is (immutable)');

        // never ≤ max: a second refresh must create revision 3, not reuse 2
        stageRulesRepo.applyOfficialRuleSet(db, buildSeedData(3), 'official rules upgrade again');
        const activeAfterSecond = getActiveRuleSet(db, SCHOOL_YEAR);
        assert.strictEqual(activeAfterSecond.revision, 3, 'second refresh must create revision max+1 (never <= max)');
        const newRuleSetId = activeAfterSecond.id;

        // ── 2. custom rows copied forward unchanged ──
        const previousCustom = getCoefficientRows(db, ruleSetId).find((row) => row.source === 'custom');
        const copiedCustom = getCoefficientRows(db, newRuleSetId).find((row) => row.source === 'custom');
        assert.ok(copiedCustom, 'custom coefficient row must be copied forward');
        assert.deepStrictEqual(
            pick(previousCustom, ['cycle_code', 'level_code', 'stream_code', 'subject_code', 'coefficient', 'source']),
            pick(copiedCustom, ['cycle_code', 'level_code', 'stream_code', 'subject_code', 'coefficient', 'source']),
            'custom coefficient values must be copied forward unchanged'
        );

        const previousCustomExam = getExamCountRows(db, ruleSetId).find((row) => row.source === 'custom');
        const copiedCustomExam = getExamCountRows(db, newRuleSetId).find((row) => row.source === 'custom');
        assert.ok(copiedCustomExam, 'custom exam-count row must be copied forward');
        assert.deepStrictEqual(
            pick(previousCustomExam, ['cycle_code', 'level_code', 'subject_code', 'exam_count', 'source']),
            pick(copiedCustomExam, ['cycle_code', 'level_code', 'subject_code', 'exam_count', 'source']),
            'custom exam-count values must be copied forward unchanged'
        );

        // ── 3. official rows never overwrite custom (coexist per logical key) ──
        const mathRows = getCoefficientRows(db, newRuleSetId).filter((row) => row.subject_code === 'MATH');
        assert.strictEqual(mathRows.length, 2, 'official and custom rows for the same key must coexist after refresh');
        const mathOfficial = mathRows.find((row) => row.source === 'official');
        const mathCustom = mathRows.find((row) => row.source === 'custom');
        assert.strictEqual(mathOfficial.coefficient, 10, 'official row must be refreshed from seed data');
        assert.strictEqual(mathCustom.coefficient, 5, 'official refresh must never overwrite a custom row');

        const physicsRow = getCoefficientRows(db, newRuleSetId).find((row) => row.subject_code === 'PHYSICS_CHEMISTRY');
        assert.ok(physicsRow && physicsRow.stream_code === '2BACSP', 'seed rows absent from the previous revision must be added');
        const mathExamOfficial = getExamCountRows(db, newRuleSetId).find(
            (row) => row.subject_code === 'MATH' && row.source === 'official'
        );
        assert.strictEqual(mathExamOfficial.exam_count, 4, 'official exam counts must be refreshed from seed data');

        // ── 4. seed path must not capture: zero outbox rows, port never called ──
        const outboxCount = db.prepare('SELECT COUNT(*) AS count FROM sync_outbox').get().count;
        assert.strictEqual(outboxCount, 0, 'applyOfficialRuleSet must never write the sync outbox');
        assert.strictEqual(recording.state.calls, 0, 'applyOfficialRuleSet must never call the capture port');

        // ── 6. exactly one active rule set per school year after refresh ──
        const activePerYear = db
            .prepare(`SELECT school_year, COUNT(*) AS count FROM stage_rule_sets WHERE status = 'active' GROUP BY school_year`)
            .all();
        assert.strictEqual(activePerYear.length, 1);
        assert.strictEqual(activePerYear[0].school_year, SCHOOL_YEAR);
        assert.strictEqual(activePerYear[0].count, 1, 'exactly one active rule set per school year after refresh');

        // ── 7. S4 effectivity spine: the seed path re-binds the assignment atomically ──
        const assignment = db
            .prepare(`SELECT * FROM cycle_profile_assignments WHERE school_year = ? AND cycle_code = ?`)
            .get(SCHOOL_YEAR, 'secondary_qualifiant');
        assert.ok(assignment, 'official refresh writes the qualifiant assignment');
        assert.strictEqual(assignment.profile_version, 'qualifiant-2026-v1', 'assignment binds the official profile');
        assert.strictEqual(
            assignment.rule_set_id,
            activeAfterSecond.id,
            'assignment follows the newest seeded revision'
        );
        assert.strictEqual(
            db.prepare(`SELECT COUNT(*) AS count FROM cycle_profile_assignments WHERE cycle_code = 'primary'`).get().count,
            0,
            'the continuous primary profile is never bound by the seed path'
        );
    } finally {
        db.close();
        setRepoCapturePort(null);
    }

    console.log('stage-rules-upgrade.test.js: OK');
}

run();
