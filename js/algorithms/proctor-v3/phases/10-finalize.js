// Proctor Distribution V3 — Phase 10: Finalize.
//
// The terminal phase of the V3 pipeline. By the time `finalize` is invoked,
// every other phase has run:
//   - Phase 4 placed guards into `state.rows[i].proctor_keys`
//   - Phase 5 repaired coverage holes
//   - Phase 7 enforced strict bimodal Primary_Load
//   - Phase 8 reduced AM/PM imbalance
//   - Phase 9 attached reserve_keys to each row (with fresh array refs)
//
// Phase 10 is responsible for the four "wrap-up" duties enumerated in
// design.md §4 Phase 10:
//
//   1. Tag `softViolations` per row by inspecting the FINAL assignments:
//        - 'subjectConflict'  : any guard's subject matches the row's subject
//        - 'sameRoomRepeat'   : any guard already guarded this room earlier
//        - 'genderImbalance'  : 2+ guards with gender data, all same gender
//        - 'amPmImbalance'    : any guard's final AM_PM_Imbalance ≥ 2
//      Tokens are drawn from the closed set required by AC 13.4.
//
//   2. Build display name arrays (`proctors`, `reserves`) from canonical
//      keys via `js/data/proctor-key-resolver.js`. The arrays are
//      index-aligned with `proctor_keys` and `reserve_keys` respectively
//      (AC 13.2 / 13.3). Null guard slots produce empty-string display
//      names so the array length matches `proctor_keys` exactly.
//
//   3. Verify all row arrays are FRESH (no shared references between
//      rows). This is a defensive runtime assertion of AC 10.2 — every
//      previous phase already builds fresh arrays, but the check here
//      catches any future regression at the boundary.
//
//   4. Build the final `DiagnosticsV3` object (delegated to
//      `diagnostics.buildDiagnostics`, which already covers AC 9.x and
//      verifies JSON-serializability per AC 9.8).
//
// Acceptance Criteria covered:
//   - 6.9  : softViolations tagging enumerates the violations on the row
//   - 6.10 : softViolations populated only as advisory; row keeps valid
//            (non-null) proctor_keys when slots were resolved
//   - 9.1  : returned state contains `result` (= rows) and `diagnostics`
//   - 9.8  : JSON round-trip safety (delegated to buildDiagnostics)
//   - 10.1 : output is JSON-serializable
//   - 10.2 : no shared array references across rows
//   - 13.1 : every row exposes the V2-shape field set
//   - 13.2 : `proctors` aligned with `proctor_keys` index-by-index
//   - 13.3 : `reserves` aligned with `reserve_keys` index-by-index
//   - 13.4 : `softViolations` ⊆ {sameRoomRepeat, subjectConflict,
//                                amPmImbalance, genderImbalance}
//   - 13.5 : Result_Row field types match V2 exactly (string / array)
//
// Purity contract:
//   - state.input is NEVER mutated.
//   - state.rows is REPLACED with a fresh array; every row is shallow-
//     cloned with FRESH `proctors`, `proctor_keys`, `reserves`,
//     `reserve_keys`, `duty_teachers`, and `softViolations` arrays so no
//     two rows share references (AC 10.2 — even when upstream phases
//     somehow violated this invariant, finalize fixes it before the
//     output reaches consumers).
//   - state.diagnostics is rebuilt via `buildDiagnostics`. Existing
//     fields (warnings, errors, unresolvedSlots, …) are preserved through
//     the buildDiagnostics contract, which copies them into fresh arrays.
//   - state.loadState is NOT mutated by Phase 10.

'use strict';

var path = require('path');
var _canonicalKeyModule = require(path.join(__dirname, '..', 'canonical-key.js'));
var canonicalProctorKey = _canonicalKeyModule.canonicalProctorKey;


var diagnosticsModule = require(path.join(__dirname, '..', 'diagnostics.js'));
var resolverModule = require(path.join(
    __dirname, '..', '..', '..', 'data', 'proctor-key-resolver.js'
));

var buildDiagnostics = diagnosticsModule.buildDiagnostics;
var verifyJsonSerializable = diagnosticsModule.verifyJsonSerializable;
var resolveProctorDisplayName = resolverModule.resolveProctorDisplayName;

// AM/PM imbalance threshold for soft-violation tagging. AC 6.5 / Phase 8
// use ≥ 2 as the "needs attention" threshold; we surface that as
// `amPmImbalance` in row.softViolations for any row containing such a
// guard.
var AMPM_IMBALANCE_TAG_THRESHOLD = 2;

// Closed set of soft-violation tokens (AC 13.4). Any token not in this
// set is dropped during tagging.
var ALLOWED_SOFT_VIOLATION_TOKENS = {
    sameRoomRepeat: true,
    subjectConflict: true,
    amPmImbalance: true,
    genderImbalance: true
};

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

function canonicalKeyOf(proctor, idx) {
    // SSOT: js/algorithms/proctor-v3/canonical-key.js
    return canonicalProctorKey(proctor, idx);
}

/**
 * Build canonicalKey → proctor map from `proctorsList`. First-occurrence
 * wins on duplicate canonical keys (matches Phase 9's dedupe semantics).
 *
 * @param {Array} proctorsList
 * @returns {Object<string, object>}
 */
function buildProctorByKey(proctorsList) {
    var byKey = Object.create(null);
    if (!Array.isArray(proctorsList)) return byKey;
    for (var i = 0; i < proctorsList.length; i += 1) {
        var p = proctorsList[i];
        var k = canonicalKeyOf(p, i);
        if (byKey[k]) continue;
        byKey[k] = p;
    }
    return byKey;
}

/**
 * Case-insensitive normalize: trim + lowercase. Returns '' for non-strings
 * so callers can do `aN === bN && aN !== ''` to skip empty matches.
 *
 * @param {*} s
 * @returns {string}
 */
function ciNormalize(s) {
    if (typeof s !== 'string') return '';
    var t = s.trim();
    if (!t) return '';
    return t.toLowerCase();
}

// ---------------------------------------------------------------------------
// Soft-violation tagging
// ---------------------------------------------------------------------------

/**
 * Compute the soft-violation tokens that apply to `row`, given the global
 * context (proctorByKey, ampmImbalanceMap, perProctorRoomCounts). Returns
 * a fresh array, possibly empty, containing only tokens from the allowed
 * set (AC 13.4).
 *
 * Tokens emitted:
 *   - 'subjectConflict' : any guard's `subject` (case-insensitive trimmed)
 *                          matches the row's `subject`.
 *   - 'sameRoomRepeat'  : any guard's count of (this proctor, this room)
 *                          across all rows is ≥ 2.
 *   - 'genderImbalance' : ≥ 2 of the row's guards have non-empty `gender`
 *                          AND all such genders are equal.
 *   - 'amPmImbalance'   : any guard's final AM_PM_Imbalance is ≥
 *                          AMPM_IMBALANCE_TAG_THRESHOLD (2).
 *
 * @param {Object} row
 * @param {Object} ctx
 * @param {Object} ctx.proctorByKey
 * @param {Object} ctx.amPmImbalanceMap          - canonicalKey → number
 * @param {Object} ctx.proctorRoomCounts          - canonicalKey → roomKey → count
 * @returns {string[]}
 */
function computeRowSoftViolations(row, ctx) {
    var tokens = [];
    if (!row || typeof row !== 'object') return tokens;
    var guardKeys = Array.isArray(row.proctor_keys) ? row.proctor_keys : [];
    if (guardKeys.length === 0) return tokens;

    var rowSubjectN = ciNormalize(row.subject);
    var roomKey = (typeof row.room_key === 'string') ? row.room_key : '';

    var sawSubject = false;
    var sawRoomRepeat = false;
    var sawAmpm = false;

    var genders = [];
    var seenAny = Object.create(null); // dedupe per-row checks per proctor

    for (var i = 0; i < guardKeys.length; i += 1) {
        var key = guardKeys[i];
        if (typeof key !== 'string' || key.length === 0) continue;
        // We may legitimately see the same canonical key twice across rows,
        // but within a single row the algorithm guarantees at most one
        // appearance per AC 3.5. Defensive dedupe for safety.
        if (seenAny[key]) continue;
        seenAny[key] = true;

        var proc = ctx.proctorByKey[key];

        // S-OWN-SUBJECT (AC 6.1 / 13.4 token: subjectConflict).
        if (!sawSubject && proc && rowSubjectN
            && ciNormalize(proc.subject) === rowSubjectN) {
            sawSubject = true;
        }

        // S-NO-ROOM-REPEAT (AC 6.7 / 13.4 token: sameRoomRepeat).
        // Count across the whole run; flag if THIS proctor already saw
        // THIS room more than once.
        if (!sawRoomRepeat && roomKey && ctx.proctorRoomCounts[key]
            && (ctx.proctorRoomCounts[key][roomKey] || 0) >= 2) {
            sawRoomRepeat = true;
        }

        // S-AM-PM (AC 6.4 / 13.4 token: amPmImbalance).
        if (!sawAmpm) {
            var imb = ctx.amPmImbalanceMap[key];
            if (typeof imb === 'number' && imb >= AMPM_IMBALANCE_TAG_THRESHOLD) {
                sawAmpm = true;
            }
        }

        // S-GENDER — collect for later aggregate decision.
        if (proc && proc.gender != null && String(proc.gender).length > 0) {
            genders.push(String(proc.gender));
        }
    }

    // S-GENDER (AC 6.8 / 13.4 token: genderImbalance) — ≥ 2 guards with
    // gender data, all the same.
    var sawGender = false;
    if (genders.length >= 2) {
        var first = genders[0];
        var allSame = true;
        for (var g = 1; g < genders.length; g += 1) {
            if (genders[g] !== first) { allSame = false; break; }
        }
        if (allSame) sawGender = true;
    }

    // Emit tokens in the canonical order documented above.
    if (sawSubject && ALLOWED_SOFT_VIOLATION_TOKENS.subjectConflict) {
        tokens.push('subjectConflict');
    }
    if (sawRoomRepeat && ALLOWED_SOFT_VIOLATION_TOKENS.sameRoomRepeat) {
        tokens.push('sameRoomRepeat');
    }
    if (sawGender && ALLOWED_SOFT_VIOLATION_TOKENS.genderImbalance) {
        tokens.push('genderImbalance');
    }
    if (sawAmpm && ALLOWED_SOFT_VIOLATION_TOKENS.amPmImbalance) {
        tokens.push('amPmImbalance');
    }
    return tokens;
}

/**
 * Build a per-(proctor, room) occurrence count from the rows. Used to
 * decide `sameRoomRepeat`: a guard whose (key, roomKey) pair appears
 * ≥ 2 times across the run triggers the tag for any row sharing that
 * room.
 *
 * @param {Array} rows
 * @returns {Object<string, Object<string, number>>}
 */
function buildProctorRoomCounts(rows) {
    var counts = Object.create(null);
    if (!Array.isArray(rows)) return counts;
    for (var i = 0; i < rows.length; i += 1) {
        var r = rows[i];
        if (!r || typeof r !== 'object') continue;
        var roomKey = typeof r.room_key === 'string' ? r.room_key : '';
        if (!roomKey) continue;
        var keys = Array.isArray(r.proctor_keys) ? r.proctor_keys : [];
        for (var j = 0; j < keys.length; j += 1) {
            var k = keys[j];
            if (typeof k !== 'string' || k.length === 0) continue;
            if (!counts[k]) counts[k] = Object.create(null);
            counts[k][roomKey] = (counts[k][roomKey] || 0) + 1;
        }
    }
    return counts;
}

// ---------------------------------------------------------------------------
// Display-name resolution
// ---------------------------------------------------------------------------

/**
 * Resolve display names from canonical keys, preserving array length
 * (null/empty entries map to '') so consumers can rely on
 * `proctors.length === proctor_keys.length` (AC 13.2 / 13.3).
 *
 * @param {Array} keys
 * @param {Array} proctorsList
 * @returns {string[]}
 */
function resolveDisplayNames(keys, proctorsList) {
    var out = [];
    if (!Array.isArray(keys)) return out;
    for (var i = 0; i < keys.length; i += 1) {
        var k = keys[i];
        if (typeof k !== 'string' || k.length === 0) {
            // Null/empty guard slot OR null reserve placeholder. Keep
            // alignment with index by emitting '' rather than skipping.
            out.push('');
            continue;
        }
        var name = resolveProctorDisplayName(k, proctorsList);
        out.push(typeof name === 'string' ? name : '');
    }
    return out;
}

// ---------------------------------------------------------------------------
// AC 10.2 — fresh-array verification
// ---------------------------------------------------------------------------

/**
 * Confirm that NO two rows share the same array reference for any of the
 * V2-shape array fields. Returns null on success or a structured error
 * description on failure (the caller decides whether to record it as a
 * diagnostics error or throw).
 *
 * The check is by reference identity — deep equality is intentionally NOT
 * used because two rows MAY have equal-but-distinct arrays (e.g. two
 * empty `[]`s) without violating AC 10.2.
 *
 * @param {Array} rows
 * @returns {{rowIndex:number, otherRowIndex:number, field:string}|null}
 */
function verifyFreshRowArrays(rows) {
    if (!Array.isArray(rows)) return null;
    var fields = [
        'proctors',
        'proctor_keys',
        'reserves',
        'reserve_keys',
        'duty_teachers',
        'softViolations'
    ];
    var seen = Object.create(null); // key by field, value = Map(arr → rowIndex)
    for (var f = 0; f < fields.length; f += 1) {
        seen[fields[f]] = new Map();
    }
    for (var i = 0; i < rows.length; i += 1) {
        var r = rows[i];
        if (!r || typeof r !== 'object') continue;
        for (var fi = 0; fi < fields.length; fi += 1) {
            var field = fields[fi];
            var arr = r[field];
            if (!Array.isArray(arr)) continue;
            if (seen[field].has(arr)) {
                return {
                    rowIndex: i,
                    otherRowIndex: seen[field].get(arr),
                    field: field
                };
            }
            seen[field].set(arr, i);
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Phase 10 entry point
// ---------------------------------------------------------------------------

/**
 * Run the finalize phase on the supplied state.
 *
 * @param {Object} state - pipeline state populated through Phase 9
 * @returns {Object} new state with rows finalized and diagnostics built
 */
function finalize(state) {
    if (state === null || state === undefined) {
        throw new TypeError('finalize: state must be an object');
    }
    if (!isPlainObject(state.input)) {
        throw new TypeError('finalize: state.input must be a plain object');
    }

    var input = state.input;
    var proctorsList = Array.isArray(input.proctorsList) ? input.proctorsList : [];
    var proctorByKey = buildProctorByKey(proctorsList);

    var inRows = Array.isArray(state.rows) ? state.rows : [];

    // Carry diagnostics forward with FRESH arrays. We hand-build a fresh
    // diagnostics envelope so `buildDiagnostics` (called below) operates
    // on a copy and any errors it emits are merged cleanly.
    var prevDiag = isPlainObject(state.diagnostics) ? state.diagnostics : {};
    var nextDiag = {};
    var dkeys = Object.keys(prevDiag);
    for (var dk = 0; dk < dkeys.length; dk += 1) {
        nextDiag[dkeys[dk]] = prevDiag[dkeys[dk]];
    }
    nextDiag.warnings = Array.isArray(prevDiag.warnings) ? prevDiag.warnings.slice() : [];
    nextDiag.errors = Array.isArray(prevDiag.errors) ? prevDiag.errors.slice() : [];

    // Pull the AM/PM imbalance map already populated by Phase 8 (AC 6.6).
    // Fall back to an empty map when missing (e.g. minimal-input tests).
    var amPmImbalanceMap = isPlainObject(prevDiag.amPmImbalanceByProctorKey)
        ? prevDiag.amPmImbalanceByProctorKey : {};

    // Build per-(proctor, room) counts for sameRoomRepeat tagging.
    var proctorRoomCounts = buildProctorRoomCounts(inRows);

    var ctx = {
        proctorByKey: proctorByKey,
        amPmImbalanceMap: amPmImbalanceMap,
        proctorRoomCounts: proctorRoomCounts
    };

    // Materialize fresh rows: clone each row and replace EVERY array
    // field with a fresh reference (AC 10.2 + 13.1/13.5 shape conformance).
    var newRows = new Array(inRows.length);
    for (var ri = 0; ri < inRows.length; ri += 1) {
        var src = inRows[ri];
        if (!src || typeof src !== 'object') {
            // Defensive: keep array-length parity but emit a dummy row.
            // This branch should never trigger in production; it's here
            // so that Phase 10 doesn't crash on malformed upstream state.
            newRows[ri] = {
                session_key: '',
                halfday_key: '',
                day_key: '',
                room_key: '',
                room_name: '',
                proctor_keys: [],
                proctors: [],
                reserve_keys: [],
                reserves: [],
                duty_teachers: [],
                softViolations: [],
                notes: ''
            };
            continue;
        }

        var clone = shallowCopyRow(src);

        // Fresh array refs. We slice() existing arrays to preserve
        // contents while breaking shared references. proctor_keys
        // includes nulls (placeholder for unresolved slots); we keep
        // them.
        clone.proctor_keys = Array.isArray(src.proctor_keys)
            ? src.proctor_keys.slice() : [];
        clone.reserve_keys = Array.isArray(src.reserve_keys)
            ? src.reserve_keys.slice() : [];
        clone.duty_teachers = Array.isArray(src.duty_teachers)
            ? src.duty_teachers.slice() : [];

        // Display names always re-resolved here so they reflect FINAL
        // canonical-key state (AC 13.2 / 13.3). Length-aligned with
        // the corresponding *_keys array.
        clone.proctors = resolveDisplayNames(clone.proctor_keys, proctorsList);
        clone.reserves = resolveDisplayNames(clone.reserve_keys, proctorsList);

        // Soft-violation tagging on the FINAL row (AC 6.9 / 13.4).
        clone.softViolations = computeRowSoftViolations(clone, ctx);

        // `notes` is part of the V2 shape (AC 13.1) but not driven by
        // V3; preserve whatever was there or default to ''.
        if (typeof clone.notes !== 'string') {
            clone.notes = '';
        }

        newRows[ri] = clone;
    }

    // AC 10.2 — verify NO two rows share an array reference. This is
    // defensive: every phase already builds fresh refs, but we want
    // the regression to surface immediately if it ever happens.
    var sharedRef = verifyFreshRowArrays(newRows);
    if (sharedRef !== null) {
        nextDiag.errors.push({
            type: 'shared_array_reference',
            phase: 'finalize',
            rowIndex: sharedRef.rowIndex,
            otherRowIndex: sharedRef.otherRowIndex,
            field: sharedRef.field,
            message: 'Row ' + sharedRef.rowIndex + ' and row '
                + sharedRef.otherRowIndex + ' share the same `' + sharedRef.field
                + '` array reference (AC 10.2 violation). Phase 10 enforced fresh '
                + 'arrays defensively, so this indicates a bug in Phase 10 itself.'
        });
    }

    // Build the V3 output envelope (used purely for AC 10.1
    // serializability check). We do NOT return this object; the
    // orchestrator wraps the state and emits the envelope at its layer.
    // We DO want to fail loud if the output isn't JSON-serializable.
    var serCheckEnvelope = {
        result: newRows,
        // Skip diagnostics here — buildDiagnostics runs its own JSON
        // check (AC 9.8); we just want to verify the rows themselves.
        algorithmVersion: 'v3'
    };
    var rt = verifyJsonSerializable(serCheckEnvelope);
    if (!rt.ok) {
        nextDiag.errors.push({
            type: 'output_serialization_failure',
            phase: 'finalize',
            message: rt.error || 'Output is not JSON round-trip safe (AC 10.1)'
        });
    }

    // Construct intermediate state for buildDiagnostics. We pass the
    // freshly-finalized rows so histogramByGuardCount / distinctCount
    // reflect the final assignments.
    var intermediateState = shallowCopyState(state);
    intermediateState.rows = newRows;
    intermediateState.diagnostics = nextDiag;

    var finalDiagnostics = buildDiagnostics(intermediateState);

    var ns = shallowCopyState(state);
    ns.rows = newRows;
    ns.diagnostics = finalDiagnostics;
    // Convenience: expose `result` for orchestrators that prefer to
    // read the final array directly off the state.
    ns.result = newRows;

    return ns;
}

module.exports = {
    finalize: finalize,
    _internals: {
        AMPM_IMBALANCE_TAG_THRESHOLD: AMPM_IMBALANCE_TAG_THRESHOLD,
        ALLOWED_SOFT_VIOLATION_TOKENS: ALLOWED_SOFT_VIOLATION_TOKENS,
        computeRowSoftViolations: computeRowSoftViolations,
        buildProctorRoomCounts: buildProctorRoomCounts,
        resolveDisplayNames: resolveDisplayNames,
        verifyFreshRowArrays: verifyFreshRowArrays,
        buildProctorByKey: buildProctorByKey
    }
};
