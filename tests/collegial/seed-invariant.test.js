'use strict';

/**
 * Collegial seed-invariant tests (isolation plan, Slice 7).
 *
 *   node tests/collegial/seed-invariant.test.js
 *
 * The collegial official seeds plant zero foreign-stage rows in the rule
 * tables, are idempotent, and capture zero outbox rows (local seed data).
 * Uses ONLY the shared builders + production seed modules.
 */

const assert = require('assert');
const builders = require('../stage-isolation-builders');
const {
    COLLEGIAL_COEFFICIENTS,
    COLLEGIAL_EXAM_COUNTS,
    COLLEGIAL_WEIGHTS,
    getOfficialCollegialCoefficientRows,
    getOfficialCollegialExamCountRows,
    getOfficialCollegialWeightRows,
    seedOfficialCollegialRows
} = require('../../main/db/education-catalogs/collegial-rules');

const { COLLEGIAL, QUALIFIANT, PRIMARY, YEAR } = builders;

console.log('[test] collegial seed invariants (slice 7)');

builders.withNoOpCapture();

// 1. Seed builders stamp the collegial cycle on EVERY row (by construction).
{
    for (const row of getOfficialCollegialCoefficientRows({ ruleSetId: 1 })) {
        assert.strictEqual(row.cycle_code, COLLEGIAL);
        assert.strictEqual(row.source, 'official');
    }
    for (const row of getOfficialCollegialExamCountRows({ ruleSetId: 1 })) {
        assert.strictEqual(row.cycle_code, COLLEGIAL);
        assert.strictEqual(row.source, 'official');
    }
    for (const row of getOfficialCollegialWeightRows({ ruleSetId: 1 })) {
        assert.strictEqual(row.cycle_code, COLLEGIAL);
        assert.strictEqual(row.source, 'official');
    }
    assert.strictEqual(getOfficialCollegialCoefficientRows({ ruleSetId: 1 }).length, COLLEGIAL_COEFFICIENTS.length);
    assert.strictEqual(getOfficialCollegialExamCountRows({ ruleSetId: 1 }).length, COLLEGIAL_EXAM_COUNTS.length);
    assert.strictEqual(getOfficialCollegialWeightRows({ ruleSetId: 1 }).length, COLLEGIAL_WEIGHTS.length);
    console.log('  [ok] seed builders stamp collegial on every row');
}

const db = builders.openDb();
builders.createRulesSchema(db);
const ruleSetId = builders.createActiveRuleSet(db, YEAR);
seedOfficialCollegialRows(db, ruleSetId);

function countByCycle(table) {
    return db
        .prepare(`SELECT cycle_code, COUNT(*) AS c FROM ${table} WHERE rule_set_id = ? GROUP BY cycle_code`)
        .all(ruleSetId);
}

// 2. Zero foreign-stage rows in all three rule tables after seeding.
{
    for (const table of ['subject_coefficients', 'exam_count_rules', 'subject_weight_rules']) {
        const groups = countByCycle(table);
        assert.strictEqual(groups.length, 1, `${table}: exactly one stage present`);
        assert.strictEqual(groups[0].cycle_code, COLLEGIAL, `${table}: stage is collegial`);
        for (const foreign of [QUALIFIANT, PRIMARY]) {
            const count = db
                .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE rule_set_id = ? AND cycle_code = ?`)
                .get(ruleSetId, foreign).c;
            assert.strictEqual(count, 0, `${table}: zero ${foreign} rows`);
        }
    }
    console.log('  [ok] zero foreign-stage rows in rule tables');
}

// 3. Seeded weights total 10000 bps at the DB level; TECHNOLOGY has a 3APIC
//    coefficient row but deliberately no weight row.
{
    const weights = db
        .prepare(
            `SELECT subject_code, exam_weight_bps, activity_weight_bps
             FROM subject_weight_rules WHERE rule_set_id = ?`
        )
        .all(ruleSetId);
    assert.strictEqual(weights.length, COLLEGIAL_WEIGHTS.length);
    for (const row of weights) {
        assert.strictEqual(row.exam_weight_bps + row.activity_weight_bps, 10000, row.subject_code);
    }
    assert.ok(!weights.some((row) => row.subject_code === 'TECHNOLOGY'), 'TECHNOLOGY weight stays unseeded');
    const techCoef = db
        .prepare(
            `SELECT COUNT(*) AS c FROM subject_coefficients
             WHERE rule_set_id = ? AND subject_code = 'TECHNOLOGY'`
        )
        .get(ruleSetId).c;
    assert.strictEqual(techCoef, 1, 'TECHNOLOGY 3APIC coefficient is seeded');
    console.log('  [ok] weight totals + TECHNOLOGY boundary pinned');
}

// 4. Seeds are idempotent and capture zero outbox rows.
{
    const before = {
        coefficients: db.prepare('SELECT COUNT(*) AS c FROM subject_coefficients').get().c,
        examCounts: db.prepare('SELECT COUNT(*) AS c FROM exam_count_rules').get().c,
        weights: db.prepare('SELECT COUNT(*) AS c FROM subject_weight_rules').get().c
    };
    seedOfficialCollegialRows(db, ruleSetId);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM subject_coefficients').get().c, before.coefficients);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM exam_count_rules').get().c, before.examCounts);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM subject_weight_rules').get().c, before.weights);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM sync_outbox').get().c, 0, 'seeds capture zero outbox rows');
    console.log('  [ok] idempotent, zero outbox rows');
}

console.log('[pass] collegial seed invariants');
