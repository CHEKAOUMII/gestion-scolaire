// Proctor Distribution V3 — Phase 8: AM/PM Balance (Local Search).
//
// Pure phase. Takes a `state` already populated through Phase 7 (strict
// bimodal Primary_Load histogram established) and tries to reduce the
// per-proctor AM/PM imbalance — the spread between morning (صباحا) and
// afternoon (مساء) guard slots. The target (per AC 6.5) is
// `AM_PM_Imbalance(T) ≤ 1` for every eligible proctor, but this is a SOFT
// constraint: the phase is best-effort and never violates a hard
// constraint or the Phase 7 invariant to chase a balance improvement.
//
// Acceptance Criteria covered:
//   - 6.4  : penalty proportional to AM_PM_Imbalance applied during
//            assignment cost (the penalty itself is applied at Phase 4 /
//            Phase 7 cost functions; Phase 8 performs post-hoc swap
//            repair, which is the explicit local-search counterpart).
//   - 6.5  : aim for AM_PM_Imbalance(T) ≤ 1 for every eligible proctor.
//   - 6.6  : `diagnostics.amPmImbalanceByProctorKey` is populated by this
//            phase with the FINAL imbalance for every eligible proctor.
//
// Swap semantics — Primary_Load preservation
// -------------------------------------------
//
// Phase 7's swaps SHIFT one unit of Guard_Count between two proctors,
// changing Primary_Load. Phase 8's swaps must NOT change Primary_Load —
// otherwise the strict bimodal invariant established by Phase 7 collapses.
//
// The only Primary_Load-preserving swap available is a MUTUAL EXCHANGE
// between two proctors X and Y in TWO different rows of complementary
// periods:
//
//   row R1 (period AM): ..., X, ...     ┐
//   row R2 (period PM): ..., Y, ...     │ → exchange X with Y across the rows
//                                       │
//   row R1 (period AM): ..., Y, ...     │
//   row R2 (period PM): ..., X, ...     ┘
//
// Each proctor's guardCount is unchanged (1 slot lost in one row, 1 slot
// gained in the other). X's AM count drops by 1 and PM grows by 1; Y's
// AM grows by 1 and PM drops by 1. The exchange improves X's balance iff
// X is AM-heavy (amCount > pmCount) AND PM-heavy iff Y is PM-heavy
// (pmCount > amCount); for both to improve simultaneously they must be
// imbalanced in OPPOSITE directions.
//
// If X is AM-heavy and Y is also AM-heavy, exchanging an AM slot of X for
// a PM slot of Y improves X (AM→PM) but worsens Y (PM→AM). Phase 8 will
// only perform an exchange when BOTH proctors strictly benefit (or one
// strictly benefits and the other is already balanced). The "strictly
// benefits" check uses the imbalance metric `|am - pm|`: a swap improves
// proctor T iff the post-swap `|am' - pm'| < |am - pm|`.
//
// Hard-constraint checks
// ----------------------
//
//   - Eligibility: each proctor must satisfy isExempt / isOnDuty /
//     isMEBlocked AGAINST THE TARGET ROW (the row they're moving INTO).
//   - AllDifferent within row: X must not already appear in R2; Y must
//     not already appear in R1.
//   - C-NO-DOUBLE within session: X must not already be in any row of
//     R2.session_key beyond R1 (note: R1 != R2 by construction; the swap
//     does not change X's set of guarded sessions if R1 and R2 share the
//     same session, but R1 and R2 must differ in PERIOD, so they share
//     a session only when sessions span both halfdays — which the schema
//     does not allow). The check uses `wouldDoubleBookSession` against
//     R2.session_key with X temporarily removed from R1.
//   - C-NO-SAME-DAY: not strictly relevant since R1 and R2 differ in
//     PERIOD; if their `day_key` matches AND `allowSameDayBothHalfdays`
//     is false, the proctor was ALREADY guarding both halfdays of the
//     same day before the swap (otherwise neither would hold a slot in
//     both rows). The swap doesn't introduce a new same-day occupancy:
//     each proctor moves its existing same-day occupancy from one slot
//     to another within the same halfdays. This is a NO-OP for the
//     same-day check, so we skip it.
//
// Class-bound checks
// ------------------
//
// Both proctors keep the same Guard_Count → same Primary_Load → no class
// bound check needed.
//
// Strategy
// --------
//
// 1. Compute the imbalance vector. Bail out if every proctor has
//    `|am - pm| <= 1` (already at target).
// 2. Sort imbalanced proctors by canonical-key code-point order. Iterate
//    them as the FIRST proctor in the candidate exchange.
// 3. For each AM-heavy proctor X, find a PM-heavy proctor Y and a pair
//    (R1, R2) where R1 is an AM row holding X and R2 is a PM row holding
//    Y, such that the exchange is legal AND strictly reduces the sum of
//    imbalances. Apply the first such exchange in lexicographic order.
// 4. Repeat until no beneficial exchange exists OR time budget exhausts.
//
// The "first beneficial in lexicographic order" rule preserves
// determinism (AC 8.4).

'use strict';

var path = require('path');

var hardConstraints = require(path.join(__dirname, '..', 'constraints', 'hard-constraints.js'));
var loadStateUtils = require(path.join(__dirname, '..', 'utils', 'load-state.js'));

var isExempt = hardConstraints.isExempt;
var isOnDuty = hardConstraints.isOnDuty;
var isMEBlocked = hardConstraints.isMEBlocked;
var recordGuardOccupancy = hardConstraints.recordGuardOccupancy;
var clearGuardOccupancy = hardConstraints.clearGuardOccupancy;

var amCount = loadStateUtils.amCount;
var pmCount = loadStateUtils.pmCount;

// Default time budget for Phase 8 (per design.md §4 Phase 8 — 3 seconds).
var DEFAULT_TIME_BUDGET_MS = 3000;

// Hard cap on iterations to defend against pathological loops where every
// candidate exchange is barely-improving and the budget is generous.
var MAX_ITERATIONS = 5000;

// AM/PM period tokens — kept in sync with utils/load-state.js. Duplicated
// here so this module remains self-contained. 'زوالا' (noon/PM) is one of
// the two period strings used by the production fixture (45454.json).
var AM_PERIODS = ['صباحا', 'AM', 'morning'];
var PM_PERIODS = ['مساء', 'زوالا', 'PM', 'afternoon'];

// Threshold above which a proctor is considered "imbalanced" (AC 6.5).
// AC 6.5 says aim for imbalance ≤ 1; we treat ≥ 2 as needing repair.
var IMBALANCE_REPAIR_THRESHOLD = 2;

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

function isAmPeriod(period) {
    return typeof period === 'string' && AM_PERIODS.indexOf(period) !== -1;
}

function isPmPeriod(period) {
    return typeof period === 'string' && PM_PERIODS.indexOf(period) !== -1;
}

function canonicalKeyOf(proctor, idx) {
    var cin = proctor && proctor.cin != null ? String(proctor.cin).trim() : '';
    if (cin) return cin;
    return '__idx_' + idx;
}

/**
 * Build a canonical-key → { proctor, idx } index. Mirrors Phase 7's helper
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

// ---------------------------------------------------------------------------
// Imbalance computation
// ---------------------------------------------------------------------------

/**
 * `AM_PM_Imbalance(T) = |AM_Load(T) - PM_Load(T)|`. Returns 0 if the entry
 * is missing or both counts are zero.
 *
 * @param {Object} loadState
 * @param {string} key
 * @returns {number}
 */
function imbalanceOf(loadState, key) {
    var am = amCount(loadState, key);
    var pm = pmCount(loadState, key);
    return Math.abs(am - pm);
}

/**
 * Sign of (amCount - pmCount). +1 → AM-heavy, -1 → PM-heavy, 0 → balanced.
 *
 * @param {Object} loadState
 * @param {string} key
 * @returns {number} -1, 0, or 1
 */
function imbalanceSignOf(loadState, key) {
    var am = amCount(loadState, key);
    var pm = pmCount(loadState, key);
    if (am > pm) return 1;
    if (am < pm) return -1;
    return 0;
}

/**
 * Compute `amPmImbalanceByProctorKey` (AC 6.6) — a plain object mapping
 * each canonical key in the load-state to its current imbalance value.
 * Includes ALL keys present in `loadState.proctors`, including those
 * without a class assignment (the diagnostics consumer can filter).
 *
 * @param {Object} loadState
 * @returns {Object<string, number>}
 */
function computeAmPmImbalanceMap(loadState) {
    var out = {};
    if (!isPlainObject(loadState) || !isPlainObject(loadState.proctors)) return out;
    var keys = Object.keys(loadState.proctors);
    keys.sort();
    for (var i = 0; i < keys.length; i += 1) {
        var k = keys[i];
        out[k] = imbalanceOf(loadState, k);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Exchange feasibility & application
// ---------------------------------------------------------------------------

/**
 * Determine whether moving X out of (R1, slot1) and into (R2, slot2)
 * (replacing Y) AND moving Y out of (R2, slot2) and into (R1, slot1)
 * (replacing X) is legal under the hard constraints.
 *
 * Pre-condition: the caller has already verified
 *   - rows[r1Idx].proctor_keys[slot1] === xKey
 *   - rows[r2Idx].proctor_keys[slot2] === yKey
 *   - r1Idx !== r2Idx (different rows)
 *
 * @returns {boolean}
 */
function canExchange(ctx, r1Idx, slot1, xKey, r2Idx, slot2, yKey) {
    if (xKey === yKey) return false;
    if (r1Idx === r2Idx) return false;

    var rows = ctx.rows;
    var r1 = rows[r1Idx];
    var r2 = rows[r2Idx];
    if (!r1 || !r2) return false;
    if (!Array.isArray(r1.proctor_keys) || !Array.isArray(r2.proctor_keys)) return false;

    var xMeta = ctx.proctorByKey[xKey];
    var yMeta = ctx.proctorByKey[yKey];
    if (!xMeta || !yMeta) return false;

    // AllDifferent within row — Y must not already appear in R1 elsewhere,
    // X must not already appear in R2 elsewhere.
    for (var si = 0; si < r1.proctor_keys.length; si += 1) {
        if (si === slot1) continue;
        if (r1.proctor_keys[si] === yKey) return false;
    }
    for (var sj = 0; sj < r2.proctor_keys.length; sj += 1) {
        if (sj === slot2) continue;
        if (r2.proctor_keys[sj] === xKey) return false;
    }

    // Eligibility — each proctor must be allowed in the target row.
    if (isExempt(yMeta.proctor, yMeta.idx, r1.session_key, ctx.normalizedExemptions)) return false;
    if (isOnDuty(yMeta.proctor, yMeta.idx, r1.halfday_key, ctx.normalizedDuty)) return false;
    if (isMEBlocked(yMeta.proctor, yMeta.idx, r1.halfday_key, ctx.normalizedME)) return false;

    if (isExempt(xMeta.proctor, xMeta.idx, r2.session_key, ctx.normalizedExemptions)) return false;
    if (isOnDuty(xMeta.proctor, xMeta.idx, r2.halfday_key, ctx.normalizedDuty)) return false;
    if (isMEBlocked(xMeta.proctor, xMeta.idx, r2.halfday_key, ctx.normalizedME)) return false;

    // C-NO-DOUBLE within session — only relevant when R1 and R2 share a
    // session_key. By construction R1 and R2 differ in PERIOD (one AM, one
    // PM), so their halfday_keys differ, and Schedule_Entries belong to
    // exactly one halfday → session_keys also differ. To stay defensive
    // against schema variations, we still walk all rows of the target
    // session looking for the incoming proctor (excluding the row about
    // to receive them).
    if (r1.session_key === r2.session_key) return false;

    // Cross-session double-book check for X moving into R2.
    for (var ri = 0; ri < rows.length; ri += 1) {
        if (ri === r1Idx) continue; // X is moving OUT of r1
        var r = rows[ri];
        if (!r || !Array.isArray(r.proctor_keys)) continue;
        if (r.session_key !== r2.session_key) continue;
        for (var sk = 0; sk < r.proctor_keys.length; sk += 1) {
            if (ri === r2Idx && sk === slot2) continue; // the slot Y is vacating
            if (r.proctor_keys[sk] === xKey) return false;
        }
    }
    // And Y moving into R1.
    for (var ri2 = 0; ri2 < rows.length; ri2 += 1) {
        if (ri2 === r2Idx) continue; // Y is moving OUT of r2
        var rr = rows[ri2];
        if (!rr || !Array.isArray(rr.proctor_keys)) continue;
        if (rr.session_key !== r1.session_key) continue;
        for (var sk2 = 0; sk2 < rr.proctor_keys.length; sk2 += 1) {
            if (ri2 === r1Idx && sk2 === slot1) continue; // the slot X is vacating
            if (rr.proctor_keys[sk2] === yKey) return false;
        }
    }

    // C-NO-SAME-DAY: an exchange CAN introduce a same-day violation.
    // Example: X holds AM-of-day-D and AM-of-day-D' (two distinct AM
    // halfdays). Y holds PM-of-day-D. Pre-swap, X is only AM, Y is only
    // PM — no violation. Post-swap (X swaps into Y's row, Y into X's),
    // X holds AM-of-day-D' AND PM-of-day-D. Both halfdays of distinct
    // days, still no violation. But if X had ALSO held some other slot
    // in day-D (say AM-of-day-D in another row r3), post-swap X holds
    // AM-of-day-D (in r3) AND PM-of-day-D (in r2) — same-day violation.
    //
    // The defensive check: after the hypothetical swap, does either
    // proctor occupy two halfdays of the same day? We materialize the
    // POST-swap halfday set for each proctor and check.
    if (ctx.allowSameDay !== true) {
        if (introducesSameDayViolation(rows, xKey, r1Idx, slot1, r2Idx, slot2,
                r1.halfday_key, r2.halfday_key)) return false;
        if (introducesSameDayViolation(rows, yKey, r2Idx, slot2, r1Idx, slot1,
                r2.halfday_key, r1.halfday_key)) return false;
    }

    return true;
}

/**
 * Check whether moving `proctorKey` OUT of (leavingRowIdx, leavingSlot)
 * and INTO (enteringRowIdx, enteringSlot) — given that the proctor was
 * occupying `leavingHalfday` and will now occupy `enteringHalfday` in
 * those slots — introduces a C-NO-SAME-DAY violation.
 *
 * Strategy: build the proctor's POST-swap set of halfdays (the set of
 * halfdays in which they hold any slot, after the hypothetical exchange)
 * and check whether any two halfdays in that set share the same day.
 *
 * @returns {boolean} true iff the swap introduces a same-day violation
 */
function introducesSameDayViolation(rows, proctorKey, leavingRowIdx, leavingSlot,
                                     enteringRowIdx, enteringSlot,
                                     leavingHalfday, enteringHalfday) {
    var halfdaysHeld = Object.create(null);
    for (var ri = 0; ri < rows.length; ri += 1) {
        var r = rows[ri];
        if (!r || !Array.isArray(r.proctor_keys)) continue;
        for (var si = 0; si < r.proctor_keys.length; si += 1) {
            var k = r.proctor_keys[si];
            if (k !== proctorKey) continue;
            // Skip the slot the proctor is LEAVING.
            if (ri === leavingRowIdx && si === leavingSlot) continue;
            if (typeof r.halfday_key === 'string' && r.halfday_key.length > 0) {
                halfdaysHeld[r.halfday_key] = true;
            }
        }
    }
    // Add the halfday the proctor is ENTERING.
    if (typeof enteringHalfday === 'string' && enteringHalfday.length > 0) {
        halfdaysHeld[enteringHalfday] = true;
    }

    // Check pairwise: any two halfdays in `halfdaysHeld` sharing a day?
    var keys = Object.keys(halfdaysHeld);
    var dayMap = Object.create(null);
    for (var i = 0; i < keys.length; i += 1) {
        var hd = keys[i];
        var pipe = hd.indexOf('|');
        var day = pipe === -1 ? hd : hd.slice(0, pipe);
        if (dayMap[day] !== undefined && dayMap[day] !== hd) {
            return true; // two distinct halfdays share `day`
        }
        dayMap[day] = hd;
    }
    return false;
}

/**
 * Apply an exchange: replace rows in place with fresh shallow-cloned rows
 * whose `proctor_keys` are fresh arrays (preserves AC 10.2). Update
 * load-state am/pm counts AND the occupancy sets used by the
 * hard-constraint predicates.
 *
 * Both proctors keep the same guardCount (one slot lost, one gained) so
 * we do NOT touch guardCount. We DO update amCount / pmCount because the
 * proctor's slot moved from one period to another.
 */
function applyExchange(ctx, exchange) {
    var rows = ctx.rows;
    var r1Idx = exchange.r1Idx;
    var slot1 = exchange.slot1;
    var r2Idx = exchange.r2Idx;
    var slot2 = exchange.slot2;
    var xKey = exchange.xKey;
    var yKey = exchange.yKey;

    var srcR1 = rows[r1Idx];
    var srcR2 = rows[r2Idx];

    var newR1 = shallowCopyRow(srcR1);
    var newR1Keys = srcR1.proctor_keys.slice();
    newR1Keys[slot1] = yKey;
    newR1.proctor_keys = newR1Keys;
    rows[r1Idx] = newR1;

    var newR2 = shallowCopyRow(srcR2);
    var newR2Keys = srcR2.proctor_keys.slice();
    newR2Keys[slot2] = xKey;
    newR2.proctor_keys = newR2Keys;
    rows[r2Idx] = newR2;

    var period1 = periodFromHalfdayKey(newR1.halfday_key);
    var period2 = periodFromHalfdayKey(newR2.halfday_key);

    // Update AM/PM counts. X moves from period1 to period2; Y moves from
    // period2 to period1.
    var ls = ctx.loadState;
    var xEntry = ls.proctors[xKey];
    var yEntry = ls.proctors[yKey];

    if (xEntry) {
        if (isAmPeriod(period1) && xEntry.amCount > 0) xEntry.amCount -= 1;
        else if (isPmPeriod(period1) && xEntry.pmCount > 0) xEntry.pmCount -= 1;
        if (isAmPeriod(period2)) xEntry.amCount += 1;
        else if (isPmPeriod(period2)) xEntry.pmCount += 1;
    }
    if (yEntry) {
        if (isAmPeriod(period2) && yEntry.amCount > 0) yEntry.amCount -= 1;
        else if (isPmPeriod(period2) && yEntry.pmCount > 0) yEntry.pmCount -= 1;
        if (isAmPeriod(period1)) yEntry.amCount += 1;
        else if (isPmPeriod(period1)) yEntry.pmCount += 1;
    }

    // Occupancy sets: each proctor still occupies BOTH session_keys and
    // BOTH halfday_keys involved (since they swapped slots, not roles).
    // If the rows hold sessions/halfdays that the proctor no longer
    // occupies after the swap, we need to clear those. But by symmetry,
    // X moves OUT of r1.session_key only if X had no other slot in
    // r1.session_key (we already verified above), and X moves INTO
    // r2.session_key. Similarly for Y. Same logic for halfdays.
    function refreshOccupancy(proctorKey, leavingRow, leavingRowIdx, leavingSlot,
                              enteringRow) {
        // Determine if proctorKey still appears in any row sharing
        // leavingRow.session_key after this exchange. If not, clear that
        // session from its occupancy set. Same for halfday.
        var stillInLeavingSession = false;
        var stillInLeavingHalfday = false;
        for (var ri = 0; ri < rows.length; ri += 1) {
            var r = rows[ri];
            if (!r || !Array.isArray(r.proctor_keys)) continue;
            for (var si = 0; si < r.proctor_keys.length; si += 1) {
                if (r.proctor_keys[si] !== proctorKey) continue;
                if (r.session_key === leavingRow.session_key) stillInLeavingSession = true;
                if (r.halfday_key === leavingRow.halfday_key) stillInLeavingHalfday = true;
            }
        }
        if (!stillInLeavingSession) {
            clearGuardOccupancy(ls, proctorKey, leavingRow.session_key, '');
        }
        if (!stillInLeavingHalfday) {
            clearGuardOccupancy(ls, proctorKey, '', leavingRow.halfday_key);
        }
        // Record new occupancy.
        recordGuardOccupancy(ls, proctorKey, enteringRow.session_key, enteringRow.halfday_key);
    }

    refreshOccupancy(xKey, srcR1, r1Idx, slot1, newR2);
    refreshOccupancy(yKey, srcR2, r2Idx, slot2, newR1);
}

// ---------------------------------------------------------------------------
// Search: find the first beneficial exchange
// ---------------------------------------------------------------------------

/**
 * Compute the change in (X's imbalance + Y's imbalance) that an exchange
 * would produce. A NEGATIVE delta means the total imbalance decreases —
 * an improvement.
 *
 * X moves from period1 to period2. Y moves from period2 to period1.
 *
 * @returns {number} sum of post-swap imbalances minus pre-swap imbalances
 */
function exchangeDelta(ctx, xKey, yKey, period1, period2) {
    var ls = ctx.loadState;
    var xAm = amCount(ls, xKey);
    var xPm = pmCount(ls, xKey);
    var yAm = amCount(ls, yKey);
    var yPm = pmCount(ls, yKey);

    var xAmAfter = xAm;
    var xPmAfter = xPm;
    var yAmAfter = yAm;
    var yPmAfter = yPm;

    if (isAmPeriod(period1)) xAmAfter -= 1;
    else if (isPmPeriod(period1)) xPmAfter -= 1;
    if (isAmPeriod(period2)) xAmAfter += 1;
    else if (isPmPeriod(period2)) xPmAfter += 1;

    if (isAmPeriod(period2)) yAmAfter -= 1;
    else if (isPmPeriod(period2)) yPmAfter -= 1;
    if (isAmPeriod(period1)) yAmAfter += 1;
    else if (isPmPeriod(period1)) yPmAfter += 1;

    var preTotal = Math.abs(xAm - xPm) + Math.abs(yAm - yPm);
    var postTotal = Math.abs(xAmAfter - xPmAfter) + Math.abs(yAmAfter - yPmAfter);
    return postTotal - preTotal;
}

/**
 * Build per-period row indices by canonical key — `rowsHoldingKey[key]`
 * returns an object `{ am: number[], pm: number[] }` where each array
 * lists row indices in which the proctor holds at least one AM or PM
 * slot, sorted ascending.
 *
 * Recomputed on every iteration because exchanges mutate row contents.
 */
function buildRowsHoldingKey(rows) {
    var byKey = Object.create(null);
    for (var ri = 0; ri < rows.length; ri += 1) {
        var r = rows[ri];
        if (!r || !Array.isArray(r.proctor_keys)) continue;
        var period = periodFromHalfdayKey(r.halfday_key);
        var bucket = isAmPeriod(period) ? 'am' : (isPmPeriod(period) ? 'pm' : null);
        if (bucket === null) continue;
        var seen = Object.create(null);
        for (var si = 0; si < r.proctor_keys.length; si += 1) {
            var k = r.proctor_keys[si];
            if (typeof k !== 'string' || k.length === 0) continue;
            if (seen[k]) continue;
            seen[k] = true;
            if (!byKey[k]) byKey[k] = { am: [], pm: [] };
            byKey[k][bucket].push(ri);
        }
    }
    return byKey;
}

/**
 * Find the first beneficial exchange in lexicographic order. Iteration
 * order:
 *   1. For each AM-heavy proctor X (sorted by canonical-key code-point):
 *   2.   For each PM-heavy proctor Y (sorted by canonical-key code-point):
 *   3.     For each AM row R1 holding X (sorted by row index):
 *   4.       For each slot in R1 holding X (sorted by slot index):
 *   5.         For each PM row R2 holding Y (sorted by row index):
 *   6.           For each slot in R2 holding Y (sorted by slot index):
 *   7.             If canExchange(...) AND exchangeDelta(...) < 0 → return.
 *
 * The same nested loop is then run for X = PM-heavy, Y = AM-heavy (the
 * symmetric case): X moves AM→PM is replaced by X moves PM→AM. To avoid
 * code duplication we iterate (sourcePeriod, targetPeriod) over both
 * directions in the outer wrapper.
 */
function findBeneficialExchange(ctx) {
    var ls = ctx.loadState;
    var rows = ctx.rows;
    var rowsHolding = buildRowsHoldingKey(rows);

    // Collect imbalanced proctors, classified by sign.
    var amHeavy = [];
    var pmHeavy = [];
    var procKeys = Object.keys(ls.proctors);
    procKeys.sort();
    for (var i = 0; i < procKeys.length; i += 1) {
        var k = procKeys[i];
        var sign = imbalanceSignOf(ls, k);
        if (sign > 0) amHeavy.push(k);
        else if (sign < 0) pmHeavy.push(k);
    }
    if (amHeavy.length === 0 || pmHeavy.length === 0) return null;

    // Iterate over (X = amHeavy, Y = pmHeavy). X gives up an AM slot for
    // a PM slot. The reverse direction (X = pmHeavy giving up PM for AM)
    // is symmetric — by iterating both lists with X as outer, we cover
    // both cases naturally if we don't restrict X.
    //
    // But wait: by construction `amHeavy ∩ pmHeavy = ∅`. If X is AM-heavy
    // and Y is PM-heavy, the exchange (X gives AM, Y gives PM) helps
    // both. If X is PM-heavy, the same logic with periods reversed
    // applies. To cover both, we treat the outer X loop as donors who
    // want to LOSE their over-represented period.
    //
    // To keep the search simple we run the AM→PM direction only here;
    // PM→AM is automatically discovered in the next iteration of the
    // outer loop in `ampmBalance` because each iteration recomputes the
    // imbalance vector. This is a subtle but important point: BOTH
    // directions of the exchange are captured by iterating amHeavy as X
    // ONCE per loop iteration, because the same swap that helps an
    // AM-heavy X also helps the PM-heavy Y on the OTHER side. We do NOT
    // need to repeat with X swapped for Y.

    for (var xi = 0; xi < amHeavy.length; xi += 1) {
        var xKey = amHeavy[xi];
        var xRows = rowsHolding[xKey];
        if (!xRows || xRows.am.length === 0) continue;
        for (var yi = 0; yi < pmHeavy.length; yi += 1) {
            var yKey = pmHeavy[yi];
            var yRows = rowsHolding[yKey];
            if (!yRows || yRows.pm.length === 0) continue;

            for (var r1i = 0; r1i < xRows.am.length; r1i += 1) {
                var r1Idx = xRows.am[r1i];
                var r1 = rows[r1Idx];
                if (!r1 || !Array.isArray(r1.proctor_keys)) continue;

                for (var slot1 = 0; slot1 < r1.proctor_keys.length; slot1 += 1) {
                    if (r1.proctor_keys[slot1] !== xKey) continue;

                    for (var r2i = 0; r2i < yRows.pm.length; r2i += 1) {
                        var r2Idx = yRows.pm[r2i];
                        if (r2Idx === r1Idx) continue;
                        var r2 = rows[r2Idx];
                        if (!r2 || !Array.isArray(r2.proctor_keys)) continue;

                        for (var slot2 = 0; slot2 < r2.proctor_keys.length; slot2 += 1) {
                            if (r2.proctor_keys[slot2] !== yKey) continue;

                            var period1 = periodFromHalfdayKey(r1.halfday_key);
                            var period2 = periodFromHalfdayKey(r2.halfday_key);
                            if (!isAmPeriod(period1) || !isPmPeriod(period2)) continue;

                            var delta = exchangeDelta(ctx, xKey, yKey, period1, period2);
                            if (delta >= 0) continue; // not strictly beneficial

                            if (!canExchange(ctx, r1Idx, slot1, xKey, r2Idx, slot2, yKey)) continue;

                            return {
                                r1Idx: r1Idx,
                                slot1: slot1,
                                r2Idx: r2Idx,
                                slot2: slot2,
                                xKey: xKey,
                                yKey: yKey,
                                delta: delta
                            };
                        }
                    }
                }
            }
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Phase 8 entry point
// ---------------------------------------------------------------------------

/**
 * Run AM/PM balance repair on the supplied state. Returns a new state.
 *
 * @param {Object} state - pipeline state populated through Phase 7
 * @returns {Object}
 */
function ampmBalance(state) {
    if (state === null || state === undefined) {
        throw new TypeError('ampmBalance: state must be an object');
    }
    var input = state.input;
    if (!isPlainObject(input)) {
        throw new TypeError('ampmBalance: state.input must be a plain object');
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

    // Empty-state short-circuit. Nothing to balance.
    if (inRows === null || inRows.length === 0
        || !isPlainObject(loadState) || !isPlainObject(loadState.proctors)) {
        nextDiag.ampmBalanceExchanges = 0;
        nextDiag.ampmBalanceIterations = 0;
        nextDiag.amPmImbalanceByProctorKey = computeAmPmImbalanceMap(loadState || { proctors: {} });
        var ns0 = shallowCopyState(state);
        ns0.diagnostics = nextDiag;
        return ns0;
    }

    // Already at target? Short-circuit. We still emit the diagnostics map
    // so downstream (Phase 10) can rely on it.
    var initialMap = computeAmPmImbalanceMap(loadState);
    var hasImbalanced = false;
    var imbKeys = Object.keys(initialMap);
    for (var ik = 0; ik < imbKeys.length; ik += 1) {
        if (initialMap[imbKeys[ik]] >= IMBALANCE_REPAIR_THRESHOLD) {
            hasImbalanced = true;
            break;
        }
    }
    if (!hasImbalanced) {
        nextDiag.ampmBalanceExchanges = 0;
        nextDiag.ampmBalanceIterations = 0;
        nextDiag.amPmImbalanceByProctorKey = initialMap;
        var ns1 = shallowCopyState(state);
        ns1.diagnostics = nextDiag;
        return ns1;
    }

    var proctorByKey = buildProctorIndex(input.proctorsList);
    var normalizedExemptions = isPlainObject(state.normalizedExemptionsData)
        ? state.normalizedExemptionsData : {};
    var normalizedDuty = isPlainObject(state.normalizedDutyData)
        ? state.normalizedDutyData : {};
    var normalizedME = isPlainObject(state.normalizedMEAssignments)
        ? state.normalizedMEAssignments : {};

    // Clone the rows array so we can swap in fresh row references without
    // mutating the array reference held by the caller. Individual row
    // objects remain shared until they are touched by an exchange (then
    // shallow-cloned in `applyExchange`).
    var rows = inRows.slice();

    // Time budget.
    var timeBudgetMs = (state.options && typeof state.options.phase8TimeBudgetMs === 'number')
        ? state.options.phase8TimeBudgetMs
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
        allowSameDay: !!(input.examDistributionRules
            && input.examDistributionRules.allowSameDayBothHalfdays)
    };

    var totalExchanges = 0;
    var iterations = 0;
    var hitTimeBudget = false;
    var stuckAtLocalMin = false;

    while (iterations < MAX_ITERATIONS) {
        iterations += 1;
        if (!timeRemaining()) {
            hitTimeBudget = true;
            break;
        }

        var exchange = findBeneficialExchange(ctx);
        if (!exchange) {
            stuckAtLocalMin = true;
            break;
        }

        applyExchange(ctx, exchange);
        totalExchanges += 1;
    }

    nextDiag.ampmBalanceExchanges = totalExchanges;
    nextDiag.ampmBalanceIterations = iterations;
    nextDiag.amPmImbalanceByProctorKey = computeAmPmImbalanceMap(loadState);
    // Surface why we stopped (informational; not an AC requirement).
    if (hitTimeBudget) nextDiag.ampmBalanceStopReason = 'time_budget';
    else if (stuckAtLocalMin) nextDiag.ampmBalanceStopReason = 'local_minimum';
    else if (iterations >= MAX_ITERATIONS) nextDiag.ampmBalanceStopReason = 'iteration_cap';
    else nextDiag.ampmBalanceStopReason = 'completed';

    var ns = shallowCopyState(state);
    ns.rows = rows;
    ns.loadState = loadState;
    ns.diagnostics = nextDiag;
    return ns;
}

module.exports = {
    ampmBalance: ampmBalance,
    _internals: {
        imbalanceOf: imbalanceOf,
        imbalanceSignOf: imbalanceSignOf,
        computeAmPmImbalanceMap: computeAmPmImbalanceMap,
        canExchange: canExchange,
        applyExchange: applyExchange,
        exchangeDelta: exchangeDelta,
        findBeneficialExchange: findBeneficialExchange,
        buildRowsHoldingKey: buildRowsHoldingKey,
        introducesSameDayViolation: introducesSameDayViolation,
        periodFromHalfdayKey: periodFromHalfdayKey,
        isAmPeriod: isAmPeriod,
        isPmPeriod: isPmPeriod,
        DEFAULT_TIME_BUDGET_MS: DEFAULT_TIME_BUDGET_MS,
        MAX_ITERATIONS: MAX_ITERATIONS,
        IMBALANCE_REPAIR_THRESHOLD: IMBALANCE_REPAIR_THRESHOLD
    }
};
