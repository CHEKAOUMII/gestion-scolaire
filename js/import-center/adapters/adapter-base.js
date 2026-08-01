/**
 * adapter-base.js — Shared ImportAdapter factory (Package 3).
 *
 * analyze is always read-only. execute is separately guarded and disabled
 * unless context.allowExecute is explicitly true (orchestrator packages).
 *
 * Dual-export: window.ImportAdapterBase + module.exports
 */
(function (root, factory) {
    const api = factory(
        root && root.ImportContracts
            ? root.ImportContracts
            : typeof require === 'function'
              ? require('../import-contracts.js')
              : null
    );
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.ImportAdapterBase = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (Contracts) {
    'use strict';

    const WRITE_FORBIDDEN_KEYS = Object.freeze([
        'write',
        'delete',
        'replace',
        'saveBulk',
        'addBulk',
        'deleteByYear',
        'DataSourceRegistry',
        'updateReadiness'
    ]);

    /**
     * Assert context does not invite write operations during analyze/preflight.
     * @param {object} context
     * @param {string} stage
     */
    function assertReadOnlyContext(context, stage) {
        const ctx = context || {};
        if (ctx.allowWrite === true || ctx.mutateReadiness === true) {
            throw new Error(`WRITE_FIREWALL: ${stage || 'analyze'} forbids allowWrite/mutateReadiness`);
        }
        if (ctx.writeApi || ctx.dbWrite || ctx.ipcWrite) {
            throw new Error(`WRITE_FIREWALL: ${stage || 'analyze'} forbids write API injection`);
        }
        // Probe hooks used by tests — must remain zero for analyze
        if (typeof ctx.onWriteAttempt === 'function') {
            // no-op; callers instrument execute only
        }
    }

    /**
     * Record a write attempt for instrumentation (tests). Never performs a write.
     */
    function recordWriteAttempt(context, detail) {
        const ctx = context || {};
        if (typeof ctx.onWriteAttempt === 'function') {
            ctx.onWriteAttempt(detail || { stage: 'unknown' });
        }
        if (Array.isArray(ctx.writeAttempts)) {
            ctx.writeAttempts.push(detail || { stage: 'unknown' });
        }
    }

    function emptyPreflight(partial) {
        return Object.assign(
            {
                valid: false,
                analyzedAt: new Date().toISOString(),
                selectedType: null,
                selectedYear: null,
                selectedTerm: null,
                sheetsRead: [],
                elementsRead: [],
                recordEstimate: null,
                rowOutcomes: [],
                warnings: [],
                errors: [],
                unresolvedNames: [],
                unknownEntities: [],
                duplicates: [],
                dependencies: [],
                preview: [],
                decisionVersion: 0,
                zeroValidRows: false,
                executable: false
            },
            partial || {}
        );
    }

    function makeDiagnostic(partial) {
        if (Contracts && typeof Contracts.createDiagnostic === 'function') {
            return Contracts.createDiagnostic(partial);
        }
        return Object.assign(
            {
                code: 'UNKNOWN',
                severity: 'info',
                stage: 'preflight',
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
     * Default dependency refs by type (conservative safety order).
     * Not a substitute for readiness evidence — marks expected prerequisites.
     */
    function defaultDependenciesFor(type) {
        const order = {
            students: [],
            agent_xml: [{ sourceType: 'students', reason: 'أسماء الأساتذة تُربط لاحقاً بالجدول', required: false }],
            fet: [
                {
                    sourceType: 'agent_xml',
                    reason: 'مطابقة أسماء الأساتذة مع ملف الوزارة',
                    required: false
                }
            ],
            grades: [
                {
                    sourceType: 'students',
                    reason: 'النقط تعتمد على رموز التلاميذ المستوردة',
                    required: true
                }
            ],
            absences: [
                {
                    sourceType: 'students',
                    reason: 'الغياب يعتمد على رموز التلاميذ المستوردة',
                    required: true
                }
            ],
            student_status: [
                {
                    sourceType: 'students',
                    reason: 'الوضعيات تُطبَّق على تلاميذ موجودين',
                    required: true
                }
            ]
        };
        return (order[type] || []).map((d) =>
            Object.assign(
                {
                    targetFileId: null,
                    satisfied: false
                },
                d
            )
        );
    }

    /**
     * @param {object} config
     * @param {string} config.type
     * @param {string[]} [config.formats]
     * @param {(meta: object) => boolean} [config.canAnalyze]
     * @param {(file: object, context: object) => Promise<object>} config.analyze
     * @param {(prepared: object, context: object) => Promise<object>} [config.execute]
     * @param {string} [config.manualFunctionName] — name of existing manual importer (documentation only)
     */
    function createImportAdapter(config) {
        if (!config || !config.type || typeof config.analyze !== 'function') {
            throw new Error('createImportAdapter requires type and analyze()');
        }

        const formats = Array.isArray(config.formats) ? config.formats.slice() : null;

        return {
            type: config.type,
            formats,
            manualFunctionName: config.manualFunctionName || null,
            /**
             * Whether this adapter can analyze the given metadata.
             */
            canAnalyze(fileMetadata) {
                if (typeof config.canAnalyze === 'function') {
                    return !!config.canAnalyze(fileMetadata);
                }
                const meta = fileMetadata || {};
                if (formats && formats.length) {
                    const fmt = meta.format || meta.extension;
                    if (fmt === 'xls') return formats.includes('xlsx');
                    return formats.includes(fmt);
                }
                return true;
            },
            /**
             * Read-only analysis. Must never write business data.
             * @returns {Promise<PreparedImport>}
             */
            async analyze(file, context) {
                assertReadOnlyContext(context, 'analyze');
                const prepared = await config.analyze(file, context || {});
                if (!prepared || typeof prepared !== 'object') {
                    throw new Error(`Adapter ${config.type} analyze returned empty result`);
                }
                // Harden: never claim executable write payload as persisted
                return {
                    type: prepared.type || config.type,
                    preflight: prepared.preflight || emptyPreflight({ selectedType: config.type }),
                    dependencyRefs: Array.isArray(prepared.dependencyRefs)
                        ? prepared.dependencyRefs
                        : defaultDependenciesFor(config.type),
                    executionPayload: prepared.executionPayload != null ? prepared.executionPayload : null,
                    sourceFileId: prepared.sourceFileId || (context && context.fileId) || '',
                    readOnly: true,
                    analyzedAt: new Date().toISOString()
                };
            },
            /**
             * Separately guarded execute boundary.
             * Requires context.allowExecute === true (orchestrator after confirmation).
             * Resolution order: context.executeImpl → config.execute → EXECUTE_NOT_IMPLEMENTED.
             */
            async execute(prepared, context) {
                const ctx = context || {};
                if (!ctx.allowExecute) {
                    recordWriteAttempt(ctx, {
                        stage: 'write',
                        blocked: true,
                        adapter: config.type,
                        reason: 'EXECUTE_GUARDED'
                    });
                    throw new Error(
                        `EXECUTE_GUARDED: ${config.type} execute requires explicit confirmation (context.allowExecute)`
                    );
                }
                if (typeof ctx.executeImpl === 'function') {
                    recordWriteAttempt(ctx, {
                        stage: 'write',
                        blocked: false,
                        adapter: config.type,
                        reason: 'execute_impl'
                    });
                    return ctx.executeImpl(prepared, ctx);
                }
                if (typeof config.execute !== 'function') {
                    recordWriteAttempt(ctx, {
                        stage: 'write',
                        blocked: true,
                        adapter: config.type,
                        reason: 'EXECUTE_NOT_IMPLEMENTED'
                    });
                    throw new Error(`EXECUTE_NOT_IMPLEMENTED: ${config.type}`);
                }
                recordWriteAttempt(ctx, {
                    stage: 'write',
                    blocked: false,
                    adapter: config.type,
                    reason: 'execute_invoked'
                });
                return config.execute(prepared, ctx);
            }
        };
    }

    return {
        WRITE_FORBIDDEN_KEYS,
        assertReadOnlyContext,
        recordWriteAttempt,
        emptyPreflight,
        makeDiagnostic,
        defaultDependenciesFor,
        createImportAdapter
    };
});
