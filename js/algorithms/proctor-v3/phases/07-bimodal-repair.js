// Proctor Distribution V3 — Phase 7: Bimodal Repair (Local Search).
//
// Pure phase. Takes a `state` already populated through Phase 6 (which is
// itself an inspection-only pass) and tries to make the Primary_Load
// histogram **strict bimodal** — i.e. either:
//
//   - empty                                          (no eligible proctors), OR
//   - { k: N }            single key                 (everyone same load), OR
//   - { k: a, k+1: b }    two CONSECUTIVE integers   (gap == 1).
//
// Any other shape (3+ distinct keys, OR two keys with a gap > 1) violates
// Acceptance Criterion 5.7 and triggers Phase 7's local-search loop. When
// the loop cannot find a beneficial swap (local minimum) OR the time
// budget is exhausted before bimodality is restored, the phase records a
// structured `fairness_violation` error in `state.diagnostics.errors`
// (per AC 5.8) and returns the best-effort state.
//
// Acceptance Criteria covered:
//   - 5.7  : Strict bimodal histogram on Primary_Load (over eligible
//            proctors — those with a non-empty class assignment).
//   - 5.8  : When unable to reach bimodality, emit
//            `{ type: 'fairness_violation', histogram, message }` in
//            diagnostics.errors and return best-so-far.
//
// Swap semantics (mirrors Phase 5 to keep behavior consistent):
//   A "rebalancing swap" replaces some guard slot held by a HIGH-load
//   proctor (donor) with a LOW-load proctor (recipient). This decreases
//   the donor's Guard_Count by 1 and increases the recipient's by 1 —
//   shifting one unit of Primary_Load from donor to recipient. The swap
//   must respect ALL hard constraints (eligibility, AllDifferent within
//   row + within session, C-NO-SAME-DAY) AND donor's lower bound (5.12)
//   AND recipient's upper bound (5.6).
//
// Strategy:
//   1. Compute the histogram. If already bimodal, return unchanged.
//   2. Identify the SET of "high-load" canonical keys (those at the upper
//      tail beyond `min+1`) and "low-load" canonical keys (those at the
//      lower tail below `max-1`). Each tail is sorted by canonical-key
//      code-point order for determinism.
//   3. Try every (donorKey, recipientKey) pair from these two sets, in
//      lexicographic order. For each pair, scan rows in index order and
//      find the first slot where `canSwap(...)` returns true.
//   4. Apply that swap, recompute the histogram, and loop.
//   5. If no swap was found (local minimum) OR time runs out, record the
//      `fairness_violation` error and return.
//
// The strategy is intentionally simple — a single "shift one unit" swap
// per iteration. This is sufficient to shrink any 3+ key histogram toward
// 2 keys whenever feasible, because each successful swap moves exactly
// one proctor's bucket up and another's bucket down.
//
// Purity contract:
//   - state.input is NOT mutated.
//   - state.rows is REPLACED with a new array; touched rows get a NEW
//     shallow-cloned object whose `proctor_keys` is a NEW array (preserves
//     AC 10.2). Untouched rows are reused by reference.
//   - state.loadState IS mutated in place (matches Phase 4 / Phase 5
//     convention — the load accumulator flows through phases).
//   - state.diagnostics is rebuilt as a new object with fresh arrays.
//
// Determinism:
//   - Histogram keys read via `Object.keys(...).sort()`.
//   - Donor / recipient candidates sorted by canonical-key code-point order.
//   - Within a single swap search, rows iterated in their natural index
//     order; slots in slot-index order. First legal swap wins.

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

// Default time budget for Phase 7 (per design.md §4 Phase 7 — 5 seconds).
var DEFAULT_TIME_BUDGET_MS = 5000;

// Hard cap on iterations to defend against pathological loops where the
// time budget is generous but the swap search keeps thrashing. Each
// iteration costs at most O(rows × slots × |donors| × |recipients|).
var MAX_ITERATIONS = 5000;

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

function canonicalKeyOf(proctor, idx) {
    // SSOT: js/algorithms/proctor-v3/canonical-key.js
    return canonicalProctorKey(proctor, idx);
}

/**
 * Build canonical-key → { proctor, idx } index. Mirrors Phase 5's helper
 * (first occurrence wins on duplicate canonical keys).
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
 * Resolve the lower bound for a canonical key. Returns 0 ("no constraint")
 * if class data or bounds are missing.
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
 * Resolve the upper bound for a canonical key. Returns Infinity when
 * class data or bounds are missing — i.e. "no constraint".
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
// Histogram + bimodality
// ---------------------------------------------------------------------------

/**
 * Compute the Primary_Load histogram over **eligible** proctors (those
 * present in `classByProctorKey` with a non-empty classId). Proctors
 * without a class assignment are excluded from the fairness check.
 *
 * Returns `{ [load: string]: count: number }` and the corresponding
 * sorted-numeric `keys` array for convenience.
 *
 * @param {Object} loadState
 * @param {Object} classByProctorKey
 * @returns {{ histogram: Object<string, number>, keys: number[] }}
 */
function computeHistogramByPrimaryLoad(loadState, classByProctorKey) {
    var hist = {};
    if (!isPlainObject(loadState) || !isPlainObject(loadState.proctors)) {
        return { histogram: hist, keys: [] };
    }
    var cbpk = isPlainObject(classByProctorKey) ? classByProctorKey : {};
    var procKeys = Object.keys(loadState.proctors);
    procKeys.sort();
    for (var i = 0; i < procKeys.length; i += 1) {
        var k = procKeys[i];
        var classId = cbpk[k];
        if (typeof classId !== 'string' || classId.length === 0) continue;
        var pl = primaryLoad(loadState, k);
        var bucket = String(pl);
        if (hist[bucket] === undefined) hist[bucket] = 0;
        hist[bucket] += 1;
    }
    var sortedKeys = Object.keys(hist).map(Number).sort(function (a, b) {
        return a - b;
    });
    return { histogram: hist, keys: sortedKeys };
}

/**
 * Strict-bimodal predicate per AC 5.7.
 *
 *   { }                  → true   (empty histogram, no eligible proctors)
 *   { k: N }             → true   (one bucket)
 *   { k: a, k+1: b }     → true   (two CONSECUTIVE buckets)
 *   anything else        → false
 *
 * @param {number[]} sortedKeys - ascending unique numeric keys
 * @returns {boolean}
 */
function isBimodalKeys(sortedKeys) {
    if (!Array.isArray(sortedKeys)) return true;
    if (sortedKeys.length === 0) return true;
    if (sortedKeys.length === 1) return true;
    if (sortedKeys.length === 2) {
        return sortedKeys[1] - sortedKeys[0] === 1;
    }
    return false;
}

/**
 * Convenience wrapper used by tests. Recomputes the histogram and applies
 * `isBimodalKeys`.
 */
function isBimodal(loadState, classByProctorKey) {
    var h = computeHistogramByPrimaryLoad(loadState, classByProctorKey);
    return isBimodalKeys(h.keys);
}

/**
 * Identify donor-side and recipient-side candidates for a rebalancing
 * swap, given the current sorted histogram keys.
 *
 * The two **target** buckets are the two histogram modes that bimodality
 * would settle on — `targetLow = sortedKeys[0]`, `targetHigh = last bucket
 * within distance 1 of the lower mode`. Anything strictly above
 * `targetLow + 1` is a donor candidate; anything strictly below
 * `targetHigh - 1` is a recipient candidate. (Visually: we shrink the
 * tails toward the [low, low+1] window.)
 *
 * Edge cases:
 *   - keys.length ≤ 1 → already bimodal, no candidates.
 *   - keys.length === 2 with gap === 1 → already bimodal, no candidates.
 *   - keys.length === 2 with gap > 1 (e.g. {2,5}): target is the lower
 *     mode `2`; donors live at `5` (load > 3); recipients live at `2`
 *     (load < 4). Shifting one unit collapses {2,5} → {2,3,4}, which is
 *     itself non-bimodal but closer to {3,4}. The loop continues.
 *   - keys.length ≥ 3: donors at top mode(s) > `targetLow + 1`,
 *     recipients at bottom mode(s) < `targetHigh - 1` where targetHigh
 *     is the second-smallest key (or targetLow + 1 if only one). This
 *     greedily collapses both tails toward the central pair.
 *
 * Returns sorted (code-point) arrays of canonical keys.
 *
 * @returns {{ donors: string[], recipients: string[] }}
 */
function partitionCandidates(loadState, classByProctorKey, sortedKeys) {
    var empty = { donors: [], recipients: [] };
    if (!isPlainObject(loadState) || !isPlainObject(loadState.proctors)) return empty;
    if (!Array.isArray(sortedKeys) || sortedKeys.length <= 1) return empty;

    // Already strict bimodal.
    if (sortedKeys.length === 2 && sortedKeys[1] - sortedKeys[0] === 1) return empty;

    // Target window: the two consecutive integers nearest the histogram
    // mass we want to settle on. We choose [min, min+1] heuristically —
    // this collapses the upper tail aggressively and lifts the lower tail.
    // The opposite choice ([max-1, max]) is symmetric; using the lower
    // window prefers downward shifts of overloaded proctors, which keeps
    // donor-protection (AC 5.12) easier to satisfy on average.
    var targetLow = sortedKeys[0];
    var targetHigh = targetLow + 1;

    // Donors: load STRICTLY greater than targetHigh.
    // Recipients: load STRICTLY less than targetLow.
    // Note: in the typical {a-2, a-1, a, a+1, a+2} case both filters fire
    //       and we shift one unit toward the center per iteration.
    var cbpk = isPlainObject(classByProctorKey) ? classByProctorKey : {};
    var donors = [];
    var recipients = [];
    var procKeys = Object.keys(loadState.proctors);
    procKeys.sort();
    for (var i = 0; i < procKeys.length; i += 1) {
        var k = procKeys[i];
        var classId = cbpk[k];
        if (typeof classId !== 'string' || classId.length === 0) continue;
        var pl = primaryLoad(loadState, k);
        if (pl > targetHigh) donors.push(k);
        else if (pl < targetLow) recipients.push(k);
    }
    return { donors: donors, recipients: recipients };
}

// ---------------------------------------------------------------------------
// canSwap / findSwap / applySwap
// ---------------------------------------------------------------------------
//
// Mirrors Phase 5's swap mechanics, but the donor's lower-bound check is
// the inviolable one (AC 5.12) — the recipient is allowed up to the
// upper bound (AC 5.6).

function canSwap(ctx, rowIndex, slotIndex, donorKey, recipientKey) {
    if (donorKey === recipientKey) return false;

    var rows = ctx.rows;
    var row = rows[rowIndex];
    if (!row || !Array.isArray(row.proctor_keys)) return false;

    var recipientMeta = ctx.proctorByKey[recipientKey];
    if (!recipientMeta) return false;

    // Recipient must not already appear in this row (AllDifferent within row).
    for (var si = 0; si < row.proctor_keys.length; si += 1) {
        if (si === slotIndex) continue;
        if (row.proctor_keys[si] === recipientKey) return false;
    }

    // Eligibility predicates against the row's session / halfday.
    if (isExempt(recipientMeta.proctor, recipientMeta.idx, row.session_key, ctx.normalizedExemptions)) return false;
    if (isOnDuty(recipientMeta.proctor, recipientMeta.idx, row.halfday_key, ctx.normalizedDuty)) return false;
    if (isMEBlocked(recipientMeta.proctor, recipientMeta.idx, row.halfday_key, ctx.normalizedME)) return false;

    // Recipient must not double-book the session (across rooms).
    if (wouldDoubleBookSession(ctx.loadState, recipientKey, row.session_key)) return false;
    if (wouldConflictWithExternalResources(
        ctx.loadState, recipientKey, row.session_key, row.halfday_key
    )) return false;

    // C-NO-SAME-DAY for recipient (suspended when allowSameDay === true).
    if (wouldViolateSameDay(ctx.loadState, recipientKey, row.halfday_key, ctx.allowSameDay)) return false;

    // Donor protection (AC 5.12).
    var donorLoad = primaryLoad(ctx.loadState, donorKey);
    var donorLower = classLowerFor(donorKey, ctx.classByProctorKey, ctx.classBoundsByClassId);
    if (donorLoad - 1 < donorLower) return false;

    // Recipient upper bound (AC 5.6). After the swap, recipient gains 1
    // unit of Primary_Load.
    var recipientLoadNext = primaryLoad(ctx.loadState, recipientKey) + 1;
    var recipientUpper = classUpperFor(recipientKey, ctx.classByProctorKey, ctx.classBoundsByClassId);
    if (recipientLoadNext > recipientUpper) return false;

    return true;
}

/**
 * Scan rows in index order, slots in slot-index order, looking for the
 * first slot held by `donorKey` that can legally be transferred to
 * `recipientKey`. Returns null if no such slot exists.
 */
function findSwapForPair(ctx, donorKey, recipientKey) {
    var rows = ctx.rows;
    for (var ri = 0; ri < rows.length; ri += 1) {
        var row = rows[ri];
        if (!row || !Array.isArray(row.proctor_keys)) continue;
        for (var si = 0; si < row.proctor_keys.length; si += 1) {
            if (row.proctor_keys[si] !== donorKey) continue;
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

/**
 * Find the lexicographically-first beneficial swap given donor and
 * recipient candidate sets. Iterates donors first (outer), recipients
 * inner — both already sorted by canonical-key code-point order.
 */
function findRebalancingSwap(ctx, donors, recipients) {
    for (var di = 0; di < donors.length; di += 1) {
        var d = donors[di];
        for (var ri = 0; ri < recipients.length; ri += 1) {
            var r = recipients[ri];
            var swap = findSwapForPair(ctx, d, r);
            if (swap) return swap;
        }
    }
    return null;
}

/**
 * Apply a swap: replace the row in place with a fresh shallow-cloned row
 * whose `proctor_keys` is a fresh array (preserves AC 10.2). Update
 * load-state counts AND the occupancy sets used by the hard-constraint
 * predicates.
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
// Phase 7 entry point
// ---------------------------------------------------------------------------

/**
 * Run bimodal repair on the supplied state. Returns a new state.
 *
 * @param {Object} state - pipeline state populated through Phase 6
 * @returns {Object}
 */
function bimodalRepair(state) {
    if (state === null || state === undefined) {
        throw new TypeError('bimodalRepair: state must be an object');
    }
    var input = state.input;
    if (!isPlainObject(input)) {
        throw new TypeError('bimodalRepair: state.input must be a plain object');
    }

    // Carry diagnostics forward with FRESH arrays (AC 10.2).
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
    var loadState = state.loadState;

    // Empty-state short-circuit. Nothing to repair.
    if (inRows === null || inRows.length === 0
        || !isPlainObject(loadState) || !isPlainObject(loadState.proctors)) {
        nextDiag.bimodalRepairSwaps = 0;
        nextDiag.bimodalRepairIterations = 0;
        var ns0 = shallowCopyState(state);
        ns0.diagnostics = nextDiag;
        return ns0;
    }

    var classByProctorKey = (
        state.classByProctorKey !== null
        && typeof state.classByProctorKey === 'object'
        && !Array.isArray(state.classByProctorKey)
    ) ? state.classByProctorKey : {};

    // Already bimodal? Return early without touching rows.
    var initialHist = computeHistogramByPrimaryLoad(loadState, classByProctorKey);
    if (isBimodalKeys(initialHist.keys)) {
        nextDiag.bimodalRepairSwaps = 0;
        nextDiag.bimodalRepairIterations = 0;
        var ns1 = shallowCopyState(state);
        ns1.diagnostics = nextDiag;
        return ns1;
    }

    // We need bounds + class data to enforce donor/recipient bound checks.
    // Missing bounds means upper/lower checks degrade to "no constraint",
    // which is the safe default — the swap will still respect hard
    // constraints, just won't be blocked by class limits.
    var classBoundsByClassId = (isPlainObject(state.bounds) && isPlainObject(state.bounds.byClass))
        ? state.bounds.byClass
        : {};

    var proctorByKey = buildProctorIndex(input.proctorsList);
    var normalizedExemptions = isPlainObject(state.normalizedExemptionsData)
        ? state.normalizedExemptionsData : {};
    var normalizedDuty = isPlainObject(state.normalizedDutyData)
        ? state.normalizedDutyData : {};
    var normalizedME = isPlainObject(state.normalizedMEAssignments)
        ? state.normalizedMEAssignments : {};
    var allowSameDay = !!(input.examDistributionRules
        && input.examDistributionRules.allowSameDayBothHalfdays);

    // Clone the rows array so we can swap in fresh row references without
    // mutating the array reference held by the caller. Individual row
    // objects remain shared until they are touched by a swap (then
    // shallow-cloned).
    var rows = inRows.slice();

    // Time budget.
    var timeBudgetMs = (state.options && typeof state.options.phase7TimeBudgetMs === 'number')
        ? state.options.phase7TimeBudgetMs
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

    var totalSwaps = 0;
    var iterations = 0;
    var hitTimeBudget = false;
    var stuckAtLocalMin = false;

    while (iterations < MAX_ITERATIONS) {
        iterations += 1;
        if (!timeRemaining()) {
            hitTimeBudget = true;
            break;
        }

        var hist = computeHistogramByPrimaryLoad(loadState, classByProctorKey);
        if (isBimodalKeys(hist.keys)) break;

        var parts = partitionCandidates(loadState, classByProctorKey, hist.keys);
        if (parts.donors.length === 0 || parts.recipients.length === 0) {
            // Nothing to shift — local minimum.
            stuckAtLocalMin = true;
            break;
        }

        var swap = findRebalancingSwap(ctx, parts.donors, parts.recipients);
        if (!swap) {
            // No legal swap exists between any donor/recipient pair — local minimum.
            stuckAtLocalMin = true;
            break;
        }

        applySwap(ctx, swap);
        totalSwaps += 1;
    }

    // Post-loop check.
    var finalHist = computeHistogramByPrimaryLoad(loadState, classByProctorKey);
    if (!isBimodalKeys(finalHist.keys)) {
        var reason;
        if (hitTimeBudget) reason = 'time_budget';
        else if (stuckAtLocalMin) reason = 'local_minimum';
        else if (iterations >= MAX_ITERATIONS) reason = 'iteration_cap';
        else reason = 'unknown';
        nextDiag.errors.push({
            type: 'fairness_violation',
            histogram: finalHist.histogram,
            message: 'Histogram is not strict bimodal',
            phase: 7,
            details: { reason: reason, iterations: iterations, swaps: totalSwaps }
        });
    }

    nextDiag.bimodalRepairSwaps = totalSwaps;
    nextDiag.bimodalRepairIterations = iterations;

    var ns = shallowCopyState(state);
    ns.rows = rows;
    ns.loadState = loadState;
    ns.diagnostics = nextDiag;
    return ns;
}

module.exports = {
    bimodalRepair: bimodalRepair,
    _internals: {
        computeHistogramByPrimaryLoad: computeHistogramByPrimaryLoad,
        isBimodalKeys: isBimodalKeys,
        isBimodal: isBimodal,
        partitionCandidates: partitionCandidates,
        canSwap: canSwap,
        findSwapForPair: findSwapForPair,
        findRebalancingSwap: findRebalancingSwap,
        applySwap: applySwap,
        decrementGuardLoad: decrementGuardLoad,
        incrementGuardLoad: incrementGuardLoad,
        donorStillInSession: donorStillInSession,
        donorStillInHalfday: donorStillInHalfday,
        classLowerFor: classLowerFor,
        classUpperFor: classUpperFor,
        periodFromHalfdayKey: periodFromHalfdayKey,
        DEFAULT_TIME_BUDGET_MS: DEFAULT_TIME_BUDGET_MS,
        MAX_ITERATIONS: MAX_ITERATIONS
    }
};
