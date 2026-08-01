/**
 * import-contracts.js — Phase-one Import Center contracts and constants.
 *
 * Transient renderer-session contracts only. No File serialization,
 * no durable Job tables, no write signatures.
 *
 * Dual-export: window.ImportContracts + module.exports for Node tests.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.ImportContracts = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const IMPORT_SOURCE_TYPES = Object.freeze([
        'students',
        'grades',
        'absences',
        'fet',
        'agent_xml',
        'student_status',
        'generic_csv_xlsx',
        'unknown'
    ]);

    const REGISTERED_SOURCE_TYPES = Object.freeze([
        'students',
        'grades',
        'absences',
        'fet',
        'agent_xml',
        'student_status'
    ]);

    const IMPORT_SESSION_STATUSES = Object.freeze([
        'collecting',
        'analyzing',
        'reviewing',
        'ready',
        'importing',
        'completed',
        'cancelled'
    ]);

    const IMPORT_FILE_STATUSES = Object.freeze([
        'queued',
        'analyzing',
        'needs_review',
        'ready',
        'importing',
        'succeeded',
        'failed',
        'skipped',
        'blocked'
    ]);

    const DIAGNOSTIC_SEVERITIES = Object.freeze(['info', 'warning', 'error']);

    const DIAGNOSTIC_STAGES = Object.freeze([
        'reading',
        'classification',
        'preflight',
        'dependency',
        'write'
    ]);

    const EVIDENCE_KINDS = Object.freeze([
        'header',
        'sheet',
        'xml_root',
        'namespace',
        'element',
        'value_pattern',
        'year',
        'term',
        'context_hint',
        'filename_hint',
        'extension',
        'conflict'
    ]);

    const EVIDENCE_STRENGTHS = Object.freeze(['primary', 'supporting', 'negative']);
    const EVIDENCE_SOURCES = Object.freeze(['content', 'filename', 'extension', 'context']);

    const CONFIDENCE = Object.freeze({
        HIGH: 0.85,
        MEDIUM: 0.6,
        AMBIGUITY_GAP: 0.1
    });

    /** Phase-one boundary: analyze only — execute is deferred. */
    const PHASE_ONE = Object.freeze({
        writesAllowed: false,
        durableJobsAllowed: false,
        packages: Object.freeze([0, 1, 2]),
        analyzeOnly: true
    });

    const MANUAL_ACTIONS = Object.freeze([
        'students',
        'grades',
        'absences',
        'fet',
        'student-status',
        'orientation',
        'agent-xml'
    ]);

    const MANUAL_FUNCTION_NAMES = Object.freeze([
        'importStudents',
        'importGrades',
        'importAbsences',
        'importFetXml',
        'importAgentXml',
        'importStudentStatus',
        'importOrientation',
        'runImport',
        'handleImport'
    ]);

    const PROTECTED_FILE_INPUT_IDS = Object.freeze([
        'students-file-input',
        'grades-file-input',
        'absences-file-input',
        'fet-file-input',
        'status-file-input',
        'orientation-file-input',
        'agent-xml-file-input'
    ]);

    const ARABIC_LABELS = Object.freeze({
        students: 'التلاميذ',
        grades: 'النقط',
        absences: 'الغياب',
        fet: 'FET (جدول)',
        agent_xml: 'ملف الوزارة',
        student_status: 'الوضعيات الدراسية',
        orientation: 'التوجيه المدرسي',
        generic_csv_xlsx: 'CSV/XLSX عام',
        unknown: 'غير معروف',
        queued: 'في الانتظار',
        analyzing: 'جاري التحليل',
        needs_review: 'يحتاج مراجعة',
        ready: 'جاهز',
        importing: 'جاري الاستيراد',
        succeeded: 'نجح',
        failed: 'فشل',
        skipped: 'تم التخطي',
        blocked: 'محجوب',
        startImport: 'بدء استيراد الجاهز',
        chooseFiles: 'اختر الملفات',
        reanalyze: 'إعادة التحليل',
        skip: 'تخطي',
        changeType: 'تغيير النوع',
        confirm: 'تأكيد الاستيراد',
        manualSection: 'اختيار نوع الاستيراد يدويًا',
        backupSection: 'النسخ الاحتياطي والاستعادة',
        reviewQueue: 'مراجعة الملفات',
        smartIntake: 'الاستيراد الذكي متعدد الملفات'
    });

    function createEmptyTotals() {
        return {
            files: 0,
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
    }

    function createEmptyProgress() {
        return {
            phase: 'reading',
            completed: 0,
            total: null,
            percent: null,
            message: ''
        };
    }

    function createSourceContext(overrides) {
        return Object.assign(
            {
                mode: 'file_picker',
                typeHint: null,
                yearHint: null,
                sourcePage: null
            },
            overrides || {}
        );
    }

    /**
     * Build a serializable (non-File) snapshot of an ImportFileItem for review UI/tests.
     * Never includes File objects or raw content.
     */
    function serializeFileItemMeta(item) {
        if (!item || typeof item !== 'object') return null;
        return {
            id: item.id,
            name: item.name,
            extension: item.extension,
            size: item.size,
            fingerprint: item.fingerprint || null,
            duplicateOf: item.duplicateOf || null,
            status: item.status,
            detectedType: item.detectedType,
            selectedType: item.selectedType,
            confidence: item.confidence,
            evidence: Array.isArray(item.evidence) ? item.evidence.slice() : [],
            alternatives: Array.isArray(item.alternatives) ? item.alternatives.slice() : [],
            detectedYear: item.detectedYear,
            detectedTerm: item.detectedTerm,
            sheetNames: Array.isArray(item.sheetNames) ? item.sheetNames.slice() : [],
            recordEstimate: item.recordEstimate,
            diagnostics: Array.isArray(item.diagnostics) ? item.diagnostics.slice() : [],
            preflight: item.preflight
                ? {
                      valid: item.preflight.valid,
                      analyzedAt: item.preflight.analyzedAt,
                      selectedType: item.preflight.selectedType,
                      selectedYear: item.preflight.selectedYear,
                      selectedTerm: item.preflight.selectedTerm,
                      sheetsRead: item.preflight.sheetsRead,
                      elementsRead: item.preflight.elementsRead,
                      recordEstimate: item.preflight.recordEstimate,
                      decisionVersion: item.preflight.decisionVersion
                  }
                : null,
            decisionVersion: item.decisionVersion || 0,
            dependencies: Array.isArray(item.dependencies) ? item.dependencies.slice() : [],
            progress: item.progress ? Object.assign({}, item.progress) : createEmptyProgress(),
            result: item.result
                ? {
                      fileId: item.result.fileId,
                      status: item.result.status,
                      recordsWritten: item.result.recordsWritten,
                      recordsRejected: item.result.recordsRejected
                  }
                : null,
            retryCount: item.retryCount || 0
        };
    }

    /**
     * Session snapshot safe for logging/tests — excludes File and raw content.
     */
    function serializeSessionMeta(session) {
        if (!session || typeof session !== 'object') return null;
        return {
            id: session.id,
            createdAt: session.createdAt,
            expectedYear: session.expectedYear,
            sourceContext: session.sourceContext
                ? Object.assign({}, session.sourceContext)
                : createSourceContext(),
            status: session.status,
            files: Array.isArray(session.files) ? session.files.map(serializeFileItemMeta) : [],
            totals: session.totals ? Object.assign({}, session.totals) : createEmptyTotals(),
            report: session.report || null,
            phaseOne: true,
            durable: false
        };
    }

    function createDiagnostic(partial) {
        const d = Object.assign(
            {
                code: 'UNKNOWN',
                severity: 'info',
                stage: 'classification',
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
        return d;
    }

    function createEvidence(partial) {
        return Object.assign(
            {
                kind: 'header',
                label: '',
                detail: '',
                strength: 'supporting',
                source: 'content'
            },
            partial || {}
        );
    }

    function confidenceBand(score) {
        const n = Number(score);
        if (!Number.isFinite(n) || n < CONFIDENCE.MEDIUM) return 'low';
        if (n < CONFIDENCE.HIGH) return 'medium';
        return 'high';
    }

    /**
     * Apply ambiguity + confidence policy (Property 7).
     * Returns { band, needsReview, readyEligibleFromClassification }.
     * Classification alone never grants write readiness in phase one.
     */
    function applyConfidencePolicy(topScore, secondScore) {
        const top = Number(topScore);
        const second = secondScore == null ? null : Number(secondScore);
        const gap =
            second == null || !Number.isFinite(second) || !Number.isFinite(top)
                ? Infinity
                : top - second;
        const ambiguous = Number.isFinite(gap) && gap < CONFIDENCE.AMBIGUITY_GAP;
        const band = confidenceBand(top);
        const needsReview = ambiguous || band !== 'high';
        return {
            band,
            ambiguous,
            gap: Number.isFinite(gap) ? gap : null,
            needsReview,
            // Phase one: classification never alone makes an item executable/ready for write
            readyEligibleFromClassification: false,
            // High confidence may display as proposed-ready only after future preflight
            proposedReadyAfterPreflight: !ambiguous && band === 'high'
        };
    }

    function isRegisteredSource(type) {
        return REGISTERED_SOURCE_TYPES.includes(type);
    }

    function isImportSourceType(type) {
        return IMPORT_SOURCE_TYPES.includes(type);
    }

    function isImportFileStatus(status) {
        return IMPORT_FILE_STATUSES.includes(status);
    }

    function normalizeSchoolYear(value) {
        if (value == null) return null;
        const text = String(value).trim();
        if (!text) return null;
        const match = text.match(/^(20\d{2})\s*[-_/]\s*(20\d{2})$/);
        return match ? `${match[1]}-${match[2]}` : text;
    }

    function schoolYearsEqual(left, right) {
        const normalizedLeft = normalizeSchoolYear(left);
        const normalizedRight = normalizeSchoolYear(right);
        return normalizedLeft != null && normalizedRight != null && normalizedLeft === normalizedRight;
    }

    function isDiagnosticStage(stage) {
        return DIAGNOSTIC_STAGES.includes(stage);
    }

    return {
        IMPORT_SOURCE_TYPES,
        REGISTERED_SOURCE_TYPES,
        IMPORT_SESSION_STATUSES,
        IMPORT_FILE_STATUSES,
        DIAGNOSTIC_SEVERITIES,
        DIAGNOSTIC_STAGES,
        EVIDENCE_KINDS,
        EVIDENCE_STRENGTHS,
        EVIDENCE_SOURCES,
        CONFIDENCE,
        PHASE_ONE,
        MANUAL_ACTIONS,
        MANUAL_FUNCTION_NAMES,
        PROTECTED_FILE_INPUT_IDS,
        ARABIC_LABELS,
        createEmptyTotals,
        createEmptyProgress,
        createSourceContext,
        serializeFileItemMeta,
        serializeSessionMeta,
        createDiagnostic,
        createEvidence,
        confidenceBand,
        applyConfidencePolicy,
        isRegisteredSource,
        isImportSourceType,
        isImportFileStatus,
        normalizeSchoolYear,
        schoolYearsEqual,
        isDiagnosticStage
    };
});
