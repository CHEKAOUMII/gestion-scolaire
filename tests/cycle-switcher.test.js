'use strict';

// Spec: docs/plans/2026-08-02-topbar-cycle-switcher.md
// Pure Node DOM harness for the top-bar stage switcher in js/sidebar.js
// (buildCycleSwitcherOptions + loadTopbarCycleSwitcher).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

const QUALIFIANT = { cycle_code: 'secondary_qualifiant', label_ar: 'التأهيلي', is_active: 1, capability: 'supported' };
const PRIMARY = { cycle_code: 'primary', label_ar: 'الابتدائي', is_active: 1, capability: 'preview' };
const COLLEGIAL = { cycle_code: 'secondary_collegial', label_ar: 'الإعدادي', is_active: 1, capability: 'preview' };
const INACTIVE = { cycle_code: 'secondary_qualifiant', label_ar: 'التأهيلي', is_active: 0, capability: 'supported' };

class ClassList {
    constructor(element) {
        this.element = element;
        this.set = new Set();
    }

    add(...names) {
        names.forEach((name) => this.set.add(name));
        this._sync();
    }

    remove(...names) {
        names.forEach((name) => this.set.delete(name));
        this._sync();
    }

    contains(name) {
        return this.set.has(name);
    }

    toggle(name, force) {
        const willAdd = force !== undefined ? force : !this.set.has(name);
        if (willAdd) this.set.add(name);
        else this.set.delete(name);
        this._sync();
        return willAdd;
    }

    _sync() {
        this.element._className = Array.from(this.set).join(' ');
    }
}

class Element {
    constructor(tagName) {
        this.tagName = String(tagName).toLowerCase();
        this.children = [];
        this.parentElement = null;
        this.attributes = {};
        this._className = '';
        this.classList = new ClassList(this);
        this.dataset = {};
        this.style = {};
        this.hidden = false;
        this.disabled = false;
        this.value = '';
        this.textContent = '';
        this.id = '';
        this.htmlFor = '';
        this.onchange = null;
        this.listeners = {};
    }

    set className(value) {
        this._className = value;
        this.classList.set = new Set(String(value || '').split(/\s+/).filter(Boolean));
    }

    get className() {
        return this._className;
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    }

    set innerHTML(value) {
        this.textContent = '';
        const textMatch = /^<i class="([^"]*)"><\/i><span>(.*?)<\/span>$/.exec(String(value || ''));
        if (textMatch) {
            this.attributes.class = textMatch[1];
            this.textContent = textMatch[2];
        }
    }

    get innerHTML() {
        return this.textContent ? `<span>${this.textContent}</span>` : '';
    }

    get options() {
        return this.children.filter((child) => child.tagName === 'option');
    }

    appendChild(child) {
        if (child.parentElement) child.parentElement.children = child.parentElement.children.filter((c) => c !== child);
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    prepend(child) {
        if (child.parentElement) child.parentElement.children = child.parentElement.children.filter((c) => c !== child);
        child.parentElement = this;
        this.children.unshift(child);
        return child;
    }

    replaceChildren(...children) {
        this.children.forEach((child) => {
            child.parentElement = null;
        });
        this.children = [];
        children.forEach((child) => this.appendChild(child));
    }

    addEventListener(name, fn) {
        (this.listeners[name] = this.listeners[name] || []).push(fn);
    }

    removeEventListener(name, fn) {
        this.listeners[name] = (this.listeners[name] || []).filter((listener) => listener !== fn);
    }

    _matches(selector) {
        if (selector === 'select') return this.tagName === 'select';
        if (selector.startsWith('#')) return this.id === selector.slice(1);
        if (selector.startsWith('.')) {
            const token = selector.slice(1);
            return this.classList.set.has(token) || (this.attributes.class || '').split(/\s+/).includes(token);
        }
        if (selector.startsWith('[data-unsaved-changes="true"]')) {
            return this.attributes['data-unsaved-changes'] === 'true';
        }
        if (selector.startsWith('[')) {
            const key = selector.slice(1, selector.indexOf(']'));
            return Object.prototype.hasOwnProperty.call(this.attributes, key);
        }
        return this.tagName === selector.toLowerCase();
    }

    querySelector(selector) {
        if (this._matches(selector)) return this;
        for (const child of this.children) {
            const found = child.querySelector(selector);
            if (found) return found;
        }
        return null;
    }

    querySelectorAll(selector) {
        const found = [];
        for (const child of this.children) {
            if (child._matches(selector)) found.push(child);
            found.push(...child.querySelectorAll(selector));
        }
        return found;
    }
}

class Option extends Element {
    constructor(text, value, defaultSelected, selected) {
        super('option');
        this.text = String(text || '');
        this.textContent = this.text;
        this.value = String(value || '');
        this.selected = Boolean(selected !== undefined ? selected : defaultSelected);
    }
}

class CustomEvent {
    constructor(type, options) {
        this.type = type;
        this.cancelable = Boolean(options?.cancelable);
        this.detail = options?.detail;
        this.defaultPrevented = false;
    }

    preventDefault() {
        if (this.cancelable) this.defaultPrevented = true;
    }
}

function createHarness() {
    const elements = [];
    const documentListeners = {};
    const windowListeners = {};

    const document = {
        readyState: 'loading',
        createElement(tag) {
            const element = new Element(tag);
            elements.push(element);
            return element;
        },
        addEventListener(name, fn) {
            (documentListeners[name] = documentListeners[name] || []).push(fn);
        },
        querySelector(selector) {
            for (const element of elements) {
                if (element._matches(selector)) return element;
            }
            return null;
        },
        querySelectorAll(selector) {
            return elements.filter((element) => element._matches(selector));
        },
        getElementById(id) {
            return elements.find((element) => element.id === id) || null;
        }
    };

    const window = {
        location: {
            reload() {
                window._reloadCount = (window._reloadCount || 0) + 1;
            }
        },
        addEventListener(name, fn) {
            (windowListeners[name] = windowListeners[name] || []).push(fn);
        },
        dispatchEvent(event) {
            for (const listener of windowListeners[event.type] || []) listener(event);
            return !event.defaultPrevented;
        }
    };
    window.document = document;

    const api = {
        cycles: {
            list: async () => ({ success: true, cycles: [QUALIFIANT] }),
            getActive: async () => ({
                success: true,
                context: { cycleCode: QUALIFIANT.cycle_code },
                cycle: { cycle_code: QUALIFIANT.cycle_code }
            }),
            setActive: async () => ({ success: true }),
            onConfigurationChanged(callback) {
                api.cycles._configurationCallback = callback;
            }
        }
    };
    window.api = api;

    const sandbox = {
        document,
        window,
        console,
        Option,
        CustomEvent,
        showToast(message, type) {
            sandbox._toasts = sandbox._toasts || [];
            sandbox._toasts.push({ message, type });
        },
        getSchoolYear() {
            return '2025/2026';
        }
    };
    sandbox.globalThis = sandbox.window;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/sidebar.js'), 'utf8'), sandbox, {
        filename: 'js/sidebar.js'
    });

    return { sandbox, window, document, api };
}

function makeHeaderRightFixture() {
    const harness = createHarness();
    const headerRight = harness.document.createElement('div');
    headerRight.className = 'header-right';
    return { harness, headerRight };
}

const cases = [];

function test(name, fn) {
    cases.push([name, fn]);
}

// ── Pure option builder ─────────────────────────────────────────────────────

test('buildCycleSwitcherOptions lists active stages; only supported ones are selectable', () => {
    const { sandbox } = createHarness();
    const build = sandbox.window.buildCycleSwitcherOptions;
    assert.strictEqual(typeof build, 'function', 'window.buildCycleSwitcherOptions is exported');
    const toTuples = (options) => options.map((option) => [option.value, option.label, option.selected, option.disabled]);
    assert.deepStrictEqual(
        toTuples(build([QUALIFIANT, PRIMARY, COLLEGIAL, INACTIVE], 'secondary_qualifiant')),
        [
            ['secondary_qualifiant', 'التأهيلي', true, false],
            ['primary', 'الابتدائي (قيد الإعداد)', false, true],
            ['secondary_collegial', 'الإعدادي (قيد الإعداد)', false, true]
        ],
        'active preview stages («قيد الإعداد») are visible but disabled; inactive rows never appear'
    );
    assert.deepStrictEqual(
        toTuples(build([PRIMARY, COLLEGIAL], 'primary')),
        [
            ['primary', 'الابتدائي (قيد الإعداد)', false, true],
            ['secondary_collegial', 'الإعدادي (قيد الإعداد)', false, true]
        ],
        'preview-only catalogs render every row disabled'
    );
    assert.deepStrictEqual(toTuples(build([QUALIFIANT], 'primary')), [['secondary_qualifiant', 'التأهيلي', false, false]]);
    assert.strictEqual(build([INACTIVE], 'secondary_qualifiant').length, 0, 'no active stage -> empty option list (dropdown hidden)');
    assert.strictEqual(build(null, 'secondary_qualifiant').length, 0, 'null catalog is tolerated');
    assert.strictEqual(
        build([{ cycle_code: 'x', is_active: 1, capability: 'supported' }], 'x')[0].label,
        'x',
        'label falls back to the cycle code'
    );
});

// ── Loader: injection + states ──────────────────────────────────────────────

test('injects the switcher into .header-right and marks one usable stage as a disabled indicator', async () => {
    const { harness, headerRight } = makeHeaderRightFixture();
    await harness.window.refreshCycleSwitcher();
    const wrapper = harness.document.getElementById('topbar-cycle-switcher');
    assert.ok(wrapper, 'wrapper is created');
    assert.strictEqual(headerRight.children[0], wrapper, 'wrapper is prepended to .header-right');
    assert.strictEqual(wrapper.hidden, false, 'one usable stage keeps the indicator visible');
    const select = wrapper.querySelector('select');
    assert.strictEqual(select.disabled, true, 'a single usable stage cannot be switched');
    assert.strictEqual(select.options.length, 1);
    assert.strictEqual(select.options[0].value, 'secondary_qualifiant');
    assert.strictEqual(select.options[0].selected, true, 'the session stage is the selected value');
});

test('preview-only stages remain visible in an openable dropdown', async () => {
    const { harness } = makeHeaderRightFixture();
    harness.api.cycles.list = async () => ({ success: true, cycles: [PRIMARY, COLLEGIAL] });
    await harness.window.refreshCycleSwitcher();
    const wrapper = harness.document.getElementById('topbar-cycle-switcher');
    assert.strictEqual(wrapper.hidden, false, 'preview-only catalogs keep the dropdown visible');
    const select = wrapper.querySelector('select');
    assert.strictEqual(select.disabled, false, 'multiple active stages keep the dropdown openable');
    assert.strictEqual(select.options.length, 2);
    assert.ok(
        select.options.every((option) => option.disabled),
        'every preview row is rendered disabled'
    );
});

test('active preview stages do not lock the dropdown when one supported stage exists', async () => {
    const { harness } = makeHeaderRightFixture();
    harness.api.cycles.list = async () => ({ success: true, cycles: [PRIMARY, COLLEGIAL, QUALIFIANT] });
    await harness.window.refreshCycleSwitcher();
    const select = harness.document.getElementById('topbar-cycle-switcher').querySelector('select');
    assert.strictEqual(select.disabled, false, 'the active-stage list remains openable');
    assert.deepStrictEqual(
        select.options.map((option) => [option.value, option.disabled, option.selected]),
        [
            ['primary', true, false],
            ['secondary_collegial', true, false],
            ['secondary_qualifiant', false, true]
        ]
    );
});

test('2+ usable stages become switchable with the active one selected', async () => {
    const { harness } = makeHeaderRightFixture();
    const second = { cycle_code: 'secondary_collegial', label_ar: 'الإعدادي', is_active: 1, capability: 'supported' };
    harness.api.cycles.list = async () => ({ success: true, cycles: [QUALIFIANT, second] });
    await harness.window.refreshCycleSwitcher();
    const select = harness.document.getElementById('topbar-cycle-switcher').querySelector('select');
    assert.strictEqual(select.disabled, false);
    assert.strictEqual(select.options.length, 2);
    assert.strictEqual(select.options[0].selected, true, 'session stage is pre-selected');
});

test('API failure hides the wrapper without throwing', async () => {
    const { harness } = makeHeaderRightFixture();
    harness.api.cycles.list = async () => ({ success: false });
    await harness.window.refreshCycleSwitcher();
    const wrapper = harness.document.getElementById('topbar-cycle-switcher');
    assert.strictEqual(wrapper.hidden, true);
});

test('pages without .header-right get no wrapper and no error', async () => {
    const harness = createHarness();
    await harness.window.refreshCycleSwitcher();
    assert.strictEqual(harness.document.getElementById('topbar-cycle-switcher'), null);
});

test('idempotent: re-running does not duplicate the wrapper', async () => {
    const { harness } = makeHeaderRightFixture();
    await harness.window.refreshCycleSwitcher();
    await harness.window.refreshCycleSwitcher();
    assert.strictEqual(harness.document.querySelectorAll('#topbar-cycle-switcher').length, 1);
});

// ── Dirty-page guard + switch flow ──────────────────────────────────────────

test('unsaved edits block the switch, revert the value and warn', async () => {
    const { harness } = makeHeaderRightFixture();
    const second = { cycle_code: 'secondary_collegial', label_ar: 'الإعدادي', is_active: 1, capability: 'supported' };
    harness.api.cycles.list = async () => ({ success: true, cycles: [QUALIFIANT, second] });
    await harness.window.refreshCycleSwitcher();
    const select = harness.document.getElementById('topbar-cycle-switcher').querySelector('select');
    const pending = harness.document.createElement('div');
    pending.setAttribute('data-unsaved-changes', 'true');
    select.value = 'secondary_collegial';
    await select.onchange();
    assert.strictEqual(select.value, 'secondary_qualifiant', 'value reverts to the previous stage');
    assert.strictEqual(harness.api.cycles.setActive.calls, undefined, 'setActive is never called');
    assert.strictEqual(harness.sandbox._toasts[0].type, 'warning');
});

test('a cancelable app:beforeCycleChange listener blocks the switch', async () => {
    const { harness } = makeHeaderRightFixture();
    const second = { cycle_code: 'secondary_collegial', label_ar: 'الإعدادي', is_active: 1, capability: 'supported' };
    harness.api.cycles.list = async () => ({ success: true, cycles: [QUALIFIANT, second] });
    await harness.window.refreshCycleSwitcher();
    const select = harness.document.getElementById('topbar-cycle-switcher').querySelector('select');
    harness.window.addEventListener('app:beforeCycleChange', (event) => event.preventDefault());
    select.value = 'secondary_collegial';
    await select.onchange();
    assert.strictEqual(select.value, 'secondary_qualifiant');
    assert.strictEqual(harness.api.cycles.setActive.calls, undefined);
});

test('allowed switch calls setActive with the stage and school year, then reloads', async () => {
    const { harness } = makeHeaderRightFixture();
    const second = { cycle_code: 'secondary_collegial', label_ar: 'الإعدادي', is_active: 1, capability: 'supported' };
    harness.api.cycles.list = async () => ({ success: true, cycles: [QUALIFIANT, second] });
    const calls = [];
    harness.api.cycles.setActive = async (cycleCode, schoolYear) => {
        calls.push([cycleCode, schoolYear]);
        return { success: true };
    };
    await harness.window.refreshCycleSwitcher();
    const select = harness.document.getElementById('topbar-cycle-switcher').querySelector('select');
    select.value = 'secondary_collegial';
    await select.onchange();
    assert.deepStrictEqual(calls, [['secondary_collegial', '2025/2026']]);
    assert.strictEqual(harness.window._reloadCount, 1, 'page reloads after a successful switch');
});

test('a failed setActive reverts the value and toasts the error', async () => {
    const { harness } = makeHeaderRightFixture();
    const second = { cycle_code: 'secondary_collegial', label_ar: 'الإعدادي', is_active: 1, capability: 'supported' };
    harness.api.cycles.list = async () => ({ success: true, cycles: [QUALIFIANT, second] });
    harness.api.cycles.setActive = async () => ({ success: false, error: 'تعذر تبديل السلك' });
    await harness.window.refreshCycleSwitcher();
    const select = harness.document.getElementById('topbar-cycle-switcher').querySelector('select');
    select.value = 'secondary_collegial';
    await select.onchange();
    assert.strictEqual(select.value, 'secondary_qualifiant', 'value reverts on failure');
    assert.strictEqual(harness.sandbox._toasts[0].type, 'error');
    assert.strictEqual(harness.window._reloadCount, undefined, 'no reload on failure');
});

// ── Wiring ──────────────────────────────────────────────────────────────────

test('onConfigurationChanged is subscribed to the top-bar loader at module level', () => {
    const { api } = createHarness();
    assert.strictEqual(typeof api.cycles._configurationCallback, 'function');
    assert.strictEqual(api.cycles._configurationCallback.name, 'loadTopbarCycleSwitcher');
});

test('refreshCycleSwitcher and loadTopbarCycleSwitcher point to the same loader', () => {
    const { sandbox } = createHarness();
    assert.strictEqual(sandbox.window.refreshCycleSwitcher, sandbox.window.loadTopbarCycleSwitcher);
});

// ── Runner ──────────────────────────────────────────────────────────────────

async function main() {
    for (const [name, fn] of cases) {
        await fn();
        console.log(`[cycle-switcher] ${name}: PASS`);
    }
    console.log('cycle-switcher.test.js: OK');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
