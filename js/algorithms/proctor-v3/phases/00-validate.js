// Proctor Distribution V3 — Phase 0: Validate Input.
//
// Pure function: inspects the raw input contract and returns either a
// success result `{ valid: true, errors: [] }` or a failure result
// `{ valid: false, errors: [...] }` where each error is a structured object
// of the shape `{ type, message, field?, details? }`.
//
// This phase only checks coarse-grained shape (presence and basic types) of
// the top-level fields the rest of the pipeline depends on. Finer-grained
// validation (e.g., per-row schedule entry shape, per-room invariants) is
// performed by later phases that own that domain.
//
// Required fields (per Acceptance Criterion 1.3 and design.md Phase 0):
//   - proctorsList         : non-null array
//   - scheduleEntries      : non-null array
//   - examDistributionRules: non-null plain object
//
// Optional fields validated when present:
//   - examCenterLevels     : when present, must be a plain object whose
//                            values are objects (lenient — only top-level
//                            shape is enforced here)
//
// V2 pitfall avoided (Task 23 of tasks.md): V2 emitted errors as plain
// strings, which made downstream programmatic handling and serialization
// brittle. V3 emits structured error objects so callers can branch on
// `error.type` and surface details consistently.

'use strict';

var crossCycleModule = require('../constraints/cross-cycle.js');
var validateCrossCycleResources = crossCycleModule.validateCrossCycleResources;

/**
 * @typedef {Object} ValidationError
 * @property {string} type    - Stable machine-readable error code (snake_case).
 * @property {string} message - Human-readable English message.
 * @property {string} [field] - Dotted path of the offending field (when applicable).
 * @property {Object} [details] - Optional structured context.
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {ValidationError[]} errors
 */

function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    return true;
}

function describeType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

/**
 * Validate the top-level shape of the GS3_Input_Contract.
 *
 * Always returns synchronously; never throws on malformed input. Callers
 * should treat a `valid: false` return as a hard stop and surface
 * `errors` to the user/diagnostics rather than proceeding with downstream
 * phases.
 *
 * @param {unknown} input - the raw input passed to the orchestrator
 * @returns {ValidationResult}
 */
function validateInput(input) {
    var errors = [];

    if (input === null || input === undefined) {
        errors.push({
            type: 'missing_input',
            message: 'Input is null or undefined.',
            field: 'input'
        });
        return { valid: false, errors: errors };
    }

    if (!isPlainObject(input)) {
        errors.push({
            type: 'invalid_input_type',
            message: 'Input must be a plain object.',
            field: 'input',
            details: { actualType: describeType(input) }
        });
        return { valid: false, errors: errors };
    }

    // ---- Required field: proctorsList -------------------------------------
    if (!('proctorsList' in input) || input.proctorsList === undefined || input.proctorsList === null) {
        errors.push({
            type: 'missing_field',
            message: 'Required field "proctorsList" is missing.',
            field: 'proctorsList'
        });
    } else if (!Array.isArray(input.proctorsList)) {
        errors.push({
            type: 'invalid_field_type',
            message: 'Field "proctorsList" must be an array.',
            field: 'proctorsList',
            details: {
                expectedType: 'array',
                actualType: describeType(input.proctorsList)
            }
        });
    }

    // ---- Required field: scheduleEntries ----------------------------------
    if (!('scheduleEntries' in input) || input.scheduleEntries === undefined || input.scheduleEntries === null) {
        errors.push({
            type: 'missing_field',
            message: 'Required field "scheduleEntries" is missing.',
            field: 'scheduleEntries'
        });
    } else if (!Array.isArray(input.scheduleEntries)) {
        errors.push({
            type: 'invalid_field_type',
            message: 'Field "scheduleEntries" must be an array.',
            field: 'scheduleEntries',
            details: {
                expectedType: 'array',
                actualType: describeType(input.scheduleEntries)
            }
        });
    }

    // ---- Required field: examDistributionRules ----------------------------
    if (!('examDistributionRules' in input) || input.examDistributionRules === undefined || input.examDistributionRules === null) {
        errors.push({
            type: 'missing_field',
            message: 'Required field "examDistributionRules" is missing.',
            field: 'examDistributionRules'
        });
    } else if (!isPlainObject(input.examDistributionRules)) {
        errors.push({
            type: 'invalid_field_type',
            message: 'Field "examDistributionRules" must be a plain object.',
            field: 'examDistributionRules',
            details: {
                expectedType: 'object',
                actualType: describeType(input.examDistributionRules)
            }
        });
    }

    // ---- Optional field: crossCycleResources -------------------------------
    if ('crossCycleResources' in input) {
        var crossCycleValidation = validateCrossCycleResources(input.crossCycleResources);
        if (!crossCycleValidation.valid) {
            errors = errors.concat(crossCycleValidation.errors);
        }
    }

    // ---- Optional field: examCenterLevels ---------------------------------
    // Lenient top-level check only. Each value should expose a `rooms` array
    // when present, but we don't fail validation on a missing or wrongly
    // typed `rooms` here — Phase 1b owns that responsibility and emits
    // diagnostics warnings for partial data. We DO fail the top-level shape
    // (object vs array vs primitive) since downstream code indexes into it
    // with bracket notation.
    if ('examCenterLevels' in input && input.examCenterLevels !== undefined && input.examCenterLevels !== null) {
        if (!isPlainObject(input.examCenterLevels)) {
            errors.push({
                type: 'invalid_field_type',
                message: 'Optional field "examCenterLevels" must be a plain object when present.',
                field: 'examCenterLevels',
                details: {
                    expectedType: 'object',
                    actualType: describeType(input.examCenterLevels)
                }
            });
        } else {
            var keys = Object.keys(input.examCenterLevels);
            for (var i = 0; i < keys.length; i += 1) {
                var levelKey = keys[i];
                var levelValue = input.examCenterLevels[levelKey];
                if (levelValue === null || levelValue === undefined) {
                    // Treat null/undefined values as absent — Phase 1b handles fallback.
                    continue;
                }
                if (!isPlainObject(levelValue)) {
                    errors.push({
                        type: 'invalid_field_type',
                        message:
                            'Each value in "examCenterLevels" must be a plain object when present.',
                        field: 'examCenterLevels.' + levelKey,
                        details: {
                            expectedType: 'object',
                            actualType: describeType(levelValue)
                        }
                    });
                }
            }
        }
    }

    if (errors.length > 0) {
        return { valid: false, errors: errors };
    }
    return { valid: true, errors: [] };
}

module.exports = { validateInput };
