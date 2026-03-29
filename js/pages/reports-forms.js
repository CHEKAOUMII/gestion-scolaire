(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);

    const FORM_CONFIGS = {
        registration: {
            icon: 'fa-user-graduate',
            iconClass: 'text-[var(--color-primary)]',
            title: 'استمارة تسجيل التلاميذ',
            description: 'استمارة التسجيل الأولي للتلاميذ الجدد',
            fields: [
                { id: 'studentName', label: 'الاسم الكامل', required: true },
                { id: 'massarCode', label: 'رمز مسار', required: true },
                { id: 'birthDate', label: 'تاريخ الازدياد', type: 'date', required: true },
                { id: 'birthPlace', label: 'مكان الازدياد' },
                { id: 'gender', label: 'الجنس', type: 'select', options: ['ذكر', 'أنثى'] },
                { id: 'nationality', label: 'الجنسية', placeholder: 'مغربية' },
                { id: 'className', label: 'القسم', required: true },
                { id: 'guardianName', label: 'اسم ولي الأمر', required: true },
                { id: 'guardianPhone', label: 'هاتف ولي الأمر' },
                { id: 'address', label: 'العنوان' }
            ]
        },
        transfer: {
            icon: 'fa-exchange-alt',
            iconClass: 'text-[var(--color-success-text)]',
            title: 'استمارة الانتقال',
            description: 'طلب انتقال تلميذ من مؤسسة لأخرى',
            fields: [
                { id: 'studentName', label: 'الاسم الكامل', required: true },
                { id: 'massarCode', label: 'رمز مسار', required: true },
                { id: 'birthDate', label: 'تاريخ الازدياد', type: 'date' },
                { id: 'className', label: 'القسم', required: true },
                { id: 'originSchool', label: 'المؤسسة الأصلية', required: true },
                { id: 'destinationSchool', label: 'المؤسسة المستقبلة', required: true },
                { id: 'reason', label: 'سبب الانتقال' },
                { id: 'guardianName', label: 'اسم ولي الأمر', required: true }
            ]
        },
        dropout: {
            icon: 'fa-user-times',
            iconClass: 'text-[var(--color-warning-text)]',
            title: 'استمارة الانقطاع',
            description: 'تصريح بانقطاع تلميذ عن الدراسة',
            fields: [
                { id: 'studentName', label: 'الاسم الكامل', required: true },
                { id: 'massarCode', label: 'رمز مسار', required: true },
                { id: 'className', label: 'القسم', required: true },
                { id: 'lastAttendanceDate', label: 'آخر يوم حضور', type: 'date', required: true },
                { id: 'reason', label: 'سبب الانقطاع', required: true },
                { id: 'guardianName', label: 'اسم ولي الأمر', required: true },
                { id: 'guardianPhone', label: 'هاتف ولي الأمر' }
            ]
        },
        absence: {
            icon: 'fa-clipboard-check',
            iconClass: 'text-[var(--color-info-text)]',
            title: 'استمارة تبرير الغياب',
            description: 'نموذج تبرير غياب التلميذ',
            fields: [
                { id: 'studentName', label: 'الاسم الكامل', required: true },
                { id: 'massarCode', label: 'رمز مسار', required: true },
                { id: 'className', label: 'القسم', required: true },
                { id: 'absenceFrom', label: 'من تاريخ', type: 'date', required: true },
                { id: 'absenceTo', label: 'إلى تاريخ', type: 'date', required: true },
                { id: 'totalDays', label: 'عدد الأيام', type: 'number' },
                { id: 'reason', label: 'سبب الغياب', required: true },
                { id: 'guardianName', label: 'اسم ولي الأمر', required: true },
                { id: 'guardianPhone', label: 'هاتف ولي الأمر' }
            ]
        }
    };

    function getSchoolYear() {
        return document.getElementById('school-year')?.value || '';
    }

    function buildFieldHTML(f, formType) {
        const name = `${formType}_${f.id}`;
        const req = f.required ? 'required' : '';
        const label = `${f.label}${f.required ? ' *' : ''}`;

        if (f.type === 'select') {
            const opts = (f.options || []).map((o) => `<option value="${o}">${o}</option>`).join('');
            return `<div class="rf-field">
                <label class="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]" for="${name}">${label}</label>
                <select id="${name}" class="form-control w-full text-[13px]" ${req}>
                    <option value="">اختر...</option>${opts}
                </select>
            </div>`;
        }

        const type = f.type || 'text';
        const ph = f.placeholder ? `placeholder="${f.placeholder}"` : '';
        return `<div class="rf-field">
            <label class="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]" for="${name}">${label}</label>
            <input type="${type}" id="${name}" class="form-control w-full text-[13px]" ${ph} ${req}>
        </div>`;
    }

    function renderCards() {
        const grid = $('forms-grid');
        if (!grid) return;

        grid.innerHTML = Object.entries(FORM_CONFIGS)
            .map(
                ([type, cfg]) => `
            <div class="form-card overflow-hidden rounded-xl bg-[var(--color-surface)] shadow-[0_2px_10px_rgba(0,0,0,0.1)] transition-shadow duration-200" id="card-${type}">
                <div class="form-card-header px-[25px] py-[25px] text-center">
                    <i class="fas ${cfg.icon} mb-4 text-4xl ${cfg.iconClass}"></i>
                    <h4 class="text-lg font-bold text-[var(--color-text-main)]" id="form-card-title-${type}">${cfg.title}</h4>
                    <p class="my-2.5 text-[var(--color-text-muted)]" id="form-card-desc-${type}">${cfg.description}</p>
                    <button class="btn btn-primary btn-sm rf-toggle-btn mt-2" type="button" data-form-toggle="${type}" aria-expanded="false" aria-controls="body-${type}" aria-describedby="form-card-desc-${type}">
                        <i class="fas fa-chevron-down"></i> فتح الاستمارة
                    </button>
                </div>
                <div class="form-card-body hidden px-5 pb-5" id="body-${type}" role="region" aria-labelledby="form-card-title-${type}" aria-hidden="true">
                    <form id="form-${type}" data-form-type="${type}">
                        <div class="rf-fields-grid grid grid-cols-1 gap-3 py-4 md:grid-cols-2 xl:grid-cols-3">
                            ${cfg.fields.map((f) => buildFieldHTML(f, type)).join('')}
                        </div>
                        <div class="rf-actions mt-2 flex flex-wrap gap-2.5 border-t border-[var(--color-accent)] pt-3">
                            <button type="submit" class="btn btn-primary">
                                <i class="fas fa-file-pdf"></i> إنشاء PDF
                            </button>
                            <button type="button" class="btn btn-secondary" data-form-toggle="${type}" aria-expanded="false" aria-controls="body-${type}">
                                <i class="fas fa-times"></i> إغلاق
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `
            )
            .join('');
    }

    function toggleForm(type) {
        const body = $(`body-${type}`);
        if (!body) return;
        const card = $(`card-${type}`);
        const isOpen = !body.classList.contains('hidden');
        document.querySelectorAll('.form-card-body').forEach((b) => b.classList.add('hidden'));
        document.querySelectorAll('.form-card-body').forEach((b) => b.setAttribute('aria-hidden', 'true'));
        document.querySelectorAll('.form-card').forEach((c) => {
            c.classList.remove('shadow-[0_4px_20px_rgba(59,106,197,0.2)]', 'ring-1', 'ring-[rgba(59,106,197,0.2)]');
        });
        document
            .querySelectorAll('[data-form-toggle]')
            .forEach((button) => button.setAttribute('aria-expanded', 'false'));
        if (!isOpen) {
            body.classList.remove('hidden');
            body.setAttribute('aria-hidden', 'false');
            card?.classList.add('shadow-[0_4px_20px_rgba(59,106,197,0.2)]', 'ring-1', 'ring-[rgba(59,106,197,0.2)]');
            document
                .querySelectorAll(`[data-form-toggle="${type}"]`)
                .forEach((button) => button.setAttribute('aria-expanded', 'true'));
        }
    }

    async function handleSubmit(e, formType) {
        e.preventDefault();
        const cfg = FORM_CONFIGS[formType];
        if (!cfg) return false;

        const data = { schoolYear: getSchoolYear() };
        for (const f of cfg.fields) {
            const el = $(`${formType}_${f.id}`);
            const val = el ? el.value.trim() : '';
            if (f.required && !val) {
                showToast(`الرجاء ملء الحقل: ${f.label}`, 'error');
                el?.focus();
                return false;
            }
            data[f.id] = val;
        }

        showToast('جاري إنشاء الاستمارة...', 'info');

        try {
            const result = await window.api.reports.generateAdminForm({
                formType,
                data,
                mode: 'pdf'
            });

            if (result?.success) {
                showToast('تم إنشاء الاستمارة بنجاح', 'success');
            } else {
                showToast(result?.error || 'فشل إنشاء الاستمارة', 'error');
            }
        } catch (err) {
            showToast('خطأ في إنشاء الاستمارة', 'error');
        }

        return false;
    }

    function bindCardInteractions() {
        const grid = $('forms-grid');
        if (!grid) return;

        grid.addEventListener('click', (event) => {
            const toggle = event.target.closest('[data-form-toggle]');
            if (!toggle) return;
            toggleForm(toggle.dataset.formToggle);
        });

        grid.addEventListener('submit', (event) => {
            const form = event.target.closest('form[data-form-type]');
            if (!form) return;
            handleSubmit(event, form.dataset.formType);
        });
    }

    // Initialize on load
    document.addEventListener('DOMContentLoaded', () => {
        renderCards();
        bindCardInteractions();
    });
})();
