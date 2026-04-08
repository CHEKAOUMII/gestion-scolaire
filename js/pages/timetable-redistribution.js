(function () {
    'use strict';

    const BACKUP_STORAGE_KEY = 'gsl_timetable_redistribution_backup_v1';
    const EMPTY_RESULTS_HTML = `
        <tr>
            <td colspan="8">
                <div class="page-empty-state">
                    <i class="fas fa-random"></i>
                    <h4>لا توجد نتائج مطابقة</h4>
                    <p>غيّر معايير البحث أو تأكد من أن استعمال الزمن محمّل ومطابق للمادة المختارة.</p>
                </div>
            </td>
        </tr>`;

    const PAGE_SIZE = 20;

    const state = {
        schoolYear: '',
        timetableData: null,
        teacherRows: [],
        teacherById: new Map(),
        rows: [],
        filteredRows: [],
        currentPage: 1,
        pendingAssignments: new Map(),
        lastAppliedFilters: { level: '', subject: '', teacherName: '' },
        initialSnapshot: ''
    };

    const els = {
        levelSelect: document.getElementById('level-select'),
        subjectSelect: document.getElementById('subject-select'),
        teacherFilterSelect: document.getElementById('teacher-filter-select'),
        searchBtn: document.getElementById('search-btn'),
        printBtn: document.getElementById('print-btn'),
        saveBtn: document.getElementById('save-btn'),
        resetBtn: document.getElementById('reset-btn'),
        syncGradesCheckbox: document.getElementById('sync-grades-checkbox'),
        resultsTbody: document.getElementById('results-tbody'),
        searchResultBadge: document.getElementById('search-result-badge'),
        resultsHint: document.getElementById('results-hint'),
        sectionsCount: document.getElementById('sections-count'),
        slotsCount: document.getElementById('slots-count'),
        pendingCount: document.getElementById('pending-count'),
        printDate: document.getElementById('print-date'),
        printFilters: document.getElementById('print-filters')
    };

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        state.schoolYear = typeof getSchoolYear === 'function' ? getSchoolYear() : '2025/2026';
        bindEvents();
        updatePrintHeader();
        await loadInitialData();
        applyFilters();
    }

    function bindEvents() {
        els.searchBtn?.addEventListener('click', applyFilters);
        els.printBtn?.addEventListener('click', () => window.print());
        els.resetBtn?.addEventListener('click', resetPendingAssignments);
        els.saveBtn?.addEventListener('click', saveChanges);

        els.levelSelect?.addEventListener('change', () => {
            populateTeacherFilterSelect();
            updatePrintHeader();
        });

        els.subjectSelect?.addEventListener('change', () => {
            populateTeacherFilterSelect();
            updatePrintHeader();
        });

        els.teacherFilterSelect?.addEventListener('change', updatePrintHeader);

        els.resultsTbody?.addEventListener('change', (event) => {
            const select = event.target.closest('.teacher-select');
            if (!select) return;
            const rowKey = select.dataset.rowKey;
            const teacherId = Number(select.value) || null;
            const row = state.rows.find((entry) => entry.key === rowKey);
            if (!rowKey || !teacherId || (row?.primaryTeacherId && Number(row.primaryTeacherId) === teacherId)) {
                state.pendingAssignments.delete(rowKey);
            } else {
                state.pendingAssignments.set(rowKey, teacherId);
            }
            renderResults();
        });
    }

    async function loadInitialData() {
        try {
            const [teachers, timetableData] = await Promise.all([
                window.api?.teachers?.getAll?.(state.schoolYear).catch(() => []),
                readTimetableData()
            ]);

            state.teacherRows = Array.isArray(teachers) ? teachers : [];
            state.teacherById = new Map(
                state.teacherRows.map((teacher) => [Number(teacher.id), teacher]).filter(([id]) => Boolean(id))
            );
            state.timetableData = timetableData;
            state.initialSnapshot = JSON.stringify(state.timetableData || {});

            if (!state.timetableData || !state.timetableData.timetables) {
                renderNoTimetableState();
                return;
            }

            state.rows = buildRowsFromTimetable(state.timetableData);
            populateFilters();
            renderResults();
        } catch (error) {
            console.error('Failed to initialize redistribution page:', error);
            showToast('تعذر تحميل بيانات إعادة التوزيع', 'error');
            renderNoTimetableState();
        }
    }

    async function readTimetableData() {
        try {
            const schoolYear = state.schoolYear || (typeof getSchoolYear === 'function' ? getSchoolYear() : '');
            return await window.api?.timetable?.get?.(schoolYear) || null;
        } catch (error) {
            console.error('Failed to read timetable data:', error);
            return null;
        }
    }

    function renderNoTimetableState() {
        state.rows = [];
        state.filteredRows = [];
        els.resultsTbody.innerHTML = `
            <tr>
                <td colspan="8">
                    <div class="page-empty-state">
                        <i class="fas fa-file-import"></i>
                        <h4>لم يتم العثور على استعمال الزمن</h4>
                        <p>يرجى استيراد أو تعديل الجداول أولاً من صفحة الاستيراد أو صفحة جدول الحصص.</p>
                        <a href="settings-imports.html" class="btn btn-primary" style="display:inline-block;margin-top:12px;">
                            <i class="fas fa-upload"></i> الانتقال إلى الاستيراد
                        </a>
                    </div>
                </td>
            </tr>`;
        updateCounters();
    }

    function buildRowsFromTimetable(data) {
        const grouped = new Map();
        const teacherMetaByKey = data?.teacherMetaByKey || {};

        Object.entries(data?.timetables || {}).forEach(([teacherKey, timetable]) => {
            const teacherMeta = getTeacherMetaByKey(teacherKey, teacherMetaByKey);
            Object.entries(timetable || {}).forEach(([day, dayData]) => {
                ['morning', 'afternoon'].forEach((periodType) => {
                    Object.entries(dayData?.[periodType] || {}).forEach(([hour, lesson]) => {
                        const baseSection = getBaseSectionName(lesson?.students || '');
                        const subject = normalizeSubject(lesson?.subject || '');
                        if (!baseSection || !subject) return;

                        const rowKey = `${baseSection}__${subject}`;
                        if (!grouped.has(rowKey)) {
                            grouped.set(rowKey, {
                                key: rowKey,
                                level: getLevelLabel(baseSection),
                                section: baseSection,
                                subject,
                                currentTeacherNames: new Set(),
                                currentTeacherIds: new Set(),
                                currentTeacherKeys: new Set(),
                                slots: []
                            });
                        }

                        const entry = grouped.get(rowKey);
                        entry.currentTeacherNames.add(teacherMeta.displayName);
                        if (teacherMeta.teacherId) entry.currentTeacherIds.add(Number(teacherMeta.teacherId));
                        entry.currentTeacherKeys.add(teacherKey);
                        entry.slots.push({
                            teacherKey,
                            teacherId: teacherMeta.teacherId || null,
                            teacherName: teacherMeta.displayName,
                            day,
                            periodType,
                            hour,
                            lesson: {
                                subject: lesson?.subject || '',
                                students: lesson?.students || '',
                                room: lesson?.room || ''
                            }
                        });
                    });
                });
            });
        });

        const rows = Array.from(grouped.values()).map((entry) => {
            const teacherNameList = Array.from(entry.currentTeacherNames).sort((a, b) => a.localeCompare(b, 'ar'));
            const teacherIdList = Array.from(entry.currentTeacherIds);
            const slotSummary = Array.from(
                new Set(entry.slots.map((slot) => `${slot.day} ${formatSlotLabel(slot.periodType, slot.hour)}`))
            );
            return {
                key: entry.key,
                level: entry.level,
                section: entry.section,
                subject: entry.subject,
                currentTeacherLabel: teacherNameList.join(' + '),
                currentTeacherNames: teacherNameList,
                currentTeacherIds: teacherIdList,
                currentTeacherKeys: Array.from(entry.currentTeacherKeys),
                primaryTeacherId: teacherIdList.length === 1 ? teacherIdList[0] : null,
                primaryTeacherName: teacherNameList.length === 1 ? teacherNameList[0] : '',
                slotCount: entry.slots.length,
                slotSummary,
                slots: entry.slots.sort(compareSlots)
            };
        });

        const sortedSections =
            typeof sortSectionNames === 'function'
                ? sortSectionNames(rows.map((row) => row.section))
                : rows.map((row) => row.section).sort(sortArabic);
        const sectionRank = new Map(sortedSections.map((section, index) => [section, index]));

        return rows.sort((a, b) => {
            const subjectDiff = String(a.subject).localeCompare(String(b.subject), 'ar');
            if (subjectDiff !== 0) return subjectDiff;
            return Number(sectionRank.get(a.section) || 0) - Number(sectionRank.get(b.section) || 0);
        });
    }

    function populateFilters() {
        const levelNames = uniqueSorted(
            state.rows.map((row) => row.level),
            sortArabic
        );
        const rawSubjects = state.rows.map((row) => row.subject).filter(Boolean);
        const subjects =
            typeof buildSubjectOptionsFromSet === 'function'
                ? buildSubjectOptionsFromSet(rawSubjects)
                : uniqueSorted(rawSubjects, typeof compareSubjects === 'function' ? compareSubjects : sortArabic);

        fillSelect(els.levelSelect, levelNames, 'كل المستويات');
        fillSelect(els.subjectSelect, subjects, 'كل المواد');
        populateTeacherFilterSelect();
    }

    function populateTeacherFilterSelect() {
        const selectedLevel = els.levelSelect?.value || '';
        const selectedSubject = els.subjectSelect?.value || '';

        const teacherNames = uniqueSorted(
            state.rows
                .filter((row) => {
                    if (selectedLevel && row.level !== selectedLevel) return false;
                    if (selectedSubject && row.subject !== selectedSubject) return false;
                    return true;
                })
                .flatMap((row) => row.currentTeacherNames || []),
            sortArabic
        );

        fillSelect(els.teacherFilterSelect, teacherNames, 'الكل');
    }

    function fillSelect(select, values, defaultLabel) {
        if (!select) return;
        const previous = select.value;
        select.innerHTML = `<option value="">${escapeHtml(defaultLabel)}</option>`;
        values.forEach((value) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            select.appendChild(option);
        });
        if (previous && values.includes(previous)) {
            select.value = previous;
        }
    }

    function applyFilters() {
        state.lastAppliedFilters = {
            level: els.levelSelect?.value || '',
            subject: els.subjectSelect?.value || '',
            teacherName: els.teacherFilterSelect?.value || ''
        };

        state.filteredRows = state.rows.filter((row) => {
            if (state.lastAppliedFilters.level && row.level !== state.lastAppliedFilters.level) return false;
            if (state.lastAppliedFilters.subject && row.subject !== state.lastAppliedFilters.subject) return false;
            if (
                state.lastAppliedFilters.teacherName &&
                !row.currentTeacherNames.includes(state.lastAppliedFilters.teacherName)
            ) {
                return false;
            }
            return true;
        });

        state.currentPage = 1;
        renderResults();
        updatePrintHeader();
    }

    function renderResults() {
        if (!els.resultsTbody) return;

        if (!state.filteredRows.length) {
            els.resultsTbody.innerHTML = state.rows.length ? EMPTY_RESULTS_HTML : els.resultsTbody.innerHTML;
            els.resultsHint.textContent = state.rows.length
                ? 'لا توجد أقسام مطابقة للفلاتر الحالية.'
                : 'اختر مستوى ومادة ثم اضغط بحث.';
            renderPagination();
            updateCounters();
            return;
        }

        const totalPages = Math.ceil(state.filteredRows.length / PAGE_SIZE);
        state.currentPage = Math.min(Math.max(1, state.currentPage), totalPages);
        const startIndex = (state.currentPage - 1) * PAGE_SIZE;
        const pageRows = state.filteredRows.slice(startIndex, startIndex + PAGE_SIZE);

        els.resultsTbody.innerHTML = pageRows
            .map((row, index) => {
                const globalIndex = startIndex + index;
                const pendingTeacherId = Number(state.pendingAssignments.get(row.key)) || null;
                const rowDirty = Boolean(pendingTeacherId);
                const currentPills = row.currentTeacherNames
                    .map((name) => `<span class="teacher-pill"><i class="fas fa-user"></i>${escapeHtml(name)}</span>`)
                    .join('');
                const slotList = row.slotSummary
                    .map((slot) => `<span class="slot-chip"><i class="fas fa-clock"></i>${escapeHtml(slot)}</span>`)
                    .join('');

                return `
                    <tr class="${rowDirty ? 'row-dirty' : ''}">
                        <td>${globalIndex + 1}</td>
                        <td>${escapeHtml(row.level)}</td>
                        <td><strong>${escapeHtml(row.section)}</strong></td>
                        <td><div class="teacher-pill-list">${currentPills}</div></td>
                        <td>${renderTeacherSelect(row, pendingTeacherId)}</td>
                        <td>
                            <div><strong>${row.slotCount}</strong> حصة</div>
                            <div class="muted-note">${escapeHtml(row.subject)}</div>
                        </td>
                        <td><div class="slot-list">${slotList}</div></td>
                        <td>
                            <span class="row-status ${rowDirty ? 'pending' : 'saved'}">
                                <i class="fas ${rowDirty ? 'fa-hourglass-half' : 'fa-check-circle'}"></i>
                                ${rowDirty ? 'تعديل معلق' : 'مطابق'}
                            </span>
                        </td>
                    </tr>`;
            })
            .join('');

        els.resultsHint.textContent = 'يمكنك تغيير الأستاذ الجديد لكل قسم ثم حفظ كل التعديلات دفعة واحدة.';
        renderPagination();
        updateCounters();
    }

    function renderPagination() {
        let container = document.getElementById('pagination-bar');
        if (!container) {
            container = document.createElement('div');
            container.id = 'pagination-bar';
            container.className = 'pagination-bar';
            const tableWrapper = els.resultsTbody?.closest('.table-responsive');
            if (tableWrapper) tableWrapper.after(container);
        }

        const total = state.filteredRows.length;
        const totalPages = Math.ceil(total / PAGE_SIZE);

        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }

        const page = state.currentPage;
        const start = (page - 1) * PAGE_SIZE + 1;
        const end = Math.min(page * PAGE_SIZE, total);

        const makeBtn = (label, targetPage, disabled, active = false) => {
            const cls = ['pagination-btn', active ? 'active' : '', disabled ? 'disabled' : ''].filter(Boolean).join(' ');
            return `<button class="${cls}" data-page="${targetPage}" ${disabled ? 'disabled' : ''}>${label}</button>`;
        };

        let pages = '';
        const delta = 2;
        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || i === totalPages || (i >= page - delta && i <= page + delta)) {
                pages += makeBtn(i, i, false, i === page);
            } else if (i === page - delta - 1 || i === page + delta + 1) {
                pages += `<span class="pagination-ellipsis">…</span>`;
            }
        }

        container.innerHTML = `
            <div class="pagination-info">صفحة ${page} من ${totalPages} · عرض ${start}–${end} من ${total}</div>
            <div class="pagination-controls">
                ${makeBtn('<i class="fas fa-angle-double-right"></i>', 1, page === 1)}
                ${makeBtn('<i class="fas fa-angle-right"></i>', page - 1, page === 1)}
                ${pages}
                ${makeBtn('<i class="fas fa-angle-left"></i>', page + 1, page === totalPages)}
                ${makeBtn('<i class="fas fa-angle-double-left"></i>', totalPages, page === totalPages)}
            </div>`;

        container.querySelectorAll('.pagination-btn:not([disabled])').forEach((btn) => {
            btn.addEventListener('click', () => {
                state.currentPage = Number(btn.dataset.page);
                renderResults();
                els.resultsTbody?.closest('.students-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
    }

    function renderTeacherSelect(row, selectedTeacherId) {
        const grouped = groupTeachersForSubject(row.subject);
        let options = '<option value="">-- اختر الأستاذ الجديد --</option>';

        grouped.forEach((group) => {
            options += `<optgroup label="${escapeHtml(group.label)}">`;
            group.items.forEach((teacher) => {
                const isSelected = selectedTeacherId === Number(teacher.id) ? 'selected' : '';
                const sameTeacherHint = row.currentTeacherIds.includes(Number(teacher.id)) ? ' (حالي)' : '';
                options += `<option value="${teacher.id}" ${isSelected}>${escapeHtml(
                    teacher.full_name || ''
                )}${escapeHtml(sameTeacherHint)}</option>`;
            });
            options += '</optgroup>';
        });

        return `<select class="teacher-select" data-row-key="${escapeHtml(row.key)}">${options}</select>`;
    }

    function groupTeachersForSubject(subject) {
        const targetSubject = normalizeSubject(subject);
        const filterSubject = normalizeSubject(state.lastAppliedFilters.subject || '');
        const onlyMatchingSubject = Boolean(filterSubject);
        const matching = [];
        const subjectBuckets = new Map();
        const noSubject = [];

        state.teacherRows.forEach((teacher) => {
            const teacherSubject = normalizeSubject(teacher.specialty_subject || teacher.subject || '');
            if (teacherSubject && teacherSubject === targetSubject) {
                matching.push(teacher);
            } else if (!onlyMatchingSubject) {
                if (teacherSubject) {
                    if (!subjectBuckets.has(teacherSubject)) {
                        subjectBuckets.set(teacherSubject, []);
                    }
                    subjectBuckets.get(teacherSubject).push(teacher);
                } else {
                    noSubject.push(teacher);
                }
            }
        });

        const sorter = (a, b) => String(a.full_name || '').localeCompare(String(b.full_name || ''), 'ar');
        matching.sort(sorter);

        const groups = [];
        if (matching.length) groups.push({ label: `نفس المادة: ${subject}`, items: matching });

        if (!onlyMatchingSubject) {
            noSubject.sort(sorter);

            const sortedSubjects = Array.from(subjectBuckets.keys()).sort(
                typeof compareSubjects === 'function' ? compareSubjects : sortArabic
            );

            sortedSubjects.forEach((subjectName) => {
                const teachers = subjectBuckets.get(subjectName) || [];
                teachers.sort(sorter);
                groups.push({ label: subjectName, items: teachers });
            });

            if (noSubject.length) groups.push({ label: 'بدون مادة محددة', items: noSubject });
        }

        return groups;
    }

    function updateCounters() {
        const displayedRows = state.filteredRows.length;
        const displayedSlots = state.filteredRows.reduce((sum, row) => sum + Number(row.slotCount || 0), 0);
        const pendingCount = state.pendingAssignments.size;

        if (els.sectionsCount) els.sectionsCount.textContent = String(displayedRows);
        if (els.slotsCount) els.slotsCount.textContent = String(displayedSlots);
        if (els.pendingCount) els.pendingCount.textContent = String(pendingCount);
        if (els.searchResultBadge) {
            els.searchResultBadge.innerHTML = `<i class="fas fa-layer-group"></i> ${displayedRows} صف`;
        }
    }

    function resetPendingAssignments() {
        if (!state.pendingAssignments.size) {
            showToast('لا توجد تعديلات معلقة', 'info');
            return;
        }
        state.pendingAssignments.clear();
        renderResults();
        showToast('تم إلغاء التعديلات المعلقة', 'info');
    }

    async function saveChanges() {
        if (!state.pendingAssignments.size) {
            showToast('لا توجد تغييرات لحفظها', 'info');
            return;
        }

        if (!state.timetableData || !state.timetableData.timetables) {
            showToast('لم يتم العثور على بيانات الجدول الزمني', 'error');
            return;
        }

        const draft = JSON.parse(JSON.stringify(state.timetableData));
        const pendingRows = state.rows.filter((row) => state.pendingAssignments.has(row.key));
        const conflicts = [];
        const gradeSyncChanges = [];

        try {
            for (const row of pendingRows) {
                const targetTeacherId = Number(state.pendingAssignments.get(row.key)) || null;
                const targetTeacher = state.teacherById.get(targetTeacherId);
                if (!targetTeacher) {
                    conflicts.push(`تعذر العثور على الأستاذ المختار للقسم ${row.section}`);
                    continue;
                }

                const targetTeacherKey = ensureTeacherKey(draft, targetTeacher);
                const rowConflicts = validateRowMove(draft, row, targetTeacherKey, targetTeacher.full_name || '');
                if (rowConflicts.length) {
                    conflicts.push(...rowConflicts);
                    continue;
                }

                applyRowMove(draft, row, targetTeacherKey);
                gradeSyncChanges.push({
                    section: row.section,
                    subject: row.subject,
                    from_teacher_id: row.primaryTeacherId || null,
                    from_teacher_name: row.primaryTeacherName || '',
                    to_teacher_id: Number(targetTeacher.id) || null,
                    to_teacher_name: String(targetTeacher.full_name || '').trim()
                });
            }

            if (conflicts.length) {
                showToast(conflicts[0], 'error', 7000);
                return;
            }

            localStorage.setItem(
                BACKUP_STORAGE_KEY,
                JSON.stringify({
                    savedAt: new Date().toISOString(),
                    schoolYear: state.schoolYear,
                    timetableData: state.timetableData
                })
            );

            rebuildCatalogs(draft);
            const schoolYear = state.schoolYear || (typeof getSchoolYear === 'function' ? getSchoolYear() : '');
            await window.api?.timetable?.save?.({ school_year: schoolYear, data: draft });

            state.timetableData = draft;
            state.initialSnapshot = JSON.stringify(draft);
            state.pendingAssignments.clear();
            state.rows = buildRowsFromTimetable(draft);
            populateFilters();
            applyFilters();

            let syncedGradesCount = 0;
            let gradeSyncWarning = '';
            if (els.syncGradesCheckbox?.checked && gradeSyncChanges.length) {
                const response = await window.api?.grades?.reassignTeacherBulk?.({
                    school_year: state.schoolYear,
                    changes: gradeSyncChanges
                });
                if (!response || response.success === false) {
                    gradeSyncWarning = response?.error || 'فشلت مزامنة بيانات النقط';
                } else {
                    syncedGradesCount = Number(response.count || 0);
                }
            }

            if (gradeSyncWarning) {
                showToast(`تم حفظ إعادة التوزيع، لكن تعذر تحديث بيانات النقط: ${gradeSyncWarning}`, 'warning', 7000);
                return;
            }

            const saveMessage = syncedGradesCount
                ? `تم حفظ التوزيع وتحيين ${syncedGradesCount} سطر من بيانات النقط`
                : 'تم حفظ إعادة التوزيع بنجاح';
            showToast(saveMessage, 'success');
        } catch (error) {
            console.error('Failed to save redistribution changes:', error);
            showToast(error.message || 'تعذر حفظ التعديلات', 'error');
        }
    }

    function validateRowMove(draft, row, targetTeacherKey, targetTeacherName) {
        const messages = [];

        row.slots.forEach((slot) => {
            if (slot.teacherKey === targetTeacherKey) return;

            const existing = draft.timetables?.[targetTeacherKey]?.[slot.day]?.[slot.periodType]?.[slot.hour];
            if (existing) {
                messages.push(
                    `تعارض: الأستاذ ${targetTeacherName} مشغول يوم ${slot.day} في ${formatSlotLabel(
                        slot.periodType,
                        slot.hour
                    )}`
                );
            }
        });

        return messages;
    }

    function applyRowMove(draft, row, targetTeacherKey) {
        row.slots.forEach((slot) => {
            ensureTeacherDayStructure(draft, targetTeacherKey, slot.day);

            if (slot.teacherKey !== targetTeacherKey) {
                if (draft.timetables?.[slot.teacherKey]?.[slot.day]?.[slot.periodType]) {
                    delete draft.timetables[slot.teacherKey][slot.day][slot.periodType][slot.hour];
                }
            }

            draft.timetables[targetTeacherKey][slot.day][slot.periodType][slot.hour] = {
                subject: slot.lesson.subject,
                students: slot.lesson.students,
                room: slot.lesson.room
            };
        });
    }

    function ensureTeacherKey(draft, teacher) {
        draft.teacherMetaByKey = draft.teacherMetaByKey || {};
        draft.timetables = draft.timetables || {};

        const existingKey = Object.keys(draft.teacherMetaByKey).find(
            (key) => Number(draft.teacherMetaByKey[key]?.teacherId) === Number(teacher.id)
        );
        if (existingKey) {
            draft.timetables[existingKey] = draft.timetables[existingKey] || {};
            return existingKey;
        }

        const teacherKey = `dbteacher:${teacher.id}`;
        draft.teacherMetaByKey[teacherKey] = {
            key: teacherKey,
            name: teacherKey,
            displayName: String(teacher.full_name || '').trim(),
            sourceName: String(teacher.full_name || '').trim(),
            sourceDisplayName: String(teacher.full_name || '').trim(),
            matchStatus: 'manual',
            teacherId: Number(teacher.id) || null,
            teacherName: String(teacher.full_name || '').trim(),
            candidateTeacherIds: []
        };
        draft.timetables[teacherKey] = draft.timetables[teacherKey] || {};
        return teacherKey;
    }

    function ensureTeacherDayStructure(draft, teacherKey, day) {
        draft.timetables = draft.timetables || {};
        draft.timetables[teacherKey] = draft.timetables[teacherKey] || {};
        draft.timetables[teacherKey][day] = draft.timetables[teacherKey][day] || { morning: {}, afternoon: {} };
        draft.timetables[teacherKey][day].morning = draft.timetables[teacherKey][day].morning || {};
        draft.timetables[teacherKey][day].afternoon = draft.timetables[teacherKey][day].afternoon || {};
    }

    function rebuildCatalogs(draft) {
        draft.teacherMetaByKey = draft.teacherMetaByKey || {};
        const subjects = new Set();
        const classes = new Set();

        Object.entries(draft.timetables || {}).forEach(([teacherKey, timetable]) => {
            if (!draft.teacherMetaByKey[teacherKey]) {
                draft.teacherMetaByKey[teacherKey] = {
                    key: teacherKey,
                    name: teacherKey,
                    displayName: teacherKey,
                    sourceName: teacherKey,
                    sourceDisplayName: teacherKey,
                    matchStatus: 'matched',
                    teacherId: null,
                    teacherName: teacherKey,
                    candidateTeacherIds: []
                };
            }

            Object.values(timetable || {}).forEach((dayData) => {
                ['morning', 'afternoon'].forEach((periodType) => {
                    Object.values(dayData?.[periodType] || {}).forEach((lesson) => {
                        const subject = normalizeSubject(lesson?.subject || '');
                        const section = getBaseSectionName(lesson?.students || '');
                        if (subject) subjects.add(subject);
                        if (section) classes.add(section);
                    });
                });
            });
        });

        draft.subjects = Array.from(subjects).sort(
            typeof compareSubjects === 'function' ? compareSubjects : sortArabic
        );
        draft.classes =
            typeof sortSectionNames === 'function'
                ? sortSectionNames(Array.from(classes))
                : Array.from(classes).sort(sortArabic);
        draft.teachers = Object.values(draft.teacherMetaByKey).sort((a, b) =>
            String(a.displayName || '').localeCompare(String(b.displayName || ''), 'ar')
        );
        draft.unresolvedTeacherKeys = Array.isArray(draft.unresolvedTeacherKeys) ? draft.unresolvedTeacherKeys : [];
    }

    function updatePrintHeader() {
        if (els.printDate) {
            els.printDate.textContent = `تاريخ الطباعة: ${new Date().toLocaleDateString('ar-MA', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            })}`;
        }

        const filters = [];
        if (els.levelSelect?.value) filters.push(`المستوى: ${els.levelSelect.value}`);
        if (els.subjectSelect?.value) filters.push(`المادة: ${els.subjectSelect.value}`);
        if (els.teacherFilterSelect?.value) filters.push(`الأستاذ الحالي: ${els.teacherFilterSelect.value}`);
        els.printFilters.textContent = filters.length ? filters.join(' | ') : 'بدون فلاتر';
    }

    function getTeacherMetaByKey(teacherKey, teacherMetaByKey) {
        const meta = teacherMetaByKey?.[teacherKey] || {};
        return {
            key: teacherKey,
            teacherId: Number(meta.teacherId) || null,
            displayName: String(meta.displayName || meta.teacherName || teacherKey).trim()
        };
    }

    function getBaseSectionName(value) {
        if (!value) return '';
        return String(value)
            .replace(/:[Gg]\d+$/g, '')
            .trim();
    }

    function normalizeSubject(value) {
        return typeof normalizeSubjectName === 'function' ? normalizeSubjectName(value) : String(value || '').trim();
    }

    function getLevelLabel(section) {
        return typeof getLevelNameFromSection === 'function' ? getLevelNameFromSection(section) : String(section || '');
    }

    function formatSlotLabel(periodType, hour) {
        const labels = {
            morning: { H1: '08:30-09:30', H2: '09:30-10:30', H3: '10:30-11:30', H4: '11:30-12:30' },
            afternoon: { H1: '14:30-15:30', H2: '15:30-16:30', H3: '16:30-17:30', H4: '17:30-18:30' }
        };
        return labels?.[periodType]?.[hour] || `${periodType}:${hour}`;
    }

    function compareSlots(a, b) {
        const dayOrder = ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];
        const aDay = dayOrder.indexOf(a.day);
        const bDay = dayOrder.indexOf(b.day);
        if (aDay !== bDay) return aDay - bDay;
        if (a.periodType !== b.periodType) return a.periodType.localeCompare(b.periodType, 'ar');
        return String(a.hour).localeCompare(String(b.hour), undefined, { numeric: true, sensitivity: 'base' });
    }

    function uniqueSorted(values, sorter) {
        return Array.from(new Set(values.filter(Boolean))).sort(sorter);
    }

    function sortArabic(a, b) {
        return String(a || '').localeCompare(String(b || ''), 'ar');
    }

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
})();
