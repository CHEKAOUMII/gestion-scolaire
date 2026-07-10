# إعدادات التطبيق — عدد الفروض وصلاحيات الصفحات

**Date:** 2026-07-09  
**Page:** `settings-defaults.html` (تحت الإعدادات)  
**Access:** admin + developer only

## Purpose

Move two hard-coded defaults into a configurable UI:

1. **عدد الفروض حسب المستوى** (was `FROUD_BASE` in `exam-papers.js`)
2. **صلاحيات الوصول للصفحات** (was `PAGE_PERMISSIONS` in `main/auth/permissions.js`)

## Tabs

| Tab | Title | Content |
|-----|-------|---------|
| 1 | عدد الفروض | Level select + subject → exam count table |
| 2 | صلاحيات الصفحات | Access matrix (pages × roles) |

## Access matrix layout (Tab 2)

Classic matrix table:

- **Rows (right / first column in RTL):** page Arabic name + file path subtitle
- **Columns (header):** institution role labels (not admin/developer — always allowed)
- **Cells:** checkbox = role may open that page
- Sticky first column + horizontal scroll for many roles

```
┌──────────────────┬────────┬────────┬─────────┬────────┐
│ الصفحة           │ مدير   │ الناظر │ حارس…   │ أستاذ  │  … │
│                  │ المؤسسة│        │         │        │
├──────────────────┼────────┼────────┼─────────┼────────┤
│ لوائح التلاميذ   │  ☑     │  ☑     │   ☑     │  ☑     │
│ students-list…   │        │        │         │        │
├──────────────────┼────────┼────────┼─────────┼────────┤
│ معلومات المؤسسة  │  ☑     │  ☐     │   ☑     │  ☐     │
│ settings-school… │        │        │         │        │
└──────────────────┴────────┴────────┴─────────┴────────┘
```

## Storage

- `exam_count_rules(level_code, subject, exam_count)` — `*` = global default
- `page_role_access(page_key, role, allowed)` — no rows → fall back to code `PAGE_PERMISSIONS`

## Auto page discovery

Root `*.html` scan via `app.getAppPath()`; exclude `login.html`, `setup.html`. New pages appear automatically with empty roles (admin/dev only until configured).

## IPC

`window.api.appDefaults.*` — see `main/ipc/appDefaults.js` and `preload.js`.

## Files

| Path | Role |
|------|------|
| `settings-defaults.html` | UI shell |
| `js/pages/settings-defaults.js` | Tab logic |
| `js/pages/settings-defaults-guard.js` | Client guard |
| `main/ipc/appDefaults.js` | Handlers |
| `main/db/exam-count-defaults.js` | Seed data |
