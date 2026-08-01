'use strict';

const assert = require('assert');
const context = require('../main/db/context');
const { ensureInstitutionCyclesSchema } = require('../main/db/schema');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
const { filterAuthorizedCycles, listAuthorizedCycleCodes } = require('../main/auth/cycle-access');
const { resolveCycleForRequest } = require('../main/auth/resolve-cycle');
const { setContext, clearContextForSender } = require('../main/auth/active-cycle-context');
const { getActiveSessions } = require('../main/ipc/auth');

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

function seedCycle(db) {
    ensureInstitutionCyclesSchema(db);
    db.prepare(
        `INSERT OR IGNORE INTO institution_cycles (cycle_code, is_active, profile_version, sort_order)
         VALUES ('secondary_qualifiant', 1, 'qualifiant-2026-v1', 20)`
    ).run();
}

const db = openDb();
seedCycle(db);
setRepoCapturePort(createNoOpCapturePort());
context.setDb(db);

const restrictedSession = { userId: 41, role: 'teacher', locked: false };
assert.throws(
    () => listAuthorizedCycleCodes(db, restrictedSession),
    (error) => error.code === 'CYCLE_ACCESS_SCHEMA_REQUIRED',
    'restricted users fail closed until user_cycle_access exists'
);
assert.deepStrictEqual(
    filterAuthorizedCycles(db, [{ cycle_code: 'secondary_qualifiant' }], { userId: 0, role: 'admin' }).map((cycle) => cycle.cycle_code),
    ['secondary_qualifiant'],
    'administrative roles keep access when the authorization table is not installed'
);

const accessDb = openDb();
seedCycle(accessDb);
accessDb.exec(`
    CREATE TABLE user_cycle_access (
        user_id INTEGER NOT NULL,
        cycle_code TEXT NOT NULL,
        PRIMARY KEY (user_id, cycle_code)
    )
`);
accessDb.prepare('INSERT INTO user_cycle_access (user_id, cycle_code) VALUES (?, ?)').run(41, 'secondary_qualifiant');
context.setDb(accessDb);

const sender = { id: 4101 };
const event = { sender };
const sessions = getActiveSessions();
sessions.set(sender.id, restrictedSession);
setContext(event, restrictedSession.userId, 'secondary_collegial', '2025/2026');
assert.throws(
    () => resolveCycleForRequest(accessDb, event),
    (error) => error.code === 'FORBIDDEN',
    'request resolution rejects a cached context outside the user grant'
);
clearContextForSender(sender.id);
sessions.delete(sender.id);

console.log('cycle-access.test.js: OK');
