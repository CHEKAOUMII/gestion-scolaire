'use strict';

const TIMETABLE_LEGACY_STORAGE_KEY = 'timetableData';
const TIMETABLE_LEGACY_MIGRATION_KEY = 'timetableData::legacy-migration-v1';

function getTimetableStorageKey(cycleCode) {
    const normalizedCycleCode = String(cycleCode || '').trim();
    if (!normalizedCycleCode) throw new Error('cycleCode is required');
    return `${TIMETABLE_LEGACY_STORAGE_KEY}::${normalizedCycleCode}`;
}

function filterSupportedCycleTimetables(cycleTimetables, supportedCycleCodes) {
    if (!cycleTimetables || typeof cycleTimetables !== 'object' || Array.isArray(cycleTimetables)) return {};
    const allowed = supportedCycleCodes ? new Set(supportedCycleCodes.map((code) => String(code))) : null;
    return Object.fromEntries(
        Object.entries(cycleTimetables).filter(([cycleCode, timetable]) => {
            return (!allowed || allowed.has(cycleCode)) && timetable && typeof timetable === 'object';
        })
    );
}

async function loadAllCycleTimetables(loadAll, supportedCycleCodes) {
    if (typeof loadAll !== 'function') throw new TypeError('loadAll must be a function');
    const cycleTimetables = await loadAll();
    return filterSupportedCycleTimetables(cycleTimetables, supportedCycleCodes);
}

function assertLegacyPayload(rawPayload) {
    const parsedPayload = JSON.parse(rawPayload);
    if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) {
        throw new Error('Legacy timetable payload must be an object');
    }
    return parsedPayload;
}

async function migrateLegacyTimetableOnce({ storage, loadCurrent, saveCurrent }) {
    if (!storage || typeof storage.getItem !== 'function') throw new TypeError('storage is required');
    if (typeof loadCurrent !== 'function' || typeof saveCurrent !== 'function') {
        throw new TypeError('loadCurrent and saveCurrent are required');
    }

    if (storage.getItem(TIMETABLE_LEGACY_MIGRATION_KEY) === 'completed') {
        return { status: 'already-completed' };
    }

    const rawPayload = storage.getItem(TIMETABLE_LEGACY_STORAGE_KEY);
    if (rawPayload == null) {
        storage.setItem(TIMETABLE_LEGACY_MIGRATION_KEY, 'completed');
        return { status: 'no-legacy-data' };
    }

    const legacyPayload = assertLegacyPayload(rawPayload);
    const currentPayload = await loadCurrent();
    if (!currentPayload) {
        const saveResult = await saveCurrent(legacyPayload);
        if (!saveResult || saveResult.success !== true) {
            throw new Error(saveResult?.error || 'Legacy timetable migration was rejected');
        }
    }

    storage.removeItem(TIMETABLE_LEGACY_STORAGE_KEY);
    storage.setItem(TIMETABLE_LEGACY_MIGRATION_KEY, 'completed');
    return { status: currentPayload ? 'legacy-discarded-existing-data' : 'migrated' };
}

const api = {
    TIMETABLE_LEGACY_STORAGE_KEY,
    TIMETABLE_LEGACY_MIGRATION_KEY,
    getTimetableStorageKey,
    filterSupportedCycleTimetables,
    loadAllCycleTimetables,
    migrateLegacyTimetableOnce
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.TimetableCycles = api;
