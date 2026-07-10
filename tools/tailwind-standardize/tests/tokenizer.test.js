'use strict';

/**
 * Unit tests for the Tailwind CSS Standardization Class Tokenizer.
 *
 * Mirrors the existing project convention (see tests/models.test.js): plain
 * Node built-in `assert`, a set of named test functions, and a `run()` driver
 * that throws (non-zero exit) on the first failed assertion. No external test
 * framework is introduced.
 *
 * The central guarantee under test is the token-level round trip:
 *   serialize(tokenize(x)) preserves every token's `raw` string exactly, so
 *   downstream reorders/transforms can rearrange tokens without ever altering
 *   a token's text. `tokenize` collapses inter-token whitespace to single
 *   spaces, so for already single-space-separated input the round trip is the
 *   identity; for empty/whitespace-only input it yields [] / "".
 *
 * Run directly:  node tools/tailwind-standardize/tests/tokenizer.test.js
 *
 * _Requirements: 5.3_
 */

const assert = require('assert');
const path = require('path');

const tokenizer = require(path.join(__dirname, '..', 'core', 'tokenizer.js'));

const { tokenize, serialize, Category } = tokenizer;

/**
 * Assert that `serialize(tokenize(input))` reproduces `expected`, and that the
 * concatenation of every parsed token's `raw` field (single-space joined)
 * matches as well — i.e. each token's text is preserved verbatim.
 */
function assertRoundTrip(input, expected, description) {
    const tokens = tokenize(input);
    const serialized = serialize(tokens);
    assert.strictEqual(serialized, expected, `${description}: serialize(tokenize(x)) round trip`);

    // Each token's raw text must be preserved byte-for-byte (no rewriting).
    const rebuilt = tokens.map((t) => t.raw).join(' ');
    assert.strictEqual(rebuilt, expected, `${description}: token raw strings preserved verbatim`);
}

// ---------------------------------------------------------------------------
// Empty / whitespace-only attributes => [] / ""
// ---------------------------------------------------------------------------

function testEmptyAndWhitespace() {
    // Empty string yields no tokens and serializes back to "".
    assert.deepStrictEqual(tokenize(''), [], 'empty string yields no tokens');
    assert.strictEqual(serialize(tokenize('')), '', 'empty string round trips to ""');

    // Whitespace-only (spaces, tabs, newlines) yields no tokens and "".
    const whitespaceInputs = ['   ', '\t', '\n', ' \t\n  '];
    for (const ws of whitespaceInputs) {
        assert.deepStrictEqual(tokenize(ws), [], `whitespace-only ${JSON.stringify(ws)} yields no tokens`);
        assert.strictEqual(serialize(tokenize(ws)), '', `whitespace-only ${JSON.stringify(ws)} round trips to ""`);
    }

    // Surrounding/interior whitespace is collapsed to single spaces on round trip.
    assertRoundTrip('  flex   gap-2  ', 'flex gap-2', 'irregular whitespace collapses');

    console.log('[tokenizer.test] empty/whitespace attributes -> [] / "" OK');
}

// ---------------------------------------------------------------------------
// Round trip across representative token shapes
// ---------------------------------------------------------------------------

function testRoundTripShapes() {
    // Multi-variant tokens.
    assertRoundTrip('md:hover:bg-primary', 'md:hover:bg-primary', 'multi-variant token');
    assertRoundTrip(
        'sm:focus:text-center lg:hover:flex',
        'sm:focus:text-center lg:hover:flex',
        'multiple multi-variant tokens'
    );

    // Arbitrary-value tokens.
    assertRoundTrip('mt-[16px]', 'mt-[16px]', 'arbitrary length value');
    assertRoundTrip('bg-[#3b6ac5]', 'bg-[#3b6ac5]', 'arbitrary hex color value');
    assertRoundTrip('grid-cols-[1fr_2fr]', 'grid-cols-[1fr_2fr]', 'arbitrary grid template with underscore');

    // Negative, logical-property, and colon-in-brackets tokens.
    assertRoundTrip('-ml-2', '-ml-2', 'negative utility');
    assertRoundTrip('ps-4', 'ps-4', 'logical-property utility');
    assertRoundTrip('[&:hover]:flex', '[&:hover]:flex', 'colon-in-brackets variant');

    // A mixed, realistic attribute exercising several shapes at once.
    assertRoundTrip(
        '-ml-2 md:hover:bg-primary mt-[16px] [&:hover]:flex ps-4 bg-[#3b6ac5]',
        '-ml-2 md:hover:bg-primary mt-[16px] [&:hover]:flex ps-4 bg-[#3b6ac5]',
        'mixed realistic attribute'
    );

    console.log('[tokenizer.test] round trip across token shapes OK');
}

// ---------------------------------------------------------------------------
// Parsed field correctness for representative tokens
// ---------------------------------------------------------------------------

/** Fetch the single token produced from a one-token attribute string. */
function only(input) {
    const tokens = tokenize(input);
    assert.strictEqual(tokens.length, 1, `expected exactly one token for ${JSON.stringify(input)}`);
    return tokens[0];
}

function testMultiVariantFields() {
    const t = only('md:hover:bg-primary');
    assert.strictEqual(t.raw, 'md:hover:bg-primary', 'raw preserved');
    assert.deepStrictEqual(t.variants, ['md', 'hover'], 'variants in order');
    assert.strictEqual(t.responsiveVariant, 'md', 'responsive variant detected');
    assert.strictEqual(t.stateVariant, 'hover', 'state variant detected');
    assert.strictEqual(t.base, 'bg-primary', 'base is the trailing utility');
    assert.strictEqual(t.isArbitrary, false, 'not arbitrary');
    assert.strictEqual(t.arbitraryValue, null, 'no arbitrary value');
    assert.strictEqual(t.category, Category.COLORS, 'bg- resolves to colors');

    console.log('[tokenizer.test] multi-variant token fields OK');
}

function testArbitraryFields() {
    const len = only('mt-[16px]');
    assert.deepStrictEqual(len.variants, [], 'no variants');
    assert.strictEqual(len.responsiveVariant, null, 'no responsive variant');
    assert.strictEqual(len.stateVariant, null, 'no state variant');
    assert.strictEqual(len.base, 'mt-[16px]', 'base retains bracket literal');
    assert.strictEqual(len.isArbitrary, true, 'flagged arbitrary');
    assert.strictEqual(len.arbitraryValue, '16px', 'arbitrary literal extracted');
    assert.strictEqual(len.category, Category.SPACING, 'mt- resolves to spacing');

    const color = only('bg-[#3b6ac5]');
    assert.strictEqual(color.isArbitrary, true, 'hex color flagged arbitrary');
    assert.strictEqual(color.arbitraryValue, '#3b6ac5', 'hex literal extracted including #');
    assert.strictEqual(color.category, Category.COLORS, 'bg- resolves to colors');

    const grid = only('grid-cols-[1fr_2fr]');
    assert.strictEqual(grid.isArbitrary, true, 'grid template flagged arbitrary');
    assert.strictEqual(grid.arbitraryValue, '1fr_2fr', 'underscore-joined literal extracted');
    assert.strictEqual(grid.category, Category.LAYOUT, 'grid-cols- resolves to layout');

    console.log('[tokenizer.test] arbitrary-value token fields OK');
}

function testNegativeLogicalAndBracketColonFields() {
    const neg = only('-ml-2');
    assert.strictEqual(neg.base, '-ml-2', 'negative base preserved');
    assert.strictEqual(neg.isArbitrary, false, 'negative utility not arbitrary');
    assert.strictEqual(neg.category, Category.SPACING, 'negative margin resolves via ml-');

    const logical = only('ps-4');
    assert.strictEqual(logical.base, 'ps-4', 'logical-property base preserved');
    assert.strictEqual(logical.category, Category.SPACING, 'ps- resolves to spacing');

    // A ':' inside brackets must NOT be treated as a variant separator.
    const bracketColon = only('[&:hover]:flex');
    assert.deepStrictEqual(bracketColon.variants, ['[&:hover]'], 'bracketed selector kept as a single variant');
    assert.strictEqual(bracketColon.responsiveVariant, null, 'arbitrary variant is not responsive');
    assert.strictEqual(bracketColon.stateVariant, null, 'arbitrary variant is not a known state');
    assert.strictEqual(bracketColon.base, 'flex', 'base is the trailing utility after the bracketed variant');
    assert.strictEqual(bracketColon.isArbitrary, false, 'base "flex" has no bracket literal');
    assert.strictEqual(bracketColon.category, Category.LAYOUT, 'flex (display) resolves to layout');

    console.log('[tokenizer.test] negative/logical/bracket-colon token fields OK');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testEmptyAndWhitespace();
    testRoundTripShapes();
    testMultiVariantFields();
    testArbitraryFields();
    testNegativeLogicalAndBracketColonFields();
    console.log('[tokenizer.test] All tokenizer unit tests passed');
}

run();
