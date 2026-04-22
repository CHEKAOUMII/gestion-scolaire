/**
 * staff-attendance.js – Page logic for الحضور والغياب
 * Requires: js/shared/timetable-utils.js (loaded before this script)
 */
(function () {
    'use strict';

    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function todayStr() {
        const d = new Date();
        return (
            d.getFullYear() +
            '-' +
            String(d.getMonth() + 1).padStart(2, '0') +
            '-' +
            String(d.getDate()).padStart(2, '0')
        );
    }

    /** Convert YYYY-MM-DD to dd/mm/yyyy */
    function formatDate(dateStr) {
        if (!dateStr) return '—';
        const parts = dateStr.split('-');
        if (parts.length !== 3) return dateStr;
        return parts[2] + '/' + parts[1] + '/' + parts[0];
    }

    const year = typeof getSchoolYear === 'function' ? getSchoolYear() : '2025/2026';
    const MEDICAL_CERTIFICATE_REASON = '\u0634\u0647\u0627\u062f\u0629 \u0637\u0628\u064a\u0629';

    function formatArabicDayCount(count) {
        if (count <= 1) return '\u064a\u0648\u0645 \u0648\u0627\u062d\u062f';
        if (count === 2) return '\u064a\u0648\u0645\u0627\u0646';
        if (count >= 3 && count <= 10) return `${count} \u0623\u064a\u0627\u0645`;
        return `${count} \u064a\u0648\u0645\u064b\u0627`;
    }

    function enumerateDateRange(startDate, endDate) {
        const start = new Date(`${startDate}T00:00:00`);
        const end = new Date(`${endDate}T00:00:00`);
        const dates = [];
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return dates;

        for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
            dates.push(
                `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
            );
        }
        return dates;
    }

    let _timetableCache = null;
    let _timetableCacheLoaded = false;
    const scheduleForDayCache = new Map();
    const sectionsForDayCache = new Map();
    const teacherSectionsByDate = new Map();

    function invalidateTimetableCache() {
        _timetableCache = null;
        _timetableCacheLoaded = false;
        scheduleForDayCache.clear();
        sectionsForDayCache.clear();
    }

    function makeTeacherDayCacheKey(teacherId, teacherName, dateStr, absencePeriod) {
        return [
            teacherId ? `id:${teacherId}` : `name:${String(teacherName || '').trim()}`,
            dateStr || '',
            absencePeriod || 'full_day'
        ].join('|');
    }

    async function getTimetableData() {
        if (_timetableCacheLoaded) return _timetableCache;
        try {
            const schoolYear = typeof getSchoolYear === 'function' ? getSchoolYear() : '2025/2026';
            _timetableCache = await window.api.timetable.get(schoolYear);
        } catch {
            _timetableCache = null;
        }
        _timetableCacheLoaded = true;
        return _timetableCache;
    }

    let allRecords = [];
    let teachersList = [];
    let teacherNameCounts = new Map();
    let attCurrentPage = 1;
    const ATT_PER_PAGE = 20;
    let filterTeachers = async () => {};
    let _saveRecordInFlight = false;

    function makeTeacherOptionValue(teacher) {
        if (teacher?.id) return String(teacher.id);
        const teacherName = String(teacher?.full_name || '').trim();
        const subject = String(teacher?.subject || '').trim();
        return `name:${teacherName}|subject:${subject}`;
    }

    function setSaveUiBusy(isBusy) {
        const submitBtn = document.getElementById('att-submit-btn');
        const resetBtn = document.getElementById('reset-btn');
        const cancelBtn = document.getElementById('att-cancel-edit-btn');
        if (submitBtn) submitBtn.disabled = isBusy;
        if (resetBtn) resetBtn.disabled = isBusy;
        if (cancelBtn) cancelBtn.disabled = isBusy;
    }


    /** Check if a teacher has any hours in a specific period for a given day */
    async function teacherWorksInPeriod(teacherName, teacherId, dateStr, period) {
        if (!period || period === 'full_day') return true;
        try {
            const data = await getTimetableData();
            if (!data || !data.timetables) return true;

            const dayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
            const dateObj = new Date(dateStr + 'T00:00:00');
            const dayName = dayNames[dateObj.getDay()];

            const teacherKeys = ttResolveTeacherKeys(data, teacherId, teacherName);
            if (!teacherKeys.length) return true; // no match → don't filter out

            for (const teacherKey of teacherKeys) {
                const dayData = data.timetables?.[teacherKey]?.[dayName];
                if (!dayData) continue;
                const periodEntries = ttGetPeriodEntries(dayData, period);
                for (const [, hours] of periodEntries) {
                    if (!hours || typeof hours !== 'object') continue;
                    // If there are any lessons in this period, teacher works here
                    for (const lesson of Object.values(hours)) {
                        if (lesson && lesson.subject) return true;
                    }
                }
            }
            return false;
        } catch {
            return true;
        }
    }

    function isRangeModeEnabled() {
        return document.getElementById('att-type')?.value === 'absence';
    }

    function getEffectiveAttendanceDate() {
        return document.getElementById('date-from')?.value || todayStr();
    }

    function updateRangeUI() {
        const fromInput = document.getElementById('date-from');
        const toInput = document.getElementById('date-to');
        const sep = document.getElementById('date-sep');
        const toWrap = document.getElementById('date-to-wrap');
        const pill = document.getElementById('days-pill');
        const labelEl = document.getElementById('date-label');
        const isAbsence = isRangeModeEnabled();

        // Normalize: to must be >= from
        if (fromInput && toInput) {
            if (!toInput.value) toInput.value = fromInput.value;
            if (toInput.value < fromInput.value) toInput.value = fromInput.value;
        }

        // Determine if range is actually active (to > from)
        const hasRange = isAbsence && toInput && fromInput && toInput.value > fromInput.value;

        // Show/hide the sliding date-to container
        if (toWrap) toWrap.classList.toggle('open', isAbsence);
        if (sep) sep.classList.toggle('visible', isAbsence);
        if (labelEl) labelEl.textContent = hasRange ? 'التاريخ (من ← إلى)' : 'التاريخ';

        // Update pill
        if (!pill) return;
        if (!hasRange) { pill.classList.remove('visible'); return; }
        const f = new Date((fromInput?.value || todayStr()) + 'T00:00:00');
        const t = new Date((toInput?.value || fromInput?.value || todayStr()) + 'T00:00:00');
        if (!Number.isNaN(f.getTime()) && !Number.isNaN(t.getTime()) && t >= f) {
            const d = Math.round((t - f) / 864e5) + 1;
            pill.textContent = formatArabicDayCount(d);
            pill.classList.add('visible');
        } else {
            pill.classList.remove('visible');
        }
    }

    function onReason() {
        updateRangeUI();
    }

    async function getSchedulableDatesInRange(teacherId, teacherName, dateFrom, dateTo, absencePeriod) {
        const allDates = enumerateDateRange(dateFrom, dateTo);
        try {
            const data = await getTimetableData();
            if (!data?.timetables) {
                return { dates: allDates, skippedCount: 0, filteredByTimetable: false };
            }

            const teacherKeys = ttResolveTeacherKeys(data, teacherId, teacherName);
            if (!teacherKeys.length) {
                return { dates: allDates, skippedCount: 0, filteredByTimetable: false };
            }

            const dayNames = ['\u0627\u0644\u0623\u062d\u062f', '\u0627\u0644\u0627\u062b\u0646\u064a\u0646', '\u0627\u0644\u062b\u0644\u0627\u062b\u0627\u0621', '\u0627\u0644\u0623\u0631\u0628\u0639\u0627\u0621', '\u0627\u0644\u062e\u0645\u064a\u0633', '\u0627\u0644\u062c\u0645\u0639\u0629', '\u0627\u0644\u0633\u0628\u062a'];
            const schedulableDates = allDates.filter((dateStr) => {
                const dateObj = new Date(`${dateStr}T00:00:00`);
                const dayName = dayNames[dateObj.getDay()];
                return teacherKeys.some((teacherKey) => {
                    const dayData = data.timetables?.[teacherKey]?.[dayName];
                    if (!dayData) return false;
                    const periodEntries = ttGetPeriodEntries(dayData, absencePeriod);
                    return periodEntries.some(([, hours]) =>
                        hours && Object.values(hours).some((lesson) => lesson && lesson.subject)
                    );
                });
            });

            return {
                dates: schedulableDates,
                skippedCount: Math.max(0, allDates.length - schedulableDates.length),
                filteredByTimetable: true
            };
        } catch {
            return { dates: allDates, skippedCount: 0, filteredByTimetable: false };
        }
    }

    document.addEventListener('DOMContentLoaded', async () => {
        // Set today as default date
        const todayVal = todayStr();
        const dateFromInput = document.getElementById('date-from');
        const dateToInput = document.getElementById('date-to');
        if (dateFromInput) dateFromInput.value = todayVal;
        if (dateToInput) dateToInput.value = todayVal;

        const reasonSelect = document.getElementById('att-reason');
        if (
            reasonSelect &&
            ![...reasonSelect.options].some(
                (option) => option.value === 'medical' || option.value === MEDICAL_CERTIFICATE_REASON
            )
        ) {
            const medicalOption = document.createElement('option');
            medicalOption.value = 'medical';
            medicalOption.textContent = MEDICAL_CERTIFICATE_REASON;
            reasonSelect.insertBefore(medicalOption, reasonSelect.options[2] || null);
        }

        document.getElementById('date-from')?.addEventListener('change', () => { updateRangeUI(); filterTeachers(); });
        document.getElementById('date-to')?.addEventListener('change', () => { updateRangeUI(); filterTeachers(); });
        updateRangeUI();

        // Load teachers from grades table (primary source)
        try {
            let result = await window.api.teachers.getFromGrades(year);
            teachersList = Array.isArray(result) ? result : [];

            // Fallback to teachers table
            if (teachersList.length === 0) {
                result = await window.api.teachers.getAll(year);
                teachersList = Array.isArray(result) ? result : [];
            }
        } catch (err) {
            console.error('[Staff Attendance] Error loading teachers:', err);
            // Try fallback
            try {
                const result = await window.api.teachers.getAll(year);
                teachersList = Array.isArray(result) ? result : [];
            } catch (e2) {
                teachersList = [];
            }
        }

        teacherNameCounts = teachersList.reduce((counts, teacher) => {
            const teacherName = String(teacher?.full_name || '').trim();
            if (!teacherName) return counts;
            counts.set(teacherName, (counts.get(teacherName) || 0) + 1);
            return counts;
        }, new Map());

        if (teachersList.length === 0) {
            showToast('لم يتم العثور على أساتذة', 'warning');
        }

        // Build unique subjects list from teachers data (with normalization)
        const subjectsSet = new Set();
        teachersList.forEach((t) => {
            if (t.subject) {
                // subject may be comma-separated from GROUP_CONCAT
                t.subject.split(',').forEach((s) => {
                    const trimmed = s.trim();
                    if (trimmed) {
                        const normalized =
                            typeof normalizeSubjectName === 'function'
                                ? normalizeSubjectName(trimmed)
                                : trimmed;
                        if (normalized) subjectsSet.add(normalized);
                    }
                });
            }
        });
        const subjectSelect = document.getElementById('att-subject');
        [...subjectsSet]
            .sort(typeof compareSubjects === 'function' ? compareSubjects : (a, b) => a.localeCompare(b, 'ar'))
            .forEach((s) => {
                const opt = document.createElement('option');
                opt.value = s;
                opt.textContent = s;
                subjectSelect.appendChild(opt);
            });

        // Filter teachers by selected subject and absence period
        const teacherSelect = document.getElementById('att-teacher');
        const absencePeriodSelect = document.getElementById('att-absence-period');
        const absencePeriodField = document.getElementById('absence-period-field');

        function getTeacherOptionLabel(teacher) {
            const teacherName = String(teacher?.full_name || '').trim();
            if (!teacherName) return '';
            if ((teacherNameCounts.get(teacherName) || 0) <= 1) return teacherName;

            const labelParts = [teacherName];
            const subjectLabel = String(teacher?.subject || '')
                .split(',')
                .map((s) => {
                    const trimmed = s.trim();
                    return typeof normalizeSubjectName === 'function'
                        ? normalizeSubjectName(trimmed)
                        : trimmed;
                })
                .find(Boolean);

            if (subjectLabel) labelParts.push(subjectLabel);
            if (teacher?.id) labelParts.push(`#${teacher.id}`);
            return labelParts.join(' • ');
        }

        filterTeachers = async function filterTeachersImpl() {
            const selectedSubject = subjectSelect.value;
            const currentType = document.getElementById('att-type').value;
            const selectedPeriod = absencePeriodSelect.value;
            const dateStr = getEffectiveAttendanceDate();
            teacherSelect.innerHTML = '<option value="">-- اختر أستاذ(ة) --</option>';

            const seen = new Set();
            for (const t of teachersList) {
                // Check if teacher teaches the selected subject (normalized)
                if (selectedSubject) {
                    const subjects = (t.subject || '').split(',').map((s) => {
                        const trimmed = s.trim();
                        return typeof normalizeSubjectName === 'function'
                            ? normalizeSubjectName(trimmed)
                            : trimmed;
                    });
                    if (!subjects.includes(selectedSubject)) continue;
                }
                // Filter by absence period: only show teachers who work in the selected period
                if (currentType === 'absence' && selectedPeriod !== 'full_day') {
                    if (!(await teacherWorksInPeriod(t.full_name, t.id, dateStr, selectedPeriod))) continue;
                }
                // Deduplicate by persisted identity when possible, not by display name alone.
                const teacherKey = t.id ? `id:${t.id}` : `name:${t.full_name}|subject:${String(t.subject || '').trim()}`;
                if (seen.has(teacherKey)) continue;
                seen.add(teacherKey);

                const opt = document.createElement('option');
                opt.value = makeTeacherOptionValue(t);
                opt.textContent = getTeacherOptionLabel(t);
                opt.dataset.subject = selectedSubject || t.subject || '';
                opt.dataset.hasId = t.id ? '1' : '0';
                opt.dataset.teacherId = t.id ? String(t.id) : '';
                opt.dataset.teacherName = t.full_name || '';
                teacherSelect.appendChild(opt);
            }
        };

        subjectSelect.addEventListener('change', filterTeachers);
        absencePeriodSelect.addEventListener('change', filterTeachers);
        filterTeachers(); // Initial populate

        // Type toggle
        document.querySelectorAll('.type-toggle-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.type-toggle-btn').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                const type = btn.dataset.type;
                document.getElementById('att-type').value = type;
                const lateFields = document.querySelectorAll('.late-fields');
                lateFields.forEach((f) => {
                    f.classList.toggle('visible', type === 'late');
                });
                // Show/hide absence period field
                absencePeriodField.classList.toggle('visible', type === 'absence');
                if (type !== 'absence') absencePeriodSelect.value = 'full_day';
                onReason();
                filterTeachers();
            });
        });

        reasonSelect?.addEventListener('change', onReason);

        // Show absence period by default (since default type is absence)
        absencePeriodField.classList.add('visible');
        onReason();

        // Reset button
        document.getElementById('reset-btn').addEventListener('click', () => {
            document.getElementById('att-subject').value = '';
            absencePeriodSelect.value = 'full_day';
            absencePeriodField.classList.add('visible');
            document.getElementById('att-type').value = 'absence';
            document.querySelectorAll('.type-toggle-btn').forEach((b) => b.classList.remove('active'));
            document.querySelector('.type-toggle-btn[data-type="absence"]').classList.add('active');
            document.getElementById('date-from').value = todayStr();
            document.getElementById('date-to').value = todayStr();
            reasonSelect.value = '';
            updateRangeUI();
            filterTeachers();
            document.querySelectorAll('.late-fields').forEach((f) => f.classList.remove('visible'));
        });

        // Save form
        document.getElementById('att-form').addEventListener('submit', saveRecord);

        // Cancel edit
        document.getElementById('att-cancel-edit-btn')?.addEventListener('click', resetFormToAddMode);

        // Filters
        document.getElementById('filter-type').addEventListener('change', () => { attCurrentPage = 1; renderTable(); });
        document.getElementById('filter-date').addEventListener('change', () => { attCurrentPage = 1; renderTable(); });

        // Pagination clicks
        const paginationEl = document.getElementById('att-pagination');
        if (paginationEl) {
            paginationEl.addEventListener('click', (event) => {
                const btn = event.target.closest('[data-page]');
                if (btn) {
                    const page = Number(btn.dataset.page);
                    if (!isNaN(page) && page !== attCurrentPage) {
                        attCurrentPage = page;
                        renderTable();
                        document.querySelector('.att-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                    return;
                }
                if (event.target.closest('#atp-prev')) {
                    if (attCurrentPage > 1) { attCurrentPage--; renderTable(); document.querySelector('.att-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
                } else if (event.target.closest('#atp-next')) {
                    const totalPages = Math.ceil(getFilteredRecords().length / ATT_PER_PAGE) || 1;
                    if (attCurrentPage < totalPages) { attCurrentPage++; renderTable(); document.querySelector('.att-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
                }
            });
        }

        const recordsTbody = document.getElementById('records-tbody');
        recordsTbody?.addEventListener('click', (event) => {
            const actionBtn = event.target.closest('[data-action][data-record-id]');
            if (!actionBtn) return;

            const recordId = Number(actionBtn.dataset.recordId);
            if (!Number.isFinite(recordId) || recordId <= 0) return;

            if (actionBtn.dataset.action === 'edit') {
                editRecord(recordId);
            } else if (actionBtn.dataset.action === 'delete') {
                deleteRecord(recordId);
            }
        });

        // Load records
        await loadRecords();
    });

    async function loadRecords() {
        allRecords = (await window.api.staffAttendance.getAll(year)) || [];
        updateStats();
        renderTable();
    }

    function updateStats() {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        // Filter for current month
        const thisMonth = allRecords.filter((r) => {
            if (!r.attendance_date) return false;
            const d = new Date(r.attendance_date);
            return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
        });

        const absences = thisMonth.filter((r) => r.type === 'absence').length;
        const lates = thisMonth.filter((r) => r.type === 'late').length;

        document.getElementById('stat-absence').textContent = absences;
        document.getElementById('stat-late').textContent = lates;
        document.getElementById('stat-total').textContent = allRecords.length;
    }




    async function getTeacherSectionsForDate(dateStr) {
        if (!dateStr) return {};
        if (teacherSectionsByDate.has(dateStr)) {
            return teacherSectionsByDate.get(dateStr);
        }
        const fetchPromise = (async () => {
            try {
                const reportData = await window.api.dailyReport.getData(dateStr, year);
                return reportData?.teacherSections || {};
            } catch (e) {
                console.warn('Could not load teacher sections for date:', dateStr, e);
                return {};
            }
        })();
        teacherSectionsByDate.set(dateStr, fetchPromise);
        return fetchPromise;
    }

    async function getFallbackTeacherSections(teacherId, teacherName, dateStr) {
        const teacherSections = await getTeacherSectionsForDate(dateStr);
        const byId = teacherId ? teacherSections[`id:${teacherId}`] : null;
        if (Array.isArray(byId) && byId.length) return byId;
        const byName = teacherSections[teacherName] || teacherSections[`name:${teacherName}`];
        return Array.isArray(byName) ? byName : [];
    }


    /**
     * Get the sections a teacher was scheduled to teach on a specific date,
     * reading from the timetable stored in localStorage.
     */
    async function getSectionsForDay(teacherId, teacherName, dateStr, absencePeriod) {
        const cacheKey = makeTeacherDayCacheKey(teacherId, teacherName, dateStr, absencePeriod);
        if (sectionsForDayCache.has(cacheKey)) {
            return sectionsForDayCache.get(cacheKey);
        }

        const request = (async () => {
        try {
            const data = await getTimetableData();
            if (!data || !data.timetables) return getFallbackTeacherSections(teacherId, teacherName, dateStr);

            // Map JS getDay() → Arabic day name
            const dayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
            const dateObj = new Date(dateStr + 'T00:00:00');
            const dayName = dayNames[dateObj.getDay()];

            const teacherKeys = ttResolveTeacherKeys(data, teacherId, teacherName);

            const sections = new Set();
            teacherKeys.forEach((teacherKey) => {
                const dayData = data.timetables?.[teacherKey]?.[dayName];
                if (!dayData) return;
                const periodEntries = ttGetPeriodEntries(dayData, absencePeriod);
                for (const [, hours] of periodEntries) {
                    if (!hours || typeof hours !== 'object') continue;
                    for (const lesson of Object.values(hours)) {
                        if (!lesson) continue;
                        const students = (lesson.students || '').trim();
                        if (students) {
                            const baseClass = students.replace(/:[Gg]\d+$/g, '').trim();
                            if (baseClass) sections.add(baseClass);
                        }
                    }
                }
            });

            if (sections.size > 0) return [...sections].sort();
            return getFallbackTeacherSections(teacherId, teacherName, dateStr);
        } catch (e) {
            console.warn('Error reading timetable for day filtering:', e);
            return getFallbackTeacherSections(teacherId, teacherName, dateStr);
        }
        })();

        sectionsForDayCache.set(cacheKey, request);
        return request;
    }

    /**
     * Get the scheduled time periods for a teacher on a specific date.
     * Returns an array of period strings, e.g. ['08:30-10:30', '10:30-11:30']
     * Consecutive hours with the SAME section are merged into one block.
     * Uses mergeConsecutivePeriods, MORNING_HOUR_MAP, AFTERNOON_HOUR_MAP from utils.js
     */
    async function getScheduleForDay(teacherId, teacherName, dateStr, absencePeriod) {
        const cacheKey = makeTeacherDayCacheKey(teacherId, teacherName, dateStr, absencePeriod);
        if (scheduleForDayCache.has(cacheKey)) {
            return scheduleForDayCache.get(cacheKey);
        }

        const request = (async () => {
        try {
            const data = await getTimetableData();
            if (!data || !data.timetables) return [];

            const dayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
            const dateObj = new Date(dateStr + 'T00:00:00');
            const dayName = dayNames[dateObj.getDay()];

            const teacherKeys = ttResolveTeacherKeys(data, teacherId, teacherName);
            if (!teacherKeys.length) return [];

            // Collect slots with section info for smart merging
            const slots = [];
            teacherKeys.forEach((teacherKey) => {
                const dayData = data.timetables?.[teacherKey]?.[dayName];
                if (!dayData) return;
                const periodEntries = ttGetPeriodEntries(dayData, absencePeriod);
                for (const [periodKey, hours] of periodEntries) {
                    if (!hours || typeof hours !== 'object') continue;
                    const hourMap = periodKey === 'morning' ? MORNING_HOUR_MAP : AFTERNOON_HOUR_MAP;
                    const sortedKeys = Object.keys(hours).sort();
                    for (const h of sortedKeys) {
                        const lesson = hours[h];
                        if (lesson) {
                            const time = hourMap[h] || h;
                            const section = (lesson.students || '').replace(/:[Gg]\d+$/g, '').trim();
                            slots.push({ time, section });
                        }
                    }
                }
            });

            // Deduplicate by time+section
            const seen = new Set();
            const uniqueSlots = slots.filter((s) => {
                const key = s.time + '|' + s.section;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            return mergeConsecutivePeriods(uniqueSlots);
        } catch (e) {
            console.warn('Error reading schedule:', e);
            return [];
        }
        })();

        scheduleForDayCache.set(cacheKey, request);
        return request;
    }

    function getFilteredRecords() {
        const filterType = document.getElementById('filter-type').value;
        const filterDate = document.getElementById('filter-date').value;
        let filtered = allRecords;
        if (filterType) filtered = filtered.filter((r) => r.type === filterType);
        if (filterDate) filtered = filtered.filter((r) => r.attendance_date === filterDate);
        return filtered;
    }

    function renderAttPagination(totalRows, totalPages) {
        const container = document.getElementById('att-pagination');
        if (!container) return;
        if (totalPages <= 1) {
            container.innerHTML = totalRows > 0
                ? `<div class="support-pagination-info"><span><i class="fas fa-list-ol"></i> المجموع: ${totalRows}</span></div>`
                : '';
            return;
        }

        const maxVisible = 5;
        let startPage = Math.max(1, attCurrentPage - Math.floor(maxVisible / 2));
        let endPage = Math.min(totalPages, startPage + maxVisible - 1);
        if (endPage - startPage < maxVisible - 1) startPage = Math.max(1, endPage - maxVisible + 1);

        let pageButtons = '';
        if (startPage > 1) {
            pageButtons += `<button class="support-page-btn" data-page="1">1</button>`;
            if (startPage > 2) pageButtons += `<span class="support-page-ellipsis">…</span>`;
        }
        for (let i = startPage; i <= endPage; i++) {
            pageButtons += `<button class="support-page-btn${i === attCurrentPage ? ' active' : ''}" data-page="${i}">${i}</button>`;
        }
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) pageButtons += `<span class="support-page-ellipsis">…</span>`;
            pageButtons += `<button class="support-page-btn" data-page="${totalPages}">${totalPages}</button>`;
        }

        const startRecord = (attCurrentPage - 1) * ATT_PER_PAGE + 1;
        const endRecord = Math.min(attCurrentPage * ATT_PER_PAGE, totalRows);

        container.innerHTML = `
            <div class="support-pagination-bar">
                <button class="support-page-nav" id="atp-prev" ${attCurrentPage === 1 ? 'disabled' : ''}>
                    <i class="fas fa-chevron-right"></i> السابق
                </button>
                <div class="support-page-numbers">${pageButtons}</div>
                <button class="support-page-nav" id="atp-next" ${attCurrentPage === totalPages ? 'disabled' : ''}>
                    التالي <i class="fas fa-chevron-left"></i>
                </button>
            </div>
            <div class="support-pagination-info">
                <span><i class="fas fa-eye"></i> ${startRecord}–${endRecord} من ${totalRows}</span>
                <span><i class="fas fa-file-alt"></i> صفحة ${attCurrentPage} / ${totalPages}</span>
            </div>
        `;
    }

    async function renderTable() {
        const filtered = getFilteredRecords();
        const totalRows = filtered.length;
        const totalPages = Math.ceil(totalRows / ATT_PER_PAGE) || 1;
        attCurrentPage = Math.max(1, Math.min(attCurrentPage, totalPages));

        document.getElementById('records-count').textContent = totalRows;
        const tbody = document.getElementById('records-tbody');

        if (totalRows === 0) {
            tbody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="10">
                        <i class="fas fa-check-circle" style="color: var(--color-success-bg); margin-left: 8px;"></i>
                        لا توجد سجلات مطابقة
                    </td>
                </tr>`;
            renderAttPagination(0, 1);
            return;
        }

        const startIndex = (attCurrentPage - 1) * ATT_PER_PAGE;
        const pageRows = filtered.slice(startIndex, startIndex + ATT_PER_PAGE);

        const rowsHtml = await Promise.all(pageRows.map(async (r, i) => {
            const isAbsence = r.type === 'absence';
            const typeBadge = isAbsence
                ? '<span class="type-badge absence"><i class="fas fa-user-minus"></i> غياب</span>'
                : '<span class="type-badge late"><i class="fas fa-clock"></i> تأخر</span>';

            // Absence period display
            const absencePeriod = r.absence_period || 'full_day';
            let periodHtml = '—';
            if (isAbsence) {
                const periodLabels = {
                    full_day: '<span class="period-badge full"><i class="fas fa-calendar-day"></i> يوم كامل</span>',
                    morning: '<span class="period-badge morning"><i class="fas fa-sun"></i> صباحا</span>',
                    afternoon: '<span class="period-badge afternoon"><i class="fas fa-moon"></i> مساءً</span>'
                };
                periodHtml = periodLabels[absencePeriod] || periodLabels.full_day;
            }

            let timeInfo = '—';
            if (!isAbsence) {
                const parts = [];
                if (r.arrival_time) parts.push('الوصول: ' + escapeHtml(r.arrival_time));
                if (r.late_duration) parts.push(r.late_duration + ' دقيقة');
                timeInfo = parts.length ? parts.join(' · ') : '—';
            } else if ((r.teacher_id || r.full_name) && r.attendance_date) {
                const scheduleHours = await getScheduleForDay(r.teacher_id, r.full_name, r.attendance_date, absencePeriod);
                if (scheduleHours.length > 0) {
                    timeInfo = scheduleHours
                        .map(
                            (h) =>
                                `<span class="section-tag" style="font-size: 11px;">${escapeHtml(h)}</span>`
                        )
                        .join('');
                }
            }

            const teacherName = r.full_name;
            let sectionsHtml = '—';
            if (isAbsence && (r.teacher_id || teacherName) && r.attendance_date) {
                const daySections = await getSectionsForDay(r.teacher_id, teacherName, r.attendance_date, absencePeriod);
                if (daySections.length > 0) {
                    sectionsHtml = daySections
                        .map((s) => `<span class="section-tag">${escapeHtml(s)}</span>`)
                        .join('');
                }
            }

            return `
            <tr>
                <td>${startIndex + i + 1}</td>
                <td>${typeBadge}</td>
                <td><strong>${escapeHtml(r.full_name || '—')}</strong></td>
                <td>${escapeHtml(r.subject || '—')}</td>
                <td>${formatDate(r.attendance_date)}</td>
                <td>${periodHtml}</td>
                <td>${timeInfo}</td>
                <td>${escapeHtml(r.reason || '—')}${r.notes ? '<br><small class="record-note"><i class="fas fa-sticky-note"></i>' + escapeHtml(r.notes) + '</small>' : ''}</td>
                <td>${isAbsence ? sectionsHtml : '—'}</td>
                <td style="white-space:nowrap">
                    <button class="delete-btn edit-action-btn" data-action="edit" data-record-id="${r.id}" title="تعديل">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="delete-btn" data-action="delete" data-record-id="${r.id}" title="حذف">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>`;
        }));
        tbody.innerHTML = rowsHtml.join('');

        renderAttPagination(totalRows, totalPages);
    }

    function resetFormToAddMode() {
        document.getElementById('att-edit-id').value = '';
        document.getElementById('att-form').reset();
        document.getElementById('att-subject').value = '';
        document.getElementById('att-absence-period').value = 'full_day';
        document.getElementById('absence-period-field').classList.add('visible');
        document.querySelectorAll('.late-fields').forEach((f) => f.classList.remove('visible'));
        document.querySelectorAll('.type-toggle-btn').forEach((b) => b.classList.remove('active'));
        document.querySelector('.type-toggle-btn[data-type="absence"]').classList.add('active');
        document.getElementById('att-type').value = 'absence';
        document.getElementById('date-from').value = todayStr();
        document.getElementById('date-to').value = todayStr();
        document.getElementById('att-reason').value = '';
        updateRangeUI();
        filterTeachers();
        document.getElementById('att-submit-btn').innerHTML = '<i class="fas fa-save"></i> حفظ';
        document.getElementById('att-cancel-edit-btn').style.display = 'none';
        document.querySelector('.attendance-form-header h3').textContent = 'تسجيل غياب أو تأخر';
    }

    async function editRecord(id) {
        const record = allRecords.find((r) => Number(r.id) === id);
        if (!record) { showToast('لم يتم العثور على السجل', 'error'); return; }

        // Set edit ID
        document.getElementById('att-edit-id').value = id;

        // Set type toggle
        const type = record.type || 'absence';
        document.getElementById('att-type').value = type;
        document.querySelectorAll('.type-toggle-btn').forEach((b) => b.classList.remove('active'));
        document.querySelector(`.type-toggle-btn[data-type="${type}"]`)?.classList.add('active');

        // Show/hide fields based on type
        document.querySelectorAll('.late-fields').forEach((f) => f.classList.toggle('visible', type === 'late'));
        document.getElementById('absence-period-field').classList.toggle('visible', type === 'absence');

        document.getElementById('att-absence-period').value =
            type === 'absence' ? record.absence_period || 'full_day' : 'full_day';

        // Fill subject then rebuild teacher list using the final edit-state filters.
        document.getElementById('att-subject').value = record.subject || '';
        document.getElementById('date-from').value = record.attendance_date || todayStr();
        document.getElementById('date-to').value = record.attendance_date || todayStr();
        document.getElementById('att-reason').value =
            record.reason === MEDICAL_CERTIFICATE_REASON || record.reason === 'medical' ? 'medical' : record.reason || '';
        onReason();
        await filterTeachers();

        const teacherSelect = document.getElementById('att-teacher');
        const byId = record.teacher_id ? String(record.teacher_id) : null;
        if (byId && [...teacherSelect.options].some((o) => o.dataset.teacherId === byId)) {
            teacherSelect.value = byId;
        } else {
            const nameOption = [...teacherSelect.options].find((o) =>
                o.dataset.teacherName === record.full_name &&
                (o.dataset.subject || '') === (record.subject || '')
            ) || [...teacherSelect.options].find((o) => o.dataset.teacherName === record.full_name);
            if (nameOption) teacherSelect.value = nameOption.value;
        }

        // Fill other fields
        document.getElementById('att-notes').value = record.notes || '';
        if (type === 'late') {
            document.getElementById('att-arrival-time').value = record.arrival_time || '';
            document.getElementById('att-late-duration').value = record.late_duration || '';
        }

        // Update UI to edit mode
        document.getElementById('att-submit-btn').innerHTML = '<i class="fas fa-check"></i> تحديث';
        document.getElementById('att-cancel-edit-btn').style.display = '';
        document.querySelector('.attendance-form-header h3').textContent = 'تعديل السجل';

        // Scroll to form
        document.querySelector('.attendance-form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    /*
    async function saveRecord(e) {
        e.preventDefault();
        if (_saveRecordInFlight) return;

        const teacherSelect = document.getElementById('att-teacher');
        const teacherValue = teacherSelect.value;
        if (!teacherValue) {
            showToast('الرجاء اختيار أستاذ(ة)', 'error');
            return;
        }

        const selectedOption = teacherSelect.options[teacherSelect.selectedIndex];
        const teacherName = selectedOption.dataset.teacherName || selectedOption.textContent;
        const hasId = selectedOption.dataset.hasId === '1';

        const type = document.getElementById('att-type').value;
        const selectedSubject =
            document.getElementById('att-subject').value || selectedOption.dataset.subject || '';
        const reasonValue = document.getElementById('att-reason').value;
        const payload = {
            teacher_id: hasId ? Number(teacherValue) : null,
            teacher_name: teacherName,
            subject: selectedSubject,
            type: type,
            reason: reasonValue === 'medical' ? MEDICAL_CERTIFICATE_REASON : reasonValue,
            notes: document.getElementById('att-notes').value.trim(),
            school_year: year
        };

        if (type === 'absence') {
            payload.absence_period = document.getElementById('att-absence-period').value || 'full_day';
        }

        if (type === 'late') {
            payload.arrival_time = document.getElementById('att-arrival-time').value || null;
            payload.late_duration = Number(document.getElementById('att-late-duration').value) || null;
        }

        const editId = document.getElementById('att-edit-id').value;
        _saveRecordInFlight = true;
        setSaveUiBusy(true);
        try {
            let res;
        if (editId) {
            payload.attendance_date = document.getElementById('date-from').value;
            payload.id = Number(editId);
            res = await window.api.staffAttendance.update(payload);
        } else if (type === 'absence' && document.getElementById('date-to')?.value && document.getElementById('date-to').value > document.getElementById('date-from').value) {
            const dateFrom = document.getElementById('date-from').value;
            const dateTo = document.getElementById('date-to').value;

            if (!dateFrom || !dateTo) {
                showToast('\u0627\u0644\u0631\u062c\u0627\u0621 \u062a\u062d\u062f\u064a\u062f \u0627\u0644\u0641\u062a\u0631\u0629 \u0643\u0627\u0645\u0644\u0629', 'error');
                return;
            }
            if (dateTo < dateFrom) {
                showToast('\u0644\u0627 \u064a\u0645\u0643\u0646 \u0623\u0646 \u064a\u0643\u0648\u0646 \u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0646\u0647\u0627\u064a\u0629 \u0642\u0628\u0644 \u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0628\u062f\u0627\u064a\u0629', 'error');
                return;
            }

            const rangePlan = await getSchedulableDatesInRange(
                payload.teacher_id,
                teacherName,
                dateFrom,
                dateTo,
                payload.absence_period || 'full_day'
            );

            if (!rangePlan.dates.length) {
                showToast('\u0644\u0627 \u062a\u0648\u062c\u062f \u062d\u0635\u0635 \u0645\u062c\u062f\u0648\u0644\u0629 \u0644\u0644\u0623\u0633\u062a\u0627\u0630 \u062e\u0644\u0627\u0644 \u0647\u0630\u0647 \u0627\u0644\u0641\u062a\u0631\u0629', 'warning');
                return;
            }

            let savedCount = 0;
            for (const attendanceDate of rangePlan.dates) {
                const saveRes = await window.api.staffAttendance.save({
                    ...payload,
                    attendance_date: attendanceDate
                });
                if (!saveRes || saveRes.success === false) {
                    const partialMessage =
                        savedCount > 0
                            ? `\u062a\u0645 \u062d\u0641\u0638 ${formatArabicDayCount(savedCount)} \u0641\u0642\u0637 \u0642\u0628\u0644 \u062a\u0648\u0642\u0641 \u0627\u0644\u0639\u0645\u0644\u064a\u0629`
                            : saveRes?.error || '\u0641\u0634\u0644 \u062d\u0641\u0638 \u0627\u0644\u0641\u062a\u0631\u0629';
                    showToast(partialMessage, savedCount > 0 ? 'warning' : 'error');
                    return;
                }
                savedCount++;
            }

            let successMessage = `\u062a\u0645 \u062d\u0641\u0638 ${formatArabicDayCount(savedCount)} \u0628\u0646\u062c\u0627\u062d`;
            if (rangePlan.skippedCount > 0) {
                successMessage += ` \u0645\u0639 \u062a\u062c\u0627\u0647\u0644 ${formatArabicDayCount(rangePlan.skippedCount)} \u0628\u062f\u0648\u0646 \u062d\u0635\u0635`;
            }

            showToast(successMessage, 'success');
            invalidateTimetableCache();
            resetFormToAddMode();
            attCurrentPage = 1;
            await loadRecords();
            return;
        } else {
            payload.attendance_date = document.getElementById('date-from').value;
            res = await window.api.staffAttendance.save(payload);
        }

        if (!res || res.success === false) {
            showToast(res?.error || 'فشل الحفظ', 'error');
            return;
        }

        showToast(editId ? 'تم التحديث بنجاح' : 'تم الحفظ بنجاح', 'success');
        invalidateTimetableCache();
        resetFormToAddMode();
        attCurrentPage = 1;
        await loadRecords();
    }

    */

    async function saveRecord(e) {
        e.preventDefault();
        if (_saveRecordInFlight) return;

        const teacherSelect = document.getElementById('att-teacher');
        const teacherValue = teacherSelect.value;
        if (!teacherValue) {
            showToast('الرجاء اختيار أستاذ(ة)', 'error');
            return;
        }

        const selectedOption = teacherSelect.options[teacherSelect.selectedIndex];
        const teacherName = selectedOption.dataset.teacherName || selectedOption.textContent;
        const hasId = selectedOption.dataset.hasId === '1';

        const type = document.getElementById('att-type').value;
        const selectedSubject =
            document.getElementById('att-subject').value || selectedOption.dataset.subject || '';
        const reasonValue = document.getElementById('att-reason').value;
        const payload = {
            teacher_id: hasId ? Number(teacherValue) : null,
            teacher_name: teacherName,
            subject: selectedSubject,
            type,
            reason: reasonValue === 'medical' ? MEDICAL_CERTIFICATE_REASON : reasonValue,
            notes: document.getElementById('att-notes').value.trim(),
            school_year: year
        };

        if (type === 'absence') {
            payload.absence_period = document.getElementById('att-absence-period').value || 'full_day';
        }

        if (type === 'late') {
            payload.arrival_time = document.getElementById('att-arrival-time').value || null;
            payload.late_duration = Number(document.getElementById('att-late-duration').value) || null;
        }

        const editId = document.getElementById('att-edit-id').value;
        _saveRecordInFlight = true;
        setSaveUiBusy(true);

        try {
            let res;

            if (editId) {
                payload.attendance_date = document.getElementById('date-from').value;
                payload.id = Number(editId);
                res = await window.api.staffAttendance.update(payload);
            } else if (
                type === 'absence' &&
                document.getElementById('date-to')?.value &&
                document.getElementById('date-to').value > document.getElementById('date-from').value
            ) {
                const dateFrom = document.getElementById('date-from').value;
                const dateTo = document.getElementById('date-to').value;

                if (!dateFrom || !dateTo) {
                    showToast('الرجاء تحديد الفترة كاملة', 'error');
                    return;
                }
                if (dateTo < dateFrom) {
                    showToast('لا يمكن أن يكون تاريخ النهاية قبل تاريخ البداية', 'error');
                    return;
                }

                const rangePlan = await getSchedulableDatesInRange(
                    payload.teacher_id,
                    teacherName,
                    dateFrom,
                    dateTo,
                    payload.absence_period || 'full_day'
                );

                if (!rangePlan.dates.length) {
                    showToast('لا توجد حصص مجدولة للأستاذ خلال هذه الفترة', 'warning');
                    return;
                }

                let savedCount = 0;
                let duplicateCount = 0;
                for (const attendanceDate of rangePlan.dates) {
                    const saveRes = await window.api.staffAttendance.save({
                        ...payload,
                        attendance_date: attendanceDate
                    });
                    if (!saveRes || saveRes.success === false) {
                        const partialMessage =
                            savedCount > 0
                                ? `تم حفظ ${formatArabicDayCount(savedCount)} فقط قبل توقف العملية`
                                : saveRes?.error || 'فشل حفظ الفترة';
                        showToast(partialMessage, savedCount > 0 ? 'warning' : 'error');
                        return;
                    }
                    if (saveRes.duplicate) {
                        duplicateCount++;
                        continue;
                    }
                    savedCount++;
                }

                if (savedCount === 0 && duplicateCount > 0) {
                    showToast('جميع سجلات هذه الفترة مسجلة مسبقًا', 'warning');
                    return;
                }

                let successMessage = `تم حفظ ${formatArabicDayCount(savedCount)} بنجاح`;
                if (duplicateCount > 0) {
                    successMessage += ` مع تجاهل ${formatArabicDayCount(duplicateCount)} مسجلة مسبقًا`;
                }
                if (rangePlan.skippedCount > 0) {
                    successMessage += ` وتجاهل ${formatArabicDayCount(rangePlan.skippedCount)} بدون حصص`;
                }

                showToast(successMessage, 'success');
                invalidateTimetableCache();
                resetFormToAddMode();
                attCurrentPage = 1;
                await loadRecords();
                return;
            } else {
                payload.attendance_date = document.getElementById('date-from').value;
                res = await window.api.staffAttendance.save(payload);
            }

            if (!res || res.success === false) {
                showToast(res?.error || 'فشل الحفظ', 'error');
                return;
            }
            if (res.duplicate) {
                showToast('السجل مسجل مسبقًا لنفس الأستاذ والتاريخ', 'warning');
                return;
            }

            showToast(editId ? 'تم التحديث بنجاح' : 'تم الحفظ بنجاح', 'success');
            invalidateTimetableCache();
            resetFormToAddMode();
            attCurrentPage = 1;
            await loadRecords();
        } finally {
            _saveRecordInFlight = false;
            setSaveUiBusy(false);
        }
    }

    async function deleteRecord(id) {
        const { confirmed } = await showConfirm({
            title: 'حذف السجل',
            message: 'هل أنت متأكد من حذف هذا السجل؟',
            detail: 'لا يمكن التراجع عن هذا الإجراء.',
            type: 'danger',
            confirmText: 'حذف نهائي',
            cancelText: 'إلغاء',
        });
        if (!confirmed) return;
        const res = await window.api.staffAttendance.delete(id);
        if (!res || res.success === false) {
            showToast('فشل الحذف', 'error');
            return;
        }
        showToast('تم الحذف', 'success');
        attCurrentPage = 1;
        await loadRecords();
    }
})();
