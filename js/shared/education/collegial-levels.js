(function (global) {
    'use strict';

    /**
     * Renderer-side collegial level catalog. Codes map 1:1 to the main-side SSOT
     * (main/db/education-catalogs/primary-levels.js, COLLEGIAL_LEVEL_CODES); the
     * `name` is the school's complete official label carried by the student file
     * («الأولى إعدادي مسار دولي» …), which is what the import stores in
     * students.level and the filters/other lists display. The DB catalog keeps the
     * short SSOT names; this module follows the dual-export pattern of
     * js/shared/education/qualifiant-levels.js for the renderer.
     */
    const COLLEGIAL_LEVEL_ENTRIES = [
        { code: '1APIC', name: 'الأولى إعدادي مسار دولي', order: 1 },
        { code: '2APIC', name: 'الثانية إعدادي مسار دولي', order: 2 },
        { code: '3APIC', name: 'الثالثة إعدادي مسار دولي', order: 3 }
    ];

    const COLLEGIAL_LEVELS = Object.freeze(
        COLLEGIAL_LEVEL_ENTRIES.map((entry) => Object.freeze({ code: entry.code, name: entry.name, order: entry.order }))
    );

    const LEVEL_BY_CODE = Object.freeze(
        COLLEGIAL_LEVELS.reduce((map, entry) => {
            map[entry.code] = entry;
            return map;
        }, {})
    );

    function normalizeKey(value) {
        return String(value ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[\u064B-\u065F\u0670]/g, '')
            .replace(/[أإآ]/g, 'ا')
            .replace(/ؤ/g, 'و')
            .replace(/ئ/g, 'ي')
            .toLowerCase()
            .replace(/[^a-z0-9\u0600-\u06FF]+/g, ' ');
    }

    function stripSectionSuffix(value) {
        return String(value).trim().replace(/[-_\s]?\d+$/, '').trim().toUpperCase();
    }

    // Ordinal must directly precede إعدادي (optional تاء مربوطة), then any suffix
    // («مسار دولي», …). Anchored at the start so «اولاد اعدادي» / «اولوية اعدادي»
    // / «الأولى مرحبا إعدادي» never match. Patterns run over normalizeKey output.
    const LEVEL_PATTERNS = Object.freeze([
        [/^(?:ال)?اول(?:ى)?\s+اعدادي(?:ة)?(?=\s|$)/, '1APIC'],
        [/^(?:ال)?ثاني(?:ة)?\s+اعدادي(?:ة)?(?=\s|$)/, '2APIC'],
        [/^(?:ال)?ثالث(?:ة)?\s+اعدادي(?:ة)?(?=\s|$)/, '3APIC']
    ]);

    /**
     * تحويل تسمية المستوى إلى كائن { code, name, order } أو null
     * يطابق المستويات الإعدادية فقط (1APIC / 2APIC / 3APIC) ولا يطابق أبدًا
     * تسميات الباك أو الجذع المشترك.
     * @param {*} raw - تسمية المستوى أو رمز القسم (مثل "الأولى إعدادي مسار دولي" أو "3APIC-7")
     * @returns {({ code: string, name: string, order: number })|null}
     */
    function resolveLevel(raw) {
        if (raw === null || raw === undefined) return null;
        const sectionCode = stripSectionSuffix(raw);
        if (LEVEL_BY_CODE[sectionCode]) return LEVEL_BY_CODE[sectionCode];
        const normalized = normalizeKey(raw).trim();
        if (!normalized) return null;
        if (normalized.includes('باك') || normalized.includes('جذع')) return null;
        if (!normalized.includes('اعدادي')) return null;
        for (const [pattern, code] of LEVEL_PATTERNS) {
            if (pattern.test(normalized)) return LEVEL_BY_CODE[code];
        }
        return null;
    }

    /**
     * تحويل رمز القسم إلى كائن { code, name, order } أو null
     * يطابق الرمز مباشرة (بعد إزالة لاحقة رقمية مثل "3APIC-7") ثم يفوض إلى resolveLevel.
     * @param {*} section - رمز القسم (مثل "1APIC-2")
     * @returns {({ code: string, name: string, order: number })|null}
     */
    function matchLevelFromSection(section) {
        if (section === null || section === undefined) return null;
        const sectionCode = stripSectionSuffix(section);
        if (LEVEL_BY_CODE[sectionCode]) return LEVEL_BY_CODE[sectionCode];
        return resolveLevel(section);
    }

    const api = Object.freeze({
        COLLEGIAL_LEVELS,
        resolveLevel,
        matchLevelFromSection
    });
    global.EdCollegialLevels = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
