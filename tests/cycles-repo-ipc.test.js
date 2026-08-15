'use strict';

/**
 * Behavioral tests for the institution-cycle feature (multi-school-cycle plan §5.1, §8, §9.1).
 *
 * Covers the two seams the context unit test (tests/cycles-context.test.js) cannot reach:
 *   - main/repos/cycles.js against a real SQL engine using the shipped DDL
 *     (schema.ensureInstitutionCyclesSchema — the same call migration
 *     '2026-07-070-institution-cycles' makes) plus its backfill row.
 *   - main/ipc/cycles.js driven through a fake ipcMain with injected sessions:
 *     role enforcement, payload validation, capability gating, and per-sender contexts.
 *
 * The engine is better-sqlite3 when its native ABI matches the running node, else the
 * built-in node:sqlite with a `transaction()` shim — so this suite really runs SQL
 * locally and in CI instead of silently skipping.
 */

const assert = require('assert');

const context = require('../main/db/context');
const { ensureInstitutionCyclesSchema } = require('../main/db/schema');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
const cyclesRepo = require('../main/repos/cycles');
const { registerCyclesIpc } = require('../main/ipc/cycles');
const { getActiveSessions } = require('../main/ipc/auth');

console.log('[test] institution cycles repository + IPC');

// ── SQL engine ─────────────────────────────────────────────────────────────
function openDb() {
    try {
        const Database = require('better-sqlite3');
        const probe = new Database(':memory:');
        probe.close();
        return new Database(':memory:');
    } catch {
        // Native ABI mismatch (module built for Electron) — fall back to node:sqlite.
    }
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    // better-sqlite3 API surface the repositories rely on.
    db.transaction = (fn) => (...args) => {
        db.exec('BEGIN');
        try {
            const result = fn(...args);
            db.exec('COMMIT');
            return result;
        } catch (err) {
            db.exec('ROLLBACK');
            throw err;
        }
    };
    return db;
}

const db = openDb();
context.setDb(db);
setRepoCapturePort(createNoOpCapturePort());

// Same DDL + backfill the institution-cycles migration applies to an existing install.
ensureInstitutionCyclesSchema(db);
db.prepare(
    `INSERT OR IGNORE INTO institution_cycles (cycle_code, is_active, seed_profile_version_hint, sort_order)
     VALUES ('secondary_qualifiant', 1, 'qualifiant-2026-v1', 20)`
).run();
db.exec(`
    CREATE TABLE user_cycle_access (
        user_id INTEGER NOT NULL,
        cycle_code TEXT NOT NULL,
        PRIMARY KEY (user_id, cycle_code)
    )
`);

function cycleRow(code) {
    return cyclesRepo.getLabeledCycle(db, code);
}

function throwsWith(fn, fragment, message) {
    assert.throws(fn, (err) => String(err.message).includes(fragment), message);
}

// ── Repository ─────────────────────────────────────────────────────────────
const backfilled = cycleRow('secondary_qualifiant');
assert.strictEqual(Number(backfilled.is_active), 1);
assert.strictEqual(backfilled.capability, 'supported');
assert.strictEqual(backfilled.seed_profile_version_hint, 'qualifiant-2026-v1');
console.log('  [ok] migration backfills the existing institution as qualifiant');

throwsWith(() => cyclesRepo.addCycle(db, 'unknown-cycle'), 'غير معروف', 'unknown cycle codes are rejected');
throwsWith(() => cyclesRepo.addCycle(db, 'secondary_qualifiant'), 'مضاف مسبقاً', 'duplicate add is rejected');
assert.strictEqual(cyclesRepo.listCycles(db).length, 1, 'a rejected add must not leave a partial row');

const added = cyclesRepo.addCycle(db, 'secondary_collegial');
assert.strictEqual(added.seed_profile_version_hint, 'collegial-2026-v1', 'profile version comes from the catalog, not the caller');
assert.strictEqual(added.capability, 'supported');
assert.strictEqual(Number(added.is_active), 1);
assert.strictEqual(cyclesRepo.listCycles(db).length, 2);
console.log('  [ok] adding a cycle pins its catalog profile version');

assert.strictEqual(
    cyclesRepo.assertCycleIsActive(db, 'secondary_collegial').cycle_code,
    'secondary_collegial',
    'an enabled supported cycle can be selected'
);
assert.strictEqual(cyclesRepo.assertCycleIsActive(db, 'secondary_qualifiant').cycle_code, 'secondary_qualifiant');
console.log('  [ok] capability gate allows the approved collegial cycle');

// Both approved cycles can be enabled, but the last enabled cycle still cannot be
// disabled even when another catalogued preview cycle exists.
assert.strictEqual(Number(cyclesRepo.setCycleActive(db, 'secondary_qualifiant', false).is_active), 0);
assert.strictEqual(Number(cycleRow('secondary_qualifiant').is_active), 0);
throwsWith(
    () => cyclesRepo.setCycleActive(db, 'secondary_collegial', false),
    'آخر سلك مفعل',
    'the last enabled cycle cannot be disabled'
);
assert.strictEqual(cyclesRepo.assertCycleIsActive(db, 'secondary_collegial').cycle_code, 'secondary_collegial');
assert.strictEqual(Number(cyclesRepo.setCycleActive(db, 'secondary_qualifiant', true).is_active), 1);
assert.strictEqual(Number(cyclesRepo.setCycleActive(db, 'secondary_collegial', true).is_active), 1);
console.log('  [ok] disabling protects the last enabled supported cycle');

// ── IPC surface ────────────────────────────────────────────────────────────
const handlers = new Map();
registerCyclesIpc({ handle: (channel, handler) => handlers.set(channel, handler) });

const sessions = getActiveSessions();
const SENDER_ADMIN = 9001;
const SENDER_TEACHER = 9002;
const sent = [];

function eventFor(senderId) {
    return { sender: { id: senderId, send: (channel, payload) => sent.push({ senderId, channel, payload }) } };
}

function signIn(senderId, userId, role) {
    sessions.set(senderId, { userId, role, username: `u${userId}`, locked: false });
}

function call(channel, senderId, payload) {
    return handlers.get(channel)(eventFor(senderId), payload);
}

async function main() {
    const anonymous = await call('cycles:list', 9999);
    assert.strictEqual(anonymous.success, false);
    assert.strictEqual(anonymous.code, 'UNAUTHENTICATED', 'listing institution cycles requires a session');

    const catalog = await call('cycles:getCatalog', 9999);
    assert.strictEqual(catalog.success, true, 'the closed catalog stays public');
    assert.deepStrictEqual(
        catalog.cycles.map((cycle) => cycle.cycle_code),
        ['primary', 'secondary_collegial', 'secondary_qualifiant']
    );

    signIn(SENDER_ADMIN, 11, 'admin');
    signIn(SENDER_TEACHER, 22, 'teacher');
    db.prepare('INSERT INTO user_cycle_access (user_id, cycle_code) VALUES (?, ?)').run(22, 'secondary_qualifiant');

    const teacherCycles = await call('cycles:list', SENDER_TEACHER);
    assert.deepStrictEqual(
        teacherCycles.cycles.map((cycle) => cycle.cycle_code),
        ['secondary_qualifiant'],
        'a restricted user sees only explicitly authorized cycles'
    );

    const teacherAdd = await call('cycles:add', SENDER_TEACHER, { cycleCode: 'secondary_collegial' });
    assert.strictEqual(teacherAdd.success, false);
    assert.strictEqual(teacherAdd.code, 'FORBIDDEN', 'only admin/principal manage cycle membership');
    const teacherToggle = await call('cycles:setEnabled', SENDER_TEACHER, {
        cycleCode: 'secondary_collegial',
        isActive: false
    });
    assert.strictEqual(teacherToggle.code, 'FORBIDDEN');

    const spoofed = await call('cycles:setEnabled', SENDER_ADMIN, {
        cycleCode: 'secondary_collegial',
        isActive: 'false'
    });
    assert.strictEqual(spoofed.success, false, 'a truthy string must not enable a cycle');
    assert.strictEqual(Number(cycleRow('secondary_collegial').is_active), 1);
    console.log('  [ok] IPC enforces roles and rejects non-boolean isActive');

    const unauthorized = await call('cycles:setActive', SENDER_TEACHER, {
        cycleCode: 'secondary_collegial',
        schoolYear: '2025/2026'
    });
    assert.strictEqual(unauthorized.success, false, 'sessions cannot switch into an unauthorized cycle');
    assert.match(unauthorized.error, /صلاحية/);


    const badYear = await call('cycles:setActive', SENDER_TEACHER, {
        cycleCode: 'secondary_qualifiant',
        schoolYear: '2025'
    });
    assert.strictEqual(badYear.success, false, 'the school year is validated in main');

    const teacherSwitch = await call('cycles:setActive', SENDER_TEACHER, {
        cycleCode: 'secondary_qualifiant',
        schoolYear: '2025/2026'
    });
    assert.strictEqual(teacherSwitch.success, true, 'any authenticated role may select an authorized cycle');
    assert.strictEqual(teacherSwitch.context.userId, 22);
    assert.ok(
        sent.some((msg) => msg.senderId === SENDER_TEACHER && msg.channel === 'cycles:changed'),
        'the switching window is notified'
    );

    const adminActive = await call('cycles:getActive', SENDER_ADMIN);
    if (adminActive.requiresSelection) {
        const adminSwitch = await call('cycles:setActive', SENDER_ADMIN, {
            cycleCode: 'secondary_qualifiant',
            schoolYear: '2025/2026'
        });
        assert.strictEqual(adminSwitch.success, true);
    }
    const selectedAdminActive = adminActive.requiresSelection
        ? await call('cycles:getActive', SENDER_ADMIN)
        : adminActive;
    const teacherActive = await call('cycles:getActive', SENDER_TEACHER);
    assert.strictEqual(selectedAdminActive.context.userId, 11);
    assert.strictEqual(teacherActive.context.userId, 22);
    assert.strictEqual(teacherActive.context.schoolYear, '2025/2026', "one sender's switch keeps its own year");
    assert.strictEqual(selectedAdminActive.cycle.cycle_code, 'secondary_qualifiant');
    console.log('  [ok] each sender keeps an independent active-cycle context');

    const disableUsable = await call('cycles:setEnabled', SENDER_ADMIN, {
        cycleCode: 'secondary_qualifiant',
        isActive: false
    });
    assert.strictEqual(disableUsable.success, true, 'IPC allows disabling one of two usable cycles');

    const disableCollegial = await call('cycles:setEnabled', SENDER_ADMIN, {
        cycleCode: 'secondary_collegial',
        isActive: false
    });
    assert.strictEqual(disableCollegial.success, false, 'IPC surfaces the last-usable-cycle guard');
    const reenableQualifiant = await call('cycles:setEnabled', SENDER_ADMIN, {
        cycleCode: 'secondary_qualifiant',
        isActive: true
    });
    assert.strictEqual(reenableQualifiant.success, true);
    const disableCollegialAfterRestore = await call('cycles:setEnabled', SENDER_ADMIN, {
        cycleCode: 'secondary_collegial',
        isActive: false
    });
    assert.strictEqual(disableCollegialAfterRestore.success, true);
    assert.strictEqual(Number(disableCollegialAfterRestore.cycle.is_active), 0);
    console.log('  [ok] cycle membership changes go through the repository guards');

    sessions.delete(SENDER_ADMIN);
    sessions.delete(SENDER_TEACHER);
    console.log('[test] institution cycles repository + IPC: all checks passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
