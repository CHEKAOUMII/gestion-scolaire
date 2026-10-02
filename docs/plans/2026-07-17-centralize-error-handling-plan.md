# Plan: Centralize Error Handling (Renderer IPC Result Path)

| Field | Value |
|-------|-------|
| **Date** | 2026-07-17 |
| **Status** | Proposed |
| **Stack** | Electron 35 · vanilla multi-page JS · `js/message-system.js` · `main/ipc/ipc-helpers.js` |
| **Related** | [Message system plan](../superpowers/plans/2026-03-31-message-system.md) · [Write-channel checklist](./2026-07-15-add-write-channel-checklist.md) · [Layering review](./2026-07-17-layering-architecture-review-plan.md) |

---

## Why this plan exists

Error handling in this app is **half-centralized**:

| Layer | State | Location |
|-------|--------|----------|
| User-facing UI (toast / confirm / field validation) | **Centralized** | `js/message-system.js` (+ toast APIs) |
| Uncaught / unhandled rejection boundary | **Centralized** | `js/utils.js` (throttled + flood protection) |
| Main-process IPC catch + sanitize | **Centralized** | `main/ipc/ipc-helpers.js` (`authErrorResponse`, `sanitizeIpcErrorMessage`) |
| Main-process logging | **Centralized** | `main/diagnostics/error-log.js` |
| **IPC result handling in pages** | **Ad-hoc** | Each `js/pages/*.js` / inline script |

Pages still re-implement the same pattern dozens of times:

```js
if (!result?.success) {
    showToast(result?.error || 'فشل الحفظ', 'error');
    return;
}
```

or:

```js
handle.error(res?.error || 'فشل التحميل');
```

Problems with the status quo:

1. **Inconsistent Arabic fallbacks** — same failure, different wording across pages.
2. **Auth codes handled unevenly** — some pages check `UNAUTHENTICATED` / `FORBIDDEN` / `SESSION_LOCKED`; most ignore them.
3. **Easy to forget feedback** — silent failures when a page only logs `console.error`.
4. **No single place to change policy** — e.g. “always toast sanitized `error` + optional detail for auth redirect”.

This plan closes the **renderer orchestration gap** without rewriting the already-good UI or main IPC layers.

---

## Goals

1. Provide a **single renderer helper** for interpreting IPC responses and showing user feedback.
2. Standardize **success / error / loading** flows for write and read operations.
3. Handle **auth failure codes** consistently (toast + optional redirect / lock UX).
4. Migrate high-churn pages first; leave pure domain validation messages local when they are form-specific.
5. Keep main-process error contract unchanged (`{ success, code?, error }`).

## Non-goals

- Redesigning toast/confirm visuals (already done in message system).
- Changing main SQL, repos, or sync capture.
- Replacing every `try/catch` in algorithms (proctor, import) — those keep domain-specific diagnostics.
- A global interceptor that auto-toasts every IPC call (too magical; breaks silent probes and login flows).

---

## Current architecture (keep)

```
┌─────────────────────────────────────────────────────────────┐
│ Renderer page                                               │
│   try { const r = await window.api.x() }                    │
│   today: ad-hoc if (!r.success) showToast(...)              │
│   target: handleIpcResult(r, { error: '…', success: '…' })  │
└───────────────────────────┬─────────────────────────────────┘
                            │ invoke
┌───────────────────────────▼─────────────────────────────────┐
│ preload → ipcMain.handle                                    │
│ handleRead / handleWrite / handleWriteSoftAuth              │
│   catch → logAppError → { success:false, code, error }      │
└─────────────────────────────────────────────────────────────────┘
```

**IPC error contract (do not break):**

```js
{
  success: false,
  code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'SESSION_LOCKED' | 'INTERNAL_ERROR' | …,
  error: string  // Arabic-safe sanitized message
}
```

Sanitization rules stay in `sanitizeIpcErrorMessage` (Arabic user messages pass through; stack traces / SQLITE / path leaks become `حدث خطأ داخلي`).

---

## Target design

### New module: `js/shared/ipc-result.js`

Single source of truth for **renderer-side** IPC result interpretation.

#### API (proposed)

```js
/**
 * @typedef {object} IpcResultOptions
 * @property {string} [success]     Toast on success (omit = no success toast)
 * @property {string} [error]       Fallback error toast if result.error empty
 * @property {boolean} [silent]     No toasts (still returns ok/false + codes)
 * @property {boolean} [throwOnFail] Reject/throw Error with result.error
 * @property {'toast'|'none'} [authFeedback='toast'] Auth-code handling
 * @property {Function} [onAuthFailure] Optional override (e.g. redirect login)
 * @property {import('…').LoadingHandle} [loading] showToast.loading handle to close
 */

/**
 * @returns {{ ok: boolean, result: any, code?: string, error?: string }}
 */
function handleIpcResult(result, options = {}) { /* … */ }

/** Convenience: await + handle in one step */
async function invokeIpc(fn, options = {}) {
    const loading = options.loadingMessage
        ? showToast.loading(options.loadingMessage)
        : null;
    try {
        const result = await fn();
        return handleIpcResult(result, { ...options, loading });
    } catch (err) {
        if (loading) loading.error(options.error || err?.message || 'حدث خطأ');
        else if (!options.silent) showToast(options.error || err?.message || 'حدث خطأ', 'error');
        return { ok: false, result: null, error: err?.message, code: 'THROW' };
    }
}

/** True when code is session/auth related */
function isAuthFailure(result) { /* UNAUTHENTICATED | FORBIDDEN | SESSION_LOCKED */ }

/** Extract user-facing message with fallback */
function ipcErrorMessage(result, fallback = 'حدث خطأ') { /* … */ }
```

#### Behavior matrix

| Condition | Action |
|-----------|--------|
| `result.success === true` (or truthy success-shaped data for legacy reads) | Close loading → success toast if `options.success` set → `{ ok: true }` |
| `result.success === false` + auth code | Auth toast (shared Arabic copy) → optional `onAuthFailure` → `{ ok: false, code }` |
| `result.success === false` + other | Error toast: `result.error` or `options.error` → `{ ok: false }` |
| Thrown exception in `invokeIpc` | Same as error path with `code: 'THROW'` |
| `options.silent` | No UI; still return structured `{ ok, code, error }` |
| User cancel (`error === 'Cancelled by user'`) | No error toast (print/export paths) |

#### Auth copy (SSOT Arabic strings)

| Code | Default message |
|------|-----------------|
| `UNAUTHENTICATED` | الرجاء تسجيل الدخول أولاً |
| `FORBIDDEN` | ليس لديك صلاحية لتنفيذ هذا الإجراء |
| `SESSION_LOCKED` | الجلسة مقفلة — أعد تسجيل الدخول |
| default | `result.error` or `حدث خطأ` |

Pages may override via `options.error` only for **domain** failures, not for auth codes (auth codes always use SSOT unless `options.authFeedback === 'none'`).

#### Legacy read responses

Many `handleRead` handlers return **arrays/objects** on success, not `{ success: true }`. Rules:

- If `result` is `null`/`undefined` → treat as failure only when caller passes `options.requireSuccessShape: true`.
- If `result?.success === false` → failure path.
- If `result?.success === true` or no `success` key → success path (`ok: true`, data = result).
- Document this in JSDoc so migrations do not break list pages.

---

## Migration strategy

### Phase 0 — Inventory (½ day)

Grep and table the patterns:

```bash
# illustrative; use project search tools in practice
rg "showToast\(.*error" js/pages app.js
rg "!.*\?\.success|result\?\.error|res\?\.error" js/pages
rg "UNAUTHENTICATED|FORBIDDEN|SESSION_LOCKED" js/
```

Deliverable: short table in this plan’s appendix (page → pattern count → priority).

### Phase 1 — Foundation (1 day)

1. Add `js/shared/ipc-result.js` with unit-testable pure helpers:
   - `isAuthFailure`, `ipcErrorMessage`, `normalizeIpcResult` (no DOM).
2. Thin DOM wrapper functions that call `showToast` / loading handle (guard `typeof showToast === 'function'`).
3. Unit tests: `tests/ipc-result-unit.test.js` (Node, no Electron).
4. Smoke: ensure new file is not required for contract parity (renderer-only; no preload change).
5. Document in `CLAUDE.md` under Message System: “IPC results → `handleIpcResult` / `invokeIpc`”.

### Phase 2 — Pilot pages (1–2 days)

Migrate **high-duplication, clear write flows** first:

| Priority | Page / module | Why |
|----------|---------------|-----|
| P0 | `js/pages/settings-defaults.js` | Repeated load/save `!res?.success` + loading |
| P0 | `js/pages/app-admin.js` | Same loading + error pattern |
| P1 | `js/pages/settings-sync.js` | Already has auth code set — fold into helper |
| P1 | `js/pages/settings-license.js` | Partial auth checks |
| P1 | `js/pages/reports-forms.js` / certificates | Cancelled-by-user edge case |

Acceptance per page:

- No raw `showToast(..., 'error')` for IPC `success: false` except domain-specific validation before IPC.
- Auth failures use SSOT messages.
- Loading handles always resolve to success or error (no stuck spinner).

### Phase 3 — Broad migration (incremental)

Wave by domain (one PR per wave preferred):

1. Settings + admin
2. Staff (attendance, daily-report, compensation, support-sessions)
3. Students / grades / results
4. Exams (schedule, rooms, proctors — large files; careful)
5. Dashboard `app.js` + remaining inline HTML scripts

Rule: **new write handlers / new pages must use `handleIpcResult` or `invokeIpc` from day one** (add to write-channel checklist as a renderer step).

### Phase 4 — Guardrails

1. Extend write-channel checklist:

   > Renderer: after `window.api.*` write, use `handleIpcResult` / `invokeIpc` — do not invent a third toast pattern.

2. Optional ESLint note or smoke grep (soft):

   - Flag pages that call `ipcRenderer`/`window.api` write-like methods without importing/using ipc-result (heuristic only; do not fail CI hard until Phase 3 is mature).

3. Optional: shared auth redirect helper if login path is stable:

   ```js
   // e.g. location.href = 'login.html' on UNAUTHENTICATED from protected pages
   ```

   Only if product wants it; default is toast-only.

---

## Files map

| Action | File | Responsibility |
|--------|------|----------------|
| **New** | `js/shared/ipc-result.js` | Normalize IPC results; toasts; auth codes |
| **New** | `tests/ipc-result-unit.test.js` | Pure helpers + auth/cancel edge cases |
| Modify | `js/pages/*` (phased) | Replace ad-hoc `!success` + toast |
| Modify | relevant `.html` | Ensure `js/shared/ipc-result.js` loads **after** `message-system.js` |
| Modify | `docs/plans/2026-07-15-add-write-channel-checklist.md` | Add renderer error-handling step |
| Modify | `CLAUDE.md` / `Agents.md` | Document mandatory IPC result helper |
| No change | `main/ipc/ipc-helpers.js` | Already SSOT for main catch/sanitize |
| No change | `js/message-system.js` | Presentation only; stays as is |
| No change | `preload.js` | No new channels |

### Script load order (every migrated page)

```html
<script src="js/message-system.js" defer></script>
<script src="js/shared/ipc-result.js" defer></script>
<!-- page script last -->
```

Expose globals: `window.handleIpcResult`, `window.invokeIpc`, `window.isAuthFailure`, `window.ipcErrorMessage` (same style as other `js/shared/*` utilities).

---

## Usage examples (after migration)

### Write with loading

```js
const out = await invokeIpc(
    () => window.api.settings.saveDefaults(payload),
    {
        loadingMessage: 'جاري الحفظ...',
        success: 'تم الحفظ بنجاح',
        error: 'فشل الحفظ'
    }
);
if (!out.ok) return;
// use out.result
```

### Manual (when result already awaited)

```js
const result = await window.api.systemTags.saveNote(payload);
const { ok } = handleIpcResult(result, {
    success: 'تم حفظ الملاحظة',
    error: 'تعذر حفظ الملاحظة'
});
if (!ok) return;
```

### Silent probe (status checks)

```js
const { ok, code } = handleIpcResult(result, { silent: true });
if (!ok && isAuthFailure({ code })) { /* page-specific */ }
```

### Print cancel

```js
handleIpcResult(result, {
    error: 'تعذر التصدير',
    // helper treats 'Cancelled by user' as silent non-error
});
```

---

## Testing

| Layer | What |
|-------|------|
| Unit | Auth codes, fallbacks, cancel-by-user, success-shaped legacy data, missing `showToast` no-throw |
| Manual pilot | settings-defaults save/load; force logout mid-session → auth toast |
| Smoke | Existing `npm run test:smoke` still green |
| Lint | `npm run lint` |

No full E2E suite required for Phase 1–2.

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Mis-classifying successful array returns as failures | Explicit success rules; unit tests; pilot on write-shaped APIs first |
| Double toasts (page + helper) | Migration rule: remove page toast when switching to helper |
| Login page must not redirect-loop | `authFeedback: 'none'` or skip helper on login |
| Large exam pages | Phase 3 last; prefer new call sites only if full rewrite is risky |
| Global auto-intercept temptation | Explicitly out of scope — call-site opt-in only |

---

## Success criteria

- [ ] `js/shared/ipc-result.js` exists with documented API and unit tests.
- [ ] CLAUDE.md / write checklist mention the helper as mandatory for new write UI.
- [ ] At least 3 pilot pages migrated with no behavior regressions.
- [ ] Auth failure messages are identical across migrated pages.
- [ ] Main IPC contract unchanged; smoke + lint green.
- [ ] New pages/features do not introduce raw `if (!res?.success) showToast` for IPC.

---

## Suggested PR sequence

| PR | Scope |
|----|--------|
| **PR1** | `ipc-result.js` + unit tests + docs (checklist + CLAUDE) — no page behavior change |
| **PR2** | Pilot: settings-defaults, app-admin, settings-sync |
| **PR3+** | Domain waves (staff → students/grades → exams → rest) |

---

## Appendix A — Known ad-hoc patterns (seed inventory)

Update during Phase 0.

| Pattern | Examples | Target |
|---------|----------|--------|
| `if (!result?.success) handle.error(result?.error \|\| '…')` | app-admin, settings-defaults | `invokeIpc` / `handleIpcResult` |
| `showToast(res?.error \|\| '…', 'error')` | reports-forms, exams-rooms | `handleIpcResult` |
| `h.error('فشل: ' + (res?.error\|\|''))` | exams-proctors, exams-schedule | `handleIpcResult` + loading |
| Auth code sets local to page | settings-sync, settings-license, utils | `isAuthFailure` + SSOT messages |
| Cancelled by user special-case | grades-sheets, reports-certificates | built into helper |
| `console.error` only | absence-weekly timetable load | at least toast via helper |

---

## Appendix B — What is already done (do not rebuild)

| Piece | File | Role |
|-------|------|------|
| Confirm + field validation + styles | `js/message-system.js` | UI primitives |
| Toast variants (loading / action) | message/notifications path | Feedback |
| Global error boundary | `js/utils.js` | Uncaught only |
| IPC try/catch + sanitize | `main/ipc/ipc-helpers.js` | Main boundary |
| Persistent error log | `main/diagnostics/error-log.js` | Diagnostics |
| Message system verification tasks | `specs/026-message-system-verification/` | Prior QA |

This plan **extends** that stack; it does not replace it.

---

## Decision log

| ID | Decision | Rationale |
|----|----------|-----------|
| D1 | Opt-in helper, not global IPC monkey-patch | Silent probes, login, and multi-step flows need control |
| D2 | Auth messages are SSOT; domain fallbacks are per-call | Consistency for security UX; flexibility for business errors |
| D3 | Pure normalize helpers testable in Node | Matches existing unit-test style (`error-log-unit`, etc.) |
| D4 | No preload/main contract change | Contract already good; gap is renderer only |
| D5 | Cancelled-by-user is non-error | Matches print/export UX today |
