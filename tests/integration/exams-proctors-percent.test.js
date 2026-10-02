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

const input = fixtures.buildC3PercentInput();
input.reservesConfig = { mode: 'percent', fixed: 0, percent: 20 };
const output = loadV2().run(input);
assert.ok(output && Array.isArray(output.result), 'v2 should produce result rows');
assert.ok(output.result.every(function (row) { return (row.reserves || []).length > 0; }), 'percent mode should render reserves on every row');
const savedBlob = JSON.stringify(output);
const reloaded = JSON.parse(savedBlob);
assert.strictEqual(JSON.stringify(reloaded.result), JSON.stringify(output.result), 'saved output should round-trip');
console.log('[pass] integration percent mode end-to-end reserves and save round-trip');
