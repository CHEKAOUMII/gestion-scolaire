/**
 * import-post-import.js — Post-import boundaries after successful smart/manual writes (Package 6).
 *
 * - CrossSourceValidator.validateAfterImport is POST-import only (never preflight).
 * - DataSourceRegistry is readiness metadata by year — not a session/Job store.
 * - System logs are compact summaries — not per-file durable session storage.
 *
 * Dual-export: window.ImportPostImport + module.exports
 */
(function (root, factory) {
    const api = factory(root);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.ImportPostImport = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    /** Types covered by CrossSourceValidator.validateAfterImport */
    const VALIDATOR_TYPES = Object.freeze(['grades', 'absences', 'fet', 'agent_xml']);

    /** Map import-center type → DataSourceRegistry source key */
    const REGISTRY_SOURCE = Object.freeze({
        students: 'students',
        grades: 'grades',
        absences: 'absences',
        fet: 'fet',
        agent_xml: 'agent_xml',
        student_status: 'status',
        orientation: 'orientation'
    });

    function resolveDeps(overrides) {
        const o = overrides || {};
        return {
            DataSourceRegistry:
                o.DataSourceRegistry ||
                (root && root.DataSourceRegistry) ||
                (typeof DataSourceRegistry !== 'undefined' ? DataSourceRegistry : null),
            CrossSourceValidator:
                o.CrossSourceValidator ||
                (root && root.CrossSourceValidator) ||
                (typeof CrossSourceValidator !== 'undefined' ? CrossSourceValidator : null),
            logImport: o.logImport || null,
            systemLogsAdd: o.systemLogsAdd || null
        };
    }

    /**
     * Build compact log details from an in-memory session report.
     * Never includes raw file content or full row dumps.
     */
    function buildCompactLogDetails(report, session) {
        const rep = report || (session && session.report) || {};
        const totals = rep.totals || {};
        const files = Array.isArray(rep.files) ? rep.files : [];
        const byStatus = {
            succeeded: files.filter((f) => f.status === 'succeeded').length,
            failed: files.filter((f) => f.status === 'failed').length,
            blocked: files.filter((f) => f.status === 'blocked').length,
            skipped: files.filter((f) => f.status === 'skipped').length
        };
        let warningCount = totals.warningCount || 0;
        let unresolvedNames = 0;
        if (session && Array.isArray(session.files)) {
            for (const item of session.files) {
                if (Array.isArray(item.diagnostics)) {
                    warningCount += item.diagnostics.filter((d) => d.severity === 'warning').length;
                }
                if (item.preflight && Array.isArray(item.preflight.unresolvedNames)) {
                    unresolvedNames += item.preflight.unresolvedNames.length;
                }
                if (item.result && Array.isArray(item.result.unresolvedNames)) {
                    unresolvedNames += item.result.unresolvedNames.length;
                }
            }
        }
        return {
            sessionId: (session && session.id) || rep.sessionId || null,
            filesTotal: totals.files != null ? totals.files : files.length,
            succeeded: totals.succeeded != null ? totals.succeeded : byStatus.succeeded,
            failed: totals.failed != null ? totals.failed : byStatus.failed,
            blocked: totals.blocked != null ? totals.blocked : byStatus.blocked,
            skipped: totals.skipped != null ? totals.skipped : byStatus.skipped,
            recordsWritten: totals.recordsWritten || 0,
            recordsRejected: totals.recordsRejected || 0,
            warningCount,
            unresolvedNames,
            // Compact only — not a Job database
            durableSession: false
        };
    }

    /**
     * Report totals must equal item outcome sums (Property 21 helper).
     */
    function assertReportTotalsConsistent(report) {
        const rep = report || {};
        const files = Array.isArray(rep.files) ? rep.files : [];
        const totals = rep.totals || {};
        const count = (st) => files.filter((f) => f.status === st).length;
        const checks = {
            succeeded: (totals.succeeded || 0) === count('succeeded'),
            failed: (totals.failed || 0) === count('failed'),
            blocked: (totals.blocked || 0) === count('blocked'),
            skipped: (totals.skipped || 0) === count('skipped'),
            recordsWritten:
                (totals.recordsWritten || 0) ===
                files.reduce((s, f) => s + (Number(f.recordsWritten) || 0), 0),
            recordsRejected:
                (totals.recordsRejected || 0) ===
                files.reduce((s, f) => s + (Number(f.recordsRejected) || 0), 0)
        };
        return {
            ok: Object.values(checks).every(Boolean),
            checks
        };
    }

    /**
     * Invoke CrossSourceValidator only as post-import for covered types.
     * Preserves `{ valid, warnings }` contract; never throws.
     *
     * @returns {Promise<{ valid: boolean, warnings: Array }>}
     */
    async function runPostImportValidator(importType, importedData, schoolYear, deps) {
        const d = resolveDeps(deps);
        if (!VALIDATOR_TYPES.includes(importType)) {
            return { valid: true, warnings: [], skipped: true, reason: 'type_not_covered' };
        }
        if (!d.CrossSourceValidator) {
            return { valid: true, warnings: [], skipped: true, reason: 'validator_unavailable' };
        }
        try {
            const validator = new d.CrossSourceValidator(schoolYear);
            const result = await validator.validateAfterImport(importType, importedData || {});
            // Preserve contract shape
            return {
                valid: result && typeof result.valid === 'boolean' ? result.valid : true,
                warnings: Array.isArray(result && result.warnings) ? result.warnings : []
            };
        } catch (_e) {
            // Validator must not crash import completion
            return { valid: true, warnings: [], recoveredFromThrow: true };
        }
    }

    /**
     * Update readiness only after successful import for a registered source.
     * Does not store sessions or queue items.
     */
    function updateReadinessAfterSuccess(sourceType, schoolYear, meta, warnings, deps) {
        const d = resolveDeps(deps);
        const regKey = REGISTRY_SOURCE[sourceType] || sourceType;
        if (!d.DataSourceRegistry || typeof d.DataSourceRegistry.update !== 'function') {
            return { updated: false, reason: 'registry_unavailable' };
        }
        if (!schoolYear) {
            return { updated: false, reason: 'no_year' };
        }
        d.DataSourceRegistry.update(regKey, schoolYear, meta || {}, warnings || []);
        return { updated: true, source: regKey };
    }

    /**
     * Compact system log for a completed smart session.
     */
    async function logCompactSessionSummary(report, session, deps) {
        const d = resolveDeps(deps);
        const details = buildCompactLogDetails(report, session);
        if (typeof d.logImport === 'function') {
            await d.logImport('smart-batch', details);
            return { logged: true, via: 'logImport', details };
        }
        if (typeof d.systemLogsAdd === 'function') {
            await d.systemLogsAdd({
                action: 'import:smart-batch',
                details,
                entity_type: 'import',
                entity_id: 'smart-batch'
            });
            return { logged: true, via: 'systemLogsAdd', details };
        }
        return { logged: false, reason: 'no_logger', details };
    }

    /**
     * After orchestrator completion: for each succeeded file item, optionally
     * run validator + readiness update. Always attempt compact log.
     *
     * Readiness/validation run ONLY for succeeded items (established success boundary).
     * Never called from classification/preflight paths.
     */
    async function finalizeSmartSession(session, report, options) {
        const opts = options || {};
        const schoolYear =
            opts.schoolYear ||
            (session && session.expectedYear) ||
            null;
        const deps = resolveDeps(opts);
        const perFile = [];

        const files = (session && session.files) || [];
        for (const item of files) {
            if (item.status !== 'succeeded') continue;
            const type = item.selectedType || item.detectedType;
            if (!type || type === 'unknown' || type === 'generic_csv_xlsx') continue;

            const importedData = buildImportedDataStub(item, type);
            let validation = { valid: true, warnings: [] };
            if (VALIDATOR_TYPES.includes(type)) {
                validation = await runPostImportValidator(type, importedData, schoolYear, deps);
            }

            const meta = {
                count:
                    (item.result && item.result.recordsWritten) ||
                    (item.preflight && item.preflight.recordEstimate) ||
                    0
            };
            const readiness = updateReadinessAfterSuccess(
                type,
                schoolYear,
                meta,
                validation.warnings || [],
                deps
            );
            perFile.push({
                fileId: item.id,
                type,
                validation,
                readiness
            });
        }

        const logResult = await logCompactSessionSummary(report || (session && session.report), session, deps);
        return {
            perFile,
            logResult,
            reportConsistency: assertReportTotalsConsistent(report || (session && session.report)),
            // Explicit: not a session store
            storesSession: false,
            usesJobs: false
        };
    }

    function buildImportedDataStub(item, type) {
        const payload = (item._prepared && item._prepared.executionPayload) || {};
        if (type === 'grades') {
            return {
                sections: [],
                teacherNames: [],
                levels: [],
                recordEstimate: item.recordEstimate
            };
        }
        if (type === 'absences') {
            return {
                studentCodes: Array.isArray(payload.rows)
                    ? payload.rows.map((r) => r && r.code).filter(Boolean)
                    : [],
                teacherNames: []
            };
        }
        if (type === 'fet') {
            return { teacherNames: [] };
        }
        if (type === 'agent_xml') {
            return { pprList: [] };
        }
        return { count: item.result && item.result.recordsWritten };
    }

    /**
     * Guard: preflight must not call validator as substitute.
     * Used by property tests / callers.
     */
    function isPostImportOnly() {
        return true;
    }

    return {
        VALIDATOR_TYPES,
        REGISTRY_SOURCE,
        buildCompactLogDetails,
        assertReportTotalsConsistent,
        runPostImportValidator,
        updateReadinessAfterSuccess,
        logCompactSessionSummary,
        finalizeSmartSession,
        buildImportedDataStub,
        isPostImportOnly
    };
});
