'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { buildC1Input } = require('./fixtures/proctor-v2-bug-fixtures');

function loadPreFixV2() {
  const source = fs.readFileSync(
    path.join(__dirname, '__snapshots__', 'proctor-distribution-v2.pre-fix.js'),
    'utf8'
  );
  const sandbox = {
    window: {},
    Math, console, Infinity, isFinite, isNaN,
    Set, Map, Object, Array, String, Number, Error, Boolean, Date,
    parseInt, parseFloat, TypeError, RangeError, NaN
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.ProctorDistributionV2;
}

function countGuardLoads(rows) {
  const loads = Object.create(null);
  for (const row of rows) {
    const keys = row.proctor_keys || [];
    for (const key of keys) {
      loads[key] = (loads[key] || 0) + 1;
    }
  }
  return loads;
}

const V2 = loadPreFixV2();
const input = buildC1Input();
const output = V2.run(input);
const loads = countGuardLoads(output.result || []);
const allLoads = input.proctorsList.map(function (p) {
  return { key: p.cin, load: loads[p.cin] || 0 };
});
const overloaded = allLoads.find(function (item) { return item.load >= 2; });
const idle = allLoads.find(function (item) { return item.load === 0; });

assert.ok(overloaded && idle,
  'Expected pre-fix C1 counterexample with one finalLoad >= 2 and one finalLoad = 0');

console.log('[pass] C1 pre-fix fairness bug surfaced: ' +
  overloaded.key + '=finalLoad ' + overloaded.load + ', ' + idle.key + '=finalLoad 0');
