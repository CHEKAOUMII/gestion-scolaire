'use strict';

// CH5: unit tests for canonical debounce in js/utils.js.
//
//   node tests/debounce-unit.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function loadCanonicalDebounce() {
    const utilsSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'utils.js'), 'utf8');
    const start = utilsSrc.indexOf('function debounce(func, wait = 300)');
    assert.ok(start !== -1, 'debounce must exist in js/utils.js');
    let i = utilsSrc.indexOf('{', start);
    let depth = 0;
    for (; i < utilsSrc.length; i++) {
        if (utilsSrc[i] === '{') depth++;
        else if (utilsSrc[i] === '}') {
            depth--;
            if (depth === 0) {
                i++;
                break;
            }
        }
    }
    const snippet = utilsSrc.slice(start, i);
    return new Function(snippet + '\nreturn debounce;')();
}

const debounce = loadCanonicalDebounce();

// Consumers must not re-declare local debounce (CH5).
const consumers = ['js/pages/absence-analytics.js', 'js/pages/teachers-list.js'];
for (const rel of consumers) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(!/function\s+debounce\b/.test(src), rel + ' must not define local debounce');
    assert.ok(/\bdebounce\s*\(/.test(src), rel + ' must call debounce');
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
    const calls = [];
    const d = debounce((v) => calls.push(v), 40);
    d(1);
    d(2);
    d(3);
    await delay(60);
    assert.deepStrictEqual(calls, [3], 'debounce should fire once with last args');
    d(4);
    await delay(60);
    assert.deepStrictEqual(calls, [3, 4]);
    console.log('debounce-unit: OK');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
