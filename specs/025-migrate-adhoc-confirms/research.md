# Research: Migrate Ad-hoc Confirmation Patterns

**Feature**: 025-migrate-adhoc-confirms
**Date**: 2026-04-01

---

## 1. Full Audit of `confirm()` Call Sites

### Decision: 12 call sites across 7 files — all must be migrated

**Rationale**: A complete grep of `js/` found every occurrence. No call sites were missed.

| File | Line(s) | Current pattern | Risk level | Async context? |
|------|---------|-----------------|-----------|----------------|
| `js/pages/settings-imports.js` | 442, 502 | `window.confirm()` inside `showImportConfirm` / `showActionConfirm` fallback paths | Medium | Already async (Promise) |
| `js/pages/settings-imports.js` | 1626 | `showActionConfirm(message)` → delegates to overlay OR `window.confirm` | High (6 buttons) | Already `async function clearData` |
| `js/pages/dashboard-init.js` | 213 | `window.confirm(...)` — backup restore guard | Medium | Already `async` handler |
| `js/pages/settings-license.js` | 96 | `confirm(...)` — revoke device | Low | Not async — needs conversion |
| `js/pages/settings-sync.js` | 1550 | `window.confirm(...)` — unlink device | Low | Already in async IIFE |
| `js/pages/settings-users.js` | 397 | `window.confirm(...)` — unsaved changes warning | Low | Already `async` handler |
| `js/pages/settings-users.js` | 413 | `window.confirm(...)` — save page visibility defaults | Low | Already `async` handler |
| `js/pages/support-sessions.js` | 442 | `confirm(...)` — date too far warning | Low | Already `async` handler |
| `js/pages/support-sessions.js` | 500 | `confirm(...)` — delete support session | High | Already `async` handler |
| `js/pages/teachers-list.js` | 607 | `confirm(...)` inside `deleteTeacher()` | Medium | Not async — needs conversion |
| `js/pages/timetable.js` | 2962 | `confirm(...)` — cancel pending edits | Low | Not async — needs conversion |
| `js/pages/timetable.js` | 3247 | `confirm(...)` — import merge vs replace (binary choice) | Special | Not async — needs conversion |

**Total**: 12 call sites, 7 files

---

## 2. settings-imports: Overlay Architecture

### Decision: Replace both `showImportConfirm` and `showActionConfirm` functions with direct `showConfirm()` calls; remove `import-confirm-overlay` HTML

**Rationale**:

The existing code has two wrapper functions (`showImportConfirm` and `showActionConfirm`) that:
1. Try to use the `import-confirm-overlay` DOM element
2. Fall back to `window.confirm()` if the element is missing (lines 442, 502)

The `clearData` function (line 1626) already calls `showActionConfirm(message)` — it is already async and already awaits the result. This means the **migration on settings-imports is surgical**: replace `showActionConfirm` and `showImportConfirm` with `showConfirm()`, remove the overlay HTML, and delete the two wrapper functions.

The six `btn-clear-*` button listeners (lines 277–282) all call `clearData(type)` — they do not need to become async arrow functions because `clearData` is already `async` and the listeners just invoke it without awaiting (fire-and-forget pattern, errors caught inside `clearData`).

**Alternatives considered**:
- Keep `showActionConfirm` as a thin wrapper over `showConfirm()` — rejected because it adds a layer with no benefit once the overlay is gone.
- Keep the overlay HTML for backward compat — rejected per spec FR-009.

---

## 3. timetable.js Line 3247: Binary Choice Confirm

### Decision: Replace with a danger-type `showConfirm()` defaulting to "merge", with a note in the message explaining the cancel=replace semantic

**Rationale**:

The native `confirm()` at line 3247 uses an unusual pattern: `ok` = merge, `cancel` = replace. This is a UX anti-pattern (cancel should mean "do nothing"). The replacement must:
- Use `showConfirm()` with confirmText = "دمج" (merge) and cancelText = "استبدال" (replace) so button labels communicate the actual action
- The function `cancelEditMode()` at line 2962 is currently synchronous; it must become `async` and the caller(s) must accommodate this

**Alternatives considered**:
- Preserve ok=merge, cancel=replace semantics — rejected because `cancelText='إلغاء'` would mean "do nothing" per UX convention, making "replace" inaccessible
- Use two separate buttons via a custom dialog extension — out of scope; `showConfirm()` with relabeled buttons is sufficient

---

## 4. Functions Requiring `async` Conversion

### Decision: Convert 4 functions from synchronous to async

| Function | File | Callers to check |
|----------|------|-----------------|
| `onAdminRevokeDevice(activationId)` | `settings-license.js:96` | event listener, already fire-and-forget |
| `cancelEditMode()` | `timetable.js:2962` | called from undo/redo UI buttons |
| `deleteTeacher(id)` | `teachers-list.js:607` | called from click handler |
| timetable import handler (anonymous) | `timetable.js:3247` | file change event listener |

**Rationale**: All four are called from DOM event listeners which do not await their return value. Making them `async` is safe — the caller is a fire-and-forget listener, errors must be caught inside the function with try/catch (global error boundary catches them otherwise).

---

## 5. `showConfirm()` Availability

### Decision: `showConfirm()` is confirmed available on all pages

**Rationale**: Phase 4 of the message system (branch `024-wire-message-system`) added `<script src="js/message-system.js" defer>` to all 44 HTML pages. The current branch `024-wire-message-system` is the predecessor and has already been committed (see git log). Every page affected by this migration loads `message-system.js`.

---

## 6. Message Content for Each Call Site

### Decision: Use the Arabic text from the existing confirm() as the base message; add `detail` lines for destructive actions

| File:line | type | title | message (source text) | detail |
|-----------|------|-------|-----------------------|--------|
| `settings-imports.js` import | `info` | `استيراد البيانات` | dynamically built (file names + label) | — |
| `settings-imports.js` clearData/students | `danger` | `حذف بيانات التلاميذ` | `هل تريد حذف بيانات التلاميذ الخاصة بالموسم {year}؟` | `لا يمكن التراجع عن هذا الإجراء.` |
| `settings-imports.js` clearData/grades | `danger` | `حذف النقط` | `هل تريد حذف نقط {semester} الخاصة بالموسم {year}؟` | `لا يمكن التراجع عن هذا الإجراء.` |
| `settings-imports.js` clearData/absences | `danger` | `حذف سجلات الغياب` | `هل تريد حذف سجلات الغياب الخاصة بالموسم {year}؟` | `لا يمكن التراجع عن هذا الإجراء.` |
| `settings-imports.js` clearData/timetable | `warning` | `حذف بيانات الجدول` | `هل تريد حذف بيانات الجدول الزمني؟` | `لا يمكن التراجع عن هذا الإجراء.` |
| `settings-imports.js` clearData/teachers | `danger` | `حذف بيانات الأساتذة` | `هل تريد حذف بيانات الأساتذة الخاصة بالموسم {year}؟` | `لا يمكن التراجع عن هذا الإجراء.` |
| `settings-imports.js` clearData/status | `warning` | `إعادة الوضعيات` | `هل تريد إعادة جميع الوضعيات إلى "نشط" للموسم {year}؟` | `لا يمكن التراجع عن هذا الإجراء.` |
| `dashboard-init.js:213` | `warning` | `استعادة النسخة الاحتياطية` | `سيتم استبدال البيانات الحالية بالملف: {filename}. هل تريد المتابعة؟` | — |
| `settings-license.js:96` | `danger` | `تعطيل الجهاز` | `هل تريد تعطيل هذا الجهاز من الترخيص؟` | — |
| `settings-sync.js:1550` | `warning` | `إلغاء ربط الجهاز` | `هل تريد تأكيد إلغاء ربط الجهاز "{deviceName}"؟` | — |
| `settings-users.js:397` | `warning` | `تحديث البيانات` | `هناك تعديلات غير محفوظة. هل تريد التحديث وفقدان التغييرات؟` | — |
| `settings-users.js:413` | `info` | `حفظ الإعداد الافتراضي` | `هل تريد حفظ إعدادات الظهور الحالية كإعداد افتراضي؟` | `ستُطبَّق هذه الإعدادات تلقائياً عند تثبيت التطبيق على أي جهاز جديد.` |
| `support-sessions.js:442` | `warning` | `تاريخ بعيد` | `التاريخ المختار بعيد عن اليوم بأكثر من أسبوع. هل تريد المتابعة؟` | — |
| `support-sessions.js:500` | `danger` | `حذف حصة الدعم` | `سيتم حذف حصة الدعم بتاريخ {date} الخاصة بـ {teacher}. لا يمكن التراجع بعد الحذف.` | — |
| `teachers-list.js:607` | `danger` | `حذف الأستاذ` | `هل تريد حذف هذا الأستاذ؟` | — |
| `timetable.js:2962` | `warning` | `إلغاء التعديلات` | `هل تريد إلغاء جميع التعديلات المعلقة؟` | — |
| `timetable.js:3247` | `info` | `استيراد التغييرات` | `كيف تريد الاستيراد؟` | `موافق: دمج مع التغييرات الحالية — إلغاء: استبدال التغييرات الحالية` |

---

## 7. Constitution Compliance

All changes are renderer-side only (no IPC, no main process, no preload.js changes). No new files are created — only existing JS and one HTML file are modified. The smoke test (`npm run test:smoke`) does not validate confirm() usage, so CI will not auto-catch regressions — manual testing per the spec is the verification gate.

All migrated handlers remain vanilla JS with no new dependencies. Prettier and ESLint conventions apply as usual.
