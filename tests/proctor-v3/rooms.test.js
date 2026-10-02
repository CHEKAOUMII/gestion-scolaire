/**
 * Unit tests for
 * js/algorithms/proctor-v3/phases/01b-build-rooms-and-rows.js
 *
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 10.2
 *
 * Run directly:   node tests/proctor-v3/rooms.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

const { buildRoomsAndRows } = require(path.join(
    __dirname,
    '..',
    '..',
    'js',
    'algorithms',
    'proctor-v3',
    'phases',
    '01b-build-rooms-and-rows.js'
));

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed += 1;
        console.log(`  ok  ${name}`);
    } catch (err) {
        failed += 1;
        console.error(`  FAIL  ${name}`);
        console.error(err && err.stack ? err.stack : err);
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides) {
    return Object.assign(
        {
            level: 'L1',
            period: 'صباحا',
            date: '2026-06-04',
            subject: 'Math',
            session: 'الحصة الأولى'
        },
        overrides || {}
    );
}

function makeRoom(num, name) {
    return {
        key: 'L_' + num,
        room_num: String(num),
        roomName: name || 'Salle ' + num
    };
}

function baseInput(extra) {
    return Object.assign(
        {
            proctorsList: [],
            scheduleEntries: [],
            examDistributionRules: { proctorsPerRoom: 2 }
        },
        extra || {}
    );
}

function makeState(input) {
    return { input: input };
}

function findWarnings(diag, type) {
    return (diag.warnings || []).filter((w) => w.type === type);
}

// ---------------------------------------------------------------------------
// 1. Result shape & purity
// ---------------------------------------------------------------------------

test('returns a NEW state object (different reference)', () => {
    const state = makeState(baseInput());
    const result = buildRoomsAndRows(state);
    assert.notStrictEqual(result, state);
    assert.strictEqual(state.rows, undefined);
    assert.strictEqual(state.diagnostics, undefined);
});

test('does NOT mutate state.input or any nested input field', () => {
    const input = baseInput({
        scheduleEntries: [makeEntry({ level: 'L1' })],
        examCenterLevels: { L1: { rooms: 2 } },
        examCenterRoomsData: { L1: [makeRoom(1)] }
    });
    const snapshot = JSON.parse(JSON.stringify(input));
    buildRoomsAndRows(makeState(input));
    assert.deepStrictEqual(input, snapshot, 'input must be unchanged');
});

test('preserves unrelated state fields by shallow-copy', () => {
    const state = makeState(baseInput());
    state.adapter = { foo: 'bar' };
    state.normalizedDutyData = { x: { y: true } };
    const result = buildRoomsAndRows(state);
    assert.strictEqual(result.adapter, state.adapter);
    assert.strictEqual(result.normalizedDutyData, state.normalizedDutyData);
});

test('throws TypeError on null state or missing input', () => {
    assert.throws(() => buildRoomsAndRows(null), TypeError);
    assert.throws(() => buildRoomsAndRows({}), TypeError);
    assert.throws(() => buildRoomsAndRows({ input: null }), TypeError);
    assert.throws(() => buildRoomsAndRows({ input: 'not-an-object' }), TypeError);
    assert.throws(() => buildRoomsAndRows({ input: [] }), TypeError);
});

// ---------------------------------------------------------------------------
// 2. Empty inputs
// ---------------------------------------------------------------------------

test('empty scheduleEntries → rows is an empty array', () => {
    const result = buildRoomsAndRows(makeState(baseInput()));
    assert.ok(Array.isArray(result.rows));
    assert.strictEqual(result.rows.length, 0);
});

test('diagnostics object is created when absent on input state', () => {
    const result = buildRoomsAndRows(makeState(baseInput()));
    assert.ok(result.diagnostics);
    assert.ok(Array.isArray(result.diagnostics.warnings));
    assert.ok(Array.isArray(result.diagnostics.errors));
});

test('preserves prior diagnostics warnings and errors (fresh arrays)', () => {
    const state = makeState(baseInput());
    const priorWarning = { type: 'orphan', externalKey: 'g' };
    const priorError = { type: 'duplicate_cin', cin: '1' };
    state.diagnostics = {
        warnings: [priorWarning],
        errors: [priorError]
    };
    const result = buildRoomsAndRows(state);
    assert.strictEqual(result.diagnostics.warnings[0], priorWarning);
    assert.strictEqual(result.diagnostics.errors[0], priorError);
    // Fresh arrays — not the caller's references.
    assert.notStrictEqual(result.diagnostics.warnings, state.diagnostics.warnings);
    assert.notStrictEqual(result.diagnostics.errors, state.diagnostics.errors);
});

// ---------------------------------------------------------------------------
// 3. AC 11.2: M < N synthesis path
// ---------------------------------------------------------------------------

test('M < N: synthesizes (N - M) placeholder rooms (AC 11.2)', () => {
    const input = baseInput({
        scheduleEntries: [makeEntry({ level: 'L1' })],
        examCenterLevels: { L1: { rooms: 4 } },
        examCenterRoomsData: { L1: [makeRoom(1), makeRoom(2)] }
    });
    const result = buildRoomsAndRows(makeState(input));
    assert.strictEqual(result.rows.length, 4, 'one row per resolved room');

    // First two rows use the real rooms; remaining are synthetic.
    assert.strictEqual(result.rows[0].room_key, 'L_1');
    assert.strictEqual(result.rows[1].room_key, 'L_2');
    assert.strictEqual(result.rows[2].room_key, '__synth_L1_0');
    assert.strictEqual(result.rows[3].room_key, '__synth_L1_1');
    assert.strictEqual(result.rows[2].room_name, 'Salle 3');
    assert.strictEqual(result.rows[3].room_name, 'Salle 4');

    const synth = findWarnings(result.diagnostics, 'synthetic_rooms');
    assert.strictEqual(synth.length, 1);
    assert.strictEqual(synth[0].level, 'L1');
    assert.strictEqual(synth[0].syntheticCount, 2);
    assert.strictEqual(synth[0].addedCount, 2);
    assert.strictEqual(synth[0].requestedCount, 4);
    assert.strictEqual(synth[0].actualCount, 2);
});

test('M = 0, N > 0: all rooms are synthesized', () => {
    const input = baseInput({
        scheduleEntries: [makeEntry({ level: 'L1' })],
        examCenterLevels: { L1: { rooms: 3 } },
        examCenterRoomsData: { L1: [] }
    });
    const result = buildRoomsAndRows(makeState(input));
    assert.strictEqual(result.rows.length, 3);
    for (let i = 0; i < 3; i += 1) {
        assert.strictEqual(result.rows[i].room_key, '__synth_L1_' + i);
        assert.strictEqual(result.rows[i].room_name, 'Salle ' + (i + 1));
    }
    const synth = findWarnings(result.diagnostics, 'synthetic_rooms');
    assert.strictEqual(synth.length, 1);
    assert.strictEqual(synth[0].syntheticCount, 3);
});

// ---------------------------------------------------------------------------
// 4. AC 11.1: M >= N path — only first N real rooms used, no synthesis
// ---------------------------------------------------------------------------

test('M > N: uses only first N real rooms, no synthetic_rooms warning (AC 11.1)', () => {
    const input = baseInput({
        scheduleEntries: [makeEntry({ level: 'L1' })],
        examCenterLevels: { L1: { rooms: 2 } },
        examCenterRoomsData: { L1: [makeRoom(1), makeRoom(2), makeRoom(3)] }
    });
    const result = buildRoomsAndRows(makeState(input));
    assert.strictEqual(result.rows.length, 2);
    assert.strictEqual(result.rows[0].room_key, 'L_1');
    assert.strictEqual(result.rows[1].room_key, 'L_2');
    const synth = findWarnings(result.diagnostics, 'synthetic_rooms');
    assert.strictEqual(synth.length, 0, 'no synthesis when M >= N');
});

test('M == N: uses all real rooms, no synthesis warning', () => {
    const input = baseInput({
        scheduleEntries: [makeEntry({ level: 'L1' })],
        examCenterLevels: { L1: { rooms: 2 } },
        examCenterRoomsData: { L1: [makeRoom(1), makeRoom(2)] }
    });
    const result = buildRoomsAndRows(makeState(input));
    assert.strictEqual(result.rows.length, 2);
    assert.strictEqual(findWarnings(result.diagnostics, 'synthetic_rooms').length, 0);
});

// ---------------------------------------------------------------------------
// 5. AC 11.3: rooms = 0/undefined → use actual rows only, no synthesis
// ---------------------------------------------------------------------------

test('examCenterLevels[L].rooms = 0 → fallback to actual rows, no synthesis (AC 11.3)', () => {
    const input = baseInput({
        scheduleEntries: [makeEntry({ level: 'L1' })],
        examCenterLevels: { L1: { rooms: 0 } },
        examCenterRoomsData: { L1: [makeRoom(1)] }
    });
    const result = buildRoomsAndRows(makeState(input));
    assert.strictEqual(result.rows.length, 1);
    assert.strictEqual(result.rows[0].room_key, 'L_1');
    assert.strictEqual(findWarnings(result.diagnostics, 'synthetic_rooms').length, 0);
});

test('examCenterLevels[L].rooms = undefined → fallback to actual rows', () => {
    const input = baseInput({
        scheduleEntries: [makeEntry({ level: 'L1' })],
        examCenterLevels: { L1: {} },
        examCenterRoomsData: { L1: [makeRoom(1), makeRoom(2)] }
    });
    const result = buildRoomsAndRows(makeState(input));
    assert.strictEqual(result.rows.length, 2);
    assert.strictEqual(findWarnings(result.diagnostics, 'synthetic_rooms').length, 0);
});

// ---------------------------------------------------------------------------
// 6. AC 11.4: examCenterLevels missing → fallback + warning
// ---------------------------------------------------------------------------

test('examCenterLevels missing → falls back to examCenterRoomsData (AC 11.4)', () => {
    const input = baseInput({
        scheduleEntries: [makeEntry({ level: 'L1' })],
        examCenterRoomsData: { L1: [makeRoom(1), makeRoom(2)] }
    });
    const result = buildRoomsAndRows(makeState(input));
    assert.strictEqual(result.rows.length, 2);
    const missing = findWarnings(result.diagnostics, 'exam_center_levels_missing');
    assert.strictEqual(missing.length, 1);
    assert.strictEqual(findWarnings(result.diagnostics, 'synthetic_rooms').length, 0);
});

test('examCenterLevels empty {} → fallback + warning', () => {
    const input = baseInput({
        scheduleEntries: [makeEntry({ level: 'L1' })],
        examCenterLevels: {},
        examCenterRoomsData: { L1: [makeRoom(1)] }
    });
    const result = buildRoomsAndRows(makeState(input));
    assert.strictEqual(result.rows.length, 1);
    assert.strictEqual(findWarnings(result.diagnostics, 'exam_center_levels_missing').length, 1);
});

test('both examCenterLevels and examCenterRoomsData missing → empty rows, warning emitted', () => {
    const input = baseInput({
        scheduleEntries: [makeEntry({ level: 'L1' })]
    });
    const result = buildRoomsAndRows(makeState(input));
    assert.strictEqual(result.rows.length, 0, 'no rooms means no rows');
    assert.strictEqual(findWarnings(result.diagnostics, 'exam_center_levels_missing').length, 1);
});

// ---------------------------------------------------------------------------
// 7. AC 11.6: synthesized rows live only in `rows` — input not persisted
// ---------------------------------------------------------------------------

test('synthesized rooms NEVER persisted into input.examCenterRoomsData (AC 11.6)', () => {
    const input = baseInput({
        scheduleEntries: [makeEntry({ level: 'L1' })],
        examCenterLevels: { L1: { rooms: 3 } },
        examCenterRoomsData: { L1: [makeRoom(1)] }
    });
    const initialLen = input.examCenterRoomsData.L1.length;
    const result = buildRoomsAndRows(makeState(input));
    assert.strictEqual(input.examCenterRoomsData.L1.length, initialLen);
    // Synthetic rows present in result.
    assert.ok(result.rows.some((r) => r.room_key.indexOf('__synth_') === 0));
});

// ---------------------------------------------------------------------------
// 8. Result_Row shape & no shared array references (AC 10.2)
// ---------------------------------------------------------------------------

test('every Result_Row has the documented shape', () => {
    const input = baseInput({
        scheduleEntries: [makeEntry({ level: 'L1' })],
        examCenterLevels: { L1: { rooms: 1 } },
        examCenterRoomsData: { L1: [makeRoom(1, 'Salle 1')] },
        examDistributionRules: { proctorsPerRoom: 2 }
    });
    const result = buildRoomsAndRows(makeState(input));
    const row = result.rows[0];
    assert.strictEqual(typeof row.session_key, 'string');
    assert.strictEqual(typeof row.halfday_key, 'string');
    assert.strictEqual(typeof row.day_key, 'string');
    assert.strictEqual(typeof row.room_key, 'string');
    assert.strictEqual(typeof row.room_name, 'string');
    assert.strictEqual(typeof row.level, 'string');
    assert.strictEqual(typeof row.subject, 'string');
    assert.ok(Array.isArray(row.proctor_keys));
    assert.strictEqual(row.proctor_keys.length, 2);
    assert.strictEqual(row.proctor_keys[0], null);
    assert.strictEqual(row.proctor_keys[1], null);
    assert.deepStrictEqual(row.proctors, []);
    assert.deepStrictEqual(row.reserves, []);
    assert.deepStrictEqual(row.reserve_keys, []);
    assert.deepStrictEqual(row.duty_teachers, []);
    assert.deepStrictEqual(row.softViolations, []);
});

test('proctorsPerRoom from examDistributionRules is respected', () => {
    const input = baseInput({
        scheduleEntries: [makeEntry({ level: 'L1' })],
        examCenterLevels: { L1: { rooms: 1 } },
        examCenterRoomsData: { L1: [makeRoom(1)] },
        examDistributionRules: { proctorsPerRoom: 3 }
    });
    const result = buildRoomsAndRows(makeState(input));
    assert.strictEqual(result.rows[0].proctor_keys.length, 3);
    result.rows[0].proctor_keys.forEach((v) => assert.strictEqual(v, null));
});

test('proctorsPerRoom default is 1 when absent', () => {
    const input = {
        proctorsList: [],
        scheduleEntries: [makeEntry({ level: 'L1' })],
        examDistributionRules: {},
        examCenterLevels: { L1: { rooms: 1 } },
        examCenterRoomsData: { L1: [makeRoom(1)] }
    };
    const result = buildRoomsAndRows(makeState(input));
    assert.strictEqual(result.rows[0].proctor_keys.length, 1);
});

test('proctor_keys arrays from different rows are FRESH references (AC 10.2)', () => {
    const input = baseInput({
        scheduleEntries: [
            makeEntry({ level: 'L1' }),
            makeEntry({ level: 'L1', date: '2026-06-05' })
        ],
        examCenterLevels: { L1: { rooms: 2 } },
        examCenterRoomsData: { L1: [makeRoom(1), makeRoom(2)] },
        examDistributionRules: { proctorsPerRoom: 2 }
    });
    const result = buildRoomsAndRows(makeState(input));
    assert.strictEqual(result.rows.length, 4);
    // Compare every pair of rows for shared array references.
    for (let i = 0; i < result.rows.length; i += 1) {
        for (let j = i + 1; j < result.rows.length; j += 1) {
            assert.notStrictEqual(
                result.rows[i].proctor_keys,
                result.rows[j].proctor_keys,
                'proctor_keys must be a fresh array for every row'
            );
            assert.notStrictEqual(
                result.rows[i].reserve_keys,
                result.rows[j].reserve_keys,
                'reserve_keys must be a fresh array for every row'
            );
            assert.notStrictEqual(
                result.rows[i].reserves,
                result.rows[j].reserves
            );
            assert.notStrictEqual(
                result.rows[i].proctors,
                result.rows[j].proctors
            );
            assert.notStrictEqual(
                result.rows[i].duty_teachers,
                result.rows[j].duty_teachers
            );
            assert.notStrictEqual(
                result.rows[i].softViolations,
                result.rows[j].softViolations
            );
        }
    }
});

// ---------------------------------------------------------------------------
// 9. Multi-level / multi-halfday aggregation
// ---------------------------------------------------------------------------

test('aggregates rows across multiple schedule entries and levels deterministically', () => {
    const input = baseInput({
        scheduleEntries: [
            makeEntry({ level: 'L1', date: '2026-06-04', period: 'صباحا' }),
            makeEntry({ level: 'L2', date: '2026-06-04', period: 'صباحا' }),
            makeEntry({ level: 'L1', date: '2026-06-04', period: 'مساء' })
        ],
        examCenterLevels: {
            L1: { rooms: 2 },
            L2: { rooms: 1 }
        },
        examCenterRoomsData: {
            L1: [makeRoom(1), makeRoom(2)],
            L2: [makeRoom(11)]
        },
        examDistributionRules: { proctorsPerRoom: 2 }
    });
    const result = buildRoomsAndRows(makeState(input));
    // L1 morning: 2 rooms, L2 morning: 1 room, L1 afternoon: 2 rooms = 5 rows.
    assert.strictEqual(result.rows.length, 5);

    // Halfday keys present.
    const halfdays = new Set(result.rows.map((r) => r.halfday_key));
    assert.ok(halfdays.has('2026-06-04|صباحا'));
    assert.ok(halfdays.has('2026-06-04|مساء'));

    // Levels present.
    const levels = new Set(result.rows.map((r) => r.level));
    assert.ok(levels.has('L1'));
    assert.ok(levels.has('L2'));

    // Order: schedule-entry order, then room order within each entry.
    assert.strictEqual(result.rows[0].level, 'L1');
    assert.strictEqual(result.rows[0].halfday_key, '2026-06-04|صباحا');
    assert.strictEqual(result.rows[2].level, 'L2');
    assert.strictEqual(result.rows[3].level, 'L1');
    assert.strictEqual(result.rows[3].halfday_key, '2026-06-04|مساء');
});

test('only ONE synthetic_rooms warning per level even when many entries reference it', () => {
    const input = baseInput({
        scheduleEntries: [
            makeEntry({ level: 'L1', date: '2026-06-04' }),
            makeEntry({ level: 'L1', date: '2026-06-05' }),
            makeEntry({ level: 'L1', date: '2026-06-06' })
        ],
        examCenterLevels: { L1: { rooms: 3 } },
        examCenterRoomsData: { L1: [makeRoom(1)] }
    });
    const result = buildRoomsAndRows(makeState(input));
    const synth = findWarnings(result.diagnostics, 'synthetic_rooms');
    assert.strictEqual(synth.length, 1, 'one warning per level, not per (level, entry) pair');
    assert.strictEqual(synth[0].syntheticCount, 2);
});

// ---------------------------------------------------------------------------
// 10. Schedule-entry shape compatibility (production fixture style)
// ---------------------------------------------------------------------------

test('handles fixture-style schedule entries (level_name, date_year/month/day, subject_name)', () => {
    const input = baseInput({
        scheduleEntries: [
            {
                level_name: 'الأولى باكالوريا',
                period: 'صباحا',
                session: 'الحصة الأولى',
                date_day: '4',
                date_month: '6',
                date_year: '2026',
                subject_name: 'الرياضيات'
            }
        ],
        examCenterLevels: { 'الأولى باكالوريا': { rooms: 1 } },
        examCenterRoomsData: { 'الأولى باكالوريا': [makeRoom(1, 'قاعة 1')] }
    });
    const result = buildRoomsAndRows(makeState(input));
    assert.strictEqual(result.rows.length, 1);
    assert.strictEqual(result.rows[0].level, 'الأولى باكالوريا');
    assert.strictEqual(result.rows[0].day_key, '2026-06-04');
    assert.strictEqual(result.rows[0].halfday_key, '2026-06-04|صباحا');
    assert.strictEqual(result.rows[0].subject, 'الرياضيات');
    assert.strictEqual(result.rows[0].room_name, 'قاعة 1');
    // session_key includes the session label so two consecutive sessions in the
    // same halfday are distinguishable.
    assert.ok(result.rows[0].session_key.indexOf('الحصة الأولى') !== -1);
});

// ---------------------------------------------------------------------------
// 11. Synthetic count matches AC 11.2 across a range of (M, N)
// ---------------------------------------------------------------------------

test('AC 11.2: synthetic count = max(0, N - M) across many configurations', () => {
    const cases = [
        { N: 1, M: 0, expected: 1 },
        { N: 2, M: 0, expected: 2 },
        { N: 3, M: 1, expected: 2 },
        { N: 5, M: 2, expected: 3 },
        { N: 4, M: 4, expected: 0 },
        { N: 2, M: 5, expected: 0 }
    ];
    for (const c of cases) {
        const actualRooms = [];
        for (let i = 0; i < c.M; i += 1) actualRooms.push(makeRoom(i + 1));
        const input = baseInput({
            scheduleEntries: [makeEntry({ level: 'L1' })],
            examCenterLevels: { L1: { rooms: c.N } },
            examCenterRoomsData: { L1: actualRooms }
        });
        const result = buildRoomsAndRows(makeState(input));
        const synth = findWarnings(result.diagnostics, 'synthetic_rooms');
        if (c.expected === 0) {
            assert.strictEqual(synth.length, 0, JSON.stringify(c));
        } else {
            assert.strictEqual(synth.length, 1, JSON.stringify(c));
            assert.strictEqual(synth[0].syntheticCount, c.expected, JSON.stringify(c));
        }
        // Row count should equal min(N, M) + max(0, N - M) = max(N, M when N is null) but
        // here N is always set, so row count should equal min over actual+synth = N when
        // N <= M, else M + (N - M) = N. In short: when N is set and target capping
        // applied, row count == N.
        const expectedRowCount = c.M >= c.N ? c.N : c.N;
        assert.strictEqual(result.rows.length, expectedRowCount, JSON.stringify(c));
    }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
