'use strict';

// @regression test — Property 1, P-4 (production-fixture invariant).
// Spec: .kiro/specs/proctor-v2-key-shape-unification/
// Task 8.2 — Hard-coded regression lock for the 6 known ghost CIN keys
// from `tests/inv-a-counterexample.md` and `.agent/proctor-v2-key-shape-bug.md`.
//
// On `tests/fixtures/45454.json`, the 6 known som-shaped ghost keys must be
// ABSENT from R_mem.proctor_keys ∪ R_mem.reserve_keys after the fix:
//   1909564 (som of ايت حدو فؤاد,        idx=43)
//   2367149 (som of السعدوي عمر,         idx=78)
//   1910812 (som of تيكوردي إشراق,       idx=66)
//   2158781 (som of ايمان تنون,          idx=92)
//   1545317 (som of المكاني محمد,        idx=50)
//   1177902 (som of وردية بوعادي,        idx=47)
//
// Each of these som values used to appear in proctor_keys with count=1 in
// addition to the canonical __idx_N count of 3, hiding +1 load per affected
// proctor. After the fix, only the canonical __idx_N keys appear.
//
// _Validates: Requirements 2.1, 2.5, 2.6, 2.12_
// _Property: Property 1, P-4_

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

var src = fs.readFileSync(
  path.join(ROOT, 'js/algorithms/proctor-distribution-v2.js'),
  'utf8'
);
var sb = {
  console: console, Date: Date, Math: Math, Number: Number, Object: Object,
  Array: Array, Set: Set, Map: Map, JSON: JSON, isFinite: isFinite,
  isNaN: isNaN, Infinity: Infinity, parseInt: parseInt
};
sb.window = sb;
sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(src, sb);
var V2 = sb.ProctorDistributionV2;

var input = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'tests/fixtures/45454.json'),
  'utf8'
));
var out = V2.run(input);
var R_mem = out.result;

// Build occurrence counter over proctor_keys ∪ reserve_keys (with
// shared-reserve-array dedupe per the v1 invariant).
var occ = Object.create(null);
var seenReserveArrays = new Set();
for (var i = 0; i < R_mem.length; i++) {
  var pk = R_mem[i].proctor_keys || [];
  for (var j = 0; j < pk.length; j++) {
    var k = pk[j];
    if (k) occ[k] = (occ[k] || 0) + 1;
  }
  var rk = R_mem[i].reserve_keys || [];
  if (rk.length > 0 && !seenReserveArrays.has(rk)) {
    seenReserveArrays.add(rk);
    for (var r = 0; r < rk.length; r++) {
      var k2 = rk[r];
      if (k2) occ[k2] = (occ[k2] || 0) + 1;
    }
  }
}

// Assert the 6 known ghost keys are ABSENT.
var GHOST_KEYS = [
  { som: '1909564', name: 'ايت حدو فؤاد',     idx: 43 },
  { som: '2367149', name: 'السعدوي عمر',       idx: 78 },
  { som: '1910812', name: 'تيكوردي إشراق',     idx: 66 },
  { som: '2158781', name: 'ايمان تنون',        idx: 92 },
  { som: '1545317', name: 'المكاني محمد',      idx: 50 },
  { som: '1177902', name: 'وردية بوعادي',      idx: 47 }
];

var present = [];
GHOST_KEYS.forEach(function (g) {
  var count = occ[g.som] || 0;
  if (count > 0) present.push({ som: g.som, name: g.name, count: count });
});

console.log('[no-ghost-keys] Checking 6 known ghost CINs on fixture 45454.json:');
GHOST_KEYS.forEach(function (g) {
  var count = occ[g.som] || 0;
  console.log('  som=' + g.som.padEnd(8) + ' (' + g.name + ', idx=' + g.idx +
    ') → count=' + count + (count === 0 ? ' ✅' : ' ❌'));
});

assert.strictEqual(present.length, 0,
  'GHOST KEYS PRESENT — Property 1 P-4 violated. ' + present.length +
  ' of 6 known som-shaped ghost keys are still present in R_mem after the ' +
  'fix:\n' +
  present.map(function (p) {
    return '  som=' + p.som + ' (' + p.name + ') → count=' + p.count;
  }).join('\n'));

console.log('[no-ghost-keys] PASS — all 6 known ghost CINs are absent from ' +
  'R_mem.proctor_keys ∪ R_mem.reserve_keys.');
