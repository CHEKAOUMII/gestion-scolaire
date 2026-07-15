let activeTab = 'results';
let tab2Loaded = false;
let tab3Loaded = false;

function switchTab(tabId) {
    activeTab = tabId;
    document.querySelectorAll('.rh-tab-btn').forEach((btn) => {
        const isActive = btn.id === `tab-btn-${tabId}`;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', String(isActive));
    });
    document.querySelectorAll('.rh-tab-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.id === `tab-${tabId}`);
    });
    if (tabId === 'zeros' && !tab2Loaded) {
        tab2Loaded = true;
        searchZeros({ resetPage: true });
    }
    if (tabId === 'top' && !tab3Loaded) {
        tab3Loaded = true;
        renderTopPerformers();
    }
}

let year;
let allSections = [];
let allGradesCache = [];
let sectionToLevel = {};
let _filterManager = null;
// Pagination state
const PAGE_SIZE = 20;
let currentPage = 1;
let currentStudentData = [];
const GRADES_DEBUG =
    /[?&]debugGrades=1(?:&|$)/.test(location.search) || localStorage.getItem('debugGrades') === '1';
function debugGrades(...args) {
    if (GRADES_DEBUG) console.log('[grades-page]', ...args);
}
window.debugGradesDump = async function debugGradesDump() {
    const rows = (await window.api.grades.getAll(year)) || [];
    const subjects = [...new Set(rows.map((r) => String(r.subject || '').trim()).filter(Boolean))];
    console.table(subjects.slice(0, 200).map((s, i) => ({ '#': i + 1, subject: s })));
    return { totalRows: rows.length, uniqueSubjects: subjects.length };
};

document.addEventListener('DOMContentLoaded', async () => {
    try {
        year = getSchoolYear();
        // Tab switching
        document.getElementById('tab-btn-results').addEventListener('click', () => switchTab('results'));
        document.getElementById('tab-btn-zeros').addEventListener('click', () => switchTab('zeros'));
        document.getElementById('tab-btn-top').addEventListener('click', () => switchTab('top'));

        // Tab 2 events
        document
            .getElementById('zeros-search-btn')
            .addEventListener('click', () => searchZeros({ resetPage: true }));
        document.getElementById('zeros-export-btn').addEventListener('click', zShowPrintPreview);
        document.getElementById('zeros-form').addEventListener('submit', (e) => {
            e.preventDefault();
            searchZeros({ resetPage: true });
        });
        ['zeros-class', 'zeros-semester', 'zeros-page-size'].forEach((id) => {
            document.getElementById(id).addEventListener('change', () => searchZeros({ resetPage: true }));
        });
        document.getElementById('zeros-search').addEventListener('input', () => {
            clearTimeout(zDebounceTimer);
            zDebounceTimer = setTimeout(() => searchZeros({ resetPage: true }), 250);
        });
        document.getElementById('z-pagination').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-page]');
            if (!btn || btn.disabled) return;
            const targetPage = Number(btn.dataset.page);
            if (!Number.isFinite(targetPage) || targetPage < 1 || targetPage === zCurrentPage) return;
            zCurrentPage = targetPage;
            searchZeros();
        });

        // Tab 3 events
        document.getElementById('top-scope-bar').addEventListener('click', (e) => {
            const btn = e.target.closest('.rh-scope-btn[data-scope]');
            if (!btn) return;
            setTopScope(btn.dataset.scope);
            if (tab3Loaded) renderTopPerformers();
        });
        document.getElementById('top-scope-bar').addEventListener('keydown', (e) => {
            const buttons = Array.from(document.querySelectorAll('.rh-scope-btn'));
            const currentIndex = buttons.findIndex((button) => button.dataset.scope === topScope);
            if (currentIndex === -1) return;

            let nextIndex = currentIndex;
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
                nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
                nextIndex = (currentIndex + 1) % buttons.length;
            if (nextIndex === currentIndex) return;

            e.preventDefault();
            const nextButton = buttons[nextIndex];
            setTopScope(nextButton.dataset.scope);
            nextButton.focus();
            if (tab3Loaded) renderTopPerformers();
        });
        document.getElementById('top-semester').addEventListener('change', () => {
            if (tab3Loaded) renderTopPerformers();
        });

        await loadFilters();

        // Level/Class/Subject cascading is handled by FilterManager
        // No manual event binding needed for cascading

        // Button events
        document.getElementById('search-btn').addEventListener('click', loadResults);
        document.getElementById('reset-btn').addEventListener('click', resetFilters);
        document.getElementById('remark-select').addEventListener('change', loadResults);

        // Initial load
        await loadResults();
        showToast('تم تحميل البيانات', 'success');
    } catch (error) {
        console.error('Init error:', error);
        showToast('تعذر تحميل الصفحة', 'error');
    }
});

// _getLocalLevelName: delegates to FilterManager
function _getLocalLevelName(section) {
    if (_filterManager) return _filterManager._getLocalLevelName(section);
    const s = String(section || '').trim();
    if (!s) return '';
    if (sectionToLevel[s]) return sectionToLevel[s];
    return getLevelNameFromSection(s);
}

// renderClassOptions and renderSubjectOptions are now handled by FilterManager.

async function loadFilters() {
    _filterManager = new FilterManager({
        selectors: { level: 'level-select', class: 'class-select', subject: 'subject-select' },
        subjectsFromGrades: true
    });
    await _filterManager.init();

    // Sync caches
    const fmData = _filterManager.getData();
    allGradesCache = fmData.grades;
    allSections = fmData.classes;
    sectionToLevel = _filterManager._levelsMapping || {};
    topStudentsCache.clear();

    debugGrades('loadFilters:data', {
        classes: allSections.length,
        grades: allGradesCache.length
    });

    // Populate Tab 2 class select (separate dropdown, not managed by FilterManager)
    const zerosClassSelect = document.getElementById('zeros-class');
    while (zerosClassSelect.options.length > 1) zerosClassSelect.remove(1);
    sortSectionNames(allSections).forEach((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        zerosClassSelect.appendChild(opt);
    });
}

function resetFilters() {
    if (_filterManager) _filterManager.reset();
    document.getElementById('semester-select').value = '';
    document.getElementById('remark-select').value = '';
    loadResults();
    showToast('تم إعادة ضبط الفلاتر', 'info');
}

function avg(values) {
    if (!values.length) return 0;
    return values.reduce((s, x) => s + x, 0) / values.length;
}

function studentIdentityFromGrade(g) {
    return String(g.student_id || g.student_code || 'غير محدد');
}

function toNumericGrades(rows) {
    return (rows || [])
        .map((g) => ({ ...g, grade: Number(g.grade) }))
        .filter((g) => Number.isFinite(g.grade));
}

function computeOverallSubjectAvg(grades) {
    const byBaseSubject = {};
    grades.forEach((g) => {
        const base = normalizeSubjectName(g.subject) || 'غير محدد';
        if (!byBaseSubject[base]) byBaseSubject[base] = [];
        byBaseSubject[base].push(g);
    });
    const subjectAverages = Object.entries(byBaseSubject).map(([base, grds]) =>
        computeSubjectAverage(base, grds)
    );
    return subjectAverages.length ? avg(subjectAverages) : 0;
}

function clearResultsEmptyState(message) {
    document.getElementById('total-students').textContent = '0';
    document.getElementById('avg-grade').textContent = '-';
    document.getElementById('subject-avg').textContent = '-';
    document.getElementById('pass-rate').textContent = '-';
    document.getElementById('fail-count').textContent = '0';
    document.getElementById('excellence-rate').textContent = '-';
    currentStudentData = [];
    currentPage = 1;
    document.getElementById('tbody').innerHTML =
        `<tr><td colspan="7" style="padding: 20px; text-align: center;">${message}</td></tr>`;
    renderPagination(0);
}

function fillDetailHeader(studentId, fallbackRecord) {
    const cached = currentStudentData.find((s) => s.id === studentId);
    document.getElementById('detail-name').textContent =
        cached?.name || fallbackRecord?.full_name || 'غير محدد';
    document.getElementById('detail-code').textContent =
        cached?.massar_code || fallbackRecord?.student_code || studentId || '-';
    document.getElementById('detail-section').textContent =
        cached?.section || fallbackRecord?.section || '-';
}

function getGradeRemark(average) {
    if (average >= 16) return 'ممتاز';
    if (average >= 14) return 'حسن جدا';
    if (average >= 12) return 'حسن';
    if (average >= 10) return 'مقبول';
    return 'ضعيف';
}

function getRemarkColor(average) {
    if (average >= 16) return '#10b981';
    if (average >= 14) return '#3b82f6';
    if (average >= 12) return '#f59e0b';
    if (average >= 10) return '#f97316';
    return '#ef4444';
}

async function loadResults() {
    try {
        const levelName = document.getElementById('level-select').value;
        const className = document.getElementById('class-select').value;
        const subjectName = document.getElementById('subject-select').value;
        const semester = document.getElementById('semester-select').value;

        const allGrades = allGradesCache.length
            ? allGradesCache
            : (await window.api.grades.getAll(year)) || [];
        if (!allGradesCache.length) allGradesCache = allGrades;
        const grades = toNumericGrades(allGrades);
        debugGrades('loadResults:filters', {
            levelName,
            className,
            subjectName,
            semester,
            allGrades: allGrades.length,
            numericGrades: grades.length
        });

        // Apply filters
        let filtered = grades;
        if (className) filtered = filtered.filter((g) => (g.section || '') === className);
        if (levelName) filtered = filtered.filter((g) => _getLocalLevelName(g.section) === levelName);
        if (subjectName) filtered = filtered.filter((g) => normalizeSubjectName(g.subject) === subjectName);
        if (semester) filtered = filtered.filter((g) => String(g.semester || '') === semester);

        if (!filtered.length) {
            clearResultsEmptyState('لا توجد بيانات مطابقة للفلاتر');
            return;
        }

        const studentLabel = (g) => String(g.full_name || g.student_code || g.student_id || 'غير محدد');

        // Calculate subject and student averages in one pass
        // Group by BASE subject so exams + activities are merged
        const byBaseSubject = {};
        const studentsAgg = new Map();
        filtered.forEach((g) => {
            const base = normalizeSubjectName(g.subject) || 'غير محدد';

            if (!byBaseSubject[base]) byBaseSubject[base] = [];
            byBaseSubject[base].push(g);

            const id = studentIdentityFromGrade(g);
            let studentAgg = studentsAgg.get(id);
            if (!studentAgg) {
                studentAgg = {
                    firstRecord: g,
                    bySubject: new Map()
                };
                studentsAgg.set(id, studentAgg);
            }

            const arr = studentAgg.bySubject.get(base) || [];
            arr.push(g);
            studentAgg.bySubject.set(base, arr);
        });

        const studentData = Array.from(studentsAgg.entries()).map(([id, studentAgg]) => {
            const firstRecord = studentAgg.firstRecord || {};
            const studentSubjectAvgs = Array.from(studentAgg.bySubject.entries(), ([base, grds]) => ({
                subject: base,
                avg: computeSubjectAverage(base, grds)
            }));
            const branch =
                typeof detectBranch === 'function'
                    ? detectBranch(firstRecord.section || firstRecord.class_name || '')
                    : null;
            const generalAvg =
                typeof computeWeightedGeneralAverage === 'function'
                    ? computeWeightedGeneralAverage(studentSubjectAvgs, branch)
                    : avg(studentSubjectAvgs.map((s) => s.avg));

            return {
                id,
                name: studentLabel(firstRecord),
                massar_code: firstRecord.student_code || firstRecord.massar_code || '-',
                section: firstRecord.section || '-',
                average: generalAvg
            };
        });

        // Sort by average (descending)
        studentData.sort((a, b) => b.average - a.average);

        const remarkFilter = document.getElementById('remark-select').value;
        const displayData = remarkFilter
            ? studentData.filter((s) => getGradeRemark(s.average) === remarkFilter)
            : studentData;

        if (!displayData.length) {
            clearResultsEmptyState('لا توجد بيانات مطابقة للفلاتر');
            return;
        }

        const displayIds = new Set(displayData.map((s) => s.id));
        const gradesForKpi = filtered.filter((g) => displayIds.has(studentIdentityFromGrade(g)));
        const overallSubjectAvg = computeOverallSubjectAvg(gradesForKpi);

        // Calculate statistics for the same population shown in the table.
        const studentCount = displayData.length;
        const generalAvg = avg(displayData.map((s) => s.average));
        const passCount = displayData.filter((s) => s.average >= 10).length;
        const passRate = studentCount ? (passCount / studentCount) * 100 : 0;
        const failCount = studentCount - passCount;
        const excellenceCount = displayData.filter((s) => s.average >= 16).length;
        const excellenceRate = studentCount ? (excellenceCount / studentCount) * 100 : 0;

        // Update KPIs
        document.getElementById('total-students').textContent = studentCount;
        document.getElementById('avg-grade').textContent = generalAvg.toFixed(2);
        document.getElementById('subject-avg').textContent = overallSubjectAvg.toFixed(2);
        document.getElementById('pass-rate').textContent = passRate.toFixed(1) + '%';
        document.getElementById('fail-count').textContent = failCount;
        document.getElementById('excellence-rate').textContent = excellenceRate.toFixed(1) + '%';

        // Store data for pagination and render first page
        currentStudentData = displayData;
        currentPage = 1;
        renderPage();
    } catch (error) {
        console.error('Load results error:', error);
        showToast('تعذر تحميل النتائج', 'error');
    }
}

function renderPage() {
    const totalPages = Math.ceil(currentStudentData.length / PAGE_SIZE);
    if (currentPage > totalPages) currentPage = totalPages || 1;
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageData = currentStudentData.slice(start, start + PAGE_SIZE);

    const tbody = document.getElementById('tbody');
    const fragment = document.createDocumentFragment();
    pageData.forEach((s, i) => {
            const globalIndex = start + i;
            const remark = getGradeRemark(s.average);
            const remarkColor = getRemarkColor(s.average);
            const row = document.createElement('tr');
            row.tabIndex = 0;
            row.dataset.studentId = s.id;
            row.addEventListener('click', () => showStudentDetail(s.id));
            row.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    showStudentDetail(s.id);
                }
            });
            [
                ['#', globalIndex + 1],
                ['رمز مسار', s.massar_code],
                ['الاسم الكامل', s.name],
                ['القسم', s.section]
            ].forEach(([label, text]) => {
                const cell = document.createElement('td');
                cell.dataset.label = label;
                cell.textContent = String(text ?? '-');
                row.appendChild(cell);
            });
            const averageCell = document.createElement('td');
            averageCell.dataset.label = 'المعدل العام';
            averageCell.style.cssText = `font-weight:bold;color:${remarkColor};`;
            averageCell.textContent = s.average.toFixed(2);
            row.appendChild(averageCell);

            const rankCell = document.createElement('td');
            rankCell.dataset.label = 'الترتيب';
            rankCell.textContent = String(globalIndex + 1);
            row.appendChild(rankCell);

            const remarkCell = document.createElement('td');
            remarkCell.dataset.label = 'التقدير';
            const badge = document.createElement('span');
            badge.style.cssText = `background:${remarkColor};color:white;padding:4px 10px;border-radius:20px;font-size:12px;`;
            badge.textContent = remark;
            remarkCell.appendChild(badge);
            row.appendChild(remarkCell);
            fragment.appendChild(row);
        });
    tbody.replaceChildren(fragment);

    renderPagination(totalPages);
}

function renderPagination(totalPages) {
    const bar = document.getElementById('pagination-bar');
    if (totalPages <= 1) {
        bar.innerHTML = '';
        return;
    }

    let html = '';
    html += `<button type="button" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}><i class="fas fa-chevron-right" aria-hidden="true"></i></button>`;

    const maxVisible = 7;
    let pages = [];
    if (totalPages <= maxVisible) {
        for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
        pages.push(1);
        let lo = Math.max(2, currentPage - 1);
        let hi = Math.min(totalPages - 1, currentPage + 1);
        if (currentPage <= 3) {
            lo = 2;
            hi = 4;
        }
        if (currentPage >= totalPages - 2) {
            lo = totalPages - 3;
            hi = totalPages - 1;
        }
        if (lo > 2) pages.push('...');
        for (let i = lo; i <= hi; i++) pages.push(i);
        if (hi < totalPages - 1) pages.push('...');
        pages.push(totalPages);
    }

    pages.forEach((p) => {
        if (p === '...') {
            html += `<span class="pagination-info">…</span>`;
        } else {
            html += `<button type="button" class="${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
        }
    });

    html += `<button type="button" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}><i class="fas fa-chevron-left" aria-hidden="true"></i></button>`;
    html += `<span class="pagination-info">${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, currentStudentData.length)} من ${currentStudentData.length}</span>`;
    bar.innerHTML = html;
    bar.querySelectorAll('button[data-page]').forEach((button) => {
        button.addEventListener('click', () => goToPage(Number(button.dataset.page)));
    });
}

function goToPage(page) {
    currentPage = page;
    renderPage();
    document.querySelector('.table-responsive').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ===== Student Detail Modal =====
function gradeColor(val) {
    if (val >= 16) return '#2ECC71';
    if (val >= 14) return '#3b82f6';
    if (val >= 12) return '#f59e0b';
    if (val >= 10) return '#f97316';
    return '#E85D5D';
}

async function showStudentDetail(studentId) {
    const overlay = document.getElementById('detail-overlay');
    const allGrades = allGradesCache.length
        ? allGradesCache
        : (await window.api.grades.getAll(year)) || [];

    const rawStudentGrades = allGrades
        .filter((g) => studentIdentityFromGrade(g) === studentId || String(g.student_code || '') === studentId)
        .map((g) => ({ ...g, grade: Number(g.grade) }))
        .filter((g) => Number.isFinite(g.grade));

    // Deduplicate: keep only the latest entry per original subject + semester
    const dedup = {};
    rawStudentGrades.forEach((g) => {
        const key = `${String(g.subject || '').trim()}||${g.semester || ''}`;
        // Keep the last (most recent) entry
        dedup[key] = g;
    });
    const studentGrades = Object.values(dedup);

    if (!studentGrades.length) {
        fillDetailHeader(studentId, null);
        document.getElementById('detail-kpis').replaceChildren();
        document.getElementById('detail-subjects').innerHTML =
            '<div class="detail-empty"><i class="fas fa-inbox"></i><p>لا توجد نقط مسجلة لهذا التلميذ</p></div>';
        overlay.classList.add('active');
        return;
    }

    const first = studentGrades[0] || {};
    fillDetailHeader(studentId, first);

    // Group by base subject (merging exams + activities)
    const bySubject = {};
    studentGrades.forEach((g) => {
        const subj = normalizeSubjectName(g.subject) || 'غير محدد';
        if (!bySubject[subj]) bySubject[subj] = [];
        bySubject[subj].push(g);
    });

    // KPIs — use weighted averages per subject
    const subjects = Object.keys(bySubject);
    const totalGrades = studentGrades.length;
    const subjectAvgs = subjects.map((s) => ({ subject: s, avg: computeSubjectAverage(s, bySubject[s]) }));
    const branch =
        typeof detectBranch === 'function' ? detectBranch(first.section || first.class_name || '') : null;
    const generalAvg =
        typeof computeWeightedGeneralAverage === 'function'
            ? computeWeightedGeneralAverage(subjectAvgs, branch)
            : subjectAvgs.length
              ? subjectAvgs.reduce((a, s) => a + s.avg, 0) / subjectAvgs.length
              : 0;
    const maxGrade = Math.max(...studentGrades.map((g) => g.grade));
    const minGrade = Math.min(...studentGrades.map((g) => g.grade));

    document.getElementById('detail-kpis').innerHTML = `
    <div class="detail-kpi">
        <div class="kpi-val" style="color:${gradeColor(generalAvg)}">${generalAvg.toFixed(2)}</div>
        <div class="kpi-lbl">المعدل العام</div>
    </div>
    <div class="detail-kpi">
        <div class="kpi-val">${subjects.length}</div>
        <div class="kpi-lbl">عدد المواد</div>
    </div>
    <div class="detail-kpi">
        <div class="kpi-val">${totalGrades}</div>
        <div class="kpi-lbl">عدد النقط</div>
    </div>
    <div class="detail-kpi">
        <div class="kpi-val" style="color:#2ECC71">${maxGrade.toFixed(1)}</div>
        <div class="kpi-lbl">أعلى نقطة</div>
    </div>
    <div class="detail-kpi">
        <div class="kpi-val" style="color:#E85D5D">${minGrade.toFixed(1)}</div>
        <div class="kpi-lbl">أدنى نقطة</div>
    </div>
`;

    // Render subjects
    const sortedSubjects = subjects.sort(
        typeof compareSubjects === 'function' ? compareSubjects : (a, b) => a.localeCompare(b, 'ar')
    );
    const subjectsContainer = document.getElementById('detail-subjects');
    const subjectFragment = document.createDocumentFragment();
    sortedSubjects.forEach((subj) => {
            const grades = bySubject[subj];
            const avg = computeSubjectAverage(subj, grades);
            const color = gradeColor(avg);

            // Group by semester
            const bySemester = {};
            grades.forEach((g) => {
                const sem = g.semester || 0;
                if (!bySemester[sem]) bySemester[sem] = [];
                bySemester[sem].push(g);
            });
            const semesterKeys = Object.keys(bySemester).sort((a, b) => Number(a) - Number(b));
            const semesterNames = { 1: 'الدورة الأولى', 2: 'الدورة الثانية', 0: 'غير محددة' };
            const hasMultipleSemesters =
                semesterKeys.length > 1 || (semesterKeys.length === 1 && semesterKeys[0] !== '0');

            let bodyHtml = '';
            if (hasMultipleSemesters) {
                const cols = semesterKeys
                    .map((sem) => {
                        const semName = semesterNames[sem] || `الدورة ${sem}`;
                        let examIdx = 0;
                        const chips = bySemester[sem]
                            .map((g) => {
                                const gc = gradeColor(g.grade);
                                const pct = Math.min((g.grade / 20) * 100, 100);
                                const isActv = ccIsActivity(g.subject);
                                const chipLabel = isActv ? 'أنشطة مندمجة' : `فرض ${++examIdx}`;
                                return `<div class="grade-chip">
                    <span class="chip-label">${chipLabel}</span>
                    <span class="chip-value" style="color:${gc}">${g.grade.toFixed(2)}</span>
                    <div class="chip-bar"><div class="chip-bar-fill" style="width:${pct}%;background:${gc}"></div></div>
                </div>`;
                            })
                            .join('');
                        return `<div class="semester-col">
                <div class="semester-header"><span>${semName}</span></div>
                <div class="grades-chips">${chips}</div>
            </div>`;
                    })
                    .join('');
                bodyHtml = `<div class="semesters-grid">${cols}</div>`;
            } else {
                let examIdx = 0;
                const chips = grades
                    .map((g) => {
                        const gc = gradeColor(g.grade);
                        const pct = Math.min((g.grade / 20) * 100, 100);
                        const isActv = ccIsActivity(g.subject);
                        const chipLabel = isActv ? 'أنشطة مندمجة' : `فرض ${++examIdx}`;
                        return `<div class="grade-chip">
                <span class="chip-label">${chipLabel}</span>
                <span class="chip-value" style="color:${gc}">${g.grade.toFixed(2)}</span>
                <div class="chip-bar"><div class="chip-bar-fill" style="width:${pct}%;background:${gc}"></div></div>
            </div>`;
                    })
                    .join('');
                bodyHtml = `<div class="grades-chips">${chips}</div>`;
            }

            const subjectBlock = document.createElement('div');
            subjectBlock.className = 'subject-block';
            subjectBlock.innerHTML = `<div class="subject-block-header"><span class="subj-name"><i class="fas fa-book" aria-hidden="true"></i></span><span class="subj-avg" style="background:${color}">${avg.toFixed(2)}</span></div><div class="subject-block-body">${bodyHtml}</div>`;
            subjectBlock.querySelector('.subj-name').append(document.createTextNode(` ${subj}`));
            subjectFragment.appendChild(subjectBlock);
        });
    subjectsContainer.replaceChildren(subjectFragment);

    overlay.classList.add('active');
}

// Close modal
document.getElementById('detail-close').addEventListener('click', () => {
    document.getElementById('detail-overlay').classList.remove('active');
});
document.getElementById('detail-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        e.currentTarget.classList.remove('active');
    }
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.getElementById('detail-overlay').classList.remove('active');
});

// ===== Tab 2: الحاصلون على صفر =====

let zCurrentPage = 1;
let zActiveRequestId = 0;
let zDebounceTimer = null;

function zGetFilters() {
    return {
        className: document.getElementById('zeros-class').value,
        semester: document.getElementById('zeros-semester').value,
        searchTerm: document.getElementById('zeros-search').value.trim()
    };
}

function zGetPageSize() {
    const v = Number(document.getElementById('zeros-page-size').value);
    return Number.isFinite(v) && v > 0 ? v : PAGE_SIZE;
}

function zSemesterLabel(value) {
    const s = String(value || '');
    return s === '1' ? 'الأولى' : s === '2' ? 'الثانية' : '-';
}

function zUpdateKpis(summary = {}) {
    document.getElementById('z-kpi-total').textContent = String(summary.totalCases || 0);
    document.getElementById('z-kpi-students').textContent = String(summary.uniqueStudents || 0);
    document.getElementById('z-kpi-sections').textContent = String(summary.sectionsCount || 0);
    document.getElementById('z-kpi-absence').textContent = String(summary.absenceLinkedCases || 0);
}

function zUpdateMeta(pagination) {
    const totalRows = Number(pagination?.totalRows || 0);
    const page = Number(pagination?.page || 1);
    const pageSize = Number(pagination?.pageSize || zGetPageSize());
    if (!totalRows) {
        document.getElementById('z-results-meta').textContent = '-';
        document.getElementById('z-results-count').textContent = '0';
        return;
    }
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, totalRows);
    document.getElementById('z-results-meta').textContent = `عرض ${start} - ${end} من ${totalRows}`;
    document.getElementById('z-results-count').textContent = String(totalRows);
}

function zRenderRows(rows, pagination) {
    const tbody = document.getElementById('z-tbody');
    const startIndex = (Number(pagination.page || 1) - 1) * Number(pagination.pageSize || zGetPageSize());
    const fragment = document.createDocumentFragment();
    rows.forEach((row, idx) => {
        const reason = row.zero_reason || (Number(row.absence_count || 0) > 0 ? 'غياب' : 'تعثر دراسي');
        const tr = document.createElement('tr');
        [
            ['#', String(startIndex + idx + 1)],
            ['رمز مسار', row.student_code || row.massar_code || '-'],
            ['الاسم الكامل', row.student_name || row.full_name || '-'],
            ['القسم', row.class_name || row.section || '-'],
            ['المادة', row.subject || '-'],
            ['الدورة', zSemesterLabel(row.semester)],
            ['السبب', reason]
        ].forEach(([label, value]) => {
            const td = document.createElement('td');
            td.dataset.label = label;
            td.textContent = value;
            tr.appendChild(td);
        });
        fragment.appendChild(tr);
    });
    tbody.replaceChildren(fragment);
}

function zBuildPageList(current, totalPages) {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages = [1];
    const start = Math.max(2, current - 1);
    const end = Math.min(totalPages - 1, current + 1);
    if (start > 2) pages.push('...');
    for (let p = start; p <= end; p++) pages.push(p);
    if (end < totalPages - 1) pages.push('...');
    pages.push(totalPages);
    return pages;
}

function zRenderPagination(pagination) {
    const container = document.getElementById('z-pagination');
    const totalRows = Number(pagination?.totalRows || 0);
    const totalPages = Number(pagination?.totalPages || 1);
    const page = Number(pagination?.page || 1);
    if (!totalRows || totalPages <= 1) {
        container.style.display = 'none';
        container.replaceChildren();
        return;
    }
    const make = (label, pageVal, cls, disabled, active) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = cls + (active ? ' active' : '');
        btn.dataset.page = String(pageVal);
        btn.textContent = label;
        btn.disabled = disabled;
        return btn;
    };
    const nodes = [make('السابق', page - 1, 'nav-btn', page <= 1, false)];
    zBuildPageList(page, totalPages).forEach((item) => {
        if (item === '...') {
            const span = document.createElement('span');
            span.className = 'ellipsis';
            span.textContent = '...';
            nodes.push(span);
        } else {
            nodes.push(make(String(item), item, 'page-btn', false, item === page));
        }
    });
    nodes.push(make('التالي', page + 1, 'nav-btn', page >= totalPages, false));
    const info = document.createElement('span');
    info.className = 'page-info';
    info.textContent = `صفحة ${page} من ${totalPages}`;
    nodes.push(info);
    container.replaceChildren(...nodes);
    container.style.display = 'flex';
}

function zNormalizeRows(rows = []) {
    return rows
        .map((g) => ({
            id: g.id,
            student_code: g.student_code || g.massar_code || '',
            student_name: g.student_name || g.full_name || '',
            class_name: g.class_name || g.section || '',
            subject: g.subject || '',
            semester: String(g.semester || ''),
            grade: Number(g.grade),
            absence_count: Number(g.absence_count || 0),
            zero_reason: g.zero_reason || ''
        }))
        .filter((g) => g.grade === 0);
}

async function zBuildFallback({
    className = '',
    semester = '',
    searchTerm = '',
    page = 1,
    pageSize = PAGE_SIZE,
    exportAll = false
} = {}) {
    const rawGrades = allGradesCache.length ? allGradesCache : await window.api.grades.getAll(year);
    const all = zNormalizeRows(Array.isArray(rawGrades) ? rawGrades : []);
    const search = searchTerm.trim().toLowerCase();
    let filtered = all;
    if (className) filtered = filtered.filter((g) => g.class_name === className);
    if (semester) filtered = filtered.filter((g) => String(g.semester) === String(semester));
    if (search)
        filtered = filtered.filter(
            (g) =>
                String(g.student_name).toLowerCase().includes(search) ||
                String(g.student_code).toLowerCase().includes(search) ||
                String(g.subject).toLowerCase().includes(search)
        );
    filtered.sort((a, b) => {
        const bySection = String(a.class_name).localeCompare(String(b.class_name), 'ar');
        return bySection !== 0
            ? bySection
            : String(a.student_name).localeCompare(String(b.student_name), 'ar');
    });
    const totalRows = filtered.length;
    const totalPages = totalRows ? Math.ceil(totalRows / pageSize) : 1;
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * pageSize;
    const rows = exportAll ? filtered : filtered.slice(start, start + pageSize);
    return {
        success: true,
        rows: rows.map((r) => ({ ...r, zero_reason: r.zero_reason || 'تعثر دراسي' })),
        pagination: {
            page: exportAll ? 1 : safePage,
            pageSize: exportAll ? rows.length || pageSize : pageSize,
            totalRows,
            totalPages: exportAll ? 1 : totalPages
        },
        summary: {
            totalCases: totalRows,
            uniqueStudents: new Set(filtered.map((r) => r.student_code || r.student_name)).size,
            sectionsCount: new Set(filtered.map((r) => r.class_name)).size,
            absenceLinkedCases: 0
        }
    };
}

async function zFetch({
    className = '',
    semester = '',
    searchTerm = '',
    page = 1,
    pageSize = PAGE_SIZE,
    exportAll = false
} = {}) {
    if (typeof window.api?.grades?.getZeroStudents === 'function') {
        try {
            const result = await window.api.grades.getZeroStudents({
                schoolYear: year,
                className,
                semester,
                searchTerm,
                page,
                pageSize,
                exportAll
            });
            if (result?.success) return result;
            console.warn('grades:getZeroStudents returned unsuccessful result, using client fallback');
        } catch (err) {
            console.warn('grades:getZeroStudents failed, using client fallback:', err);
        }
    }
    return zBuildFallback({ className, semester, searchTerm, page, pageSize, exportAll });
}

function zRenderMessage(message, iconClass = 'fa-info-circle', color = '#6b7280') {
    const tbody = document.getElementById('z-tbody');
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.style.cssText = 'padding:20px;text-align:center;';
    const icon = document.createElement('i');
    icon.className = `fas ${iconClass}`;
    icon.style.cssText = `color:${color};font-size:32px;display:block;margin-bottom:10px;`;
    td.append(icon, document.createTextNode(message));
    tr.appendChild(td);
    tbody.replaceChildren(tr);
}

async function searchZeros({ resetPage = false } = {}) {
    if (resetPage) zCurrentPage = 1;
    const reqId = ++zActiveRequestId;
    const filters = zGetFilters();
    const pageSize = zGetPageSize();
    try {
        zRenderMessage('جاري تحميل المعطيات...', 'fa-spinner fa-spin', '#3B6AC5');
        const result = await zFetch({ ...filters, page: zCurrentPage, pageSize, exportAll: false });
        if (reqId !== zActiveRequestId) return;
        if (!result?.success) throw new Error(result?.error || 'تعذر جلب المعطيات');
        zCurrentPage = Number(result.pagination?.page || 1);
        zUpdateKpis(result.summary || {});
        zUpdateMeta(result.pagination || {});
        zRenderPagination(result.pagination || {});
        const rows = Array.isArray(result.rows) ? result.rows : [];
        document.getElementById('zeros-export-btn').disabled =
            !rows.length && !Number(result.pagination?.totalRows || 0);
        if (!rows.length) {
            zRenderMessage(
                'لا يوجد تلاميذ حاصلون على صفر وفق الفلاتر الحالية',
                'fa-check-circle',
                '#10b981'
            );
            return;
        }
        zRenderRows(rows, result.pagination || {});
    } catch (err) {
        console.warn('Zero students error:', err);
        zUpdateKpis({});
        zUpdateMeta({ totalRows: 0 });
        zRenderPagination({ totalRows: 0, totalPages: 1, page: 1 });
        zRenderMessage('تعذر جلب المعطيات، حاول مرة أخرى', 'fa-triangle-exclamation', '#e85d5d');
        showToast('تعذر جلب المعطيات', 'error');
    }
}

async function zShowPrintPreview() {
    try {
        showToast('جاري تحضير معاينة الطباعة...', 'info');
        const filters = zGetFilters();
        const result = await zFetch({ ...filters, page: 1, pageSize: zGetPageSize(), exportAll: true });
        if (!result?.success) throw new Error();
        const rows = Array.isArray(result.rows) ? result.rows : [];
        if (!rows.length) {
            showToast('لا توجد بيانات للمعاينة', 'warning');
            return;
        }

        const dateStr = new Intl.DateTimeFormat('ar-MA', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(new Date());
        let identity = {};
        try {
            identity = (await window.api.reports.getIdentity()) || {};
        } catch (_) {}
        const letterhead =
            typeof window.buildLetterheadHTML === 'function'
                ? window.buildLetterheadHTML(identity, year)
                : '';
        const filtersText = [
            filters.className || 'كل الأقسام',
            filters.semester ? zSemesterLabel(filters.semester) : 'كل الدورات'
        ].join(' — ');

        const tableRows = rows
            .map((row, idx) => {
                const reason =
                    row.zero_reason || (Number(row.absence_count || 0) > 0 ? 'غياب' : 'تعثر دراسي');
                const esc = (v) => {
                    const d = document.createElement('div');
                    d.textContent = v == null ? '' : String(v);
                    return d.innerHTML;
                };
                return `<tr>
            <td style="text-align:center;font-weight:600;color:#666">${idx + 1}</td>
            <td>${esc(row.student_code || '-')}</td>
            <td style="font-weight:600">${esc(row.student_name || '-')}</td>
            <td style="text-align:center">${esc(row.class_name || '-')}</td>
            <td style="text-align:center">${esc(row.subject || '-')}</td>
            <td style="text-align:center">${zSemesterLabel(row.semester)}</td>
            <td style="text-align:center">${esc(reason)}</td>
        </tr>`;
            })
            .join('');

        let printDiv = document.getElementById('rh-zeros-print');
        if (!printDiv) {
            printDiv = document.createElement('div');
            printDiv.id = 'rh-zeros-print';
            printDiv.style.display = 'none';
            document.body.appendChild(printDiv);
        }
        printDiv.innerHTML = `<div class="gs-sheet-wrapper"><div class="gs-sheet" id="rh-zeros-sheet">${letterhead}
            <div class="gs-sheet-title">الحاصلون على صفر</div>
            <div class="gs-sheet-subtitle">${filtersText}</div>
            <div class="gs-sheet-meta"><span><i class="fas fa-calendar-alt"></i> السنة الدراسية: ${year}</span><span><i class="fas fa-users"></i> العدد: ${rows.length}</span><span><i class="fas fa-clock"></i> التاريخ: ${dateStr}</span></div>
            <table><thead><tr><th style="text-align:center;width:40px">#</th><th>رمز مسار</th><th>الاسم الكامل</th><th style="text-align:center">القسم</th><th style="text-align:center">المادة</th><th style="text-align:center;width:60px">الدورة</th><th style="text-align:center">السبب</th></tr></thead><tbody>${tableRows}</tbody></table>
            <div class="gs-footer"><span>تاريخ الطباعة: ${dateStr}</span><span>برنامج التدبير المدرسي — ${year}</span></div>
        </div></div>`;
        printDiv.style.display = 'block';

        PrintSystem.preview({
                contentSelector: '#rh-zeros-sheet',
                title: 'الحاصلون على صفر',
                pageSize: 'A4',
                noHeader: true,
                defaultFileName: `تلاميذ_الصفر_${year.replace('/', '-')}`
            });
        setTimeout(() => {
            printDiv.style.display = 'none';
        }, 500);
        showToast(`تم تجهيز المعاينة (${rows.length} سجل)`, 'success');
    } catch (err) {
        console.warn('Print preview error:', err);
        showToast('تعذر فتح معاينة الطباعة', 'error');
    }
}

// ===== Tab 3: الأوائل =====

let topScope = 'section';
const TOP_RANKS = [1, 2, 3];
const topStudentsCache = new Map();

function escapeTopHtml(value) {
    if (typeof window.escapeHtml === 'function')
        return window.escapeHtml(value == null ? '' : String(value));
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
}

function setTopStatus(message) {
    const status = document.getElementById('top-status');
    if (status) status.textContent = message;
}

function setTopScope(scope) {
    topScope = scope;
    document.querySelectorAll('.rh-scope-btn').forEach((button) => {
        const isActive = button.dataset.scope === scope;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-checked', String(isActive));
        button.tabIndex = isActive ? 0 : -1;
    });
}

function setTopGridState(state, message) {
    const grid = document.getElementById('top-grid');
    grid.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
    const toneClass =
        state === 'error'
            ? 'rh-top-state--error'
            : state === 'empty'
              ? 'rh-top-state--empty'
              : 'rh-top-state--loading';
    const iconClass =
        state === 'error'
            ? 'fa-triangle-exclamation'
            : state === 'empty'
              ? 'fa-inbox'
              : 'fa-spinner fa-spin';
    grid.innerHTML = `<div class="rh-top-state ${toneClass}"><i class="fas ${iconClass} rh-top-state-icon" aria-hidden="true"></i>${escapeTopHtml(message)}</div>`;
    setTopStatus(message);
}

function topScopeLabel(scope) {
    if (scope === 'school') return 'المؤسسة';
    if (scope === 'level') return 'المستوى';
    return 'القسم';
}

function getTopStudentsForSemester(semester) {
    const cacheKey = semester || 'all';
    if (topStudentsCache.has(cacheKey)) return topStudentsCache.get(cacheKey);

    const filtered = (allGradesCache || [])
        .map((g) => ({ ...g, grade: Number(g.grade) }))
        .filter((g) => Number.isFinite(g.grade) && (!semester || String(g.semester || '') === semester));

    const studentsAgg = new Map();
    filtered.forEach((g) => {
        const id = String(g.student_id || g.student_code || g.full_name || 'غير محدد');
        const base = normalizeSubjectName(g.subject) || 'غير محدد';
        let agg = studentsAgg.get(id);
        if (!agg) {
            agg = { firstRecord: g, bySubject: new Map() };
            studentsAgg.set(id, agg);
        }
        const arr = agg.bySubject.get(base) || [];
        arr.push(g);
        agg.bySubject.set(base, arr);
    });

    const students = Array.from(studentsAgg.entries())
        .map(([id, agg]) => {
            const first = agg.firstRecord || {};
            const subjectAvgs = Array.from(agg.bySubject.entries(), ([base, grds]) => ({
                subject: base,
                avg: computeSubjectAverage(base, grds)
            }));
            const branch =
                typeof detectBranch === 'function'
                    ? detectBranch(first.section || first.class_name || '')
                    : null;
            const average =
                typeof computeWeightedGeneralAverage === 'function'
                    ? computeWeightedGeneralAverage(subjectAvgs, branch)
                    : subjectAvgs.length
                      ? subjectAvgs.reduce((sum, item) => sum + item.avg, 0) / subjectAvgs.length
                      : 0;

            return {
                id,
                name: String(first.full_name || first.student_code || id),
                massar_code: first.student_code || first.massar_code || '-',
                section: first.section || '-',
                level: _getLocalLevelName(first.section || ''),
                average
            };
        })
        .sort((a, b) => b.average - a.average);

    topStudentsCache.set(cacheKey, students);
    return students;
}

function topGradeColor(avg) {
    if (avg >= 16) return 'rh-top-avg--success';
    if (avg >= 14) return 'rh-top-avg--info';
    if (avg >= 12) return 'rh-top-avg--warning';
    if (avg >= 10) return 'rh-top-avg--warning-soft';
    return 'rh-top-avg--danger';
}

async function renderTopPerformers() {
    const grid = document.getElementById('top-grid');
    const semester = document.getElementById('top-semester').value;

    setTopGridState('loading', 'جاري تحميل بيانات الأوائل...');

    try {
        const students = getTopStudentsForSemester(semester);

        if (!students.length) {
            setTopGridState('empty', 'لا توجد بيانات في هذا النطاق');
            return;
        }
        const cards = [];
        if (topScope === 'school') {
            cards.push(buildTopCard('المؤسسة بأكملها', 'fa-school', students.slice(0, 3)));
        } else if (topScope === 'section') {
            const bySection = {};
            students.forEach((s) => {
                if (!bySection[s.section]) bySection[s.section] = [];
                bySection[s.section].push(s);
            });
            sortSectionNames(Object.keys(bySection)).forEach((sec) => {
                cards.push(buildTopCard(sec, 'fa-chalkboard', bySection[sec].slice(0, 3)));
            });
        } else {
            const byLevel = {};
            students.forEach((s) => {
                const lv = s.level || 'غير محدد';
                if (!byLevel[lv]) byLevel[lv] = [];
                byLevel[lv].push(s);
            });
            const levels = Object.keys(byLevel);
            (typeof sortLevelNames === 'function' ? sortLevelNames(levels) : levels).forEach((lv) => {
                cards.push(buildTopCard(lv, 'fa-layer-group', byLevel[lv].slice(0, 3)));
            });
        }

        grid.replaceChildren(...cards.filter(Boolean));
        grid.setAttribute('aria-busy', 'false');
        setTopStatus(`تم تحميل ${cards.length} بطاقة للأوائل حسب ${topScopeLabel(topScope)}.`);

        if (!cards.length) {
            setTopGridState('empty', 'لا توجد بيانات كافية لعرض الأوائل');
        }
    } catch (err) {
        console.warn('Top performers error:', err);
        setTopGridState('error', 'تعذر تحميل بيانات الأوائل');
    }
}

function buildTopCard(label, iconClass, topStudents) {
    if (!topStudents || !topStudents.length) return null;

    const card = document.createElement('section');
    card.className = 'rh-top-card';

    const header = document.createElement('div');
    header.className = 'rh-top-card-header';

    const headerIcon = document.createElement('i');
    headerIcon.className = `fas ${iconClass}`;
    headerIcon.setAttribute('aria-hidden', 'true');
    header.appendChild(headerIcon);
    header.append(document.createTextNode(` ${label}`));
    card.appendChild(header);

    topStudents.forEach((student, index) => {
        const row = document.createElement('div');
        row.className = 'rh-top-row';

        const rank = document.createElement('span');
        rank.className = 'rh-top-rank';
        rank.textContent = String(TOP_RANKS[index] || index + 1);
        rank.setAttribute('aria-label', `الرتبة ${index + 1}`);

        const info = document.createElement('div');
        info.className = 'rh-top-info';

        const name = document.createElement('div');
        name.className = 'rh-top-name';
        name.textContent = student.name;
        name.title = student.name;

        const code = document.createElement('div');
        code.className = 'rh-top-code';
        code.textContent = student.massar_code;

        const meta = document.createElement('div');
        meta.className = 'rh-top-meta';
        meta.textContent = topScope === 'school' ? student.section : student.level || student.section;

        info.append(name, code, meta);

        const average = document.createElement('span');
        average.className = `rh-top-avg ${topGradeColor(student.average)}`;
        average.textContent = student.average.toFixed(2);

        row.append(rank, info, average);
        card.appendChild(row);
    });

    return card;
}