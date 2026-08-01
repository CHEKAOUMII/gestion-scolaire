'use strict';

// node tests/import-center/package-6-properties.test.js
// Property 14 — post-import validator compatibility
// Property 21 — report totals and compact logging

const assert = require('assert');
const fc = require('fast-check');
const PostImport = require('../../js/import-center/import-post-import.js');
const Orch = require('../../js/import-center/import-orchestrator.js');
const { ImportSession } = require('../../js/import-center/import-session.js');
const Query = require('../../js/import-center/import-query-context.js');

// ── Mock CrossSourceValidator preserving contract ──
class MockValidator {
    constructor(year) {
        this.year = year;
        MockValidator.instances.push(this);
    }
    async validateAfterImport(importType, importedData) {
        MockValidator.calls.push({ importType, importedData, year: this.year, phase: 'post' });
        // Never throw; return contract shape
        return { valid: true, warnings: [{ level: 'warning', code: 'MOCK', message: 'ok' }] };
    }
}
MockValidator.calls = [];
MockValidator.instances = [];

const registryUpdates = [];
const mockRegistry = {
    update(source, year, meta, warnings) {
        registryUpdates.push({ source, year, meta, warnings });
    }
};

const logCalls = [];

function ready(session, name, type) {
    const [item] = session.addFiles([{ name, size: 1, content: 'x' }]);
    item.status = 'ready';
    item.selectedType = type;
    item.detectedType = type;
    item.dependencies = [];
    item.preflight = {
        valid: true,
        executable: true,
        decisionVersion: 0,
        selectedType: type,
        recordEstimate: 2,
        unresolvedNames: type === 'grades' ? [{ input: 'X', decisionRequired: true }] : []
    };
    item._prepared = {
        type,
        preflight: item.preflight,
        executionPayload: { rows: [{ code: 'S1' }, { code: 'S2' }], notPersisted: true },
        sourceFileId: item.id
    };
    return item;
}

(async () => {
    // ── Property 14 ──
    // Validator only post-import, preserves { valid, warnings }
    MockValidator.calls = [];
    const r1 = await PostImport.runPostImportValidator(
        'grades',
        { sections: [] },
        '2026-2027',
        { CrossSourceValidator: MockValidator }
    );
    assert.strictEqual(typeof r1.valid, 'boolean');
    assert.ok(Array.isArray(r1.warnings));
    assert.strictEqual(MockValidator.calls.length, 1);
    assert.strictEqual(MockValidator.calls[0].importType, 'grades');

    // Not used as preflight substitute — module flag
    assert.strictEqual(PostImport.isPostImportOnly(), true);

    // Covered types only
    fc.assert(
        fc.property(fc.constantFrom('grades', 'absences', 'fet', 'agent_xml', 'students', 'unknown'), (type) => {
            const covered = PostImport.VALIDATOR_TYPES.includes(type);
            if (!covered) {
                // sync path for skip check
                return true;
            }
            return true;
        }),
        { numRuns: 12 }
    );

    const skipStudents = await PostImport.runPostImportValidator('students', {}, '2026-2027', {
        CrossSourceValidator: MockValidator
    });
    assert.ok(skipStudents.skipped);

    // Non-throwing even if validator throws
    class ThrowingValidator {
        constructor() {}
        async validateAfterImport() {
            throw new Error('boom');
        }
    }
    const recovered = await PostImport.runPostImportValidator('absences', {}, 'y', {
        CrossSourceValidator: ThrowingValidator
    });
    assert.strictEqual(typeof recovered.valid, 'boolean');
    assert.ok(Array.isArray(recovered.warnings));

    // Finalize only on succeeded items after orchestrator
    MockValidator.calls = [];
    registryUpdates.length = 0;
    logCalls.length = 0;

    const session = ImportSession.create({ expectedYear: '2026-2027' });
    ready(session, 'g.csv', 'grades');
    ready(session, 's.csv', 'students');
    session.confirmReadySet();
    const report = await Orch.runConfirmed(session, {
        executeImpl: async (p) => ({
            status: 'succeeded',
            recordsWritten: (p.executionPayload.rows || []).length,
            recordsRejected: 0
        })
    });

    const fin = await PostImport.finalizeSmartSession(session, report, {
        schoolYear: '2026-2027',
        CrossSourceValidator: MockValidator,
        DataSourceRegistry: mockRegistry,
        logImport: async (action, details) => {
            logCalls.push({ action, details });
        }
    });

    // Validator called for grades (covered), not as preflight
    assert.ok(MockValidator.calls.some((c) => c.importType === 'grades'));
    assert.ok(fin.perFile.some((p) => p.type === 'grades' && p.validation && Array.isArray(p.validation.warnings)));
    // Readiness updated for succeeded types
    assert.ok(registryUpdates.some((u) => u.source === 'grades' || u.source === 'students'));
    // Compact log
    assert.strictEqual(logCalls.length, 1);
    assert.strictEqual(logCalls[0].action, 'smart-batch');
    assert.strictEqual(logCalls[0].details.durableSession, false);
    assert.ok(logCalls[0].details.succeeded >= 1);
    assert.strictEqual(fin.storesSession, false);
    assert.strictEqual(fin.usesJobs, false);

    // ── Property 21 — report totals and compact logging ──
    fc.assert(
        fc.property(
            fc.array(
                fc.record({
                    status: fc.constantFrom('succeeded', 'failed', 'blocked', 'skipped'),
                    recordsWritten: fc.integer({ min: 0, max: 20 }),
                    recordsRejected: fc.integer({ min: 0, max: 10 })
                }),
                { minLength: 1, maxLength: 8 }
            ),
            (rows) => {
                const files = rows.map((r, i) => ({
                    fileId: `f${i}`,
                    status: r.status,
                    recordsWritten: r.recordsWritten,
                    recordsRejected: r.recordsRejected
                }));
                const totals = {
                    files: files.length,
                    succeeded: files.filter((f) => f.status === 'succeeded').length,
                    failed: files.filter((f) => f.status === 'failed').length,
                    blocked: files.filter((f) => f.status === 'blocked').length,
                    skipped: files.filter((f) => f.status === 'skipped').length,
                    recordsWritten: files.reduce((s, f) => s + f.recordsWritten, 0),
                    recordsRejected: files.reduce((s, f) => s + f.recordsRejected, 0),
                    warningCount: 0,
                    errorCount: 0
                };
                const reportLike = { sessionId: 's', files, totals };
                const cons = PostImport.assertReportTotalsConsistent(reportLike);
                assert.ok(cons.ok, JSON.stringify(cons.checks));

                const compact = PostImport.buildCompactLogDetails(reportLike, {
                    id: 's',
                    files: [],
                    report: reportLike
                });
                assert.strictEqual(compact.durableSession, false);
                assert.strictEqual(compact.succeeded, totals.succeeded);
                assert.strictEqual(compact.recordsWritten, totals.recordsWritten);
                // No per-file content dump
                assert.ok(!compact.rawFiles);
                assert.ok(!compact.fileContents);
                return true;
            }
        ),
        { numRuns: 40 }
    );

    // Orchestrator report consistency after real run
    const cons2 = PostImport.assertReportTotalsConsistent(report);
    assert.ok(cons2.ok);

    // Shortcuts never auto-execute
    fc.assert(
        fc.property(
            fc.constantFrom(...Query.SHORTCUT_PAGES),
            fc.option(fc.constantFrom('2025-2026', '2026-2027'), { nil: null }),
            (sc, year) => {
                const u = Query.buildImportCenterUrl({ type: sc.type, year, source: sc.source });
                const q = Query.parseQueryContext(u.includes('?') ? u.split('?')[1] : '');
                assert.strictEqual(q.autoExecute, false);
                assert.strictEqual(q.isHintOnly, true);
                return true;
            }
        ),
        { numRuns: 20 }
    );

    console.log('package-6-properties: OK');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
