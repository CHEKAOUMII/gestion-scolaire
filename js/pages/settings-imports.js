const FILE_INPUTS = {
    students: 'students-file-input',
    grades: 'grades-file-input',
    absences: 'absences-file-input',
    fet: 'fet-file-input'
};
const ACTION_LABELS = {
    students: 'لائحة التلاميذ',
    grades: 'النقط',
    absences: 'الغياب',
    fet: 'FET'
};

const XLSX_CDN = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
let xlsxLoaderPromise = null;

function ensureXlsxLoaded() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxLoaderPromise) return xlsxLoaderPromise;

    xlsxLoaderPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-dynamic-src="${XLSX_CDN}"]`);
        if (existing) {
            existing.addEventListener('load', () => resolve(window.XLSX), { once: true });
            existing.addEventListener('error', () => reject(new Error('تعذر تحميل مكتبة Excel')), { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = XLSX_CDN;
        script.async = true;
        script.defer = true;
        script.dataset.dynamicSrc = XLSX_CDN;
        script.onload = () => resolve(window.XLSX);
        script.onerror = () => reject(new Error('تعذر تحميل مكتبة Excel'));
        document.head.appendChild(script);
    }).catch(err => {
        xlsxLoaderPromise = null;
        throw err;
    });

    return xlsxLoaderPromise;
}

const HEADER_ALIASES = {
    code: [
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
        'cne'
    ],
    familyName: ['familyname', 'lastname', 'nom', 'النسب', 'العائلي', 'الاسم_العائلي'],
    firstName: ['firstname', 'name', 'prenom', 'الاسم', 'الإسم', 'الاسمالشخصي'],
    fullName: ['fullname', 'studentname', 'nomcomplet', 'الاسمالكامل', 'الاسموالنسب'],
    gender: ['gender', 'sex', 'genre', 'النوع', 'الجنس'],
    birthDate: ['birthdate', 'dateofbirth', 'datedenaissance', 'تاريخالازدياد', 'تاريخالميلاد'],
    section: ['section', 'class', 'classe', 'group', 'القسم', 'الفصل'],
    teacherName: [
        'teacher',
        'teachername',
        'teacher name',
        'prof',
        'professeur',
        'nom professeur',
        'enseignant',
        'الأستاذ',
        'الاستاذ',
        'الأستاذة',
        'الاستاذة',
        'اسم الأستاذ',
        'اسم الاستاذ',
        'أستاذ المادة',
        'استاذ المادة'
    ],
    level: ['level', 'niveau', 'schoollevel', 'المستوى'],
    subject: ['subject', 'matiere', 'module', 'المادة', 'مادة'],
    grade: ['grade', 'score', 'note', 'mark', 'النقطة', 'النقط', 'الدرجة'],
    semester: ['semester', 'term', 'periode', 'دورة', 'الاسدس'],
    month: ['month', 'mois', 'moisabsence', 'periode', 'الشهر'],
    absenceDate: ['absencedate', 'date', 'dateabsence', 'datedabsence', 'تاريخالغياب'],
    absenceType: ['absencetype', 'type', 'natureabsence', 'نوعالغياب', 'نوع'],
    justifiedHours: [
        'justifiedhours',
        'justified',
        'justifie',
        'justifiee',
        'justifiees',
        'nbrabsencesjustifiees',
        'heuresjustifiees',
        'مبرر',
        'ساعاتمبررة'
    ],
    unjustifiedHours: [
        'unjustifiedhours',
        'unjustified',
        'nonjustified',
        'nonjustifie',
        'nonjustifiee',
        'nonjustifiees',
        'nbrabsencesnonjustifiees',
        'heuresnonjustifiees',
        'غيرمبرر',
        'ساعاتغيرمبررة'
    ],
    hours: ['hours', 'nbrhours', 'nbheures', 'heuresabsence', 'totalhours', 'الساعات', 'عددالساعات'],
    days: ['days', 'nbrdays', 'nbjours', 'jours', 'الأيام', 'عددالأيام']
};
const GRADES_IMPORT_DEBUG =
    /[?\u0026]debugGrades=1(?:\u0026|$)/.test(location.search) || localStorage.getItem('debugGrades') === '1';
function debugGradesImport(...args) {
    if (GRADES_IMPORT_DEBUG) console.log('[grades-import]', ...args);
}
function debugFetImport(...args) {
    if (GRADES_IMPORT_DEBUG) console.log('[fet-import]', ...args);
}

function validateGrade(value) {
    return Number.isFinite(value) && value >= 0 && value <= 20;
}

function validateAbsenceHours(hours) {
    return Number.isFinite(hours) && hours > 0 && hours <= 200;
}

function createAbsenceRecord({ studentId, studentCode, date, month, type, hours, days, schoolYear }) {
    return {
        student_id: studentId,
        student_code: studentCode,
        absence_date: date || '',
        month: String(month || ''),
        absence_type: type,
        hours,
        days: days || 0,
        reason: '',
        school_year: schoolYear
    };
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        document.querySelectorAll('[data-action]').forEach((btn) => {
            btn.addEventListener('click', () => runImport(btn.dataset.action));
        });

        Object.entries(FILE_INPUTS).forEach(([action, inputId]) => {
            const input = document.getElementById(inputId);
            if (!input) return;
            input.addEventListener('change', async (event) => {
                const files = Array.from(event.target.files || []);
                if (!files.length) return;
                try {
                    const confirmed = await showImportConfirm(action, files);
                    if (!confirmed) {
                        showToast('تم إلغاء الاستيراد', 'info');
                        return;
                    }
                    await handleImport(action, files);
                } catch (error) {
                    showToast(`فشل الاستيراد: ${error.message}`, 'error');
                } finally {
                    input.value = '';
                }
            });
        });

        // Drag & Drop
        initDropZone();

        // Keyboard shortcuts (Ctrl+1..4)
        document.addEventListener('keydown', (e) => {
            if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
            const map = { '1': 'students', '2': 'grades', '3': 'absences', '4': 'fet' };
            const action = map[e.key];
            if (action) { e.preventDefault(); runImport(action); }
        });

        // Delete buttons
        document.getElementById('btn-clear-students')?.addEventListener('click', () => clearData('students'));
        document.getElementById('btn-clear-grades')?.addEventListener('click', () => clearData('grades'));
        document.getElementById('btn-clear-absences')?.addEventListener('click', () => clearData('absences'));
        document.getElementById('btn-clear-timetable')?.addEventListener('click', () => clearData('timetable'));

        await Promise.all([loadLogs(), loadDataStats()]);
    } catch (error) {
        console.error('settings-imports init failed:', error);
        alert('حدث خطأ أثناء فتح صفحة الاستيراد. التفاصيل: ' + (error?.message || error));
    }
});

function setImportButtonsDisabled(disabled) {
    document.querySelectorAll('[data-action]').forEach((btn) => {
        btn.disabled = disabled;
        btn.style.opacity = disabled ? '0.7' : '1';
        btn.style.pointerEvents = disabled ? 'none' : 'auto';
    });
}

function updateImportProgress(percent, message, title = 'جاري الاستيراد...') {
    const card = document.getElementById('import-progress-card');
    const fill = document.getElementById('import-progress-fill');
    const msg = document.getElementById('import-progress-message');
    const p = document.getElementById('import-progress-percent');
    const t = document.getElementById('import-progress-title');
    const track = card?.querySelector('.import-progress-track');
    if (!card || !fill || !msg || !p || !t) return;
    const normalizedPercent = Math.max(0, Math.min(100, percent));
    card.style.display = 'block';
    fill.style.width = `${normalizedPercent}%`;
    p.textContent = `${Math.round(normalizedPercent)}%`;
    track?.setAttribute('aria-valuenow', String(Math.round(normalizedPercent)));
    msg.textContent = message;
    t.innerHTML = `<i class="fas fa-upload"></i> ${title}`;
}

function hideImportProgress(delay = 0) {
    const card = document.getElementById('import-progress-card');
    if (!card) return;
    const reset = () => {
        card.style.display = 'none';
        document.getElementById('import-progress-fill').style.width = '0%';
        document.getElementById('import-progress-percent').textContent = '0%';
        document.getElementById('import-progress-message').textContent = 'جاري تجهيز الملف...';
        card.querySelector('.import-progress-track')?.setAttribute('aria-valuenow', '0');
    };
    if (delay > 0) setTimeout(reset, delay);
    else reset();
}

function escapeConfirmText(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showImportConfirm(action, files) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('import-confirm-overlay');
        const message = document.getElementById('confirm-import-message');
        const okBtn = document.getElementById('confirm-import-ok');
        const cancelBtn = document.getElementById('confirm-import-cancel');
        const previousActive = document.activeElement;
        if (!overlay || !message || !okBtn || !cancelBtn) {
            resolve(window.confirm('هل تريد متابعة الاستيراد؟'));
            return;
        }

        const label = ACTION_LABELS[action] || action;
        const safeFiles = Array.isArray(files) ? files : [];
        if (safeFiles.length === 1) {
            const fileName = escapeConfirmText(safeFiles[0]?.name || 'الملف المحدد');
            message.innerHTML = `هل تريد استيراد ${label} من الملف:<br><strong>${fileName}</strong>؟`;
        } else {
            const preview = safeFiles
                .slice(0, 4)
                .map((f) => escapeConfirmText(f.name))
                .join('، ');
            const more = safeFiles.length > 4 ? ` ... (+${safeFiles.length - 4})` : '';
            message.innerHTML = `هل تريد استيراد ${label} بشكل جماعي من <strong>${safeFiles.length}</strong> ملفات؟<br>${preview}${more}`;
        }
        overlay.classList.add('active');
        overlay.setAttribute('aria-hidden', 'false');
        okBtn.focus();

        const cleanup = (result) => {
            overlay.classList.remove('active');
            overlay.setAttribute('aria-hidden', 'true');
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            overlay.onclick = null;
            if (previousActive && typeof previousActive.focus === 'function') previousActive.focus();
            resolve(result);
        };

        okBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);
        overlay.onclick = (e) => {
            if (e.target === overlay) cleanup(false);
        };
    });
}

function showActionConfirm(messageText) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('import-confirm-overlay');
        const message = document.getElementById('confirm-import-message');
        const okBtn = document.getElementById('confirm-import-ok');
        const cancelBtn = document.getElementById('confirm-import-cancel');
        if (!overlay || !message || !okBtn || !cancelBtn) {
            resolve(window.confirm(messageText));
            return;
        }

        message.textContent = messageText;
        overlay.classList.add('active');

        const cleanup = (result) => {
            overlay.classList.remove('active');
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            overlay.onclick = null;
            resolve(result);
        };

        okBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);
        overlay.onclick = (e) => {
            if (e.target === overlay) cleanup(false);
        };
    });
}

function normalizeKey(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/[\u064B-\u065F]/g, '')
        .replace(/[^a-z0-9\u0600-\u06FF]+/g, '');
}

function normalizeStudentCode(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const cleaned = raw.replace(/\s+/g, '').replace(/^'+/, '');
    if (/^\d+\.0+$/.test(cleaned)) return cleaned.replace(/\.0+$/, '');
    return cleaned.toUpperCase();
}

function isTeacherNoiseText(value) {
    const normalized = normalizeKey(value);
    if (!normalized) return false;
    const noiseTokens = [
        'ملاحظات',
        'ملاحظة',
        'ملاحظاتالاستاذ',
        'ملاحظاتالأستاذ',
        'note',
        'notes',
        'observation',
        'observations',
        'comment',
        'comments',
        'remarque',
        'remarques'
    ].map(normalizeKey);
    return noiseTokens.some((token) => normalized.includes(token));
}

function sanitizeTeacherName(value) {
    const raw = String(value ?? '')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!raw) return '';
    if (isTeacherNoiseText(raw)) return '';
    if (/^\d+([.,]\d+)?$/.test(raw)) return '';

    const normalized = normalizeKey(raw);
    if (!normalized) return '';

    const invalidExact = new Set([
        'teacher',
        'teachername',
        'enseignant',
        'prof',
        'professeur',
        'استاذ',
        'الاستاذ',
        'الأستاذ',
        'notes',
        'note',
        'observation',
        'observations',
        'comment',
        'comments',
        'remarque',
        'remarques',
        'غيرمحدد',
        'unknow',
        'unknown',
        'na',
        'n/a'
    ].map(normalizeKey));
    if (invalidExact.has(normalized)) return '';

    const invalidContains = ['observation', 'comment', 'remarque', 'notes', 'note'].map(normalizeKey);
    if (invalidContains.some((x) => normalized.includes(x))) return '';

    return raw;
}

function findTeacherNameColumnIndex(headers, subHeaders = []) {
    const aliases = HEADER_ALIASES.teacherName.map(normalizeKey).filter(Boolean);
    for (let i = 0; i < headers.length; i++) {
        const h = String(headers[i] ?? '').trim();
        const sh = String(subHeaders[i] ?? '').trim();
        const combined = `${h} ${sh}`.trim();
        const key = normalizeKey(combined);
        if (!key) continue;
        if (isTeacherNoiseText(combined)) continue;

        const matched = aliases.some((alias) => {
            if (key === alias) return true;
            if (alias.length < 5) return false;
            return key.startsWith(alias) || key.endsWith(alias);
        });
        if (matched) return i;
    }
    return -1;
}

function findTeacherNameFromMeta(rows, maxScan = 40) {
    const labels = ['الأستاذ', 'الاستاذ', 'استاذ', 'professeur', 'prof', 'teacher'];
    const labelKeys = labels.map(normalizeKey).filter(Boolean);
    const isTeacherLabelCell = (value) => {
        const cellKey = normalizeKey(value);
        if (!cellKey) return false;
        return labelKeys.some((label) => {
            if (cellKey === label) return true;
            if (label.length < 5) return false;
            return cellKey.startsWith(label) || cellKey.endsWith(label);
        });
    };

    for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
        const row = rows[i] || [];
        for (let c = 0; c < row.length; c++) {
            const cellRaw = String(row[c] ?? '').trim();
            if (!cellRaw || isTeacherNoiseText(cellRaw)) continue;
            if (!isTeacherLabelCell(cellRaw)) continue;

            const inlinePatterns = [
                /(?:الأستاذ|الاستاذ|استاذ)\s*[:：-]\s*(.+)$/i,
                /(?:professeur|prof|teacher)\s*[:：-]\s*(.+)$/i,
                /^(?:الأستاذ|الاستاذ|استاذ)\s+(.+)$/i,
                /^(?:professeur|prof|teacher)\s+(.+)$/i
            ];
            for (const re of inlinePatterns) {
                const m = cellRaw.match(re);
                if (m && m[1]) {
                    const inlineName = sanitizeTeacherName(m[1]);
                    if (inlineName) return inlineName;
                }
            }

            const candidateOffsets = [1, 2, 3, 4, 5, 6, -1, -2, -3, -4, -5, -6];
            for (const offset of candidateOffsets) {
                const value = row[c + offset];
                if (isTeacherLabelCell(value) || isTeacherNoiseText(value)) continue;
                const candidate = sanitizeTeacherName(value);
                if (candidate) return candidate;
            }

            const nextRow = rows[i + 1] || [];
            for (const offset of [0, 1, 2, 3, 4, -1, -2, -3, -4]) {
                const value = nextRow[c + offset];
                if (isTeacherLabelCell(value) || isTeacherNoiseText(value)) continue;
                const candidate = sanitizeTeacherName(value);
                if (candidate) return candidate;
            }
        }
    }

    return '';
}

function findHeaderIndex(headers, aliases) {
    for (let i = 0; i < headers.length; i++) {
        const key = normalizeKey(headers[i]);
        if (!key) continue;
        const matched = aliases.some((alias) => {
            const normalizedAlias = normalizeKey(alias);
            return normalizedAlias && key.includes(normalizedAlias);
        });
        if (matched) return i;
    }
    return -1;
}

function excelDateToIso(value) {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'number') {
        const date = new Date((value - 25569) * 86400 * 1000);
        return isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
    }
    const parsed = new Date(String(value));
    return isNaN(parsed.getTime()) ? String(value).trim() : parsed.toISOString().slice(0, 10);
}

function parseMonthNumber(rawMonth) {
    const text = String(rawMonth ?? '')
        .trim()
        .toLowerCase();
    if (!text || text === 'سنوي' || text === 'annuel' || text === 'annual') return 0;
    const asNum = Number(text);
    if (Number.isFinite(asNum) && asNum >= 1 && asNum <= 12) return asNum;
    const m = {
        يناير: 1,
        janvier: 1,
        january: 1,
        jan: 1,
        فبراير: 2,
        fevrier: 2,
        février: 2,
        february: 2,
        feb: 2,
        مارس: 3,
        mars: 3,
        march: 3,
        mar: 3,
        أبريل: 4,
        ابريل: 4,
        avril: 4,
        april: 4,
        apr: 4,
        ماي: 5,
        mai: 5,
        may: 5,
        يونيو: 6,
        juin: 6,
        june: 6,
        jun: 6,
        يوليوز: 7,
        يوليو: 7,
        juillet: 7,
        july: 7,
        jul: 7,
        غشت: 8,
        août: 8,
        aout: 8,
        august: 8,
        aug: 8,
        شتنبر: 9,
        سبتمبر: 9,
        septembre: 9,
        september: 9,
        sep: 9,
        أكتوبر: 10,
        اكتوبر: 10,
        octobre: 10,
        october: 10,
        oct: 10,
        نونبر: 11,
        نوفمبر: 11,
        novembre: 11,
        november: 11,
        nov: 11,
        دجنبر: 12,
        ديسمبر: 12,
        decembre: 12,
        décembre: 12,
        december: 12,
        dec: 12
    };
    return m[text] || 0;
}

function deriveAbsenceDate(schoolYear, rawDate, rawMonth) {
    const iso = excelDateToIso(rawDate);
    if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const monthNum = parseMonthNumber(rawMonth);
    if (!monthNum) return '';
    const yearStart = Number(String(schoolYear || '').split('/')[0]) || new Date().getFullYear();
    const y = monthNum >= 9 ? yearStart : yearStart + 1;
    return `${y}-${String(monthNum).padStart(2, '0')}-01`;
}

function toNumber(value, fallback = 0) {
    const asText = String(value ?? '')
        .replace(',', '.')
        .trim();
    const extracted = asText.match(/-?\d+(\.\d+)?/);
    const n = Number(extracted ? extracted[0] : asText);
    return Number.isFinite(n) ? n : fallback;
}

function inferStudentCodeColumn(rows, headerIndex, fallbackIndex, validCodesSet) {
    if (!rows.length || !validCodesSet || !validCodesSet.size) return fallbackIndex;
    const firstDataRow = Math.max(0, headerIndex + 1);
    const lastDataRow = Math.min(rows.length - 1, firstDataRow + 120);
    let maxCols = 0;
    for (let i = firstDataRow; i <= lastDataRow; i++) {
        maxCols = Math.max(maxCols, (rows[i] || []).length);
    }
    if (!maxCols) return fallbackIndex;

    let bestIndex = fallbackIndex;
    let bestScore = 0;
    for (let c = 0; c < maxCols; c++) {
        let score = 0;
        for (let i = firstDataRow; i <= lastDataRow; i++) {
            const candidate = normalizeStudentCode((rows[i] || [])[c]);
            if (!candidate || candidate === '0') continue;
            if (validCodesSet.has(candidate)) score += 1;
        }
        if (score > bestScore) {
            bestScore = score;
            bestIndex = c;
        }
    }
    return bestScore > 0 ? bestIndex : fallbackIndex;
}

function getCurrentSchoolYear() {
    return document.getElementById('school-year')?.value || '2025/2026';
}

function getImportLogsTbody() {
    return document.getElementById('import-logs-tbody') || document.getElementById('tbody');
}

async function parseWorkbook(file) {
    await ensureXlsxLoaded();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const workbook = XLSX.read(new Uint8Array(event.target.result), { type: 'array' });
                resolve(workbook);
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = () => reject(new Error('تعذر قراءة الملف'));
        reader.readAsArrayBuffer(file);
    });
}
function inferSubjectFromFileName(fileName) {
    const base = String(fileName || '')
        .replace(/\.[^.]+$/, '')
        .trim();
    if (!base) return '';
    const m = base.match(/^[^_]+_[^_]+_[^_]+_(.+?)_(\d{8,})$/i);
    if (!m) return '';
    const rawSubject = String(m[1] || '')
        .replace(/[_-]+/g, ' ')
        .trim();
    const genericNames = ['sheet', 'sheet1', 'feuil1', 'notes', 'notescc', 'note', 'ورقة1', 'ورقة'];
    const normalized = normalizeKey(rawSubject);
    if (!rawSubject || genericNames.some((n) => normalized === normalizeKey(n))) return '';
    return rawSubject;
}

function deriveLevelFromSection(sectionValue) {
    const section = String(sectionValue || '').trim();
    if (!section) return '';
    const cleaned = section.replace(/[-_\s]?\d+$/, '').trim();
    if (cleaned) return cleaned;
    const firstToken = section.split(/\s+/).filter(Boolean)[0];
    return firstToken || section;
}

function getSheetRows(workbook, sheetName) {
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
}

function mapHeaderPositions(headers) {
    return {
        code: findHeaderIndex(headers, HEADER_ALIASES.code),
        familyName: findHeaderIndex(headers, HEADER_ALIASES.familyName),
        firstName: findHeaderIndex(headers, HEADER_ALIASES.firstName),
        fullName: findHeaderIndex(headers, HEADER_ALIASES.fullName),
        gender: findHeaderIndex(headers, HEADER_ALIASES.gender),
        birthDate: findHeaderIndex(headers, HEADER_ALIASES.birthDate),
        section: findHeaderIndex(headers, HEADER_ALIASES.section),
        teacherName: findHeaderIndex(headers, HEADER_ALIASES.teacherName),
        level: findHeaderIndex(headers, HEADER_ALIASES.level),
        subject: findHeaderIndex(headers, HEADER_ALIASES.subject),
        grade: findHeaderIndex(headers, HEADER_ALIASES.grade),
        semester: findHeaderIndex(headers, HEADER_ALIASES.semester),
        month: findHeaderIndex(headers, HEADER_ALIASES.month),
        absenceDate: findHeaderIndex(headers, HEADER_ALIASES.absenceDate),
        absenceType: findHeaderIndex(headers, HEADER_ALIASES.absenceType),
        justifiedHours: findHeaderIndex(headers, HEADER_ALIASES.justifiedHours),
        unjustifiedHours: findHeaderIndex(headers, HEADER_ALIASES.unjustifiedHours),
        hours: findHeaderIndex(headers, HEADER_ALIASES.hours),
        days: findHeaderIndex(headers, HEADER_ALIASES.days)
    };
}

function findBestHeaderRow(rows, requiredAliases) {
    let best = { index: -1, score: -1 };
    const maxRows = Math.min(rows.length, 15);
    for (let i = 0; i < maxRows; i++) {
        const headers = rows[i] || [];
        let score = 0;
        requiredAliases.forEach((aliases) => {
            if (findHeaderIndex(headers, aliases) !== -1) score += 1;
        });
        if (score > best.score) best = { index: i, score };
    }
    return best;
}

async function runImport(action) {
    const inputId = FILE_INPUTS[action];
    const input = document.getElementById(inputId);
    if (!input) {
        showToast('عنصر رفع الملف غير موجود', 'error');
        return;
    }
    input.click();
}

function inferImportActionFromFiles(files) {
    const safeFiles = Array.isArray(files) ? files : [];
    if (!safeFiles.length) return '';

    const names = safeFiles.map((f) => String(f?.name || '').toLowerCase());
    const hasXml = names.some((n) => n.endsWith('.xml'));
    if (hasXml) return 'fet';

    if (names.some((n) => /abs|absence|غياب/.test(n))) return 'absences';
    if (names.some((n) => /note|notes|grade|point|نقط/.test(n))) return 'grades';
    if (names.some((n) => /student|eleve|élève|talamid|talmid|تلميذ|liste|list/.test(n))) return 'students';

    return safeFiles.length > 1 ? 'grades' : 'students';
}

function initDropZone() {
    const dropZone = document.getElementById('drop-zone');
    if (!dropZone) return;

    const setDragOver = (active) => dropZone.classList.toggle('drag-over', !!active);
    const prevent = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    ['dragenter', 'dragover'].forEach((eventName) => {
        dropZone.addEventListener(eventName, (e) => {
            prevent(e);
            setDragOver(true);
        });
    });

    ['dragleave', 'dragend', 'drop'].forEach((eventName) => {
        dropZone.addEventListener(eventName, (e) => {
            prevent(e);
            setDragOver(false);
        });
    });

    dropZone.addEventListener('drop', async (e) => {
        const files = Array.from(e.dataTransfer?.files || []);
        if (!files.length) return;

        const action = inferImportActionFromFiles(files);
        if (!action) {
            showToast('تعذر تحديد نوع الاستيراد من الملفات المحددة', 'warning');
            return;
        }

        try {
            const confirmed = await showImportConfirm(action, files);
            if (!confirmed) {
                showToast('تم إلغاء الاستيراد', 'info');
                return;
            }
            await handleImport(action, files);
        } catch (error) {
            showToast(`فشل الاستيراد: ${error.message}`, 'error');
        }
    });
}

async function loadDataStats() {
    const setValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value);
    };
    const schoolYear = getCurrentSchoolYear();

    try {
        const students = (await window.api?.students?.getAll?.(schoolYear)) || [];
        setValue('stat-students-count', students.length.toLocaleString('ar-MA'));
    } catch {
        setValue('stat-students-count', '-');
    }

    try {
        const grades = (await window.api?.grades?.getAll?.(schoolYear)) || [];
        setValue('stat-grades-count', grades.length.toLocaleString('ar-MA'));
    } catch {
        setValue('stat-grades-count', '-');
    }

    try {
        const absences = (await window.api?.absences?.getAll?.(schoolYear)) || [];
        setValue('stat-absences-count', absences.length.toLocaleString('ar-MA'));
    } catch {
        setValue('stat-absences-count', '-');
    }

    try {
        const timetableRaw = localStorage.getItem('timetableData');
        const timetable = timetableRaw ? JSON.parse(timetableRaw) : null;
        const teachersCount = Array.isArray(timetable?.teachers) ? timetable.teachers.length : 0;
        setValue('stat-timetable-status', teachersCount > 0 ? `${teachersCount} أستاذ` : 'غير محمّل');
    } catch {
        setValue('stat-timetable-status', 'غير محمّل');
    }
}

async function clearData(type) {
    const schoolYear = getCurrentSchoolYear();
    const labels = {
        students: 'بيانات التلاميذ',
        grades: 'النقط',
        absences: 'سجلات الغياب',
        timetable: 'بيانات الجدول الزمني'
    };
    const label = labels[type] || type;
    const message =
        type === 'timetable'
            ? `هل تريد حذف ${label}؟`
            : `هل تريد حذف ${label} الخاصة بالموسم ${schoolYear}؟`;

    const confirmed = await showActionConfirm(message);
    if (!confirmed) return;

    try {
        if (type === 'students') {
            if (!window.api?.students?.deleteByYear) throw new Error('ميزة حذف التلاميذ غير متاحة في هذا الإصدار');
            const res = await window.api.students.deleteByYear(schoolYear);
            if (!res || res.success === false) throw new Error(res?.error || 'تعذر حذف بيانات التلاميذ');
        } else if (type === 'grades') {
            if (!window.api?.grades?.deleteByYear) throw new Error('ميزة حذف النقط غير متاحة في هذا الإصدار');
            const res = await window.api.grades.deleteByYear(schoolYear);
            if (!res || res.success === false) throw new Error(res?.error || 'تعذر حذف النقط');
        } else if (type === 'absences') {
            const res = await window.api.absences.deleteByYear(schoolYear);
            if (!res || res.success === false) throw new Error(res?.error || 'تعذر حذف الغياب');
        } else if (type === 'timetable') {
            localStorage.removeItem('timetableData');
        } else {
            throw new Error('نوع حذف غير مدعوم');
        }

        await safeLogImport('clear', `تم حذف ${label}${type === 'timetable' ? '' : ` للموسم ${schoolYear}`}`);
        await Promise.all([loadLogs(), loadDataStats()]);
        showToast(`تم حذف ${label} بنجاح`, 'success');
    } catch (error) {
        showToast(`تعذر إتمام الحذف: ${error.message}`, 'error');
    }
}

async function handleImport(action, files) {
    if (!window.api) throw new Error('واجهة النظام غير متاحة');
    setImportButtonsDisabled(true);
    const actionLabel = ACTION_LABELS[action] || action;
    const fileList = Array.isArray(files) ? files : [files];
    updateImportProgress(5, `بدء معالجة ${fileList.length} ملف`, `استيراد ${actionLabel}`);
    try {
        const year = getCurrentSchoolYear();
        let totalImported = 0;
        let totalGradesImported = 0;
        const importedStudentsCodes = new Set();
        let succeededFiles = 0;
        let failedFiles = 0;
        const failedReasons = [];
        if (action === 'absences') {
            updateImportProgress(7, 'تجهيز استيراد الغياب: حذف السجلات القديمة لنفس السنة...');
            const cleanRes = await window.api.absences.deleteByYear(year);
            if (!cleanRes || cleanRes.success === false) {
                throw new Error(cleanRes?.error || 'تعذر تهيئة استيراد الغياب');
            }
        }

        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            const start = (i / fileList.length) * 80;
            const end = ((i + 1) / fileList.length) * 80;
            try {
                updateImportProgress(start + 8, `(${i + 1}/${fileList.length}) جاري قراءة ${file.name}...`);

                if (action === 'fet') {
                    totalImported += await importFetXml(file);
                } else {
                    const workbook = await parseWorkbook(file);
                    updateImportProgress(start + 28, `(${i + 1}/${fileList.length}) تمت القراءة، جاري الحفظ...`);

                    if (action === 'students') {
                        totalImported += await importStudents(workbook, year);
                    } else if (action === 'grades') {
                        const gradeResult = await importGrades(workbook, year, file.name);
                        totalGradesImported += gradeResult.gradesCount;
                        gradeResult.studentCodes.forEach((code) => importedStudentsCodes.add(code));
                        totalImported = totalGradesImported;
                    } else if (action === 'absences') {
                        totalImported += await importAbsences(workbook, year);
                    }
                }

                succeededFiles++;
                updateImportProgress(end, `(${i + 1}/${fileList.length}) تم إنهاء ${file.name}`);
            } catch (fileError) {
                failedFiles++;
                const reason = fileError?.message || String(fileError);
                failedReasons.push(`الملف ${i + 1}: ${file.name} - ${reason}`);
                updateImportProgress(end, `(${i + 1}/${fileList.length}) تعذر استيراد ${file.name}`);
                if (fileList.length === 1) throw fileError;
            }
        }

        if (!succeededFiles) {
            throw new Error(failedReasons[0] || 'تعذر استيراد جميع الملفات');
        }

        const unit =
            action === 'students' ? 'تلميذ' : action === 'grades' ? 'نقطة' : action === 'fet' ? 'أستاذ' : 'سجل غياب';
        const fileWord = fileList.length === 1 ? 'ملف' : 'ملفات';
        const gradesStudentsSummary = action === 'grades' ? ` (${importedStudentsCodes.size} تلميذ)` : '';
        const batchStatus = fileList.length > 1 ? ` (نجاح: ${succeededFiles} | فشل: ${failedFiles})` : '';
        const logDetails = `استيراد ${totalImported} ${unit}${gradesStudentsSummary} من ${fileList.length} ${fileWord}${batchStatus}`;
        await safeLogImport(action, logDetails);
        if (failedReasons.length > 0) {
            window.lastFailedImports = failedReasons.slice();
            console.warn('[import] failed files:', failedReasons);
        }

        updateImportProgress(90, 'جاري تحديث سجل العمليات...');
        await loadLogs();
        updateImportProgress(
            100,
            action === 'grades'
                ? `اكتمل الاستيراد: ${totalImported} ${unit} (${importedStudentsCodes.size} تلميذ)`
                : `اكتمل الاستيراد: ${totalImported} ${unit}`
        );
        hideImportProgress(900);
        const finalMessage =
            action === 'grades'
                ? `تم استيراد ${totalImported} ${unit} تخص ${importedStudentsCodes.size} تلميذ من ${fileList.length} ${fileWord}`
                : `تم استيراد ${totalImported} ${unit} من ${fileList.length} ${fileWord}`;
        if (failedFiles > 0) {
            showToast(`${finalMessage} مع تعذر ${failedFiles} ملف`, 'warning');
        } else {
            showToast(`${finalMessage} بنجاح`, 'success');
        }
    } catch (error) {
        const fileWord = fileList.length === 1 ? 'ملف' : 'ملفات';
        await safeLogImport(action, `فشل الاستيراد (${fileList.length} ${fileWord}): ${error.message}`);
        updateImportProgress(100, `تعذر الاستيراد: ${error.message}`);
        hideImportProgress(1400);
        throw error;
    } finally {
        setImportButtonsDisabled(false);
    }
}

function isImportSummaryLog(details) {
    const text = String(details || '').trim();
    if (!text) return false;
    return /^استيراد\s+/i.test(text) || /^فشل الاستيراد\s*\(/i.test(text);
}

async function importStudents(workbook, schoolYear) {
    const students = [];

    workbook.SheetNames.forEach((sheetName) => {
        const rows = getSheetRows(workbook, sheetName);
        if (!rows.length) return;

        const headerInfo = findBestHeaderRow(rows, [HEADER_ALIASES.code, HEADER_ALIASES.firstName]);
        if (headerInfo.index === -1 || headerInfo.score < 1) return;

        const headers = rows[headerInfo.index];
        const h = mapHeaderPositions(headers);

        for (let i = headerInfo.index + 1; i < rows.length; i++) {
            const row = rows[i] || [];
            const code = String(row[h.code] ?? '').trim();
            if (!code) continue;

            const fullNameFromParts =
                `${String(row[h.firstName] ?? '').trim()} ${String(row[h.familyName] ?? '').trim()}`.trim();
            const fullName = h.fullName !== -1 ? String(row[h.fullName] ?? '').trim() : fullNameFromParts;

            students.push({
                code,
                full_name: fullName || code,
                family_name: h.familyName !== -1 ? String(row[h.familyName] ?? '').trim() : '',
                birth_date: h.birthDate !== -1 ? excelDateToIso(row[h.birthDate]) : '',
                gender: h.gender !== -1 ? String(row[h.gender] ?? '').trim() : '',
                section: h.section !== -1 ? String(row[h.section] ?? '').trim() : sheetName,
                school_year: schoolYear,
                status: 'active',
                registration_type: 'new'
            });
        }
    });

    if (!students.length) throw new Error('لم يتم العثور على بيانات تلاميذ صالحة');

    const deduped = [];
    const seen = new Set();
    students.forEach((s) => {
        if (seen.has(s.code)) return;
        seen.add(s.code);
        deduped.push(s);
    });

    const res = await window.api.students.addBulk(deduped);
    if (!res || res.success === false) throw new Error(res?.error || 'فشل حفظ بيانات التلاميذ');
    return deduped.length;
}

async function importGrades(workbook, schoolYear, sourceFileName = '') {
    const students = (await window.api.students.getAll(schoolYear)) || [];
    const studentByCode = new Map(students.map((s) => [String(s.code || '').trim(), s]));
    const grades = [];
    const subjectFromFileName = inferSubjectFromFileName(sourceFileName);
    debugGradesImport('importGrades:start', {
        schoolYear,
        sheets: workbook.SheetNames.length,
        students: students.length,
        sourceFileName,
        subjectFromFileName
    });

    workbook.SheetNames.forEach((sheetName) => {
        const rows = getSheetRows(workbook, sheetName);
        if (!rows.length) return;

        const maxScan = Math.min(rows.length, 40);
        let headerIndex = -1;
        for (let i = 0; i < maxScan; i++) {
            const headers = rows[i] || [];
            if (findHeaderIndex(headers, HEADER_ALIASES.code) !== -1) {
                headerIndex = i;
                break;
            }
        }
        if (headerIndex === -1) return;

        const headers = rows[headerIndex] || [];
        const subHeaders = rows[headerIndex + 1] || [];
        const codeIndex = findHeaderIndex(headers, HEADER_ALIASES.code);
        if (codeIndex === -1) return;
        const headerMap = mapHeaderPositions(headers);
        const teacherNameColumnIndex = findTeacherNameColumnIndex(headers, subHeaders);
        const levelColumnIndex = headerMap.level;
        debugGradesImport('sheet:header-detected', { sheetName, headerIndex, codeIndex, rows: rows.length });

        const findMetaValue = (labels) => {
            for (let i = 0; i < maxScan; i++) {
                const row = rows[i] || [];
                for (let c = 0; c < row.length; c++) {
                    const cell = normalizeKey(row[c]);
                    if (labels.some((label) => cell.includes(normalizeKey(label)))) {
                        const next = String(row[c + 1] ?? '').trim();
                        if (next) return next;
                    }
                }
            }
            return '';
        };

        const sectionFromMeta = findMetaValue(['القسم', 'classe', 'class', 'section']);
        const teacherNameFromMeta = findTeacherNameFromMeta(rows, maxScan);
        const levelFromMeta = findMetaValue(['المستوى', 'niveau', 'level']);

        const subjectFromMeta = (() => {
            // Primary source: extract subject from source file name
            if (subjectFromFileName) {
                debugGradesImport('subject:method-file-name', {
                    sheetName,
                    sourceFileName,
                    subject: subjectFromFileName
                });
                return subjectFromFileName;
            }

            // Fallback 1: Look for "المادة" or "matiere" label followed by subject name
            for (let i = 0; i < maxScan; i++) {
                const row = rows[i] || [];
                for (let c = 0; c < row.length; c++) {
                    const cell = normalizeKey(row[c]);
                    if (
                        cell.includes(normalizeKey('المادة')) ||
                        cell.includes(normalizeKey('matiere')) ||
                        cell.includes(normalizeKey('module'))
                    ) {
                        // Check next cell for the subject value
                        const next = String(row[c + 1] ?? '').trim();
                        if (
                            next &&
                            !normalizeKey(next).includes(normalizeKey('النقط')) &&
                            !normalizeKey(next).includes('note')
                        ) {
                            debugGradesImport('subject:method1', { sheetName, subject: next, row: i, col: c + 1 });
                            return next;
                        }
                    }
                }
            }

            // Fallback 2: Look for subject column in header with actual subject values
            const headerInfo = findBestHeaderRow(rows, [HEADER_ALIASES.subject]);
            if (headerInfo.index !== -1) {
                const hdrs = rows[headerInfo.index] || [];
                const subjIdx = findHeaderIndex(hdrs, HEADER_ALIASES.subject);
                if (subjIdx !== -1) {
                    // Check if there's a value in the first data row for this column
                    const firstDataRow = rows[headerInfo.index + 1] || [];
                    const subjValue = String(firstDataRow[subjIdx] ?? '').trim();
                    if (subjValue && subjValue.length > 1) {
                        debugGradesImport('subject:method2', {
                            sheetName,
                            subject: subjValue,
                            headerRow: headerInfo.index,
                            subjectColumn: subjIdx
                        });
                        return subjValue;
                    }
                }
            }

            // Fallback 3: Better sheet name parsing - extract subject from common patterns
            const cleanSheetName = sheetName.replace(/^(notescc|notes|note|sheet|ورقة|feuil)\b[\s_-]*/i, '').trim();
            if (cleanSheetName && cleanSheetName !== sheetName) {
                // Sheet name after removing common prefixes
                if (cleanSheetName.length > 1) {
                    debugGradesImport('subject:method3', { sheetName, subject: cleanSheetName });
                    return cleanSheetName;
                }
            }

            // If sheet name is a generic term, use a better fallback
            const genericNames = ['sheet', 'sheet1', 'feuil1', 'notes', 'notescc', 'ورقة1', 'ورقة'];
            if (genericNames.some((n) => normalizeKey(sheetName) === normalizeKey(n))) {
                debugGradesImport('subject:fallback-generic', { sheetName, subject: 'مادة غير محددة' });
                return 'مادة غير محددة';
            }

            debugGradesImport('subject:fallback-sheet-name', { sheetName, subject: sheetName });
            return sheetName;
        })();

        const semesterFromMeta = (() => {
            for (let i = 0; i < maxScan; i++) {
                const row = rows[i] || [];
                for (let c = 0; c < row.length; c++) {
                    const cell = normalizeKey(row[c]);
                    if (cell.includes(normalizeKey('الدورة')) || cell.includes(normalizeKey('semester'))) {
                        const next = String(row[c + 1] ?? '').trim();
                        if (next.includes('الثانية') || next.toLowerCase().includes('2')) return 2;
                        if (next.includes('الأولى') || next.toLowerCase().includes('1')) return 1;
                    }
                }
            }
            return 1;
        })();

        const gradeColumns = [];
        headers.forEach((header, idx) => {
            const h = normalizeKey(header);
            const sh = normalizeKey(subHeaders[idx]);
            const isGradeCol =
                HEADER_ALIASES.grade.some((a) => h.includes(normalizeKey(a)) || sh.includes(normalizeKey(a))) ||
                sh.includes(normalizeKey('النقطة'));
            if (isGradeCol) gradeColumns.push(idx);
        });

        if (!gradeColumns.length) return;
        debugGradesImport('sheet:grade-columns', {
            sheetName,
            gradeColumns,
            subjectFromMeta,
            sectionFromMeta,
            semesterFromMeta,
            teacherNameFromMeta,
            levelFromMeta,
            teacherNameColumnIndex,
            levelColumnIndex
        });

        // Detect which grade columns are "الأنشطة المندمجة" (integrated activities)
        const gradeColumnSuffixes = [];
        let examCounter = 0;
        gradeColumns.forEach((col) => {
            const hText = normalizeKey(headers[col] || '');
            const shText = normalizeKey(subHeaders[col] || '');
            const combined = hText + ' ' + shText;
            const isActivity =
                combined.includes(normalizeKey('أنشطة')) ||
                combined.includes(normalizeKey('مندمجة')) ||
                combined.includes(normalizeKey('نشاط مندمج')) ||
                combined.includes('activit');

            if (isActivity) {
                gradeColumnSuffixes.push(' (الأنشطة المندمجة)');
            } else {
                examCounter++;
                gradeColumnSuffixes.push(gradeColumns.length > 1 ? ` (فرض ${examCounter})` : '');
            }
        });
        debugGradesImport('sheet:column-suffixes', { gradeColumnSuffixes });

        const firstDataRowIndex = subHeaders.length ? headerIndex + 2 : headerIndex + 1;
        let insertedForSheet = 0;
        for (let i = firstDataRowIndex; i < rows.length; i++) {
            const row = rows[i] || [];
            const studentCode = String(row[codeIndex] ?? '').trim();
            if (!studentCode) continue;

            const student = studentByCode.get(studentCode);
            gradeColumns.forEach((col, colPos) => {
                const gradeValue = toNumber(row[col], NaN);
                if (!Number.isFinite(gradeValue)) return;
                const subjectSuffix = gradeColumnSuffixes[colPos];
                const rowTeacherName = sanitizeTeacherName(
                    teacherNameColumnIndex !== -1 ? String(row[teacherNameColumnIndex] ?? '').trim() : ''
                );
                const rowLevel = levelColumnIndex !== -1 ? String(row[levelColumnIndex] ?? '').trim() : '';
                const finalSection = sectionFromMeta || (student ? student.section : '');
                const finalLevel = rowLevel || levelFromMeta || deriveLevelFromSection(finalSection);
                grades.push({
                    student_id: student ? student.id : null,
                    student_code: studentCode,
                    subject: `${subjectFromMeta}${subjectSuffix}`,
                    grade: gradeValue,
                    semester: semesterFromMeta,
                    teacher_name: rowTeacherName || teacherNameFromMeta || '',
                    level: finalLevel,
                    school_year: schoolYear,
                    section: finalSection
                });
                insertedForSheet++;
            });
        }
        debugGradesImport('sheet:done', { sheetName, insertedForSheet, subjectFromMeta });
    });

    if (!grades.length) throw new Error('لم يتم العثور على نقط صالحة داخل الملف');
    debugGradesImport('importGrades:summary', {
        totalGrades: grades.length,
        uniqueStudents: new Set(grades.map((g) => String(g.student_code || '').trim()).filter(Boolean)).size,
        uniqueSubjects: [...new Set(grades.map((g) => g.subject))].slice(0, 40)
    });

    const res = await window.api.grades.saveBulk(grades);
    if (!res || res.success === false) throw new Error(res?.error || 'فشل حفظ النقط');
    const studentCodes = [...new Set(grades.map((g) => String(g.student_code || '').trim()).filter(Boolean))];
    return { gradesCount: grades.length, studentsCount: studentCodes.length, studentCodes };
}

async function importAbsences(workbook, schoolYear) {
    const students = (await window.api.students.getAll(schoolYear)) || [];
    const validCodes = new Set(students.map((s) => normalizeStudentCode(s.code)).filter(Boolean));
    const studentByCode = new Map(students.map((s) => [normalizeStudentCode(s.code), s]).filter(([code]) => !!code));
    const absences = [];

    workbook.SheetNames.forEach((sheetName) => {
        const rows = getSheetRows(workbook, sheetName);
        if (!rows.length) return;

        const looksLikeMassar = (value) => /^[A-Z]\d{9}$/i.test(normalizeStudentCode(value));
        const positionalRows = rows.filter((r) => looksLikeMassar((r || [])[2]));
        const positionalMode = positionalRows.length >= 3 && rows.some((r) => (r || []).length >= 30);

        if (positionalMode) {
            // Massar Matrix Format: Each month has 4 columns (justified days/hours, unjustified days/hours)
            // Months start at column 5, with 4 columns per month
            const monthColumns = [
                { month: 9, startCol: 5 }, // شتنبر (September)
                { month: 10, startCol: 9 }, // أكتوبر (October)
                { month: 11, startCol: 13 }, // نونبر (November)
                { month: 12, startCol: 17 }, // دجنبر (December)
                { month: 1, startCol: 21 }, // يناير (January)
                { month: 2, startCol: 25 }, // فبراير (February)
                { month: 3, startCol: 29 }, // مارس (March)
                { month: 4, startCol: 33 }, // أبريل (April)
                { month: 5, startCol: 37 }, // ماي (May)
                { month: 6, startCol: 41 } // يونيو (June)
            ];

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i] || [];
                const studentCode = normalizeStudentCode(row[2]);
                if (!looksLikeMassar(studentCode)) continue;

                const student = studentByCode.get(studentCode);
                if (!student) continue;

                // Read each month's data from its specific columns
                for (const { month, startCol } of monthColumns) {
                    const justifiedDays = toNumber(row[startCol], 0);
                    const justifiedHours = toNumber(row[startCol + 1], 0);
                    const unjustifiedDays = toNumber(row[startCol + 2], 0);
                    const unjustifiedHours = toNumber(row[startCol + 3], 0);

                    if (justifiedHours > 0) {
                        absences.push({
                            student_id: student.id,
                            student_code: studentCode,
                            absence_date: '',
                            month: String(month),
                            absence_type: 'justified',
                            hours: justifiedHours,
                            days: justifiedDays,
                            reason: '',
                            school_year: schoolYear
                        });
                    }
                    if (unjustifiedHours > 0) {
                        absences.push({
                            student_id: student.id,
                            student_code: studentCode,
                            absence_date: '',
                            month: String(month),
                            absence_type: 'unjustified',
                            hours: unjustifiedHours,
                            days: unjustifiedDays,
                            reason: '',
                            school_year: schoolYear
                        });
                    }
                }
            }
            return;
        }

        const headerInfo = findBestHeaderRow(rows, [
            HEADER_ALIASES.code,
            HEADER_ALIASES.month,
            HEADER_ALIASES.justifiedHours,
            HEADER_ALIASES.unjustifiedHours,
            HEADER_ALIASES.hours,
            HEADER_ALIASES.days,
            HEADER_ALIASES.absenceDate
        ]);
        if (headerInfo.index === -1 || headerInfo.score < 1) return;

        const headers = rows[headerInfo.index];
        const h = mapHeaderPositions(headers);
        if (h.code === -1) return;
        const codeCol = inferStudentCodeColumn(rows, headerInfo.index, h.code, validCodes);
        if (codeCol === -1) return;
        const secondHeader = rows[headerInfo.index + 1] || [];
        const thirdHeader = rows[headerInfo.index + 2] || [];

        const isHoursHeader = (cell) => {
            const key = normalizeKey(cell);
            return key.includes(normalizeKey('الساعات')) || key.includes(normalizeKey('heures'));
        };
        const isDaysHeader = (cell) => {
            const key = normalizeKey(cell);
            return key.includes(normalizeKey('الأيام')) || key.includes(normalizeKey('jours'));
        };
        const getTypeFromHeader = (col) => {
            const cur = normalizeKey(secondHeader[col]);
            const prev = normalizeKey(secondHeader[col - 1]);
            const label = `${cur} ${prev}`;
            if (label.includes(normalizeKey('غير مبرر')) || label.includes(normalizeKey('non'))) return 'unjustified';
            if (label.includes(normalizeKey('مبرر')) || label.includes(normalizeKey('jus'))) return 'justified';
            return '';
        };

        const matrixHourColumns = [];
        if (thirdHeader.length) {
            for (let c = 0; c < thirdHeader.length; c++) {
                if (!isHoursHeader(thirdHeader[c])) continue;
                const type = getTypeFromHeader(c);
                if (!type) continue;
                matrixHourColumns.push({ col: c, type });
            }
        }
        const matrixMode = matrixHourColumns.length >= 4;
        const dataStart = matrixMode ? headerInfo.index + 3 : headerInfo.index + 1;

        for (let i = dataStart; i < rows.length; i++) {
            const row = rows[i] || [];
            const studentCode = normalizeStudentCode(row[codeCol]);
            if (!studentCode) continue;
            if (/^\d{4}\/\d{4}$/.test(studentCode)) continue;
            if (studentCode === '0') continue;

            const student = studentByCode.get(studentCode);
            if (!student) continue;
            const month = h.month !== -1 ? String(row[h.month] ?? '').trim() : matrixMode ? 'سنوي' : '';
            const absenceDate = h.absenceDate !== -1 ? row[h.absenceDate] : '';
            const finalMonth = month || (matrixMode ? 'سنوي' : '');
            const finalDate = deriveAbsenceDate(schoolYear, absenceDate, finalMonth);

            if (matrixMode) {
                let justifiedHours = 0;
                let unjustifiedHours = 0;
                let justifiedDays = 0;
                let unjustifiedDays = 0;

                matrixHourColumns.forEach(({ col, type }) => {
                    const hoursVal = toNumber(row[col], 0);
                    const dayCol = col - 1;
                    const daysVal = dayCol >= 0 && isDaysHeader(thirdHeader[dayCol]) ? toNumber(row[dayCol], 0) : 0;
                    if (type === 'justified') {
                        justifiedHours += hoursVal;
                        justifiedDays += daysVal;
                    } else {
                        unjustifiedHours += hoursVal;
                        unjustifiedDays += daysVal;
                    }
                });

                if (justifiedHours > 0) {
                    absences.push({
                        student_id: student ? student.id : null,
                        student_code: studentCode,
                        absence_date: finalDate,
                        month: finalMonth || 'سنوي',
                        absence_type: 'justified',
                        hours: justifiedHours,
                        days: justifiedDays,
                        reason: '',
                        school_year: schoolYear
                    });
                }
                if (unjustifiedHours > 0) {
                    absences.push({
                        student_id: student ? student.id : null,
                        student_code: studentCode,
                        absence_date: finalDate,
                        month: finalMonth || 'سنوي',
                        absence_type: 'unjustified',
                        hours: unjustifiedHours,
                        days: unjustifiedDays,
                        reason: '',
                        school_year: schoolYear
                    });
                }
            } else {
                const days = h.days !== -1 ? toNumber(row[h.days], 0) : 0;
                const justifiedHours = h.justifiedHours !== -1 ? toNumber(row[h.justifiedHours], 0) : 0;
                const unjustifiedHours = h.unjustifiedHours !== -1 ? toNumber(row[h.unjustifiedHours], 0) : 0;
                const totalHours = h.hours !== -1 ? toNumber(row[h.hours], 0) : 0;

                if (justifiedHours > 0 || unjustifiedHours > 0) {
                    if (justifiedHours > 0) {
                        absences.push({
                            student_id: student ? student.id : null,
                            student_code: studentCode,
                            absence_date: finalDate,
                            month: finalMonth,
                            absence_type: 'justified',
                            hours: justifiedHours,
                            days,
                            reason: '',
                            school_year: schoolYear
                        });
                    }
                    if (unjustifiedHours > 0) {
                        absences.push({
                            student_id: student ? student.id : null,
                            student_code: studentCode,
                            absence_date: finalDate,
                            month: finalMonth,
                            absence_type: 'unjustified',
                            hours: unjustifiedHours,
                            days,
                            reason: '',
                            school_year: schoolYear
                        });
                    }
                    continue;
                }

                if (!(totalHours > 0)) continue;
                const rawType = h.absenceType !== -1 ? String(row[h.absenceType] ?? '').toLowerCase() : '';
                const absenceType = rawType.includes('jus') || rawType.includes('مبر') ? 'justified' : 'unjustified';
                absences.push({
                    student_id: student ? student.id : null,
                    student_code: studentCode,
                    absence_date: finalDate,
                    month: finalMonth,
                    absence_type: absenceType,
                    hours: totalHours,
                    days,
                    reason: '',
                    school_year: schoolYear
                });
            }
        }
    });

    if (!absences.length) throw new Error('لم يتم العثور على سجلات غياب صالحة');

    const res = await window.api.absences.saveBulk(absences);
    if (!res || res.success === false) throw new Error(res?.error || 'فشل حفظ الغياب');
    return absences.length;
}

async function importFetXml(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(e.target.result, 'text/xml');

                // Validate root element
                const rootTag = xmlDoc.documentElement.tagName;
                if (rootTag === 'parsererror' || xmlDoc.querySelector('parsererror')) {
                    throw new Error('ملف XML غير صالح');
                }

                // Day mappings (same as timetable.html)
                const dayMappings = {
                    lundi_m: { day: 'الاثنين', period: 'morning', index: 0 },
                    lundi_s: { day: 'الاثنين', period: 'afternoon', index: 0 },
                    Mardi_m: { day: 'الثلاثاء', period: 'morning', index: 1 },
                    Mardi_s: { day: 'الثلاثاء', period: 'afternoon', index: 1 },
                    Mercredi_m: { day: 'الأربعاء', period: 'morning', index: 2 },
                    Mercredi_s: { day: 'الأربعاء', period: 'afternoon', index: 2 },
                    Jeudi_m: { day: 'الخميس', period: 'morning', index: 3 },
                    Jeudi_s: { day: 'الخميس', period: 'afternoon', index: 3 },
                    Vendredi_m: { day: 'الجمعة', period: 'morning', index: 4 },
                    Vendredi_s: { day: 'الجمعة', period: 'afternoon', index: 4 },
                    Samedi_m: { day: 'السبت', period: 'morning', index: 5 },
                    Samedi_s: { day: 'السبت', period: 'afternoon', index: 5 }
                };

                function getBaseClassName(className) {
                    if (!className) return '';
                    return className.replace(/:[Gg]\d+$/g, '').trim();
                }

                const fetDataLocal = {
                    teachers: [],
                    subjects: new Set(),
                    classes: new Set(),
                    timetables: {}
                };

                // Support both Teachers_Timetable (XML export) and fet format
                let teacherElements;
                if (rootTag === 'Teachers_Timetable') {
                    teacherElements = xmlDoc.querySelectorAll('Teachers_Timetable > Teacher');
                } else if (rootTag === 'fet') {
                    // For .fet files, we don't have a direct timetable — reject
                    throw new Error('ملفات .fet غير مدعومة مباشرة. يرجى تصدير ملف _teachers.xml من FET ثم استيراده.');
                } else {
                    throw new Error('نوع ملف غير معروف. يرجى استخدام ملف _teachers.xml');
                }

                console.log('Found teachers in XML:', teacherElements.length);

                teacherElements.forEach((teacher) => {
                    const teacherName = teacher.getAttribute('name');
                    if (!teacherName) return;

                    fetDataLocal.teachers.push({
                        name: teacherName,
                        displayName: teacherName.replace(/_/g, ' ')
                    });

                    fetDataLocal.timetables[teacherName] = {};

                    const days = teacher.querySelectorAll('Day');
                    days.forEach((day) => {
                        const dayName = day.getAttribute('name');
                        if (!dayName || !dayMappings[dayName]) return;

                        const mapping = dayMappings[dayName];
                        const arabicDay = mapping.day;
                        const periodType = mapping.period;

                        if (!fetDataLocal.timetables[teacherName][arabicDay]) {
                            fetDataLocal.timetables[teacherName][arabicDay] = {
                                morning: {},
                                afternoon: {}
                            };
                        }

                        const hours = day.querySelectorAll('Hour');
                        hours.forEach((hour) => {
                            const hourName = hour.getAttribute('name');
                            if (!hourName) return;

                            const subject = hour.querySelector('Subject');
                            const students = hour.querySelector('Students');
                            const room = hour.querySelector('Room');

                            if (subject) {
                                const subjectName = subject.getAttribute('name') || '';
                                const studentsName = students ? students.getAttribute('name') || '' : '';
                                const roomName = room ? room.getAttribute('name') || '' : '';

                                fetDataLocal.subjects.add(subjectName);
                                if (studentsName) {
                                    const baseClass = getBaseClassName(studentsName);
                                    if (baseClass) fetDataLocal.classes.add(baseClass);
                                }

                                fetDataLocal.timetables[teacherName][arabicDay][periodType][hourName] = {
                                    subject: subjectName,
                                    students: studentsName,
                                    room: roomName
                                };
                            }
                        });
                    });
                });

                // Sort teachers alphabetically
                fetDataLocal.teachers.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ar'));

                if (!fetDataLocal.teachers.length) {
                    throw new Error('لم يتم العثور على أساتذة في الملف');
                }

                // Save to localStorage (same key used by timetable.html)
                const dataToSave = {
                    teachers: fetDataLocal.teachers,
                    subjects: Array.from(fetDataLocal.subjects),
                    classes: Array.from(fetDataLocal.classes),
                    timetables: fetDataLocal.timetables
                };
                localStorage.setItem('timetableData', JSON.stringify(dataToSave));
                console.log('FET data saved to localStorage:', fetDataLocal.teachers.length, 'teachers');

                resolve(fetDataLocal.teachers.length);
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = () => reject(new Error('تعذر قراءة الملف'));
        reader.readAsText(file, 'UTF-8');
    });
}

async function logImport(action, details) {
    const res = await window.api.systemLogs.add({
        action: 'import:' + action,
        details,
        entity_type: 'import',
        entity_id: action
    });
    if (!res || res.success === false) {
        throw new Error(res?.error || 'تعذر تسجيل العملية');
    }
}

async function safeLogImport(action, details) {
    try {
        await logImport(action, details);
    } catch (error) {
        console.warn('Import log failed:', error);
        showToast('تم الاستيراد، لكن تعذر حفظ سجل العملية', 'warning');
    }
}

async function loadLogs() {
    if (!window.api || !window.api.systemLogs || !window.api.systemLogs.getAll) {
        const tb = getImportLogsTbody();
        if (!tb) return;
        tb.innerHTML =
            '<tr><td colspan="4" style="padding: 30px; text-align: center; color: #888;">تعذر تحميل السجل (API غير متاحة)</td></tr>';
        return;
    }

    const escapeHtml = (value) =>
        String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    const formatDateTime = (raw) => {
        const text = String(raw || '').trim();
        if (!text) return { date: '-', time: '' };
        const cleaned = text.replace('T', ' ').replace('Z', '');
        const parts = cleaned.split(/\s+/);
        return { date: parts[0] || '-', time: parts[1] || '' };
    };

    const rows = ((await window.api.systemLogs.getAll(300)) || []).filter(
        (x) => (x.entity_type || '') === 'import' && isImportSummaryLog(x.details)
    );
    const tb = getImportLogsTbody();
    if (!tb) return;
    tb.innerHTML = rows.length
        ? rows
            .map(
                (r, i) => `
                <tr>
                    <td class="log-index">${escapeHtml(r.id || i + 1)}</td>
                    <td class="log-action"><bdi dir="ltr">${escapeHtml(r.action || '-')}</bdi></td>
                    <td class="log-details" dir="auto">${escapeHtml(r.details || '-')}</td>
                    <td class="log-date-cell">
                        <div class="log-date" dir="ltr">${formatDateTime(r.created_at).date}</div>
                        <div class="log-time" dir="ltr">${formatDateTime(r.created_at).time}</div>
                    </td>
                </tr>
            `
            )
            .join('')
        : '<tr><td colspan="4" style="padding: 30px; text-align: center; color: #888;"><i class="fas fa-inbox" style="font-size: 32px; display: block; margin-bottom: 10px;"></i>لا توجد عمليات بعد</td></tr>';
}
