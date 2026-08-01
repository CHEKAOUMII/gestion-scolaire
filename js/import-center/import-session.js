/**
 * import-session.js — Renderer-memory ImportSession state machine (phase one).
 *
 * No localStorage, SQLite, or durable IPC. Transient File refs only.
 * Dual-export: window.ImportSession + module.exports
 */
(function (root, factory) {
    const Contracts =
        (root && root.ImportContracts) ||
        (typeof require === 'function' ? require('./import-contracts.js') : null);
    const api = factory(Contracts);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.ImportSession = api.ImportSession;
        root.ImportSessionAPI = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (Contracts) {
    'use strict';

    const C = Contracts || {};
    let _seq = 0;

    function uid(prefix) {
        _seq += 1;
        return `${prefix}_${Date.now().toString(36)}_${_seq.toString(36)}`;
    }

    function extensionOf(name) {
        const n = String(name || '');
        const i = n.lastIndexOf('.');
        return i >= 0 ? n.slice(i + 1).toLowerCase() : '';
    }

    /**
     * Lightweight non-crypto hash for session-local fingerprints (not security).
     * Never persists to SQLite/localStorage.
     */
    function hashString(input) {
        const s = String(input || '');
        let h = 2166136261;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0).toString(16).padStart(8, '0');
    }

    /**
     * Build a session-local fingerprint from metadata and optional bounded sample.
     * Does not store raw file bytes on the item.
     *
     * @param {{ name?: string, size?: number, lastModified?: number, type?: string }} file
     * @param {string|null} [contentSample] — optional short sample (e.g. first 2KB text)
     * @returns {string}
     */
    function computeFileFingerprint(file, contentSample) {
        const name = String((file && file.name) || '');
        const size = Number((file && file.size) || 0);
        const mod = Number((file && file.lastModified) || 0);
        const mime = String((file && file.type) || '');
        const sample = contentSample != null ? String(contentSample).slice(0, 2048) : '';
        return [
            'v1',
            hashString(name),
            String(size),
            String(mod || 0),
            hashString(mime),
            sample ? hashString(sample) : 'nosample'
        ].join(':');
    }

    const LEGAL_FILE_TRANSITIONS = Object.freeze({
        queued: Object.freeze(['analyzing', 'skipped', 'failed']),
        analyzing: Object.freeze(['needs_review', 'ready', 'failed', 'queued']),
        needs_review: Object.freeze(['analyzing', 'ready', 'skipped', 'failed', 'queued']),
        ready: Object.freeze(['analyzing', 'importing', 'needs_review', 'skipped', 'failed']),
        importing: Object.freeze(['succeeded', 'failed', 'blocked']),
        succeeded: Object.freeze([]),
        failed: Object.freeze(['analyzing', 'ready', 'skipped', 'queued']),
        skipped: Object.freeze(['queued', 'analyzing']),
        blocked: Object.freeze(['ready', 'skipped', 'analyzing'])
    });

    class ImportSession {
        /**
         * @param {object} [options]
         * @param {string|null} [options.expectedYear]
         * @param {object} [options.sourceContext]
         */
        constructor(options) {
            const opts = options || {};
            this.id = uid('session');
            this.createdAt = new Date().toISOString();
            this.expectedYear = opts.expectedYear != null ? String(opts.expectedYear) : null;
            this.sourceContext =
                typeof C.createSourceContext === 'function'
                    ? C.createSourceContext(opts.sourceContext)
                    : Object.assign(
                          { mode: 'file_picker', typeHint: null, yearHint: null, sourcePage: null },
                          opts.sourceContext || {}
                      );
            this.status = 'collecting';
            /** @type {object[]} */
            this.files = [];
            this.dependencyGraph = { nodes: [], edges: [] };
            this.totals =
                typeof C.createEmptyTotals === 'function'
                    ? C.createEmptyTotals()
                    : {
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
            this.report = null;
            this._listeners = [];
        }

        onChange(fn) {
            if (typeof fn === 'function') this._listeners.push(fn);
            return () => {
                this._listeners = this._listeners.filter((f) => f !== fn);
            };
        }

        _emit() {
            this._recomputeTotals();
            for (const fn of this._listeners) {
                try {
                    fn(this);
                } catch (_e) {
                    /* ignore view errors */
                }
            }
        }

        _recomputeTotals() {
            const t =
                typeof C.createEmptyTotals === 'function'
                    ? C.createEmptyTotals()
                    : {
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
            t.files = this.files.length;
            for (const f of this.files) {
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
            this.totals = t;
        }

        /**
         * Add a batch of File-like objects. Creates exactly one independent item per file.
         * Preserves insertion order.
         * @param {Array<File|{name:string,size?:number,type?:string}>} files
         * @param {object} [meta]
         * @returns {object[]} created items
         */
        addFiles(files, meta) {
            const list = Array.isArray(files) ? files : [];
            const created = [];
            const mode = (meta && meta.mode) || this.sourceContext.mode || 'file_picker';
            if (meta && meta.mode) this.sourceContext.mode = mode;
            const withFingerprint = !meta || meta.fingerprint !== false;

            for (const file of list) {
                const name = String(file && file.name != null ? file.name : 'unknown');
                const sample =
                    file && typeof file.content === 'string'
                        ? file.content.slice(0, 2048)
                        : meta && meta.samples && meta.samples[name]
                          ? String(meta.samples[name]).slice(0, 2048)
                          : null;
                const fingerprint = withFingerprint ? computeFileFingerprint(file, sample) : null;
                const item = {
                    id: uid('file'),
                    file: file || null,
                    name,
                    extension: extensionOf(name),
                    size: Number(file && file.size) || 0,
                    fingerprint,
                    status: 'queued',
                    detectedType: 'unknown',
                    selectedType: null,
                    confidence: 0,
                    evidence: [],
                    alternatives: [],
                    detectedYear: null,
                    detectedTerm: null,
                    sheetNames: [],
                    recordEstimate: null,
                    diagnostics: [],
                    preflight: null,
                    dependencies: [],
                    progress:
                        typeof C.createEmptyProgress === 'function'
                            ? C.createEmptyProgress()
                            : { phase: 'reading', completed: 0, total: null, percent: null, message: '' },
                    result: null,
                    retryCount: 0,
                    decisionVersion: 0,
                    reviewReasons: [],
                    analysis: null,
                    duplicateOf: null
                };
                this.files.push(item);
                created.push(item);
            }

            // Session-local duplicate warnings only (Package 5.3)
            this.applyDuplicateWarnings(created.map((c) => c.id));

            if (this.status === 'collecting' || this.status === 'reviewing' || this.status === 'ready') {
                this.status = 'collecting';
            }
            this._emit();
            return created;
        }

        /**
         * Set or refresh fingerprint for an item (e.g. after bounded read sample available).
         * Does not persist fingerprint outside the session.
         */
        setFingerprint(fileId, fingerprintOrSample) {
            const item = this.getFile(fileId);
            if (!item) return false;
            if (typeof fingerprintOrSample === 'string' && fingerprintOrSample.startsWith('v1:')) {
                item.fingerprint = fingerprintOrSample;
            } else {
                item.fingerprint = computeFileFingerprint(item.file || item, fingerprintOrSample);
            }
            this.applyDuplicateWarnings([fileId]);
            this._emit();
            return true;
        }

        /**
         * Mark session-local duplicates by fingerprint (and name+size fallback).
         * Warnings only — never auto-skip or write.
         * @param {string[]} [focusIds]
         * @returns {Array<{ fileId: string, duplicateOf: string, reason: string }>}
         */
        applyDuplicateWarnings(focusIds) {
            const findings = [];
            const byFp = new Map();
            for (const f of this.files) {
                if (f.status === 'skipped') continue;
                const key =
                    f.fingerprint ||
                    `name:${String(f.name).toLowerCase()}|size:${Number(f.size) || 0}`;
                if (!byFp.has(key)) byFp.set(key, []);
                byFp.get(key).push(f);
            }

            const focus = Array.isArray(focusIds) && focusIds.length ? new Set(focusIds) : null;

            for (const [, group] of byFp) {
                if (group.length < 2) {
                    for (const f of group) {
                        if (f.duplicateOf) {
                            f.duplicateOf = null;
                            f.diagnostics = (f.diagnostics || []).filter((d) => d.code !== 'DUPLICATE_FILE');
                        }
                    }
                    continue;
                }
                const primary = group[0];
                for (let i = 1; i < group.length; i++) {
                    const f = group[i];
                    if (focus && !focus.has(f.id) && !focus.has(primary.id)) {
                        // still mark if already in session
                    }
                    f.duplicateOf = primary.id;
                    const msg = `ملف مكرر في الجلسة (مشابه لـ ${primary.name})`;
                    f.diagnostics = (f.diagnostics || []).filter((d) => d.code !== 'DUPLICATE_FILE');
                    f.diagnostics.push(
                        typeof C.createDiagnostic === 'function'
                            ? C.createDiagnostic({
                                  code: 'DUPLICATE_FILE',
                                  severity: 'warning',
                                  stage: 'reading',
                                  message: msg,
                                  fileId: f.id,
                                  rule: 'session_fingerprint',
                                  action: 'review'
                              })
                            : {
                                  code: 'DUPLICATE_FILE',
                                  severity: 'warning',
                                  stage: 'reading',
                                  message: msg,
                                  fileId: f.id,
                                  sheet: null,
                                  row: null,
                                  field: null,
                                  rule: 'session_fingerprint',
                                  action: 'review'
                              }
                    );
                    findings.push({ fileId: f.id, duplicateOf: primary.id, reason: msg });
                }
            }
            return findings;
        }

        /**
         * List current session-local duplicate pairs (no persistence).
         */
        getDuplicateWarnings() {
            return this.files
                .filter((f) => f.duplicateOf)
                .map((f) => ({
                    fileId: f.id,
                    name: f.name,
                    duplicateOf: f.duplicateOf,
                    fingerprint: f.fingerprint
                }));
        }

        getFile(fileId) {
            return this.files.find((f) => f.id === fileId) || null;
        }

        /**
         * @param {string} fileId
         * @param {string} nextStatus
         * @returns {boolean}
         */
        setFileStatus(fileId, nextStatus) {
            const item = this.getFile(fileId);
            if (!item) return false;
            const allowed = LEGAL_FILE_TRANSITIONS[item.status] || [];
            if (!allowed.includes(nextStatus) && item.status !== nextStatus) {
                return false;
            }
            item.status = nextStatus;
            this._emit();
            return true;
        }

        /**
         * Apply classification result to one item without mutating siblings.
         */
        applyClassification(fileId, classification) {
            const item = this.getFile(fileId);
            if (!item) return false;
            const c = classification || {};
            item.analysis = c;
            item.detectedType = c.type || 'unknown';
            item.confidence = Number(c.confidence) || 0;
            item.evidence = Array.isArray(c.evidence) ? c.evidence.slice() : [];
            item.alternatives = Array.isArray(c.alternatives) ? c.alternatives.slice() : [];
            item.reviewReasons = Array.isArray(c.reviewReasons) ? c.reviewReasons.slice() : [];
            if (c.metadata) {
                item.detectedYear = c.metadata.detectedYear != null ? c.metadata.detectedYear : item.detectedYear;
                item.detectedTerm = c.metadata.detectedTerm != null ? c.metadata.detectedTerm : item.detectedTerm;
                item.sheetNames = Array.isArray(c.metadata.sheetNames)
                    ? c.metadata.sheetNames.slice()
                    : item.sheetNames;
                item.recordEstimate =
                    c.metadata.recordEstimate != null ? c.metadata.recordEstimate : item.recordEstimate;
            }
            if (Array.isArray(c.diagnostics)) {
                item.diagnostics = c.diagnostics.slice();
            }
            if (c.error) {
                item.status = 'failed';
            } else if (c.needsReview || !item.selectedType) {
                // High confidence still needs review for write in phase one; may set selectedType proposal
                if (!item.selectedType && c.type && c.type !== 'unknown' && c.type !== 'generic_csv_xlsx') {
                    item.selectedType = c.type;
                }
                item.status = c.needsReview || c.type === 'generic_csv_xlsx' || c.type === 'unknown'
                    ? 'needs_review'
                    : 'needs_review';
                // Phase one: never mark ready from classification alone
                item.status = 'needs_review';
            } else {
                item.status = 'needs_review';
            }
            this.status = 'reviewing';
            this._emit();
            return true;
        }

        /**
         * User decision: type / year / generic destination — increments decisionVersion and clears stale preflight.
         */
        setDecision(fileId, decision) {
            const item = this.getFile(fileId);
            if (!item) return false;
            const d = decision || {};
            let changed = false;
            if (d.selectedType != null && d.selectedType !== item.selectedType) {
                item.selectedType = d.selectedType;
                changed = true;
            }
            if (d.selectedYear != null && d.selectedYear !== item.detectedYear) {
                // store as selected year on preflight clear path
                item._selectedYear = d.selectedYear;
                changed = true;
            }
            if (d.genericDestination != null) {
                item.selectedType = d.genericDestination;
                changed = true;
            }
            if (changed) {
                item.decisionVersion = (item.decisionVersion || 0) + 1;
                item.preflight = null;
                // Stale readiness cleared
                if (item.status === 'ready') item.status = 'needs_review';
            }
            this._emit();
            return changed;
        }

        /**
         * Invalidate preflight when type/year/destination changes (monotonic decisionVersion).
         */
        invalidatePreflight(fileId) {
            const item = this.getFile(fileId);
            if (!item) return false;
            item.decisionVersion = (item.decisionVersion || 0) + 1;
            item.preflight = null;
            item._prepared = null;
            if (item.status === 'ready') item.status = 'needs_review';
            this._emit();
            return true;
        }

        /**
         * Apply a prepared preflight only if decisionVersion matches (Package 3).
         * @returns {{ applied: boolean, reason?: string, status?: string }}
         */
        applyPreflight(fileId, prepared) {
            const item = this.getFile(fileId);
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
            const extra = [].concat(pf.errors || []).concat(pf.warnings || []);
            item.diagnostics = (item.diagnostics || []).filter((d) => d.stage !== 'preflight').concat(extra);
            if (pf.selectedYear) item.detectedYear = item.detectedYear || pf.selectedYear;
            if (pf.selectedTerm) item.detectedTerm = item.detectedTerm || pf.selectedTerm;
            if (pf.recordEstimate != null) item.recordEstimate = pf.recordEstimate;
            if (Array.isArray(pf.sheetsRead) && pf.sheetsRead.length) item.sheetNames = pf.sheetsRead.slice();

            if (pf.valid && pf.executable && !pf.yearDecisionRequired && !pf.zeroValidRows) {
                item.status = 'ready';
            } else if (item.status !== 'failed' && item.status !== 'skipped') {
                item.status = 'needs_review';
            }
            this.status = 'reviewing';
            this._emit();
            return { applied: true, status: item.status };
        }

        removeFile(fileId) {
            const idx = this.files.findIndex((f) => f.id === fileId);
            if (idx < 0) return false;
            this.files.splice(idx, 1);
            this._emit();
            return true;
        }

        skipFile(fileId) {
            return this.setFileStatus(fileId, 'skipped');
        }

        /**
         * Explicit confirmation freezes eligible ready set for orchestrator execution.
         * needs_review items are excluded. Does not write by itself.
         * @returns {{ confirmed: boolean, fileIds: string[], reason?: string }}
         */
        confirmReadySet() {
            if (this.status === 'importing') {
                return { confirmed: false, fileIds: [], reason: 'already_importing' };
            }
            const eligible = this.files.filter((f) => f.status === 'ready');
            if (!eligible.length) {
                return { confirmed: false, fileIds: [], reason: 'no_ready_items' };
            }
            this.status = 'ready';
            this._confirmedSnapshot = {
                at: new Date().toISOString(),
                fileIds: eligible.map((f) => f.id),
                decisionVersions: eligible.map((f) => ({
                    id: f.id,
                    decisionVersion: f.decisionVersion,
                    selectedType: f.selectedType,
                    selectedYear: f._selectedYear || f.detectedYear
                }))
            };
            this._executedIds = this._executedIds || new Set();
            this._emit();
            return { confirmed: true, fileIds: this._confirmedSnapshot.fileIds.slice() };
        }

        /**
         * True when a confirmed ready snapshot exists and session is not mid-import.
         */
        canExecute() {
            if (this.status === 'importing') return false;
            if (!this._confirmedSnapshot || !Array.isArray(this._confirmedSnapshot.fileIds)) return false;
            return this._confirmedSnapshot.fileIds.length > 0;
        }

        /**
         * Serializable meta without File / raw content.
         */
        toJSON() {
            if (typeof C.serializeSessionMeta === 'function') {
                return C.serializeSessionMeta(this);
            }
            return {
                id: this.id,
                createdAt: this.createdAt,
                expectedYear: this.expectedYear,
                status: this.status,
                files: this.files.map((f) => ({
                    id: f.id,
                    name: f.name,
                    extension: f.extension,
                    size: f.size,
                    status: f.status,
                    detectedType: f.detectedType,
                    selectedType: f.selectedType,
                    confidence: f.confidence,
                    decisionVersion: f.decisionVersion
                })),
                totals: Object.assign({}, this.totals),
                durable: false
            };
        }

        /**
         * Ensure File objects are not present in serialized form.
         */
        static assertNoDurablePersistence(serialized) {
            if (!serialized || typeof serialized !== 'object') return true;
            if (serialized.files) {
                for (const f of serialized.files) {
                    if (f && f.file != null && typeof f.file === 'object' && f.file.name && f.file.size != null) {
                        throw new Error('Session serialization must not include File objects');
                    }
                    if (f && f.rawContent != null) {
                        throw new Error('Session serialization must not include raw content');
                    }
                    // Fingerprint metadata is allowed in meta snapshots; raw content is not
                    if (f && f.contentSample != null) {
                        throw new Error('Session serialization must not include content samples');
                    }
                }
            }
            return true;
        }

        /** Reload has no restoration path — factory only. */
        static create(options) {
            return new ImportSession(options);
        }

        static get LEGAL_FILE_TRANSITIONS() {
            return LEGAL_FILE_TRANSITIONS;
        }

        static computeFileFingerprint(file, contentSample) {
            return computeFileFingerprint(file, contentSample);
        }
    }

    return {
        ImportSession,
        LEGAL_FILE_TRANSITIONS,
        uid,
        extensionOf,
        computeFileFingerprint,
        hashString
    };
});
