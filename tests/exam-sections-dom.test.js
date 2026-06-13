'use strict';

// Spec: .kiro/specs/exam-center-redesign/
// Tasks 1.5, 3.3, 4.3, 5.3, 7.1, 7.2, 7.4
// Pure Node DOM harness for js/exam-sections.js.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

class ClassList {
    constructor(element) {
        this.element = element;
        this.set = new Set();
    }

    _syncFromString(value) {
        this.set = new Set(
            String(value || '')
                .split(/\s+/)
                .filter(Boolean)
        );
    }

    _syncToElement() {
        this.element._className = Array.from(this.set).join(' ');
        if (this.element._className) this.element.attributes.class = this.element._className;
        else delete this.element.attributes.class;
    }

    add(...names) {
        names.forEach((name) => this.set.add(name));
        this._syncToElement();
    }

    remove(...names) {
        names.forEach((name) => this.set.delete(name));
        this._syncToElement();
    }

    contains(name) {
        return this.set.has(name);
    }

    toggle(name, force) {
        const shouldAdd = force === undefined ? !this.set.has(name) : Boolean(force);
        if (shouldAdd) this.set.add(name);
        else this.set.delete(name);
        this._syncToElement();
        return shouldAdd;
    }
}

class Element {
    constructor(tagName, ownerDocument) {
        this.tagName = String(tagName || '').toUpperCase();
        this.ownerDocument = ownerDocument;
        this.attributes = Object.create(null);
        this.dataset = Object.create(null);
        this.childNodes = [];
        this.parentNode = null;
        this.eventListeners = Object.create(null);
        this.style = {
            values: Object.create(null),
            setProperty: (key, value) => {
                this.style.values[key] = value;
            }
        };
        this.hidden = false;
        this.disabled = false;
        this._innerHTML = '';
        this._textContent = '';
        this._className = '';
        this.classList = new ClassList(this);

        Object.defineProperty(this, 'className', {
            get: () => this._className,
            set: (value) => {
                this._className = String(value || '');
                this.attributes.class = this._className;
                this.classList._syncFromString(this._className);
            }
        });

        Object.defineProperty(this, 'id', {
            get: () => this.attributes.id || '',
            set: (value) => {
                if (value === undefined || value === null || value === '') delete this.attributes.id;
                else this.attributes.id = String(value);
            }
        });
    }

    get children() {
        return this.childNodes.filter((node) => node instanceof Element);
    }

    get parentElement() {
        return this.parentNode instanceof Element ? this.parentNode : null;
    }

    set innerHTML(value) {
        this._innerHTML = String(value || '');
        this.childNodes = [];
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set textContent(value) {
        this._textContent = String(value || '');
        this.childNodes = [];
    }

    get textContent() {
        return this._textContent;
    }

    setAttribute(name, value) {
        const stringValue = String(value);
        this.attributes[name] = stringValue;
        if (name === 'class') {
            this._className = stringValue;
            this.classList._syncFromString(stringValue);
        } else if (name === 'id') {
            this.attributes.id = stringValue;
        } else if (name.startsWith('data-')) {
            this.dataset[dataNameToProp(name.slice(5))] = stringValue;
        } else if (name === 'hidden') {
            this.hidden = true;
        }
    }

    getAttribute(name) {
        if (name === 'class') return this.className || null;
        return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    }

    hasAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name);
    }

    removeAttribute(name) {
        delete this.attributes[name];
        if (name === 'hidden') this.hidden = false;
    }

    appendChild(child) {
        if (child.parentNode) {
            child.parentNode.childNodes = child.parentNode.childNodes.filter((node) => node !== child);
        }
        child.parentNode = this;
        this.childNodes.push(child);
        return child;
    }

    append(...nodes) {
        nodes.forEach((node) => this.appendChild(node));
    }

    addEventListener(type, handler) {
        if (!this.eventListeners[type]) this.eventListeners[type] = [];
        this.eventListeners[type].push(handler);
    }

    dispatchEvent(event) {
        event.target = event.target || this;
        event.currentTarget = this;
        const handlers = this.eventListeners[event.type] || [];
        handlers.forEach((handler) => handler.call(this, event));
        return !event.defaultPrevented;
    }

    click() {
        this.dispatchEvent(makeEvent('click'));
    }

    focus() {
        this.ownerDocument.activeElement = this;
    }

    closest(selector) {
        if (selector === '[hidden]') {
            let current = this;
            while (current) {
                if (current.hidden || current.hasAttribute('hidden')) return current;
                current = current.parentElement;
            }
            return null;
        }
        let current = this;
        while (current) {
            if (matchesSelector(current, selector)) return current;
            current = current.parentElement;
        }
        return null;
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
        const out = [];
        walk(this, (node) => {
            if (node !== this && matchesSelector(node, selector)) out.push(node);
        });
        return out;
    }
}

class Document {
    constructor() {
        this.body = new Element('body', this);
        this.activeElement = null;
    }

    createElement(tagName) {
        return new Element(tagName, this);
    }

    getElementById(id) {
        let found = null;
        walk(this.body, (node) => {
            if (!found && node.id === id) found = node;
        });
        return found;
    }

    querySelector(selector) {
        return this.body.querySelector(selector);
    }

    querySelectorAll(selector) {
        return this.body.querySelectorAll(selector);
    }
}

function dataNameToProp(name) {
    return name.replace(/-([a-z])/g, (_, chr) => chr.toUpperCase());
}

function walk(node, visitor) {
    if (!(node instanceof Element)) return;
    visitor(node);
    node.children.forEach((child) => walk(child, visitor));
}

function matchesSelector(element, selector) {
    if (!(element instanceof Element)) return false;
    const selectors = selector
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    if (selectors.length > 1) return selectors.some((part) => matchesSelector(element, part));

    const idMatch = selector.match(/^#([\w-]+)$/);
    if (idMatch) return element.id === idMatch[1];

    const classAttrMatch = selector.match(/^\.([\w-]+)\[([\w-]+)(?:="([^"]*)")?\]$/);
    if (classAttrMatch) {
        const [, className, attrName, expected] = classAttrMatch;
        if (!element.classList.contains(className)) return false;
        if (!element.hasAttribute(attrName)) return false;
        return expected === undefined || element.getAttribute(attrName) === expected;
    }

    const attrMatch = selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
    if (attrMatch) {
        const [, attrName, expected] = attrMatch;
        if (!element.hasAttribute(attrName)) return false;
        return expected === undefined || element.getAttribute(attrName) === expected;
    }

    const classMatch = selector.match(/^\.([\w-]+)$/);
    if (classMatch) return element.classList.contains(classMatch[1]);

    return element.tagName.toLowerCase() === selector.toLowerCase();
}

function makeEvent(type, props) {
    return Object.assign(
        {
            type,
            defaultPrevented: false,
            preventDefault() {
                this.defaultPrevented = true;
            }
        },
        props || {}
    );
}

function createElement(document, tagName, attrs) {
    const element = document.createElement(tagName);
    Object.entries(attrs || {}).forEach(([key, value]) => {
        if (key === 'class') element.className = value;
        else if (key === 'dataset') Object.assign(element.dataset, value);
        else element.setAttribute(key, value);
    });
    return element;
}

function buildFixture() {
    const document = new Document();
    const root = createElement(document, 'div', { class: 'exam-tabs-header', role: 'tablist' });
    document.body.appendChild(root);

    const tabs = [
        createTab(document, 'add-exam', { id: 'existing-add', controls: 'existing-panel-add', active: true }),
        createTab(document, 'branches'),
        createTab(document, 'rooms')
    ];

    const closeButton = createElement(document, 'button', { id: 'epm-close', class: 'epm-tab-close' });
    tabs.forEach((tab) => root.appendChild(tab));
    root.appendChild(closeButton);

    const panels = [
        createElement(document, 'div', {
            id: 'existing-panel-add',
            role: 'tabpanel',
            'aria-labelledby': 'custom-label'
        }),
        createElement(document, 'div', { id: 'panel-branches' }),
        createElement(document, 'div', { id: 'panel-rooms' })
    ];
    panels.forEach((panel) => document.body.appendChild(panel));

    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            tabs.forEach((item) => {
                item.classList.remove('active');
                item.setAttribute('aria-selected', 'false');
            });
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
        });
    });

    return { document, root, tabs, panels, closeButton };
}

function createTab(document, key, options) {
    const opts = options || {};
    const tab = createElement(document, 'button', { class: 'exam-tab-btn' });
    tab.dataset.tab = key;
    tab.setAttribute('data-tab', key);
    if (opts.id) tab.id = opts.id;
    if (opts.controls) tab.setAttribute('aria-controls', opts.controls);
    if (opts.active) {
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
    }
    return tab;
}

function loadExamSections(document) {
    const src = fs.readFileSync(path.join(ROOT, 'js/exam-sections.js'), 'utf8');
    const sandbox = {
        document,
        console,
        window: {
            setTimeout(fn) {
                fn();
                return 1;
            }
        }
    };
    sandbox.window.document = document;
    sandbox.globalThis = sandbox.window;
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: 'js/exam-sections.js' });
    return sandbox.window.ExamSections;
}

const fixture = buildFixture();
const ExamSections = loadExamSections(fixture.document);

assert.ok(ExamSections, 'window.ExamSections should be exported');
assert.deepStrictEqual(Object.keys(ExamSections.registry).sort(), ['inputs', 'production', 'settings']);
assert.strictEqual(ExamSections.registry.inputs.icon, 'fa-keyboard');
assert.strictEqual(ExamSections.registry.settings.icon, 'fa-sliders');
assert.strictEqual(ExamSections.registry.production.icon, 'fa-print');
assert.notStrictEqual(ExamSections.registry.inputs.colorVar, ExamSections.registry.settings.colorVar);
assert.notStrictEqual(ExamSections.registry.settings.colorVar, ExamSections.registry.production.colorVar);

ExamSections.init({
    order: ['settings', 'inputs', 'production'],
    tabSelector: '.exam-tab-btn',
    tablistSelector: '.exam-tabs-header',
    ensureAria: true,
    map: {
        'add-exam': 'settings',
        branches: 'inputs',
        rooms: 'inputs'
    }
});

assert.strictEqual(fixture.root.dataset.examSectionsInitialized, 'true', 'init should mark the tablist as initialized');
assert.strictEqual(
    fixture.root.getAttribute('role'),
    'group',
    'root role should become group once per-section tablists exist'
);
assert.strictEqual(fixture.document.querySelectorAll('.exam-section-nav').length, 1, 'should create one section nav');
assert.strictEqual(
    fixture.document.querySelectorAll('.exam-section-group').length,
    3,
    'should create groups following cfg.order'
);
assert.deepStrictEqual(
    fixture.document.querySelectorAll('.exam-section-group').map((group) => group.dataset.section),
    ['settings', 'inputs', 'production'],
    'groups should respect cfg.order'
);

const productionGroup = fixture.document.querySelectorAll('.exam-section-group')[2];
const productionButton = fixture.document.querySelectorAll('.exam-section-nav-btn')[2];
assert.strictEqual(productionGroup.hidden, true, 'empty production section should be hidden');
assert.strictEqual(productionButton.hidden, true, 'empty production nav button should be hidden');

assert.strictEqual(fixture.tabs[0].id, 'existing-add', 'ensureAria must not overwrite an existing id');
assert.strictEqual(
    fixture.tabs[0].getAttribute('aria-controls'),
    'existing-panel-add',
    'ensureAria must not overwrite controls'
);
assert.strictEqual(
    fixture.panels[0].getAttribute('aria-labelledby'),
    'custom-label',
    'ensureAria must not overwrite labelledby'
);
assert.strictEqual(fixture.tabs[1].id, 'tab-btn-branches', 'ensureAria should add stable ids to missing tabs');
assert.strictEqual(fixture.tabs[1].getAttribute('role'), 'tab', 'ensureAria should add role=tab');
assert.strictEqual(fixture.tabs[1].getAttribute('aria-controls'), 'panel-branches');
assert.strictEqual(fixture.panels[1].getAttribute('role'), 'tabpanel');
assert.strictEqual(fixture.panels[1].getAttribute('aria-labelledby'), 'tab-btn-branches');

const settingsTabs = fixture.document.querySelectorAll('.exam-section-tabs')[0];
const inputsTabs = fixture.document.querySelectorAll('.exam-section-tabs')[1];
const actions = fixture.document.querySelector('.exam-section-actions');
assert.strictEqual(settingsTabs.children[0], fixture.tabs[0], 'tabs should be reparented without cloning');
assert.strictEqual(inputsTabs.children[0], fixture.tabs[1], 'first input tab should be branches');
assert.strictEqual(inputsTabs.children[1], fixture.tabs[2], 'second input tab should be rooms');
assert.ok(
    actions.children.includes(fixture.closeButton),
    'unmapped existing controls should be preserved in actions area'
);

assert.strictEqual(ExamSections.getActiveSection(), 'settings', 'active section should follow initial active tab');
assert.strictEqual(fixture.document.querySelectorAll('.exam-section-nav-btn')[0].getAttribute('aria-current'), 'true');

fixture.tabs[1].click();
assert.strictEqual(ExamSections.getActiveSection(), 'inputs', 'clicking an input tab should sync active section');
assert.strictEqual(fixture.document.querySelectorAll('.exam-section-nav-btn')[1].getAttribute('aria-current'), 'true');

fixture.tabs[0].click();
fixture.document.querySelectorAll('.exam-section-nav-btn')[1].click();
assert.strictEqual(
    fixture.tabs[1].classList.contains('active'),
    true,
    'section nav should activate first tab in the section via click()'
);
assert.strictEqual(ExamSections.getActiveSection(), 'inputs');

fixture.tabs[1].dispatchEvent(makeEvent('keydown', { key: 'ArrowLeft' }));
assert.strictEqual(fixture.document.activeElement, fixture.tabs[2], 'RTL ArrowLeft should move to next tab');
assert.strictEqual(fixture.tabs[2].getAttribute('tabindex'), '0');
fixture.tabs[2].dispatchEvent(makeEvent('keydown', { key: 'ArrowRight' }));
assert.strictEqual(fixture.document.activeElement, fixture.tabs[1], 'RTL ArrowRight should move to previous tab');
fixture.tabs[1].dispatchEvent(makeEvent('keydown', { key: 'End' }));
assert.strictEqual(fixture.document.activeElement, fixture.tabs[2], 'End should focus the last mapped visible tab');
fixture.tabs[2].dispatchEvent(makeEvent('keydown', { key: 'Home' }));
assert.strictEqual(fixture.document.activeElement, fixture.tabs[0], 'Home should focus the first mapped visible tab');
fixture.tabs[0].dispatchEvent(makeEvent('keydown', { key: ' ' }));
assert.strictEqual(fixture.tabs[0].classList.contains('active'), true, 'Space should activate the focused tab');

ExamSections.init({
    order: ['settings', 'inputs', 'production'],
    tabSelector: '.exam-tab-btn',
    tablistSelector: '.exam-tabs-header',
    ensureAria: true,
    map: {
        'add-exam': 'settings',
        branches: 'inputs',
        rooms: 'inputs'
    }
});
assert.strictEqual(fixture.document.querySelectorAll('.exam-section-nav').length, 1, 'init must be idempotent');
assert.strictEqual(
    fixture.document.querySelectorAll('.exam-section-group').length,
    3,
    'idempotent init must not duplicate groups'
);

console.log('exam-sections-dom.test.js passed');
