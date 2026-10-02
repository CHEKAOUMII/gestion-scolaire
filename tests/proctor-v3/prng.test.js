/**
 * Unit tests for js/algorithms/proctor-v3/utils/prng.js
 *
 * Validates: Requirements 8.1, 8.2, 8.3 (seeded PRNG, deterministic).
 *
 * Run directly:   node tests/proctor-v3/prng.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

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
// 1. Identical seeds produce identical sequences (Requirements 8.1, 8.2)
// ---------------------------------------------------------------------------

test('identical seeds produce identical first-100 next() values', () => {
  const a = createPRNG(42);
  const b = createPRNG(42);
  for (let i = 0; i < 100; i += 1) {
    const va = a.next();
    const vb = b.next();
    assert.strictEqual(va, vb, `divergence at index ${i}: ${va} vs ${vb}`);
  }
});

test('identical seeds produce identical first-100 nextInt(n) values', () => {
  const a = createPRNG(12345);
  const b = createPRNG(12345);
  for (let i = 0; i < 100; i += 1) {
    const va = a.nextInt(1000);
    const vb = b.nextInt(1000);
    assert.strictEqual(va, vb, `nextInt divergence at index ${i}`);
  }
});

// ---------------------------------------------------------------------------
// 2. Different seeds produce different sequences
// ---------------------------------------------------------------------------

test('different seeds produce different sequences', () => {
  const a = createPRNG(1);
  const b = createPRNG(2);
  // Compare first 20 values; at least one must differ.
  let anyDifferent = false;
  for (let i = 0; i < 20; i += 1) {
    if (a.next() !== b.next()) {
      anyDifferent = true;
    }
  }
  assert.strictEqual(anyDifferent, true, 'sequences from different seeds were identical');
});

// ---------------------------------------------------------------------------
// 3. next() returns a float in [0, 1)
// ---------------------------------------------------------------------------

test('next() returns floats in [0, 1)', () => {
  const r = createPRNG(7);
  for (let i = 0; i < 1000; i += 1) {
    const v = r.next();
    assert.strictEqual(typeof v, 'number', 'next() must return a number');
    assert.ok(v >= 0, `next() returned ${v} < 0`);
    assert.ok(v < 1, `next() returned ${v} >= 1`);
  }
});

// ---------------------------------------------------------------------------
// 4. nextInt(n) range correctness
// ---------------------------------------------------------------------------

test('nextInt(n) returns integers in [0, n)', () => {
  const r = createPRNG(99);
  const n = 10;
  for (let i = 0; i < 1000; i += 1) {
    const v = r.nextInt(n);
    assert.ok(Number.isInteger(v), `nextInt returned non-integer ${v}`);
    assert.ok(v >= 0 && v < n, `nextInt returned ${v} outside [0, ${n})`);
  }
});

test('nextInt(1) always returns 0', () => {
  const r = createPRNG(123);
  for (let i = 0; i < 50; i += 1) {
    assert.strictEqual(r.nextInt(1), 0);
  }
});

test('nextInt rejects non-positive or non-integer n', () => {
  const r = createPRNG(0);
  assert.throws(() => r.nextInt(0), RangeError);
  assert.throws(() => r.nextInt(-5), RangeError);
  assert.throws(() => r.nextInt(1.5), RangeError);
});

// ---------------------------------------------------------------------------
// 5. seed field is preserved on the returned object
// ---------------------------------------------------------------------------

test('seed field is recorded on the returned object', () => {
  const r = createPRNG(424242);
  assert.strictEqual(r.seed, 424242, 'seed field should match input seed');
});

test('seed field is coerced to uint32', () => {
  // Negative seed becomes its uint32 wraparound.
  const r = createPRNG(-1);
  assert.strictEqual(r.seed, 0xFFFFFFFF, 'negative seed should wrap to uint32');
});

test('seed field is read-only-ish (mutation does not affect state)', () => {
  // The returned object is a plain object; we only assert that
  // mutating .seed externally does NOT change the generated sequence.
  const a = createPRNG(50);
  const b = createPRNG(50);
  a.seed = 9999; // attempt external mutation
  for (let i = 0; i < 10; i += 1) {
    assert.strictEqual(a.next(), b.next(), `external seed mutation affected sequence at ${i}`);
  }
});

// ---------------------------------------------------------------------------
// 6. Input validation
// ---------------------------------------------------------------------------

test('createPRNG rejects non-finite seeds', () => {
  assert.throws(() => createPRNG(NaN), TypeError);
  assert.throws(() => createPRNG(Infinity), TypeError);
  assert.throws(() => createPRNG(-Infinity), TypeError);
  assert.throws(() => createPRNG('42'), TypeError);
  assert.throws(() => createPRNG(undefined), TypeError);
  assert.throws(() => createPRNG(null), TypeError);
});

test('createPRNG accepts seed = 0', () => {
  const r = createPRNG(0);
  assert.strictEqual(r.seed, 0);
  const v = r.next();
  assert.ok(v >= 0 && v < 1);
});

// ---------------------------------------------------------------------------
// 7. Returned object shape (plain object, not class instance)
// ---------------------------------------------------------------------------

test('returned object has plain-object prototype and exposes seed/next/nextInt', () => {
  const r = createPRNG(1);
  assert.strictEqual(Object.getPrototypeOf(r), Object.prototype, 'must be a plain object');
  assert.strictEqual(typeof r.next, 'function');
  assert.strictEqual(typeof r.nextInt, 'function');
  assert.strictEqual(typeof r.seed, 'number');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
