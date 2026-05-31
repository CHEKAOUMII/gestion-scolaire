// Proctor Distribution V3 — Phase 1: Normalize Keys.
//
// Pure function: takes a `state` object containing the raw `input` (per
// GS3_Input_Contract) and returns a NEW state with the following fields
// populated:
//   - adapter                : Object<externalKey, canonicalKey> built from
//                              `input.proctorsList` via `buildKeyAdapter`
//   - normalizedDutyData     : `input.dutyData` with INNER proctor keys
//                              translated to canonical form
//   - normalizedExemptionsData: same translation for `input.exemptionsData`
//   - normalizedMEAssignments : same translation for `input.meAssignments`
//   - orphanInputKeys        : array of unique structured records
//                              `{ source, externalKey }` for every external
//                              proctor key that could not be resolved
//
// The OUTER keys of dutyData/exemptionsData/meAssignments are halfday /
// session / group identifiers — NOT proctor keys — and are passed through
// verbatim. Only the INNER (per-proctor) keys are translated.
//
// Inner values (e.g. `'no'` for exemptions, `true` for duty/ME) are
// preserved verbatim. When two external keys translate to the same
// canonical key inside the same outer entry, the values are merged with
// the latter winning (deterministic by sorted external-key iteration).
//
// Acceptance Criteria covered:
//   - 2.3 : Single Key_Adapter at the boundary translates external keys.
//   - 2.4 : Unresolvable keys are dropped AND recorded.
//   - 2.7 : Same proctor uses identical canonical key across all sources.
//
// Purity contract:
//   - `state.input` is NOT mutated.
//   - The returned state is a fresh object; only fields owned by this
//     phase are added/overwritten. All other fields are shallow-copied
//     from the input state.

'use strict';

var path = require('path');
var canonicalKeyModule = require(path.join(__dirname, '..', 'canonical-key.js'));
var buildKeyAdapter = canonicalKeyModule.buildKeyAdapter;
var toCanonical = canonicalKeyModule.toCanonical;

/**
 * Translate the inner proctor-keyed object of a single outer entry.
 *
 * @param {Object} innerObj         - inner map { proctorKey: value, ... }
 * @param {Object} adapter          - key adapter from `buildKeyAdapter`
 * @param {string} source           - 'dutyData' | 'exemptionsData' | 'meAssignments'
 * @param {Array}  orphanCollector  - mutable array; orphan records pushed here
 * @returns {Object} new inner map keyed by canonical proctor keys
 */
function translateInner(innerObj, adapter, source, orphanCollector) {
    var out = {};
    if (innerObj === null || innerObj === undefined) {
        return out;
    }
    if (typeof innerObj !== 'object' || Array.isArray(innerObj)) {
        return out;
    }
    // Deterministic iteration order — sort external keys before lookup.
    var externalKeys = Object.keys(innerObj).sort();
    for (var i = 0; i < externalKeys.length; i += 1) {
        var ext = externalKeys[i];
        var value = innerObj[ext];
        var canonical = toCanonical(adapter, ext);
        if (canonical === null) {
            orphanCollector.push({ source: source, externalKey: ext });
            continue;
        }
        // Preserve the value verbatim. Last-wins on canonical-key collisions.
        out[canonical] = value;
    }
    return out;
}

/**
 * Translate the outer object whose VALUES are inner proctor-keyed maps.
 * Outer keys (halfday / session / group identifiers) pass through verbatim.
 *
 * @param {Object} outerObj
 * @param {Object} adapter
 * @param {string} source
 * @param {Array}  orphanCollector
 * @returns {Object} new outer object with same outer keys, translated inners
 */
function translateOuter(outerObj, adapter, source, orphanCollector) {
    var out = {};
    if (outerObj === null || outerObj === undefined) {
        return out;
    }
    if (typeof outerObj !== 'object' || Array.isArray(outerObj)) {
        return out;
    }
    var outerKeys = Object.keys(outerObj).sort();
    for (var i = 0; i < outerKeys.length; i += 1) {
        var k = outerKeys[i];
        var inner = outerObj[k];
        out[k] = translateInner(inner, adapter, source, orphanCollector);
    }
    return out;
}

/**
 * Deduplicate orphan records on (source, externalKey). Order is preserved
 * by first appearance.
 *
 * @param {Array<{source:string, externalKey:string}>} records
 * @returns {Array<{source:string, externalKey:string}>}
 */
function dedupeOrphans(records) {
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < records.length; i += 1) {
        var r = records[i];
        var fingerprint = r.source + '\u0000' + r.externalKey;
        if (seen[fingerprint]) continue;
        seen[fingerprint] = true;
        out.push({ source: r.source, externalKey: r.externalKey });
    }
    return out;
}

/**
 * Phase 1 entry point.
 *
 * @param {Object} state - pipeline state; must contain `state.input`
 * @returns {Object} new state with normalization fields populated
 */
function normalizeKeys(state) {
    if (state === null || state === undefined) {
        throw new TypeError('normalizeKeys: state must be an object');
    }
    var input = state.input;
    if (input === null || input === undefined || typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError('normalizeKeys: state.input must be a plain object');
    }

    var proctorsList = Array.isArray(input.proctorsList) ? input.proctorsList : [];
    var adapter = buildKeyAdapter(proctorsList);

    var orphanCollector = [];

    var normalizedDutyData = translateOuter(
        input.dutyData,
        adapter,
        'dutyData',
        orphanCollector
    );
    var normalizedExemptionsData = translateOuter(
        input.exemptionsData,
        adapter,
        'exemptionsData',
        orphanCollector
    );
    var normalizedMEAssignments = translateOuter(
        input.meAssignments,
        adapter,
        'meAssignments',
        orphanCollector
    );

    var orphanInputKeys = dedupeOrphans(orphanCollector);

    // Shallow-copy the incoming state and overlay this phase's outputs.
    var nextState = {};
    var stateKeys = Object.keys(state);
    for (var i = 0; i < stateKeys.length; i += 1) {
        nextState[stateKeys[i]] = state[stateKeys[i]];
    }
    nextState.adapter = adapter;
    nextState.normalizedDutyData = normalizedDutyData;
    nextState.normalizedExemptionsData = normalizedExemptionsData;
    nextState.normalizedMEAssignments = normalizedMEAssignments;
    nextState.orphanInputKeys = orphanInputKeys;

    return nextState;
}

module.exports = { normalizeKeys };
