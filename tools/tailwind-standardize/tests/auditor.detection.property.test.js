'use strict';

/**
 * Property-based test for the Auditor (io/auditor.js) `audit` function.
 *
 * Mirrors the existing project convention (see scanner.property.test.js and the
 * other *.property.test.js files in this directory): plain Node built-in
 * `assert`, named test functions, and a `run()` driver that throws (non-zero
 * exit) on the first failed assertion. The only added dependency is
 * `fast-check` (already a dev dependency, v4).
 *
 * Unlike the pure-core tests, `audit()` reads files from disk, so every
 * generated document is materialized into a fresh temporary workspace under
 * `os.tmpdir()`, audited via an explicit file-path list, and then deleted.
 *
 * Property under test:
 *
 *   Property 1: Occurrence detection is complete, coverage-exact, and
 *   locator-accurate. The Auditor visits each file exactly once and, for every
 *   Arbitrary_Value, Physical_Direction_Utility, and Inline_Style present,
 *   records exactly one finding carrying an element locator (line + tag) that
 *   resolves back to the originating element.
 *
 * The generators embed a KNOWN number of arbitrary-value class tokens,
 * physical-direction class tokens, and inline-style attributes at KNOWN
 * lines/tags. To keep the per-category expected counts unambiguous, each
 * finding-bearing element is constructed so it CANNOT trigger the Auditor's
 * other finding categories:
 *   - Every class-bearing element carries a globally-unique, property-less
 *     marker utility (`mk<n>`) plus exactly one finding token, so no two
 *     elements ever share a utility set => zero duplicate-combination findings.
 *   - Each element bears at most one CSS-property-setting utility, so no two
 *     utilities ever target the same property => zero conflict-override
 *     findings.
 * Arbitrary tokens are chosen to NOT be physical-direction utilities (and vice
 * versa) so the two class categories never double-count the same token.
 *
 * "Visits each file exactly once" is exercised by occasionally passing the file
 * list with every path duplicated: the Auditor must de-duplicate so the counts
 * never double.
 *
 * **Validates: Requirements 1.1, 1.3, 1.4, 1.5**
 *
 * Run directly:  node tools/tailwind-standardize/tests/auditor.detection.property.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fc = require('fast-check');

const { audit } = require(path.join(__dirname, '..', 'io', 'auditor.js'));
const { FindingCategory } = require(path.join(__dirname, '..', 'core', 'models.js'));

// ---------------------------------------------------------------------------
// Value pools
// ---------------------------------------------------------------------------

// A mix of tags, including ones whose names are substrings of one another's
// attributes, to exercise the scanner's tag-name capture in the locator.
const TAG_ARB = fc.constantFrom('div', 'span', 'p', 'section', 'button', 'li', 'a', 'label');

// Arbitrary-value tokens (bracket-notation literals) that are NOT
// physical-direction utilities, so each yields exactly one arbitrary finding.
const ARBITRARY_TOKENS = [
    'mt-[16px]', 'mb-[2rem]', 'w-[100px]', 'h-[50px]',
    'p-[8px]', 'gap-[4px]', 'text-[14px]', 'bg-[#abcdef]',
];

// Physical-direction (inline-axis) utilities with a logical equivalent; none
// use bracket notation, so each yields exactly one physical finding (and zero
// arbitrary findings).
const PHYSICAL_TOKENS = [
    'pl-4', 'pr-2', 'ml-3', 'mr-1', 'left-0', 'right-5',
    'border-l-2', 'border-r-2', 'rounded-l-md', 'rounded-r-lg',
];

// Static inline-style declarations (no `${...}` interpolation needed; the
// Auditor records every inline style regardless of the dynamic flag).
const STYLE_DECLS = [
    'color:red', 'display:flex', 'margin:0',
    'padding:4px', 'font-weight:bold', 'text-align:center',
];

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const arbitraryItemArb = fc.record({
    kind: fc.constant('arbitrary'),
    tag: TAG_ARB,
    token: fc.constantFrom(...ARBITRARY_TOKENS),
    pad: fc.nat({ max: 2 }),
});

const physicalItemArb = fc.record({
    kind: fc.constant('physical'),
    tag: TAG_ARB,
    token: fc.constantFrom(...PHYSICAL_TOKENS),
    pad: fc.nat({ max: 2 }),
});

const inlineItemArb = fc.record({
    kind: fc.constant('inline'),
    tag: TAG_ARB,
    decl: fc.constantFrom(...STYLE_DECLS),
    pad: fc.nat({ max: 2 }),
});

const itemArb = fc.oneof(arbitraryItemArb, physicalItemArb, inlineItemArb);

// A file is a (possibly empty) sequence of finding-bearing elements; a document
// is a small set of such files plus a flag controlling path duplication.
const fileArb = fc.array(itemArb, { minLength: 0, maxLength: 5 });
const docArb = fc.record({
    files: fc.array(fileArb, { minLength: 1, maxLength: 3 }),
    duplicatePaths: fc.boolean(),
});

// ---------------------------------------------------------------------------
// Assembler — turn a generated file into text plus the exact set of findings
// (with known line/tag/category) the Auditor must report for it.
// ---------------------------------------------------------------------------

function assembleFile(items, counterRef, filePath) {
    const lines = [];
    const expected = []; // { filePath, line, tag, category, needle }

    for (const item of items) {
        for (let i = 0; i < item.pad; i += 1) {
            lines.push('filler line text without tags');
        }
        const lineNo = lines.length + 1; // 1-based line of the element start tag

        if (item.kind === 'inline') {
            lines.push(`<${item.tag} style="${item.decl}">`);
            expected.push({
                filePath,
                line: lineNo,
                tag: item.tag,
                category: FindingCategory.INLINE_STYLE,
                needle: item.decl,
            });
        } else {
            // Globally-unique, property-less marker keeps every utility set
            // distinct (no duplicate combinations) without adding a finding.
            const marker = `mk${counterRef.n}`;
            counterRef.n += 1;
            lines.push(`<${item.tag} class="${marker} ${item.token}">`);
            expected.push({
                filePath,
                line: lineNo,
                tag: item.tag,
                category:
                    item.kind === 'arbitrary'
                        ? FindingCategory.ARBITRARY_VALUE
                        : FindingCategory.PHYSICAL_DIRECTION,
                needle: item.token,
            });
        }
    }

    return { text: lines.join('\n'), expected };
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

// Feature: tailwind-css-standardization, Property 1: Occurrence detection is
// complete, coverage-exact, and locator-accurate
function testAuditDetectionCompleteness() {
    fc.assert(
        fc.property(docArb, ({ files, duplicatePaths }) => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-audit-'));
            try {
                const counterRef = { n: 0 };
                const filePaths = [];
                const linesByPath = new Map();
                let allExpected = [];

                files.forEach((items, idx) => {
                    const fp = path.join(dir, `page${idx}.html`);
                    const { text, expected } = assembleFile(items, counterRef, fp);
                    fs.writeFileSync(fp, text, 'utf8');
                    filePaths.push(fp);
                    linesByPath.set(fp, text.split('\n'));
                    allExpected = allExpected.concat(expected);
                });

                // Passing every path twice must NOT double the findings: the
                // Auditor visits each file exactly once (Req 1.1).
                const inputPaths = duplicatePaths ? filePaths.concat(filePaths) : filePaths;
                const record = audit(inputPaths, { baseDir: dir });

                // --- expected per-category counts embedded in the documents ---
                const expCounts = {
                    [FindingCategory.ARBITRARY_VALUE]: 0,
                    [FindingCategory.PHYSICAL_DIRECTION]: 0,
                    [FindingCategory.INLINE_STYLE]: 0,
                };
                for (const e of allExpected) {
                    expCounts[e.category] += 1;
                }

                // --- actual counts + flattened findings across all directories ---
                let arb = 0;
                let phys = 0;
                let inline = 0;
                let conflict = 0;
                let dup = 0;
                const allFindings = [];
                for (const group of Object.values(record.byDirectory)) {
                    arb += group.counts[FindingCategory.ARBITRARY_VALUE];
                    phys += group.counts[FindingCategory.PHYSICAL_DIRECTION];
                    inline += group.counts[FindingCategory.INLINE_STYLE];
                    conflict += group.counts[FindingCategory.CONFLICT_OVERRIDE];
                    dup += group.counts[FindingCategory.DUPLICATE_COMBINATION];
                    for (const f of group.findings) {
                        allFindings.push(f);
                    }
                }

                // By construction the documents create no conflicts/duplicates,
                // so the per-category expected counts are unambiguous.
                assert.strictEqual(conflict, 0, 'no conflict-override findings expected by construction');
                assert.strictEqual(dup, 0, 'no duplicate-combination findings expected by construction');

                // Coverage-exact: each embedded occurrence yields exactly one
                // finding of the matching category — no misses, no inventions.
                assert.strictEqual(arb, expCounts[FindingCategory.ARBITRARY_VALUE], 'arbitrary-value count');
                assert.strictEqual(phys, expCounts[FindingCategory.PHYSICAL_DIRECTION], 'physical-direction count');
                assert.strictEqual(inline, expCounts[FindingCategory.INLINE_STYLE], 'inline-style count');
                assert.strictEqual(record.totalFindings, arb + phys + inline, 'total findings == summed categories');
                assert.strictEqual(allFindings.length, allExpected.length, 'one finding per embedded occurrence');

                // --- locator accuracy: each finding resolves back to its element ---
                const expByKey = new Map();
                for (const e of allExpected) {
                    expByKey.set(`${e.filePath}#${e.line}`, e);
                }

                const seen = new Set();
                for (const f of allFindings) {
                    const key = `${f.locator.filePath}#${f.locator.line}`;
                    const e = expByKey.get(key);
                    assert.ok(e, `finding at ${key} must resolve to an embedded element`);
                    assert.strictEqual(f.category, e.category, `finding category at ${key}`);
                    assert.strictEqual(f.locator.tag, e.tag, `locator.tag at ${key}`);

                    // The reported source line really contains the originating
                    // element's start tag and the originating value.
                    const srcLines = linesByPath.get(f.locator.filePath);
                    assert.ok(srcLines, `source file tracked for ${f.locator.filePath}`);
                    const src = srcLines[f.locator.line - 1];
                    assert.ok(
                        typeof src === 'string' && src.indexOf(`<${e.tag}`) !== -1,
                        `reported line ${f.locator.line} must contain the <${e.tag} start tag`
                    );
                    assert.ok(
                        src.indexOf(e.needle) !== -1,
                        `reported line ${f.locator.line} must contain the originating value '${e.needle}'`
                    );

                    // Each element location yields exactly one finding.
                    assert.ok(!seen.has(key), `each element location yields exactly one finding (${key})`);
                    seen.add(key);
                }
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }),
        { numRuns: 150 }
    );

    console.log('[auditor.detection.property] audit detection completeness, coverage & locator accuracy OK');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testAuditDetectionCompleteness();
    console.log('[auditor.detection.property] All auditor detection property tests passed');
}

run();
