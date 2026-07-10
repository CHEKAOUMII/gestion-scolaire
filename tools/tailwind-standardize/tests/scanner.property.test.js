'use strict';

/**
 * Property-based test for the HTML Scanner (core/scanner.js).
 *
 * Mirrors the existing project convention (see tools/tailwind-standardize/tests/
 * tokenizer.test.js and scope-resolver.property.test.js): plain Node built-in
 * `assert`, named test functions, and a `run()` driver that throws (non-zero
 * exit) on the first failed assertion. The only added dependency is `fast-check`
 * (already a dev dependency, v4). `scan()` is pure (no file system access), so
 * each generated HTML fragment is fed directly to the scanner.
 *
 * Property under test (no numbered design property is assigned to task 3.4 —
 * the property is stated directly against its acceptance criteria):
 *
 *   For any HTML fragment assembled from elements at KNOWN line positions with
 *   KNOWN tag names and class/style attribute values, every occurrence the
 *   scanner emits (a) carries an element locator whose line number and tag name
 *   resolve back to the originating element (the reported source line really
 *   contains that start tag and that attribute value), and (b) is flagged
 *   `dynamic` exactly when it originates inside a `<script>` block / JS template
 *   literal or its attribute value carries a `${...}` interpolation. Detection
 *   is also complete and coverage-exact: the number of emitted class / inline-
 *   style occurrences equals the number constructed.
 *
 * **Validates: Requirements 1.3, 1.4, 1.5, 7.2**
 *
 * Run directly:  node tools/tailwind-standardize/tests/scanner.property.test.js
 */

const assert = require('assert');
const path = require('path');
const fc = require('fast-check');

const { scan } = require(path.join(__dirname, '..', 'core', 'scanner.js'));

// A fixed, non-empty file path used as locator metadata (no I/O is performed).
const FILE_PATH = 'C:/workspace/page.html';

// ---------------------------------------------------------------------------
// Value generators — class/style attribute values that never contain quotes,
// `<`, or `>` so each generated start tag stays well-formed and unambiguous.
// `${...}` interpolations are added only when the `interp` flag is set.
// ---------------------------------------------------------------------------

const classTokenArb = fc.constantFrom(
    'flex', 'gap-2', 'p-4', 'text-center', 'bg-primary', 'items-center', 'mt-2', 'hidden', 'rounded', 'border', 'grid'
);
const classBaseArb = fc.array(classTokenArb, { minLength: 1, maxLength: 4 }).map((a) => a.join(' '));

const styleDeclArb = fc.constantFrom(
    'color:red', 'display:flex', 'margin:0', 'padding:4px', 'font-weight:bold', 'text-align:center'
);
const styleBaseArb = fc.array(styleDeclArb, { minLength: 1, maxLength: 3 }).map((a) => a.join('; '));

const interpIdentArb = fc.constantFrom('x', 'pct', 'w', 'val', 'color');

// Tags include a couple of upper-case variants to exercise the scanner's
// tag-name lowercasing in the locator.
const rawTagArb = fc.constantFrom('div', 'span', 'p', 'a', 'button', 'li', 'section', 'label', 'DIV', 'SPAN');

/**
 * One element: a tag name plus a class and/or style attribute (at least one),
 * each value optionally carrying a `${...}` interpolation. Values are fully
 * materialized here so the assembler and the expectation share one source of
 * truth.
 */
const elementArb = fc
    .record({
        rawTag: rawTagArb,
        hasClass: fc.boolean(),
        hasStyle: fc.boolean(),
        classBase: classBaseArb,
        styleBase: styleBaseArb,
        classInterp: fc.boolean(),
        styleInterp: fc.boolean(),
        classIdent: interpIdentArb,
        styleIdent: interpIdentArb,
    })
    .map((e) => {
        // Guarantee the element bears at least one attribute of interest.
        const hasClass = e.hasClass || !e.hasStyle;
        const hasStyle = e.hasStyle;
        const classValue = e.classInterp ? `${e.classBase} cls-` + '${' + e.classIdent + '}' : e.classBase;
        const styleValue = e.styleInterp ? `${e.styleBase}; width:` + '${' + e.styleIdent + '}%' : e.styleBase;
        return {
            rawTag: e.rawTag,
            tag: e.rawTag.toLowerCase(),
            hasClass,
            hasStyle,
            classValue,
            styleValue,
        };
    });

/** One element placed inside a `<script>` block, bare or in a template literal. */
const scriptElementArb = fc.record({ el: elementArb, inTemplate: fc.boolean() });

// ---------------------------------------------------------------------------
// Unit generators — a document is a sequence of units laid out top-to-bottom.
// ---------------------------------------------------------------------------

const fillerUnitArb = fc.record({
    kind: fc.constant('filler'),
    count: fc.integer({ min: 1, max: 3 }),
});

const staticUnitArb = fc.record({
    kind: fc.constant('static'),
    pad: fc.nat({ max: 3 }),
    el: elementArb,
});

const scriptUnitArb = fc.record({
    kind: fc.constant('script'),
    pad: fc.nat({ max: 2 }),
    lead: fc.nat({ max: 2 }),
    els: fc.array(scriptElementArb, { minLength: 1, maxLength: 3 }),
});

const docArb = fc.array(fc.oneof(fillerUnitArb, staticUnitArb, scriptUnitArb), { minLength: 0, maxLength: 8 });

// ---------------------------------------------------------------------------
// Assembler — turn a generated document into text plus the exact set of
// occurrences (with known line/tag/value/dynamic) the scanner must report.
// ---------------------------------------------------------------------------

function buildTag(rawTag, el) {
    const parts = [];
    if (el.hasClass) {
        parts.push(`class="${el.classValue}"`);
    }
    if (el.hasStyle) {
        parts.push(`style="${el.styleValue}"`);
    }
    return `<${rawTag} ${parts.join(' ')}>`;
}

function assemble(units) {
    const lines = [];
    const expectedClass = [];
    const expectedStyle = [];

    const record = (el, lineNo, inScript) => {
        if (el.hasClass) {
            expectedClass.push({
                line: lineNo,
                tag: el.tag,
                rawTag: el.rawTag,
                value: el.classValue,
                dynamic: inScript || el.classValue.indexOf('${') !== -1,
            });
        }
        if (el.hasStyle) {
            expectedStyle.push({
                line: lineNo,
                tag: el.tag,
                rawTag: el.rawTag,
                value: el.styleValue,
                dynamic: inScript || el.styleValue.indexOf('${') !== -1,
            });
        }
    };

    for (const unit of units) {
        if (unit.kind === 'filler') {
            for (let i = 0; i < unit.count; i += 1) {
                lines.push(`filler text line ${i}`);
            }
        } else if (unit.kind === 'static') {
            for (let i = 0; i < unit.pad; i += 1) {
                lines.push('');
            }
            const lineNo = lines.length + 1;
            lines.push(buildTag(unit.el.rawTag, unit.el));
            record(unit.el, lineNo, false);
        } else if (unit.kind === 'script') {
            for (let i = 0; i < unit.pad; i += 1) {
                lines.push('');
            }
            lines.push('<script>');
            for (let i = 0; i < unit.lead; i += 1) {
                lines.push(`var lead${i} = ${i};`);
            }
            for (const se of unit.els) {
                const lineNo = lines.length + 1;
                const tag = buildTag(se.el.rawTag, se.el);
                // Both forms keep the tag inside a dynamic region (the <script>
                // span, and additionally a template-literal span for the
                // backtick variant), so the occurrence must be flagged dynamic.
                const line = se.inTemplate ? `const s = \`${tag}\`;` : `var s = '${tag}';`;
                lines.push(line);
                record(se.el, lineNo, true);
            }
            lines.push('</script>');
        }
    }

    return { text: lines.join('\n'), lines, expectedClass, expectedStyle };
}

// ---------------------------------------------------------------------------
// Per-occurrence verification — locator accuracy + dynamic flag.
// ---------------------------------------------------------------------------

function verifyList(actual, expected, lines, label) {
    for (let i = 0; i < expected.length; i += 1) {
        const a = actual[i];
        const e = expected[i];

        // The locator must carry the supplied file path and the (lower-cased) tag.
        assert.strictEqual(a.locator.filePath, FILE_PATH, `${label}[${i}] locator.filePath`);
        assert.strictEqual(a.locator.tag, e.tag, `${label}[${i}] locator.tag`);
        assert.strictEqual(a.locator.line, e.line, `${label}[${i}] locator.line`);
        assert.strictEqual(a.value, e.value, `${label}[${i}] attribute value`);
        assert.strictEqual(a.dynamic, e.dynamic, `${label}[${i}] dynamic flag`);

        // Resolve the locator back to the originating element: the reported
        // source line must actually contain this element's start tag and value.
        const src = lines[a.locator.line - 1];
        assert.ok(
            typeof src === 'string' && src.indexOf(`<${e.rawTag}`) !== -1,
            `${label}[${i}] reported line ${e.line} must contain the originating <${e.rawTag} start tag`
        );
        assert.ok(
            src.indexOf(e.value) !== -1,
            `${label}[${i}] reported line ${e.line} must contain the attribute value`
        );
    }
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

// Feature: tailwind-css-standardization, Scanner locator accuracy & dynamic-region
// marking — Validates Requirements 1.3, 1.4, 1.5, 7.2
function testScannerLocatorAccuracyAndDynamicMarking() {
    fc.assert(
        fc.property(docArb, (units) => {
            const { text, lines, expectedClass, expectedStyle } = assemble(units);
            const result = scan(text, FILE_PATH);

            // Coverage-exact: no occurrence is missed or invented.
            assert.strictEqual(
                result.classOccurrences.length,
                expectedClass.length,
                'class occurrence count must equal the number constructed'
            );
            assert.strictEqual(
                result.inlineStyles.length,
                expectedStyle.length,
                'inline-style occurrence count must equal the number constructed'
            );

            // Locator accuracy + dynamic-region marking for every occurrence.
            verifyList(result.classOccurrences, expectedClass, lines, 'class');
            verifyList(result.inlineStyles, expectedStyle, lines, 'style');
        }),
        { numRuns: 200 }
    );

    console.log('[scanner.property] scanner locator accuracy & dynamic-region marking OK');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testScannerLocatorAccuracyAndDynamicMarking();
    console.log('[scanner.property] All scanner property tests passed');
}

run();
