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
var _canonicalKeyModule = require(path.join(__dirname, '..', 'canonical-key.js'));
var canonicalProctorKey = _canonicalKeyModule.canonicalProctorKey;


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
    // SSOT: js/algorithms/proctor-v3/canonical-key.js
    return canonicalProctorKey(proctor, idx);
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
