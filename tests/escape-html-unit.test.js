'use strict';

// CH1: unit tests for the canonical escapeHtml in js/utils.js.
// Covers: null/undefined, &, <, >, ", ' and combined XSS-ish payloads.
//
//   node tests/escape-html-unit.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function loadCanonicalEscapeHtml() {
    const utilsSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'utils.js'), 'utf8');
    const m = utilsSrc.match(/function escapeHtml\(text\) \{[\s\S]*?\n\}/);
    assert.ok(m, 'escapeHtml must exist in js/utils.js');
    return new Function(m[0] + '\nreturn escapeHtml;')();
}

const escapeHtml = loadCanonicalEscapeHtml();

assert.strictEqual(escapeHtml(null), '');
assert.strictEqual(escapeHtml(undefined), '');
assert.strictEqual(escapeHtml(''), '');
assert.strictEqual(escapeHtml(0), '0');
assert.strictEqual(escapeHtml('plain'), 'plain');

assert.strictEqual(escapeHtml('&'), '&amp;');
assert.strictEqual(escapeHtml('<'), '&lt;');
assert.strictEqual(escapeHtml('>'), '&gt;');
assert.strictEqual(escapeHtml('"'), '&quot;');
assert.strictEqual(escapeHtml("'"), '&#39;');

assert.strictEqual(
    escapeHtml('<script>alert("x")</script>'),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
);
assert.strictEqual(escapeHtml("a&b'c\"d<e>f"), 'a&amp;b&#39;c&quot;d&lt;e&gt;f');

// Pages must not re-declare local escapers (CH1 consumers).
const consumers = [
    'js/pages/exams-proctors.js',
    'js/pages/exams-rooms.js',
    'js/pages/exams-schedule.js',
    'js/pages/compensation-tracking.js'
];
for (const rel of consumers) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(
        !/function\s+escHtml\b/.test(src) && !/function\s+escapeHtml\b/.test(src),
        rel + ' must not define a local escHtml/escapeHtml'
    );
    assert.ok(/\bescapeHtml\s*\(/.test(src), rel + ' must call escapeHtml');
}

console.log('escape-html-unit: OK');
