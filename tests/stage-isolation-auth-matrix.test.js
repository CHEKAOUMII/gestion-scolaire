'use strict';

/**
 * Slice 3 — role & permission isolation matrix (isolation plan §"Slice 3").
 *
 * No model change: `user_cycle_access` stays local-only, admin-managed, with the
 * last-usable-cycle guard in the repo (see tests/cycle-access-management.test.js).
 * This suite pins the runtime enforcement from the caller's side, in BOTH
 * directions, against the REAL IPC handlers:
 *   - a collegial-only teacher can read/write collegial school data but gets
 *     FORBIDDEN on qualifiant (and the exact reverse for qualifiant-only);
 *   - cross-stage staff work only with two explicit grants;
 *   - dashboards bind `filterAuthorizedCycles` (cycles:list / cycles:getActive) —
 *     there is no "teacher implies all stages" shortcut;
 *   - developer/admin/principal hold full access BY ROLE, never via grant rows,
 *     and the matrix cannot revoke it;
 *   - a static guard pins every school-data IPC module that resolves its cycle
 *     in main (resolveCycleForRequest / assertCycleAuthorized).
 *
 * Deliberately NOT covered here (sibling slices own them — see REQUIRED_FIXES in
 * the Slice 3/5 handoff): examConfigData:*, schoolEvents:*, systemTags:*,
 * reports:printDocument/generateAdminForm scoping, and the orientation carve-out
 * (row 132, pinned by tests/s0-cycle-gate.test.js).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const context = require('../main/db/context');
const { ensureInstitutionCyclesSchema, ensureCycleReferenceSchema } = require('../main/db/schema');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
const cycleAccess = require('../main/auth/cycle-access');
const { registerStudentsIpc } = require('../main/ipc/students');
const { registerCyclesIpc } = require('../main/ipc/cycles');
const { setContext, clearContextForSender } = require('../main/auth/active-cycle-context');
const { getActiveSessions } = require('../main/ipc/auth');

const COLLEGIAL = 'secondary_collegial';
const QUALIFIANT = 'secondary_qualifiant';
const YEAR = '2025/2026';

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
        CREATE TABLE students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            full_name TEXT NOT NULL,
            family_name TEXT,
            birth_date TEXT,
            birth_place TEXT,
            gender TEXT,
            section TEXT,
            level TEXT,
            school_name TEXT,
            school_year TEXT,
            status TEXT DEFAULT 'active',
            registration_type TEXT DEFAULT 'new',
            cycle_code TEXT NOT NULL DEFAULT 'secondary_qualifiant',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(code, school_year)
        );
    `);
    ensureCycleReferenceSchema(db);
    const insertCycle = db.prepare(
        `INSERT INTO institution_cycles (cycle_code, is_active, seed_profile_version_hint, sort_order)
         VALUES (?, 1, ?, ?)`
    );
    insertCycle.run(COLLEGIAL, 'collegial-2026-v1', 10);
    insertCycle.run(QUALIFIANT, 'qualifiant-2026-v1', 20);
    const insertUser = db.prepare('INSERT INTO users (name, email, role) VALUES (?, ?, ?)');
    insertUser.run('المدير', 'admin@school.local', 'admin'); // id 1
    insertUser.run('مدير المؤسسة', 'principal@school.local', 'principal'); // id 2
    insertUser.run('أستاذ إعدادي', 'teacher-c@school.local', 'teacher'); // id 3
    insertUser.run('أستاذ تأهيلي', 'teacher-q@school.local', 'teacher'); // id 4
    insertUser.run('أستاذ مشترك', 'teacher-b@school.local', 'teacher'); // id 5
    const grant = db.prepare('INSERT INTO user_cycle_access (user_id, cycle_code) VALUES (?, ?)');
    grant.run(3, COLLEGIAL);
    grant.run(4, QUALIFIANT);
    grant.run(5, COLLEGIAL);
    grant.run(5, QUALIFIANT);
    const insertStudent = db.prepare(
        `INSERT INTO students (code, full_name, section, school_year, status, cycle_code)
         VALUES (?, ?, ?, ?, 'active', ?)`
    );
    insertStudent.run('C001', 'تلميذ إعدادي', '1APIC-1', YEAR, COLLEGIAL);
    insertStudent.run('Q001', 'تلميذ تأهيلي', 'TCS-1', YEAR, QUALIFIANT);
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
    return { sender: { id: senderId, send() {} } };
}

function setSession(senderId, userId, role) {
    getActiveSessions().set(senderId, { userId, role, locked: false });
}

function studentRowsFor(db, cycleCode) {
    return db
        .prepare('SELECT code, cycle_code FROM students WHERE school_year = ? AND cycle_code = ? ORDER BY code')
        .all(YEAR, cycleCode);
}

(async () => {
    console.log('[test] Slice 3 role & permission isolation matrix (both directions)');
    const db = buildFixture();
    setRepoCapturePort(createNoOpCapturePort());
    context.setDb(db);

    const { ipcMain, handlers } = collectHandlers();
    registerStudentsIpc(ipcMain);
    registerCyclesIpc(ipcMain);

    // ── Direction 1: collegial-only teacher (id 3) ──
    setSession(9301, 3, 'teacher');
    setSession(9302, 3, 'teacher');
    setContext(makeEvent(9301), 3, COLLEGIAL, YEAR);
    const collegialRead = await handlers['students:getAll'](makeEvent(9301), YEAR);
    assert.ok(Array.isArray(collegialRead), 'own-stage read must return rows');
    assert.deepStrictEqual(
        collegialRead.map((row) => row.code),
        ['C001'],
        'collegial-only teacher reads exactly the collegial roster'
    );
    // Payloads carry every column insertOne binds: unlike better-sqlite3,
    // the node:sqlite test fallback cannot bind `undefined` parameters.
    const fullPayload = (code, fullName, section) => ({
        code,
        full_name: fullName,
        family_name: '',
        birth_date: '',
        gender: '',
        section,
        level: '',
        school_name: '',
        school_year: YEAR,
        status: 'active',
        registration_type: 'new'
    });
    const collegialWrite = await handlers['students:add'](makeEvent(9301), fullPayload('C002', 'تلميذ إعدادي 2', '1APIC-2'));
    assert.strictEqual(collegialWrite.success, true, 'own-stage write must succeed');
    assert.deepStrictEqual(
        studentRowsFor(db, COLLEGIAL).map((row) => row.code),
        ['C001', 'C002'],
        'own-stage write must land in the collegial partition'
    );

    setContext(makeEvent(9302), 3, QUALIFIANT);
    const crossRead = await handlers['students:getAll'](makeEvent(9302), YEAR);
    assert.strictEqual(crossRead.success, false, 'cross-stage read must fail');
    assert.strictEqual(crossRead.code, 'FORBIDDEN', 'collegial-only teacher: qualifiant read FORBIDDEN');
    const crossWrite = await handlers['students:add'](makeEvent(9302), {
        code: 'X001',
        full_name: 'متسلل',
        section: 'TCS-9',
        school_year: YEAR
    });
    assert.strictEqual(crossWrite.code, 'FORBIDDEN', 'collegial-only teacher: qualifiant write FORBIDDEN');
    assert.deepStrictEqual(
        studentRowsFor(db, QUALIFIANT).map((row) => row.code),
        ['Q001'],
        'refused cross-stage write must leave the qualifiant partition intact'
    );
    const crossSwitch = await handlers['cycles:setActive'](makeEvent(9302), {
        cycleCode: QUALIFIANT,
        schoolYear: YEAR
    });
    assert.strictEqual(crossSwitch.code, 'FORBIDDEN', 'cycles:setActive into an ungranted stage must be FORBIDDEN');
    console.log('  [ok] direction 1: collegial-only teacher vs qualifiant (read + write FORBIDDEN)');

    // ── Direction 2 (reverse): qualifiant-only teacher (id 4) ──
    setSession(9303, 4, 'teacher');
    setSession(9304, 4, 'teacher');
    setContext(makeEvent(9303), 4, QUALIFIANT);
    const qualifiantRead = await handlers['students:getAll'](makeEvent(9303), YEAR);
    assert.deepStrictEqual(
        qualifiantRead.map((row) => row.code),
        ['Q001'],
        'qualifiant-only teacher reads exactly the qualifiant roster'
    );
    setContext(makeEvent(9304), 4, COLLEGIAL);
    const reverseRead = await handlers['students:getAll'](makeEvent(9304), YEAR);
    assert.strictEqual(reverseRead.code, 'FORBIDDEN', 'qualifiant-only teacher: collegial read FORBIDDEN');
    const reverseWrite = await handlers['students:add'](makeEvent(9304), {
        code: 'X002',
        full_name: 'متسلل',
        section: '1APIC-9',
        school_year: YEAR
    });
    assert.strictEqual(reverseWrite.code, 'FORBIDDEN', 'qualifiant-only teacher: collegial write FORBIDDEN');
    assert.deepStrictEqual(
        studentRowsFor(db, COLLEGIAL).map((row) => row.code),
        ['C001', 'C002'],
        'refused reverse write must leave the collegial partition intact'
    );
    console.log('  [ok] direction 2: qualifiant-only teacher vs collegial (read + write FORBIDDEN)');

    // ── Cross-stage staff: two explicit grants, two working contexts ──
    setSession(9305, 5, 'teacher');
    setSession(9306, 5, 'teacher');
    setContext(makeEvent(9305), 5, COLLEGIAL);
    setContext(makeEvent(9306), 5, QUALIFIANT);
    assert.deepStrictEqual(
        (await handlers['students:getAll'](makeEvent(9305), YEAR)).map((row) => row.code),
        ['C001', 'C002'],
        'dual-grant teacher reads collegial'
    );
    assert.deepStrictEqual(
        (await handlers['students:getAll'](makeEvent(9306), YEAR)).map((row) => row.code),
        ['Q001'],
        'dual-grant teacher reads qualifiant'
    );
    console.log('  [ok] cross-stage staff work with two explicit grants');

    // ── Dashboards bind filterAuthorizedCycles (no teacher-implies-all) ──
    const listAs = async (senderId) => (await handlers['cycles:list'](makeEvent(senderId))).cycles;
    assert.deepStrictEqual(
        (await listAs(9301)).map((cycle) => cycle.cycle_code),
        [COLLEGIAL],
        'cycles:list shows the collegial-only teacher exactly one stage'
    );
    assert.deepStrictEqual(
        (await listAs(9303)).map((cycle) => cycle.cycle_code),
        [QUALIFIANT],
        'cycles:list shows the qualifiant-only teacher exactly one stage'
    );
    assert.deepStrictEqual(
        (await listAs(9305)).map((cycle) => cycle.cycle_code).sort(),
        [COLLEGIAL, QUALIFIANT].sort(),
        'cycles:list shows the dual-grant teacher both stages'
    );
    setSession(9307, 2, 'principal');
    assert.deepStrictEqual(
        (await listAs(9307)).map((cycle) => cycle.cycle_code).sort(),
        [COLLEGIAL, QUALIFIANT].sort(),
        'principal sees every stage by role, not by grant rows'
    );
    clearContextForSender(9301);
    const singleGrantActive = await handlers['cycles:getActive'](makeEvent(9301));
    assert.strictEqual(singleGrantActive.success, true);
    assert.strictEqual(
        singleGrantActive.context.cycleCode,
        COLLEGIAL,
        'single-grant teacher resolves the one authorized stage without choosing'
    );
    const principalActive = await handlers['cycles:getActive'](makeEvent(9307));
    assert.strictEqual(principalActive.success, true);
    assert.strictEqual(
        principalActive.requiresSelection,
        true,
        'with two usable stages the principal must choose — never auto-pinned'
    );
    console.log('  [ok] dashboards bind filterAuthorizedCycles (no teacher-implies-all shortcut)');

    // ── Principal full access is BY ROLE — never grant rows, never revocable ──
    assert.deepStrictEqual(
        db.prepare('SELECT cycle_code FROM user_cycle_access WHERE user_id = ?').all(2),
        [],
        'principal holds zero grant rows in the fixture'
    );
    setSession(9308, 2, 'principal');
    setSession(9309, 2, 'principal');
    setContext(makeEvent(9308), 2, COLLEGIAL, YEAR);
    setContext(makeEvent(9309), 2, QUALIFIANT, YEAR);
    assert.ok(
        Array.isArray(await handlers['students:getAll'](makeEvent(9308), YEAR)),
        'principal reads collegial without grants'
    );
    assert.ok(
        Array.isArray(await handlers['students:getAll'](makeEvent(9309), YEAR)),
        'principal reads qualifiant without grants'
    );
    const principalWrite = await handlers['students:add'](makeEvent(9309), fullPayload('Q002', 'تلميذ تأهيلي 2', 'TCS-2'));
    assert.strictEqual(principalWrite.success, true, 'principal writes qualifiant without grants');
    const principalEntry = cycleAccess.listUserCycleAccess(db).find((user) => user.role === 'principal');
    assert.strictEqual(principalEntry.fullAccess, true, 'principal is full-access in the matrix');
    assert.strictEqual(principalEntry.cycles, null, 'full-access roles expose no row grants');
    assert.throws(
        () => cycleAccess.setUserCycles(db, 2, []),
        (error) => error.code === cycleAccess.CYCLE_ACCESS_ERROR_CODES.FORBIDDEN,
        'the matrix cannot revoke principal access (repo layer refuses)'
    );
    console.log('  [ok] principal full-access-by-role documented + pinned (not per-stage, not revocable)');

    // ── Static guard: school-data IPC modules resolve their cycle in main ──
    const enforcedModules = [
        'absences.js',
        'catalog.js',
        'cycles.js',
        'daily-report.js',
        'exams.js',
        'grades.js',
        'schoolOps.js',
        'staff.js',
        'staffAttendance.js',
        'stage-rules.js',
        'student-profile.js',
        'students.js',
        'support-sessions.js',
        'timetable-data.js'
    ];
    for (const file of enforcedModules) {
        const source = fs.readFileSync(path.join(__dirname, '..', 'main', 'ipc', file), 'utf8');
        assert.ok(
            source.includes('resolveCycleForRequest') || source.includes('assertCycleAuthorized'),
            `${file} must enforce its cycle in main (resolveCycleForRequest/assertCycleAuthorized)`
        );
    }
    console.log('  [ok] static guard: 14 school-data IPC modules resolve their cycle in main');

    for (const senderId of [9301, 9302, 9303, 9304, 9305, 9306, 9307, 9308, 9309]) {
        clearContextForSender(senderId);
    }
    getActiveSessions().clear();
    console.log('stage-isolation-auth-matrix.test.js: OK');
})().catch((error) => {
    console.error('stage-isolation-auth-matrix.test.js: FAILED');
    console.error(error);
    process.exitCode = 1;
});
