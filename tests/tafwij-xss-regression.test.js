'use strict';

// Regression: import-pipeline review F1 (2026-08-04) — the tafwij matching panel
// interpolated FET <Subject name> values into innerHTML without escaping. The panel
// renders attacker-controlled file data (teacher names, subjects), so the escaping
// is a security invariant. Assertions are static-source: the page ships as a single
// renderer file and the established pattern for settings-imports.js tests reads the
// source (see tests/import-center/manual-import-regression.test.js).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importSourceIncludes, importSourceMatches } = require('./helpers/import-source.js');


const root = path.join(__dirname, '..');
const pageJs = fs.readFileSync(path.join(root, 'js', 'pages', 'settings-imports.js'), 'utf8');

// F1: the subjects hint (FET <Subject name> values joined with ', ') must be escaped
// before the innerHTML interpolation in the tafwij row build.
assert.ok(
    importSourceMatches(/escapeHtml\(\s*subjectsHint\s*\)/),
    'subjectsHint must be wrapped in escapeHtml before innerHTML'
);

// F1: the escaped value must be the one interpolated into the panel body.
assert.ok(
    importSourceIncludes('مواد الحصص: ${escapeHtml(subjectsHint)}'),
    'panel body must interpolate the escaped subjects hint'
);

// F1: every attacker-controlled value in the tafwij row build is escaped.
const tafwijRowEscapes = [
    'escapeHtml(entry.key)',
    'escapeHtml(entry.sourceDisplayName)',
    'escapeHtml(entry.sourceName)',
    'escapeHtml(candidate.full_name)'
];
for (const call of tafwijRowEscapes) {
    assert.ok(importSourceIncludes(call), `tafwij row build must escape ${call}`);
}

// F1: the panel must guard on the escape helper before rendering (the review called
// it "the only page-local usage that lacks a typeof escapeHtml guard").
assert.ok(
    importSourceMatches(/function renderTafwijMatchingPanel[\s\S]{0,400}typeof escapeHtml !== 'function'/),
    'renderTafwijMatchingPanel must guard on typeof escapeHtml'
);

// F24: the pure semester cross-check helper — unit-tested from the shipped source so
// the tests exercise the real page code, not a copy.
function loadResolveSemesterDecision() {
    const match = /function resolveSemesterDecision\(parserSemester, selectSemester\) \{[\s\S]*?\n\}/.exec(pageJs);
    assert.ok(match, 'resolveSemesterDecision must exist in the page source');
    return new Function(`return (${match[0]})`)();
}

const resolveSemesterDecision = loadResolveSemesterDecision();

const semesterCases = [
    { name: 'same semester passes', parser: 1, select: 1, ok: true },
    { name: 'same semester two passes', parser: 2, select: 2, ok: true },
    { name: 'file semester one vs select two blocks', parser: 1, select: 2, ok: false, parserSemester: 1, selectSemester: 2 },
    { name: 'file semester two vs select one blocks', parser: 2, select: 1, ok: false, parserSemester: 2, selectSemester: 1 },
    { name: 'unknown parser semester never blocks', parser: null, select: 1, ok: true },
    { name: 'no explicit selection never blocks', parser: 2, select: null, ok: true },
    { name: 'both unknown passes', parser: null, select: null, ok: true }
];
for (const scenario of semesterCases) {
    const decision = resolveSemesterDecision(scenario.parser, scenario.select);
    assert.strictEqual(decision.ok, scenario.ok, `semester: ${scenario.name}`);
    if (scenario.ok === false) {
        assert.strictEqual(decision.parserSemester, scenario.parserSemester, `semester: ${scenario.name} parser`);
        assert.strictEqual(decision.selectSemester, scenario.selectSemester, `semester: ${scenario.name} select`);
    }
}

console.log('tafwij-xss-regression: OK');
