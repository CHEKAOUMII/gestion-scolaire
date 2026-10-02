/**
 * gender.js — Student gender helpers (CH8 / base C8)
 *
 * Dual-export: window globals + module.exports for Node tests.
 *
 * Scope: gender **string** values (m/f/male/female/ذكر/أنثى).
 * Do NOT use for teachers-list records (codes 1/2 on teacher objects) — different domain.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.isMale = api.isMale;
        root.isFemale = api.isFemale;
        root.getGenderLabel = api.getGenderLabel;
        root.getGenderIcon = api.getGenderIcon;
        root.normalizeGender = api.normalizeGender;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function normalizeGender(gender) {
        return String(gender || '')
            .trim()
            .toLowerCase();
    }

    function isMale(gender) {
        const g = normalizeGender(gender);
        return g === 'm' || g === 'male' || g === 'ذكر';
    }

    function isFemale(gender) {
        const g = normalizeGender(gender);
        return g === 'f' || g === 'female' || g === 'أنثى';
    }

    function getGenderLabel(gender) {
        if (isMale(gender)) return 'ذكر';
        if (isFemale(gender)) return 'أنثى';
        return '-';
    }

    function getGenderIcon(gender) {
        if (isMale(gender)) return 'fa-mars';
        if (isFemale(gender)) return 'fa-venus';
        return 'fa-genderless';
    }

    return { normalizeGender, isMale, isFemale, getGenderLabel, getGenderIcon };
});
