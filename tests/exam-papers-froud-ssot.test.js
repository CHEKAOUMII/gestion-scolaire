'use strict';

// CH7: exam-papers must not re-declare the exam-count subject table.
// SSOT is main/db/exam-count-defaults.js via window.api.appDefaults.
//
//   node tests/exam-papers-froud-ssot.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const pagePath = path.join(__dirname, '..', 'js', 'pages', 'exam-papers.js');
const src = fs.readFileSync(pagePath, 'utf8');

assert.ok(!/\bFROUD_FALLBACK\b/.test(src), 'exam-papers.js must not define FROUD_FALLBACK');
assert.ok(!/function\s+froudCountFallback\b/.test(src), 'exam-papers.js must not define froudCountFallback');

// Must use IPC SSOT surface
assert.ok(
    /appDefaults\.getExamCounts/.test(src) || /getExamCounts\s*\(/.test(src),
    'exam-papers.js must call appDefaults.getExamCounts for bulk warm'
);
assert.ok(
    /appDefaults\.getExamCount/.test(src) || /getExamCount\s*\(/.test(src),
    'exam-papers.js must call appDefaults.getExamCount as single-subject fallback'
);
assert.ok(/warmFroudCache/.test(src), 'exam-papers.js must pre-warm cache via warmFroudCache');
assert.ok(/DEFAULT_FROUD_COUNT/.test(src), 'exam-papers.js may keep a single numeric default only');

// Must not embed multi-row Arabic subject→count table (heuristic: many pairs of subject+count)
const tableLike = src.match(/\['الرياضيات',\s*3\]/);
assert.ok(!tableLike, 'exam-papers.js must not embed local subject exam-count rows');

// Main SSOT still owns the table
const defaultsPath = path.join(__dirname, '..', 'main', 'db', 'exam-count-defaults.js');
const defaultsSrc = fs.readFileSync(defaultsPath, 'utf8');
assert.ok(
    /DEFAULT_EXAM_COUNTS/.test(defaultsSrc) && /\['الرياضيات',\s*3\]/.test(defaultsSrc),
    'main/db/exam-count-defaults.js remains the exam-count SSOT'
);

console.log('exam-papers-froud-ssot: OK');
