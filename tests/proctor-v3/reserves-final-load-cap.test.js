/**
 * Bug-condition exploration test for V3 Phase 9 reserve placement.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2 from
 * .kiro/specs/proctor-v3-reserve-final-load-fairness/bugfix.md
 * (and AC-FL1, AC-FL2, AC-FL7 from
 *  .agent/proctor-v3-reserve-final-load-fairness.md).
 *
 * Property 1 (Bug Condition) — Reserve_Global_Upper is respected when
 * avoidable. Formal definition (from design.md → "Bug Details" →
 * "Bug Condition"):
 *
 *   G   := state.bounds.global.gTotalSlots
 *   D   := state.bounds.global.dExpected
 *   N   := state.bounds.global.nEligible
 *   R   := Σ_meta computeReserveTarget(reservesConfig, meta.guardCount)
 *          (over grouped sessions, exactly as Phase 9 does today)
 *   cap := Math.ceil((G + R + D) / N)        (Reserve_Global_Upper)
 *
 *   Property 1 (post Phase 9):
 *     max(finalLoad over loadState.proctors) <= cap
 *
 *   Diagnostics presence (current state, before fix):
 *     state.diagnostics.finalLoadOverflows === undefined
 *
 * THIS TEST IS EXPECTED TO FAIL ON THE UNFIXED PHASE 9. The failure
 * is the desired outcome at this step — it surfaces counterexamples
 * that demonstrate the bug exists. Do NOT modify either the test or
 * the production code at this step. The same test, unmodified, will
 * validate the fix when it is re-run after Tasks 3 / 4 / 5.
 *
 * Run directly:  node tests/proctor-v3/reserves-final-load-cap.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

const V3_ROOT = path.join(__dirname, '..', '..', 'js', 'algorithms', 'proctor-v3');

const { createPRNG } = require(path.join(V3_ROOT, 'utils', 'prng.js'));
const { validateInput } = require(path.join(V3_ROOT, 'phases', '00-validate.js'));
const { normalizeKeys } = require(path.join(V3_ROOT, 'phases', '01-normalize-keys.js'));
const { buildRoomsAndRows } = require(path.join(V3_ROOT, 'phases', '01b-build-rooms-and-rows.js'));
const { deriveEligibilityClasses } = require(path.join(V3_ROOT, 'phases', '02-eligibility-classes.js'));
const { computeBounds } = require(path.join(V3_ROOT, 'phases', '03-bounds.js'));
const {
    createLoadState,
    addDutyLoad,
    finalLoad
} = require(path.join(V3_ROOT, 'utils', 'load-state.js'));
const { placeGuards } = require(path.join(V3_ROOT, 'phases', '04-place-guards.js'));
const {
    placeReserves,
    _internals: phase9Internals
} = require(path.join(V3_ROOT, 'phases', '09-place-reserves.js'));
const { arbitraryInput } = require(path.join(__dirname, 'pbt-helpers.js'));

let passed = 0;
let failed = 0;
const failureLog = [];

function test(name, fn) {
    try {
        fn();
        passed += 1;
        console.log('  ok  ' + name);
    } catch (err) {
        failed += 1;
        failureLog.push({ name: name, err: err });
        console.error('  FAIL  ' + name);
        console.error(err && err.stack ? err.stack : err);
    }
}

// ---------------------------------------------------------------------------
// Shared harness — reuses the composition from
// tests/proctor-v3/reserves.test.js#runUpToPhase9 but is duplicated here
// so this file is self-contained and runnable in isolation.
// ---------------------------------------------------------------------------

function canonicalKeyOf(proctor, idx) {
    var cin = proctor && proctor.cin != null ? String(proctor.cin).trim() : '';
    if (cin) return cin;
    return '__idx_' + idx;
}

function runUpToPhase9(input, options) {
    const validation = validateInput(input);
    if (!validation.valid) {
        throw new Error('validateInput failed: ' + JSON.stringify(validation.errors));
    }
    let state = { input: input, options: options || {} };

    state = normalizeKeys(state);
    state = buildRoomsAndRows(state);
    state = deriveEligibilityClasses(state);
    state = computeBounds(state);

    const canonicalKeys = [];
    if (Array.isArray(input.proctorsList)) {
        for (let i = 0; i < input.proctorsList.length; i += 1) {
            canonicalKeys.push(canonicalKeyOf(input.proctorsList[i], i));
        }
    }
    const ls = createLoadState(canonicalKeys);
    if (state.normalizedDutyData) {
        const halfdays = Object.keys(state.normalizedDutyData);
        for (let h = 0; h < halfdays.length; h += 1) {
            const inner = state.normalizedDutyData[halfdays[h]];
            if (!inner || typeof inner !== 'object') continue;
            const procKeys = Object.keys(inner);
            for (let p = 0; p < procKeys.length; p += 1) {
                addDutyLoad(ls, procKeys[p], halfdays[h]);
            }
        }
    }
    state.loadState = ls;

    state = placeGuards(state);
    state = placeReserves(state);
    return state;
}

/**
 * Compute Reserve_Global_Upper exactly as Phase 9 will after the fix:
 *
 *   G := state.bounds.global.gTotalSlots
 *   D := state.bounds.global.dExpected
 *   N := state.bounds.global.nEligible
 *   R := Σ_meta computeReserveTarget(reservesConfig, meta.guardCount)
 *   cap := N > 0 ? ceil((G + R + D) / N) : 0
 *
 * Uses Phase 9's own internals (`groupRowsBySession`, `resolveReservesConfig`,
 * `computeReserveTarget`) so the cap derivation is byte-identical to the
 * production formula — no duplicated math.
 */
function computeReserveGlobalUpper(state) {
    const bounds = (state.bounds && state.bounds.global) || {};
    const G = typeof bounds.gTotalSlots === 'number' ? bounds.gTotalSlots : 0;
    const D = typeof bounds.dExpected === 'number' ? bounds.dExpected : 0;
    const N = typeof bounds.nEligible === 'number' ? bounds.nEligible : 0;
    const reservesConfig = phase9Internals.resolveReservesConfig(state.input);
    const grouped = phase9Internals.groupRowsBySession(state.rows || []);
    let R = 0;
    for (let i = 0; i < grouped.sessions.length; i += 1) {
        R += phase9Internals.computeReserveTarget(reservesConfig, grouped.sessions[i].guardCount);
    }
    const cap = N > 0 ? Math.ceil((G + R + D) / N) : 0;
    return { G: G, D: D, N: N, R: R, cap: cap };
}

/**
 * Walk loadState.proctors and report the maximum finalLoad and the list
 * of proctor canonical keys whose finalLoad exceeds `cap`.
 */
function collectFinalLoadStats(state, cap) {
    const ls = state.loadState || { proctors: {} };
    const proctors = ls.proctors || {};
    const keys = Object.keys(proctors);
    let maxFL = 0;
    const overCap = [];
    for (let i = 0; i < keys.length; i += 1) {
        const fl = finalLoad(ls, keys[i]);
        if (fl > maxFL) maxFL = fl;
        if (fl > cap) {
            overCap.push({ key: keys[i], finalLoad: fl });
        }
    }
    overCap.sort(function (a, b) {
        if (a.finalLoad !== b.finalLoad) return b.finalLoad - a.finalLoad;
        if (a.key < b.key) return -1;
        if (a.key > b.key) return 1;
        return 0;
    });
    return { maxFL: maxFL, overCap: overCap };
}

// ---------------------------------------------------------------------------
// Sub-case A — production fixture (documenting / sanity)
//
// Per the discussion captured during Task 1 implementation, fixture
// `tests/fixtures/45454.json` does NOT, with the formula specified in
// design.md ("D := state.bounds.global.dExpected"), satisfy
// `max(finalLoad) > cap` on the unfixed Phase 9: the fixture's bounds
// yield G=382, D=13, N=147, R=107, cap=4, observed max=4 — assertion
// `max <= cap` holds.
//
// The original counterexample documented in
// .agent/proctor-v3-reserve-final-load-fairness.md (G=298, R=79, D=6,
// cap=3) came from a separate captured debug file
// (`المعطيات/distribution-debug-1780170300614.json`) that is not part
// of the test fixtures tracked in this repository.
//
// We therefore keep Sub-case A as a DOCUMENTING test: it logs the
// fixture's totals and `max(finalLoad)` so any future regression on
// this fixture is visible, and it asserts the diagnostics-presence
// expectation that `state.diagnostics.finalLoadOverflows === undefined`
// on the unfixed code (will be relaxed in Task 6.1 to
// `Array.isArray(...)` after the fix lands). The hard
// `max(finalLoad) <= cap` assertion for Property 1 is carried by
// Sub-case B (PBT-generated) below, which DOES surface bug-condition
// counterexamples reliably on the unfixed code.
// ---------------------------------------------------------------------------

test('Sub-case A: production fixture 45454.json — record cap, max(finalLoad), and diagnostics presence', () => {
    const input = require(path.join(__dirname, '..', 'fixtures', '45454.json'));
    const state = runUpToPhase9(input, {
        phase4TimeBudgetMs: 60000,
        phase9TimeBudgetMs: 5000
    });

    const stats = computeReserveGlobalUpper(state);
    const fl = collectFinalLoadStats(state, stats.cap);

    // Documenting log line — visible in the test runner output even on
    // pass, so reviewers can correlate the cap derivation with the
    // observed final-load distribution.
    console.log(
        '    [doc] fixture=45454.json'
        + ' G=' + stats.G
        + ' D=' + stats.D
        + ' N=' + stats.N
        + ' R=' + stats.R
        + ' cap=' + stats.cap
        + ' maxFL=' + fl.maxFL
        + ' overCap=' + fl.overCap.length
    );

    // Diagnostics-presence assertion (post-fix, relaxed in Task 6.1).
    // After the Phase 9 fix lands, `state.diagnostics.finalLoadOverflows`
    // MUST always be present as an array (typically `[]` on
    // `tests/fixtures/45454.json` because 88+ FL=2 candidates were
    // available for the offending session). The previous
    // `=== undefined` check (which held on the unfixed code) is
    // replaced by an `Array.isArray(...)` check per Task 6.1.
    assert.ok(
        state.diagnostics && Array.isArray(state.diagnostics.finalLoadOverflows),
        'fixed Phase 9 must emit diagnostics.finalLoadOverflows as an array'
            + ' (relaxed from === undefined in Task 6.1)'
    );
});

// ---------------------------------------------------------------------------
// Sub-case B — PBT-generated counterexamples
//
// Property 1 (Bug Condition) — full disjunctive form per design.md →
// "Correctness Properties" → Property 1:
//
//   FOR ALL input WHERE isBugCondition(input) HOLDS UNDER UNFIXED PHASE 9
//   FOR ALL proctor T IN loadState.proctors:
//     ASSERT (a) finalLoad(loadState, T) <= Reserve_Global_Upper, OR
//            (b) every reserve assignment that lifted T above the cap is
//                recorded as a forced overflow in
//                diagnostics.finalLoadOverflows with
//                { sessionKey, canonicalKey: T, finalLoad, cap,
//                  reason: 'forced_overflow' }
//
// On the UNFIXED Phase 9 this assertion is EXPECTED TO FAIL because
// (a) is violated and there is no diagnostics list to satisfy (b).
// After the fix (Task 3) the assertion holds for EVERY generated input:
// either branch (a) is met, or branch (b) is — the latter being the
// expected outcome on the small `arbitraryInput`-generated inputs where
// Tier-1 candidates are exhausted by AC 7.4 eligibility filters and
// Phase 9 must legitimately fall back to Tier-2 picks (recording each
// one in finalLoadOverflows).
//
// Implementation note for branch (b): Phase 9 records an overflow entry
// every time `pick.finalLoad + 1 > cap`. A proctor T whose final
// `finalLoad > cap` AND `reserveCount(T) >= 1` MUST therefore appear at
// least once in `finalLoadOverflows` — because finalLoad only grows
// monotonically as reserves are added, so T's LAST reserve pick must
// have had a pre-pick `finalLoad >= cap`, which triggers the recording
// branch. Conversely, a proctor with `finalLoad > cap` but
// `reserveCount(T) === 0` means Phase 9 never lifted them — their guard
// + duty load alone already exceeded the cap (which is a non-Phase-9
// concern: cap is an average bound, individual guard placements can
// legitimately go above it). Such proctors are NOT counterexamples for
// Property 1 — they were never lifted by a reserve assignment, so
// branch (b)'s "every reserve assignment that lifted T above the cap"
// is vacuously satisfied.
//
// Genuine counterexample = a key K with `finalLoad > cap` AND
// `reserveCount(K) > 0` AND no matching forced_overflow entry in
// `finalLoadOverflows`.
//
// We use `arbitraryInput` from tests/proctor-v3/pbt-helpers.js (the
// same generator already exercised by tests/proctor-v3/reserves.test.js)
// and force `reservesConfig = { mode: 'fixed', fixed: 1, percent: 0 }`
// so every session requests one reserve, dramatically increasing the
// chance of a tier-2 lift on the unfixed code. The seed range is the
// same one used by `reserves.test.js`'s 30-input PBT case so failures
// are reproducible and bounded.
// ---------------------------------------------------------------------------

test('Sub-case B: PBT — Property 1 (Reserve_Global_Upper respected) holds for all arbitraryInput seeds', () => {
    const N_SEEDS = 30;
    const counterexamples = [];
    let evaluated = 0;

    for (let s = 0; s < N_SEEDS; s += 1) {
        const seed = (s + 1) * 1009 + 17;
        const rng = createPRNG(seed);
        const input = arbitraryInput(rng);
        // Force a non-trivial reserve target so Phase 9 actually places
        // reserves on these small generated inputs.
        input.reservesConfig = { mode: 'fixed', fixed: 1, percent: 0 };

        let state;
        try {
            state = runUpToPhase9(input, {
                phase4TimeBudgetMs: 200,
                phase9TimeBudgetMs: 500
            });
        } catch {
            // Skip seeds whose Phase 0..4 composition is rejected. We
            // intentionally do NOT count these as counterexamples — the
            // bug condition requires a successful run through Phase 9.
            continue;
        }
        evaluated += 1;

        const stats = computeReserveGlobalUpper(state);
        const fl = collectFinalLoadStats(state, stats.cap);

        // Branch (a): max(finalLoad) <= cap — no proctor exceeds the
        // cap. Property 1 is trivially satisfied.
        if (fl.maxFL <= stats.cap) continue;

        // Branch (b): for every proctor in `overCap`, there must be at
        // least one entry in `diagnostics.finalLoadOverflows` matching
        // { canonicalKey: that_key, cap: stats.cap, reason:
        // 'forced_overflow' } with `finalLoad > cap`. Each entry must
        // also have the expected shape.
        const diag = (state.diagnostics && state.diagnostics.finalLoadOverflows) || null;
        const overflowList = Array.isArray(diag) ? diag : [];

        // Validate shape of every overflow entry on this seed. A
        // misshapen entry is itself a Property 1 violation (the design
        // mandates a precise schema for branch (b)).
        const malformed = [];
        for (let ei = 0; ei < overflowList.length; ei += 1) {
            const e = overflowList[ei];
            const ok = e
                && typeof e === 'object'
                && !Array.isArray(e)
                && typeof e.sessionKey === 'string'
                && typeof e.canonicalKey === 'string'
                && typeof e.finalLoad === 'number'
                && typeof e.cap === 'number'
                && e.reason === 'forced_overflow';
            if (!ok) malformed.push({ index: ei, entry: e });
        }

        // Per-overCap-key witness check: every offending proctor must
        // have at least one matching forced_overflow entry — UNLESS the
        // proctor's `reserveCount` is 0, in which case Phase 9 never
        // assigned them a reserve and therefore never lifted them above
        // the cap (their guard+duty load alone exceeded the cap, which
        // is outside Phase 9's responsibility). See the rationale block
        // above the test.
        const lsProctors = (state.loadState && state.loadState.proctors) || {};
        const unmatched = [];
        for (let oi = 0; oi < fl.overCap.length; oi += 1) {
            const oc = fl.overCap[oi];
            const procEntry = lsProctors[oc.key];
            const rcOf = procEntry && typeof procEntry.reserveCount === 'number'
                ? procEntry.reserveCount
                : 0;
            if (rcOf === 0) continue;
            let matched = false;
            for (let ei = 0; ei < overflowList.length; ei += 1) {
                const e = overflowList[ei];
                if (e
                    && e.canonicalKey === oc.key
                    && e.cap === stats.cap
                    && e.reason === 'forced_overflow'
                    && typeof e.finalLoad === 'number'
                    && e.finalLoad > stats.cap) {
                    matched = true;
                    break;
                }
            }
            if (!matched) {
                unmatched.push({
                    key: oc.key,
                    finalLoad: oc.finalLoad,
                    reserveCount: rcOf
                });
            }
        }

        if (unmatched.length > 0 || malformed.length > 0) {
            counterexamples.push({
                seed: seed,
                G: stats.G,
                D: stats.D,
                N: stats.N,
                R: stats.R,
                cap: stats.cap,
                maxFinalLoad: fl.maxFL,
                overCap: fl.overCap.slice(0, 5),
                unmatchedOverCap: unmatched.slice(0, 5),
                malformedOverflowEntries: malformed.slice(0, 5),
                overflowCount: overflowList.length
            });
        }
    }

    if (counterexamples.length > 0) {
        // Surface the FIRST counterexample (smallest seed) verbatim so
        // it is captured in the test runner output and persisted for the
        // PBT status update that the orchestrator records.
        const first = counterexamples[0];
        const summary = 'Property 1 violated on '
            + counterexamples.length + '/' + evaluated
            + ' evaluated PBT inputs. First counterexample: '
            + JSON.stringify(first);
        const err = new Error(summary);
        err.counterexamples = counterexamples;
        throw err;
    }

    assert.ok(
        evaluated > 0,
        'Expected at least one PBT seed to run through Phase 9 successfully'
    );
});

// ---------------------------------------------------------------------------
// Diagnostics-presence on PBT inputs (Sub-case B companion).
//
// Asserts that on the UNFIXED Phase 9, `diagnostics.finalLoadOverflows`
// is undefined for every generated input. Will be relaxed to
// `Array.isArray(...)` in Task 6.1 once the fix lands.
// ---------------------------------------------------------------------------

test('Sub-case B: PBT — diagnostics.finalLoadOverflows is present as an array on fixed code', () => {
    const N_SEEDS = 30;
    let evaluated = 0;
    let presentCount = 0;
    let arrayCount = 0;

    for (let s = 0; s < N_SEEDS; s += 1) {
        const seed = (s + 1) * 1009 + 17;
        const rng = createPRNG(seed);
        const input = arbitraryInput(rng);
        input.reservesConfig = { mode: 'fixed', fixed: 1, percent: 0 };

        let state;
        try {
            state = runUpToPhase9(input, {
                phase4TimeBudgetMs: 200,
                phase9TimeBudgetMs: 500
            });
        } catch {
            continue;
        }
        evaluated += 1;
        if (state.diagnostics && state.diagnostics.finalLoadOverflows !== undefined) {
            presentCount += 1;
            if (Array.isArray(state.diagnostics.finalLoadOverflows)) {
                arrayCount += 1;
            }
        }
    }

    assert.ok(evaluated > 0, 'Expected at least one PBT seed to run successfully');
    // Task 6.1: relaxed from `presentCount === 0` (unfixed) to
    // `presentCount === evaluated && arrayCount === evaluated` (fixed).
    // After the fix lands, every successful Phase 9 run MUST emit
    // `diagnostics.finalLoadOverflows` as an array on every input.
    assert.strictEqual(
        presentCount, evaluated,
        'fixed Phase 9 must emit diagnostics.finalLoadOverflows on every PBT input'
            + ' (relaxed from === undefined in Task 6.1)'
    );
    assert.strictEqual(
        arrayCount, evaluated,
        'fixed Phase 9 must emit diagnostics.finalLoadOverflows as an array on every PBT input'
    );
});

// ===========================================================================
// Preservation property tests (Task 2)
//
// Property 2: Preservation — Non-buggy inputs unchanged.
//
// These tests run on the UNFIXED Phase 9 today and MUST PASS. They snapshot
// the dimensions Phase 9 must NEVER alter (proctor_keys / Primary_Load /
// Reserve_Count gap / determinism / reserveImbalances / per-row fresh
// arrays) and the intra-tier affinity ordering inside Tier 1. After the
// fix lands (Task 3) these same assertions are re-run unchanged in
// Task 6.2 — they form the regression net.
//
// References:
//   - design.md → "Expected Behavior" → "Preservation Requirements"
//   - design.md → "Correctness Properties" → Property 2
//   - design.md → "Testing Strategy" → "Preservation Checking" /
//     "Property-Based Tests" (Property 2 / Property 3)
//   - bugfix.md → 3.1..3.7
//   - .agent/proctor-v3-reserve-final-load-fairness.md → AC-FL4..6, FL8
//
// Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
// ===========================================================================

// `computeHistogramByGuardCount` and `computeHistogramByPrimaryLoad` live
// in `js/algorithms/proctor-v3/diagnostics.js` (re-exported by
// `js/algorithms/proctor-v3/index.js`). We require the source module
// directly so this test doesn't depend on the bundle being rebuilt.
const {
    computeHistogramByGuardCount,
    computeHistogramByPrimaryLoad
} = require(path.join(V3_ROOT, 'diagnostics.js'));

// ---------------------------------------------------------------------------
// Local helpers (preservation block).
// ---------------------------------------------------------------------------

/**
 * Iterate seeds and yield `{ seed, input, state }` for the ones that run
 * Phase 9 cleanly. Skips inputs whose Phase 0..4 composition is rejected
 * (mirrors the convention in Sub-case B above).
 *
 * `mutateInput(input)` is invoked on every generated input *before*
 * Phase 9 is run so callers can pin `reservesConfig` or any other
 * per-test parameter.
 */
function forEachPbtState(nSeeds, mutateInput, options) {
    const out = [];
    for (let s = 0; s < nSeeds; s += 1) {
        const seed = (s + 1) * 1009 + 17;
        const rng = createPRNG(seed);
        const input = arbitraryInput(rng);
        if (typeof mutateInput === 'function') mutateInput(input);
        let state;
        try {
            state = runUpToPhase9(input, options || {
                phase4TimeBudgetMs: 200,
                phase9TimeBudgetMs: 500
            });
        } catch {
            continue;
        }
        out.push({ seed: seed, input: input, state: state });
    }
    return out;
}

function reserveCountStats(loadState) {
    const proctors = (loadState && loadState.proctors) || {};
    const keys = Object.keys(proctors);
    if (keys.length === 0) return { min: 0, max: 0, count: 0 };
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < keys.length; i += 1) {
        const rc = (proctors[keys[i]] && proctors[keys[i]].reserveCount) || 0;
        if (rc < min) min = rc;
        if (rc > max) max = rc;
    }
    return { min: min, max: max, count: keys.length };
}

function snapshotReserveKeys(rows) {
    return (rows || []).map(function (r) {
        return r && Array.isArray(r.reserve_keys) ? r.reserve_keys.slice() : null;
    });
}

// ---------------------------------------------------------------------------
// Test 2.1 — Histogram preservation (PBT)
//
// Snapshot `computeHistogramByGuardCount(rows)` and
// `computeHistogramByPrimaryLoad(loadState, classByProctorKey)` on the
// unfixed Phase 9 across many PBT-generated inputs. Assert each histogram
// is a plain object whose every value is a non-negative integer and whose
// numProctors total matches expectations (sum-of-values == eligible
// proctor count for primary-load; sum-of-values == distinct proctor keys
// touched by proctor_keys for guard-count). The snapshot itself is the
// observation — after the fix Task 6.2 re-runs the same code and gets
// byte-identical histograms because Phase 9 never touches `proctor_keys`
// or `Primary_Load`.
// ---------------------------------------------------------------------------

test('Preservation 2.1: histograms (guardCount, primaryLoad) are plain {string→nat} maps and stable per seed', () => {
    const cases = forEachPbtState(30, function (input) {
        input.reservesConfig = { mode: 'fixed', fixed: 1, percent: 0 };
    });
    assert.ok(cases.length > 0, 'expected at least one PBT seed to compose successfully');

    for (let i = 0; i < cases.length; i += 1) {
        const c = cases[i];
        const histG = computeHistogramByGuardCount(c.state.rows || []);
        const histP = computeHistogramByPrimaryLoad(
            c.state.loadState,
            c.state.classByProctorKey
        );

        // Shape: plain object, no array, every key is a numeric string,
        // every value is a non-negative integer.
        const checkShape = function (h, name) {
            assert.ok(h && typeof h === 'object' && !Array.isArray(h),
                'seed=' + c.seed + ': ' + name + ' must be a plain object');
            const keys = Object.keys(h);
            for (let k = 0; k < keys.length; k += 1) {
                const key = keys[k];
                assert.ok(/^\d+$/.test(key),
                    'seed=' + c.seed + ': ' + name + ' bucket key must be a non-negative integer string, got ' + JSON.stringify(key));
                const v = h[key];
                assert.ok(Number.isInteger(v) && v >= 0,
                    'seed=' + c.seed + ': ' + name + '[' + key + '] must be a non-negative integer, got ' + v);
            }
        };
        checkShape(histG, 'histogramByGuardCount');
        checkShape(histP, 'histogramByPrimaryLoad');

        // Stability: recomputing on the SAME state must produce a
        // byte-identical histogram (pure functions of rows / loadState).
        const histG2 = computeHistogramByGuardCount(c.state.rows || []);
        const histP2 = computeHistogramByPrimaryLoad(
            c.state.loadState,
            c.state.classByProctorKey
        );
        assert.strictEqual(JSON.stringify(histG), JSON.stringify(histG2),
            'seed=' + c.seed + ': histogramByGuardCount must be stable across recomputation');
        assert.strictEqual(JSON.stringify(histP), JSON.stringify(histP2),
            'seed=' + c.seed + ': histogramByPrimaryLoad must be stable across recomputation');
    }
});

// ---------------------------------------------------------------------------
// Test 2.2 — Reserve_Count gap on tests/fixtures/45454.json
//
// Per design.md → "Preservation Requirements": the Reserve_Count
// histogram gap stays `<= 1` on the production fixture (today
// `{0:68, 1:79}`). This is also AC-FL5.
// ---------------------------------------------------------------------------

test('Preservation 2.2: production fixture 45454.json — max(reserveCount) - min(reserveCount) <= 1', () => {
    const input = require(path.join(__dirname, '..', 'fixtures', '45454.json'));
    const state = runUpToPhase9(input, {
        phase4TimeBudgetMs: 60000,
        phase9TimeBudgetMs: 5000
    });

    const stats = reserveCountStats(state.loadState);
    console.log(
        '    [doc] fixture=45454.json reserveCount stats:'
        + ' min=' + stats.min
        + ' max=' + stats.max
        + ' gap=' + (stats.max - stats.min)
        + ' nProctors=' + stats.count
    );
    assert.ok(stats.count > 0, 'fixture must populate loadState.proctors');
    assert.ok(stats.max - stats.min <= 1,
        'AC-FL5: reserveCount gap must be <= 1, observed '
        + 'min=' + stats.min + ' max=' + stats.max);
});

// ---------------------------------------------------------------------------
// Test 2.3 — Determinism (Requirement 8 / AC-FL8)
//
// Two runs on the same input with the same `randomSeed` MUST produce
// byte-identical `rows`, `loadState`, and `diagnostics`. Production
// fixture is the strongest signal here (largest input we have).
// ---------------------------------------------------------------------------

test('Preservation 2.3: determinism — two runs of fixture 45454.json yield byte-identical rows/loadState/diagnostics', () => {
    const inputA = require(path.join(__dirname, '..', 'fixtures', '45454.json'));
    // Re-`require` would return the cached object — clone via JSON to
    // guarantee the two runs see independent input objects.
    const inputB = JSON.parse(JSON.stringify(inputA));

    const stateA = runUpToPhase9(inputA, {
        phase4TimeBudgetMs: 60000,
        phase9TimeBudgetMs: 5000
    });
    const stateB = runUpToPhase9(inputB, {
        phase4TimeBudgetMs: 60000,
        phase9TimeBudgetMs: 5000
    });

    // Strip wall-clock-time fields from `diagnostics` before comparing.
    // Determinism (Requirement 8 / AC-FL8) targets the *content* of the
    // schedule (rows, loadState, structural diagnostics), not phase
    // execution timings. `phase4.elapsedMs`, `totalDurationMs`,
    // `phaseDurations`, and similar timing fields are wall-clock
    // measurements that legitimately drift between runs (e.g. 21ms vs
    // 22ms) and are not part of the "byte-identical schedule"
    // contract. We deep-clone the diagnostics object and remove the
    // volatile time fields, then compare the structural remainder.
    const TIME_FIELDS = [
        'elapsedMs',
        'totalDurationMs',
        'phaseDurations',
        'bimodalRepairIterations',
        'durationMs',
        'startedAt',
        'finishedAt'
    ];
    const stripTimeFields = function (value) {
        if (Array.isArray(value)) {
            return value.map(stripTimeFields);
        }
        if (value && typeof value === 'object') {
            const out = {};
            const keys = Object.keys(value);
            for (let i = 0; i < keys.length; i += 1) {
                const k = keys[i];
                if (TIME_FIELDS.indexOf(k) !== -1) continue;
                out[k] = stripTimeFields(value[k]);
            }
            return out;
        }
        return value;
    };
    const diagA = stripTimeFields(stateA.diagnostics || {});
    const diagB = stripTimeFields(stateB.diagnostics || {});

    assert.strictEqual(JSON.stringify(stateA.rows), JSON.stringify(stateB.rows),
        'rows must be byte-identical across two runs with the same input');
    assert.strictEqual(JSON.stringify(stateA.loadState), JSON.stringify(stateB.loadState),
        'loadState must be byte-identical across two runs with the same input');
    assert.strictEqual(JSON.stringify(diagA), JSON.stringify(diagB),
        'diagnostics (excluding wall-clock time fields) must be byte-identical across two runs with the same input');
});

// ---------------------------------------------------------------------------
// Test 2.4 — Affinity intra-tier preservation (PBT)
//
// Build inputs where every eligible candidate falls into Tier 1. The
// cheapest way to force this on the unfixed comparator is to set
// `reservesConfig` so R = 0 (no reserves requested). With R = 0 every
// session's actualPick is 0, so reserve_keys on every row is `[]`. We
// snapshot that and assert it stays `[]` across the seeds — the
// post-fix code MUST produce the same snapshot because Tier 2 is empty
// when R = 0 (cap = ceil((G+0+D)/N) is generous; no candidate is at
// or over).
//
// We additionally exercise a SECOND configuration — `fixed: 1` with a
// generous cap inferred from `arbitraryInput`'s small size — and snapshot
// the per-row `reserve_keys` ordering. The unfixed comparator chooses by
// `(reserveCount, affinityRank, finalLoad, key)`; when ALL candidates
// satisfy `finalLoad + 1 <= cap`, the post-fix `[...Tier1, ...Tier2]`
// concatenation collapses to the same ordering since Tier 2 is empty.
// ---------------------------------------------------------------------------

test('Preservation 2.4: Tier 1 only (R=0) — every row.reserve_keys is empty and stable per seed', () => {
    const cases = forEachPbtState(20, function (input) {
        input.reservesConfig = { mode: 'fixed', fixed: 0, percent: 0 };
    });
    assert.ok(cases.length > 0, 'expected at least one PBT seed to compose successfully');

    for (let i = 0; i < cases.length; i += 1) {
        const c = cases[i];
        const rows = c.state.rows || [];
        for (let r = 0; r < rows.length; r += 1) {
            const row = rows[r];
            assert.ok(row && Array.isArray(row.reserve_keys),
                'seed=' + c.seed + ' row ' + r + ': reserve_keys must be an array');
            assert.strictEqual(row.reserve_keys.length, 0,
                'seed=' + c.seed + ' row ' + r + ': with R=0, reserve_keys must be empty');
        }
    }
});

test('Preservation 2.4: Tier 1 only (fixed:1) — per-seed snapshot of reserve_keys is stable across recomputation', () => {
    // Snapshot the unfixed comparator's choice and re-run on the same
    // seed: byte-identical because Phase 9 is pure given the same input.
    const cases = forEachPbtState(20, function (input) {
        input.reservesConfig = { mode: 'fixed', fixed: 1, percent: 0 };
    });
    assert.ok(cases.length > 0, 'expected at least one PBT seed to compose successfully');

    for (let i = 0; i < cases.length; i += 1) {
        const c = cases[i];
        const snapA = snapshotReserveKeys(c.state.rows);

        // Re-run from scratch with a fresh PRNG / input on the same seed
        // and confirm byte-identical reserve_keys.
        const rng = createPRNG(c.seed);
        const inputB = arbitraryInput(rng);
        inputB.reservesConfig = { mode: 'fixed', fixed: 1, percent: 0 };
        let stateB;
        try {
            stateB = runUpToPhase9(inputB, {
                phase4TimeBudgetMs: 200,
                phase9TimeBudgetMs: 500
            });
        } catch {
            continue; // matches the skip-policy in forEachPbtState
        }
        const snapB = snapshotReserveKeys(stateB.rows);
        assert.strictEqual(JSON.stringify(snapA), JSON.stringify(snapB),
            'seed=' + c.seed + ': reserve_keys snapshot must be byte-identical across two runs');
    }
});

// ---------------------------------------------------------------------------
// Test 2.5 — `reserveImbalances` preservation (AC 7.8 / AC-FL8)
//
// Snapshot `state.diagnostics.reserveImbalances` on the production
// fixture and assert it has the AC 7.8 entry shape
// `{ overloadedKey, underloadedKey, deltaCount, blockingReason }`. The
// new `finalLoadOverflows` list (added in Task 3) is purely additive —
// after the fix the SAME entries with the SAME shape continue to be
// emitted, asserted byte-for-byte by re-running this test in Task 6.2.
// ---------------------------------------------------------------------------

test('Preservation 2.5: production fixture 45454.json — diagnostics.reserveImbalances has AC 7.8 shape', () => {
    const input = require(path.join(__dirname, '..', 'fixtures', '45454.json'));
    const state = runUpToPhase9(input, {
        phase4TimeBudgetMs: 60000,
        phase9TimeBudgetMs: 5000
    });

    const diag = state.diagnostics || {};
    assert.ok(Array.isArray(diag.reserveImbalances),
        'diagnostics.reserveImbalances must be an array (AC 7.8)');
    console.log(
        '    [doc] fixture=45454.json reserveImbalances.length=' + diag.reserveImbalances.length
    );
    for (let i = 0; i < diag.reserveImbalances.length; i += 1) {
        const e = diag.reserveImbalances[i];
        assert.ok(e && typeof e === 'object' && !Array.isArray(e),
            'reserveImbalances[' + i + '] must be a plain object');
        assert.ok(typeof e.overloadedKey === 'string' && e.overloadedKey.length > 0,
            'reserveImbalances[' + i + '].overloadedKey must be a non-empty string');
        assert.ok(typeof e.underloadedKey === 'string' && e.underloadedKey.length > 0,
            'reserveImbalances[' + i + '].underloadedKey must be a non-empty string');
        assert.ok(Number.isInteger(e.deltaCount) && e.deltaCount >= 0,
            'reserveImbalances[' + i + '].deltaCount must be a non-negative integer');
        assert.ok(typeof e.blockingReason === 'string',
            'reserveImbalances[' + i + '].blockingReason must be a string');
    }
});

// ---------------------------------------------------------------------------
// Test 2.6 — Per-row fresh `reserve_keys` arrays (AC 10.2 / AC 7.4a)
//
// 1. No two rows share the same `reserve_keys` array reference — mutating
//    one row's array MUST NOT affect any other row.
// 2. Within a single session, the union of `reserve_keys` contains each
//    canonical key at most once (AC 7.4a).
//
// Run on the production fixture (large, real-world signal) AND on the
// PBT-generated inputs from Test 2.1 to maximize coverage.
// ---------------------------------------------------------------------------

function assertPerRowFreshAndAtMostOnce(state, label) {
    const rows = state.rows || [];

    // 1. Freshness — distinct array identities.
    const seenIdentities = new Set();
    for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i];
        if (!r || !Array.isArray(r.reserve_keys)) continue;
        assert.ok(!seenIdentities.has(r.reserve_keys),
            label + ': row ' + i + '.reserve_keys array is shared with another row (AC 10.2)');
        seenIdentities.add(r.reserve_keys);
    }

    // Mutation isolation — confirmed by appending a sentinel to row 0's
    // array and verifying no other row's array grew. We restore the
    // sentinel afterwards so the rest of the test suite sees a pristine
    // state.
    if (rows.length >= 2 && Array.isArray(rows[0].reserve_keys)) {
        const beforeLengths = rows.map(function (r) {
            return r && Array.isArray(r.reserve_keys) ? r.reserve_keys.length : -1;
        });
        rows[0].reserve_keys.push('__sentinel__');
        for (let i = 1; i < rows.length; i += 1) {
            const r = rows[i];
            if (!r || !Array.isArray(r.reserve_keys)) continue;
            assert.strictEqual(r.reserve_keys.length, beforeLengths[i],
                label + ': mutating rows[0].reserve_keys altered rows[' + i + '].reserve_keys (AC 10.2)');
        }
        // Restore.
        rows[0].reserve_keys.pop();
    }

    // 2. AC 7.4a — at-most-once across the union of reserve_keys per session.
    const bySession = Object.create(null);
    for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i];
        if (!r || typeof r.session_key !== 'string') continue;
        if (!bySession[r.session_key]) bySession[r.session_key] = [];
        bySession[r.session_key].push(r);
    }
    const sessionKeys = Object.keys(bySession);
    for (let s = 0; s < sessionKeys.length; s += 1) {
        const grp = bySession[sessionKeys[s]];
        const seen = Object.create(null);
        for (let g = 0; g < grp.length; g += 1) {
            const resKeys = Array.isArray(grp[g].reserve_keys) ? grp[g].reserve_keys : [];
            for (let j = 0; j < resKeys.length; j += 1) {
                const k = resKeys[j];
                assert.ok(!seen[k],
                    label + ': canonical key ' + k + ' appears more than once'
                    + ' in reserve_keys union for session ' + sessionKeys[s] + ' (AC 7.4a)');
                seen[k] = true;
            }
        }
    }
}

test('Preservation 2.6: production fixture 45454.json — per-row fresh reserve_keys + AC 7.4a', () => {
    const input = require(path.join(__dirname, '..', 'fixtures', '45454.json'));
    const state = runUpToPhase9(input, {
        phase4TimeBudgetMs: 60000,
        phase9TimeBudgetMs: 5000
    });
    assertPerRowFreshAndAtMostOnce(state, 'fixture=45454.json');
});

test('Preservation 2.6: PBT — per-row fresh reserve_keys + AC 7.4a across arbitraryInput seeds', () => {
    const cases = forEachPbtState(20, function (input) {
        input.reservesConfig = { mode: 'fixed', fixed: 1, percent: 0 };
    });
    assert.ok(cases.length > 0, 'expected at least one PBT seed to compose successfully');
    for (let i = 0; i < cases.length; i += 1) {
        assertPerRowFreshAndAtMostOnce(cases[i].state, 'seed=' + cases[i].seed);
    }
});

// ===========================================================================
// Production fixture integration assertions (Task 6.3)
//
// End-to-end exercise of `tests/fixtures/45454.json` through the public
// V3 orchestrator (`js/algorithms/proctor-v3/index.js#run`) AFTER the
// bundle rebuild from Task 5. These assertions complement the harness-
// based checks in Tests 2.2 and 2.5 by also validating the public
// envelope returned by `run()` — `result` rows, `diagnostics.histogram*`,
// `diagnostics.finalLoadOverflows`, and reserve-count gap — all in a
// single end-to-end pass.
//
// The cap derivation (G, R, D, N) is computed off a parallel
// `runUpToPhase9` invocation on the same fixture so the formula matches
// the design.md → "Glossary" definition byte-for-byte. The harness path
// also yields the canonical `loadState` for the `max(finalLoad) <= cap`
// assertion.
//
// Snapshot semantics: the histogram "byte-for-byte" check is a stability
// assertion within the same run — `histogramByGuardCount` recomputed by
// hand from `result` rows must equal the orchestrator's emitted
// histogram, and `histogramByPrimaryLoad` recomputed from the harness
// loadState must equal the orchestrator's. This guarantees the fix did
// not silently re-derive either histogram from a different source.
//
// References:
//   - design.md → "Testing Strategy" → "Integration Tests"
//   - bugfix.md → 2.2, 3.2, 3.3
//   - .agent/proctor-v3-reserve-final-load-fairness.md → AC-FL5, FL6, FL7
//
// Validates: Requirements 2.2, 3.2, 3.3
// ===========================================================================

const v3Public = require(path.join(V3_ROOT, 'index.js'));

test('Integration: production fixture max(finalLoad) <= cap (AC-FL7)', () => {
    const input = require(path.join(__dirname, '..', 'fixtures', '45454.json'));

    // End-to-end pass through the V3 orchestrator — this is the path the
    // application takes in production and is the path the bundle rebuild
    // (Task 5) now ships.
    const envelope = v3Public.run(input, { totalBudgetMs: 120000 });
    assert.ok(envelope && envelope.algorithmVersion === 'v3',
        'orchestrator must return a v3 envelope');
    assert.ok(envelope.orchestratorState === 'COMPLETED'
        || envelope.orchestratorState === 'DEGRADED',
        'orchestrator must reach COMPLETED or DEGRADED on the production fixture, got '
        + envelope.orchestratorState);

    // Cap derivation from a parallel harness run (same fixture, same
    // pipeline up to and including Phase 9). Phase 9 is deterministic
    // given the same input + seed (Requirement 8 / AC-FL8), so the cap
    // and loadState below match what the orchestrator just produced.
    const harnessState = runUpToPhase9(input, {
        phase4TimeBudgetMs: 60000,
        phase9TimeBudgetMs: 5000
    });
    const stats = computeReserveGlobalUpper(harnessState);
    const fl = collectFinalLoadStats(harnessState, stats.cap);

    console.log(
        '    [doc] integration fixture=45454.json'
        + ' G=' + stats.G
        + ' R=' + stats.R
        + ' D=' + stats.D
        + ' N=' + stats.N
        + ' cap=' + stats.cap
        + ' maxFL=' + fl.maxFL
        + ' overCap=' + fl.overCap.length
    );

    assert.ok(stats.cap > 0, 'cap must be derivable on the production fixture (N > 0)');
    assert.ok(fl.maxFL <= stats.cap,
        'AC-FL7: max(finalLoad) must be <= cap on the production fixture, '
        + 'observed max=' + fl.maxFL + ' cap=' + stats.cap
        + ' overCap=' + JSON.stringify(fl.overCap.slice(0, 5)));
});

test('Integration: production fixture histogramByGuardCount stable (AC-FL6)', () => {
    const input = require(path.join(__dirname, '..', 'fixtures', '45454.json'));
    const envelope = v3Public.run(input, { totalBudgetMs: 120000 });
    assert.ok(envelope && envelope.diagnostics, 'envelope.diagnostics must be present');

    const emitted = envelope.diagnostics.histogramByGuardCount;
    assert.ok(emitted && typeof emitted === 'object' && !Array.isArray(emitted),
        'diagnostics.histogramByGuardCount must be a plain object');

    // Recompute from the result rows. Phase 9 is the only phase that
    // could touch `proctor_keys` post-fix, and it was specified to leave
    // them untouched (design.md → "Preservation Requirements"). So the
    // histogram derived from `result` rows MUST match the diagnostics-
    // emitted one byte-for-byte — a regression here means either the
    // histogram source diverged or `proctor_keys` was mutated.
    const recomputed = computeHistogramByGuardCount(envelope.result || []);
    assert.strictEqual(JSON.stringify(emitted), JSON.stringify(recomputed),
        'AC-FL6: histogramByGuardCount must equal the recomputation from result rows; '
        + 'emitted=' + JSON.stringify(emitted) + ' recomputed=' + JSON.stringify(recomputed));

    // Stability across two end-to-end runs (determinism / Requirement 8).
    const inputB = JSON.parse(JSON.stringify(input));
    const envelopeB = v3Public.run(inputB, { totalBudgetMs: 120000 });
    assert.strictEqual(
        JSON.stringify(emitted),
        JSON.stringify(envelopeB.diagnostics.histogramByGuardCount),
        'AC-FL6: histogramByGuardCount must be byte-identical across two runs of the same fixture');

    console.log('    [doc] histogramByGuardCount=' + JSON.stringify(emitted));
});

test('Integration: production fixture histogramByPrimaryLoad stable (AC-FL6)', () => {
    const input = require(path.join(__dirname, '..', 'fixtures', '45454.json'));
    const envelope = v3Public.run(input, { totalBudgetMs: 120000 });
    assert.ok(envelope && envelope.diagnostics, 'envelope.diagnostics must be present');

    const emitted = envelope.diagnostics.histogramByPrimaryLoad;
    assert.ok(emitted && typeof emitted === 'object' && !Array.isArray(emitted),
        'diagnostics.histogramByPrimaryLoad must be a plain object');

    // Recompute Primary_Load histogram from a parallel harness run's
    // loadState (Phase 9 never touches Guard_Count or Duty_Count, so the
    // two sources must agree).
    const harnessState = runUpToPhase9(input, {
        phase4TimeBudgetMs: 60000,
        phase9TimeBudgetMs: 5000
    });
    const recomputed = computeHistogramByPrimaryLoad(
        harnessState.loadState,
        harnessState.classByProctorKey
    );
    assert.strictEqual(JSON.stringify(emitted), JSON.stringify(recomputed),
        'AC-FL6: histogramByPrimaryLoad must equal the recomputation from harness loadState; '
        + 'emitted=' + JSON.stringify(emitted) + ' recomputed=' + JSON.stringify(recomputed));

    // Determinism across two orchestrator runs.
    const inputB = JSON.parse(JSON.stringify(input));
    const envelopeB = v3Public.run(inputB, { totalBudgetMs: 120000 });
    assert.strictEqual(
        JSON.stringify(emitted),
        JSON.stringify(envelopeB.diagnostics.histogramByPrimaryLoad),
        'AC-FL6: histogramByPrimaryLoad must be byte-identical across two runs of the same fixture');

    console.log('    [doc] histogramByPrimaryLoad=' + JSON.stringify(emitted));
});

test('Integration: production fixture finalLoadOverflows is empty array (AC-FL3)', () => {
    const input = require(path.join(__dirname, '..', 'fixtures', '45454.json'));
    const envelope = v3Public.run(input, { totalBudgetMs: 120000 });
    assert.ok(envelope && envelope.diagnostics, 'envelope.diagnostics must be present');

    const overflows = envelope.diagnostics.finalLoadOverflows;
    assert.ok(Array.isArray(overflows),
        'diagnostics.finalLoadOverflows must be an Array on every orchestrator run (AC-FL3)');
    assert.strictEqual(overflows.length, 0,
        'AC-FL3: production fixture has 88+ FL=2 candidates available for the offending session — '
        + 'no forced overflow expected, got ' + overflows.length + ' entries: '
        + JSON.stringify(overflows.slice(0, 5)));
});

test('Integration: production fixture reserveCount gap <= 1 (AC-FL5)', () => {
    const input = require(path.join(__dirname, '..', 'fixtures', '45454.json'));

    // Run the orchestrator end-to-end so the assertion covers the full
    // production pipeline (this duplicates Test 2.2 deliberately — Test
    // 2.2 uses the harness, this one uses the public `run()` envelope to
    // confirm reserve-count fairness survives the orchestrator's
    // diagnostics-shaping layer).
    v3Public.run(input, { totalBudgetMs: 120000 });

    // Reserve_Count is exposed on the harness loadState; the orchestrator
    // does not currently surface per-proctor reserveCount in the public
    // diagnostics shape. We therefore rely on the same harness path used
    // throughout this file (deterministic per Requirement 8).
    const harnessState = runUpToPhase9(input, {
        phase4TimeBudgetMs: 60000,
        phase9TimeBudgetMs: 5000
    });
    const rcStats = reserveCountStats(harnessState.loadState);
    console.log(
        '    [doc] integration reserveCount min=' + rcStats.min
        + ' max=' + rcStats.max
        + ' gap=' + (rcStats.max - rcStats.min)
        + ' nProctors=' + rcStats.count
    );
    assert.ok(rcStats.count > 0, 'fixture must populate loadState.proctors');
    assert.ok(rcStats.max - rcStats.min <= 1,
        'AC-FL5: reserveCount gap must be <= 1, observed min='
        + rcStats.min + ' max=' + rcStats.max);
});

// ---------------------------------------------------------------------------
// Runner footer
// ---------------------------------------------------------------------------

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
    // Surface the first counterexample in the process exit summary so
    // CI logs include it without the user needing to scroll.
    const first = failureLog[0];
    if (first && first.err && first.err.counterexamples) {
        console.error('First counterexample (Sub-case B):');
        console.error(JSON.stringify(first.err.counterexamples[0], null, 2));
    }
    process.exit(1);
}
