# Dashboard Redesign Plan

**Date:** 2026-07-19
**Status:** Proposed
**Scope:** `index.html` (main dashboard) and its direct dependencies only. Other pages are out of scope.

---

## 1. Current State

### 1.1 Structure (index.html)

| Region | Markup | Rendered by | Notes |
|--------|--------|-------------|-------|
| Sidebar | `<aside id="sidebar">` | `js/sidebar.js` (injected) | Shared across pages |
| Topbar | `.dashboard-topbar` | static HTML | Search, menu toggle, theme toggle, notifications, school-year selector |
| Onboarding callout | `#dashboard-onboarding-callout` | static + `app.js` | Dismissible first-run hint |
| Stats | `#stats-section` | `app.js → renderStatsCards()` | 6 cards: students, females, males, sections, levels, avg/section |
| Owner sync | `#owner-sync-section` | `app.js → renderOwnerSyncSection()` | Admin-only sync status |
| Primary charts | `#charts-section` | `app.js → renderCharts()` | 4 charts (Chart.js, lazily loaded via `ensureChartLoaded`) |
| Extra charts | `#extra-charts-section` | `app.js → renderExtraCharts()` | Collapsed "تحاليل إضافية" accordion |
| Student movement | `#movement-section` | `app.js → renderMovement()` | حركية التلاميذ KPIs |
| Modals | `#backup-modal`, `#shortcuts-modal` | static + `dashboard-init.js` | Backup and keyboard shortcuts |

### 1.2 Observed problems

1. **Static HTML is mostly skeleton markup.** Real content is injected by `app.js` (1,811 lines) via `innerHTML`, which mixes layout, styling classes, and data logic in template strings — hard to restyle safely.
2. **No visual hierarchy between sections.** Stats, charts, extra charts, and movement are stacked full-width with identical "section intro" headers; the eye has no anchor.
3. **Stat cards are data-only.** No trend, no comparison to previous period, no click-through to the relevant page (e.g. students list filtered by gender).
4. **Charts have no empty/error states** beyond the initial skeleton; a failed Chart.js load or empty year leaves a blank grid.
5. **The extra-charts accordion hides content** that admins reportedly use, while the primary grid shows charts of unequal importance at equal size.
6. **Onboarding callout is static text** — it does not reflect real state (e.g. "you have no sections yet, import students first").
7. **Topbar search is a placeholder input** — the actual search/table logic lives in `app.js` student-table functions that are not wired to the dashboard header.
8. **Styling sprawl.** Dashboard classes live in `css/tailwind-input.css` (36k lines, compiled to `tailwind-output.css`) alongside everything else; there is no single place that defines dashboard layout/tokens.
9. **RTL + dark mode work but are not token-driven**, so dashboard-specific tweaks require hunting through the large CSS bundle.

---

## 2. Goals

1. **Glanceable hierarchy:** answer "how is the school doing today?" in the first viewport: headline KPIs → attention-needed items → charts → secondary detail.
2. **Actionable cards:** every stat card links to the page where the user can act on that number.
3. **State-aware dashboard:** distinct, designed empty / loading / error / first-run states instead of skeleton-only.
4. **Design tokens first:** dashboard colors, spacing, radii, and shadows come from CSS custom properties so dark mode and RTL remain free.
5. **No regression in behavior:** same IPC calls, same school-year switching, same backup/shortcuts modals, same keyboard shortcuts, same sync-capture channels.
6. **Keep `app.js` behavior, split its presentation:** rendering moves into a dedicated dashboard module; `app.js` keeps data fetching.

## 3. Non-Goals

- Redesigning the sidebar, login page, or any other page.
- Changing the data model, IPC channels, or sync capture registry.
- Replacing Chart.js or adding a new charting library.
- Touching `css/tailwind-input.css` globally (dashboard styles get their own file).

---

## 4. Proposed Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Topbar (sticky): search · year selector · theme · bell · menu│
├──────────────────────────────────────────────────────────────┤
│ Page title row: "لوحة التحكم" + school-year context chip +   │
│ last-sync time + quick actions (نسخة احتياطية، طباعة، تصدير) │
├──────────────────────────────────────────────────────────────┤
│ KPI strip (4 hero cards, clickable):                          │
│   التلاميذ │ الأقسام │ المستويات │ معدل القسم                │
├───────────────────────────────┬──────────────────────────────┤
│ Attention panel (conditional):│ Today panel (new):           │
│ alerts needing action (empty  │ today's absences summary,    │
│ sections, sync errors, no     │ daily-report tags count,     │
│ backup in N days…)            │ pending items                │
├───────────────────────────────┴──────────────────────────────┤
│ Primary charts (2×2 grid, defined empty/error states)        │
├──────────────────────────────────────────────────────────────┤
│ Gender split + movement merged into one "التوزيع والحركية"   │
│ row: females/males as compact donut + movement KPI chips     │
├──────────────────────────────────────────────────────────────┤
│ تحاليل إضافية (kept as accordion, but with per-chart lazy    │
│ render only when expanded)                                   │
└──────────────────────────────────────────────────────────────┘
```

Key changes vs. today:

- **KPI strip reduced from 6 equal cards to 4 hero cards.** Females/males move into the distribution row as a chart (they are proportions, not standalone KPIs).
- **New "Attention" panel** surfaces actionable states instead of the static onboarding callout. First-run guidance becomes one of its possible items, driven by real data (no students → "استورد التلاميذ", no backup in 14 days → "أنشئ نسخة احتياطية").
- **Quick actions move out of modals-only** into the title row (backup button already exists as `#backup-btn`; it gets a visible home).
- **Movement section merges** with gender distribution so related composition data sits together.

---

## 5. Design System Additions

New file: **`css/dashboard.css`** (loaded only by `index.html`, after `tailwind-output.css`). All values via custom properties so dark mode (`[data-theme="dark"]` / `.dark`, matching `js/theme-boot.js`) and RTL require no overrides.

```css
:root {
    --dash-card-bg: var(--surface, #fff);
    --dash-card-border: var(--border, #e2e8f0);
    --dash-card-radius: 14px;
    --dash-card-shadow: 0 1px 3px rgb(15 23 42 / 0.08);
    --dash-kpi-accent: #42516a;        /* matches existing theme-color */
    --dash-gap: 1rem;
    --dash-attention-warn: #b45309;
    --dash-attention-danger: #b91c1c;
}
```

Rules:

- Reuse existing tokens (`--surface`, `--border`, etc. — verify names in `tailwind-input.css` / `theme-boot.js` before authoring; fallbacks above are placeholders).
- Stat-card entrance animation is kept but respects `prefers-reduced-motion`.
- No new font or icon library; Font Awesome + existing Google fonts only.
- No inline `style="animation-delay:…"` in new markup — use `nth-child` delays in CSS.

---

## 6. Component-by-Component Plan

### 6.1 Topbar (`.dashboard-topbar`)
- Keep as-is functionally; make it `position: sticky` with backdrop blur.
- Wire `#header-search` to the existing `performSearch()` in `app.js` (currently orphaned) or scope it to dashboard quick-jump (student name → `student-profile.html`). Decision needed before implementation — see Open Questions.

### 6.2 Title row (new)
- Static markup added to `index.html`: page title, current-year chip, `formatDashboardTimestamp()` last-updated time (function already exists in `app.js`), quick-action buttons (backup opens existing `#backup-modal`).

### 6.3 KPI strip (`#stats-section`)
- `renderStatsCards()` moves to **`js/pages/dashboard/render-stats.js`** (new module, plain script, no build step — consistent with the project's vanilla renderer pattern).
- 4 hero cards: `عدد التلاميذ`, `عدد الأقسام`, `عدد المستويات`, `معدل القسم`.
- Each card is a real `<a>`/`<button>`: students → `students-list.html`, sections/levels → relevant management page, avg → sections page.
- Keep skeleton markup, but skeleton count changes 6 → 4.

### 6.4 Attention panel (new, `#attention-section`)
- Data sources already available in renderer: `renderOwnerSyncSection` state, `BackupManager.getHistory()`, `studentsData`, available years.
- Rule engine is a small pure function in `js/pages/dashboard/attention-rules.js`:
  ```js
  // input: { students, backupHistory, syncState, schoolYear }
  // output: [{ severity: 'danger'|'warn'|'info', icon, textAr, actionHref | actionId }]
  ```
- Hidden entirely when the rule list is empty (no noise on healthy days).
- First-run onboarding copy is absorbed here as an `info` item; the old `#dashboard-onboarding-callout` markup and dismiss handler are removed.

### 6.5 Today panel (new, `#today-section`)
- Read-only summaries via existing read IPC channels: today's absences count, today's `system_tags` notes count (`window.api.systemTags.getByDate(today, schoolYear)`).
- Degrade gracefully: if a channel returns an error, that tile shows "غير متوفر" instead of breaking the panel.
- All reads must use `handleRead` channels only — no new write paths.

### 6.6 Primary charts (`#charts-section`)
- Layout and data logic stay in `renderCharts()`; only the wrapper markup gains per-chart empty/error containers:
  - Empty (no data for year): icon + "لا توجد بيانات لهذا الموسم".
  - Error (Chart.js failed to load): retry button calling `ensureChartLoaded()` then `renderCharts()`.
- Chart theming continues through `js/shared/chart-theme.js`; no palette changes in v1.

### 6.7 Distribution + movement row (`#movement-section`)
- `renderMovement()` keeps its data calc; markup gains a sibling donut chart (females/males from `calculateStats()`).
- Movement KPIs become compact chips instead of a full card grid.

### 6.8 Extra charts (`#extra-charts-section`)
- Accordion kept. Change: charts render **only on first expand**, not on initial `loadDashboardAux()`, to cut first-paint cost.

### 6.9 Modals
- `#backup-modal`, `#shortcuts-modal` unchanged. Quick-action buttons simply call `openBackupModal()` (already global in `dashboard-init.js`).

---

## 7. File Touchpoints

| Action | Path |
|--------|------|
| Modify | `index.html` — new title row, attention/today sections, KPI skeleton 6→4, remove old onboarding callout, add `css/dashboard.css` link, add new module scripts |
| New | `css/dashboard.css` — dashboard tokens + layout |
| New | `js/pages/dashboard/render-stats.js` — KPI strip rendering |
| New | `js/pages/dashboard/attention-rules.js` — pure attention-rule engine (unit-testable) |
| New | `js/pages/dashboard/today-panel.js` — today/absences/tags summary |
| Modify | `app.js` — `renderStatsCards` delegates to new module; add per-chart empty/error containers in `renderCharts()`; lazy-render extra charts on expand; keep all IPC/data functions untouched |
| Modify | `js/pages/dashboard-init.js` — remove onboarding-callout wiring; wire quick-action buttons |
| New | `tests/dashboard-attention-rules.test.js` — pure-function tests for the rule engine |
| Docs | this file |

> Note: `preload.js`, IPC handlers, and `main/` are **not** touched. If the Today panel needs an absences-by-date read channel that does not exist yet, that becomes a separate mini-task following `docs/plans/2026-07-15-add-write-channel-checklist.md` (read variant) before implementation proceeds.

---

## 8. Phases

**Phase 1 — Foundation (no visual change yet)**
1. Extract `renderStatsCards` → `dashboard/render-stats.js`; `app.js` calls it. Verify identical output.
2. Create `css/dashboard.css`, move dashboard-only rules there incrementally (start with stats grid + cards).
3. Add `attention-rules.js` as a pure module with tests.

**Phase 2 — Layout**
4. New title row + sticky topbar.
5. KPI strip: 4 clickable hero cards; skeleton 6→4.
6. Attention panel wired to rule engine; remove onboarding callout.
7. Distribution + movement merged row.

**Phase 3 — States & polish**
8. Per-chart empty/error states + retry.
9. Today panel (after confirming read channels exist).
10. Lazy-render extra charts on first expand.
11. Reduced-motion pass, RTL pass, dark-mode pass, keyboard-focus pass (tab order through clickable cards).

**Phase 4 — Verification & cleanup**
12. `npm test` (existing suite must stay green) + new rule-engine tests.
13. `npm run lint`.
14. Manual smoke: fresh DB (empty states), populated year, year switching, admin vs. non-admin (owner-sync section visibility), backup modal from quick action.

---

## 9. Testing

- **Unit:** `attention-rules.js` is pure → test every rule's trigger/suppression conditions (empty students, stale backup, sync error, combinations, ordering by severity).
- **Regression:** existing `npm test` suite; pay attention to any test that asserts on `index.html` or `app.js` rendered markup (search `tests/` for `stats-section`, `charts-grid`, `movement-section`, `dashboard-onboarding` before editing).
- **Manual RTL/a11y:** keyboard tab order topbar → KPI cards → attention actions → charts accordion; screen-reader labels stay Arabic; `aria-live` regions preserved on loading notes.

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Other pages share `app.js` globals (`studentsData`, `calculateStats`) | Keep all globals and function signatures; only move presentation. Grep for `renderStatsCards` callers before moving |
| Tests assert on current markup | Grep `tests/` first (Phase 4 step 12 lists the selectors); update tests in the same commit as markup changes |
| Theme/boot flash with new CSS file | Load `dashboard.css` after `tailwind-output.css`, no `@import`, keep `theme-boot.js` first in `<head>` |
| Today panel needs a missing IPC read channel | Confirm channel availability in Phase 3 before building the panel; if missing, ship panel with absences only or defer |
| RTL regressions from new grid | Logical properties only (`margin-inline-start`, `inset-inline-end`) in `dashboard.css`; no `left`/`right` |

---

## 11. Open Questions (resolve before Phase 2)

1. **Header search:** should `#header-search` do dashboard quick-jump (student → profile) or keep the old student-table search behavior? Recommend quick-jump.
2. **Gender split:** confirm removing the two gender stat cards in favor of the donut — or keep them as compact chips under the hero strip?
3. **Today panel content priority:** absences count vs. daily-report tags vs. both? Both fit, but which is primary for admins?
4. **Extra charts:** any chart in the accordion that should be promoted to the primary grid based on actual usage?
