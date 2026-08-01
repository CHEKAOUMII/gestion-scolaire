'use strict';

// node tests/import-center/import-orchestrator-report.test.js

const assert = require('assert');
const Orch = require('../../js/import-center/import-orchestrator.js');
const { ImportSession } = require('../../js/import-center/import-session.js');

function ready(session, name, type) {
    const [item] = session.addFiles([{ name, size: 1 }]);
    item.status = 'ready';
    item.selectedType = type;
    item.detectedType = type;
    item.dependencies = [];
    item.preflight = { valid: true, executable: true, decisionVersion: 0, selectedType: type, recordEstimate: 3 };
    item._prepared = {
        type,
        preflight: item.preflight,
        executionPayload: { rows: [{}, {}, {}], notPersisted: true },
        sourceFileId: item.id
    };
    return item;
}

(async () => {
    const session = ImportSession.create();
    ready(session, 'a.csv', 'students');
    ready(session, 'b.csv', 'agent_xml');
    session.confirmReadySet();

    const progressEvents = [];
    const t0 = Date.now();
    const report = await Orch.runConfirmed(session, {
        simulateDelay: 40,
        executeImpl: async (prepared) => ({
            status: 'succeeded',
            recordsWritten: (prepared.executionPayload.rows || []).length,
            recordsRejected: 0
        }),
        onProgress: (ev) => progressEvents.push(ev)
    });
    const elapsed = Date.now() - t0;

    assert.ok(progressEvents.length >= 1, 'progress events emitted');
    assert.ok(session.status === 'completed');
    assert.ok(session.report);
    assert.strictEqual(report.totals.succeeded, 2);
    assert.strictEqual(
        report.totals.recordsWritten,
        report.files.reduce((s, f) => s + (f.recordsWritten || 0), 0)
    );
    // totals equal item outcomes
    assert.strictEqual(
        report.totals.succeeded,
        report.files.filter((f) => f.status === 'succeeded').length
    );

    // Each file has phase outcome
    for (const f of session.files) {
        assert.ok(f.status === 'succeeded');
        assert.ok(f.result);
        assert.ok(f.progress);
        assert.ok(f.progress.phase === 'complete' || f.progress.percent === 100);
    }

    // Progress path supports multi-step ops (delay used)
    assert.ok(elapsed >= 30 || progressEvents.length >= 2);

    // Duplicate start rejected
    let dup = false;
    session.status = 'importing';
    try {
        await Orch.runConfirmed(session, { executeImpl: async () => ({ status: 'succeeded' }) });
    } catch (e) {
        dup = /ALREADY_RUNNING/.test(e.message);
    }
    assert.ok(dup);

    console.log('import-orchestrator-report: OK');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
