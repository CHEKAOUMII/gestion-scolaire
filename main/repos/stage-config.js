'use strict';

/**
 * Stage-scoped configuration (isolation plan Slice 5, §"Slice 5 — Configuration
 * isolation"): calendars, term structures, and attendance rules resolved per
 * stage, keyed `(school_year, cycle_code, config_key)`.
 *
 * Design notes (do not regress):
 * - `education_subjects` stays ONE institution-wide shared catalog (global PK by
 *   design). Stage binding happens via per-stage rule/profile rows
 *   (`stage_rule_sets` dimensions, `cycle_profiles` + `cycle_profile_assignments`),
 *   never by forking the subject table — this module holds no subject catalog
 *   and must never gain one (see `tests/stage-config.test.js` no-fork guard).
 * - Per-cycle level catalogs (`primary-levels.js`, collegial codes,
 *   `qualifiant-levels.js` SSOT) stay authoritative, and the
 *   `appDefaults:listLevels` `*` compat row is deletion-forbidden (row 124).
 * - Coefficients / exam counts / subject weights resolve ONLY via
 *   `stage_rule_sets` dimensions + `source` shadowing — never via new global
 *   maps in this module.
 * - Missing config fails closed with `STAGE_CONFIG_MISSING`: resolution never
 *   falls back to the other stage's calendar/terms. Unknown cycles fail with
 *   `UNKNOWN_CYCLE`.
 * - Device-local data, like page-access permissions and app defaults (AGENTS.md
 *   "App Defaults and Page Access"): no entity-registry entry, no capture-port
 *   capture, zero outbox rows. Each deployed device configures its own stage
 *   calendars. No IPC channel exists yet: when the first consumer needs one,
 *   add it via the write-channel checklist with resolveCycleForRequest +
 *   assertCycleAuthorized, preload + CHANNEL_REGISTRY entries (exclude: true,
 *   device-local like app defaults — never synced).
 *
 * Global-constant inventory (Slice 5 audit — where each constant resolves):
 * - `education_subjects` subject catalog … institution-wide shared (by design).
 * - Per-cycle level catalogs … per-cycle SSOTs (kept).
 * - `DEFAULT_EXAM_COUNTS` (main/db/exam-count-defaults.js) … legacy labels only;
 *   counts resolve via `exam_count_rules` through `getActiveRuleSetForCycle`.
 * - `CC_BRANCH_COEFFICIENTS` / `CC_SUBJECT_WEIGHTS` (js/cc-rules.js) … legacy
 *   qualifiant compat fallback, narrowed to non-authoritative display paths;
 *   authoritative resolution is per-stage via the rule spine (Slice 2 owns the
 *   retirement; this module never reads those constants).
 * - Calendars / terms / attendance rules … THIS module, per
 *   `(school_year, cycle_code)`.
 */

const { isKnownCycleCode } = require('../../js/shared/education/cycles');
const { STAGE_CONFIG_ERROR_CODES } = require('../../js/shared/errors/stage-config-error-contract');

const STAGE_CONFIG_TABLE = 'stage_configs';

/** Closed set of stage-scoped config keys — never a free-form string. */
const STAGE_CONFIG_KEYS = Object.freeze({
    CALENDAR: 'calendar',
    TERMS: 'terms',
    ATTENDANCE_RULES: 'attendance_rules'
});
const KNOWN_CONFIG_KEYS = new Set(Object.values(STAGE_CONFIG_KEYS));

const SCHOOL_YEAR_PATTERN = /^\d{4}\/\d{4}$/;

function createStageConfigError(code, message, details) {
    const error = new Error(message);
    error.code = code;
    if (details && typeof details === 'object') error.details = details;
    return error;
}

function requireSchoolYearValue(schoolYear) {
    const year = String(schoolYear || '').trim();
    if (!SCHOOL_YEAR_PATTERN.test(year)) {
        throw createStageConfigError(
            STAGE_CONFIG_ERROR_CODES.STAGE_CONFIG_INVALID,
            'السنة الدراسية غير صالحة (YYYY/YYYY)'
        );
    }
    return year;
}

function requireKnownCycle(cycleCode) {
    const code = String(cycleCode || '').trim();
    if (!isKnownCycleCode(code)) {
        throw createStageConfigError(
            STAGE_CONFIG_ERROR_CODES.UNKNOWN_CYCLE,
            'السلك التعليمي غير معروف',
            { cycleCode: code }
        );
    }
    return code;
}

function requireKnownKey(configKey) {
    const key = String(configKey || '').trim();
    if (!KNOWN_CONFIG_KEYS.has(key)) {
        throw createStageConfigError(
            STAGE_CONFIG_ERROR_CODES.STAGE_CONFIG_INVALID,
            `مفتاح إعداد المرحلة غير معروف: ${key}`,
            { configKey: key }
        );
    }
    return key;
}

function requirePlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw createStageConfigError(
            STAGE_CONFIG_ERROR_CODES.STAGE_CONFIG_INVALID,
            'قيمة إعداد المرحلة يجب أن تكون كائناً (object)'
        );
    }
    return value;
}

/**
 * Idempotent DDL for the stage-config table. Safe to call on every access
 * (CREATE TABLE IF NOT EXISTS + index); creates local data only, zero outbox
 * rows. A future migration may adopt this shape via `ensureStageConfigSchema`
 * — the statement must stay byte-compatible with that migration.
 */
function ensureStageConfigSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ${STAGE_CONFIG_TABLE} (
            school_year TEXT NOT NULL,
            cycle_code TEXT NOT NULL,
            config_key TEXT NOT NULL,
            config_json TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (school_year, cycle_code, config_key)
        );
    `);
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_stage_configs_year_cycle
        ON ${STAGE_CONFIG_TABLE} (school_year, cycle_code);
    `);
}

/**
 * Resolve one stage config row. Fail-closed: unknown cycle → UNKNOWN_CYCLE,
 * missing row → STAGE_CONFIG_MISSING (never the other stage's row).
 *
 * @returns {{ schoolYear: string, cycleCode: string, configKey: string, value: object, updatedAt: string|null }}
 */
function resolveStageConfig(db, schoolYear, cycleCode, configKey) {
    const year = requireSchoolYearValue(schoolYear);
    const cycle = requireKnownCycle(cycleCode);
    const key = requireKnownKey(configKey);
    ensureStageConfigSchema(db);
    const row = db
        .prepare(
            `SELECT school_year, cycle_code, config_key, config_json, updated_at
             FROM ${STAGE_CONFIG_TABLE}
             WHERE school_year = ? AND cycle_code = ? AND config_key = ?
             LIMIT 1`
        )
        .get(year, cycle, key);
    if (!row) {
        throw createStageConfigError(
            STAGE_CONFIG_ERROR_CODES.STAGE_CONFIG_MISSING,
            'لا يوجد إعداد لهذا السلك في هذه السنة الدراسية',
            { schoolYear: year, cycleCode: cycle, configKey: key }
        );
    }
    let value;
    try {
        value = JSON.parse(row.config_json);
    } catch {
        throw createStageConfigError(
            STAGE_CONFIG_ERROR_CODES.STAGE_CONFIG_INVALID,
            'بيانات إعداد المرحلة المخزنة تالفة',
            { schoolYear: year, cycleCode: cycle, configKey: key }
        );
    }
    return {
        schoolYear: row.school_year,
        cycleCode: row.cycle_code,
        configKey: row.config_key,
        value,
        updatedAt: row.updated_at || null
    };
}

/**
 * Upsert one stage config row (device-local write — no sync capture).
 * @returns {{ schoolYear: string, cycleCode: string, configKey: string }}
 */
function saveStageConfig(db, { schoolYear, cycleCode, configKey, value }) {
    const year = requireSchoolYearValue(schoolYear);
    const cycle = requireKnownCycle(cycleCode);
    const key = requireKnownKey(configKey);
    requirePlainObject(value);
    let serialized;
    try {
        serialized = JSON.stringify(value);
    } catch {
        throw createStageConfigError(
            STAGE_CONFIG_ERROR_CODES.STAGE_CONFIG_INVALID,
            'قيمة إعداد المرحلة غير قابلة للتخزين (JSON)'
        );
    }
    ensureStageConfigSchema(db);
    db.prepare(
        `INSERT INTO ${STAGE_CONFIG_TABLE} (school_year, cycle_code, config_key, config_json, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT (school_year, cycle_code, config_key)
         DO UPDATE SET config_json = excluded.config_json, updated_at = CURRENT_TIMESTAMP`
    ).run(year, cycle, key, serialized);
    return { schoolYear: year, cycleCode: cycle, configKey: key };
}

/** List every config key stored for one (school year, stage) — never cross-stage. */
function listStageConfigs(db, schoolYear, cycleCode) {
    const year = requireSchoolYearValue(schoolYear);
    const cycle = requireKnownCycle(cycleCode);
    ensureStageConfigSchema(db);
    return db
        .prepare(
            `SELECT config_key AS configKey, config_json AS configJson, updated_at AS updatedAt
             FROM ${STAGE_CONFIG_TABLE}
             WHERE school_year = ? AND cycle_code = ?
             ORDER BY config_key`
        )
        .all(year, cycle)
        .map((row) => {
            let value = null;
            try {
                value = JSON.parse(row.configJson);
            } catch {
                value = null;
            }
            return { configKey: row.configKey, value, updatedAt: row.updatedAt || null };
        });
}

module.exports = {
    STAGE_CONFIG_TABLE,
    STAGE_CONFIG_KEYS,
    STAGE_CONFIG_ERROR_CODES,
    ensureStageConfigSchema,
    resolveStageConfig,
    saveStageConfig,
    listStageConfigs
};
