# Results Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform `grades.html` into `results-hub.html` — a three-tab unified analysis hub: النتائج العامة (+ remark filter), الحاصلون على صفر, and الأوائل (by section / level / school).

**Architecture:** Single HTML file with an `activeTab` state variable controlling which tab panel is visible. All three tabs share `allGradesCache` loaded once at init. Tabs 2 and 3 load lazily on first activation. No new IPC channels — all data comes from existing `window.api.grades` and `window.api.classes`.

**Tech Stack:** Vanilla JS, existing `window.api` IPC bridge, CSS in `css/tailwind-input.css`, Font Awesome icons, existing utility functions from `js/utils.js` and `js/cc-rules.js`.

---

## Files Map

| Action | File | Responsibility |
|--------|------|----------------|
| Rename + modify | `grades.html` → `results-hub.html` | Main page: tab shell + all three tab panels |
| Modify | `css/tailwind-input.css` | Add tab nav styles + top-performers card styles |
| Modify | `js/sidebar.js` | Update link: `grades.html` → `results-hub.html`, label → "مركز النتائج" |
| Modify | `js/utils.js` | Update any reference to `grades.html` |
| Modify | `main/db/managed-pages.js` | Update page key if present |
| No change | `studentzero.html` | Stays independent |
| No change | `js/cc-rules.js` | Used as-is by results-hub |

---

## Task 1: Rename file and update all cross-references

**Files:**
- Rename: `grades.html` → `results-hub.html`
- Modify: `js/sidebar.js`
- Modify: `js/utils.js`
- Modify: `main/db/managed-pages.js`

- [ ] **Step 1: Rename the file**

```bash
cd d:/gestionScholaire
mv grades.html results-hub.html
```

- [ ] **Step 2: Update sidebar.js link and label**

In `js/sidebar.js`, find the line:
```html
<li><a href="grades.html"><i class="fas fa-star"></i> النتائج والإحصائيات</a></li>
```
Replace with:
```html
<li><a href="results-hub.html"><i class="fas fa-chart-pie"></i> مركز النتائج</a></li>
```

- [ ] **Step 3: Update utils.js references**

Search `js/utils.js` for any `grades.html` string and replace with `results-hub.html`. Also update the display label if present (e.g. "النتائج والإحصائيات" → "مركز النتائج").

- [ ] **Step 4: Update managed-pages.js**

In `main/db/managed-pages.js`, find any entry with `grades.html` and update to `results-hub.html`.

- [ ] **Step 5: Update page `<title>` in results-hub.html**

```html
<title>مركز النتائج | Results Hub | برنامج التدبير المدرسي</title>
```

- [ ] **Step 6: Update page header h2**

```html
<h2 class="page-title"><i class="fas fa-chart-pie"></i> مركز النتائج | Results Hub</h2>
```

- [ ] **Step 7: Verify the app still launches and the sidebar link opens the renamed page**

Launch the Electron app. Check sidebar → "مركز النتائج" opens `results-hub.html` without errors.

- [ ] **Step 8: Commit**

```bash
git add results-hub.html js/sidebar.js js/utils.js main/db/managed-pages.js
git commit -m "feat: rename grades.html to results-hub.html, update all references"
```

---

## Task 2: Add tab navigation UI (HTML + CSS)

**Files:**
- Modify: `results-hub.html` (HTML structure)
- Modify: `css/tailwind-input.css` (tab styles)

- [ ] **Step 1: Add CSS for tab nav at the bottom of the components section in `css/tailwind-input.css`**

Find the end of `@layer components {` block and add:

```css
/* === Results Hub Tabs === */
.rh-tabs {
    display: flex;
    gap: 4px;
    padding: 0 0 0 0;
    margin-bottom: 20px;
    border-bottom: 2px solid var(--color-accent);
}

.rh-tab-btn {
    padding: 10px 20px;
    background: transparent;
    border: none;
    border-bottom: 3px solid transparent;
    margin-bottom: -2px;
    color: var(--color-text-muted);
    font-family: var(--font-main);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    transition: color 0.2s, border-color 0.2s, background 0.2s;
    display: flex;
    align-items: center;
    gap: 8px;
}

.rh-tab-btn:hover {
    color: var(--color-primary);
    background: var(--color-surface-hover, rgba(0,0,0,0.04));
}

.rh-tab-btn.active {
    color: var(--color-primary);
    border-bottom-color: var(--color-primary);
}

.rh-tab-panel {
    display: none;
}

.rh-tab-panel.active {
    display: block;
}

/* Top performers cards grid */
.rh-top-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
    margin-top: 16px;
}

.rh-top-card {
    background: var(--color-surface);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-md);
    overflow: hidden;
}

.rh-top-card-header {
    background: var(--color-primary);
    color: #fff;
    padding: 10px 16px;
    font-weight: 700;
    font-size: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
}

.rh-top-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--color-accent);
    transition: background 0.15s;
}

.rh-top-row:last-child {
    border-bottom: none;
}

.rh-top-row:hover {
    background: var(--color-surface-hover, rgba(0,0,0,0.03));
}

.rh-top-medal {
    font-size: 22px;
    flex-shrink: 0;
}

.rh-top-info {
    flex: 1;
    min-width: 0;
}

.rh-top-name {
    font-weight: 600;
    font-size: 14px;
    color: var(--color-text-main);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.rh-top-code {
    font-size: 12px;
    color: var(--color-text-muted);
}

.rh-top-avg {
    font-weight: 700;
    font-size: 16px;
    flex-shrink: 0;
}

/* Scope selector for top performers */
.rh-scope-bar {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
    margin-bottom: 16px;
}

.rh-scope-btn {
    padding: 7px 16px;
    border: 1px solid var(--color-accent);
    border-radius: 20px;
    background: var(--color-surface);
    color: var(--color-text-muted);
    font-family: var(--font-main);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
}

.rh-scope-btn.active {
    background: var(--color-primary);
    color: #fff;
    border-color: var(--color-primary);
}
```

- [ ] **Step 2: Rebuild Tailwind CSS**

```bash
cd d:/gestionScholaire
npm run css:build
```

Expected: `css/tailwind-output.css` updated with no errors.

- [ ] **Step 3: Add tab nav HTML inside `results-hub.html`, inside `.grades-container`, before the existing `.search-section`**

```html
<!-- Tab Navigation -->
<div class="rh-tabs" role="tablist">
    <button class="rh-tab-btn active" id="tab-btn-results" role="tab" aria-selected="true" aria-controls="tab-results" type="button">
        <i class="fas fa-chart-bar"></i> النتائج العامة
    </button>
    <button class="rh-tab-btn" id="tab-btn-zeros" role="tab" aria-selected="false" aria-controls="tab-zeros" type="button">
        <i class="fas fa-exclamation-circle"></i> الحاصلون على صفر
    </button>
    <button class="rh-tab-btn" id="tab-btn-top" role="tab" aria-selected="false" aria-controls="tab-top" type="button">
        <i class="fas fa-trophy"></i> الأوائل
    </button>
</div>
```

- [ ] **Step 4: Wrap existing `.search-section` + `.students-results` in a tab panel div**

Wrap everything between the tabs nav and end of `.grades-container` like this:

```html
<!-- Tab 1: النتائج العامة -->
<div class="rh-tab-panel active" id="tab-results" role="tabpanel">
    <!-- existing .search-section goes here -->
    <!-- existing .students-results goes here -->
</div>

<!-- Tab 2: الحاصلون على صفر (content added in Task 3) -->
<div class="rh-tab-panel" id="tab-zeros" role="tabpanel"></div>

<!-- Tab 3: الأوائل (content added in Task 4) -->
<div class="rh-tab-panel" id="tab-top" role="tabpanel"></div>
```

- [ ] **Step 5: Add tab switching JS at the top of the `<script>` block (before DOMContentLoaded)**

```js
let activeTab = 'results';
let tab2Loaded = false;
let tab3Loaded = false;

function switchTab(tabId) {
    activeTab = tabId;
    document.querySelectorAll('.rh-tab-btn').forEach(btn => {
        const isActive = btn.id === `tab-btn-${tabId}`;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', String(isActive));
    });
    document.querySelectorAll('.rh-tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `tab-${tabId}`);
    });
    if (tabId === 'zeros' && !tab2Loaded) {
        tab2Loaded = true;
        searchZeros({ resetPage: true });
    }
    if (tabId === 'top' && !tab3Loaded) {
        tab3Loaded = true;
        renderTopPerformers();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('tab-btn-results').addEventListener('click', () => switchTab('results'));
    document.getElementById('tab-btn-zeros').addEventListener('click', () => switchTab('zeros'));
    document.getElementById('tab-btn-top').addEventListener('click', () => switchTab('top'));
});
```

- [ ] **Step 6: Verify tabs switch visually with no JS errors**

Open app → مركز النتائج. Click each tab button. Tab 1 content appears for "النتائج العامة", empty panels for the others. No console errors.

- [ ] **Step 7: Commit**

```bash
git add results-hub.html css/tailwind-input.css
git commit -m "feat: add tab navigation shell to results-hub"
```

---

## Task 3: Tab 1 — Add تقدير column and filter

**Files:**
- Modify: `results-hub.html`

- [ ] **Step 1: Add تقدير filter select to the existing filter form**

Inside `#filter-form` (the `.filter-grid`), add after the semester select and before the buttons:

```html
<div class="filter-group">
    <label>التقدير</label>
    <select id="remark-select">
        <option value="">كل التقديرات</option>
        <option value="ممتاز">ممتاز</option>
        <option value="حسن جدا">حسن جداً</option>
        <option value="حسن">حسن</option>
        <option value="مقبول">مقبول</option>
        <option value="ضعيف">ضعيف</option>
    </select>
</div>
```

- [ ] **Step 2: Add تقدير column header to the table `<thead>`**

After the `<th>الملاحظة</th>` — actually, replace the existing columns. The current thead is:
```html
<tr>
    <th>#</th>
    <th>رمز مسار</th>
    <th>الاسم الكامل</th>
    <th>القسم</th>
    <th>المعدل العام</th>
    <th>الترتيب</th>
    <th>الملاحظة</th>
</tr>
```
The column "الملاحظة" already shows the remark badge — rename it to "التقدير" for clarity:
```html
<th>التقدير</th>
```

- [ ] **Step 3: Wire the remark filter into `loadResults()`**

In `loadResults()`, after the existing `if (semester)` filter line, add:

```js
const remarkFilter = document.getElementById('remark-select').value;
if (remarkFilter) {
    // filter studentData after it's computed (not filtered grades)
}
```

Move the remark filter to apply **after** `studentData` is computed. Find the line `currentStudentData = studentData;` and replace the block from that line to `renderPage()` with:

```js
let displayData = studentData;
const remarkFilter = document.getElementById('remark-select').value;
if (remarkFilter) {
    displayData = studentData.filter(s => getGradeRemark(s.average) === remarkFilter);
}
currentStudentData = displayData;
currentPage = 1;
renderPage();
```

- [ ] **Step 4: Reset remark filter in `resetFilters()`**

Add this line inside `resetFilters()`:
```js
document.getElementById('remark-select').value = '';
```

- [ ] **Step 5: Verify filter works**

Open app → Tab "النتائج العامة". Select "ممتاز" from التقدير filter, click عرض. Only students with average ≥ 16 appear. Reset clears the filter.

- [ ] **Step 6: Commit**

```bash
git add results-hub.html
git commit -m "feat: add remark column filter to tab 1 (النتائج العامة)"
```

---

## Task 4: Tab 2 — الحاصلون على صفر

**Files:**
- Modify: `results-hub.html`

- [ ] **Step 1: Add Tab 2 HTML content inside `#tab-zeros`**

```html
<div class="rh-tab-panel" id="tab-zeros" role="tabpanel">
    <!-- Filters -->
    <div class="gs-form-section">
        <div class="gs-form-header"><i class="fas fa-filter"></i> تصفية النتائج</div>
        <form class="gs-form-grid" id="zeros-form">
            <div class="gs-form-group" style="grid-column: span 2">
                <label for="zeros-search">البحث</label>
                <input id="zeros-search" type="text" placeholder="بحث بالاسم، رمز مسار أو المادة" autocomplete="off"
                    style="width:100%;padding:10px 14px;border:1px solid var(--color-accent);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text-main);font-family:var(--font-main);font-size:14px;" />
            </div>
            <div class="gs-form-group">
                <label for="zeros-class">القسم</label>
                <select id="zeros-class">
                    <option value="">كل الأقسام</option>
                </select>
            </div>
            <div class="gs-form-group">
                <label for="zeros-semester">الدورة</label>
                <select id="zeros-semester">
                    <option value="">كل الدورات</option>
                    <option value="1">الدورة الأولى</option>
                    <option value="2">الدورة الثانية</option>
                </select>
            </div>
            <div class="gs-form-group">
                <label for="zeros-page-size">عدد النتائج</label>
                <select id="zeros-page-size">
                    <option value="10">10 في الصفحة</option>
                    <option value="25" selected>25 في الصفحة</option>
                    <option value="50">50 في الصفحة</option>
                    <option value="100">100 في الصفحة</option>
                </select>
            </div>
            <div class="gs-form-actions">
                <button class="btn btn-primary" type="button" id="zeros-search-btn">
                    <i class="fas fa-search"></i> بحث
                </button>
                <button class="btn btn-success ux-print-preview-btn" type="button" id="zeros-export-btn" disabled>
                    <i class="fas fa-eye"></i> معاينة
                </button>
            </div>
        </form>
    </div>

    <!-- KPIs -->
    <div class="sz-kpis" aria-live="polite">
        <div class="sz-kpi-card">
            <div class="sz-kpi-label">حالات الصفر</div>
            <div class="sz-kpi-value" id="z-kpi-total">0</div>
        </div>
        <div class="sz-kpi-card">
            <div class="sz-kpi-label">عدد التلاميذ</div>
            <div class="sz-kpi-value" id="z-kpi-students">0</div>
        </div>
        <div class="sz-kpi-card">
            <div class="sz-kpi-label">الأقسام المتأثرة</div>
            <div class="sz-kpi-value" id="z-kpi-sections">0</div>
        </div>
        <div class="sz-kpi-card">
            <div class="sz-kpi-label">مرتبطة بالغياب</div>
            <div class="sz-kpi-value" id="z-kpi-absence">0</div>
        </div>
    </div>

    <!-- Table -->
    <div class="gs-preview-section">
        <div class="gs-preview-header">
            <h3 class="gs-preview-title">
                <i class="fas fa-list"></i>
                الحاصلون على صفر
                <span id="z-results-count" class="gs-count-badge" aria-live="polite">0</span>
            </h3>
            <div id="z-results-meta" style="font-size:13px;color:var(--color-text-muted)">-</div>
        </div>
        <div class="gs-preview-body">
            <div class="table-responsive">
                <table class="students-table students-table-card">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>رمز مسار</th>
                            <th>الاسم الكامل</th>
                            <th>القسم</th>
                            <th>المادة</th>
                            <th>الدورة</th>
                            <th>السبب</th>
                        </tr>
                    </thead>
                    <tbody id="z-tbody"></tbody>
                </table>
            </div>
            <div class="pagination" id="z-pagination" style="display:none"></div>
        </div>
    </div>
</div>
```

- [ ] **Step 2: Add Tab 2 JS — helper functions**

In the `<script>` block, add the following functions (copy the exact logic from `studentzero.html`, prefixed with `z` to avoid collisions):

```js
// ===== Tab 2: Zeros =====

let zCurrentPage = 1;
let zActiveRequestId = 0;
let zDebounceTimer = null;

function zGetFilters() {
    return {
        className: document.getElementById('zeros-class').value,
        semester: document.getElementById('zeros-semester').value,
        searchTerm: document.getElementById('zeros-search').value.trim()
    };
}

function zGetPageSize() {
    const v = Number(document.getElementById('zeros-page-size').value);
    return Number.isFinite(v) && v > 0 ? v : 25;
}

function zSemesterLabel(value) {
    const s = String(value || '');
    return s === '1' ? 'الأولى' : s === '2' ? 'الثانية' : '-';
}

function zUpdateKpis(summary = {}) {
    document.getElementById('z-kpi-total').textContent = String(summary.totalCases || 0);
    document.getElementById('z-kpi-students').textContent = String(summary.uniqueStudents || 0);
    document.getElementById('z-kpi-sections').textContent = String(summary.sectionsCount || 0);
    document.getElementById('z-kpi-absence').textContent = String(summary.absenceLinkedCases || 0);
}

function zUpdateMeta(pagination) {
    const totalRows = Number(pagination?.totalRows || 0);
    const page = Number(pagination?.page || 1);
    const pageSize = Number(pagination?.pageSize || zGetPageSize());
    if (!totalRows) {
        document.getElementById('z-results-meta').textContent = '-';
        document.getElementById('z-results-count').textContent = '0';
        return;
    }
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, totalRows);
    document.getElementById('z-results-meta').textContent = `عرض ${start} - ${end} من ${totalRows}`;
    document.getElementById('z-results-count').textContent = String(totalRows);
}

function zRenderRows(rows, pagination) {
    const tbody = document.getElementById('z-tbody');
    const startIndex = (Number(pagination.page || 1) - 1) * Number(pagination.pageSize || zGetPageSize());
    const fragment = document.createDocumentFragment();
    rows.forEach((row, idx) => {
        const reason = row.zero_reason || (Number(row.absence_count || 0) > 0 ? 'غياب' : 'تعثر دراسي');
        const tr = document.createElement('tr');
        [
            ['#', String(startIndex + idx + 1)],
            ['رمز مسار', row.student_code || row.massar_code || '-'],
            ['الاسم الكامل', row.student_name || row.full_name || '-'],
            ['القسم', row.class_name || row.section || '-'],
            ['المادة', row.subject || '-'],
            ['الدورة', zSemesterLabel(row.semester)],
            ['السبب', reason]
        ].forEach(([label, value]) => {
            const td = document.createElement('td');
            td.dataset.label = label;
            td.textContent = value;
            tr.appendChild(td);
        });
        fragment.appendChild(tr);
    });
    tbody.replaceChildren(fragment);
}

function zBuildPageList(current, totalPages) {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages = [1];
    const start = Math.max(2, current - 1);
    const end = Math.min(totalPages - 1, current + 1);
    if (start > 2) pages.push('...');
    for (let p = start; p <= end; p++) pages.push(p);
    if (end < totalPages - 1) pages.push('...');
    pages.push(totalPages);
    return pages;
}

function zRenderPagination(pagination) {
    const container = document.getElementById('z-pagination');
    const totalRows = Number(pagination?.totalRows || 0);
    const totalPages = Number(pagination?.totalPages || 1);
    const page = Number(pagination?.page || 1);
    if (!totalRows || totalPages <= 1) {
        container.style.display = 'none';
        container.replaceChildren();
        return;
    }
    const make = (label, pageVal, cls, disabled, active) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = cls + (active ? ' active' : '');
        btn.dataset.page = String(pageVal);
        btn.textContent = label;
        btn.disabled = disabled;
        return btn;
    };
    const nodes = [make('السابق', page - 1, 'nav-btn', page <= 1, false)];
    zBuildPageList(page, totalPages).forEach(item => {
        if (item === '...') {
            const span = document.createElement('span');
            span.className = 'ellipsis';
            span.textContent = '...';
            nodes.push(span);
        } else {
            nodes.push(make(String(item), item, 'page-btn', false, item === page));
        }
    });
    nodes.push(make('التالي', page + 1, 'nav-btn', page >= totalPages, false));
    const info = document.createElement('span');
    info.className = 'page-info';
    info.textContent = `صفحة ${page} من ${totalPages}`;
    nodes.push(info);
    container.replaceChildren(...nodes);
    container.style.display = 'flex';
}

function zNormalizeRows(rows = []) {
    return rows.map(g => ({
        id: g.id,
        student_code: g.student_code || g.massar_code || '',
        student_name: g.student_name || g.full_name || '',
        class_name: g.class_name || g.section || '',
        subject: g.subject || '',
        semester: String(g.semester || ''),
        grade: Number(g.grade),
        absence_count: Number(g.absence_count || 0),
        zero_reason: g.zero_reason || ''
    })).filter(g => g.grade === 0);
}

async function zBuildFallback({ className = '', semester = '', searchTerm = '', page = 1, pageSize = 25, exportAll = false } = {}) {
    const rawGrades = await window.api.grades.getAll(year);
    const all = zNormalizeRows(Array.isArray(rawGrades) ? rawGrades : []);
    const search = searchTerm.trim().toLowerCase();
    let filtered = all;
    if (className) filtered = filtered.filter(g => g.class_name === className);
    if (semester) filtered = filtered.filter(g => String(g.semester) === String(semester));
    if (search) filtered = filtered.filter(g =>
        String(g.student_name).toLowerCase().includes(search) ||
        String(g.student_code).toLowerCase().includes(search) ||
        String(g.subject).toLowerCase().includes(search)
    );
    filtered.sort((a, b) => {
        const bySection = String(a.class_name).localeCompare(String(b.class_name), 'ar');
        return bySection !== 0 ? bySection : String(a.student_name).localeCompare(String(b.student_name), 'ar');
    });
    const totalRows = filtered.length;
    const totalPages = totalRows ? Math.ceil(totalRows / pageSize) : 1;
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * pageSize;
    const rows = exportAll ? filtered : filtered.slice(start, start + pageSize);
    return {
        success: true,
        rows: rows.map(r => ({ ...r, zero_reason: r.zero_reason || 'تعثر دراسي' })),
        pagination: { page: exportAll ? 1 : safePage, pageSize: exportAll ? rows.length || pageSize : pageSize, totalRows, totalPages: exportAll ? 1 : totalPages },
        summary: {
            totalCases: totalRows,
            uniqueStudents: new Set(filtered.map(r => r.student_code || r.student_name)).size,
            sectionsCount: new Set(filtered.map(r => r.class_name)).size,
            absenceLinkedCases: 0
        }
    };
}

async function zFetch({ className = '', semester = '', searchTerm = '', page = 1, pageSize = 25, exportAll = false } = {}) {
    if (typeof window.api?.grades?.getZeroStudents === 'function') {
        try {
            const result = await window.api.grades.getZeroStudents({ schoolYear: year, className, semester, searchTerm, page, pageSize, exportAll });
            if (result?.success) return result;
        } catch (_) {}
    }
    return zBuildFallback({ className, semester, searchTerm, page, pageSize, exportAll });
}

function zRenderMessage(message, iconClass = 'fa-info-circle', color = '#6b7280') {
    const tbody = document.getElementById('z-tbody');
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.style.cssText = 'padding:20px;text-align:center;';
    const icon = document.createElement('i');
    icon.className = `fas ${iconClass}`;
    icon.style.cssText = `color:${color};font-size:32px;display:block;margin-bottom:10px;`;
    td.append(icon, document.createTextNode(message));
    tr.appendChild(td);
    tbody.replaceChildren(tr);
}

async function searchZeros({ resetPage = false } = {}) {
    if (resetPage) zCurrentPage = 1;
    const reqId = ++zActiveRequestId;
    const filters = zGetFilters();
    const pageSize = zGetPageSize();
    try {
        zRenderMessage('جاري تحميل المعطيات...', 'fa-spinner fa-spin', '#3B6AC5');
        const result = await zFetch({ ...filters, page: zCurrentPage, pageSize, exportAll: false });
        if (reqId !== zActiveRequestId) return;
        if (!result?.success) throw new Error(result?.error || 'تعذر جلب المعطيات');
        zCurrentPage = Number(result.pagination?.page || 1);
        zUpdateKpis(result.summary || {});
        zUpdateMeta(result.pagination || {});
        zRenderPagination(result.pagination || {});
        const rows = Array.isArray(result.rows) ? result.rows : [];
        document.getElementById('zeros-export-btn').disabled = !rows.length && !Number(result.pagination?.totalRows || 0);
        if (!rows.length) {
            zRenderMessage('لا يوجد تلاميذ حاصلون على صفر وفق الفلاتر الحالية', 'fa-check-circle', '#10b981');
            return;
        }
        zRenderRows(rows, result.pagination || {});
    } catch (err) {
        console.warn('Zero students error:', err);
        zUpdateKpis({});
        zUpdateMeta({ totalRows: 0 });
        zRenderPagination({ totalRows: 0, totalPages: 1, page: 1 });
        zRenderMessage('تعذر جلب المعطيات، حاول مرة أخرى', 'fa-triangle-exclamation', '#e85d5d');
        showToast('تعذر جلب المعطيات', 'error');
    }
}

async function zShowPrintPreview() {
    try {
        showToast('جاري تحضير معاينة الطباعة...', 'info');
        const filters = zGetFilters();
        const result = await zFetch({ ...filters, page: 1, pageSize: zGetPageSize(), exportAll: true });
        if (!result?.success) throw new Error();
        const rows = Array.isArray(result.rows) ? result.rows : [];
        if (!rows.length) { showToast('لا توجد بيانات للمعاينة', 'warning'); return; }

        const dateStr = new Intl.DateTimeFormat('ar-MA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        let identity = {};
        try { identity = (await window.api.reports.getIdentity()) || {}; } catch (_) {}
        const letterhead = typeof window.buildLetterheadHTML === 'function' ? window.buildLetterheadHTML(identity, year) : '';
        const filtersText = [filters.className || 'كل الأقسام', filters.semester ? zSemesterLabel(filters.semester) : 'كل الدورات'].join(' — ');

        const tableRows = rows.map((row, idx) => {
            const reason = row.zero_reason || (Number(row.absence_count || 0) > 0 ? 'غياب' : 'تعثر دراسي');
            const esc = v => { const d = document.createElement('div'); d.textContent = v == null ? '' : String(v); return d.innerHTML; };
            return `<tr>
                <td style="text-align:center;font-weight:600;color:#666">${idx + 1}</td>
                <td>${esc(row.student_code || '-')}</td>
                <td style="font-weight:600">${esc(row.student_name || '-')}</td>
                <td style="text-align:center">${esc(row.class_name || '-')}</td>
                <td style="text-align:center">${esc(row.subject || '-')}</td>
                <td style="text-align:center">${zSemesterLabel(row.semester)}</td>
                <td style="text-align:center">${esc(reason)}</td>
            </tr>`;
        }).join('');

        let printDiv = document.getElementById('rh-zeros-print');
        if (!printDiv) { printDiv = document.createElement('div'); printDiv.id = 'rh-zeros-print'; printDiv.style.display = 'none'; document.body.appendChild(printDiv); }
        printDiv.innerHTML = `<div class="gs-sheet-wrapper"><div class="gs-sheet" id="rh-zeros-sheet">${letterhead}
            <div class="gs-sheet-title">الحاصلون على صفر</div>
            <div class="gs-sheet-subtitle">${filtersText}</div>
            <div class="gs-sheet-meta"><span><i class="fas fa-calendar-alt"></i> السنة الدراسية: ${year}</span><span><i class="fas fa-users"></i> العدد: ${rows.length}</span><span><i class="fas fa-clock"></i> التاريخ: ${dateStr}</span></div>
            <table><thead><tr><th style="text-align:center;width:40px">#</th><th>رمز مسار</th><th>الاسم الكامل</th><th style="text-align:center">القسم</th><th style="text-align:center">المادة</th><th style="text-align:center;width:60px">الدورة</th><th style="text-align:center">السبب</th></tr></thead><tbody>${tableRows}</tbody></table>
            <div class="gs-footer"><span>تاريخ الطباعة: ${dateStr}</span><span>برنامج التدبير المدرسي — ${year}</span></div>
        </div></div>`;
        printDiv.style.display = 'block';

        const previewFn = (typeof window.openPrintPreview === 'function' && window.openPrintPreview) || (typeof window.UXEnhancements?.openPrintPreview === 'function' && window.UXEnhancements.openPrintPreview);
        if (previewFn) {
            previewFn({ contentSelector: '#rh-zeros-sheet', title: 'الحاصلون على صفر', pageSize: 'A4', noHeader: true, defaultFileName: `تلاميذ_الصفر_${year.replace('/', '-')}` });
        } else { window.print(); }
        setTimeout(() => { printDiv.style.display = 'none'; }, 500);
        showToast(`تم تجهيز المعاينة (${rows.length} سجل)`, 'success');
    } catch (err) {
        console.warn('Print preview error:', err);
        showToast('تعذر فتح معاينة الطباعة', 'error');
    }
}
```

- [ ] **Step 3: Bind Tab 2 events inside the DOMContentLoaded handler**

Inside the existing `document.addEventListener('DOMContentLoaded', async () => { ... })` block, add:

```js
// Tab 2 events
document.getElementById('zeros-search-btn').addEventListener('click', () => searchZeros({ resetPage: true }));
document.getElementById('zeros-export-btn').addEventListener('click', zShowPrintPreview);
document.getElementById('zeros-form').addEventListener('submit', e => { e.preventDefault(); searchZeros({ resetPage: true }); });
['zeros-class', 'zeros-semester', 'zeros-page-size'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => searchZeros({ resetPage: true }));
});
document.getElementById('zeros-search').addEventListener('input', () => {
    clearTimeout(zDebounceTimer);
    zDebounceTimer = setTimeout(() => searchZeros({ resetPage: true }), 250);
});
document.getElementById('z-pagination').addEventListener('click', e => {
    const btn = e.target.closest('button[data-page]');
    if (!btn || btn.disabled) return;
    const targetPage = Number(btn.dataset.page);
    if (!Number.isFinite(targetPage) || targetPage < 1 || targetPage === zCurrentPage) return;
    zCurrentPage = targetPage;
    searchZeros();
});
```

- [ ] **Step 4: Populate zeros-class select from allSections**

In `loadFilters()`, after `allSections = Array.from(sections);`, add:

```js
// Populate Tab 2 class select
const zerosClassSelect = document.getElementById('zeros-class');
while (zerosClassSelect.options.length > 1) zerosClassSelect.remove(1);
sortSectionNames(allSections).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    zerosClassSelect.appendChild(opt);
});
```

- [ ] **Step 5: Verify Tab 2**

Open app → click "الحاصلون على صفر" tab. Data loads (or shows empty state). Filters work. Pagination works. معاينة button enabled when results exist.

- [ ] **Step 6: Commit**

```bash
git add results-hub.html
git commit -m "feat: add tab 2 الحاصلون على صفر to results-hub"
```

---

## Task 5: Tab 3 — الأوائل

**Files:**
- Modify: `results-hub.html`

- [ ] **Step 1: Add Tab 3 HTML inside `#tab-top`**

```html
<div class="rh-tab-panel" id="tab-top" role="tabpanel">
    <!-- Scope + semester filters -->
    <div class="gs-form-section">
        <div class="gs-form-header"><i class="fas fa-trophy"></i> إعدادات العرض</div>
        <div style="padding: 16px; display: flex; flex-wrap: wrap; gap: 16px; align-items: center;">
            <div>
                <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:600;">نطاق العرض</label>
                <div class="rh-scope-bar" id="top-scope-bar">
                    <button class="rh-scope-btn active" data-scope="section" type="button">
                        <i class="fas fa-chalkboard"></i> حسب القسم
                    </button>
                    <button class="rh-scope-btn" data-scope="level" type="button">
                        <i class="fas fa-layer-group"></i> حسب المستوى
                    </button>
                    <button class="rh-scope-btn" data-scope="school" type="button">
                        <i class="fas fa-school"></i> حسب المؤسسة
                    </button>
                </div>
            </div>
            <div>
                <label for="top-semester" style="display:block;margin-bottom:6px;font-size:13px;font-weight:600;">الدورة</label>
                <select id="top-semester" style="padding:8px 12px;border:1px solid var(--color-accent);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text-main);font-family:var(--font-main);">
                    <option value="">كل الدورات</option>
                    <option value="1">الدورة الأولى</option>
                    <option value="2">الدورة الثانية</option>
                </select>
            </div>
        </div>
    </div>

    <!-- Cards container -->
    <div class="rh-top-grid" id="top-grid">
        <div style="padding:40px;text-align:center;color:var(--color-text-muted);">
            <i class="fas fa-trophy" style="font-size:40px;opacity:0.3;display:block;margin-bottom:12px;"></i>
            جاري تحميل بيانات الأوائل...
        </div>
    </div>
</div>
```

- [ ] **Step 2: Add Tab 3 JS functions**

```js
// ===== Tab 3: الأوائل =====

let topScope = 'section'; // 'section' | 'level' | 'school'
const MEDALS = ['🥇', '🥈', '🥉'];

function topGradeColor(avg) {
    if (avg >= 16) return '#10b981';
    if (avg >= 14) return '#3b82f6';
    if (avg >= 12) return '#f59e0b';
    if (avg >= 10) return '#f97316';
    return '#ef4444';
}

async function renderTopPerformers() {
    const grid = document.getElementById('top-grid');
    const semester = document.getElementById('top-semester').value;

    grid.innerHTML = '<div style="padding:40px;text-align:center;color:var(--color-text-muted);"><i class="fas fa-spinner fa-spin" style="font-size:30px;display:block;margin-bottom:10px;"></i> جاري التحميل...</div>';

    try {
        const allGrades = (await window.api.grades.getAll(year)) || [];
        const grades = allGrades.map(g => ({ ...g, grade: Number(g.grade) })).filter(g => Number.isFinite(g.grade));

        // Apply semester filter
        const filtered = semester ? grades.filter(g => String(g.semester || '') === semester) : grades;

        if (!filtered.length) {
            grid.innerHTML = '<div style="padding:40px;text-align:center;color:var(--color-text-muted);"><i class="fas fa-inbox" style="font-size:36px;display:block;margin-bottom:10px;opacity:0.4;"></i> لا توجد بيانات</div>';
            return;
        }

        // Aggregate students (same logic as Tab 1)
        const studentsAgg = new Map();
        filtered.forEach(g => {
            const id = String(g.student_id || g.student_code || g.full_name || 'غير محدد');
            const base = normalizeSubjectName(g.subject) || 'غير محدد';
            let agg = studentsAgg.get(id);
            if (!agg) { agg = { firstRecord: g, bySubject: new Map() }; studentsAgg.set(id, agg); }
            const arr = agg.bySubject.get(base) || [];
            arr.push(g);
            agg.bySubject.set(base, arr);
        });

        const students = Array.from(studentsAgg.entries()).map(([id, agg]) => {
            const first = agg.firstRecord || {};
            const subjectAvgs = Array.from(agg.bySubject.entries(), ([base, grds]) => ({ subject: base, avg: computeSubjectAverage(base, grds) }));
            const branch = typeof detectBranch === 'function' ? detectBranch(first.section || first.class_name || '') : null;
            const average = typeof computeWeightedGeneralAverage === 'function'
                ? computeWeightedGeneralAverage(subjectAvgs, branch)
                : (subjectAvgs.length ? subjectAvgs.reduce((s, x) => s + x.avg, 0) / subjectAvgs.length : 0);
            return {
                id,
                name: String(first.full_name || first.student_code || id),
                massar_code: first.student_code || first.massar_code || '-',
                section: first.section || '-',
                level: _getLocalLevelName(first.section || ''),
                average
            };
        });

        students.sort((a, b) => b.average - a.average);

        let cards = '';

        if (topScope === 'school') {
            cards = buildTopCard('المؤسسة بأكملها', 'fa-school', students.slice(0, 3));
        } else if (topScope === 'section') {
            const bySection = {};
            students.forEach(s => {
                if (!bySection[s.section]) bySection[s.section] = [];
                bySection[s.section].push(s);
            });
            sortSectionNames(Object.keys(bySection)).forEach(sec => {
                cards += buildTopCard(sec, 'fa-chalkboard', bySection[sec].slice(0, 3));
            });
        } else {
            // by level
            const byLevel = {};
            students.forEach(s => {
                const lv = s.level || 'غير محدد';
                if (!byLevel[lv]) byLevel[lv] = [];
                byLevel[lv].push(s);
            });
            const levels = Object.keys(byLevel);
            (typeof sortLevelNames === 'function' ? sortLevelNames(levels) : levels).forEach(lv => {
                cards += buildTopCard(lv, 'fa-layer-group', byLevel[lv].slice(0, 3));
            });
        }

        grid.innerHTML = cards || '<div style="padding:40px;text-align:center;color:var(--color-text-muted);">لا توجد بيانات كافية</div>';

    } catch (err) {
        console.warn('Top performers error:', err);
        grid.innerHTML = '<div style="padding:40px;text-align:center;color:#ef4444;"><i class="fas fa-triangle-exclamation" style="font-size:30px;display:block;margin-bottom:10px;"></i> تعذر تحميل البيانات</div>';
    }
}

function buildTopCard(label, iconClass, topStudents) {
    if (!topStudents || !topStudents.length) return '';
    const rows = topStudents.map((s, i) => {
        const color = topGradeColor(s.average);
        return `<div class="rh-top-row">
            <span class="rh-top-medal">${MEDALS[i] || (i + 1)}</span>
            <div class="rh-top-info">
                <div class="rh-top-name">${s.name}</div>
                <div class="rh-top-code">${s.massar_code}</div>
            </div>
            <span class="rh-top-avg" style="color:${color}">${s.average.toFixed(2)}</span>
        </div>`;
    }).join('');
    return `<div class="rh-top-card">
        <div class="rh-top-card-header"><i class="fas ${iconClass}"></i> ${label}</div>
        ${rows}
    </div>`;
}
```

- [ ] **Step 3: Bind Tab 3 events in DOMContentLoaded**

```js
// Tab 3 scope buttons
document.getElementById('top-scope-bar').addEventListener('click', e => {
    const btn = e.target.closest('.rh-scope-btn[data-scope]');
    if (!btn) return;
    topScope = btn.dataset.scope;
    document.querySelectorAll('.rh-scope-btn').forEach(b => b.classList.toggle('active', b === btn));
    if (tab3Loaded) renderTopPerformers();
});

document.getElementById('top-semester').addEventListener('change', () => {
    if (tab3Loaded) renderTopPerformers();
});
```

- [ ] **Step 4: Verify Tab 3**

Open app → click "الأوائل" tab. Cards appear for each section showing top 3 with medals. Switch scope to "حسب المستوى" — cards regroup. Switch to "حسب المؤسسة" — single card with school-wide top 3. Semester filter re-renders correctly.

- [ ] **Step 5: Commit**

```bash
git add results-hub.html
git commit -m "feat: add tab 3 الأوائل with section/level/school modes"
```

---

## Task 6: Final wiring, cleanup and smoke test

**Files:**
- Modify: `results-hub.html`

- [ ] **Step 1: Remove the `sz-kpis` CSS dependency warning**

The `sz-kpis` and `sz-kpi-card` classes used in Tab 2 are defined in `css/tailwind-input.css` (from studentzero page). Verify they exist:

```bash
grep -n "sz-kpi" d:/gestionScholaire/css/tailwind-input.css
```

If not found, add to `tailwind-input.css` inside `@layer components {}`:

```css
.sz-kpis {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px;
    margin: 16px 0;
}
.sz-kpi-card {
    background: var(--color-surface);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-md);
    padding: 16px;
    text-align: center;
}
.sz-kpi-label {
    font-size: 12px;
    color: var(--color-text-muted);
    margin-bottom: 6px;
}
.sz-kpi-value {
    font-size: 24px;
    font-weight: 700;
    color: var(--color-primary);
}
```

Then rebuild: `npm run css:build`

- [ ] **Step 2: Run smoke test**

```bash
cd d:/gestionScholaire
npm run test:smoke
```

Expected: all checks pass. Fix any IPC parity or reference errors.

- [ ] **Step 3: Full walkthrough**

Open app.
1. Navigate to مركز النتائج from sidebar ✓
2. Tab 1: load results, filter by تقدير "ممتاز", verify only high averages show. Click a student row — detail modal opens ✓
3. Tab 2: switch to "الحاصلون على صفر", verify KPIs update, search by name works, pagination works ✓
4. Tab 3: switch to "الأوائل", verify cards render for each section. Toggle scope to level → school ✓
5. studentzero.html still opens independently from sidebar ✓

- [ ] **Step 4: Final commit**

```bash
git add results-hub.html css/tailwind-input.css js/sidebar.js js/utils.js main/db/managed-pages.js
git commit -m "feat: results-hub complete — 3 tabs (النتائج, الصفر, الأوائل)"
```

---

## Self-Review

**Spec coverage:**
- ✅ Rename `grades.html` → `results-hub.html` — Task 1
- ✅ Title "مركز النتائج | Results Hub" — Task 1
- ✅ Tab 1: رemark column (already existed as badge in الملاحظة col) + رemark filter — Task 3
- ✅ Tab 2: الحاصلون على صفر (KPIs + table + pagination + print) — Task 4
- ✅ Tab 3: الأوائل حسب القسم / المستوى / المؤسسة — Task 5
- ✅ Lazy loading Tabs 2 & 3 — Task 2 (switchTab function)
- ✅ Shared `allGradesCache` and `allSections` — Task 4 Step 4
- ✅ `studentzero.html` untouched — confirmed in scope section

**Placeholder scan:** No TBD or incomplete steps found.

**Type consistency:**
- `normalizeSubjectName`, `computeSubjectAverage`, `computeWeightedGeneralAverage`, `detectBranch`, `_getLocalLevelName`, `sortSectionNames`, `sortLevelNames` — all called identically across Tab 1 and Tab 3 logic ✓
- `zFetch` → `zBuildFallback` → `zNormalizeRows` — chain consistent ✓
- `searchZeros` called from both events and `switchTab` ✓
- `renderTopPerformers` called from both events and `switchTab` ✓
