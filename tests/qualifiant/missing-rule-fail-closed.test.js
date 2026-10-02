'use strict';

/**
 * Qualifiant missing-rule fail-closed tests (isolation plan, Slice 7).
 *
 *   node tests/qualifiant/missing-rule-fail-closed.test.js
 *
 * Unseeded qualifiant inputs fail closed (MISSING_RULE / RULES_UNAVAILABLE
 * with official export blocked) — never with a guessed coefficient, and never
 * with a collegial row. Uses ONLY the shared builders + production code.
 */

const assert = require('assert');
const builders = require('../stage-isolation-builders');
const StageRulesErrorContract = require('../../js/shared/errors/stage-rules-error-contract');
const { getOfficialCoefficientRows } = require('../../main/db/education-catalogs/qualifiant-coefficients');
const { getOfficialSubjectWeightRows } = require('../../main/db/education-catalogs/subject-weights');

const { COLLEGIAL, QUALIFIANT } = builders;

console.log('[test] qualifiant missing-rule fail-closed (slice 7)');

const RULE_SET_ID = 1;
const payload = builders.ruleSetPayload({
    coefficients: getOfficialCoefficientRows({ ruleSetId: RULE_SET_ID }),
    examCounts: [
        builders.examCountRow({ cycle_code: QUALIFIANT, level_code: '*', subject_code: 'MATH', exam_count: 3 })
    ],
    weights: getOfficialSubjectWeightRows({ ruleSetId: RULE_SET_ID })
});
const cc = builders.loadCcRules(payload);

function qualifiantContext(branch, subjectCode, extra) {
    return builders.stageContext(
        QUALIFIANT,
        Object.assign(
            {
                levelCode: /^TC/i.test(branch || '') ? 'TC' : '2BAC',
                streamCode: branch,
                subjectCode,
                ruleSet: payload
            },
            extra
        )
    );
}

function assertFailClosed(result, label) {
    assert.strictEqual(result.ok, false, `${label}: must not resolve`);
    assert.strictEqual(result.incomplete, true, `${label}: must be incomplete`);
    assert.strictEqual(
        StageRulesErrorContract.isOfficialExportAllowed(result),
        false,
        `${label}: official export must be blocked`
    );
}

// 1. Unknown subject code → MISSING_RULE (never a nearby coefficient or 1).
{
    const resolution = cc.resolveSubjectCoefficient('subject', '2BACSMA', qualifiantContext('2BACSMA', 'NOPE_SUBJECT_X'));
    assertFailClosed(resolution, 'unknown subject');
    assert.strictEqual(resolution.code, 'MISSING_RULE');
    assert.strictEqual(resolution.error.name, 'MissingStageRuleError');
    builders.throwsCode(
        () => cc.getSubjectCoefficient('subject', '2BACSMA', qualifiantContext('2BACSMA', 'NOPE_SUBJECT_X')),
        'MISSING_RULE'
    );
    console.log('  [ok] unknown subject → MISSING_RULE (throw + result)');
}

// 2. Unmappable subject label → MISSING_RULE.
{
    const resolution = cc.resolveSubjectCoefficient('مادة غير موجودة إطلاقا', '2BACSMA', qualifiantContext('2BACSMA'));
    assertFailClosed(resolution, 'unmappable label');
    assert.strictEqual(resolution.code, 'MISSING_RULE');
    console.log('  [ok] unmappable label → MISSING_RULE');
}

// 3. Missing exam-count row (no ARABIC row anywhere) → MISSING_RULE.
{
    const resolution = cc.resolveExamCount('subject', 'TCSF', qualifiantContext('TCSF', 'ARABIC'));
    assertFailClosed(resolution, 'missing exam count');
    assert.strictEqual(resolution.code, 'MISSING_RULE');
    console.log('  [ok] missing exam count → MISSING_RULE');
}

// 4. Missing rule set → RULES_UNAVAILABLE (never constants).
{
    const noSetPayload = {
        ruleSet: null,
        rows: {
            coefficients: payload.rows.coefficients,
            examCounts: payload.rows.examCounts,
            weights: payload.rows.weights
        }
    };
    const noSetCc = builders.loadCcRules(noSetPayload);
    const context = builders.stageContext(QUALIFIANT, {
        levelCode: '2BAC',
        streamCode: '2BACSMA',
        subjectCode: 'MATH',
        ruleSet: noSetPayload
    });
    const resolution = noSetCc.resolveSubjectCoefficient('subject', '2BACSMA', context);
    assertFailClosed(resolution, 'missing rule set');
    assert.strictEqual(resolution.code, 'RULES_UNAVAILABLE');
    assert.strictEqual(resolution.error.name, 'StageRulesUnavailableError');
    console.log('  [ok] missing rule set → RULES_UNAVAILABLE');
}

// 5. Missing cycle context fails closed with RULES_UNAVAILABLE on every
//    authoritative path — never a qualifiant default (S1 G3 rule, Slice 2
//    fallback removal), even when the branch alone would identify the stage.
{
    const weights = cc.resolveSubjectWeights('subject', {
        levelCode: '2BAC',
        subjectCode: 'MATH',
        schoolYear: builders.YEAR,
        ruleSet: payload
    });
    assert.strictEqual(weights.ok, false);
    assert.strictEqual(weights.code, 'RULES_UNAVAILABLE');

    const coefficient = cc.resolveSubjectCoefficient('subject', '2BACSMA', {
        levelCode: '2BAC',
        streamCode: '2BACSMA',
        subjectCode: 'MATH',
        schoolYear: builders.YEAR,
        ruleSet: payload
    });
    assertFailClosed(coefficient, 'missing cycle context');
    assert.strictEqual(coefficient.code, 'RULES_UNAVAILABLE');
    assert.strictEqual(coefficient.error.name, 'StageRulesUnavailableError');
    console.log('  [ok] missing cycle context → RULES_UNAVAILABLE (all paths)');
}

// 6. Cross-stage exact rows never leak: a collegial-only payload cannot serve
//    a qualifiant context.
{
    const collegialOnly = builders.ruleSetPayload({
        coefficients: [
            builders.coefficientRow({
                cycle_code: COLLEGIAL,
                level_code: '1APIC',
                stream_code: '*',
                subject_code: 'MATH',
                coefficient: 5
            })
        ]
    });
    const leakCc = builders.loadCcRules(collegialOnly);
    const resolution = leakCc.resolveSubjectCoefficient(
        'subject',
        '2BACSMA',
        builders.stageContext(QUALIFIANT, {
            levelCode: '2BAC',
            streamCode: '2BACSMA',
            subjectCode: 'MATH',
            ruleSet: collegialOnly
        })
    );
    assertFailClosed(resolution, 'cross-stage leak');
    assert.strictEqual(resolution.code, 'MISSING_RULE');
    console.log('  [ok] collegial-only rows never serve qualifiant context');
}

// 7. Cross-cycle wildcard regression: a cycle_code '*' row must NEVER match
//    (Slice-2 removal; resolver contract is same-cycle only).
{
    const starPayload = builders.ruleSetPayload({
        coefficients: [
            builders.coefficientRow({
                cycle_code: '*',
                level_code: '*',
                stream_code: '*',
                subject_code: 'MATH',
                coefficient: 9
            })
        ],
        examCounts: [
            builders.examCountRow({
                cycle_code: '*',
                level_code: '*',
                subject_code: 'MATH',
                exam_count: 9
            })
        ],
        weights: [
            builders.weightRow({
                cycle_code: '*',
                subject_code: 'MATH',
                exam_weight_bps: 10000,
                activity_weight_bps: 0
            })
        ]
    });
    const starCc = builders.loadCcRules(starPayload);
    const context = builders.stageContext(QUALIFIANT, {
        levelCode: '2BAC',
        streamCode: '2BACSMA',
        subjectCode: 'MATH',
        ruleSet: starPayload
    });
    const coefficient = starCc.resolveSubjectCoefficient('subject', '2BACSMA', context);
    assertFailClosed(coefficient, "cycle-'*' coefficient row");
    assert.strictEqual(coefficient.code, 'MISSING_RULE');
    const examCount = starCc.resolveExamCount('subject', '2BACSMA', context);
    assertFailClosed(examCount, "cycle-'*' exam-count row");
    assert.strictEqual(examCount.code, 'MISSING_RULE');
    const weights = starCc.resolveSubjectWeights('subject', context);
    assert.strictEqual(weights.ok, false);
    assert.strictEqual(weights.code, 'MISSING_RULE');
    console.log("  [ok] cycle-'*' rows never match (coefficient/exam-count/weight)");
}

console.log('[pass] qualifiant missing-rule fail-closed');
