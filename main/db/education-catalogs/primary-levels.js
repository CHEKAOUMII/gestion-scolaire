'use strict';

/**
 * Level catalogs for the primary and collegial cycles
 * (docs/plans/2026-08-01-primary-stage-catalogs.md, S2).
 * The qualifiant catalog stays in main/db/exam-count-defaults.js (LEVEL_CODES);
 * the per-cycle shape here mirrors it so appDefaults:listLevels can serve one
 * catalog per cycle without changing the legacy qualifiant shape.
 */

const PRIMARY_LEVEL_CODES = [
    { code: '1AP', name: 'الأولى ابتدائي', order: 1 },
    { code: '2AP', name: 'الثانية ابتدائي', order: 2 },
    { code: '3AP', name: 'الثالثة ابتدائي', order: 3 },
    { code: '4AP', name: 'الرابعة ابتدائي', order: 4 },
    { code: '5AP', name: 'الخامسة ابتدائي', order: 5 },
    { code: '6AP', name: 'السادسة ابتدائي', order: 6 }
];

const COLLEGIAL_LEVEL_CODES = [
    { code: '1APIC', name: 'الأولى إعدادي', order: 1 },
    { code: '2APIC', name: 'الثانية إعدادي', order: 2 },
    { code: '3APIC', name: 'الثالثة إعدادي', order: 3 }
];

const ALL_LEVEL_CODES = [...PRIMARY_LEVEL_CODES, ...COLLEGIAL_LEVEL_CODES];

module.exports = {
    PRIMARY_LEVEL_CODES,
    COLLEGIAL_LEVEL_CODES,
    ALL_LEVEL_CODES
};
