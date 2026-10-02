'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildC1Input } = require('./fixtures/proctor-v2-bug-fixtures');

function loadV2() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'algorithms', 'proctor-distribution-v2.js'), 'utf8');
  const sandbox = { window: {}, Math, console, Infinity, isFinite, isNaN, Set, Map, Object, Array, String, Number, Error, Boolean, Date, parseInt, parseFloat, TypeError, RangeError, NaN };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.ProctorDistributionV2;
}

function guardLoads(rows) {
  const loads = Object.create(null);
  for (const row of rows) {
    for (const key of row.proctor_keys || []) loads[key] = (loads[key] || 0) + 1;
  }
  return loads;
}

const input = buildC1Input();
const output = loadV2().run(input);
const loads = guardLoads(output.result || []);
const values = input.proctorsList.map(function (p) { return loads[p.cin] || 0; });
const max = Math.max.apply(Math, values);
const min = Math.min.apply(Math, values);
const totalTasks = (output.result || []).reduce(function (n, row) { return n + ((row.proctor_keys || []).length); }, 0);
const lowerBound = Math.floor(totalTasks / input.proctorsList.length);
const upperBound = lowerBound + 1;

assert.ok(max - min <= (upperBound - lowerBound) + 1,
  'Expected fairness range to stay bounded, got max=' + max + ' min=' + min);
assert.ok(!values.some(function (v) { return v >= 2; }) || !values.some(function (v) { return v === 0; }),
  'No eligible teacher should have load >= 2 while a peer has load 0');

console.log('[pass] P1 fairness range property holds: max=' + max + ', min=' + min);
