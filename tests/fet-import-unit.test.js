'use strict';

// CH10: FET day mappings + base class name (js/shared/fet-import.js)
//
//   node tests/fet-import-unit.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
    FET_DAY_MAPPINGS,
    FET_ARABIC_DAYS,
    getBaseClassName,
    ensureFetDaySkeleton
} = require('../js/shared/fet-import.js');

assert.strictEqual(FET_DAY_MAPPINGS.lundi_m.day, 'الاثنين');
assert.strictEqual(FET_DAY_MAPPINGS.lundi_m.period, 'morning');
assert.strictEqual(FET_DAY_MAPPINGS.Mardi_s.period, 'afternoon');
assert.strictEqual(FET_ARABIC_DAYS.length, 6);
assert.strictEqual(FET_ARABIC_DAYS[0], 'الاثنين');

assert.strictEqual(getBaseClassName(''), '');
assert.strictEqual(getBaseClassName('1BACSE-1:G1'), '1BACSE-1');
assert.strictEqual(getBaseClassName('1BACSE-1:g2'), '1BACSE-1');
assert.strictEqual(getBaseClassName('1BACSE-1'), '1BACSE-1');

const tt = {};
const day = ensureFetDaySkeleton(tt, 'الاثنين');
assert.ok(day.morning && day.afternoon);
assert.strictEqual(ensureFetDaySkeleton(tt, 'الاثنين'), day);

// Consumers no longer re-declare dayMappings object literals / getBaseClassName
for (const rel of ['js/pages/timetable.js', 'js/pages/settings-imports.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(!/function\s+getBaseClassName\b/.test(src), rel + ' must not define getBaseClassName');
    assert.ok(!/lundi_m:\s*\{\s*day:\s*'الاثنين'/.test(src), rel + ' must not inline FET day table');
    assert.ok(/FET_DAY_MAPPINGS/.test(src), rel + ' must reference FET_DAY_MAPPINGS');
}

for (const rel of ['timetable.html', 'settings-imports.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(html.includes('js/shared/fet-import.js'), rel + ' must load fet-import.js');
}

console.log('fet-import-unit: OK');
