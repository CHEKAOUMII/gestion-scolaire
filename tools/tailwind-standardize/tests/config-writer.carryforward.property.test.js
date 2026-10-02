'use strict';

/**
 * Property-based test for the Config Writer's carry-forward re-expression
 * transform (io/config-writer.js, `reexpressCarryForward`).
 *
 * Mirrors the existing project convention (see
 * tools/tailwind-standardize/tests/component-synthesizer.property.test.js):
 * plain Node built-in `assert`, named test functions, a `run()` driver that
 * throws (non-zero exit) on the first failed assertion, and `fast-check` v4 as
 * the only added dependency. `reexpressCarryForward()` is a pure text transform
 * (no file-system access), so each synthetic CSS source is fed directly.
 *
 * Property under test (design Property 17):
 *
 *   For any Carry_Forward_CSS rule whose styling is duplicated by a Design_Token
 *   or Component_Layer entry, the tool re-expresses the rule as that
 *   token/component, removes the duplicated carry-forward rule, and records a
 *   changelog entry identifying the original rule and its replacement.
 *
 * Concretely, for a synthetic CSS source containing a mix of carry-forward
 * legacy rules (identifiable by selector) plus carry-forward specs (each with a
 * `ruleSelector` or `originalRule` and a `replacement { kind, name }`),
 * `reexpressCarryForward`:
 *   1. removes every targeted legacy rule from the returned `cssText`;
 *   2. produces exactly one record per spec identifying the original rule text
 *      and its replacement (kind + name); and
 *   3. leaves every non-targeted rule untouched in the returned `cssText`.
 *
 * **Validates: Requirements 10.6, 10.7**
 *
 * Run directly:
 *   node tools/tailwind-standardize/tests/config-writer.carryforward.property.test.js
 */

const assert = require('assert');
const path = require('path');
const fc = require('fast-check');

const { reexpressCarryForward } = require(
    path.join(__dirname, '..', 'io', 'config-writer.js')
);

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// Distinct legacy class-selector base names; each generated rule gets a unique
// index suffix so selectors never collide within a single source.
const SELECTOR_BANK = [
    'legacy-card', 'old-btn', 'panel-box', 'site-header', 'lf-badge',
    'note-tile', 'sidebar-old', 'foot-bar', 'modal-shell', 'list-row',
];

// Realistic declaration bodies for generated rules.
const BODY_BANK = [
    'color: #1d4ed8; padding: 8px;',
    'display: flex; gap: 4px;',
    'margin: 0; border: 1px solid #ccc;',
    'background: #fff; border-radius: 6px;',
    'font-size: 14px; line-height: 1.4;',
    'box-shadow: 0 1px 2px rgba(0,0,0,0.1);',
];

const replacementKindArb = fc.constantFrom('token', 'component');

// A single synthetic rule (without its unique index suffix yet).
const ruleEntryArb = fc.record({
    base: fc.constantFrom(...SELECTOR_BANK),
    body: fc.constantFrom(...BODY_BANK),
    targeted: fc.boolean(),
    locateByText: fc.boolean(),
    replacementKind: replacementKindArb,
    replacementName: fc.constantFrom(
        'color-primary', 'card', 'btn-primary', 'space-2', 'surface', 'radius-md'
    ),
});

// A scenario is a list of rule entries; each gets a unique index suffix so its
// selector never collides with another within the same source.
const scenarioArb = fc
    .array(ruleEntryArb, { minLength: 1, maxLength: 8 })
    .map((entries) =>
        entries.map((entry, index) => ({ ...entry, selector: `.${entry.base}-${index}` }))
    );

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render the full `selector {\n    body\n}` source text for a rule entry. */
function renderRule(entry) {
    return `${entry.selector} {\n    ${entry.body}\n}`;
}

/** Build the synthetic Config_Source plus the carry-forward spec list. */
function buildSource(entries) {
    // Note: no comment immediately precedes the first generated rule, so each
    // rule's parsed selector is exactly its class selector (the Config Writer's
    // top-level rule parser folds a leading comment into the next selector).
    const header = '@theme {\n    --color-primary: #1d4ed8;\n}\n\n' +
        '@layer components {\n    .card { @apply flex; }\n}\n\n';

    const blocks = entries.map(renderRule);
    const cssText = header + blocks.join('\n\n') + '\n';

    const carryForward = [];
    for (const entry of entries) {
        if (!entry.targeted) {
            continue;
        }
        const replacement = { kind: entry.replacementKind, name: entry.replacementName };
        if (entry.locateByText) {
            carryForward.push({ originalRule: renderRule(entry), replacement });
        } else {
            carryForward.push({ ruleSelector: entry.selector, replacement });
        }
    }
    return { cssText, carryForward };
}

// ---------------------------------------------------------------------------
// Property 17
// ---------------------------------------------------------------------------

// Feature: tailwind-css-standardization, Property 17: Carry-forward rules are re-expressed and recorded
function testCarryForwardReexpression() {
    fc.assert(
        fc.property(scenarioArb, (entries) => {
            const { cssText, carryForward } = buildSource(entries);

            const result = reexpressCarryForward(cssText, carryForward);

            const targeted = entries.filter((e) => e.targeted);
            const nonTargeted = entries.filter((e) => !e.targeted);

            // --- 2) One record per spec, identifying original rule + replacement. ---
            assert.strictEqual(
                result.records.length,
                carryForward.length,
                `expected one record per spec (${carryForward.length}), got ${result.records.length}`
            );

            for (let i = 0; i < carryForward.length; i += 1) {
                const spec = carryForward[i];
                const record = result.records[i];

                // Replacement metadata is carried through exactly.
                assert.strictEqual(
                    record.replacement.kind,
                    spec.replacement.kind,
                    'record must carry the replacement kind'
                );
                assert.strictEqual(
                    record.replacement.name,
                    spec.replacement.name,
                    'record must carry the replacement name'
                );

                // The original rule text is identified and corresponds to a
                // real targeted rule's source.
                assert.strictEqual(
                    typeof record.originalRule,
                    'string',
                    'record must identify the original rule text'
                );
                assert.ok(
                    record.originalRule.length > 0,
                    'recorded original rule text must be non-empty'
                );
                const matchesAnyTarget = targeted.some(
                    (e) => renderRule(e).trim() === record.originalRule
                );
                assert.ok(
                    matchesAnyTarget,
                    `recorded original rule must match a targeted rule: ${record.originalRule}`
                );
            }

            // --- 1) Every targeted legacy rule is REMOVED from the output. ---
            for (const entry of targeted) {
                assert.ok(
                    !result.cssText.includes(renderRule(entry)),
                    `targeted rule must be removed: ${entry.selector}`
                );
                // The selector header itself should no longer appear as a rule
                // opener (defensive: selectors are unique per index).
                assert.ok(
                    !result.cssText.includes(`${entry.selector} {`),
                    `targeted selector must no longer open a rule: ${entry.selector}`
                );
            }

            // --- 3) Non-targeted rules remain untouched in the output. ---
            for (const entry of nonTargeted) {
                assert.ok(
                    result.cssText.includes(renderRule(entry)),
                    `non-targeted rule must remain: ${entry.selector}`
                );
            }

            // The protected @theme / @layer scaffolding is always preserved.
            assert.ok(
                result.cssText.includes('@theme {'),
                '@theme block must be preserved'
            );
            assert.ok(
                result.cssText.includes('@layer components {'),
                '@layer components block must be preserved'
            );
        }),
        { numRuns: 200 }
    );

    console.log('[config-writer.carryforward.property] Property 17: carry-forward re-expression OK');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testCarryForwardReexpression();
    console.log('[config-writer.carryforward.property] All carry-forward property tests passed');
}

run();
