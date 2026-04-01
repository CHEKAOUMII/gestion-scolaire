const getActiveSchoolYear = () => (typeof getSchoolYear === 'function' ? getSchoolYear() : '2025/2026');
let teachers = [];
let filtered = [];
const PAGE_SIZE = 20;
let currentPage = 1;

document.addEventListener('DOMContentLoaded', async () => {
    await loadTeachers();
    setupForm();
    setupFilters();
    setupDetailPanel();
    setupTableInteractions();
    document.getElementById('btn-print')?.addEventListener('click', async () => {
        const list = filtered && filtered.length ? filtered : teachers;
        if (!list.length) {
            showToast('لا توجد بيانات للطباعة', 'warning');
            return;
        }

        const dateStr = new Intl.DateTimeFormat('ar-MA', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(new Date());
        const year = getActiveSchoolYear();
        let identity = {};
        try {
            identity = (await window.api.reports.getIdentity()) || {};
        } catch (_) {}
        const letterhead =
            typeof window.buildLetterheadHTML === 'function' ? window.buildLetterheadHTML(identity, year) : '';

        let rows = '';
        list.forEach((t, i) => {
            rows += `<tr>
                                        <td class="teachers-print-index">${i + 1}</td>
                                        <td class="teachers-print-ppr">${escapeHtml(t.ppr || '')}</td>
                                        <td class="teachers-print-name">${escapeHtml(t.full_name || '')}</td>
                                        <td class="teachers-print-phone">${escapeHtml(t.phone || '-')}</td>
                                        <td class="teachers-print-signature"></td>
                                    </tr>`;
        });

        let printDiv = document.getElementById('teachers-print-content');
        if (!printDiv) {
            printDiv = document.createElement('div');
            printDiv.id = 'teachers-print-content';
            printDiv.style.display = 'none';
            document.body.appendChild(printDiv);
        }
        printDiv.innerHTML = `
                                    <div class="gs-sheet-wrapper">
                                        <div class="gs-sheet" id="tl-sheet-content">
                                            ${letterhead}
                                            <div class="gs-sheet-title">لائحة الإدارة التربوية</div>
                                            <div class="gs-sheet-meta">
                                                <span><i class="fas fa-calendar-alt"></i> السنة الدراسية: ${year}</span>
                                                <span><i class="fas fa-users"></i> العدد: ${list.length}</span>
                                                <span><i class="fas fa-clock"></i> التاريخ: ${dateStr}</span>
                                            </div>
                                            <table>
                                                <thead>
                                                    <tr>
                                                        <th class="teachers-print-col-index">#</th>
                                                        <th class="teachers-print-col-ppr">ر.ت</th>
                                                        <th>الاسم الكامل</th>
                                                        <th class="teachers-print-col-phone">رقم الهاتف</th>
                                                        <th class="teachers-print-col-signature">التوقيع</th>
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
        openPrintPreview({
            contentSelector: '#tl-sheet-content',
            title: 'لائحة الإدارة التربوية',
            pageSize: 'A4',
            noHeader: true
        });
        setTimeout(() => {
            printDiv.style.display = 'none';
        }, 500);
    });
});

async function loadTeachers() {
    const year = getActiveSchoolYear();
    const result = await window.api.teachers.getAll(year);
    teachers = Array.isArray(result) ? result : [];
    populateDropdowns();
    applyFilters();
    updateStats();
}

function isSurplusTeacher(t) {
    if (Number(t.is_surplus) === 1) return true;
    const pos = (t.position || '').toLowerCase();
    const stat = (t.statut || '').toLowerCase();
    const func = (t.function_title || '').toLowerCase();
    const combined = `${pos} ${stat} ${func}`;
    return (
        combined.includes('surnombre') ||
        combined.includes('excédentaire') ||
        combined.includes('excedentaire') ||
        combined.includes('فائض')
    );
}

function updateStats() {
    const el = (id, v) => {
        const e = document.getElementById(id);
        if (e) e.textContent = v;
    };
    el('stat-total', teachers.length);
    el('stat-agent', teachers.filter((t) => t.source === 'agent_xml').length);
    el('stat-male', teachers.filter((t) => (t.gender || '').includes('1') || (t.gender || '').includes('ذكر')).length);
    el(
        'stat-female',
        teachers.filter((t) => (t.gender || '').includes('2') || (t.gender || '').includes('أنثى')).length
    );
    const surplusCount = teachers.filter(isSurplusTeacher).length;
    el('stat-surplus', surplusCount);
}

function populateDropdowns() {
    const selectCadre = document.getElementById('filter-cadre');
    const cadres = [...new Set(teachers.map((t) => t.cadre).filter(Boolean))].sort();
    setSelectOptions(selectCadre, cadres, {
        placeholder: 'كل الأطر',
        getLabel: (value) => (typeof translateCadre === 'function' ? translateCadre(value) : value)
    });

    const selectSubject = document.getElementById('filter-subject');
    const subjectSet = new Set();
    teachers.forEach((t) => {
        const raw = t.specialty_subject || t.subject;
        if (!raw) return;
        const label = typeof translateSubject === 'function' ? translateSubject(raw) : raw;
        if (label) subjectSet.add(label);
    });
    const subjects = [...subjectSet].sort(compareSubjects);
    setSelectOptions(selectSubject, subjects, { placeholder: 'كل التخصصات' });
}

function setupFilters() {
    document.getElementById('search-input').addEventListener('input', applyFilters);
    document.getElementById('filter-cadre').addEventListener('change', applyFilters);
    document.getElementById('filter-source').addEventListener('change', applyFilters);
    document.getElementById('filter-gender').addEventListener('change', applyFilters);
    document.getElementById('filter-subject').addEventListener('change', applyFilters);
    document.getElementById('filter-fonction').addEventListener('change', applyFilters);
    document.getElementById('stat-surplus-card')?.addEventListener('click', () => {
        filtered = teachers.filter(isSurplusTeacher);
        currentPage = 1;
        setSurplusFilterPressed(true);
        renderTeachers();
        updateCounter(`${filtered.length} / ${teachers.length} أستاذ (فائضون)`);
    });
}

/**
 * Check whether a teacher is in a "teaching" role based on function_title.
 * Teaching roles: مدرس / Enseignant (E001) and مدرس فائض / Enseignant en surnombre (E002).
 */
function isTeachingRole(t) {
    const fn = (t.function_title || '').toLowerCase();
    return fn.includes('مدرس') || fn.includes('enseignant') || fn.includes('surnombre') || fn.includes('فائض');
}

function applyFilters() {
    const q = (document.getElementById('search-input')?.value || '').trim().toLowerCase();
    const cadre = document.getElementById('filter-cadre')?.value || '';
    const source = document.getElementById('filter-source')?.value || '';
    const genderVal = document.getElementById('filter-gender')?.value || '';
    const subject = document.getElementById('filter-subject')?.value || '';
    const fonction = document.getElementById('filter-fonction')?.value || '';

    filtered = teachers.filter((t) => {
        if (q) {
            const haystack = [t.full_name, t.full_name_fr, t.ppr, t.subject, t.specialty_subject, t.phone, t.cin]
                .join(' ')
                .toLowerCase();
            if (!haystack.includes(q)) return false;
        }
        if (cadre && t.cadre !== cadre) return false;
        if (source && t.source !== source) return false;
        if (subject) {
            // Match against translated specialty_subject OR subject
            const raw = t.specialty_subject || t.subject;
            const label = typeof translateSubject === 'function' ? translateSubject(raw) : raw;
            if (label !== subject) return false;
        }
        if (genderVal) {
            const isMale = (t.gender || '').includes('ذكر') || (t.gender || '').includes('1');
            const isFemale = (t.gender || '').includes('أنثى') || (t.gender || '').includes('2');
            if (genderVal === 'ذكور' && !isMale) return false;
            if (genderVal === 'إناث' && !isFemale) return false;
        }
        if (fonction) {
            const teaching = isTeachingRole(t);
            if (fonction === 'تدريس' && !teaching) return false;
            if (fonction === 'غير تدريس' && teaching) return false;
        }
        return true;
    });

    currentPage = 1;
    setSurplusFilterPressed(false);
    renderTeachers();
    updateCounter(`${filtered.length} / ${teachers.length} أستاذ`);
}

function setSurplusFilterPressed(isPressed) {
    const surplusButton = document.getElementById('stat-surplus-card');
    if (surplusButton) surplusButton.setAttribute('aria-pressed', String(isPressed));
}

function updateCounter(text) {
    const counter = document.getElementById('staff-counter');
    if (counter) counter.textContent = text;
}

function createSourceBadge(src) {
    const badge = document.createElement('span');
    badge.className = 'badge badge-source';

    if (src === 'agent_xml') {
        badge.classList.add('badge-source-agent');
        badge.textContent = 'الوزارة';
        return badge;
    }

    if (src === 'fet') {
        badge.classList.add('badge-source-fet');
        badge.textContent = 'FET';
        return badge;
    }

    badge.classList.add('badge-source-manual');
    badge.textContent = 'يدوي';
    return badge;
}

function createTeacherActionButton({ title, icon, action, id, extraClass = '' }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn btn-secondary ${extraClass}`.trim();
    button.title = title;
    button.dataset.action = action;
    button.dataset.teacherId = String(id);

    const iconEl = document.createElement('i');
    iconEl.className = `fas ${icon}`;
    iconEl.setAttribute('aria-hidden', 'true');
    button.appendChild(iconEl);

    return button;
}

function createTeacherRow(teacher, rowNumber) {
    const tr = document.createElement('tr');
    tr.className = 'teacher-row';
    tr.title = 'انقر لعرض التفاصيل';
    tr.dataset.teacherId = String(teacher.id);

    const specRaw = teacher.specialty_subject || teacher.subject;
    const specDisplay = specRaw ? (typeof translateSubject === 'function' ? translateSubject(specRaw) : specRaw) : '-';
    const cadreDisplay = teacher.cadre
        ? typeof translateCadre === 'function'
            ? translateCadre(teacher.cadre)
            : teacher.cadre
        : '-';
    const gradeDisplay = teacher.grade
        ? typeof translateGrade === 'function'
            ? translateGrade(teacher.grade)
            : teacher.grade
        : '-';

    const addTextCell = (text, className = '') => {
        const td = document.createElement('td');
        if (className) td.className = className;
        td.textContent = text;
        tr.appendChild(td);
        return td;
    };

    addTextCell(String(rowNumber));
    addTextCell(teacher.ppr || '-', 'col-ppr');

    const nameCell = document.createElement('td');
    const nameStrong = document.createElement('strong');
    nameStrong.textContent = teacher.full_name || '';
    nameCell.appendChild(nameStrong);

    if (teacher.gender && (teacher.gender.includes('2') || teacher.gender.includes('أنثى'))) {
        const iconEl = document.createElement('i');
        iconEl.className = 'fas fa-venus teacher-gender-icon teacher-gender-icon-female';
        iconEl.setAttribute('aria-hidden', 'true');
        nameCell.appendChild(document.createTextNode(' '));
        nameCell.appendChild(iconEl);
    } else if (teacher.gender) {
        const iconEl = document.createElement('i');
        iconEl.className = 'fas fa-mars teacher-gender-icon teacher-gender-icon-male';
        iconEl.setAttribute('aria-hidden', 'true');
        nameCell.appendChild(document.createTextNode(' '));
        nameCell.appendChild(iconEl);
    }
    tr.appendChild(nameCell);

    addTextCell(specDisplay);

    const cadreCell = document.createElement('td');
    if (teacher.cadre) {
        const badge = document.createElement('span');
        badge.className = 'badge badge-cadre';
        badge.textContent = cadreDisplay;
        cadreCell.appendChild(badge);
    } else {
        cadreCell.textContent = '-';
    }
    tr.appendChild(cadreCell);

    const gradeCell = document.createElement('td');
    if (teacher.grade) {
        const badge = document.createElement('span');
        badge.className = 'badge badge-grade';
        badge.textContent = gradeDisplay;
        gradeCell.appendChild(badge);
    } else {
        gradeCell.textContent = '-';
    }
    tr.appendChild(gradeCell);

    addTextCell(teacher.echelon || '-');
    addTextCell(teacher.phone || '-', 'teachers-phone-cell');

    const sourceCell = document.createElement('td');
    sourceCell.appendChild(createSourceBadge(teacher.source));
    tr.appendChild(sourceCell);

    const actionsCell = document.createElement('td');
    actionsCell.className = 'col-actions';
    const actionsRow = document.createElement('div');
    actionsRow.className = 'actions-row';
    actionsRow.appendChild(
        createTeacherActionButton({ title: 'تعديل', icon: 'fa-edit', action: 'edit', id: teacher.id })
    );
    actionsRow.appendChild(
        createTeacherActionButton({
            title: 'حذف',
            icon: 'fa-trash',
            action: 'delete',
            id: teacher.id,
            extraClass: 'teachers-danger-btn'
        })
    );
    actionsCell.appendChild(actionsRow);
    tr.appendChild(actionsCell);

    return tr;
}

function setupTableInteractions() {
    const tbody = document.getElementById('teachers-tbody');
    tbody?.addEventListener('click', (event) => {
        const actionButton = event.target.closest('[data-action][data-teacher-id]');
        if (actionButton) {
            event.stopPropagation();
            const teacherId = Number(actionButton.dataset.teacherId);
            if (actionButton.dataset.action === 'edit') {
                editTeacher(teacherId);
            } else if (actionButton.dataset.action === 'delete') {
                deleteTeacher(teacherId);
            }
            return;
        }

        const row = event.target.closest('tr[data-teacher-id]');
        if (row) {
            showDetail(Number(row.dataset.teacherId));
        }
    });
}

function renderTeachers() {
    const tbody = document.getElementById('teachers-tbody');
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    currentPage = Math.min(currentPage, totalPages);

    if (!filtered.length) {
        const emptyRow = document.createElement('tr');
        const emptyCell = document.createElement('td');
        emptyCell.colSpan = 10;
        emptyCell.innerHTML = `
                                    <div class="empty-state">
                                        <i class="fas fa-users"></i>
                                        <p>لا توجد بيانات بخصوص معايير البحث المحددة</p>
                                    </div>`;
        emptyRow.appendChild(emptyCell);
        tbody.replaceChildren(emptyRow);
        renderTeachersPagination(0, 1);
        return;
    }

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PAGE_SIZE);

    tbody.replaceChildren(...pageItems.map((teacher, index) => createTeacherRow(teacher, start + index + 1)));

    renderTeachersPagination(filtered.length, totalPages);
}

function renderTeachersPagination(total, totalPages) {
    const el = document.getElementById('teachers-pagination');
    if (!el) return;
    if (total === 0 || totalPages <= 1) {
        el.replaceChildren();
        return;
    }
    const from = (currentPage - 1) * PAGE_SIZE + 1;
    const to = Math.min(currentPage * PAGE_SIZE, total);
    renderPaginationControls(el, {
        currentPage,
        totalPages,
        onNavigate: teachersGotoPage,
        infoText: `${from}–${to} من ${total}`,
        summaryText: `صفحة ${currentPage} / ${totalPages}`
    });
}

function teachersGotoPage(page) {
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    currentPage = Math.max(1, Math.min(page, totalPages));
    renderTeachers();
    document.querySelector('.gs-preview-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ─── Detail Panel ─── */
function setupDetailPanel() {
    document.getElementById('close-detail').addEventListener('click', closeDetail);
    document.getElementById('detail-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeDetail();
    });
}

function closeDetail() {
    const overlay = document.getElementById('detail-overlay');
    if (window.UXEnhancements?.closeDialog) {
        window.UXEnhancements.closeDialog(overlay);
        return;
    }
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
}

function showDetail(id) {
    const t = teachers.find((x) => x.id === id);
    if (!t) return;

    document.getElementById('detail-name').textContent = t.full_name || '-';
    document.getElementById('detail-name-fr').textContent = t.full_name_fr || '';

    const f = (label, value) =>
        value
            ? `
                                                    <div class="detail-field">
                                                        <span class="field-label">${label}</span>
                                                        <span class="field-value">${escapeHtml(value)}</span>
                                                    </div>`
            : '';

    const fFull = (label, value) =>
        value
            ? `
                                                    <div class="detail-field full-width">
                                                        <span class="field-label">${label}</span>
                                                        <span class="field-value">${escapeHtml(value)}</span>
                                                    </div>`
            : '';

    const body = document.getElementById('detail-body');
    body.innerHTML = `
                            <div class="detail-section">
                                <h4><i class="fas fa-id-badge"></i> المعلومات الإدارية</h4>
                                <div class="detail-grid">
                                    ${f('رقم التأجير (PPR)', t.ppr)}
                                    ${f('رقم ب.و.ت (CIN)', t.cin)}
                                    ${f('الإطار', t.cadre ? (typeof translateCadre === 'function' ? translateCadre(t.cadre) : t.cadre) : '')}
                                    ${f('الدرجة', t.grade ? (typeof translateGrade === 'function' ? translateGrade(t.grade) : t.grade) : '')}
                                    ${f('الرتبة', t.echelon)}
                                    ${f('الوظيفة', t.function_title)}
                                    ${f('تاريخ التوظيف', t.hire_date)}
                                    ${f('المصدر', t.source === 'agent_xml' ? 'ملف الوزارة' : t.source === 'fet' ? 'FET' : 'يدوي')}
                                </div>
                            </div>

                            <div class="detail-section">
                                <h4><i class="fas fa-book"></i> المعلومات المهنية</h4>
                                <div class="detail-grid">
                                    ${f('مادة التخصص الرسمية', t.specialty_subject)}
                                    ${t.subject && t.subject !== t.specialty_subject ? f('المادة المُدرَّسة', t.subject) : ''}
                                </div>
                            </div>

                            <div class="detail-section">
                                <h4><i class="fas fa-user"></i> المعلومات الشخصية</h4>
                                <div class="detail-grid">
                                    ${f('الجنس', t.gender === '1' ? 'ذكر' : t.gender === '2' ? 'أنثى' : t.gender)}
                                    ${f('تاريخ الازدياد', t.birth_date)}
                                    ${f('مكان الازدياد', t.birth_place)}
                                    ${f('الحالة العائلية', t.marital_status)}
                                </div>
                            </div>

                            <div class="detail-section">
                                <h4><i class="fas fa-phone-alt"></i> معلومات الاتصال</h4>
                                <div class="detail-grid">
                                    ${f('الهاتف', t.phone)}
                                    ${f('البريد الإلكتروني', t.email)}
                                    ${fFull('العنوان', t.address)}
                                </div>
                            </div>
                        `;

    const overlay = document.getElementById('detail-overlay');
    if (window.UXEnhancements?.openDialog) {
        window.UXEnhancements.openDialog(overlay, {
            contentSelector: '#detail-panel',
            initialFocus: '#close-detail'
        });
        return;
    }
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
}

/* ─── Form CRUD ─── */
function setupForm() {
    document.getElementById('teacher-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('teacher-id').value;
        const year = getActiveSchoolYear();
        const payload = {
            full_name: document.getElementById('teacher-name').value.trim(),
            subject: document.getElementById('teacher-subject').value.trim(),
            phone: document.getElementById('teacher-phone').value.trim(),
            email: document.getElementById('teacher-email').value.trim(),
            school_year: year,
            active: 1
        };
        const res = id ? await window.api.teachers.update(Number(id), payload) : await window.api.teachers.add(payload);
        if (!res || res.success === false) {
            showToast('خطأ: ' + (res?.error || 'فشل الحفظ'), 'error');
            return;
        }
        showToast(id ? 'تم التعديل' : 'تم الإضافة', 'success');
        clearForm();
        await loadTeachers();
    });
    document.getElementById('cancel-edit').addEventListener('click', clearForm);
}

function editTeacher(id) {
    const t = teachers.find((x) => x.id === id);
    if (!t) return;
    document.getElementById('teacher-id').value = t.id;
    document.getElementById('teacher-name').value = t.full_name || '';
    document.getElementById('teacher-subject').value = t.subject || '';
    document.getElementById('teacher-phone').value = t.phone || '';
    document.getElementById('teacher-email').value = t.email || '';
    document.getElementById('form-title').textContent = 'تعديل: ' + (t.full_name || '');
    document.getElementById('cancel-edit').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteTeacher(id) {
    const { confirmed } = await showConfirm({
        title: 'حذف الأستاذ',
        message: 'هل تريد حذف هذا الأستاذ؟',
        type: 'danger',
        confirmText: 'حذف'
    });
    if (!confirmed) return;
    const res = await window.api.teachers.delete(id);
    if (!res || res.success === false) {
        showToast('فشل الحذف', 'error');
        return;
    }
    showToast('تم الحذف', 'success');
    closeDetail();
    await loadTeachers();
}

function clearForm() {
    document.getElementById('teacher-form').reset();
    document.getElementById('teacher-id').value = '';
    document.getElementById('form-title').textContent = 'إضافة أستاذ';
    document.getElementById('cancel-edit').hidden = true;
}
