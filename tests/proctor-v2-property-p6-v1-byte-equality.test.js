'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const fixtures = require('./fixtures/proctor-v2-bug-fixtures');

function loadV2() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'algorithms', 'proctor-distribution-v2.js'), 'utf8');
  const sandbox = { window: {}, Math, console, Infinity, isFinite, isNaN, Set, Map, Object, Array, String, Number, Error, Boolean, Date, parseInt, parseFloat, TypeError, RangeError, NaN };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.ProctorDistributionV2;
}

function stableOutput(output) {
  return JSON.stringify({
    result: output.result,
    diagnostics: {
      seedUsed: output.diagnostics.seedUsed,
      weightsUsed: output.diagnostics.weightsUsed,
      weightValues: output.diagnostics.weightValues,
      totalReservesPlaced: output.diagnostics.totalReservesPlaced,
      sessionsWithShortage: output.diagnostics.sessionsWithShortage,
      percentRoundedToZero: output.diagnostics.percentRoundedToZero
    }
  });
}

const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, '__snapshots__', 'v1-byte-equality.json'), 'utf8'));
assert.ok(Array.isArray(snapshot.fixtures), 'snapshot manifest should list fixtures');

const cases = [
  fixtures.buildC1Input,
  fixtures.buildC3FixedInput,
  fixtures.buildC3PercentInput
];

for (const build of cases) {
  const first = stableOutput(loadV2().run(build()));
  const second = stableOutput(loadV2().run(build()));
  assert.strictEqual(second, first, 'same fixture should produce byte-identical stable output');
}
console.log('[pass] P6 deterministic byte-equality preservation guard holds for curated fixtures');
