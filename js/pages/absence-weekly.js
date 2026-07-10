        let year = '2025/2026';

        // أيام الأسبوع بنفس صيغة مفاتيح استعمال الزمن المخزَّن
        const DAYS = ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

        // الأشهر بالتسمية المغربية
        const MOROCCAN_MONTHS = [
            'يناير', 'فبراير', 'مارس', 'أبريل', 'ماي', 'يونيو',
            'يوليوز', 'غشت', 'شتنبر', 'أكتوبر', 'نونبر', 'دجنبر'
        ];

        const HOUR_LABELS = {
            h1: '08:30', h2: '09:30', h3: '10:30', h4: '11:30',
            h5: '14:30', h6: '15:30', h7: '16:30', h8: '17:30'
        };

        // ثوابت حساب الطباعة على ورقة A4 عمودية (مطابقة لهوامش PrintSystem)
        const PX_PER_MM = 96 / 25.4;                 // 96dpi CSS
        const A4_W_MM = 210, A4_H_MM = 297;
        const MARGIN_LR_MM = 4.06, MARGIN_TB_MM = 5.08; // 0.16in / 0.2in
        const PRINT_W_PX = Math.round((A4_W_MM - 2 * MARGIN_LR_MM) * PX_PER_MM); // ≈763
        const PRINT_H_PX = Math.round((A4_H_MM - 2 * MARGIN_TB_MM) * PX_PER_MM); // ≈1084
        const LETTERHEAD_PX = 155;                   // تقدير ارتفاع ترويسة المؤسسة (الصفحة الأولى)
        const MIN_FIT_ZOOM = 0.4;                    // حد أدنى للتصغير حفاظاً على القراءة

        let timetableData = null;
        let classesIndex = {}; // className -> [{ day, period, hour, subject, room, group }]
        let levelsMap = {};    // levelName -> [className...]

        // CH4: getNextMondayISO via js/shared/date-utils.js

        document.addEventListener('DOMContentLoaded', async () => {
            if (typeof getSchoolYear === 'function') year = getSchoolYear();
            await loadTimetableData();

            // تعبئة التاريخ تلقائياً بإثنين الأسبوع المقبل
            document.getElementById('week-start').value = getNextMondayISO();

            document.getElementById('level-select').addEventListener('change', onLevelChange);
            document.getElementById('class-select').addEventListener('change', () => {
                document.getElementById('week-start').value = getNextMondayISO();
            });
            document.getElementById('generate-btn').addEventListener('click', generate);
            document.getElementById('print-btn').addEventListener('click', openPreview);
        });

        async function openPreview() {
            await PrintSystem.preview({ contentSelector: '#sheet', title: 'ورقة الغياب الأسبوعية', pageSize: 'A4', landscape: false });
            injectPreviewFitControl();
        }

        async function loadTimetableData() {
            const badge = document.getElementById('data-badge');
            try {
                timetableData = await window.api.timetable.get(year);
                if (!timetableData || !timetableData.timetables) {
                    badge.innerHTML = '<span style="color:var(--color-danger);"><i class="fas fa-exclamation-triangle"></i> لم يتم استيراد بيانات استعمال الزمن بعد</span>';
                    return;
                }

                classesIndex = buildClassesIndex(timetableData.timetables);
                const classNames = (typeof sortSectionNames === 'function'
                    ? sortSectionNames(Object.keys(classesIndex))
                    : Object.keys(classesIndex).sort());

                levelsMap = extractLevels(classNames);
                populateLevelSelect(Object.keys(levelsMap));

                badge.innerHTML = `<span style="color:var(--color-success,#16a34a);"><i class="fas fa-info-circle"></i> ${classNames.length} قسم متوفر</span>`;
            } catch (e) {
                console.error('absence-weekly: failed to load timetable', e);
                badge.innerHTML = '<span style="color:var(--color-danger);"><i class="fas fa-exclamation-triangle"></i> تعذر تحميل بيانات استعمال الزمن</span>';
            }
        }

        function buildClassesIndex(timetables) {
            const index = {};
            for (const [, daysData] of Object.entries(timetables)) {
                for (const [day, periods] of Object.entries(daysData)) {
                    for (const [period, hours] of Object.entries(periods)) {
                        for (const [hour, lesson] of Object.entries(hours)) {
                            const studentsName = (lesson.students || '').trim();
                            if (!studentsName) continue;

                            const groupMatch = studentsName.match(/:[Gg](\d+)$/);
                            const group = groupMatch ? `G${groupMatch[1]}` : null;
                            const baseClass = studentsName.replace(/:[Gg]\d+$/g, '').trim();
                            if (!baseClass) continue;

                            if (!index[baseClass]) index[baseClass] = [];
                            index[baseClass].push({
                                day,
                                period,
                                hour,
                                subject: lesson.subject || '',
                                room: lesson.room || '',
                                group
                            });
                        }
                    }
                }
            }
            return index;
        }

        function extractLevels(classNames) {
            const levels = {};
            classNames.forEach((name) => {
                const level = (typeof getLevelNameFromSection === 'function'
                    ? getLevelNameFromSection(name)
                    : null) || name.replace(/\d+$/, '').trim() || name;
                if (!levels[level]) levels[level] = [];
                levels[level].push(name);
            });
            return levels;
        }

        function populateLevelSelect(levelNames) {
            const select = document.getElementById('level-select');
            select.innerHTML = '<option value="">-- اختر المستوى --</option>';
            const ordered = (typeof sortLevelNames === 'function') ? sortLevelNames(levelNames) : levelNames.sort();
            ordered.forEach((name) => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = `${name} (${levelsMap[name].length})`;
                select.appendChild(opt);
            });
        }

        function onLevelChange(e) {
            const level = e.target.value;
            const classSelect = document.getElementById('class-select');
            classSelect.innerHTML = '<option value="">-- اختر القسم --</option>';

            if (level && levelsMap[level]) {
                const sections = (typeof sortSectionNames === 'function')
                    ? sortSectionNames(levelsMap[level])
                    : levelsMap[level].slice().sort();
                sections.forEach((name) => {
                    const opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = name;
                    classSelect.appendChild(opt);
                });
                classSelect.disabled = false;
            } else {
                classSelect.disabled = true;
            }
        }

        function normSubject(subject) {
            if (typeof normalizeSubjectName === 'function') {
                const n = normalizeSubjectName(subject);
                if (n) return n;
            }
            return subject || '';
        }

        // بناء الحصص لكل يوم: خانة واحدة لكل ساعة درس فعلية للقسم
        function buildDayColumns(className) {
            const lessons = classesIndex[className] || [];
            const naturalSort = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
            const periodOrder = { morning: 0, afternoon: 1 };

            const columnsByDay = {};
            DAYS.forEach((day) => {
                const dayLessons = lessons.filter((l) => l.day === day);
                // تجميع حسب (period|hour) — دمج المجموعات في نفس الساعة
                const slotMap = {};
                dayLessons.forEach((l) => {
                    const key = `${l.period}|${l.hour}`;
                    if (!slotMap[key]) slotMap[key] = { period: l.period, hour: l.hour, subjects: new Set() };
                    if (l.subject) slotMap[key].subjects.add(normSubject(l.subject));
                });

                const slots = Object.values(slotMap).sort((a, b) => {
                    const po = (periodOrder[a.period] ?? 9) - (periodOrder[b.period] ?? 9);
                    if (po !== 0) return po;
                    return naturalSort(a.hour, b.hour);
                });

                columnsByDay[day] = slots.map((s) => ({
                    subject: [...s.subjects].join(' / ') || '—',
                    hourLabel: HOUR_LABELS[s.hour] || s.hour
                }));
            });
            return columnsByDay;
        }

        // قياس ارتفاع الورقة بمعامل مقياس معيّن عند عرض صفحة A4 الفعلي (بالبكسل)
        function measureSheetHeight(scale) {
            const src = document.querySelector('#sheet .aw-sheet');
            if (!src) return 0;
            const clone = src.cloneNode(true);
            clone.style.setProperty('--aw-scale', String(scale || 1));
            clone.style.width = '100%';
            clone.style.margin = '0';
            const wrap = document.createElement('div');
            wrap.style.cssText = `position:absolute;left:-99999px;top:0;width:${PRINT_W_PX}px;visibility:hidden;`;
            wrap.appendChild(clone);
            document.body.appendChild(wrap);
            const h = clone.scrollHeight;
            document.body.removeChild(wrap);
            return h;
        }

        // معامل المقياس لملاءمة كامل الورقة في صفحة واحدة
        function computeFitOnePageScale() {
            const natural = measureSheetHeight(1);
            const cap = PRINT_H_PX - LETTERHEAD_PX;
            if (natural <= 0 || natural <= cap) return 1;
            // هامش أمان 2% لضمان الاحتواء رغم فروق القياس
            return Math.max(MIN_FIT_ZOOM, (cap / natural) * 0.98);
        }

        // عدد الصفحات المتوقعة عند معامل مقياس معيّن (قياس فعلي بالمقياس)
        function computePageCount(scale) {
            const eff = measureSheetHeight(scale || 1);
            if (eff <= 0) return 1;
            const page1Cap = PRINT_H_PX - LETTERHEAD_PX;
            if (eff <= page1Cap) return 1;
            return 1 + Math.ceil((eff - page1Cap) / PRINT_H_PX);
        }

        // إدراج خيار "ملاءمة لصفحة واحدة" داخل نافذة معاينة الطباعة
        function injectPreviewFitControl() {
            const actions = document.querySelector('.ux-pp-modal .ux-pp-actions');
            const modalSheet = document.querySelector('.ux-pp-modal .ux-pp-sheet .aw-sheet');
            if (!actions || !modalSheet) return;

            // المودال يُعاد استخدامه — أزل أي نسخة سابقة وابدأ من الحجم الطبيعي
            document.getElementById('aw-fit-control')?.remove();
            modalSheet.style.removeProperty('--aw-scale');

            const wrap = document.createElement('label');
            wrap.id = 'aw-fit-control';
            wrap.className = 'aw-fit-toggle';
            wrap.innerHTML = `
                <input type="checkbox" id="aw-fit-checkbox">
                <span><i class="fas fa-compress"></i> ملاءمة لصفحة واحدة</span>
                <span class="aw-page-badge" id="aw-fit-count"></span>`;

            const orient = actions.querySelector('.ux-pp-orient-toggle');
            if (orient && orient.nextSibling) actions.insertBefore(wrap, orient.nextSibling);
            else actions.appendChild(wrap);

            const checkbox = wrap.querySelector('#aw-fit-checkbox');
            const countEl = wrap.querySelector('#aw-fit-count');

            const refresh = () => {
                const scale = checkbox.checked ? computeFitOnePageScale() : 1;
                if (scale === 1) modalSheet.style.removeProperty('--aw-scale');
                else modalSheet.style.setProperty('--aw-scale', String(scale));
                const pages = computePageCount(scale);
                const note = (scale < 1) ? ` — تصغير ${Math.round(scale * 100)}%` : '';
                countEl.innerHTML = `<i class="fas fa-copy"></i> ${pages} صفحة${note}`;
            };
            checkbox.addEventListener('change', refresh);
            refresh();
        }

        function formatDayDate(weekStartStr, dayIndex) {
            const base = new Date(weekStartStr + 'T00:00:00');
            if (isNaN(base.getTime())) return '';
            const d = new Date(base);
            d.setDate(base.getDate() + dayIndex);
            return `${d.getDate()} ${MOROCCAN_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
        }

        async function generate() {
            const className = document.getElementById('class-select').value;
            const weekStart = document.getElementById('week-start').value;

            if (!className || !weekStart) {
                showToast('اختر القسم وتاريخ بداية الأسبوع', 'warning');
                return;
            }

            const students = await window.api.students.search('', className, '', year) || [];
            if (students.length === 0) {
                showToast('لا يوجد تلاميذ في هذا القسم', 'warning');
            }

            const columnsByDay = buildDayColumns(className);
            const activeDays = DAYS.filter((day) => (columnsByDay[day] || []).length > 0);
            const sheetEl = document.getElementById('sheet');

            if (activeDays.length === 0) {
                sheetEl.classList.add('page-empty-state');
                sheetEl.innerHTML = `
                    <i class="fas fa-calendar-week"></i>
                    <p>لا توجد حصص مسجّلة لهذا القسم في استعمال الزمن.</p>`;
                document.getElementById('print-btn').style.display = 'none';
                return;
            }

            // إزالة padding حالة الفراغ لاستغلال كامل مساحة الورقة
            sheetEl.classList.remove('page-empty-state');

            const totalSessions = activeDays.reduce((sum, day) => sum + columnsByDay[day].length, 0);
            const levelName = (typeof getLevelNameFromSection === 'function' ? getLevelNameFromSection(className) : '') || '';

            // صف رأس الأيام
            let dayHeaderRow = '<th class="aw-num" rowspan="2">#</th><th class="aw-name" rowspan="2">الاسم الكامل</th>';
            activeDays.forEach((day) => {
                const idx = DAYS.indexOf(day);
                const dateLabel = formatDayDate(weekStart, idx);
                dayHeaderRow += `<th class="aw-day aw-day-sep" colspan="${columnsByDay[day].length}">${day}<br><small>${dateLabel}</small></th>`;
            });
            dayHeaderRow += '<th class="aw-total aw-total-head" rowspan="2"><span class="aw-total-label">المجموع</span></th>';

            // colgroup ديناميكي: يضمن اتساع كل الأعمدة داخل عرض صفحة portrait
            const NUM_W = 2.4, NAME_W = 15, TOTAL_W = 3.2;
            const sessW = (100 - NUM_W - NAME_W - TOTAL_W) / totalSessions;
            let colgroup = `<col style="width:${NUM_W}%"><col style="width:${NAME_W}%">`;
            for (let c = 0; c < totalSessions; c++) colgroup += `<col style="width:${sessW}%">`;
            colgroup += `<col style="width:${TOTAL_W}%">`;

            // صف رأس المواد (عمودي)
            let subjectHeaderRow = '';
            activeDays.forEach((day) => {
                columnsByDay[day].forEach((col, i) => {
                    const sepClass = i === 0 ? ' aw-day-sep' : '';
                    subjectHeaderRow += `<th class="aw-subject${sepClass}"><span class="aw-subject-name" title="${col.subject}">${col.subject}</span><span class="aw-hour">${col.hourLabel}</span></th>`;
                });
            });

            // صفوف التلاميذ
            const bodyRows = students.map((s, i) => {
                let cells = '';
                activeDays.forEach((day) => {
                    columnsByDay[day].forEach((col, ci) => {
                        const sepClass = ci === 0 ? ' aw-day-sep' : '';
                        cells += `<td class="aw-cell${sepClass}"></td>`;
                    });
                });
                return `
                    <tr>
                        <td class="aw-num">${i + 1}</td>
                        <td class="aw-name">${s.full_name || '-'}</td>
                        ${cells}
                        <td class="aw-total"></td>
                    </tr>`;
            }).join('');

            sheetEl.innerHTML = `
                <div class="aw-sheet">
                    <div class="aw-info-bar">
                        <span><strong>القسم:</strong> ${className}</span>
                        ${levelName ? `<span><strong>المستوى:</strong> ${levelName}</span>` : ''}
                        <span><strong>الأسبوع من:</strong> ${formatDayDate(weekStart, 0)}</span>
                        <span><strong>السنة الدراسية:</strong> ${year}</span>
                        <span><strong>عدد الحصص:</strong> ${totalSessions}</span>
                    </div>
                    <table class="aw-table">
                        <colgroup>${colgroup}</colgroup>
                        <thead>
                            <tr>${dayHeaderRow}</tr>
                            <tr>${subjectHeaderRow}</tr>
                        </thead>
                        <tbody>
                            ${bodyRows}
                        </tbody>
                    </table>
                </div>
            `;

            document.getElementById('print-btn').style.display = '';

            showToast('تم توليد ورقة الغياب الخاصة بالقسم', 'success');
        }
    
