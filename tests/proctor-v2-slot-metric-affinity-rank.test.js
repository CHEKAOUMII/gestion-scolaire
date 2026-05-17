'use strict';

// Unit tests — Phase D.2 of proctor-v2-slot-metric-reserves-affinity.
// Validates Phase B (computeAffinityRank + collectSessionsInHalfday).
// _Validates: C3, P3, P4 — Requirements 2.4, 2.5, 3.6_

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'algorithms', 'proctor-distribution-v2.js'),
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

const internals = sandbox.window.ProctorDistributionV2._internals;
const { computeAffinityRank, collectSessionsInHalfday } = internals;

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log('  [pass] ' + name);
    passed++;
  } catch (e) {
    console.log('  [FAIL] ' + name + ': ' + e.message);
    failed++;
  }
}

function makeRow(sessionKey, halfdayKey, proctorKeys, timeFrom) {
  return {
    session_key: sessionKey,
    halfday_key: halfdayKey,
    proctor_keys: proctorKeys || [],
    schedule_entry: { time_from: timeFrom || '' }
  };
}

console.log('[test] computeAffinityRank');

runTest('exported on _internals', function () {
  assert.strictEqual(typeof computeAffinityRank, 'function');
  assert.strictEqual(typeof collectSessionsInHalfday, 'function');
});

runTest('single-session halfday → returns 1 for everyone', function () {
  const HD = '2026-04-10|صباحا';
  const SK1 = HD + '|الحصة الأولى';
  const sessionsBySessionKey = {
    [SK1]: [makeRow(SK1, HD, ['A', 'B'], '08:00')]
  };
  assert.strictEqual(computeAffinityRank('A', SK1, HD, sessionsBySessionKey), 1);
  assert.strictEqual(computeAffinityRank('B', SK1, HD, sessionsBySessionKey), 1);
  assert.strictEqual(computeAffinityRank('Z', SK1, HD, sessionsBySessionKey), 1);
});

runTest('first session of a 2-session halfday → returns 1 for everyone', function () {
  const HD = '2026-04-10|صباحا';
  const SK1 = HD + '|الحصة الأولى';
  const SK2 = HD + '|الحصة الثانية';
  const sessionsBySessionKey = {
    [SK1]: [makeRow(SK1, HD, ['A', 'B'], '08:00')],
    [SK2]: [makeRow(SK2, HD, ['C', 'D'], '10:30')]
  };
  // Querying for SK1 (the first session) → no affinity applies.
  assert.strictEqual(computeAffinityRank('A', SK1, HD, sessionsBySessionKey), 1);
  assert.strictEqual(computeAffinityRank('Z', SK1, HD, sessionsBySessionKey), 1);
});

runTest('second session, candidate present in S1 → returns 0 (preferred)', function () {
  const HD = '2026-04-10|صباحا';
  const SK1 = HD + '|الحصة الأولى';
  const SK2 = HD + '|الحصة الثانية';
  const sessionsBySessionKey = {
    [SK1]: [makeRow(SK1, HD, ['A', 'B'], '08:00')],
    [SK2]: [makeRow(SK2, HD, ['C', 'D'], '10:30')]
  };
  assert.strictEqual(computeAffinityRank('A', SK2, HD, sessionsBySessionKey), 0);
  assert.strictEqual(computeAffinityRank('B', SK2, HD, sessionsBySessionKey), 0);
});

runTest('second session, candidate not in S1 → returns 1 (default)', function () {
  const HD = '2026-04-10|صباحا';
  const SK1 = HD + '|الحصة الأولى';
  const SK2 = HD + '|الحصة الثانية';
  const sessionsBySessionKey = {
    [SK1]: [makeRow(SK1, HD, ['A', 'B'], '08:00')],
    [SK2]: [makeRow(SK2, HD, ['C', 'D'], '10:30')]
  };
  assert.strictEqual(computeAffinityRank('Z', SK2, HD, sessionsBySessionKey), 1);
  assert.strictEqual(computeAffinityRank('C', SK2, HD, sessionsBySessionKey), 1);
});

runTest('falsy proctor_keys cell ignored by candidate match', function () {
  const HD = '2026-04-10|صباحا';
  const SK1 = HD + '|الحصة الأولى';
  const SK2 = HD + '|الحصة الثانية';
  const sessionsBySessionKey = {
    [SK1]: [makeRow(SK1, HD, ['', null, 'A'], '08:00')],
    [SK2]: [makeRow(SK2, HD, ['C'], '10:30')]
  };
  // Empty / falsy keys are skipped — only 'A' counts.
  assert.strictEqual(computeAffinityRank('A', SK2, HD, sessionsBySessionKey), 0);
  assert.strictEqual(computeAffinityRank('', SK2, HD, sessionsBySessionKey), 1);
  assert.strictEqual(computeAffinityRank(null, SK2, HD, sessionsBySessionKey), 1);
});

runTest('empty halfdayKey → returns 1 (degenerate input)', function () {
  assert.strictEqual(computeAffinityRank('A', 'sk', '', {}), 1);
  assert.strictEqual(computeAffinityRank('A', 'sk', null, {}), 1);
});

runTest('defensive: missing firstSessionRows in map → warning logged, returns 1', function () {
  const HD = '2026-04-10|صباحا';
  const SK1 = HD + '|الحصة الأولى';
  const SK2 = HD + '|الحصة الثانية';
  // Both rows reference HD but the SK1 entry is null/missing.
  const sessionsBySessionKey = {
    [SK1]: [makeRow(SK1, HD, ['A'], '08:00')],
    [SK2]: [makeRow(SK2, HD, ['B'], '10:30')]
  };
  // Now corrupt: simulate the SK1 key disappearing AFTER collectSessionsInHalfday
  // enumerated it. We monkeypatch by passing a Proxy-like object.
  const proxied = Object.create(null);
  proxied[SK1] = sessionsBySessionKey[SK1];
  proxied[SK2] = sessionsBySessionKey[SK2];
  // Replace just before computeAffinityRank queries it: easier path is to
  // set sessionsBySessionKey[SK1] = undefined AFTER ensuring iteration order
  // works. We approximate by pruning: the helper already guards `if (!firstSessionRows)`.
  delete proxied[SK1];
  // Without SK1 entry, halfdaySessions will only contain SK2 → length < 2 → returns 1.
  // To exercise the missing-firstSessionRows branch, we need halfdaySessions.length >= 2
  // BUT firstSessionRows lookup to fail. Use a custom map where collectSessionsInHalfday
  // sees both keys, but firstSessionRows lookup yields undefined.
  // Achieve this by giving each entry a row with halfday_key matching, then null-out
  // the first one between collectSessionsInHalfday call and the firstSessionRows
  // lookup. Simpler: pass a Proxy that returns null for SK1.
  const map = new Proxy(Object.create(null), {
    has(_, k) { return k === SK1 || k === SK2; },
    get(_, k) {
      if (k === SK1) return null; // simulate corruption
      if (k === SK2) return sessionsBySessionKey[SK2];
      return undefined;
    },
    ownKeys() { return [SK1, SK2]; },
    getOwnPropertyDescriptor() {
      return { configurable: true, enumerable: true };
    }
  });
  const origWarn = console.warn;
  let warned = false;
  console.warn = function () { warned = true; };
  try {
    // collectSessionsInHalfday will get null for SK1 → skipped (no row in halfday).
    // So halfdaySessions only has SK2 → length<2 → return 1. The missing-rows
    // defensive branch kicks in only when halfdaySessions has 2 entries but the
    // map entry then disappears — that's hard to fake. Document and accept the
    // observable: the helper does NOT crash on null/missing entries.
    const r = computeAffinityRank('A', SK2, HD, map);
    assert.strictEqual(r, 1);
  } finally {
    console.warn = origWarn;
  }
  // The branch we wanted to test directly: firstSessionRows undefined. Force
  // it by calling the helper with a hand-crafted map that includes SK1 in
  // collectSessionsInHalfday's enumeration (rows present) but lookup yields
  // undefined. Use a Proxy that returns rows on first read, undefined later.
  let readCount = 0;
  const map2 = new Proxy(Object.create(null), {
    has() { return true; },
    get(_, k) {
      if (k === SK1) {
        readCount++;
        if (readCount === 1) return [makeRow(SK1, HD, ['A'], '08:00')];
        return undefined; // second read → corrupt
      }
      if (k === SK2) return [makeRow(SK2, HD, ['B'], '10:30')];
      return undefined;
    },
    ownKeys() { return [SK1, SK2]; },
    getOwnPropertyDescriptor() {
      return { configurable: true, enumerable: true };
    }
  });
  warned = false;
  console.warn = function () { warned = true; };
  try {
    const r2 = computeAffinityRank('A', SK2, HD, map2);
    assert.strictEqual(r2, 1, 'falls back to 1 when firstSessionRows missing');
    assert.ok(warned, 'console.warn was called for the corrupt-map case');
  } finally {
    console.warn = origWarn;
  }
});

runTest('collectSessionsInHalfday sorts by (startTime ASC, sessionKey ASC)', function () {
  const HD = '2026-04-10|صباحا';
  const SK1 = HD + '|الحصة الأولى';
  const SK2 = HD + '|الحصة الثانية';
  // Insert in reversed order to verify sort.
  const sessionsBySessionKey = {
    [SK2]: [makeRow(SK2, HD, ['C'], '10:30')],
    [SK1]: [makeRow(SK1, HD, ['A'], '08:00')]
  };
  const out = collectSessionsInHalfday(HD, sessionsBySessionKey);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].sessionKey, SK1, 'first by startTime 08:00');
  assert.strictEqual(out[1].sessionKey, SK2, 'second by startTime 10:30');
});

runTest('collectSessionsInHalfday filters by halfdayKey', function () {
  const HD_M = '2026-04-10|صباحا';
  const HD_E = '2026-04-10|مساء';
  const SK_M = HD_M + '|الحصة الأولى';
  const SK_E = HD_E + '|الحصة الأولى';
  const sessionsBySessionKey = {
    [SK_M]: [makeRow(SK_M, HD_M, ['A'], '08:00')],
    [SK_E]: [makeRow(SK_E, HD_E, ['B'], '14:00')]
  };
  const morning = collectSessionsInHalfday(HD_M, sessionsBySessionKey);
  assert.strictEqual(morning.length, 1);
  assert.strictEqual(morning[0].sessionKey, SK_M);
  const evening = collectSessionsInHalfday(HD_E, sessionsBySessionKey);
  assert.strictEqual(evening.length, 1);
  assert.strictEqual(evening[0].sessionKey, SK_E);
});

console.log('\n[test] computeAffinityRank: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
