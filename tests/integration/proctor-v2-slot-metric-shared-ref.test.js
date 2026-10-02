'use strict';

// Integration test — Phase D.4 task 29 of proctor-v2-slot-metric-reserves-affinity.
// Asserts every multi-row session shares its reserves / reserve_keys arrays
// by reference identity after the new sort lands.
// _Validates: P4 — Requirement 3.7_

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'js', 'algorithms', 'proctor-distribution-v2.js'),
  'utf8'
);
const sandbox = {
  window: {},
  Math, console, Infinity, isFinite, isNaN,
  Set, Map, Object, Array, String, Number, Error, Boolean, Date,
  parseInt, parseFloat, TypeError, RangeError, NaN, JSON
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const V2 = sandbox.window.ProctorDistributionV2;

const fixtures = require(path.join(__dirname, '..', 'fixtures', 'proctor-v2-slot-metric-fixtures.js'));

const input = fixtures.buildC3AffinityInput();
const out = V2.run(input);
assert.strictEqual(out.diagnostics.errors.length, 0);
const rows = out.result || [];

// Group rows by session_key.
const bySession = {};
for (const r of rows) {
  if (!bySession[r.session_key]) bySession[r.session_key] = [];
  bySession[r.session_key].push(r);
}

let multiRowChecked = 0;
for (const sk of Object.keys(bySession)) {
  const grp = bySession[sk];
  if (grp.length < 2) continue;
  const firstReserves = grp[0].reserves;
  const firstReserveKeys = grp[0].reserve_keys;
  for (let i = 1; i < grp.length; i++) {
    assert.strictEqual(grp[i].reserves, firstReserves,
      'reserves not shared by reference for session ' + sk);
    assert.strictEqual(grp[i].reserve_keys, firstReserveKeys,
      'reserve_keys not shared by reference for session ' + sk);
  }
  multiRowChecked++;
}
console.log('[pass] shared-reference invariant holds across ' + multiRowChecked + ' multi-row sessions');
