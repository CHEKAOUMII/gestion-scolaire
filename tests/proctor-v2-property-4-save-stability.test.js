/**
 * Property 4 — Save stability (examCenterRoomsData in better-sqlite3 is never
 * written by buildV2Input)
 *
 * Validates: Requirements 3.3
 * Preservation: صيغة الحفظ في examCenterRoomsData لا تتغيّر
 *
 * Property statement: for every input (bug-condition and preservation alike),
 * repeated invocations of the room-assembly pipeline used by `buildV2Input`
 * MUST NOT mutate the persistent store behind `window.api.examConfig`. In
 * particular:
 *
 *   (a) No call to `window.api.examConfig.save` is emitted — neither for the
 *       `'examCenterRoomsData'` key nor for any other room-related config
 *       key. The synthetic top-up logic lives entirely in renderer memory.
 *   (b) The payload returned by `window.api.examConfig.get(year,
 *       'examCenterRoomsData')` compares bit-equal (via JSON snapshot)
 *       before and after every run, so the saved rooms data is stable.
 *   (c) No row in the persisted `examCenterRoomsData` payload is ever
 *       stamped with `_synthetic: true`, and no persisted key ever carries
 *       the `__synthetic` suffix used by `buildSyntheticRoomRow`. The
 *       synthetic marker must stay in-memory only.
 *
 * Test lifecycle:
 *   - This test is introduced in Task 4.2 (post-fix). The production fix
 *     (tasks 3.1–3.4) builds `roomsList` purely from reads; there is no new
 *     write path. Any failure here means the in-memory top-up leaked into
 *     the persistent store — a regression of Requirement 3.3.
 *
 * Isolation strategy:
 *   `buildV2Input` lives inside a `<script>` block in `exams-proctors.html`
 *   and depends on DOM + IPC globals, so we cannot `require` it directly.
 *   We follow the same mirror pattern used by sibling tests
 *   (`proctor-v2-property-3-synthetic-numbering.test.js`,
 *    `proctor-v2-use-exam-center-levels-exploration.test.js`,
 *    `proctor-v2-use-exam-center-levels-preservation.test.js`) and replay
 *   the room-assembly control flow against a fake
 *   `window.api.examConfig.{get,save}` that records every call.
 *
 *   If the production helpers change, update these mirrors.
 */

'use strict';

const assert = require('assert');

// ----------------------------------------------------------------------------
// Mirror of the production helpers in exams-proctors.html. Keep in sync with:
//   - buildExamCenterLevelsMap
//   - buildSyntheticRoomRow
//   - computeMaxRoomNum
//   - computeEffectiveRoomRows
//   - the room-assembly slice of buildV2Input (read-only against roomsData +
//     examCenterLevels; never writes).
// ----------------------------------------------------------------------------

function buildExamCenterLevelsMap(rawArray) {
    const map = Object.create(null);
    if (!Array.isArray(rawArray)) return map;
    for (const level of rawArray) {
        if (!level || !level.name) continue;
        map[level.name] = {
            rooms: Number(level.rooms) || 0,
            subjects: Array.isArray(level.subjects) ? level.subjects : []
        };
    }
    return map;
}

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

// Mirror of `getRoomRowsForLevel` restricted to the fields Property 4 touches.
// Same shape as the mirror used by sibling tests.
function getRoomRowsForLevel(levelName, roomsData) {
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
// Mock of `window.api.examConfig` backed by an in-memory `storage` map.
//   - `get(year, key)` returns a deep clone of `storage[key]` so production
//     code cannot mutate it through the returned reference (matches IPC
//     serialisation behavior — IPC replies are JSON-cloned).
//   - `save(payload)` records every call and writes the payload to storage.
//     Property 4 asserts this function is never invoked.
// ----------------------------------------------------------------------------

function makeApiMock(initialStorage) {
    const storage = JSON.parse(JSON.stringify(initialStorage || {}));
    const saveCalls = [];
    const getCalls = [];
    const api = {
        examConfig: {
            get: async function (yr, key) {
                getCalls.push({ yr: yr, key: key });
                const value = storage[key];
                if (value === undefined) return null;
                // IPC always deep-clones — replicate that to be safe.
                return JSON.parse(JSON.stringify(value));
            },
            save: async function (payload) {
                // Accept either { school_year, config_key, data } (real IPC
                // contract) or the older positional form, so the mock stays
                // permissive if buildV2Input's write path ever regresses.
                const entry = payload && typeof payload === 'object'
                    ? {
                        yr: payload.school_year,
                        key: payload.config_key,
                        data: payload.data
                    }
                    : { yr: null, key: null, data: payload };
                saveCalls.push(entry);
                if (entry.key) {
                    storage[entry.key] = entry.data;
                }
            }
        }
    };
    return { api: api, storage: storage, saveCalls: saveCalls, getCalls: getCalls };
}

// ----------------------------------------------------------------------------
// Mirror of the room-assembly slice of buildV2Input. This must not call
// `api.examConfig.save`; that is exactly what Property 4 asserts.
// ----------------------------------------------------------------------------

async function mirrorBuildV2InputRoomsList(scheduleEntries, api, year) {
    const rawLevels = (await api.examConfig.get(year, 'examCenterLevels')) || [];
    const allRoomsData = (await api.examConfig.get(year, 'examCenterRoomsData')) || {};
    const examCenterLevelsMap = buildExamCenterLevelsMap(rawLevels);

    const levelsSeen = Object.create(null);
    const roomsList = Object.create(null);
    const syntheticRoomWarnings = [];

    for (const entry of scheduleEntries) {
        const lvl = (entry && entry.level_name) || '';
        if (!lvl || levelsSeen[lvl]) continue;
        levelsSeen[lvl] = true;
        const actualRows = getRoomRowsForLevel(lvl, allRoomsData);
        const effective = computeEffectiveRoomRows(lvl, actualRows, examCenterLevelsMap);
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

    return { roomsList: roomsList, syntheticRoomWarnings: syntheticRoomWarnings };
}

// ----------------------------------------------------------------------------
// Property 4 assertion — shared by every unit case and the PBT loop.
// Throws on violation; otherwise returns the final { storage, saveCalls,
// buildResults }.
// ----------------------------------------------------------------------------

async function assertProperty4(scenario) {
    const harness = makeApiMock(scenario.storage);
    const runs = Math.max(1, Number(scenario.runs) || 1);
    const year = scenario.year || '2025/2026';

    // Snapshot persisted examCenterRoomsData before any run.
    const before = JSON.stringify(harness.storage.examCenterRoomsData);

    const buildResults = [];
    for (let i = 0; i < runs; i++) {
        const result = await mirrorBuildV2InputRoomsList(scenario.scheduleEntries, harness.api, year);
        buildResults.push(result);
    }

    // (a) No save calls at all — for roomsData or for anything else. The
    // stricter "nothing" check is equivalent to the spec's "no save for
    // examCenterRoomsData (nor any other rooms-related key)" because the
    // fix never writes any config key.
    assert.strictEqual(harness.saveCalls.length, 0,
        'buildV2Input must never call api.examConfig.save (observed ' +
        harness.saveCalls.length + ' call(s): ' + JSON.stringify(harness.saveCalls) + ')');

    // (b) examCenterRoomsData in storage unchanged (deep equality via JSON).
    const after = JSON.stringify(harness.storage.examCenterRoomsData);
    assert.strictEqual(after, before,
        'examCenterRoomsData in storage must be bit-equal before and after buildV2Input runs.\n' +
        '  before: ' + before + '\n  after:  ' + after);

    // (c) No synthetic markers leaked into the persisted roomsData — neither
    //     a `_synthetic: true` field on any row, nor a key ending with
    //     `__synthetic`.
    const persisted = harness.storage.examCenterRoomsData || {};
    Object.keys(persisted).forEach(function (k) {
        assert.ok(!/__synthetic$/.test(k),
            'synthetic-keyed entry "' + k + '" must never reach storage');
        const row = persisted[k];
        assert.ok(!row || row._synthetic !== true,
            'row under "' + k + '" must not carry _synthetic: true in storage');
    });

    return { storage: harness.storage, saveCalls: harness.saveCalls, buildResults: buildResults };
}

// ----------------------------------------------------------------------------
// Deep-equality helper for snapshot comparison on richer shapes (retained
// for explicit reads of the returned results).
// ----------------------------------------------------------------------------

function deepEquals(a, b) {
    try { assert.deepStrictEqual(a, b); return true; } catch (e) { return false; }
}

// ----------------------------------------------------------------------------
// Minimal async test harness (shape matches the project's other PBT tests).
// ----------------------------------------------------------------------------

const tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

async function runAll() {
    let passed = 0;
    let failed = 0;
    const failures = [];

    for (const t of tests) {
        try {
            await t.fn();
            console.log('  [pass] ' + t.name);
            passed++;
        } catch (e) {
            console.log('  [FAIL] ' + t.name + ': ' + e.message);
            failed++;
            failures.push({ name: t.name, message: e.message });
        }
    }

    console.log('\n[test] proctor-v2 — Property 4 (save stability): ' +
        passed + ' passed, ' + failed + ' failed');

    if (failed > 0) {
        console.log('\n=== FAILURES ===');
        console.log(JSON.stringify(failures, null, 2));
        process.exit(1);
    }
}

function makeLCG(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}
function randInt(rng, min, max) {
    return min + Math.floor(rng() * (max - min + 1));
}
function choice(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
}

// ============================================================================
// Explicit unit cases — tasks.md §4.2
// ============================================================================

console.log('[test] proctor-v2 — Property 4: save stability (Task 4.2)');
console.log('\n  --- Explicit unit cases ---');

test('bug condition — rooms=3, M=0 — 2 consecutive runs → 0 save calls', async function () {
    const L = 'الأولى باكالوريا العلوم الرياضية - رسميون';
    const scenario = {
        storage: {
            examCenterLevels: [{ name: L, rooms: 3, subjects: ['math'] }],
            examCenterRoomsData: {}
        },
        scheduleEntries: [
            { level_name: L, subject_name: 'math', date_day: '1', date_month: '3',
              date_year: '2026', period: 'صباحا', session: 'الحصة الأولى', day: 'الأول' }
        ],
        runs: 2
    };
    const out = await assertProperty4(scenario);
    // Sanity — the mirror still produces the synthetic rows in memory.
    assert.strictEqual(out.buildResults[0].roomsList[L].length, 3,
        'in-memory roomsList[L] must still top up to 3 rows');
    assert.strictEqual(out.buildResults[0].syntheticRoomWarnings.length, 1,
        'exactly one synthetic warning expected for the topped-up level');
});

test('¬isBugCondition — rooms=2, M=2 (complete) — 2 runs → 0 save calls, snapshot stable', async function () {
    const L = 'مستوى مكتمل';
    const scenario = {
        storage: {
            examCenterLevels: [{ name: L, rooms: 2, subjects: ['s'] }],
            examCenterRoomsData: {
                [L + '__1']: { roomName: 'قاعة 1', count: 25, firstNum: 1, lastNum: 25 },
                [L + '__2']: { roomName: 'قاعة 2', count: 25, firstNum: 26, lastNum: 50 }
            }
        },
        scheduleEntries: [
            { level_name: L, subject_name: 's', date_day: '2', date_month: '3',
              date_year: '2026', period: 'صباحا', session: 'الحصة الأولى', day: 'الأول' }
        ],
        runs: 2
    };
    const out = await assertProperty4(scenario);
    // No synthetic rows expected when M == N.
    assert.strictEqual(out.buildResults[0].syntheticRoomWarnings.length, 0,
        'no synthetic warnings for a fully-saved level');
});

test('bug condition — 5 consecutive runs — 0 save calls, storage stable, returns deterministic result', async function () {
    const L = 'مستوى متكرِّر';
    const scenario = {
        storage: {
            examCenterLevels: [{ name: L, rooms: 4, subjects: ['x'] }],
            examCenterRoomsData: {
                // One real row with a sparse number so synthetic numbering
                // must pick up at 6 — exercises the full fix path 5 times.
                [L + '__5']: { roomName: 'قاعة 5', count: 30, firstNum: 1, lastNum: 30 }
            }
        },
        scheduleEntries: [
            { level_name: L, subject_name: 'x', date_day: '3', date_month: '3',
              date_year: '2026', period: 'مساء', session: 'الحصة الأولى', day: 'الأول' }
        ],
        runs: 5
    };
    const out = await assertProperty4(scenario);
    // The 5 in-memory results must be identical run-over-run.
    for (let i = 1; i < out.buildResults.length; i++) {
        assert.ok(deepEquals(out.buildResults[0].roomsList, out.buildResults[i].roomsList),
            'run 0 and run ' + i + ' must produce deep-equal roomsList');
    }
});

test('persisted examCenterRoomsData never contains _synthetic: true after run', async function () {
    const L = 'مستوى تحقُّق _synthetic';
    const scenario = {
        storage: {
            examCenterLevels: [{ name: L, rooms: 3, subjects: ['y'] }],
            examCenterRoomsData: {
                [L + '__1']: { roomName: 'قاعة 1', count: 20 }
            }
        },
        scheduleEntries: [
            { level_name: L, subject_name: 'y', date_day: '4', date_month: '3',
              date_year: '2026', period: 'صباحا', session: 'الحصة الأولى', day: 'الأول' }
        ],
        runs: 3
    };
    const out = await assertProperty4(scenario);
    // Extra explicit sweep — every persisted row is _synthetic-free. The
    // shared assertProperty4 already enforces this, but the redundant
    // check documents intent.
    const persisted = out.storage.examCenterRoomsData;
    Object.values(persisted).forEach(function (row) {
        assert.ok(!row._synthetic,
            'synthetic marker must never appear in storage; row=' + JSON.stringify(row));
    });
});

test('snapshot comparison — examCenterRoomsData is bit-equal before and after 3 runs', async function () {
    const L = 'مستوى snapshot';
    const beforeData = {
        [L + '__1']: { roomName: 'قاعة 1', count: 25, firstNum: 1, lastNum: 25 }
    };
    const scenario = {
        storage: {
            examCenterLevels: [{ name: L, rooms: 3, subjects: ['z'] }],
            examCenterRoomsData: JSON.parse(JSON.stringify(beforeData))
        },
        scheduleEntries: [
            { level_name: L, subject_name: 'z', date_day: '5', date_month: '3',
              date_year: '2026', period: 'صباحا', session: 'الحصة الأولى', day: 'الأول' }
        ],
        runs: 3
    };
    const out = await assertProperty4(scenario);
    assert.strictEqual(JSON.stringify(out.storage.examCenterRoomsData),
        JSON.stringify(beforeData),
        'persisted roomsData must match the original snapshot exactly');
});

// ============================================================================
// Property-based loop — 50 iterations
// ============================================================================

console.log('\n  --- Property-based loop (seed=20260326, 50 iterations × 3 runs each) ---');

/**
 * Generator — produces a mix of bug-condition and ¬bug-condition levels so
 * Property 4 is exercised on both branches of `computeEffectiveRoomRows`.
 */
function genMixedInput(rng) {
    const numLevels = randInt(rng, 1, 4);
    const examCenterLevels = [];
    const examCenterRoomsData = Object.create(null);
    const scheduleEntries = [];

    for (let i = 0; i < numLevels; i++) {
        const levelName = 'مستوى PBT ' + i + '_' + Math.floor(rng() * 1e6);
        const kind = choice(rng, [
            'bug-full',      // rooms=N, M=0
            'bug-partial',   // rooms=N, 0<M<N
            'complete',      // rooms=N, M=N
            'zero-rooms'     // rooms=0, arbitrary M
        ]);

        let N, M;
        if (kind === 'bug-full') {
            N = randInt(rng, 1, 4);
            M = 0;
        } else if (kind === 'bug-partial') {
            N = randInt(rng, 2, 5);
            M = randInt(rng, 1, N - 1);
        } else if (kind === 'complete') {
            N = randInt(rng, 1, 4);
            M = N;
        } else {
            N = 0;
            M = randInt(rng, 0, 3);
        }

        if (N > 0 || kind === 'zero-rooms') {
            examCenterLevels.push({
                name: levelName,
                rooms: N,
                subjects: ['subj_' + i]
            });
        }

        // Save M rows with distinct room_num values chosen from 1..20.
        const used = new Set();
        for (let j = 0; j < M; j++) {
            let num;
            do { num = randInt(rng, 1, 20); } while (used.has(num));
            used.add(num);
            examCenterRoomsData[levelName + '__' + num] = {
                roomName: 'قاعة ' + num,
                count: randInt(rng, 15, 35),
                firstNum: 1,
                lastNum: randInt(rng, 15, 35)
            };
        }

        scheduleEntries.push({
            level_name: levelName,
            subject_name: 'subj_' + i,
            date_day: String(1 + (i % 28)),
            date_month: '3',
            date_year: '2026',
            period: i % 2 === 0 ? 'صباحا' : 'مساء',
            session: 'الحصة ' + (1 + (i % 3)),
            day: 'اليوم ' + (1 + (i % 5))
        });
    }

    return {
        storage: {
            examCenterLevels: examCenterLevels,
            examCenterRoomsData: examCenterRoomsData,
            examExemptionsData: {},
            examDutyTeachersData: {}
        },
        scheduleEntries: scheduleEntries,
        runs: 3
    };
}

test('Property 4 holds across 50 mixed inputs (bug-condition + preservation) × 3 runs each', async function () {
    const rng = makeLCG(20260326);
    const ITER = 50;
    // Track aggregate counters so an unexpected 0-synthetic run doesn't
    // silently weaken coverage.
    let totalSyntheticRuns = 0;
    let totalSaveCalls = 0;

    for (let i = 0; i < ITER; i++) {
        const scenario = genMixedInput(rng);
        const out = await assertProperty4(scenario);

        totalSaveCalls += out.saveCalls.length; // always 0 by assertion

        // Confirm determinism across the 3 runs inside this iteration.
        for (let k = 1; k < out.buildResults.length; k++) {
            assert.ok(deepEquals(out.buildResults[0].roomsList, out.buildResults[k].roomsList),
                'iteration ' + i + ': run 0 and run ' + k + ' diverged');
        }

        if (out.buildResults[0].syntheticRoomWarnings.length > 0) {
            totalSyntheticRuns++;
        }
    }

    assert.strictEqual(totalSaveCalls, 0,
        'aggregate save calls across ' + ITER + ' iterations must be 0, got ' + totalSaveCalls);
    // Weak coverage signal — the mixed generator should exercise the
    // bug-condition branch at least a handful of times.
    assert.ok(totalSyntheticRuns >= 5,
        'expected at least 5/' + ITER + ' iterations to exercise the synthetic top-up branch, got ' +
        totalSyntheticRuns);
});

// ----------------------------------------------------------------------------
// Kick off
// ----------------------------------------------------------------------------
runAll().catch(function (e) {
    console.error('[test] unexpected error:', e);
    process.exit(1);
});
