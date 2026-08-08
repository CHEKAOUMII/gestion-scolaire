'use strict';

// node tests/import-center/signature-manifest.test.js

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// import-contracts.js was deleted in the Phase 3 harvest; import-type-check.js
// is now the stand-alone home of SIGNATURES/scoreSignature and the constants
// the manifest asserts against.
const Signatures = require('../../js/import-center/import-type-check.js');

const cal = Signatures.getCalibration();
assert.strictEqual(cal.high, 0.85);
assert.strictEqual(cal.medium, 0.6);
assert.strictEqual(cal.ambiguityGap, 0.1);
assert.strictEqual(cal.contentPrimary, true);
assert.strictEqual(cal.filenameOnlyCannotAutoFinalize, true);

const list = Signatures.listSignatures();
const types = list.map((s) => s.type);
for (const t of Signatures.REGISTERED_SOURCE_TYPES) {
    assert.ok(types.includes(t), `missing signature for registered type ${t}`);
}
assert.ok(types.includes('generic_csv_xlsx'), 'missing generic signature');

// Filename-only cannot reach HIGH
const students = Signatures.getSignature('students');
const filenameOnly = Signatures.scoreSignature(students, {
    format: 'csv',
    headers: [],
    filename: 'students-list.csv',
    extension: 'csv',
    contextTypeHint: null
});
assert.ok(
    filenameOnly.score < Signatures.CONFIDENCE.HIGH,
    `filename-only score ${filenameOnly.score} must be < HIGH`
);

// Content headers produce stronger score
const withContent = Signatures.scoreSignature(students, {
    format: 'csv',
    headers: ['رمز مسار', 'الاسم', 'النسب', 'القسم'],
    filename: 'file1.csv',
    extension: 'csv'
});
assert.ok(withContent.score > filenameOnly.score, 'content must outrank filename-only');
assert.ok(
    withContent.evidence.some((e) => e.source === 'content' && e.strength === 'primary'),
    'content primary evidence required'
);

// FET root
const fet = Signatures.getSignature('fet');
const fetScore = Signatures.scoreSignature(fet, {
    format: 'xml',
    xmlRoot: 'Teachers_Timetable',
    xmlElements: ['Teacher', 'Day', 'Hour', 'Subject'],
    filename: 'x.xml',
    extension: 'xml'
});
assert.ok(fetScore.score >= Signatures.CONFIDENCE.HIGH, 'FET content should be high confidence');

// Agent
const agent = Signatures.getSignature('agent_xml');
const agentScore = Signatures.scoreSignature(agent, {
    format: 'xml',
    xmlRoot: 'DsAgentExport',
    xmlElements: ['AGENT', 'ACTIVITE', 'PPR'],
    filename: '14007Z_20260309.xml',
    extension: 'xml'
});
assert.ok(agentScore.score >= Signatures.CONFIDENCE.MEDIUM, 'agent content should score well');

// Docs exist
const sigDoc = path.join(__dirname, '..', '..', 'docs', 'import-center', 'signatures.md');
assert.ok(fs.existsSync(sigDoc), 'signatures.md must exist');
const body = fs.readFileSync(sigDoc, 'utf8');
assert.ok(body.includes('0.85') && body.includes('0.60'), 'thresholds documented');

console.log('signature-manifest: OK');
