'use strict';

// node tests/import-center/import-row-validation.test.js

const assert = require('assert');
const RowVal = require('../../js/import-center/import-row-validation.js');
const NameResolver = require('../../js/name-resolver.js');

assert.ok(RowVal.getNameResolver() === NameResolver || typeof RowVal.getNameResolver() === 'function');
assert.deepStrictEqual(RowVal.NAME_RESOLVER_ORDER.slice(0, 6), [
    'normalize',
    'exact',
    'swapped',
    'stripped',
    'transliterated',
    'fuzzy'
]);

// Mixed validity — continues after invalid
const mixed = RowVal.validateTabularRows({
    type: 'students',
    headers: ['رمز مسار', 'الاسم', 'القسم'],
    rows: [
        ['S0001', 'A', '1BAC'],
        ['', 'B', '1BAC'], // invalid missing code
        ['S0002', 'C', '1BAC'], // still validated
        ['S0003', 'D', '1BAC']
    ],
    fileId: 'f1'
});
assert.strictEqual(mixed.validCount, 3);
assert.strictEqual(mixed.invalidCount, 1);
assert.strictEqual(mixed.rowOutcomes.length, 4);
assert.ok(mixed.rowOutcomes[1].excludedFromWrite);
assert.ok(mixed.rowOutcomes[1].diagnostics.some((d) => d.field === 'code'));
assert.ok(mixed.executable);

// Zero valid rows
const zero = RowVal.validateTabularRows({
    type: 'students',
    headers: ['رمز مسار', 'الاسم'],
    rows: [
        ['', 'x'],
        ['', 'y']
    ],
    fileId: 'z1'
});
assert.ok(zero.zeroValidRows);
assert.ok(!zero.executable);
assert.ok(zero.errors.some((e) => e.code === 'ZERO_VALID_ROWS'));

// Missing header
const noHeader = RowVal.validateTabularRows({
    type: 'grades',
    headers: ['foo', 'bar'],
    rows: [
        ['1', '2'],
        ['3', '4']
    ],
    fileId: 'h1'
});
assert.ok(noHeader.errors.some((e) => e.code === 'MISSING_CODE_HEADER'));
assert.ok(!noHeader.executable);

// NameResolver evidence
const resolved = RowVal.resolveNameWithEvidence('محمد العلوي', [{ id: 10, name: 'محمد العلوي' }], {
    fileId: 'n1',
    row: 2
});
assert.ok(resolved.resolved);
assert.strictEqual(resolved.result.matchType, 'exact');
assert.ok(resolved.evidence);

const unresolved = RowVal.resolveNameWithEvidence('اسم غير موجود نهائيا', [{ id: 1, name: 'أستاذ آخر' }], {
    fileId: 'n2',
    row: 3
});
assert.ok(!unresolved.resolved);
assert.ok(unresolved.unresolved.decisionRequired);
assert.strictEqual(unresolved.unresolved.fileId, 'n2');
assert.strictEqual(unresolved.unresolved.row, 3);

// Grades with teacher resolution
const grades = RowVal.validateTabularRows({
    type: 'grades',
    headers: ['code', 'subject', 'grade', 'teacher'],
    rows: [
        ['S1', 'Math', '15', 'Unknown Teacher XYZ'],
        ['S2', 'Math', '12', 'Demo Teacher']
    ],
    resolveTeacherNames: true,
    nameCandidates: [{ id: 1, name: 'Demo Teacher' }],
    fileId: 'g1'
});
assert.ok(grades.unresolvedNames.length >= 1);
assert.ok(grades.validCount >= 1);

// Invalid grade does not stop later rows
const grades2 = RowVal.validateTabularRows({
    type: 'grades',
    headers: ['code', 'subject', 'grade'],
    rows: [
        ['S1', 'Math', '99'], // invalid
        ['S2', 'Math', '10']
    ],
    fileId: 'g2'
});
assert.strictEqual(grades2.invalidCount, 1);
assert.strictEqual(grades2.validCount, 1);
assert.strictEqual(grades2.rowOutcomes.length, 2);

// XML
const fetOk = RowVal.validateXmlStructure({
    type: 'fet',
    xmlRoot: 'Teachers_Timetable',
    xmlElements: ['Teacher', 'Day', 'Hour'],
    fileId: 'x1'
});
assert.ok(fetOk.executable);

const fetBad = RowVal.validateXmlStructure({
    type: 'fet',
    xmlRoot: 'Unknown',
    xmlElements: [],
    fileId: 'x2'
});
assert.ok(!fetBad.executable);
assert.ok(fetBad.errors.some((e) => e.code === 'UNKNOWN_XML_ROOT'));

console.log('import-row-validation: OK');
