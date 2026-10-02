/**
 * Unit + property-based tests for
 * js/algorithms/proctor-v3/phases/01-normalize-keys.js
 *
 * Validates: Requirements 2.3, 2.4, 2.7
 *
 * Run directly:   node tests/proctor-v3/normalize-keys.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

const { normalizeKeys } = require(path.join(
  __dirname,
  '..',
  '..',
  'js',
  'algorithms',
  'proctor-v3',
  'phases',
  '01-normalize-keys.js'
));

const {
  canonicalProctorKey,
  buildKeyAdapter,
} = require(path.join(
  __dirname,
  '..',
  '..',
  'js',
  'algorithms',
  'proctor-v3',
  'canonical-key.js'
));

const { createPRNG } = require(path.join(
  __dirname,
  '..',
  '..',
  'js',
  'algorithms',
  'proctor-v3',
  'utils',
  'prng.js'
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

function makeState(input) {
  return { input: input };
}

function emptyInput() {
  return {
    proctorsList: [],
    dutyData: {},
    exemptionsData: {},
    meAssignments: {},
  };
}

// ---------------------------------------------------------------------------
// 1. Result shape & purity
// ---------------------------------------------------------------------------

test('returns a NEW state object (does not mutate input state)', () => {
  const state = makeState(emptyInput());
  const result = normalizeKeys(state);
  assert.notStrictEqual(result, state, 'result must not be the same reference');
  assert.strictEqual(state.adapter, undefined, 'original state must not gain adapter');
  assert.strictEqual(state.normalizedDutyData, undefined);
  assert.strictEqual(state.normalizedExemptionsData, undefined);
  assert.strictEqual(state.normalizedMEAssignments, undefined);
  assert.strictEqual(state.orphanInputKeys, undefined);
});

test('does NOT mutate state.input or any nested input field', () => {
  const input = {
    proctorsList: [{ cin: '12345', som: 'S1' }],
    dutyData: { 'h1': { '12345': true, 'GHOST': true } },
    exemptionsData: { 'sess1': { 'S1': 'no' } },
    meAssignments: { 'g1': { 'idx_0': true } },
  };
  const snapshot = JSON.parse(JSON.stringify(input));
  normalizeKeys(makeState(input));
  assert.deepStrictEqual(input, snapshot, 'input must be unchanged');
});

test('preserves unrelated state fields by shallow-copy', () => {
  const state = makeState(emptyInput());
  state.somethingElse = { foo: 'bar' };
  const result = normalizeKeys(state);
  assert.strictEqual(result.somethingElse, state.somethingElse);
});

test('result has all five output fields', () => {
  const result = normalizeKeys(makeState(emptyInput()));
  assert.ok('adapter' in result);
  assert.ok('normalizedDutyData' in result);
  assert.ok('normalizedExemptionsData' in result);
  assert.ok('normalizedMEAssignments' in result);
  assert.ok('orphanInputKeys' in result);
});

// ---------------------------------------------------------------------------
// 2. Empty / missing input maps handled gracefully
// ---------------------------------------------------------------------------

test('handles empty proctorsList gracefully', () => {
  const result = normalizeKeys(makeState(emptyInput()));
  assert.deepStrictEqual(result.normalizedDutyData, {});
  assert.deepStrictEqual(result.normalizedExemptionsData, {});
  assert.deepStrictEqual(result.normalizedMEAssignments, {});
  assert.deepStrictEqual(result.orphanInputKeys, []);
});

test('handles missing dutyData/exemptionsData/meAssignments fields', () => {
  const input = { proctorsList: [{ cin: 'A1' }] };
  const result = normalizeKeys(makeState(input));
  assert.deepStrictEqual(result.normalizedDutyData, {});
  assert.deepStrictEqual(result.normalizedExemptionsData, {});
  assert.deepStrictEqual(result.normalizedMEAssignments, {});
  assert.deepStrictEqual(result.orphanInputKeys, []);
});

test('handles null/undefined input maps without throwing', () => {
  const input = {
    proctorsList: [{ cin: 'A1' }],
    dutyData: null,
    exemptionsData: undefined,
    meAssignments: null,
  };
  const result = normalizeKeys(makeState(input));
  assert.deepStrictEqual(result.normalizedDutyData, {});
  assert.deepStrictEqual(result.normalizedExemptionsData, {});
  assert.deepStrictEqual(result.normalizedMEAssignments, {});
});

test('handles missing proctorsList by treating it as empty', () => {
  const input = {
    dutyData: { h1: { 'unknown': true } },
  };
  const result = normalizeKeys(makeState(input));
  // Every key is unresolvable — orphaned.
  assert.strictEqual(result.normalizedDutyData.h1 && Object.keys(result.normalizedDutyData.h1).length, 0);
  assert.strictEqual(result.orphanInputKeys.length, 1);
  assert.deepStrictEqual(result.orphanInputKeys[0], { source: 'dutyData', externalKey: 'unknown' });
});

test('throws TypeError on null state or missing input', () => {
  assert.throws(() => normalizeKeys(null), TypeError);
  assert.throws(() => normalizeKeys({}), TypeError);
  assert.throws(() => normalizeKeys({ input: null }), TypeError);
  assert.throws(() => normalizeKeys({ input: 'not-an-object' }), TypeError);
  assert.throws(() => normalizeKeys({ input: [] }), TypeError);
});

// ---------------------------------------------------------------------------
// 3. Correct translation across all three sources (Req 2.3, 2.7)
// ---------------------------------------------------------------------------

test('translates dutyData inner keys to canonical (cin path)', () => {
  const input = {
    proctorsList: [{ cin: '12345' }, { cin: '67890' }],
    dutyData: {
      '2026-06-04|صباحا': { '12345': true, '67890': true },
    },
  };
  const result = normalizeKeys(makeState(input));
  assert.deepStrictEqual(result.normalizedDutyData, {
    '2026-06-04|صباحا': { '12345': true, '67890': true },
  });
});

test('translates dutyData via som alias to canonical cin', () => {
  const input = {
    proctorsList: [{ cin: '12345', som: 'S1' }],
    dutyData: { h1: { S1: true } },
  };
  const result = normalizeKeys(makeState(input));
  // S1 alias resolves to canonical '12345'.
  assert.deepStrictEqual(result.normalizedDutyData, {
    h1: { '12345': true },
  });
});

test('translates idx_N and __idx_N aliases for som-only proctors', () => {
  const input = {
    proctorsList: [{ cin: '', som: 'S1' }, { cin: '' }],
    dutyData: {
      h1: { idx_0: true, '__idx_1': true },
    },
  };
  const result = normalizeKeys(makeState(input));
  assert.deepStrictEqual(result.normalizedDutyData, {
    h1: { '__idx_0': true, '__idx_1': true },
  });
});

test('translates exemptionsData preserving values verbatim', () => {
  const input = {
    proctorsList: [{ cin: 'A1', som: 'S1' }],
    exemptionsData: {
      sess1: { A1: 'no', S1: 'no' },
    },
  };
  const result = normalizeKeys(makeState(input));
  assert.deepStrictEqual(result.normalizedExemptionsData, {
    sess1: { A1: 'no' }, // both translate to canonical 'A1', value 'no' preserved
  });
});

test('translates meAssignments preserving values verbatim', () => {
  const input = {
    proctorsList: [{ cin: 'A1' }],
    meAssignments: { g1: { A1: true } },
  };
  const result = normalizeKeys(makeState(input));
  assert.deepStrictEqual(result.normalizedMEAssignments, {
    g1: { A1: true },
  });
});

test('SAME proctor uses identical canonical key across all three sources (Req 2.7)', () => {
  // Proctor 0: cin='ABC', som='S1' — referenced via different aliases per source.
  const input = {
    proctorsList: [{ cin: 'ABC', som: 'S1' }],
    dutyData: { h1: { ABC: true } },     // via cin
    exemptionsData: { sess1: { S1: 'no' } }, // via som
    meAssignments: { g1: { idx_0: true } },  // via idx_N
  };
  const result = normalizeKeys(makeState(input));
  // All three normalizations point at the same canonical 'ABC'.
  assert.ok('ABC' in result.normalizedDutyData.h1);
  assert.ok('ABC' in result.normalizedExemptionsData.sess1);
  assert.ok('ABC' in result.normalizedMEAssignments.g1);
});

test('preserves outer keys verbatim (halfday/session/group identifiers untouched)', () => {
  const input = {
    proctorsList: [{ cin: 'A1' }],
    dutyData: { '2026-06-04|صباحا': { A1: true } },
    exemptionsData: { 'session-key-with-dashes': { A1: 'no' } },
    meAssignments: { 'group-uuid-1234': { A1: true } },
  };
  const result = normalizeKeys(makeState(input));
  assert.ok('2026-06-04|صباحا' in result.normalizedDutyData);
  assert.ok('session-key-with-dashes' in result.normalizedExemptionsData);
  assert.ok('group-uuid-1234' in result.normalizedMEAssignments);
});

// ---------------------------------------------------------------------------
// 4. Orphan tracking with deduplication (Req 2.4)
// ---------------------------------------------------------------------------

test('records unresolvable keys in orphanInputKeys', () => {
  const input = {
    proctorsList: [{ cin: 'A1' }],
    dutyData: { h1: { GHOST: true } },
  };
  const result = normalizeKeys(makeState(input));
  assert.strictEqual(result.orphanInputKeys.length, 1);
  assert.deepStrictEqual(result.orphanInputKeys[0], {
    source: 'dutyData',
    externalKey: 'GHOST',
  });
});

test('drops orphan entries from normalized output', () => {
  const input = {
    proctorsList: [{ cin: 'A1' }],
    dutyData: { h1: { A1: true, GHOST: true } },
  };
  const result = normalizeKeys(makeState(input));
  // Only A1 survives.
  assert.deepStrictEqual(result.normalizedDutyData, { h1: { A1: true } });
});

test('deduplicates orphans across same source + same externalKey', () => {
  // Same orphan key referenced in two outer entries → ONE orphan record.
  const input = {
    proctorsList: [{ cin: 'A1' }],
    dutyData: {
      h1: { GHOST: true },
      h2: { GHOST: true },
    },
  };
  const result = normalizeKeys(makeState(input));
  assert.strictEqual(result.orphanInputKeys.length, 1);
  assert.deepStrictEqual(result.orphanInputKeys[0], {
    source: 'dutyData',
    externalKey: 'GHOST',
  });
});

test('keeps separate orphan records when same externalKey appears in different sources', () => {
  const input = {
    proctorsList: [{ cin: 'A1' }],
    dutyData: { h1: { GHOST: true } },
    exemptionsData: { sess1: { GHOST: 'no' } },
    meAssignments: { g1: { GHOST: true } },
  };
  const result = normalizeKeys(makeState(input));
  assert.strictEqual(result.orphanInputKeys.length, 3);
  const sources = result.orphanInputKeys.map((r) => r.source).sort();
  assert.deepStrictEqual(sources, ['dutyData', 'exemptionsData', 'meAssignments']);
  result.orphanInputKeys.forEach((r) => {
    assert.strictEqual(r.externalKey, 'GHOST');
  });
});

test('orphanInputKeys is an array of structured records, not strings', () => {
  const input = {
    proctorsList: [{ cin: 'A1' }],
    dutyData: { h1: { GHOST1: true } },
    exemptionsData: { sess1: { GHOST2: 'no' } },
  };
  const result = normalizeKeys(makeState(input));
  assert.ok(Array.isArray(result.orphanInputKeys));
  result.orphanInputKeys.forEach((r) => {
    assert.strictEqual(typeof r, 'object');
    assert.strictEqual(typeof r.source, 'string');
    assert.strictEqual(typeof r.externalKey, 'string');
  });
});

// ---------------------------------------------------------------------------
// 5. Adapter is exposed and matches buildKeyAdapter
// ---------------------------------------------------------------------------

test('result.adapter equals buildKeyAdapter(input.proctorsList)', () => {
  const input = {
    proctorsList: [
      { cin: 'A1', som: 'S1' },
      { cin: '', som: 'S2' },
      { cin: '   ', som: '' },
    ],
  };
  const result = normalizeKeys(makeState(input));
  const expected = buildKeyAdapter(input.proctorsList);
  // Compare structure (Object.create(null) → enumerate entries).
  const actualEntries = Object.keys(result.adapter).sort().map((k) => [k, result.adapter[k]]);
  const expectedEntries = Object.keys(expected).sort().map((k) => [k, expected[k]]);
  assert.deepStrictEqual(actualEntries, expectedEntries);
});

// ---------------------------------------------------------------------------
// 6. Property-based test (Task 5 spec): every entry in normalized data is
//    a canonical key for some proctor in the input. ~100 random inputs.
//    Validates: Requirements 2.3, 2.7
// ---------------------------------------------------------------------------

/**
 * Smart generator: builds a synthetic input with random proctors, halfdays,
 * sessions, ME groups, and a mix of resolvable and unresolvable proctor
 * references inside dutyData/exemptionsData/meAssignments.
 *
 * Constrains to the input space: outer keys are always synthetic strings
 * with deterministic prefixes; inner keys are sampled from the union of
 * (real proctor aliases, synthetic ghost strings).
 */
function generateRandomInput(rng) {
  // 1..15 proctors, mixed cin/som/empty.
  const nProctors = 1 + rng.nextInt(15);
  const proctorsList = [];
  for (let i = 0; i < nProctors; i += 1) {
    const shape = rng.nextInt(4);
    let proc;
    if (shape === 0) {
      proc = { cin: 'CIN_' + i, som: 'SOM_' + i };
    } else if (shape === 1) {
      proc = { cin: '', som: 'SOM_' + i };       // som-only → __idx_i canonical
    } else if (shape === 2) {
      proc = { cin: '  CIN_' + i + '  ' };       // whitespace-padded cin
    } else {
      proc = {};                                  // both missing → __idx_i
    }
    proctorsList.push(proc);
  }

  // Build pool of valid external aliases for these proctors.
  const validAliases = [];
  for (let i = 0; i < proctorsList.length; i += 1) {
    const p = proctorsList[i];
    const cin = p.cin != null ? String(p.cin).trim() : '';
    if (cin) validAliases.push(cin);
    if (cin && p.cin !== cin) validAliases.push(p.cin); // untrimmed form
    const som = p.som != null ? String(p.som).trim() : '';
    if (som) validAliases.push(som);
    validAliases.push('idx_' + i);
    validAliases.push('__idx_' + i);
  }

  // Some ghost (unresolvable) keys to exercise orphan tracking.
  const ghostPool = ['GHOST_A', 'GHOST_B', 'idx_999', 'phantom-cin', ''];

  function pickInnerKey() {
    // 75% chance of picking a valid alias, 25% chance of a ghost.
    if (rng.next() < 0.75 && validAliases.length > 0) {
      return validAliases[rng.nextInt(validAliases.length)];
    }
    return ghostPool[rng.nextInt(ghostPool.length)];
  }

  function buildOuter(maxOuter, maxInner, valueFactory) {
    const outer = {};
    const nOuter = rng.nextInt(maxOuter + 1); // 0..maxOuter
    for (let o = 0; o < nOuter; o += 1) {
      const outerKey = 'outer_' + o + '_' + rng.nextInt(1000);
      const inner = {};
      const nInner = rng.nextInt(maxInner + 1);
      for (let inn = 0; inn < nInner; inn += 1) {
        const k = pickInnerKey();
        if (k === '') continue; // skip empty-string inner keys (defensive)
        inner[k] = valueFactory();
      }
      outer[outerKey] = inner;
    }
    return outer;
  }

  return {
    proctorsList: proctorsList,
    dutyData: buildOuter(5, 6, () => true),
    exemptionsData: buildOuter(5, 6, () => 'no'),
    meAssignments: buildOuter(3, 4, () => true),
  };
}

test('PROPERTY: every key in normalized data is a canonical key for some proctor (100 seeds)', () => {
  for (let seed = 1; seed <= 100; seed += 1) {
    const rng = createPRNG(seed);
    const input = generateRandomInput(rng);
    const state = makeState(input);
    const result = normalizeKeys(state);

    // Build set of canonical keys for the input.
    const canonicalSet = new Set();
    for (let i = 0; i < input.proctorsList.length; i += 1) {
      canonicalSet.add(canonicalProctorKey(input.proctorsList[i], i));
    }

    // Every inner key in every normalized map must be a canonical key.
    function checkOuter(outer, source) {
      const outerKeys = Object.keys(outer);
      for (let oi = 0; oi < outerKeys.length; oi += 1) {
        const inner = outer[outerKeys[oi]];
        const innerKeys = Object.keys(inner);
        for (let ii = 0; ii < innerKeys.length; ii += 1) {
          const k = innerKeys[ii];
          assert.ok(
            canonicalSet.has(k),
            'seed=' + seed + ': key "' + k + '" in normalized ' + source +
              '."' + outerKeys[oi] + '" is not a canonical proctor key. ' +
              'canonical set = ' + JSON.stringify(Array.from(canonicalSet))
          );
        }
      }
    }
    checkOuter(result.normalizedDutyData, 'dutyData');
    checkOuter(result.normalizedExemptionsData, 'exemptionsData');
    checkOuter(result.normalizedMEAssignments, 'meAssignments');
  }
});

test('PROPERTY: orphanInputKeys are deduplicated and never overlap with valid resolutions (100 seeds)', () => {
  for (let seed = 101; seed <= 200; seed += 1) {
    const rng = createPRNG(seed);
    const input = generateRandomInput(rng);
    const result = normalizeKeys(makeState(input));

    // Dedup invariant: no two records share (source, externalKey).
    const fingerprints = result.orphanInputKeys.map(
      (r) => r.source + '\u0000' + r.externalKey
    );
    const uniqueFingerprints = new Set(fingerprints);
    assert.strictEqual(
      fingerprints.length,
      uniqueFingerprints.size,
      'seed=' + seed + ': orphanInputKeys must be deduplicated'
    );

    // Every record must have valid shape.
    result.orphanInputKeys.forEach((r) => {
      assert.ok(['dutyData', 'exemptionsData', 'meAssignments'].indexOf(r.source) !== -1);
      assert.strictEqual(typeof r.externalKey, 'string');
    });
  }
});

test('PROPERTY: normalizeKeys is deterministic — same input → same output (50 seeds)', () => {
  for (let seed = 201; seed <= 250; seed += 1) {
    const rng1 = createPRNG(seed);
    const rng2 = createPRNG(seed);
    const input1 = generateRandomInput(rng1);
    const input2 = generateRandomInput(rng2);
    const r1 = normalizeKeys(makeState(input1));
    const r2 = normalizeKeys(makeState(input2));
    assert.deepStrictEqual(r1.normalizedDutyData, r2.normalizedDutyData);
    assert.deepStrictEqual(r1.normalizedExemptionsData, r2.normalizedExemptionsData);
    assert.deepStrictEqual(r1.normalizedMEAssignments, r2.normalizedMEAssignments);
    assert.deepStrictEqual(r1.orphanInputKeys, r2.orphanInputKeys);
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
