'use strict';

// node tests/import-center/package-4-properties.test.js
// Properties 17, 18, 19

const assert = require('assert');
const fc = require('fast-check');
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
        executionPayload: { rows: [{ ok: true }], notPersisted: true },
        sourceFileId: item.id
    };
    return item;
}

const TYPES = ['students', 'agent_xml', 'fet', 'grades', 'absences', 'student_status'];

(async () => {
    // ── Property 17 — dependency-derived topological execution ──
    fc.assert(
        fc.property(
            fc.array(fc.constantFrom(...TYPES), { minLength: 2, maxLength: 5 }),
            (typeList) => {
                // unique types
                const types = [...new Set(typeList)];
                if (types.length < 2) return true;
                const session = ImportSession.create();
                const items = types.map((t) => {
                    const deps = [];
                    // grades/absences/status require students if present
                    if (['grades', 'absences', 'student_status'].includes(t) && types.includes('students')) {
                        deps.push({
                            sourceType: 'students',
                            reason: `يحتاج students`,
                            required: true,
                            satisfied: false
                        });
                    }
                    return ready(session, `${t}.csv`, t, deps);
                });
                const ids = items.map((i) => i.id);
                const graph = Orch.buildDependencyGraph(session, ids, {});
                const { order, blocked } = Orch.topologicalOrder(graph, session);

                // Every startable node either ordered or blocked with reason
                for (const n of graph.nodes) {
                    if (n.canStart === false) {
                        assert.ok(blocked.some((b) => b.fileId === n.fileId) || graph.blockedAtStart.includes(n.fileId));
                        assert.ok(graph.reasons[n.fileId] || blocked.some((b) => b.fileId === n.fileId && b.reason));
                    }
                }

                // Required edges: from before to in order
                for (const e of graph.edges) {
                    if (!e.required) continue;
                    if (!order.includes(e.from) || !order.includes(e.to)) continue;
                    assert.ok(
                        order.indexOf(e.from) < order.indexOf(e.to),
                        `${e.from} must precede ${e.to}: ${e.reason}`
                    );
                }
                return true;
            }
        ),
        { numRuns: 40 }
    );

    // Serial scheduling: order length <= confirmed startable
    {
        const session = ImportSession.create();
        const s = ready(session, 's.csv', 'students', []);
        const g = ready(session, 'g.csv', 'grades', [
            { sourceType: 'students', reason: 'dep', required: true, satisfied: false }
        ]);
        const graph = Orch.buildDependencyGraph(session, [s.id, g.id], {});
        const { order } = Orch.topologicalOrder(graph, session);
        assert.deepStrictEqual(order.length, 2);
        assert.ok(order[0] === s.id);
    }

    // ── Property 18 — failure propagation and selective retry ──
    {
        const session = ImportSession.create();
        const s = ready(session, 's.csv', 'students', []);
        const g = ready(session, 'g.csv', 'grades', [
            { sourceType: 'students', reason: 'dep', required: true, satisfied: false }
        ]);
        const u = ready(session, 'u.csv', 'agent_xml', []);
        session.confirmReadySet();

        const runs = [];
        await Orch.runConfirmed(session, {
            executeImpl: async (prepared, ctx) => {
                runs.push(ctx.fileId);
                if (ctx.fileId === s.id) throw new Error('fail s');
                return { status: 'succeeded', recordsWritten: 1 };
            }
        });
        assert.strictEqual(session.getFile(s.id).status, 'failed');
        assert.strictEqual(session.getFile(g.id).status, 'blocked');
        assert.strictEqual(session.getFile(u.id).status, 'succeeded');

        const uRunsBefore = runs.filter((id) => id === u.id).length;
        await Orch.retryFile(session, s.id, {
            executeImpl: async (prepared, ctx) => {
                runs.push(ctx.fileId);
                return { status: 'succeeded', recordsWritten: 1 };
            }
        });
        assert.strictEqual(session.getFile(s.id).status, 'succeeded');
        // Only failed + dependents retried — not successful unrelated
        assert.strictEqual(
            runs.filter((id) => id === u.id).length,
            uRunsBefore,
            'successful unrelated never re-executed'
        );
    }

    // Explicit additional case: only required dependents block
    {
        const session = ImportSession.create();
        const root = ready(session, 'root.csv', 'students', []);
        const dep = ready(session, 'dep.csv', 'grades', [
            { sourceType: 'students', reason: 'r', required: true, satisfied: false }
        ]);
        const free = ready(session, 'free.csv', 'fet', []);
        session.confirmReadySet();
        await Orch.runConfirmed(session, {
            executeImpl: async (p, ctx) => {
                if (ctx.fileId === root.id) throw new Error('x');
                return { status: 'succeeded', recordsWritten: 1 };
            }
        });
        assert.strictEqual(session.getFile(dep.id).status, 'blocked');
        assert.strictEqual(session.getFile(free.id).status, 'succeeded');
    }

    // ── Property 19 — statuses, progress, diagnostics ──
    {
        const statusesSeen = new Set();
        const session = ImportSession.create();
        const a = ready(session, 'a.csv', 'students', []);
        const b = ready(session, 'b.csv', 'grades', [
            { sourceType: 'students', reason: 'dep', required: true, satisfied: false }
        ]);
        // skip one
        const c = ready(session, 'c.csv', 'fet', []);
        Orch.skipFile(session, c.id, 'skip');
        statusesSeen.add(session.getFile(c.id).status);

        session.confirmReadySet();
        // re-confirm without skipped? skip removed from ready — confirm only ready
        session._confirmedSnapshot = {
            at: new Date().toISOString(),
            fileIds: [a.id, b.id],
            decisionVersions: [a, b].map((f) => ({
                id: f.id,
                decisionVersion: f.decisionVersion,
                selectedType: f.selectedType
            }))
        };

        const phases = [];
        await Orch.runConfirmed(session, {
            simulateDelay: 20,
            executeImpl: async (p, ctx) => {
                if (ctx.fileId === a.id) throw new Error('boom');
                return { status: 'succeeded', recordsWritten: 1 };
            },
            onProgress: (ev) => {
                if (ev.itemProgress) phases.push(ev.itemProgress.phase);
                if (ev.aggregate) phases.push('aggregate');
            }
        });

        for (const f of session.files) {
            statusesSeen.add(f.status);
        }
        // Distinct statuses preserved
        assert.ok(statusesSeen.has('failed'));
        assert.ok(statusesSeen.has('blocked'));
        assert.ok(statusesSeen.has('skipped'));
        // Not collapsed
        assert.notStrictEqual(session.getFile(a.id).status, session.getFile(b.id).status);
        assert.notStrictEqual(session.getFile(c.id).status, 'failed');
        // Diagnostics file + stage
        const err = (session.getFile(a.id).diagnostics || []).find((d) => d.severity === 'error');
        assert.ok(err);
        assert.ok(err.stage === 'write' || err.stage === 'dependency');
        assert.strictEqual(err.fileId, a.id);
        // Progress events
        assert.ok(phases.length >= 1);
    }

    // Lifecycle never maps blocked/skipped/failed to generic single status
    const distinct = ['failed', 'skipped', 'blocked', 'needs_review', 'succeeded'];
    for (const st of distinct) {
        assert.ok(Orch.emptyResult('x', st).status === st);
    }

    console.log('package-4-properties: OK');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
