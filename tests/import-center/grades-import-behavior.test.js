'use strict';

const assert = require('assert');
const Parser = require('../../js/import-center/grades-import-parser.js');

const schoolYear = '2025/2026';
const students = [
    { id: 11, code: 'K141075862', section: '1BACSEF-1' },
    { id: 12, code: 'K141097404', section: '1BACSEF-1' }
];

function metadataRows() {
    return [
        ['المستوى :', 'الأولى باكالوريا علوم تجريبية', 'القسم :', '1BACSEF-1', 'الاستاذ', 'أستاذ العربية'],
        ['الدورة :', 'الدورة الأولى', 'السنة الدراسية :', schoolYear]
    ];
}

const twoRowWorkbook = [
    ...metadataRows(),
    ['رقم التلميذ', 'إسم التلميذ', 'الفرض الأول', 'الفرض الأول', 'الفرض الثاني', 'الفرض الثاني', 'الأنشطة المندمجة', 'الأنشطة المندمجة', 'Teacher Notes'],
    ['', '', 'النقطة', 'التغيب', 'النقطة', 'التغيب', 'النقطة', 'التغيب', '-'],
    ['K141075862', 'الأول', 12, null, 14, null, 16, null, 19],
    ["'k141097404", 'الأخير', 10.5, null, 13, null, 15, null, 20]
];

const parsed = Parser.parseGradesSheets({
    sheets: [{ name: 'NotesCC', rows: twoRowWorkbook }],
    sourceFileName: 'Export_10401E_1BACSEF-1_LANGUE ARABE_28072026153232.xlsx',
    schoolYear,
    students
});

assert.strictEqual(parsed.valid, true);
assert.deepStrictEqual(parsed.counts.importedStudentCount, 2);
assert.strictEqual(parsed.records.length, 6);
assert.deepStrictEqual(
    parsed.records.map((record) => record.student_code),
    ['K141075862', 'K141075862', 'K141075862', 'K141097404', 'K141097404', 'K141097404']
);
assert.deepStrictEqual(
    new Set(parsed.records.map((record) => record.subject)),
    new Set(['اللغة العربية — الفرض الأول', 'اللغة العربية — الفرض الثاني', 'اللغة العربية — الأنشطة المندمجة'])
);
assert.strictEqual(parsed.metadata.subject, 'اللغة العربية');
assert.strictEqual(parsed.metadata.semester, 1);
assert.deepStrictEqual(parsed.metadata.sections, ['1BACSEF-1']);
assert.deepStrictEqual(parsed.metadata.levels, ['الأولى باكالوريا علوم تجريبية']);
assert.deepStrictEqual(parsed.metadata.teacherNames, ['أستاذ العربية']);
assert.strictEqual(parsed.metadata.workbookSchoolYears[0], schoolYear);

const multiSheetResult = Parser.parseGradesSheets({
    sheets: [
        { name: 'NotesCC', rows: twoRowWorkbook },
        {
            name: 'Second Section',
            rows: [...metadataRows(), ['رقم التلميذ', 'الفرض الأول', 'الفرض الثاني', 'الأنشطة المندمجة'], ['K141075862', 8, 9, 10]]
        }
    ],
    sourceFileName: 'Export_10401E_1BACSEF-1_LANGUE ARABE_28072026153232.xlsx',
    schoolYear,
    students
});
assert.strictEqual(multiSheetResult.valid, true);
assert.strictEqual(multiSheetResult.records.length, 6);
assert.strictEqual(multiSheetResult.counts.duplicateInputRows, 3);

const oneRow = [
    ...metadataRows(),
    ['رقم التلميذ', 'الاسم', 'الفرض الأول'],
    ['K141075862', 'الأول', 9],
    ['K141097404', 'الأخير', 17]
];
const oneRowResult = Parser.parseGradesSheets({
    sheets: [{ name: 'Sheet1', rows: oneRow }],
    sourceFileName: 'Export_1_X_LANGUE ARABE_28072026153232.xlsx',
    schoolYear,
    students
});
assert.strictEqual(oneRowResult.valid, true);
assert.strictEqual(oneRowResult.records.length, 2);
assert.deepStrictEqual(oneRowResult.records.map((record) => record.student_code), ['K141075862', 'K141097404']);

const firstFile = Parser.parseGradesSheets({
    sheets: [{ name: 'Sheet1', rows: [...metadataRows(), ['رقم التلميذ', 'النقطة'], ['K141075862', 11]] }],
    sourceFileName: 'Export_1_X_LANGUE ARABE_فرض1_28072026153232.xlsx',
    schoolYear,
    students
});
const secondFile = Parser.parseGradesSheets({
    sheets: [{ name: 'Sheet1', rows: [...metadataRows(), ['رقم التلميذ', 'النقطة'], ['K141075862', 18]] }],
    sourceFileName: 'Export_1_X_LANGUE ARABE_فرض2_28072026153232.xlsx',
    schoolYear,
    students
});
assert.strictEqual(firstFile.records[0].subject, 'اللغة العربية — الفرض الأول');
assert.strictEqual(secondFile.records[0].subject, 'اللغة العربية — الفرض الثاني');
assert.notStrictEqual(firstFile.records[0].subject, secondFile.records[0].subject);

const unresolvedAssessment = Parser.parseGradesSheets({
    sheets: [{ name: 'Grades', rows: [...metadataRows(), ['رقم التلميذ', 'النقطة'], ['K141075862', 12]] }],
    sourceFileName: 'Export_1_X_LANGUE ARABE_28072026153232.xlsx',
    schoolYear,
    students
});
assert.strictEqual(unresolvedAssessment.valid, false);
assert.ok(unresolvedAssessment.diagnostics.some((item) => item.code === 'ASSESSMENT_UNRESOLVED'));

const invalid = Parser.parseGradesSheets({
    sheets: [{ name: 'Grades', rows: [...metadataRows(), ['رقم التلميذ', 'الفرض الأول'], ['UNKNOWN', 12], ['K141075862', 'not-a-grade']] }],
    sourceFileName: 'Export_1_X_LANGUE ARABE_28072026153232.xlsx',
    schoolYear,
    students
});
assert.strictEqual(invalid.valid, false);
assert.ok(invalid.diagnostics.some((item) => item.code === 'UNKNOWN_STUDENT' && item.sheet === 'Grades'));
assert.ok(invalid.diagnostics.some((item) => item.code === 'INVALID_GRADE' && item.row === 5));
assert.strictEqual(invalid.records.length, 0);

console.log('grades-import-behavior: OK');
