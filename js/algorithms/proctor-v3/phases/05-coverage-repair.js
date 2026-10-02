// Proctor Distribution V3 — Phase 5: Multi-Step Coverage Repair.
//
// Pure phase. Takes a `state` already populated by Phase 4 (CP solver) and
// attempts to raise every "uncovered" proctor's Primary_Load up to that
// proctor's Class_Lower_Bound by performing swap-repairs against rows
// already filled by Phase 4.
//
// An uncovered proctor is any canonical key whose
//   `Primary_Load = Guard_Count + Duty_Count`
// is strictly less than `bounds.byClass[classId].lower`. Each swap replaces
// some donor canonical key K_d in `row.proctor_keys[slot]` with the
// uncovered key K_u, raising K_u's guardCount by 1 and lowering K_d's by 1.
//
// Acceptance Criteria covered:
//   - 5.10 : best-effort baseline coverage (zeroLoadProctors are recorded
//            here when no swap can lift them above zero)
//   - 5.11 : multi-step (up to `target - currentLoad` swaps per proctor,
//            with a small safety margin)
//   - 5.12 : donor protection — never demote a donor below their class
//            lower bound
//   - 5.13 : record `{ canonicalKey, classLowerBound, initialLoad,
//            finalLoad, attemptedSwaps, reason }` in
//            `diagnostics.coverageWarnings` when a proctor cannot be lifted
//
// What this phase does NOT touch:
//   - reserves (Phase 9 responsibility)
//   - bimodal histogram repair (Phase 7)
//   - AM/PM balance (Phase 8)
//
// Purity contract:
//   - `state.input` is NOT mutated.
//   - `state.rows` is REPLACED with a new array; each row that is touched
//     by a swap gets a NEW shallow-cloned object whose `proctor_keys` is
//     a NEW array. Untouched rows are reused by reference.
//   - `state.loadState` IS mutated in place (matches Phase 4's convention:
//     the load accumulator flows through phases — callers that need
//     rollback must clone first).
//   - `state.diagnostics` is rebuilt as a new object with fresh arrays.
//
// Determinism:
//   - The set of uncovered proctors is sorted by code-point order
//     (locale-independent).
//   - Within a single repair attempt, rows are iterated in their natural
//     index order; slots within a row in slot-index order. The first
//     swap that satisfies `canSwap` wins. This produces byte-identical
//     output for byte-identical input.

'use strict';

var path = require('path');
var _canonicalKeyModule = require(path.join(__dirname, '..', 'canonical-key.js'));
var canonicalProctorKey = _canonicalKeyModule.canonicalProctorKey;


var hardConstraints = require(path.join(__dirname, '..', 'constraints', 'hard-constraints.js'));
var loadStateUtils = require(path.join(__dirname, '..', 'utils', 'load-state.js'));

var isExempt = hardConstraints.isExempt;
var isOnDuty = hardConstraints.isOnDuty;
var isMEBlocked = hardConstraints.isMEBlocked;
var wouldDoubleBookSession = hardConstraints.wouldDoubleBookSession;
var wouldConflictWithExternalResources = hardConstraints.wouldConflictWithExternalResources;
var wouldViolateSameDay = hardConstraints.wouldViolateSameDay;
var recordGuardOccupancy = hardConstraints.recordGuardOccupancy;
var clearGuardOccupancy = hardConstraints.clearGuardOccupancy;

var primaryLoad = loadStateUtils.primaryLoad;
var decrementGuardLoad = loadStateUtils.decrementGuardLoad;
var incrementGuardLoad = loadStateUtils.incrementGuardLoad;

// Default time budget for Phase 5 (per design.md §4 Phase 5 — 5 seconds).
var DEFAULT_TIME_BUDGET_MS = 5000;

// Small additive safety margin on top of (target - currentLoad) when
// computing maxAttempts per proctor. Matches the design pseudocode.
var ATTEMPT_SAFETY_MARGIN = 5;

// AM_PERIODS / PM_PERIODS / increment|decrementGuardLoad from load-state SSOT
// (includes 'زوالا' on PM — repair phases previously omitted it).

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

function shallowCopyRow(row) {
    var out = {};
    var keys = Object.keys(row);
    for (var i = 0; i < keys.length; i += 1) {
        out[keys[i]] = row[keys[i]];
    }
    return out;
}

function periodFromHalfdayKey(halfdayKey) {
    if (typeof halfdayKey !== 'string') return '';
    var idx = halfdayKey.indexOf('|');
    if (idx === -1) return '';
    return halfdayKey.slice(idx + 1);
}

function dayKeyFromHalfdayKey(halfdayKey) {
    if (typeof halfdayKey !== 'string') return '';
    var idx = halfdayKey.indexOf('|');
    if (idx === -1) return halfdayKey;
    return halfdayKey.slice(0, idx);
}

function canonicalKeyOf(proctor, idx) {
    // SSOT: js/algorithms/proctor-v3/canonical-key.js
    return canonicalProctorKey(proctor, idx);
}

/**
 * Build canonical-key → { proctor, idx } index. Mirrors the dedup behavior
 * of Phase 2 (first occurrence wins on duplicate canonical keys).
 */
function buildProctorIndex(proctorsList) {
    var byKey = Object.create(null);
    if (!Array.isArray(proctorsList)) return byKey;
    for (var i = 0; i < proctorsList.length; i += 1) {
        var p = proctorsList[i];
        var k = canonicalKeyOf(p, i);
        if (byKey[k]) continue;
        byKey[k] = { proctor: p, idx: i };
    }
    return byKey;
}

/**
 * Determine whether the donor still occupies any OTHER row of the same
 * session after the given (rowIndex, slotIndex) is vacated. Used to
 * decide whether to clear the donor's `guardSessions` entry for the
 * session.
 */
function donorStillInSession(rows, donorKey, sessionKey, excludeRowIndex, excludeSlotIndex) {
    for (var ri = 0; ri < rows.length; ri += 1) {
        var r = rows[ri];
        if (!r || !Array.isArray(r.proctor_keys)) continue;
        if (r.session_key !== sessionKey) continue;
        for (var si = 0; si < r.proctor_keys.length; si += 1) {
            if (ri === excludeRowIndex && si === excludeSlotIndex) continue;
            if (r.proctor_keys[si] === donorKey) return true;
        }
    }
    return false;
}

/**
 * Determine whether the donor still occupies any OTHER row sharing the
 * same halfday after the given (rowIndex, slotIndex) is vacated. Used to
 * decide whether to clear the donor's `guardHalfdays` entry.
 */
function donorStillInHalfday(rows, donorKey, halfdayKey, excludeRowIndex, excludeSlotIndex) {
    for (var ri = 0; ri < rows.length; ri += 1) {
        var r = rows[ri];
        if (!r || !Array.isArray(r.proctor_keys)) continue;
        if (r.halfday_key !== halfdayKey) continue;
        for (var si = 0; si < r.proctor_keys.length; si += 1) {
            if (ri === excludeRowIndex && si === excludeSlotIndex) continue;
            if (r.proctor_keys[si] === donorKey) return true;
        }
    }
    return false;
}

/**
 * Resolve the lower bound for a canonical key via classByProctorKey →
 * bounds.byClass. Returns 0 when class data or bounds are missing — that
 * defaults to "no lower bound", which is the safe behavior (proctor
 * not considered uncovered, donor not considered protected).
 */
function classLowerFor(key, classByProctorKey, classBoundsByClassId) {
    if (typeof key !== 'string' || key.length === 0) return 0;
    if (!isPlainObject(classByProctorKey)) return 0;
    if (!isPlainObject(classBoundsByClassId)) return 0;
    var classId = classByProctorKey[key];
    if (typeof classId !== 'string' || classId.length === 0) return 0;
    var b = classBoundsByClassId[classId];
    if (!isPlainObject(b)) return 0;
    var lo = b.lower;
    if (typeof lo !== 'number' || !Number.isFinite(lo)) return 0;
    return lo;
}

/**
 * Resolve the upper bound for a canonical key. Returns Infinity when class
 * data or bounds are missing — i.e. "no upper bound", so the recipient is
 * never blocked from receiving the swap.
 */
function classUpperFor(key, classByProctorKey, classBoundsByClassId) {
    if (typeof key !== 'string' || key.length === 0) return Infinity;
    if (!isPlainObject(classByProctorKey)) return Infinity;
    if (!isPlainObject(classBoundsByClassId)) return Infinity;
    var classId = classByProctorKey[key];
    if (typeof classId !== 'string' || classId.length === 0) return Infinity;
    var b = classBoundsByClassId[classId];
    if (!isPlainObject(b)) return Infinity;
    var up = b.upper;
    if (typeof up !== 'number' || !Number.isFinite(up)) return Infinity;
    return up;
}

// ---------------------------------------------------------------------------
// canSwap predicate
// ---------------------------------------------------------------------------

/**
 * Decide whether replacing `donorKey` at (rowIndex, slotIndex) with
 * `recipientKey` is legal. All hard constraints AND donor protection AND
 * recipient upper-bound are enforced.
 *
 * @returns {boolean}
 */
function canSwap(ctx, rowIndex, slotIndex, donorKey, recipientKey) {
    if (donorKey === recipientKey) return false;

    var rows = ctx.rows;
    var row = rows[rowIndex];
    if (!row || !Array.isArray(row.proctor_keys)) return false;

    // Recipient must be a known canonical proctor.
    var recipientMeta = ctx.proctorByKey[recipientKey];
    if (!recipientMeta) return false;

    // Recipient must not already appear in this row.
    for (var si = 0; si < row.proctor_keys.length; si += 1) {
        if (si === slotIndex) continue;
        if (row.proctor_keys[si] === recipientKey) return false;
    }

    // Eligibility predicates against the row's session / halfday.
    if (isExempt(recipientMeta.proctor, recipientMeta.idx, row.session_key, ctx.normalizedExemptions)) return false;
    if (isOnDuty(recipientMeta.proctor, recipientMeta.idx, row.halfday_key, ctx.normalizedDuty)) return false;
    if (isMEBlocked(recipientMeta.proctor, recipientMeta.idx, row.halfday_key, ctx.normalizedME)) return false;

    // Recipient must not double-book the session (across rows).
    if (wouldDoubleBookSession(ctx.loadState, recipientKey, row.session_key)) return false;
    if (wouldConflictWithExternalResources(
        ctx.loadState, recipientKey, row.session_key, row.halfday_key
    )) return false;

    // C-NO-SAME-DAY for recipient (skipped when allowSameDay === true).
    if (wouldViolateSameDay(ctx.loadState, recipientKey, row.halfday_key, ctx.allowSameDay)) return false;

    // Donor protection (AC 5.12): donor's Primary_Load must remain ≥ donor's
    // class lower bound after the swap. Primary_Load = guardCount + dutyCount;
    // we are decrementing guardCount by 1.
    var donorLoad = primaryLoad(ctx.loadState, donorKey);
    var donorLower = classLowerFor(donorKey, ctx.classByProctorKey, ctx.classBoundsByClassId);
    if (donorLoad - 1 < donorLower) return false;

    // Recipient upper-bound check: Primary_Load(recipient) + 1 must not exceed
    // recipient's class upper. (AC 3.10 / 5.6 maintained across the swap.)
    var recipientLoadNext = primaryLoad(ctx.loadState, recipientKey) + 1;
    var recipientUpper = classUpperFor(recipientKey, ctx.classByProctorKey, ctx.classBoundsByClassId);
    if (recipientLoadNext > recipientUpper) return false;

    return true;
}

// ---------------------------------------------------------------------------
// findSwap
// ---------------------------------------------------------------------------

/**
 * Linear scan for the first legal swap that lifts `recipientKey`. Iterates
 * rows in index order, slots in slot-index order. Returns
 * `{ rowIndex, slotIndex, donorKey, recipientKey }` or null.
 */
function findSwap(ctx, recipientKey) {
    var rows = ctx.rows;
    for (var ri = 0; ri < rows.length; ri += 1) {
        var row = rows[ri];
        if (!row || !Array.isArray(row.proctor_keys)) continue;
        for (var si = 0; si < row.proctor_keys.length; si += 1) {
            var donorKey = row.proctor_keys[si];
            if (typeof donorKey !== 'string' || donorKey.length === 0) continue;
            if (canSwap(ctx, ri, si, donorKey, recipientKey)) {
                return {
                    rowIndex: ri,
                    slotIndex: si,
                    donorKey: donorKey,
                    recipientKey: recipientKey
                };
            }
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// applySwap
// ---------------------------------------------------------------------------

/**
 * Apply a swap returned by `findSwap`:
 *   - Replace `ctx.rows[rowIndex]` with a fresh shallow-cloned row whose
 *     `proctor_keys` is a fresh array (preserving AC 10.2 — no shared
 *     array references).
 *   - Update load-state counts (decrement donor, increment recipient,
 *     including AM/PM tally).
 *   - Update occupancy sets (clear donor's session/halfday entries iff
 *     they no longer occupy any other slot of that session/halfday;
 *     record recipient's session/halfday entries unconditionally).
 */
function applySwap(ctx, swap) {
    var rows = ctx.rows;
    var rowIndex = swap.rowIndex;
    var slotIndex = swap.slotIndex;
    var donorKey = swap.donorKey;
    var recipientKey = swap.recipientKey;

    var srcRow = rows[rowIndex];
    var newRow = shallowCopyRow(srcRow);
    var newKeys = srcRow.proctor_keys.slice();
    newKeys[slotIndex] = recipientKey;
    newRow.proctor_keys = newKeys;
    rows[rowIndex] = newRow;

    var period = periodFromHalfdayKey(newRow.halfday_key);

    // Load counts.
    decrementGuardLoad(ctx.loadState, donorKey, period);
    incrementGuardLoad(ctx.loadState, recipientKey, period);

    // Occupancy sets — donor.
    var donorStillSession = donorStillInSession(
        rows, donorKey, newRow.session_key, rowIndex, slotIndex
    );
    var donorStillHalfday = donorStillInHalfday(
        rows, donorKey, newRow.halfday_key, rowIndex, slotIndex
    );
    if (!donorStillSession || !donorStillHalfday) {
        clearGuardOccupancy(
            ctx.loadState,
            donorKey,
            donorStillSession ? '' : newRow.session_key,
            donorStillHalfday ? '' : newRow.halfday_key
        );
    }

    // Occupancy sets — recipient.
    recordGuardOccupancy(
        ctx.loadState,
        recipientKey,
        newRow.session_key,
        newRow.halfday_key
    );
}

// ---------------------------------------------------------------------------
// Phase 5 entry point
// ---------------------------------------------------------------------------

/**
 * Run multi-step coverage repair on the supplied state.
 *
 * @param {Object} state - pipeline state populated through Phase 4
 * @returns {Object} new state with repaired rows / loadState / diagnostics
 */
function multiStepCoverageRepair(state) {
    if (state === null || state === undefined) {
        throw new TypeError('multiStepCoverageRepair: state must be an object');
    }
    var input = state.input;
    if (!isPlainObject(input)) {
        throw new TypeError('multiStepCoverageRepair: state.input must be a plain object');
    }

    // Carry diagnostics forward with FRESH arrays.
    var prevDiag = isPlainObject(state.diagnostics) ? state.diagnostics : null;
    var prevWarnings = prevDiag && Array.isArray(prevDiag.warnings) ? prevDiag.warnings.slice() : [];
    var prevErrors = prevDiag && Array.isArray(prevDiag.errors) ? prevDiag.errors.slice() : [];
    var prevUnresolved = prevDiag && Array.isArray(prevDiag.unresolvedSlots)
        ? prevDiag.unresolvedSlots.slice() : [];
    var prevCoverageWarnings = prevDiag && Array.isArray(prevDiag.coverageWarnings)
        ? prevDiag.coverageWarnings.slice() : [];

    var nextDiag = {};
    if (prevDiag) {
        var dkeys = Object.keys(prevDiag);
        for (var dk = 0; dk < dkeys.length; dk += 1) {
            nextDiag[dkeys[dk]] = prevDiag[dkeys[dk]];
        }
    }
    nextDiag.warnings = prevWarnings;
    nextDiag.errors = prevErrors;
    nextDiag.unresolvedSlots = prevUnresolved;
    nextDiag.coverageWarnings = prevCoverageWarnings;

    var inRows = Array.isArray(state.rows) ? state.rows : null;
    if (inRows === null || inRows.length === 0) {
        nextDiag.coverageRepairSwaps = 0;
        nextDiag.coverageRepairUnresolved = 0;
        var ns0 = shallowCopyState(state);
        ns0.diagnostics = nextDiag;
        return ns0;
    }

    if (!isPlainObject(state.bounds) || !isPlainObject(state.bounds.byClass)) {
        throw new TypeError('multiStepCoverageRepair: state.bounds.byClass missing — Phase 3 must run before Phase 5');
    }
    var classBoundsByClassId = state.bounds.byClass;

    var classByProctorKey = (
        state.classByProctorKey !== null
        && typeof state.classByProctorKey === 'object'
        && !Array.isArray(state.classByProctorKey)
    ) ? state.classByProctorKey : {};

    var loadState = state.loadState;
    if (!isPlainObject(loadState) || !isPlainObject(loadState.proctors)) {
        throw new TypeError('multiStepCoverageRepair: state.loadState missing or malformed — initialize via createLoadState');
    }

    var proctorByKey = buildProctorIndex(input.proctorsList);
    var normalizedExemptions = isPlainObject(state.normalizedExemptionsData)
        ? state.normalizedExemptionsData : {};
    var normalizedDuty = isPlainObject(state.normalizedDutyData)
        ? state.normalizedDutyData : {};
    var normalizedME = isPlainObject(state.normalizedMEAssignments)
        ? state.normalizedMEAssignments : {};
    var allowSameDay = !!(input.examDistributionRules
        && input.examDistributionRules.allowSameDayBothHalfdays);

    // Rows: clone the array so we can swap in fresh row references without
    // mutating the array reference held by the caller. Individual row objects
    // remain shared until they are touched by a swap (then shallow-copied).
    var rows = inRows.slice();

    // Time budget.
    var timeBudgetMs = (state.options && typeof state.options.phase5TimeBudgetMs === 'number')
        ? state.options.phase5TimeBudgetMs
        : DEFAULT_TIME_BUDGET_MS;
    var startedAt = Date.now();
    function timeRemaining() {
        return Date.now() - startedAt < timeBudgetMs;
    }

    var ctx = {
        rows: rows,
        loadState: loadState,
        proctorByKey: proctorByKey,
        normalizedExemptions: normalizedExemptions,
        normalizedDuty: normalizedDuty,
        normalizedME: normalizedME,
        classByProctorKey: classByProctorKey,
        classBoundsByClassId: classBoundsByClassId,
        allowSameDay: allowSameDay
    };

    // Identify uncovered proctors. Sort by canonical-key code-point order.
    var procKeys = Object.keys(loadState.proctors);
    procKeys.sort();
    var uncovered = [];
    for (var pi = 0; pi < procKeys.length; pi += 1) {
        var k = procKeys[pi];
        var lower = classLowerFor(k, classByProctorKey, classBoundsByClassId);
        if (lower <= 0) continue;
        var pl = primaryLoad(loadState, k);
        if (pl < lower) {
            uncovered.push({ key: k, lower: lower, initialLoad: pl });
        }
    }

    var totalSwaps = 0;
    var coverageWarnings = nextDiag.coverageWarnings;

    for (var u = 0; u < uncovered.length; u += 1) {
        var entry = uncovered[u];
        var uKey = entry.key;
        var targetLoad = entry.lower;
        var initialLoad = entry.initialLoad;
        var attempts = 0;
        var attemptedSwaps = 0;
        var maxAttempts = (targetLoad - initialLoad) + ATTEMPT_SAFETY_MARGIN;
        if (maxAttempts < 1) maxAttempts = 1;

        var hitTimeBudget = false;

        while (primaryLoad(loadState, uKey) < targetLoad && attempts < maxAttempts) {
            attempts += 1;
            if (!timeRemaining()) {
                hitTimeBudget = true;
                break;
            }
            var swap = findSwap(ctx, uKey);
            if (!swap) break;
            applySwap(ctx, swap);
            totalSwaps += 1;
            attemptedSwaps += 1;
        }

        var finalLoad = primaryLoad(loadState, uKey);
        if (finalLoad < targetLoad) {
            var reason;
            if (hitTimeBudget) {
                reason = 'time_budget';
            } else {
                reason = 'no_eligible_donor';
            }
            coverageWarnings.push({
                canonicalKey: uKey,
                classLowerBound: targetLoad,
                initialLoad: initialLoad,
                finalLoad: finalLoad,
                attemptedSwaps: attemptedSwaps,
                reason: reason
            });
        }
    }

    nextDiag.coverageRepairSwaps = totalSwaps;
    nextDiag.coverageRepairUnresolved = coverageWarnings.length;

    var ns = shallowCopyState(state);
    ns.rows = rows;
    ns.loadState = loadState;
    ns.diagnostics = nextDiag;
    return ns;
}

module.exports = {
    multiStepCoverageRepair: multiStepCoverageRepair,
    _internals: {
        canSwap: canSwap,
        findSwap: findSwap,
        applySwap: applySwap,
        decrementGuardLoad: decrementGuardLoad,
        incrementGuardLoad: incrementGuardLoad,
        donorStillInSession: donorStillInSession,
        donorStillInHalfday: donorStillInHalfday,
        classLowerFor: classLowerFor,
        classUpperFor: classUpperFor,
        periodFromHalfdayKey: periodFromHalfdayKey,
        dayKeyFromHalfdayKey: dayKeyFromHalfdayKey,
        DEFAULT_TIME_BUDGET_MS: DEFAULT_TIME_BUDGET_MS,
        ATTEMPT_SAFETY_MARGIN: ATTEMPT_SAFETY_MARGIN
    }
};
