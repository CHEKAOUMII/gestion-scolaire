'use strict';

// node tests/import-center/import-readers.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Readers = require('../../js/import-center/import-readers.js');

const FIX = path.join(__dirname, '..', 'fixtures', 'import-center');

function fileFromXmlText(content, name) {
    return {
        name: name || 'synthetic.xml',
        size: Buffer.byteLength(content, 'utf8'),
        type: 'text/xml',
        content,
        async text() {
            return content;
        },
        async arrayBuffer() {
            return Buffer.from(content, 'utf8');
        }
    };
}
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


    // ── T1.5: required XML elements tracked beyond the capped distinct-names set ──
    // Case A: 45 distinct element names, DATAIDENTIFPERSONNEL LAST → still detected
    const manyNames = [];
    for (let i = 1; i <= 45; i += 1) manyNames.push(`R${i}`);
    manyNames.push('DATAIDENTIFPERSONNEL');
    const body = manyNames.map((n) => `<${n}/>`).join('');
    const bigAgent = fileFromXmlText(`<DsAgentExport>${body}</DsAgentExport>`);
    const bigAgentFeatures = await Readers.extractFeatures(bigAgent);
    assert.strictEqual(bigAgentFeatures.xmlRoot, 'DsAgentExport');
    assert.ok(
        bigAgentFeatures.xmlElements.includes('DATAIDENTIFPERSONNEL'),
        'case A: required element must survive the 40-name distinct cap'
    );

    // Case B: text beyond MAX_TEXT_BYTES surfaces truncated:true
    const MAX_TEXT_BYTES = 512 * 1024;
    const oversized = `<DsAgentExport><A/>` + 'x'.repeat(MAX_TEXT_BYTES + 1024) + `</DsAgentExport>`;
    const truncated = await Readers.extractFeatures(
        fileFromXmlText(oversized, 'oversized.xml')
    );
    assert.strictEqual(truncated.truncated, true, 'case B: truncation must be surfaced');
    assert.ok(truncated.truncatedAt >= MAX_TEXT_BYTES);

    // Case C: small valid FET file stays unchanged
    // (covered above by fet/valid-01.xml assertion)

    console.log('import-readers: OK');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
