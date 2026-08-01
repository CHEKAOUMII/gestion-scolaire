'use strict';

// node tests/import-center/import-orchestrator-retry.test.js

const assert = require('assert');
const Orch = require('../../js/import-center/import-orchestrator.js');
const { ImportSession } = require('../../js/import-center/import-session.js');

function ready(session, name, type, deps) {
    const [item] = session.addFiles([{ name, size: 1 }]);
    item.status = 'ready';
    item.selectedType = type;
    item.detectedType = type;
    item.dependencies = deps || [];
    item.preflight = { valid: true, executable: true, decisionVersion: 0, selectedType: type };
    item._prepared = {
        type,
        preflight: item.preflight,
        executionPayload: { rows: [{ x: 1 }], notPersisted: true },
        sourceFileId: item.id
    };
    return item;
}

(async () => {
    const session = ImportSession.create();
    const a = ready(session, 'students.csv', 'students', []);
    const b = ready(session, 'grades.csv', 'grades', [
        { sourceType: 'students', reason: 'dep', required: true, satisfied: false }
    ]);
    const c = ready(session, 'other.csv', 'agent_xml', []); // unrelated

    const conf = session.confirmReadySet();
    assert.ok(conf.confirmed);

    let failOnce = true;
    const executed = [];
    const report = await Orch.runConfirmed(session, {
        executeImpl: async (prepared, ctx) => {
            executed.push(ctx.fileId);
            if (ctx.fileId === a.id && failOnce) {
                failOnce = false;
                throw new Error('students boom');
            }
            return { status: 'succeeded', recordsWritten: 1, recordsRejected: 0 };
        }
    });

    assert.strictEqual(session.getFile(a.id).status, 'failed');
    assert.strictEqual(session.getFile(b.id).status, 'blocked');
    assert.ok(
        (session.getFile(b.id).diagnostics || []).some((d) => d.code === 'BLOCKED_DEPENDENCY')
    );
    // Unrelated continues
    assert.strictEqual(session.getFile(c.id).status, 'succeeded');
    assert.ok(report.totals.failed >= 1);
    assert.ok(report.totals.blocked >= 1);
    assert.ok(report.totals.succeeded >= 1);

    // Retry failed only — successful c must not re-run
    const before = executed.filter((id) => id === c.id).length;
    await Orch.retryFile(session, a.id, {
        executeImpl: async (prepared, ctx) => {
            executed.push(ctx.fileId);
            return { status: 'succeeded', recordsWritten: 2, recordsRejected: 0 };
        }
    });
    assert.strictEqual(session.getFile(a.id).status, 'succeeded');
    // grades may succeed after students retry if re-evaluated
    const cRuns = executed.filter((id) => id === c.id).length;
    assert.strictEqual(cRuns, before, 'successful item must not re-execute on unrelated retry');

    // Skip is explicit
    const session2 = ImportSession.create();
    const s = ready(session2, 'skip.csv', 'students', []);
    Orch.skipFile(session2, s.id, 'user skip');
    assert.strictEqual(session2.getFile(s.id).status, 'skipped');
    assert.strictEqual(session2.getFile(s.id).result.status, 'skipped');

    // No rollback claim — each item independent unit
    assert.ok(!JSON.stringify(report).includes('rollback'));

    console.log('import-orchestrator-retry: OK');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
