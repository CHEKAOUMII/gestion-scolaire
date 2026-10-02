'use strict';

// main/ipc/stage-transition.js
// IPC layer for the Slice 6 transition seam — the single intentional cross-stage path.
// Thin handler only: role/session auth, field validation, dual-cycle authorization,
// repo call, error mapping — no domain SQL.

const { handleWriteSoftAuth, requireSchoolYear, sanitizeIpcErrorMessage } = require('./ipc-helpers');
const { requireFields } = require('./validation');
const { ALLOWED_ROLES } = require('../auth/permissions');
const { assertCycleAuthorized } = require('../auth/cycle-access');

// Same convention as students/grades/schoolOps: every non-viewer role may reach the
// handler; the dual-cycle grant check below is the real gate (a teacher with only
// one stage grant gets FORBIDDEN, an admin/principal holds full access by role).
const WRITE_ROLES = ALLOWED_ROLES.filter((role) => role !== 'viewer');

/**
 * Domain/auth codes that may legitimately reach this surface from validation,
 * auth helpers, and the repo. Everything else collapses to INTERNAL_ERROR so
 * stack traces, SQL, and filesystem internals never leak to the renderer.
 */
const PASSTHROUGH_CODES = new Set([
    'FORBIDDEN',
    'UNAUTHENTICATED',
    'SESSION_LOCKED',
    'INVALID_SCHOOL_YEAR',
    'INVALID_TRANSITION',
    'STUDENT_NOT_FOUND',
    'TRANSITION_CONFLICT'
]);

function toStageTransitionErrorResponse(err) {
    const code = err && PASSTHROUGH_CODES.has(err.code) ? err.code : 'INTERNAL_ERROR';
    const message = sanitizeIpcErrorMessage(err);
    return { success: false, code, error: message, message };
}

function getStageTransitionRepo() {
    return require('../repos/stage-transition');
}

function registerStageTransitionIpc(ipcMain) {
    handleWriteSoftAuth(
        ipcMain,
        'stageTransition:transferStudent',
        WRITE_ROLES,
        ({ db, session }, payload) => {
            try {
                requireFields(payload, [
                    'studentCode',
                    'fromYear',
                    'toYear',
                    'fromCycle',
                    'toCycle',
                    'transitionType',
                    'idempotencyKey',
                    'effectiveDate'
                ]);
                const fromYear = requireSchoolYear(payload.fromYear);
                const toYear = requireSchoolYear(payload.toYear);
                // Dual-cycle authorization first: fail closed before any write. The
                // repo re-asserts both grants (never IPC-only), mirroring row 129.
                assertCycleAuthorized(db, session, payload.fromCycle);
                assertCycleAuthorized(db, session, payload.toCycle);
                const result = getStageTransitionRepo().transferStudent(
                    db,
                    {
                        studentCode: payload.studentCode,
                        fromYear,
                        toYear,
                        fromCycle: payload.fromCycle,
                        toCycle: payload.toCycle,
                        transitionType: payload.transitionType,
                        idempotencyKey: payload.idempotencyKey,
                        effectiveDate: payload.effectiveDate,
                        reason: payload.reason
                    },
                    { actor: session }
                );
                return { success: true, ...result };
            } catch (err) {
                return toStageTransitionErrorResponse(err);
            }
        },
        { withContext: true }
    );
}

module.exports = { registerStageTransitionIpc, toStageTransitionErrorResponse, WRITE_ROLES };
