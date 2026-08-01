/**
 * import-context.js — Safe source/destination context extraction for manual imports.
 *
 * Best-effort only: missing metadata is unknown, never a mismatch. Filename hints
 * are informational and never sufficient for a hard block.
 * Dual-export: window.ImportContext + module.exports.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.ImportContext = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const Policy =
        typeof require === 'function'
            ? require('./import-preflight-policy.js')
            : globalThis?.ImportPreflightPolicy;
    const HARD_CONTEXT_ACTIONS = Policy?.HIGH_RISK_ACTIONS || Object.freeze([
        'students', 'grades', 'absences', 'student-status', 'orientation'
    ]);
    const IMPORT_CONTEXT_CODES = Policy?.IMPORT_CONTEXT_CODES || Object.freeze({
        SCHOOL_YEAR_MISMATCH: 'SCHOOL_YEAR_MISMATCH',
        INSTITUTION_CODE_MISMATCH: 'INSTITUTION_CODE_MISMATCH',
        INSTITUTION_NAME_DIFFERENCE: 'INSTITUTION_NAME_DIFFERENCE',
        CYCLE_MISMATCH: 'CYCLE_MISMATCH',
        FILE_SCOPE_INFO: 'FILE_SCOPE_INFO'
    });

    const SOURCE_LABELS = Object.freeze({
        explicit: 'بيانات صريحة داخل الملف',
        sheet: 'اسم الورقة',
        filename: 'اسم الملف',
        derived: 'استنتاج من محتوى الملف'
    });

    function text(value) {
        return String(value == null ? '' : value)
            .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function key(value) {
        return text(value)
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[\u064B-\u065F\u0670]/g, '')
            .replace(/[ـ]/g, '')
            .replace(/[أإآ]/g, 'ا')
            .replace(/ؤ/g, 'و')
            .replace(/ئ/g, 'ي')
            .replace(/[\s_./\\:؛،-]+/g, '');
    }

    function normalizeCode(value) {
        const result = text(value).toUpperCase();
        return result || null;
    }

    function normalizeYear(value) {
        const raw = text(value);
        const match = raw.match(/\b(20\d{2})\s*[\/-]\s*(20\d{2})\b/);
        if (!match || Number(match[2]) !== Number(match[1]) + 1) return null;
        return `${match[1]}/${match[2]}`;
    }

    function yearsEqual(left, right) {
        const a = normalizeYear(left);
        const b = normalizeYear(right);
        return !!a && !!b && a === b;
    }

    function addUnique(list, value, limit = 30) {
        const clean = text(value);
        if (!clean || list.length >= limit) return;
        const normalized = key(clean);
        if (!list.some((item) => key(item) === normalized)) list.push(clean);
    }

    function cellsFromWorkbook(workbook) {
        const sheets = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames : [];
        return sheets.map((sheetName) => ({
            sheetName,
            rows:
                typeof workbook?.getSheetRows === 'function'
                    ? workbook.getSheetRows(sheetName)
                    : workbook?.Sheets?.[sheetName]?.rows || []
        }));
    }

    function findLabeledValue(rows, labelPattern) {
        for (const row of rows) {
            const cells = Array.isArray(row) ? row : [];
            for (let index = 0; index < cells.length; index += 1) {
                const current = text(cells[index]);
                const normalized = key(current);
                if (!labelPattern.test(normalized)) continue;

                const inline = current.match(/[:：]\s*(.+)$/);
                if (inline?.[1]) return { value: text(inline[1]), source: 'explicit' };
                const next = cells.slice(index + 1).map(text).find(Boolean);
                if (next && !labelPattern.test(key(next))) return { value: next, source: 'explicit' };
            }
        }
        return null;
    }

    function detectYear(rows, fileName) {
        const yearPattern = /\b20\d{2}\s*[\/-]\s*20\d{2}\b/;
        for (const row of rows) {
            for (const cell of Array.isArray(row) ? row : []) {
                const value = text(cell);
                if (yearPattern.test(value)) {
                    const year = normalizeYear(value);
                    if (year) return { value: year, source: 'explicit' };
                }
            }
        }
        const filenameYear = normalizeYear(fileName);
        return filenameYear ? { value: filenameYear, source: 'filename' } : null;
    }

    function detectCycle(rows, sheetNames) {
        const explicit = findLabeledValue(rows, /(?:cycle|educationcycle|السلك|المستوىالتعليمي)/);
        const explicitValue = explicit?.value || '';
        const combined = rows
            .flatMap((row) => (Array.isArray(row) ? row : []))
            .concat(sheetNames || [])
            .map(text)
            .join(' ');
        const sourceText = explicitValue || combined;
        const normalized = key(sourceText);

        if (/secondary[_ -]?qualifiant|الثانويالتاهيلي|الثانويالتأهيلي|ثانويتأهيلي|تأهيلي/.test(normalized)) {
            return {
                code: 'secondary_qualifiant',
                label: 'الثانوي التأهيلي',
                confidence: explicit ? 'high' : 'medium',
                source: explicit ? 'explicit' : 'derived'
            };
        }
        if (/secondary[_ -]?collegial|الثانويالاعدادي|الثانويالإعدادي|ثانوياعدادي|اعدادي|إعدادي/.test(normalized)) {
            return {
                code: 'secondary_collegial',
                label: 'الثانوي الإعدادي',
                confidence: explicit ? 'high' : 'medium',
                source: explicit ? 'explicit' : 'derived'
            };
        }
        return null;
    }

    function collectLabeledMetadata(sheets, aliases, target) {
        const normalizedAliases = aliases.map(key);
        for (const sheet of sheets) {
            for (const row of (sheet.rows || []).slice(0, 30)) {
                const cells = Array.isArray(row) ? row : [];
                for (let index = 0; index < cells.length; index += 1) {
                    if (!normalizedAliases.includes(key(cells[index]))) continue;
                    const value = cells.slice(index + 1).map(text).find(Boolean);
                    if (value) addUnique(target, value);
                }
            }
        }
    }

    function extractContext(workbook, fileName, options) {
        const opts = options || {};
        const sheets = cellsFromWorkbook(workbook);
        const sheetNames = sheets.map((sheet) => sheet.sheetName);
        const rows = sheets.flatMap((sheet) => sheet.rows || []);
        const year = detectYear(rows.slice(0, 60), fileName);
        const institutionCode = findLabeledValue(
            rows.slice(0, 60),
            /(?:massarcode|schoolcode|institutioncode|codeetablissement|رمزالمؤسسة|رمزالموسسة|رمزالمدرسة|رمزالمؤسسةالتعليمية)/
        );
        const institutionName = findLabeledValue(
            rows.slice(0, 60),
            /(?:institutionname|schoolname|nometablissement|nomdelinstitution|اسمالمؤسسة|اسمالموسسة|المؤسسة|الموسسة|مؤسسة|موسسة)/
        );
        const cycle = detectCycle(rows.slice(0, 100), sheetNames);
        const levels = [];
        const streams = [];
        const sections = [];
        collectLabeledMetadata(sheets, ['level', 'niveau', 'المستوى'], levels);
        collectLabeledMetadata(sheets, ['stream', 'filiere', 'الشعبة', 'المسلك'], streams);
        collectLabeledMetadata(sheets, ['section', 'classe', 'القسم', 'الفوج'], sections);

        return {
            sourceType: opts.action || null,
            fileName: text(fileName),
            schoolYear: year?.value || null,
            schoolYearSource: year?.source || null,
            institutionCode: institutionCode ? normalizeCode(institutionCode.value) : null,
            institutionCodeSource: institutionCode?.source || null,
            institutionName: institutionName ? text(institutionName.value) : null,
            institutionNameSource: institutionName?.source || null,
            cycleCode: cycle?.code || null,
            cycleLabel: cycle?.label || null,
            cycleConfidence: cycle?.confidence || null,
            cycleSource: cycle?.source || null,
            levels,
            streams,
            sections,
            semester: null,
            subject: null,
            templateVersion: null,
            evidence: {
                schoolYear: year ? { source: year.source, confidence: year.source === 'filename' ? 'low' : 'high' } : null,
                institutionCode: institutionCode ? { source: institutionCode.source, confidence: 'high' } : null,
                institutionName: institutionName ? { source: institutionName.source, confidence: 'high' } : null,
                cycle: cycle ? { source: cycle.source, confidence: cycle.confidence } : null
            },
            sheetNames,
            metadataFound: {
                schoolYear: !!year,
                institutionCode: !!institutionCode,
                institutionName: !!institutionName,
                cycle: !!cycle,
                levels: levels.length > 0,
                streams: streams.length > 0,
                sections: sections.length > 0
            }
        };
    }

    function check(keyName, status, sourceValue, destinationValue, message, blocking, extra) {
        const item = Object.assign(
            { key: keyName, status, sourceValue: sourceValue || null, destinationValue: destinationValue || null, message, blocking: !!blocking },
            extra || {}
        );
        return Policy?.apply ? Policy.apply(item, item.action) : item;
    }

    function contextualCheck(action, keyName, status, sourceValue, destinationValue, message, extra) {
        const item = Object.assign({ key: keyName, status, sourceValue, destinationValue, message }, extra || {});
        return Policy?.apply ? Policy.apply(item, action) : item;
    }

    function compareContexts(source, destination, action) {
        const src = source || {};
        const dest = destination || {};
        const checks = [];
        const hardAction = HARD_CONTEXT_ACTIONS.includes(action);

        if (!src.schoolYear) {
            checks.push(contextualCheck(action, 'schoolYear', 'missing', null, dest.schoolYear, 'لم تُكتشف السنة الدراسية داخل الملف'));
        } else if (yearsEqual(src.schoolYear, dest.schoolYear)) {
            checks.push(check('schoolYear', 'match', src.schoolYear, dest.schoolYear, 'السنة الدراسية مطابقة', false));
        } else {
            checks.push(
                check(
                    'schoolYear',
                    'mismatch',
                    src.schoolYear,
                    dest.schoolYear,
                    `السنة في الملف (${src.schoolYear}) تختلف عن السنة المختارة (${dest.schoolYear || 'غير متاحة'})`,
                    hardAction && src.schoolYearSource !== 'filename',
                    { code: IMPORT_CONTEXT_CODES.SCHOOL_YEAR_MISMATCH, source: src.schoolYearSource, confidence: src.schoolYearSource === 'filename' ? 'low' : 'high' }
                )
            );
        }

        if (!src.institutionCode) {
            checks.push(check('institutionCode', 'missing', null, dest.institutionCode, 'لم يُكتشف رمز المؤسسة داخل الملف', false));
        } else if (!dest.institutionCode) {
            checks.push(check('institutionCode', 'unknown', src.institutionCode, null, 'تعذر التحقق من رمز المؤسسة محلياً', false));
        } else if (normalizeCode(src.institutionCode) === normalizeCode(dest.institutionCode)) {
            checks.push(check('institutionCode', 'match', src.institutionCode, dest.institutionCode, 'رمز المؤسسة مطابق', false));
        } else {
            checks.push(
                check(
                    'institutionCode',
                    'mismatch',
                    src.institutionCode,
                    dest.institutionCode,
                    `رمز المؤسسة في الملف (${src.institutionCode}) لا يطابق المؤسسة الحالية (${dest.institutionCode})`,
                    hardAction,
                    { code: IMPORT_CONTEXT_CODES.INSTITUTION_CODE_MISMATCH }
                )
            );
        }

        if (src.institutionName && dest.institutionName && key(src.institutionName) !== key(dest.institutionName)) {
            checks.push(
                check(
                    'institutionName',
                    'warning',
                    src.institutionName,
                    dest.institutionName,
                    `اسم المؤسسة مختلف: الملف «${src.institutionName}»، الحالية «${dest.institutionName}»`,
                    false,
                    { code: IMPORT_CONTEXT_CODES.INSTITUTION_NAME_DIFFERENCE }
                )
            );
        } else {
            checks.push(check('institutionName', src.institutionName ? 'match' : 'missing', src.institutionName, dest.institutionName, src.institutionName ? 'اسم المؤسسة متطابق أو مقبول' : 'لم يُكتشف اسم المؤسسة', false));
        }

        if (!src.cycleCode) {
            checks.push(check('cycle', 'missing', null, dest.cycleCode, 'لم يُستنتج السلك التعليمي بثقة كافية', false));
        } else if (!dest.cycleCode) {
            checks.push(check('cycle', 'unknown', src.cycleCode, null, 'تعذر التحقق من السلك النشط', false));
        } else if (src.cycleCode === dest.cycleCode) {
            checks.push(check('cycle', 'match', src.cycleCode, dest.cycleCode, `السلك مطابق: ${src.cycleLabel || src.cycleCode}`, false));
        } else {
            const blocking = hardAction && src.cycleConfidence === 'high';
            checks.push(
                check(
                    'cycle',
                    'mismatch',
                    src.cycleLabel || src.cycleCode,
                    dest.cycleLabel || dest.cycleCode,
                    `السلك في الملف (${src.cycleLabel || src.cycleCode}) يختلف عن السلك النشط (${dest.cycleLabel || dest.cycleCode})`,
                    blocking,
                    { code: IMPORT_CONTEXT_CODES.CYCLE_MISMATCH, confidence: src.cycleConfidence }
                )
            );
        }

        if (src.levels.length || src.streams.length || src.sections.length) {
            checks.push(
                check(
                    'scope',
                    'info',
                    null,
                    null,
                    `النطاق المكتشف: ${src.levels.length ? `المستويات ${src.levels.slice(0, 5).join('، ')}` : ''}${src.streams.length ? `؛ المسالك ${src.streams.slice(0, 5).join('، ')}` : ''}${src.sections.length ? `؛ الأقسام ${src.sections.slice(0, 5).join('، ')}` : ''}`,
                    false,
                    { code: IMPORT_CONTEXT_CODES.FILE_SCOPE_INFO }
                )
            );
        }

        const evaluatedChecks = Policy?.apply ? checks.map((item) => Policy.apply(item, action)) : checks;
        const blocking = evaluatedChecks.filter((item) => item.blocking);
        const warnings = evaluatedChecks.filter((item) => item.decision === 'require_review' || item.status === 'warning' || item.status === 'mismatch' || item.status === 'unknown');
        return {
            action,
            checks: evaluatedChecks,
            blocking,
            warnings,
            status: blocking.length ? 'blocked' : warnings.length ? 'review' : 'ready',
            canProceed: blocking.length === 0,
            source: src,
            destination: dest
        };
    }

    function formatEvidenceSource(source) {
        return SOURCE_LABELS[source] || 'استنتاج غير محدد';
    }

    return {
        HARD_CONTEXT_ACTIONS,
        IMPORT_CONTEXT_CODES,
        SOURCE_LABELS,
        text,
        key,
        normalizeCode,
        normalizeYear,
        yearsEqual,
        extractContext,
        extractImportContext: extractContext,
        compareContexts,
        compareImportContexts: compareContexts,
        formatEvidenceSource
    };
});
