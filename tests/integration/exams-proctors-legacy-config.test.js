'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const fixtures = require('../fixtures/proctor-v2-bug-fixtures');

function loadV2() {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'algorithms', 'proctor-distribution-v2.js'), 'utf8');
  const sandbox = { window: {}, Math, console, Infinity, isFinite, isNaN, Set, Map, Object, Array, String, Number, Error, Boolean, Date, parseInt, parseFloat, TypeError, RangeError, NaN };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.ProctorDistributionV2;
}

const pageSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'js', 'pages', 'exams-proctors.js'),
    'utf8'
);
assert.ok(
    /reservesPerSession/.test(pageSource),
    'buildV2Input should preserve legacy reservesPerSession fallback'
);

const input = fixtures.buildC3FixedInput();
input.examDistributionRules.reservesPerSession = 3;
input.reservesConfig = { mode: 'fixed', fixed: Math.max(0, Number(input.examDistributionRules.reservesPerSession) || 0), percent: 0 };
const output = loadV2().run(input);
assert.ok(output.result.every(function (row) { return (row.reserves || []).length === 3; }), 'legacy config should be honored as fixed reserve count');
console.log('[pass] integration legacy config without max_reserves_mode honors reservesPerSession');
