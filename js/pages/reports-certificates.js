const CERT_TYPE_LABELS = {
    attendance: 'شهادة التمدرس',
    enrollment: 'شهادة التسجيل',
    withdrawal: 'شهادة المغادرة'
};

const CERT_TYPE_BODY_TEXT = {
    attendance:
        'يشهد مدير المؤسسة أن التلميذ(ة) المسمى(اة) أعلاه يتابع/تتابع دراسته(ها) بالقسم المذكور برسم الموسم الدراسي الحالي بانتظام.',
    enrollment:
        'يشهد مدير المؤسسة أن التلميذ(ة) المسمى(اة) أعلاه مسجل(ة) بالقسم المذكور برسم الموسم الدراسي الحالي بانتظام.',
    withdrawal: 'يشهد مدير المؤسسة أن التلميذ(ة) المسمى(اة) أعلاه قد غادر(ت) المؤسسة بانتظام خلال هذا الموسم.'
};

let currentStudent = null;
let currentType = '';

function getCurrentSchoolYear() {
    return typeof getSchoolYear === 'function' ? getSchoolYear() : '2025/2026';
}

function safeText(value) {
    if (typeof escapeHtml === 'function') {
        return escapeHtml(value || '');
    }
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderPreview(student, type, year) {
    const preview = document.getElementById('preview');
    if (!preview) return;

    const schoolName = localStorage.getItem('schoolName') || 'المؤسسة التعليمية';
    const dateStr = new Date().toLocaleDateString('ar-MA', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    const typeLabel = CERT_TYPE_LABELS[type];

    preview.innerHTML = `
        <div class="mx-auto max-w-[680px] overflow-hidden rounded-[14px] border-2 border-[var(--color-primary)] bg-[var(--color-surface)] shadow-[var(--shadow-hover)]">
            <div class="bg-[var(--gradient-primary)] px-6 py-4 text-center text-[var(--color-surface)]">
                <div class="mt-1 text-[0.85rem] opacity-[0.85]">${safeText(schoolName)}</div>
                <h2 class="m-0 text-[1.3rem] font-bold">${safeText(typeLabel)}</h2>
            </div>
            <div class="space-y-0 px-7 py-6 text-right text-[0.95rem] text-[var(--color-text-main)]">
                <div class="flex items-baseline gap-2 border-b border-dashed border-[var(--color-accent)] py-2.5"><strong class="min-w-[120px] whitespace-nowrap text-[var(--color-primary)]">الاسم الكامل:</strong> <span>${safeText(student.full_name || '-')}</span></div>
                <div class="flex items-baseline gap-2 border-b border-dashed border-[var(--color-accent)] py-2.5"><strong class="min-w-[120px] whitespace-nowrap text-[var(--color-primary)]">رمز مسار:</strong> <span>${safeText(student.massar_code || '-')}</span></div>
                <div class="flex items-baseline gap-2 border-b border-dashed border-[var(--color-accent)] py-2.5"><strong class="min-w-[120px] whitespace-nowrap text-[var(--color-primary)]">القسم:</strong> <span>${safeText(student.class_name || '-')}</span></div>
                <div class="flex items-baseline gap-2 border-b border-dashed border-[var(--color-accent)] py-2.5"><strong class="min-w-[120px] whitespace-nowrap text-[var(--color-primary)]">السنة الدراسية:</strong> <span>${safeText(year)}</span></div>
                <div class="flex items-baseline gap-2 py-2.5"><strong class="min-w-[120px] whitespace-nowrap text-[var(--color-primary)]">تاريخ الإصدار:</strong> <span>${safeText(dateStr)}</span></div>
            </div>
            <div class="flex flex-wrap justify-center gap-2.5 px-7 pb-5 pt-4">
                <button class="btn btn-success min-w-[140px]" type="button" data-cert-action="pdf"><i class="fas fa-file-pdf"></i> تصدير PDF</button>
                <button class="btn btn-primary min-w-[140px]" type="button" data-cert-action="print"><i class="fas fa-print"></i> طباعة</button>
                <button class="btn btn-secondary min-w-[140px]" type="button" data-cert-action="preview"><i class="fas fa-eye"></i> معاينة</button>
            </div>
            <div class="flex items-center justify-center gap-1 pb-4 text-center text-[0.8rem] text-[var(--color-text-muted)]"><i class="fas fa-info-circle"></i> سيتم طباعة نسختين في كل صفحة A4</div>
        </div>
    `;
}

function buildCertificateBody(student, type) {
    const bodyText = CERT_TYPE_BODY_TEXT[type];
    const year = getCurrentSchoolYear();

    return `
        <table class="mt-1.5 w-full border-collapse text-xs">
            <tr>
                <td class="w-[140px] border-b border-[var(--color-accent)] px-2.5 py-1.5 font-bold text-[var(--color-text-muted)]">الاسم الكامل</td>
                <td class="border-b border-[var(--color-accent)] px-2.5 py-1.5 text-[var(--color-text-main)]">${safeText(student.full_name || '-')}</td>
            </tr>
            <tr>
                <td class="border-b border-[var(--color-accent)] px-2.5 py-1.5 font-bold text-[var(--color-text-muted)]">رمز مسار</td>
                <td class="border-b border-[var(--color-accent)] px-2.5 py-1.5 text-[var(--color-text-main)]">${safeText(student.massar_code || '-')}</td>
            </tr>
            <tr>
                <td class="border-b border-[var(--color-accent)] px-2.5 py-1.5 font-bold text-[var(--color-text-muted)]">القسم</td>
                <td class="border-b border-[var(--color-accent)] px-2.5 py-1.5 text-[var(--color-text-main)]">${safeText(student.class_name || '-')}</td>
            </tr>
            <tr>
                <td class="border-b border-[var(--color-accent)] px-2.5 py-1.5 font-bold text-[var(--color-text-muted)]">السنة الدراسية</td>
                <td class="border-b border-[var(--color-accent)] px-2.5 py-1.5 text-[var(--color-text-main)]">${safeText(year)}</td>
            </tr>
        </table>
        <div class="mt-3.5 rounded-s-[6px] rounded-e-none border-s-[3px] border-[var(--color-primary)] bg-[var(--color-secondary)] px-3 py-2.5 text-xs leading-[1.8] text-[var(--color-text-main)] [-webkit-print-color-adjust:exact] [print-color-adjust:exact]">${safeText(bodyText)}</div>`;
}

async function dispatchCertificate(mode) {
    if (!currentStudent || !currentType) return;

    const bodyHTML = buildCertificateBody(currentStudent, currentType);
    const typeLabel = CERT_TYPE_LABELS[currentType];

    if (window.api?.reports?.printDocument) {
        if (mode === 'pdf') showToast('جاري تصدير PDF...', 'info');

        const result = await window.api.reports.printDocument({
            documentType: 'certificate',
            documentTitle: typeLabel,
            bodyHTML,
            data: { studentName: currentStudent.full_name || '' },
            options: {
                mode,
                copies: 2,
                bodyHeight: '148.5mm',
                showSeal: true,
                showSignature: true,
                showSecurity: true,
                defaultFileName: `${typeLabel}_${currentStudent.massar_code || ''}`
            }
        });

        if (mode === 'pdf' && result?.success) {
            showToast('تم تصدير الشهادة بنجاح', 'success');
        } else if (mode === 'pdf' && result?.error && result.error !== 'Cancelled by user') {
            showToast('خطأ في تصدير الشهادة: ' + result.error, 'error');
        } else if (mode === 'print' && result?.success) {
            showToast('تمت الطباعة بنجاح', 'success');
        }
        return;
    }

    PrintSystem.preview({ title: typeLabel, pageSize: 'A4', landscape: false });
}

async function handleCertificateSubmit(event) {
    event.preventDefault();

    const code = document.getElementById('student-code')?.value.trim() || '';
    const type = document.getElementById('cert-type')?.value || 'attendance';
    const year = getCurrentSchoolYear();
    const student = await window.api.students.getByCode(code, year);

    if (!student) {
        showToast('لم يتم العثور على التلميذ', 'error');
        return;
    }

    currentStudent = student;
    currentType = type;
    renderPreview(student, type, year);
    showToast('تم توليد الشهادة', 'success');
}

function handlePreviewAction(event) {
    const actionButton = event.target.closest('[data-cert-action]');
    if (!actionButton) return;
    dispatchCertificate(actionButton.dataset.certAction);
}

function initReportsCertificatesPage() {
    const form = document.getElementById('form');
    const preview = document.getElementById('preview');
    if (!form || !preview) return;

    form.addEventListener('submit', handleCertificateSubmit);
    preview.addEventListener('click', handlePreviewAction);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initReportsCertificatesPage);
} else {
    initReportsCertificatesPage();
}
