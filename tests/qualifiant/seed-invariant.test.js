'use strict';

/**
 * Qualifiant seed-invariant tests (isolation plan, Slice 7).
 *
 *   node tests/qualifiant/seed-invariant.test.js
 *
 * The qualifiant official seeds plant zero foreign-stage rows in the rule
 * tables, are idempotent, and capture zero outbox rows (local seed data).
 * Uses ONLY the shared builders + production seed modules.
 */

const assert = require('assert');
const builders = require('../stage-isolation-builders');
const {
    getOfficialCoefficientRows,
    seedOfficialCoefficients
} = require('../../main/db/education-catalogs/qualifiant-coefficients');
const {
    getOfficialSubjectWeightRows,
    seedOfficialSubjectWeights
} = require('../../main/db/education-catalogs/subject-weights');

const { COLLEGIAL, QUALIFIANT, PRIMARY, YEAR } = builders;

console.log('[test] qualifiant seed invariants (slice 7)');

builders.withNoOpCapture();

// 1. Seed builders stamp the qualifiant cycle on EVERY row (by construction).
{
    const coefficients = getOfficialCoefficientRows({ ruleSetId: 1 });
    assert.ok(coefficients.length > 0, 'official coefficient rows exist');
    for (const row of coefficients) {
        assert.strictEqual(row.cycle_code, QUALIFIANT);
        assert.strictEqual(row.source, 'official');
    }
    const weights = getOfficialSubjectWeightRows({ ruleSetId: 1 });
    assert.ok(weights.length > 0, 'official weight rows exist');
    for (const row of weights) {
        assert.strictEqual(row.cycle_code, QUALIFIANT);
        assert.strictEqual(row.source, 'official');
        assert.strictEqual(row.exam_weight_bps + row.activity_weight_bps, 10000, row.subject_code);
    }
    // Spot-check the golden pair survives the seed mapping.
    const mathSma = coefficients.find(
        (row) => row.stream_code === '2BACSMA' && row.subject_code === 'MATH'
    );
    assert.ok(mathSma, '2BACSMA/MATH seed row exists');
    assert.strictEqual(mathSma.coefficient, 9);
    assert.strictEqual(mathSma.level_code, '2BAC');
    console.log('  [ok] seed builders stamp qualifiant on every row');
}

const db = builders.openDb();
builders.createRulesSchema(db);
const ruleSetId = builders.createActiveRuleSet(db, YEAR);
seedOfficialCoefficients(db, ruleSetId);
seedOfficialSubjectWeights(db, ruleSetId);

// 2. Zero foreign-stage rows in the seeded rule tables.
{
    for (const table of ['subject_coefficients', 'subject_weight_rules']) {
        const groups = db
            .prepare(`SELECT cycle_code, COUNT(*) AS c FROM ${table} WHERE rule_set_id = ? GROUP BY cycle_code`)
            .all(ruleSetId);
        assert.strictEqual(groups.length, 1, `${table}: exactly one stage present`);
        assert.strictEqual(groups[0].cycle_code, QUALIFIANT, `${table}: stage is qualifiant`);
        for (const foreign of [COLLEGIAL, PRIMARY]) {
            const count = db
                .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE rule_set_id = ? AND cycle_code = ?`)
                .get(ruleSetId, foreign).c;
            assert.strictEqual(count, 0, `${table}: zero ${foreign} rows`);
        }
    }
    // exam_count_rules is revision-managed (no stage seed file): the invariant
    // is enforced at write time by requireQualifiantCycles (pinned below).
    console.log('  [ok] zero foreign-stage rows in seeded rule tables');
}

// 3. The repo write guard keeps foreign stages out of exam_count_rules.
{
    const stageRulesRepo = require('../../main/repos/stage-rules');
    const actor = { userId: 7, name: 'إدارة المدرسة', email: 'admin@school.local', role: 'admin' };
    for (const foreign of [COLLEGIAL, PRIMARY]) {
        builders.throwsCode(
            () =>
                stageRulesRepo.saveExamCounts(db, {
                    schoolYear: YEAR,
                    reason: 'slice-7 probe',
                    actor,
                    entries: [{ cycleCode: foreign, levelCode: '*', subjectCode: 'MATH', examCount: 3 }]
                }),
            'FORBIDDEN'
        );
        const count = db
            .prepare('SELECT COUNT(*) AS c FROM exam_count_rules WHERE cycle_code = ?')
            .get(foreign).c;
        assert.strictEqual(count, 0, `exam_count_rules: zero ${foreign} rows after refused write`);
    }
    console.log('  [ok] write guard rejects foreign exam-count writes');
}

// 4. Seeds are idempotent and capture zero outbox rows.
{
    const before = {
        coefficients: db.prepare('SELECT COUNT(*) AS c FROM subject_coefficients').get().c,
        weights: db.prepare('SELECT COUNT(*) AS c FROM subject_weight_rules').get().c
    };
    seedOfficialCoefficients(db, ruleSetId);
    seedOfficialSubjectWeights(db, ruleSetId);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM subject_coefficients').get().c, before.coefficients);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM subject_weight_rules').get().c, before.weights);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM sync_outbox').get().c, 0, 'seeds capture zero outbox rows');
    console.log('  [ok] idempotent, zero outbox rows');
}

console.log('[pass] qualifiant seed invariants');
