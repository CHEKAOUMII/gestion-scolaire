'use strict';

// node tests/import-center/import-preflight.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Preflight = require('../../js/import-center/import-preflight.js');
const { ImportSession } = require('../../js/import-center/import-session.js');

const FIX = path.join(__dirname, '..', 'fixtures', 'import-center');

function fileFromDisk(rel) {
    const content = fs.readFileSync(path.join(FIX, rel), 'utf8');
    return {
        name: path.basename(rel),
        size: Buffer.byteLength(content, 'utf8'),
        content,
        async text() {
            return content;
        },
        async arrayBuffer() {
            return Buffer.from(content, 'utf8');
        }
    };
}

(async () => {
    // Year helpers
    assert.strictEqual(Preflight.detectSchoolYearFromText('year 2024-2025 end'), '2024-2025');
    const ym = Preflight.checkYearMismatchAnalysis('2024-2025', '2026-2027');
    assert.ok(ym.mismatch && ym.requiresDecision);
    const yok = Preflight.checkYearMismatchAnalysis('2026-2027', '2026-2027');
    assert.ok(!yok.mismatch);

    // Students preflight read-only
    const writeAttempts = [];
    const prepared = await Preflight.runPreflight({
        file: fileFromDisk('students/valid-01.csv'),
        selectedType: 'students',
        expectedYear: '2026-2027',
        decisionVersion: 0,
        fileId: 'f1',
        context: { writeAttempts }
    });
    assert.ok(prepared.preflight);
    assert.strictEqual(prepared.readOnly, true);
    assert.ok(Array.isArray(prepared.preflight.preview));
    assert.ok(prepared.preflight.preview.every((p) => p._previewOnly || p.written === false || p.written == null));
    assert.strictEqual(writeAttempts.length, 0);

    // Year mismatch forces decision
    const yearFile = fileFromDisk('students/year-mismatch.csv');
    const pYear = await Preflight.runPreflight({
        file: yearFile,
        selectedType: 'students',
        expectedYear: '2026-2027',
        decisionVersion: 0,
        fileId: 'f2',
        context: { writeAttempts: [] }
    });
    // if year detected from content
    if (pYear.preflight.yearDecisionRequired) {
        assert.strictEqual(pYear.preflight.executable, false);
        assert.ok((pYear.preflight.warnings || []).some((w) => w.code === 'YEAR_MISMATCH'));
    }

    // Generic requires destination
    const gen = await Preflight.runPreflight({
        file: fileFromDisk('generic/data.csv'),
        selectedType: 'generic_csv_xlsx',
        decisionVersion: 0,
        fileId: 'g1'
    });
    assert.strictEqual(gen.preflight.executable, false);
    assert.ok((gen.preflight.errors || []).some((e) => e.code === 'GENERIC_DESTINATION_REQUIRED'));

    // Decision invalidation
    const session = ImportSession.create({ expectedYear: '2026-2027' });
    const [item] = session.addFiles([fileFromDisk('students/valid-01.csv')]);
    session.applyClassification(item.id, {
        type: 'students',
        confidence: 0.9,
        evidence: [],
        alternatives: [],
        metadata: { extension: 'csv', format: 'csv', sheetNames: [], detectedYear: null, detectedTerm: null, recordEstimate: 2 },
        needsReview: true,
        reviewReasons: [],
        error: false
    });
    const prep = await Preflight.runPreflight({
        file: item.file,
        selectedType: 'students',
        expectedYear: '2026-2027',
        decisionVersion: item.decisionVersion,
        fileId: item.id
    });
    const applied = session.applyPreflight(item.id, prep);
    assert.ok(applied.applied);

    // Change type invalidates
    session.setDecision(item.id, { selectedType: 'grades' });
    assert.strictEqual(session.getFile(item.id).preflight, null);
    const stale = session.applyPreflight(item.id, prep); // old decisionVersion
    assert.strictEqual(stale.applied, false);
    assert.strictEqual(stale.reason, 'stale_decision_version');

    // FET preflight
    const fet = await Preflight.runPreflight({
        file: fileFromDisk('fet/valid-01.xml'),
        selectedType: 'fet',
        decisionVersion: 0,
        fileId: 'fet1'
    });
    assert.ok(fet.preflight.elementsRead.length || fet.preflight.valid);

    console.log('import-preflight: OK');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
