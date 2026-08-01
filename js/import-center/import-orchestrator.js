/**
 * import-orchestrator.js — Dependency graph, serial execution, partial success (Package 4).
 *
 * No distributed transaction claim. No durable Job tables.
 * Dual-export: window.ImportOrchestrator + module.exports
 */
(function (root, factory) {
    const Contracts =
        (root && root.ImportContracts) ||
        (typeof require === 'function' ? require('./import-contracts.js') : null);
    const Adapters =
        (root && root.ImportAdapters) ||
        (typeof require === 'function' ? require('./adapters/index.js') : null);
    const api = factory(Contracts, Adapters);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.ImportOrchestrator = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (
    Contracts,
    Adapters
) {
    'use strict';

    /** Conservative default order when no explicit edge exists (safety ordering only). */
    const DEFAULT_TYPE_ORDER = Object.freeze([
        'students',
        'agent_xml',
        'fet',
        'grades',
        'absences',
        'student_status'
    ]);

    function typeRank(type) {
        const i = DEFAULT_TYPE_ORDER.indexOf(type);
        return i >= 0 ? i : 99;
    }

    function makeDiagnostic(partial) {
        if (Contracts && typeof Contracts.createDiagnostic === 'function') {
            return Contracts.createDiagnostic(partial);
        }
        return Object.assign(
            {
                code: 'ORCH',
                severity: 'error',
                stage: 'dependency',
                message: '',
                fileId: '',
                sheet: null,
                row: null,
                field: null,
                rule: null,
                action: 'none'
            },
            partial || {}
        );
    }

    /**
     * Build dependency DAG from confirmed items and their preflight dependencyRefs.
     *
     * @param {object} session
     * @param {string[]} confirmedFileIds
     * @param {object} [options]
     * @param {object} [options.sourceReadiness] — { students: true, ... } existing readiness
     * @returns {{ nodes, edges, blockedAtStart, reasons }}
     */
    function buildDependencyGraph(session, confirmedFileIds, options) {
        const opts = options || {};
        const readiness = opts.sourceReadiness || {};
        const ids = Array.isArray(confirmedFileIds) ? confirmedFileIds.slice() : [];
        const idSet = new Set(ids);
        const files = (session && session.files) || [];
        const byId = new Map(files.map((f) => [f.id, f]));
        const byType = new Map();

        for (const id of ids) {
            const item = byId.get(id);
            if (!item) continue;
            const t = item.selectedType || item.detectedType;
            if (!byType.has(t)) byType.set(t, []);
            byType.get(t).push(item);
        }

        const nodes = [];
        const edges = [];
        const blockedAtStart = [];
        const reasons = {};

        for (const id of ids) {
            const item = byId.get(id);
            if (!item) continue;
            // needs_review cannot start
            if (item.status === 'needs_review' || item.status === 'failed' || item.status === 'skipped') {
                blockedAtStart.push(id);
                reasons[id] = `الحالة ${item.status} تمنع البدء`;
                nodes.push({ fileId: id, status: item.status, canStart: false });
                continue;
            }
            if (item.status !== 'ready' && item.status !== 'queued' && item.status !== 'importing') {
                // only ready confirmed items execute; treat non-ready as cannot start
                if (item.status !== 'succeeded' && item.status !== 'blocked') {
                    blockedAtStart.push(id);
                    reasons[id] = `العنصر غير جاهز (${item.status})`;
                    nodes.push({ fileId: id, status: item.status, canStart: false });
                    continue;
                }
            }

            const deps = Array.isArray(item.dependencies)
                ? item.dependencies
                : item.preflight && Array.isArray(item.preflight.dependencies)
                  ? item.preflight.dependencies
                  : [];

            let canStart = true;
            let blockReason = null;

            for (const dep of deps) {
                if (!dep || !dep.required) continue;
                const depType = dep.sourceType;
                // Satisfied by readiness metadata
                if (dep.satisfied || readiness[depType] === true) {
                    continue;
                }
                // Satisfied by another confirmed file of that type
                const providers = byType.get(depType) || [];
                const provider = providers.find((p) => p.id !== id && idSet.has(p.id));
                if (provider) {
                    edges.push({
                        from: provider.id,
                        to: id,
                        reason: dep.reason || `يعتمد على ${depType}`,
                        required: true
                    });
                    continue;
                }
                // Explicit target file
                if (dep.targetFileId && idSet.has(dep.targetFileId)) {
                    edges.push({
                        from: dep.targetFileId,
                        to: id,
                        reason: dep.reason || 'اعتماد ملف',
                        required: true
                    });
                    continue;
                }
                // Missing required dependency — cannot start
                canStart = false;
                blockReason = dep.reason || `اعتماد مطلوب ناقص: ${depType}`;
            }

            nodes.push({ fileId: id, status: item.status, canStart });
            if (!canStart) {
                blockedAtStart.push(id);
                reasons[id] = blockReason || 'اعتماد ناقص';
            }
        }

        // Add soft default-order edges among confirmed ready items without cycles
        // Only when no path already exists — used for scheduling preference
        const readyIds = nodes.filter((n) => n.canStart).map((n) => n.fileId);
        const sortedByType = readyIds.slice().sort((a, b) => {
            const ta = byId.get(a);
            const tb = byId.get(b);
            const ra = typeRank(ta && (ta.selectedType || ta.detectedType));
            const rb = typeRank(tb && (tb.selectedType || tb.detectedType));
            if (ra !== rb) return ra - rb;
            return ids.indexOf(a) - ids.indexOf(b);
        });

        return {
            nodes,
            edges,
            blockedAtStart,
            reasons,
            confirmedFileIds: ids,
            preferredOrder: sortedByType
        };
    }

    /**
     * Topological sort of confirmed startable nodes. Serial-friendly order.
     * Kahn's algorithm; ties broken by DEFAULT_TYPE_ORDER then insertion order.
     *
     * @returns {{ order: string[], blocked: Array<{fileId, reason}>, waitReasons: object }}
     */
    function topologicalOrder(graph, session) {
        const g = graph || { nodes: [], edges: [], preferredOrder: [] };
        const files = (session && session.files) || [];
        const byId = new Map(files.map((f) => [f.id, f]));
        const startable = new Set(
            (g.nodes || []).filter((n) => n.canStart !== false).map((n) => n.fileId)
        );
        const blocked = (g.blockedAtStart || []).map((id) => ({
            fileId: id,
            reason: (g.reasons && g.reasons[id]) || 'محجوب'
        }));

        const indeg = new Map();
        const adj = new Map();
        for (const id of startable) {
            indeg.set(id, 0);
            adj.set(id, []);
        }
        for (const e of g.edges || []) {
            if (!startable.has(e.from) || !startable.has(e.to)) continue;
            adj.get(e.from).push(e);
            indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
        }

        const waitReasons = {};
        for (const e of g.edges || []) {
            if (!waitReasons[e.to]) waitReasons[e.to] = [];
            waitReasons[e.to].push(e.reason || `بانتظار ${e.from}`);
        }

        const ready = [];
        for (const [id, d] of indeg) {
            if (d === 0) ready.push(id);
        }
        const prefer = g.preferredOrder || [];
        const sortReady = () => {
            ready.sort((a, b) => {
                const ia = prefer.indexOf(a);
                const ib = prefer.indexOf(b);
                if (ia >= 0 && ib >= 0) return ia - ib;
                if (ia >= 0) return -1;
                if (ib >= 0) return 1;
                const ta = byId.get(a);
                const tb = byId.get(b);
                return (
                    typeRank(ta && (ta.selectedType || ta.detectedType)) -
                    typeRank(tb && (tb.selectedType || tb.detectedType))
                );
            });
        };
        sortReady();

        const order = [];
        while (ready.length) {
            const id = ready.shift();
            order.push(id);
            for (const e of adj.get(id) || []) {
                const next = e.to;
                indeg.set(next, indeg.get(next) - 1);
                if (indeg.get(next) === 0) {
                    ready.push(next);
                    sortReady();
                }
            }
        }

        // Cycle leftovers → blocked with reason
        for (const [id, d] of indeg) {
            if (d > 0 && !order.includes(id)) {
                blocked.push({ fileId: id, reason: 'دورة اعتمادات أو اعتماد غير محلول' });
                waitReasons[id] = (waitReasons[id] || []).concat(['دورة اعتمادات']);
            }
        }

        return { order, blocked, waitReasons };
    }

    function emptyResult(fileId, status, extra) {
        return Object.assign(
            {
                fileId,
                status,
                recordsWritten: 0,
                recordsRejected: 0,
                warnings: [],
                errors: [],
                unresolvedNames: [],
                startedAt: null,
                finishedAt: null
            },
            extra || {}
        );
    }

    function recomputeTotals(session) {
        if (!session) return;
        const t = {
            files: session.files.length,
            ready: 0,
            succeeded: 0,
            failed: 0,
            skipped: 0,
            blocked: 0,
            recordsWritten: 0,
            recordsRejected: 0,
            warningCount: 0,
            errorCount: 0
        };
        for (const f of session.files) {
            if (f.status === 'ready') t.ready += 1;
            if (f.status === 'succeeded') t.succeeded += 1;
            if (f.status === 'failed') t.failed += 1;
            if (f.status === 'skipped') t.skipped += 1;
            if (f.status === 'blocked') t.blocked += 1;
            if (f.result) {
                t.recordsWritten += Number(f.result.recordsWritten) || 0;
                t.recordsRejected += Number(f.result.recordsRejected) || 0;
            }
            if (Array.isArray(f.diagnostics)) {
                t.warningCount += f.diagnostics.filter((d) => d.severity === 'warning').length;
                t.errorCount += f.diagnostics.filter((d) => d.severity === 'error').length;
            }
        }
        session.totals = t;
        return t;
    }

    function buildReport(session) {
        const files = (session.files || []).map((f) => {
            if (f.result) return Object.assign({}, f.result);
            return emptyResult(f.id, f.status === 'skipped' ? 'skipped' : f.status === 'blocked' ? 'blocked' : f.status === 'succeeded' ? 'succeeded' : f.status === 'failed' ? 'failed' : 'skipped');
        });
        const totals = recomputeTotals(session);
        const dependencySummary = (session.files || [])
            .filter((f) => f.status === 'blocked')
            .map((f) => {
                const d = (f.diagnostics || []).find((x) => x.code === 'BLOCKED_DEPENDENCY');
                return {
                    fileId: f.id,
                    blockedBy: d && d.field ? d.field : null,
                    reason: d ? d.message : 'محجوب بسبب اعتماد'
                };
            });
        return {
            sessionId: session.id,
            startedAt: session._runStartedAt || null,
            finishedAt: session._runFinishedAt || null,
            files,
            totals: Object.assign({}, totals),
            dependencySummary
        };
    }

    /**
     * Emit progress to session item + options.onProgress.
     */
    function setProgress(item, progress, onProgress, aggregate) {
        if (item) {
            item.progress = Object.assign(
                {
                    phase: 'write',
                    completed: 0,
                    total: null,
                    percent: null,
                    message: ''
                },
                progress || {}
            );
        }
        if (typeof onProgress === 'function') {
            onProgress({
                fileId: item && item.id,
                itemProgress: item && item.progress,
                aggregate: aggregate || null
            });
        }
    }

    /**
     * Mark dependents of a failed file as blocked (required edges only).
     */
    function blockDependents(session, graph, failedFileId, reason) {
        const edges = (graph && graph.edges) || [];
        const blocked = [];
        for (const e of edges) {
            if (e.from !== failedFileId || !e.required) continue;
            const item = session.getFile(e.to);
            if (!item) continue;
            if (item.status === 'succeeded' || item.status === 'skipped' || item.status === 'failed') continue;
            if (item.status === 'importing') continue;
            item.status = 'blocked';
            item.result = emptyResult(item.id, 'blocked', {
                finishedAt: new Date().toISOString(),
                errors: [
                    makeDiagnostic({
                        code: 'BLOCKED_DEPENDENCY',
                        severity: 'error',
                        stage: 'dependency',
                        message: reason || e.reason || `محجوب بسبب فشل ${failedFileId}`,
                        fileId: item.id,
                        field: failedFileId,
                        rule: 'dependency',
                        action: 'retry'
                    })
                ]
            });
            item.diagnostics = (item.diagnostics || [])
                .filter((d) => d.code !== 'BLOCKED_DEPENDENCY')
                .concat(item.result.errors);
            blocked.push(item.id);
        }
        return blocked;
    }

    /**
     * Execute one prepared item via adapter (with allowExecute).
     */
    async function executeOne(item, options) {
        const opts = options || {};
        const type = item.selectedType || item.detectedType;
        const adapter =
            (opts.getAdapter && opts.getAdapter(type)) ||
            (Adapters && Adapters.getAdapter && Adapters.getAdapter(type));
        if (!adapter) {
            throw new Error(`No adapter for ${type}`);
        }
        const prepared = item._prepared || {
            type,
            preflight: item.preflight,
            dependencyRefs: item.dependencies || [],
            executionPayload: null,
            sourceFileId: item.id
        };
        const ctx = {
            allowExecute: true,
            fileId: item.id,
            executeImpl: opts.executeImpl || (opts.executeHandlers && opts.executeHandlers[type]) || null,
            schoolYear: opts.schoolYear || null,
            writeAttempts: opts.writeAttempts || []
        };
        const raw = await adapter.execute(prepared, ctx);
        // Normalize result
        if (raw && raw.status) return raw;
        return emptyResult(item.id, 'succeeded', {
            recordsWritten:
                (raw && (raw.recordsWritten || raw.importedCount)) ||
                (item.preflight && item.preflight.recordEstimate) ||
                0,
            recordsRejected: (raw && raw.recordsRejected) || 0,
            startedAt: raw && raw.startedAt,
            finishedAt: raw && raw.finishedAt
        });
    }

    /**
     * Serial execution of confirmed ready set.
     *
     * @param {object} session
     * @param {object} [options]
     * @param {function} [options.executeImpl] — shared write impl for all types (tests / page)
     * @param {object} [options.executeHandlers] — per-type write handlers
     * @param {function} [options.onProgress]
     * @param {object} [options.sourceReadiness]
     * @param {boolean} [options.simulateDelay] — for >300ms progress tests
     * @returns {Promise<object>} report
     */
    async function runConfirmed(session, options) {
        const opts = options || {};
        if (!session) throw new Error('session required');
        if (session.status === 'importing') {
            throw new Error('ALREADY_RUNNING: duplicate start rejected');
        }

        const snapshot = session._confirmedSnapshot;
        if (!snapshot || !Array.isArray(snapshot.fileIds) || !snapshot.fileIds.length) {
            throw new Error('NO_CONFIRMED_SET: call confirmReadySet first');
        }

        // Freeze: reject if decision versions drifted
        for (const snap of snapshot.decisionVersions || []) {
            const item = session.getFile(snap.id);
            if (!item) continue;
            if ((item.decisionVersion || 0) !== (snap.decisionVersion || 0)) {
                throw new Error(`STALE_CONFIRMATION: ${snap.id}`);
            }
        }

        session.status = 'importing';
        session._runStartedAt = new Date().toISOString();
        session._runFinishedAt = null;
        session._executedIds = session._executedIds || new Set();
        if (typeof session._emit === 'function') session._emit();

        const graph = buildDependencyGraph(session, snapshot.fileIds, {
            sourceReadiness: opts.sourceReadiness
        });
        session.dependencyGraph = { nodes: graph.nodes, edges: graph.edges };

        const { order, blocked: blockedUpFront, waitReasons } = topologicalOrder(graph, session);

        // Apply blocked-at-start
        for (const b of blockedUpFront) {
            const item = session.getFile(b.fileId);
            if (!item) continue;
            if (item.status === 'succeeded') continue;
            item.status = 'blocked';
            item.result = emptyResult(item.id, 'blocked', {
                finishedAt: new Date().toISOString(),
                errors: [
                    makeDiagnostic({
                        code: 'BLOCKED_DEPENDENCY',
                        severity: 'error',
                        stage: 'dependency',
                        message: b.reason || (waitReasons[b.fileId] || []).join(' · ') || 'محجوب',
                        fileId: item.id,
                        rule: 'dependency',
                        action: 'review'
                    })
                ]
            });
            item.diagnostics = (item.diagnostics || []).concat(item.result.errors);
            setProgress(
                item,
                { phase: 'dependency', completed: 0, total: 1, percent: 0, message: b.reason || 'محجوب' },
                opts.onProgress
            );
        }

        const total = order.length + blockedUpFront.length;
        let completed = blockedUpFront.length;

        for (const fileId of order) {
            const item = session.getFile(fileId);
            if (!item) continue;
            if (item.status === 'blocked' || item.status === 'skipped' || item.status === 'succeeded') {
                completed += 1;
                continue;
            }
            // Already executed successfully — never re-run
            if (session._executedIds.has(fileId) && item.status === 'succeeded') {
                completed += 1;
                continue;
            }

            // Check required predecessors still succeeded
            const preds = (graph.edges || []).filter((e) => e.to === fileId && e.required);
            let predFailed = null;
            for (const e of preds) {
                const p = session.getFile(e.from);
                if (p && (p.status === 'failed' || p.status === 'blocked' || p.status === 'skipped')) {
                    predFailed = { id: e.from, reason: e.reason };
                    break;
                }
            }
            if (predFailed) {
                item.status = 'blocked';
                item.result = emptyResult(item.id, 'blocked', {
                    finishedAt: new Date().toISOString(),
                    errors: [
                        makeDiagnostic({
                            code: 'BLOCKED_DEPENDENCY',
                            severity: 'error',
                            stage: 'dependency',
                            message: predFailed.reason || `محجوب بسبب ${predFailed.id}`,
                            fileId: item.id,
                            field: predFailed.id,
                            rule: 'dependency',
                            action: 'retry'
                        })
                    ]
                });
                item.diagnostics = (item.diagnostics || []).concat(item.result.errors);
                completed += 1;
                setProgress(
                    item,
                    {
                        phase: 'dependency',
                        completed: 1,
                        total: 1,
                        percent: 100,
                        message: item.result.errors[0].message
                    },
                    opts.onProgress,
                    { completed, total, percent: Math.round((completed / Math.max(total, 1)) * 100) }
                );
                continue;
            }

            item.status = 'importing';
            const startedAt = new Date().toISOString();
            setProgress(
                item,
                { phase: 'write', completed: 0, total: 1, percent: 0, message: 'جاري الاستيراد...' },
                opts.onProgress,
                { completed, total, percent: Math.round((completed / Math.max(total, 1)) * 100) }
            );

            if (opts.simulateDelay) {
                await new Promise((r) => setTimeout(r, opts.simulateDelay === true ? 50 : Number(opts.simulateDelay) || 50));
            }

            try {
                const result = await executeOne(item, opts);
                item.status = 'succeeded';
                item.result = Object.assign(emptyResult(item.id, 'succeeded'), result, {
                    fileId: item.id,
                    status: 'succeeded',
                    startedAt: result.startedAt || startedAt,
                    finishedAt: result.finishedAt || new Date().toISOString()
                });
                session._executedIds.add(fileId);
                setProgress(
                    item,
                    { phase: 'complete', completed: 1, total: 1, percent: 100, message: 'تم بنجاح' },
                    opts.onProgress
                );
            } catch (err) {
                item.status = 'failed';
                item.retryCount = (item.retryCount || 0) + 0;
                item.result = emptyResult(item.id, 'failed', {
                    startedAt,
                    finishedAt: new Date().toISOString(),
                    errors: [
                        makeDiagnostic({
                            code: 'WRITE_FAILED',
                            severity: 'error',
                            stage: 'write',
                            message: (err && err.message) || 'فشل الاستيراد',
                            fileId: item.id,
                            rule: 'execute',
                            action: 'retry'
                        })
                    ]
                });
                item.diagnostics = (item.diagnostics || []).concat(item.result.errors);
                blockDependents(session, graph, fileId, `فشل ${item.name || fileId}: ${(err && err.message) || ''}`);
                setProgress(
                    item,
                    {
                        phase: 'complete',
                        completed: 1,
                        total: 1,
                        percent: 100,
                        message: (err && err.message) || 'فشل'
                    },
                    opts.onProgress
                );
            }

            completed += 1;
            if (typeof opts.onProgress === 'function') {
                opts.onProgress({
                    fileId,
                    aggregate: {
                        completed,
                        total,
                        percent: Math.round((completed / Math.max(total, 1)) * 100),
                        message: `تقدم ${completed}/${total}`
                    }
                });
            }
            if (typeof session._emit === 'function') session._emit();
        }

        session._runFinishedAt = new Date().toISOString();
        session.status = 'completed';
        session.report = buildReport(session);
        recomputeTotals(session);
        if (typeof session._emit === 'function') session._emit();

        if (typeof opts.onComplete === 'function') {
            opts.onComplete(session.report);
        }

        return session.report;
    }

    /**
     * Selective retry: only the failed item (and re-evaluate its dependents).
     * Successful items are never re-executed.
     */
    async function retryFile(session, fileId, options) {
        const opts = options || {};
        if (!session) throw new Error('session required');
        const item = session.getFile(fileId);
        if (!item) throw new Error('missing_item');
        if (item.status !== 'failed' && item.status !== 'blocked') {
            throw new Error(`RETRY_INVALID_STATUS: ${item.status}`);
        }

        // Clear blocked dependents that depended on this file so they can re-run if needed
        const snapshot = session._confirmedSnapshot;
        const graph = buildDependencyGraph(session, (snapshot && snapshot.fileIds) || [fileId], {
            sourceReadiness: opts.sourceReadiness
        });

        const dependentIds = (graph.edges || []).filter((e) => e.from === fileId && e.required).map((e) => e.to);
        for (const depId of dependentIds) {
            const dep = session.getFile(depId);
            if (dep && dep.status === 'blocked') {
                dep.status = 'ready';
                dep.result = null;
                dep.diagnostics = (dep.diagnostics || []).filter((d) => d.code !== 'BLOCKED_DEPENDENCY');
            }
        }

        // Do not re-run succeeded
        if (session._executedIds && session._executedIds.has(fileId) && item.status === 'succeeded') {
            return session.report || buildReport(session);
        }

        item.status = 'ready';
        item.result = null;
        item.retryCount = (item.retryCount || 0) + 1;
        item.diagnostics = (item.diagnostics || []).filter((d) => d.stage !== 'write' && d.code !== 'WRITE_FAILED');

        // Temporary confirmed set: failed item + reopened dependents only
        const retryIds = [fileId].concat(dependentIds.filter((id) => {
            const d = session.getFile(id);
            return d && d.status === 'ready';
        }));
        const prevSnapshot = session._confirmedSnapshot;
        session._confirmedSnapshot = {
            at: new Date().toISOString(),
            fileIds: retryIds,
            decisionVersions: retryIds.map((id) => {
                const f = session.getFile(id);
                return {
                    id,
                    decisionVersion: f ? f.decisionVersion : 0,
                    selectedType: f && f.selectedType,
                    selectedYear: f && (f._selectedYear || f.detectedYear)
                };
            })
        };

        // Preserve executed set so succeeded outside retry set stay done
        const report = await runConfirmed(session, opts);

        // Merge confirmation back to original broader set if present
        if (prevSnapshot) {
            session._confirmedSnapshot = prevSnapshot;
        }
        return report;
    }

    /**
     * Explicit skip — reflected in report, not success.
     */
    function skipFile(session, fileId, reason) {
        if (!session || typeof session.getFile !== 'function') return false;
        const item = session.getFile(fileId);
        if (!item) return false;
        if (item.status === 'succeeded' || item.status === 'importing') return false;
        item.status = 'skipped';
        item.result = emptyResult(item.id, 'skipped', {
            finishedAt: new Date().toISOString(),
            warnings: [
                makeDiagnostic({
                    code: 'SKIPPED',
                    severity: 'info',
                    stage: 'dependency',
                    message: reason || 'تم التخطي صراحة',
                    fileId: item.id,
                    action: 'none'
                })
            ]
        });
        recomputeTotals(session);
        if (typeof session._emit === 'function') session._emit();
        return true;
    }

    return {
        DEFAULT_TYPE_ORDER,
        typeRank,
        buildDependencyGraph,
        topologicalOrder,
        runConfirmed,
        retryFile,
        skipFile,
        blockDependents,
        buildReport,
        recomputeTotals,
        emptyResult,
        executeOne
    };
});
