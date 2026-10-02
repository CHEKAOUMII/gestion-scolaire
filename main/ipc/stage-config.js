'use strict';

// main/ipc/stage-config.js
// IPC layer for stage-scoped configuration (isolation plan Slice 5, §"Slice 5").
// Thin handlers only: role/session auth, field validation, cycle resolution,
// repo call, error mapping — no domain SQL (all SQL lives in
// main/repos/stage-config.js).
//
// SYNC CONTRACT: device-local like page-access permissions and app defaults
// (AGENTS.md "App Defaults and Page Access") — the write channel is
// `exclude: true` in CHANNEL_REGISTRY, never captured, zero outbox rows.

const {
    handleAuthedRead,
    handleWriteSoftAuth,
    requireSchoolYear,
    sanitizeIpcErrorMessage
} = require('./ipc-helpers');
const { resolveCycleForRequest } = require('../auth/resolve-cycle');
const { assertCycleAuthorized } = require('../auth/cycle-access');
const StageConfigErrorContract = require('../../js/shared/errors/stage-config-error-contract');

// Same convention as stageRules: config management is an admin/principal duty.
// Teachers may read their own stage's config but never write it.
const WRITE_ROLES = ['admin', 'principal'];

/**
 * Domain/auth codes that may legitimately reach this surface from validation,
 * cycle resolution, auth helpers, and the repo. Everything else collapses to
 * INTERNAL_ERROR so stack traces, SQL, and filesystem internals never leak.
 */
const PASSTHROUGH_CODES = new Set([
    'UNKNOWN_CYCLE',
    'STAGE_CONFIG_MISSING',
    'STAGE_CONFIG_INVALID',
    'FORBIDDEN',
    'UNAUTHENTICATED',
    'SESSION_LOCKED',
    'INVALID_SCHOOL_YEAR',
    'NO_USABLE_CYCLE',
    'CYCLE_SELECTION_REQUIRED'
]);

function createStageConfigIpcError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
}

/** Map any thrown error to a flat, user-safe response preserving domain codes. */
function toStageConfigErrorResponse(err) {
    const rawCode = err && err.code;
    const code = PASSTHROUGH_CODES.has(rawCode) ? rawCode : 'INTERNAL_ERROR';
    const sanitized = sanitizeIpcErrorMessage(err);
    const hasSpecificMessage = sanitized !== 'حدث خطأ داخلي';
    const message = hasSpecificMessage ? sanitized : StageConfigErrorContract.getMessage(code);
    return { success: false, code, error: message, message };
}

function getStageConfigRepo() {
    return require('../repos/stage-config');
}

/** Missing/empty payload fields are client mistakes → STAGE_CONFIG_INVALID, never INTERNAL_ERROR. */
function requirePayloadFields(payload, fields) {
    if (!payload || typeof payload !== 'object') {
        throw createStageConfigIpcError(
            StageConfigErrorContract.STAGE_CONFIG_ERROR_CODES.STAGE_CONFIG_INVALID,
            'البيانات المطلوبة غير موجودة'
        );
    }
    const missing = fields.filter((field) => {
        const value = payload[field];
        return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
    });
    if (missing.length) {
        throw createStageConfigIpcError(
            StageConfigErrorContract.STAGE_CONFIG_ERROR_CODES.STAGE_CONFIG_INVALID,
            `الحقول المطلوبة ناقصة: ${missing.join(', ')}`
        );
    }
}

/**
 * Resolve the caller's working stage from the session (never from renderer
 * input) and assert the grant. resolveCycleForRequest already authorizes the
 * context path; the explicit assertCycleAuthorized keeps the grant check
 * visible at this surface for both read and write paths.
 */
function resolveAuthorizedCycle(db, event, session) {
    const cycleCode = resolveCycleForRequest(db, event);
    assertCycleAuthorized(db, session, cycleCode);
    return cycleCode;
}

function registerStageConfigIpc(ipcMain) {
    handleAuthedRead(ipcMain, 'stageConfig:get', ({ db, event, session }, payload) => {
        try {
            requirePayloadFields(payload, ['schoolYear', 'configKey']);
            const year = requireSchoolYear(payload.schoolYear);
            const cycleCode = resolveAuthorizedCycle(db, event, session);
            const config = getStageConfigRepo().resolveStageConfig(db, year, cycleCode, payload.configKey);
            return { success: true, config };
        } catch (err) {
            return toStageConfigErrorResponse(err);
        }
    });

    handleAuthedRead(ipcMain, 'stageConfig:list', ({ db, event, session }, schoolYear) => {
        try {
            const year = requireSchoolYear(schoolYear);
            const cycleCode = resolveAuthorizedCycle(db, event, session);
            const configs = getStageConfigRepo().listStageConfigs(db, year, cycleCode);
            return { success: true, cycleCode, configs };
        } catch (err) {
            return toStageConfigErrorResponse(err);
        }
    });

    handleWriteSoftAuth(
        ipcMain,
        'stageConfig:save',
        WRITE_ROLES,
        ({ db, event, session }, payload) => {
            try {
                requirePayloadFields(payload, ['schoolYear', 'configKey', 'value']);
                const year = requireSchoolYear(payload.schoolYear);
                const cycleCode = resolveAuthorizedCycle(db, event, session);
                const result = getStageConfigRepo().saveStageConfig(db, {
                    schoolYear: year,
                    cycleCode,
                    configKey: payload.configKey,
                    value: payload.value
                });
                return { success: true, ...result };
            } catch (err) {
                return toStageConfigErrorResponse(err);
            }
        },
        { withContext: true }
    );
}

module.exports = { registerStageConfigIpc, toStageConfigErrorResponse, WRITE_ROLES };
