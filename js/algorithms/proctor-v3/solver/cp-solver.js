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
