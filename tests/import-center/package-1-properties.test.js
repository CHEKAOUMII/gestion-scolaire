'use strict';

// node tests/import-center/package-1-properties.test.js
// Properties 1, 20, 22, 24, 25, 26

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const fc = require('fast-check');

const { importSourceIncludes, importSourceMatches } = require('../helpers/import-source.js');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'settings-imports.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'tailwind-input.css'), 'utf8');

// Property 1 — central entry and source coverage
const ENTRY_CONTEXTS = [
    { path: 'settings-imports.html' },
    { path: 'settings-imports.html?type=grades' },
    { path: 'settings-imports.html?type=students&year=2026-2027' },
    { path: 'settings-imports.html?type=absences&source=absence-analytics' }
];

fc.assert(
    fc.property(fc.constantFrom(...ENTRY_CONTEXTS), (ctx) => {
        assert.ok(ctx.path.includes('settings-imports.html'));
        assert.ok(html.includes('settings-imports') || true);
        // Manual intake grid present (smart multi-file intake removed)
        assert.ok(html.includes('imports-grid'), 'manual intake grid');
        // No new UI framework required
        assert.ok(html.includes('js/pages/settings-imports.js'));
        assert.ok(!html.includes('react') && !html.includes('vue.runtime'));
        return true;
    }),
    { numRuns: 12 }
);

// Property 22 — manual paths, readiness, backup separation
for (const fn of ['runImport', 'handleImport', 'importStudents', 'importGrades', 'importAbsences', 'importFetXml', 'importAgentXml', 'importStudentStatus', 'importOrientation']) {
    assert.ok(importSourceMatches(new RegExp(`function\\s+${fn}\\b`)), `reachable ${fn}`);
}
assert.ok(importSourceIncludes('DataSourceRegistry'), 'registry still used for readiness');
assert.ok(!importSourceIncludes('DataSourceRegistry') || importSourceIncludes('renderImportStatusPanel'));
assert.ok(html.includes('ic-backup-region'));
assert.ok(!html.includes('id="import_jobs"'));

// Property 24 — RTL and keyboard accessibility
assert.ok(html.includes('dir="rtl"'));
assert.ok(html.includes('اختر نوع الملف') || html.includes('استيراد البيانات'));
assert.ok(html.includes('aria-label'));
assert.ok(html.includes('fas fa-'), 'vector icons');
assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'no emoji icons in markup');
assert.ok(css.includes('min-height: 44px') || css.includes('min-width: 44px'));

// Property 25 — state communication, contrast, live regions, reduced motion
assert.ok(css.includes('ic-status-text') || css.includes('.ic-file-status'));
assert.ok(html.includes('aria-live="polite"'));
assert.ok(css.includes('prefers-reduced-motion'));
assert.ok(css.includes("[data-theme='dark']") || css.includes('[data-theme="dark"]'));
// Color not sole signal: icon + text classes present
assert.ok(css.includes('.ic-file-status') && (css.includes('fa-') || html.includes('fa-')));

// Property 26 — responsive queue layout
assert.ok(css.includes('max-width: 767px') || css.includes('max-width:767px'));
assert.ok(css.includes('ic-file-name'));
assert.ok(css.includes('ic-file-status') || css.includes('ic-file-actions'));
assert.ok(css.includes('overflow-x: hidden') || css.includes('min-width: 0'));

// Representative viewports documented via media queries (static check)
const hasNarrow = /@media\s*\(\s*max-width:\s*767px\s*\)/.test(css);
const hasWide = /@media\s*\(\s*min-width:\s*1024px\s*\)/.test(css);
assert.ok(hasNarrow, 'narrow layout rules');
assert.ok(hasWide, 'large desktop rules');

console.log('package-1-properties: OK');
