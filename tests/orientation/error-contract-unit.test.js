'use strict';

// node tests/orientation/error-contract-unit.test.js

const assert = require('assert');
const path = require('path');

const contract = require('../../js/shared/errors/orientation-error-contract');
const {
    SHARED_CODES,
    PAGE_ONLY_CODES,
    LOCKED_SHARED_CODES,
    getDefinition,
    isShared,
    isPageOnly,
    isRetryable,
    getSeverity,
    getDefaultMessage,
    normalize,
    unknownFallback,
    safeDetails,
    userMessage
} = contract;

function assertDef(code, section) {
    const d = getDefinition(code);
    assert.ok(d, `missing definition for ${code}`);
    assert.strictEqual(typeof d.message, 'string');
    assert.ok(d.message.length > 0, `${code} message empty`);
    assert.ok(['info', 'warning', 'error'].includes(d.severity), `${code} severity`);
    assert.strictEqual(typeof d.retryable, 'boolean');
    assert.ok(
        ['validation', 'domain', 'infrastructure', 'transport', 'display'].includes(d.classification),
        `${code} classification`
    );
    assert.strictEqual(d.section, section);
}

// ── Completeness ──
for (const code of Object.keys(SHARED_CODES)) {
    assertDef(code, 'shared');
    assert.ok(isShared(code));
    assert.ok(!isPageOnly(code));
}
for (const code of Object.keys(PAGE_ONLY_CODES)) {
    assertDef(code, 'pageOnly');
    assert.ok(isPageOnly(code));
    assert.ok(!isShared(code));
}

// Locked shared codes
for (const code of LOCKED_SHARED_CODES) {
    assert.ok(SHARED_CODES[code], `locked code missing: ${code}`);
}

assert.strictEqual(isRetryable('IMPORT_ROLLBACK'), true);
assert.strictEqual(isRetryable('INVALID_RECORD'), false);
assert.strictEqual(isRetryable('INVALID_SCHOOL_YEAR'), false);
assert.strictEqual(getSeverity('DATABASE_ERROR'), 'error');
assert.ok(/YYYY\/YYYY/.test(getDefaultMessage('INVALID_SCHOOL_YEAR')));

// Page-only display codes (US2)
assert.ok(PAGE_ONLY_CODES.STALE_RESPONSE);
assert.ok(PAGE_ONLY_CODES.YEAR_RESPONSE_MISMATCH);
assert.ok(PAGE_ONLY_CODES.CHART_RENDER_ERROR);
assert.strictEqual(PAGE_ONLY_CODES.STALE_RESPONSE.severity, 'info');
assert.strictEqual(PAGE_ONLY_CODES.STALE_RESPONSE.retryable, true);
assert.strictEqual(PAGE_ONLY_CODES.YEAR_RESPONSE_MISMATCH.retryable, true);
assert.strictEqual(PAGE_ONLY_CODES.CHART_RENDER_ERROR.retryable, true);

// Unknown fallback
const unk = unknownFallback();
assert.strictEqual(unk.success, false);
assert.strictEqual(unk.code, 'INTERNAL_ERROR');
assert.ok(/[\u0600-\u06FF]/.test(unk.message));
assert.ok(!String(unk.message).includes('SOME_UNKNOWN_CODE'));

// normalize: lean
const lean = normalize({ success: false, code: 'DATABASE_ERROR', error: 'تعذر حفظ أو قراءة سجلات التوجيه من قاعدة البيانات.' });
assert.strictEqual(lean.success, false);
assert.strictEqual(lean.code, 'DATABASE_ERROR');
assert.strictEqual(lean.message, lean.error);
assert.strictEqual(lean.retryable, true);
assert.strictEqual(lean.severity, 'error');
assert.strictEqual(lean.section, 'shared');
assert.strictEqual(lean.details, null);

// normalize: lean with missing message fields → catalog default
const lean2 = normalize({ success: false, code: 'LIST_LOAD_ERROR', error: '' });
assert.strictEqual(lean2.code, 'LIST_LOAD_ERROR');
assert.strictEqual(lean2.message, getDefaultMessage('LIST_LOAD_ERROR'));

// normalize: rich
const rich = normalize({
    success: false,
    code: 'IMPORT_ROLLBACK',
    error: getDefaultMessage('IMPORT_ROLLBACK'),
    message: getDefaultMessage('IMPORT_ROLLBACK'),
    details: { inserted: 10, updated: 2, schoolYear: '2025/2026' },
    retryable: true
});
assert.strictEqual(rich.code, 'IMPORT_ROLLBACK');
assert.strictEqual(rich.retryable, true);
assert.ok(rich.details);
assert.strictEqual(rich.details.inserted, 10);
assert.strictEqual(rich.details.schoolYear, '2025/2026');

// normalize: success passthrough
const ok = normalize({ success: true, inserted: 1 });
assert.strictEqual(ok.success, true);
assert.strictEqual(ok.inserted, 1);

// normalize: unknown code + unsafe message → INTERNAL_ERROR + generic safe text (FR-006)
const bad = normalize({ success: false, code: 'TOTALLY_FAKE_CODE', error: 'SQLITE_ERROR no such table' });
assert.strictEqual(bad.success, false);
assert.strictEqual(bad.code, 'INTERNAL_ERROR');
assert.ok(!/SQLITE/.test(bad.message));
assert.ok(!/TOTALLY_FAKE/.test(bad.message));
assert.ok(!/TOTALLY_FAKE/.test(bad.code));

// normalize: unknown code + safe Arabic message → still force INTERNAL_ERROR (FR-006), keep Arabic text
const badAr = normalize({
    success: false,
    code: 'TOTALLY_FAKE_CODE',
    error: 'تعذر إكمال العملية مؤقتاً.'
});
assert.strictEqual(badAr.code, 'INTERNAL_ERROR');
assert.strictEqual(badAr.message, 'تعذر إكمال العملية مؤقتاً.');
assert.strictEqual(badAr.error, 'تعذر إكمال العملية مؤقتاً.');
assert.strictEqual(badAr.classification, 'infrastructure');
assert.strictEqual(badAr.section, 'unknown');

// normalize: auth lean codes keep their code (not remapped to INTERNAL_ERROR)
const authLean = normalize({ success: false, code: 'UNAUTHENTICATED', error: 'يجب تسجيل الدخول' });
assert.strictEqual(authLean.code, 'UNAUTHENTICATED');
assert.ok(/[\u0600-\u06FF]/.test(authLean.message));

// normalize: internal English error text stripped for known code
const internal = normalize({
    success: false,
    code: 'DATABASE_ERROR',
    error: 'Error: SQLITE_CONSTRAINT at main/repos/orientation.js:12'
});
assert.strictEqual(internal.code, 'DATABASE_ERROR');
assert.strictEqual(internal.message, getDefaultMessage('DATABASE_ERROR'));

// safeDetails: strip unsafe
const stripped = safeDetails({
    schoolYear: '2025/2026',
    inserted: 3,
    sql: 'SELECT * FROM students',
    stack: 'Error: boom\n    at foo.js:1',
    absolutePath: 'C:\\Users\\secret\\file.xlsx',
    token: 'abc',
    students: [{ name: 'Ali', code: '1' }, { name: 'Sara', code: '2' }],
    operation: 'bulkUpsert',
    skipReasons: Array.from({ length: 100 }, (_, i) => ({ reason: 'x', i }))
});
assert.ok(stripped);
assert.strictEqual(stripped.schoolYear, '2025/2026');
assert.strictEqual(stripped.inserted, 3);
assert.strictEqual(stripped.operation, 'bulkUpsert');
assert.ok(!stripped.sql);
assert.ok(!stripped.stack);
assert.ok(!stripped.absolutePath);
assert.ok(!stripped.token);
assert.ok(!stripped.students);
assert.ok(Array.isArray(stripped.skipReasons));
assert.ok(stripped.skipReasons.length <= 40);

// safeDetails: null / non-object
assert.strictEqual(safeDetails(null), null);
assert.strictEqual(safeDetails('x'), null);

// userMessage core + context (FR-002a: append/frame, do not replace core)
assert.strictEqual(userMessage('IMPORT_ROLLBACK'), getDefaultMessage('IMPORT_ROLLBACK'));
const framed = userMessage('IMPORT_ROLLBACK', 'سياق إضافي');
assert.strictEqual(framed, getDefaultMessage('IMPORT_ROLLBACK') + ' — ' + 'سياق إضافي');
assert.ok(framed.startsWith(getDefaultMessage('IMPORT_ROLLBACK')));
assert.ok(framed.includes('سياق إضافي'));
// identical context is not doubled
assert.strictEqual(
    userMessage('IMPORT_ROLLBACK', getDefaultMessage('IMPORT_ROLLBACK')),
    getDefaultMessage('IMPORT_ROLLBACK')
);

// No DOM / toast / Electron / SQLite references in module body (pure; comments may mention bans)
const fs = require('fs');
const src = fs.readFileSync(path.join(__dirname, '../../js/shared/errors/orientation-error-contract.js'), 'utf8');
const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
assert.ok(!/\bshowToast\b/.test(codeOnly));
assert.ok(!/\bdocument\./.test(codeOnly));
assert.ok(!/require\(['"]electron['"]\)/.test(codeOnly));
assert.ok(!/better-sqlite3/.test(codeOnly));

// IPC orientation still maps locked codes after wiring (soft check — module must load)
const orientationIpc = require('../../main/ipc/orientation');
assert.strictEqual(typeof orientationIpc.toOrientationErrorResponse, 'function');
const mapped = orientationIpc.toOrientationErrorResponse(new Error('SQLITE boom'), 'DATABASE_ERROR');
assert.strictEqual(mapped.success, false);
assert.ok(mapped.code === 'DATABASE_ERROR' || mapped.code === 'IMPORT_ROLLBACK' || mapped.code === 'SYNC_ERROR');
assert.ok(/[\u0600-\u06FF]/.test(mapped.error || mapped.message));
assert.ok(!/SQLITE/.test(mapped.error || ''));
assert.ok(!/\.js:\d+/.test(mapped.error || ''));

// Catalog export compatibility
assert.ok(orientationIpc.ORIENTATION_ERROR_CATALOG);
assert.ok(orientationIpc.ORIENTATION_ERROR_CATALOG.IMPORT_ROLLBACK);
assert.strictEqual(
    orientationIpc.ORIENTATION_ERROR_CATALOG.IMPORT_ROLLBACK.retryable,
    true
);

// Auth lean-like unknown stays safe
const leanAuth = normalize({ success: false, code: 'UNAUTHENTICATED', error: 'يجب تسجيل الدخول' });
assert.strictEqual(leanAuth.success, false);
assert.ok(/[\u0600-\u06FF]/.test(leanAuth.message));

console.log('error-contract-unit: all assertions passed');
