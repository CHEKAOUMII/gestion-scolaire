/**
 * Pure helpers for the student profile page (no DOM / no window.api).
 * Loaded in the browser via script tag; also require()-able from Node tests.
 */
(function (global) {
    'use strict';

    const AVATAR_COLORS = [
        '#3B6AC5',
        '#3C95D0',
        '#E67F22',
        '#9B59B6',
        '#E74C3C',
        '#1ABC9C',
        '#2980B9',
        '#D35400',
        '#8E44AD',
        '#27AE60',
        '#F39C12',
        '#C0392B',
        '#16A085',
        '#2C3E50',
        '#7F8C8D'
    ];

    const SP_MONTH_NAMES = Object.freeze([
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

    function getAvatarColor(name) {
        let hash = 0;
        const text = String(name || '');
        for (let i = 0; i < text.length; i++) {
            hash = text.charCodeAt(i) + ((hash << 5) - hash);
        }
        return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
    }

    function getInitial(name) {
        if (!name) return '?';
        const parts = String(name).trim().split(/\s+/);
        return parts[0].charAt(0).toUpperCase();
    }

    function gradeColor(val) {
        const n = Number(val);
        if (n >= 16) return 'grade-excellent';
        if (n >= 14) return 'grade-good';
        if (n >= 12) return 'grade-average';
        if (n >= 10) return 'grade-pass';
        return 'grade-poor';
    }

    function gradeHex(val) {
        const n = Number(val);
        if (n >= 16) return '#4caf50';
        if (n >= 14) return '#8bc34a';
        if (n >= 12) return '#ff9800';
        if (n >= 10) return '#ffc107';
        return '#f44336';
    }

    /** Collapse grade records to one per (subject, semester). */
    function dedupeGrades(grades) {
        const dedup = {};
        (grades || []).forEach((g) => {
            const key = `${String(g.subject || '').trim()}||${g.semester || ''}`;
            dedup[key] = g;
        });
        return Object.values(dedup);
    }

    /**
     * Calendar year for a school-year month (Massar: 9–12 → yearStart, 1–8 → yearStart+1).
     * @param {number} monthNum - 1..12
     * @param {string} [schoolYear] - e.g. "2025/2026"
     */
    function absenceCalendarYear(monthNum, schoolYear) {
        const mi = Number(monthNum);
        if (!Number.isFinite(mi) || mi < 1 || mi > 12) return null;
        const yearStart = Number(String(schoolYear || '').split(/[\/\-]/)[0]);
        if (!Number.isFinite(yearStart) || yearStart < 2000) return null;
        return mi >= 9 ? yearStart : yearStart + 1;
    }

    /**
     * Stable grouping key for monthly absence totals (prefer YYYY-MM).
     * @param {object} a - absence row
     * @param {string} [fallbackSchoolYear]
     */
    function absenceMonthKey(a, fallbackSchoolYear) {
        const dateStr = a?.absence_date != null ? String(a.absence_date).trim() : '';
        if (/^\d{4}-\d{2}/.test(dateStr)) return dateStr.slice(0, 7);

        const monthRaw = a?.month != null ? String(a.month).trim() : '';
        if (/^\d{4}-\d{2}/.test(monthRaw)) return monthRaw.slice(0, 7);

        const schoolYear = a?.school_year || fallbackSchoolYear || '';

        if (/^\d{1,2}$/.test(monthRaw)) {
            const mi = parseInt(monthRaw, 10);
            if (mi >= 1 && mi <= 12) {
                const yFromDate = dateStr.match(/^(\d{4})/);
                const year = yFromDate ? parseInt(yFromDate[1], 10) : absenceCalendarYear(mi, schoolYear);
                if (year) return `${year}-${String(mi).padStart(2, '0')}`;
                return `m-${String(mi).padStart(2, '0')}`;
            }
        }

        const my = monthRaw.match(/^(\d{1,2})[\/\-](\d{4})$/);
        if (my) return `${my[2]}-${String(parseInt(my[1], 10)).padStart(2, '0')}`;

        const nameIdx = SP_MONTH_NAMES.findIndex((n) => n === monthRaw || monthRaw.includes(n));
        if (nameIdx >= 0) {
            const mi = nameIdx + 1;
            const year = absenceCalendarYear(mi, schoolYear);
            if (year) return `${year}-${String(mi).padStart(2, '0')}`;
        }

        return monthRaw || dateStr.slice(0, 7) || 'غير محدد';
    }

    /**
     * Display label: «شهر أكتوبر 2025».
     * @param {string} key - from absenceMonthKey (YYYY-MM preferred)
     * @param {string} [schoolYear]
     */
    function formatAbsenceMonthLabel(key, schoolYear) {
        if (!key || key === 'غير محدد') return 'غير محدد';
        const s = String(key).trim();
        const sy = schoolYear || '';

        let m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
        if (m) {
            const year = m[1];
            const idx = parseInt(m[2], 10) - 1;
            const name = SP_MONTH_NAMES[idx] || m[2];
            return `شهر ${name} ${year}`;
        }

        // Internal bare-month key m-MM (legacy)
        m = s.match(/^m-(\d{1,2})$/);
        if (m) {
            const mi = parseInt(m[1], 10);
            const idx = mi - 1;
            const name = SP_MONTH_NAMES[idx] || m[1];
            const year = absenceCalendarYear(mi, sy);
            return year ? `شهر ${name} ${year}` : `شهر ${name}`;
        }

        // Bare 1–12
        if (/^\d{1,2}$/.test(s)) {
            const mi = parseInt(s, 10);
            const idx = mi - 1;
            if (idx >= 0 && idx < 12) {
                const year = absenceCalendarYear(mi, sy);
                return year ? `شهر ${SP_MONTH_NAMES[idx]} ${year}` : `شهر ${SP_MONTH_NAMES[idx]}`;
            }
        }

        // MM/YYYY
        m = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
        if (m) {
            const idx = parseInt(m[1], 10) - 1;
            const name = SP_MONTH_NAMES[idx] || m[1];
            return `شهر ${name} ${m[2]}`;
        }

        // Already human text
        if (/شهر\s/.test(s)) return s;
        return s;
    }

    const api = {
        AVATAR_COLORS,
        SP_MONTH_NAMES,
        getAvatarColor,
        getInitial,
        gradeColor,
        gradeHex,
        dedupeGrades,
        absenceCalendarYear,
        absenceMonthKey,
        formatAbsenceMonthLabel
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    global.StudentProfilePure = api;
})(typeof window !== 'undefined' ? window : globalThis);
