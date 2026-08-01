'use strict';

/**
 * Golden tests for qualifying-cycle subject coefficients.
 *
 *   node tests/cc-rules-coefficient-golden.test.js
 *
 * Exact and canonical qualifying lookups remain stable. Missing coefficients are
 * deliberately errors: an unknown subject must never inherit a nearby coefficient
 * or silently enter a general average with coefficient 1.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SubjectCoefficientErrorContract = require('../js/shared/errors/subject-coefficient-error-contract');

function loadCcRules() {
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'cc-rules.js'), 'utf8');
    const sandbox = { console, SubjectCoefficientErrorContract };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox;
}

const cc = loadCcRules();
const coefficient = (subject, branch, context) => cc.getSubjectCoefficient(subject, branch, context);

function expectMissingCoefficient(subject, branch, context) {
    let capturedError;
    assert.throws(
        () => coefficient(subject, branch, context),
        (error) => {
            capturedError = error;
            assert.strictEqual(error.code, 'MISSING_SUBJECT_COEFFICIENT');
            assert.strictEqual(error.name, 'MissingSubjectCoefficientError');
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
assert.deepStrictEqual(missingError.details, {
    cycleCode: 'secondary_qualifiant',
    cycleLabel: 'الثانوي التأهيلي',
    levelCode: '2BAC',
    levelLabel: 'السنة الثانية بكالوريا',
    streamCode: '2BACSMA',
    streamLabel: 'علوم رياضية أ',
    subject: 'مادة مجهولة',
    normalizedSubject: 'مادة مجهولة',
    schoolYear: '2025/2026'
});
assert.ok(missingError.userMessage.includes('الثانوي التأهيلي'));
assert.ok(missingError.userMessage.includes('السنة الثانية بكالوريا'));
assert.ok(missingError.userMessage.includes('علوم رياضية أ'));
assert.ok(missingError.userMessage.includes('مادة مجهولة'));
assert.ok(missingError.userMessage.includes('2025/2026'));
console.log('  [ok] structured missing-coefficient context and Arabic message');

// These were the production hazards: neither substring can borrow mathematics' 9.
expectMissingCoefficient('الرياضيات التطبيقية', '2BACSMA', context);
expectMissingCoefficient('ا', '2BACSMA', context);
expectMissingCoefficient('الرياضيات', null, context);
expectMissingCoefficient('الرياضيات', 'NOT_A_BRANCH', context);
console.log('  [ok] no bidirectional substring or silent branch fallback');

const missingResult = cc.resolveSubjectCoefficient('الرياضيات التطبيقية', '2BACSMA', context);
assert.strictEqual(missingResult.ok, false);
assert.strictEqual(missingResult.success, false);
assert.strictEqual(missingResult.code, 'MISSING_SUBJECT_COEFFICIENT');
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
assert.strictEqual(SubjectCoefficientErrorContract.isOfficialExportAllowed(averageResult), false);
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
    (error) => error.code === 'MISSING_SUBJECT_COEFFICIENT'
);
assert.strictEqual(cc.computeWeightedGeneralAverage([{ subject: 'الرياضيات', avg: 16 }], '2BACSMA', context), 16);
console.log('  [ok] general averages refuse missing coefficients and block official export');

cc.setSubjectCoefficientOverrides([
    { cycleCode: 'secondary_qualifiant', streamCode: '2BACSMA', subject: 'مادة مجهولة', coefficient: 3 }
]);
const overrideResolution = cc.resolveSubjectCoefficient('مادة مجهولة', '2BACSMA', context);
assert.strictEqual(overrideResolution.ok, true);
assert.strictEqual(overrideResolution.coefficient, 3);
assert.strictEqual(overrideResolution.source, 'admin_override');
assert.strictEqual(cc.resolveSubjectCoefficient('مادة مجهولة', '2BACSMA', {
    cycleCode: 'secondary_collegial',
    streamCode: '2BACSMA'
}).ok, false);
cc.setSubjectCoefficientOverrides([]);
console.log('  [ok] exact qualifying override is applied and never crosses cycles');

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
