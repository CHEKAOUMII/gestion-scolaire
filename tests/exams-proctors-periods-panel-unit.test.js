'use strict';

/**
 * WP7: ExamProctorsPeriodsPanel module contract (init/destroy/getPeriods).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Minimal DOM + browser shims
const store = {
    periods: []
};

function makeInput(value = '') {
    return {
        value,
        style: { display: '' },
        addEventListener() {},
        removeEventListener() {}
    };
}

const elements = {
    'period-name': makeInput(),
    'period-date-from': makeInput(),
    'period-date-to': makeInput(),
    'period-num': makeInput('1'),
    'periods-tbody': {
        textContent: '',
        appendChild() {},
        childNodes: []
    },
    'period-count-badge': { textContent: '0' },
    'btn-period-save': makeInput(),
    'btn-period-add': makeInput(),
    'btn-period-cancel': makeInput(),
    'btn-period-edit-mode': makeInput(),
    'btn-periods-clear-all': makeInput()
};

// fix button-like nodes
['btn-period-save', 'btn-period-add', 'btn-period-cancel', 'btn-period-edit-mode', 'btn-periods-clear-all'].forEach(
    (id) => {
        elements[id] = {
            style: { display: '' },
            addEventListener(ev, fn) {
                this['on' + ev] = fn;
            },
            removeEventListener() {}
        };
    }
);

elements['periods-tbody'] = {
    textContent: '',
    children: [],
    appendChild(node) {
        this.children.push(node);
    }
};

global.window = global;
global.document = {
    getElementById(id) {
        return elements[id] || null;
    },
    createElement(tag) {
        const node = {
            tagName: tag,
            style: {},
            className: '',
            title: '',
            type: '',
            textContent: '',
            childNodes: [],
            appendChild(child) {
                this.childNodes.push(child);
                return child;
            },
            addEventListener() {}
        };
        return node;
    },
    createTextNode(t) {
        return { text: t };
    }
};

const api = {
    examConfig: {
        async get(_year, key) {
            if (key === 'examPeriodsData') return store.periods.slice();
            return null;
        },
        async save({ data }) {
            store.periods = Array.isArray(data) ? data.slice() : [];
            return { success: true };
        },
        async delete() {
            store.periods = [];
            return { success: true };
        }
    }
};

// Load classic module
require('../js/pages/exams-proctors/periods-panel.js');
const panel = global.ExamProctorsPeriodsPanel;
assert.ok(panel, 'ExamProctorsPeriodsPanel global must exist');
assert.strictEqual(typeof panel.init, 'function');
assert.strictEqual(typeof panel.destroy, 'function');
assert.strictEqual(typeof panel.getPeriods, 'function');

console.log('[test] WP7 exams-proctors periods panel');

(async () => {
    store.periods = [
        { name: 'الجهوي', date_from: '2026-06-01', date_to: '2026-06-03' },
        { name: 'الوطني', date_from: '2026-06-10', date_to: '2026-06-12' }
    ];

    await panel.init({
        getSchoolYear: () => '2025/2026',
        api,
        showToast() {},
        showConfirm: async () => ({ confirmed: true }),
        formatDateAr: (d) => d,
        onChanged() {}
    });

    assert.strictEqual(panel.isActive(), true);
    assert.strictEqual(panel.getPeriods().length, 2);
    assert.strictEqual(panel.getPeriods()[0].name, 'الجهوي');
    console.log('  [ok] init loads periods from examConfig');

    store.periods.push({ name: 'X', date_from: '2026-08-01', date_to: '2026-08-02' });
    await panel.reload();
    assert.strictEqual(panel.getPeriods().length, 3);
    console.log('  [ok] reload refreshes from API store');

    panel.destroy();
    assert.strictEqual(panel.isActive(), false);
    assert.deepStrictEqual(panel.getPeriods(), []);
    console.log('  [ok] destroy clears listeners and state');

    // Page wiring: exams-proctors.js must use the module
    const pageSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'pages', 'exams-proctors.js'), 'utf8');
    assert.ok(pageSrc.includes('initPeriodsPanelFromModule'), 'page must init via module helper');
    assert.ok(pageSrc.includes('ExamProctorsPeriodsPanel'), 'page must reference ExamProctorsPeriodsPanel');
    assert.ok(!/async function initPeriodsPanel\s*\(/.test(pageSrc), 'inline initPeriodsPanel must be removed');
    assert.ok(!/function renderPeriodsTable\s*\(/.test(pageSrc), 'inline renderPeriodsTable must be removed');

    const html = fs.readFileSync(path.join(__dirname, '..', 'exams-proctors.html'), 'utf8');
    assert.ok(html.includes('js/pages/exams-proctors/periods-panel.js'), 'html must load periods-panel.js');
    const panelIdx = html.indexOf('periods-panel.js');
    const pageIdx = html.indexOf('js/pages/exams-proctors.js');
    assert.ok(panelIdx > 0 && panelIdx < pageIdx, 'periods-panel.js must load before exams-proctors.js');
    console.log('  [ok] page + html wiring');

    console.log('[test] WP7 exams-proctors periods panel OK');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
