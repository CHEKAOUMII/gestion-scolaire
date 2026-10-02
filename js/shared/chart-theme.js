/**
 * chart-theme.js — Shared Chart.js theme + loader (CH6)
 *
 * Dual-export: window globals for multi-page HTML + module.exports for Node tests.
 *
 * Consumers: absence-analytics, analytics, teachers-performance, tracking-teachers-performance, app.js (dashboard)
 *
 * Return shape of getChartThemeColors() includes BOTH naming styles:
 *   - absence-analytics: grid, text, tooltipBg, tooltipText, legendText
 *   - app.js dashboard:  textColor, mutedColor, gridColor, primary, primaryLight, primaryDark, accent
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.CHART_JS_SRC = api.CHART_JS_SRC;
        root.getChartThemeColors = api.getChartThemeColors;
        root.applyGlobalChartDefaults = api.applyGlobalChartDefaults;
        root.ensureChartJsLoaded = api.ensureChartJsLoaded;
        root.destroyChartInstance = api.destroyChartInstance;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const CHART_JS_SRC = 'vendor/chart.min.js';
    let _chartLoaderPromise = null;

    function isDarkTheme() {
        if (typeof document === 'undefined' || !document.documentElement) return false;
        const el = document.documentElement;
        return el.dataset.theme === 'dark' || el.getAttribute('data-theme') === 'dark';
    }

    function cssVar(name, fallback) {
        if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
            return fallback || '';
        }
        try {
            const themeSource = document.body || document.documentElement;
            const v = getComputedStyle(themeSource).getPropertyValue(name).trim();
            return v || fallback || '';
        } catch {
            return fallback || '';
        }
    }

    /**
     * Theme colors for Chart.js (light/dark).
     * Prefer CSS design tokens when present; fall back to stable hardcoded values.
     */
    function getChartThemeColors() {
        const dark = isDarkTheme();
        const textColor = cssVar('--color-text-main', dark ? '#eeeae2' : '#30323a');
        const mutedColor = cssVar('--color-text-muted', dark ? '#b7b5b0' : '#656872');
        // Shared grid: soft lines for both product themes.
        const gridColor = dark ? 'rgba(255,255,255,0.08)' : 'rgba(28,32,41,0.06)';
        const tooltipBg = dark ? '#22262e' : '#fffefb';
        const tooltipText = dark ? '#eeeae2' : '#30323a';
        const legendText = dark ? '#c8cdd5' : '#656872';

        return {
            isDark: dark,
            // absence-analytics keys
            grid: gridColor,
            text: mutedColor,
            tooltipBg,
            tooltipText,
            legendText,
            // app.js / dashboard keys
            textColor,
            mutedColor,
            gridColor,
            primary: cssVar('--color-primary', dark ? '#9aaaca' : '#42516a'),
            primaryLight: cssVar('--color-primary-light', dark ? '#8295b7' : '#70819d'),
            primaryDark: cssVar('--color-primary-dark', dark ? '#c1cce2' : '#303d53'),
            accent: cssVar('--color-chart-accent', dark ? '#d0aa72' : '#b2874d')
        };
    }

    function applyGlobalChartDefaults() {
        if (typeof window === 'undefined' || !window.Chart) return;
        const tc = getChartThemeColors();
        window.Chart.defaults.color = tc.text;
        window.Chart.defaults.borderColor = tc.grid;
        if (window.Chart.defaults.animation) {
            window.Chart.defaults.animation.duration = 400;
        }
    }

    /**
     * Load vendor/chart.min.js once (shared promise across pages).
     * @returns {Promise<typeof Chart>}
     */
    function ensureChartJsLoaded() {
        if (typeof window !== 'undefined' && window.Chart) {
            return Promise.resolve(window.Chart);
        }
        if (_chartLoaderPromise) return _chartLoaderPromise;

        _chartLoaderPromise = new Promise((resolve, reject) => {
            if (typeof document === 'undefined') {
                reject(new Error('document unavailable'));
                return;
            }
            const existing = document.querySelector(`script[data-dynamic-src="${CHART_JS_SRC}"]`);
            if (existing) {
                existing.addEventListener('load', () => resolve(window.Chart), { once: true });
                existing.addEventListener(
                    'error',
                    () => reject(new Error('تعذر تحميل مكتبة الرسوم البيانية')),
                    { once: true }
                );
                if (window.Chart) resolve(window.Chart);
                return;
            }
            const script = document.createElement('script');
            script.src = CHART_JS_SRC;
            script.async = true;
            script.defer = true;
            script.dataset.dynamicSrc = CHART_JS_SRC;
            script.onload = () => resolve(window.Chart);
            script.onerror = () => reject(new Error('تعذر تحميل مكتبة الرسوم البيانية'));
            document.head.appendChild(script);
        });

        return _chartLoaderPromise;
    }

    /** Safely destroy a Chart.js instance (or null it out of a registry). */
    function destroyChartInstance(chartOrMap, key) {
        if (chartOrMap && typeof chartOrMap.destroy === 'function' && key === undefined) {
            chartOrMap.destroy();
            return null;
        }
        if (chartOrMap && key != null && chartOrMap[key]) {
            if (typeof chartOrMap[key].destroy === 'function') chartOrMap[key].destroy();
            chartOrMap[key] = null;
        }
        return null;
    }

    return {
        CHART_JS_SRC,
        getChartThemeColors,
        applyGlobalChartDefaults,
        ensureChartJsLoaded,
        destroyChartInstance
    };
});
