/**
 * Unit tests for pure student-profile helpers (no DOM / Electron).
 */
const assert = require('assert');
const pure = require('../js/student-profile/pure');
const fields = require('../js/data/student-profile-fields');
const migration = require('../js/exams/exam-config-migration');

function testDedupeGrades() {
    const rows = [
        { subject: 'رياضيات', semester: 1, grade: 12 },
        { subject: 'رياضيات', semester: 1, grade: 14 },
        { subject: 'فيزياء', semester: 1, grade: 10 }
    ];
    const out = pure.dedupeGrades(rows);
    assert.strictEqual(out.length, 2);
    const math = out.find((g) => g.subject === 'رياضيات');
    assert.strictEqual(math.grade, 14, 'later row wins for same subject/semester');
    console.log('  [ok] dedupeGrades');
}

function testGradeColors() {
    assert.strictEqual(pure.gradeColor(17), 'grade-excellent');
    assert.strictEqual(pure.gradeHex(9), '#f44336');
    assert.strictEqual(pure.getInitial('محمد علي'), 'م');
    assert.ok(pure.getAvatarColor('أحمد').startsWith('#'));
    console.log('  [ok] grade/avatar helpers');
}

function testAbsenceMonthKey() {
    assert.strictEqual(
        pure.absenceMonthKey({ absence_date: '2025-10-15' }),
        '2025-10'
    );
    assert.strictEqual(
        pure.absenceMonthKey({ month: '10', school_year: '2025/2026' }),
        '2025-10'
    );
    assert.strictEqual(
        pure.absenceMonthKey({ month: '3', school_year: '2025/2026' }),
        '2026-03'
    );
    assert.strictEqual(pure.absenceCalendarYear(9, '2025/2026'), 2025);
    assert.strictEqual(pure.absenceCalendarYear(2, '2025/2026'), 2026);
    assert.ok(pure.formatAbsenceMonthLabel('2025-10').includes('أكتوبر'));
    console.log('  [ok] absence month helpers');
}

function testProfileFields() {
    assert.ok(fields.PROFILE_TAB_ALLOWLIST.economic.includes('eco_status'));
    assert.ok(fields.PROFILE_TAB_KEYS.includes('guidance'));
    assert.strictEqual(fields.PROFILE_TAB_MAX_JSON, 16000);
    console.log('  [ok] profile field allowlist');
}

async function testExamMigration() {
    const store = new Map();
    store.set('examCenterLevels', JSON.stringify(['TCSF']));
    store.set('examCenterConfig', 'not-json{');

    const saved = [];
    const api = {
        examConfig: {
            async get(_year, key) {
                if (key === 'examCenterConfig') return { already: true };
                return null;
            },
            async save(payload) {
                saved.push(payload);
                return { success: true };
            }
        }
    };
    const storage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        removeItem: (k) => store.delete(k)
    };

    const result = await migration.migrateExamLocalStorageToDb({
        schoolYear: '2025/2026',
        api,
        storage
    });

    assert.strictEqual(result.migrated, 1, 'one key migrated');
    assert.strictEqual(result.skipped, 1, 'one key already in DB');
    assert.ok(!store.has('examCenterLevels'));
    assert.ok(!store.has('examCenterConfig'));
    assert.strictEqual(saved.length, 1);
    assert.deepStrictEqual(saved[0].data, ['TCSF']);
    console.log('  [ok] exam localStorage migration');
}

async function run() {
    console.log('[test] student-profile pure + exam migration');
    testDedupeGrades();
    testGradeColors();
    testAbsenceMonthKey();
    testProfileFields();
    await testExamMigration();
    console.log('[test] student-profile pure + exam migration OK');
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
