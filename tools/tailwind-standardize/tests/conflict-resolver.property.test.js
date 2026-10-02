'use strict';

/**
 * Property-based tests for the Conflict Resolver (pure core).
 *
 * Mirrors the existing project convention (see
 * tools/tailwind-standardize/tests/scope-resolver.property.test.js): plain Node
 * built-in `assert`, named test functions, and a `run()` driver that throws
 * (non-zero exit) on the first failed assertion. The only added dependency is
 * `fast-check` (already a dev dependency, v4).
 *
 * Run directly:
 *   node tools/tailwind-standardize/tests/conflict-resolver.property.test.js
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
 */

const assert = require('assert');
const path = require('path');
const fc = require('fast-check');

const { tokenize } = require(path.join(__dirname, '..', 'core', 'tokenizer.js'));
const {
    resolveConflicts,
    COMPOSABLE_PROPERTIES,
} = require(path.join(__dirname, '..', 'core', 'conflict-resolver.js'));

// ---------------------------------------------------------------------------
// Utility catalog — bases whose resolved CSS property is stable and known.
//
// Each entry maps a base utility to the CSS property the tokenizer resolves it
// to, plus whether that property is COMPOSABLE (transform: there is no
// deterministic winner; utilities combine and are flagged for manual review).
// A runtime assertion below confirms the tokenizer agrees with this catalog so
// the oracle can never silently drift from the implementation.
// ---------------------------------------------------------------------------

const CATALOG = Object.freeze({
    'p-2': { property: 'padding', composable: false },
    'p-4': { property: 'padding', composable: false },
    'p-8': { property: 'padding', composable: false },
    'm-1': { property: 'margin', composable: false },
    'm-2': { property: 'margin', composable: false },
    'm-4': { property: 'margin', composable: false },
    'w-4': { property: 'width', composable: false },
    'w-8': { property: 'width', composable: false },
    'bg-red-500': { property: 'background-color', composable: false },
    'bg-blue-500': { property: 'background-color', composable: false },
    'scale-50': { property: 'transform', composable: true },
    'scale-75': { property: 'transform', composable: true },
    'rotate-45': { property: 'transform', composable: true },
});

const BASES = Object.keys(CATALOG);

// Four distinct variant/breakpoint contexts. Each prefix string maps to a
// distinct tokenizer contextKey, and the same prefix always maps to the same
// context — so the prefix string itself is a sound context identifier for the
// oracle. (md: -> responsive, hover: -> state, md:hover: -> both, '' -> base.)
const PREFIXES = ['', 'md:', 'hover:', 'md:hover:'];

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const tokenSpecArb = fc.record({
    prefix: fc.constantFrom(...PREFIXES),
    base: fc.constantFrom(...BASES),
});

// Lists are kept short so collisions (exact duplicates, same-property/context
// conflicts, composable groups, and cross-context same-property utilities) are
// frequent rather than rare.
const tokenListArb = fc.array(tokenSpecArb, { minLength: 0, maxLength: 12 });

// ---------------------------------------------------------------------------
// Oracle — an independent re-derivation of the expected partition.
// ---------------------------------------------------------------------------

/**
 * Compute the expected kept/removed/undecidable index sets for a list of token
 * specs, independently of the implementation.
 * @param {{prefix:string, base:string}[]} specs
 */
function expectedPartition(specs) {
    const removed = new Set();

    // Pass 1: exact-duplicate removal by raw text; keep the FIRST occurrence.
    const seenRaw = new Set();
    specs.forEach((spec, i) => {
        const raw = spec.prefix + spec.base;
        if (seenRaw.has(raw)) {
            removed.add(i);
        } else {
            seenRaw.add(raw);
        }
    });

    // Pass 2: same-context, same-property resolution over surviving members.
    const groups = new Map(); // key: `${prefix}||${property}` -> [indices]
    specs.forEach((spec, i) => {
        if (removed.has(i)) {
            return;
        }
        const property = CATALOG[spec.base].property;
        const key = `${spec.prefix}||${property}`;
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(i);
    });

    const undecidable = new Set();
    for (const members of groups.values()) {
        if (members.length < 2) {
            continue;
        }
        const composable = CATALOG[specs[members[0]].base].composable;
        if (composable) {
            // No deterministic winner: retain all, flag for manual review.
            members.forEach((i) => undecidable.add(i));
            continue;
        }
        // Deterministic override: the later (max index) survivor wins.
        const winner = members.reduce((a, b) => (b > a ? b : a), members[0]);
        members.forEach((i) => {
            if (i !== winner) {
                removed.add(i);
            }
        });
    }

    const kept = new Set();
    specs.forEach((_spec, i) => {
        if (!removed.has(i)) {
            kept.add(i);
        }
    });

    return { kept, removed, undecidable };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortedNums(set) {
    return Array.from(set).sort((a, b) => a - b);
}

/** Map each token in `result` back to its index in the original `tokens` array (by reference). */
function indicesOf(tokens, result) {
    return result.map((tok) => tokens.indexOf(tok));
}

function isStrictlyIncreasing(nums) {
    for (let i = 1; i < nums.length; i += 1) {
        if (nums[i] <= nums[i - 1]) {
            return false;
        }
    }
    return true;
}

// ---------------------------------------------------------------------------
// Property 8
// ---------------------------------------------------------------------------

// Feature: tailwind-css-standardization, Property 8: Conflict and duplicate resolution is correct, idempotent, and preserving
function testConflictResolution() {
    fc.assert(
        fc.property(tokenListArb, (specs) => {
            const classAttr = specs.map((s) => s.prefix + s.base).join(' ');
            const tokens = tokenize(classAttr);

            // Guard: the tokenizer must resolve each base to the property the
            // oracle assumes, otherwise the oracle is invalid.
            tokens.forEach((tok, i) => {
                assert.strictEqual(
                    tok.property,
                    CATALOG[specs[i].base].property,
                    `tokenizer property drift for "${specs[i].base}"`
                );
            });

            const { kept, removed, undecidable } = resolveConflicts(tokens);
            const expected = expectedPartition(specs);

            const keptIdx = indicesOf(tokens, kept);
            const removedIdx = indicesOf(tokens, removed);
            const undecidableIdx = indicesOf(tokens, undecidable);

            // Every result token must trace back to an input token.
            assert.ok(
                [...keptIdx, ...removedIdx, ...undecidableIdx].every((i) => i >= 0),
                'every result token must be one of the input tokens'
            );

            // --- Partition is exactly the oracle's partition --------------------
            // (6.1) winning utility kept / overridden removed; (6.3) exact
            // duplicates reduced; (6.2) different-context same-property retained.
            assert.deepStrictEqual(
                sortedNums(new Set(keptIdx)),
                sortedNums(expected.kept),
                'kept set must match the oracle'
            );
            assert.deepStrictEqual(
                sortedNums(new Set(removedIdx)),
                sortedNums(expected.removed),
                'removed set must match the oracle'
            );

            // (6.4) undecidable (composable) utilities are retained AND recorded.
            assert.deepStrictEqual(
                sortedNums(new Set(undecidableIdx)),
                sortedNums(expected.undecidable),
                'undecidable set must match the oracle'
            );

            // kept + removed partition the whole input (no token lost or invented).
            assert.strictEqual(
                kept.length + removed.length,
                tokens.length,
                'kept and removed must partition the input'
            );

            // undecidable ⊆ kept (undecidable utilities are never removed).
            const keptSet = new Set(keptIdx);
            assert.ok(
                undecidableIdx.every((i) => keptSet.has(i)),
                'every undecidable token must also be kept'
            );
            assert.ok(
                undecidableIdx.every((i) => COMPOSABLE_PROPERTIES.has(tokens[i].property)),
                'undecidable tokens must belong to a composable property'
            );

            // --- Order preservation: kept/removed are subsequences of the input --
            // (kept order is a subset of the original order.)
            assert.ok(isStrictlyIncreasing(keptIdx), 'kept must preserve original order');
            assert.ok(isStrictlyIncreasing(removedIdx), 'removed must preserve original order');

            // --- Exact-duplicate dedup: each raw survives at most once -----------
            const keptByRaw = new Map();
            for (const tok of kept) {
                keptByRaw.set(tok.raw, (keptByRaw.get(tok.raw) || 0) + 1);
            }
            for (const [raw, count] of keptByRaw) {
                assert.ok(count <= 1, `exact duplicate "${raw}" must reduce to a single kept instance`);
            }

            // --- Idempotency: a second run yields no further removals ------------
            const second = resolveConflicts(kept);
            assert.strictEqual(second.removed.length, 0, 'second run must remove nothing');
            assert.strictEqual(second.kept.length, kept.length, 'second run must keep the same tokens');
            second.kept.forEach((tok, i) => {
                assert.strictEqual(tok, kept[i], 'second run must preserve kept order and identity');
            });
            // The undecidable set is stable across runs (same token references).
            const firstUndecidable = new Set(undecidable);
            const secondUndecidable = new Set(second.undecidable);
            assert.strictEqual(
                secondUndecidable.size,
                firstUndecidable.size,
                'undecidable set size must be stable across runs'
            );
            assert.ok(
                second.undecidable.every((tok) => firstUndecidable.has(tok)),
                'second run undecidable set must match the first'
            );
        }),
        { numRuns: 200 }
    );

    console.log('[conflict-resolver.property] Property 8: conflict/duplicate resolution OK');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testConflictResolution();
    console.log('[conflict-resolver.property] All conflict-resolver property tests passed');
}

run();
