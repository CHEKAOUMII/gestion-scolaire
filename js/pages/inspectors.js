/* js/pages/inspectors.js — Inspectors CRUD page */

const getActiveSchoolYear = () => (typeof getSchoolYear === 'function' ? getSchoolYear() : '2025/2026');

let inspectors = [];
let filtered = [];
let currentPage = 1;
const PAGE_SIZE = 20;

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

function getAvatarColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return avatarColors[Math.abs(hash) % avatarColors.length];
}

function getInitials(inspector) {
    const l = (inspector.last_name || '').charAt(0);
    const f = (inspector.first_name || '').charAt(0);
    return l + f;
}

// ── Load data ──

async function loadSubjects() {
    const select = document.getElementById('inspector-specialty');
    if (!select) return;
    try {
        const rawSubjects = (await window.api.subjects.getAll()) || [];
        const invalid = new Set(['sheet', 'sheet1', 'feuil1', 'notes', 'notescc', 'note', 'ورقة1', 'ورقة']);
        const subjects = [
            ...new Set(
                rawSubjects
                    .map((s) => (typeof s === 'string' ? s : (s?.name || '')).trim())
                    .filter((s) => s && !invalid.has(s.toLowerCase()))
            )
        ].sort(typeof compareSubjects === 'function' ? compareSubjects : (a, b) => String(a).localeCompare(String(b), 'ar'));

        const current = select.value;
        select.innerHTML = '<option value="">-- اختر التخصص --</option>';
        for (const s of subjects) {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            select.appendChild(opt);
        }
        if (current) select.value = current;
    } catch (_) {
        // Leave select as-is if API unavailable
    }
}

async function loadInspectors() {
    const year = getActiveSchoolYear();
    try {
        const [result, stats] = await Promise.all([
            window.api.inspectors.getAll(year),
            window.api.inspectors.getStats(year)
        ]);
        inspectors = Array.isArray(result) ? result : [];
        updateStats(stats);
        populateSpecialtyFilter();
        applyFilters();
    } catch (err) {
        showToast('خطأ في تحميل بيانات المفتشين', 'error');
    }
}

function updateStats(stats) {
    document.getElementById('stat-total').textContent = stats?.total ?? '-';
    document.getElementById('stat-active').textContent = stats?.active ?? '-';
    document.getElementById('stat-specialties').textContent = stats?.specialties ?? '-';
    document.getElementById('stat-visits').textContent = stats?.visitsThisMonth ?? '-';
}

function populateSpecialtyFilter() {
    const select = document.getElementById('filter-specialty');
    if (!select) return;
    const specs = [...new Set(inspectors.map((r) => r.specialty).filter(Boolean))].sort(
        typeof compareSubjects === 'function' ? compareSubjects : (a, b) => String(a).localeCompare(String(b), 'ar')
    );
    const current = select.value;
    select.innerHTML = '<option value="">كل التخصصات</option>';
    for (const s of specs) {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        select.appendChild(opt);
    }
    select.value = current;
}

// ── Filters ──

function applyFilters() {
    const q = (document.getElementById('search-input')?.value || '').toLowerCase();
    const st = document.getElementById('filter-status')?.value || '';
    const sp = document.getElementById('filter-specialty')?.value || '';

    filtered = inspectors.filter((r) => {
        const name = (r.last_name + ' ' + r.first_name).toLowerCase();
        return (
            (!q || name.includes(q) || (r.specialty || '').toLowerCase().includes(q) || (r.email || '').toLowerCase().includes(q)) &&
            (!st || r.status === st) &&
            (!sp || r.specialty === sp)
        );
    });
    currentPage = 1;
    renderInspectors();
}

// ── Render table ──

function renderInspectors() {
    const tbody = document.getElementById('inspectors-tbody');
    if (!tbody) return;

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    currentPage = Math.min(currentPage, totalPages);
    const start = (currentPage - 1) * PAGE_SIZE;
    const slice = filtered.slice(start, start + PAGE_SIZE);

    document.getElementById('inspectors-counter').textContent = total;

    if (!slice.length) {
        tbody.innerHTML = '';
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 7;
        td.innerHTML = '<div class="empty-state"><i class="fas fa-search"></i><p>لا توجد بيانات بخصوص معايير البحث المحددة</p></div>';
        tr.appendChild(td);
        tbody.replaceChildren(tr);
        renderInspectorsPagination(0, 1);
        return;
    }

    const rows = slice.map((r, i) => createInspectorRow(r, start + i + 1));
    tbody.replaceChildren(...rows);
    renderInspectorsPagination(total, totalPages);
}

function createInspectorRow(inspector, rowNum) {
    const tr = document.createElement('tr');
    tr.className = 'inspector-row';
    tr.dataset.inspectorId = String(inspector.id);

    // # column
    const tdNum = document.createElement('td');
    tdNum.textContent = rowNum;
    tdNum.className = 'text-muted';
    tr.appendChild(tdNum);

    // Name + avatar column
    const tdName = document.createElement('td');
    const nameWrap = document.createElement('div');
    nameWrap.style.cssText = 'display:flex;align-items:center;gap:9px;';

    const fullName = inspector.last_name + ' ' + inspector.first_name;
    const color = getAvatarColor(fullName);

    const avatar = document.createElement('div');
    avatar.className = 'sl-avatar';
    avatar.style.background = color;
    avatar.textContent = getInitials(inspector);

    const nameBlock = document.createElement('div');
    const nameMain = document.createElement('div');
    nameMain.style.cssText = 'font-weight:500;';
    nameMain.textContent = fullName;
    nameBlock.appendChild(nameMain);

    if (inspector.notes) {
        const noteSub = document.createElement('div');
        noteSub.style.cssText = 'font-size:11px;color:var(--color-text-muted);';
        noteSub.textContent = inspector.notes;
        nameBlock.appendChild(noteSub);
    }

    nameWrap.appendChild(avatar);
    nameWrap.appendChild(nameBlock);
    tdName.appendChild(nameWrap);
    tr.appendChild(tdName);

    // Specialty badge
    const tdSpec = document.createElement('td');
    const specBadge = document.createElement('span');
    specBadge.className = 'badge badge-cadre';
    const sc = getAvatarColor(inspector.specialty || '');
    specBadge.style.cssText = `background:color-mix(in srgb, ${sc} 15%, transparent);color:${sc};`;
    specBadge.textContent = inspector.specialty || '-';
    tdSpec.appendChild(specBadge);
    tr.appendChild(tdSpec);

    // Phone
    const tdPhone = document.createElement('td');
    tdPhone.textContent = inspector.phone || '-';
    tdPhone.style.direction = 'ltr';
    tdPhone.style.textAlign = 'right';
    tr.appendChild(tdPhone);

    // Email
    const tdEmail = document.createElement('td');
    tdEmail.textContent = inspector.email || '-';
    tdEmail.style.direction = 'ltr';
    tdEmail.style.textAlign = 'right';
    tdEmail.style.fontSize = '12px';
    tr.appendChild(tdEmail);

    // Status badge
    const tdStatus = document.createElement('td');
    const statusBadge = document.createElement('span');
    const isActive = inspector.status === 'نشط';
    statusBadge.className = `badge ${isActive ? 'badge-source-agent' : 'badge-source-manual'}`;
    statusBadge.style.cssText = isActive
        ? 'background:var(--color-success-bg);color:var(--color-success-text);'
        : 'background:var(--color-danger-bg);color:var(--color-danger-text);';
    statusBadge.textContent = inspector.status || 'نشط';
    tdStatus.appendChild(statusBadge);
    tr.appendChild(tdStatus);

    // Actions
    const tdActions = document.createElement('td');
    tdActions.className = 'col-actions';
    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'actions-row';

    const editBtn = createActionButton({ title: 'تعديل', icon: 'fa-edit', action: 'edit', id: inspector.id });
    const deleteBtn = createActionButton({
        title: 'حذف',
        icon: 'fa-trash',
        action: 'delete',
        id: inspector.id,
        extraClass: 'teachers-danger-btn'
    });
    actionsWrap.appendChild(editBtn);
    actionsWrap.appendChild(deleteBtn);
    tdActions.appendChild(actionsWrap);
    tr.appendChild(tdActions);

    return tr;
}

function createActionButton({ title, icon, action, id, extraClass }) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `teachers-action-btn${extraClass ? ' ' + extraClass : ''}`;
    btn.title = title;
    btn.dataset.action = action;
    btn.dataset.inspectorId = id;
    const i = document.createElement('i');
    i.className = `fas ${icon}`;
    btn.appendChild(i);
    return btn;
}

// ── Pagination ──

function renderInspectorsPagination(total, totalPages) {
    const el = document.getElementById('inspectors-pagination');
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
        onNavigate: inspectorsGotoPage,
        infoText: `${from}–${to} من ${total}`,
        summaryText: `صفحة ${currentPage} / ${totalPages}`
    });
}

function inspectorsGotoPage(page) {
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    currentPage = Math.max(1, Math.min(page, totalPages));
    renderInspectors();
    document.querySelector('.gs-preview-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Form: Add / Edit ──

function resetForm() {
    document.getElementById('inspector-id').value = '';
    document.getElementById('inspector-lname').value = '';
    document.getElementById('inspector-fname').value = '';
    document.getElementById('inspector-specialty').value = '';
    document.getElementById('inspector-phone').value = '';
    document.getElementById('inspector-email').value = '';
    document.getElementById('inspector-visit').value = '';
    document.getElementById('inspector-status').value = 'نشط';
    document.getElementById('inspector-notes').value = '';
    document.getElementById('form-title').textContent = 'إضافة مفتش';
    document.getElementById('cancel-edit').hidden = true;
}

function editInspector(id) {
    const r = inspectors.find((x) => x.id === id);
    if (!r) return;
    document.getElementById('inspector-id').value = r.id;
    document.getElementById('inspector-lname').value = r.last_name || '';
    document.getElementById('inspector-fname').value = r.first_name || '';
    document.getElementById('inspector-specialty').value = r.specialty || '';
    document.getElementById('inspector-phone').value = r.phone || '';
    document.getElementById('inspector-email').value = r.email || '';
    document.getElementById('inspector-visit').value = r.last_visit_date || '';
    document.getElementById('inspector-status').value = r.status || 'نشط';
    document.getElementById('inspector-notes').value = r.notes || '';
    document.getElementById('form-title').textContent = 'تعديل: ' + r.last_name + ' ' + r.first_name;
    document.getElementById('cancel-edit').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function handleFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('inspector-id').value;
    const payload = {
        last_name: document.getElementById('inspector-lname').value.trim(),
        first_name: document.getElementById('inspector-fname').value.trim(),
        specialty: document.getElementById('inspector-specialty').value,
        phone: document.getElementById('inspector-phone').value.trim(),
        email: document.getElementById('inspector-email').value.trim(),
        last_visit_date: document.getElementById('inspector-visit').value,
        status: document.getElementById('inspector-status').value,
        notes: document.getElementById('inspector-notes').value.trim(),
        school_year: getActiveSchoolYear()
    };

    if (!payload.last_name || !payload.first_name || !payload.specialty) {
        showToast('يرجى ملء الحقول الإلزامية', 'error');
        return;
    }

    const handle = showToast.loading(id ? 'جاري التحديث...' : 'جاري الحفظ...');
    try {
        const res = id
            ? await window.api.inspectors.update(Number(id), payload)
            : await window.api.inspectors.add(payload);

        if (res?.success === false) {
            handle.error(res.error || 'حدث خطأ');
            return;
        }
        handle.success(id ? 'تم التعديل بنجاح' : 'تم إضافة المفتش بنجاح');
        resetForm();
        await loadInspectors();
    } catch (err) {
        handle.error('حدث خطأ أثناء الحفظ');
    }
}

async function deleteInspector(id) {
    const r = inspectors.find((x) => x.id === id);
    const { confirmed } = await showConfirm({
        title: 'حذف المفتش',
        message: `هل تريد حذف المفتش "${r ? r.last_name + ' ' + r.first_name : ''}"؟`,
        type: 'danger',
        confirmText: 'حذف'
    });
    if (!confirmed) return;

    const handle = showToast.loading('جاري الحذف...');
    try {
        const res = await window.api.inspectors.delete(id);
        if (res?.success === false) {
            handle.error(res.error || 'فشل الحذف');
            return;
        }
        handle.success('تم حذف المفتش');
        // If we were editing this inspector, reset the form
        if (document.getElementById('inspector-id').value === String(id)) {
            resetForm();
        }
        await loadInspectors();
    } catch (err) {
        handle.error('حدث خطأ أثناء الحذف');
    }
}

// ── Event wiring ──

document.addEventListener('DOMContentLoaded', () => {
    // Form submit
    document.getElementById('inspector-form')?.addEventListener('submit', handleFormSubmit);

    // Cancel edit
    document.getElementById('cancel-edit')?.addEventListener('click', resetForm);

    // Search + filters
    document.getElementById('search-input')?.addEventListener('input', applyFilters);
    document.getElementById('filter-status')?.addEventListener('change', applyFilters);
    document.getElementById('filter-specialty')?.addEventListener('change', applyFilters);

    // Delegated click on table body for edit/delete buttons
    document.getElementById('inspectors-tbody')?.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-action][data-inspector-id]');
        if (!btn) return;
        event.stopPropagation();
        const inspectorId = Number(btn.dataset.inspectorId);
        if (btn.dataset.action === 'edit') editInspector(inspectorId);
        else if (btn.dataset.action === 'delete') deleteInspector(inspectorId);
    });

    // School year change
    document.addEventListener('schoolYearChanged', () => {
        resetForm();
        loadSubjects();
        loadInspectors();
    });

    loadSubjects();
    loadInspectors();
});
