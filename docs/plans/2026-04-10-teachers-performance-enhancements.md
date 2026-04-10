# خطة تطوير صفحة مؤشرات أداء الأساتذة

## Context

الصفحة `teachers-performance.html` + `js/pages/teachers-performance.js` تعرض تحليلاً شاملاً لأداء الأساتذة. المستخدم يطلب ثلاثة تطويرات رئيسية:

1. **KPI بمحورين**: إضافة زر تبديل بين عرض المؤشرات "حسب الأستاذ" و"حسب المادة"
2. **طباعة/تصدير PDF**: إضافة زر معاينة وطباعة باستخدام البنية الموجودة (`main/print-window.js`)
3. **منحنيات القسم في الرسم البياني للتطور**: إضافة خطوط فرعية بحسب القسم فوق المنحنى العام الموجود

---

## الملفات الحرجة

| الملف | الدور |
|-------|-------|
| `teachers-performance.html` | HTML الصفحة — سنضيف زر print وزر toggle |
| `js/pages/teachers-performance.js` | المنطق الكامل — موضع التعديلات الرئيسية |
| `css/tailwind-input.css` | CSS — إضافة أنماط KPI-toggle + print media query |
| `main/print-window.js` | موجود، لا يُعدَّل — يُستخدم عبر IPC |
| `preload.js` | التحقق: هل `window.electronAPI.printHTML` موجود؟ |

---

## التفاصيل التقنية المكتشفة

- **`populateTeachersBySubject(selectEl, grades, defaultLabel)`** — موجودة في `js/utils.js:2340`، تُستخدم فعلاً في السطر 230
- **`FilterManager`** مع `subjectsFromGrades: true` — يُحمِّل الدرجات ويجعل `allGradesCache` مزامَناً
- **`main/print-window.js`**: يقبل `{ htmlContent, inlineStyles, title, pageSize, landscape, mode, defaultFileName }` — يضمّن `tailwind-output.css` تلقائياً
- **لا يوجد** `@media print` لـ `.tp-*` حالياً
- **لا يوجد** نمط toggle/tab مشترك — نبنيه من الصفر باتباع نمط `selectedTeacherName` / `currentSubjectFilter`
- الرسم البياني للتطور `tp-trend-chart` موجود في `.tp-chart-short` (يجب رفعه لـ `.tp-chart-medium` عند تفعيل خطوط الأقسام)

---

## الخطة التفصيلية

### الجزء 1: KPI بمحورين (حسب الأستاذ / حسب المادة)

**الهدف:** إضافة شريط toggle فوق بطاقات KPI يتيح التبديل بين عرضين:
- **حسب الأستاذ** (الوضع الافتراضي): المؤشرات الحالية الستة كما هي
- **حسب المادة**: يُعيد حساب المؤشرات مُجمَّعةً حول المواد (معدل المادة، نسبة نجاحها، أفضل/أضعف مادة، عدد الأساتذة الذين درّسوها)

**التعديلات:**

**`teachers-performance.html`** — إضافة شريط toggle فوق `#tp-kpis`:
```html
<div class="tp-kpi-toggle" id="tp-kpi-toggle">
    <button class="tp-toggle-btn active" data-kpi-view="teacher">
        <i class="fas fa-chalkboard-teacher"></i> حسب الأستاذ
    </button>
    <button class="tp-toggle-btn" data-kpi-view="subject">
        <i class="fas fa-book-open"></i> حسب المادة
    </button>
</div>
<div id="tp-kpis" class="tp-kpis"></div>
```

**`js/pages/teachers-performance.js`:**
- إضافة متغير: `let kpiView = 'teacher';` (سطر 17 تقريباً)
- ربط أحداث الـ toggle في `bindEvents()`:
  ```js
  document.querySelectorAll('.tp-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
          kpiView = btn.dataset.kpiView;
          document.querySelectorAll('.tp-toggle-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          renderKpis(lastBaseFiltered, teacherRowsCache);
      });
  });
  ```
- تعديل `renderKpis(baseFiltered, rows)`:
  - حفظ `lastBaseFiltered` في متغير module-level
  - إضافة branch: إذا `kpiView === 'subject'` → حساب مؤشرات المواد وعرض 6 بطاقات مختلفة
  - بنية بطاقات المادة: اسم المادة، المعدل، نسبة النجاح، عدد الأساتذة، عدد التلاميذ، أفضل/أضعف

**`css/tailwind-input.css`** — في القسم المخصص لـ `.tp-*`:
```css
.tp-kpi-toggle { display: flex; gap: 8px; margin-bottom: 16px; }
.tp-toggle-btn {
    padding: 6px 16px; border-radius: 20px; border: 1px solid var(--color-border);
    background: var(--color-surface); cursor: pointer; font-size: 13px;
    transition: all 0.2s;
}
.tp-toggle-btn.active {
    background: var(--color-primary); color: white; border-color: var(--color-primary);
}
```

---

### الجزء 2: طباعة ومعاينة PDF

**الهدف:** زر "طباعة / PDF" يفتح نافذة معاينة أو يصدر PDF بالمحتوى الكامل (KPIs + الجدول + الرسوم البيانية كصور).

**التعديلات:**

**`teachers-performance.html`** — إضافة زر print في `header-right` (جانب `tp-export-btn`):
```html
<button class="btn btn-secondary" id="tp-print-btn" title="طباعة / PDF">
    <i class="fas fa-print"></i> طباعة
</button>
```

**`js/pages/teachers-performance.js`:**

1. ربط الزر في `bindEvents()`:
```js
const printBtn = document.getElementById('tp-print-btn');
if (printBtn) printBtn.addEventListener('click', printReport);
```

2. دالة `buildPrintHTML()`:
   - لقطة بطاقات KPI من DOM (innerHTML of `#tp-kpis`)
   - لقطة الجدول (innerHTML of `.tp-table-wrap`)
   - تحويل كل canvas للرسوم البيانية لـ base64 (`canvas.toDataURL('image/png')`) وتضمينها كـ `<img>`
   - بناء HTML كامل للتقرير (بلا sidebar أو header)

3. دالة `printReport()`:
```js
async function printReport() {
    if (!teacherRowsCache.length) { showToast('لا توجد بيانات للطباعة', 'error'); return; }
    const handle = showToast.loading('جاري تجهيز التقرير...');
    try {
        const html = buildPrintHTML();
        const result = await window.electronAPI.printHTML({
            htmlContent: html,
            title: 'تقرير مؤشرات أداء الأساتذة',
            pageSize: 'A4',
            landscape: true,
            mode: 'preview',   // نافذة معاينة — المستخدم يختار طباعة أو PDF منها
            defaultFileName: `teachers-performance-${new Date().toISOString().slice(0,10)}.pdf`,
            skipAutoLetterhead: false
        });
        if (result?.success) handle.success('تم تصدير التقرير');
        else handle.error(result?.error || 'فشل التصدير');
    } catch (e) {
        handle.error('فشل التصدير');
    }
}
```

**`css/tailwind-input.css`** — إضافة `@media print` لـ `.tp-*`:
```css
@media print {
    .sidebar, .header, .search-section, .tp-kpi-toggle,
    .tp-filters-actions, #tp-loading-overlay { display: none !important; }
    .tp-kpis { grid-template-columns: repeat(3, 1fr) !important; }
    .tp-block { page-break-inside: avoid; }
    .tp-table th, .tp-table td { font-size: 11px; padding: 4px 6px; }
    @page { margin: 1.5cm; size: A4 landscape; }
}
```

**ملاحظة:** `window.electronAPI.printHTML` — يجب التحقق في `preload.js` أن القناة مربوطة. إن كان الاسم مختلفاً (مثلاً `window.api.print.printHTML`) يُعدَّل الاستدعاء فقط.

---

### الجزء 3: منحنيات القسم في "تطور الأداء بين الفروض"

**الهدف:** إضافة خطوط فرعية ملوّنة (خط لكل قسم) فوق المنحنى العام الموجود في `tp-trend-chart`.

**التعديلات:**

**`teachers-performance.html`** — رفع class الـ wrap من `tp-chart-short` إلى `tp-chart-medium` في block بطاقة الأستاذ:
```html
<!-- السطر 172: من tp-chart-wrap tp-chart-short إلى: -->
<div class="tp-chart-wrap tp-chart-medium">
    <canvas id="tp-trend-chart" ...></canvas>
</div>
```

**`js/pages/teachers-performance.js`** — تعديل `renderTeacherTrendChart(teacherGrades, noteNode)`:

```js
function renderTeacherTrendChart(teacherGrades, noteNode) {
    const canvas = document.getElementById('tp-trend-chart');
    if (!canvas || !window.Chart || !noteNode) return;
    destroyChart('trend');

    // Build global average per exam
    const byExam = {};
    const bySectionExam = {};  // { section: { examNo: [grades] } }

    teacherGrades.forEach(g => {
        if (!g._examNo) return;
        if (!byExam[g._examNo]) byExam[g._examNo] = [];
        byExam[g._examNo].push(g.grade);

        const sec = String(g.section || 'غير محدد');
        if (!bySectionExam[sec]) bySectionExam[sec] = {};
        if (!bySectionExam[sec][g._examNo]) bySectionExam[sec][g._examNo] = [];
        bySectionExam[sec][g._examNo].push(g.grade);
    });

    const examKeys = Object.keys(byExam).map(Number)
        .filter(n => Number.isFinite(n)).sort((a, b) => a - b);
    if (!examKeys.length) { noteNode.textContent = 'لا توجد فروض مرقمة.'; return; }

    const labels = examKeys.map(n => `فرض ${n}`);
    const globalValues = examKeys.map(n => Number(avg(byExam[n]).toFixed(2)));

    // Palette for sections (up to 8)
    const SECTION_COLORS = [
        'rgba(59,106,197,0.85)', 'rgba(47,179,109,0.85)', 'rgba(231,76,60,0.85)',
        'rgba(240,194,14,0.85)', 'rgba(155,100,171,0.85)', 'rgba(22,160,133,0.85)',
        'rgba(243,156,18,0.85)', 'rgba(52,73,94,0.85)'
    ];

    const sections = Object.keys(bySectionExam).sort((a, b) => a.localeCompare(b, 'ar'));
    const showSections = sections.length > 1; // لا داعي إن كان قسم واحد فقط

    const sectionDatasets = !showSections ? [] : sections.slice(0, 8).map((sec, i) => ({
        label: sec,
        data: examKeys.map(n => {
            const vals = bySectionExam[sec]?.[n];
            return vals?.length ? Number(avg(vals).toFixed(2)) : null;
        }),
        borderColor: SECTION_COLORS[i % SECTION_COLORS.length],
        backgroundColor: 'transparent',
        pointRadius: 3,
        pointHoverRadius: 4,
        tension: 0.3,
        fill: false,
        spanGaps: true,
        borderDash: [5, 3]  // خط منقط للتمييز عن الخط العام
    }));

    const globalDataset = {
        label: 'المتوسط العام',
        data: globalValues,
        borderColor: 'rgba(155,100,171,0.95)',
        backgroundColor: 'rgba(155,100,171,0.15)',
        pointBackgroundColor: 'rgba(155,100,171,1)',
        pointRadius: 5,
        pointHoverRadius: 6,
        tension: 0.35,
        fill: true,
        borderWidth: 2.5
    };

    charts.trend = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels, datasets: [globalDataset, ...sectionDatasets] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 650, easing: 'easeOutQuart' },
            plugins: {
                legend: { display: showSections, position: 'bottom',
                    labels: { usePointStyle: true, pointStyle: 'line', padding: 12, font: { size: 11 } } },
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${Number(ctx.raw).toFixed(2)}` } }
            },
            scales: {
                y: { min: 0, max: 20, ticks: { stepSize: 4 }, grid: { color: 'rgba(0,0,0,0.05)' } },
                x: { grid: { display: false } }
            }
        }
    });

    const sectionInfo = showSections ? ` · ${sections.length} قسم` : '';
    noteNode.textContent = `تطور عبر ${examKeys.length} فروض مرقمة${sectionInfo}.`;
    updateChartAccessibility('tp-trend-chart', 'رسم بياني يوضح تطور الأداء بين الفروض حسب القسم',
        'tp-trend-note', noteNode.textContent);
}
```

---

### الجزء 4: قسم "الحصص التعويضية وحصص الدعم" (Block جديد)

**الهدف:** إضافة block خامس في أسفل الصفحة يعرض ثلاثة مبيانات مترابطة:
1. **مبيان 1 — الحصص الضائعة بسبب الغياب** (bar chart أفقي): عدد الحصص الواجب تعويضها لكل أستاذ (من `compensation_tracking`)
2. **مبيان 2 — الأقسام المتضررة غير المعوَّضة** (bar chart أفقي): الأقسام التي لم تُعوَّض حصصها بعد، مرتبة حسب عدد الحصص الضائعة
3. **مبيان 3 — حصص الدعم المنجزة** (bar chart): عدد ساعات الدعم التي أنجزها كل أستاذ (من `supportSessions`)

**مصادر البيانات:**
- `window.api.compensation.getPending(year)` → يعيد كل سجلات التعويض (معوَّضة وغير معوَّضة)
  - حقول السجل: `absence_date, teacher_name, section, subject, period_slot, compensated, school_year`
- `window.api.supportSessions.list({ school_year })` → يعيد حصص الدعم
  - حقول السجل: `session_date, teacher_name, subject, section, time_from, time_to, duration_hours, attendance_status`

**التعديلات:**

**`teachers-performance.html`** — إضافة block جديد بعد Block 4:
```html
<!-- Block 5: Compensation & Support -->
<details class="tp-block" open>
    <summary><i class="fas fa-exchange-alt"></i> الحصص التعويضية وحصص الدعم</summary>
    <div class="tp-block-body">
        <div class="tp-grid-three">
            <section class="tp-panel">
                <h3><i class="fas fa-calendar-times"></i> الحصص الضائعة حسب الأستاذ</h3>
                <p id="tp-comp-meta" class="tp-panel-note">-</p>
                <div class="tp-chart-wrap tp-chart-medium">
                    <canvas id="tp-comp-chart" role="img" aria-describedby="tp-comp-meta"></canvas>
                </div>
            </section>
            <section class="tp-panel">
                <h3><i class="fas fa-school"></i> الأقسام المتضررة (غير معوّضة)</h3>
                <p id="tp-sections-comp-meta" class="tp-panel-note">-</p>
                <div class="tp-chart-wrap tp-chart-medium">
                    <canvas id="tp-sections-comp-chart" role="img" aria-describedby="tp-sections-comp-meta"></canvas>
                </div>
            </section>
            <section class="tp-panel">
                <h3><i class="fas fa-chalkboard"></i> حصص الدعم المنجزة حسب الأستاذ</h3>
                <p id="tp-support-meta" class="tp-panel-note">-</p>
                <div class="tp-chart-wrap tp-chart-medium">
                    <canvas id="tp-support-chart" role="img" aria-describedby="tp-support-meta"></canvas>
                </div>
            </section>
        </div>
    </div>
</details>
```

**`js/pages/teachers-performance.js`** — إضافة دالتين للتحميل والرسم:

```js
/* ─── Compensation & Support Block ─── */

// يُستدعى مرة واحدة عند init (loadInitialData) — مستقل عن الفلاتر
async function loadCompensationAndSupportData() {
    const year = await getCurrentYear();

    // جلب بيانات التعويض
    let compRecords = [];
    try {
        compRecords = await window.api.compensation.getPending(year) ?? [];
    } catch (_) {}

    // جلب حصص الدعم
    let supportSessions = [];
    try {
        supportSessions = await window.api.supportSessions.list({ school_year: year }) ?? [];
    } catch (_) {}

    await ensureChartJsLoaded().catch(() => {});
    if (!window.Chart) return;

    renderCompensationByTeacherChart(compRecords);
    renderAffectedSectionsChart(compRecords);
    renderSupportSessionsChart(supportSessions);
}

function renderCompensationByTeacherChart(records) {
    const canvas = document.getElementById('tp-comp-chart');
    const meta = document.getElementById('tp-comp-meta');
    if (!canvas || !meta || !window.Chart) return;
    destroyChart('compByTeacher');

    // فصل المعوَّض وغير المعوَّض
    const pending = records.filter(r => !r.compensated);
    const done = records.filter(r => r.compensated);

    if (!records.length) { meta.textContent = 'لا توجد بيانات حصص تعويضية.'; return; }

    // تجميع حسب الأستاذ
    const byTeacher = {};
    records.forEach(r => {
        const t = r.teacher_name || 'غير محدد';
        if (!byTeacher[t]) byTeacher[t] = { pending: 0, done: 0 };
        if (r.compensated) byTeacher[t].done++;
        else byTeacher[t].pending++;
    });

    // ترتيب حسب إجمالي الحصص تنازلياً، أخذ أعلى 10
    const sorted = Object.entries(byTeacher)
        .sort((a, b) => (b[1].pending + b[1].done) - (a[1].pending + a[1].done))
        .slice(0, 10);

    const labels = sorted.map(([name]) => name);
    charts.compByTeacher = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'في الانتظار',
                    data: sorted.map(([, v]) => v.pending),
                    backgroundColor: 'rgba(231,76,60,0.80)',
                    borderRadius: 4, borderSkipped: false
                },
                {
                    label: 'تم التعويض',
                    data: sorted.map(([, v]) => v.done),
                    backgroundColor: 'rgba(47,179,109,0.80)',
                    borderRadius: 4, borderSkipped: false
                }
            ]
        },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            animation: { duration: 650 },
            plugins: {
                legend: { position: 'top', labels: { usePointStyle: true, padding: 12 } },
                tooltip: { rtl: true, textDirection: 'rtl' }
            },
            scales: {
                x: { position: 'top', reverse: true, stacked: false,
                    ticks: { precision: 0 }, grid: { color: 'rgba(0,0,0,0.05)' } },
                y: { position: 'right', grid: { display: false },
                    ticks: { font: { family: "'IBM Plex Sans Arabic', sans-serif", weight: '600' } } }
            }
        }
    });

    const totalPending = pending.length;
    const totalDone = done.length;
    meta.textContent = `${records.length} حصة إجمالاً · ${totalPending} في الانتظار · ${totalDone} معوَّضة`;
    updateChartAccessibility('tp-comp-chart', 'رسم يوضح الحصص التعويضية حسب الأستاذ', 'tp-comp-meta', meta.textContent);
}

function renderAffectedSectionsChart(records) {
    const canvas = document.getElementById('tp-sections-comp-chart');
    const meta = document.getElementById('tp-sections-comp-meta');
    if (!canvas || !meta || !window.Chart) return;
    destroyChart('sectionsComp');

    // نعرض فقط الحصص غير المعوَّضة
    const pending = records.filter(r => !r.compensated);
    if (!pending.length) { meta.textContent = 'لا توجد أقسام متضررة بدون تعويض.'; return; }

    const bySection = {};
    pending.forEach(r => {
        const sec = r.section || 'غير محدد';
        bySection[sec] = (bySection[sec] || 0) + 1;
    });

    const sorted = Object.entries(bySection)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12);

    charts.sectionsComp = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: sorted.map(([sec]) => sec),
            datasets: [{
                label: 'حصص غير معوَّضة',
                data: sorted.map(([, n]) => n),
                backgroundColor: 'rgba(231,76,60,0.75)',
                borderRadius: 4, borderSkipped: false
            }]
        },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            animation: { duration: 650 },
            plugins: {
                legend: { display: false },
                tooltip: { rtl: true, textDirection: 'rtl',
                    callbacks: { label: ctx => `${ctx.raw} حصة غير معوَّضة` } }
            },
            scales: {
                x: { position: 'top', reverse: true, ticks: { precision: 0 },
                    grid: { color: 'rgba(0,0,0,0.05)' } },
                y: { position: 'right', grid: { display: false },
                    ticks: { font: { family: "'IBM Plex Sans Arabic', sans-serif", weight: '600' } } }
            }
        }
    });

    meta.textContent = `${sorted.length} قسم متضرر · ${pending.length} حصة لم تُعوَّض بعد`;
    updateChartAccessibility('tp-sections-comp-chart', 'رسم يوضح الأقسام المتضررة بدون تعويض', 'tp-sections-comp-meta', meta.textContent);
}

function renderSupportSessionsChart(sessions) {
    const canvas = document.getElementById('tp-support-chart');
    const meta = document.getElementById('tp-support-meta');
    if (!canvas || !meta || !window.Chart) return;
    destroyChart('supportSessions');

    if (!sessions.length) { meta.textContent = 'لا توجد بيانات حصص دعم مسجلة.'; return; }

    const byTeacher = {};
    sessions.forEach(s => {
        const t = s.teacher_name || 'غير محدد';
        if (!byTeacher[t]) byTeacher[t] = { hours: 0, count: 0 };
        byTeacher[t].hours += Number(s.duration_hours) || 0;
        byTeacher[t].count++;
    });

    const sorted = Object.entries(byTeacher)
        .sort((a, b) => b[1].hours - a[1].hours)
        .slice(0, 10);

    charts.supportSessions = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: sorted.map(([name]) => name),
            datasets: [{
                label: 'ساعات الدعم',
                data: sorted.map(([, v]) => Number(v.hours.toFixed(1))),
                backgroundColor: 'rgba(59,106,197,0.80)',
                borderRadius: 4, borderSkipped: false
            }]
        },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            animation: { duration: 650 },
            plugins: {
                legend: { display: false },
                tooltip: { rtl: true, textDirection: 'rtl',
                    callbacks: {
                        label: ctx => `${ctx.raw} ساعة`,
                        afterBody: (items) => {
                            const t = sorted[items[0]?.dataIndex];
                            return t ? [`${t[1].count} حصة`] : '';
                        }
                    }
                }
            },
            scales: {
                x: { position: 'top', reverse: true, ticks: { callback: v => `${v}h` },
                    grid: { color: 'rgba(0,0,0,0.05)' } },
                y: { position: 'right', grid: { display: false },
                    ticks: { font: { family: "'IBM Plex Sans Arabic', sans-serif", weight: '600' } } }
            }
        }
    });

    const totalHours = sessions.reduce((s, r) => s + (Number(r.duration_hours) || 0), 0);
    const uniqueTeachers = new Set(sessions.map(s => s.teacher_name)).size;
    meta.textContent = `${sessions.length} حصة دعم · ${totalHours.toFixed(1)} ساعة · ${uniqueTeachers} أستاذ`;
    updateChartAccessibility('tp-support-chart', 'رسم يوضح حصص الدعم المنجزة حسب الأستاذ', 'tp-support-meta', meta.textContent);
}
```

**استدعاء في `loadInitialData()`** — إضافة في نهاية الدالة (بعد `renderTeacherFilter()`):
```js
// تحميل بيانات التعويض والدعم — مستقل عن فلاتر الدرجات
loadCompensationAndSupportData().catch(err => console.warn('comp/support load error:', err));
```

**`destroyChart` في `runAnalysis()`** — لا حاجة لإعادة رسم هذا القسم عند تغيير الفلاتر (البيانات ثابتة بالسنة الدراسية). البيانات تُحمَّل مرة واحدة عند init.

---

## ترتيب التنفيذ

1. **`css/tailwind-input.css`** — إضافة `.tp-kpi-toggle`, `.tp-toggle-btn`, و `@media print`
2. **`teachers-performance.html`** — إضافة: زر print، toggle bar، رفع class الـ trend chart wrap، Block 5 الجديد
3. **`js/pages/teachers-performance.js`**:
   - إضافة `kpiView`, `lastBaseFiltered` في المتغيرات العامة
   - إضافة `charts.compByTeacher`, `charts.sectionsComp`, `charts.supportSessions` في كائن `charts`
   - تعديل `bindEvents()` لربط toggle + print
   - تعديل `renderKpis()` لدعم المحورين
   - تعديل `renderTeacherTrendChart()` لدعم الأقسام
   - إضافة `buildPrintHTML()` و `printReport()`
   - إضافة `loadCompensationAndSupportData()`, `renderCompensationByTeacherChart()`, `renderAffectedSectionsChart()`, `renderSupportSessionsChart()`
   - استدعاء `loadCompensationAndSupportData()` في نهاية `loadInitialData()`
4. **`npm run css:build`** لإعادة بناء Tailwind

---

## التحقق (Verification)

- [ ] فتح الصفحة → التحقق من ظهور شريط toggle فوق KPIs
- [ ] النقر على "حسب المادة" → تتغير البطاقات وتعرض مؤشرات المواد
- [ ] النقر على "حسب الأستاذ" → العودة للعرض الافتراضي
- [ ] اختيار أستاذ لديه فروض متعددة وأقسام متعددة → تظهر خطوط ملونة في رسم التطور
- [ ] أستاذ بقسم واحد → يظهر الخط العام فقط بلا legend
- [ ] النقر على "طباعة" → يفتح نافذة معاينة
- [ ] تصدير PDF → يحتوي على KPIs + الجدول + صور الرسوم البيانية
- [ ] Block 5 يظهر عند تحميل الصفحة بمبيانين للتعويضات وواحد للدعم
- [ ] عند وجود حصص في الانتظار → تظهر بالأحمر في مبيان الأستاذ وفي مبيان الأقسام
- [ ] عند عدم وجود بيانات supportSessions → يظهر نص "لا توجد بيانات حصص دعم"
- [ ] تغيير الفلاتر لا يُعيد رسم Block 5 (البيانات ثابتة بالسنة)
- [ ] `npm run test:smoke` يجتاز (لا تغييرات IPC)
- [ ] `npm run lint` يجتاز
