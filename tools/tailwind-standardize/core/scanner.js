'use strict';

/**
 * HTML Scanner for the Tailwind CSS Standardization tool.
 *
 * `scan(fileText, filePath)` performs a single, stateful pass over the raw text
 * of one source file and reports every site that the Auditor / Refactorer cares
 * about:
 *
 *   - classOccurrences : one record per element bearing a `class` attribute.
 *   - inlineStyles     : one record per element bearing a `style` attribute.
 *   - styleBlocks      : one record per `<style>...</style>` block.
 *   - dynamicRegions   : the character ranges that originate inside a `<script>`
 *                        block or a JS template literal.
 *
 * Each occurrence carries an `ElementLocator` `{ filePath, line, tag }` that
 * uniquely identifies the element it came from (the 1-based line of the element's
 * start tag and the element's tag name) so a finding can be resolved back to the
 * originating element (Req 1.3-1.5).
 *
 * Occurrences whose start tag falls inside a dynamic region - or whose attribute
 * value contains a template-literal interpolation (`${...}`, e.g.
 * `style="width:${pct}%"`) - are flagged `dynamic: true` so the inline-style
 * converter can exclude JavaScript-generated styling (Req 7.2).
 *
 * The module is pure: it operates only on the provided `fileText` string and
 * never touches the file system. `filePath` is metadata used to build locators.
 * CommonJS is used to match the existing project conventions (see core/models.js).
 *
 * _Requirements: 1.3, 1.4, 1.5, 7.2_
 */

const path = require('path');

const { ElementLocator } = require(path.join(__dirname, 'models.js'));

// ---------------------------------------------------------------------------
// Regular expressions
// ---------------------------------------------------------------------------

/**
 * Matches an HTML start tag, capturing the tag name and the raw attribute
 * substring. The attribute portion `(?:"[^"]*"|'[^']*'|[^"'>])*?` consumes
 * quoted strings wholesale so a `>` inside an attribute value never terminates
 * the tag prematurely.
 */
const TAG_RE = /<([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^"'>])*?)\/?>/g;

/** Matches an entire `<style>...</style>` block (case-insensitive). */
const STYLE_BLOCK_RE = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;

/** Matches an entire `<script>...</script>` block (case-insensitive). */
const SCRIPT_BLOCK_RE = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;

/** Matches an HTML comment (which must not yield element occurrences). */
const COMMENT_RE = /<!--[\s\S]*?-->/g;

/**
 * Extracts `name="value"` / `name='value'` / `name=value` attribute pairs from
 * a tag's attribute substring.
 */
const ATTR_RE = /([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the list of character offsets at which each line starts so an arbitrary
 * offset can be mapped to a 1-based line number in O(log n).
 * @param {string} text
 * @returns {number[]} ascending list of line-start offsets (always begins with 0)
 */
function buildLineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] === '\n') {
            starts.push(i + 1);
        }
    }
    return starts;
}

/**
 * Resolve a character offset to its 1-based line number.
 * @param {number[]} lineStarts ascending line-start offsets
 * @param {number} offset
 * @returns {number} 1-based line number
 */
function offsetToLine(lineStarts, offset) {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid] <= offset) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    return lo + 1;
}

/**
 * Collect every `{ start, end }` range matched by a global regex.
 * @param {RegExp} re a global regex
 * @param {string} text
 * @returns {{ start: number, end: number }[]}
 */
function collectRanges(re, text) {
    const ranges = [];
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
        ranges.push({ start: match.index, end: match.index + match[0].length });
        if (match[0].length === 0) {
            re.lastIndex += 1; // guard against zero-width matches
        }
    }
    return ranges;
}

/**
 * Locate every JS template-literal span inside the provided script-block ranges.
 * A template literal is delimited by back-ticks; escaped back-ticks (`\``) do not
 * close it. Offsets returned are absolute (relative to the whole file).
 * @param {string} text
 * @param {{ start: number, end: number }[]} scriptRanges
 * @returns {{ start: number, end: number }[]}
 */
function collectTemplateLiterals(text, scriptRanges) {
    const literals = [];
    for (const region of scriptRanges) {
        let i = region.start;
        while (i < region.end) {
            const ch = text[i];
            if (ch === '\\') {
                i += 2; // skip the escaped character
                continue;
            }
            if (ch === '`') {
                const open = i;
                i += 1;
                while (i < region.end) {
                    if (text[i] === '\\') {
                        i += 2;
                        continue;
                    }
                    if (text[i] === '`') {
                        break;
                    }
                    i += 1;
                }
                literals.push({ start: open, end: Math.min(i + 1, region.end) });
            }
            i += 1;
        }
    }
    return literals;
}

/**
 * True when `offset` falls within any `{ start, end }` range (start-inclusive,
 * end-exclusive).
 * @param {number} offset
 * @param {{ start: number, end: number }[]} ranges
 * @returns {boolean}
 */
function offsetInRanges(offset, ranges) {
    for (const range of ranges) {
        if (offset >= range.start && offset < range.end) {
            return true;
        }
    }
    return false;
}

/**
 * Parse a tag's attribute substring into a case-insensitive `name -> value` map.
 * The first occurrence of a given attribute name wins (HTML semantics).
 * @param {string} attrText
 * @returns {Map<string, string>}
 */
function parseAttributes(attrText) {
    const attrs = new Map();
    ATTR_RE.lastIndex = 0;
    let match;
    while ((match = ATTR_RE.exec(attrText)) !== null) {
        const name = match[1].toLowerCase();
        // Groups 2/3/4 are the double-quoted, single-quoted and unquoted values.
        const value = match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4];
        if (!attrs.has(name)) {
            attrs.set(name, value === undefined ? '' : value);
        }
    }
    return attrs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan one file's text for class attributes, inline styles, `<style>` blocks,
 * and the dynamic regions that should be excluded from inline-style conversion.
 *
 * @param {string} fileText raw contents of the file
 * @param {string} filePath path used as locator metadata (no I/O is performed)
 * @returns {{
 *   classOccurrences: Array<{ value: string, locator: object, dynamic: boolean }>,
 *   inlineStyles: Array<{ value: string, locator: object, dynamic: boolean }>,
 *   styleBlocks: Array<{ content: string, locator: object, dynamic: boolean }>,
 *   dynamicRegions: Array<{ start: number, end: number, type: string }>,
 * }}
 */
function scan(fileText, filePath) {
    if (typeof fileText !== 'string') {
        throw new TypeError('[scanner] scan expects fileText to be a string');
    }
    if (typeof filePath !== 'string' || filePath.length === 0) {
        throw new TypeError('[scanner] scan expects a non-empty filePath string');
    }

    const lineStarts = buildLineStarts(fileText);

    // --- Region pre-pass: scripts, template literals, comments. ---
    const scriptRanges = collectRanges(SCRIPT_BLOCK_RE, fileText);
    const templateRanges = collectTemplateLiterals(fileText, scriptRanges);
    const commentRanges = collectRanges(COMMENT_RE, fileText);

    // Dynamic regions are scripts plus the template literals nested in them.
    const dynamicRegions = [];
    for (const range of scriptRanges) {
        dynamicRegions.push({ start: range.start, end: range.end, type: 'script' });
    }
    for (const range of templateRanges) {
        dynamicRegions.push({ start: range.start, end: range.end, type: 'template-literal' });
    }

    // An occurrence is dynamic if its tag sits inside a script/template region or
    // its attribute value carries a template-literal interpolation (Req 7.2).
    const isDynamic = (offset, value) =>
        offsetInRanges(offset, scriptRanges) ||
        offsetInRanges(offset, templateRanges) ||
        (typeof value === 'string' && value.indexOf('${') !== -1);

    const makeLocator = (offset, tag) =>
        ElementLocator({ filePath, line: offsetToLine(lineStarts, offset), tag });

    const classOccurrences = [];
    const inlineStyles = [];

    // --- Element pass: class / style attribute bearers. ---
    TAG_RE.lastIndex = 0;
    let tagMatch;
    while ((tagMatch = TAG_RE.exec(fileText)) !== null) {
        const tagOffset = tagMatch.index;

        if (tagMatch[0].length === 0) {
            TAG_RE.lastIndex += 1;
            continue;
        }

        // Skip tags that live inside HTML comments - they are not real elements.
        if (offsetInRanges(tagOffset, commentRanges)) {
            continue;
        }

        const tag = tagMatch[1].toLowerCase();
        const attrText = tagMatch[2] || '';
        if (attrText.indexOf('=') === -1) {
            continue; // no attributes => nothing of interest
        }

        const attrs = parseAttributes(attrText);

        if (attrs.has('class')) {
            const value = attrs.get('class');
            classOccurrences.push({
                value,
                locator: makeLocator(tagOffset, tag),
                dynamic: isDynamic(tagOffset, value),
            });
        }

        if (attrs.has('style')) {
            const value = attrs.get('style');
            inlineStyles.push({
                value,
                locator: makeLocator(tagOffset, tag),
                dynamic: isDynamic(tagOffset, value),
            });
        }
    }

    // --- Style-block pass. ---
    const styleBlocks = [];
    STYLE_BLOCK_RE.lastIndex = 0;
    let styleMatch;
    while ((styleMatch = STYLE_BLOCK_RE.exec(fileText)) !== null) {
        const blockOffset = styleMatch.index;
        styleBlocks.push({
            content: styleMatch[1] || '',
            locator: makeLocator(blockOffset, 'style'),
            dynamic: offsetInRanges(blockOffset, scriptRanges),
        });
        if (styleMatch[0].length === 0) {
            STYLE_BLOCK_RE.lastIndex += 1;
        }
    }

    return {
        classOccurrences,
        inlineStyles,
        styleBlocks,
        dynamicRegions,
    };
}

module.exports = {
    scan,
};
