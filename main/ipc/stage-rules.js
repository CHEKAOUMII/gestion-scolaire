'use strict';

// main/ipc/stage-rules.js
// IPC layer for versioned stage rules (feature 029).
// Thin handlers only: auth (helpers), validation, repo call, error mapping — no domain SQL.

const {
    handleAuthedRead,
    handleWriteSoftAuth,
    requireSchoolYear,
    looksLikeInternalErrorMessage
} = require('./ipc-helpers');
const { resolveCycleForRequest } = require('../auth/resolve-cycle');
const { assertCycleAuthorized } = require('../auth/cycle-access');
const StageRulesErrorContract = require('../../js/shared/errors/stage-rules-error-contract');

const WRITE_ROLES = ['admin', 'principal'];
const MAX_REASON_LENGTH = 500;
const MAX_ENTRIES = 5000;

/**
 * Lazy require: main/repos/stage-rules.js is created in parallel (T014) and may not
 * exist yet. Its API is fixed by the T015 contract, so this module only needs it at
 * call time — registration and the smoke channel scans stay loadable in the meantime.
 */
function getStageRulesRepo() {
    return require('../repos/stage-rules');
}

/** Codes owned by the stage-rules contract (js/shared/errors/stage-rules-error-contract.js). */
const CONTRACT_CODES = new Set([
    'RULES_UNAVAILABLE',
    'MISSING_RULE',
    'INVALID_RULE_VERSION',
    'CONFIRM_REQUIRED',
    'REASON_REQUIRED',
    'COEFFICIENT_OUT_OF_RANGE',
    'EXAM_COUNT_OUT_OF_RANGE',
    'SUBJECT_WEIGHT_OUT_OF_RANGE'
]);

function createDomainError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
}

function inferStageRulesErrorCode(err, fallbackCode) {
    const code = err && err.code;
    if (code && (CONTRACT_CODES.has(code) || code === 'FORBIDDEN' || code === 'UNAUTHENTICATED')) {
        return code;
    }
    const msg = String((err && err.message) || '');
    if (/السنة الدراسية|YYYY\/YYYY|school.?year/i.test(msg)) return 'INVALID_SCHOOL_YEAR';
    if (/السلك|صلاحية|غير مصرح|تسجيل الدخول/i.test(msg)) return 'FORBIDDEN';
    return fallbackCode;
}

/**
 * Map any thrown error to a structured, user-safe IPC response.
 * Does not expose stack traces, SQL, or filesystem internals.
 */
function toStageRulesErrorResponse(err, fallbackCode = 'INTERNAL_ERROR') {
    const code = inferStageRulesErrorCode(err, fallbackCode);
    const def = StageRulesErrorContract.getDefinition(code);
    const rawMsg = String((err && err.message) || '').trim();
    const safeMessage =
        rawMsg && /[\u0600-\u06FF]/.test(rawMsg) && !looksLikeInternalErrorMessage(rawMsg)
            ? rawMsg
            : (def && def.message) || 'حدث خطأ داخلي';
    return {
        success: false,
        code,
        error: safeMessage,
        message: safeMessage,
        retryable: !!(def && def.retryable)
    };
}

function requireReason(reason) {
    const raw = typeof reason === 'string' ? reason.trim() : '';
    if (!raw) {
        throw createDomainError('REASON_REQUIRED', 'يجب إدخال سبب التعديل');
    }
    if (raw.length > MAX_REASON_LENGTH) {
        throw createDomainError('REASON_REQUIRED', `يجب ألا يتجاوز سبب التعديل ${MAX_REASON_LENGTH} حرفاً`);
    }
    return raw;
}

function requireIntegerInRange(fieldLabel, value, min, max, code) {
    const num = Number(value);
    if (!Number.isInteger(num) || num < min || num > max) {
        throw createDomainError(code, `${fieldLabel} يجب أن يكون رقماً صحيحاً بين ${min} و ${max}`);
    }
    return num;
}

/**
 * Cycle authorization per entry: the entry's cycle must match the session's resolved
 * working cycle (resolveCycleForRequest-style check), and non-full roles are limited
 * to their user_cycle_access rows via assertCycleAuthorized (FORBIDDEN otherwise).
 */
function requireCycleEntryScope(db, session, event, entryCycleCode, sessionCycle) {
    const entryCycle = assertCycleAuthorized(db, session, entryCycleCode);
    if (entryCycle !== sessionCycle) {
        throw createDomainError('FORBIDDEN', 'ليس لديك صلاحية للعمل داخل هذا السلك');
    }
    return entryCycle;
}

/** Shared batch pre-checks; resolves the session's working cycle once per save. */
function resolveEntryScope(db, session, event, rawEntries) {
    if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
        throw createDomainError('MISSING_RULE', 'لا توجد مدخلات للتعديل');
    }
    if (rawEntries.length > MAX_ENTRIES) {
        throw createDomainError('MISSING_RULE', `عدد المدخلات يتجاوز الحد الأقصى (${MAX_ENTRIES})`);
    }
    return resolveCycleForRequest(db, event);
}

function validateCoefficientEntries(db, session, event, rawEntries) {
    const sessionCycle = resolveEntryScope(db, session, event, rawEntries);
    return rawEntries.map((raw, index) => {
        const entry = raw && typeof raw === 'object' ? raw : {};
        const cycleCode = requireCycleEntryScope(db, session, event, entry.cycleCode, sessionCycle);
        const levelCode = String(entry.levelCode || '').trim();
        const streamCode = String(entry.streamCode || '').trim();
        const subjectCode = String(entry.subjectCode || '').trim();
        if (!levelCode || !streamCode || !subjectCode) {
            throw createDomainError('MISSING_RULE', `المدخل رقم ${index + 1}: يجب تحديد المستوى والشعبة والمادة`);
        }
        const coefficient = requireIntegerInRange('المعامل', entry.coefficient, 1, 20, 'COEFFICIENT_OUT_OF_RANGE');
        return { cycleCode, levelCode, streamCode, subjectCode, coefficient };
    });
}

function validateExamCountEntries(db, session, event, rawEntries) {
    const sessionCycle = resolveEntryScope(db, session, event, rawEntries);
    return rawEntries.map((raw, index) => {
        const entry = raw && typeof raw === 'object' ? raw : {};
        const cycleCode = requireCycleEntryScope(db, session, event, entry.cycleCode, sessionCycle);
        const levelCode = String(entry.levelCode || '').trim();
        const subjectCode = String(entry.subjectCode || '').trim();
        if (!levelCode || !subjectCode) {
            throw createDomainError('MISSING_RULE', `المدخل رقم ${index + 1}: يجب تحديد المستوى والمادة`);
        }
        const examCount = requireIntegerInRange('عدد الفروض', entry.examCount, 1, 12, 'EXAM_COUNT_OUT_OF_RANGE');
        return { cycleCode, levelCode, subjectCode, examCount };
    });
}

function validateWeightEntries(db, session, event, rawEntries) {
    const sessionCycle = resolveEntryScope(db, session, event, rawEntries);
    return rawEntries.map((raw, index) => {
        const entry = raw && typeof raw === 'object' ? raw : {};
        const cycleCode = requireCycleEntryScope(db, session, event, entry.cycleCode, sessionCycle);
        const subjectCode = String(entry.subjectCode || '').trim();
        const examWeightBps = requireIntegerInRange(
            'نسبة الفروض',
            entry.examWeightBps,
            0,
            10000,
            'SUBJECT_WEIGHT_OUT_OF_RANGE'
        );
        const activityWeightBps = requireIntegerInRange(
            'نسبة الأنشطة',
            entry.activityWeightBps,
            0,
            10000,
            'SUBJECT_WEIGHT_OUT_OF_RANGE'
        );
        if (!subjectCode || examWeightBps + activityWeightBps !== 10000) {
            throw createDomainError('SUBJECT_WEIGHT_OUT_OF_RANGE', `المدخل رقم ${index + 1}: مجموع النسب يجب أن يساوي 100%`);
        }
        return { cycleCode, subjectCode, examWeightBps, activityWeightBps };
    });
}

/**
 * Validate a resetToOfficial payload and enforce cycle auth:
 *  - scope must be 'row' or 'bulk' (MISSING_RULE otherwise)
 *  - row: the single target key must be fully specified and cycle-authorized
 *  - bulk: requires confirm === true (CONFIRM_REQUIRED) and a cycle-authorized session
 */
function validateResetPayload(db, session, event, payload) {
    const scope = String(payload && payload.scope || '');
    if (scope !== 'row' && scope !== 'bulk') {
        throw createDomainError('MISSING_RULE', 'نطاق الاستعادة يجب أن يكون "row" أو "bulk"');
    }
    if (scope === 'row') {
        const sessionCycle = resolveCycleForRequest(db, event);
        const rawKeys = Array.isArray(payload && payload.keys) ? payload.keys : [payload && payload.keys];
        const keys = rawKeys.map((raw) => {
            const key = raw && typeof raw === 'object' ? raw : {};
            const cycleCode = requireCycleEntryScope(db, session, event, key.cycleCode, sessionCycle);
            const levelCode = String(key.levelCode || '').trim();
            const streamCode = String(key.streamCode || '').trim();
            const subjectCode = String(key.subjectCode || '').trim();
            const ruleType = String(key.ruleType || key.rule_type || '').trim();
            if (!subjectCode || (ruleType !== 'weight' && (!levelCode || !streamCode))) {
                throw createDomainError('MISSING_RULE', 'يجب تحديد المستوى والشعبة والمادة لاستعادة القاعدة الرسمية');
            }
            return { cycleCode, levelCode, streamCode, subjectCode, ...(ruleType ? { ruleType } : {}) };
        });
        return { scope, keys };
    }
    if (!(payload && payload.confirm === true)) {
        throw createDomainError('CONFIRM_REQUIRED', 'الاستعادة الجماعية للقيم الرسمية تتطلب تأكيداً صريحاً');
    }
    const sessionCycle = resolveCycleForRequest(db, event);
    assertCycleAuthorized(db, session, sessionCycle);
    return { scope, keys: undefined };
}

function registerStageRulesIpc(ipcMain) {
    handleAuthedRead(ipcMain, 'stageRules:getActive', ({ db }, schoolYear) => {
        try {
            const year = requireSchoolYear(schoolYear);
            const repo = getStageRulesRepo();
            const ruleSet = repo.getActiveRuleSet(db, year);
            const rows = ruleSet
                ? repo.getRuleSetRows(db, ruleSet.id)
                : { coefficients: [], examCounts: [], weights: [] };
            // S4: stage profiles + the year's effectivity spine travel with the
            // payload; consumers resolve via the assignment, never via the catalog.
            return {
                ruleSet,
                rows,
                profiles: repo.getCycleProfiles(db),
                assignments: repo.getActiveAssignments(db, year)
            };
        } catch (err) {
            return toStageRulesErrorResponse(err);
        }
    });

    handleWriteSoftAuth(ipcMain, 'stageRules:saveCoefficients', WRITE_ROLES, ({ db, event, session }, payload) => {
        try {
            const year = requireSchoolYear(payload && payload.schoolYear);
            const reason = requireReason(payload && payload.reason);
            const entries = validateCoefficientEntries(db, session, event, payload && payload.entries);
            const result = getStageRulesRepo().saveCoefficients(db, {
                schoolYear: year,
                entries,
                reason,
                actor: session
            });
            return { success: true, ...(result || {}) };
        } catch (err) {
            return toStageRulesErrorResponse(err);
        }
    }, { withContext: true });

    handleWriteSoftAuth(ipcMain, 'stageRules:saveAll', WRITE_ROLES, ({ db, event, session }, payload) => {
        try {
            const year = requireSchoolYear(payload && payload.schoolYear);
            const reason = requireReason(payload && payload.reason);
            const rawCoefficients = Array.isArray(payload?.coefficientEntries) ? payload.coefficientEntries : [];
            const rawExamCounts = Array.isArray(payload?.examCountEntries) ? payload.examCountEntries : [];
            const rawWeights = Array.isArray(payload?.weightEntries) ? payload.weightEntries : [];
            const coefficientEntries = rawCoefficients.length
                ? validateCoefficientEntries(db, session, event, rawCoefficients)
                : [];
            const examCountEntries = rawExamCounts.length
                ? validateExamCountEntries(db, session, event, rawExamCounts)
                : [];
            const weightEntries = rawWeights.length ? validateWeightEntries(db, session, event, rawWeights) : [];
            const result = getStageRulesRepo().saveAllRules(db, {
                schoolYear: year,
                coefficientEntries,
                examCountEntries,
                weightEntries,
                reason,
                actor: session
            });
            return { success: true, ...(result || {}) };
        } catch (err) {
            return toStageRulesErrorResponse(err);
        }
    }, { withContext: true });

    handleWriteSoftAuth(ipcMain, 'stageRules:saveExamCounts', WRITE_ROLES, ({ db, event, session }, payload) => {
        try {
            const year = requireSchoolYear(payload && payload.schoolYear);
            const reason = requireReason(payload && payload.reason);
            const entries = validateExamCountEntries(db, session, event, payload && payload.entries);
            const result = getStageRulesRepo().saveExamCounts(db, {
                schoolYear: year,
                entries,
                reason,
                actor: session
            });
            return { success: true, ...(result || {}) };
        } catch (err) {
            return toStageRulesErrorResponse(err);
        }
    }, { withContext: true });

    handleWriteSoftAuth(ipcMain, 'stageRules:resetToOfficial', WRITE_ROLES, ({ db, event, session }, payload) => {
        try {
            const year = requireSchoolYear(payload && payload.schoolYear);
            const reason = requireReason(payload && payload.reason);
            const reset = validateResetPayload(db, session, event, payload);
            const result = getStageRulesRepo().resetToOfficial(db, {
                schoolYear: year,
                scope: reset.scope,
                keys: reset.keys,
                confirm: payload && payload.confirm,
                reason,
                actor: session
            });
            return { success: true, ...(result || {}) };
        } catch (err) {
            return toStageRulesErrorResponse(err);
        }
    }, { withContext: true });
}

module.exports = {
    registerStageRulesIpc,
    toStageRulesErrorResponse,
    requireReason,
    validateCoefficientEntries,
    validateExamCountEntries,
    validateWeightEntries,
    validateResetPayload,
    MAX_REASON_LENGTH,
    WRITE_ROLES
};
