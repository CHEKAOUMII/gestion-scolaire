(function (global) {
    'use strict';

    /**
     * Three-state cycle capability model (S1, docs/plans/2026-08-02-multi-stage-school-architecture.md §3 S1):
     *   - `hidden`    — not listed, not selectable;
     *   - `preview`   — listed as «قيد الإعداد», never resolvable as a work cycle;
     *   - `supported` — selectable and workable.
     * The legacy pre-S1 vocabulary `not_supported` is retired from the catalog: the
     * catalog uses the `preview` literal directly. `normalizeCapability` remains only
     * as a documented data-compat mapping for legacy DB rows (never for catalog input).
     */
    const KNOWN_CAPABILITIES = Object.freeze({ hidden: 'hidden', preview: 'preview', supported: 'supported' });
    const CAPABILITY_LEGACY_DATA_ALIASES = Object.freeze({ not_supported: 'preview' });

    function normalizeCapability(capability) {
        const value = String(capability || '').trim();
        return CAPABILITY_LEGACY_DATA_ALIASES[value] || KNOWN_CAPABILITIES[value] || 'preview';
    }

    const PRIMARY_CYCLE = 'primary';
    const COLLEGIAL_CYCLE = 'secondary_collegial';
    const QUALIFIANT_CYCLE = 'secondary_qualifiant';

    const CYCLE_CATALOG = Object.freeze([
        Object.freeze({
            cycleCode: PRIMARY_CYCLE,
            labelAr: 'سلك التعليم الابتدائي',
            labelFr: 'Enseignement primaire',
            sortOrder: 5,
            profileVersion: 'primary-2026-v1',
            capability: 'preview',
            assessmentModel: 'continuous'
        }),
        Object.freeze({
            cycleCode: COLLEGIAL_CYCLE,
            labelAr: 'السلك الثانوي الإعدادي',
            labelFr: 'Secondaire collégial',
            sortOrder: 10,
            profileVersion: 'collegial-2026-v1',
            capability: 'supported',
            assessmentModel: 'exams_activities'
        }),
        Object.freeze({
            cycleCode: QUALIFIANT_CYCLE,
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
        // Collegial is matched before primary on purpose: `1APIC` begins with `1AP`,
        // and the anchored `(?:-|$)` suffix alone cannot tell them apart before the
        // APIC branch is tried.
        if (/^[123]APIC(?:-|$)/i.test(value)) return COLLEGIAL_CYCLE;
        if (/^[1-6]AP(?:-|$)/i.test(value)) return PRIMARY_CYCLE;
        if (/^(?:[123]BAC|TCS|TCL)(?:[A-Z0-9-]*|$)/i.test(value)) return QUALIFIANT_CYCLE;
        return null;
    }

    function inferCycleFromLevel(level) {
        const raw = String(level || '').trim();
        const value = normalizePlacementValue(level);
        if (!value && !raw) return null;
        if (/^[123]APIC(?:-|$)/i.test(value) || /(?:الأولى|الثانية|الثالثة)\s*إعدادي/i.test(raw)) {
            return COLLEGIAL_CYCLE;
        }
        if (/^[1-6]AP(?:-|$)/i.test(value) || /(?:الأولى|الثانية|الثالثة|الرابعة|الخامسة|السادسة)\s*ابتدائي/i.test(raw)) {
            return PRIMARY_CYCLE;
        }
        if (/^(?:[123]BAC|TCS|TCL)/i.test(value) || /باكالوريا|باك|الجذع\s*المشترك/i.test(raw)) {
            return QUALIFIANT_CYCLE;
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
        PRIMARY_CYCLE,
        COLLEGIAL_CYCLE,
        QUALIFIANT_CYCLE,
        CYCLE_CATALOG,
        getCycleDefinition,
        isKnownCycleCode,
        normalizeCapability,
        inferCycleFromSection,
        inferCycleFromLevel,
        inferEducationPlacement
    });
    global.EducationCycles = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
