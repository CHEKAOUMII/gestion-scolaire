/**
 * timetable-view.js — Shared pure helpers for room/student timetable tabs (C5)
 *
 * Dual-export. Host: timetable.html loads utils.js before this module.
 * Uses MORNING_HOUR_MAP / AFTERNOON_HOUR_MAP from utils when available — does not redefine H1–H4 times.
 */
(function (root, factory) {
    const api = factory(root);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.TT_VIEW_DAYS = api.TT_VIEW_DAYS;
        root.ttNaturalSortHours = api.ttNaturalSortHours;
        root.ttResolveHourLabel = api.ttResolveHourLabel;
        root.ttBuildHoursOrdered = api.ttBuildHoursOrdered;
        root.ttBuildSlotLookup = api.ttBuildSlotLookup;
        root.ttObserveTheme = api.ttObserveTheme;
        root.ttSafeFileName = api.ttSafeFileName;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    const TT_VIEW_DAYS = Object.freeze([
        'الاثنين',
        'الثلاثاء',
        'الأربعاء',
        'الخميس',
        'الجمعة',
        'السبت'
    ]);

    function ttNaturalSortHours(a, b) {
        return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
    }

    /**
     * Slot label for table headers. Prefer utils maps; fallback to key.
     * @param {string} hourKey e.g. 'H1'
     * @param {'morning'|'afternoon'} [period]
     */
    function ttResolveHourLabel(hourKey, period) {
        const key = String(hourKey || '');
        const r = root || (typeof window !== 'undefined' ? window : {});
        if (period === 'afternoon' && r.AFTERNOON_HOUR_MAP && r.AFTERNOON_HOUR_MAP[key]) {
            return r.AFTERNOON_HOUR_MAP[key];
        }
        if (r.MORNING_HOUR_MAP && r.MORNING_HOUR_MAP[key]) {
            return r.MORNING_HOUR_MAP[key];
        }
        // Flat PERIOD_MAP uses h1-h8 style sometimes
        if (r.PERIOD_MAP) {
            const lower = key.toLowerCase();
            if (r.PERIOD_MAP[lower]) return r.PERIOD_MAP[lower];
            if (r.PERIOD_MAP[key]) return r.PERIOD_MAP[key];
        }
        return key;
    }

    function ttBuildHoursOrdered(morningHours, afternoonHours) {
        const all = [];
        (morningHours || []).forEach((h) => all.push({ key: h, period: 'morning' }));
        (afternoonHours || []).forEach((h) => all.push({ key: h, period: 'afternoon' }));
        const separatorAfter =
            (morningHours || []).length > 0 && (afternoonHours || []).length > 0
                ? (morningHours || []).length
                : -1;
        return { allHoursOrdered: all, separatorAfter };
    }

    /** Build day|period|hour → lessons[] lookup */
    function ttBuildSlotLookup(lessons) {
        const lookup = {};
        (lessons || []).forEach((l) => {
            const k = `${l.day}|${l.period}|${l.hour}`;
            if (lookup[k]) lookup[k].push(l);
            else lookup[k] = [l];
        });
        return lookup;
    }

    /**
     * Observe data-theme changes; call onChange when theme flips.
     * @returns {MutationObserver|null}
     */
    function ttObserveTheme(onChange) {
        if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return null;
        const themeObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.attributeName === 'data-theme') {
                    if (typeof onChange === 'function') onChange();
                }
            }
        });
        themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme']
        });
        return themeObserver;
    }

    function ttSafeFileName(name, maxLen) {
        const n = maxLen || 60;
        return String(name || '')
            .replace(/[\\/:*?"<>|]+/g, '_')
            .slice(0, n);
    }

    return {
        TT_VIEW_DAYS,
        ttNaturalSortHours,
        ttResolveHourLabel,
        ttBuildHoursOrdered,
        ttBuildSlotLookup,
        ttObserveTheme,
        ttSafeFileName
    };
});
