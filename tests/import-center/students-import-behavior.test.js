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
assert.ok(!Object.prototype.hasOwnProperty.call(metadataResult.records[0], 'status'));

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

// Collegial levels via defaultNormalizeLevel (no custom normalizeLevel passed)
const collegialMetadataRows = [
    [],
    ['لائحة التلاميذ'],
    [' : المستوى', null, 'الأولى إعدادي مسار دولي'],
    [' : القسم', null, '1APIC-1'],
    ['المؤسسة:', null, 'الثانوية التأهيلية تالمست'],
    ['ر.ت', 'الرمز', 'النسب', 'الإسم', 'النوع', 'تاريخ الازدياد', 'مكان الازدياد']
];

const collegialResult = Parser.parseStudentSheets({
    sheets: [
        {
            name: '1APIC-1',
            rows: [
                ...collegialMetadataRows,
                [1, 'G140130899', 'المعاون', 'ادم', 'ذكر', '2008-06-16', 'حد السوالم']
            ]
        }
    ],
    schoolYear,
    configuredSchoolName: 'الثانوية التأهيلية تالمست'
});
assert.strictEqual(collegialResult.valid, true);
assert.strictEqual(collegialResult.records[0].level, 'الأولى إعدادي مسار دولي');
assert.strictEqual(collegialResult.records[0].section, '1APIC-1');

const qualifiantLevelResult = Parser.parseStudentSheets({
    sheets: [
        {
            name: '1BAC-1',
            rows: [
                [],
                ['لائحة التلاميذ'],
                [' : المستوى', null, 'الأولى باكالوريا'],
                [' : القسم', null, '1BAC-1'],
                ['المؤسسة:', null, 'الثانوية التأهيلية تالمست'],
                ['ر.ت', 'الرمز', 'النسب', 'الإسم', 'النوع', 'تاريخ الازدياد', 'مكان الازدياد'],
                [1, 'X1001', 'المعاون', 'ادم', 'ذكر', '2008-06-16', 'حد السوالم']
            ]
        }
    ],
    schoolYear,
    configuredSchoolName: 'الثانوية التأهيلية تالمست'
});
assert.strictEqual(qualifiantLevelResult.valid, true);
assert.strictEqual(qualifiantLevelResult.records[0].level, 'الأولى باكالوريا');

const apicSectionResult = Parser.parseStudentSheets({
    sheets: [
        {
            name: '3APIC-3',
            rows: [
                [],
                ['لائحة التلاميذ'],
                [' : المستوى', null, 'الثالثة إعدادي مسار دولي'],
                [' : القسم', null, '3APIC-3'],
                ['المؤسسة:', null, 'الثانوية التأهيلية تالمست'],
                ['ر.ت', 'الرمز', 'النسب', 'الإسم', 'النوع', 'تاريخ الازدياد', 'مكان الازدياد'],
                [1, 'X3001', 'المعاون', 'ادم', 'ذكر', '2008-06-16', 'حد السوالم']
            ]
        }
    ],
    schoolYear,
    configuredSchoolName: 'الثانوية التأهيلية تالمست'
});
assert.strictEqual(apicSectionResult.valid, true);
assert.strictEqual(apicSectionResult.records[0].level, 'الثالثة إعدادي مسار دولي');


// T1.1 regression cases (plan §T1.1): latin-header corruption vectors
const lastNameFirst = Parser.parseStudentSheets({
    sheets: [
        {
            name: 'Case A',
            rows: [
                ['Massar', 'LastName', 'FirstName', 'BirthDate'],
                ['A1', 'ترباوي', 'ريم', '2010-01-01']
            ]
        }
    ],
    schoolYear,
    configuredSchoolName: ''
});
assert.strictEqual(lastNameFirst.valid, true);
assert.strictEqual(lastNameFirst.records[0].full_name, 'ريم ترباوي', 'case A: must be first + last, not last + last');

const schoolNameLeft = Parser.parseStudentSheets({
    sheets: [
        {
            name: 'Case B',
            rows: [
                ['Massar', 'SchoolName', 'FirstName', 'LastName'],
                ['B1', 'مدرسة الأمل', 'نور', 'العمراني']
            ]
        }
    ],
    schoolYear,
    configuredSchoolName: 'مدرسة الأمل'
});
assert.strictEqual(schoolNameLeft.valid, true);
assert.ok(
    !schoolNameLeft.records[0].full_name.includes('الأمل'),
    'case B: full_name must not contain the school name'
);
assert.strictEqual(schoolNameLeft.records[0].full_name, 'نور العمراني');

const controlName = Parser.parseStudentSheets({
    sheets: [
        {
            name: 'Case C',
            rows: [
                ['Massar', 'FirstName', 'LastName'],
                ['C1', 'سليم', 'بنعلي']
            ]
        }
    ],
    schoolYear,
    configuredSchoolName: ''
});
assert.strictEqual(controlName.valid, true);
assert.strictEqual(controlName.records[0].full_name, 'سليم بنعلي');

// Case D — the canonical Arabic Massar pair. «الاسم العائلي» contains «الاسم»,
// so a first-match binder puts both name roles on the family column. Exclusive
// best-match binding must keep them apart and must NOT reject the file.
const arabicNamePair = Parser.parseStudentSheets({
    sheets: [
        {
            name: 'Case D',
            rows: [
                ['الرمز', 'الاسم العائلي', 'الاسم الشخصي'],
                ['D1', 'ترباوي', 'ريم']
            ]
        }
    ],
    schoolYear,
    configuredSchoolName: ''
});
assert.strictEqual(arabicNamePair.valid, true, 'case D: the Arabic Massar header pair must stay importable');
assert.strictEqual(arabicNamePair.records[0].full_name, 'ريم ترباوي', 'case D: must be first + family, not family + family');
assert.ok(
    !arabicNamePair.diagnostics.some((item) => item.code === 'AMBIGUOUS_HEADER_BINDING'),
    'case D: a resolvable pair is not a collision'
);

// Case E — a single column shared by both composed-name roles: the parser binds
// the more specific role and reports the leftover as a NON-blocking warning.
const sharedNameColumn = Parser.parseStudentSheets({
    sheets: [
        {
            name: 'Case E',
            rows: [
                ['الرمز', 'الاسم العائلي'],
                ['E1', 'ترباوي']
            ]
        }
    ],
    schoolYear,
    configuredSchoolName: ''
});
assert.strictEqual(sharedNameColumn.valid, true, 'case E: a shared name column must not block the import');
assert.strictEqual(sharedNameColumn.records[0].full_name, 'ترباوي');
assert.ok(
    sharedNameColumn.warnings.some((item) => item.code === 'AMBIGUOUS_HEADER_BINDING'),
    'case E: the leftover name role must be reported as a warning'
);

// Case F — short Arabic aliases must keep matching inside longer headers
// («رمز» inside «رمز مسار»), which the earlier short-alias-exact rule broke.
const shortAliasHeader = Parser.parseStudentSheets({
    sheets: [
        {
            name: 'Case F',
            rows: [
                ['رمز مسار', 'النسب', 'الاسم', 'تاريخ الازدياد'],
                ['F1', 'ترباوي', 'ريم', '15/03/2009']
            ]
        }
    ],
    schoolYear,
    configuredSchoolName: ''
});
assert.strictEqual(shortAliasHeader.valid, true, 'case F: «رمز مسار» must resolve the student-code column');
assert.strictEqual(shortAliasHeader.records[0].code, 'F1');
assert.strictEqual(shortAliasHeader.records[0].full_name, 'ريم ترباوي');
assert.strictEqual(shortAliasHeader.records[0].birth_date, '2009-03-15');


console.log('students-import-behavior: OK');
