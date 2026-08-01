'use strict';

var canonicalKeyModule = require('../canonical-key.js');
var toCanonical = canonicalKeyModule.toCanonical;

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function describeType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

function error(type, message, field, details) {
    var result = { type: type, message: message, field: field };
    if (details) result.details = details;
    return result;
}

function validateStringArray(value, field, errors) {
    if (!Array.isArray(value)) {
        errors.push(error(
            'invalid_field_type',
            'Field "' + field + '" must be an array when present.',
            field,
            { expectedType: 'array', actualType: describeType(value) }
        ));
        return;
    }
    for (var i = 0; i < value.length; i += 1) {
        if (typeof value[i] !== 'string' || value[i].length === 0) {
            errors.push(error(
                'invalid_field_value',
                'Field "' + field + '" must contain non-empty strings.',
                field + '[' + i + ']'
            ));
        }
    }
}

function validateLoad(load, field, errors) {
    if (!isPlainObject(load)) {
        errors.push(error(
            'invalid_field_type',
            'Each cross-cycle proctor load must be a plain object.',
            field,
            { expectedType: 'object', actualType: describeType(load) }
        ));
        return;
    }
    var countFields = ['guardCount', 'dutyCount', 'reserveCount', 'amCount', 'pmCount'];
    for (var i = 0; i < countFields.length; i += 1) {
        var countField = countFields[i];
        if (countField in load && (typeof load[countField] !== 'number'
            || !Number.isFinite(load[countField]) || load[countField] < 0)) {
            errors.push(error(
                'invalid_field_value',
                'Cross-cycle load counts must be finite non-negative numbers.',
                field + '.' + countField
            ));
        }
    }
    var setFields = [
        'guardSessions', 'guardHalfdays', 'reserveSessions',
        'reserveHalfdays', 'dutyHalfdays', 'teachingSessions'
    ];
    for (var j = 0; j < setFields.length; j += 1) {
        var setField = setFields[j];
        if (setField in load) validateStringArray(load[setField], field + '.' + setField, errors);
    }
}

function validateCrossCycleResources(resources) {
    var errors = [];
    if (!isPlainObject(resources)) {
        return {
            valid: false,
            errors: [error(
                'invalid_field_type',
                'Field "crossCycleResources" must be a plain object when present.',
                'crossCycleResources',
                { expectedType: 'object', actualType: describeType(resources) }
            )]
        };
    }
    if (resources.scopeCycles !== 'all') {
        errors.push(error(
            'cross_cycle_scope_required',
            'crossCycleResources.scopeCycles must explicitly be "all".',
            'crossCycleResources.scopeCycles',
            { expected: 'all', actual: resources.scopeCycles }
        ));
    }
    if (typeof resources.policyCycle !== 'string' || resources.policyCycle.trim() === '') {
        errors.push(error(
            'missing_policy_cycle',
            'crossCycleResources.policyCycle must be a non-empty string.',
            'crossCycleResources.policyCycle'
        ));
    }
    if ('proctorLoads' in resources) {
        if (!isPlainObject(resources.proctorLoads)) {
            errors.push(error(
                'invalid_field_type',
                'crossCycleResources.proctorLoads must be a plain object.',
                'crossCycleResources.proctorLoads',
                { expectedType: 'object', actualType: describeType(resources.proctorLoads) }
            ));
        } else {
            var loadKeys = Object.keys(resources.proctorLoads);
            for (var i = 0; i < loadKeys.length; i += 1) {
                validateLoad(resources.proctorLoads[loadKeys[i]],
                    'crossCycleResources.proctorLoads.' + loadKeys[i], errors);
            }
        }
    }
    if ('teachingSessions' in resources) {
        if (!isPlainObject(resources.teachingSessions)) {
            errors.push(error(
                'invalid_field_type',
                'crossCycleResources.teachingSessions must be a plain object.',
                'crossCycleResources.teachingSessions',
                { expectedType: 'object', actualType: describeType(resources.teachingSessions) }
            ));
        } else {
            var teachingKeys = Object.keys(resources.teachingSessions);
            for (var j = 0; j < teachingKeys.length; j += 1) {
                validateStringArray(
                    resources.teachingSessions[teachingKeys[j]],
                    'crossCycleResources.teachingSessions.' + teachingKeys[j],
                    errors
                );
            }
        }
    }
    return { valid: errors.length === 0, errors: errors };
}

function cloneStringArray(values) {
    return Array.isArray(values) ? values.slice() : [];
}

function normalizeKeyedLoads(loads, adapter, orphanInputKeys) {
    var normalized = {};
    if (!isPlainObject(loads)) return normalized;
    var externalKeys = Object.keys(loads).sort();
    for (var i = 0; i < externalKeys.length; i += 1) {
        var externalKey = externalKeys[i];
        var canonical = toCanonical(adapter, externalKey);
        if (canonical === null) {
            orphanInputKeys.push({
                source: 'crossCycleResources.proctorLoads',
                externalKey: externalKey
            });
            continue;
        }
        normalized[canonical] = Object.assign({}, loads[externalKey]);
        var load = normalized[canonical];
        var setFields = [
            'guardSessions', 'guardHalfdays', 'reserveSessions',
            'reserveHalfdays', 'dutyHalfdays', 'teachingSessions'
        ];
        for (var j = 0; j < setFields.length; j += 1) {
            var setField = setFields[j];
            if (setField in load) load[setField] = cloneStringArray(load[setField]);
        }
    }
    return normalized;
}

function normalizeTeachingSessions(teachingSessions, adapter, orphanInputKeys) {
    var normalized = {};
    if (!isPlainObject(teachingSessions)) return normalized;
    var externalKeys = Object.keys(teachingSessions).sort();
    for (var i = 0; i < externalKeys.length; i += 1) {
        var externalKey = externalKeys[i];
        var canonical = toCanonical(adapter, externalKey);
        if (canonical === null) {
            orphanInputKeys.push({
                source: 'crossCycleResources.teachingSessions',
                externalKey: externalKey
            });
            continue;
        }
        normalized[canonical] = cloneStringArray(teachingSessions[externalKey]);
    }
    return normalized;
}

function normalizeCrossCycleResources(resources, adapter, orphanInputKeys) {
    if (!isPlainObject(resources)) return null;
    var normalized = {
        scopeCycles: resources.scopeCycles,
        policyCycle: resources.policyCycle,
        proctorLoads: normalizeKeyedLoads(resources.proctorLoads, adapter, orphanInputKeys),
        teachingSessions: normalizeTeachingSessions(resources.teachingSessions, adapter, orphanInputKeys)
    };
    return normalized;
}

module.exports = {
    validateCrossCycleResources: validateCrossCycleResources,
    normalizeCrossCycleResources: normalizeCrossCycleResources,
    _internals: {
        isPlainObject: isPlainObject
    }
};
