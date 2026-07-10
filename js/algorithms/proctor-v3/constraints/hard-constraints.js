// Proctor Distribution V3 — Hard-Constraint Predicates (Phase 4 building blocks).
//
// This module is a **pure, stateless library of "would-X" predicates**: each
// predicate answers a single yes/no question about whether assigning a given
// proctor to a given slot/session/halfday would violate a specific hard
// constraint. The CP solver in Phase 4 (Task 14) and the repair phases
// (Tasks 15, 17, 18, 19) compose these predicates to build feasibility
// checks.
//
// Every function in this module is:
//   - pure (no module-level mutable state, no I/O)
//   - defensive (returns a sensible default for malformed inputs)
//   - cheap (O(1) per call after the supporting state is built)
//
// ---------------------------------------------------------------------------
// What this module covers (Acceptance Criteria from requirements.md §3)
// ---------------------------------------------------------------------------
//
//   isExempt(proctor, idx, sessionKey, exemptionsData)         → AC 3.2  (C-EXEMPT)
//   isOnDuty(proctor, idx, halfdayKey, dutyData)               → AC 3.3  (C-DUTY)
//   isMEBlocked(proctor, idx, halfdayKey, meAssignments)       → AC 3.4  (C-ME)
//   wouldDoubleBookSession(loadState, key, sessionKey)         → AC 3.5/3.6 (C-NO-DOUBLE)
//   wouldViolateSameDay(loadState, key, halfdayKey, allowSameDay) → AC 3.7/3.7a/3.8 (C-NO-SAME-DAY)
//   wouldExceedClassUpper(loadState, key, classBounds, classByProctorKey)
//                                                              → AC 3.10 + 5.1+5.4
//
// ---------------------------------------------------------------------------
// Identity convention (matches canonical-key.js)
// ---------------------------------------------------------------------------
//
// `isExempt`, `isOnDuty`, `isMEBlocked` accept `(proctor, idx)` so that the
// caller does NOT need to compute the canonical key beforehand. They derive
// the canonical key inline via the same rule used everywhere else in V3:
// `cin.trim() || '__idx_' + idx`.
//
// `wouldDoubleBookSession`, `wouldViolateSameDay`, `wouldExceedClassUpper`
// instead take an already-canonical `key` because they operate against the
// LoadState (which is keyed canonically by construction).
//
// The `exemptionsData`, `dutyData`, and `meAssignments` arguments to the
// first three predicates MUST be the **NORMALIZED** (canonical-keyed) maps
// produced by Phase 1 (`state.normalizedExemptionsData`, etc.). Passing the
// raw input maps would produce false negatives because legacy `som`-keyed
// or `idx_N`-keyed entries would never match the canonical lookup key.
//
// ---------------------------------------------------------------------------
// Occupancy tracking (for the "would-*" predicates)
// ---------------------------------------------------------------------------
//
// `wouldDoubleBookSession` and `wouldViolateSameDay` need to know which
// sessions / halfdays / days a proctor has already been assigned to. The
// LoadState produced by Task 8 (`utils/load-state.js`) does NOT itself track
// these sets — it only tracks COUNTS (guardCount, dutyCount, …). To avoid
// touching Task 8, this module reads occupancy info via OPTIONAL Set fields
// hung off each LoadState entry:
//
//   loadState.proctors[key].guardSessions   : Set<sessionKey>
//   loadState.proctors[key].guardHalfdays   : Set<halfdayKey>
//   loadState.proctors[key].reserveSessions : Set<sessionKey>
//   loadState.proctors[key].reserveHalfdays : Set<halfdayKey>
//
// When a predicate is called and the relevant set is absent (e.g. the
// caller has not maintained occupancy yet), the predicate returns `false`
// — i.e. "no evidence of a violation in the supplied state". The caller is
// responsible for calling the helpers below as it incrementally builds the
// solution:
//
//   recordGuardOccupancy(loadState, key, sessionKey, halfdayKey)
//   recordReserveOccupancy(loadState, key, sessionKey, halfdayKey)
//   clearGuardOccupancy(loadState, key, sessionKey, halfdayKey)
//
// These helpers are the bridge between Task 8 (counts) and Task 9
// (predicates). Phase 4 (Task 14) will call them as it places guards.
//
// ---------------------------------------------------------------------------
// V2 pitfalls deliberately avoided
// ---------------------------------------------------------------------------
//
//   1. V2 mixed key shapes inside its predicates (sometimes asking
//      `dutyData[som]`, sometimes `dutyData[cin]`). V3's predicates ALWAYS
//      look up by canonical key only — the caller must pass NORMALIZED maps
//      from Phase 1.
//
//   2. V2's "double-book" check looked only at the current row's
//      `proctor_keys`, missing cross-room collisions in the same session
//      (AC 3.6). V3's `wouldDoubleBookSession` consults a session-level
//      occupancy set so the constraint is enforced across all rows of a
//      session.
//
//   3. V2 omitted the duty count from the upper-bound check, asking only
//      `Guard_Count(T) >= upper`. V3 uses Primary_Load = Guard_Count +
//      Duty_Count (AC 5.1) so a heavily-mandated proctor will not be
//      assigned guard duty that would carry them past the class upper bound.
//
//   4. V2 treated the same-day-allowance flag inconsistently between guards
//      and reserves. V3's `wouldViolateSameDay` is symmetric in both roles
//      via the `reserveHalfdays` set (AC 3.7a).

'use strict';
var path = require('path');
var _canonicalKeyModule = require(path.join(__dirname, '..', 'canonical-key.js'));
var canonicalProctorKey = _canonicalKeyModule.canonicalProctorKey;


// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
 * Compute the canonical proctor key from `(proctor, idx)`. Mirrors
 * `canonicalProctorKey` from canonical-key.js but is duplicated here to
 * keep this module self-contained and avoid a hot-path require cycle.
 *
 * @param {object} proctor
 * @param {number} idx
 * @returns {string}
 */
function canonicalKeyOf(proctor, idx) {
    // SSOT: js/algorithms/proctor-v3/canonical-key.js
    return canonicalProctorKey(proctor, idx);
}

/**
 * Halfday → day extractor. The Halfday_Key format documented in the
 * requirements glossary is `${YYYY-MM-DD}|${period}`. We split on the
 * pipe character and return the prefix. When the key has no pipe (legacy
 * shapes), the whole string is treated as the day.
 *
 * @param {string} halfdayKey
 * @returns {string} day key (the YYYY-MM-DD prefix)
 */
function dayKeyFromHalfdayKey(halfdayKey) {
    if (typeof halfdayKey !== 'string') return '';
    var pipeIdx = halfdayKey.indexOf('|');
    if (pipeIdx === -1) return halfdayKey;
    return halfdayKey.slice(0, pipeIdx);
}

/**
 * Look up the LoadState entry for `key`, returning `null` if absent or
 * if the LoadState shape is malformed.
 *
 * @param {object} loadState
 * @param {string} key
 * @returns {object|null}
 */
function entryFor(loadState, key) {
    if (!isPlainObject(loadState)) return null;
    if (!isPlainObject(loadState.proctors)) return null;
    if (typeof key !== 'string' || key.length === 0) return null;
    var entry = loadState.proctors[key];
    return isPlainObject(entry) ? entry : null;
}

// ---------------------------------------------------------------------------
// Predicates: input-data-driven (read from normalized phase-1 maps)
// ---------------------------------------------------------------------------

/**
 * C-EXEMPT (AC 3.2): is the proctor exempt from the given session?
 *
 * A proctor is exempt iff `exemptionsData[sessionKey][canonicalKey]` is
 * present (any value — typically the marker string 'no'). This matches V2
 * semantics: presence of the key under the session entry encodes the
 * exemption, regardless of the stored value.
 *
 * @param {object}  proctor          - proctor record from proctorsList
 * @param {number}  idx              - 0-based index of this proctor in proctorsList
 * @param {string}  sessionKey
 * @param {object}  exemptionsData   - NORMALIZED exemptions map from Phase 1
 * @returns {boolean}
 */
function isExempt(proctor, idx, sessionKey, exemptionsData) {
    if (!isPlainObject(exemptionsData)) return false;
    if (typeof sessionKey !== 'string' || sessionKey.length === 0) return false;
    var inner = exemptionsData[sessionKey];
    if (!isPlainObject(inner)) return false;
    var canonical = canonicalKeyOf(proctor, idx);
    return Object.prototype.hasOwnProperty.call(inner, canonical);
}

/**
 * C-DUTY (AC 3.3): is the proctor on duty in the given halfday?
 *
 * A proctor on duty for a halfday cannot guard ANY room in any session of
 * that halfday — the role is mutually exclusive. Detected via presence of
 * `dutyData[halfdayKey][canonicalKey]`.
 *
 * @param {object}  proctor
 * @param {number}  idx
 * @param {string}  halfdayKey
 * @param {object}  dutyData         - NORMALIZED duty map from Phase 1
 * @returns {boolean}
 */
function isOnDuty(proctor, idx, halfdayKey, dutyData) {
    if (!isPlainObject(dutyData)) return false;
    if (typeof halfdayKey !== 'string' || halfdayKey.length === 0) return false;
    var inner = dutyData[halfdayKey];
    if (!isPlainObject(inner)) return false;
    var canonical = canonicalKeyOf(proctor, idx);
    return Object.prototype.hasOwnProperty.call(inner, canonical);
}

/**
 * C-ME (AC 3.4): is the proctor blocked from the given halfday by a
 * Manual_Exemption assignment?
 *
 * Semantic: a proctor with a Manual_Exemption is PINNED to a specific
 * halfday/group identifier (the OUTER key of `meAssignments`). They cannot
 * serve any role in a halfday that differs from their pinned identifier.
 *
 *   not in any ME group         → not blocked anywhere       → return false
 *   in ME group equal to halfday→ allowed in this halfday    → return false
 *   in ME group ≠ halfday       → blocked from this halfday  → return true
 *
 * If a proctor appears in multiple ME groups, ANY mismatch with the target
 * halfday produces a block. (This matches the design intent: pinning is
 * exclusive.)
 *
 * @param {object}  proctor
 * @param {number}  idx
 * @param {string}  halfdayKey
 * @param {object}  meAssignments    - NORMALIZED ME map from Phase 1
 * @returns {boolean}
 */
function isMEBlocked(proctor, idx, halfdayKey, meAssignments) {
    if (!isPlainObject(meAssignments)) return false;
    var canonical = canonicalKeyOf(proctor, idx);
    var groupIds = Object.keys(meAssignments);

    var inAnyGroup = false;
    var allowed = false;
    for (var i = 0; i < groupIds.length; i += 1) {
        var gid = groupIds[i];
        var inner = meAssignments[gid];
        if (!isPlainObject(inner)) continue;
        if (!Object.prototype.hasOwnProperty.call(inner, canonical)) continue;
        inAnyGroup = true;
        if (gid === halfdayKey) {
            allowed = true;
        }
    }
    return inAnyGroup && !allowed;
}

// ---------------------------------------------------------------------------
// Predicates: load-state-driven (read occupancy sets)
// ---------------------------------------------------------------------------

/**
 * C-NO-DOUBLE (AC 3.5 + 3.6): would assigning `key` to `sessionKey` cause
 * the proctor to occupy two slots within the same session?
 *
 * A "session" here is a `Schedule_Entry × time` instance — across all rooms
 * of that session, each canonical key may appear at most once across the
 * UNION of guards and reserves. The predicate consults the per-proctor
 * `guardSessions` and `reserveSessions` sets stored on the LoadState entry
 * (see module-level note on occupancy tracking).
 *
 * Returns `false` (no violation) when the LoadState entry, the sets, or
 * the session key is missing — the caller has not yet recorded any
 * occupancy for this proctor against this session.
 *
 * @param {object} loadState
 * @param {string} key                 - canonical proctor key
 * @param {string} sessionKey
 * @returns {boolean}
 */
function wouldDoubleBookSession(loadState, key, sessionKey) {
    if (typeof sessionKey !== 'string' || sessionKey.length === 0) return false;
    var entry = entryFor(loadState, key);
    if (!entry) return false;
    if (entry.guardSessions instanceof Set && entry.guardSessions.has(sessionKey)) {
        return true;
    }
    if (entry.reserveSessions instanceof Set && entry.reserveSessions.has(sessionKey)) {
        return true;
    }
    return false;
}

/**
 * C-NO-SAME-DAY (AC 3.7 + 3.7a + 3.8): would assigning `key` to
 * `halfdayKey` cause the proctor to be active in two different halfdays of
 * the same day?
 *
 * When `allowSameDay === true` (the relaxed mode triggered by the
 * Same_Day_Allowance_Flag), this predicate ALWAYS returns `false` — the
 * constraint is suspended. Otherwise the predicate inspects
 * `entry.guardHalfdays` and `entry.reserveHalfdays` for any halfday whose
 * day matches the requested halfday's day BUT whose halfday key differs.
 *
 * The day prefix is extracted via `dayKeyFromHalfdayKey` (split on '|').
 * This matches the documented Halfday_Key format `${YYYY-MM-DD}|${period}`.
 *
 * Returns `false` when the LoadState entry or sets are missing.
 *
 * @param {object}  loadState
 * @param {string}  key
 * @param {string}  halfdayKey
 * @param {boolean} allowSameDay
 * @returns {boolean}
 */
function wouldViolateSameDay(loadState, key, halfdayKey, allowSameDay) {
    if (allowSameDay === true) return false;
    if (typeof halfdayKey !== 'string' || halfdayKey.length === 0) return false;
    var entry = entryFor(loadState, key);
    if (!entry) return false;

    var targetDay = dayKeyFromHalfdayKey(halfdayKey);

    function setHasOtherHalfdayOnSameDay(setObj) {
        if (!(setObj instanceof Set)) return false;
        var iter = setObj.values();
        var step = iter.next();
        while (!step.done) {
            var existing = step.value;
            if (existing !== halfdayKey
                && dayKeyFromHalfdayKey(existing) === targetDay) {
                return true;
            }
            step = iter.next();
        }
        return false;
    }

    if (setHasOtherHalfdayOnSameDay(entry.guardHalfdays)) return true;
    if (setHasOtherHalfdayOnSameDay(entry.reserveHalfdays)) return true;
    return false;
}

/**
 * Class-upper-bound check (AC 3.10 + 5.1 + 5.4): would incrementing
 * `Guard_Count(key)` by 1 push the proctor's Primary_Load past their
 * Class_Upper_Bound?
 *
 * Primary_Load is the V3 fairness axis (AC 5.1), defined as
 * `Guard_Count(T) + Duty_Count(T)`. Because Duty_Count is fixed before
 * Phase 4 begins, the effective per-class upper bound on Guard_Count for
 * proctor T is:
 *
 *     remaining_capacity(T) = Class_Upper_Bound(class(T)) - Duty_Count(T)
 *
 * The predicate returns true iff `Guard_Count + 1 + Duty_Count > upper`,
 * i.e. iff `Primary_Load + 1 > upper` AFTER the candidate assignment.
 *
 * Edge cases (return false — the candidate assignment is allowed):
 *   - LoadState entry missing                      → no recorded load, no overflow
 *   - classByProctorKey missing the canonical key  → no class data, allow
 *   - classBounds missing the classId              → no bound configured, allow
 *   - classBounds entry has non-numeric upper      → allow (defensive)
 *
 * Edge case (return true even when load is at zero): if the proctor's
 * `dutyCount` ALREADY equals or exceeds the class upper bound, ANY guard
 * assignment would tip them over — matching AC 5.9 ("WHEN a proctor T has
 * Duty_Count(T) ≥ Class_Upper_Bound(c), the System SHALL NOT assign T to
 * any Guard_Slot").
 *
 * `classBounds` is expected to be the `byClass` sub-object produced by
 * `constraints/bounds.js#computeClassBounds` — i.e. an object keyed by
 * classId with at least an `upper: number` field per entry.
 *
 * @param {object} loadState
 * @param {string} key                       - canonical proctor key
 * @param {object} classBounds               - { [classId]: { upper, ... } }
 * @param {object} classByProctorKey         - { [canonicalKey]: classId }
 * @returns {boolean}  true iff the assignment would exceed the class upper
 */
function wouldExceedClassUpper(loadState, key, classBounds, classByProctorKey) {
    if (!isPlainObject(classBounds)) return false;
    if (!isPlainObject(classByProctorKey)) return false;
    if (typeof key !== 'string' || key.length === 0) return false;

    var classId = classByProctorKey[key];
    if (typeof classId !== 'string' || classId.length === 0) return false;

    var bound = classBounds[classId];
    if (!isPlainObject(bound)) return false;
    var upper = bound.upper;
    if (typeof upper !== 'number' || !Number.isFinite(upper)) return false;

    var entry = entryFor(loadState, key);
    var guardCount = entry ? (entry.guardCount || 0) : 0;
    var dutyCount = entry ? (entry.dutyCount || 0) : 0;

    // Primary_Load AFTER the hypothetical guard increment.
    var newPrimaryLoad = guardCount + 1 + dutyCount;
    return newPrimaryLoad > upper;
}

// ---------------------------------------------------------------------------
// Occupancy-tracking helpers
// ---------------------------------------------------------------------------
//
// These are NOT predicates; they are tiny mutators that maintain the Set
// fields the predicates above consult. They live in this module (not
// load-state.js) because they exist solely to support the predicates and
// the spec assigns Task 8 (load-state) and Task 9 (predicates) to separate
// authors. Phase 4 (Task 14) and Phase 9 (Task 19) call these helpers as
// they place guards / reserves.
//
// All four helpers are idempotent: recording the same triple twice is a
// no-op; clearing a non-recorded triple is a no-op.

function ensureEntry(loadState, key) {
    if (!isPlainObject(loadState)) {
        throw new TypeError('hard-constraints: loadState must be an object');
    }
    if (!isPlainObject(loadState.proctors)) {
        throw new TypeError('hard-constraints: loadState.proctors must be an object');
    }
    if (typeof key !== 'string' || key.length === 0) {
        throw new TypeError('hard-constraints: key must be a non-empty string');
    }
    var entry = loadState.proctors[key];
    if (!entry) {
        entry = {
            guardCount: 0,
            dutyCount: 0,
            reserveCount: 0,
            amCount: 0,
            pmCount: 0
        };
        loadState.proctors[key] = entry;
    }
    return entry;
}

/**
 * Mark that `key` now occupies `(sessionKey, halfdayKey)` as a GUARD.
 * Lazily creates the supporting Set fields. Safe to call repeatedly with
 * the same triple.
 *
 * @param {object} loadState
 * @param {string} key
 * @param {string} sessionKey   - may be empty/undefined; skipped if so
 * @param {string} halfdayKey   - may be empty/undefined; skipped if so
 */
function recordGuardOccupancy(loadState, key, sessionKey, halfdayKey) {
    var entry = ensureEntry(loadState, key);
    if (typeof sessionKey === 'string' && sessionKey.length > 0) {
        if (!(entry.guardSessions instanceof Set)) entry.guardSessions = new Set();
        entry.guardSessions.add(sessionKey);
    }
    if (typeof halfdayKey === 'string' && halfdayKey.length > 0) {
        if (!(entry.guardHalfdays instanceof Set)) entry.guardHalfdays = new Set();
        entry.guardHalfdays.add(halfdayKey);
    }
}

/**
 * Mark that `key` now occupies `(sessionKey, halfdayKey)` as a RESERVE.
 * Lazily creates the supporting Set fields. Safe to call repeatedly.
 *
 * @param {object} loadState
 * @param {string} key
 * @param {string} sessionKey
 * @param {string} halfdayKey
 */
function recordReserveOccupancy(loadState, key, sessionKey, halfdayKey) {
    var entry = ensureEntry(loadState, key);
    if (typeof sessionKey === 'string' && sessionKey.length > 0) {
        if (!(entry.reserveSessions instanceof Set)) entry.reserveSessions = new Set();
        entry.reserveSessions.add(sessionKey);
    }
    if (typeof halfdayKey === 'string' && halfdayKey.length > 0) {
        if (!(entry.reserveHalfdays instanceof Set)) entry.reserveHalfdays = new Set();
        entry.reserveHalfdays.add(halfdayKey);
    }
}

/**
 * Remove a guard occupancy record (used by repair phases to undo a
 * tentative assignment). Idempotent — silently does nothing if the triple
 * was not previously recorded.
 *
 * @param {object} loadState
 * @param {string} key
 * @param {string} sessionKey
 * @param {string} halfdayKey
 */
function clearGuardOccupancy(loadState, key, sessionKey, halfdayKey) {
    var entry = entryFor(loadState, key);
    if (!entry) return;
    if (entry.guardSessions instanceof Set
        && typeof sessionKey === 'string'
        && sessionKey.length > 0) {
        entry.guardSessions.delete(sessionKey);
    }
    if (entry.guardHalfdays instanceof Set
        && typeof halfdayKey === 'string'
        && halfdayKey.length > 0) {
        entry.guardHalfdays.delete(halfdayKey);
    }
}

/**
 * Remove a reserve occupancy record. Idempotent.
 *
 * @param {object} loadState
 * @param {string} key
 * @param {string} sessionKey
 * @param {string} halfdayKey
 */
function clearReserveOccupancy(loadState, key, sessionKey, halfdayKey) {
    var entry = entryFor(loadState, key);
    if (!entry) return;
    if (entry.reserveSessions instanceof Set
        && typeof sessionKey === 'string'
        && sessionKey.length > 0) {
        entry.reserveSessions.delete(sessionKey);
    }
    if (entry.reserveHalfdays instanceof Set
        && typeof halfdayKey === 'string'
        && halfdayKey.length > 0) {
        entry.reserveHalfdays.delete(halfdayKey);
    }
}

module.exports = {
    // Hard-constraint predicates.
    isExempt: isExempt,
    isOnDuty: isOnDuty,
    isMEBlocked: isMEBlocked,
    wouldDoubleBookSession: wouldDoubleBookSession,
    wouldViolateSameDay: wouldViolateSameDay,
    wouldExceedClassUpper: wouldExceedClassUpper,

    // Occupancy-tracking helpers (used by Phase 4 / Phase 9).
    recordGuardOccupancy: recordGuardOccupancy,
    recordReserveOccupancy: recordReserveOccupancy,
    clearGuardOccupancy: clearGuardOccupancy,
    clearReserveOccupancy: clearReserveOccupancy,

    // Internal helpers exposed for white-box testing only.
    _internals: {
        canonicalKeyOf: canonicalKeyOf,
        dayKeyFromHalfdayKey: dayKeyFromHalfdayKey,
        isPlainObject: isPlainObject
    }
};
