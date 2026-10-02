/**
 * csv.js — Shared CSV cell escaping (CH3)
 *
 * Dual-export: window globals for multi-page HTML + module.exports for Node tests.
 *
 * KD9 / Gate 0 matrix (canonical = hardened tracking version):
 *
 * | Source | Behavior | Resolution |
 * |--------|----------|------------|
 * | tracking-teachers-performance csvEscape | Quote + prefix `'` when value starts with `=+-@` or tab/CR | **shared (this module)** |
 * | teachers-performance csvEscape | Quote only | → hardened |
 * | absence-analytics escapeCsv | Quote only | → hardened |
 *
 * Hardening is a security-positive formula-injection fix (Excel/LibreOffice).
 * Display in spreadsheets may show a leading apostrophe on formula-like cells.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.csvEscape = api.csvEscape;
        // Alias used by absence-analytics and some older call sites
        root.escapeCsv = api.csvEscape;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    /**
     * Escape a single CSV field (always double-quoted).
     * Neutralizes spreadsheet formula injection for values starting with = + - @ tab CR.
     * @param {*} value
     * @returns {string}
     */
    function csvEscape(value) {
        let str = String(value ?? '');
        // Formula injection: leading = + - @ \t \r can execute in Excel/LibreOffice
        if (/^[=+\-@\t\r]/.test(str)) {
            str = "'" + str;
        }
        return '"' + str.replace(/"/g, '""') + '"';
    }

    return { csvEscape, escapeCsv: csvEscape };
});
