/**
 * Student profile tab field allowlist — single source of truth for
 * main/ipc/student-profile.js (sanitize) and renderer docs/tests.
 *
 * Unknown keys are stripped on save; values must be scalars or arrays of scalars.
 */
(function (global) {
    'use strict';

    const PROFILE_TAB_ALLOWLIST = {
        economic: [
            'eco_status',
            'income_source',
            'family_size',
            'schooling_children',
            'distance_km',
            'transport',
            'support_programs',
            'unmet_needs',
            'notes'
        ],
        social: [
            'family_status',
            'parents_edu',
            'housing',
            'study_place',
            'teachers_rel',
            'peers_rel',
            'social_risks',
            'notes'
        ],
        health: [
            'health_gen',
            'disability',
            'learning_disorders',
            'sleep',
            'nutrition',
            'substances',
            'chronic',
            'treatment',
            'mood',
            'motivation',
            'confidence',
            'psych_symptoms',
            'psych_support',
            'psych_referral',
            'health_notes',
            'psych_notes'
        ],
        followup: [
            'guardian_name',
            'guardian_phone',
            'calls_count',
            'meetings_count',
            'last_contact',
            'actions_taken',
            'interview_notes',
            'plan_notes',
            'next_date'
        ],
        guidance: [
            'current_stream',
            'lit_arabic',
            'lit_french',
            'lit_english',
            'lit_philosophy',
            'lit_history',
            'sci_math',
            'sci_physics',
            'sci_svt',
            'lit_avg',
            'sci_avg',
            'alignment_score',
            'analysis_title',
            'analysis_body',
            'linked_from_grades',
            'source_subjects',
            'notes'
        ]
    };

    /** Maximum length of the serialized data_json payload accepted by saveTab. */
    const PROFILE_TAB_MAX_JSON = 16000;

    const PROFILE_TAB_KEYS = Object.freeze(Object.keys(PROFILE_TAB_ALLOWLIST));

    const api = {
        PROFILE_TAB_ALLOWLIST,
        PROFILE_TAB_MAX_JSON,
        PROFILE_TAB_KEYS
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    global.StudentProfileFields = api;
})(typeof window !== 'undefined' ? window : globalThis);
