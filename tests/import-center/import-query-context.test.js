'use strict';

// node tests/import-center/import-query-context.test.js

const assert = require('assert');
const Query = require('../../js/import-center/import-query-context.js');
const { ImportSession } = require('../../js/import-center/import-session.js');

const q1 = Query.parseQueryContext('type=grades&year=2026-2027&source=grades.html');
assert.strictEqual(q1.typeHint, 'grades');
assert.strictEqual(q1.yearHint, '2026-2027');
assert.strictEqual(q1.sourcePage, 'grades.html');
assert.strictEqual(q1.autoExecute, false);
assert.strictEqual(q1.isHintOnly, true);

const q2 = Query.parseQueryContext('?type=agent-xml');
assert.strictEqual(q2.typeHint, 'agent_xml');

const q3 = Query.parseQueryContext({ type: 'student-status', year: '2025-2026' });
assert.strictEqual(q3.typeHint, 'student_status');

const session = ImportSession.create({
    expectedYear: q1.yearHint,
    sourceContext: Query.toSourceContext(q1)
});
assert.strictEqual(session.sourceContext.typeHint, 'grades');
assert.strictEqual(session.sourceContext.mode, 'contextual_shortcut');

// Decision invalidation
const [item] = session.addFiles([{ name: 'x.csv', size: 1 }]);
session.applyClassification(item.id, {
    type: 'grades',
    confidence: 0.9,
    evidence: [],
    alternatives: [],
    metadata: { extension: 'csv', format: 'csv', sheetNames: [], detectedYear: null, detectedTerm: null, recordEstimate: 1 },
    needsReview: true,
    reviewReasons: [],
    error: false
});
const v0 = session.getFile(item.id).decisionVersion;
session.setDecision(item.id, { selectedType: 'students' });
assert.ok(session.getFile(item.id).decisionVersion > v0);
assert.strictEqual(session.getFile(item.id).preflight, null);

assert.strictEqual(Query.AUTO_EXECUTE, false);
assert.ok(Query.shouldInvalidateDecision({ selectedType: 'a' }, { selectedType: 'b' }));

console.log('import-query-context: OK');
