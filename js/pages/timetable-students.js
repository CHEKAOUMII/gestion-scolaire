const StudentTimetable = (function() {
    // C5: days / hour labels / theme via js/shared/timetable-view.js (+ utils hour maps)
    const days = typeof TT_VIEW_DAYS !== 'undefined' ? TT_VIEW_DAYS : ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

    // Dynamically discovered from FET data
    let discoveredMorningHours = [];
    let discoveredAfternoonHours = [];

    let timetableData = null;
    let classesIndex = {}; // className -> [{teacher, day, period, hour, subject, room, group}]
    let levelsMap = {};
    let subjectColorMap = {};

    let _listenersAttached = false;

    function init() {
        loadTimetableData();

        if (_listenersAttached) return;
        _listenersAttached = true;

        const levelSelect = document.getElementById('student-level-select');
        const classSelect = document.getElementById('student-class-select');

        if (levelSelect) {
            levelSelect.addEventListener('change', (e) => {
                const level = e.target.value;
                classSelect.innerHTML = '<option value="">-- اختر القسم --</option>';

                if (level && levelsMap[level]) {
                    sortSectionNames(levelsMap[level]).forEach((name) => {
                        const opt = document.createElement('option');
                        opt.value = name;
                        opt.textContent = name;
                        classSelect.appendChild(opt);
                    });
                    classSelect.disabled = false;
                } else {
                    classSelect.disabled = true;
                }

                hideStats();
                document.getElementById('student-schedule').innerHTML = `
      <div class="no-data-state">
        <i class="fas fa-user-graduate"></i>
        <h4>اختر القسم لعرض جدول حصصه</h4>
        <p>سيتم عرض الجدول الأسبوعي مع معلومات المواد والأساتذة</p>
      </div>`;
            });
        }

        if (classSelect) {
            classSelect.addEventListener('change', (e) => {
                if (e.target.value) {
                    showClassSchedule(e.target.value);
                } else {
                    hideStats();
                    document.getElementById('student-schedule').innerHTML = `
        <div class="no-data-state">
          <i class="fas fa-user-graduate"></i>
          <h4>اختر القسم لعرض جدول حصصه</h4>
          <p>سيتم عرض الجدول الأسبوعي مع معلومات المواد والأساتذة</p>
        </div>`;
                }
            });
        }

        const printBtn = document.getElementById('student-print-btn');
        if (printBtn) {
            printBtn.addEventListener('click', () => {
                const className = document.getElementById('student-class-select')?.value || '';
                const title = className ? `جدول حصص التلاميذ - ${className}` : 'جدول حصص التلاميذ';
                const safeName =
                    typeof ttSafeFileName === 'function' ? ttSafeFileName(className || 'students') : className || 'students';
                PrintSystem.preview({
                    contentSelector: '#student-schedule',
                    title,
                    pageSize: 'A4',
                    landscape: true,
                    density: 1,
                    showDensityControl: true,
                    defaultFileName: `جدول_تلاميذ_${safeName}.pdf`
                });
            });
        }

        if (typeof ttObserveTheme === 'function') {
            ttObserveTheme(() => {
                if (classSelect?.value) showClassSchedule(classSelect.value);
            });
        }
    }

    async function loadTimetableData() {
        try {
            const schoolYear = getSchoolYear();
            const parsed = await window.api?.timetable?.get?.(schoolYear);
            if (!parsed || !parsed.timetables) {
                showNoImportState();
                return;
            }

            timetableData = parsed;

            // Discover hours and build class index from all teacher timetables
            const morningSet = new Set();
            const afternoonSet = new Set();
            classesIndex = {};

            for (const [teacher, daysData] of Object.entries(timetableData.timetables)) {
                for (const [day, periods] of Object.entries(daysData)) {
                    for (const [period, hours] of Object.entries(periods)) {
                        for (const [hour, lesson] of Object.entries(hours)) {
                            if (period === 'morning') morningSet.add(hour);
                            else if (period === 'afternoon') afternoonSet.add(hour);

                            const studentsName = (lesson.students || '').trim();
                            if (!studentsName) continue;

                            // Extract group info (e.g., :G1, :G2)
                            const groupMatch = studentsName.match(/:[Gg](\d+)$/);
                            const group = groupMatch ? `G${groupMatch[1]}` : null;

                            // Use the base class name (strip :G1 etc.)
                            const baseClass = studentsName.replace(/:[Gg]\d+$/g, '').trim();
                            if (!baseClass) continue;

                            if (!classesIndex[baseClass]) classesIndex[baseClass] = [];
                            classesIndex[baseClass].push({
                                teacher: teacher
                                    .replace(/_/g, ' ')
                                    .replace(/tafwij:/gi, '')
                                    .trim(),
                                day,
                                period,
                                hour,
                                subject: lesson.subject || '',
                                room: lesson.room || '',
                                group: group
                            });
                        }
                    }
                }
            }

            // Sort hours naturally
            const naturalSort =
                typeof ttNaturalSortHours === 'function'
                    ? ttNaturalSortHours
                    : (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
            discoveredMorningHours = [...morningSet].sort(naturalSort);
            discoveredAfternoonHours = [...afternoonSet].sort(naturalSort);

            // Extract levels from class names
            const classNames = sortSectionNames(Object.keys(classesIndex));
            levelsMap = extractLevels(classNames);

            populateLevelSelect(Object.keys(levelsMap));

            const badge = document.getElementById('student-class-count-badge');
            if (classNames.length > 0) {
                if (badge) badge.innerHTML = `<i class="fas fa-info-circle"></i> ${classNames.length} قسم متوفر`;

                // Re-render currently selected class if any (handles data refresh after teacher edits)
                const classSelect = document.getElementById('student-class-select');
                if (classSelect && classSelect.value && classesIndex[classSelect.value]) {
                    showClassSchedule(classSelect.value);
                }
            } else {
                showNoClassesState();
            }
        } catch (e) {
            console.error('Error loading timetable data:', e);
            showNoImportState();
        }
    }

    function extractLevels(classNames) {
        const levels = {};
        classNames.forEach((name) => {
            const level = getLevelNameFromSection(name) || name.replace(/\d+$/, '').trim() || name;
            if (!levels[level]) levels[level] = [];
            levels[level].push(name);
        });
        return levels;
    }

    function populateLevelSelect(levelNames) {
        const select = document.getElementById('student-level-select');
        if (!select) return;
        select.innerHTML = '<option value="">-- اختر المستوى --</option>';
        sortLevelNames(levelNames).forEach((name) => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = `${name} (${levelsMap[name].length})`;
            select.appendChild(opt);
        });
    }

    function getHourLabel(hourKey, period) {
        return typeof ttResolveHourLabel === 'function' ? ttResolveHourLabel(hourKey, period) : hourKey;
    }

    let subjectPalette = null;

    function _ensureSubjectPalette() {
        if (!subjectPalette || subjectPalette.length === 0) {
            subjectPalette = window.UXEnhancements?.getSharedSubjectPalette?.() || [];
        }
        return subjectPalette;
    }

    function isDarkTheme() {
        return document.documentElement.getAttribute('data-theme') === 'dark';
    }

    function getSubjectColor(subject) {
        const palette = _ensureSubjectPalette();
        if (palette.length === 0) {
            return { bg: 'var(--color-primary-mist)', border: 'var(--color-primary-light)', text: 'var(--color-primary-dark)' };
        }
        if (!subjectColorMap[subject]) {
            const idx = Object.keys(subjectColorMap).length % palette.length;
            subjectColorMap[subject] = idx;
        }
        const idx = subjectColorMap[subject];
        return isDarkTheme() ? palette[idx].dark : palette[idx].light;
    }

    function showClassSchedule(className) {
        const lessons = classesIndex[className] || [];

        // Calculate stats
        const usedSlots = lessons.length;
        const uniqueTeachers = new Set(lessons.map((l) => l.teacher));
        const uniqueSubjects = new Set(lessons.map((l) => l.subject));
        const uniqueRooms = new Set(lessons.map((l) => l.room).filter(Boolean));

        // Update stat cards
        document.getElementById('student-stat-hours').textContent = usedSlots;
        document.getElementById('student-stat-teachers').textContent = uniqueTeachers.size;
        document.getElementById('student-stat-subjects').textContent = uniqueSubjects.size;
        document.getElementById('student-stat-rooms').textContent = uniqueRooms.size;

        // Show stats with animation
        document.getElementById('student-class-stats-grid').classList.add('visible');

        const lookup = typeof ttBuildSlotLookup === 'function' ? ttBuildSlotLookup(lessons) : {};

        // Reset subject color map
        subjectColorMap = {};

        const hoursPack =
            typeof ttBuildHoursOrdered === 'function'
                ? ttBuildHoursOrdered(discoveredMorningHours, discoveredAfternoonHours)
                : { allHoursOrdered: [], separatorAfter: -1 };
        const allHoursOrdered = hoursPack.allHoursOrdered;
        const separatorAfter = hoursPack.separatorAfter;

        let html = `
<div class="class-info-bar">
  <div class="class-avatar"><i class="fas fa-users"></i></div>
  <div class="class-details">
    <h4>جدول حصص القسم : ${className}</h4>
    <span>الموسم الدراسي 2025-2026</span>
  </div>
  <div class="total-hours-badge">
    <i class="fas fa-clock"></i>
    ${usedSlots} h
  </div>
</div>
<div class="class-timetable-wrapper">
<table class="class-timetable">
  <thead>
    <tr>
      <th class="total-header" style="width:100px;">
        <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
          <span style="font-size:1.1rem;">${usedSlots} h</span>
        </div>
      </th>`;

        // Time slot headers (horizontal)
        allHoursOrdered.forEach((h, i) => {
            if (separatorAfter > 0 && i === separatorAfter) {
                html += `<th style="width:4px; padding:0; background: var(--gradient-glass);"></th>`;
            }
            html += `<th>${getHourLabel(h.key, h.period)}</th>`;
        });

        html += `</tr></thead><tbody>`;

        // Day rows (vertical, right side)
        days.forEach((day) => {
            // Pre-process this day's row to find consecutive same-subject merges
            const dayCells = []; // array of {hourIdx, period, hourKey, lessons, skip}

            allHoursOrdered.forEach((h, i) => {
                dayCells.push({
                    hourIdx: i,
                    period: h.period,
                    hourKey: h.key,
                    lessons: lookup[`${day}|${h.period}|${h.key}`] || null,
                    skip: false,
                    colspan: 1
                });
            });

            // Detect consecutive hours with same subject (no group) for merging
            for (let i = 0; i < dayCells.length - 1; i++) {
                // Don't merge across morning/afternoon boundary
                if (separatorAfter > 0 && i === separatorAfter - 1) continue;

                const curr = dayCells[i];
                const next = dayCells[i + 1];

                if (
                    curr.lessons &&
                    next.lessons &&
                    curr.lessons.length === 1 &&
                    next.lessons.length === 1 &&
                    !curr.lessons[0].group &&
                    !next.lessons[0].group &&
                    curr.lessons[0].subject === next.lessons[0].subject &&
                    curr.lessons[0].teacher === next.lessons[0].teacher &&
                    curr.period === next.period
                ) {
                    // Merge: extend current, skip next
                    curr.colspan = 2;
                    next.skip = true;
                }
            }

            html += `<tr><td class="day-cell">${day}</td>`;

            dayCells.forEach((cell, i) => {
                // Insert separator column
                if (separatorAfter > 0 && i === separatorAfter) {
                    html += `<td style="width:4px; padding:0; background: var(--color-primary-mist); border: none;"></td>`;
                }

                if (cell.skip) return;

                const colspanAttr = cell.colspan > 1 ? ` colspan="${cell.colspan}" class="merged-cell"` : '';

                if (cell.lessons && cell.lessons.length > 0) {
                    const hasGroups = cell.lessons.some((l) => l.group);

                    if (hasGroups && cell.lessons.length > 1) {
                        // TAFWIJ: Multiple groups at same slot - show vertically split
                        const sortedGroups = [...cell.lessons].sort((a, b) =>
                            (a.group || '').localeCompare(b.group || '')
                        );
                        const groupContent = sortedGroups
                            .map((lesson) => {
                                const color = getSubjectColor(lesson.subject);
                                return `
          <div class="tafwij-group" style="background: ${color.bg}; color: ${color.text};">
            <span class="group-label">${lesson.group || ''}</span>
            <div class="subject-name" style="color: ${color.text};">${lesson.subject}${lesson.group ? ':' + lesson.group : ''}</div>
            ${lesson.room ? `<div class="room-name" style="color: ${color.border};">${lesson.room}</div>` : ''}
          </div>`;
                            })
                            .join('');
                        html += `<td${colspanAttr}><div class="tafwij-cell">${groupContent}</div></td>`;
                    } else {
                        // Single lesson (or single group) — subject color fills the entire td
                        const lesson = cell.lessons[0];
                        const color = getSubjectColor(lesson.subject);
                        html += `<td${colspanAttr} style="background: ${color.bg};">
        <div class="subject-cell" style="color: ${color.text};">
          <div class="subject-name" style="color: ${color.text};">${lesson.subject}</div>
          ${lesson.room ? `<div class="room-name" style="color: ${color.border};">${lesson.room}</div>` : ''}
        </div>
      </td>`;
                    }
                } else {
                    html += `<td${colspanAttr}><span class="empty-cell"></span></td>`;
                }
            });

            html += '</tr>';
        });

        html += '</tbody></table></div>';

        // ===================================================================
        // Build the Subject-Teacher assignment table below the timetable
        // ===================================================================
        const subjectTeacherMap = {};
        lessons.forEach((l) => {
            if (l.subject && l.teacher) {
                if (!subjectTeacherMap[l.subject]) {
                    subjectTeacherMap[l.subject] = new Set();
                }
                subjectTeacherMap[l.subject].add(l.teacher);
            }
        });

        const subjectTeacherEntries = Object.entries(subjectTeacherMap).map(([subject, teachers]) => ({
            subject,
            teacher: [...teachers].join(' / ')
        }));

        if (subjectTeacherEntries.length > 0) {
            html += `
  <div class="subject-teacher-title" style="margin-top: 16px; text-align: center; font-weight: 700; font-size: 0.95rem; color: var(--color-text-main); padding: 8px 0;">
    لائحة الأساتذة المسندين حسب المواد
  </div>
  <div class="class-timetable-wrapper" style="border-width: 1px;">
  <table class="class-timetable subject-teacher-table">
    <thead>
      <tr>`;

            // Create column pairs (المادة + الأستاذ) — 3 columns per row
            const cols = 3;
            for (let c = 0; c < cols; c++) {
                const thBg = 'var(--color-surface-alt)';
                const thFg = 'var(--color-text-main)';
                html += `<th style="background: ${thBg}; color: ${thFg}; font-weight: 800;">المادة</th>`;
                html += `<th style="background: ${thBg}; color: ${thFg}; font-weight: 800;">الأستاذ</th>`;
            }
            html += `</tr></thead><tbody>`;

            const rows = Math.ceil(subjectTeacherEntries.length / cols);
            for (let r = 0; r < rows; r++) {
                html += '<tr>';
                for (let c = 0; c < cols; c++) {
                    const idx = c * rows + r;
                    if (idx < subjectTeacherEntries.length) {
                        const entry = subjectTeacherEntries[idx];
                        const color = getSubjectColor(entry.subject);
                        const bdr = 'var(--color-accent)';
                        html += `<td style="padding: 6px 10px; font-weight: 700; background: ${color.bg}; color: ${color.text}; border: 1px solid ${bdr};">${entry.subject}</td>`;
                        html += `<td style="padding: 6px 10px; border: 1px solid ${bdr}; color: var(--color-text-main);">${entry.teacher}</td>`;
                    } else {
                        const bdr = 'var(--color-accent)';
                        html += `<td style="border: 1px solid ${bdr};"></td><td style="border: 1px solid ${bdr};"></td>`;
                    }
                }
                html += '</tr>';
            }

            html += '</tbody></table></div>';
        }

        document.getElementById('student-schedule').innerHTML = html;
        document.getElementById('student-print-btn').style.display = '';
    }

    function hideStats() {
        const grid = document.getElementById('student-class-stats-grid');
        if (grid) grid.classList.remove('visible');
        const printBtn = document.getElementById('student-print-btn');
        if (printBtn) printBtn.style.display = 'none';
    }

    function showNoImportState() {
        const badge = document.getElementById('student-class-count-badge');
        if (badge) badge.innerHTML = '<span style="color: var(--color-danger);"><i class="fas fa-exclamation-triangle"></i> لا توجد بيانات</span>';
        const sched = document.getElementById('student-schedule');
        if (sched) sched.innerHTML = `
<div class="no-data-state">
  <i class="fas fa-file-import"></i>
  <h4>لم يتم استيراد بيانات استعمال الزمن بعد</h4>
  <p>يرجى استيراد ملف FET من صفحة <strong>استيراد البيانات</strong> أولاً</p>
  <a href="settings-imports.html" class="btn btn-primary" style="display: inline-block;">
    <i class="fas fa-upload"></i> الانتقال لصفحة الاستيراد
  </a>
</div>`;
    }

    function showNoClassesState() {
        const badge = document.getElementById('student-class-count-badge');
        if (badge) badge.innerHTML = '<span style="color: var(--color-warning);"><i class="fas fa-info-circle"></i> لا توجد أقسام في البيانات</span>';
        const sched = document.getElementById('student-schedule');
        if (sched) sched.innerHTML = `
<div class="no-data-state">
  <i class="fas fa-user-graduate"></i>
  <h4>لم يتم العثور على أقسام</h4>
  <p>ملف FET المستورد لا يحتوي على بيانات الأقسام</p>
</div>`;
    }

    return {
        init: init,
        loadTimetableData: loadTimetableData
    };
})();

window.StudentTimetable = StudentTimetable;
