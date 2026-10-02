'use strict';

// @preservation property test — Property 2 (all-cin preservation baseline). MUST PASS on F (and F').
//
// Spec: .kiro/specs/proctor-v2-key-shape-unification/
// Task 2.2 — Property 2 (Preservation): All-cin inputs are unchanged.
//
// **Validates: Requirements 3.6, 3.15**
//
// ----------------------------------------------------------------------------
// What this test asserts
// ----------------------------------------------------------------------------
// For inputs where every proctor in `proctorsList` has a non-empty `cin`,
// `getProctorKey(proc, idx) === getProctorExemptionKey(proc, idx) === proc.cin`
// for every proctor. The bug condition `isBugCondition(X)` cannot fire by
// construction:
//
//   K1 := getProctorKey(proc, idx)            ← proc.cin
//   K2 := getProctorExemptionKey(proc, idx)   ← proc.cin
//   K1 === K2  ⇒  the dual-identity test in design.md §"Bug Details" → "Bug
//                  Condition" is short-circuited at the `IF K1 = K2 THEN
//                  CONTINUE` line; no candidate is ever surfaced.
//
// This test runs the production V2 algorithm on ~10 deterministically-
// generated synthetic inputs (every proctor has a non-empty `cin`) and
// asserts:
//
//   (P-Pre-1) NOT isBugCondition(X) holds — i.e. for every (proc, idx) the
//             two key functions agree, so dual-identity cannot manifest.
//   (P-Pre-2) Every key in R_mem.proctor_keys ∪ R_mem.reserve_keys is
//             "known" — i.e. equal to getProctorKey(proc, idx) for some
//             (proc, idx) in proctorsList. No orphan/ghost keys.
//
// Additionally, the test snapshots one canonical case (deterministic seed)
// so Task 9.1 can re-run the same input post-fix and assert byte-equality
// modulo the additive `diagnostics.orphanDutyKeys` /
// `diagnostics.orphanMeAssignments` fields (both 0 on F and on F' for
// well-formed all-cin input — the boundary adapter is identity here).
//
// ----------------------------------------------------------------------------
// Why this test runs in Node (no Electron, no IPC)
// ----------------------------------------------------------------------------
// `js/algorithms/proctor-distribution-v2.js` is a pure-algorithm module that
// only requires JS built-ins. We load it through a `vm.createContext`
// sandbox the same way the existing proctor-v2 tests do (mirrors
// `tests/proctor-v2-key-shape-bug-exploration.test.js`,
// `tests/inv-a-instrument-roundtrip.test.js`, and the Section B harness in
// `tests/preservation-config-roundtrip.pbt.test.js`). No DB, no IPC, no
// renderer.
//
// ----------------------------------------------------------------------------
// Why deterministic mulberry32 PRNG (project convention)
// ----------------------------------------------------------------------------
// `fast-check` is not in `package.json`. The project's deterministic-
// property-test convention is `mulberry32` — used by
// `tests/proctor-v2-fairness-undercovered-preservation.test.js`,
// `tests/proctor-v2-slot-metric-property-p1.test.js`, and Section B of
// `tests/preservation-config-roundtrip.pbt.test.js`. We reuse the same
// PRNG so counterexamples are reproducible and the generator does not
// introduce a new dependency.
//
// _Bug_Condition: NOT isBugCondition(X) — preservation domain
// _Expected_Behavior: Property 2 — Non-Buggy Inputs Unchanged
// _Phase: E (Preservation Checking)
// _Edge case covered: design.md §"Edge Cases Handled" row "All-cin proctors"
//                     — both key functions return the same string for every
//                     proctor, all edit sites are no-ops on input shape.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// 1) Load the production v2 module via VM sandbox.
//    Mirrors the harness pattern from sibling proctor-v2 tests so realm
//    semantics (Set/Map/Array prototypes) match the production algorithm
//    exactly.
// ---------------------------------------------------------------------------
var src = fs.readFileSync(
    path.join(ROOT, 'js/algorithms/proctor-distribution-v2.js'),
    'utf8'
);
var sb = {
    console: console, Date: Date, Math: Math, Number: Number, Object: Object,
    Array: Array, Set: Set, Map: Map, JSON: JSON, isFinite: isFinite,
    isNaN: isNaN, Infinity: Infinity, parseInt: parseInt, parseFloat: parseFloat,
    String: String, Boolean: Boolean, Error: Error, TypeError: TypeError,
    RangeError: RangeError, NaN: NaN
};
sb.window = sb;
sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(src, sb);
var V2 = sb.ProctorDistributionV2 || sb.window.ProctorDistributionV2;

assert.ok(V2 && typeof V2.run === 'function',
    'Failed to load ProctorDistributionV2 from production module');
assert.ok(V2._internals && typeof V2._internals.getProctorKey === 'function',
    'V2._internals.getProctorKey is not exposed by the production module');

var getProctorKey = V2._internals.getProctorKey;

// `getProctorExemptionKey` is not exposed on `_internals`; mirror it
// byte-for-byte from v2.js (≈line 662–665) so we can encode the
// `isBugCondition(X)` test exactly as design.md specifies.
function getProctorExemptionKey(proctor, index) {
    return proctor.cin || proctor.som || ('idx_' + index);
}

// ---------------------------------------------------------------------------
// 2) Inline mulberry32 PRNG — project convention; same shape as
//    `tests/proctor-v2-fairness-undercovered-preservation.test.js:79`
//    and Section B of `tests/preservation-config-roundtrip.pbt.test.js`.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
    var s = seed >>> 0;
    return function next() {
        s = (s + 0x6D2B79F5) >>> 0;
        var t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function rngInt(rng, lo, hi) {
    // Inclusive bounds.
    return lo + Math.floor(rng() * (hi - lo + 1));
}

function rngPick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
}

// ---------------------------------------------------------------------------
// 3) Synthetic input generator — produces V2-compatible inputs where every
//    proctor has a non-empty, unique `cin`. The generator covers:
//      - 5..30 proctors per input  (task 2.2 spec)
//      - 2..6 schedule entries     (task 2.2 spec)
//      - empty exemptions / duty / meAssignments (task 2.2 spec)
//
//    All proctors carry a non-empty `cin = 'CIN_' + idx + '_' + seed`.
//    Some proctors also carry a non-empty `som` (a confounder: even with
//    `som` set, when `cin` is non-empty `getProctorKey === getProctorExemptionKey
//    === cin` so the bug condition still cannot fire).
// ---------------------------------------------------------------------------

// Schedule scaffolding pulled from the bug-fixtures style so the generated
// inputs are recognisable as legitimate exam-distribution inputs to V2.
var DAYS = ['الأول', 'الثاني', 'الثالث', 'الرابع'];
var PERIODS = ['صباحا', 'مساء'];
var SESSIONS = [
    'الحصة الأولى', 'الحصة الثانية', 'الحصة الثالثة',
    'الحصة الرابعة', 'الحصة الخامسة'
];
var SUBJECTS = [
    'الرياضيات', 'الفيزياء', 'العربية', 'الفرنسية',
    'التاريخ', 'الفلسفة', 'الإنجليزية'
];
var LEVEL = 'الثانية بكالوريا';

function genAllCinInput(rng, seed) {
    // 3.a) proctorsList — every proctor has a non-empty unique `cin`.
    var N = rngInt(rng, 5, 30);
    var proctorsList = [];
    for (var i = 0; i < N; i++) {
        // Random toggle: half the proctors also have a non-empty `som`.
        // Even when both cin and som are non-empty, getProctorKey returns cin
        // (algo shape) and getProctorExemptionKey returns cin (exemption
        // shape's `proc.cin || proc.som || idx_N` short-circuits at cin),
        // so K1 === K2 and the bug cannot fire.
        var hasSom = rng() < 0.5;
        proctorsList.push({
            id: 1000 + i,
            teacher_name: 'أستاذ_' + seed + '_' + i,
            teacher_name_fr: 'Teacher_' + seed + '_' + i,
            specialty: 'عام',
            cin: 'CIN_' + i + '_' + seed,
            som: hasSom ? 'SOM_' + i + '_' + seed : '',
            gender: (i % 2 === 0) ? 'ذكر' : 'أنثى',
            room: ''
        });
    }

    // 3.b) Sanity: every proctor MUST satisfy `cin !== ""` so the bug
    //      condition cannot fire. Fail loudly if the generator drifts.
    for (var pi = 0; pi < proctorsList.length; pi++) {
        if (!proctorsList[pi].cin || String(proctorsList[pi].cin).trim() === '') {
            throw new Error(
                '[generator-bug] seed=' + seed + ' idx=' + pi +
                ' — generator produced empty cin in an all-cin fixture.'
            );
        }
    }

    // 3.c) scheduleEntries — 2..6 entries spread across distinct halfdays
    //      so allowHalfdayReuse:false doesn't artificially cap demand.
    var nEntries = rngInt(rng, 2, 6);
    var scheduleEntries = [];
    var seenHalfdays = Object.create(null);
    var attempts = 0;
    while (scheduleEntries.length < nEntries && attempts < 50) {
        attempts++;
        var day = rngPick(rng, DAYS);
        var period = rngPick(rng, PERIODS);
        var session = rngPick(rng, SESSIONS);
        var subject = rngPick(rng, SUBJECTS);
        // Use distinct (day, period, session) combos so the same physical
        // halfday isn't double-booked. Day-number is derived from day-name
        // index so dates are stable across runs.
        var dayNum = 10 + DAYS.indexOf(day);
        var halfdayProbe = day + '|' + period + '|' + session;
        if (seenHalfdays[halfdayProbe]) continue;
        seenHalfdays[halfdayProbe] = true;
        scheduleEntries.push({
            day: day,
            period: period,
            session: session,
            level_name: LEVEL,
            subject_name: subject,
            date_day: String(dayNum),
            date_month: '3',
            date_year: '2026',
            time_from: '08:00',
            time_to: '10:00'
        });
    }

    // 3.d) rooms — single-room single-proctor so demand is exactly nEntries.
    var rooms = [{
        key: 'R1',
        room_num: 'R1',
        roomName: 'قاعة R1',
        level_name: LEVEL
    }];

    // 3.e) Build options — minimal, mirrors makeOptions() from
    //      `tests/fixtures/proctor-v2-bug-fixtures.js`.
    var options = {
        roomsList: rooms,
        allowHalfdayReuse: false,
        allowDayReuse: true,
        noRoomRepeat: false,
        avoidSpecialty: false,
        respectMorningEvening: false,
        preferMixedGenderPair: false
    };

    // 3.f) Empty exemptions / duty / meAssignments per task 2.2 spec —
    //      these are the boundaries where the bug normally leaks; with
    //      them empty there is no external duty/exemption shape that
    //      could be observed in the output regardless of fix state.
    return {
        proctorsList: proctorsList,
        scheduleEntries: scheduleEntries,
        exemptionsData: {},
        dutyData: {},
        meAssignments: {},
        examDistributionRules: { proctorsPerRoom: 1, reservesPerSession: 0 },
        randomSeed: seed,
        weightsPreset: 'توازن',
        customWeights: null,
        options: options,
        enablePhase3: true
    };
}

// ---------------------------------------------------------------------------
// 4) Property assertion helpers.
// ---------------------------------------------------------------------------

// Builds the set of "known" canonical keys from proctorsList — i.e. the keys
// that are valid post-fix proctor identities. Any key in the output that is
// not in this set is an orphan/ghost (Property 1 P-3 closure invariant).
function buildKnownCanonicalSet(proctorsList) {
    var known = Object.create(null);
    for (var i = 0; i < proctorsList.length; i++) {
        known[getProctorKey(proctorsList[i], i)] = true;
    }
    return known;
}

// Builds an occurrence counter over `proctor_keys ∪ reserve_keys` across
// every row. Reserves arrays are SHARED across rows of the same session
// (v1 invariant from `phase2_5PopulateReserves`); we deduplicate by array
// identity so a session with R rows × K shared reserves contributes K (not
// R × K) to the counter, matching how `addReserveLoad` counts reserves
// per-halfday.
function buildOccurrenceCounter(rows) {
    var counts = Object.create(null);
    var seenReserveArrays = new Set();
    for (var i = 0; i < rows.length; i++) {
        var pk = rows[i].proctor_keys || [];
        for (var j = 0; j < pk.length; j++) {
            var k1 = pk[j];
            if (k1 != null && k1 !== '') counts[k1] = (counts[k1] || 0) + 1;
        }
        var rk = rows[i].reserve_keys || [];
        // Deduplicate by array identity (shared-reference invariant).
        if (rk.length > 0 && !seenReserveArrays.has(rk)) {
            seenReserveArrays.add(rk);
            for (var r = 0; r < rk.length; r++) {
                var k2 = rk[r];
                if (k2 != null && k2 !== '') counts[k2] = (counts[k2] || 0) + 1;
            }
        }
    }
    return counts;
}

// Encodes `isBugCondition(X)` for the all-cin domain. By construction this
// MUST return false for every all-cin input — `K1 === K2` for every proctor,
// so the candidate filter `IF K1 = K2 THEN CONTINUE` short-circuits on every
// iteration. Any positive return is a generator bug or an unexpected
// algorithm change.
function checkBugCondition(input, R_mem) {
    var occ = buildOccurrenceCounter(R_mem);
    var dualIdentityProctors = [];

    for (var idx = 0; idx < input.proctorsList.length; idx++) {
        var proc = input.proctorsList[idx];
        var K1 = getProctorKey(proc, idx);
        var K2 = getProctorExemptionKey(proc, idx);
        if (K1 === K2) continue;          // not a candidate — expected for all-cin

        var n1 = occ[K1] || 0;
        var n2 = occ[K2] || 0;
        if (n1 > 0 && n2 > 0) {
            dualIdentityProctors.push({
                idx: idx, K1: K1, K2: K2,
                K1_count: n1, K2_count: n2
            });
        }
    }
    return dualIdentityProctors;
}

// Asserts every key in proctor_keys ∪ reserve_keys is canonical-known —
// i.e. equal to getProctorKey(proc, idx) for some (proc, idx) in
// proctorsList. This is the Property 1 P-3 closure invariant; it MUST hold
// pre-fix on all-cin input because all-cin input is in `NOT C(X)` and the
// bug never fires.
function findUnknownKeys(R_mem, knownSet) {
    var unknown = [];
    var seenReserveArrays = new Set();
    for (var i = 0; i < R_mem.length; i++) {
        var pk = R_mem[i].proctor_keys || [];
        for (var j = 0; j < pk.length; j++) {
            var k1 = pk[j];
            if (k1 && !knownSet[k1]) unknown.push({ where: 'proctor_keys', row: i, slot: j, key: k1 });
        }
        var rk = R_mem[i].reserve_keys || [];
        if (rk.length > 0 && !seenReserveArrays.has(rk)) {
            seenReserveArrays.add(rk);
            for (var r = 0; r < rk.length; r++) {
                var k2 = rk[r];
                if (k2 && !knownSet[k2]) unknown.push({ where: 'reserve_keys', row: i, slot: r, key: k2 });
            }
        }
    }
    return unknown;
}

// ---------------------------------------------------------------------------
// 5) Property loop — generate and validate ~10 all-cin inputs.
// ---------------------------------------------------------------------------

var NUM_ITERATIONS = 10;
var SEED_BASE = 0xC0FFEE;
var rng = mulberry32(SEED_BASE);

var passed = 0;
var failures = [];

for (var it = 0; it < NUM_ITERATIONS; it++) {
    var iterSeed = SEED_BASE + it;
    var input = genAllCinInput(rng, iterSeed);

    try {
        var out = V2.run(input);
        assert.ok(out && Array.isArray(out.result),
            'iteration ' + it + ': V2.run produced no result array (got ' +
            (out && typeof out.result) + ')');

        var R_mem = out.result;

        // Property assertion 1: NOT isBugCondition(X) — no proctor has dual
        // identity in the output. By construction K1 === K2 for every
        // proctor in all-cin input, so the candidate filter short-circuits
        // and dualIdentityProctors must be empty.
        var dual = checkBugCondition(input, R_mem);
        assert.strictEqual(
            dual.length, 0,
            'iteration ' + it + ' (seed=' + iterSeed + '): unexpected ' +
            'isBugCondition(X)=true on all-cin input — ' + dual.length +
            ' dual-identity proctor(s). This indicates either (a) the ' +
            'generator produced an empty-cin proctor (sanity check failed) ' +
            'or (b) the algorithm produces dual-identity output even when ' +
            'K1 === K2, which would be a deeper invariant break.\n' +
            '  first counterexample: ' + JSON.stringify(dual[0])
        );

        // Property assertion 2: every key in proctor_keys ∪ reserve_keys is
        // a known canonical key — `getProctorKey(proc, idx)` for some
        // (proc, idx) in proctorsList. No orphans, no ghosts.
        var knownSet = buildKnownCanonicalSet(input.proctorsList);
        var unknown = findUnknownKeys(R_mem, knownSet);
        assert.strictEqual(
            unknown.length, 0,
            'iteration ' + it + ' (seed=' + iterSeed + '): ' +
            unknown.length + ' unknown key(s) in proctor_keys ∪ reserve_keys ' +
            '(orphan keys not present in proctorsList canonical set).\n' +
            '  first orphan: ' + JSON.stringify(unknown[0])
        );

        passed++;
    } catch (err) {
        failures.push({
            iteration: it,
            seed: iterSeed,
            proctorCount: input.proctorsList.length,
            scheduleEntryCount: input.scheduleEntries.length,
            message: err.message
        });
    }
}

// ---------------------------------------------------------------------------
// 6) Snapshot one canonical case so Task 9.1 can re-run the same input
//    post-fix and assert byte-equality. The snapshot is a stable JSON
//    projection (proctor_keys per row, reserve_keys per row, and the
//    halfday_key fingerprint) — this is the same shape the post-fix
//    re-run will compare against, modulo additive
//    `diagnostics.orphanDutyKeys` / `diagnostics.orphanMeAssignments`
//    which are 0 in both states for well-formed all-cin input.
//
//    The snapshot is the FIRST iteration only — deterministic by virtue
//    of the SEED_BASE + 0 seed. Subsequent iterations exercise coverage
//    breadth but don't need to be byte-frozen.
// ---------------------------------------------------------------------------

var canonicalSeed = SEED_BASE;
// Re-create the canonical input from a fresh PRNG so the snapshot is
// not perturbed by the loop's RNG advancement.
var canonicalRng = mulberry32(SEED_BASE);
var canonicalInput = genAllCinInput(canonicalRng, canonicalSeed);
var canonicalOutput = V2.run(canonicalInput);

function projectRowsForSnapshot(rows) {
    var snap = [];
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i] || {};
        snap.push({
            halfday_key: row.halfday_key || '',
            session_key: row.session_key || '',
            room_key: row.room_key || '',
            proctor_keys: (row.proctor_keys || []).slice(),
            reserve_keys: (row.reserve_keys || []).slice()
        });
    }
    return snap;
}

var snapshot = {
    seed: canonicalSeed,
    proctor_count: canonicalInput.proctorsList.length,
    schedule_entry_count: canonicalInput.scheduleEntries.length,
    rows: projectRowsForSnapshot(canonicalOutput.result || [])
};

// Stash the snapshot in a global scope hook the post-fix re-run can read
// when `tests/proctor-v2-all-cin-preservation.test.js` is required as a
// module. Setting a property on globalThis is the conventional way these
// tests share state with each other (mirrors the harness pattern in
// `tests/inv-h5-cross-page-consistency.test.js`).
//
// Storage form: a JSON string so a downstream consumer can compare via
// strict equality without worrying about cross-realm prototype identity.
globalThis.__proctorV2AllCinPreservationSnapshot = JSON.stringify(snapshot);

// ---------------------------------------------------------------------------
// 7) Final report.
// ---------------------------------------------------------------------------

console.log('[proctor-v2-all-cin-preservation] iterations: ' + NUM_ITERATIONS +
    ' (seed=' + SEED_BASE + ')');
console.log('  passed: ' + passed + ' / ' + NUM_ITERATIONS);
console.log('  canonical snapshot: seed=' + snapshot.seed +
    ' proctors=' + snapshot.proctor_count +
    ' entries=' + snapshot.schedule_entry_count +
    ' rows=' + snapshot.rows.length);

if (failures.length > 0) {
    console.log('  FAILURES (' + failures.length + '):');
    for (var f = 0; f < failures.length; f++) {
        console.log('    - iter=' + failures[f].iteration +
            ' seed=' + failures[f].seed +
            ' proctors=' + failures[f].proctorCount +
            ' entries=' + failures[f].scheduleEntryCount);
        console.log('      err: ' + failures[f].message.split('\n')[0]);
    }
}

assert.strictEqual(failures.length, 0,
    'Property 2 (all-cin preservation baseline) FAILED: ' +
    failures.length + ' / ' + NUM_ITERATIONS +
    ' iteration(s) violated the preservation invariant. See log above.');

console.log('\n[proctor-v2-all-cin-preservation] PASS');
console.log('  Property: Property 2 — Non-Buggy Inputs Unchanged ' +
    '(all-cin domain: K1 === K2 for every proctor)');
console.log('  ' + NUM_ITERATIONS + ' deterministic iterations × ' +
    '(NOT isBugCondition + canonical-only output keys) = baseline locked.');
console.log('  Task 9.1 will re-run this file on F\' and assert the snapshot ' +
    'matches modulo additive diagnostics.orphanDutyKeys / ' +
    'diagnostics.orphanMeAssignments fields (both 0 on all-cin input).');
