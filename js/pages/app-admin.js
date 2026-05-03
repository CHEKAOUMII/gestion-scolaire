let aaRequests = [];

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

function formatDate(value) {
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

function statusBadge(status) {
    const map = {
        pending: '<span class="settings-visibility-badge settings-visibility-badge--visible"><i class="fas fa-clock"></i> قيد المراجعة</span>',
        approved: '<span class="settings-user-state settings-user-state--active"><i class="fas fa-check"></i> تمت الموافقة</span>',
        rejected: '<span class="settings-user-state settings-user-state--disabled"><i class="fas fa-times"></i> مرفوض</span>',
        failed: '<span class="settings-user-state settings-user-state--disabled"><i class="fas fa-exclamation-triangle"></i> فشل</span>'
    };
    return map[status] || safeText(status);
}

function renderRequests() {
    const tbody = document.getElementById('aa-requests-tbody');
    const emptyState = document.getElementById('aa-empty-state');
    if (!tbody) return;

    if (!aaRequests.length) {
        tbody.innerHTML = '';
        if (emptyState) emptyState.style.display = '';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    tbody.innerHTML = aaRequests.map((req, index) => {
        let actionHtml = '';
        if (req.status === 'pending') {
            actionHtml = `
                <div class="att-action-group" style="display:flex; gap:0.25rem">
                    <button class="btn btn-success" type="button" onclick="approveRequest(${index})">
                        <i class="fas fa-check"></i> موافقة
                    </button>
                    <button class="btn btn-secondary" type="button" onclick="rejectRequest(${index})">
                        <i class="fas fa-times"></i> رفض
                    </button>
                </div>`;
        } else if (req.status === 'rejected' && req.rejectionReason) {
            actionHtml = `<span style="font-size:0.85rem">${safeText(req.rejectionReason)}</span>`;
        } else if (req.status === 'approved') {
            actionHtml = '<span style="font-size:0.85rem; color:var(--color-success-solid)">تمت المعالجة</span>';
        } else {
            actionHtml = '-';
        }

        return `<tr>
            <td>${index + 1}</td>
            <td>${statusBadge(req.status)}</td>
            <td>${safeText(req.oldInstitutionName || '-')}</td>
            <td dir="ltr">${safeText(req.oldSchoolId || '-')}</td>
            <td dir="ltr">${req.codeChanged ? safeText(req.newSchoolId || '-') : '<span style="opacity:0.5">بدون تغيير</span>'}</td>
            <td>${req.nameChanged ? safeText(req.newInstitutionName || '-') : '<span style="opacity:0.5">بدون تغيير</span>'}</td>
            <td>${safeText(req.requestedByEmail || '-')}</td>
            <td>${safeText(req.reason || '-')}</td>
            <td>${formatDate(req.createdAt)}</td>
            <td>${actionHtml}</td>
        </tr>`;
    }).join('');
}

async function loadRequests() {
    const filter = document.getElementById('aa-status-filter')?.value || '';
    const handle = showToast.loading('جاري تحميل الطلبات...');

    try {
        const result = await window.api.appAdmin.listIdentityChangeRequests({
            status: filter || undefined
        });

        if (!result?.success) {
            handle.error(result?.error || 'فشل تحميل الطلبات');
            aaRequests = [];
            renderRequests();
            return;
        }

        aaRequests = result.requests || [];
        renderRequests();
        handle.success(`تم تحميل ${aaRequests.length} طلب`);
    } catch (err) {
        handle.error('حدث خطأ: ' + err.message);
        aaRequests = [];
        renderRequests();
    }
}

async function approveRequest(index) {
    const req = aaRequests[index];
    if (!req?.requestId) return;

    let confirmMessage = 'هل تريد الموافقة على هذا الطلب؟';
    let confirmDetail = '';
    if (req.codeChanged) {
        confirmMessage = `هل تريد الموافقة على تغيير رمز المؤسسة من "${req.oldSchoolId}" إلى "${req.newSchoolId}"؟`;
        confirmDetail = 'هذه العملية ستنقل بيانات المؤسسة في Firebase وتحدث صلاحيات المستخدمين. قد تستغرق بعض الوقت.';
    }

    const { confirmed } = await showConfirm({
        title: 'تأكيد الموافقة',
        message: confirmMessage,
        detail: confirmDetail,
        type: req.codeChanged ? 'warning' : 'info',
        confirmText: 'موافقة'
    });
    if (!confirmed) return;

    const handle = showToast.loading('جاري تنفيذ الموافقة...');
    try {
        const result = await window.api.appAdmin.approveIdentityChangeRequest({
            requestId: req.requestId
        });

        if (!result?.success) {
            handle.error(result?.error || 'فشل تنفيذ الموافقة');
            return;
        }

        handle.success('تمت الموافقة بنجاح');
        await loadRequests();
    } catch (err) {
        handle.error('حدث خطأ: ' + err.message);
    }
}

function showRejectionReasonInput() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[9999] flex items-center justify-center';
        overlay.style.cssText = 'background: rgba(0,0,0,0.5);';

        const card = document.createElement('div');
        card.className = 'bg-white dark:bg-gray-800 rounded-xl p-6 shadow-2xl';
        card.style.cssText = 'min-width: 360px; max-width: 480px;';
        card.innerHTML = `
            <h3 style="font-size:1.1rem; font-weight:600; margin-bottom:0.75rem">
                <i class="fas fa-comment-dots"></i> سبب الرفض
            </h3>
            <textarea id="aa-reject-reason-input" class="su-field__input" rows="3"
                placeholder="اكتب سبب رفض الطلب..." style="width:100%; resize:vertical"></textarea>
            <div style="display:flex; gap:0.5rem; justify-content:flex-start; margin-top:1rem">
                <button id="aa-reject-confirm" class="btn btn-danger" type="button">
                    <i class="fas fa-times"></i> رفض الطلب
                </button>
                <button id="aa-reject-cancel" class="btn btn-secondary" type="button">إلغاء</button>
            </div>`;

        overlay.appendChild(card);
        document.body.appendChild(overlay);

        const input = card.querySelector('#aa-reject-reason-input');
        input.focus();

        function cleanup(value) {
            document.body.removeChild(overlay);
            resolve(value);
        }

        card.querySelector('#aa-reject-confirm').addEventListener('click', () => {
            cleanup(input.value.trim());
        });
        card.querySelector('#aa-reject-cancel').addEventListener('click', () => {
            cleanup(null);
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) cleanup(null);
        });
    });
}

async function rejectRequest(index) {
    const req = aaRequests[index];
    if (!req?.requestId) return;

    const { confirmed } = await showConfirm({
        title: 'رفض الطلب',
        message: 'هل تريد رفض هذا الطلب؟',
        type: 'danger',
        confirmText: 'المتابعة للرفض'
    });
    if (!confirmed) return;

    const reason = await showRejectionReasonInput();
    if (reason === null) return;

    const handle = showToast.loading('جاري رفض الطلب...');
    try {
        const result = await window.api.appAdmin.rejectIdentityChangeRequest({
            requestId: req.requestId,
            rejectionReason: reason || ''
        });

        if (!result?.success) {
            handle.error(result?.error || 'فشل رفض الطلب');
            return;
        }

        handle.success('تم رفض الطلب');
        await loadRequests();
    } catch (err) {
        handle.error('حدث خطأ: ' + err.message);
    }
}

async function initAppAdminPage() {
    document.getElementById('aa-refresh-btn')?.addEventListener('click', loadRequests);
    document.getElementById('aa-status-filter')?.addEventListener('change', loadRequests);
    await loadRequests();
}

window.approveRequest = approveRequest;
window.rejectRequest = rejectRequest;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAppAdminPage);
} else {
    initAppAdminPage();
}
