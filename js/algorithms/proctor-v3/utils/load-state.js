'use strict';

/**
 * Load-state utilities for proctor-distribution-v3.
 *
 * The LoadState is an accumulator object passed through the pipeline phases.
 * Each entry tracks per-proctor counts:
 *   - guardCount   : slot-based count of guard assignments
 *   - dutyCount    : slot-based count of duty assignments (per halfday entry)
 *   - reserveCount : slot-based count of reserve assignments
 *   - amCount      : guard slots in morning (صباحا) period
 *   - pmCount      : guard slots in afternoon (مساء) period
 *
 * Mutation policy:
 *   The `add*` functions mutate the LoadState in place — the caller is
 *   expected to treat the LoadState as a single accumulator that flows
 *   through phases (Phase 4 fills guardCount, Phase 9 fills reserveCount,
 *   etc). This avoids deep-cloning a large object on every increment.
 *
 *   Within a phase, the standard pattern is:
 *     const stateOut = { ...stateIn, loadState: stateIn.loadState };
 *     addGuardLoad(stateOut.loadState, key, ...);
 *
 *   Phases that need to roll back must clone before mutating.
 *
 * V3 vs V2 — CRITICAL DIFFERENCE:
 *   V2's addReserveLoad was halfday-based (used a Set of halfday keys, only
 *   incrementing reserveCount when a NEW halfday was added). This made
 *   Reserve_Count count distinct halfdays NOT slots, breaking reserve
 *   fair-ordering (Requirement 7.5).
 *
 *   V3 is consistently slot-based across all three add functions:
 *   addGuardLoad, addDutyLoad, addReserveLoad ALL increment on every call.
 *
 * Acceptance Criteria covered:
 *   - 5.1  : Primary_Load = Guard_Count + Duty_Count (slot-based)
 *   - 6.4  : AM/PM balance counters per proctor
 *   - 7.5  : Reserve_Count is slot-based, used in reserve fair ordering
 */

// Recognized period values for AM/PM bucketing.
// Anything outside these sets is treated as neither (defensive).
//   - 'صباحا'  (AM / morning) and 'زوالا' (noon / afternoon, PM) are the two
//     period strings used by the production fixture (45454.json).
const AM_PERIODS = Object.freeze(['صباحا', 'AM', 'morning']);
const PM_PERIODS = Object.freeze(['مساء', 'زوالا', 'PM', 'afternoon']);

/**
 * Create a fresh per-proctor entry with all counts at zero.
 *
 * @returns {{
 *   guardCount: number,
 *   dutyCount: number,
 *   reserveCount: number,
 *   amCount: number,
 *   pmCount: number
 * }}
 */
function createEntry() {
    return {
        guardCount: 0,
        dutyCount: 0,
        reserveCount: 0,
        amCount: 0,
        pmCount: 0,
    };
}

/**
 * Initialize a LoadState for the given canonical keys, all counts at zero.
 *
 * If `canonicalKeys` is empty/null/undefined, returns an empty `proctors`
 * object — the add* functions lazily create entries on first use.
 *
 * @param {string[]} canonicalKeys - canonical proctor keys to pre-initialize.
 * @returns {{ proctors: Object<string, ReturnType<typeof createEntry>> }}
 */
function createLoadState(canonicalKeys) {
    const proctors = Object.create(null);

    if (Array.isArray(canonicalKeys)) {
        for (let i = 0; i < canonicalKeys.length; i += 1) {
            const key = canonicalKeys[i];
            if (typeof key !== 'string' || key.length === 0) continue;
            // Pre-initialize. If a duplicate key appears, keep the first
            // entry (idempotent).
            if (!proctors[key]) {
                proctors[key] = createEntry();
            }
        }
    }

    return { proctors: proctors };
}

/**
 * Internal: get-or-create the per-proctor entry for `key`.
 *
 * @param {Object} loadState
 * @param {string} key
 * @returns {ReturnType<typeof createEntry>}
 */
function getOrCreateEntry(loadState, key) {
    if (!loadState || typeof loadState !== 'object' || !loadState.proctors) {
        throw new TypeError('load-state: loadState must be an object with a proctors map');
    }
    if (typeof key !== 'string' || key.length === 0) {
        throw new TypeError('load-state: key must be a non-empty string');
    }
    let entry = loadState.proctors[key];
    if (!entry) {
        entry = createEntry();
        loadState.proctors[key] = entry;
    }
    return entry;
}

/**
 * Increment guard count for `key` (slot-based).
 *
 * Increments on EVERY call — one call per (row, slot) assignment.
 * Also increments amCount or pmCount if `period` is recognized.
 *
 * The halfdayKey/dayKey/sessionKey parameters are accepted for API
 * symmetry with addReserveLoad and to allow future extensions
 * (e.g. tracking sets of halfdays for diagnostics) without a signature
 * change. They are not used for the slot-based count itself.
 *
 * @param {Object} loadState
 * @param {string} key            - canonical proctor key
 * @param {string} halfdayKey     - halfday key (informational)
 * @param {string} dayKey         - day key (informational)
 * @param {string} sessionKey     - session key (informational)
 * @param {string} period         - 'صباحا' | 'AM' | 'morning' for AM,
 *                                  'مساء' | 'PM' | 'afternoon' for PM,
 *                                  anything else: bucketed as neither.
 */
function addGuardLoad(loadState, key, halfdayKey, dayKey, sessionKey, period) {
    const entry = getOrCreateEntry(loadState, key);
    entry.guardCount += 1;
    if (typeof period === 'string') {
        if (AM_PERIODS.indexOf(period) !== -1) {
            entry.amCount += 1;
        } else if (PM_PERIODS.indexOf(period) !== -1) {
            entry.pmCount += 1;
        }
    }
}

/**
 * Decrement guardCount and matching AM/PM bucket. Floors at 0.
 * Counterpart of addGuardLoad for repair/swap phases (coverage, bimodal).
 * Does not touch guardSessions / guardHalfdays occupancy Sets — caller clears those.
 *
 * @param {Object} loadState
 * @param {string} key
 * @param {string} [period]
 */
function removeGuardLoad(loadState, key, period) {
    const entry = getEntry(loadState, key);
    if (!entry) return;
    if (entry.guardCount > 0) entry.guardCount -= 1;
    if (typeof period === 'string') {
        if (AM_PERIODS.indexOf(period) !== -1) {
            if (entry.amCount > 0) entry.amCount -= 1;
        } else if (PM_PERIODS.indexOf(period) !== -1) {
            if (entry.pmCount > 0) entry.pmCount -= 1;
        }
    }
}

/** Alias used by repair phases (05 / 07). */
function decrementGuardLoad(loadState, key, period) {
    removeGuardLoad(loadState, key, period);
}

/**
 * 3-arg convenience for repair swaps (loadState, key, period only).
 * Delegates to addGuardLoad with empty informational keys.
 */
function incrementGuardLoad(loadState, key, period) {
    addGuardLoad(loadState, key, '', '', '', period);
}

function isAmPeriod(period) {
    return typeof period === 'string' && AM_PERIODS.indexOf(period) !== -1;
}

function isPmPeriod(period) {
    return typeof period === 'string' && PM_PERIODS.indexOf(period) !== -1;
}

/**
 * Increment duty count for `key` (slot-based).
 *
 * User-defined per-halfday duty entries map 1:1 with duty load — each call
 * represents one duty entry. Increments dutyCount on EVERY call.
 *
 * @param {Object} loadState
 * @param {string} key         - canonical proctor key
 * @param {string} halfdayKey  - halfday key (informational)
 */
function addDutyLoad(loadState, key, halfdayKey) {
    const entry = getOrCreateEntry(loadState, key);
    entry.dutyCount += 1;
}

/**
 * Increment reserve count for `key` (slot-based).
 *
 * V3: increments on EVERY call (slot-based), unlike V2 which was
 * halfday-based via a Set. See top-of-file note.
 *
 * @param {Object} loadState
 * @param {string} key         - canonical proctor key
 * @param {string} halfdayKey  - halfday key (informational)
 * @param {string} dayKey      - day key (informational)
 */
function addReserveLoad(loadState, key, halfdayKey, dayKey) {
    const entry = getOrCreateEntry(loadState, key);
    entry.reserveCount += 1;
}

/**
 * Internal accessor that returns the entry for `key` or null if absent.
 *
 * @param {Object} loadState
 * @param {string} key
 * @returns {ReturnType<typeof createEntry> | null}
 */
function getEntry(loadState, key) {
    if (!loadState || typeof loadState !== 'object' || !loadState.proctors) return null;
    if (typeof key !== 'string' || key.length === 0) return null;
    return loadState.proctors[key] || null;
}

/**
 * Primary_Load(T) = Guard_Count(T) + Duty_Count(T).
 *
 * This is the fairness axis used by V3 (Acceptance Criterion 5.1).
 * Returns 0 if `key` is absent (defensive accessor).
 *
 * @param {Object} loadState
 * @param {string} key
 * @returns {number}
 */
function primaryLoad(loadState, key) {
    const entry = getEntry(loadState, key);
    if (!entry) return 0;
    return entry.guardCount + entry.dutyCount;
}

/**
 * Final_Load(T) = Guard_Count(T) + Duty_Count(T) + Reserve_Count(T).
 *
 * Returns 0 if `key` is absent.
 *
 * @param {Object} loadState
 * @param {string} key
 * @returns {number}
 */
function finalLoad(loadState, key) {
    const entry = getEntry(loadState, key);
    if (!entry) return 0;
    return entry.guardCount + entry.dutyCount + entry.reserveCount;
}

/**
 * AM guard-slot count for `key`. Returns 0 if absent.
 *
 * @param {Object} loadState
 * @param {string} key
 * @returns {number}
 */
function amCount(loadState, key) {
    const entry = getEntry(loadState, key);
    return entry ? entry.amCount : 0;
}

/**
 * PM guard-slot count for `key`. Returns 0 if absent.
 *
 * @param {Object} loadState
 * @param {string} key
 * @returns {number}
 */
function pmCount(loadState, key) {
    const entry = getEntry(loadState, key);
    return entry ? entry.pmCount : 0;
}

module.exports = {
    createLoadState,
    addGuardLoad,
    addDutyLoad,
    addReserveLoad,
    removeGuardLoad,
    decrementGuardLoad,
    incrementGuardLoad,
    primaryLoad,
    finalLoad,
    amCount,
    pmCount,
    isAmPeriod,
    isPmPeriod,
    // Public SSOT for period bucketing (phases must not re-declare incomplete lists)
    AM_PERIODS,
    PM_PERIODS,
    // Exposed for testing / advanced consumers
    _internals: {
        AM_PERIODS,
        PM_PERIODS,
        createEntry,
    },
};
