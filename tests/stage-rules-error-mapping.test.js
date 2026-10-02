'use strict';

/**
 * Stage-rules error plumbing (multi-stage review verdict, Phase 4A items 1, 2, 4, 5):
 *   (a) typed codes survive IPC mapping — Arabic-text regex inference is dead
 *   (b) message rewording never changes the emitted code
 *   (c) internal / SQLite-style codes collapse to the fallback, never leak
 *   (d) MISSING_RULE vs RULES_INPUT_INVALID split (missing-rule vs payload validation)
 *   (e) renderErrorMessage: server-message precedence, catalog fallback only
 *   (f) requireSchoolYear and resolveCycleForRequest throws carry typed codes
 */

const assert = require('assert');
const {
    toStageRulesErrorResponse,
    requireReason,
    validateCoefficientEntries,
    validateResetPayload
} = require('../main/ipc/stage-rules');
const { requireSchoolYear } = require('../main/ipc/ipc-helpers');
const { resolveCycleForRequest } = require('../main/auth/resolve-cycle');
const Contract = require('../js/shared/errors/stage-rules-error-contract');
const { ensureInstitutionCyclesSchema } = require('../main/db/schema');
const { getActiveSessions } = require('../main/ipc/auth');

function openDb() {
    try {
        const Database = require('better-sqlite3');
        return new Database(':memory:');
    } catch {
        const { DatabaseSync } = require('node:sqlite');
        return new DatabaseSync(':memory:');
    }
}

function domainError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
}

function buildTwoCycleDb() {
    const db = openDb();
    ensureInstitutionCyclesSchema(db);
    db.prepare(
        `INSERT INTO institution_cycles (cycle_code, is_active, seed_profile_version_hint, sort_order)
         VALUES ('secondary_collegial', 1, 'collegial-2026-v1', 10)`
    ).run();
    db.prepare(
        `INSERT INTO institution_cycles (cycle_code, is_active, seed_profile_version_hint, sort_order)
         VALUES ('secondary_qualifiant', 1, 'qualifiant-2026-v1', 20)`
    ).run();
    return db;
}

(async () => {
    // ── (a) typed codes survive IPC mapping ──
    assert.strictEqual(
        toStageRulesErrorResponse(domainError('RULES_INPUT_INVALID', 'المدخلات غير صالحة')).code,
        'RULES_INPUT_INVALID'
    );
    assert.strictEqual(
        toStageRulesErrorResponse(domainError('FORBIDDEN', 'ليس لديك صلاحية')).code,
        'FORBIDDEN'
    );
    assert.strictEqual(
        toStageRulesErrorResponse(domainError('CYCLE_SELECTION_REQUIRED', 'يتعذر تحديد السلك')).code,
        'CYCLE_SELECTION_REQUIRED'
    );
    assert.strictEqual(
        toStageRulesErrorResponse(domainError('NO_USABLE_CYCLE', 'لا يوجد سلك مصرح')).code,
        'NO_USABLE_CYCLE'
    );
    assert.strictEqual(
        toStageRulesErrorResponse(domainError('RULES_UNAVAILABLE', 'لا تتوفر نسخة قواعد')).code,
        'RULES_UNAVAILABLE'
    );

    // A bare Arabic message WITHOUT a typed code no longer guesses FORBIDDEN from text.
    const untyped = toStageRulesErrorResponse(new Error('السلك غير مصرح للعمل'));
    assert.strictEqual(untyped.code, 'INTERNAL_ERROR', 'no Arabic-text inference');
    assert.ok(/[\u0600-\u06FF]/.test(untyped.error), 'safe Arabic text still surfaces');

    // ── (b) message rewording never changes the emitted code ──
    const rewording = toStageRulesErrorResponse(domainError('FORBIDDEN', 'صلاحية معدلة بالكامل'));
    assert.strictEqual(rewording.code, 'FORBIDDEN', 'rewording must not change the code');

    // ── (c) internal / SQLite-style codes collapse, never leak ──
    const internal = toStageRulesErrorResponse(
        domainError('SQLITE_CONSTRAINT', 'SQLITE_CONSTRAINT: UNIQUE constraint failed')
    );
    assert.strictEqual(internal.code, 'INTERNAL_ERROR');
    assert.strictEqual(internal.error, 'حدث خطأ داخلي');

    // ── (d) MISSING_RULE vs RULES_INPUT_INVALID split ──
    assert.throws(
        () => requireReason('   '),
        (error) => error.code === 'REASON_REQUIRED'
    );
    assert.throws(
        () => validateCoefficientEntries(null, null, null, []),
        (error) => error.code === 'RULES_INPUT_INVALID' && /مدخلات/.test(error.message),
        'empty entries are payload validation, not MISSING_RULE'
    );
    assert.throws(
        () => validateResetPayload(null, null, null, { scope: 'sideways' }),
        (error) => error.code === 'RULES_INPUT_INVALID',
        'invalid reset scope is payload validation'
    );
    assert.throws(
        () => validateResetPayload(null, null, null, { scope: 'bulk' }),
        (error) => error.code === 'CONFIRM_REQUIRED'
    );
    assert.strictEqual(Contract.MISSING_RULE, 'MISSING_RULE');
    assert.strictEqual(Contract.RULES_INPUT_INVALID, 'RULES_INPUT_INVALID');
    assert.strictEqual(
        Contract.getDefinition('RULES_INPUT_INVALID').classification,
        'validation',
        'the split code is classified as validation'
    );
    assert.ok(/[\u0600-\u06FF]/.test(Contract.getMessage('RULES_INPUT_INVALID')));

    // ── (e) renderErrorMessage: server message first, catalog as fallback ──
    assert.strictEqual(
        Contract.renderErrorMessage({ code: 'RULES_UNAVAILABLE', error: 'رسالة محددة من الخادم' }),
        'رسالة محددة من الخادم',
        'server message wins over catalog'
    );
    assert.strictEqual(
        Contract.renderErrorMessage({ code: 'COEFFICIENT_OUT_OF_RANGE' }),
        Contract.getMessage('COEFFICIENT_OUT_OF_RANGE'),
        'catalog fallback when no server message'
    );
    assert.strictEqual(
        Contract.renderErrorMessage({ code: 'COEFFICIENT_OUT_OF_RANGE', error: 'SQLITE_CONSTRAINT: unique' }),
        Contract.getMessage('COEFFICIENT_OUT_OF_RANGE'),
        'internal server text is replaced by the catalog message'
    );
    assert.strictEqual(
        Contract.renderErrorMessage({ code: 'NOT_A_CODE' }),
        Contract.UNKNOWN_MESSAGE,
        'unknown code falls to the contract unknown message'
    );
    assert.strictEqual(
        Contract.renderErrorMessage({ error: 'سبب عربي محدد' }),
        'سبب عربي محدد',
        'server message without a code still wins'
    );

    // ── (f) typed throws from shared helpers ──
    assert.throws(
        () => requireSchoolYear('2024'),
        (error) => error.code === 'INVALID_SCHOOL_YEAR'
    );
    assert.strictEqual(
        toStageRulesErrorResponse(domainError('INVALID_SCHOOL_YEAR', 'السنة الدراسية يجب أن تكون بصيغة YYYY/YYYY')).code,
        'INVALID_SCHOOL_YEAR'
    );

    const twoCycleDb = buildTwoCycleDb();
    try {
        assert.throws(
            () => resolveCycleForRequest(twoCycleDb, {}),
            (error) => error.code === 'CYCLE_SELECTION_REQUIRED' && /[\u0600-\u06FF]/.test(error.message),
            'multi-cycle without a session must throw CYCLE_SELECTION_REQUIRED'
        );
        twoCycleDb.prepare('DELETE FROM institution_cycles').run();
        assert.throws(
            () => resolveCycleForRequest(twoCycleDb, {}),
            (error) => error.code === 'NO_USABLE_CYCLE' && /[\u0600-\u06FF]/.test(error.message),
            'zero usable cycles must throw NO_USABLE_CYCLE'
        );
    } finally {
        twoCycleDb.prepare(
            `INSERT INTO institution_cycles (cycle_code, is_active, seed_profile_version_hint, sort_order)
             VALUES ('secondary_qualifiant', 1, 'qualifiant-2026-v1', 20)`
        ).run();
        if (typeof twoCycleDb.close === 'function') twoCycleDb.close();
    }

    getActiveSessions().clear();

    console.log('stage-rules-error-mapping: OK');
})();
