'use strict';

// node tests/import-boundaries.test.js
// Phase 2 (F9/F17/F18 + F7/F8) — static import-boundary assertions on the
// renderer page, the absences IPC handler, and the absences repo.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importSourceIncludes } = require('./helpers/import-source.js');


const root = path.join(__dirname, '..');
const ipcSrc = fs.readFileSync(path.join(root, 'main', 'ipc', 'absences.js'), 'utf8');
const repoSrc = fs.readFileSync(path.join(root, 'main', 'repos', 'absences.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');

// ─── F9: file-size guards (XLSX/CSV 100 MB; XML/JSON 20 MB) ────────────────
assert.ok(importSourceIncludes('const MAX_XLSX_IMPORT_SIZE = 100 * 1024 * 1024;'), 'XLSX/CSV size cap constant');
assert.ok(importSourceIncludes('const MAX_XML_IMPORT_SIZE = 20 * 1024 * 1024;'), 'XML/JSON size cap constant');
assert.ok(importSourceIncludes('file?.size === 0'), '0-byte guard present in parseWorkbook');
assert.ok(importSourceIncludes('file?.size > MAX_XLSX_IMPORT_SIZE'), 'XLSX size guard present');
assert.ok(importSourceIncludes('الملف كبير جداً (الحد الأقصى 100 MB). اختر ملفاً أصغر ثم أعد المحاولة.'), '100 MB message');
assert.ok(importSourceIncludes('الملف كبير جداً (الحد الأقصى 20 MB). اختر ملفاً أصغر ثم أعد المحاولة.'), '20 MB message');
assert.ok(importSourceIncludes('function readImportFileAsText(file, maxSize'), 'shared text reader helper');
assert.ok(importSourceIncludes('readImportFileAsText(file, MAX_XML_IMPORT_SIZE)'), 'FET reader uses the shared helper');
assert.ok(importSourceIncludes('readImportFileAsText(file, MAX_XML_IMPORT_SIZE)'), 'agent XML reader uses the shared helper');

// ─── F18: 0-byte XLSX maps to EMPTY_FILE, not the generic message ──────────
assert.ok(
    importSourceIncludes("ImportResultContract.createContextError('EMPTY_FILE', null, { noRecordsSaved: true })"),
    '0-byte workbook maps to EMPTY_FILE'
);

// ─── F17: abort + timeout on every FileReader path ─────────────────────────
assert.ok(importSourceIncludes('const FILE_READ_TIMEOUT_MS = 60000;'), 'read timeout constant');
assert.ok(importSourceIncludes('reader.onabort'), 'abort handler present in page readers');
assert.ok(importSourceIncludes('reader.abort()'), 'timeout aborts the reader');
assert.ok(importSourceIncludes('انتهت مهلة قراءة الملف (60 ثانية). أعد المحاولة.'), 'timeout message');
const readerSites = ['parseWorkbook', 'parseOrientationJsonFile'];
for (const site of readerSites) {
    assert.ok(importSourceIncludes(`function ${site}`), `${site} must remain callable`);
}
assert.ok(
    importSourceIncludes('ملف JSON للتوجيه كبير جداً (الحد الأقصى 20 MB). لم يُحفظ أي سجل.'),
    'orientation JSON size guard'
);
assert.ok(
    importSourceIncludes('انتهت مهلة قراءة ملف JSON للتوجيه. لم يُحفظ أي سجل.'),
    'orientation JSON timeout message'
);

// ─── F7: per-row validation on both bulk absence channels ──────────────────
assert.ok(ipcSrc.includes('validateAbsenceRow'), 'IPC exposes per-row validation');
assert.ok(ipcSrc.includes('validateAbsenceMonth'), 'IPC exposes month validation');
assert.ok(ipcSrc.includes("validateDate('absence_date', dateStr)"), 'absence_date validated like single-row save');
assert.ok(ipcSrc.includes("validateRange('hours', absence.hours, 0, 24)"), 'hours bounded 0..24');
assert.ok(ipcSrc.includes("validateRange('days', absence.days, 0, 31)"), 'days bounded 0..31');
assert.ok(ipcSrc.includes("'absences:saveBulk'"), 'saveBulk channel still registered');
assert.ok(ipcSrc.includes("'absences:replaceByYear'"), 'replaceByYear channel still registered');
assert.ok(ipcSrc.includes('options && options.confirm === true'), 'confirm flag bridged through IPC');

// ─── F8: destructive replace is gated on month coverage ────────────────────
assert.ok(repoSrc.includes('INCOMPLETE_COVERAGE'), 'repo reports incomplete coverage');
assert.ok(repoSrc.includes('missingMonths'), 'repo returns the missing months');
assert.ok(repoSrc.includes('canonicalMonth'), 'repo compares months canonically');
assert.ok(repoSrc.includes('opts && opts.confirm !== true'), 'guard active unless explicitly confirmed');
assert.ok(
    repoSrc.includes('لا يغطي كل سجلات الغياب المسجلة سابقاً لهذه السنة والسلك') ||
        repoSrc.includes('لا يغطي كل أشهر الغياب المسجلة سابقاً لهذه السنة والسلك'),
    'coverage refusal message'
);
assert.ok(importSourceIncludes('INCOMPLETE_COVERAGE'), 'import page handles the coverage response');
assert.ok(importSourceIncludes('showConfirm('), 'import page asks before a destructive replace');
assert.ok(
    preload.includes("ipcRenderer.invoke('absences:replaceByYear', schoolYear, absences, options)"),
    'preload bridges the confirm options payload'
);
assert.ok(
    preload.includes("addBulk: (students, auditType) => ipcRenderer.invoke('students:addBulk', students, auditType)"),
    'preload preserves the student-status audit type'
);

console.log('import-boundaries: OK');
