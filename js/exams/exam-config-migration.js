/**
 * Migrate exam-center config keys from localStorage → SQLite (examConfig API).
 * Pure orchestration: storage + API are injected for testability.
 */
(function (global) {
    'use strict';

    const EXAM_LS_KEYS = [
        'examCenterConfig',
        'examCenterLevels',
        'examCenterRoomsData',
        'examCenterRoomsCount',
        'examScheduleData',
        'examAutoDistributionData',
        'examPeriodsData',
        'examDistributionRules',
        'examExemptionsData',
        'examDutyTeachersData',
        'examReservesData',
        'examMorningEveningData',
        'examAutoDistributionOptions',
        'examCandidatesData'
    ];

    /**
     * @param {object} deps
     * @param {string} deps.schoolYear
     * @param {{ examConfig: { get: Function, save: Function } }} deps.api
     * @param {{ getItem: Function, removeItem: Function }} [deps.storage]
     * @returns {Promise<{ migrated: number, skipped: number, failed: number }>}
     */
    async function migrateExamLocalStorageToDb(deps) {
        const schoolYear = deps && deps.schoolYear;
        const api = deps && deps.api;
        const storage = (deps && deps.storage) || (typeof global.localStorage !== 'undefined' ? global.localStorage : null);
        const examConfig = api && api.examConfig;

        if (!schoolYear || !examConfig || !storage) {
            return { migrated: 0, skipped: 0, failed: 0 };
        }

        let migrated = 0;
        let skipped = 0;
        let failed = 0;

        for (const key of EXAM_LS_KEYS) {
            const raw = storage.getItem(key);
            if (raw === null) continue;

            try {
                const existing = await examConfig.get(schoolYear, key);
                if (existing !== null) {
                    // Already migrated — remove stale localStorage copy
                    storage.removeItem(key);
                    skipped += 1;
                    continue;
                }

                let data;
                try {
                    data = JSON.parse(raw);
                } catch {
                    data = raw;
                }

                const res = await examConfig.save({
                    school_year: schoolYear,
                    config_key: key,
                    data
                });

                if (!res || res.success !== false) {
                    storage.removeItem(key);
                    migrated += 1;
                } else {
                    failed += 1;
                }
            } catch {
                failed += 1;
            }
        }

        return { migrated, skipped, failed };
    }

    const api = { EXAM_LS_KEYS, migrateExamLocalStorageToDb };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    global.ExamConfigMigration = api;
})(typeof window !== 'undefined' ? window : globalThis);
