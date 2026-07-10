'use strict';

// CH3: mandatory hardened csvEscape unit tests (formula injection).
//
//   node tests/csv-escape-unit.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { csvEscape, escapeCsv } = require('../js/shared/csv.js');

assert.strictEqual(typeof csvEscape, 'function');
assert.strictEqual(escapeCsv, csvEscape);

// Basic quoting
assert.strictEqual(csvEscape(null), '""');
assert.strictEqual(csvEscape(undefined), '""');
assert.strictEqual(csvEscape(''), '""');
assert.strictEqual(csvEscape('plain'), '"plain"');
assert.strictEqual(csvEscape('a"b'), '"a""b"');
assert.strictEqual(csvEscape('hello,world'), '"hello,world"');

// Formula injection neutralization (must prefix apostrophe inside quotes)
const formulaCases = ['=1+1', '+cmd', '-2+2', '@SUM(A1)', '\t=1', '\r=1'];
for (const input of formulaCases) {
    const out = csvEscape(input);
    assert.ok(out.startsWith('"\''), `must harden leading formula char: ${JSON.stringify(input)} -> ${out}`);
    assert.ok(out.endsWith('"'), `must stay quoted: ${out}`);
    // Inner content should start with apostrophe then original (minus we only prefix)
    assert.ok(out.includes("'" + input) || out.includes("'" + String(input)), out);
}

// Safe leading characters must not gain a spurious apostrophe
assert.strictEqual(csvEscape('normal'), '"normal"');
assert.strictEqual(csvEscape('  =notleading'), '"  =notleading"');
assert.strictEqual(csvEscape('1+1'), '"1+1"');

// Consumers must not redefine local escapers
const consumers = [
    'js/pages/absence-analytics.js',
    'js/pages/teachers-performance.js',
    'js/pages/tracking-teachers-performance.js'
];
for (const rel of consumers) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(!/function\s+csvEscape\b/.test(src), rel + ' must not define local csvEscape');
    assert.ok(!/function\s+escapeCsv\b/.test(src), rel + ' must not define local escapeCsv');
    assert.ok(/\b(csvEscape|escapeCsv)\s*\(/.test(src), rel + ' must call shared escaper');
}

// HTML hosts load shared module
for (const rel of [
    'absence-analytics.html',
    'teachers-performance.html',
    'tracking-teachers-performance.html'
]) {
    const html = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(html.includes('js/shared/csv.js'), rel + ' must include js/shared/csv.js');
}

console.log('csv-escape-unit: OK');
