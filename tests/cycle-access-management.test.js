'use strict';

/**
 * S6 user_cycle_access management (multi-stage plan rows 128-130):
 *   (a) admin-only IPC auth
 *   (b) no revoking developer/admin/principal users
 *   (c) no removing the last usable supported cycle (setUsers AND setCycles)
 *   (d) the repo layer itself rejects the same violations (never only IPC)
 *   (e) local-only sync contract: the table is NOT a sync entity and the write
 *       channels are excluded from capture
 */

const assert = require('assert');
const context = require('../main/db/context');
const { ensureInstitutionCyclesSchema, ensureCycleReferenceSchema } = require('../main/db/schema');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
const cycleAccess = require('../main/auth/cycle-access');
const { registerCycleAccessIpc } = require('../main/ipc/cycle-access');
const { getActiveSessions } = require('../main/ipc/auth');
const { ENTITY_REGISTRY, getEntity, isKnownSyncTable } = require('../main/sync/entity-registry');
const { CHANNEL_REGISTRY } = require('../main/sync/capture');

function openDb() {
    try {
        const Database = require('better-sqlite3');
        const probe = new Database(':memory:');
        probe.close();
        return new Database(':memory:');
    } catch {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(':memory:');
        db.transaction = (transaction) => (...args) => {
            db.exec('BEGIN');
            try {
                const transactionResult = transaction(...args);
                db.exec('COMMIT');
                return transactionResult;
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        };
        return db;
    }
}

const QUALIFIANT = 'secondary_qualifiant';
const COLLEGIAL = 'secondary_collegial';

/**
 * Fixture: users table first (the FK target), then the canonical cycle-reference
 * schema, then one supported institution cycle. teacher (id 3) holds the ONLY
 * usable supported cycle — every removal attempt must be refused.
 */
function buildFixture({ includeCollegial = false } = {}) {
    const db = openDb();
    ensureInstitutionCyclesSchema(db);
    db.exec(`
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT,
            role TEXT DEFAULT 'staff'
        );
    `);
    ensureCycleReferenceSchema(db);
    db.prepare(
        `INSERT INTO institution_cycles (cycle_code, is_active, seed_profile_version_hint, sort_order)
         VALUES ('secondary_qualifiant', 1, 'qualifiant-2026-v1', 20)`
    ).run();
    if (includeCollegial) {
        db.prepare(
            `INSERT INTO institution_cycles (cycle_code, is_active, seed_profile_version_hint, sort_order)
             VALUES ('secondary_collegial', 1, 'collegial-2026-v1', 10)`
        ).run();
    }
    const insertUser = db.prepare('INSERT INTO users (name, email, role) VALUES (?, ?, ?)');
    insertUser.run('المدير', 'admin@school.local', 'admin');
    insertUser.run('مدير المؤسسة', 'principal@school.local', 'principal');
    insertUser.run('أستاذ', 'teacher@school.local', 'teacher');
    insertUser.run('مشاهد', 'viewer@school.local', 'viewer');
    db.prepare('INSERT INTO user_cycle_access (user_id, cycle_code) VALUES (?, ?)').run(3, QUALIFIANT);
    return db;
}

function getUserCycles(db, userId) {
    return db
        .prepare('SELECT cycle_code FROM user_cycle_access WHERE user_id = ? ORDER BY cycle_code')
        .all(userId)
        .map((row) => row.cycle_code);
}

function collectHandlers() {
    const handlers = {};
    return {
        ipcMain: {
            handle(channel, handler) {
                handlers[channel] = handler;
            }
        },
        handlers
    };
}

function makeEvent(senderId) {
    return { sender: { id: senderId } };
}

function setSession(senderId, role) {
    const sessions = getActiveSessions();
    sessions.set(senderId, { userId: senderId, role, locked: false });
    return sessions;
}

(async () => {
    const db = buildFixture();
    setRepoCapturePort(createNoOpCapturePort());
    context.setDb(db);

    const { ipcMain, handlers } = collectHandlers();
    registerCycleAccessIpc(ipcMain);

    // ── (e) local-only sync contract — decided BEFORE the UI was built (row 130) ──
    assert.strictEqual(
        ENTITY_REGISTRY.user_cycle_access,
        undefined,
        'user_cycle_access must NOT be a sync entity (local-only authorization policy)'
    );
    assert.strictEqual(
        getEntity('user_cycle_access'),
        null,
        'registry must have no entry for user_cycle_access'
    );
    assert.strictEqual(
        isKnownSyncTable('user_cycle_access'),
        false,
        'user_cycle_access is not a sync table'
    );
    assert.strictEqual(
        CHANNEL_REGISTRY['cycleAccess:setUsers']?.exclude,
        true,
        'cycleAccess:setUsers must be excluded from capture (local-only)'
    );
    assert.strictEqual(
        CHANNEL_REGISTRY['cycleAccess:setCycles']?.exclude,
        true,
        'cycleAccess:setCycles must be excluded from capture (local-only)'
    );

    // ── (a) admin-only IPC auth ──
    const teacherSessions = setSession(9101, 'teacher');
    assert.strictEqual(
        (await handlers['cycleAccess:list'](makeEvent(9101))).code,
        'FORBIDDEN',
        'cycleAccess:list must refuse non-admin sessions'
    );
    assert.strictEqual(
        (await handlers['cycleAccess:setUsers'](makeEvent(9101), { userId: 3, cycleCodes: [QUALIFIANT] })).code,
        'FORBIDDEN',
        'cycleAccess:setUsers must refuse non-admin sessions'
    );
    assert.strictEqual(
        (await handlers['cycleAccess:setCycles'](makeEvent(9101), { cycleCode: QUALIFIANT, enabled: false })).code,
        'FORBIDDEN',
        'cycleAccess:setCycles must refuse non-admin sessions'
    );
    teacherSessions.clear();

    // Admin list + a successful setUsers round trip.
    const adminSessions = setSession(9102, 'admin');
    const listResponse = await handlers['cycleAccess:list'](makeEvent(9102));
    assert.strictEqual(listResponse.success, true, 'admin list must succeed');
    assert.strictEqual(listResponse.users.length, 4, 'list must return every user');
    const adminUser = listResponse.users.find((user) => user.role === 'admin');
    const teacherUser = listResponse.users.find((user) => user.role === 'teacher');
    assert.strictEqual(adminUser.fullAccess, true, 'admin users are full-access');
    assert.strictEqual(adminUser.cycles, null, 'full-access users expose no row grants');
    assert.deepStrictEqual(teacherUser.cycles, [QUALIFIANT], 'teacher grant must be listed');
    assert.deepStrictEqual(
        listResponse.cycles.map((cycle) => cycle.cycle_code),
        [QUALIFIANT],
        'list must return institution cycles with labels/capability'
    );

    const okResponse = await handlers['cycleAccess:setUsers'](makeEvent(9102), {
        userId: 4,
        cycleCodes: [QUALIFIANT]
    });
    assert.strictEqual(okResponse.success, true, 'admin may grant a cycle to a viewer');
    assert.deepStrictEqual(getUserCycles(db, 4), [QUALIFIANT], 'grant must be persisted');

    // ── (b) cannot revoke developer/admin/principal (IPC + repo) ──
    for (const forbiddenUserId of [1, 2]) {
        const response = await handlers['cycleAccess:setUsers'](makeEvent(9102), {
            userId: forbiddenUserId,
            cycleCodes: []
        });
        assert.strictEqual(
            response.code,
            cycleAccess.CYCLE_ACCESS_ERROR_CODES.FORBIDDEN,
            `IPC must refuse cycle-access writes for user ${forbiddenUserId} (full-access role)`
        );
    }
    assert.throws(
        () => cycleAccess.setUserCycles(db, 1, [QUALIFIANT]),
        (error) => error.code === cycleAccess.CYCLE_ACCESS_ERROR_CODES.FORBIDDEN,
        'repo must refuse cycle-access writes for admin'
    );
    assert.throws(
        () => cycleAccess.setUserCycles(db, 2, []),
        (error) => error.code === cycleAccess.CYCLE_ACCESS_ERROR_CODES.FORBIDDEN,
        'repo must refuse cycle-access writes for principal'
    );

    // ── (c) cannot remove the last usable supported cycle — setUsers ──
    const emptySet = await handlers['cycleAccess:setUsers'](makeEvent(9102), {
        userId: 3,
        cycleCodes: []
    });
    assert.strictEqual(
        emptySet.code,
        cycleAccess.CYCLE_ACCESS_ERROR_CODES.LAST_USABLE_CYCLE,
        'IPC must refuse clearing the only usable supported cycle'
    );
    assert.deepStrictEqual(getUserCycles(db, 3), [QUALIFIANT], 'refused write must leave rows intact');

    // The approved collegial cycle is usable and can replace the user's current
    // qualifiant grant.
    const previewDb = buildFixture({ includeCollegial: true });
    context.setDb(previewDb);
    const previewSwap = await handlers['cycleAccess:setUsers'](makeEvent(9102), {
        userId: 3,
        cycleCodes: [COLLEGIAL]
    });
    assert.strictEqual(
        previewSwap.success,
        true,
        'swapping to the approved collegial cycle must succeed'
    );
    assert.deepStrictEqual(getUserCycles(previewDb, 3), [COLLEGIAL], 'approved collegial swap must persist');

    const restoreQualifiant = await handlers['cycleAccess:setUsers'](makeEvent(9102), {
        userId: 3,
        cycleCodes: [QUALIFIANT]
    });
    assert.strictEqual(restoreQualifiant.success, true);

    // ── (c) cannot remove the last usable supported cycle — setCycles (disable for all) ──
    const disableAll = await handlers['cycleAccess:setCycles'](makeEvent(9102), {
        cycleCode: QUALIFIANT,
        enabled: false
    });
    assert.strictEqual(
        disableAll.code,
        cycleAccess.CYCLE_ACCESS_ERROR_CODES.LAST_USABLE_CYCLE,
        'IPC must refuse disabling a cycle that is a user last usable supported cycle'
    );
    assert.deepStrictEqual(getUserCycles(previewDb, 3), [QUALIFIANT], 'refused disable must leave rows intact');

    // ── (d) the repo layer rejects the same violations when called directly ──
    assert.throws(
        () => cycleAccess.setUserCycles(previewDb, 3, []),
        (error) => error.code === cycleAccess.CYCLE_ACCESS_ERROR_CODES.LAST_USABLE_CYCLE,
        'repo setUserCycles refuses removing the last usable supported cycle'
    );
    assert.throws(
        () => cycleAccess.setUserCycles(previewDb, 3, []),
        (error) => error.code === cycleAccess.CYCLE_ACCESS_ERROR_CODES.LAST_USABLE_CYCLE,
        'repo setUserCycles refuses removing the last usable cycle after collegial approval'
    );
    assert.throws(
        () => cycleAccess.setCyclesForAllUsers(previewDb, QUALIFIANT, false),
        (error) => error.code === cycleAccess.CYCLE_ACCESS_ERROR_CODES.LAST_USABLE_CYCLE,
        'repo setCyclesForAllUsers refuses disabling a last usable supported cycle for any user'
    );
    assert.throws(
        () => cycleAccess.setUserCycles(previewDb, 3, ['made_up_cycle']),
        (error) => error.code === cycleAccess.CYCLE_ACCESS_ERROR_CODES.UNKNOWN_CYCLE,
        'repo rejects unknown cycle codes'
    );
    assert.throws(
        () => cycleAccess.setUserCycles(previewDb, 3, ['primary']),
        (error) => error.code === cycleAccess.CYCLE_ACCESS_ERROR_CODES.CYCLE_NOT_IN_INSTITUTION,
        'repo rejects cycles the institution does not have'
    );
    assert.throws(
        () => cycleAccess.setUserCycles(previewDb, 999, [QUALIFIANT]),
        (error) => error.code === cycleAccess.CYCLE_ACCESS_ERROR_CODES.USER_NOT_FOUND,
        'repo rejects unknown users'
    );

    // Legal repo writes still work: multi-cycle grant, then disable of a non-last cycle.
    const grantBoth = cycleAccess.setUserCycles(previewDb, 3, [QUALIFIANT, COLLEGIAL]);
    assert.deepStrictEqual(grantBoth.cycles.sort(), [COLLEGIAL, QUALIFIANT].sort(), 'granting both cycles must succeed');
    assert.deepStrictEqual(
        Array.from(cycleAccess.usableSupportedCycleCodes(previewDb, [QUALIFIANT, COLLEGIAL])).sort(),
        [QUALIFIANT, COLLEGIAL].sort(),
        'both approved cycles count as usable'
    );
    const disableCollegial = cycleAccess.setCyclesForAllUsers(previewDb, COLLEGIAL, false);
    assert.strictEqual(disableCollegial.enabled, false, 'disabling a non-last usable cycle must succeed');
    assert.deepStrictEqual(
        Array.from(cycleAccess.usableSupportedCycleCodes(previewDb, getUserCycles(previewDb, 3))),
        [QUALIFIANT],
        'teacher keeps the supported cycle after the collegial disable'
    );

    adminSessions.clear();
    console.log('cycle-access-management.test.js: OK');
})().catch((error) => {
    console.error('cycle-access-management.test.js: FAILED');
    console.error(error);
    process.exitCode = 1;
});
