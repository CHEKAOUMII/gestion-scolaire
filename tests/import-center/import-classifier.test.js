'use strict';

// node tests/import-center/import-classifier.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Classifier = require('../../js/import-center/import-classifier.js');
const Contracts = require('../../js/import-center/import-contracts.js');

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
    const students = await Classifier.classifyFile(fileFromDisk('students/valid-01.csv'));
    assert.strictEqual(students.type, 'students');
    assert.ok(students.confidence >= Contracts.CONFIDENCE.MEDIUM);
    assert.ok(students.evidence.some((e) => e.source === 'content'));
    assert.strictEqual(students.needsReview, true); // phase one always review before write

    const grades = await Classifier.classifyFile(fileFromDisk('grades/valid-01.csv'));
    assert.strictEqual(grades.type, 'grades');

    const absences = await Classifier.classifyFile(fileFromDisk('absences/valid-01.csv'));
    assert.strictEqual(absences.type, 'absences');

    const fet = await Classifier.classifyFile(fileFromDisk('fet/valid-01.xml'));
    assert.strictEqual(fet.type, 'fet');

    const agent = await Classifier.classifyFile(fileFromDisk('agent_xml/valid-01.xml'));
    assert.strictEqual(agent.type, 'agent_xml');

    const generic = await Classifier.classifyFile(fileFromDisk('generic/data.csv'));
    assert.strictEqual(generic.type, 'generic_csv_xlsx');
    assert.ok(generic.needsReview);

    const unknownXml = await Classifier.classifyFile(fileFromDisk('fet/unknown-root.xml'));
    assert.ok(unknownXml.type === 'unknown' || unknownXml.needsReview);

    // Mixed batch independent
    const batch = await Classifier.classifyBatch([
        fileFromDisk('students/valid-01.csv'),
        fileFromDisk('grades/valid-01.csv'),
        fileFromDisk('fet/valid-01.xml')
    ]);
    assert.strictEqual(batch.length, 3);
    assert.strictEqual(batch[0].type, 'students');
    assert.strictEqual(batch[1].type, 'grades');
    assert.strictEqual(batch[2].type, 'fet');

    // Content wins over misleading filename
    const misleading = {
        name: 'grades.xlsx',
        size: 100,
        content: fs.readFileSync(path.join(FIX, 'students/valid-01.csv'), 'utf8'),
        async text() {
            return this.content;
        },
        async arrayBuffer() {
            return Buffer.from(this.content, 'utf8');
        }
    };
    // force csv via content
    misleading.name = 'grades.csv';
    const mis = await Classifier.classifyFile(misleading, { legacyActionHint: 'grades' });
    assert.strictEqual(mis.type, 'students');

    // Empty isolated
    const empty = await Classifier.classifyFile(fileFromDisk('students/empty.csv'));
    assert.ok(empty.error || empty.type === 'unknown');

    console.log('import-classifier: OK');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
