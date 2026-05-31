'use strict';

/**
 * Seeded PRNG using the mulberry32 algorithm.
 *
 * Mulberry32 is a 32-bit state generator with a period of 2^32 — sufficient
 * for proctor-distribution-v3 needs (we draw at most a few thousand values
 * per run). It is deterministic: identical seeds produce identical sequences.
 *
 * Acceptance Criteria covered:
 *   - 8.1: Accept a seed (finite number).
 *   - 8.2: Initialize a seeded PRNG from that value.
 *   - 8.3: When seed absent, caller is expected to derive one from Date.now()
 *          and pass it; this module always requires a numeric seed.
 *
 * @param {number} seed - Any finite number; coerced to uint32.
 * @returns {{ seed: number, next: function(): number, nextInt: function(number): number }}
 *   A plain object (not a class instance) with:
 *     - `seed`     : the original seed value (post-coercion to uint32).
 *     - `next()`   : returns a float in [0, 1).
 *     - `nextInt(n)`: returns an integer in [0, n).
 */
function createPRNG(seed) {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) {
    throw new TypeError('createPRNG: seed must be a finite number');
  }

  // Coerce to unsigned 32-bit integer for a stable starting state.
  const seed32 = seed >>> 0;
  let state = seed32;

  return {
    seed: seed32,

    next() {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },

    nextInt(n) {
      if (!Number.isInteger(n) || n <= 0) {
        throw new RangeError('createPRNG.nextInt: n must be a positive integer');
      }
      return Math.floor(this.next() * n);
    },
  };
}

module.exports = { createPRNG };
