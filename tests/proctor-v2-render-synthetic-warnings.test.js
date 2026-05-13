/**
 * Unit test — renderSyntheticRoomWarnings (Task 3.5)
 *
 * Validates: Requirements 2.2, 2.6
 *
 * The production helper lives inside a `<script>` block in
 * `exams-proctors.html` that depends on `document`, `window.location`,
 * `showToast`, and the module-local `_diagPanelCollapsed` state. It cannot be
 * `require`d directly (same pattern as the other Task 3.x tests).
 *
 * Following the established convention we mirror the helper here verbatim and
 * feed it tiny stand-in objects for `document`, `window.location` and
 * `showToast`. If the production helper changes, this mirror MUST be updated
 * to match.
 *
 * See:
 *   - exams-proctors.html §"renderSyntheticRoomWarnings"
 *   - bugfix.md §2.2, 2.6
 *   - design.md §"Warning UX"
 *   - tasks.md 3.5 (manual-verification note: one aggregated toast, never per-level)
 */

'use strict';

const assert = require('assert');

// ----------------------------------------------------------------------------
// Minimal DOM stub — enough to exercise the helper without a real jsdom.
// ----------------------------------------------------------------------------
function createElementStub(id) {
    return {
        id: id || null,
        innerHTML: '',
        style: { cssText: '', display: '' },
        children: [],
        parentNode: null,
        _listeners: {},
        insertBefore: function (node, ref) {
            node.parentNode = this;
            if (!ref) {
                this.children.push(node);
            } else {
                const idx = this.children.indexOf(ref);
                if (idx < 0) this.children.unshift(node);
                else this.children.splice(idx, 0, node);
            }
            return node;
        },
        removeChild: function (node) {
            const idx = this.children.indexOf(node);
            if (idx >= 0) this.children.splice(idx, 1);
            node.parentNode = null;
            return node;
        },
        addEventListener: function (evt, fn) {
            (this._listeners[evt] = this._listeners[evt] || []).push(fn);
        },
        // Convenience accessor used by the helper (body.firstChild).
        get firstChild() { return this.children[0] || null; }
    };
}

function createDocStub() {
    const panel = createElementStub('v2-diagnostics-panel');
    const body = createElementStub('v2-diagnostics-body');
    const registry = {
        'v2-diagnostics-panel': panel,
        'v2-diagnostics-body': body
    };
    return {
        panel: panel,
        body: body,
        getElementById: function (id) {
            // Walk the panel body subtree for any newly-created section so the
            // helper can locate `v2-synthetic-rooms-section` / the nav button.
            if (registry[id]) return registry[id];
            function search(node) {
                if (!node) return null;
                if (node.id === id) return node;
                if (!node.children) return null;
                for (const c of node.children) {
                    const hit = search(c);
                    if (hit) return hit;
                }
                return null;
            }
            return search(panel) || search(body);
        },
        createElement: function () {
            return createElementStub(null);
        }
    };
}

// ----------------------------------------------------------------------------
// Helper mirror — keep in sync with exams-proctors.html.
// ----------------------------------------------------------------------------
function escapeHtmlSafe(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function makeRenderSyntheticRoomWarnings(ctx) {
    // `ctx` carries the stubbed globals so each test gets its own sandbox.
    const document = ctx.document;
    const showToast = ctx.showToast;
    return function renderSyntheticRoomWarnings(warnings) {
        try {
            const panel = document.getElementById('v2-diagnostics-panel');
            const body = document.getElementById('v2-diagnostics-body');
            if (!panel || !body) return;

            const prev = document.getElementById('v2-synthetic-rooms-section');
            if (prev && prev.parentNode) prev.parentNode.removeChild(prev);

            if (!Array.isArray(warnings) || warnings.length === 0) return;

            let totalAdded = 0;
            for (let i = 0; i < warnings.length; i++) {
                totalAdded += Number(warnings[i] && warnings[i].added) || 0;
            }
            const levelsCount = warnings.length;

            const rowsHtml = warnings.map(function (w) {
                const nameCell = escapeHtmlSafe(w && w.levelName);
                const expected = Number(w && w.expected) || 0;
                const actual = Number(w && w.actual) || 0;
                const added = Number(w && w.added) || 0;
                return ''
                    + '<tr>'
                    +     '<td>' + nameCell + '</td>'
                    +     '<td>' + expected + '</td>'
                    +     '<td>' + actual + '</td>'
                    +     '<td>' + added + '</td>'
                    + '</tr>';
            }).join('');

            const section = document.createElement('div');
            section.id = 'v2-synthetic-rooms-section';
            section.innerHTML = '<table>' + rowsHtml + '</table>'
                + '<button id="v2-goto-rooms-btn"></button>';
            // Register the two sub-IDs the helper queries after innerHTML so
            // getElementById can find them.
            const btn = createElementStub('v2-goto-rooms-btn');
            section.children.push(btn);
            btn.parentNode = section;

            panel.style.display = '';
            body.insertBefore(section, body.firstChild);
            body.style.display = ctx._diagPanelCollapsed ? 'none' : '';

            const foundBtn = document.getElementById('v2-goto-rooms-btn');
            if (foundBtn) {
                foundBtn.addEventListener('click', function () {
                    ctx.navigatedTo = 'exams-rooms.html';
                });
            }

            showToast(
                'تم تكميل ' + totalAdded + ' قاعة افتراضية في ' + levelsCount + ' مستوى. راجع لوحة التشخيص.',
                'warning'
            );
        } catch (e) {
            showToast('خطأ في عرض تحذير القاعات الافتراضية: ' + (e.message || 'خطأ غير معروف'), 'error');
        }
    };
}

function makeCtx() {
    const doc = createDocStub();
    const toasts = [];
    return {
        document: doc,
        panel: doc.panel,
        body: doc.body,
        showToast: function (msg, type) { toasts.push({ msg: msg, type: type }); },
        toasts: toasts,
        _diagPanelCollapsed: false,
        navigatedTo: null
    };
}

// ----------------------------------------------------------------------------
// Test harness
// ----------------------------------------------------------------------------
const tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

function runAll() {
    let passed = 0;
    let failed = 0;
    const failures = [];
    for (const t of tests) {
        try {
            t.fn();
            console.log('  [pass] ' + t.name);
            passed++;
        } catch (e) {
            console.log('  [FAIL] ' + t.name + ': ' + e.message);
            failed++;
            failures.push({ name: t.name, message: e.message });
        }
    }
    console.log('\n[test] renderSyntheticRoomWarnings: ' + passed + ' passed, ' + failed + ' failed');
    if (failed > 0) {
        console.log('\n=== FAILURES ===');
        console.log(JSON.stringify(failures, null, 2));
        process.exit(1);
    }
}

console.log('[test] renderSyntheticRoomWarnings (Task 3.5)');

// ----------------------------------------------------------------------------
// No warnings → nothing rendered, no toast
// ----------------------------------------------------------------------------
console.log('\n  --- empty / no-op cases ---');

test('warnings=[] → no section added and no toast emitted', function () {
    const ctx = makeCtx();
    const render = makeRenderSyntheticRoomWarnings(ctx);
    render([]);
    assert.strictEqual(ctx.body.children.length, 0);
    assert.strictEqual(ctx.toasts.length, 0);
    assert.strictEqual(ctx.document.getElementById('v2-synthetic-rooms-section'), null);
});

test('warnings=null → no section added and no toast emitted', function () {
    const ctx = makeCtx();
    const render = makeRenderSyntheticRoomWarnings(ctx);
    render(null);
    assert.strictEqual(ctx.body.children.length, 0);
    assert.strictEqual(ctx.toasts.length, 0);
});

test('warnings=undefined → no section added and no toast emitted', function () {
    const ctx = makeCtx();
    const render = makeRenderSyntheticRoomWarnings(ctx);
    render(undefined);
    assert.strictEqual(ctx.body.children.length, 0);
    assert.strictEqual(ctx.toasts.length, 0);
});

// ----------------------------------------------------------------------------
// Single and multi-level warnings → one aggregated toast
// ----------------------------------------------------------------------------
console.log('\n  --- rendered cases ---');

test('warnings=[one] → section added with 1 row; exactly one warning toast', function () {
    const ctx = makeCtx();
    const render = makeRenderSyntheticRoomWarnings(ctx);
    render([{ levelName: 'L1', added: 2, expected: 2, actual: 0 }]);

    const section = ctx.document.getElementById('v2-synthetic-rooms-section');
    assert.ok(section, 'section must exist');
    assert.strictEqual(ctx.body.children[0], section, 'section must be first child of body');

    // One <tr> in the rendered HTML
    const trMatches = section.innerHTML.match(/<tr>/g) || [];
    assert.strictEqual(trMatches.length, 1);

    // One aggregated toast
    assert.strictEqual(ctx.toasts.length, 1);
    assert.strictEqual(ctx.toasts[0].type, 'warning');
    assert.ok(ctx.toasts[0].msg.indexOf('تم تكميل 2 قاعة افتراضية في 1 مستوى') >= 0,
        'toast text should carry N=2 and M=1 — got: ' + ctx.toasts[0].msg);
});

test('warnings=[two] → one section with 2 rows; exactly one toast with aggregated counts', function () {
    const ctx = makeCtx();
    const render = makeRenderSyntheticRoomWarnings(ctx);
    render([
        { levelName: 'L1', added: 2, expected: 2, actual: 0 },
        { levelName: 'L2', added: 1, expected: 3, actual: 2 }
    ]);

    const section = ctx.document.getElementById('v2-synthetic-rooms-section');
    assert.ok(section);
    const trMatches = section.innerHTML.match(/<tr>/g) || [];
    assert.strictEqual(trMatches.length, 2, 'two <tr> rows');

    assert.strictEqual(ctx.toasts.length, 1, 'exactly one toast — never per level');
    // totalAdded=3, levelsCount=2
    assert.ok(ctx.toasts[0].msg.indexOf('تم تكميل 3 قاعة افتراضية في 2 مستوى') >= 0,
        'aggregated counts missing — got: ' + ctx.toasts[0].msg);
});

test('double invocation with different warnings → stale section removed (no accumulation)', function () {
    const ctx = makeCtx();
    const render = makeRenderSyntheticRoomWarnings(ctx);
    render([{ levelName: 'L1', added: 2, expected: 2, actual: 0 }]);
    render([{ levelName: 'L2', added: 1, expected: 3, actual: 2 }]);

    // Only one section in the body
    const sectionNodes = ctx.body.children.filter(function (c) {
        return c.id === 'v2-synthetic-rooms-section';
    });
    assert.strictEqual(sectionNodes.length, 1, 'no duplicate section');

    // Current section carries the L2 data (one row)
    const section = sectionNodes[0];
    const trMatches = section.innerHTML.match(/<tr>/g) || [];
    assert.strictEqual(trMatches.length, 1);

    // Two toasts total (one per run) — but each run produced exactly one.
    assert.strictEqual(ctx.toasts.length, 2);
    assert.ok(ctx.toasts[1].msg.indexOf('تم تكميل 1 قاعة افتراضية في 1 مستوى') >= 0,
        'second toast reflects the second run — got: ' + ctx.toasts[1].msg);
});

test('second invocation with [] clears the stale section and emits no new toast', function () {
    const ctx = makeCtx();
    const render = makeRenderSyntheticRoomWarnings(ctx);
    render([{ levelName: 'L1', added: 2, expected: 2, actual: 0 }]);
    assert.strictEqual(ctx.body.children.length, 1);
    assert.strictEqual(ctx.toasts.length, 1);

    render([]);
    assert.strictEqual(ctx.body.children.length, 0, 'stale section removed');
    assert.strictEqual(ctx.toasts.length, 1, 'no new toast — empty run is silent');
});

test('totalAdded is the sum of added, ignoring non-numeric entries gracefully', function () {
    const ctx = makeCtx();
    const render = makeRenderSyntheticRoomWarnings(ctx);
    render([
        { levelName: 'L1', added: 2, expected: 2, actual: 0 },
        { levelName: 'L2', added: 'bad', expected: 3, actual: 2 }, // coerces to 0
        { levelName: 'L3', added: 4, expected: 5, actual: 1 }
    ]);
    assert.strictEqual(ctx.toasts.length, 1);
    // total = 2 + 0 + 4 = 6, levels = 3
    assert.ok(ctx.toasts[0].msg.indexOf('تم تكميل 6 قاعة افتراضية في 3 مستوى') >= 0,
        'bad totals — got: ' + ctx.toasts[0].msg);
});

test('level name with HTML is escaped in the rendered row', function () {
    const ctx = makeCtx();
    const render = makeRenderSyntheticRoomWarnings(ctx);
    render([{ levelName: '<script>x</script>', added: 1, expected: 1, actual: 0 }]);
    const section = ctx.document.getElementById('v2-synthetic-rooms-section');
    assert.ok(section.innerHTML.indexOf('&lt;script&gt;') >= 0, 'must escape <');
    assert.ok(section.innerHTML.indexOf('<script>x</script>') < 0, 'must not render raw tag');
});

test('Arabic level name survives round-trip verbatim in the rendered row', function () {
    const ctx = makeCtx();
    const render = makeRenderSyntheticRoomWarnings(ctx);
    const name = 'الأولى باكالوريا العلوم الرياضية - رسميون';
    render([{ levelName: name, added: 2, expected: 2, actual: 0 }]);
    const section = ctx.document.getElementById('v2-synthetic-rooms-section');
    assert.ok(section.innerHTML.indexOf(name) >= 0,
        'Arabic name should appear as-is (no HTML specials to escape)');
});

test('navigation button click records intent to open exams-rooms.html', function () {
    const ctx = makeCtx();
    const render = makeRenderSyntheticRoomWarnings(ctx);
    render([{ levelName: 'L1', added: 1, expected: 1, actual: 0 }]);
    const btn = ctx.document.getElementById('v2-goto-rooms-btn');
    assert.ok(btn, 'navigation button must exist');
    // Trigger the registered click listener.
    for (const fn of btn._listeners.click) fn();
    assert.strictEqual(ctx.navigatedTo, 'exams-rooms.html');
});

test('body visibility respects _diagPanelCollapsed', function () {
    const ctx = makeCtx();
    ctx._diagPanelCollapsed = true;
    const render = makeRenderSyntheticRoomWarnings(ctx);
    render([{ levelName: 'L1', added: 1, expected: 1, actual: 0 }]);
    assert.strictEqual(ctx.body.style.display, 'none',
        'body stays hidden when panel is collapsed');
});

// ----------------------------------------------------------------------------
// Defensive fallbacks
// ----------------------------------------------------------------------------
console.log('\n  --- defensive ---');

test('missing panel/body → silent no-op, no crash, no toast', function () {
    const ctx = {
        document: {
            getElementById: function () { return null; },
            createElement: function () { return createElementStub(null); }
        },
        showToast: function () { throw new Error('toast must not be called'); },
        _diagPanelCollapsed: false
    };
    const render = makeRenderSyntheticRoomWarnings(ctx);
    render([{ levelName: 'L1', added: 1, expected: 1, actual: 0 }]);
    // No assertion error == pass
});

runAll();
