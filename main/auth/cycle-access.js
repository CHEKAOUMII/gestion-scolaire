'use strict';

/**
 * user_cycle_access management (multi-stage plan §3 S6, rows 128-130).
 *
 * Sync contract decision (row 130): user_cycle_access is LOCAL-ONLY.
 *   - The `users` table is NOT a sync entity (main/sync/entity-registry.js has no
 *     `users` entry), so user IDs are device-local; a synced access row could not
 *     resolve its FK target on another device.
 *   - It is an authorization policy, not school data: like page-access permissions
 *     (AGENTS.md "App Defaults and Page Access"), it is intentionally excluded from
 *     sync. Syncing grants would let any device push its own authorization or get
 *     stuck with an unreachable revoke, so the admin configures each device locally.
 *   - Consequence: all mutation SQL lives HERE (repo layer), every write goes through
 *     these repo functions (IPC is auth/validation only), the last-usable-cycle
 *     guard (row 129) is enforced in this repo layer, and there is no sync-apply
 *     path to quarantine because the table is not a sync entity.
 *
 * Base security rule (row 128): ONLY admin manages via IPC; nobody may modify
 * developer/admin/principal users (they hold FULL_CYCLE_ACCESS_ROLES and ignore the
 * table); nobody may remove a user's last usable supported cycle.
 */

const { resolveRole } = require('./permissions');
const { isKnownCycleCode } = require('../../js/shared/education/cycles');
const cyclesRepo = require('../repos/cycles');
const { CYCLE_ACCESS_ERROR_CODES } = require('../../js/shared/errors/cycle-access-error-contract');

const CYCLE_ACCESS_TABLE = 'user_cycle_access';
/**
 * Full access is granted BY ROLE, never by per-stage rows: developer, admin,
 * and principal bypass `user_cycle_access` entirely (`listAuthorizedCycleCodes`
 * returns null for them, so `filterAuthorizedCycles` keeps every cycle and
 * `assertCycleAuthorized` never throws). In particular the principal needs no
 * grant rows to read/write any stage, and the admin matrix cannot revoke that
 * access (`assertModifiableUser` refuses developer/admin/principal targets with
 * FORBIDDEN). Pinned by tests/stage-isolation-auth-matrix.test.js (Slice 3).
 */
const FULL_CYCLE_ACCESS_ROLES = new Set(['developer', 'admin', 'principal']);

function createCycleAccessError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function hasCycleAccessTable(db) {
    return !!db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
        .get(CYCLE_ACCESS_TABLE);
}

function requireCycleAccessTable(db, session) {
    if (!session || FULL_CYCLE_ACCESS_ROLES.has(resolveRole(session.role))) return;
    if (hasCycleAccessTable(db)) return;

    const error = new Error('لم يتم إعداد صلاحيات الأسلاك لهذه المؤسسة بعد');
    error.code = CYCLE_ACCESS_ERROR_CODES.CYCLE_ACCESS_SCHEMA_REQUIRED;
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

// ────────────────────────────────────────────────────────────────────────────────
// Management API (S6). SQL lives here; IPC stays auth/validation/orchestration.
// All mutations are transactional and go through the last-usable-cycle guard.
// ────────────────────────────────────────────────────────────────────────────────

/** Cycles the institution actually offers and that can be worked in (is_active + supported). */
function listUsableSupportedCycleCodes(db) {
    return new Set(
        cyclesRepo
            .listCycles(db)
            .filter((cycle) => Number(cycle.is_active) && cycle.capability === 'supported')
            .map((cycle) => String(cycle.cycle_code).trim())
    );
}

/** Intersection of the given codes with the institution's usable supported cycles. */
function usableSupportedCycleCodes(db, cycleCodes) {
    const usable = listUsableSupportedCycleCodes(db);
    return new Set(
        (Array.isArray(cycleCodes) ? cycleCodes : [])
            .map((code) => String(code || '').trim())
            .filter((code) => code && usable.has(code))
    );
}

function getUserRoleRow(db, userId) {
    return db.prepare('SELECT id, role FROM users WHERE id = ?').get(Number(userId)) || null;
}

function assertModifiableUser(db, userId) {
    const user = getUserRoleRow(db, userId);
    if (!user) {
        throw createCycleAccessError(CYCLE_ACCESS_ERROR_CODES.USER_NOT_FOUND, 'المستخدم غير موجود');
    }
    if (FULL_CYCLE_ACCESS_ROLES.has(resolveRole(user.role))) {
        throw createCycleAccessError(
            CYCLE_ACCESS_ERROR_CODES.FORBIDDEN,
            'لا يمكن تعديل صلاحيات الأسلاك لمستخدم بدور مدير التطبيق أو مدير المؤسسة — يتمتع بصلاحية كاملة'
        );
    }
    return user;
}

function assertKnownInstitutionCycle(db, cycleCode) {
    const code = String(cycleCode || '').trim();
    if (!isKnownCycleCode(code)) {
        throw createCycleAccessError(CYCLE_ACCESS_ERROR_CODES.UNKNOWN_CYCLE, 'السلك التعليمي غير معروف');
    }
    if (!cyclesRepo.getActiveCycle(db, code)) {
        throw createCycleAccessError(
            CYCLE_ACCESS_ERROR_CODES.CYCLE_NOT_IN_INSTITUTION,
            'السلك غير مضاف إلى المؤسسة'
        );
    }
    return code;
}

/**
 * Row-129 guard: a change must never leave a user without at least one usable
 * supported cycle when they had one before. Lives in the repo layer so no caller
 * (IPC or any future path) can bypass it — never only in IPC.
 */
function assertKeepsLastUsableCycle(db, userId, proposedCycleCodes) {
    const usableBefore = usableSupportedCycleCodes(db, getUserCycleCodes(db, userId));
    const usableAfter = usableSupportedCycleCodes(db, proposedCycleCodes);
    if (usableBefore.size >= 1 && usableAfter.size === 0) {
        throw createCycleAccessError(
            CYCLE_ACCESS_ERROR_CODES.LAST_USABLE_CYCLE,
            'لا يمكن سحب آخر سلك مفعل جاهز للعمل لهذا المستخدم'
        );
    }
}

function getUserCycleCodes(db, userId) {
    return db
        .prepare(`SELECT cycle_code FROM ${CYCLE_ACCESS_TABLE} WHERE user_id = ?`)
        .all(Number(userId))
        .map((row) => String(row.cycle_code || '').trim())
        .filter(Boolean);
}

/** Users with their granted cycles — shape for the admin management UI. */
function listUserCycleAccess(db) {
    const users = db.prepare('SELECT id, name, email, role FROM users ORDER BY id').all();
    const rows = db.prepare(`SELECT user_id, cycle_code FROM ${CYCLE_ACCESS_TABLE} ORDER BY user_id, cycle_code`).all();
    const cyclesByUser = new Map();
    for (const row of rows) {
        const userId = Number(row.user_id);
        if (!cyclesByUser.has(userId)) cyclesByUser.set(userId, []);
        cyclesByUser.get(userId).push(String(row.cycle_code).trim());
    }
    return users.map((user) => {
        const role = resolveRole(user.role);
        const fullAccess = FULL_CYCLE_ACCESS_ROLES.has(role);
        return {
            id: user.id,
            name: user.name,
            email: user.email,
            role,
            fullAccess,
            cycles: fullAccess ? null : cyclesByUser.get(Number(user.id)) || []
        };
    });
}

/**
 * Replace a user's cycle grants (setUsers). The write must not revoke a
 * developer/admin/principal and must not remove the user's last usable supported cycle.
 */
function setUserCycles(db, userId, cycleCodes) {
    const user = assertModifiableUser(db, userId);
    const uniqueCodes = [...new Set((Array.isArray(cycleCodes) ? cycleCodes : []).map((code) => String(code || '').trim()).filter(Boolean))];
    for (const code of uniqueCodes) {
        assertKnownInstitutionCycle(db, code);
    }
    assertKeepsLastUsableCycle(db, user.id, uniqueCodes);

    const replaceUserCycles = db.transaction(() => {
        db.prepare(`DELETE FROM ${CYCLE_ACCESS_TABLE} WHERE user_id = ?`).run(user.id);
        const insert = db.prepare(`INSERT OR IGNORE INTO ${CYCLE_ACCESS_TABLE}(user_id, cycle_code) VALUES (?, ?)`);
        for (const code of uniqueCodes) {
            insert.run(user.id, code);
        }
    });
    replaceUserCycles();
    return { userId: user.id, cycles: uniqueCodes };
}

/**
 * Enable/disable a cycle for every non-privileged user (setCycles).
 * Disabling runs the last-usable-cycle guard for every affected user; if ANY user
 * would lose their last usable supported cycle the whole operation is refused.
 */
function setCyclesForAllUsers(db, cycleCode, enabled) {
    const code = assertKnownInstitutionCycle(db, cycleCode);
    const grant = enabled !== false;
    const affectedUserIds = [];

    if (!grant) {
        affectedUserIds.push(
            ...db
                .prepare(`SELECT user_id FROM ${CYCLE_ACCESS_TABLE} WHERE cycle_code = ?`)
                .all(code)
                .map((row) => Number(row.user_id))
        );
        for (const userId of affectedUserIds) {
            const remaining = getUserCycleCodes(db, userId).filter((candidate) => candidate !== code);
            assertKeepsLastUsableCycle(db, userId, remaining);
        }
    }

    const updateAllUsers = db.transaction(() => {
        if (grant) {
            db.prepare(
                `INSERT OR IGNORE INTO ${CYCLE_ACCESS_TABLE}(user_id, cycle_code)
                 SELECT id, ? FROM users
                 WHERE LOWER(COALESCE(role, '')) NOT IN (${Array.from(FULL_CYCLE_ACCESS_ROLES).map(() => '?').join(', ')})`
            ).run(code, ...Array.from(FULL_CYCLE_ACCESS_ROLES));
        } else {
            db.prepare(`DELETE FROM ${CYCLE_ACCESS_TABLE} WHERE cycle_code = ?`).run(code);
        }
    });
    updateAllUsers();
    return { cycleCode: code, enabled: grant, affectedUsers: affectedUserIds.length };
}

module.exports = {
    CYCLE_ACCESS_TABLE,
    FULL_CYCLE_ACCESS_ROLES,
    CYCLE_ACCESS_ERROR_CODES,
    hasCycleAccessTable,
    listAuthorizedCycleCodes,
    filterAuthorizedCycles,
    assertCycleAuthorized,
    listUsableSupportedCycleCodes,
    usableSupportedCycleCodes,
    listUserCycleAccess,
    setUserCycles,
    setCyclesForAllUsers
};
