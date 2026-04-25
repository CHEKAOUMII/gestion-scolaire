/**
 * staff-daily-report.js – Page logic for التقرير اليومي
 * Extracted from inline <script> in staff-daily-report.html
 */
(function () {
    'use strict';

    // ── Constants & Config ──

    const year = typeof getSchoolYear === 'function' ? getSchoolYear() : '2025/2026';

    const TAG_DETAIL_CONFIG = {
        educational_activity: { label: 'عنوان النشاط',        placeholder: 'مثال: نشاط بيئي حول إعادة التدوير...' },
        cultural_activity:    { label: 'عنوان النشاط',        placeholder: 'مثال: مسابقة في القراءة...' },
        sports_activity:      { label: 'عنوان النشاط',        placeholder: 'مثال: دوري كرة القدم...' },
        inspection:           { label: 'اسم المفتش',          placeholder: 'اسم المفتش التربوي...' },
        meeting:              { label: 'موضوع الاجتماع',      placeholder: 'مثال: مجلس القسم...' },
        competition:          { label: 'اسم المسابقة',        placeholder: 'مثال: الأولمبياد الجهوية للرياضيات...' },
        training:             { label: 'موضوع التكوين',      placeholder: 'مثال: ورشة الرقمنة...' },
        field_trip:           { label: 'وجهة الخرجة',        placeholder: 'مثال: زيارة متحف...' },
        disciplinary_council: { label: 'موضوع المجلس',      placeholder: 'مثال: اسم التلميذ...' },
        school_incident:      { label: 'وصف الحادثة',       placeholder: 'مثال: سقوط تلميذ في الساحة...' },
        holiday:              { label: 'تفاصيل',           placeholder: 'مثال: عطلة الربيع...' },
        strike:               { label: 'تفاصيل',           placeholder: 'مثال: إضراب وطني...' },
        exam:                 { label: 'اسم الامتحان',      placeholder: 'مثال: الامتحان الموحد المحلي...' },
        official_visit:       { label: 'تفاصيل الزيارة',   placeholder: 'مثال: زيارة المدير الإقليمي...' },
        early_release:        { label: 'السبب',             placeholder: 'سبب الخروج المبكر...' },
        short_session:        { label: 'تفاصيل',           placeholder: 'تفاصيل إضافية...' },
        cancelled_session:    { label: 'السبب',             placeholder: 'سبب الإلغاء...' },
        other:                { label: 'تفاصيل',           placeholder: 'تفاصيل إضافية...' }
    };

    // ── State Variables ──

    const ENTITY_ICONS = {
        teacher: '👨‍🏫',
        section: '🏫',
        inspector: '🔍',
        subject: '📚',
        general: '📝'
    };

    let _timetableCache = null;
    let _timetableCacheLoaded = false;
    let _teachersCache = null;
    let _inspectorsCache = null;
    let _subjectsCache = null;
    let _allSectionsCache = [];
    let _mentionStartPos = -1;
    let _confirmedMentions = [];
    let _currentNoteGroup = null;
    let _saveTagNoteInFlight = false;
    let _mentionActiveIndex = 0;
    let _editSaveContext = null;

    // ── Utility Functions ──

    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatReasonCell(reason, notes) {
        const safeReason = escapeHtml(reason || '—');
        if (!notes) return safeReason;
        return `${safeReason}<span class="record-note-inline"> | ${escapeHtml(notes)}</span>`;
    }

    function formatCompactList(items, className, fallback = '<span style="color: var(--color-text-light);">&mdash;</span>') {
        if (!Array.isArray(items) || items.length === 0) return fallback;
        return `<span class="${className}">${items.map(item => escapeHtml(item)).join(' · ')}</span>`;
    }

    /** Format a date string to Arabic locale */
    function formatDateAr(dateStr) {
        try {
            const d = new Date(dateStr + 'T00:00:00');
            return d.toLocaleDateString('ar-MA', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        } catch {
            return dateStr;
        }
    }

    /** Get today's date as YYYY-MM-DD */
    function todayStr() {
        const d = new Date();
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    /**
     * Format a raw subject string (possibly comma-separated GROUP_CONCAT)
     * into a clean, normalized, deduplicated display.
     */
    function formatSubject(rawSubject) {
        if (!rawSubject) return '—';
        const subjects = rawSubject.split(',').map(s => {
            const trimmed = s.trim();
            return typeof normalizeSubjectName === 'function'
                ? normalizeSubjectName(trimmed)
                : trimmed;
        }).filter(Boolean);
        const unique = [...new Set(subjects)];
        return unique.length > 0 ? escapeHtml(unique.join('، ')) : '—';
    }

    function getAbsenceLookupKey(absence) {
        const teacherId = Number(absence?.teacher_id);
        if (teacherId > 0) return `id:${teacherId}`;

        const fullName = String(absence?.full_name || absence?.teacher_name || '').trim();
        if (!fullName) return '';

        const subject = String(absence?.subject || '').trim();
        return `name:${fullName}::subject:${subject}`;
    }

    function parseRowMentions(row) {
        const rawMentions = row?.dataset?.mentions;
        if (!rawMentions) return [];

        try {
            const parsed = JSON.parse(rawMentions);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .map((item) => ({
                    type: String(item?.type || '').trim(),
                    id: Number(item?.id) > 0 ? Number(item.id) : null,
                    name: String(item?.name || '').trim()
                }))
                .filter((item) => item.type && item.name);
        } catch (err) {
            console.warn('Unable to parse tag mentions:', err);
            return [];
        }
    }

    // ── Timetable Resolution (delegates to js/shared/timetable-utils.js) ──

    function normalizeName(name) { return ttNormalizeName(name); }
    function resolveTeacherTimetableKeys(data, teacherId, teacherName) {
        return ttResolveTeacherKeys(data, teacherId, teacherName);
    }

    // ── Data Loading ──

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

    /**
     * Get the sections a teacher was scheduled to teach on a specific date,
     * reading from the timetable stored in localStorage.
     * Falls back to the provided fallbackSections if timetable data is unavailable.
     */
    async function getSectionsForDay(teacherName, dateStr, fallbackSections, teacherId) {
        try {
            const data = await getTimetableData();
            if (!data || !data.timetables) return fallbackSections || [];

            const dayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
            const dateObj = new Date(dateStr + 'T00:00:00');
            const dayName = dayNames[dateObj.getDay()];

            const teacherKeys = resolveTeacherTimetableKeys(data, teacherId, teacherName);
            if (!teacherKeys.length) return fallbackSections || [];

            const sections = new Set();
            teacherKeys.forEach(teacherKey => {
                const dayData = data.timetables?.[teacherKey]?.[dayName];
                if (!dayData) return;
                for (const hours of Object.values(dayData)) {
                    for (const lesson of Object.values(hours || {})) {
                        const students = (lesson.students || '').trim();
                        if (students) {
                            const baseClass = students.replace(/:[Gg]\d+$/g, '').trim();
                            if (baseClass) sections.add(baseClass);
                        }
                    }
                }
            });
            return sections.size > 0 ? [...sections].sort() : (fallbackSections || []);
        } catch (e) {
            console.warn('Error reading timetable for day filtering:', e);
            return fallbackSections || [];
        }
    }

    /**
     * Get the scheduled time periods for a teacher on a specific date.
     * Returns an array of period strings, e.g. ['08:00-09:00', '10:00-11:00']
     */
    async function getScheduleForDay(teacherName, dateStr, fallback, teacherId) {
        try {
            const data = await getTimetableData();
            if (!data || !data.timetables) return fallback || [];

            const dayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
            const dateObj = new Date(dateStr + 'T00:00:00');
            const dayName = dayNames[dateObj.getDay()];

            const teacherKeys = resolveTeacherTimetableKeys(data, teacherId, teacherName);
            if (!teacherKeys.length) return fallback || [];

            const periodMap = {
                'h1': '08:00-09:00', 'h2': '09:00-10:00',
                'h3': '10:00-11:00', 'h4': '11:00-12:00',
                'h5': '14:00-15:00', 'h6': '15:00-16:00',
                'h7': '16:00-17:00', 'h8': '17:00-18:00'
            };

            const periods = [];
            teacherKeys.forEach(teacherKey => {
                const dayData = data.timetables?.[teacherKey]?.[dayName];
                if (!dayData) return;
                for (const [periodType, hours] of Object.entries(dayData)) {
                    if (!hours || typeof hours !== 'object') continue;
                    const sortedKeys = Object.keys(hours).sort();
                    for (const h of sortedKeys) {
                        if (hours[h]) {
                            periods.push(periodMap[h] || h);
                        }
                    }
                }
            });
            return [...new Set(periods)];
        } catch (e) {
            console.warn('Error reading schedule:', e);
            return fallback || [];
        }
    }

    async function getDetailedSessionsForDay(uniqueAbsences, date) {
        const sessions = [];
        const periodMap = {
            'h1': '08:00-09:00', 'h2': '09:00-10:00',
            'h3': '10:00-11:00', 'h4': '11:00-12:00',
            'h5': '14:00-15:00', 'h6': '15:00-16:00',
            'h7': '16:00-17:00', 'h8': '17:00-18:00'
        };
        try {
            const ttData = await getTimetableData();
            if (!ttData || !ttData.timetables) return sessions;

            const dayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
            const dateObj = new Date(date + 'T00:00:00');
            const dayName = dayNames[dateObj.getDay()];

            for (const absence of uniqueAbsences) {
                const name = absence.full_name || absence.teacher_name;
                if (!name) continue;
                const teacherKeys = resolveTeacherTimetableKeys(ttData, absence.teacher_id, name);
                if (!teacherKeys.length) continue;

                teacherKeys.forEach(teacherKey => {
                    const dayData = ttData.timetables?.[teacherKey]?.[dayName];
                    if (!dayData) return;

                    for (const [periodType, hours] of Object.entries(dayData)) {
                        if (!hours || typeof hours !== 'object') continue;
                        for (const [h, lesson] of Object.entries(hours)) {
                            if (!lesson) continue;
                            const sectionName = (lesson.students || '').trim();
                            if (!sectionName) continue;
                            sessions.push({
                                absence_date: date,
                                teacher_name: name,
                                section: sectionName,
                                period_slot: h,
                                period_time: periodMap[h] || h,
                                subject: lesson.subject || absence.subject || '',
                                school_year: year,
                                reason: absence.reason || '',
                                notes: absence.notes || ''
                            });
                        }
                    }
                });
            }
        } catch (e) {
            console.warn('Error extracting detailed sessions:', e);
        }
        return sessions;
    }

    // ── Main Report ──

    async function loadReport() {
        const date = document.getElementById('report-date').value;
        if (!date) return;

        // Update date display
        const dateDisplayText = formatDateAr(date);
        document.getElementById('date-display').textContent = dateDisplayText;
        document.getElementById('print-date-display').textContent = dateDisplayText;

        let data;
        try {
            data = await window.api.dailyReport.getData(date, year);
        } catch (err) {
            console.error('Error loading daily report:', err);
            showToast('خطأ في تحميل التقرير', 'error');
            return;
        }

        if (!data) {
            showToast('لا توجد بيانات', 'warning');
            return;
        }

        const { absences, staffAbsences, staffTardiness, teacherSections: backendTeacherSections, sectionStudentCounts, allSections, affectedSections: backendAffected } = data;

        // Cache sections for tag entity selector
        _allSectionsCache = allSections || [];

        // Override teacher sections with timetable data filtered by actual day
        const teacherSectionsOverride = {};
        const affectedSections = {};

        // Combine all absence lists for display
        const allAbsences = [...(absences || []), ...(staffAbsences || [])];
        // Deduplicate by full_name (same teacher shouldn't appear twice)
        const seenAbsenceKeys = new Set();
        const teacherDisplayNames = {};
        const uniqueAbsences = allAbsences.filter((a) => {
            const lookupKey = getAbsenceLookupKey(a);
            if (!lookupKey || seenAbsenceKeys.has(lookupKey)) return false;
            seenAbsenceKeys.add(lookupKey);
            a._lookupKey = lookupKey;
            teacherDisplayNames[lookupKey] = a.full_name || a.teacher_name || '—';
            return true;
        });

        // Build day-specific sections for each absent teacher
        for (const absence of uniqueAbsences) {
            const name = absence.full_name || absence.teacher_name;
            if (!name) continue;
            const lookupKey = absence._lookupKey || getAbsenceLookupKey(absence);
            const fallback = (backendTeacherSections && (
                backendTeacherSections[lookupKey] ||
                backendTeacherSections[name]
            )) || [];
            const daySections = await getSectionsForDay(name, date, fallback, absence.teacher_id);
            teacherSectionsOverride[lookupKey] = daySections;
            if (daySections.length > 0) {
                affectedSections[lookupKey] = daySections;
            }
        }

        // Use the overridden teacher sections
        const teacherSections = teacherSectionsOverride;

        // ── Stat Cards ──
        const absentCount = uniqueAbsences.length;
        const lateCount = staffTardiness ? staffTardiness.length : 0;
        const affectedSectionNames = new Set();
        if (affectedSections) {
            for (const sections of Object.values(affectedSections)) {
                sections.forEach(s => affectedSectionNames.add(s));
            }
        }

        document.getElementById('stat-absent').textContent = absentCount;
        document.getElementById('stat-late').textContent = lateCount;
        document.getElementById('stat-sections').textContent = affectedSectionNames.size;

        // ── Teacher Absences Table ──
        document.getElementById('absence-count').textContent = absentCount;
        const absencesTbody = document.getElementById('absences-tbody');

        if (absentCount === 0) {
            absencesTbody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="6">
                        <i class="fas fa-check-circle" style="color: var(--color-success-bg); margin-left: 8px;"></i>
                        لا يوجد أساتذة غائبون في هذا اليوم
                    </td>
                </tr>`;
        } else {
            const absenceRows = [];
            for (let i = 0; i < uniqueAbsences.length; i++) {
                const a = uniqueAbsences[i];
                const teacherName = a.full_name || a.teacher_name;
                const lookupKey = a._lookupKey || getAbsenceLookupKey(a);
                const sections = (teacherSections && teacherSections[lookupKey])
                    ? formatCompactList(teacherSections[lookupKey], 'section-list-text')
                    : '<span style="color: var(--color-text-light);">—</span>';
                // Get schedule hours from timetable for this day
                let scheduleHtml = '—';
                if (teacherName) {
                    const scheduleHours = await getScheduleForDay(teacherName, date, [], a.teacher_id);
                    if (scheduleHours.length > 0) {
                        scheduleHtml = formatCompactList(scheduleHours, 'schedule-text', '—');
                    }
                }
                absenceRows.push(`
                    <tr>
                        <td class="col-index">${i + 1}</td>
                        <td class="col-teacher"><strong>${escapeHtml(teacherName || '—')}</strong></td>
                        <td class="col-subject">${formatSubject(a.subject)}</td>
                        <td class="col-schedule">${scheduleHtml}</td>
                        <td class="col-reason reason-cell">${formatReasonCell(a.reason, a.notes)}</td>
                        <td class="col-sections">${sections}</td>
                    </tr>`);
            }
            absencesTbody.innerHTML = absenceRows.join('');
        }

        // ── Affected Sections Grid ──
        const affectedKeys = affectedSections ? Object.keys(affectedSections) : [];
        document.getElementById('affected-count').textContent = affectedSectionNames.size;
        const affectedGrid = document.getElementById('affected-grid');

        if (affectedKeys.length === 0) {
            affectedGrid.innerHTML = `
                <div class="report-empty-state" style="grid-column: 1 / -1;">
                    <i class="fas fa-check-circle"></i>
                    <p>لا توجد حصص متضررة</p>
                </div>`;
        } else {
            affectedGrid.innerHTML = affectedKeys.map((lookupKey) => {
                const sections = affectedSections[lookupKey];
                const teacherName = teacherDisplayNames[lookupKey] || lookupKey;
                return `
                    <div class="affected-item">
                        <div class="teacher-name">
                            <i class="fas fa-user-minus"></i>
                            ${escapeHtml(teacherName)}
                        </div>
                        <div class="sections-list">
                            ${sections.map(s => `<span class="section-tag">${escapeHtml(s)}</span>`).join('')}
                        </div>
                    </div>`;
            }).join('');
        }

        // ── Tardiness Table ──
        const tardinessCount = staffTardiness ? staffTardiness.length : 0;
        document.getElementById('tardiness-count').textContent = tardinessCount;
        const tardinessTbody = document.getElementById('tardiness-tbody');

        if (tardinessCount === 0) {
            tardinessTbody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="6">
                        <i class="fas fa-check-circle" style="color: var(--color-success-bg); margin-left: 8px;"></i>
                        لا توجد تأخرات في هذا اليوم
                    </td>
                </tr>`;
        } else {
            tardinessTbody.innerHTML = staffTardiness.map((t, i) => {
                return `
                    <tr>
                        <td class="col-index">${i + 1}</td>
                        <td><strong>${escapeHtml(t.full_name || '—')}</strong></td>
                        <td>${escapeHtml(t.subject || '—')}</td>
                        <td>${escapeHtml(t.arrival_time || '—')}</td>
                        <td>${t.late_duration ? t.late_duration + ' دقيقة' : '—'}</td>
                    <td>${formatReasonCell(t.reason, t.notes)}</td>
                    </tr>`;
            }).join('');
        }


        // ── System Tags ──
        const tags = data.tags || [];
        document.getElementById('tags-count').textContent = tags.length;
        renderTagsTable(tags);

        // ── Compensatory Hours by Section ──
        // Calculate how many hours each section lost due to absent teachers
        const sectionHoursMap = {}; // { sectionName: { hours: number, teachers: Set } }

        if (uniqueAbsences.length > 0) {
            try {
                const ttData = await getTimetableData();
                if (ttData && ttData.timetables) {
                    const dayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
                    const dateObj = new Date(date + 'T00:00:00');
                    const dayName = dayNames[dateObj.getDay()];

                        for (const absence of uniqueAbsences) {
                            const name = absence.full_name || absence.teacher_name;
                            if (!name) continue;

                            const teacherKeys = resolveTeacherTimetableKeys(ttData, absence.teacher_id, name);
                            if (!teacherKeys.length) continue;

                            teacherKeys.forEach(teacherKey => {
                                const dayData = ttData.timetables?.[teacherKey]?.[dayName];
                                if (!dayData) return;

                                // Iterate each period type (morning, afternoon)
                                for (const [periodType, hours] of Object.entries(dayData)) {
                                    if (!hours || typeof hours !== 'object') continue;
                                    for (const [h, lesson] of Object.entries(hours)) {
                                        if (!lesson) continue;
                                        const sectionName = lesson.students || '';
                                        if (!sectionName) continue;

                                        if (!sectionHoursMap[sectionName]) {
                                            sectionHoursMap[sectionName] = { hours: 0, teachers: new Set() };
                                        }
                                        sectionHoursMap[sectionName].hours += 1; // Each H = 1 hour
                                        sectionHoursMap[sectionName].teachers.add(name);
                                    }
                                }
                            });
                        }
                    }
            } catch (e) {
                console.warn('Error calculating compensatory hours:', e);
            }
        }

        // Sort sections by hours descending
        const sortedSections = Object.entries(sectionHoursMap)
            .sort((a, b) => b[1].hours - a[1].hours);

        // Update stat card with total lost hours
        const totalLostHours = sortedSections.reduce((sum, [, data]) => sum + data.hours, 0);
        document.getElementById('stat-hours').textContent = totalLostHours;

        // ── Auto-save lost sessions to compensation tracking ──
        const detailedSessions = await getDetailedSessionsForDay(uniqueAbsences, date);
        if (detailedSessions.length > 0) {
            try {
                await window.api.compensation.saveBatch(detailedSessions);
            } catch (e) {
                console.warn('Error saving compensation sessions:', e);
                if (typeof showToast === 'function') {
                    showToast('تعذر حفظ الحصص التعويضية تلقائيًا', 'warning');
                }
            }
        }
        // Fetch compensation status for stat card
        try {
            const compRecords = await window.api.compensation.getByDate(date, year);
            const compDone = compRecords.filter(r => r.compensated).length;
            const compTotal = compRecords.length;
            document.getElementById('stat-compensated').textContent =
                compTotal > 0 ? compDone + '/' + compTotal : '0';
        } catch (e) {
            console.warn('Error fetching compensation status:', e);
        }

        document.getElementById('compensatory-count').textContent = sortedSections.length;
        const compensatoryTbody = document.getElementById('compensatory-tbody');

        if (sortedSections.length === 0) {
            compensatoryTbody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="4">
                        <i class="fas fa-check-circle" style="color: var(--color-success-bg); margin-left: 8px;"></i>
                        لا توجد أقسام تحتاج ساعات تعويضية
                    </td>
                </tr>`;
        } else {
            compensatoryTbody.innerHTML = sortedSections.map(([section, data], i) => {
                const teacherNames = [...data.teachers].map(t => escapeHtml(t)).join('، ');
                return `
                    <tr>
                        <td class="col-index">${i + 1}</td>
                        <td><strong>${escapeHtml(section)}</strong></td>
                        <td>
                            <span class="justified-badge no" style="font-weight: 700; font-size: 14px;">
                                ${data.hours} ساعة
                            </span>
                        </td>
                        <td style="font-size: 12px;">${teacherNames}</td>
                    </tr>`;
            }).join('');
        }
    }

    // ── System Tags — Rendering ──

    function renderTagsTable(tags) {
        const tbody = document.getElementById('tags-tbody');
        if (!tags || tags.length === 0) {
            tbody.innerHTML = '<tr class="empty-row" id="tags-empty-row"><td colspan="5">لا توجد تسجيلات لهذا اليوم</td></tr>';
            return;
        }

        // Group by note_group
        const groups = new Map();
        const standalone = [];
        for (const tag of tags) {
            if (tag.note_group) {
                if (!groups.has(tag.note_group)) groups.set(tag.note_group, []);
                groups.get(tag.note_group).push(tag);
            } else {
                standalone.push(tag);
            }
        }

        let html = '';
        let rowIndex = 1;

        // Grouped notes
        for (const [groupId, groupTags] of groups) {
            const first = groupTags[0];
            const tagDef = ALL_TAG_TYPES.find(d => d.key === first.tag_key);
            const tagBadge = tagDef
                ? `${tagDef.icon} ${escapeHtml(first.tag_label)}`
                : escapeHtml(first.tag_label);
            const mentions = groupTags
                .filter(tag => tag.entity_type !== 'general')
                .map(tag => ({
                    type: tag.entity_type,
                    id: Number(tag.entity_id) > 0 ? Number(tag.entity_id) : null,
                    name: tag.entity_name
                }));

            const rawDetails = first.details ? first.details.trim() : '';
            let activityTitle = rawDetails;
            let eventTime = '';
            if (rawDetails.startsWith('time::')) {
                const pipeIdx = rawDetails.indexOf('|');
                eventTime = rawDetails.substring(6, pipeIdx > 0 ? pipeIdx : rawDetails.length);
                activityTitle = pipeIdx > 0 ? rawDetails.substring(pipeIdx + 1).trim() : '';
            }

            let displayText = escapeHtml(first.note_text || '');
            // Strip legacy [id:X] tokens from old saved data
            displayText = displayText.replace(/\[id:\d+\]/g, '');
            for (const tag of groupTags) {
                if (tag.entity_type === 'general') continue;
                const raw = '@' + escapeHtml(tag.entity_name);
                const icon = ENTITY_ICONS[tag.entity_type] || ENTITY_ICONS.general;
                const highlighted = `<span style="background: var(--color-primary-light, #e3f2fd); color: var(--color-primary); padding: 1px 6px; border-radius: 4px; font-weight: 600;">${icon} ${escapeHtml(tag.entity_name)}</span>`;
                displayText = displayText.replace(raw, highlighted);
            }

            const timeBadge = eventTime ? `<span style="background: var(--color-bg-secondary, #f0f0f0); padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap; margin-left: 4px;"><i class="fas fa-clock" style="margin-left: 2px; font-size: 10px;"></i> ${escapeHtml(eventTime)}</span>` : '';
            const titleHtml = activityTitle
                ? `<i class="fas fa-bookmark" style="margin-left: 3px; color: var(--color-primary);"></i> ${escapeHtml(activityTitle)}${timeBadge}`
                : (eventTime ? timeBadge : '<span style="color: var(--color-muted, #aaa);">—</span>');

            html += `
                <tr data-note-group="${escapeHtml(groupId)}"
                    data-tag-key="${escapeHtml(first.tag_key)}"
                    data-activity-title="${escapeHtml(activityTitle)}"
                    data-event-time="${escapeHtml(eventTime)}"
                    data-note-text="${escapeHtml(first.note_text || '')}"
                    data-mentions="${escapeHtml(JSON.stringify(mentions))}">
                    <td class="col-index">${rowIndex++}</td>
                    <td><span style="font-weight: 600; white-space: nowrap;">${tagBadge}</span></td>
                    <td style="font-size: 13px; color: var(--color-text-secondary, #555);">${titleHtml}</td>
                    <td style="line-height: 1.7;">${displayText}</td>
                    <td class="no-print">
                        <div style="display: flex; gap: 2px; align-items: center;">
                            <button class="btn-edit-tag" style="font-size: 15px; padding: 6px 8px; background: none; border: none; color: var(--color-primary); cursor: pointer;" title="تعديل">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn-delete-tag" data-group="${escapeHtml(groupId)}" style="font-size: 17px; padding: 6px 8px; background: none; border: none; color: var(--color-danger, #e53e3e); cursor: pointer;" title="حذف">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                    </td>
                </tr>`;
        }

        // Standalone tags (backward compat)
        for (const tag of standalone) {
            const tagDef = ALL_TAG_TYPES.find(d => d.key === tag.tag_key);
            const tagBadge = tagDef
                ? `${tagDef.icon} ${escapeHtml(tag.tag_label)}`
                : escapeHtml(tag.tag_label);
            const icon = ENTITY_ICONS[tag.entity_type] || ENTITY_ICONS.general;
            const mentions = tag.entity_type && tag.entity_type !== 'general'
                ? [{
                    type: tag.entity_type,
                    id: Number(tag.entity_id) > 0 ? Number(tag.entity_id) : null,
                    name: tag.entity_name
                }]
                : [];

            html += `
                <tr data-tag-id="${tag.id}"
                    data-tag-key="${escapeHtml(tag.tag_key)}"
                    data-activity-title="${escapeHtml(tag.details || '')}"
                    data-event-time=""
                    data-note-text="${escapeHtml(tag.entity_name || '')}"
                    data-mentions="${escapeHtml(JSON.stringify(mentions))}">
                    <td class="col-index">${rowIndex++}</td>
                    <td><span style="font-weight: 600; white-space: nowrap;">${tagBadge}</span></td>
                    <td style="font-size: 13px; color: var(--color-text-secondary, #555);">${tag.details ? '<i class="fas fa-bookmark" style="margin-left: 3px; color: var(--color-primary);"></i> ' + escapeHtml(tag.details) : '<span style="color: var(--color-muted, #aaa);">—</span>'}</td>
                    <td>${icon} <strong>${escapeHtml(tag.entity_name)}</strong></td>
                    <td class="no-print">
                        <div style="display: flex; gap: 2px; align-items: center;">
                            <button class="btn-edit-tag" style="font-size: 15px; padding: 6px 8px; background: none; border: none; color: var(--color-primary); cursor: pointer;" title="تعديل">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn-delete-tag" data-tag-id="${tag.id}" style="font-size: 17px; padding: 6px 8px; background: none; border: none; color: var(--color-danger, #e53e3e); cursor: pointer;" title="حذف">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                    </td>
                </tr>`;
        }

        tbody.innerHTML = html;
    }

    // ── Note Form ──

    async function ensureTeachersCache() {
        if (!_teachersCache) {
            try {
                _teachersCache = await window.api.teachers.getAll(year);
            } catch { _teachersCache = []; }
        }
        return _teachersCache;
    }

    async function ensureInspectorsCache() {
        if (!_inspectorsCache) {
            try {
                _inspectorsCache = await window.api.inspectors.getAll(year);
            } catch { _inspectorsCache = []; }
        }
        return _inspectorsCache;
    }

    async function ensureSubjectsCache() {
        if (!_subjectsCache) {
            try {
                const rawSubjects = await window.api.subjects.getAll();
                const normalized = (rawSubjects || [])
                    .map((item) => (typeof item === 'string' ? item : item?.name))
                    .map((name) => typeof normalizeSubjectName === 'function' ? normalizeSubjectName(name) : String(name || '').trim())
                    .filter(Boolean);
                _subjectsCache = [...new Set(normalized)];
            } catch { _subjectsCache = []; }
        }
        return _subjectsCache;
    }

    async function showTagNoteForm() {
        await Promise.all([
            ensureTeachersCache(),
            ensureInspectorsCache(),
            ensureSubjectsCache()
        ]);
        const form = document.getElementById('tag-note-form');
        const typeSelect = document.getElementById('tag-note-type');

        typeSelect.innerHTML = ALL_TAG_TYPES.map(t =>
            `<option value="${t.key}">${t.icon} ${escapeHtml(t.label)}</option>`
        ).join('');

        document.getElementById('tag-note-textarea').value = '';
        document.getElementById('tag-activity-title').value = '';
        document.getElementById('tag-event-time').value = '';
        _confirmedMentions = [];
        _currentNoteGroup = crypto.randomUUID();
        form.style.display = 'block';
        toggleActivityTitleField(typeSelect.value);

        typeSelect.onchange = () => toggleActivityTitleField(typeSelect.value);

        const textarea = document.getElementById('tag-note-textarea');
        textarea.focus();
        // Remove any stale listeners before adding (guards against add→edit without cancel)
        textarea.removeEventListener('input', handleNoteInput);
        textarea.removeEventListener('keydown', handleNoteKeydown);
        textarea.addEventListener('input', handleNoteInput);
        textarea.addEventListener('keydown', handleNoteKeydown);
    }

    function toggleActivityTitleField(tagKey) {
        const config = TAG_DETAIL_CONFIG[tagKey] || { label: 'تفاصيل', placeholder: 'تفاصيل إضافية...' };
        document.getElementById('tag-detail-label-text').textContent = config.label;
        document.getElementById('tag-activity-title').placeholder = config.placeholder;
    }

    function cancelTagNote() {
        document.getElementById('tag-note-form').style.display = 'none';
        document.getElementById('tag-event-time').value = '';
        _confirmedMentions = [];
        _currentNoteGroup = null;
        _editSaveContext = null;
        hideMentionDropdown();
        const textarea = document.getElementById('tag-note-textarea');
        textarea.removeEventListener('input', handleNoteInput);
        textarea.removeEventListener('keydown', handleNoteKeydown);
    }

    async function saveTagNote() {
        if (_saveTagNoteInFlight) return;

        const tagKey = document.getElementById('tag-note-type').value;
        const noteText = document.getElementById('tag-note-textarea').value.trim();
        const activityTitle = document.getElementById('tag-activity-title').value.trim();
        const eventTime = document.getElementById('tag-event-time').value;
        const tagDate = document.getElementById('report-date').value;

        if (!noteText && !activityTitle) {
            showToast('اكتب ملاحظة أو عنوان النشاط', 'warning');
            return;
        }

        // Validate mentions: @mentions are optional for general tags (e.g. holiday, strike)
        const validMentions = _confirmedMentions.filter(m => noteText.includes(`@${m.name}`));
        const forcedMentions = Array.isArray(_editSaveContext?.forceMentions)
            ? _editSaveContext.forceMentions
            : [];
        for (const mention of forcedMentions) {
            const exists = validMentions.some((item) =>
                item.type === mention.type &&
                item.id === mention.id &&
                item.name === mention.name
            );
            if (!exists) validMentions.push(mention);
        }

        const tagDef = ALL_TAG_TYPES.find(t => t.key === tagKey);
        const tagLabel = tagDef ? tagDef.label : tagKey;

        _saveTagNoteInFlight = true;
        try {
            const result = await window.api.systemTags.saveNote({
                tag_date: tagDate,
                tag_key: tagKey,
                tag_label: tagLabel,
                note_text: noteText,
                mentions: validMentions,
                school_year: year,
                details: eventTime ? `time::${eventTime}|${activityTitle || ''}` : (activityTitle || ''),
                note_group: _currentNoteGroup,
                replace_note_group: _editSaveContext?.replaceNoteGroup || null,
                replace_tag_id: _editSaveContext?.replaceTagId || null,
                replace_legacy_event_id: _editSaveContext?.replaceLegacyEventId || null
            });
            if (result && result.success === false) {
                throw new Error(result.error || 'فشل في حفظ الوسم');
            }
            showToast('تم حفظ الوسم بنجاح', 'success');
            cancelTagNote();
            loadReport();
        } catch (err) {
            console.error('Error saving tag note:', err);
            showToast('خطأ في حفظ الوسم', 'error');
        } finally {
            _saveTagNoteInFlight = false;
        }
    }

    async function deleteTagNote(noteGroup) {
        const { confirmed } = await showConfirm({
            title: 'حذف الوسم',
            message: 'هل أنت متأكد من حذف هذا الوسم؟',
            detail: 'لا يمكن التراجع عن هذا الإجراء.',
            type: 'danger',
            confirmText: 'حذف نهائي',
            cancelText: 'إلغاء',
        });
        if (!confirmed) return;
        try {
            if (noteGroup.startsWith('legacy-event-')) {
                const eventId = parseInt(noteGroup.replace('legacy-event-', ''), 10);
                await window.api.schoolEvents.delete(eventId);
            } else {
                await window.api.systemTags.deleteByGroup(noteGroup);
            }
            showToast('تم حذف الوسم', 'success');
            loadReport();
        } catch (err) {
            console.error('Error deleting tag note:', err);
            showToast('خطأ في حذف الوسم', 'error');
        }
    }

    async function deleteTag(tagId) {
        const { confirmed } = await showConfirm({
            title: 'حذف الوسم',
            message: 'هل أنت متأكد من حذف هذا الوسم؟',
            detail: 'لا يمكن التراجع عن هذا الإجراء.',
            type: 'danger',
            confirmText: 'حذف نهائي',
            cancelText: 'إلغاء',
        });
        if (!confirmed) return;
        try {
            await window.api.systemTags.delete(tagId);
            showToast('تم حذف الوسم', 'success');
            loadReport();
        } catch (err) {
            console.error('Error deleting tag:', err);
            showToast('خطأ في حذف الوسم', 'error');
        }
    }

    async function editTagNote(btn) {
        const row = btn.closest('tr');
        const noteGroup = row.dataset.noteGroup || '';
        const tagId = Number(row.dataset.tagId) > 0 ? Number(row.dataset.tagId) : null;
        const tagKey = row.dataset.tagKey || '';
        const activityTitle = row.dataset.activityTitle || '';
        const eventTime = row.dataset.eventTime || '';
        const noteText = row.dataset.noteText || '';
        const mentions = parseRowMentions(row);

        await showTagNoteForm();

        // Pre-fill the form
        const typeSelect = document.getElementById('tag-note-type');
        typeSelect.value = tagKey;
        toggleActivityTitleField(tagKey);

        document.getElementById('tag-activity-title').value = activityTitle;
        document.getElementById('tag-event-time').value = eventTime;
        // Strip legacy [id:X] tokens from note text
        const cleanNoteText = noteText.replace(/\[id:\d+\]/g, '');
        document.getElementById('tag-note-textarea').value = cleanNoteText;
        _confirmedMentions = mentions.map((mention) => ({
            ...mention,
            _token: `@${mention.name}`
        }));

        if (noteGroup) {
            if (noteGroup.startsWith('legacy-event-')) {
                _currentNoteGroup = crypto.randomUUID();
                _editSaveContext = {
                    replaceLegacyEventId: parseInt(noteGroup.replace('legacy-event-', ''), 10)
                };
            } else {
                _currentNoteGroup = noteGroup;
                _editSaveContext = { replaceNoteGroup: noteGroup };
            }
        } else if (tagId) {
            _currentNoteGroup = crypto.randomUUID();
            _editSaveContext = {
                replaceTagId: tagId,
                forceMentions: mentions
            };
            if (mentions.length === 1 && (
                !cleanNoteText.trim() ||
                cleanNoteText.trim() === mentions[0].name
            )) {
                document.getElementById('tag-note-textarea').value = `@${mentions[0].name}`;
            }
        } else {
            _currentNoteGroup = crypto.randomUUID();
            _editSaveContext = null;
        }

        // Scroll to form
        document.getElementById('tag-note-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // ── @Mention Autocomplete ──

    function handleNoteInput() {
        const textarea = document.getElementById('tag-note-textarea');
        const text = textarea.value;
        const cursor = textarea.selectionStart;
        const before = text.substring(0, cursor);

        const lastAt = before.lastIndexOf('@');

        if (lastAt >= 0 && (lastAt === 0 || /[\s\n]/.test(before[lastAt - 1]))) {
            const query = before.substring(lastAt + 1);
            if (query.length <= 40 && !query.includes('\n')) {
                _mentionStartPos = lastAt;
                _mentionActiveIndex = 0;
                showMentionSuggestions(query);
                return;
            }
        }
        hideMentionDropdown();
    }



    function showMentionSuggestions(query) {
        const dropdown = document.getElementById('mention-dropdown');
        const teachers = (_teachersCache || []).filter(t => t.full_name);
        const inspectors = _inspectorsCache || [];
        const subjects = _subjectsCache || [];
        const sections = _allSectionsCache || [];
        const q = query.trim();
        const qLower = q.toLowerCase();

        let teacherItems = [];
        let sectionItems = [];
        let inspectorItems = [];
        let subjectItems = [];

        for (const t of teachers) {
            const fullName = String(t.full_name || '').trim();
            if (fullName && (!q || fullName.includes(q) || fullName.toLowerCase().includes(qLower))) {
                teacherItems.push({ type: 'teacher', id: t.id, name: fullName, meta: t.subject || '', badge: '👨‍🏫' });
            }
        }

        for (const s of sections) {
            const sectionName = String(s || '').trim();
            if (sectionName && (!q || sectionName.includes(q) || sectionName.toLowerCase().includes(qLower))) {
                sectionItems.push({ type: 'section', id: null, name: sectionName, meta: '', badge: '🏫' });
            }
        }

        for (const inspector of inspectors) {
            const fullName = `${String(inspector.first_name || '').trim()} ${String(inspector.last_name || '').trim()}`.trim();
            const specialty = String(inspector.specialty || '').trim();
            if (!fullName) continue;
            const matchesName = !q || fullName.includes(q) || fullName.toLowerCase().includes(qLower);
            const matchesSpecialty = specialty && (specialty.includes(q) || specialty.toLowerCase().includes(qLower));
            if (matchesName || matchesSpecialty) {
                inspectorItems.push({ type: 'inspector', id: inspector.id, name: fullName, meta: specialty, badge: '🔍' });
            }
        }

        for (const subject of subjects) {
            const subjectName = String(subject || '').trim();
            if (subjectName && (!q || subjectName.includes(q) || subjectName.toLowerCase().includes(qLower))) {
                subjectItems.push({ type: 'subject', id: null, name: subjectName, meta: '', badge: '📚' });
            }
        }

        teacherItems = teacherItems.slice(0, 8);
        // Keep all matching sections visible; the dropdown already scrolls.
        inspectorItems = inspectorItems.slice(0, 4);
        subjectItems = subjectItems.slice(0, 4);

        const items = [...teacherItems, ...sectionItems, ...inspectorItems, ...subjectItems];
        if (items.length === 0) {
            hideMentionDropdown();
            return;
        }

        let html = '';
        let globalIdx = 0;

        const renderMentionGroup = (title, groupItems, normalizeMeta = false) => {
            if (groupItems.length === 0) return;
            html += `<div style="padding: 5px 14px; font-size: 11px; font-weight: 700; color: var(--color-muted, #888); background: var(--color-bg-secondary, #f5f5f5); border-bottom: 1px solid var(--color-border-light, #eee); letter-spacing: 0.5px;">${title}</div>`;
            for (const item of groupItems) {
                const idx = globalIdx++;
                const metaText = normalizeMeta && item.meta && typeof normalizeSubjectName === 'function'
                    ? normalizeSubjectName(item.meta)
                    : item.meta;
                const metaLine = metaText
                    ? `<span style="font-size: 11px; color: var(--color-muted, #999); display: block; margin-top: 1px;">${escapeHtml(metaText)}</span>`
                    : '';
                html += `
                    <div class="mention-item${idx === _mentionActiveIndex ? ' mention-item--active' : ''}"
                         data-type="${item.type}" data-id="${item.id || ''}" data-name="${escapeHtml(item.name)}"
                         data-idx="${idx}"
                         style="padding: 8px 14px; cursor: pointer; display: flex; align-items: center; gap: 8px; font-size: 13px;
                                border-bottom: 1px solid var(--color-border-light, #f0f0f0);
                                transition: background 0.15s;
                                ${idx === _mentionActiveIndex ? 'background: rgba(66,133,244,0.15); color: var(--color-text, #1a1a1a);' : ''}">
                        <span style="font-size: 16px;">${item.badge}</span>
                        <span style="flex: 1;"><span style="font-weight: 600;">${escapeHtml(item.name)}</span>${metaLine}</span>
                    </div>`;
            }
        };

        renderMentionGroup('👨‍🏫 الأساتذة', teacherItems, true);
        renderMentionGroup('🏫 الأقسام', sectionItems);
        renderMentionGroup('🔍 المفتشون', inspectorItems);
        renderMentionGroup('📚 المواد', subjectItems);

        dropdown.innerHTML = html;
        dropdown.style.display = 'block';
    }

    function selectMentionItem(el) {
        const name = el.dataset.name;
        const type = el.dataset.type;
        const id = el.dataset.id ? Number(el.dataset.id) : null;

        // Display clean @name in textarea (no [id:X]).
        // The ID is tracked internally in _confirmedMentions.
        const displayToken = `@${name}`;

        const textarea = document.getElementById('tag-note-textarea');
        const text = textarea.value;
        const cursor = textarea.selectionStart;

        const before = text.substring(0, _mentionStartPos);
        const after = text.substring(cursor);
        textarea.value = before + displayToken + ' ' + after;

        // Track mention with position info and internal id for save.
        const exists = _confirmedMentions.some(m => m.name === name && m.id === id && m.type === type);
        if (!exists) _confirmedMentions.push({ type, id, name, _token: displayToken });

        const newCursor = _mentionStartPos + displayToken.length + 1;
        textarea.setSelectionRange(newCursor, newCursor);
        textarea.focus();
        hideMentionDropdown();
    }

    function handleNoteKeydown(e) {
        const dropdown = document.getElementById('mention-dropdown');
        if (!dropdown || dropdown.style.display === 'none') return;

        const items = dropdown.querySelectorAll('.mention-item');
        if (!items.length) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            _mentionActiveIndex = Math.min(_mentionActiveIndex + 1, items.length - 1);
            updateMentionHighlight();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            _mentionActiveIndex = Math.max(_mentionActiveIndex - 1, 0);
            updateMentionHighlight();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (items[_mentionActiveIndex]) selectMentionItem(items[_mentionActiveIndex]);
        } else if (e.key === 'Escape') {
            hideMentionDropdown();
        }
    }

    function updateMentionHighlight() {
        const items = document.querySelectorAll('#mention-dropdown .mention-item');
        items.forEach((el, i) => {
            el.style.background = i === _mentionActiveIndex ? 'rgba(66,133,244,0.15)' : '';
        });
        if (items[_mentionActiveIndex]) {
            items[_mentionActiveIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    function hideMentionDropdown() {
        const dropdown = document.getElementById('mention-dropdown');
        if (dropdown) dropdown.style.display = 'none';
        _mentionActiveIndex = 0;
    }

    // ── Initialization ──

    document.addEventListener('DOMContentLoaded', () => {
        const dateInput = document.getElementById('report-date');
        dateInput.value = todayStr();
        loadReport();

        document.getElementById('load-btn').addEventListener('click', loadReport);
        dateInput.addEventListener('change', loadReport);

        document.getElementById('print-btn').addEventListener('click', () => {
            PrintSystem.preview({ title: 'التقرير اليومي', pageSize: 'A4' });
        });

        document.getElementById('add-tag-btn').addEventListener('click', showTagNoteForm);

        // Static form buttons (replacing inline onclick)
        document.getElementById('save-tag-btn').addEventListener('click', saveTagNote);
        document.getElementById('cancel-tag-btn').addEventListener('click', cancelTagNote);

        // Event delegation for dynamically rendered tag table rows
        document.getElementById('tags-tbody').addEventListener('click', (e) => {
            const editBtn = e.target.closest('.btn-edit-tag');
            if (editBtn) {
                editTagNote(editBtn);
                return;
            }
            const deleteBtn = e.target.closest('.btn-delete-tag');
            if (deleteBtn) {
                const group = deleteBtn.dataset.group;
                const tagId = deleteBtn.dataset.tagId;
                if (group) deleteTagNote(group);
                else if (tagId) deleteTag(Number(tagId));
            }
        });

        // Event delegation for mention dropdown (mousedown to fire before blur)
        const mentionDropdown = document.getElementById('mention-dropdown');
        mentionDropdown.addEventListener('mousedown', (e) => {
            const item = e.target.closest('.mention-item');
            if (item) selectMentionItem(item);
        });
        mentionDropdown.addEventListener('mouseover', (e) => {
            const item = e.target.closest('.mention-item');
            if (item && item.dataset.idx !== undefined) {
                _mentionActiveIndex = Number(item.dataset.idx);
                updateMentionHighlight();
            }
        });
    });
})();
