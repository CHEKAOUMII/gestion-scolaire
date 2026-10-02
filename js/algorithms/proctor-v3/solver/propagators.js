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
