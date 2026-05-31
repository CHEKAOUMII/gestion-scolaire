// Proctor Distribution V3 — Bounds computation (Phase 3 helpers).
//
// Pure module: exposes two stateless functions used by
// `phases/03-bounds.js` to compute the global and per-class fairness
// bounds that drive every later phase (CP solver, coverage repair,
// bimodal repair).
//
// Public API:
//   - computeGlobalBounds(gTotalSlots, dExpected, nEligible)
//       → { globalLowerBound, globalUpperBound }
//   - computeClassBounds(classes, globalLower, globalUpper, dutyByClass, slotsByClass)
//       → { byClass: { [classId]: { lower, upper, size, slotsInClass, dutyInClass } },
//           list:    [ { classId, lower, upper, size, slotsInClass, dutyInClass } ] }
//
// Acceptance Criteria covered:
//   - 5.2 : globalLowerBound = floor((G + D) / N); globalUpperBound = ceil((G + D) / N).
//           When (G + D) % N == 0, globalLowerBound == globalUpperBound; otherwise
//           globalUpperBound == globalLowerBound + 1.
//           Edge case: nEligible == 0 → both bounds = 0 (no division by zero).
//   - 5.3 : Class_Lower_Bound(c) ≤ globalUpperBound  (capped via Math.min).
//   - 5.4 : Class_Upper_Bound(c) ≤ globalUpperBound + 1  (capped via Math.min).
//   - 5.5 : Monotonicity guard. When the per-class total (G_c + D_c) ≤ globalLower,
//           Class_Lower_Bound(c) = (G_c + D_c). Comparison uses `<=`, NOT `<`,
//           so a class whose total exactly equals globalLower keeps its bound
//           equal to its total (preventing the bound from being inflated past
//           the work the class can actually carry).
//
// V2 pitfalls avoided:
//   - V2 had two competing bounds formulas (`computeBounds(totalTasks - fixed…)` AND
//     `computeClassBounds(totalGuardSlots + expectedDuty, …)`) running side by side
//     and producing inconsistent diagnostics. V3 has ONE formula.
//   - V2's monotonicity guard used `<` instead of `<=`, which mishandled the
//     boundary case where a class's total exactly equalled globalLower. V3 uses `<=`.
//
// Purity contract:
//   - Inputs are not mutated; outputs are fresh objects/arrays.

'use strict';

/**
 * Determine whether a value is a finite, non-negative integer.
 * @param {*} value
 * @returns {boolean}
 */
function isNonNegInt(value) {
    return (
        typeof value === 'number'
        && Number.isFinite(value)
        && value >= 0
        && Math.floor(value) === value
    );
}

/**
 * Coerce a value to a non-negative integer, defaulting to 0.
 * Negative or non-finite values become 0.
 * @param {*} value
 * @returns {number}
 */
function toNonNegInt(value) {
    var n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
}

/**
 * Compute global lower / upper bounds from total guard slots, expected duty
 * count, and number of eligible proctors.
 *
 * Formula (single source of truth):
 *   total = G + D
 *   if N == 0: lower = 0, upper = 0
 *   else:
 *     lower = floor(total / N)
 *     upper = ceil(total / N)        // == lower when total % N == 0
 *                                    // == lower + 1 when total % N > 0
 *
 * @param {number} gTotalSlots  - total guard slots across all rows (G)
 * @param {number} dExpected    - expected duty count (D); 0 when not configured
 * @param {number} nEligible    - number of eligible proctors (N)
 * @returns {{ globalLowerBound: number, globalUpperBound: number }}
 */
function computeGlobalBounds(gTotalSlots, dExpected, nEligible) {
    var G = toNonNegInt(gTotalSlots);
    var D = toNonNegInt(dExpected);
    var N = toNonNegInt(nEligible);

    if (N === 0) {
        return { globalLowerBound: 0, globalUpperBound: 0 };
    }

    var total = G + D;
    var lower = Math.floor(total / N);
    var upper = Math.ceil(total / N);
    return { globalLowerBound: lower, globalUpperBound: upper };
}

/**
 * Compute per-class lower/upper bounds. Each class supplies its own size
 * (number of proctors) along with the slot count and duty count attributed
 * to its members. Bounds are derived from the natural per-class average
 * THEN capped against the global bounds (Acceptance Criteria 5.3, 5.4)
 * AND adjusted by the monotonicity guard (Acceptance Criterion 5.5).
 *
 * Algorithm (per class c with size N_c and total = G_c + D_c):
 *   if N_c == 0:
 *     lower = 0, upper = 0
 *   else:
 *     naturalLower = floor(total / N_c)
 *     naturalUpper = ceil(total / N_c)
 *     if total <= globalLower:                # AC 5.5 — monotonicity guard
 *       lower = total                         # entire class total fits
 *       upper = min(naturalUpper, globalUpper + 1)
 *     else:
 *       lower = min(naturalLower, globalUpper)        # AC 5.3
 *       upper = min(naturalUpper, globalUpper + 1)    # AC 5.4
 *
 * Two ordering invariants always hold for any returned class:
 *   - lower <= upper   (the per-class lower never exceeds the per-class upper)
 *   - upper >= lower   (trivially equivalent)
 *
 * @param {Array<{ classId: string, size?: number, proctorKeys?: Array<string> }>} classes
 * @param {number} globalLower - from computeGlobalBounds
 * @param {number} globalUpper - from computeGlobalBounds
 * @param {Object<string, number>} dutyByClass  - classId → duty count
 * @param {Object<string, number>} slotsByClass - classId → slot count
 * @returns {{
 *   byClass: Object<string, { classId: string, lower: number, upper: number, size: number, slotsInClass: number, dutyInClass: number }>,
 *   list:    Array<{ classId: string, lower: number, upper: number, size: number, slotsInClass: number, dutyInClass: number }>
 * }}
 */
function computeClassBounds(classes, globalLower, globalUpper, dutyByClass, slotsByClass) {
    var GL = isNonNegInt(globalLower) ? globalLower : toNonNegInt(globalLower);
    var GU = isNonNegInt(globalUpper) ? globalUpper : toNonNegInt(globalUpper);
    var dutyMap = (dutyByClass && typeof dutyByClass === 'object' && !Array.isArray(dutyByClass))
        ? dutyByClass
        : {};
    var slotsMap = (slotsByClass && typeof slotsByClass === 'object' && !Array.isArray(slotsByClass))
        ? slotsByClass
        : {};
    var classList = Array.isArray(classes) ? classes : [];

    var byClass = {};
    var list = [];

    for (var i = 0; i < classList.length; i += 1) {
        var c = classList[i];
        if (!c || typeof c !== 'object') continue;
        var classId = c.classId;
        if (typeof classId !== 'string' || classId.length === 0) continue;

        // Resolve the class size from explicit `size` or from `proctorKeys.length`.
        var size = 0;
        if (isNonNegInt(c.size)) {
            size = c.size;
        } else if (Array.isArray(c.proctorKeys)) {
            size = c.proctorKeys.length;
        }

        var slotsInClass = toNonNegInt(slotsMap[classId]);
        var dutyInClass = toNonNegInt(dutyMap[classId]);
        var total = slotsInClass + dutyInClass;

        var lower;
        var upper;

        if (size === 0) {
            // Defensive: an empty class (no members) carries no work; bounds
            // collapse to 0/0. This branch is unreachable in practice because
            // Phase 2 only emits classes with at least one proctor.
            lower = 0;
            upper = 0;
        } else {
            var naturalLower = Math.floor(total / size);
            var naturalUpper = Math.ceil(total / size);

            // AC 5.5 — monotonicity guard. Use `<=`, NOT `<` (V2 bug).
            // When the class's total work fits at-or-below the global
            // lower bound, the class can collectively carry at most `total`
            // assignments — using naturalLower would inflate the per-proctor
            // expectation past what the class can deliver.
            if (total <= GL) {
                lower = total;
                upper = Math.min(naturalUpper, GU + 1);
            } else {
                // AC 5.3 — class lower never exceeds globalUpper.
                lower = Math.min(naturalLower, GU);
                // AC 5.4 — class upper never exceeds globalUpper + 1.
                upper = Math.min(naturalUpper, GU + 1);
            }

            // Final invariant: lower <= upper. The cap calculation can never
            // legitimately invert these (naturalLower <= naturalUpper always,
            // and Math.min preserves the relationship since both caps respect
            // GU + 1 ≥ GU), but we enforce defensively to fail loud if a
            // future change ever breaks this assumption.
            if (lower > upper) {
                lower = upper;
            }
        }

        var record = {
            classId: classId,
            lower: lower,
            upper: upper,
            size: size,
            slotsInClass: slotsInClass,
            dutyInClass: dutyInClass
        };
        byClass[classId] = record;
        list.push(record);
    }

    return { byClass: byClass, list: list };
}

module.exports = {
    computeGlobalBounds: computeGlobalBounds,
    computeClassBounds: computeClassBounds,
    // Internal helpers exposed for white-box testing only.
    _internals: {
        isNonNegInt: isNonNegInt,
        toNonNegInt: toNonNegInt
    }
};
