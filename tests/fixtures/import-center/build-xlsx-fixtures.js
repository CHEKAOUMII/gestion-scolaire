'use strict';

/**
 * build-xlsx-fixtures.js — generate programmatic .xlsx fixtures for import-center
 * Uses the vendored xlsx package (xlsx@0.18.5) so binaries are reproducible from code.
 * Run: node tests/fixtures/import-center/build-xlsx-fixtures.js
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname);

function ensureDir(rel) {
    const full = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    return full;
}

function writeWorkbook(rel, sheets) {
    // sheets: [{ name, aoa }]
    const wb = XLSX.utils.book_new();
    for (const { name, aoa } of sheets) {
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        XLSX.utils.book_append_sheet(wb, ws, name);
    }
    const full = ensureDir(rel);
    XLSX.writeFile(wb, full);
    console.log('wrote', rel);
}

// 1. students/basic.xlsx — happy path, Arabic headers
writeWorkbook('students/basic.xlsx', [
    {
        name: 'TCSF-1',
        aoa: [
            ['المؤسسة:', 'الثانوية التأهيلية ابن سينا'],
            ['المستوى:', 'الجذع المشترك العلمي خيار فرنسية'],
            ['الرمز', 'النسب', 'الاسم', 'الجنس', 'تاريخ الازدياد', 'مكان الازدياد', 'القسم'],
            ['S0001001', 'بنعلي', 'يوسف', 'ذكر', '2008-03-12', 'الدار البيضاء', 'TCSF-1'],
            ['S0001002', 'الفاسي', 'مريم', 'أنثى', '05/03/2008', 'مراكش', 'TCSF-1'],
        ],
    },
]);

// 2. students/latin-headers-lastname-first.xlsx — T1.1 regression
writeWorkbook('students/latin-headers-lastname-first.xlsx', [
    {
        name: 'Class A',
        aoa: [
            ['Massar', 'LastName', 'FirstName', 'BirthDate'],
            ['S0002001', 'Benali', 'Ahmed', '2007-09-01'],
            ['S0002002', 'Alami', 'Fatima', '2008-01-15'],
        ],
    },
]);

// 3. students/mixed-dates.xlsx — T1.2 regression: Excel serial + DD/MM/YYYY
writeWorkbook('students/mixed-dates.xlsx', [
    {
        name: 'TCSF-1',
        aoa: [
            ['رمز مسار', 'النسب', 'الاسم', 'تاريخ الازدياد'],
            ['S0003001', 'ترباوي', 'ريم', 40361], // 2010-07-02 serial
            ['S0003002', 'الحكيم', 'محمد', '15/03/2009'], // DD/MM/YYYY
            ['S0003003', 'المعاون', 'ادم', '٢٠/٠٥/٢٠٠٩'], // Arabic-Indic
        ],
    },
]);

// 4. grades/single-semester.xlsx — happy path
writeWorkbook('grades/single-semester.xlsx', [
    {
        name: 'Notes S1',
        aoa: [
            ['رمز مسار', 'المادة', 'النقطة', 'الدورة', 'الأستاذ'],
            ['S0001001', 'الرياضيات', 14.5, 1, 'أ. تجريبي'],
            ['S0001002', 'الرياضيات', 12.0, 1, 'أ. تجريبي'],
        ],
    },
]);

// 5. grades/mixed-semester-sheets.xlsx — sheet 1 الدورة الأولى, sheet 2 الدورة الثانية
writeWorkbook('grades/mixed-semester-sheets.xlsx', [
    {
        name: 'الدورة الأولى',
        aoa: [
            ['رمز مسار', 'المادة', 'النقطة', 'الدورة'],
            ['S0001001', 'الفيزياء', 15, 1],
            ['S0001002', 'الفيزياء', 11, 1],
        ],
    },
    {
        name: 'الدورة الثانية',
        aoa: [
            ['رمز مسار', 'المادة', 'النقطة', 'الدورة'],
            ['S0001001', 'الفيزياء', 13, 2],
            ['S0001002', 'الفيزياء', 9.5, 2],
        ],
    },
]);

// 6. grades/header-only.xlsx — zero data rows
writeWorkbook('grades/header-only.xlsx', [
    {
        name: 'Notes',
        aoa: [['رمز مسار', 'المادة', 'النقطة', 'الدورة']],
    },
]);

// 7. absences/massar-matrix.xlsx — positional month-matrix layout
writeWorkbook('absences/massar-matrix.xlsx', [
    {
        name: 'Absences',
        aoa: [
            ['رمز مسار', 'الاسم', 'شتنبر', 'أكتوبر', 'نونبر', 'دجنبر'],
            ['S0001001', 'يوسف بنعلي', 2, 0, 4, 1],
            ['S0001002', 'مريم الفاسي', 0, 3, 0, 0],
        ],
    },
]);

// 8. student_status/basic.xlsx — happy path
writeWorkbook('student_status/basic.xlsx', [
    {
        name: 'Status',
        aoa: [
            ['رمز مسار', 'الاسم الكامل', 'القسم', 'الوضعية'],
            ['S0004001', 'تلميذ منقطع تجريبي', '1BACSH-3', 'منقطع'],
            ['S0004002', 'تلميذ مفصول تجريبي', '1BACSH-3', 'مفصول'],
        ],
    },
]);

console.log('all xlsx fixtures generated');
