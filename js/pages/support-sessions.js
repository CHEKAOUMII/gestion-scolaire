/* global showToast */
(async function () {
    'use strict';

    const ATTENDANCE_LABELS = {
        full: 'حضور كلي',
        partial: 'حضور جزئي',
        absent: 'غياب كلي'
    };
    const ATTENDANCE_CLASSNAMES = {
        full: 'support-attendance support-attendance--full',
        partial: 'support-attendance support-attendance--partial',
        absent: 'support-attendance support-attendance--absent'
    };

    const schoolYear = (await window.api.settings.get('school_year')) || '';

    let teachers = [];
    let sessions = [];
    let lastSessionDraft = null;

    const formTeacher = document.getElementById('form-teacher');
    const formSubject = document.getElementById('form-subject');
    const formSection = document.getElementById('form-section');
    const formDate = document.getElementById('form-date');
    const formTimeFrom = document.getElementById('form-time-from');
    const formTimeTo = document.getElementById('form-time-to');
    const formRoom = document.getElementById('form-room');
    const formAttendance = document.getElementById('form-attendance');
    const formDuration = document.getElementById('form-duration');
    const addSessionButton = document.getElementById('btn-add-session');
    const repeatLastButton = document.getElementById('btn-repeat-last');
    const resetFormButton = document.getElementById('btn-reset-form');

    const filterTeacher = document.getElementById('filter-teacher');
    const filterSection = document.getElementById('filter-section');
    const filterSubject = document.getElementById('filter-subject');
    const filterFrom = document.getElementById('filter-date-from');
    const filterTo = document.getElementById('filter-date-to');
    const filterButton = document.getElementById('btn-filter');
    const clearFiltersButton = document.getElementById('btn-clear-filters');

    const tbody = document.getElementById('sessions-tbody');
    const sessionsCount = document.getElementById('sessions-count');
    const exportButton = document.getElementById('btn-export');
    const importInput = document.getElementById('input-import');
    const printButton = document.getElementById('btn-print');

    function setActionBusy(control, isBusy, busyLabel, idleLabel) {
        if (!control) return;
        if (!control.dataset.defaultLabel) {
            control.dataset.defaultLabel = idleLabel || control.innerHTML;
        }

        control.disabled = isBusy;
        control.setAttribute('aria-busy', String(isBusy));
        control.classList.toggle('is-busy', isBusy);
        control.innerHTML = isBusy
            ? `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> ${busyLabel}`
            : control.dataset.defaultLabel;
    }

    function setFileTriggerBusy(labelControl, isBusy, busyLabel) {
        if (!labelControl) return;
        if (!labelControl.dataset.defaultLabel) {
            labelControl.dataset.defaultLabel = labelControl.innerHTML;
        }

        labelControl.classList.toggle('is-busy', isBusy);
        labelControl.classList.toggle('is-disabled', isBusy);
        importInput.disabled = isBusy;
        labelControl.setAttribute('aria-busy', String(isBusy));
        labelControl.innerHTML = isBusy
            ? `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> ${busyLabel}`
            : labelControl.dataset.defaultLabel;
    }

    function getTodayValue() {
        return new Date().toISOString().substring(0, 10);
    }

    function getFriendlyErrorMessage(action, error) {
        const rawMessage = (error && error.message ? String(error.message) : '').trim();
        if (!rawMessage) {
            return `${action} حاليا. حاول مرة أخرى بعد قليل.`;
        }

        const normalizedMessage = rawMessage.toLowerCase();
        if (normalizedMessage.includes('unique') || normalizedMessage.includes('duplicate')) {
            return 'هذه الحصة مسجلة من قبل. راجع الجدول قبل إضافة حصة جديدة.';
        }

        if (normalizedMessage.includes('json') || normalizedMessage.includes('unexpected token')) {
            return 'ملف الاستيراد غير صالح. اختر ملف JSON تم تصديره من صفحة حصص الدعم.';
        }

        return `${action}: ${rawMessage}`;
    }

    function hasActiveFilters() {
        return Boolean(
            filterTeacher.value || filterSection.value || filterSubject.value || filterFrom.value || filterTo.value
        );
    }

    function getMissingRequiredFields(payload) {
        const missingFields = [];
        if (!payload.teacher_id) missingFields.push('الأستاذ');
        if (!payload.subject) missingFields.push('المادة');
        if (!payload.section) missingFields.push('القسم');
        if (!payload.session_date) missingFields.push('التاريخ');
        if (!payload.time_from) missingFields.push('وقت البداية');
        if (!payload.time_to) missingFields.push('وقت النهاية');
        return missingFields;
    }

    function calcDuration(from, to) {
        if (!from || !to) return null;
        const [fromHours, fromMinutes] = from.split(':').map(Number);
        const [toHours, toMinutes] = to.split(':').map(Number);
        const minutes = toHours * 60 + toMinutes - (fromHours * 60 + fromMinutes);
        return minutes > 0 ? Math.round((minutes / 60) * 100) / 100 : null;
    }

    function formatTime(value) {
        return value ? value.substring(0, 5) : '';
    }

    function updateDurationPreview() {
        const duration = calcDuration(formTimeFrom.value, formTimeTo.value);
        formDuration.textContent = duration ? `(${duration} ساعة)` : '';
    }

    function resetEntryForm() {
        formTeacher.value = '';
        formSubject.value = '';
        formSection.value = '';
        formDate.value = getTodayValue();
        formTimeFrom.value = '';
        formTimeTo.value = '';
        formRoom.value = '';
        formAttendance.value = 'full';
        formDuration.textContent = '';
    }

    function applyDraftToForm(draft) {
        if (!draft) return;
        formTeacher.value = draft.teacher_id != null ? String(draft.teacher_id) : '';
        formSubject.value = draft.subject || '';
        formSection.value = draft.section || '';
        formDate.value = getTodayValue();
        formTimeFrom.value = draft.time_from || '';
        formTimeTo.value = draft.time_to || '';
        formRoom.value = draft.room || '';
        formAttendance.value = draft.attendance_status || 'full';
        updateDurationPreview();
    }

    function clearFilters() {
        filterTeacher.value = '';
        filterSection.value = '';
        filterSubject.value = '';
        filterFrom.value = '';
        filterTo.value = '';
    }

    async function loadTeachers() {
        teachers = await window.api.teachers.getAll(schoolYear);
        [formTeacher, filterTeacher].forEach((select) => {
            const placeholder = select === formTeacher ? '-- اختر الأستاذ --' : 'الكل';
            select.innerHTML = `<option value="">${placeholder}</option>`;
            teachers.forEach((teacher) => {
                const option = document.createElement('option');
                option.value = teacher.id;
                option.dataset.subject = teacher.subject || '';
                option.textContent = teacher.full_name;
                select.appendChild(option);
            });
        });
    }

    async function loadSections() {
        const classes = await window.api.classes.getAll(schoolYear);
        const sections = classes.map((item) => item.name || item.class_name || item).filter(Boolean);
        [formSection, filterSection].forEach((select) => {
            const placeholder = select === formSection ? '-- اختر القسم --' : 'الكل';
            select.innerHTML = `<option value="">${placeholder}</option>`;
            sections.forEach((section) => {
                const option = document.createElement('option');
                option.value = section;
                option.textContent = section;
                select.appendChild(option);
            });
        });
    }

    function loadSubjects() {
        const subjectSet = new Set(teachers.map((teacher) => teacher.subject).filter(Boolean));
        filterSubject.innerHTML = '<option value="">الكل</option>';
        formSubject.innerHTML = '<option value="">-- اختر المادة --</option>';
        subjectSet.forEach((subject) => {
            [formSubject, filterSubject].forEach((select) => {
                const option = document.createElement('option');
                option.value = subject;
                option.textContent = subject;
                select.appendChild(option);
            });
        });
    }

    formTeacher.addEventListener('change', () => {
        const selected = formTeacher.options[formTeacher.selectedIndex];
        const subject = selected ? selected.dataset.subject : '';
        if (subject) formSubject.value = subject;
    });

    [formTimeFrom, formTimeTo].forEach((element) => {
        element.addEventListener('change', updateDurationPreview);
    });

    async function loadStats() {
        const stats = await window.api.supportSessions.stats(schoolYear);
        document.getElementById('stat-sessions').textContent = stats.total_sessions || 0;
        document.getElementById('stat-hours').textContent = stats.total_hours || 0;
        document.getElementById('stat-teachers').textContent = stats.total_teachers || 0;
        document.getElementById('stat-sections').textContent = stats.total_sections || 0;
    }

    function renderTable(rows) {
        if (!rows.length) {
            const emptyMessage = hasActiveFilters()
                ? 'لا توجد حصص مطابقة لعوامل البحث الحالية. غيّر البحث أو امسح بعض الحقول.'
                : 'لا توجد حصص دعم مسجلة بعد. ابدأ بتسجيل أول حصة من النموذج أعلاه.';
            tbody.innerHTML = `
                <tr id="empty-row" class="empty-row">
                    <td colspan="10" class="support-empty-cell">
                        <i class="fas fa-inbox support-empty-icon" aria-hidden="true"></i>
                        ${emptyMessage}
                    </td>
                </tr>
            `;
            sessionsCount.textContent = '';
            return;
        }

        sessionsCount.textContent = `(${rows.length})`;
        tbody.innerHTML = rows
            .map(
                (session, index) => `
                    <tr>
                        <td data-label="#">${index + 1}</td>
                        <td data-label="التاريخ">${session.session_date}</td>
                        <td data-label="الأستاذ">${session.teacher_name || session.teacher_full_name || '-'}</td>
                        <td data-label="المادة">${session.subject}</td>
                        <td data-label="القسم">${session.section}</td>
                        <td data-label="القاعة">${session.room || 'غير محددة'}</td>
                        <td data-label="التوقيت">${formatTime(session.time_from)} – ${formatTime(session.time_to)}</td>
                        <td data-label="المدة (س)">${session.duration_hours || '-'}</td>
                        <td data-label="حضور القسم">
                            <span class="${ATTENDANCE_CLASSNAMES[session.attendance_status] || 'support-attendance'}">
                                ${ATTENDANCE_LABELS[session.attendance_status] || session.attendance_status}
                            </span>
                        </td>
                        <td class="no-print" data-label="حذف">
                            <button class="btn btn-danger btn-sm" data-delete="${session.id}" title="حذف الحصة">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                `
            )
            .join('');
    }

    async function loadSessions(options = {}) {
        const { showLoadingState = false } = options;
        const filters = {
            school_year: schoolYear,
            teacher_id: filterTeacher.value || undefined,
            section: filterSection.value || undefined,
            subject: filterSubject.value || undefined,
            date_from: filterFrom.value || undefined,
            date_to: filterTo.value || undefined
        };

        if (showLoadingState) {
            setActionBusy(filterButton, true, 'جارٍ تحديث النتائج...', '<i class="fas fa-search"></i> تطبيق البحث');
            setActionBusy(clearFiltersButton, true, 'جارٍ التحديث...', '<i class="fas fa-rotate-left"></i> مسح البحث');
        }

        try {
            sessions = await window.api.supportSessions.list(filters);
            renderTable(sessions);
        } finally {
            if (showLoadingState) {
                setActionBusy(filterButton, false, '', '<i class="fas fa-search"></i> تطبيق البحث');
                setActionBusy(clearFiltersButton, false, '', '<i class="fas fa-rotate-left"></i> مسح البحث');
            }
        }
    }

    addSessionButton.addEventListener('click', async () => {
        const teacherOption = formTeacher.options[formTeacher.selectedIndex];
        const payload = {
            teacher_id: formTeacher.value ? Number(formTeacher.value) : null,
            teacher_name: teacherOption && formTeacher.value ? teacherOption.textContent.trim() : null,
            subject: formSubject.value,
            section: formSection.value,
            room: formRoom.value.trim(),
            session_date: formDate.value,
            time_from: formTimeFrom.value,
            time_to: formTimeTo.value,
            attendance_status: formAttendance.value,
            school_year: schoolYear
        };

        const missingFields = getMissingRequiredFields(payload);
        if (missingFields.length) {
            showToast(`أكمل هذه البيانات قبل التسجيل: ${missingFields.join('، ')}`, 'error');
            return;
        }

        if (!calcDuration(payload.time_from, payload.time_to)) {
            showToast('وقت النهاية يجب أن يكون بعد وقت البداية حتى نحسب مدة الحصة بشكل صحيح.', 'error');
            return;
        }

        try {
            setActionBusy(addSessionButton, true, 'جارٍ تسجيل الحصة...', '<i class="fas fa-save"></i> تسجيل الحصة');
            await window.api.supportSessions.add(payload);
            lastSessionDraft = { ...payload };
            repeatLastButton.disabled = false;
            showToast('تم تسجيل حصة الدعم وتحديث الجدول أدناه.', 'success');
            resetEntryForm();
            formTeacher.focus();
            await Promise.all([loadStats(), loadSessions()]);
        } catch (error) {
            showToast(getFriendlyErrorMessage('تعذر تسجيل حصة الدعم', error), 'error');
        } finally {
            setActionBusy(addSessionButton, false, '', '<i class="fas fa-save"></i> تسجيل الحصة');
        }
    });

    filterButton.addEventListener('click', () => loadSessions({ showLoadingState: true }));

    clearFiltersButton.addEventListener('click', async () => {
        clearFilters();
        await loadSessions({ showLoadingState: true });
        showToast('تم مسح عوامل البحث وعرض جميع الحصص.', 'success');
    });

    repeatLastButton.addEventListener('click', () => {
        if (!lastSessionDraft) return;
        applyDraftToForm(lastSessionDraft);
        formTeacher.focus();
        showToast('تم تجهيز بيانات آخر حصة. راجعها ثم سجلها من جديد إذا لزم الأمر.', 'info');
    });

    resetFormButton.addEventListener('click', () => {
        resetEntryForm();
        formTeacher.focus();
        showToast('تم تفريغ الحقول والاحتفاظ بتاريخ اليوم لبدء إدخال جديد.', 'info');
    });

    document.addEventListener('keydown', (event) => {
        if (!(event.ctrlKey && event.key === 'Enter')) return;
        if (!document.activeElement || !document.activeElement.closest('.support-primary-shell')) return;
        event.preventDefault();
        document.getElementById('btn-add-session').click();
    });

    tbody.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-delete]');
        if (!button) return;
        if (button.disabled) return;

        const row = button.closest('tr');
        const teacherName = row ? row.children[2].textContent.trim() : 'هذا الأستاذ';
        const sessionDate = row ? row.children[1].textContent.trim() : 'هذا التاريخ';
        if (!confirm(`سيتم حذف حصة الدعم بتاريخ ${sessionDate} الخاصة بـ ${teacherName}. لا يمكن التراجع بعد الحذف.`))
            return;

        try {
            setActionBusy(button, true, 'جارٍ الحذف...', '<i class="fas fa-trash"></i>');
            await window.api.supportSessions.delete(Number(button.dataset.delete));
            showToast('تم حذف حصة الدعم من السجل.', 'success');
            await Promise.all([loadStats(), loadSessions()]);
        } catch (error) {
            showToast(getFriendlyErrorMessage('تعذر حذف الحصة', error), 'error');
        } finally {
            setActionBusy(button, false, '', '<i class="fas fa-trash"></i>');
        }
    });

    exportButton.addEventListener('click', async () => {
        try {
            setActionBusy(exportButton, true, 'جارٍ تجهيز الملف...', '<i class="fas fa-file-export"></i> تصدير JSON');
            const data = await window.api.supportSessions.export(schoolYear);
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `حصص-الدعم-${schoolYear}.json`;
            anchor.click();
            URL.revokeObjectURL(url);
            showToast('تم تجهيز ملف التصدير. إذا لم يبدأ التنزيل تلقائيا، تحقق من إعدادات المتصفح.', 'success');
        } catch (error) {
            showToast(getFriendlyErrorMessage('تعذر تصدير ملف الحصص', error), 'error');
        } finally {
            setActionBusy(exportButton, false, '', '<i class="fas fa-file-export"></i> تصدير JSON');
        }
    });

    importInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const importTrigger = importInput.closest('label');

        try {
            setFileTriggerBusy(importTrigger, true, 'جارٍ استيراد الملف...');
            const text = await file.text();
            const payload = JSON.parse(text);
            const result = await window.api.supportSessions.import(payload);
            showToast(
                `اكتمل الاستيراد: تمت إضافة ${result.imported} حصة جديدة وتجاوز ${result.skipped} حصة مكررة.`,
                'success'
            );
            await Promise.all([loadStats(), loadSessions()]);
        } catch (error) {
            showToast(getFriendlyErrorMessage('تعذر استيراد الملف', error), 'error');
        } finally {
            setFileTriggerBusy(importTrigger, false, '');
        }

        event.target.value = '';
    });

    document.getElementById('btn-print').addEventListener('click', () => {
        document.getElementById('print-date').textContent = `تاريخ الطباعة: ${new Date().toLocaleDateString('ar-MA')}`;
        const filterParts = [];
        if (filterTeacher.value) {
            filterParts.push(`الأستاذ: ${filterTeacher.options[filterTeacher.selectedIndex].textContent}`);
        }
        if (filterSection.value) {
            filterParts.push(`القسم: ${filterSection.value}`);
        }
        if (filterSubject.value) {
            filterParts.push(`المادة: ${filterSubject.value}`);
        }
        document.getElementById('print-filters').textContent = filterParts.length
            ? filterParts.join(' | ')
            : 'بدون عوامل بحث';
        window.print();
    });

    await loadTeachers();
    loadSubjects();
    await loadSections();
    await Promise.all([loadStats(), loadSessions()]);

    formDate.value = getTodayValue();
    formTeacher.focus();
})();
