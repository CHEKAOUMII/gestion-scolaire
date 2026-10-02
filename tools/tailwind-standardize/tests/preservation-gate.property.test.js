'use strict';

/**
 * Property-based tests for the Output-Preservation Gate (pure core).
 *
 * Mirrors the existing project convention (see
 * tools/tailwind-standardize/tests/conflict-resolver.property.test.js and
 * arbitrary-resolver.property.test.js): plain Node built-in `assert`, named test
 * functions, and a `run()` driver that throws (non-zero exit) on the first
 * failed assertion. The only added dependency is `fast-check` (already a dev
 * dependency, v4).
 *
 * Run directly:
 *   node tools/tailwind-standardize/tests/preservation-gate.property.test.js
 *
 * _Requirements: 2.1, 2.3, 2.5, 4.4, 4.5, 6.5, 7.6, 9.4, 9.5_
 */

const assert = require('assert');
const path = require('path');
const fc = require('fast-check');

const { buildThemeIndex } = require(path.join(__dirname, '..', 'core', 'arbitrary-resolver.js'));
const { evaluateEdit } = require(path.join(__dirname, '..', 'core', 'preservation-gate.js'));

// ---------------------------------------------------------------------------
// Controlled theme fixture
//
// Only two tokens are needed to exercise the gate's value-resolution model:
//   - `--color-primary` backs `bg-primary` (so a literal<->token swap differs in
//     the dark context, where no dark-override data is supplied and the token
//     resolves to an opaque, theme-tagged symbol).
//   - `--radius-md` backs `rounded-md` (a second backed-token utility).
// No `darkTokenValues` are provided, so dark-theme token references resolve to a
// `dark-var:` symbol that can never equal a fixed literal.
// ---------------------------------------------------------------------------

const THEME_INDEX = buildThemeIndex({
    tokens: [
        { name: '--color-primary', value: '#3b6ac5' },
        { name: '--radius-md', value: '16px' },
    ],
});

// ---------------------------------------------------------------------------
// Atom pool — each base utility resolves to a DISTINCT CSS property, so a set of
// distinct atoms occupies one declaration bucket each. Combined with a distinct
// (breakpoint, state) prefix, every (atom, prefix) pair maps to a UNIQUE
// (property, context) bucket carrying a single value. This makes the oracle for
// "dropping one of them changes the declaration set" trivially sound.
//
// All atoms are theme-independent (arbitrary literals or fixed token refs) so
// output-preserving edits are genuinely preserving in BOTH themes.
// ---------------------------------------------------------------------------

const BASE_UTILS = Object.freeze([
    'mt-[1px]', // margin-top
    'mb-[2px]', // margin-bottom
    'ml-[3px]', // margin-left
    'mr-[4px]', // margin-right
    'pt-[5px]', // padding-top
    'w-[7px]', // width
    'h-[9px]', // height
    'top-[11px]', // top
    'rounded-md', // border-radius (backed by --radius-md)
]);

// Each prefix maps to a DISTINCT (breakpoint, state) context bucket, so the same
// base utility under two different prefixes never collides in a single bucket.
const PREFIXES = Object.freeze(['', 'sm:', 'md:', 'hover:', 'focus:', 'md:hover:']);

const atomArb = fc
    .record({ prefix: fc.constantFrom(...PREFIXES), util: fc.constantFrom(...BASE_UTILS) })
    .map(({ prefix, util }) => `${prefix}${util}`);

// A set of atoms with no repeated token string => no two share a (property,
// context) bucket (distinct properties OR distinct contexts).
const baseSetArb = fc.uniqueArray(atomArb, { minLength: 0, maxLength: 7 });
const baseSetNonEmptyArb = fc.uniqueArray(atomArb, { minLength: 1, maxLength: 7 });

const prefixArb = fc.constantFrom(...PREFIXES);

// ---------------------------------------------------------------------------
// Scenario generators — each yields { kind, before: string[], after: string[],
// approved: boolean }.
// ---------------------------------------------------------------------------

// (a) OUTPUT-PRESERVING: reorder a class list (same multiset of tokens).
const reorderArb = fc
    .array(atomArb, { minLength: 1, maxLength: 8 })
    .chain((items) =>
        fc.tuple(
            fc.constant(items),
            fc.array(fc.double({ noNaN: true }), { minLength: items.length, maxLength: items.length })
        )
    )
    .map(([items, keys]) => {
        const order = items.map((_unused, i) => i).sort((a, b) => keys[a] - keys[b]);
        const after = order.map((i) => items[i]);
        return { kind: 'reorder', before: items.slice(), after, approved: true };
    });

// (a) OUTPUT-PRESERVING: remove an EXACT duplicate token (the same raw appears
// twice before; one copy is removed). The value is still contributed by the
// surviving copy, so the declaration set is unchanged.
const exactDuplicateArb = baseSetNonEmptyArb.map((base) => ({
    kind: 'exact-duplicate',
    before: [...base, base[0]],
    after: base.slice(),
    approved: true,
}));

// (a) OUTPUT-PRESERVING: remove a VALUE-EQUAL duplicate utility. `pl-[16px]` and
// `pl-[1rem]` both normalize to the same computed value on the same property, so
// removing one leaves the declaration set unchanged. (`pl-` is intentionally NOT
// in BASE_UTILS, so the base set never contributes to padding-left.)
const valueEqualDuplicateArb = fc
    .record({ base: baseSetArb, prefix: prefixArb, which: fc.boolean() })
    .map(({ base, prefix, which }) => {
        const a = `${prefix}pl-[16px]`;
        const b = `${prefix}pl-[1rem]`;
        const before = [...base, a, b];
        const after = which ? [...base, a] : [...base, b];
        return { kind: 'value-equal-duplicate', before, after, approved: true };
    });

// (b) OUTPUT-CHANGING: drop a NON-duplicate utility. Every atom in the base set
// occupies a unique (property, context) bucket, so removing any one strictly
// shrinks the declaration set.
const dropArb = fc
    .record({ base: baseSetNonEmptyArb, idx: fc.nat() })
    .map(({ base, idx }) => {
        const removeAt = idx % base.length;
        const after = base.filter((_unused, i) => i !== removeAt);
        return { kind: 'drop-utility', before: base.slice(), after, approved: false };
    });

// (b) OUTPUT-CHANGING: change an arbitrary value (bg-[#010101] -> bg-[#020202]).
// Same property, same context, different value.
const valueChangeArb = fc
    .record({ base: baseSetArb, prefix: prefixArb })
    .map(({ base, prefix }) => ({
        kind: 'arbitrary-value-change',
        before: [...base, `${prefix}bg-[#010101]`],
        after: [...base, `${prefix}bg-[#020202]`],
        approved: false,
    }));

// (b) OUTPUT-CHANGING: add a utility that introduces a new property/value
// (`text-[#030303]` => color). The base set never contributes `color`.
const addUtilityArb = fc
    .record({ base: baseSetArb, prefix: prefixArb })
    .map(({ base, prefix }) => ({
        kind: 'add-utility',
        before: base.slice(),
        after: [...base, `${prefix}text-[#030303]`],
        approved: false,
    }));

// (b) OUTPUT-CHANGING: a literal<->token swap that differs in the DARK context.
// In light, `bg-[#3b6ac5]` and `bg-primary` resolve to the same literal; in dark,
// the token reference resolves to an opaque `dark-var:` symbol (no dark-override
// data), so the declaration sets differ in `[data-theme="dark"]`.
const darkSwapArb = fc
    .record({ base: baseSetArb, prefix: prefixArb })
    .map(({ base, prefix }) => ({
        kind: 'dark-divergent-swap',
        before: [...base, `${prefix}bg-[#3b6ac5]`],
        after: [...base, `${prefix}bg-primary`],
        approved: false,
    }));

const scenarioArb = fc.oneof(
    reorderArb,
    exactDuplicateArb,
    valueEqualDuplicateArb,
    dropArb,
    valueChangeArb,
    addUtilityArb,
    darkSwapArb
);

// ---------------------------------------------------------------------------
// Property 6
// ---------------------------------------------------------------------------

// Feature: tailwind-css-standardization, Property 6: Output-preservation safety gate
function testOutputPreservationGate() {
    fc.assert(
        fc.property(scenarioArb, (scenario) => {
            const result = evaluateEdit({
                beforeTokens: scenario.before.join(' '),
                afterTokens: scenario.after.join(' '),
                themeIndex: THEME_INDEX,
            });

            if (scenario.approved) {
                // An output-preserving edit MAY be approved — and these scenarios
                // are constructed to be provably preserving, so the gate must
                // approve them.
                assert.strictEqual(
                    result.approved,
                    true,
                    `expected APPROVE for preserving edit [${scenario.kind}]: ` +
                        `"${scenario.before.join(' ')}" -> "${scenario.after.join(' ')}" ` +
                        `(reason: ${result.reason || 'n/a'})`
                );
                assert.ok(
                    typeof result.contextsChecked === 'number' && result.contextsChecked > 0,
                    'an approval must report the number of contexts checked'
                );
                // An approved edit never asks to retain the original.
                assert.notStrictEqual(result.retainOriginal, true, 'approval must not set retainOriginal');
            } else {
                // An edit that changes the effective declaration set in ANY
                // checked context (either theme, any breakpoint/state) MUST be
                // rejected, and the original markup retained verbatim.
                assert.strictEqual(
                    result.approved,
                    false,
                    `expected REJECT for output-changing edit [${scenario.kind}]: ` +
                        `"${scenario.before.join(' ')}" -> "${scenario.after.join(' ')}"`
                );
                assert.strictEqual(
                    result.retainOriginal,
                    true,
                    'a rejected edit must retain the original markup (retainOriginal === true)'
                );
                assert.ok(
                    typeof result.reason === 'string' && result.reason.length > 0,
                    'a rejection must carry a human-readable reason'
                );
                assert.ok(result.reasonCategory, 'a rejection must carry a reason category');
                assert.ok(
                    result.context && typeof result.context.theme === 'string',
                    'a rejection must identify the context in which the output would change'
                );
            }
        }),
        { numRuns: 300 }
    );

    console.log('[preservation-gate.property] Property 6: output-preservation safety gate OK');
}

// A focused symmetry check: the gate is reflexive — an identity "edit" (no
// change at all) is always approved in every checked context.
// Feature: tailwind-css-standardization, Property 6: Output-preservation safety gate
function testIdentityIsAlwaysApproved() {
    fc.assert(
        fc.property(baseSetArb, (base) => {
            const classAttr = base.join(' ');
            const result = evaluateEdit({
                beforeTokens: classAttr,
                afterTokens: classAttr,
                themeIndex: THEME_INDEX,
            });
            assert.strictEqual(result.approved, true, `identity edit must be approved: "${classAttr}"`);
        }),
        { numRuns: 100 }
    );

    console.log('[preservation-gate.property] Property 6: identity edits are output-preserving OK');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testOutputPreservationGate();
    testIdentityIsAlwaysApproved();
    console.log('[preservation-gate.property] All preservation-gate property tests passed');
}

run();
