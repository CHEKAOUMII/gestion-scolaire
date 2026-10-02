'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { buildC3FixedInput } = require('./fixtures/proctor-v2-bug-fixtures');

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

const V2 = loadPreFixV2();
const input = buildC3FixedInput();
const output = V2.run(input);
const badRows = (output.result || []).filter(function (row) {
  return (row.reserves || []).length !== 4;
});

assert.ok(badRows.length > 0,
  'Expected pre-fix C3 fixed counterexample where reserves length is not 4');
assert.ok(badRows.every(function (row) { return (row.reserves || []).length === 0; }),
  'Expected pre-fix v2 to emit empty reserves arrays');

console.log('[pass] C3 fixed pre-fix reserves bug surfaced: ' + badRows.length + ' rows emit 0 reserves instead of 4');
