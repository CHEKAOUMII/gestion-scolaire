'use strict';

/**
 * Collegial missing-rule fail-closed tests (isolation plan, Slice 7).
 *
 *   node tests/collegial/missing-rule-fail-closed.test.js
 *
 * Genuinely unseeded collegial inputs fail closed (MISSING_RULE /
 * RULES_UNAVAILABLE with official export blocked) — never with qualifiant
 * constants. Uses ONLY the shared builders module + production code.
 */

const assert = require('assert');
const builders = require('../stage-isolation-builders');
const StageRulesErrorContract = require('../../js/shared/errors/stage-rules-error-contract');
const {
    getOfficialCollegialCoefficientRows,
    getOfficialCollegialExamCountRows,
    getOfficialCollegialWeightRows
} = require('../../main/db/education-catalogs/collegial-rules');

const { COLLEGIAL, QUALIFIANT } = builders;

console.log('[test] collegial missing-rule fail-closed (slice 7)');

const RULE_SET_ID = 1;
const payload = builders.ruleSetPayload({
    coefficients: getOfficialCollegialCoefficientRows({ ruleSetId: RULE_SET_ID }),
    examCounts: getOfficialCollegialExamCountRows({ ruleSetId: RULE_SET_ID }),
    weights: getOfficialCollegialWeightRows({ ruleSetId: RULE_SET_ID })
});
const cc = builders.loadCcRules(payload);

function collegialContext(levelCode, subjectCode, extra) {
    return builders.stageContext(
        COLLEGIAL,
        Object.assign({ levelCode, streamCode: '*', subjectCode, ruleSet: payload }, extra)
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

// 1. TECHNOLOGY weights are unseeded by design (no measured ratio) → MISSING_RULE.
{
    const resolution = cc.resolveSubjectWeights('subject', collegialContext('2APIC', 'TECHNOLOGY'));
    assert.strictEqual(resolution.ok, false);
    assert.strictEqual(resolution.code, 'MISSING_RULE');
    console.log('  [ok] TECHNOLOGY weights → MISSING_RULE');
}

// 2. Unknown subject code → MISSING_RULE (never a nearby coefficient).
{
    const resolution = cc.resolveSubjectCoefficient('subject', null, collegialContext('1APIC', 'NOPE_SUBJECT_X'));
    assertFailClosed(resolution, 'unknown subject');
    assert.strictEqual(resolution.code, 'MISSING_RULE');
    assert.strictEqual(resolution.error.name, 'MissingStageRuleError');
    builders.throwsCode(() => cc.getSubjectCoefficient('subject', null, collegialContext('1APIC', 'NOPE_SUBJECT_X')), 'MISSING_RULE');
    console.log('  [ok] unknown subject → MISSING_RULE (throw + result)');
}

// 3. Missing exam-count row (TECHNOLOGY in 1APIC) → MISSING_RULE.
{
    const resolution = cc.resolveExamCount('subject', null, collegialContext('1APIC', 'TECHNOLOGY'));
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
    const context = builders.stageContext(COLLEGIAL, {
        levelCode: '1APIC',
        streamCode: '*',
        subjectCode: 'MATH',
        ruleSet: noSetPayload
    });
    const resolution = noSetCc.resolveSubjectCoefficient('subject', null, context);
    assertFailClosed(resolution, 'missing rule set');
    assert.strictEqual(resolution.code, 'RULES_UNAVAILABLE');
    assert.strictEqual(resolution.error.name, 'StageRulesUnavailableError');
    console.log('  [ok] missing rule set → RULES_UNAVAILABLE');
}

// 5. Missing cycle context fails closed with RULES_UNAVAILABLE on every
//    authoritative path — never a qualifiant default (S1 G3 rule, Slice 2
//    fallback removal).
{
    const weights = cc.resolveSubjectWeights('subject', {
        levelCode: '1APIC',
        subjectCode: 'MATH',
        schoolYear: builders.YEAR,
        ruleSet: payload
    });
    assert.strictEqual(weights.ok, false);
    assert.strictEqual(weights.code, 'RULES_UNAVAILABLE');

    const coefficient = cc.resolveSubjectCoefficient('subject', null, {
        levelCode: '1APIC',
        streamCode: '*',
        subjectCode: 'MATH',
        schoolYear: builders.YEAR,
        ruleSet: payload
    });
    assertFailClosed(coefficient, 'missing cycle context');
    assert.strictEqual(coefficient.code, 'RULES_UNAVAILABLE');
    assert.strictEqual(coefficient.error.name, 'StageRulesUnavailableError');
    console.log('  [ok] missing cycle context → RULES_UNAVAILABLE (all paths)');
}

// 6. Cross-stage exact rows never leak: a qualifiant-only payload cannot serve
//    a collegial context (and vice versa is pinned by the qualifiant suite).
{
    const qualifiantOnly = builders.ruleSetPayload({
        coefficients: [
            builders.coefficientRow({
                cycle_code: QUALIFIANT,
                level_code: '2BAC',
                stream_code: '2BACSMA',
                subject_code: 'MATH',
                coefficient: 9
            })
        ]
    });
    const leakCc = builders.loadCcRules(qualifiantOnly);
    const resolution = leakCc.resolveSubjectCoefficient(
        'subject',
        null,
        builders.stageContext(COLLEGIAL, {
            levelCode: '1APIC',
            streamCode: '*',
            subjectCode: 'MATH',
            ruleSet: qualifiantOnly
        })
    );
    assertFailClosed(resolution, 'cross-stage leak');
    assert.strictEqual(resolution.code, 'MISSING_RULE');
    console.log('  [ok] qualifiant-only rows never serve collegial context');
}

// 7. Cross-cycle wildcard regression: a cycle_code '*' row must NEVER match
//    (Slice-2 removal; resolver contract is 4 steps, same-cycle only).
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
    const context = builders.stageContext(COLLEGIAL, {
        levelCode: '1APIC',
        streamCode: '*',
        subjectCode: 'MATH',
        ruleSet: starPayload
    });
    const coefficient = starCc.resolveSubjectCoefficient('subject', null, context);
    assertFailClosed(coefficient, "cycle-'*' coefficient row");
    assert.strictEqual(coefficient.code, 'MISSING_RULE');
    const examCount = starCc.resolveExamCount('subject', null, context);
    assertFailClosed(examCount, "cycle-'*' exam-count row");
    assert.strictEqual(examCount.code, 'MISSING_RULE');
    const weights = starCc.resolveSubjectWeights('subject', context);
    assert.strictEqual(weights.ok, false);
    assert.strictEqual(weights.code, 'MISSING_RULE');
    console.log("  [ok] cycle-'*' rows never match (coefficient/exam-count/weight)");
}

console.log('[pass] collegial missing-rule fail-closed');
