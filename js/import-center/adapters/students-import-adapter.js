/**
 * students-import-adapter.js — Read-only analysis wrapper for importStudents.
 * Dual-export
 */
(function (root, factory) {
    const Base =
        (root && root.ImportAdapterBase) ||
        (typeof require === 'function' ? require('./adapter-base.js') : null);
    const Readers =
        (root && root.ImportReaders) ||
        (typeof require === 'function' ? require('../import-readers.js') : null);
    const RowVal =
        (root && root.ImportRowValidation) ||
        (typeof require === 'function' ? require('../import-row-validation.js') : null);
    const api = factory(Base, Readers, RowVal);
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.StudentsImportAdapter = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (
    Base,
    Readers,
    RowVal
) {
    'use strict';

    const TYPE = 'students';

    async function analyze(file, context) {
        const ctx = context || {};
        const fileId = ctx.fileId || '';
        const features =
            ctx.features ||
            (Readers && file ? await Readers.extractFeatures(file) : { headers: [], sampleRows: [], error: 'no_reader' });

        if (features.error || features.empty) {
            const pf = Base.emptyPreflight({
                selectedType: TYPE,
                decisionVersion: ctx.decisionVersion || 0,
                errors: [
                    Base.makeDiagnostic({
                        code: 'READ_ERROR',
                        severity: 'error',
                        stage: 'preflight',
                        message: 'تعذر قراءة ملف التلاميذ',
                        fileId,
                        rule: features.error || 'empty_file',
                        action: 'reanalyze'
                    })
                ],
                executable: false,
                valid: false
            });
            return { type: TYPE, preflight: pf, dependencyRefs: Base.defaultDependenciesFor(TYPE), executionPayload: null, sourceFileId: fileId };
        }

        const rows = features.sampleRows || [];
        // Expand estimate: use sample only for validation; estimate from features
        const validation = RowVal.validateTabularRows({
            type: TYPE,
            headers: features.headers || [],
            rows,
            sheet: (features.sheetNames && features.sheetNames[0]) || null,
            fileId
        });

        const pf = Base.emptyPreflight({
            selectedType: TYPE,
            selectedYear: features.detectedYear || ctx.selectedYear || null,
            selectedTerm: features.detectedTerm || null,
            sheetsRead: features.sheetNames || [],
            elementsRead: [],
            recordEstimate: features.recordEstimate != null ? features.recordEstimate : validation.validCount,
            rowOutcomes: validation.rowOutcomes,
            warnings: validation.warnings,
            errors: validation.errors,
            unresolvedNames: validation.unresolvedNames,
            duplicates: validation.duplicates,
            preview: validation.preview,
            dependencies: Base.defaultDependenciesFor(TYPE),
            decisionVersion: ctx.decisionVersion || 0,
            zeroValidRows: validation.zeroValidRows,
            valid: validation.executable && validation.errors.filter((e) => e.severity === 'error' && e.code !== 'DUPLICATE_CODE').length === 0,
            executable: validation.executable
        });
        // zero valid => not valid
        if (validation.zeroValidRows) {
            pf.valid = false;
            pf.executable = false;
        }

        return {
            type: TYPE,
            preflight: pf,
            dependencyRefs: Base.defaultDependenciesFor(TYPE),
            executionPayload: {
                kind: 'students_rows',
                rows: validation.rowOutcomes.filter((r) => r.status === 'valid').map((r) => r.normalizedRecord),
                notPersisted: true
            },
            sourceFileId: fileId
        };
    }

    return Base.createImportAdapter({
        type: TYPE,
        formats: ['csv', 'xlsx'],
        manualFunctionName: 'importStudents',
        canAnalyze(meta) {
            const f = (meta && meta.format) || (meta && meta.extension);
            return f === 'csv' || f === 'xlsx' || f === 'xls';
        },
        analyze
        // execute intentionally omitted — guarded by base until orchestrator wraps importStudents
    });
});
