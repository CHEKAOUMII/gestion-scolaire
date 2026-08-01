'use strict';

// node tests/import-center/contextual-shortcuts.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Query = require('../../js/import-center/import-query-context.js');
const PostImport = require('../../js/import-center/import-post-import.js');

const root = path.join(__dirname, '..', '..');

// buildImportCenterUrl
const url1 = Query.buildImportCenterUrl({ type: 'grades', year: '2026-2027', source: 'grades-sheets' });
assert.ok(url1.startsWith('settings-imports.html?'));
assert.ok(url1.includes('type=grades'));
assert.ok(url1.includes('year=2026-2027'));
assert.ok(url1.includes('source=grades-sheets'));
assert.ok(!url1.includes('autoExecute') && !url1.includes('execute=1'));

const parsed = Query.parseQueryContext(url1.split('?')[1]);
assert.strictEqual(parsed.typeHint, 'grades');
assert.strictEqual(parsed.yearHint, '2026-2027');
assert.strictEqual(parsed.sourcePage, 'grades-sheets');
assert.strictEqual(parsed.autoExecute, false);
assert.strictEqual(parsed.isHintOnly, true);
assert.strictEqual(Query.AUTO_EXECUTE, false);

// SHORTCUT_PAGES catalog
assert.ok(Query.SHORTCUT_PAGES.length >= 6);
for (const sc of Query.SHORTCUT_PAGES) {
    const u = Query.buildImportCenterUrl({ type: sc.type, source: sc.source });
    const q = Query.parseQueryContext(u.split('?')[1] || '');
    assert.ok(q.typeHint, sc.page);
    assert.strictEqual(q.autoExecute, false);
}

// Functional pages contain contextual links
const pages = [
    ['students-list.html', 'type=students'],
    ['grades-sheets.html', 'type=grades'],
    ['absence-analytics.html', 'type=absences'],
    ['students-status.html', 'type=student-status'],
    ['teachers-list.html', 'type=agent-xml'],
    ['timetable.html', 'type=fet']
];
for (const [page, needle] of pages) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    assert.ok(html.includes('settings-imports.html'), `${page} links to import center`);
    assert.ok(html.includes(needle) || html.includes(needle.replace('=', '=')), `${page} has ${needle}`);
    assert.ok(html.includes('data-import-shortcut') || page === 'timetable.html', `${page} marks shortcut`);
    // No auto-execute flags
    assert.ok(!/autoExecute|auto-import|execute=1/i.test(html));
}

// timetable.js dynamic link
const ttJs = fs.readFileSync(path.join(root, 'js', 'pages', 'timetable.js'), 'utf8');
assert.ok(ttJs.includes("settings-imports.html?type=fet"));

// settings-imports keeps backup separate (smart preview flow + post-import module no longer loaded)
const settingsHtml = fs.readFileSync(path.join(root, 'settings-imports.html'), 'utf8');
assert.ok(settingsHtml.includes('ic-backup-region'), 'backup remains separate');

// Post-import boundaries are not session stores (module retained on disk)
assert.strictEqual(PostImport.isPostImportOnly(), true);
assert.ok(PostImport.VALIDATOR_TYPES.includes('grades'));
assert.ok(!PostImport.VALIDATOR_TYPES.includes('students')); // not in validator coverage

// Page controller retains readiness + cross-source validation on the manual path
const pageJs = fs.readFileSync(path.join(root, 'js', 'pages', 'settings-imports.js'), 'utf8');
assert.ok(pageJs.includes('DataSourceRegistry'));
assert.ok(pageJs.includes('CrossSourceValidator') || pageJs.includes('validateAfterImport'));

console.log('contextual-shortcuts: OK');
