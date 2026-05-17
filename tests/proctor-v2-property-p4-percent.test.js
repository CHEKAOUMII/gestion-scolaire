'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildC3PercentInput } = require('./fixtures/proctor-v2-bug-fixtures');

function loadV2() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'algorithms', 'proctor-distribution-v2.js'), 'utf8');
  const sandbox = { window: {}, Math, console, Infinity, isFinite, isNaN, Set, Map, Object, Array, String, Number, Error, Boolean, Date, parseInt, parseFloat, TypeError, RangeError, NaN };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.ProctorDistributionV2;
}

const input = buildC3PercentInput();
const output = loadV2().run(input);
const seen = new Set();
for (const row of output.result || []) {
  if (seen.has(row.session_key)) continue;
  seen.add(row.session_key);
  const rows = output.result.filter(function (r) { return r.session_key === row.session_key; });
  const guardSet = new Set();
  rows.forEach(function (r) { (r.proctor_keys || []).forEach(function (k) { guardSet.add(k); }); });
  const expected = Math.ceil(25 * guardSet.size / 100);
  assert.strictEqual((row.reserves || []).length, expected,
    'percent mode should emit ceil(percent * guards / 100) reserves');
}
console.log('[pass] P4 percent reserve count property holds for ' + seen.size + ' sessions');
