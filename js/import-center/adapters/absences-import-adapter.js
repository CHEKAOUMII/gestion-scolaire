/**
 * absences-import-adapter.js — Read-only analysis wrapper for importAbsences.
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
    if (root) root.AbsencesImportAdapter = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (
    Base,
    Readers,
    RowVal
) {
    'use strict';

    const TYPE = 'absences';

    async function analyze(file, context) {
        const ctx = context || {};
        const fileId = ctx.fileId || '';
        const features =
            ctx.features ||
            (Readers && file ? await Readers.extractFeatures(file) : { headers: [], sampleRows: [], error: 'no_reader' });

        if (features.error || features.empty) {
            return {
                type: TYPE,
                preflight: Base.emptyPreflight({
                    selectedType: TYPE,
                    decisionVersion: ctx.decisionVersion || 0,
                    errors: [
                        Base.makeDiagnostic({
                            code: 'READ_ERROR',
                            severity: 'error',
                            stage: 'preflight',
                            message: 'تعذر قراءة ملف الغياب',
                            fileId,
                            rule: features.error || 'empty_file',
                            action: 'reanalyze'
                        })
                    ],
                    valid: false,
                    executable: false
                }),
                dependencyRefs: Base.defaultDependenciesFor(TYPE),
                executionPayload: null,
                sourceFileId: fileId
            };
        }

        const validation = RowVal.validateTabularRows({
            type: TYPE,
            headers: features.headers || [],
            rows: features.sampleRows || [],
            sheet: (features.sheetNames && features.sheetNames[0]) || null,
            fileId
        });

        const deps = Base.defaultDependenciesFor(TYPE).map((d) => {
            if (d.sourceType === 'students' && ctx.studentsReady === true) {
                return Object.assign({}, d, { satisfied: true });
            }
            return Object.assign({}, d);
        });

        if (deps.some((d) => d.required && !d.satisfied)) {
            validation.warnings.push(
                Base.makeDiagnostic({
                    code: 'MISSING_DEPENDENCY',
                    severity: 'warning',
                    stage: 'dependency',
                    message: 'اعتماد ناقص: يجب توفر التلاميذ قبل الغياب',
                    fileId,
                    rule: 'dependency_students',
                    action: 'review'
                })
            );
        }

        const pf = Base.emptyPreflight({
            selectedType: TYPE,
            selectedYear: features.detectedYear || ctx.selectedYear || null,
            selectedTerm: features.detectedTerm || null,
            sheetsRead: features.sheetNames || [],
            recordEstimate: features.recordEstimate != null ? features.recordEstimate : validation.validCount,
            rowOutcomes: validation.rowOutcomes,
            warnings: validation.warnings,
            errors: validation.errors,
            unresolvedNames: validation.unresolvedNames,
            duplicates: validation.duplicates,
            preview: validation.preview,
            dependencies: deps,
            decisionVersion: ctx.decisionVersion || 0,
            zeroValidRows: validation.zeroValidRows,
            valid: validation.executable && !validation.zeroValidRows,
            executable: validation.executable && !validation.zeroValidRows
        });

        return {
            type: TYPE,
            preflight: pf,
            dependencyRefs: deps,
            executionPayload: {
                kind: 'absences_rows',
                rows: validation.rowOutcomes.filter((r) => r.status === 'valid').map((r) => r.normalizedRecord),
                notPersisted: true
            },
            sourceFileId: fileId
        };
    }

    return Base.createImportAdapter({
        type: TYPE,
        formats: ['csv', 'xlsx'],
        manualFunctionName: 'importAbsences',
        canAnalyze(meta) {
            const f = (meta && meta.format) || (meta && meta.extension);
            return f === 'csv' || f === 'xlsx' || f === 'xls';
        },
        analyze
    });
});
