/*
 * AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Browser bundle of the V3 proctor-distribution module.
 * Source: js/algorithms/proctor-v3/ + js/data/proctor-key-resolver.js
 * Regenerate with: node scripts/build-proctor-v3-bundle.js (npm run build:v3-bundle)
 *
 * Exposes: window.ProctorDistributionV3 = { run, _internals }
 */
(function (global) {
    'use strict';

    var __modules = {};
    var __cache = {};

    function __normalize(p) {
        var isAbs = p.charAt(0) === '/';
        var segs = p.split('/');
        var out = [];
        for (var i = 0; i < segs.length; i += 1) {
            var seg = segs[i];
            if (seg === '' || seg === '.') continue;
            if (seg === '..') { if (out.length) out.pop(); continue; }
            out.push(seg);
        }
        return (isAbs ? '/' : '') + out.join('/');
    }

    var __path = {
        join: function () {
            var args = Array.prototype.slice.call(arguments);
            return __normalize(args.join('/'));
        },
        dirname: function (p) {
            var n = __normalize(p);
            var idx = n.lastIndexOf('/');
            return idx <= 0 ? '/' : n.substring(0, idx);
        },
        basename: function (p) {
            var n = __normalize(p);
            var idx = n.lastIndexOf('/');
            return idx < 0 ? n : n.substring(idx + 1);
        },
        sep: '/'
    };

    function __makeRequire(fromDir) {
        return function (request) {
            if (request === 'path') return __path;
            var resolved;
            if (request.charAt(0) === '/') {
                resolved = __normalize(request);
            } else if (request.charAt(0) === '.') {
                resolved = __normalize(fromDir + '/' + request);
            } else {
                resolved = __normalize(request);
            }
            var candidates = [resolved, resolved + '.js', resolved + '/index.js'];
            for (var i = 0; i < candidates.length; i += 1) {
                if (__modules[candidates[i]]) return __load(candidates[i]);
            }
            throw new Error(
                'ProctorDistributionV3 bundle: cannot resolve module "' + request +
                '" from "' + fromDir + '"'
            );
        };
    }

    function __load(id) {
        if (__cache[id]) return __cache[id].exports;
        var def = __modules[id];
        if (!def) throw new Error('ProctorDistributionV3 bundle: unknown module ' + id);
        var module = { exports: {}, id: id };
        __cache[id] = module;
        var __filename = id;
        var __dirname = __path.dirname(id);
        def(module, module.exports, __makeRequire(__dirname), __dirname, __filename);
        return module.exports;
    }

    // ----- module definitions -----

    __modules["/js/algorithms/proctor-v3/canonical-key.js"] = function (module, exports, require, __dirname, __filename) {
// Proctor Distribution V3 — canonical proctor key + key adapter.
//
// Single source of truth for proctor identity inside V3. Every proctor in
// `proctorsList` is represented by exactly ONE canonical key, derived from
// `(proc, idx)` via `canonicalProctorKey`.
//
// The Key Adapter exists at the boundary between the algorithm and external
// data (`dutyData`, `exemptionsData`, `meAssignments`). Legacy callers may
// reference proctors by `cin`, `som`, or numeric `idx_N` / `__idx_N` forms;
// `buildKeyAdapter` accepts every plausible external shape and maps it to the
// single canonical form. Internal V3 code never branches on key shape.
//
// V2 pitfalls deliberately avoided:
//   - V2 had TWO competing identity functions (cin||__idx_N vs cin||som||idx_N)
//     producing dual identities. V3 has exactly ONE canonical function.
//   - V2 omitted `.trim()` on `cin`, generating ghost keys when inputs had
//     trailing whitespace. V3 trims `cin` (and `som` on the adapter side).

'use strict';

/**
 * Compute the canonical proctor key for a given proctor and its 0-based
 * index in `proctorsList`.
 *
 * Rule:
 *   trimmed non-empty `cin` → use that string
 *   otherwise               → fallback to `'__idx_' + idx`
 *
 * `som` is NEVER part of the canonical form (only the adapter recognizes it
 * as an input alias).
 *
 * @param {object} proc - proctor object; may be null/undefined or missing cin
 * @param {number} idx  - 0-based index of this proctor in proctorsList
 * @returns {string} canonical key
 */
function canonicalProctorKey(proc, idx) {
    var cin = proc && proc.cin != null ? String(proc.cin).trim() : '';
    if (cin) {
        return cin;
    }
    return '__idx_' + idx;
}

/**
 * Build a lookup map from every plausible external key form to the canonical
 * key for the corresponding proctor.
 *
 * For each proctor at index `i`, the following input-side aliases all map
 * to `canonicalProctorKey(proctorsList[i], i)`:
 *   - the canonical key itself (identity)
 *   - trimmed `cin`            (when non-empty)
 *   - untrimmed `cin`          (when it differs from trimmed and is non-empty)
 *   - trimmed `som`            (when non-empty)
 *   - untrimmed `som`          (when it differs from trimmed and is non-empty)
 *   - `'idx_' + i`             (legacy short form)
 *   - `'__idx_' + i`           (canonical fallback form)
 *
 * Earlier entries in `proctorsList` win on alias collisions: if two proctors
 * happen to share the same `som` value, the adapter keeps the first one's
 * mapping (canonical-identity entries are still written for both).
 *
 * @param {Array<object>} proctorsList - array of proctor records
 * @returns {Object<string,string>} adapter map (plain object, null-prototype)
 */
function buildKeyAdapter(proctorsList) {
    var adapter = Object.create(null);
    if (!Array.isArray(proctorsList)) {
        return adapter;
    }

    function setIfAbsent(key, value) {
        if (key == null) return;
        if (adapter[key] === undefined) {
            adapter[key] = value;
        }
    }

    for (var i = 0; i < proctorsList.length; i += 1) {
        var proc = proctorsList[i] || {};
        var canonical = canonicalProctorKey(proc, i);

        // Canonical identity must always resolve to itself, even if a prior
        // proctor's som happened to equal this canonical string.
        adapter[canonical] = canonical;

        var rawCin = proc.cin != null ? String(proc.cin) : '';
        var trimmedCin = rawCin.trim();
        if (trimmedCin) {
            setIfAbsent(trimmedCin, canonical);
            if (rawCin !== trimmedCin) {
                setIfAbsent(rawCin, canonical);
            }
        }

        var rawSom = proc.som != null ? String(proc.som) : '';
        var trimmedSom = rawSom.trim();
        if (trimmedSom) {
            setIfAbsent(trimmedSom, canonical);
            if (rawSom !== trimmedSom) {
                setIfAbsent(rawSom, canonical);
            }
        }

        setIfAbsent('idx_' + i, canonical);
        setIfAbsent('__idx_' + i, canonical);
    }

    return adapter;
}

/**
 * Resolve an external key to its canonical form via the adapter.
 * Accepts strings; performs a trimmed lookup as a fallback when the raw
 * form is not present in the adapter.
 *
 * @param {Object<string,string>} adapter
 * @param {string} externalKey
 * @returns {string|null} canonical key, or null if unresolvable
 */
function toCanonical(adapter, externalKey) {
    if (adapter == null) return null;
    if (externalKey == null) return null;
    if (typeof externalKey !== 'string') {
        externalKey = String(externalKey);
    }

    if (adapter[externalKey] !== undefined) {
        return adapter[externalKey];
    }
    var trimmed = externalKey.trim();
    if (trimmed !== externalKey && adapter[trimmed] !== undefined) {
        return adapter[trimmed];
    }
    return null;
}

module.exports = { canonicalProctorKey, buildKeyAdapter, toCanonical };
    };

    __modules["/js/algorithms/proctor-v3/constraints/bounds.js"] = function (module, exports, require, __dirname, __filename) {
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
    };

    __modules["/js/algorithms/proctor-v3/constraints/hard-constraints.js"] = function (module, exports, require, __dirname, __filename) {
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
    var cin = (proctor && proctor.cin != null) ? String(proctor.cin).trim() : '';
    if (cin) return cin;
    return '__idx_' + idx;
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
    };

    __modules["/js/algorithms/proctor-v3/diagnostics.js"] = function (module, exports, require, __dirname, __filename) {
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
    };

    __modules["/js/algorithms/proctor-v3/index.js"] = function (module, exports, require, __dirname, __filename) {
// Proctor Distribution V3 — public API entry point.
//
// This module is the single public surface of the V3 algorithm. Consumers
// (renderer, IPC layer, CLI tests, end users) SHALL ONLY call `run`. The
// `_internals` namespace is exported for white-box testing and is not part
// of the public contract.
//
// Acceptance Criteria covered:
//   - 1.1   : single public function `run(input)` returning the standard envelope
//   - 1.2   : runnable in pure Node (no `window`/`document`/`electron` required)
//   - 17.2  : public API exposed via `module.exports` (Node-first), with
//             secondary `window.ProctorDistributionV3` attachment for the
//             Electron renderer
//
// V2 pitfall explicitly avoided (per tasks.md task 24):
//   V2 used `window.ProctorDistributionV2 = { ... }` ONLY, which made
//   CLI/Node testing impossible (the file threw on load under Node because
//   `window` was undefined). V3 primarily uses `module.exports`; the
//   `window` attachment is a secondary convenience for the renderer and
//   is guarded by a `typeof window !== 'undefined'` check.

'use strict';

var path = require('path');

var orchestratorModule = require(path.join(__dirname, 'orchestrator.js'));
var canonicalKeyModule = require(path.join(__dirname, 'canonical-key.js'));
var diagnosticsModule = require(path.join(__dirname, 'diagnostics.js'));
var prngModule = require(path.join(__dirname, 'utils', 'prng.js'));

var runOrchestrator = orchestratorModule.runOrchestrator;

/**
 * Run the V3 proctor distribution algorithm.
 *
 * @param {Object} input - GS3_Input_Contract object. See requirements.md
 *                         glossary for the full schema.
 * @param {Object} [options] - optional runtime tuning.
 * @param {number} [options.totalBudgetMs=30000] - global wall-clock budget.
 * @returns {{
 *   result: Array,                 // ResultRow[] (V2-shape compatible)
 *   diagnostics: Object,           // DiagnosticsV3
 *   algorithmVersion: 'v3',
 *   orchestratorState: 'COMPLETED'|'DEGRADED'|'TIMEOUT'|'ERROR'|'INVALID_INPUT'
 * }}
 */
function run(input, options) {
    return runOrchestrator(input, options);
}

// ---------------------------------------------------------------------------
// _internals — testing-only exports.
//
// Exposes the helpers required by the spec (`canonicalProctorKey`,
// `buildKeyAdapter`, `computeHistogram`) plus a small set of additional
// utilities that downstream PBT and integration tests have already
// adopted. None of these are part of the public contract; consumers that
// reach into `_internals` accept that the surface may change without
// notice.
// ---------------------------------------------------------------------------
var _internals = {
    // Canonical key (Requirement 2).
    canonicalProctorKey: canonicalKeyModule.canonicalProctorKey,
    buildKeyAdapter: canonicalKeyModule.buildKeyAdapter,
    toCanonical: canonicalKeyModule.toCanonical,

    // Histogram (Requirement 9.3 / 9.3a). Task 24 calls out
    // `computeHistogram` specifically — we expose the canonical
    // slot-based variant under that name AND keep both explicit names
    // available for tests that need to disambiguate.
    computeHistogram: diagnosticsModule.computeHistogramByGuardCount,
    computeHistogramByGuardCount: diagnosticsModule.computeHistogramByGuardCount,
    computeHistogramByPrimaryLoad: diagnosticsModule.computeHistogramByPrimaryLoad,

    // Orchestrator + PRNG (used by integration / determinism PBTs).
    runOrchestrator: runOrchestrator,
    createPRNG: prngModule.createPRNG
};

module.exports = { run: run, _internals: _internals };

// Secondary: attach to window when running inside a renderer / browser-like
// host. Guarded so this file remains require-able from pure Node (CLI tests,
// `verify:v3` script, Section 7 PBT suite).
if (typeof window !== 'undefined') {
    window.ProctorDistributionV3 = { run: run, _internals: _internals };
}
    };

    __modules["/js/algorithms/proctor-v3/orchestrator.js"] = function (module, exports, require, __dirname, __filename) {
// Proctor Distribution V3 — orchestrator.
//
// Wires up the full V3 phase pipeline:
//   Phase 0  → validate input
//   Phase 1  → normalize keys
//   Phase 1b → build rooms and empty result rows
//   Phase 2  → derive eligibility classes
//   Phase 3  → compute bounds
//   Phase 4  → place guards (CP solver)
//   Phase 5  → multi-step coverage repair
//   Phase 6  → same-day infeasibility detection (pure inspection)
//   pre-check → conditional relaxed-mode pre-check (orchestrator-level, not
//               inside Phase 6 — preserves Phase 6 purity, see design.md §4)
//   Phase 7  → bimodal repair (local search)
//   Phase 8  → AM/PM balance (local search)
//   Phase 9  → place reserves
//   Phase 10 → finalize (softViolations + diagnostics + JSON-safety)
//
// Acceptance Criteria covered:
//   - 1.1, 1.2, 1.3, 1.4, 1.14 : public envelope + idempotent re-run + V2-shape
//   - 4.2, 4.2a, 4.2b          : conditional same-day relaxation pre-check
//   - 9.1, 9.2, 9.7, 9.8       : diagnostics envelope + structured errors
//   - 12.1, 12.2, 12.3         : phase pipeline architecture
//   - 12.4                     : post-placement guards live in phases 5/7/8
//   - 12.5                     : try/catch around each phase
//   - 12.6                     : global 30s budget + per-phase budgets
//
// V2 pitfalls explicitly avoided (per tasks.md task 23):
//   1. NO module-level mutable state for re-entrancy. Every per-run
//      variable lives inside `runOrchestrator` (closure-local). Re-entrant
//      callers see no shared state between invocations.
//   2. Distinct orchestrator states: 'COMPLETED' | 'DEGRADED' | 'TIMEOUT'
//      | 'ERROR'. We ALSO emit a fifth state, 'INVALID_INPUT', when
//      Phase 0 rejects the input — this is structurally distinct from
//      the other four because no pipeline ran. (The four states from
//      tasks.md are all post-Phase-0 states.)
//   3. `diagnostics.errors` is an array of structured objects:
//          { type, message, phase?, details? }
//      NOT an array of strings.

'use strict';

var path = require('path');

var phase00 = require(path.join(__dirname, 'phases', '00-validate.js'));
var phase01 = require(path.join(__dirname, 'phases', '01-normalize-keys.js'));
var phase01b = require(path.join(__dirname, 'phases', '01b-build-rooms-and-rows.js'));
var phase02 = require(path.join(__dirname, 'phases', '02-eligibility-classes.js'));
var phase03 = require(path.join(__dirname, 'phases', '03-bounds.js'));
var phase04 = require(path.join(__dirname, 'phases', '04-place-guards.js'));
var phase05 = require(path.join(__dirname, 'phases', '05-coverage-repair.js'));
var phase06 = require(path.join(__dirname, 'phases', '06-same-day-detect.js'));
var phase07 = require(path.join(__dirname, 'phases', '07-bimodal-repair.js'));
var phase08 = require(path.join(__dirname, 'phases', '08-ampm-balance.js'));
var phase09 = require(path.join(__dirname, 'phases', '09-place-reserves.js'));
var phase10 = require(path.join(__dirname, 'phases', '10-finalize.js'));

var loadStateUtils = require(path.join(__dirname, 'utils', 'load-state.js'));
var prngUtils = require(path.join(__dirname, 'utils', 'prng.js'));
var diagnosticsModule = require(path.join(__dirname, 'diagnostics.js'));

var validateInput = phase00.validateInput;
var normalizeKeys = phase01.normalizeKeys;
var buildRoomsAndRows = phase01b.buildRoomsAndRows;
var deriveEligibilityClasses = phase02.deriveEligibilityClasses;
var computeBounds = phase03.computeBounds;
var placeGuards = phase04.placeGuards;
var multiStepCoverageRepair = phase05.multiStepCoverageRepair;
var detectSameDayInfeasibility = phase06.detectSameDayInfeasibility;
var bimodalRepair = phase07.bimodalRepair;
var ampmBalance = phase08.ampmBalance;
var placeReserves = phase09.placeReserves;
var finalize = phase10.finalize;

var createLoadState = loadStateUtils.createLoadState;
var addDutyLoad = loadStateUtils.addDutyLoad;
var createPRNG = prngUtils.createPRNG;
var buildDiagnostics = diagnosticsModule.buildDiagnostics;

// Global wall-clock budget for one full pipeline run (AC 12.6).
var DEFAULT_TOTAL_BUDGET_MS = 30000;

// Pre-check guard: skip the relaxed-mode pre-check if remaining budget
// is below this threshold (design.md §4 Phase 6 + §9 Time Budget).
var PRECHECK_MIN_REMAINING_MS = 7000;

// Pre-check sub-budgets (design.md §4 Phase 6).
var DEFAULT_PRECHECK_PHASE4_BUDGET_MS = 5000;
var DEFAULT_PRECHECK_PHASE5_BUDGET_MS = 2000;

// ---------------------------------------------------------------------------
// Internal helpers (pure, stateless)
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

function canonicalKeyOf(proctor, idx) {
    var cin = proctor && proctor.cin != null ? String(proctor.cin).trim() : '';
    if (cin) return cin;
    return '__idx_' + idx;
}

function nowMs() {
    return Date.now();
}

/**
 * Produce a deterministic-ish seed when `randomSeed` is absent (AC 8.3).
 * We use the same source the tests expect (Date.now()), but constrained
 * to a 32-bit unsigned integer so mulberry32 ingests it cleanly.
 */
function deriveSeedFromClock() {
    return Date.now() >>> 0;
}

/**
 * Build an empty diagnostics shell with all required arrays present so
 * each phase can `slice()` them safely.
 */
function freshDiagnostics() {
    return {
        warnings: [],
        errors: [],
        unresolvedSlots: [],
        coverageWarnings: [],
        coverageRepairSwaps: 0,
        coverageRepairUnresolved: 0
    };
}

/**
 * Pre-load the load-state with duty counts. Phase 4 + Phase 5 expect this
 * (per tests/proctor-v3/coverage-repair.test.js seeding pattern).
 *
 * The load-state is keyed by canonical proctor key. Duty entries come
 * from `state.normalizedDutyData` (Phase 1 output): an object keyed by
 * `halfday_key`, each value an inner object whose keys are canonical
 * proctor keys.
 */
function seedLoadStateWithDuty(state) {
    var input = state.input;
    var canonicalKeys = [];
    if (Array.isArray(input.proctorsList)) {
        for (var i = 0; i < input.proctorsList.length; i += 1) {
            canonicalKeys.push(canonicalKeyOf(input.proctorsList[i], i));
        }
    }
    var ls = createLoadState(canonicalKeys);

    var nd = isPlainObject(state.normalizedDutyData) ? state.normalizedDutyData : null;
    if (nd) {
        var hdKeys = Object.keys(nd);
        for (var h = 0; h < hdKeys.length; h += 1) {
            var hd = hdKeys[h];
            var inner = nd[hd];
            if (!isPlainObject(inner)) continue;
            var procKeys = Object.keys(inner);
            for (var p = 0; p < procKeys.length; p += 1) {
                addDutyLoad(ls, procKeys[p], hd);
            }
        }
    }
    return ls;
}

/**
 * Build a fresh, isolated relaxed state for the same-day pre-check by
 * re-running Phases 1..3 on a clone of the input with
 * `allowSameDayBothHalfdays: true`. The relaxed state shares no mutable
 * references with the strict state.
 *
 * Used by the orchestrator's conditional same-day relaxation pre-check.
 *
 * Exported via _internals for tests (orchestrator-precheck.test.js).
 */
function buildRelaxedState(strictInput, options) {
    var relaxedRules = isPlainObject(strictInput.examDistributionRules)
        ? Object.assign({}, strictInput.examDistributionRules) : {};
    relaxedRules.allowSameDayBothHalfdays = true;

    var relaxedInput = Object.assign({}, strictInput);
    relaxedInput.examDistributionRules = relaxedRules;

    var relaxedState = { input: relaxedInput, options: options || {} };

    relaxedState = normalizeKeys(relaxedState);
    relaxedState = buildRoomsAndRows(relaxedState);
    relaxedState = deriveEligibilityClasses(relaxedState);
    relaxedState = computeBounds(relaxedState);
    relaxedState.loadState = seedLoadStateWithDuty(relaxedState);
    return relaxedState;
}

// ---------------------------------------------------------------------------
// runSameDayPreCheck — orchestrator-level conditional helper
// ---------------------------------------------------------------------------

/**
 * Perform the relaxed-mode pre-check and emit the appropriate warning into
 * a NEW state with cloned diagnostics. The strict state itself is NOT
 * mutated (purity is preserved at the orchestrator level too).
 *
 * Pre-conditions:
 *   - `state.diagnostics.preCheckRequired === true` (set by Phase 6).
 *
 * If `preCheckRequired` is falsy, this function returns the input state
 * shallow-cloned with no warning emitted (defensive no-op — keeps callers
 * simple).
 *
 * @param {Object} state - strict-run state after Phase 6.
 * @param {Object} [options]
 * @param {number} [options.phase4BudgetMs=5000]
 * @param {number} [options.phase5BudgetMs=2000]
 * @returns {Object} new state with `state.diagnostics.warnings` extended.
 */
function runSameDayPreCheck(state, options) {
    if (state === null || state === undefined) {
        throw new TypeError('runSameDayPreCheck: state must be an object');
    }
    if (!isPlainObject(state.input)) {
        throw new TypeError('runSameDayPreCheck: state.input must be a plain object');
    }
    var diag = isPlainObject(state.diagnostics) ? state.diagnostics : {};
    var opts = isPlainObject(options) ? options : {};

    if (!diag.preCheckRequired) {
        var ns0 = shallowCopyState(state);
        ns0.diagnostics = Object.assign({}, diag, {
            warnings: Array.isArray(diag.warnings) ? diag.warnings.slice() : [],
            errors: Array.isArray(diag.errors) ? diag.errors.slice() : [],
            unresolvedSlots: Array.isArray(diag.unresolvedSlots)
                ? diag.unresolvedSlots.slice() : []
        });
        return ns0;
    }

    var phase4Budget = (typeof opts.phase4BudgetMs === 'number' && opts.phase4BudgetMs >= 0)
        ? opts.phase4BudgetMs : DEFAULT_PRECHECK_PHASE4_BUDGET_MS;
    var phase5Budget = (typeof opts.phase5BudgetMs === 'number' && opts.phase5BudgetMs >= 0)
        ? opts.phase5BudgetMs : DEFAULT_PRECHECK_PHASE5_BUDGET_MS;

    var preCheckOptions = {
        phase4TimeBudgetMs: phase4Budget,
        phase5TimeBudgetMs: phase5Budget
    };

    var relaxedState = buildRelaxedState(state.input, preCheckOptions);
    relaxedState = placeGuards(relaxedState);
    relaxedState = multiStepCoverageRepair(relaxedState);

    var relaxedDiag = isPlainObject(relaxedState.diagnostics)
        ? relaxedState.diagnostics : {};
    var relaxedUnresolvedCount = Array.isArray(relaxedDiag.unresolvedSlots)
        ? relaxedDiag.unresolvedSlots.length : 0;

    var impactedSlotsCount = (typeof diag.preCheckUnresolvedCount === 'number')
        ? diag.preCheckUnresolvedCount
        : (Array.isArray(diag.unresolvedSlots) ? diag.unresolvedSlots.length : 0);

    var warning;
    if (relaxedUnresolvedCount === 0) {
        // AC 4.2 — strict failed but relaxed succeeded → same-day is the cause.
        warning = {
            type: 'same_day_relaxation_suggested',
            impactedSlotsCount: impactedSlotsCount,
            message: 'غير ممكن التغطية بدون السماح بحراسة نفس الأستاذ صباحاً ومساءً في نفس اليوم. هل تريد تفعيل هذا الخيار؟'
        };
    } else {
        // AC 4.2a — both runs failed → root cause is structural.
        warning = {
            type: 'coverage_infeasible_regardless',
            impactedSlotsCount: impactedSlotsCount,
            message: 'التغطية الكاملة غير ممكنة حتى مع تفعيل السماح بنفس اليوم — راجع عدد الأساتذة أو الإعفاءات.'
        };
    }

    var nextWarnings = Array.isArray(diag.warnings) ? diag.warnings.slice() : [];
    nextWarnings.push(warning);

    var nextDiag = Object.assign({}, diag, {
        warnings: nextWarnings,
        errors: Array.isArray(diag.errors) ? diag.errors.slice() : [],
        unresolvedSlots: Array.isArray(diag.unresolvedSlots)
            ? diag.unresolvedSlots.slice() : [],
        preCheckRelaxedUnresolvedCount: relaxedUnresolvedCount
    });

    var ns = shallowCopyState(state);
    ns.diagnostics = nextDiag;
    return ns;
}

// ---------------------------------------------------------------------------
// runOrchestrator — full V3 pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full V3 distribution pipeline.
 *
 * @param {Object} input  - GS3 input contract.
 * @param {Object} [options]
 * @param {number} [options.totalBudgetMs=30000] - global wall-clock budget.
 * @returns {{
 *   result: Array,                 // ResultRow[] (V2-shape compatible)
 *   diagnostics: Object,           // DiagnosticsV3
 *   algorithmVersion: 'v3',
 *   orchestratorState: 'COMPLETED'|'DEGRADED'|'TIMEOUT'|'ERROR'|'INVALID_INPUT'
 * }}
 */
function runOrchestrator(input, options) {
    // -----------------------------------------------------------------------
    // CLOSURE-LOCAL state. NO module-level mutable variables (V2 had a
    // module-level `_isRunning` flag for re-entrancy — we do not).
    // -----------------------------------------------------------------------
    var startTime = nowMs();
    var opts = isPlainObject(options) ? options : {};
    var totalBudgetMs = (typeof opts.totalBudgetMs === 'number' && opts.totalBudgetMs > 0)
        ? opts.totalBudgetMs
        : DEFAULT_TOTAL_BUDGET_MS;

    var phaseDurations = {};
    var orchestratorErrors = [];   // structured errors collected by the orchestrator wrapper
    var orchestratorWarnings = []; // structured warnings (e.g. phase_timeout)
    var timedOut = false;
    var fatalError = null;

    function remainingBudget() {
        var elapsed = nowMs() - startTime;
        return Math.max(0, totalBudgetMs - elapsed);
    }

    function isOverBudget() {
        return remainingBudget() <= 0;
    }

    /**
     * Run a single phase wrapped in try/catch + timing + budget enforcement.
     *
     * - On exception: record a structured error in `orchestratorErrors`
     *   and return `prevState` UNCHANGED so the next phase can still run.
     *   (AC 12.5 — "continue with successor state".)
     * - On budget exhaustion BEFORE invocation: skip the phase and record
     *   a `phase_timeout` warning. (AC 12.6.)
     * - Records elapsed time in `phaseDurations[phaseName]`.
     */
    function runPhase(phaseName, phaseFn, prevState) {
        if (isOverBudget()) {
            timedOut = true;
            orchestratorWarnings.push({
                type: 'phase_timeout',
                phase: phaseName,
                durationMs: 0,
                message: 'Phase ' + phaseName + ' skipped — global time budget exhausted before invocation.'
            });
            return prevState;
        }
        var t0 = nowMs();
        try {
            var nextState = phaseFn(prevState);
            phaseDurations[phaseName] = nowMs() - t0;
            // If the phase exhausted the budget mid-run, mark it but
            // keep the produced state — the phase's own internal
            // budget handling will have already returned a partial.
            if (isOverBudget()) {
                timedOut = true;
                orchestratorWarnings.push({
                    type: 'phase_timeout',
                    phase: phaseName,
                    durationMs: phaseDurations[phaseName],
                    message: 'Phase ' + phaseName + ' completed but global time budget is now exhausted.'
                });
            }
            return nextState;
        } catch (err) {
            phaseDurations[phaseName] = nowMs() - t0;
            orchestratorErrors.push({
                type: 'phase_exception',
                phase: phaseName,
                message: err && err.message ? String(err.message) : String(err),
                details: {
                    name: err && err.name ? String(err.name) : 'Error',
                    stack: err && err.stack ? String(err.stack) : null
                }
            });
            // Per AC 12.5 — continue with successor state. Returning
            // `prevState` lets later phases at least see a consistent view.
            return prevState;
        }
    }

    // -----------------------------------------------------------------------
    // Phase 0 — Validate input. If invalid, short-circuit with a structured
    // result and orchestrator state 'INVALID_INPUT'.
    // -----------------------------------------------------------------------
    var validation;
    try {
        validation = validateInput(input);
    } catch (err) {
        validation = {
            valid: false,
            errors: [{
                type: 'validate_input_exception',
                message: err && err.message ? String(err.message) : String(err)
            }]
        };
    }

    if (!validation || !validation.valid) {
        // Short-circuit: nothing else can run safely.
        var validationErrors = (validation && Array.isArray(validation.errors))
            ? validation.errors.slice()
            : [{ type: 'invalid_input', message: 'validateInput returned invalid result' }];

        // Normalize each error to the structured-object shape expected by
        // V3's diagnostics contract (V2 used strings — we explicitly do not).
        for (var ve = 0; ve < validationErrors.length; ve += 1) {
            if (typeof validationErrors[ve] === 'string') {
                validationErrors[ve] = {
                    type: 'invalid_input',
                    message: validationErrors[ve],
                    phase: 'validate'
                };
            } else if (isPlainObject(validationErrors[ve])) {
                if (!validationErrors[ve].phase) {
                    validationErrors[ve] = Object.assign(
                        { phase: 'validate' },
                        validationErrors[ve]
                    );
                }
            }
        }

        var invalidDiag = {
            algorithmVersion: 'v3',
            seedUsed: 0,
            totalDurationMs: nowMs() - startTime,
            phaseDurations: { validate: 0 },
            histogramByGuardCount: {},
            histogramByPrimaryLoad: {},
            min: 0,
            max: 0,
            distinctCount: 0,
            globalLowerBound: 0,
            globalUpperBound: 0,
            classBoundsByProctorKey: {},
            unresolvedSlots: [],
            coverageWarnings: [],
            coverageRepairSwaps: 0,
            coverageRepairUnresolved: 0,
            orphanInputKeys: [],
            amPmImbalanceByProctorKey: {},
            zeroLoadProctors: [],
            reserveImbalances: [],
            finalLoadOverflows: [],
            warnings: [],
            errors: validationErrors,
            preCheckRequired: false
        };

        return {
            result: [],
            diagnostics: invalidDiag,
            algorithmVersion: 'v3',
            orchestratorState: 'INVALID_INPUT'
        };
    }

    // -----------------------------------------------------------------------
    // Pipeline state initialization. Closure-local — never module-level.
    // -----------------------------------------------------------------------
    var seedUsed;
    if (isPlainObject(input) && Number.isFinite(input.randomSeed)) {
        seedUsed = input.randomSeed;
    } else {
        seedUsed = deriveSeedFromClock();
    }

    var rng;
    try {
        rng = createPRNG(seedUsed);
    } catch (err) {
        // Defensive: fall back to clock-derived seed if input.randomSeed
        // was non-finite for some pathological reason.
        seedUsed = deriveSeedFromClock();
        rng = createPRNG(seedUsed);
    }

    var state = {
        input: input,
        options: opts,
        rng: rng,
        startTime: startTime,
        diagnostics: freshDiagnostics()
    };

    // -----------------------------------------------------------------------
    // Phases 1 → 1b → 2 → 3
    // -----------------------------------------------------------------------
    state = runPhase('normalizeKeys', normalizeKeys, state);
    state = runPhase('buildRoomsAndRows', buildRoomsAndRows, state);
    state = runPhase('eligibilityClasses', deriveEligibilityClasses, state);
    state = runPhase('bounds', computeBounds, state);

    // Pre-load duty into loadState before Phase 4. Wrapped in try/catch so
    // a malformed normalizedDutyData doesn't abort the pipeline.
    try {
        if (!state.loadState) {
            state.loadState = seedLoadStateWithDuty(state);
        }
    } catch (err) {
        orchestratorErrors.push({
            type: 'phase_exception',
            phase: 'seedLoadState',
            message: err && err.message ? String(err.message) : String(err)
        });
        // Provide an empty loadState so phase 4 doesn't crash on undefined.
        state.loadState = createLoadState([]);
    }

    // -----------------------------------------------------------------------
    // Phase 4 — Place Guards (heart of the algorithm).
    // -----------------------------------------------------------------------
    state = runPhase('placeGuards', placeGuards, state);

    // -----------------------------------------------------------------------
    // Phase 5 — Multi-Step Coverage Repair.
    // -----------------------------------------------------------------------
    state = runPhase('coverageRepair', multiStepCoverageRepair, state);

    // -----------------------------------------------------------------------
    // Phase 6 — Same-Day Infeasibility Detection (pure inspection).
    // -----------------------------------------------------------------------
    state = runPhase('sameDayDetect', detectSameDayInfeasibility, state);

    // -----------------------------------------------------------------------
    // Conditional pre-check (orchestrator-level — NOT inside Phase 6).
    // Triggered by `state.diagnostics.preCheckRequired === true` AND a
    // remaining budget of at least 7s (design.md §4 Phase 6 + §9).
    // -----------------------------------------------------------------------
    var diagAfterPhase6 = isPlainObject(state.diagnostics) ? state.diagnostics : {};
    if (diagAfterPhase6.preCheckRequired === true) {
        if (remainingBudget() >= PRECHECK_MIN_REMAINING_MS) {
            state = runPhase('sameDayPreCheck', function (s) {
                return runSameDayPreCheck(s, {
                    phase4BudgetMs: DEFAULT_PRECHECK_PHASE4_BUDGET_MS,
                    phase5BudgetMs: DEFAULT_PRECHECK_PHASE5_BUDGET_MS
                });
            }, state);
        } else {
            // Skip the pre-check but record why so consumers can tell
            // the difference between "not needed" and "skipped due to budget".
            orchestratorWarnings.push({
                type: 'precheck_skipped',
                phase: 'sameDayPreCheck',
                remainingMs: remainingBudget(),
                message: 'Same-day pre-check skipped — remaining budget below 7s threshold.'
            });
        }
    }

    // -----------------------------------------------------------------------
    // Phases 7 → 8 → 9
    // -----------------------------------------------------------------------
    state = runPhase('bimodalRepair', bimodalRepair, state);
    state = runPhase('ampmBalance', ampmBalance, state);
    state = runPhase('placeReserves', placeReserves, state);

    // -----------------------------------------------------------------------
    // Phase 10 — Finalize. Done even if previous phases erred so the user
    // gets the best-effort result with diagnostics.
    // -----------------------------------------------------------------------
    state = runPhase('finalize', finalize, state);

    // -----------------------------------------------------------------------
    // Merge orchestrator-level errors/warnings into final diagnostics.
    // Phase 10 (finalize) emits a fully-formed DiagnosticsV3 — we extend
    // its `errors` and `warnings` with any orchestrator-level entries.
    // -----------------------------------------------------------------------
    var finalDiag;
    if (isPlainObject(state.diagnostics)
        && state.diagnostics.algorithmVersion === 'v3') {
        // Phase 10 produced a full diagnostics envelope.
        finalDiag = state.diagnostics;
    } else {
        // Phase 10 was skipped or errored. Build a fallback envelope from
        // whatever state we have. `buildDiagnostics` is defensive and will
        // produce a usable object even with a partial state.
        try {
            finalDiag = buildDiagnostics(state);
        } catch (err) {
            orchestratorErrors.push({
                type: 'diagnostics_build_failure',
                phase: 'finalize',
                message: err && err.message ? String(err.message) : String(err)
            });
            finalDiag = {
                algorithmVersion: 'v3',
                seedUsed: seedUsed,
                totalDurationMs: nowMs() - startTime,
                phaseDurations: phaseDurations,
                histogramByGuardCount: {},
                histogramByPrimaryLoad: {},
                min: 0,
                max: 0,
                distinctCount: 0,
                globalLowerBound: 0,
                globalUpperBound: 0,
                classBoundsByProctorKey: {},
                unresolvedSlots: [],
                coverageWarnings: [],
                coverageRepairSwaps: 0,
                coverageRepairUnresolved: 0,
                orphanInputKeys: [],
                amPmImbalanceByProctorKey: {},
                zeroLoadProctors: [],
                reserveImbalances: [],
                finalLoadOverflows: [],
                warnings: [],
                errors: []
            };
            fatalError = err;
        }
    }

    // Extend with orchestrator-level errors/warnings. Always produce fresh
    // arrays so we never mutate diagnostics state we received.
    var mergedErrors = Array.isArray(finalDiag.errors) ? finalDiag.errors.slice() : [];
    var mergedWarnings = Array.isArray(finalDiag.warnings) ? finalDiag.warnings.slice() : [];
    for (var oe = 0; oe < orchestratorErrors.length; oe += 1) {
        mergedErrors.push(orchestratorErrors[oe]);
    }
    for (var ow = 0; ow < orchestratorWarnings.length; ow += 1) {
        mergedWarnings.push(orchestratorWarnings[ow]);
    }

    // Refresh the diagnostics with merged collections + canonical
    // phaseDurations / totalDurationMs computed at orchestrator level
    // (covers phases that ran in try/catch and never updated state).
    var totalDurationMs = nowMs() - startTime;
    finalDiag = Object.assign({}, finalDiag, {
        errors: mergedErrors,
        warnings: mergedWarnings,
        phaseDurations: Object.assign({}, finalDiag.phaseDurations || {}, phaseDurations),
        totalDurationMs: totalDurationMs,
        seedUsed: seedUsed
    });

    // -----------------------------------------------------------------------
    // Determine orchestratorState (V2 had a dead branch — V3 must emit
    // distinct states).
    //
    //   ERROR     → fatal exception that prevented even building diagnostics
    //   TIMEOUT   → global budget exhausted at any point
    //   DEGRADED  → completed but errors[] non-empty (or unresolvedSlots > 0)
    //   COMPLETED → clean run with no errors and no unresolved slots
    // -----------------------------------------------------------------------
    var rows = Array.isArray(state.result)
        ? state.result
        : (Array.isArray(state.rows) ? state.rows : []);

    var orchestratorState;
    if (fatalError) {
        orchestratorState = 'ERROR';
    } else if (timedOut) {
        orchestratorState = 'TIMEOUT';
    } else if (mergedErrors.length > 0
        || (Array.isArray(finalDiag.unresolvedSlots) && finalDiag.unresolvedSlots.length > 0)) {
        orchestratorState = 'DEGRADED';
    } else {
        orchestratorState = 'COMPLETED';
    }

    return {
        result: rows,
        diagnostics: finalDiag,
        algorithmVersion: 'v3',
        orchestratorState: orchestratorState
    };
}

module.exports = {
    runOrchestrator: runOrchestrator,
    runSameDayPreCheck: runSameDayPreCheck,
    _internals: {
        buildRelaxedState: buildRelaxedState,
        seedLoadStateWithDuty: seedLoadStateWithDuty,
        DEFAULT_TOTAL_BUDGET_MS: DEFAULT_TOTAL_BUDGET_MS,
        DEFAULT_PRECHECK_PHASE4_BUDGET_MS: DEFAULT_PRECHECK_PHASE4_BUDGET_MS,
        DEFAULT_PRECHECK_PHASE5_BUDGET_MS: DEFAULT_PRECHECK_PHASE5_BUDGET_MS,
        PRECHECK_MIN_REMAINING_MS: PRECHECK_MIN_REMAINING_MS
    }
};
    };

    __modules["/js/algorithms/proctor-v3/phases/00-validate.js"] = function (module, exports, require, __dirname, __filename) {
// Proctor Distribution V3 — Phase 0: Validate Input.
//
// Pure function: inspects the raw input contract and returns either a
// success result `{ valid: true, errors: [] }` or a failure result
// `{ valid: false, errors: [...] }` where each error is a structured object
// of the shape `{ type, message, field?, details? }`.
//
// This phase only checks coarse-grained shape (presence and basic types) of
// the top-level fields the rest of the pipeline depends on. Finer-grained
// validation (e.g., per-row schedule entry shape, per-room invariants) is
// performed by later phases that own that domain.
//
// Required fields (per Acceptance Criterion 1.3 and design.md Phase 0):
//   - proctorsList         : non-null array
//   - scheduleEntries      : non-null array
//   - examDistributionRules: non-null plain object
//
// Optional fields validated when present:
//   - examCenterLevels     : when present, must be a plain object whose
//                            values are objects (lenient — only top-level
//                            shape is enforced here)
//
// V2 pitfall avoided (Task 23 of tasks.md): V2 emitted errors as plain
// strings, which made downstream programmatic handling and serialization
// brittle. V3 emits structured error objects so callers can branch on
// `error.type` and surface details consistently.

'use strict';

/**
 * @typedef {Object} ValidationError
 * @property {string} type    - Stable machine-readable error code (snake_case).
 * @property {string} message - Human-readable English message.
 * @property {string} [field] - Dotted path of the offending field (when applicable).
 * @property {Object} [details] - Optional structured context.
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {ValidationError[]} errors
 */

function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    return true;
}

function describeType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

/**
 * Validate the top-level shape of the GS3_Input_Contract.
 *
 * Always returns synchronously; never throws on malformed input. Callers
 * should treat a `valid: false` return as a hard stop and surface
 * `errors` to the user/diagnostics rather than proceeding with downstream
 * phases.
 *
 * @param {unknown} input - the raw input passed to the orchestrator
 * @returns {ValidationResult}
 */
function validateInput(input) {
    var errors = [];

    if (input === null || input === undefined) {
        errors.push({
            type: 'missing_input',
            message: 'Input is null or undefined.',
            field: 'input'
        });
        return { valid: false, errors: errors };
    }

    if (!isPlainObject(input)) {
        errors.push({
            type: 'invalid_input_type',
            message: 'Input must be a plain object.',
            field: 'input',
            details: { actualType: describeType(input) }
        });
        return { valid: false, errors: errors };
    }

    // ---- Required field: proctorsList -------------------------------------
    if (!('proctorsList' in input) || input.proctorsList === undefined || input.proctorsList === null) {
        errors.push({
            type: 'missing_field',
            message: 'Required field "proctorsList" is missing.',
            field: 'proctorsList'
        });
    } else if (!Array.isArray(input.proctorsList)) {
        errors.push({
            type: 'invalid_field_type',
            message: 'Field "proctorsList" must be an array.',
            field: 'proctorsList',
            details: {
                expectedType: 'array',
                actualType: describeType(input.proctorsList)
            }
        });
    }

    // ---- Required field: scheduleEntries ----------------------------------
    if (!('scheduleEntries' in input) || input.scheduleEntries === undefined || input.scheduleEntries === null) {
        errors.push({
            type: 'missing_field',
            message: 'Required field "scheduleEntries" is missing.',
            field: 'scheduleEntries'
        });
    } else if (!Array.isArray(input.scheduleEntries)) {
        errors.push({
            type: 'invalid_field_type',
            message: 'Field "scheduleEntries" must be an array.',
            field: 'scheduleEntries',
            details: {
                expectedType: 'array',
                actualType: describeType(input.scheduleEntries)
            }
        });
    }

    // ---- Required field: examDistributionRules ----------------------------
    if (!('examDistributionRules' in input) || input.examDistributionRules === undefined || input.examDistributionRules === null) {
        errors.push({
            type: 'missing_field',
            message: 'Required field "examDistributionRules" is missing.',
            field: 'examDistributionRules'
        });
    } else if (!isPlainObject(input.examDistributionRules)) {
        errors.push({
            type: 'invalid_field_type',
            message: 'Field "examDistributionRules" must be a plain object.',
            field: 'examDistributionRules',
            details: {
                expectedType: 'object',
                actualType: describeType(input.examDistributionRules)
            }
        });
    }

    // ---- Optional field: examCenterLevels ---------------------------------
    // Lenient top-level check only. Each value should expose a `rooms` array
    // when present, but we don't fail validation on a missing or wrongly
    // typed `rooms` here — Phase 1b owns that responsibility and emits
    // diagnostics warnings for partial data. We DO fail the top-level shape
    // (object vs array vs primitive) since downstream code indexes into it
    // with bracket notation.
    if ('examCenterLevels' in input && input.examCenterLevels !== undefined && input.examCenterLevels !== null) {
        if (!isPlainObject(input.examCenterLevels)) {
            errors.push({
                type: 'invalid_field_type',
                message: 'Optional field "examCenterLevels" must be a plain object when present.',
                field: 'examCenterLevels',
                details: {
                    expectedType: 'object',
                    actualType: describeType(input.examCenterLevels)
                }
            });
        } else {
            var keys = Object.keys(input.examCenterLevels);
            for (var i = 0; i < keys.length; i += 1) {
                var levelKey = keys[i];
                var levelValue = input.examCenterLevels[levelKey];
                if (levelValue === null || levelValue === undefined) {
                    // Treat null/undefined values as absent — Phase 1b handles fallback.
                    continue;
                }
                if (!isPlainObject(levelValue)) {
                    errors.push({
                        type: 'invalid_field_type',
                        message:
                            'Each value in "examCenterLevels" must be a plain object when present.',
                        field: 'examCenterLevels.' + levelKey,
                        details: {
                            expectedType: 'object',
                            actualType: describeType(levelValue)
                        }
                    });
                }
            }
        }
    }

    if (errors.length > 0) {
        return { valid: false, errors: errors };
    }
    return { valid: true, errors: [] };
}

module.exports = { validateInput };
    };

    __modules["/js/algorithms/proctor-v3/phases/01-normalize-keys.js"] = function (module, exports, require, __dirname, __filename) {
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
    };

    __modules["/js/algorithms/proctor-v3/phases/01b-build-rooms-and-rows.js"] = function (module, exports, require, __dirname, __filename) {
// Proctor Distribution V3 — Phase 1b: Build Rooms and Empty Result Rows.
//
// Pure function: takes a `state` object containing `state.input` (per
// GS3_Input_Contract) and returns a NEW state with the following fields
// populated/extended:
//   - rows                 : array of empty Result_Row objects, one per
//                            (scheduleEntry, room) pair. Every row has:
//                              session_key, halfday_key, day_key,
//                              room_key, room_name, level, subject,
//                              proctor_keys (array of length proctorsPerRoom
//                              filled with null), proctors, reserves,
//                              reserve_keys, duty_teachers, softViolations
//                            (every array is a FRESH reference — no two rows
//                            share an array, per Acceptance Criterion 10.2).
//   - diagnostics          : carries forward existing warnings/errors and
//                            appends `synthetic_rooms` warnings (one per
//                            level that required synthesis) and
//                            `exam_center_levels_missing` warning (when
//                            applicable).
//
// Acceptance Criteria covered:
//   - 11.1 : rooms_count(L) sourced primarily from examCenterLevels[L].rooms.
//   - 11.2 : when examCenterLevels[L].rooms = N > examCenterRoomsData[L].length = M,
//            synthesize (N - M) in-memory placeholder rooms AND record a
//            structured warning.
//   - 11.3 : when examCenterLevels[L].rooms is 0/undefined, fall back to
//            examCenterRoomsData rows; no synthesis.
//   - 11.4 : when examCenterLevels is absent/empty, only use
//            examCenterRoomsData; record `exam_center_levels_missing`.
//   - 11.5 : when total guard slots produced for a level mismatches expected
//            (rooms × sessions × proctorsPerRoom), record `level_slot_mismatch`.
//   - 11.6 : synthesized rooms NEVER persisted (purely in-memory in `rows`).
//
// Purity contract:
//   - `state.input`, `state.input.examCenterRoomsData`, `state.input.examCenterLevels`
//     are NOT mutated; all reads are non-destructive.
//   - The returned state is a fresh object; only `rows` and `diagnostics`
//     fields are added/replaced. Every other field is shallow-copied.
//   - `state.diagnostics` is created as `{ warnings: [], errors: [] }` if
//     not already present, then a NEW diagnostics object is produced with
//     fresh `warnings`/`errors` arrays so the caller's existing diagnostics
//     are untouched.

'use strict';

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
 * Extract the level name from a schedule entry. Supports both the canonical
 * design field `level` and the production fixture field `level_name`.
 * @param {Object} entry
 * @returns {string}
 */
function extractLevel(entry) {
    if (!entry || typeof entry !== 'object') return '';
    if (typeof entry.level === 'string' && entry.level.length > 0) return entry.level;
    if (typeof entry.level_name === 'string' && entry.level_name.length > 0) return entry.level_name;
    return '';
}

/**
 * Extract the period (halfday descriptor) from a schedule entry.
 * @param {Object} entry
 * @returns {string}
 */
function extractPeriod(entry) {
    if (!entry || typeof entry !== 'object') return '';
    if (typeof entry.period === 'string' && entry.period.length > 0) return entry.period;
    return '';
}

/**
 * Extract the date in canonical YYYY-MM-DD form. Supports either an explicit
 * `date` field (already formatted) or the production fixture's
 * `date_year`/`date_month`/`date_day` triplet.
 * @param {Object} entry
 * @returns {string}
 */
function extractDate(entry) {
    if (!entry || typeof entry !== 'object') return '';
    if (typeof entry.date === 'string' && entry.date.length > 0) return entry.date;
    var y = entry.date_year != null ? String(entry.date_year) : '';
    var m = entry.date_month != null ? String(entry.date_month) : '';
    var d = entry.date_day != null ? String(entry.date_day) : '';
    if (!y && !m && !d) return '';
    // Pad month/day to two digits for canonical form.
    if (m.length === 1) m = '0' + m;
    if (d.length === 1) d = '0' + d;
    return y + '-' + m + '-' + d;
}

/**
 * Extract the subject name from a schedule entry. Supports `subject` or
 * `subject_name`.
 * @param {Object} entry
 * @returns {string}
 */
function extractSubject(entry) {
    if (!entry || typeof entry !== 'object') return '';
    if (typeof entry.subject === 'string' && entry.subject.length > 0) return entry.subject;
    if (typeof entry.subject_name === 'string' && entry.subject_name.length > 0) return entry.subject_name;
    return '';
}

/**
 * Extract the session label, used to disambiguate multiple sequential
 * sessions inside a single halfday (e.g. الحصة الأولى vs الحصة الثانية).
 * @param {Object} entry
 * @returns {string}
 */
function extractSessionLabel(entry) {
    if (!entry || typeof entry !== 'object') return '';
    if (typeof entry.session === 'string' && entry.session.length > 0) return entry.session;
    return '';
}

/**
 * Build the canonical session_key from a schedule entry. Follows the format
 * documented in the task: `${date}|${period}|${level}|${subject}` with the
 * session label appended when present so two consecutive sessions on the
 * same halfday/level are distinguishable.
 * @param {Object} entry
 * @returns {string}
 */
function buildSessionKey(entry) {
    var date = extractDate(entry);
    var period = extractPeriod(entry);
    var level = extractLevel(entry);
    var subject = extractSubject(entry);
    var session = extractSessionLabel(entry);
    var base = date + '|' + period + '|' + level + '|' + subject;
    if (session) base += '|' + session;
    return base;
}

/**
 * Build the halfday_key (`${date}|${period}`).
 * @param {Object} entry
 * @returns {string}
 */
function buildHalfdayKey(entry) {
    return extractDate(entry) + '|' + extractPeriod(entry);
}

/**
 * Compute a deterministic room_key from a real (non-synthetic) room object.
 * Mirrors V2's `getRoomConstraintKey` precedence: `key`, `room_num`,
 * `roomName`. Falls back to a level/index composite to guarantee
 * uniqueness inside this run.
 * @param {Object} room
 * @param {string} levelName
 * @param {number} idx     - position of the room within its level array
 * @returns {string}
 */
function buildRealRoomKey(room, levelName, idx) {
    if (room && typeof room === 'object') {
        if (typeof room.key === 'string' && room.key.length > 0) return String(room.key).trim();
        if (room.room_num != null && String(room.room_num).length > 0) {
            return String(room.room_num).trim();
        }
        if (typeof room.roomName === 'string' && room.roomName.length > 0) return room.roomName;
        if (typeof room.room_name === 'string' && room.room_name.length > 0) return room.room_name;
    }
    return '__room_' + levelName + '_' + idx;
}

/**
 * Compute a display-friendly room_name from a real room object. Falls back
 * to a sequential "Salle N" form if the room object lacks any name field.
 * @param {Object} room
 * @param {number} sequentialNumber
 * @returns {string}
 */
function buildRealRoomName(room, sequentialNumber) {
    if (room && typeof room === 'object') {
        if (typeof room.roomName === 'string' && room.roomName.length > 0) return room.roomName;
        if (typeof room.room_name === 'string' && room.room_name.length > 0) return room.room_name;
        if (room.room_num != null && String(room.room_num).length > 0) {
            return 'Salle ' + String(room.room_num).trim();
        }
    }
    return 'Salle ' + sequentialNumber;
}

/**
 * Pull the configured proctorsPerRoom value from input rules. Defaults to
 * 1 when the field is absent or non-positive (matches task guidance).
 * @param {Object} input
 * @returns {number}
 */
function readProctorsPerRoom(input) {
    var rules = input && input.examDistributionRules;
    if (!isPlainObject(rules)) return 1;
    var raw = rules.proctorsPerRoom;
    var n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.floor(n);
}

/**
 * Read examCenterLevels[level].rooms as a non-negative integer; returns
 * `null` when the level entry is missing OR when the `rooms` field is
 * absent/zero/non-numeric (signals "fall back to actual rows" per AC 11.3).
 * @param {Object|null|undefined} examCenterLevels
 * @param {string} level
 * @returns {number|null}
 */
function readTargetRoomsForLevel(examCenterLevels, level) {
    if (!isPlainObject(examCenterLevels)) return null;
    var entry = examCenterLevels[level];
    if (!isPlainObject(entry)) return null;
    var n = Number(entry.rooms);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.floor(n);
}

/**
 * Read the rooms array for a level, honoring the input-boundary precedence
 * required to accept the same GS3_Input_Contract as V2 (Acceptance
 * Criterion 1.3):
 *   1. `examCenterRoomsData[level]` — the design-canonical shape
 *      (`{ [level]: RoomRow[] }`). Used when present and non-empty.
 *   2. `options.roomsList[level]` — the V2/production shape. V2 reads rooms
 *      exactly this way (see `getRoomsForEntry`: `roomsList[levelName]`).
 *      Each room is `{ key, level_name, room_num, roomName, wing, ... }`.
 *
 * Returns `[]` for any non-array value (including missing/null/object-of-keys
 * forms).
 * @param {Object|null|undefined} examCenterRoomsData
 * @param {Object|null|undefined} roomsList
 * @param {string} level
 * @returns {Array}
 */
function readActualRoomsForLevel(examCenterRoomsData, roomsList, level) {
    if (isPlainObject(examCenterRoomsData)) {
        var rows = examCenterRoomsData[level];
        if (Array.isArray(rows) && rows.length > 0) return rows;
    }
    if (isPlainObject(roomsList)) {
        var fallback = roomsList[level];
        if (Array.isArray(fallback)) return fallback;
    }
    return [];
}

/**
 * Build the final list of "effective" rooms for a level: real rooms first
 * (capped at target N when target is known), followed by synthesized
 * placeholders to reach N. Returns the rooms list and the count of
 * synthesized rooms (0 if none).
 *
 * @param {string} level
 * @param {number|null} target - examCenterLevels[L].rooms; null when unknown
 * @param {Array} actualRooms  - examCenterRoomsData[L]
 * @returns {{ rooms: Array<{key:string,name:string,_synthetic:boolean}>, syntheticCount:number, actualUsed:number }}
 */
function resolveRoomsForLevel(level, target, actualRooms) {
    var actualCount = actualRooms.length;
    var rooms = [];
    var syntheticCount = 0;

    if (target === null) {
        // No examCenterLevels guidance — use whatever real rooms exist.
        for (var i = 0; i < actualCount; i += 1) {
            rooms.push({
                key: buildRealRoomKey(actualRooms[i], level, i),
                name: buildRealRoomName(actualRooms[i], i + 1),
                _synthetic: false
            });
        }
        return { rooms: rooms, syntheticCount: 0, actualUsed: actualCount };
    }

    if (target <= actualCount) {
        // Use the first `target` real rooms only (slice — do not mutate input).
        for (var j = 0; j < target; j += 1) {
            rooms.push({
                key: buildRealRoomKey(actualRooms[j], level, j),
                name: buildRealRoomName(actualRooms[j], j + 1),
                _synthetic: false
            });
        }
        return { rooms: rooms, syntheticCount: 0, actualUsed: target };
    }

    // M < N: take all real rooms, then synthesize the remainder.
    for (var k = 0; k < actualCount; k += 1) {
        rooms.push({
            key: buildRealRoomKey(actualRooms[k], level, k),
            name: buildRealRoomName(actualRooms[k], k + 1),
            _synthetic: false
        });
    }
    var missing = target - actualCount;
    for (var s = 0; s < missing; s += 1) {
        rooms.push({
            key: '__synth_' + level + '_' + s,
            name: 'Salle ' + (actualCount + 1 + s),
            _synthetic: true
        });
    }
    syntheticCount = missing;
    return { rooms: rooms, syntheticCount: syntheticCount, actualUsed: actualCount };
}

/**
 * Build an empty Result_Row for the given (entry, room) pair. Every array
 * is a FRESH reference (Acceptance Criterion 10.2).
 *
 * @param {Object} entry
 * @param {{key:string, name:string}} room
 * @param {number} proctorsPerRoom
 * @returns {Object}
 */
function buildEmptyRow(entry, room, proctorsPerRoom) {
    var sessionKey = buildSessionKey(entry);
    var halfdayKey = buildHalfdayKey(entry);
    var dayKey = extractDate(entry);
    var level = extractLevel(entry);
    var subject = extractSubject(entry);

    var proctorKeys = new Array(proctorsPerRoom);
    for (var i = 0; i < proctorsPerRoom; i += 1) {
        proctorKeys[i] = null;
    }

    return {
        session_key: sessionKey,
        halfday_key: halfdayKey,
        day_key: dayKey,
        room_key: room.key,
        room_name: room.name,
        level: level,
        subject: subject,
        proctor_keys: proctorKeys,
        proctors: [],
        reserve_keys: [],
        reserves: [],
        duty_teachers: [],
        softViolations: []
    };
}

/**
 * Phase 1b entry point.
 *
 * @param {Object} state - pipeline state; must contain `state.input`
 * @returns {Object} new state with `rows` and `diagnostics` populated
 */
function buildRoomsAndRows(state) {
    if (state === null || state === undefined) {
        throw new TypeError('buildRoomsAndRows: state must be an object');
    }
    var input = state.input;
    if (!isPlainObject(input)) {
        throw new TypeError('buildRoomsAndRows: state.input must be a plain object');
    }

    var scheduleEntries = Array.isArray(input.scheduleEntries) ? input.scheduleEntries : [];
    var examCenterLevels = isPlainObject(input.examCenterLevels) ? input.examCenterLevels : null;
    var examCenterRoomsData = isPlainObject(input.examCenterRoomsData) ? input.examCenterRoomsData : null;
    // V2/production input boundary: rooms supplied via options.roomsList,
    // an object keyed by level_name → RoomRow[] (Acceptance Criterion 1.3).
    var roomsList = (isPlainObject(input.options) && isPlainObject(input.options.roomsList))
        ? input.options.roomsList
        : null;
    var proctorsPerRoom = readProctorsPerRoom(input);

    // Carry diagnostics forward with FRESH arrays so we never mutate the
    // caller's state.diagnostics.warnings/errors.
    var prevDiag = isPlainObject(state.diagnostics) ? state.diagnostics : null;
    var prevWarnings = prevDiag && Array.isArray(prevDiag.warnings) ? prevDiag.warnings : [];
    var prevErrors = prevDiag && Array.isArray(prevDiag.errors) ? prevDiag.errors : [];
    var warnings = prevWarnings.slice();
    var errors = prevErrors.slice();

    // Emit `exam_center_levels_missing` once when applicable (AC 11.4).
    if (
        examCenterLevels === null
        || (examCenterLevels && Object.keys(examCenterLevels).length === 0)
    ) {
        warnings.push({
            type: 'exam_center_levels_missing',
            message: 'examCenterLevels is absent or empty; falling back to examCenterRoomsData only.'
        });
    }

    // Resolve rooms once per level (deterministic) so multiple schedule
    // entries on the same level reuse the same room objects (and we only
    // emit one synthetic_rooms warning per level, regardless of how many
    // sessions reference it).
    var roomsByLevel = Object.create(null);
    var sessionsByLevel = Object.create(null);
    var sortedLevels = [];

    for (var ei = 0; ei < scheduleEntries.length; ei += 1) {
        var entry = scheduleEntries[ei];
        var lvl = extractLevel(entry);
        if (!lvl) continue;
        if (!(lvl in sessionsByLevel)) {
            sessionsByLevel[lvl] = 0;
            sortedLevels.push(lvl);
        }
        sessionsByLevel[lvl] += 1;
    }
    sortedLevels.sort();

    for (var li = 0; li < sortedLevels.length; li += 1) {
        var level = sortedLevels[li];
        var target = readTargetRoomsForLevel(examCenterLevels, level);
        var actualRooms = readActualRoomsForLevel(examCenterRoomsData, roomsList, level);
        var resolved = resolveRoomsForLevel(level, target, actualRooms);
        roomsByLevel[level] = resolved.rooms;

        if (resolved.syntheticCount > 0) {
            warnings.push({
                type: 'synthetic_rooms',
                level: level,
                requestedCount: target,
                actualCount: resolved.actualUsed,
                syntheticCount: resolved.syntheticCount,
                addedCount: resolved.syntheticCount,
                message:
                    'Synthesized ' + resolved.syntheticCount + ' placeholder room(s) for level "' +
                    level + '" (requested ' + target + ', actual ' + resolved.actualUsed + ').'
            });
        }

        // AC 11.5: detect level-level slot count mismatch when both target
        // and actual sessions are known. The expected count is computed
        // post-resolution (i.e. after synthesis), so a warning here only
        // fires when the resolved room count diverges from the configured
        // target — typically when target was null but actual rooms exist
        // and the user expected a specific number.
        if (target !== null && resolved.rooms.length !== target) {
            warnings.push({
                type: 'level_slot_mismatch',
                level: level,
                expected: target * sessionsByLevel[level] * proctorsPerRoom,
                actual: resolved.rooms.length * sessionsByLevel[level] * proctorsPerRoom,
                message:
                    'Resolved room count (' + resolved.rooms.length +
                    ') does not match examCenterLevels.rooms (' + target +
                    ') for level "' + level + '".'
            });
        }
    }

    // Materialize empty rows in schedule-entry order, then by room order
    // within each entry. This ordering is deterministic given the input.
    var rows = [];
    for (var si = 0; si < scheduleEntries.length; si += 1) {
        var s = scheduleEntries[si];
        var lvl2 = extractLevel(s);
        if (!lvl2) continue;
        var rooms = roomsByLevel[lvl2] || [];
        for (var ri = 0; ri < rooms.length; ri += 1) {
            rows.push(buildEmptyRow(s, rooms[ri], proctorsPerRoom));
        }
    }

    // Build the new state. Shallow-copy every field of `state` first, then
    // overlay the fields owned by this phase.
    var nextState = {};
    var stateKeys = Object.keys(state);
    for (var k = 0; k < stateKeys.length; k += 1) {
        nextState[stateKeys[k]] = state[stateKeys[k]];
    }
    nextState.rows = rows;
    nextState.diagnostics = {};
    if (prevDiag) {
        var diagKeys = Object.keys(prevDiag);
        for (var dk = 0; dk < diagKeys.length; dk += 1) {
            nextState.diagnostics[diagKeys[dk]] = prevDiag[diagKeys[dk]];
        }
    }
    nextState.diagnostics.warnings = warnings;
    nextState.diagnostics.errors = errors;

    return nextState;
}

module.exports = { buildRoomsAndRows };
    };

    __modules["/js/algorithms/proctor-v3/phases/02-eligibility-classes.js"] = function (module, exports, require, __dirname, __filename) {
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
    };

    __modules["/js/algorithms/proctor-v3/phases/03-bounds.js"] = function (module, exports, require, __dirname, __filename) {
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
    };

    __modules["/js/algorithms/proctor-v3/phases/04-place-guards.js"] = function (module, exports, require, __dirname, __filename) {
// Proctor Distribution V3 — Phase 4: Place Guards (CP solver invocation).
//
// Pure function: takes a `state` populated by Phases 0/1/1b/2/3 and returns
// a NEW state with guard slots filled. Each row's `proctor_keys` array is
// REPLACED (fresh array) with values produced by the CP solver in
// `solver/cp-solver.js`. The `loadState` is updated to reflect the
// committed assignments. Diagnostics are extended with:
//   - state.diagnostics.unresolvedSlots     : { rowIndex, slotIndex,
//                                                session_key, room_key,
//                                                reason } for every null
//                                                slot (reason in
//                                                'cp_partial' | 'cp_timeout').
//   - state.diagnostics.phase4              : solver stats + flags.
//
// Acceptance Criteria covered:
//   - 3.1 / 3.2 / 3.3 / 3.4 : eligibility filters in initial domains
//   - 3.5 / 3.6             : AllDifferent within row + within session
//   - 3.7 / 3.7a / 3.8      : C-NO-SAME-DAY (custom propagator, off when
//                             allowSameDayBothHalfdays === true)
//   - 3.10                  : null preserved + recorded in unresolvedSlots
//   - 5.6 / 5.9             : per-class upper-bound propagator
//   - 6.1 / 6.4 / 6.7 / 6.8 : soft costs (S-OWN-SUBJECT, S-AM-PM,
//                             S-NO-ROOM-REPEAT, S-GENDER)
//
// Variable id scheme:
//   `r{rowIndex}:s{slotIndex}` — deterministic, derived strictly from the
//   row order produced by Phase 1b and the slot index inside that row.
//
// Hard-constraint encoding:
//   1. Row AllDifferent — one constraint per row whose varGroup spans all
//      slot variables of that row.
//   2. Session AllDifferent — one constraint per distinct session_key whose
//      varGroup spans every slot variable of every row sharing that
//      session_key (covers cross-room collisions, AC 3.6).
//   3. Class upper-bound — one upperBound constraint per row whose varGroup
//      is the row's slot vars (matches the propagator's expected shape).
//   4. C-NO-SAME-DAY — ONE custom-revise constraint over all variables.
//      It iterates the singleton-domain variables grouped by canonical
//      key, then prunes any value k from a different-halfday-same-day
//      variable's domain when k is committed in another halfday of the
//      same day. This is O(V × singletons) per round; cheap enough for our
//      input sizes and sidesteps the combinatorial blowup of pairwise
//      constraints.
//
// Cost function components (weights from design.md §4 Phase 4):
//   - W_OWN_SUBJECT = 100 — proctor.subject == row.subject (case-insensitive)
//   - W_ROOM_REPEAT = 30  — same (proctor, room_key) appearing more than once
//   - W_GENDER      = 20  — same-gender pair within a row (when ≥2 slots and
//                            gender data available)
//   - W_AM_PM       = 50  — Σ |amCount(p) - pmCount(p)| over a TEMPORARY
//                            load state computed from the current assignment
//                            (does NOT mutate the caller's loadState).
//
// Purity contract:
//   - state.input is NOT mutated.
//   - state.rows is REPLACED with a NEW array of NEW row objects whose
//     proctor_keys array is ALSO fresh (no shared references).
//   - state.loadState IS mutated in place — by design, the load accumulator
//     flows through phases. Callers that need rollback must clone first.
//   - state.diagnostics is rebuilt as a fresh object with fresh arrays.

'use strict';

var path = require('path');

var hardConstraints = require(path.join(__dirname, '..', 'constraints', 'hard-constraints.js'));
var loadStateUtils = require(path.join(__dirname, '..', 'utils', 'load-state.js'));

var isExempt = hardConstraints.isExempt;
var isOnDuty = hardConstraints.isOnDuty;
var isMEBlocked = hardConstraints.isMEBlocked;
var wouldDoubleBookSession = hardConstraints.wouldDoubleBookSession;
var wouldViolateSameDay = hardConstraints.wouldViolateSameDay;
var wouldExceedClassUpper = hardConstraints.wouldExceedClassUpper;
var recordGuardOccupancy = hardConstraints.recordGuardOccupancy;

var addGuardLoad = loadStateUtils.addGuardLoad;
var amCount = loadStateUtils.amCount;
var pmCount = loadStateUtils.pmCount;
var primaryLoad = loadStateUtils.primaryLoad;

// Soft-constraint weights (per design.md §4 Phase 4 / Requirement 6).
var W_OWN_SUBJECT = 100;
var W_ROOM_REPEAT = 30;
var W_GENDER = 20;
var W_AM_PM = 50;

// Default time budget for Phase 4 (per design §4 Phase 4 — 15 seconds).
var DEFAULT_TIME_BUDGET_MS = 15000;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    return true;
}

/**
 * Build the deterministic variable id for a (rowIndex, slotIndex) pair.
 */
function varIdFor(rowIndex, slotIndex) {
    return 'r' + rowIndex + ':s' + slotIndex;
}

/**
 * Extract period (the right-hand side after '|') from a halfday_key of
 * the form 'YYYY-MM-DD|period'. Returns '' when no pipe is present.
 */
function periodFromHalfdayKey(halfdayKey) {
    if (typeof halfdayKey !== 'string') return '';
    var idx = halfdayKey.indexOf('|');
    if (idx === -1) return '';
    return halfdayKey.slice(idx + 1);
}

/**
 * Day-key extractor (the prefix before '|' in halfday_key).
 */
function dayKeyFromHalfdayKey(halfdayKey) {
    if (typeof halfdayKey !== 'string') return '';
    var idx = halfdayKey.indexOf('|');
    if (idx === -1) return halfdayKey;
    return halfdayKey.slice(0, idx);
}

/**
 * Lower-cased trimmed string (case-insensitive comparison helper).
 */
function ciNormalize(s) {
    if (typeof s !== 'string') return '';
    return s.trim().toLowerCase();
}

/**
 * Build the canonical key for a proctor (mirrors canonical-key.js so we
 * don't need to re-import it in this hot path).
 */
function canonicalKeyOf(proctor, idx) {
    var cin = proctor && proctor.cin != null ? String(proctor.cin).trim() : '';
    if (cin) return cin;
    return '__idx_' + idx;
}

/**
 * Build a list of `{ canonicalKey, proctor, idx }` for every proctor whose
 * canonical key is unique (matches the dedupe behavior of phase 2).
 */
function listCanonicalProctors(proctorsList) {
    var out = [];
    if (!Array.isArray(proctorsList)) return out;
    var seen = Object.create(null);
    for (var i = 0; i < proctorsList.length; i += 1) {
        var p = proctorsList[i];
        var key = canonicalKeyOf(p, i);
        if (seen[key]) continue;
        seen[key] = true;
        out.push({ canonicalKey: key, proctor: p, idx: i });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Initial-domain computation
// ---------------------------------------------------------------------------

/**
 * For a given row, compute the set of canonical proctor keys that satisfy
 * eligibility filters (C-EXEMPT / C-DUTY / C-ME) and are present in the
 * eligibility-class map. Returns a sorted array of canonical keys.
 */
function eligibleKeysForRow(row, canonicalProctors, normalizedExemptionsData,
    normalizedDutyData, normalizedMEAssignments, classByProctorKey) {
    var sessionKey = row.session_key;
    var halfdayKey = row.halfday_key;
    var keys = [];
    for (var i = 0; i < canonicalProctors.length; i += 1) {
        var entry = canonicalProctors[i];
        var k = entry.canonicalKey;
        // Must be in an eligibility class (means the proctor is recognized).
        if (!Object.prototype.hasOwnProperty.call(classByProctorKey, k)) continue;
        if (isExempt(entry.proctor, entry.idx, sessionKey, normalizedExemptionsData)) continue;
        if (isOnDuty(entry.proctor, entry.idx, halfdayKey, normalizedDutyData)) continue;
        if (isMEBlocked(entry.proctor, entry.idx, halfdayKey, normalizedMEAssignments)) continue;
        keys.push(k);
    }
    keys.sort();
    return keys;
}

// ---------------------------------------------------------------------------
// Custom C-NO-SAME-DAY revise
// ---------------------------------------------------------------------------

/**
 * Build a custom revise function that enforces C-NO-SAME-DAY across all
 * variables. The revise iterates singletons grouped by canonical key; for
 * each singleton var V whose value is k, every other variable W in the
 * same day-but-different-halfday has k removed from its domain.
 *
 * @param {Array<{varId, dayKey, halfdayKey}>} varMeta - one entry per variable
 * @returns {(domains, varGroup) => result}
 */
function buildSameDayRevise(varMeta) {
    // Pre-bucket variables by dayKey for O(V) iteration during revise.
    var byDay = Object.create(null);
    for (var i = 0; i < varMeta.length; i += 1) {
        var m = varMeta[i];
        if (!byDay[m.dayKey]) byDay[m.dayKey] = [];
        byDay[m.dayKey].push(m);
    }

    return function revise(domains) {
        var changed = false;
        // For each day with multiple halfdays involved, find singletons and
        // propagate their values to peers in other halfdays of the same day.
        var dayKeys = Object.keys(byDay).sort();
        for (var i = 0; i < dayKeys.length; i += 1) {
            var dk = dayKeys[i];
            var members = byDay[dk];
            if (members.length < 2) continue;

            // Collect singleton (varId, value, halfdayKey) tuples.
            var singletons = [];
            for (var j = 0; j < members.length; j += 1) {
                var m = members[j];
                var d = domains.get
                    ? domains.get(m.varId)
                    : (domains ? domains[m.varId] : null);
                if (!d) continue;
                if (d.size() === 1) {
                    singletons.push({
                        varId: m.varId,
                        value: d.toArray()[0],
                        halfdayKey: m.halfdayKey
                    });
                }
            }
            if (singletons.length === 0) continue;

            // For each singleton, remove its value from any peer in a
            // different halfday on the same day.
            for (var s = 0; s < singletons.length; s += 1) {
                var sing = singletons[s];
                for (var p = 0; p < members.length; p += 1) {
                    var peer = members[p];
                    if (peer.varId === sing.varId) continue;
                    if (peer.halfdayKey === sing.halfdayKey) continue;
                    var pd = domains.get
                        ? domains.get(peer.varId)
                        : (domains ? domains[peer.varId] : null);
                    if (!pd) continue;
                    var sizeBefore = pd.size();
                    pd.remove(sing.value);
                    if (pd.size() !== sizeBefore) {
                        changed = true;
                        if (pd.isEmpty()) {
                            return {
                                ok: false,
                                conflict: {
                                    type: 'domain_wipeout',
                                    varId: peer.varId,
                                    cause: 'no_same_day'
                                }
                            };
                        }
                    }
                }
            }
        }
        return { ok: true, changed: changed };
    };
}

// ---------------------------------------------------------------------------
// Cost function
// ---------------------------------------------------------------------------

/**
 * Build a cost function suitable for the CP solver. Captures the row map
 * (varId → row + slot), proctor metadata, and existing loadState (read
 * only for AM/PM seed counts) in its closure. Returns a pure function
 * `(assignment, model) → number` that does NOT mutate any input.
 */
function buildCostFn(varToRow, proctorByKey, existingLoadState) {
    return function costFn(assignment) {
        if (!assignment) return 0;
        var cost = 0;

        // Track per-(proctor, room) appearances and per-row gender lists.
        var roomsByProctor = Object.create(null);   // key → Set<room_key>
        var roomRepeatPenalty = 0;
        var subjectPenalty = 0;
        var rowGenders = Object.create(null);       // rowIdx → Array<gender>

        // Temporary AM/PM tally (seeded from existing loadState).
        var amTally = Object.create(null);
        var pmTally = Object.create(null);

        var keys = Object.keys(assignment);
        for (var i = 0; i < keys.length; i += 1) {
            var varId = keys[i];
            var value = assignment[varId];
            if (typeof value !== 'string') continue;
            var meta = varToRow[varId];
            if (!meta) continue;
            var row = meta.row;
            var rowIdx = meta.rowIndex;

            var proc = proctorByKey[value];

            // S-OWN-SUBJECT — case-insensitive trimmed comparison.
            if (proc && row && proc.subject != null && row.subject != null) {
                if (ciNormalize(proc.subject) && ciNormalize(proc.subject) === ciNormalize(row.subject)) {
                    subjectPenalty += W_OWN_SUBJECT;
                }
            }

            // S-NO-ROOM-REPEAT — count repeats of (proctor, room_key).
            var roomKey = row && typeof row.room_key === 'string' ? row.room_key : '';
            if (roomKey) {
                var seenRooms = roomsByProctor[value];
                if (!seenRooms) {
                    seenRooms = Object.create(null);
                    roomsByProctor[value] = seenRooms;
                }
                if (seenRooms[roomKey]) {
                    roomRepeatPenalty += W_ROOM_REPEAT;
                } else {
                    seenRooms[roomKey] = true;
                }
            }

            // S-GENDER — collect genders per row.
            if (proc && proc.gender != null && proc.gender !== '') {
                if (!rowGenders[rowIdx]) rowGenders[rowIdx] = [];
                rowGenders[rowIdx].push(String(proc.gender));
            }

            // S-AM-PM — tally AM/PM in temporary state.
            var period = periodFromHalfdayKey(row && row.halfday_key);
            if (period === 'صباحا' || period === 'AM' || period === 'morning') {
                amTally[value] = (amTally[value] || 0) + 1;
            } else if (period === 'مساء' || period === 'زوالا' || period === 'PM' || period === 'afternoon') {
                pmTally[value] = (pmTally[value] || 0) + 1;
            }
        }

        // S-GENDER aggregate: row penalized if all guards same gender and
        // there were ≥ 2 slots with gender data available.
        var rowKeys = Object.keys(rowGenders);
        var genderPenalty = 0;
        for (var rg = 0; rg < rowKeys.length; rg += 1) {
            var glist = rowGenders[rowKeys[rg]];
            if (!glist || glist.length < 2) continue;
            var first = glist[0];
            var allSame = true;
            for (var g = 1; g < glist.length; g += 1) {
                if (glist[g] !== first) { allSame = false; break; }
            }
            if (allSame) genderPenalty += W_GENDER;
        }

        // S-AM-PM aggregate: Σ |am - pm| over all proctors that received
        // any assignment, counting BOTH the existing load and the
        // candidate assignment's deltas.
        var ampmPenalty = 0;
        var seenProctors = Object.create(null);
        var allProctorKeys = [];
        var amKeys = Object.keys(amTally);
        for (var ak = 0; ak < amKeys.length; ak += 1) {
            if (!seenProctors[amKeys[ak]]) {
                seenProctors[amKeys[ak]] = true;
                allProctorKeys.push(amKeys[ak]);
            }
        }
        var pmKeys = Object.keys(pmTally);
        for (var pk = 0; pk < pmKeys.length; pk += 1) {
            if (!seenProctors[pmKeys[pk]]) {
                seenProctors[pmKeys[pk]] = true;
                allProctorKeys.push(pmKeys[pk]);
            }
        }
        for (var pk2 = 0; pk2 < allProctorKeys.length; pk2 += 1) {
            var k = allProctorKeys[pk2];
            var am = (amTally[k] || 0) + amCount(existingLoadState, k);
            var pm = (pmTally[k] || 0) + pmCount(existingLoadState, k);
            var diff = am - pm;
            if (diff < 0) diff = -diff;
            ampmPenalty += W_AM_PM * diff;
        }

        cost = subjectPenalty + roomRepeatPenalty + genderPenalty + ampmPenalty;
        return cost;
    };
}

// ---------------------------------------------------------------------------
// Phase 4 entry point
// ---------------------------------------------------------------------------

/**
 * Run Phase 4 on the supplied state.
 *
 * @param {Object} state - pipeline state populated by Phases 0/1/1b/2/3
 * @returns {Object} new state with rows / loadState / diagnostics updated
 */
function placeGuards(state) {
    if (state === null || state === undefined) {
        throw new TypeError('placeGuards: state must be an object');
    }
    var input = state.input;
    if (!isPlainObject(input)) {
        throw new TypeError('placeGuards: state.input must be a plain object');
    }

    // Carry diagnostics forward with FRESH arrays.
    var prevDiag = isPlainObject(state.diagnostics) ? state.diagnostics : null;
    var prevWarnings = prevDiag && Array.isArray(prevDiag.warnings) ? prevDiag.warnings.slice() : [];
    var prevErrors = prevDiag && Array.isArray(prevDiag.errors) ? prevDiag.errors.slice() : [];
    var prevUnresolved = prevDiag && Array.isArray(prevDiag.unresolvedSlots)
        ? prevDiag.unresolvedSlots.slice()
        : [];

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

    // Empty rows — no-op with a warning.
    var inRows = Array.isArray(state.rows) ? state.rows : null;
    if (inRows === null || inRows.length === 0) {
        nextDiag.warnings.push({ type: 'phase4_no_rows', message: 'No rows present; skipping guard placement.' });
        var ns = shallowCopyState(state);
        ns.diagnostics = nextDiag;
        return ns;
    }

    // Phase 3 dependency check.
    if (!isPlainObject(state.bounds) || !isPlainObject(state.bounds.byClass)) {
        throw new TypeError('placeGuards: state.bounds.byClass missing — Phase 3 must run before Phase 4');
    }
    var classBoundsByClassId = state.bounds.byClass;

    // Adapt the bounds shape to what the propagator expects: `{ upper: number }`.
    // bounds.byClass entries already have { lower, upper, ... } so this is
    // effectively pass-through, but we extract a fresh sub-object so the
    // propagator never sees fields it doesn't care about (and we are robust
    // to phase 3 schema additions).
    var classBoundsForPropagator = {};
    var cbKeys = Object.keys(classBoundsByClassId);
    for (var cbi = 0; cbi < cbKeys.length; cbi += 1) {
        var cid = cbKeys[cbi];
        var b = classBoundsByClassId[cid];
        if (b && typeof b.upper === 'number') {
            classBoundsForPropagator[cid] = { upper: b.upper, lower: b.lower };
        }
    }

    var classByProctorKey = isPlainObject(state.classByProctorKey) || (
        state.classByProctorKey && typeof state.classByProctorKey === 'object' && !Array.isArray(state.classByProctorKey)
    ) ? state.classByProctorKey : {};

    var loadState = state.loadState;
    if (!isPlainObject(loadState) || !isPlainObject(loadState.proctors)) {
        throw new TypeError('placeGuards: state.loadState missing or malformed — initialize via createLoadState');
    }

    // Build canonical proctor index.
    var canonicalProctors = listCanonicalProctors(input.proctorsList);
    var proctorByKey = Object.create(null);
    for (var cp = 0; cp < canonicalProctors.length; cp += 1) {
        proctorByKey[canonicalProctors[cp].canonicalKey] = canonicalProctors[cp].proctor;
    }

    var normalizedExemptions = isPlainObject(state.normalizedExemptionsData)
        ? state.normalizedExemptionsData : {};
    var normalizedDuty = isPlainObject(state.normalizedDutyData)
        ? state.normalizedDutyData : {};
    var normalizedME = isPlainObject(state.normalizedMEAssignments)
        ? state.normalizedMEAssignments : {};

    var allowSameDay = !!(input.examDistributionRules
        && input.examDistributionRules.allowSameDayBothHalfdays);

    // -----------------------------------------------------------------------
    // Load-aware constructive placement (replaces the monolithic CP solve).
    //
    // Why: a single CP model spanning all guard slots (382 on the production
    // fixture) clones the full domain map and re-runs AC-3 at every DFS
    // node, costing hundreds of ms per node — it cannot scale within the
    // 15s budget (it explored ~60 of thousands of nodes and returned a
    // mostly-empty partial). The problem is in practice under-constrained
    // (the CP search found 0 conflicts), so an exhaustive search is wasted
    // effort.
    //
    // Instead we place guards one slot at a time, always choosing the
    // eligible proctor with the LOWEST Primary_Load (the fairness axis,
    // AC 5.1), breaking ties by the soft-constraint penalty and finally by
    // canonical key (ASC) for determinism (AC 8.4/8.6). Every candidate is
    // screened against the SAME hard-constraint predicates the CP model
    // encoded (C-EXEMPT/C-DUTY/C-ME via the per-row eligibility list, plus
    // C-NO-DOUBLE within row & session, C-NO-SAME-DAY, and the class upper
    // bound). This yields full coverage and a strict-bimodal Primary_Load
    // histogram directly, in milliseconds, with no behavioural regression on
    // the hard constraints. Phases 5/7/8 remain as polish/repair safety.
    //
    // The CP solver module is retained (and still unit-tested) for small
    // sub-problems and as documented infrastructure; it is simply no longer
    // the Phase-4 driver. See README.md "Phase 4 placement strategy".
    // -----------------------------------------------------------------------

    var timeBudget = (state.options && typeof state.options.phase4TimeBudgetMs === 'number')
        ? state.options.phase4TimeBudgetMs
        : DEFAULT_TIME_BUDGET_MS;
    var startedAt = Date.now();
    function budgetExhausted() {
        return (Date.now() - startedAt) >= timeBudget;
    }

    // Per-(proctor, room_key) tracking for S-NO-ROOM-REPEAT soft penalty.
    var roomsByProctor = Object.create(null);

    /**
     * Soft-constraint penalty of assigning canonical key `k` to `row`,
     * given the slots already filled in `assignedKeysThisRow`. Used ONLY as
     * a tiebreaker among candidates of equal (lowest) Primary_Load, so it
     * never perturbs the fairness distribution.
     */
    function softPenaltyFor(k, row, assignedKeysThisRow) {
        var pen = 0;
        var proc = proctorByKey[k];

        // S-OWN-SUBJECT.
        if (proc && proc.subject != null && row.subject != null) {
            var ps = ciNormalize(proc.subject);
            if (ps && ps === ciNormalize(row.subject)) pen += W_OWN_SUBJECT;
        }

        // S-NO-ROOM-REPEAT.
        var roomKey = (row && typeof row.room_key === 'string') ? row.room_key : '';
        if (roomKey) {
            var seenRooms = roomsByProctor[k];
            if (seenRooms && seenRooms[roomKey]) pen += W_ROOM_REPEAT;
        }

        // S-GENDER — penalize a same-gender pair within the row.
        if (proc && proc.gender != null && proc.gender !== '') {
            for (var g = 0; g < assignedKeysThisRow.length; g += 1) {
                var ok = assignedKeysThisRow[g];
                if (typeof ok !== 'string') continue;
                var other = proctorByKey[ok];
                if (other && other.gender != null && other.gender !== ''
                    && String(other.gender) === String(proc.gender)) {
                    pen += W_GENDER;
                    break;
                }
            }
        }

        // S-AM-PM — penalize increasing the proctor's |AM - PM| imbalance.
        var period = periodFromHalfdayKey(row && row.halfday_key);
        var am = amCount(loadState, k);
        var pm = pmCount(loadState, k);
        if (period === 'صباحا' || period === 'AM' || period === 'morning') {
            am += 1;
        } else if (period === 'مساء' || period === 'زوالا' || period === 'PM' || period === 'afternoon') {
            pm += 1;
        }
        var diff = am - pm;
        if (diff < 0) diff = -diff;
        pen += W_AM_PM * diff;

        return pen;
    }

    var newRows = new Array(inRows.length);
    var unresolved = nextDiag.unresolvedSlots; // fresh array we can append to
    var slotsFilled = 0;
    var slotsTotal = 0;
    var anyTimeout = false;

    for (var i = 0; i < inRows.length; i += 1) {
        var srcRow = inRows[i];
        if (!srcRow || typeof srcRow !== 'object') {
            newRows[i] = srcRow;
            continue;
        }

        // Shallow copy the row, but replace proctor_keys with a fresh array.
        var newRow = {};
        var rowKeys = Object.keys(srcRow);
        for (var rkk = 0; rkk < rowKeys.length; rkk += 1) {
            newRow[rowKeys[rkk]] = srcRow[rowKeys[rkk]];
        }
        var slotN = Array.isArray(srcRow.proctor_keys) ? srcRow.proctor_keys.length : 0;
        var freshKeys = new Array(slotN);
        for (var z = 0; z < slotN; z += 1) freshKeys[z] = null;

        // Eligible canonical keys for this row's session/halfday (sorted).
        var eligibles = eligibleKeysForRow(
            srcRow, canonicalProctors,
            normalizedExemptions, normalizedDuty, normalizedME,
            classByProctorKey
        );

        var sessionKey = srcRow.session_key;
        var halfdayKey = srcRow.halfday_key;
        var dayKey = srcRow.day_key || dayKeyFromHalfdayKey(srcRow.halfday_key);
        var period2 = periodFromHalfdayKey(srcRow.halfday_key);

        for (var sj = 0; sj < slotN; sj += 1) {
            slotsTotal += 1;

            if (budgetExhausted()) {
                anyTimeout = true;
                unresolved.push({
                    rowIndex: i,
                    slotIndex: sj,
                    session_key: sessionKey,
                    room_key: srcRow.room_key,
                    reason: 'time_budget'
                });
                continue;
            }

            // Choose the eligible candidate with the lowest Primary_Load,
            // breaking ties by soft penalty, then canonical key ASC.
            var bestKey = null;
            var bestLoad = Infinity;
            var bestPenalty = Infinity;
            for (var c = 0; c < eligibles.length; c += 1) {
                var cand = eligibles[c];

                // C-NO-DOUBLE within row & session (occupancy set covers
                // both, since this row's session occupancy is recorded as we
                // fill its own slots).
                if (wouldDoubleBookSession(loadState, cand, sessionKey)) continue;
                // C-NO-SAME-DAY (guards + reserves, symmetric).
                if (wouldViolateSameDay(loadState, cand, halfdayKey, allowSameDay)) continue;
                // Per-class upper bound on Primary_Load.
                if (wouldExceedClassUpper(loadState, cand, classBoundsForPropagator, classByProctorKey)) continue;

                var load = primaryLoad(loadState, cand);
                if (load > bestLoad) continue;

                var penalty = softPenaltyFor(cand, srcRow, freshKeys);
                if (load < bestLoad
                    || (load === bestLoad && penalty < bestPenalty)
                    || (load === bestLoad && penalty === bestPenalty
                        && (bestKey === null || cand < bestKey))) {
                    bestKey = cand;
                    bestLoad = load;
                    bestPenalty = penalty;
                }
            }

            if (bestKey !== null) {
                freshKeys[sj] = bestKey;
                addGuardLoad(loadState, bestKey, halfdayKey, dayKey, sessionKey, period2);
                recordGuardOccupancy(loadState, bestKey, sessionKey, halfdayKey);
                var seen = roomsByProctor[bestKey];
                if (!seen) { seen = Object.create(null); roomsByProctor[bestKey] = seen; }
                if (srcRow.room_key) seen[srcRow.room_key] = true;
                slotsFilled += 1;
            } else {
                unresolved.push({
                    rowIndex: i,
                    slotIndex: sj,
                    session_key: sessionKey,
                    room_key: srcRow.room_key,
                    reason: 'no_eligible_candidate'
                });
            }
        }

        newRow.proctor_keys = freshKeys;
        newRows[i] = newRow;
    }

    var partial = unresolved.length > 0;
    var timedOut = anyTimeout;

    nextDiag.phase4 = {
        strategy: 'load_aware_constructive',
        slotsTotal: slotsTotal,
        slotsFilled: slotsFilled,
        slotsUnresolved: slotsTotal - slotsFilled,
        elapsedMs: Date.now() - startedAt,
        timedOut: timedOut,
        partial: partial
    };

    var ns2 = shallowCopyState(state);
    ns2.rows = newRows;
    ns2.loadState = loadState;
    ns2.diagnostics = nextDiag;
    return ns2;
}

function shallowCopyState(state) {
    var out = {};
    var keys = Object.keys(state);
    for (var i = 0; i < keys.length; i += 1) {
        out[keys[i]] = state[keys[i]];
    }
    return out;
}

module.exports = {
    placeGuards: placeGuards,
    _internals: {
        varIdFor: varIdFor,
        periodFromHalfdayKey: periodFromHalfdayKey,
        dayKeyFromHalfdayKey: dayKeyFromHalfdayKey,
        eligibleKeysForRow: eligibleKeysForRow,
        buildSameDayRevise: buildSameDayRevise,
        buildCostFn: buildCostFn,
        W_OWN_SUBJECT: W_OWN_SUBJECT,
        W_ROOM_REPEAT: W_ROOM_REPEAT,
        W_GENDER: W_GENDER,
        W_AM_PM: W_AM_PM,
        DEFAULT_TIME_BUDGET_MS: DEFAULT_TIME_BUDGET_MS
    }
};
    };

    __modules["/js/algorithms/proctor-v3/phases/05-coverage-repair.js"] = function (module, exports, require, __dirname, __filename) {
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

var hardConstraints = require(path.join(__dirname, '..', 'constraints', 'hard-constraints.js'));
var loadStateUtils = require(path.join(__dirname, '..', 'utils', 'load-state.js'));

var isExempt = hardConstraints.isExempt;
var isOnDuty = hardConstraints.isOnDuty;
var isMEBlocked = hardConstraints.isMEBlocked;
var wouldDoubleBookSession = hardConstraints.wouldDoubleBookSession;
var wouldViolateSameDay = hardConstraints.wouldViolateSameDay;
var recordGuardOccupancy = hardConstraints.recordGuardOccupancy;
var clearGuardOccupancy = hardConstraints.clearGuardOccupancy;

var primaryLoad = loadStateUtils.primaryLoad;

// Default time budget for Phase 5 (per design.md §4 Phase 5 — 5 seconds).
var DEFAULT_TIME_BUDGET_MS = 5000;

// Small additive safety margin on top of (target - currentLoad) when
// computing maxAttempts per proctor. Matches the design pseudocode.
var ATTEMPT_SAFETY_MARGIN = 5;

// AM_PERIODS / PM_PERIODS mirror the recognized period values from
// utils/load-state.js — we intentionally do NOT import them because that
// module exposes them only via _internals (testing-only).
var AM_PERIODS = ['صباحا', 'AM', 'morning'];
var PM_PERIODS = ['مساء', 'PM', 'afternoon'];

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
    var cin = proctor && proctor.cin != null ? String(proctor.cin).trim() : '';
    if (cin) return cin;
    return '__idx_' + idx;
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
 * Decrement guardCount and the matching AM/PM bucket for a load-state
 * entry. Counterpart of `addGuardLoad`. Floors at 0 defensively.
 *
 * Note: `wouldDoubleBookSession` and `wouldViolateSameDay` rely on the
 * `guardSessions` and `guardHalfdays` Sets (maintained by
 * `recordGuardOccupancy`). The caller must invoke `clearGuardOccupancy`
 * separately when the donor no longer occupies the session/halfday.
 */
function decrementGuardLoad(loadState, key, period) {
    if (!isPlainObject(loadState) || !isPlainObject(loadState.proctors)) return;
    var entry = loadState.proctors[key];
    if (!entry) return;
    if (entry.guardCount > 0) entry.guardCount -= 1;
    if (typeof period === 'string') {
        if (AM_PERIODS.indexOf(period) !== -1) {
            if (entry.amCount > 0) entry.amCount -= 1;
        } else if (PM_PERIODS.indexOf(period) !== -1) {
            if (entry.pmCount > 0) entry.pmCount -= 1;
        }
    }
}

/**
 * Increment guardCount and the matching AM/PM bucket. Counterpart of
 * `decrementGuardLoad`. Lazily creates an entry if absent.
 */
function incrementGuardLoad(loadState, key, period) {
    if (!isPlainObject(loadState) || !isPlainObject(loadState.proctors)) return;
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
    entry.guardCount += 1;
    if (typeof period === 'string') {
        if (AM_PERIODS.indexOf(period) !== -1) {
            entry.amCount += 1;
        } else if (PM_PERIODS.indexOf(period) !== -1) {
            entry.pmCount += 1;
        }
    }
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
    };

    __modules["/js/algorithms/proctor-v3/phases/06-same-day-detect.js"] = function (module, exports, require, __dirname, __filename) {
// Proctor Distribution V3 — Phase 6: Same-Day Infeasibility Detection.
//
// PURE inspection phase. Phase 6 looks at the unresolved-slot information
// produced by Phases 4 and 5 and decides whether the orchestrator should
// later perform a relaxed-mode pre-check (re-running Phases 4–5 with
// `allowSameDayBothHalfdays = true`) to determine whether the C-NO-SAME-DAY
// constraint is the cause of unresolved coverage.
//
// Phase 6 itself NEVER calls into other phases — that would break the
// pure-function contract. The orchestrator (see `orchestrator.js`) reads
// `state.diagnostics.preCheckRequired` and decides whether to invoke the
// pre-check helper, which in turn emits the appropriate warning into
// `state.diagnostics.warnings`.
//
// Acceptance Criteria covered:
//   - 4.1  : Same_Day_Allowance_Flag defaults to false (read from input).
//   - 4.2  : When unresolved AND flag is false, mark for pre-check; the
//            orchestrator emits `same_day_relaxation_suggested` if the
//            relaxed run succeeds.
//   - 4.2a : When unresolved AND flag is false AND relaxed also fails, the
//            orchestrator emits `coverage_infeasible_regardless` instead.
//   - 4.2b : When the flag is already true, NO pre-check is performed
//            (preCheckRequired = false).
//   - 4.6  : Distinguish "same-day-only" unresolved from "any-other-cause"
//            via the orchestrator-driven relaxed comparison.
//   - 12.3 : Per-phase time budget honored (Phase 6 inspection ≤ 200ms;
//            it is O(1) work plus a single array length read).
//
// Purity contract (per design.md §"Pure-function contract"):
//   - state.input is NOT mutated.
//   - state.diagnostics is shallow-cloned with FRESH arrays for any
//     property we touch (warnings, errors, unresolvedSlots).
//   - Output state is a fresh top-level object; sibling fields are
//     forwarded by reference (intentional — they are not mutated here).

'use strict';

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

/**
 * Build a fresh diagnostics object cloned from `prevDiag`, with FRESH
 * arrays for `warnings`, `errors`, and `unresolvedSlots`. This preserves
 * the AC-10.2 invariant (no shared array references) at the diagnostics
 * level and ensures downstream phases can append safely.
 */
function carryForwardDiagnostics(prevDiag) {
    var nextDiag = {};
    if (isPlainObject(prevDiag)) {
        var keys = Object.keys(prevDiag);
        for (var i = 0; i < keys.length; i += 1) {
            nextDiag[keys[i]] = prevDiag[keys[i]];
        }
    }
    nextDiag.warnings = (isPlainObject(prevDiag) && Array.isArray(prevDiag.warnings))
        ? prevDiag.warnings.slice() : [];
    nextDiag.errors = (isPlainObject(prevDiag) && Array.isArray(prevDiag.errors))
        ? prevDiag.errors.slice() : [];
    nextDiag.unresolvedSlots = (isPlainObject(prevDiag) && Array.isArray(prevDiag.unresolvedSlots))
        ? prevDiag.unresolvedSlots.slice() : [];
    return nextDiag;
}

// ---------------------------------------------------------------------------
// Phase 6 entry point
// ---------------------------------------------------------------------------

/**
 * Inspect unresolved slots after Phases 4–5 and decide whether the
 * orchestrator must perform a relaxed-mode pre-check.
 *
 * Decision tree (per AC 4.1, 4.2, 4.2b):
 *   1. If `allowSameDayBothHalfdays === true` → no pre-check (already
 *      relaxed; nothing to compare against).
 *   2. If `unresolvedSlots.length === 0` → no pre-check (full coverage
 *      already achieved).
 *   3. Otherwise → mark `preCheckRequired = true` and record the current
 *      unresolved count in `preCheckUnresolvedCount` so the orchestrator
 *      can include it in the eventual warning payload.
 *
 * @param {Object} state - pipeline state carrying `input` and `diagnostics`.
 * @returns {Object} new state with diagnostics updated.
 */
function detectSameDayInfeasibility(state) {
    if (state === null || state === undefined) {
        throw new TypeError('detectSameDayInfeasibility: state must be an object');
    }
    if (!isPlainObject(state.input)) {
        throw new TypeError('detectSameDayInfeasibility: state.input must be a plain object');
    }

    var nextDiag = carryForwardDiagnostics(state.diagnostics);

    // AC 4.2b — flag already enabled, no pre-check ever needed.
    var rules = state.input.examDistributionRules;
    var allowSameDay = !!(isPlainObject(rules) && rules.allowSameDayBothHalfdays);
    if (allowSameDay) {
        nextDiag.preCheckRequired = false;
        nextDiag.preCheckUnresolvedCount = 0;
        var ns0 = shallowCopyState(state);
        ns0.diagnostics = nextDiag;
        return ns0;
    }

    // AC 4.2 — full coverage achieved, no pre-check needed.
    var unresolvedCount = nextDiag.unresolvedSlots.length;
    if (unresolvedCount === 0) {
        nextDiag.preCheckRequired = false;
        nextDiag.preCheckUnresolvedCount = 0;
        var ns1 = shallowCopyState(state);
        ns1.diagnostics = nextDiag;
        return ns1;
    }

    // Pre-check needed; orchestrator decides whether the time budget
    // allows it.
    nextDiag.preCheckRequired = true;
    nextDiag.preCheckUnresolvedCount = unresolvedCount;

    var ns2 = shallowCopyState(state);
    ns2.diagnostics = nextDiag;
    return ns2;
}

module.exports = {
    detectSameDayInfeasibility: detectSameDayInfeasibility,
    _internals: {
        carryForwardDiagnostics: carryForwardDiagnostics
    }
};
    };

    __modules["/js/algorithms/proctor-v3/phases/07-bimodal-repair.js"] = function (module, exports, require, __dirname, __filename) {
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

var hardConstraints = require(path.join(__dirname, '..', 'constraints', 'hard-constraints.js'));
var loadStateUtils = require(path.join(__dirname, '..', 'utils', 'load-state.js'));

var isExempt = hardConstraints.isExempt;
var isOnDuty = hardConstraints.isOnDuty;
var isMEBlocked = hardConstraints.isMEBlocked;
var wouldDoubleBookSession = hardConstraints.wouldDoubleBookSession;
var wouldViolateSameDay = hardConstraints.wouldViolateSameDay;
var recordGuardOccupancy = hardConstraints.recordGuardOccupancy;
var clearGuardOccupancy = hardConstraints.clearGuardOccupancy;

var primaryLoad = loadStateUtils.primaryLoad;

// Default time budget for Phase 7 (per design.md §4 Phase 7 — 5 seconds).
var DEFAULT_TIME_BUDGET_MS = 5000;

// Hard cap on iterations to defend against pathological loops where the
// time budget is generous but the swap search keeps thrashing. Each
// iteration costs at most O(rows × slots × |donors| × |recipients|).
var MAX_ITERATIONS = 5000;

// AM/PM period tokens — kept in sync with utils/load-state.js. Duplicated
// here so this module remains self-contained (load-state.js exposes them
// only via _internals for testing).
var AM_PERIODS = ['صباحا', 'AM', 'morning'];
var PM_PERIODS = ['مساء', 'PM', 'afternoon'];

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
    var cin = proctor && proctor.cin != null ? String(proctor.cin).trim() : '';
    if (cin) return cin;
    return '__idx_' + idx;
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

/**
 * Mirror of Phase 5's load mutators. Decrement guardCount and the matching
 * AM/PM bucket. Floors at 0 defensively.
 */
function decrementGuardLoad(loadState, key, period) {
    if (!isPlainObject(loadState) || !isPlainObject(loadState.proctors)) return;
    var entry = loadState.proctors[key];
    if (!entry) return;
    if (entry.guardCount > 0) entry.guardCount -= 1;
    if (typeof period === 'string') {
        if (AM_PERIODS.indexOf(period) !== -1) {
            if (entry.amCount > 0) entry.amCount -= 1;
        } else if (PM_PERIODS.indexOf(period) !== -1) {
            if (entry.pmCount > 0) entry.pmCount -= 1;
        }
    }
}

function incrementGuardLoad(loadState, key, period) {
    if (!isPlainObject(loadState) || !isPlainObject(loadState.proctors)) return;
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
    entry.guardCount += 1;
    if (typeof period === 'string') {
        if (AM_PERIODS.indexOf(period) !== -1) {
            entry.amCount += 1;
        } else if (PM_PERIODS.indexOf(period) !== -1) {
            entry.pmCount += 1;
        }
    }
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
    };

    __modules["/js/algorithms/proctor-v3/phases/08-ampm-balance.js"] = function (module, exports, require, __dirname, __filename) {
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
    };

    __modules["/js/algorithms/proctor-v3/phases/09-place-reserves.js"] = function (module, exports, require, __dirname, __filename) {
// Proctor Distribution V3 — Phase 9: Place Reserves.
//
// Pure phase. Takes a `state` already populated through Phase 8
// (guard slots placed, Primary_Load histogram repaired, AM/PM imbalance
// reduced) and assigns reserve proctors to each session.
//
// Reserves are role-distinct from guards: a reserve is a proctor on
// stand-by for a session, not bound to a specific room. In V3 a single
// reserve list is computed per session and attached to every Result_Row
// belonging to that session. Each row receives an INDEPENDENT array
// (Acceptance Criterion 10.2 — no shared array references between rows).
//
// Acceptance Criteria covered:
//   - 7.1  : Reserves_Config sourcing with V2 fallback semantics
//             (input.reservesConfig overrides examCenterConfig.max_reserves*,
//              legacy examDistributionRules.reservesPerSession used when
//              both absent).
//   - 7.2  : 'fixed' mode → min(fixed, eligibleAvailable(S)).
//   - 7.3  : 'percent' mode → min(ceil(percent * |guards(S)| / 100),
//                                  eligibleAvailable(S)).
//   - 7.4  : per-candidate hard filters (C-EXEMPT / C-DUTY / C-ME /
//             not-currently-a-guard-in-S / not-currently-a-reserve-in-S /
//             C-NO-SAME-DAY for both guards & reserves).
//   - 7.4a : at-most-once invariant across the union of reserve_keys for
//             all rows belonging to a session, even when arrays are
//             independent (we maintain it explicitly via a per-session
//             chosen-set).
//   - 7.5  : sort key (Reserve_Count ASC, affinityRank ASC,
//             Final_Load ASC, canonicalKey ASC).
//   - 7.6  : affinityRank = 0 when the proctor guarded the previous
//             session of the same halfday, else 1 (only meaningful for
//             the SECOND session of a halfday).
//   - 7.7  : affinityRank = 1 for every candidate when S is the first /
//             only session of a halfday.
//   - 7.8  : best-effort balance — record imbalances in
//             diagnostics.reserveImbalances when a candidate with lower
//             reserveCount could not be picked due to hard filters.
//   - 7.9  : reserves placed AFTER all guard processing (precondition
//             satisfied by the orchestrator's phase ordering; this phase
//             never touches proctor_keys).
//   - 3.6  : C-NO-DOUBLE across rows of the same session, including
//             reserves vs guards (enforced by the not-currently-a-guard
//             and at-most-once filters).
//   - 3.7a : C-NO-SAME-DAY across roles (guard ⇄ reserve) — enforced via
//             `wouldViolateSameDay` checked against both guard and
//             reserve halfday occupancy.
//
// V2 pitfall avoided:
//   V2 attached the SAME `reserve_keys` array reference to every row of
//   a session, so mutating one row's array silently mutated the others.
//   V3 always builds a FRESH array per row (slice of the chosen list).
//
// Purity contract:
//   - state.input is NOT mutated.
//   - state.rows is REPLACED with a new array. Rows that gain reserves
//     are shallow-cloned with FRESH `reserve_keys` and `reserves` arrays.
//     Rows that get no reserves (e.g. degenerate sessions with empty
//     candidate pools) are also shallow-cloned with empty fresh arrays
//     so no two rows share references.
//   - state.loadState IS mutated in place (matches the convention from
//     phases 4/5/7/8). Reserve counts and reserve occupancy sets are
//     updated as reserves are picked.
//   - state.diagnostics is rebuilt as a new object with fresh arrays.

'use strict';

var path = require('path');

var hardConstraints = require(path.join(__dirname, '..', 'constraints', 'hard-constraints.js'));
var loadStateUtils = require(path.join(__dirname, '..', 'utils', 'load-state.js'));

var isExempt = hardConstraints.isExempt;
var isOnDuty = hardConstraints.isOnDuty;
var isMEBlocked = hardConstraints.isMEBlocked;
var wouldViolateSameDay = hardConstraints.wouldViolateSameDay;
var recordReserveOccupancy = hardConstraints.recordReserveOccupancy;

var addReserveLoad = loadStateUtils.addReserveLoad;
var finalLoad = loadStateUtils.finalLoad;

// Default time budget per design.md §4 Phase 9 (1 second). The phase is
// O(sessions × proctors × log n) with very small constants, so the budget
// is essentially advisory; we honor it defensively.
var DEFAULT_TIME_BUDGET_MS = 1000;

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
    var cin = proctor && proctor.cin != null ? String(proctor.cin).trim() : '';
    if (cin) return cin;
    return '__idx_' + idx;
}

/**
 * Build canonical-key → { proctor, idx } index. First-occurrence wins on
 * duplicate canonical keys (mirrors Phase 2's dedupe behavior).
 *
 * @param {Array} proctorsList
 * @returns {Object<string, { proctor: object, idx: number }>}
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
 * Read reserveCount for `key` from the load state. Returns 0 when absent.
 */
function reserveCountOf(loadState, key) {
    if (!isPlainObject(loadState) || !isPlainObject(loadState.proctors)) return 0;
    var entry = loadState.proctors[key];
    if (!isPlainObject(entry)) return 0;
    var n = entry.reserveCount;
    return typeof n === 'number' ? n : 0;
}

/**
 * Read the resolved Reserves_Config for this run, applying the V2-compatible
 * fallback semantics documented in AC 7.1 / glossary `Reserves_Config`.
 *
 * Precedence (highest → lowest):
 *   1. input.reservesConfig                         (explicit, V2 contract)
 *   2. examCenterConfig.max_reserves_mode + ...     (V3 schema)
 *   3. examDistributionRules.reservesPerSession     (legacy fallback)
 *
 * Returns `{ mode: 'fixed' | 'percent', fixed: int, percent: int }`. The
 * `fixed` field is always populated (default 0); `percent` is always
 * populated (default 0) and only consulted when `mode === 'percent'`.
 *
 * @param {object} input
 * @returns {{ mode: string, fixed: number, percent: number }}
 */
function resolveReservesConfig(input) {
    // Path 1: explicit reservesConfig.
    if (input && isPlainObject(input.reservesConfig)) {
        var rc = input.reservesConfig;
        var mode = (rc.mode === 'fixed' || rc.mode === 'percent') ? rc.mode : 'fixed';
        var fixed = (typeof rc.fixed === 'number' && Number.isFinite(rc.fixed) && rc.fixed >= 0)
            ? Math.floor(rc.fixed) : 0;
        var percent = (typeof rc.percent === 'number' && Number.isFinite(rc.percent)
            && rc.percent >= 0 && rc.percent <= 100)
            ? Math.floor(rc.percent) : 0;
        return { mode: mode, fixed: fixed, percent: percent };
    }

    // Path 2: examCenterConfig.max_reserves_*.
    var ecc = input && input.examCenterConfig;
    if (isPlainObject(ecc) && (ecc.max_reserves_mode === 'fixed' || ecc.max_reserves_mode === 'percent')) {
        var mode2 = ecc.max_reserves_mode;
        var fixed2 = (typeof ecc.max_reserves === 'number' && Number.isFinite(ecc.max_reserves) && ecc.max_reserves >= 0)
            ? Math.floor(ecc.max_reserves) : 0;
        var percent2 = (typeof ecc.max_reserves_percent === 'number' && Number.isFinite(ecc.max_reserves_percent)
            && ecc.max_reserves_percent >= 0 && ecc.max_reserves_percent <= 100)
            ? Math.floor(ecc.max_reserves_percent) : 0;
        return { mode: mode2, fixed: fixed2, percent: percent2 };
    }

    // Path 3: legacy examDistributionRules.reservesPerSession.
    var rules = input && input.examDistributionRules;
    if (isPlainObject(rules) && typeof rules.reservesPerSession === 'number'
        && Number.isFinite(rules.reservesPerSession) && rules.reservesPerSession >= 0) {
        return { mode: 'fixed', fixed: Math.floor(rules.reservesPerSession), percent: 0 };
    }

    // Default: no reserves.
    return { mode: 'fixed', fixed: 0, percent: 0 };
}

/**
 * Compute the desired reserve count for a session given the resolved
 * config and the number of GUARD slots already filled in the session.
 *
 *   mode='fixed'   → cfg.fixed
 *   mode='percent' → ceil(cfg.percent * guardCount / 100)
 *
 * The actual placement count is later clamped to `eligibleAvailable(S)`
 * by the caller; this helper returns the unconstrained target.
 *
 * @param {{mode:string, fixed:number, percent:number}} cfg
 * @param {number} guardCount
 * @returns {number}
 */
function computeReserveTarget(cfg, guardCount) {
    if (!cfg) return 0;
    if (cfg.mode === 'percent') {
        var pct = typeof cfg.percent === 'number' && Number.isFinite(cfg.percent) ? cfg.percent : 0;
        var gc = typeof guardCount === 'number' && Number.isFinite(guardCount) && guardCount >= 0
            ? guardCount : 0;
        var raw = (pct * gc) / 100;
        return Math.ceil(raw);
    }
    var fx = typeof cfg.fixed === 'number' && Number.isFinite(cfg.fixed) ? cfg.fixed : 0;
    if (fx < 0) fx = 0;
    return Math.floor(fx);
}

/**
 * Group rows by session_key in stable encounter order. Returns:
 *   - sessions   : Array of session metadata objects in encounter order
 *                  (first row that introduces a new session_key sets the
 *                  metadata)
 *   - rowsBySession : map session_key → array of rowIndex
 *
 * The `metadata` per session captures everything Phase 9 needs:
 *   { sessionKey, halfdayKey, dayKey, level, subject, sessionLabel,
 *     guardCount }.
 */
function groupRowsBySession(rows) {
    var rowsBySession = Object.create(null);
    var sessionsInOrder = [];

    for (var ri = 0; ri < rows.length; ri += 1) {
        var row = rows[ri];
        if (!row || typeof row !== 'object') continue;
        var sk = row.session_key;
        if (typeof sk !== 'string' || sk.length === 0) continue;

        if (!rowsBySession[sk]) {
            rowsBySession[sk] = [];
            sessionsInOrder.push({
                sessionKey: sk,
                halfdayKey: row.halfday_key,
                dayKey: row.day_key,
                level: row.level,
                subject: row.subject,
                sessionLabel: extractSessionLabelFromKey(sk),
                guardCount: 0,
                guardKeysInSession: Object.create(null) // canonicalKey → true
            });
        }
        rowsBySession[sk].push(ri);

        var metaIdx = sessionsInOrder.length - 1;
        // Find the matching meta — keep linear search to a minimum: the
        // last entry is by far the common case (we just appended), but
        // sessions can be revisited as we iterate rows. Use direct lookup.
        var meta = null;
        for (var s = sessionsInOrder.length - 1; s >= 0; s -= 1) {
            if (sessionsInOrder[s].sessionKey === sk) {
                meta = sessionsInOrder[s];
                break;
            }
        }
        if (!meta) continue;

        var keys = Array.isArray(row.proctor_keys) ? row.proctor_keys : [];
        for (var ki = 0; ki < keys.length; ki += 1) {
            var k = keys[ki];
            if (typeof k !== 'string' || k.length === 0) continue;
            if (!meta.guardKeysInSession[k]) {
                meta.guardKeysInSession[k] = true;
            }
            meta.guardCount += 1;
        }
    }

    return { sessions: sessionsInOrder, rowsBySession: rowsBySession };
}

/**
 * Extract the session-label suffix from a session_key built by Phase 1b.
 *
 * Phase 1b builds keys as `${date}|${period}|${level}|${subject}` and
 * appends `|${session}` only when the schedule entry has a non-empty
 * `session` field. Therefore a key with FOUR pipe-separated segments has
 * no session label, while a key with FIVE segments has one as its last
 * segment.
 *
 * Returns the label or '' when absent.
 */
function extractSessionLabelFromKey(sessionKey) {
    if (typeof sessionKey !== 'string') return '';
    var parts = sessionKey.split('|');
    if (parts.length >= 5) return parts[4];
    return '';
}

/**
 * Within a halfday, two sessions can be sequential — typically labeled
 * "الحصة الأولى" and "الحصة الثانية". Build a map from sessionKey to its
 * "previous" sessionKey within the same halfday (when one exists), so
 * that we can compute affinityRank at sort time.
 *
 * The "previous" relation is derived purely from session_label ordering
 * within a halfday: sessions sharing the same halfdayKey are ordered by
 * (sessionLabel ASC, fallback sessionKey ASC), and each session past the
 * first points back to the immediately preceding one.
 *
 * Returns:
 *   { [sessionKey]: previousSessionKey | null }
 *
 * Sessions for which `affinityRank` is meaningless (first / only session
 * of a halfday) map to null. AC 7.7 requires `affinityRank = 1` for those,
 * which the sort-key builder enforces by treating null-previous as
 * "no affinity".
 */
function buildPreviousSessionMap(sessions) {
    var byHalfday = Object.create(null);
    for (var i = 0; i < sessions.length; i += 1) {
        var meta = sessions[i];
        var hd = meta.halfdayKey;
        if (typeof hd !== 'string' || hd.length === 0) continue;
        if (!byHalfday[hd]) byHalfday[hd] = [];
        byHalfday[hd].push(meta);
    }

    var prevBySession = Object.create(null);
    var halfdayKeys = Object.keys(byHalfday);
    for (var hi = 0; hi < halfdayKeys.length; hi += 1) {
        var group = byHalfday[halfdayKeys[hi]];
        if (group.length <= 1) {
            // Single-session halfday: no previous.
            for (var g0 = 0; g0 < group.length; g0 += 1) {
                prevBySession[group[g0].sessionKey] = null;
            }
            continue;
        }
        // Sort by (sessionLabel ASC, sessionKey ASC) for a deterministic order.
        group.sort(function (a, b) {
            var la = a.sessionLabel || '';
            var lb = b.sessionLabel || '';
            if (la < lb) return -1;
            if (la > lb) return 1;
            if (a.sessionKey < b.sessionKey) return -1;
            if (a.sessionKey > b.sessionKey) return 1;
            return 0;
        });
        prevBySession[group[0].sessionKey] = null;
        for (var g = 1; g < group.length; g += 1) {
            prevBySession[group[g].sessionKey] = group[g - 1].sessionKey;
        }
    }

    return prevBySession;
}

// ---------------------------------------------------------------------------
// Per-session candidate filtering
// ---------------------------------------------------------------------------

/**
 * Determine whether `key` is currently a guard in any row of the session.
 *
 * This is the EXPLICIT alternative to relying solely on
 * `entry.guardSessions.has(sessionKey)` — the load state may be stale
 * after Phase 7/8 swaps if occupancy clears were missed for any reason.
 * To be defensive, we ALSO consult `meta.guardKeysInSession` (built from
 * the actual rows by `groupRowsBySession`). If either signal flags the
 * key as a guard, it is treated as a guard.
 */
function isGuardInSession(key, sessionMeta, loadState) {
    if (sessionMeta && sessionMeta.guardKeysInSession
        && sessionMeta.guardKeysInSession[key]) {
        return true;
    }
    if (isPlainObject(loadState) && isPlainObject(loadState.proctors)) {
        var entry = loadState.proctors[key];
        if (entry && entry.guardSessions instanceof Set
            && entry.guardSessions.has(sessionMeta.sessionKey)) {
            return true;
        }
    }
    return false;
}

/**
 * Determine whether `key` is currently a reserve in any OTHER row of the
 * same session (we maintain a per-session chosen-set as we place reserves,
 * so this check always uses that set rather than the load state's
 * `reserveSessions`).
 */
function isReserveAlreadyInSession(key, chosenForSession) {
    return !!chosenForSession[key];
}

/**
 * Build the sorted candidate list for a session per AC 7.5.
 *
 * Sort key (lexicographic ASC):
 *   1. reserveCount(T)  — fewer reserves first (fairness)
 *   2. affinityRank(T)  — 0 if T guarded the previous session of the
 *                          same halfday, else 1 (AC 7.6 / 7.7)
 *   3. finalLoad(T)     — ties broken by total load (lighter first)
 *   4. canonicalKey(T)  — pure code-point ASC (deterministic tiebreaker)
 *
 * Candidates that fail eligibility filters (C-EXEMPT / C-DUTY / C-ME /
 * C-NO-SAME-DAY / already-guard-in-S / already-reserve-in-S) are excluded
 * up-front so the sort operates on a clean pool.
 *
 * @returns {Array<{ key:string, reserveCount:number, affinityRank:number,
 *                    finalLoad:number }>}
 */
function buildCandidatePool(ctx, sessionMeta, chosenForSession) {
    var canonicalKeys = ctx.canonicalKeys;
    var loadState = ctx.loadState;
    var prevSessionKey = ctx.prevSessionBySession[sessionMeta.sessionKey] || null;
    var prevGuardKeys = null;
    if (prevSessionKey && ctx.sessionMetaByKey[prevSessionKey]) {
        prevGuardKeys = ctx.sessionMetaByKey[prevSessionKey].guardKeysInSession;
    }

    // AC-FL2 / AC-FL4 — partition the eligible candidate pool into two
    // ordered tiers around `ctx.reserveGlobalUpper`:
    //   - Tier 1 (under-cap)    : finalLoad + 1 <= reserveGlobalUpper
    //   - Tier 2 (at-or-over cap): finalLoad + 1 >  reserveGlobalUpper
    // Tier 1 is exhausted before any Tier 2 candidate is considered, so
    // the existing sort comparator (reserveCount, affinityRank, finalLoad,
    // key) is preserved as the INTRA-tier ordering — affinity (AC 7.5/
    // 7.6/7.7) remains a tiebreaker, but only among candidates sharing
    // the same Final_Load tier.
    //
    // Edge case: when `ctx.reserveGlobalUpper === 0` (i.e. N === 0, no
    // eligible proctors), the candidate pool itself is empty (`canonicalKeys`
    // would be empty too), so the partition is a no-op. We still keep
    // the same partition expression so the code path is uniform.
    var tier1 = [];
    var tier2 = [];
    var reserveGlobalUpper = (ctx && typeof ctx.reserveGlobalUpper === 'number'
        && Number.isFinite(ctx.reserveGlobalUpper)) ? ctx.reserveGlobalUpper : 0;
    for (var i = 0; i < canonicalKeys.length; i += 1) {
        var key = canonicalKeys[i];
        var procEntry = ctx.proctorByKey[key];
        if (!procEntry) continue;
        var proc = procEntry.proctor;
        var idx = procEntry.idx;

        // AC 7.4 — eligibility filters.
        if (isExempt(proc, idx, sessionMeta.sessionKey, ctx.normalizedExemptions)) continue;
        if (isOnDuty(proc, idx, sessionMeta.halfdayKey, ctx.normalizedDuty)) continue;
        if (isMEBlocked(proc, idx, sessionMeta.halfdayKey, ctx.normalizedME)) continue;
        if (isGuardInSession(key, sessionMeta, loadState)) continue;
        if (isReserveAlreadyInSession(key, chosenForSession)) continue;
        if (wouldViolateSameDay(loadState, key, sessionMeta.halfdayKey, ctx.allowSameDay)) continue;

        // AC 7.5 sort fields.
        var rc = reserveCountOf(loadState, key);
        var fl = finalLoad(loadState, key);
        var affinity;
        if (prevGuardKeys && prevGuardKeys[key]) {
            affinity = 0;
        } else {
            affinity = 1;
        }

        var candidate = {
            key: key,
            reserveCount: rc,
            affinityRank: affinity,
            finalLoad: fl
        };

        if ((fl + 1) <= reserveGlobalUpper) {
            tier1.push(candidate);
        } else {
            tier2.push(candidate);
        }
    }

    function compareCandidates(a, b) {
        if (a.reserveCount !== b.reserveCount) return a.reserveCount - b.reserveCount;
        if (a.affinityRank !== b.affinityRank) return a.affinityRank - b.affinityRank;
        if (a.finalLoad !== b.finalLoad) return a.finalLoad - b.finalLoad;
        if (a.key < b.key) return -1;
        if (a.key > b.key) return 1;
        return 0;
    }

    // Sort tiers INDEPENDENTLY using the existing comparator. The
    // comparator MUST NOT change — affinity remains the second criterion
    // INSIDE each tier (AC 7.5 / 7.6 / 7.7).
    tier1.sort(compareCandidates);
    tier2.sort(compareCandidates);

    return tier1.concat(tier2);
}

// ---------------------------------------------------------------------------
// Imbalance diagnostics (AC 7.8)
// ---------------------------------------------------------------------------

/**
 * After all reserves are placed, identify pairs of (overloadedKey,
 * underloadedKey) such that overloadedKey has reserveCount strictly
 * greater than underloadedKey's reserveCount + 1, AND underloadedKey
 * was structurally blocked from at least one session in which
 * overloadedKey received a reserve role.
 *
 * This is a best-effort diagnostic per AC 7.8. We do NOT attempt
 * exhaustive enumeration; we report at most one entry per
 * underloadedKey to keep the diagnostics manageable.
 *
 * Returns Array<{ overloadedKey, underloadedKey, deltaCount,
 *                 blockingReason }>.
 */
function computeReserveImbalances(ctx, blockingByKey) {
    var keys = ctx.canonicalKeys.slice();
    keys.sort();

    // Find one well-loaded reserve key per session we observed (top of
    // the pool that was actually picked). We use the loadState to find
    // any key with reserveCount >= 2 first.
    var loadState = ctx.loadState;
    var entries = [];
    for (var i = 0; i < keys.length; i += 1) {
        var k = keys[i];
        entries.push({ key: k, count: reserveCountOf(loadState, k) });
    }

    // Sort by count DESC for fast peer lookup.
    entries.sort(function (a, b) {
        if (a.count !== b.count) return b.count - a.count;
        if (a.key < b.key) return -1;
        if (a.key > b.key) return 1;
        return 0;
    });
    if (entries.length === 0) return [];

    var maxCount = entries[0].count;
    var imbalances = [];

    for (var ki = 0; ki < keys.length; ki += 1) {
        var u = keys[ki];
        var uCount = reserveCountOf(loadState, u);
        if (uCount + 1 >= maxCount) continue; // not significantly imbalanced
        var reasonInfo = blockingByKey[u];
        if (!reasonInfo) continue;
        // Find any peer with count > uCount + 1.
        var overloaded = null;
        for (var ei = 0; ei < entries.length; ei += 1) {
            if (entries[ei].count <= uCount + 1) break;
            overloaded = entries[ei].key;
            break;
        }
        if (!overloaded) continue;
        imbalances.push({
            overloadedKey: overloaded,
            underloadedKey: u,
            deltaCount: maxCount - uCount,
            blockingReason: reasonInfo
        });
    }
    return imbalances;
}

// ---------------------------------------------------------------------------
// Phase 9 entry point
// ---------------------------------------------------------------------------

/**
 * Run reserves placement on the supplied state.
 *
 * @param {Object} state - pipeline state populated through Phase 8
 * @returns {Object} new state with rows / loadState / diagnostics updated
 */
function placeReserves(state) {
    if (state === null || state === undefined) {
        throw new TypeError('placeReserves: state must be an object');
    }
    var input = state.input;
    if (!isPlainObject(input)) {
        throw new TypeError('placeReserves: state.input must be a plain object');
    }

    // Carry diagnostics forward with FRESH arrays.
    var prevDiag = isPlainObject(state.diagnostics) ? state.diagnostics : null;
    var prevWarnings = prevDiag && Array.isArray(prevDiag.warnings) ? prevDiag.warnings.slice() : [];
    var prevErrors = prevDiag && Array.isArray(prevDiag.errors) ? prevDiag.errors.slice() : [];
    var prevReserveImbalances = prevDiag && Array.isArray(prevDiag.reserveImbalances)
        ? prevDiag.reserveImbalances.slice() : [];

    var nextDiag = {};
    if (prevDiag) {
        var dkeys = Object.keys(prevDiag);
        for (var dk = 0; dk < dkeys.length; dk += 1) {
            nextDiag[dkeys[dk]] = prevDiag[dkeys[dk]];
        }
    }
    nextDiag.warnings = prevWarnings;
    nextDiag.errors = prevErrors;
    nextDiag.reserveImbalances = prevReserveImbalances;
    // AC-FL3 / Requirement 2.4 — `finalLoadOverflows` MUST always be
    // present as a FRESH array on every code path (including the empty-
    // rows early return below). Carry forward any prior list verbatim.
    nextDiag.finalLoadOverflows = (prevDiag && Array.isArray(prevDiag.finalLoadOverflows))
        ? prevDiag.finalLoadOverflows.slice()
        : [];

    var inRows = Array.isArray(state.rows) ? state.rows : null;
    if (inRows === null || inRows.length === 0) {
        var ns0 = shallowCopyState(state);
        ns0.diagnostics = nextDiag;
        return ns0;
    }

    var loadState = state.loadState;
    if (!isPlainObject(loadState) || !isPlainObject(loadState.proctors)) {
        throw new TypeError('placeReserves: state.loadState missing or malformed — initialize via createLoadState');
    }

    // Resolve config + context.
    var reservesConfig = resolveReservesConfig(input);
    var proctorByKey = buildProctorIndex(input.proctorsList);
    var canonicalKeys = Object.keys(proctorByKey);
    canonicalKeys.sort();

    var normalizedExemptions = isPlainObject(state.normalizedExemptionsData)
        ? state.normalizedExemptionsData : {};
    var normalizedDuty = isPlainObject(state.normalizedDutyData)
        ? state.normalizedDutyData : {};
    var normalizedME = isPlainObject(state.normalizedMEAssignments)
        ? state.normalizedMEAssignments : {};
    var allowSameDay = !!(input.examDistributionRules
        && input.examDistributionRules.allowSameDayBothHalfdays);

    // Group rows by session and build the previous-session map.
    var grouped = groupRowsBySession(inRows);
    var sessionMetaByKey = Object.create(null);
    for (var smi = 0; smi < grouped.sessions.length; smi += 1) {
        sessionMetaByKey[grouped.sessions[smi].sessionKey] = grouped.sessions[smi];
    }
    var prevSessionBySession = buildPreviousSessionMap(grouped.sessions);

    // ---- Reserve_Global_Upper (Final_Load fairness cap) -------------------
    //
    // Reserve_Global_Upper := ceil((G + R + D) / N)
    //   - G : total guard slots across all rows (state.bounds.global.gTotalSlots)
    //   - D : expected duty halfday count (state.bounds.global.dExpected)
    //   - N : number of eligible proctors (state.bounds.global.nEligible)
    //   - R : Σ_session computeReserveTarget(reservesConfig, meta.guardCount)
    //         — the cumulative reserve target across all sessions, computed
    //         locally from the same helper Phase 9 already uses (AC 7.2/7.3
    //         unchanged).
    //
    // Phase 3 populates `state.bounds.global` with G, D, N. We prefer those
    // values to stay consistent with the rest of the pipeline. Defensive
    // fallbacks (used by unit tests that hand-build `state` without running
    // Phase 3) recompute the scalars locally with the same formulas Phase 3
    // uses (`Σ row.proctor_keys.length`, `examCenterConfig.expected_duty_tasks
    // / D_expected`, `proctorsList.length`).
    //
    // The cap is consumed by `buildCandidatePool()` to partition candidates
    // into Tier 1 (under cap) and Tier 2 (at/over cap) — see design.md
    // → "Fix Implementation" → "Changes Required" step 1, and AC-FL1.
    var bg = (isPlainObject(state.bounds) && isPlainObject(state.bounds.global))
        ? state.bounds.global : null;

    var capG;
    if (bg && typeof bg.gTotalSlots === 'number' && Number.isFinite(bg.gTotalSlots)) {
        capG = bg.gTotalSlots;
    } else {
        capG = 0;
        for (var giG = 0; giG < inRows.length; giG += 1) {
            var rG = inRows[giG];
            if (rG && Array.isArray(rG.proctor_keys)) {
                capG += rG.proctor_keys.length;
            }
        }
    }

    var capD;
    if (bg && typeof bg.dExpected === 'number' && Number.isFinite(bg.dExpected)) {
        capD = bg.dExpected;
    } else if (isPlainObject(input.examCenterConfig)
        && input.examCenterConfig.expected_duty_tasks != null
        && Number.isFinite(Number(input.examCenterConfig.expected_duty_tasks))) {
        capD = Math.max(0, Math.floor(Number(input.examCenterConfig.expected_duty_tasks)));
    } else if (input.D_expected != null && Number.isFinite(Number(input.D_expected))) {
        capD = Math.max(0, Math.floor(Number(input.D_expected)));
    } else {
        capD = 0;
    }

    var capN;
    if (bg && typeof bg.nEligible === 'number' && Number.isFinite(bg.nEligible)) {
        capN = bg.nEligible;
    } else {
        capN = Array.isArray(input.proctorsList) ? input.proctorsList.length : 0;
    }

    var capR = 0;
    for (var rsi = 0; rsi < grouped.sessions.length; rsi += 1) {
        capR += computeReserveTarget(reservesConfig, grouped.sessions[rsi].guardCount);
    }

    var reserveGlobalUpper = (capN > 0)
        ? Math.ceil((capG + capR + capD) / capN)
        : 0;

    // Sort sessions for deterministic placement order. Two sessions may
    // share a halfday but differ in label / level / subject; we want the
    // FIRST session of each halfday processed before the SECOND so that
    // affinityRank is meaningful when the second's pool is built.
    var sessionsToProcess = grouped.sessions.slice();
    sessionsToProcess.sort(function (a, b) {
        // Prefer halfday-first session before second-of-halfday.
        var aPrev = prevSessionBySession[a.sessionKey];
        var bPrev = prevSessionBySession[b.sessionKey];
        var aIsFirst = aPrev === null ? 0 : 1;
        var bIsFirst = bPrev === null ? 0 : 1;
        if (aIsFirst !== bIsFirst) return aIsFirst - bIsFirst;
        if (a.sessionKey < b.sessionKey) return -1;
        if (a.sessionKey > b.sessionKey) return 1;
        return 0;
    });

    // Prepare a row-clone bookkeeping array. We build the new `rows`
    // array up-front so every row gets a FRESH `reserve_keys` and
    // `reserves` array (AC 10.2). Sessions with no reserves still get
    // fresh empty arrays.
    var newRows = new Array(inRows.length);
    for (var rci = 0; rci < inRows.length; rci += 1) {
        var src = inRows[rci];
        if (!src || typeof src !== 'object') {
            newRows[rci] = src;
            continue;
        }
        var clone = shallowCopyRow(src);
        clone.reserve_keys = [];
        clone.reserves = [];
        newRows[rci] = clone;
    }

    var ctx = {
        canonicalKeys: canonicalKeys,
        proctorByKey: proctorByKey,
        loadState: loadState,
        normalizedExemptions: normalizedExemptions,
        normalizedDuty: normalizedDuty,
        normalizedME: normalizedME,
        allowSameDay: allowSameDay,
        prevSessionBySession: prevSessionBySession,
        sessionMetaByKey: sessionMetaByKey,
        reserveGlobalUpper: reserveGlobalUpper
    };

    // For AC 7.8 imbalance diagnostics: track, per canonical key, the
    // FIRST session in which the candidate would have been picked but
    // was filtered out. We record `{ sessionKey, reason }`.
    var blockingByKey = Object.create(null);

    var timeBudgetMs = (state.options && typeof state.options.phase9TimeBudgetMs === 'number')
        ? state.options.phase9TimeBudgetMs
        : DEFAULT_TIME_BUDGET_MS;
    var startedAt = Date.now();
    function timeRemaining() {
        return Date.now() - startedAt < timeBudgetMs;
    }

    // Walk sessions; for each, build the pool, pick top N, attach to all
    // rows of that session.
    for (var sii = 0; sii < sessionsToProcess.length; sii += 1) {
        if (!timeRemaining()) {
            nextDiag.warnings.push({
                type: 'phase_timeout',
                phase: 'phase9_place_reserves',
                message: 'Phase 9 time budget exhausted; remaining sessions skipped.',
                processedSessions: sii,
                totalSessions: sessionsToProcess.length
            });
            break;
        }
        var meta = sessionsToProcess[sii];
        var rowIndices = grouped.rowsBySession[meta.sessionKey] || [];
        if (rowIndices.length === 0) continue;

        // Reserve count target.
        var rawTarget = computeReserveTarget(reservesConfig, meta.guardCount);
        if (rawTarget <= 0) continue;

        var chosenForSession = Object.create(null);
        var pool = buildCandidatePool(ctx, meta, chosenForSession);
        var actualPick = Math.min(rawTarget, pool.length);

        // Capture imbalance evidence: any pool member NOT picked because
        // we hit the target, AND any candidate filtered by the eligibility
        // gate. We approximate "blocked" by checking each canonical key
        // that did NOT make it into the pool.
        if (actualPick < rawTarget) {
            for (var bki = 0; bki < canonicalKeys.length; bki += 1) {
                var ck = canonicalKeys[bki];
                if (chosenForSession[ck]) continue;
                // Skip keys that ARE in the pool but past the cutoff —
                // those are not "blocked", just lower-priority.
                var inPool = false;
                for (var pi = 0; pi < pool.length; pi += 1) {
                    if (pool[pi].key === ck) { inPool = true; break; }
                }
                if (inPool) continue;
                if (blockingByKey[ck]) continue;

                var procEntry = proctorByKey[ck];
                if (!procEntry) continue;
                var reason = null;
                if (isGuardInSession(ck, meta, loadState)) {
                    reason = 'guarding_session';
                } else if (isExempt(procEntry.proctor, procEntry.idx, meta.sessionKey, normalizedExemptions)) {
                    reason = 'exempt';
                } else if (isOnDuty(procEntry.proctor, procEntry.idx, meta.halfdayKey, normalizedDuty)) {
                    reason = 'on_duty';
                } else if (isMEBlocked(procEntry.proctor, procEntry.idx, meta.halfdayKey, normalizedME)) {
                    reason = 'me_blocked';
                } else if (wouldViolateSameDay(loadState, ck, meta.halfdayKey, allowSameDay)) {
                    reason = 'same_day';
                }
                if (reason) {
                    blockingByKey[ck] = {
                        sessionKey: meta.sessionKey,
                        reason: reason
                    };
                }
            }
        }

        for (var pj = 0; pj < actualPick; pj += 1) {
            var pick = pool[pj];

            // AC-FL3 / Requirement 2.3 — record forced overflows BEFORE
            // committing the placement. The placement itself proceeds
            // unchanged because the reserve role is mandatory (AC 7.2 /
            // 7.3); the overflow is logged, not refused. This branch
            // fires only when Tier 1 was exhausted for this session
            // (otherwise an under-cap candidate would have been picked
            // first by `buildCandidatePool`'s tier ordering).
            if ((pick.finalLoad + 1) > ctx.reserveGlobalUpper) {
                nextDiag.finalLoadOverflows.push({
                    sessionKey: meta.sessionKey,
                    canonicalKey: pick.key,
                    finalLoad: pick.finalLoad + 1,
                    cap: ctx.reserveGlobalUpper,
                    reason: 'forced_overflow'
                });
            }

            chosenForSession[pick.key] = true;

            // Update load state — slot-based reserve count + occupancy.
            addReserveLoad(loadState, pick.key, meta.halfdayKey, meta.dayKey);
            recordReserveOccupancy(loadState, pick.key, meta.sessionKey, meta.halfdayKey);
        }

        // Build the FRESH per-row arrays. We deliberately use distinct
        // array allocations per row so AC 10.2 holds even when later
        // phases or callers mutate one row's reserves.
        //
        // AC 7.4a — at-most-once invariant: each chosen reserve appears
        // in EXACTLY ONE row's `reserve_keys` across the session. We
        // distribute the chosen reserves round-robin across the session's
        // rows. Rows that receive no reserves still get a fresh empty
        // array (AC 10.2).
        var chosenKeys = [];
        for (var pk = 0; pk < actualPick; pk += 1) {
            chosenKeys.push(pool[pk].key);
        }
        // Pre-fill an array of bucket arrays — one per row — and
        // distribute chosenKeys round-robin over the rows. The
        // round-robin is deterministic given the row order produced by
        // Phase 1b (and preserved through subsequent phases).
        var nRows = rowIndices.length;
        var buckets = new Array(nRows);
        for (var bi = 0; bi < nRows; bi += 1) buckets[bi] = [];
        for (var ck = 0; ck < chosenKeys.length; ck += 1) {
            buckets[ck % nRows].push(chosenKeys[ck]);
        }
        for (var ri2 = 0; ri2 < nRows; ri2 += 1) {
            var rIdx = rowIndices[ri2];
            var row = newRows[rIdx];
            if (!row || typeof row !== 'object') continue;
            // Fresh arrays per row.
            row.reserve_keys = buckets[ri2].slice();
            row.reserves = buckets[ri2].slice().map(function (k) {
                var pe = proctorByKey[k];
                if (!pe) return k;
                var p = pe.proctor;
                if (p && typeof p.name === 'string' && p.name.length > 0) return p.name;
                if (p && typeof p.fullName === 'string' && p.fullName.length > 0) return p.fullName;
                return k;
            });
        }
    }

    // AC 7.8 — record reserve imbalances to diagnostics.
    var imbalances = computeReserveImbalances(ctx, blockingByKey);
    if (imbalances.length > 0) {
        for (var im = 0; im < imbalances.length; im += 1) {
            nextDiag.reserveImbalances.push(imbalances[im]);
        }
    }

    var ns = shallowCopyState(state);
    ns.rows = newRows;
    ns.loadState = loadState;
    ns.diagnostics = nextDiag;
    return ns;
}

module.exports = {
    placeReserves: placeReserves,
    _internals: {
        resolveReservesConfig: resolveReservesConfig,
        computeReserveTarget: computeReserveTarget,
        buildProctorIndex: buildProctorIndex,
        groupRowsBySession: groupRowsBySession,
        buildPreviousSessionMap: buildPreviousSessionMap,
        extractSessionLabelFromKey: extractSessionLabelFromKey,
        buildCandidatePool: buildCandidatePool,
        computeReserveImbalances: computeReserveImbalances,
        isGuardInSession: isGuardInSession,
        DEFAULT_TIME_BUDGET_MS: DEFAULT_TIME_BUDGET_MS
    }
};
    };

    __modules["/js/algorithms/proctor-v3/phases/10-finalize.js"] = function (module, exports, require, __dirname, __filename) {
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
    var cin = proctor && proctor.cin != null ? String(proctor.cin).trim() : '';
    if (cin) return cin;
    return '__idx_' + idx;
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
    };

    __modules["/js/algorithms/proctor-v3/solver/cp-solver.js"] = function (module, exports, require, __dirname, __filename) {
'use strict';

/**
 * CP solver core for proctor-distribution-v3 (Phase 4).
 *
 * Implements `solve(model, options)`: a depth-first backtracking CSP solver
 * with AC-3 propagation, smallest-domain-first variable ordering, and
 * least-constraining-value (LCV) value ordering with deterministic
 * lexicographic tiebreak on the canonical key.
 *
 * Model contract
 * --------------
 *   model.variables          : string[]
 *       Ordered list of variable IDs. Order is opaque; ordering decisions
 *       inside the solver are derived from the IDs themselves
 *       (lexicographic) so callers can not influence search direction
 *       through `variables` ordering.
 *
 *   model.initialDomains     : Map<string, Domain>
 *                            | Object<string, Domain>
 *                            | Object<string, string[]>
 *       Per-variable initial candidate set. Plain objects and string arrays
 *       are coerced into `Domain` instances internally; the caller's input
 *       is never mutated.
 *
 *   model.constraints        : Array<ConstraintRecord>
 *       Constraint records compatible with `propagateAC3` from
 *       `./propagators.js`. The solver re-runs AC-3 after each tentative
 *       assignment. Records carrying mutable state (`loadState`) are
 *       responsible for their own cloning during search; the solver
 *       does NOT clone constraint records.
 *
 *   model.costFn?            : (assignment, model) => number
 *       Optional. When present, the solver maintains the best COMPLETE
 *       assignment by cost (lower is better) and continues searching
 *       within budget for a better one. When absent, the solver returns
 *       the FIRST complete assignment it finds.
 *
 * Options
 * -------
 *   options.timeBudgetMs     : number   default 30000
 *       Wall-clock budget. Search returns the best partial solution found
 *       so far when exceeded.
 *
 *   options.now              : () => number  default Date.now
 *       Pluggable clock for deterministic tests.
 *
 * Return shape
 * ------------
 *   {
 *     assignments : { [varId]: canonicalKey } -- possibly partial
 *     partial     : boolean                   -- true iff some var unassigned
 *     timedOut    : boolean
 *     cost        : number | null             -- of returned assignment
 *                                                when costFn provided, else null
 *     stats       : { nodesExplored, conflicts, propagateCalls, elapsedMs }
 *   }
 *
 * Variable ordering
 * -----------------
 *   Smallest-domain-first (a.k.a. MRV — Minimum Remaining Values). Among
 *   unassigned variables, pick the one whose current Domain is smallest.
 *   Ties broken by ascending lexicographic order on the variable ID.
 *
 *   Variables with `size() === 0` should not occur at this point because
 *   AC-3 already detected wipeouts; if one slips through, search treats
 *   it as a dead end and backtracks.
 *
 * Value ordering — LCV
 * --------------------
 *   For the chosen variable V with domain D(V), order each candidate
 *   value v by the total number of removals it would cause from peer
 *   variables' domains, ascending (the "least constraining" comes first).
 *   Ties broken by canonicalKey ASC.
 *
 *   "Peer" = any variable that shares a constraint record with V whose
 *   record exposes a `varGroup` array. We approximate "removal count" by
 *   counting, for each peer P with current domain D(P), 1 if `v ∈ D(P)`
 *   (because committing V=v would force at least that removal under
 *   AllDifferent or upper-bound semantics). This is cheap, deterministic,
 *   and a sound LCV proxy.
 *
 * Best-partial tracking
 * ---------------------
 *   Throughout the search the solver records the assignment with the
 *   highest variable count seen so far. Ties broken by lower cost when
 *   `costFn` is supplied; otherwise by the lexicographically smaller
 *   stringified assignment so the result is deterministic across runs.
 *   When the search finishes (or times out) without a complete
 *   assignment, this best partial is returned.
 *
 * Determinism
 * -----------
 *   Given the same model (same variable list, same initial domains, same
 *   constraints) and no `costFn`, two runs of `solve` produce byte-
 *   identical `assignments` objects. Achieved by:
 *     1. Sorted iteration over `model.variables` in `Object.keys`-style
 *        helpers, and explicit lexicographic tiebreaks throughout.
 *     2. `Domain.toArray()` returns sorted values.
 *     3. Best-partial tiebreak is deterministic (see above).
 *
 * V2 pitfalls avoided
 * -------------------
 *   - V2's solver mutated load state in place during search without
 *     reliable rollback. V3 clones the entire `domains` collection
 *     (Domain instances cloned via `Domain.clone()`) before each
 *     tentative assignment and discards on backtrack.
 *   - V2 short-circuited on first feasible assignment regardless of cost.
 *     V3 supports anytime optimisation via `costFn`.
 */

const { Domain } = require('./domain.js');
const { propagateAC3 } = require('./propagators.js');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Solve the CSP described by `model`.
 *
 * @param {Object} model - see file header for contract.
 * @param {Object} [options]
 * @returns {{
 *   assignments: Object<string, string>,
 *   partial: boolean,
 *   timedOut: boolean,
 *   cost: number | null,
 *   stats: { nodesExplored: number, conflicts: number, propagateCalls: number, elapsedMs: number }
 * }}
 */
function solve(model, options) {
    const opts = options || {};
    const timeBudgetMs = typeof opts.timeBudgetMs === 'number' && opts.timeBudgetMs >= 0
        ? opts.timeBudgetMs
        : 30000;
    const now = typeof opts.now === 'function' ? opts.now : Date.now;
    const startedAt = now();

    if (!model || typeof model !== 'object') {
        throw new TypeError('solve: model must be an object');
    }
    if (!Array.isArray(model.variables)) {
        throw new TypeError('solve: model.variables must be an array');
    }
    const constraints = Array.isArray(model.constraints) ? model.constraints : [];
    const costFn = typeof model.costFn === 'function' ? model.costFn : null;

    // Build initial domains (Map for deterministic insertion-order iteration).
    const domains = buildInitialDomains(model);

    const stats = {
        nodesExplored: 0,
        conflicts: 0,
        propagateCalls: 0,
        elapsedMs: 0
    };

    // Initial AC-3.
    stats.propagateCalls += 1;
    const initialResult = propagateAC3(domains, constraints);
    if (!initialResult || initialResult.ok === false) {
        stats.conflicts += 1;
        stats.elapsedMs = now() - startedAt;
        return {
            assignments: {},
            partial: model.variables.length > 0,
            timedOut: false,
            cost: null,
            stats: stats
        };
    }

    // Precompute peer map: varId -> array of varGroup arrays it belongs to,
    // used by LCV value ordering. Built once (constraints don't move).
    const peerGroups = buildPeerGroups(constraints);

    /** @type {{ assignments: Object<string,string>, count: number, cost: number|null }} */
    const best = { assignments: {}, count: 0, cost: null };

    /** @type {{ assignments: Object<string,string>, cost: number|null } | null} */
    let bestComplete = null;

    const ctx = {
        model: model,
        constraints: constraints,
        peerGroups: peerGroups,
        costFn: costFn,
        stats: stats,
        startedAt: startedAt,
        timeBudgetMs: timeBudgetMs,
        now: now,
        best: best,
        bestComplete: { ref: null }, // boxed so search can update
        timedOut: { flag: false }
    };
    ctx.bestComplete.ref = bestComplete;

    // Run DFS.
    search({}, domains, ctx);

    stats.elapsedMs = now() - startedAt;

    // Resolve final answer.
    if (ctx.bestComplete.ref) {
        return {
            assignments: ctx.bestComplete.ref.assignments,
            partial: false,
            timedOut: ctx.timedOut.flag,
            cost: ctx.bestComplete.ref.cost,
            stats: stats
        };
    }
    return {
        assignments: best.assignments,
        partial: best.count < model.variables.length,
        timedOut: ctx.timedOut.flag,
        cost: costFn ? best.cost : null,
        stats: stats
    };
}

// ---------------------------------------------------------------------------
// DFS core
// ---------------------------------------------------------------------------

/**
 * Recursive DFS body.
 *
 * `assignment` is a plain object mapping committed varId -> value.
 * `domains` is the current Map<varId, Domain> (already AC-3-pruned for
 * the current branch).
 *
 * Returns nothing — best/bestComplete are accumulated through `ctx`.
 */
function search(assignment, domains, ctx) {
    // Time check at the top of every recursion frame.
    if (timeExpired(ctx)) {
        ctx.timedOut.flag = true;
        return;
    }

    ctx.stats.nodesExplored += 1;

    // Update best-partial if applicable.
    recordPartial(assignment, ctx);

    // Choose next variable (smallest-domain-first; lex tiebreak).
    const nextVarId = chooseVariable(assignment, domains, ctx.model.variables);

    if (nextVarId === null) {
        // All variables assigned — complete solution.
        recordComplete(assignment, ctx);
        return;
    }

    const dom = domains.get(nextVarId);
    if (!dom || dom.isEmpty()) {
        // Should be filtered by AC-3, but handle defensively.
        return;
    }

    // Order values via LCV.
    const ordered = orderValues(nextVarId, dom, domains, ctx.peerGroups);

    for (let i = 0; i < ordered.length; i += 1) {
        if (timeExpired(ctx)) {
            ctx.timedOut.flag = true;
            return;
        }

        const value = ordered[i];

        // Tentatively assign: clone domains, restrict the chosen var to {value}.
        const childDomains = cloneDomains(domains);
        const childDom = new Domain([value]);
        childDomains.set(nextVarId, childDom);

        // Propagate.
        ctx.stats.propagateCalls += 1;
        const result = propagateAC3(childDomains, ctx.constraints);
        if (!result || result.ok === false) {
            ctx.stats.conflicts += 1;
            continue;
        }

        // Recurse with extended assignment.
        const childAssignment = Object.assign({}, assignment);
        childAssignment[nextVarId] = value;
        search(childAssignment, childDomains, ctx);

        // Early termination: no costFn and we have a complete solution → stop.
        if (!ctx.costFn && ctx.bestComplete.ref) {
            return;
        }

        // Time check after recursion in case the deeper branch consumed budget.
        if (timeExpired(ctx)) {
            ctx.timedOut.flag = true;
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Coerce model.initialDomains into a fresh `Map<string, Domain>`.
 * Accepts:
 *   - Map<string, Domain>
 *   - Object<string, Domain>
 *   - Object<string, string[]>     (arrays converted to Domain)
 *   - missing entries default to an empty Domain (which will trigger
 *     immediate conflict via AC-3 for that variable).
 */
function buildInitialDomains(model) {
    const out = new Map();
    const src = model.initialDomains;
    const vars = model.variables;

    const get = (id) => {
        if (!src) return null;
        if (src instanceof Map) return src.get(id);
        return Object.prototype.hasOwnProperty.call(src, id) ? src[id] : null;
    };

    for (let i = 0; i < vars.length; i += 1) {
        const id = vars[i];
        const raw = get(id);
        let domain;
        if (raw instanceof Domain) {
            domain = raw.clone();
        } else if (Array.isArray(raw)) {
            domain = new Domain(raw);
        } else if (raw == null) {
            domain = new Domain();
        } else if (typeof raw[Symbol.iterator] === 'function') {
            domain = new Domain(raw);
        } else {
            throw new TypeError(
                'solve: model.initialDomains[' + JSON.stringify(id) + '] must be Domain, array, or iterable'
            );
        }
        out.set(id, domain);
    }
    return out;
}

/**
 * Deep-clone a Map<string, Domain>: each Domain is cloned via Domain.clone().
 */
function cloneDomains(src) {
    const out = new Map();
    for (const [id, d] of src) {
        out.set(id, d.clone());
    }
    return out;
}

/**
 * Build peer-group map for LCV: varId -> Array<string[]> (the varGroups
 * the variable participates in). Constraints without a `varGroup` array
 * are skipped (custom revise constraints can't contribute to the LCV
 * heuristic without exposing their scope).
 */
function buildPeerGroups(constraints) {
    const map = Object.create(null);
    for (let i = 0; i < constraints.length; i += 1) {
        const c = constraints[i];
        if (!c || !Array.isArray(c.varGroup)) continue;
        for (let j = 0; j < c.varGroup.length; j += 1) {
            const id = c.varGroup[j];
            if (typeof id !== 'string') continue;
            if (!map[id]) map[id] = [];
            map[id].push(c.varGroup);
        }
    }
    return map;
}

/**
 * Pick the next variable: smallest current Domain, lex tiebreak on ID.
 * Returns `null` if all variables are assigned.
 *
 * To preserve determinism we iterate `variables` in sorted order.
 */
function chooseVariable(assignment, domains, variables) {
    const sortedIds = variables.slice().sort();
    let chosenId = null;
    let chosenSize = Infinity;
    for (let i = 0; i < sortedIds.length; i += 1) {
        const id = sortedIds[i];
        if (Object.prototype.hasOwnProperty.call(assignment, id)) continue;
        const d = domains.get(id);
        const s = d ? d.size() : 0;
        // Strictly smaller wins; ties resolved by sort order (already lex).
        if (s < chosenSize) {
            chosenId = id;
            chosenSize = s;
            if (s === 0) {
                // Empty domain — return immediately so the caller can
                // backtrack. Not strictly necessary because AC-3 already
                // catches wipeouts, but defensive.
                return id;
            }
        }
    }
    return chosenId;
}

/**
 * Order a Domain's values using LCV.
 *
 * For each candidate v:
 *   removalCount(v) = sum over peer P of (1 if v in domains[P] else 0)
 *
 * Smaller removalCount comes first. Ties broken by canonicalKey ASC.
 *
 * Returns a freshly allocated array of strings.
 */
function orderValues(varId, dom, domains, peerGroups) {
    const values = dom.toArray(); // already sorted lex (deterministic basis).
    const groups = peerGroups[varId] || [];

    if (groups.length === 0) {
        // No peers known — lexicographic order is the right deterministic
        // fallback and also a valid "least-constraining" answer (all
        // values are equally constraining).
        return values;
    }

    // Collect peer set (excluding self), de-duplicated.
    const peerSet = Object.create(null);
    for (let i = 0; i < groups.length; i += 1) {
        const g = groups[i];
        for (let j = 0; j < g.length; j += 1) {
            const id = g[j];
            if (id !== varId) peerSet[id] = true;
        }
    }
    const peerIds = Object.keys(peerSet);

    const scored = new Array(values.length);
    for (let i = 0; i < values.length; i += 1) {
        const v = values[i];
        let removals = 0;
        for (let p = 0; p < peerIds.length; p += 1) {
            const pd = domains.get(peerIds[p]);
            if (!pd) continue;
            // Domain doesn't expose a public has(); use toArray membership.
            // Cheap: peerIds count is small (≤ tens) at the row/session
            // group sizes used by Phase 4.
            const arr = pd.toArray();
            if (binarySearchHas(arr, v)) removals += 1;
        }
        scored[i] = { value: v, score: removals };
    }
    scored.sort(function (a, b) {
        if (a.score !== b.score) return a.score - b.score;
        if (a.value < b.value) return -1;
        if (a.value > b.value) return 1;
        return 0;
    });
    const out = new Array(scored.length);
    for (let i = 0; i < scored.length; i += 1) out[i] = scored[i].value;
    return out;
}

/**
 * Binary search a sorted string array for an exact match.
 */
function binarySearchHas(sortedArr, target) {
    let lo = 0;
    let hi = sortedArr.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        const v = sortedArr[mid];
        if (v === target) return true;
        if (v < target) lo = mid + 1;
        else hi = mid - 1;
    }
    return false;
}

/**
 * Record `assignment` as a candidate "best partial" if it beats the
 * current incumbent.
 *
 * Ranking:
 *   1. Higher `count` (number of assigned variables) wins.
 *   2. With `costFn`: lower cost wins on ties.
 *   3. Otherwise: lexicographically smaller stringification wins on ties
 *      (purely for determinism).
 */
function recordPartial(assignment, ctx) {
    const count = countKeys(assignment);
    if (count === 0) return;

    const incumbent = ctx.best;

    if (count < incumbent.count) return;

    if (count > incumbent.count) {
        incumbent.assignments = Object.assign({}, assignment);
        incumbent.count = count;
        incumbent.cost = ctx.costFn ? safeCost(ctx.costFn, assignment, ctx.model) : null;
        return;
    }

    // count === incumbent.count
    if (ctx.costFn) {
        const c = safeCost(ctx.costFn, assignment, ctx.model);
        if (incumbent.cost == null || c < incumbent.cost) {
            incumbent.assignments = Object.assign({}, assignment);
            incumbent.cost = c;
        }
        return;
    }

    // No costFn — deterministic tiebreak.
    const incStr = canonicalAssignmentString(incumbent.assignments);
    const newStr = canonicalAssignmentString(assignment);
    if (newStr < incStr) {
        incumbent.assignments = Object.assign({}, assignment);
    }
}

/**
 * Record `assignment` as a complete solution; updates `ctx.bestComplete`.
 *
 * Without `costFn`, the first complete assignment wins and is final
 * (caller will short-circuit further search).
 *
 * With `costFn`, the lowest-cost complete assignment seen so far wins;
 * search continues until budget exhausted.
 */
function recordComplete(assignment, ctx) {
    if (!ctx.costFn) {
        if (!ctx.bestComplete.ref) {
            ctx.bestComplete.ref = {
                assignments: Object.assign({}, assignment),
                cost: null
            };
        }
        return;
    }
    const c = safeCost(ctx.costFn, assignment, ctx.model);
    if (!ctx.bestComplete.ref || c < ctx.bestComplete.ref.cost) {
        ctx.bestComplete.ref = {
            assignments: Object.assign({}, assignment),
            cost: c
        };
    }
}

/**
 * Apply `costFn` defensively — non-numeric returns map to +Infinity so
 * the assignment is dominated by any properly-scored alternative.
 */
function safeCost(costFn, assignment, model) {
    let v;
    try {
        v = costFn(assignment, model);
    } catch (e) {
        return Infinity;
    }
    return typeof v === 'number' && !Number.isNaN(v) ? v : Infinity;
}

/**
 * Stable string for an assignment, used for deterministic tiebreaks.
 */
function canonicalAssignmentString(assignment) {
    const ids = Object.keys(assignment).sort();
    const parts = new Array(ids.length);
    for (let i = 0; i < ids.length; i += 1) {
        parts[i] = ids[i] + '=' + assignment[ids[i]];
    }
    return parts.join('|');
}

function countKeys(obj) {
    let n = 0;
    for (const k in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) n += 1;
    }
    return n;
}

function timeExpired(ctx) {
    return (ctx.now() - ctx.startedAt) >= ctx.timeBudgetMs;
}

module.exports = { solve };
    };

    __modules["/js/algorithms/proctor-v3/solver/domain.js"] = function (module, exports, require, __dirname, __filename) {
'use strict';

/**
 * Domain — set of candidate canonical proctor keys for a single CP variable.
 *
 * Wraps a `Set<string>` (canonical keys) and provides only the operations the
 * AC-3 propagator and CP solver need:
 *
 *   - `intersect(other)` — pure; returns a NEW Domain containing keys present
 *                          in both `this` and `other`. Neither operand is
 *                          mutated. Used by the AC-3 propagator to compute
 *                          the next candidate domain without losing the
 *                          previous snapshot.
 *   - `remove(value)`    — in-place; removes `value` from this Domain and
 *                          returns `this` for chaining.
 *   - `size()`           — number of remaining values.
 *   - `isEmpty()`        — `true` iff `size() === 0`.
 *   - `toArray()`        — returns a NEW array of the values in ascending
 *                          lexicographic order (Requirement 8.5: deterministic
 *                          iteration over input data structures regardless of
 *                          host JS engine insertion order).
 *   - `clone()`          — returns a NEW Domain with the same values; the
 *                          clone is independent (mutating one does not affect
 *                          the other).
 *
 * Invariants:
 *   - All stored values are strings (canonical proctor keys). The constructor
 *     coerces inputs via `String(...)` defensively, but callers SHOULD pass
 *     already-canonical keys produced by `canonicalProctorKey`.
 *   - `null` / `undefined` values are silently dropped at construction time.
 *   - `toArray()` is the ONLY iteration entry point; callers MUST use it
 *     instead of iterating the underlying Set directly to preserve
 *     deterministic order.
 */

/**
 * Construct a Domain.
 *
 * @param {Iterable<string>} [values] - optional iterable of canonical keys.
 *   Accepts arrays, Sets, or any iterable. Duplicates are collapsed.
 *   `null` / `undefined` entries are skipped.
 */
function Domain(values) {
    if (!(this instanceof Domain)) {
        return new Domain(values);
    }
    this._set = new Set();
    if (values == null) {
        return;
    }
    if (typeof values[Symbol.iterator] !== 'function') {
        throw new TypeError('Domain: values must be iterable');
    }
    for (const v of values) {
        if (v == null) continue;
        this._set.add(typeof v === 'string' ? v : String(v));
    }
}

/**
 * Intersect with another Domain.
 *
 * Pure: returns a NEW Domain whose values are the keys present in both
 * `this` and `other`. Neither operand is mutated.
 *
 * Iterates the smaller of the two sets for efficiency.
 *
 * @param {Domain} other
 * @returns {Domain}
 */
Domain.prototype.intersect = function (other) {
    if (!(other instanceof Domain)) {
        throw new TypeError('Domain.intersect: argument must be a Domain');
    }
    const result = new Domain();
    const a = this._set;
    const b = other._set;
    // Iterate the smaller set; lookup in the larger one.
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    for (const v of small) {
        if (large.has(v)) {
            result._set.add(v);
        }
    }
    return result;
};

/**
 * Remove a value from this Domain in place.
 *
 * Returns `this` for fluent chaining. No-op when the value is absent.
 *
 * @param {string} value - canonical key to remove
 * @returns {Domain} this
 */
Domain.prototype.remove = function (value) {
    if (value == null) return this;
    this._set.delete(typeof value === 'string' ? value : String(value));
    return this;
};

/**
 * @returns {number} number of values currently in this Domain.
 */
Domain.prototype.size = function () {
    return this._set.size;
};

/**
 * @returns {boolean} true iff `size() === 0`.
 */
Domain.prototype.isEmpty = function () {
    return this._set.size === 0;
};

/**
 * Return the Domain values as a sorted array.
 *
 * Sort is ascending lexicographic on the canonical-key strings (default
 * `Array.prototype.sort`). This guarantees deterministic iteration regardless
 * of host JS engine `Set` insertion order (Requirement 8.5).
 *
 * @returns {string[]} new array, freshly allocated; safe for caller mutation.
 */
Domain.prototype.toArray = function () {
    return Array.from(this._set).sort();
};

/**
 * Return an independent copy of this Domain.
 *
 * Mutating the clone (`remove`) does NOT affect the original, and vice-versa.
 *
 * @returns {Domain}
 */
Domain.prototype.clone = function () {
    const copy = new Domain();
    for (const v of this._set) {
        copy._set.add(v);
    }
    return copy;
};

module.exports = { Domain };
    };

    __modules["/js/algorithms/proctor-v3/solver/propagators.js"] = function (module, exports, require, __dirname, __filename) {
'use strict';

/**
 * AC-3 propagators for the proctor-v3 CP solver.
 *
 * This module exposes three pure-ish helpers that operate on a `domains`
 * collection (a Map keyed by variable id → Domain instance — plain objects
 * are also accepted as a legacy convenience). The propagators are used by
 * Phase 4 (place-guards) and the CP driver to prune candidate values before
 * search.
 *
 * Domain shape
 * ------------
 *   `domains` MUST be either:
 *     - a `Map<string, Domain>` (preferred — deterministic iteration in
 *       insertion order, supports any string key), OR
 *     - a plain object `{ [varId: string]: Domain }` (legacy; iterated via
 *       `Object.keys(...).sort()` for determinism).
 *
 *   Variable IDs are opaque strings supplied by Phase 4 (e.g.
 *   `row3:slot1`). Values are canonical proctor keys.
 *
 *   Mutation policy: propagators mutate the supplied Domain instances in
 *   place via `Domain.remove(...)`. Callers that need rollback MUST clone
 *   each Domain before invocation. The `domains` collection itself is NOT
 *   replaced — only the contained Domains shrink.
 *
 * Return shape
 * ------------
 *   Each propagator returns one of:
 *     - `{ ok: true, changed: <boolean> }` — propagation completed; `changed`
 *       indicates whether at least one Domain shrunk.
 *     - `{ ok: false, conflict: <description> }` — propagation detected a
 *       wipe-out (some Domain became empty, or two singletons collided in an
 *       AllDifferent). The caller should treat the current partial assignment
 *       as infeasible and backtrack.
 *
 * Acceptance Criteria covered
 * ---------------------------
 *   - 3.5 : C-NO-DOUBLE within a row — `propagateAllDifferent` enforces it
 *           when the row's variables are passed as a `varGroup`.
 *   - 3.6 : C-NO-DOUBLE across rows of the same session — same propagator,
 *           supplied with the session's variable group.
 *   - 5.6 : Per-class upper bound — `propagateUpperBound` removes from every
 *           variable's domain any value `k` whose class already reached its
 *           upper bound in `loadState` (Primary_Load = guardCount + dutyCount).
 *           The propagator does NOT itself increment the load — the solver
 *           commits assignments separately.
 *
 * Design notes
 * ------------
 *   - Input mutation: `domains` Domains are mutated in place (see above).
 *     `loadState`, `classBounds`, and `classByProctorKey` are read-only.
 *   - Determinism: when iterating the `domains` collection, we use Map
 *     iteration order (insertion order, deterministic) or sorted Object keys.
 *     Within a Domain we use `toArray()` which is sorted lexicographically.
 *   - The driver `propagateAC3` reuses these helpers via a constraint record
 *     `{ type, varGroup, ... }`; unknown types fall through to a custom
 *     `revise(domain)` callback if present, otherwise are skipped (logged
 *     into `conflict.unknownTypes`).
 *
 * V2 pitfalls avoided
 * -------------------
 *   - V2 mixed AllDifferent enforcement with assignment commits, making it
 *     impossible to roll back. V3 separates propagation (this module) from
 *     load-state mutation (the solver commit step).
 *   - V2's class-upper check used `Guard_Count` only; V3 uses Primary_Load
 *     (Guard_Count + Duty_Count) since duty is fixed before Phase 4.
 */

const { Domain } = require('./domain.js');
const { primaryLoad } = require('../utils/load-state.js');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read a Domain out of `domains`, supporting both Map and plain-object shapes.
 * Returns `null` if absent or not a Domain instance.
 *
 * @param {Map<string, Domain>|Object<string, Domain>} domains
 * @param {string} varId
 * @returns {Domain|null}
 */
function getDomain(domains, varId) {
    if (!domains || typeof varId !== 'string') return null;
    let d;
    if (domains instanceof Map) {
        d = domains.get(varId);
    } else {
        d = domains[varId];
    }
    return d instanceof Domain ? d : null;
}

/**
 * Ordered iteration over a `domains` collection.
 *
 * For Map: preserves insertion order (deterministic in JS).
 * For plain object: keys are sorted lexicographically.
 *
 * Used internally to make the AllDifferent fixed-point loop deterministic
 * across host JS engines.
 *
 * @param {Map<string, Domain>|Object<string, Domain>} domains
 * @returns {string[]}
 */
function listVarIds(domains) {
    if (!domains) return [];
    if (domains instanceof Map) {
        return Array.from(domains.keys());
    }
    return Object.keys(domains).sort();
}

// ---------------------------------------------------------------------------
// AllDifferent
// ---------------------------------------------------------------------------

/**
 * Enforce AllDifferent over a group of variables.
 *
 * Algorithm — singleton propagation to fixpoint:
 *   1. Scan `varGroup` for variables whose Domain is a singleton (size === 1).
 *   2. For each such variable V with value v, remove v from every OTHER
 *      Domain in `varGroup`.
 *   3. If a removal makes another variable a singleton, queue it; loop
 *      until no new singletons appear.
 *
 * Conflict detection:
 *   - If two variables in `varGroup` are already singletons holding the
 *     SAME value, return `{ ok: false, conflict: ... }` immediately.
 *   - If a removal empties a Domain, return `{ ok: false, conflict: ... }`.
 *
 * This is the "naive" AllDifferent — strong enough for our row/session-sized
 * groups (typically 2–8 variables). For larger groups a Hopcroft–Karp
 * matching could be used, but the ratio of variables to candidates here
 * keeps singleton propagation cheap.
 *
 * @param {Map<string, Domain>|Object<string, Domain>} domains
 * @param {string[]} varGroup - variable IDs sharing the AllDifferent.
 * @returns {{ ok: true, changed: boolean }
 *           | { ok: false, conflict: { type: string, varId?: string, value?: string, varIds?: string[] } }}
 */
function propagateAllDifferent(domains, varGroup) {
    if (!Array.isArray(varGroup) || varGroup.length === 0) {
        return { ok: true, changed: false };
    }

    // Resolve all involved Domains up front; skip null entries (unknown vars).
    /** @type {Array<{ id: string, domain: Domain }>} */
    const members = [];
    for (let i = 0; i < varGroup.length; i += 1) {
        const id = varGroup[i];
        const d = getDomain(domains, id);
        if (d) members.push({ id: id, domain: d });
    }
    if (members.length < 2) {
        // With 0 or 1 active member, AllDifferent is trivially satisfied.
        return { ok: true, changed: false };
    }

    let changed = false;

    // Worklist of variable IDs whose Domain is a confirmed singleton and
    // whose value still needs to be propagated to the rest of the group.
    const queue = [];

    // Track which singleton VALUES we've already processed, to detect a
    // collision (two distinct vars asserting the same singleton value).
    const seenSingletonValue = Object.create(null);

    // Seed: every initially-singleton variable joins the queue.
    for (let i = 0; i < members.length; i += 1) {
        const m = members[i];
        if (m.domain.isEmpty()) {
            return {
                ok: false,
                conflict: { type: 'domain_wipeout', varId: m.id }
            };
        }
        if (m.domain.size() === 1) {
            const v = m.domain.toArray()[0];
            const prevId = seenSingletonValue[v];
            if (prevId && prevId !== m.id) {
                return {
                    ok: false,
                    conflict: {
                        type: 'all_different_collision',
                        value: v,
                        varIds: [prevId, m.id]
                    }
                };
            }
            seenSingletonValue[v] = m.id;
            queue.push({ id: m.id, value: v });
        }
    }

    // Drain the worklist; new singletons that appear during propagation are
    // appended.
    while (queue.length > 0) {
        const { id: srcId, value: v } = queue.shift();
        for (let j = 0; j < members.length; j += 1) {
            const other = members[j];
            if (other.id === srcId) continue;

            const d = other.domain;
            const sizeBefore = d.size();
            // `Domain.remove` is a no-op when the value is absent. We
            // detect actual removal by comparing the size — cheaper than
            // a separate membership probe and uses only the public API.
            d.remove(v);
            if (d.size() === sizeBefore) {
                continue;
            }
            changed = true;

            if (d.isEmpty()) {
                return {
                    ok: false,
                    conflict: { type: 'domain_wipeout', varId: other.id }
                };
            }
            if (d.size() === 1) {
                const newVal = d.toArray()[0];
                const prevId = seenSingletonValue[newVal];
                if (prevId && prevId !== other.id) {
                    return {
                        ok: false,
                        conflict: {
                            type: 'all_different_collision',
                            value: newVal,
                            varIds: [prevId, other.id]
                        }
                    };
                }
                seenSingletonValue[newVal] = other.id;
                queue.push({ id: other.id, value: newVal });
            }
        }
    }

    return { ok: true, changed: changed };
}

// ---------------------------------------------------------------------------
// Class upper-bound propagator
// ---------------------------------------------------------------------------

/**
 * Enforce per-class upper bound on a group of variables.
 *
 * For every variable V in `varGroup` and every value k currently in V's
 * Domain, remove k iff the class of k has already reached its upper bound:
 *
 *     primaryLoad(loadState, k) >= classUpperBound(class(k))
 *
 * `primaryLoad = Guard_Count + Duty_Count`. The propagator removes the
 * value from the Domain so the solver cannot assign it; it does NOT itself
 * mutate `loadState` — that happens when the solver commits an assignment.
 *
 * Conflict: if a Domain becomes empty after pruning, return ok:false.
 *
 * Signature note (file-header rationale)
 * --------------------------------------
 * The task spec lists `(domains, varGroup, classBounds, loadState)`. To
 * actually decide the bound we also need:
 *   - `classByProctorKey` — to look up the class of each candidate value.
 * We therefore accept an `options` object that carries `classByProctorKey`,
 * keeping the rest of the signature aligned with the task spec. This is
 * the smallest deviation that preserves correctness.
 *
 * @param {Map<string, Domain>|Object<string, Domain>} domains
 * @param {string[]} varGroup
 * @param {Object<string, { upper: number }>} classBounds  - classId → bounds record
 *        (matches the `byClass` shape produced by `constraints/bounds.js`).
 * @param {Object} loadState  - per `utils/load-state.js`
 * @param {{ classByProctorKey: Object<string, string> }} options
 * @returns {{ ok: true, changed: boolean }
 *           | { ok: false, conflict: { type: string, varId?: string } }}
 */
function propagateUpperBound(domains, varGroup, classBounds, loadState, options) {
    if (!Array.isArray(varGroup) || varGroup.length === 0) {
        return { ok: true, changed: false };
    }
    const opts = options || {};
    const classByProctorKey = opts.classByProctorKey || {};
    const bounds = classBounds || {};

    let changed = false;

    for (let i = 0; i < varGroup.length; i += 1) {
        const id = varGroup[i];
        const d = getDomain(domains, id);
        if (!d) continue;
        if (d.isEmpty()) {
            return {
                ok: false,
                conflict: { type: 'domain_wipeout', varId: id }
            };
        }

        // Snapshot values before mutation; `toArray()` is sorted (stable).
        const values = d.toArray();
        for (let j = 0; j < values.length; j += 1) {
            const k = values[j];
            const classId = classByProctorKey[k];
            if (typeof classId !== 'string') continue;
            const bound = bounds[classId];
            if (!bound || typeof bound.upper !== 'number') continue;

            if (primaryLoad(loadState, k) >= bound.upper) {
                d.remove(k);
                changed = true;
            }
        }

        if (d.isEmpty()) {
            return {
                ok: false,
                conflict: { type: 'domain_wipeout', varId: id }
            };
        }
    }

    return { ok: true, changed: changed };
}

// ---------------------------------------------------------------------------
// AC-3 driver
// ---------------------------------------------------------------------------

/**
 * Generic AC-3 driver.
 *
 * Consumes a list of constraint records and runs them to fixpoint. A
 * "round" runs every constraint once; if any reported `changed === true`,
 * a new round is scheduled. Termination is guaranteed because each round
 * either shrinks at least one Domain (which can only decrease) or quits.
 *
 * Constraint record shapes accepted:
 *   - `{ type: 'allDifferent', varGroup: string[] }`
 *   - `{ type: 'upperBound', varGroup: string[], classBounds, loadState, classByProctorKey }`
 *   - `{ type: 'custom', varGroup: string[], revise(domains, varGroup) -> result }`
 *     where `result` matches the standard propagator return shape.
 *   - Any record with a `revise(domains)` function is invoked verbatim.
 *
 * On the first conflict, the driver returns `{ ok: false, conflict }`
 * immediately without running the remaining constraints.
 *
 * @param {Map<string, Domain>|Object<string, Domain>} domains
 * @param {Array<Object>} constraints
 * @returns {{ ok: true, changed: boolean } | { ok: false, conflict: Object }}
 */
function propagateAC3(domains, constraints) {
    const list = Array.isArray(constraints) ? constraints : [];
    if (list.length === 0) {
        return { ok: true, changed: false };
    }

    // Fail-loud guard: detect any pre-existing empty Domain.
    const ids = listVarIds(domains);
    for (let i = 0; i < ids.length; i += 1) {
        const d = getDomain(domains, ids[i]);
        if (d && d.isEmpty()) {
            return {
                ok: false,
                conflict: { type: 'domain_wipeout', varId: ids[i] }
            };
        }
    }

    let totalChanged = false;
    // Outer loop: keep iterating until a full pass produces no change.
    // The number of iterations is bounded by the total number of values
    // across all Domains (each iteration must remove ≥ 1 value to schedule
    // another round), so this terminates.
    let safety = 0;
    const maxRounds = (function () {
        let n = 0;
        for (let i = 0; i < ids.length; i += 1) {
            const d = getDomain(domains, ids[i]);
            if (d) n += d.size();
        }
        // +1 for the inevitable "no-change" terminating round.
        return n + 1;
    }());

    let roundChanged = true;
    while (roundChanged) {
        if (safety++ > maxRounds) {
            // Defensive: should be unreachable. Treat as conflict.
            return {
                ok: false,
                conflict: { type: 'ac3_nontermination', maxRounds: maxRounds }
            };
        }
        roundChanged = false;

        for (let i = 0; i < list.length; i += 1) {
            const c = list[i];
            if (!c || typeof c !== 'object') continue;

            let result;
            if (typeof c.revise === 'function') {
                result = c.revise(domains, c.varGroup);
            } else if (c.type === 'allDifferent') {
                result = propagateAllDifferent(domains, c.varGroup);
            } else if (c.type === 'upperBound') {
                result = propagateUpperBound(
                    domains,
                    c.varGroup,
                    c.classBounds,
                    c.loadState,
                    { classByProctorKey: c.classByProctorKey }
                );
            } else {
                // Unknown constraint type without a revise callback — skip
                // silently rather than fail. The solver may compose its own
                // constraint kinds; the driver remains agnostic.
                continue;
            }

            if (!result || result.ok === false) {
                return result || { ok: false, conflict: { type: 'unknown' } };
            }
            if (result.changed) {
                roundChanged = true;
                totalChanged = true;
            }
        }
    }

    return { ok: true, changed: totalChanged };
}

module.exports = {
    propagateAllDifferent: propagateAllDifferent,
    propagateUpperBound: propagateUpperBound,
    propagateAC3: propagateAC3,
    // Internal helpers exposed for white-box testing only.
    _internals: {
        getDomain: getDomain,
        listVarIds: listVarIds
    }
};
    };

    __modules["/js/algorithms/proctor-v3/utils/load-state.js"] = function (module, exports, require, __dirname, __filename) {
'use strict';

/**
 * Load-state utilities for proctor-distribution-v3.
 *
 * The LoadState is an accumulator object passed through the pipeline phases.
 * Each entry tracks per-proctor counts:
 *   - guardCount   : slot-based count of guard assignments
 *   - dutyCount    : slot-based count of duty assignments (per halfday entry)
 *   - reserveCount : slot-based count of reserve assignments
 *   - amCount      : guard slots in morning (صباحا) period
 *   - pmCount      : guard slots in afternoon (مساء) period
 *
 * Mutation policy:
 *   The `add*` functions mutate the LoadState in place — the caller is
 *   expected to treat the LoadState as a single accumulator that flows
 *   through phases (Phase 4 fills guardCount, Phase 9 fills reserveCount,
 *   etc). This avoids deep-cloning a large object on every increment.
 *
 *   Within a phase, the standard pattern is:
 *     const stateOut = { ...stateIn, loadState: stateIn.loadState };
 *     addGuardLoad(stateOut.loadState, key, ...);
 *
 *   Phases that need to roll back must clone before mutating.
 *
 * V3 vs V2 — CRITICAL DIFFERENCE:
 *   V2's addReserveLoad was halfday-based (used a Set of halfday keys, only
 *   incrementing reserveCount when a NEW halfday was added). This made
 *   Reserve_Count count distinct halfdays NOT slots, breaking reserve
 *   fair-ordering (Requirement 7.5).
 *
 *   V3 is consistently slot-based across all three add functions:
 *   addGuardLoad, addDutyLoad, addReserveLoad ALL increment on every call.
 *
 * Acceptance Criteria covered:
 *   - 5.1  : Primary_Load = Guard_Count + Duty_Count (slot-based)
 *   - 6.4  : AM/PM balance counters per proctor
 *   - 7.5  : Reserve_Count is slot-based, used in reserve fair ordering
 */

// Recognized period values for AM/PM bucketing.
// Anything outside these sets is treated as neither (defensive).
//   - 'صباحا'  (AM / morning) and 'زوالا' (noon / afternoon, PM) are the two
//     period strings used by the production fixture (45454.json).
const AM_PERIODS = Object.freeze(['صباحا', 'AM', 'morning']);
const PM_PERIODS = Object.freeze(['مساء', 'زوالا', 'PM', 'afternoon']);

/**
 * Create a fresh per-proctor entry with all counts at zero.
 *
 * @returns {{
 *   guardCount: number,
 *   dutyCount: number,
 *   reserveCount: number,
 *   amCount: number,
 *   pmCount: number
 * }}
 */
function createEntry() {
    return {
        guardCount: 0,
        dutyCount: 0,
        reserveCount: 0,
        amCount: 0,
        pmCount: 0,
    };
}

/**
 * Initialize a LoadState for the given canonical keys, all counts at zero.
 *
 * If `canonicalKeys` is empty/null/undefined, returns an empty `proctors`
 * object — the add* functions lazily create entries on first use.
 *
 * @param {string[]} canonicalKeys - canonical proctor keys to pre-initialize.
 * @returns {{ proctors: Object<string, ReturnType<typeof createEntry>> }}
 */
function createLoadState(canonicalKeys) {
    const proctors = Object.create(null);

    if (Array.isArray(canonicalKeys)) {
        for (let i = 0; i < canonicalKeys.length; i += 1) {
            const key = canonicalKeys[i];
            if (typeof key !== 'string' || key.length === 0) continue;
            // Pre-initialize. If a duplicate key appears, keep the first
            // entry (idempotent).
            if (!proctors[key]) {
                proctors[key] = createEntry();
            }
        }
    }

    return { proctors: proctors };
}

/**
 * Internal: get-or-create the per-proctor entry for `key`.
 *
 * @param {Object} loadState
 * @param {string} key
 * @returns {ReturnType<typeof createEntry>}
 */
function getOrCreateEntry(loadState, key) {
    if (!loadState || typeof loadState !== 'object' || !loadState.proctors) {
        throw new TypeError('load-state: loadState must be an object with a proctors map');
    }
    if (typeof key !== 'string' || key.length === 0) {
        throw new TypeError('load-state: key must be a non-empty string');
    }
    let entry = loadState.proctors[key];
    if (!entry) {
        entry = createEntry();
        loadState.proctors[key] = entry;
    }
    return entry;
}

/**
 * Increment guard count for `key` (slot-based).
 *
 * Increments on EVERY call — one call per (row, slot) assignment.
 * Also increments amCount or pmCount if `period` is recognized.
 *
 * The halfdayKey/dayKey/sessionKey parameters are accepted for API
 * symmetry with addReserveLoad and to allow future extensions
 * (e.g. tracking sets of halfdays for diagnostics) without a signature
 * change. They are not used for the slot-based count itself.
 *
 * @param {Object} loadState
 * @param {string} key            - canonical proctor key
 * @param {string} halfdayKey     - halfday key (informational)
 * @param {string} dayKey         - day key (informational)
 * @param {string} sessionKey     - session key (informational)
 * @param {string} period         - 'صباحا' | 'AM' | 'morning' for AM,
 *                                  'مساء' | 'PM' | 'afternoon' for PM,
 *                                  anything else: bucketed as neither.
 */
function addGuardLoad(loadState, key, halfdayKey, dayKey, sessionKey, period) {
    const entry = getOrCreateEntry(loadState, key);
    entry.guardCount += 1;
    if (typeof period === 'string') {
        if (AM_PERIODS.indexOf(period) !== -1) {
            entry.amCount += 1;
        } else if (PM_PERIODS.indexOf(period) !== -1) {
            entry.pmCount += 1;
        }
    }
}

/**
 * Increment duty count for `key` (slot-based).
 *
 * User-defined per-halfday duty entries map 1:1 with duty load — each call
 * represents one duty entry. Increments dutyCount on EVERY call.
 *
 * @param {Object} loadState
 * @param {string} key         - canonical proctor key
 * @param {string} halfdayKey  - halfday key (informational)
 */
function addDutyLoad(loadState, key, halfdayKey) {
    const entry = getOrCreateEntry(loadState, key);
    entry.dutyCount += 1;
}

/**
 * Increment reserve count for `key` (slot-based).
 *
 * V3: increments on EVERY call (slot-based), unlike V2 which was
 * halfday-based via a Set. See top-of-file note.
 *
 * @param {Object} loadState
 * @param {string} key         - canonical proctor key
 * @param {string} halfdayKey  - halfday key (informational)
 * @param {string} dayKey      - day key (informational)
 */
function addReserveLoad(loadState, key, halfdayKey, dayKey) {
    const entry = getOrCreateEntry(loadState, key);
    entry.reserveCount += 1;
}

/**
 * Internal accessor that returns the entry for `key` or null if absent.
 *
 * @param {Object} loadState
 * @param {string} key
 * @returns {ReturnType<typeof createEntry> | null}
 */
function getEntry(loadState, key) {
    if (!loadState || typeof loadState !== 'object' || !loadState.proctors) return null;
    if (typeof key !== 'string' || key.length === 0) return null;
    return loadState.proctors[key] || null;
}

/**
 * Primary_Load(T) = Guard_Count(T) + Duty_Count(T).
 *
 * This is the fairness axis used by V3 (Acceptance Criterion 5.1).
 * Returns 0 if `key` is absent (defensive accessor).
 *
 * @param {Object} loadState
 * @param {string} key
 * @returns {number}
 */
function primaryLoad(loadState, key) {
    const entry = getEntry(loadState, key);
    if (!entry) return 0;
    return entry.guardCount + entry.dutyCount;
}

/**
 * Final_Load(T) = Guard_Count(T) + Duty_Count(T) + Reserve_Count(T).
 *
 * Returns 0 if `key` is absent.
 *
 * @param {Object} loadState
 * @param {string} key
 * @returns {number}
 */
function finalLoad(loadState, key) {
    const entry = getEntry(loadState, key);
    if (!entry) return 0;
    return entry.guardCount + entry.dutyCount + entry.reserveCount;
}

/**
 * AM guard-slot count for `key`. Returns 0 if absent.
 *
 * @param {Object} loadState
 * @param {string} key
 * @returns {number}
 */
function amCount(loadState, key) {
    const entry = getEntry(loadState, key);
    return entry ? entry.amCount : 0;
}

/**
 * PM guard-slot count for `key`. Returns 0 if absent.
 *
 * @param {Object} loadState
 * @param {string} key
 * @returns {number}
 */
function pmCount(loadState, key) {
    const entry = getEntry(loadState, key);
    return entry ? entry.pmCount : 0;
}

module.exports = {
    createLoadState,
    addGuardLoad,
    addDutyLoad,
    addReserveLoad,
    primaryLoad,
    finalLoad,
    amCount,
    pmCount,
    // Exposed for testing / advanced consumers
    _internals: {
        AM_PERIODS,
        PM_PERIODS,
        createEntry,
    },
};
    };

    __modules["/js/algorithms/proctor-v3/utils/prng.js"] = function (module, exports, require, __dirname, __filename) {
'use strict';

/**
 * Seeded PRNG using the mulberry32 algorithm.
 *
 * Mulberry32 is a 32-bit state generator with a period of 2^32 — sufficient
 * for proctor-distribution-v3 needs (we draw at most a few thousand values
 * per run). It is deterministic: identical seeds produce identical sequences.
 *
 * Acceptance Criteria covered:
 *   - 8.1: Accept a seed (finite number).
 *   - 8.2: Initialize a seeded PRNG from that value.
 *   - 8.3: When seed absent, caller is expected to derive one from Date.now()
 *          and pass it; this module always requires a numeric seed.
 *
 * @param {number} seed - Any finite number; coerced to uint32.
 * @returns {{ seed: number, next: function(): number, nextInt: function(number): number }}
 *   A plain object (not a class instance) with:
 *     - `seed`     : the original seed value (post-coercion to uint32).
 *     - `next()`   : returns a float in [0, 1).
 *     - `nextInt(n)`: returns an integer in [0, n).
 */
function createPRNG(seed) {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) {
    throw new TypeError('createPRNG: seed must be a finite number');
  }

  // Coerce to unsigned 32-bit integer for a stable starting state.
  const seed32 = seed >>> 0;
  let state = seed32;

  return {
    seed: seed32,

    next() {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },

    nextInt(n) {
      if (!Number.isInteger(n) || n <= 0) {
        throw new RangeError('createPRNG.nextInt: n must be a positive integer');
      }
      return Math.floor(this.next() * n);
    },
  };
}

module.exports = { createPRNG };
    };

    __modules["/js/data/proctor-key-resolver.js"] = function (module, exports, require, __dirname, __filename) {
'use strict';

/**
 * Proctor Key Resolver — H5 fix helper
 *
 * Spec: .kiro/specs/proctor-distribution-db-memory-mismatch/
 * Task 6.H5.1.
 *
 * Pure helpers for resolving a proctor display name from the stable
 * key emitted by `getProctorKey` in `js/algorithms/proctor-distribution-v2.js`:
 *
 *     key := proc.cin || ('__idx_' + idx)
 *
 * Two functions are exposed:
 *
 *   • `resolveProctorDisplayName(key, proctorsList)`
 *       Resolve a single key to a display name. Falls back to the raw key
 *       when the proctor cannot be located or the resolved name is empty.
 *
 *   • `buildProctorDisplayMap(proctorsList)`
 *       Pre-compute a `Map<key, name>` for O(1) lookups during summary
 *       aggregation in `buildSummaryRows()` and the related helpers in
 *       `exams-rooms.html` / `exams-proctors.html`.
 *
 * Loaded via `<script src="js/data/proctor-key-resolver.js"></script>` in
 * the renderer (vanilla-renderer-script convention). Also `require`-able
 * from Node so unit tests under `tests/` can exercise the contract
 * without booting Electron.
 *
 * @see .kiro/specs/proctor-distribution-db-memory-mismatch/design.md
 *      → "Key→name resolution helper (H5 fix)"
 */
(function () {
    var IDX_KEY_RE = /^__idx_(\d+)$/;

    /**
     * Resolve a proctor display name for `key` against `proctorsList`.
     * Falls back to `key` whenever the proctor cannot be located or the
     * resolved name is empty.
     *
     * @param {string} key — `proc.cin` or `'__idx_' + idx`.
     * @param {Array<{cin?: string, teacher_name?: string, teacher_full_name?: string}>|null|undefined} proctorsList
     * @returns {string} Display name, or the raw key when no name is available.
     */
    function resolveProctorDisplayName(key, proctorsList) {
        if (!proctorsList || typeof proctorsList.length !== 'number') {
            return key;
        }

        var match = typeof key === 'string' ? key.match(IDX_KEY_RE) : null;
        if (match) {
            var idx = parseInt(match[1], 10);
            if (idx < 0 || idx >= proctorsList.length) {
                return key;
            }
            var byIdx = proctorsList[idx];
            if (!byIdx) {
                return key;
            }
            return byIdx.teacher_full_name || byIdx.teacher_name || key;
        }

        // CIN-keyed lookup.
        for (var i = 0; i < proctorsList.length; i++) {
            var proc = proctorsList[i];
            if (proc && proc.cin === key) {
                return proc.teacher_full_name || proc.teacher_name || key;
            }
        }
        return key;
    }

    /**
     * Pre-compute a `Map<key, displayName>` for fast lookups during
     * summary aggregation. The key for each entry is exactly what
     * `getProctorKey` would emit: `proc.cin || ('__idx_' + i)`.
     *
     * @param {Array<{cin?: string, teacher_name?: string, teacher_full_name?: string}>|null|undefined} proctorsList
     * @returns {Map<string, string>}
     */
    function buildProctorDisplayMap(proctorsList) {
        var map = new Map();
        if (!proctorsList || typeof proctorsList.length !== 'number') {
            return map;
        }
        for (var i = 0; i < proctorsList.length; i++) {
            var proc = proctorsList[i];
            var key = (proc && proc.cin) ? proc.cin : ('__idx_' + i);
            map.set(key, resolveProctorDisplayName(key, proctorsList));
        }
        return map;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            resolveProctorDisplayName: resolveProctorDisplayName,
            buildProctorDisplayMap: buildProctorDisplayMap
        };
    }
    if (typeof window !== 'undefined') {
        window.GS2 = window.GS2 || {};
        window.GS2.resolveProctorDisplayName = resolveProctorDisplayName;
        window.GS2.buildProctorDisplayMap = buildProctorDisplayMap;
    }
})();
    };

    // ----- entry point -----
    var __entry = __load("/js/algorithms/proctor-v3/index.js");
    if (global) {
        global.ProctorDistributionV3 = __entry;
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
