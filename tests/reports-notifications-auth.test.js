'use strict';

/**
 * Auth matrix for the previously unauthenticated reports:* and notifications:*
 * channels (audit R2). Before this contract these ran on raw ipcMain.handle:
 * any renderer content — including a compromised one — could print documents,
 * read/mutate the notification store, and rewrite the school identity
 * (reports:updateIdentity) with no session at all.
 *
 * Contract:
 *   - Every reports/notifications channel below denies anonymous callers with
 *     { success:false, code:'UNAUTHENTICATED' }.
 *   - reports:updateIdentity is role-gated to the settings-school page writers
 *     (['principal','external-guardian']); teacher is FORBIDDEN.
 *   - A signed-in principal can still read identity and the unread count —
 *     the wrap must not change success-path response shapes.
 */

const assert = require('assert');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
const context = require('../main/db/context');
const { getActiveSessions } = require('../main/ipc/auth');
const { registerReportsIpc } = require('../main/ipc/reports');
const { registerNotificationsIpc } = require('../main/ipc/notifications');
const store = require('../main/notifications/store');
const { openDb } = require('./fixtures/open-db');

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
    const db = openDb();
    context.setDb(db);
    setRepoCapturePort(createNoOpCapturePort());
    store.init();

    const { ipcMain, handlers } = collectHandlers();
    registerReportsIpc(ipcMain);
    registerNotificationsIpc(ipcMain);

    const ANON = 8101;
    const TEACHER = 8102;
    const PRINCIPAL = 8103;
    signIn(TEACHER, 2, 'teacher');
    signIn(PRINCIPAL, 3, 'principal');

    // Self-heal the school_identity schema via a signed-in read so the
    // no-write assertions below can query the table.
    const warmup = await call(handlers, 'reports:getIdentity', PRINCIPAL);
    assert.notStrictEqual(warmup?.success, false, `getIdentity warmup failed: ${warmup?.error}`);

    // ── 1. Anonymous callers are denied on every previously raw channel ──────────
    const anonymousCases = [
        ['reports:printDocument', { documentType: 'certificates' }],
        ['reports:getIdentity', undefined],
        ['reports:updateIdentity', { school_name: 'x' }],
        ['reports:renderLetterhead', {}],
        ['reports:generateAdminForm', { formType: 'transfer' }],
        ['notifications:send', { type: 't' }],
        ['notifications:getRecent', 5],
        ['notifications:markRead', 'id-1'],
        ['notifications:markAllRead', undefined],
        ['notifications:unreadCount', undefined],
        ['notifications:deleteOld', 30]
    ];
    for (const [channel, arg] of anonymousCases) {
        const res = await call(handlers, channel, ANON, arg);
        assert.strictEqual(res?.success, false, `${channel} must deny anonymous callers`);
        assert.strictEqual(res?.code, 'UNAUTHENTICATED', `${channel} expected UNAUTHENTICATED, got ${res?.code}`);
    }
    assert.strictEqual(
        db.prepare("SELECT COUNT(*) AS c FROM school_identity WHERE value = 'x'").get().c,
        0,
        'anonymous updateIdentity must not write the identity table'
    );

    // ── 2. updateIdentity is role-gated to the settings-school page writers ─────
    const teacherRes = await call(handlers, 'reports:updateIdentity', TEACHER, { school_name: 'teacher-try' });
    assert.strictEqual(teacherRes?.success, false);
    assert.strictEqual(teacherRes?.code, 'FORBIDDEN');
    assert.strictEqual(
        db.prepare("SELECT COUNT(*) AS c FROM school_identity WHERE value = 'teacher-try'").get().c,
        0,
        'teacher updateIdentity must not write'
    );

    // ── 3. Principal positive paths keep their original response shapes ─────────
    const updateRes = await call(handlers, 'reports:updateIdentity', PRINCIPAL, { school_name: 'ثانوية ابن سينا' });
    assert.notStrictEqual(updateRes?.success, false, `principal updateIdentity failed: ${updateRes?.error}`);
    const identityRow = db.prepare("SELECT value FROM school_identity WHERE key = 'school_name'").get();
    assert.strictEqual(identityRow?.value, 'ثانوية ابن سينا');

    const identityRes = await call(handlers, 'reports:getIdentity', PRINCIPAL);
    assert.notStrictEqual(identityRes?.success, false, `getIdentity failed: ${identityRes?.error}`);

    const unread = await call(handlers, 'notifications:unreadCount', PRINCIPAL);
    assert.strictEqual(typeof unread, 'number', `unreadCount must stay a number, got: ${JSON.stringify(unread)}`);

    context.setDb(null);
    console.log('[reports-notifications-auth] OK: 11 channels deny anonymous; updateIdentity role-gated; success shapes unchanged.');
    process.exit(0);
})().catch((err) => {
    console.error('[reports-notifications-auth] FAILED:', err);
    process.exit(1);
});
