'use strict';

const { resolveRole } = require('./permissions');

const CYCLE_ACCESS_TABLE = 'user_cycle_access';
const FULL_CYCLE_ACCESS_ROLES = new Set(['developer', 'admin', 'principal']);

function hasCycleAccessTable(db) {
    return !!db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
        .get(CYCLE_ACCESS_TABLE);
}

function requireCycleAccessTable(db, session) {
    if (!session || FULL_CYCLE_ACCESS_ROLES.has(resolveRole(session.role))) return;
    if (hasCycleAccessTable(db)) return;

    const error = new Error('لم يتم إعداد صلاحيات الأسلاك لهذه المؤسسة بعد');
    error.code = 'CYCLE_ACCESS_SCHEMA_REQUIRED';
    throw error;
}

function listAuthorizedCycleCodes(db, session) {
    if (!session || FULL_CYCLE_ACCESS_ROLES.has(resolveRole(session.role))) return null;
    requireCycleAccessTable(db, session);
    return new Set(
        db
            .prepare(`SELECT cycle_code FROM ${CYCLE_ACCESS_TABLE} WHERE user_id = ?`)
            .all(Number(session.userId))
            .map((row) => String(row.cycle_code || '').trim())
            .filter(Boolean)
    );
}

function filterAuthorizedCycles(db, cycles, session) {
    const authorizedCodes = listAuthorizedCycleCodes(db, session);
    if (!authorizedCodes) return cycles;
    return cycles.filter((cycle) => authorizedCodes.has(String(cycle.cycle_code || '').trim()));
}

function assertCycleAuthorized(db, session, cycleCode) {
    const normalizedCode = String(cycleCode || '').trim();
    const authorizedCodes = listAuthorizedCycleCodes(db, session);
    if (authorizedCodes && !authorizedCodes.has(normalizedCode)) {
        const error = new Error('ليس لديك صلاحية للعمل داخل هذا السلك');
        error.code = 'FORBIDDEN';
        throw error;
    }
    return normalizedCode;
}

module.exports = {
    CYCLE_ACCESS_TABLE,
    FULL_CYCLE_ACCESS_ROLES,
    hasCycleAccessTable,
    listAuthorizedCycleCodes,
    filterAuthorizedCycles,
    assertCycleAuthorized
};
