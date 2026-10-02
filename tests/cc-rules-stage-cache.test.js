'use strict';

/**
 * Stage rule-set cache isolation tests (Slice 2 business rules).
 *
 *   node tests/cc-rules-stage-cache.test.js
 *
 * The renderer rule-set cache is keyed by (schoolYear, cycleCode): a stage
 * switch must never serve the previous stage's rules. The switch path calls
 * clearStageRuleSetCache() defensively; even without that call, a cached
 * payload loaded for one cycle is never served to another cycle's context —
 * resolution fails closed with RULES_UNAVAILABLE instead.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const StageRulesErrorContract = require('../js/shared/errors/stage-rules-error-contract');
const { COLLEGIAL_CYCLE, QUALIFIANT_CYCLE } = require('../js/shared/education/cycles');

const SCHOOL_YEAR = '2025/2026';

function ruleSetPayload() {
    return {
        ruleSet: {
            id: 1,
            school_year: SCHOOL_YEAR,
            revision: 2,
            status: 'active',
            created_by: 'admin',
            reason: 'cache fixture',
            created_at: '2026-08-01 00:00:00'
        },
        rows: {
            coefficients: [
                {
                    cycle_code: QUALIFIANT_CYCLE,
                    level_code: '2BAC',
                    stream_code: '2BACSMA',
                    subject_code: 'MATH',
                    coefficient: 9,
                    source: 'official'
                }
            ],
            examCounts: [],
            weights: []
        }
    };
}

function loadCcRules(getActive) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'cc-rules.js'), 'utf8');
    const sandbox = { console, StageRulesErrorContract };
    sandbox.window = { api: { stageRules: { getActive } } };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox;
}

function qualifiantContext() {
    return {
        cycleCode: QUALIFIANT_CYCLE,
        cycleLabel: 'الثانوي التأهيلي',
        levelCode: '2BAC',
        levelLabel: 'السنة الثانية بكالوريا',
        streamCode: '2BACSMA',
        streamLabel: 'علوم رياضية أ',
        schoolYear: SCHOOL_YEAR
    };
}

function collegialContext() {
    return {
        cycleCode: COLLEGIAL_CYCLE,
        cycleLabel: 'الثانوي الإعدادي',
        levelCode: '1APIC',
        levelLabel: 'الأولى إعدادي مسار دولي',
        streamCode: '*',
        streamLabel: '*',
        schoolYear: SCHOOL_YEAR
    };
}

async function main() {
    console.log('[test] cc-rules stage cache isolation');

    // Same (schoolYear, cycleCode) loads once; a different cycle reloads so a
    // stage switch can never keep serving the previous stage's revision.
    {
        let calls = 0;
        const cc = loadCcRules(async () => {
            calls += 1;
            return ruleSetPayload();
        });
        const first = await cc.ensureStageRuleSet(SCHOOL_YEAR, QUALIFIANT_CYCLE);
        const second = await cc.ensureStageRuleSet(SCHOOL_YEAR, QUALIFIANT_CYCLE);
        assert.strictEqual(first, second);
        assert.strictEqual(first.cycleCode, QUALIFIANT_CYCLE);
        assert.strictEqual(calls, 1);
        const third = await cc.ensureStageRuleSet(SCHOOL_YEAR, COLLEGIAL_CYCLE);
        assert.strictEqual(third.cycleCode, COLLEGIAL_CYCLE);
        assert.strictEqual(calls, 2);
        console.log('  [ok] cache is keyed by (schoolYear, cycleCode)');
    }

    // Legacy single-argument loads keep working (pages migrate incrementally);
    // an unkeyed payload still resolves explicit-cycle contexts.
    {
        let calls = 0;
        const cc = loadCcRules(async () => {
            calls += 1;
            return ruleSetPayload();
        });
        const loaded = await cc.ensureStageRuleSet(SCHOOL_YEAR);
        assert.strictEqual(loaded.schoolYear, SCHOOL_YEAR);
        assert.strictEqual(calls, 1);
        const res = cc.resolveSubjectCoefficient('الرياضيات', '2BACSMA', qualifiantContext());
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.coefficient, 9);
        console.log('  [ok] legacy single-argument load still resolves explicit-cycle contexts');
    }

    // A payload cached for one cycle is never served to another cycle's
    // context: resolution fails closed instead of cross-resolving.
    {
        const cc = loadCcRules(async () => ruleSetPayload());
        await cc.ensureStageRuleSet(SCHOOL_YEAR, QUALIFIANT_CYCLE);
        const cross = cc.resolveSubjectCoefficient('الرياضيات', null, collegialContext());
        assert.strictEqual(cross.ok, false);
        assert.strictEqual(cross.code, 'RULES_UNAVAILABLE');
        assert.strictEqual(StageRulesErrorContract.isOfficialExportAllowed(cross), false);
        const same = cc.resolveSubjectCoefficient('الرياضيات', '2BACSMA', qualifiantContext());
        assert.strictEqual(same.ok, true);
        assert.strictEqual(same.coefficient, 9);
        console.log('  [ok] cross-cycle cache reads fail closed with RULES_UNAVAILABLE');
    }

    // The stage switch path clears the cache defensively: after the clear,
    // nothing resolves until the new stage's payload is loaded.
    {
        let calls = 0;
        const cc = loadCcRules(async () => {
            calls += 1;
            return ruleSetPayload();
        });
        assert.strictEqual(typeof cc.clearStageRuleSetCache, 'function');
        await cc.ensureStageRuleSet(SCHOOL_YEAR, QUALIFIANT_CYCLE);
        cc.clearStageRuleSetCache();
        const after = cc.resolveSubjectCoefficient('الرياضيات', '2BACSMA', qualifiantContext());
        assert.strictEqual(after.ok, false);
        assert.strictEqual(after.code, 'RULES_UNAVAILABLE');
        await cc.ensureStageRuleSet(SCHOOL_YEAR, COLLEGIAL_CYCLE);
        assert.strictEqual(calls, 2);
        console.log('  [ok] clearStageRuleSetCache() invalidates cache and load promise');
    }

    // Year isolation is unchanged: a cached year is never served to another year.
    {
        const cc = loadCcRules(async () => ruleSetPayload());
        await cc.ensureStageRuleSet(SCHOOL_YEAR, QUALIFIANT_CYCLE);
        const otherYear = Object.assign(qualifiantContext(), { schoolYear: '2026/2027' });
        const missing = cc.resolveSubjectCoefficient('الرياضيات', '2BACSMA', otherYear);
        assert.strictEqual(missing.ok, false);
        assert.strictEqual(missing.code, 'RULES_UNAVAILABLE');
        console.log('  [ok] cache never reused across school years');
    }

    // An explicitly injected ruleSet still wins over the cache.
    {
        const cc = loadCcRules(async () => ruleSetPayload());
        await cc.ensureStageRuleSet(SCHOOL_YEAR, QUALIFIANT_CYCLE);
        const injected = ruleSetPayload();
        injected.rows.coefficients[0].coefficient = 3;
        const res = cc.resolveSubjectCoefficient(
            'الرياضيات',
            '2BACSMA',
            Object.assign(qualifiantContext(), { ruleSet: injected })
        );
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.coefficient, 3);
        console.log('  [ok] explicit context.ruleSet wins over the cache');
    }

    console.log('[test] cc-rules stage cache isolation: all checks passed');
}

main().catch((err) => {
    console.error('FAIL: cc-rules stage cache isolation — ' + (err && err.message ? err.message : err));
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
});
