'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildC3FixedInput } = require('./fixtures/proctor-v2-bug-fixtures');

function loadV2() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'algorithms', 'proctor-distribution-v2.js'), 'utf8');
  const sandbox = { window: {}, Math, console, Infinity, isFinite, isNaN, Set, Map, Object, Array, String, Number, Error, Boolean, Date, parseInt, parseFloat, TypeError, RangeError, NaN };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.ProctorDistributionV2;
}

const input = buildC3FixedInput();
const output = loadV2().run(input);
for (const row of output.result || []) {
  assert.strictEqual((row.reserves || []).length, 4, 'fixed mode should emit 4 reserves per session');
  assert.strictEqual((row.reserve_keys || []).length, 4, 'fixed mode should emit 4 reserve keys per session');
}
console.log('[pass] P3 fixed reserve count property holds for ' + output.result.length + ' rows');
