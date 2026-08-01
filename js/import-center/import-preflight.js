/**
 * import-preflight.js — Read-only preflight orchestration (Package 3).
 *
 * Runs type adapters' analyze() only. No write/delete/replace/readiness.
 * Year conflicts require a decision; type/year/destination changes invalidate.
 *
 * Dual-export: window.ImportPreflight + module.exports
 */
(function (root, factory) {
    const Contracts =
        (root && root.ImportContracts) ||
        (typeof require === 'function' ? require('./import-contracts.js') : null);
    const Readers =
        (root && root.ImportReaders) ||
        (typeof require === 'function' ? require('./import-readers.js') : null);
    const AdapterBase =
        (root && root.ImportAdapterBase) ||
        (typeof require === 'function' ? require('./adapters/adapter-base.js') : null);
    let Adapters =
        (root && root.ImportAdapters) ||
        (typeof require === 'function' ? require('./adapters/index.js') : null);
    const api = factory(Contracts, Readers, AdapterBase, Adapters);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.ImportPreflight = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (
    Contracts,
    Readers,
    AdapterBase,
    Adapters
) {
    'use strict';

    /**
     * Detect school year from free text / sample (shared analysis boundary).
     * Mirrors the spirit of detectSchoolYearFromWorkbook without requiring XLSX.
     */
    function detectSchoolYearFromText(text) {
        const t = String(text || '');
        const m = t.match(/(20\d{2})\s*[-_/]\s*(20\d{2})/);
        return m ? `${m[1]}-${m[2]}` : null;
    }

    function detectTermFromText(text) {
        const t = String(text || '');
        if (/S\s*1|الدورة\s*الأولى|semester\s*1|الأسدس\s*1/i.test(t)) return '1';
        if (/S\s*2|الدورة\s*الثانية|semester\s*2|الأسدس\s*2/i.test(t)) return '2';
        return null;
    }

    /**
     * Year mismatch check (analysis boundary equivalent of checkYearMismatch).
     * Returns { mismatch, detectedYear, expectedYear, requiresDecision }.
     * Does not prompt UI — callers attach diagnostics.
     */
    function checkYearMismatchAnalysis(detectedYear, expectedYear) {
        const det = detectedYear ? String(detectedYear).trim() : null;
        const exp = expectedYear ? String(expectedYear).trim() : null;
        if (!det || !exp) {
            return { mismatch: false, detectedYear: det, expectedYear: exp, requiresDecision: false };
        }
        const yearsEqual =
            Contracts && typeof Contracts.schoolYearsEqual === 'function'
                ? Contracts.schoolYearsEqual(det, exp)
                : det === exp;
        const mismatch = !yearsEqual;
        return { mismatch, detectedYear: det, expectedYear: exp, requiresDecision: mismatch };
    }

    function yearDiagnostic(fileId, yearCheck) {
        if (!yearCheck || !yearCheck.requiresDecision) return null;
        const make =
            (AdapterBase && AdapterBase.makeDiagnostic) ||
            (Contracts && Contracts.createDiagnostic) ||
            ((p) => p);
        return make({
            code: 'YEAR_MISMATCH',
            severity: 'warning',
            stage: 'preflight',
            message: `السنة المكتشفة (${yearCheck.detectedYear}) تختلف عن المتوقعة (${yearCheck.expectedYear})`,
            fileId: fileId || '',
            sheet: null,
            row: null,
            field: 'school_year',
            rule: 'year_mismatch',
            action: 'change_year'
        });
    }

    /**
     * Run read-only preflight for one file item.
     *
     * @param {object} args
     * @param {object} args.file — File-like
     * @param {string} args.selectedType
     * @param {string|null} [args.expectedYear]
     * @param {string|null} [args.selectedYear]
     * @param {number} [args.decisionVersion]
     * @param {string} [args.fileId]
     * @param {object} [args.context] — must not allow writes
     * @returns {Promise<PreparedImport>}
     */
    async function runPreflight(args) {
        const a = args || {};
        const type = a.selectedType || a.type;
        const fileId = a.fileId || '';
        const decisionVersion = a.decisionVersion || 0;
        const context = Object.assign({}, a.context || {}, {
            fileId,
            expectedYear: a.expectedYear || null,
            selectedYear: a.selectedYear || a.expectedYear || null,
            decisionVersion,
            allowWrite: false,
            mutateReadiness: false,
            allowExecute: false
        });

        if (AdapterBase && typeof AdapterBase.assertReadOnlyContext === 'function') {
            AdapterBase.assertReadOnlyContext(context, 'preflight');
        }

        if (!type || type === 'unknown' || type === 'generic_csv_xlsx') {
            const empty =
                AdapterBase && typeof AdapterBase.emptyPreflight === 'function'
                    ? AdapterBase.emptyPreflight({
                          selectedType: type || 'unknown',
                          decisionVersion,
                          valid: false,
                          executable: false,
                          errors: [
                              {
                                  code: type === 'generic_csv_xlsx' ? 'GENERIC_DESTINATION_REQUIRED' : 'TYPE_REQUIRED',
                                  severity: 'error',
                                  stage: 'preflight',
                                  message:
                                      type === 'generic_csv_xlsx'
                                          ? 'اختر وجهة مدعومة لمسار CSV/XLSX العام'
                                          : 'يجب اختيار نوع الاستيراد قبل الفحص',
                                  fileId,
                                  action: 'change_type',
                                  rule: 'type_required',
                                  sheet: null,
                                  row: null,
                                  field: 'type'
                              }
                          ]
                      })
                    : { valid: false, decisionVersion, executable: false };
            return {
                type: type || 'unknown',
                preflight: empty,
                dependencyRefs: [],
                executionPayload: null,
                sourceFileId: fileId,
                readOnly: true
            };
        }

        const registry = Adapters || (rootAdapters());
        const adapter = registry && typeof registry.getAdapter === 'function' ? registry.getAdapter(type) : null;
        if (!adapter) {
            throw new Error(`No adapter for type: ${type}`);
        }

        // Extract features once for year detection if adapter does not
        let features = a.features || null;
        if (!features && Readers && typeof Readers.extractFeatures === 'function' && a.file) {
            features = await Readers.extractFeatures(a.file);
            context.features = features;
        }

        const prepared = await adapter.analyze(a.file, context);
        const pf = prepared.preflight || {};
        pf.decisionVersion = decisionVersion;
        pf.selectedType = type;
        pf.selectedYear = context.selectedYear || pf.selectedYear || null;
        pf.selectedTerm = pf.selectedTerm || null;

        // Year conflict attachment (file-scoped)
        const detected =
            pf.selectedYear ||
            (features && features.detectedYear) ||
            detectSchoolYearFromText(
                JSON.stringify((features && features.headers) || []) +
                    JSON.stringify((features && features.sampleRows) || [])
            );
        if (features && features.detectedYear) {
            // prefer features
        }
        const yearDetected = (features && features.detectedYear) || detected;
        if (yearDetected && !pf.selectedYear) pf.selectedYear = yearDetected;
        if (features && features.detectedTerm && !pf.selectedTerm) pf.selectedTerm = features.detectedTerm;

        const yearCheck = checkYearMismatchAnalysis(yearDetected, a.expectedYear);
        if (yearCheck.requiresDecision) {
            const yd = yearDiagnostic(fileId, yearCheck);
            if (yd) {
                pf.warnings = (pf.warnings || []).concat([yd]);
            }
            pf.valid = false;
            pf.executable = false;
            pf.yearDecisionRequired = true;
        }

        // Executable only when preflight says so and no year decision pending
        if (pf.zeroValidRows || pf.yearDecisionRequired) {
            pf.executable = false;
            pf.valid = false;
        }

        prepared.preflight = pf;
        prepared.readOnly = true;
        return prepared;
    }

    function rootAdapters() {
        if (typeof require === 'function') {
            try {
                return require('./adapters/index.js');
            } catch (_e) {
                return null;
            }
        }
        return null;
    }

    /**
     * Apply prepared preflight onto an ImportSession item with decisionVersion guard.
     * Rejects stale results (decisionVersion mismatch).
     */
    function applyPreparedToSession(session, fileId, prepared) {
        if (!session || typeof session.getFile !== 'function') return { applied: false, reason: 'no_session' };
        const item = session.getFile(fileId);
        if (!item) return { applied: false, reason: 'missing_item' };
        const pf = prepared && prepared.preflight;
        if (!pf) return { applied: false, reason: 'no_preflight' };
        if ((pf.decisionVersion || 0) !== (item.decisionVersion || 0)) {
            return { applied: false, reason: 'stale_decision_version' };
        }
        item.preflight = pf;
        item.dependencies = Array.isArray(prepared.dependencyRefs) ? prepared.dependencyRefs.slice() : [];
        item._prepared = {
            type: prepared.type,
            executionPayload: prepared.executionPayload,
            sourceFileId: prepared.sourceFileId,
            readOnly: true
        };
        // Merge diagnostics
        const extra = []
            .concat(pf.errors || [])
            .concat(pf.warnings || []);
        item.diagnostics = (item.diagnostics || []).filter((d) => d.stage !== 'preflight').concat(extra);

        if (pf.selectedYear) item.detectedYear = item.detectedYear || pf.selectedYear;
        if (pf.selectedTerm) item.detectedTerm = item.detectedTerm || pf.selectedTerm;
        if (pf.recordEstimate != null) item.recordEstimate = pf.recordEstimate;
        if (Array.isArray(pf.sheetsRead) && pf.sheetsRead.length) item.sheetNames = pf.sheetsRead.slice();

        // Ready only if preflight valid+executable and no review blockers
        if (pf.valid && pf.executable && !pf.yearDecisionRequired && !pf.zeroValidRows) {
            item.status = 'ready';
        } else if (item.status !== 'failed' && item.status !== 'skipped') {
            item.status = 'needs_review';
        }

        if (typeof session._emit === 'function') session._emit();
        else if (typeof session._recomputeTotals === 'function') session._recomputeTotals();
        return { applied: true, status: item.status };
    }

    /**
     * Invalidate path used when user changes type/year/destination.
     */
    function invalidateAndClear(session, fileId) {
        if (!session || typeof session.invalidatePreflight !== 'function') return false;
        return session.invalidatePreflight(fileId);
    }

    return {
        detectSchoolYearFromText,
        detectTermFromText,
        checkYearMismatchAnalysis,
        yearDiagnostic,
        runPreflight,
        applyPreparedToSession,
        invalidateAndClear
    };
});
