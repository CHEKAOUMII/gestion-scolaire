/**
 * import-type-check.js — Harvested signature-based type checker (Phase 3a).
 *
 * Bounded signature definitions and confidence calibration.
 * Content evidence is primary. Filename/extension/context are auxiliary and
 * cannot alone produce an automatic final destination.
 * Dual-export: window.ImportTypeCheck + module.exports
 *
 * Harvested from js/import-center/import-signatures.js (~300 lines SIGNATURES + scoreSignature)
 * Self-contained: SIGNATURES/scoreSignature/REGISTERED_SOURCE_TYPES embedded, no imports.
 * and wired as non-blocking warning in prepareImportContextReview.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.ImportTypeCheck = api;
        // Backward compat: keep ImportSignatures alias until deletion completes
        if (!root.ImportSignatures) root.ImportSignatures = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const CONFIDENCE = Object.freeze({
        HIGH: 0.85,
        MEDIUM: 0.6,
        AMBIGUITY_GAP: 0.1
    });

    // Harvested from import-contracts.js (Phase 3 harvest): the registered
    // source types the classic import path can produce.
    const REGISTERED_SOURCE_TYPES = Object.freeze([
        'students',
        'grades',
        'absences',
        'fet',
        'agent_xml',
        'student_status'
    ]);

    const SIGNATURE_VERSION = '1.1.0';

    const SIGNATURES = Object.freeze({
        students: Object.freeze({
            type: 'students',
            formats: Object.freeze(['csv', 'xlsx']),
            label: 'التلاميذ',
            primaryHeaders: Object.freeze([
                'code',
                'massar',
                'cne',
                'رمز',
                'firstname',
                'الاسم',
                'familyname',
                'النسب',
                'fullname',
                'الاسم الكامل',
                'section',
                'القسم',
                'class',
                'classe'
            ]),
            supportingHeaders: Object.freeze([
                'gender',
                'الجنس',
                'birthdate',
                'تاريخ الازدياد',
                'birthplace',
                'مكان الازدياد'
            ]),
            negativeHeaders: Object.freeze([
                'note',
                'النقطة',
                'grade',
                'score',
                'absence',
                'غياب',
                'justified',
                'مبرر',
                'غير مبرر',
                'غيرمبرر',
                'شتنبر',
                'أكتوبر'
            ]),
            filenameHints: Object.freeze([/student/i, /eleve/i, /élève/i, /talamid/i, /talmid/i, /تلميذ/i, /liste/i, /list/i]),
            xmlRoots: Object.freeze([]),
            xmlElements: Object.freeze([]),
            weights: Object.freeze({
                primaryHeader: 0.22,
                supportingHeader: 0.06,
                negativeHeader: -0.25,
                filename: 0.08,
                extension: 0.04,
                context: 0.05
            })
        }),
        grades: Object.freeze({
            type: 'grades',
            formats: Object.freeze(['csv', 'xlsx']),
            label: 'النقط',
            primaryHeaders: Object.freeze([
                'code',
                'massar',
                'cne',
                'رمز',
                'subject',
                'matiere',
                'المادة',
                'note',
                'grade',
                'score',
                'النقطة',
                'النقط',
                'semester',
                'term',
                'دورة',
                'الأسدس'
            ]),
            supportingHeaders: Object.freeze(['teacher', 'الأستاذ', 'level', 'المستوى', 'cc', 'exam', 'contrôle']),
            negativeHeaders: Object.freeze(['absence', 'غياب', 'justifiedhours', 'unjustified']),
            filenameHints: Object.freeze([/note/i, /notes/i, /grade/i, /point/i, /نقط/i]),
            sheetNameHints: Object.freeze([/notescc/i]),
            contentPhrases: Object.freeze(['المراقبة المستمرة', 'نقط المراقبة']),
            xmlRoots: Object.freeze([]),
            xmlElements: Object.freeze([]),
            weights: Object.freeze({
                primaryHeader: 0.2,
                supportingHeader: 0.06,
                negativeHeader: -0.2,
                filename: 0.08,
                extension: 0.04,
                context: 0.05,
                sheetName: 0.6,
                contentPhrase: 0.5
            })
        }),
        absences: Object.freeze({
            type: 'absences',
            formats: Object.freeze(['csv', 'xlsx']),
            label: 'الغياب',
            primaryHeaders: Object.freeze([
                'code',
                'massar',
                'cne',
                'رمز',
                'رقم التلميذ',
                'رقمالتلميذ',
                'absence',
                'غياب',
                'ملخص الغياب',
                'absencedate',
                'date',
                'تاريخ الغياب',
                'justified',
                'مبرر',
                'unjustified',
                'غير مبرر',
                'غيرمبرر',
                'hours',
                'ساعات',
                'month',
                'الشهر',
                'شتنبر',
                'أكتوبر',
                'نونبر',
                'دجنبر',
                'يناير',
                'فبراير',
                'مارس',
                'أبريل',
                'ماي',
                'يونيو',
                'المجموع'
            ]),
            supportingHeaders: Object.freeze([
                'days',
                'أيام',
                'absencetype',
                'نوع الغياب',
                'النسب',
                'الاسم',
                'الإسم',
                'الترتيب',
                'القسم',
                'المستوى'
            ]),
            negativeHeaders: Object.freeze(['note', 'النقطة', 'grade', 'score', 'subject', 'المادة', 'semester', 'الدورة']),
            filenameHints: Object.freeze([
                /abs/i,
                /absence/i,
                /غياب/i,
                /export_abs/i,
                /mois/i,
                /classe/i
            ]),
            xmlRoots: Object.freeze([]),
            xmlElements: Object.freeze([]),
            weights: Object.freeze({
                primaryHeader: 0.2,
                supportingHeader: 0.06,
                negativeHeader: -0.2,
                filename: 0.08,
                extension: 0.04,
                context: 0.05
            })
        }),
        student_status: Object.freeze({
            type: 'student_status',
            formats: Object.freeze(['csv', 'xlsx']),
            label: 'الوضعيات الدراسية',
            primaryHeaders: Object.freeze([
                'code',
                'massar',
                'cne',
                'رمز',
                'status',
                'الوضعية',
                'وضعية',
                'منقطع',
                'مفصول',
                'منتقل'
            ]),
            supportingHeaders: Object.freeze(['fullname', 'الاسم', 'section', 'القسم', 'familyname', 'النسب']),
            negativeHeaders: Object.freeze(['note', 'النقطة', 'absence', 'غياب', 'justifiedhours']),
            filenameHints: Object.freeze([/status/i, /وضعي/i, /منقطع/i, /dropout/i, /expelled/i]),
            xmlRoots: Object.freeze([]),
            xmlElements: Object.freeze([]),
            weights: Object.freeze({
                primaryHeader: 0.22,
                supportingHeader: 0.06,
                negativeHeader: -0.2,
                filename: 0.08,
                extension: 0.04,
                context: 0.05
            })
        }),
        fet: Object.freeze({
            type: 'fet',
            formats: Object.freeze(['xml']),
            label: 'FET',
            primaryHeaders: Object.freeze([]),
            supportingHeaders: Object.freeze([]),
            negativeHeaders: Object.freeze([]),
            filenameHints: Object.freeze([/fet/i, /teachers/i, /timetable/i, /جدول/i]),
            xmlRoots: Object.freeze(['Teachers_Timetable']),
            xmlElements: Object.freeze(['Teacher', 'Day', 'Hour', 'Subject', 'Students', 'Room']),
            weights: Object.freeze({
                xmlRoot: 0.55,
                xmlElement: 0.08,
                filename: 0.08,
                extension: 0.05,
                context: 0.05
            })
        }),
        agent_xml: Object.freeze({
            type: 'agent_xml',
            formats: Object.freeze(['xml']),
            label: 'ملف الوزارة',
            primaryHeaders: Object.freeze([]),
            supportingHeaders: Object.freeze([]),
            negativeHeaders: Object.freeze([]),
            filenameHints: Object.freeze([/^\d{4,6}[a-z]?_/i, /agent/i, /dsagent/i, /وزارة/i]),
            xmlRoots: Object.freeze(['DsAgentExport']),
            xmlElements: Object.freeze(['AGENT', 'ACTIVITE', 'R_GRADE', 'R_CADRE', 'R_FONCT', 'PPR']),
            weights: Object.freeze({
                xmlRoot: 0.55,
                xmlElement: 0.08,
                filename: 0.1,
                extension: 0.05,
                context: 0.05
            })
        }),
        generic_csv_xlsx: Object.freeze({
            type: 'generic_csv_xlsx',
            formats: Object.freeze(['csv', 'xlsx']),
            label: 'CSV/XLSX عام',
            primaryHeaders: Object.freeze([]),
            supportingHeaders: Object.freeze([]),
            negativeHeaders: Object.freeze([]),
            filenameHints: Object.freeze([]),
            xmlRoots: Object.freeze([]),
            xmlElements: Object.freeze([]),
            baseTabularScore: 0.55,
            weights: Object.freeze({
                tabularStructure: 0.55,
                filename: 0.0,
                extension: 0.05,
                context: 0.0
            })
        })
    });

    function normalizeToken(value) {
        return String(value || '')
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[ً-ٟ]/g, '')
            .replace(/[_\s\-./\\]+/g, '')
            .trim();
    }

    const MIN_SUBSTRING_MATCH = 3;

    function headerMatches(header, candidates) {
        const n = normalizeToken(header);
        if (!n) return false;
        return candidates.some((c) => {
            const cn = normalizeToken(c);
            if (!cn) return false;
            if (n === cn) return true;
            if (cn.length >= MIN_SUBSTRING_MATCH && n.includes(cn)) return true;
            if (n.length >= MIN_SUBSTRING_MATCH && cn.includes(n)) return true;
            return false;
        });
    }

    function countHeaderHits(headers, candidates) {
        if (!Array.isArray(headers) || !candidates.length) return 0;
        let hits = 0;
        const seen = new Set();
        for (const h of headers) {
            for (const c of candidates) {
                const key = normalizeToken(c);
                if (seen.has(key)) continue;
                if (headerMatches(h, [c])) {
                    seen.add(key);
                    hits += 1;
                    break;
                }
            }
        }
        return hits;
    }

    function clamp01(n) {
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(1, n));
    }

    function scoreSignature(signature, features) {
        const evidence = [];
        let score = 0;
        const f = features || {};
        const format = f.format || 'unknown';
        const headers = Array.isArray(f.headers) ? f.headers : [];
        const root = f.xmlRoot || '';
        const elements = Array.isArray(f.xmlElements) ? f.xmlElements : [];
        const filename = String(f.filename || '');
        const extension = String(f.extension || '').replace(/^\./, '').toLowerCase();
        const contextType = f.contextTypeHint || null;
        const sheetNames = Array.isArray(f.sheetNames) ? f.sheetNames : [];
        const contentText = String(f.contentText || '');
        const w = signature.weights || {};

        if (signature.type === 'generic_csv_xlsx') {
            const isTabular = format === 'csv' || format === 'xlsx';
            if (isTabular && headers.length > 0) {
                score += signature.baseTabularScore || 0.55;
                evidence.push({
                    kind: 'header',
                    label: 'بنية جدولية',
                    detail: `${headers.length} عمود`,
                    strength: 'primary',
                    source: 'content'
                });
            }
            if (extension === 'csv' || extension === 'xlsx' || extension === 'xls') {
                score += w.extension || 0;
                evidence.push({
                    kind: 'extension',
                    label: 'امتداد',
                    detail: extension,
                    strength: 'supporting',
                    source: 'extension'
                });
            }
            return { type: signature.type, score: clamp01(score), evidence };
        }

        if (signature.formats && signature.formats.length && !signature.formats.includes(format)) {
            let aux = 0;
            if (signature.filenameHints.some((re) => re.test(filename))) {
                aux += Math.min(w.filename || 0, 0.08);
                evidence.push({
                    kind: 'filename_hint',
                    label: 'تلميح الاسم',
                    detail: filename,
                    strength: 'supporting',
                    source: 'filename'
                });
            }
            return { type: signature.type, score: clamp01(Math.min(aux, CONFIDENCE.MEDIUM - 0.01)), evidence };
        }

        if (signature.primaryHeaders && signature.primaryHeaders.length) {
            const primaryHits = countHeaderHits(headers, signature.primaryHeaders);
            if (primaryHits > 0) {
                const contrib = Math.min(primaryHits, 4) * (w.primaryHeader || 0.2);
                score += contrib;
                evidence.push({
                    kind: 'header',
                    label: 'عناوين أساسية',
                    detail: `${primaryHits} تطابق`,
                    strength: 'primary',
                    source: 'content'
                });
            }
            const supportHits = countHeaderHits(headers, signature.supportingHeaders || []);
            if (supportHits > 0) {
                score += Math.min(supportHits, 3) * (w.supportingHeader || 0.06);
                evidence.push({
                    kind: 'header',
                    label: 'عناوين مساندة',
                    detail: `${supportHits} تطابق`,
                    strength: 'supporting',
                    source: 'content'
                });
            }
            const negHits = countHeaderHits(headers, signature.negativeHeaders || []);
            if (negHits > 0) {
                score += negHits * (w.negativeHeader || -0.2);
                evidence.push({
                    kind: 'conflict',
                    label: 'عناوين متعارضة',
                    detail: `${negHits} تعارض`,
                    strength: 'negative',
                    source: 'content'
                });
            }
        }

        if (signature.sheetNameHints && signature.sheetNameHints.length && sheetNames.length) {
            const matched = sheetNames.filter((s) =>
                signature.sheetNameHints.some((re) => re.test(String(s || '')))
            );
            if (matched.length) {
                score += w.sheetName || 0.6;
                evidence.push({
                    kind: 'sheet_name',
                    label: 'اسم الورقة',
                    detail: matched.join(', '),
                    strength: 'primary',
                    source: 'content'
                });
            }
        }

        if (signature.contentPhrases && signature.contentPhrases.length && contentText) {
            const hitPhrase = signature.contentPhrases.find((p) => contentText.includes(String(p)));
            if (hitPhrase) {
                score += w.contentPhrase || 0.5;
                evidence.push({
                    kind: 'content_phrase',
                    label: 'عبارة مميِّزة',
                    detail: hitPhrase,
                    strength: 'primary',
                    source: 'content'
                });
            }
        }

        if (signature.xmlRoots && signature.xmlRoots.length) {
            const rootHit = signature.xmlRoots.some((r) => r === root);
            if (rootHit) {
                score += w.xmlRoot || 0.55;
                evidence.push({
                    kind: 'xml_root',
                    label: 'جذر XML',
                    detail: root,
                    strength: 'primary',
                    source: 'content'
                });
            }
            let elHits = 0;
            for (const el of signature.xmlElements || []) {
                if (elements.includes(el)) elHits += 1;
            }
            if (elHits > 0) {
                score += Math.min(elHits, 4) * (w.xmlElement || 0.08);
                evidence.push({
                    kind: 'element',
                    label: 'عناصر XML',
                    detail: `${elHits} عنصر`,
                    strength: 'primary',
                    source: 'content'
                });
            }
        }

        let filenameHit = false;
        for (const re of signature.filenameHints || []) {
            if (re.test(filename)) {
                filenameHit = true;
                break;
            }
        }
        if (filenameHit) {
            score += w.filename || 0.08;
            evidence.push({
                kind: 'filename_hint',
                label: 'تلميح الاسم',
                detail: filename,
                strength: 'supporting',
                source: 'filename'
            });
        }

        if (signature.formats && signature.formats.includes(extension === 'xls' ? 'xlsx' : extension)) {
            score += w.extension || 0.04;
            evidence.push({
                kind: 'extension',
                label: 'امتداد',
                detail: extension,
                strength: 'supporting',
                source: 'extension'
            });
        }

        if (contextType && (contextType === signature.type || mapContextHint(contextType) === signature.type)) {
            score += w.context || 0.05;
            evidence.push({
                kind: 'context_hint',
                label: 'تلميح سياقي',
                detail: String(contextType),
                strength: 'supporting',
                source: 'context'
            });
        }

        const hasPrimaryContent = evidence.some((e) => e.strength === 'primary' && e.source === 'content');
        if (!hasPrimaryContent) {
            score = Math.min(score, CONFIDENCE.HIGH - 0.01);
        }

        return { type: signature.type, score: clamp01(score), evidence };
    }

    function mapContextHint(hint) {
        const h = String(hint || '').toLowerCase().replace(/-/g, '_');
        if (h === 'student_status' || h === 'status') return 'student_status';
        if (h === 'agent_xml' || h === 'agentxml') return 'agent_xml';
        return h;
    }

    function listSignatures() {
        return Object.keys(SIGNATURES).map((k) => SIGNATURES[k]);
    }

    function getSignature(type) {
        return SIGNATURES[type] || null;
    }

    function getCalibration() {
        return {
            version: SIGNATURE_VERSION,
            high: CONFIDENCE.HIGH,
            medium: CONFIDENCE.MEDIUM,
            ambiguityGap: CONFIDENCE.AMBIGUITY_GAP,
            contentPrimary: true,
            filenameOnlyCannotAutoFinalize: true,
            note: 'Thresholds fixed before classifier implementation; calibrated against de-identified fixtures.'
        };
    }

    // New: type-check wrapper for Phase 3a
    function mapActionToSignatureType(action) {
        const m = {
            students: 'students',
            grades: 'grades',
            absences: 'absences',
            'student-status': 'student_status',
            fet: 'fet',
            'agent-xml': 'agent_xml',
            orientation: null // no signature
        };
        return m[action] || null;
    }

    function checkFile(features, expectedAction) {
        const expectedType = mapActionToSignatureType(expectedAction);
        if (!expectedType) return { isMismatch: false, reason: 'no_signature_for_action' };
        const list = listSignatures().filter((s) => s.type !== 'generic_csv_xlsx');
        let best = null;
        for (const sig of list) {
            const result = scoreSignature(sig, features);
            if (!best || result.score > best.score) best = result;
        }
        if (!best) return { isMismatch: false };
        // Only warn when top is content-primary and at least MEDIUM
        const hasPrimary = best.evidence.some((e) => e.strength === 'primary' && e.source === 'content');
        const isMismatch = best.type !== expectedType && best.score >= CONFIDENCE.MEDIUM && hasPrimary;
        if (isMismatch) {
            const expectedLabel = (SIGNATURES[expectedType] && SIGNATURES[expectedType].label) || expectedType;
            const matchedLabel = (SIGNATURES[best.type] && SIGNATURES[best.type].label) || best.type;
            return {
                isMismatch: true,
                expectedType,
                matchedType: best.type,
                score: best.score,
                evidence: best.evidence,
                code: 'TYPE_MISMATCH',
                message: `الملف يبدو كـ «${matchedLabel}» (${Math.round(best.score * 100)}% ثقة) وليس «${expectedLabel}». تأكد من اختيار نوع الاستيراد الصحيح.`,
                blocking: false
            };
        }
        return { isMismatch: false, matchedType: best.type, score: best.score, evidence: best.evidence };
    }

    function checkBatch(filesFeatures, expectedAction) {
        // filesFeatures: array of features objects
        const results = (filesFeatures || []).map((f) => checkFile(f, expectedAction));
        const mismatches = results.filter((r) => r.isMismatch);
        return {
            mismatches,
            hasMismatch: mismatches.length > 0,
            results
        };
    }

    return {
        SIGNATURE_VERSION,
        SIGNATURES,
        CONFIDENCE,
        REGISTERED_SOURCE_TYPES,
        normalizeToken,
        headerMatches,
        countHeaderHits,
        scoreSignature,
        listSignatures,
        getSignature,
        getCalibration,
        mapContextHint,
        mapActionToSignatureType,
        checkFile,
        checkBatch
    };
});
