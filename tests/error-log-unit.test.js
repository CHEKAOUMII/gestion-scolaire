'use strict';

// Feature: app-errors.log — persistent, all-users, automatic error log
//
// Validates main/diagnostics/error-log.js:
//   1. No file yet → readRecentErrors reports available:false (no throw)
//   2. logAppError writes a JSONL line; readRecentErrors returns it (newest-first)
//   3. Sensitive fields stripped from `extra`; other keys retained
//   4. Long message/stack truncated to configured caps
//   5. logAppError never throws — even on un-serializable (circular) extra
//   6. maxLines caps how many lines are returned
//
// Isolated: chdir into a fresh temp dir BEFORE requiring the module, so its
// cwd fallback (electron `app` unavailable in plain node) writes under tmp,
// never the repo. Cleaned up at the end.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'errlog-test-'));
process.chdir(tmpRoot);

const el = require('../main/diagnostics/error-log');

let passed = 0;
function check(label, cond) {
    assert.ok(cond, label);
    passed += 1;
}

try {
    // 1. No file yet
    const empty = el.readRecentErrors({ maxLines: 10 });
    check('empty: available=false before any write', empty.available === false);
    check('empty: entries is empty array', Array.isArray(empty.entries) && empty.entries.length === 0);

    // 2. Write + read back
    el.logAppError({ source: 'ipc', action: 'first:channel', message: 'first' });
    el.logAppError({ source: 'main', action: 'uncaughtException', message: 'second' });
    const after = el.readRecentErrors({ maxLines: 10 });
    check('write: available=true', after.available === true);
    check('write: total counts both lines', after.total === 2);
    check('write: newest-first ordering', after.entries[0].action === 'uncaughtException');
    check('write: source preserved', after.entries[0].source === 'main');

    // 3. Sensitive stripping on extra
    el.logAppError({
        source: 'ipc',
        action: 'sensitive:test',
        message: 'x',
        extra: { password_hash: 'SECRET', pin_hash: '0000', keep: 'yes' }
    });
    const sens = el.readRecentErrors({ maxLines: 10 }).entries.find((e) => e.action === 'sensitive:test');
    check('sensitive: password_hash removed', sens.extra.password_hash === undefined);
    check('sensitive: pin_hash removed', sens.extra.pin_hash === undefined);
    check('sensitive: non-sensitive key kept', sens.extra.keep === 'yes');

    // 4. Truncation
    el.logAppError({
        source: 'main',
        action: 'truncate:test',
        message: 'm'.repeat(5000),
        stack: 's'.repeat(20000)
    });
    const trunc = el.readRecentErrors({ maxLines: 10 }).entries.find((e) => e.action === 'truncate:test');
    check('truncate: message capped near MAX_MESSAGE_CHARS', trunc.message.length <= el.MAX_MESSAGE_CHARS + 40);
    check('truncate: stack capped near MAX_STACK_CHARS', trunc.stack.length <= el.MAX_STACK_CHARS + 40);

    // 5. Never throws on circular extra
    const circular = {};
    circular.self = circular;
    let threw = false;
    try {
        el.logAppError({ source: 'ipc', action: 'circular:test', message: 'c', extra: circular });
    } catch (_) {
        threw = true;
    }
    check('robust: logAppError does not throw on circular extra', threw === false);

    // 6. maxLines cap
    const capped = el.readRecentErrors({ maxLines: 2 });
    check('maxLines: returns at most 2 entries', capped.entries.length <= 2);

    console.log(`[error-log-unit] all ${passed} checks passed`);
} finally {
    // Cleanup temp dir
    try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (_) {
        /* best-effort cleanup */
    }
}
