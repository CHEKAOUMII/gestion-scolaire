'use strict';

/**
 * Cycle-access error contract (multi-stage review verdict, Phase 4A item 3):
 *   (a) dual-export SSOT — codes, Arabic catalog, safe fallback text, normalize()
 *   (b) the repo layer consumes the shared codes — no parallel throw-site catalog
 *   (c) IPC mapping preserves contract codes and supplies catalog fallback text
 *   (d) unknown / internal codes collapse to INTERNAL_ERROR with a safe message
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Contract = require('../js/shared/errors/cycle-access-error-contract');
const cycleAccess = require('../main/auth/cycle-access');
const { registerCycleAccessIpc } = require('../main/ipc/cycle-access');
const { getActiveSessions } = require('../main/ipc/auth');
const context = require('../main/db/context');
const { ensureInstitutionCyclesSchema, ensureCycleReferenceSchema } = require('../main/db/schema');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');

function openDb() {
    try {
        const Database = require('better-sqlite3');
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

function buildFixture({ withAccessTable = true } = {}) {
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
    if (withAccessTable) ensureCycleReferenceSchema(db);
    db.prepare(
        `INSERT INTO institution_cycles (cycle_code, is_active, seed_profile_version_hint, sort_order)
         VALUES ('secondary_qualifiant', 1, 'qualifiant-2026-v1', 20)`
    ).run();
    const insertUser = db.prepare('INSERT INTO users (name, email, role) VALUES (?, ?, ?)');
    insertUser.run('المدير', 'admin@school.local', 'admin');
    insertUser.run('أستاذ', 'teacher@school.local', 'teacher');
    insertUser.run('مشاهد', 'viewer@school.local', 'viewer');
    if (withAccessTable) {
        db.prepare('INSERT INTO user_cycle_access (user_id, cycle_code) VALUES (?, ?)').run(2, QUALIFIANT);
    }
    return db;
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
    // ── (a) dual-export SSOT ──
    const browserGlobal = {};
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'js', 'shared', 'errors', 'cycle-access-error-contract.js'),
        'utf8'
    );
    vm.runInNewContext(source, browserGlobal);
    assert.strictEqual(
        browserGlobal.CycleAccessErrorContract.CYCLE_ACCESS_ERROR_CODES.LAST_USABLE_CYCLE,
        'LAST_USABLE_CYCLE',
        'browser global must expose the same codes'
    );

    const CODES = Contract.CYCLE_ACCESS_ERROR_CODES;
    for (const key of Object.keys(CODES)) {
        const def = Contract.getDefinition(CODES[key]);
        assert.ok(def, `catalog must define ${CODES[key]}`);
        assert.ok(/[\u0600-\u06FF]/.test(def.message), `${CODES[key]} needs an Arabic message`);
    }
    assert.strictEqual(
        Contract.getDefinition('NOT_A_CODE'),
        null,
        'unknown codes have no definition'
    );
    assert.ok(/[\u0600-\u06FF]/.test(Contract.getMessage('FORBIDDEN')));
    assert.ok(/[\u0600-\u06FF]/.test(Contract.getMessage('NOPE')));

    // normalize(): known codes preserved, auth-lean preserved, internal collapsed
    assert.strictEqual(Contract.normalize({ code: 'LAST_USABLE_CYCLE', message: 'سبب محدد' }).code, 'LAST_USABLE_CYCLE');
    assert.strictEqual(Contract.normalize({ code: 'UNAUTHENTICATED', message: 'الرجاء تسجيل الدخول' }).code, 'UNAUTHENTICATED');
    assert.strictEqual(Contract.normalize({ code: 'SQLITE_CONSTRAINT', message: 'SQLITE_CONSTRAINT: unique' }).code, 'INTERNAL_ERROR');
    assert.strictEqual(Contract.normalize({ code: 'SQLITE_CONSTRAINT' }).error, Contract.UNKNOWN_MESSAGE);

    // ── (b) repo consumes the shared codes — identity, no parallel catalog ──
    assert.strictEqual(
        cycleAccess.CYCLE_ACCESS_ERROR_CODES,
        Contract.CYCLE_ACCESS_ERROR_CODES,
        'repo must re-export the SSOT codes object (no parallel catalog)'
    );

    // CYCLE_ACCESS_SCHEMA_REQUIRED surfaces through the shared codes
    const noTableDb = buildFixture({ withAccessTable: false });
    assert.throws(
        () => cycleAccess.assertCycleAuthorized(noTableDb, { userId: 2, role: 'teacher' }, QUALIFIANT),
        (error) =>
            error.code === Contract.CYCLE_ACCESS_ERROR_CODES.CYCLE_ACCESS_SCHEMA_REQUIRED &&
            /[\u0600-\u06FF]/.test(error.message),
        'missing access table must throw the contract code'
    );
    noTableDb.close();

    // ── (c) IPC mapping preserves contract codes with catalog fallback text ──
    const db = buildFixture();
    setRepoCapturePort(createNoOpCapturePort());
    context.setDb(db);
    const { ipcMain, handlers } = collectHandlers();
    registerCycleAccessIpc(ipcMain);
    setSession(9001, 'admin');

    const userNotFound = await handlers['cycleAccess:setUsers'](makeEvent(9001), { userId: 999, cycleCodes: [] });
    assert.strictEqual(userNotFound.code, 'USER_NOT_FOUND');
    assert.ok(/[\u0600-\u06FF]/.test(userNotFound.error));

    const unknownCycle = await handlers['cycleAccess:setUsers'](makeEvent(9001), { userId: 2, cycleCodes: ['bogus_cycle'] });
    assert.strictEqual(unknownCycle.code, 'UNKNOWN_CYCLE');
    assert.ok(/[\u0600-\u06FF]/.test(unknownCycle.error));

    const notInInstitution = await handlers['cycleAccess:setUsers'](makeEvent(9001), { userId: 2, cycleCodes: ['primary'] });
    assert.strictEqual(notInInstitution.code, 'CYCLE_NOT_IN_INSTITUTION');
    assert.ok(/[\u0600-\u06FF]/.test(notInInstitution.error));

    const lastUsable = await handlers['cycleAccess:setUsers'](makeEvent(9001), { userId: 2, cycleCodes: [] });
    assert.strictEqual(lastUsable.code, 'LAST_USABLE_CYCLE');
    assert.ok(/[\u0600-\u06FF]/.test(lastUsable.error));

    setSession(9002, 'teacher');
    const teacherDenied = await handlers['cycleAccess:setUsers'](makeEvent(9002), { userId: 2, cycleCodes: [QUALIFIANT] });
    assert.strictEqual(teacherDenied.code, 'FORBIDDEN');

    // ── (d) a legal operation round-trips with success (contract codes intact) ──
    const restore = await handlers['cycleAccess:setUsers'](makeEvent(9001), { userId: 2, cycleCodes: [QUALIFIANT] });
    assert.strictEqual(restore.success, true, 'legal grant round-trip must succeed');

    // ── Cleanup ──
    getActiveSessions().delete(9001);
    getActiveSessions().delete(9002);
    setRepoCapturePort(null);
    context.setDb(null);
    if (typeof db.close === 'function') db.close();

    console.log('cycle-access-error-contract: OK');
})();
