'use strict';

// node tests/import-center/import-readers.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Readers = require('../../js/import-center/import-readers.js');

const FIX = path.join(__dirname, '..', 'fixtures', 'import-center');

function fileFromDisk(rel, name) {
    const content = fs.readFileSync(path.join(FIX, rel), 'utf8');
    return {
        name: name || path.basename(rel),
        size: Buffer.byteLength(content, 'utf8'),
        type: rel.endsWith('.xml') ? 'text/xml' : 'text/csv',
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
    const students = await Readers.extractFeatures(fileFromDisk('students/valid-01.csv'));
    assert.strictEqual(students.format, 'csv');
    assert.ok(students.headers.length >= 3);
    assert.ok(students.recordEstimate >= 1);
    assert.ok(!students.error);

    const empty = await Readers.extractFeatures(fileFromDisk('students/empty.csv'));
    assert.ok(empty.empty || empty.error === 'empty_file');

    const fet = await Readers.extractFeatures(fileFromDisk('fet/valid-01.xml'));
    assert.strictEqual(fet.format, 'xml');
    assert.strictEqual(fet.xmlRoot, 'Teachers_Timetable');
    assert.ok(fet.xmlElements.includes('Teacher'));

    const agent = await Readers.extractFeatures(fileFromDisk('agent_xml/valid-01.xml'));
    assert.strictEqual(agent.xmlRoot, 'DsAgentExport');

    const generic = await Readers.extractFeatures(fileFromDisk('generic/data.csv'));
    assert.ok(generic.headers.includes('item') || generic.headers.some((h) => /item/i.test(h)));

    // Isolation: empty does not throw for batch caller
    const results = await Promise.all([
        Readers.extractFeatures(fileFromDisk('students/empty.csv')),
        Readers.extractFeatures(fileFromDisk('students/valid-01.csv'))
    ]);
    assert.ok(results[0].error || results[0].empty);
    assert.ok(!results[1].error);

    // CSV parse unit
    const parsed = Readers.parseCsvText('a,b\n1,2\n3,4\n');
    assert.deepStrictEqual(parsed.headers, ['a', 'b']);
    assert.strictEqual(parsed.recordEstimate, 2);

    console.log('import-readers: OK');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
