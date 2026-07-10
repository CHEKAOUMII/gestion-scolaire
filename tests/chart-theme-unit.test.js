'use strict';

// CH6: unit tests for js/shared/chart-theme.js
//
//   node tests/chart-theme-unit.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const mod = require('../js/shared/chart-theme.js');

assert.strictEqual(typeof mod.getChartThemeColors, 'function');
assert.strictEqual(typeof mod.applyGlobalChartDefaults, 'function');
assert.strictEqual(typeof mod.ensureChartJsLoaded, 'function');
assert.strictEqual(mod.CHART_JS_SRC, 'vendor/chart.min.js');

// Minimal DOM stub for theme detection
global.document = {
    documentElement: {
        dataset: { theme: 'light' },
        getAttribute: () => null
    }
};
global.getComputedStyle = () => ({
    getPropertyValue: (name) => {
        const map = {
            '--color-text-main': '#111827',
            '--color-text-muted': '#6b7280',
            '--color-primary': '#3B6AC5',
            '--color-primary-light': '#5B84D6',
            '--color-primary-dark': '#2A4F96'
        };
        return map[name] || '';
    }
});

const light = mod.getChartThemeColors();
assert.strictEqual(light.isDark, false);
assert.ok(light.grid && light.text && light.tooltipBg);
assert.ok(light.textColor && light.mutedColor && light.gridColor && light.primary);
// Dual naming aliases stay in sync for grid
assert.strictEqual(light.grid, light.gridColor);

global.document.documentElement.dataset.theme = 'dark';
const dark = mod.getChartThemeColors();
assert.strictEqual(dark.isDark, true);
assert.ok(String(dark.grid).includes('255'));

// Consumers must not redefine loader/theme helpers
const consumers = [
    'js/pages/absence-analytics.js',
    'js/pages/analytics.js',
    'js/pages/teachers-performance.js',
    'js/pages/tracking-teachers-performance.js',
    'app.js'
];
for (const rel of consumers) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(
        !/function\s+getChartThemeColors\b/.test(src),
        rel + ' must not define local getChartThemeColors'
    );
    assert.ok(
        !/function\s+ensureChartJsLoaded\b/.test(src),
        rel + ' must not define local ensureChartJsLoaded'
    );
    assert.ok(!/\bCHART_JS_CDN\b/.test(src), rel + ' must not keep CHART_JS_CDN local constant');
}

// HTML hosts load the shared module
const htmlHosts = [
    'absence-analytics.html',
    'analytics.html',
    'teachers-performance.html',
    'tracking-teachers-performance.html',
    'index.html'
];
for (const rel of htmlHosts) {
    const html = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(
        html.includes('js/shared/chart-theme.js'),
        rel + ' must include js/shared/chart-theme.js'
    );
}

console.log('chart-theme-unit: OK');
