'use strict';

/**
 * Resolver tests for stage rules (029-stage-rules-management, US-2).
 *
 *   node tests/stage-rules-resolver.test.js
 *
 * Rules govern grade results; missing rules never silently change grades.
 * Resolution precedence against the ACTIVE rule set of the school year:
 *   exact (cycle, level, stream, subject) → stream wildcard → level wildcard
 *   → cycle default → MISSING_RULE. Custom beats official within the same key.
 * No silent fallback to hardcoded constants at any point.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const StageRulesErrorContract = require('../js/shared/errors/stage-rules-error-contract');

function loadCcRules(getActive) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'cc-rules.js'), 'utf8');
    const sandbox = { console, StageRulesErrorContract };
    sandbox.window = { api: { stageRules: { getActive } } };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox;
}

function coefficientRow(overrides) {
    return Object.assign(
        {
            cycle_code: 'secondary_qualifiant',
            level_code: '2BAC',
            stream_code: '2BACSMA',
            subject_code: 'MATH',
            coefficient: 9,
            source: 'official',
            updated_by: null,
            reason: null,
            updated_at: '2026-08-01 00:00:00'
        },
        overrides
    );
}

function examCountRow(overrides) {
    return Object.assign(
        {
            cycle_code: 'secondary_qualifiant',
            level_code: '2BAC',
            subject_code: 'MATH',
            exam_count: 3,
            source: 'official'
        },
        overrides
    );
}

function weightRow(overrides) {
    return Object.assign(
        {
            cycle_code: 'secondary_qualifiant',
            subject_code: 'MATH',
            exam_weight_bps: 10000,
            activity_weight_bps: 0,
            source: 'official'
        },
        overrides
    );
}

function ruleSetPayload(coefficientRows, examCountRows, weightRows) {
    return {
        ruleSet: {
            id: 1,
            school_year: '2025/2026',
            revision: 3,
            status: 'active',
            created_by: 'admin',
            reason: 'fixture',
            created_at: '2026-08-01 00:00:00'
        },
        rows: {
            coefficients: coefficientRows || [],
            examCounts: examCountRows || [],
            weights: weightRows || []
        }
    };
}

const BASE_CONTEXT = {
    cycleCode: 'secondary_qualifiant',
    cycleLabel: 'الثانوي التأهيلي',
    levelCode: '2BAC',
    levelLabel: 'السنة الثانية بكالوريا',
    streamCode: '2BACSMA',
    streamLabel: 'علوم رياضية أ',
    schoolYear: '2025/2026'
};

const NO_ACTIVE_RULE_SET = { ruleSet: null, rows: { coefficients: [], examCounts: [] } };

async function sandboxWith(payload) {
    const cc = loadCcRules(async () => payload);
    const loaded = await cc.ensureStageRuleSet('2025/2026');
    return { cc, loaded };
}

console.log('[test] stage-rules resolver — precedence and no-silent-fallback');

async function main() {
    // ═══════════════════════════════════════════════════════════════════
    // 1. Precedence steps: exact → stream wildcard → level wildcard →
    //    cycle default. Each step verified with its own fixture.
    // ═══════════════════════════════════════════════════════════════════
    {
        const allSteps = [
            coefficientRow({ coefficient: 9 }), // exact (2BAC, 2BACSMA)
            coefficientRow({ stream_code: '*', coefficient: 8 }), // stream wildcard
            coefficientRow({ level_code: '*', coefficient: 7 }), // (cycle, *, stream)
            coefficientRow({ level_code: '*', stream_code: '*', coefficient: 6 }), // (cycle, *, *)
            coefficientRow({ cycle_code: '*', level_code: '*', stream_code: '*', coefficient: 5 }) // cycle default
        ];
        const { cc } = await sandboxWith(ruleSetPayload(allSteps));
        const context = Object.assign({}, BASE_CONTEXT);
        assert.strictEqual(cc.resolveSubjectCoefficient('الرياضيات', '2BACSMA', context).coefficient, 9);
        assert.strictEqual(cc.resolveSubjectCoefficient('الرياضيات', '2BACSMA', context).source, 'rule');
        console.log('  [ok] exact step beats every wildcard step');
    }
    {
        const { cc } = await sandboxWith(
            ruleSetPayload([coefficientRow({ stream_code: '*', coefficient: 8 })])
        );
        const res = cc.resolveSubjectCoefficient('الرياضيات', '2BACSMA', BASE_CONTEXT);
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.coefficient, 8);
        console.log('  [ok] stream wildcard (cycle, level, *, subject)');
    }
    {
        const { cc } = await sandboxWith(
            ruleSetPayload([coefficientRow({ level_code: '*', coefficient: 7 })])
        );
        const res = cc.resolveSubjectCoefficient('الرياضيات', '2BACSMA', BASE_CONTEXT);
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.coefficient, 7);
        console.log('  [ok] level wildcard with stream (cycle, *, stream, subject)');
    }
    {
        const { cc } = await sandboxWith(
            ruleSetPayload([coefficientRow({ level_code: '*', stream_code: '*', coefficient: 6 })])
        );
        const res = cc.resolveSubjectCoefficient('الرياضيات', '2BACSMA', BASE_CONTEXT);
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.coefficient, 6);
        console.log('  [ok] level wildcard all-streams (cycle, *, *, subject)');
    }
    {
        const { cc } = await sandboxWith(
            ruleSetPayload([coefficientRow({ cycle_code: '*', level_code: '*', stream_code: '*', coefficient: 5 })])
        );
        const res = cc.resolveSubjectCoefficient('الرياضيات', '2BACSMA', BASE_CONTEXT);
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.coefficient, 5);
        console.log('  [ok] cycle default (*, *, *, subject)');
    }
    {
        // Level-wildcard-with-stream must beat level-wildcard-all-streams.
        const { cc } = await sandboxWith(
            ruleSetPayload([
                coefficientRow({ level_code: '*', coefficient: 7 }),
                coefficientRow({ level_code: '*', stream_code: '*', coefficient: 6 })
            ])
        );
        assert.strictEqual(cc.resolveSubjectCoefficient('الرياضيات', '2BACSMA', BASE_CONTEXT).coefficient, 7);
        console.log('  [ok] (cycle, *, stream) beats (cycle, *, *)');
    }

    // ═══════════════════════════════════════════════════════════════════
    // 2. Custom beats official within the same key; key precedence first.
    // ═══════════════════════════════════════════════════════════════════
    {
        const { cc } = await sandboxWith(
            ruleSetPayload([
                coefficientRow({ coefficient: 9, source: 'official' }),
                coefficientRow({ coefficient: 4, source: 'custom' })
            ])
        );
        const res = cc.resolveSubjectCoefficient('الرياضيات', '2BACSMA', BASE_CONTEXT);
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.coefficient, 4);
        assert.strictEqual(res.source, 'admin_override');
        console.log('  [ok] custom beats official within the same key');
    }
    {
        // A custom row at a LESS specific key must NOT beat an official row at
        // the exact key: precedence is key-first, source-second.
        const { cc } = await sandboxWith(
            ruleSetPayload([
                coefficientRow({ coefficient: 9, source: 'official' }),
                coefficientRow({ stream_code: '*', coefficient: 2, source: 'custom' })
            ])
        );
        const res = cc.resolveSubjectCoefficient('الرياضيات', '2BACSMA', BASE_CONTEXT);
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.coefficient, 9);
        assert.strictEqual(res.source, 'rule');
        console.log('  [ok] exact official beats stream-wildcard custom');
    }

    // ═══════════════════════════════════════════════════════════════════
    // 3. Missing at all steps → MISSING_RULE domain error, incomplete,
    //    official export blocked. No fallback to constants.
    // ═══════════════════════════════════════════════════════════════════
    {
        const { cc } = await sandboxWith(
            ruleSetPayload([coefficientRow({ subject_code: 'PHYSICS_CHEMISTRY' })])
        );
        const context = Object.assign({}, BASE_CONTEXT);
        const missing = cc.resolveSubjectCoefficient('الرياضيات', '2BACSMA', context);
        assert.strictEqual(missing.ok, false);
        assert.strictEqual(missing.success, false);
        assert.strictEqual(missing.incomplete, true);
        assert.strictEqual(missing.code, 'MISSING_RULE');
        assert.strictEqual(missing.error.code, 'MISSING_RULE');
        assert.strictEqual(missing.error.name, 'MissingStageRuleError');
        assert.strictEqual(missing.error.missingCoefficient, true);
        assert.strictEqual(missing.error.retryable, false);
        assert.strictEqual(missing.error.classification, 'domain');
        assert.strictEqual(missing.error.details.subjectCode, 'MATH');
        assert.strictEqual(missing.error.details.subject, 'الرياضيات');
        assert.ok(missing.error.userMessage.includes('الرياضيات'));
        assert.strictEqual(StageRulesErrorContract.isOfficialExportAllowed(missing), false);

        // Unknown subject names cannot resolve to a code → still MISSING_RULE.
        const unknown = cc.resolveSubjectCoefficient('مادة مجهولة', '2BACSMA', context);
        assert.strictEqual(unknown.ok, false);
        assert.strictEqual(unknown.code, 'MISSING_RULE');
        assert.strictEqual(unknown.error.details.subjectCode, null);

        // Average-level result carries the contract metadata shape.
        const averageResult = cc.computeWeightedGeneralAverageResult(
            [
                { subject: 'الفيزياء والكيمياء', avg: 14 },
                { subject: 'مادة مجهولة', avg: 4 }
            ],
            '2BACSMA',
            context
        );
        assert.strictEqual(averageResult.ok, false);
        assert.strictEqual(averageResult.code, 'MISSING_RULE');
        assert.strictEqual(averageResult.incomplete, true);
        assert.strictEqual(averageResult.missingCoefficients.length, 1);
        assert.strictEqual(averageResult.metadata.status, 'incomplete');
        assert.strictEqual(averageResult.metadata.officialExportBlocked, true);
        assert.strictEqual(averageResult.metadata.code, 'MISSING_RULE');
        assert.ok(Array.isArray(averageResult.metadata.missingRules));
        assert.strictEqual(StageRulesErrorContract.isOfficialExportAllowed(averageResult), false);
        assert.throws(
            () =>
                cc.computeWeightedGeneralAverage(
                    [
                        { subject: 'الفيزياء والكيمياء', avg: 14 },
                        { subject: 'مادة مجهولة', avg: 4 }
                    ],
                    '2BACSMA',
                    context
                ),
            (error) => error.code === 'MISSING_RULE'
        );
        console.log('  [ok] missing at all steps → MISSING_RULE, export blocked, no constant fallback');
    }

    // ═══════════════════════════════════════════════════════════════════
    // 4. IPC failure / no active rule set → RULES_UNAVAILABLE,
    //    officialExportBlocked, averages stay incomplete (no constants).
    // ═══════════════════════════════════════════════════════════════════
    {
        // 4a. IPC rejects.
        const failing = loadCcRules(async () => {
            throw new Error('ipc boom');
        });
        await assert.rejects(() => failing.ensureStageRuleSet('2025/2026'));
        const missing = failing.resolveSubjectCoefficient('الرياضيات', '2BACSMA', BASE_CONTEXT);
        assert.strictEqual(missing.ok, false);
        assert.strictEqual(missing.code, 'RULES_UNAVAILABLE');
        assert.strictEqual(missing.incomplete, true);
        assert.strictEqual(missing.error.name, 'StageRulesUnavailableError');
        assert.strictEqual(StageRulesErrorContract.isOfficialExportAllowed(missing), false);

        const averageResult = failing.computeWeightedGeneralAverageResult(
            [{ subject: 'الرياضيات', avg: 16 }],
            '2BACSMA',
            BASE_CONTEXT
        );
        assert.strictEqual(averageResult.ok, false);
        assert.strictEqual(averageResult.code, 'RULES_UNAVAILABLE');
        assert.strictEqual(averageResult.incomplete, true);
        assert.strictEqual(averageResult.value, undefined);
        assert.strictEqual(averageResult.metadata.status, 'incomplete');
        assert.strictEqual(averageResult.metadata.code, 'RULES_UNAVAILABLE');
        assert.strictEqual(averageResult.metadata.officialExportBlocked, true);
        assert.strictEqual(StageRulesErrorContract.isOfficialExportAllowed(averageResult), false);
        console.log('  [ok] IPC failure → RULES_UNAVAILABLE, no fallback to constants');
    }
    {
        // 4b. No active rule set exists for the year (ruleSet: null).
        const { cc } = await sandboxWith(NO_ACTIVE_RULE_SET);
        const missing = cc.resolveSubjectCoefficient('الرياضيات', '2BACSMA', BASE_CONTEXT);
        assert.strictEqual(missing.ok, false);
        assert.strictEqual(missing.code, 'RULES_UNAVAILABLE');
        assert.strictEqual(StageRulesErrorContract.isOfficialExportAllowed(missing), false);
        console.log('  [ok] no active rule set → RULES_UNAVAILABLE');
    }
    {
        // 4c. No window.api at all (rule set never loaded).
        const bare = loadCcRules(null);
        const loaded = await bare.ensureStageRuleSet('2025/2026');
        assert.strictEqual(loaded, null);
        const missing = bare.resolveSubjectCoefficient('الرياضيات', '2BACSMA', BASE_CONTEXT);
        assert.strictEqual(missing.ok, false);
        assert.strictEqual(missing.code, 'RULES_UNAVAILABLE');
        console.log('  [ok] missing window.api → RULES_UNAVAILABLE');
    }
    {
        // 4d. Rule set loaded for another school year must not be reused.
        const { cc } = await sandboxWith(ruleSetPayload([coefficientRow({ coefficient: 9 })]));
        const otherYear = Object.assign({}, BASE_CONTEXT, { schoolYear: '2026/2027' });
        const missing = cc.resolveSubjectCoefficient('الرياضيات', '2BACSMA', otherYear);
        assert.strictEqual(missing.ok, false);
        assert.strictEqual(missing.code, 'RULES_UNAVAILABLE');
        console.log('  [ok] unloaded school year → RULES_UNAVAILABLE, cache never reused across years');
    }

    // ═══════════════════════════════════════════════════════════════════
    // 5. Exam-count lookup precedence: exact level → '*' → cycle default.
    // ═══════════════════════════════════════════════════════════════════
    {
        const { cc } = await sandboxWith(
            ruleSetPayload([], [
                examCountRow({ exam_count: 3 }), // exact (secondary_qualifiant, 2BAC)
                examCountRow({ level_code: '*', exam_count: 2 }), // level wildcard
                examCountRow({ cycle_code: '*', level_code: '*', exam_count: 2 }) // cycle default
            ])
        );
        const context = Object.assign({}, BASE_CONTEXT);
        const exact = cc.resolveExamCount('الرياضيات', '2BACSMA', context);
        assert.strictEqual(exact.ok, true);
        assert.strictEqual(exact.examCount, 3);
        assert.strictEqual(exact.source, 'rule');
        console.log('  [ok] exam count: exact level wins');
    }
    {
        const { cc } = await sandboxWith(
            ruleSetPayload([], [examCountRow({ level_code: '*', exam_count: 2 })])
        );
        const res = cc.resolveExamCount('الرياضيات', '2BACSMA', BASE_CONTEXT);
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.examCount, 2);
        console.log('  [ok] exam count: level wildcard step');
    }
    {
        const { cc } = await sandboxWith(
            ruleSetPayload([], [examCountRow({ cycle_code: '*', level_code: '*', exam_count: 2 })])
        );
        const res = cc.resolveExamCount('الرياضيات', '2BACSMA', BASE_CONTEXT);
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.examCount, 2);
        console.log('  [ok] exam count: cycle default step');
    }
    {
        const { cc } = await sandboxWith(
            ruleSetPayload([], [
                examCountRow({ exam_count: 3, source: 'official' }),
                examCountRow({ exam_count: 5, source: 'custom' })
            ])
        );
        const res = cc.resolveExamCount('الرياضيات', '2BACSMA', BASE_CONTEXT);
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.examCount, 5);
        assert.strictEqual(res.source, 'admin_override');
        console.log('  [ok] exam count: custom beats official within the same key');
    }
    {
        const { cc } = await sandboxWith(
            ruleSetPayload([], [examCountRow({ subject_code: 'PHYSICS_CHEMISTRY' })])
        );
        const missing = cc.resolveExamCount('الرياضيات', '2BACSMA', BASE_CONTEXT);
        assert.strictEqual(missing.ok, false);
        assert.strictEqual(missing.code, 'MISSING_RULE');
        assert.strictEqual(missing.incomplete, true);
        assert.strictEqual(StageRulesErrorContract.isOfficialExportAllowed(missing), false);
        console.log('  [ok] exam count: missing rule → MISSING_RULE, no default count');
    }

    // ═══════════════════════════════════════════════════════════════════
    // 6. ensureStageRuleSet caches per school year and returns the payload.
    // ═══════════════════════════════════════════════════════════════════
    {
        let calls = 0;
        const cc = loadCcRules(async () => {
            calls += 1;
            return ruleSetPayload([coefficientRow({ coefficient: 9 })]);
        });
        const first = await cc.ensureStageRuleSet('2025/2026');
        const second = await cc.ensureStageRuleSet('2025/2026');
        assert.strictEqual(first, second);
        assert.strictEqual(first.schoolYear, '2025/2026');
        assert.strictEqual(first.ruleSet.revision, 3);
        assert.strictEqual(first.rows.coefficients.length, 1);
        assert.strictEqual(calls, 1);
        console.log('  [ok] ensureStageRuleSet caches per school year');
    }

    {
        const { cc } = await sandboxWith(
            ruleSetPayload(
                [],
                [],
                [
                    weightRow({ exam_weight_bps: 7500, activity_weight_bps: 2500 }),
                    weightRow({ exam_weight_bps: 6000, activity_weight_bps: 4000, source: 'custom' })
                ]
            )
        );
        const weights = cc.getSubjectWeights('الرياضيات', BASE_CONTEXT);
        assert.strictEqual(weights.examWeight, 0.6);
        assert.strictEqual(weights.activityWeight, 0.4);
        // The cycle must be passed explicitly (S1 G3): a missing cycle fails
        // closed instead of silently resolving the qualifiant rules.
        assert.strictEqual(
            cc.computeSubjectAverage(
                'الرياضيات',
                [
                    { subject: 'الرياضيات (فرض 1)', grade: 10 },
                    { subject: 'الرياضيات (الأنشطة المندمجة)', grade: 20 }
                ],
                BASE_CONTEXT
            ),
            14
        );
        console.log('  [ok] custom subject weights override official weights');
    }

    console.log('[test] stage-rules resolver: all checks passed');
}

main().catch((err) => {
    console.error('FAIL: stage-rules resolver — ' + (err && err.message ? err.message : err));
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
});
