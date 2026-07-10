'use strict';

/**
 * Unit test for the Config Writer identifier-collision halt (Req 10.8).
 *
 * Mirrors the existing project convention (see tests/models.test.js and
 * tests/scope-resolver.halt.test.js): plain Node built-in `assert`, a set of
 * named test functions, and a `run()` driver that throws (non-zero exit) on the
 * first failed assertion. No external test framework is introduced.
 *
 * Exercises the pure text transforms only (`writeTokens`,
 * `writeComponentClasses`) so no file system is required:
 *
 *   - writeTokens: an existing `--color-primary` token whose value DIFFERS from
 *     a proposed one halts with a ConfigWriteError 'IDENTIFIER_COLLISION', and
 *     the input text is returned unmodified (the original value is preserved).
 *     Re-writing the SAME value is reuse, not a collision (no throw).
 *   - writeComponentClasses: an existing `.btn-primary` rule whose declaration
 *     DIFFERS halts with 'IDENTIFIER_COLLISION'; an identical declaration is
 *     reused without throwing.
 *
 * Run directly:  node tools/tailwind-standardize/tests/config-writer.collision.test.js
 *
 * _Requirements: 10.8_
 */

const assert = require('assert');
const path = require('path');

const configWriter = require(path.join(__dirname, '..', 'io', 'config-writer.js'));

const { writeTokens, writeComponentClasses, ConfigWriteError } = configWriter;

/** A Config_Source whose @theme block already defines --color-primary. */
function cssWithExistingToken() {
    return [
        '@theme {',
        '    --color-primary: #3b6ac5;',
        '    --spacing-md: 1rem;',
        '}',
        '',
    ].join('\n');
}

/** A Config_Source whose @layer components block already defines .btn-primary. */
function cssWithExistingComponent() {
    return [
        '@layer components {',
        '    .btn-primary {',
        '        @apply px-4 py-2;',
        '    }',
        '}',
        '',
    ].join('\n');
}

/** Assert that `fn` throws a ConfigWriteError whose code === 'IDENTIFIER_COLLISION'. */
function assertCollision(fn, description) {
    let thrown = null;
    try {
        fn();
    } catch (err) {
        thrown = err;
    }
    assert.ok(thrown, `${description}: expected an error to be thrown`);
    assert.ok(
        thrown instanceof ConfigWriteError,
        `${description}: error should be a ConfigWriteError (got ${thrown && thrown.name})`
    );
    assert.strictEqual(
        thrown.code,
        'IDENTIFIER_COLLISION',
        `${description}: error code should be IDENTIFIER_COLLISION`
    );
    return thrown;
}

// ---------------------------------------------------------------------------
// writeTokens — differing value halts, existing entry left unmodified
// ---------------------------------------------------------------------------

function testTokenCollisionHaltsAndPreservesExisting() {
    const original = cssWithExistingToken();

    const thrown = assertCollision(
        () =>
            writeTokens(original, [
                { name: '--color-primary', value: '#000000', origin: 'x' },
            ]),
        'writeTokens differing value'
    );

    // The collision detail should identify the colliding token + both values.
    assert.ok(thrown.detail, 'collision error should carry detail');
    assert.strictEqual(thrown.detail.identifier, '--color-primary', 'detail names the colliding token');
    assert.strictEqual(thrown.detail.existingValue, '#3b6ac5', 'detail reports the existing value');

    // The original text is untouched: the existing #3b6ac5 value remains and the
    // proposed #000000 value was never written.
    assert.ok(original.includes('--color-primary: #3b6ac5;'), 'existing entry remains unmodified');
    assert.ok(!original.includes('#000000'), 'proposed differing value is not written');

    console.log('[config-writer.collision.test] writeTokens differing value -> IDENTIFIER_COLLISION OK');
}

function testTokenSameValueIsReuseNotCollision() {
    const original = cssWithExistingToken();

    let result;
    assert.doesNotThrow(() => {
        result = writeTokens(original, [
            { name: '--color-primary', value: '#3b6ac5', origin: 'x' },
        ]);
    }, 'writing the identical token value should not throw');

    assert.strictEqual(result.added.length, 0, 'an identical token is not added again');
    assert.strictEqual(result.reused.length, 1, 'an identical token is reused');
    assert.strictEqual(result.reused[0].name, '--color-primary', 'the reused token is --color-primary');
    assert.strictEqual(result.cssText, original, 'reuse leaves the text unchanged');

    console.log('[config-writer.collision.test] writeTokens identical value -> reuse OK');
}

// ---------------------------------------------------------------------------
// writeComponentClasses — differing declaration halts; identical one is reused
// ---------------------------------------------------------------------------

function testComponentCollisionHaltsAndPreservesExisting() {
    const original = cssWithExistingComponent();

    const thrown = assertCollision(
        () =>
            writeComponentClasses(original, [
                {
                    name: 'btn-primary',
                    declaration: '.btn-primary { @apply px-8 py-4 rounded; }',
                    origin: 'x',
                },
            ]),
        'writeComponentClasses differing declaration'
    );

    assert.ok(thrown.detail, 'collision error should carry detail');
    assert.strictEqual(thrown.detail.identifier, 'btn-primary', 'detail names the colliding class');

    // The original text is untouched: the existing declaration remains and the
    // proposed differing utilities were never written.
    assert.ok(original.includes('@apply px-4 py-2;'), 'existing class declaration remains unmodified');
    assert.ok(!original.includes('px-8'), 'proposed differing declaration is not written');

    console.log(
        '[config-writer.collision.test] writeComponentClasses differing declaration -> IDENTIFIER_COLLISION OK'
    );
}

function testComponentIdenticalDeclarationIsReuse() {
    const original = cssWithExistingComponent();

    let result;
    assert.doesNotThrow(() => {
        // Same utilities (whitespace/order-insensitive signature) => reuse.
        result = writeComponentClasses(original, [
            {
                name: 'btn-primary',
                declaration: '.btn-primary {\n    @apply py-2 px-4;\n}',
                origin: 'x',
            },
        ]);
    }, 'writing an identical class declaration should not throw');

    assert.strictEqual(result.added.length, 0, 'an identical class is not added again');
    assert.strictEqual(result.reused.length, 1, 'an identical class is reused');
    assert.strictEqual(result.reused[0].name, 'btn-primary', 'the reused class is btn-primary');
    assert.strictEqual(result.cssText, original, 'reuse leaves the text unchanged');

    console.log('[config-writer.collision.test] writeComponentClasses identical declaration -> reuse OK');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testTokenCollisionHaltsAndPreservesExisting();
    testTokenSameValueIsReuseNotCollision();
    testComponentCollisionHaltsAndPreservesExisting();
    testComponentIdenticalDeclarationIsReuse();
    console.log('[config-writer.collision.test] All identifier-collision halt unit tests passed');
}

run();
