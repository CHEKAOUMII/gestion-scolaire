'use strict';

// Base C11: shared log-file-io helpers
//
//   node tests/log-file-io-unit.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const logIo = require('../main/diagnostics/log-file-io');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'logio-'));
const logPath = path.join(tmp, 't.log');

assert.ok(logIo.safeParse('{"a":1}').a === 1);
assert.strictEqual(logIo.safeParse('nope'), null);
assert.strictEqual(logIo.truncate('abcdef', 3), 'abc…[+3]');
assert.strictEqual(logIo.stripSensitive({ password_hash: 'x', keep: 1 }, ['password_hash']).keep, 1);
assert.strictEqual(logIo.stripSensitive({ password_hash: 'x' }, ['password_hash']).password_hash, undefined);

assert.ok(logIo.appendJsonl(logPath, { n: 1 }));
assert.ok(fs.existsSync(logPath));
assert.ok(logIo.appendJsonl(logPath, { n: 2 }));
const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
assert.strictEqual(lines.length, 2);

// Consumers require shared module
for (const rel of ['main/diagnostics/error-log.js', 'main/sync/conflict-forensics.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(/log-file-io/.test(src), rel + ' must use log-file-io');
}

console.log('log-file-io-unit: OK');
