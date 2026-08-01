/**
 * agent-xml-import-adapter.js — Read-only analysis wrapper for importAgentXml.
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
    if (root) root.AgentXmlImportAdapter = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (
    Base,
    Readers,
    RowVal
) {
    'use strict';

    const TYPE = 'agent_xml';

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
                            message: 'تعذر قراءة ملف الوزارة',
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

        const pf = Base.emptyPreflight({
            selectedType: TYPE,
            selectedYear: features.detectedYear || ctx.selectedYear || null,
            elementsRead: xmlVal.elementsRead,
            recordEstimate: xmlVal.recordEstimate,
            warnings: xmlVal.warnings,
            errors: xmlVal.errors,
            preview: [{ root: features.xmlRoot, elements: (features.xmlElements || []).slice(0, 8), _previewOnly: true, written: false }],
            dependencies: Base.defaultDependenciesFor(TYPE),
            decisionVersion: ctx.decisionVersion || 0,
            zeroValidRows: xmlVal.zeroValidRows,
            valid: xmlVal.executable,
            executable: xmlVal.executable
        });

        return {
            type: TYPE,
            preflight: pf,
            dependencyRefs: Base.defaultDependenciesFor(TYPE),
            executionPayload: {
                kind: 'agent_xml_meta',
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
        manualFunctionName: 'importAgentXml',
        canAnalyze(meta) {
            const f = (meta && meta.format) || (meta && meta.extension);
            return f === 'xml';
        },
        analyze
    });
});
