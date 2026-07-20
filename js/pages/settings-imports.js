const FILE_INPUTS = {
    students: 'students-file-input',
    grades: 'grades-file-input',
    absences: 'absences-file-input',
    fet: 'fet-file-input',
    'student-status': 'status-file-input',
    orientation: 'orientation-file-input',
    'agent-xml': 'agent-xml-file-input'
};
const ACTION_LABELS = {
    students: 'لائحة التلاميذ',
    grades: 'النقط',
    absences: 'الغياب',
    fet: 'FET',
    'student-status': 'الوضعيات الدراسية',
    orientation: 'التوجيه المدرسي',
    'agent-xml': 'ملف الوزارة'
};

const XLSX_CDN = 'vendor/xlsx.full.min.js';
let xlsxLoaderPromise = null;

function setElementHidden(element, hidden) {
    if (!element) return;
    element.classList.toggle('hidden', hidden);
}

function renderImportStatusPanel(schoolYear) {
    const panel   = document.getElementById('import-status-panel');
    const yearLbl = document.getElementById('status-panel-year-label');
    if (!panel) return;
    if (yearLbl) yearLbl.textContent = schoolYear || '';

    const state    = DataSourceRegistry.getYear(schoolYear);
    const warnings = state.warnings || [];

    const SOURCES = [
        { key: 'students',    label: 'التلاميذ',    optional: false },
        { key: 'agent_xml',   label: 'ملف الوزارة', optional: false },
        { key: 'fet',         label: 'FET (جدول)', optional: false },
        { key: 'grades',      label: 'النقط',       optional: false },
        { key: 'absences',    label: 'الغياب',      optional: false },
        { key: 'status',      label: 'الوضعيات',   optional: true  },
        { key: 'orientation', label: 'التوجيه',     optional: true  }
    ];

    SOURCES.forEach(({ key, optional }) => {
        const row = panel.querySelector(`[data-source="${key}"]`);
        if (!row) return;

        const src      = state[key];
        const srcWarns = warnings.filter((w) => w.source === key);
        const hasError = srcWarns.some((w) => w.level === 'error');
        const hasWarn  = srcWarns.some((w) => w.level === 'warning');

        row.className = 'import-status-row ' + (
            !src?.importedAt ? (optional ? '' : 'status-pending')
            : hasError       ? 'status-error'
            : hasWarn        ? 'status-warn'
            :                  'status-ok'
        );

        const iconEl   = row.querySelector('.import-status-icon');
        const detailEl = row.querySelector('.import-status-detail');
        const actionEl = row.querySelector('.import-status-action');

        if (iconEl) {
            const ic = !src?.importedAt
                ? (optional ? 'fa-minus-circle' : 'fa-clock')
                : hasError  ? 'fa-exclamation-circle'
                : hasWarn   ? 'fa-exclamation-triangle'
                :             'fa-check-circle';
            iconEl.innerHTML = `<i class="fas ${ic}"></i>`;
        }

        if (detailEl) {
            if (!src?.importedAt) {
                detailEl.textContent = optional ? 'اختياري' : 'لم يُستورد بعد';
            } else {
                const parts = [];
                if (src.count    != null)  parts.push(`${src.count.toLocaleString('ar-MA')} سجل`);
                if (src.sections?.length)  parts.push(`${src.sections.length} قسم`);
                if (src.teachers?.length)  parts.push(`${src.teachers.length} أستاذ`);
                if (src.subjects?.length)  parts.push(`${src.subjects.length} مادة`);
                if (srcWarns.length)       parts.push(srcWarns.map((w) => w.message).join(' · '));
                detailEl.textContent = parts.join(' · ') || 'مستورد';
            }
        }

        if (actionEl) {
            actionEl.innerHTML = '';
            if (hasWarn && key === 'fet') {
                const btn = document.createElement('button');
                btn.className = 'btn btn-secondary min-h-0 px-2.5 py-1 text-[12px]';
                btn.type = 'button';
                btn.innerHTML = '<i class="fas fa-link"></i> مراجعة';
                btn.addEventListener('click', () =>
                    document.getElementById('tafwij-matching-panel')?.classList.remove('hidden')
                );
                actionEl.appendChild(btn);
            }
        }
    });
}

async function migrateTimetableFromLocalStorage() {
    try {
        const raw = localStorage.getItem('timetableData');
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const schoolYear = getCurrentSchoolYear();
        const existing = await window.api?.timetable?.get?.(schoolYear);
        if (!existing) {
            const result = await window.api?.timetable?.save?.({ school_year: schoolYear, data: parsed });
            if (!result?.success) {
                console.error('[migration] Save failed:', result?.error);
                if (typeof showToast === 'function') showToast('فشل ترحيل بيانات استعمال الزمن: ' + (result?.error || 'خطأ غير معروف'), 'error');
                return;
            }
            console.log('[migration] Timetable data migrated from localStorage to SQLite');
        }
        localStorage.removeItem('timetableData');
        if (typeof showToast === 'function') {
            showToast('تم ترحيل بيانات استعمال الزمن إلى قاعدة البيانات', 'info');
        }
    } catch (e) {
        console.error('[migration] Failed to migrate timetable data:', e);
    }
}

function updateImportSelectionStatus(message) {
    const status = document.getElementById('imports-selection-status');
    if (status) status.textContent = message || '';
}

function initializeImportAccessibility() {
    const sharedDescriptionId = 'imports-picker-help';
    const sharedStatusId = 'imports-selection-status';

    document.querySelectorAll('[data-action]').forEach((button) => {
        const action = button.dataset.action;
        const inputId = FILE_INPUTS[action];
        const input = inputId ? document.getElementById(inputId) : null;
        const label = ACTION_LABELS[action] || action;
        if (!input) return;

        button.setAttribute('aria-controls', inputId);
        button.setAttribute('aria-describedby', `${sharedDescriptionId} ${sharedStatusId}`);
        input.setAttribute('aria-label', `اختيار ملفات ${label}`);
        input.setAttribute('aria-describedby', `${sharedDescriptionId} ${sharedStatusId}`);
    });
}

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
    }).catch((err) => {
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
    birthPlace: ['birthplace', 'placeofbirth', 'lieudenaissance', 'مكانالازدياد', 'مكانالميلاد', 'مسقطالرأس'],
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

const TAFWIJ_TIMETABLE_STORAGE_VERSION = 2;
let pendingTafwijImportState = null;

function makeTafwijTeacherKey(rawName) {
    const cleaned = String(rawName || '').trim();
    return `tafwij:${cleaned}`;
}

// CH10: getBaseClassName via js/shared/fet-import.js

function normalizeStoredTeacherEntry(entry) {
    if (typeof entry === 'string') {
        return {
            key: entry,
            name: entry,
            displayName: entry,
            sourceName: entry,
            sourceDisplayName: entry,
            matchStatus: 'matched',
            teacherId: null,
            teacherName: entry,
            candidateTeacherIds: []
        };
    }
    const key = String(entry?.key || entry?.name || '').trim();
    const sourceName = String(entry?.sourceName || entry?.name || '').trim();
    const displayName = String(entry?.displayName || entry?.teacherName || sourceName || key).trim();
    return {
        key,
        name: key,
        displayName,
        sourceName,
        sourceDisplayName: String(entry?.sourceDisplayName || sourceName || displayName).trim(),
        matchStatus: String(entry?.matchStatus || (entry?.teacherId ? 'matched' : 'unmatched')),
        teacherId: Number(entry?.teacherId) || null,
        teacherName: String(entry?.teacherName || displayName || sourceName).trim(),
        candidateTeacherIds: Array.isArray(entry?.candidateTeacherIds) ? entry.candidateTeacherIds : []
    };
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
        initializeImportAccessibility();

        // Manual import cards — existing execution path (unchanged)
        document.querySelectorAll('.ic-manual-body [data-action], .imports-grid [data-action]').forEach((btn) => {
            // Prefer manual region cards; still support any data-action card
            btn.addEventListener('click', () => runImport(btn.dataset.action));
        });

        Object.entries(FILE_INPUTS).forEach(([action, inputId]) => {
            const input = document.getElementById(inputId);
            if (!input) return;
            input.addEventListener('change', async (event) => {
                const files = Array.from(event.target.files || []);
                if (!files.length) return;
                const label = ACTION_LABELS[action] || action;
                updateImportSelectionStatus(
                    files.length === 1
                        ? `تم اختيار ملف واحد لـ ${label}: ${files[0].name}`
                        : `تم اختيار ${files.length} ملفات لـ ${label}`
                );
                try {
                    const { confirmed } = await showConfirm({
                        title: 'استيراد البيانات',
                        ...buildImportConfirmMessage(action, files),
                        type: 'info',
                        icon: 'fa-cloud-upload-alt',
                        confirmText: 'بدء الاستيراد',
                        cancelText: 'إلغاء'
                    });
                    if (!confirmed) {
                        showToast('تم إلغاء الاستيراد', 'info');
                        return;
                    }
                    await handleImport(action, files);
                } catch (error) {
                    const msg =
                        action === 'orientation'
                            ? orientationUserMessage(error)
                            : error?.message || String(error);
                    const noSave =
                        action === 'orientation' && error?.noRecordsSaved !== false
                            ? (String(msg).includes('لم يُحفظ') ? '' : ' لم يُحفظ أي سجل.')
                            : '';
                    showToast(`فشل الاستيراد: ${msg}${noSave}`, 'error');
                } finally {
                    input.value = '';
                }
            });
        });

        // Keyboard shortcuts (Ctrl+1..4) — manual path
        document.addEventListener('keydown', (e) => {
            if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
            const map = { 1: 'students', 2: 'grades', 3: 'absences', 4: 'fet' };
            const action = map[e.key];
            if (action) {
                e.preventDefault();
                runImport(action);
            }
        });

        // Semester selector change -> refresh stats
        document.getElementById('semester-select')?.addEventListener('change', () => loadDataStats());

        // Import logs pagination (5 per page)
        document.getElementById('import-logs-prev')?.addEventListener('click', () => goToImportLogsPage(-1));
        document.getElementById('import-logs-next')?.addEventListener('click', () => goToImportLogsPage(1));

        // Delete buttons
        document.getElementById('btn-clear-students')?.addEventListener('click', () => clearData('students'));
        document.getElementById('btn-clear-grades')?.addEventListener('click', () => clearData('grades'));
        document.getElementById('btn-clear-absences')?.addEventListener('click', () => clearData('absences'));
        document.getElementById('btn-clear-timetable')?.addEventListener('click', () => clearData('timetable'));
        document.getElementById('btn-clear-teachers')?.addEventListener('click', () => clearData('teachers'));
        document.getElementById('btn-clear-status')?.addEventListener('click', () => clearData('status'));
        document.getElementById('btn-clear-orientation')?.addEventListener('click', () => clearData('orientation'));
        document.getElementById('tafwij-save-mappings-btn')?.addEventListener('click', async () => {
            try {
                const result = await finalizePendingTafwijImport({ saveAliases: true, keepUnresolved: true });
                if (!result) return;
                showToast(
                    result.unresolvedCount
                        ? `تم حفظ ${result.savedAliasCount} مطابقة، وبقي ${result.unresolvedCount} اسم غير محسوم مؤقتاً`
                        : `تم حفظ المطابقات بنجاح (${result.savedAliasCount})`,
                    result.unresolvedCount ? 'info' : 'success'
                );
            } catch (error) {
                showToast(error.message || 'تعذر حفظ مطابقة أسماء tafwij', 'error');
            }
        });
        document.getElementById('tafwij-skip-mappings-btn')?.addEventListener('click', async () => {
            try {
                const result = await finalizePendingTafwijImport({ saveAliases: false, keepUnresolved: true });
                if (!result) return;
                showToast(
                    `تم حفظ الجدول مؤقتاً مع ${result.unresolvedCount} اسم غير مطابق. يمكنك إكمال المطابقة لاحقاً من هذه الصفحة.`,
                    'info'
                );
            } catch (error) {
                showToast(error.message || 'تعذر إتمام الحفظ المؤقت', 'error');
            }
        });
        document.getElementById('tafwij-cancel-mappings-btn')?.addEventListener('click', () => {
            closeTafwijMatchingPanel();
            renderTafwijWarningBanner();
        });
        document.addEventListener('click', async (event) => {
            const target = event.target.closest('#tafwij-open-matching-btn');
            if (!target) return;
            try {
                if (!pendingTafwijImportState) {
                    await restorePendingTafwijStateFromStorage();
                }
                renderTafwijMatchingPanel();
                document
                    .getElementById('tafwij-matching-panel')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (error) {
                console.error('Could not open tafwij matching panel:', error);
                showToast(error?.message || 'تعذر فتح لوحة مطابقة أسماء tafwij', 'error');
            }
        });

        // Backup buttons
        const createBackupBtn = document.getElementById('create-backup-btn');
        const restoreBackupBtn = document.getElementById('restore-backup-btn');
        const backupFileInput = document.getElementById('backup-file-input');

        if (createBackupBtn && typeof BackupManager !== 'undefined') {
            createBackupBtn.addEventListener('click', async () => {
                try {
                    createBackupBtn.disabled = true;
                    setButtonContent(createBackupBtn, { icon: 'fa-spinner', text: 'جاري الإنشاء...', spin: true });
                    const backup = await BackupManager.createBackup();
                    BackupManager.downloadBackup(backup);
                    showToast(
                        'تم إنشاء النسخة الاحتياطية بنجاح (' + BackupManager.formatSize(backup.size) + ')',
                        'success'
                    );
                } catch (err) {
                    showToast(err.message || 'فشل إنشاء النسخة الاحتياطية', 'error');
                } finally {
                    createBackupBtn.disabled = false;
                    setButtonContent(createBackupBtn, { icon: 'fa-download', text: 'إنشاء نسخة احتياطية' });
                }
            });
        }

        if (restoreBackupBtn && backupFileInput && typeof BackupManager !== 'undefined') {
            restoreBackupBtn.addEventListener('click', () => backupFileInput.click());
            backupFileInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const { confirmed } = await showConfirm({
                    title: 'استعادة النسخة الاحتياطية',
                    message: 'سيتم استبدال جميع البيانات الحالية بالنسخة الاحتياطية. هل أنت متأكد؟',
                    type: 'warning',
                    confirmText: 'استعادة'
                });
                if (!confirmed) {
                    backupFileInput.value = '';
                    return;
                }
                try {
                    restoreBackupBtn.disabled = true;
                    setButtonContent(restoreBackupBtn, { icon: 'fa-spinner', text: 'جاري الاستعادة...', spin: true });
                    const result = await BackupManager.restoreFromFile(file);
                    showToast('تم استعادة النسخة الاحتياطية بنجاح (' + result.restoredItems + ' عنصر)', 'success');
                    setTimeout(() => location.reload(), 1500);
                } catch (err) {
                    showToast(err.message || 'فشل استعادة النسخة الاحتياطية', 'error');
                } finally {
                    restoreBackupBtn.disabled = false;
                    setButtonContent(restoreBackupBtn, { icon: 'fa-upload', text: 'استعادة نسخة سابقة' });
                    backupFileInput.value = '';
                }
            });
        }

        await migrateTimetableFromLocalStorage();
        await Promise.all([loadLogs(), loadDataStats()]);
        await renderTafwijWarningBanner();
        await restorePendingTafwijStateFromStorage();
    } catch (error) {
        console.error('settings-imports init failed:', error);
        showToast('حدث خطأ أثناء فتح صفحة الاستيراد. التفاصيل: ' + (error?.message || error), 'error', 7000);
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
    t.textContent = '';
    const icon = document.createElement('i');
    icon.className = 'fas fa-upload';
    t.appendChild(icon);
    t.append(` ${title}`);
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

function buildImportConfirmMessage(action, files) {
    const label = ACTION_LABELS[action] || action;
    const safeFiles = Array.isArray(files) ? files : [];
    const semesterLabel = action === 'grades' ? ' سيتم تحديد الدورة تلقائياً من الملف.' : '';

    if (safeFiles.length === 1) {
        const fileName = safeFiles[0]?.name || 'الملف المحدد';
        return {
            message: `هل تريد استيراد ${label} من الملف:`,
            detail: `${fileName}${semesterLabel}`,
        };
    }

    const preview = safeFiles
        .slice(0, 4)
        .map((file) => file?.name || 'ملف غير معروف')
        .join('، ');
    const more = safeFiles.length > 4 ? ` ... (+${safeFiles.length - 4})` : '';

    return {
        message: `هل تريد استيراد ${label} بشكل جماعي من ${safeFiles.length} ملفات؟`,
        detail: `${preview}${more}${semesterLabel}`,
    };
}

function hideTafwijMatchingPanel() {
    const panel = document.getElementById('tafwij-matching-panel');
    const banner = document.getElementById('tafwij-warning-banner');
    setElementHidden(panel, true);
    if (banner && !pendingTafwijImportState) setElementHidden(banner, true);
}

async function renderTafwijWarningBanner() {
    const banner = document.getElementById('tafwij-warning-banner');
    if (!banner) return;
    try {
        const parsed = await window.api?.timetable?.get?.(getCurrentSchoolYear());
        if (!parsed) {
            setElementHidden(banner, true);
            return;
        }
        const unresolvedCount = Array.isArray(parsed?.unresolvedTeacherKeys) ? parsed.unresolvedTeacherKeys.length : 0;
        if (!unresolvedCount) {
            setElementHidden(banner, true);
            return;
        }
        setElementHidden(banner, false);
        banner.innerHTML = `<i class="fas fa-exclamation-triangle"></i> يوجد ${unresolvedCount} اسم من ملف tafwij لم تتم مطابقته بعد. يمكن متابعة العمل مؤقتاً، لكن بعض الربط مع الحصص أو الغياب قد يبقى غير مكتمل. <button type="button" id="tafwij-open-matching-btn" class="btn btn-secondary ms-2.5 min-h-0 px-3 py-1.5 text-[13px]">مراجعة الآن</button>`;
    } catch {
        setElementHidden(banner, true);
    }
}

async function restorePendingTafwijStateFromStorage() {
    try {
        const parsed = await window.api?.timetable?.get?.(getCurrentSchoolYear());
        if (!parsed) return;
        const unresolvedKeys = Array.isArray(parsed?.unresolvedTeacherKeys) ? parsed.unresolvedTeacherKeys : [];
        if (!unresolvedKeys.length || !parsed?.teacherMetaByKey) return;
        const allTeachers = (await window.api?.teachers?.getAll?.(getCurrentSchoolYear())) || [];
        const teacherResolver = buildTeacherResolver(allTeachers);
        const storedTeachers = Array.isArray(parsed?.teachers)
            ? parsed.teachers.map(normalizeStoredTeacherEntry)
            : Object.values(parsed.teacherMetaByKey || {}).map(normalizeStoredTeacherEntry);
        pendingTafwijImportState = {
            schoolYear: getCurrentSchoolYear(),
            allTeachers,
            fileName: 'tafwij (stored)',
            entries: storedTeachers.map((storedTeacher) => {
                const key = storedTeacher.key;
                const meta = normalizeStoredTeacherEntry(
                    parsed.teacherMetaByKey[key] || storedTeacher || { key, name: key }
                );
                const resolved = teacherResolver.resolve(meta.sourceDisplayName || meta.displayName || meta.sourceName);
                const timetable = parsed.timetables?.[key] || {};
                const subjects = new Set();
                const classes = new Set();
                Object.values(timetable).forEach((dayData) => {
                    ['morning', 'afternoon'].forEach((periodType) => {
                        Object.values(dayData?.[periodType] || {}).forEach((activity) => {
                            if (activity?.subject) subjects.add(activity.subject);
                            const baseClass = getBaseClassName(activity?.students || '');
                            if (baseClass) classes.add(baseClass);
                        });
                    });
                });
                return {
                    key,
                    sourceName: meta.sourceName,
                    sourceDisplayName: meta.sourceDisplayName || meta.displayName,
                    teacherId: Number(meta.teacherId) || null,
                    teacherName: meta.teacherName || meta.displayName,
                    displayName: meta.displayName,
                    matchStatus: meta.matchStatus || (Number(meta.teacherId) ? 'matched' : 'unmatched'),
                    candidates: Array.isArray(resolved.candidates) ? resolved.candidates : [],
                    timetable,
                    subjects: Array.from(subjects),
                    classes: Array.from(classes)
                };
            })
        };
        renderTafwijMatchingPanel();
    } catch (error) {
        console.warn('Could not restore pending tafwij mappings:', error);
    }
}

async function buildTafwijStoragePayload(state, resolutionOverrides = new Map(), keepUnresolved = true) {
    const teacherMetaByKey = {};
    const timetables = {};
    const unresolvedTeacherKeys = [];
    const subjects = new Set();
    const classes = new Set();
    let currentStorage = null;
    try {
        currentStorage = await window.api?.timetable?.get?.(getCurrentSchoolYear()) || null;
    } catch {
        currentStorage = null;
    }
    const allTeachersById = new Map(
        (state?.allTeachers || []).map((teacher) => [Number(teacher.id), teacher]).filter(([id]) => Boolean(id))
    );
    const processedKeys = new Set();

    (state?.entries || []).forEach((entry) => {
        processedKeys.add(entry.key);
        const overrideTeacherId = Number(resolutionOverrides.get(entry.key)) || null;
        const candidateMap = new Map((entry.candidates || []).map((candidate) => [Number(candidate.id), candidate]));
        const selectedCandidate = overrideTeacherId
            ? candidateMap.get(overrideTeacherId) || allTeachersById.get(overrideTeacherId) || null
            : null;
        const isResolved = Boolean(selectedCandidate || entry.teacherId);
        const teacherId = selectedCandidate ? Number(selectedCandidate.id) : Number(entry.teacherId) || null;
        const teacherName = selectedCandidate
            ? String(selectedCandidate.full_name || entry.teacherName || entry.sourceDisplayName).trim()
            : String(entry.teacherName || entry.sourceDisplayName || '').trim();
        const displayName = teacherName || entry.sourceDisplayName || entry.sourceName;
        const matchStatus = selectedCandidate ? 'manual' : isResolved ? entry.matchStatus || 'matched' : 'unmatched';

        teacherMetaByKey[entry.key] = {
            key: entry.key,
            name: entry.key,
            displayName,
            sourceName: entry.sourceName,
            sourceDisplayName: entry.sourceDisplayName,
            teacherId,
            teacherName: teacherName || entry.sourceDisplayName,
            matchStatus,
            candidateTeacherIds: (entry.candidates || []).map((candidate) => Number(candidate.id)).filter(Boolean)
        };

        if (!isResolved && keepUnresolved) {
            unresolvedTeacherKeys.push(entry.key);
        }

        timetables[entry.key] = entry.timetable || {};
        (entry.subjects || []).forEach((subject) => {
            if (subject) subjects.add(subject);
        });
        (entry.classes || []).forEach((className) => {
            if (className) classes.add(className);
        });
    });

    if (currentStorage?.teacherMetaByKey) {
        Object.values(currentStorage.teacherMetaByKey)
            .map(normalizeStoredTeacherEntry)
            .forEach((storedTeacher) => {
                if (!storedTeacher.key || processedKeys.has(storedTeacher.key)) return;
                teacherMetaByKey[storedTeacher.key] = storedTeacher;
                timetables[storedTeacher.key] = currentStorage.timetables?.[storedTeacher.key] || {};
                if (
                    Array.isArray(currentStorage.unresolvedTeacherKeys) &&
                    currentStorage.unresolvedTeacherKeys.includes(storedTeacher.key)
                ) {
                    unresolvedTeacherKeys.push(storedTeacher.key);
                }
                Object.values(timetables[storedTeacher.key] || {}).forEach((dayData) => {
                    ['morning', 'afternoon'].forEach((periodType) => {
                        Object.values(dayData?.[periodType] || {}).forEach((activity) => {
                            if (activity?.subject) subjects.add(activity.subject);
                            const baseClass = getBaseClassName(activity?.students || '');
                            if (baseClass) classes.add(baseClass);
                        });
                    });
                });
            });
    }

    return {
        version: TAFWIJ_TIMETABLE_STORAGE_VERSION,
        teachers: Object.values(teacherMetaByKey).sort((a, b) => a.displayName.localeCompare(b.displayName, 'ar')),
        teacherMetaByKey,
        subjects: Array.from(subjects),
        classes: Array.from(classes),
        timetables,
        unresolvedTeacherKeys
    };
}

function closeTafwijMatchingPanel() {
    const panel = document.getElementById('tafwij-matching-panel');
    setElementHidden(panel, true);
}

function buildTafwijTeacherOptions(entry, allTeachers) {
    const teachers = Array.isArray(allTeachers) ? allTeachers : [];
    const candidateIds = new Set((entry?.candidates || []).map((candidate) => Number(candidate.id)).filter(Boolean));
    const normalizedEntrySubjects = new Set(
        (entry?.subjects || [])
            .map((subject) => normalizeSubjectName(subject))
            .map((subject) => String(subject || '').trim())
            .filter(Boolean)
    );
    const subjectBuckets = new Map();
    const usedIds = new Set();

    const addTeacherToBucket = (bucketLabel, teacher) => {
        const teacherId = Number(teacher?.id);
        if (!teacherId || usedIds.has(teacherId)) return;
        if (!subjectBuckets.has(bucketLabel)) subjectBuckets.set(bucketLabel, []);
        subjectBuckets.get(bucketLabel).push(teacher);
        usedIds.add(teacherId);
    };

    teachers.forEach((teacher) => {
        const normalizedTeacherSubject = normalizeSubjectName(teacher?.subject || '');
        const cleanTeacherSubject = String(normalizedTeacherSubject || '').trim();
        if (candidateIds.has(Number(teacher?.id))) {
            addTeacherToBucket('اقتراحات تلقائية', teacher);
            return;
        }
        if (cleanTeacherSubject && normalizedEntrySubjects.has(cleanTeacherSubject)) {
            addTeacherToBucket(`نفس المادة: ${cleanTeacherSubject}`, teacher);
            return;
        }
        addTeacherToBucket(cleanTeacherSubject || 'بدون مادة محددة', teacher);
    });

    const sortedLabels = Array.from(subjectBuckets.keys()).sort((a, b) => {
        if (a === 'اقتراحات تلقائية') return -1;
        if (b === 'اقتراحات تلقائية') return 1;
        if (a.startsWith('نفس المادة:') && !b.startsWith('نفس المادة:')) return -1;
        if (!a.startsWith('نفس المادة:') && b.startsWith('نفس المادة:')) return 1;
        return typeof compareSubjects === 'function' ? compareSubjects(a, b) : a.localeCompare(b, 'ar');
    });

    const selectedTeacherId =
        entry?.candidates?.length === 1 && Number(entry.candidates[0].id) ? Number(entry.candidates[0].id) : null;

    return [`<option value="">-- اختر الأستاذ المرجعي --</option>`]
        .concat(
            sortedLabels.map((label) => {
                const options = (subjectBuckets.get(label) || [])
                    .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || ''), 'ar'))
                    .map(
                        (teacher) =>
                            `<option value="${teacher.id}" ${selectedTeacherId === Number(teacher.id) ? 'selected' : ''}>${escapeHtml(
                                teacher.full_name
                            )}${teacher.subject ? ` - ${escapeHtml(teacher.subject)}` : ''}</option>`
                    )
                    .join('');
                return `<optgroup label="${escapeHtml(label)}">${options}</optgroup>`;
            })
        )
        .join('');
}

function renderTafwijMatchingPanel() {
    const panel = document.getElementById('tafwij-matching-panel');
    const tbody = document.getElementById('tafwij-matching-tbody');
    const summary = document.getElementById('tafwij-matching-summary');
    if (!panel || !tbody || !summary) return;

    const state = pendingTafwijImportState;
    if (!state?.entries?.length) {
        setElementHidden(panel, true);
        return;
    }

    const unresolvedEntries = state.entries.filter((entry) => !entry.teacherId);
    const ambiguousEntries = unresolvedEntries.filter((entry) => entry.candidates?.length > 1);
    summary.textContent = `تمت مطابقة ${state.entries.length - unresolvedEntries.length} اسم تلقائياً، وبقي ${unresolvedEntries.length} اسم يحتاج مراجعة (${ambiguousEntries.length} محتمل/متعدد).`;

    tbody.innerHTML = unresolvedEntries.length
        ? unresolvedEntries
              .map((entry) => {
                  const options = buildTafwijTeacherOptions(entry, state.allTeachers);
                  const hint = entry.candidates?.length
                      ? entry.candidates.map((candidate) => escapeHtml(candidate.full_name)).join(' | ')
                      : 'لا يوجد اقتراح تلقائي';
                  const subjectsHint = (entry.subjects || []).filter(Boolean).join('، ');
                  return `
                    <tr data-key="${escapeHtml(entry.key)}">
                        <td>
                            <strong>${escapeHtml(entry.sourceDisplayName)}</strong>
                            <div class="text-xs text-[var(--color-text-muted)]">${escapeHtml(entry.sourceName)}</div>
                        </td>
                        <td>${entry.candidates?.length > 1 ? 'متعدد' : 'غير مطابق'}</td>
                        <td>
                            <div class="flex flex-col gap-2">
                                <div class="text-xs text-[var(--color-text-muted)]">${hint}</div>
                                <div class="text-xs text-[var(--color-text-muted)]">${
                                    subjectsHint
                                        ? `مواد الحصص: ${escapeHtml(subjectsHint)}`
                                        : 'المادة غير متاحة في الملف'
                                }</div>
                                <select class="tafwij-match-select" data-key="${escapeHtml(entry.key)}">${options}</select>
                            </div>
                        </td>
                    </tr>
                `;
              })
              .join('')
        : '<tr><td colspan="3" class="loading-cell">كل الأسماء مطابقة بالفعل.</td></tr>';

    setElementHidden(panel, false);
}

async function finalizePendingTafwijImport({ saveAliases = false, keepUnresolved = true } = {}) {
    const state = pendingTafwijImportState;
    if (!state?.entries?.length) return null;
    const selectionMap = new Map();
    document.querySelectorAll('.tafwij-match-select').forEach((select) => {
        const key = String(select.dataset.key || '').trim();
        const teacherId = Number(select.value) || null;
        if (key && teacherId) selectionMap.set(key, teacherId);
    });

    if (saveAliases && selectionMap.size) {
        const aliases = [];
        state.entries.forEach((entry) => {
            const teacherId = selectionMap.get(entry.key);
            if (!teacherId) return;
            aliases.push({ teacher_id: teacherId, alias_name: entry.sourceDisplayName });
        });
        if (aliases.length) {
            const response = await window.api.teachers.saveTafwijAliases({ school_year: state.schoolYear, aliases });
            if (!response || response.success === false) {
                throw new Error(response?.error || 'تعذر حفظ مطابقة أسماء tafwij');
            }
        }
    }

    const dataToSave = await buildTafwijStoragePayload(state, selectionMap, keepUnresolved);
    const saveResult = await window.api?.timetable?.save?.({ school_year: getCurrentSchoolYear(), data: dataToSave });
    if (!saveResult?.success) {
        throw new Error(saveResult?.error || 'فشل حفظ بيانات استعمال الزمن في قاعدة البيانات');
    }
    const unresolvedCount = dataToSave.unresolvedTeacherKeys.length;
    pendingTafwijImportState = null;
    hideTafwijMatchingPanel();
    renderTafwijWarningBanner();
    await loadDataStats();
    return {
        teachersCount: dataToSave.teachers.length,
        unresolvedCount,
        savedAliasCount: saveAliases ? selectionMap.size : 0
    };
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

    const invalidExact = new Set(
        [
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
        ].map(normalizeKey)
    );
    if (invalidExact.has(normalized)) return '';

    const invalidContains = ['observation', 'comment', 'remarque', 'notes', 'note'].map(normalizeKey);
    if (invalidContains.some((x) => normalized.includes(x))) return '';

    return raw;
}

function normalizeTeacherMatchKey(value) {
    const normalized = normalizeKey(
        String(value || '')
            .replace(/_/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
    );
    if (!normalized) return '';
    return normalized
        .replace(/(^|\s)ال/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildTeacherResolver(teachers) {
    const normalizedMap = new Map();
    (Array.isArray(teachers) ? teachers : []).forEach((teacher) => {
        const variants = [teacher.full_name, teacher.full_name_fr]
            .map((value) => String(value || '').trim())
            .filter(Boolean);
        variants.forEach((variant) => {
            const key = normalizeTeacherMatchKey(variant);
            if (!key) return;
            if (!normalizedMap.has(key)) normalizedMap.set(key, []);
            normalizedMap.get(key).push(teacher);
        });
    });
    return {
        resolve(rawName) {
            const cleaned = sanitizeTeacherName(rawName);
            if (!cleaned) return { teacher_id: null, teacher_name: '', candidates: [] };
            const key = normalizeTeacherMatchKey(cleaned);
            const matches = normalizedMap.get(key) || [];
            if (matches.length === 1) {
                return {
                    teacher_id: matches[0].id || null,
                    teacher_name: matches[0].full_name || cleaned,
                    matched: true,
                    candidates: matches
                };
            }
            return {
                teacher_id: null,
                teacher_name: cleaned,
                matched: false,
                ambiguous: matches.length > 1,
                candidates: matches
            };
        }
    };
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
    return typeof getSchoolYear === 'function' ? getSchoolYear() : '2025/2026';
}

function getSelectedSemester() {
    return parseInt(document.getElementById('semester-select')?.value, 10) || 1;
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

// ─── Level Normalization ────────────────────────────────────────────────────
// LEVEL_CODE_TO_AR and _LEVEL_KEYS_DESC are provided globally by js/utils.js

const LEVEL_AR_PATTERNS = [
    [/جذع.*مشترك.*آداب|الآداب.*و.*العلوم.*الإنسانية/i, 'الجذع المشترك للآداب والعلوم الإنسانية'],
    [/جذع.*مشترك.*علمي.*فرنسية/i, 'الجذع المشترك العلمي خيار فرنسية'],
    [/جذع.*مشترك.*علمي.*عربية/i, 'الجذع المشترك العلمي خيار عربية'],
    [/جذع.*مشترك.*علمي/i, 'الجذع المشترك العلمي'],
    [/جذع.*مشترك.*تكنولوجي/i, 'الجذع المشترك التكنولوجي'],
    [/جذع.*مشترك/i, 'الجذع المشترك'],
    [/أولى.*رياضي.*فرنسية/i, 'الأولى باكالوريا علوم رياضية خيار فرنسية'],
    [/أولى.*رياضي.*عربية/i, 'الأولى باكالوريا علوم رياضية خيار عربية'],
    [/أولى.*رياضي/i, 'الأولى باكالوريا علوم رياضية'],
    [/أولى.*تجريب.*فرنسية/i, 'الأولى باكالوريا علوم تجريبية خيار فرنسية'],
    [/أولى.*تجريب.*عربية/i, 'الأولى باكالوريا علوم تجريبية خيار عربية'],
    [/أولى.*تجريب/i, 'الأولى باكالوريا علوم تجريبية'],
    [/أولى.*آداب|أولى.*إنسان|أولى.*انسان/i, 'الأولى باكالوريا آداب وعلوم إنسانية'],
    [/أولى.*اقتصاد|أولى.*تدبير/i, 'الأولى باكالوريا علوم الاقتصاد والتدبير'],
    [/أولى.*باك/i, 'الأولى باكالوريا'],
    [/ثانية.*رياضي.*[اأ]\b/i, 'الثانية باكالوريا علوم رياضية أ'],
    [/ثانية.*رياضي.*ب\b/i, 'الثانية باكالوريا علوم رياضية ب'],
    [/ثانية.*رياضي/i, 'الثانية باكالوريا علوم رياضية'],
    [/ثانية.*حياة|ثانية.*الحياة|ثانية.*أرض/i, 'الثانية باكالوريا علوم الحياة والأرض'],
    [/ثانية.*فيزيائ/i, 'الثانية باكالوريا علوم فيزيائية'],
    [/ثانية.*إنسان|ثانية.*انسان/i, 'الثانية باكالوريا آداب وعلوم إنسانية'],
    [/ثانية.*آداب/i, 'الثانية باكالوريا آداب'],
    [/ثانية.*اقتصاد/i, 'الثانية باكالوريا علوم الاقتصاد والتدبير'],
    [/ثانية.*تدبير|ثانية.*محاسب/i, 'الثانية باكالوريا علوم التدبير المحاسباتي'],
    [/ثانية.*شرع/i, 'الثانية باكالوريا علوم شرعية'],
    [/ثانية.*أصيل|ثانية.*اصيل/i, 'الثانية باكالوريا تعليم أصيل'],
    [/ثانية.*باك/i, 'الثانية باكالوريا']
];

function normalizeLevelName(rawLevel) {
    const text = String(rawLevel || '').trim();
    if (!text) return '';
    // 1. Section code match: "TCSF-1" → strip digits → "TCSF" → Arabic
    const upper = text
        .toUpperCase()
        .replace(/[-_\s]?\d+$/, '')
        .trim();
    for (const code of _LEVEL_KEYS_DESC) {
        if (upper === code || upper.startsWith(code)) return LEVEL_CODE_TO_AR[code].name;
    }
    // 2. Arabic pattern matching (handles partial/variant Arabic names)
    for (const [re, name] of LEVEL_AR_PATTERNS) {
        if (re.test(text)) return name;
    }
    // 3. Generic fallback
    if (/^TC/i.test(upper) || /جذع/i.test(text)) return 'الجذع المشترك';
    if (/^1BAC/i.test(upper) || /أولى/i.test(text)) return 'الأولى باكالوريا';
    if (/^2BAC/i.test(upper) || /ثانية/i.test(text)) return 'الثانية باكالوريا';
    return text;
}

function deriveLevelFromSection(sectionValue) {
    const section = String(sectionValue || '').trim();
    if (!section) return '';
    return normalizeLevelName(section);
}

// ─── Subject Normalization (French → Arabic) ─────────────────────────────────
// normalizeSubjectName is provided globally by js/utils.js (delegates to translateSubject from ma-education-labels.js)

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
        birthPlace: findHeaderIndex(headers, HEADER_ALIASES.birthPlace),
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
    updateImportSelectionStatus(`جارٍ فتح نافذة اختيار الملفات لـ ${ACTION_LABELS[action] || action}`);
    input.click();
}

/**
 * Scans the first 30 rows of all sheets in a workbook for a school-year pattern
 * like "2024/2025" or "2024-2025". Returns the first match found, or null.
 */
function detectSchoolYearFromWorkbook(workbook) {
    if (!workbook) return null;
    const YEAR_RE = /\b(20\d{2})[\/\-](20\d{2})\b/;
    for (const sheetName of workbook.SheetNames) {
        const rows = getSheetRows(workbook, sheetName);
        const limit = Math.min(rows.length, 30);
        for (let i = 0; i < limit; i++) {
            for (const cell of rows[i] || []) {
                const val = String(cell ?? '').trim();
                const m = val.match(YEAR_RE);
                if (m) {
                    const y1 = parseInt(m[1], 10);
                    const y2 = parseInt(m[2], 10);
                    if (y2 === y1 + 1) return `${y1}/${y2}`;
                }
            }
        }
    }
    return null;
}

/**
 * Checks if the detected year inside the file matches the selected year.
 * If different, shows a styled confirmation overlay.
 * Resolves true = proceed anyway, false = cancel.
 */
function checkYearMismatch(detectedYear, selectedYear) {
    if (!detectedYear || detectedYear === selectedYear) return Promise.resolve(true);

    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className =
            'fixed inset-0 z-[10000] flex items-center justify-center bg-[var(--color-overlay)] p-4 text-right';

        overlay.innerHTML = `
        <div class="w-full max-w-[420px] rounded-xl border border-[var(--color-warning-border)] bg-[var(--color-surface)] px-8 py-7 text-[var(--color-text-main)] shadow-[var(--shadow-elevated)]">
            <div class="mb-4 flex items-center gap-3">
                <i class="fas fa-exclamation-triangle text-[28px] text-[var(--color-warning-text)]"></i>
                <h3 class="m-0 text-lg text-[var(--color-warning-text)]">تحذير: تعارض في الموسم الدراسي</h3>
            </div>
            <p class="mb-2 mt-0 leading-[1.7] text-[var(--color-text-muted)]">
                الملف المستورَد يبدو أنه يخص الموسم الدراسي:
                <strong class="text-base text-[var(--color-warning-text)]"> ${detectedYear} </strong>
            </p>
            <p class="mb-5 mt-0 leading-[1.7] text-[var(--color-text-muted)]">
                بينما الموسم المختار حالياً هو:
                <strong class="text-base text-[var(--color-success-text)]"> ${selectedYear} </strong>
            </p>
            <p class="mb-6 mt-0 text-[13px] text-[var(--color-text-light)]">
                إذا واصلت، ستُخَّزن البيانات تحت الموسم <strong class="text-[var(--color-success-text)]">${selectedYear}</strong>.
                إذا أردت حفظها تحت <strong class="text-[var(--color-warning-text)]">${detectedYear}</strong>، ألغِ وغيّر الموسم أولاً.
            </p>
            <div class="flex justify-end gap-3">
                <button id="ym-cancel" class="rounded-lg border border-[var(--glass-border)] bg-transparent px-5 py-2.5 text-sm text-[var(--color-text-muted)] transition-all duration-200 hover:border-[var(--color-accent)] hover:text-[var(--color-text-main)]">
                    إلغاء — سأغير الموسم
                </button>
                <button id="ym-proceed" class="rounded-lg border border-[var(--color-warning-border)] bg-[var(--color-warning-solid)] px-5 py-2.5 text-sm font-bold text-white transition-all duration-200 hover:opacity-95">
                    واصل على أي حال
                </button>
            </div>
        </div>`;

        document.body.appendChild(overlay);

        overlay.querySelector('#ym-proceed').onclick = () => {
            document.body.removeChild(overlay);
            resolve(true);
        };
        overlay.querySelector('#ym-cancel').onclick = () => {
            document.body.removeChild(overlay);
            resolve(false);
        };
    });
}

async function loadDataStats() {
    const setValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value);
    };
    // Prefer the toolbar select value (most up-to-date user choice), fall back to localStorage
    const toolbarSelect = document.getElementById('school-year');
    const schoolYear = toolbarSelect && toolbarSelect.value ? toolbarSelect.value : getCurrentSchoolYear();

    // Show which year is being queried
    const yearLabel = document.getElementById('stats-year-label');
    if (yearLabel) yearLabel.textContent = `(${schoolYear})`;

    try {
        const students = (await window.api?.students?.getAll?.(schoolYear)) || [];
        setValue('stat-students-count', students.length.toLocaleString('ar-MA'));
    } catch {
        setValue('stat-students-count', '-');
    }

    try {
        const grades = (await window.api?.grades?.getAll?.(schoolYear)) || [];
        const semester = getSelectedSemester();
        const semesterGrades = grades.filter((g) => parseInt(g.semester, 10) === semester);
        const semLabel = semester === 1 ? 'د1' : 'د2';
        setValue('stat-grades-count', `${semesterGrades.length.toLocaleString('ar-MA')} (${semLabel})`);
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
        const timetable = await window.api?.timetable?.get?.(schoolYear);
        const teachersCount = Array.isArray(timetable?.teachers) ? timetable.teachers.length : 0;
        const unresolvedCount = Array.isArray(timetable?.unresolvedTeacherKeys)
            ? timetable.unresolvedTeacherKeys.length
            : 0;
        setValue(
            'stat-timetable-status',
            teachersCount > 0
                ? unresolvedCount > 0
                    ? `${teachersCount} أستاذ (${unresolvedCount} غير محسوم)`
                    : `${teachersCount} أستاذ`
                : 'غير محمّل'
        );
    } catch {
        setValue('stat-timetable-status', 'غير محمّل');
    }

    try {
        const teachers = (await window.api?.teachers?.getAll?.(schoolYear)) || [];
        setValue('stat-teachers-count', teachers.length > 0 ? teachers.length.toLocaleString('ar-MA') : '0');
    } catch {
        setValue('stat-teachers-count', '-');
    }

    try {
        const statusRes = await window.api?.students?.getByStatus?.({ school_year: schoolYear });
        const summary = statusRes?.summary;
        if (summary && summary.total > 0) {
            setValue('stat-status-count', summary.total.toLocaleString('ar-MA'));
        } else {
            setValue('stat-status-count', '0');
        }
    } catch {
        setValue('stat-status-count', '-');
    }

    try {
        const orientRes = await window.api?.orientation?.stats?.(schoolYear);
        const total = Number(orientRes?.summary?.total) || 0;
        setValue('stat-orientation-count', total > 0 ? total.toLocaleString('ar-MA') : '0');
    } catch {
        setValue('stat-orientation-count', '-');
    }
    renderImportStatusPanel(getCurrentSchoolYear());
}

async function clearData(type) {
    const schoolYear = getCurrentSchoolYear();
    const semester = getSelectedSemester();
    const semesterName = semester === 1 ? 'الدورة الأولى' : 'الدورة الثانية';
    const labels = {
        students: 'بيانات التلاميذ',
        grades: `نقط ${semesterName}`,
        absences: 'سجلات الغياب',
        timetable: 'بيانات الجدول الزمني',
        teachers: 'بيانات الأساتذة',
        status: 'الوضعيات الدراسية',
        orientation: 'سجلات التوجيه المدرسي'
    };
    const label = labels[type] || type;
    const message =
        type === 'timetable'
            ? `هل تريد حذف ${label}؟`
            : type === 'status'
              ? `هل تريد إعادة جميع الوضعيات إلى "نشط" للموسم ${schoolYear}؟`
              : `هل تريد حذف ${label} الخاصة بالموسم ${schoolYear}؟`;

    const isHard = ['students', 'grades', 'absences', 'teachers', 'orientation'].includes(type);
    const dialogType = isHard ? 'danger' : 'warning';
    const { confirmed } = await showConfirm({
        title: `حذف ${label}`,
        message,
        detail: 'لا يمكن التراجع عن هذا الإجراء.',
        type: dialogType,
        confirmText: isHard ? 'حذف نهائي' : 'تأكيد'
    });
    if (!confirmed) return;

    try {
        if (type === 'students') {
            if (!window.api?.students?.deleteByYear) throw new Error('ميزة حذف التلاميذ غير متاحة في هذا الإصدار');
            const res = await window.api.students.deleteByYear(schoolYear);
            if (!res || res.success === false) throw new Error(res?.error || 'تعذر حذف بيانات التلاميذ');
            DataSourceRegistry.clear('students', schoolYear);
        } else if (type === 'grades') {
            if (!window.api?.grades?.deleteBySemester) {
                throw new Error('ميزة حذف النقط حسب الدورة غير متاحة في هذا الإصدار');
            }
            const res = await window.api.grades.deleteBySemester(schoolYear, semester);
            if (!res || res.success === false) throw new Error(res?.error || 'تعذر حذف النقط');
            DataSourceRegistry.clear('grades', schoolYear);
        } else if (type === 'absences') {
            const res = await window.api.absences.deleteByYear(schoolYear);
            if (!res || res.success === false) throw new Error(res?.error || 'تعذر حذف الغياب');
            DataSourceRegistry.clear('absences', schoolYear);
        } else if (type === 'timetable') {
            await window.api?.timetable?.delete?.(schoolYear);
            pendingTafwijImportState = null;
            hideTafwijMatchingPanel();
            await renderTafwijWarningBanner();
            DataSourceRegistry.clear('fet', schoolYear);
        } else if (type === 'teachers') {
            if (!window.api?.teachers?.deleteByYear) throw new Error('ميزة حذف الأساتذة غير متاحة في هذا الإصدار');
            const res = await window.api.teachers.deleteByYear(schoolYear);
            if (!res || res.success === false) throw new Error(res?.error || 'تعذر حذف بيانات الأساتذة');
            DataSourceRegistry.clear('agent_xml', schoolYear);
        } else if (type === 'status') {
            if (!window.api?.students?.updateStatusBulk) throw new Error('ميزة مسح الوضعيات غير متاحة في هذا الإصدار');
            const statusRes = await window.api.students.getByStatus({ school_year: schoolYear });
            const rows = statusRes?.rows || [];
            if (rows.length) {
                const items = rows.map((r) => ({ id: r.id, status: 'active' }));
                const res = await window.api.students.updateStatusBulk(items);
                if (!res || res.success === false) throw new Error(res?.error || 'تعذر مسح الوضعيات');
            }
            DataSourceRegistry.clear('status', schoolYear);
        } else if (type === 'orientation') {
            if (!window.api?.orientation?.clearYear) throw new Error('ميزة حذف التوجيه غير متاحة في هذا الإصدار');
            const res = await window.api.orientation.clearYear(schoolYear);
            if (!res || res.success === false) throw new Error(res?.error || 'تعذر حذف سجلات التوجيه');
            DataSourceRegistry.clear('orientation', schoolYear);
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
        let detectedSemester = null;
        let fetImportResult = null;
        const failedReasons = [];
        const stagedAbsences = [];
        let pendingDeparted = [];
        const orientationTotals = {
            inserted: 0,
            updated: 0,
            unchanged: 0,
            skipped: 0,
            duplicatesInFile: 0,
            schoolYear: year,
            skipReasons: []
        };
        const orientationSkipBucket = {};

        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            const start = (i / fileList.length) * 80;
            const end = ((i + 1) / fileList.length) * 80;
            try {
                updateImportProgress(start + 8, `(${i + 1}/${fileList.length}) جاري قراءة ${file.name}...`);

                if (action === 'fet') {
                    fetImportResult = await importFetXml(file);
                    totalImported += Number(fetImportResult?.teachersCount) || Number(fetImportResult) || 0;
                } else if (action === 'agent-xml') {
                    totalImported += await importAgentXml(file);
                } else if (action === 'orientation') {
                    // Excel/CSV/JSON — hard year match, structured errors, no clearYear
                    let orientRes;
                    if (isOrientationJsonFile(file)) {
                        updateImportProgress(start + 20, `(${i + 1}/${fileList.length}) جاري قراءة JSON...`);
                        let extracted;
                        try {
                            extracted = await parseOrientationJsonFile(file, year);
                        } catch (parseErr) {
                            throw isOrientationError(parseErr)
                                ? parseErr
                                : createOrientationError('FILE_READ_ERROR', {
                                      message: orientationUserMessage(parseErr),
                                      noRecordsSaved: true
                                  });
                        }
                        // Hard stop — never substitute school year silently
                        assertOrientationSchoolYearMatch(extracted.detectedYear, year);
                        updateImportProgress(start + 28, `(${i + 1}/${fileList.length}) جاري حفظ التوجيه...`);
                        orientRes = await importOrientation(file, year, null, extracted);
                    } else {
                        let workbook;
                        try {
                            workbook = await parseWorkbook(file);
                        } catch (readErr) {
                            throw createOrientationError('FILE_READ_ERROR', {
                                message: 'تعذر قراءة ملف Excel/CSV للتوجيه. لم يُحفظ أي سجل.',
                                noRecordsSaved: true
                            });
                        }
                        updateImportProgress(start + 20, `(${i + 1}/${fileList.length}) تمت القراءة، جاري التحقق...`);
                        const fileYear = detectSchoolYearFromWorkbook(workbook);
                        assertOrientationSchoolYearMatch(fileYear, year);
                        updateImportProgress(start + 28, `(${i + 1}/${fileList.length}) جاري حفظ التوجيه...`);
                        orientRes = await importOrientation(file, year, workbook);
                    }
                    totalImported += Number(orientRes?.imported) || 0;
                    orientationTotals.inserted += Number(orientRes?.inserted) || 0;
                    orientationTotals.updated += Number(orientRes?.updated) || 0;
                    orientationTotals.unchanged += Number(orientRes?.unchanged) || 0;
                    orientationTotals.skipped += Number(orientRes?.skipped) || 0;
                    orientationTotals.duplicatesInFile += Number(orientRes?.duplicatesInFile) || 0;
                    orientationTotals.schoolYear = orientRes?.schoolYear || year;
                    for (const r of orientRes?.skipReasons || []) {
                        pushSkipReason(orientationSkipBucket, r);
                    }
                } else {
                    const workbook = await parseWorkbook(file);
                    updateImportProgress(start + 20, `(${i + 1}/${fileList.length}) تمت القراءة، جاري التحقق...`);

                    // ── Year mismatch detection ──────────────────────────
                    const fileYear = detectSchoolYearFromWorkbook(workbook);
                    const proceed = await checkYearMismatch(fileYear, year);
                    if (!proceed) {
                        // User chose to cancel this file
                        failedFiles++;
                        failedReasons.push(`الملف ${i + 1}: ${file.name} — ألغاه المستخدم بسبب تعارض الموسم الدراسي`);
                        updateImportProgress(end, `(${i + 1}/${fileList.length}) تم إلغاء ${file.name}`);
                        continue;
                    }

                    updateImportProgress(start + 28, `(${i + 1}/${fileList.length}) تمت القراءة، جاري الحفظ...`);

                    if (action === 'students') {
                        const studentsResult = await importStudents(workbook, year);
                        totalImported += studentsResult.importedCount;
                        if (studentsResult.departedStudents?.length) {
                            pendingDeparted = studentsResult.departedStudents;
                        }
                    } else if (action === 'grades') {
                        const gradeResult = await importGrades(workbook, year, file.name);
                        totalGradesImported += gradeResult.gradesCount;
                        gradeResult.studentCodes.forEach((code) => importedStudentsCodes.add(code));
                        totalImported = totalGradesImported;
                        if (gradeResult.semester) detectedSemester = gradeResult.semester;
                    } else if (action === 'absences') {
                        const parsedAbsences = await importAbsences(workbook, year, { persist: false });
                        stagedAbsences.push(...parsedAbsences);
                        totalImported = stagedAbsences.length;
                    } else if (action === 'student-status') {
                        totalImported += await importStudentStatus(workbook, year);
                    }
                }

                succeededFiles++;
                updateImportProgress(end, `(${i + 1}/${fileList.length}) تم إنهاء ${file.name}`);
            } catch (fileError) {
                failedFiles++;
                const reason =
                    action === 'orientation'
                        ? orientationUserMessage(fileError)
                        : fileError?.message || String(fileError);
                const codeSuffix =
                    action === 'orientation' && fileError?.code ? ` [${fileError.code}]` : '';
                const noSaveNote =
                    action === 'orientation' && fileError?.noRecordsSaved !== false
                        ? ' — لم يُحفظ أي سجل من هذا الملف'
                        : '';
                failedReasons.push(`الملف ${i + 1}: ${file.name} - ${reason}${codeSuffix}${noSaveNote}`);
                updateImportProgress(end, `(${i + 1}/${fileList.length}) تعذر استيراد ${file.name}: ${reason}`);
                if (fileList.length === 1) {
                    if (action === 'orientation' && !isOrientationError(fileError)) {
                        throw createOrientationError(
                            fileError?.code && orientationCodeKnown(fileError.code)
                                ? fileError.code
                                : 'DATABASE_ERROR',
                            {
                                message: reason,
                                details: fileError?.details || null,
                                noRecordsSaved: true
                            }
                        );
                    }
                    throw fileError;
                }
            }
        }

        if (!succeededFiles) {
            if (action === 'orientation') {
                throw createOrientationError(
                    failedReasons.some((r) => r.includes('SCHOOL_YEAR_MISMATCH'))
                        ? 'SCHOOL_YEAR_MISMATCH'
                        : 'EMPTY_FILE',
                    {
                        message: failedReasons[0] || 'تعذر استيراد جميع ملفات التوجيه. لم يُحفظ أي سجل.',
                        details: { failedReasons },
                        noRecordsSaved: true
                    }
                );
            }
            throw new Error(failedReasons[0] || 'تعذر استيراد جميع الملفات');
        }

        if (action === 'absences') {
            if (failedFiles > 0) {
                throw new Error(failedReasons[0] || 'تعذر التحقق من جميع ملفات الغياب قبل الحفظ');
            }

            updateImportProgress(88, 'جارٍ تطبيق سجلات الغياب...');
            // Package 5.2: prefer atomic replaceByYear (delete+save one transaction).
            // Fall back to legacy two-step only if API missing (old builds).
            if (typeof window.api?.absences?.replaceByYear === 'function') {
                const replaceRes = await window.api.absences.replaceByYear(year, stagedAbsences);
                if (!replaceRes || replaceRes.success === false) {
                    throw new Error(replaceRes?.error || 'فشل استبدال سجلات الغياب');
                }
            } else {
                const cleanRes = await window.api.absences.deleteByYear(year);
                if (!cleanRes || cleanRes.success === false) {
                    throw new Error(cleanRes?.error || 'تعذر تهيئة استيراد الغياب');
                }
                const saveRes = await window.api.absences.saveBulk(stagedAbsences);
                if (!saveRes || saveRes.success === false) {
                    throw new Error(saveRes?.error || 'فشل حفظ سجلات الغياب');
                }
            }

            totalImported = stagedAbsences.length;
        }

        const unit =
            action === 'students'
                ? 'تلميذ'
                : action === 'grades'
                  ? 'نقطة'
                  : action === 'fet'
                    ? 'أستاذ'
                    : action === 'agent-xml'
                      ? 'أستاذ'
                      : action === 'student-status'
                        ? 'تلميذ'
                        : action === 'orientation'
                          ? 'سجل توجيه'
                          : 'سجل غياب';
        const fileWord = fileList.length === 1 ? 'ملف' : 'ملفات';
        const semesterName =
            action === 'grades' && detectedSemester
                ? detectedSemester === 2
                    ? 'الدورة الثانية'
                    : 'الدورة الأولى'
                : '';
        const gradesStudentsSummary =
            action === 'grades' ? ` (${importedStudentsCodes.size} تلميذ — ${semesterName})` : '';
        const batchStatus = fileList.length > 1 ? ` (نجاح: ${succeededFiles} | فشل: ${failedFiles})` : '';
        const fetSummary =
            action === 'fet' && fetImportResult
                ? fetImportResult.unresolvedCount
                    ? ` (${fetImportResult.unresolvedCount} اسم غير محسوم مؤقتاً)`
                    : ''
                : '';
        if (action === 'orientation') {
            orientationTotals.skipReasons = skipReasonsToList(orientationSkipBucket);
        }
        const orientationSummary =
            action === 'orientation' ? ` (${formatOrientationImportSummary(orientationTotals)})` : '';
        const logDetails = `استيراد ${totalImported} ${unit}${gradesStudentsSummary}${fetSummary}${orientationSummary} من ${fileList.length} ${fileWord}${batchStatus}`;
        await safeLogImport(action, logDetails);
        if (failedReasons.length > 0) {
            window.lastFailedImports = failedReasons.slice();
            console.warn('[import] failed files:', failedReasons);
        }

        updateImportProgress(90, 'جاري تحديث سجل العمليات...');
        await loadLogs();
        await loadDataStats();
        updateImportProgress(
            100,
            action === 'grades'
                ? `اكتمل الاستيراد: ${totalImported} ${unit} (${importedStudentsCodes.size} تلميذ — ${semesterName})`
                : action === 'fet' && fetImportResult?.unresolvedCount
                  ? `اكتمل الاستيراد: ${totalImported} ${unit} مع ${fetImportResult.unresolvedCount} اسم غير محسوم مؤقتاً`
                  : action === 'orientation'
                    ? `اكتمل الاستيراد: ${formatOrientationImportSummary(orientationTotals)}`
                    : `اكتمل الاستيراد: ${totalImported} ${unit}`
        );
        hideImportProgress(900);
        const finalMessage =
            action === 'grades'
                ? `تم استيراد ${totalImported} ${unit} تخص ${importedStudentsCodes.size} تلميذ (${semesterName}) من ${fileList.length} ${fileWord}`
                : action === 'orientation'
                  ? `التوجيه — ${formatOrientationImportSummary(orientationTotals)}`
                  : `تم استيراد ${totalImported} ${unit} من ${fileList.length} ${fileWord}`;
        if (failedFiles > 0) {
            showToast(`${finalMessage} مع تعذر ${failedFiles} ملف`, 'warning');
        } else {
            showToast(finalMessage, 'success');
        }

        // Show departed students panel if any were detected during student import
        if (action === 'students' && pendingDeparted.length > 0) {
            showDepartedPanel(pendingDeparted);
        }
        renderImportStatusPanel(getCurrentSchoolYear());
    } catch (error) {
        const fileWord = fileList.length === 1 ? 'ملف' : 'ملفات';
        const userMsg =
            action === 'orientation' ? orientationUserMessage(error) : error?.message || String(error);
        const noSave =
            action === 'orientation' && (error?.noRecordsSaved !== false || !error?.code)
                ? ' لم يُحفظ أي سجل.'
                : '';
        await safeLogImport(
            action,
            `فشل الاستيراد (${fileList.length} ${fileWord}): ${userMsg}${error?.code ? ` [${error.code}]` : ''}`
        );
        updateImportProgress(100, `تعذر الاستيراد: ${userMsg}${noSave}`);
        hideImportProgress(1400);
        if (action === 'orientation') {
            const safeErr = isOrientationError(error)
                ? error
                : createOrientationError('DATABASE_ERROR', {
                      message: userMsg + (userMsg.includes('لم يُحفظ') ? '' : noSave),
                      noRecordsSaved: true
                  });
            throw safeErr;
        }
        throw error;
    } finally {
        // Always restore loading/disabled state after success or failure
        setImportButtonsDisabled(false);
    }
}

function isImportSummaryLog(details) {
    const text = String(details || '').trim();
    if (!text) return false;
    return /^استيراد\s+/i.test(text) || /^فشل الاستيراد\s*\(/i.test(text);
}

// ── Departed students panel ──────────────────────────────────

function showDepartedPanel(students) {
    const panel = document.getElementById('departed-students-panel');
    const tbody = document.getElementById('departed-tbody');
    const summary = document.getElementById('departed-summary');
    const selectAll = document.getElementById('departed-select-all');
    const bulkSelect = document.getElementById('departed-bulk-status');
    const applyBulkBtn = document.getElementById('departed-apply-bulk');
    const skipBtn = document.getElementById('departed-skip-btn');
    const confirmBtn = document.getElementById('departed-confirm-btn');

    if (!panel || !tbody) return;

    summary.textContent = `${students.length} تلميذ(ة) موجود(ة) في قاعدة البيانات لكن غير موجود(ة) في الملف المستورد`;

    tbody.innerHTML = students
        .map(
            (s, i) => `<tr>
            <td><input type="checkbox" class="departed-cb" data-id="${s.id}" checked></td>
            <td>${i + 1}</td>
            <td>${escapeHtml(s.code || '-')}</td>
            <td>${escapeHtml(s.full_name || '-')}</td>
            <td>${escapeHtml(s.section || '-')}</td>
            <td>
                <select class="departed-action-select" data-id="${s.id}">
                    <option value="">تجاهل (إبقاء نشط)</option>
                    <option value="dropout">منقطع</option>
                    <option value="expelled">مفصول</option>
                    <option value="not_enrolled">غير ملتحق</option>
                </select>
            </td>
        </tr>`
        )
        .join('');

    // Select-all checkbox
    selectAll.checked = true;
    selectAll.onchange = () => {
        document.querySelectorAll('.departed-cb').forEach((cb) => {
            cb.checked = selectAll.checked;
        });
    };

    // Apply bulk action to checked rows
    applyBulkBtn.onclick = () => {
        const bulkValue = bulkSelect.value;
        if (!bulkValue) {
            showToast('اختر إجراءً جماعياً أولاً', 'error');
            return;
        }
        document.querySelectorAll('.departed-cb:checked').forEach((cb) => {
            const id = cb.dataset.id;
            const sel = document.querySelector(`.departed-action-select[data-id="${id}"]`);
            if (sel) sel.value = bulkValue;
        });
    };

    // Skip button — hide panel
    skipBtn.onclick = () => {
        panel.classList.add('hidden');
    };

    // Confirm button — save status changes
    confirmBtn.onclick = async () => {
        const items = [];
        document.querySelectorAll('.departed-action-select').forEach((sel) => {
            const status = sel.value;
            if (status) {
                items.push({ student_id: Number(sel.dataset.id), status });
            }
        });

        if (!items.length) {
            panel.classList.add('hidden');
            showToast('لم يتم تغيير أي وضعية', 'info');
            return;
        }

        try {
            confirmBtn.disabled = true;
            setButtonContent(confirmBtn, { icon: 'fa-spinner', text: 'جاري الحفظ...', spin: true });

            const res = await window.api.students.updateStatusBulk(items);
            if (res && res.success) {
                showToast(`تم تحديث وضعية ${res.count} تلميذ(ة)`, 'success');
            } else {
                showToast(res?.error || 'فشل تحديث الوضعيات', 'error');
            }
        } catch (err) {
            console.error('Departed status update failed:', err);
            showToast('خطأ في تحديث الوضعيات', 'error');
        } finally {
            confirmBtn.disabled = false;
            setButtonContent(confirmBtn, { icon: 'fa-save', text: 'حفظ التغييرات' });
            panel.classList.add('hidden');
            loadDataStats();
        }
    };

    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── Student import ──────────────────────────────────────────

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
                birth_place: h.birthPlace !== -1 ? String(row[h.birthPlace] ?? '').trim() : '',
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

    // ── Reconciliation: compare with existing students ──
    const existingStudents = (await window.api.students.getCodesByYear(schoolYear)) || [];
    const existingCodes = new Set(existingStudents.map((s) => String(s.code || '').trim()));
    const importedCodes = new Set(deduped.map((s) => s.code));

    // Mark new students as "transferred_in" only if DB already has students for this year
    if (existingStudents.length > 0) {
        for (const student of deduped) {
            if (!existingCodes.has(student.code)) {
                student.registration_type = 'transferred_in';
            }
        }
    }

    // Identify departed students (in DB but not in import file)
    const departedStudents = existingStudents.filter((s) => !importedCodes.has(String(s.code || '').trim()));

    const res = await window.api.students.addBulk(deduped);
    if (!res || res.success === false) throw new Error(res?.error || 'فشل حفظ بيانات التلاميذ');
    const sections = [...new Set(deduped.map((s) => s.section).filter(Boolean))];
    DataSourceRegistry.update('students', schoolYear, { count: deduped.length, sections }, []);
    return { importedCount: deduped.length, departedStudents };
}

async function importGrades(workbook, schoolYear, sourceFileName = '') {
    const students = (await window.api.students.getAll(schoolYear)) || [];
    const teachers = (await window.api.teachers.getAll(schoolYear).catch(() => [])) || [];
    const teacherResolver = buildTeacherResolver(teachers);
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

        const isSeparatorCell = (val) => {
            const v = String(val ?? '').trim();
            return !v || v === ':' || v === '：' || v === '-' || v === '—';
        };

        const findMetaValue = (labels) => {
            for (let i = 0; i < maxScan; i++) {
                const row = rows[i] || [];
                for (let c = 0; c < row.length; c++) {
                    const cellRaw = String(row[c] ?? '').trim();
                    const cell = normalizeKey(cellRaw);
                    if (!labels.some((label) => cell.includes(normalizeKey(label)))) continue;
                    // Inline pattern: "label : value" in the same cell
                    const inlineMatch = cellRaw.match(/[:：]\s*(.+)$/);
                    if (inlineMatch && inlineMatch[1].trim()) {
                        return inlineMatch[1].trim();
                    }
                    // Search adjacent cells both directions (RTL files may have values to the left)
                    const offsets = [1, -1, 2, -2, 3, -3, 4, -4];
                    for (const offset of offsets) {
                        const idx = c + offset;
                        if (idx < 0 || idx >= row.length) continue;
                        const candidate = String(row[idx] ?? '').trim();
                        if (isSeparatorCell(candidate)) continue;
                        if (candidate) return candidate;
                    }
                    // Cells below
                    for (let ri = 1; ri <= 2; ri++) {
                        const below = String((rows[i + ri] || [])[c] ?? '').trim();
                        if (!isSeparatorCell(below) && below) return below;
                    }
                }
            }
            return '';
        };

        const sectionFromMeta = findMetaValue(['القسم', 'classe', 'class', 'section']);
        const teacherNameFromMeta = findTeacherNameFromMeta(rows, maxScan);
        const resolvedMetaTeacher = teacherResolver.resolve(teacherNameFromMeta);
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
            // Skip the data-table header row to avoid confusing column headers with meta labels
            for (let i = 0; i < maxScan; i++) {
                if (i === headerIndex) continue;
                const row = rows[i] || [];
                for (let c = 0; c < row.length; c++) {
                    const cellRaw = String(row[c] ?? '').trim();
                    const cell = normalizeKey(cellRaw);
                    if (
                        cell.includes(normalizeKey('المادة')) ||
                        cell === normalizeKey('مادة') ||
                        cell.includes(normalizeKey('matiere')) ||
                        cell.includes(normalizeKey('module'))
                    ) {
                        const isNoise = (val) => {
                            const k = normalizeKey(val);
                            return k.includes(normalizeKey('النقط')) || k.includes('note');
                        };

                        // Inline pattern: "المادة : الرياضيات" in the same cell
                        const inlineMatch = cellRaw.match(/[:：]\s*(.+)$/);
                        if (inlineMatch && inlineMatch[1].trim() && !isNoise(inlineMatch[1])) {
                            const inlineSubject = inlineMatch[1].trim();
                            debugGradesImport('subject:method1-inline', {
                                sheetName,
                                subject: inlineSubject,
                                row: i,
                                col: c
                            });
                            return inlineSubject;
                        }

                        // Search adjacent cells both directions (RTL files may have values to the left)
                        const subjectOffsets = [1, -1, 2, -2, 3, -3, 4, -4];
                        for (const offset of subjectOffsets) {
                            const idx = c + offset;
                            if (idx < 0 || idx >= row.length) continue;
                            const candidate = String(row[idx] ?? '').trim();
                            if (isSeparatorCell(candidate)) continue;
                            if (isNoise(candidate)) continue;
                            if (candidate) {
                                debugGradesImport('subject:method1-adjacent', {
                                    sheetName,
                                    subject: candidate,
                                    row: i,
                                    col: idx
                                });
                                return candidate;
                            }
                        }

                        // Cells below (check multiple positions both directions)
                        for (let ri = 1; ri <= 2; ri++) {
                            const belowRow = rows[i + ri] || [];
                            for (const offset of [0, 1, -1, 2, -2]) {
                                const idx = c + offset;
                                if (idx < 0 || idx >= belowRow.length) continue;
                                const candidate = String(belowRow[idx] ?? '').trim();
                                if (isSeparatorCell(candidate) || isNoise(candidate)) continue;
                                if (candidate) {
                                    debugGradesImport('subject:method1-below', {
                                        sheetName,
                                        subject: candidate,
                                        row: i + ri,
                                        col: idx
                                    });
                                    return candidate;
                                }
                            }
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
            return null;
        })();

        const finalSemester = semesterFromMeta || 1;
        debugGradesImport('semester:detected', { sheetName, semesterFromMeta, finalSemester });

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
            finalSemester,
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
                const resolvedRowTeacher = teacherResolver.resolve(rowTeacherName);
                const resolvedTeacher = resolvedRowTeacher.teacher_name ? resolvedRowTeacher : resolvedMetaTeacher;
                const rowLevel = levelColumnIndex !== -1 ? String(row[levelColumnIndex] ?? '').trim() : '';
                const finalSection = sectionFromMeta || (student ? student.section : '');
                const finalLevel =
                    normalizeLevelName(rowLevel) ||
                    normalizeLevelName(levelFromMeta) ||
                    deriveLevelFromSection(finalSection);
                grades.push({
                    student_id: student ? student.id : null,
                    student_code: studentCode,
                    teacher_id: resolvedTeacher.teacher_id || null,
                    subject: `${normalizeSubjectName(subjectFromMeta)}${subjectSuffix}`,
                    grade: gradeValue,
                    semester: finalSemester,
                    teacher_name: resolvedTeacher.teacher_name || rowTeacherName || teacherNameFromMeta || '',
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

    // Deduplicate: keep only the last grade per (student_code, subject, semester, school_year)
    const gradeMap = new Map();
    grades.forEach((g) => {
        const key = `${g.student_code}||${g.subject}||${g.semester}||${g.school_year}`;
        gradeMap.set(key, g);
    });
    const deduped = Array.from(gradeMap.values());

    const detectedSemester = deduped[0].semester;
    debugGradesImport('importGrades:summary', {
        totalGrades: deduped.length,
        beforeDedup: grades.length,
        detectedSemester,
        uniqueStudents: new Set(deduped.map((g) => String(g.student_code || '').trim()).filter(Boolean)).size,
        uniqueSubjects: [...new Set(deduped.map((g) => g.subject))].slice(0, 40)
    });

    const res = await window.api.grades.saveBulk(deduped);
    if (!res || res.success === false) throw new Error(res?.error || 'فشل حفظ النقط');
    const gradeSections  = [...new Set(grades.map((g) => g.section).filter(Boolean))];
    const gradeTeachers  = [...new Set(grades.map((g) => g._teacher).filter(Boolean))];
    const gradeLevels    = grades.filter((g) => g._level && g.section).map((g) => ({ section: g.section, level: g._level }));
    const gradeSubjects  = [...new Set(grades.map((g) => g.subject).filter(Boolean))];
    const gradeValidator = new CrossSourceValidator(schoolYear);
    const { warnings: gradeWarnings } = await gradeValidator.validateAfterImport('grades', {
        sections: gradeSections, teacherNames: gradeTeachers, levels: gradeLevels
    });
    DataSourceRegistry.update('grades', schoolYear, { count: deduped.length, subjects: gradeSubjects }, gradeWarnings);
    const studentCodes = [...new Set(grades.map((g) => String(g.student_code || '').trim()).filter(Boolean))];
    return { gradesCount: grades.length, studentsCount: studentCodes.length, studentCodes, semester: detectedSemester };
}

async function importAbsences(workbook, schoolYear, options = {}) {
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

    if (options.persist === false) {
        return absences;
    }

    const res = await window.api.absences.saveBulk(absences);
    if (!res || res.success === false) throw new Error(res?.error || 'فشل حفظ الغياب');
    const absCodes      = [...new Set(absences.map((a) => a.student_code).filter(Boolean))];
    const absTeachers   = [...new Set(absences.map((a) => a.teacher_name).filter(Boolean))];
    const absValidator  = new CrossSourceValidator(schoolYear);
    const { warnings: absWarnings } = await absValidator.validateAfterImport('absences', {
        studentCodes: absCodes, teacherNames: absTeachers
    });
    DataSourceRegistry.update('absences', schoolYear, { count: absences.length }, absWarnings);
    return absences.length;
}

async function importFetXml(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(e.target.result, 'text/xml');

                // Validate root element
                const rootTag = xmlDoc.documentElement.tagName;
                if (rootTag === 'parsererror' || xmlDoc.querySelector('parsererror')) {
                    throw new Error('ملف XML غير صالح');
                }

                // CH10: day mappings from js/shared/fet-import.js
                const dayMappings = typeof FET_DAY_MAPPINGS !== 'undefined' ? FET_DAY_MAPPINGS : {};

                const fetEntries = [];
                const allSubjects = new Set();
                const allClasses = new Set();

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

                // Fetch canonical teacher names from DB (filled by MASSAR import)
                let _teacherResolver = buildTeacherResolver([]);
                let allTeachers = [];
                try {
                    const dbTeachers = await window.api.teachers.getAll(getCurrentSchoolYear());
                    allTeachers = Array.isArray(dbTeachers) ? dbTeachers : [];
                    _teacherResolver = buildTeacherResolver(allTeachers);
                    console.log('[FET import] Canonical teacher resolver ready:', allTeachers.length, 'teachers');
                } catch (_e) {
                    console.warn('[FET import] Could not load teachers from DB for name normalization:', _e.message);
                }

                teacherElements.forEach((teacher) => {
                    const rawAttrName = teacher.getAttribute('name');
                    if (!rawAttrName) return;

                    const sourceDisplayName = rawAttrName.replace(/_/g, ' ').trim();
                    const teacherKey = makeTafwijTeacherKey(rawAttrName);
                    const resolvedTeacher = _teacherResolver.resolve(rawAttrName);
                    const canonicalName = resolvedTeacher.teacher_name || sourceDisplayName;
                    const teacherSubjects = new Set();
                    const teacherClasses = new Set();
                    const timetable = {};

                    if (resolvedTeacher.teacher_id) {
                        console.log(`[FET import] Name mapped: "${rawAttrName}" → "${canonicalName}"`);
                    }

                    const days = teacher.querySelectorAll('Day');
                    days.forEach((day) => {
                        const dayName = day.getAttribute('name');
                        if (!dayName || !dayMappings[dayName]) return;

                        const mapping = dayMappings[dayName];
                        const arabicDay = mapping.day;
                        const periodType = mapping.period;

                        if (typeof ensureFetDaySkeleton === 'function') {
                            ensureFetDaySkeleton(timetable, arabicDay);
                        } else if (!timetable[arabicDay]) {
                            timetable[arabicDay] = { morning: {}, afternoon: {} };
                        }

                        const hours = day.querySelectorAll('Hour');
                        hours.forEach((hour) => {
                            const hourName = hour.getAttribute('name');
                            if (!hourName) return;

                            const subject = hour.querySelector('Subject');
                            const students = hour.querySelector('Students');
                            const room = hour.querySelector('Room');

                            if (subject) {
                                const rawSubjectName = subject.getAttribute('name') || '';
                                const subjectName =
                                    typeof translateSubject === 'function'
                                        ? translateSubject(rawSubjectName)
                                        : rawSubjectName;
                                const studentsName = students ? students.getAttribute('name') || '' : '';
                                const roomName = room ? room.getAttribute('name') || '' : '';

                                allSubjects.add(subjectName);
                                teacherSubjects.add(subjectName);
                                if (studentsName) {
                                    const baseClass = getBaseClassName(studentsName);
                                    if (baseClass) {
                                        allClasses.add(baseClass);
                                        teacherClasses.add(baseClass);
                                    }
                                }

                                timetable[arabicDay][periodType][hourName] = {
                                    subject: subjectName,
                                    students: studentsName,
                                    room: roomName
                                };
                            }
                        });
                    });

                    fetEntries.push({
                        key: teacherKey,
                        sourceName: rawAttrName,
                        sourceDisplayName,
                        teacherId: resolvedTeacher.teacher_id || null,
                        teacherName: canonicalName,
                        displayName: canonicalName,
                        matchStatus: resolvedTeacher.teacher_id
                            ? 'matched'
                            : resolvedTeacher.ambiguous
                              ? 'ambiguous'
                              : 'unmatched',
                        candidates: Array.isArray(resolvedTeacher.candidates) ? resolvedTeacher.candidates : [],
                        timetable,
                        subjects: Array.from(teacherSubjects),
                        classes: Array.from(teacherClasses)
                    });
                });

                if (!fetEntries.length) {
                    throw new Error('لم يتم العثور على أساتذة في الملف');
                }

                const unresolvedEntries = fetEntries.filter((entry) => !entry.teacherId);
                if (unresolvedEntries.length) {
                    pendingTafwijImportState = {
                        schoolYear: getCurrentSchoolYear(),
                        entries: fetEntries,
                        allTeachers,
                        fileName: file?.name || 'tafwij'
                    };
                    const partialData = await buildTafwijStoragePayload(pendingTafwijImportState, new Map(), true);
                    const partialSave = await window.api?.timetable?.save?.({ school_year: getCurrentSchoolYear(), data: partialData });
                    if (!partialSave?.success) throw new Error(partialSave?.error || 'فشل حفظ بيانات tafwij المؤقتة');
                    renderTafwijMatchingPanel();
                    await renderTafwijWarningBanner();
                    resolve({
                        teachersCount: fetEntries.length,
                        unresolvedCount: unresolvedEntries.length,
                        requiresReview: true
                    });
                    return;
                }

                const dataToSave = await buildTafwijStoragePayload(
                    {
                        schoolYear: getCurrentSchoolYear(),
                        entries: fetEntries,
                        allTeachers
                    },
                    new Map(),
                    true
                );
                const fetSaveResult = await window.api?.timetable?.save?.({ school_year: getCurrentSchoolYear(), data: dataToSave });
                if (!fetSaveResult?.success) throw new Error(fetSaveResult?.error || 'فشل حفظ بيانات FET في قاعدة البيانات');
                await renderTafwijWarningBanner();
                console.log('FET data saved to database:', fetEntries.length, 'teachers');

                const fetNames      = fetEntries.map((t) => t.name || t.teacherName || '').filter(Boolean);
                const fetValidator  = new CrossSourceValidator(getCurrentSchoolYear());
                const { warnings: fetWarnings } = await fetValidator.validateAfterImport('fet', { teacherNames: fetNames });
                DataSourceRegistry.update('fet', getCurrentSchoolYear(), { teachers: fetNames }, fetWarnings);

                resolve({ teachersCount: fetEntries.length, unresolvedCount: 0, requiresReview: false });
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = () => reject(new Error('تعذر قراءة الملف'));
        reader.readAsText(file, 'UTF-8');
    });
}

// ─── DsAgentExport (Ministry XML) Import ──────────────────────────────────────

async function importAgentXml(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(event.target.result, 'text/xml');

                if (xmlDoc.querySelector('parsererror')) {
                    throw new Error('ملف XML غير صالح');
                }

                const rootTag = xmlDoc.documentElement.tagName;
                if (rootTag !== 'DsAgentExport') {
                    throw new Error('هذا ليس ملف بيانات الوزارة (DsAgentExport)');
                }

                // ── Build lookup maps from reference tables ──
                const buildLookup = (tagName, codeField, labelField) => {
                    const map = new Map();
                    xmlDoc.querySelectorAll(tagName).forEach((el) => {
                        const code = el.querySelector(codeField)?.textContent?.trim();
                        const label = el.querySelector(labelField)?.textContent?.trim();
                        if (code && label) map.set(code, label);
                    });
                    return map;
                };

                const gradeMap = buildLookup('R_GRADE', 'CD_GRADE', 'LL_GRADE');
                const cadreMap = buildLookup('R_CADRE', 'CD_CADRE', 'LL_CADRE');
                const disciplineMap = buildLookup('R_Discip', 'CD_Discip', 'LL_DISCIP');
                const fonctionMap = buildLookup('R_FONCT', 'CD_Fonc', 'LL_FONC');
                const sitFamMap = buildLookup('R_SitFam', 'Sit_Fam', 'LL_SitFam');
                const positionMap = buildLookup('R_Position', 'CD_Position', 'LL_POSITION');
                const statutMap = buildLookup('R_Statut', 'CD_Statut', 'LL_STATUT');
                const dipScolMap = buildLookup('R_DipSCol', 'CD_DIPS', 'LL_DIPS');
                const dipProfMap = buildLookup('R_DipProf', 'CD_DIPP', 'LL_DIPP');

                // Build Arabic-label lookups (prefer Arabic when available)
                const fonctionArMap = buildLookup('R_FONCT', 'CD_Fonc', 'LA_Fonc');
                const disciplineArMap = buildLookup('R_Discip', 'CD_Discip', 'LA_DISCIP');
                const dipScolArMap = buildLookup('R_DipSCol', 'CD_DIPS', 'LA_DIPS');
                const dipProfArMap = buildLookup('R_DipProf', 'CD_DIPP', 'LA_DIPP');

                console.log(
                    '[agent-xml] Lookup tables built:',
                    'grades:',
                    gradeMap.size,
                    'cadres:',
                    cadreMap.size,
                    'disciplines:',
                    disciplineMap.size,
                    'fonctions:',
                    fonctionMap.size,
                    'sitFam:',
                    sitFamMap.size,
                    'positions:',
                    positionMap.size,
                    'statuts:',
                    statutMap.size
                );
                console.log('[agent-xml] positionMap values:', JSON.stringify([...positionMap.entries()]));
                console.log('[agent-xml] statutMap values:', JSON.stringify([...statutMap.entries()]));

                // ── Build ACTIVITE map: PPR → best activity details ──
                // Priority: E002 (surnombre) wins; otherwise keep most recent DATEAFFECT.
                // Also collect ALL cd_fonc codes per PPR to reliably detect surplus.
                const activiteAllFoncs = new Map(); // PPR → Set<cd_fonc>
                const activiteMap = new Map();
                xmlDoc.querySelectorAll('ACTIVITE').forEach((el) => {
                    const ppr = el.querySelector('PPR')?.textContent?.trim();
                    if (!ppr) return;

                    const cdFonc = el.querySelector('CD_FONC')?.textContent?.trim() || '';
                    const cdEtab = el.querySelector('CD_ETAB')?.textContent?.trim() || '';
                    const cdActivites = el.querySelector('CD_ACTIVITES')?.textContent?.trim() || '';
                    const dateaffect = el.querySelector('DATEAFFECT')?.textContent?.trim() || '';

                    // Track all function codes for this PPR (for surplus detection)
                    if (!activiteAllFoncs.has(ppr)) activiteAllFoncs.set(ppr, new Set());
                    if (cdFonc) activiteAllFoncs.get(ppr).add(cdFonc);

                    const current = activiteMap.get(ppr);
                    const isCurrentSurplus = current && (current.cd_fonc === 'E002' || /surnombre/i.test(fonctionMap.get(current.cd_fonc) || ''));
                    const isNewSurplus = cdFonc === 'E002' || /surnombre/i.test(fonctionMap.get(cdFonc) || '');

                    if (!current) {
                        activiteMap.set(ppr, { cd_fonc: cdFonc, cd_etab: cdEtab, cd_activites: cdActivites, dateaffect });
                    } else if (!isCurrentSurplus && isNewSurplus) {
                        // Upgrade to surplus-signalling activity
                        activiteMap.set(ppr, { cd_fonc: cdFonc, cd_etab: cdEtab, cd_activites: cdActivites, dateaffect });
                    } else if (!isCurrentSurplus && !isNewSurplus && dateaffect > current.dateaffect) {
                        // Both non-surplus: prefer more recent
                        activiteMap.set(ppr, { cd_fonc: cdFonc, cd_etab: cdEtab, cd_activites: cdActivites, dateaffect });
                    }
                });

                // ── Build R_TABSERV map: CD_ACTIVITES → aggregated teaching hours ──
                const tabservMap = new Map();
                xmlDoc.querySelectorAll('R_TABSERV').forEach((el) => {
                    const cdAct = el.querySelector('CD_ACTIVITES')?.textContent?.trim();
                    if (!cdAct) return;
                    const heures = parseFloat(el.querySelector('NBR_HEURE_ENS')?.textContent?.trim()) || 0;
                    const heuresSup = parseFloat(el.querySelector('NBR_HEURE_SUP')?.textContent?.trim()) || 0;
                    const classes = parseFloat(el.querySelector('NBR_CLASSE')?.textContent?.trim()) || 0;
                    const existing = tabservMap.get(cdAct);
                    if (existing) {
                        existing.total_hours += heures;
                        existing.overtime_hours += heuresSup;
                        existing.num_classes += classes;
                    } else {
                        tabservMap.set(cdAct, {
                            total_hours: heures,
                            overtime_hours: heuresSup,
                            num_classes: classes
                        });
                    }
                });

                // ── Parse DATAIDENTIFPERSONNEL records ──
                const personnelElements = xmlDoc.querySelectorAll('DATAIDENTIFPERSONNEL');
                if (!personnelElements.length) {
                    throw new Error('لم يتم العثور على بيانات الأساتذة (DATAIDENTIFPERSONNEL) في الملف');
                }

                const schoolYear = getCurrentSchoolYear();
                const teachers = [];

                const getText = (el, tag) => el.querySelector(tag)?.textContent?.trim() || '';

                personnelElements.forEach((el) => {
                    const ppr = getText(el, 'PPR');
                    if (!ppr) return;

                    // ── Names ──
                    const nomA = getText(el, 'NOMA');
                    const prenomA = getText(el, 'PRENOMA');
                    const nomL = getText(el, 'NOML');
                    const prenomL = getText(el, 'PRENOML');

                    const fullName =
                        [nomA, prenomA].filter(Boolean).join(' ') || [nomL, prenomL].filter(Boolean).join(' ');
                    const fullNameFr = [prenomL, nomL].filter(Boolean).join(' ');

                    if (!fullName) return;

                    // ── CIN ──
                    const cina = getText(el, 'CINA');
                    const cinn = getText(el, 'CINN');
                    const cin = cina && cinn ? `${cina}${cinn}` : '';

                    // ── Birth date ──
                    const birthDay = getText(el, 'JOUR_NAIS');
                    const birthMonth = getText(el, 'MOIS_NAIS');
                    const birthYear = getText(el, 'AN_NAIS');
                    let birthDate = '';
                    if (birthYear && birthMonth && birthDay) {
                        birthDate = `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`;
                    }

                    // ── Address ──
                    const adresse = getText(el, 'ADRESSE');
                    const ville = getText(el, 'VILLE');
                    const codePostal = getText(el, 'CODE_POSTAL');
                    const address = [adresse, ville, codePostal].filter(Boolean).join(', ');

                    // ── Phone ──
                    const phone = getText(el, 'TEL_PORTABLE') || getText(el, 'TEL_FIXE');

                    // ── Resolve codes to labels ──
                    const cdGrade = getText(el, 'CD_GRADE');
                    const cdCadre = getText(el, 'CD_CADRE');
                    const cdDiscip = getText(el, 'CD_DISCIP');
                    const cdSitFam = getText(el, 'SIT_FAM');
                    const cdPosition = getText(el, 'CD_POSITION');
                    const cdStatut = getText(el, 'CD_STATUT');
                    const cdDipS = getText(el, 'CD_DIPS');
                    const cdDipP = getText(el, 'CD_DIPP');

                    // Get function from ACTIVITE
                    const activite = activiteMap.get(ppr);
                    const cdFonc = activite?.cd_fonc || getText(el, 'CD_FONC');

                    // ── Teaching service from R_TABSERV ──
                    const cdActivites = activite?.cd_activites || '';
                    const tabserv = cdActivites ? tabservMap.get(cdActivites) : null;

                    // ── Map GENRE ──
                    const rawGenre = getText(el, 'GENRE');
                    let gender = rawGenre;
                    if (rawGenre === '1' || rawGenre === 'M') gender = 'ذكر';
                    if (rawGenre === '2' || rawGenre === 'F') gender = 'أنثى';

                    // ── Helper: apply translation function if available ──
                    const tr = (fn, val) => (typeof fn === 'function' ? fn(val) : val) || val || null;

                    const specialtyAr =
                        disciplineArMap.get(cdDiscip) || tr(translateSubject, disciplineMap.get(cdDiscip));
                    const gradeAr = tr(translateGrade, gradeMap.get(cdGrade));
                    const cadreAr = tr(translateCadre, cadreMap.get(cdCadre));
                    const sitFamAr = tr(translateMaritalStatus, sitFamMap.get(cdSitFam));

                    const fonctionLabelFr = fonctionMap.get(cdFonc) || null;
                    // Check primary activity AND any other activities for this PPR
                    const allFoncs = activiteAllFoncs.get(ppr) || new Set();
                    const isSurplus =
                        cdFonc === 'E002' ||
                        /surnombre/i.test(fonctionLabelFr || '') ||
                        [...allFoncs].some(
                            (fc) => fc === 'E002' || /surnombre/i.test(fonctionMap.get(fc) || '')
                        );

                    // Prefer Arabic labels, fall back to French, but preserve the surplus meaning explicitly.
                    const fonctionLabel = isSurplus
                        ? 'مدرس (فائض)'
                        : fonctionArMap.get(cdFonc) || fonctionLabelFr || null;
                    const dipScolLabel = dipScolArMap.get(cdDipS) || dipScolMap.get(cdDipS) || null;
                    const dipProfLabel = dipProfArMap.get(cdDipP) || dipProfMap.get(cdDipP) || null;

                    // Seniority dates (extract date part before T)
                    const parseXmlDate = (tag) => {
                        const raw = getText(el, tag);
                        return raw ? raw.split('T')[0] : null;
                    };

                    teachers.push({
                        ppr,
                        cin,
                        full_name: fullName,
                        full_name_fr: fullNameFr || null,
                        // specialty_subject = التخصص الرسمي للأستاذ من ملف الوزارة
                        // subject = المادة التي يدرسها فعلياً (تُكمَّل من FET أو يدوياً)
                        specialty_subject: specialtyAr || null,
                        subject: specialtyAr || null, // FET قد يحدّثها لاحقاً
                        gender: gender || null,
                        birth_date: birthDate || null,
                        birth_place: getText(el, 'LIEU_NAIS') || null,
                        phone: phone || null,
                        email: getText(el, 'ADRESSE_ELEC') || null,
                        address: address || null,
                        grade: gradeAr,
                        cadre: cadreAr,
                        echelon: parseInt(getText(el, 'ECHELON'), 10) || null,
                        hire_date: getText(el, 'DATE_REC')?.split('T')[0] || null,
                        marital_status: sitFamAr,
                        function_title: fonctionLabel,
                        // ── New fields ──
                        position: positionMap.get(cdPosition) || null,
                        statut: statutMap.get(cdStatut) || null,
                        diploma_school: dipScolLabel,
                        diploma_professional: dipProfLabel,
                        seniority_admin: parseXmlDate('ANC_ADM'),
                        seniority_grade: parseXmlDate('ANC_GRADE'),
                        echelon_date: parseXmlDate('DT_ECHELON'),
                        titularization_date: parseXmlDate('DT_TITUL'),
                        total_hours: tabserv?.total_hours || null,
                        overtime_hours: tabserv?.overtime_hours || null,
                        num_classes: tabserv?.num_classes || null,
                        is_surplus: isSurplus ? 1 : 0,
                        source: 'agent_xml',
                        school_year: schoolYear,
                        active: 1
                    });
                });

                if (!teachers.length) {
                    throw new Error('لم يتم العثور على أساتذة بـ PPR صالح في الملف');
                }

                console.log('[agent-xml] Parsed', teachers.length, 'teachers. Sending to importBulk...');

                const res = await window.api.teachers.importBulk(teachers);
                if (!res || res.success === false) {
                    throw new Error(res?.error || 'فشل حفظ بيانات الأساتذة');
                }

                console.log('[agent-xml] Import successful:', res.count, 'teachers');
                const agentPpr      = teachers.map((t) => t.ppr || '').filter(Boolean);
                const agentNames    = teachers.map((t) => t.full_name || '').filter(Boolean);
                const agentValidator = new CrossSourceValidator(getCurrentSchoolYear());
                const { warnings: agentWarnings } = await agentValidator.validateAfterImport('agent_xml', { pprList: agentPpr });
                DataSourceRegistry.update('agent_xml', getCurrentSchoolYear(), { teachers: agentNames, pprList: agentPpr }, agentWarnings);
                resolve(teachers.length);
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
            '<tr><td class="px-[30px] py-[30px] text-center text-[var(--color-text-light)]" colspan="4">تعذر تحميل السجل (API غير متاحة)</td></tr>';
        return;
    }

    importLogsRows = ((await window.api.systemLogs.getAll(300)) || []).filter(
        (x) => (x.entity_type || '') === 'import' && isImportSummaryLog(x.details)
    );
    importLogsPage = 1;
    renderImportLogsPage();
}

const LOGS_PAGE_SIZE = 5;
let importLogsRows = [];
let importLogsPage = 1;

function renderImportLogsPage() {
    const tb = getImportLogsTbody();
    if (!tb) return;

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

    const total = importLogsRows.length;
    if (!total) {
        tb.innerHTML =
            '<tr><td class="px-[30px] py-[30px] text-center text-[var(--color-text-light)]" colspan="4"><i class="fas fa-inbox mb-2.5 block text-[32px]"></i>لا توجد عمليات بعد</td></tr>';
        renderImportLogsPagination(0, 1);
        return;
    }

    const totalPages = Math.max(1, Math.ceil(total / LOGS_PAGE_SIZE));
    importLogsPage = Math.min(Math.max(1, importLogsPage), totalPages);
    const start = (importLogsPage - 1) * LOGS_PAGE_SIZE;
    const slice = importLogsRows.slice(start, start + LOGS_PAGE_SIZE);

    tb.innerHTML = slice
        .map(
            (r, i) => `
                <tr>
                    <td class="log-index">${escapeHtml(r.id || start + i + 1)}</td>
                    <td class="log-action"><bdi dir="ltr">${escapeHtml(r.action || '-')}</bdi></td>
                    <td class="log-details" dir="auto">${escapeHtml(r.details || '-')}</td>
                    <td class="log-date-cell">
                        <div class="log-date" dir="ltr">${formatDateTime(r.created_at).date}</div>
                        <div class="log-time" dir="ltr">${formatDateTime(r.created_at).time}</div>
                    </td>
                </tr>
            `
        )
        .join('');

    renderImportLogsPagination(total, totalPages);
}

function renderImportLogsPagination(total, totalPages) {
    const bar = document.getElementById('import-logs-pagination');
    if (!bar) return;
    if (!total) {
        bar.hidden = true;
        return;
    }
    bar.hidden = false;
    const counter = document.getElementById('import-logs-counter');
    const totalEl = document.getElementById('import-logs-total');
    const prev = document.getElementById('import-logs-prev');
    const next = document.getElementById('import-logs-next');
    if (counter) counter.textContent = `${importLogsPage} / ${totalPages}`;
    if (totalEl) totalEl.textContent = `${total.toLocaleString('ar-MA')} عملية`;
    if (prev) prev.disabled = importLogsPage <= 1;
    if (next) next.disabled = importLogsPage >= totalPages;
}

function goToImportLogsPage(delta) {
    const totalPages = Math.max(1, Math.ceil(importLogsRows.length / LOGS_PAGE_SIZE));
    const next = Math.min(Math.max(1, importLogsPage + delta), totalPages);
    if (next === importLogsPage) return;
    importLogsPage = next;
    renderImportLogsPage();
}

// ─── Student Status Import ──────────────────────────────────────────────────

const STATUS_CODE_ALIASES = [
    ...HEADER_ALIASES.code,
    'رقمالطلبة',
    'رقم الطلبة',
    'رقمالتلميذ',
    'رقم التلميذ',
    'numeroapogee',
    'numero',
    'numéro',
    'n°',
    'num'
];

const STATUS_HEADER_ALIASES = {
    status: ['status', 'الحالة', 'الوضعية', 'الوضعيةالدراسية', 'situation', 'etat', 'état', 'statut']
};

const STATUS_VALUE_MAP = {
    منقطع: 'dropout',
    منقطعة: 'dropout',
    'منقطع عن الدراسة': 'dropout',
    abandon: 'dropout',
    abandonné: 'dropout',
    abandonnee: 'dropout',
    decrochage: 'dropout',
    décrochage: 'dropout',
    dropout: 'dropout',
    dropped: 'dropout',
    'dropped out': 'dropout',

    مفصول: 'expelled',
    مفصولة: 'expelled',
    مطرود: 'expelled',
    مطرودة: 'expelled',
    exclu: 'expelled',
    exclue: 'expelled',
    exclusion: 'expelled',
    renvoyé: 'expelled',
    renvoyée: 'expelled',
    renvoye: 'expelled',
    expelled: 'expelled',
    expulsion: 'expelled',

    'غير ملتحق': 'not_enrolled',
    'غير ملتحقة': 'not_enrolled',
    'لم يلتحق': 'not_enrolled',
    'غير مسجل': 'not_enrolled',
    'غير مسجلة': 'not_enrolled',
    'non inscrit': 'not_enrolled',
    'non inscrite': 'not_enrolled',
    'non scolarisé': 'not_enrolled',
    'non scolarise': 'not_enrolled',
    'not enrolled': 'not_enrolled',
    not_enrolled: 'not_enrolled',
    unenrolled: 'not_enrolled',

    active: 'active',
    نشط: 'active',
    نشطة: 'active'
};

// Patterns to detect status from file/sheet titles or metadata rows
const STATUS_TITLE_PATTERNS = [
    { re: /غير\s*ملتحق|الغير\s*الملتحق|لم\s*يلتحق|غير\s*مسجل|non\s*inscri|not.enrolled/i, status: 'not_enrolled' },
    { re: /منقطع|الانقطاع|abandon|décrochage|decrochage|dropout/i, status: 'dropout' },
    { re: /مفصول|مطرود|الفصل|الطرد|exclu|exclusion|expelled|renvoy/i, status: 'expelled' }
];

function normalizeStatusValue(raw) {
    const text = String(raw || '')
        .trim()
        .toLowerCase();
    if (!text) return '';
    if (STATUS_VALUE_MAP[text]) return STATUS_VALUE_MAP[text];
    const clean = text.replace(/[\u064B-\u065F]/g, '').trim();
    if (STATUS_VALUE_MAP[clean]) return STATUS_VALUE_MAP[clean];
    return '';
}

/**
 * Scan text (title, metadata rows, sheet name) for status keywords.
 * Returns the detected status code or '' if none found.
 */
function detectStatusFromText(text) {
    if (!text) return '';
    for (const { re, status } of STATUS_TITLE_PATTERNS) {
        if (re.test(text)) return status;
    }
    return '';
}

async function importStudentStatus(workbook, schoolYear) {
    const allRecords = []; // {code, full_name, family_name, birth_date, birth_place, gender, section, status}
    let skippedNoCode = 0;

    // Header aliases for additional columns
    const familyNameAliases = [...HEADER_ALIASES.familyName, 'النسب', 'اللقب'];
    const firstNameAliases = [...HEADER_ALIASES.firstName, 'الاسم', 'الإسم'];
    const fullNameAliases = HEADER_ALIASES.fullName;
    const genderAliases = HEADER_ALIASES.gender;
    const birthDateAliases = [
        ...HEADER_ALIASES.birthDate,
        'تاريخالإزدياد',
        'تاريخالازدياد',
        'تاريخ الإزدياد',
        'تاريخ الازدياد'
    ];
    const birthPlaceAliases = [
        ...HEADER_ALIASES.birthPlace,
        'مكانالإزدياد',
        'مكانالازدياد',
        'مكان الإزدياد',
        'مكان الازدياد'
    ];
    const sectionAliases = HEADER_ALIASES.section;

    // Process every sheet in the workbook
    for (const sheetName of workbook.SheetNames) {
        const rows = getSheetRows(workbook, sheetName);
        if (!rows.length) continue;

        // 1. Find header row (only need code column at minimum)
        const codeOnlyHeader = findBestHeaderRow(rows, [STATUS_CODE_ALIASES]);
        if (codeOnlyHeader.index < 0) continue;

        const headerIdx = codeOnlyHeader.index;
        const headerRow = rows[headerIdx];

        // Map columns
        const codeIdx = findHeaderIndex(headerRow, STATUS_CODE_ALIASES);
        if (codeIdx < 0) continue;

        const familyIdx = findHeaderIndex(headerRow, familyNameAliases);
        const firstIdx = findHeaderIndex(headerRow, firstNameAliases);
        const fullIdx = findHeaderIndex(headerRow, fullNameAliases);
        const genderIdx = findHeaderIndex(headerRow, genderAliases);
        const birthDIdx = findHeaderIndex(headerRow, birthDateAliases);
        const birthPIdx = findHeaderIndex(headerRow, birthPlaceAliases);
        const sectionIdx = findHeaderIndex(headerRow, sectionAliases);
        const statusColIdx = findHeaderIndex(headerRow, STATUS_HEADER_ALIASES.status);

        // 2. Detect status from title/metadata if no status column
        let impliedStatus = '';
        if (statusColIdx < 0) {
            impliedStatus = detectStatusFromText(sheetName);
            if (!impliedStatus) {
                for (let r = 0; r < Math.min(rows.length, 15); r++) {
                    for (const cell of rows[r] || []) {
                        const text = String(cell ?? '').trim();
                        impliedStatus = detectStatusFromText(text);
                        if (impliedStatus) break;
                    }
                    if (impliedStatus) break;
                }
            }
            if (!impliedStatus) continue; // can't determine status, skip sheet
        }

        // 3. Derive section from sheet name if no section column
        //    Sheet names like "2BACSPF-1" → use as section
        const sheetSection = sectionIdx < 0 ? sheetName.trim() : '';

        // 4. Parse data rows
        for (let i = headerIdx + 1; i < rows.length; i++) {
            const row = rows[i] || [];
            const rawCode = normalizeStudentCode(row[codeIdx]);
            if (!rawCode) {
                skippedNoCode++;
                continue;
            }

            // Build full name
            const family = String(row[familyIdx] ?? '').trim();
            const first = String(row[firstIdx] ?? '').trim();
            let fullName = fullIdx >= 0 ? String(row[fullIdx] ?? '').trim() : '';
            if (!fullName && (family || first)) {
                fullName = [family, first].filter(Boolean).join(' ');
            }
            if (!fullName) fullName = rawCode; // fallback to code

            // Gender
            let gender = genderIdx >= 0 ? String(row[genderIdx] ?? '').trim() : '';

            // Birth date
            let birthDate = birthDIdx >= 0 ? excelDateToIso(row[birthDIdx]) : '';

            // Birth place
            let birthPlace = birthPIdx >= 0 ? String(row[birthPIdx] ?? '').trim() : '';

            // Section
            let section = sectionIdx >= 0 ? String(row[sectionIdx] ?? '').trim() : sheetSection;

            // Status
            let status;
            if (statusColIdx >= 0) {
                status = normalizeStatusValue(row[statusColIdx]);
                if (!status) status = impliedStatus || 'not_enrolled';
            } else {
                status = impliedStatus;
            }

            allRecords.push({
                code: rawCode,
                full_name: fullName,
                family_name: family,
                birth_date: birthDate,
                birth_place: birthPlace,
                gender: gender,
                section: section,
                school_year: schoolYear,
                status: status
            });
        }
    }

    if (!allRecords.length) {
        const hint = skippedNoCode
            ? `${skippedNoCode} صف بدون رمز مسار`
            : 'لم يتم التعرف على الحالة من عنوان الملف أو لم يُعثر على أعمدة صالحة';
        throw new Error('لم يتم العثور على سجلات صالحة. ' + hint);
    }

    // Use addBulk which does UPSERT (insert new + update existing)
    let totalProcessed = 0;
    for (let i = 0; i < allRecords.length; i += 500) {
        const batch = allRecords.slice(i, i + 500);
        const result = await window.api.students.addBulk(batch);
        if (result && result.success) {
            totalProcessed += result.count || batch.length;
        }
    }

    return totalProcessed;
}

// ── Orientation (التوجيه المدرسي) import — Excel / CSV / JSON ──

/**
 * Orientation import errors — vocabulary from OrientationErrorContract
 * (js/shared/errors/orientation-error-contract.js). No local competing catalog.
 */
function orientationContract() {
    return typeof OrientationErrorContract !== 'undefined' ? OrientationErrorContract : null;
}

function orientationCodeKnown(code) {
    const c = orientationContract();
    return !!(c && code && c.getDefinition(code));
}

function orientationDefaultMessage(code) {
    const c = orientationContract();
    if (c) return c.getDefaultMessage(code);
    return 'حدث خطأ أثناء استيراد التوجيه. لم يُحفظ أي سجل.';
}

function orientationIsRetryable(code) {
    const c = orientationContract();
    if (c && code) return c.isRetryable(code);
    return true;
}

function createOrientationError(code, overrides = {}) {
    const c = orientationContract();
    const def = c && code ? c.getDefinition(code) : null;
    const baseline = def ? def.message : 'حدث خطأ في التوجيه';
    const err = new Error(overrides.message != null ? overrides.message : baseline);
    err.name = 'OrientationImportError';
    err.code = code || 'INVALID_RECORD';
    err.details =
        overrides.details != null
            ? c
                ? c.safeDetails(overrides.details) || overrides.details
                : overrides.details
            : null;
    err.retryable =
        overrides.retryable != null ? !!overrides.retryable : def ? !!def.retryable : false;
    err.userSafe = true;
    err.noRecordsSaved = overrides.noRecordsSaved !== false;
    return err;
}

function isOrientationError(err) {
    return !!(err && (err.name === 'OrientationImportError' || err.userSafe) && err.code);
}

/** User-facing message only — never expose raw exception / SQL / stacks. */
function orientationUserMessage(err) {
    const c = orientationContract();
    if (c && err) {
        const n = c.normalize(
            err.success === false
                ? err
                : {
                      success: false,
                      code: err.code,
                      error: err.message || err.error,
                      message: err.message || err.error,
                      details: err.details,
                      retryable: err.retryable
                  }
        );
        if (isOrientationError(err) && err.message && /[\u0600-\u06FF]/.test(String(err.message))) {
            // Presentation context allowed (FR-002a) when caller set a safe Arabic message
            if (!/SQLITE|\.js:\d+|at\s+\S+\s+\(|Error:/i.test(String(err.message))) {
                return String(err.message);
            }
        }
        return n.message || n.error || orientationDefaultMessage(err.code);
    }
    if (isOrientationError(err) && err.message) return err.message;
    const code = err?.code;
    if (code && orientationCodeKnown(code)) return orientationDefaultMessage(code);
    const msg = String(err?.message || '').trim();
    if (msg && /[\u0600-\u06FF]/.test(msg) && !/SQLITE|\.js:\d+|at\s+\S+\s+\(|Error:/i.test(msg)) {
        return msg;
    }
    return 'حدث خطأ أثناء استيراد التوجيه. لم يُحفظ أي سجل.';
}

function isValidSchoolYearFormat(year) {
    return typeof year === 'string' && /^\d{4}\/\d{4}$/.test(year.trim());
}

/** Compare school years ignoring hyphen vs slash and whitespace. */
function normalizeSchoolYearKey(year) {
    if (year == null || year === '') return '';
    const m = String(year)
        .trim()
        .match(/\b(20\d{2})\s*[\/\-]\s*(20\d{2})\b/);
    if (m) return `${m[1]}/${m[2]}`;
    return String(year).trim();
}

function pushSkipReason(bucket, reason) {
    if (!bucket || !reason) return;
    const key = reason.code || reason.reason || reason.message || 'unknown';
    if (!bucket[key]) {
        bucket[key] = {
            code: reason.code || null,
            reason: reason.reason || reason.code || 'skip',
            message: reason.message || '',
            count: 0
        };
    }
    bucket[key].count += 1;
}

function skipReasonsToList(bucket) {
    return Object.values(bucket || {}).sort((a, b) => b.count - a.count);
}

/**
 * origin_stream policy (plan §5.1.ب):
 * 1) original stream column  2) valid currentLevel  3) valid sheet / context filter  4) skip
 */
function resolveOriginStream(raw, context = {}, sheetName = '') {
    const col =
        String(
            raw?.origin_stream ||
                raw?.filiere_origine ||
                raw?.stream_origin ||
                raw?.filiere ||
                raw?.stream ||
                raw?.الشعبة_الأصلية ||
                raw?.الشعبة ||
                ''
        ).trim() || '';
    if (col) return { value: col, source: 'column' };

    const currentLevel = String(raw?.currentLevel || raw?.current_level || '').trim();
    if (currentLevel) return { value: currentLevel, source: 'currentLevel' };

    const sheet = String(sheetName || '').trim();
    if (sheet && !/^sheet\d*$/i.test(sheet) && !/^feuille/i.test(sheet) && sheet !== 'ورقة1') {
        return { value: sheet, source: 'sheet' };
    }

    const filterLevel = String(context?.filterLevel || context?.filter_level || '').trim();
    if (filterLevel) return { value: filterLevel, source: 'context' };

    return { value: '', source: null };
}

/**
 * Parse optional numeric field. Present-but-invalid → invalid flag (never coerce to 0).
 * Empty → null (valid absence).
 */
function parseOrientationNumericStrict(value) {
    if (value == null || value === '') return { value: null, invalid: false };
    if (typeof value === 'number') {
        return Number.isFinite(value) ? { value, invalid: false } : { value: null, invalid: true };
    }
    const raw = String(value).trim();
    if (!raw) return { value: null, invalid: false };
    const n = Number(raw.replace(/\s+/g, '').replace(',', '.'));
    if (!Number.isFinite(n)) return { value: null, invalid: true };
    return { value: n, invalid: false };
}

const ORIENTATION_HEADER_ALIASES = {
    code: [
        ...HEADER_ALIASES.code,
        'رمزمسار',
        'رقممسار',
        'رقم_المسار',
        'code massar',
        'code_massar'
    ],
    fullName: [...HEADER_ALIASES.fullName, 'الاسم', 'name', 'élève', 'eleve'],
    familyName: [...HEADER_ALIASES.familyName],
    firstName: [...HEADER_ALIASES.firstName],
    gender: [...HEADER_ALIASES.gender],
    section: [...HEADER_ALIASES.section],
    level: [...HEADER_ALIASES.level],
    originStream: [
        'originstream',
        'origin_stream',
        'filiereorigine',
        'filiere_origine',
        'streamorigin',
        'stream_origin',
        'filiere',
        'stream',
        'الشعبةالأصلية',
        'الشعبة_الأصلية',
        'شعبةالمنشأ',
        'شعبة_المنشأ',
        'المسلكالأصلي',
        'المسلك_الأصلي',
        'الشعبة',
        'المسلك',
        'شعبة',
        'مسلك',
        'filière',
        'filiere dorigine',
        'filiere d origine'
    ],
    choice1: [
        'choice1',
        'choice_1',
        'choix1',
        'choix_1',
        'choix 1',
        'firstchoice',
        'first_choice',
        'الاختيارالأول',
        'الاختيار_الأول',
        'الرغبةالأولى',
        'الرغبة_الأولى',
        'الاختيار 1',
        'choix1'
    ],
    choice2: [
        'choice2',
        'choice_2',
        'choix2',
        'choix_2',
        'choix 2',
        'secondchoice',
        'second_choice',
        'الاختيارالثاني',
        'الاختيار_الثاني',
        'الرغبةالثانية',
        'الرغبة_الثانية',
        'الاختيار 2'
    ],
    choice3: [
        'choice3',
        'choice_3',
        'choix3',
        'choix_3',
        'choix 3',
        'thirdchoice',
        'third_choice',
        'الاختيارالثالث',
        'الاختيار_الثالث',
        'الرغبةالثالثة',
        'الرغبة_الثالثة',
        'الاختيار 3'
    ],
    assignedStream: [
        'assignedstream',
        'assigned_stream',
        'affectation',
        'decision',
        'finalstream',
        'final_stream',
        'الشعبةالمسندة',
        'الشعبة_المسندة',
        'التوجيهالنهائي',
        'التوجيه_النهائي',
        'القرار',
        'التوجيه',
        'affectation finale'
    ],
    decisionStatus: [
        'decisionstatus',
        'decision_status',
        'statut',
        'status',
        'etat',
        'حالةالقرار',
        'حالة_القرار',
        'الحالة',
        'الوضعية',
        'statut decision'
    ],
    average: [
        'average',
        'moyenne',
        'avg',
        'mean',
        'المعدل',
        'المعدلالعام',
        'المعدل_العام',
        'معدل'
    ],
    rank: ['rank', 'rank_num', 'rang', 'classement', 'الرتبة', 'الترتيب', 'رتبة'],
    notes: ['notes', 'note', 'remarques', 'remark', 'comments', 'ملاحظات', 'ملاحظة', 'تعليق']
};

function isOrientationJsonFile(file) {
    if (!file) return false;
    const name = String(file.name || '').toLowerCase();
    const type = String(file.type || '').toLowerCase();
    return name.endsWith('.json') || type === 'application/json' || type === 'text/json';
}

function cellText(row, idx) {
    if (idx < 0 || !row) return '';
    const v = row[idx];
    if (v == null || v === '') return '';
    return String(v).trim();
}

function cellNumber(row, idx) {
    if (idx < 0 || !row) return null;
    const v = row[idx];
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(',', '.').trim());
    return Number.isFinite(n) ? n : null;
}

/**
 * Extract ordered orientation choices from flat fields or Massar `choices[]`.
 * @returns {[string|null, string|null, string|null]}
 */
function extractOrientationChoices(raw) {
    if (!raw || typeof raw !== 'object') return [null, null, null];

    if (Array.isArray(raw.choices) && raw.choices.length) {
        const sorted = raw.choices
            .slice()
            .sort((a, b) => (Number(a?.order) || 0) - (Number(b?.order) || 0));
        const levels = sorted
            .map((c) => String(c?.targetLevel || c?.target_level || c?.level || c?.filiere || '').trim())
            .filter(Boolean);
        return [levels[0] || null, levels[1] || null, levels[2] || null];
    }

    return [
        String(raw.choice_1 || raw.choix1 || raw.choice1 || raw.الاختيار_الأول || '').trim() || null,
        String(raw.choice_2 || raw.choix2 || raw.choice2 || raw.الاختيار_الثاني || '').trim() || null,
        String(raw.choice_3 || raw.choix3 || raw.choice3 || raw.الاختيار_الثالث || '').trim() || null
    ];
}

/**
 * Build notes from Massar justification + receiving schools on choices.
 */
function buildOrientationNotes(raw) {
    const parts = [];
    const justification = String(raw.justification || raw.notes || raw.remarques || raw.ملاحظات || '').trim();
    if (justification) parts.push(justification);

    if (Array.isArray(raw.choices)) {
        for (const c of raw.choices) {
            const school = String(c?.receivingSchool || c?.receiving_school || c?.school || '').trim();
            const order = Number(c?.order) || '';
            const target = String(c?.targetLevel || c?.target_level || '').trim();
            if (school) {
                parts.push(order ? `مؤسسة الرغبة ${order}: ${school}` : `مؤسسة الاستقبال: ${school}`);
            } else if (target && order) {
                // keep compact — level already stored in choice columns
            }
        }
    }

    if (raw.requestId || raw.request_id) {
        parts.push(`طلب مسار: ${raw.requestId || raw.request_id}`);
    }
    if (raw.massarService || raw.massar_service) {
        const svc = String(raw.massarService || raw.massar_service).trim();
        if (svc) parts.push(`خدمة مسار: ${svc}`);
    }

    return parts.length ? parts.join(' | ') : null;
}

/**
 * Parse Massar-style averages (`"12,13"`) and numeric values.
 * Never coerces invalid values to 0 — returns null instead.
 */
function parseOrientationAverage(value) {
    return parseOrientationNumericStrict(value).value;
}

/**
 * Normalize a raw orientation/results record into bulkUpsert shape.
 * @param {object} raw
 * @param {object} [context] — Massar export context (filterLevel, schoolYear, pageType, …)
 * @param {object} [options]
 * @param {string} [options.sheetName]
 * @param {string} [options.schoolYear]
 * @returns {{ ok: true, row: object } | { ok: false, code: string, reason: string, message: string } | null}
 */
function normalizeOrientationRecord(raw, context, options = {}) {
    if (!raw || typeof raw !== 'object') {
        return {
            ok: false,
            code: 'INVALID_RECORD',
            reason: 'invalid_record',
            message: 'صف غير صالح'
        };
    }
    const ctx = context && typeof context === 'object' ? context : {};
    const sheetName = options.sheetName || '';
    const schoolYear = options.schoolYear || null;
    const isResults =
        ctx.pageType === 'results' ||
        raw.assignedLevel != null ||
        raw.assigned_level != null ||
        raw.resultCategory != null ||
        raw.result_category != null;

    const code = normalizeStudentCode(
        raw.student_code ||
            raw.studentCode ||
            raw.code ||
            raw.massar_code ||
            raw.massar ||
            raw.CodeEleve ||
            raw.Code ||
            raw.CODE ||
            ''
    );

    if (!code) {
        return {
            ok: false,
            code: 'MISSING_STUDENT_CODE',
            reason: 'missing_code',
            message: 'رمز التلميذ مفقود'
        };
    }

    const family = String(
        raw.family_name || raw.familyName || raw.lastName || raw.last_name || raw.nom || raw.النسب || ''
    ).trim();
    const first = String(raw.first_name || raw.firstName || raw.prenom || raw.الاسم || '').trim();
    let fullName = String(
        raw.full_name ||
            raw.fullName ||
            raw.name ||
            raw.student_name ||
            raw.nom_complet ||
            raw.NomComplet ||
            ''
    ).trim();
    if (!fullName && (family || first)) fullName = [family, first].filter(Boolean).join(' ');

    const originResolved = resolveOriginStream(raw, ctx, sheetName);
    if (!originResolved.value) {
        return {
            ok: false,
            code: 'MISSING_ORIGIN_STREAM',
            reason: 'missing_origin_stream',
            message: 'الشعبة الأصلية مفقودة'
        };
    }

    const [choice1, choice2, choice3] = extractOrientationChoices(raw);

    const avgParsed = parseOrientationNumericStrict(raw.average ?? raw.moyenne ?? raw.avg ?? raw.المعدل);
    const rankParsed = parseOrientationNumericStrict(raw.rank_num ?? raw.rank ?? raw.rang ?? raw.الرتبة);
    // Invalid numeric → null (not 0); record still accepted with field-level note
    const average = avgParsed.invalid ? null : avgParsed.value;
    const rankNum = rankParsed.invalid ? null : rankParsed.value;

    const level = String(
        raw.level || raw.niveau || raw.currentLevel || raw.current_level || raw.المستوى || ctx.filterLevel || ''
    ).trim();

    const section = String(
        raw.section || raw.className || raw.class_name || raw.class || raw.classe || raw.القسم || ''
    ).trim();

    const assigned = String(
        raw.assigned_stream ||
            raw.assignedLevel ||
            raw.assigned_level ||
            raw.affectation ||
            raw.decision ||
            raw.Affectation ||
            ''
    ).trim();

    const decisionStatus = String(
        raw.decision_status ||
            raw.result ||
            raw.resultCategory ||
            raw.result_category ||
            raw.statut ||
            raw.status ||
            raw.Etat ||
            raw.الحالة ||
            ''
    ).trim();

    let notes = buildOrientationNotes(raw);
    if (isResults) {
        const resultParts = [];
        if (decisionStatus) resultParts.push(`النتيجة: ${decisionStatus}`);
        if (assigned) resultParts.push(`المستوى المسند: ${assigned}`);
        if (average != null) resultParts.push(`المعدل: ${average}`);
        if (!notes && resultParts.length) notes = resultParts.join(' | ');
    }

    const row = {
        student_code: code,
        full_name: fullName || null,
        gender: String(raw.gender || raw.sexe || raw.الجنس || raw.النوع || '').trim() || null,
        section: section || null,
        level: level || null,
        origin_stream: originResolved.value,
        choice_1: choice1,
        choice_2: choice2,
        choice_3: choice3,
        assigned_stream: assigned || null,
        decision_status: decisionStatus || null,
        average,
        rank_num: rankNum,
        notes,
        school_year: schoolYear || null
    };

    const warnings = [];
    if (avgParsed.invalid) {
        warnings.push({
            code: 'INVALID_NUMERIC_VALUE',
            field: 'average',
            message: 'تم تجاهل معدل غير رقمي'
        });
    }
    if (rankParsed.invalid) {
        warnings.push({
            code: 'INVALID_NUMERIC_VALUE',
            field: 'rank_num',
            message: 'تم تجاهل رتبة غير رقمية'
        });
    }

    return { ok: true, row, warnings, originSource: originResolved.source };
}

function extractOrientationRowsFromWorkbook(workbook, schoolYear) {
    const allRecords = [];
    let skipped = 0;
    const skipReasons = {};
    let sheetsWithHeaders = 0;

    if (!workbook || !Array.isArray(workbook.SheetNames)) {
        throw createOrientationError('INVALID_FILE_STRUCTURE', {
            message: 'بنية ملف Excel/CSV غير صالحة. لم يُحفظ أي سجل.',
            noRecordsSaved: true
        });
    }

    for (const sheetName of workbook.SheetNames || []) {
        let rows;
        try {
            rows = getSheetRows(workbook, sheetName);
        } catch {
            pushSkipReason(skipReasons, {
                code: 'INVALID_FILE_STRUCTURE',
                reason: 'sheet_read_error',
                message: 'تعذر قراءة ورقة'
            });
            continue;
        }
        if (!rows.length) continue;

        const headerInfo = findBestHeaderRow(rows, [
            ORIENTATION_HEADER_ALIASES.code,
            ORIENTATION_HEADER_ALIASES.originStream
        ]);
        const codeOnly = headerInfo.score < 1 ? findBestHeaderRow(rows, [ORIENTATION_HEADER_ALIASES.code]) : headerInfo;
        if (codeOnly.index < 0 || codeOnly.score < 1) continue;

        sheetsWithHeaders += 1;
        const headerIdx = codeOnly.index;
        const headerRow = rows[headerIdx] || [];
        const codeIdx = findHeaderIndex(headerRow, ORIENTATION_HEADER_ALIASES.code);
        if (codeIdx < 0) continue;

        const originIdx = findHeaderIndex(headerRow, ORIENTATION_HEADER_ALIASES.originStream);
        const fullIdx = findHeaderIndex(headerRow, ORIENTATION_HEADER_ALIASES.fullName);
        const familyIdx = findHeaderIndex(headerRow, ORIENTATION_HEADER_ALIASES.familyName);
        const firstIdx = findHeaderIndex(headerRow, ORIENTATION_HEADER_ALIASES.firstName);
        const genderIdx = findHeaderIndex(headerRow, ORIENTATION_HEADER_ALIASES.gender);
        const sectionIdx = findHeaderIndex(headerRow, ORIENTATION_HEADER_ALIASES.section);
        const levelIdx = findHeaderIndex(headerRow, ORIENTATION_HEADER_ALIASES.level);
        const c1Idx = findHeaderIndex(headerRow, ORIENTATION_HEADER_ALIASES.choice1);
        const c2Idx = findHeaderIndex(headerRow, ORIENTATION_HEADER_ALIASES.choice2);
        const c3Idx = findHeaderIndex(headerRow, ORIENTATION_HEADER_ALIASES.choice3);
        const assignedIdx = findHeaderIndex(headerRow, ORIENTATION_HEADER_ALIASES.assignedStream);
        const statusIdx = findHeaderIndex(headerRow, ORIENTATION_HEADER_ALIASES.decisionStatus);
        const avgIdx = findHeaderIndex(headerRow, ORIENTATION_HEADER_ALIASES.average);
        const rankIdx = findHeaderIndex(headerRow, ORIENTATION_HEADER_ALIASES.rank);
        const notesIdx = findHeaderIndex(headerRow, ORIENTATION_HEADER_ALIASES.notes);

        for (let i = headerIdx + 1; i < rows.length; i++) {
            const row = rows[i] || [];
            const code = normalizeStudentCode(row[codeIdx]);
            // Skip blank trailing rows without counting as validation failures
            const isBlankRow = row.every((c) => c == null || String(c).trim() === '');
            if (isBlankRow) continue;

            if (!code) {
                skipped++;
                pushSkipReason(skipReasons, {
                    code: 'MISSING_STUDENT_CODE',
                    reason: 'missing_code',
                    message: 'رمز التلميذ مفقود'
                });
                continue;
            }

            const family = cellText(row, familyIdx);
            const first = cellText(row, firstIdx);
            let fullName = cellText(row, fullIdx);
            if (!fullName && (family || first)) fullName = [family, first].filter(Boolean).join(' ');

            const originCol = originIdx >= 0 ? cellText(row, originIdx) : '';
            const originResolved = resolveOriginStream(
                {
                    origin_stream: originCol,
                    currentLevel: cellText(row, levelIdx)
                },
                {},
                originIdx < 0 ? sheetName : ''
            );
            if (!originResolved.value) {
                skipped++;
                pushSkipReason(skipReasons, {
                    code: 'MISSING_ORIGIN_STREAM',
                    reason: 'missing_origin_stream',
                    message: 'الشعبة الأصلية مفقودة'
                });
                continue;
            }

            // cellNumber already returns null for invalid — never 0 coercion
            const avgRaw = avgIdx >= 0 ? row[avgIdx] : null;
            const rankRaw = rankIdx >= 0 ? row[rankIdx] : null;
            const avgParsed = parseOrientationNumericStrict(avgRaw);
            const rankParsed = parseOrientationNumericStrict(rankRaw);
            if (avgParsed.invalid) {
                pushSkipReason(skipReasons, {
                    code: 'INVALID_NUMERIC_VALUE',
                    reason: 'invalid_average',
                    message: 'معدل غير رقمي (تم تجاهل القيمة فقط)'
                });
            }
            if (rankParsed.invalid) {
                pushSkipReason(skipReasons, {
                    code: 'INVALID_NUMERIC_VALUE',
                    reason: 'invalid_rank',
                    message: 'رتبة غير رقمية (تم تجاهل القيمة فقط)'
                });
            }

            allRecords.push({
                student_code: code,
                full_name: fullName || null,
                gender: cellText(row, genderIdx) || null,
                section: cellText(row, sectionIdx) || null,
                level: cellText(row, levelIdx) || null,
                origin_stream: originResolved.value,
                choice_1: cellText(row, c1Idx) || null,
                choice_2: cellText(row, c2Idx) || null,
                choice_3: cellText(row, c3Idx) || null,
                assigned_stream: cellText(row, assignedIdx) || null,
                decision_status: cellText(row, statusIdx) || null,
                average: avgParsed.invalid ? null : avgParsed.value,
                rank_num: rankParsed.invalid ? null : rankParsed.value,
                notes: cellText(row, notesIdx) || null,
                school_year: schoolYear || null
            });
        }
    }

    if (!sheetsWithHeaders && !allRecords.length) {
        throw createOrientationError('INVALID_FILE_STRUCTURE', {
            message:
                'لم يتم العثور على أعمدة التوجيه (رمز مسار / الشعبة الأصلية). لم يُحفظ أي سجل.',
            noRecordsSaved: true,
            details: { skipped }
        });
    }

    return { rows: allRecords, skipped, skipReasons: skipReasonsToList(skipReasons) };
}

/**
 * Detect school year inside Massar/generic orientation JSON (`context.schoolYear`).
 */
function detectSchoolYearFromOrientationJson(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    const raw =
        parsed.context?.schoolYear ||
        parsed.context?.school_year ||
        parsed.schoolYear ||
        parsed.school_year ||
        null;
    if (!raw) return null;
    const m = String(raw).trim().match(/\b(20\d{2})[\/\-](20\d{2})\b/);
    if (!m) return String(raw).trim() || null;
    const y1 = parseInt(m[1], 10);
    const y2 = parseInt(m[2], 10);
    if (y2 === y1 + 1) return `${y1}/${y2}`;
    return String(raw).trim();
}

/**
 * True for Massar orientation (LstDemande) or year-end results (ResultatsList) export:
 * { ok?, pageType?, context, students:[{studentCode, …}] }
 */
function isMassarOrientationExport(parsed) {
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.students)) return false;
    const pageType = String(parsed.pageType || parsed.context?.pageType || '').toLowerCase();
    if (pageType === 'results' || pageType === 'orientation') return true;
    const url = String(parsed.context?.pageUrl || '');
    if (/ResultatsList|LstDemande|Orientation|DecisionFinAnnee/i.test(url)) return true;
    if (!parsed.students.length) return true;
    const s = parsed.students[0];
    return !!(
        s &&
        (s.studentCode || s.student_code) &&
        (Array.isArray(s.choices) ||
            s.currentLevel ||
            s.current_level ||
            s.assignedLevel ||
            s.assigned_level ||
            s.result != null ||
            s.resultCategory != null ||
            s.fullName ||
            s.full_name)
    );
}

async function parseOrientationJsonFile(file, schoolYear) {
    let text;
    try {
        text = await new Promise((resolve, reject) => {
            if (!file) {
                reject(createOrientationError('EMPTY_FILE', { noRecordsSaved: true }));
                return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () =>
                reject(
                    createOrientationError('FILE_READ_ERROR', {
                        message: 'تعذر قراءة ملف JSON للتوجيه. لم يُحفظ أي سجل.',
                        noRecordsSaved: true
                    })
                );
            try {
                reader.readAsText(file, 'UTF-8');
            } catch {
                reject(
                    createOrientationError('FILE_READ_ERROR', {
                        message: 'تعذر فتح ملف JSON للتوجيه. لم يُحفظ أي سجل.',
                        noRecordsSaved: true
                    })
                );
            }
        });
    } catch (err) {
        if (isOrientationError(err)) throw err;
        throw createOrientationError('FILE_READ_ERROR', {
            message: 'تعذر قراءة ملف JSON للتوجيه. لم يُحفظ أي سجل.',
            noRecordsSaved: true
        });
    }

    if (!String(text || '').trim()) {
        throw createOrientationError('EMPTY_FILE', {
            message: 'ملف التوجيه JSON فارغ. لم يُحفظ أي سجل.',
            noRecordsSaved: true
        });
    }

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw createOrientationError('INVALID_FILE_STRUCTURE', {
            message: 'ملف JSON غير صالح (فشل التحليل). لم يُحفظ أي سجل.',
            noRecordsSaved: true
        });
    }

    const detectedYear = detectSchoolYearFromOrientationJson(parsed);
    const context = parsed && typeof parsed === 'object' ? parsed.context || null : null;

    let list = [];
    if (Array.isArray(parsed)) {
        list = parsed;
    } else if (parsed && typeof parsed === 'object') {
        if (isMassarOrientationExport(parsed) || Array.isArray(parsed.students)) {
            list = parsed.students;
        } else if (Array.isArray(parsed.rows)) list = parsed.rows;
        else if (Array.isArray(parsed.data)) list = parsed.data;
        else if (Array.isArray(parsed.records)) list = parsed.records;
        else if (Array.isArray(parsed.orientation)) list = parsed.orientation;
        else if (Array.isArray(parsed.eleves)) list = parsed.eleves;
        else {
            throw createOrientationError('UNSUPPORTED_FORMAT', {
                message:
                    'صيغة JSON غير مدعومة. المقبول: تصدير مسار (students) أو مصفوفة / rows / data. لم يُحفظ أي سجل.',
                noRecordsSaved: true
            });
        }
    } else {
        throw createOrientationError('UNSUPPORTED_FORMAT', {
            message: 'صيغة JSON غير مدعومة. لم يُحفظ أي سجل.',
            noRecordsSaved: true
        });
    }

    if (!list.length) {
        throw createOrientationError('EMPTY_FILE', {
            message: 'ملف التوجيه لا يحتوي على أي تلميذ. لم يُحفظ أي سجل.',
            noRecordsSaved: true
        });
    }

    const rows = [];
    let skipped = 0;
    const skipBucket = {};
    for (const raw of list) {
        const norm = normalizeOrientationRecord(raw, context, { schoolYear });
        if (!norm || !norm.ok) {
            skipped++;
            pushSkipReason(skipBucket, norm || {
                code: 'INVALID_RECORD',
                reason: 'invalid_record',
                message: 'سجل غير صالح'
            });
            continue;
        }
        if (Array.isArray(norm.warnings)) {
            for (const w of norm.warnings) {
                pushSkipReason(skipBucket, {
                    code: w.code || 'INVALID_NUMERIC_VALUE',
                    reason: w.field || 'invalid_numeric',
                    message: w.message || 'قيمة رقمية غير صالحة (تم تجاهلها فقط)'
                });
            }
        }
        rows.push(norm.row);
    }
    const pageType = String(parsed?.pageType || parsed?.context?.pageType || '').toLowerCase();
    let source = 'json';
    if (isMassarOrientationExport(parsed)) {
        source = pageType === 'results' ? 'massar_results' : 'massar_orientation';
    }
    return {
        rows,
        skipped,
        skipReasons: skipReasonsToList(skipBucket),
        detectedYear,
        source,
        pageType: pageType || null
    };
}

/**
 * Assert file school year matches selected year. Hard-stop — no silent substitution, no proceed.
 */
function assertOrientationSchoolYearMatch(detectedYear, selectedYear) {
    if (!detectedYear) return;
    const fileKey = normalizeSchoolYearKey(detectedYear);
    const selectedKey = normalizeSchoolYearKey(selectedYear);
    if (!fileKey || !selectedKey) return;
    if (fileKey !== selectedKey) {
        throw createOrientationError('SCHOOL_YEAR_MISMATCH', {
            message: `الموسم في الملف (${detectedYear}) لا يطابق الموسم المختار (${selectedYear}). لم يُحفظ أي سجل.`,
            details: { fileYear: detectedYear, selectedYear },
            noRecordsSaved: true,
            retryable: false
        });
    }
}

/**
 * Import school orientation rows from Excel/CSV/JSON (incl. Massar) into student_orientation.
 * Non-destructive merge is enforced in the orientation repository (SSOT).
 * @returns {Promise<{ imported, inserted, updated, unchanged, skipped, duplicatesInFile, schoolYear, skipReasons, success }>}
 */
async function importOrientation(file, schoolYear, preparsedWorkbook, preparsedJson) {
    if (!window.api?.orientation?.bulkUpsert) {
        throw createOrientationError('DATABASE_ERROR', {
            message: 'ميزة استيراد التوجيه غير متاحة في هذا الإصدار. لم يُحفظ أي سجل.',
            noRecordsSaved: true,
            retryable: false
        });
    }

    if (!isValidSchoolYearFormat(String(schoolYear || '').trim())) {
        throw createOrientationError('INVALID_SCHOOL_YEAR', {
            details: { schoolYear },
            noRecordsSaved: true
        });
    }
    const year = String(schoolYear).trim();

    let extracted;
    try {
        if (preparsedJson && Array.isArray(preparsedJson.rows)) {
            extracted = preparsedJson;
        } else if (isOrientationJsonFile(file)) {
            extracted = await parseOrientationJsonFile(file, year);
        } else {
            let workbook = preparsedWorkbook;
            if (!workbook) {
                try {
                    workbook = await parseWorkbook(file);
                } catch (readErr) {
                    if (isOrientationError(readErr)) throw readErr;
                    throw createOrientationError('FILE_READ_ERROR', {
                        message: 'تعذر قراءة ملف Excel/CSV للتوجيه. لم يُحفظ أي سجل.',
                        noRecordsSaved: true
                    });
                }
            }
            extracted = extractOrientationRowsFromWorkbook(workbook, year);
        }
    } catch (err) {
        if (isOrientationError(err)) throw err;
        throw createOrientationError('INVALID_FILE_STRUCTURE', {
            message: orientationUserMessage(err),
            noRecordsSaved: true
        });
    }

    // Year guard before any write (also applied by handleImport when pre-parsed)
    if (extracted.detectedYear) {
        assertOrientationSchoolYearMatch(extracted.detectedYear, year);
    }

    const { rows, skipped: parseSkipped = 0 } = extracted;
    const skipBucket = {};
    for (const r of extracted.skipReasons || []) {
        pushSkipReason(skipBucket, r);
    }

    if (!rows.length) {
        throw createOrientationError('EMPTY_FILE', {
            message: parseSkipped
                ? `لم يتم العثور على سجلات توجيه صالحة (${parseSkipped} متجاوز). لم يُحفظ أي سجل.`
                : 'لم يتم العثور على سجلات توجيه صالحة. لم يُحفظ أي سجل.',
            details: { parseSkipped, skipReasons: skipReasonsToList(skipBucket) },
            noRecordsSaved: true
        });
    }

    // Validate required fields + stamp school_year; normalize code for dedupe
    const validated = [];
    let validationSkipped = 0;
    for (const row of rows) {
        const code = normalizeStudentCode(row.student_code);
        if (!code) {
            validationSkipped += 1;
            pushSkipReason(skipBucket, {
                code: 'MISSING_STUDENT_CODE',
                reason: 'missing_code',
                message: 'رمز التلميذ مفقود'
            });
            continue;
        }
        const origin = String(row.origin_stream || '').trim();
        if (!origin) {
            validationSkipped += 1;
            pushSkipReason(skipBucket, {
                code: 'MISSING_ORIGIN_STREAM',
                reason: 'missing_origin_stream',
                message: 'الشعبة الأصلية مفقودة'
            });
            continue;
        }
        const avgParsed = parseOrientationNumericStrict(row.average);
        const rankParsed = parseOrientationNumericStrict(row.rank_num);
        if (avgParsed.invalid) {
            pushSkipReason(skipBucket, {
                code: 'INVALID_NUMERIC_VALUE',
                reason: 'invalid_average',
                message: 'معدل غير رقمي (تم تجاهل القيمة فقط)'
            });
        }
        if (rankParsed.invalid) {
            pushSkipReason(skipBucket, {
                code: 'INVALID_NUMERIC_VALUE',
                reason: 'invalid_rank',
                message: 'رتبة غير رقمية (تم تجاهل القيمة فقط)'
            });
        }
        validated.push({
            ...row,
            student_code: code,
            origin_stream: origin,
            average: avgParsed.invalid ? null : avgParsed.value,
            rank_num: rankParsed.invalid ? null : rankParsed.value,
            school_year: year
        });
    }

    const preIpcSkipped = (Number(parseSkipped) || 0) + validationSkipped;

    if (!validated.length) {
        throw createOrientationError('EMPTY_FILE', {
            message: 'كل السجلات غير صالحة بعد التحقق. لم يُحفظ أي سجل.',
            details: { skipReasons: skipReasonsToList(skipBucket) },
            noRecordsSaved: true
        });
    }

    // Deduplicate by normalized student_code (last valid wins); count duplicatesInFile
    const byCode = new Map();
    let duplicatesInFile = 0;
    for (const row of validated) {
        if (byCode.has(row.student_code)) duplicatesInFile += 1;
        byCode.set(row.student_code, row);
    }
    const deduped = Array.from(byCode.values());

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let skipped = preIpcSkipped;
    const ipcSkipDetails = [];
    let wroteAny = false;

    for (let i = 0; i < deduped.length; i += 500) {
        const batch = deduped.slice(i, i + 500);
        let result;
        try {
            result = await window.api.orientation.bulkUpsert({
                rows: batch,
                schoolYear: year
            });
        } catch (ipcEx) {
            // IPC channel throw / transport failure (distinct from success:false rejection payload)
            const partial = inserted + updated + unchanged;
            if (partial > 0) {
                // Partial progress + failed batch (FR-011a): prior batches committed; this batch did not
                const summary = `جديد: ${inserted} · محدّث: ${updated} · دون تغيير: ${unchanged}`;
                throw createOrientationError('IMPORT_ROLLBACK', {
                    message: `${orientationDefaultMessage('IMPORT_ROLLBACK')} تقدّم سابق: ${summary}. أعد الاستيراد (الدمج آمن) — لم تُلغَ الدفعات الناجحة.`,
                    details: {
                        inserted,
                        updated,
                        unchanged,
                        skipped,
                        duplicatesInFile,
                        schoolYear: year
                    },
                    noRecordsSaved: false,
                    retryable: true
                });
            }
            const code =
                ipcEx?.code === 'SYNC_ERROR'
                    ? 'SYNC_ERROR'
                    : orientationCodeKnown(ipcEx?.code)
                      ? ipcEx.code
                      : /sync|outbox|capture/i.test(String(ipcEx?.message || ''))
                        ? 'SYNC_ERROR'
                        : 'DATABASE_ERROR';
            throw createOrientationError(code, {
                message: orientationUserMessage(
                    createOrientationError(code, {
                        noRecordsSaved: true
                    })
                ),
                details: { phase: 'ipc_exception' },
                noRecordsSaved: true
            });
        }

        // IPC rejection payload (handler returned success: false)
        if (!result || result.success === false) {
            const partial = inserted + updated + unchanged;
            const errCode =
                result?.code && orientationCodeKnown(result.code)
                    ? result.code
                    : /sync|outbox|capture/i.test(String(result?.error || result?.message || ''))
                      ? 'SYNC_ERROR'
                      : 'DATABASE_ERROR';
            if (partial > 0) {
                const summary = `جديد: ${inserted} · محدّث: ${updated} · دون تغيير: ${unchanged}`;
                throw createOrientationError('IMPORT_ROLLBACK', {
                    message: `${orientationDefaultMessage('IMPORT_ROLLBACK')} تقدّم سابق: ${summary}. أعد الاستيراد (الدمج آمن) — لم تُلغَ الدفعات الناجحة.`,
                    details: {
                        inserted,
                        updated,
                        unchanged,
                        ipcCode: result?.code || null,
                        schoolYear: year
                    },
                    noRecordsSaved: false,
                    retryable: true
                });
            }
            throw createOrientationError(errCode, {
                message:
                    (result?.error || result?.message) &&
                    /[\u0600-\u06FF]/.test(String(result.error || result.message))
                        ? String(result.error || result.message)
                        : orientationDefaultMessage(errCode),
                details: result?.details || { phase: 'ipc_rejection' },
                noRecordsSaved: true,
                retryable: orientationIsRetryable(errCode)
            });
        }

        inserted += Number(result.inserted) || 0;
        updated += Number(result.updated) || 0;
        unchanged += Number(result.unchanged) || 0;
        skipped += Number(result.skipped) || 0;
        if (Number(result.inserted) || Number(result.updated)) wroteAny = true;
        if (Array.isArray(result.details)) {
            for (const d of result.details) {
                if (d?.outcome === 'skipped') {
                    pushSkipReason(skipBucket, {
                        code:
                            d.reason === 'missing_code'
                                ? 'MISSING_STUDENT_CODE'
                                : d.reason === 'missing_origin_stream'
                                  ? 'MISSING_ORIGIN_STREAM'
                                  : d.reason === 'year_mismatch'
                                    ? 'SCHOOL_YEAR_MISMATCH'
                                    : 'INVALID_RECORD',
                        reason: d.reason || 'skipped',
                        message: d.message || 'سجل متجاوز'
                    });
                    if (ipcSkipDetails.length < 40) ipcSkipDetails.push(d);
                }
            }
        }
    }

    const imported = inserted + updated;
    const totalCount = inserted + updated + unchanged;
    const skipReasons = skipReasonsToList(skipBucket);

    DataSourceRegistry.update(
        'orientation',
        year,
        {
            count: totalCount || imported,
            source: extracted.source || (isOrientationJsonFile(file) ? 'json' : 'xlsx'),
            inserted,
            updated,
            unchanged,
            skipped,
            duplicatesInFile
        },
        []
    );

    if (typeof console !== 'undefined') {
        console.info(
            `[orientation-import] schoolYear=${year} inserted=${inserted} updated=${updated} unchanged=${unchanged} skipped=${skipped} duplicatesInFile=${duplicatesInFile} wroteAny=${wroteAny}`,
            skipReasons
        );
    }

    return {
        success: true,
        imported,
        inserted,
        updated,
        unchanged,
        skipped,
        duplicatesInFile,
        schoolYear: year,
        skipReasons,
        details: ipcSkipDetails
    };
}

/** Build a concise Arabic summary line for orientation import results. */
function formatOrientationImportSummary(res) {
    if (!res) return '';
    const parts = [
        `جديد: ${Number(res.inserted) || 0}`,
        `محدّث: ${Number(res.updated) || 0}`,
        `دون تغيير: ${Number(res.unchanged) || 0}`,
        `متجاوز: ${Number(res.skipped) || 0}`
    ];
    if (Number(res.duplicatesInFile) > 0) {
        parts.push(`تكرار داخل الملف: ${res.duplicatesInFile}`);
    }
    if (res.schoolYear) parts.push(`الموسم: ${res.schoolYear}`);
    const reasons = Array.isArray(res.skipReasons) ? res.skipReasons.slice(0, 4) : [];
    if (reasons.length) {
        parts.push(
            'أسباب التجاوز: ' +
                reasons.map((r) => `${r.message || r.reason} (${r.count})`).join(' · ')
        );
    }
    return parts.join(' · ');
}
