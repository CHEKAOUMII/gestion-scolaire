/*
 * Pure workbook-to-student transformation. It does not depend on DOM, IPC, or
 * XLSX so the same parser can run in the renderer and in Node tests.
 */
(function (root, factory) {
    const api = factory(root || {});
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.StudentImportParser = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const MAX_HEADER_SCAN_ROWS = 60;
    const METADATA_ALIASES = Object.freeze({
        schoolName: ['المؤسسة', 'اسم المؤسسة', 'school', 'school name', 'institution', 'établissement', 'etablissement', 'nom établissement'],
        level: ['المستوى', 'المستوى الدراسي', 'level', 'school level', 'schoollevel', 'niveau'],
        section: ['القسم', 'الفصل', 'section', 'class', 'classe', 'group']
    });
    const HEADER_ALIASES = Object.freeze({
        code: ['code', 'studentcode', 'massar', 'massarcode', 'codemassar', 'codeeleve', 'مسار', 'الرمز', 'رمز', 'رقم التلميذ', 'cne'],
        familyName: ['familyname', 'lastname', 'nom', 'النسب', 'العائلي', 'الاسم العائلي'],
        firstName: ['firstname', 'name', 'prenom', 'الاسم', 'الإسم', 'الاسم الشخصي'],
        fullName: ['fullname', 'studentname', 'nomcomplet', 'الاسم الكامل', 'الاسم والنسب'],
        gender: ['gender', 'sex', 'genre', 'النوع', 'الجنس'],
        birthDate: ['birthdate', 'dateofbirth', 'datedenaissance', 'تاريخ الازدياد', 'تاريخ الميلاد'],
        birthPlace: ['birthplace', 'placeofbirth', 'lieudenaissance', 'مكان الازدياد', 'مكان الميلاد', 'مسقط الرأس'],
        section: METADATA_ALIASES.section,
        level: METADATA_ALIASES.level,
        schoolName: METADATA_ALIASES.schoolName
    });

    function text(value) {
        return String(value ?? '').trim();
    }

    function normalizeArabicDigits(value) {
        return text(value).replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
    }

    function normalizeKey(value) {
        return text(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[\u064B-\u065F]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9\u0600-\u06FF]+/g, '');
    }

    function normalizeStudentCode(value) {
        const raw = normalizeArabicDigits(value).replace(/^'+/, '').replace(/\s+/g, '');
        if (!raw) return '';
        if (/^\d+\.0+$/.test(raw)) return raw.replace(/\.0+$/, '');
        return raw.toUpperCase();
    }

    function excelDateToIso(value) {
        if (value === null || value === undefined || value === '') return '';
        if (typeof value === 'number') {
            const date = new Date((value - 25569) * 86400 * 1000);
            return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
        }
        const parsed = new Date(text(value));
        return Number.isNaN(parsed.getTime()) ? text(value) : parsed.toISOString().slice(0, 10);
    }

    function normalizeSchoolName(value) {
        return text(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[\u064B-\u065Fـ]/g, '')
            .toLowerCase()
            .replace(/[«»“”"'`]/g, '')
            .replace(/[()\[\]{}.,،:؛;|/\\_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function matchesAlias(value, aliases) {
        const key = normalizeKey(value);
        return Boolean(key) && aliases.some((alias) => {
            const aliasKey = normalizeKey(alias);
            return aliasKey && key.includes(aliasKey);
        });
    }

    function isOnlyAlias(value, aliases) {
        const key = normalizeKey(value).replace(/[:：]+$/g, '');
        return aliases.some((alias) => key === normalizeKey(alias));
    }

    function findHeaderIndex(row, aliases) {
        for (let index = 0; index < row.length; index += 1) {
            if (matchesAlias(row[index], aliases)) return index;
        }
        return -1;
    }

    function mapHeaderPositions(headers) {
        return Object.fromEntries(Object.entries(HEADER_ALIASES).map(([key, aliases]) => [key, findHeaderIndex(headers, aliases)]));
    }

    function findHeaderRow(rows) {
        let best = { index: -1, score: -1, headers: [] };
        const limit = Math.min(rows.length, MAX_HEADER_SCAN_ROWS);
        for (let index = 0; index < limit; index += 1) {
            const headers = rows[index] || [];
            const code = findHeaderIndex(headers, HEADER_ALIASES.code);
            if (code === -1) continue;
            const name = findHeaderIndex(headers, HEADER_ALIASES.fullName) !== -1 ||
                findHeaderIndex(headers, HEADER_ALIASES.firstName) !== -1;
            const score = 1 + (name ? 1 : 0);
            if (score > best.score) best = { index, score, headers };
        }
        return best;
    }

    function readInlineValue(value, aliases) {
        const raw = text(value);
        const colonIndex = raw.search(/[:：]/);
        if (!raw || colonIndex === -1 || !matchesAlias(raw.slice(0, colonIndex), aliases)) return '';
        return text(raw.slice(colonIndex + 1));
    }

    function readLabeledValue(rows, aliases, limit) {
        const rowLimit = Math.min(rows.length, limit == null ? MAX_HEADER_SCAN_ROWS : limit);
        for (let rowIndex = 0; rowIndex < rowLimit; rowIndex += 1) {
            const row = rows[rowIndex] || [];
            for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
                const raw = text(row[columnIndex]);
                if (!raw || !matchesAlias(raw, aliases)) continue;

                const inline = readInlineValue(raw, aliases);
                if (inline) return inline;

                if (!isOnlyAlias(raw, aliases)) continue;
                for (const offset of [1, -1, 2, -2, 3, -3, 4, -4]) {
                    const candidate = text(row[columnIndex + offset]);
                    if (candidate && !matchesAlias(candidate, aliases) && !/^[:：—-]+$/.test(candidate)) return candidate;
                }
                for (let rowOffset = 1; rowOffset <= 2; rowOffset += 1) {
                    const candidate = text((rows[rowIndex + rowOffset] || [])[columnIndex]);
                    if (candidate && !matchesAlias(candidate, aliases) && !/^[:：—-]+$/.test(candidate)) return candidate;
                }
            }
        }
        return '';
    }

    function extractMetadata(rows, headerIndex) {
        const limit = headerIndex === -1 ? Math.min(rows.length, MAX_HEADER_SCAN_ROWS) : headerIndex;
        return {
            schoolName: readLabeledValue(rows, METADATA_ALIASES.schoolName, limit),
            level: readLabeledValue(rows, METADATA_ALIASES.level, limit),
            section: readLabeledValue(rows, METADATA_ALIASES.section, limit)
        };
    }

    function defaultNormalizeLevel(value) {
        const raw = normalizeArabicDigits(value);
        if (!raw) return '';
        const upper = raw.toUpperCase().replace(/[-_\s]?\d+$/, '').trim();
        const names = [
            ['1BACSEG', 'الأولى باكالوريا علوم تجريبية'],
            ['1BACSEF', 'الأولى باكالوريا علوم تجريبية خيار فرنسية'],
            ['1BACSMF', 'الأولى باكالوريا علوم رياضية خيار فرنسية'],
            ['1BACSM', 'الأولى باكالوريا علوم رياضية'],
            ['2BACSPF', 'الثانية باكالوريا علوم فيزيائية خيار فرنسية'],
            ['2BACSE', 'الثانية باكالوريا علوم تجريبية'],
            ['2BAC', 'الثانية باكالوريا'],
            ['TCSF', 'الجذع المشترك العلمي خيار فرنسية'],
            ['TCSA', 'الجذع المشترك العلمي خيار عربية'],
            ['TCLSH', 'الجذع المشترك للآداب والعلوم الإنسانية'],
            ['TCS', 'الجذع المشترك العلمي'],
            ['TCL', 'الجذع المشترك للآداب والعلوم الإنسانية'],
            ['TC', 'الجذع المشترك']
        ];
        const match = names.find(([code]) => upper === code || upper.startsWith(code));
        return match ? match[1] : raw.trim();
    }

    function diagnostic(code, message, sheet, row, field, severity = 'error') {
        return {
            code,
            severity,
            stage: 'parse',
            message,
            sheet: sheet || '',
            row: row || null,
            field: field || '',
            rule: code.toLowerCase(),
            action: severity === 'error' ? 'correct_file' : 'review'
        };
    }

    function parseStudentSheets({ sheets = [], schoolYear = '', configuredSchoolName = '', normalizeLevel } = {}) {
        const diagnostics = [];
        const contexts = [];
        const metadataSchools = new Map();
        const levelNormalizer = typeof normalizeLevel === 'function' ? normalizeLevel : defaultNormalizeLevel;

        for (const sheet of sheets) {
            const name = text(sheet?.name) || 'ورقة';
            const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
            if (!rows.some((row) => (row || []).some((cell) => text(cell)))) continue;

            const header = findHeaderRow(rows);
            if (header.index === -1) {
                diagnostics.push(diagnostic(
                    'STUDENT_CODE_COLUMN_MISSING',
                    `تعذر العثور على عمود رمز مسار في الورقة «${name}».`,
                    name,
                    null,
                    'code'
                ));
                continue;
            }

            const metadata = extractMetadata(rows, header.index);
            const metadataSchoolKey = normalizeSchoolName(metadata.schoolName);
            if (metadataSchoolKey && !metadataSchools.has(metadataSchoolKey)) {
                metadataSchools.set(metadataSchoolKey, metadata.schoolName);
            }
            contexts.push({ name, rows, header, headers: mapHeaderPositions(header.headers), metadata });
        }

        const workbookSchoolName = metadataSchools.size === 1 ? [...metadataSchools.values()][0] : '';
        const records = [];
        const seenCodes = new Map();
        const schoolValues = new Map();
        const levelValues = new Set();
        const sectionValues = new Set();
        let unresolvedLevelWarning = false;

        for (const context of contexts) {
            const { name, rows, header, headers, metadata } = context;
            for (let index = header.index + 1; index < rows.length; index += 1) {
                const row = rows[index] || [];
                const code = normalizeStudentCode(row[headers.code]);
                if (!code) continue;

                const firstName = headers.firstName === -1 ? '' : text(row[headers.firstName]);
                const familyName = headers.familyName === -1 ? '' : text(row[headers.familyName]);
                const explicitFullName = headers.fullName === -1 ? '' : text(row[headers.fullName]);
                const fullName = explicitFullName || `${firstName} ${familyName}`.trim() || code;
                const section = (headers.section === -1 ? '' : text(row[headers.section])) || metadata.section || name;
                const rawLevel = (headers.level === -1 ? '' : text(row[headers.level])) || metadata.level || section;
                const level = rawLevel ? text(levelNormalizer(rawLevel)) : '';
                const rowSchoolName = headers.schoolName === -1 ? '' : text(row[headers.schoolName]);
                const schoolName = rowSchoolName || metadata.schoolName || workbookSchoolName;

                if (section) sectionValues.add(section);
                if (level) levelValues.add(level);
                if (!level && !unresolvedLevelWarning) {
                    diagnostics.push(diagnostic(
                        'LEVEL_UNRESOLVED',
                        'تعذر تحديد المستوى لبعض التلاميذ؛ راجع عمود المستوى أو اسم القسم.',
                        name,
                        index + 1,
                        'level',
                        'warning'
                    ));
                    unresolvedLevelWarning = true;
                }
                const schoolKey = normalizeSchoolName(schoolName);
                if (schoolKey && !schoolValues.has(schoolKey)) schoolValues.set(schoolKey, schoolName);

                const previous = seenCodes.get(code);
                if (previous) {
                    diagnostics.push(diagnostic(
                        'DUPLICATE_STUDENT_CODE',
                        `رمز مسار مكرر «${code}»؛ تم الاحتفاظ بأول ظهور في الورقة «${previous.sheet}» والصف ${previous.row}.`,
                        name,
                        index + 1,
                        'code',
                        'warning'
                    ));
                    continue;
                }
                seenCodes.set(code, { sheet: name, row: index + 1 });
                records.push({
                    code,
                    full_name: fullName,
                    family_name: familyName,
                    birth_date: headers.birthDate === -1 ? '' : excelDateToIso(row[headers.birthDate]),
                    birth_place: headers.birthPlace === -1 ? '' : text(row[headers.birthPlace]),
                    gender: headers.gender === -1 ? '' : text(row[headers.gender]),
                    section,
                    level,
                    school_name: schoolName,
                    school_year: schoolYear,
                    status: 'active',
                    registration_type: 'new'
                });
            }
        }

        if (!records.length) {
            diagnostics.push(diagnostic('NO_VALID_STUDENTS', 'لم يتم العثور على بيانات تلاميذ صالحة.', '', null, 'students'));
        }

        if (!schoolValues.size) {
            diagnostics.push(diagnostic(
                'SCHOOL_NAME_MISSING',
                'لم يتم العثور على اسم المؤسسة في الملف؛ سيتم الاستيراد دون تغيير اسم المؤسسة الموجود مسبقاً.',
                '',
                null,
                'school_name',
                'warning'
            ));
        }
        if (!normalizeSchoolName(configuredSchoolName)) {
            diagnostics.push(diagnostic(
                'CONFIGURED_SCHOOL_MISSING',
                'اسم المؤسسة المضبوط في إعدادات التطبيق غير متوفر؛ تعذر إجراء مطابقة كاملة للمؤسسة.',
                '',
                null,
                'school_name',
                'warning'
            ));
        }

        const schoolEntries = [...schoolValues.entries()];
        if (schoolEntries.length > 1) {
            diagnostics.push(diagnostic(
                'MULTIPLE_SCHOOLS',
                `يحتوي الملف على مؤسسات متعددة: ${schoolEntries.map(([, value]) => value).join('، ')}. لم يتم حفظ أي سجل.`,
                '',
                null,
                'school_name'
            ));
        } else if (schoolEntries.length === 1 && normalizeSchoolName(configuredSchoolName) && schoolEntries[0][0] !== normalizeSchoolName(configuredSchoolName)) {
            diagnostics.push(diagnostic(
                'SCHOOL_MISMATCH',
                `المؤسسة في الملف «${schoolEntries[0][1]}» لا تطابق المؤسسة المضبوطة «${text(configuredSchoolName)}». لم يتم حفظ أي سجل.`,
                '',
                null,
                'school_name'
            ));
        }

        const errors = diagnostics.filter((item) => item.severity === 'error');
        return {
            valid: errors.length === 0 && records.length > 0,
            records,
            diagnostics,
            errors,
            warnings: diagnostics.filter((item) => item.severity === 'warning'),
            schools: schoolEntries.map(([, value]) => value),
            levels: [...levelValues],
            sections: [...sectionValues]
        };
    }

    return { parseStudentSheets, normalizeSchoolName, normalizeStudentCode };
});
