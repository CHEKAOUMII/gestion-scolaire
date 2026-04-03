/* global showToast */
(async function () {
    'use strict';

    function isValidSchoolYear(value) {
        return typeof value === 'string' && /^\d{4}\/\d{4}$/.test(value.trim());
    }

    async function resolveSchoolYear() {
        if (typeof getSchoolYear === 'function') {
            const localYear = String(getSchoolYear() || '').trim();
            if (isValidSchoolYear(localYear)) return localYear;
        }

        if (window.api?.settings?.get) {
            for (const key of ['currentSchoolYear', 'schoolYear', 'school_year']) {
                try {
                    const value = await window.api.settings.get(key);
                    if (isValidSchoolYear(value)) return value.trim();
                } catch (_error) {
                    // Ignore legacy/missing keys and keep trying fallbacks.
                }
            }
        }

        return '2025/2026';
    }

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

    const schoolYear = await resolveSchoolYear();

    let teachers = [];
    let sessions = [];
    let currentPage = 1;
    const SESSIONS_PER_PAGE = 20;
    let lastSessionDraft = null;
    try {
        const saved = sessionStorage.getItem('support_lastDraft');
        if (saved) lastSessionDraft = JSON.parse(saved);
    } catch (_e) { /* ignore */ }
    const FALLBACK_SUBJECTS = typeof SUBJECT_LABELS === 'object'
        ? [...new Set(Object.values(SUBJECT_LABELS))].sort()
        : [];

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
    const paginationContainer = document.getElementById('sessions-pagination');
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

    function ensureIpcSuccess(result, fallbackMessage) {
        if (result && typeof result === 'object' && result.success === false) {
            throw new Error(String(result.error || fallbackMessage || 'Ø­Ø¯Ø« Ø®Ø·Ø£ ØºÙŠØ± Ù…ØªÙˆÙ‚Ø¹'));
        }
        return result;
    }

    function hasActiveFilters() {
        return Boolean(
            filterTeacher.value || filterSection.value || filterSubject.value || filterFrom.value || filterTo.value
        );
    }

    function highlightInvalidFields(payload) {
        const fieldMap = {
            teacher_id: formTeacher,
            subject: formSubject,
            section: formSection,
            session_date: formDate,
            time_from: formTimeFrom,
            time_to: formTimeTo
        };
        Object.entries(fieldMap).forEach(([key, element]) => {
            element.classList.toggle('is-invalid', !payload[key]);
        });
    }

    function clearInvalidHighlights() {
        [formTeacher, formSubject, formSection, formDate, formTimeFrom, formTimeTo].forEach((el) => {
            el.classList.remove('is-invalid');
        });
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
        clearInvalidHighlights();
        formSubject.value = '';
        filterTeachersBySubject('');
        formTeacher.value = '';
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
        formSubject.value = draft.subject || '';
        filterTeachersBySubject(formSubject.value);
        formTeacher.value = draft.teacher_id != null ? String(draft.teacher_id) : '';
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
        const result = ensureIpcSuccess(await window.api.teachers.getAll(schoolYear), 'تعذر تحميل قائمة الأساتذة');
        teachers = Array.isArray(result) ? result : [];
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
        const result = ensureIpcSuccess(await window.api.classes.getAll(schoolYear), 'تعذر تحميل قائمة الأقسام');
        const classes = Array.isArray(result) ? result : [];
        const sections = classes.map((item) => item.name || item.class_name || item).filter(Boolean);

        const SECTION_ORDER = [
            { pattern: /\u062c\u0630\u0639|\u0627\u0644\u062c\u0630\u0639|\u062c\u0630\u0648\u0639|\u0627\u0644\u062c\u0630\u0648\u0639|TC/i, rank: 1 },
            { pattern: /\u0623\u0648\u0644\u0649|1\s*\u0628\u0627\u0643|1BAC|\u0627\u0644\u0623\u0648\u0644\u0649/i, rank: 2 },
            { pattern: /\u062b\u0627\u0646\u064a\u0629|2\s*\u0628\u0627\u0643|2BAC|\u0627\u0644\u062b\u0627\u0646\u064a\u0629/i, rank: 3 }
        ];

        function getSectionRank(name) {
            for (const entry of SECTION_ORDER) {
                if (entry.pattern.test(name)) return entry.rank;
            }
            return 99;
        }

        sections.sort((a, b) => {
            const rankA = getSectionRank(a);
            const rankB = getSectionRank(b);
            if (rankA !== rankB) return rankA - rankB;
            return a.localeCompare(b, 'ar');
        });

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
        const teacherSubjects = new Set(teachers.map((teacher) => teacher.subject).filter(Boolean));
        const allSubjects = new Set([...teacherSubjects, ...FALLBACK_SUBJECTS]);
        filterSubject.innerHTML = '<option value="">الكل</option>';
        formSubject.innerHTML = '<option value="">-- اختر المادة --</option>';
        allSubjects.forEach((subject) => {
            [formSubject, filterSubject].forEach((select) => {
                const option = document.createElement('option');
                option.value = subject;
                option.textContent = subject;
                select.appendChild(option);
            });
        });
    }

    function filterTeachersBySubject(selectedSubject) {
        const currentTeacher = formTeacher.value;
        formTeacher.innerHTML = '<option value="">-- اختر الأستاذ --</option>';
        const filtered = selectedSubject
            ? teachers.filter((t) => t.subject === selectedSubject)
            : teachers;
        filtered.forEach((teacher) => {
            const option = document.createElement('option');
            option.value = teacher.id;
            option.dataset.subject = teacher.subject || '';
            option.textContent = teacher.full_name;
            formTeacher.appendChild(option);
        });
        if (filtered.some((t) => String(t.id) === currentTeacher)) {
            formTeacher.value = currentTeacher;
        } else {
            formTeacher.value = '';
        }
    }

    formSubject.addEventListener('change', () => {
        filterTeachersBySubject(formSubject.value);
    });

    function filterSecondaryTeachersBySubject(selectedSubject) {
        const currentValue = filterTeacher.value;
        filterTeacher.innerHTML = '<option value="">الكل</option>';
        const filtered = selectedSubject
            ? teachers.filter((t) => t.subject === selectedSubject)
            : teachers;
        filtered.forEach((teacher) => {
            const option = document.createElement('option');
            option.value = teacher.id;
            option.textContent = teacher.full_name;
            filterTeacher.appendChild(option);
        });
        if (filtered.some((t) => String(t.id) === currentValue)) {
            filterTeacher.value = currentValue;
        } else {
            filterTeacher.value = '';
        }
    }

    filterSubject.addEventListener('change', () => {
        filterSecondaryTeachersBySubject(filterSubject.value);
    });

    [formTimeFrom, formTimeTo].forEach((element) => {
        element.addEventListener('change', updateDurationPreview);
    });

    [formTeacher, formSubject, formSection, formDate, formTimeFrom, formTimeTo].forEach((el) => {
        el.addEventListener('change', () => el.classList.remove('is-invalid'));
        el.addEventListener('input', () => el.classList.remove('is-invalid'));
    });

    async function loadStats() {
        const stats = ensureIpcSuccess(
            await window.api.supportSessions.stats(schoolYear),
            'تعذر تحميل إحصائيات حصص الدعم'
        ) || {};
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
            if (paginationContainer) paginationContainer.innerHTML = '';
            return;
        }

        const totalRows = rows.length;
        const totalPages = Math.ceil(totalRows / SESSIONS_PER_PAGE) || 1;
        currentPage = Math.max(1, Math.min(currentPage, totalPages));

        const startIndex = (currentPage - 1) * SESSIONS_PER_PAGE;
        const endIndex = startIndex + SESSIONS_PER_PAGE;
        const pageRows = rows.slice(startIndex, endIndex);

        sessionsCount.textContent = `(${totalRows})`;
        tbody.innerHTML = pageRows
            .map(
                (session, index) => `
                    <tr>
                        <td data-label="#">${startIndex + index + 1}</td>
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

        renderPagination(totalRows, totalPages);
    }

    function renderPagination(totalRows, totalPages) {
        if (!paginationContainer) return;
        if (totalPages <= 1) {
            paginationContainer.innerHTML = `<div class="support-pagination-info">
                <span><i class="fas fa-list-ol"></i> المجموع: ${totalRows}</span>
            </div>`;
            return;
        }

        const maxVisible = 5;
        let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
        let endPage = Math.min(totalPages, startPage + maxVisible - 1);
        if (endPage - startPage < maxVisible - 1) {
            startPage = Math.max(1, endPage - maxVisible + 1);
        }

        let pageButtons = '';
        if (startPage > 1) {
            pageButtons += `<button class="support-page-btn" data-page="1">1</button>`;
            if (startPage > 2) pageButtons += `<span class="support-page-ellipsis">…</span>`;
        }
        for (let i = startPage; i <= endPage; i++) {
            pageButtons += `<button class="support-page-btn${i === currentPage ? ' active' : ''}" data-page="${i}">${i}</button>`;
        }
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) pageButtons += `<span class="support-page-ellipsis">…</span>`;
            pageButtons += `<button class="support-page-btn" data-page="${totalPages}">${totalPages}</button>`;
        }

        const startRecord = (currentPage - 1) * SESSIONS_PER_PAGE + 1;
        const endRecord = Math.min(currentPage * SESSIONS_PER_PAGE, totalRows);

        paginationContainer.innerHTML = `
            <div class="support-pagination-bar">
                <button class="support-page-nav" id="sp-prev" ${currentPage === 1 ? 'disabled' : ''}>
                    <i class="fas fa-chevron-right"></i> السابق
                </button>
                <div class="support-page-numbers">${pageButtons}</div>
                <button class="support-page-nav" id="sp-next" ${currentPage === totalPages ? 'disabled' : ''}>
                    التالي <i class="fas fa-chevron-left"></i>
                </button>
            </div>
            <div class="support-pagination-info">
                <span><i class="fas fa-eye"></i> ${startRecord}–${endRecord} من ${totalRows}</span>
                <span><i class="fas fa-file-alt"></i> صفحة ${currentPage} / ${totalPages}</span>
            </div>
        `;
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
            const result = ensureIpcSuccess(await window.api.supportSessions.list(filters), 'تعذر تحميل حصص الدعم');
            sessions = Array.isArray(result) ? result : [];
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

        highlightInvalidFields(payload);
        const missingFields = getMissingRequiredFields(payload);
        if (missingFields.length) {
            showToast(`أكمل هذه البيانات قبل التسجيل: ${missingFields.join('، ')}`, 'error');
            return;
        }

        if (!calcDuration(payload.time_from, payload.time_to)) {
            showToast('وقت النهاية يجب أن يكون بعد وقت البداية حتى نحسب مدة الحصة بشكل صحيح.', 'error');
            return;
        }

        const daysDiff = Math.floor((new Date(payload.session_date) - new Date(getTodayValue())) / 86400000);
        if (daysDiff > 7 && !confirm('التاريخ المختار بعيد عن اليوم بأكثر من أسبوع. هل تريد المتابعة؟')) {
            return;
        }

        try {
            setActionBusy(addSessionButton, true, 'جارٍ تسجيل الحصة...', '<i class="fas fa-save"></i> تسجيل الحصة');
            ensureIpcSuccess(await window.api.supportSessions.add(payload), 'تعذر تسجيل حصة الدعم');
            lastSessionDraft = { ...payload };
            try { sessionStorage.setItem('support_lastDraft', JSON.stringify(lastSessionDraft)); } catch (_e) { /* ignore */ }
            repeatLastButton.disabled = false;
            showToast('تم تسجيل حصة الدعم وتحديث الجدول أدناه.', 'success');
            resetEntryForm();
            formSubject.focus();
            currentPage = 1;
            await Promise.all([loadStats(), loadSessions()]);
        } catch (error) {
            console.error('[support-sessions] add failed:', error);
            showToast(getFriendlyErrorMessage('تعذر تسجيل حصة الدعم', error), 'error');
        } finally {
            setActionBusy(addSessionButton, false, '', '<i class="fas fa-save"></i> تسجيل الحصة');
        }
    });

    filterButton.addEventListener('click', () => {
        currentPage = 1;
        loadSessions({ showLoadingState: true });
    });

    clearFiltersButton.addEventListener('click', async () => {
        clearFilters();
        currentPage = 1;
        await loadSessions({ showLoadingState: true });
        showToast('تم مسح عوامل البحث وعرض جميع الحصص.', 'success');
    });

    if (paginationContainer) {
        paginationContainer.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-page]');
            if (btn) {
                const page = Number(btn.dataset.page);
                if (!isNaN(page) && page !== currentPage) {
                    currentPage = page;
                    renderTable(sessions);
                    tbody.closest('.table-responsive')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                return;
            }
            if (event.target.closest('#sp-prev')) {
                if (currentPage > 1) { currentPage--; renderTable(sessions); tbody.closest('.table-responsive')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
            } else if (event.target.closest('#sp-next')) {
                const totalPages = Math.ceil(sessions.length / SESSIONS_PER_PAGE) || 1;
                if (currentPage < totalPages) { currentPage++; renderTable(sessions); tbody.closest('.table-responsive')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
            }
        });
    }

    repeatLastButton.addEventListener('click', () => {
        if (!lastSessionDraft) return;
        applyDraftToForm(lastSessionDraft);
        formSubject.focus();
        showToast('تم تجهيز بيانات آخر حصة. راجعها ثم سجلها من جديد إذا لزم الأمر.', 'info');
    });

    resetFormButton.addEventListener('click', () => {
        resetEntryForm();
        formSubject.focus();
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
            ensureIpcSuccess(await window.api.supportSessions.delete(Number(button.dataset.delete)), 'تعذر حذف حصة الدعم');
            showToast('تم حذف حصة الدعم من السجل.', 'success');
            await Promise.all([loadStats(), loadSessions()]);
        } catch (error) {
            console.error('[support-sessions] delete failed:', error);
            showToast(getFriendlyErrorMessage('تعذر حذف الحصة', error), 'error');
        } finally {
            setActionBusy(button, false, '', '<i class="fas fa-trash"></i>');
        }
    });

    exportButton.addEventListener('click', async () => {
        try {
            setActionBusy(exportButton, true, 'جارٍ تجهيز الملف...', '<i class="fas fa-file-export"></i> تصدير JSON');
            const data = ensureIpcSuccess(await window.api.supportSessions.export(schoolYear), 'تعذر تصدير حصص الدعم');
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `حصص-الدعم-${schoolYear}.json`;
            anchor.click();
            URL.revokeObjectURL(url);
            showToast('تم تجهيز ملف التصدير. إذا لم يبدأ التنزيل تلقائيا، تحقق من إعدادات المتصفح.', 'success');
        } catch (error) {
            console.error('[support-sessions] export failed:', error);
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
            const result = ensureIpcSuccess(await window.api.supportSessions.import(payload), 'تعذر استيراد ملف حصص الدعم');
            showToast(
                `اكتمل الاستيراد: تمت إضافة ${result.imported} حصة جديدة وتجاوز ${result.skipped} حصة مكررة.`,
                'success'
            );
            await Promise.all([loadStats(), loadSessions()]);
        } catch (error) {
            console.error('[support-sessions] import failed:', error);
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

    try {
        await loadTeachers();
        loadSubjects();
        await loadSections();
        await Promise.all([loadStats(), loadSessions()]);

        formDate.value = getTodayValue();
        if (lastSessionDraft) repeatLastButton.disabled = false;
        formSubject.focus();
    } catch (error) {
        console.error('[support-sessions] init failed:', error);
        formDate.value = getTodayValue();
        showToast(getFriendlyErrorMessage('تعذر تهيئة صفحة حصص الدعم', error), 'error');
    }
})();
