# Tasks: Migrate Ad-hoc Confirmation Patterns

**Input**: Design documents from `/specs/025-migrate-adhoc-confirms/`
**Branch**: `025-migrate-adhoc-confirms`
**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Research**: [research.md](research.md) | **Data Model**: [data-model.md](data-model.md)

> **Context for implementing LLM**: This is a pure UI behavioral migration in a vanilla-JS Electron desktop app (Arabic school management system). No bundler, no framework — just plain JS files loaded directly by HTML pages. The `showConfirm()` function is already implemented in `js/message-system.js` and already loaded on every page. Your only job is to replace every `window.confirm()` / `confirm()` call with `await showConfirm({...})`, remove one HTML overlay block, and delete two now-dead JS wrapper functions. No IPC, no main-process, no CSS changes required.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Task touches different files from adjacent tasks — can be parallelized
- **[Story]**: Which user story this task belongs to ([US1], [US2], [US3])
- No tests are requested — this is a refactor migration only

---

## Phase 1: Setup (Read & Verify)

**Purpose**: Confirm the environment and locate all call sites before touching any code.

- [ ] T001 Verify `window.showConfirm` is available: open any HTML page in the app (`npm run dev`), open DevTools console, type `typeof showConfirm` — expected result: `"function"`. If `"undefined"`, stop and confirm that `js/message-system.js` is wired in all HTML pages before proceeding.
- [x] T002 Run the grep audit to confirm the 12 call sites documented in `research.md` still match the current codebase: `grep -rn "window\.confirm\|[^w]confirm(" js/ --include="*.js" | grep -v node_modules | grep -v message-system | grep -v showConfirm` — expected: exactly the 12 lines listed in `research.md`. If output differs, update your understanding of scope before proceeding.

---

## Phase 2: Foundational (No blocking prerequisites — skip directly to Phase 3)

> This migration has no shared infrastructure to build. All user stories can be implemented immediately after Phase 1 verification. Phases 3–5 below can be worked on in any order.

---

## Phase 3: User Story 1 — settings-imports: Overlay Removal + Six Clear Buttons (Priority: P1) 🎯 MVP

**Goal**: Remove the bespoke `import-confirm-overlay` HTML element and its two JS wrapper functions; replace the import-start confirm and the six data-clear button confirms with `showConfirm()`.

**Independent Test**: Open `settings-imports.html` in the app. Click each of the six stat-card delete buttons (students, grades, absences, timetable, teachers, status) — each MUST show the unified branded dialog, NOT a browser-native box. Click "بدء الاستيراد" after selecting a file — MUST show the unified info dialog. The old overlay div MUST be absent from the DOM (verify with DevTools Elements panel).

### Implementation for User Story 1

- [x] T003 [US1] **Remove overlay HTML block** from `settings-imports.html`: locate `<div class="import-confirm-overlay"` (approximately lines 600–617) and delete the entire block including its closing `</div>`. Nothing else in the HTML file changes.

- [x] T004 [US1] **Delete `showImportConfirm()` function** from `js/pages/settings-imports.js` (lines ~435–493): remove the entire function body. This function drove the old overlay and is now dead code. Do not leave a stub behind.

- [x] T005 [US1] **Delete `showActionConfirm()` function** from `js/pages/settings-imports.js` (lines ~495–537): remove the entire function body. Same reason as T004.

- [x] T006 [US1] **Rewrite the import-start confirm** in `js/pages/settings-imports.js`: find the call site where `showImportConfirm(action, files)` was called from the import button handler. Replace it with:

    ```js
    const { confirmed } = await showConfirm({
        title: 'استيراد البيانات',
        message: /* keep the exact same dynamically-built message string that was previously passed to the overlay */,
        type: 'info',
        icon: 'fa-cloud-upload-alt',
        confirmText: 'بدء الاستيراد',
        cancelText: 'إلغاء',
    });
    if (!confirmed) return;
    ```

    The message construction logic (file names, semester label, multi-file preview) stays exactly as it was — only the display mechanism changes. The containing function is already `async`.

- [x] T007 [US1] **Rewrite `clearData()` confirm** in `js/pages/settings-imports.js` (line ~1626): replace the single `showActionConfirm(message)` call with a `showConfirm()` call. The `label`, `message`, and `schoolYear` variables already exist in `clearData` — reuse them. Apply the correct `type` and `confirmText` per data type:

    ```js
    // Determine type and confirmText based on the `type` parameter
    const isHard = ['students', 'grades', 'absences', 'teachers'].includes(type);
    const dialogType = isHard ? 'danger' : 'warning';

    const { confirmed } = await showConfirm({
        title: `حذف ${label}`,
        message, // already built above on line ~1619
        detail: 'لا يمكن التراجع عن هذا الإجراء.',
        type: dialogType,
        confirmText: isHard ? 'حذف نهائي' : 'تأكيد'
    });
    if (!confirmed) return;
    ```

    Remove the old `const confirmed = await showActionConfirm(message);` line. The function is already `async` — no conversion needed.

**Checkpoint**: User Story 1 is fully functional. All six clear buttons and the import flow use `showConfirm()`. The overlay HTML is gone. Run `npm run lint` before committing.

```bash
npm run lint
git add settings-imports.html js/pages/settings-imports.js
git commit -m "refactor(settings-imports): replace import overlay and window.confirm with showConfirm()"
```

---

## Phase 4: User Story 2 — Import-start confirm (already covered in Phase 3)

> User Story 2 (import-start confirmation) is **fully implemented within Phase 3** — task T006 covers it. No additional phase needed. Mark US2 complete after Phase 3 checkpoint passes.

---

## Phase 5: User Story 3 — Replace All Remaining `window.confirm()` Calls (Priority: P2)

**Goal**: Replace the 9 remaining native `confirm()` call sites in 5 JS files. Four of these files have their containing functions already `async`; three require `async` conversion.

**Independent Test**: After all tasks below are complete, run:

```bash
grep -rn "window\.confirm\|[^w]confirm(" js/ --include="*.js" | grep -v node_modules | grep -v message-system | grep -v showConfirm
```

Expected output: **empty** (no matches). Additionally, open each affected page and trigger the relevant action to visually confirm the unified dialog appears.

### Group A — No async conversion needed (files already have async handlers)

These four tasks touch different files and can be done in parallel.

- [x] T008 [P] [US3] **`js/pages/dashboard-init.js` line ~213** — backup restore guard. The handler is already async. Replace:

    ```js
    // BEFORE
    const confirmed = window.confirm(`سيتم استبدال البيانات الحالية بالملف: ${file.name}. هل تريد المتابعة؟`);
    if (!confirmed) {
        e.target.value = '';
        updateBackupModalSummary();
        return;
    }

    // AFTER
    const { confirmed } = await showConfirm({
        title: 'استعادة النسخة الاحتياطية',
        message: `سيتم استبدال البيانات الحالية بالملف: ${file.name}. هل تريد المتابعة؟`,
        type: 'warning',
        confirmText: 'متابعة'
    });
    if (!confirmed) {
        e.target.value = '';
        updateBackupModalSummary();
        return;
    }
    ```

- [x] T009 [P] [US3] **`js/pages/settings-sync.js` line ~1550** — unlink device. Already async. Replace:

    ```js
    // BEFORE
    const confirmed = window.confirm(`هل تريد تأكيد إلغاء ربط الجهاز "${deviceName}"؟`);
    if (!confirmed) return;

    // AFTER
    const { confirmed } = await showConfirm({
        title: 'إلغاء ربط الجهاز',
        message: `هل تريد تأكيد إلغاء ربط الجهاز "${deviceName}"؟`,
        type: 'warning',
        confirmText: 'إلغاء الربط'
    });
    if (!confirmed) return;
    ```

- [x] T010 [P] [US3] **`js/pages/settings-users.js` — two call sites**. Both handlers are already async.

    _Site 1_ — line ~397, unsaved-changes guard:

    ```js
    // BEFORE
    const proceed = window.confirm('هناك تعديلات غير محفوظة. هل تريد التحديث وفقدان التغييرات؟');
    if (!proceed) return;

    // AFTER
    const { confirmed: proceed } = await showConfirm({
        title: 'تحديث البيانات',
        message: 'هناك تعديلات غير محفوظة. هل تريد التحديث وفقدان التغييرات؟',
        type: 'warning',
        confirmText: 'تحديث'
    });
    if (!proceed) return;
    ```

    _Site 2_ — line ~413, save page-visibility defaults:

    ```js
    // BEFORE
    const confirmed = window.confirm(
        'هل تريد حفظ إعدادات الظهور الحالية كإعداد افتراضي؟\nستُطبَّق هذه الإعدادات تلقائياً عند تثبيت التطبيق على أي جهاز جديد.'
    );
    if (!confirmed) return;

    // AFTER
    const { confirmed } = await showConfirm({
        title: 'حفظ الإعداد الافتراضي',
        message: 'هل تريد حفظ إعدادات الظهور الحالية كإعداد افتراضي؟',
        detail: 'ستُطبَّق هذه الإعدادات تلقائياً عند تثبيت التطبيق على أي جهاز جديد.',
        type: 'info',
        confirmText: 'حفظ'
    });
    if (!confirmed) return;
    ```

- [x] T011 [P] [US3] **`js/pages/support-sessions.js` — two call sites**. Both handlers are already async.

    _Site 1_ — line ~442, date-too-far soft warning:

    ```js
    // BEFORE
    if (daysDiff > 7 && !confirm('التاريخ المختار بعيد عن اليوم بأكثر من أسبوع. هل تريد المتابعة؟')) {
        return;
    }

    // AFTER
    if (daysDiff > 7) {
        const { confirmed: proceed } = await showConfirm({
            title: 'تاريخ بعيد',
            message: 'التاريخ المختار بعيد عن اليوم بأكثر من أسبوع. هل تريد المتابعة؟',
            type: 'warning',
            confirmText: 'متابعة'
        });
        if (!proceed) return;
    }
    ```

    _Site 2_ — line ~500, delete support session:

    ```js
    // BEFORE
    if (!confirm(`سيتم حذف حصة الدعم بتاريخ ${sessionDate} الخاصة بـ ${teacherName}. لا يمكن التراجع بعد الحذف.`))
        return;

    // AFTER
    const { confirmed } = await showConfirm({
        title: 'حذف حصة الدعم',
        message: `سيتم حذف حصة الدعم بتاريخ ${sessionDate} الخاصة بـ ${teacherName}.`,
        detail: 'لا يمكن التراجع بعد الحذف.',
        type: 'danger',
        confirmText: 'حذف'
    });
    if (!confirmed) return;
    ```

### Group B — Requires `async` conversion (3 files)

These tasks touch different files and can be done in parallel.

- [x] T012 [P] [US3] **`js/pages/settings-license.js` — convert `onAdminRevokeDevice()` to async** (line ~96). Add `async` to the function declaration, then replace:

    ```js
    // BEFORE
    function onAdminRevokeDevice(activationId) {
        ...
        if (!confirm('هل تريد تعطيل هذا الجهاز من الترخيص؟')) return;
        ...
    }

    // AFTER
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

    The function is called from a DOM event listener (fire-and-forget) — no caller changes needed.

- [x] T013 [P] [US3] **`js/pages/teachers-list.js` — convert `deleteTeacher()` to async** (line ~607). Add `async` to the function declaration, then replace:

    ```js
    // BEFORE
    function deleteTeacher(id) {
        if (!confirm('هل تريد حذف هذا الأستاذ؟')) return;
        ...
    }

    // AFTER
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

    The function is called from a click event listener — no caller changes needed.

- [x] T014 [US3] **`js/pages/timetable.js` — two call sites, two async conversions**.

    _Site 1_ — `cancelEditMode()` at line ~2962: add `async` to the function declaration, then replace the confirm guard:

    ```js
    // BEFORE
    function cancelEditMode() {
        if (editMode.pendingChanges.length > 0) {
            if (!confirm('هل تريد إلغاء جميع التعديلات المعلقة؟')) {
                return;
            }
        }
        ...
    }

    // AFTER
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

    After converting, search timetable.js for all callers of `cancelEditMode()` — if any caller uses `.then()` or `await`, update it. DOM event listeners that simply call `cancelEditMode()` need no changes.

    _Site 2_ — anonymous import handler at line ~3247: this `confirm()` uses an unusual semantic (`ok` = merge, `cancel` = replace). Convert the wrapping handler to `async` (or wrap in an async IIFE), then replace:

    ```js
    // BEFORE — synchronous, ok=merge, cancel=replace
    const action = confirm(
        'كيف تريد الاستيراد؟\n- موافق: دمج مع التغييرات الحالية\n- إلغاء: استبدال التغييرات الحالية'
    );
    if (action) {
        // merge
    } else {
        // replace
    }

    // AFTER — relabeled buttons preserve the same semantic
    const { confirmed: doMerge } = await showConfirm({
        title: 'استيراد التغييرات',
        message: 'كيف تريد الاستيراد؟',
        detail: 'موافق: دمج مع التغييرات الحالية — إلغاء: استبدال التغييرات الحالية',
        type: 'info',
        confirmText: 'دمج',
        cancelText: 'استبدال'
    });
    if (doMerge) {
        // merge — same code as before
    } else {
        // replace — same code as before
    }
    ```

**Checkpoint**: Run the grep audit (T002 command). Expected: zero output. Then `npm run lint`.

```bash
npm run lint
npm run test:smoke
git add js/pages/dashboard-init.js js/pages/settings-sync.js js/pages/settings-users.js js/pages/support-sessions.js js/pages/settings-license.js js/pages/teachers-list.js js/pages/timetable.js
git commit -m "refactor: replace all remaining window.confirm() with showConfirm() across 6 JS files"
```

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T015 **Final grep verification** — confirm zero native confirm calls remain:

    ```bash
    grep -rn "window\.confirm\|[^w]confirm(" js/ --include="*.js" | grep -v node_modules | grep -v message-system | grep -v showConfirm
    ```

    Expected: no output. If any lines appear, fix them before proceeding.

- [x] T016 **Final HTML verification** — confirm overlay is fully gone:

    ```bash
    grep -rn "import-confirm-overlay" . --include="*.html"
    ```

    Expected: no output.

- [ ] T017 [P] **RTL + dark mode visual check** — launch the app (`npm run dev`), toggle to dark mode via settings, then trigger each migrated dialog on each affected page. Verify every dialog:
    - Renders with correct RTL button order (cancel on the right, confirm on the left in RTL layout)
    - Correct icon and header color for its type (red = danger, amber = warning, blue = info)
    - Arabic text does not overflow or truncate
    - Escape key closes the dialog
    - Clicking outside the card closes the dialog

- [x] T018 [P] **Final lint + smoke test**:

    ```bash
    npm run lint
    npm run css:build
    npm run test:smoke
    ```

    All must pass with zero errors.

- [ ] T019 **Final commit**:
    ```bash
    git add -A
    git commit -m "chore: final verification pass after window.confirm() migration"
    ```

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2**: Skipped (no foundational infrastructure needed)
- **Phase 3 (US1 + US2)**: Depends only on Phase 1 verification passing
- **Phase 5 (US3)**: Independent of Phase 3 — can start in parallel once Phase 1 passes
- **Phase 6 (Polish)**: Depends on Phase 3 AND Phase 5 both complete

### User Story Dependencies

- **US1 + US2 (Phase 3)**: Independent — starts after Phase 1
- **US3 (Phase 5)**: Independent — starts after Phase 1; Group A and Group B tasks within Phase 5 are all parallelizable across files

### Within Phase 5

- T003 → T004 → T005 must run in order (delete overlay HTML first, then delete dead functions, then rewrite callers)
- T006 and T007 depend on T004 + T005 being complete (the old functions must be deleted before the call sites are rewritten, to avoid confusion)
- T008, T009, T010, T011 are fully independent of each other — different files
- T012, T013 are fully independent of each other and of T008–T011
- T014 depends only on itself (one file, two sites — do them together)

---

## Parallel Execution Examples

### Parallel opportunities within Phase 3 (US1):

None — all tasks in Phase 3 touch the same two files (`settings-imports.html` and `settings-imports.js`) and must run sequentially: T003 → T004 → T005 → T006 → T007.

### Parallel opportunities within Phase 5 (US3):

```
# Group A (all touch different files — run together):
T008  js/pages/dashboard-init.js
T009  js/pages/settings-sync.js
T010  js/pages/settings-users.js
T011  js/pages/support-sessions.js

# Group B (different files — run together, or concurrently with Group A):
T012  js/pages/settings-license.js
T013  js/pages/teachers-list.js
T014  js/pages/timetable.js      ← do both sites in this file together
```

### Phase 5 can run in parallel with Phase 3:

Both phases touch completely different files. An LLM (or developer) can work on both simultaneously if desired.

---

## Implementation Strategy

### MVP (User Story 1 only — Phase 3)

1. Complete Phase 1: verify `showConfirm` is available (T001, T002)
2. Complete Phase 3: T003 → T004 → T005 → T006 → T007
3. **STOP and VALIDATE**: trigger each of the 6 clear buttons and the import flow — all must show the unified dialog
4. Run `npm run lint` + commit

### Full Migration (all stories)

1. Complete Phase 1 (T001, T002)
2. Complete Phase 3 (T003–T007) — settings-imports
3. Complete Phase 5 in parallel groups (T008–T014) — remaining 6 files
4. Complete Phase 6 verification pass (T015–T019)

---

## Notes

- **No tests** are included — this is a pure refactor; existing behavior is preserved exactly
- **`showConfirm()` signature**: `showConfirm({ title, message, type, detail?, icon?, confirmText?, cancelText? })` → returns `Promise<{ confirmed: boolean }>`
- **`type` values**: `'danger'` (red), `'warning'` (amber), `'info'` (blue)
- **Default texts**: `confirmText` defaults to `'تأكيد'`, `cancelText` defaults to `'إلغاء'` — only override when a more specific label adds clarity
- **`detail`**: Optional second paragraph in muted text — use for irreversibility warnings or secondary context
- **Async rule**: When a function is NOT already `async`, add `async` to its declaration — do NOT wrap callers, they are fire-and-forget DOM listeners
- **Dead code rule** (constitution §I): Delete `showImportConfirm()` and `showActionConfirm()` entirely — do not leave a stub, a comment, or a `// TODO: remove`
- Commit after each phase for clean history
- If `typeof showConfirm === 'undefined'` at runtime on any page, check that `js/message-system.js` script tag is present in that page's HTML before the page's own script tag
