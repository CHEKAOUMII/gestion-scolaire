/**
 * Unit tests for js/algorithms/proctor-v3/solver/domain.js
 *
 * Validates: Requirement 8.5 (deterministic iteration order — `toArray()`
 * returns a sorted array).
 *
 * Run directly:   node tests/proctor-v3/domain.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

const { Domain } = require(path.join(
    __dirname,
    '..',
    '..',
    'js',
    'algorithms',
    'proctor-v3',
    'solver',
    'domain.js'
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
// 1. Construction
// ---------------------------------------------------------------------------

test('empty Domain has size 0 and isEmpty', () => {
    const d = new Domain();
    assert.strictEqual(d.size(), 0);
    assert.strictEqual(d.isEmpty(), true);
    assert.deepStrictEqual(d.toArray(), []);
});

test('Domain constructed from array contains those values', () => {
    const d = new Domain(['b', 'a', 'c']);
    assert.strictEqual(d.size(), 3);
    assert.strictEqual(d.isEmpty(), false);
});

test('Domain constructed from Set contains those values', () => {
    const d = new Domain(new Set(['x', 'y']));
    assert.strictEqual(d.size(), 2);
});

test('Domain collapses duplicate values', () => {
    const d = new Domain(['a', 'a', 'b', 'a']);
    assert.strictEqual(d.size(), 2);
    assert.deepStrictEqual(d.toArray(), ['a', 'b']);
});

test('Domain skips null and undefined entries', () => {
    const d = new Domain(['a', null, 'b', undefined]);
    assert.deepStrictEqual(d.toArray(), ['a', 'b']);
});

test('Domain accepts null/undefined values argument', () => {
    assert.strictEqual(new Domain(null).size(), 0);
    assert.strictEqual(new Domain(undefined).size(), 0);
});

test('Domain rejects non-iterable values argument', () => {
    assert.throws(() => new Domain(42), TypeError);
    assert.throws(() => new Domain({ a: 1 }), TypeError);
});

test('Domain can be constructed without `new`', () => {
    const d = Domain(['a', 'b']);
    assert.ok(d instanceof Domain);
    assert.strictEqual(d.size(), 2);
});

// ---------------------------------------------------------------------------
// 2. toArray() — sorted iteration (Requirement 8.5)
// ---------------------------------------------------------------------------

test('toArray() returns values in ascending lexicographic order', () => {
    const d = new Domain(['c', 'a', 'b']);
    assert.deepStrictEqual(d.toArray(), ['a', 'b', 'c']);
});

test('toArray() sort order is independent of insertion order', () => {
    const d1 = new Domain(['__idx_10', '__idx_2', 'cin42', '__idx_1']);
    const d2 = new Domain(['cin42', '__idx_1', '__idx_2', '__idx_10']);
    assert.deepStrictEqual(d1.toArray(), d2.toArray());
});

test('toArray() returns a fresh array each call (no shared reference)', () => {
    const d = new Domain(['a', 'b']);
    const arr1 = d.toArray();
    const arr2 = d.toArray();
    assert.notStrictEqual(arr1, arr2, 'toArray() must return a new array each call');
    arr1.push('mutated');
    assert.deepStrictEqual(d.toArray(), ['a', 'b'], 'mutating returned array must not affect Domain');
});

// ---------------------------------------------------------------------------
// 3. intersect()
// ---------------------------------------------------------------------------

test('intersect with overlapping Domain returns shared values', () => {
    const a = new Domain(['a', 'b', 'c']);
    const b = new Domain(['b', 'c', 'd']);
    const r = a.intersect(b);
    assert.deepStrictEqual(r.toArray(), ['b', 'c']);
});

test('intersect with disjoint Domain returns empty Domain', () => {
    const a = new Domain(['a', 'b']);
    const b = new Domain(['c', 'd']);
    const r = a.intersect(b);
    assert.strictEqual(r.size(), 0);
    assert.strictEqual(r.isEmpty(), true);
});

test('intersect with empty Domain returns empty Domain', () => {
    const a = new Domain(['a', 'b']);
    const r = a.intersect(new Domain());
    assert.strictEqual(r.isEmpty(), true);
});

test('intersect does not mutate either operand', () => {
    const a = new Domain(['a', 'b', 'c']);
    const b = new Domain(['b', 'c', 'd']);
    a.intersect(b);
    assert.deepStrictEqual(a.toArray(), ['a', 'b', 'c']);
    assert.deepStrictEqual(b.toArray(), ['b', 'c', 'd']);
});

test('intersect returns a new Domain instance', () => {
    const a = new Domain(['a', 'b']);
    const b = new Domain(['a', 'b']);
    const r = a.intersect(b);
    assert.ok(r instanceof Domain);
    assert.notStrictEqual(r, a);
    assert.notStrictEqual(r, b);
});

test('intersect is symmetric', () => {
    const a = new Domain(['a', 'b', 'c']);
    const b = new Domain(['b', 'c', 'd']);
    assert.deepStrictEqual(a.intersect(b).toArray(), b.intersect(a).toArray());
});

test('intersect rejects non-Domain argument', () => {
    const a = new Domain(['a']);
    assert.throws(() => a.intersect(['a']), TypeError);
    assert.throws(() => a.intersect(new Set(['a'])), TypeError);
    assert.throws(() => a.intersect(null), TypeError);
});

// ---------------------------------------------------------------------------
// 4. remove()
// ---------------------------------------------------------------------------

test('remove deletes an existing value', () => {
    const d = new Domain(['a', 'b', 'c']);
    d.remove('b');
    assert.deepStrictEqual(d.toArray(), ['a', 'c']);
});

test('remove of absent value is a no-op', () => {
    const d = new Domain(['a', 'b']);
    d.remove('z');
    assert.deepStrictEqual(d.toArray(), ['a', 'b']);
});

test('remove returns this for chaining', () => {
    const d = new Domain(['a', 'b', 'c']);
    const ret = d.remove('a').remove('b');
    assert.strictEqual(ret, d);
    assert.deepStrictEqual(d.toArray(), ['c']);
});

test('remove of null/undefined is a no-op', () => {
    const d = new Domain(['a']);
    d.remove(null);
    d.remove(undefined);
    assert.deepStrictEqual(d.toArray(), ['a']);
});

test('removing all values yields an empty Domain', () => {
    const d = new Domain(['a', 'b']);
    d.remove('a').remove('b');
    assert.strictEqual(d.isEmpty(), true);
    assert.strictEqual(d.size(), 0);
});

// ---------------------------------------------------------------------------
// 5. size() / isEmpty()
// ---------------------------------------------------------------------------

test('size reflects current number of values', () => {
    const d = new Domain(['a', 'b', 'c']);
    assert.strictEqual(d.size(), 3);
    d.remove('a');
    assert.strictEqual(d.size(), 2);
});

test('isEmpty toggles correctly', () => {
    const d = new Domain(['a']);
    assert.strictEqual(d.isEmpty(), false);
    d.remove('a');
    assert.strictEqual(d.isEmpty(), true);
});

// ---------------------------------------------------------------------------
// 6. clone() — independence
// ---------------------------------------------------------------------------

test('clone produces a Domain with the same values', () => {
    const d = new Domain(['a', 'b', 'c']);
    const c = d.clone();
    assert.ok(c instanceof Domain);
    assert.deepStrictEqual(c.toArray(), d.toArray());
});

test('clone returns a new instance, not the same reference', () => {
    const d = new Domain(['a']);
    const c = d.clone();
    assert.notStrictEqual(c, d);
});

test('mutating clone does not affect original', () => {
    const d = new Domain(['a', 'b', 'c']);
    const c = d.clone();
    c.remove('a');
    assert.deepStrictEqual(d.toArray(), ['a', 'b', 'c']);
    assert.deepStrictEqual(c.toArray(), ['b', 'c']);
});

test('mutating original does not affect clone', () => {
    const d = new Domain(['a', 'b', 'c']);
    const c = d.clone();
    d.remove('b');
    assert.deepStrictEqual(d.toArray(), ['a', 'c']);
    assert.deepStrictEqual(c.toArray(), ['a', 'b', 'c']);
});

test('clone of empty Domain is an empty Domain', () => {
    const c = new Domain().clone();
    assert.strictEqual(c.isEmpty(), true);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
