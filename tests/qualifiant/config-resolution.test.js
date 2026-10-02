'use strict';

/**
 * Qualifiant config-resolution tests (isolation plan, Slice 7).
 *
 *   node tests/qualifiant/config-resolution.test.js
 *
 * Stage configs resolve per stage: qualifiant levels/exam counts come from the
 * qualifiant catalog + qualifiant rule rows (legacy '*' compat row preserved);
 * unknown stages fail with UNKNOWN_CYCLE; a missing rule set fails with
 * RULES_UNAVAILABLE and unseeded entries fail closed (null/'missing') instead
 * of serving the other stage's values. Uses ONLY shared builders + prod code.
 */

const assert = require('assert');
const builders = require('../stage-isolation-builders');
const { setDb } = require('../../main/db/context');
const { LEVEL_CODES } = require('../../main/db/exam-count-defaults');
const EdQualifiantLevels = require('../../js/shared/education/qualifiant-levels');

const { COLLEGIAL, QUALIFIANT, YEAR } = builders;

console.log('[test] qualifiant config resolution (slice 7)');

async function main() {
    builders.withNoOpCapture();
    const db = builders.openDb();
    setDb(db);
    builders.createRulesSchema(db);

    const handlers = new Map();
    const { registerAppDefaultsIpc } = require('../../main/ipc/appDefaults');
    registerAppDefaultsIpc({ handle: (channel, handler) => handlers.set(channel, handler) });
    const listLevels = (payload) => handlers.get('appDefaults:listLevels')({}, payload);
    const getExamCounts = (levelCode, cycleCode) =>
        handlers.get('appDefaults:getExamCounts')({}, cycleCode ? { levelCode, cycleCode } : levelCode);

    // Fake authed sender so the soft-auth write handler passes its role gate
    // (same pattern as tests/appdefaults-exam-counts-cycle.test.js).
    const { getActiveSessions } = require('../../main/ipc/auth');
    const senderId = 'slice-7-qualifiant-config-sender';
    getActiveSessions().set(senderId, {
        userId: 9,
        name: 'مستخدم الاختبار',
        email: 'test@school.local',
        role: 'admin',
        mustChangePassword: false,
        authenticatedAt: new Date().toISOString(),
        locked: false
    });
    const saveExamCounts = (payload) =>
        handlers.get('appDefaults:saveExamCounts')({ sender: { id: senderId } }, payload);

    // 1. Qualifiant levels = the '*' compat row + the qualifiant catalog
    //    (row-124 guard: the compat row is never deleted early).
    {
        const response = await listLevels({ cycleCode: QUALIFIANT });
        assert.strictEqual(response.success, true);
        assert.strictEqual(response.cycleCode, QUALIFIANT);
        assert.strictEqual(response.levels[0].code, '*');
        assert.deepStrictEqual(
            response.levels.slice(1).map((entry) => entry.code),
            LEVEL_CODES.map((entry) => entry.code)
        );
        const legacy = await listLevels(undefined);
        assert.strictEqual(legacy.levels[0].code, '*');
        console.log("  [ok] qualifiant + legacy levels keep the '*' compat row");
    }

    // 2. Unknown stage → UNKNOWN_CYCLE on both endpoints.
    {
        const levels = await listLevels({ cycleCode: 'secondary_unknown' });
        assert.strictEqual(levels.success, false);
        assert.strictEqual(levels.code, 'UNKNOWN_CYCLE');
        const counts = await getExamCounts('TCSF', 'secondary_unknown');
        assert.strictEqual(counts.success, false);
        assert.strictEqual(counts.code, 'UNKNOWN_CYCLE');
        console.log('  [ok] UNKNOWN_CYCLE for unknown stages');
    }

    // 3. Qualifiant exam counts resolve from qualifiant rule rows (legacy shape
    //    preserved when no cycle is passed).
    {
        const saved = await saveExamCounts({
            levelCode: 'TCSF',
            schoolYear: YEAR,
            reason: 'اختبار slice-7',
            subjects: [{ subject: 'الرياضيات', examCount: 3 }]
        });
        assert.strictEqual(saved.success, true);
        const counts = await getExamCounts('TCSF', QUALIFIANT);
        assert.strictEqual(counts.success, true);
        assert.strictEqual(counts.cycleCode, QUALIFIANT);
        const math = counts.subjects.find((entry) => entry.subject === 'الرياضيات');
        assert.ok(math, 'الرياضيات entry served');
        assert.strictEqual(math.examCount, 3);
        assert.strictEqual(math.source, 'level');
        const legacy = await getExamCounts('TCSF');
        assert.strictEqual(legacy.success, true);
        assert.strictEqual(legacy.cycleCode, QUALIFIANT, 'legacy response echoes qualifiant');
        console.log('  [ok] qualifiant exam counts from qualifiant rows');
    }

    // 4. Missing config fails closed: no rule set → RULES_UNAVAILABLE; an empty
    //    rule set serves null/'missing' entries — never collegial values.
    {
        const emptyDb = builders.openDb();
        setDb(emptyDb);
        builders.createRulesSchema(emptyDb);
        const missing = await getExamCounts('TCSF', QUALIFIANT);
        assert.strictEqual(missing.success, false);
        assert.strictEqual(missing.code, 'RULES_UNAVAILABLE');

        builders.createActiveRuleSet(emptyDb, YEAR);
        const unseeded = await getExamCounts('TCSF', QUALIFIANT);
        assert.strictEqual(unseeded.success, true);
        assert.ok(unseeded.subjects.length > 0, 'qualifiant subject entries still served');
        assert.ok(
            unseeded.subjects.every((entry) => entry.examCount === null && entry.source === 'missing'),
            'every unseeded entry fails closed'
        );
        setDb(db);
        console.log("  [ok] RULES_UNAVAILABLE + null/'missing' fail-closed");
    }

    // 5. Level routing stays inside the stage: qualifiant sections resolve via
    //    the qualifiant catalog; collegial sections never do.
    {
        assert.notStrictEqual(EdQualifiantLevels.matchLevelFromSection('TCSF-1').code, 'other');
        assert.strictEqual(EdQualifiantLevels.matchLevelFromSection('1APIC-2').code, 'other');
        assert.strictEqual(EdQualifiantLevels.matchLevelFromSection('3APIC-7').code, 'other');
        assert.strictEqual(COLLEGIAL, 'secondary_collegial');
        console.log('  [ok] collegial sections never resolve to a qualifiant level');
    }

    console.log('[pass] qualifiant config resolution');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
