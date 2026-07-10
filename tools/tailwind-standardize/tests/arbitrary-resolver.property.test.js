'use strict';

/**
 * Property-based tests for the Arbitrary-Value Resolver (pure core).
 *
 * Mirrors the existing project convention (see
 * tools/tailwind-standardize/tests/conflict-resolver.property.test.js): plain
 * Node built-in `assert`, named test functions, and a `run()` driver that throws
 * (non-zero exit) on the first failed assertion. The only added dependency is
 * `fast-check` (already a dev dependency, v4).
 *
 * Run directly:
 *   node tools/tailwind-standardize/tests/arbitrary-resolver.property.test.js
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
 */

const assert = require('assert');
const path = require('path');
const fc = require('fast-check');

const { tokenize } = require(path.join(__dirname, '..', 'core', 'tokenizer.js'));
const {
    resolveArbitrary,
    buildThemeIndex,
    buildRecurrenceIndex,
    normalizeComputedValue,
    proposeToken,
} = require(path.join(__dirname, '..', 'core', 'arbitrary-resolver.js'));

// ---------------------------------------------------------------------------
// Controlled theme + scale fixtures
//
// Values are chosen so that no token value collides with another token value or
// with a scale entry across namespaces — this keeps the oracle deterministic:
//   tokens : #3b6ac5, #ffffff, 1rem, 1.5rem, 9999px(=624.9375rem)
//   scale  : 0.5rem(=8px), 2rem(=32px)
// ---------------------------------------------------------------------------

const THEME_TOKENS = Object.freeze([
    { name: '--color-primary', value: '#3b6ac5' },
    { name: '--color-surface', value: '#ffffff' },
    { name: '--spacing-sm', value: '1rem' },
    { name: '--spacing-md', value: '1.5rem' },
    { name: '--radius-pill', value: '9999px' },
]);

const SPACING_SCALE = Object.freeze([
    { rawSuffix: '2', value: '0.5rem' }, // 8px
    { rawSuffix: '8', value: '2rem' }, // 32px
]);

// Bases whose tokenizer category resolves to a single, known namespace.
const COLOR_BASES = Object.freeze(['bg', 'text', 'fill', 'stroke', 'caret', 'accent']);
const SPACING_BASES = Object.freeze(['p', 'm', 'mt', 'mb', 'mx', 'px', 'gap', 'w', 'h', 'min-w', 'max-w']);
const RADIUS_BASES = Object.freeze(['rounded']);

const PREFIXES = Object.freeze(['', 'md:', 'hover:', 'md:hover:', 'lg:focus:']);

// ---------------------------------------------------------------------------
// Case catalogs
// ---------------------------------------------------------------------------

// (a) literals whose normalized computed value equals an EXISTING token.
const MATCH_TOKEN_TARGETS = [
    { tokenName: '--color-primary', suffix: 'primary', bases: COLOR_BASES, literals: ['#3b6ac5', '#3B6AC5'] },
    { tokenName: '--color-surface', suffix: 'surface', bases: COLOR_BASES, literals: ['#ffffff', '#FFFFFF', '#fff', '#FFF'] },
    { tokenName: '--spacing-sm', suffix: 'sm', bases: SPACING_BASES, literals: ['1rem', '16px'] },
    { tokenName: '--spacing-md', suffix: 'md', bases: SPACING_BASES, literals: ['1.5rem', '24px'] },
    { tokenName: '--radius-pill', suffix: 'pill', bases: RADIUS_BASES, literals: ['9999px'] },
];

const MATCH_TOKEN_CASES = (() => {
    const out = [];
    for (const t of MATCH_TOKEN_TARGETS) {
        for (const base of t.bases) {
            for (const literal of t.literals) {
                out.push({ base, literal, tokenName: t.tokenName, suffix: t.suffix });
            }
        }
    }
    return out;
})();

// (a') magic-number literals whose normalized value equals a SCALE entry (no token).
const MATCH_SCALE_TARGETS = [
    { suffix: '2', literals: ['0.5rem', '8px'] },
    { suffix: '8', literals: ['2rem', '32px'] },
];

const MATCH_SCALE_CASES = (() => {
    const out = [];
    for (const t of MATCH_SCALE_TARGETS) {
        for (const base of SPACING_BASES) {
            for (const literal of t.literals) {
                out.push({ base, literal, suffix: t.suffix });
            }
        }
    }
    return out;
})();

// (b)/(c) novel literals that match neither a token nor a scale entry.
const NOVEL_BY_NAMESPACE = [
    { namespace: 'color', bases: COLOR_BASES, literals: ['#abcdef', '#101112', '#0a0b0c', '#bada55'] },
    { namespace: 'spacing', bases: SPACING_BASES, literals: ['7px', '13px', '101px', '0.4375rem'] },
    { namespace: 'radius', bases: RADIUS_BASES, literals: ['3px', '5px', '11px'] },
];

const NOVEL_CASES = (() => {
    const out = [];
    for (const t of NOVEL_BY_NAMESPACE) {
        for (const base of t.bases) {
            for (const literal of t.literals) {
                out.push({ base, literal, namespace: t.namespace });
            }
        }
    }
    return out;
})();

// ---------------------------------------------------------------------------
// Scenario generators (each yields { kind, raw, base, files, expected })
// ---------------------------------------------------------------------------

const prefixArb = fc.constantFrom(...PREFIXES);

const matchTokenScenarioArb = fc
    .record({ c: fc.constantFrom(...MATCH_TOKEN_CASES), prefix: prefixArb })
    .map(({ c, prefix }) => ({
        kind: 'match-token',
        raw: `${prefix}${c.base}-[${c.literal}]`,
        base: c.base,
        files: [],
        expected: { action: 'replace-existing', tokenName: c.tokenName, suffix: c.suffix },
    }));

const matchScaleScenarioArb = fc
    .record({ c: fc.constantFrom(...MATCH_SCALE_CASES), prefix: prefixArb })
    .map(({ c, prefix }) => ({
        kind: 'match-scale',
        raw: `${prefix}${c.base}-[${c.literal}]`,
        base: c.base,
        files: [],
        expected: { action: 'replace-existing', tokenName: undefined, suffix: c.suffix },
    }));

const addTokenScenarioArb = fc
    .record({
        c: fc.constantFrom(...NOVEL_CASES),
        prefix: prefixArb,
        n: fc.integer({ min: 2, max: 5 }),
    })
    .map(({ c, prefix, n }) => ({
        kind: 'add-token',
        raw: `${prefix}${c.base}-[${c.literal}]`,
        base: c.base,
        namespace: c.namespace,
        files: Array.from({ length: n }, (_unused, i) => `dir/file-${i}.html`),
        expected: { action: 'add-token' },
    }));

const retainScenarioArb = fc
    .record({
        c: fc.constantFrom(...NOVEL_CASES),
        prefix: prefixArb,
        n: fc.integer({ min: 0, max: 1 }),
    })
    .map(({ c, prefix, n }) => ({
        kind: 'retain',
        raw: `${prefix}${c.base}-[${c.literal}]`,
        base: c.base,
        namespace: c.namespace,
        files: Array.from({ length: n }, (_unused, i) => `dir/file-${i}.html`),
        expected: { action: 'retain' },
    }));

const scenarioArb = fc.oneof(
    matchTokenScenarioArb,
    matchScaleScenarioArb,
    addTokenScenarioArb,
    retainScenarioArb
);

// ---------------------------------------------------------------------------
// Helper: the utility prefix the replacement should keep (base up to '[').
// ---------------------------------------------------------------------------

function basePrefixOf(token) {
    const open = token.base.indexOf('[');
    return open === -1 ? token.base : token.base.slice(0, open);
}

// ---------------------------------------------------------------------------
// Property 9
// ---------------------------------------------------------------------------

// Feature: tailwind-css-standardization, Property 9: Arbitrary-value substitution is value-equivalent and threshold-correct
function testArbitrarySubstitution() {
    fc.assert(
        fc.property(scenarioArb, (scenario) => {
            const token = tokenize(scenario.raw)[0];

            // Guard: the input must be an arbitrary-value utility, else the
            // scenario (and oracle) is meaningless.
            assert.ok(token && token.isArbitrary, `expected an arbitrary token for "${scenario.raw}"`);

            const occurrences = scenario.files.map((filePath) => ({
                value: token.arbitraryValue,
                filePath,
            }));
            const recurrence = buildRecurrenceIndex(occurrences);
            const themeIndex = buildThemeIndex({
                tokens: THEME_TOKENS,
                spacingScale: SPACING_SCALE,
                recurrence,
            });

            const result = resolveArbitrary(token, themeIndex);
            const computed = normalizeComputedValue(token.arbitraryValue);
            const prefix = basePrefixOf(token);

            // The reported computed value is always the canonical literal value.
            assert.strictEqual(result.computedValue, computed, 'computedValue must be the normalized literal');

            // The chosen action must match the oracle for this scenario kind.
            assert.strictEqual(
                result.action,
                scenario.expected.action,
                `action mismatch for "${scenario.raw}" (files=${scenario.files.length})`
            );

            if (scenario.kind === 'match-token') {
                // Req 3.1: replace with the referencing utility, value preserved.
                assert.strictEqual(result.tokenName, scenario.expected.tokenName, 'must reference the matching token');
                assert.strictEqual(
                    themeIndex.tokenValues.get(result.tokenName),
                    computed,
                    'matched token value must equal the literal computed value (value-equivalent)'
                );
                assert.ok(result.replacement, 'replace-existing must carry a replacement token');
                assert.strictEqual(
                    result.replacement.base,
                    `${prefix}${scenario.expected.suffix}`,
                    'replacement must reference the token suffix on the same utility prefix'
                );
                assert.strictEqual(result.replacement.isArbitrary, false, 'replacement must not be arbitrary');
                return;
            }

            if (scenario.kind === 'match-scale') {
                // Req 3.4: replace magic number with the scale utility, value preserved.
                assert.strictEqual(result.tokenName, undefined, 'scale match references a scale entry, not a named token');
                const scaleEntry = themeIndex.scaleByValue.get(computed);
                assert.ok(scaleEntry, 'the computed value must exist in the scale index');
                assert.strictEqual(scaleEntry.suffix, scenario.expected.suffix, 'scale suffix mismatch');
                assert.ok(result.replacement, 'scale replacement must carry a replacement token');
                assert.strictEqual(
                    result.replacement.base,
                    `${prefix}${scenario.expected.suffix}`,
                    'replacement must reference the scale suffix on the same utility prefix'
                );
                // Value-equivalence: the scale entry renders the same computed value.
                assert.ok(
                    !themeIndex.byValue.has(computed),
                    'a scale-only match must not also be an existing named token'
                );
                return;
            }

            if (scenario.kind === 'add-token') {
                // Req 3.2 / 3.3 / 3.6: recurs in >= 2 files -> propose a new token
                // (named per convention) and replace every occurrence; value preserved.
                const proposed = proposeToken(computed, scenario.namespace);
                assert.strictEqual(result.tokenName, proposed.tokenName, 'add-token must propose the convention name');
                assert.ok(
                    /^--[a-z0-9]+-[a-z0-9-]+$/.test(result.tokenName),
                    `proposed token "${result.tokenName}" must follow the kebab-case naming convention`
                );
                assert.ok(
                    !themeIndex.tokenNames.has(result.tokenName),
                    'proposed token must not collide with an existing token name'
                );
                assert.ok(result.replacement, 'add-token must carry a replacement token');
                assert.strictEqual(
                    result.replacement.base,
                    `${prefix}${proposed.suffix}`,
                    'replacement must reference the proposed suffix on the same utility prefix'
                );
                // Value-equivalence: no existing token/scale already represented it.
                assert.ok(!themeIndex.byValue.has(computed), 'add-token value must not match an existing token');
                assert.ok(!themeIndex.scaleByValue.has(computed), 'add-token value must not match the scale');
                return;
            }

            // kind === 'retain' — Req 3.5: no match and recurs in < 2 files.
            assert.strictEqual(result.action, 'retain', 'fewer than two files must be retained for manual review');
            assert.strictEqual(result.tokenName, undefined, 'retain must not reference a token');
            assert.strictEqual(result.replacement, undefined, 'retain must not propose a replacement');
            // The retained item still identifies its value for the manual-review record.
            assert.strictEqual(result.computedValue, computed, 'retain must record the value');
            assert.ok(!themeIndex.byValue.has(computed), 'retain value must not match an existing token');
            assert.ok(!themeIndex.scaleByValue.has(computed), 'retain value must not match the scale');
        }),
        { numRuns: 300 }
    );

    console.log('[arbitrary-resolver.property] Property 9: arbitrary-value substitution OK');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testArbitrarySubstitution();
    console.log('[arbitrary-resolver.property] All arbitrary-resolver property tests passed');
}

run();
