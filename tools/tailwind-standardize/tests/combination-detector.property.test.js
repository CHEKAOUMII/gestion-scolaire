'use strict';

/**
 * Property-based test for the Combination Detector (core/combination-detector.js).
 *
 * Mirrors the existing project convention (see tools/tailwind-standardize/tests/
 * scanner.property.test.js and scope-resolver.property.test.js): plain Node
 * built-in `assert`, named test functions, and a `run()` driver that throws
 * (non-zero exit) on the first failed assertion. The only added dependency is
 * `fast-check` (already a dev dependency, v4). `detectCombinations()` is pure
 * (no file system access), so each generated occurrence list is fed directly.
 *
 * Property under test (design Property 3):
 *
 *   For any set of two or more utilities that appears (in ANY declaration
 *   order) at two or more DISTINCT element locations, detectCombinations
 *   records EXACTLY ONE duplicate-combination finding whose utilitySet is the
 *   canonical (order-independent) set and whose locations list EVERY distinct
 *   location where it occurs. Conversely, a combination that appears at fewer
 *   than two distinct locations (including a multi-utility set occurring many
 *   times at a single location, or a single utility repeated across locations)
 *   produces no finding.
 *
 * The scenario is constructed so the answer is known by construction:
 *   - The TARGET set (namespace `t-`) is the only set placed at >= 2 distinct
 *     locations, each placement in an independently shuffled order.
 *   - A DECOY multi-utility set (namespace `d-`) is emitted multiple times but
 *     always at a SINGLE distinct location -> must yield no finding.
 *   - NOISE sets (namespace `n{j}-`) are globally unique, one location each ->
 *     no finding.
 *   - An optional single utility (namespace `s-`) repeated across two distinct
 *     locations -> no finding (a single utility is never a combination).
 *   Because the target set is the sole set reaching two distinct locations, the
 *   detector must return exactly one finding, listing exactly the target's N
 *   distinct locations.
 *
 * **Validates: Requirements 1.6**
 *
 * Run directly:  node tools/tailwind-standardize/tests/combination-detector.property.test.js
 */

const assert = require('assert');
const path = require('path');
const fc = require('fast-check');

const { detectCombinations } = require(path.join(__dirname, '..', 'core', 'combination-detector.js'));

// ---------------------------------------------------------------------------
// Deterministic helpers — seeded shuffle and key-based permutation, so input
// (declaration) order is varied without coupling the test to fast-check's
// internal sequencing.
// ---------------------------------------------------------------------------

/** Tiny seeded PRNG (mulberry32) for deterministic, reproducible shuffles. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Fisher–Yates shuffle into a new array using the supplied PRNG. */
function shuffle(arr, rng) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
    }
    return out;
}

/** Permute `items` by sorting on `keys` (index tiebreak) — an arbitrary order. */
function permute(items, keys) {
    return items
        .map((value, i) => ({ value, key: keys[i], i }))
        .sort((a, b) => a.key - b.key || a.i - b.i)
        .map((entry) => entry.value);
}

/** Build a well-formed ElementLocator-compatible plain object. */
function loc(id, line, tag) {
    return { filePath: `${id}.html`, line, tag };
}

/** Stable comparison key for a locator (matches the detector's own notion). */
function locKey(locator) {
    return `${locator.filePath}\u0000${locator.line}\u0000${locator.tag}`;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// Target utilities live in a `t-` namespace so the target set can never collide
// with the decoy (`d-`), noise (`n{j}-`), or single (`s-`) namespaces.
const targetTokenArb = fc.constantFrom('t-a', 't-b', 't-c', 't-d', 't-e', 't-f', 't-g', 't-h');
const targetSetArb = fc.uniqueArray(targetTokenArb, { minLength: 2, maxLength: 6 });

// Six order keys is always >= the max target set size, so a permutation key is
// available for every utility regardless of the generated set length.
const orderKeysArb = fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 6, maxLength: 6 });
const tagArb = fc.constantFrom('div', 'span', 'section', 'li', 'button', 'a');

// One distinct target location: a shuffled placement of the target set, plus an
// optional duplicate occurrence at the SAME locator (must collapse to one
// location, never inflate the location list).
const targetLocationArb = fc.record({
    tag: tagArb,
    orderKeys: orderKeysArb,
    duplicate: fc.boolean(),
    dupOrderKeys: orderKeysArb,
});
const targetLocationsArb = fc.array(targetLocationArb, { minLength: 2, maxLength: 6 });

// A decoy multi-utility set repeated at a single distinct location.
const decoySetArb = fc.uniqueArray(fc.constantFrom('d-a', 'd-b', 'd-c', 'd-d', 'd-e'), {
    minLength: 2,
    maxLength: 4,
});
const decoyRepeatArb = fc.integer({ min: 2, max: 4 });
const decoyOrderArb = fc.array(orderKeysArb, { minLength: 4, maxLength: 4 });

// Noise: globally unique sets, one location each (size 1 also exercises the
// "single utility is never a combination" rule at a unique location).
const noiseArb = fc.array(fc.record({ size: fc.integer({ min: 1, max: 4 }) }), { minLength: 0, maxLength: 6 });

const scenarioArb = fc.record({
    targetSet: targetSetArb,
    targetLocations: targetLocationsArb,
    decoySet: decoySetArb,
    decoyRepeat: decoyRepeatArb,
    decoyOrders: decoyOrderArb,
    decoyTag: tagArb,
    noise: noiseArb,
    singleRepeated: fc.boolean(),
    seed: fc.integer({ min: 0, max: 0x7fffffff }),
});

// ---------------------------------------------------------------------------
// Scenario builder — returns the occurrence list plus the known expected answer.
// ---------------------------------------------------------------------------

function buildScenario(s) {
    const occurrences = [];
    const expectedLocatorKeys = new Set();
    const canonicalTarget = [...s.targetSet].sort();

    // TARGET: same set, each location an independent shuffle. Lines 1..N keep
    // every target locator distinct.
    s.targetLocations.forEach((spec, i) => {
        const locator = loc(`t${i}`, i + 1, spec.tag);
        expectedLocatorKeys.add(locKey(locator));
        occurrences.push({ utilities: permute(s.targetSet, spec.orderKeys), locator });
        if (spec.duplicate) {
            // Duplicate occurrence at the SAME locator -> must dedupe to one location.
            occurrences.push({ utilities: permute(s.targetSet, spec.dupOrderKeys), locator });
        }
    });

    // DECOY: a multi-utility set occurring several times but at ONE location.
    const decoyLocator = loc('decoy', 1000, s.decoyTag);
    for (let r = 0; r < s.decoyRepeat; r += 1) {
        const keys = s.decoyOrders[r % s.decoyOrders.length];
        occurrences.push({ utilities: permute(s.decoySet, keys), locator: decoyLocator });
    }

    // NOISE: globally unique sets, one distinct location each.
    s.noise.forEach((spec, j) => {
        const utilities = Array.from({ length: spec.size }, (_unused, t) => `n${j}-${t}`);
        occurrences.push({ utilities, locator: loc(`n${j}`, 2000 + j, 'div') });
    });

    // SINGLE utility repeated across two distinct locations -> not a combination.
    if (s.singleRepeated) {
        occurrences.push({ utilities: ['s-x'], locator: loc('s0', 3000, 'div') });
        occurrences.push({ utilities: ['s-x'], locator: loc('s1', 3001, 'span') });
    }

    return { occurrences, expectedLocatorKeys, canonicalTarget };
}

function locatorKeySet(locations) {
    return new Set(locations.map(locKey));
}

// ---------------------------------------------------------------------------
// Property 3
// ---------------------------------------------------------------------------

// Feature: tailwind-css-standardization, Property 3: Duplicate-combination detection is order-independent and exhaustive
function testDuplicateCombinationDetection() {
    fc.assert(
        fc.property(scenarioArb, (s) => {
            const { occurrences, expectedLocatorKeys, canonicalTarget } = buildScenario(s);

            const rng = mulberry32(s.seed);
            const shuffled = shuffle(occurrences, rng);
            const findings = detectCombinations(shuffled);

            // Exhaustive / no false positives: the target set is the ONLY set
            // reaching two distinct locations, so exactly one finding exists.
            assert.strictEqual(
                findings.length,
                1,
                `expected exactly one duplicate-combination finding, got ${findings.length}`
            );

            const finding = findings[0];

            // The finding's utilitySet is the canonical (order-independent) set.
            assert.deepStrictEqual(
                finding.utilitySet,
                canonicalTarget,
                'finding.utilitySet must be the canonical (sorted) target utility set'
            );

            // The finding lists EVERY distinct target location and no others,
            // independent of declaration order and of duplicate occurrences.
            assert.deepStrictEqual(
                locatorKeySet(finding.locations),
                expectedLocatorKeys,
                'finding.locations must be exactly the distinct target locations'
            );
            assert.strictEqual(
                finding.locations.length,
                expectedLocatorKeys.size,
                'finding.locations must contain no duplicate locations'
            );

            // Order-independence of the output: re-running on the reversed input
            // yields an identical result (same set, same locations).
            const reversedFindings = detectCombinations(occurrences.slice().reverse());
            assert.strictEqual(reversedFindings.length, 1, 'reversed input must also yield one finding');
            assert.deepStrictEqual(
                reversedFindings[0].utilitySet,
                canonicalTarget,
                'reversed-input finding.utilitySet must match'
            );
            assert.deepStrictEqual(
                locatorKeySet(reversedFindings[0].locations),
                expectedLocatorKeys,
                'reversed-input finding.locations must match (order-independence)'
            );
        }),
        { numRuns: 200 }
    );

    console.log('[combination-detector.property] Property 3: duplicate-combination detection OK');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testDuplicateCombinationDetection();
    console.log('[combination-detector.property] All combination-detector property tests passed');
}

run();
