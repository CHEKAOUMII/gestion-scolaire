'use strict';

// node tests/import-center/import-center-phase-one.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ImportSession } = require('../../js/import-center/import-session.js');
const Classifier = require('../../js/import-center/import-classifier.js');
const Contracts = require('../../js/import-center/import-contracts.js');

const FIX = path.join(__dirname, '..', 'fixtures', 'import-center');
const pageJs = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'pages', 'settings-imports.js'), 'utf8');

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
    const session = ImportSession.create({ expectedYear: '2026-2027' });
    const batch = [
        fileFromDisk('students/valid-01.csv'),
        fileFromDisk('grades/valid-01.csv'),
        fileFromDisk('generic/data.csv'),
        fileFromDisk('fet/valid-01.xml')
    ];
    const items = session.addFiles(batch, { mode: 'drop' });
    assert.strictEqual(items.length, 4);

    for (const item of items) {
        const classification = await Classifier.classifyFile(item.file, {
            fileId: item.id,
            expectedYear: session.expectedYear
        });
        session.applyClassification(item.id, classification);
    }

    // Independent types
    const types = session.files.map((f) => f.detectedType);
    assert.ok(types.includes('students'));
    assert.ok(types.includes('grades'));
    assert.ok(types.includes('generic_csv_xlsx'));
    assert.ok(types.includes('fet'));

    // Evidence / confidence / alternatives / status
    for (const f of session.files) {
        assert.ok(f.status === 'needs_review' || f.status === 'failed');
        assert.ok(typeof f.confidence === 'number');
        assert.ok(Array.isArray(f.evidence));
        assert.ok(Array.isArray(f.alternatives) || f.detectedType === 'unknown');
    }

    // No write path in phase one
    assert.strictEqual(session.canExecute(), false);
    assert.strictEqual(Contracts.PHASE_ONE.writesAllowed, false);

    // Manual handlers remain in page
    for (const fn of ['runImport', 'handleImport', 'importStudents']) {
        assert.ok(pageJs.includes(`function ${fn}`) || pageJs.includes(`async function ${fn}`));
    }

    // Smart preview/review flow removed from the page — modules still enforce phase-one contract
    assert.ok(!pageJs.includes('initSmartImportCenter'), 'smart bootstrap removed from page');
    // Session canExecute still requires confirmation snapshot (orchestrator gate)
    assert.strictEqual(session.canExecute(), false);

    console.log('import-center-phase-one: OK');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
