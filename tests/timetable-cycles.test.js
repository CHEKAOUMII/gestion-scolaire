'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    TIMETABLE_LEGACY_MIGRATION_KEY,
    TIMETABLE_LEGACY_STORAGE_KEY,
    getTimetableStorageKey,
    loadAllCycleTimetables,
    migrateLegacyTimetableOnce
} = require('../js/shared/timetable-cycles.js');

function createStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        },
        removeItem(key) {
            values.delete(key);
        },
        has(key) {
            return values.has(key);
        }
    };
}

async function main() {
    assert.strictEqual(getTimetableStorageKey('secondary_qualifiant'), 'timetableData::secondary_qualifiant');
    assert.throws(() => getTimetableStorageKey(''), /cycleCode is required/);

    let loadAllCalls = 0;
    const allCycles = await loadAllCycleTimetables(
        async () => {
            loadAllCalls += 1;
            return {
                secondary_qualifiant: { timetables: { Q: {} } },
                secondary_collegial: { timetables: { C: {} } }
            };
        },
        ['secondary_qualifiant']
    );
    assert.strictEqual(loadAllCalls, 1, 'cross-cycle load must be explicit and single-shot');
    assert.deepStrictEqual(Object.keys(allCycles), ['secondary_qualifiant']);

    const storage = createStorage({
        [TIMETABLE_LEGACY_STORAGE_KEY]: JSON.stringify({ timetables: { Q: {} } })
    });
    let saveCalls = 0;
    const firstMigration = await migrateLegacyTimetableOnce({
        storage,
        loadCurrent: async () => null,
        saveCurrent: async (payload) => {
            saveCalls += 1;
            assert.deepStrictEqual(payload, { timetables: { Q: {} } });
            return { success: true };
        }
    });
    assert.strictEqual(firstMigration.status, 'migrated');
    assert.strictEqual(saveCalls, 1);
    assert.strictEqual(storage.has(TIMETABLE_LEGACY_STORAGE_KEY), false);
    assert.strictEqual(storage.getItem(TIMETABLE_LEGACY_MIGRATION_KEY), 'completed');

    const secondMigration = await migrateLegacyTimetableOnce({
        storage,
        loadCurrent: async () => null,
        saveCurrent: async () => {
            throw new Error('must not save twice');
        }
    });
    assert.strictEqual(secondMigration.status, 'already-completed');
    assert.strictEqual(saveCalls, 1);

    const failedStorage = createStorage({
        [TIMETABLE_LEGACY_STORAGE_KEY]: JSON.stringify({ timetables: {} })
    });
    await assert.rejects(
        () =>
            migrateLegacyTimetableOnce({
                storage: failedStorage,
                loadCurrent: async () => null,
                saveCurrent: async () => ({ success: false, error: 'rejected' })
            }),
        /rejected/
    );
    assert.strictEqual(failedStorage.has(TIMETABLE_LEGACY_STORAGE_KEY), true);
    assert.strictEqual(failedStorage.has(TIMETABLE_LEGACY_MIGRATION_KEY), false);

    const unavailableStorage = createStorage({
        [TIMETABLE_LEGACY_STORAGE_KEY]: JSON.stringify({ timetables: { Q: {} } })
    });
    await assert.rejects(
        () =>
            migrateLegacyTimetableOnce({
                storage: unavailableStorage,
                loadCurrent: async () => null,
                saveCurrent: async () => undefined
            }),
        /rejected/
    );
    assert.strictEqual(unavailableStorage.has(TIMETABLE_LEGACY_STORAGE_KEY), true);
    assert.strictEqual(unavailableStorage.has(TIMETABLE_LEGACY_MIGRATION_KEY), false);

    const pageSource = fs.readFileSync(path.join(__dirname, '..', 'js/pages/timetable.js'), 'utf8');
    const ipcSource = fs.readFileSync(path.join(__dirname, '..', 'main/ipc/timetable-data.js'), 'utf8');
    const htmlSource = fs.readFileSync(path.join(__dirname, '..', 'timetable.html'), 'utf8');
    assert.ok(pageSource.includes('async function loadAllCycleTimetables'));
    assert.ok(pageSource.includes('allCycles: true'));
    assert.ok(pageSource.includes('timetable-cycle-select'));
    assert.ok(pageSource.includes('setActive(select.value, getSchoolYear())'));
    assert.ok(pageSource.includes("activeTimetableCycleCode !== EducationCycles.QUALIFIANT_CYCLE"));
    assert.ok(pageSource.includes('response?.success === false'));
    assert.ok(ipcSource.includes('getAllBySchoolYear'));
    assert.ok(ipcSource.includes("cycle.capability === 'supported'"));
    assert.ok(htmlSource.includes('id="timetable-cycle-select"'));
    assert.ok(htmlSource.includes('js/shared/timetable-cycles.js'));
    assert.ok(htmlSource.includes('js/shared/education/cycles.js'), 'timetable.html loads the cycle catalog SSOT before timetable-cycles.js');

    console.log('timetable-cycles: OK');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
