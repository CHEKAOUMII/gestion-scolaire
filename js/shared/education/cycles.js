(function (global) {
    'use strict';

    const CYCLE_CATALOG = Object.freeze([
        Object.freeze({
            cycleCode: 'secondary_collegial',
            labelAr: 'السلك الثانوي الإعدادي',
            labelFr: 'Secondaire collégial',
            sortOrder: 10,
            profileVersion: 'collegial-2026-v1',
            capability: 'not_supported'
        }),
        Object.freeze({
            cycleCode: 'secondary_qualifiant',
            labelAr: 'السلك الثانوي التأهيلي',
            labelFr: 'Secondaire qualifiant',
            sortOrder: 20,
            profileVersion: 'qualifiant-2026-v1',
            capability: 'supported'
        })
    ]);

    const CYCLE_BY_CODE = new Map(CYCLE_CATALOG.map((cycle) => [cycle.cycleCode, cycle]));

    function getCycleDefinition(cycleCode) {
        return CYCLE_BY_CODE.get(String(cycleCode || '').trim()) || null;
    }

    function isKnownCycleCode(cycleCode) {
        return !!getCycleDefinition(cycleCode);
    }

    function normalizePlacementValue(value) {
        return String(value || '')
            .trim()
            .replace(/[\u2010-\u2015]/g, '-')
            .replace(/[\s_]+/g, '')
            .toUpperCase();
    }

    function inferCycleFromSection(section) {
        const value = normalizePlacementValue(section);
        if (!value) return null;
        if (/^[123]APIC(?:-|$)/i.test(value)) return 'secondary_collegial';
        if (/^(?:[123]BAC|TCS|TCL)(?:[A-Z0-9-]*|$)/i.test(value)) return 'secondary_qualifiant';
        return null;
    }

    function inferCycleFromLevel(level) {
        const raw = String(level || '').trim();
        const value = normalizePlacementValue(level);
        if (!value && !raw) return null;
        if (/^[123]APIC(?:-|$)/i.test(value) || /(?:الأولى|الثانية|الثالثة)\s*إعدادي/i.test(raw)) {
            return 'secondary_collegial';
        }
        if (/^(?:[123]BAC|TCS|TCL)/i.test(value) || /باكالوريا|باك|الجذع\s*المشترك/i.test(raw)) {
            return 'secondary_qualifiant';
        }
        return null;
    }

    function inferEducationPlacement({ section, level } = {}) {
        const sectionCycle = inferCycleFromSection(section);
        const levelCycle = inferCycleFromLevel(level);
        if (sectionCycle && levelCycle && sectionCycle !== levelCycle) return null;
        return sectionCycle || levelCycle || null;
    }

    const api = Object.freeze({
        CYCLE_CATALOG,
        getCycleDefinition,
        isKnownCycleCode,
        inferCycleFromSection,
        inferCycleFromLevel,
        inferEducationPlacement
    });
    global.EducationCycles = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
