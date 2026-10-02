'use strict';

/**
 * Collegial config-resolution tests (isolation plan, Slice 7).
 *
 *   node tests/collegial/config-resolution.test.js
 *
 * Stage configs resolve per stage: collegial levels/exam counts come from the
 * collegial catalog + collegial rule rows; unknown stages fail with
 * UNKNOWN_CYCLE; unseeded entries fail closed (null/'missing') instead of
 * serving the other stage's values. Uses ONLY the shared builders + prod code.
 */

const assert = require('assert');
const builders = require('../stage-isolation-builders');
const { setDb } = require('../../main/db/context');
const { COLLEGIAL_LEVEL_CODES } = require('../../main/db/education-catalogs/primary-levels');
const { COLLEGIAL_SUBJECTS } = require('../../main/db/education-catalogs/collegial-subjects');
const { LEVEL_CODES } = require('../../main/db/exam-count-defaults');
const { seedOfficialCollegialRows } = require('../../main/db/education-catalogs/collegial-rules');
const EdCollegialLevels = require('../../js/shared/education/collegial-levels');

const { COLLEGIAL, QUALIFIANT, YEAR } = builders;

console.log('[test] collegial config resolution (slice 7)');

async function main() {
    builders.withNoOpCapture();
    const db = builders.openDb();
    setDb(db);
    builders.createRulesSchema(db);
    const ruleSetId = builders.createActiveRuleSet(db, YEAR);
    seedOfficialCollegialRows(db, ruleSetId);

    const handlers = new Map();
    const { registerAppDefaultsIpc } = require('../../main/ipc/appDefaults');
    registerAppDefaultsIpc({ handle: (channel, handler) => handlers.set(channel, handler) });
    const listLevels = (payload) => handlers.get('appDefaults:listLevels')({}, payload);
    const getExamCounts = (levelCode, cycleCode) =>
        handlers.get('appDefaults:getExamCounts')({}, { levelCode, cycleCode });

    // 1. Collegial levels resolve from the per-cycle catalog (no legacy '*' row
    //    on the explicit stage path).
    {
        const response = await listLevels({ cycleCode: COLLEGIAL });
        assert.strictEqual(response.success, true);
        assert.strictEqual(response.cycleCode, COLLEGIAL);
        assert.deepStrictEqual(
            response.levels.map((entry) => entry.code),
            COLLEGIAL_LEVEL_CODES.map((entry) => entry.code)
        );
        assert.ok(
            response.levels.every((entry) => entry.code !== '*'),
            'explicit stage path carries no compat row'
        );
        console.log('  [ok] collegial levels from the per-cycle catalog');
    }

    // 2. Legacy no-cycle shape keeps the '*' compat row (row-124 guard: never deleted early).
    {
        const legacy = await listLevels(undefined);
        assert.strictEqual(legacy.success, true);
        assert.strictEqual(legacy.levels[0].code, '*');
        assert.strictEqual(legacy.levels.length, LEVEL_CODES.length + 1);
        const qualifiant = await listLevels({ cycleCode: QUALIFIANT });
        assert.strictEqual(qualifiant.levels[0].code, '*');
        console.log("  [ok] legacy + qualifiant '*' compat row preserved");
    }

    // 3. Unknown stage → UNKNOWN_CYCLE on both endpoints.
    {
        const levels = await listLevels({ cycleCode: 'secondary_unknown' });
        assert.strictEqual(levels.success, false);
        assert.strictEqual(levels.code, 'UNKNOWN_CYCLE');
        const counts = await getExamCounts('1APIC', 'secondary_unknown');
        assert.strictEqual(counts.success, false);
        assert.strictEqual(counts.code, 'UNKNOWN_CYCLE');
        console.log('  [ok] UNKNOWN_CYCLE for unknown stages');
    }

    // 4. Collegial exam counts resolve from collegial rule rows (real catalog
    //    labels + real seeded counts, incl. the الاجتماعيات level variation).
    {
        const frenchLabel = COLLEGIAL_SUBJECTS.FRENCH.labelAr;
        const socialLabel = COLLEGIAL_SUBJECTS.SOCIAL_STUDIES.labelAr;
        const first = await getExamCounts('1APIC', COLLEGIAL);
        assert.strictEqual(first.success, true);
        assert.strictEqual(first.cycleCode, COLLEGIAL);
        assert.strictEqual(first.assessmentModel, 'exams_activities');
        const french = first.subjects.find((entry) => entry.subject === frenchLabel);
        assert.ok(french, 'FRENCH entry served');
        assert.strictEqual(french.examCount, 4);
        assert.strictEqual(french.source, 'level');
        const socialFirst = first.subjects.find((entry) => entry.subject === socialLabel);
        assert.strictEqual(socialFirst.examCount, 3);
        const third = await getExamCounts('3APIC', COLLEGIAL);
        const socialThird = third.subjects.find((entry) => entry.subject === socialLabel);
        assert.strictEqual(socialThird.examCount, 2, '3APIC الاجتماعيات level variation');
        console.log('  [ok] collegial exam counts from collegial rows');
    }

    // 5. Missing config fails closed: TECHNOLOGY/1APIC has no row → null/'missing',
    //    never a qualifiant count.
    {
        const response = await getExamCounts('1APIC', COLLEGIAL);
        const technologyLabel = COLLEGIAL_SUBJECTS.TECHNOLOGY.labelAr;
        const technology = response.subjects.find((entry) => entry.subject === technologyLabel);
        assert.ok(technology, 'TECHNOLOGY entry served');
        assert.strictEqual(technology.examCount, null);
        assert.strictEqual(technology.source, 'missing');
        assert.ok(
            response.subjects.every((entry) => entry.examCount === null || Number.isFinite(entry.examCount)),
            'no entry may carry a foreign fallback'
        );
        console.log("  [ok] unseeded entries fail closed (null/'missing')");
    }

    // 6. Level routing stays inside the stage: collegial sections resolve via
    //    the collegial catalog; qualifiant branches never do.
    {
        assert.strictEqual(EdCollegialLevels.matchLevelFromSection('3APIC-7').code, '3APIC');
        assert.strictEqual(EdCollegialLevels.resolveLevel('الأولى إعدادي مسار دولي').code, '1APIC');
        assert.strictEqual(EdCollegialLevels.matchLevelFromSection('2BACSMA-3'), null);
        assert.strictEqual(EdCollegialLevels.resolveLevel('السنة الثانية بكالوريا'), null);
        console.log('  [ok] collegial level routing is stage-scoped');
    }

    console.log('[pass] collegial config resolution');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
