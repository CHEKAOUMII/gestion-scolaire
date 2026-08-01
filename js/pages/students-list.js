function getCurrentYear() {
    return getSchoolYear();
}

let students = [];
let filteredStudents = [];
let currentPage = 1;
const PAGE_SIZE = 25;
let sortColumn = null;
let sortDirection = 'asc';
let allClasses = []; // keep all class names for level cascading
let sectionToLevel = {}; // section → level mapping
let _filterManager = null;

// Avatar color palette
const avatarColors = [
    'var(--avatar-color-1)',
    'var(--avatar-color-2)',
    'var(--avatar-color-3)',
    'var(--avatar-color-4)',
    'var(--avatar-color-5)',
    'var(--avatar-color-6)',
    'var(--avatar-color-7)',
    'var(--avatar-color-8)'
];

// CH8: isMale / isFemale / getGenderLabel via js/shared/gender.js

function getAvatarColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return avatarColors[Math.abs(hash) % avatarColors.length];
}

function getInitial(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    return parts[0].charAt(0).toUpperCase();
}

// escapeHtml is provided by utils.js (loaded globally)

// ─── DOM Ready ───
document.addEventListener('DOMContentLoaded', async () => {
    await ensureSubjectCoefficientMappings();
    await loadClassesAndLevels();
    restoreFilters();
    await searchStudents();

    // Form submit
    document.getElementById('search-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        currentPage = 1;
        await searchStudents();
    });

    // Live search with debounce
    const queryInput = document.getElementById('search-query');
    const debouncedSearch = debounce(async () => {
        currentPage = 1;
        await searchStudents();
    }, 300);
    queryInput.addEventListener('input', debouncedSearch);

    // Level cascading → class dropdown (FilterManager handles cascading)
    document.getElementById('search-level').addEventListener('change', async () => {
        currentPage = 1;
        await searchStudents();
    });

    // Filter changes
    document.getElementById('search-class').addEventListener('change', async () => {
        currentPage = 1;
        await searchStudents();
    });
    document.getElementById('search-gender').addEventListener('change', async () => {
        currentPage = 1;
        await searchStudents();
    });

    // PDF export from print preview
    // (now handled by the shared UX print preview system)

    // Sorting
    document.querySelectorAll('.sl-table .sl-sort-button').forEach((button) => {
        button.addEventListener('click', () => handleSort(button.closest('th')?.dataset.sort));
    });
    setupStudentsTableInteractions();

    // Student modal
    document.getElementById('modal-close').addEventListener('click', closeStudentModal);
    document.getElementById('modal-close-btn').addEventListener('click', closeStudentModal);
    document.getElementById('student-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeStudentModal();
    });

    // Print preview (uses shared UX system)
    document.getElementById('print-preview-btn').addEventListener('click', openSlPrintPreview);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            queryInput.focus();
            queryInput.select();
        }
    });
});

// ─── Load Classes & Levels (via FilterManager) ───
async function loadClassesAndLevels() {
    try {
        _filterManager = new FilterManager({
            selectors: { level: 'search-level', class: 'search-class' }
        });
        await _filterManager.init();

        // Sync caches for search filtering
        const fmData = _filterManager.getData();
        allClasses = fmData.classes;
        sectionToLevel = _filterManager._levelsMapping || {};
    } catch (_error) {
        showToast('تعذر تحميل قائمة الأقسام', 'warning');
    }
}

function _getLocalLevelName(section) {
    if (_filterManager) return _filterManager._getLocalLevelName(section);
    return resolveLevelName(section, sectionToLevel);
}

// ─── Save / Restore Filters ───
function saveFilters() {
    const filters = {
        query: document.getElementById('search-query').value,
        level: document.getElementById('search-level').value,
        class: document.getElementById('search-class').value,
        gender: document.getElementById('search-gender').value
    };
    saveToStorage('sl_filters', filters);
}

function restoreFilters() {
    const filters = loadFromStorage('sl_filters');
    if (!filters) return;
    if (filters.query) document.getElementById('search-query').value = filters.query;
    if (filters.level && _filterManager) {
        document.getElementById('search-level').value = filters.level;
        // Trigger FilterManager cascade for class dropdown
        _filterManager._refreshClasses();
    }
    if (filters.class) document.getElementById('search-class').value = filters.class;
    if (filters.gender) document.getElementById('search-gender').value = filters.gender;
}

// ─── Search ───
async function searchStudents() {
    const query = document.getElementById('search-query').value.trim().toLowerCase();
    const levelName = document.getElementById('search-level').value;
    const className = document.getElementById('search-class').value;
    const gender = document.getElementById('search-gender').value;

    saveFilters();
    renderTableState('loading');

    try {
        // Pass query to server-side search (filters by name/code on the DB)
        students = (await window.api.students.search(query, className, '', getCurrentYear())) || [];

        // Level filter (client-side — depends on local mapping)
        if (levelName) {
            students = students.filter((s) => _getLocalLevelName(s.class_name || s.section || '') === levelName);
        }

        // Birth date filter (client-side — not covered by server search)
        if (query) {
            const serverMatched = new Set(students.map((s) => s.id));
            if (!serverMatched.size) {
                // Server returned nothing for name/code; try birth_date match
                const allInClass = (await window.api.students.search('', className, '', getCurrentYear())) || [];
                students = allInClass.filter((s) => {
                    const birth = (s.birth_date || '').toLowerCase();
                    return birth.includes(query);
                });
            }
        }

        // Client-side gender filter
        if (gender) {
            filteredStudents = students.filter((s) => {
                if (gender === 'M') return isMale(s.gender);
                if (gender === 'F') return isFemale(s.gender);
                return true;
            });
        } else {
            filteredStudents = [...students];
        }

        // Apply current sort
        if (sortColumn) {
            applySortToData();
        }

        renderStudents();
    } catch (_error) {
        students = [];
        filteredStudents = [];
        renderTableState('error');
        showToast('حدث خطأ أثناء جلب البيانات', 'error');
        updateCountBadge();
        updateActionButtons();
    }
}

// ─── Sorting ───
function handleSort(column) {
    if (!column) return;

    if (sortColumn === column) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        sortColumn = column;
        sortDirection = 'asc';
    }

    document.querySelectorAll('.sl-table th[data-sort]').forEach((th) => {
        const icon = th.querySelector('.sort-icon');
        th.classList.remove('sorted');
        th.setAttribute('aria-sort', 'none');
        icon.className = 'fas fa-sort sort-icon';
    });

    const activeTh = document.querySelector(`.sl-table th[data-sort="${column}"]`);
    if (activeTh) {
        activeTh.classList.add('sorted');
        activeTh.setAttribute('aria-sort', sortDirection === 'asc' ? 'ascending' : 'descending');
        const icon = activeTh.querySelector('.sort-icon');
        icon.className = `fas fa-sort-${sortDirection === 'asc' ? 'up' : 'down'} sort-icon`;
    }

    applySortToData();
    renderStudents();
}

function applySortToData() {
    if (!sortColumn) return;
    filteredStudents.sort((a, b) => {
        let valA, valB;
        if (sortColumn === 'index') {
            return 0; // index is just the row number
        }
        valA = (a[sortColumn] || '').toString().toLowerCase();
        valB = (b[sortColumn] || '').toString().toLowerCase();
        const cmp = valA.localeCompare(valB, 'ar');
        return sortDirection === 'asc' ? cmp : -cmp;
    });
}

function createStudentRow(student, rowIndex) {
    const tr = document.createElement('tr');
    const name = student.full_name || '-';
    const initial = getInitial(name);
    const color = getAvatarColor(name);
    const genderClass = isMale(student.gender) ? 'male' : isFemale(student.gender) ? 'female' : '';
    const genderLabel = isMale(student.gender) ? 'ذكر' : isFemale(student.gender) ? 'أنثى' : '-';
    const genderIcon = isMale(student.gender) ? 'fa-mars' : isFemale(student.gender) ? 'fa-venus' : '';

    const addCell = (content) => {
        const td = document.createElement('td');
        if (content instanceof Node) {
            td.appendChild(content);
        } else {
            td.textContent = content;
        }
        tr.appendChild(td);
        return td;
    };

    addCell(String(rowIndex));

    const codeEl = document.createElement('code');
    codeEl.className = 'sl-massar-code';
    codeEl.textContent = student.massar_code || '-';
    addCell(codeEl);

    const studentCell = document.createElement('div');
    studentCell.className = 'sl-student-cell';
    const avatar = document.createElement('div');
    avatar.className = 'sl-avatar';
    avatar.style.background = color;
    avatar.textContent = initial;
    const nameEl = document.createElement('span');
    nameEl.className = 'sl-student-name';
    nameEl.textContent = name;
    studentCell.appendChild(avatar);
    studentCell.appendChild(nameEl);
    addCell(studentCell);

    const classBadge = document.createElement('span');
    classBadge.className = 'sl-class-badge';
    classBadge.textContent = student.class_name || '-';
    addCell(classBadge);

    if (genderClass) {
        const genderBadge = document.createElement('span');
        genderBadge.className = `sl-gender-badge ${genderClass}`;
        const genderIconEl = document.createElement('i');
        genderIconEl.className = `fas ${genderIcon}`;
        genderIconEl.setAttribute('aria-hidden', 'true');
        genderBadge.appendChild(genderIconEl);
        genderBadge.appendChild(document.createTextNode(` ${genderLabel}`));
        addCell(genderBadge);
    } else {
        addCell('-');
    }

    addCell(student.birth_date || '-');

    const actionCell = document.createElement('td');
    const actionButton = document.createElement('button');
    actionButton.className = 'sl-action-btn';
    actionButton.type = 'button';
    actionButton.title = 'عرض ملف التلميذ';
    actionButton.setAttribute('aria-label', 'عرض ملف التلميذ');
    actionButton.dataset.studentCode = student.massar_code || String(student.id);
    const iconEl = document.createElement('i');
    iconEl.className = 'fas fa-eye';
    iconEl.setAttribute('aria-hidden', 'true');
    actionButton.appendChild(iconEl);
    actionCell.appendChild(actionButton);
    tr.appendChild(actionCell);

    return tr;
}

// ─── Render Students ───
function renderStudents() {
    updateCountBadge();
    updateActionButtons();

    if (!filteredStudents.length) {
        renderTableState('empty');
        document.getElementById('pagination').style.display = 'none';
        return;
    }

    const totalPages = Math.ceil(filteredStudents.length / PAGE_SIZE);
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const pageStudents = filteredStudents.slice(start, end);

    const tbody = document.getElementById('students-tbody');
    tbody.replaceChildren(...pageStudents.map((student, index) => createStudentRow(student, start + index + 1)));

    setFeedback(`تم عرض ${filteredStudents.length} تلميذ(ة).`);
    renderPagination(totalPages);
}

// ─── Table States ───
function renderTableState(state) {
    const tbody = document.getElementById('students-tbody');
    document.getElementById('pagination').style.display = 'none';

    if (state === 'loading') {
        tbody.innerHTML = `
            <tr><td colspan="7">
                <div class="sl-loading-state">
                    <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
                    <span>جاري تحميل البيانات...</span>
                </div>
            </td></tr>`;
        setFeedback('جاري تحميل البيانات...');
    } else if (state === 'empty') {
        tbody.innerHTML = `
            <tr><td colspan="7">
                <div class="sl-empty-state">
                    <div class="sl-empty-icon"><i class="fas fa-users-slash"></i></div>
                    <h4>لا توجد نتائج مطابقة</h4>
                    <p>جرّب تغيير معايير البحث أو إزالة بعض الفلاتر</p>
                </div>
            </td></tr>`;
        setFeedback('لا توجد نتائج مطابقة.');
    } else if (state === 'error') {
        tbody.innerHTML = `
            <tr><td colspan="7">
                <div class="sl-error-state">
                    <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
                    <span>تعذر جلب بيانات التلاميذ. حاول مرة أخرى.</span>
                </div>
            </td></tr>`;
        setFeedback('تعذر جلب بيانات التلاميذ.');
    }
}

// ─── Pagination ───
function renderPagination(totalPages) {
    const container = document.getElementById('pagination');
    if (totalPages <= 1) {
        container.style.display = 'none';
        container.replaceChildren();
        return;
    }

    container.style.display = 'flex';
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, filteredStudents.length);
    renderPaginationControls(container, {
        currentPage,
        totalPages,
        onNavigate: goToPage,
        infoText: `${start}-${end} من ${filteredStudents.length}`
    });
}

function setupStudentsTableInteractions() {
    document.getElementById('students-tbody')?.addEventListener('click', (event) => {
        const actionButton = event.target.closest('[data-student-code]');
        if (!actionButton) return;
        viewStudent(actionButton.dataset.studentCode);
    });
}

function goToPage(page) {
    const totalPages = Math.ceil(filteredStudents.length / PAGE_SIZE);
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    renderStudents();
    // Scroll to top of table
    document.querySelector('.sl-table-wrapper')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Helpers ───
function updateCountBadge() {
    document.getElementById('count-badge').textContent = filteredStudents.length;
}

function updateActionButtons() {
    const hasData = filteredStudents.length > 0;
    document.getElementById('print-preview-btn').disabled = !hasData;
}

function setFeedback(message) {
    const feedback = document.getElementById('students-feedback');
    if (feedback) feedback.textContent = message;
}

// ─── Grade Helpers ───
function gradeColor(val) {
    if (val >= 16) return 'var(--color-grade-excellent)';
    if (val >= 14) return 'var(--color-primary)';
    if (val >= 12) return 'var(--color-grade-average)';
    if (val >= 10) return 'var(--color-warning-solid)';
    return 'var(--color-grade-poor)';
}

// normalizeSubjectName() — provided by js/utils.js

// ─── View Student Modal ───
async function viewStudent(code) {
    const normalizedCode = String(code);
    const student = filteredStudents.find((s) => String(s.massar_code || s.id) === normalizedCode);
    if (!student) return;

    const name = student.full_name || '-';
    const initial = getInitial(name);
    const color = getAvatarColor(name);
    const genderLabel = isMale(student.gender) ? 'ذكر' : isFemale(student.gender) ? 'أنثى' : '-';

    // Fetch absence hours for this student (server-side filtered)
    let justifiedHours = 0;
    let unjustifiedHours = 0;
    try {
        const studentCode = student.massar_code || '';
        const studentAbsences = (await window.api.absences.getByStudentCode(studentCode, getCurrentYear())) || [];
        studentAbsences.forEach((a) => {
            const h = Number(a.hours) || 0;
            if (a.absence_type === 'justified') {
                justifiedHours += h;
            } else if (a.absence_type === 'unjustified') {
                unjustifiedHours += h;
            }
        });
    } catch (_err) {
        console.warn('Could not load absence data:', _err);
    }

    const body = document.getElementById('modal-body');
    body.innerHTML = `
        <div class="sl-modal-avatar" style="--avatar-color:${color}">${initial}</div>
        <div class="sl-modal-info-grid">
            <div class="sl-modal-info-item full-width">
                <div class="sl-modal-info-label"><i class="fas fa-user"></i> الاسم الكامل</div>
                <div class="sl-modal-info-value">${escapeHtml(name)}</div>
            </div>
            <div class="sl-modal-info-item">
                <div class="sl-modal-info-label"><i class="fas fa-barcode"></i> رمز مسار</div>
                <div class="sl-modal-info-value sl-modal-info-value-ltr">${escapeHtml(student.massar_code || '-')}</div>
            </div>
            <div class="sl-modal-info-item">
                <div class="sl-modal-info-label"><i class="fas fa-chalkboard"></i> القسم</div>
                <div class="sl-modal-info-value">${escapeHtml(student.class_name || '-')}</div>
            </div>
            <div class="sl-modal-info-item">
                <div class="sl-modal-info-label"><i class="fas fa-venus-mars"></i> الجنس</div>
                <div class="sl-modal-info-value">${escapeHtml(genderLabel)}</div>
            </div>
            <div class="sl-modal-info-item">
                <div class="sl-modal-info-label"><i class="fas fa-calendar"></i> تاريخ الازدياد</div>
                <div class="sl-modal-info-value">${escapeHtml(student.birth_date || '-')}</div>
            </div>
            <div class="sl-modal-info-item">
                <div class="sl-modal-info-label"><i class="fas fa-clock sl-modal-icon-success"></i> ساعات الغياب المبررة</div>
                <div class="sl-modal-info-value sl-modal-metric-success">${justifiedHours} <small class="sl-modal-metric-unit">ساعة</small></div>
            </div>
            <div class="sl-modal-info-item">
                <div class="sl-modal-info-label"><i class="fas fa-clock sl-modal-icon-danger"></i> ساعات الغياب غير المبررة</div>
                <div class="sl-modal-info-value sl-modal-metric-danger">${unjustifiedHours} <small class="sl-modal-metric-unit">ساعة</small></div>
            </div>
        </div>

        <!-- Grades Section -->
        <h4 class="sl-grades-section-title"><i class="fas fa-book-open"></i> تفاصيل النقط حسب المادة</h4>
        <div id="modal-grades-kpis"></div>
        <div id="modal-grades-subjects">
            <div class="sl-grades-loading"><i class="fas fa-spinner fa-spin"></i> جاري تحميل النقط...</div>
        </div>
    `;

    const modal = document.getElementById('student-modal');
    if (window.UXEnhancements?.openDialog) {
        window.UXEnhancements.openDialog(modal, {
            contentSelector: '.sl-modal',
            initialFocus: '#modal-close'
        });
    } else {
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
    }

    // Show "View Full Profile" button if massar_code exists
    const fullProfileBtn = document.getElementById('modal-full-profile-btn');
    if (fullProfileBtn) {
        if (student.massar_code) {
            fullProfileBtn.href = `student-profile-prototype.html?code=${encodeURIComponent(student.massar_code)}`;
            fullProfileBtn.style.display = 'inline-flex';
        } else {
            fullProfileBtn.style.display = 'none';
        }
    }

    // Fetch and render grades (server-side filtered by student code)
    try {
        const studentCode = student.massar_code || '';
        const rawStudentGrades = ((await window.api.grades.getByStudentCode(studentCode, getCurrentYear())) || [])
            .map((g) => ({ ...g, grade: Number(g.grade) }))
            .filter((g) => Number.isFinite(g.grade));

        // Deduplicate: keep only the latest entry per original subject + semester
        const dedup = {};
        rawStudentGrades.forEach((g) => {
            const key = `${String(g.subject || '').trim()}||${g.semester || ''}`;
            dedup[key] = g;
        });
        const studentGrades = Object.values(dedup);

        const kpisContainer = document.getElementById('modal-grades-kpis');
        const subjectsContainer = document.getElementById('modal-grades-subjects');

        if (!studentGrades.length) {
            kpisContainer.innerHTML = '';
            subjectsContainer.innerHTML =
                '<div class="sl-grades-empty"><i class="fas fa-inbox"></i><p>لا توجد نقط مسجلة لهذا التلميذ</p></div>';
            return;
        }

        // Group by base subject (merging exams + activities)
        const bySubject = {};
        studentGrades.forEach((g) => {
            const subj =
                (typeof ccBaseSubject === 'function'
                    ? ccBaseSubject(normalizeSubjectName(g.subject))
                    : normalizeSubjectName(g.subject)) || 'غير محدد';
            if (!bySubject[subj]) bySubject[subj] = [];
            bySubject[subj].push(g);
        });

        // Calculate KPIs using weighted averages
        const subjects = Object.keys(bySubject);
        const subjectAvgsArr = subjects.map((s) => {
            const avg =
                typeof computeSubjectAverage === 'function'
                    ? computeSubjectAverage(s, bySubject[s])
                    : bySubject[s].reduce((a, g) => a + g.grade, 0) / bySubject[s].length;
            return { subject: s, avg };
        });
        const branch =
            typeof detectBranch === 'function' ? detectBranch(student.section || student.class_name || '') : null;
        const averageResolution = computeWeightedGeneralAverageResult(subjectAvgsArr, branch, {
            schoolYear: getCurrentYear(),
            streamCode: branch
        });
        const generalAvg = averageResolution.ok ? averageResolution.value : null;
        const totalGrades = studentGrades.length;
        const maxGrade = Math.max(...studentGrades.map((g) => g.grade));
        const minGrade = Math.min(...studentGrades.map((g) => g.grade));

        // Render KPIs
        kpisContainer.innerHTML = `
            <div class="sl-detail-kpis">
                <div class="sl-detail-kpi">
                    <div class="kpi-val" style="--kpi-color:${generalAvg == null ? 'inherit' : gradeColor(generalAvg)}">${generalAvg == null ? '—' : generalAvg.toFixed(2)}</div>
                    <div class="kpi-lbl">المعدل العام</div>
                </div>
                <div class="sl-detail-kpi">
                    <div class="kpi-val">${subjects.length}</div>
                    <div class="kpi-lbl">عدد المواد</div>
                </div>
                <div class="sl-detail-kpi">
                    <div class="kpi-val">${totalGrades}</div>
                    <div class="kpi-lbl">عدد النقط</div>
                </div>
                <div class="sl-detail-kpi">
                    <div class="kpi-val" style="--kpi-color:var(--color-success-text)">${maxGrade.toFixed(1)}</div>
                    <div class="kpi-lbl">أعلى نقطة</div>
                </div>
                <div class="sl-detail-kpi">
                    <div class="kpi-val" style="--kpi-color:var(--color-danger-text)">${minGrade.toFixed(1)}</div>
                    <div class="kpi-lbl">أدنى نقطة</div>
                </div>
            </div>
        `;

        // Render subject blocks
        const sortedSubjects = subjects.sort(
            typeof compareSubjects === 'function' ? compareSubjects : (a, b) => a.localeCompare(b, 'ar')
        );
        subjectsContainer.innerHTML = sortedSubjects
            .map((subj) => {
                const grades = bySubject[subj];
                const avg =
                    typeof computeSubjectAverage === 'function'
                        ? computeSubjectAverage(subj, grades)
                        : grades.reduce((a, g) => a + g.grade, 0) / grades.length;
                const clr = gradeColor(avg);

                // Group grades by semester and sort (semester 1 first, then 2)
                const bySemester = {};
                grades.forEach((g) => {
                    const sem = g.semester || 0;
                    if (!bySemester[sem]) bySemester[sem] = [];
                    bySemester[sem].push(g);
                });
                const semesterKeys = Object.keys(bySemester).sort((a, b) => Number(a) - Number(b));
                const semesterNames = { 1: 'الدورة الأولى', 2: 'الدورة الثانية', 0: 'غير محددة' };
                const hasMutipleSemesters =
                    semesterKeys.length > 1 || (semesterKeys.length === 1 && semesterKeys[0] !== '0');

                let bodyHtml = '';
                if (hasMutipleSemesters) {
                    // Grid layout: each semester is a column
                    const cols = semesterKeys
                        .map((sem) => {
                            const semName = semesterNames[sem] || `الدورة ${sem}`;
                            let examIdx = 0;
                            const chips = bySemester[sem]
                                .map((g) => {
                                    const gc = gradeColor(g.grade);
                                    const pct = Math.min((g.grade / 20) * 100, 100);
                                    const isActv = typeof ccIsActivity === 'function' && ccIsActivity(g.subject);
                                    const chipLabel = isActv ? 'أنشطة مندمجة' : `فرض ${++examIdx}`;
                                    return `<div class="sl-grade-chip">
                                <span class="chip-label">${chipLabel}</span>
                                <span class="chip-value" style="--grade-color:${gc}">${g.grade.toFixed(2)}</span>
                                <div class="chip-bar"><div class="chip-bar-fill" style="width:${pct}%;--grade-color:${gc}"></div></div>
                            </div>`;
                                })
                                .join('');
                            return `<div class="sl-semester-col">
                            <div class="sl-semester-header"><span>${semName}</span></div>
                            <div class="sl-grades-chips">${chips}</div>
                        </div>`;
                        })
                        .join('');
                    bodyHtml = `<div class="sl-semesters-grid">${cols}</div>`;
                } else {
                    // Single semester or no semester — flat layout
                    let examIdx = 0;
                    const chips = grades
                        .map((g) => {
                            const gc = gradeColor(g.grade);
                            const pct = Math.min((g.grade / 20) * 100, 100);
                            const isActv = typeof ccIsActivity === 'function' && ccIsActivity(g.subject);
                            const chipLabel = isActv ? 'أنشطة مندمجة' : `فرض ${++examIdx}`;
                            return `<div class="sl-grade-chip">
                            <span class="chip-label">${chipLabel}</span>
                            <span class="chip-value" style="--grade-color:${gc}">${g.grade.toFixed(2)}</span>
                            <div class="chip-bar"><div class="chip-bar-fill" style="width:${pct}%;--grade-color:${gc}"></div></div>
                        </div>`;
                        })
                        .join('');
                    bodyHtml = `<div class="sl-grades-chips">${chips}</div>`;
                }

                return `
                <div class="sl-subject-block">
                    <div class="sl-subject-block-header">
                        <span class="subj-name"><i class="fas fa-book"></i> ${escapeHtml(subj)}</span>
                        <span class="subj-avg" style="--grade-color:${clr}">${avg.toFixed(2)}</span>
                    </div>
                    <div class="sl-subject-block-body">${bodyHtml}</div>
                </div>
            `;
            })
            .join('');
    } catch (err) {
        console.error('Error loading student grades:', err);
        const subjectsContainer = document.getElementById('modal-grades-subjects');
        if (subjectsContainer) {
            subjectsContainer.innerHTML =
                '<div class="sl-grades-empty"><i class="fas fa-triangle-exclamation"></i><p>تعذر تحميل النقط</p></div>';
        }
    }
}

function closeStudentModal() {
    const modal = document.getElementById('student-modal');
    if (window.UXEnhancements?.closeDialog) {
        window.UXEnhancements.closeDialog(modal);
    } else {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
    }
}

// ─── Print Preview (gs-sheet style with letterhead) ───
async function openSlPrintPreview() {
    if (!filteredStudents.length) {
        showToast('لا توجد بيانات للطباعة', 'warning');
        return;
    }

    const classFilter = document.getElementById('search-class').value || 'كل الأقسام';
    const year = getCurrentYear();
    const dateStr = new Intl.DateTimeFormat('ar-MA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());

    // Fetch identity for letterhead
    let identity = {};
    try {
        identity = (await window.api.reports.getIdentity()) || {};
    } catch (_) {
        /* skip */
    }

    const letterhead =
        typeof window.buildLetterheadHTML === 'function' ? window.buildLetterheadHTML(identity, year) : '';

    // Build table rows for ALL filtered students
    const rows = filteredStudents
        .map(
            (s, i) => `
        <tr>
            <td class="sl-print-row-index">${i + 1}</td>
            <td>${escapeHtml(s.massar_code || '-')}</td>
            <td class="sl-print-row-name">${escapeHtml(s.full_name || '-')}</td>
            <td class="sl-print-center">${escapeHtml(s.class_name || '-')}</td>
            <td class="sl-print-center">${isMale(s.gender) ? 'ذكر' : isFemale(s.gender) ? 'أنثى' : '-'}</td>
            <td class="sl-print-center">${escapeHtml(s.birth_date || '-')}</td>
        </tr>
    `
        )
        .join('');

    // Build the print-ready A4 sheet
    let printDiv = document.getElementById('sl-print-content');
    if (!printDiv) {
        printDiv = document.createElement('div');
        printDiv.id = 'sl-print-content';
        printDiv.style.display = 'none';
        document.body.appendChild(printDiv);
    }

    printDiv.innerHTML = `
        <div class="gs-sheet-wrapper">
            <div class="gs-sheet" id="sl-sheet-content">
                ${letterhead}
                <div class="gs-sheet-title">لائحة التلاميذ</div>
                <div class="gs-sheet-subtitle">${escapeHtml(classFilter)}</div>
                <div class="gs-sheet-meta">
                    <span><i class="fas fa-calendar-alt"></i> السنة الدراسية: ${year}</span>
                    <span><i class="fas fa-users"></i> العدد: ${filteredStudents.length}</span>
                    <span><i class="fas fa-clock"></i> التاريخ: ${dateStr}</span>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th class="sl-print-col-index">#</th>
                            <th>رمز مسار</th>
                            <th>الاسم الكامل</th>
                            <th class="sl-print-center">القسم</th>
                            <th class="sl-print-col-gender">الجنس</th>
                            <th class="sl-print-center">تاريخ الازدياد</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
                <div class="gs-footer">
                    <span>تاريخ الطباعة: ${dateStr}</span>
                    <span>برنامج التدبير المدرسي — ${year}</span>
                </div>
            </div>
        </div>
    `;
    printDiv.style.display = 'block';

    PrintSystem.preview({
        contentSelector: '#sl-sheet-content',
        title: 'لائحة التلاميذ',
        pageSize: 'A4',
        noHeader: true,
        defaultFileName: `لائحة_التلاميذ_${year.replace('/', '-')}`
    });

    // Hide after PrintSystem.preview clones it
    setTimeout(() => {
        printDiv.style.display = 'none';
    }, 500);
}
