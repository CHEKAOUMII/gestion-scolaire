'use strict';

// node tests/import-center/manual-import-regression.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importSourceIncludes, importSourceMatches } = require('../helpers/import-source.js');


const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'settings-imports.html'), 'utf8');

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
    assert.ok(importSourceIncludes(`'${action}'`) || importSourceIncludes(`"${action}"`), `action ${action} in page js`);
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
    assert.ok(importSourceMatches(new RegExp(`function\\s+${fn}\\b`)), `function ${fn} must remain callable`);
}

// Manual path still wires FILE_INPUTS change -> handleImport
assert.ok(importSourceIncludes('FILE_INPUTS'), 'FILE_INPUTS map');
assert.ok(importSourceIncludes('await handleImport(action, files)'), 'manual handleImport path');
assert.ok(importSourceIncludes('runManualImportPreflight'), 'manual path runs read-only preflight');
assert.ok(importSourceIncludes('persist: false'), 'preflight parsers use non-persisting mode');



// Regression: the unified header replaces its original markup, so the grade semester
// selector must live in the manual import region where operators can use it.
assert.ok(html.indexOf('id="semester-select"') > html.indexOf('id="ic-manual-region"'), 'grade semester selector remains visible after header unification');

// Smart preview/review flow removed — manual direct import is the sole path
assert.ok(!importSourceIncludes('initSmartImportCenter'), 'smart bootstrap removed');
assert.ok(
    !html.includes('ic-queue-region') && !html.includes('ic-confirm-region') && !html.includes('ic-review-region'),
    'smart UI regions removed'
);

// Backup remains outside smart session
assert.ok(html.includes('create-backup-btn'));
assert.ok(html.includes('BackupManager') || fs.readFileSync(path.join(root, 'js', 'backup.js'), 'utf8').includes('BackupManager'));

// Phase 1 — shared teacher identity (deterministic key) replaces the fuzzy strict
// resolver for the tafwij panel and grades/FET imports
assert.ok(html.includes('js/shared/teacher-identity.js'), 'teacher-identity shared script is loaded');
assert.ok(importSourceIncludes('PencilShared.TeacherIdentity'), 'page references the shared teacher-identity module');
assert.ok(importSourceIncludes('function getTeacherIdentityModule'), 'shared-module loader present');
assert.ok(importSourceIncludes('function buildTeacherIdentityIndex'), 'identity index builder present');
assert.ok(importSourceIncludes('function buildSharedKeyTeacherResolver'), 'shared-key resolver present');
assert.ok(!importSourceIncludes('function buildTeacherResolver('), 'fuzzy strict resolver removed');
assert.ok(!importSourceIncludes('normalizeTeacherMatchKey'), 'legacy match-key helper removed');

// A single grade file applies its explicit semester before the save-time cross-check.
assert.ok(importSourceIncludes('function applyDetectedSemesterForSingleGradeFile'), 'single-file semester auto-selection is available');
assert.ok(importSourceIncludes('fileCount !== 1'), 'multi-file grade imports keep their explicit semester selection');
assert.ok(importSourceIncludes('semesterSelect.value = String(detectedSemester)'), 'detected semester updates the page selector');
assert.ok(importSourceIncludes('autoSelectSemester: fileList.length === 1'), 'single-file commit receives the semester auto-selection option');
assert.ok(importSourceIncludes('if (options.autoSelectSemester) applyDetectedSemesterForSingleGradeFile(parsed.metadata.semester, 1)'), 'commit re-applies the parser semester before its final guard');

// F24 — semester cross-check runs before saveBulk in the grades path
assert.ok(importSourceIncludes('resolveSemesterDecision(parsed.metadata.semester, getSelectedSemester())'), 'grades path cross-checks parser vs page semester');
assert.ok(importSourceIncludes("mismatchError.code = 'SEMESTER_MISMATCH'"), 'semester mismatch is signaled with SEMESTER_MISMATCH');

// F15 — single progress icon per update, totals accumulate across files
assert.ok(importSourceIncludes('t.replaceChildren(icon'), 'progress title replaces children instead of appending');
assert.ok(importSourceIncludes('totalGradesImported += gradeResult.gradesCount'), 'grades totals accumulate across files');

// F16 — no hardcoded school-year fallback left in the page
assert.ok(!importSourceIncludes("'2025/2026'") && !importSourceIncludes('"2025/2026"'), 'no hardcoded school-year fallback');

// Import debug noise removed from FET/agent-XML paths
assert.ok(!importSourceIncludes('[FET import] Canonical teacher resolver ready'), 'FET resolver debug log removed');
assert.ok(!importSourceIncludes('[agent-xml] Lookup tables built'), 'agent-xml lookup debug log removed');

console.log('manual-import-regression: OK');
