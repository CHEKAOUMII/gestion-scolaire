/**
 * fet-import.js — Shared FET import constants/helpers (CH10)
 *
 * Dual-export: window + module.exports for Node tests.
 * Consumers: settings-imports.js, timetable.js
 *
 * Extracts the duplicated FET day→Arabic mapping and :G# class-name stripper.
 * Full XML import pipelines stay page-local (different subject translate / DB save paths).
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.FET_DAY_MAPPINGS = api.FET_DAY_MAPPINGS;
        root.FET_ARABIC_DAYS = api.FET_ARABIC_DAYS;
        root.getBaseClassName = api.getBaseClassName;
        root.ensureFetDaySkeleton = api.ensureFetDaySkeleton;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    /** FET day attribute name → Arabic day + morning/afternoon */
    const FET_DAY_MAPPINGS = Object.freeze({
        lundi_m: { day: 'الاثنين', period: 'morning', index: 0 },
        lundi_s: { day: 'الاثنين', period: 'afternoon', index: 0 },
        Mardi_m: { day: 'الثلاثاء', period: 'morning', index: 1 },
        Mardi_s: { day: 'الثلاثاء', period: 'afternoon', index: 1 },
        Mercredi_m: { day: 'الأربعاء', period: 'morning', index: 2 },
        Mercredi_s: { day: 'الأربعاء', period: 'afternoon', index: 2 },
        Jeudi_m: { day: 'الخميس', period: 'morning', index: 3 },
        Jeudi_s: { day: 'الخميس', period: 'afternoon', index: 3 },
        Vendredi_m: { day: 'الجمعة', period: 'morning', index: 4 },
        Vendredi_s: { day: 'الجمعة', period: 'afternoon', index: 4 },
        Samedi_m: { day: 'السبت', period: 'morning', index: 5 },
        Samedi_s: { day: 'السبت', period: 'afternoon', index: 5 }
    });

    const FET_ARABIC_DAYS = Object.freeze([
        'الاثنين',
        'الثلاثاء',
        'الأربعاء',
        'الخميس',
        'الجمعة',
        'السبت'
    ]);

    /**
     * Strip FET grouping suffixes (:G1, :G2) only — keep class numbers like -1.
     */
    function getBaseClassName(className) {
        if (!className) return '';
        return String(className)
            .replace(/:[Gg]\d+$/g, '')
            .trim();
    }

    /**
     * Ensure teacher day object has morning/afternoon maps.
     * @returns {object} the day slot object
     */
    function ensureFetDaySkeleton(timetableForTeacher, arabicDay) {
        if (!timetableForTeacher[arabicDay]) {
            timetableForTeacher[arabicDay] = {
                morning: {},
                afternoon: {}
            };
        }
        return timetableForTeacher[arabicDay];
    }

    return {
        FET_DAY_MAPPINGS,
        FET_ARABIC_DAYS,
        getBaseClassName,
        ensureFetDaySkeleton
    };
});
