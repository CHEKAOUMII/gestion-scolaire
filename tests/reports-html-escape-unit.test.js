'use strict';

// CH9: main/reports/html-escape.js shared by letterhead + footer
//
//   node tests/reports-html-escape-unit.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { esc } = require('../main/reports/html-escape.js');

assert.strictEqual(esc(null), '');
assert.strictEqual(esc(''), '');
assert.strictEqual(esc('a&b'), 'a&amp;b');
assert.strictEqual(esc('<x>'), '&lt;x&gt;');
assert.strictEqual(esc('"q"'), '&quot;q&quot;');
assert.strictEqual(esc("o'b"), 'o&#39;b');

for (const rel of ['main/reports/footer.js', 'main/reports/letterhead.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(/require\(['"]\.\/html-escape['"]\)/.test(src), rel + ' must require html-escape');
    assert.ok(!/function\s+esc\s*\(/.test(src), rel + ' must not define local esc');
}

console.log('reports-html-escape-unit: OK');
