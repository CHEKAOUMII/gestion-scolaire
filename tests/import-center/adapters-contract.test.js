'use strict';

// node tests/import-center/adapters-contract.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const Adapters = require('../../js/import-center/adapters/index.js');
const pageJs = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'pages', 'settings-imports.js'), 'utf8');

assert.ok(Adapters.contractOk(), 'all adapters must satisfy contract');

const types = ['students', 'grades', 'absences', 'fet', 'agent_xml', 'student_status'];
for (const type of types) {
    const a = Adapters.getAdapter(type);
    assert.ok(a, `adapter ${type}`);
    assert.strictEqual(a.type, type);
    assert.strictEqual(typeof a.canAnalyze, 'function');
    assert.strictEqual(typeof a.analyze, 'function');
    assert.strictEqual(typeof a.execute, 'function');
    assert.ok(a.manualFunctionName, `manual wrapper name for ${type}`);
    assert.strictEqual(Adapters.MANUAL_FUNCTION_MAP[type], a.manualFunctionName);
}

// Manual functions remain in page
for (const fn of Object.values(Adapters.MANUAL_FUNCTION_MAP)) {
    assert.ok(new RegExp(`function\\s+${fn}\\b`).test(pageJs), `manual ${fn} still callable`);
}

// execute is guarded — no silent import
(async () => {
    const students = Adapters.getAdapter('students');
    let threw = false;
    try {
        await students.execute({ type: 'students', preflight: { valid: true } }, {});
    } catch (e) {
        threw = true;
        assert.ok(/EXECUTE_GUARDED/.test(e.message), e.message);
    }
    assert.ok(threw, 'execute without allowExecute must throw');

    // analyze must not write
    const FIX = path.join(__dirname, '..', 'fixtures', 'import-center');
    const content = fs.readFileSync(path.join(FIX, 'students', 'valid-01.csv'), 'utf8');
    const file = {
        name: 'valid-01.csv',
        size: Buffer.byteLength(content),
        content,
        async text() {
            return content;
        },
        async arrayBuffer() {
            return Buffer.from(content, 'utf8');
        }
    };
    const writeAttempts = [];
    const prepared = await students.analyze(file, {
        fileId: 't1',
        decisionVersion: 0,
        writeAttempts,
        onWriteAttempt: (d) => writeAttempts.push(d)
    });
    assert.ok(prepared.preflight);
    assert.strictEqual(prepared.readOnly, true);
    assert.ok(prepared.executionPayload == null || prepared.executionPayload.notPersisted === true);
    assert.strictEqual(writeAttempts.length, 0, 'analyze must not record writes');

    console.log('adapters-contract: OK');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
