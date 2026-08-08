'use strict';

// node tests/import-center/normalize-primitives.test.js

const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const Normalize = require('../../js/import-center/normalize.js');
const Diagnostics = require('../../js/import-center/import-diagnostics-codes.js');

// ── text ──
assert.strictEqual(Normalize.text('  abc  '), 'abc');
assert.strictEqual(Normalize.text(null), '');
assert.strictEqual(Normalize.text(undefined), '');
assert.strictEqual(Normalize.text(12), '12');

// ── toLatinDigits — Arabic-Indic ٠-٩ ──
assert.strictEqual(Normalize.toLatinDigits('١٢٣٤٥٦٧٨٩٠'), '1234567890');
assert.strictEqual(Normalize.toLatinDigits('G١٠٤٤٣٥٠'), 'G1044350');

// ── toLatinDigits — Persian ۰-۹ ──
assert.strictEqual(Normalize.toLatinDigits('۱۲۳۴۵۶۷۸۹۰'), '1234567890');
assert.strictEqual(Normalize.toLatinDigits('رقم ۴۵'), 'رقم 45');

// ── toLatinDigits — mixed scripts, Latin passthrough, blanks ──
assert.strictEqual(Normalize.toLatinDigits('١۰۲'), '102');
assert.strictEqual(Normalize.toLatinDigits('ABC123'), 'ABC123');
assert.strictEqual(Normalize.toLatinDigits(''), '');
assert.strictEqual(Normalize.toLatinDigits(null), '');
assert.strictEqual(Normalize.toLatinDigits('  ٩  '), '9');

// ── normalizeKey — NFD + combining marks + tashkeel + lowercase + alnum filter ──
assert.strictEqual(Normalize.normalizeKey('  Code ÉLÈVE  '), 'codeeleve');
assert.strictEqual(Normalize.normalizeKey('الفرض الأول'), 'الفرضالاول');
assert.strictEqual(Normalize.normalizeKey('رقم التلميذ'), 'رقمالتلميذ');
assert.strictEqual(Normalize.normalizeKey('الأستاذ: نور الدين'), 'الاستاذنورالدين');
assert.strictEqual(Normalize.normalizeKey('a-b_c d'), 'abcd');
assert.strictEqual(Normalize.normalizeKey(''), '');
assert.strictEqual(Normalize.normalizeKey(null), '');
assert.strictEqual(Normalize.normalizeKey('---'), '');
// NFKD input decomposes and is stripped like NFD (accented Latin)
assert.strictEqual(Normalize.normalizeKey('ÉCOLE'), 'ecole');
// Arabic combining marks (tashkeel) are removed, digits preserved
assert.strictEqual(Normalize.normalizeKey('الفَرْضُ'), 'الفرض');

// ── normalizeStudentCode ──
assert.strictEqual(Normalize.normalizeStudentCode('g160044350'), 'G160044350');
assert.strictEqual(Normalize.normalizeStudentCode("'k141097404"), 'K141097404');
assert.strictEqual(Normalize.normalizeStudentCode('  160.0 '), '160');
assert.strictEqual(Normalize.normalizeStudentCode('١٠٤٤٣٥٠'), '1044350');
assert.strictEqual(Normalize.normalizeStudentCode('۱۲۳'), '123');
assert.strictEqual(Normalize.normalizeStudentCode('a1 b2'), 'A1B2');
assert.strictEqual(Normalize.normalizeStudentCode(''), '');
assert.strictEqual(Normalize.normalizeStudentCode(null), '');
assert.strictEqual(Normalize.normalizeStudentCode("''"), '');

// ── excelDateToIso ──
assert.strictEqual(Normalize.excelDateToIso(40361), '2010-07-02');
assert.strictEqual(Normalize.excelDateToIso(25569), '1970-01-01');
assert.strictEqual(Normalize.excelDateToIso('2010-08-20'), '2010-08-20');
assert.strictEqual(Normalize.excelDateToIso('2024-03-05'), '2024-03-05');
assert.strictEqual(Normalize.excelDateToIso('20/08/2010'), '2010-08-20');
assert.strictEqual(Normalize.excelDateToIso('05/03/2024'), '2024-03-05');
assert.strictEqual(Normalize.excelDateToIso('3/3/2024'), '2024-03-03');
assert.strictEqual(Normalize.excelDateToIso('٠٥/٠٣/٢٠٢٤'), '2024-03-05');
assert.strictEqual(Normalize.excelDateToIso('not-a-date'), '');
assert.strictEqual(Normalize.excelDateToIso('March 5, 2024'), '');
assert.strictEqual(Normalize.excelDateToIso('12'), '');
assert.strictEqual(Normalize.excelDateToIso('2024'), '');
assert.strictEqual(Normalize.excelDateToIso(''), '');
assert.strictEqual(Normalize.excelDateToIso(null), '');
assert.strictEqual(Normalize.excelDateToIso(undefined), '');
assert.strictEqual(Normalize.excelDateToIso(1), '');
assert.strictEqual(Normalize.excelDateToIso(19999), '');
assert.strictEqual(Normalize.excelDateToIso(60001), '');

// ── parseStrictNumber — comma→dot, never coerce 0 ──
assert.strictEqual(Normalize.parseStrictNumber('12,5'), 12.5);
assert.strictEqual(Normalize.parseStrictNumber('12.5'), 12.5);
assert.strictEqual(Normalize.parseStrictNumber('٠'), 0);
assert.strictEqual(Normalize.parseStrictNumber('0'), 0);
assert.strictEqual(Normalize.parseStrictNumber('0,00'), 0);
assert.strictEqual(Normalize.parseStrictNumber(14), 14);
assert.strictEqual(Normalize.parseStrictNumber('-3'), -3);
assert.ok(Number.isNaN(Normalize.parseStrictNumber('')));
assert.ok(Number.isNaN(Normalize.parseStrictNumber(null)));
assert.ok(Number.isNaN(Normalize.parseStrictNumber('abc')));
assert.ok(Number.isNaN(Normalize.parseStrictNumber('12,5,5')));
assert.ok(Number.isNaN(Normalize.parseStrictNumber('3-')));
assert.ok(Number.isNaN(Normalize.parseStrictNumber(Infinity)));
assert.ok(Number.isNaN(Normalize.parseStrictNumber(NaN)));

// ── import-diagnostics-codes — SSOT shape ──
assert.strictEqual(Diagnostics.INVALID_GRADE, 'INVALID_GRADE');
assert.strictEqual(Diagnostics.STUDENT_CODE_MISSING, 'STUDENT_CODE_MISSING');
assert.strictEqual(Diagnostics.SCHOOL_MISMATCH, 'SCHOOL_MISMATCH');
assert.ok(Diagnostics.has('INVALID_GRADE'));
assert.ok(Diagnostics.has('MISSING_CODE_HEADER'));
assert.ok(Diagnostics.has('ZERO_VALID_ROWS'));
assert.ok(Diagnostics.has('UNKNOWN_XML_ROOT'));
assert.ok(!Diagnostics.has('NOT_A_CODE'));
assert.ok(Object.isFrozen(Diagnostics));

// ── dual-export globals ──
const sandbox = {};
vm.createContext(sandbox);
const sourceNormalize = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'import-center', 'normalize.js'), 'utf8');
const sourceDiagnostics = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'import-center', 'import-diagnostics-codes.js'), 'utf8');
vm.runInContext(sourceNormalize, sandbox, { filename: 'normalize.js' });
vm.runInContext(sourceDiagnostics, sandbox, { filename: 'import-diagnostics-codes.js' });
assert.strictEqual(typeof sandbox.ImportCenterNormalize.normalizeStudentCode, 'function');
assert.strictEqual(sandbox.ImportCenterNormalize.normalizeKey('الفرض الأول'), 'الفرضالاول');
assert.strictEqual(sandbox.ImportCenterDiagnostics.INVALID_GRADE, 'INVALID_GRADE');

console.log('normalize-primitives: OK');
