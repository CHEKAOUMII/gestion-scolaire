'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 9.2 — Property 19: Bounded, covering chunking
//
// **Validates: Requirements 7.1, 7.3**
//
// Exercises the REAL exported `chunkArray` from main/sync/engine.js across the
// full input space: arbitrary arrays (incl. empty) and arbitrary sizes — the
// real Layer 2 sizes 30 (bulk reads) and 500 (batch commits), small sizes, and
// invalid sizes <= 0 / non-integer. Asserts the documented bounded, covering
// partition rules hold for every (input, size) pair.
//
// Feature: sync-push-throughput-optimization, Property 19: For any set of
// document ids and any positive chunk size s (30 for bulk reads, 500 for batch
// commits), the chunking partitions the set into groups each of size <= s whose
// union equals the original set with no duplicates and no omissions.

const assert = require('assert');
const fc = require('fast-check');

const { chunkArray } = require('../main/sync/engine');

const MIN_RUNS = 300;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// Arbitrary input arrays, including length 0. Elements are unique tokens so the
// union/duplicate assertions are exact; element identity is preserved by ref.
const inputArb = fc
    .array(fc.integer({ min: 0, max: 5000 }), { minLength: 0, maxLength: 600 })
    // Tag each element with its index to make every element unique and let us
    // assert order + exact membership without ambiguity from repeated values.
    .map((arr) => arr.map((v, i) => ({ v, i })));

// Sizes span the real Layer 2 values (30, 500), small sizes, and invalid sizes.
const sizeArb = fc.oneof(
    fc.constantFrom(30, 500), // the real Layer 2 chunk sizes
    fc.integer({ min: 1, max: 50 }), // small valid sizes
    fc.integer({ min: -10, max: 0 }), // invalid: <= 0 -> clamped to 1
    fc.constantFrom(1.5, 2.9, NaN), // invalid: non-integer -> clamped to 1
    fc.integer({ min: 1, max: 1000 }) // broad valid spread
);

console.log('[pbt] sync-push-throughput Property 19: bounded, covering chunking');

let checks = 0;

fc.assert(
    fc.property(inputArb, sizeArb, (input, size) => {
        const chunks = chunkArray(input, size);

        // Effective size: invalid (<= 0 or non-integer) is clamped to 1.
        const effectiveSize = Number.isInteger(size) && size >= 1 ? size : 1;

        assert.ok(Array.isArray(chunks), 'chunkArray must return an array');

        // Empty input -> [].
        if (input.length === 0) {
            assert.strictEqual(chunks.length, 0, 'empty input -> []');
            checks += 1;
            return true;
        }

        // 1) Every chunk has length <= effectiveSize (== max(1, size) for valid).
        for (const chunk of chunks) {
            assert.ok(Array.isArray(chunk), 'each chunk must be an array');
            assert.ok(
                chunk.length <= effectiveSize,
                `chunk length ${chunk.length} exceeds effective size ${effectiveSize}`
            );
            assert.ok(chunk.length >= 1, 'no chunk may be empty for non-empty input');
        }

        // 2) Concatenation in order reproduces the input EXACTLY — order
        //    preserved, no duplicates, no omissions (referential identity).
        const flat = [].concat(...chunks);
        assert.strictEqual(flat.length, input.length, 'union size must equal input size (no omissions/dupes)');
        for (let i = 0; i < input.length; i += 1) {
            assert.strictEqual(flat[i], input[i], `element at index ${i} must be preserved in order`);
        }

        // 3) All chunks except the last are exactly `effectiveSize` long.
        for (let i = 0; i < chunks.length - 1; i += 1) {
            assert.strictEqual(
                chunks[i].length,
                effectiveSize,
                `non-final chunk ${i} must be exactly ${effectiveSize} long`
            );
        }
        // The last chunk is in (0, effectiveSize].
        const last = chunks[chunks.length - 1];
        assert.ok(last.length >= 1 && last.length <= effectiveSize, 'final chunk must be in (0, effectiveSize]');

        // Number of chunks must be ceil(n / effectiveSize).
        assert.strictEqual(
            chunks.length,
            Math.ceil(input.length / effectiveSize),
            'chunk count must equal ceil(n / effectiveSize)'
        );

        checks += 1;
        return true;
    }),
    { numRuns: MIN_RUNS }
);

// ---------------------------------------------------------------------------
// Targeted anchors (Req 7.1 -> size 30 bulk reads; Req 7.3 -> size 500 commits).
// ---------------------------------------------------------------------------
{
    // Empty / non-array input -> [].
    assert.deepStrictEqual(chunkArray([], 30), [], 'empty input -> []');
    assert.deepStrictEqual(chunkArray(null, 500), [], 'null input -> []');
    assert.deepStrictEqual(chunkArray(undefined, 30), [], 'undefined input -> []');

    // Size 30 (bulk reads): 65 ids -> 30, 30, 5.
    const ids30 = Array.from({ length: 65 }, (_, i) => `id-${i}`);
    const c30 = chunkArray(ids30, 30);
    assert.strictEqual(c30.length, 3, '65 ids @ 30 -> 3 chunks');
    assert.deepStrictEqual([c30[0].length, c30[1].length, c30[2].length], [30, 30, 5], '30/30/5 split');
    assert.deepStrictEqual([].concat(...c30), ids30, 'size-30 union equals input exactly');

    // Size 500 (commits): exactly 1000 -> two full 500 chunks, none partial.
    const ids500 = Array.from({ length: 1000 }, (_, i) => i);
    const c500 = chunkArray(ids500, 500);
    assert.strictEqual(c500.length, 2, '1000 ops @ 500 -> 2 commits');
    assert.deepStrictEqual([c500[0].length, c500[1].length], [500, 500], 'both commits exactly 500');
    assert.deepStrictEqual([].concat(...c500), ids500, 'size-500 union equals input exactly');

    // Invalid sizes clamp to 1 -> one element per chunk.
    const cInvalid = chunkArray([1, 2, 3], 0);
    assert.deepStrictEqual(cInvalid, [[1], [2], [3]], 'size 0 clamps to 1');
    const cNeg = chunkArray([1, 2, 3], -5);
    assert.deepStrictEqual(cNeg, [[1], [2], [3]], 'negative size clamps to 1');
    const cFloat = chunkArray([1, 2, 3], 2.5);
    assert.deepStrictEqual(cFloat, [[1], [2], [3]], 'non-integer size clamps to 1');
}

console.log(`[pass] Property 19 held across ${checks} generated (input, size) pairs + anchors`);
