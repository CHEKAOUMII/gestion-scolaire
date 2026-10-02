/*
 * Pure workbook-to-grade transformation. It deliberately has no DOM, IPC, or
 * XLSX dependency so the same parser can run in the renderer and in Node tests.
 */
(function (root, factory) {
    const labels =
        typeof require === 'function' ? require('../data/ma-education-labels.js') : null;
    const normalize =
        (root && root.ImportCenterNormalize) ||
        (typeof require === 'function' ? require('./normalize.js') : null);
    const diagnostics =
        (root && root.ImportCenterDiagnostics) ||
        (typeof require === 'function' ? require('./import-diagnostics-codes.js') : null);
    const qualifiantLevels =
        (root && root.EducationQualifiantLevels) ||
        (typeof require === 'function' ? require('../shared/education/qualifiant-levels.js') : null);
    const api = factory(root || {}, labels, normalize, diagnostics, qualifiantLevels);
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.GradesImportParser = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (root, labels, normalize, diagnostics, qualifiantLevels) {
    'use strict';

    const { text, toLatinDigits, normalizeKey, normalizeStudentCode, parseStrictNumber } = normalize;
    const Diagnostics = diagnostics;

    const MAX_SCAN_ROWS = 60;
    const GRADE_MARKERS = ['grade', 'score', 'note', 'mark', 'النقطة', 'النقط', 'الدرجة'];
    const CODE_MARKERS = [
        'code',
        'studentcode',
        'massar',
        'massarcode',
        'codemassar',
        'codeeleve',
        'الرمز',
        'رمز',
        'رقمالتلميذ',
        'cne'
    ];
    const ASSESSMENT_LABELS = Object.freeze({
        first: 'الفرض الأول',
        second: 'الفرض الثاني',
        activities: 'الأنشطة المندمجة',
        generic: 'التقييم'
    });

    function isBlank(value) {
        return value == null || text(value) === '';
    }

    function isSeparator(value) {
        const valueText = text(value);
        return !valueText || /^[:：\-—]+$/.test(valueText);
    }

    function containsAny(value, candidates) {
        const key = normalizeKey(value);
        return candidates.some((candidate) => key.includes(normalizeKey(candidate)));
    }

    function findHeaderIndex(row, aliases) {
        for (let index = 0; index < row.length; index += 1) {
            if (containsAny(row[index], aliases)) return index;
        }
        return -1;
    }

    function inferSubjectFromFileName(fileName) {
        const base = text(fileName).replace(/\.[^.]+$/, '');
        const match = base.match(/^[^_]+_[^_]+_[^_]+_(.+?)_(\d{8,})$/i);
        if (!match) return '';
        const subject = match[1]
            .replace(/[_-]+/g, ' ')
            .replace(/\s+(?:فرض|test|exam|controle)\s*(?:الأول|الاول|الثاني|[12])$/i, '')
            .replace(/\s+(?:الأنشطة المندمجة|activit(?:e|ies?)\s+integree?s?)$/i, '')
            .trim();
        return subject && !['sheet', 'sheet1', 'feuil1', 'notes', 'notescc', 'note', 'ورقة1', 'ورقة'].includes(normalizeKey(subject))
            ? subject
            : '';
    }

    function inferAssessmentFromFileName(fileName) {
        const value = normalizeKey(fileName);
        if (/(?:فرض|test|exam|controle|controlecontinu)1|الأول|الاول|premier/.test(value)) return ASSESSMENT_LABELS.first;
        if (/(?:فرض|test|exam|controle|controlecontinu)2|الثاني|second|deuxieme/.test(value)) return ASSESSMENT_LABELS.second;
        if (/(?:نشاط|انشطة|activite|activities|integree|integrees)/.test(value)) return ASSESSMENT_LABELS.activities;
        return '';
    }

    function normalizeSubject(subject) {
        const raw = text(subject)
            .replace(/\s*\(\s*(?:فرض|نشط)\s*[0-9٠-٩]+\s*\)\s*$/i, '')
            .replace(/\s*\(الأنشطة المندمجة\)\s*$/i, '')
            .trim();
        if (!raw) return '';
        if (labels?.normalizeSubjectName) return text(labels.normalizeSubjectName(raw));
        if (typeof root.normalizeSubjectName === 'function') return text(root.normalizeSubjectName(raw));
        return raw;
    }

    function normalizeLevel(level) {
        const value = text(level);
        if (!value) return '';
        if (qualifiantLevels && typeof qualifiantLevels.matchLevelFromSection === 'function') {
            const hit = qualifiantLevels.matchLevelFromSection(value);
            if (hit && hit.code !== 'other') return hit.name;
        }
        const upper = toLatinDigits(value).toUpperCase();
        if (/^1BAC/i.test(upper) || /أولى\s*باكالوريا|اولى\s*باكالوريا/i.test(value)) {
            if (/اقتصاد|تدبير|محاسب/i.test(value) || /1BACSEG/i.test(upper)) return 'الأولى باكالوريا علوم الاقتصاد والتدبير';
            if (/تجريب/i.test(value) || /1BACSEF/i.test(upper)) return 'الأولى باكالوريا علوم تجريبية';
            if (/رياضي/i.test(value) || /1BACSM/i.test(upper)) return 'الأولى باكالوريا علوم رياضية';
            return 'الأولى باكالوريا';
        }
        if (/^2BAC/i.test(upper) || /ثانية\s*باكالوريا|ثانية\s*باك/i.test(value)) return 'الثانية باكالوريا';
        if (/^TC/i.test(upper) || /جذع\s*مشترك/i.test(value)) return 'الجذع المشترك';
        return value;
    }

    function parseSemester(value) {
        const candidate = toLatinDigits(value).toLowerCase();
        if (
            candidate.includes('الثانية') ||
            candidate.includes('ثانية') ||
            candidate.includes('الثاني') ||
            /deuxi(?:e|è)me|second/.test(candidate) ||
            /\b(?:s|semestre|semester|term)\s*2\b/.test(candidate) ||
            /\b2\b/.test(candidate)
        ) {
            return 2;
        }
        if (
            candidate.includes('الأولى') ||
            candidate.includes('اولى') ||
            candidate.includes('الأول') ||
            /premier|first/.test(candidate) ||
            /\b(?:s|semestre|semester|term)\s*1\b/.test(candidate) ||
            /\b1\b/.test(candidate)
        ) {
            return 1;
        }
        return null;
    }

    function parseSchoolYear(value) {
        const match = toLatinDigits(value).match(/\b(20\d{2})\s*[/-]\s*(20\d{2})\b/);
        return match ? `${match[1]}/${match[2]}` : '';
    }

    function diagnostic(code, message, sheet, row, field, severity = 'error', blocking) {
        if (blocking === undefined) {
            // Row-scoped (non-blocking): INVALID_GRADE is a cell defect, not a file defect.
            // File-blocking: UNKNOWN_STUDENT, STUDENT_CODE_MISSING, GRADE_COLUMNS_NOT_FOUND, etc.
            if (severity !== 'error') blocking = false;
            else if (code === Diagnostics.INVALID_GRADE) blocking = false;
            else blocking = true;
        }
        return {
            code,
            severity,
            blocking,
            stage: 'parse',
            message,
            sheet,
            row,
            field: field || '',
            rule: code.toLowerCase(),
            action: blocking ? 'correct_file' : severity === 'error' ? 'review' : 'review'
        };
    }

    function isLabelCell(value, labelsToFind) {
        return containsAny(value, labelsToFind);
    }

    function isOnlyLabel(value, labelsToFind) {
        const key = normalizeKey(value);
        return !key || labelsToFind.some((label) => key === normalizeKey(label));
    }

    function extractLabeledValue(rows, labelsToFind, limit) {
        const rowLimit = Math.min(rows.length, limit == null ? MAX_SCAN_ROWS : limit);
        for (let rowIndex = 0; rowIndex < rowLimit; rowIndex += 1) {
            const row = rows[rowIndex] || [];
            for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
                const raw = text(row[columnIndex]);
                if (!raw || !isLabelCell(raw, labelsToFind)) continue;

                const inline = raw.match(/[:：\-]\s*(.+)$/);
                if (inline && text(inline[1]) && !isOnlyLabel(inline[1], labelsToFind)) return text(inline[1]);

                for (const offset of [1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]) {
                    const candidate = text(row[columnIndex + offset]);
                    if (!isSeparator(candidate) && !isOnlyLabel(candidate, labelsToFind)) return candidate;
                }

                for (const rowOffset of [1, 2]) {
                    const nextRow = rows[rowIndex + rowOffset] || [];
                    for (const offset of [0, 1, -1, 2, -2]) {
                        const candidate = text(nextRow[columnIndex + offset]);
                        if (!isSeparator(candidate) && !isOnlyLabel(candidate, labelsToFind)) return candidate;
                    }
                }
            }
        }
        return '';
    }

    function extractMetadata(rows, headerIndex) {
        const limit = Math.min(rows.length, Math.max(0, headerIndex));
        const section = extractLabeledValue(rows, ['القسم', 'section', 'classe', 'class'], limit);
        const level = extractLabeledValue(rows, ['المستوى', 'niveau', 'level'], limit);
        const teacher = extractLabeledValue(rows, ['الأستاذ', 'الاستاذ', 'أستاذ', 'استاذ', 'teacher', 'professeur'], limit);
        const semesterValue = extractLabeledValue(rows, ['الدورة', 'semester', 'term', 'periode'], limit);
        const yearValue = extractLabeledValue(rows, ['السنة الدراسية', 'school year', 'schoolyear', 'annee scolaire'], limit);
        const subject = extractLabeledValue(rows, ['المادة', 'matiere', 'module', 'subject'], limit);
        return {
            section,
            level: normalizeLevel(level),
            teacher: teacher.replace(/^الأستاذ\s*[:：-]?\s*/i, '').trim(),
            semester: parseSemester(semesterValue),
            schoolYear: parseSchoolYear(yearValue),
            subject
        };
    }

    function isDataCode(value, studentCodes) {
        const code = normalizeStudentCode(value);
        return !!code && (studentCodes.has(code) || /^[A-Z]\d{8,}$/i.test(code));
    }

    function isSecondaryHeader(row, codeIndex, studentCodes) {
        if (!Array.isArray(row) || !row.length) return false;
        if (isDataCode(row[codeIndex], studentCodes)) return false;
        let markers = 0;
        row.forEach((cell) => {
            if (containsAny(cell, GRADE_MARKERS) || detectAssessment(cell)) markers += 1;
        });
        return markers > 0;
    }

    function detectAssessment(value) {
        const key = normalizeKey(value);
        if (!key) return '';
        if (key.includes(normalizeKey('الأنشطة المندمجة')) || key.includes('activite') || key.includes('activities')) {
            return ASSESSMENT_LABELS.activities;
        }
        if (key.includes(normalizeKey('الفرض الثاني')) || /(?:فرض|test|exam|controle).*2|deuxieme|second/.test(key)) {
            return ASSESSMENT_LABELS.second;
        }
        if (key.includes(normalizeKey('الفرض الأول')) || /(?:فرض|test|exam|controle).*1|premier|first/.test(key)) {
            return ASSESSMENT_LABELS.first;
        }
        return '';
    }

    function isAttendanceColumn(primary, secondary) {
        return containsAny(`${primary} ${secondary}`, ['تغيب', 'غياب', 'absence', 'absent', 'attendance']);
    }

    function getGradeColumns(headers, secondaryHeaders) {
        const columns = [];
        for (let index = 0; index < headers.length; index += 1) {
            const primary = text(headers[index]);
            const secondary = text(secondaryHeaders[index]);
            const combined = `${primary} ${secondary}`.trim();
            const hasGradeMarker = containsAny(combined, GRADE_MARKERS);
            const assessment = detectAssessment(combined);
            const isTeacherNotes = containsAny(combined, [
                'ملاحظات',
                'ملاحظة',
                'teacher notes',
                'notes professeur',
                'notes enseignant',
                'observations',
                'comments',
                'remarques'
            ]);
            if ((hasGradeMarker || assessment) && !isAttendanceColumn(primary, secondary) && !isTeacherNotes) {
                columns.push({ index, assessment });
            }
        }
        return columns;
    }

    function canonicalAssessment(explicit, fallback, columnCount, position) {
        if (explicit) return explicit;
        if (fallback) return fallback;
        if (columnCount === 1) return '';
        if (position === 0) return ASSESSMENT_LABELS.first;
        if (position === 1) return ASSESSMENT_LABELS.second;
        return `التقييم ${position + 1}`;
    }

    function hasGradeValue(row, gradeColumns) {
        return gradeColumns.some(({ index }) => !isBlank(row[index]));
    }

    function parseGradesSheets(input) {
        const options = input || {};
        const sheets = Array.isArray(options.sheets) ? options.sheets : [];
        const schoolYear = text(options.schoolYear);
        const students = Array.isArray(options.students) ? options.students : [];
        const studentByCode = new Map();
        students.forEach((student) => {
            const code = normalizeStudentCode(student?.code);
            if (code) studentByCode.set(code, student);
        });
        const knownCodes = new Set(studentByCode.keys());
        const sourceSubject = inferSubjectFromFileName(options.sourceFileName);
        const fileAssessment = inferAssessmentFromFileName(options.sourceFileName);
        const records = [];
        const diagnostics = [];
        const metadata = {
            schoolYear,
            workbookSchoolYears: [],
            semester: null,
            subject: '',
            sections: [],
            levels: [],
            teacherNames: []
        };
        const counts = {
            sheets: sheets.length,
            scannedRows: 0,
            parsedRows: 0,
            skippedRows: 0,
            invalidRows: 0,
            unknownStudents: 0,
            duplicateInputRows: 0,
            uniqueRecords: 0,
            importedStudentCount: 0
        };

        sheets.forEach((sheet) => {
            const sheetName = text(sheet?.name) || 'ورقة';
            const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
            counts.scannedRows += rows.length;
            if (!rows.length) return;

            let headerIndex = -1;
            for (let index = 0; index < Math.min(rows.length, MAX_SCAN_ROWS); index += 1) {
                if (findHeaderIndex(rows[index] || [], CODE_MARKERS) !== -1) {
                    headerIndex = index;
                    break;
                }
            }
            // Auxiliary sheets (for example a validation list) are not grade tables.
            if (headerIndex === -1) return;

            const headers = rows[headerIndex] || [];
            const codeIndex = findHeaderIndex(headers, CODE_MARKERS);
            const secondaryHeaders = isSecondaryHeader(rows[headerIndex + 1], codeIndex, knownCodes)
                ? rows[headerIndex + 1] || []
                : [];
            const dataStart = headerIndex + 1 + (secondaryHeaders.length ? 1 : 0);
            const meta = extractMetadata(rows, headerIndex);
            const semester = meta.semester;
            const subject = normalizeSubject(sourceSubject || meta.subject);
            const gradeColumns = getGradeColumns(headers, secondaryHeaders);
            const teacher = text(meta.teacher);
            const level = meta.level;
            const section = text(meta.section);
            const workbookYear = meta.schoolYear;

            if (workbookYear && !metadata.workbookSchoolYears.includes(workbookYear)) metadata.workbookSchoolYears.push(workbookYear);
            if (semester == null) {
                diagnostics.push(diagnostic(Diagnostics.SEMESTER_UNRESOLVED, 'تعذر تحديد الدورة الدراسية', sheetName, headerIndex + 1, 'semester'));
            } else if (metadata.semester == null) {
                metadata.semester = semester;
            }
            if (!subject) {
                diagnostics.push(diagnostic(Diagnostics.SUBJECT_UNRESOLVED, 'تعذر تحديد المادة من اسم الملف أو بيانات المصنف', sheetName, headerIndex + 1, 'subject'));
            } else if (!metadata.subject) {
                metadata.subject = subject;
            }
            if (section && !metadata.sections.includes(section)) metadata.sections.push(section);
            if (level && !metadata.levels.includes(level)) metadata.levels.push(level);
            if (teacher && !metadata.teacherNames.includes(teacher)) metadata.teacherNames.push(teacher);
            if (!gradeColumns.length) {
                diagnostics.push(diagnostic(Diagnostics.GRADE_COLUMNS_NOT_FOUND, 'لم يتم العثور على أعمدة نقط صالحة', sheetName, headerIndex + 1, 'grade'));
                return;
            }
            if (semester == null || !subject) return;

            const resolvedColumns = gradeColumns.map((column, position) => ({
                ...column,
                assessment: canonicalAssessment(column.assessment, fileAssessment, gradeColumns.length, position)
            }));
            if (resolvedColumns.some((column) => !column.assessment)) {
                diagnostics.push(
                    diagnostic(Diagnostics.ASSESSMENT_UNRESOLVED, 'تعذر تحديد نوع التقييم من عنوان العمود أو اسم الملف', sheetName, headerIndex + 1, 'assessment')
                );
                return;
            }
            const teacherColumn = headers
                .map((header, index) => `${text(header)} ${text(secondaryHeaders[index])}`)
                .findIndex(
                    (header) =>
                        containsAny(header, ['teacher', 'teachername', 'professeur', 'enseignant', 'الأستاذ', 'الاستاذ']) &&
                        !containsAny(header, ['ملاحظات', 'ملاحظة', 'notes', 'note', 'observation', 'comment'])
                );
            const levelColumn = findHeaderIndex(headers, ['level', 'niveau', 'المستوى']);

            for (let rowIndex = dataStart; rowIndex < rows.length; rowIndex += 1) {
                const row = rows[rowIndex] || [];
                const rawCode = row[codeIndex];
                const code = normalizeStudentCode(rawCode);
                if (!code && !hasGradeValue(row, resolvedColumns)) {
                    counts.skippedRows += 1;
                    continue;
                }
                if (!code) {
                    counts.invalidRows += 1;
                    diagnostics.push(diagnostic(Diagnostics.STUDENT_CODE_MISSING, 'صف النقطة لا يحتوي على رقم تلميذ', sheetName, rowIndex + 1, 'student_code'));
                    continue;
                }
                const student = studentByCode.get(code);
                if (!student) {
                    counts.unknownStudents += 1;
                    diagnostics.push(
                        diagnostic(Diagnostics.UNKNOWN_STUDENT, `رقم التلميذ غير موجود في السنة الدراسية: ${code}`, sheetName, rowIndex + 1, 'student_code')
                    );
                    continue;
                }

                let rowProduced = false;
                resolvedColumns.forEach((column) => {
                    const rawGrade = row[column.index];
                    if (isBlank(rawGrade)) return;
                    const grade = parseStrictNumber(rawGrade);
                    if (!Number.isFinite(grade) || grade < 0 || grade > 20) {
                        counts.invalidRows += 1;
                        diagnostics.push(
                            diagnostic(Diagnostics.INVALID_GRADE, `النقطة يجب أن تكون رقماً بين 0 و20: ${text(rawGrade)}`, sheetName, rowIndex + 1, 'grade')
                        );
                        return;
                    }
                    const rowTeacher = teacherColumn === -1 ? '' : text(row[teacherColumn]);
                    const rowLevel = levelColumn === -1 ? '' : normalizeLevel(row[levelColumn]);
                    const finalSection = section || text(student.section);
                    const finalLevel = rowLevel || level;
                    records.push({
                        student_id: student.id,
                        student_code: code,
                        teacher_id: null,
                        subject,
                        assessment: column.assessment,
                        grade,
                        semester,
                        teacher_name: rowTeacher || teacher,
                        level: finalLevel,
                        section: finalSection,
                        school_year: schoolYear
                    });
                    rowProduced = true;
                    if (finalSection && !metadata.sections.includes(finalSection)) metadata.sections.push(finalSection);
                    if (finalLevel && !metadata.levels.includes(finalLevel)) metadata.levels.push(finalLevel);
                    if (rowTeacher && !metadata.teacherNames.includes(rowTeacher)) metadata.teacherNames.push(rowTeacher);
                });
                if (rowProduced) counts.parsedRows += 1;
                else counts.skippedRows += 1;
            }
        });

        const recordMap = new Map();
        records.forEach((record) => {
            const key = `${record.school_year}||${record.student_code}||${record.subject}||${record.assessment}||${record.semester}`;
            if (recordMap.has(key)) {
                counts.duplicateInputRows += 1;
                diagnostics.push(
                    diagnostic(
                        Diagnostics.DUPLICATE_GRADE,
                        `نقطة مكررة لنفس المادة والتقييم: ${record.student_code} ${record.subject} ${record.assessment} D${record.semester} (تم الاحتفاظ بآخر قيمة ${record.grade})`,
                        '',
                        null,
                        'grade',
                        'warning',
                        false
                    )
                );
            }
            recordMap.set(key, record);
        });
        const uniqueRecords = Array.from(recordMap.values());
        counts.uniqueRecords = uniqueRecords.length;
        counts.importedStudentCount = new Set(uniqueRecords.map((record) => record.student_code)).size;

        return {
            records: uniqueRecords,
            metadata,
            diagnostics,
            counts,
            valid: uniqueRecords.length > 0 && !diagnostics.some((item) => item.blocking)
        };
    }

    return {
        normalizeStudentCode,
        parseGradesSheets
    };
});
