'use strict';

/**
 * Collegial resolver golden tests (isolation plan, Slice 7 — per-stage minimum).
 *
 *   node tests/collegial/resolver-golden.test.js
 *
 * Pins the collegial official file (migration 2026-08-084,
 * main/db/education-catalogs/collegial-rules.js) through the renderer
 * resolver: 1APIC/2APIC Σ=29, 3APIC CC coefficient 1, stream '*', official
 * exam counts, and official integrated-activity weights. Uses ONLY the shared
 * builders module + production code — never qualifiant fixtures.
 */

const assert = require('assert');
const builders = require('../stage-isolation-builders');
const {
    COLLEGIAL_COEFFICIENTS,
    COLLEGIAL_EXAM_COUNTS,
    COLLEGIAL_WEIGHTS,
    getOfficialCollegialCoefficientRows,
    getOfficialCollegialExamCountRows,
    getOfficialCollegialWeightRows
} = require('../../main/db/education-catalogs/collegial-rules');

const { COLLEGIAL, YEAR } = builders;

console.log('[test] collegial resolver goldens (slice 7)');

const RULE_SET_ID = 1;
const payload = builders.ruleSetPayload({
    coefficients: getOfficialCollegialCoefficientRows({ ruleSetId: RULE_SET_ID }),
    examCounts: getOfficialCollegialExamCountRows({ ruleSetId: RULE_SET_ID }),
    weights: getOfficialCollegialWeightRows({ ruleSetId: RULE_SET_ID })
});
const cc = builders.loadCcRules(payload);

function collegialContext(levelCode, subjectCode) {
    return builders.stageContext(COLLEGIAL, {
        levelCode,
        streamCode: '*',
        subjectCode,
        ruleSet: payload
    });
}

// 1. Exact coefficient goldens per level (verified against the report cards:
//    1APIC Σ=29 → 161,05/29; 2APIC Σ=29 → 271,87/29).
assert.strictEqual(cc.getSubjectCoefficient('اللغة العربية', null, collegialContext('1APIC', 'ARABIC')), 5);
assert.strictEqual(cc.getSubjectCoefficient('الرياضيات', null, collegialContext('1APIC', 'MATH')), 5);
assert.strictEqual(cc.getSubjectCoefficient('subject', null, collegialContext('1APIC', 'SOCIAL_STUDIES')), 3);
assert.strictEqual(cc.getSubjectCoefficient('subject', null, collegialContext('2APIC', 'MATH')), 5);
assert.strictEqual(cc.getSubjectCoefficient('subject', null, collegialContext('2APIC', 'SOCIAL_STUDIES')), 3);
console.log('  [ok] 1APIC/2APIC exact coefficients');

for (const level of ['1APIC', '2APIC']) {
    const expected = COLLEGIAL_COEFFICIENTS.filter((row) => row.level_code === level);
    let sum = 0;
    for (const row of expected) {
        sum += cc.getSubjectCoefficient('subject', null, collegialContext(level, row.subject_code));
    }
    assert.strictEqual(sum, 29, `${level} coefficients must sum to 29`);
}
console.log('  [ok] 1APIC/2APIC coefficient sums = 29');

// 2. 3APIC المراقبة المستمرة: coefficient 1 for every subject (the local-exam
//    dimension is deferred by design — never merged into the CC coefficient).
for (const row of COLLEGIAL_COEFFICIENTS.filter((entry) => entry.level_code === '3APIC')) {
    assert.strictEqual(
        cc.getSubjectCoefficient('subject', null, collegialContext('3APIC', row.subject_code)),
        1,
        `3APIC ${row.subject_code} must keep CC coefficient 1`
    );
}
console.log('  [ok] 3APIC CC coefficients = 1');

// 3. Stream dimension: collegial seeds stream '*' — resolution works with an
//    explicit '*' stream and never requires a qualifiant branch code.
{
    const resolution = cc.resolveSubjectCoefficient('subject', null, collegialContext('1APIC', 'MATH'));
    assert.strictEqual(resolution.ok, true);
    assert.strictEqual(resolution.coefficient, 5);
    assert.strictEqual(resolution.source, 'rule');
    console.log('  [ok] stream wildcard dimension');
}

// 4. Exam-count goldens (incl. the documented الاجتماعيات level variation:
//    3 in 1APIC/2APIC, 2 in 3APIC; TECHNOLOGY in 2APIC only).
assert.strictEqual(cc.getExamCount('subject', null, collegialContext('1APIC', 'FRENCH')), 4);
assert.strictEqual(cc.getExamCount('subject', null, collegialContext('1APIC', 'SOCIAL_STUDIES')), 3);
assert.strictEqual(cc.getExamCount('subject', null, collegialContext('3APIC', 'SOCIAL_STUDIES')), 2);
assert.strictEqual(cc.getExamCount('subject', null, collegialContext('2APIC', 'TECHNOLOGY')), 2);
assert.strictEqual(cc.getExamCount('subject', null, collegialContext('1APIC', 'MATH')), 3);
for (const row of COLLEGIAL_EXAM_COUNTS) {
    assert.strictEqual(
        cc.getExamCount('subject', null, collegialContext(row.level_code, row.subject_code)),
        row.exam_count,
        `exam count ${row.level_code}/${row.subject_code}`
    );
}
console.log('  [ok] exam-count goldens');

// 5. Weight goldens: measured integrated-activity ratios; every row totals 10000 bps.
{
    const arabic = cc.resolveSubjectWeights('subject', collegialContext('1APIC', 'ARABIC'));
    assert.strictEqual(arabic.ok, true);
    assert.strictEqual(arabic.examWeight, 0.75);
    assert.strictEqual(arabic.activityWeight, 0.25);
    const math = cc.resolveSubjectWeights('subject', collegialContext('1APIC', 'MATH'));
    assert.strictEqual(math.ok, true);
    assert.strictEqual(math.examWeight, 1);
    assert.strictEqual(math.activityWeight, 0);
    for (const row of COLLEGIAL_WEIGHTS) {
        assert.strictEqual(row.exam_weight_bps + row.activity_weight_bps, 10000, row.subject_code);
    }
    console.log('  [ok] subject-weight goldens (Σ=10000 bps)');
}

// 6. Custom beats official on the same key (029 shadowing inside the stage).
{
    const customPayload = builders.ruleSetPayload({
        coefficients: [
            ...payload.rows.coefficients,
            builders.coefficientRow({
                cycle_code: COLLEGIAL,
                level_code: '1APIC',
                stream_code: '*',
                subject_code: 'MATH',
                coefficient: 7,
                source: 'custom'
            })
        ],
        examCounts: payload.rows.examCounts,
        weights: payload.rows.weights
    });
    const customCc = builders.loadCcRules(customPayload);
    const context = builders.stageContext(COLLEGIAL, {
        levelCode: '1APIC',
        streamCode: '*',
        subjectCode: 'MATH',
        ruleSet: customPayload
    });
    assert.strictEqual(customCc.getSubjectCoefficient('subject', null, context), 7);
    // The official baseline still resolves 5 for the unshadowed fixture.
    assert.strictEqual(cc.getSubjectCoefficient('subject', null, collegialContext('1APIC', 'MATH')), 5);
    console.log('  [ok] custom shadows official on the same key');
}

// 7. Weighted-average smoke: 1APIC denominator is the golden Σ=29.
{
    const averages = COLLEGIAL_COEFFICIENTS.filter((row) => row.level_code === '1APIC').map((row) => ({
        subject: 'subject',
        avg: 10,
        subjectCode: row.subject_code
    }));
    let weighted = 0;
    let coeffs = 0;
    for (const entry of averages) {
        const coefficient = cc.getSubjectCoefficient(entry.subject, null, collegialContext('1APIC', entry.subjectCode));
        weighted += entry.avg * coefficient;
        coeffs += coefficient;
    }
    assert.strictEqual(coeffs, 29);
    assert.strictEqual(weighted / coeffs, 10);
    console.log('  [ok] weighted-average denominator Σ=29');
}

// 8. Stage policy derivation (Slice-2 STAGE_GRADING_POLICIES): a collegial
//    partial context derives the level from the section via the collegial
//    catalog and defaults the stream to '*'. Without the catalog it fails
//    closed — never via branch inference (detectBranch is null for collegial).
{
    const EdCollegialLevels = require('../../js/shared/education/collegial-levels');
    const derivedCc = builders.loadCcRules(payload, { EdCollegialLevels });
    const partial = builders.stageContext(COLLEGIAL, {
        section: '1APIC-3',
        subjectCode: 'MATH',
        ruleSet: payload
    });
    assert.strictEqual(derivedCc.getSubjectCoefficient('subject', null, partial), 5);

    const noCatalog = builders.stageContext(COLLEGIAL, {
        section: '1APIC-3',
        subjectCode: 'MATH',
        ruleSet: payload
    });
    const failed = cc.resolveSubjectCoefficient('subject', null, noCatalog);
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(failed.code, 'MISSING_RULE');
    assert.strictEqual(failed.incomplete, true);
    console.log('  [ok] collegial policy derivation (section → level, stream *)');
}

assert.strictEqual(typeof YEAR, 'string');
console.log('[pass] collegial resolver goldens');
