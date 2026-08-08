'use strict';

const assert = require('assert');
const ImportResultContract = require('../js/import-center/import-result-contract.js');

const technical = new Error('SQLITE_CONSTRAINT: UNIQUE failed at node_modules/better-sqlite3/index.js:22');
technical.code = 'DATABASE_ERROR';
const normalized = ImportResultContract.normalizeError(technical, {
    actionLabel: 'النقط',
    fileName: 'grades.xlsx'
});

assert.strictEqual(normalized.success, false);
assert.ok(normalized.userMessage.includes('الملف «grades.xlsx»'));
assert.ok(normalized.userMessage.includes('لم تُحفظ أي بيانات'));
assert.ok(!normalized.userMessage.includes('SQLITE'));
assert.ok(!normalized.userMessage.includes('node_modules'));
assert.strictEqual(normalized.noRecordsSaved, true);

const partial = new Error('database write failed');
partial.code = 'DATABASE_ERROR';
partial.partialCommit = true;
partial.noRecordsSaved = false;
const partialResult = ImportResultContract.normalizeError(partial, { fileName: 'students.xlsx' });
assert.ok(partialResult.userMessage.includes('تم حفظ جزء من البيانات'));
assert.strictEqual(partialResult.partialCommit, true);
assert.strictEqual(partialResult.noRecordsSaved, false);

const mismatch = ImportResultContract.createContextError('INSTITUTION_CODE_MISMATCH', {
    sourceCode: 'OTHER',
    destinationCode: 'LOCAL'
});
const mismatchMessage = ImportResultContract.message(mismatch, { fileName: 'students.xlsx' });
assert.ok(mismatchMessage.includes('رمز المؤسسة'));
assert.ok(mismatchMessage.includes('غيّر السنة أو اختر ملف المؤسسة'));

const unknownCodes = ImportResultContract.createContextError('UNKNOWN_STUDENT_CODES', {
    codes: ['A123', 'B456']
});
const unknownMessage = ImportResultContract.message(unknownCodes, { fileName: 'absences.xlsx' });
assert.ok(unknownMessage.includes('عدد الرموز غير المطابقة المعروضة: 2'));

const englishRaw = new Error('Unexpected parser failure');
const safeFallback = ImportResultContract.message(englishRaw, { actionLabel: 'الغياب' });
assert.ok(safeFallback.includes('تعذر إتمام الاستيراد'));
assert.ok(!safeFallback.includes('Unexpected parser failure'));

const selectionRequired = ImportResultContract.normalizeError({ code: 'CYCLE_SELECTION_REQUIRED' });
assert.strictEqual(selectionRequired.code, 'CYCLE_SELECTION_REQUIRED');
assert.strictEqual(selectionRequired.success, false);
assert.ok(selectionRequired.userMessage.includes('الشريط العلوي'));
assert.ok(selectionRequired.userMessage.includes('سجّل الدخول'));
assert.ok(!selectionRequired.userMessage.includes('INTERNAL_ERROR'));

const noUsableCycle = ImportResultContract.normalizeError({ code: 'NO_USABLE_CYCLE' });
assert.strictEqual(noUsableCycle.code, 'NO_USABLE_CYCLE');
assert.strictEqual(noUsableCycle.success, false);
assert.ok(
    noUsableCycle.userMessage.includes('فعّل') || noUsableCycle.userMessage.includes('الشريط العلوي'),
    'NO_USABLE_CYCLE must carry an enable/select-cycle remedy'
);

const selectionContextError = ImportResultContract.createContextError('CYCLE_SELECTION_REQUIRED');
assert.strictEqual(selectionContextError.code, 'CYCLE_SELECTION_REQUIRED');
assert.strictEqual(
    selectionContextError.message,
    ImportResultContract.CODE_MESSAGES.CYCLE_SELECTION_REQUIRED
);
assert.ok(selectionContextError.message.includes('الشريط العلوي'));

console.log('import-error-presentation: OK');
