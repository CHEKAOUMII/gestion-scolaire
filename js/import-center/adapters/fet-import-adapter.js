/**
 * fet-import-adapter.js — Read-only analysis wrapper for importFetXml.
 * Reuses FET structural expectations; does not parse full timetable for write.
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
    if (root) root.FetImportAdapter = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (
    Base,
    Readers,
    RowVal
) {
    'use strict';

    const TYPE = 'fet';

    async function analyze(file, context) {
        const ctx = context || {};
        const fileId = ctx.fileId || '';
        const features =
            ctx.features ||
            (Readers && file ? await Readers.extractFeatures(file) : { error: 'no_reader', format: 'xml' });

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
                            message: 'تعذر قراءة ملف FET',
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

        const xmlVal = RowVal.validateXmlStructure({
            type: TYPE,
            xmlRoot: features.xmlRoot,
            xmlElements: features.xmlElements || [],
            fileId
        });

        // Optional teacher name resolution if candidates provided
        const unresolvedNames = [];
        if (ctx.resolveTeacherNames && Array.isArray(ctx.teacherNamesFromXml)) {
            for (let i = 0; i < ctx.teacherNamesFromXml.length; i++) {
                const r = RowVal.resolveNameWithEvidence(ctx.teacherNamesFromXml[i], ctx.nameCandidates || [], {
                    fileId,
                    row: i + 1
                });
                if (r.unresolved && r.unresolved.decisionRequired) unresolvedNames.push(r.unresolved);
            }
        }

        const deps = Base.defaultDependenciesFor(TYPE);
        const pf = Base.emptyPreflight({
            selectedType: TYPE,
            selectedYear: features.detectedYear || ctx.selectedYear || null,
            elementsRead: xmlVal.elementsRead,
            recordEstimate: xmlVal.recordEstimate,
            warnings: xmlVal.warnings.concat(
                unresolvedNames.length
                    ? [
                          Base.makeDiagnostic({
                              code: 'UNRESOLVED_NAMES',
                              severity: 'warning',
                              stage: 'preflight',
                              message: `${unresolvedNames.length} اسم أستاذ يحتاج مراجعة`,
                              fileId,
                              rule: 'name_resolver',
                              action: 'review'
                          })
                      ]
                    : []
            ),
            errors: xmlVal.errors,
            unresolvedNames,
            preview: [{ root: features.xmlRoot, elements: (features.xmlElements || []).slice(0, 8), _previewOnly: true, written: false }],
            dependencies: deps,
            decisionVersion: ctx.decisionVersion || 0,
            zeroValidRows: xmlVal.zeroValidRows,
            valid: xmlVal.executable,
            executable: xmlVal.executable
        });

        return {
            type: TYPE,
            preflight: pf,
            dependencyRefs: deps,
            executionPayload: {
                kind: 'fet_xml_meta',
                xmlRoot: features.xmlRoot,
                elements: features.xmlElements,
                notPersisted: true
            },
            sourceFileId: fileId
        };
    }

    return Base.createImportAdapter({
        type: TYPE,
        formats: ['xml'],
        manualFunctionName: 'importFetXml',
        canAnalyze(meta) {
            const f = (meta && meta.format) || (meta && meta.extension);
            return f === 'xml';
        },
        analyze
    });
});
