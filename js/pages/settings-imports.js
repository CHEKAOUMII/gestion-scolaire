const FILE_INPUTS = {
    students: 'students-file-input',
    grades: 'grades-file-input',
    absences: 'absences-file-input',
    fet: 'fet-file-input',
    'student-status': 'status-file-input',
    'agent-xml': 'agent-xml-file-input'
};
const ACTION_LABELS = {
    students: 'لائحة التلاميذ',
    grades: 'النقط',
    absences: 'الغياب',
    fet: 'FET',
    'student-status': 'الوضعيات الدراسية',
    'agent-xml': 'ملف الوزارة'
};

const XLSX_CDN = 'vendor/xlsx.full.min.js';
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

function getBaseClassName(className) {
    if (!className) return '';
    return String(className)
        .replace(/:[Gg]\d+$/g, '')
        .trim();
}

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
            const map = { 1: 'students', 2: 'grades', 3: 'absences', 4: 'fet' };
            const action = map[e.key];
            if (action) {
                e.preventDefault();
                runImport(action);
            }
        });

        // Semester selector change -> refresh stats
        document.getElementById('semester-select')?.addEventListener('change', () => loadDataStats());

        // Delete buttons
        document.getElementById('btn-clear-students')?.addEventListener('click', () => clearData('students'));
        document.getElementById('btn-clear-grades')?.addEventListener('click', () => clearData('grades'));
        document.getElementById('btn-clear-absences')?.addEventListener('click', () => clearData('absences'));
        document.getElementById('btn-clear-timetable')?.addEventListener('click', () => clearData('timetable'));
        document.getElementById('btn-clear-teachers')?.addEventListener('click', () => clearData('teachers'));
        document.getElementById('btn-clear-status')?.addEventListener('click', () => clearData('status'));
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
                    createBackupBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإنشاء...';
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
                    createBackupBtn.innerHTML = '<i class="fas fa-download"></i> إنشاء نسخة احتياطية';
                }
            });
        }

        if (restoreBackupBtn && backupFileInput && typeof BackupManager !== 'undefined') {
            restoreBackupBtn.addEventListener('click', () => backupFileInput.click());
            backupFileInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                if (!confirm('سيتم استبدال جميع البيانات الحالية بالنسخة الاحتياطية. هل أنت متأكد؟')) {
                    backupFileInput.value = '';
                    return;
                }
                try {
                    restoreBackupBtn.disabled = true;
                    restoreBackupBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الاستعادة...';
                    const result = await BackupManager.restoreFromFile(file);
                    showToast('تم استعادة النسخة الاحتياطية بنجاح (' + result.restoredItems + ' عنصر)', 'success');
                    setTimeout(() => location.reload(), 1500);
                } catch (err) {
                    showToast(err.message || 'فشل استعادة النسخة الاحتياطية', 'error');
                } finally {
                    restoreBackupBtn.disabled = false;
                    restoreBackupBtn.innerHTML = '<i class="fas fa-upload"></i> استعادة نسخة سابقة';
                    backupFileInput.value = '';
                }
            });
        }

        await Promise.all([loadLogs(), loadDataStats()]);
        renderTafwijWarningBanner();
        await restorePendingTafwijStateFromStorage();
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
        const semesterLabel =
            action === 'grades'
                ? `<br><span style="color:var(--primary);font-weight:600;">📌 سيتم تحديد الدورة تلقائياً من الملف</span>`
                : '';
        if (safeFiles.length === 1) {
            const fileName = escapeConfirmText(safeFiles[0]?.name || 'الملف المحدد');
            message.innerHTML = `هل تريد استيراد ${label} من الملف:<br><strong>${fileName}</strong>؟${semesterLabel}`;
        } else {
            const preview = safeFiles
                .slice(0, 4)
                .map((f) => escapeConfirmText(f.name))
                .join('، ');
            const more = safeFiles.length > 4 ? ` ... (+${safeFiles.length - 4})` : '';
            message.innerHTML = `هل تريد استيراد ${label} بشكل جماعي من <strong>${safeFiles.length}</strong> ملفات؟<br>${preview}${more}${semesterLabel}`;
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

function hideTafwijMatchingPanel() {
    const panel = document.getElementById('tafwij-matching-panel');
    const banner = document.getElementById('tafwij-warning-banner');
    if (panel) panel.style.display = 'none';
    if (banner && !pendingTafwijImportState) banner.style.display = 'none';
}

function renderTafwijWarningBanner() {
    const banner = document.getElementById('tafwij-warning-banner');
    if (!banner) return;
    const timetableRaw = localStorage.getItem('timetableData');
    if (!timetableRaw) {
        banner.style.display = 'none';
        return;
    }
    try {
        const parsed = JSON.parse(timetableRaw);
        const unresolvedCount = Array.isArray(parsed?.unresolvedTeacherKeys) ? parsed.unresolvedTeacherKeys.length : 0;
        if (!unresolvedCount) {
            banner.style.display = 'none';
            return;
        }
        banner.style.display = 'block';
        banner.innerHTML = `<i class="fas fa-exclamation-triangle"></i> يوجد ${unresolvedCount} اسم من ملف tafwij لم تتم مطابقته بعد. يمكن متابعة العمل مؤقتاً، لكن بعض الربط مع الحصص أو الغياب قد يبقى غير مكتمل. <button type="button" id="tafwij-open-matching-btn" class="btn btn-secondary" style="margin-inline-start:10px;padding:6px 12px;">مراجعة الآن</button>`;
    } catch {
        banner.style.display = 'none';
    }
}

async function restorePendingTafwijStateFromStorage() {
    try {
        const raw = localStorage.getItem('timetableData');
        if (!raw) return;
        const parsed = JSON.parse(raw);
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

function buildTafwijStoragePayload(state, resolutionOverrides = new Map(), keepUnresolved = true) {
    const teacherMetaByKey = {};
    const timetables = {};
    const unresolvedTeacherKeys = [];
    const subjects = new Set();
    const classes = new Set();
    const currentStorageRaw = localStorage.getItem('timetableData');
    let currentStorage = null;
    try {
        currentStorage = currentStorageRaw ? JSON.parse(currentStorageRaw) : null;
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
    if (panel) panel.style.display = 'none';
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
        panel.style.display = 'none';
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
                            <div style="color:var(--text-secondary);font-size:12px;">${escapeHtml(entry.sourceName)}</div>
                        </td>
                        <td>${entry.candidates?.length > 1 ? 'متعدد' : 'غير مطابق'}</td>
                        <td>
                            <div style="display:flex;flex-direction:column;gap:8px;">
                                <div style="color:var(--text-secondary);font-size:12px;">${hint}</div>
                                <div style="color:var(--text-secondary);font-size:12px;">${
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

    panel.style.display = 'block';
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

    const dataToSave = buildTafwijStoragePayload(state, selectionMap, keepUnresolved);
    localStorage.setItem('timetableData', JSON.stringify(dataToSave));
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
        overlay.style.cssText =
            'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;direction:rtl;';

        overlay.innerHTML = `
        <div style="background:#1e293b;border:1px solid #f59e0b;border-radius:12px;padding:28px 32px;max-width:420px;width:90%;box-shadow:0 20px 50px rgba(0,0,0,0.5);font-family:'Tajawal',sans-serif;color:#f1f5f9;">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
                <i class="fas fa-exclamation-triangle" style="font-size:28px;color:#f59e0b;"></i>
                <h3 style="margin:0;font-size:18px;color:#fde68a;">تحذير: تعارض في الموسم الدراسي</h3>
            </div>
            <p style="margin:0 0 8px;line-height:1.7;color:#cbd5e1;">
                الملف المستورَد يبدو أنه يخص الموسم الدراسي:
                <strong style="color:#fde68a;font-size:16px;"> ${detectedYear} </strong>
            </p>
            <p style="margin:0 0 20px;line-height:1.7;color:#cbd5e1;">
                بينما الموسم المختار حالياً هو:
                <strong style="color:#6ee7b7;font-size:16px;"> ${selectedYear} </strong>
            </p>
            <p style="margin:0 0 24px;font-size:13px;color:#94a3b8;">
                إذا واصلت، ستُخزَّن البيانات تحت الموسم <strong style="color:#6ee7b7;">${selectedYear}</strong>.
                إذا أردت حفظها تحت <strong style="color:#fde68a;">${detectedYear}</strong>، ألغِ وغيّر الموسم أولاً.
            </p>
            <div style="display:flex;gap:12px;justify-content:flex-end;">
                <button id="ym-cancel" style="padding:10px 20px;border:1px solid #475569;background:transparent;color:#94a3b8;border-radius:8px;cursor:pointer;font-size:14px;font-family:inherit;transition:all 0.2s;">
                    إلغاء — سأغير الموسم
                </button>
                <button id="ym-proceed" style="padding:10px 20px;border:none;background:#f59e0b;color:#1e293b;border-radius:8px;cursor:pointer;font-weight:bold;font-size:14px;font-family:inherit;transition:all 0.2s;">
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

function inferImportActionFromFiles(files) {
    const safeFiles = Array.isArray(files) ? files : [];
    if (!safeFiles.length) return '';

    const names = safeFiles.map((f) => String(f?.name || '').toLowerCase());
    const hasXml = names.some((n) => n.endsWith('.xml'));
    if (hasXml) {
        // DsAgentExport files typically start with a school code pattern (e.g. 14007Z_20260309.xml)
        if (names.some((n) => /^\d{4,6}[a-z]?_/i.test(n))) return 'agent-xml';
        return 'fet';
    }

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
        const timetableRaw = localStorage.getItem('timetableData');
        const timetable = timetableRaw ? JSON.parse(timetableRaw) : null;
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
        status: 'الوضعيات الدراسية'
    };
    const label = labels[type] || type;
    const message =
        type === 'timetable'
            ? `هل تريد حذف ${label}؟`
            : type === 'status'
              ? `هل تريد إعادة جميع الوضعيات إلى "نشط" للموسم ${schoolYear}؟`
              : `هل تريد حذف ${label} الخاصة بالموسم ${schoolYear}؟`;

    const confirmed = await showActionConfirm(message);
    if (!confirmed) return;

    try {
        if (type === 'students') {
            if (!window.api?.students?.deleteByYear) throw new Error('ميزة حذف التلاميذ غير متاحة في هذا الإصدار');
            const res = await window.api.students.deleteByYear(schoolYear);
            if (!res || res.success === false) throw new Error(res?.error || 'تعذر حذف بيانات التلاميذ');
        } else if (type === 'grades') {
            if (!window.api?.grades?.deleteBySemester) {
                throw new Error('ميزة حذف النقط حسب الدورة غير متاحة في هذا الإصدار');
            }
            const res = await window.api.grades.deleteBySemester(schoolYear, semester);
            if (!res || res.success === false) throw new Error(res?.error || 'تعذر حذف النقط');
        } else if (type === 'absences') {
            const res = await window.api.absences.deleteByYear(schoolYear);
            if (!res || res.success === false) throw new Error(res?.error || 'تعذر حذف الغياب');
        } else if (type === 'timetable') {
            localStorage.removeItem('timetableData');
            pendingTafwijImportState = null;
            hideTafwijMatchingPanel();
            renderTafwijWarningBanner();
        } else if (type === 'teachers') {
            if (!window.api?.teachers?.deleteByYear) throw new Error('ميزة حذف الأساتذة غير متاحة في هذا الإصدار');
            const res = await window.api.teachers.deleteByYear(schoolYear);
            if (!res || res.success === false) throw new Error(res?.error || 'تعذر حذف بيانات الأساتذة');
        } else if (type === 'status') {
            if (!window.api?.students?.updateStatusBulk) throw new Error('ميزة مسح الوضعيات غير متاحة في هذا الإصدار');
            const statusRes = await window.api.students.getByStatus({ school_year: schoolYear });
            const rows = statusRes?.rows || [];
            if (rows.length) {
                const items = rows.map((r) => ({ id: r.id, status: 'active' }));
                const res = await window.api.students.updateStatusBulk(items);
                if (!res || res.success === false) throw new Error(res?.error || 'تعذر مسح الوضعيات');
            }
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
                    fetImportResult = await importFetXml(file);
                    totalImported += Number(fetImportResult?.teachersCount) || Number(fetImportResult) || 0;
                } else if (action === 'agent-xml') {
                    totalImported += await importAgentXml(file);
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
                        totalImported += await importStudents(workbook, year);
                    } else if (action === 'grades') {
                        const gradeResult = await importGrades(workbook, year, file.name);
                        totalGradesImported += gradeResult.gradesCount;
                        gradeResult.studentCodes.forEach((code) => importedStudentsCodes.add(code));
                        totalImported = totalGradesImported;
                        if (gradeResult.semester) detectedSemester = gradeResult.semester;
                    } else if (action === 'absences') {
                        totalImported += await importAbsences(workbook, year);
                    } else if (action === 'student-status') {
                        totalImported += await importStudentStatus(workbook, year);
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
        const logDetails = `استيراد ${totalImported} ${unit}${gradesStudentsSummary}${fetSummary} من ${fileList.length} ${fileWord}${batchStatus}`;
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
                ? `اكتمل الاستيراد: ${totalImported} ${unit} (${importedStudentsCodes.size} تلميذ — ${semesterName})`
                : action === 'fet' && fetImportResult?.unresolvedCount
                  ? `اكتمل الاستيراد: ${totalImported} ${unit} مع ${fetImportResult.unresolvedCount} اسم غير محسوم مؤقتاً`
                  : `اكتمل الاستيراد: ${totalImported} ${unit}`
        );
        hideImportProgress(900);
        const finalMessage =
            action === 'grades'
                ? `تم استيراد ${totalImported} ${unit} تخص ${importedStudentsCodes.size} تلميذ (${semesterName}) من ${fileList.length} ${fileWord}`
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

    const res = await window.api.students.addBulk(deduped);
    if (!res || res.success === false) throw new Error(res?.error || 'فشل حفظ بيانات التلاميذ');
    return deduped.length;
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
    const studentCodes = [...new Set(grades.map((g) => String(g.student_code || '').trim()).filter(Boolean))];
    return { gradesCount: grades.length, studentsCount: studentCodes.length, studentCodes, semester: detectedSemester };
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
        reader.onload = async (e) => {
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

                        if (!timetable[arabicDay]) {
                            timetable[arabicDay] = {
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
                    const partialData = buildTafwijStoragePayload(pendingTafwijImportState, new Map(), true);
                    localStorage.setItem('timetableData', JSON.stringify(partialData));
                    renderTafwijMatchingPanel();
                    renderTafwijWarningBanner();
                    resolve({
                        teachersCount: fetEntries.length,
                        unresolvedCount: unresolvedEntries.length,
                        requiresReview: true
                    });
                    return;
                }

                const dataToSave = buildTafwijStoragePayload(
                    {
                        schoolYear: getCurrentSchoolYear(),
                        entries: fetEntries,
                        allTeachers
                    },
                    new Map(),
                    true
                );
                localStorage.setItem('timetableData', JSON.stringify(dataToSave));
                renderTafwijWarningBanner();
                console.log('FET data saved to localStorage:', fetEntries.length, 'teachers');

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

                // ── Build ACTIVITE map: PPR → first activity details ──
                const activiteMap = new Map();
                xmlDoc.querySelectorAll('ACTIVITE').forEach((el) => {
                    const ppr = el.querySelector('PPR')?.textContent?.trim();
                    if (!ppr || activiteMap.has(ppr)) return;
                    activiteMap.set(ppr, {
                        cd_fonc: el.querySelector('CD_FONC')?.textContent?.trim() || '',
                        cd_etab: el.querySelector('CD_ETAB')?.textContent?.trim() || '',
                        cd_activites: el.querySelector('CD_ACTIVITES')?.textContent?.trim() || '',
                        dateaffect: el.querySelector('DATEAFFECT')?.textContent?.trim() || ''
                    });
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
                    const isSurplus = cdFonc === 'E002' || /surnombre/i.test(fonctionLabelFr || '');

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
