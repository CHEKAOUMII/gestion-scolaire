'use strict';

const assert = require('assert');
const ImportContext = require('../js/import-center/import-context.js');

function workbook(rows, name = 'students.xlsx') {
    return workbookWithSheets({ 'لائحة التلاميذ': rows }, name);
}

function workbookWithSheets(sheets, name = 'students.xlsx') {
    return {
        SheetNames: Object.keys(sheets),
        getSheetRows(sheetName) {
            return sheets[sheetName];
        },
        name
    };
}

const destination = {
    schoolYear: '2026/2027',
    institutionCode: 'ABC123',
    institutionName: 'ثانوية ابن سينا',
    cycleCode: 'secondary_qualifiant',
    cycleLabel: 'الثانوي التأهيلي'
};

const source = ImportContext.extractContext(
    workbook([
        ['الموسم الدراسي', '2025/2026'],
        ['رمز المؤسسة', 'ABC123'],
        ['اسم المؤسسة', 'ثانوية ابن سينا'],
        ['السلك', 'الثانوي التأهيلي'],
        ['المستوى', 'الأولى بكالوريا'],
        ['القسم', '1BAC A']
    ]),
    'students.xlsx',
    { action: 'students' }
);

assert.strictEqual(source.schoolYear, '2025/2026');
assert.strictEqual(source.institutionCode, 'ABC123');
assert.strictEqual(source.cycleCode, 'secondary_qualifiant');
assert.strictEqual(source.cycleConfidence, 'high');

const collegialRoster = ImportContext.extractContext(
    workbookWithSheets({
        '1APIC-1': [
            ['المستوى', '', 'الأولى إعدادي مسار دولي'],
            ['القسم', '', '1APIC-1'],
            ['ر.ت', 'الرمز', 'النسب', 'الإسم'],
            ['1', 'G140130899', 'المعاون', 'آدم'],
            ['2', 'G163076207', 'الرفاعي', 'عبد اللطيف']
        ],
        '2APIC-1': [
            ['المستوى', '', 'الثانية إعدادي مسار دولي'],
            ['القسم', '', '2APIC-1'],
            ['ر.ت', 'الرمز', 'النسب', 'الإسم'],
            ['1', 'G142133580', 'الفراع', 'بلعيد']
        ]
    }),
    'ListEleve_20260730.xlsx',
    { action: 'students' }
);
assert.deepStrictEqual(collegialRoster.levels, ['الأولى إعدادي مسار دولي', 'الثانية إعدادي مسار دولي']);
assert.deepStrictEqual(collegialRoster.sections, ['1APIC-1', '2APIC-1']);

const gradeExport = ImportContext.extractContext(
    workbook([
        ['', '', 'مؤسسة', '', 'الثانوية التأهيلية تالمست'],
        ['', '', 'المستوى', '', 'الأولى إعدادي مسار دولي'],
        ['', '', 'القسم', '', '1APIC-2'],
        ['', '', 'السنة الدراسية', '', '2025/2026'],
        ['ر.ت', 'رقم التلميذ', 'الفرض الأول'],
        ['1', 'F176140874', '3.00']
    ]),
    'Export_10401E_1APIC-2_INSTRUCTION ISLAMIQUE_28072026160612.xlsx',
    { action: 'grades' }
);
assert.strictEqual(gradeExport.institutionName, 'الثانوية التأهيلية تالمست');
assert.deepStrictEqual(gradeExport.levels, ['الأولى إعدادي مسار دولي']);
assert.deepStrictEqual(gradeExport.sections, ['1APIC-2']);

const blocked = ImportContext.compareContexts(source, destination, 'students');
assert.strictEqual(blocked.status, 'blocked');
assert.ok(blocked.blocking.some((item) => item.code === 'SCHOOL_YEAR_MISMATCH'));
assert.strictEqual(blocked.canProceed, false);

const filenameOnly = ImportContext.extractContext(
    workbook([['رمز المؤسسة', 'ABC123'], ['الاسم الكامل', 'تلميذ']], 'students-2025-2026.xlsx'),
    'students-2025-2026.xlsx',
    { action: 'students' }
);
const filenameReview = ImportContext.compareContexts(filenameOnly, destination, 'students');
assert.ok(!filenameReview.blocking.some((item) => item.code === 'SCHOOL_YEAR_MISMATCH'));
assert.strictEqual(filenameReview.status, 'review');

const institutionMismatch = ImportContext.compareContexts(
    ImportContext.extractContext(
        workbook([['الموسم الدراسي', '2026/2027'], ['رمز المؤسسة', 'OTHER999']]),
        'students.xlsx',
        { action: 'students' }
    ),
    destination,
    'students'
);
assert.ok(institutionMismatch.blocking.some((item) => item.code === 'INSTITUTION_CODE_MISMATCH'));

const cycleMismatch = ImportContext.compareContexts(
    ImportContext.extractContext(
        workbook([
            ['الموسم الدراسي', '2026/2027'],
            ['رمز المؤسسة', 'ABC123'],
            ['السلك', 'الثانوي الإعدادي']
        ]),
        'students.xlsx',
        { action: 'students' }
    ),
    destination,
    'students'
);
assert.ok(cycleMismatch.blocking.some((item) => item.code === 'CYCLE_MISMATCH'));

const missingMetadata = ImportContext.compareContexts(
    ImportContext.extractContext(workbook([['الرمز', 'A123'], ['الاسم الكامل', 'تلميذ']]), 'students.xlsx'),
    destination,
    'students'
);
assert.strictEqual(missingMetadata.canProceed, true);
assert.strictEqual(missingMetadata.blocking.length, 0);

console.log('import-context-preflight: OK');
