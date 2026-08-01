/**
 * import-row-validation.js — Row-level validation and NameResolver evidence (Package 3).
 *
 * Valid rows continue after invalid rows. Zero valid rows => not executable.
 * Reuses NameResolver rules; does not invent a parallel matcher.
 *
 * Dual-export: window.ImportRowValidation + module.exports
 */
(function (root, factory) {
    const Contracts =
        (root && root.ImportContracts) ||
        (typeof require === 'function' ? require('./import-contracts.js') : null);
    // NameResolver may be global class or required
    let NameResolverRef = root && root.NameResolver ? root.NameResolver : null;
    if (!NameResolverRef && typeof require === 'function') {
        try {
            NameResolverRef = require('../name-resolver.js');
        } catch (_e) {
            NameResolverRef = null;
        }
    }
    const api = factory(Contracts, NameResolverRef);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.ImportRowValidation = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (
    Contracts,
    NameResolverRef
) {
    'use strict';

    const MAX_PREVIEW = 8;

    function diagnostic(partial) {
        if (Contracts && typeof Contracts.createDiagnostic === 'function') {
            return Contracts.createDiagnostic(partial);
        }
        return Object.assign(
            {
                code: 'ROW',
                severity: 'error',
                stage: 'preflight',
                message: '',
                fileId: '',
                sheet: null,
                row: null,
                field: null,
                rule: null,
                action: 'review'
            },
            partial || {}
        );
    }

    function normalizeHeader(h) {
        return String(h || '')
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[\u064B-\u065F]/g, '')
            .replace(/[_\s\-./\\]+/g, '')
            .trim();
    }

    function headerIndex(headers, aliases) {
        const list = Array.isArray(headers) ? headers : [];
        for (let i = 0; i < list.length; i++) {
            const key = normalizeHeader(list[i]);
            if (!key) continue;
            for (const alias of aliases) {
                const a = normalizeHeader(alias);
                if (a && (key === a || key.includes(a) || a.includes(key))) return i;
            }
        }
        return -1;
    }

    const CODE_ALIASES = [
        'code',
        'studentcode',
        'massar',
        'massarcode',
        'codemassar',
        'codeeleve',
        'مسار',
        'الرمز',
        'رمز',
        'رقمالتلميذ',
        'cne',
        'رمزمسار'
    ];
    const NAME_ALIASES = ['fullname', 'studentname', 'nomcomplet', 'الاسمالكامل', 'الاسموالنسب', 'الاسم', 'name', 'prenom'];
    const SECTION_ALIASES = ['section', 'class', 'classe', 'group', 'القسم', 'الفصل'];
    const SUBJECT_ALIASES = ['subject', 'matiere', 'module', 'المادة', 'مادة'];
    const GRADE_ALIASES = ['grade', 'score', 'note', 'mark', 'النقطة', 'النقط', 'الدرجة'];
    const TEACHER_ALIASES = ['teacher', 'teachername', 'prof', 'professeur', 'الأستاذ', 'الاستاذ', 'اسمالأستاذ'];
    const ABSENCE_DATE_ALIASES = ['absencedate', 'date', 'dateabsence', 'تاريخالغياب'];
    const HOURS_ALIASES = ['hours', 'heures', 'الساعات', 'عددالساعات', 'justifiedhours', 'unjustifiedhours', 'مبرر', 'غيرمبرر'];
    const STATUS_ALIASES = ['status', 'الوضعية', 'وضعية', 'منقطع', 'مفصول'];

    /**
     * Resolve a person name via existing NameResolver contract (order preserved).
     * @returns {{ resolved: boolean, result: object, evidence: object|null, unresolved: object|null }}
     */
    function resolveNameWithEvidence(rawName, candidates, options) {
        const opts = options || {};
        const fileId = opts.fileId || '';
        const sheet = opts.sheet != null ? opts.sheet : null;
        const row = opts.row != null ? opts.row : null;
        const input = String(rawName || '').trim();

        if (!input) {
            return {
                resolved: false,
                result: { candidateId: null, confidence: 0, matchType: 'empty', needsReview: true },
                evidence: null,
                unresolved: {
                    fileId,
                    sheet,
                    row,
                    input: '',
                    resolverStage: 'empty',
                    candidates: [],
                    decisionRequired: false
                }
            };
        }

        if (!NameResolverRef) {
            return {
                resolved: false,
                result: { candidateId: null, confidence: 0, matchType: 'resolver_unavailable', needsReview: true },
                evidence: {
                    kind: 'conflict',
                    label: 'NameResolver',
                    detail: 'unavailable',
                    strength: 'negative',
                    source: 'content'
                },
                unresolved: {
                    fileId,
                    sheet,
                    row,
                    input,
                    resolverStage: 'unavailable',
                    candidates: [],
                    decisionRequired: true
                }
            };
        }

        const list = (candidates || []).map((c, i) => {
            if (typeof c === 'string') return { id: i + 1, name: c };
            return { id: c.id != null ? c.id : i + 1, name: c.name || c.teacher_name || c.full_name || '' };
        });
        const resolver = new NameResolverRef(list);
        const result = resolver.resolve(input);
        const needsReview = !!(result.needsReview || !result.candidateId);
        const evidence = {
            kind: 'value_pattern',
            label: 'NameResolver',
            detail: `${result.matchType || 'unmatched'} (${Math.round((result.confidence || 0) * 100)}%)`,
            strength: result.candidateId && !needsReview ? 'primary' : 'supporting',
            source: 'content',
            matchType: result.matchType,
            confidence: result.confidence,
            candidateId: result.candidateId != null ? result.candidateId : null
        };

        if (needsReview || !result.candidateId) {
            return {
                resolved: false,
                result,
                evidence,
                unresolved: {
                    fileId,
                    sheet,
                    row,
                    input,
                    resolverStage: result.matchType || 'unmatched',
                    candidates: Array.isArray(result.candidates)
                        ? result.candidates
                        : result.candidateId
                          ? [{ candidateId: result.candidateId, confidence: result.confidence, name: result.normalizedName }]
                          : [],
                    decisionRequired: true
                }
            };
        }

        return { resolved: true, result, evidence, unresolved: null };
    }

    /**
     * Validate tabular rows for a selected import type.
     * Never short-circuits remaining rows after an invalid row.
     *
     * @param {object} options
     * @param {string} options.type
     * @param {string[]} options.headers
     * @param {Array<Array>} options.rows — data rows (not including header)
     * @param {string|null} [options.sheet]
     * @param {string} [options.fileId]
     * @param {Array} [options.nameCandidates] — for NameResolver
     * @param {boolean} [options.resolveTeacherNames]
     * @returns {object}
     */
    function validateTabularRows(options) {
        const opts = options || {};
        const type = opts.type || 'unknown';
        const headers = Array.isArray(opts.headers) ? opts.headers : [];
        const rows = Array.isArray(opts.rows) ? opts.rows : [];
        const sheet = opts.sheet != null ? opts.sheet : null;
        const fileId = opts.fileId || '';
        const rowOutcomes = [];
        const unresolvedNames = [];
        const duplicates = [];
        const errors = [];
        const warnings = [];
        const preview = [];
        const seenCodes = new Map();

        const codeIdx = headerIndex(headers, CODE_ALIASES);
        const nameIdx = headerIndex(headers, NAME_ALIASES);
        const sectionIdx = headerIndex(headers, SECTION_ALIASES);
        const subjectIdx = headerIndex(headers, SUBJECT_ALIASES);
        const gradeIdx = headerIndex(headers, GRADE_ALIASES);
        const teacherIdx = headerIndex(headers, TEACHER_ALIASES);
        const dateIdx = headerIndex(headers, ABSENCE_DATE_ALIASES);
        const hoursIdx = headerIndex(headers, HOURS_ALIASES);
        const statusIdx = headerIndex(headers, STATUS_ALIASES);

        // Structural header checks (file-level, not row abort)
        if (type === 'students' || type === 'grades' || type === 'absences' || type === 'student_status') {
            if (codeIdx < 0) {
                errors.push(
                    diagnostic({
                        code: 'MISSING_CODE_HEADER',
                        severity: 'error',
                        stage: 'preflight',
                        message: 'عمود رمز التلميذ مفقود',
                        fileId,
                        sheet,
                        field: 'code',
                        rule: 'required_header',
                        action: 'review'
                    })
                );
            }
        }
        if (type === 'grades' && gradeIdx < 0 && subjectIdx < 0) {
            warnings.push(
                diagnostic({
                    code: 'WEAK_GRADES_HEADERS',
                    severity: 'warning',
                    stage: 'preflight',
                    message: 'عناوين النقط/المادة ضعيفة أو مفقودة',
                    fileId,
                    sheet,
                    rule: 'optional_header',
                    action: 'review'
                })
            );
        }
        if (type === 'absences' && dateIdx < 0 && hoursIdx < 0) {
            warnings.push(
                diagnostic({
                    code: 'WEAK_ABSENCE_HEADERS',
                    severity: 'warning',
                    stage: 'preflight',
                    message: 'عناوين الغياب ضعيفة أو مفقودة',
                    fileId,
                    sheet,
                    rule: 'optional_header',
                    action: 'review'
                })
            );
        }
        if (type === 'student_status' && statusIdx < 0) {
            warnings.push(
                diagnostic({
                    code: 'WEAK_STATUS_HEADER',
                    severity: 'warning',
                    stage: 'preflight',
                    message: 'عمود الوضعية غير واضح — قد تُستنتج من اسم الورقة',
                    fileId,
                    sheet,
                    rule: 'optional_header',
                    action: 'review'
                })
            );
        }

        let validCount = 0;
        let invalidCount = 0;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i] || [];
            const rowNumber = i + 2; // 1-based data after header
            const diagnostics = [];
            let status = 'valid';
            let normalizedRecord = null;

            const code = codeIdx >= 0 ? String(row[codeIdx] ?? '').trim() : '';
            const fullName = nameIdx >= 0 ? String(row[nameIdx] ?? '').trim() : '';
            const section = sectionIdx >= 0 ? String(row[sectionIdx] ?? '').trim() : '';
            const subject = subjectIdx >= 0 ? String(row[subjectIdx] ?? '').trim() : '';
            const gradeRaw = gradeIdx >= 0 ? row[gradeIdx] : '';
            const teacherName = teacherIdx >= 0 ? String(row[teacherIdx] ?? '').trim() : '';
            const absDate = dateIdx >= 0 ? String(row[dateIdx] ?? '').trim() : '';
            const hoursRaw = hoursIdx >= 0 ? row[hoursIdx] : '';
            const statusVal = statusIdx >= 0 ? String(row[statusIdx] ?? '').trim() : '';

            // Skip fully empty rows
            const any = row.some((c) => String(c ?? '').trim() !== '');
            if (!any) continue;

            if (codeIdx >= 0 && !code) {
                status = 'invalid';
                diagnostics.push(
                    diagnostic({
                        code: 'MISSING_CODE',
                        severity: 'error',
                        stage: 'preflight',
                        message: 'رمز التلميذ مفقود',
                        fileId,
                        sheet,
                        row: rowNumber,
                        field: 'code',
                        rule: 'required_field',
                        action: 'review'
                    })
                );
            }

            if (type === 'grades' && gradeIdx >= 0) {
                const g = Number(gradeRaw);
                if (gradeRaw !== '' && gradeRaw != null && (!Number.isFinite(g) || g < 0 || g > 20)) {
                    status = 'invalid';
                    diagnostics.push(
                        diagnostic({
                            code: 'INVALID_GRADE',
                            severity: 'error',
                            stage: 'preflight',
                            message: 'نقطة خارج النطاق 0–20',
                            fileId,
                            sheet,
                            row: rowNumber,
                            field: 'grade',
                            rule: 'grade_range',
                            action: 'review'
                        })
                    );
                }
            }

            if (type === 'absences' && hoursIdx >= 0 && hoursRaw !== '' && hoursRaw != null) {
                const h = Number(hoursRaw);
                if (!Number.isFinite(h) || h < 0 || h > 200) {
                    status = 'invalid';
                    diagnostics.push(
                        diagnostic({
                            code: 'INVALID_HOURS',
                            severity: 'error',
                            stage: 'preflight',
                            message: 'ساعات غياب غير صالحة',
                            fileId,
                            sheet,
                            row: rowNumber,
                            field: 'hours',
                            rule: 'hours_range',
                            action: 'review'
                        })
                    );
                }
            }

            // Duplicate codes within file (students)
            if (code && (type === 'students' || type === 'student_status')) {
                if (seenCodes.has(code)) {
                    duplicates.push({
                        fileId,
                        sheet,
                        field: 'code',
                        value: code,
                        rows: [seenCodes.get(code), rowNumber]
                    });
                    warnings.push(
                        diagnostic({
                            code: 'DUPLICATE_CODE',
                            severity: 'warning',
                            stage: 'preflight',
                            message: `رمز مكرر: ${code}`,
                            fileId,
                            sheet,
                            row: rowNumber,
                            field: 'code',
                            rule: 'duplicate',
                            action: 'review'
                        })
                    );
                } else {
                    seenCodes.set(code, rowNumber);
                }
            }

            // Teacher name resolution (grades) — optional candidates
            if (opts.resolveTeacherNames && teacherName && (type === 'grades' || type === 'fet')) {
                const resolved = resolveNameWithEvidence(teacherName, opts.nameCandidates || [], {
                    fileId,
                    sheet,
                    row: rowNumber
                });
                if (resolved.unresolved && resolved.unresolved.decisionRequired) {
                    unresolvedNames.push(resolved.unresolved);
                    warnings.push(
                        diagnostic({
                            code: 'UNRESOLVED_NAME',
                            severity: 'warning',
                            stage: 'preflight',
                            message: `اسم غير محلول: ${teacherName}`,
                            fileId,
                            sheet,
                            row: rowNumber,
                            field: 'teacherName',
                            rule: 'name_resolver',
                            action: 'review'
                        })
                    );
                }
                if (resolved.evidence) {
                    diagnostics.push(
                        diagnostic({
                            code: 'NAME_MATCH',
                            severity: 'info',
                            stage: 'preflight',
                            message: resolved.evidence.detail,
                            fileId,
                            sheet,
                            row: rowNumber,
                            field: 'teacherName',
                            rule: resolved.result.matchType || 'name_resolver',
                            action: 'inform'
                        })
                    );
                }
            }

            if (status === 'valid') {
                validCount += 1;
                normalizedRecord = {
                    code,
                    full_name: fullName,
                    section,
                    subject,
                    grade: gradeRaw !== '' && gradeRaw != null ? Number(gradeRaw) : null,
                    teacher_name: teacherName,
                    absence_date: absDate,
                    hours: hoursRaw !== '' && hoursRaw != null ? Number(hoursRaw) : null,
                    status: statusVal,
                    sheet,
                    row: rowNumber
                };
                if (preview.length < MAX_PREVIEW) {
                    preview.push(Object.assign({ _previewOnly: true, written: false }, normalizedRecord));
                }
            } else {
                invalidCount += 1;
            }

            rowOutcomes.push({
                fileId,
                sheet,
                row: rowNumber,
                status,
                normalizedRecord: status === 'valid' ? normalizedRecord : null,
                diagnostics,
                excludedFromWrite: status !== 'valid'
            });
        }

        const zeroValidRows = validCount === 0;
        if (zeroValidRows && rows.length > 0) {
            errors.push(
                diagnostic({
                    code: 'ZERO_VALID_ROWS',
                    severity: 'error',
                    stage: 'preflight',
                    message: 'لا توجد صفوف صالحة للاستيراد',
                    fileId,
                    sheet,
                    rule: 'zero_valid_rows',
                    action: 'review'
                })
            );
        }

        // Structural missing code header => also zero executable
        if (codeIdx < 0 && (type === 'students' || type === 'grades' || type === 'absences' || type === 'student_status')) {
            // already have error; ensure zero valid if no outcomes
            if (!rowOutcomes.length) {
                /* empty */
            }
        }

        return {
            rowOutcomes,
            validCount,
            invalidCount,
            zeroValidRows: zeroValidRows || (codeIdx < 0 && (type === 'students' || type === 'grades' || type === 'absences' || type === 'student_status')),
            unresolvedNames,
            duplicates,
            errors,
            warnings,
            preview,
            executable: !(zeroValidRows || (codeIdx < 0 && (type === 'students' || type === 'grades' || type === 'absences' || type === 'student_status'))) && errors.filter((e) => e.code === 'MISSING_CODE_HEADER' || e.code === 'ZERO_VALID_ROWS').length === 0
        };
    }

    /**
     * XML structural "row" validation: presence of required elements (not DB write).
     */
    function validateXmlStructure(options) {
        const opts = options || {};
        const type = opts.type;
        const root = opts.xmlRoot || null;
        const elements = Array.isArray(opts.xmlElements) ? opts.xmlElements : [];
        const fileId = opts.fileId || '';
        const errors = [];
        const warnings = [];
        const elementsRead = elements.slice();
        let recordEstimate = 0;
        let valid = true;

        if (type === 'fet') {
            if (root !== 'Teachers_Timetable') {
                valid = false;
                errors.push(
                    diagnostic({
                        code: 'UNKNOWN_XML_ROOT',
                        severity: 'error',
                        stage: 'preflight',
                        message: `جذر XML غير متوقع لـ FET: ${root || '—'}`,
                        fileId,
                        rule: 'xml_root',
                        action: 'change_type'
                    })
                );
            }
            if (!elements.includes('Teacher')) {
                warnings.push(
                    diagnostic({
                        code: 'MISSING_TEACHER_ELEMENTS',
                        severity: 'warning',
                        stage: 'preflight',
                        message: 'لا توجد عناصر Teacher',
                        fileId,
                        rule: 'xml_structure',
                        action: 'review'
                    })
                );
            }
            recordEstimate = elements.filter((e) => e === 'Teacher').length || (elements.includes('Teacher') ? 1 : 0);
        } else if (type === 'agent_xml') {
            if (root !== 'DsAgentExport') {
                valid = false;
                errors.push(
                    diagnostic({
                        code: 'UNKNOWN_XML_ROOT',
                        severity: 'error',
                        stage: 'preflight',
                        message: `جذر XML غير متوقع لملف الوزارة: ${root || '—'}`,
                        fileId,
                        rule: 'xml_root',
                        action: 'change_type'
                    })
                );
            }
            if (!elements.includes('AGENT') && !elements.includes('ACTIVITE')) {
                warnings.push(
                    diagnostic({
                        code: 'WEAK_AGENT_STRUCTURE',
                        severity: 'warning',
                        stage: 'preflight',
                        message: 'بنية ملف الوزارة ناقصة (AGENT/ACTIVITE)',
                        fileId,
                        rule: 'xml_structure',
                        action: 'review'
                    })
                );
            }
            recordEstimate = elements.includes('AGENT') ? 1 : 0;
        }

        const zeroValidRows = valid && recordEstimate === 0 && (type === 'fet' || type === 'agent_xml');
        if (zeroValidRows) {
            errors.push(
                diagnostic({
                    code: 'ZERO_VALID_ROWS',
                    severity: 'error',
                    stage: 'preflight',
                    message: 'لا توجد سجلات قابلة للاستيراد في XML',
                    fileId,
                    rule: 'zero_valid_rows',
                    action: 'review'
                })
            );
        }

        return {
            valid: valid && !zeroValidRows,
            zeroValidRows,
            executable: valid && !zeroValidRows,
            elementsRead,
            recordEstimate,
            errors,
            warnings,
            rowOutcomes: [],
            preview: [],
            unresolvedNames: [],
            duplicates: []
        };
    }

    /** Documented NameResolver method order for tests (Property 13). */
    const NAME_RESOLVER_ORDER = Object.freeze([
        'normalize',
        'exact',
        'swapped',
        'stripped',
        'transliterated',
        'fuzzy',
        'alias' // resolveAsync only
    ]);

    return {
        MAX_PREVIEW,
        CODE_ALIASES,
        NAME_RESOLVER_ORDER,
        normalizeHeader,
        headerIndex,
        resolveNameWithEvidence,
        validateTabularRows,
        validateXmlStructure,
        getNameResolver: () => NameResolverRef
    };
});
