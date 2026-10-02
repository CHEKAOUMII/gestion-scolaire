'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { buildC2Input } = require('./fixtures/proctor-v2-bug-fixtures');

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
    for (const key of row.proctor_keys || []) {
      loads[key] = (loads[key] || 0) + 1;
    }
  }
  return loads;
}

const V2 = loadPreFixV2();
const input = buildC2Input();
const output = V2.run(input);
const guardLoads = countGuardLoads(output.result || []);
const finalT1 = (guardLoads.CIN_T1 || 0) + 2;
const finalT2 = guardLoads.CIN_T2 || 0;
const delta = Math.abs(finalT1 - finalT2);

assert.ok(delta >= 2,
  'Expected pre-fix C2 counterexample with final load delta >= 2, got ' + delta);

console.log('[pass] C2 pre-fix duty-aware bug surfaced: CIN_T1=finalLoad ' +
  finalT1 + ', CIN_T2=finalLoad ' + finalT2);
