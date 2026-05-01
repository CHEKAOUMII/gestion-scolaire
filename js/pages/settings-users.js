let pageRows = [];
let pageVisibilityMap = {};
let pageVisibilityDraftMap = {};
let pageVisibilityDirty = new Set();
let pageVisibilitySaving = false;
let linkRequestRows = [];

const ROLE_OPTIONS = [
    { value: 'admin',                  label: 'مدير التطبيق' },
    { value: 'principal',              label: 'مدير المؤسسة' },
    { value: 'supervisor',             label: 'الناظر' },
    { value: 'external-guardian',      label: 'حارس الخارجية' },
    { value: 'internal-guardian',      label: 'حارس الداخلية' },
    { value: 'admin-assistant',        label: 'مساعد إداري' },
    { value: 'educational-specialist', label: 'مختص تربوي' },
    { value: 'social-specialist',      label: 'مختص اجتماعي' },
    { value: 'teacher',                label: 'أستاذ' },
    { value: 'viewer',                 label: 'مشاهد فقط' },
];

function buildRoleSelect(userId, currentRole) {
    const options = ROLE_OPTIONS.map(({ value, label }) =>
        `<option value="${value}" ${currentRole === value ? 'selected' : ''}>${label}</option>`
    ).join('');
    return `<select onchange="changeRole(${userId}, this.value)">${options}</select>`;
}

function renderTableMessage(message, colspan = 6) {
    return `<tr><td colspan="${colspan}" class="settings-table-message">${message}</td></tr>`;
}

function safeText(value) {
    if (typeof escapeHtml === 'function') {
        return escapeHtml(String(value || ''));
    }

    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function statusBadge(visible) {
    if (visible) {
        return '<span class="settings-visibility-badge settings-visibility-badge--visible"><i class="fas fa-eye"></i> مرئي</span>';
    }
    return '<span class="settings-visibility-badge settings-visibility-badge--hidden"><i class="fas fa-eye-slash"></i> مخفي</span>';
}

function completionBadge(completed) {
    if (completed) {
        return '<span class="settings-visibility-text settings-visibility-text--success">مكتمل</span>';
    }
    return '<span class="settings-visibility-text settings-visibility-text--warning">غير مكتمل</span>';
}

function pendingBadge(isDirty) {
    if (!isDirty) return '';
    return '<div class="settings-visibility-note">تعديلات معلقة</div>';
}

function userStateBadge(user) {
    if (user.disabled) {
        return '<span class="settings-user-state settings-user-state--disabled">معطل</span>';
    }
    return '<span class="settings-user-state settings-user-state--active">نشط</span>';
}

function firebaseStatusBadge(user) {
    const hasFirebaseUid = !!String(user.firebase_uid || '').trim();
    const source = String(user.auth_source || '').trim().toLowerCase();
    if (hasFirebaseUid || source === 'firebase') {
        return '<span class="settings-visibility-badge settings-visibility-badge--visible"><i class="fas fa-cloud"></i> Firebase</span>';
    }
    return '<span class="settings-visibility-badge settings-visibility-badge--hidden"><i class="fas fa-database"></i> محلي فقط</span>';
}

function passwordStatusBadge(user) {
    if (Number(user.must_change_password || 0) === 1) {
        return '<span class="settings-visibility-text settings-visibility-text--warning">تغيير كلمة المرور مطلوب</span>';
    }
    return '<span class="settings-visibility-text settings-visibility-text--success">كلمة المرور مفعلة</span>';
}

function inviteStatusText(user) {
    const status = String(user.invite_status || '').trim();
    if (!status || status === 'active') return '';
    return `<div class="settings-visibility-note">${safeText(status)}</div>`;
}

function showProvisioningWarning(response) {
    if (!response?.warning) return;
    const labels = {
        'missing-school-id': 'تم الحفظ محلياً فقط: لم يتم ضبط معرف المؤسسة في المزامنة',
        'firebase-admin-unavailable': 'تم الحفظ محلياً فقط: Firebase Admin غير مهيأ على هذا الجهاز',
        'ADMIN_REQUIRED': 'تم الحفظ محلياً فقط: حساب Firebase الحالي لا يملك صلاحية مدير',
        'MISSING_ID_TOKEN': 'تم الحفظ محلياً فقط: لم يتم تسجيل الدخول إلى Firebase',
        'FIREBASE_FUNCTIONS_NOT_CONFIGURED': 'تم الحفظ محلياً فقط: لم يتم ضبط رابط Cloud Functions',
        'missing-email': 'تم الحفظ محلياً فقط: البريد الإلكتروني غير متوفر',
        'missing-firebase-user': 'تم التحديث محلياً فقط: لا يوجد حساب Firebase مرتبط'
    };
    showToast(labels[response.warning] || `تم الحفظ محلياً فقط: ${response.warning}`, 'warning', 7000);
}

function formatLinkRequestDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return safeText(value);
    return date.toLocaleString('ar-MA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function buildLinkRequestRoleSelect(index) {
    const options = ROLE_OPTIONS.map(({ value, label }) =>
        `<option value="${value}" ${value === 'viewer' ? 'selected' : ''}>${label}</option>`
    ).join('');
    return `<select id="link-request-role-${index}">${options}</select>`;
}

function renderLinkRequests(requests) {
    const panel = document.getElementById('link-requests-panel');
    const tbody = document.getElementById('link-requests-tbody');
    const countLabel = document.getElementById('link-requests-count');
    if (!panel || !tbody || !countLabel) return;

    linkRequestRows = Array.isArray(requests) ? requests : [];
    panel.style.display = linkRequestRows.length > 0 ? '' : 'none';
    countLabel.textContent = linkRequestRows.length > 0 ? `طلبات معلقة: ${linkRequestRows.length}` : '';
    countLabel.dataset.state = linkRequestRows.length > 0 ? 'dirty' : 'clean';

    tbody.innerHTML = linkRequestRows.length
        ? linkRequestRows
              .map(
                  (request, index) => `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${safeText(request.name || '-')}</td>
                        <td>${safeText(request.email || '-')}</td>
                        <td>${safeText(request.schoolCode || '-')}</td>
                        <td>${safeText(request.deviceName || '-')}</td>
                        <td>${formatLinkRequestDate(request.createdAt)}</td>
                        <td>${buildLinkRequestRoleSelect(index)}</td>
                        <td>
                            <button class="btn btn-success" type="button" onclick="approveLinkRequest(${index})">قبول</button>
                            <button class="btn btn-secondary" type="button" onclick="rejectLinkRequest(${index})">رفض</button>
                        </td>
                    </tr>
                `
              )
              .join('')
        : renderTableMessage('لا توجد طلبات ربط معلقة', 8);
}

async function loadLinkRequests({ silent = false } = {}) {
    if (!window.api?.auth?.listLinkRequests) {
        renderLinkRequests([]);
        return;
    }

    const response = await window.api.auth.listLinkRequests();
    if (!response || response.success === false) {
        renderLinkRequests([]);
        const code = String(response?.code || '');
        if (!silent && code !== 'FIREBASE_FUNCTIONS_NOT_CONFIGURED') {
            showToast(response?.error || 'فشل تحميل طلبات الربط', 'error');
        }
        return;
    }

    renderLinkRequests(response.requests || []);
}

async function resolveLinkRequest(index, action) {
    const request = linkRequestRows[Number(index)];
    if (!request?.uid || !window.api?.auth?.resolveLinkRequest) {
        showToast('تعذر تحديد طلب الربط', 'error');
        return;
    }

    const roleSelect = document.getElementById(`link-request-role-${index}`);
    const role = roleSelect?.value || 'viewer';
    const response = await window.api.auth.resolveLinkRequest({
        targetUid: request.uid,
        action,
        role
    });

    if (!response || response.success === false) {
        showToast(response?.error || 'فشل معالجة طلب الربط', 'error');
        return;
    }

    showToast(action === 'approve' ? 'تم قبول طلب الربط' : 'تم رفض طلب الربط', 'success');
    await loadLinkRequests({ silent: true });
    await loadRows();
}

async function approveLinkRequest(index) {
    await resolveLinkRequest(index, 'approve');
}

async function rejectLinkRequest(index) {
    const { confirmed } = await showConfirm({
        title: 'رفض طلب الربط',
        message: 'هل تريد رفض طلب ربط هذا الحساب بالمؤسسة؟',
        type: 'warning',
        confirmText: 'رفض'
    });
    if (!confirmed) return;
    await resolveLinkRequest(index, 'reject');
}

function getGroupToggleId(group) {
    return `group-toggle-${group.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_')}`;
}

function updatePageVisibilitySaveUi() {
    const saveButton = document.getElementById('save-page-visibility');
    const pendingLabel = document.getElementById('page-visibility-pending');
    if (!saveButton || !pendingLabel) return;

    const pendingCount = pageVisibilityDirty.size;

    if (pageVisibilitySaving) {
        saveButton.disabled = true;
        saveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحفظ...';
        pendingLabel.textContent = 'جاري حفظ التعديلات...';
        pendingLabel.dataset.state = 'saving';
        return;
    }

    saveButton.innerHTML = '<i class="fas fa-save"></i> حفظ التعديلات';
    saveButton.disabled = pendingCount === 0;

    if (pendingCount > 0) {
        pendingLabel.textContent = `تعديلات غير محفوظة: ${pendingCount}`;
        pendingLabel.dataset.state = 'dirty';
        return;
    }

    pendingLabel.textContent = 'لا تعديلات معلقة';
    pendingLabel.dataset.state = 'clean';
}

function getGroupVisibilitySummary(group) {
    const groupPages = pageRows.filter((entry) => entry.group === group);
    const total = groupPages.length;
    const visible = groupPages.filter((entry) => pageVisibilityDraftMap[entry.page] !== false).length;
    return { total, visible, allVisible: visible === total, noneVisible: visible === 0 };
}

async function loadRows() {
    const response = await window.api.users.getAll();
    const tbody = document.getElementById('tbody');
    if (!tbody) return;

    if (!Array.isArray(response)) {
        showToast(response?.error || 'غير مصرح بالوصول لهذه الصفحة', 'error');
        tbody.innerHTML = renderTableMessage('غير مصرح', 7);
        return;
    }

    const rows = response || [];
    tbody.innerHTML = rows.length
        ? rows
              .map(
                  (user, index) => `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${safeText(user.name || '-')}</td>
                        <td>${safeText(user.email || '-')}</td>
                        <td>
                            ${buildRoleSelect(user.id, user.role)}
                        </td>
                        <td>${userStateBadge(user)}</td>
                        <td>${firebaseStatusBadge(user)}${passwordStatusBadge(user)}${inviteStatusText(user)}</td>
                        <td>
                            <button class="btn btn-secondary" onclick="toggleDisable(${user.id}, ${user.disabled ? 0 : 1})">${user.disabled ? 'تفعيل' : 'تعطيل'}</button>
                        </td>
                    </tr>
                `
              )
              .join('')
        : renderTableMessage('لا يوجد مستخدمون', 7);
}

async function addUser(event) {
    event.preventDefault();
    const payload = {
        name: document.getElementById('name').value.trim(),
        email: document.getElementById('email').value.trim(),
        password: document.getElementById('password').value,
        role: document.getElementById('role').value,
        disabled: false
    };

    const response = await window.api.users.add(payload);
    if (!response || response.success === false) {
        showToast(`فشل إضافة المستخدم: ${response?.error || ''}`, 'error');
        return;
    }

    if (response?.usedGeneratedPassword && response.temporaryPassword) {
        showToast(
            `تمت الإضافة. كلمة المرور المؤقتة: ${response.temporaryPassword} – يرجى تغييرها عند أول استخدام`,
            'warning',
            8000
        );
    } else {
        showToast('تمت الإضافة', 'success');
    }
    showProvisioningWarning(response);

    event.target.reset();
    await loadRows();
}

async function changeRole(id, role) {
    const response = await window.api.users.updateRole(id, role);
    if (!response || response.success === false) {
        showToast('فشل تعديل الدور', 'error');
        return;
    }
    showProvisioningWarning(response);
    await loadRows();
}

async function toggleDisable(id, disabled) {
    const response = await window.api.users.disable(id, !!disabled);
    if (!response || response.success === false) {
        showToast('فشل تحديث الحالة', 'error');
        return;
    }
    showProvisioningWarning(response);
    await loadRows();
}

function stageGroupVisibilityChange(group, isVisible) {
    pageRows
        .filter((entry) => entry.group === group)
        .forEach((entry) => {
            stagePageVisibilityChange(entry.page, isVisible);
        });
}

function renderPageVisibilityRows() {
    const tbody = document.getElementById('page-visibility-tbody');
    if (!tbody) return;

    if (!pageRows.length) {
        tbody.innerHTML = renderTableMessage('لا توجد بيانات');
        return;
    }

    const groups = [];
    const groupMap = {};
    for (const entry of pageRows) {
        const group = entry.group || '-';
        if (!groupMap[group]) {
            groupMap[group] = [];
            groups.push(group);
        }
        groupMap[group].push(entry);
    }

    let rowIndex = 0;
    const html = groups
        .map((group) => {
            const entries = groupMap[group];
            const summary = getGroupVisibilitySummary(group);
            const safeGroup = safeText(group);
            const groupToggleId = getGroupToggleId(group);
            const groupChecked = summary.allVisible ? 'checked' : '';
            const groupTone = summary.noneVisible ? 'hidden' : summary.allVisible ? 'visible' : 'mixed';

            const headerRow = `
                <tr class="settings-visibility-group-row settings-visibility-group-row--${groupTone}">
                    <td colspan="3" class="settings-visibility-group-cell">
                        <i class="fas fa-layer-group settings-visibility-group-icon"></i>
                        ${safeGroup}
                        <span class="settings-visibility-summary">(${summary.visible} / ${summary.total} مرئي)</span>
                    </td>
                    <td colspan="2"></td>
                    <td class="settings-visibility-group-action">
                        <label class="settings-visibility-toggle settings-visibility-toggle--strong">
                            <input
                                type="checkbox"
                                ${groupChecked}
                                id="${groupToggleId}"
                                onchange="stageGroupVisibilityChange('${group}', this.checked)"
                                ${pageVisibilitySaving ? 'disabled' : ''}
                            >
                            <span>${summary.allVisible ? 'إخفاء الكل' : summary.noneVisible ? 'إظهار الكل' : 'تبديل الكل'}</span>
                        </label>
                    </td>
                </tr>`;

            const pageRowsHtml = entries
                .map((entry) => {
                    rowIndex += 1;
                    const visible = pageVisibilityDraftMap[entry.page] !== false;
                    const savedVisible = pageVisibilityMap[entry.page] !== false;
                    const isDirty = visible !== savedVisible;
                    const rowClasses = [
                        'settings-visibility-row',
                        isDirty ? 'settings-visibility-row--dirty' : '',
                        !visible && !isDirty ? 'settings-visibility-row--hidden' : ''
                    ]
                        .filter(Boolean)
                        .join(' ');

                    return `
                        <tr class="${rowClasses}">
                            <td>${rowIndex}</td>
                            <td class="settings-visibility-page-title">
                                ${safeText(entry.title || entry.page)}
                                <div class="settings-visibility-page-path">${entry.page}</div>
                            </td>
                            <td>${safeGroup}</td>
                            <td>${statusBadge(visible)}${pendingBadge(isDirty)}</td>
                            <td>${completionBadge(entry.completed)}</td>
                            <td>
                                <label class="settings-visibility-toggle">
                                    <input
                                        type="checkbox"
                                        ${visible ? 'checked' : ''}
                                        onchange="stagePageVisibilityChange('${entry.page}', this.checked)"
                                        ${pageVisibilitySaving ? 'disabled' : ''}
                                    >
                                    <span>${visible ? 'مرئي' : 'مخفي'}</span>
                                </label>
                            </td>
                        </tr>`;
                })
                .join('');

            return headerRow + pageRowsHtml;
        })
        .join('');

    tbody.innerHTML = html;

    for (const group of groups) {
        const summary = getGroupVisibilitySummary(group);
        const checkbox = document.getElementById(getGroupToggleId(group));
        if (checkbox && !summary.allVisible && !summary.noneVisible) {
            checkbox.indeterminate = true;
        }
    }
}

async function loadPageVisibilityRows(forceRefresh = false) {
    const tbody = document.getElementById('page-visibility-tbody');
    if (!tbody) return;

    if (!window.PageVisibility?.getCatalog || !window.PageVisibility?.loadState) {
        tbody.innerHTML = renderTableMessage('نظام إخفاء الصفحات غيرمتاح');
        pageRows = [];
        pageVisibilityMap = {};
        pageVisibilityDraftMap = {};
        pageVisibilityDirty = new Set();
        updatePageVisibilitySaveUi();
        return;
    }

    await window.PageVisibility.loadState(forceRefresh === true);
    pageRows = window.PageVisibility.getCatalog()
        .filter((entry) => entry?.page && entry.page !== 'login.html')
        .sort((a, b) => {
            if (a.group === b.group) {
                return String(a.title || '').localeCompare(String(b.title || ''), 'ar');
            }
            return String(a.group || '').localeCompare(String(b.group || ''), 'ar');
        });

    pageVisibilityMap = window.PageVisibility.getMap ? window.PageVisibility.getMap() : {};
    pageVisibilityDraftMap = { ...pageVisibilityMap };
    pageVisibilityDirty = new Set();
    renderPageVisibilityRows();
    updatePageVisibilitySaveUi();
}

function stagePageVisibilityChange(page, isVisible) {
    pageVisibilityDraftMap[page] = !!isVisible;
    const savedVisible = pageVisibilityMap[page] !== false;
    if (!!isVisible === savedVisible) {
        pageVisibilityDirty.delete(page);
    } else {
        pageVisibilityDirty.add(page);
    }
    renderPageVisibilityRows();
    updatePageVisibilitySaveUi();
}

async function savePageVisibilityChanges() {
    if (!window.PageVisibility?.setVisibility) {
        showToast('خطأ الوصول الى نظام الحالة', 'error');
        return;
    }

    if (pageVisibilityDirty.size === 0) {
        showToast('لا توجد تعديلات لحفظها', 'info');
        return;
    }

    const changedPages = Array.from(pageVisibilityDirty);
    pageVisibilitySaving = true;
    updatePageVisibilitySaveUi();
    renderPageVisibilityRows();

    let savedCount = 0;
    let failedCount = 0;
    const failedItems = [];

    for (const page of changedPages) {
        const desiredVisible = pageVisibilityDraftMap[page] !== false;
        try {
            const response = await window.PageVisibility.setVisibility(page, desiredVisible);
            if (response?.success) {
                pageVisibilityMap[page] = desiredVisible;
                pageVisibilityDirty.delete(page);
                savedCount += 1;
            } else {
                failedCount += 1;
                const pageMeta = pageRows.find((entry) => entry.page === page);
                failedItems.push({
                    pageName: pageMeta?.title || page,
                    error: response?.error || 'خطأ غير معروف'
                });
            }
        } catch (error) {
            failedCount += 1;
            const pageMeta = pageRows.find((entry) => entry.page === page);
            failedItems.push({
                pageName: pageMeta?.title || page,
                error: error?.message || 'خطأ اتصال بالنظام'
            });
        }
    }

    pageVisibilitySaving = false;
    renderPageVisibilityRows();
    updatePageVisibilitySaveUi();

    if (savedCount > 0) {
        showToast(`تم حفظ ${savedCount} تعديلات بنجاح`, 'success');
        if (typeof window.PageVisibility.applyForCurrentRole === 'function') {
            window.PageVisibility.applyForCurrentRole();
        }
    }

    if (failedCount > 0) {
        const firstFailure = failedItems[0];
        const hint = firstFailure ? ` - ${firstFailure.pageName}: ${firstFailure.error}` : '';
        showToast(`فشل حفظ ${failedCount} تعديلات${hint}`, 'error', 7000);
    }
}

async function initSettingsUsersPage() {
    await loadRows();
    await loadLinkRequests({ silent: true });
    await loadPageVisibilityRows();

    document.getElementById('form')?.addEventListener('submit', addUser);
    document.getElementById('refresh-link-requests')?.addEventListener('click', async () => {
        await loadLinkRequests();
        showToast('تم تحديث طلبات الربط', 'info');
    });
    document.getElementById('save-page-visibility')?.addEventListener('click', savePageVisibilityChanges);
    document.getElementById('refresh-page-visibility')?.addEventListener('click', async () => {
        if (pageVisibilityDirty.size > 0) {
            const { confirmed: proceed } = await showConfirm({
                title: 'تحديث البيانات',
                message: 'هناك تعديلات غير محفوظة. هل تريد التحديث وفقدان التغييرات؟',
                type: 'warning',
                confirmText: 'تحديث'
            });
            if (!proceed) return;
        }
        await loadPageVisibilityRows(true);
        showToast('تم تحديث كل البيانات', 'info');
    });
    document.getElementById('save-page-visibility-defaults')?.addEventListener('click', async () => {
        if (pageVisibilityDirty.size > 0) {
            showToast('يرجى حفظ التعديلات المعلقة أولاً قبل تعيين الإعداد الافتراضي', 'warning');
            return;
        }
        if (!window.api?.system?.savePageVisibilityDefaults) {
            showToast('هذه الميزة غير متاحة في هذا الإصدار', 'error');
            return;
        }

        const { confirmed } = await showConfirm({
            title: 'حفظ الإعداد الافتراضي',
            message: 'هل تريد حفظ إعدادات الظهور الحالية كإعداد افتراضي؟',
            detail: 'ستُطبَّق هذه الإعدادات تلقائياً عند تثبيت التطبيق على أي جهاز جديد.',
            type: 'info',
            confirmText: 'حفظ'
        });
        if (!confirmed) return;

        try {
            const response = await window.api.system.savePageVisibilityDefaults();
            if (response?.success) {
                showToast(
                    `تم حفظ الإعداد الافتراضي بنجاح (${response.hiddenCount} صفحة مخفية). سيُطبَّق عند إعادة بناء التطبيق.`,
                    'success',
                    5000
                );
            } else {
                showToast(response?.error || 'فشل حفظ الإعداد الافتراضي', 'error');
            }
        } catch {
            showToast('حدث خطأ أثناء حفظ الإعداد الافتراضي', 'error');
        }
    });
}

window.changeRole = changeRole;
window.toggleDisable = toggleDisable;
window.stagePageVisibilityChange = stagePageVisibilityChange;
window.stageGroupVisibilityChange = stageGroupVisibilityChange;
window.approveLinkRequest = approveLinkRequest;
window.rejectLinkRequest = rejectLinkRequest;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSettingsUsersPage);
} else {
    initSettingsUsersPage();
}
