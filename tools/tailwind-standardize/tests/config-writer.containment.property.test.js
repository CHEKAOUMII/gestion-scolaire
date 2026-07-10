'use strict';

/**
 * Property-based test for the Config Writer's CSS-first containment guarantee
 * (io/config-writer.js, pure transforms `writeTokens` / `writeComponentClasses`).
 *
 * Mirrors the existing project convention (see tools/tailwind-standardize/tests/
 * scope-resolver.property.test.js and component-synthesizer.property.test.js):
 * plain Node built-in `assert`, named test functions, and a `run()` driver that
 * throws (non-zero exit) on the first failed assertion. The only added
 * dependency is `fast-check` (already a dev dependency, v4).
 *
 * The transforms under test are PURE text functions — they take the CSS text of
 * the Config_Source plus the data to write and return the modified text, never
 * touching the file system — so each generated batch is fed directly against a
 * synthetic Config_Source string and the result is inspected structurally using
 * the exported block-locating helpers (`findThemeBlock`,
 * `findComponentLayerBlock`, `matchingBraceEnd`).
 *
 * Property under test (design Property 15):
 *
 *   For any set of new Design_Tokens and component classes, every token is
 *   written ONLY within the `@theme { ... }` block, every component class ONLY
 *   within the `@layer components { ... }` block, and any dark-mode styling is
 *   expressed ONLY through the existing `@variant dark` / `[data-theme="dark"]`
 *   mechanism — with no token or component definition placed in any other
 *   region and no alternative dark-mode mechanism introduced.
 *
 * Concretely:
 *   1. Every occurrence of each new token name in the result lies strictly
 *      inside the `@theme` block braces.
 *   2. Every occurrence of each new component class selector in the result lies
 *      strictly inside the `@layer components` block braces.
 *   3. The regions OUTSIDE both blocks are byte-for-byte unchanged (nothing was
 *      written anywhere else, and the existing dark mechanism is untouched).
 *   4. No alternative dark-mode mechanism (`prefers-color-scheme`, a `.dark`
 *      class, a redefining `@custom-variant dark`) appears in the result.
 *   5. A token/class snippet that WOULD introduce an alternative dark mechanism
 *      is rejected with a `ConfigWriteError` carrying code
 *      `ALTERNATIVE_DARK_MECHANISM`.
 *
 * **Validates: Requirements 10.1, 10.2, 10.5**
 *
 * Run directly:  node tools/tailwind-standardize/tests/config-writer.containment.property.test.js
 */

const assert = require('assert');
const path = require('path');
const fc = require('fast-check');

const {
    writeTokens,
    writeComponentClasses,
    findThemeBlock,
    findComponentLayerBlock,
    matchingBraceEnd,
    ConfigWriteError,
} = require(path.join(__dirname, '..', 'io', 'config-writer.js'));

// ---------------------------------------------------------------------------
// Synthetic Config_Source fixture.
//
// Deterministic layout (the `@theme` block always precedes the
// `@layer components` block) so the "outside" regions can be sliced
// unambiguously. It also contains other regions (an `@import`, a `:root` block,
// the EXISTING dark mechanism `@variant dark` / `[data-theme="dark"]`, and a
// trailing rule) so the test proves writes never leak out of the two blocks and
// never disturb the existing dark mechanism.
// ---------------------------------------------------------------------------

const CONFIG_BASE = [
    '/* tailwind-input.css — Config_Source (synthetic fixture) */',
    "@import 'tailwindcss';",
    '',
    ':root {',
    '    --legacy-gap: 8px;',
    '}',
    '',
    '@theme {',
    '    --existing-token: #ffffff;',
    '    --color-surface: #0a0a0a;',
    '}',
    '',
    '/* between region: the existing dark mechanism must be reused, never replaced */',
    '@variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));',
    '',
    '[data-theme="dark"] {',
    '    --existing-token: #000000;',
    '}',
    '',
    '@layer components {',
    '    .existing-card {',
    '        @apply p-4 rounded;',
    '    }',
    '}',
    '',
    '/* trailing region */',
    'body { color: var(--existing-token); }',
    '',
].join('\n');

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// A short, identifier-safe segment (lowercase letters/digits only).
const segment = fc
    .array(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'x', 'y', 'z', '0', '1', '2'), {
        minLength: 2,
        maxLength: 6,
    })
    .map((chars) => chars.join(''));

// Safe token values — none contain an alternative dark mechanism marker.
const VALUE_BANK = [
    '#ffffff',
    '#0a0a0a',
    '1rem',
    '0.5rem',
    '12px',
    'calc(1rem + 2px)',
    'var(--existing-token)',
    '2px solid #333333',
];

// Safe `@apply` utilities — none contain a `.dark` class or media marker.
const UTIL_BANK = [
    'p-4', 'px-2', 'rounded', 'flex', 'items-center',
    'bg-primary', 'text-sm', 'gap-2', 'shadow',
];

// A new token: name `--gen-<suffix>`, distinct from the fixture's tokens.
const tokenArb = fc.record({
    suffix: segment,
    value: fc.constantFrom(...VALUE_BANK),
});

// A new component class: name `cmp-<suffix>`, distinct from `.existing-card`.
const classArb = fc.record({
    suffix: segment,
    utils: fc.uniqueArray(fc.constantFrom(...UTIL_BANK), { minLength: 1, maxLength: 4 }),
});

const scenarioArb = fc.record({
    tokens: fc.uniqueArray(tokenArb, { minLength: 1, maxLength: 5, selector: (t) => t.suffix }),
    classes: fc.uniqueArray(classArb, { minLength: 1, maxLength: 5, selector: (c) => c.suffix }),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Every start index at which `needle` occurs in `haystack`. */
function allIndexes(haystack, needle) {
    const out = [];
    let i = haystack.indexOf(needle);
    while (i !== -1) {
        out.push(i);
        i = haystack.indexOf(needle, i + 1);
    }
    return out;
}

/**
 * Slice the three regions that lie OUTSIDE both target blocks. The `@theme`
 * block always precedes `@layer components` in the fixture, so:
 *   - header  = everything up to and including the `@theme {` open brace,
 *   - middle  = the `}` of @theme through the `@layer components {` open brace,
 *   - trailer = the `}` of @layer components through end of text.
 * Because writes are inserted strictly between a block's contentStart and its
 * closing brace, all three regions must be invariant under the transforms.
 */
function outsideRegions(text) {
    const theme = findThemeBlock(text);
    const comp = findComponentLayerBlock(text);
    assert.ok(theme, 'fixture must contain a @theme block');
    assert.ok(comp, 'fixture must contain a @layer components block');
    assert.ok(theme.closeBrace < comp.contentStart, 'fixture must place @theme before @layer components');
    return {
        theme,
        comp,
        header: text.slice(0, theme.contentStart),
        middle: text.slice(theme.closeBrace, comp.contentStart),
        trailer: text.slice(comp.closeBrace),
    };
}

/** Assert every occurrence of `needle` in `text` lies within [start, end). */
function assertContainedWithin(text, needle, start, end, label) {
    const indexes = allIndexes(text, needle);
    assert.ok(indexes.length > 0, `${label}: expected '${needle}' to be present in the result`);
    for (const idx of indexes) {
        assert.ok(
            idx >= start && idx + needle.length <= end,
            `${label}: '${needle}' at index ${idx} escaped the target block [${start}, ${end})`
        );
    }
}

// ---------------------------------------------------------------------------
// Property 15 (containment)
// ---------------------------------------------------------------------------

// Feature: tailwind-css-standardization, Property 15: Configuration changes are contained in the CSS-first source
function testConfigChangesAreContained() {
    fc.assert(
        fc.property(scenarioArb, (s) => {
            const tokens = s.tokens.map((t) => ({
                name: `--gen-${t.suffix}`,
                value: t.value,
                origin: 'property-test',
            }));
            const classes = s.classes.map((c) => ({
                name: `cmp-${c.suffix}`,
                declaration: `.cmp-${c.suffix} {\n    @apply ${c.utils.join(' ')};\n}`,
                origin: 'property-test',
            }));

            const before = outsideRegions(CONFIG_BASE);

            // Apply the two pure transforms in sequence (tokens, then classes).
            const tokenResult = writeTokens(CONFIG_BASE, tokens);
            const classResult = writeComponentClasses(tokenResult.cssText, classes);
            const result = classResult.cssText;

            // All provided entries are new -> all added, none reused.
            assert.strictEqual(tokenResult.added.length, tokens.length, 'every new token must be added');
            assert.strictEqual(tokenResult.reused.length, 0, 'no token should be reported as reused');
            assert.strictEqual(classResult.added.length, classes.length, 'every new class must be added');
            assert.strictEqual(classResult.reused.length, 0, 'no class should be reported as reused');

            const after = outsideRegions(result);

            // (1) Every new token name appears ONLY inside the @theme block.
            for (const token of tokens) {
                assertContainedWithin(
                    result,
                    token.name,
                    after.theme.contentStart,
                    after.theme.closeBrace,
                    'token containment'
                );
            }

            // (2) Every new component class selector appears ONLY inside the
            //     @layer components block.
            for (const cls of classes) {
                assertContainedWithin(
                    result,
                    `.${cls.name}`,
                    after.comp.contentStart,
                    after.comp.closeBrace,
                    'component-class containment'
                );
            }

            // (3) Regions outside the two blocks are byte-for-byte unchanged
            //     (nothing was written elsewhere; existing dark mechanism intact).
            assert.strictEqual(after.header, before.header, 'region before @theme must be unchanged');
            assert.strictEqual(after.middle, before.middle, 'region between the blocks must be unchanged');
            assert.strictEqual(after.trailer, before.trailer, 'region after @layer components must be unchanged');

            // (4) No alternative dark-mode mechanism is introduced, and the
            //     existing mechanism is preserved exactly.
            assert.ok(!/prefers-color-scheme/i.test(result), 'no prefers-color-scheme may be introduced');
            assert.ok(
                !/(^|[\s,>~+(])\.dark\b/.test(result),
                'no .dark class mechanism may be introduced'
            );
            assert.ok(!/@custom-variant\s+dark\b/.test(result), 'the dark variant must not be redefined');
            assert.strictEqual(
                allIndexes(result, '@variant dark').length,
                allIndexes(CONFIG_BASE, '@variant dark').length,
                'the existing @variant dark declaration must be preserved unchanged'
            );
            assert.strictEqual(
                allIndexes(result, '[data-theme="dark"]').length,
                allIndexes(CONFIG_BASE, '[data-theme="dark"]').length,
                'the existing [data-theme="dark"] usages must be preserved unchanged'
            );

            // Matching-brace integrity: the located blocks are still balanced.
            assert.strictEqual(
                matchingBraceEnd(result, after.theme.openBrace),
                after.theme.closeBrace,
                '@theme block must remain brace-balanced after the write'
            );
            assert.strictEqual(
                matchingBraceEnd(result, after.comp.openBrace),
                after.comp.closeBrace,
                '@layer components block must remain brace-balanced after the write'
            );
        }),
        { numRuns: 200 }
    );

    console.log('[config-writer.containment.property] Property 15: config-change containment OK');
}

// ---------------------------------------------------------------------------
// Property 15 (alternative dark mechanism rejection)
// ---------------------------------------------------------------------------

// A token value or component-class declaration that smuggles in a non-permitted
// dark mechanism. Each case targets exactly one transform.
const rejectionArb = fc.constantFrom(
    {
        kind: 'token-prefers',
        apply: () => writeTokens(CONFIG_BASE, [
            { name: '--gen-bad', value: 'prefers-color-scheme', origin: 'property-test' },
        ]),
    },
    {
        kind: 'class-prefers',
        apply: () => writeComponentClasses(CONFIG_BASE, [
            {
                name: 'cmp-bad',
                declaration: '.cmp-bad {\n    @media (prefers-color-scheme: dark) { color: #000; }\n}',
                origin: 'property-test',
            },
        ]),
    },
    {
        kind: 'class-dark-class',
        apply: () => writeComponentClasses(CONFIG_BASE, [
            {
                name: 'cmp-bad',
                declaration: '.cmp-bad {\n    color: #fff;\n}\n.dark .cmp-bad { color: #000; }',
                origin: 'property-test',
            },
        ]),
    },
    {
        kind: 'class-custom-variant',
        apply: () => writeComponentClasses(CONFIG_BASE, [
            {
                name: 'cmp-bad',
                declaration: '.cmp-bad {\n    @custom-variant dark (&:where(.theme-dark));\n    color: #fff;\n}',
                origin: 'property-test',
            },
        ]),
    }
);

// Feature: tailwind-css-standardization, Property 15: Configuration changes are contained in the CSS-first source
function testAlternativeDarkMechanismRejected() {
    fc.assert(
        fc.property(rejectionArb, (scenario) => {
            let threw = null;
            try {
                scenario.apply();
            } catch (err) {
                threw = err;
            }
            assert.ok(threw, `case '${scenario.kind}' must reject the alternative dark mechanism`);
            assert.ok(
                threw instanceof ConfigWriteError,
                `case '${scenario.kind}' must throw a ConfigWriteError, got ${threw && threw.name}`
            );
            assert.strictEqual(
                threw.code,
                'ALTERNATIVE_DARK_MECHANISM',
                `case '${scenario.kind}' must carry code ALTERNATIVE_DARK_MECHANISM`
            );
        }),
        { numRuns: 100 }
    );

    console.log('[config-writer.containment.property] Property 15: alternative dark mechanism rejection OK');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testConfigChangesAreContained();
    testAlternativeDarkMechanismRejected();
    console.log('[config-writer.containment.property] All config-writer containment property tests passed');
}

run();
