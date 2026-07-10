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
            const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
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
        const textColor = cssVar('--color-text-main', dark ? '#e2e8f0' : '#1e293b');
        const mutedColor = cssVar('--color-text-muted', dark ? '#94a3b8' : '#64748b');
        // Shared grid: matches dashboard dark; light uses soft slate line (acceptable cosmetic unify).
        const gridColor = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
        const tooltipBg = dark ? '#1e293b' : '#ffffff';
        const tooltipText = dark ? '#e2e8f0' : '#1e293b';
        const legendText = dark ? '#cbd5e1' : '#475569';

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
            primary: cssVar('--color-primary', '#3B6AC5'),
            primaryLight: cssVar('--color-primary-light', '#5B84D6'),
            primaryDark: cssVar('--color-primary-dark', '#2A4F96'),
            accent: '#9B64AB'
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
