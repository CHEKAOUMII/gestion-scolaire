# Tasks: Loading Toast Variant

**Input**: Design documents from `/specs/022-loading-toast/`
**Branch**: `022-loading-toast`
**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Contract**: [contracts/loading-toast-handle.md](contracts/loading-toast-handle.md)

> **Context for implementors**: This is a **renderer-only** feature for an Electron desktop app (Arabic school management system). No bundler is used — vanilla JS only (ES5 IIFE pattern). All styles go in `css/tailwind-input.css`. No IPC, no main-process changes, no new HTML pages.
>
> **Status**: Core JS (`renderLoadingToast`) and CSS are **already implemented** (commit `0d7a23d`). This task list covers **verification only** — confirming the existing implementation satisfies every functional requirement before merging.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1)
- No tests requested — verification is manual per Constitution §II

---

## Phase 1: Setup (Read Context)

**Purpose**: Understand existing implementation before verifying it. No code changes here.

- [ ] T001 Read `js/notifications.js` lines 82–170 to understand `renderLoadingToast`, `_createNoopHandle`, `_deduplicateToast`, and the handle's `dismissed`/`resolved` flags
- [ ] T002 Read `css/tailwind-input.css` lines 8010–8080 to understand `.toast.loading`, `.toast-progress-bar`, `.toast-close`, and `[data-theme='dark'] .toast.loading`
- [ ] T003 [P] Read `specs/022-loading-toast/contracts/loading-toast-handle.md` to understand the full public API contract
- [ ] T004 [P] Read `specs/022-loading-toast/data-model.md` to understand LoadingToastHandle, ToastState, ProgressBar, and NoopHandle entities

**Checkpoint**: You now have a complete mental model of the existing implementation.

---

## Phase 2: Foundational (Blocking Prerequisite)

**Purpose**: Confirm the build pipeline works before any verification.

**⚠️ CRITICAL**: Phase 3 cannot begin until this passes.

- [ ] T005 Run `npm run css:build` from `d:/gestionScholaire` and confirm it exits with code 0 and `css/tailwind-output.css` is updated with no errors
- [ ] T006 Run `npm run lint` from `d:/gestionScholaire` and confirm zero ESLint errors (warnings about `no-unused-vars` in renderer are acceptable per `eslint.config.mjs`)
- [ ] T007 Run `npm run test:smoke` from `d:/gestionScholaire` and confirm all smoke checks pass (IPC parity, no CDN refs, Tailwind output, module integrity)

**Checkpoint**: Build pipeline green — verification can now proceed.

---

## Phase 3: User Story 1 — Loading Toast (Priority: P1) 🎯 MVP

**Goal**: Confirm that `showToast.loading()` fully satisfies all 10 functional requirements and 7 success criteria from the spec, in both light and dark themes with RTL layout.

**Independent Test**: Open DevTools console on any page, run the test snippets from `specs/022-loading-toast/quickstart.md`, and observe correct visual behaviour.

### Implementation for User Story 1

> **No new code is expected**. Each task is a verification step. If a step reveals a gap, a targeted fix is applied to `js/notifications.js` or `css/tailwind-input.css` before continuing.

- [ ] T008 [US1] Launch the app with `npm run start` and open DevTools console on any page (e.g., `index.html`)

- [ ] T009 [US1] **Verify FR-001 + SC-001** (toast appears immediately): Run in console:
  ```js
  var h = showToast.loading('جاري الحفظ...');
  ```
  Confirm: a toast with a spinning indicator and text "جاري الحفظ..." appears within 100ms. The spinner must be animated (CSS `animation: spin 1s linear infinite`). Confirm `h` has methods `success`, `error`, `progress`, `dismiss`.

- [ ] T010 [US1] **Verify FR-002** (stays persistent while loading): Confirm the toast from T009 remains on screen after 5 seconds with no user action. It MUST NOT auto-dismiss on its own.

- [ ] T011 [US1] **Verify FR-003 + SC-002 + SC-003** (success transition, in-place, 3s dismiss): Run in console:
  ```js
  var h = showToast.loading('جاري التزامن...');
  setTimeout(function () { h.success('تم التزامن بنجاح'); }, 2000);
  ```
  Confirm: after 2s the same toast element changes icon to check-circle, class changes to `toast success`, text updates. Progress bar fills to 100%. The toast auto-dismisses approximately 3 seconds later. No new toast element was created.

- [ ] T012 [US1] **Verify FR-004 + SC-002 + SC-003** (error transition, in-place, 5s dismiss): Wait 5s after T011 for dedup window, then run:
  ```js
  var h = showToast.loading('جاري الاستيراد...');
  setTimeout(function () { h.error('فشل الاتصال بالخادم'); }, 2000);
  ```
  Confirm: after 2s the same toast element changes icon to exclamation-circle, class changes to `toast error`, text updates. Progress bar is removed. The toast auto-dismisses approximately 5 seconds later.

- [ ] T013 [US1] **Verify FR-005 + SC-007** (manual close button): Run:
  ```js
  var h = showToast.loading('جاري المعالجة...');
  ```
  Click the close button (×) immediately. Confirm the toast dismisses immediately. Confirm the close button is keyboard-reachable (Tab to it, press Enter/Space).

- [ ] T014 [US1] **Verify FR-006** (progress bar): Wait 3s after T013, then run:
  ```js
  var h = showToast.loading('جاري الرفع...');
  var pct = 0;
  var interval = setInterval(function () {
      pct += 20;
      h.progress(pct);
      if (pct >= 100) { clearInterval(interval); h.success('اكتمل الرفع'); }
  }, 500);
  ```
  Confirm: progress bar width increases visually from 0% → 20% → 40% → 60% → 80% → 100%, then transitions to success.

- [ ] T015 [US1] **Verify FR-007 + SC-004** (deduplication): Run twice in rapid succession:
  ```js
  var h1 = showToast.loading('جاري الحفظ...');
  var h2 = showToast.loading('جاري الحفظ...');
  ```
  Confirm: only ONE toast appears. `h2` must be a no-op handle (calling `h2.success('test')` produces no error and no visual effect).

- [ ] T016 [US1] **Verify FR-008** (in-place visual transition — no new element): Add a unique attribute before triggering resolution to confirm same DOM node:
  ```js
  var h = showToast.loading('جاري التحميل...');
  document.querySelector('.toast.loading').dataset.testId = 'abc';
  setTimeout(function () {
      h.success('تم التحميل');
      console.log('Same element?', !!document.querySelector('[data-test-id="abc"].toast.success'));
  }, 1000);
  ```
  Confirm console logs `Same element? true`.

- [ ] T017 [US1] **Verify FR-009 + SC-005** (safe no-op after dismiss): Run:
  ```js
  var h = showToast.loading('اختبار...');
  h.dismiss();
  h.success('لا يجب أن يظهر شيء');
  h.error('لا يجب أن يظهر شيء');
  h.progress(50);
  h.dismiss();
  ```
  Confirm: no errors in console, no new toasts appear, no visual effects after the first `dismiss()`.

- [ ] T018 [US1] **Verify FR-010 + SC-006** (dark theme): Toggle dark theme (`document.documentElement.setAttribute('data-theme', 'dark')`), then run:
  ```js
  var h = showToast.loading('جاري التحميل...');
  setTimeout(function () { h.success('تم'); }, 2000);
  ```
  Confirm: loading toast uses `rgba(59, 106, 197, 0.15)` dark background. Text is legible (adequate contrast). Spinner visible. Success state also correct. Then restore: `document.documentElement.setAttribute('data-theme', 'light')`.

- [ ] T019 [US1] **Verify RTL layout** (Constitution §III): Confirm in both themes:
  - Spinner icon appears on the **right** side of the toast (RTL inline-start)
  - Close button appears on the **left** side (RTL inline-start = visual left = absolute left:6px)
  - Progress bar aligns to the **right** edge (RTL inline-end = visual right)
  - Arabic text renders without truncation or overflow
  - `border-inline-end` accent stripe is on the correct side

- [ ] T020 [US1] **Verify edge case: hung operation** (spec edge case 2): Run:
  ```js
  var h = showToast.loading('جاري الانتظار...');
  ```
  Wait 15 seconds without calling `.success()` or `.error()`. Confirm the toast remains visible indefinitely. Then call `h.dismiss()` and confirm it dismisses.

- [ ] T021 [US1] **Verify edge case: out-of-range progress** (spec edge case 3):
  ```js
  var h = showToast.loading('اختبار النطاق...');
  h.progress(-50);   // should clamp to 0
  h.progress(200);   // should clamp to 100
  h.dismiss();
  ```
  Confirm no errors in console. Progress bar width stays within 0–100%.

- [ ] T022 [US1] **Verify edge case: simultaneous independent toasts** (spec edge case 4):
  ```js
  var h1 = showToast.loading('عملية أولى...');
  setTimeout(function () {
      var h2 = showToast.loading('عملية ثانية...');
      setTimeout(function () { h1.success('انتهت الأولى'); }, 1000);
      setTimeout(function () { h2.error('فشلت الثانية'); }, 2000);
  }, 100);
  ```
  Confirm both toasts are visible simultaneously, each manages its own lifecycle independently (success on h1 does not affect h2).

**Checkpoint**: All FR-001–FR-010 and SC-001–SC-007 verified. Feature is complete.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Final quality gates before merge.

- [ ] T023 [P] Run `npm run css:build` again to confirm CSS output is still clean after any fixes made during verification
- [ ] T024 [P] Run `npm run lint` to confirm zero errors remain after any fixes
- [ ] T025 Run `npm run test:smoke` final time to confirm CI gate passes
- [ ] T026 If any fix was applied to `js/notifications.js` or `css/tailwind-input.css` during Phase 3, stage and commit with message `fix(notifications): <description of fix>` per conventional commit format
- [ ] T027 If no fixes were needed, confirm branch is ready for merge with message `feat(notifications): loading toast variant verified and complete`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — read-only, start immediately
- **Foundational (Phase 2)**: No code dependencies, but must pass before Phase 3 to ensure build is green
- **User Story (Phase 3)**: Depends on Phase 2 passing; tasks T008–T022 are sequential (each verifies one requirement)
- **Polish (Phase 4)**: Depends on Phase 3 completion; T023 and T024 can run in parallel with each other

### Within Phase 3

Tasks T008–T022 must run **sequentially** — each builds on the state left by the previous (e.g., T009 must leave a handle available for T010, dedup window must clear before T015, etc.). Wait for the dedup window (2 seconds) between tests that use the same message string.

### Parallel Opportunities

- T003 and T004 (Phase 1) can run in parallel
- T023 and T024 (Phase 4) can run in parallel
- All Phase 1 tasks can begin while Phase 2 commands are running (they are reads, not writes)

---

## Parallel Example: Phase 1

```
Task T001: Read js/notifications.js lines 82–170
Task T003: Read contracts/loading-toast-handle.md     ← parallel with T001
Task T004: Read data-model.md                         ← parallel with T001
Task T002: Read css/tailwind-input.css lines 8010–8080
```

---

## Implementation Strategy

### MVP (This feature has one user story)

1. Complete Phase 1: Read context (≈5 min)
2. Complete Phase 2: Build pipeline green (≈2 min)
3. Complete Phase 3: Verify all requirements T008–T022 (≈15 min)
4. **STOP and VALIDATE**: All 10 FRs and 7 SCs confirmed
5. Complete Phase 4: Final gates + commit (≈2 min)

### If a Verification Step Fails

When a task in Phase 3 reveals a gap:

1. Identify whether the fix is in `js/notifications.js` or `css/tailwind-input.css`
2. Apply the minimal targeted fix
3. Re-run `npm run lint` and `npm run css:build` immediately after the fix
4. Re-run the failing verification step to confirm it now passes
5. Continue to the next task

---

## Notes

- [P] tasks = different files or independent reads, no blocking dependencies
- [US1] label maps every task to User Story 1 (the only story in this spec)
- All user-facing strings in verification snippets are Arabic (RTL)
- Dedup window is 2 seconds — wait between tests that share a message string
- The feature is **renderer-only** — never touch `main/`, `preload.js`, or `main/ipc/`
- Commit after Phase 3 completion (one commit covering all verification fixes, if any)
