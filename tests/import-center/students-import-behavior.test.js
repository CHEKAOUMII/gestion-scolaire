'use strict';

const assert = require('assert');
const Parser = require('../../js/import-center/students-import-parser.js');

const schoolYear = '2025/2026';
const normalizeLevel = (value) => {
    const raw = String(value || '').trim();
    if (/^TCSF(?:-|$)/i.test(raw)) return 'الجذع المشترك العلمي خيار فرنسية';
    return raw;
};

const metadataRows = [
    [],
    ['لائحة التلاميذ'],
    [' : المستوى', null, 'الجذع المشترك العلمي – خيار فرنسية'],
    [' : القسم', null, 'TCSF-1'],
    ['المؤسسة:', null, 'الثانوية التأهيلية ابن سينا'],
    ['ر.ت', 'الرمز', 'النسب', 'الإسم', 'النوع', 'تاريخ الازدياد', 'مكان الازدياد']
];

const metadataResult = Parser.parseStudentSheets({
    sheets: [
        {
            name: 'TCSF-1',
            rows: [
                ...metadataRows,
                [1, 'g160044350', 'ترباوي', 'ريم', 'أنثى', '2010-08-20', 'اسفي'],
                [2, 'G160048447', 'الحكيم', 'محمد امين', 'ذكر', 40361, 'الدار البيضاء']
            ]
        }
    ],
    schoolYear,
    configuredSchoolName: 'الثانوية التأهيلية ابن سينا',
    normalizeLevel
});

assert.strictEqual(metadataResult.valid, true);
assert.strictEqual(metadataResult.records.length, 2);
assert.strictEqual(metadataResult.records[0].code, 'G160044350');
assert.strictEqual(metadataResult.records[0].full_name, 'ريم ترباوي');
assert.strictEqual(metadataResult.records[0].section, 'TCSF-1');
assert.strictEqual(metadataResult.records[0].level, 'الجذع المشترك العلمي – خيار فرنسية');
assert.strictEqual(metadataResult.records[0].school_name, 'الثانوية التأهيلية ابن سينا');
assert.strictEqual(metadataResult.records[1].birth_date, '2010-07-02');

const columnResult = Parser.parseStudentSheets({
    sheets: [
        {
            name: 'Class A',
            rows: [
                ['Massar', 'FirstName', 'LastName', 'Level', 'School Name', 'Section'],
                ['A1', 'ريم', 'ترباوي', '1BAC-1', 'ثانوية أخرى', '1BAC-1']
            ]
        }
    ],
    schoolYear,
    configuredSchoolName: 'ثانوية أخرى',
    normalizeLevel: (value) => String(value).replace(/-1$/, '')
});
assert.strictEqual(columnResult.valid, true);
assert.strictEqual(columnResult.records[0].school_name, 'ثانوية أخرى');
assert.strictEqual(columnResult.records[0].level, '1BAC');

const fallbackResult = Parser.parseStudentSheets({
    sheets: [{ name: 'TCSF-2', rows: [['الرمز', 'الاسم'], ['B1', 'تلميذ']] }],
    schoolYear,
    configuredSchoolName: ''
});
assert.strictEqual(fallbackResult.valid, true);
assert.strictEqual(fallbackResult.records[0].section, 'TCSF-2');
assert.strictEqual(fallbackResult.records[0].level, 'الجذع المشترك العلمي خيار فرنسية');
assert.ok(fallbackResult.warnings.some((item) => item.code === 'SCHOOL_NAME_MISSING'));
assert.ok(fallbackResult.warnings.some((item) => item.code === 'CONFIGURED_SCHOOL_MISSING'));

const duplicateResult = Parser.parseStudentSheets({
    sheets: [{ name: 'Duplicates', rows: [['Code', 'Name'], ['A1', 'الأول'], ['A1', 'الثاني']] }],
    schoolYear,
    configuredSchoolName: ''
});
assert.strictEqual(duplicateResult.records.length, 1);
assert.ok(duplicateResult.warnings.some((item) => item.code === 'DUPLICATE_STUDENT_CODE'));

const mismatchResult = Parser.parseStudentSheets({
    sheets: [
        { name: 'School A', rows: [['المؤسسة:', 'مدرسة أ'], ['الرمز', 'الاسم'], ['A1', 'الأول']] }
    ],
    schoolYear,
    configuredSchoolName: 'مدرسة ب'
});
assert.strictEqual(mismatchResult.valid, false);
assert.ok(mismatchResult.errors.some((item) => item.code === 'SCHOOL_MISMATCH'));
assert.strictEqual(mismatchResult.records.length, 1);

const multipleSchoolsResult = Parser.parseStudentSheets({
    sheets: [
        { name: 'A', rows: [['Code', 'School'], ['A1', 'مدرسة أ']] },
        { name: 'B', rows: [['Code', 'School'], ['B1', 'مدرسة ب']] }
    ],
    schoolYear,
    configuredSchoolName: ''
});
assert.strictEqual(multipleSchoolsResult.valid, false);
assert.ok(multipleSchoolsResult.errors.some((item) => item.code === 'MULTIPLE_SCHOOLS'));

const missingCodeResult = Parser.parseStudentSheets({
    sheets: [{ name: 'Invalid', rows: [['الاسم', 'القسم'], ['تلميذ', 'A']] }],
    schoolYear,
    configuredSchoolName: ''
});
assert.strictEqual(missingCodeResult.valid, false);
assert.ok(missingCodeResult.errors.some((item) => item.code === 'STUDENT_CODE_COLUMN_MISSING'));

console.log('students-import-behavior: OK');
