/*
 * Collegial level normalization: module-level resolveLevel / matchLevelFromSection
 * mappings plus parser end-to-end behavior with defaultNormalizeLevel.
 */
'use strict';

const assert = require('assert');
const CollegialLevels = require('../js/shared/education/collegial-levels.js');
const Parser = require('../js/import-center/students-import-parser.js');

const resolveLevel = CollegialLevels.resolveLevel;
const matchLevelFromSection = CollegialLevels.matchLevelFromSection;

let hit = resolveLevel('الأولى إعدادي مسار دولي');
assert.strictEqual(hit.name, 'الأولى إعدادي مسار دولي');
assert.strictEqual(hit.code, '1APIC');

hit = resolveLevel('الثانية إعدادي مسار دولي');
assert.strictEqual(hit.name, 'الثانية إعدادي مسار دولي');
assert.strictEqual(hit.code, '2APIC');

hit = resolveLevel('الثالثة إعدادي مسار دولي');
assert.strictEqual(hit.name, 'الثالثة إعدادي مسار دولي');
assert.strictEqual(hit.code, '3APIC');

for (const variant of [
    'أولى إعدادي',
    'الأولى إعدادية مسار دولي',
    'الأولى إعدادي',
    'أولى إعدادي مسار دولي',
    'الأولى إعدادية',
    'الأول إعدادي'
]) {
    hit = resolveLevel(variant);
    assert.strictEqual(hit.name, 'الأولى إعدادي مسار دولي');
    assert.strictEqual(hit.code, '1APIC');
}

const sectionCases = [
    ['1APIC', 'الأولى إعدادي مسار دولي', '1APIC'],
    ['1APIC-1', 'الأولى إعدادي مسار دولي', '1APIC'],
    ['2APIC-1', 'الثانية إعدادي مسار دولي', '2APIC'],
    ['3APIC-7', 'الثالثة إعدادي مسار دولي', '3APIC'],
    ['1APIC-9', 'الأولى إعدادي مسار دولي', '1APIC']
];
for (const [section, expectedName, expectedCode] of sectionCases) {
    hit = resolveLevel(section);
    assert.strictEqual(hit.name, expectedName);
    assert.strictEqual(hit.code, expectedCode);
}

for (const invalid of [
    'الأولى باكالوريا',
    'أولى باك',
    'الجذع المشترك العلمي',
    'الأولى ابتدائي',
    'TCSF-1',
    '2BACSM-2',
    '1AP',
    'اولاد اعدادي',
    'اولوية اعدادي',
    'الأولى مرحبا إعدادي',
    'السنة الأولى إعدادي',
    'أولى',
    'إعدادي',
    '',
    null,
    undefined
]) {
    assert.strictEqual(resolveLevel(invalid), null);
}

hit = matchLevelFromSection('2APIC-5');
assert.strictEqual(hit.name, 'الثانية إعدادي مسار دولي');
assert.strictEqual(hit.code, '2APIC');

const collegialRows = (label, section) => [
    [' : المستوى', null, label],
    [' : القسم', null, section],
    ['المؤسسة:', null, 'الثانوية التأهيلية تالمست'],
    ['ر.ت', 'الرمز', 'النسب', 'الإسم', 'النوع', 'تاريخ الازدياد', 'مكان الازدياد']
];

const firstResult = Parser.parseStudentSheets({
    sheets: [
        {
            name: '1APIC-1',
            rows: [
                ...collegialRows('الأولى إعدادي مسار دولي', '1APIC-1'),
                [1, 'G140130899', 'المعاون', 'ادم', 'ذكر', '2008-06-16', 'حد السوالم']
            ]
        }
    ],
    schoolYear: '2025/2026',
    configuredSchoolName: 'الثانوية التأهيلية تالمست'
});
assert.strictEqual(firstResult.valid, true);
assert.strictEqual(firstResult.records.length, 1);
assert.strictEqual(firstResult.records[0].code, 'G140130899');
assert.strictEqual(firstResult.records[0].section, '1APIC-1');
assert.strictEqual(firstResult.records[0].level, 'الأولى إعدادي مسار دولي');

const thirdResult = Parser.parseStudentSheets({
    sheets: [
        {
            name: '3APIC-3',
            rows: [
                ...collegialRows('الثالثة إعدادي مسار دولي', '3APIC-3'),
                [1, 'G140130901', 'بناني', 'سارة', 'أنثى', '2009-02-03', 'تطوان']
            ]
        }
    ],
    schoolYear: '2025/2026',
    configuredSchoolName: 'الثانوية التأهيلية تالمست'
});
assert.strictEqual(thirdResult.valid, true);
assert.strictEqual(thirdResult.records.length, 1);
assert.strictEqual(thirdResult.records[0].code, 'G140130901');
assert.strictEqual(thirdResult.records[0].section, '3APIC-3');
assert.strictEqual(thirdResult.records[0].level, 'الثالثة إعدادي مسار دولي');

const qualifiantResult = Parser.parseStudentSheets({
    sheets: [
        {
            name: '1BAC-1',
            rows: [
                ...collegialRows('الأولى باكالوريا', '1BAC-1'),
                [1, 'G140130902', 'مزوار', 'كريم', 'ذكر', '2007-11-20', 'فاس']
            ]
        }
    ],
    schoolYear: '2025/2026',
    configuredSchoolName: 'الثانوية التأهيلية تالمست'
});
assert.strictEqual(qualifiantResult.valid, true);
assert.strictEqual(qualifiantResult.records[0].level, 'الأولى باكالوريا');

const fallbackResult = Parser.parseStudentSheets({
    sheets: [{ name: 'TCSF-2', rows: [['الرمز', 'الاسم'], ['B1', 'تلميذ']] }],
    schoolYear: '2025/2026',
    configuredSchoolName: ''
});
assert.strictEqual(fallbackResult.valid, true);
assert.strictEqual(fallbackResult.records[0].section, 'TCSF-2');
assert.strictEqual(fallbackResult.records[0].level, 'الجذع المشترك العلمي خيار فرنسية');
