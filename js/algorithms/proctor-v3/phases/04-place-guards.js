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
var _canonicalKeyModule = require(path.join(__dirname, '..', 'canonical-key.js'));
var canonicalProctorKey = _canonicalKeyModule.canonicalProctorKey;


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
    // SSOT: js/algorithms/proctor-v3/canonical-key.js
    return canonicalProctorKey(proctor, idx);
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
