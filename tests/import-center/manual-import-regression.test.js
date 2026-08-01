'use strict';

// node tests/import-center/manual-import-regression.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'settings-imports.html'), 'utf8');
const pageJs = fs.readFileSync(path.join(root, 'js', 'pages', 'settings-imports.js'), 'utf8');

const FILE_INPUTS = {
    students: 'students-file-input',
    grades: 'grades-file-input',
    absences: 'absences-file-input',
    fet: 'fet-file-input',
    'student-status': 'status-file-input',
    orientation: 'orientation-file-input',
    'agent-xml': 'agent-xml-file-input'
};

for (const [action, id] of Object.entries(FILE_INPUTS)) {
    assert.ok(html.includes(`id="${id}"`), `input ${id}`);
    assert.ok(html.includes(`data-action="${action}"`), `manual card ${action}`);
    assert.ok(pageJs.includes(`'${action}'`) || pageJs.includes(`"${action}"`), `action ${action} in page js`);
}

const fns = [
    'runImport',
    'handleImport',
    'importStudents',
    'importGrades',
    'importAbsences',
    'importFetXml',
    'importAgentXml',
    'importStudentStatus',
    'importOrientation',
    'detectSchoolYearFromWorkbook',
    'checkYearMismatch',
    'updateImportProgress',
    'renderImportStatusPanel',
    'logImport'
];
for (const fn of fns) {
    assert.ok(new RegExp(`function\\s+${fn}\\b`).test(pageJs), `function ${fn} must remain callable`);
}

// Manual path still wires FILE_INPUTS change -> handleImport
assert.ok(pageJs.includes('FILE_INPUTS'), 'FILE_INPUTS map');
assert.ok(pageJs.includes('await handleImport(action, files)'), 'manual handleImport path');

// Smart preview/review flow removed — manual direct import is the sole path
assert.ok(!pageJs.includes('initSmartImportCenter'), 'smart bootstrap removed');
assert.ok(
    !html.includes('ic-queue-region') && !html.includes('ic-confirm-region') && !html.includes('ic-review-region'),
    'smart UI regions removed'
);

// Backup remains outside smart session
assert.ok(html.includes('create-backup-btn'));
assert.ok(html.includes('BackupManager') || fs.readFileSync(path.join(root, 'js', 'backup.js'), 'utf8').includes('BackupManager'));

console.log('manual-import-regression: OK');
