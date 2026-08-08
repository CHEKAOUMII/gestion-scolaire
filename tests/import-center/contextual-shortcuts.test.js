'use strict';

// node tests/import-center/contextual-shortcuts.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');

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

// Page controller retains readiness + cross-source validation on the manual path
const pageJs = fs.readFileSync(path.join(root, 'js', 'pages', 'settings-imports.js'), 'utf8');
assert.ok(pageJs.includes('DataSourceRegistry'));
assert.ok(pageJs.includes('CrossSourceValidator') || pageJs.includes('validateAfterImport'));

// T2.5 — settings-imports handles ?type= deep link (hint, never auto-executes)
assert.ok(pageJs.includes('URLSearchParams'), 'page reads ?type= via URLSearchParams');
assert.ok(pageJs.includes('FILE_INPUTS'), 'page maps ?type= via FILE_INPUTS');
assert.ok(pageJs.includes('scrollIntoView'), 'deep link scrolls card into view');
assert.ok(pageJs.includes('ring-2') || pageJs.includes('focus'), 'deep link highlights card');
assert.ok(!/runImport\(.*type.*\)/.test(pageJs) || !pageJs.includes('autoExecute'), 'deep link never auto-executes runImport');

console.log('contextual-shortcuts: OK');
