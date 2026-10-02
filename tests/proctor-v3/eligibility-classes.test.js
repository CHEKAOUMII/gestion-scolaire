/**
 * Unit tests for
 * js/algorithms/proctor-v3/phases/02-eligibility-classes.js
 *
 * Validates: Requirements 5.3, 5.4, 5.5
 *
 * Run directly:   node tests/proctor-v3/eligibility-classes.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

const { deriveEligibilityClasses, _internals } = require(path.join(
  __dirname,
  '..',
  '..',
  'js',
  'algorithms',
  'proctor-v3',
  'phases',
  '02-eligibility-classes.js'
));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides) {
  const base = {
    input: { proctorsList: [] },
    rows: [],
    normalizedDutyData: {},
    normalizedExemptionsData: {},
    normalizedMEAssignments: {},
  };
  return Object.assign(base, overrides || {});
}

function makeRow(sessionKey, halfdayKey, roomKey) {
  return {
    session_key: sessionKey,
    halfday_key: halfdayKey || 'h_default',
    day_key: '2026-06-04',
    room_key: roomKey || 'R1',
    room_name: 'Salle 1',
    proctor_keys: [null, null],
    proctors: [],
    reserve_keys: [],
    reserves: [],
    duty_teachers: [],
    softViolations: [],
  };
}

// ---------------------------------------------------------------------------
// 1. Result shape & purity
// ---------------------------------------------------------------------------

test('returns a NEW state object (does not mutate input state)', () => {
  const state = makeState({
    input: { proctorsList: [{ cin: 'A1' }] },
    rows: [makeRow('s1')],
  });
  const result = deriveEligibilityClasses(state);
  assert.notStrictEqual(result, state);
  assert.strictEqual(state.classes, undefined);
  assert.strictEqual(state.classByProctorKey, undefined);
});

test('does NOT mutate state.input or any other state fields', () => {
  const input = {
    proctorsList: [{ cin: 'A1' }, { cin: 'A2' }],
  };
  const state = {
    input: input,
    rows: [makeRow('s1', 'h1')],
    normalizedDutyData: { h1: { A1: true } },
    normalizedExemptionsData: { s1: { A2: 'no' } },
    normalizedMEAssignments: { g1: { A1: true } },
  };
  const snapshot = JSON.parse(JSON.stringify(state));
  deriveEligibilityClasses(state);
  // Compare each field individually (snapshot stripping nothing).
  assert.deepStrictEqual(state.input, snapshot.input);
  assert.deepStrictEqual(state.rows, snapshot.rows);
  assert.deepStrictEqual(state.normalizedDutyData, snapshot.normalizedDutyData);
  assert.deepStrictEqual(state.normalizedExemptionsData, snapshot.normalizedExemptionsData);
  assert.deepStrictEqual(state.normalizedMEAssignments, snapshot.normalizedMEAssignments);
});

test('preserves unrelated state fields by shallow-copy', () => {
  const state = makeState({ input: { proctorsList: [] } });
  state.somethingElse = { foo: 'bar' };
  const result = deriveEligibilityClasses(state);
  assert.strictEqual(result.somethingElse, state.somethingElse);
});

test('result has classes (array) and classByProctorKey (object)', () => {
  const result = deriveEligibilityClasses(makeState({ input: { proctorsList: [] } }));
  assert.ok(Array.isArray(result.classes));
  assert.strictEqual(typeof result.classByProctorKey, 'object');
});

test('throws TypeError on null state or missing input', () => {
  assert.throws(() => deriveEligibilityClasses(null), TypeError);
  assert.throws(() => deriveEligibilityClasses({}), TypeError);
  assert.throws(() => deriveEligibilityClasses({ input: null }), TypeError);
  assert.throws(() => deriveEligibilityClasses({ input: [] }), TypeError);
});

// ---------------------------------------------------------------------------
// 2. Empty input handled gracefully
// ---------------------------------------------------------------------------

test('handles empty proctorsList → empty classes', () => {
  const result = deriveEligibilityClasses(makeState({ input: { proctorsList: [] } }));
  assert.deepStrictEqual(result.classes, []);
  assert.deepStrictEqual(Object.keys(result.classByProctorKey), []);
});

test('handles missing rows / normalized maps defensively', () => {
  // No rows, no duty, no exemptions, no ME — all proctors land in the same
  // class (empty eligibility tuple).
  const state = {
    input: { proctorsList: [{ cin: 'A1' }, { cin: 'A2' }] },
  };
  const result = deriveEligibilityClasses(state);
  assert.strictEqual(result.classes.length, 1);
  assert.strictEqual(result.classes[0].size, 2);
  assert.deepStrictEqual(result.classes[0].eligibleSessions, []);
  assert.deepStrictEqual(result.classes[0].dutyHalfdays, []);
  assert.strictEqual(result.classes[0].meGroup, null);
});

// ---------------------------------------------------------------------------
// 3. Identical eligibility tuples → same class (Task acceptance)
// ---------------------------------------------------------------------------

test('two proctors with identical eligibility tuples land in the same class', () => {
  const state = makeState({
    input: { proctorsList: [{ cin: 'A1' }, { cin: 'A2' }] },
    rows: [makeRow('s1', 'h1'), makeRow('s2', 'h2')],
    normalizedExemptionsData: {}, // neither exempt
    normalizedDutyData: {},
    normalizedMEAssignments: {},
  });
  const result = deriveEligibilityClasses(state);
  assert.strictEqual(result.classes.length, 1);
  assert.strictEqual(result.classByProctorKey.A1, result.classByProctorKey.A2);
  assert.deepStrictEqual(result.classes[0].proctorKeys.sort(), ['A1', 'A2']);
});

test('three proctors all in same class when nothing differentiates them', () => {
  const state = makeState({
    input: { proctorsList: [{ cin: 'A1' }, { cin: 'A2' }, { cin: 'A3' }] },
    rows: [makeRow('s1'), makeRow('s2'), makeRow('s3')],
  });
  const result = deriveEligibilityClasses(state);
  assert.strictEqual(result.classes.length, 1);
  assert.strictEqual(result.classes[0].size, 3);
});

// ---------------------------------------------------------------------------
// 4. Differing eligibleSessions → different classes
// ---------------------------------------------------------------------------

test('differing eligibleSessions → different classes (one exempt, one not)', () => {
  const state = makeState({
    input: { proctorsList: [{ cin: 'A1' }, { cin: 'A2' }] },
    rows: [makeRow('s1', 'h1'), makeRow('s2', 'h2')],
    normalizedExemptionsData: { s1: { A2: 'no' } }, // A2 exempt from s1
  });
  const result = deriveEligibilityClasses(state);
  assert.strictEqual(result.classes.length, 2);
  assert.notStrictEqual(result.classByProctorKey.A1, result.classByProctorKey.A2);
});

test('differing exemptions on different sessions still produces different classes', () => {
  const state = makeState({
    input: { proctorsList: [{ cin: 'A1' }, { cin: 'A2' }] },
    rows: [makeRow('s1'), makeRow('s2'), makeRow('s3')],
    // A1 exempt from s1, A2 exempt from s2 → different eligibleSessions sets
    normalizedExemptionsData: { s1: { A1: 'no' }, s2: { A2: 'no' } },
  });
  const result = deriveEligibilityClasses(state);
  assert.strictEqual(result.classes.length, 2);
});

// ---------------------------------------------------------------------------
// 5. Differing dutyHalfdays → different classes
// ---------------------------------------------------------------------------

test('differing dutyHalfdays → different classes', () => {
  const state = makeState({
    input: { proctorsList: [{ cin: 'A1' }, { cin: 'A2' }] },
    rows: [makeRow('s1', 'h1'), makeRow('s2', 'h2')],
    normalizedDutyData: { h1: { A1: true } }, // only A1 on duty in h1
  });
  const result = deriveEligibilityClasses(state);
  assert.strictEqual(result.classes.length, 2);
  assert.notStrictEqual(result.classByProctorKey.A1, result.classByProctorKey.A2);
});

// ---------------------------------------------------------------------------
// 6. Differing meGroup → different classes (and null vs non-null)
// ---------------------------------------------------------------------------

test('differing meGroup → different classes (null vs non-null)', () => {
  const state = makeState({
    input: { proctorsList: [{ cin: 'A1' }, { cin: 'A2' }] },
    rows: [makeRow('s1')],
    normalizedMEAssignments: { g1: { A1: true } }, // A1 in g1, A2 in none
  });
  const result = deriveEligibilityClasses(state);
  assert.strictEqual(result.classes.length, 2);
  // The two classes have different meGroup values: one null, one 'g1'.
  const meGroups = result.classes.map((c) => c.meGroup);
  assert.strictEqual(meGroups.filter((g) => g === null).length, 1);
  assert.strictEqual(meGroups.filter((g) => g === 'g1').length, 1);
});

test('differing meGroup → different classes (g1 vs g2)', () => {
  const state = makeState({
    input: { proctorsList: [{ cin: 'A1' }, { cin: 'A2' }] },
    rows: [makeRow('s1')],
    normalizedMEAssignments: {
      g1: { A1: true },
      g2: { A2: true },
    },
  });
  const result = deriveEligibilityClasses(state);
  assert.strictEqual(result.classes.length, 2);
  const meGroups = result.classes.map((c) => c.meGroup).sort();
  assert.deepStrictEqual(meGroups, ['g1', 'g2']);
});

test('proctor in multiple ME groups picks the first by sorted order', () => {
  const state = makeState({
    input: { proctorsList: [{ cin: 'A1' }] },
    rows: [makeRow('s1')],
    normalizedMEAssignments: {
      groupB: { A1: true },
      groupA: { A1: true }, // sorted first
      groupC: { A1: true },
    },
  });
  const result = deriveEligibilityClasses(state);
  assert.strictEqual(result.classes.length, 1);
  assert.strictEqual(result.classes[0].meGroup, 'groupA');
});

// ---------------------------------------------------------------------------
// 7. classId is deterministic (same input → same classId assignment)
// ---------------------------------------------------------------------------

test('classId is deterministic across runs (same input → same classIds)', () => {
  const buildState = () => makeState({
    input: { proctorsList: [{ cin: 'A1' }, { cin: 'A2' }, { cin: 'A3' }] },
    rows: [makeRow('s1', 'h1'), makeRow('s2', 'h2')],
    normalizedExemptionsData: { s1: { A2: 'no' } },
    normalizedDutyData: { h1: { A3: true } },
  });
  const r1 = deriveEligibilityClasses(buildState());
  const r2 = deriveEligibilityClasses(buildState());
  assert.deepStrictEqual(r1.classByProctorKey, r2.classByProctorKey);
  assert.deepStrictEqual(
    r1.classes.map((c) => ({ classId: c.classId, hash: c.hash, proctorKeys: c.proctorKeys })),
    r2.classes.map((c) => ({ classId: c.classId, hash: c.hash, proctorKeys: c.proctorKeys }))
  );
});

test('classId follows class_NNN format and is sequential by hash order', () => {
  const state = makeState({
    input: { proctorsList: [{ cin: 'A1' }, { cin: 'A2' }, { cin: 'A3' }] },
    rows: [makeRow('s1', 'h1'), makeRow('s2', 'h2')],
    normalizedExemptionsData: { s1: { A2: 'no' } }, // A2 different
    normalizedDutyData: { h1: { A3: true } }, // A3 different
  });
  const result = deriveEligibilityClasses(state);
  assert.strictEqual(result.classes.length, 3);
  // Sorted by hash ascending → ids class_000, class_001, class_002.
  for (let i = 0; i < result.classes.length; i += 1) {
    assert.strictEqual(result.classes[i].classId, 'class_' + String(i).padStart(3, '0'));
  }
  // hashes are in ascending order.
  for (let i = 1; i < result.classes.length; i += 1) {
    assert.ok(result.classes[i - 1].hash <= result.classes[i].hash);
  }
});

test('classId assignment is independent of proctorsList ordering', () => {
  // Same eligibility data, just shuffled proctor order. classes-by-hash
  // should be identical; classByProctorKey should map each canonical key
  // to the same classId regardless of proctorsList order.
  const stateA = makeState({
    input: { proctorsList: [{ cin: 'A1' }, { cin: 'A2' }] },
    rows: [makeRow('s1', 'h1')],
    normalizedDutyData: { h1: { A1: true } },
  });
  const stateB = makeState({
    input: { proctorsList: [{ cin: 'A2' }, { cin: 'A1' }] }, // reversed
    rows: [makeRow('s1', 'h1')],
    normalizedDutyData: { h1: { A1: true } },
  });
  const r1 = deriveEligibilityClasses(stateA);
  const r2 = deriveEligibilityClasses(stateB);
  assert.strictEqual(r1.classByProctorKey.A1, r2.classByProctorKey.A1);
  assert.strictEqual(r1.classByProctorKey.A2, r2.classByProctorKey.A2);
});

// ---------------------------------------------------------------------------
// 8. classByProctorKey returns the right classId for every proctor
// ---------------------------------------------------------------------------

test('classByProctorKey contains an entry for every proctor', () => {
  const state = makeState({
    input: { proctorsList: [{ cin: 'A1' }, { cin: 'A2' }, { cin: 'A3' }, { som: 'S4' }] },
    rows: [makeRow('s1')],
  });
  const result = deriveEligibilityClasses(state);
  assert.ok('A1' in result.classByProctorKey);
  assert.ok('A2' in result.classByProctorKey);
  assert.ok('A3' in result.classByProctorKey);
  // Som-only proctor uses canonical __idx_3.
  assert.ok('__idx_3' in result.classByProctorKey);
});

test('every proctorKey in any class.proctorKeys matches classByProctorKey', () => {
  const state = makeState({
    input: { proctorsList: [{ cin: 'A1' }, { cin: 'A2' }, { cin: 'A3' }] },
    rows: [makeRow('s1', 'h1'), makeRow('s2', 'h2')],
    normalizedDutyData: { h1: { A2: true } },
    normalizedExemptionsData: { s2: { A3: 'no' } },
  });
  const result = deriveEligibilityClasses(state);
  result.classes.forEach((c) => {
    c.proctorKeys.forEach((pk) => {
      assert.strictEqual(result.classByProctorKey[pk], c.classId,
        `${pk} should map to ${c.classId}`);
    });
  });
});

test('class.size matches proctorKeys.length', () => {
  const state = makeState({
    input: { proctorsList: [{ cin: 'A1' }, { cin: 'A2' }, { cin: 'A3' }] },
    rows: [makeRow('s1')],
  });
  const result = deriveEligibilityClasses(state);
  result.classes.forEach((c) => {
    assert.strictEqual(c.size, c.proctorKeys.length);
  });
});

// ---------------------------------------------------------------------------
// 9. Hash invariants (white-box on _internals.hashTuple)
// ---------------------------------------------------------------------------

test('hashTuple is order-independent on its set inputs', () => {
  const h1 = _internals.hashTuple(['s2', 's1'], ['h2', 'h1'], 'g1');
  const h2 = _internals.hashTuple(['s1', 's2'], ['h1', 'h2'], 'g1');
  assert.strictEqual(h1, h2);
});

test('hashTuple distinguishes meGroup null vs empty string vs value', () => {
  const a = _internals.hashTuple([], [], null);
  const b = _internals.hashTuple([], [], '');
  const c = _internals.hashTuple([], [], 'g1');
  // null and '' produce the same hash by the documented rule (meGroup || '')
  // — that is intentional because null and '' both denote "not in any group".
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
});

// ---------------------------------------------------------------------------
// 10. Som-only proctor canonical key behavior
// ---------------------------------------------------------------------------

test('som-only proctors are keyed by __idx_N and grouped correctly', () => {
  const state = makeState({
    input: { proctorsList: [{ cin: '', som: 'S1' }, { cin: '', som: 'S2' }] },
    rows: [makeRow('s1', 'h1')],
    // dutyData/exemptions/me empty → both proctors share an eligibility tuple
  });
  const result = deriveEligibilityClasses(state);
  assert.strictEqual(result.classes.length, 1);
  assert.deepStrictEqual(
    result.classes[0].proctorKeys.sort(),
    ['__idx_0', '__idx_1']
  );
});

// ---------------------------------------------------------------------------
// 11. Distinct sessions deduplicated across rooms
// ---------------------------------------------------------------------------

test('multiple rooms with same session_key count as ONE session in eligibleSessions', () => {
  // Two rows, same session_key, two different rooms.
  const state = makeState({
    input: { proctorsList: [{ cin: 'A1' }] },
    rows: [makeRow('s1', 'h1', 'R1'), makeRow('s1', 'h1', 'R2')],
  });
  const result = deriveEligibilityClasses(state);
  assert.strictEqual(result.classes.length, 1);
  assert.deepStrictEqual(result.classes[0].eligibleSessions, ['s1']);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
