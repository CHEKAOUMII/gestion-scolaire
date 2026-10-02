'use strict';

// Unit tests — sync push permission-denied fix
//
// Plan: plans/frolicking-rolling-mccarthy.md
//
// Covers the two pure seams introduced/changed in main/sync/engine.js:
//   1. classifyPushError — translates known failure strings (permission-denied,
//      credentials-unavailable) to user-facing Arabic, returning the input
//      unchanged for every other error class.
//   2. updatePushMeta — accepts `undefined` as a "don't touch last_push_error"
//      signal so a later bland reason ("Failed to obtain credentials") never
//      clobbers a prior meaningful error (PERMISSION_DENIED) while still
//      updating last_push_at.
//
// These are pure functions with no Electron/Firebase coupling, so the engine is
// required directly without the require-cache mock injection used by the
// property tests.

const assert = require('assert');

const {
    classifyPushError,
    updatePushMeta,
    recordPushMeta
} = require('../main/sync/engine');

let checks = 0;

console.log('[unit] sync push permission-denied: translate + don\'t-clobber');

// ===========================================================================
// 1. classifyPushError — known cases map to Arabic, unknown cases pass through.
// ===========================================================================
{
    const denied = classifyPushError('7 PERMISSION_DENIED: Missing or insufficient permissions.');
    assert.ok(
        denied.includes('تم رفض المزامنة'),
        `permission_denied -> Arabic message (got: ${denied})`
    );
    assert.ok(
        denied.includes('أعد تسجيل الدخول'),
        `Arabic message tells the user to re-login (got: ${denied})`
    );

    const deniedDash = classifyPushError('permission-denied');
    assert.ok(deniedDash.includes('تم رفض المزامنة'), 'permission-denied (kebab) -> Arabic');

    const noCreds = classifyPushError('Failed to obtain credentials');
    assert.ok(
        noCreds.includes('تعذّر الحصول على جلسة سحابية'),
        `credentials failure -> Arabic (got: ${noCreds})`
    );

    const code = classifyPushError('SYNC_AUTH_UNAVAILABLE');
    assert.ok(code.includes('تعذّر الحصول على جلسة سحابية'), 'SYNC_AUTH_UNAVAILABLE code -> Arabic');

    const code2 = classifyPushError('credentials_unavailable');
    assert.ok(code2.includes('تعذّر الحصول على جلسة سحابية'), 'credentials_unavailable code -> Arabic');

    // Unknown error: pass through verbatim (no false translations).
    const misc = classifyPushError('syncLog write failed — other devices may not receive changes');
    assert.strictEqual(
        misc,
        'syncLog write failed — other devices may not receive changes',
        'unknown error returned unchanged'
    );

    // Empty / falsy input: returned as-is (the helper guards `null`/`undefined`
    // via `String(errString || '')` so it never crashes — produces '' for falsy).
    assert.strictEqual(classifyPushError(''), '', 'empty string -> empty string');
    assert.strictEqual(classifyPushError(null), '', 'null -> empty string, no crash');
    assert.strictEqual(classifyPushError(undefined), '', 'undefined -> empty string, no crash');

    checks += 1;
}

// ===========================================================================
// 2. updatePushMeta — `undefined` last_push_error keeps the existing column
//    value while still advancing last_push_at (the "don't clobber" guard).
// ===========================================================================
function makeRecordingDb() {
    const recorded = { sqls: [], argses: [], runs: 0 };
    return {
        recorded,
        prepare(sql) {
            recorded.sqls.push(String(sql).replace(/\s+/g, ' ').trim());
            return {
                run: (...args) => {
                    recorded.argses.push(args);
                    recorded.runs += 1;
                    return { changes: 1 };
                }
            };
        }
    };
}

{
    const db = makeRecordingDb();
    const at = '2026-03-23T10:00:00.000Z';

    updatePushMeta(db, at, undefined);

    assert.strictEqual(db.recorded.runs, 1, 'one write performed');
    const sql = db.recorded.sqls[0];
    const args = db.recorded.argses[0];

    // The "preserve" variant issues a single-arg COALESCE UPDATE that does NOT
    // bind last_push_error at all.
    assert.ok(
        sql.includes('last_push_at = COALESCE(?, last_push_at)'),
        `undefined error uses COALESCE to preserve last_push_error (got: ${sql})`
    );
    assert.ok(
        !sql.includes('last_push_error = ?'),
        'the preserve path must NOT bind last_push_error as a parameter'
    );
    assert.deepStrictEqual(args, [at], 'only last_push_at is bound when preserving last_push_error');
    checks += 1;
}

// Concrete "don't clobber" scenario from the plan: a prior PERMISSION_DENIED is
// stored, then the next tick hits the null-credentials branch. `recordPushMeta`
// is called with `undefined` (the new "preserve" signal) — so the stored Arabic
// permission message must remain, and only last_push_at advances.
{
    const db = makeRecordingDb();
    const priorArabic = classifyPushError('7 PERMISSION_DENIED: Missing or insufficient permissions.');

    // First tick: real error recorded (translated by recordPushMeta).
    recordPushMeta(db, '2026-03-23T10:00:00.000Z', '7 PERMISSION_DENIED: Missing or insufficient permissions.');
    // Second tick: credentials went null, caller passes `undefined` to preserve.
    recordPushMeta(db, '2026-03-23T10:00:30.000Z', undefined);

    assert.strictEqual(db.recorded.runs, 2, 'exactly two writes across both ticks');
    // First call persists the translated Arabic string.
    assert.deepStrictEqual(
        db.recorded.argses[0],
        ['2026-03-23T10:00:00.000Z', priorArabic],
        'first tick records the Arabic-translated PERMISSION_DENIED'
    );
    // Second call preserves last_push_error — only last_push_at is bound.
    assert.deepStrictEqual(
        db.recorded.argses[1],
        ['2026-03-23T10:00:30.000Z'],
        'second tick preserves last_push_error (only last_push_at bound)'
    );
    assert.ok(
        db.recorded.sqls[1].includes('COALESCE(?, last_push_at)'),
        'second tick uses the preserve-path UPDATE'
    );
    checks += 1;
}

// Counter-check: when there is NO prior error to preserve, the caller passes
// the structured 'SYNC_AUTH_UNAVAILABLE' code; recordPushMeta translates it
// to Arabic (so the user sees an actionable message instead of the bland
// English string).
{
    const db = makeRecordingDb();
    recordPushMeta(db, null, 'SYNC_AUTH_UNAVAILABLE');
    assert.strictEqual(db.recorded.runs, 1, 'single write when recording a fresh auth-unavailable');
    const args = db.recorded.argses[0];
    assert.strictEqual(args[0], null, 'last_push_at is null as requested');
    assert.ok(
        String(args[1]).includes('تعذّر الحصول على جلسة سحابية'),
        `SYNC_AUTH_UNAVAILABLE translated to Arabic when persisted (got: ${args[1]})`
    );
    checks += 1;
}

// Non-undefined real errors still overwrite (the existing behavior — so a fresh
// PERMISSION_DENIED on a healthy cycle does replace a stale older error).
{
    const db = makeRecordingDb();
    recordPushMeta(db, '2026-03-23T10:00:00.000Z', 'something older');
    recordPushMeta(db, '2026-03-23T10:00:30.000Z', '7 PERMISSION_DENIED: Missing or insufficient permissions.');
    assert.strictEqual(db.recorded.runs, 2);
    assert.deepStrictEqual(
        db.recorded.argses[1],
        ['2026-03-23T10:00:30.000Z', classifyPushError('7 PERMISSION_DENIED: Missing or insufficient permissions.')],
        'a real new error string OVERWRITES the stale one (only undefined preserves)'
    );
    checks += 1;
}

// recordPushMeta still never throws when the underlying DB write fails (the
// existing fallback-log contract from Req 8.8 — preserved).
{
    const throwingDb = {
        prepare() {
            return { run() { throw new Error('disk I/O failure'); } };
        }
    };
    const originalError = console.error;
    console.error = (...args) => { void args; };
    let threw = false;
    try {
        recordPushMeta(throwingDb, '2026-03-23T10:00:00.000Z', 'SYNC_AUTH_UNAVAILABLE');
    } catch {
        threw = true;
    } finally {
        console.error = originalError;
    }
    assert.strictEqual(threw, false, 'recordPushMeta does not throw when persistence fails');
    checks += 1;
}

console.log(`[pass] classifyPushError + don't-clobber branch held across ${checks} assertions`);
