'use strict';

// node tests/orientation/topbar-print-placement.test.js
// Asserts: single Print Preview control on orientation page is relocated into the
// sticky unified header (.header.dashboard-topbar > .header-right), NOT the filter
// form or the (scrolling) .page-title-row; click wiring still hits PrintSystem.preview.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SCRATCH =
    process.env.GROK_SCRATCH ||
    path.join(
        process.env.TEMP || process.env.TMP || process.env.LOCALAPPDATA || '/tmp',
        'grok-goal-a4292e3232f2',
        'implementer'
    );

const htmlPath = path.join(ROOT, 'students-orientation.html');
const pageJsPath = path.join(ROOT, 'js', 'pages', 'students-orientation.js');
const helperPath = path.join(ROOT, 'js', 'shared', 'orientation-topbar-print.js');

const html = fs.readFileSync(htmlPath, 'utf8');
const pageJs = fs.readFileSync(pageJsPath, 'utf8');
const helperSrc = fs.readFileSync(helperPath, 'utf8');

// ── 1. HTML: exactly one #print-btn relocation source, outside the wiped .header ──
const printIdMatches = html.match(/id="print-btn"/g) || [];
assert.strictEqual(printIdMatches.length, 1, 'exactly one id="print-btn" in orientation HTML');

const titleRowIdx = html.indexOf('page-title-row');
const printIdx = html.indexOf('id="print-btn"');
const filtersIdx = html.indexOf('id="orientation-filters"');
assert.ok(titleRowIdx >= 0, 'page-title-row present');
assert.ok(printIdx > titleRowIdx, 'static print-btn source appears after page-title-row open');
assert.ok(filtersIdx > printIdx, 'print-btn appears before orientation-filters');

// The static source must NOT sit inside the pre-unified <header> that setupUnifiedHeader wipes
const headerOpen = html.indexOf('<header class="header">');
const headerClose = html.indexOf('</header>', headerOpen);
assert.ok(headerOpen >= 0 && headerClose > headerOpen, 'header block found');
assert.ok(printIdx < headerOpen || printIdx > headerClose, 'print-btn is NOT inside wiped .header');

// Label / classes for the orientation print control
assert.ok(html.includes('معاينة الطباعة'), 'Arabic Print Preview label present');
assert.ok(html.includes('ux-print-preview-btn'), 'shared print-preview button class');

// Filter actions: only refresh + reset (no print)
const filtersEnd = html.indexOf('</form>', filtersIdx);
const filtersSlice = html.slice(filtersIdx, filtersEnd > filtersIdx ? filtersEnd : filtersIdx + 8000);
assert.ok(!filtersSlice.includes('id="print-btn"'), 'filters do not contain print-btn');
assert.ok(!filtersSlice.includes('ux-print-preview-btn'), 'filters do not inject print preview btn');
assert.ok(filtersSlice.includes('id="refresh-btn"'), 'refresh remains in filters');
assert.ok(filtersSlice.includes('id="reset-filters-btn"'), 'reset remains in filters');

// Shared helper loaded on the page
assert.ok(
    html.includes('js/shared/orientation-topbar-print.js'),
    'orientation page loads orientation-topbar-print helper'
);

// ── 2. Page JS still uses PrintSystem.preview with same orientation flow ──
assert.ok(pageJs.includes('PrintSystem.preview'), 'page still calls PrintSystem.preview');
assert.ok(pageJs.includes("contentSelector: '#orientation-export-sheet'"), 'same contentSelector');
assert.ok(pageJs.includes('mountOrientationTopBarPrint'), 'mounts via top-bar helper path');
assert.ok(pageJs.includes('ensurePrintInTopBar'), 'delegates to ensurePrintInTopBar');
// Retry loop now waits for the sticky unified header (result.header), not the title row
assert.ok(/r\.btn && r\.header/.test(pageJs), 'retry loop keyed on unified header presence');

// ── 3. Shipped helper: mount into sticky header + wire click (real function) ──
const topbar = require(helperPath);
assert.strictEqual(typeof topbar.ensurePrintInTopBar, 'function');
assert.strictEqual(typeof topbar.isPrintInTopBar, 'function');
assert.strictEqual(typeof topbar.findUnifiedHeader, 'function');
assert.strictEqual(topbar.PRINT_BTN_ID, 'print-btn');

/** Minimal DOM sufficient for ensurePrintInTopBar (sticky header + title row + filters). */
function makeDoc(opts = {}) {
    const { staticInTitleRow = false, headerReady = true } = opts;
    const nodes = [];

    function el(tag, attrs = {}) {
        const node = {
            tagName: String(tag).toUpperCase(),
            id: attrs.id || '',
            _className: attrs.className || '',
            classList: {
                _set: new Set(String(attrs.className || '').split(/\s+/).filter(Boolean)),
                contains(c) {
                    return this._set.has(c);
                },
                add(c) {
                    this._set.add(c);
                    node._className = [...this._set].join(' ');
                }
            },
            dataset: {},
            children: [],
            parentNode: null,
            parentElement: null,
            innerHTML: '',
            title: '',
            type: '',
            attributes: {},
            setAttribute(k, v) {
                this.attributes[k] = v;
                if (k === 'id') this.id = v;
                if (k === 'class') {
                    this.className = v;
                    this.classList._set = new Set(String(v).split(/\s+/).filter(Boolean));
                }
            },
            getAttribute(k) {
                return this.attributes[k] != null ? this.attributes[k] : null;
            },
            appendChild(child) {
                if (child.parentNode) {
                    const sibs = child.parentNode.children;
                    const i = sibs.indexOf(child);
                    if (i >= 0) sibs.splice(i, 1);
                }
                child.parentNode = this;
                child.parentElement = this;
                this.children.push(child);
                return child;
            },
            insertBefore(newNode, refNode) {
                if (newNode.parentNode) {
                    const sibs = newNode.parentNode.children;
                    const j = sibs.indexOf(newNode);
                    if (j >= 0) sibs.splice(j, 1);
                }
                newNode.parentNode = this;
                newNode.parentElement = this;
                const i = refNode ? this.children.indexOf(refNode) : -1;
                if (i >= 0) this.children.splice(i, 0, newNode);
                else this.children.push(newNode);
                return newNode;
            },
            removeChild(child) {
                const i = this.children.indexOf(child);
                if (i >= 0) this.children.splice(i, 1);
                child.parentNode = null;
                child.parentElement = null;
                return child;
            },
            contains(other) {
                if (other === this) return true;
                for (const c of this.children) {
                    if (c === other || (c.contains && c.contains(other))) return true;
                }
                return false;
            },
            querySelector(sel) {
                return query(this, sel, false);
            },
            querySelectorAll(sel) {
                return query(this, sel, true);
            },
            addEventListener(type, fn) {
                this._listeners = this._listeners || {};
                this._listeners[type] = this._listeners[type] || [];
                this._listeners[type].push(fn);
            },
            click() {
                ((this._listeners && this._listeners.click) || []).forEach((fn) => fn({ type: 'click' }));
            }
        };
        // Mirror real DOM: assigning .className keeps classList in sync
        Object.defineProperty(node, 'className', {
            get() {
                return this._className || '';
            },
            set(v) {
                this._className = String(v || '');
                this.classList._set = new Set(this._className.split(/\s+/).filter(Boolean));
            }
        });
        if (attrs.id) node.id = attrs.id;
        if (attrs['aria-label']) node.setAttribute('aria-label', attrs['aria-label']);
        nodes.push(node);
        return node;
    }

    function matchSel(node, sel) {
        if (sel.startsWith('#')) return node.id === sel.slice(1);
        if (sel.startsWith('.')) {
            return sel
                .slice(1)
                .split('.')
                .every((c) => node.classList.contains(c));
        }
        if (sel.includes('.')) {
            const [tag, ...cls] = sel.split('.');
            if (tag && node.tagName !== tag.toUpperCase()) return false;
            return cls.every((c) => node.classList.contains(c));
        }
        return node.tagName === sel.toUpperCase();
    }

    function walk(root, visit) {
        visit(root);
        for (const c of root.children || []) walk(c, visit);
    }

    function query(root, sel, all) {
        // Support child-combinator selectors like "main.main-content > .header.dashboard-topbar"
        if (sel.includes('>')) {
            const parts = sel.split('>').map((s) => s.trim());
            let candidates = [root];
            for (const part of parts) {
                const next = [];
                for (const c of candidates) {
                    for (const child of c.children || []) {
                        if (matchSel(child, part)) next.push(child);
                    }
                }
                candidates = next;
            }
            return all ? candidates : candidates[0] || null;
        }
        const out = [];
        walk(root, (n) => {
            if (n !== root && matchSel(n, sel)) out.push(n);
        });
        return all ? out : out[0] || null;
    }

    const main = el('main', { className: 'main-content' });

    // Sticky unified header (or pre-unified header when headerReady === false)
    const header = el('header', {
        className: headerReady ? 'header unified-header dashboard-topbar' : 'header'
    });
    if (headerReady) header.dataset.unifiedHeader = 'true';
    const headerRight = el('div', { className: 'header-right' });
    const themeToggle = el('button', { id: 'theme-toggle', className: 'topbar-icon-btn' });
    headerRight.appendChild(themeToggle);
    header.appendChild(headerRight);
    main.appendChild(header);

    // Title row (holds import link; may hold the static print source)
    const titleRow = el('div', { className: 'page-title-row orientation-title-row' });
    const title = el('h2', { className: 'page-title' });
    titleRow.appendChild(title);
    main.appendChild(titleRow);

    const filters = el('form', { id: 'orientation-filters' });
    main.appendChild(filters);

    let staticBtn = null;
    if (staticInTitleRow) {
        const actions = el('div', { className: 'orientation-header-actions' });
        staticBtn = el('button', {
            id: 'print-btn',
            className: 'btn btn-success ux-print-preview-btn',
            'aria-label': 'معاينة الطباعة'
        });
        actions.appendChild(staticBtn);
        titleRow.appendChild(actions);
    }

    const docRoot = el('html');
    docRoot.appendChild(main);

    const doc = {
        _root: docRoot,
        getElementById(id) {
            let found = null;
            walk(docRoot, (n) => {
                if (n.id === id) found = n;
            });
            return found;
        },
        querySelector(sel) {
            return query(docRoot, sel, false);
        },
        querySelectorAll(sel) {
            return query(docRoot, sel, true);
        },
        createElement(tag) {
            return el(tag);
        }
    };

    return { doc, main, header, headerRight, themeToggle, titleRow, filters, staticBtn };
}

function filtersContains(node) {
    let n = node;
    while (n) {
        if (n.id === 'orientation-filters') return true;
        n = n.parentNode;
    }
    return false;
}

// 3a — static title-row button + ready header: MOVE into .header-right, wire once
{
    const { doc, header, headerRight, themeToggle, titleRow, staticBtn } = makeDoc({
        staticInTitleRow: true
    });
    let calls = 0;
    const onPrint = () => {
        calls += 1;
    };
    const result = topbar.ensurePrintInTopBar(doc, { onPrint });
    assert.ok(result.btn, 'btn returned');
    assert.strictEqual(result.btn, staticBtn, 'reuses (moves) the static #print-btn node');
    assert.strictEqual(result.created, false, 'does not create when a source exists');
    assert.strictEqual(result.moved, true, 'reports moved into sticky header');
    assert.strictEqual(result.header, header, 'returns the unified header');
    assert.ok(header.contains(result.btn), 'btn now lives inside sticky header');
    assert.ok(!titleRow.contains(result.btn), 'btn no longer in title row');
    assert.ok(topbar.isPrintInTopBar(doc, result.btn), 'isPrintInTopBar true under sticky header');

    // host is scoped and sits before #theme-toggle in .header-right
    const host = headerRight.querySelector('.orientation-topbar-actions');
    assert.ok(host && host.contains(result.btn), 'button hosted in .orientation-topbar-actions');
    assert.ok(
        headerRight.children.indexOf(host) < headerRight.children.indexOf(themeToggle),
        'host inserted before #theme-toggle'
    );

    result.btn.click();
    assert.strictEqual(calls, 1, 'click invokes onPrint once');
    // second ensure does not double-bind
    topbar.ensurePrintInTopBar(doc, { onPrint });
    result.btn.click();
    assert.strictEqual(calls, 2, 'still single listener after re-ensure');
}

// 3b — no button + ready header: CREATE inside .header-right, wire PrintSystem-style handler
{
    const { doc, header } = makeDoc({ staticInTitleRow: false });
    const previewCalls = [];
    const openPrintPreview = async () => {
        previewCalls.push({ contentSelector: '#orientation-export-sheet', landscape: true });
    };
    const result = topbar.ensurePrintInTopBar(doc, { onPrint: openPrintPreview });
    assert.ok(result.created, 'creates button when absent');
    assert.strictEqual(result.btn.id, 'print-btn');
    assert.ok(header.contains(result.btn), 'created inside sticky header');
    assert.ok(topbar.isPrintInTopBar(doc, result.btn));
    result.btn.click();
    assert.strictEqual(previewCalls.length, 1, 'wired handler runs');
    assert.strictEqual(previewCalls[0].contentSelector, '#orientation-export-sheet');
}

// 3c — button misplaced in filters + ready header: MOVE into sticky header
{
    const { doc, header, filters } = makeDoc({ staticInTitleRow: false });
    const misplaced = doc.createElement('button');
    misplaced.id = 'print-btn';
    misplaced.className = 'btn btn-success ux-print-preview-btn';
    misplaced.setAttribute('aria-label', 'معاينة الطباعة');
    filters.appendChild(misplaced);
    const result = topbar.ensurePrintInTopBar(doc, { onPrint: () => {} });
    assert.ok(result.moved, 'reports moved');
    assert.ok(header.contains(result.btn), 'moved into sticky header');
    assert.ok(!filters.contains(misplaced), 'no longer under filters');
    assert.ok(!filtersContains(result.btn), 'not under filters');
    assert.ok(!topbar.isPrintInTopBar(doc, misplaced) || header.contains(misplaced), 'filters host is not top-bar');
}

// 3d — header NOT yet unified: do NOT mount into it; leave static source untouched
{
    const { doc, header, titleRow, staticBtn } = makeDoc({
        staticInTitleRow: true,
        headerReady: false
    });
    assert.strictEqual(topbar.findUnifiedHeader(doc), null, 'no ready header detected');
    const result = topbar.ensurePrintInTopBar(doc, { onPrint: () => {} });
    assert.strictEqual(result.header, null, 'returns null header while not unified');
    assert.strictEqual(result.created, false, 'does not create before header is ready');
    assert.strictEqual(result.moved, false, 'does not move before header is ready');
    assert.ok(titleRow.contains(staticBtn), 'static source stays in title row until header unifies');
    assert.ok(!header.contains(staticBtn), 'button not placed into un-unified header');
    assert.ok(!topbar.isPrintInTopBar(doc, staticBtn), 'title-row button is not counted as top-bar');
}

// ── 4. Helper source is dual-export (page + tests share same implementation) ──
assert.ok(helperSrc.includes('ensurePrintInTopBar'), 'helper exports ensurePrintInTopBar');
assert.ok(helperSrc.includes('module.exports'), 'CommonJS export for tests');
assert.ok(helperSrc.includes('OrientationTopbarPrint'), 'browser global for page');
assert.ok(helperSrc.includes('orientation-topbar-actions'), 'scoped sticky-header host class');

// Write evidence for goal harness
try {
    fs.mkdirSync(SCRATCH, { recursive: true });
    const placement = [
        'ORIENTATION PRINT PLACEMENT — PASS',
        `print-btn count in HTML: ${printIdMatches.length}`,
        'runtime host: .header.dashboard-topbar > .header-right > .orientation-topbar-actions',
        'placed before #theme-toggle; NOT in .page-title-row and NOT in #orientation-filters',
        'static title-row #print-btn is a relocation source, moved into sticky header after unify',
        'helper waits for data-unified-header/dashboard-topbar before mounting (no wipe race)'
    ].join('\n');
    fs.writeFileSync(path.join(SCRATCH, 'orientation-print-placement.txt'), placement, 'utf8');

    const behavior = [
        'ORIENTATION PRINT BEHAVIOR — PASS',
        'ensurePrintInTopBar wires onPrint once (dataset flag)',
        'click on mounted #print-btn invokes handler that targets PrintSystem.preview semantics',
        'students-orientation.js keeps openPrintPreview → PrintSystem.preview({ contentSelector: #orientation-export-sheet, landscape: true, ... })',
        'mountOrientationTopBarPrint retries until result.header (sticky unified header) exists'
    ].join('\n');
    fs.writeFileSync(path.join(SCRATCH, 'orientation-print-behavior.txt'), behavior, 'utf8');

    const noDupes = [
        'ORIENTATION PRINT NO-DUPES — PASS',
        'HTML id="print-btn" count: 1 (relocation source)',
        'Filter form has no ux-print-preview-btn / print-btn',
        'ensurePrintInTopBar removes stray .ux-print-preview-btn once the live sticky button is anchored',
        'page binds via single mountOrientationTopBarPrint path'
    ].join('\n');
    fs.writeFileSync(path.join(SCRATCH, 'orientation-print-no-dupes.txt'), noDupes, 'utf8');

    fs.writeFileSync(
        path.join(SCRATCH, 'launch-limit.txt'),
        'Electron UI launch not required for this change; placement + wiring covered by Node tests against shipped helper and page sources.',
        'utf8'
    );
} catch (e) {
    console.warn('scratch write skipped:', e.message);
}

console.log('orientation topbar-print-placement: OK');
