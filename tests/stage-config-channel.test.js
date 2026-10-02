'use strict';

/**
 * Slice 5 stage-config IPC surface (main/ipc/stage-config.js):
 *   - stageConfig:get / stageConfig:list / stageConfig:save are registered and
 *     resolve the stage from the session (never from renderer input)
 *   - auth matrix both directions: a collegial-only teacher reads collegial but
 *     gets FORBIDDEN on qualifiant (and reverse); teachers can never save
 *     (admin+principal only, stageRules precedent)
 *   - round-trip per stage; a cross-stage read returns nothing
 *     (STAGE_CONFIG_MISSING / empty list — never the other stage's values)
 *   - device-local sync contract: no ENTITY_REGISTRY entry, the write channel
 *     is captureMode explicit + exclude true, writes leave zero outbox rows
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const context = require('../main/db/context');
const { ensureInstitutionCyclesSchema, ensureCycleReferenceSchema } = require('../main/db/schema');
const { registerStageConfigIpc, WRITE_ROLES } = require('../main/ipc/stage-config');
const { getActiveSessions } = require('../main/ipc/auth');
const { setContext, clearContextForSender } = require('../main/auth/active-cycle-context');
const { getEntity, isKnownSyncTable } = require('../main/sync/entity-registry');
const { CHANNEL_REGISTRY } = require('../main/sync/capture');

const COLLEGIAL = 'secondary_collegial';
const QUALIFIANT = 'secondary_qualifiant';
const YEAR = '2025/2026';

const SENDER_ADMIN = 9201;
const SENDER_PRINCIPAL = 9202;
const SENDER_TEACHER_C = 9203;
const SENDER_TEACHER_Q = 9204;
const SENDER_VIEWER = 9205;
const SENDER_ANON = 9299;

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

/**
 * Dual supported-stage fixture: teacher 3 holds a collegial-only grant,
 * teacher 4 a qualifiant-only grant; admin/principal hold full access by role.
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
    db.exec(`
        CREATE TABLE sync_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT NOT NULL,
            row_sync_id TEXT NOT NULL,
            operation TEXT NOT NULL CHECK(operation IN ('PUT','DEL')),
            row_data TEXT,
            school_year TEXT,
            status TEXT NOT NULL DEFAULT 'pending'
        );
    `);
    const insertCycle = db.prepare(
        `INSERT INTO institution_cycles (cycle_code, is_active, seed_profile_version_hint, sort_order)
         VALUES (?, 1, ?, ?)`
    );
    insertCycle.run(QUALIFIANT, 'qualifiant-2026-v1', 20);
    insertCycle.run(COLLEGIAL, 'collegial-2026-v1', 10);
    const insertUser = db.prepare('INSERT INTO users (name, email, role) VALUES (?, ?, ?)');
    insertUser.run('المدير', 'admin@school.local', 'admin');
    insertUser.run('مدير المؤسسة', 'principal@school.local', 'principal');
    insertUser.run('أستاذ إعدادي', 'teacher-c@school.local', 'teacher');
    insertUser.run('أستاذ تأهيلي', 'teacher-q@school.local', 'teacher');
    db.prepare('INSERT INTO user_cycle_access (user_id, cycle_code) VALUES (?, ?)').run(3, COLLEGIAL);
    db.prepare('INSERT INTO user_cycle_access (user_id, cycle_code) VALUES (?, ?)').run(4, QUALIFIANT);
    return db;
}

function makeEvent(senderId) {
    return { sender: { id: senderId } };
}

function outboxCount(db) {
    return db.prepare('SELECT COUNT(*) AS count FROM sync_outbox').get().count;
}

(async () => {
    console.log('[test] stage-config IPC channels (Slice 5 first consumer)');
    const db = buildFixture();
    context.setDb(db);

    const handlers = {};
    registerStageConfigIpc({ handle: (channel, handler) => { handlers[channel] = handler; } });

    const sessions = getActiveSessions();
    sessions.set(SENDER_ADMIN, { userId: 1, role: 'admin', locked: false });
    sessions.set(SENDER_PRINCIPAL, { userId: 2, role: 'principal', locked: false });
    sessions.set(SENDER_TEACHER_C, { userId: 3, role: 'teacher', locked: false });
    sessions.set(SENDER_TEACHER_Q, { userId: 4, role: 'teacher', locked: false });
    sessions.set(SENDER_VIEWER, { userId: 5, role: 'viewer', locked: false });

    try {
        // ── Channels + roles ──
        assert.strictEqual(typeof handlers['stageConfig:get'], 'function', 'stageConfig:get registered');
        assert.strictEqual(typeof handlers['stageConfig:list'], 'function', 'stageConfig:list registered');
        assert.strictEqual(typeof handlers['stageConfig:save'], 'function', 'stageConfig:save registered');
        assert.deepStrictEqual([...WRITE_ROLES].sort(), ['admin', 'principal'], 'save is admin+principal (stageRules precedent)');
        console.log('  [ok] three channels registered, save roles admin+principal');

        // ── Device-local sync contract (mirror of the cycleAccess decision) ──
        assert.strictEqual(getEntity('stage_configs'), null, 'stage_configs must NOT be a sync entity');
        assert.strictEqual(isKnownSyncTable('stage_configs'), false, 'stage_configs is not a sync table');
        assert.strictEqual(CHANNEL_REGISTRY['stageConfig:save']?.exclude, true, 'save excluded from capture');
        assert.strictEqual(
            CHANNEL_REGISTRY['stageConfig:save']?.captureMode,
            'explicit',
            'save is explicit capture mode (device-local, never captured)'
        );
        console.log('  [ok] device-local contract: no registry entity, save excluded from capture');

        // ── Round-trip per stage (admin writes through the session stage) ──
        const collegialCalendar = { startDate: '2025-09-08', holidays: ['عيد المولد'] };
        const qualifiantCalendar = { startDate: '2025-09-04', holidays: ['عطلة بينية'] };
        setContext(makeEvent(SENDER_ADMIN), 1, QUALIFIANT, YEAR);
        const saveQ = await handlers['stageConfig:save'](makeEvent(SENDER_ADMIN), {
            schoolYear: YEAR,
            configKey: 'calendar',
            value: qualifiantCalendar
        });
        assert.strictEqual(saveQ.success, true, `admin saves qualifiant calendar: ${JSON.stringify(saveQ)}`);
        assert.strictEqual(saveQ.cycleCode, QUALIFIANT, 'save binds the session stage, never a client cycle');
        setContext(makeEvent(SENDER_ADMIN), 1, COLLEGIAL, YEAR);
        const saveC = await handlers['stageConfig:save'](makeEvent(SENDER_ADMIN), {
            schoolYear: YEAR,
            configKey: 'calendar',
            value: collegialCalendar
        });
        assert.strictEqual(saveC.success, true, `admin saves collegial calendar: ${JSON.stringify(saveC)}`);
        const getC = await handlers['stageConfig:get'](makeEvent(SENDER_ADMIN), {
            schoolYear: YEAR,
            configKey: 'calendar'
        });
        assert.deepStrictEqual(getC.config.value, collegialCalendar, 'collegial reads its own calendar');
        setContext(makeEvent(SENDER_ADMIN), 1, QUALIFIANT, YEAR);
        const getQ = await handlers['stageConfig:get'](makeEvent(SENDER_ADMIN), {
            schoolYear: YEAR,
            configKey: 'calendar'
        });
        assert.deepStrictEqual(getQ.config.value, qualifiantCalendar, 'qualifiant reads its own calendar');
        const listQ = await handlers['stageConfig:list'](makeEvent(SENDER_ADMIN), YEAR);
        assert.strictEqual(listQ.success, true);
        assert.strictEqual(listQ.cycleCode, QUALIFIANT, 'list reports the server-resolved stage');
        assert.deepStrictEqual(
            listQ.configs.map((entry) => entry.configKey),
            ['calendar'],
            'qualifiant list carries exactly the qualifiant keys'
        );
        console.log('  [ok] per-stage round-trip; list is stage-scoped');

        // ── Cross-stage read returns nothing, never the other stage's values ──
        const saveTerms = await handlers['stageConfig:save'](makeEvent(SENDER_ADMIN), {
            schoolYear: YEAR,
            configKey: 'terms',
            value: { semesters: 2 }
        });
        assert.strictEqual(saveTerms.success, true, 'qualifiant terms saved');
        setContext(makeEvent(SENDER_ADMIN), 1, COLLEGIAL, YEAR);
        const crossGet = await handlers['stageConfig:get'](makeEvent(SENDER_ADMIN), {
            schoolYear: YEAR,
            configKey: 'terms'
        });
        assert.strictEqual(crossGet.success, false, 'collegial must not read qualifiant terms');
        assert.strictEqual(crossGet.code, 'STAGE_CONFIG_MISSING', 'missing key fails closed, never crosses stages');
        assert.ok(/[\u0600-\u06FF]/.test(crossGet.error), 'missing-config error stays Arabic');
        const crossList = await handlers['stageConfig:list'](makeEvent(SENDER_ADMIN), YEAR);
        assert.deepStrictEqual(
            crossList.configs.map((entry) => entry.configKey),
            ['calendar'],
            'collegial list never includes the qualifiant-only terms key'
        );
        console.log('  [ok] cross-stage read returns nothing (STAGE_CONFIG_MISSING / scoped list)');

        // ── Auth matrix, both directions ──
        setContext(makeEvent(SENDER_TEACHER_C), 3, COLLEGIAL, YEAR);
        const ownRead = await handlers['stageConfig:list'](makeEvent(SENDER_TEACHER_C), YEAR);
        assert.strictEqual(ownRead.success, true, 'collegial-only teacher reads the collegial config');
        setContext(makeEvent(SENDER_TEACHER_C), 3, QUALIFIANT, YEAR);
        const crossRead = await handlers['stageConfig:list'](makeEvent(SENDER_TEACHER_C), YEAR);
        assert.strictEqual(crossRead.code, 'FORBIDDEN', 'collegial-only teacher: qualifiant read FORBIDDEN');
        const crossWrite = await handlers['stageConfig:save'](makeEvent(SENDER_TEACHER_C), {
            schoolYear: YEAR,
            configKey: 'calendar',
            value: { hacked: true }
        });
        assert.strictEqual(crossWrite.code, 'FORBIDDEN', 'collegial-only teacher: qualifiant save FORBIDDEN');

        setContext(makeEvent(SENDER_TEACHER_Q), 4, QUALIFIANT, YEAR);
        const ownReadQ = await handlers['stageConfig:get'](makeEvent(SENDER_TEACHER_Q), {
            schoolYear: YEAR,
            configKey: 'terms'
        });
        assert.strictEqual(ownReadQ.success, true, 'qualifiant-only teacher reads the qualifiant config');
        setContext(makeEvent(SENDER_TEACHER_Q), 4, COLLEGIAL, YEAR);
        const reverseRead = await handlers['stageConfig:get'](makeEvent(SENDER_TEACHER_Q), {
            schoolYear: YEAR,
            configKey: 'calendar'
        });
        assert.strictEqual(reverseRead.code, 'FORBIDDEN', 'qualifiant-only teacher: collegial read FORBIDDEN');

        // Teachers can never save — even inside their own granted stage.
        setContext(makeEvent(SENDER_TEACHER_Q), 4, QUALIFIANT, YEAR);
        const ownStageTeacherSave = await handlers['stageConfig:save'](makeEvent(SENDER_TEACHER_Q), {
            schoolYear: YEAR,
            configKey: 'calendar',
            value: { startDate: '2025-09-01' }
        });
        assert.strictEqual(ownStageTeacherSave.code, 'FORBIDDEN', 'teacher save FORBIDDEN even in the own stage');

        // Principal saves (stageRules precedent); viewer and anonymous cannot.
        setContext(makeEvent(SENDER_PRINCIPAL), 2, COLLEGIAL, YEAR);
        const principalSave = await handlers['stageConfig:save'](makeEvent(SENDER_PRINCIPAL), {
            schoolYear: YEAR,
            configKey: 'attendance_rules',
            value: { lateThresholdMinutes: 10 }
        });
        assert.strictEqual(principalSave.success, true, `principal saves: ${JSON.stringify(principalSave)}`);
        setContext(makeEvent(SENDER_VIEWER), 5, QUALIFIANT, YEAR);
        const viewerSave = await handlers['stageConfig:save'](makeEvent(SENDER_VIEWER), {
            schoolYear: YEAR,
            configKey: 'calendar',
            value: {}
        });
        assert.strictEqual(viewerSave.code, 'FORBIDDEN', 'viewer save FORBIDDEN');
        const anonGet = await handlers['stageConfig:get'](makeEvent(SENDER_ANON), {
            schoolYear: YEAR,
            configKey: 'calendar'
        });
        assert.strictEqual(anonGet.code, 'UNAUTHENTICATED', 'anonymous read refused');
        const anonSave = await handlers['stageConfig:save'](makeEvent(SENDER_ANON), {
            schoolYear: YEAR,
            configKey: 'calendar',
            value: {}
        });
        assert.strictEqual(anonSave.code, 'UNAUTHENTICATED', 'anonymous save refused');
        console.log('  [ok] auth matrix both directions incl teacher/viewer/anonymous FORBIDDEN');

        // ── Missing config + invalid payloads fail closed ──
        setContext(makeEvent(SENDER_ADMIN), 1, COLLEGIAL, YEAR);
        const missingYear = await handlers['stageConfig:get'](makeEvent(SENDER_ADMIN), {
            schoolYear: '2024/2025',
            configKey: 'calendar'
        });
        assert.strictEqual(missingYear.code, 'STAGE_CONFIG_MISSING', 'missing year fails closed');
        const badKey = await handlers['stageConfig:get'](makeEvent(SENDER_ADMIN), {
            schoolYear: YEAR,
            configKey: 'nope'
        });
        assert.strictEqual(badKey.code, 'STAGE_CONFIG_INVALID', 'unknown config key is STAGE_CONFIG_INVALID');
        const badYear = await handlers['stageConfig:list'](makeEvent(SENDER_ADMIN), '2025');
        assert.strictEqual(badYear.code, 'INVALID_SCHOOL_YEAR', 'malformed school year refused');
        const badValue = await handlers['stageConfig:save'](makeEvent(SENDER_ADMIN), {
            schoolYear: YEAR,
            configKey: 'calendar',
            value: 'not-an-object'
        });
        assert.strictEqual(badValue.code, 'STAGE_CONFIG_INVALID', 'non-object value refused');
        const missingFields = await handlers['stageConfig:save'](makeEvent(SENDER_ADMIN), { schoolYear: YEAR });
        assert.strictEqual(missingFields.code, 'STAGE_CONFIG_INVALID', 'missing payload fields are STAGE_CONFIG_INVALID');
        console.log('  [ok] missing-config fail-closed + invalid-payload codes');

        // ── Zero outbox rows across every write above ──
        assert.strictEqual(outboxCount(db), 0, 'stage-config writes are device-local — zero outbox rows');
        console.log('  [ok] no-outbox assert across all channel writes');

        // ── Preload parity ──
        const preloadSrc = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
        for (const channel of ['stageConfig:get', 'stageConfig:list', 'stageConfig:save']) {
            assert.ok(
                preloadSrc.includes(`ipcRenderer.invoke('${channel}'`),
                `preload exposes ${channel}`
            );
        }
        console.log('  [ok] preload exposes the three channels');
    } finally {
        for (const sender of [SENDER_ADMIN, SENDER_PRINCIPAL, SENDER_TEACHER_C, SENDER_TEACHER_Q, SENDER_VIEWER]) {
            clearContextForSender(sender);
            sessions.delete(sender);
        }
    }

    console.log('stage-config-channel.test.js: OK');
})().catch((error) => {
    console.error('stage-config-channel.test.js: FAILED');
    console.error(error);
    process.exitCode = 1;
});
