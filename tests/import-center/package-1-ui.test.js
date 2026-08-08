'use strict';

// node tests/import-center/package-1-ui.test.js
// Page contract after the smart preview/review flow was removed:
// manual direct import is the sole importer; smart intake/queue/review/confirm UI is gone.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importSourceIncludes, importSourceMatches } = require('../helpers/import-source.js');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'settings-imports.html'), 'utf8');
const pageJs = fs.readFileSync(path.join(root, 'js', 'pages', 'settings-imports.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'tailwind-input.css'), 'utf8');

// Manual file inputs preserved
const PROTECTED_INPUTS = [
    'students-file-input',
    'grades-file-input',
    'absences-file-input',
    'fet-file-input',
    'status-file-input',
    'orientation-file-input',
    'agent-xml-file-input'
];
for (const id of PROTECTED_INPUTS) {
    assert.ok(html.includes(`id="${id}"`), `preserved input ${id}`);
}

// Remaining regions after redesign
const regions = [
    'ic-readiness-region',
    'ic-progress-region',
    'ic-manual-region',
    'ic-log-region',
    'ic-data-region',
    'ic-backup-region'
];
for (const id of regions) {
    assert.ok(html.includes(`id="${id}"`), `region ${id}`);
}

// Smart preview/review UI must be gone
for (const id of [
    'ic-intake-region',
    'ic-queue-region',
    'ic-review-region',
    'ic-confirm-region',
    'ic-session-report',
    'smart-multi-file-input',
    'drop-zone',
    'ic-start-import-btn'
]) {
    assert.ok(!html.includes(`id="${id}"`), `smart element ${id} removed`);
}

// Manual import cards
for (const action of ['students', 'grades', 'absences', 'fet', 'student-status', 'orientation', 'agent-xml']) {
    assert.ok(html.includes(`data-action="${action}"`), `manual card ${action}`);
}

// Backup separate
assert.ok(html.includes('ic-backup-region') || html.includes('النسخ الاحتياطي والاستعادة'), 'backup section');
assert.ok(html.includes('create-backup-btn') && html.includes('restore-backup-btn'), 'backup buttons');

// Logs pagination (5 per page)
assert.ok(html.includes('id="import-logs-pagination"'), 'logs pagination bar');
assert.ok(html.includes('id="import-logs-prev"') && html.includes('id="import-logs-next"'), 'logs pagination buttons');
assert.ok(importSourceMatches(/LOGS_PAGE_SIZE\s*=\s*5/), 'logs page size is 5');
assert.ok(importSourceIncludes('renderImportLogsPage'), 'logs page renderer');

// Accessibility
assert.ok(html.includes('aria-live="polite"'), 'aria-live polite');
assert.ok(html.includes('dir="rtl"'), 'RTL document');
assert.ok(html.includes('lang="ar"'), 'Arabic lang');

// Controller: manual path preserved, smart bootstrap removed
assert.ok(!pageJs.includes('initSmartImportCenter'), 'smart center bootstrap removed');
assert.ok(importSourceIncludes('function runImport'), 'runImport preserved');
assert.ok(importSourceIncludes('async function handleImport') || importSourceIncludes('function handleImport'), 'handleImport preserved');
assert.ok(importSourceIncludes('detectSchoolYearFromWorkbook'), 'year detect preserved');
assert.ok(importSourceIncludes('checkYearMismatch'), 'year mismatch preserved');
assert.ok(importSourceIncludes('updateImportProgress'), 'progress preserved');
assert.ok(importSourceIncludes('renderImportStatusPanel'), 'status panel preserved');
assert.ok(importSourceIncludes('logImport'), 'logImport preserved');
for (const fn of [
    'importStudents',
    'importGrades',
    'importAbsences',
    'importFetXml',
    'importAgentXml',
    'importStudentStatus',
    'importOrientation'
]) {
    assert.ok(importSourceIncludes(fn), fn);
}
assert.ok(!/function\s+initDropZone\b/.test(pageJs), 'legacy silent drop path removed');

// Smart-only script includes trimmed; manual dependencies kept
for (const src of [
    'js/import-center/import-center-view.js',
    'js/import-center/import-orchestrator.js',
    'js/import-center/import-classifier.js',
    'js/import-center/import-session.js'
]) {
    assert.ok(!html.includes(src), `smart script ${src} removed`);
}
assert.ok(html.includes('js/data-source-registry.js'), 'data source registry kept');
assert.ok(html.includes('js/cross-source-validator.js'), 'cross-source validator kept');
assert.ok(html.includes('js/pages/settings-imports.js'), 'page script kept');

// CSS source: side-by-side readiness + pagination styling
assert.ok(css.includes('.ic-pagination'), 'pagination styles');
assert.ok(css.includes('repeat(auto-fit'), 'readiness side-by-side grid');
assert.ok(css.includes('prefers-reduced-motion'), 'reduced motion');

// No emoji structural icons
assert.ok(!html.includes('📁') && !html.includes('✅'), 'no emoji structural icons');

console.log('package-1-ui: OK');
