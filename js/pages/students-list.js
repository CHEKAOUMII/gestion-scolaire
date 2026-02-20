const year = '2025/2026';
let students = [];
let filteredStudents = [];
let currentPage = 1;
const PAGE_SIZE = 25;
let sortColumn = null;
let sortDirection = 'asc';

// Avatar color palette
const avatarColors = [
    '#2D5F4A', '#3C95D0', '#E67F22', '#9B59B6', '#E74C3C',
    '#1ABC9C', '#2980B9', '#D35400', '#8E44AD', '#27AE60',
    '#F39C12', '#C0392B', '#16A085', '#2C3E50', '#7F8C8D'
];

// Gender normalization helpers (DB may store 'M'/'F', 'ذكر'/'أنثى', etc.)
function isMale(gender) {
    const g = String(gender || '').trim().toLowerCase();
    return g === 'm' || g === 'male' || g === 'ذكر';
}
function isFemale(gender) {
    const g = String(gender || '').trim().toLowerCase();
    return g === 'f' || g === 'female' || g === 'أنثى';
}

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

function escapeAttribute(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ─── DOM Ready ───
document.addEventListener('DOMContentLoaded', async () => {
    await loadClasses();
    restoreFilters();
    await searchStudents();

    // Form submit
    document.getElementById('search-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        currentPage = 1;
        await searchStudents();
    });

    // Live search with debounce
    const nameInput = document.getElementById('search-name');
    const codeInput = document.getElementById('search-code');
    const debouncedSearch = debounce(async () => {
        currentPage = 1;
        await searchStudents();
    }, 300);
    nameInput.addEventListener('input', debouncedSearch);
    codeInput.addEventListener('input', debouncedSearch);

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
    document.getElementById('print-export-pdf').addEventListener('click', exportPdf);

    // Sorting
    document.querySelectorAll('.sl-table th[data-sort]').forEach(th => {
        th.addEventListener('click', () => handleSort(th.dataset.sort));
    });

    // Student modal
    document.getElementById('modal-close').addEventListener('click', closeStudentModal);
    document.getElementById('modal-close-btn').addEventListener('click', closeStudentModal);
    document.getElementById('student-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeStudentModal();
    });

    // Print preview
    document.getElementById('print-preview-btn').addEventListener('click', openPrintPreview);
    document.getElementById('print-preview-close').addEventListener('click', closePrintPreview);
    document.getElementById('print-cancel').addEventListener('click', closePrintPreview);
    document.getElementById('print-confirm').addEventListener('click', executePrint);
    document.getElementById('print-preview-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closePrintPreview();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            nameInput.focus();
            nameInput.select();
        }
        if (e.key === 'Escape') {
            closeStudentModal();
            closePrintPreview();
        }
    });
});

// ─── Load Classes ───
async function loadClasses() {
    const select = document.getElementById('search-class');
    try {
        const classes = (await window.api.classes.getAll(year)) || [];
        classes.forEach((c) => {
            const opt = document.createElement('option');
            opt.value = c.name;
            opt.textContent = c.name;
            select.appendChild(opt);
        });
    } catch (_error) {
        showToast('تعذر تحميل قائمة الأقسام', 'warning');
    }
}

// ─── Save / Restore Filters ───
function saveFilters() {
    const filters = {
        name: document.getElementById('search-name').value,
        class: document.getElementById('search-class').value,
        gender: document.getElementById('search-gender').value,
        code: document.getElementById('search-code').value
    };
    saveToStorage('sl_filters', filters);
}

function restoreFilters() {
    const filters = loadFromStorage('sl_filters');
    if (!filters) return;
    if (filters.name) document.getElementById('search-name').value = filters.name;
    if (filters.class) document.getElementById('search-class').value = filters.class;
    if (filters.gender) document.getElementById('search-gender').value = filters.gender;
    if (filters.code) document.getElementById('search-code').value = filters.code;
}

// ─── Search ───
async function searchStudents() {
    const name = document.getElementById('search-name').value.trim();
    const className = document.getElementById('search-class').value;
    const code = document.getElementById('search-code').value.trim();
    const gender = document.getElementById('search-gender').value;

    saveFilters();
    renderTableState('loading');

    try {
        students = (await window.api.students.search(name, className, code, year)) || [];

        // Client-side gender filter
        if (gender) {
            filteredStudents = students.filter(s => {
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
    if (sortColumn === column) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        sortColumn = column;
        sortDirection = 'asc';
    }

    // Update sort icons
    document.querySelectorAll('.sl-table th[data-sort]').forEach(th => {
        const icon = th.querySelector('.sort-icon');
        th.classList.remove('sorted');
        icon.className = 'fas fa-sort sort-icon';
    });

    const activeTh = document.querySelector(`.sl-table th[data-sort="${column}"]`);
    if (activeTh) {
        activeTh.classList.add('sorted');
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
    tbody.innerHTML = pageStudents.map((s, i) => {
        const idx = start + i + 1;
        const name = s.full_name || '-';
        const initial = getInitial(name);
        const color = getAvatarColor(name);
        const genderClass = isMale(s.gender) ? 'male' : isFemale(s.gender) ? 'female' : '';
        const genderLabel = isMale(s.gender) ? 'ذكر' : isFemale(s.gender) ? 'أنثى' : '-';
        const genderIcon = isMale(s.gender) ? 'fa-mars' : isFemale(s.gender) ? 'fa-venus' : '';

        return `
            <tr>
                <td>${idx}</td>
                <td><code style="font-size:13px;color:var(--color-text-muted)">${escapeHtml(s.massar_code || '-')}</code></td>
                <td>
                    <div class="sl-student-cell">
                        <div class="sl-avatar" style="background:${color}">${initial}</div>
                        <span class="sl-student-name">${escapeHtml(name)}</span>
                    </div>
                </td>
                <td><span class="sl-class-badge">${escapeHtml(s.class_name || '-')}</span></td>
                <td>${genderClass ? `<span class="sl-gender-badge ${genderClass}"><i class="fas ${genderIcon}"></i> ${genderLabel}</span>` : '-'}</td>
                <td>${escapeHtml(s.birth_date || '-')}</td>
                <td>
                    <button class="sl-action-btn" type="button" title="عرض ملف التلميذ" aria-label="عرض ملف التلميذ"
                        onclick="viewStudent(${start + i})">
                        <i class="fas fa-eye" aria-hidden="true"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

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
        return;
    }

    container.style.display = 'flex';
    let html = '';

    // Previous
    html += `<button ${currentPage === 1 ? 'disabled' : ''} onclick="goToPage(${currentPage - 1})"><i class="fas fa-chevron-right"></i></button>`;

    // Page numbers
    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }

    if (startPage > 1) {
        html += `<button onclick="goToPage(1)">1</button>`;
        if (startPage > 2) html += `<span class="sl-pagination-info">...</span>`;
    }

    for (let p = startPage; p <= endPage; p++) {
        html += `<button class="${p === currentPage ? 'active' : ''}" onclick="goToPage(${p})">${p}</button>`;
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) html += `<span class="sl-pagination-info">...</span>`;
        html += `<button onclick="goToPage(${totalPages})">${totalPages}</button>`;
    }

    // Next
    html += `<button ${currentPage === totalPages ? 'disabled' : ''} onclick="goToPage(${currentPage + 1})"><i class="fas fa-chevron-left"></i></button>`;

    // Info
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, filteredStudents.length);
    html += `<span class="sl-pagination-info">${start}-${end} من ${filteredStudents.length}</span>`;

    container.innerHTML = html;
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
    if (val >= 16) return '#2ECC71';
    if (val >= 14) return '#3b82f6';
    if (val >= 12) return '#f59e0b';
    if (val >= 10) return '#f97316';
    return '#E85D5D';
}

function normalizeSubjectName(subject) {
    return String(subject || '')
        .replace(/\s*\(\s*فرض\s*\d+\s*\)\s*$/i, '')
        .replace(/\s*\(الأنشطة المندمجة\)\s*$/, '')
        .trim();
}

// ─── View Student Modal ───
async function viewStudent(index) {
    const student = filteredStudents[index];
    if (!student) return;

    const name = student.full_name || '-';
    const initial = getInitial(name);
    const color = getAvatarColor(name);
    const genderLabel = isMale(student.gender) ? 'ذكر' : isFemale(student.gender) ? 'أنثى' : '-';

    const body = document.getElementById('modal-body');
    body.innerHTML = `
        <div class="sl-modal-avatar" style="background:${color}">${initial}</div>
        <div class="sl-modal-info-grid">
            <div class="sl-modal-info-item full-width">
                <div class="sl-modal-info-label"><i class="fas fa-user"></i> الاسم الكامل</div>
                <div class="sl-modal-info-value">${escapeHtml(name)}</div>
            </div>
            <div class="sl-modal-info-item">
                <div class="sl-modal-info-label"><i class="fas fa-barcode"></i> رمز مسار</div>
                <div class="sl-modal-info-value" style="direction:ltr;text-align:right">${escapeHtml(student.massar_code || '-')}</div>
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
        </div>

        <!-- Grades Section -->
        <h4 class="sl-grades-section-title"><i class="fas fa-book-open"></i> تفاصيل النقط حسب المادة</h4>
        <div id="modal-grades-kpis"></div>
        <div id="modal-grades-subjects">
            <div class="sl-grades-loading"><i class="fas fa-spinner fa-spin"></i> جاري تحميل النقط...</div>
        </div>
    `;

    const modal = document.getElementById('student-modal');
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');

    // Fetch and render grades
    try {
        const allGrades = (await window.api.grades.getAll(year)) || [];

        // Match by massar_code or full_name
        const studentId = student.massar_code || student.full_name || '';
        const rawStudentGrades = allGrades
            .filter(g => {
                const id = String(g.student_code || g.student_id || g.full_name || '');
                return id === studentId;
            })
            .map(g => ({ ...g, grade: Number(g.grade) }))
            .filter(g => Number.isFinite(g.grade));

        // Deduplicate: keep only the latest entry per original subject + semester
        const dedup = {};
        rawStudentGrades.forEach(g => {
            const key = `${String(g.subject || '').trim()}||${g.semester || ''}`;
            dedup[key] = g;
        });
        const studentGrades = Object.values(dedup);

        const kpisContainer = document.getElementById('modal-grades-kpis');
        const subjectsContainer = document.getElementById('modal-grades-subjects');

        if (!studentGrades.length) {
            kpisContainer.innerHTML = '';
            subjectsContainer.innerHTML = '<div class="sl-grades-empty"><i class="fas fa-inbox"></i><p>لا توجد نقط مسجلة لهذا التلميذ</p></div>';
            return;
        }

        // Group by subject
        const bySubject = {};
        studentGrades.forEach(g => {
            const subj = normalizeSubjectName(g.subject) || 'غير محدد';
            if (!bySubject[subj]) bySubject[subj] = [];
            bySubject[subj].push(g);
        });

        // Calculate KPIs
        const subjects = Object.keys(bySubject);
        const subjectAvgs = subjects.map(s => {
            const vals = bySubject[s].map(g => g.grade);
            return vals.reduce((a, b) => a + b, 0) / vals.length;
        });
        const generalAvg = subjectAvgs.length ? subjectAvgs.reduce((a, b) => a + b, 0) / subjectAvgs.length : 0;
        const totalGrades = studentGrades.length;
        const maxGrade = Math.max(...studentGrades.map(g => g.grade));
        const minGrade = Math.min(...studentGrades.map(g => g.grade));

        // Render KPIs
        kpisContainer.innerHTML = `
            <div class="sl-detail-kpis">
                <div class="sl-detail-kpi">
                    <div class="kpi-val" style="color:${gradeColor(generalAvg)}">${generalAvg.toFixed(2)}</div>
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
                    <div class="kpi-val" style="color:#2ECC71">${maxGrade.toFixed(1)}</div>
                    <div class="kpi-lbl">أعلى نقطة</div>
                </div>
                <div class="sl-detail-kpi">
                    <div class="kpi-val" style="color:#E85D5D">${minGrade.toFixed(1)}</div>
                    <div class="kpi-lbl">أدنى نقطة</div>
                </div>
            </div>
        `;

        // Render subject blocks
        const sortedSubjects = subjects.sort((a, b) => a.localeCompare(b, 'ar'));
        subjectsContainer.innerHTML = sortedSubjects.map(subj => {
            const grades = bySubject[subj];
            const vals = grades.map(g => g.grade);
            const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
            const clr = gradeColor(avg);

            const chipsHtml = grades.map((g, idx) => {
                const gc = gradeColor(g.grade);
                const pct = Math.min((g.grade / 20) * 100, 100);
                const semLabel = g.semester ? `الدورة ${g.semester}` : '';
                return `
                    <div class="sl-grade-chip">
                        <span class="chip-label">فرض ${idx + 1}${semLabel ? ' — ' + semLabel : ''}</span>
                        <span class="chip-value" style="color:${gc}">${g.grade.toFixed(2)}</span>
                        <div class="chip-bar"><div class="chip-bar-fill" style="width:${pct}%;background:${gc}"></div></div>
                    </div>
                `;
            }).join('');

            return `
                <div class="sl-subject-block">
                    <div class="sl-subject-block-header">
                        <span class="subj-name"><i class="fas fa-book"></i> ${escapeHtml(subj)}</span>
                        <span class="subj-avg" style="background:${clr}">${avg.toFixed(2)}</span>
                    </div>
                    <div class="sl-subject-block-body">
                        <div class="sl-grades-chips">${chipsHtml}</div>
                    </div>
                </div>
            `;
        }).join('');

    } catch (err) {
        console.error('Error loading student grades:', err);
        const subjectsContainer = document.getElementById('modal-grades-subjects');
        if (subjectsContainer) {
            subjectsContainer.innerHTML = '<div class="sl-grades-empty"><i class="fas fa-triangle-exclamation"></i><p>تعذر تحميل النقط</p></div>';
        }
    }
}

function closeStudentModal() {
    const modal = document.getElementById('student-modal');
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
}

// ─── Forced Print Mode Helpers ───
function enableForcedPrintMode() {
    if (typeof _forceLightThemeForPrint === 'function') _forceLightThemeForPrint();
    const printRoot = document.getElementById('sl-print-root');
    document.body.classList.add('sl-printing-active');
    printRoot?.setAttribute('aria-hidden', 'false');
}

function disableForcedPrintMode() {
    const printRoot = document.getElementById('sl-print-root');
    document.body.classList.remove('sl-printing-active');
    printRoot?.setAttribute('aria-hidden', 'true');
    printRoot.innerHTML = '';
    if (typeof _restoreThemeAfterPrint === 'function') _restoreThemeAfterPrint();
}

// ─── Build print content into the persistent #sl-print-root ───
function preparePrintContent() {
    const printPage = document.getElementById('print-page');
    const printRoot = document.getElementById('sl-print-root');
    printRoot.innerHTML = printPage.innerHTML;
}

// ─── Export PDF ───
async function exportPdf() {
    if (!filteredStudents.length) {
        showToast('لا توجد بيانات للتصدير', 'warning');
        return;
    }

    closePrintPreview();
    await new Promise(r => setTimeout(r, 100));

    // Ensure print preview content is generated
    if (!document.getElementById('print-page').innerHTML.trim()) {
        openPrintPreview();
        closePrintPreview();
        await new Promise(r => setTimeout(r, 100));
    }

    preparePrintContent();
    enableForcedPrintMode();

    // Allow enough time for layout to settle
    await new Promise(r => setTimeout(r, 300));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    try {
        if (window.api?.system?.printToPDF) {
            const result = await window.api.system.printToPDF({
                printBackground: true,
                pageSize: 'A4',
                landscape: false,
                margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
            });
            if (result?.success) {
                showToast('تم تصدير اللائحة بنجاح', 'success');
            } else if (result?.error !== 'Cancelled by user') {
                showToast('تعذر تصدير اللائحة: ' + (result?.error || ''), 'error');
            }
        } else {
            showToast('تصدير PDF غير متاح في هذا السياق', 'warning');
        }
    } catch (err) {
        console.warn('PDF export error:', err);
        showToast('تعذر تصدير اللائحة: ' + err.message, 'error');
    } finally {
        disableForcedPrintMode();
    }
}

// ─── Print Preview ───
function openPrintPreview() {
    if (!filteredStudents.length) {
        showToast('لا توجد بيانات للطباعة', 'warning');
        return;
    }

    const printPage = document.getElementById('print-page');
    const classFilter = document.getElementById('search-class').value || 'كل الأقسام';
    const now = new Date();
    const dateStr = new Intl.DateTimeFormat('ar-MA', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
    }).format(now);

    let tableRows = filteredStudents.map((s, i) => `
        <tr>
            <td style="text-align:center">${i + 1}</td>
            <td>${escapeHtml(s.massar_code || '-')}</td>
            <td>${escapeHtml(s.full_name || '-')}</td>
            <td>${escapeHtml(s.class_name || '-')}</td>
            <td>${isMale(s.gender) ? 'ذكر' : isFemale(s.gender) ? 'أنثى' : '-'}</td>
            <td>${escapeHtml(s.birth_date || '-')}</td>
        </tr>
    `).join('');

    printPage.innerHTML = `
        <div class="sl-print-sheet">
            <div class="sl-print-sheet-title">لائحة التلاميذ</div>
            <div class="sl-print-sheet-subtitle">${escapeHtml(classFilter)} — السنة الدراسية ${year} — العدد: ${filteredStudents.length}</div>
            <table>
                <thead>
                    <tr>
                        <th style="text-align:center">#</th>
                        <th>رمز مسار</th>
                        <th>الاسم الكامل</th>
                        <th>القسم</th>
                        <th>الجنس</th>
                        <th>تاريخ الازدياد</th>
                    </tr>
                </thead>
                <tbody>${tableRows}</tbody>
            </table>
            <div class="print-meta">
                <span>تاريخ الطباعة: ${dateStr}</span>
                <span>برنامج التدبير المدرسي — ${year}</span>
            </div>
        </div>
    `;

    const overlay = document.getElementById('print-preview-overlay');
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

function closePrintPreview() {
    const overlay = document.getElementById('print-preview-overlay');
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

async function executePrint() {
    closePrintPreview();
    await new Promise(r => setTimeout(r, 100));

    preparePrintContent();
    enableForcedPrintMode();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    try {
        if (window.api?.system?.printCurrentWindow) {
            const result = await window.api.system.printCurrentWindow({
                printBackground: true,
                pageSize: 'A4',
                landscape: false,
                margins: { marginType: 'default' }
            });
            if (result?.success) {
                showToast('تم إرسال اللائحة للطباعة', 'success');
            }
        } else {
            // Fallback for browser context
            const cleanup = () => disableForcedPrintMode();
            window.addEventListener('afterprint', cleanup, { once: true });
            window.print();
            setTimeout(disableForcedPrintMode, 1200);
            return;
        }
    } catch (err) {
        console.warn('Print error:', err);
    } finally {
        disableForcedPrintMode();
    }
}
