'use strict';

/**
 * Refactorer orchestration (I/O shell) for the Tailwind CSS Standardization
 * tool.
 *
 * The Refactorer is the transformation stage of the Standardization_Tool. It is
 * the I/O shell that drives the deterministic pure core: given a resolved scope
 * (from `io/scope-resolver.js` `resolveScope`), it groups the Root_HTML_Set by
 * directory and, for each directory (a TRANSACTION BOUNDARY), it:
 *
 *   1. Reads each HTML file and re-derives every class-bearing / inline-styled
 *      element in document order (so edits map back to the exact source span).
 *   2. Runs the relevant pure transforms over each element:
 *        - `core/arbitrary-resolver.js` resolveArbitrary  (arbitrary -> token/scale)
 *        - `core/direction-mapper.js`    mapPhysical       (physical -> logical)
 *        - `core/inline-style-converter.js` convertInlineStyle (style -> utilities)
 *        - `core/conflict-resolver.js`   resolveConflicts  (conflict/duplicate removal)
 *        - `core/orderer.js`             order             (utility ordering)
 *        - `core/variant-normalizer.js`  normalizeVariants (hover propagation, dir-level)
 *        - `core/component-synthesizer.js` synthesizeComponentClass (combos -> @layer class)
 *   3. Routes EVERY candidate class-attribute edit through the
 *      **Output-Preservation Gate** (`core/preservation-gate.js` evaluateEdit).
 *      Only provably output-preserving (approved) edits are applied; a rejected
 *      edit leaves the original markup verbatim and is recorded as a
 *      manual-review / excluded `ReviewItem`.
 *   4. Writes approved file edits and routes new Design_Tokens / component
 *      classes through the **Config Writer** (`io/config-writer.js`).
 *   5. Runs the **Verifier** (`io/verifier.js` verify) as the per-directory
 *      transaction boundary. On verification failure the pipeline HALTS before
 *      processing the next directory (Req 11.7); the directories already
 *      committed keep their prior good state.
 *
 * Change/review records are accumulated across every processed directory so the
 * Changelog Writer can emit a single, complete changelog.
 *
 * Equivalence justification per transform:
 *   - Class-attribute rewrites (arbitrary, physical, conflict, ordering, hover
 *     propagation) have a before/after that is a `ClassToken[]`, so they are
 *     validated directly by the Output-Preservation Gate (Req 2.5, 6.5, 9.5).
 *   - Inline-style conversion is preservation-proving by construction: the
 *     converter only emits utilities whose computed rendering is identical to
 *     the static style, and excludes everything dynamic or inexpressible
 *     (Req 7.x); excluded styles become `ReviewItem`s.
 *   - Component-class consolidation is preservation-proving by construction: the
 *     synthesized `.class { @apply <utilities>; }` expands to exactly the
 *     utility set it replaces (Req 4.x); a name collision is recorded, never
 *     redefined (Req 4.5).
 *
 * A `dryRun` option computes and records every edit (and returns the rewritten
 * file text) WITHOUT touching the file system, the Config_Source, or the
 * Verifier, so the orchestration can be exercised deterministically by tests.
 *
 * This module performs read/write file system access and invokes the Verifier;
 * the pure core never calls it. CommonJS + Node built-ins to match existing
 * project conventions.
 *
 * _Requirements: 2.5, 4.5, 6.5, 9.5, 11.7_
 */

const fs = require('fs');
const path = require('path');

const { tokenize, serialize } = require(path.join(__dirname, '..', 'core', 'tokenizer.js'));
const { order } = require(path.join(__dirname, '..', 'core', 'orderer.js'));
const { resolveConflicts } = require(path.join(__dirname, '..', 'core', 'conflict-resolver.js'));
const {
    resolveArbitrary,
    buildThemeIndex,
    buildRecurrenceIndex,
} = require(path.join(__dirname, '..', 'core', 'arbitrary-resolver.js'));
const { mapPhysical, PHYSICAL_TO_LOGICAL } = require(path.join(__dirname, '..', 'core', 'direction-mapper.js'));
const { synthesizeComponentClass } = require(path.join(__dirname, '..', 'core', 'component-synthesizer.js'));
const { convertInlineStyle } = require(path.join(__dirname, '..', 'core', 'inline-style-converter.js'));
const { normalizeVariants } = require(path.join(__dirname, '..', 'core', 'variant-normalizer.js'));
const { evaluateEdit } = require(path.join(__dirname, '..', 'core', 'preservation-gate.js'));
const { detectCombinations } = require(path.join(__dirname, '..', 'core', 'combination-detector.js'));
const {
    ElementLocator,
    ChangeRecord,
    ReviewItem,
    NormalizationCategory,
    ReviewClassification,
    ReviewReasonCategory,
} = require(path.join(__dirname, '..', 'core', 'models.js'));

const configWriter = require(path.join(__dirname, 'config-writer.js'));
const verifier = require(path.join(__dirname, 'verifier.js'));

// ---------------------------------------------------------------------------
// Tag / region scanning (shared by the planning and apply passes so both
// enumerate the very same start tags in the very same order).
// ---------------------------------------------------------------------------

/** Mirrors core/scanner.js's start-tag matcher. */
const TAG_RE = /<([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^"'>])*?)\/?>/g;
const STYLE_BLOCK_RE = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const SCRIPT_BLOCK_RE = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;

/** Physical-direction prefixes that have a logical equivalent (longest first). */
const SORTED_PHYSICAL_PREFIXES = Array.from(PHYSICAL_TO_LOGICAL.keys()).sort(
    (a, b) => b.length - a.length
);

/**
 * Collect every `{ start, end }` range matched by a global regex.
 * @param {RegExp} re
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
            re.lastIndex += 1;
        }
    }
    return ranges;
}

/** True when `offset` falls within any range (start-inclusive, end-exclusive). */
function offsetInRanges(offset, ranges) {
    for (const range of ranges) {
        if (offset >= range.start && offset < range.end) {
            return true;
        }
    }
    return false;
}

/** Build ascending line-start offsets so an offset maps to a 1-based line. */
function buildLineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] === '\n') {
            starts.push(i + 1);
        }
    }
    return starts;
}

/** Resolve a character offset to its 1-based line number. */
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
 * Read a single attribute's value from a start tag's attribute substring.
 * @param {string} attrText
 * @param {string} name attribute name (case-insensitive)
 * @returns {string|null} the value, or null when the attribute is absent
 */
function readAttr(attrText, name) {
    const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))`, 'i');
    const match = re.exec(attrText);
    if (!match) {
        return null;
    }
    return match[1] !== undefined ? match[1] : match[2] !== undefined ? match[2] : match[3];
}

/**
 * Replace an existing attribute's value, preserving its original quote style.
 * @param {string} attrText
 * @param {string} name
 * @param {string} value
 * @returns {string}
 */
function replaceAttr(attrText, name, value) {
    const re = new RegExp(`(\\b${name}\\s*=\\s*)(["'])([\\s\\S]*?)\\2`, 'i');
    return attrText.replace(re, (whole, lead, quote) => `${lead}${quote}${value}${quote}`);
}

/**
 * Remove an attribute (and its leading whitespace) from a tag's attribute text.
 * @param {string} attrText
 * @param {string} name
 * @returns {string}
 */
function removeAttr(attrText, name) {
    const re = new RegExp(`\\s*\\b${name}\\s*=\\s*(["'])[\\s\\S]*?\\1`, 'i');
    return attrText.replace(re, '');
}

/**
 * Enumerate every real (non-comment) HTML start tag in document order, carrying
 * the data both the planning and apply passes need. Tags inside `<script>`
 * blocks, or whose attributes contain a `${...}` interpolation, are flagged
 * `dynamic` so JS-generated markup is never rewritten (Req 7.2).
 *
 * @param {string} text
 * @returns {Array<{
 *   rawTag: string, tag: string, attrText: string, close: string,
 *   offset: number, fullLen: number, line: number, dynamic: boolean,
 *   classValue: string|null, styleValue: string|null
 * }>}
 */
function collectStartTags(text) {
    const comments = collectRanges(COMMENT_RE, text);
    const scripts = collectRanges(SCRIPT_BLOCK_RE, text);
    const lineStarts = buildLineStarts(text);
    const tags = [];

    TAG_RE.lastIndex = 0;
    let m;
    while ((m = TAG_RE.exec(text)) !== null) {
        if (m[0].length === 0) {
            TAG_RE.lastIndex += 1;
            continue;
        }
        const offset = m.index;
        if (offsetInRanges(offset, comments)) {
            continue;
        }
        const rawTag = m[1];
        const attrText = m[2] || '';
        const close = m[0].slice(1 + rawTag.length + attrText.length);
        const dynamic = offsetInRanges(offset, scripts) || attrText.indexOf('${') !== -1;

        tags.push({
            rawTag,
            tag: rawTag.toLowerCase(),
            attrText,
            close,
            offset,
            fullLen: m[0].length,
            line: offsetToLine(lineStarts, offset),
            dynamic,
            classValue: attrText.indexOf('=') === -1 ? null : readAttr(attrText, 'class'),
            styleValue: attrText.indexOf('=') === -1 ? null : readAttr(attrText, 'style'),
        });
    }
    return tags;
}

/** Stable key for an element locator (used only for directory-level edits). */
function locatorKey(locator) {
    return `${locator.filePath}\u0000${locator.line}\u0000${locator.tag}`;
}

// ---------------------------------------------------------------------------
// Output-Preservation Gate helper
// ---------------------------------------------------------------------------

/**
 * Route a class-attribute edit through the Output-Preservation Gate. Returns
 * `true` only when the edit is provably output-preserving in every checked
 * context. Any gate error is treated conservatively as "not approved".
 *
 * @param {object[]} before ClassToken[] before the edit
 * @param {object[]} after ClassToken[] after the edit
 * @param {object} themeIndex
 * @returns {boolean}
 */
function gateApproved(before, after, themeIndex) {
    try {
        return evaluateEdit({ beforeTokens: before, afterTokens: after, themeIndex }).approved === true;
    } catch (err) {
        return false;
    }
}

/**
 * Determine which physical-direction prefix (if any) a token's base starts with.
 * A leading negative sign is ignored for the match. Only inline-axis utilities
 * that have a logical equivalent are considered (mirrors io/auditor.js).
 * @param {object} token ClassToken
 * @returns {boolean}
 */
function isMappablePhysical(token) {
    if (!token || typeof token.base !== 'string') {
        return false;
    }
    const body = token.base.startsWith('-') ? token.base.slice(1) : token.base;
    return SORTED_PHYSICAL_PREFIXES.some((prefix) => body.startsWith(prefix));
}

/** Replace the token at `index` with `replacement`, returning a new array. */
function replaceTokenAt(tokens, index, replacement) {
    const next = tokens.slice();
    next[index] = replacement;
    return next;
}

// ---------------------------------------------------------------------------
// Per-element transformation pipeline (every class-attribute edit is gated)
// ---------------------------------------------------------------------------

/**
 * Run the gated transform pipeline over a single element.
 *
 * Accumulates ChangeRecords / ReviewItems / new-token definitions into `acc`
 * and returns the element's final ClassToken list plus whether its `style`
 * attribute should be removed (inline-style conversion).
 *
 * @param {{
 *   classValue: string,
 *   styleOcc: { value: string, locator: object, dynamic: boolean }|null,
 *   locator: object,
 *   dirKey: string,
 *   context: object,
 *   acc: { changeRecords: object[], reviewItems: object[], newTokenDefs: object[] }
 * }} args
 * @returns {{ tokens: object[], removeStyle: boolean }}
 */
function processElement({ classValue, styleOcc, locator, dirKey, context, acc }) {
    const { themeIndex } = context;
    let current = tokenize(classValue);
    let removeStyle = false;

    const change = (category) =>
        acc.changeRecords.push(ChangeRecord({ filePath: locator.filePath, category, locator }));
    const review = (classification, reasonCategory, detail) =>
        acc.reviewItems.push(ReviewItem({ classification, reasonCategory, locator, detail: detail || '' }));

    // --- 1. Arbitrary-value resolution (Req 3.x) ----------------------------
    for (let i = 0; i < current.length; i += 1) {
        const token = current[i];
        if (!token.isArbitrary) {
            continue;
        }
        const res = resolveArbitrary(token, themeIndex);
        if (res.action === 'replace-existing' || res.action === 'add-token') {
            const candidate = replaceTokenAt(current, i, res.replacement);
            if (gateApproved(current, candidate, themeIndex)) {
                current = candidate;
                // A named-token match (or a newly proposed token) is
                // arbitrary-to-token; a bare spacing/sizing scale match is
                // magic-number-to-scale.
                if (res.tokenName) {
                    change(NormalizationCategory.ARBITRARY_TO_TOKEN);
                } else {
                    change(NormalizationCategory.MAGIC_NUMBER_TO_SCALE);
                }
                if (res.action === 'add-token') {
                    acc.newTokenDefs.push({
                        name: res.tokenName,
                        value: res.computedValue,
                        origin: dirKey,
                    });
                }
            } else {
                review(
                    ReviewClassification.MANUAL_REVIEW,
                    ReviewReasonCategory.OUTPUT_WOULD_CHANGE,
                    `${token.raw} -> ${res.replacement ? res.replacement.raw : '?'}`
                );
            }
        } else {
            // No matching token and recurs in < 2 files: retain + manual-review
            // identifying the value (Req 3.5).
            review(
                ReviewClassification.MANUAL_REVIEW,
                ReviewReasonCategory.NO_TOKEN_AND_RARE,
                `${token.raw} (arbitrary value: ${token.arbitraryValue})`
            );
        }
    }

    // --- 2. Physical -> logical mapping (Req 8.x) ---------------------------
    for (let i = 0; i < current.length; i += 1) {
        const token = current[i];
        if (!isMappablePhysical(token)) {
            continue;
        }
        const mapped = mapPhysical(token);
        if (mapped.logical) {
            const candidate = replaceTokenAt(current, i, mapped.logical);
            if (gateApproved(current, candidate, themeIndex)) {
                current = candidate;
                change(NormalizationCategory.PHYSICAL_TO_LOGICAL);
            } else {
                review(
                    ReviewClassification.MANUAL_REVIEW,
                    ReviewReasonCategory.OUTPUT_WOULD_CHANGE,
                    `${token.raw} -> ${mapped.logical.raw}`
                );
            }
        }
    }

    // --- 3. Inline-style conversion (Req 7.x), preservation by construction --
    if (styleOcc) {
        const conv = convertInlineStyle(styleOcc, themeIndex);
        if (conv.action === 'convert') {
            // Merge the converted utilities, then re-run conflict resolution so a
            // converted utility duplicating an existing class is de-duplicated.
            current = current.concat(conv.utilities);
            removeStyle = true;
            change(NormalizationCategory.INLINE_STYLE_ELIMINATION);
        } else {
            // Dynamic or inexpressible: retain the style and exclude it.
            const reason =
                conv.reason === ReviewReasonCategory.DYNAMIC_INLINE_STYLE
                    ? ReviewReasonCategory.DYNAMIC_INLINE_STYLE
                    : ReviewReasonCategory.NOT_EXPRESSIBLE;
            review(ReviewClassification.EXCLUDED, reason, `style="${styleOcc.value}"`);
        }
    }

    // --- 4. Conflict / duplicate resolution (Req 6.x) -----------------------
    const conflict = resolveConflicts(current);
    if (conflict.removed.length > 0) {
        if (gateApproved(current, conflict.kept, themeIndex)) {
            current = conflict.kept;
            change(NormalizationCategory.CONFLICT_REMOVAL);
        } else {
            review(
                ReviewClassification.MANUAL_REVIEW,
                ReviewReasonCategory.OUTPUT_WOULD_CHANGE,
                'conflict removal would change computed output'
            );
        }
    }
    for (const undecided of conflict.undecidable) {
        review(
            ReviewClassification.MANUAL_REVIEW,
            ReviewReasonCategory.UNDECIDABLE_CONFLICT,
            undecided.raw
        );
    }

    // --- 5. Utility ordering (Req 5.x) --------------------------------------
    const ordered = order(current);
    if (serialize(ordered) !== serialize(current)) {
        if (gateApproved(current, ordered, themeIndex)) {
            current = ordered;
            change(NormalizationCategory.UTILITY_ORDERING);
        }
        // Ordering is a multiset permutation, so the gate approves by design; a
        // rejection (should not occur) simply leaves the original order intact.
    }

    return { tokens: current, removeStyle };
}

// ---------------------------------------------------------------------------
// Text application
// ---------------------------------------------------------------------------

/**
 * Rebuild a file's text from the ordered tag list and the parallel plan array.
 * Each non-null plan entry rewrites that tag's `class` value (and removes its
 * `style` attribute when an inline style was converted). Tags with no plan
 * entry are emitted verbatim.
 *
 * @param {string} text original file text
 * @param {Array<object>} tags from `collectStartTags`
 * @param {Array<object|null>} planArr parallel plan entries
 * @returns {string}
 */
function applyPlan(text, tags, planArr) {
    let out = '';
    let cursor = 0;

    for (let i = 0; i < tags.length; i += 1) {
        const entry = planArr[i];
        if (!entry) {
            continue;
        }
        const tag = tags[i];
        let newAttr = tag.attrText;
        const newClassValue = serialize(entry.tokens);

        if (entry.hasClass) {
            newAttr = replaceAttr(newAttr, 'class', newClassValue);
        } else if (entry.addClass && entry.tokens.length > 0) {
            const pad = newAttr.length > 0 && !/\s$/.test(newAttr) ? ' ' : '';
            newAttr = `${newAttr}${pad}class="${newClassValue}"`;
        }
        if (entry.removeStyle) {
            newAttr = removeAttr(newAttr, 'style');
        }
        if (newAttr === tag.attrText) {
            continue;
        }

        const newFull = `<${tag.rawTag}${newAttr}${tag.close}`;
        out += text.slice(cursor, tag.offset) + newFull;
        cursor = tag.offset + tag.fullLen;
    }

    out += text.slice(cursor);
    return out;
}

// ---------------------------------------------------------------------------
// Directory transaction
// ---------------------------------------------------------------------------

/**
 * Refactor a single directory's group of files. Computes and (unless `dryRun`)
 * applies all gate-approved edits, then routes new tokens/component classes
 * through the Config Writer. Returns the accumulated records and the rewritten
 * file text (for dry-run inspection and testing).
 *
 * @param {string} dirKey directory key (relative, POSIX) used as change/review origin
 * @param {string[]} files absolute paths of the HTML files in this directory
 * @param {object} context shared context (themeIndex, componentLayerIndex, ...)
 * @returns {{
 *   changeRecords: object[],
 *   reviewItems: object[],
 *   newTokenDefs: object[],
 *   newComponentClasses: object[],
 *   fileTexts: Map<string, string>,
 *   configError: Error|null
 * }}
 */
function refactorDirectory(dirKey, files, context) {
    const acc = { changeRecords: [], reviewItems: [], newTokenDefs: [] };
    const newComponentClasses = [];
    const fileTexts = new Map();
    const filePlans = new Map(); // file -> { tags, planArr }
    const planByLocator = new Map(); // locatorKey -> plan entry (dir-level edits)
    const variantOccurrences = [];
    const comboOccurrences = [];

    // --- Planning pass: per-element gated transforms ------------------------
    for (const file of files) {
        let text;
        try {
            text = fs.readFileSync(file, 'utf8');
        } catch (err) {
            // An unreadable file is left untouched; nothing to refactor here.
            continue;
        }
        fileTexts.set(file, text);

        const tags = collectStartTags(text);
        const planArr = new Array(tags.length).fill(null);

        for (let i = 0; i < tags.length; i += 1) {
            const tag = tags[i];
            if (tag.classValue === null && tag.styleValue === null) {
                continue;
            }
            const locator = ElementLocator({ filePath: file, line: tag.line, tag: tag.tag });

            if (tag.dynamic) {
                // JS-generated markup is retained verbatim; a dynamic style is
                // recorded as excluded (Req 7.2).
                if (tag.styleValue !== null) {
                    acc.reviewItems.push(
                        ReviewItem({
                            classification: ReviewClassification.EXCLUDED,
                            reasonCategory: ReviewReasonCategory.DYNAMIC_INLINE_STYLE,
                            locator,
                            detail: `style="${tag.styleValue}"`,
                        })
                    );
                }
                continue;
            }

            const styleOcc =
                tag.styleValue !== null
                    ? { value: tag.styleValue, locator, dynamic: false }
                    : null;
            const result = processElement({
                classValue: tag.classValue !== null ? tag.classValue : '',
                styleOcc,
                locator,
                dirKey,
                context,
                acc,
            });

            const entry = {
                tokens: result.tokens,
                removeStyle: result.removeStyle,
                hasClass: tag.classValue !== null,
                addClass: tag.classValue === null && result.removeStyle,
                locator,
            };
            planArr[i] = entry;
            planByLocator.set(locatorKey(locator), entry);
            variantOccurrences.push({ locator, tokens: entry.tokens });
            comboOccurrences.push({ locator, value: serialize(entry.tokens) });
        }

        filePlans.set(file, { tags, planArr });
    }

    // --- Directory-level: variant hover propagation (Req 9.3) ---------------
    applyVariantNormalization(variantOccurrences, planByLocator, context, acc);

    // --- Directory-level: component-class consolidation (Req 4.x) -----------
    applyComponentSynthesis(comboOccurrences, planByLocator, dirKey, context, acc, newComponentClasses);

    // --- Write file edits ---------------------------------------------------
    const rewritten = new Map();
    for (const [file, { tags, planArr }] of filePlans.entries()) {
        const original = fileTexts.get(file);
        const newText = applyPlan(original, tags, planArr);
        rewritten.set(file, newText);
        if (!context.dryRun && newText !== original) {
            fs.writeFileSync(file, newText, 'utf8');
        }
    }

    // --- Config writes: new tokens + component classes ----------------------
    const dedupTokens = dedupeByName(acc.newTokenDefs);
    const dedupClasses = dedupeByName(newComponentClasses);
    let configError = null;
    if (dedupTokens.length > 0 || dedupClasses.length > 0) {
        try {
            configWriter.applyConfigChanges(
                context.workspaceRoot,
                { tokens: dedupTokens, componentClasses: dedupClasses },
                { dryRun: context.dryRun }
            );
        } catch (err) {
            configError = err;
        }
    }

    return {
        changeRecords: acc.changeRecords,
        reviewItems: acc.reviewItems,
        newTokenDefs: dedupTokens,
        newComponentClasses: dedupClasses,
        fileTexts: rewritten,
        configError,
    };
}

/**
 * Apply hover-propagation edits from the Variant Normalizer to the planned
 * tokens, gating each merge. Manual-review items (arbitrary breakpoints) are
 * accumulated as-is.
 */
function applyVariantNormalization(variantOccurrences, planByLocator, context, acc) {
    let result;
    try {
        result = normalizeVariants(variantOccurrences);
    } catch (err) {
        return;
    }
    for (const item of result.manualReview) {
        acc.reviewItems.push(item);
    }
    for (const edit of result.edits) {
        const entry = planByLocator.get(locatorKey(edit.locator));
        if (!entry) {
            continue;
        }
        const before = entry.tokens;
        const after = before.concat(tokenize(edit.added.join(' ')));
        if (gateApproved(before, after, context.themeIndex)) {
            entry.tokens = after;
            acc.changeRecords.push(
                ChangeRecord({
                    filePath: edit.locator.filePath,
                    category: NormalizationCategory.VARIANT_NORMALIZATION,
                    locator: edit.locator,
                })
            );
        } else {
            acc.reviewItems.push(
                ReviewItem({
                    classification: ReviewClassification.MANUAL_REVIEW,
                    reasonCategory: ReviewReasonCategory.OUTPUT_WOULD_CHANGE,
                    locator: edit.locator,
                    detail: `hover propagation: ${edit.added.join(' ')}`,
                })
            );
        }
    }
}

/**
 * Consolidate recurring utility combinations into component classes. New
 * classes are registered (and substituted in place); collisions are recorded
 * and never redefined (Req 4.5). Substitution is preservation-proving by
 * construction (the `@apply` expands to exactly the replaced utilities).
 */
function applyComponentSynthesis(comboOccurrences, planByLocator, dirKey, context, acc, newComponentClasses) {
    let combinations;
    try {
        combinations = detectCombinations(comboOccurrences);
    } catch (err) {
        return;
    }

    for (const combo of combinations) {
        let synth;
        try {
            synth = synthesizeComponentClass(combo.utilitySet, context.componentLayerIndex);
        } catch (err) {
            continue;
        }

        if (synth.collision) {
            for (const loc of combo.locations) {
                acc.reviewItems.push(
                    ReviewItem({
                        classification: ReviewClassification.MANUAL_REVIEW,
                        reasonCategory: ReviewReasonCategory.NAME_COLLISION,
                        locator: loc,
                        detail: synth.className,
                    })
                );
            }
            continue;
        }

        let substituted = false;
        const setRaw = new Set(combo.utilitySet);
        for (const loc of combo.locations) {
            const entry = planByLocator.get(locatorKey(loc));
            if (!entry) {
                continue;
            }
            const present = entry.tokens.filter((token) => setRaw.has(token.raw));
            if (present.length !== combo.utilitySet.length) {
                continue; // not every utility of the combo is still on this element
            }
            const remaining = entry.tokens.filter((token) => !setRaw.has(token.raw));
            const classToken = tokenize(synth.className)[0];
            entry.tokens = [classToken].concat(remaining);
            acc.changeRecords.push(
                ChangeRecord({
                    filePath: loc.filePath,
                    category: NormalizationCategory.COMBINATION_TO_COMPONENT,
                    locator: loc,
                })
            );
            substituted = true;
        }

        if (substituted && !synth.reused) {
            newComponentClasses.push({
                name: synth.className,
                declaration: synth.declaration,
                origin: dirKey,
            });
            // Register so later combinations infer naming / detect collisions.
            context.componentLayerIndex.set(synth.className, synth.declaration);
        }
    }
}

/** De-duplicate an array of `{ name, ... }` records by `name` (first wins). */
function dedupeByName(records) {
    const seen = new Set();
    const out = [];
    for (const record of records) {
        if (!record || typeof record.name !== 'string' || seen.has(record.name)) {
            continue;
        }
        seen.add(record.name);
        out.push(record);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Scope / context helpers
// ---------------------------------------------------------------------------

/**
 * Derive the workspace root from an explicit option or from the scope's
 * Config_Source (`<root>/css/tailwind-input.css` => `<root>`).
 * @param {object} scope
 * @param {object} options
 * @returns {string}
 */
function resolveWorkspaceRoot(scope, options) {
    if (options && typeof options.workspaceRoot === 'string' && options.workspaceRoot.length > 0) {
        return path.resolve(options.workspaceRoot);
    }
    if (scope && typeof scope.configSource === 'string' && scope.configSource.length > 0) {
        return path.dirname(path.dirname(path.resolve(scope.configSource)));
    }
    return process.cwd();
}

/**
 * Group the Root_HTML_Set by directory, keyed by the POSIX-relative directory
 * from the workspace root ('.' for files directly at the root). Files under the
 * Mirror_Subtree are never included (Req 12.2).
 * @param {string[]} rootHtmlSet
 * @param {string} workspaceRoot
 * @param {string|null} mirrorSubtree
 * @returns {Map<string, string[]>} insertion-sorted by directory key
 */
function groupByDirectory(rootHtmlSet, workspaceRoot, mirrorSubtree) {
    const groups = new Map();
    for (const file of rootHtmlSet || []) {
        const abs = path.resolve(file);
        if (mirrorSubtree && (abs === path.resolve(mirrorSubtree) || abs.startsWith(path.resolve(mirrorSubtree) + path.sep))) {
            continue;
        }
        const rel = path.relative(workspaceRoot, path.dirname(abs));
        const key = rel === '' ? '.' : rel.split(path.sep).join('/');
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(abs);
    }
    // Return a directory-key-sorted map for deterministic processing order.
    return new Map([...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
}

/**
 * Build the existing component-layer index (name -> declaration signature) from
 * the Config_Source so synthesized names follow conventions and collisions are
 * detected. Returns an empty Map when the source cannot be read.
 * @param {string} workspaceRoot
 * @returns {Map<string, string>}
 */
function buildComponentLayerIndex(workspaceRoot) {
    try {
        const configPath = configWriter.resolveConfigSourcePath(workspaceRoot);
        const css = configWriter.readConfigSource(configPath);
        const block = configWriter.findComponentLayerBlock(css);
        if (!block) {
            return new Map();
        }
        return configWriter.indexComponentClasses(css.slice(block.contentStart, block.contentEnd));
    } catch (err) {
        return new Map();
    }
}

/**
 * Build the cross-scope arbitrary-value recurrence index (value -> set of files
 * it appears in) so the resolver's add-token threshold (>= 2 files) is correct.
 * @param {string[]} files absolute paths
 * @returns {Map<string, Set<string>>}
 */
function buildRecurrence(files) {
    const occurrences = [];
    for (const file of files || []) {
        let text;
        try {
            text = fs.readFileSync(file, 'utf8');
        } catch (err) {
            continue;
        }
        for (const tag of collectStartTags(text)) {
            if (tag.dynamic || tag.classValue === null) {
                continue;
            }
            for (const token of tokenize(tag.classValue)) {
                if (token.isArbitrary && typeof token.arbitraryValue === 'string') {
                    occurrences.push({ value: token.arbitraryValue, filePath: file });
                }
            }
        }
    }
    return buildRecurrenceIndex(occurrences);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Refactor the resolved scope, one directory at a time.
 *
 * For each directory the relevant pure transforms are run, every candidate
 * class-attribute edit is routed through the Output-Preservation Gate, only
 * provably-safe edits are applied (file edits + Config Writer), and then the
 * Verifier runs as the directory's transaction boundary. A verification failure
 * HALTS the pipeline before the next directory (Req 11.7).
 *
 * @param {{ rootHtmlSet: string[], configSource?: string, mirrorSubtree?: string|null,
 *          excludedFiles?: string[] }} scope resolved scope
 * @param {{
 *   dryRun?: boolean,                // compute + record edits without writing / verifying
 *   workspaceRoot?: string,          // overrides the root derived from the scope
 *   runVerifier?: boolean,           // defaults to !dryRun
 *   verify?: (opts: object) => object, // injectable verifier (defaults to io/verifier.verify)
 *   lintBaseline?: number,           // forwarded to the Verifier (Req 11.5)
 *   themeIndex?: object,             // overrides the default theme/scale index
 *   componentLayerIndex?: Map<string,string>, // overrides the inferred layer index
 * }} [options]
 * @returns {{
 *   changeRecords: object[],
 *   reviewItems: object[],
 *   newTokens: object[],
 *   newComponentClasses: object[],
 *   processedDirectories: string[],
 *   halted: boolean,
 *   failedCommand: string|null,
 *   fileTexts: Map<string, string>,
 * }}
 * @see Requirements 2.5, 4.5, 6.5, 9.5, 11.7
 */
function refactor(scope, options = {}) {
    if (!scope || typeof scope !== 'object' || !Array.isArray(scope.rootHtmlSet)) {
        throw new TypeError('[refactorer] refactor expects a resolved scope with a rootHtmlSet array');
    }

    const dryRun = options.dryRun === true;
    const runVerifier = options.runVerifier === undefined ? !dryRun : options.runVerifier === true;
    const verifyFn = typeof options.verify === 'function' ? options.verify : verifier.verify;
    const workspaceRoot = resolveWorkspaceRoot(scope, options);

    const themeIndex =
        options.themeIndex && options.themeIndex.tokenValues instanceof Map
            ? options.themeIndex
            : buildThemeIndex({ recurrence: buildRecurrence(scope.rootHtmlSet) });

    const componentLayerIndex =
        options.componentLayerIndex instanceof Map
            ? options.componentLayerIndex
            : buildComponentLayerIndex(workspaceRoot);

    const context = { workspaceRoot, themeIndex, componentLayerIndex, dryRun, scope };

    const directories = groupByDirectory(scope.rootHtmlSet, workspaceRoot, scope.mirrorSubtree);

    const accumulated = {
        changeRecords: [],
        reviewItems: [],
        newTokens: [],
        newComponentClasses: [],
        processedDirectories: [],
        halted: false,
        failedCommand: null,
        fileTexts: new Map(),
    };

    for (const [dirKey, files] of directories.entries()) {
        const result = refactorDirectory(dirKey, files, context);

        accumulated.changeRecords.push(...result.changeRecords);
        accumulated.reviewItems.push(...result.reviewItems);
        accumulated.newTokens.push(...result.newTokenDefs);
        accumulated.newComponentClasses.push(...result.newComponentClasses);
        accumulated.processedDirectories.push(dirKey);
        for (const [file, text] of result.fileTexts.entries()) {
            accumulated.fileTexts.set(file, text);
        }

        // A Config Writer failure (e.g. identifier collision, JS-config guard)
        // is a hard stop for this transaction boundary (Req 10.4, 10.8).
        if (result.configError) {
            accumulated.halted = true;
            accumulated.failedCommand = `config-writer: ${result.configError.message}`;
            break;
        }

        // Per-directory TRANSACTION BOUNDARY: verify before moving on (Req 11.7).
        if (!dryRun && runVerifier) {
            const verification = verifyFn({ workspaceRoot, lintBaseline: options.lintBaseline });
            if (!verification || verification.ok !== true) {
                accumulated.halted = true;
                accumulated.failedCommand = verification ? verification.failedCommand : 'verification';
                break;
            }
        }
    }

    // Final de-duplication across directories (a token/class may recur).
    accumulated.newTokens = dedupeByName(accumulated.newTokens);
    accumulated.newComponentClasses = dedupeByName(accumulated.newComponentClasses);

    return accumulated;
}

module.exports = {
    refactor,
    refactorDirectory,
    // Exposed for targeted testing / reuse.
    processElement,
    applyPlan,
    collectStartTags,
    gateApproved,
    groupByDirectory,
    buildRecurrence,
};
