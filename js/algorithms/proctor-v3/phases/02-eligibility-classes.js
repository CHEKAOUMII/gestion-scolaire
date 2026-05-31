// Proctor Distribution V3 — Phase 2: Eligibility Class Derivation.
//
// Pure function: takes a `state` already populated by Phase 1 (key
// normalization) and Phase 1b (rooms/rows materialization), and returns a
// NEW state with two additional fields populated:
//
//   - classes              : array of EligibilityClass objects, one per
//                            distinct eligibility tuple in the input.
//                            Each class has the shape:
//                              { classId, hash, proctorKeys, eligibleSessions,
//                                dutyHalfdays, meGroup, size }
//                            classes[] is sorted by hash (deterministic).
//
//   - classByProctorKey    : plain object mapping every canonical proctor
//                            key to the classId of the class it belongs to.
//
// An "eligibility tuple" for a proctor T is the triple:
//
//   ( eligibleSessions(T) , dutyHalfdays(T) , meGroup(T) )
//
// where:
//   - eligibleSessions(T) = set of session_keys in state.rows where T is NOT
//                           exempt (per state.normalizedExemptionsData).
//                           Duty/ME considerations belong to other axes of
//                           the tuple — they are NOT subtracted here.
//                           The session_key set is deduplicated (rows with
//                           the same session_key but different rooms map to
//                           the same session).
//   - dutyHalfdays(T)     = set of halfday_keys where T is on duty
//                           (per state.normalizedDutyData).
//   - meGroup(T)          = the ME group identifier (outer key in
//                           state.normalizedMEAssignments) that contains T,
//                           or null if T is not in any ME group.
//                           If T is in multiple groups, pick the first by
//                           sorted-string order (deterministic).
//
// Two proctors land in the same class iff their tuples are byte-equal,
// computed via a stable hash of the form:
//
//   sortedSessions.join('||') + '##' + sortedHalfdays.join('||') + '##' + (meGroup || '')
//
// classId values are deterministic: classes are sorted by hash, then assigned
// 'class_000', 'class_001', ... in order. This guarantees that re-running
// Phase 2 on the same input always produces the same id-to-tuple mapping.
//
// Acceptance Criteria covered:
//   - 5.3 : Class_Lower_Bound(c) ≤ Global_Upper_Bound (consumed by Phase 3;
//           this phase produces the class partition Phase 3 needs).
//   - 5.4 : Class_Upper_Bound(c) ≤ Global_Upper_Bound + 1 (same).
//   - 5.5 : Monotonicity guard for small-total classes (consumed by Phase 3;
//           depends on this phase's class.size and class membership).
//
// Purity contract:
//   - state.input is NOT mutated.
//   - state.rows / state.normalizedDutyData / state.normalizedExemptionsData
//     / state.normalizedMEAssignments are READ but never mutated.
//   - The returned state is a fresh object; only `classes` and
//     `classByProctorKey` are added/overwritten. All other fields are
//     shallow-copied from the input state.

'use strict';

var path = require('path');
var canonicalKeyModule = require(path.join(__dirname, '..', 'canonical-key.js'));
var canonicalProctorKey = canonicalKeyModule.canonicalProctorKey;

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
 * Collect the set of distinct session_keys present in state.rows. Order is
 * not significant here because callers always sort before consumption.
 * @param {Array} rows
 * @returns {Array<string>} array of distinct session_key strings
 */
function collectDistinctSessionKeys(rows) {
    if (!Array.isArray(rows)) return [];
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < rows.length; i += 1) {
        var r = rows[i];
        if (!r || typeof r !== 'object') continue;
        var key = r.session_key;
        if (typeof key !== 'string' || key.length === 0) continue;
        if (seen[key]) continue;
        seen[key] = true;
        out.push(key);
    }
    return out;
}

/**
 * Collect the set of distinct halfday_keys present in state.rows. Used as
 * a defensive sanity check / superset for duty halfday membership lookups.
 * Currently we don't restrict dutyHalfdays(T) to those that appear in rows
 * — the spec says "halfdays where the proctor IS on duty per
 * normalizedDutyData" — so this helper is exported but not used inside
 * derivation. It remains available for future phases.
 * @param {Array} rows
 * @returns {Array<string>}
 */
// (intentionally no longer used; kept as a comment for future readers)

/**
 * Build the set of halfday_keys (outer keys of normalizedDutyData) that
 * contain a duty entry for the given canonical proctor key.
 *
 * @param {Object} normalizedDutyData
 * @param {string} canonicalKey
 * @returns {Array<string>} unsorted array of halfday keys
 */
function dutyHalfdaysForProctor(normalizedDutyData, canonicalKey) {
    var out = [];
    if (!isPlainObject(normalizedDutyData)) return out;
    var halfdays = Object.keys(normalizedDutyData);
    for (var i = 0; i < halfdays.length; i += 1) {
        var h = halfdays[i];
        var inner = normalizedDutyData[h];
        if (!isPlainObject(inner)) continue;
        // Defensive: presence of the canonical key under this halfday means
        // the proctor is on duty. We do NOT inspect the value (any truthy
        // marker, or even a falsy one written explicitly, is treated as a
        // duty entry — matching V2 behavior).
        if (Object.prototype.hasOwnProperty.call(inner, canonicalKey)) {
            out.push(h);
        }
    }
    return out;
}

/**
 * Determine whether a proctor is exempt for a given session_key per
 * normalizedExemptionsData. A proctor is exempt iff there is an entry under
 * exemptionsData[session_key][canonicalKey] (any value present — typically
 * the marker string 'no').
 *
 * @param {Object} normalizedExemptionsData
 * @param {string} sessionKey
 * @param {string} canonicalKey
 * @returns {boolean}
 */
function isExemptFromSession(normalizedExemptionsData, sessionKey, canonicalKey) {
    if (!isPlainObject(normalizedExemptionsData)) return false;
    var inner = normalizedExemptionsData[sessionKey];
    if (!isPlainObject(inner)) return false;
    return Object.prototype.hasOwnProperty.call(inner, canonicalKey);
}

/**
 * Compute eligibleSessions(T): the subset of session_keys (drawn from
 * state.rows) where T is NOT exempt. Duty / ME considerations are NOT
 * subtracted here — those are independent axes of the eligibility tuple.
 *
 * @param {Array<string>} allSessionKeys
 * @param {Object} normalizedExemptionsData
 * @param {string} canonicalKey
 * @returns {Array<string>} unsorted array of session keys
 */
function eligibleSessionsForProctor(allSessionKeys, normalizedExemptionsData, canonicalKey) {
    var out = [];
    for (var i = 0; i < allSessionKeys.length; i += 1) {
        var s = allSessionKeys[i];
        if (!isExemptFromSession(normalizedExemptionsData, s, canonicalKey)) {
            out.push(s);
        }
    }
    return out;
}

/**
 * Determine the ME group identifier for the given canonical proctor key, or
 * null if the proctor is in no ME group. When in multiple groups, return
 * the first by sorted-string order.
 *
 * @param {Object} normalizedMEAssignments
 * @param {string} canonicalKey
 * @returns {string|null}
 */
function meGroupForProctor(normalizedMEAssignments, canonicalKey) {
    if (!isPlainObject(normalizedMEAssignments)) return null;
    var groupIds = Object.keys(normalizedMEAssignments).sort();
    for (var i = 0; i < groupIds.length; i += 1) {
        var gid = groupIds[i];
        var inner = normalizedMEAssignments[gid];
        if (!isPlainObject(inner)) continue;
        if (Object.prototype.hasOwnProperty.call(inner, canonicalKey)) {
            return gid;
        }
    }
    return null;
}

/**
 * Compute the stable hash for an eligibility tuple. The session and halfday
 * arrays are sorted lexicographically before joining so that two tuples
 * with identical content but different insertion order produce the same
 * hash.
 *
 * @param {Array<string>} sessions
 * @param {Array<string>} halfdays
 * @param {string|null} meGroup
 * @returns {string}
 */
function hashTuple(sessions, halfdays, meGroup) {
    var s = sessions.slice().sort();
    var h = halfdays.slice().sort();
    return s.join('||') + '##' + h.join('||') + '##' + (meGroup || '');
}

/**
 * Pad a non-negative integer with leading zeros to exactly 3 digits.
 * @param {number} n
 * @returns {string}
 */
function pad3(n) {
    if (n < 10) return '00' + n;
    if (n < 100) return '0' + n;
    return String(n);
}

/**
 * Phase 2 entry point.
 *
 * @param {Object} state - pipeline state; must contain `state.input` and
 *                          ideally `state.rows`, `state.normalizedDutyData`,
 *                          `state.normalizedExemptionsData`,
 *                          `state.normalizedMEAssignments`. Missing fields
 *                          are treated as empty (defensive).
 * @returns {Object} new state with `classes` and `classByProctorKey` populated
 */
function deriveEligibilityClasses(state) {
    if (state === null || state === undefined) {
        throw new TypeError('deriveEligibilityClasses: state must be an object');
    }
    var input = state.input;
    if (!isPlainObject(input)) {
        throw new TypeError('deriveEligibilityClasses: state.input must be a plain object');
    }

    var proctorsList = Array.isArray(input.proctorsList) ? input.proctorsList : [];
    var rows = Array.isArray(state.rows) ? state.rows : [];
    var dutyData = isPlainObject(state.normalizedDutyData) ? state.normalizedDutyData : {};
    var exemptionsData = isPlainObject(state.normalizedExemptionsData)
        ? state.normalizedExemptionsData
        : {};
    var meAssignments = isPlainObject(state.normalizedMEAssignments)
        ? state.normalizedMEAssignments
        : {};

    var allSessionKeys = collectDistinctSessionKeys(rows);

    // Group proctors by hash. We retain per-proctor tuple data so we don't
    // recompute it after grouping.
    var groups = Object.create(null); // hash → { hash, sessions, halfdays, meGroup, proctorKeys }
    var perProctorClassByHash = Object.create(null); // canonicalKey → hash

    for (var i = 0; i < proctorsList.length; i += 1) {
        var proc = proctorsList[i];
        var canonical = canonicalProctorKey(proc, i);

        var sessions = eligibleSessionsForProctor(
            allSessionKeys,
            exemptionsData,
            canonical
        );
        var halfdays = dutyHalfdaysForProctor(dutyData, canonical);
        var meGroup = meGroupForProctor(meAssignments, canonical);

        var hash = hashTuple(sessions, halfdays, meGroup);

        if (!groups[hash]) {
            // Store SORTED arrays so downstream consumers (and the class
            // record) see deterministic ordering, matching the hash basis.
            groups[hash] = {
                hash: hash,
                eligibleSessions: sessions.slice().sort(),
                dutyHalfdays: halfdays.slice().sort(),
                meGroup: meGroup,
                proctorKeys: []
            };
        }
        groups[hash].proctorKeys.push(canonical);
        perProctorClassByHash[canonical] = hash;
    }

    // Assign deterministic classIds: sort by hash, then map to class_000…
    var sortedHashes = Object.keys(groups).sort();
    var classes = [];
    var classIdByHash = Object.create(null);
    for (var h = 0; h < sortedHashes.length; h += 1) {
        var hh = sortedHashes[h];
        var g = groups[hh];
        var classId = 'class_' + pad3(h);
        classIdByHash[hh] = classId;
        // Sort proctorKeys for stability across runs (Object.keys insertion
        // order matches proctorsList order, but we still sort to guarantee
        // a total ordering independent of input shuffling).
        var sortedProctorKeys = g.proctorKeys.slice().sort();
        classes.push({
            classId: classId,
            hash: g.hash,
            proctorKeys: sortedProctorKeys,
            eligibleSessions: g.eligibleSessions,
            dutyHalfdays: g.dutyHalfdays,
            meGroup: g.meGroup,
            size: sortedProctorKeys.length
        });
    }

    var classByProctorKey = Object.create(null);
    var perProctorKeys = Object.keys(perProctorClassByHash);
    for (var p = 0; p < perProctorKeys.length; p += 1) {
        var pk = perProctorKeys[p];
        classByProctorKey[pk] = classIdByHash[perProctorClassByHash[pk]];
    }

    // Shallow-copy the incoming state and overlay this phase's outputs.
    var nextState = {};
    var stateKeys = Object.keys(state);
    for (var k = 0; k < stateKeys.length; k += 1) {
        nextState[stateKeys[k]] = state[stateKeys[k]];
    }
    nextState.classes = classes;
    nextState.classByProctorKey = classByProctorKey;

    return nextState;
}

module.exports = {
    deriveEligibilityClasses,
    // Exposed for white-box testing only.
    _internals: {
        collectDistinctSessionKeys: collectDistinctSessionKeys,
        dutyHalfdaysForProctor: dutyHalfdaysForProctor,
        isExemptFromSession: isExemptFromSession,
        eligibleSessionsForProctor: eligibleSessionsForProctor,
        meGroupForProctor: meGroupForProctor,
        hashTuple: hashTuple
    }
};
