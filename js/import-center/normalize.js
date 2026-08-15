/*
 * normalize.js — shared normalization primitives for the import parsers.
 *
 * One canonical behavior for digits, keys, student codes, dates, and strict
 * numbers so the students/grades parsers cannot diverge (review F10/F12).
 * Dual-export: window.ImportCenterNormalize + module.exports.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.ImportCenterNormalize = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function text(value) {
        return String(value ?? '').trim();
    }

    function toLatinDigits(value) {
        return text(value).replace(/[٠-٩۰-۹]/g, (digit) => {
            const code = digit.charCodeAt(0);
            return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
        });
    }

    function normalizeKey(value) {
        return text(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
            .replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627')
            .replace(/[\u0624]/g, '\u0648')
            .replace(/[\u0626\u0649]/g, '\u064A')
            .replace(/[\u0629]/g, '\u0647')
            .toLowerCase()
            .replace(/[^a-z0-9\u0600-\u06FF]+/g, '');
    }

    function foldArabic(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
            .replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627')
            .replace(/[\u0624]/g, '\u0648')
            .replace(/[\u0626\u0649]/g, '\u064A')
            .replace(/[\u0629]/g, '\u0647');
    }

    function normalizeStudentCode(value) {
        const raw = toLatinDigits(value).replace(/^'+/, '').replace(/\s+/g, '');
        if (!raw) return '';
        if (/^\d+\.0+$/.test(raw)) return raw.replace(/\.0+$/, '');
        return raw.toUpperCase();
    }

    function excelDateToIso(value) {
        if (value === null || value === undefined || value === '') return '';
        if (typeof value === 'number') {
            if (!Number.isFinite(value) || value < 20000 || value > 60000) return '';
            const date = new Date((value - 25569) * 86400 * 1000);
            if (Number.isNaN(date.getTime())) return '';
            const year = date.getUTCFullYear();
            const month = String(date.getUTCMonth() + 1).padStart(2, '0');
            const day = String(date.getUTCDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }
        const raw = toLatinDigits(value).trim();
        if (!raw) return '';
        let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (match) {
            const year = Number(match[1]);
            const month = Number(match[2]);
            const day = Number(match[3]);
            if (month < 1 || month > 12 || day < 1 || day > 31) return '';
            return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
        match = raw.match(/^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})$/);
        if (match) {
            const year = Number(match[1]);
            const month = Number(match[2]);
            const day = Number(match[3]);
            if (month < 1 || month > 12 || day < 1 || day > 31) return '';
            return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
        match = raw.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
        if (match) {
            const day = Number(match[1]);
            const month = Number(match[2]);
            const year = Number(match[3]);
            if (month < 1 || month > 12 || day < 1 || day > 31) return '';
            return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
        return '';
    }

    function parseStrictNumber(value) {
        if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
        const normalized = toLatinDigits(value).replace(',', '.').trim();
        if (!normalized || !/^-?(?:\d+)(?:\.\d+)?$/.test(normalized)) return NaN;
        const number = Number(normalized);
        return Number.isFinite(number) ? number : NaN;
    }

    return {
        text,
        toLatinDigits,
        normalizeKey,
        foldArabic,
        normalizeStudentCode,
        excelDateToIso,
        parseStrictNumber
    };
});
