# Duplicate Code Inventory (jscpd + comprehensive plan)

| Field | Value |
|-------|-------|
| **Date** | 2026-07-10 (baseline) · **Refreshed** 2026-07-11 (PRL) |
| **Tool** | jscpd via `npm run dup:report` (+ HTML-inline via PRA extraction) |
| **Scope** | `main/`, `js/`, `preload.js`, `app.js` |
| **Full plans** | [centralize-duplicates](./2026-07-10-centralize-duplicates-plan.md) · [comprehensive](./2026-07-10-comprehensive-centralization-plan.md) |
| **Status** | Core CH clusters landed; CH5 formatNumber deferred; re-run jscpd for live % |

## How to regenerate

```bash
npm run dup:report
```

Local JSON: `.jscpd-report/jscpd-report.json` (gitignored).

**Note:** jscpd cannot cross-detect HTML-inline vs JS. PRA extracted page scripts into `js/pages/*` so they are visible to jscpd/lint.

## Baseline metrics (2026-07-10)

| Metric | Value |
|--------|-------|
| Files | 158 |
| Lines | 78,648 |
| Clones | 137 |
| Duplicated lines | 3,042 (3.87%) |

## Cluster status (2026-07-11)

### Base plan (C*)

| ID | Topic | Status |
|----|-------|--------|
| C1 | Teacher performance metrics | Partial (csv via CH3; full metrics module still optional) |
| C2–C3 | Proctor-v3 phases | ✅ canonical key SSOT + load-state public periods/increment/decrement wired (05/07/08) |
| C5 | Timetable rooms/students view | ✅ `js/shared/timetable-view.js` |
| C8 | Student gender | ✅ as **CH8** |
| C11 | Log I/O | ✅ `main/diagnostics/log-file-io.js` |

### Comprehensive plan (CH*)

| ID | Topic | Status | Shared home |
|----|-------|--------|-------------|
| PRA | Inline → `js/pages/*` | ✅ | — |
| CH1 | escapeHtml | ✅ | `js/utils.js` |
| CH2 | Timetable teacher resolver | ✅ | `js/shared/timetable-utils.js` |
| CH3 | csvEscape hardened | ✅ | `js/shared/csv.js` |
| CH4 | Date helpers | ✅ | `js/shared/date-utils.js` |
| CH5 | debounce / formatNumber | ✅ debounce + `formatNumber(n,'locale'\|'fixed')` | `js/utils.js` |
| CH6 | Chart theme + loader | ✅ | `js/shared/chart-theme.js` |
| CH7 | Exam-count SSOT | ✅ | IPC + `main/db/exam-count-defaults.js` |
| CH8 | Student gender | ✅ | `js/shared/gender.js` |
| CH9 | Report HTML esc | ✅ | `main/reports/html-escape.js` |
| CH10 | FET day map + base class | ✅ | `js/shared/fet-import.js` |
| CH11 | Admin role session guards | ✅ | `js/shared/role-session-guard.js` |

## Shared modules added this program

| Module | Purpose |
|--------|---------|
| `js/shared/csv.js` | Hardened CSV cell escape |
| `js/shared/chart-theme.js` | Chart.js theme + loader |
| `js/shared/date-utils.js` | todayStr, formatDateAr styles, Monday ISO |
| `js/shared/gender.js` | Student gender helpers |
| `js/shared/fet-import.js` | FET_DAY_MAPPINGS, getBaseClassName |
| `js/shared/role-session-guard.js` | enforceRoleSession |
| `main/reports/html-escape.js` | Report fragment esc |

Pre-existing SSOTs reused: `js/utils.js` (escapeHtml, debounce), `js/shared/timetable-utils.js`, `main/db/exam-count-defaults.js`.

## Remaining / deferred

1. **Proctor-v3 swap-policy orphans** — only if proven identical across phases (optional, high risk).
2. **Opportunistic long-tail** — only when high-churn.
3. Re-run `npm run dup:report` after major merges for fresh %.

## Behavioral / security notes

- CH3 / Gate 0: formula injection hardened for all CSV exporters touched.
- CH2: exam-papers now matches teachers by ID/meta (stronger).
- CH11: failed auth redirects fixed from missing `dashboard.html` → `index.html` (no privilege change).
