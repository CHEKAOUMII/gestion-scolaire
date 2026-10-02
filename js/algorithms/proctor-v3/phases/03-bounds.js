// Proctor Distribution V3 — Phase 3: Compute Bounds.
//
// Pure function: takes a `state` already populated by Phase 1 (key
// normalization), Phase 1b (rooms/rows materialization), and Phase 2
// (eligibility class derivation), and returns a NEW state with:
//
//   - bounds : {
//         global:  { lower, upper, gTotalSlots, dExpected, nEligible },
//         byClass: { [classId]: { classId, lower, upper, size, slotsInClass, dutyInClass } },
//         list:    [ { classId, lower, upper, size, slotsInClass, dutyInClass } ],
//     }
//
// Inputs read from state (all optional with safe defaults):
//   - state.input.proctorsList           — for N (number of eligible proctors)
//   - state.input.examCenterConfig       — for D (expected_duty_tasks)
//   - state.rows                         — for G (sum of proctor_keys.length)
//   - state.normalizedDutyData           — for per-halfday duty entries
//   - state.classes                      — list of eligibility classes
//   - state.classByProctorKey            — mapping proctor → classId
//
// Acceptance Criteria covered (delegated to constraints/bounds.js):
//   - 5.2 : Global_Lower_Bound = floor((G + D) / N); Global_Upper_Bound = ceil((G + D) / N).
//   - 5.3 : Class_Lower_Bound(c) ≤ Global_Upper_Bound.
//   - 5.4 : Class_Upper_Bound(c) ≤ Global_Upper_Bound + 1.
//   - 5.5 : Monotonicity guard (uses `<=`, not `<`).
//
// Purity contract:
//   - state.input is NOT mutated.
//   - state.rows / state.normalizedDutyData / state.classes / state.classByProctorKey
//     are READ but never mutated.
//   - The returned state is a fresh object; only `bounds` is added.
//     All other fields are shallow-copied from the input state.

'use strict';

var path = require('path');
var boundsModule = require(path.join(__dirname, '..', 'constraints', 'bounds.js'));
var computeGlobalBounds = boundsModule.computeGlobalBounds;
var computeClassBounds = boundsModule.computeClassBounds;

/**
 * Determine whether a value is a plain (non-array, non-null) object.
 * @param {*} value
 * @returns {boolean}
 */
function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    return true;
}

/**
 * Coerce a value to a non-negative integer, defaulting to 0.
 * @param {*} value
 * @returns {number}
 */
function toNonNegInt(value) {
    var n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
}

/**
 * Compute total guard slots G across all rows: Σ row.proctor_keys.length.
 * Rows missing a `proctor_keys` array contribute 0.
 * @param {Array} rows
 * @returns {number}
 */
function computeGTotalSlots(rows) {
    if (!Array.isArray(rows)) return 0;
    var total = 0;
    for (var i = 0; i < rows.length; i += 1) {
        var r = rows[i];
        if (r && Array.isArray(r.proctor_keys)) {
            total += r.proctor_keys.length;
        }
    }
    return total;
}

/**
 * Read expected duty tasks count D. Accepts the whole `input` object and
 * honors BOTH the design-canonical location
 * (`input.examCenterConfig.expected_duty_tasks`) and the V2/production
 * top-level field (`input.D_expected`). The canonical location wins when
 * present; otherwise the top-level value is used. Defaults to 0 when
 * neither is present or numeric.
 * @param {Object|null|undefined} input
 * @returns {number}
 */
function readDExpected(input) {
    if (!isPlainObject(input)) return 0;
    if (isPlainObject(input.examCenterConfig)
        && input.examCenterConfig.expected_duty_tasks != null) {
        return toNonNegInt(input.examCenterConfig.expected_duty_tasks);
    }
    if (input.D_expected != null) {
        return toNonNegInt(input.D_expected);
    }
    return 0;
}

/**
 * Read number of eligible proctors N from proctorsList length.
 * Per task guidance: use full proctor count as N.
 * @param {Array} proctorsList
 * @returns {number}
 */
function readNEligible(proctorsList) {
    if (!Array.isArray(proctorsList)) return 0;
    return proctorsList.length;
}

/**
 * Compute duty entries per class. For each halfday in normalizedDutyData,
 * iterate its inner proctor keys and bucket by the proctor's classId.
 *
 * Each (proctor, halfday) entry counts as ONE duty unit (matches
 * Duty_Count(T) definition: distinct halfdays per proctor).
 *
 * @param {Object} normalizedDutyData
 * @param {Object} classByProctorKey
 * @returns {Object<string, number>} classId → duty count
 */
function computeDutyByClass(normalizedDutyData, classByProctorKey) {
    var out = {};
    if (!isPlainObject(normalizedDutyData)) return out;
    if (!isPlainObject(classByProctorKey) && (typeof classByProctorKey !== 'object' || classByProctorKey === null)) {
        return out;
    }
    var halfdays = Object.keys(normalizedDutyData);
    for (var i = 0; i < halfdays.length; i += 1) {
        var inner = normalizedDutyData[halfdays[i]];
        if (!isPlainObject(inner)) continue;
        var proctorKeys = Object.keys(inner);
        for (var j = 0; j < proctorKeys.length; j += 1) {
            var pk = proctorKeys[j];
            var classId = classByProctorKey[pk];
            if (typeof classId !== 'string' || classId.length === 0) continue;
            out[classId] = (out[classId] || 0) + 1;
        }
    }
    return out;
}

/**
 * Compute slots-per-class. For each class c, sum over rows whose
 * `session_key` is in `c.eligibleSessions` of `row.proctor_keys.length`.
 *
 * This is a HEURISTIC: a session may be eligible for multiple classes,
 * so the same row's slots are credited to every class that can serve it.
 * The bounds derived from this heuristic are guides, not hard caps —
 * Phase 4 (CP solver) handles actual slot-to-proctor assignment.
 *
 * @param {Array} classes - list of EligibilityClass objects
 * @param {Array} rows
 * @returns {Object<string, number>} classId → slots count
 */
function computeSlotsByClass(classes, rows) {
    var out = {};
    if (!Array.isArray(classes) || classes.length === 0) return out;
    if (!Array.isArray(rows) || rows.length === 0) {
        // Initialize all class slots to 0 so downstream lookups are well-defined.
        for (var z = 0; z < classes.length; z += 1) {
            var cz = classes[z];
            if (cz && typeof cz.classId === 'string') out[cz.classId] = 0;
        }
        return out;
    }

    // Build a map session_key → row.proctor_keys.length once.
    // (Multiple rows can share a session_key, in which case we sum them.)
    var slotsBySession = Object.create(null);
    for (var i = 0; i < rows.length; i += 1) {
        var r = rows[i];
        if (!r || typeof r !== 'object') continue;
        var sk = r.session_key;
        if (typeof sk !== 'string' || sk.length === 0) continue;
        var n = Array.isArray(r.proctor_keys) ? r.proctor_keys.length : 0;
        slotsBySession[sk] = (slotsBySession[sk] || 0) + n;
    }

    for (var k = 0; k < classes.length; k += 1) {
        var c = classes[k];
        if (!c || typeof c.classId !== 'string') continue;
        var eligibleSessions = Array.isArray(c.eligibleSessions) ? c.eligibleSessions : [];
        var sum = 0;
        for (var s = 0; s < eligibleSessions.length; s += 1) {
            var sessKey = eligibleSessions[s];
            if (typeof sessKey === 'string' && Object.prototype.hasOwnProperty.call(slotsBySession, sessKey)) {
                sum += slotsBySession[sessKey];
            }
        }
        out[c.classId] = sum;
    }

    return out;
}

/**
 * Build the per-proctor class-bounds map (AC 5.14): keyed by Canonical_Proctor_Key,
 * each value is `{ classId, classLowerBound, classUpperBound, classSize }`.
 * Proctors whose class has no bound record are skipped.
 *
 * @param {Object} classByProctorKey - canonicalKey → classId
 * @param {Object} byClass           - classId → { lower, upper, size, ... }
 * @returns {Object<string, {classId:string, classLowerBound:number, classUpperBound:number, classSize:number}>}
 */
function buildClassBoundsByProctorKey(classByProctorKey, byClass) {
    var out = {};
    if (!isPlainObject(classByProctorKey)
        && (classByProctorKey === null || typeof classByProctorKey !== 'object')) {
        return out;
    }
    if (!isPlainObject(byClass)) return out;
    var keys = Object.keys(classByProctorKey);
    for (var i = 0; i < keys.length; i += 1) {
        var pk = keys[i];
        var classId = classByProctorKey[pk];
        if (typeof classId !== 'string' || classId.length === 0) continue;
        var rec = byClass[classId];
        if (!isPlainObject(rec)) continue;
        out[pk] = {
            classId: classId,
            classLowerBound: rec.lower,
            classUpperBound: rec.upper,
            classSize: rec.size
        };
    }
    return out;
}

/**
 * Phase 3 entry point.
 *
 * @param {Object} state - pipeline state; must contain `state.input`. Other
 *                          fields are read defensively (treated as empty
 *                          when missing).
 * @returns {Object} new state with `bounds` populated
 */
function computeBounds(state) {
    if (state === null || state === undefined) {
        throw new TypeError('computeBounds: state must be an object');
    }
    var input = state.input;
    if (!isPlainObject(input)) {
        throw new TypeError('computeBounds: state.input must be a plain object');
    }

    var rows = Array.isArray(state.rows) ? state.rows : [];
    var classes = Array.isArray(state.classes) ? state.classes : [];
    var classByProctorKey = isPlainObject(state.classByProctorKey)
        || (state.classByProctorKey !== null
            && typeof state.classByProctorKey === 'object'
            && !Array.isArray(state.classByProctorKey))
        ? state.classByProctorKey
        : {};
    var dutyData = isPlainObject(state.normalizedDutyData) ? state.normalizedDutyData : {};

    // Compute the three scalar inputs for global bounds.
    var G = computeGTotalSlots(rows);
    var D = readDExpected(input);
    var N = readNEligible(input.proctorsList);

    var globals = computeGlobalBounds(G, D, N);

    // Compute per-class duty and slot tallies, then per-class bounds.
    var dutyByClass = computeDutyByClass(dutyData, classByProctorKey);
    var slotsByClass = computeSlotsByClass(classes, rows);
    var classBounds = computeClassBounds(
        classes,
        globals.globalLowerBound,
        globals.globalUpperBound,
        dutyByClass,
        slotsByClass
    );

    // Shallow-copy the incoming state and overlay this phase's outputs.
    var nextState = {};
    var stateKeys = Object.keys(state);
    for (var sk = 0; sk < stateKeys.length; sk += 1) {
        nextState[stateKeys[sk]] = state[stateKeys[sk]];
    }
    nextState.bounds = {
        global: {
            lower: globals.globalLowerBound,
            upper: globals.globalUpperBound,
            gTotalSlots: G,
            dExpected: D,
            nEligible: N
        },
        byClass: classBounds.byClass,
        list: classBounds.list
    };

    // Surface scalar bounds at the top level of state so the diagnostics
    // builder (which reads `state.globalLowerBound` / `state.globalUpperBound`
    // / `state.classBoundsByProctorKey`) reflects the computed values rather
    // than defaulting to 0. The per-proctor class bounds map keys each
    // canonical proctor key to its class bound record (AC 5.14).
    nextState.globalLowerBound = globals.globalLowerBound;
    nextState.globalUpperBound = globals.globalUpperBound;
    nextState.classBoundsByProctorKey = buildClassBoundsByProctorKey(
        classByProctorKey,
        classBounds.byClass
    );

    return nextState;
}

module.exports = {
    computeBounds: computeBounds,
    // Exposed for white-box testing only.
    _internals: {
        computeGTotalSlots: computeGTotalSlots,
        readDExpected: readDExpected,
        readNEligible: readNEligible,
        computeDutyByClass: computeDutyByClass,
        computeSlotsByClass: computeSlotsByClass
    }
};
