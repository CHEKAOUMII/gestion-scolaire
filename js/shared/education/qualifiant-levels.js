(function (global) {
    'use strict';

    /**
     * Single canonical qualifiant level catalog (S2-2, docs/plans/2026-08-02-multi-stage-school-architecture.md):
     * the UNION of the legacy `LEVEL_CODE_TO_AR` map in js/utils.js and the legacy
     * `LEVEL_CODES` array in main/db/exam-count-defaults.js, excluding the `'*'`
     * "all levels" adapter row (kept only inside the `appDefaults:listLevels` handler).
     * Where name/order differed between the two legacy catalogs, js/utils.js wins
     * (grades UI depends on those exact names/orders).
     * Order = the js/utils.js insertion order (TCS*, 1BAC*, 2BAC* grouping).
     */
    const LEVEL_ENTRIES = [
        { code: 'TCSF', name: 'الجذع المشترك العلمي خيار فرنسية', order: 1 },
        { code: 'TCSA', name: 'الجذع المشترك العلمي خيار عربية', order: 2 },
        { code: 'TCS', name: 'الجذع المشترك العلمي', order: 1 },
        { code: 'TCLSH', name: 'الجذع المشترك للآداب والعلوم الإنسانية', order: 3 },
        { code: 'TCL', name: 'الجذع المشترك للآداب والعلوم الإنسانية', order: 3 },
        { code: 'TCTF', name: 'الجذع المشترك التكنولوجي', order: 4 },
        { code: '1BACSMF', name: 'الأولى باكالوريا علوم رياضية خيار فرنسية', order: 5 },
        { code: '1BACSMA', name: 'الأولى باكالوريا علوم رياضية خيار عربية', order: 6 },
        { code: '1BACSM', name: 'الأولى باكالوريا العلوم الرياضية', order: 5 },
        { code: '1BACSEF', name: 'الأولى باكالوريا علوم تجريبية خيار فرنسية', order: 7 },
        { code: '1BACSEA', name: 'الأولى باكالوريا علوم تجريبية خيار عربية', order: 8 },
        { code: '1BACSE', name: 'الأولى باكالوريا علوم تجريبية', order: 7 },
        { code: '1BACSH', name: 'الأولى باكالوريا آداب وعلوم إنسانية', order: 9 },
        { code: '1BACL', name: 'الأولى باكالوريا آداب وعلوم إنسانية', order: 9 },
        { code: '1BACSEG', name: 'الأولى باكالوريا علوم الإقتصاد والتدبير', order: 10 },
        { code: '1BACECO', name: 'الأولى باكالوريا علوم الإقتصاد والتدبير', order: 10 },
        { code: '1BACGE', name: 'الأولى باكالوريا علوم الإقتصاد والتدبير', order: 10 },
        { code: '2BACSMA', name: 'الثانية باكالوريا علوم رياضية أ', order: 11 },
        { code: '2BACSMB', name: 'الثانية باكالوريا علوم رياضية ب', order: 12 },
        { code: '2BACSM', name: 'الثانية باكالوريا علوم رياضية', order: 11 },
        { code: '2BACSVTF', name: 'الثانية باكالوريا علوم الحياة والأرض', order: 13 },
        { code: '2BACSVT', name: 'الثانية باكالوريا علوم الحياة والأرض', order: 13 },
        { code: '2BACPCF', name: 'الثانية باكالوريا علوم فيزيائية خيار فرنسية', order: 14 },
        { code: '2BACPC', name: 'الثانية باكالوريا علوم فيزيائية', order: 14 },
        { code: '2BACSPF', name: 'الثانية باكالوريا علوم فيزيائية خيار فرنسية', order: 14 },
        { code: '2BACSP', name: 'الثانية باكالوريا علوم فيزيائية', order: 14 },
        { code: '2BACSHF', name: 'الثانية باكالوريا آداب وعلوم إنسانية', order: 15 },
        { code: '2BACSH', name: 'الثانية باكالوريا آداب وعلوم إنسانية', order: 15 },
        { code: '2BACL', name: 'الثانية باكالوريا آداب وعلوم إنسانية', order: 15 },
        { code: '2BACLETF', name: 'الثانية باكالوريا آداب', order: 16 },
        { code: '2BACLET', name: 'الثانية باكالوريا آداب', order: 16 },
        { code: '2BACSECF', name: 'الثانية باكالوريا علوم الإقتصاد والتدبير', order: 17 },
        { code: '2BACSEC', name: 'الثانية باكالوريا علوم الإقتصاد والتدبير', order: 17 },
        { code: '2BACSE', name: 'الثانية باكالوريا علوم الإقتصاد والتدبير', order: 17 },
        { code: '2BACECO', name: 'الثانية باكالوريا علوم الإقتصاد والتدبير', order: 17 },
        { code: '2BACSGCF', name: 'الثانية باكالوريا علوم التدبير المحاسباتي', order: 18 },
        { code: '2BACSGC', name: 'الثانية باكالوريا علوم التدبير المحاسباتي', order: 18 },
        { code: '2BACGC', name: 'الثانية باكالوريا علوم التدبير المحاسباتي', order: 18 },
        { code: '2BACSA', name: 'الثانية باكالوريا علوم شرعية', order: 19 },
        { code: '2BACOAF', name: 'الثانية باكالوريا تعليم أصيل', order: 20 },
        { code: '2BACAO', name: 'الثانية باكالوريا تعليم أصيل', order: 20 }
    ];

    const QUALIFIANT_LEVELS = Object.freeze(
        LEVEL_ENTRIES.map((entry) => Object.freeze({ code: entry.code, name: entry.name, order: entry.order }))
    );

    const LEVEL_CODE_TO_AR = Object.freeze(
        QUALIFIANT_LEVELS.reduce((map, entry) => {
            map[entry.code] = Object.freeze({ name: entry.name, order: entry.order });
            return map;
        }, {})
    );

    const LEVEL_KEYS_DESC = Object.freeze(Object.keys(LEVEL_CODE_TO_AR).sort((a, b) => b.length - a.length));

    /**
     * تحويل رمز القسم إلى كائن { code, name, order }
     * @param {string} section - رمز القسم (مثل "TCSF-1")
     * @returns {{ code: string, name: string, order: number }}
     */
    function matchLevelFromSection(section) {
        if (!section) return { code: 'other', name: 'أخرى', order: 99 };
        const s = String(section).trim();
        const upper = s
            .toUpperCase()
            .replace(/[-_\s]?\d+$/, '')
            .trim();
        for (const key of LEVEL_KEYS_DESC) {
            if (upper === key || upper.startsWith(key)) {
                const info = LEVEL_CODE_TO_AR[key];
                return { code: key.toLowerCase(), name: info.name, order: info.order };
            }
        }
        if (upper.startsWith('TC')) return { code: 'tc', name: 'الجذع المشترك', order: 90 };
        if (upper.startsWith('1BAC')) return { code: '1bac', name: 'الأولى باكالوريا', order: 91 };
        if (upper.startsWith('2BAC')) return { code: '2bac', name: 'الثانية باكالوريا', order: 92 };
        return { code: 'other', name: section, order: 99 };
    }

    const api = Object.freeze({
        QUALIFIANT_LEVELS,
        LEVEL_CODE_TO_AR,
        LEVEL_KEYS_DESC,
        matchLevelFromSection
    });
    global.EducationQualifiantLevels = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
