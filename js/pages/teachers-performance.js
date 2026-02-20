/* ═══════════════════════════════════════════════════════
   Teachers Performance – مؤشرات أداء الأساتذة
   ═══════════════════════════════════════════════════════ */

const DEFAULT_YEAR = '2025/2026';
const CHART_JS_CDN = 'vendor/chart.min.js';

let chartLoaderPromise = null;
let allGradesCache = [];
let sectionToLevel = {};
let teacherRowsCache = [];
let selectedTeacherName = '';

const charts = {};
const sortState = { key: 'passRate', direction: 'desc' };
let currentSubjectFilter = '';

const gradeBands = [
    { label: 'ممتاز (16-20)', min: 16, max: 20, color: 'rgba(47, 179, 109, 0.85)' },
    { label: 'جيد (14-16)', min: 14, max: 15.99, color: 'rgba(60, 149, 208, 0.85)' },
    { label: 'حسن (12-14)', min: 12, max: 13.99, color: 'rgba(100, 180, 246, 0.85)' },
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
    if (resetBtn) resetBtn.addEventListener('click', () => {
        [levelFilter, classFilter, subjectFilter, semesterFilter, teacherFilter].forEach(s => { if (s) s.value = ''; });
        selectedTeacherName = '';
        renderClassFilter(); renderSubjectFilter(); renderSemesterFilter(); renderTeacherFilter();
        runAnalysis();
    });

    if (levelFilter) levelFilter.addEventListener('change', () => {
        renderClassFilter(); renderSubjectFilter(); renderSemesterFilter(); renderTeacherFilter();
    });
    if (classFilter) classFilter.addEventListener('change', () => {
        renderSubjectFilter(); renderSemesterFilter(); renderTeacherFilter();
    });
    if (subjectFilter) subjectFilter.addEventListener('change', () => {
        renderSemesterFilter(); renderTeacherFilter();
    });
    if (semesterFilter) semesterFilter.addEventListener('change', () => renderTeacherFilter());

    if (teacherFilter) teacherFilter.addEventListener('change', () => {
        selectedTeacherName = teacherFilter.value;
        runAnalysis();
    });

    // Table header sort
    document.querySelectorAll('.tp-table th[data-sort-key]').forEach(th => {
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
}

/* ─── Data Loading ─── */
function getCurrentYear() {
    const stored = typeof window.api?.settings?.get === 'function'
        ? null : null;
    return DEFAULT_YEAR;
}

async function loadInitialData() {
    const year = getCurrentYear();
    const [gradesRaw, levelsMappingRaw] = await Promise.all([
        window.api.grades.getAll(year),
        window.api.settings.get('levelsMapping')
    ]);

    try {
        sectionToLevel = levelsMappingRaw ? JSON.parse(levelsMappingRaw) : {};
    } catch (_) {
        sectionToLevel = {};
    }

    allGradesCache = (gradesRaw || [])
        .map(grade => {
            const value = Number(grade.grade);
            if (!Number.isFinite(value)) return null;
            const subjectRaw = String(grade.subject || '').trim();
            const teacherRaw = String(grade.teacher_name || '').trim();
            const cleanTeacher = sanitizeTeacherName(teacherRaw);
            return {
                ...grade,
                grade: value,
                _subjectRaw: subjectRaw,
                _subject: normalizeSubjectName(subjectRaw),
                _teacherRaw: teacherRaw,
                _teacher: cleanTeacher,
                _level: getLevelFromSection(grade.section),
                _examNo: extractExamNumber(subjectRaw),
                _createdAtMs: parseDateMs(grade.created_at)
            };
        })
        .filter(Boolean);

    renderLevelFilter();
    renderClassFilter();
    renderSubjectFilter();
    renderSemesterFilter();
    renderTeacherFilter();
}

/* ─── Filter Renderers ─── */
function renderLevelFilter() {
    const select = document.getElementById('tp-level-filter');
    if (!select) return;
    const previous = select.value;
    const levels = Array.from(new Set(allGradesCache.map(g => g._level).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ar'));
    select.innerHTML = '<option value="">كل المستويات</option>';
    levels.forEach(level => { const o = document.createElement('option'); o.value = level; o.textContent = level; select.appendChild(o); });
    if (previous && levels.includes(previous)) select.value = previous;
}

function renderClassFilter() {
    const level = document.getElementById('tp-level-filter')?.value || '';
    const s = document.getElementById('tp-class-filter');
    if (!s) return;
    const prev = s.value;
    const classes = Array.from(new Set(allGradesCache.filter(g => !level || g._level === level).map(g => String(g.section || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ar'));
    s.innerHTML = '<option value="">كل الأقسام</option>';
    classes.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; s.appendChild(o); });
    if (prev && classes.includes(prev)) s.value = prev;
}

function renderSubjectFilter() {
    const level = document.getElementById('tp-level-filter')?.value || '';
    const className = document.getElementById('tp-class-filter')?.value || '';
    const s = document.getElementById('tp-subject-filter');
    if (!s) return;
    const prev = s.value;
    const subjects = Array.from(new Set(allGradesCache.filter(g => (!level || g._level === level) && (!className || String(g.section || '') === className)).map(g => g._subject).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ar'));
    s.innerHTML = '<option value="">كل المواد</option>';
    subjects.forEach(sub => { const o = document.createElement('option'); o.value = sub; o.textContent = sub; s.appendChild(o); });
    if (prev && subjects.includes(prev)) s.value = prev;
}

function renderSemesterFilter() {
    const level = document.getElementById('tp-level-filter')?.value || '';
    const className = document.getElementById('tp-class-filter')?.value || '';
    const subject = document.getElementById('tp-subject-filter')?.value || '';
    const s = document.getElementById('tp-semester-filter');
    if (!s) return;
    const prev = s.value;
    const semesters = Array.from(new Set(allGradesCache.filter(g => (!level || g._level === level) && (!className || String(g.section || '') === className) && (!subject || g._subject === subject)).map(g => Number(g.semester)).filter(n => Number.isFinite(n) && n > 0))).sort((a, b) => a - b);
    s.innerHTML = '<option value="">كل الدورات</option>';
    semesters.forEach(sem => { const o = document.createElement('option'); o.value = String(sem); o.textContent = `الدورة ${sem}`; s.appendChild(o); });
    if (prev && semesters.includes(Number(prev))) s.value = prev;
}

function renderTeacherFilter() {
    const base = getBaseFilteredGrades();
    const s = document.getElementById('tp-teacher-filter');
    if (!s) return;
    const prev = s.value || selectedTeacherName;
    const teachers = Array.from(new Set(base.map(g => g._teacher).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ar'));
    s.innerHTML = '<option value="">كل الأساتذة</option>';
    teachers.forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t; s.appendChild(o); });
    if (prev && teachers.includes(prev)) { s.value = prev; selectedTeacherName = prev; }
    else if (selectedTeacherName && !teachers.includes(selectedTeacherName)) selectedTeacherName = '';
}

/* ─── Utility Functions ─── */
function getLevelFromSection(section) {
    const value = String(section || '').trim();
    if (!value) return '';
    if (sectionToLevel[value]) return sectionToLevel[value];
    const compact = value.replace(/[\s_]/g, '').toUpperCase();
    if (compact.startsWith('TCS')) return 'الجذع المشترك';
    if (compact.startsWith('1BACSEF')) return 'الأولى باكالوريا العلوم التجريبية - خيار فرنسية';
    if (compact.startsWith('1BACSMF')) return 'الأولى باكالوريا العلوم الرياضية - خيار فرنسية';
    if (compact.startsWith('1BACSH')) return 'الأولى باكالوريا العلوم الإنسانية';
    if (compact.startsWith('1BACSEG')) return 'الأولى باكالوريا العلوم الاقتصادية والتدبير';
    if (compact.startsWith('1BAC')) return 'الأولى باكالوريا';
    if (compact.startsWith('2BACSPF')) return 'الثانية باكالوريا العلوم الفيزيائية - خيار فرنسية';
    if (compact.startsWith('2BACSE')) return 'الثانية باكالوريا علوم الحياة والأرض';
    if (compact.startsWith('2BACSH')) return 'الثانية باكالوريا العلوم الإنسانية';
    if (compact.startsWith('2BAC')) return 'الثانية باكالوريا';
    if (value.includes('-')) return value.split('-')[0].trim();
    if (value.includes(' ')) return value.split(' ')[0].trim();
    return value;
}

function getBaseFilteredGrades() {
    const level = document.getElementById('tp-level-filter')?.value || '';
    const className = document.getElementById('tp-class-filter')?.value || '';
    const subject = document.getElementById('tp-subject-filter')?.value || '';
    const semester = Number(document.getElementById('tp-semester-filter')?.value || 0);
    return allGradesCache.filter(g => {
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

function normalizeSubjectName(subject) {
    const clean = String(subject || '')
        .replace(/\s*\(\s*فرض\s*\d+\s*\)\s*$/i, '')
        .replace(/\s*\(الأنشطة المندمجة\)\s*$/i, '')
        .trim();
    return clean || 'غير محدد';
}

function normalizeLoose(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/[\u064B-\u065F]/g, '').replace(/[^a-z0-9\u0600-\u06FF]+/g, '');
}

function sanitizeTeacherName(value) {
    const raw = String(value || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    if (!raw) return '';
    if (/^\d+([.,]\d+)?$/.test(raw)) return '';
    const normalized = normalizeLoose(raw);
    if (!normalized) return '';
    const invalidExact = new Set(['teacher', 'teachername', 'enseignant', 'prof', 'professeur', 'استاذ', 'الاستاذ', 'الأستاذ', 'اساتذ', 'ملاحظات', 'ملاحظة', 'ملاحظاتالاستاذ', 'ملاحظاتالأستاذ', 'notes', 'note', 'observation', 'observations', 'comment', 'comments', 'remarque', 'remarques', 'غيرمحدد', 'unknown', 'na', 'n/a'].map(normalizeLoose));
    if (invalidExact.has(normalized)) return '';
    const invalidContains = ['ملاحظات', 'ملاحظة', 'observation', 'comment', 'remarque', 'notes', 'note'].map(normalizeLoose);
    if (invalidContains.some(token => normalized.includes(token))) return '';
    return raw;
}

function parseDateMs(value) { if (!value) return 0; const d = new Date(value); return Number.isFinite(d.getTime()) ? d.getTime() : 0; }

function formatDateTime(value, fallbackRaw = '') {
    const ms = Number(value) || parseDateMs(fallbackRaw);
    if (!ms) return '-';
    return new Date(ms).toLocaleString('ar-MA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function avg(values) { if (!values.length) return 0; return values.reduce((s, n) => s + n, 0) / values.length; }
function median(values) { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; }
function stdDev(values) { if (values.length < 2) return 0; const m = avg(values); return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length); }
function percentage(part, whole) { if (!whole) return 0; return (part / whole) * 100; }
function toLatinDigits(input) { return String(input || '').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))); }

function extractExamNumber(subjectRaw) {
    const normalized = toLatinDigits(subjectRaw);
    const match = normalized.match(/فرض\s*(\d+)/i);
    if (!match) return null;
    const v = Number(match[1]);
    return Number.isFinite(v) && v > 0 ? v : null;
}

function escapeHtml(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ─── Teacher Rating ─── */
function getTeacherRating(avgScore, passRate) {
    if (avgScore >= 14 && passRate >= 85) return { label: 'ممتاز', stars: '⭐⭐⭐', cls: 'tp-rating-excellent', value: 4 };
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
    grades.forEach(grade => {
        const teacher = grade._teacher;
        if (!teacher) return;
        let row = byTeacher.get(teacher);
        if (!row) {
            row = { teacher, sum: 0, count: 0, pass: 0, students: new Set(), sections: new Set(), subjects: new Set(), lastImportedMs: 0, gradeValues: [], sem1Grades: [], sem2Grades: [] };
            byTeacher.set(teacher, row);
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

    return Array.from(byTeacher.values()).map(row => {
        const avgScore = row.count ? row.sum / row.count : 0;
        const passRate = row.count ? percentage(row.pass, row.count) : 0;
        const rating = getTeacherRating(avgScore, passRate);
        const sem1Avg = row.sem1Grades.length ? avg(row.sem1Grades) : null;
        const sem2Avg = row.sem2Grades.length ? avg(row.sem2Grades) : null;
        const semesterDiff = (sem1Avg !== null && sem2Avg !== null) ? sem2Avg - sem1Avg : null;
        return {
            teacher: row.teacher,
            avg: avgScore,
            passRate,
            gradeCount: row.count,
            studentCount: row.students.size,
            sectionsCount: row.sections.size,
            sections: Array.from(row.sections).sort((a, b) => a.localeCompare(b, 'ar')),
            subjects: Array.from(row.subjects).sort((a, b) => a.localeCompare(b, 'ar')),
            lastImportedMs: row.lastImportedMs,
            gradeValues: row.gradeValues,
            rating,
            sem1Avg,
            sem2Avg,
            semesterDiff,
            sem1PassRate: row.sem1Grades.length ? percentage(row.sem1Grades.filter(g => g >= 10).length, row.sem1Grades.length) : null,
            sem2PassRate: row.sem2Grades.length ? percentage(row.sem2Grades.filter(g => g >= 10).length, row.sem2Grades.length) : null
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
        if (key === 'subject') { left = rowSubjectLabel(a, currentSubjectFilter); right = rowSubjectLabel(b, currentSubjectFilter); }
        else if (key === 'teacher') { left = a.teacher; right = b.teacher; }
        else if (key === 'rating') { left = a.rating.value; right = b.rating.value; }
        else if (key === 'semesterDiff') { left = a.semesterDiff ?? -999; right = b.semesterDiff ?? -999; }
        else { left = a[key]; right = b[key]; }
        const ln = Number(left), rn = Number(right);
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
    document.querySelectorAll('.tp-sort-ind').forEach(el => { el.textContent = ''; });
    const target = document.getElementById(`sort-${sortState.key}`);
    if (target) target.textContent = sortState.direction === 'asc' ? '▲' : '▼';
}

/* ─── KPI Rendering ─── */
function renderKpis(baseFiltered, rows) {
    const container = document.getElementById('tp-kpis');
    if (!container) return;

    if (!baseFiltered.length) {
        container.innerHTML = `<div class="tp-empty-state"><i class="fas fa-chart-line"></i><p>لا توجد نقاط مطابقة للفلاتر الحالية</p></div>`;
        return;
    }

    const studentCount = new Set(baseFiltered.map(studentIdentity)).size;
    const teachersCount = rows.length;
    const allGrades = baseFiltered.map(g => g.grade);
    const passRate = percentage(allGrades.filter(g => g >= 10).length, allGrades.length);
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

function getBestSubject(grades) {
    const bySubject = {};
    grades.forEach(g => {
        if (!g._subject) return;
        if (!bySubject[g._subject]) bySubject[g._subject] = [];
        bySubject[g._subject].push(g.grade);
    });
    let bestSub = '-', bestAvg = -1;
    for (const [subject, values] of Object.entries(bySubject)) {
        const a = avg(values);
        if (a > bestAvg) { bestAvg = a; bestSub = subject; }
    }
    return escapeHtml(bestSub);
}

/* ─── Quality Alert ─── */
function renderQualityAlert(baseFiltered) {
    const container = document.getElementById('tp-quality-alert');
    if (!container) return;

    if (!baseFiltered.length) {
        container.className = 'tp-alert';
        container.textContent = 'لا توجد معطيات ضمن الفلاتر الحالية.';
        return;
    }

    const invalidRows = baseFiltered.filter(g => !g._teacher);
    const totalSections = new Set(baseFiltered.map(g => g.section).filter(Boolean)).size;
    const coveredSections = new Set(baseFiltered.filter(g => g._teacher).map(g => g.section).filter(Boolean)).size;

    if (!invalidRows.length) {
        container.className = 'tp-alert tp-alert-ok';
        container.innerHTML = `<strong>جيد:</strong> كل السجلات تحتوي على أسماء أساتذة صالحة. التغطية: <strong>${coveredSections}/${totalSections}</strong> قسم.`;
        return;
    }

    const bySection = {};
    invalidRows.forEach(row => { const s = String(row.section || 'غير محدد'); bySection[s] = (bySection[s] || 0) + 1; });
    const topSections = Object.entries(bySection).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s, c]) => `${s} (${c})`).join('، ');

    container.className = 'tp-alert';
    container.innerHTML = `
        <strong>تنبيه جودة:</strong> ${invalidRows.length} سجل بدون اسم أستاذ صالح
        (${percentage(invalidRows.length, baseFiltered.length).toFixed(1)}%).
        التغطية: <strong>${coveredSections}/${totalSections}</strong> قسم.<br>
        الأقسام الأكثر تأثرا: ${topSections || 'غير محدد'}.
    `;
}

/* ─── Chart.js Loading ─── */
async function ensureChartJsLoaded() {
    if (window.Chart) return window.Chart;
    if (chartLoaderPromise) return chartLoaderPromise;
    chartLoaderPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-dynamic-src="${CHART_JS_CDN}"]`);
        if (existing) {
            existing.addEventListener('load', () => resolve(window.Chart), { once: true });
            existing.addEventListener('error', () => reject(new Error('تعذر تحميل مكتبة الرسوم البيانية')), { once: true });
            return;
        }
        const script = document.createElement('script');
        script.src = CHART_JS_CDN; script.async = true; script.defer = true;
        script.dataset.dynamicSrc = CHART_JS_CDN;
        script.onload = () => resolve(window.Chart);
        script.onerror = () => reject(new Error('تعذر تحميل مكتبة الرسوم البيانية'));
        document.head.appendChild(script);
    });
    return chartLoaderPromise;
}

function destroyChart(key) { if (charts[key]) charts[key].destroy(); charts[key] = null; }

/* ─── Comparison Chart ─── */
function renderComparisonChart(rows) {
    const canvas = document.getElementById('tp-teacher-compare-chart');
    const meta = document.getElementById('tp-comparison-meta');
    if (!canvas || !meta || !window.Chart) return;
    destroyChart('comparison');
    if (!rows.length) { meta.textContent = 'لا توجد أسماء أساتذة صالحة للمقارنة.'; return; }

    const topRows = [...rows].sort((a, b) => b.passRate - a.passRate || b.avg - a.avg).slice(0, 20);
    const labels = topRows.map(r => r.teacher);
    const data = topRows.map(r => Number(r.passRate.toFixed(1)));
    const colors = topRows.map(r => {
        if (r.teacher === selectedTeacherName) return 'rgba(29, 110, 82, 0.95)';
        if (r.passRate >= 85) return 'rgba(47, 179, 109, 0.85)';
        if (r.passRate >= 70) return 'rgba(60, 149, 208, 0.85)';
        if (r.passRate >= 50) return 'rgba(240, 194, 14, 0.85)';
        return 'rgba(231, 76, 60, 0.85)';
    });

    charts.comparison = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: { labels, datasets: [{ label: 'نسبة النجاح (%)', data, backgroundColor: colors, borderRadius: 6, borderSkipped: false }] },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            animation: { duration: 700, easing: 'easeOutQuart' },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => `نسبة النجاح: ${Number(ctx.raw).toFixed(1)}%`,
                        afterBody: items => {
                            const idx = items[0]?.dataIndex ?? -1;
                            const r = topRows[idx];
                            if (!r) return '';
                            return [`متوسط النقاط: ${r.avg.toFixed(2)}`, `التلاميذ: ${r.studentCount}`, `التصنيف: ${r.rating.stars} ${r.rating.label}`];
                        }
                    }
                }
            },
            scales: {
                x: { min: 0, max: 100, ticks: { stepSize: 10, callback: v => `${v}%` }, grid: { color: 'rgba(0,0,0,0.05)' } },
                y: { grid: { display: false } }
            }
        }
    });

    const globalPassRate = avg(rows.map(r => r.passRate));
    meta.textContent = `${rows.length} أستاذ. الأعلى: ${topRows[0].teacher} (${topRows[0].passRate.toFixed(1)}%). متوسط النجاح: ${globalPassRate.toFixed(1)}%.`;
}

/* ─── Teacher Table ─── */
function renderTeacherTable(rows, subjectFilter) {
    const body = document.getElementById('tp-table-body');
    if (!body) return;
    renderSortIndicators();

    if (!rows.length) {
        body.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:16px;"><div class="tp-empty-state"><i class="fas fa-table"></i><p>لا توجد معطيات</p></div></td></tr>';
        return;
    }

    const sorted = getSortedRows(rows);
    body.innerHTML = sorted.map(row => {
        const pillAvg = getAvgPillClass(row.avg);
        const pillPass = getPassRatePillClass(row.passRate);
        const diffHtml = row.semesterDiff !== null
            ? `<span style="color:${row.semesterDiff >= 0 ? 'var(--color-success)' : 'var(--color-danger)'};font-weight:700;">${row.semesterDiff >= 0 ? '+' : ''}${row.semesterDiff.toFixed(2)}</span>`
            : '<span style="color:var(--color-text-light);">-</span>';
        return `
            <tr data-teacher="${escapeHtml(row.teacher)}" class="${row.teacher === selectedTeacherName ? 'tp-row-selected' : ''}">
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
    }).join('');
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
        ['section', 'distribution', 'trend'].forEach(k => destroyChart(k));
        return;
    }

    const teacherSelect = document.getElementById('tp-teacher-filter');
    if (teacherSelect?.value) selectedTeacherName = teacherSelect.value;
    if (!selectedTeacherName || !rows.some(r => r.teacher === selectedTeacherName)) selectedTeacherName = rows[0].teacher;

    const row = rows.find(r => r.teacher === selectedTeacherName) || rows[0];
    const teacherGrades = baseFiltered.filter(g => g._teacher === row.teacher);
    const studentCount = new Set(teacherGrades.map(studentIdentity)).size;

    // Calculate benchmark: what % of same-subject teachers does this teacher beat?
    const sameSubjectRows = rows.filter(r => {
        if (row.subjects.length === 1 && r.subjects.length >= 1) return r.subjects.includes(row.subjects[0]);
        return true;
    });
    const rank = sameSubjectRows.filter(r => r.avg <= row.avg).length;
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
    teacherGrades.forEach(g => { const s = String(g.section || 'غير محدد'); if (!bySection[s]) bySection[s] = []; bySection[s].push(g.grade); });
    const labels = Object.keys(bySection).sort((a, b) => a.localeCompare(b, 'ar')).slice(0, 10);
    const values = labels.map(l => Number(avg(bySection[l]).toFixed(2)));
    charts.section = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: { labels: labels.length ? labels : ['لا توجد بيانات'], datasets: [{ label: 'متوسط القسم', data: labels.length ? values : [0], backgroundColor: 'rgba(59, 130, 246, 0.75)', borderRadius: 6, borderSkipped: false }] },
        options: { responsive: true, maintainAspectRatio: false, animation: { duration: 650, easing: 'easeOutQuart' }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `المتوسط: ${Number(ctx.raw).toFixed(2)}` } } }, scales: { y: { min: 0, max: 20, ticks: { stepSize: 4 }, grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } } }
    });
}

function renderTeacherDistributionChart(teacherGrades) {
    const canvas = document.getElementById('tp-distribution-chart');
    if (!canvas || !window.Chart) return;
    destroyChart('distribution');
    const distribution = gradeBands.map(band => ({ ...band, count: teacherGrades.filter(g => g.grade >= band.min && g.grade < band.max + (band.max === 20 ? 0.001 : 0)).length }));
    charts.distribution = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: { labels: distribution.map(d => d.label), datasets: [{ data: distribution.map(d => d.count), backgroundColor: distribution.map(d => d.color), borderColor: 'rgba(255,255,255,0.9)', borderWidth: 3, hoverOffset: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '58%', animation: { duration: 650, easing: 'easeOutQuart' }, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 14 } }, tooltip: { callbacks: { label: ctx => { const v = Number(ctx.raw || 0); return `${ctx.label}: ${v} (${percentage(v, teacherGrades.length).toFixed(1)}%)`; } } } } }
    });
}

function renderTeacherTrendChart(teacherGrades, noteNode) {
    const canvas = document.getElementById('tp-trend-chart');
    if (!canvas || !window.Chart || !noteNode) return;
    destroyChart('trend');
    const byExam = {};
    teacherGrades.forEach(g => { if (!g._examNo) return; if (!byExam[g._examNo]) byExam[g._examNo] = []; byExam[g._examNo].push(g.grade); });
    const examKeys = Object.keys(byExam).map(Number).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
    if (!examKeys.length) { noteNode.textContent = 'لا توجد فروض مرقمة لعرض تطور زمني.'; return; }
    const labels = examKeys.map(n => `فرض ${n}`);
    const values = examKeys.map(n => Number(avg(byExam[n]).toFixed(2)));
    noteNode.textContent = `تطور عبر ${examKeys.length} فروض مرقمة.`;
    charts.trend = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels, datasets: [{ label: 'متوسط الفرض', data: values, borderColor: 'rgba(22, 163, 74, 0.95)', backgroundColor: 'rgba(22, 163, 74, 0.2)', pointBackgroundColor: 'rgba(22, 163, 74, 1)', pointRadius: 4, pointHoverRadius: 5, tension: 0.35, fill: true }] },
        options: { responsive: true, maintainAspectRatio: false, animation: { duration: 650, easing: 'easeOutQuart' }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `المتوسط: ${Number(ctx.raw).toFixed(2)}` } } }, scales: { y: { min: 0, max: 20, ticks: { stepSize: 4 }, grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } } }
    });
}

/* ─── Semester Comparison Chart (NEW) ─── */
function renderSemesterCompareChart(rows) {
    const canvas = document.getElementById('tp-semester-compare-chart');
    const note = document.getElementById('tp-semester-compare-note');
    if (!canvas || !note || !window.Chart) return;
    destroyChart('semesterCompare');

    const withBoth = rows.filter(r => r.sem1Avg !== null && r.sem2Avg !== null);
    if (!withBoth.length) { note.textContent = 'لا توجد بيانات للدورتين معاً للمقارنة.'; return; }

    const top = [...withBoth].sort((a, b) => Math.abs(b.semesterDiff) - Math.abs(a.semesterDiff)).slice(0, 15);
    const labels = top.map(r => r.teacher);

    charts.semesterCompare = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'الدورة 1', data: top.map(r => Number(r.sem1Avg.toFixed(2))), backgroundColor: 'rgba(59, 130, 246, 0.75)', borderRadius: 4, borderSkipped: false },
                { label: 'الدورة 2', data: top.map(r => Number(r.sem2Avg.toFixed(2))), backgroundColor: 'rgba(22, 163, 74, 0.75)', borderRadius: 4, borderSkipped: false }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            animation: { duration: 700, easing: 'easeOutQuart' },
            plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 14 } } },
            scales: { y: { min: 0, max: 20, ticks: { stepSize: 4 }, grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } }
        }
    });

    const improved = withBoth.filter(r => r.semesterDiff > 0).length;
    const declined = withBoth.filter(r => r.semesterDiff < 0).length;
    note.textContent = `${withBoth.length} أستاذ لديه بيانات للدورتين: ${improved} تحسن، ${declined} تراجع.`;
}

/* ─── Radar Chart (NEW) ─── */
function renderRadarChart(rows) {
    const canvas = document.getElementById('tp-radar-chart');
    const note = document.getElementById('tp-radar-note');
    if (!canvas || !note || !window.Chart) return;
    destroyChart('radar');

    if (!selectedTeacherName || !rows.length) { note.textContent = 'اختر أستاذ من الجدول.'; return; }
    const row = rows.find(r => r.teacher === selectedTeacherName) || rows[0];
    const sd = row.gradeValues ? stdDev(row.gradeValues) : 0;
    const consistency = Math.max(0, Math.min(100, (1 - sd / 10) * 100));
    const semProgress = row.semesterDiff !== null ? Math.max(0, Math.min(100, 50 + row.semesterDiff * 10)) : 50;

    charts.radar = new Chart(canvas.getContext('2d'), {
        type: 'radar',
        data: {
            labels: ['المعدل العام', 'نسبة النجاح', 'تجانس النتائج', 'عدد الأقسام', 'التطور بين الدورات'],
            datasets: [{
                label: row.teacher,
                data: [
                    Math.min(100, row.avg * 5),
                    row.passRate,
                    consistency,
                    Math.min(100, row.sectionsCount * 20),
                    semProgress
                ],
                backgroundColor: 'rgba(45, 95, 74, 0.2)',
                borderColor: 'rgba(45, 95, 74, 0.8)',
                pointBackgroundColor: 'rgba(45, 95, 74, 1)',
                pointRadius: 4,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            animation: { duration: 700, easing: 'easeOutQuart' },
            plugins: { legend: { display: false } },
            scales: { r: { min: 0, max: 100, ticks: { stepSize: 20, display: false }, pointLabels: { font: { size: 11, family: "'IBM Plex Sans Arabic', sans-serif" } }, grid: { color: 'rgba(0,0,0,0.08)' } } }
        }
    });

    note.textContent = `ملف شامل لـ ${row.teacher}: معدل ${row.avg.toFixed(2)}, نجاح ${row.passRate.toFixed(1)}%, تجانس ${consistency.toFixed(0)}%.`;
}

/* ─── State Line ─── */
function renderStateLine(baseFiltered, rows) {
    const el = document.getElementById('tp-state-line');
    if (!el) return;
    if (!baseFiltered.length) { el.textContent = 'لا توجد معطيات تطابق الفلاتر الحالية.'; return; }
    const withTeacher = baseFiltered.filter(g => g._teacher).length;
    const withoutTeacher = baseFiltered.length - withTeacher;
    el.textContent = `${baseFiltered.length} نقطة · ${rows.length} أستاذ صالح · ${withoutTeacher} سجل يحتاج تصحيح.`;
}

/* ─── Export ─── */
function exportReport() {
    if (!teacherRowsCache.length) { showToast('لا توجد بيانات للتصدير', 'error'); return; }
    const headers = ['الأستاذ', 'المادة', 'الأقسام', 'التلاميذ', 'المعدل', 'نسبة النجاح', 'التصنيف', 'فرق الدورتين', 'آخر استيراد'];
    const csvRows = ['\uFEFF' + headers.join(',')];
    getSortedRows(teacherRowsCache).forEach(row => {
        csvRows.push([
            `"${row.teacher}"`,
            `"${rowSubjectLabel(row, currentSubjectFilter)}"`,
            row.sectionsCount,
            row.studentCount,
            row.avg.toFixed(2),
            row.passRate.toFixed(1) + '%',
            `"${row.rating.label}"`,
            row.semesterDiff !== null ? row.semesterDiff.toFixed(2) : '-',
            `"${formatDateTime(row.lastImportedMs)}"`
        ].join(','));
    });
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `teachers-performance-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('تم تصدير التقرير بنجاح', 'success');
}

/* ─── Main Analysis ─── */
async function runAnalysis() {
    const analyzeBtn = document.getElementById('tp-analyze-btn');
    const teacherSelect = document.getElementById('tp-teacher-filter');
    if (analyzeBtn) { analyzeBtn.disabled = true; analyzeBtn.setAttribute('aria-busy', 'true'); }

    try {
        await ensureChartJsLoaded();
        const baseFiltered = getBaseFilteredGrades();
        currentSubjectFilter = document.getElementById('tp-subject-filter')?.value || '';
        const rows = buildTeacherRows(baseFiltered).sort((a, b) => b.passRate - a.passRate || b.avg - a.avg || b.gradeCount - a.gradeCount);
        if (teacherSelect?.value) selectedTeacherName = teacherSelect.value;
        if (rows.length && (!selectedTeacherName || !rows.some(r => r.teacher === selectedTeacherName))) selectedTeacherName = rows[0].teacher;
        teacherRowsCache = rows;

        renderStateLine(baseFiltered, rows);
        renderKpis(baseFiltered, rows);
        renderQualityAlert(baseFiltered);
        renderComparisonChart(rows);
        renderTeacherTable(rows, currentSubjectFilter);
        renderTeacherCard(baseFiltered, rows);
        renderSemesterCompareChart(rows);
        renderRadarChart(rows);
    } catch (error) {
        console.error('Teacher performance analysis error:', error);
        showToast('تعذر تنفيذ التحليل', 'error');
    } finally {
        if (analyzeBtn) { analyzeBtn.disabled = false; analyzeBtn.removeAttribute('aria-busy'); }
    }
}
