'use strict';

/**
 * Resolve the education cycle a request must operate in
 * (docs/plans/2026-07-30-cycle-scoping-students-slice.md, D2 and D4).
 *
 * Order of resolution, and nothing else:
 *   1. the session's active cycle context, when the sender has selected one — but the
 *      cached context is revalidated on every request against the current institution
 *      state (`is_active` + capability) and the user grant; a stale or disabled context
 *      fails closed and never falls through to another cycle;
 *   2. otherwise the institution's single enabled *supported* cycle.
 *
 * A `cycle_code` sent by the renderer is never consulted. When more than one usable
 * cycle exists and the caller has no context — the pre-login bulk-import case — the
 * request is refused rather than guessed, because picking one would silently file a
 * whole import under the wrong cycle.
 */

const cyclesRepo = require('../repos/cycles');
const { getSessionByEvent } = require('../ipc/auth');
const { peekContext } = require('./active-cycle-context');
const { filterAuthorizedCycles, assertCycleAuthorized } = require('./cycle-access');

/** Cycles a session may actually work in: enabled and with shipped policies. */
function listUsableCycles(db) {
    return cyclesRepo.listCycles(db).filter((cycle) => Number(cycle.is_active) && cycle.capability === 'supported');
}

/**
 * @param {object} db
 * @param {object} event  Electron IPC event (may be undefined on legacy paths)
 * @returns {string} cycle_code
 * @throws when no cycle is usable, or when the choice is ambiguous without a session
 */
function resolveCycleForRequest(db, event) {
    const session = getSessionByEvent(event);
    const context = peekContext(event);
    const contextBelongsToSession =
        context?.cycleCode && (!session || context.userId === Number(session.userId));
    if (contextBelongsToSession) {
        assertCycleAuthorized(db, session, context.cycleCode);
        // S0 gate: the cached context must still match the current institution state.
        // A cycle that was disabled, removed, or downgraded after the context was set
        // fails closed here — the request must never silently fall through to another
        // cycle (docs/plans/2026-08-02-multi-stage-school-architecture.md, §3 S0).
        cyclesRepo.assertCycleIsActive(db, context.cycleCode);
        return context.cycleCode;
    }

    const usable = filterAuthorizedCycles(db, listUsableCycles(db), session);
    if (!usable.length) throw new Error('لا يوجد سلك مصرح ومتاح للعمل');
    if (usable.length > 1) throw new Error('يتعذر تحديد السلك — يرجى تسجيل الدخول قبل تنفيذ هذه العملية');
    return usable[0].cycle_code;
}

module.exports = { resolveCycleForRequest, listUsableCycles };
