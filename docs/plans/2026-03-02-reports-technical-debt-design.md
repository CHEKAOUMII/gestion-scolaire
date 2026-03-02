# Reports Engine — 5 Technical Debt Fixes

**Date:** 2026-03-02
**Status:** Approved

## Overview

Fix 5 technical debt items in the reports/exports subsystem identified during the official reporting exports analysis.

## Fix 1: Hard-coded school name in `printChart()`

**File:** `app.js:1083`

Replace the literal string `الثانوية التأهيلية ابن سينا` with a dynamic call to `window.api.reports.getIdentity()`. The function is already `async`, so fetching identity adds no complexity. Use `id.school_name` with an empty-string fallback.

## Fix 2: Duplicate letterhead in preview modal

**Files:** `main/ipc/reports.js`, `preload.js`, `js/ux-enhancements.js`

1. Add IPC channel `reports:renderLetterhead` in `main/ipc/reports.js` — calls existing `renderLetterhead()` from `main/reports/letterhead.js`, returns HTML string
2. Expose in `preload.js` as `window.api.reports.renderLetterhead(overrides)`
3. Replace the ~40-line inline letterhead template in `ux-enhancements.js:406-454` with a single `await window.api.reports.renderLetterhead({ documentTitle })` call
4. Keep the existing `catch` fallback for when IPC is unavailable

## Fix 3: No try/catch in `engine.js`

**File:** `main/reports/engine.js`

Wrap the entire pipeline (steps 1-8) in try/catch. On failure return `{ success: false, error: <message> }`. Log with `console.error`.

## Fix 4: Implement 4 admin forms

**Architecture:** Approach A (engine-driven forms)

### New files

- `main/reports/channels/adminForms.js` — 4 template functions:
  - `buildRegistrationFormHTML(data)` — student name, massar code, class, birth date, guardian info, address
  - `buildTransferFormHTML(data)` — student info, origin school, destination school, reason, guardian consent
  - `buildDropoutFormHTML(data)` — student info, last attendance date, reason, notification details
  - `buildAbsenceJustificationHTML(data)` — student info, absence dates, reason, guardian signature

- `js/pages/reports-forms.js` — page controller for form UI, student data fetching, IPC calls

### Modified files

- `main/ipc/reports.js` — add `reports:generateAdminForm` channel that accepts `{ formType, data }`, calls the matching template, feeds `bodyHTML` into `printDocument()` with `documentType: 'admin_form'`
- `preload.js` — expose `window.api.reports.generateAdminForm(payload)`
- `reports-forms.html` — replace stub cards with proper UI: generate buttons that open inline forms, collect data, call IPC for real PDF output

### Flow

```
User fills form fields in UI
  → js/pages/reports-forms.js calls window.api.reports.generateAdminForm({ formType, data })
    → main/ipc/reports.js calls buildXxxFormHTML(data) from adminForms.js
      → bodyHTML fed to printDocument({ documentType: 'admin_form', bodyHTML, ... })
        → engine adds letterhead, footer, security bar, watermark → PDF
```

## Fix 5: Remove legacy IPC channels

**Files:** `main/ipc/reports.js`, `preload.js`

Delete dead code (zero callers confirmed via codebase search):
- `ipcMain.handle('reports:generateCertificate', ...)` in `main/ipc/reports.js`
- `ipcMain.handle('reports:generateSemesterSummary', ...)` in `main/ipc/reports.js`
- `generateCertificate` and `generateSemesterSummary` in `preload.js`

## Execution Order

1. Fix 5 — remove dead code (clean slate)
2. Fix 3 — try/catch in engine (safety net)
3. Fix 1 — hard-coded school name (quick win)
4. Fix 2 — letterhead deduplication (add IPC, update preview modal)
5. Fix 4 — implement admin forms (largest, depends on 2-3)
