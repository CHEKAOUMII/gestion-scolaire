'use strict';

/**
 * Cycle-aware exam-count endpoints (docs/plans/2026-08-02-multi-stage-school-architecture.md, S2-3):
 *   - legacy (no cycle) getExamCounts / getExamCount / saveExamCounts keep the
 *     qualifiant behavior exactly as before;
 *   - primary: getExamCounts serves the 8 primary subjects with examCount null
 *     and source 'missing' (fail-closed read — no rows, no silent fallback),
 *     assessmentModel 'continuous' from the cycle catalog SSOT;
 *   - collegial: getExamCounts serves the collegial catalog labels fail-closed
 *     (examCount null / source 'missing' while no collegial rule rows exist in
 *     the fixture) with assessmentModel 'exams_activities' from the catalog;
 *   - unknown cycle → UNKNOWN_CYCLE, mirroring appDefaults:listLevels;
 *   - saveExamCounts forwards the requested cycle on every entry so the existing
 *     repo guard (requireQualifiantCycles) rejects primary/collegial writes,
 *     leaving zero exam_count_rules rows for the non-qualifiant cycle.
 *
 * Disjoint from tests/primary-stage-catalogs.test.js (which covers listLevels only).
 */

const assert = require('assert');
const { setDb } = require('../main/db/context');
const { ensureCycleReferenceSchema, ensureStageRulesSchema, ensureCycleProfilesSchema } = require('../main/db/schema');
const { seedSubjectCatalog } = require('../main/db/education-catalogs/subject-catalog');
const { PRIMARY_SUBJECTS } = require('../main/db/education-catalogs/primary-subjects');
const { COLLEGIAL_SUBJECTS } = require('../main/db/education-catalogs/collegial-subjects');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');

const PRIMARY = 'primary';
const COLLEGIAL = 'secondary_collegial';
const QUALIFIANT = 'secondary_qualifiant';
const YEAR = '2025/2026';

console.log('[test] appDefaults exam-count cycle endpoints (S2-3)');

function openDb() {
    // Prefer better-sqlite3 (production driver); fall back to node:sqlite.
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

{
    const db = openDb();
    setDb(db);
    setRepoCapturePort(createNoOpCapturePort());
    buildFixture(db);

    const handlers = new Map();
    const { registerAppDefaultsIpc } = require('../main/ipc/appDefaults');
    registerAppDefaultsIpc({ handle: (channel, handler) => handlers.set(channel, handler) });

    const getExamCounts = (levelCode, cycleCode) =>
        handlers.get('appDefaults:getExamCounts')({}, cycleCode ? { levelCode, cycleCode } : levelCode);
    const getExamCount = (levelCode, subject, cycleCode) =>
        handlers.get('appDefaults:getExamCount')({}, cycleCode ? { levelCode, subject, cycleCode } : { levelCode, subject });

    // Fake authed sender so the soft-auth write handler passes its role gate.
    // getActiveSessions() returns the live SESSION_BY_SENDER map, so the session
    // can be injected directly without the users/settings tables.
    const { getActiveSessions } = require('../main/ipc/auth');
    const senderId = 's2-3-exam-counts-sender';
    getActiveSessions().set(senderId, {
        userId: 9,
        name: 'مستخدم الاختبار',
        email: 'test@school.local',
        role: 'admin',
        mustChangePassword: false,
        authenticatedAt: new Date().toISOString(),
        locked: false
    });
    const fakeEvent = { sender: { id: senderId } };
    const saveExamCounts = (payload) => handlers.get('appDefaults:saveExamCounts')(fakeEvent, payload);

    const ruleSetCount = () => db.prepare('SELECT COUNT(*) AS c FROM stage_rule_sets').get().c;
    const primaryExamRows = () =>
        db.prepare(`SELECT COUNT(*) AS c FROM exam_count_rules WHERE cycle_code = ?`).get(PRIMARY).c;

    // 1. Legacy save (no cycle) → succeeds and bootstraps the active rule set.
    saveExamCounts({
        levelCode: 'TCSF',
        schoolYear: YEAR,
        reason: 'اختبار S2-3',
        subjects: [{ subject: 'الرياضيات', examCount: 3 }]
    }).then((legacySave) => {
        assert.strictEqual(legacySave.success, true, 'legacy save must succeed');
        assert.strictEqual(legacySave.saved, 1);
        assert.strictEqual(ruleSetCount(), 1, 'legacy save must create the active rule set');

        // 2. Legacy read (no cycle) → qualifiant behavior preserved.
        return getExamCounts('TCSF');
    }).then((legacyCounts) => {
        assert.strictEqual(legacyCounts.success, true, 'legacy getExamCounts must succeed');
        assert.strictEqual(legacyCounts.cycleCode, QUALIFIANT, 'legacy response echoes qualifiant');
        assert.ok(Array.isArray(legacyCounts.subjects) && legacyCounts.subjects.length > 0, 'qualifiant subjects present');
        const math = legacyCounts.subjects.find((item) => item.subject === 'الرياضيات');
        assert.ok(math, 'الرياضيات is among the qualifiant subject entries');
        assert.strictEqual(math.examCount, 3, 'legacy count resolved from the rule set');
        assert.strictEqual(math.source, 'level', 'level-* row classifies as level');

        // 3. Legacy single lookup.
        return getExamCount('TCSF', 'الرياضيات');
    }).then((legacyCount) => {
        assert.strictEqual(legacyCount.success, true, 'legacy getExamCount must succeed');
        assert.strictEqual(legacyCount.count, 3);
        console.log('  [ok] legacy qualifiant exam-count reads/save unchanged without a cycle');

        // 4. Primary read: 8 subjects, null examCount, source missing, continuous assessment.
        return getExamCounts('1AP', PRIMARY);
    }).then((primaryCounts) => {
        assert.strictEqual(primaryCounts.success, true);
        assert.strictEqual(primaryCounts.cycleCode, PRIMARY);
        assert.strictEqual(primaryCounts.assessmentModel, 'continuous');
        assert.strictEqual(primaryCounts.levelCode, '1AP');
        assert.strictEqual(primaryCounts.subjects.length, 8, 'all 8 primary subjects are served');
        const expectedLabels = Object.values(PRIMARY_SUBJECTS)
            .map((meta) => meta.labelAr)
            .sort((a, b) => String(a).localeCompare(String(b), 'ar'));
        assert.deepStrictEqual(
            primaryCounts.subjects.map((item) => item.subject),
            expectedLabels,
            'primary subjects come from the primary catalog labels'
        );
        for (const item of primaryCounts.subjects) {
            assert.strictEqual(item.examCount, null, 'no primary rule rows → null exam count');
            assert.strictEqual(item.source, 'missing', 'fail-closed source label');
        }

        // Primary single lookup fails closed too.
        return getExamCount('1AP', 'اللغة العربية', PRIMARY);
    }).then((primaryCount) => {
        assert.strictEqual(primaryCount.success, false);
        assert.strictEqual(primaryCount.code, 'MISSING_RULE');
        assert.strictEqual(primaryCount.count, null);
        console.log('  [ok] primary getExamCounts serves 8 missing rules, continuous assessment');

        // 5. Collegial read: catalog-driven subjects, null examCount (no collegial
        //    rows in this fixture — the collegial migration has not run), source
        //    missing, and the exams_activities assessment model from the catalog.
        return getExamCounts('1APIC', COLLEGIAL);
    }).then((collegialCounts) => {
        assert.strictEqual(collegialCounts.success, true);
        assert.strictEqual(collegialCounts.cycleCode, COLLEGIAL);
        assert.strictEqual(collegialCounts.assessmentModel, 'exams_activities');
        assert.strictEqual(collegialCounts.levelCode, '1APIC');
        const expectedCollegialLabels = Object.values(COLLEGIAL_SUBJECTS)
            .map((meta) => meta.labelAr)
            .sort((a, b) => String(a).localeCompare(String(b), 'ar'));
        assert.deepStrictEqual(
            collegialCounts.subjects.map((item) => item.subject),
            expectedCollegialLabels,
            'collegial subjects come from the collegial catalog labels'
        );
        for (const item of collegialCounts.subjects) {
            assert.strictEqual(item.examCount, null, 'no collegial rule rows in fixture → null exam count');
            assert.strictEqual(item.source, 'missing', 'fail-closed source label');
        }
        console.log('  [ok] collegial getExamCounts serves the catalog fail-closed, exams_activities model');

        // 6. Unknown cycle → UNKNOWN_CYCLE (mirrors listLevels).
        return getExamCounts('1AP', 'unknown_cycle');
    }).then((unknown) => {
        assert.strictEqual(unknown.success, false);
        assert.strictEqual(unknown.code, 'UNKNOWN_CYCLE');
        assert.strictEqual(unknown.cycleCode, 'unknown_cycle');
        console.log('  [ok] unknown cycle rejected with UNKNOWN_CYCLE');

        // 7. Primary write → rejected by the repo guard; zero rows, no new revision.
        return saveExamCounts({
            cycleCode: PRIMARY,
            levelCode: '1AP',
            schoolYear: YEAR,
            reason: 'محاولة كتابة ابتدائية',
            subjects: [{ subject: 'اللغة العربية', examCount: 2 }]
        });
    }).then((primarySave) => {
        assert.strictEqual(primarySave.success, false, 'primary save must fail');
        assert.strictEqual(primarySave.code, 'FORBIDDEN');
        assert.strictEqual(primaryExamRows(), 0, 'no exam_count_rules rows for the primary cycle');
        assert.strictEqual(ruleSetCount(), 1, 'rejected save must not create a revision');
        console.log('  [ok] primary saveExamCounts rejected by requireQualifiantCycles, zero rows');

        // 8. Legacy save still succeeds after a rejected primary write.
        return saveExamCounts({
            levelCode: 'TCSF',
            schoolYear: YEAR,
            reason: 'اختبار بعد الرفض',
            subjects: [{ subject: 'اللغة العربية', examCount: 2 }]
        });
    }).then((legacySaveAgain) => {
        assert.strictEqual(legacySaveAgain.success, true, 'legacy save must still succeed');
        assert.strictEqual(ruleSetCount(), 2, 'legacy save creates the next revision');
        assert.strictEqual(primaryExamRows(), 0, 'no primary rows after legacy save either');
        db.close();
        console.log('  [ok] legacy saveExamCounts still succeeds after the rejected primary write');
    }).catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
