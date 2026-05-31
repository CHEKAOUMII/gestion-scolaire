// Proctor Distribution V3 — diagnostics aggregation.
//
// Pure helpers that build the DiagnosticsV3 object emitted by the
// orchestrator at the end of Phase 10 (Finalize).
//
// Design reference: design.md §4 Phase 10 ("Diagnostics builder").
// Acceptance Criteria covered:
//   - 5.10 : zeroLoadProctors[] for eligible proctors stuck at Primary_Load = 0.
//   - 6.6  : amPmImbalanceByProctorKey map (canonicalKey → |amCount-pmCount|).
//   - 7.8  : reserveImbalances[] for reserve-fairness deviations.
//   - 9.1  : { result, diagnostics, algorithmVersion: 'v3' } envelope (the
//            consumer; we provide the diagnostics half).
//   - 9.2  : full diagnostics field set (see field list below).
//   - 9.3  : histogramByGuardCount derived strictly from proctor_keys
//            (slot-based, duty NOT included).
//   - 9.3a : histogramByPrimaryLoad derived from Primary_Load
//            (Guard_Count + Duty_Count). This is the histogram the strict
//            bimodal property (AC 5.7) is asserted against.
//   - 9.3b : the existing display layer / V2 callers consume
//            histogramByGuardCount; we keep that semantics intact.
//   - 9.4  : distinctCount across proctor_keys ∪ reserve_keys ∪ duty_teachers.
//   - 9.6  : warnings array preserved verbatim.
//   - 9.7  : errors array preserved verbatim.
//   - 9.8  : the resulting diagnostics object MUST be JSON round-trip safe.
//
// Design pitfall (called out in tasks.md):
//   An earlier draft of design.md emitted only ONE histogram. The schema
//   requires TWO: histogramByGuardCount (display/V2 compat) AND
//   histogramByPrimaryLoad (fairness). Both are computed here.
//
// Purity contract:
//   - The state object passed in is NEVER mutated; every produced field is
//     either a fresh array/object or a primitive copied by value.
//   - Where the orchestrator already populated arrays in `state.diagnostics`
//     (warnings, errors, unresolvedSlots, coverageWarnings, …), we copy
//     them with `.slice()` so the caller may continue to mutate the input
//     diagnostics without affecting the returned object.

'use strict';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    return true;
}

function safeArrayCopy(value) {
    return Array.isArray(value) ? value.slice() : [];
}

function safeObjectCopy(value) {
    if (!isPlainObject(value)) return {};
    var out = {};
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i += 1) {
        out[keys[i]] = value[keys[i]];
    }
    return out;
}

// ---------------------------------------------------------------------------
// Histograms
// ---------------------------------------------------------------------------

/**
 * Slot-based histogram of Guard_Count(T), keyed by integer guard count.
 *
 * Walks every Result_Row in `rows`, increments per-key counters from
 * `proctor_keys` (skipping nulls), then aggregates the per-proctor counters
 * into a `{ guardCount: numProctors }` map.
 *
 * Acceptance Criterion 9.3: duty assignments are NOT included in this
 * histogram — it is strictly slot-based on `proctor_keys`.
 *
 * @param {Array} rows
 * @returns {Object<string, number>} histogram (guardCount → numProctors)
 */
function computeHistogramByGuardCount(rows) {
    var hist = {};
    if (!Array.isArray(rows) || rows.length === 0) return hist;

    var perKey = Object.create(null);
    for (var i = 0; i < rows.length; i += 1) {
        var r = rows[i];
        if (!r || typeof r !== 'object') continue;
        var keys = r.proctor_keys;
        if (!Array.isArray(keys)) continue;
        for (var j = 0; j < keys.length; j += 1) {
            var k = keys[j];
            if (typeof k !== 'string' || k.length === 0) continue;
            perKey[k] = (perKey[k] || 0) + 1;
        }
    }

    var allKeys = Object.keys(perKey);
    for (var p = 0; p < allKeys.length; p += 1) {
        var count = perKey[allKeys[p]];
        var bucket = String(count);
        hist[bucket] = (hist[bucket] || 0) + 1;
    }
    return hist;
}

/**
 * Histogram of Primary_Load(T) = Guard_Count(T) + Duty_Count(T) over every
 * proctor present in `loadState`. When `classByProctorKey` is provided, we
 * only count proctors that carry a class assignment (the eligible set).
 * When omitted, every proctor in `loadState` is counted.
 *
 * Acceptance Criterion 9.3a: this is the histogram the strict bimodal
 * property (AC 5.7) is asserted against.
 *
 * @param {Object} loadState
 * @param {Object} [classByProctorKey] - optional eligibility filter
 * @returns {Object<string, number>} histogram (primaryLoad → numProctors)
 */
function computeHistogramByPrimaryLoad(loadState, classByProctorKey) {
    var hist = {};
    if (!loadState || !isPlainObject(loadState.proctors)) return hist;

    var filterByClass = isPlainObject(classByProctorKey);
    var keys = Object.keys(loadState.proctors);
    for (var i = 0; i < keys.length; i += 1) {
        var k = keys[i];
        if (filterByClass && !Object.prototype.hasOwnProperty.call(classByProctorKey, k)) {
            continue;
        }
        var entry = loadState.proctors[k];
        if (!entry) continue;
        var primary = (entry.guardCount || 0) + (entry.dutyCount || 0);
        var bucket = String(primary);
        hist[bucket] = (hist[bucket] || 0) + 1;
    }
    return hist;
}

/**
 * Count distinct canonical proctor keys appearing in any of:
 *   - row.proctor_keys
 *   - row.reserve_keys
 *   - row.duty_teachers
 * across every row. Null entries are ignored.
 *
 * Acceptance Criterion 9.4.
 *
 * @param {Array} rows
 * @returns {number}
 */
function countDistinctProctors(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return 0;
    var seen = Object.create(null);

    for (var i = 0; i < rows.length; i += 1) {
        var r = rows[i];
        if (!r || typeof r !== 'object') continue;

        var fields = ['proctor_keys', 'reserve_keys', 'duty_teachers'];
        for (var f = 0; f < fields.length; f += 1) {
            var arr = r[fields[f]];
            if (!Array.isArray(arr)) continue;
            for (var j = 0; j < arr.length; j += 1) {
                var k = arr[j];
                if (typeof k !== 'string' || k.length === 0) continue;
                seen[k] = true;
            }
        }
    }
    return Object.keys(seen).length;
}

// ---------------------------------------------------------------------------
// AC 5.10 — zero-load proctors
// ---------------------------------------------------------------------------

/**
 * Compute the list of eligible proctors whose Primary_Load is 0 at the end
 * of the run. "Eligible" here is defined by membership in
 * `classByProctorKey` (which Phase 2 only populates for proctors in
 * `proctorsList`).
 *
 * The `reason` field is best-effort — we set it to `'eligibility_constraints'`
 * when the proctor has zero eligible sessions in the class snapshot, and
 * `'insufficient_total_work'` otherwise. Future phases may override this
 * with richer information by passing a `reasonByKey` map via the
 * `state.zeroLoadReasonByKey` field (consumed here when present).
 *
 * Acceptance Criterion 5.10.
 *
 * @param {Object} loadState
 * @param {Object} classByProctorKey
 * @param {Object} [opts]
 * @param {Array}  [opts.classes]            - state.classes (for size lookups)
 * @param {Object} [opts.reasonByKey]        - per-key override map
 * @returns {Array<{canonicalKey:string, classId:string, reason:string}>}
 */
function computeZeroLoadProctors(loadState, classByProctorKey, opts) {
    var out = [];
    if (!loadState || !isPlainObject(loadState.proctors)) return out;
    if (!isPlainObject(classByProctorKey)) return out;

    var classes = (opts && Array.isArray(opts.classes)) ? opts.classes : null;
    var reasonByKey = (opts && isPlainObject(opts.reasonByKey)) ? opts.reasonByKey : null;

    // Build a quick classId → eligibleSessions count for reason inference.
    var sessionsByClassId = Object.create(null);
    if (classes) {
        for (var c = 0; c < classes.length; c += 1) {
            var cls = classes[c];
            if (!cls || typeof cls !== 'object') continue;
            sessionsByClassId[cls.classId] = Array.isArray(cls.eligibleSessions)
                ? cls.eligibleSessions.length
                : 0;
        }
    }

    var keys = Object.keys(classByProctorKey).slice().sort();
    for (var i = 0; i < keys.length; i += 1) {
        var key = keys[i];
        var entry = loadState.proctors[key];
        var primary = entry ? (entry.guardCount || 0) + (entry.dutyCount || 0) : 0;
        if (primary !== 0) continue;

        var classId = classByProctorKey[key];
        var reason;
        if (reasonByKey && Object.prototype.hasOwnProperty.call(reasonByKey, key)) {
            reason = String(reasonByKey[key]);
        } else if (classes && sessionsByClassId[classId] === 0) {
            reason = 'eligibility_constraints';
        } else {
            reason = 'insufficient_total_work';
        }

        out.push({ canonicalKey: key, classId: classId, reason: reason });
    }
    return out;
}

// ---------------------------------------------------------------------------
// AC 7.8 — reserve fairness deviations
// ---------------------------------------------------------------------------

/**
 * Compute reserve-fairness deviations: pairs (overloadedKey, underloadedKey)
 * where `overloadedKey.reserveCount` exceeds `underloadedKey.reserveCount`
 * by more than 1. The deviation is computed within each Eligibility_Class
 * because cross-class comparisons aren't meaningful (different eligibility
 * surfaces produce different opportunity counts).
 *
 * The output is deterministic: pairs are emitted in (overloadedKey ASC,
 * underloadedKey ASC) order. `blockingReason` is left as a generic
 * placeholder unless the caller passes a per-pair override map via
 * `opts.blockingReasonByPair` (keyed `${over}|${under}`).
 *
 * Acceptance Criterion 7.8.
 *
 * @param {Object} loadState
 * @param {Object} classByProctorKey
 * @param {Object} [opts]
 * @param {Object} [opts.blockingReasonByPair]
 * @returns {Array<{overloadedKey:string, underloadedKey:string, deltaCount:number, blockingReason:string}>}
 */
function computeReserveImbalances(loadState, classByProctorKey, opts) {
    var out = [];
    if (!loadState || !isPlainObject(loadState.proctors)) return out;
    if (!isPlainObject(classByProctorKey)) return out;

    var blockingByPair = (opts && isPlainObject(opts.blockingReasonByPair))
        ? opts.blockingReasonByPair : null;

    // Group canonical keys by classId.
    var keysByClass = Object.create(null);
    var allKeys = Object.keys(classByProctorKey).slice().sort();
    for (var i = 0; i < allKeys.length; i += 1) {
        var k = allKeys[i];
        var cid = classByProctorKey[k];
        if (typeof cid !== 'string' || cid.length === 0) continue;
        if (!keysByClass[cid]) keysByClass[cid] = [];
        keysByClass[cid].push(k);
    }

    var classIds = Object.keys(keysByClass).sort();
    for (var c = 0; c < classIds.length; c += 1) {
        var cls = keysByClass[classIds[c]];
        // O(N^2) within a class is fine — class sizes are bounded by proctor
        // count (~150) and most classes are smaller.
        for (var a = 0; a < cls.length; a += 1) {
            var overKey = cls[a];
            var overEntry = loadState.proctors[overKey];
            if (!overEntry) continue;
            var overCount = overEntry.reserveCount || 0;

            for (var b = 0; b < cls.length; b += 1) {
                if (a === b) continue;
                var underKey = cls[b];
                var underEntry = loadState.proctors[underKey];
                if (!underEntry) continue;
                var underCount = underEntry.reserveCount || 0;
                var delta = overCount - underCount;
                if (delta <= 1) continue;

                var pairKey = overKey + '|' + underKey;
                var reason = (blockingByPair
                    && Object.prototype.hasOwnProperty.call(blockingByPair, pairKey))
                    ? String(blockingByPair[pairKey])
                    : 'unknown';

                out.push({
                    overloadedKey: overKey,
                    underloadedKey: underKey,
                    deltaCount: delta,
                    blockingReason: reason
                });
            }
        }
    }

    // Final deterministic sort (over ASC, under ASC).
    out.sort(function (x, y) {
        if (x.overloadedKey < y.overloadedKey) return -1;
        if (x.overloadedKey > y.overloadedKey) return 1;
        if (x.underloadedKey < y.underloadedKey) return -1;
        if (x.underloadedKey > y.underloadedKey) return 1;
        return 0;
    });

    return out;
}

// ---------------------------------------------------------------------------
// AC 6.6 — AM/PM imbalance map
// ---------------------------------------------------------------------------

/**
 * For every proctor in `loadState`, return |amCount - pmCount|. The result
 * is a plain object keyed by canonical proctor key. Order of iteration is
 * not guaranteed (consumers should sort if needed), but the values are
 * deterministic given identical inputs.
 *
 * Acceptance Criterion 6.6.
 *
 * @param {Object} loadState
 * @returns {Object<string, number>}
 */
function computeAmPmImbalances(loadState) {
    var out = {};
    if (!loadState || !isPlainObject(loadState.proctors)) return out;
    var keys = Object.keys(loadState.proctors);
    for (var i = 0; i < keys.length; i += 1) {
        var k = keys[i];
        var e = loadState.proctors[k];
        if (!e) continue;
        var am = e.amCount || 0;
        var pm = e.pmCount || 0;
        out[k] = Math.abs(am - pm);
    }
    return out;
}

// ---------------------------------------------------------------------------
// AC 9.8 — JSON round-trip safety
// ---------------------------------------------------------------------------

/**
 * Verify that a value can be JSON.stringify'd AND that
 * JSON.parse(JSON.stringify(v)) round-trips with structural equality.
 *
 * Returns `{ ok: boolean, error?: string }` rather than throwing so the
 * orchestrator can record the failure as a `diagnostics.errors` entry
 * instead of crashing.
 *
 * Note: structural equality is checked via a string compare of two
 * stringifications. Object key insertion order matters in JSON — but since
 * the same JS engine produces both stringifications back-to-back, and we
 * only stringify plain data the algorithm itself emits, key order is
 * stable in practice.
 *
 * @param {*} value
 * @returns {{ok: boolean, error?: string}}
 */
function verifyJsonSerializable(value) {
    var serialized;
    try {
        serialized = JSON.stringify(value);
    } catch (err) {
        return { ok: false, error: 'stringify failed: ' + (err && err.message ? err.message : err) };
    }
    if (typeof serialized !== 'string') {
        return { ok: false, error: 'JSON.stringify returned non-string' };
    }
    var parsed;
    try {
        parsed = JSON.parse(serialized);
    } catch (err) {
        return { ok: false, error: 'parse failed: ' + (err && err.message ? err.message : err) };
    }
    var reSerialized;
    try {
        reSerialized = JSON.stringify(parsed);
    } catch (err) {
        return { ok: false, error: 're-stringify failed: ' + (err && err.message ? err.message : err) };
    }
    if (reSerialized !== serialized) {
        return { ok: false, error: 'round-trip not byte-identical' };
    }
    return { ok: true };
}

// ---------------------------------------------------------------------------
// Top-level builder
// ---------------------------------------------------------------------------

/**
 * Compute min/max from a histogram object (keys are stringified integers).
 * Returns `{ min: 0, max: 0 }` for an empty histogram.
 *
 * @param {Object<string, number>} hist
 * @returns {{min:number, max:number}}
 */
function minMaxFromHistogram(hist) {
    if (!isPlainObject(hist)) return { min: 0, max: 0 };
    var keys = Object.keys(hist);
    if (keys.length === 0) return { min: 0, max: 0 };
    var min = Infinity;
    var max = -Infinity;
    for (var i = 0; i < keys.length; i += 1) {
        var k = Number(keys[i]);
        if (!Number.isFinite(k)) continue;
        if (k < min) min = k;
        if (k > max) max = k;
    }
    if (min === Infinity) min = 0;
    if (max === -Infinity) max = 0;
    return { min: min, max: max };
}

/**
 * Build the full DiagnosticsV3 object for a finalized pipeline state.
 *
 * Required `state` fields (everything is optional/defensive):
 *   - state.input.randomSeed                 → seedUsed (fallback: 0)
 *   - state.rng.seed                         → seedUsed (preferred over input.randomSeed)
 *   - state.startTime                        → totalDurationMs (now() - startTime)
 *   - state.phaseDurations                   → phaseDurations (copied)
 *   - state.rows                             → histogramByGuardCount, distinctCount
 *   - state.loadState                        → histogramByPrimaryLoad, AM/PM, zero-load
 *   - state.classByProctorKey                → eligibility filter for histograms
 *   - state.classes                          → reason inference for zero-load
 *   - state.globalLowerBound                 → globalLowerBound
 *   - state.globalUpperBound                 → globalUpperBound
 *   - state.classBoundsByProctorKey          → classBoundsByProctorKey (copied)
 *   - state.diagnostics.unresolvedSlots      → unresolvedSlots (copied)
 *   - state.diagnostics.coverageWarnings     → coverageWarnings (copied)
 *   - state.diagnostics.coverageRepairSwaps  → coverageRepairSwaps
 *   - state.diagnostics.coverageRepairUnresolved → coverageRepairUnresolved
 *   - state.orphanInputKeys                  → orphanInputKeys (copied)
 *   - state.diagnostics.warnings             → warnings (copied)
 *   - state.diagnostics.errors               → errors (copied)
 *
 * The returned object is JSON round-trip safe (verified by
 * verifyJsonSerializable; on failure, an entry is added to `errors`).
 *
 * @param {Object} state
 * @returns {Object} DiagnosticsV3
 */
function buildDiagnostics(state) {
    if (!isPlainObject(state)) {
        throw new TypeError('buildDiagnostics: state must be a plain object');
    }

    var input = isPlainObject(state.input) ? state.input : {};
    var stateDiag = isPlainObject(state.diagnostics) ? state.diagnostics : {};
    var rows = Array.isArray(state.rows) ? state.rows : [];
    var loadState = isPlainObject(state.loadState) ? state.loadState : null;
    var classByProctorKey = isPlainObject(state.classByProctorKey)
        ? state.classByProctorKey
        : null;
    var classes = Array.isArray(state.classes) ? state.classes : null;

    // Seed resolution: prefer state.rng.seed (the actual seed used),
    // fall back to input.randomSeed, finally 0.
    var seedUsed = 0;
    if (isPlainObject(state.rng) && Number.isFinite(state.rng.seed)) {
        seedUsed = state.rng.seed;
    } else if (Number.isFinite(input.randomSeed)) {
        seedUsed = input.randomSeed;
    }

    // Wall-clock duration (best-effort — only meaningful when
    // state.startTime is present).
    var totalDurationMs = 0;
    if (Number.isFinite(state.startTime)) {
        totalDurationMs = Math.max(0, Date.now() - state.startTime);
    } else if (Number.isFinite(state.totalDurationMs)) {
        totalDurationMs = state.totalDurationMs;
    }

    var phaseDurations = safeObjectCopy(state.phaseDurations);

    var histogramByGuardCount = computeHistogramByGuardCount(rows);
    var histogramByPrimaryLoad = computeHistogramByPrimaryLoad(
        loadState,
        classByProctorKey
    );

    // min/max refer to histogramByPrimaryLoad (the fairness axis).
    var stats = minMaxFromHistogram(histogramByPrimaryLoad);

    var distinctCount = countDistinctProctors(rows);

    var globalLowerBound = Number.isFinite(state.globalLowerBound)
        ? state.globalLowerBound
        : 0;
    var globalUpperBound = Number.isFinite(state.globalUpperBound)
        ? state.globalUpperBound
        : 0;

    var classBoundsByProctorKey = safeObjectCopy(state.classBoundsByProctorKey);

    var unresolvedSlots = safeArrayCopy(stateDiag.unresolvedSlots);
    var coverageWarnings = safeArrayCopy(stateDiag.coverageWarnings);
    var coverageRepairSwaps = Number.isFinite(stateDiag.coverageRepairSwaps)
        ? stateDiag.coverageRepairSwaps
        : 0;
    var coverageRepairUnresolved = Number.isFinite(stateDiag.coverageRepairUnresolved)
        ? stateDiag.coverageRepairUnresolved
        : (Array.isArray(stateDiag.coverageWarnings)
            ? stateDiag.coverageWarnings.length
            : 0);

    // orphanInputKeys lives on state (Phase 1) by design, but if a caller
    // already merged it into diagnostics we honor that location too.
    var orphanInputKeys;
    if (Array.isArray(state.orphanInputKeys)) {
        orphanInputKeys = state.orphanInputKeys.slice();
    } else if (Array.isArray(stateDiag.orphanInputKeys)) {
        orphanInputKeys = stateDiag.orphanInputKeys.slice();
    } else {
        orphanInputKeys = [];
    }

    var amPmImbalanceByProctorKey = computeAmPmImbalances(loadState);

    var zeroLoadProctors = computeZeroLoadProctors(
        loadState,
        classByProctorKey,
        {
            classes: classes,
            reasonByKey: isPlainObject(state.zeroLoadReasonByKey)
                ? state.zeroLoadReasonByKey
                : null
        }
    );

    var reserveImbalances = computeReserveImbalances(
        loadState,
        classByProctorKey,
        {
            blockingReasonByPair: isPlainObject(state.reserveBlockingReasonByPair)
                ? state.reserveBlockingReasonByPair
                : null
        }
    );

    var warnings = safeArrayCopy(stateDiag.warnings);
    var errors = safeArrayCopy(stateDiag.errors);

    // Honor pre-check diagnostics fields the orchestrator may have set
    // (e.g. preCheckRequired, preCheckUnresolvedCount,
    // preCheckRelaxedUnresolvedCount). These are forwarded as primitives.
    var preCheckRequired = (typeof stateDiag.preCheckRequired === 'boolean')
        ? stateDiag.preCheckRequired
        : false;

    var diagnostics = {
        algorithmVersion: 'v3',
        seedUsed: seedUsed,
        totalDurationMs: totalDurationMs,
        phaseDurations: phaseDurations,

        // Two histograms (AC 9.3, 9.3a).
        histogramByGuardCount: histogramByGuardCount,
        histogramByPrimaryLoad: histogramByPrimaryLoad,

        // min/max/distinctCount (AC 9.2, AC 9.4).
        min: stats.min,
        max: stats.max,
        distinctCount: distinctCount,

        // Bounds (AC 5.2-5.5 surface).
        globalLowerBound: globalLowerBound,
        globalUpperBound: globalUpperBound,
        classBoundsByProctorKey: classBoundsByProctorKey,

        // Unresolved / repair telemetry (AC 3.10, 5.13).
        unresolvedSlots: unresolvedSlots,
        coverageWarnings: coverageWarnings,
        coverageRepairSwaps: coverageRepairSwaps,
        coverageRepairUnresolved: coverageRepairUnresolved,

        // Identity normalization fallout (AC 2.4).
        orphanInputKeys: orphanInputKeys,

        // Soft-constraint surface (AC 6.6).
        amPmImbalanceByProctorKey: amPmImbalanceByProctorKey,

        // Best-effort fairness diagnostics (AC 5.10, 7.8).
        zeroLoadProctors: zeroLoadProctors,
        reserveImbalances: reserveImbalances,

        // Reserve Final_Load fairness overflows (AC-FL3) — additive list of
        // forced overflow records emitted by Phase 9 when no under-cap
        // eligible candidate was available for a given session. Always an
        // array; empty `[]` when Tier 1 covered every reserve placement.
        finalLoadOverflows: safeArrayCopy(stateDiag.finalLoadOverflows),

        // Soft warnings + structured errors (AC 9.6, 9.7).
        warnings: warnings,
        errors: errors,

        // Pre-check signal forwarded from Phase 6 / orchestrator (AC 4.x).
        preCheckRequired: preCheckRequired
    };

    if (Number.isFinite(stateDiag.preCheckUnresolvedCount)) {
        diagnostics.preCheckUnresolvedCount = stateDiag.preCheckUnresolvedCount;
    }
    if (Number.isFinite(stateDiag.preCheckRelaxedUnresolvedCount)) {
        diagnostics.preCheckRelaxedUnresolvedCount = stateDiag.preCheckRelaxedUnresolvedCount;
    }

    // AC 9.8: validate JSON serializability. On failure, surface as a
    // structured error rather than throwing.
    var roundTrip = verifyJsonSerializable(diagnostics);
    if (!roundTrip.ok) {
        diagnostics.errors = diagnostics.errors.slice();
        diagnostics.errors.push({
            type: 'diagnostics_serialization_failure',
            phase: 'finalize',
            message: roundTrip.error || 'JSON round-trip failed'
        });
    }

    return diagnostics;
}

module.exports = {
    buildDiagnostics: buildDiagnostics,
    computeHistogramByGuardCount: computeHistogramByGuardCount,
    computeHistogramByPrimaryLoad: computeHistogramByPrimaryLoad,
    countDistinctProctors: countDistinctProctors,
    computeZeroLoadProctors: computeZeroLoadProctors,
    computeReserveImbalances: computeReserveImbalances,
    computeAmPmImbalances: computeAmPmImbalances,
    verifyJsonSerializable: verifyJsonSerializable,
    _internals: {
        minMaxFromHistogram: minMaxFromHistogram
    }
};
