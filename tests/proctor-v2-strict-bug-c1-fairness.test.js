'use strict';

// @pre-fix exploratory test
// EXPECTED: this test FAILS on the pre-fix snapshot — failure confirms C1 exists.
// DO NOT attempt to "fix" this test if it fails. It is supposed to fail.
// The post-fix integration test (task 47) covers the same scenario on the fixed module.
//
// Spec: .kiro/specs/proctor-v2-strict-fairness-coverage/
// Phase H, task 38 — Property 1 (Bug Condition C1, single-class primaryLoad gap).
//
// Scoped fixture (the user's reported run):
//   { N=147 proctors all in one eligibility class,
//     G=368 guard tasks (92 sessions × 4 proctors/room × 1 room),
//     D_expected=15, dutyData={} → dutyCount(T)=0 for every T
//     → primaryLoad(T) = guardCount(T) }
//
// Bounds: floor((368 + 15) / 147) = 2, ceil(383 / 147) = 3.
// Strict fairness (P1): for any two proctors T1, T2 in the same eligibility
// class, |primaryLoad(T1) − primaryLoad(T2)| ≤ 1.
//
// Pre-fix counterexample observed on the snapshot (deterministic with
// randomSeed=42; reproduced across multiple runs):
//   {
//     T1: { key: 'C1G001', primaryLoad: 9 },
//     T2: { key: 'C1G003', primaryLoad: 1 },
//     gap: 8
//   }
// Concretely the snapshot yields max(primaryLoad) − min(primaryLoad) = 8 on
// this fixture; the soft load-penalty `4 × max(0, primaryLoad − floor) + 0.5`
// loses to other soft costs so the same handful of over-loaded teachers keep
// being picked while peers sit at primaryLoad = 1. The pre-fix CSP/AC-3 also
// hits its 1000-iteration cap on this geometry (warning "AC-3: max iterations
// reached before stability. Remaining arcs in queue: 104") so only ~162/368
// guard slots get filled — the strict-fairness violation manifests on the
// slots that DO get placed. P1 fails — the bug is reproduced.
//
// _Validates: Requirements 1.1, 2.1 (Bug Condition C1, Property P1)_

const assert = require('assert');
const path = require('path');

const PreFixV2 = require(
  path.join(__dirname, '__snapshots__', 'proctor-v2-strict-fairness-coverage.pre-fix.js')
);
const {
  buildC1SingleClassGapInput
} = require('./fixtures/proctor-v2-strict-fairness-fixtures');

/**
 * Counts guard slot appearances per proctor key by scanning the result rows.
 * Reserves are NOT counted (P1 / primaryLoad excludes reserves).
 */
function countGuardLoads(rows) {
  const loads = Object.create(null);
  for (let i = 0; i < rows.length; i++) {
    const keys = rows[i].proctor_keys || [];
    for (let j = 0; j < keys.length; j++) {
      const key = keys[j];
      if (!key) continue;
      loads[key] = (loads[key] || 0) + 1;
    }
  }
  return loads;
}

/**
 * Counts user-pinned duty halfdays per proctor key directly from input.dutyData
 * (mirrors what `addDutyLoad` does during Phase 1 pre-pass: one increment per
 * unique halfday, where halfdayKey is derived from the dutyData key's
 * `${day}|${period}` prefix).
 */
function countDutyLoads(dutyData) {
  const seen = Object.create(null); // proctorKey -> Set of halfdayKey
  const counts = Object.create(null);
  if (!dutyData) return counts;
  const sessionKeys = Object.keys(dutyData);
  for (let i = 0; i < sessionKeys.length; i++) {
    const sessionKey = sessionKeys[i];
    const parts = sessionKey.split('|');
    const halfdayKey = parts.length >= 2 ? parts[0] + '|' + parts[1] : sessionKey;
    const proctorMap = dutyData[sessionKey] || {};
    const proctorKeys = Object.keys(proctorMap);
    for (let j = 0; j < proctorKeys.length; j++) {
      const pk = proctorKeys[j];
      if (!proctorMap[pk]) continue;
      if (!seen[pk]) seen[pk] = new Set();
      const before = seen[pk].size;
      seen[pk].add(halfdayKey);
      if (seen[pk].size > before) {
        counts[pk] = (counts[pk] || 0) + 1;
      }
    }
  }
  return counts;
}

const input = buildC1SingleClassGapInput();
const output = PreFixV2.run(input);
const rows = (output && output.result) || [];

const guardLoads = countGuardLoads(rows);
const dutyLoads = countDutyLoads(input.dutyData);

// Compute primaryLoad(T) = guardCount(T) + dutyCount(T) for every proctor.
const primaryLoads = input.proctorsList.map(function (p) {
  return {
    key: p.cin,
    guardCount: guardLoads[p.cin] || 0,
    dutyCount: dutyLoads[p.cin] || 0,
    primaryLoad: (guardLoads[p.cin] || 0) + (dutyLoads[p.cin] || 0)
  };
});

let minEntry = primaryLoads[0];
let maxEntry = primaryLoads[0];
for (let i = 1; i < primaryLoads.length; i++) {
  if (primaryLoads[i].primaryLoad < minEntry.primaryLoad) minEntry = primaryLoads[i];
  if (primaryLoads[i].primaryLoad > maxEntry.primaryLoad) maxEntry = primaryLoads[i];
}

const gap = maxEntry.primaryLoad - minEntry.primaryLoad;

console.log('[c1-strict] N=' + input.proctorsList.length +
  ', G=' + (rows.reduce(function (acc, r) { return acc + (r.proctor_keys || []).length; }, 0)) +
  ', D_expected=' + input.D_expected +
  ', max=' + maxEntry.primaryLoad + ' (' + maxEntry.key + ')' +
  ', min=' + minEntry.primaryLoad + ' (' + minEntry.key + ')' +
  ', gap=' + gap);

// Property P1: strict fairness within an eligibility class.
// All 147 proctors form a single class (no exemptions, no duty pin),
// so every pair must satisfy |primaryLoad(T1) − primaryLoad(T2)| ≤ 1.
assert.ok(
  gap <= 1,
  'P1 violated on pre-fix snapshot: max−min primaryLoad gap = ' + gap +
    ' > 1 — counterexample T1=' + maxEntry.key + ' primaryLoad=' + maxEntry.primaryLoad +
    ', T2=' + minEntry.key + ' primaryLoad=' + minEntry.primaryLoad +
    ' (single eligibility class, expected gap ≤ 1).'
);

console.log('[c1-strict] (unexpected) P1 holds on pre-fix snapshot — gap=' + gap);
