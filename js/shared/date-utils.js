/**
 * date-utils.js — Shared date helpers (CH4)
 *
 * Dual-export: window globals for multi-page HTML + module.exports for Node tests.
 *
 * KD9 matrix — do NOT collapse into one silent formatDateAr:
 *
 * | Caller | Local name | Empty | Output style | Shared API |
 * |--------|------------|-------|--------------|------------|
 * | exams-proctors | formatDateAr | '—' | DD/MM/YYYY | formatDateAr(s) or formatDateDMY(s) |
 * | staff-attendance | formatDate | '—' | DD/MM/YYYY | formatDateDMY(s) |
 * | compensation-tracking | formatDateShort | '—' | DD/MM | formatDateShort(s) |
 * | compensation-tracking | formatDateAr | (invalid→raw) | ar-MA short weekday/month | formatDateAr(s,'locale-short') |
 * | staff-daily-report | formatDateAr | (invalid→raw) | ar-MA long weekday/month/year | formatDateAr(s,'locale-long') |
 * | exams-schedule | formatDateAr | '' | D + Moroccan month + YYYY | formatDateAr(s,'moroccan') |
 * | many | todayStr | — | YYYY-MM-DD local | todayStr() |
 * | compensation | thirtyDaysAgo | — | YYYY-MM-DD | thirtyDaysAgo() |
 * | absence-weekly | getNextMondayISO | — | next Monday YYYY-MM-DD | getNextMondayISO() |
 *
 * Note: js/utils.js formatDate(date, format) is a different API (Date + short/long/time).
 * This module does NOT export formatDate to avoid shadowing utils.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.todayStr = api.todayStr;
        root.daysAgoISO = api.daysAgoISO;
        root.thirtyDaysAgo = api.thirtyDaysAgo;
        root.getNextMondayISO = api.getNextMondayISO;
        root.formatDateDMY = api.formatDateDMY;
        root.formatDateShort = api.formatDateShort;
        root.formatDateDM = api.formatDateDM;
        root.formatDateAr = api.formatDateAr;
        root.MOROCCAN_MONTHS = api.MOROCCAN_MONTHS;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    /** Moroccan French-influenced month names (exams-schedule / absence-weekly style). */
    const MOROCCAN_MONTHS = Object.freeze([
        'يناير',
        'فبراير',
        'مارس',
        'أبريل',
        'ماي',
        'يونيو',
        'يوليوز',
        'غشت',
        'شتنبر',
        'أكتوبر',
        'نونبر',
        'دجنبر'
    ]);

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    function toYMD(d) {
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    /** Parse YYYY-MM-DD as local midnight; other strings via Date(). */
    function parseLocalDate(dateStr) {
        if (dateStr == null || dateStr === '') return null;
        const s = String(dateStr).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            const d = new Date(s + 'T00:00:00');
            return Number.isNaN(d.getTime()) ? null : d;
        }
        const d = new Date(s);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    /** Today as YYYY-MM-DD (local). */
    function todayStr() {
        return toYMD(new Date());
    }

    /** Local calendar date N days ago as YYYY-MM-DD. */
    function daysAgoISO(days) {
        const d = new Date();
        d.setDate(d.getDate() - Number(days || 0));
        return toYMD(d);
    }

    function thirtyDaysAgo() {
        return daysAgoISO(30);
    }

    /**
     * Next Monday as YYYY-MM-DD.
     * If today is Monday, returns next week's Monday (same as absence-weekly).
     */
    function getNextMondayISO() {
        const d = new Date();
        const add = (8 - d.getDay()) % 7 || 7;
        d.setDate(d.getDate() + add);
        return toYMD(d);
    }

    /**
     * YYYY-MM-DD → DD/MM/YYYY
     * @param {string} dateStr
     * @param {string} [emptyToken='—']
     */
    function formatDateDMY(dateStr, emptyToken) {
        const empty = emptyToken === undefined ? '—' : emptyToken;
        if (!dateStr) return empty;
        const parts = String(dateStr).split('-');
        if (parts.length === 3 && parts[0].length === 4) {
            return parts[2] + '/' + parts[1] + '/' + parts[0];
        }
        const d = parseLocalDate(dateStr);
        if (!d) return String(dateStr);
        return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
    }

    /**
     * YYYY-MM-DD → DD/MM (no year) — compensation formatDateShort
     */
    function formatDateDM(dateStr, emptyToken) {
        const empty = emptyToken === undefined ? '—' : emptyToken;
        if (!dateStr) return empty;
        const parts = String(dateStr).split('-');
        if (parts.length === 3) return parts[2] + '/' + parts[1];
        return String(dateStr);
    }

    /** Alias used by compensation-tracking */
    function formatDateShort(dateStr, emptyToken) {
        return formatDateDM(dateStr, emptyToken);
    }

    /**
     * Arabic display formats.
     * @param {string} dateStr
     * @param {'dmy'|'dm'|'locale-short'|'locale-long'|'moroccan'} [style='dmy']
     */
    function formatDateAr(dateStr, style) {
        const mode = style || 'dmy';
        switch (mode) {
            case 'dm':
                return formatDateDM(dateStr);
            case 'locale-short': {
                const d = parseLocalDate(dateStr);
                if (!d) return dateStr || '';
                try {
                    return d.toLocaleDateString('ar-MA', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric'
                    });
                } catch {
                    return dateStr;
                }
            }
            case 'locale-long': {
                const d = parseLocalDate(dateStr);
                if (!d) return dateStr || '';
                try {
                    return d.toLocaleDateString('ar-MA', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    });
                } catch {
                    return dateStr;
                }
            }
            case 'moroccan': {
                if (!dateStr) return '';
                const d = parseLocalDate(dateStr);
                if (!d) return String(dateStr);
                return d.getDate() + ' ' + MOROCCAN_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
            }
            case 'dmy':
            default:
                return formatDateDMY(dateStr, '—');
        }
    }

    return {
        MOROCCAN_MONTHS,
        todayStr,
        daysAgoISO,
        thirtyDaysAgo,
        getNextMondayISO,
        formatDateDMY,
        formatDateDM,
        formatDateShort,
        formatDateAr,
        parseLocalDate
    };
});
