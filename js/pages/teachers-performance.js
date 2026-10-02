/* ═══════════════════════════════════════════════════════
   Teachers Performance – مؤشرات أداء الأساتذة
   ═══════════════════════════════════════════════════════ */

const DEFAULT_YEAR = getSchoolYear();
// CH6: Chart loader via window.ensureChartJsLoaded (js/shared/chart-theme.js)

let allGradesCache = [];
let allAbsencesCache = [];
let sectionToLevel = {};
let teacherRowsCache = [];
let selectedTeacherName = '';
let kpiView = 'teacher';
let lastBaseFiltered = [];

const charts = {};
const sortState = { key: 'passRate', direction: 'desc' };
let currentSubjectFilter = '';
let _filterManager = null;

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
        await loadInitialData();
        await runAnalysis();
    } catch (error) {
        console.error('Teacher performance init error:', error);
        showToast('تعذر تحميل مؤشرات الأداء', 'error');
    }
});

/* ─── Events ─── */
function bindEvents() {
    const analyzeBtn = document.getElementById('tp-analyze-btn');
    const resetBtn = document.getElementById('tp-reset-btn');
    const levelFilter = document.getElementById('tp-level-filter');
    const classFilter = document.getElementById('tp-class-filter');
    const subjectFilter = document.getElementById('tp-subject-filter');
    const semesterFilter = document.getElementById('tp-semester-filter');
    const teacherFilter = document.getElementById('tp-teacher-filter');
    const exportBtn = document.getElementById('tp-export-btn');

    if (analyzeBtn) analyzeBtn.addEventListener('click', () => runAnalysis());
    if (resetBtn)
        resetBtn.addEventListener('click', () => {
            if (_filterManager) _filterManager.reset();
            [semesterFilter, teacherFilter].forEach((s) => {
                if (s) s.value = '';
            });
            selectedTeacherName = '';
            renderSemesterFilter();
            renderTeacherFilter();
            runAnalysis();
        });

    // Level/Class/Subject cascading handled by FilterManager.
    // Page-specific: sync semester and teacher on level/class/subject change.
    if (levelFilter)
        levelFilter.addEventListener('change', () => {
            renderSemesterFilter();
            renderTeacherFilter();
        });
    if (classFilter)
        classFilter.addEventListener('change', () => {
            renderSemesterFilter();
            renderTeacherFilter();
        });
    if (subjectFilter)
        subjectFilter.addEventListener('change', () => {
            renderSemesterFilter();
            renderTeacherFilter();
        });
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

    // Table header sort
    document.querySelectorAll('.tp-table th[data-sort-key]').forEach((th) => {
        th.addEventListener('click', () => {
            const key = th.dataset.sortKey;
            if (sortState.key === key) {
                sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
            } else {
                sortState.key = key;
                sortState.direction = 'desc';
            }
            renderTeacherTable(teacherRowsCache, currentSubjectFilter);
        });
    });

    // Table row click
    document.getElementById('tp-table-body')?.addEventListener('click', (e) => {
        const row = e.target.closest('tr[data-teacher]');
        if (!row) return;
        selectedTeacherName = row.dataset.teacher;
        if (teacherFilter) teacherFilter.value = selectedTeacherName;
        runAnalysis();
    });

    // Export
    if (exportBtn) exportBtn.addEventListener('click', exportReport);

    // Print
    const printBtn = document.getElementById('tp-print-btn');
    if (printBtn) printBtn.addEventListener('click', printReport);

    // KPI toggle
    document.querySelectorAll('.tp-toggle-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            kpiView = btn.dataset.kpiView;
            document.querySelectorAll('.tp-toggle-btn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            renderKpis(lastBaseFiltered, teacherRowsCache);
        });
    });
}

/* ─── Data Loading ─── */
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

    // Use FilterManager for Level → Class → Subject (from grades)
    _filterManager = new FilterManager({
        selectors: {
            level: 'tp-level-filter',
            class: 'tp-class-filter',
            subject: 'tp-subject-filter'
        },
        subjectsFromGrades: true,
        year
    });
    await _filterManager.init();

    // Sync caches from FilterManager
    const fmData = _filterManager.getData();
    allGradesCache = fmData.grades;
    sectionToLevel = _filterManager._levelsMapping || {};

    // Enrich grades cache with computed fields
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

    // Load compensation and support data — independent of grade filters
    loadCompensationAndSupportData().catch((err) => console.warn('comp/support load error:', err));
}

// renderLevelFilter, renderClassFilter, renderSubjectFilter are now handled by FilterManager.
// Only renderSemesterFilter and renderTeacherFilter remain page-specific.

function renderSemesterFilter() {
    const level = document.getElementById('tp-level-filter')?.value || '';
    const className = document.getElementById('tp-class-filter')?.value || '';
    const subject = document.getElementById('tp-subject-filter')?.value || '';
    const s = document.getElementById('tp-semester-filter');
    if (!s) return;
    const prev = s.value;
    const semesters = Array.from(
        new Set(
            allGradesCache
                .filter(
                    (g) =>
                        (!level || g._level === level) &&
                        (!className || String(g.section || '') === className) &&
                        (!subject || g._subject === subject)
                )
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

    const allTeachers = populateTeachersBySubject(s, base, 'كل الأساتذة');

    if (prev && allTeachers.includes(prev)) {
        s.value = prev;
        selectedTeacherName = prev;
    } else if (selectedTeacherName && !allTeachers.includes(selectedTeacherName)) selectedTeacherName = '';
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
    const level = document.getElementById('tp-level-filter')?.value || '';
    const className = document.getElementById('tp-class-filter')?.value || '';
    const subject = document.getElementById('tp-subject-filter')?.value || '';
    const semester = Number(document.getElementById('tp-semester-filter')?.value || 0);
    return allGradesCache.filter((g) => {
        if (level && g._level !== level) return false;
        if (className && String(g.section || '') !== className) return false;
        if (subject && g._subject !== subject) return false;
        if (semester && Number(g.semester) !== semester) return false;
        return true;
    });
}

function studentIdentity(record) {
    return String(record.student_id || record.student_code || record.full_name || 'غير محدد');
}

// normalizeSubjectName() — provided by js/utils.js

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
    // Reject section/class names (e.g. 2BACSH-1, TCS-3, 1BACSEF-2)
    if (/^(TCS|[12]BAC[A-Z]*)\s*[-_]?\s*\d*$/i.test(raw.replace(/\s+/g, ''))) return '';
    const normalized = normalizeLoose(raw);
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
            'اساتذ',
            'ملاحظات',
            'ملاحظة',
            'ملاحظاتالاستاذ',
            'ملاحظاتالأستاذ',
            'notes',
            'note',
            'observation',
            'observations',
            'comment',
            'comments',
            'remarque',
            'remarques',
            'غيرمحدد',
            'unknown',
            'na',
            'n/a'
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

// CH3: csvEscape via js/shared/csv.js (hardened formula injection)

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

/* ─── Sort ─── */
function getSortedRows(rows) {
    const sorted = [...rows];
    const dir = sortState.direction === 'asc' ? 1 : -1;
    const key = sortState.key;
    sorted.sort((a, b) => {
        let left, right;
        if (key === 'subject') {
            left = rowSubjectLabel(a, currentSubjectFilter);
            right = rowSubjectLabel(b, currentSubjectFilter);
        } else if (key === 'teacher') {
            left = a.teacher;
            right = b.teacher;
        } else if (key === 'rating') {
            left = a.rating.value;
            right = b.rating.value;
        } else if (key === 'semesterDiff') {
            left = a.semesterDiff ?? -999;
            right = b.semesterDiff ?? -999;
        } else {
            left = a[key];
            right = b[key];
        }
        const ln = Number(left),
            rn = Number(right);
        if (Number.isFinite(ln) && Number.isFinite(rn)) {
            if (ln === rn) return String(a.teacher).localeCompare(String(b.teacher), 'ar');
            return (ln - rn) * dir;
        }
        return String(left || '').localeCompare(String(right || ''), 'ar') * dir;
    });
    return sorted;
}

function rowSubjectLabel(row, subjectFilter) {
    if (subjectFilter) return subjectFilter;
    if (!row.subjects.length) return '-';
    if (row.subjects.length === 1) return row.subjects[0];
    return `متعددة (${row.subjects.length})`;
}

function rowSectionLabel(row) {
    if (!row.sections.length) return '-';
    if (row.sections.length <= 2) return row.sections.join(' - ');
    return `${row.sections[0]} - ${row.sections[1]} +${row.sections.length - 2}`;
}

function renderSortIndicators() {
    document.querySelectorAll('.tp-sort-ind').forEach((el) => {
        el.textContent = '';
    });
    const target = document.getElementById(`sort-${sortState.key}`);
    if (target) target.textContent = sortState.direction === 'asc' ? '▲' : '▼';
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

    if (kpiView === 'subject') {
        renderKpisBySubject(baseFiltered, container);
        return;
    }

    const studentCount = new Set(baseFiltered.map(studentIdentity)).size;
    const teachersCount = rows.length;
    const allGrades = baseFiltered.map((g) => g.grade);
    const passRate = percentage(allGrades.filter((g) => g >= 10).length, allGrades.length);
    const globalAvg = avg(allGrades);
    const globalMedian = median(allGrades);
    const globalStdDev = stdDev(allGrades);

    const sortedByAvg = [...rows].sort((a, b) => b.avg - a.avg || b.passRate - a.passRate);
    const best = sortedByAvg[0];
    const weakest = sortedByAvg[sortedByAvg.length - 1];

    container.innerHTML = `
        <div class="tp-kpi">
            <div class="tp-kpi-icon"><i class="fas fa-chalkboard-teacher"></i></div>
            <div class="tp-kpi-label">عدد الأساتذة</div>
            <div class="tp-kpi-value">${teachersCount}</div>
            <div class="tp-kpi-sub">${studentCount} تلميذ · ${baseFiltered.length} نقطة</div>
        </div>
        <div class="tp-kpi">
            <div class="tp-kpi-icon"><i class="fas fa-calculator"></i></div>
            <div class="tp-kpi-label">المتوسط العام</div>
            <div class="tp-kpi-value">${globalAvg.toFixed(2)}</div>
            <div class="tp-kpi-sub">الوسيط: ${globalMedian.toFixed(2)} · σ: ${globalStdDev.toFixed(2)}</div>
        </div>
        <div class="tp-kpi">
            <div class="tp-kpi-icon"><i class="fas fa-percentage"></i></div>
            <div class="tp-kpi-label">نسبة النجاح العامة</div>
            <div class="tp-kpi-value">${passRate.toFixed(1)}%</div>
            <div class="tp-kpi-sub">نقطة النجاح: 10/20</div>
        </div>
        <div class="tp-kpi">
            <div class="tp-kpi-icon"><i class="fas fa-trophy"></i></div>
            <div class="tp-kpi-label">أفضل أستاذ</div>
            <div class="tp-kpi-value">${best ? escapeHtml(best.teacher) : '-'}</div>
            <div class="tp-kpi-sub">${best ? `${best.avg.toFixed(2)} · ${best.passRate.toFixed(1)}%` : '-'}</div>
        </div>
        <div class="tp-kpi">
            <div class="tp-kpi-icon"><i class="fas fa-book-open"></i></div>
            <div class="tp-kpi-label">أفضل مادة</div>
            <div class="tp-kpi-value">${getBestSubject(baseFiltered)}</div>
            <div class="tp-kpi-sub">أعلى معدل بين المواد</div>
        </div>
        <div class="tp-kpi">
            <div class="tp-kpi-icon"><i class="fas fa-arrow-trend-down"></i></div>
            <div class="tp-kpi-label">أضعف أستاذ</div>
            <div class="tp-kpi-value">${weakest && rows.length > 1 ? escapeHtml(weakest.teacher) : '-'}</div>
            <div class="tp-kpi-sub">${weakest && rows.length > 1 ? `${weakest.avg.toFixed(2)} · ${weakest.passRate.toFixed(1)}%` : '-'}</div>
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

/* ─── Absence by Teacher Chart ─── */
function renderAbsenceByTeacherChart(rows) {
    const canvas = document.getElementById('tp-absence-by-teacher-chart');
    const meta = document.getElementById('tp-absence-meta');
    if (!canvas || !meta || !window.Chart) return;
    destroyChart('absenceByTeacher');

    if (!rows.length || !allAbsencesCache.length) {
        meta.textContent = 'لا توجد بيانات غياب أو أساتذة للعرض.';
        return;
    }

    // Build teacher → sections map from grades data
    const teacherSections = new Map();
    rows.forEach((row) => {
        row.sections.forEach((sec) => {
            if (!teacherSections.has(row.teacherKey))
                teacherSections.set(row.teacherKey, { teacher: row.teacher, sections: new Set() });
            teacherSections.get(row.teacherKey).sections.add(sec);
        });
    });

    // Compute total & average absence hours per teacher's sections
    const teacherAbsence = [];
    teacherSections.forEach((entry, teacherKey) => {
        let totalHours = 0;
        allAbsencesCache.forEach((a) => {
            if (a._section && entry.sections.has(a._section)) totalHours += a._hours;
        });
        // Student count from rows data
        const rowData = rows.find((r) => r.teacherKey === teacherKey);
        const studentCount = rowData ? rowData.studentCount : 0;
        const avgHours = studentCount > 0 ? totalHours / studentCount : 0;
        teacherAbsence.push({ teacher: entry.teacher, totalHours, studentCount, avgHours });
    });

    if (!teacherAbsence.length) {
        meta.textContent = 'لا توجد بيانات غياب مرتبطة بالأساتذة.';
        return;
    }

    // Sort by average and pick top 5 most + top 5 least
    const sorted = [...teacherAbsence].sort((a, b) => b.avgHours - a.avgHours);
    const top5Most = sorted.slice(0, 5);
    const top5Least = sorted
        .filter((t) => t.avgHours >= 0)
        .slice(-5)
        .reverse();

    // Merge: most first, then least (avoid duplicates)
    const leastNames = new Set(top5Least.map((t) => t.teacher));
    const mostFiltered = top5Most.filter((t) => !leastNames.has(t.teacher));
    const combined = [...mostFiltered, ...top5Least];

    // If all are the same (e.g. < 10 teachers), just show sorted
    const finalList = combined.length > 0 ? combined : sorted.slice(0, 10);

    const labels = finalList.map((t) => t.teacher);
    const data = finalList.map((t) => t.avgHours);
    const colors = finalList.map((t) => {
        const isMost = top5Most.some((m) => m.teacher === t.teacher);
        return isMost ? 'rgba(231, 76, 60, 0.80)' : 'rgba(47, 179, 109, 0.80)';
    });

    charts.absenceByTeacher = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'متوسط ساعات الغياب / تلميذ',
                    data,
                    backgroundColor: colors,
                    borderRadius: 6,
                    borderSkipped: false
                }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 700, easing: 'easeOutQuart' },
            plugins: {
                legend: { display: false },
                tooltip: {
                    rtl: true,
                    textDirection: 'rtl',
                    callbacks: {
                        label: (ctx) => `متوسط: ${Number(ctx.raw).toFixed(2)} ساعة / تلميذ`,
                        afterBody: (items) => {
                            const t = finalList[items[0]?.dataIndex];
                            if (!t) return '';
                            const isMost = top5Most.some((m) => m.teacher === t.teacher);
                            return [
                                `الإجمالي: ${t.totalHours.toFixed(0)} ساعة  |  ${t.studentCount} تلميذ`,
                                isMost ? '🔴 من الأكثر غياباً' : '🟢 من الأقل غياباً'
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    position: 'top',
                    reverse: true,
                    min: 0,
                    ticks: { callback: (v) => `${v}h` },
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                y: {
                    position: 'right',
                    grid: { display: false },
                    ticks: {
                        crossAlign: 'far',
                        font: { family: "'IBM Plex Sans Arabic', sans-serif", weight: '600' },
                        textDirection: 'rtl'
                    }
                }
            }
        }
    });

    const totalAbsAllTeachers = teacherAbsence.reduce((s, t) => s + t.totalHours, 0);
    const globalAvgAbs = teacherAbsence.length
        ? teacherAbsence.reduce((s, t) => s + t.avgHours, 0) / teacherAbsence.length
        : 0;
    meta.textContent = `${teacherAbsence.length} أستاذ · متوسط الغياب: ${globalAvgAbs.toFixed(2)} ساعة/تلميذ · الإجمالي: ${totalAbsAllTeachers.toFixed(0)} ساعة. 🔴 الأكثر  🟢 الأقل`;
    updateChartAccessibility(
        'tp-absence-by-teacher-chart',
        'رسم بياني يوضح غيابات التلاميذ حسب الأستاذ',
        'tp-absence-meta',
        meta.textContent
    );
}

/* ─── Chart.js Loading: window.ensureChartJsLoaded (js/shared/chart-theme.js) ─── */

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

/* ─── Comparison Chart ─── */
function renderComparisonChart(rows) {
    const canvas = document.getElementById('tp-teacher-compare-chart');
    const meta = document.getElementById('tp-comparison-meta');
    if (!canvas || !meta || !window.Chart) return;
    destroyChart('comparison');
    if (!rows.length) {
        meta.textContent = 'لا توجد أسماء أساتذة صالحة للمقارنة.';
        return;
    }

    const sorted = [...rows].sort((a, b) => b.passRate - a.passRate || b.avg - a.avg);
    const top5Best = sorted.slice(0, 5);
    const top5Worst = sorted.slice(-5).reverse();

    // Remove duplicates (if < 10 teachers)
    const worstNames = new Set(top5Worst.map((r) => r.teacher));
    const bestFiltered = top5Best.filter((r) => !worstNames.has(r.teacher));
    const combined = [...bestFiltered, ...top5Worst];
    const finalList = combined.length > 0 ? combined : sorted.slice(0, 10);

    const labels = finalList.map((r) => r.teacher);
    const data = finalList.map((r) => Number(r.passRate.toFixed(1)));
    const colors = finalList.map((r) => {
        if (r.teacherKey === selectedTeacherName) return 'rgba(59, 106, 197, 0.95)';
        const isBest = top5Best.some((b) => b.teacher === r.teacher);
        return isBest ? 'rgba(47, 179, 109, 0.85)' : 'rgba(231, 76, 60, 0.85)';
    });

    charts.comparison = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'نسبة النجاح (%)', data, backgroundColor: colors, borderRadius: 6, borderSkipped: false }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 700, easing: 'easeOutQuart' },
            plugins: {
                legend: { display: false },
                tooltip: {
                    rtl: true,
                    textDirection: 'rtl',
                    callbacks: {
                        label: (ctx) => `نسبة النجاح: ${Number(ctx.raw).toFixed(1)}%`,
                        afterBody: (items) => {
                            const idx = items[0]?.dataIndex ?? -1;
                            const r = finalList[idx];
                            if (!r) return '';
                            const isBest = top5Best.some((b) => b.teacher === r.teacher);
                            return [
                                `متوسط النقاط: ${r.avg.toFixed(2)}`,
                                `التلاميذ: ${r.studentCount}`,
                                `التصنيف: ${r.rating.stars} ${r.rating.label}`,
                                isBest ? '🟢 من الأفضل' : '🔴 من الأضعف'
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    position: 'top',
                    reverse: true,
                    min: 0,
                    max: 100,
                    ticks: { stepSize: 20, callback: (v) => `${v}%` },
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                y: {
                    position: 'right',
                    grid: { display: false },
                    ticks: {
                        crossAlign: 'far',
                        font: { family: "'IBM Plex Sans Arabic', sans-serif", weight: '600' },
                        textDirection: 'rtl'
                    }
                }
            }
        }
    });

    const globalPassRate = avg(rows.map((r) => r.passRate));
    meta.textContent = `${rows.length} أستاذ. 🟢 الأفضل: ${top5Best[0].teacher} (${top5Best[0].passRate.toFixed(1)}%) · 🔴 الأضعف: ${sorted[sorted.length - 1].teacher} (${sorted[sorted.length - 1].passRate.toFixed(1)}%) · متوسط: ${globalPassRate.toFixed(1)}%`;
    updateChartAccessibility(
        'tp-teacher-compare-chart',
        'رسم بياني يقارن نسب نجاح الأساتذة',
        'tp-comparison-meta',
        meta.textContent
    );
}

/* ─── Teacher Table ─── */
function renderTeacherTable(rows, subjectFilter) {
    const body = document.getElementById('tp-table-body');
    if (!body) return;
    renderSortIndicators();

    if (!rows.length) {
        body.innerHTML =
            '<tr><td colspan="9" style="text-align:center;padding:16px;"><div class="tp-empty-state"><i class="fas fa-table"></i><p>لا توجد معطيات</p></div></td></tr>';
        return;
    }

    const sorted = getSortedRows(rows);
    body.innerHTML = sorted
        .map((row) => {
            const pillAvg = getAvgPillClass(row.avg);
            const pillPass = getPassRatePillClass(row.passRate);
            const diffHtml =
                row.semesterDiff !== null
                    ? `<span style="color:${row.semesterDiff >= 0 ? 'var(--color-success)' : 'var(--color-danger)'};font-weight:700;">${row.semesterDiff >= 0 ? '+' : ''}${row.semesterDiff.toFixed(2)}</span>`
                    : '<span style="color:var(--color-text-light);">-</span>';
            return `
            <tr data-teacher="${escapeHtml(row.teacherKey)}" class="${row.teacherKey === selectedTeacherName ? 'tp-row-selected' : ''}">
                <td>${escapeHtml(row.teacher)}</td>
                <td>${escapeHtml(rowSubjectLabel(row, subjectFilter))}</td>
                <td title="${escapeHtml(row.sections.join(' - '))}">${escapeHtml(rowSectionLabel(row))}</td>
                <td>${row.studentCount}</td>
                <td><span class="tp-pill ${pillAvg}">${row.avg.toFixed(2)}</span></td>
                <td><span class="tp-pill ${pillPass}">${row.passRate.toFixed(1)}%</span></td>
                <td><span class="tp-rating ${row.rating.cls}">${row.rating.stars} ${row.rating.label}</span></td>
                <td>${diffHtml}</td>
                <td>${escapeHtml(formatDateTime(row.lastImportedMs))}</td>
            </tr>
        `;
        })
        .join('');
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

    // Calculate benchmark: what % of same-subject teachers does this teacher beat?
    const sameSubjectRows = rows.filter((r) => {
        if (row.subjects.length === 1 && r.subjects.length >= 1) return r.subjects.includes(row.subjects[0]);
        return true;
    });
    const rank = sameSubjectRows.filter((r) => r.avg <= row.avg).length;
    const benchmarkPct = sameSubjectRows.length > 1 ? Math.round(percentage(rank, sameSubjectRows.length)) : 100;

    nameNode.innerHTML = `${escapeHtml(row.teacher)} <span class="tp-rating ${row.rating.cls}" style="font-size:14px;">${row.rating.stars} ${row.rating.label}</span>`;
    metaNode.innerHTML = `
        <span class="tp-badge"><i class="fas fa-percent"></i> ${row.passRate.toFixed(1)}%</span>
        <span class="tp-badge"><i class="fas fa-calculator"></i> ${row.avg.toFixed(2)} / 20</span>
        <span class="tp-badge"><i class="fas fa-user-graduate"></i> ${studentCount} تلميذ</span>
        <span class="tp-badge"><i class="fas fa-list-check"></i> ${row.gradeCount} نقطة</span>
        <span class="tp-badge"><i class="fas fa-table-cells"></i> ${row.sectionsCount} قسم</span>
    `;

    // Benchmark bar
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
        noteNode.textContent = 'لا توجد فروض مرقمة لعرض تطور زمني.';
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

    const sectionDatasets = !showSections ? [] : sections.slice(0, 8).map((sec, i) => ({
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
    noteNode.textContent = `تطور عبر ${examKeys.length} فروض مرقمة${sectionInfo}.`;
    updateChartAccessibility(
        'tp-trend-chart',
        'رسم بياني يوضح تطور الأداء بين الفروض حسب القسم',
        'tp-trend-note',
        noteNode.textContent
    );
}

/* ─── Semester Comparison Chart (NEW) ─── */
function renderSemesterCompareChart(rows) {
    const canvas = document.getElementById('tp-semester-compare-chart');
    const note = document.getElementById('tp-semester-compare-note');
    if (!canvas || !note || !window.Chart) return;
    destroyChart('semesterCompare');

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

/* ─── Radar Chart (NEW) ─── */
function renderRadarChart(rows) {
    const canvas = document.getElementById('tp-radar-chart');
    const note = document.getElementById('tp-radar-note');
    if (!canvas || !note || !window.Chart) return;
    destroyChart('radar');

    if (!selectedTeacherName || !rows.length) {
        note.textContent = 'اختر أستاذ من الجدول.';
        return;
    }
    const row = rows.find((r) => r.teacherKey === selectedTeacherName) || rows[0];
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
    const headers = [
        'الأستاذ',
        'المادة',
        'الأقسام',
        'التلاميذ',
        'المعدل',
        'نسبة النجاح',
        'التصنيف',
        'فرق الدورتين',
        'آخر استيراد'
    ];
    const csvRows = ['\uFEFF' + headers.join(',')];
    getSortedRows(teacherRowsCache).forEach((row) => {
        csvRows.push(
            [
                csvEscape(row.teacher),
                csvEscape(rowSubjectLabel(row, currentSubjectFilter)),
                row.sectionsCount,
                row.studentCount,
                row.avg.toFixed(2),
                row.passRate.toFixed(1) + '%',
                csvEscape(row.rating.label),
                row.semesterDiff !== null ? row.semesterDiff.toFixed(2) : '-',
                csvEscape(formatDateTime(row.lastImportedMs))
            ].join(',')
        );
    });
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `teachers-performance-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast('تم تصدير التقرير بنجاح', 'success');
}

/* ─── Print / PDF ─── */
function buildPrintHTML() {
    const kpisHtml = document.getElementById('tp-kpis')?.innerHTML || '';
    const tableHtml = document.querySelector('.tp-table-wrap')?.innerHTML || '';

    const canvasImages = [];
    document.querySelectorAll('.tp-chart-wrap canvas').forEach((canvas) => {
        try {
            canvasImages.push(`<div style="margin:12px 0;"><img src="${canvas.toDataURL('image/png')}" style="max-width:100%;height:auto;" /></div>`);
        } catch (_) {}
    });

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<title>تقرير مؤشرات أداء الأساتذة</title>
<style>
  body { font-family: 'IBM Plex Sans Arabic', Arial, sans-serif; font-size: 13px; color: #222; direction: rtl; }
  h1 { font-size: 18px; margin-bottom: 12px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px; }
  .kpi-card { border: 1px solid #ddd; border-radius: 8px; padding: 12px; text-align: center; }
  .kpi-label { font-size: 11px; color: #666; }
  .kpi-value { font-size: 20px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; }
  th, td { border: 1px solid #ddd; padding: 4px 6px; text-align: right; }
  th { background: #f5f5f5; font-weight: 600; }
</style>
</head>
<body>
<h1><i>مؤشرات أداء الأساتذة</i> — تقرير ${new Date().toLocaleDateString('ar-MA')}</h1>
<div class="kpi-grid">${kpisHtml}</div>
<h2 style="font-size:14px;margin:16px 0 8px;">الجدول التفصيلي</h2>
<table>${tableHtml}</table>
<h2 style="font-size:14px;margin:16px 0 8px;">الرسوم البيانية</h2>
${canvasImages.join('')}
</body>
</html>`;
}

async function printReport() {
    if (!teacherRowsCache.length) {
        showToast('لا توجد بيانات للطباعة', 'error');
        return;
    }
    const handle = showToast.loading('جاري تجهيز التقرير...');
    try {
        const html = buildPrintHTML();
        const result = await window.electronAPI.printHTML({
            htmlContent: html,
            title: 'تقرير مؤشرات أداء الأساتذة',
            pageSize: 'A4',
            landscape: true,
            mode: 'preview',
            defaultFileName: `teachers-performance-${new Date().toISOString().slice(0, 10)}.pdf`
        });
        if (result?.success) handle.success('تم تصدير التقرير');
        else handle.error(result?.error || 'فشل التصدير');
    } catch (_) {
        handle.error('فشل التصدير');
    }
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
        teacherRowsCache = rows;

        renderStateLine(baseFiltered, rows);
        renderKpis(baseFiltered, rows);
        if (chartLoadFailed) {
            const chartMsg = 'تعذر تحميل مكتبة الرسوم البيانية';
            showChartFallback('tp-teacher-compare-chart', chartMsg);
            showChartFallback('tp-absence-by-teacher-chart', chartMsg);
            showChartFallback('tp-section-chart', chartMsg);
            showChartFallback('tp-distribution-chart', chartMsg);
            showChartFallback('tp-trend-chart', chartMsg);
            showChartFallback('tp-semester-compare-chart', chartMsg);
            showChartFallback('tp-radar-chart', chartMsg);
        } else {
            renderComparisonChart(rows);
            renderAbsenceByTeacherChart(rows);
            renderTeacherCard(baseFiltered, rows);
            renderSemesterCompareChart(rows);
            renderRadarChart(rows);
        }

        renderTeacherTable(rows, currentSubjectFilter);
    } catch (error) {
        console.error('Teacher performance analysis error:', error);
        showToast('تعذر تنفيذ التحليل', 'error');
    } finally {
        hideLoading();
        if (analyzeBtn) {
            analyzeBtn.disabled = false;
            analyzeBtn.removeAttribute('aria-busy');
        }
    }
}

/* ─── Compensation & Support Block ─── */
async function loadCompensationAndSupportData() {
    const year = await getCurrentYear();

    let compRecords = [];
    try {
        compRecords = (await window.api.compensation.getAll(year)) ?? [];
    } catch (_) {}

    let supportSessions = [];
    try {
        supportSessions = (await window.api.supportSessions.list({ school_year: year })) ?? [];
    } catch (_) {}

    await ensureChartJsLoaded().catch(() => {});
    if (!window.Chart) return;

    renderCompensationByTeacherChart(compRecords);
    renderAffectedSectionsChart(compRecords);
    renderSupportSessionsChart(supportSessions);
}

function renderCompensationByTeacherChart(records) {
    const canvas = document.getElementById('tp-comp-chart');
    const meta = document.getElementById('tp-comp-meta');
    if (!canvas || !meta || !window.Chart) return;
    destroyChart('compByTeacher');

    if (!records.length) {
        meta.textContent = 'لا توجد بيانات حصص تعويضية.';
        return;
    }

    const pending = records.filter((r) => !r.compensated);
    const done = records.filter((r) => r.compensated);

    const byTeacher = {};
    records.forEach((r) => {
        const t = r.teacher_name || 'غير محدد';
        if (!byTeacher[t]) byTeacher[t] = { pending: 0, done: 0 };
        if (r.compensated) byTeacher[t].done++;
        else byTeacher[t].pending++;
    });

    const sorted = Object.entries(byTeacher)
        .sort((a, b) => b[1].pending + b[1].done - (a[1].pending + a[1].done))
        .slice(0, 10);

    const labels = sorted.map(([name]) => name);
    charts.compByTeacher = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'في الانتظار',
                    data: sorted.map(([, v]) => v.pending),
                    backgroundColor: 'rgba(231,76,60,0.80)',
                    borderRadius: 4,
                    borderSkipped: false
                },
                {
                    label: 'تم التعويض',
                    data: sorted.map(([, v]) => v.done),
                    backgroundColor: 'rgba(47,179,109,0.80)',
                    borderRadius: 4,
                    borderSkipped: false
                }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 650 },
            plugins: {
                legend: { position: 'top', labels: { usePointStyle: true, padding: 12 } },
                tooltip: { rtl: true, textDirection: 'rtl' }
            },
            scales: {
                x: {
                    position: 'top',
                    reverse: true,
                    ticks: { precision: 0 },
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                y: {
                    position: 'right',
                    grid: { display: false },
                    ticks: { font: { family: "'IBM Plex Sans Arabic', sans-serif", weight: '600' } }
                }
            }
        }
    });

    meta.textContent = `${records.length} حصة إجمالاً · ${pending.length} في الانتظار · ${done.length} معوَّضة`;
    updateChartAccessibility('tp-comp-chart', 'رسم يوضح الحصص التعويضية حسب الأستاذ', 'tp-comp-meta', meta.textContent);
}

function renderAffectedSectionsChart(records) {
    const canvas = document.getElementById('tp-sections-comp-chart');
    const meta = document.getElementById('tp-sections-comp-meta');
    if (!canvas || !meta || !window.Chart) return;
    destroyChart('sectionsComp');

    const pending = records.filter((r) => !r.compensated);
    if (!pending.length) {
        meta.textContent = 'لا توجد أقسام متضررة بدون تعويض.';
        return;
    }

    const bySection = {};
    pending.forEach((r) => {
        const sec = r.section || 'غير محدد';
        bySection[sec] = (bySection[sec] || 0) + 1;
    });

    const sorted = Object.entries(bySection)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12);

    charts.sectionsComp = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: sorted.map(([sec]) => sec),
            datasets: [
                {
                    label: 'حصص غير معوَّضة',
                    data: sorted.map(([, n]) => n),
                    backgroundColor: 'rgba(231,76,60,0.75)',
                    borderRadius: 4,
                    borderSkipped: false
                }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 650 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    rtl: true,
                    textDirection: 'rtl',
                    callbacks: { label: (ctx) => `${ctx.raw} حصة غير معوَّضة` }
                }
            },
            scales: {
                x: {
                    position: 'top',
                    reverse: true,
                    ticks: { precision: 0 },
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                y: {
                    position: 'right',
                    grid: { display: false },
                    ticks: { font: { family: "'IBM Plex Sans Arabic', sans-serif", weight: '600' } }
                }
            }
        }
    });

    meta.textContent = `${sorted.length} قسم متضرر · ${pending.length} حصة لم تُعوَّض بعد`;
    updateChartAccessibility('tp-sections-comp-chart', 'رسم يوضح الأقسام المتضررة بدون تعويض', 'tp-sections-comp-meta', meta.textContent);
}

function renderSupportSessionsChart(sessions) {
    const canvas = document.getElementById('tp-support-chart');
    const meta = document.getElementById('tp-support-meta');
    if (!canvas || !meta || !window.Chart) return;
    destroyChart('supportSessions');

    if (!sessions.length) {
        meta.textContent = 'لا توجد بيانات حصص دعم مسجلة.';
        return;
    }

    const byTeacher = {};
    sessions.forEach((s) => {
        const t = s.teacher_name || 'غير محدد';
        if (!byTeacher[t]) byTeacher[t] = { hours: 0, count: 0 };
        byTeacher[t].hours += Number(s.duration_hours) || 0;
        byTeacher[t].count++;
    });

    const sorted = Object.entries(byTeacher)
        .sort((a, b) => b[1].hours - a[1].hours)
        .slice(0, 10);

    charts.supportSessions = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: sorted.map(([name]) => name),
            datasets: [
                {
                    label: 'ساعات الدعم',
                    data: sorted.map(([, v]) => Number(v.hours.toFixed(1))),
                    backgroundColor: 'rgba(59,106,197,0.80)',
                    borderRadius: 4,
                    borderSkipped: false
                }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 650 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    rtl: true,
                    textDirection: 'rtl',
                    callbacks: {
                        label: (ctx) => `${ctx.raw} ساعة`,
                        afterBody: (items) => {
                            const t = sorted[items[0]?.dataIndex];
                            return t ? [`${t[1].count} حصة`] : '';
                        }
                    }
                }
            },
            scales: {
                x: {
                    position: 'top',
                    reverse: true,
                    ticks: { callback: (v) => `${v}h` },
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                y: {
                    position: 'right',
                    grid: { display: false },
                    ticks: { font: { family: "'IBM Plex Sans Arabic', sans-serif", weight: '600' } }
                }
            }
        }
    });

    const totalHours = sessions.reduce((s, r) => s + (Number(r.duration_hours) || 0), 0);
    const uniqueTeachers = new Set(sessions.map((s) => s.teacher_name)).size;
    meta.textContent = `${sessions.length} حصة دعم · ${totalHours.toFixed(1)} ساعة · ${uniqueTeachers} أستاذ`;
    updateChartAccessibility('tp-support-chart', 'رسم يوضح حصص الدعم المنجزة حسب الأستاذ', 'tp-support-meta', meta.textContent);
}
