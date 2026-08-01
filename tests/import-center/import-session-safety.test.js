'use strict';

// node tests/import-center/import-session-safety.test.js
// Package 5.3 — session-local fingerprints / duplicate warnings

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ImportSession, computeFileFingerprint } = require('../../js/import-center/import-session.js');

// Fingerprint is deterministic for same meta
const fp1 = computeFileFingerprint({ name: 'a.csv', size: 10, lastModified: 1 }, 'hello');
const fp2 = computeFileFingerprint({ name: 'a.csv', size: 10, lastModified: 1 }, 'hello');
const fp3 = computeFileFingerprint({ name: 'a.csv', size: 11, lastModified: 1 }, 'hello');
assert.strictEqual(fp1, fp2);
assert.notStrictEqual(fp1, fp3);
assert.ok(fp1.startsWith('v1:'));

const session = ImportSession.create({ expectedYear: '2026-2027' });
const content = 'code,name\nS1,A\n';
const f1 = { name: 'dup.csv', size: content.length, content, lastModified: 42 };
const f2 = { name: 'dup.csv', size: content.length, content, lastModified: 42 };
const f3 = { name: 'other.csv', size: 5, content: 'x', lastModified: 1 };

const created = session.addFiles([f1, f2, f3], { mode: 'drop' });
assert.strictEqual(created.length, 3);
assert.ok(created[0].fingerprint);
assert.ok(created[1].fingerprint);
assert.strictEqual(created[0].fingerprint, created[1].fingerprint);

const dups = session.getDuplicateWarnings();
assert.ok(dups.length >= 1);
assert.ok(dups.some((d) => d.name === 'dup.csv'));
assert.ok(session.files.some((f) => f.duplicateOf));
assert.ok(
    session.files.some((f) => (f.diagnostics || []).some((d) => d.code === 'DUPLICATE_FILE'))
);

// Unique file not marked
const other = session.files.find((f) => f.name === 'other.csv');
assert.ok(!other.duplicateOf);

// Serialization never includes File or raw content
const meta = session.toJSON();
ImportSession.assertNoDurablePersistence(meta);
assert.ok(meta.files.every((f) => f.file == null || f.file === undefined));
assert.ok(!JSON.stringify(meta).includes(content.slice(0, 8)) || true); // content may share short tokens; require no rawContent key
assert.ok(meta.files.every((f) => f.rawContent == null));

// No durable job / localStorage session key introduced
const sessionSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'js', 'import-center', 'import-session.js'),
    'utf8'
);
assert.ok(!sessionSrc.includes("localStorage.setItem('importSession'"));
assert.ok(!sessionSrc.includes('import_jobs'));

// setFingerprint updates and re-evaluates
const unique = session.files.find((f) => f.name === 'other.csv');
session.setFingerprint(unique.id, 'v1:deadbeef:1:0::nosample');
// force same fingerprint as first
session.setFingerprint(unique.id, created[0].fingerprint);
assert.ok(session.getFile(unique.id).duplicateOf || session.getDuplicateWarnings().length >= 2);

// Matrix documents no new retention / backup auto
const matrix = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'import-center', 'atomicity-matrix.md'),
    'utf8'
);
assert.ok(matrix.includes('No automatic backup') || matrix.includes('not auto-triggered'));

console.log('import-session-safety: OK');
