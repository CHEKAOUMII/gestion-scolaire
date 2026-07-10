'use strict';

/**
 * Property-based test for generated-identifier conventions and collisions.
 *
 * Mirrors the existing project convention (see tools/tailwind-standardize/tests/
 * combination-detector.property.test.js): plain Node built-in `assert`, named
 * test functions, and a `run()` driver that throws (non-zero exit) on the first
 * failed assertion. The only added dependency is `fast-check` (already a dev
 * dependency, v4). Both `proposeToken`/`resolveArbitrary` (core/arbitrary-
 * resolver.js) and `synthesizeComponentClass` (core/component-synthesizer.js)
 * are pure, so generated inputs are fed directly.
 *
 * Property under test (design Property 10):
 *
 *   For any new Design_Token or component class the tool generates, its name
 *   conforms to the established naming convention (casing, prefix, delimiter)
 *   of existing entries; and for any proposed identifier that matches an
 *   existing entry whose definition DIFFERS, the tool does NOT redefine the
 *   existing entry and records the collision ({ collision: true } / never
 *   redefines). An identifier matching an existing entry with an IDENTICAL
 *   definition is reused instead.
 *
 * Coverage:
 *   1. proposeToken: novel values + namespaces -> token name conforms to the
 *      `--<namespace>-<descriptor>` kebab/lowercase Theme_Block convention.
 *   2. resolveArbitrary add-token: a novel value recurring in >= 2 files mints a
 *      conventionally-named token; a value equal to an EXISTING token reuses
 *      that token's name (never mints a differing definition).
 *   3. synthesizeComponentClass: name conforms to the casing/prefix convention
 *      inferred from a generated component-layer index.
 *   4. synthesizeComponentClass collisions: a name matching an existing entry
 *      with a DIFFERING (or unknown) definition returns { collision: true } and
 *      leaves the existing entry untouched; an identical definition is reused.
 *
 * **Validates: Requirements 3.6, 3.7, 4.3, 10.8**
 *
 * Run directly:  node tools/tailwind-standardize/tests/identifier-conventions.property.test.js
 */

const assert = require('assert');
const path = require('path');
const fc = require('fast-check');

const arbitraryResolverPath = path.join(__dirname, '..', 'core', 'arbitrary-resolver.js');
const componentSynthesizerPath = path.join(__dirname, '..', 'core', 'component-synthesizer.js');

const {
    proposeToken,
    resolveArbitrary,
    buildThemeIndex,
    Namespace,
} = require(arbitraryResolverPath);
const { tokenize } = require(path.join(__dirname, '..', 'core', 'tokenizer.js'));
const {
    synthesizeComponentClass,
    inferConventions,
    Casing,
} = require(componentSynthesizerPath);

// ---------------------------------------------------------------------------
// Convention matchers
// ---------------------------------------------------------------------------

// A Theme_Block token name: `--<namespace>-<descriptor>`, lowercase, kebab
// (hyphen) delimited, every segment [a-z0-9]+, no leading/trailing/double
// hyphen in the descriptor.
const TOKEN_NAME_RE = /^--(color|spacing|radius)-[a-z0-9]+(-[a-z0-9]+)*$/;

/** Assert a component-class name conforms to the given casing convention. */
function nameConformsToCasing(name, casing) {
    if (casing === Casing.CAMEL) {
        // first segment lowercase alnum, each following segment Upper + lower/alnum.
        return /^[a-z][a-z0-9]*([A-Z][a-z0-9]*)*$/.test(name);
    }
    if (casing === Casing.SNAKE) {
        return /^[a-z0-9]+(_[a-z0-9]+)*$/.test(name);
    }
    // kebab
    return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
}

/** Does `name` carry `prefix` as its leading segment under `casing`? */
function startsWithPrefix(name, prefix, casing) {
    if (!prefix) {
        return true;
    }
    if (casing === Casing.CAMEL) {
        return name === prefix || name.startsWith(prefix);
    }
    const delimiter = casing === Casing.SNAKE ? '_' : '-';
    return name === prefix || name.startsWith(prefix + delimiter);
}

// ---------------------------------------------------------------------------
// Generators — Part 1/2: token naming
// ---------------------------------------------------------------------------

const namespaceArb = fc.constantFrom(Namespace.COLOR, Namespace.SPACING, Namespace.RADIUS);

// A 6-digit lowercase hex body (fast-check v4 has no hexaString helper).
const hexDigitArb = fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f');
const hexBodyArb = fc.array(hexDigitArb, { minLength: 6, maxLength: 6 }).map((d) => d.join(''));

// A "novel" computed value with at least one alphanumeric char, drawn from the
// shapes the resolver normalizes: hex colors, rgb()/rgba(), and rem lengths.
const hexColorArb = hexBodyArb.map((h) => `#${h}`);
const remLengthArb = fc
    .integer({ min: 1, max: 9999 })
    .chain((whole) => fc.integer({ min: 0, max: 9999 }).map((frac) => `${whole}.${frac}rem`));
const computedValueArb = fc.oneof(hexColorArb, remLengthArb, fc.constantFrom('inherit', 'currentColor', '0'));

// ---------------------------------------------------------------------------
// Generators — Part 3/4: component-class synthesis
// ---------------------------------------------------------------------------

// Utilities whose name segments are purely alphabetic, so a camelCase assembly
// is unambiguous (segment-initial char is always a letter).
const ALPHA_UTILITIES = [
    'flex', 'block', 'grid', 'hidden', 'relative', 'absolute',
    'border', 'rounded', 'shadow', 'transition',
    'bg-primary', 'bg-surface', 'text-white', 'text-main',
    'items-center', 'justify-between', 'rounded-md', 'border-solid',
    'flex-col', 'flex-row',
];
const utilityArb = fc.constantFrom(...ALPHA_UTILITIES);
const utilitySetArb = fc.uniqueArray(utilityArb, { minLength: 2, maxLength: 6 });

const casingArb = fc.constantFrom(Casing.KEBAB, Casing.SNAKE, Casing.CAMEL);

// Build existing component-class names that unambiguously establish a casing
// (and optionally a shared prefix), so inferConventions resolves deterministically.
function joinSegments(segments, casing, prefix) {
    const all = prefix ? [prefix, ...segments] : segments.slice();
    if (casing === Casing.CAMEL) {
        return all
            .map((s, i) => (i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)))
            .join('');
    }
    const delimiter = casing === Casing.SNAKE ? '_' : '-';
    return all.join(delimiter);
}

const WORD_BANK = ['card', 'panel', 'btn', 'badge', 'list', 'item', 'modal', 'header', 'footer', 'tile'];

const layerScenarioArb = fc
    .record({
        casing: casingArb,
        usePrefix: fc.boolean(),
        prefixWord: fc.constantFrom('ui', 'app', 'tw', 'comp'),
        names: fc.uniqueArray(
            fc.tuple(
                fc.constantFrom(...WORD_BANK),
                fc.constantFrom(...WORD_BANK)
            ),
            { minLength: 2, maxLength: 5 }
        ),
    })
    .map((s) => {
        const prefix = s.usePrefix ? s.prefixWord : '';
        // Each existing name has >= 2 segments (after the optional prefix) so it
        // unambiguously carries the delimiter/casing and is longer than the prefix.
        const existingNames = s.names.map(([a, b]) => joinSegments([a, b], s.casing, prefix));
        return { casing: s.casing, prefix, existingNames };
    });

// ---------------------------------------------------------------------------
// Property 10a — proposeToken naming convention
// ---------------------------------------------------------------------------

// Feature: tailwind-css-standardization, Property 10: Generated identifiers conform to conventions and never overwrite differing definitions
function testProposeTokenNamingConvention() {
    fc.assert(
        fc.property(computedValueArb, namespaceArb, (rawValue, namespace) => {
            const { tokenName, suffix } = proposeToken(rawValue, namespace);

            // Name conforms to the Theme_Block `--<namespace>-<descriptor>` convention.
            assert.ok(
                TOKEN_NAME_RE.test(tokenName),
                `proposed token name "${tokenName}" must match the --<namespace>-<descriptor> kebab/lowercase convention (value="${rawValue}", ns="${namespace}")`
            );

            // It lives in the requested namespace.
            assert.ok(
                tokenName.startsWith(`--${namespace}-`),
                `proposed token name "${tokenName}" must start with --${namespace}-`
            );

            // Color tokens carry the `custom-` descriptor prefix (Theme_Block convention).
            if (namespace === Namespace.COLOR) {
                assert.ok(
                    suffix.startsWith('custom-'),
                    `color token suffix "${suffix}" must start with custom-`
                );
            }

            // The descriptor (suffix) is itself kebab/lowercase with no stray chars.
            assert.ok(
                /^[a-z0-9]+(-[a-z0-9]+)*$/.test(suffix),
                `token suffix "${suffix}" must be lowercase kebab`
            );

            // Determinism: same inputs -> identical name.
            const again = proposeToken(rawValue, namespace);
            assert.strictEqual(again.tokenName, tokenName, 'proposeToken must be deterministic');
        }),
        { numRuns: 200 }
    );

    console.log('[identifier-conventions.property] Property 10a: proposeToken naming convention OK');
}

// ---------------------------------------------------------------------------
// Property 10b — resolveArbitrary mints conventional names / reuses existing
// ---------------------------------------------------------------------------

// Build a ClassToken for an arbitrary utility of a chosen namespace, using an
// ODD-pixel length for spacing/radius (never on the 0.25rem = 4px scale, whose
// entries are all even px) so the value is guaranteed novel.
function arbitraryTokenForNamespace(namespace, oddPx, hexBody) {
    if (namespace === Namespace.COLOR) {
        return tokenize(`bg-[#${hexBody}]`)[0];
    }
    if (namespace === Namespace.RADIUS) {
        return tokenize(`rounded-[${oddPx}px]`)[0];
    }
    return tokenize(`mt-[${oddPx}px]`)[0];
}

// Feature: tailwind-css-standardization, Property 10: Generated identifiers conform to conventions and never overwrite differing definitions
function testResolveArbitraryNamingAndReuse() {
    // 10b-i: a novel value recurring across >= 2 files mints a conventional name.
    fc.assert(
        fc.property(
            namespaceArb,
            fc.integer({ min: 0, max: 4000 }).map((n) => 2 * n + 1), // odd px
            hexBodyArb,
            (namespace, oddPx, hexBody) => {
                const token = arbitraryTokenForNamespace(namespace, oddPx, hexBody);
                // Empty token tables so nothing pre-exists to match by value.
                const themeIndex = buildThemeIndex({
                    tokens: [],
                    recurrence: { [token.arbitraryValue]: ['a.html', 'b.html'] },
                });

                const result = resolveArbitrary(token, themeIndex);

                assert.strictEqual(
                    result.action,
                    'add-token',
                    `expected add-token for novel recurring value "${token.arbitraryValue}", got "${result.action}"`
                );
                assert.ok(
                    TOKEN_NAME_RE.test(result.tokenName),
                    `minted token name "${result.tokenName}" must match the --<namespace>-<descriptor> convention`
                );
            }
        ),
        { numRuns: 150 }
    );

    // 10b-ii: a value EQUAL to an existing token reuses that token's name and is
    // never re-minted under a new (differing) definition.
    fc.assert(
        fc.property(
            hexBodyArb.map((h) => `#${h}`),
            (hexValue) => {
                const existingTokenName = '--color-brandx';
                const token = tokenize(`bg-[${hexValue}]`)[0];
                const themeIndex = buildThemeIndex({
                    tokens: [{ name: existingTokenName, value: hexValue }],
                    // Even though it recurs, an exact value match must win over add-token.
                    recurrence: { [hexValue]: ['a.html', 'b.html', 'c.html'] },
                });

                const result = resolveArbitrary(token, themeIndex);

                assert.strictEqual(
                    result.action,
                    'replace-existing',
                    `a value equal to an existing token must replace-existing, got "${result.action}"`
                );
                assert.strictEqual(
                    result.tokenName,
                    existingTokenName,
                    'the existing token name must be reused, never re-minted'
                );
            }
        ),
        { numRuns: 150 }
    );

    console.log('[identifier-conventions.property] Property 10b: resolveArbitrary naming + reuse OK');
}

// ---------------------------------------------------------------------------
// Property 10c — synthesizeComponentClass name conforms to inferred convention
// ---------------------------------------------------------------------------

// Feature: tailwind-css-standardization, Property 10: Generated identifiers conform to conventions and never overwrite differing definitions
function testComponentClassConvention() {
    fc.assert(
        fc.property(layerScenarioArb, utilitySetArb, (scenario, utilitySet) => {
            // Index carries only names (no declarations) so there is no collision;
            // we exercise pure naming-convention conformance.
            const componentLayerIndex = scenario.existingNames.slice();

            // Sanity: the convention we constructed is the one the tool infers.
            const inferred = inferConventions(componentLayerIndex);
            assert.strictEqual(
                inferred.casing,
                scenario.casing,
                `inferConventions casing mismatch for names ${JSON.stringify(componentLayerIndex)}`
            );

            const result = synthesizeComponentClass(utilitySet, componentLayerIndex);

            // No collision expected (utility-derived name won't equal an existing word-pair name).
            assert.ok(!result.collision, `unexpected collision for ${result.className}`);

            // The generated name conforms to the inferred casing convention.
            assert.ok(
                nameConformsToCasing(result.className, inferred.casing),
                `class name "${result.className}" must conform to ${inferred.casing} casing`
            );

            // And carries the inferred prefix when one exists.
            assert.ok(
                startsWithPrefix(result.className, inferred.prefix, inferred.casing),
                `class name "${result.className}" must carry inferred prefix "${inferred.prefix}"`
            );

            // Determinism: synthesizing again yields the same name + declaration.
            const again = synthesizeComponentClass(utilitySet, componentLayerIndex);
            assert.strictEqual(again.className, result.className, 'synthesis must be deterministic');
            assert.strictEqual(again.declaration, result.declaration, 'declaration must be deterministic');
        }),
        { numRuns: 200 }
    );

    console.log('[identifier-conventions.property] Property 10c: component-class naming convention OK');
}

// ---------------------------------------------------------------------------
// Property 10d — collisions are reported, never redefined; identicals reused
// ---------------------------------------------------------------------------

// Feature: tailwind-css-standardization, Property 10: Generated identifiers conform to conventions and never overwrite differing definitions
function testComponentClassCollisionAndReuse() {
    fc.assert(
        fc.property(layerScenarioArb, utilitySetArb, fc.constantFrom('differ', 'identical', 'unknown'), (scenario, utilitySet, mode) => {
            const baseNames = scenario.existingNames.slice();

            // First, learn the name + declaration the tool would generate.
            const base = synthesizeComponentClass(utilitySet, baseNames);
            assert.ok(!base.collision, 'base synthesis should not collide against name-only index');
            const { className, declaration } = base;

            if (mode === 'differ') {
                // Existing entry under the SAME name but a DIFFERING definition.
                const differingDecl = `.${className} {\n    @apply zzz-sentinel-utility;\n}`;
                const index = new Map(baseNames.map((n) => [n, null]));
                index.set(className, differingDecl);

                const result = synthesizeComponentClass(utilitySet, index);

                assert.strictEqual(result.className, className, 'collision must be reported on the same name');
                assert.strictEqual(result.collision, true, 'a differing existing definition must report a collision');
                // The existing entry is left untouched (returned verbatim, never redefined).
                assert.strictEqual(
                    result.existingDeclaration,
                    differingDecl,
                    'the existing differing definition must be preserved verbatim'
                );
                assert.notStrictEqual(
                    result.proposedDeclaration,
                    result.existingDeclaration,
                    'a collision implies proposed != existing'
                );
            } else if (mode === 'identical') {
                // Existing entry with an EQUIVALENT definition (utilities reordered
                // + reflowed whitespace) must be reused, not flagged as a collision.
                const reordered = declaration
                    .replace(/@apply ([^;]+);/, (whole, utils) => {
                        const sorted = utils.trim().split(/\s+/).reverse().join('  ');
                        return `@apply ${sorted} ;`;
                    });
                const index = new Map(baseNames.map((n) => [n, null]));
                index.set(className, reordered);

                const result = synthesizeComponentClass(utilitySet, index);

                assert.ok(!result.collision, 'an equivalent existing definition must NOT be a collision');
                assert.strictEqual(result.reused, true, 'an equivalent existing definition must be reused');
                assert.strictEqual(result.className, className, 'reused class keeps the same name');
            } else {
                // Existing entry whose definition is UNKNOWN (null) must report a collision,
                // never silently redefine.
                const index = new Map(baseNames.map((n) => [n, null]));
                index.set(className, null);

                const result = synthesizeComponentClass(utilitySet, index);

                assert.strictEqual(result.collision, true, 'an unknown existing definition must report a collision');
                assert.strictEqual(result.className, className, 'collision reported on the same name');
            }
        }),
        { numRuns: 200 }
    );

    console.log('[identifier-conventions.property] Property 10d: collision reporting + reuse OK');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testProposeTokenNamingConvention();
    testResolveArbitraryNamingAndReuse();
    testComponentClassConvention();
    testComponentClassCollisionAndReuse();
    console.log('[identifier-conventions.property] All identifier-convention property tests passed');
}

run();
