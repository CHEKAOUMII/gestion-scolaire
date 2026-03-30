# results-hub.html — Unified Tabs Design Spec
**Date:** 2026-03-30
**Status:** Approved

---

## Naming

| Before | After |
|--------|-------|
| `grades.html` | `results-hub.html` |
| "النتائج والإحصائيات" | "مركز النتائج \| Results Hub" |
| Tab 2 label: "التلاميذ الحاصلون على صفر" | "الحاصلون على صفر" |

---

## Objective

Transform `grades.html` into `results-hub.html` — a unified analysis hub with three tabs, incorporating the zero-grade students view and a new top-performers (أوائل) tab, while making minimal changes to existing logic.

---

## Scope

- **In scope:** rename `grades.html` → `results-hub.html`, restructure into 3 tabs, update all internal references
- **Out of scope:** `studentzero.html` (stays independent), sidebar changes beyond updating the link, IPC/DB changes

---

## Tab Structure

```
results-hub.html
├── Tab 1: النتائج العامة      ← existing view + remark column + remark filter
├── Tab 2: الحاصلون على 0      ← logic ported from studentzero.html
└── Tab 3: الأوائل             ← new view
```

Tabs render above the filter bar. The filter bar adapts per active tab.

---

## Tab 1 — النتائج العامة (Minor Enhancement)

### Changes
- Add **تقدير** column to the results table (using existing `getGradeRemark()`)
- Add **فلتر التقدير** select to the filter bar:
  - Options: كل التقديرات / ممتاز / حسن جداً / حسن / مقبول / ضعيف
  - Applies client-side filter on `currentStudentData` before `renderPage()`

### Unchanged
- All KPI cards (6 cards)
- Student detail modal
- Pagination logic
- `computeSubjectAverage`, `computeWeightedGeneralAverage`, `normalizeSubjectName`

---

## Tab 2 — الحاصلون على صفر

### Source
Port logic from `studentzero.html` inline into `grades.html`.

### Components
- **Filters:** القسم (select) + الدورة (select) + بحث نصي (input) + عدد النتائج (select)
- **KPIs (4 cards):** حالات الصفر / عدد التلاميذ / الأقسام المتأثرة / مرتبطة بالغياب
- **Table:** # / رمز مسار / الاسم الكامل / القسم / المادة / الدورة / السبب
- **Pagination:** same pattern as Tab 1
- **Print preview button:** triggers `openPrintPreview` with gs-sheet content

### Data flow
- Uses `window.api.grades.getZeroStudents()` with fallback to `buildFallbackZeroStudents()` (local filtering of grades where `grade === 0`)
- Both functions remain identical to `studentzero.html` logic

---

## Tab 3 — الأوائل

### Filters (shown when Tab 3 is active)
| Filter | Type | Options |
|--------|------|---------|
| نطاق العرض | radio / select | حسب القسم / حسب المستوى / حسب المؤسسة |
| الدورة | select | كل الدورات / الدورة الأولى / الدورة الثانية |

### Display modes

**حسب القسم:**
- One card per section, sorted by `sortSectionNames()`
- Each card shows top 3 students of that section with rank badge (🥇🥈🥉), full name, massar code, average

**حسب المستوى:**
- One card per level (grouped via `_getLocalLevelName()`), sorted by `sortLevelNames()`
- Each card shows top 3 students across all sections of that level

**حسب المؤسسة:**
- Single card showing top 3 students across the entire school

### Data source
- Re-uses `currentStudentData` computation from Tab 1 (same grade aggregation logic)
- Filters by semester if selected
- Sorts descending by `average`, slices top 3 per group

### Card layout (per group)
```
┌─────────────────────────────────┐
│  القسم: 1BACA  (section label)  │
│  ─────────────────────────────  │
│  🥇  محمد الأمين     —  17.45   │
│  🥈  فاطمة الزهراء  —  16.92   │
│  🥉  يوسف بوعلام    —  16.10   │
└─────────────────────────────────┘
```

---

## Tab State Management

- Active tab stored in `let activeTab = 'results' | 'zeros' | 'top'`
- On tab switch: hide inactive tab content, show active, re-run load function if data not yet loaded
- Tab 2 and Tab 3 load lazily (only fetch on first activation)
- URL hash not required (in-memory state is sufficient for Electron)

---

## Shared Elements

- School year (`year`) — shared
- `allGradesCache` — loaded once in `loadFilters()`, shared across tabs
- `allSections`, `sectionToLevel` — shared
- Toast notifications — shared

---

## What stays unchanged

- `studentzero.html` remains a standalone page accessible from the sidebar
- Sidebar menu structure unchanged
- All IPC channels unchanged
- `js/utils.js` unchanged
- CSS: only additive styles for tabs UI and top-performers cards

---

## Implementation order

1. Add tab UI (HTML + CSS)
2. Tab 1: add رemark column + رemark filter
3. Tab 2: port zero-students logic
4. Tab 3: top-performers view (all 3 modes)
5. Wire tab switching + lazy loading
