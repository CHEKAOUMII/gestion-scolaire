'use strict';

// Unit tests for Phase 2 timeout configurability.
// Spec: proctor-v2-phase2-timeout-and-greedy-cap, Phase D.2 task 13.
//
// Validates Requirements 2.1, 2.2, 2.3.

const path = require('path');
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js/algorithms/proctor-distribution-v2.js'), 'utf8');

function loadV2() {
  const sandbox = {
    console: { log: function () {}, warn: function () {}, error: function () {} },
    Date, Math, Number, Object, Array, Set, Map, JSON, isFinite, isNaN, Infinity, parseInt
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.ProctorDistributionV2;
}

const { buildC1SingleClassGapInput } = require(path.join(ROOT, 'tests/fixtures/proctor-v2-strict-fairness-fixtures.js'));

// === Test 1: default budget = 5000 when option absent ===
{
  const V2 = loadV2();
  const input = buildC1SingleClassGapInput();
  const out = V2.run(input);
  assert.strictEqual(
    out.diagnostics.phase2TimeoutMs,
    5000,
    'default phase2TimeoutMs must be 5000 (got ' + out.diagnostics.phase2TimeoutMs + ')'
  );
}

// === Test 2: override honoured ===
{
  const V2 = loadV2();
  const input = buildC1SingleClassGapInput();
  input.options = Object.assign({}, input.options, { phase2TimeoutMs: 200 });
  const out = V2.run(input);
  assert.strictEqual(
    out.diagnostics.phase2TimeoutMs,
    200,
    'override phase2TimeoutMs=200 must be honoured (got ' + out.diagnostics.phase2TimeoutMs + ')'
  );
  assert.strictEqual(
    out.diagnostics.phase2TimedOut,
    true,
    'override 200ms on user fixture must trigger timeout (got ' + out.diagnostics.phase2TimedOut + ')'
  );
}

// === Test 3: non-positive override falls back to default ===
{
  const cases = [0, -1, undefined, NaN];
  for (const bad of cases) {
    const V2 = loadV2();
    const input = buildC1SingleClassGapInput();
    input.options = Object.assign({}, input.options, { phase2TimeoutMs: bad });
    const out = V2.run(input);
    assert.strictEqual(
      out.diagnostics.phase2TimeoutMs,
      5000,
      'non-positive override (' + bad + ') must fall back to 5000 (got ' + out.diagnostics.phase2TimeoutMs + ')'
    );
  }
}

// === Test 4: phase2TimedOut always boolean ===
{
  const V2 = loadV2();
  const input = buildC1SingleClassGapInput();
  const out = V2.run(input);
  assert.strictEqual(
    typeof out.diagnostics.phase2TimedOut,
    'boolean',
    'phase2TimedOut must always be boolean (got ' + typeof out.diagnostics.phase2TimedOut + ')'
  );
}

console.log('[pass] phase2Build: default budget = 5000');
console.log('[pass] phase2Build: override honoured');
console.log('[pass] phase2Build: non-positive override falls back');
console.log('[pass] phase2Build: phase2TimedOut is always boolean');
