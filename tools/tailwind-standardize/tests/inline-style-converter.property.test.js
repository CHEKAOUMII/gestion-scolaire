'use strict';

/**
 * Property-based tests for the Inline-Style Converter (pure core).
 *
 * Mirrors the existing project convention (see
 * tools/tailwind-standardize/tests/conflict-resolver.property.test.js): plain
 * Node built-in `assert`, named test functions, and a `run()` driver that throws
 * (non-zero exit) on the first failed assertion. The only added dependency is
 * `fast-check` (already a dev dependency, v4).
 *
 * Run directly:
 *   node tools/tailwind-standardize/tests/inline-style-converter.property.test.js
 *
 * _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
 */

const assert = require('assert');
const path = require('path');
const fc = require('fast-check');

const {
    convertInlineStyle,
    Reason,
} = require(path.join(__dirname, '..', 'core', 'inline-style-converter.js'));
const {
    buildThemeIndex,
} = require(path.join(__dirname, '..', 'core', 'arbitrary-resolver.js'));

// ---------------------------------------------------------------------------
// Declaration catalogs.
//
// CONVERTIBLE: static `property: value` declarations that the default theme
// index can express with an existing utility / Design_Token / spacing-scale
// entry with identical computed rendering (Req 7.1, 7.6). Each is independently
// verified below so the oracle can never silently drift from the implementation
// (every single-declaration CONVERTIBLE style must yield action 'convert').
//
// INEXPRESSIBLE: static declarations whose property has no known utility mapping
// (neither a keyword utility nor a value-mapped utility), so any occurrence that
// contains one must be excluded as 'not-expressible' (Req 7.3).
// ---------------------------------------------------------------------------

const CONVERTIBLE = Object.freeze([
    { property: 'display', value: 'flex' },
    { property: 'display', value: 'block' },
    { property: 'position', value: 'absolute' },
    { property: 'text-align', value: 'center' },
    { property: 'justify-content', value: 'center' },
    { property: 'align-items', value: 'center' },
    { property: 'font-weight', value: 'bold' },
    { property: 'font-style', value: 'italic' },
    { property: 'margin', value: '0' },
    { property: 'padding', value: '16px' },
    { property: 'margin-top', value: '8px' },
    { property: 'gap', value: '1rem' },
    { property: 'background-color', value: '#3b6ac5' },
    { property: 'color', value: '#111111' },
    { property: 'border-color', value: '#ffffff' },
    { property: 'border-radius', value: '8px' },
]);

const INEXPRESSIBLE = Object.freeze([
    { property: 'background-image', value: 'url(a.png)' },
    { property: 'cursor', value: 'pointer' },
    { property: 'float', value: 'left' },
    { property: 'z-index', value: '10' },
    { property: 'content', value: 'x' },
    { property: 'list-style', value: 'none' },
    { property: 'white-space', value: 'nowrap' },
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Serialize a list of `{ property, value }` declarations into a style string. */
function toStyleText(declarations) {
    return declarations.map((d) => `${d.property}: ${d.value}`).join('; ');
}

/** A ClassToken-shaped value (only the contract this test relies on). */
function isClassToken(token) {
    return token && typeof token === 'object' && typeof token.raw === 'string';
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// (a) Static, fully expressible occurrences -> expect 'convert'.
const convertibleOccArb = fc
    .subarray(CONVERTIBLE.slice(), { minLength: 1 })
    .map((decls) => ({
        kind: 'convert',
        occurrence: { value: toStyleText(decls), dynamic: false },
        declCount: decls.length,
    }));

// (b) Dynamic occurrences -> expect 'exclude' with reason 'dynamic-inline-style'.
//     Two independent ways an occurrence is dynamic: the scanner's `dynamic`
//     flag, or a `${...}` template interpolation surfacing in the value itself.
const dynamicOccArb = fc.oneof(
    // dynamic flag set (value may even be otherwise convertible — flag wins).
    fc
        .subarray(CONVERTIBLE.slice(), { minLength: 1 })
        .map((decls) => ({
            kind: 'exclude-dynamic',
            occurrence: { value: toStyleText(decls), dynamic: true },
        })),
    // template interpolation in the value (dynamic flag deliberately false).
    fc
        .record({
            prop: fc.constantFrom('color', 'width', 'background-color', 'margin'),
            varName: fc.constantFrom('color', 'w', 'theme.bg', 'size'),
        })
        .map(({ prop, varName }) => ({
            kind: 'exclude-dynamic',
            occurrence: { value: `${prop}: \${${varName}}`, dynamic: false },
        }))
);

// (c) Static but inexpressible occurrences -> expect 'exclude' with reason
//     'not-expressible'. At least one inexpressible declaration is present;
//     it may be mixed with otherwise-convertible declarations (the whole
//     occurrence is still excluded so styling is never partially dropped).
const inexpressibleOccArb = fc
    .record({
        bad: fc.subarray(INEXPRESSIBLE.slice(), { minLength: 1 }),
        good: fc.subarray(CONVERTIBLE.slice(), { minLength: 0 }),
    })
    .map(({ bad, good }) => {
        // Interleave so the inexpressible declaration is not always last.
        const decls = good.concat(bad);
        return {
            kind: 'exclude-not-expressible',
            occurrence: { value: toStyleText(decls), dynamic: false },
        };
    });

const caseArb = fc.oneof(convertibleOccArb, dynamicOccArb, inexpressibleOccArb);

// ---------------------------------------------------------------------------
// Self-check: every single CONVERTIBLE declaration must convert on its own.
// Guards the oracle against drift from the converter's mapping tables.
// ---------------------------------------------------------------------------

function assertCatalogConvertible(themeIndex) {
    for (const decl of CONVERTIBLE) {
        const result = convertInlineStyle(
            { value: toStyleText([decl]), dynamic: false },
            themeIndex
        );
        assert.strictEqual(
            result.action,
            'convert',
            `CONVERTIBLE catalog entry "${decl.property}: ${decl.value}" must convert`
        );
    }
    for (const decl of INEXPRESSIBLE) {
        const result = convertInlineStyle(
            { value: toStyleText([decl]), dynamic: false },
            themeIndex
        );
        assert.strictEqual(
            result.action,
            'exclude',
            `INEXPRESSIBLE catalog entry "${decl.property}: ${decl.value}" must be excluded`
        );
        assert.strictEqual(result.reason, Reason.NOT_EXPRESSIBLE);
    }
}

// ---------------------------------------------------------------------------
// Property 13
// ---------------------------------------------------------------------------

// Feature: tailwind-css-standardization, Property 13: Inline-style elimination invariants hold
function testInlineStyleElimination() {
    const themeIndex = buildThemeIndex();
    assertCatalogConvertible(themeIndex);

    fc.assert(
        fc.property(caseArb, (testCase) => {
            const result = convertInlineStyle(testCase.occurrence, themeIndex);

            // Result is always one of the two deterministic actions.
            assert.ok(
                result.action === 'convert' || result.action === 'exclude',
                `action must be convert|exclude, got "${result.action}"`
            );

            if (testCase.kind === 'convert') {
                // (Req 7.1, 7.6) Static expressible style -> convert with utilities.
                assert.strictEqual(result.action, 'convert', 'expressible style must convert');
                assert.ok(Array.isArray(result.utilities), 'convert must carry utilities array');
                assert.ok(result.utilities.length > 0, 'convert must yield at least one utility');
                assert.strictEqual(
                    result.utilities.length,
                    testCase.declCount,
                    'each expressible declaration must yield one utility'
                );
                assert.ok(
                    result.utilities.every(isClassToken),
                    'utilities must be ClassToken records'
                );
                // A converted occurrence yields utilities and NO reason.
                assert.strictEqual(result.reason, undefined, 'convert must not carry a reason');
            } else if (testCase.kind === 'exclude-dynamic') {
                // (Req 7.2) Dynamic / JS-set style -> excluded, reason 'dynamic-inline-style'.
                assert.strictEqual(result.action, 'exclude', 'dynamic style must be excluded');
                assert.strictEqual(
                    result.reason,
                    Reason.DYNAMIC,
                    'dynamic exclusion must use the dynamic-inline-style reason'
                );
                assert.strictEqual(result.utilities, undefined, 'excluded must not carry utilities');
            } else {
                // (Req 7.3) Static inexpressible style -> excluded, reason 'not-expressible'.
                assert.strictEqual(result.action, 'exclude', 'inexpressible style must be excluded');
                assert.strictEqual(
                    result.reason,
                    Reason.NOT_EXPRESSIBLE,
                    'inexpressible exclusion must use the not-expressible reason'
                );
                assert.strictEqual(result.utilities, undefined, 'excluded must not carry utilities');
            }

            // (Req 7.4, 7.5) Per-occurrence invariant: exactly one of
            // {utilities present + no reason} XOR {reason present + no utilities}.
            const converted = result.action === 'convert';
            assert.strictEqual(
                converted,
                result.utilities !== undefined,
                'utilities are present iff the occurrence converted'
            );
            assert.strictEqual(
                !converted,
                typeof result.reason === 'string',
                'a reason is recorded iff the occurrence was excluded'
            );
        }),
        { numRuns: 300 }
    );

    console.log('[inline-style-converter.property] Property 13: inline-style elimination invariants OK');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testInlineStyleElimination();
    console.log('[inline-style-converter.property] All inline-style-converter property tests passed');
}

run();
