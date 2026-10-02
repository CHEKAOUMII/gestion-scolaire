const RoomTimetable = (function() {
    // C5: days / hour labels / theme via js/shared/timetable-view.js (+ utils hour maps)
    const days = typeof TT_VIEW_DAYS !== 'undefined' ? TT_VIEW_DAYS : ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

    let discoveredMorningHours = [];
    let discoveredAfternoonHours = [];

    let timetableData = null;
    let roomsIndex = {};

    let _listenersAttached = false;

    function init() {
        loadTimetableData();

        if (_listenersAttached) return;
        _listenersAttached = true;

        const roomSelect = document.getElementById('room-room-select');
        if (roomSelect) {
            roomSelect.addEventListener('change', (e) => {
                if (e.target.value) {
                    showRoomSchedule(e.target.value);
                } else {
                    hideStats();
                    document.getElementById('room-schedule').innerHTML = `
        <div class="no-data-state">
          <i class="fas fa-door-open"></i>
          <h4>اختر قاعة لعرض جدول استعمالها</h4>
          <p>سيتم عرض الجدول الأسبوعي مع معلومات الأساتذة والمواد</p>
        </div>`;
                }
            });
        }

        const printBtn = document.getElementById('room-print-btn');
        if (printBtn) {
            printBtn.addEventListener('click', () => {
                const roomName = document.getElementById('room-room-select')?.value || '';
                const title = roomName ? `جدول القاعة - ${roomName}` : 'جدول القاعات';
                const safeName = typeof ttSafeFileName === 'function' ? ttSafeFileName(roomName || 'rooms') : (roomName || 'rooms');
                PrintSystem.preview({
                    contentSelector: '#room-schedule',
                    title,
                    pageSize: 'A4',
                    landscape: true,
                    density: 1,
                    showDensityControl: true,
                    defaultFileName: `جدول_قاعة_${safeName}.pdf`
                });
            });
        }

        if (typeof ttObserveTheme === 'function') {
            ttObserveTheme(() => {
                if (roomSelect?.value) showRoomSchedule(roomSelect.value);
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

            const morningSet = new Set();
            const afternoonSet = new Set();
            roomsIndex = {};

            for (const [teacher, daysData] of Object.entries(timetableData.timetables)) {
                for (const [day, periods] of Object.entries(daysData)) {
                    for (const [period, hours] of Object.entries(periods)) {
                        for (const [hour, lesson] of Object.entries(hours)) {
                            if (period === 'morning') morningSet.add(hour);
                            else if (period === 'afternoon') afternoonSet.add(hour);

                            const roomName = (lesson.room || '').trim();
                            if (!roomName) continue;

                            if (!roomsIndex[roomName]) roomsIndex[roomName] = [];
                            roomsIndex[roomName].push({
                                teacher: teacher.replace(/_/g, ' '),
                                day,
                                period,
                                hour,
                                subject: lesson.subject || '',
                                students: (lesson.students || '').replace(/:[Gg]\d+$/g, '').trim()
                            });
                        }
                    }
                }
            }

            const naturalSort = typeof ttNaturalSortHours === 'function' ? ttNaturalSortHours : (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
            discoveredMorningHours = [...morningSet].sort(naturalSort);
            discoveredAfternoonHours = [...afternoonSet].sort(naturalSort);

            const roomNames = Object.keys(roomsIndex).sort((a, b) => a.localeCompare(b, 'ar'));
            populateRoomSelect(roomNames);

            const badge = document.getElementById('room-count-badge');
            if (roomNames.length > 0) {
                // Re-render currently selected room if any (handles data refresh after teacher edits)
                const roomSelect = document.getElementById('room-room-select');
                if (roomSelect && roomSelect.value && roomsIndex[roomSelect.value]) {
                    showRoomSchedule(roomSelect.value);
                }
            } else {
                showNoRoomsState();
            }
        } catch (e) {
            console.error('Error loading timetable data:', e);
            showNoImportState();
        }
    }

    function getHourLabel(hourKey, period) {
        return typeof ttResolveHourLabel === 'function'
            ? ttResolveHourLabel(hourKey, period)
            : hourKey;
    }

    function populateRoomSelect(roomNames) {
        const select = document.getElementById('room-room-select');
        if (!select) return;
        select.innerHTML = '<option value="">-- اختر قاعة --</option>';
        roomNames.forEach((name) => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            select.appendChild(opt);
        });
        const badge = document.getElementById('room-count-badge');
        if (badge) badge.innerHTML = `<i class="fas fa-info-circle"></i> ${roomNames.length} قاعة متاحة`;
    }

    /* ── Theme-aware color palettes ── */
    function isDarkTheme() {
        return document.documentElement.getAttribute('data-theme') === 'dark';
    }

    const TEACHER_COLORS = [
        { light: { bg: '#FFCC80', fg: '#4E342E' }, dark: { bg: 'rgba(255,204,128,0.22)', fg: '#fde68a' } },
        { light: { bg: '#EF9A9A', fg: '#7B0000' }, dark: { bg: 'rgba(239,154,154,0.22)', fg: '#fca5a5' } },
        { light: { bg: '#A5D6A7', fg: '#1B5E20' }, dark: { bg: 'rgba(165,214,167,0.22)', fg: '#86efac' } },
        { light: { bg: '#CE93D8', fg: '#4A148C' }, dark: { bg: 'rgba(206,147,216,0.22)', fg: '#d8b4fe' } },
        { light: { bg: '#80CBC4', fg: '#004D40' }, dark: { bg: 'rgba(128,203,196,0.22)', fg: '#5eead4' } },
        { light: { bg: '#FFE082', fg: '#5D4037' }, dark: { bg: 'rgba(255,224,130,0.22)', fg: '#fef08a' } },
        { light: { bg: '#90CAF9', fg: '#0D47A1' }, dark: { bg: 'rgba(144,202,249,0.22)', fg: '#93c5fd' } },
        { light: { bg: '#FFAB91', fg: '#7B1A00' }, dark: { bg: 'rgba(255,171,145,0.22)', fg: '#fdba74' } },
        { light: { bg: '#B39DDB', fg: '#311B92' }, dark: { bg: 'rgba(179,157,219,0.22)', fg: '#c4b5fd' } },
        { light: { bg: '#C5E1A5', fg: '#33691E' }, dark: { bg: 'rgba(197,225,165,0.22)', fg: '#bef264' } },
        { light: { bg: '#81D4FA', fg: '#01579B' }, dark: { bg: 'rgba(129,212,250,0.22)', fg: '#7dd3fc' } },
        { light: { bg: '#BCAAA4', fg: '#3E2723' }, dark: { bg: 'rgba(188,170,164,0.22)', fg: '#d6d3d1' } },
        { light: { bg: '#FFF59D', fg: '#7B4A00' }, dark: { bg: 'rgba(255,245,157,0.22)', fg: '#fef08a' } },
        { light: { bg: '#F48FB1', fg: '#560031' }, dark: { bg: 'rgba(244,143,177,0.22)', fg: '#f9a8d4' } },
        { light: { bg: '#9FA8DA', fg: '#1A237E' }, dark: { bg: 'rgba(159,168,218,0.22)', fg: '#a5b4fc' } }
    ];

    const SECTION_COLORS = [
        { light: { bg: '#E8F5E9', fg: '#2E7D32' }, dark: { bg: 'rgba(46,125,50,0.18)', fg: '#86efac' } },
        { light: { bg: '#E3F2FD', fg: '#1565C0' }, dark: { bg: 'rgba(21,101,192,0.18)', fg: '#93c5fd' } },
        { light: { bg: '#FFF3E0', fg: '#E65100' }, dark: { bg: 'rgba(230,81,0,0.18)', fg: '#fdba74' } },
        { light: { bg: '#FCE4EC', fg: '#C62828' }, dark: { bg: 'rgba(198,40,40,0.18)', fg: '#fca5a5' } },
        { light: { bg: '#F3E5F5', fg: '#6A1B9A' }, dark: { bg: 'rgba(106,27,154,0.18)', fg: '#d8b4fe' } },
        { light: { bg: '#E0F7FA', fg: '#00695C' }, dark: { bg: 'rgba(0,105,92,0.18)', fg: '#5eead4' } },
        { light: { bg: '#FFF8E1', fg: '#7B3A00' }, dark: { bg: 'rgba(123,58,0,0.18)', fg: '#fde68a' } },
        { light: { bg: '#E8EAF6', fg: '#283593' }, dark: { bg: 'rgba(40,53,147,0.18)', fg: '#a5b4fc' } },
        { light: { bg: '#F1F8E9', fg: '#33691E' }, dark: { bg: 'rgba(51,105,30,0.18)', fg: '#bef264' } },
        { light: { bg: '#EFEBE9', fg: '#4E342E' }, dark: { bg: 'rgba(78,52,46,0.18)', fg: '#d6d3d1' } },
        { light: { bg: '#E0F2F1', fg: '#004D40' }, dark: { bg: 'rgba(0,77,64,0.18)', fg: '#99f6e4' } },
        { light: { bg: '#E1F5FE', fg: '#01579B' }, dark: { bg: 'rgba(1,87,155,0.18)', fg: '#7dd3fc' } },
        { light: { bg: '#FBE9E7', fg: '#BF360C' }, dark: { bg: 'rgba(191,54,12,0.18)', fg: '#fdba74' } },
        { light: { bg: '#EDE7F6', fg: '#4527A0' }, dark: { bg: 'rgba(69,39,160,0.18)', fg: '#c4b5fd' } },
        { light: { bg: '#F9FBE7', fg: '#4A4300' }, dark: { bg: 'rgba(74,67,0,0.18)', fg: '#fef08a' } }
    ];

    let teacherColorMap = {};
    let sectionColorMap = {};

    function getTeacherColor(teacher) {
        if (!teacherColorMap[teacher]) {
            const idx = Object.keys(teacherColorMap).length % TEACHER_COLORS.length;
            teacherColorMap[teacher] = idx;
        }
        const idx = teacherColorMap[teacher];
        const entry = TEACHER_COLORS[idx];
        return isDarkTheme() ? entry.dark : entry.light;
    }

    function getSectionColor(section) {
        if (!sectionColorMap[section]) {
            const idx = Object.keys(sectionColorMap).length % SECTION_COLORS.length;
            sectionColorMap[section] = idx;
        }
        const idx = sectionColorMap[section];
        const entry = SECTION_COLORS[idx];
        return isDarkTheme() ? entry.dark : entry.light;
    }

    function showRoomSchedule(roomName) {
        const lessons = roomsIndex[roomName] || [];

        // Calculate stats
        const allHours = [...discoveredMorningHours, ...discoveredAfternoonHours];
        const totalSlots = days.length * allHours.length;
        const usedSlots = lessons.length;
        const usagePercent = totalSlots > 0 ? Math.round((usedSlots / totalSlots) * 100) : 0;
        const uniqueTeachers = new Set(lessons.map((l) => l.teacher));
        const uniqueSubjects = new Set(lessons.map((l) => l.subject));

        // Update stat cards
        const usageEl = document.getElementById('room-stat-usage');
        const usageCard = usageEl?.closest('.class-stat-card, .room-stat-card');
        if (usageEl) usageEl.textContent = usagePercent + '%';
        if (usageCard) {
            usageCard.classList.toggle('usage-high', usagePercent >= 80);
            usageCard.classList.toggle('usage-medium', usagePercent >= 50 && usagePercent < 80);
            usageCard.title =
                usagePercent >= 80
                    ? 'استغلال مرتفع — القاعة مشغولة معظم الوقت'
                    : usagePercent >= 50
                      ? 'استغلال متوسط'
                      : 'استغلال منخفض';
        }
        document.getElementById('room-stat-hours').textContent = usedSlots;
        document.getElementById('room-stat-teachers').textContent = uniqueTeachers.size;
        document.getElementById('room-stat-subjects').textContent = uniqueSubjects.size;

        document.getElementById('room-stats-grid').classList.add('visible');

        const lookup =
            typeof ttBuildSlotLookup === 'function'
                ? ttBuildSlotLookup(lessons)
                : {};

        // Reset color maps for this room
        teacherColorMap = {};
        sectionColorMap = {};

        const hoursPack =
            typeof ttBuildHoursOrdered === 'function'
                ? ttBuildHoursOrdered(discoveredMorningHours, discoveredAfternoonHours)
                : { allHoursOrdered: [], separatorAfter: -1 };
        const allHoursOrdered = hoursPack.allHoursOrdered;
        const separatorAfter = hoursPack.separatorAfter;

        let html = `
<div class="room-info-bar">
  <div class="room-details">
    <h4>جدول حصص :  ${roomName}</h4>
    <span>الموسم الدراسي 2025-2026</span>
  </div>
  <div class="total-hours-badge">
    ${usedSlots} h
  </div>
</div>
<div class="room-timetable-wrapper">
<table class="room-timetable">
  <thead>
    <tr>
      <th class="total-header" style="width:100px;">
        <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
          <span style="font-size:1.1rem;">${usedSlots} h</span>
        </div>
      </th>`;

        // Time slot headers
        allHoursOrdered.forEach((h, i) => {
            if (separatorAfter > 0 && i === separatorAfter) {
                html += `<th style="width:4px; padding:0; background: linear-gradient(180deg, rgba(255,255,255,0.3), rgba(255,255,255,0.1));"></th>`;
            }
            html += `<th>${getHourLabel(h.key, h.period)}</th>`;
        });

        html += `</tr></thead><tbody>`;

        // Day rows
        days.forEach((day) => {
            // Pre-process for consecutive merging
            const dayCells = [];
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

            // Detect consecutive hours with same subject+teacher for merging (supports 2, 3, 4+ hours)
            for (let i = 0; i < dayCells.length - 1; i++) {
                if (dayCells[i].skip) continue;
                if (separatorAfter > 0 && i === separatorAfter - 1) continue;

                const anchor = dayCells[i];
                if (!anchor.lessons || anchor.lessons.length !== 1) continue;

                let span = 1;
                const mergedSections = [anchor.lessons[0].students || ''];
                for (let j = i + 1; j < dayCells.length; j++) {
                    if (separatorAfter > 0 && j === separatorAfter) break;
                    const next = dayCells[j];
                    if (!next.lessons || next.lessons.length !== 1) break;
                    if (
                        next.lessons[0].subject !== anchor.lessons[0].subject ||
                        next.lessons[0].teacher !== anchor.lessons[0].teacher ||
                        next.period !== anchor.period
                    )
                        break;
                    span++;
                    mergedSections.push(next.lessons[0].students || '');
                    next.skip = true;
                }
                if (span > 1) {
                    anchor.colspan = span;
                    anchor.mergedSections = mergedSections;
                }
            }

            html += `<tr><td class="day-cell">${day}</td>`;

            dayCells.forEach((cell, i) => {
                if (separatorAfter > 0 && i === separatorAfter) {
                    html += `<td style="width:4px; padding:0; background: linear-gradient(180deg, rgba(45,95,74,0.08), transparent); border: none;"></td>`;
                }

                if (cell.skip) return;

                const colspanAttr = cell.colspan > 1 ? ` colspan="${cell.colspan}"` : '';

                if (cell.lessons && cell.lessons.length > 0) {
                    const lessonsAtSlot = [...cell.lessons].sort((a, b) => {
                        const aKey = `${a.teacher}|${a.subject}|${a.students || ''}`;
                        const bKey = `${b.teacher}|${b.subject}|${b.students || ''}`;
                        return aKey.localeCompare(bKey, 'ar');
                    });

                    // Merged cell: sections side-by-side, teacher spanning below
                    if (cell.mergedSections && cell.mergedSections.length > 1) {
                        const lesson = lessonsAtSlot[0];
                        const tc = getTeacherColor(lesson.teacher);
                        const uniqueSections = [...new Set(cell.mergedSections)];
                        const allSame = uniqueSections.length === 1;
                        let sectionsRow = '';
                        if (allSame && uniqueSections[0]) {
                            const sc = getSectionColor(uniqueSections[0]);
                            sectionsRow = `<div class="class-name" style="background:${sc.bg};color:${sc.fg}">${uniqueSections[0]}</div>`;
                        } else {
                            sectionsRow = `<div style="display:flex">${cell.mergedSections
                                .map((s) => {
                                    if (!s) return '<span style="flex:1"></span>';
                                    const sc = getSectionColor(s);
                                    return `<span class="class-name" style="background:${sc.bg};color:${sc.fg};flex:1">${s}</span>`;
                                })
                                .join('')}</div>`;
                        }
                        const cellContent = `<div class="subject-cell">${sectionsRow}<div class="teacher-name" style="color:${tc.fg}">${lesson.teacher} : (${lesson.subject})</div></div>`;
                        html += `<td${colspanAttr} class="merged-cell" style="background:${tc.bg};">${cellContent}</td>`;
                    } else if (lessonsAtSlot.length > 1) {
                        // Multiple lessons stacked in same slot
                        const cellContent = lessonsAtSlot
                            .map((lesson) => {
                                const tc = getTeacherColor(lesson.teacher);
                                const sc = lesson.students ? getSectionColor(lesson.students) : null;
                                return `
          <div class="subject-cell" style="background:${tc.bg};">
            ${lesson.students ? `<div class="class-name" style="background:${sc.bg};color:${sc.fg}">${lesson.students}</div>` : ''}
            <div class="teacher-name" style="color:${tc.fg}">${lesson.teacher} : (${lesson.subject})</div>
          </div>`;
                            })
                            .join('');
                        const tdClasses = ['has-multiple-lessons'];
                        if (cell.colspan > 1) tdClasses.push('merged-cell');
                        html += `<td${colspanAttr} class="${tdClasses.join(' ')}"><div class="subject-stack">${cellContent}</div></td>`;
                    } else {
                        // Single lesson — teacher color fills the entire td
                        const lesson = lessonsAtSlot[0];
                        const tc = getTeacherColor(lesson.teacher);
                        const sc = lesson.students ? getSectionColor(lesson.students) : null;
                        const tdClasses = cell.colspan > 1 ? ' class="merged-cell"' : '';
                        html += `<td${colspanAttr}${tdClasses} style="background:${tc.bg};">
        <div class="subject-cell">
          ${lesson.students ? `<div class="class-name" style="background:${sc.bg};color:${sc.fg}">${lesson.students}</div>` : ''}
          <div class="teacher-name" style="color:${tc.fg}">${lesson.teacher} : (${lesson.subject})</div>
        </div>
      </td>`;
                    }
                } else {
                    const classAttr = cell.colspan > 1 ? ' class="merged-cell"' : '';
                    html += `<td${colspanAttr}${classAttr}><span class="empty-cell">◇</span></td>`;
                }
            });

            html += '</tr>';
        });

        html += '</tbody></table></div>';

        document.getElementById('room-schedule').innerHTML = html;
        document.getElementById('room-print-btn').style.display = '';
    }

    function hideStats() {
        const grid = document.getElementById('room-stats-grid');
        if (grid) grid.classList.remove('visible');
        const printBtn = document.getElementById('room-print-btn');
        if (printBtn) printBtn.style.display = 'none';
    }

    function showNoImportState() {
        const badge = document.getElementById('room-count-badge');
        if (badge) badge.innerHTML = '<span style="color: #ef4444;"><i class="fas fa-exclamation-triangle"></i> لا توجد بيانات</span>';
        const sched = document.getElementById('room-schedule');
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

    function showNoRoomsState() {
        const badge = document.getElementById('room-count-badge');
        if (badge) badge.innerHTML = '<span style="color: #f59e0b;"><i class="fas fa-info-circle"></i> لا توجد قاعات في البيانات</span>';
        const sched = document.getElementById('room-schedule');
        if (sched) sched.innerHTML = `
<div class="no-data-state">
  <i class="fas fa-door-open"></i>
  <h4>لم يتم العثور على قاعات</h4>
  <p>ملف FET المستورد لا يحتوي على بيانات القاعات</p>
</div>`;
    }

    return {
        init: init,
        loadTimetableData: loadTimetableData
    };
})();

window.RoomTimetable = RoomTimetable;
