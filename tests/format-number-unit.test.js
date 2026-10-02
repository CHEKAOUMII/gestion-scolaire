'use strict';

// CH5: formatNumber styles in js/utils.js
//
//   node tests/format-number-unit.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function loadFormatNumber() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'utils.js'), 'utf8');
    const start = src.indexOf('function formatNumber(num, style)');
    assert.ok(start !== -1, 'formatNumber(num, style) must exist in utils.js');
    let i = src.indexOf('{', start);
    let depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) {
                i++;
                break;
            }
        }
    }
    return new Function(src.slice(start, i) + '\nreturn formatNumber;')();
}

const formatNumber = loadFormatNumber();

// locale (default) — nullish / NaN → '0'
assert.strictEqual(formatNumber(null), '0');
assert.strictEqual(formatNumber(undefined), '0');
assert.strictEqual(formatNumber(Number.NaN), '0');

// locale uses ar-MA (string non-empty for a finite number)
const locale = formatNumber(1234.5);
assert.ok(typeof locale === 'string' && locale.length > 0);
assert.notStrictEqual(locale, '1234.5'); // typically localized separators/digits

// fixed style — analytics KPIs
assert.strictEqual(formatNumber(0, 'fixed'), '0');
assert.strictEqual(formatNumber(12, 'fixed'), '12');
assert.strictEqual(formatNumber(12.0, 'fixed'), '12');
assert.strictEqual(formatNumber(12.34, 'fixed'), '12.3');
assert.strictEqual(formatNumber(12.36, 'fixed'), '12.4');
assert.strictEqual(formatNumber(null, 'fixed'), '0');
assert.strictEqual(formatNumber('7.2', 'fixed'), '7.2');
assert.strictEqual(formatNumber('x', 'fixed'), '0');

// absence-analytics must not redefine; must pass 'fixed'
const aa = fs.readFileSync(path.join(__dirname, '..', 'js/pages/absence-analytics.js'), 'utf8');
assert.ok(!/function\s+formatNumber\b/.test(aa), 'absence-analytics must not define formatNumber');
assert.ok(/formatNumber\([^)]+,\s*['"]fixed['"]\)/.test(aa), 'absence-analytics must use formatNumber(_, fixed)');
// no bare single-arg formatNumber calls for KPIs (allow comments)
const bare = aa.match(/formatNumber\s*\(\s*[^,)]+\s*\)/g) || [];
assert.strictEqual(bare.length, 0, 'unexpected bare formatNumber calls: ' + bare.join(', '));

console.log('format-number-unit: OK');
