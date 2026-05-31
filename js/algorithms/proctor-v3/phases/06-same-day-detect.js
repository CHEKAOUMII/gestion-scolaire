// Proctor Distribution V3 — Phase 6: Same-Day Infeasibility Detection.
//
// PURE inspection phase. Phase 6 looks at the unresolved-slot information
// produced by Phases 4 and 5 and decides whether the orchestrator should
// later perform a relaxed-mode pre-check (re-running Phases 4–5 with
// `allowSameDayBothHalfdays = true`) to determine whether the C-NO-SAME-DAY
// constraint is the cause of unresolved coverage.
//
// Phase 6 itself NEVER calls into other phases — that would break the
// pure-function contract. The orchestrator (see `orchestrator.js`) reads
// `state.diagnostics.preCheckRequired` and decides whether to invoke the
// pre-check helper, which in turn emits the appropriate warning into
// `state.diagnostics.warnings`.
//
// Acceptance Criteria covered:
//   - 4.1  : Same_Day_Allowance_Flag defaults to false (read from input).
//   - 4.2  : When unresolved AND flag is false, mark for pre-check; the
//            orchestrator emits `same_day_relaxation_suggested` if the
//            relaxed run succeeds.
//   - 4.2a : When unresolved AND flag is false AND relaxed also fails, the
//            orchestrator emits `coverage_infeasible_regardless` instead.
//   - 4.2b : When the flag is already true, NO pre-check is performed
//            (preCheckRequired = false).
//   - 4.6  : Distinguish "same-day-only" unresolved from "any-other-cause"
//            via the orchestrator-driven relaxed comparison.
//   - 12.3 : Per-phase time budget honored (Phase 6 inspection ≤ 200ms;
//            it is O(1) work plus a single array length read).
//
// Purity contract (per design.md §"Pure-function contract"):
//   - state.input is NOT mutated.
//   - state.diagnostics is shallow-cloned with FRESH arrays for any
//     property we touch (warnings, errors, unresolvedSlots).
//   - Output state is a fresh top-level object; sibling fields are
//     forwarded by reference (intentional — they are not mutated here).

'use strict';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    return true;
}

function shallowCopyState(state) {
    var out = {};
    var keys = Object.keys(state);
    for (var i = 0; i < keys.length; i += 1) {
        out[keys[i]] = state[keys[i]];
    }
    return out;
}

/**
 * Build a fresh diagnostics object cloned from `prevDiag`, with FRESH
 * arrays for `warnings`, `errors`, and `unresolvedSlots`. This preserves
 * the AC-10.2 invariant (no shared array references) at the diagnostics
 * level and ensures downstream phases can append safely.
 */
function carryForwardDiagnostics(prevDiag) {
    var nextDiag = {};
    if (isPlainObject(prevDiag)) {
        var keys = Object.keys(prevDiag);
        for (var i = 0; i < keys.length; i += 1) {
            nextDiag[keys[i]] = prevDiag[keys[i]];
        }
    }
    nextDiag.warnings = (isPlainObject(prevDiag) && Array.isArray(prevDiag.warnings))
        ? prevDiag.warnings.slice() : [];
    nextDiag.errors = (isPlainObject(prevDiag) && Array.isArray(prevDiag.errors))
        ? prevDiag.errors.slice() : [];
    nextDiag.unresolvedSlots = (isPlainObject(prevDiag) && Array.isArray(prevDiag.unresolvedSlots))
        ? prevDiag.unresolvedSlots.slice() : [];
    return nextDiag;
}

// ---------------------------------------------------------------------------
// Phase 6 entry point
// ---------------------------------------------------------------------------

/**
 * Inspect unresolved slots after Phases 4–5 and decide whether the
 * orchestrator must perform a relaxed-mode pre-check.
 *
 * Decision tree (per AC 4.1, 4.2, 4.2b):
 *   1. If `allowSameDayBothHalfdays === true` → no pre-check (already
 *      relaxed; nothing to compare against).
 *   2. If `unresolvedSlots.length === 0` → no pre-check (full coverage
 *      already achieved).
 *   3. Otherwise → mark `preCheckRequired = true` and record the current
 *      unresolved count in `preCheckUnresolvedCount` so the orchestrator
 *      can include it in the eventual warning payload.
 *
 * @param {Object} state - pipeline state carrying `input` and `diagnostics`.
 * @returns {Object} new state with diagnostics updated.
 */
function detectSameDayInfeasibility(state) {
    if (state === null || state === undefined) {
        throw new TypeError('detectSameDayInfeasibility: state must be an object');
    }
    if (!isPlainObject(state.input)) {
        throw new TypeError('detectSameDayInfeasibility: state.input must be a plain object');
    }

    var nextDiag = carryForwardDiagnostics(state.diagnostics);

    // AC 4.2b — flag already enabled, no pre-check ever needed.
    var rules = state.input.examDistributionRules;
    var allowSameDay = !!(isPlainObject(rules) && rules.allowSameDayBothHalfdays);
    if (allowSameDay) {
        nextDiag.preCheckRequired = false;
        nextDiag.preCheckUnresolvedCount = 0;
        var ns0 = shallowCopyState(state);
        ns0.diagnostics = nextDiag;
        return ns0;
    }

    // AC 4.2 — full coverage achieved, no pre-check needed.
    var unresolvedCount = nextDiag.unresolvedSlots.length;
    if (unresolvedCount === 0) {
        nextDiag.preCheckRequired = false;
        nextDiag.preCheckUnresolvedCount = 0;
        var ns1 = shallowCopyState(state);
        ns1.diagnostics = nextDiag;
        return ns1;
    }

    // Pre-check needed; orchestrator decides whether the time budget
    // allows it.
    nextDiag.preCheckRequired = true;
    nextDiag.preCheckUnresolvedCount = unresolvedCount;

    var ns2 = shallowCopyState(state);
    ns2.diagnostics = nextDiag;
    return ns2;
}

module.exports = {
    detectSameDayInfeasibility: detectSameDayInfeasibility,
    _internals: {
        carryForwardDiagnostics: carryForwardDiagnostics
    }
};
