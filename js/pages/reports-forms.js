(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);

    const FORM_CONFIGS = {
        registration: {
            icon: 'fa-user-graduate',
            color: 'var(--primary)',
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
                { id: 'address', label: 'العنوان' },
            ],
        },
        transfer: {
            icon: 'fa-exchange-alt',
            color: 'var(--success)',
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
                { id: 'guardianName', label: 'اسم ولي الأمر', required: true },
            ],
        },
        dropout: {
            icon: 'fa-user-times',
            color: 'var(--warning)',
            title: 'استمارة الانقطاع',
            description: 'تصريح بانقطاع تلميذ عن الدراسة',
            fields: [
                { id: 'studentName', label: 'الاسم الكامل', required: true },
                { id: 'massarCode', label: 'رمز مسار', required: true },
                { id: 'className', label: 'القسم', required: true },
                { id: 'lastAttendanceDate', label: 'آخر يوم حضور', type: 'date', required: true },
                { id: 'reason', label: 'سبب الانقطاع', required: true },
                { id: 'guardianName', label: 'اسم ولي الأمر', required: true },
                { id: 'guardianPhone', label: 'هاتف ولي الأمر' },
            ],
        },
        absence: {
            icon: 'fa-clipboard-check',
            color: 'var(--info)',
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
                { id: 'guardianPhone', label: 'هاتف ولي الأمر' },
            ],
        },
    };

    function getSchoolYear() {
        return document.getElementById('school-year')?.value || '';
    }

    function buildFieldHTML(f, formType) {
        const name = `${formType}_${f.id}`;
        const req = f.required ? 'required' : '';

        if (f.type === 'select') {
            const opts = (f.options || []).map((o) => `<option value="${o}">${o}</option>`).join('');
            return `<div class="rf-field">
                <label for="${name}">${f.label}${f.required ? ' *' : ''}</label>
                <select id="${name}" class="form-control" ${req}>
                    <option value="">اختر...</option>${opts}
                </select>
            </div>`;
        }

        const type = f.type || 'text';
        const ph = f.placeholder ? `placeholder="${f.placeholder}"` : '';
        return `<div class="rf-field">
            <label for="${name}">${f.label}${f.required ? ' *' : ''}</label>
            <input type="${type}" id="${name}" class="form-control" ${ph} ${req}>
        </div>`;
    }

    function renderCards() {
        const grid = $('forms-grid');
        if (!grid) return;

        grid.innerHTML = Object.entries(FORM_CONFIGS)
            .map(
                ([type, cfg]) => `
            <div class="form-card" id="card-${type}">
                <div class="form-card-header" onclick="toggleForm('${type}')">
                    <i class="fas ${cfg.icon}" style="font-size: 36px; color: ${cfg.color};"></i>
                    <h4>${cfg.title}</h4>
                    <p>${cfg.description}</p>
                    <button class="btn btn-primary btn-sm rf-toggle-btn" type="button">
                        <i class="fas fa-chevron-down"></i> فتح الاستمارة
                    </button>
                </div>
                <div class="form-card-body" id="body-${type}" style="display: none;">
                    <form id="form-${type}" onsubmit="return handleSubmit(event, '${type}')">
                        <div class="rf-fields-grid">
                            ${cfg.fields.map((f) => buildFieldHTML(f, type)).join('')}
                        </div>
                        <div class="rf-actions">
                            <button type="submit" class="btn btn-primary">
                                <i class="fas fa-file-pdf"></i> إنشاء PDF
                            </button>
                            <button type="button" class="btn btn-secondary" onclick="toggleForm('${type}')">
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

    window.toggleForm = function (type) {
        const body = $(`body-${type}`);
        if (!body) return;
        const isOpen = body.style.display !== 'none';
        // Close all
        document.querySelectorAll('.form-card-body').forEach((b) => (b.style.display = 'none'));
        document.querySelectorAll('.form-card').forEach((c) => c.classList.remove('active'));
        if (!isOpen) {
            body.style.display = 'block';
            $(`card-${type}`).classList.add('active');
        }
    };

    window.handleSubmit = async function (e, formType) {
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
                mode: 'pdf',
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
    };

    // Initialize on load
    document.addEventListener('DOMContentLoaded', () => {
        renderCards();
    });
})();
