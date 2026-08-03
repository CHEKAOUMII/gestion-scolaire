'use strict';

// Legacy subject-coefficient overrides were migrated into stage rule-set
// rows (migration 2026-08-078). This module is retained loadable for
// rollback support only: it no longer reads or writes the legacy settings
// key, and the override feature is retired (use stageRules instead).

const SETTINGS_KEY = 'subjectCoefficientMappings:v1';

function readMappings() {
    return [];
}

function overrideMapping() {
    const error = new Error('subject coefficient overrides are retired; use stageRules');
    error.code = 'RETIRED_SUBJECT_COEFFICIENT_OVERRIDE';
    throw error;
}

module.exports = {
    SETTINGS_KEY,
    readMappings,
    overrideMapping
};
