'use strict';

/**
 * Primary-cycle import aliases (docs/plans/2026-08-01-primary-stage-catalogs.md, S2).
 * level_aliases are cycle-scoped (UNIQUE(cycle_code, normalized_alias)), so the
 * same ordinal word can map to 1AP here and to collegial levels there.
 */

const { PRIMARY_LEVEL_CODES } = require('./primary-levels');

/** Ordinal words for the six primary years (أولى … سادسة). */
const ORDINALS = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة'];

function buildLevelAliases() {
    const rows = [];
    for (const level of PRIMARY_LEVEL_CODES) {
        const ordinal = ORDINALS[level.order - 1];
        rows.push([level.code, level.code]);
        rows.push([ordinal, level.code]);
        rows.push([`السنة ${ordinal}`, level.code]);
        rows.push([`السنة ${level.order}`, level.code]);
    }
    return rows;
}

const LEVEL_ALIASES = buildLevelAliases();

/**
 * Normalize a level alias for level_aliases.normalized_alias: tashkeel-free,
 * alef/hamza-unified, تاء مربوطة (ة→ه) and ألف مقصورة (ى→ي) unified, spaced,
 * uppercase. Mirrors subject-catalog.normalizeAliasKey.
 */
function normalizeLevelAlias(text) {
    return String(text || '')
        .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g, '')
        .replace(/[إأآٱ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/_/g, ' ')
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\-\.]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Idempotent seed of primary level_aliases. Only missing aliases are written.
 */
function seedPrimaryLevelAliases(db) {
    const insertAlias = db.prepare(
        `INSERT OR IGNORE INTO level_aliases(cycle_code, raw_alias, normalized_alias, level_code, source)
         VALUES ('primary', ?, ?, ?, 'education-catalogs')`
    );
    const seed = db.transaction(() => {
        for (const [raw, levelCode] of LEVEL_ALIASES) {
            const normalized = normalizeLevelAlias(raw);
            if (!normalized) continue;
            insertAlias.run(raw, normalized, levelCode);
        }
    });
    seed();
}

module.exports = {
    LEVEL_ALIASES,
    normalizeLevelAlias,
    seedPrimaryLevelAliases
};
