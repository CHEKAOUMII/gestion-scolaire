const getActiveSchoolYear = () => (typeof getSchoolYear === 'function' ? getSchoolYear() : '2025/2026');
let teachers = [];
let assignments = [];
let assignmentReviewQueue = [];
let canManageAssignments = false;
let usableCycles = [];
let filtered = [];
const PAGE_SIZE = 20;
let currentPage = 1;

document.addEventListener('DOMContentLoaded', async () => {
    await loadUsableCycles();
    await loadTeachers();
    setupForm();
    setupFilters();
    setupDetailPanel();
    setupAssignmentReviewInteractions();
    setupTableInteractions();
    setupPrint();
});

function setupPrint() {
    // Relocate the primary print control into the sticky unified header (after setupUnifiedHeader).
    (window.StickyTopbarPrint || window.OrientationTopbarPrint)?.mount?.(document, { buttonId: 'btn-print' });
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

        // Group teachers by specialty subject (مادة التخصص) for the printed list
        const printSubjectOf = (t) => t._subjectLabel || 'غير محدد';
        const groups = new Map();
        list.forEach((t) => {
            const key = printSubjectOf(t);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(t);
        });
        const sortedKeys = [...groups.keys()].sort(
            typeof compareSubjects === 'function' ? compareSubjects : undefined
        );
        const surplusCount = list.filter(isSurplusTeacher).length;

        let rows = '';
        let counter = 0;
        sortedKeys.forEach((key) => {
            const members = groups.get(key);
            members.forEach((t, idx) => {
                counter += 1;
                const surplus = isSurplusTeacher(t);
                const rowClass = surplus ? ' class="teachers-print-surplus-row"' : '';
                const surplusTag = surplus ? ' <span class="teachers-print-surplus-tag">فائض</span>' : '';
                const subjectCell =
                    idx === 0
                        ? `<td class="teachers-print-subject" rowspan="${members.length}">${escapeHtml(key)}</td>`
                        : '';
                rows += `<tr${rowClass}>
                                        <td class="teachers-print-index">${counter}</td>
                                        <td class="teachers-print-ppr">${escapeHtml(t.ppr || '')}</td>
                                        <td class="teachers-print-name">${escapeHtml(t.full_name || '')}${surplusTag}</td>
                                        ${subjectCell}
                                        <td class="teachers-print-signature"></td>
                                    </tr>`;
            });
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
                                                ${surplusCount ? `<span class="teachers-print-surplus-legend"><i class="fas fa-triangle-exclamation"></i> الفائضون: ${surplusCount}</span>` : ''}
                                                <span><i class="fas fa-clock"></i> التاريخ: ${dateStr}</span>
                                            </div>
                                            <table>
                                                <thead>
                                                    <tr>
                                                        <th class="teachers-print-col-index">رت</th>
                                                        <th class="teachers-print-col-ppr">رقم التأجير</th>
                                                        <th>الاسم والنسب بالعربية</th>
                                                        <th class="teachers-print-col-subject">مادة التدريس</th>
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
        try {
            await Promise.resolve(
                PrintSystem.preview({
                    contentSelector: '#tl-sheet-content',
                    title: 'لائحة الإدارة التربوية',
                    pageSize: 'A4',
                    noHeader: true
                })
            );
        } finally {
            printDiv.style.display = 'none';
        }
    });
}

async function loadUsableCycles() {
    if (!window.api?.cycles?.list) return;
    try {
        const response = await window.api.cycles.list();
        usableCycles = response?.success && Array.isArray(response.cycles)
            ? response.cycles.filter((cycle) => Number(cycle.is_active) && cycle.capability === 'supported')
            : [];
    } catch (err) {
        console.warn('teachers-list: usable cycles unavailable:', err);
    }
}

function otherUsableCycles(cycleCode) {
    return usableCycles.filter((cycle) => cycle.cycle_code !== cycleCode);
}

async function loadTeachers() {
    const year = getActiveSchoolYear();
    const role = typeof getCurrentAppRole === 'function' ? getCurrentAppRole() : '';
    canManageAssignments = ['admin', 'principal', 'developer'].includes(String(role || '').toLowerCase());
    const includeReview = canManageAssignments;
    const scopedReader = window.api.teachers.getScoped;
    const result = scopedReader ? await scopedReader(year, { includeReview }) : await window.api.teachers.getAll(year);
    teachers = Array.isArray(result) ? result : [];
    assignments = [];
    if (window.api.teachers.getAssignments) {
        const assignmentResult = await window.api.teachers.getAssignments(year, { includeReview });
        assignments = Array.isArray(assignmentResult) ? assignmentResult : [];
    }
    assignmentReviewQueue = canManageAssignments && window.api.teachers.getReviewQueue
        ? ((await window.api.teachers.getReviewQueue(year)) || [])
        : [];
    // Precompute the translated specialty label once per teacher to avoid
    // recomputing it on every filter keystroke / render.
    teachers.forEach((t) => {
        const raw = t.specialty_subject || t.subject || '';
        t._subjectLabel = raw ? (typeof translateSubject === 'function' ? translateSubject(raw) : raw) : '';
    });
    populateDropdowns();
    applyFilters();
    updateStats();
    renderAssignmentReviewQueue();
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

function isMale(t) {
    const g = String(t.gender || '');
    return g.includes('1') || g.includes('ذكر');
}

function isFemale(t) {
    const g = String(t.gender || '');
    return g.includes('2') || g.includes('أنثى');
}

function updateStats() {
    const el = (id, v) => {
        const e = document.getElementById(id);
        if (e) e.textContent = v;
    };

    let agent = 0;
    let male = 0;
    let female = 0;
    let surplus = 0;
    for (const t of teachers) {
        if (t.source === 'agent_xml') agent += 1;
        if (isMale(t)) male += 1;
        if (isFemale(t)) female += 1;
        if (isSurplusTeacher(t)) surplus += 1;
    }

    el('stat-total', teachers.length);
    el('stat-agent', agent);
    el('stat-male', male);
    el('stat-female', female);
    el('stat-surplus', surplus);
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
        if (t._subjectLabel) subjectSet.add(t._subjectLabel);
    });
    const subjects = [...subjectSet].sort(compareSubjects);
    setSelectOptions(selectSubject, subjects, { placeholder: 'كل التخصصات' });
}

// CH5: debounce via window.debounce (js/utils.js); call sites pass explicit delay.

function setupFilters() {
    document.getElementById('search-input').addEventListener('input', debounce(applyFilters, 150));
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
            // Match against the precomputed translated specialty label
            if (t._subjectLabel !== subject) return false;
        }
        if (genderVal) {
            if (genderVal === 'ذكور' && !isMale(t)) return false;
            if (genderVal === 'إناث' && !isFemale(t)) return false;
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
    button.setAttribute('aria-label', title);
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
    if (isSurplusTeacher(teacher)) tr.classList.add('teacher-row-surplus');
    tr.title = 'انقر لعرض التفاصيل';
    tr.dataset.teacherId = String(teacher.id);

    const specDisplay = teacher._subjectLabel || '-';
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
    if (teacher.is_institution_wide || teacher.scope_type === 'institution_wide') {
        const scopeBadge = document.createElement('span');
        scopeBadge.className = 'badge badge-cadre';
        scopeBadge.textContent = 'مشترك على مستوى المؤسسة';
        nameCell.appendChild(document.createTextNode(' '));
        nameCell.appendChild(scopeBadge);
    }

    if (isFemale(teacher)) {
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
        emptyCell.colSpan = document.querySelectorAll('#staff-table thead th').length || 10;
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
function createReviewButton(label, action, index, extra = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn ${action === 'reject' ? 'btn-secondary' : 'btn-success'}`;
    button.textContent = label;
    button.dataset.reviewAction = action;
    button.dataset.reviewIndex = String(index);
    if (extra.targetCycle) button.dataset.targetCycle = extra.targetCycle;
    return button;
}

function renderAssignmentReviewQueue() {
    const section = document.getElementById('assignment-review-section');
    const list = document.getElementById('assignment-review-list');
    const counter = document.getElementById('assignment-review-counter');
    if (!section || !list || !canManageAssignments) {
        if (section) section.hidden = true;
        return;
    }
    section.hidden = assignmentReviewQueue.length === 0;
    if (counter) counter.textContent = String(assignmentReviewQueue.length);
    if (!assignmentReviewQueue.length) {
        list.replaceChildren();
        return;
    }

    list.replaceChildren(
        ...assignmentReviewQueue.map((item, index) => {
            const card = document.createElement('article');
            card.className = 'detail-field full-width';
            card.dataset.reviewIndex = String(index);

            const heading = document.createElement('strong');
            heading.textContent = item.queue_type === 'assignment'
                ? `${item.teacher_name || 'أستاذ غير محدد'} — ${item.cycle_code || ''}`
                : `مطابقة غير محسومة: ${item.teacher_name || 'اسم غير محدد'} — ${item.cycle_code || ''}`;
            card.appendChild(heading);

            const description = document.createElement('p');
            description.className = 'field-value';
            const parts = [item.level_code, item.section, item.subject_label || item.subject_code].filter(Boolean);
            description.textContent = parts.join(' — ') || 'تفاصيل التعيين غير مكتملة';
            card.appendChild(description);

            const metadata = document.createElement('small');
            metadata.className = 'text-[var(--text-muted)]';
            const source = item.source_file_name ? `المصدر: ${item.source_file_name}` : `المصدر: ${item.source || 'غير محدد'}`;
            const decision = item.decided_at
                ? `القرار: ${item.decision_source || 'غير محدد'} — ${item.decided_at}`
                : `الحالة: ${item.resolution === 'ambiguous' ? 'مطابقة غامضة' : 'تحتاج اختياراً'}`;
            metadata.textContent = `${source} | ${decision}${item.grade_count ? ` | عدد سجلات النقط: ${item.grade_count}` : ''}`;
            card.appendChild(metadata);

            const actions = document.createElement('div');
            actions.className = 'actions-row';
            if (item.queue_type === 'assignment') {
                actions.appendChild(createReviewButton('اعتماد', 'confirm', index));
                actions.appendChild(createReviewButton('رفض', 'reject', index));
                otherUsableCycles(item.cycle_code).forEach((cycle) => {
                    actions.appendChild(
                        createReviewButton(`نقل إلى ${cycle.label_ar}`, 'confirm', index, {
                            targetCycle: cycle.cycle_code
                        })
                    );
                });
            } else {
                const select = document.createElement('select');
                select.className = 'gs-field-control assignment-review-teacher-select';
                select.dataset.reviewIndex = String(index);
                const placeholder = document.createElement('option');
                placeholder.value = '';
                placeholder.textContent = 'اختر الأستاذ الصحيح قبل الحفظ';
                select.appendChild(placeholder);
                (item.candidates || []).forEach((candidate) => {
                    const option = document.createElement('option');
                    option.value = String(candidate.id);
                    option.textContent = `${candidate.full_name || ''}${candidate.ppr ? ` — ${candidate.ppr}` : ''}`;
                    select.appendChild(option);
                });
                actions.appendChild(select);
                actions.appendChild(createReviewButton('حسم المطابقة وإنشاء المرشح', 'resolve', index));
            }
            card.appendChild(actions);
            return card;
        })
    );
}

function setupAssignmentReviewInteractions() {
    const list = document.getElementById('assignment-review-list');
    list?.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-review-action][data-review-index]');
        if (!button) return;
        const index = Number(button.dataset.reviewIndex);
        const item = assignmentReviewQueue[index];
        if (!item) return;
        try {
            let result;
            if (button.dataset.reviewAction === 'resolve') {
                const select = list.querySelector(`.assignment-review-teacher-select[data-review-index="${index}"]`);
                const teacherId = Number(select?.value);
                if (!teacherId) {
                    showToast('اختر الأستاذ الصحيح أولاً', 'warning');
                    return;
                }
                result = await window.api.teachers.resolveAssignmentReview({
                    teacher_id: teacherId,
                    teacher_name: item.teacher_name,
                    school_year: item.school_year,
                    cycle_code: item.cycle_code,
                    level_code: item.level_code,
                    section: item.section,
                    subject_code: item.subject_code
                });
            } else {
                result = await window.api.teachers.reviewAssignment({
                    assignment_id: item.assignment_id,
                    confidence: button.dataset.reviewAction === 'reject' ? 'rejected' : 'confirmed',
                    target_cycle_code: button.dataset.targetCycle || item.cycle_code
                });
            }
            if (!result || result.success === false) throw new Error(result?.error || 'تعذر حفظ قرار المراجعة');
            showToast('تم حفظ قرار المراجعة وتسجيل مصدره', 'success');
            await loadTeachers();
        } catch (error) {
            showToast(error?.message || 'تعذر حفظ قرار المراجعة', 'error');
        }
    });
}

function setupDetailPanel() {
    document.getElementById('close-detail').addEventListener('click', closeDetail);
    document.getElementById('detail-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeDetail();
    });
    document.getElementById('detail-body')?.addEventListener('click', async (event) => {
        const scopeButton = event.target.closest('[data-scope-action][data-teacher-id]');
        if (scopeButton && window.api.teachers.setScope) {
            const result = await window.api.teachers.setScope({
                teacher_id: Number(scopeButton.dataset.teacherId),
                scope_type: scopeButton.dataset.scopeAction
            });
            if (!result || result.success === false) {
                showToast(result?.error || 'تعذر تحديث نطاق الموظف', 'error');
                return;
            }
            showToast('تم تحديث نطاق الموظف', 'success');
            await loadTeachers();
            showDetail(Number(scopeButton.dataset.teacherId));
            return;
        }
        const button = event.target.closest('[data-assignment-action][data-assignment-id]');
        if (!button || !window.api.teachers.reviewAssignment) return;
        const confidence = button.dataset.assignmentAction;
        const assignmentId = Number(button.dataset.assignmentId);
        const payload = { assignment_id: assignmentId, confidence };
        if (button.dataset.targetCycle) payload.target_cycle_code = button.dataset.targetCycle;
        const result = await window.api.teachers.reviewAssignment(payload);
        if (!result || result.success === false) {
            showToast(result?.error || 'تعذر تحديث التعيين', 'error');
            return;
        }
        showToast(confidence === 'confirmed' ? 'تم اعتماد التعيين' : 'تم رفض التعيين', 'success');
        await loadTeachers();
        showDetail(Number(document.getElementById('detail-panel')?.dataset?.teacherId || 0));
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
    document.getElementById('detail-panel').dataset.teacherId = String(t.id);

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
    const role = typeof getCurrentAppRole === 'function' ? getCurrentAppRole() : '';
    const canReviewAssignments = ['admin', 'principal', 'developer'].includes(String(role || '').toLowerCase());
    const teacherAssignments = assignments.filter((assignment) => Number(assignment.teacher_id) === Number(t.id));
    const assignmentSection = teacherAssignments.length
        ? `<div class="detail-section">
                <h4><i class="fas fa-chalkboard-teacher"></i> التعيينات حسب السلك</h4>
                <div class="detail-grid">
                    ${teacherAssignments.map((assignment) => `
                        <div class="detail-field full-width">
                            <span class="field-label">${escapeHtml(assignment.cycle_code)} — ${escapeHtml(assignment.level_code || assignment.section || 'مستوى غير محدد')}</span>
                            <span class="field-value">
                                ${escapeHtml(assignment.subject_label || assignment.subject_code || 'مادة غير محددة')}
                                ${assignment.section ? ` — ${escapeHtml(assignment.section)}` : ''}
                                <strong> (${assignment.confidence === 'confirmed' ? 'معتمد' : assignment.confidence === 'rejected' ? 'مرفوض' : 'قيد المراجعة'})</strong>
                                <small> — المصدر: ${escapeHtml(assignment.decision_source || assignment.source || 'غير محدد')}${assignment.decided_at ? `، بتاريخ ${escapeHtml(assignment.decided_at)}` : ''}${assignment.source_file_name ? `، الملف ${escapeHtml(assignment.source_file_name)}` : ''}</small>
                                ${canReviewAssignments && assignment.confidence === 'review_required' ? `
                                    <button type="button" class="btn btn-success" data-assignment-action="confirmed" data-assignment-id="${assignment.id}">اعتماد</button>
                                    <button type="button" class="btn btn-secondary" data-assignment-action="rejected" data-assignment-id="${assignment.id}">رفض</button>
                                    ${otherUsableCycles(assignment.cycle_code).map((cycle) => `
                                    <button type="button" class="btn btn-secondary" data-assignment-action="confirmed" data-assignment-id="${assignment.id}" data-target-cycle="${escapeHtml(cycle.cycle_code)}">نقل إلى ${escapeHtml(cycle.label_ar)}</button>`).join('')}` : ''}
                            </span>
                        </div>`).join('')}
                </div>
            </div>`
        : '';
    const scopeSection = canReviewAssignments
        ? `<div class="detail-section">
                <h4><i class="fas fa-building"></i> نطاق الظهور التشغيلي</h4>
                <div class="detail-grid">
                    <div class="detail-field full-width">
                        <span class="field-label">الوضع الحالي</span>
                        <span class="field-value">${t.scope_type === 'institution_wide' ? 'مشترك على مستوى المؤسسة' : 'يحتاج تعيين تدريس مؤكد لكل سلك'}</span>
                        <div class="actions-row">
                            <button type="button" class="btn btn-secondary" data-scope-action="institution_wide" data-teacher-id="${t.id}">تصنيف مشترك مؤسسياً</button>
                            <button type="button" class="btn btn-secondary" data-scope-action="teaching_assignment" data-teacher-id="${t.id}">إرجاع إلى نطاق التعيينات</button>
                        </div>
                    </div>
                </div>
            </div>`
        : '';
    body.innerHTML = `
                            ${assignmentSection}
                            ${scopeSection}
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
                                    ${f('الجنس', isMale(t) ? 'ذكر' : isFemale(t) ? 'أنثى' : t.gender)}
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
