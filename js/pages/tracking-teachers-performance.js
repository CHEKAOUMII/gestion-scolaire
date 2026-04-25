/* ═══════════════════════════════════════════════════════
   Tracking Teachers Performance – متابعة أداء الأساتذة
   Lighter version: no detailed table, no comparison/absence block.
   Teacher-specific data with meaningful empty states.
   ═══════════════════════════════════════════════════════ */

const DEFAULT_YEAR = getSchoolYear();
const CHART_JS_CDN = 'vendor/chart.min.js';

let chartLoaderPromise = null;
let allGradesCache = [];
let allAbsencesCache = [];
let sectionToLevel = {};
let teacherRowsCache = [];
let selectedTeacherName = '';
let lastBaseFiltered = [];

const charts = {};
let currentSubjectFilter = '';
let _compRecordsCache = [];
let _supportSessionsCache = [];
let _filterManager = null;
const BASE_PAGE_TITLE = 'تتبع أداء الأستاذ(ة)';

const gradeBands = [
    { label: 'ممتاز (16-20)', min: 16, max: 20, color: 'rgba(47, 179, 109, 0.85)' },
    { label: 'جيد (14-16)', min: 14, max: 15.99, color: 'rgba(105, 103, 190, 0.85)' },
    { label: 'حسن (12-14)', min: 12, max: 13.99, color: 'rgba(134, 101, 181, 0.85)' },
    { label: 'مقبول (10-12)', min: 10, max: 11.99, color: 'rgba(240, 194, 14, 0.85)' },
    { label: 'غير كافٍ (0-10)', min: 0, max: 9.99, color: 'rgba(231, 76, 60, 0.85)' }
];

/* ─── Init ─── */
document.addEventListener('DOMContentLoaded', async () => {
    try {
        bindEvents();
        overridePrintPreviewHandler();
        await loadInitialData();
        await runAnalysis();
    } catch (error) {
        console.error('Tracking teacher performance init error:', error);
        showToast('تعذر تحميل مؤشرات الأداء', 'error');
    }
});

/* ─── Events ─── */
function bindEvents() {
    const analyzeBtn = document.getElementById('tp-analyze-btn');
    const resetBtn = document.getElementById('tp-reset-btn');
    const subjectFilter = document.getElementById('tp-subject-filter');
    const semesterFilter = document.getElementById('tp-semester-filter');
    const teacherFilter = document.getElementById('tp-teacher-filter');
    const exportBtn = document.getElementById('tp-export-btn');

    if (analyzeBtn) analyzeBtn.addEventListener('click', () => runAnalysis());
    if (resetBtn)
        resetBtn.addEventListener('click', () => {
            if (_filterManager) _filterManager.reset();
            if (semesterFilter) semesterFilter.value = '';
            selectedTeacherName = '';
            renderSemesterFilter();
            renderTeacherFilter();
            runAnalysis();
        });

    // Subject filter cascading
    if (subjectFilter)
        subjectFilter.addEventListener('change', () => {
            renderSemesterFilter();
            renderTeacherFilter();
        });
    if (semesterFilter) semesterFilter.addEventListener('change', () => renderTeacherFilter());

    if (teacherFilter)
        teacherFilter.addEventListener('change', () => {
            selectedTeacherName = teacherFilter.value;
            runAnalysis();
        });

    // Export
    if (exportBtn) exportBtn.addEventListener('click', exportReport);

    // Print preview (shared system)
    const printPreviewBtn = document.getElementById('tp-print-preview-btn');
    if (printPreviewBtn)
        printPreviewBtn.addEventListener('click', () => {
            PrintSystem.preview({ title: 'متابعة أداء الأساتذة', pageSize: 'A4', landscape: false });
        });

}

/* ─── Data Loading ─── */
function getSelectedTeacherDisplayName() {
    const teacherSelect = document.getElementById('tp-teacher-filter');
    if (!teacherSelect) return '';
    return String(teacherSelect.options?.[teacherSelect.selectedIndex]?.textContent || '').trim();
}

function getTrackingPageTitle() {
    const teacherName = getSelectedTeacherDisplayName();
    return teacherName ? `${BASE_PAGE_TITLE} - ${teacherName}` : BASE_PAGE_TITLE;
}

function updateTrackingPageTitle() {
    const title = getTrackingPageTitle();
    const titleNode = document.getElementById('tp-page-title');
    if (titleNode) {
        titleNode.innerHTML = `<i class="fas fa-chart-line"></i> ${title}`;
    }
    document.title = `${title} | برنامج التدبير المدرسي`;
}

function overridePrintPreviewHandler() {
    const oldButton = document.getElementById('tp-print-preview-btn');
    if (!oldButton || !oldButton.parentNode) return;
    const newButton = oldButton.cloneNode(true);
    oldButton.parentNode.replaceChild(newButton, oldButton);
    newButton.addEventListener('click', () => {
            PrintSystem.preview({ title: getTrackingPageTitle(), pageSize: 'A4', landscape: false });
        });
}

async function getCurrentYear() {
    try {
        if (typeof window.api?.settings?.get === 'function') {
            const stored = await window.api.settings.get('schoolYear');
            if (stored) return stored;
        }
    } catch (_) {
        /* fallback to default */
    }
    return DEFAULT_YEAR;
}

async function loadInitialData() {
    const year = await getCurrentYear();

    _filterManager = new FilterManager({
        selectors: {
            subject: 'tp-subject-filter'
        },
        subjectsFromGrades: true,
        year
    });
    await _filterManager.init();

    const fmData = _filterManager.getData();
    allGradesCache = fmData.grades;
    sectionToLevel = _filterManager._levelsMapping || {};

    const absencesRaw = await window.api.absences?.getAll?.(year).catch(() => []) ?? [];
    allAbsencesCache = (absencesRaw || []).map((a) => ({
        ...a,
        _hours: Number(a.hours) || 0,
        _section: String(a.section || '').trim()
    }));

    allGradesCache = allGradesCache
        .map((grade) => {
            const value = Number(grade.grade);
            if (!Number.isFinite(value)) return null;
            const subjectRaw = String(grade.subject || '').trim();
            const teacherRaw = String(grade.teacher_name || '').trim();
            const cleanTeacher = sanitizeTeacherName(teacherRaw);
            const teacherId = Number(grade.teacher_id) || null;
            const teacherKey = teacherId ? `id:${teacherId}` : cleanTeacher ? `name:${cleanTeacher}` : '';
            return {
                ...grade,
                grade: value,
                _subjectRaw: subjectRaw,
                _subject: normalizeSubjectName(subjectRaw),
                _teacherRaw: teacherRaw,
                _teacherId: teacherId,
                _teacherKey: teacherKey,
                _teacher: cleanTeacher,
                _level: _getLocalLevelName(grade.section),
                _examNo: extractExamNumber(subjectRaw),
                _createdAtMs: parseDateMs(grade.created_at)
            };
        })
        .filter(Boolean);

    renderSemesterFilter();
    renderTeacherFilter();

    // Load compensation and support data
    loadCompensationAndSupportData().catch((err) => console.warn('comp/support load error:', err));
}

function renderSemesterFilter() {
    const subject = document.getElementById('tp-subject-filter')?.value || '';
    const s = document.getElementById('tp-semester-filter');
    if (!s) return;
    const prev = s.value;
    const semesters = Array.from(
        new Set(
            allGradesCache
                .filter((g) => !subject || g._subject === subject)
                .map((g) => Number(g.semester))
                .filter((n) => Number.isFinite(n) && n > 0)
        )
    ).sort((a, b) => a - b);
    s.innerHTML = '<option value="">كل الدورات</option>';
    semesters.forEach((sem) => {
        const o = document.createElement('option');
        o.value = String(sem);
        o.textContent = `الدورة ${sem}`;
        s.appendChild(o);
    });
    if (prev && semesters.includes(Number(prev))) s.value = prev;
}

function renderTeacherFilter() {
    const base = getBaseFilteredGrades();
    const s = document.getElementById('tp-teacher-filter');
    if (!s) return;
    const prev = s.value || selectedTeacherName;

    // Build unique teacher list from filtered grades (no "all" option)
    const teacherMap = new Map();
    base.forEach((g) => {
        if (g._teacher && g._teacherKey && !teacherMap.has(g._teacherKey)) {
            teacherMap.set(g._teacherKey, g._teacher);
        }
    });

    const sorted = Array.from(teacherMap.entries()).sort((a, b) => a[1].localeCompare(b[1], 'ar'));

    s.innerHTML = '';
    sorted.forEach(([key, name]) => {
        const o = document.createElement('option');
        o.value = key;
        o.textContent = name;
        s.appendChild(o);
    });

    // Restore previous selection or auto-select first
    if (prev && teacherMap.has(prev)) {
        s.value = prev;
        selectedTeacherName = prev;
    } else if (sorted.length) {
        s.value = sorted[0][0];
        selectedTeacherName = sorted[0][0];
    } else {
        selectedTeacherName = '';
    }

    updateTrackingPageTitle();
}

/* ─── Utility Functions ─── */
function _getLocalLevelName(section) {
    if (_filterManager) return _filterManager._getLocalLevelName(section);
    const s = String(section || '').trim();
    if (!s) return '';
    if (sectionToLevel[s]) return sectionToLevel[s];
    return getLevelNameFromSection(s);
}

function getBaseFilteredGrades() {
    const subject = document.getElementById('tp-subject-filter')?.value || '';
    const semester = Number(document.getElementById('tp-semester-filter')?.value || 0);
    return allGradesCache.filter((g) => {
        if (subject && g._subject !== subject) return false;
        if (semester && Number(g.semester) !== semester) return false;
        return true;
    });
}

function studentIdentity(record) {
    return String(record.student_id || record.student_code || record.full_name || 'غير محدد');
}

function normalizeLoose(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/[\u064B-\u065F]/g, '')
        .replace(/[^a-z0-9\u0600-\u06FF]+/g, '');
}

function sanitizeTeacherName(value) {
    const raw = String(value || '')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!raw) return '';
    if (/^\d+([.,]\d+)?$/.test(raw)) return '';
    if (/^(TCS|[12]BAC[A-Z]*)\s*[-_]?\s*\d*$/i.test(raw.replace(/\s+/g, ''))) return '';
    const normalized = normalizeLoose(raw);
    if (!normalized) return '';
    const invalidExact = new Set(
        [
            'teacher', 'teachername', 'enseignant', 'prof', 'professeur',
            'استاذ', 'الاستاذ', 'الأستاذ', 'اساتذ', 'ملاحظات', 'ملاحظة',
            'ملاحظاتالاستاذ', 'ملاحظاتالأستاذ', 'notes', 'note', 'observation',
            'observations', 'comment', 'comments', 'remarque', 'remarques',
            'غيرمحدد', 'unknown', 'na', 'n/a'
        ].map(normalizeLoose)
    );
    if (invalidExact.has(normalized)) return '';
    const invalidContains = ['ملاحظات', 'ملاحظة', 'observation', 'comment', 'remarque', 'notes', 'note'].map(
        normalizeLoose
    );
    if (invalidContains.some((token) => normalized.includes(token))) return '';
    return raw;
}

function parseDateMs(value) {
    if (!value) return 0;
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.getTime() : 0;
}

function formatDateTime(value, fallbackRaw = '') {
    const ms = Number(value) || parseDateMs(fallbackRaw);
    if (!ms) return '-';
    return new Date(ms).toLocaleString('ar-MA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function avg(values) {
    if (!values.length) return 0;
    return values.reduce((s, n) => s + n, 0) / values.length;
}
function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function stdDev(values) {
    if (values.length < 2) return 0;
    const m = avg(values);
    return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
}
function percentage(part, whole) {
    if (!whole) return 0;
    return (part / whole) * 100;
}
function toLatinDigits(input) {
    return String(input || '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

function extractExamNumber(subjectRaw) {
    const normalized = toLatinDigits(subjectRaw);
    const match = normalized.match(/فرض\s*(\d+)/i);
    if (!match) return null;
    const v = Number(match[1]);
    return Number.isFinite(v) && v > 0 ? v : null;
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function csvEscape(value) {
    const str = String(value ?? '');
    return '"' + str.replace(/"/g, '""') + '"';
}

/* ─── Loading Overlay ─── */
function showLoading() {
    const el = document.getElementById('tp-loading-overlay');
    if (el) el.classList.add('active');
}

function hideLoading() {
    const el = document.getElementById('tp-loading-overlay');
    if (el) el.classList.remove('active');
}

/* ─── Teacher Rating ─── */
function getTeacherRating(avgScore, passRate) {
    if (avgScore >= 14 && passRate >= 85)
        return { label: 'ممتاز', stars: '⭐⭐⭐', cls: 'tp-rating-excellent', value: 4 };
    if (avgScore >= 12 && passRate >= 70) return { label: 'جيد', stars: '⭐⭐', cls: 'tp-rating-good', value: 3 };
    if (avgScore >= 10 && passRate >= 50) return { label: 'مقبول', stars: '⭐', cls: 'tp-rating-average', value: 2 };
    return { label: 'يحتاج دعم', stars: '⚠️', cls: 'tp-rating-weak', value: 1 };
}

function getPassRatePillClass(rate) {
    if (rate >= 85) return 'tp-pill-excellent';
    if (rate >= 70) return 'tp-pill-good';
    if (rate >= 50) return 'tp-pill-average';
    return 'tp-pill-weak';
}

function getAvgPillClass(avgScore) {
    if (avgScore >= 14) return 'tp-pill-excellent';
    if (avgScore >= 12) return 'tp-pill-good';
    if (avgScore >= 10) return 'tp-pill-average';
    return 'tp-pill-weak';
}

/* ─── Build Teacher Rows ─── */
function buildTeacherRows(grades) {
    const byTeacher = new Map();
    grades.forEach((grade) => {
        const teacher = grade._teacher;
        const teacherKey = grade._teacherKey;
        if (!teacher || !teacherKey) return;
        let row = byTeacher.get(teacherKey);
        if (!row) {
            row = {
                teacherKey,
                teacher,
                sum: 0,
                count: 0,
                pass: 0,
                students: new Set(),
                sections: new Set(),
                subjects: new Set(),
                lastImportedMs: 0,
                gradeValues: [],
                sem1Grades: [],
                sem2Grades: []
            };
            byTeacher.set(teacherKey, row);
        }
        row.sum += grade.grade;
        row.count += 1;
        if (grade.grade >= 10) row.pass += 1;
        row.students.add(studentIdentity(grade));
        if (grade.section) row.sections.add(String(grade.section));
        if (grade._subject) row.subjects.add(grade._subject);
        if (grade._createdAtMs > row.lastImportedMs) row.lastImportedMs = grade._createdAtMs;
        row.gradeValues.push(grade.grade);
        const sem = Number(grade.semester);
        if (sem === 1) row.sem1Grades.push(grade.grade);
        else if (sem === 2) row.sem2Grades.push(grade.grade);
    });

    return Array.from(byTeacher.values()).map((row) => {
        const avgScore = row.count ? row.sum / row.count : 0;
        const passRate = row.count ? percentage(row.pass, row.count) : 0;
        const rating = getTeacherRating(avgScore, passRate);
        const sem1Avg = row.sem1Grades.length ? avg(row.sem1Grades) : null;
        const sem2Avg = row.sem2Grades.length ? avg(row.sem2Grades) : null;
        const semesterDiff = sem1Avg !== null && sem2Avg !== null ? sem2Avg - sem1Avg : null;
        return {
            teacher: row.teacher,
            teacherKey: row.teacherKey,
            avg: avgScore,
            passRate,
            gradeCount: row.count,
            studentCount: row.students.size,
            sectionsCount: row.sections.size,
            sections: Array.from(row.sections).sort((a, b) => a.localeCompare(b, 'ar')),
            subjects: Array.from(row.subjects).sort(
                typeof compareSubjects === 'function' ? compareSubjects : (a, b) => a.localeCompare(b, 'ar')
            ),
            lastImportedMs: row.lastImportedMs,
            gradeValues: row.gradeValues,
            rating,
            sem1Avg,
            sem2Avg,
            semesterDiff,
            sem1PassRate: row.sem1Grades.length
                ? percentage(row.sem1Grades.filter((g) => g >= 10).length, row.sem1Grades.length)
                : null,
            sem2PassRate: row.sem2Grades.length
                ? percentage(row.sem2Grades.filter((g) => g >= 10).length, row.sem2Grades.length)
                : null
        };
    });
}

/* ─── KPI Rendering ─── */
function renderKpis(baseFiltered, rows) {
    const container = document.getElementById('tp-kpis');
    if (!container) return;

    lastBaseFiltered = baseFiltered;

    if (!baseFiltered.length) {
        container.innerHTML = `<div class="tp-empty-state"><i class="fas fa-chart-line"></i><p>لا توجد نقاط مطابقة للفلاتر الحالية</p></div>`;
        return;
    }

    // Find selected teacher row
    const row = rows.find((r) => r.teacherKey === selectedTeacherName) || rows[0];
    if (!row) {
        container.innerHTML = `<div class="tp-empty-state"><i class="fas fa-user-slash"></i><p>لا يوجد أستاذ مختار</p></div>`;
        return;
    }

    // Rank among peers (same subject if single-subject teacher)
    const peerRows = row.subjects.length === 1
        ? rows.filter((r) => r.subjects.includes(row.subjects[0]))
        : rows;
    const sortedPeers = [...peerRows].sort((a, b) => b.avg - a.avg || b.passRate - a.passRate);
    const rank = sortedPeers.findIndex((r) => r.teacherKey === row.teacherKey) + 1;
    const peerLabel = row.subjects.length === 1 ? escapeHtml(row.subjects[0]) : 'كل المواد';

    // Semester diff display
    let semDiffHtml = '-';
    let semDiffSub = 'لا تتوفر بيانات الدورتين';
    if (row.semesterDiff !== null) {
        const arrow = row.semesterDiff > 0 ? '↑' : row.semesterDiff < 0 ? '↓' : '→';
        const sign = row.semesterDiff > 0 ? '+' : '';
        semDiffHtml = `${arrow} ${sign}${row.semesterDiff.toFixed(2)}`;
        semDiffSub = `د1: ${row.sem1Avg !== null ? row.sem1Avg.toFixed(2) : '-'} → د2: ${row.sem2Avg !== null ? row.sem2Avg.toFixed(2) : '-'}`;
    }

    // Student count for this teacher
    const teacherGrades = baseFiltered.filter((g) => g._teacherKey === row.teacherKey);
    const studentCount = new Set(teacherGrades.map(studentIdentity)).size;

    container.innerHTML = `
        <div class="tp-kpi">
            <div class="tp-kpi-icon"><i class="fas fa-calculator"></i></div>
            <div class="tp-kpi-label">المعدل العام</div>
            <div class="tp-kpi-value">${row.avg.toFixed(2)}</div>
            <div class="tp-kpi-sub">${row.gradeCount} نقطة · ${row.sectionsCount} قسم</div>
        </div>
        <div class="tp-kpi">
            <div class="tp-kpi-icon"><i class="fas fa-percentage"></i></div>
            <div class="tp-kpi-label">نسبة النجاح</div>
            <div class="tp-kpi-value">${row.passRate.toFixed(1)}%</div>
            <div class="tp-kpi-sub">نقطة النجاح: 10/20</div>
        </div>
        <div class="tp-kpi">
            <div class="tp-kpi-icon"><i class="fas fa-user-graduate"></i></div>
            <div class="tp-kpi-label">عدد التلاميذ</div>
            <div class="tp-kpi-value">${studentCount}</div>
            <div class="tp-kpi-sub">${row.subjects.length === 1 ? escapeHtml(row.subjects[0]) : row.subjects.length + ' مادة'}</div>
        </div>
        <div class="tp-kpi">
            <div class="tp-kpi-icon"><i class="fas fa-ranking-star"></i></div>
            <div class="tp-kpi-label">الترتيب</div>
            <div class="tp-kpi-value">${rank} / ${peerRows.length}</div>
            <div class="tp-kpi-sub">بين زملاء ${peerLabel}</div>
        </div>
        <div class="tp-kpi">
            <div class="tp-kpi-icon"><i class="fas fa-arrow-trend-up"></i></div>
            <div class="tp-kpi-label">تطور الدورات</div>
            <div class="tp-kpi-value">${semDiffHtml}</div>
            <div class="tp-kpi-sub">${semDiffSub}</div>
        </div>
        <div class="tp-kpi">
            <div class="tp-kpi-icon"><i class="fas fa-star"></i></div>
            <div class="tp-kpi-label">التصنيف</div>
            <div class="tp-kpi-value"><span class="tp-rating ${row.rating.cls}">${row.rating.stars} ${row.rating.label}</span></div>
            <div class="tp-kpi-sub">معدل ${row.avg.toFixed(2)} · نجاح ${row.passRate.toFixed(1)}%</div>
        </div>
    `;
}

function renderKpisBySubject(grades, container) {
    const bySubject = {};
    grades.forEach((g) => {
        if (!g._subject) return;
        if (!bySubject[g._subject]) bySubject[g._subject] = { grades: [], teachers: new Set(), students: new Set() };
        bySubject[g._subject].grades.push(g.grade);
        if (g._teacher) bySubject[g._subject].teachers.add(g._teacher);
        bySubject[g._subject].students.add(studentIdentity(g));
    });

    const subjects = Object.entries(bySubject).map(([subject, data]) => ({
        subject,
        avg: avg(data.grades),
        passRate: percentage(data.grades.filter((g) => g >= 10).length, data.grades.length),
        teacherCount: data.teachers.size,
        studentCount: data.students.size,
        gradeCount: data.grades.length
    }));

    if (!subjects.length) {
        container.innerHTML = `<div class="tp-empty-state"><i class="fas fa-book-open"></i><p>لا توجد مواد في الفلاتر الحالية</p></div>`;
        return;
    }

    const sortedByAvg = [...subjects].sort((a, b) => b.avg - a.avg);
    const best = sortedByAvg[0];
    const weakest = sortedByAvg[sortedByAvg.length - 1];
    const globalAvgSubjects = avg(subjects.map((s) => s.avg));

    container.innerHTML = `
        <div class="tp-kpi">
            <div class="tp-kpi-icon"><i class="fas fa-book-open"></i></div>
            <div class="tp-kpi-label">عدد المواد</div>
            <div class="tp-kpi-value">${subjects.length}</div>
            <div class="tp-kpi-sub">${grades.length} نقطة إجمالاً</div>
        </div>
        <div class="tp-kpi">
            <div class="tp-kpi-icon"><i class="fas fa-calculator"></i></div>
            <div class="tp-kpi-label">متوسط معدلات المواد</div>
            <div class="tp-kpi-value">${globalAvgSubjects.toFixed(2)}</div>
            <div class="tp-kpi-sub">متوسط مرجح بين المواد</div>
        </div>
        <div class="tp-kpi">
            <div class="tp-kpi-icon"><i class="fas fa-percentage"></i></div>
            <div class="tp-kpi-label">أعلى نسبة نجاح</div>
            <div class="tp-kpi-value">${best ? best.passRate.toFixed(1) + '%' : '-'}</div>
            <div class="tp-kpi-sub">${best ? escapeHtml(best.subject) : '-'}</div>
        </div>
        <div class="tp-kpi">
            <div class="tp-kpi-icon"><i class="fas fa-trophy"></i></div>
            <div class="tp-kpi-label">أفضل مادة (معدلاً)</div>
            <div class="tp-kpi-value">${best ? escapeHtml(best.subject) : '-'}</div>
            <div class="tp-kpi-sub">${best ? best.avg.toFixed(2) + ' · ' + best.teacherCount + ' أستاذ' : '-'}</div>
        </div>
        <div class="tp-kpi">
            <div class="tp-kpi-icon"><i class="fas fa-arrow-trend-down"></i></div>
            <div class="tp-kpi-label">أضعف مادة (معدلاً)</div>
            <div class="tp-kpi-value">${weakest && subjects.length > 1 ? escapeHtml(weakest.subject) : '-'}</div>
            <div class="tp-kpi-sub">${weakest && subjects.length > 1 ? weakest.avg.toFixed(2) + ' · ' + weakest.passRate.toFixed(1) + '%' : '-'}</div>
        </div>
        <div class="tp-kpi">
            <div class="tp-kpi-icon"><i class="fas fa-chalkboard-teacher"></i></div>
            <div class="tp-kpi-label">الأساتذة المشاركون</div>
            <div class="tp-kpi-value">${new Set(grades.filter((g) => g._teacher).map((g) => g._teacher)).size}</div>
            <div class="tp-kpi-sub">عبر ${subjects.length} مادة</div>
        </div>
    `;
}

function getBestSubject(grades) {
    const bySubject = {};
    grades.forEach((g) => {
        if (!g._subject) return;
        if (!bySubject[g._subject]) bySubject[g._subject] = [];
        bySubject[g._subject].push(g.grade);
    });
    let bestSub = '-',
        bestAvg = -1;
    for (const [subject, values] of Object.entries(bySubject)) {
        const a = avg(values);
        if (a > bestAvg) {
            bestAvg = a;
            bestSub = subject;
        }
    }
    return escapeHtml(bestSub);
}

/* ─── Chart.js Loading ─── */
async function ensureChartJsLoaded() {
    if (window.Chart) return window.Chart;
    if (chartLoaderPromise) return chartLoaderPromise;
    chartLoaderPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-dynamic-src="${CHART_JS_CDN}"]`);
        if (existing) {
            existing.addEventListener('load', () => resolve(window.Chart), { once: true });
            existing.addEventListener('error', () => reject(new Error('تعذر تحميل مكتبة الرسوم البيانية')), {
                once: true
            });
            return;
        }
        const script = document.createElement('script');
        script.src = CHART_JS_CDN;
        script.async = true;
        script.defer = true;
        script.dataset.dynamicSrc = CHART_JS_CDN;
        script.onload = () => resolve(window.Chart);
        script.onerror = () => reject(new Error('تعذر تحميل مكتبة الرسوم البيانية'));
        document.head.appendChild(script);
    });
    return chartLoaderPromise;
}

function showChartFallback(canvasId, message) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const wrap = canvas.closest('.tp-chart-wrap');
    if (!wrap) return;
    canvas.style.display = 'none';
    const existing = wrap.querySelector('.tp-chart-fallback');
    if (existing) existing.remove();
    const fallback = document.createElement('div');
    fallback.className = 'tp-chart-fallback';
    fallback.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${escapeHtml(message)}`;
    wrap.appendChild(fallback);
}

function updateChartAccessibility(canvasId, label, summaryId, summaryText) {
    const canvas = document.getElementById(canvasId);
    if (canvas) {
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', label);
        if (summaryId) canvas.setAttribute('aria-describedby', summaryId);
    }

    const summary = summaryId ? document.getElementById(summaryId) : null;
    if (summary && summaryText) {
        summary.textContent = summaryText;
    }
}

function destroyChart(key) {
    if (charts[key]) charts[key].destroy();
    charts[key] = null;
}

/* ─── Teacher Card ─── */
function renderTeacherCard(baseFiltered, rows) {
    const nameNode = document.getElementById('tp-teacher-name');
    const metaNode = document.getElementById('tp-teacher-meta');
    const benchmarkNode = document.getElementById('tp-teacher-benchmark');
    const trendNoteNode = document.getElementById('tp-trend-note');
    if (!nameNode || !metaNode || !trendNoteNode) return;

    if (!rows.length) {
        nameNode.textContent = 'لا يوجد أستاذ لعرض البطاقة';
        metaNode.innerHTML = '';
        if (benchmarkNode) benchmarkNode.innerHTML = '';
        trendNoteNode.textContent = '-';
        ['section', 'distribution', 'trend'].forEach((k) => destroyChart(k));
        return;
    }

    const teacherSelect = document.getElementById('tp-teacher-filter');
    if (teacherSelect?.value) selectedTeacherName = teacherSelect.value;
    if (!selectedTeacherName || !rows.some((r) => r.teacherKey === selectedTeacherName))
        selectedTeacherName = rows[0].teacherKey;

    const row = rows.find((r) => r.teacherKey === selectedTeacherName) || rows[0];
    const teacherGrades = baseFiltered.filter((g) => g._teacherKey === row.teacherKey);
    const studentCount = new Set(teacherGrades.map(studentIdentity)).size;

    // Benchmark
    const sameSubjectRows = rows.filter((r) => {
        if (row.subjects.length === 1 && r.subjects.length >= 1) return r.subjects.includes(row.subjects[0]);
        return true;
    });
    const rank = sameSubjectRows.filter((r) => r.avg <= row.avg).length;
    const benchmarkPct = sameSubjectRows.length > 1 ? Math.round(percentage(rank, sameSubjectRows.length)) : 100;

    nameNode.textContent = '';
    metaNode.innerHTML = `
        <span class="tp-badge"><i class="fas fa-percent"></i> ${row.passRate.toFixed(1)}%</span>
        <span class="tp-badge"><i class="fas fa-calculator"></i> ${row.avg.toFixed(2)} / 20</span>
        <span class="tp-badge"><i class="fas fa-user-graduate"></i> ${studentCount} تلميذ</span>
        <span class="tp-badge"><i class="fas fa-list-check"></i> ${row.gradeCount} نقطة</span>
        <span class="tp-badge"><i class="fas fa-table-cells"></i> ${row.sectionsCount} قسم</span>
    `;

    if (benchmarkNode) {
        const subjectName = row.subjects.length === 1 ? row.subjects[0] : 'كل المواد';
        benchmarkNode.innerHTML = `
            <span>يتفوق على <strong>${benchmarkPct}%</strong> من زملائه في ${escapeHtml(subjectName)}</span>
            <div class="tp-benchmark-track"><div class="tp-benchmark-fill" style="width:${benchmarkPct}%"></div></div>
        `;
    }

    renderTeacherSectionChart(teacherGrades);
    renderTeacherDistributionChart(teacherGrades);
    renderTeacherTrendChart(teacherGrades, trendNoteNode);
}

/* ─── Teacher Sub-Charts ─── */
function renderTeacherSectionChart(teacherGrades) {
    const canvas = document.getElementById('tp-section-chart');
    if (!canvas || !window.Chart) return;
    destroyChart('section');

    if (!teacherGrades.length) {
        updateChartAccessibility('tp-section-chart', 'لا توجد بيانات', 'tp-section-note', 'لم يتم العثور على نقط لهذا الأستاذ.');
        return;
    }

    const bySection = {};
    teacherGrades.forEach((g) => {
        const s = String(g.section || 'غير محدد');
        if (!bySection[s]) bySection[s] = [];
        bySection[s].push(g.grade);
    });
    const labels = Object.keys(bySection)
        .sort((a, b) => a.localeCompare(b, 'ar'))
        .slice(0, 10);
    const values = labels.map((l) => Number(avg(bySection[l]).toFixed(2)));
    charts.section = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: labels.length ? labels : ['لا توجد بيانات'],
            datasets: [
                {
                    label: 'متوسط القسم',
                    data: labels.length ? values : [0],
                    backgroundColor: 'rgba(105, 103, 190, 0.75)',
                    borderRadius: 6,
                    borderSkipped: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 650, easing: 'easeOutQuart' },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (ctx) => `المتوسط: ${Number(ctx.raw).toFixed(2)}` } }
            },
            scales: {
                y: { min: 0, max: 20, ticks: { stepSize: 4 }, grid: { color: 'rgba(0,0,0,0.05)' } },
                x: { grid: { display: false } }
            }
        }
    });
    updateChartAccessibility(
        'tp-section-chart',
        'رسم بياني يوضح أداء الأستاذ حسب الأقسام',
        'tp-section-note',
        labels.length ? `أفضل قسم معروض هو ${labels[0]} بمتوسط ${values[0].toFixed(2)}.` : 'لا توجد بيانات للأقسام.'
    );
}

function renderTeacherDistributionChart(teacherGrades) {
    const canvas = document.getElementById('tp-distribution-chart');
    if (!canvas || !window.Chart) return;
    destroyChart('distribution');

    if (!teacherGrades.length) {
        updateChartAccessibility('tp-distribution-chart', 'لا توجد بيانات', 'tp-distribution-note', 'لم يتم العثور على نقط لهذا الأستاذ.');
        return;
    }

    const distribution = gradeBands.map((band) => ({
        ...band,
        count: teacherGrades.filter((g) => g.grade >= band.min && g.grade < band.max + (band.max === 20 ? 0.001 : 0))
            .length
    }));
    charts.distribution = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: distribution.map((d) => d.label),
            datasets: [
                {
                    data: distribution.map((d) => d.count),
                    backgroundColor: distribution.map((d) => d.color),
                    borderColor: 'rgba(255,255,255,0.9)',
                    borderWidth: 3,
                    hoverOffset: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '58%',
            animation: { duration: 650, easing: 'easeOutQuart' },
            plugins: {
                legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 14 } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const v = Number(ctx.raw || 0);
                            return `${ctx.label}: ${v} (${percentage(v, teacherGrades.length).toFixed(1)}%)`;
                        }
                    }
                }
            }
        }
    });
    const topBand = distribution.reduce(
        (best, current) => (current.count > best.count ? current : best),
        distribution[0]
    );
    updateChartAccessibility(
        'tp-distribution-chart',
        'رسم دائري يوضح توزيع نقط الأستاذ',
        'tp-distribution-note',
        `أكبر فئة هي ${topBand.label} بعدد ${topBand.count} نقطة من أصل ${teacherGrades.length}.`
    );
}

function renderTeacherTrendChart(teacherGrades, noteNode) {
    const canvas = document.getElementById('tp-trend-chart');
    if (!canvas || !window.Chart || !noteNode) return;
    destroyChart('trend');

    if (!teacherGrades.length) {
        noteNode.textContent = 'لم يتم العثور على نقط لهذا الأستاذ.';
        return;
    }

    const byExam = {};
    const bySectionExam = {};

    teacherGrades.forEach((g) => {
        if (!g._examNo) return;
        if (!byExam[g._examNo]) byExam[g._examNo] = [];
        byExam[g._examNo].push(g.grade);

        const sec = String(g.section || 'غير محدد');
        if (!bySectionExam[sec]) bySectionExam[sec] = {};
        if (!bySectionExam[sec][g._examNo]) bySectionExam[sec][g._examNo] = [];
        bySectionExam[sec][g._examNo].push(g.grade);
    });

    const examKeys = Object.keys(byExam)
        .map(Number)
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);
    if (!examKeys.length) {
        noteNode.textContent = 'لا توجد فروض مرقمة لعرض تطور زمني لهذا الأستاذ.';
        return;
    }

    const labels = examKeys.map((n) => `فرض ${n}`);
    const globalValues = examKeys.map((n) => Number(avg(byExam[n]).toFixed(2)));

    const SECTION_COLORS = [
        'rgba(59,106,197,0.85)', 'rgba(47,179,109,0.85)', 'rgba(231,76,60,0.85)',
        'rgba(240,194,14,0.85)', 'rgba(155,100,171,0.85)', 'rgba(22,160,133,0.85)',
        'rgba(243,156,18,0.85)', 'rgba(52,73,94,0.85)'
    ];

    const sections = Object.keys(bySectionExam).sort((a, b) => a.localeCompare(b, 'ar'));
    const showSections = sections.length > 1;
    const displayedSections = sections.slice(0, 8);
    const sectionsTruncated = sections.length > 8;

    const sectionDatasets = !showSections ? [] : displayedSections.map((sec, i) => ({
        label: sec,
        data: examKeys.map((n) => {
            const vals = bySectionExam[sec]?.[n];
            return vals?.length ? Number(avg(vals).toFixed(2)) : null;
        }),
        borderColor: SECTION_COLORS[i % SECTION_COLORS.length],
        backgroundColor: 'transparent',
        pointRadius: 3,
        pointHoverRadius: 4,
        tension: 0.3,
        fill: false,
        spanGaps: true,
        borderDash: [5, 3]
    }));

    const globalDataset = {
        label: 'المتوسط العام',
        data: globalValues,
        borderColor: 'rgba(155,100,171,0.95)',
        backgroundColor: 'rgba(155,100,171,0.15)',
        pointBackgroundColor: 'rgba(155,100,171,1)',
        pointRadius: 5,
        pointHoverRadius: 6,
        tension: 0.35,
        fill: true,
        borderWidth: 2.5
    };

    charts.trend = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels, datasets: [globalDataset, ...sectionDatasets] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 650, easing: 'easeOutQuart' },
            plugins: {
                legend: {
                    display: showSections,
                    position: 'bottom',
                    labels: { usePointStyle: true, pointStyle: 'line', padding: 12, font: { size: 11 } }
                },
                tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.raw).toFixed(2)}` } }
            },
            scales: {
                y: { min: 0, max: 20, ticks: { stepSize: 4 }, grid: { color: 'rgba(0,0,0,0.05)' } },
                x: { grid: { display: false } }
            }
        }
    });

    const sectionInfo = showSections ? ` · ${sections.length} قسم` : '';
    const truncNote = sectionsTruncated ? ` (يُعرض 8 من أصل ${sections.length})` : '';
    noteNode.textContent = `تطور عبر ${examKeys.length} فروض مرقمة${sectionInfo}${truncNote}.`;
    updateChartAccessibility(
        'tp-trend-chart',
        'رسم بياني يوضح تطور الأداء بين الفروض حسب القسم',
        'tp-trend-note',
        noteNode.textContent
    );
}

/* ─── Semester Comparison Chart ─── */
function renderSemesterCompareChart(rows) {
    const canvas = document.getElementById('tp-semester-compare-chart');
    const note = document.getElementById('tp-semester-compare-note');
    if (!canvas || !note || !window.Chart) return;
    destroyChart('semesterCompare');

    // If a teacher is selected, show only their data
    const selectedRow = selectedTeacherName ? rows.find((r) => r.teacherKey === selectedTeacherName) : null;

    if (selectedRow) {
        if (selectedRow.sem1Avg === null && selectedRow.sem2Avg === null) {
            note.textContent = `الأستاذ ${selectedRow.teacher} لا تتوفر لديه بيانات للدورتين بعد.`;
            return;
        }
        if (selectedRow.sem1Avg === null) {
            note.textContent = `الأستاذ ${selectedRow.teacher} لا تتوفر لديه بيانات للدورة الأولى بعد.`;
            return;
        }
        if (selectedRow.sem2Avg === null) {
            note.textContent = `الأستاذ ${selectedRow.teacher} لا تتوفر لديه بيانات للدورة الثانية بعد.`;
            return;
        }
    }

    const withBoth = rows.filter((r) => r.sem1Avg !== null && r.sem2Avg !== null);
    if (!withBoth.length) {
        note.textContent = 'لا توجد بيانات للدورتين معاً للمقارنة.';
        return;
    }

    const top = [...withBoth].sort((a, b) => Math.abs(b.semesterDiff) - Math.abs(a.semesterDiff)).slice(0, 15);
    const labels = top.map((r) => r.teacher);

    charts.semesterCompare = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'الدورة 1',
                    data: top.map((r) => Number(r.sem1Avg.toFixed(2))),
                    backgroundColor: 'rgba(59, 106, 197, 0.75)',
                    borderRadius: 4,
                    borderSkipped: false
                },
                {
                    label: 'الدورة 2',
                    data: top.map((r) => Number(r.sem2Avg.toFixed(2))),
                    backgroundColor: 'rgba(155, 100, 171, 0.75)',
                    borderRadius: 4,
                    borderSkipped: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 700, easing: 'easeOutQuart' },
            plugins: {
                legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 14 } }
            },
            scales: {
                y: { min: 0, max: 20, ticks: { stepSize: 4 }, grid: { color: 'rgba(0,0,0,0.05)' } },
                x: { grid: { display: false } }
            }
        }
    });

    const improved = withBoth.filter((r) => r.semesterDiff > 0).length;
    const declined = withBoth.filter((r) => r.semesterDiff < 0).length;
    note.textContent = `${withBoth.length} أستاذ لديه بيانات للدورتين: ${improved} تحسن، ${declined} تراجع.`;
    updateChartAccessibility(
        'tp-semester-compare-chart',
        'رسم بياني يقارن نتائج الدورتين الأولى والثانية',
        'tp-semester-compare-note',
        note.textContent
    );
}

/* ─── Radar Chart ─── */
function renderRadarChart(rows) {
    const canvas = document.getElementById('tp-radar-chart');
    const note = document.getElementById('tp-radar-note');
    if (!canvas || !note || !window.Chart) return;
    destroyChart('radar');

    if (!selectedTeacherName || !rows.length) {
        note.textContent = 'اختر أستاذ لعرض ملف الأداء الشامل.';
        return;
    }
    const row = rows.find((r) => r.teacherKey === selectedTeacherName) || rows[0];

    if (!row.gradeValues || !row.gradeValues.length) {
        note.textContent = `لا تتوفر بيانات كافية لعرض ملف الأداء الشامل لـ ${row.teacher}.`;
        return;
    }

    const sd = row.gradeValues ? stdDev(row.gradeValues) : 0;
    const consistency = Math.max(0, Math.min(100, (1 - sd / 10) * 100));
    const semProgress = row.semesterDiff !== null ? Math.max(0, Math.min(100, 50 + row.semesterDiff * 10)) : 50;

    charts.radar = new Chart(canvas.getContext('2d'), {
        type: 'radar',
        data: {
            labels: ['المعدل العام', 'نسبة النجاح', 'تجانس النتائج', 'عدد الأقسام', 'التطور بين الدورات'],
            datasets: [
                {
                    label: row.teacher,
                    data: [
                        Math.min(100, row.avg * 5),
                        row.passRate,
                        consistency,
                        Math.min(100, row.sectionsCount * 20),
                        semProgress
                    ],
                    backgroundColor: 'rgba(105, 103, 190, 0.2)',
                    borderColor: 'rgba(105, 103, 190, 0.8)',
                    pointBackgroundColor: 'rgba(105, 103, 190, 1)',
                    pointRadius: 4,
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 700, easing: 'easeOutQuart' },
            plugins: { legend: { display: false } },
            scales: {
                r: {
                    min: 0,
                    max: 100,
                    ticks: { stepSize: 20, display: false },
                    pointLabels: { font: { size: 11, family: "'IBM Plex Sans Arabic', sans-serif" } },
                    grid: { color: 'rgba(0,0,0,0.08)' }
                }
            }
        }
    });

    note.textContent = `ملف شامل لـ ${row.teacher}: معدل ${row.avg.toFixed(2)}, نجاح ${row.passRate.toFixed(1)}%, تجانس ${consistency.toFixed(0)}%.`;
    updateChartAccessibility(
        'tp-radar-chart',
        'رسم راداري يلخص ملف الأداء الشامل للأستاذ',
        'tp-radar-note',
        note.textContent
    );
}

/* ─── State Line ─── */
function renderStateLine(baseFiltered, rows) {
    const el = document.getElementById('tp-state-line');
    if (!el) return;
    if (!baseFiltered.length) {
        el.textContent = 'لا توجد معطيات تطابق الفلاتر الحالية.';
        return;
    }
    const withTeacher = baseFiltered.filter((g) => g._teacher).length;
    const withoutTeacher = baseFiltered.length - withTeacher;
    el.textContent = `${baseFiltered.length} نقطة · ${rows.length} أستاذ صالح · ${withoutTeacher} سجل يحتاج تصحيح.`;
}

/* ─── Export ─── */
function exportReport() {
    if (!teacherRowsCache.length) {
        showToast('لا توجد بيانات للتصدير', 'error');
        return;
    }
    const headers = ['الأستاذ', 'المادة', 'الأقسام', 'التلاميذ', 'المعدل', 'نسبة النجاح', 'التصنيف', 'فرق الدورتين'];
    const csvRows = ['\uFEFF' + headers.join(',')];
    const sorted = [...teacherRowsCache].sort((a, b) => b.passRate - a.passRate || b.avg - a.avg);
    sorted.forEach((row) => {
        const subjectLabel = row.subjects.length === 1 ? row.subjects[0] : row.subjects.length ? `متعددة (${row.subjects.length})` : '-';
        csvRows.push(
            [
                csvEscape(row.teacher),
                csvEscape(subjectLabel),
                row.sectionsCount,
                row.studentCount,
                row.avg.toFixed(2),
                row.passRate.toFixed(1) + '%',
                csvEscape(row.rating.label),
                row.semesterDiff !== null ? row.semesterDiff.toFixed(2) : '-'
            ].join(',')
        );
    });
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `tracking-teachers-performance-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast('تم تصدير التقرير بنجاح', 'success');
}

/* ─── Main Analysis ─── */
async function runAnalysis() {
    const analyzeBtn = document.getElementById('tp-analyze-btn');
    const teacherSelect = document.getElementById('tp-teacher-filter');
    if (analyzeBtn) {
        analyzeBtn.disabled = true;
        analyzeBtn.setAttribute('aria-busy', 'true');
    }
    showLoading();

    try {
        let chartLoadFailed = false;
        try {
            await ensureChartJsLoaded();
        } catch (chartErr) {
            console.warn('Chart.js failed to load:', chartErr);
            chartLoadFailed = true;
        }

        const baseFiltered = getBaseFilteredGrades();
        currentSubjectFilter = document.getElementById('tp-subject-filter')?.value || '';
        const rows = buildTeacherRows(baseFiltered).sort(
            (a, b) => b.passRate - a.passRate || b.avg - a.avg || b.gradeCount - a.gradeCount
        );
        if (teacherSelect?.value) selectedTeacherName = teacherSelect.value;
        if (rows.length && (!selectedTeacherName || !rows.some((r) => r.teacherKey === selectedTeacherName)))
            selectedTeacherName = rows[0].teacherKey;
        updateTrackingPageTitle();
        teacherRowsCache = rows;

        renderStateLine(baseFiltered, rows);
        renderKpis(baseFiltered, rows);
        if (chartLoadFailed) {
            const chartMsg = 'تعذر تحميل مكتبة الرسوم البيانية';
            showChartFallback('tp-section-chart', chartMsg);
            showChartFallback('tp-distribution-chart', chartMsg);
            showChartFallback('tp-trend-chart', chartMsg);
            showChartFallback('tp-semester-compare-chart', chartMsg);
            showChartFallback('tp-radar-chart', chartMsg);
        } else {
            renderTeacherCard(baseFiltered, rows);
            renderSemesterCompareChart(rows);
            renderRadarChart(rows);
        }
        // Compensation/support dashboard (pure HTML, no Chart.js dependency)
        renderCompSupportCharts();
    } catch (error) {
        console.error('Tracking teacher performance analysis error:', error);
        showToast('تعذر تنفيذ التحليل', 'error');
    } finally {
        hideLoading();
        if (analyzeBtn) {
            analyzeBtn.disabled = false;
            analyzeBtn.removeAttribute('aria-busy');
        }
    }
}

/* ─── Compensation & Support Block (teacher-specific empty states) ─── */
async function loadCompensationAndSupportData() {
    const year = await getCurrentYear();

    try {
        _compRecordsCache = (await window.api.compensation.getAll(year)) ?? [];
    } catch (_) {
        _compRecordsCache = [];
    }

    try {
        _supportSessionsCache = (await window.api.supportSessions.list({ school_year: year })) ?? [];
    } catch (_) {
        _supportSessionsCache = [];
    }

    await ensureChartJsLoaded().catch(() => {});
    if (!window.Chart) return;

    renderCompSupportCharts();
}

function _getSelectedTeacherDisplayName() {
    if (!selectedTeacherName) return null;
    const row = teacherRowsCache.find((r) => r.teacherKey === selectedTeacherName);
    return row ? row.teacher : null;
}

function _getTeacherNameForMatching() {
    const row = teacherRowsCache.find((r) => r.teacherKey === selectedTeacherName);
    return row ? row.teacher : null;
}

function renderCompSupportCharts() {
    const teacherName = _getTeacherNameForMatching();
    const compAll = teacherName
        ? _compRecordsCache.filter((r) => (r.teacher_name || '').trim() === teacherName)
        : _compRecordsCache;
    const supportAll = teacherName
        ? _supportSessionsCache.filter((s) => (s.teacher_name || '').trim() === teacherName)
        : _supportSessionsCache;

    const pending = compAll.filter((r) => !r.compensated);
    const done = compAll.filter((r) => r.compensated);
    const totalSupportHours = supportAll.reduce((s, r) => s + (Number(r.duration_hours) || 0), 0);
    const supportSections = new Set(supportAll.map((s) => s.section || 'غير محدد'));

    _renderCSKpis(teacherName, pending, done, supportAll, totalSupportHours, supportSections);
    _renderCSCards(teacherName, pending, done, supportAll, totalSupportHours, supportSections);
}

function _renderCSKpis(teacherName, pending, done, supportAll, totalSupportHours, supportSections) {
    const container = document.getElementById('tp-cs-kpis');
    if (!container) return;

    // KPI 1: Support sessions
    const supportCount = supportAll.length;
    let supportBadge = '', supportBadgeClass = '';
    if (supportCount > 0) {
        supportBadge = 'منجزة';
        supportBadgeClass = 'tp-cs-badge-ok';
    } else {
        supportBadge = 'لم تُسجَّل بعد';
        supportBadgeClass = 'tp-cs-badge-warn';
    }

    // KPI 2: Compensated sessions
    const doneCount = done.length;
    let compBadge = '', compBadgeClass = '';
    if (doneCount > 0 && pending.length === 0) {
        compBadge = 'مكتملة';
        compBadgeClass = 'tp-cs-badge-ok';
    } else if (doneCount > 0) {
        compBadge = 'جزئية';
        compBadgeClass = 'tp-cs-badge-warn';
    } else {
        compBadge = pending.length > 0 ? 'معلّقة' : 'لا شيء';
        compBadgeClass = pending.length > 0 ? 'tp-cs-badge-warn' : 'tp-cs-badge-ok';
    }

    // KPI 3: Pending
    const pendingCount = pending.length;
    const pendingSections = new Set(pending.map((r) => r.section || 'غير محدد'));
    let pendingBadge = '', pendingBadgeClass = '';
    if (pendingCount === 0) {
        pendingBadge = 'لا شيء معلّق';
        pendingBadgeClass = 'tp-cs-badge-ok';
    } else if (pendingCount <= 2) {
        pendingBadge = 'يستوجب المتابعة';
        pendingBadgeClass = 'tp-cs-badge-warn';
    } else {
        pendingBadge = 'يستوجب التدخل';
        pendingBadgeClass = 'tp-cs-badge-alert';
    }

    container.innerHTML = `
        <div class="tp-cs-kpi">
            <div class="tp-cs-kpi-label">إجمالي حصص الدعم</div>
            <div class="tp-cs-kpi-value">${supportCount}</div>
            <div class="tp-cs-kpi-sub">${totalSupportHours.toFixed(1)} ساعة · ${supportSections.size} ${supportSections.size === 1 ? 'قسم' : 'أقسام'}</div>
            <span class="tp-cs-badge ${supportBadgeClass}">${supportBadge}</span>
        </div>
        <div class="tp-cs-kpi">
            <div class="tp-cs-kpi-label">الحصص التعويضية المنجزة</div>
            <div class="tp-cs-kpi-value">${doneCount}</div>
            <div class="tp-cs-kpi-sub">${doneCount > 0 ? `من أصل ${doneCount + pendingCount}` : 'في انتظار التسجيل'}</div>
            <span class="tp-cs-badge ${compBadgeClass}">${compBadge}</span>
        </div>
        <div class="tp-cs-kpi">
            <div class="tp-cs-kpi-label">تحتاج إلى تعويض</div>
            <div class="tp-cs-kpi-value">${pendingCount}</div>
            <div class="tp-cs-kpi-sub">${pendingCount > 0 ? `${pendingSections.size} ${pendingSections.size === 1 ? 'قسم معني' : 'أقسام معنية'}` : 'لا حصص معلّقة'}</div>
            <span class="tp-cs-badge ${pendingBadgeClass}">${pendingBadge}</span>
        </div>
    `;
}

function _renderCSCards(teacherName, pending, done, supportAll, totalSupportHours, supportSections) {
    const container = document.getElementById('tp-cs-cards');
    if (!container) return;

    const displayName = teacherName ? escapeHtml(_getSelectedTeacherDisplayName() || teacherName) : '';

    // Card 1: Support sessions detail
    const card1 = _buildSupportCard(supportAll, totalSupportHours, supportSections, displayName);

    // Card 2: Compensated sessions detail
    const card2 = _buildCompensatedCard(done, pending, displayName);

    // Card 3: Pending sessions detail
    const card3 = _buildPendingCard(pending, displayName);

    container.innerHTML = card1 + card2 + card3;
}

function _buildSupportCard(sessions, totalHours, sections, displayName) {
    const svgIcon = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="4" width="12" height="8" rx="1" stroke="#3266ad" stroke-width="1.2"/><path d="M4 1v3M10 1v3" stroke="#3266ad" stroke-width="1.2" stroke-linecap="round"/></svg>';

    if (!sessions.length) {
        const hint = displayName
            ? `الأستاذ(ة) ${displayName} لم يُنجز أي حصة دعم بعد`
            : 'لا توجد حصص دعم مسجلة';
        return `
            <div class="tp-cs-card">
                <div class="tp-cs-card-title">${svgIcon} حصص الدعم المنجزة</div>
                <div class="tp-cs-card-sub">${hint}</div>
                <div class="tp-cs-empty">
                    <div class="tp-cs-empty-icon tp-cs-empty-icon--blue">
                        <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="3" y="6" width="16" height="12" rx="2" stroke="#3266ad" stroke-width="1.5"/><path d="M7 3v4M15 3v4" stroke="#3266ad" stroke-width="1.5" stroke-linecap="round"/></svg>
                    </div>
                    <div class="tp-cs-empty-text">لا توجد حصص دعم مسجّلة</div>
                    <div class="tp-cs-empty-hint">يمكن تسجيلها من صفحة "حصص الدعم والتقوية"</div>
                </div>
            </div>`;
    }

    // Group by section
    const bySection = {};
    sessions.forEach((s) => {
        const sec = s.section || 'غير محدد';
        if (!bySection[sec]) bySection[sec] = { hours: 0, count: 0 };
        bySection[sec].hours += Number(s.duration_hours) || 0;
        bySection[sec].count++;
    });

    const sorted = Object.entries(bySection).sort((a, b) => b[1].hours - a[1].hours).slice(0, 6);
    const maxVal = sorted.length ? sorted[0][1].hours : 1;

    const COLORS = ['#3266ad', '#4f80c4', '#6f9ad6', '#8fb4e6', '#a8c6ee', '#c0d8f5'];

    // Build axis
    const axisSteps = _buildAxisLabels(maxVal, 'h');

    let barsHtml = sorted.map(([sec, data], i) => {
        const pct = maxVal > 0 ? Math.max(5, (data.hours / maxVal) * 100) : 5;
        return `
            <div class="tp-cs-bar-row">
                <div class="tp-cs-bar-label">${escapeHtml(sec)}</div>
                <div class="tp-cs-bar-track">
                    <div class="tp-cs-bar-fill" style="width:${pct}%;background:${COLORS[i % COLORS.length]};">
                        <span class="tp-cs-bar-val">${data.hours.toFixed(1)}h</span>
                    </div>
                </div>
            </div>`;
    }).join('');

    return `
        <div class="tp-cs-card">
            <div class="tp-cs-card-title">${svgIcon} حصص الدعم المنجزة</div>
            <div class="tp-cs-card-sub">${sessions.length} حصة دعم · ${totalHours.toFixed(1)} ساعة · ${sections.size} ${sections.size === 1 ? 'قسم' : 'أقسام'}</div>
            <div class="tp-cs-axis-row">${axisSteps}</div>
            ${barsHtml}
        </div>`;
}

function _buildCompensatedCard(done, pending, displayName) {
    const svgIcon = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="#3B6D11" stroke-width="1.2"/><path d="M4.5 7l2 2 3-4" stroke="#3B6D11" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    if (!done.length) {
        const pendingHint = pending.length > 0 ? `${pending.length} حصة في الانتظار` : '';
        const subText = displayName
            ? `الأستاذ(ة) ${displayName} لم يُسجَّل أي تعويض بعد`
            : 'لا توجد حصص تعويضية منجزة';
        return `
            <div class="tp-cs-card">
                <div class="tp-cs-card-title">${svgIcon} الحصص التعويضية المنجزة</div>
                <div class="tp-cs-card-sub">${subText}</div>
                <div class="tp-cs-empty">
                    <div class="tp-cs-empty-icon tp-cs-empty-icon--green">
                        <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="9" stroke="#3B6D11" stroke-width="1.5"/><path d="M11 7v5l3 2" stroke="#3B6D11" stroke-width="1.5" stroke-linecap="round"/></svg>
                    </div>
                    <div class="tp-cs-empty-text">لا توجد حصص تعويضية مسجّلة</div>
                    ${pendingHint ? `<div class="tp-cs-empty-hint">${pendingHint}</div>` : ''}
                </div>
            </div>`;
    }

    // Group by section
    const bySection = {};
    done.forEach((r) => {
        const sec = r.section || 'غير محدد';
        bySection[sec] = (bySection[sec] || 0) + 1;
    });

    const sorted = Object.entries(bySection).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const maxVal = sorted.length ? sorted[0][1] : 1;
    const total = done.length + pending.length;
    const pctDone = total > 0 ? Math.round((done.length / total) * 100) : 100;

    const COLORS = ['#3B6D11', '#4F8A1A', '#6BA330', '#85BA4A', '#A0D068', '#BBE688'];

    const axisSteps = _buildAxisLabels(maxVal, '');

    let barsHtml = sorted.map(([sec, count], i) => {
        const pct = maxVal > 0 ? Math.max(5, (count / maxVal) * 100) : 5;
        return `
            <div class="tp-cs-bar-row">
                <div class="tp-cs-bar-label">${escapeHtml(sec)}</div>
                <div class="tp-cs-bar-track">
                    <div class="tp-cs-bar-fill" style="width:${pct}%;background:${COLORS[i % COLORS.length]};">
                        <span class="tp-cs-bar-val">${count}</span>
                    </div>
                </div>
            </div>`;
    }).join('');

    // Success alert if all done
    let alertHtml = '';
    if (pending.length === 0) {
        alertHtml = `
            <div class="tp-cs-alert-box tp-cs-alert-box--ok">
                <div class="tp-cs-alert-title">✓ مكتملة</div>
                <div class="tp-cs-alert-text">تم تعويض جميع الحصص بنجاح</div>
            </div>`;
    }

    return `
        <div class="tp-cs-card">
            <div class="tp-cs-card-title">${svgIcon} الحصص التعويضية المنجزة</div>
            <div class="tp-cs-card-sub">${done.length} حصة منجزة · نسبة الإنجاز ${pctDone}%</div>
            <div class="tp-cs-axis-row">${axisSteps}</div>
            ${barsHtml}
            ${alertHtml}
        </div>`;
}

function _buildPendingCard(pending, displayName) {
    const svgIcon = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2L2 12h10L7 2z" stroke="#A32D2D" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 6v3M7 10.5v.5" stroke="#A32D2D" stroke-width="1.2" stroke-linecap="round"/></svg>';

    if (!pending.length) {
        const subText = displayName
            ? `لا توجد حصص معلّقة للأستاذ(ة) ${displayName}`
            : 'لا توجد حصص في انتظار التعويض';
        return `
            <div class="tp-cs-card">
                <div class="tp-cs-card-title">${svgIcon} الحصص المتأخرة للتعويض</div>
                <div class="tp-cs-card-sub">${subText}</div>
                <div class="tp-cs-empty">
                    <div class="tp-cs-empty-icon tp-cs-empty-icon--green">
                        <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="9" stroke="#3B6D11" stroke-width="1.5"/><path d="M7 11l3 3 5-6" stroke="#3B6D11" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </div>
                    <div class="tp-cs-empty-text">لا توجد حصص معلّقة</div>
                    <div class="tp-cs-empty-hint">جميع الحصص تم تعويضها ✓</div>
                </div>
            </div>`;
    }

    // Group by section
    const bySection = {};
    pending.forEach((r) => {
        const sec = r.section || 'غير محدد';
        bySection[sec] = (bySection[sec] || 0) + 1;
    });

    const sorted = Object.entries(bySection).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const maxVal = sorted.length ? sorted[0][1] : 1;
    const sectionCount = sorted.length;

    const COLORS = ['#D85A30', '#E87955', '#F0936F', '#F5AD8A', '#FAC7A5', '#FFE0C0'];

    const axisSteps = _buildAxisLabels(maxVal, '');

    let barsHtml = sorted.map(([sec, count], i) => {
        const pct = maxVal > 0 ? Math.max(5, (count / maxVal) * 100) : 5;
        return `
            <div class="tp-cs-bar-row">
                <div class="tp-cs-bar-label">${escapeHtml(sec)}</div>
                <div class="tp-cs-bar-track">
                    <div class="tp-cs-bar-fill" style="width:${pct}%;background:${COLORS[i % COLORS.length]};">
                        <span class="tp-cs-bar-val">${count}</span>
                    </div>
                </div>
            </div>`;
    }).join('');

    // Alert box
    const alertHtml = `
        <div class="tp-cs-alert-box tp-cs-alert-box--warn">
            <div class="tp-cs-alert-title">تنبيه</div>
            <div class="tp-cs-alert-text">يجب جدولة التعويضات في أقرب وقت</div>
        </div>`;

    return `
        <div class="tp-cs-card">
            <div class="tp-cs-card-title">${svgIcon} الحصص المتأخرة للتعويض</div>
            <div class="tp-cs-card-sub">${pending.length} حصة تحتاج تعويضًا · ${sectionCount} ${sectionCount === 1 ? 'قسم معني' : 'أقسام معنية'}</div>
            <div class="tp-cs-axis-row">${axisSteps}</div>
            ${barsHtml}
            ${alertHtml}
        </div>`;
}

function _buildAxisLabels(maxVal, suffix) {
    const ceil = Math.ceil(maxVal);
    if (ceil <= 0) return '<span>0</span>';
    const steps = Math.min(ceil, 6);
    const stepSize = ceil / steps;
    const labels = [];
    for (let i = steps; i >= 0; i--) {
        const v = Math.round(stepSize * i * 10) / 10;
        labels.push(`<span>${v}${suffix}</span>`);
    }
    return labels.join('');
}
