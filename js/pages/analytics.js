const year = getSchoolYear();
const CHART_JS_CDN = 'vendor/chart.min.js';
let detailChart = null;
let barChart = null;
let donutChart = null;
let zeroSectionsChart = null;
let chartLoaderPromise = null;
let analyzeInProgress = false;
let allSections = [];
let allGradesCache = [];
let sectionToLevel = {};
let _filterManager = null;
const gradeBands = [
    { key: 'excellent', label: 'ممتاز', min: 16, max: 20, color: '#2FB36D' },
    { key: 'veryGood', label: 'حسن جدا', min: 14, max: 16, color: '#3C95D0' },
    { key: 'good', label: 'حسن', min: 12, max: 14, color: '#F0C20E' },
    { key: 'acceptable', label: 'مقبول', min: 10, max: 12, color: '#E67F22' },
    { key: 'weak', label: 'ضعيف', min: 0, max: 10, color: '#E74C3C' }
];

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadFilters();

        const analyzeBtn = document.getElementById('analyze-btn');
        if (analyzeBtn) analyzeBtn.addEventListener('click', analyze);

        const levelSelect = document.getElementById('level-select');
        const classSelect = document.getElementById('class-select');
        const typeSelect = document.getElementById('analysis-type');

        // Level/Class/Subject cascading is handled by FilterManager.
        // Extra page-specific: sync teacher-subject-select on level/class change
        if (levelSelect) {
            levelSelect.addEventListener('change', () => {
                renderTeacherSubjectOptions();
            });
        }

        if (classSelect) {
            classSelect.addEventListener('change', () => {
                renderTeacherSubjectOptions();
            });
        }

        if (typeSelect) {
            typeSelect.addEventListener('change', () => {
                renderTeacherSubjectOptions();
                toggleTeacherSubjectFilter();
            });
        }

        const form = document.getElementById('analysis-form');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                await analyze();
            });
        }

        await analyze();
    } catch (error) {
        console.error('Analytics init error:', error);
        showToast('تعذر تحميل صفحة التحليل', 'error');
    }
});

function ensureChartJsLoaded() {
    if (window.Chart) return Promise.resolve(window.Chart);
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

function destroyAnalysisCharts() {
    if (detailChart) detailChart.destroy();
    if (barChart) barChart.destroy();
    if (donutChart) donutChart.destroy();
    if (zeroSectionsChart) zeroSectionsChart.destroy();
    detailChart = null;
    barChart = null;
    donutChart = null;
    zeroSectionsChart = null;
}

function upsertChart(currentChart, canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return null;

    if (currentChart && currentChart.config?.type === config.type) {
        currentChart.data = config.data;
        currentChart.options = config.options;
        currentChart.update();
        return currentChart;
    }

    if (currentChart) {
        currentChart.destroy();
    }

    return new Chart(canvas.getContext('2d'), config);
}

function asNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
}

function avg(values) {
    if (!values.length) return 0;
    return values.reduce((s, x) => s + x, 0) / values.length;
}

function percentage(part, whole) {
    if (!whole) return 0;
    return (part / whole) * 100;
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
    const variance = values.reduce((s, x) => s + (x - m) ** 2, 0) / values.length;
    return Math.sqrt(variance);
}

function studentIdentity(record) {
    return String(record.student_id || record.student_code || record.full_name || 'غير معرف');
}

function studentLabel(record) {
    return String(record.full_name || record.student_code || record.student_id || 'غير معرف');
}

function tooltipLabelWithPercent(context, total) {
    const label = context.label || '';
    const value = Number(context.raw || 0);
    const pct = percentage(value, total);
    return `${label}: ${value} (${pct.toFixed(1)}%)`;
}

// Level normalization: delegates to FilterManager's cached levelsMapping
function _getLocalLevelName(section) {
    if (_filterManager) return _filterManager._getLocalLevelName(section);
    const s = String(section || '').trim();
    if (!s) return '';
    if (sectionToLevel[s]) return sectionToLevel[s];
    return getLevelNameFromSection(s);
}

function renderSelectOptions(select, options, placeholder, previousValue = '') {
    if (!select) return;
    setSelectOptions(select, options, {
        placeholder,
        getValue: (option) => option.value,
        getLabel: (option) => option.label
    });

    if (previousValue && options.some((option) => option.value === previousValue)) {
        select.value = previousValue;
    }
}

function createIcon(className) {
    const icon = document.createElement('i');
    icon.className = `fas ${className}`;
    icon.setAttribute('aria-hidden', 'true');
    return icon;
}

function setContainerMessage(container, message) {
    if (!container) return;
    const paragraph = document.createElement('p');
    paragraph.textContent = message;
    container.replaceChildren(paragraph);
}

function createKpiCard({ icon, iconBackground, label, value, sublabel }) {
    const card = document.createElement('div');
    card.className = 'analysis-kpi-card';

    const iconWrap = document.createElement('div');
    iconWrap.className = 'analysis-kpi-icon';
    iconWrap.style.background = iconBackground;
    iconWrap.appendChild(createIcon(icon));

    const labelEl = document.createElement('div');
    labelEl.className = 'analysis-kpi-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('div');
    valueEl.className = 'analysis-kpi-value';
    valueEl.textContent = value;

    const subEl = document.createElement('div');
    subEl.className = 'analysis-kpi-sub';
    subEl.textContent = sublabel;

    card.append(iconWrap, labelEl, valueEl, subEl);
    return card;
}

function renderAnalysisKpis(metrics) {
    const container = document.getElementById('analysis-kpis');
    if (!container) return;

    container.replaceChildren(
        createKpiCard({
            icon: 'fa-users',
            iconBackground: 'var(--gradient-primary)',
            label: 'عدد التلاميذ',
            value: String(metrics.studentCount),
            sublabel: `${metrics.sectionsCount} قسم - ${metrics.subjectCount} مادة`
        }),
        createKpiCard({
            icon: 'fa-calculator',
            iconBackground: 'linear-gradient(135deg, var(--color-success), #38ef7d)',
            label: 'المعدل العام',
            value: metrics.generalAvg.toFixed(2),
            sublabel: `الوسيط: ${metrics.medianGrade.toFixed(2)}`
        }),
        createKpiCard({
            icon: 'fa-chart-area',
            iconBackground: 'linear-gradient(135deg, var(--color-warning), #ffd200)',
            label: 'الانحراف المعياري',
            value: metrics.stdDevGrade.toFixed(2),
            sublabel: `أدنى: ${metrics.minGrade.toFixed(1)} - أعلى: ${metrics.maxGrade.toFixed(1)}`
        }),
        createKpiCard({
            icon: 'fa-trophy',
            iconBackground: 'linear-gradient(135deg, #a770ef, #cf8bf3)',
            label: 'نسبة النجاح',
            value: `${metrics.passRate.toFixed(1)}%`,
            sublabel: `${metrics.passCount} نجاح من ${metrics.totalCount} نقطة`
        }),
        createKpiCard({
            icon: 'fa-star',
            iconBackground: 'linear-gradient(135deg, var(--color-danger), #ff9a76)',
            label: 'نسبة التفوق',
            value: `${metrics.excellenceRate.toFixed(1)}%`,
            sublabel: `${metrics.excellenceCount} نقطة >= 16`
        }),
        createKpiCard({
            icon: 'fa-exclamation-triangle',
            iconBackground: 'linear-gradient(135deg, var(--info), #89bfe8)',
            label: 'الحاصلون على 0',
            value: String(metrics.zeroCount),
            sublabel: `${metrics.zeroRate.toFixed(1)}% من المجموع`
        })
    );
}

function createProgressItem({ icon, title, percent, count, background }) {
    const item = document.createElement('div');
    item.className = 'analysis-progress-item';

    const titleEl = document.createElement('div');
    titleEl.className = 'analysis-progress-title';
    titleEl.append(createIcon(icon), document.createTextNode(` ${title}`));

    const track = document.createElement('div');
    track.className = 'analysis-progress-track';
    const value = document.createElement('div');
    value.className = 'analysis-progress-value';
    value.style.width = `${percent.toFixed(1)}%`;
    value.style.background = background;
    value.textContent = `${percent.toFixed(0)}%`;
    track.appendChild(value);

    const meta = document.createElement('div');
    meta.className = 'analysis-progress-meta';
    const percentLabel = document.createElement('span');
    percentLabel.textContent = `${percent.toFixed(1)}%`;
    const countLabel = document.createElement('span');
    countLabel.textContent = `${count} نقطة`;
    meta.append(percentLabel, countLabel);

    item.append(titleEl, track, meta);
    return item;
}

function renderAnalysisProgress(items) {
    const container = document.getElementById('analysis-progress');
    if (!container) return;
    container.replaceChildren(...items.map(createProgressItem));
}

function renderAnalysisSummary(distribution) {
    const container = document.getElementById('analysis-summary');
    if (!container) return;

    const table = document.createElement('table');
    table.className = 'analysis-summary-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['التقدير', 'النطاق', 'عدد التلاميذ', 'النسبة'].forEach((label) => {
        const th = document.createElement('th');
        th.textContent = label;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    const tbody = document.createElement('tbody');
    distribution.forEach((row) => {
        const tr = document.createElement('tr');
        const gradeCell = document.createElement('td');
        const pill = document.createElement('span');
        pill.className = 'analysis-grade-pill';
        pill.style.background = row.color;
        pill.textContent = row.label;
        gradeCell.appendChild(pill);

        const maxLabel = row.max === 20 ? '20' : (row.max - 0.01).toFixed(2);
        const rangeCell = document.createElement('td');
        rangeCell.textContent = `${row.min} - ${maxLabel}`;

        const countCell = document.createElement('td');
        countCell.textContent = String(row.count);

        const ratioCell = document.createElement('td');
        ratioCell.textContent = `${row.ratio.toFixed(1)}%`;

        tr.append(gradeCell, rangeCell, countCell, ratioCell);
        tbody.appendChild(tr);
    });

    table.append(thead, tbody);
    container.replaceChildren(table);
}

function updateChartSummary(id, text, label) {
    const canvas = document.getElementById(id);
    if (canvas) {
        canvas.setAttribute('role', 'img');
        if (label) canvas.setAttribute('aria-label', label);
        canvas.setAttribute('aria-describedby', `${id}-summary`);
    }

    const summary = document.getElementById(`${id}-summary`);
    if (summary) summary.textContent = text;
}

function renderZeroStudentsList(students) {
    const container = document.getElementById('zero-students-list');
    if (!container) return;

    if (!students.length) {
        setContainerMessage(container, 'لا يوجد تلاميذ حاصلون على 0 ضمن الفلاتر الحالية.');
        return;
    }

    const fragment = document.createDocumentFragment();
    students.forEach((student, index) => {
        const item = document.createElement('div');
        item.className = 'analysis-zero-item';

        const details = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = `${index + 1}. ${student.label}`;
        const section = document.createElement('div');
        section.style.fontSize = '12px';
        section.style.color = '#6b7280';
        section.textContent = student.section;
        details.append(name, section);

        const badge = document.createElement('span');
        badge.className = 'analysis-zero-badge';
        badge.textContent = `${student.count} صفر`;

        item.append(details, badge);
        fragment.appendChild(item);
    });

    container.replaceChildren(fragment);
}

// renderClassOptions and renderSubjectOptions are now handled by FilterManager.
// Only renderTeacherSubjectOptions remains page-specific.

function getAvailableSubjects(selectedLevel = '', selectedClass = '') {
    return buildSubjectOptionsFromGrades(allGradesCache, {
        level: selectedLevel,
        section: selectedClass,
        getLevelName: _getLocalLevelName
    });
}

function renderTeacherSubjectOptions() {
    const teacherSubjectSelect = document.getElementById('teacher-subject-select');
    if (!teacherSubjectSelect) return;
    const levelName = document.getElementById('level-select')?.value || '';
    const className = document.getElementById('class-select')?.value || '';
    const previousValue = teacherSubjectSelect.value;
    renderSelectOptions(
        teacherSubjectSelect,
        getAvailableSubjects(levelName, className).map((subject) => ({ value: subject, label: subject })),
        'كل المواد (مقارنة الأساتذة)',
        previousValue
    );
}

function toggleTeacherSubjectFilter() {
    const typeSelect = document.getElementById('analysis-type');
    const subjectSelect = document.getElementById('subject-select');
    const teacherSubjectSelect = document.getElementById('teacher-subject-select');
    if (!typeSelect || !subjectSelect || !teacherSubjectSelect) return;

    const isTeacherMode = typeSelect.value === 'teachers';
    subjectSelect.style.display = isTeacherMode ? 'none' : '';
    teacherSubjectSelect.style.display = isTeacherMode ? '' : 'none';
}

function calculateStudentGeneralAverage(grades, studentId, section) {
    const studentGrades = grades.filter((g) => studentIdentity(g) === studentId);
    const bySubject = {};
    studentGrades.forEach((g) => {
        const subject =
            typeof ccBaseSubject === 'function'
                ? ccBaseSubject(normalizeSubjectName(g.subject))
                : normalizeSubjectName(g.subject);
        if (!bySubject[subject]) bySubject[subject] = [];
        bySubject[subject].push(g);
    });
    const subjectAverages = Object.entries(bySubject).map(([subj, grds]) => {
        const a =
            typeof computeSubjectAverage === 'function'
                ? computeSubjectAverage(subj, grds)
                : avg(grds.map((g) => g.grade));
        return { subject: subj, avg: a };
    });
    const sectionName = section || (studentGrades[0] && studentGrades[0].section) || '';
    const branch = typeof detectBranch === 'function' ? detectBranch(sectionName) : null;
    return typeof computeWeightedGeneralAverage === 'function'
        ? computeWeightedGeneralAverage(subjectAverages, branch)
        : avg(subjectAverages.map((s) => s.avg));
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
    if (invalidContains.some((x) => normalized.includes(x))) return '';

    return raw;
}

function buildTeacherPerformanceRows(grades) {
    const byTeacher = new Map();
    grades.forEach((g) => {
        const teacher = sanitizeTeacherName(g.teacher_name);
        if (!teacher) return;

        let agg = byTeacher.get(teacher);
        if (!agg) {
            agg = { sum: 0, count: 0, pass: 0, students: new Set() };
            byTeacher.set(teacher, agg);
        }

        agg.sum += g.grade;
        agg.count += 1;
        if (g.grade >= 10) agg.pass += 1;
        agg.students.add(studentIdentity(g));
    });

    return Array.from(byTeacher.entries())
        .map(([name, stats]) => ({
            name,
            avg: stats.count ? stats.sum / stats.count : 0,
            passRate: stats.count ? percentage(stats.pass, stats.count) : 0,
            gradeCount: stats.count,
            studentCount: stats.students.size
        }))
        .sort((a, b) => b.avg - a.avg || b.passRate - a.passRate || b.gradeCount - a.gradeCount);
}

async function loadFilters() {
    // Use FilterManager for Level → Class → Subject cascading
    _filterManager = new FilterManager({
        selectors: { level: 'level-select', class: 'class-select', subject: 'subject-select' },
        subjectsFromGrades: true
    });
    await _filterManager.init();

    // Sync internal caches from FilterManager
    const fmData = _filterManager.getData();
    allGradesCache = fmData.grades;
    allSections = fmData.classes;
    sectionToLevel = _filterManager._levelsMapping || {};

    // Page-specific: teacher-subject filter
    renderTeacherSubjectOptions();
    toggleTeacherSubjectFilter();
}

async function analyze() {
    if (analyzeInProgress) return;

    const analyzeBtn = document.getElementById('analyze-btn');
    analyzeInProgress = true;
    if (analyzeBtn) {
        analyzeBtn.disabled = true;
        analyzeBtn.setAttribute('aria-busy', 'true');
    }

    try {
        const className = document.getElementById('class-select').value;
        const levelName = document.getElementById('level-select').value;
        const subjectName = document.getElementById('subject-select').value;
        const teacherSubjectName = document.getElementById('teacher-subject-select')?.value || '';
        const type = document.getElementById('analysis-type').value;

        const allGrades = allGradesCache.length ? allGradesCache : (await window.api.grades.getAll(year)) || [];

        // Yield to UI before heavy work
        await new Promise((r) => requestAnimationFrame(r));

        // Avoid spreading 45K objects — just parse grade inline
        const grades = [];
        for (let i = 0; i < allGrades.length; i++) {
            const g = allGrades[i];
            const v = Number(g.grade);
            if (Number.isFinite(v)) {
                grades.push({
                    _src: g,
                    grade: v,
                    section: g.section || '',
                    subject: g.subject,
                    student_id: g.student_id,
                    student_code: g.student_code,
                    full_name: g.full_name,
                    teacher_name: g.teacher_name
                });
            }
        }

        let filtered = grades;
        if (className) filtered = filtered.filter((g) => g.section === className);
        if (levelName) filtered = filtered.filter((g) => _getLocalLevelName(g.section) === levelName);
        if (type === 'teachers') {
            if (teacherSubjectName)
                filtered = filtered.filter((g) => normalizeSubjectName(g.subject) === teacherSubjectName);
        } else if (subjectName) {
            filtered = filtered.filter((g) => normalizeSubjectName(g.subject) === subjectName);
        }

        if (!filtered.length) {
            document.getElementById('analysis-kpis')?.replaceChildren();
            document.getElementById('analysis-progress')?.replaceChildren();
            setContainerMessage(
                document.getElementById('analysis-summary'),
                'لا توجد معطيات نقط مطابقة للفلاتر الحالية.'
            );
            setContainerMessage(document.getElementById('zero-students-list'), 'لا توجد معطيات.');
            destroyAnalysisCharts();
            showToast('لا توجد معطيات للتحليل', 'warning');
            return;
        }

        await ensureChartJsLoaded();

        // ─── Single-pass stats computation ───
        let passCount = 0,
            excellenceCount = 0,
            zeroCount = 0;
        let minGrade = Infinity,
            maxGrade = -Infinity,
            gradeSum = 0;
        const studentIdSet = new Set();
        const sectionSet = new Set();

        // Pre-group grades by subject and by student for O(1) lookup later
        const gradesBySubject = new Map(); // subject → grade[]
        const gradesByStudentSubject = new Map(); // studentId → Map<subject, {sum, count, grades}>

        // Distribution counters (single pass instead of 5× filter)
        const bandCounts = new Array(gradeBands.length).fill(0);

        for (let i = 0; i < filtered.length; i++) {
            const g = filtered[i];
            const v = g.grade;

            // Basic stats
            gradeSum += v;
            if (v >= 10) passCount++;
            if (v >= 16) excellenceCount++;
            if (v === 0) zeroCount++;
            if (v < minGrade) minGrade = v;
            if (v > maxGrade) maxGrade = v;

            const sid = studentIdentity(g);
            studentIdSet.add(sid);
            sectionSet.add(g.section || 'غير محدد');

            const subj = normalizeSubjectName(g.subject);

            // Group by subject
            let subjArr = gradesBySubject.get(subj);
            if (!subjArr) {
                subjArr = [];
                gradesBySubject.set(subj, subjArr);
            }
            subjArr.push(g);

            // Group by student → subject (aggregated)
            let studentMap = gradesByStudentSubject.get(sid);
            if (!studentMap) {
                studentMap = new Map();
                gradesByStudentSubject.set(sid, studentMap);
            }
            let sa = studentMap.get(subj);
            if (!sa) {
                sa = { sum: 0, count: 0, grades: [] };
                studentMap.set(subj, sa);
            }
            sa.sum += v;
            sa.count += 1;
            sa.grades.push(g);

            // Distribution bands (single pass)
            for (let b = 0; b < gradeBands.length; b++) {
                const band = gradeBands[b];
                if (v >= band.min && v < band.max + (band.max === 20 ? 0.001 : 0)) {
                    bandCounts[b]++;
                    break;
                }
            }
        }

        const passRate = filtered.length ? (passCount / filtered.length) * 100 : 0;
        const globalAvg = filtered.length ? gradeSum / filtered.length : 0;
        const sectionsCount = sectionSet.size;
        const studentCount = studentIdSet.size;

        // Subject averages — use pre-grouped map (O(1) per subject)
        const subjectAverages = Array.from(gradesBySubject.entries(), ([subject, subjGrades]) => ({
            subject,
            avg:
                typeof computeSubjectAverage === 'function'
                    ? computeSubjectAverage(subject, subjGrades)
                    : subjGrades.length
                      ? subjGrades.reduce((s, g) => s + g.grade, 0) / subjGrades.length
                      : 0
        }));
        const overallSubjectAvg = avg(subjectAverages.map((s) => s.avg));

        // Student general averages — use pre-grouped map (O(1) lookups)
        const studentGeneralAverages = Array.from(gradesByStudentSubject.entries(), ([_id, bySubject]) => {
            const studentSubjectAvgs = Array.from(bySubject.entries(), ([subj, sa]) => {
                if (typeof computeSubjectAverage === 'function') {
                    return { subject: subj, avg: computeSubjectAverage(subj, sa.grades) };
                }
                return { subject: subj, avg: sa.sum / sa.count };
            });
            const sectionName = className || bySubject.values().next().value?.grades[0]?.section || '';
            const branch = typeof detectBranch === 'function' ? detectBranch(sectionName) : null;
            return typeof computeWeightedGeneralAverage === 'function'
                ? computeWeightedGeneralAverage(studentSubjectAvgs, branch)
                : avg(studentSubjectAvgs.map((s) => s.avg));
        });
        const generalAvg = avg(studentGeneralAverages);

        const distribution = gradeBands.map((band, i) => ({
            ...band,
            count: bandCounts[i],
            ratio: percentage(bandCounts[i], filtered.length)
        }));

        const gradeValues = filtered.map((g) => g.grade);
        const medianGrade = median(gradeValues);
        const stdDevGrade = stdDev(gradeValues);

        const excellenceRate = percentage(excellenceCount, filtered.length);
        const zeroRate = percentage(zeroCount, filtered.length);
        renderAnalysisKpis({
            studentCount,
            sectionsCount,
            subjectCount: gradesBySubject.size,
            generalAvg,
            medianGrade,
            stdDevGrade,
            minGrade,
            maxGrade,
            passRate,
            passCount,
            totalCount: filtered.length,
            excellenceCount,
            excellenceRate,
            zeroCount,
            zeroRate
        });

        const improved = filtered.filter((g) => g.grade >= 12).length;
        const stable = filtered.filter((g) => g.grade >= 10 && g.grade < 12).length;
        const declined = filtered.filter((g) => g.grade < 10).length;
        renderAnalysisProgress([
            {
                icon: 'fa-arrow-trend-up',
                title: 'نقط 12 فأكثر (جيد وأعلى)',
                percent: percentage(improved, filtered.length),
                count: improved,
                background: 'linear-gradient(90deg, var(--color-success), #38ef7d)'
            },
            {
                icon: 'fa-minus',
                title: 'نقط 10 - 12 (مقبول)',
                percent: percentage(stable, filtered.length),
                count: stable,
                background: 'linear-gradient(90deg, var(--color-warning), #ffd200)'
            },
            {
                icon: 'fa-arrow-trend-down',
                title: 'نقط أقل من 10 (ضعيف)',
                percent: percentage(declined, filtered.length),
                count: declined,
                background: 'linear-gradient(90deg, var(--color-danger), #ff9a76)'
            }
        ]);

        renderAnalysisSummary(distribution);

        const zeroByStudent = {};
        filtered.forEach((g) => {
            if (g.grade !== 0) return;
            const key = studentIdentity(g);
            if (!zeroByStudent[key]) {
                zeroByStudent[key] = {
                    label: studentLabel(g),
                    section: g.section || 'غير محدد',
                    count: 0
                };
            }
            zeroByStudent[key].count += 1;
        });
        const topZeroStudents = Object.values(zeroByStudent)
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
        renderZeroStudentsList(topZeroStudents);

        const zeroBySection = {};
        filtered.forEach((g) => {
            if (g.grade !== 0) return;
            const section = g.section || 'غير محدد';
            zeroBySection[section] = (zeroBySection[section] || 0) + 1;
        });
        const zeroSectionLabels = Object.keys(zeroBySection)
            .sort((a, b) => zeroBySection[b] - zeroBySection[a])
            .slice(0, 8);
        const zeroSectionData = zeroSectionLabels.map((label) => zeroBySection[label]);
        zeroSectionsChart = upsertChart(zeroSectionsChart, 'zero-sections-chart', {
            type: 'bar',
            data: {
                labels: zeroSectionLabels.length ? zeroSectionLabels : ['لا توجد بيانات'],
                datasets: [
                    {
                        label: 'عدد الأصفار',
                        data: zeroSectionLabels.length ? zeroSectionData : [0],
                        backgroundColor: 'rgba(232, 93, 93, 0.8)',
                        borderRadius: 6,
                        borderSkipped: false
                    }
                ]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 800, easing: 'easeOutQuart' },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (ctx) => `عدد الأصفار: ${ctx.raw}` } }
                },
                scales: { x: { grid: { display: false } }, y: { grid: { display: false } } }
            }
        });
        updateChartSummary(
            'zero-sections-chart',
            zeroSectionLabels.length
                ? `القسم الأكثر تسجيلا للأصفار هو ${zeroSectionLabels[0]} بعدد ${zeroSectionData[0]} صفر.`
                : 'لا توجد أصفار معروضة حسب الأقسام.',
            'رسم بياني يوضح الأصفار حسب القسم'
        );

        const distributionLabels = distribution.map((d) => d.label);
        const distributionCounts = distribution.map((d) => d.count);
        const distributionColors = distribution.map((d) => d.color);

        barChart = upsertChart(barChart, 'grades-bar-chart', {
            type: 'bar',
            data: {
                labels: distributionLabels,
                datasets: [
                    {
                        label: 'عدد التلاميذ',
                        data: distributionCounts,
                        backgroundColor: distributionColors.map((c) => c + 'CC'),
                        borderRadius: 8,
                        borderSkipped: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 800, easing: 'easeOutQuart' },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => tooltipLabelWithPercent(ctx, filtered.length)
                        }
                    }
                },
                scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(0,0,0,0.04)' } } }
            }
        });
        const topDistributionIndex = distributionCounts.findIndex(
            (value) => value === Math.max(...distributionCounts, 0)
        );
        updateChartSummary(
            'grades-bar-chart',
            topDistributionIndex >= 0
                ? `أكثر الفئات عددا هي ${distributionLabels[topDistributionIndex]} بعدد ${distributionCounts[topDistributionIndex]} تلميذ.`
                : 'لا توجد بيانات لتوزيع التقديرات.',
            'رسم بياني يوضح عدد التلاميذ في كل تقدير'
        );

        donutChart = upsertChart(donutChart, 'grades-donut-chart', {
            type: 'doughnut',
            data: {
                labels: distributionLabels,
                datasets: [
                    {
                        data: distributionCounts,
                        backgroundColor: distributionColors,
                        borderWidth: 3,
                        borderColor: 'rgba(255,255,255,0.9)',
                        hoverOffset: 8
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '60%',
                animation: { duration: 800, easing: 'easeOutQuart' },
                plugins: {
                    legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true, pointStyle: 'circle' } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => tooltipLabelWithPercent(ctx, filtered.length)
                        }
                    }
                }
            }
        });
        updateChartSummary(
            'grades-donut-chart',
            topDistributionIndex >= 0
                ? `يمثل ${distributionLabels[topDistributionIndex]} النسبة الأكبر من التقديرات.`
                : 'لا توجد بيانات لنسب التقديرات.',
            'رسم دائري يوضح نسب التقديرات'
        );

        const detailCanvasId = 'detail-chart';
        if (type === 'distribution') {
            const ranges = ['0-5', '5-8', '8-10', '10-12', '12-14', '14-16', '16-20'];
            const counts = [
                filtered.filter((g) => g.grade < 5).length,
                filtered.filter((g) => g.grade >= 5 && g.grade < 8).length,
                filtered.filter((g) => g.grade >= 8 && g.grade < 10).length,
                filtered.filter((g) => g.grade >= 10 && g.grade < 12).length,
                filtered.filter((g) => g.grade >= 12 && g.grade < 14).length,
                filtered.filter((g) => g.grade >= 14 && g.grade < 16).length,
                filtered.filter((g) => g.grade >= 16).length
            ];

            detailChart = upsertChart(detailChart, detailCanvasId, {
                type: 'bar',
                data: {
                    labels: ranges,
                    datasets: [
                        {
                            label: 'عدد النقط',
                            data: counts,
                            backgroundColor: 'rgba(59, 106, 197, 0.7)',
                            borderRadius: 6,
                            borderSkipped: false
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { duration: 800, easing: 'easeOutQuart' },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => tooltipLabelWithPercent(ctx, filtered.length)
                            }
                        }
                    },
                    scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(0,0,0,0.04)' } } }
                }
            });
            const topRangeIndex = counts.findIndex((value) => value === Math.max(...counts, 0));
            updateChartSummary(
                'detail-chart',
                topRangeIndex >= 0
                    ? `أكثر مجال تكرارا هو ${ranges[topRangeIndex]} بعدد ${counts[topRangeIndex]} نقطة.`
                    : 'لا توجد بيانات تفصيلية للتوزيع.',
                'رسم بياني تحليلي تفصيلي حسب الاختيار الحالي'
            );
        } else if (type === 'comparison') {
            const bySection = {};
            filtered.forEach((g) => {
                const s = g.section || 'غير محدد';
                if (!bySection[s]) bySection[s] = [];
                bySection[s].push(g.grade);
            });

            const labels = Object.keys(bySection).sort((a, b) => a.localeCompare(b, 'ar'));
            const data = labels.map((s) => Number(avg(bySection[s]).toFixed(2)));

            detailChart = upsertChart(detailChart, detailCanvasId, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'معدل القسم',
                            data,
                            backgroundColor: 'rgba(91, 132, 214, 0.7)',
                            borderRadius: 6,
                            borderSkipped: false
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { duration: 800, easing: 'easeOutQuart' },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => `معدل القسم: ${Number(ctx.raw).toFixed(2)}`
                            }
                        }
                    },
                    scales: {
                        x: { grid: { display: false } },
                        y: { grid: { color: 'rgba(0,0,0,0.04)' }, beginAtZero: true }
                    }
                }
            });
            updateChartSummary(
                'detail-chart',
                labels.length
                    ? `أعلى قسم من حيث المعدل هو ${labels[data.indexOf(Math.max(...data))]} بمتوسط ${Math.max(...data).toFixed(2)}.`
                    : 'لا توجد بيانات مقارنة بين الأقسام.',
                'رسم بياني تحليلي تفصيلي حسب الاختيار الحالي'
            );
        } else if (type === 'teachers') {
            const teacherRows = buildTeacherPerformanceRows(filtered).sort(
                (a, b) => b.passRate - a.passRate || b.avg - a.avg || b.gradeCount - a.gradeCount
            );
            const topTeachers = teacherRows.slice(0, 20);
            const labels = topTeachers.map((t) => t.name);
            const data = topTeachers.map((t) => Number(t.passRate.toFixed(1)));
            const colors = topTeachers.map((t) => {
                if (t.passRate >= 85) return 'rgba(47, 179, 109, 0.85)';
                if (t.passRate >= 70) return 'rgba(60, 149, 208, 0.85)';
                if (t.passRate >= 50) return 'rgba(240, 194, 14, 0.85)';
                return 'rgba(231, 76, 60, 0.85)';
            });

            detailChart = upsertChart(detailChart, detailCanvasId, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'نسبة نجاح الأستاذ (%)',
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
                    animation: { duration: 800, easing: 'easeOutQuart' },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => `نسبة النجاح: ${Number(ctx.raw).toFixed(1)}%`,
                                afterBody: (items) => {
                                    const idx = items[0]?.dataIndex ?? -1;
                                    const row = topTeachers[idx];
                                    if (!row) return '';
                                    return [
                                        `معدل الأستاذ: ${row.avg.toFixed(2)}`,
                                        `عدد النقط: ${row.gradeCount}`,
                                        `عدد التلاميذ: ${row.studentCount}`
                                    ];
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            min: 0,
                            max: 100,
                            ticks: {
                                stepSize: 10,
                                callback: (value) => `${value}%`
                            },
                            grid: { color: 'rgba(0,0,0,0.04)' }
                        },
                        y: { grid: { display: false } }
                    }
                }
            });
            updateChartSummary(
                'detail-chart',
                topTeachers.length
                    ? `الأستاذ الأعلى في نسبة النجاح هو ${topTeachers[0].name} بنسبة ${topTeachers[0].passRate.toFixed(1)}%.`
                    : 'لا توجد بيانات مقارنة بين الأساتذة.',
                'رسم بياني تحليلي تفصيلي حسب الاختيار الحالي'
            );
        }

        showToast('تم التحليل', 'success');
    } catch (error) {
        console.error('Analyze error:', error);
        showToast('تعذر تنفيذ التحليل، تحقق من المعطيات', 'error');
    } finally {
        analyzeInProgress = false;
        if (analyzeBtn) {
            analyzeBtn.disabled = false;
            analyzeBtn.removeAttribute('aria-busy');
        }
    }
}
