'use strict';

// node tests/import-center/import-session.test.js

const assert = require('assert');
const { ImportSession } = require('../../js/import-center/import-session.js');

const session = ImportSession.create({ expectedYear: '2026-2027' });
assert.ok(session.id);
assert.strictEqual(session.status, 'collecting');

const files = [
    { name: 'a.csv', size: 10 },
    { name: 'b.xml', size: 20 },
    { name: 'c.csv', size: 0 }
];
const created = session.addFiles(files, { mode: 'drop' });
assert.strictEqual(created.length, 3);
assert.strictEqual(session.files.length, 3);
assert.strictEqual(session.files[0].name, 'a.csv');
assert.strictEqual(session.files[1].name, 'b.xml');
assert.strictEqual(session.files[2].name, 'c.csv');
assert.ok(session.files.every((f) => f.id && f.status === 'queued'));
assert.ok(session.files.every((f) => f.file));

// Independent mutation
const id0 = session.files[0].id;
const id1 = session.files[1].id;
session.skipFile(id0);
assert.strictEqual(session.getFile(id0).status, 'skipped');
assert.strictEqual(session.getFile(id1).status, 'queued');

session.applyClassification(id1, {
    type: 'students',
    confidence: 0.9,
    evidence: [{ kind: 'header', label: 'x', detail: 'y', strength: 'primary', source: 'content' }],
    alternatives: [],
    metadata: { extension: 'csv', format: 'csv', sheetNames: [], detectedYear: '2026-2027', detectedTerm: null, recordEstimate: 2 },
    needsReview: true,
    reviewReasons: ['explicit_review_required'],
    error: false
});
assert.strictEqual(session.getFile(id1).status, 'needs_review');
assert.strictEqual(session.getFile(id0).status, 'skipped');

// Decision invalidation
const before = session.getFile(id1).decisionVersion;
session.setDecision(id1, { selectedType: 'grades' });
assert.ok(session.getFile(id1).decisionVersion > before);
assert.strictEqual(session.getFile(id1).preflight, null);

// Serialization without File
const json = session.toJSON();
ImportSession.assertNoDurablePersistence(json);
assert.ok(!json.files.some((f) => f.file));
assert.strictEqual(json.durable, false);

// No restore path
assert.strictEqual(typeof ImportSession.restore, 'undefined');

// confirmReadySet does not execute
assert.strictEqual(session.canExecute(), false);
const conf = session.confirmReadySet();
assert.strictEqual(conf.confirmed, false); // no ready items in phase one path

console.log('import-session: OK');
