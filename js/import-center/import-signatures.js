/**
 * import-signatures.js — Bounded signature definitions and confidence calibration.
 *
 * Content evidence is primary. Filename/extension/context are auxiliary and
 * cannot alone produce an automatic final destination.
 *
 * Dual-export: window.ImportSignatures + module.exports
 */
(function (root, factory) {
    const api = factory(
        root && root.ImportContracts
            ? root.ImportContracts
            : typeof require === 'function'
              ? require('./import-contracts.js')
              : null
    );
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.ImportSignatures = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (Contracts) {
    'use strict';

    const CONFIDENCE = (Contracts && Contracts.CONFIDENCE) || {
        HIGH: 0.85,
        MEDIUM: 0.6,
        AMBIGUITY_GAP: 0.1
    };

    const SIGNATURE_VERSION = '1.1.0';

    /**
     * Each signature scores bounded reader output.
     * Weights: content headers/xml/elements are primary; filename/extension/context auxiliary.
     */
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
                'مسار',
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
                'مسار',
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
            // Massar per-subject grade exports expose no conventional column
            // headers; the marks live in a form sheet named "NotesCC". The sheet
            // name is intrinsic file content and is the reliable discriminator.
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
                'مسار',
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
                // Massar annual class export month columns
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
                'مسار',
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
            // Base score when tabular structure exists without registered match
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
            .replace(/[\u064B-\u065F]/g, '')
            .replace(/[_\s\-./\\]+/g, '')
            .trim();
    }

    // Substring matches are only accepted when the contained token is at least
    // this many characters. This prevents garbage single-letter headers (A, C,
    // O from malformed exports) from spuriously matching candidates such as
    // "massar", "code", "note", or "score".
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

    /**
     * Score one signature against bounded extraction features.
     * Returns { type, score, evidence[] } — score never exceeds 1.
     * Filename-only path cannot reach HIGH (0.85).
     */
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

        // Format gate for XML types
        if (signature.formats && signature.formats.length && !signature.formats.includes(format)) {
            // Still allow weak filename/extension contribution only (capped below medium)
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

        // Tabular content scoring
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

        // Sheet-name content evidence (intrinsic file content).
        // Example: Massar per-subject grade exports name their form sheet
        // "NotesCC" and expose no conventional column headers.
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

        // Distinguishing body/label phrases inside the file content.
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

        // XML content scoring
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

        // Auxiliary filename (never sole path to HIGH)
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

        // Cap: filename/extension/context without primary content cannot reach HIGH
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

    return {
        SIGNATURE_VERSION,
        SIGNATURES,
        CONFIDENCE,
        normalizeToken,
        headerMatches,
        countHeaderHits,
        scoreSignature,
        listSignatures,
        getSignature,
        getCalibration,
        mapContextHint
    };
});
