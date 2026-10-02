'use strict';

// node tests/import-center/xlsx-fixture-parsing.test.js
//
// The .xlsx fixtures added by T2.1 were registered in manifest.json but never
// read by any test, so the XLSX.read -> getSheetRows -> rows[][] conversion (the
// primary production path) stayed untested and a fixture that parsed to zero
// records went unnoticed. This file executes that conversion with the same
// options the page uses (js/pages/settings-imports.js getSheetRows:
// `{ header: 1, raw: true }`) and asserts real parser output.

const assert = require('assert');
const path = require('path');
const XLSX = require('xlsx');

const StudentParser = require('../../js/import-center/students-import-parser.js');

const FIX = path.join(__dirname, '..', 'fixtures', 'import-center');
const SCHOOL_YEAR = '2025/2026';

function readFixture(rel) {
    const workbook = XLSX.readFile(path.join(FIX, rel));
    return {
        sheetNames: workbook.SheetNames.slice(),
        sheets: workbook.SheetNames.map((name) => ({
            name,
            rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true })
        }))
    };
}

function parseStudents(rel, configuredSchoolName = '') {
    const { sheets } = readFixture(rel);
    return StudentParser.parseStudentSheets({
        sheets,
        schoolYear: SCHOOL_YEAR,
        configuredSchoolName,
        normalizeLevel: (value) => value
    });
}

// ── students/basic.xlsx — Arabic headers under two metadata rows ─────────────
const basic = parseStudents('students/basic.xlsx', 'الثانوية التأهيلية ابن سينا');
assert.strictEqual(basic.valid, true, 'students/basic.xlsx must import');
assert.strictEqual(basic.records.length, 2);
assert.deepStrictEqual(
    basic.records.map((r) => `${r.code}|${r.full_name}|${r.birth_date}`),
    ['S0001001|يوسف بنعلي|2008-03-12', 'S0001002|مريم الفاسي|2008-03-05']
);
assert.strictEqual(basic.records[0].section, 'TCSF-1', 'section falls back to the sheet name');
assert.strictEqual(
    basic.records[0].school_name,
    'الثانوية التأهيلية ابن سينا',
    'the metadata banner above the header row must be read'
);

// ── students/latin-headers-lastname-first.xlsx — the T1.1 corruption vector ──
const latin = parseStudents('students/latin-headers-lastname-first.xlsx');
assert.strictEqual(latin.valid, true);
assert.deepStrictEqual(
    latin.records.map((r) => r.full_name),
    ['Ahmed Benali', 'Fatima Alami'],
    'LastName left of FirstName must not collapse both name roles onto one column'
);

// ── students/mixed-dates.xlsx — the T1.2 date vectors, incl. an Excel serial ──
const mixedSource = readFixture('students/mixed-dates.xlsx');
assert.strictEqual(
    typeof mixedSource.sheets[0].rows[1][3],
    'number',
    'raw:true must hand the parser a real Excel serial, not a formatted string'
);
const mixed = parseStudents('students/mixed-dates.xlsx');
assert.strictEqual(mixed.valid, true, 'students/mixed-dates.xlsx must import');
assert.strictEqual(mixed.records.length, 3, 'the «رمز مسار» header must resolve the student-code column');
assert.deepStrictEqual(
    mixed.records.map((r) => r.birth_date),
    ['2010-07-02', '2009-03-15', '2009-05-20'],
    'serial / DD-MM-YYYY / Arabic-Indic digits must all normalize to ISO'
);

// ── multi-sheet ordering and the header-only failure fixture ─────────────────
const mixedSemester = readFixture('grades/mixed-semester-sheets.xlsx');
assert.deepStrictEqual(
    mixedSemester.sheetNames,
    ['الدورة الأولى', 'الدورة الثانية'],
    'sheet order must survive the workbook round trip'
);

const headerOnly = readFixture('grades/header-only.xlsx');
assert.strictEqual(headerOnly.sheets[0].rows.length, 1, 'header-only fixture must expose exactly one row');
assert.ok(headerOnly.sheets[0].rows[0].length > 1, 'header row must be non-empty');

// ── every registered .xlsx fixture must be readable and non-degenerate ───────
const XLSX_FIXTURES = [
    'students/basic.xlsx',
    'students/latin-headers-lastname-first.xlsx',
    'students/mixed-dates.xlsx',
    'grades/single-semester.xlsx',
    'grades/mixed-semester-sheets.xlsx',
    'grades/header-only.xlsx',
    'absences/massar-matrix.xlsx',
    'student_status/basic.xlsx'
];
for (const rel of XLSX_FIXTURES) {
    const { sheetNames, sheets } = readFixture(rel);
    assert.ok(sheetNames.length >= 1, `${rel}: must expose at least one sheet`);
    for (const sheet of sheets) {
        assert.ok(Array.isArray(sheet.rows), `${rel}/${sheet.name}: rows must be an array of arrays`);
        assert.ok(
            sheet.rows.some((row) => (row || []).some((cell) => String(cell ?? '').trim())),
            `${rel}/${sheet.name}: must contain at least one non-empty cell`
        );
    }
}

console.log('xlsx-fixture-parsing: OK', { fixtures: XLSX_FIXTURES.length });
