'use strict';

// node tests/import-center/package-7-cleanup.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const pageJs = fs.readFileSync(path.join(root, 'js', 'pages', 'settings-imports.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'settings-imports.html'), 'utf8');

// 7.1 — dead silent drop path removed; smart preview flow also removed; manual path is sole importer
assert.ok(!/function\s+initDropZone\b/.test(pageJs), 'initDropZone must be removed as proven duplicate');
assert.ok(!pageJs.includes('initSmartImportCenter'), 'smart center removed');
assert.ok(pageJs.includes('function runImport'), 'runImport wrapper preserved');
assert.ok(pageJs.includes('async function handleImport') || pageJs.includes('function handleImport'));

// Manual functions still present
for (const fn of [
    'importStudents',
    'importGrades',
    'importAbsences',
    'importFetXml',
    'importAgentXml',
    'importStudentStatus',
    'importOrientation'
]) {
    assert.ok(new RegExp(`function\\s+${fn}\\b`).test(pageJs), fn);
}

// Manual input IDs preserved
for (const id of [
    'students-file-input',
    'grades-file-input',
    'absences-file-input',
    'fet-file-input',
    'status-file-input',
    'orientation-file-input',
    'agent-xml-file-input'
]) {
    assert.ok(html.includes(`id="${id}"`), id);
}

// No broad rewrite markers — manual accordion still in HTML
assert.ok(html.includes('اختيار نوع الاستيراد يدوي') || html.includes('ic-manual'));
assert.ok(html.includes('ic-backup-region'));

// CSS source only (not editing generated output by hand as source of truth)
assert.ok(fs.existsSync(path.join(root, 'css', 'tailwind-input.css')));
assert.ok(fs.existsSync(path.join(root, 'css', 'tailwind-output.css')));

// 7.2 — persistence decision exists; no Job tables created
const decision = fs.readFileSync(path.join(root, 'docs', 'import-center', 'persistence-decision.md'), 'utf8');
assert.ok(decision.includes('import_jobs') || decision.includes('Jobs'));
assert.ok(/renderer-memory|ذاكرة|memory-first|Renderer-memory/i.test(decision));
assert.ok(/12\.1|12.1|requirements 12/i.test(decision));
assert.ok(/separately approved|قرار لاحق|approved/i.test(decision));

// Migration notes document retained wrappers
const mig = fs.readFileSync(path.join(root, 'docs', 'import-center', 'migration-notes.md'), 'utf8');
assert.ok(mig.includes('runImport'));
assert.ok(mig.includes('initDropZone'));

// No schema for import jobs in migrations
const migrations = fs.readFileSync(path.join(root, 'main', 'db', 'migrations.js'), 'utf8');
assert.ok(!/CREATE TABLE\s+import_jobs/i.test(migrations));
assert.ok(!/CREATE TABLE\s+import_files/i.test(migrations));
assert.ok(!/CREATE TABLE\s+import_errors/i.test(migrations));

console.log('package-7-cleanup: OK');
