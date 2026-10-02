'use strict';

/**
 * Phase 2 (2026-08-03 multi-stage management review verdict) — cross-mechanism
 * authorization integration suite.
 *
 * Covers the strongest confirmed gap: institution membership, user grants, active
 * context, and request re-resolution must be tested together through real paths.
 *
 *   - real `cycles:setEnabled` disable path (not raw SQL): `clearContextsForCycle`
 *     removes the affected context, and the next request re-resolves or refuses per
 *     the single-cycle/ambiguous-cycle rules;
 *   - teacher with grant + active context, admin disables that institution cycle,
 *     teacher attempts a read (`absences:getAll`) and a write (`absences:save`)
 *     afterward — the stale context must not authorize either operation;
 *   - revoke and disable ordering: `assertDisableKeepsInstitutionUsable` protects
 *     the institution, `assertKeepsLastUsableCycle` protects the user, neither guard
 *     is bypassed by the other operation;
 *   - inverse recovery: re-enable a cycle, grant it to the teacher, and require an
 *     explicit context selection before a multi-cycle request can proceed.
 *
 * The production IPC path (handleAuthedRead / handleWrite) and both repo guards are
 * asserted in the same test run.
 */

const assert = require('assert');
const context = require('../main/db/context');
const {
    ensureInstitutionCyclesSchema,
    ensureCycleReferenceSchema
} = require('../main/db/schema');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
const { setCaptureGetDb } = require('../main/sync/capture');
const { registerCyclesIpc } = require('../main/ipc/cycles');
const { registerCycleAccessIpc } = require('../main/ipc/cycle-access');
const { registerAbsencesIpc } = require('../main/ipc/absences');
const { getActiveSessions } = require('../main/ipc/auth');
const { resolveCycleForRequest } = require('../main/auth/resolve-cycle');
const { peekContext } = require('../main/auth/active-cycle-context');
const cycleAccess = require('../main/auth/cycle-access');

const QUALIFIANT = 'secondary_qualifiant';
const COLLEGIAL = 'secondary_collegial';
const YEAR = '2025/2026';

function openDb() {
    try {
        const Database = require('better-sqlite3');
        const probe = new Database(':memory:');
        probe.close();
        return new Database(':memory:');
    } catch {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(':memory:');
        db.transaction = (fn) => (...args) => {
            db.exec('BEGIN');
            try {
                const result = fn(...args);
                db.exec('COMMIT');
                return result;
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        };
        return db;
    }
}

/**
 * Fixture: two supported institution cycles (qualifiant + collegial), a users table
 * (FK target of user_cycle_access), the cycle-reference schema, and the minimal
 * school tables absences read/write channels need.
 */
function buildFixture() {
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
    db.prepare(
        `INSERT INTO institution_cycles (cycle_code, is_active, seed_profile_version_hint, sort_order)
         VALUES ('secondary_collegial', 1, 'collegial-2026-v1', 10)`
    ).run();
    const insertUser = db.prepare('INSERT INTO users (name, email, role) VALUES (?, ?, ?)');
    insertUser.run('المدير', 'admin@school.local', 'admin');
    insertUser.run('مدير المؤسسة', 'principal@school.local', 'principal');
    insertUser.run('أستاذ', 'teacher@school.local', 'teacher');
    // absences:getAll JOINs students; absences:save resolves the student owner.
    db.exec(`
        CREATE TABLE students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            full_name TEXT NOT NULL,
            family_name TEXT,
            section TEXT,
            school_year TEXT,
            cycle_code TEXT NOT NULL,
            UNIQUE(code, school_year)
        );
        CREATE TABLE absences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER,
            student_code TEXT,
            absence_date TEXT,
            month TEXT,
            absence_type TEXT DEFAULT 'unjustified',
            hours INTEGER DEFAULT 0,
            days REAL DEFAULT 0,
            reason TEXT,
            school_year TEXT,
            cycle_code TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(student_code, month, school_year, absence_type)
        );
    `);
    db.prepare(
        `INSERT INTO students (code, full_name, section, school_year, cycle_code)
         VALUES ('S-1', 'تلميذ ١', '1BAC-1', '2025/2026', 'secondary_qualifiant')`
    ).run();
    db.prepare(
        `INSERT INTO students (code, full_name, section, school_year, cycle_code)
         VALUES ('S-2', 'تلميذ ٢', '1APIC-1', '2025/2026', 'secondary_collegial')`
    ).run();
    return db;
}

function getUserCycles(db, userId) {
    return db
        .prepare('SELECT cycle_code FROM user_cycle_access WHERE user_id = ? ORDER BY cycle_code')
        .all(userId)
        .map((row) => row.cycle_code);
}

function grant(db, userId, cycleCodes) {
    db.prepare('DELETE FROM user_cycle_access WHERE user_id = ?').run(userId);
    const insert = db.prepare('INSERT OR IGNORE INTO user_cycle_access (user_id, cycle_code) VALUES (?, ?)');
    for (const code of cycleCodes) insert.run(userId, code);
}

function makeAbsence(studentCode) {
    return {
        student_code: studentCode,
        absence_date: '2025-09-15',
        month: '2025-09',
        absence_type: 'unjustified',
        hours: 2,
        days: 1,
        reason: '',
        school_year: YEAR
    };
}

function makeNoOpCaptureDb() {
    return {
        prepare() {
            return {
                get() {
                    return null;
                },
                run() {
                    return { changes: 1, lastInsertRowid: 1 };
                },
                all() {
                    return [];
                }
            };
        }
    };
}

function collectHandlers() {
    const handlers = new Map();
    return {
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
        handlers
    };
}

function eventFor(senderId) {
    return { sender: { id: senderId, send: () => {} } };
}

function signIn(senderId, userId, role) {
    getActiveSessions().set(senderId, { userId, role, username: `u${userId}`, locked: false });
}

function call(handlers, channel, senderId, ...args) {
    return handlers.get(channel)(eventFor(senderId), ...args);
}

(async () => {
    const db = buildFixture();
    setRepoCapturePort(createNoOpCapturePort());
    setCaptureGetDb(() => makeNoOpCaptureDb());
    context.setDb(db);

    const { ipcMain, handlers } = collectHandlers();
    registerCyclesIpc(ipcMain);
    registerCycleAccessIpc(ipcMain);
    registerAbsencesIpc(ipcMain);

    const SENDER_ADMIN = 9001;
    const SENDER_TEACHER = 9002;
    signIn(SENDER_ADMIN, 1, 'admin');
    signIn(SENDER_TEACHER, 3, 'teacher');

    // ── (1) Disable through the real path clears the context and the next request
    //        re-resolves or refuses according to the single-cycle rules ────────────
    grant(db, 3, [COLLEGIAL]);

    const selected = await call(handlers, 'cycles:setActive', SENDER_TEACHER, {
        cycleCode: COLLEGIAL,
        schoolYear: YEAR
    });
    assert.strictEqual(selected.success, true, 'teacher selects collegial');
    assert.strictEqual(
        resolveCycleForRequest(db, eventFor(SENDER_TEACHER)),
        COLLEGIAL,
        'active context resolves to collegial'
    );

    const disabled = await call(handlers, 'cycles:setEnabled', SENDER_ADMIN, {
        cycleCode: COLLEGIAL,
        isActive: false
    });
    assert.strictEqual(disabled.success, true, 'admin may disable one of two usable cycles');
    assert.strictEqual(
        peekContext(eventFor(SENDER_TEACHER)),
        null,
        'clearContextsForCycle must remove the disabled cycle context'
    );

    // Teacher has no other usable cycle: the next request refuses instead of guessing.
    const readRefused = await call(handlers, 'absences:getAll', SENDER_TEACHER, YEAR);
    assert.strictEqual(readRefused.success, false, 'read after disable without fallback refuses');
    assert.ok(
        /لا يوجد سلك|تسجيل الدخول|سلك/.test(readRefused.error || ''),
        'refusal surfaces the no-cycle error, not a stale-context success'
    );

    const writeRefused = await call(handlers, 'absences:save', SENDER_TEACHER, makeAbsence('S-1'));
    assert.strictEqual(writeRefused.success, false, 'write after disable without fallback refuses');
    console.log('[integration] disable → context cleared → read/write refused without fallback (PASS)');

    // ── (2) Single-cycle fallback: with one other usable cycle, the request
    //        re-resolves to it — never to the disabled one ─────────────────────────
    grant(db, 3, [QUALIFIANT, COLLEGIAL]);
    const reenabled = await call(handlers, 'cycles:setEnabled', SENDER_ADMIN, {
        cycleCode: COLLEGIAL,
        isActive: true
    });
    assert.strictEqual(reenabled.success, true, 're-enable collegial');
    const teacherSelect = await call(handlers, 'cycles:setActive', SENDER_TEACHER, {
        cycleCode: COLLEGIAL,
        schoolYear: YEAR
    });
    assert.strictEqual(teacherSelect.success, true, 'teacher context on collegial again');

    const disableAgain = await call(handlers, 'cycles:setEnabled', SENDER_ADMIN, {
        cycleCode: COLLEGIAL,
        isActive: false
    });
    assert.strictEqual(disableAgain.success, true, 'admin disables collegial again');

    assert.strictEqual(
        resolveCycleForRequest(db, eventFor(SENDER_TEACHER)),
        QUALIFIANT,
        'next request re-resolves to the single remaining usable cycle, not the disabled one'
    );
    const readFallback = await call(handlers, 'absences:getAll', SENDER_TEACHER, YEAR);
    assert.ok(Array.isArray(readFallback), 'read succeeds through single-cycle fallback');
    const written = await call(handlers, 'absences:save', SENDER_TEACHER, makeAbsence('S-1'));
    assert.strictEqual(written.success, true, 'write succeeds through single-cycle fallback');
    assert.strictEqual(
        db.prepare('SELECT cycle_code FROM absences WHERE student_code = ?').get('S-1').cycle_code,
        QUALIFIANT,
        'the write landed in the re-resolved cycle, not the disabled collegial'
    );
    console.log('[integration] disable → single-cycle fallback re-resolves read/write (PASS)');

    // ── (3) Revoke and disable ordering together ──────────────────────────────────
    //     assertDisableKeepsInstitutionUsable protects the institution: the last
    //     enabled supported cycle cannot be disabled, even when a user grant exists.
    grant(db, 3, [QUALIFIANT]);
    const reenableCollegial = await call(handlers, 'cycles:setEnabled', SENDER_ADMIN, {
        cycleCode: COLLEGIAL,
        isActive: true
    });
    assert.strictEqual(reenableCollegial.success, true);
    const disableLast = await call(handlers, 'cycles:setEnabled', SENDER_ADMIN, {
        cycleCode: COLLEGIAL,
        isActive: false
    });
    assert.strictEqual(disableLast.success, true, 'collegial may be disabled while qualifiant remains');
    const disableInstitutionLast = await call(handlers, 'cycles:setEnabled', SENDER_ADMIN, {
        cycleCode: QUALIFIANT,
        isActive: false
    });
    assert.strictEqual(
        disableInstitutionLast.success,
        false,
        'the last enabled supported cycle cannot be disabled (assertDisableKeepsInstitutionUsable)'
    );
    console.log('[integration] institution guard: last enabled supported cycle survives (PASS)');

    //     assertKeepsLastUsableCycle protects the user: revoking the user's last
    //     usable supported cycle is refused, even though the institution still has
    //     another enabled cycle.
    const revokeLast = await call(handlers, 'cycleAccess:setUsers', SENDER_ADMIN, {
        userId: 3,
        cycleCodes: []
    });
    assert.strictEqual(
        revokeLast.code,
        cycleAccess.CYCLE_ACCESS_ERROR_CODES.LAST_USABLE_CYCLE,
        'revoking the user last usable cycle is refused (assertKeepsLastUsableCycle)'
    );
    assert.deepStrictEqual(getUserCycles(db, 3), [QUALIFIANT], 'refused revoke leaves rows intact');
    const disableAllForUser = await call(handlers, 'cycleAccess:setCycles', SENDER_ADMIN, {
        cycleCode: QUALIFIANT,
        enabled: false
    });
    assert.strictEqual(
        disableAllForUser.code,
        cycleAccess.CYCLE_ACCESS_ERROR_CODES.LAST_USABLE_CYCLE,
        'disabling a user last usable supported cycle via setCycles is refused'
    );
    console.log('[integration] user guard: last usable supported cycle survives (PASS)');

    //     Ordering: a disable first, then a revoke — the revoke still must not take
    //     the user's only remaining usable cycle (grants were untouched by disable).
    const grantBoth = await call(handlers, 'cycleAccess:setUsers', SENDER_ADMIN, {
        userId: 3,
        cycleCodes: [QUALIFIANT, COLLEGIAL]
    });
    assert.strictEqual(grantBoth.success, true, 'grant both cycles');
    const disableCollForUser = await call(handlers, 'cycleAccess:setCycles', SENDER_ADMIN, {
        cycleCode: COLLEGIAL,
        enabled: false
    });
    assert.strictEqual(disableCollForUser.success, true, 'disable collegial grants for all');
    const revokeQualifiantAfter = await call(handlers, 'cycleAccess:setUsers', SENDER_ADMIN, {
        userId: 3,
        cycleCodes: []
    });
    assert.strictEqual(
        revokeQualifiantAfter.code,
        cycleAccess.CYCLE_ACCESS_ERROR_CODES.LAST_USABLE_CYCLE,
        'after a disable, the remaining usable grant still cannot be revoked'
    );
    assert.strictEqual(Number(cycleAccess.usableSupportedCycleCodes(db, getUserCycles(db, 3)).size), 1);
    console.log('[integration] revoke/disable ordering: neither guard bypasses the other (PASS)');

    // ── (4) Inverse recovery: re-enable, grant, then explicit context selection ────
    const restoreCollGrants = await call(handlers, 'cycleAccess:setCycles', SENDER_ADMIN, {
        cycleCode: COLLEGIAL,
        enabled: true
    });
    assert.strictEqual(restoreCollGrants.success, true, 're-grant collegial to all non-privileged users');
    const reenableColl = await call(handlers, 'cycles:setEnabled', SENDER_ADMIN, {
        cycleCode: COLLEGIAL,
        isActive: true
    });
    assert.strictEqual(reenableColl.success, true, 're-enable collegial institution-wide');

    // Both cycles usable again and the teacher's context was cleared: a multi-cycle
    // request without an explicit selection refuses instead of guessing.
    assert.throws(
        () => resolveCycleForRequest(db, eventFor(SENDER_TEACHER)),
        /تسجيل الدخول|تحديد السلك/,
        'multi-cycle request without context refuses (ambiguous)'
    );
    const getActiveResponse = await call(handlers, 'cycles:getActive', SENDER_TEACHER);
    assert.strictEqual(
        getActiveResponse.requiresSelection,
        true,
        'getActive reports requiresSelection with two usable cycles and no context'
    );

    const explicitSelect = await call(handlers, 'cycles:setActive', SENDER_TEACHER, {
        cycleCode: QUALIFIANT,
        schoolYear: YEAR
    });
    assert.strictEqual(explicitSelect.success, true, 'explicit selection succeeds');
    assert.strictEqual(
        resolveCycleForRequest(db, eventFor(SENDER_TEACHER)),
        QUALIFIANT,
        'after explicit selection the request proceeds in the selected cycle'
    );
    const readAfterSelect = await call(handlers, 'absences:getAll', SENDER_TEACHER, YEAR);
    assert.ok(Array.isArray(readAfterSelect), 'read proceeds after explicit selection');
    console.log('[integration] recovery: re-enable + grant + explicit selection required (PASS)');

    // ── (5) Production read/write paths refuse the stale context at the IPC seam ──
    //     Teacher context on collegial; admin disables collegial; the cached context
    //     is cleared, so the stale context never reaches the repo through either channel.
    const selectColl = await call(handlers, 'cycles:setActive', SENDER_TEACHER, {
        cycleCode: COLLEGIAL,
        schoolYear: YEAR
    });
    assert.strictEqual(selectColl.success, true);
    const disableCollAgain = await call(handlers, 'cycles:setEnabled', SENDER_ADMIN, {
        cycleCode: COLLEGIAL,
        isActive: false
    });
    assert.strictEqual(disableCollAgain.success, true);
    assert.strictEqual(peekContext(eventFor(SENDER_TEACHER)), null, 'context cleared on disable');
    const finalRead = await call(handlers, 'absences:getAll', SENDER_TEACHER, YEAR);
    assert.ok(Array.isArray(finalRead), 'final read proceeds through single-cycle fallback');
    assert.strictEqual(
        db.prepare('SELECT COUNT(*) AS c FROM absences WHERE cycle_code = ?').get(COLLEGIAL).c,
        0,
        'no absence rows were ever filed under the disabled cycle through the stale context'
    );

    getActiveSessions().delete(SENDER_ADMIN);
    getActiveSessions().delete(SENDER_TEACHER);
    context.setDb(null);
    setRepoCapturePort(null);
    setCaptureGetDb(null);
    console.log('multi-stage-management-integration.test.js: OK');
})().catch((error) => {
    console.error('multi-stage-management-integration.test.js: FAILED');
    console.error(error);
    process.exitCode = 1;
});
