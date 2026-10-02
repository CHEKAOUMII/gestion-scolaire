'use strict';

/**
 * getSubjectWeights() provisional marking (Slice 2 compat, merge follow-up).
 *
 *   node tests/cc-rules-weights-provisional.test.js
 *
 * getSubjectWeights() is a legacy display shim over resolveSubjectWeights().
 * Rule hits return authoritative weights; the constant fallback for unseeded
 * subjects or missing rule sets is explicitly provisional
 * (isAuthoritative: false, provisional: true, failure code) so no caller
 * mistakes it for a resolved rule. Authoritative paths must call
 * resolveSubjectWeights() directly and fail closed when ok is false.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const StageRulesErrorContract = require('../js/shared/errors/stage-rules-error-contract');
const { COLLEGIAL_CYCLE } = require('../js/shared/education/cycles');

const SCHOOL_YEAR = '2025/2026';

function ruleSetPayload() {
    return {
        ruleSet: {
            id: 1,
            school_year: SCHOOL_YEAR,
            revision: 2,
            status: 'active',
            created_by: 'official-seed',
            reason: 'weights provisional fixture',
            created_at: '2026-08-01 00:00:00'
        },
        rows: {
            coefficients: [],
            examCounts: [],
            weights: [
                {
                    rule_set_id: 1,
                    cycle_code: COLLEGIAL_CYCLE,
                    subject_code: 'MATH',
                    exam_weight_bps: 10000,
                    activity_weight_bps: 0,
                    source: 'official'
                }
            ]
        }
    };
}

function loadCcRules(getActive) {
    const sandbox = { console, StageRulesErrorContract };
    sandbox.window = { api: { stageRules: { getActive } } };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'cc-rules.js'), 'utf8'), sandbox);
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'education', 'collegial-levels.js'), 'utf8'),
        sandbox
    );
    return sandbox;
}

function collegialContext(overrides) {
    return Object.assign(
        {
            cycleCode: COLLEGIAL_CYCLE,
            cycleLabel: 'الثانوي الإعدادي',
            levelCode: '1APIC',
            streamCode: '*',
            schoolYear: SCHOOL_YEAR
        },
        overrides
    );
}

async function main() {
    console.log('[test] cc-rules weights provisional marking');

    // 1. Rule hit: authoritative weights, no provisional flags.
    {
        const cc = loadCcRules(async () => ruleSetPayload());
        await cc.ensureStageRuleSet(SCHOOL_YEAR, COLLEGIAL_CYCLE);
        const weights = cc.getSubjectWeights('الرياضيات', collegialContext());
        assert.strictEqual(weights.examWeight, 1);
        assert.strictEqual(weights.activityWeight, 0);
        assert.strictEqual(weights.isAuthoritative, true);
        assert.strictEqual(weights.provisional, undefined);
        console.log('  [ok] rule hit returns authoritative weights');
    }

    // 2. Unseeded subject (collegial TECHNOLOGY): explicitly provisional with
    // the underlying MISSING_RULE code; legacy numbers stay for display only.
    {
        const cc = loadCcRules(async () => ruleSetPayload());
        await cc.ensureStageRuleSet(SCHOOL_YEAR, COLLEGIAL_CYCLE);
        const weights = cc.getSubjectWeights('التكنولوجيا', collegialContext());
        assert.strictEqual(weights.isAuthoritative, false);
        assert.strictEqual(weights.provisional, true);
        assert.strictEqual(weights.code, 'MISSING_RULE');
        assert.ok(Number.isFinite(weights.examWeight));
        assert.ok(Number.isFinite(weights.activityWeight));
        console.log('  [ok] unseeded subject falls back provisionally with MISSING_RULE');
    }

    // 3. Missing cycle context: provisional with RULES_UNAVAILABLE, never a
    // guessed default presented as authoritative.
    {
        const cc = loadCcRules(async () => ruleSetPayload());
        await cc.ensureStageRuleSet(SCHOOL_YEAR, COLLEGIAL_CYCLE);
        const weights = cc.getSubjectWeights('الرياضيات', { schoolYear: SCHOOL_YEAR });
        assert.strictEqual(weights.isAuthoritative, false);
        assert.strictEqual(weights.provisional, true);
        assert.strictEqual(weights.code, 'RULES_UNAVAILABLE');
        console.log('  [ok] missing cycle falls back provisionally with RULES_UNAVAILABLE');
    }

    // 4. Fresh object per call: the shared legacy constant is never aliased.
    {
        const cc = loadCcRules(async () => ruleSetPayload());
        await cc.ensureStageRuleSet(SCHOOL_YEAR, COLLEGIAL_CYCLE);
        const first = cc.getSubjectWeights('التكنولوجيا', collegialContext());
        const second = cc.getSubjectWeights('التكنولوجيا', collegialContext());
        assert.notStrictEqual(first, second);
        first.examWeight = -1;
        assert.notStrictEqual(second.examWeight, -1);
        console.log('  [ok] fallback returns a fresh object per call');
    }

    console.log('[test] cc-rules weights provisional marking: all checks passed');
}

main().catch((err) => {
    console.error('FAIL: cc-rules weights provisional marking — ' + (err && err.message ? err.message : err));
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
});
