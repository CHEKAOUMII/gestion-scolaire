'use strict';

// node tests/import-center/package-2-properties.test.js
// Properties 2–6, 11–12, 23

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const fc = require('fast-check');
const { ImportSession } = require('../../js/import-center/import-session.js');
const Classifier = require('../../js/import-center/import-classifier.js');
const Contracts = require('../../js/import-center/import-contracts.js');
const Query = require('../../js/import-center/import-query-context.js');

const FIX = path.join(__dirname, '..', 'fixtures', 'import-center');
const pageJs = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'pages', 'settings-imports.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'settings-imports.html'), 'utf8');

function fileFromDisk(rel, nameOverride) {
    const content = fs.readFileSync(path.join(FIX, rel), 'utf8');
    return {
        name: nameOverride || path.basename(rel),
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

const SAMPLE_RELS = [
    'students/valid-01.csv',
    'grades/valid-01.csv',
    'absences/valid-01.csv',
    'fet/valid-01.xml',
    'agent_xml/valid-01.xml',
    'generic/data.csv',
    'students/empty.csv'
];

// Property 2 — independent ordered session items
fc.assert(
    fc.property(fc.array(fc.constantFrom(...SAMPLE_RELS), { minLength: 1, maxLength: 5 }), (rels) => {
        const session = ImportSession.create();
        const files = rels.map((r, i) => fileFromDisk(r, `f${i}-${path.basename(r)}`));
        const created = session.addFiles(files);
        assert.strictEqual(created.length, files.length);
        for (let i = 0; i < files.length; i++) {
            assert.strictEqual(session.files[i].name, files[i].name);
            assert.ok(session.files[i].id);
            assert.ok(session.files[i].status);
            assert.ok('analysis' in session.files[i] || session.files[i].analysis === null);
            assert.ok('preflight' in session.files[i]);
        }
        // No shared batch type decision field
        assert.strictEqual(session.batchType, undefined);
        return true;
    }),
    { numRuns: 25 }
);

// Property 3 — renderer-memory-only
{
    const session = ImportSession.create();
    session.addFiles([fileFromDisk('students/valid-01.csv')]);
    const json = session.toJSON();
    ImportSession.assertNoDurablePersistence(json);
    assert.strictEqual(json.durable, false);
    assert.ok(!fs.existsSync(path.join(__dirname, '..', '..', 'main', 'db', 'import-jobs.js')));
    assert.ok(!pageJs.includes('import_jobs'));
    assert.ok(!pageJs.includes("localStorage.setItem('importSession'"));
}

// Property 4 — file-scoped read failure isolation
(async () => {
    const session = ImportSession.create();
    const files = [fileFromDisk('students/empty.csv'), fileFromDisk('students/valid-01.csv')];
    const items = session.addFiles(files);
    for (const item of items) {
        const c = await Classifier.classifyFile(item.file, { fileId: item.id });
        session.applyClassification(item.id, c);
    }
    assert.ok(session.files[0].status === 'failed' || session.files[0].status === 'needs_review');
    assert.ok(session.files[1].detectedType === 'students' || session.files[1].status === 'needs_review');
    // other item still present
    assert.strictEqual(session.files.length, 2);

    // Property 5 — independent bounded content classification
    const mixed = [
        fileFromDisk('students/valid-01.csv'),
        fileFromDisk('grades/valid-01.csv'),
        fileFromDisk('fet/valid-01.xml')
    ];
    const results = await Classifier.classifyBatch(mixed);
    assert.strictEqual(results.length, 3);
    assert.notStrictEqual(results[0].type, results[1].type);
    for (const r of results) {
        assert.ok(r.type);
        assert.ok(typeof r.confidence === 'number');
        assert.ok(Array.isArray(r.evidence));
        assert.ok(Array.isArray(r.alternatives));
        assert.ok(r.metadata);
        assert.ok(typeof r.needsReview === 'boolean');
    }

    // Property 6 — content precedence and generic fallback
    const misleadingName = fileFromDisk('students/valid-01.csv', 'notes-grades.csv');
    const rMis = await Classifier.classifyFile(misleadingName, {
        legacyActionHint: 'grades',
        typeHint: 'grades'
    });
    assert.strictEqual(rMis.type, 'students');

    const gen = await Classifier.classifyFile(fileFromDisk('generic/file1.csv', 'students.csv'), {
        legacyActionHint: 'students'
    });
    assert.strictEqual(gen.type, 'generic_csv_xlsx');

    // Property 11 — explicit review and confirmation firewall
    const s2 = ImportSession.create();
    s2.addFiles([fileFromDisk('students/valid-01.csv')]);
    const cls = await Classifier.classifyFile(s2.files[0].file);
    s2.applyClassification(s2.files[0].id, cls);
    assert.notStrictEqual(s2.files[0].status, 'importing');
    assert.strictEqual(s2.canExecute(), false);
    // contextual nav does not execute
    const q = Query.parseQueryContext('type=grades');
    assert.strictEqual(q.autoExecute, false);
    // confirmation freezes only ready set — phase one has no ready from classification alone
    const conf = s2.confirmReadySet();
    assert.strictEqual(conf.confirmed, false);

    // Property 12 — review required for risky items
    const riskyReasons = ['low_confidence', 'ambiguous_top_two', 'year_mismatch', 'generic_destination_required'];
    const low = Classifier.classifyFeatures(
        {
            format: 'csv',
            headers: ['foo', 'bar'],
            filename: 'x.csv',
            extension: 'csv'
        },
        { expectedYear: '2026-2027' }
    );
    assert.ok(low.needsReview);
    assert.ok(low.reviewReasons.length || low.type === 'generic_csv_xlsx' || low.type === 'unknown');

    const yearConflict = Classifier.classifyFeatures(
        {
            format: 'csv',
            headers: ['رمز مسار', 'الاسم', 'القسم', 'السنة الدراسية'],
            filename: 's.csv',
            extension: 'csv',
            detectedYear: '2024-2025'
        },
        { expectedYear: '2026-2027' }
    );
    // may be students or generic depending on headers
    if (yearConflict.metadata && yearConflict.diagnostics) {
        /* diagnostics optional when year on features */
    }
    assert.ok(yearConflict.needsReview);

    // Property 23 — phase-one package boundary (historical packages 0–2 contracts remain)
    assert.deepStrictEqual(Contracts.PHASE_ONE.packages.slice(), [0, 1, 2]);
    assert.strictEqual(Contracts.PHASE_ONE.writesAllowed, false);
    assert.ok(pageJs.includes('function runImport'));
    assert.ok(pageJs.includes('function handleImport') || pageJs.includes('async function handleImport'));
    assert.ok(!pageJs.includes('import_jobs'));
    // Smart preview/review UI removed from the page; module contracts still hold
    assert.ok(!html.includes('ic-queue-region'));
    assert.ok(fs.existsSync(path.join(__dirname, '..', '..', 'js', 'import-center', 'import-classifier.js')));
    // Later packages may add orchestrator; phase-one invariants still hold for contracts module

    // Silence unused
    assert.ok(riskyReasons.length);

    console.log('package-2-properties: OK');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
