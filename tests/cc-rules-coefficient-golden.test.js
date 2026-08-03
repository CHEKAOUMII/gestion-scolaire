'use strict';

/**
 * Golden tests for qualifying-cycle subject coefficients.
 *
 *   node tests/cc-rules-coefficient-golden.test.js
 *
 * Exact and canonical qualifying lookups remain stable against the ACTIVE
 * rule set of the school year (stage-rules management, 029). Missing rules
 * are deliberately errors: an unknown subject must never inherit a nearby
 * coefficient or silently enter a general average with coefficient 1.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const StageRulesErrorContract = require('../js/shared/errors/stage-rules-error-contract');

function ruleRow(overrides) {
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

function ruleSetPayload(coefficientRows) {
    return {
        ruleSet: {
            id: 1,
            school_year: '2025/2026',
            revision: 2,
            status: 'active',
            created_by: 'admin',
            reason: 'golden fixture',
            created_at: '2026-08-01 00:00:00'
        },
        rows: { coefficients: coefficientRows || [], examCounts: [] }
    };
}

// Official rows mirroring the historical branch table for the subjects the
// golden contract pins (secondary_qualifiant / 2BAC).
const GOLDEN_ROWS = [
    ruleRow({ stream_code: '2BACSMA', subject_code: 'MATH', coefficient: 9 }),
    ruleRow({ stream_code: '2BACSMA', subject_code: 'PHYSICS_CHEMISTRY', coefficient: 7 }),
    ruleRow({ stream_code: '2BACSVT', subject_code: 'EARTH_SCIENCES', coefficient: 9 }),
    ruleRow({ stream_code: '2BACSVT', subject_code: 'MATH', coefficient: 5 }),
    ruleRow({ stream_code: '2BACSP', subject_code: 'PHYSICAL_EDUCATION', coefficient: 4 })
];

function loadCcRules(getActive) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'cc-rules.js'), 'utf8');
    const sandbox = { console, StageRulesErrorContract };
    sandbox.window = { api: { stageRules: { getActive } } };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox;
}

async function loadWith(rows) {
    const cc = loadCcRules(async () => ruleSetPayload(rows));
    await cc.ensureStageRuleSet('2025/2026');
    return cc;
}

async function main() {
    const cc = await loadWith(GOLDEN_ROWS);
    const coefficient = (subject, branch, context) => cc.getSubjectCoefficient(subject, branch, context);

    function expectMissingCoefficient(subject, branch, context) {
        let capturedError;
        assert.throws(
            () => coefficient(subject, branch, context),
            (error) => {
                capturedError = error;
                assert.strictEqual(error.code, 'MISSING_RULE');
                assert.strictEqual(error.name, 'MissingStageRuleError');
                assert.strictEqual(error.retryable, false);
                assert.strictEqual(error.missingCoefficient, true);
                return true;
            }
        );
        return capturedError;
    }

    console.log('[test] cc-rules coefficient contract');

    // Exact branch/subject coefficients are the qualifying behavior being preserved.
    [
        ['الرياضيات', '2BACSMA', 9],
        ['الفيزياء والكيمياء', '2BACSMA', 7],
        ['علوم الحياة والأرض', '2BACSVT', 9],
        ['الرياضيات', '2BACSVT', 5],
        ['التربية البدنية', '2BACSP', 4]
    ].forEach(([subject, branch, expected]) => {
        assert.strictEqual(coefficient(subject, branch), expected);
    });
    console.log('  [ok] exact branch/subject coefficients');

    // Canonical Arabic normalization still resolves to the declared coefficient.
    assert.strictEqual(coefficient('التربيه البدنيه', '2BACSP'), 4);
    assert.strictEqual(coefficient('  الرياضيات  ', '2BACSMA'), 9);
    console.log('  [ok] canonical Arabic normalization');

    const context = {
        cycleCode: 'secondary_qualifiant',
        cycleLabel: 'الثانوي التأهيلي',
        levelCode: '2BAC',
        levelLabel: 'السنة الثانية بكالوريا',
        streamCode: '2BACSMA',
        streamLabel: 'علوم رياضية أ',
        schoolYear: '2025/2026'
    };

    // Missing context is structured and Arabic-ready instead of falling back to 1.
    const missingError = expectMissingCoefficient('مادة مجهولة', '2BACSMA', context);
    assert.deepEqual(missingError.details, {
        cycleCode: 'secondary_qualifiant',
        cycleLabel: 'الثانوي التأهيلي',
        levelCode: '2BAC',
        levelLabel: 'السنة الثانية بكالوريا',
        streamCode: '2BACSMA',
        streamLabel: 'علوم رياضية أ',
        subject: 'مادة مجهولة',
        normalizedSubject: 'مادة مجهولة',
        schoolYear: '2025/2026',
        subjectCode: null
    });
    assert.ok(missingError.userMessage.includes('الثانوي التأهيلي'));
    assert.ok(missingError.userMessage.includes('السنة الثانية بكالوريا'));
    assert.ok(missingError.userMessage.includes('علوم رياضية أ'));
    assert.ok(missingError.userMessage.includes('مادة مجهولة'));
    assert.ok(missingError.userMessage.includes('2025/2026'));
    console.log('  [ok] structured missing-rule context and Arabic message');

    // These were the production hazards: neither substring can borrow
    // mathematics' 9, and a known subject cannot be matched without the
    // cycle/level/stream context of a rule row.
    expectMissingCoefficient('الرياضيات التطبيقية', '2BACSMA', context);
    expectMissingCoefficient('ا', '2BACSMA', context);
    expectMissingCoefficient('الرياضيات', null, { schoolYear: '2025/2026' });
    console.log('  [ok] no bidirectional substring or silent branch fallback');

    // The context is authoritative: a full context resolves even when the
    // branch string is unknown (branch is only the legacy fallback).
    assert.strictEqual(coefficient('الرياضيات', 'NOT_A_BRANCH', context), 9);
    console.log('  [ok] full context resolves regardless of the branch string');

    const missingResult = cc.resolveSubjectCoefficient('الرياضيات التطبيقية', '2BACSMA', context);
    assert.strictEqual(missingResult.ok, false);
    assert.strictEqual(missingResult.success, false);
    assert.strictEqual(missingResult.code, 'MISSING_RULE');
    assert.strictEqual(missingResult.error.details.subject, 'الرياضيات التطبيقية');

    const averageResult = cc.computeWeightedGeneralAverageResult(
        [
            { subject: 'الرياضيات', avg: 16 },
            { subject: 'مادة مجهولة', avg: 4 }
        ],
        '2BACSMA',
        context
    );
    assert.strictEqual(averageResult.ok, false);
    assert.strictEqual(averageResult.missingCoefficients.length, 1);
    assert.strictEqual(averageResult.missingCoefficients[0].subject, 'مادة مجهولة');
    assert.strictEqual(averageResult.incomplete, true);
    assert.strictEqual(averageResult.metadata.status, 'incomplete');
    assert.strictEqual(averageResult.metadata.officialExportBlocked, true);
    assert.strictEqual(StageRulesErrorContract.isOfficialExportAllowed(averageResult), false);
    assert.throws(
        () =>
            cc.computeWeightedGeneralAverage(
                [
                    { subject: 'الرياضيات', avg: 16 },
                    { subject: 'مادة مجهولة', avg: 4 }
                ],
                '2BACSMA',
                context
            ),
        (error) => error.code === 'MISSING_RULE'
    );
    assert.strictEqual(cc.computeWeightedGeneralAverage([{ subject: 'الرياضيات', avg: 16 }], '2BACSMA', context), 16);
    console.log('  [ok] general averages refuse missing rules and block official export');

    // Custom rows beat official rows within the same key and never cross cycles.
    const customCc = await loadWith(
        GOLDEN_ROWS.concat([ruleRow({ stream_code: '2BACSMA', subject_code: 'MATH', coefficient: 3, source: 'custom' })])
    );
    const overrideResolution = customCc.resolveSubjectCoefficient('الرياضيات', '2BACSMA', context);
    assert.strictEqual(overrideResolution.ok, true);
    assert.strictEqual(overrideResolution.coefficient, 3);
    assert.strictEqual(overrideResolution.source, 'admin_override');
    assert.strictEqual(
        customCc.resolveSubjectCoefficient('الرياضيات', '2BACSMA', {
            cycleCode: 'secondary_collegial',
            streamCode: '2BACSMA'
        }).ok,
        false
    );
    console.log('  [ok] custom rule beats official on the same key and never crosses cycles');

    // No qualifying rule is applied when an explicit junior-secondary context is supplied.
    const collegialResult = cc.resolveSubjectCoefficient('الرياضيات', '2BACSMA', {
        cycleCode: 'secondary_collegial',
        cycleLabel: 'الثانوي الإعدادي',
        levelCode: '3APIC',
        levelLabel: 'السنة الثالثة إعدادي',
        streamCode: '3APIC',
        streamLabel: 'الثالثة إعدادي',
        schoolYear: '2025/2026'
    });
    assert.strictEqual(collegialResult.ok, false);
    assert.strictEqual(collegialResult.error.details.cycleCode, 'secondary_collegial');
    assert.strictEqual(cc.detectBranch('غير معروف'), null);
    console.log('  [ok] junior-secondary rules remain unsupported and explicit');

    console.log('[test] cc-rules coefficient contract: all checks passed');
}

main().catch((err) => {
    console.error('FAIL: cc-rules coefficient contract — ' + (err && err.message ? err.message : err));
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
});
