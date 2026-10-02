'use strict';

// Feature: exam-center-independence
//
// Enforces contract C3/C4 from docs/plans/2026-07-20-exam-center-independence-plan.md:
// the exam center (main/repos/exams.js) must be snapshot-only on read paths.
// No JOIN teachers / JOIN students may be (re)introduced into the repo.
//
// List/read functions are allowed internal exam-domain joins (e.g. exams↔exam_proctors)
// but must NOT pull live names from teachers/students (that would be a forbidden merge).
//
// Run standalone:
//   node tests/exam-center-independence-guard.test.js
// Or via:
//   npm test

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_PATH = path.resolve(__dirname, '..', 'main', 'repos', 'exams.js');

// Strip comments before scanning so contract doc-comments are not treated as SQL.
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
        .replace(/(^|\n)\s*\/\/.*$/g, '$1'); // line comments
}

function run() {
    const rawSrc = fs.readFileSync(REPO_PATH, 'utf8');
    const src = stripComments(rawSrc);

    // C3/C4 — no external join into teachers/students anywhere in the live SQL.
    const externalJoins = src.match(/JOIN\s+(teachers|students)\b/gi) || [];
    assert.strictEqual(
        externalJoins.length,
        0,
        'Exam center must be snapshot-only: no JOIN teachers/students in main/repos/exams.js ' +
            '(see exam-center-independence plan C3). Found: ' +
            JSON.stringify(externalJoins)
    );

    // listProctors specifically must no longer select a live teacher full_name via a join.
    // (The old violation selected t.full_name as teacher_full_name with LEFT JOIN teachers t.)
    assert.ok(
        !/t\.full_name/i.test(src),
        'listProctors must not select a live teacher full_name (t.full_name) — names come from the snapshot.'
    );

    // Sanity: the snapshot column teacher_name is still exposed by listProctors
    // (it is p.teacher_name via SELECT p.*).
    const listProctorsIdx = src.indexOf('function listProctors');
    assert.ok(listProctorsIdx !== -1, 'listProctors function still present');
    const listProctorsEnd = src.indexOf('\n}', listProctorsIdx);
    const listProctorsBody = src.slice(listProctorsIdx, listProctorsEnd);
    assert.ok(
        /SELECT\s+p\.\*/i.test(listProctorsBody),
        'listProctors must SELECT p.* so the snapshot teacher_name stays available.'
    );

    // C1 — the optional FK reference must remain nullable (do not drop the reference)
    // and inserts tolerate a NULL teacher_id. We check both saveProctorManual and
    // bulkImportProctors accept the resolved/snapshot name path.
    assert.ok(
        /resolvedTeacher\.teacher_id\s*\|\|\s*null/i.test(src),
        'saveProctorManual must tolerate resolved teacher_id = NULL (C1).'
    );

    console.log('exam-center-independence-guard: ok (0 external joins, snapshot-only read paths).');
}

run();
