# Implementation Plan: Migrate Ad-hoc Confirmation Patterns

**Branch**: `025-migrate-adhoc-confirms` | **Date**: 2026-04-01 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/025-migrate-adhoc-confirms/spec.md`

---

## Summary

Replace all 12 remaining native `window.confirm()` / `confirm()` call sites across 7 JS files with `await showConfirm()`, and remove the bespoke `import-confirm-overlay` HTML element and its two JS wrapper functions from the settings-imports page. No new files, no IPC changes, no main-process changes. The `showConfirm()` API is already available on all pages (loaded via `js/message-system.js`).

---

## Technical Context

**Language/Version**: Vanilla JavaScript (ES2020+, no transpiler)
**Primary Dependencies**: `window.showConfirm` from `js/message-system.js` (already loaded on all pages via Phase 4 script-tag rollout)
**Storage**: N/A — no data layer changes
**Testing**: Manual visual verification per constitution (RTL + dark mode), `npm run lint`, `npm run test:smoke`
**Target Platform**: Electron renderer process (Chromium)
**Project Type**: Desktop app — multi-page HTML, no bundler
**Performance Goals**: No performance impact — dialog is pure DOM
**Constraints**: Renderer-side only; no IPC, no preload.js, no main process
**Scale/Scope**: 7 JS files, 1 HTML file, 12 call sites

---

## Constitution Check

*GATE: Must pass before implementation.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Formatting (Prettier) | ✅ Pass | All edits must pass `npm run format` |
| I. Linting (ESLint) | ✅ Pass | Renderer ESLint rules are relaxed; `async` conversions are clean |
| I. No dead code | ✅ Pass | `showImportConfirm()` and `showActionConfirm()` MUST be deleted (not left behind) |
| I. Single responsibility | ✅ Pass | No structural changes to page module boundaries |
| II. CI gate (`npm run test:smoke`) | ✅ Pass | No IPC changes → smoke test parity unaffected |
| II. No CDN references | ✅ Pass | No new dependencies |
| II. Manual RTL visual check | ✅ Required | Developer must verify dialog RTL layout in both themes |
| III. RTL-first / Arabic text | ✅ Pass | All dialog text is Arabic RTL |
| III. Consistent interaction patterns | ✅ Pass | Migrating TO the shared pattern, not bypassing it |
| III. Dark mode support | ✅ Pass | `showConfirm()` already handles both themes |
| IV. IPC contract | ✅ Pass | No IPC changes |
| IV. No bundler | ✅ Pass | Vanilla JS only |

**No violations. Proceed.**

---

## Project Structure

### Documentation (this feature)

```text
specs/025-migrate-adhoc-confirms/
├── plan.md              # This file
├── research.md          # Full confirm() audit + decisions
├── data-model.md        # ConfirmConfig entity + transformation pattern
├── checklists/
│   └── requirements.md  # Spec quality checklist (all pass)
└── tasks.md             # Phase 2 output (/speckit.tasks — not yet created)
```

### Source Code (affected files only)

```text
settings-imports.html            # Remove import-confirm-overlay HTML block
js/pages/settings-imports.js    # Delete showImportConfirm + showActionConfirm; rewrite clearData confirm
js/pages/dashboard-init.js      # 1 call site (backup restore)
js/pages/settings-license.js    # 1 call site + async conversion of onAdminRevokeDevice()
js/pages/settings-sync.js       # 1 call site (unlink device)
js/pages/settings-users.js      # 2 call sites (unsaved changes + save defaults)
js/pages/support-sessions.js    # 2 call sites (date warning + delete session)
js/pages/teachers-list.js       # 1 call site + async conversion of deleteTeacher()
js/pages/timetable.js           # 2 call sites + async conversion of cancelEditMode()
```

**Structure Decision**: Single-project flat layout — each affected file is at its known path. No new directories or files created.

---

## Implementation Phases

### Phase A: settings-imports — Overlay Removal (Highest Risk)

This is the most complex change: remove both the HTML overlay element and two JS wrapper functions, and replace `clearData`'s use of `showActionConfirm()` with direct `showConfirm()` calls.

#### Step A1: Remove `import-confirm-overlay` from `settings-imports.html`

Locate and delete the entire `<div class="import-confirm-overlay" ...>` block (approximately 17 lines, lines ~600–617). Nothing else changes in the HTML.

#### Step A2: Rewrite `clearData` in `settings-imports.js`

`clearData` already awaits `showActionConfirm(message)` and is already `async`. Replace the single `showActionConfirm(message)` call (line 1626) with a `showConfirm()` call that uses the dynamically built `message` string and adds a `detail` line and correct `type` per data type:

- `students`, `grades`, `absences`, `teachers` → `type: 'danger'`, `confirmText: 'حذف نهائي'`
- `timetable`, `status` → `type: 'warning'`, `confirmText: 'تأكيد'`

The `label` and `message` strings already exist in `clearData` — reuse them directly.

#### Step A3: Replace `showImportConfirm` usage

`showImportConfirm(action, files)` is called from the import button handler. Replace the entire function call with:

```js
const { confirmed } = await showConfirm({
    title: 'استيراد البيانات',
    message: /* dynamically built message — same text as before */,
    type: 'info',
    icon: 'fa-cloud-upload-alt',
    confirmText: 'بدء الاستيراد',
    cancelText: 'إلغاء',
});
if (!confirmed) return;
```

The message construction logic (file names, semester label) stays exactly as it was — only the display mechanism changes.

#### Step A4: Delete dead functions

Delete the complete `showImportConfirm()` and `showActionConfirm()` function bodies (lines ~435–537). These functions only existed to drive the overlay; with the overlay gone they are dead code (constitution §I: no dead code).

#### Step A5: Verify & commit

```bash
npm run lint
npm run test:smoke
# Manual: open settings-imports.html, test all 6 clear buttons + import flow
git add settings-imports.html js/pages/settings-imports.js
git commit -m "refactor(settings-imports): replace overlay and window.confirm with showConfirm()"
```

---

### Phase B: Simple call sites — no async conversion needed (6 files)

These files already have async handlers. Each change is a straight swap.

#### B1: `js/pages/dashboard-init.js` line ~213

**Context**: Backup restore file-input change handler (already async).

Replace:
```js
const confirmed = window.confirm(`سيتم استبدال البيانات الحالية بالملف: ${file.name}. هل تريد المتابعة؟`);
if (!confirmed) { ... }
```
With:
```js
const { confirmed } = await showConfirm({
    title: 'استعادة النسخة الاحتياطية',
    message: `سيتم استبدال البيانات الحالية بالملف: ${file.name}. هل تريد المتابعة؟`,
    type: 'warning',
    confirmText: 'متابعة',
});
if (!confirmed) { ... }
```

#### B2: `js/pages/settings-sync.js` line ~1550

**Context**: Unlink device button handler (already in async context).

Replace:
```js
const confirmed = window.confirm(`هل تريد تأكيد إلغاء ربط الجهاز "${deviceName}"؟`);
if (!confirmed) return;
```
With:
```js
const { confirmed } = await showConfirm({
    title: 'إلغاء ربط الجهاز',
    message: `هل تريد تأكيد إلغاء ربط الجهاز "${deviceName}"؟`,
    type: 'warning',
    confirmText: 'إلغاء الربط',
});
if (!confirmed) return;
```

#### B3: `js/pages/settings-users.js` line ~397

**Context**: Refresh page-visibility handler, unsaved-changes guard (already async).

Replace:
```js
const proceed = window.confirm('هناك تعديلات غير محفوظة. هل تريد التحديث وفقدان التغييرات؟');
if (!proceed) return;
```
With:
```js
const { confirmed: proceed } = await showConfirm({
    title: 'تحديث البيانات',
    message: 'هناك تعديلات غير محفوظة. هل تريد التحديث وفقدان التغييرات؟',
    type: 'warning',
    confirmText: 'تحديث',
});
if (!proceed) return;
```

#### B4: `js/pages/settings-users.js` line ~413

**Context**: Save page-visibility defaults (already async).

Replace:
```js
const confirmed = window.confirm(
    'هل تريد حفظ إعدادات الظهور الحالية كإعداد افتراضي؟\nستُطبَّق هذه الإعدادات تلقائياً عند تثبيت التطبيق على أي جهاز جديد.'
);
if (!confirmed) return;
```
With:
```js
const { confirmed } = await showConfirm({
    title: 'حفظ الإعداد الافتراضي',
    message: 'هل تريد حفظ إعدادات الظهور الحالية كإعداد افتراضي؟',
    detail: 'ستُطبَّق هذه الإعدادات تلقائياً عند تثبيت التطبيق على أي جهاز جديد.',
    type: 'info',
    confirmText: 'حفظ',
});
if (!confirmed) return;
```

#### B5: `js/pages/support-sessions.js` line ~442

**Context**: Date-too-far warning in session-add handler (already async). Note: this is a *soft warning* — the user continues if they confirm. Keep `type: 'warning'`.

Replace:
```js
if (daysDiff > 7 && !confirm('التاريخ المختار بعيد عن اليوم بأكثر من أسبوع. هل تريد المتابعة؟')) {
    return;
}
```
With:
```js
if (daysDiff > 7) {
    const { confirmed: proceed } = await showConfirm({
        title: 'تاريخ بعيد',
        message: 'التاريخ المختار بعيد عن اليوم بأكثر من أسبوع. هل تريد المتابعة؟',
        type: 'warning',
        confirmText: 'متابعة',
    });
    if (!proceed) return;
}
```

#### B6: `js/pages/support-sessions.js` line ~500

**Context**: Delete support session, inside `tbody` click handler (already async).

Replace:
```js
if (!confirm(`سيتم حذف حصة الدعم بتاريخ ${sessionDate} الخاصة بـ ${teacherName}. لا يمكن التراجع بعد الحذف.`))
    return;
```
With:
```js
const { confirmed } = await showConfirm({
    title: 'حذف حصة الدعم',
    message: `سيتم حذف حصة الدعم بتاريخ ${sessionDate} الخاصة بـ ${teacherName}.`,
    detail: 'لا يمكن التراجع بعد الحذف.',
    type: 'danger',
    confirmText: 'حذف',
});
if (!confirmed) return;
```

#### B7: Commit Phase B

```bash
npm run lint
npm run test:smoke
# Manual: test each affected page
git add js/pages/dashboard-init.js js/pages/settings-sync.js js/pages/settings-users.js js/pages/support-sessions.js
git commit -m "refactor: replace window.confirm() with showConfirm() in dashboard, sync, users, support-sessions"
```

---

### Phase C: Call sites requiring `async` conversion (3 files)

#### C1: `js/pages/settings-license.js` — `onAdminRevokeDevice()`

The function is currently synchronous. Convert to `async` and replace:

```js
// Before
function onAdminRevokeDevice(activationId) {
    ...
    if (!confirm('هل تريد تعطيل هذا الجهاز من الترخيص؟')) return;
    ...
}

// After
async function onAdminRevokeDevice(activationId) {
    ...
    const { confirmed } = await showConfirm({
        title: 'تعطيل الجهاز',
        message: 'هل تريد تعطيل هذا الجهاز من الترخيص؟',
        type: 'danger',
        confirmText: 'تعطيل',
    });
    if (!confirmed) return;
    ...
}
```

The caller is a DOM event listener (fire-and-forget) — no caller changes needed.

#### C2: `js/pages/teachers-list.js` — `deleteTeacher()`

Convert to `async` and replace:

```js
// Before
function deleteTeacher(id) {
    if (!confirm('هل تريد حذف هذا الأستاذ؟')) return;
    ...
}

// After
async function deleteTeacher(id) {
    const { confirmed } = await showConfirm({
        title: 'حذف الأستاذ',
        message: 'هل تريد حذف هذا الأستاذ؟',
        type: 'danger',
        confirmText: 'حذف',
    });
    if (!confirmed) return;
    ...
}
```

#### C3: `js/pages/timetable.js` — `cancelEditMode()` (line 2962)

Convert to `async`. The guard only fires when there are pending changes, so wrap accordingly:

```js
// Before
function cancelEditMode() {
    if (editMode.pendingChanges.length > 0) {
        if (!confirm('هل تريد إلغاء جميع التعديلات المعلقة؟')) {
            return;
        }
    }
    ...
}

// After
async function cancelEditMode() {
    if (editMode.pendingChanges.length > 0) {
        const { confirmed } = await showConfirm({
            title: 'إلغاء التعديلات',
            message: 'هل تريد إلغاء جميع التعديلات المعلقة؟',
            type: 'warning',
            confirmText: 'إلغاء التعديلات',
            cancelText: 'تراجع',
        });
        if (!confirmed) return;
    }
    ...
}
```

Verify all callers of `cancelEditMode()` in `timetable.js` — they should be DOM event listeners (fire-and-forget). If any caller awaits the return value, update it.

#### C4: `js/pages/timetable.js` — import merge/replace (line 3247)

This is an anonymous handler inside a file-change listener. The `confirm()` result is used as a boolean branch (`if (action)` → merge, `else` → replace). Convert to an async IIFE or convert the wrapping handler to `async`:

```js
// Before — synchronous branch
const action = confirm('كيف تريد الاستيراد؟\n- موافق: دمج\n- إلغاء: استبدال');
if (action) {
    // merge
} else {
    // replace
}

// After — confirmText=merge, cancel still resolves to false=replace
const { confirmed: doMerge } = await showConfirm({
    title: 'استيراد التغييرات',
    message: 'كيف تريد الاستيراد؟',
    detail: 'موافق: دمج مع التغييرات الحالية — إلغاء: استبدال التغييرات الحالية',
    type: 'info',
    confirmText: 'دمج',
    cancelText: 'استبدال',
});
if (doMerge) {
    // merge
} else {
    // replace
}
```

The wrapping event handler must be converted to `async` (or the call placed inside an `async` IIFE).

#### C5: Commit Phase C

```bash
npm run lint
npm run test:smoke
# Manual: test license revoke, teacher delete, timetable cancel-edit, timetable import
git add js/pages/settings-license.js js/pages/teachers-list.js js/pages/timetable.js
git commit -m "refactor: replace confirm() with showConfirm() in license, teachers-list, timetable (async conversions)"
```

---

### Phase D: Final Verification

1. **grep check** — zero remaining `confirm(` calls (excluding `message-system.js`):
   ```bash
   grep -rn "window\.confirm\|[^w]confirm(" js/ --include="*.js" | grep -v message-system | grep -v showConfirm
   ```
   Expected: no output.

2. **HTML check** — `import-confirm-overlay` is gone:
   ```bash
   grep -rn "import-confirm-overlay" . --include="*.html"
   ```
   Expected: no output.

3. **RTL + dark mode visual check** — open each affected page, trigger each migrated action, verify dialog renders correctly in both themes.

4. **Final commit** (if any trailing cleanups):
   ```bash
   npm run lint
   npm run css:build
   npm run test:smoke
   git add -A
   git commit -m "chore: final cleanup after confirm() migration"
   ```

---

## Complexity Tracking

*No constitution violations.*
