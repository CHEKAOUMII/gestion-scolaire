'use strict';

/**
 * Config Writer (I/O shell) for the Tailwind CSS Standardization tool.
 *
 * Applies the only configuration changes the tool is allowed to make to the
 * CSS-first Tailwind v4 Config_Source (`css/tailwind-input.css`):
 *
 *   - New Design_Tokens are written **only** inside the `@theme { ... }` block
 *     (Req 10.1).
 *   - New reusable component classes are written **only** inside the
 *     `@layer components { ... }` block (Req 10.2).
 *   - Dark-mode styling is expressed **only** through the existing
 *     `@variant dark` / `[data-theme="dark"]` mechanism; any snippet that would
 *     introduce an alternative dark mechanism (e.g. `prefers-color-scheme`, a
 *     `.dark` class) is rejected (Req 10.5).
 *   - Carry_Forward_CSS rules duplicated by a token/component are re-expressed
 *     and the duplicated legacy rule is removed, recording the original rule and
 *     its replacement (Req 10.6, 10.7).
 *   - An identifier collision (an existing token/class whose definition differs)
 *     halts with an error, leaving the existing entry unmodified (Req 10.8).
 *   - The presence of any JavaScript-based Tailwind config
 *     (`tailwind.config.js/.ts/.cjs/.mjs`) halts with an error and leaves the
 *     Config_Source unmodified (Req 10.4).
 *
 * Design: the transforms are **pure text functions** (`writeTokens`,
 * `writeComponentClasses`, `reexpressCarryForward`) that take CSS text + data
 * and return the modified text + records, never touching the file system. The
 * file reads/writes and the JS-config guard live in clearly separated functions
 * (`detectJsConfig`, `readConfigSource`, `writeConfigSource`,
 * `applyConfigChanges`). Because the orchestrator runs every pure transform
 * before it writes anything, a thrown collision/guard error guarantees the
 * Config_Source is left unmodified.
 *
 * CommonJS + Node built-ins (fs, path), 4-space indent, matching existing
 * project conventions (see io/scope-resolver.js).
 *
 * _Requirements: 10.1, 10.2, 10.4, 10.5, 10.6, 10.7, 10.8_
 */

const fs = require('fs');
const path = require('path');

const { TokenDefinition, ComponentClassDefinition } = require('../core/models');

/** Relative path (from workspace root) of the CSS-first Config_Source. */
const CONFIG_SOURCE_REL = path.join('css', 'tailwind-input.css');

/** JavaScript-based Tailwind config filenames that are not permitted (Req 10.4). */
const JS_CONFIG_FILENAMES = Object.freeze([
    'tailwind.config.js',
    'tailwind.config.ts',
    'tailwind.config.cjs',
    'tailwind.config.mjs',
]);

/**
 * Error raised when a configuration change cannot be applied safely. Carries a
 * machine-readable `code` so callers can branch:
 *   - `JS_CONFIG_DETECTED`     a JS-based Tailwind config exists (Req 10.4)
 *   - `IDENTIFIER_COLLISION`   an entry exists with a differing definition (Req 10.8)
 *   - `ALTERNATIVE_DARK_MECHANISM` a snippet uses a non-`@variant dark` mechanism (Req 10.5)
 *   - `BLOCK_NOT_FOUND`        the target `@theme` / `@layer components` block is absent
 */
class ConfigWriteError extends Error {
    constructor(message, code, detail) {
        super(message);
        this.name = 'ConfigWriteError';
        this.code = code || 'CONFIG_WRITE_ERROR';
        this.detail = detail || null;
    }
}

// ---------------------------------------------------------------------------
// Low-level CSS scanning helpers (comment/string aware)
// ---------------------------------------------------------------------------

/**
 * Given the index of an opening `{`, return the index of its matching `}`.
 * Braces inside CSS block comments and inside quoted strings are ignored so
 * values like `content: "{"` never throw off the depth count.
 *
 * @param {string} text
 * @param {number} openIndex index of the opening brace
 * @returns {number} index of the matching closing brace, or -1 if unbalanced
 */
function matchingBraceEnd(text, openIndex) {
    let depth = 0;
    let inBlockComment = false;
    let stringChar = null;

    for (let i = openIndex; i < text.length; i += 1) {
        const ch = text[i];
        const next = text[i + 1];

        if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                i += 1;
            }
            continue;
        }
        if (stringChar) {
            if (ch === '\\') {
                i += 1;
            } else if (ch === stringChar) {
                stringChar = null;
            }
            continue;
        }
        if (ch === '/' && next === '*') {
            inBlockComment = true;
            i += 1;
            continue;
        }
        if (ch === '"' || ch === "'") {
            stringChar = ch;
            continue;
        }
        if (ch === '{') {
            depth += 1;
        } else if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
}

/**
 * Locate a top-level block (e.g. `@theme { ... }`) by a header regex.
 *
 * @param {string} cssText
 * @param {RegExp} headerRegex matches the block header up to (and including) `{`
 * @returns {{ headerStart: number, openBrace: number, closeBrace: number,
 *   contentStart: number, contentEnd: number } | null}
 */
function findBlock(cssText, headerRegex) {
    const match = headerRegex.exec(cssText);
    if (!match) {
        return null;
    }
    const openBrace = cssText.indexOf('{', match.index);
    if (openBrace === -1) {
        return null;
    }
    const closeBrace = matchingBraceEnd(cssText, openBrace);
    if (closeBrace === -1) {
        return null;
    }
    return {
        headerStart: match.index,
        openBrace,
        closeBrace,
        contentStart: openBrace + 1,
        contentEnd: closeBrace,
    };
}

/** Find the `@theme { ... }` block. */
function findThemeBlock(cssText) {
    return findBlock(cssText, /@theme\s*\{/);
}

/** Find the `@layer components { ... }` block. */
function findComponentLayerBlock(cssText) {
    return findBlock(cssText, /@layer\s+components\s*\{/);
}

/** Strip block comments so declaration parsing is not confused by commented-out code. */
function stripBlockComments(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Collapse all whitespace runs to a single space and trim. */
function collapseWhitespace(text) {
    return text.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Existing-entry indexing (for collision detection)
// ---------------------------------------------------------------------------

/**
 * Parse the `name -> normalized value` map of the custom properties declared
 * directly inside the `@theme` block. Comments are stripped first.
 *
 * @param {string} themeContent the text between the theme block braces
 * @returns {Map<string, string>}
 */
function indexThemeTokens(themeContent) {
    const map = new Map();
    const cleaned = stripBlockComments(themeContent);
    const declRe = /(--[A-Za-z0-9-]+)\s*:\s*([^;]*);/g;
    let m;
    while ((m = declRe.exec(cleaned)) !== null) {
        const name = m[1].trim();
        const value = collapseWhitespace(m[2]);
        if (!map.has(name)) {
            map.set(name, value);
        }
    }
    return map;
}

/**
 * Parse the top-level rules of a CSS block into `{ selector, body }` records.
 * Nested rules (declarations inside a rule body) are not descended into; only
 * the rules directly contained in `content` are returned.
 *
 * @param {string} content the text between a block's braces
 * @returns {Array<{ selector: string, body: string, start: number, end: number }>}
 */
function parseTopLevelRules(content) {
    const rules = [];
    let i = 0;
    let selStart = 0;
    let inBlockComment = false;
    let stringChar = null;

    while (i < content.length) {
        const ch = content[i];
        const next = content[i + 1];

        if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                i += 1;
            }
            i += 1;
            continue;
        }
        if (stringChar) {
            if (ch === '\\') {
                i += 2;
                continue;
            }
            if (ch === stringChar) {
                stringChar = null;
            }
            i += 1;
            continue;
        }
        if (ch === '/' && next === '*') {
            inBlockComment = true;
            i += 2;
            continue;
        }
        if (ch === '"' || ch === "'") {
            stringChar = ch;
            i += 1;
            continue;
        }
        if (ch === '{') {
            const end = matchingBraceEnd(content, i);
            if (end === -1) {
                break;
            }
            const selector = content.slice(selStart, i).trim();
            const body = content.slice(i + 1, end);
            rules.push({ selector, body, start: selStart, end: end + 1 });
            i = end + 1;
            selStart = i;
            continue;
        }
        i += 1;
    }

    return rules;
}

/**
 * Index the top-level component classes by their bare class name when their
 * selector is exactly `.name` (the shape the synthesizer emits). The value is a
 * normalized declaration signature used to decide reuse vs collision.
 *
 * @param {string} layerContent text between the `@layer components` braces
 * @returns {Map<string, string>}
 */
function indexComponentClasses(layerContent) {
    const map = new Map();
    for (const rule of parseTopLevelRules(layerContent)) {
        const single = /^\.([A-Za-z0-9_-]+)$/.exec(rule.selector);
        if (single) {
            const name = single[1];
            if (!map.has(name)) {
                map.set(name, declarationSignature(rule.body));
            }
        }
    }
    return map;
}

/**
 * Reduce a rule body to an order-independent signature so equivalent
 * definitions compare equal. Whitespace is collapsed and the utility list of
 * any `@apply` statement is sorted.
 *
 * @param {string} body the inner text of a `.name { ... }` rule
 * @returns {string}
 */
function declarationSignature(body) {
    let normalized = collapseWhitespace(stripBlockComments(body));
    normalized = normalized.replace(/@apply\s+([^;]+);?/g, (whole, utilities) => {
        const sorted = utilities
            .trim()
            .split(/\s+/)
            .filter((token) => token.length > 0)
            .sort();
        return `@apply ${sorted.join(' ')};`;
    });
    return normalized;
}

// ---------------------------------------------------------------------------
// Dark-mode mechanism guard (Req 10.5)
// ---------------------------------------------------------------------------

/**
 * Reject any snippet that would introduce a dark-mode mechanism other than the
 * existing `@variant dark` / `[data-theme="dark"]` one. The allowed markers are
 * permitted; disallowed markers (OS preference media query, a `.dark` toggle
 * class, or a redefining `@custom-variant`) cause a halt.
 *
 * @param {string} snippet
 * @param {string} context human-readable origin for the error message
 */
function assertNoAlternativeDarkMechanism(snippet, context) {
    const text = String(snippet);

    if (/prefers-color-scheme/i.test(text)) {
        throw new ConfigWriteError(
            `Alternative dark-mode mechanism (prefers-color-scheme) is not permitted in ${context}; ` +
                'use the existing @variant dark / [data-theme="dark"] mechanism instead.',
            'ALTERNATIVE_DARK_MECHANISM',
            { context }
        );
    }
    // A bare `.dark` class toggle (but allow `[data-theme="dark"]`).
    if (/(^|[\s,>~+(])\.dark\b/.test(text)) {
        throw new ConfigWriteError(
            `Alternative dark-mode mechanism (.dark class) is not permitted in ${context}; ` +
                'use the existing @variant dark / [data-theme="dark"] mechanism instead.',
            'ALTERNATIVE_DARK_MECHANISM',
            { context }
        );
    }
    if (/@custom-variant\s+dark\b/.test(text)) {
        throw new ConfigWriteError(
            `Redefining the dark variant (@custom-variant dark) is not permitted in ${context}; ` +
                'the existing @variant dark mechanism must be reused.',
            'ALTERNATIVE_DARK_MECHANISM',
            { context }
        );
    }
}

// ---------------------------------------------------------------------------
// Insertion helper
// ---------------------------------------------------------------------------

/**
 * Insert `snippet` immediately before a block's closing brace, preserving the
 * existing text on either side.
 *
 * @param {string} cssText
 * @param {{ closeBrace: number }} block
 * @param {string} snippet text to insert (already indented, newline-terminated)
 * @returns {string}
 */
function insertBeforeBlockClose(cssText, block, snippet) {
    // Find the start of the line carrying the closing brace so the snippet is
    // inserted on its own lines above it.
    let lineStart = block.closeBrace;
    while (lineStart > 0 && cssText[lineStart - 1] !== '\n') {
        lineStart -= 1;
    }
    return cssText.slice(0, lineStart) + snippet + cssText.slice(lineStart);
}

// ---------------------------------------------------------------------------
// Pure text transforms
// ---------------------------------------------------------------------------

/**
 * Write new Design_Tokens into the `@theme` block only (Req 10.1).
 *
 * For each token: if the name already exists with an identical normalized
 * value, it is reused (idempotent, not a collision); if it exists with a
 * differing value, the function halts with an `IDENTIFIER_COLLISION` error and
 * the input text is left unmodified (Req 10.8). Dark-mode styling, if present in
 * a token value, must use the existing mechanism (Req 10.5).
 *
 * @param {string} cssText the full Config_Source text
 * @param {Array<object>} tokens TokenDefinition-like records ({ name, value, origin })
 * @returns {{ cssText: string, added: object[], reused: object[] }}
 */
function writeTokens(cssText, tokens) {
    if (typeof cssText !== 'string') {
        throw new TypeError('[config-writer] writeTokens requires the CSS text as a string');
    }
    const normalizedTokens = (tokens || []).map((token) => TokenDefinition(token));
    if (normalizedTokens.length === 0) {
        return { cssText, added: [], reused: [] };
    }

    const block = findThemeBlock(cssText);
    if (!block) {
        throw new ConfigWriteError(
            'Could not locate the @theme block in the Config_Source.',
            'BLOCK_NOT_FOUND',
            { block: '@theme' }
        );
    }

    const existing = indexThemeTokens(cssText.slice(block.contentStart, block.contentEnd));
    const added = [];
    const reused = [];
    const lines = [];

    for (const token of normalizedTokens) {
        const newValue = collapseWhitespace(token.value);
        assertNoAlternativeDarkMechanism(token.value, `token '${token.name}'`);

        if (existing.has(token.name)) {
            if (existing.get(token.name) === newValue) {
                reused.push(token);
                continue;
            }
            throw new ConfigWriteError(
                `Design_Token '${token.name}' already exists with a differing value; ` +
                    'halting the definition and leaving the existing entry unmodified.',
                'IDENTIFIER_COLLISION',
                {
                    identifier: token.name,
                    existingValue: existing.get(token.name),
                    proposedValue: newValue,
                }
            );
        }

        lines.push(`    ${token.name}: ${token.value};\n`);
        // Track within this batch so duplicate names in one call also collide.
        existing.set(token.name, newValue);
        added.push(token);
    }

    if (lines.length === 0) {
        return { cssText, added, reused };
    }

    const snippet = `    /* Standardization-added Design_Tokens */\n${lines.join('')}`;
    return { cssText: insertBeforeBlockClose(cssText, block, snippet), added, reused };
}

/**
 * Write new component classes into the `@layer components` block only
 * (Req 10.2). Collision handling mirrors `writeTokens` (Req 10.8); declaration
 * snippets must not introduce an alternative dark mechanism (Req 10.5).
 *
 * @param {string} cssText the full Config_Source text
 * @param {Array<object>} classes ComponentClassDefinition-like records
 *   ({ name, declaration, origin }) where `declaration` is the full
 *   `.name { ... }` rule.
 * @returns {{ cssText: string, added: object[], reused: object[] }}
 */
function writeComponentClasses(cssText, classes) {
    if (typeof cssText !== 'string') {
        throw new TypeError('[config-writer] writeComponentClasses requires the CSS text as a string');
    }
    const normalizedClasses = (classes || []).map((cls) => ComponentClassDefinition(cls));
    if (normalizedClasses.length === 0) {
        return { cssText, added: [], reused: [] };
    }

    const block = findComponentLayerBlock(cssText);
    if (!block) {
        throw new ConfigWriteError(
            'Could not locate the @layer components block in the Config_Source.',
            'BLOCK_NOT_FOUND',
            { block: '@layer components' }
        );
    }

    const existing = indexComponentClasses(cssText.slice(block.contentStart, block.contentEnd));
    const added = [];
    const reused = [];
    const snippets = [];

    for (const cls of normalizedClasses) {
        assertNoAlternativeDarkMechanism(cls.declaration, `component class '${cls.name}'`);
        const proposedSignature = declarationSignature(extractRuleBody(cls.declaration, cls.name));

        if (existing.has(cls.name)) {
            if (existing.get(cls.name) === proposedSignature) {
                reused.push(cls);
                continue;
            }
            throw new ConfigWriteError(
                `Component class '${cls.name}' already exists with a differing definition; ` +
                    'halting the definition and leaving the existing entry unmodified.',
                'IDENTIFIER_COLLISION',
                { identifier: cls.name }
            );
        }

        snippets.push(indentBlock(cls.declaration.trim(), '    '));
        existing.set(cls.name, proposedSignature);
        added.push(cls);
    }

    if (snippets.length === 0) {
        return { cssText, added, reused };
    }

    const snippet = `${snippets.join('\n')}\n`;
    return { cssText: insertBeforeBlockClose(cssText, block, snippet), added, reused };
}

/**
 * Extract the inner body of a `.name { ... }` declaration. When the declaration
 * is not wrapped (already a body), the trimmed text is returned as-is.
 *
 * @param {string} declaration
 * @param {string} name bare class name (no leading `.`)
 * @returns {string}
 */
function extractRuleBody(declaration, name) {
    const text = String(declaration).trim();
    const open = text.indexOf('{');
    if (open !== -1) {
        const close = matchingBraceEnd(text, open);
        if (close !== -1) {
            return text.slice(open + 1, close);
        }
    }
    return text;
}

/**
 * Indent every line of a block by the given prefix.
 * @param {string} text
 * @param {string} prefix
 * @returns {string}
 */
function indentBlock(text, prefix) {
    return text
        .split('\n')
        .map((line) => (line.length > 0 ? prefix + line : line))
        .join('\n');
}

/**
 * Re-express Carry_Forward_CSS rules that are now duplicated by a Design_Token
 * or component class: each duplicated legacy rule is removed from the text and a
 * record identifying the original rule and its replacement is produced (Req
 * 10.6, 10.7). This transform does **not** add the token/component itself — that
 * is the job of `writeTokens` / `writeComponentClasses`; it only removes the
 * now-redundant legacy rule and records the mapping.
 *
 * Each carry-forward spec must identify the legacy rule either by its exact
 * source text (`originalRule`) or by a selector to locate (`ruleSelector`), and
 * its `replacement` ({ kind: 'token'|'component', name }).
 *
 * @param {string} cssText
 * @param {Array<{ originalRule?: string, ruleSelector?: string,
 *   replacement: { kind: string, name: string } }>} carryForward
 * @returns {{ cssText: string, records: Array<{ originalRule: string,
 *   replacement: { kind: string, name: string } }> }}
 */
function reexpressCarryForward(cssText, carryForward) {
    if (typeof cssText !== 'string') {
        throw new TypeError('[config-writer] reexpressCarryForward requires the CSS text as a string');
    }
    const specs = carryForward || [];
    let text = cssText;
    const records = [];

    for (const spec of specs) {
        if (!spec || typeof spec !== 'object') {
            throw new TypeError('[config-writer] each carry-forward spec must be an object');
        }
        const replacement = spec.replacement;
        if (!replacement || typeof replacement.name !== 'string' || replacement.name.length === 0) {
            throw new TypeError(
                '[config-writer] each carry-forward spec requires a replacement with a name'
            );
        }

        const originalRule = resolveCarryForwardRuleText(text, spec);
        if (originalRule === null) {
            throw new ConfigWriteError(
                'Carry-forward rule to re-express could not be located in the Config_Source.',
                'CARRY_FORWARD_NOT_FOUND',
                { spec }
            );
        }

        text = removeFirstOccurrence(text, originalRule);
        records.push({
            originalRule: originalRule.trim(),
            replacement: { kind: replacement.kind || 'token', name: replacement.name },
        });
    }

    return { cssText: text, records };
}

/**
 * Resolve the exact source text of a carry-forward rule from a spec, either by
 * the literal `originalRule` text or by locating the first top-level rule whose
 * selector matches `ruleSelector`.
 *
 * @param {string} cssText
 * @param {{ originalRule?: string, ruleSelector?: string }} spec
 * @returns {string|null}
 */
function resolveCarryForwardRuleText(cssText, spec) {
    if (typeof spec.originalRule === 'string' && spec.originalRule.trim().length > 0) {
        return cssText.includes(spec.originalRule) ? spec.originalRule : null;
    }
    if (typeof spec.ruleSelector === 'string' && spec.ruleSelector.trim().length > 0) {
        return findRuleTextBySelector(cssText, spec.ruleSelector.trim());
    }
    return null;
}

/**
 * Find the full source text (`selector { ... }`) of the first top-level rule
 * whose selector equals `selector`.
 *
 * @param {string} cssText
 * @param {string} selector
 * @returns {string|null}
 */
function findRuleTextBySelector(cssText, selector) {
    const rules = parseTopLevelRules(cssText);
    for (const rule of rules) {
        if (rule.selector === selector) {
            return cssText.slice(rule.start, rule.end).trim();
        }
    }
    return null;
}

/**
 * Remove the first occurrence of `fragment` from `text`, also consuming a single
 * trailing newline (and surrounding blank line) so removal does not leave an
 * empty gap.
 *
 * @param {string} text
 * @param {string} fragment
 * @returns {string}
 */
function removeFirstOccurrence(text, fragment) {
    const index = text.indexOf(fragment);
    if (index === -1) {
        return text;
    }
    let end = index + fragment.length;
    // Consume one trailing newline if present.
    if (text[end] === '\n') {
        end += 1;
    }
    return text.slice(0, index) + text.slice(end);
}

// ---------------------------------------------------------------------------
// File-system I/O (clearly separated from the pure transforms)
// ---------------------------------------------------------------------------

/**
 * Detect any JavaScript-based Tailwind configuration at the workspace root
 * (Req 10.3/10.4). Returns the absolute path of the first detected config, or
 * `null` when none exists.
 *
 * @param {string} workspaceRoot
 * @returns {string|null}
 */
function detectJsConfig(workspaceRoot) {
    if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) {
        throw new TypeError('[config-writer] detectJsConfig requires a non-empty workspaceRoot');
    }
    const root = path.resolve(workspaceRoot);
    for (const filename of JS_CONFIG_FILENAMES) {
        const candidate = path.join(root, filename);
        try {
            if (fs.statSync(candidate).isFile()) {
                return candidate;
            }
        } catch (err) {
            // Not present: keep checking the remaining filenames.
        }
    }
    return null;
}

/**
 * Resolve the absolute Config_Source path for a workspace.
 * @param {string} workspaceRoot
 * @returns {string}
 */
function resolveConfigSourcePath(workspaceRoot) {
    return path.resolve(workspaceRoot, CONFIG_SOURCE_REL);
}

/**
 * Read the Config_Source text from disk.
 * @param {string} configPath
 * @returns {string}
 */
function readConfigSource(configPath) {
    return fs.readFileSync(configPath, 'utf8');
}

/**
 * Write the Config_Source text to disk.
 * @param {string} configPath
 * @param {string} cssText
 */
function writeConfigSource(configPath, cssText) {
    fs.writeFileSync(configPath, cssText, 'utf8');
}

/**
 * High-level orchestrator the Refactorer calls. Guards against a JS-based config
 * (Req 10.4), reads the Config_Source, runs every pure transform, and only then
 * writes the result back. Because all transforms run before the single write,
 * any collision/guard error (Req 10.5, 10.8) leaves the Config_Source unmodified.
 *
 * @param {string} workspaceRoot
 * @param {{ tokens?: object[], componentClasses?: object[], carryForward?: object[] }} changes
 * @param {{ dryRun?: boolean }} [options] when `dryRun` is true, the modified
 *   text and records are returned without writing to disk.
 * @returns {{
 *   configPath: string,
 *   cssText: string,
 *   tokensAdded: object[], tokensReused: object[],
 *   classesAdded: object[], classesReused: object[],
 *   carryForwardRecords: object[],
 *   written: boolean,
 * }}
 */
function applyConfigChanges(workspaceRoot, changes = {}, options = {}) {
    if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) {
        throw new TypeError('[config-writer] applyConfigChanges requires a non-empty workspaceRoot');
    }

    // Req 10.4: halt before any change if a JS-based Tailwind config is present.
    const jsConfig = detectJsConfig(workspaceRoot);
    if (jsConfig) {
        throw new ConfigWriteError(
            `JavaScript-based Tailwind configuration detected at '${jsConfig}'; ` +
                'JS-based configuration is not permitted. The Config_Source was left unmodified.',
            'JS_CONFIG_DETECTED',
            { configPath: jsConfig }
        );
    }

    const configPath = resolveConfigSourcePath(workspaceRoot);
    const original = readConfigSource(configPath);

    // Run pure transforms in order: re-express carry-forward first (removals),
    // then add tokens and component classes. A throw here means nothing is
    // written and the file stays as it was on disk.
    const carry = reexpressCarryForward(original, changes.carryForward);
    const tokenResult = writeTokens(carry.cssText, changes.tokens);
    const classResult = writeComponentClasses(tokenResult.cssText, changes.componentClasses);

    const finalText = classResult.cssText;
    const written = !options.dryRun && finalText !== original;
    if (written) {
        writeConfigSource(configPath, finalText);
    }

    return {
        configPath,
        cssText: finalText,
        tokensAdded: tokenResult.added,
        tokensReused: tokenResult.reused,
        classesAdded: classResult.added,
        classesReused: classResult.reused,
        carryForwardRecords: carry.records,
        written,
    };
}

module.exports = {
    // Pure text transforms
    writeTokens,
    writeComponentClasses,
    reexpressCarryForward,

    // File-system I/O + guards
    detectJsConfig,
    resolveConfigSourcePath,
    readConfigSource,
    writeConfigSource,
    applyConfigChanges,

    // Errors / constants
    ConfigWriteError,
    CONFIG_SOURCE_REL,
    JS_CONFIG_FILENAMES,

    // Exposed for tests
    findThemeBlock,
    findComponentLayerBlock,
    indexThemeTokens,
    indexComponentClasses,
    declarationSignature,
    matchingBraceEnd,
};
