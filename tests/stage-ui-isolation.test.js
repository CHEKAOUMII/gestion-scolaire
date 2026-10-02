'use strict';

/**
 * Stage UI isolation tests (Slice 4: UI/workflow isolation).
 *
 *   node tests/stage-ui-isolation.test.js
 *
 * Covers the renderer slice of
 * docs/plans/2026-09-27-isolation-principle-stage-separation(1).md:
 *   1. Top-bar switcher (js/sidebar.js) invalidates the cc-rules.js stage-rule
 *      cache on a successful stage switch — defensively, since
 *      clearStageRuleSetCache() is owned by Slice 2 (js/cc-rules.js) and also
 *      resets the in-flight load promise (see tests/cc-rules-stage-cache.test.js).
 *   2. Exams schedule (exams-schedule.html) renders exam formats only for their
 *      stage: per-stage optgroups filtered by the resolved active cycle, with
 *      fail-closed behavior on catalog errors.
 *   3. Student profile (js/pages/student-profile.js) stream/track guidance is
 *      qualifiant-only; known non-qualifiant stages get an explicit notice.
 *   4. Stage rules editor (js/pages/settings-defaults.js) renders only the
 *      selected stage's rows and refuses authoritative saves without a stage.
 *   5. Student profile (js/pages/student-profile.js) track-selection field is
 *      qualifiant-only; known non-qualifiant stages get a disabled field with
 *      an explicit notice (saved values preserved, stale restores blocked).
 *
 * Level-routing ADR (plan decision gate 2): this slice KEEPS the
 * docs/plans/2026-08-03-collegial-level-normalization.md mechanism (official
 * level names via appDefaults:listLevels + classes:getAll); grading-pipeline
 * derivation is Slice 2's. No route-by-active-cycle display routing is added.
 * (Same note lives in code at js/pages/settings-defaults.js stageLevelLabel.)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const { COLLEGIAL_CYCLE, QUALIFIANT_CYCLE } = require('../js/shared/education/cycles');

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const QUALIFIANT_ROW = {
    cycle_code: QUALIFIANT_CYCLE,
    label_ar: 'التأهيلي',
    is_active: 1,
    capability: 'supported'
};
const COLLEGIAL_ROW = {
    cycle_code: COLLEGIAL_CYCLE,
    label_ar: 'الإعدادي',
    is_active: 1,
    capability: 'supported'
};

// ─── Minimal DOM harness (same pattern as tests/cycle-switcher.test.js) ───

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

    removeAttribute(name) {
        delete this.attributes[name];
    }

    remove() {
        if (this.parentElement) {
            this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
            this.parentElement = null;
        }
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

function createSidebarHarness() {
    const elements = [];
    const documentListeners = {};
    const windowListeners = {};
    const events = [];

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
                events.push('reload');
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
            list: async () => ({ success: true, cycles: [QUALIFIANT_ROW, COLLEGIAL_ROW] }),
            getActive: async () => ({
                success: true,
                context: { cycleCode: QUALIFIANT_CYCLE },
                cycle: { cycle_code: QUALIFIANT_CYCLE }
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
    vm.runInContext(read('js/sidebar.js'), sandbox, { filename: 'js/sidebar.js' });

    return { sandbox, window, document, api, events };
}

async function switcherSelect(harness) {
    const headerRight = harness.document.createElement('div');
    headerRight.className = 'header-right';
    await harness.window.refreshCycleSwitcher();
    const select = harness.document.getElementById('topbar-cycle-switcher').querySelector('select');
    assert.strictEqual(select.disabled, false, 'two supported stages are switchable');
    return select;
}

// ─── Part 1: switcher cache invalidation ───

async function part1SwitcherCache() {
    console.log('[test] 1. switcher invalidates the stage-rule cache on switch');

    {
        const harness = createSidebarHarness();
        harness.sandbox.clearStageRuleSetCache = () => harness.events.push('clear');
        const select = await switcherSelect(harness);
        select.value = COLLEGIAL_CYCLE;
        await select.onchange();
        assert.deepStrictEqual(harness.events, ['clear', 'reload'], 'cache cleared before reload');
        console.log('  [ok] successful switch calls clearStageRuleSetCache() then reloads');
    }

    {
        const harness = createSidebarHarness();
        assert.strictEqual(harness.sandbox.clearStageRuleSetCache, undefined);
        const select = await switcherSelect(harness);
        select.value = COLLEGIAL_CYCLE;
        await select.onchange();
        assert.deepStrictEqual(harness.events, ['reload'], 'reload still happens without the helper');
        console.log('  [ok] missing helper (pre-Slice-2 page) still reloads without throwing');
    }

    {
        const harness = createSidebarHarness();
        harness.sandbox.clearStageRuleSetCache = () => {
            harness.events.push('clear-attempt');
            throw new Error('cache boom');
        };
        const select = await switcherSelect(harness);
        select.value = COLLEGIAL_CYCLE;
        await select.onchange();
        assert.deepStrictEqual(harness.events, ['clear-attempt', 'reload'], 'throwing helper never blocks reload');
        console.log('  [ok] throwing helper is swallowed; reload is the barrier');
    }

    {
        const harness = createSidebarHarness();
        harness.sandbox.clearStageRuleSetCache = () => harness.events.push('clear');
        const select = await switcherSelect(harness);
        const pending = harness.document.createElement('div');
        pending.setAttribute('data-unsaved-changes', 'true');
        select.value = COLLEGIAL_CYCLE;
        await select.onchange();
        assert.deepStrictEqual(harness.events, [], 'blocked switch touches neither cache nor reload');
        assert.strictEqual(select.value, QUALIFIANT_CYCLE, 'value reverts to the previous stage');
        console.log('  [ok] dirty-page guard blocks the switch without invalidating the cache');
    }

    const sidebarSource = read('js/sidebar.js');
    assert.ok(
        sidebarSource.includes('typeof clearStageRuleSetCache'),
        'switch path guards the sibling-owned helper with typeof'
    );
    assert.ok(
        !sidebarSource.includes('stageRuleSetCache =') && !sidebarSource.includes('stageRuleSetLoadPromise ='),
        'sidebar never writes the sibling-owned cache bindings directly'
    );
    console.log('  [ok] sidebar keeps the defensive contract (no direct cache writes)');
}

// ─── Part 2: exams-schedule stage-only formats ───

function loadExamStageScript(sandbox) {
    const html = read('exams-schedule.html');
    const blocks = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g)).map((m) => m[1]);
    assert.strictEqual(blocks.length, 1, 'exactly one inline script block in exams-schedule.html');
    vm.createContext(sandbox);
    vm.runInContext(blocks[0], sandbox, { filename: 'exams-schedule-inline.js' });
    return sandbox;
}

function fakeOptgroup(stage) {
    return {
        dataset: stage ? { stage } : {},
        removed: false,
        remove() {
            this.removed = true;
        }
    };
}

async function part2ExamFormats() {
    console.log('[test] 2. exams schedule renders formats only for their stage');

    {
        const sandbox = loadExamStageScript({ window: {}, document: { addEventListener() {} }, console });
        const filter = sandbox.window.filterExamOptgroupsByStage;
        assert.strictEqual(typeof filter, 'function', 'pure stage filter is exported for tests');
        const groups = [{ stage: COLLEGIAL_CYCLE }, { stage: QUALIFIANT_CYCLE }, { stage: 'primary' }];
        const supported = [COLLEGIAL_CYCLE, QUALIFIANT_CYCLE];

        assert.deepStrictEqual(
            filter(groups, { activeCycleCode: COLLEGIAL_CYCLE, supportedCodes: supported }).map((g) => g.stage),
            [COLLEGIAL_CYCLE],
            'collegial active: collegial formats only'
        );
        assert.deepStrictEqual(
            filter(groups, { activeCycleCode: QUALIFIANT_CYCLE, supportedCodes: supported }).map((g) => g.stage),
            [QUALIFIANT_CYCLE],
            'qualifiant active: qualifiant formats only'
        );
        assert.deepStrictEqual(
            filter(groups, { activeCycleCode: null, supportedCodes: supported }).map((g) => g.stage),
            [COLLEGIAL_CYCLE, QUALIFIANT_CYCLE],
            'unknown active stage degrades to catalog-driven display'
        );
        assert.deepStrictEqual(
            filter([{ stage: null }], { activeCycleCode: COLLEGIAL_CYCLE, supportedCodes: supported }),
            [{ stage: null }],
            'unmarked group without SSOT keeps the legacy behavior'
        );
        assert.deepStrictEqual(
            filter(groups, { activeCycleCode: 'primary', supportedCodes: supported }),
            [],
            'a preview stage never renders, even when it is the active one'
        );
        console.log('  [ok] pure stage filter keeps only the active supported stage');
    }

    {
        const collegial = fakeOptgroup(COLLEGIAL_CYCLE);
        const primary = fakeOptgroup('primary');
        const bac1 = fakeOptgroup(null);
        const bac2 = fakeOptgroup(null);
        const optgroups = [primary, collegial, bac1, bac2];
        let domReady = null;
        const sandbox = {
            window: {
                EducationCycles: { QUALIFIANT_CYCLE },
                api: {
                    cycles: {
                        getCatalog: async () => ({
                            success: true,
                            cycles: [QUALIFIANT_ROW, COLLEGIAL_ROW]
                        }),
                        getActive: async () => ({
                            success: true,
                            context: { cycleCode: COLLEGIAL_CYCLE },
                            cycle: { cycle_code: COLLEGIAL_CYCLE }
                        })
                    }
                }
            },
            document: {
                addEventListener(name, fn) {
                    if (name === 'DOMContentLoaded') domReady = fn;
                },
                getElementById(id) {
                    if (id !== 'level-select') return null;
                    return { querySelectorAll: (sel) => (sel === 'optgroup' ? optgroups : []) };
                }
            },
            console
        };
        loadExamStageScript(sandbox);
        assert.strictEqual(typeof domReady, 'function', 'DOMContentLoaded wiring is registered');
        await domReady();
        assert.strictEqual(collegial.removed, false, 'collegial group stays for the collegial stage');
        assert.strictEqual(primary.removed, true, 'primary group is removed (preview, not workable)');
        assert.strictEqual(bac1.removed && bac2.removed, true, 'baccalaureate groups are qualifiant-only');
        console.log('  [ok] collegial session keeps only the collegial optgroup');
    }

    {
        const collegial = fakeOptgroup(COLLEGIAL_CYCLE);
        const bac = fakeOptgroup(null);
        const optgroups = [collegial, bac];
        let domReady = null;
        const sandbox = {
            window: {
                EducationCycles: { QUALIFIANT_CYCLE },
                api: { cycles: { getCatalog: async () => { throw new Error('catalog down'); } } }
            },
            document: {
                addEventListener(name, fn) {
                    if (name === 'DOMContentLoaded') domReady = fn;
                },
                getElementById: () => ({ querySelectorAll: () => optgroups })
            },
            console
        };
        loadExamStageScript(sandbox);
        await domReady();
        assert.strictEqual(collegial.removed, true, 'catalog error removes marked groups (fail closed)');
        assert.strictEqual(bac.removed, false, 'legacy unmarked groups keep the page usable');
        console.log('  [ok] catalog failure fails closed to the legacy qualifiant page');
    }

    const html = read('exams-schedule.html');
    assert.ok(html.includes('id="collegial-exam-optgroup"'), 'collegial optgroup exists');
    assert.ok(html.includes('id="primary-exam-optgroup"'), 'primary optgroup exists');
    assert.ok(html.includes('data-stage="secondary_collegial"'), 'collegial group is stage-marked');
    assert.ok(!html.includes('non-qualifiant-exam-optgroup'), 'combined legacy group id is gone');
    assert.ok(
        html.includes('<script src="js/shared/education/cycles.js"'),
        'EducationCycles SSOT is loaded for stage constants'
    );
    assert.ok(
        !html.includes('secondary_qualifiant"') && !html.includes("'secondary_qualifiant'"),
        'no new secondary_qualifiant literals in the page'
    );
    console.log('  [ok] page markup splits formats per stage without new literals');
}

// ─── Part 3: profile guidance is qualifiant-only ───

function loadStudentProfile() {
    const sandbox = {
        console,
        getSchoolYear: () => '2025/2026',
        // getElementById returns truthy so the top-level style-injection IIFE
        // short-circuits (its DOM output is not under test here).
        document: { readyState: 'loading', addEventListener() {}, getElementById: () => ({}) },
        window: {}
    };
    vm.createContext(sandbox);
    vm.runInContext(read('js/pages/student-profile.js'), sandbox, { filename: 'js/pages/student-profile.js' });
    return sandbox;
}

function part3GuidanceGate() {
    console.log('[test] 3. stream guidance renders only for the qualifiant stage');

    const sandbox = loadStudentProfile();
    assert.strictEqual(typeof sandbox.isQualifiantStage, 'function', 'stage helper is a page global');
    sandbox.EducationCycles = { QUALIFIANT_CYCLE };
    assert.strictEqual(sandbox.isQualifiantStage(QUALIFIANT_CYCLE), true, 'qualifiant stage detected');
    assert.strictEqual(sandbox.isQualifiantStage(COLLEGIAL_CYCLE), false, 'collegial stage detected');
    assert.strictEqual(sandbox.isQualifiantStage(null), null, 'unknown stage keeps legacy behavior');
    assert.strictEqual(sandbox.isQualifiantStage(''), null, 'empty stage keeps legacy behavior');
    delete sandbox.EducationCycles;
    assert.strictEqual(sandbox.isQualifiantStage(QUALIFIANT_CYCLE), null, 'missing SSOT keeps legacy behavior');
    console.log('  [ok] isQualifiantStage() resolves via the SSOT with a null fallback');

    const source = read('js/pages/student-profile.js');
    assert.ok(
        source.includes('isQualifiantStage(activeCycleCode) === false'),
        'guidance analysis is gated on a known non-qualifiant stage'
    );
    assert.ok(
        source.includes('التوجيه حسب الشعب خاص بالسلك التأهيلي'),
        'non-qualifiant stages get an explicit notice'
    );
    assert.ok(!source.includes('secondary_qualifiant'), 'no cycle-code literals in the profile page');
    const proto = read('student-profile-prototype.html');
    assert.ok(
        proto.includes('<script src="js/shared/education/cycles.js"'),
        'profile page loads the EducationCycles SSOT'
    );
    console.log('  [ok] guidance gate ships with an explicit notice and no new literals');
}

// ─── Part 4: rules editor renders only the selected stage ───

function loadSettingsDefaults() {
    const sandbox = {
        console,
        document: { readyState: 'loading', addEventListener() {} },
        window: {}
    };
    vm.createContext(sandbox);
    vm.runInContext(read('js/pages/settings-defaults.js'), sandbox, { filename: 'js/pages/settings-defaults.js' });
    return sandbox;
}

function part4RulesEditor() {
    console.log('[test] 4. rules editor is scoped to the selected stage');

    const sandbox = loadSettingsDefaults();
    const filter = sandbox.window.filterStageRowsByCycle;
    assert.strictEqual(typeof filter, 'function', 'pure stage filter is exported for tests');
    const rows = [{ cycle_code: QUALIFIANT_CYCLE }, { cycle_code: COLLEGIAL_CYCLE }, { cycle_code: QUALIFIANT_CYCLE }];
    assert.deepStrictEqual(filter(rows, QUALIFIANT_CYCLE), [rows[0], rows[2]], 'only the selected stage rows render');
    assert.deepStrictEqual(filter(rows, COLLEGIAL_CYCLE), [rows[1]], 'collegial selection renders collegial rows');
    assert.strictEqual(filter(rows, null), rows, 'null cycle keeps the legacy unfiltered rendering');
    // Re-wrap vm-realm arrays before deep comparison (prototypes differ across realms).
    assert.deepStrictEqual([...filter(null, QUALIFIANT_CYCLE)], [], 'non-array input yields no rows');
    assert.deepStrictEqual(
        [...filter([{ cycle_code: null }, null], QUALIFIANT_CYCLE)],
        [],
        'rows without a stage never match'
    );
    console.log('  [ok] filterStageRowsByCycle() scopes rows to the selected stage');

    const source = read('js/pages/settings-defaults.js');
    const scopedSites = (source.match(/stageRowsForSelectedCycle\(/g) || []).length;
    assert.strictEqual(scopedSites, 8, `all render paths scope rows (found ${scopedSites}, want 8)`);
    assert.ok(
        source.includes('اختر السلك قبل حفظ قواعد المرحلة'),
        'authoritative save refuses a missing stage with an explicit error'
    );
    assert.ok(
        source.includes('08-03-collegial-level-normalization'),
        'level-routing ADR note documents the keep-08-03 decision'
    );
    assert.ok(!source.includes('secondary_qualifiant'), 'no cycle-code literals in the editor');
    console.log('  [ok] editor render paths, save guard, and ADR note are in place');
}

// ─── Part 5: track-selection field is qualifiant-only ───

function loadStudentProfileWithGuidanceDom() {
    const created = [];
    const head = {
        children: [],
        appendChild(child) {
            this.children.push(child);
            return child;
        }
    };
    const wrapper = new Element('div');
    const select = new Element('select');
    select.id = 'bm-guide-stream';
    wrapper.appendChild(select);
    created.push(wrapper, select);
    const document = {
        readyState: 'loading',
        head,
        body: { appendChild() {} },
        createElement(tag) {
            const element = new Element(tag);
            created.push(element);
            return element;
        },
        getElementById(id) {
            return created.find((element) => element.id === id) || null;
        },
        querySelector() {
            return null;
        },
        querySelectorAll() {
            return [];
        },
        addEventListener() {}
    };
    const sandbox = {
        console,
        getSchoolYear: () => '2025/2026',
        document,
        window: {}
    };
    vm.createContext(sandbox);
    vm.runInContext(read('js/pages/student-profile.js'), sandbox, { filename: 'js/pages/student-profile.js' });
    sandbox.EducationCycles = { QUALIFIANT_CYCLE };
    return { sandbox, document, select, wrapper };
}

function noticeIn(wrapper) {
    return wrapper.children.find((child) => child.id === 'bm-guide-stream-stage-notice') || null;
}

function part5StreamSelectGate() {
    console.log('[test] 5. track-selection field renders only for the qualifiant stage');

    {
        const { sandbox, select, wrapper } = loadStudentProfileWithGuidanceDom();
        assert.strictEqual(typeof sandbox.applyGuidanceStreamStageGate, 'function', 'gate is a page global');
        select.value = 'sm_a';
        sandbox.applyGuidanceStreamStageGate(COLLEGIAL_CYCLE);
        assert.strictEqual(select.disabled, true, 'collegial stage disables the stream select');
        assert.strictEqual(select.value, 'sm_a', 'legacy saved stream value is preserved');
        const notice = noticeIn(wrapper);
        assert.ok(notice, 'explicit notice is inserted');
        assert.ok(notice.textContent.includes('خاص بالسلك التأهيلي'), 'notice names the qualifiant-only scope');
        assert.strictEqual(notice.className, 'sp-guidance-stage-notice', 'notice carries the gate class');
        assert.strictEqual(notice.getAttribute('role'), 'status', 'notice is announced');
        assert.strictEqual(
            select.getAttribute('aria-describedby'),
            'bm-guide-stream-stage-notice',
            'select references the notice'
        );
        sandbox.applyGuidanceStreamStageGate(COLLEGIAL_CYCLE);
        assert.strictEqual(
            wrapper.children.filter((child) => child.id === 'bm-guide-stream-stage-notice').length,
            1,
            'repeat gating inserts no duplicate notice'
        );
        console.log('  [ok] collegial stage disables the field with an explicit notice');
    }

    {
        const { sandbox, select, wrapper } = loadStudentProfileWithGuidanceDom();
        sandbox.applyGuidanceStreamStageGate(COLLEGIAL_CYCLE);
        assert.strictEqual(select.disabled, true, 'precondition: gated for collegial');
        sandbox.applyGuidanceStreamStageGate(QUALIFIANT_CYCLE);
        assert.strictEqual(select.disabled, false, 'qualifiant stage keeps the field editable');
        assert.strictEqual(noticeIn(wrapper), null, 'notice is removed for qualifiant');
        assert.strictEqual(select.getAttribute('aria-describedby'), null, 'notice reference is removed');
        console.log('  [ok] qualifiant stage keeps the field editable');
    }

    {
        const { sandbox, select, wrapper } = loadStudentProfileWithGuidanceDom();
        sandbox.applyGuidanceStreamStageGate(null);
        assert.strictEqual(select.disabled, false, 'unknown stage keeps the legacy behavior');
        assert.strictEqual(noticeIn(wrapper), null, 'no notice for an unknown stage');
        delete sandbox.EducationCycles;
        sandbox.applyGuidanceStreamStageGate(COLLEGIAL_CYCLE);
        assert.strictEqual(select.disabled, false, 'missing SSOT keeps the legacy behavior');
        console.log('  [ok] unknown stage and missing SSOT keep the legacy behavior');
    }

    const source = read('js/pages/student-profile.js');
    assert.ok(
        source.includes('applyGuidanceStreamStageGate();'),
        'updateGuidanceAnalysis re-applies the gate on every recompute'
    );
    assert.ok(source.includes('stageBlocksAnalysisRestore'), 'populate blocks stale analysis restores off-stage');
    assert.ok(source.includes('.sp-guidance-stage-notice'), 'notice styling ships with the page CSS');
    console.log('  [ok] gate wiring, restore guard, and notice styling are in place');
}

// ─── Runner ───

async function main() {
    console.log('[test] stage UI isolation (Slice 4)');
    await part1SwitcherCache();
    await part2ExamFormats();
    part3GuidanceGate();
    part4RulesEditor();
    part5StreamSelectGate();
    console.log('[test] stage UI isolation: all checks passed');
}

main().catch((err) => {
    console.error('FAIL: stage UI isolation — ' + (err && err.message ? err.message : err));
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
});
