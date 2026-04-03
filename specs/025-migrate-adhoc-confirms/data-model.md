# Data Model: Migrate Ad-hoc Confirmation Patterns

**Feature**: 025-migrate-adhoc-confirms
**Date**: 2026-04-01

---

## Overview

This feature has no new data entities — it is a pure UI behavioral migration. The entities below describe the **configuration objects** passed to `showConfirm()` and the **call-site transformation pattern** applied to every converted location.

---

## Entity: ConfirmConfig

The configuration object passed to `window.showConfirm()`. Already defined by the message-system implementation; documented here for implementer reference.

| Field | Type | Required | Values / Notes |
|-------|------|----------|----------------|
| `title` | string | Yes | Arabic RTL text — dialog header title |
| `message` | string | Yes | Arabic RTL text — primary message body |
| `detail` | string | No | Secondary muted text — used for irreversibility warnings |
| `type` | string | Yes | `'danger'` \| `'warning'` \| `'info'` |
| `icon` | string | No | FontAwesome class override (e.g. `'fa-cloud-upload-alt'`) |
| `confirmText` | string | No | Defaults to `'تأكيد'` — override for destructive actions |
| `cancelText` | string | No | Defaults to `'إلغاء'` |
| `requireInput` | boolean | No | When true, confirm button disabled until input filled |
| `inputPlaceholder` | string | No | Placeholder for the optional input field |

---

## Entity: CallSiteTransformation

The standard before/after pattern applied at each of the 12 call sites.

**Before (synchronous)**:
```
if (!confirm('message text')) return;
// or
const confirmed = window.confirm('message text');
if (!confirmed) { ... }
```

**After (async)**:
```
const { confirmed } = await showConfirm({ title, message, type, ... });
if (!confirmed) return;
```

**State transitions**:
- Function that was synchronous → must become `async`
- Return value changes from `boolean` to `Promise<{ confirmed: boolean, inputValue?: string }>`
- Callers (DOM event listeners) are unaffected — fire-and-forget is preserved

---

## Affected Files Summary

| File | Call sites | Functions needing `async` conversion |
|------|-----------|--------------------------------------|
| `js/pages/settings-imports.js` | 3 (2 fallback + 1 via `showActionConfirm`) | None — already async |
| `js/pages/dashboard-init.js` | 1 | None — already async |
| `js/pages/settings-license.js` | 1 | `onAdminRevokeDevice()` |
| `js/pages/settings-sync.js` | 1 | None — already async |
| `js/pages/settings-users.js` | 2 | None — already async |
| `js/pages/support-sessions.js` | 2 | None — already async |
| `js/pages/teachers-list.js` | 1 | `deleteTeacher()` |
| `js/pages/timetable.js` | 2 | `cancelEditMode()`, anonymous import handler |

---

## HTML Removals

| Element | File | Action |
|---------|------|--------|
| `<div class="import-confirm-overlay" ...>` (full block ~17 lines) | `settings-imports.html` | Remove entirely |
| Related `import-confirm-overlay` DOM references in JS | `settings-imports.js` | Remove `showImportConfirm()` and `showActionConfirm()` functions |
