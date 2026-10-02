'use strict';

/**
 * S2-4 — primary assessment model + no-coefficient guard proof
 * (docs/plans/2026-08-02-multi-stage-school-architecture.md §3 S2, row 4).
 *
 * The primary cycle is continuous-assessment: its catalog entry carries
 * `assessmentModel: 'continuous'` and it MUST never receive coefficient or
 * exam-count rules. The stage-rules repo enforces this on the write side
 * (`requireQualifiantCycles` in main/repos/stage-rules.js), the 029 resolver
 * contract (specs/029-stage-rules-management/contracts/resolver.md) mandates
 * MISSING_RULE with no silent fallback to constants on the read side, and the
 * seeds never plant primary rows. This suite pins all of that so a regression
 * can never silently re-enable primary coefficients.
 *
 *   a. catalog hint: `assessmentModel: 'continuous'` on primary, absent on qualifiant;
 *   b. write-side guard: saveCoefficients/saveExamCounts/saveAllRules scoped to
 *      'primary' fail with FORBIDDEN; zero rows; no new revision;
 *   c. read-side fail-closed: primary level+subject resolves to nothing
 *      (MISSING_RULE semantics, official export blocked — never a constant);
 *   d. seed invariant: fresh migration boot plants zero primary rows;
 *   e. sanity: qualifiant coefficients/exam counts still resolve.
 */

const assert = require('assert');
const { ensureStageRulesSchema, ensureCycleReferenceSchema, ensureCycleProfilesSchema } = require('../main/db/schema');
const { setDb } = require('../main/db/context');
const { MIGRATIONS } = require('../main/db/migrations');
const { seedSubjectCatalog } = require('../main/db/education-catalogs/subject-catalog');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
const { getCycleDefinition } = require('../js/shared/education/cycles');
const errorContract = require('../js/shared/errors/stage-rules-error-contract');

const PRIMARY = 'primary';
const QUALIFIANT = 'secondary_qualifiant';
const YEAR = '2025/2026';
const ACTOR = { userId: 7, name: 'إدارة المدرسة', email: 'admin@school.local', role: 'admin' };

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
    // Fall back to node:sqlite (stage-rules-migration.test.js pattern).
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

function buildRulesFixture() {
    // Same boot as tests/stage-rules-repo.test.js: cycle-reference schema +
    // canonical stage-rules DDL + cycle profiles (S4) + subject catalog seeds.
    const db = openDb();
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
    `);
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
    seedSubjectCatalog(db);
    return db;
}

function throwsCode(fn, expectedCode) {
    try {
        fn();
    } catch (error) {
        if (error && error.code === expectedCode) return error;
        throw new Error(`expected error code ${expectedCode}, got ${error && error.code} (${error && error.message})`);
    }
    throw new Error(`expected error code ${expectedCode}, but no error was thrown`);
}

function primaryRowCounts(db) {
    return {
        coefficients: db
            .prepare(`SELECT COUNT(*) AS count FROM subject_coefficients WHERE cycle_code = ?`)
            .get(PRIMARY).count,
        examCounts: db
            .prepare(`SELECT COUNT(*) AS count FROM exam_count_rules WHERE cycle_code = ?`)
            .get(PRIMARY).count,
        weights: db
            .prepare(`SELECT COUNT(*) AS count FROM subject_weight_rules WHERE cycle_code = ?`)
            .get(PRIMARY).count
    };
}

const PRIMARY_COEF_ENTRY = { cycleCode: PRIMARY, levelCode: '1AP', streamCode: 'P1', subjectCode: 'ARABIC', coefficient: 2 };
const PRIMARY_EXAM_ENTRY = { cycleCode: PRIMARY, levelCode: '1AP', subjectCode: 'ARABIC', examCount: 2 };
const PRIMARY_WEIGHT_ENTRY = { cycleCode: PRIMARY, subjectCode: 'ARABIC', examWeightBps: 5000, activityWeightBps: 5000 };
const QUALIFIANT_COEF_ENTRY = { cycleCode: QUALIFIANT, levelCode: '2BAC', streamCode: '2BACSMA', subjectCode: 'MATH' };

function run() {
    // ── a. catalog hint: assessmentModel is primary-specific ──
    const primaryDefinition = getCycleDefinition(PRIMARY);
    assert.ok(primaryDefinition, 'primary must be in the cycle catalog');
    assert.strictEqual(
        primaryDefinition.assessmentModel,
        'continuous',
        'primary entry carries assessmentModel continuous'
    );
    const qualifiantDefinition = getCycleDefinition(QUALIFIANT);
    assert.ok(qualifiantDefinition, 'qualifiant must be in the cycle catalog');
    assert.strictEqual(
        qualifiantDefinition.assessmentModel,
        undefined,
        'assessmentModel is primary-specific: the qualifiant entry carries none'
    );
    console.log('  [ok] a. catalog hint: primary assessmentModel=continuous, qualifiant has none');

    // The functions under test must exist.
    assert.ok(
        stageRulesRepo &&
            typeof stageRulesRepo.getActiveRuleSet === 'function' &&
            typeof stageRulesRepo.getRuleSetRows === 'function' &&
            typeof stageRulesRepo.saveCoefficients === 'function' &&
            typeof stageRulesRepo.saveExamCounts === 'function' &&
            typeof stageRulesRepo.saveAllRules === 'function',
        'main/repos/stage-rules.js must export the stage-rules read and save functions'
    );

    const db = buildRulesFixture();
    if (!db) {
        console.log('primary-assessment-model.test.js: SKIPPED (no SQLite driver available)');
        return;
    }
    setRepoCapturePort(createNoOpCapturePort());
    try {
        // ── b. write-side guard: primary scoped saves fail closed ──
        throwsCode(
            () =>
                stageRulesRepo.saveCoefficients(db, {
                    schoolYear: YEAR,
                    entries: [PRIMARY_COEF_ENTRY],
                    reason: 'سبب واجب',
                    actor: ACTOR
                }),
            'FORBIDDEN'
        );
        throwsCode(
            () =>
                stageRulesRepo.saveExamCounts(db, {
                    schoolYear: YEAR,
                    entries: [PRIMARY_EXAM_ENTRY],
                    reason: 'سبب واجب',
                    actor: ACTOR
                }),
            'FORBIDDEN'
        );
        throwsCode(
            () =>
                stageRulesRepo.saveAllRules(db, {
                    schoolYear: YEAR,
                    coefficientEntries: [PRIMARY_COEF_ENTRY],
                    examCountEntries: [PRIMARY_EXAM_ENTRY],
                    weightEntries: [PRIMARY_WEIGHT_ENTRY],
                    reason: 'سبب واجب',
                    actor: ACTOR
                }),
            'FORBIDDEN'
        );

        // Rejected attempts must not create a rule set or any primary rows.
        assert.strictEqual(
            stageRulesRepo.getActiveRuleSet(db, YEAR),
            null,
            'rejected primary writes create no active rule set'
        );
        assert.strictEqual(
            db.prepare(`SELECT COUNT(*) AS count FROM stage_rule_sets WHERE school_year = ?`).get(YEAR).count,
            0,
            'rejected primary writes create no stage_rule_sets row'
        );
        assert.deepStrictEqual(
            primaryRowCounts(db),
            { coefficients: 0, examCounts: 0, weights: 0 },
            'fresh app DB has zero primary rule rows'
        );
        console.log('  [ok] b1. save* scoped to primary → FORBIDDEN, no revision, no rows');

        // ── b2. the guard also holds once a real qualifiant revision exists ──
        const set1 = stageRulesRepo.saveCoefficients(db, {
            schoolYear: YEAR,
            entries: [{ ...QUALIFIANT_COEF_ENTRY, coefficient: 7 }],
            reason: 'رفع معامل الرياضيات للشعبة العلمية',
            actor: ACTOR
        });
        assert.strictEqual(set1.revision, 1, 'qualifiant save still works (revision 1)');

        throwsCode(
            () =>
                stageRulesRepo.saveCoefficients(db, {
                    schoolYear: YEAR,
                    entries: [PRIMARY_COEF_ENTRY],
                    reason: 'سبب واجب',
                    actor: ACTOR
                }),
            'FORBIDDEN'
        );
        throwsCode(
            () =>
                stageRulesRepo.saveExamCounts(db, {
                    schoolYear: YEAR,
                    entries: [PRIMARY_EXAM_ENTRY],
                    reason: 'سبب واجب',
                    actor: ACTOR
                }),
            'FORBIDDEN'
        );
        throwsCode(
            () =>
                stageRulesRepo.saveAllRules(db, {
                    schoolYear: YEAR,
                    coefficientEntries: [PRIMARY_COEF_ENTRY],
                    weightEntries: [PRIMARY_WEIGHT_ENTRY],
                    reason: 'سبب واجب',
                    actor: ACTOR
                }),
            'FORBIDDEN'
        );
        assert.strictEqual(
            stageRulesRepo.getActiveRuleSet(db, YEAR).revision,
            1,
            'rejected primary writes must not bump the active revision'
        );
        assert.strictEqual(
            db.prepare(`SELECT COUNT(*) AS count FROM stage_rule_sets WHERE school_year = ?`).get(YEAR).count,
            1,
            'rejected primary writes create no extra rule set'
        );
        assert.deepStrictEqual(
            primaryRowCounts(db),
            { coefficients: 0, examCounts: 0, weights: 0 },
            'no primary rows after rejected writes next to a qualifiant revision'
        );
        console.log('  [ok] b2. guard holds after a qualifiant revision: revision stays 1, zero primary rows');

        // ── c. read-side fail-closed: MISSING_RULE semantics, never a constant ──
        const rows = stageRulesRepo.getRuleSetRows(db, set1.id);
        assert.strictEqual(
            rows.coefficients.filter((row) => row.cycle_code === PRIMARY).length,
            0,
            'getRuleSetRows returns no primary coefficient rows'
        );
        assert.strictEqual(
            rows.examCounts.filter((row) => row.cycle_code === PRIMARY).length,
            0,
            'getRuleSetRows returns no primary exam-count rows'
        );
        assert.strictEqual(
            rows.weights.filter((row) => row.cycle_code === PRIMARY).length,
            0,
            'getRuleSetRows returns no primary weight rows'
        );
        const primaryCoefficient = rows.coefficients.find(
            (row) => row.cycle_code === PRIMARY && row.level_code === '1AP' && row.subject_code === 'ARABIC'
        );
        assert.strictEqual(
            primaryCoefficient,
            undefined,
            'primary 1AP/ARABIC coefficient resolves to nothing — never a constant'
        );
        const primaryExamCount = rows.examCounts.find(
            (row) => row.cycle_code === PRIMARY && row.level_code === '1AP' && row.subject_code === 'ARABIC'
        );
        assert.strictEqual(
            primaryExamCount,
            undefined,
            'primary 1AP/ARABIC exam count resolves to nothing — never a constant'
        );
        const directCoefficient = db
            .prepare(
                `SELECT * FROM subject_coefficients
                 WHERE cycle_code = ? AND level_code = ? AND subject_code = ?`
            )
            .get(PRIMARY, '1AP', 'ARABIC');
        assert.strictEqual(directCoefficient, undefined, 'direct SQL resolution of a primary coefficient is empty');
        const directExamCount = db
            .prepare(
                `SELECT * FROM exam_count_rules
                 WHERE cycle_code = ? AND level_code = ? AND subject_code = ?`
            )
            .get(PRIMARY, '1AP', 'ARABIC');
        assert.strictEqual(directExamCount, undefined, 'direct SQL resolution of a primary exam count is empty');

        // Resolver contract (029): a missing rule is MISSING_RULE with the official
        // export blocked — there is no silent fallback to constants.
        const incomplete = errorContract.createIncompleteResultMetadata([
            { cycleCode: PRIMARY, levelCode: '1AP', subjectCode: 'ARABIC' }
        ]);
        assert.strictEqual(incomplete.code, errorContract.MISSING_RULE, 'missing primary rule maps to MISSING_RULE');
        assert.strictEqual(incomplete.status, 'incomplete');
        assert.strictEqual(incomplete.officialExportBlocked, true, 'MISSING_RULE blocks official exports');
        const missingResult = { incomplete: true, metadata: incomplete };
        assert.strictEqual(
            errorContract.isOfficialExportAllowed(missingResult),
            false,
            'a result carrying MISSING_RULE metadata is not export-allowed'
        );
        console.log('  [ok] c. read-side fail-closed: primary resolves to MISSING_RULE, export blocked');

        // ── e. sanity: the qualifiant cycle still resolves after the guard ──
        const mathOfficial = rows.coefficients.find(
            (row) =>
                row.cycle_code === QUALIFIANT &&
                row.level_code === '2BAC' &&
                row.stream_code === '2BACSMA' &&
                row.subject_code === 'MATH' &&
                row.source === 'official'
        );
        assert.ok(mathOfficial, 'qualifiant official MATH/2BACSMA coefficient must exist');
        assert.ok(Number(mathOfficial.coefficient) > 0, 'qualifiant coefficient resolves to a positive value');
        const mathExamCount = rows.examCounts.find(
            (row) => row.cycle_code === QUALIFIANT && row.subject_code === 'MATH' && row.source === 'official'
        );
        assert.ok(mathExamCount, 'qualifiant official MATH exam count must exist');
        assert.ok(Number(mathExamCount.exam_count) > 0, 'qualifiant exam count resolves to a positive value');
        console.log('  [ok] e. sanity: qualifiant coefficient/exam count still resolve (> 0)');
    } finally {
        db.close();
        setRepoCapturePort(null);
    }

    // ── d. seed invariant: fresh migration boot plants zero primary rows ──
    {
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
        `);
        db.prepare(`INSERT INTO settings(key, value) VALUES('currentSchoolYear', ?)`).run(YEAR);
        setDb(db);
        const rulesMigration = MIGRATIONS.find((entry) => entry.version === '2026-08-078-stage-rules-management');
        const weightsMigration = MIGRATIONS.find((entry) => entry.version === '2026-08-079-stage-subject-weights');
        assert.ok(rulesMigration && weightsMigration, 'stage-rules migrations must be registered');
        rulesMigration.up();
        weightsMigration.up();

        const ruleSet = db.prepare(`SELECT id FROM stage_rule_sets WHERE status = 'active'`).get();
        assert.ok(ruleSet, 'fresh migration boot creates the active qualifiant rule set');
        assert.strictEqual(
            db.prepare(`SELECT COUNT(*) AS count FROM subject_coefficients WHERE cycle_code = ?`).get(PRIMARY).count,
            0,
            'seed invariant: zero primary coefficient rows after boot'
        );
        assert.strictEqual(
            db.prepare(`SELECT COUNT(*) AS count FROM exam_count_rules WHERE cycle_code = ?`).get(PRIMARY).count,
            0,
            'seed invariant: zero primary exam-count rows after boot'
        );
        assert.strictEqual(
            db.prepare(`SELECT COUNT(*) AS count FROM subject_weight_rules WHERE cycle_code = ?`).get(PRIMARY).count,
            0,
            'seed invariant: zero primary weight rows after boot'
        );
        const seededCycles = db.prepare(`SELECT DISTINCT cycle_code FROM subject_coefficients`).all();
        assert.ok(
            seededCycles.length > 0 && seededCycles.every((row) => row.cycle_code === QUALIFIANT),
            'every seeded coefficient row belongs to the qualifiant cycle only'
        );
        db.close();
        setDb(null);
        console.log('  [ok] d. seed invariant: fresh boot plants zero primary rows (qualifiant only)');
    }

    console.log('primary-assessment-model.test.js: OK');
}

run();
