/**
 * Integration tests — proctor-v2-use-exam-center-levels (Task 5)
 *
 * Validates: Requirements 2.1, 2.2, 2.6, 2.7
 *
 * End-to-end scenarios inspired by SESSION-NOTES.md where two real-world levels
 * ("الأولى باكالوريا العلوم الرياضية - رسميون" and
 *  "الأولى باكالوريا علوم الإقتصاد و التدبير - رسميون") were silently dropped
 * from Phase_2_Build because their rooms had not been saved to
 * `examCenterRoomsData`. After the fix in Task 3, `buildV2Input` tops up the
 * missing rows from `examCenterLevels` and both levels receive guard tasks.
 *
 * Strategy (same pattern as tests/proctor-distribution-v2-orchestrator.test.js):
 *   1. Load js/algorithms/proctor-distribution-v2.js inside a vm sandbox.
 *   2. Mirror the pure helpers (buildSyntheticRoomRow, computeMaxRoomNum,
 *      computeEffectiveRoomRows, mockGetRoomRowsForLevel) verbatim.
 *   3. Expose buildFixedInput(scheduleEntries, roomsData, levelsMap, proctors,
 *      rules) which mimics the FIXED buildV2Input: it returns a complete
 *      GS2_Input_Contract with `options.roomsList` assembled through the
 *      top-up helper and carries the `syntheticRoomWarnings[]` it produced.
 *   4. Run V2.run(input) and verify the result satisfies the spec.
 *
 * Determinism: every scenario pins `randomSeed = 42`.
 * Phase 3 is disabled (enablePhase3: false) for speed; it is not needed to
 * validate Phase_2_Build coverage which is what this task cares about.
 */

'use strict';

const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

// ----------------------------------------------------------------------------
// Load production module inside a browser-like sandbox.
// ----------------------------------------------------------------------------
const source = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'algorithms', 'proctor-distribution-v2.js'),
    'utf8'
);
const sandbox = {
    window: {}, Math, console, Infinity, isFinite, isNaN,
    Set, Map, Object, Array, String, Number, Error, Boolean, Date,
    parseInt, parseFloat, TypeError, RangeError
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const V2 = sandbox.window.ProctorDistributionV2;
assert.ok(V2 && typeof V2.run === 'function', 'ProctorDistributionV2.run must be available');

// ----------------------------------------------------------------------------
// Mirror of the production helpers in exams-proctors.html. Keep in sync with:
//   - tests/proctor-v2-effective-room-rows.test.js
//   - tests/proctor-v2-build-input-integration.test.js
// ----------------------------------------------------------------------------
function buildSyntheticRoomRow(levelName, roomNum) {
    return {
        key: levelName + '__' + roomNum + '__synthetic',
        level_name: levelName,
        room_num: String(roomNum),
        roomName: 'قاعة افتراضية ' + roomNum,
        count: 0,
        firstNum: null,
        lastNum: null,
        _synthetic: true
    };
}

function computeMaxRoomNum(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return 0;
    let max = 0;
    for (const r of rows) {
        const n = r ? parseInt(r.room_num, 10) : NaN;
        if (Number.isFinite(n) && n > max) max = n;
    }
    return max;
}

function computeEffectiveRoomRows(levelName, actualRows, examCenterLevelsMap) {
    const rows = Array.isArray(actualRows) ? actualRows : [];
    const levelEntry = examCenterLevelsMap && examCenterLevelsMap[levelName];
    const expected = levelEntry && Number(levelEntry.rooms) > 0 ? Number(levelEntry.rooms) : 0;
    if (expected === 0 || expected <= rows.length) {
        return { rows: rows, synthetic: 0, expected: expected, actual: rows.length };
    }
    const missing = expected - rows.length;
    const startNum = computeMaxRoomNum(rows) + 1;
    const syntheticRows = [];
    for (let i = 0; i < missing; i++) {
        syntheticRows.push(buildSyntheticRoomRow(levelName, startNum + i));
    }
    return {
        rows: rows.concat(syntheticRows),
        synthetic: missing,
        expected: expected,
        actual: rows.length
    };
}

function mockGetRoomRowsForLevel(levelName, roomsData) {
    const rows = Object.entries(roomsData || {}).map(function (entry) {
        const key = entry[0];
        const value = entry[1];
        const parts = key.split('__');
        return Object.assign(
            { key: key, level_name: parts[0] || '', room_num: parts[1] || '' },
            value || {}
        );
    }).filter(function (r) { return r.roomName || r.count || r.firstNum || r.lastNum; });
    return rows.filter(function (r) { return r.level_name === levelName; });
}

// ----------------------------------------------------------------------------
// buildFixedInput — mirror of the post-fix buildV2Input in exams-proctors.html.
// Returns a complete GS2_Input_Contract plus the syntheticRoomWarnings[] that
// would be surfaced to the Diagnostics Panel.
// ----------------------------------------------------------------------------
function buildFixedInput(scheduleEntries, roomsData, levelsMap, proctors, rules) {
    const levelsSeen = Object.create(null);
    const roomsList = Object.create(null);
    const syntheticRoomWarnings = [];

    for (let i = 0; i < scheduleEntries.length; i++) {
        const entry = scheduleEntries[i];
        const lvl = (entry && entry.level_name) || '';
        if (!lvl || levelsSeen[lvl]) continue;
        levelsSeen[lvl] = true;

        const actualRows = mockGetRoomRowsForLevel(lvl, roomsData);
        const effective = computeEffectiveRoomRows(lvl, actualRows, levelsMap);
        roomsList[lvl] = effective.rows;

        if (effective.synthetic > 0) {
            syntheticRoomWarnings.push({
                levelName: lvl,
                added: effective.synthetic,
                expected: effective.expected,
                actual: effective.actual
            });
        }
    }

    return {
        proctorsList: proctors,
        scheduleEntries: scheduleEntries,
        exemptionsData: {},
        dutyData: {},
        meAssignments: {},
        examDistributionRules: rules,
        randomSeed: 42,
        weightsPreset: 'توازن',
        customWeights: null,
        options: {
            roomsList: roomsList,
            allowHalfdayReuse: false,
            allowDayReuse: true,
            noRoomRepeat: true,
            avoidSpecialty: true,
            respectMorningEvening: true,
            preferMixedGenderPair: true
        },
        enablePhase3: false,
        syntheticRoomWarnings: syntheticRoomWarnings
    };
}

// ----------------------------------------------------------------------------
// Helpers matching the orchestrator test's style (makeProctor / makeScheduleEntry).
// ----------------------------------------------------------------------------
function makeProctor(id, name, cin, gender, specialty) {
    return {
        id: id,
        teacher_name: name,
        teacher_name_fr: name,
        specialty: specialty || '',
        cin: cin,
        som: '',
        gender: gender || 'ذكر',
        room: ''
    };
}

function makeScheduleEntry(overrides) {
    const base = {
        day: 'الأول',
        period: 'صباحا',
        session: 'الحصة الأولى',
        level_name: '',
        subject_name: 'الرياضيات',
        date_day: '15',
        date_month: '3',
        date_year: '2026',
        time_from: '08:00',
        time_to: '10:00'
    };
    if (overrides) {
        const keys = Object.keys(overrides);
        for (let i = 0; i < keys.length; i++) base[keys[i]] = overrides[keys[i]];
    }
    return base;
}

// Six proctors, mixed gender and specialty, so Phase_2_Build has real choices
// to make across sessions (4 tasks per scenario, so 6 proctors is comfortable).
function makeSixProctors() {
    return [
        makeProctor(1, 'أحمد', 'CIN001', 'ذكر', 'الفيزياء'),
        makeProctor(2, 'فاطمة', 'CIN002', 'أنثى', 'الرياضيات'),
        makeProctor(3, 'محمد', 'CIN003', 'ذكر', 'العربية'),
        makeProctor(4, 'خديجة', 'CIN004', 'أنثى', 'الاقتصاد'),
        makeProctor(5, 'يوسف', 'CIN005', 'ذكر', 'الإنجليزية'),
        makeProctor(6, 'مريم', 'CIN006', 'أنثى', 'التاريخ')
    ];
}

const RULES = { proctorsPerRoom: 1, reservesPerSession: 0 };

// Real-world level names taken directly from SESSION-NOTES.md.
const L_MATH = 'الأولى باكالوريا العلوم الرياضية - رسميون';
const L_ECON = 'الأولى باكالوريا علوم الإقتصاد و التدبير - رسميون';

function makeRoomsDataFor(levelName, n) {
    const out = {};
    for (let i = 1; i <= n; i++) {
        out[levelName + '__' + i] = {
            roomName: 'قاعة ' + i,
            count: 25,
            firstNum: (i - 1) * 25 + 1,
            lastNum: i * 25
        };
    }
    return out;
}

function countTasksByLevel(result) {
    const byLevel = Object.create(null);
    for (let i = 0; i < result.length; i++) {
        const lvl = result[i].level_name || '';
        byLevel[lvl] = (byLevel[lvl] || 0) + 1;
    }
    return byLevel;
}

// ----------------------------------------------------------------------------
// Test harness
// ----------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
    try {
        fn();
        console.log('  [pass] ' + name);
        passed++;
    } catch (e) {
        console.log('  [FAIL] ' + name + ': ' + e.message);
        failed++;
        failures.push({ name: name, message: e.message, stack: e.stack });
    }
}

console.log('[test] proctor-v2 session-notes integration (Task 5)');

// ============================================================================
// Test 1 — SESSION-NOTES scenario: two levels with rooms=2, M=0.
// Both levels must appear in the result (Phase_2_Build no longer drops them)
// and each must receive `rooms × sessions × guardsPerRoom` = 2 × 1 × 1 = 2 tasks.
// ============================================================================
console.log('\n  --- Test 1: SESSION-NOTES — two levels, M=0, N=2 each ---');

test('both levels receive the expected number of guard tasks', function () {
    const levelsMap = {
        [L_MATH]: { rooms: 2, subjects: ['الرياضيات'] },
        [L_ECON]: { rooms: 2, subjects: ['الاقتصاد'] }
    };
    const roomsData = {}; // nothing saved for either level (M=0 for both)
    const scheduleEntries = [
        makeScheduleEntry({ level_name: L_MATH, subject_name: 'الرياضيات' }),
        makeScheduleEntry({
            level_name: L_ECON,
            subject_name: 'الاقتصاد',
            session: 'الحصة الثانية',
            period: 'مساء'
        })
    ];

    const input = buildFixedInput(scheduleEntries, roomsData, levelsMap, makeSixProctors(), RULES);

    // Sanity: roomsList carries two rows per level (all synthetic) and the
    // buildFixedInput call surfaced two warnings (one per level).
    assert.strictEqual(input.options.roomsList[L_MATH].length, 2, 'math level must have 2 rooms in roomsList');
    assert.strictEqual(input.options.roomsList[L_ECON].length, 2, 'econ level must have 2 rooms in roomsList');
    assert.strictEqual(input.syntheticRoomWarnings.length, 2, 'one warning per topped-up level');

    const output = V2.run(input);
    assert.ok(output && Array.isArray(output.result), 'V2.run must return a result array');
    assert.strictEqual(output.diagnostics.orchestratorState, 'COMPLETED', 'orchestrator must complete');

    const tasksByLevel = countTasksByLevel(output.result);
    // rooms × sessions × guardsPerRoom = 2 × 1 × 1 = 2 per level
    assert.strictEqual(tasksByLevel[L_MATH], 2, 'math level must get 2 tasks');
    assert.strictEqual(tasksByLevel[L_ECON], 2, 'econ level must get 2 tasks');
});

// ============================================================================
// Test 2 — syntheticRoomWarnings carries exact counts for both levels.
// ============================================================================
console.log('\n  --- Test 2: syntheticRoomWarnings content ---');

test('warnings contain both levels with {added: 2, expected: 2, actual: 0}', function () {
    const levelsMap = {
        [L_MATH]: { rooms: 2, subjects: ['الرياضيات'] },
        [L_ECON]: { rooms: 2, subjects: ['الاقتصاد'] }
    };
    const roomsData = {};
    const scheduleEntries = [
        makeScheduleEntry({ level_name: L_MATH, subject_name: 'الرياضيات' }),
        makeScheduleEntry({
            level_name: L_ECON,
            subject_name: 'الاقتصاد',
            session: 'الحصة الثانية',
            period: 'مساء'
        })
    ];

    const input = buildFixedInput(scheduleEntries, roomsData, levelsMap, makeSixProctors(), RULES);

    assert.strictEqual(input.syntheticRoomWarnings.length, 2);
    const byLevel = Object.create(null);
    for (const w of input.syntheticRoomWarnings) byLevel[w.levelName] = w;

    assert.ok(byLevel[L_MATH], 'math warning must be present');
    assert.ok(byLevel[L_ECON], 'econ warning must be present');
    assert.deepStrictEqual(byLevel[L_MATH], {
        levelName: L_MATH, added: 2, expected: 2, actual: 0
    });
    assert.deepStrictEqual(byLevel[L_ECON], {
        levelName: L_ECON, added: 2, expected: 2, actual: 0
    });

    // Sum of added equals the total number of synthetic rows across roomsList.
    let totalSynthetic = 0;
    for (const lvl of Object.keys(input.options.roomsList)) {
        for (const r of input.options.roomsList[lvl]) if (r._synthetic) totalSynthetic++;
    }
    const totalAdded = input.syntheticRoomWarnings.reduce(function (a, w) { return a + w.added; }, 0);
    assert.strictEqual(totalSynthetic, totalAdded, 'Σ added must equal the count of _synthetic rows');
    assert.strictEqual(totalSynthetic, 4, 'exactly 4 synthetic rows (2 per level)');
});

// ============================================================================
// Test 3 — End-to-end: after the user saves the missing rooms, re-running the
// distribution produces zero synthetic rows and the same number of tasks.
// ============================================================================
console.log('\n  --- Test 3: end-to-end after saving rooms (0 synthetic) ---');

test('saved roomsData → no synthetic rows, no warnings, still 4 tasks', function () {
    const levelsMap = {
        [L_MATH]: { rooms: 2, subjects: ['الرياضيات'] },
        [L_ECON]: { rooms: 2, subjects: ['الاقتصاد'] }
    };
    // Four real rows (two per level) — the user has saved them.
    const roomsData = Object.assign(
        {},
        makeRoomsDataFor(L_MATH, 2),
        makeRoomsDataFor(L_ECON, 2)
    );
    const scheduleEntries = [
        makeScheduleEntry({ level_name: L_MATH, subject_name: 'الرياضيات' }),
        makeScheduleEntry({
            level_name: L_ECON,
            subject_name: 'الاقتصاد',
            session: 'الحصة الثانية',
            period: 'مساء'
        })
    ];

    const input = buildFixedInput(scheduleEntries, roomsData, levelsMap, makeSixProctors(), RULES);

    // roomsList carries 4 rows total, no synthetic marker anywhere.
    assert.strictEqual(input.options.roomsList[L_MATH].length, 2);
    assert.strictEqual(input.options.roomsList[L_ECON].length, 2);
    for (const lvl of Object.keys(input.options.roomsList)) {
        for (const r of input.options.roomsList[lvl]) {
            assert.ok(!r._synthetic, 'no row may be synthetic after save: ' + JSON.stringify(r));
        }
    }
    assert.strictEqual(input.syntheticRoomWarnings.length, 0, 'no warnings once data is complete');

    const output = V2.run(input);
    assert.strictEqual(output.diagnostics.orchestratorState, 'COMPLETED');
    const tasksByLevel = countTasksByLevel(output.result);
    assert.strictEqual(tasksByLevel[L_MATH], 2);
    assert.strictEqual(tasksByLevel[L_ECON], 2);
    assert.strictEqual(output.result.length, 4, 'exactly 4 tasks total (no synthetic side-effects)');
});

// ============================================================================
// Test 4 — Determinism: identical input + same seed → identical result.
// ============================================================================
console.log('\n  --- Test 4: determinism (seed 42 stable) ---');

test('same input + same seed produces identical assignment rows', function () {
    const levelsMap = {
        [L_MATH]: { rooms: 2, subjects: ['الرياضيات'] },
        [L_ECON]: { rooms: 2, subjects: ['الاقتصاد'] }
    };
    const roomsData = {};
    const scheduleEntries = [
        makeScheduleEntry({ level_name: L_MATH, subject_name: 'الرياضيات' }),
        makeScheduleEntry({
            level_name: L_ECON,
            subject_name: 'الاقتصاد',
            session: 'الحصة الثانية',
            period: 'مساء'
        })
    ];

    const input1 = buildFixedInput(scheduleEntries, roomsData, levelsMap, makeSixProctors(), RULES);
    const input2 = buildFixedInput(scheduleEntries, roomsData, levelsMap, makeSixProctors(), RULES);

    const out1 = V2.run(input1);
    const out2 = V2.run(input2);

    assert.strictEqual(out1.result.length, out2.result.length, 'same row count');
    for (let i = 0; i < out1.result.length; i++) {
        assert.deepStrictEqual(
            out1.result[i].proctor_keys,
            out2.result[i].proctor_keys,
            'proctor_keys must match at row ' + i
        );
        assert.strictEqual(
            out1.result[i].room_key,
            out2.result[i].room_key,
            'room_key must match at row ' + i
        );
        assert.strictEqual(
            out1.result[i].level_name,
            out2.result[i].level_name,
            'level_name must match at row ' + i
        );
    }
    assert.strictEqual(out1.diagnostics.seedUsed, 42);
    assert.strictEqual(out2.diagnostics.seedUsed, 42);
});

// ============================================================================
// Test 5 — Mixed scenario: one complete level + one missing level. Only the
// missing one yields a warning; both still receive guard tasks.
// ============================================================================
console.log('\n  --- Test 5: mixed (one complete level + one missing level) ---');

test('only the missing level emits a warning, both receive tasks', function () {
    const L_COMPLETE = 'مستوى مكتمل'; // rooms=2, M=2
    const L_MISSING = L_ECON;          // rooms=2, M=0

    const levelsMap = {
        [L_COMPLETE]: { rooms: 2, subjects: ['المعلوميات'] },
        [L_MISSING]: { rooms: 2, subjects: ['الاقتصاد'] }
    };
    const roomsData = makeRoomsDataFor(L_COMPLETE, 2); // only complete level saved

    const scheduleEntries = [
        makeScheduleEntry({ level_name: L_COMPLETE, subject_name: 'المعلوميات' }),
        makeScheduleEntry({
            level_name: L_MISSING,
            subject_name: 'الاقتصاد',
            session: 'الحصة الثانية',
            period: 'مساء'
        })
    ];

    const input = buildFixedInput(scheduleEntries, roomsData, levelsMap, makeSixProctors(), RULES);

    // Exactly one warning (for the missing level, not for the complete one).
    assert.strictEqual(input.syntheticRoomWarnings.length, 1, 'one warning only');
    assert.strictEqual(input.syntheticRoomWarnings[0].levelName, L_MISSING);
    assert.deepStrictEqual(
        input.syntheticRoomWarnings[0],
        { levelName: L_MISSING, added: 2, expected: 2, actual: 0 }
    );

    // Complete level stays untouched (no synthetic row).
    for (const r of input.options.roomsList[L_COMPLETE]) {
        assert.ok(!r._synthetic, 'complete level must not carry synthetic rows');
    }
    // Missing level is made whole by synthetic rows.
    assert.strictEqual(input.options.roomsList[L_MISSING].length, 2);
    for (const r of input.options.roomsList[L_MISSING]) {
        assert.strictEqual(r._synthetic, true, 'missing level rows must be synthetic');
    }

    // Both levels receive guard tasks (= rooms × sessions × guardsPerRoom).
    const output = V2.run(input);
    assert.strictEqual(output.diagnostics.orchestratorState, 'COMPLETED');
    const tasksByLevel = countTasksByLevel(output.result);
    assert.strictEqual(tasksByLevel[L_COMPLETE], 2, 'complete level still gets 2 tasks');
    assert.strictEqual(tasksByLevel[L_MISSING], 2, 'missing level still gets 2 tasks');
});

// ----------------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------------
console.log('\n[test] session-notes integration: ' + passed + ' passed, ' + failed + ' failed');

if (failed > 0) {
    console.log('\n=== FAILURES ===');
    console.log(JSON.stringify(failures, null, 2));
    process.exit(1);
}
