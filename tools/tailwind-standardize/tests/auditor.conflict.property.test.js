'use strict';

/**
 * Property-based test for the Auditor's conflict-finding detail (io/auditor.js).
 *
 * Mirrors the existing project convention (see
 * tools/tailwind-standardize/tests/conflict-resolver.property.test.js and
 * scanner.property.test.js): plain Node built-in `assert`, named test functions,
 * and a `run()` driver that throws (non-zero exit) on the first failed
 * assertion. The only added dependency is `fast-check` (already a dev
 * dependency, v4).
 *
 * Unlike the pure-core tests, `audit()` reads files from disk, so each generated
 * document is materialized into a throwaway file inside an OS temp directory,
 * audited, then cleaned up.
 *
 * Property under test:
 *
 *   Property 4: Conflict findings identify the conflicting utilities.
 *   For any `class` attribute containing two utilities that set the SAME CSS
 *   property under the SAME variant/breakpoint context, the Auditor records a
 *   CONFLICT_OVERRIDE finding at the element's locator whose detail names BOTH
 *   conflicting utilities and the CSS property. Utilities that set the same
 *   property under DIFFERENT contexts, or that set DIFFERENT properties, produce
 *   no conflict finding.
 *
 * **Validates: Requirements 1.7**
 *
 * Run directly:
 *   node tools/tailwind-standardize/tests/auditor.conflict.property.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fc = require('fast-check');

const { audit } = require(path.join(__dirname, '..', 'io', 'auditor.js'));
const { tokenize } = require(path.join(__dirname, '..', 'core', 'tokenizer.js'));
const { COMPOSABLE_PROPERTIES } = require(path.join(__dirname, '..', 'core', 'conflict-resolver.js'));
const { FindingCategory } = require(path.join(__dirname, '..', 'core', 'models.js'));

// ---------------------------------------------------------------------------
// Catalog — CSS properties whose utilities deterministically OVERRIDE one
// another (non-composable). Each property maps to two or more distinct bases so
// a same-context pair is a genuine conflict. A guard below confirms the
// tokenizer agrees, so the catalog can never silently drift from the
// implementation.
// ---------------------------------------------------------------------------

const PROP_GROUPS = Object.freeze({
    padding: ['p-2', 'p-4', 'p-8'],
    margin: ['m-1', 'm-2', 'm-4'],
    width: ['w-4', 'w-8', 'w-12'],
    'background-color': ['bg-red-500', 'bg-blue-500', 'bg-green-500'],
    'text-align': ['text-left', 'text-right', 'text-center'],
});

const PROPERTIES = Object.keys(PROP_GROUPS);

// Four prefixes, each mapping to a DISTINCT variant/breakpoint context:
//   '' -> base, 'md:'/'lg:' -> responsive, 'hover:' -> state.
const PREFIXES = ['', 'md:', 'lg:', 'hover:'];

/**
 * Guard: assert the tokenizer resolves every catalog base to the expected
 * non-composable CSS property, so the oracle is grounded in the implementation.
 */
function assertCatalogMatchesTokenizer() {
    for (const [property, bases] of Object.entries(PROP_GROUPS)) {
        for (const base of bases) {
            const [token] = tokenize(base);
            assert.strictEqual(
                token.property,
                property,
                `tokenizer property drift: "${base}" resolved to ${token.property}, expected ${property}`
            );
            assert.ok(
                !COMPOSABLE_PROPERTIES.has(property),
                `catalog property "${property}" must be non-composable to be a deterministic conflict`
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Generators — each element spec carries everything needed to (a) render its
// `<div class="...">` tag and (b) state the expectation for its locator.
// ---------------------------------------------------------------------------

const pairArb = fc.constantFrom(...PROPERTIES).chain((property) =>
    fc
        .uniqueArray(fc.constantFrom(...PROP_GROUPS[property]), { minLength: 2, maxLength: 2 })
        .map((bases) => ({ property, bases }))
);

// Conflict: two distinct same-property bases under the SAME context.
const conflictElementArb = fc
    .record({ pair: pairArb, prefix: fc.constantFrom(...PREFIXES) })
    .map(({ pair, prefix }) => {
        const rawA = prefix + pair.bases[0];
        const rawB = prefix + pair.bases[1];
        return {
            isConflict: true,
            classValue: `${rawA} ${rawB}`,
            property: pair.property,
            raws: [rawA, rawB],
        };
    });

// Control A: same property, but each utility under a DIFFERENT context.
const controlDiffContextArb = fc
    .record({
        property: fc.constantFrom(...PROPERTIES),
        prefixes: fc.uniqueArray(fc.constantFrom(...PREFIXES), { minLength: 2, maxLength: 2 }),
        baseA: fc.nat({ max: 2 }),
        baseB: fc.nat({ max: 2 }),
    })
    .map(({ property, prefixes, baseA, baseB }) => {
        const bases = PROP_GROUPS[property];
        const rawA = prefixes[0] + bases[baseA % bases.length];
        const rawB = prefixes[1] + bases[baseB % bases.length];
        return { isConflict: false, classValue: `${rawA} ${rawB}` };
    });

// Control B: same context, but two DIFFERENT properties.
const controlDiffPropertyArb = fc
    .record({
        props: fc.uniqueArray(fc.constantFrom(...PROPERTIES), { minLength: 2, maxLength: 2 }),
        prefix: fc.constantFrom(...PREFIXES),
        baseA: fc.nat({ max: 2 }),
        baseB: fc.nat({ max: 2 }),
    })
    .map(({ props, prefix, baseA, baseB }) => {
        const groupA = PROP_GROUPS[props[0]];
        const groupB = PROP_GROUPS[props[1]];
        const rawA = prefix + groupA[baseA % groupA.length];
        const rawB = prefix + groupB[baseB % groupB.length];
        return { isConflict: false, classValue: `${rawA} ${rawB}` };
    });

const elementArb = fc.oneof(conflictElementArb, controlDiffContextArb, controlDiffPropertyArb);

// A document always contains at least one element so every run exercises the
// audit. Each element is rendered on its own line so its locator line is known.
const docArb = fc.array(elementArb, { minLength: 1, maxLength: 10 });

// ---------------------------------------------------------------------------
// Assembler
// ---------------------------------------------------------------------------

function assemble(specs) {
    const lines = [];
    const elements = [];
    for (const spec of specs) {
        lines.push(`<div class="${spec.classValue}">x</div>`);
        elements.push({ ...spec, line: lines.length });
    }
    return { text: lines.join('\n'), elements };
}

/** Collect every CONFLICT_OVERRIDE finding from an AuditRecord, indexed by line. */
function conflictFindingsByLine(record) {
    const byLine = new Map();
    for (const group of Object.values(record.byDirectory)) {
        for (const finding of group.findings) {
            if (finding.category !== FindingCategory.CONFLICT_OVERRIDE) {
                continue;
            }
            const line = finding.locator.line;
            if (!byLine.has(line)) {
                byLine.set(line, []);
            }
            byLine.get(line).push(finding);
        }
    }
    return byLine;
}

// ---------------------------------------------------------------------------
// Property 4
// ---------------------------------------------------------------------------

// Feature: tailwind-css-standardization, Property 4: Conflict findings identify the conflicting utilities
function testConflictFindingDetail() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-audit-conflict-'));
    const filePath = path.join(tmpDir, 'page.html');

    try {
        fc.assert(
            fc.property(docArb, (specs) => {
                const { text, elements } = assemble(specs);
                fs.writeFileSync(filePath, text, 'utf8');

                const record = audit([filePath], { baseDir: tmpDir });
                const byLine = conflictFindingsByLine(record);

                for (const el of elements) {
                    const findings = byLine.get(el.line) || [];

                    if (el.isConflict) {
                        // A CONFLICT_OVERRIDE finding must exist at this locator and
                        // its detail must name BOTH conflicting utilities and the
                        // CSS property (Req 1.7).
                        const match = findings.find(
                            (f) =>
                                f.detail.includes(el.property) &&
                                f.detail.includes(el.raws[0]) &&
                                f.detail.includes(el.raws[1])
                        );
                        assert.ok(
                            match,
                            `expected a conflict finding at line ${el.line} naming ` +
                                `'${el.property}' and [${el.raws.join(', ')}] for ` +
                                `class="${el.classValue}"; got ${JSON.stringify(findings.map((f) => f.detail))}`
                        );
                    } else {
                        // Different-context or different-property utilities never
                        // conflict (Req 6.2), so no conflict finding may appear.
                        assert.strictEqual(
                            findings.length,
                            0,
                            `expected no conflict finding at line ${el.line} for control ` +
                                `class="${el.classValue}"; got ${JSON.stringify(findings.map((f) => f.detail))}`
                        );
                    }
                }
            }),
            { numRuns: 150 }
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    console.log('[auditor.conflict.property] Property 4: conflict findings identify the conflicting utilities OK');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    assertCatalogMatchesTokenizer();
    testConflictFindingDetail();
    console.log('[auditor.conflict.property] All auditor conflict property tests passed');
}

run();
