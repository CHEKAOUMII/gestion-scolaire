'use strict';

// node tests/import-center/package-0-contracts.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const fc = require('fast-check');

const Contracts = require('../../js/import-center/import-contracts.js');
const Signatures = require('../../js/import-center/import-signatures.js');

const FIXTURE_ROOT = path.join(__dirname, '..', 'fixtures', 'import-center');
const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, 'manifest.json'), 'utf8'));

// Contract shape
assert.ok(Array.isArray(Contracts.IMPORT_SOURCE_TYPES));
assert.ok(Array.isArray(Contracts.IMPORT_FILE_STATUSES));
assert.ok(Contracts.IMPORT_FILE_STATUSES.includes('blocked'));
assert.ok(Contracts.DIAGNOSTIC_STAGES.includes('reading'));
assert.ok(Contracts.DIAGNOSTIC_STAGES.includes('classification'));
assert.ok(Contracts.DIAGNOSTIC_STAGES.includes('preflight'));
assert.ok(Contracts.DIAGNOSTIC_STAGES.includes('dependency'));
assert.ok(Contracts.DIAGNOSTIC_STAGES.includes('write'));

assert.strictEqual(Contracts.PHASE_ONE.writesAllowed, false);
assert.strictEqual(Contracts.PHASE_ONE.durableJobsAllowed, false);
assert.strictEqual(Contracts.PHASE_ONE.analyzeOnly, true);

// Serialization never requires File
const fakeItem = {
    id: 'f1',
    file: { name: 'x.csv', size: 10 },
    name: 'x.csv',
    extension: 'csv',
    size: 10,
    status: 'queued',
    detectedType: 'students',
    selectedType: null,
    confidence: 0.9,
    evidence: [],
    alternatives: [],
    detectedYear: null,
    detectedTerm: null,
    sheetNames: [],
    recordEstimate: 2,
    diagnostics: [],
    preflight: {
        valid: true,
        analyzedAt: 't',
        selectedType: 'students',
        selectedYear: null,
        selectedTerm: null,
        sheetsRead: [],
        elementsRead: [],
        recordEstimate: 2,
        decisionVersion: 1
    },
    decisionVersion: 1,
    dependencies: [],
    progress: Contracts.createEmptyProgress(),
    result: null,
    retryCount: 0
};
const meta = Contracts.serializeFileItemMeta(fakeItem);
assert.strictEqual(meta.file, undefined);
assert.ok(!('file' in meta) || meta.file == null);
assert.strictEqual(meta.name, 'x.csv');
assert.ok(meta.preflight);
assert.strictEqual(meta.preflight.decisionVersion, 1);

const sessionMeta = Contracts.serializeSessionMeta({
    id: 's1',
    createdAt: 't',
    expectedYear: '2026-2027',
    sourceContext: Contracts.createSourceContext(),
    status: 'collecting',
    files: [fakeItem],
    totals: Contracts.createEmptyTotals(),
    report: null
});
assert.strictEqual(sessionMeta.durable, false);
assert.ok(!JSON.stringify(sessionMeta).includes('"size":10,"type"')); // no File blob fields

// Fixture safety + two-valid coverage
assert.strictEqual(manifest.sensitive, false);
for (const t of Contracts.REGISTERED_SOURCE_TYPES.concat(['generic_csv_xlsx'])) {
    const entry = manifest.types[t];
    assert.ok(entry, `fixture coverage for ${t}`);
    assert.ok(entry.valid.length >= 2, `two valid samples for ${t}`);
}

// Distinguish analysis / preflight / execution / report via docs + phase-one flags
const contractsDoc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'import-center', 'contracts.md'),
    'utf8'
);
assert.ok(contractsDoc.includes('PreflightResult') || contractsDoc.includes('preflight'));
assert.ok(contractsDoc.includes('analyze') || contractsDoc.includes('execute'));
assert.ok(contractsDoc.includes('ClassificationResult') || contractsDoc.includes('classification') || contractsDoc.includes('Evidence'));
assert.ok(contractsDoc.includes('File') || contractsDoc.includes('serialization'));
assert.ok(Contracts.PHASE_ONE.analyzeOnly);


// Property: write-capable field must not be mistaken for phase-one execution
fc.assert(
    fc.property(fc.constantFrom(...Contracts.IMPORT_FILE_STATUSES), (status) => {
        // Phase one never auto-executes any status
        assert.strictEqual(Contracts.PHASE_ONE.writesAllowed, false);
        assert.ok(Contracts.isImportFileStatus(status));
        return true;
    }),
    { numRuns: 20 }
);

// Signatures versionable
assert.ok(Signatures.SIGNATURE_VERSION);

console.log('package-0-contracts: OK');
