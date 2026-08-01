/**
 * import-classifier.js — Independent content-based ImportClassifier.
 *
 * No DOM. No writes. Scores each file independently.
 * Dual-export: window.ImportClassifier + module.exports
 */
(function (root, factory) {
    const Contracts =
        (root && root.ImportContracts) ||
        (typeof require === 'function' ? require('./import-contracts.js') : null);
    const Signatures =
        (root && root.ImportSignatures) ||
        (typeof require === 'function' ? require('./import-signatures.js') : null);
    const Readers =
        (root && root.ImportReaders) ||
        (typeof require === 'function' ? require('./import-readers.js') : null);
    const api = factory(Contracts, Signatures, Readers);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.ImportClassifier = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (
    Contracts,
    Signatures,
    Readers
) {
    'use strict';

    const CONFIDENCE = (Contracts && Contracts.CONFIDENCE) || {
        HIGH: 0.85,
        MEDIUM: 0.6,
        AMBIGUITY_GAP: 0.1
    };

    function applyPolicy(top, second) {
        if (Contracts && typeof Contracts.applyConfidencePolicy === 'function') {
            return Contracts.applyConfidencePolicy(top, second);
        }
        const gap = second == null ? Infinity : top - second;
        const ambiguous = gap < CONFIDENCE.AMBIGUITY_GAP;
        const band =
            top >= CONFIDENCE.HIGH ? 'high' : top >= CONFIDENCE.MEDIUM ? 'medium' : 'low';
        return {
            band,
            ambiguous,
            gap: Number.isFinite(gap) ? gap : null,
            needsReview: ambiguous || band !== 'high',
            readyEligibleFromClassification: false,
            proposedReadyAfterPreflight: !ambiguous && band === 'high'
        };
    }

    /**
     * Classify from already-extracted features (pure, sync).
     */
    function classifyFeatures(features, context) {
        const f = features || {};
        const ctx = context || {};
        const contextTypeHint = ctx.typeHint || ctx.contextTypeHint || null;

        if (f.error === 'empty_file' || f.empty) {
            return {
                type: 'unknown',
                confidence: 0,
                evidence: [],
                alternatives: [],
                metadata: buildMetadata(f),
                needsReview: true,
                reviewReasons: ['empty_or_unreadable'],
                diagnostics: [
                    {
                        code: 'EMPTY_FILE',
                        severity: 'error',
                        stage: 'reading',
                        message: 'الملف فارغ أو غير قابل للقراءة',
                        fileId: ctx.fileId || '',
                        sheet: null,
                        row: null,
                        field: null,
                        rule: 'empty_file',
                        action: 'reanalyze'
                    }
                ],
                error: true
            };
        }

        if (f.error === 'unsupported_encoding') {
            return {
                type: 'unknown',
                confidence: 0,
                evidence: [],
                alternatives: [],
                metadata: buildMetadata(f),
                needsReview: true,
                reviewReasons: ['unsupported_encoding'],
                diagnostics: [
                    {
                        code: 'UNSUPPORTED_ENCODING',
                        severity: 'error',
                        stage: 'reading',
                        message:
                            'تعذّر قراءة ترميز الملف. أعد حفظه بترميز UTF-8 ثم أعد المحاولة — لن يتم استيراد نص مشوّه.',
                        fileId: ctx.fileId || '',
                        sheet: null,
                        row: null,
                        field: null,
                        rule: 'unsupported_encoding',
                        action: 'reanalyze'
                    }
                ],
                error: true
            };
        }

        if (f.error === 'unreadable' || f.error === 'parse_error') {
            return {
                type: 'unknown',
                confidence: 0,
                evidence: [],
                alternatives: [],
                metadata: buildMetadata(f),
                needsReview: true,
                reviewReasons: ['read_error'],
                diagnostics: [
                    {
                        code: 'READ_ERROR',
                        severity: 'error',
                        stage: 'reading',
                        message: 'تعذر قراءة الملف',
                        fileId: ctx.fileId || '',
                        sheet: null,
                        row: null,
                        field: null,
                        rule: String(f.error),
                        action: 'reanalyze'
                    }
                ],
                error: true
            };
        }

        const scoreInput = {
            format: f.format,
            headers: f.headers || [],
            sheetNames: f.sheetNames || [],
            contentText: f.contentText || '',
            xmlRoot: f.xmlRoot,
            xmlElements: f.xmlElements || [],
            filename: f.filename || ctx.filename || '',
            extension: f.extension || '',
            contextTypeHint
        };

        // Optional low-weight legacy filename hint
        if (ctx.legacyActionHint) {
            scoreInput._legacyActionHint = ctx.legacyActionHint;
        }

        const signatures = Signatures && typeof Signatures.listSignatures === 'function'
            ? Signatures.listSignatures()
            : [];
        const scored = [];
        for (const sig of signatures) {
            if (sig.type === 'generic_csv_xlsx') continue;
            const result =
                Signatures && typeof Signatures.scoreSignature === 'function'
                    ? Signatures.scoreSignature(sig, scoreInput)
                    : { type: sig.type, score: 0, evidence: [] };
            scored.push(result);
        }
        scored.sort((a, b) => b.score - a.score);

        let top = scored[0] || { type: 'unknown', score: 0, evidence: [] };
        let second = scored[1] || { type: 'unknown', score: 0, evidence: [] };

        // Generic tabular fallback when no registered source is strong enough
        const isTabular = f.format === 'csv' || f.format === 'xlsx';
        const genericSig = Signatures && Signatures.getSignature
            ? Signatures.getSignature('generic_csv_xlsx')
            : null;
        let genericScore = null;
        const topHasPrimaryContent = (top.evidence || []).some(
            (e) => e && e.source === 'content' && e.strength === 'primary'
        );
        const filenameAgreesWithTop =
            top.type &&
            scoreInput.filename &&
            Signatures &&
            Signatures.getSignature &&
            (Signatures.getSignature(top.type)?.filenameHints || []).some((re) => re.test(scoreInput.filename));

        // Do not let generic steal a content+filename-matched registered type
        if (
            isTabular &&
            (f.headers || []).length > 0 &&
            top.score < CONFIDENCE.MEDIUM &&
            !(topHasPrimaryContent && filenameAgreesWithTop && top.score >= 0.35)
        ) {
            genericScore =
                Signatures && typeof Signatures.scoreSignature === 'function' && genericSig
                    ? Signatures.scoreSignature(genericSig, scoreInput)
                    : { type: 'generic_csv_xlsx', score: 0.55, evidence: [] };
            if (genericScore.score >= top.score) {
                second = top;
                top = genericScore;
            }
        }

        // Boost borderline registered type when filename + primary content agree
        if (
            top.type !== 'generic_csv_xlsx' &&
            top.type !== 'unknown' &&
            topHasPrimaryContent &&
            filenameAgreesWithTop &&
            top.score >= 0.35 &&
            top.score < CONFIDENCE.HIGH
        ) {
            top = Object.assign({}, top, {
                score: Math.min(CONFIDENCE.HIGH, top.score + 0.2),
                evidence: (top.evidence || []).concat([
                    {
                        kind: 'filename_hint',
                        label: 'توافق الاسم والمحتوى',
                        detail: scoreInput.filename,
                        strength: 'supporting',
                        source: 'filename'
                    }
                ])
            });
        }

        // Unknown XML root
        if (f.format === 'xml' && f.xmlRoot) {
            const knownRoots = new Set();
            for (const sig of signatures) {
                for (const r of sig.xmlRoots || []) knownRoots.add(r);
            }
            if (!knownRoots.has(f.xmlRoot) && top.score < CONFIDENCE.HIGH) {
                top = {
                    type: 'unknown',
                    score: Math.min(top.score, 0.4),
                    evidence: [
                        {
                            kind: 'xml_root',
                            label: 'جذر غير معروف',
                            detail: f.xmlRoot,
                            strength: 'negative',
                            source: 'content'
                        }
                    ].concat(top.evidence || [])
                };
            }
        }

        // Attach legacy filename hint as auxiliary evidence only
        if (ctx.legacyActionHint) {
            const mapped = mapLegacyAction(ctx.legacyActionHint);
            if (mapped) {
                const hintEv = {
                    kind: 'filename_hint',
                    label: 'تلميح قديم بالاسم',
                    detail: String(ctx.legacyActionHint),
                    strength: 'supporting',
                    source: 'filename'
                };
                if (top.type === mapped) {
                    top.evidence = (top.evidence || []).concat([hintEv]);
                    // small boost but content still primary — already capped in signature scorer
                } else {
                    top.evidence = (top.evidence || []).concat([
                        Object.assign({}, hintEv, { strength: 'negative', kind: 'conflict' })
                    ]);
                }
            }
        }

        const policy = applyPolicy(top.score, second.score);
        const yearsEqual =
            Contracts && typeof Contracts.schoolYearsEqual === 'function'
                ? Contracts.schoolYearsEqual(f.detectedYear, ctx.expectedYear)
                : String(f.detectedYear || '').trim() === String(ctx.expectedYear || '').trim();
        const hasYearMismatch = Boolean(f.detectedYear && ctx.expectedYear && !yearsEqual);
        const reviewReasons = [];
        if (policy.ambiguous) reviewReasons.push('ambiguous_top_two');
        if (policy.band === 'low') reviewReasons.push('low_confidence');
        if (policy.band === 'medium') reviewReasons.push('medium_confidence');
        if (top.type === 'generic_csv_xlsx') reviewReasons.push('generic_destination_required');
        if (top.type === 'unknown') reviewReasons.push('unknown_type');
        if (hasYearMismatch) {
            reviewReasons.push('year_mismatch');
        }

        // Content precedence: never let context alone set type when content disagrees strongly
        const alternatives = scored
            .filter((s) => s.type !== top.type)
            .slice(0, 4)
            .map((s) => ({ type: s.type, confidence: s.score, evidence: s.evidence || [] }));

        if (genericScore && genericScore.type !== top.type) {
            alternatives.unshift({
                type: genericScore.type,
                confidence: genericScore.score,
                evidence: genericScore.evidence || []
            });
        }

        const needsReview =
            policy.needsReview ||
            top.type === 'unknown' ||
            top.type === 'generic_csv_xlsx' ||
            reviewReasons.includes('year_mismatch');

        return {
            type: top.type,
            confidence: top.score,
            evidence: top.evidence || [],
            alternatives,
            metadata: buildMetadata(f),
            needsReview: true, // phase one: always review before write
            reviewReasons: needsReview
                ? reviewReasons.length
                    ? reviewReasons
                    : ['explicit_review_required']
                : ['explicit_review_required'],
            policy,
            diagnostics:
                hasYearMismatch
                    ? [
                          {
                              code: 'YEAR_MISMATCH',
                              severity: 'warning',
                              stage: 'classification',
                              message: `السنة المكتشفة (${f.detectedYear}) تختلف عن المتوقعة (${ctx.expectedYear})`,
                              fileId: ctx.fileId || '',
                              sheet: null,
                              row: null,
                              field: 'school_year',
                              rule: 'year_mismatch',
                              action: 'change_year'
                          }
                      ]
                    : [],
            error: false
        };
    }

    function buildMetadata(f) {
        return {
            extension: f.extension || '',
            format: f.format || 'unknown',
            sheetNames: Array.isArray(f.sheetNames) ? f.sheetNames.slice() : [],
            detectedYear: f.detectedYear || null,
            detectedTerm: f.detectedTerm || null,
            recordEstimate: f.recordEstimate != null ? f.recordEstimate : null
        };
    }

    function mapLegacyAction(action) {
        const a = String(action || '').toLowerCase();
        if (a === 'students') return 'students';
        if (a === 'grades') return 'grades';
        if (a === 'absences') return 'absences';
        if (a === 'fet') return 'fet';
        if (a === 'agent-xml' || a === 'agent_xml') return 'agent_xml';
        if (a === 'student-status' || a === 'student_status') return 'student_status';
        return null;
    }

    /**
     * Classify a single File-like object independently.
     */
    async function classifyFile(file, context) {
        const ctx = context || {};
        if (!Readers || typeof Readers.extractFeatures !== 'function') {
            return classifyFeatures({ error: 'unreadable', format: 'unknown' }, ctx);
        }
        const features = await Readers.extractFeatures(file, {
            name: file && file.name,
            size: file && file.size
        });
        return classifyFeatures(features, Object.assign({ filename: file && file.name }, ctx));
    }

    /**
     * Classify a batch independently — never collapses to one batch-wide type.
     * @returns {Promise<object[]>} one result per file (same order)
     */
    async function classifyBatch(files, context) {
        const list = Array.isArray(files) ? files : [];
        const results = [];
        for (let i = 0; i < list.length; i++) {
            const file = list[i];
            try {
                // eslint-disable-next-line no-await-in-loop
                const r = await classifyFile(file, Object.assign({}, context, { fileId: context && context.fileIds ? context.fileIds[i] : '' }));
                results.push(r);
            } catch (e) {
                results.push({
                    type: 'unknown',
                    confidence: 0,
                    evidence: [],
                    alternatives: [],
                    metadata: { extension: '', format: 'unknown', sheetNames: [], detectedYear: null, detectedTerm: null, recordEstimate: null },
                    needsReview: true,
                    reviewReasons: ['read_error'],
                    diagnostics: [
                        {
                            code: 'READ_ERROR',
                            severity: 'error',
                            stage: 'reading',
                            message: (e && e.message) || 'تعذر قراءة الملف',
                            fileId: '',
                            sheet: null,
                            row: null,
                            field: null,
                            rule: 'exception',
                            action: 'reanalyze'
                        }
                    ],
                    error: true
                });
            }
        }
        return results;
    }

    return {
        classifyFeatures,
        classifyFile,
        classifyBatch,
        mapLegacyAction,
        CONFIDENCE
    };
});
