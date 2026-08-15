'use strict';

/**
 * US-1 repo tests (029-stage-rules-management, T013).
 *
 * Covers main/repos/stage-rules.js:
 *   1. save creates new revision (max+1); previous active becomes closed
 *   2. official rows are never written by the user path (only custom)
 *   3. custom beats official within a key (same-key custom upsert; official row
 *      is shadowed, never touched)
 *   4. writes targeting a closed/non-active version are rejected
 *      (INVALID_RULE_VERSION)
 *   5. primary cycle (cycle_profiles.uses_coefficients = false) writes blocked
 *   6. reason required (REASON_REQUIRED)
 *   7. exactly one active version per school year
 *   8. one STAGE_RULE_OVERRIDE audit row per save (actor, reason, revision,
 *      changed keys) + explicit capture via the capture port
 *
 * Repository functions under test (tasks.md T014) are NOT implemented yet, so
 * this file MUST fail (TDD red) until main/repos/stage-rules.js lands.
 */

const assert = require('assert');
const { ensureStageRulesSchema, ensureCycleReferenceSchema, ensureCycleProfilesSchema } = require('../main/db/schema');
const { seedSubjectCatalog, mapSubjectToCode } = require('../main/db/education-catalogs/subject-catalog');
const { getOfficialCoefficientRows } = require('../main/db/education-catalogs/qualifiant-coefficients');
const { DEFAULT_EXAM_COUNTS } = require('../main/db/exam-count-defaults');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');

const YEAR_A = '2025/2026';
const YEAR_B = '2026/2027';
const ACTOR = { userId: 7, name: 'إدارة المدرسة', email: 'admin@school.local', role: 'admin' };

const OFFICIAL_SEED_COUNT = getOfficialCoefficientRows({ ruleSetId: 1, cycleCode: 'secondary_qualifiant' }).length;
const DEFAULT_EXAM_COUNT = new Set(DEFAULT_EXAM_COUNTS.map(([subject]) => mapSubjectToCode(subject)).filter(Boolean)).size;

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
    // S4 official stage profiles (canonical shape — migration 2026-08-082 seeds).
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
}

function makeRecordingCapturePort() {
    const base = createNoOpCapturePort();
    const state = { captureResolvedRows: 0, notifyCaptureCommitted: 0, byTable: {} };
    const record = (name) => (...args) => {
        state[name] += 1;
        return base[name](...args);
    };
    const recordResolved = (name) => (db, table, rows, op) => {
        state[name] += 1;
        state.byTable[table] = (state.byTable[table] || 0) + 1;
        return base[name](db, table, rows, op);
    };
    return {
        state,
        port: {
            captureInputUpserts: record('captureInputUpserts'),
            captureResolvedRows: recordResolved('captureResolvedRows'),
            capturePutsByIds: record('capturePutsByIds'),
            captureDeletesFromRows: record('captureDeletesFromRows'),
            selectRowsBySchoolYear: base.selectRowsBySchoolYear,
            deleteBySchoolYearWithCapture: record('deleteBySchoolYearWithCapture'),
            notifyCaptureCommitted: record('notifyCaptureCommitted')
        }
    };
}

function coefficientRows(db, ruleSetId) {
    return db.prepare(`SELECT * FROM subject_coefficients WHERE rule_set_id = ?`).all(ruleSetId);
}

function examCountRows(db, ruleSetId) {
    return db.prepare(`SELECT * FROM exam_count_rules WHERE rule_set_id = ?`).all(ruleSetId);
}

function customCoefficients(db, ruleSetId) {
    return coefficientRows(db, ruleSetId).filter((row) => row.source === 'custom');
}

function officialCount(db, ruleSetId) {
    return coefficientRows(db, ruleSetId).filter((row) => row.source === 'official').length;
}

function customExamCounts(db, ruleSetId) {
    return examCountRows(db, ruleSetId).filter((row) => row.source === 'custom');
}

function findRow(rows, predicate) {
    return rows.find(predicate) || null;
}

function activeCount(db, schoolYear) {
    return db
        .prepare(`SELECT COUNT(*) AS count FROM stage_rule_sets WHERE school_year = ? AND status = 'active'`)
        .get(schoolYear).count;
}

function auditRows(db) {
    return db.prepare(`SELECT * FROM system_logs WHERE action = 'STAGE_RULE_OVERRIDE' ORDER BY id`).all();
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

const COEF_ENTRY = { cycleCode: 'secondary_qualifiant', levelCode: '2BAC', streamCode: '2BACSMA', subjectCode: 'MATH' };

function run() {
    const recording = makeRecordingCapturePort();
    setRepoCapturePort(recording.port);

    const db = openDb();
    if (!db) {
        console.log('stage-rules-repo.test.js: SKIPPED (no SQLite driver available)');
        setRepoCapturePort(null);
        return;
    }

    try {
        buildFixture(db);

        // ── 0. the functions under test must exist (TDD red until T014 lands) ──
        assert.ok(
            stageRulesRepo &&
                typeof stageRulesRepo.getActiveRuleSet === 'function' &&
                typeof stageRulesRepo.getRuleSetRows === 'function' &&
                typeof stageRulesRepo.saveCoefficients === 'function' &&
                typeof stageRulesRepo.saveExamCounts === 'function' &&
                typeof stageRulesRepo.saveAllRules === 'function',
            'main/repos/stage-rules.js must export the stage-rules read and save functions'
        );

        // ── 1. no active version yet ──
        assert.strictEqual(stageRulesRepo.getActiveRuleSet(db, YEAR_A), null, 'fresh year has no active rule set');
        assert.strictEqual(activeCount(db, YEAR_A), 0);

        // ── 2. first save creates revision 1, active, seeded official + default exam counts ──
        const setA1 = stageRulesRepo.saveCoefficients(db, {
            schoolYear: YEAR_A,
            entries: [{ ...COEF_ENTRY, coefficient: 7 }],
            reason: 'رفع معامل الرياضيات للشعبة العلمية',
            actor: ACTOR
        });
        assert.strictEqual(setA1.revision, 1, 'first save creates revision 1');
        assert.strictEqual(setA1.status, 'active');
        assert.strictEqual(setA1.school_year, YEAR_A);
        assert.strictEqual(setA1.created_by, ACTOR.name);
        assert.strictEqual(setA1.reason, 'رفع معامل الرياضيات للشعبة العلمية');
        assert.strictEqual(getActiveRuleSetById(db, YEAR_A), setA1.id, 'saved set is the active one');
        assert.strictEqual(activeCount(db, YEAR_A), 1, 'exactly one active version per school year');

        assert.strictEqual(
            coefficientRows(db, setA1.id).length,
            OFFICIAL_SEED_COUNT + 1,
            'first revision seeds official rows plus the custom entry'
        );
        assert.strictEqual(
            examCountRows(db, setA1.id).length,
            DEFAULT_EXAM_COUNT,
            'first revision seeds default exam counts'
        );
        const customMathA1 = findRow(
            customCoefficients(db, setA1.id),
            (row) => row.subject_code === 'MATH' && row.stream_code === '2BACSMA'
        );
        assert.strictEqual(customMathA1.coefficient, 7, 'custom row written for the entry key');
        const officialMathA1 = findRow(
            coefficientRows(db, setA1.id),
            (row) => row.subject_code === 'MATH' && row.stream_code === '2BACSMA' && row.source === 'official'
        );
        assert.strictEqual(officialMathA1.coefficient, 9, 'official seed row present alongside the custom row');

        // ── 3. second save: revision 2 (max+1); revision 1 becomes closed; same-key custom upsert ──
        const setA2 = stageRulesRepo.saveCoefficients(db, {
            schoolYear: YEAR_A,
            entries: [{ ...COEF_ENTRY, coefficient: 8 }],
            reason: 'تعديل المعامل مرة أخرى',
            actor: ACTOR
        });
        assert.strictEqual(setA2.revision, 2, 'save creates revision max+1');
        assert.strictEqual(setA2.status, 'active');
        assert.strictEqual(getActiveRuleSetById(db, YEAR_A), setA2.id);
        const setA1After = db
            .prepare(`SELECT * FROM stage_rule_sets WHERE school_year = ? AND revision = 1`)
            .get(YEAR_A);
        assert.strictEqual(setA1After.status, 'closed', 'previous active version becomes closed');
        assert.strictEqual(activeCount(db, YEAR_A), 1, 'still exactly one active version');

        const customMathA2 = customCoefficients(db, setA2.id).filter(
            (row) => row.subject_code === 'MATH' && row.stream_code === '2BACSMA'
        );
        assert.strictEqual(customMathA2.length, 1, 'same-key custom row is upserted, not duplicated');
        assert.strictEqual(customMathA2[0].coefficient, 8, 'custom value updated in place');
        assert.strictEqual(officialCount(db, setA2.id), OFFICIAL_SEED_COUNT, 'official rows copied forward unchanged');
        const officialMathA2 = findRow(
            coefficientRows(db, setA2.id),
            (row) => row.subject_code === 'MATH' && row.stream_code === '2BACSMA' && row.source === 'official'
        );
        assert.strictEqual(officialMathA2.coefficient, 9, 'official row shadowed, never touched');
        assert.strictEqual(
            customCoefficients(db, setA2.id).length,
            1,
            'only the user entry key produces a custom row'
        );

        // ── 4. third save: new key custom row; official never written by the user path ──
        const setA3 = stageRulesRepo.saveCoefficients(db, {
            schoolYear: YEAR_A,
            entries: [{ ...COEF_ENTRY, streamCode: '2BACSP', coefficient: 6 }],
            reason: 'معامل الرياضيات للشعبة الفيزيائية',
            actor: ACTOR
        });
        assert.strictEqual(setA3.revision, 3);
        assert.strictEqual(customCoefficients(db, setA3.id).length, 2, 'previous custom carried + new custom');
        const customPhysics = findRow(
            customCoefficients(db, setA3.id),
            (row) => row.subject_code === 'MATH' && row.stream_code === '2BACSP'
        );
        assert.strictEqual(customPhysics.coefficient, 6);
        const officialPhysics = findRow(
            coefficientRows(db, setA3.id),
            (row) => row.subject_code === 'MATH' && row.stream_code === '2BACSP' && row.source === 'official'
        );
        assert.strictEqual(officialPhysics.coefficient, 7, 'official row for the new key untouched');
        assert.strictEqual(officialCount(db, setA3.id), OFFICIAL_SEED_COUNT, 'no official row ever added by saves');

        // ── 5. saveExamCounts: same version-copy semantics ──
        const setA4 = stageRulesRepo.saveExamCounts(db, {
            schoolYear: YEAR_A,
            entries: [{ cycleCode: 'secondary_qualifiant', levelCode: '2BAC', subjectCode: 'MATH', examCount: 4 }],
            reason: 'تعديل عدد فروض الرياضيات',
            actor: ACTOR
        });
        assert.strictEqual(setA4.revision, 4);
        assert.strictEqual(activeCount(db, YEAR_A), 1);
        assert.strictEqual(examCountRows(db, setA4.id).length, DEFAULT_EXAM_COUNT + 1, 'exam counts copied + custom');
        const customExam = findRow(
            customExamCounts(db, setA4.id),
            (row) => row.subject_code === 'MATH' && row.level_code === '2BAC'
        );
        assert.strictEqual(customExam.exam_count, 4);
        const officialExam = findRow(
            examCountRows(db, setA4.id),
            (row) => row.subject_code === 'MATH' && row.level_code === '*' && row.source === 'official'
        );
        assert.strictEqual(officialExam.exam_count, 3, 'official wildcard exam count untouched');

        const setA5 = stageRulesRepo.saveExamCounts(db, {
            schoolYear: YEAR_A,
            entries: [{ cycleCode: 'secondary_qualifiant', levelCode: '2BAC', subjectCode: 'MATH', examCount: 5 }],
            reason: 'زيادة عدد فروض الرياضيات',
            actor: ACTOR
        });
        assert.strictEqual(setA5.revision, 5);
        const customExamAfter = customExamCounts(db, setA5.id).filter(
            (row) => row.subject_code === 'MATH' && row.level_code === '2BAC'
        );
        assert.strictEqual(customExamAfter.length, 1, 'same-key custom exam count upserted');
        assert.strictEqual(customExamAfter[0].exam_count, 5);
        assert.strictEqual(
            coefficientRows(db, setA5.id).length,
            OFFICIAL_SEED_COUNT + 2,
            'coefficients carried forward unchanged'
        );

        // ── 6. first save on a new year seeds official rows too (exam-count first) ──
        const setB1 = stageRulesRepo.saveExamCounts(db, {
            schoolYear: YEAR_B,
            entries: [{ cycleCode: 'secondary_qualifiant', levelCode: '2BAC', subjectCode: 'FRENCH', examCount: 2 }],
            reason: 'نسخة أولى للسنة الجديدة',
            actor: ACTOR
        });
        assert.strictEqual(setB1.revision, 1);
        assert.strictEqual(getActiveRuleSetById(db, YEAR_B), setB1.id);
        assert.strictEqual(activeCount(db, YEAR_B), 1);
        assert.strictEqual(
            coefficientRows(db, setB1.id).length,
            OFFICIAL_SEED_COUNT,
            'first revision seeds official coefficients even when started with exam counts'
        );
        assert.strictEqual(examCountRows(db, setB1.id).length, DEFAULT_EXAM_COUNT + 1);

        // ── 7. validation errors (no revision created, no audit written) ──
        const auditBeforeErrors = auditRows(db).length;
        throwsCode(
            () =>
                stageRulesRepo.saveCoefficients(db, {
                    schoolYear: YEAR_A,
                    entries: [{ ...COEF_ENTRY, coefficient: 7 }],
                    reason: '   ',
                    actor: ACTOR
                }),
            'REASON_REQUIRED'
        );
        throwsCode(
            () =>
                stageRulesRepo.saveCoefficients(db, {
                    schoolYear: YEAR_A,
                    entries: [{ ...COEF_ENTRY, coefficient: 0 }],
                    reason: 'cause',
                    actor: ACTOR
                }),
            'COEFFICIENT_OUT_OF_RANGE'
        );
        throwsCode(
            () =>
                stageRulesRepo.saveCoefficients(db, {
                    schoolYear: YEAR_A,
                    entries: [{ cycleCode: 'secondary_qualifiant', levelCode: '2BAC', streamCode: '2BACSMA', coefficient: 5 }],
                    reason: 'cause',
                    actor: ACTOR
                }),
            'RULES_INPUT_INVALID'
        );
        throwsCode(
            () =>
                stageRulesRepo.saveExamCounts(db, {
                    schoolYear: YEAR_A,
                    entries: [{ cycleCode: 'secondary_qualifiant', levelCode: '2BAC', subjectCode: 'MATH', examCount: 13 }],
                    reason: 'cause',
                    actor: ACTOR
                }),
            'EXAM_COUNT_OUT_OF_RANGE'
        );
        assert.strictEqual(activeCount(db, YEAR_A), 1, 'failed saves create no revision');
        assert.strictEqual(auditRows(db).length, auditBeforeErrors, 'failed saves write no audit row');

        // ── 8. primary cycle (uses_coefficients = false) blocks writes ──
        throwsCode(
            () =>
                stageRulesRepo.saveCoefficients(db, {
                    schoolYear: YEAR_A,
                    entries: [{ cycleCode: 'primary', levelCode: '1', streamCode: 'P1', subjectCode: 'ARABIC', coefficient: 2 }],
                    reason: 'cause',
                    actor: ACTOR
                }),
            'FORBIDDEN'
        );
        throwsCode(
            () =>
                stageRulesRepo.saveExamCounts(db, {
                    schoolYear: YEAR_A,
                    entries: [{ cycleCode: 'primary', levelCode: '1', subjectCode: 'ARABIC', examCount: 2 }],
                    reason: 'cause',
                    actor: ACTOR
                }),
            'FORBIDDEN'
        );

        // ── 9. closed/non-active version rejects writes (INVALID_RULE_VERSION) ──
        db.prepare(`UPDATE stage_rule_sets SET status = 'closed' WHERE school_year = ? AND status = 'active'`).run(YEAR_A);
        assert.strictEqual(activeCount(db, YEAR_A), 0);
        throwsCode(
            () =>
                stageRulesRepo.saveCoefficients(db, {
                    schoolYear: YEAR_A,
                    entries: [{ ...COEF_ENTRY, coefficient: 7 }],
                    reason: 'cause',
                    actor: ACTOR
                }),
            'INVALID_RULE_VERSION'
        );
        throwsCode(
            () =>
                stageRulesRepo.saveExamCounts(db, {
                    schoolYear: YEAR_A,
                    entries: [{ cycleCode: 'secondary_qualifiant', levelCode: '2BAC', subjectCode: 'MATH', examCount: 2 }],
                    reason: 'cause',
                    actor: ACTOR
                }),
            'INVALID_RULE_VERSION'
        );
        const maxRevisionA = db
            .prepare(`SELECT MAX(revision) AS max FROM stage_rule_sets WHERE school_year = ?`)
            .get(YEAR_A).max;
        assert.strictEqual(maxRevisionA, 5, 'rejected saves must not bump the revision');
        assert.strictEqual(auditRows(db).length, auditBeforeErrors, 'rejected saves write no audit row');

        // ── 10. getRuleSetRows returns both tables for a set ──
        const rowsA5 = stageRulesRepo.getRuleSetRows(db, setA5.id);
        assert.strictEqual(rowsA5.coefficients.length, OFFICIAL_SEED_COUNT + 2);
        assert.strictEqual(rowsA5.examCounts.length, DEFAULT_EXAM_COUNT + 1);
        const carriedCustom = findRow(
            rowsA5.coefficients,
            (row) => row.subject_code === 'MATH' && row.stream_code === '2BACSMA' && row.source === 'custom'
        );
        assert.strictEqual(carriedCustom.coefficient, 8, 'custom value carried to the latest revision');
        const carriedExam = findRow(
            rowsA5.examCounts,
            (row) => row.subject_code === 'MATH' && row.level_code === '2BAC' && row.source === 'custom'
        );
        assert.strictEqual(carriedExam.exam_count, 5);

        // ── 11. one STAGE_RULE_OVERRIDE audit row per save ──
        const audit = auditRows(db);
        assert.strictEqual(audit.length, 6, 'one audit row per successful save (5 + 1)');
        const auditRev1 = audit.find((row) => row.entity_id === String(setA1.id));
        assert.ok(auditRev1, 'audit row references the new rule set');
        assert.strictEqual(auditRev1.entity_type, 'stage_rule_set');
        const detailsRev1 = JSON.parse(auditRev1.details);
        assert.deepStrictEqual(
            detailsRev1.actor,
            { userId: 7, name: 'إدارة المدرسة', email: 'admin@school.local', role: 'admin' },
            'audit records the actor'
        );
        assert.strictEqual(detailsRev1.reason, 'رفع معامل الرياضيات للشعبة العلمية', 'audit records the reason');
        assert.strictEqual(detailsRev1.revision, 1, 'audit records the revision');
        assert.strictEqual(detailsRev1.kind, 'coefficients');
        assert.deepStrictEqual(
            detailsRev1.changedKeys,
            [{ cycleCode: 'secondary_qualifiant', levelCode: '2BAC', streamCode: '2BACSMA', subjectCode: 'MATH', coefficient: 7, before: null }],
            'audit records the changed keys with before/after values'
        );
        const detailsRev2 = JSON.parse(audit.find((row) => row.entity_id === String(setA2.id)).details);
        assert.strictEqual(detailsRev2.changedKeys[0].before, 7, 'upsert records the previous custom value');
        const detailsRev4 = JSON.parse(audit.find((row) => row.entity_id === String(setA4.id)).details);
        assert.strictEqual(detailsRev4.kind, 'examCounts');
        assert.deepStrictEqual(
            detailsRev4.changedKeys,
            [{ cycleCode: 'secondary_qualifiant', levelCode: '2BAC', subjectCode: 'MATH', examCount: 4, before: null }]
        );
        const detailsRev6 = JSON.parse(audit.find((row) => row.entity_id === String(setB1.id)).details);
        assert.strictEqual(detailsRev6.schoolYear, YEAR_B, 'audit records the school year');

        // ── 12. explicit capture runs inside the transaction for every save ──
        assert.strictEqual(recording.state.byTable['stage_rule_sets'], 6, 'rule set captured on every save');
        assert.strictEqual(recording.state.byTable['subject_coefficients'], 6, 'coefficient rows captured on every save');
        assert.strictEqual(recording.state.byTable['exam_count_rules'], 6, 'exam-count rows captured on every save');
        assert.strictEqual(recording.state.notifyCaptureCommitted, 6, 'push notified after each committed save');

        // ── 12a. S4 effectivity spine: every save atomically re-binds the assignment ──
        assert.strictEqual(
            recording.state.byTable['cycle_profile_assignments'],
            6,
            'the effectivity assignment is captured on every save'
        );
        const assignmentA = db
            .prepare(`SELECT * FROM cycle_profile_assignments WHERE school_year = ? AND cycle_code = ?`)
            .get(YEAR_A, 'secondary_qualifiant');
        assert.ok(assignmentA, 'year A has an active assignment for the qualifiant cycle');
        assert.strictEqual(assignmentA.profile_version, 'qualifiant-2026-v1', 'assignment binds the qualifiant profile');
        assert.strictEqual(assignmentA.rule_set_id, setA5.id, 'assignment follows the newest revision');
        const assignmentB = db
            .prepare(`SELECT * FROM cycle_profile_assignments WHERE school_year = ? AND cycle_code = ?`)
            .get(YEAR_B, 'secondary_qualifiant');
        assert.strictEqual(assignmentB.rule_set_id, setB1.id, 'year B assignment follows its own revision');
        assert.strictEqual(
            db.prepare(`SELECT COUNT(*) AS count FROM cycle_profile_assignments WHERE cycle_code = 'primary'`).get().count,
            0,
            'the continuous primary profile is never bound to a rule set'
        );
        throwsCode(
            () => stageRulesRepo.getActiveRuleSetForCycle(db, YEAR_A, 'secondary_qualifiant'),
            'RULES_UNAVAILABLE',
            'a closed assigned rule set is not active'
        );
        db.prepare(`UPDATE stage_rule_sets SET status = 'active' WHERE id = ?`).run(setA5.id);
        assert.deepStrictEqual(
            stageRulesRepo.getActiveRuleSetForCycle(db, YEAR_A, 'secondary_qualifiant'),
            db.prepare(`SELECT * FROM stage_rule_sets WHERE id = ?`).get(setA5.id),
            'the runtime resolver reads the assignment, not status alone'
        );
        db.prepare(`UPDATE stage_rule_sets SET status = 'closed' WHERE id = ?`).run(setA5.id);
        throwsCode(
            () => stageRulesRepo.getActiveRuleSetForCycle(db, YEAR_A, 'primary'),
            'RULES_UNAVAILABLE',
            'a continuous cycle has no rule set to resolve'
        );

        // ── 12b. combined save creates one atomic revision for all rule types ──
        const setC1 = stageRulesRepo.saveAllRules(db, {
            schoolYear: '2027/2028',
            coefficientEntries: [{ ...COEF_ENTRY, coefficient: 6 }],
            examCountEntries: [{ cycleCode: 'secondary_qualifiant', levelCode: '2BAC', subjectCode: 'MATH', examCount: 4 }],
            weightEntries: [{ cycleCode: 'secondary_qualifiant', subjectCode: 'MATH', examWeightBps: 5000, activityWeightBps: 5000 }],
            reason: 'تعديل شامل لقواعد الرياضيات',
            actor: ACTOR
        });
        assert.strictEqual(setC1.revision, 1);
        const combinedRows = stageRulesRepo.getRuleSetRows(db, setC1.id);
        assert.strictEqual(
            combinedRows.coefficients.find((row) => row.source === 'custom' && row.subject_code === 'MATH').coefficient,
            6
        );
        assert.strictEqual(
            combinedRows.examCounts.find((row) => row.source === 'custom' && row.subject_code === 'MATH').exam_count,
            4
        );
        const combinedWeight = combinedRows.weights.find((row) => row.source === 'custom' && row.subject_code === 'MATH');
        assert.strictEqual(combinedWeight.exam_weight_bps, 5000);
        assert.strictEqual(combinedWeight.activity_weight_bps, 5000);
        assert.strictEqual(
            db.prepare(`SELECT COUNT(*) AS count FROM stage_rule_sets WHERE school_year = '2027/2028'`).get().count,
            1
        );
        const setC2 = stageRulesRepo.resetToOfficial(db, {
            schoolYear: '2027/2028',
            scope: 'row',
            keys: [{ cycleCode: 'secondary_qualifiant', ruleType: 'weight', subjectCode: 'MATH' }],
            reason: 'استعادة أوزان الرياضيات الرسمية',
            actor: ACTOR
        });
        const restoredWeight = stageRulesRepo
            .getRuleSetRows(db, setC2.id)
            .weights.find((row) => row.subject_code === 'MATH' && row.source === 'official');
        assert.strictEqual(restoredWeight.exam_weight_bps, 10000);
        assert.strictEqual(
            stageRulesRepo.getRuleSetRows(db, setC2.id).weights.filter((row) => row.source === 'custom').length,
            0
        );

        // ════ US-4 resetToOfficial (T027) ════
        // State: YEAR_B active revision 1 (setB1) with one custom exam count
        // (FRENCH 2BAC). Add custom coefficient rows so resets have something to remove.

        // ── 13. row reset removes ONLY the target custom row (official stays) ──
        const setB2 = stageRulesRepo.saveCoefficients(db, {
            schoolYear: YEAR_B,
            entries: [
                { ...COEF_ENTRY, coefficient: 7 },
                { ...COEF_ENTRY, streamCode: '2BACSP', coefficient: 6 }
            ],
            reason: 'تجاوزات مؤقتة قبل الاستعادة',
            actor: ACTOR
        });
        assert.strictEqual(setB2.revision, 2, 'save before reset creates revision max+1');
        assert.strictEqual(customCoefficients(db, setB2.id).length, 2, 'two custom coefficient rows ready for reset');
        const auditBeforeReset = auditRows(db).length;
        const capturedBeforeReset = { ...recording.state.byTable };
        const notifyBeforeReset = recording.state.notifyCaptureCommitted;

        const setB3 = stageRulesRepo.resetToOfficial(db, {
            schoolYear: YEAR_B,
            scope: 'row',
            keys: [{ ...COEF_ENTRY }],
            reason: 'استعادة معامل الرياضيات الرسمي',
            actor: ACTOR
        });
        assert.strictEqual(setB3.revision, 3, 'row reset creates revision max+1');
        assert.strictEqual(setB3.status, 'active');
        assert.strictEqual(getActiveRuleSetById(db, YEAR_B), setB3.id);
        assert.strictEqual(activeCount(db, YEAR_B), 1, 'still exactly one active version');
        const prevB2 = db.prepare(`SELECT * FROM stage_rule_sets WHERE school_year = ? AND revision = 2`).get(YEAR_B);
        assert.strictEqual(prevB2.status, 'closed', 'previous active version closed by the reset');

        const mathSma = coefficientRows(db, setB3.id).filter(
            (row) => row.subject_code === 'MATH' && row.stream_code === '2BACSMA'
        );
        assert.strictEqual(mathSma.length, 1, 'only one row remains for the reset key');
        assert.strictEqual(mathSma[0].source, 'official', 'official row for the reset key remains');
        const mathSpCustom = customCoefficients(db, setB3.id).filter(
            (row) => row.subject_code === 'MATH' && row.stream_code === '2BACSP'
        );
        assert.strictEqual(mathSpCustom.length, 1, 'custom rows for other keys survive the row reset');
        assert.strictEqual(mathSpCustom[0].coefficient, 6, 'surviving custom value unchanged');
        const customExamSurvives = customExamCounts(db, setB3.id).length;
        assert.strictEqual(customExamSurvives, 1, 'custom exam counts survive the row reset');

        // ── 14b. row reset removes an exam-count override without touching coefficients ──
        const setBExamReset = stageRulesRepo.resetToOfficial(db, {
            schoolYear: YEAR_B,
            scope: 'row',
            keys: [{ cycleCode: 'secondary_qualifiant', levelCode: '2BAC', streamCode: '*', subjectCode: 'FRENCH' }],
            reason: 'استعادة عدد فروض الفرنسية الرسمي',
            actor: ACTOR
        });
        assert.strictEqual(setBExamReset.revision, 4, 'exam-count row reset creates revision max+1');
        assert.strictEqual(customExamCounts(db, setBExamReset.id).length, 0, 'exam-count row reset removes the target override');
        assert.strictEqual(customCoefficients(db, setBExamReset.id).length, 1, 'exam-count row reset preserves coefficient overrides');
        db.prepare(
            `INSERT INTO exam_count_rules(
                rule_set_id, cycle_code, level_code, subject_code, exam_count, source
             ) VALUES(?, 'secondary_qualifiant', '2BAC', 'FRENCH', 6, 'custom')`
        ).run(setBExamReset.id);

        // ── 14. row reset of a missing custom key → MISSING_RULE, no revision ──
        throwsCode(
            () =>
                stageRulesRepo.resetToOfficial(db, {
                    schoolYear: YEAR_B,
                    scope: 'row',
                    keys: [{ ...COEF_ENTRY, levelCode: '1BAC' }],
                    reason: 'cause',
                    actor: ACTOR
                }),
            'MISSING_RULE'
        );
        assert.strictEqual(
            db.prepare(`SELECT MAX(revision) AS max FROM stage_rule_sets WHERE school_year = ?`).get(YEAR_B).max,
            4,
            'failed row reset creates no revision'
        );

        // ── 15. bulk reset without confirm → CONFIRM_REQUIRED, no revision ──
        const auditBeforeBulk = auditRows(db).length;
        throwsCode(
            () =>
                stageRulesRepo.resetToOfficial(db, {
                    schoolYear: YEAR_B,
                    scope: 'bulk',
                    reason: 'cause',
                    actor: ACTOR
                }),
            'CONFIRM_REQUIRED'
        );
        assert.strictEqual(
            db.prepare(`SELECT MAX(revision) AS max FROM stage_rule_sets WHERE school_year = ?`).get(YEAR_B).max,
            4,
            'rejected bulk reset creates no revision'
        );
        assert.strictEqual(auditRows(db).length, auditBeforeBulk, 'rejected bulk reset writes no audit row');

        // ── 16. bulk reset with confirm removes ALL custom rows (both tables) ──
        const setB4 = stageRulesRepo.resetToOfficial(db, {
            schoolYear: YEAR_B,
            scope: 'bulk',
            confirm: true,
            reason: 'استعادة كل القيم الرسمية للسنة',
            actor: ACTOR
        });
        assert.strictEqual(setB4.revision, 5, 'bulk reset creates revision max+1');
        assert.strictEqual(activeCount(db, YEAR_B), 1, 'still exactly one active version');
        assert.strictEqual(customCoefficients(db, setB4.id).length, 0, 'bulk reset removes every custom coefficient');
        assert.strictEqual(customExamCounts(db, setB4.id).length, 0, 'bulk reset removes every custom exam count');
        assert.strictEqual(officialCount(db, setB4.id), OFFICIAL_SEED_COUNT, 'all official coefficient rows survive the bulk reset');
        assert.strictEqual(
            examCountRows(db, setB4.id).length,
            DEFAULT_EXAM_COUNT,
            'official exam counts survive the bulk reset'
        );

        // ── 17. every reset captures explicitly (one PUT set per reset) ──
        assert.strictEqual(
            recording.state.byTable['stage_rule_sets'],
            (capturedBeforeReset['stage_rule_sets'] || 0) + 3,
            'rule set captured for coefficient row + exam-count row + bulk resets'
        );
        assert.strictEqual(
            recording.state.byTable['subject_coefficients'],
            (capturedBeforeReset['subject_coefficients'] || 0) + 3,
            'coefficient rows captured for coefficient row + exam-count row + bulk resets'
        );
        assert.strictEqual(
            recording.state.byTable['exam_count_rules'],
            (capturedBeforeReset['exam_count_rules'] || 0) + 3,
            'exam-count rows captured for coefficient row + exam-count row + bulk resets'
        );
        assert.strictEqual(
            recording.state.notifyCaptureCommitted,
            notifyBeforeReset + 3,
            'push notified after each committed reset'
        );

        // ── 18. reset on a year with no active version → INVALID_RULE_VERSION; no sets at all → RULES_UNAVAILABLE ──
        throwsCode(
            () =>
                stageRulesRepo.resetToOfficial(db, {
                    schoolYear: YEAR_A,
                    scope: 'bulk',
                    confirm: true,
                    reason: 'cause',
                    actor: ACTOR
                }),
            'INVALID_RULE_VERSION'
        );
        throwsCode(
            () =>
                stageRulesRepo.resetToOfficial(db, {
                    schoolYear: '2099/2100',
                    scope: 'bulk',
                    confirm: true,
                    reason: 'cause',
                    actor: ACTOR
                }),
            'RULES_UNAVAILABLE'
        );

        // ════ US-5 audit trail (T030) ════

        // ── 19. reset audits: STAGE_RULE_OVERRIDE rows carry actor, reason, before/after, revision ──
        const auditB3 = auditRows(db).find((row) => row.entity_id === String(setB3.id));
        assert.ok(auditB3, 'row reset writes one STAGE_RULE_OVERRIDE audit row');
        assert.strictEqual(auditB3.entity_type, 'stage_rule_set');
        const detailsB3 = JSON.parse(auditB3.details);
        assert.strictEqual(detailsB3.kind, 'resetRow');
        assert.strictEqual(detailsB3.revision, 3, 'reset audit records the revision');
        assert.strictEqual(detailsB3.reason, 'استعادة معامل الرياضيات الرسمي', 'reset audit records the reason');
        assert.deepStrictEqual(
            detailsB3.actor,
            { userId: 7, name: 'إدارة المدرسة', email: 'admin@school.local', role: 'admin' },
            'reset audit records the actor'
        );
        assert.deepStrictEqual(
            detailsB3.removedKeys,
            [
                {
                    table: 'coefficients',
                    cycleCode: 'secondary_qualifiant',
                    levelCode: '2BAC',
                    streamCode: '2BACSMA',
                    subjectCode: 'MATH',
                    before: 7,
                    after: null
                }
            ],
            'reset audit records the removed key with before/after values'
        );

        const auditB4 = auditRows(db).find((row) => row.entity_id === String(setB4.id));
        assert.ok(auditB4, 'bulk reset writes one STAGE_RULE_OVERRIDE audit row');
        const detailsB4 = JSON.parse(auditB4.details);
        assert.strictEqual(detailsB4.kind, 'resetBulk');
        assert.strictEqual(detailsB4.revision, 5);
        assert.strictEqual(detailsB4.schoolYear, YEAR_B, 'reset audit records the school year');
        const removedCoefficient = detailsB4.removedKeys.find((key) => key.table === 'coefficients');
        assert.deepStrictEqual(
            removedCoefficient,
            {
                table: 'coefficients',
                cycleCode: 'secondary_qualifiant',
                levelCode: '2BAC',
                streamCode: '2BACSP',
                subjectCode: 'MATH',
                before: 6,
                after: null
            },
            'bulk audit records every removed custom coefficient with before value'
        );
        const removedExam = detailsB4.removedKeys.find((key) => key.table === 'examCounts');
        assert.deepStrictEqual(
            removedExam,
            {
                table: 'examCounts',
                cycleCode: 'secondary_qualifiant',
                levelCode: '2BAC',
                subjectCode: 'FRENCH',
                before: 6,
                after: null
            },
            'bulk audit records every removed custom exam count with before value'
        );

        // ── 20. every STAGE_RULE_OVERRIDE row carries actor/reason/revision; one audit per successful write ──
        const allAudits = auditRows(db);
        assert.strictEqual(allAudits.length, auditBeforeReset + 3, 'one audit row per successful write after the fixture baseline');
        for (const row of allAudits) {
            const details = JSON.parse(row.details);
            assert.ok(details.actor && details.reason && details.revision, 'audit row carries actor, reason and revision');
        }

        // ── 21. legacy SUBJECT_COEFFICIENT_ADMIN_OVERRIDE rows remain readable ──
        db.prepare(
            `INSERT INTO system_logs(action, entity_type, entity_id, details)
             VALUES('SUBJECT_COEFFICIENT_ADMIN_OVERRIDE', 'settings', 'subjectCoefficientMappings:v1', ?)`
        ).run(JSON.stringify({ actor: ACTOR, reason: 'تجاوز قديم', before: { MATH: 9 }, after: { MATH: 7 } }));
        const legacy = db
            .prepare(`SELECT * FROM system_logs WHERE action = 'SUBJECT_COEFFICIENT_ADMIN_OVERRIDE'`)
            .get();
        assert.ok(legacy, 'legacy audit row remains readable alongside STAGE_RULE_OVERRIDE');
        const legacyDetails = JSON.parse(legacy.details);
        assert.strictEqual(legacyDetails.reason, 'تجاوز قديم');
        assert.strictEqual(legacyDetails.before.MATH, 9);
        assert.strictEqual(legacyDetails.after.MATH, 7);
    } finally {
        db.close();
        setRepoCapturePort(null);
    }

    console.log('stage-rules-repo.test.js: OK');
}

function getActiveRuleSetById(db, schoolYear) {
    const row = stageRulesRepo.getActiveRuleSet(db, schoolYear);
    return row ? row.id : null;
}

run();
