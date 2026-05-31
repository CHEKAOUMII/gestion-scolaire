// Proctor Distribution V3 — Property-Based Testing helpers.
//
// Pure, deterministic arbitrary generators built on top of the seeded PRNG
// from `js/algorithms/proctor-v3/utils/prng.js`. Every helper takes an `rng`
// returned by `createPRNG(seed)` (and optionally further parameters) and
// produces a value drawn from a fixed distribution. Identical `rng` state →
// identical output, every time.
//
// These helpers are the foundation for the property-based test suite
// (Tasks 26–32). They are NOT used by production code.
//
// Acceptance Criteria covered (foundation):
//   - 14.1 : provide arbitrary generators for proctors, schedules, duty,
//            exemptions, and full GS3 inputs.
//
// Purity contract:
//   - The only mutable state read is `rng` (which advances on every call).
//   - No reliance on Date.now(), Math.random, environment variables, or
//     any module-level mutable state.
//   - No mutation of arguments other than `rng`.

'use strict';

const path = require('path');
const { createPRNG } = require(path.join(
    __dirname,
    '..',
    '..',
    'js',
    'algorithms',
    'proctor-v3',
    'utils',
    'prng.js'
));
const { validateInput } = require(path.join(
    __dirname,
    '..',
    '..',
    'js',
    'algorithms',
    'proctor-v3',
    'phases',
    '00-validate.js'
));

// ---------------------------------------------------------------------------
// Low-level helpers (all consume `rng.nextInt` / `rng.next`)
// ---------------------------------------------------------------------------

/**
 * Pick a uniformly-random element from a non-empty array.
 * @template T
 * @param {{nextInt:(n:number)=>number}} rng
 * @param {T[]} arr
 * @returns {T}
 */
function pick(rng, arr) {
    return arr[rng.nextInt(arr.length)];
}

/**
 * Random integer in [lo, hi] (inclusive on both ends).
 */
function intInRange(rng, lo, hi) {
    if (hi < lo) return lo;
    return lo + rng.nextInt(hi - lo + 1);
}

/**
 * Bernoulli trial with probability p (0..1).
 */
function bernoulli(rng, p) {
    return rng.next() < p;
}

/**
 * Pad a non-negative integer to a fixed minimum width with leading zeros.
 */
function pad(n, width) {
    let s = String(n);
    while (s.length < width) s = '0' + s;
    return s;
}

/**
 * Build a deterministic CIN-like string from a numeric seed component.
 * Always 7 digits to match production-like data shapes.
 */
function buildCinFromSeed(seed) {
    return pad(((seed >>> 0) % 9000000) + 1000000, 7);
}

// ---------------------------------------------------------------------------
// Arbitrary: single proctor
// ---------------------------------------------------------------------------

/**
 * Generate one proctor record drawn from a mixed distribution:
 *   - ~70% : valid trimmed `cin` populated
 *   - ~15% : `cin` blank but `som` populated (forces __idx_N canonical)
 *   - ~10% : both `cin` and `som` blank (forces __idx_N canonical)
 *   - ~5%  : `cin` populated WITH leading/trailing whitespace (V3 must trim)
 *
 * The `subject` and `gender` fields are populated from a small fixed pool
 * so soft-constraint generators downstream can exercise S-OWN-SUBJECT and
 * S-GENDER-DIVERSITY.
 *
 * @param {{nextInt:(n:number)=>number, next:()=>number}} rng
 * @returns {{cin:string, som:string, name:string, subject:string, gender:string}}
 */
function arbitraryProctor(rng) {
    const r = rng.next();
    // Use rng to pull out a stable numeric component to seed cin/som strings.
    const numericSeed = rng.nextInt(1000000);

    let cin = '';
    let som = '';
    if (r < 0.70) {
        cin = buildCinFromSeed(numericSeed);
    } else if (r < 0.85) {
        som = 'SOM' + pad(numericSeed, 6);
    } else if (r < 0.95) {
        // both blank — canonical key will be __idx_N
        cin = '';
        som = '';
    } else {
        // whitespace-padded cin — V3 must .trim() it
        cin = '  ' + buildCinFromSeed(numericSeed) + ' ';
    }

    const subjectPool = ['Math', 'Physique', 'SVT', 'Arabic', 'French', 'English', 'History'];
    const genderPool = ['M', 'F'];

    return {
        cin: cin,
        som: som,
        name: 'Prof_' + pad(numericSeed, 6),
        subject: pick(rng, subjectPool),
        gender: pick(rng, genderPool),
    };
}

// ---------------------------------------------------------------------------
// Arbitrary: list of proctors
// ---------------------------------------------------------------------------

/**
 * Generate `n` proctors. Guarantees no duplicate `cin` strings across
 * non-blank values (so the canonical-key duplicate-CIN guard isn't tripped
 * by accident). When `arbitraryProctor` produces a duplicate cin, this
 * helper blanks the cin on the duplicate (forcing `__idx_N` canonical for
 * that proctor) — preserving determinism while satisfying the input
 * contract.
 *
 * @param {object} rng
 * @param {number} n
 * @returns {Array<object>}
 */
function arbitraryProctorsList(rng, n) {
    if (!Number.isInteger(n) || n < 0) {
        throw new RangeError('arbitraryProctorsList: n must be a non-negative integer');
    }
    const out = [];
    const seenCins = new Set();
    for (let i = 0; i < n; i += 1) {
        const proc = arbitraryProctor(rng);
        const trimmedCin = (proc.cin || '').trim();
        if (trimmedCin) {
            if (seenCins.has(trimmedCin)) {
                // collapse duplicate to __idx_i canonical by blanking cin
                proc.cin = '';
            } else {
                seenCins.add(trimmedCin);
            }
        }
        out.push(proc);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Arbitrary: schedule entries
// ---------------------------------------------------------------------------

/**
 * Generate `n` schedule entries spread across the supplied halfday list.
 * Each entry is a plain object with the canonical fields recognized by
 * Phase 1b: `date`, `period`, `level`, `subject`, `session`.
 *
 * `halfdays` may be:
 *   - undefined / 0 / negative   → defaults to 4 (two days × two periods)
 *   - positive integer K         → generate K halfday slots and round-robin
 *                                  schedule entries across them
 *   - array of `{date, period}`  → use those halfdays directly
 *
 * Uses a small fixed level pool ('L1', 'L2') so eligibility classes can
 * meaningfully form. Within a halfday, entries get unique session labels.
 *
 * @param {object} rng
 * @param {number} n      - number of schedule entries to produce
 * @param {number|Array<{date:string, period:string}>} halfdays
 * @returns {Array<object>}
 */
function arbitraryScheduleEntries(rng, n, halfdays) {
    if (!Number.isInteger(n) || n < 0) {
        throw new RangeError('arbitraryScheduleEntries: n must be a non-negative integer');
    }

    let halfdayList;
    if (Array.isArray(halfdays)) {
        if (halfdays.length === 0) {
            throw new RangeError('arbitraryScheduleEntries: halfdays array must be non-empty');
        }
        halfdayList = halfdays;
    } else {
        const k = Number.isInteger(halfdays) && halfdays > 0 ? halfdays : 4;
        halfdayList = buildDefaultHalfdays(k);
    }

    const levelPool = ['L1', 'L2'];
    const subjectPool = ['Math', 'Physique', 'SVT', 'Arabic', 'French', 'English', 'History'];

    // Track session count per (halfday, level) to label sessions
    // deterministically.
    const sessionCounter = Object.create(null);

    const out = [];
    for (let i = 0; i < n; i += 1) {
        const hd = halfdayList[i % halfdayList.length];
        const level = pick(rng, levelPool);
        const subject = pick(rng, subjectPool);
        const counterKey = hd.date + '|' + hd.period + '|' + level;
        const seq = (sessionCounter[counterKey] || 0) + 1;
        sessionCounter[counterKey] = seq;
        const sessionLabel = seq === 1 ? 'الحصة الأولى' : 'الحصة الثانية';

        out.push({
            date: hd.date,
            period: hd.period,
            level: level,
            subject: subject,
            session: sessionLabel,
        });
    }
    return out;
}

/**
 * Build `k` halfday descriptors deterministically. Distributes them across
 * an arbitrary fixed base date ('2026-06-04') with alternating periods.
 *
 * @param {number} k
 * @returns {Array<{date:string, period:string}>}
 */
function buildDefaultHalfdays(k) {
    const base = new Date(Date.UTC(2026, 5, 4)); // 2026-06-04 UTC
    const periods = ['صباحا', 'مساء'];
    const out = [];
    for (let i = 0; i < k; i += 1) {
        const dayOffset = Math.floor(i / 2);
        const periodIdx = i % 2;
        const dt = new Date(base.getTime() + dayOffset * 24 * 60 * 60 * 1000);
        const date = dt.getUTCFullYear()
            + '-' + pad(dt.getUTCMonth() + 1, 2)
            + '-' + pad(dt.getUTCDate(), 2);
        out.push({ date: date, period: periods[periodIdx] });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Arbitrary: dutyData
// ---------------------------------------------------------------------------

/**
 * Generate a duty-data map keyed by halfday_key (per GS3 contract). For each
 * halfday touched by the schedule, ~15% of proctors are marked on duty.
 *
 * Uses canonical proctor keys directly (matches what V3's Key Adapter would
 * produce post-normalization, so PBT inputs behave realistically). Test
 * code that wants to exercise the adapter can supply their own external
 * aliases instead of using this helper.
 *
 * @param {object} rng
 * @param {Array<object>} proctors  - output of `arbitraryProctorsList`
 * @param {Array<object>} schedule  - output of `arbitraryScheduleEntries`
 * @returns {Object<string, Object<string, boolean>>}
 */
function arbitraryDutyData(rng, proctors, schedule) {
    if (!Array.isArray(proctors) || !Array.isArray(schedule)) {
        return {};
    }
    const halfdays = collectHalfdays(schedule);
    const out = {};
    for (let h = 0; h < halfdays.length; h += 1) {
        const hdKey = halfdays[h];
        const inner = {};
        let any = false;
        for (let i = 0; i < proctors.length; i += 1) {
            if (bernoulli(rng, 0.15)) {
                const key = canonicalKeyFor(proctors[i], i);
                inner[key] = true;
                any = true;
            }
        }
        if (any) {
            out[hdKey] = inner;
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Arbitrary: exemptionsData
// ---------------------------------------------------------------------------

/**
 * Generate an exemptions map keyed by session_key. For each session, ~10%
 * of proctors are marked exempt (`'no'` in V2 convention, preserved in V3).
 *
 * @param {object} rng
 * @param {Array<object>} proctors
 * @param {Array<object>} schedule
 * @returns {Object<string, Object<string, 'no'>>}
 */
function arbitraryExemptions(rng, proctors, schedule) {
    if (!Array.isArray(proctors) || !Array.isArray(schedule)) {
        return {};
    }
    const out = {};
    for (let s = 0; s < schedule.length; s += 1) {
        const sessionKey = buildSessionKey(schedule[s]);
        const inner = {};
        let any = false;
        for (let i = 0; i < proctors.length; i += 1) {
            if (bernoulli(rng, 0.10)) {
                const key = canonicalKeyFor(proctors[i], i);
                inner[key] = 'no';
                any = true;
            }
        }
        if (any) {
            out[sessionKey] = inner;
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Helpers shared by duty/exemption generators
// ---------------------------------------------------------------------------

/**
 * Compute the canonical proctor key for `(proc, idx)` using the same rule
 * as `js/algorithms/proctor-v3/canonical-key.js#canonicalProctorKey`. Kept
 * inline so the PBT helpers don't depend on the canonical-key module
 * (decoupling test-only generators from algorithm internals).
 *
 * @param {{cin?:string}} proc
 * @param {number} idx
 * @returns {string}
 */
function canonicalKeyFor(proc, idx) {
    const cin = proc && proc.cin != null ? String(proc.cin).trim() : '';
    if (cin) return cin;
    return '__idx_' + idx;
}

/**
 * Recompute the halfday_key for an entry. Mirrors Phase 1b's
 * `buildHalfdayKey`. Kept inline to avoid coupling test helpers to the
 * phase module's private helpers.
 */
function buildHalfdayKey(entry) {
    const date = entry && typeof entry.date === 'string' ? entry.date : '';
    const period = entry && typeof entry.period === 'string' ? entry.period : '';
    return date + '|' + period;
}

/**
 * Recompute the session_key for an entry. Mirrors Phase 1b's
 * `buildSessionKey`. Includes the session label when present.
 */
function buildSessionKey(entry) {
    const date = entry && typeof entry.date === 'string' ? entry.date : '';
    const period = entry && typeof entry.period === 'string' ? entry.period : '';
    const level = entry && typeof entry.level === 'string' ? entry.level : '';
    const subject = entry && typeof entry.subject === 'string' ? entry.subject : '';
    const session = entry && typeof entry.session === 'string' ? entry.session : '';
    let base = date + '|' + period + '|' + level + '|' + subject;
    if (session) base += '|' + session;
    return base;
}

/**
 * Collect distinct halfday_keys present in a schedule, in deterministic
 * (sorted) order.
 */
function collectHalfdays(schedule) {
    const seen = Object.create(null);
    for (let i = 0; i < schedule.length; i += 1) {
        const k = buildHalfdayKey(schedule[i]);
        seen[k] = true;
    }
    return Object.keys(seen).sort();
}

/**
 * Collect distinct levels referenced by a schedule, in deterministic order.
 */
function collectLevels(schedule) {
    const seen = Object.create(null);
    for (let i = 0; i < schedule.length; i += 1) {
        const lvl = schedule[i] && typeof schedule[i].level === 'string' ? schedule[i].level : '';
        if (lvl) seen[lvl] = true;
    }
    return Object.keys(seen).sort();
}

// ---------------------------------------------------------------------------
// Arbitrary: full GS3_Input_Contract
// ---------------------------------------------------------------------------

/**
 * Generate a complete GS3_Input_Contract object. The result satisfies
 * `validateInput` from Phase 0 (that's verified by the smoke test below).
 *
 * Distribution defaults:
 *   - 6..30 proctors
 *   - 2..8 schedule entries
 *   - 4 halfdays (two days, two periods each)
 *   - 1..3 rooms per level
 *   - proctorsPerRoom = 2
 *   - randomSeed propagated from `rng.seed` for downstream determinism
 *     (callers that need a fresh seed can override it after generation)
 *
 * Callers can wrap this with their own arbitrary if they want more control
 * over sizes — every nested helper is exported individually.
 *
 * @param {object} rng
 * @returns {object} GS3_Input_Contract-shaped object
 */
function arbitraryInput(rng) {
    const nProctors = intInRange(rng, 6, 30);
    const nEntries = intInRange(rng, 2, 8);
    const nHalfdays = 4;

    const proctorsList = arbitraryProctorsList(rng, nProctors);
    const scheduleEntries = arbitraryScheduleEntries(rng, nEntries, nHalfdays);
    const dutyData = arbitraryDutyData(rng, proctorsList, scheduleEntries);
    const exemptionsData = arbitraryExemptions(rng, proctorsList, scheduleEntries);

    // Build per-level room data sized to a small random count per level so
    // Phase 1b sees a fully-specified examCenterRoomsData (no synthesis).
    const levels = collectLevels(scheduleEntries);
    const examCenterLevels = {};
    const examCenterRoomsData = {};
    for (let i = 0; i < levels.length; i += 1) {
        const lvl = levels[i];
        const roomCount = intInRange(rng, 1, 3);
        examCenterLevels[lvl] = { rooms: roomCount, sessions: 1 };
        const rooms = [];
        for (let r = 0; r < roomCount; r += 1) {
            rooms.push({
                key: lvl + '_R' + (r + 1),
                room_num: String(r + 1),
                roomName: 'Salle ' + lvl + '-' + (r + 1),
            });
        }
        examCenterRoomsData[lvl] = rooms;
    }

    return {
        proctorsList: proctorsList,
        scheduleEntries: scheduleEntries,
        dutyData: dutyData,
        exemptionsData: exemptionsData,
        meAssignments: {},
        examDistributionRules: {
            proctorsPerRoom: 2,
            allowSameDayBothHalfdays: false,
        },
        examCenterConfig: {
            expected_duty_tasks: 0,
        },
        examCenterLevels: examCenterLevels,
        examCenterRoomsData: examCenterRoomsData,
        randomSeed: rng.seed >>> 0,
    };
}

// ---------------------------------------------------------------------------
// Smoke test (runs when this file is invoked directly via `node`).
// ---------------------------------------------------------------------------

function runSmokeTest() {
    const assert = require('assert');
    let passed = 0;
    let failed = 0;

    // 1. Determinism: identical seed → identical output.
    try {
        const rngA = createPRNG(12345);
        const rngB = createPRNG(12345);
        const a = arbitraryInput(rngA);
        const b = arbitraryInput(rngB);
        assert.deepStrictEqual(a, b, 'arbitraryInput must be deterministic for equal seeds');
        passed += 1;
        console.log('  ok  arbitraryInput is deterministic for equal seeds');
    } catch (err) {
        failed += 1;
        console.error('  FAIL  arbitraryInput determinism');
        console.error(err && err.stack ? err.stack : err);
    }

    // 2. Generate 10 inputs and verify each passes validateInput.
    for (let s = 0; s < 10; s += 1) {
        const seed = (s + 1) * 7919; // arbitrary distinct primes
        try {
            const rng = createPRNG(seed);
            const input = arbitraryInput(rng);
            const result = validateInput(input);
            assert.strictEqual(
                result.valid,
                true,
                'validateInput must accept arbitraryInput(seed=' + seed + ')'
                    + (result.valid ? '' : ' — errors: ' + JSON.stringify(result.errors))
            );
            passed += 1;
            console.log('  ok  arbitraryInput(seed=' + seed + ') passes validateInput');
        } catch (err) {
            failed += 1;
            console.error('  FAIL  arbitraryInput(seed=' + seed + ') passes validateInput');
            console.error(err && err.stack ? err.stack : err);
        }
    }

    // 3. arbitraryProctorsList enforces unique-cin invariant.
    try {
        const rng = createPRNG(2024);
        const list = arbitraryProctorsList(rng, 50);
        const seen = new Set();
        for (let i = 0; i < list.length; i += 1) {
            const cin = (list[i].cin || '').trim();
            if (cin) {
                assert.ok(!seen.has(cin), 'duplicate cin found: ' + cin);
                seen.add(cin);
            }
        }
        passed += 1;
        console.log('  ok  arbitraryProctorsList produces unique non-blank trimmed cins');
    } catch (err) {
        failed += 1;
        console.error('  FAIL  arbitraryProctorsList unique-cin invariant');
        console.error(err && err.stack ? err.stack : err);
    }

    // 4. arbitraryScheduleEntries respects halfdays parameter.
    try {
        const rng = createPRNG(99);
        const entries = arbitraryScheduleEntries(rng, 10, 2);
        const halfdays = collectHalfdays(entries);
        assert.ok(halfdays.length <= 2, 'expected at most 2 halfdays, got ' + halfdays.length);
        passed += 1;
        console.log('  ok  arbitraryScheduleEntries spans the requested halfday count');
    } catch (err) {
        failed += 1;
        console.error('  FAIL  arbitraryScheduleEntries halfday spread');
        console.error(err && err.stack ? err.stack : err);
    }

    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    if (failed > 0) {
        process.exit(1);
    }
}

if (require.main === module) {
    runSmokeTest();
}

module.exports = {
    arbitraryProctor,
    arbitraryProctorsList,
    arbitraryScheduleEntries,
    arbitraryDutyData,
    arbitraryExemptions,
    arbitraryInput,
    // Internal helpers exposed for tests that build custom arbitraries.
    _internals: {
        canonicalKeyFor,
        buildHalfdayKey,
        buildSessionKey,
        collectHalfdays,
        collectLevels,
        buildDefaultHalfdays,
        pick,
        intInRange,
        bernoulli,
    },
};
