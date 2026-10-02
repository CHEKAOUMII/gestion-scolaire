'use strict';

/**
 * Qualifiant resolver golden tests (isolation plan, Slice 7 — per-stage minimum).
 *
 *   node tests/qualifiant/resolver-golden.test.js
 *
 * Pins the qualifiant official behavior through the renderer resolver with an
 * EXPLICIT stage context (never the branch-guessed default): exact
 * branch/subject coefficients, exam-count precedence, and CC subject weights.
 * Uses ONLY the shared builders module + production code — never collegial fixtures.
 */

const assert = require('assert');
const builders = require('../stage-isolation-builders');
const { getOfficialCoefficientRows } = require('../../main/db/education-catalogs/qualifiant-coefficients');
const { getOfficialSubjectWeightRows } = require('../../main/db/education-catalogs/subject-weights');

const { QUALIFIANT } = builders;

console.log('[test] qualifiant resolver goldens (slice 7)');

const RULE_SET_ID = 1;
const payload = builders.ruleSetPayload({
    coefficients: getOfficialCoefficientRows({ ruleSetId: RULE_SET_ID }),
    examCounts: [
        builders.examCountRow({ cycle_code: QUALIFIANT, level_code: '*', subject_code: 'MATH', exam_count: 3 }),
        builders.examCountRow({ cycle_code: QUALIFIANT, level_code: '*', subject_code: 'FRENCH', exam_count: 4 }),
        builders.examCountRow({ cycle_code: QUALIFIANT, level_code: 'TC', subject_code: 'ARABIC', exam_count: 2 }),
        builders.examCountRow({ cycle_code: QUALIFIANT, level_code: '2BAC', subject_code: 'MATH', exam_count: 3 })
    ],
    weights: getOfficialSubjectWeightRows({ ruleSetId: RULE_SET_ID })
});
const cc = builders.loadCcRules(payload);

function qualifiantContext(branch, subjectCode) {
    return builders.stageContext(QUALIFIANT, {
        levelCode: /^TC/i.test(branch || '') ? 'TC' : '2BAC',
        streamCode: branch,
        subjectCode,
        ruleSet: payload
    });
}

// 1. Exact branch/subject coefficient goldens (ministry note 142 pairs).
[
    ['الرياضيات', '2BACSMA', 9],
    ['الفيزياء والكيمياء', '2BACSMA', 7],
    ['علوم الحياة والأرض', '2BACSVT', 9],
    ['الرياضيات', '2BACSVT', 5],
    ['التربية البدنية', '2BACSP', 4]
].forEach(([subject, branch, expected]) => {
    assert.strictEqual(cc.getSubjectCoefficient(subject, branch, qualifiantContext(branch)), expected);
});
console.log('  [ok] exact branch/subject coefficients');

// 2. Canonical Arabic normalization still resolves the declared coefficient.
assert.strictEqual(cc.getSubjectCoefficient('التربيه البدنيه', '2BACSP', qualifiantContext('2BACSP')), 4);
assert.strictEqual(cc.getSubjectCoefficient('  الرياضيات  ', '2BACSMA', qualifiantContext('2BACSMA')), 9);
console.log('  [ok] canonical Arabic normalization');

// 3. Exam-count precedence: exact level → level '*' (official defaults live at '*').
assert.strictEqual(
    cc.getExamCount('subject', '2BACSMA', qualifiantContext('2BACSMA', 'MATH')),
    3,
    'exact 2BAC/MATH row'
);
assert.strictEqual(
    cc.getExamCount('subject', 'TCSF', qualifiantContext('TCSF', 'MATH')),
    3,
    "level-'*' MATH default serves TC"
);
assert.strictEqual(
    cc.getExamCount('subject', 'TCSF', qualifiantContext('TCSF', 'FRENCH')),
    4,
    "level-'*' FRENCH default"
);
assert.strictEqual(
    cc.getExamCount('subject', 'TCSF', qualifiantContext('TCSF', 'ARABIC')),
    2,
    'exact TC/ARABIC row'
);
console.log('  [ok] exam-count precedence (exact → level wildcard)');

// 4. CC weight goldens (official overrides + the 75/25 default).
{
    const math = cc.resolveSubjectWeights('subject', qualifiantContext('2BACSMA', 'MATH'));
    assert.strictEqual(math.ok, true);
    assert.strictEqual(math.examWeight, 1);
    assert.strictEqual(math.activityWeight, 0);
    const french = cc.resolveSubjectWeights('subject', qualifiantContext('2BACSMA', 'FRENCH'));
    assert.strictEqual(french.examWeight, 0.8);
    assert.strictEqual(french.activityWeight, 0.2);
    const arabic = cc.resolveSubjectWeights('subject', qualifiantContext('2BACSMA', 'ARABIC'));
    assert.strictEqual(arabic.examWeight, 0.75);
    assert.strictEqual(arabic.activityWeight, 0.25);
    console.log('  [ok] subject-weight goldens');
}

// 5. Custom beats official on the same key (029 shadowing inside the stage).
{
    const customPayload = builders.ruleSetPayload({
        coefficients: [
            ...payload.rows.coefficients,
            builders.coefficientRow({
                cycle_code: QUALIFIANT,
                level_code: '2BAC',
                stream_code: '2BACSMA',
                subject_code: 'MATH',
                coefficient: 5,
                source: 'custom'
            })
        ],
        examCounts: payload.rows.examCounts,
        weights: payload.rows.weights
    });
    const customCc = builders.loadCcRules(customPayload);
    const context = builders.stageContext(QUALIFIANT, {
        levelCode: '2BAC',
        streamCode: '2BACSMA',
        subjectCode: 'MATH',
        ruleSet: customPayload
    });
    assert.strictEqual(customCc.getSubjectCoefficient('subject', '2BACSMA', context), 5);
    assert.strictEqual(cc.getSubjectCoefficient('الرياضيات', '2BACSMA', qualifiantContext('2BACSMA')), 9);
    console.log('  [ok] custom shadows official on the same key');
}

// 6. Weighted-average smoke over the golden pairs.
{
    const value = cc.computeWeightedGeneralAverage(
        [
            { subject: 'الرياضيات', avg: 10 },
            { subject: 'الفيزياء والكيمياء', avg: 20 }
        ],
        '2BACSMA',
        qualifiantContext('2BACSMA')
    );
    assert.strictEqual(value, (10 * 9 + 20 * 7) / (9 + 7));
    console.log('  [ok] weighted general average over goldens');
}

// 7. Stage policy derivation (Slice-2 STAGE_GRADING_POLICIES): a qualifiant
//    partial context derives the level from the branch and keeps the branch
//    as the stream — no explicit level/stream needed.
{
    const partial = builders.stageContext(QUALIFIANT, { ruleSet: payload });
    assert.strictEqual(cc.getSubjectCoefficient('الرياضيات', '2BACSMA', partial), 9);
    assert.strictEqual(cc.getSubjectCoefficient('علوم الحياة والأرض', '2BACSVT', partial), 9);
    console.log('  [ok] qualifiant policy derivation (branch → level/stream)');
}

console.log('[pass] qualifiant resolver goldens');
