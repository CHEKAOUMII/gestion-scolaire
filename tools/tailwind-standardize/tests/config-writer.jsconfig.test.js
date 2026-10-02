'use strict';

/**
 * Unit test for the Config Writer JS-based Tailwind config rejection
 * (Property 16, Req 10.4).
 *
 * Mirrors the existing project convention (see tests/scope-resolver.halt.test.js):
 * plain Node built-in `assert`, a set of named test functions, and a `run()`
 * driver that throws (non-zero exit) on the first failed assertion. No external
 * test framework is introduced.
 *
 * Property 16: JavaScript-based Tailwind configuration is rejected. When a
 * `tailwind.config.js` (or `.ts/.cjs/.mjs`) is detected, the tool halts the
 * configuration change, produces a `JS_CONFIG_DETECTED` error, and leaves the
 * Config_Source (`css/tailwind-input.css`) byte-for-byte unmodified.
 *
 * Run directly:
 *   node tools/tailwind-standardize/tests/config-writer.jsconfig.test.js
 *
 * _Requirements: 10.4_
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const configWriter = require(path.join(__dirname, '..', 'io', 'config-writer.js'));

const { applyConfigChanges, detectJsConfig, ConfigWriteError, JS_CONFIG_FILENAMES } = configWriter;

/**
 * A representative CSS-first Config_Source with both the `@theme` and the
 * `@layer components` blocks the writer targets.
 */
const SAMPLE_CONFIG_SOURCE = [
    '@import "tailwindcss";',
    '',
    '@theme {',
    '    --color-primary: #2563eb;',
    '}',
    '',
    '@layer components {',
    '    .btn-primary {',
    '        @apply bg-primary text-white;',
    '    }',
    '}',
    '',
].join('\n');

/**
 * Create a temporary workspace under os.tmpdir() containing
 * css/tailwind-input.css and (optionally) a JS-based Tailwind config file.
 *
 * @param {string|null} jsConfigName filename to create at the root (e.g.
 *   'tailwind.config.js'), or null to omit any JS config.
 * @returns {string} absolute path to the temp workspace root
 */
function createWorkspace(jsConfigName) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-config-js-'));

    fs.mkdirSync(path.join(root, 'css'), { recursive: true });
    fs.writeFileSync(path.join(root, 'css', 'tailwind-input.css'), SAMPLE_CONFIG_SOURCE, 'utf8');

    if (jsConfigName) {
        fs.writeFileSync(
            path.join(root, jsConfigName),
            'module.exports = { content: ["./**/*.html"] };\n',
            'utf8'
        );
    }

    return root;
}

/** Remove the temp workspace tree (best-effort). */
function cleanup(root) {
    try {
        fs.rmSync(root, { recursive: true, force: true });
    } catch (err) {
        // Best-effort cleanup; do not fail the test over a leftover temp dir.
    }
}

/** Sample changes that WOULD modify the Config_Source if not halted. */
const SAMPLE_CHANGES = {
    tokens: [{ name: '--color-accent', value: '#f59e0b', origin: 'test' }],
};

// ---------------------------------------------------------------------------
// applyConfigChanges halts with JS_CONFIG_DETECTED and leaves the source intact
// ---------------------------------------------------------------------------

function testApplyConfigChangesRejectsJsConfig() {
    const root = createWorkspace('tailwind.config.js');
    const configSourcePath = path.join(root, 'css', 'tailwind-input.css');
    try {
        // Capture the exact bytes of the Config_Source before the attempt.
        const before = fs.readFileSync(configSourcePath);

        let thrown = null;
        try {
            applyConfigChanges(root, SAMPLE_CHANGES);
        } catch (err) {
            thrown = err;
        }

        assert.ok(thrown, 'applyConfigChanges should throw when a JS-based Tailwind config is present');
        assert.ok(
            thrown instanceof ConfigWriteError,
            'thrown error should be a ConfigWriteError'
        );
        assert.strictEqual(
            thrown.code,
            'JS_CONFIG_DETECTED',
            'error code should be JS_CONFIG_DETECTED'
        );
        assert.ok(
            /JavaScript-based Tailwind configuration|JS-based configuration is not permitted/i.test(
                thrown.message
            ),
            'error message should indicate JS-based config is not permitted'
        );

        // The Config_Source must be byte-for-byte unchanged.
        const after = fs.readFileSync(configSourcePath);
        assert.ok(
            before.equals(after),
            'css/tailwind-input.css must be byte-for-byte unchanged after a halted change'
        );

        console.log('[config-writer.jsconfig.test] applyConfigChanges -> JS_CONFIG_DETECTED, source unchanged OK');
    } finally {
        cleanup(root);
    }
}

// ---------------------------------------------------------------------------
// Each recognized JS config extension triggers the halt
// ---------------------------------------------------------------------------

function testAllJsConfigExtensionsRejected() {
    for (const filename of JS_CONFIG_FILENAMES) {
        const root = createWorkspace(filename);
        const configSourcePath = path.join(root, 'css', 'tailwind-input.css');
        try {
            const before = fs.readFileSync(configSourcePath);

            let thrown = null;
            try {
                applyConfigChanges(root, SAMPLE_CHANGES);
            } catch (err) {
                thrown = err;
            }

            assert.ok(thrown, `applyConfigChanges should throw for '${filename}'`);
            assert.strictEqual(
                thrown.code,
                'JS_CONFIG_DETECTED',
                `error code should be JS_CONFIG_DETECTED for '${filename}'`
            );

            const after = fs.readFileSync(configSourcePath);
            assert.ok(
                before.equals(after),
                `css/tailwind-input.css must be unchanged for '${filename}'`
            );
        } finally {
            cleanup(root);
        }
    }
    console.log('[config-writer.jsconfig.test] all JS config extensions rejected OK');
}

// ---------------------------------------------------------------------------
// detectJsConfig returns the path when present and null when absent
// ---------------------------------------------------------------------------

function testDetectJsConfigReturnsPathWhenPresent() {
    const root = createWorkspace('tailwind.config.js');
    try {
        const detected = detectJsConfig(root);
        assert.strictEqual(
            typeof detected,
            'string',
            'detectJsConfig should return a string path when a JS config is present'
        );
        assert.strictEqual(
            path.basename(detected),
            'tailwind.config.js',
            'detectJsConfig should return the path to the detected JS config'
        );
        assert.strictEqual(
            path.resolve(detected),
            path.resolve(root, 'tailwind.config.js'),
            'detected path should resolve to the workspace JS config'
        );

        console.log('[config-writer.jsconfig.test] detectJsConfig -> path when present OK');
    } finally {
        cleanup(root);
    }
}

function testDetectJsConfigReturnsNullWhenAbsent() {
    const root = createWorkspace(null);
    try {
        const detected = detectJsConfig(root);
        assert.strictEqual(
            detected,
            null,
            'detectJsConfig should return null when no JS-based Tailwind config exists'
        );

        // Sanity: with no JS config, applyConfigChanges should NOT halt for 10.4.
        const result = applyConfigChanges(root, SAMPLE_CHANGES);
        assert.ok(result.written, 'applyConfigChanges should proceed and write when no JS config is present');

        console.log('[config-writer.jsconfig.test] detectJsConfig -> null when absent OK');
    } finally {
        cleanup(root);
    }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testApplyConfigChangesRejectsJsConfig();
    testAllJsConfigExtensionsRejected();
    testDetectJsConfigReturnsPathWhenPresent();
    testDetectJsConfigReturnsNullWhenAbsent();
    console.log('[config-writer.jsconfig.test] All JS-config rejection unit tests passed');
}

run();
